/**
 * Blob autotiling.
 *
 * Every "overlay" material (dirt path, stone path, water, cliff top, shrine
 * floor...) is generated as a 256-entry lookup over an 8-bit neighbour mask,
 * backed by 47 unique tiles. Callers just ask for tileFor(mask).
 *
 * Bit layout (bit set = neighbour is the SAME material):
 *   1 N   2 NE   4 E   8 SE   16 S   32 SW   64 W   128 NW
 *
 * Corner bits only count when both of their adjacent edges are also set —
 * that reduction is what collapses 256 combinations down to 47.
 */
import { Surface, valueNoise, rng } from './pixel.js';
import { TILE, type ArtBuild } from './registry.js';

export const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;

/** Collapse a raw 8-bit neighbour mask to its canonical 47-blob form. */
export function canonical(mask: number): number {
  let m = mask;
  if (!(m & N) || !(m & E)) m &= ~NE;
  if (!(m & S) || !(m & E)) m &= ~SE;
  if (!(m & S) || !(m & W)) m &= ~SW;
  if (!(m & N) || !(m & W)) m &= ~NW;
  return m;
}

/** The 47 canonical masks, in a stable order. */
export const BLOB_MASKS: number[] = (() => {
  const set = new Set<number>();
  for (let m = 0; m < 256; m++) set.add(canonical(m));
  return [...set].sort((a, b) => a - b);
})();

const HALF = TILE / 2;

/**
 * Pixel coverage mask for one blob configuration.
 *
 * `wobble` displaces the boundary by a per-pixel noise value so edges read as
 * hand-placed rather than mathematically perfect. `radius` controls how round
 * outer corners are.
 */
export function blobMask(mask: number, seed: number, opts: { wobble?: number; radius?: number } = {}): Surface {
  const wobble = opts.wobble ?? 1.15;
  const radius = opts.radius ?? 4.2;
  const noise = valueNoise(seed);
  const s = new Surface(TILE, TILE);

  const quad = (qx: number, qy: number, edgeA: number, edgeB: number, corner: number) => {
    // edgeA = vertical neighbour, edgeB = horizontal neighbour
    const hasV = (mask & edgeA) !== 0;
    const hasH = (mask & edgeB) !== 0;
    const hasC = (mask & corner) !== 0;
    for (let j = 0; j < HALF; j++) {
      for (let i = 0; i < HALF; i++) {
        // distance from the tile's outer corner of this quadrant
        const dx = qx === 0 ? i : HALF - 1 - i;
        const dy = qy === 0 ? j : HALF - 1 - j;
        const px = qx * HALF + i;
        const py = qy * HALF + j;
        const wob = (noise(px * 1.7 + seed, py * 1.7, 3.5) - 0.5) * 2 * wobble;

        let inside: boolean;
        if (hasV && hasH) {
          if (hasC) inside = true;
          else {
            // inner corner: carve a small concave notch at the very corner
            const d = Math.hypot(dx + 0.5, dy + 0.5);
            inside = d > 1.6 + wob * 0.5 || dx + dy > 2;
          }
        } else if (hasV && !hasH) {
          inside = dx >= 2 + wob; // straight edge on the horizontal side
        } else if (!hasV && hasH) {
          inside = dy >= 2 + wob; // straight edge on the vertical side
        } else {
          const d = Math.hypot(HALF - 1 - dx + 0.0, HALF - 1 - dy + 0.0);
          inside = d <= radius + wob;
        }
        if (inside) s.px(px, py, '#ffffff');
      }
    }
  };

  quad(0, 0, N, W, NW);
  quad(1, 0, N, E, NE);
  quad(0, 1, S, W, SW);
  quad(1, 1, S, E, SE);
  return s;
}

/**
 * Edge classification of a coverage mask: which pixels touch the outside.
 *
 * Pixels beyond the tile boundary count as COVERED. The mask already encodes
 * whether each neighbouring tile carries the same material, so a tile that is
 * fully covered is genuinely in the middle of the material and must get no edge
 * treatment at all. Treating the tile border as an edge puts a lit line on the
 * top row and a dark line on the bottom row of every interior tile, which draws
 * a horizontal band across the whole surface every 16 pixels — the seam artefact
 * that makes generated terrain look like a grid of stamps.
 */
export function edgePixels(mask: Surface) {
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  const side: [number, number][] = [];
  const covered = (x: number, y: number) =>
    x < 0 || y < 0 || x >= mask.w || y >= mask.h ? 1 : mask.alphaAt(x, y);
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (mask.alphaAt(x, y) === 0) continue;
      if (covered(x, y - 1) === 0) top.push([x, y]);
      else if (covered(x, y + 1) === 0) bottom.push([x, y]);
      else if (covered(x - 1, y) === 0 || covered(x + 1, y) === 0) side.push([x, y]);
    }
  }
  return { top, bottom, side };
}

/**
 * Register a complete blob set. `paint(mask, coverage, seed)` should return a
 * finished 16x16 tile. Returns a 256-entry index table mapping raw mask →
 * tileset index, ready to be serialised into art.json.
 */
export function registerBlobSet(
  b: ArtBuild,
  base: string,
  seed: number,
  paint: (coverage: Surface, mask: number, r: ReturnType<typeof rng>) => Surface,
  maskOpts?: { wobble?: number; radius?: number },
): number[] {
  const byCanonical = new Map<number, number>();
  BLOB_MASKS.forEach((m, i) => {
    const coverage = blobMask(m, seed + i * 977, maskOpts);
    const tile = paint(coverage, m, rng(seed + m * 131 + 7));
    byCanonical.set(m, b.addTile(`${base}/${i}`, tile));
  });
  const table = new Array<number>(256);
  for (let m = 0; m < 256; m++) table[m] = byCanonical.get(canonical(m))!;
  b.blobs[base] = table;
  return table;
}
