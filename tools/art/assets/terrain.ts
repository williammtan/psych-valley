/**
 * TOWN TERRAIN — Lumen Vale ground materials.
 *
 * Layering contract used by the whole game:
 *   layer 0 "ground"  — always fully opaque. Grass / sand / interior floor.
 *   layer 1 "detail"  — blob-autotiled overlays: dirt, stone path, cobble, water.
 *   layer 2 "scatter" — small non-colliding decoration: tufts, pebbles, flowers.
 *   layer 3 "over"    — drawn above the player (tree canopy tops, roof eaves).
 *
 * House style, applied everywhere:
 *   - light comes from the upper-left; the bottom-right of any form is darker
 *   - no pure black; shadows are OUTLINE (#241d33) or a ramp[0]
 *   - flat areas always carry at least two ramp steps of mottling, never one
 *   - edges between materials get a 1px darker lip plus a warm 1px top lip
 */
import { Surface, rng, valueNoise, speckle, ditherFill } from '../lib/pixel.js';
import { ArtBuild, TILE } from '../lib/registry.js';
import { registerBlobSet, edgePixels, N, S, E, W } from '../lib/autotile.js';
import * as P from '../lib/palette.js';

// ── shared helpers ─────────────────────────────────────────────────────────

/** Mottled flat fill: base with organic patches of the neighbouring ramp steps. */
function mottle(s: Surface, ramp: readonly string[], seed: number, opts: {
  x?: number; y?: number; w?: number; h?: number;
  scale?: number; lightAmt?: number; darkAmt?: number; contrast?: number;
} = {}) {
  const { x = 0, y = 0, w = s.w, h = s.h, scale = 3.2, lightAmt = 0.62, darkAmt = 0.34 } = opts;
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 991);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = n1(x + i, y + j, scale) * 0.65 + n2(x + i, y + j, scale * 2.6) * 0.35;
      let c = ramp[2];
      if (v > lightAmt + 0.16) c = ramp[4];
      else if (v > lightAmt) c = ramp[3];
      else if (v < darkAmt - 0.14) c = ramp[0];
      else if (v < darkAmt) c = ramp[1];
      s.px(x + i, y + j, c);
    }
  }
}

// ── GRASS ──────────────────────────────────────────────────────────────────

/**
 * Grass reads as a calm mid-green field, not camouflage. The rule that keeps it
 * calm: ramp[2] dominates, ramp[3] appears in broad soft patches, and the two
 * extremes only ever show up as small deliberate marks (blade tips, divots).
 * High-frequency full-range noise is what makes procedural grass look cheap.
 */
function grassTile(ramp: readonly string[], seed: number, variant: number): Surface {
  const s = new Surface(TILE, TILE);
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 4211);
  const ox = variant * 37, oy = variant * 71;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Large, low-contrast patches only.
      const v = n1(x + ox, y + oy, 7.5) * 0.75 + n2(x + ox, y + oy, 3.1) * 0.25;
      let c = ramp[2];
      if (v > 0.60) c = ramp[3];
      else if (v < 0.36) c = ramp[1];
      s.px(x, y, c);
    }
  }
  // Blade tips: the only place the light end of the ramp appears. Sparse,
  // clustered, two pixels tall so they read as individual blades at 4x zoom.
  const r = rng(seed + variant * 313);
  const clusters = 2 + r.int(0, 2);
  for (let ci = 0; ci < clusters; ci++) {
    const cx = r.int(1, TILE - 2);
    const cy = r.int(2, TILE - 2);
    const n = r.int(2, 4);
    for (let i = 0; i < n; i++) {
      const bx = cx + r.int(-2, 2);
      const by = cy + r.int(-1, 1);
      s.px(bx, by, ramp[4]);
      s.px(bx, by - 1, ramp[3]);
    }
  }
  // A couple of dark divots for grit; anything more turns into noise.
  speckle(s, rng(seed + variant * 77 + 5), 0, 0, TILE, TILE, ramp[0], 3, 0.45);
  return s;
}

// ── SCATTER DECORATION (layer 2) ───────────────────────────────────────────

function tuft(ramp: readonly string[], seed: number, size: 'sm' | 'md' | 'lg'): Surface {
  const s = new Surface(TILE, TILE);
  const r = rng(seed);
  const blades = size === 'sm' ? 3 : size === 'md' ? 6 : 10;
  const cx = TILE / 2, cy = TILE - 4;
  for (let i = 0; i < blades; i++) {
    const bx = Math.round(cx + r.range(-4.5, 4.5));
    const hgt = size === 'lg' ? r.int(4, 7) : size === 'md' ? r.int(3, 5) : r.int(2, 4);
    const lean = r.chance(0.5) ? 1 : -1;
    for (let k = 0; k < hgt; k++) {
      const x = bx + (k > hgt - 2 ? lean : 0);
      const y = cy - k;
      s.px(x, y, k >= hgt - 2 ? ramp[4] : k === 0 ? ramp[1] : ramp[3]);
    }
    s.px(bx, cy + 1, ramp[0], 0.55);
  }
  return s;
}

function flowerPatch(colors: readonly string[], seed: number, count: number): Surface {
  const s = new Surface(TILE, TILE);
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r.int(2, TILE - 3);
    const y = r.int(5, TILE - 3);
    // stem
    s.px(x, y + 1, P.GRASS[1]);
    s.px(x, y + 2, P.GRASS[0]);
    // 4-petal bloom
    s.px(x, y, colors[2]);
    s.px(x - 1, y, colors[1]);
    s.px(x + 1, y, colors[1]);
    s.px(x, y - 1, colors[3]);
    if (r.chance(0.5)) s.px(x, y + 1, colors[0]);
  }
  return s;
}

function pebbles(seed: number, n: number): Surface {
  const s = new Surface(TILE, TILE);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r.int(1, TILE - 4);
    const y = r.int(1, TILE - 3);
    const w = r.int(2, 3);
    s.rect(x, y, w, 2, P.COBBLE[2]);
    s.hline(x, y, w, P.COBBLE[3]);
    s.hline(x, y + 2, w, P.OUTLINE, 0.4);
  }
  return s;
}

// ── DIRT / PATH BLOB PAINTERS ──────────────────────────────────────────────

function pathPainter(ramp: readonly string[], seed: number, style: 'dirt' | 'flag' | 'cobble') {
  return (coverage: Surface, _mask: number, r: ReturnType<typeof rng>): Surface => {
    const s = new Surface(TILE, TILE);
    const n1 = valueNoise(seed);
    const n2 = valueNoise(seed + 313);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        const v = n1(x, y, 3.4) * 0.6 + n2(x, y, 1.4) * 0.4;
        let c = ramp[2];
        if (v > 0.70) c = ramp[3];
        else if (v > 0.86) c = ramp[4];
        else if (v < 0.28) c = ramp[1];
        s.px(x, y, c);
      }
    }

    if (style === 'flag') {
      // irregular flagstones with mortar lines
      const cuts = [0, 6, 11, 16];
      for (const cy of cuts) {
        for (let x = 0; x < TILE; x++) {
          const jitter = Math.round(Math.sin((x + seed) * 0.9) * 0.6);
          s.pxOver(x, cy + jitter, ramp[0], 0.8);
        }
      }
      const stagger = [3, 9, 13];
      for (let bandIdx = 0; bandIdx < cuts.length - 1; bandIdx++) {
        const top = cuts[bandIdx], bot = cuts[bandIdx + 1];
        const sx = stagger[bandIdx % stagger.length];
        for (let x = sx; x < TILE; x += 8) {
          for (let y = top + 1; y < bot; y++) s.pxOver(x, y, ramp[0], 0.75);
        }
      }
      // highlight the top-left of each stone
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          if (s.alphaAt(x, y) === 0) continue;
          const above = s.get(x, y - 1);
          if (y > 0 && above[3] > 0 && above[0] < 90) s.px(x, y, ramp[4], 0.65);
        }
      }
    } else if (style === 'cobble') {
      const r2 = rng(seed + 17);
      for (let cy = 1; cy < TILE; cy += 4) {
        const off = (cy / 4) % 2 ? 2 : 0;
        for (let cx = off; cx < TILE; cx += 4) {
          const w = 3, h = 3;
          const tone = r2.int(1, 3);
          for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
            if (coverage.alphaAt(cx + i, cy + j) === 0) continue;
            s.px(cx + i, cy + j, ramp[tone]);
          }
          for (let i = 0; i < w; i++) s.pxOver(cx + i, cy, ramp[Math.min(4, tone + 1)]);
          for (let i = 0; i < w; i++) s.pxOver(cx + i, cy + h - 1, ramp[0], 0.6);
        }
      }
    } else {
      // dirt: wheel ruts + gravel
      speckle(s, r, 0, 0, TILE, TILE, ramp[0], 7, 0.5);
      speckle(s, r, 0, 0, TILE, TILE, ramp[4], 5, 0.45);
    }

    // Edge treatment: warm lip on top edge, dark lip elsewhere.
    const { top, bottom, side } = edgePixels(coverage);
    for (const [x, y] of top) s.px(x, y, ramp[4], 0.75);
    for (const [x, y] of bottom) s.px(x, y, ramp[0], 0.7);
    for (const [x, y] of side) s.px(x, y, ramp[1], 0.55);
    return s;
  };
}

// ── WATER ──────────────────────────────────────────────────────────────────

function waterPainter(seed: number, frame: number) {
  return (coverage: Surface, mask: number): Surface => {
    const s = new Surface(TILE, TILE);
    const n1 = valueNoise(seed);
    const phase = frame * 2.7;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        const v = n1(x, y + phase, 5.0);
        let c = P.WATER[1];
        if (v > 0.72) c = P.WATER[3];
        else if (v > 0.56) c = P.WATER[2];
        else if (v < 0.30) c = P.WATER[0];
        s.px(x, y, c);
      }
    }
    // caustic glints — short horizontal dashes that drift with the frame
    const r = rng(seed + frame * 733);
    for (let i = 0; i < 4; i++) {
      const gx = (r.int(0, TILE - 1) + frame * 3) % TILE;
      const gy = r.int(0, TILE - 1);
      if (coverage.alphaAt(gx, gy) === 0) continue;
      s.px(gx, gy, P.WATER[4]);
      if (coverage.alphaAt(gx + 1, gy)) s.px(gx + 1, gy, P.WATER[4]);
      if (coverage.alphaAt(gx + 2, gy)) s.px(gx + 2, gy, P.WATER[3]);
    }
    // Shoreline. Deep shadow under the near bank (top edge, where the land is
    // above the water) and a broken foam line only on the far/bottom shore, so
    // the river reads as having a light direction instead of a white outline.
    const { top, bottom, side } = edgePixels(coverage);
    for (const [x, y] of top) {
      s.px(x, y, P.WATER[0]);
      s.px(x, y + 1, P.WATER[0], 0.45);
    }
    for (const [x, y] of bottom) {
      const on = (x * 3 + frame * 2 + y) % 7 < 3; // broken, drifting foam
      s.px(x, y, on ? P.WATER_FOAM : P.WATER[4], on ? 0.85 : 0.45);
    }
    for (const [x, y] of side) s.px(x, y, P.WATER[3], 0.55);
    if (mask === 255) {
      // deep water: subtle darker centre so rivers have depth
      for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) s.px(x, y, P.WATER[0], 0.16);
    }
    return s;
  };
}

// ── main registration ──────────────────────────────────────────────────────

export function registerTerrain(b: ArtBuild): void {
  // Ground: grass variants (the map picks among them with hashed noise).
  for (let i = 0; i < 6; i++) b.addTile(`tile/town/grass_${i}`, grassTile(P.GRASS, 1201, i));
  for (let i = 0; i < 3; i++) b.addTile(`tile/town/grass_dry_${i}`, grassTile(P.GRASS_DRY, 1301, i));

  // Bare earth used under buildings and in the plaza.
  for (let i = 0; i < 3; i++) {
    const s = new Surface(TILE, TILE);
    mottle(s, P.DIRT, 1401 + i * 51, { scale: 3.6 });
    speckle(s, rng(1500 + i), 0, 0, TILE, TILE, P.DIRT[0], 8, 0.5);
    b.addTile(`tile/town/soil_${i}`, s);
  }

  // Overlay materials.
  registerBlobSet(b, 'blob/dirt', 2101, pathPainter(P.DIRT, 2101, 'dirt'));
  registerBlobSet(b, 'blob/path', 2201, pathPainter(P.PATH_STONE, 2201, 'flag'));
  registerBlobSet(b, 'blob/cobble', 2301, pathPainter(P.COBBLE, 2301, 'cobble'));
  registerBlobSet(b, 'blob/sand', 2401, pathPainter(P.SAND, 2401, 'dirt'), { wobble: 1.6 });

  // Water: four animation frames of the whole blob set. The runtime swaps the
  // detail layer's water tiles between these tables on a timer.
  const waterFrames: number[][] = [];
  for (let f = 0; f < 4; f++) {
    waterFrames.push(registerBlobSet(b, `blob/water_f${f}`, 3101, waterPainter(3101, f), { wobble: 0.8, radius: 5 }));
  }
  b.blobs['blob/water'] = waterFrames[0];
  b.blobFrames['blob/water'] = { frames: waterFrames, frameRate: 4 };

  // Scatter decoration.
  for (let i = 0; i < 4; i++) b.addTile(`tile/scatter/tuft_sm_${i}`, tuft(P.GRASS, 4101 + i, 'sm'));
  for (let i = 0; i < 4; i++) b.addTile(`tile/scatter/tuft_md_${i}`, tuft(P.GRASS, 4201 + i, 'md'));
  for (let i = 0; i < 3; i++) b.addTile(`tile/scatter/tuft_lg_${i}`, tuft(P.TREE_WARM, 4301 + i, 'lg'));
  for (let i = 0; i < 3; i++) b.addTile(`tile/scatter/flower_rose_${i}`, flowerPatch(P.FLOWER_ROSE, 4401 + i, 2 + i));
  for (let i = 0; i < 3; i++) b.addTile(`tile/scatter/flower_gold_${i}`, flowerPatch(P.FLOWER_GOLD, 4501 + i, 2 + i));
  for (let i = 0; i < 3; i++) b.addTile(`tile/scatter/flower_violet_${i}`, flowerPatch(P.FLOWER_VIOLET, 4601 + i, 2 + i));
  for (let i = 0; i < 3; i++) b.addTile(`tile/scatter/flower_white_${i}`, flowerPatch(P.FLOWER_WHITE, 4701 + i, 3 + i));
  for (let i = 0; i < 3; i++) b.addTile(`tile/scatter/pebbles_${i}`, pebbles(4801 + i, 2 + i));

  // Bridge planks (crosses the river; walkable).
  for (let dir = 0; dir < 2; dir++) {
    for (let v = 0; v < 2; v++) {
      const s = new Surface(TILE, TILE);
      mottle(s, P.WOOD, 5101 + v * 31, { scale: 2.8 });
      if (dir === 0) {
        for (let y = 0; y < TILE; y += 4) {
          s.hline(0, y, TILE, P.WOOD[0], 0.85);
          s.hline(0, y + 1, TILE, P.WOOD[4], 0.4);
        }
      } else {
        for (let x = 0; x < TILE; x += 4) {
          s.vline(x, 0, TILE, P.WOOD[0], 0.85);
          s.vline(x + 1, 0, TILE, P.WOOD[4], 0.4);
        }
      }
      speckle(s, rng(5200 + v), 0, 0, TILE, TILE, P.WOOD[1], 6, 0.5);
      b.addTile(`tile/bridge/${dir === 0 ? 'h' : 'v'}_${v}`, s);
    }
  }
  // Bridge rails, drawn on the "over" layer.
  for (const side of ['n', 's'] as const) {
    const s = new Surface(TILE, TILE);
    const y = side === 'n' ? 2 : 11;
    s.hline(0, y, TILE, P.WOOD[1]);
    s.hline(0, y + 1, TILE, P.WOOD[3]);
    s.hline(0, y + 2, TILE, P.WOOD[0]);
    for (let x = 1; x < TILE; x += 7) {
      s.vline(x, y, 5, P.WOOD[2]);
      s.px(x, y + 4, P.WOOD[0]);
    }
    b.addTile(`tile/bridge/rail_${side}`, s);
  }

  // Fence pieces — separate tiles so runs read as authored.
  const fence = (kind: 'h' | 'post' | 'end_l' | 'end_r') => {
    const s = new Surface(TILE, TILE);
    const top = 4;
    if (kind !== 'post') {
      s.hline(0, top + 1, TILE, P.WOOD[3]);
      s.hline(0, top + 2, TILE, P.WOOD[2]);
      s.hline(0, top + 3, TILE, P.WOOD[0], 0.8);
      s.hline(0, top + 6, TILE, P.WOOD[3]);
      s.hline(0, top + 7, TILE, P.WOOD[2]);
      s.hline(0, top + 8, TILE, P.WOOD[0], 0.8);
    }
    if (kind === 'post' || kind === 'end_l' || kind === 'end_r') {
      const px = kind === 'end_r' ? TILE - 5 : kind === 'end_l' ? 3 : 6;
      s.rect(px, top - 2, 3, 13, P.WOOD[2]);
      s.vline(px, top - 2, 13, P.WOOD[3]);
      s.vline(px + 2, top - 2, 13, P.WOOD[0]);
      s.hline(px, top - 2, 3, P.WOOD[4]);
      s.rect(px - 1, top + 11, 5, 2, P.OUTLINE, 0.28);
    }
    return s;
  };
  b.addTile('tile/fence/h', fence('h'));
  b.addTile('tile/fence/post', fence('post'));
  b.addTile('tile/fence/end_l', fence('end_l'));
  b.addTile('tile/fence/end_r', fence('end_r'));

  // A pure shadow tile used to ground buildings / trees onto terrain.
  const sh = new Surface(TILE, TILE);
  sh.fill(P.OUTLINE);
  for (let i = 0; i < TILE * TILE; i++) sh.data[i * 4 + 3] = 58;
  b.addTile('tile/fx/shadow', sh);

  const blank = new Surface(TILE, TILE);
  b.addTile('tile/blank', blank);
}

export { mottle, grassTile, tuft, flowerPatch, pathPainter };
