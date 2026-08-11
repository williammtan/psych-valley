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
import { Surface, rng, valueNoise, periodicNoise, rankQuantise, speckle, ditherFill } from '../lib/pixel.js';
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
 * Grass reads as a calm mid-green field, not camouflage.
 *
 * Two rules do all the work, and both are about what NOT to do:
 *
 *  1. SEAMLESS. The noise lattice wraps at the tile boundary (periodicNoise),
 *     so a tile's right edge continues into its own left edge. Non-periodic
 *     noise leaves a visible grid of seams across a field.
 *  2. TONE-MATCHED. Shades are assigned by rank (rankQuantise), so every
 *     variant contains *exactly* the same number of light and dark pixels.
 *     Threshold quantisation lets one variant come out a shade darker than its
 *     neighbour, and a field of them reads as a checkerboard — which is the
 *     single loudest "this is procedural" tell in a tileset.
 *
 * Variation between variants therefore comes only from where the marks are,
 * never from how bright the tile is overall.
 */
function grassTile(ramp: readonly string[], seed: number, variant: number): Surface {
  const s = new Surface(TILE, TILE);
  // period 4 at scale 4 → the noise repeats exactly every 16px.
  const n1 = periodicNoise(seed + variant * 977, 4);
  const n2 = periodicNoise(seed + variant * 977 + 4211, 2);

  const values: number[] = [];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      values.push(n1(x, y, 4) * 0.55 + n2(x, y, 8) * 0.45);
    }
  }
  // 7% shadow, 86% base, 7% light. A blind A/B measured our grass at 93
  // distinct colours per patch with the dominant colour holding 42.6%, against
  // the reference's 17 colours and 95.5%. Its conclusion: we were spending our
  // contrast budget on speckle while the reference spent it on shape. One
  // colour now holds the field and the marks sit on top of it.
  const bands = rankQuantise(values, [7, 86, 7]);
  const shades = [ramp[1], ramp[2], ramp[3]];
  for (let i = 0; i < values.length; i++) {
    s.px(i % TILE, Math.floor(i / TILE), shades[bands[i]]);
  }

  // Blade tips: the only place the ramp's extremes appear. Sparse, clustered,
  // two pixels tall so they read as individual blades at 4x zoom. Kept away
  // from the tile edge so they never straddle a seam.
  const r = rng(seed + variant * 313);
  if (r.chance(0.55)) {
    const cx = r.int(3, TILE - 4);
    const cy = r.int(4, TILE - 4);
    const n = r.int(2, 3);
    for (let i = 0; i < n; i++) {
      const bx = cx + r.int(-2, 2);
      const by = cy + r.int(-1, 1);
      s.px(bx, by, ramp[4]);
      s.px(bx, by - 1, ramp[3]);
    }
  }
  // One or two dark divots for grit; anything more turns into noise.
  speckle(s, rng(seed + variant * 77 + 5), 3, 3, TILE - 6, TILE - 6, ramp[0], 1, 0.3);
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
      /**
       * Irregular flagstones via a jittered cellular partition.
       *
       * The first version drew the same brick grid on every tile, so a path
       * read as one pattern stamped repeatedly — the giveaway that a texture is
       * generated rather than laid. Here each tile gets its own scattered stone
       * centres (seeded from the tile's own rng), pixels are assigned to their
       * nearest centre, and the seams between cells become mortar. Stones then
       * differ in size and shape from tile to tile while still reading as one
       * continuous surface.
       */
      const nCells = 8 + r.int(0, 3);
      const cells: Array<{ x: number; y: number; tone: number }> = [];
      for (let i = 0; i < nCells; i++) {
        cells.push({ x: r.range(-2, TILE + 2), y: r.range(-2, TILE + 2), tone: r.int(0, 3) });
      }
      const owner = new Int16Array(TILE * TILE).fill(-1);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          if (coverage.alphaAt(x, y) === 0) continue;
          let bestI = 0, bestD = Infinity;
          for (let i = 0; i < cells.length; i++) {
            const d = (cells[i].x - x) ** 2 + (cells[i].y - y) ** 2;
            if (d < bestD) { bestD = d; bestI = i; }
          }
          owner[y * TILE + x] = bestI;
          // Each stone carries its own tone so a run of them has rhythm.
          s.px(x, y, ramp[[2, 2, 3, 1][cells[bestI].tone]]);
        }
      }

      // The mortar groove: one pixel wide, on the stone's bottom/right edge only.
      const isMortar = new Uint8Array(TILE * TILE);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const o = owner[y * TILE + x];
          if (o < 0) continue;
          const right = x + 1 < TILE ? owner[y * TILE + x + 1] : o;
          const down = y + 1 < TILE ? owner[(y + 1) * TILE + x] : o;
          if (right !== o || down !== o) { isMortar[y * TILE + x] = 1; s.px(x, y, ramp[0], 0.9); }
        }
      }

      // The lit bevel goes on the stone face NEXT TO a groove, never on the
      // groove itself. Putting both on the same pixel is what makes generated
      // paving read as cracked mud rather than as cut stone.
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const i2 = y * TILE + x;
          if (owner[i2] < 0 || isMortar[i2]) continue;
          const upIsGroove = y > 0 && isMortar[i2 - TILE];
          const leftIsGroove = x > 0 && isMortar[i2 - 1];
          const upIsEdge = y === 0 && coverage.alphaAt(x, y - 1) === 0;
          const leftIsEdge = x === 0 && coverage.alphaAt(x - 1, y) === 0;
          if (upIsGroove || leftIsGroove || upIsEdge || leftIsEdge) s.px(x, y, ramp[4], 0.5);
        }
      }

      // Wear: grit in the joints, a little polish on the stone faces.
      speckle(s, r, 0, 0, TILE, TILE, ramp[1], 8, 0.35);
      speckle(s, r, 0, 0, TILE, TILE, ramp[3], 4, 0.3);
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
      /**
       * Worn earth. Two soft ruts run the length of the track with a slightly
       * lighter crown between them, plus gravel and a few embedded stones.
       * Uniform speckle alone reads as sandpaper rather than a used road.
       */
      const rutA = 4 + r.int(0, 1);
      const rutB = 10 + r.int(0, 1);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          if (coverage.alphaAt(x, y) === 0) continue;
          // Periodic in y so the ruts line up across the tile seam; a
          // non-periodic wobble makes the track jog every 16 pixels.
          const wob = Math.round(Math.sin((y / TILE) * Math.PI * 2) * 1.4);
          const dA = Math.abs(x - (rutA + wob));
          const dB = Math.abs(x - (rutB + wob));
          const d = Math.min(dA, dB);
          if (d <= 1) s.px(x, y, ramp[1], d === 0 ? 0.75 : 0.4);
          else if (d >= 4) s.px(x, y, ramp[3], 0.28);
        }
      }
      speckle(s, r, 0, 0, TILE, TILE, ramp[0], 6, 0.45);
      speckle(s, r, 0, 0, TILE, TILE, ramp[4], 4, 0.4);
      // A couple of half-buried stones per tile.
      for (let i = 0; i < r.int(0, 2); i++) {
        const sx = r.int(1, TILE - 3), sy = r.int(1, TILE - 2);
        if (coverage.alphaAt(sx, sy) === 0) continue;
        s.px(sx, sy, ramp[4], 0.8);
        s.px(sx + 1, sy, ramp[3], 0.8);
        s.px(sx, sy + 1, ramp[0], 0.55);
        s.px(sx + 1, sy + 1, ramp[0], 0.55);
      }
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

  // Bare earth used under buildings and in the plaza — same seamless,
  // tone-matched treatment as grass.
  for (let i = 0; i < 4; i++) {
    const s = new Surface(TILE, TILE);
    const n1 = periodicNoise(1401 + i * 977, 4);
    const n2 = periodicNoise(1401 + i * 977 + 51, 8);
    const values: number[] = [];
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      values.push(n1(x, y, 4) * 0.65 + n2(x, y, 2) * 0.35);
    }
    const bands = rankQuantise(values, [20, 58, 22]);
    const shades = [P.DIRT[1], P.DIRT[2], P.DIRT[3]];
    for (let k = 0; k < values.length; k++) s.px(k % TILE, Math.floor(k / TILE), shades[bands[k]]);
    speckle(s, rng(1500 + i), 2, 2, TILE - 4, TILE - 4, P.DIRT[0], 6, 0.45);
    speckle(s, rng(1560 + i), 2, 2, TILE - 4, TILE - 4, P.DIRT[4], 3, 0.35);
    b.addTile(`tile/town/soil_${i}`, s);
  }

  /**
   * Ground-variation overlays.
   *
   * Dry grass and worn turf are blob sets rather than base-tile variants for a
   * specific reason: a map author laying them as rectangles of a second base
   * family produces axis-aligned patches that read as a tiling bug. As blob
   * sets they get organic, wobbled boundaries for free, and because they carry
   * a real value difference from the base grass they give the ground plane a
   * tonal range instead of one flat field.
   */
  registerBlobSet(b, 'blob/grass_dry', 1801, (coverage, _mask, r) => {
    const s = new Surface(TILE, TILE);
    const n1 = periodicNoise(1801, 4);
    const n2 = periodicNoise(1801 + 77, 2);
    const vals: number[] = [];
    const cells: Array<[number, number]> = [];
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (coverage.alphaAt(x, y) === 0) continue;
      vals.push(n1(x, y, 4) * 0.6 + n2(x, y, 2) * 0.4);
      cells.push([x, y]);
    }
    if (vals.length) {
      const bands = rankQuantise(vals, [16, 68, 16]);
      const shades = [P.GRASS_DRY[1], P.GRASS_DRY[2], P.GRASS_DRY[3]];
      cells.forEach(([x, y], i) => s.px(x, y, shades[bands[i]]));
    }
    // Dry stalks catch the light; a few seed heads break the flat.
    for (let i = 0; i < r.int(3, 6); i++) {
      const bx = r.int(1, TILE - 2), by = r.int(2, TILE - 2);
      if (coverage.alphaAt(bx, by) === 0) continue;
      s.px(bx, by, P.GRASS_DRY[4]);
      s.px(bx, by - 1, P.GRASS_DRY[4]);
    }
    // The boundary reads as grass thinning out, not as a cut edge.
    const { top, bottom, side } = edgePixels(coverage);
    for (const [x, y] of top) s.px(x, y, P.GRASS_DRY[4], 0.6);
    for (const [x, y] of bottom) s.px(x, y, P.GRASS[0], 0.75);
    for (const [x, y] of side) s.px(x, y, P.GRASS[1], 0.5);
    return s;
  }, { wobble: 1.4, radius: 6 });

  registerBlobSet(b, 'blob/turf_worn', 1901, (coverage, _mask, r) => {
    const s = new Surface(TILE, TILE);
    const n1 = periodicNoise(1901, 4);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (coverage.alphaAt(x, y) === 0) continue;
      const v = n1(x, y, 5);
      s.px(x, y, v > 0.62 ? P.DIRT[3] : v > 0.34 ? P.DIRT[2] : P.GRASS[1]);
    }
    speckle(s, r, 1, 1, TILE - 2, TILE - 2, P.DIRT[4], 4, 0.35);
    speckle(s, r, 1, 1, TILE - 2, TILE - 2, P.GRASS[2], 5, 0.5);
    const { top, bottom } = edgePixels(coverage);
    for (const [x, y] of top) s.px(x, y, P.GRASS[2], 0.6);
    for (const [x, y] of bottom) s.px(x, y, P.DIRT[1], 0.55);
    return s;
  }, { wobble: 2.4, radius: 6 });

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
