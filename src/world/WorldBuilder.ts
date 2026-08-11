/**
 * Turns a MapDef into live Phaser objects:
 *   - three tilemap layers (ground / detail / scatter) built programmatically
 *   - a collision grid used by the movement code
 *   - prop sprites, depth-sorted by their base Y
 *   - zone rectangles, lights, NPC spawn requests
 */
import Phaser from 'phaser';
import { TILE, DEPTH } from '@/core/config';
import { blobTable, blobAnimation, familyTiles, hash01, hasFamily, hasTile, tileIndex, variantAt } from './art';
import { hasFrame } from '@/core/textures';
import type { MapDef, Material, ObjectSpec, ScatterRule } from './types';
import { validateMap } from './types';

export interface BuiltProp {
  sprite: Phaser.GameObjects.Sprite;
  spec: ObjectSpec;
  tx: number;
  ty: number;
  id?: string;
}

export interface BuiltWorld {
  def: MapDef;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  map: Phaser.Tilemaps.Tilemap;
  ground: Phaser.Tilemaps.TilemapLayer;
  detail: Phaser.Tilemaps.TilemapLayer;
  scatter: Phaser.Tilemaps.TilemapLayer;
  overLayer: Phaser.Tilemaps.TilemapLayer;
  /** solid[y][x] — static world collision. */
  solid: boolean[][];
  props: BuiltProp[];
  waterCells: Array<[number, number]>;
  waterAnim?: { frames: number[][]; frameRate: number };
}

const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;

export function buildWorld(scene: Phaser.Scene, def: MapDef): BuiltWorld {
  validateMap(def);
  const h = def.ground.length;
  const w = def.ground[0].length;

  const mat = (x: number, y: number): Material | undefined => {
    if (x < 0 || y < 0 || x >= w || y >= h) return undefined;
    return def.legend[def.ground[y][x]];
  };

  const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: w, height: h });
  const ts = map.addTilesetImage('tiles', 'tiles', TILE, TILE, 1, 2)!;

  const ground = map.createBlankLayer('ground', ts)!.setDepth(DEPTH.GROUND);
  const detail = map.createBlankLayer('detail', ts)!.setDepth(DEPTH.DETAIL);
  const scatter = map.createBlankLayer('scatter', ts)!.setDepth(DEPTH.SCATTER);
  const overLayer = map.createBlankLayer('over', ts)!.setDepth(DEPTH.OVER);

  const solid: boolean[][] = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  const waterCells: Array<[number, number]> = [];
  let waterAnim: BuiltWorld['waterAnim'];

  // ── ground + detail ──────────────────────────────────────────────────────
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = mat(x, y)!;
      if (hasFamily(m.base)) ground.putTileAt(variantAt(m.base, x, y, 11), x, y);
      if (m.solid || m.pit) solid[y][x] = true;

      if (m.blob) {
        const table = blobTable(m.blob);
        let mask = 0;
        const same = (dx: number, dy: number) => {
          const n2 = mat(x + dx, y + dy);
          // Off-map counts as "same" so materials don't get a rim at the border.
          if (!n2) return true;
          return n2.blob === m.blob;
        };
        if (same(0, -1)) mask |= N;
        if (same(1, -1)) mask |= NE;
        if (same(1, 0)) mask |= E;
        if (same(1, 1)) mask |= SE;
        if (same(0, 1)) mask |= S;
        if (same(-1, 1)) mask |= SW;
        if (same(-1, 0)) mask |= W;
        if (same(-1, -1)) mask |= NW;
        detail.putTileAt(table[mask], x, y);

        const anim = blobAnimation(m.blob);
        if (anim) {
          waterAnim = anim;
          waterCells.push([x, y]);
          // remember the mask so frame swaps keep the same shape
          detail.getTileAt(x, y)!.properties = { mask };
        }
      }
    }
  }

  // ── scatter ──────────────────────────────────────────────────────────────
  const rules = def.scatterRules ?? {};
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = mat(x, y)!;
      if (m.overlay) {
        // Exact tile name wins; otherwise treat it as a family.
        if (hasTile(m.overlay)) scatter.putTileAt(tileIndex(m.overlay), x, y);
        else if (hasFamily(m.overlay)) scatter.putTileAt(variantAt(m.overlay, x, y, 31), x, y);
        else console.warn(`[psyche] map '${def.id}': unknown overlay tile '${m.overlay}'`);
        continue;
      }
      if (!m.scatter) continue;
      const rule: ScatterRule | undefined = rules[m.scatter];
      if (!rule) continue;
      if (hash01(x, y, 7) > rule.density) continue;
      const total = rule.tiles.reduce((a, t) => a + t[1], 0);
      let pick = hash01(x, y, 23) * total;
      for (const [fam, weight] of rule.tiles) {
        pick -= weight;
        if (pick <= 0) {
          if (fam && hasFamily(fam)) scatter.putTileAt(variantAt(fam, x, y, 31), x, y);
          break;
        }
      }
    }
  }

  // ── objects / above grids + explicit props ───────────────────────────────
  const props: BuiltProp[] = [];
  /**
   * Missing frames must never reach the renderer: Phaser substitutes the
   * texture's __BASE frame, which draws the whole 2048px atlas into the world.
   * Anything unresolvable is reported once and skipped.
   */
  const missing = new Set<string>();
  const resolve = (keys: string[], tx: number, ty: number): string | null => {
    const usable = keys.filter((k) => hasFrame(scene, k));
    if (!usable.length) { keys.forEach((k) => missing.add(k)); return null; }
    return usable[Math.floor(hash01(tx, ty, 53) * usable.length) % usable.length];
  };

  /**
   * Contact shadows.
   *
   * A blind A/B against a commercial reference called this "the cheapest single
   * improvement in the whole list": without a shadow, a prop is a sticker on the
   * floor rather than an object standing on it, and a scene full of stickers
   * reads as a prototype no matter how good the individual sprites are.
   *
   * Skipped for over-layer props (they are above the player, not on the ground)
   * and for anything the author marks flat.
   */
  const dropShadow = (spec: ObjectSpec, sprite: Phaser.GameObjects.Sprite, over: boolean) => {
    const mode = spec.shadow ?? 'auto';
    if (mode === 'none' || over) return;
    const w = sprite.width;
    const size = mode === 'auto'
      ? (w <= 18 ? 'small' : w <= 40 ? 'med' : 'large')
      : mode;
    const frame = `fx/shadow_${size}`;
    if (!hasFrame(scene, frame)) return;
    // Bigger things cast heavier shadows. A blind A/B measured our frame at
    // 0.01% of pixels below L=25 against the reference's 2.66% — we had no true
    // darks anywhere, and a building throwing a faint smudge is most of why.
    const alpha = size === 'large' ? 0.5 : size === 'med' ? 0.38 : 0.32;
    const img = scene.add.image(sprite.x, sprite.y - 1, 'atlas', frame)
      .setOrigin(0.5, 0.5)
      .setAlpha(alpha)
      .setDepth(DEPTH.SHADOW);
    // Wide props need a wider shadow than the largest authored ellipse, and a
    // building's shadow should read as a footprint rather than a puddle.
    if (w > 56) img.setScale(Math.min(2.6, w / 46), 1 + Math.min(0.9, w / 200));
    return img;
  };

  const place = (spec: ObjectSpec, tx: number, ty: number, id?: string, forceOver = false) => {
    const keys = Array.isArray(spec.key) ? spec.key : [spec.key];
    const key = resolve(keys, tx, ty);
    if (!key) return null;
    const ox = spec.offset?.[0] ?? 0;
    const oy = spec.offset?.[1] ?? 0;
    const px = tx * TILE + TILE / 2 + ox;
    const py = ty * TILE + TILE + oy;
    const sprite = scene.add.sprite(px, py, 'atlas', key).setOrigin(0.5, 1);
    if (spec.anim) sprite.play(spec.anim);
    const over = forceOver || spec.over;
    sprite.setDepth(over ? DEPTH.OVER + ty : DEPTH.ENTITY_BASE + py + (spec.depthBias ?? 0));
    dropShadow(spec, sprite, !!over);

    if (spec.solid) {
      const bw = spec.solid === true ? sprite.width : spec.solid[0];
      const bh = spec.solid === true ? 8 : spec.solid[1];
      const x0 = Math.floor((px - bw / 2) / TILE);
      const x1 = Math.ceil((px + bw / 2) / TILE) - 1;
      const y0 = Math.floor((py - bh) / TILE);
      const y1 = Math.ceil(py / TILE) - 1;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) solid[yy][xx] = true;
        }
      }
    }
    props.push({ sprite, spec, tx, ty, id });
    return sprite;
  };

  const runGrid = (grid: string[] | undefined, forceOver: boolean) => {
    if (!grid) return;
    grid.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === ' ') return;
        const spec = def.objectLegend![ch];
        place(spec, x, y, undefined, forceOver);
      });
    });
  };
  runGrid(def.objects, false);
  runGrid(def.above, true);

  for (const p of def.props ?? []) {
    const spec: ObjectSpec = { key: p.key, ...(p.spec ?? {}) };
    const keys = Array.isArray(spec.key) ? spec.key : [spec.key];
    const key = resolve(keys, Math.floor(p.x), Math.floor(p.y));
    if (!key) continue;
    const px = p.x * TILE + TILE / 2 + (spec.offset?.[0] ?? 0);
    const py = p.y * TILE + TILE + (spec.offset?.[1] ?? 0);
    const sprite = scene.add.sprite(px, py, 'atlas', key).setOrigin(0.5, 1);
    if (spec.anim) sprite.play(spec.anim);
    sprite.setDepth(spec.over ? DEPTH.OVER + p.y : DEPTH.ENTITY_BASE + py + (spec.depthBias ?? 0));
    dropShadow(spec, sprite, !!spec.over);
    if (spec.solid) {
      const bw = spec.solid === true ? sprite.width : spec.solid[0];
      const bh = spec.solid === true ? 8 : spec.solid[1];
      for (let yy = Math.floor((py - bh) / TILE); yy <= Math.ceil(py / TILE) - 1; yy++) {
        for (let xx = Math.floor((px - bw / 2) / TILE); xx <= Math.ceil((px + bw / 2) / TILE) - 1; xx++) {
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) solid[yy][xx] = true;
        }
      }
    }
    props.push({ sprite, spec, tx: Math.floor(p.x), ty: Math.floor(p.y), id: p.id });
  }

  // Explicit 'block' zones let designers seal gaps without inventing props.
  for (const z of def.zones ?? []) {
    if (z.kind !== 'block') continue;
    for (let yy = z.y; yy < z.y + z.h; yy++) {
      for (let xx = z.x; xx < z.x + z.w; xx++) {
        if (yy >= 0 && yy < h && xx >= 0 && xx < w) solid[yy][xx] = true;
      }
    }
  }

  if (missing.size) {
    console.warn(`[psyche] map '${def.id}' references ${missing.size} missing sprite(s):`, [...missing]);
    const w2 = window as unknown as { __missingProps?: Record<string, string[]> };
    w2.__missingProps = { ...(w2.__missingProps ?? {}), [def.id]: [...missing] };
  }

  return {
    def,
    width: w,
    height: h,
    pixelWidth: w * TILE,
    pixelHeight: h * TILE,
    map,
    ground,
    detail,
    scatter,
    overLayer,
    solid,
    props,
    waterCells,
    waterAnim,
  };
}

/** Swap animated blob tiles (water) to a new frame index. */
export function stepWaterFrame(world: BuiltWorld, frame: number): void {
  if (!world.waterAnim) return;
  const table = world.waterAnim.frames[frame % world.waterAnim.frames.length];
  for (const [x, y] of world.waterCells) {
    const tile = world.detail.getTileAt(x, y);
    if (!tile) continue;
    const mask = (tile.properties as { mask?: number } | undefined)?.mask ?? 255;
    const props = tile.properties;
    world.detail.putTileAt(table[mask], x, y);
    const t2 = world.detail.getTileAt(x, y);
    if (t2) t2.properties = props;
  }
}
