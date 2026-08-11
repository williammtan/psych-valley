/**
 * Art registry + packer.
 *
 * Two output channels:
 *   1. TILES  — 16x16 tiles packed into a grid tileset (extruded 1px on every
 *               side, margin 1 / spacing 2) for Phaser tilemap layers.
 *   2. ATLAS  — arbitrary-size sprites packed into a texture atlas
 *               (Phaser 'JSONHash') for props, characters, FX and UI.
 *
 * Names are paths: 'tile/town/grass_00', 'prop/town/barrel', 'char/sera/walk_s_0'.
 * Animations are declared alongside so the runtime never hardcodes frame lists.
 */
import { Surface } from './pixel.js';

export const TILE = 16;

export interface AnimDef {
  key: string;
  frames: string[];
  frameRate: number;
  repeat: number; // -1 loop
}

export interface Registry {
  addTile(name: string, s: Surface): number;
  add(name: string, s: Surface): void;
  addAnim(def: AnimDef): void;
  /** Register a strip of same-size frames as name_0..name_n and an animation. */
  addStrip(base: string, frames: Surface[], anim?: Omit<AnimDef, 'frames'> & { frames?: never }): void;
}

export class ArtBuild implements Registry {
  tiles: { name: string; s: Surface }[] = [];
  tileIndex = new Map<string, number>();
  sprites: { name: string; s: Surface }[] = [];
  spriteNames = new Set<string>();
  anims: AnimDef[] = [];
  /** blob-set name -> 256-entry neighbour-mask -> tileset index */
  blobs: Record<string, number[]> = {};
  /** animated blob sets: name -> one 256-entry table per frame */
  blobFrames: Record<string, { frames: number[][]; frameRate: number }> = {};
  /** animated tile name -> ordered tileset indices */
  tileAnims: Record<string, { frames: number[]; frameRate: number }> = {};

  addTile(name: string, s: Surface): number {
    if (s.w !== TILE || s.h !== TILE) {
      throw new Error(`tile ${name} must be ${TILE}x${TILE}, got ${s.w}x${s.h}`);
    }
    if (this.tileIndex.has(name)) throw new Error(`duplicate tile ${name}`);
    const idx = this.tiles.length;
    this.tiles.push({ name, s });
    this.tileIndex.set(name, idx);
    return idx;
  }

  add(name: string, s: Surface): void {
    if (this.spriteNames.has(name)) throw new Error(`duplicate sprite ${name}`);
    this.spriteNames.add(name);
    this.sprites.push({ name, s });
  }

  addAnim(def: AnimDef): void {
    this.anims.push(def);
  }

  addStrip(base: string, frames: Surface[], anim?: Omit<AnimDef, 'frames'> & { frames?: never }): void {
    const names: string[] = [];
    frames.forEach((f, i) => {
      const n = `${base}_${i}`;
      this.add(n, f);
      names.push(n);
    });
    if (anim) this.addAnim({ ...anim, frames: names } as AnimDef);
  }
}

// ── Tileset packing ─────────────────────────────────────────────────────────

export function packTileset(tiles: { name: string; s: Surface }[], columns = 32) {
  const margin = 1;
  const spacing = 2;
  const rows = Math.ceil(tiles.length / columns);
  const w = margin * 2 + columns * TILE + (columns - 1) * spacing;
  const h = margin * 2 + rows * TILE + (rows - 1) * spacing;
  const out = new Surface(Math.max(w, 1), Math.max(h, 1));
  tiles.forEach((t, i) => {
    const cx = i % columns;
    const cy = Math.floor(i / columns);
    const x = margin + cx * (TILE + spacing);
    const y = margin + cy * (TILE + spacing);
    out.blit(t.s, x, y);
    // Extrude edges by 1px into the spacing gutter so bilinear/rounding never
    // samples a neighbouring tile.
    for (let i2 = 0; i2 < TILE; i2++) {
      out.px(x + i2, y - 1, t.s.get(i2, 0));
      out.px(x + i2, y + TILE, t.s.get(i2, TILE - 1));
      out.px(x - 1, y + i2, t.s.get(0, i2));
      out.px(x + TILE, y + i2, t.s.get(TILE - 1, i2));
    }
    out.px(x - 1, y - 1, t.s.get(0, 0));
    out.px(x + TILE, y - 1, t.s.get(TILE - 1, 0));
    out.px(x - 1, y + TILE, t.s.get(0, TILE - 1));
    out.px(x + TILE, y + TILE, t.s.get(TILE - 1, TILE - 1));
  });
  return { surface: out, columns, rows, margin, spacing, tileWidth: TILE, tileHeight: TILE };
}

// ── Atlas packing (shelf, sorted by height — plenty for our volume) ─────────

export interface AtlasFrame {
  x: number; y: number; w: number; h: number;
}

export function packAtlas(sprites: { name: string; s: Surface }[], maxWidth = 2048) {
  const pad = 1;
  const sorted = [...sprites].sort((a, b) => b.s.h - a.s.h || b.s.w - a.s.w);
  const placed: { name: string; s: Surface; x: number; y: number }[] = [];
  let shelfY = pad;
  let shelfH = 0;
  let cx = pad;
  for (const sp of sorted) {
    if (cx + sp.s.w + pad > maxWidth) {
      shelfY += shelfH + pad;
      shelfH = 0;
      cx = pad;
    }
    placed.push({ name: sp.name, s: sp.s, x: cx, y: shelfY });
    cx += sp.s.w + pad;
    shelfH = Math.max(shelfH, sp.s.h);
  }
  const height = shelfY + shelfH + pad;
  let width = 1;
  while (width < maxWidth) width *= 2;
  let h2 = 1;
  while (h2 < height) h2 *= 2;
  const out = new Surface(width, h2);
  const frames: Record<string, AtlasFrame> = {};
  for (const p of placed) {
    out.blit(p.s, p.x, p.y);
    frames[p.name] = { x: p.x, y: p.y, w: p.s.w, h: p.s.h };
  }
  return { surface: out, frames, width, height: h2 };
}

export function atlasJSON(
  frames: Record<string, AtlasFrame>,
  imageName: string,
  size: { width: number; height: number },
) {
  const out: Record<string, unknown> = {};
  for (const [name, f] of Object.entries(frames)) {
    out[name] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
      sourceSize: { w: f.w, h: f.h },
    };
  }
  return {
    frames: out,
    meta: {
      app: 'project-psyche-artgen',
      version: '1.0',
      image: imageName,
      format: 'RGBA8888',
      size,
      scale: '1',
    },
  };
}
