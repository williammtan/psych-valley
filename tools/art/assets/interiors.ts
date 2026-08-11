/**
 * INTERIORS — The Lantern Inn, Sera's Workshop, the Courier Office.
 *
 * Interiors are drawn with the SNES convention: the back wall is a visible
 * vertical FACE two (or three) tiles tall, and the floor runs below it. A map
 * author encloses a room like this:
 *
 *     Lc  T T T T T T T T  Rc        <- wall_*_top,  wall_*_corner_l / _corner_r
 *     Lc  B B B D D B B B  Rc        <- wall_*_base, doorway_top / _base
 *     Lc  . . . . . . . .  Rc        <- floor family
 *     Lc  . . . . . . . .  Rc
 *     Fr  F F F F F F F F  Fr        <- wall_*_front (near wall, seen from above)
 *
 * Lighting: fire and lanterns, not the sun. Every prop is graded warm on its
 * upper-left and violet-cool on its lower-right (`finish`), which is what makes
 * a room full of brown furniture stop looking like a room full of brown boxes.
 * Props next to a registered fire source (the fireplace, the stove, the range)
 * get their light from the flame instead and are graded from below.
 */
import { Surface, rng, valueNoise, speckle, type Rng } from '../lib/pixel.js';
import { ArtBuild, TILE as T } from '../lib/registry.js';
import { registerBlobSet, edgePixels } from '../lib/autotile.js';
import * as P from '../lib/palette.js';

type Ramp = readonly string[];

// ══ shared helpers ══════════════════════════════════════════════════════════

/**
 * Low-contrast material noise. ramp[2] dominates; [1]/[3] appear as patches and
 * [0]/[4] only at the extremes. `stretchX`/`stretchY` squash the noise lattice
 * so the grain runs along one axis — that single knob is the difference between
 * "wood" and "static".
 */
function texture(
  s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number,
  opts: { scale?: number; lo?: number; hi?: number; stretchX?: number; stretchY?: number } = {},
) {
  const { scale = 3.4, lo = 0.36, hi = 0.64, stretchX = 1, stretchY = 1 } = opts;
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 733);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const px = (x + i) * stretchX, py = (y + j) * stretchY;
      const v = n1(px, py, scale) * 0.7 + n2(px, py, scale * 2.4) * 0.3;
      let c = ramp[2];
      if (v > hi + 0.17) c = ramp[4];
      else if (v > hi) c = ramp[3];
      else if (v < lo - 0.15) c = ramp[0];
      else if (v < lo) c = ramp[1];
      s.px(x + i, y + j, c);
    }
  }
}

/**
 * Wood with the grain running along `dir`. The lattice is stretched hard along
 * the grain and squashed across it, which gives long thin streaks; equal
 * stretch in both axes gives blobs, and blobs read as brickwork.
 */
function wood(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number, dir: 'h' | 'v' = 'h') {
  texture(s, x, y, w, h, ramp, seed, {
    scale: 5.0, lo: 0.42, hi: 0.58,
    stretchX: dir === 'h' ? 0.4 : 2.4,
    stretchY: dir === 'h' ? 2.4 : 0.4,
  });
}

/** Cloth: a fine 2px weave over a mottled base. Reads as fabric at 1x. */
function cloth(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number) {
  texture(s, x, y, w, h, ramp, seed, { scale: 3.0, lo: 0.34, hi: 0.66 });
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if ((i + j) % 2 === 0) s.px(x + i, y + j, ramp[3], 0.16);
      else if ((i + j) % 4 === 3) s.px(x + i, y + j, ramp[1], 0.14);
    }
  }
}

/** Metal: a hard specular column near the lit edge, fast falloff to the dark side. */
function metal(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, vertical = true) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const t = vertical ? (w === 1 ? 0.3 : i / (w - 1)) : (h === 1 ? 0.3 : j / (h - 1));
      let c = ramp[2];
      if (t < 0.14) c = ramp[3];
      else if (t < 0.3) c = ramp[4];
      else if (t < 0.52) c = ramp[3];
      else if (t > 0.86) c = ramp[0];
      else if (t > 0.68) c = ramp[1];
      s.px(x + i, y + j, c);
    }
  }
}

/** Squashed contact shadow, painted behind whatever is already on the surface. */
function contact(s: Surface, cx: number, baseY: number, w: number, h = Math.max(3, Math.round(w * 0.3)), alpha = 0.3) {
  const sh = new Surface(s.w, s.h);
  sh.ellipse(Math.round(cx - w / 2), Math.round(baseY - h + 1), w, h, P.OUTLINE, alpha);
  s.blitBehind(sh);
}

/** Soft radial warm wash over existing pixels only — glow never grows a silhouette. */
function glow(s: Surface, cx: number, cy: number, radius: number, color: string, peak = 0.5) {
  const r0 = Math.max(1, radius);
  for (let j = Math.max(0, cy - r0 | 0); j <= Math.min(s.h - 1, cy + r0 | 0); j++) {
    for (let i = Math.max(0, cx - r0 | 0); i <= Math.min(s.w - 1, cx + r0 | 0); i++) {
      const d = Math.hypot(i - cx, j - cy) / r0;
      if (d >= 1) continue;
      s.pxOver(i, j, color, peak * (1 - d) * (1 - d));
    }
  }
}

/**
 * Bake the interior light direction into a prop.
 *   'lamp'   — warm from the upper-left, violet shadow to the lower-right
 *   'hearth' — warm from below-left (it is standing next to the fire)
 *   'cold'   — the workshop: weak warmth, stronger violet
 */
function lightGrade(s: Surface, mode: 'lamp' | 'hearth' | 'cold' = 'lamp') {
  const b = s.bounds();
  if (!b.w) return s;
  const warmC = P.LANTERN[3];
  const coolC = P.SHRINE_STONE[1];
  const warmA = mode === 'hearth' ? 0.24 : mode === 'cold' ? 0.06 : 0.13;
  const coolA = mode === 'cold' ? 0.15 : 0.10;
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (s.alphaAt(i, j) === 0) continue;
      const u = (i - b.x) / Math.max(1, b.w - 1);
      const v = (j - b.y) / Math.max(1, b.h - 1);
      const t = mode === 'hearth' ? (u * 0.5 + (1 - v) * 0.5) : (u + v) / 2;
      if (t < 0.45) s.px(i, j, warmC, warmA * (0.45 - t) / 0.45);
      else if (t > 0.55) s.px(i, j, coolC, coolA * (t - 0.55) / 0.45);
    }
  }
  return s;
}

/** Standard prop finish: grade the light, then darken the lower/right silhouette. */
function finish(s: Surface, mode: 'lamp' | 'hearth' | 'cold' = 'lamp', rim = 0.4) {
  lightGrade(s, mode);
  s.innerShade(P.OUTLINE, rim, [[0, 1], [1, 0]]);
  return s;
}

/** A wooden box face: grain, a lit top-left lip and a dark bottom-right lip. */
function boardFace(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number, dir: 'h' | 'v' = 'h') {
  wood(s, x, y, w, h, ramp, seed, dir);
  s.hline(x, y, w, ramp[4], 0.55);
  s.vline(x, y, h, ramp[3], 0.45);
  s.hline(x, y + h - 1, w, ramp[0], 0.8);
  s.vline(x + w - 1, y, h, ramp[0], 0.55);
}

/**
 * Tone separation is the whole ball game indoors: a wooden wall behind a wooden
 * floor is a single brown smear unless the two are pushed apart in value.
 * `lifted` raises a ramp for floors (they catch the lamplight), `sunk` drops one
 * for walls (they are vertical, so they receive light at a glancing angle).
 */
function lifted(ramp: Ramp): string[] {
  return [ramp[1], ramp[2], ramp[3], ramp[4], P.mix(ramp[4], P.LANTERN[4], 0.4)];
}
function sunk(ramp: Ramp): string[] {
  return [P.mix(ramp[0], P.OUTLINE, 0.5), ramp[0], ramp[1], ramp[2], ramp[3]];
}

/** A single rough stone block with lit top-left and dark bottom-right. */
function stoneBlock(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, r: Rng, bias = 0) {
  const t = Math.max(1, Math.min(3, 2 + bias + r.int(-1, 1)));
  s.rect(x, y, w, h, ramp[t]);
  speckle(s, r, x, y, w, h, ramp[Math.max(0, t - 1)], Math.max(2, Math.round((w * h) / 12)), 0.4);
  speckle(s, r, x, y, w, h, ramp[Math.min(4, t + 1)], Math.max(1, Math.round((w * h) / 20)), 0.35);
  s.hline(x, y, w, ramp[Math.min(4, t + 1)], 0.8);
  s.vline(x, y, h, ramp[Math.min(4, t + 1)], 0.5);
  s.hline(x, y + h - 1, w, ramp[0], 0.75);
  s.vline(x + w - 1, y, h, ramp[0], 0.5);
}

// ══ A. FLOORS ═══════════════════════════════════════════════════════════════

/**
 * Plank floor. Board seams sit at fixed rows so a field of variants lines up;
 * only the grain, the butt joints and the wear move between variants.
 */
function woodFloorTile(base: Ramp, seed: number, variant: number): Surface {
  const ramp = lifted(base);
  const s = new Surface(T, T);
  const r = rng(seed + variant * 97);
  wood(s, 0, 0, T, T, ramp, seed + variant * 31, 'h');
  // Board seams. Soft, not black: a floor is one continuous plane and hard
  // lines every 8px turn it into brickwork.
  for (const sy of [0, 8]) {
    s.hline(0, sy, T, ramp[0], 0.55);
    s.hline(0, sy + 1, T, ramp[4], 0.22);
  }
  // Butt joints are rare — boards are long. Only half the variants carry one,
  // so a laid field shows a joint every few tiles instead of every tile.
  if (variant === 0 || variant === 2) {
    const jx = variant === 0 ? 5 : 11;
    const by = variant === 0 ? 0 : 8;
    for (let y = by + 2; y < by + 8; y++) s.px(jx, y, ramp[0], 0.55);
    s.px(jx + 1, by + 3, ramp[4], 0.2);
    s.px(jx - 3, by + 4, ramp[1], 0.5); // nail heads
    s.px(jx + 3, by + 6, ramp[1], 0.45);
  }
  if (variant === 1) {
    const kx = r.int(4, 11);
    s.ellipse(kx, 4, 3, 2, ramp[1]);
    s.px(kx + 1, 4, ramp[0], 0.6);
  }
  if (variant === 3) { // a scuffed patch where a chair is dragged back
    s.ellipse(4, 10, 8, 4, ramp[1], 0.3);
    s.hline(5, 11, 5, ramp[0], 0.2);
  }
  speckle(s, r, 0, 2, T, T - 3, ramp[1], 5, 0.24);
  return s;
}

/**
 * Flagstone. Big irregular slabs — two courses per tile, not four — so the
 * floor never reads at the same scale as the coursed stone WALL above it.
 */
function stoneFloorTile(base: Ramp, seed: number, variant: number): Surface {
  const ramp = lifted(base);
  const s = new Surface(T, T);
  const r = rng(seed + variant * 131);
  // Flags are cut, so the joints are straight. The organic part is the tone of
  // each slab, never the geometry of the grid.
  const stagger = [[2, 11], [8, 4], [13, 7], [5, 14]][variant % 4];
  for (let band = 0; band < 2; band++) {
    const top = band * 8;
    const sx = stagger[band];
    const edges = [0, sx, T];
    for (let seg = 0; seg + 1 < edges.length; seg++) {
      const x0 = edges[seg], x1 = edges[seg + 1];
      const tone = r.int(0, 2);
      texture(s, x0, top, x1 - x0, 8, [ramp[1], ramp[2], ramp[2 + (tone > 1 ? 1 : 0)], ramp[3], ramp[3]],
        seed + variant * 17 + seg * 53 + band * 11, { scale: 4.2, lo: 0.42, hi: 0.6 });
      speckle(s, r, x0, top, x1 - x0, 8, ramp[1], 4, 0.3);
      speckle(s, r, x0, top, x1 - x0, 8, ramp[4], 2, 0.25);
    }
  }
  // joints last, so nothing paints over them
  for (const jy of [0, 8]) {
    s.hline(0, jy, T, ramp[0], 0.8);
    s.hline(0, jy + 1, T, ramp[4], 0.45);
  }
  for (let band = 0; band < 2; band++) {
    const sx = stagger[band];
    for (let y = band * 8 + 2; y < band * 8 + 8; y++) {
      s.px(sx, y, ramp[0], 0.75);
      s.px(sx + 1, y, ramp[4], 0.3);
    }
  }
  if (variant === 2) { s.line(3, 4, 9, 6, ramp[0], 0.4); s.line(9, 6, 13, 5, ramp[0], 0.3); }
  if (variant === 3) speckle(s, r, 1, 10, 12, 5, ramp[0], 6, 0.25);
  return s;
}

/**
 * Kitchen tile. The checker is only two steps of one ramp with a whisper of
 * clay on the dark square: a full cream/terracotta chessboard covers a whole
 * room and shouts louder than anything standing on it.
 */
function tileFloorTile(seed: number, variant: number): Surface {
  const s = new Surface(T, T);
  const r = rng(seed + variant * 61);
  const CREAM = lifted(P.FLOOR_TILE);
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      const clay = (qx + qy) % 2 === 1;
      const x = qx * 8, y = qy * 8;
      const band: Ramp = clay
        ? [CREAM[0], CREAM[1], CREAM[1], CREAM[2], CREAM[2]]
        : [CREAM[1], CREAM[2], CREAM[3], CREAM[3], CREAM[4]];
      texture(s, x, y, 8, 8, band, seed + variant * 13 + qx * 7 + qy * 29, { scale: 2.0, lo: 0.44, hi: 0.58 });
      if (clay) for (let j = 1; j < 7; j++) for (let i = 1; i < 7; i++) s.px(x + i, y + j, P.FLOOR_TILE_CLAY[2], 0.18);
      s.hline(x + 1, y + 1, 6, CREAM[4], 0.3);   // glaze catching the light
      s.vline(x + 1, y + 1, 6, CREAM[4], 0.2);
      s.hline(x + 1, y + 6, 6, CREAM[0], 0.2);
      if (variant === 2 && !clay) s.px(x + 5, y + 4, CREAM[1], 0.4);
    }
  }
  // grout: a continuous lattice, which is what makes tiling read as tiling
  for (let i = 0; i < T; i++) {
    for (const g of [0, 7, 8, 15]) {
      s.px(i, g, P.FLOOR_TILE[0], g === 0 || g === 8 ? 0.32 : 0.2);
      s.px(g, i, P.FLOOR_TILE[0], g === 0 || g === 8 ? 0.28 : 0.18);
    }
  }
  if (variant === 3) { // a hairline crack, so the kitchen has some history
    s.line(2, 12, 7, 9, P.FLOOR_TILE[0], 0.5);
    s.line(7, 9, 11, 10, P.FLOOR_TILE[0], 0.4);
  }
  speckle(s, r, 0, 0, T, T, P.FLOOR_TILE_CLAY[1], 5, 0.18);
  return s;
}

// ══ A. WALLS ════════════════════════════════════════════════════════════════

type WallStyle = 'plaster' | 'wood' | 'stone';

const WALL_RAMP: Record<WallStyle, Ramp> = {
  plaster: sunk(P.WALL_PLASTER),
  wood: sunk(P.WALL_WOOD),
  stone: sunk(P.STONE_WALL),
};

/** The wall material itself, filling the whole tile. Vertically tileable. */
function wallField(s: Surface, style: WallStyle, seed: number) {
  const ramp = WALL_RAMP[style];
  if (style === 'plaster') {
    // Deliberately narrow value range — plaster mottled across the full ramp
    // reads as camouflage, not a wall.
    // Featureless on purpose. A `mid` tile repeats every 16px across a whole
    // wall, so the noise has to be finer than the tile: any coherent blob turns
    // into a visible grid the moment the tile is laid twice.
    texture(s, 0, 0, T, T, [ramp[1], ramp[2], ramp[2], ramp[3], ramp[3]], seed, { scale: 1.7, lo: 0.44, hi: 0.58 });
    const r = rng(seed + 5);
    speckle(s, r, 0, 0, T, T, ramp[1], 6, 0.25);
    speckle(s, r, 0, 0, T, T, ramp[3], 5, 0.22);
  } else if (style === 'wood') {
    texture(s, 0, 0, T, T, ramp, seed, { scale: 4.6, lo: 0.37, hi: 0.63, stretchX: 3.8 });
    for (let x = 0; x < T; x += 4) {
      s.vline(x, 0, T, ramp[0], 0.55);
      s.vline(x + 1, 0, T, ramp[3], 0.3);
      s.vline(x + 3, 0, T, ramp[1], 0.32);
    }
  } else {
    texture(s, 0, 0, T, T, ramp, seed, { scale: 3.0, lo: 0.4, hi: 0.66 });
    const r = rng(seed + 41);
    for (let course = 0; course < 2; course++) {
      const y = course * 8 + 1;
      const off = course % 2 ? -3 : 1;
      for (let x = off; x < T; x += 8) {
        const bw = Math.min(8, T - Math.max(0, x)) - (x < 0 ? 0 : 1);
        const bx = Math.max(0, x);
        if (bw <= 0) continue;
        stoneBlock(s, bx, y, bw, 6, ramp, r);
      }
      s.hline(0, y - 1, T, ramp[0], 0.8);
      s.hline(0, y + 6, T, ramp[0], 0.55);
    }
  }
}

/**
 * Ambient occlusion. A vertical face is lit at a glancing angle, so it loses
 * light as it descends — that gradient is most of what tells the eye "this
 * surface is standing up" rather than "this surface is lying down".
 */
function wallAO(s: Surface, part: 'top' | 'mid' | 'base') {
  if (part === 'top') for (let y = 0; y < 5; y++) s.hline(0, y, T, P.OUTLINE, 0.2 - y * 0.035);
  const from = part === 'top' ? 0.0 : part === 'mid' ? 0.06 : 0.12;
  for (let y = 0; y < T; y++) s.hline(0, y, T, P.SHRINE_STONE[1], from + (y / T) * 0.07);
}

/** Crown moulding along the top of the back wall. Timber in every style. */
function crown(s: Surface) {
  s.hline(0, 0, T, P.WOOD[0]);
  s.hline(0, 1, T, P.WOOD_LIGHT[4]);
  s.hline(0, 2, T, P.WOOD_LIGHT[2]);
  s.hline(0, 3, T, P.WOOD[0], 0.7);
  s.hline(0, 4, T, P.OUTLINE, 0.22);
  s.hline(0, 5, T, P.OUTLINE, 0.1);
}

/** Dado rail + skirting board along the bottom of the back wall. */
function skirting(s: Surface, seed: number) {
  s.hline(0, 8, T, P.WOOD_LIGHT[4], 0.85); // dado rail: 1px lit line...
  s.hline(0, 9, T, P.WOOD[0], 0.8);        // ...and its shadow
  wood(s, 0, 11, T, 5, P.WOOD, seed, 'h');
  s.hline(0, 11, T, P.WOOD_LIGHT[4], 0.9);
  s.hline(0, 12, T, P.WOOD_LIGHT[2], 0.5);
  s.hline(0, 14, T, P.WOOD[0]);
  s.hline(0, 15, T, P.OUTLINE, 0.75); // hard contact line onto the floor
}

function wallTile(style: WallStyle, part: 'top' | 'mid' | 'base', seed: number): Surface {
  const s = new Surface(T, T);
  wallField(s, style, seed);
  wallAO(s, part);
  if (part === 'top') crown(s);
  else if (part === 'base') skirting(s, seed + 3);
  return s;
}

/**
 * The soft shadow a wall throws onto the floor tile below it. Mostly
 * transparent — laid on the scatter layer over the first floor row.
 */
function floorShadow(dir: 'n' | 'w' | 'e'): Surface {
  const s = new Surface(T, T);
  if (dir === 'n') for (let y = 0; y < 5; y++) s.hline(0, y, T, P.SHRINE_STONE[0], 0.34 - y * 0.07);
  if (dir === 'w') for (let x = 0; x < 4; x++) s.vline(x, 0, T, P.SHRINE_STONE[0], 0.3 - x * 0.075);
  if (dir === 'e') for (let x = 0; x < 4; x++) s.vline(T - 1 - x, 0, T, P.SHRINE_STONE[0], 0.24 - x * 0.06);
  return s;
}

/**
 * Corner / edge columns. These are vertically tileable with no crown or
 * skirting, so a map author stacks them down both sides of the room to close
 * it: `corner_*` are the convex corners (the wall turns away from you) and
 * `inner_*` are the concave ones (an alcove).
 */
function wallCorner(style: WallStyle, kind: 'corner_l' | 'corner_r' | 'inner_l' | 'inner_r', seed: number): Surface {
  const s = new Surface(T, T);
  wallField(s, style, seed);
  const ramp = WALL_RAMP[style];
  const left = kind.endsWith('_l');
  if (kind.startsWith('corner') && style === 'stone') {
    // Stone rooms get quoins, not a timber post.
    const pw = 6;
    const px = left ? 0 : T - pw;
    const r = rng(seed + 3);
    for (let k = 0; k < 3; k++) {
      const y = k * 6 - 1;
      const w = k % 2 ? pw : pw - 2;
      stoneBlock(s, left ? 0 : T - w, y, w, 6, ramp, r, 1);
    }
    for (let y = 0; y < T; y++) {
      if (left) { s.px(px + pw, y, P.OUTLINE, 0.38); s.px(px + pw + 1, y, P.OUTLINE, 0.14); }
      else { s.px(px - 1, y, P.OUTLINE, 0.3); }
    }
  } else if (kind.startsWith('corner')) {
    // A timber corner post, proud of the wall. The left post faces into the
    // room (away from the light) so it is the darker of the two.
    const pw = 6;
    const px = left ? 0 : T - pw;
    wood(s, px, 0, pw, T, P.WOOD_LIGHT, seed + 11, 'v');
    if (left) {
      s.vline(px, 0, T, P.WOOD[1], 0.9);
      s.vline(px + 1, 0, T, P.WOOD[3], 0.8);
      s.vline(px + pw - 2, 0, T, P.WOOD[1], 0.7);
      s.vline(px + pw - 1, 0, T, P.WOOD[0]);
      for (let y = 0; y < T; y++) { s.px(px + pw, y, P.OUTLINE, 0.42); s.px(px + pw + 1, y, P.OUTLINE, 0.16); }
    } else {
      s.vline(px, 0, T, P.WOOD[0]);
      s.vline(px + 1, 0, T, P.WOOD_LIGHT[4], 0.85);
      s.vline(px + 2, 0, T, P.WOOD_LIGHT[2], 0.6);
      s.vline(px + pw - 1, 0, T, P.WOOD[1], 0.85);
      for (let y = 0; y < T; y++) { s.px(px - 1, y, P.OUTLINE, 0.34); s.px(px - 2, y, P.OUTLINE, 0.12); }
    }
    // joint pegs so the post is not a flat stripe
    for (let y = 3; y < T; y += 7) {
      s.px(px + 2, y, P.WOOD[0], 0.7);
      s.px(px + 3, y, P.WOOD_LIGHT[4], 0.4);
    }
  } else {
    // concave crease: a hard dark line with a short falloff into the room
    const cx = left ? 1 : T - 2;
    for (let d = 0; d < 5; d++) {
      const x = left ? cx + d : cx - d;
      s.vline(x, 0, T, P.OUTLINE, 0.34 - d * 0.07);
    }
    s.vline(left ? 0 : T - 1, 0, T, ramp[0], 0.85);
    s.vline(left ? 1 : T - 2, 0, T, ramp[1], 0.5);
    s.vline(left ? 6 : T - 7, 0, T, ramp[3], 0.3);
  }
  return s;
}

/** The near wall, seen from above as the top face of the wall. */
function wallFront(style: WallStyle, seed: number): Surface {
  const s = new Surface(T, T);
  const ramp = WALL_RAMP[style];
  texture(s, 0, 0, T, T, ramp, seed + 90, { scale: 4.0, lo: 0.36, hi: 0.6 });
  s.hline(0, 0, T, P.OUTLINE, 0.5);   // crease where the floor meets the wall
  s.hline(0, 1, T, ramp[0], 0.6);
  s.hline(0, 2, T, ramp[4], 0.5);     // lit top edge of the wall cap
  s.hline(0, 3, T, ramp[3], 0.35);
  if (style === 'wood') for (let x = 1; x < T; x += 4) s.vline(x, 2, T - 2, ramp[0], 0.4);
  if (style === 'stone') {
    const r = rng(seed + 7);
    for (let x = 0; x < T; x += 8) stoneBlock(s, x, 4, 8, 11, ramp, r, 1);
  }
  s.hline(0, T - 1, T, ramp[0], 0.7);
  return s;
}

/** A vertical structural timber, tileable over any wall. */
function wallBeam(seed: number): Surface {
  const s = new Surface(T, T);
  const x0 = 3, bw = 9;
  wood(s, x0, 0, bw, T, P.WOOD_LIGHT, seed, 'v');
  s.vline(x0, 0, T, P.WOOD_LIGHT[4], 0.9);
  s.vline(x0 + 1, 0, T, P.WOOD_LIGHT[3], 0.6);
  s.vline(x0 + bw - 2, 0, T, P.WOOD[1], 0.8);
  s.vline(x0 + bw - 1, 0, T, P.WOOD[0]);
  for (let y = 0; y < T; y++) { // cast shadow on the wall to its right
    s.px(x0 + bw, y, P.OUTLINE, 0.4);
    s.px(x0 + bw + 1, y, P.OUTLINE, 0.18);
  }
  const r = rng(seed);
  for (let i = 0; i < 5; i++) { // adze marks
    const y = r.int(0, T - 2);
    s.hline(x0 + 2, y, r.int(2, 4), P.WOOD[1], 0.45);
  }
  for (let y = 3; y < T; y += 11) { // iron strap
    s.hline(x0, y, bw, P.IRON[3]);
    s.hline(x0, y + 1, bw, P.IRON[1]);
    s.px(x0 + 2, y, P.IRON[4]);
    s.px(x0 + bw - 2, y + 1, P.IRON[0]);
  }
  return s;
}

// ══ A. WINDOWS, DOORWAYS, STAIRS ════════════════════════════════════════════

/**
 * A window in the wall. The timber casing covers the tile's edges so the tile
 * drops into a plaster, wood or stone wall without a seam.
 */
function windowTile(variant: number): Surface {
  const s = new Surface(T, T);
  // casing
  wood(s, 0, 0, T, T, P.WOOD, 900 + variant * 13, 'h');
  s.rect(0, 0, T, 2, P.WOOD_LIGHT[3]);
  s.hline(0, 0, T, P.WOOD_LIGHT[4]);
  s.hline(0, 2, T, P.WOOD[0], 0.8);
  s.rect(0, T - 3, T, 3, P.WOOD[2]);
  s.hline(0, T - 3, T, P.WOOD_LIGHT[4], 0.8); // lit sill
  s.hline(0, T - 1, T, P.WOOD[0]);
  s.vline(0, 0, T, P.WOOD[3], 0.7);
  s.vline(T - 1, 0, T, P.WOOD[0], 0.9);
  // glass: daylight, so it is the coolest thing in the room and the brightest
  const gx = 2, gy = 3, gw = 12, gh = 10;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const t = (i / gw) * 0.4 + (1 - j / gh) * 0.6;
      const c = t > 0.72 ? P.GLASS_CLEAR[4] : t > 0.5 ? P.GLASS_CLEAR[3] : t > 0.3 ? P.GLASS_CLEAR[2] : P.GLASS_CLEAR[1];
      s.px(gx + i, gy + j, c);
    }
  }
  if (variant === 0) {
    // four panes
    s.vline(gx + 5, gy, gh, P.WOOD[1]);
    s.vline(gx + 6, gy, gh, P.WOOD[3], 0.6);
    s.hline(gx, gy + 4, gw, P.WOOD[1]);
    s.hline(gx, gy + 5, gw, P.WOOD[3], 0.5);
  } else if (variant === 1) {
    // leaded lights: three tall panes with a transom
    for (const px of [gx + 3, gx + 7]) s.vline(px, gy, gh, P.IRON[1], 0.8);
    for (const px of [gx + 4, gx + 8]) s.vline(px, gy, gh, P.GLASS_CLEAR[4], 0.35);
    s.hline(gx, gy + 3, gw, P.IRON[1], 0.7);
    s.hline(gx, gy + 4, gw, P.GLASS_CLEAR[4], 0.3);
  } else {
    // half-open casement: the right pane is swung inward
    s.vline(gx + 6, gy, gh, P.WOOD[1]);
    s.rect(gx + 7, gy, 5, gh, P.WOOD[2]);
    boardFace(s, gx + 7, gy, 5, gh, P.WOOD, 913, 'v');
    s.rect(gx + 8, gy + 1, 3, gh - 2, P.GLASS_CLEAR[1]);
    s.px(gx + 9, gy + 2, P.GLASS_CLEAR[3]);
  }
  // daylight spill onto the sill and the wall below
  glow(s, 8, 8, 9, P.WINDOW_AMBER[4], 0.16);
  s.hline(1, T - 4, T - 2, P.GLASS_CLEAR[4], 0.25);
  return s;
}

/** A doorway cut into the back wall: `top` is the lintel, `base` the threshold. */
function doorwayTile(part: 'top' | 'mid' | 'base', lit: boolean, seed: number): Surface {
  const s = new Surface(T, T);
  const ox = 2, ow = 12;
  // the void beyond
  s.rect(ox, 0, ow, T, P.SOOT[1]);
  texture(s, ox, 0, ow, T, P.SOOT, seed + 21, { scale: 4.0, lo: 0.42, hi: 0.7 });
  for (let i = 0; i < ow; i++) { // the reveal: sides of the opening catch light
    const t = Math.min(i, ow - 1 - i);
    if (t < 2) for (let y = 0; y < T; y++) s.px(ox + i, y, i < 2 ? P.SOOT[3] : P.SOOT[0], 0.55);
  }
  if (lit) {
    // The room beyond is lit, so what you actually see through the opening is
    // its FLOOR: dark overhead, a bright band low down. An even glow top to
    // bottom reads as a lantern in an alcove, not as a door.
    for (let j = 0; j < T; j++) {
      for (let i = 0; i < ow; i++) {
        const t = 1 - Math.abs(i - (ow - 1) / 2) / (ow / 2);
        const rowT = part === 'base' ? (j - 2) / T : part === 'mid' ? (j - 12) / T : -1;
        if (rowT <= 0) continue;
        s.px(ox + i, j, P.WINDOW_AMBER[2], Math.min(1, t * 0.5 + 0.35) * rowT * 1.5);
      }
    }
    if (part === 'base') {
      for (let i = 1; i < ow - 1; i++) {
        s.px(ox + i, T - 6, P.WINDOW_AMBER[3], 0.55);
        s.px(ox + i, T - 5, P.WINDOW_AMBER[4], 0.75);
      }
    }
  }
  if (part === 'top') {
    // lintel + the shadow it drops into the opening
    wood(s, 0, 0, T, 6, P.WOOD, seed + 3, 'h');
    s.hline(0, 0, T, P.WOOD_LIGHT[4]);
    s.hline(0, 1, T, P.WOOD_LIGHT[2]);
    s.hline(0, 5, T, P.WOOD[0]);
    for (let y = 6; y < 11; y++) s.hline(ox, y, ow, P.OUTLINE, 0.5 - (y - 6) * 0.1);
  }
  if (part === 'base') {
    // worn threshold board
    wood(s, ox, T - 4, ow, 4, P.WOOD_LIGHT, seed + 9, 'h');
    s.hline(ox, T - 4, ow, P.WOOD_LIGHT[4], 0.95);
    s.hline(ox, T - 3, ow, P.WOOD_LIGHT[2], 0.6);
    s.hline(ox, T - 1, ow, P.WOOD[0]);
    for (let y = T - 9; y < T - 4; y++) s.hline(ox, y, ow, P.SOOT[0], 0.34 - (T - 5 - y) * 0.05);
  }
  // jambs: the left one faces the light, the right one is in its own shadow
  wood(s, 0, 0, ox, T, P.WOOD_LIGHT, seed, 'v');
  s.vline(0, 0, T, P.WOOD_LIGHT[4], 0.9);
  s.vline(ox - 1, 0, T, P.WOOD[0], 0.9);
  wood(s, T - ox, 0, ox, T, P.WOOD, seed + 5, 'v');
  s.vline(T - ox, 0, T, P.WOOD[0]);
  s.vline(T - 1, 0, T, P.WOOD[1], 0.8);
  return s;
}

/** Doormat — a coir rectangle on the floor tile in front of a door. */
function doormatTile(variant: number): Surface {
  const s = new Surface(T, T);
  const r = rng(1700 + variant * 31);
  const ramps: Ramp[] = [P.ROPE, P.RUG_RED, P.RUG_BLUE];
  const ramp = ramps[variant % ramps.length];
  const x = 1, y = 4, w = 14, h = 10;
  cloth(s, x, y, w, h, ramp, 1700 + variant);
  // coir weave: short alternating stitches, offset row to row
  for (let j = 0; j < h; j++) {
    for (let i = (j % 2) * 2; i < w; i += 4) {
      s.hline(x + i, y + j, 2, j % 2 ? ramp[1] : ramp[3], 0.4);
    }
  }
  s.rectOutline(x, y, w, h, ramp[1], 0.85);
  s.hline(x, y, w, ramp[4], 0.5);
  s.hline(x, y + h - 1, w, ramp[0], 0.9);
  // short bound fringe, top and bottom only
  for (let i = 0; i < w; i++) {
    if (i % 3 === 1) continue;
    s.px(x + i, y - 1, ramp[3], 0.65);
    s.px(x + i, y + h, ramp[1], 0.7);
  }
  if (variant === 1) { // worn hollow where everyone stands
    s.ellipse(4, 7, 8, 5, ramp[1], 0.35);
    s.ellipse(5, 8, 6, 3, ramp[0], 0.2);
  }
  if (variant === 2) { // a muddy bootprint, left of centre
    s.ellipse(4, 7, 3, 4, P.DIRT[1], 0.5);
    s.ellipse(4, 6, 3, 2, P.DIRT[2], 0.35);
  }
  speckle(s, r, x, y, w, h, P.DIRT[1], 5, 0.28);
  contact(s, 8, y + h + 1, 15, 3, 0.22);
  return s;
}

/**
 * A two-tile-wide staircase against the back wall. `_low`/`_high` stack
 * vertically; `up` recedes into darkness at the top, `down` opens into it at
 * the bottom.
 */
function stairsTile(dir: 'up' | 'down', half: 'l' | 'r', part: 'near' | 'far', seed: number): Surface {
  const s = new Surface(T, T);
  const left = half === 'l';
  const tread = lifted(P.FLOOR_WOOD);
  const off = part === 'far' ? 0 : T;   // this tile's offset within the 32px flight
  // Everything outside the flight is the dark space beside/under it, so the
  // treads can taper. The taper is the whole trick: parallel bands read as a
  // plank floor, converging ones read as a staircase.
  s.rect(0, 0, T, T, P.SOOT[1]);
  texture(s, 0, 0, T, T, P.SOOT, seed + 5, { scale: 4.5, lo: 0.45, hi: 0.7 });
  const inset = (gy: number) => Math.round((31 - gy) * 0.14);
  for (let y = 0; y < T; y++) {
    const gy = off + y;
    const k = Math.floor(gy / 4);          // which step
    const row = gy % 4;                    // where we are within it
    const ins = inset(gy);
    const x0 = left ? ins : 0;
    const x1 = left ? T : T - ins;
    // riser shadow, lit nosing, tread surface falling away
    const c = row === 0 ? P.OUTLINE : row === 1 ? tread[4] : row === 2 ? tread[2] : tread[0];
    const a = row === 0 ? 0.9 : row === 1 ? 1 : 0.85;
    for (let x = x0; x < x1; x++) {
      s.px(x, y, tread[2]);
      s.px(x, y, c, a);
      if (row === 2 && x > x0 + 3 && x < x1 - 3) s.px(x, y, tread[3], 0.45); // worn middle
    }
    // each step further from the room loses light
    const amt = dir === 'up' ? (7 - k) * 0.032 : k * 0.03;
    for (let x = x0; x < x1; x++) s.px(x, y, P.SHRINE_STONE[0], Math.max(0, amt));
    // the stringer, tracking the taper
    const sx = left ? x0 - 1 : x1;
    for (let d = 0; d < 3; d++) {
      const px = left ? sx - d : sx + d;
      s.px(px, y, d === 0 ? P.WOOD_LIGHT[4] : d === 1 ? P.WOOD[2] : P.WOOD[0], d === 0 ? 0.85 : 1);
    }
    s.px(left ? sx - 3 : sx + 3, y, P.OUTLINE, 0.5);
  }
  // the dark end of the flight
  if (dir === 'up' && part === 'far') {
    for (let y = 0; y < 9; y++) s.hline(0, y, T, P.SOOT[0], 0.72 - y * 0.078);
  }
  if (dir === 'down' && part === 'near') {
    for (let y = T - 9; y < T; y++) s.hline(0, y, T, P.SOOT[0], (y - (T - 10)) * 0.075);
  }
  return s;
}

// ══ RUG / FLOOR OVERLAY BLOB SETS ═══════════════════════════════════════════

/** Woven rug with a border, a repeating motif and a fringe on its outer edge. */
function rugPainter(ramp: Ramp, accent: Ramp, seed: number) {
  return (coverage: Surface, mask: number, r: Rng): Surface => {
    const s = new Surface(T, T);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        s.px(x, y, ramp[2]);
      }
    }
    cloth(s, 0, 0, T, T, ramp, seed);
    // re-clip: cloth() paints the whole rect
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      if (coverage.alphaAt(x, y) === 0) { const i = (y * T + x) * 4; s.data[i + 3] = 0; }
    }
    // motif — diamonds on an 8px lattice so neighbouring tiles continue it
    for (const [cx, cy] of [[4, 4], [12, 12]] as const) {
      for (let d = -2; d <= 2; d++) {
        const wdt = 2 - Math.abs(d);
        for (let i = -wdt; i <= wdt; i++) {
          s.pxOver(cx + i, cy + d, accent[3], 0.85);
        }
      }
      s.pxOver(cx, cy, accent[4], 0.9);
    }
    for (const [cx, cy] of [[12, 4], [4, 12]] as const) {
      s.pxOver(cx, cy - 1, ramp[4], 0.5);
      s.pxOver(cx - 1, cy, ramp[4], 0.5);
      s.pxOver(cx + 1, cy, ramp[4], 0.5);
      s.pxOver(cx, cy + 1, ramp[0], 0.5);
    }
    const { top, bottom, side } = edgePixels(coverage);
    // border band just inside every outer edge
    for (const [x, y] of [...top, ...bottom, ...side]) {
      s.px(x, y, accent[2], 0.9);
      s.px(x + (x > 7 ? -1 : 1), y, accent[1], 0.35);
    }
    for (const [x, y] of top) {
      s.px(x, y, accent[4], 0.55);
      if ((x & 1) === 1) s.px(x, y, P.CLOTH.cream[4], 0.7); // fringe
    }
    for (const [x, y] of bottom) {
      s.px(x, y, ramp[0], 0.7);
      if ((x & 1) === 0) s.px(x, y, P.CLOTH.cream[3], 0.85); // fringe
    }
    for (const [x, y] of side) s.px(x, y, ramp[1], 0.6);
    speckle(s, r, 0, 0, T, T, ramp[1], 6, 0.2);
    if (mask === 255) speckle(s, r, 4, 4, 8, 8, ramp[3], 3, 0.25);
    return s;
  };
}

/** Kitchen tiling laid over another floor — grouted edge, no fringe. */
function tileOverlayPainter(seed: number) {
  return (coverage: Surface, _mask: number, r: Rng): Surface => {
    const full = tileFloorTile(seed, 1);
    const s = new Surface(T, T);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        s.px(x, y, full.get(x, y));
      }
    }
    const { top, bottom, side } = edgePixels(coverage);
    for (const [x, y] of top) s.px(x, y, P.FLOOR_TILE[4], 0.7);
    for (const [x, y] of bottom) { s.px(x, y, P.FLOOR_TILE[0], 0.8); s.px(x, y - 1, P.FLOOR_TILE[1], 0.4); }
    for (const [x, y] of side) s.px(x, y, P.FLOOR_TILE[1], 0.6);
    speckle(s, r, 0, 0, T, T, P.FLOOR_TILE_CLAY[1], 3, 0.2);
    return s;
  };
}

// ══ B. THE LANTERN INN — FIREPLACE ══════════════════════════════════════════

/** One licking flame tongue. */
function fireTongue(s: Surface, x: number, baseY: number, h: number, w: number, phase: number) {
  for (let k = 0; k < h; k++) {
    const t = k / h;
    const ww = Math.max(0, Math.round(w * (1 - t * 0.85) * (0.72 + 0.34 * Math.sin(phase + t * 3.4))));
    const sway = Math.round(Math.sin(phase * 1.3 + t * 2.6) * t * 2.6);
    const y = baseY - k;
    for (let i = -ww; i <= ww; i++) {
      const d = ww === 0 ? 0 : Math.abs(i) / ww;
      let c: string;
      if (d < 0.36) c = t < 0.42 ? P.FIRE[4] : t < 0.75 ? P.FIRE[3] : P.FIRE[2];
      else if (d < 0.72) c = t < 0.6 ? P.FIRE[3] : P.FIRE[2];
      else c = t < 0.45 ? P.FIRE[2] : P.FIRE[1];
      s.px(x + sway + i, y, c);
    }
  }
}

/** The inn's big stone fireplace, 3x3 tiles. Frames 0..3 loop at 8fps. */
function fireplace(frame: number): Surface {
  const W = 48, H = 48;
  const s = new Surface(W, H);
  const r = rng(2200);
  const st = P.STONE_WALL;

  // ── chimney breast: coursed stone, 2..45 wide
  texture(s, 2, 0, 44, 40, st, 2201, { scale: 3.2, lo: 0.4, hi: 0.66 });
  for (let course = 0; course < 6; course++) {
    const y = course * 7;
    const off = course % 2 ? -4 : 0;
    for (let x = off; x < 46; x += 11) {
      const bx = Math.max(2, x), bw = Math.min(11, 46 - bx) - 1;
      if (bw > 1 && y + 6 <= 40) stoneBlock(s, bx, y, bw, 6, st, r);
    }
  }
  // soot staining above the firebox
  for (let y = 12; y < 20; y++) {
    for (let x = 14; x < 34; x++) {
      const t = (20 - y) / 8 * (1 - Math.abs(x - 24) / 12);
      s.pxOver(x, y, P.SOOT[0], Math.max(0, t) * 0.55);
    }
  }

  // ── firebox opening with an arched head
  const fx0 = 13, fx1 = 34, fy0 = 15, fy1 = 40;
  for (let y = fy0; y <= fy1; y++) {
    const arch = y < fy0 + 5 ? Math.round(4 - Math.sqrt(Math.max(0, 25 - (fy0 + 5 - y) * (fy0 + 5 - y)))) : 0;
    for (let x = fx0 + arch; x <= fx1 - arch; x++) s.px(x, y, P.SOOT[0]);
  }
  texture(s, fx0 + 1, fy0 + 5, fx1 - fx0 - 1, fy1 - fy0 - 5, P.SOOT, 2211, { scale: 3.4, lo: 0.45, hi: 0.75 });
  // arch voussoirs
  for (let y = fy0 - 1; y < fy0 + 6; y++) {
    const arch = Math.round(4 - Math.sqrt(Math.max(0, 25 - (fy0 + 5 - y) * (fy0 + 5 - y))));
    s.px(fx0 + arch - 1, y, st[3]);
    s.px(fx0 + arch, y, st[1], 0.7);
    s.px(fx1 - arch + 1, y, st[0]);
    s.px(fx1 - arch, y, st[1], 0.6);
  }
  s.vline(fx0 - 1, fy0 + 4, fy1 - fy0 - 3, st[4], 0.8);
  s.vline(fx1 + 1, fy0 + 4, fy1 - fy0 - 3, st[0], 0.9);

  // ── mantel: a timber slab across the whole breast
  const my = 9;
  s.rect(0, my, W, 5, P.WOOD[2]);
  wood(s, 0, my, W, 5, P.WOOD, 2221, 'h');
  s.hline(0, my, W, P.WOOD_LIGHT[4]);
  s.hline(0, my + 1, W, P.WOOD_LIGHT[2]);
  s.hline(0, my + 4, W, P.WOOD[0]);
  s.hline(1, my + 5, W - 2, P.OUTLINE, 0.35);
  s.hline(2, my + 6, W - 4, P.OUTLINE, 0.18);
  s.vline(0, my, 5, P.WOOD[3], 0.7);
  s.vline(W - 1, my, 5, P.WOOD[0]);

  // ── grate, andirons and logs
  const gy = fy1 - 5;
  for (let x = fx0 + 2; x <= fx1 - 2; x += 3) s.vline(x, gy, 5, P.IRON[2]);
  s.hline(fx0 + 2, gy, fx1 - fx0 - 3, P.IRON[3]);
  s.hline(fx0 + 2, gy + 4, fx1 - fx0 - 3, P.IRON[0]);
  const logs: Array<[number, number, number]> = [[16, 32, 15], [18, 29, 12], [21, 26, 9]];
  logs.forEach(([lx, ly, lw], i) => {
    s.rect(lx, ly, lw, 4, P.WOOD[1]);
    wood(s, lx, ly, lw, 4, P.WOOD, 2231 + i, 'h');
    s.hline(lx, ly, lw, P.WOOD[3], 0.5);
    s.hline(lx, ly + 3, lw, P.OUTLINE, 0.8);
    s.ellipse(lx - 1, ly, 3, 4, P.WOOD[0]);           // charred end grain
    s.ellipse(lx, ly + 1, 2, 2, P.WOOD[1]);
  });
  // embers under the logs
  const er = rng(2240 + frame * 13);
  for (let i = 0; i < 16; i++) {
    const ex = er.int(fx0 + 3, fx1 - 3), ey = er.int(gy - 3, gy + 1);
    s.px(ex, ey, er.chance(0.4) ? P.FIRE[4] : P.FIRE[2], 0.7 + er.next() * 0.3);
  }

  // ── flames
  const ph = frame * 1.6;
  fireTongue(s, 24, gy - 1, 15 + (frame % 2), 5, ph);
  fireTongue(s, 19, gy, 10 + ((frame + 1) % 3), 3, ph + 2.1);
  fireTongue(s, 29, gy, 11 + ((frame + 2) % 3), 3, ph + 4.2);
  fireTongue(s, 26, gy - 2, 7, 2, ph + 1.1);

  // ── the light the fire throws
  const pulse = 0.85 + 0.15 * Math.sin(frame * 1.57);
  glow(s, 24, gy - 4, 26, P.FIRE[3], 0.34 * pulse);
  glow(s, 24, gy - 2, 15, P.FIRE[4], 0.26 * pulse);

  // ── hearth slab on the floor in front
  const hy = 40;
  for (let x = 3; x < 45; x++) {
    for (let y = hy; y < H - 1; y++) s.px(x, y, st[2]);
  }
  texture(s, 3, hy, 42, H - 1 - hy, st, 2251, { scale: 3.0, lo: 0.42, hi: 0.68 });
  for (const bx of [3, 17, 31]) {
    stoneBlock(s, bx, hy, bx === 31 ? 14 : 14, H - 1 - hy, st, r, 1);
  }
  s.hline(3, hy, 42, st[4], 0.75);
  s.hline(3, H - 2, 42, st[0], 0.8);
  s.hline(4, H - 1, 40, P.OUTLINE, 0.5);
  glow(s, 24, hy + 1, 22, P.FIRE[3], 0.30 * pulse);
  glow(s, 24, hy + 2, 12, P.FIRE[4], 0.20 * pulse);

  // stone edges pick up the firelight from below
  for (let y = 14; y < 40; y++) {
    for (const x of [fx0 - 1, fx0 - 2, fx1 + 1, fx1 + 2]) {
      const t = (y - 14) / 26;
      s.pxOver(x, y, P.FIRE[3], 0.22 * t * pulse);
    }
  }

  contact(s, 24, H - 1, 46, 5, 0.32);
  s.innerShade(P.OUTLINE, 0.35, [[0, 1], [1, 0]]);
  return s;
}

// ══ B. FURNITURE KIT ════════════════════════════════════════════════════════
// Everything below is an atlas sprite anchored bottom-centre. The shared
// vocabulary — slab tops, turned legs, panelled fronts — is what stops three
// rooms of brown furniture from looking like three unrelated art passes.

/** A horizontal slab seen in three-quarter: lit top face + a front edge. */
function slab(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number, edge = 3) {
  wood(s, x, y, w, h, ramp, seed, 'h');
  s.hline(x, y, w, ramp[4], 0.9);
  s.vline(x, y, h, ramp[3], 0.55);
  s.vline(x + w - 1, y, h, ramp[1], 0.5);
  const dark: Ramp = [ramp[0], ramp[0], ramp[1], ramp[2], ramp[3]];
  wood(s, x, y + h, w, edge, dark, seed + 3, 'h');
  s.hline(x, y + h, w, ramp[3], 0.6);
  s.hline(x, y + h + edge - 1, w, P.OUTLINE, 0.85);
}

/** A turned leg. */
function leg(s: Surface, x: number, topY: number, h: number, ramp: Ramp, w = 3) {
  s.rect(x, topY, w, h, ramp[2]);
  s.vline(x, topY, h, ramp[3], 0.8);
  s.vline(x + w - 1, topY, h, ramp[0], 0.9);
  for (let y = topY + 2; y < topY + h; y += 5) s.hline(x, y, w, ramp[1], 0.5);
  s.hline(x, topY + h - 1, w, P.OUTLINE, 0.7);
}

/** A panelled front — the standard face of a counter, dresser or wardrobe. */
function panelFront(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number, cols = 2) {
  wood(s, x, y, w, h, ramp, seed, 'v');
  s.hline(x, y, w, ramp[4], 0.8);
  s.vline(x, y, h, ramp[3], 0.6);
  s.hline(x, y + h - 1, w, P.OUTLINE, 0.85);
  s.vline(x + w - 1, y, h, ramp[0], 0.8);
  const pw = Math.floor((w - 2) / cols);
  for (let c = 0; c < cols; c++) {
    const px = x + 1 + c * pw + 1;
    const pwid = pw - 3;
    if (pwid < 2) continue;
    s.rectOutline(px, y + 2, pwid, h - 5, ramp[0], 0.7);
    s.hline(px + 1, y + 3, pwid - 2, ramp[4], 0.4);
    s.vline(px + 1, y + 3, h - 7, ramp[3], 0.3);
    s.hline(px + 1, y + h - 4, pwid - 2, ramp[1], 0.5);
  }
}

/** The shadow a wall-hung object drops onto the wall behind it. */
function wallShadow(s: Surface, dx = 1, dy = 2, alpha = 0.3) {
  const sil = s.clone().tint(P.OUTLINE, 1);
  const out = new Surface(s.w, s.h);
  out.blit(sil, dx, dy, alpha);
  out.blit(s);
  s.clear();
  s.blit(out);
  return s;
}

/** A drinking vessel, 5x7, on a surface. */
function mug(s: Surface, x: number, y: number, ramp: Ramp = P.CERAMIC, fill: 'full' | 'half' | 'empty' = 'full') {
  s.rect(x, y + 1, 5, 6, ramp[2]);
  s.vline(x, y + 1, 6, ramp[3]);
  s.vline(x + 4, y + 1, 6, ramp[0]);
  s.hline(x, y + 6, 5, P.OUTLINE, 0.7);
  s.hline(x, y, 5, ramp[4]);        // rim
  s.px(x + 5, y + 2, ramp[1]);      // handle
  s.px(x + 5, y + 3, ramp[2]);
  s.px(x + 5, y + 4, ramp[0]);
  if (fill !== 'empty') {
    const d = fill === 'full' ? 1 : 3;
    s.hline(x + 1, y + d, 3, P.WOOD[2]);
    if (fill === 'full') { s.hline(x + 1, y, 3, P.CLOTH.cream[4]); s.px(x + 2, y - 1, P.CLOTH.cream[3]); }
  }
}

/** A bottle standing on a shelf. */
function bottle(s: Surface, x: number, baseY: number, h: number, ramp: Ramp, cork = true) {
  const bw = 3;
  s.rect(x, baseY - h + 3, bw, h - 3, ramp[2]);
  s.vline(x, baseY - h + 3, h - 3, ramp[3]);
  s.vline(x + bw - 1, baseY - h + 3, h - 3, ramp[0]);
  s.px(x + 1, baseY - h + 4, ramp[4]);
  s.vline(x + 1, baseY - h, 3, ramp[1]); // neck
  s.px(x + 1, baseY - h + 2, ramp[2]);
  if (cork) s.px(x + 1, baseY - h - 1, P.WOOD_LIGHT[3]);
  s.hline(x, baseY, bw, P.OUTLINE, 0.6);
}

/** A row of book spines. */
function books(s: Surface, x: number, y: number, w: number, h: number, seed: number, lean = true) {
  const r = rng(seed);
  const spines: Ramp[] = [P.ROOF_RED, P.ROOF_TEAL, P.ROOF_BLUE, P.ROOF_PLUM, P.LEATHER,
    P.CLOTH.mira, P.CLOTH.nia, P.CLOTH.oren, P.UI_PARCHMENT, P.WOOD_LIGHT];
  let cx = x;
  while (cx < x + w - 1) {
    const bw = r.int(2, 3);
    if (cx + bw > x + w) break;
    const bh = h - r.int(0, 2);
    const ramp = r.pick(spines);
    const top = y + (h - bh);
    s.rect(cx, top, bw, bh, ramp[2]);
    s.vline(cx, top, bh, ramp[3]);
    s.vline(cx + bw - 1, top, bh, ramp[0]);
    s.hline(cx, top, bw, ramp[4], 0.8);
    if (r.chance(0.45)) { // gilt band
      s.hline(cx, top + 2, bw, P.UI_GOLD[3], 0.75);
      s.hline(cx, top + bh - 3, bw, P.UI_GOLD[2], 0.5);
    }
    cx += bw;
  }
  if (lean && cx < x + w - 3) { // one book leaning into the gap
    const ramp = r.pick(spines);
    for (let k = 0; k < h - 2; k++) {
      const px = cx + Math.round(k * 0.45);
      s.hline(px, y + h - 1 - k, 3, ramp[2]);
      s.px(px, y + h - 1 - k, ramp[3]);
      s.px(px + 2, y + h - 1 - k, ramp[0]);
    }
  }
  s.hline(x, y + h, w, P.OUTLINE, 0.55);
}

/** A stack of papers with the top sheet askew. */
function papers(s: Surface, x: number, y: number, w: number, n: number, seed: number) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const ox = r.int(-1, 1);
    const yy = y + n - 1 - k;
    s.hline(x + ox, yy, w, P.UI_PARCHMENT[k === n - 1 ? 4 : 3]);
    s.px(x + ox, yy, P.UI_PARCHMENT[2]);
    s.px(x + ox + w - 1, yy, P.UI_PARCHMENT[1]);
  }
  s.hline(x - 1, y + n, w + 1, P.OUTLINE, 0.5);
}

// ── The Lantern Inn ─────────────────────────────────────────────────────────

function innTableRound(dressed: boolean): Surface {
  const s = new Surface(32, 30);
  contact(s, 16, 29, 26, 6, 0.3);
  const R = P.WOOD_LIGHT;
  // splayed feet, then a slim turned pedestal
  for (const [fx, fw] of [[3, 9], [20, 9]] as const) {
    s.rect(fx, 24, fw, 3, P.WOOD[1]);
    s.hline(fx, 24, fw, P.WOOD[3], 0.7);
    s.hline(fx, 26, fw, P.OUTLINE, 0.85);
  }
  leg(s, 14, 15, 11, P.WOOD, 4);
  s.rect(12, 20, 8, 2, P.WOOD[1]);   // collar
  s.hline(12, 20, 8, P.WOOD[3], 0.7);
  // the top: a thin disc, so it reads as a table and not a drum
  s.ellipse(2, 9, 28, 8, P.WOOD[0]);          // the edge, seen below the top
  s.ellipse(2, 8, 28, 8, P.WOOD[1]);
  s.ellipse(2, 4, 28, 10, R[2]);
  const grain = new Surface(32, 30);
  wood(grain, 2, 4, 28, 10, R, 3301, 'h');
  s.blitInside(grain, 0, 0, 1);
  const inner = new Surface(32, 30);
  inner.ellipse(2, 4, 28, 10, '#ffffff');
  for (let y = 4; y < 14; y++) for (let x = 2; x < 30; x++) {
    if (inner.alphaAt(x, y) === 0) continue;
    if (inner.alphaAt(x, y - 1) === 0) s.px(x, y, R[4], 0.9);        // lit far rim
    else if (inner.alphaAt(x, y + 1) === 0) s.px(x, y, R[0], 0.7);   // near rim
    else if (inner.alphaAt(x - 1, y) === 0) s.px(x, y, R[3], 0.6);
    else if (inner.alphaAt(x + 1, y) === 0) s.px(x, y, R[1], 0.6);
  }
  s.ellipse(8, 6, 14, 5, R[3], 0.25); // a soft sheen where the lamp hits it
  if (dressed) {
    // a table nobody has cleared: two mugs, a plate of crumbs, a dropped knife
    s.ellipse(11, 8, 9, 4, P.CERAMIC[2]);
    s.ellipse(12, 8, 7, 3, P.CERAMIC[4]);
    s.px(14, 9, P.THATCH[2]); s.px(16, 9, P.THATCH[1]);
    s.hline(18, 11, 5, P.IRON[3]);
    s.hline(18, 12, 5, P.IRON[1]);
    s.hline(21, 11, 3, P.WOOD[2]);
    mug(s, 6, 5, P.CERAMIC, 'half');
    mug(s, 21, 6, P.CERAMIC, 'empty');
  }
  return finish(s, 'lamp');
}

function innTableLong(): Surface {
  const s = new Surface(48, 32);
  contact(s, 24, 31, 42, 6, 0.3);
  const R = P.WOOD_LIGHT;
  leg(s, 4, 18, 12, P.WOOD, 4);
  leg(s, 40, 18, 12, P.WOOD, 4);
  leg(s, 14, 16, 8, P.WOOD, 3);
  leg(s, 31, 16, 8, P.WOOD, 3);
  s.rect(3, 20, 42, 2, P.WOOD[1], 0.9); // stretcher
  s.hline(3, 20, 42, P.WOOD[3], 0.5);
  slab(s, 1, 6, 46, 12, R, 3311, 4);
  // plank seams across the top
  for (const y of [10, 14]) {
    s.hline(1, y, 46, R[0], 0.5);
    s.hline(1, y + 1, 46, R[4], 0.25);
  }
  // a bench-worn dip and two dropped items
  s.ellipse(18, 9, 12, 5, R[3], 0.3);
  mug(s, 6, 8, P.CERAMIC, 'full');
  mug(s, 36, 10, P.CERAMIC, 'half');
  s.rect(24, 11, 7, 4, P.UI_PARCHMENT[3]);      // an open ledger
  s.rect(24, 11, 7, 1, P.UI_PARCHMENT[4]);
  s.vline(27, 11, 4, P.LEATHER[1]);
  for (let i = 0; i < 3; i++) s.hline(25, 12 + i, 2, P.UI_INK_SOFT, 0.55);
  return finish(s, 'lamp');
}

function innChair(view: 'n' | 's' | 'e' | 'pushed'): Surface {
  const s = new Surface(view === 'pushed' ? 18 : 15, 26);
  // Light wood, because a chair against a wooden floor has to win on value —
  // a dark chair on a warm floor just reads as a hole.
  const R = P.WOOD_LIGHT;
  const cx = s.w / 2;
  contact(s, cx, 23, s.w - 2, 5, 0.28);
  const tilt = view === 'pushed' ? 1 : 0;
  const backX = 2 + tilt;
  if (view === 'e') {
    // side view: back on the left, seat running right
    leg(s, 3, 16, 9, R);
    leg(s, 10, 17, 8, R);
    s.rect(2, 13, 12, 4, P.WOOD_LIGHT[2]);
    wood(s, 2, 13, 12, 4, P.WOOD_LIGHT, 3324, 'h');
    s.hline(2, 13, 12, P.WOOD_LIGHT[4], 0.95);
    s.hline(2, 16, 12, P.OUTLINE, 0.85);
    s.rect(2, 2, 4, 12, R[2]);
    wood(s, 2, 2, 4, 12, R, 3325, 'v');
    s.vline(2, 2, 12, R[4], 0.9);
    s.vline(5, 2, 12, R[0]);
    s.hline(2, 2, 4, R[4]);
    s.hline(1, 3, 5, R[3], 0.6);
  } else {
    // backrest: two turned splats with narrow gaps, so the silhouette is a
    // chair rather than a board, without punching a big dark hole in it
    const bw = 11;
    s.rect(backX, 1, bw, 11, R[2]);
    wood(s, backX, 1, bw, 11, R, 3321, 'v');
    s.hline(backX, 1, bw, R[4], 0.95);
    s.hline(backX, 2, bw, R[3], 0.7);
    s.vline(backX, 1, 11, R[3], 0.85);
    s.vline(backX + bw - 1, 1, 11, R[0]);
    for (const gx of [backX + 3, backX + 7]) {
      s.vline(gx, 4, 6, P.OUTLINE, 0.75);
      s.vline(gx + 1, 4, 6, R[4], 0.35);
    }
    s.hline(backX, 10, bw, R[1], 0.7);
    s.hline(backX + 1, 12, bw - 2, R[0], 0.85);
    // seat
    const sy = view === 'n' ? 13 : 14;
    s.rect(1 + tilt, sy, 13, 5, P.WOOD_LIGHT[2]);
    wood(s, 1 + tilt, sy, 13, 5, P.WOOD_LIGHT, 3322, 'h');
    s.hline(1 + tilt, sy, 13, P.WOOD_LIGHT[4], 0.95);
    s.hline(1 + tilt, sy + 1, 13, P.WOOD_LIGHT[3], 0.5);
    s.hline(1 + tilt, sy + 4, 13, P.OUTLINE, 0.9);
    if (view === 's') { // a cushion, tied at the corners
      s.rect(3, sy - 1, 9, 4, P.RUG_RED[2]);
      cloth(s, 3, sy - 1, 9, 4, P.RUG_RED, 3323);
      s.hline(3, sy - 1, 9, P.RUG_RED[4], 0.8);
      s.hline(3, sy + 2, 9, P.RUG_RED[0], 0.85);
      s.px(3, sy - 1, P.UI_GOLD[3]); s.px(11, sy - 1, P.UI_GOLD[2]);
    }
    leg(s, 2 + tilt, sy + 5, 26 - sy - 6, R);
    leg(s, 10 + tilt, sy + 5, 26 - sy - 6, R);
  }
  return finish(s, 'lamp');
}

function innBench(): Surface {
  const s = new Surface(32, 20);
  contact(s, 16, 19, 28, 5, 0.28);
  leg(s, 3, 12, 7, P.WOOD, 4);
  leg(s, 25, 12, 7, P.WOOD, 4);
  s.rect(2, 12, 28, 2, P.WOOD[1], 0.8);
  slab(s, 1, 6, 30, 6, P.WOOD_LIGHT, 3331, 3);
  s.hline(1, 9, 30, P.WOOD_LIGHT[0], 0.45);
  s.hline(1, 10, 30, P.WOOD_LIGHT[4], 0.2);
  // worn hollows where two people always sit
  s.ellipse(5, 7, 9, 4, P.WOOD_LIGHT[3], 0.28);
  s.ellipse(19, 7, 9, 4, P.WOOD_LIGHT[3], 0.28);
  return finish(s, 'lamp');
}

function innBar(part: 'l' | 'mid' | 'r'): Surface {
  const s = new Surface(16, 30);
  contact(s, 8, 29, 15, 5, 0.3);
  const R = P.WOOD;
  // A solid boarded front, not a panel frame: at 16px wide a panel outline
  // turns three bar pieces into a garden fence.
  s.rect(0, 10, 16, 18, R[2]);
  wood(s, 0, 10, 16, 18, R, 3341 + part.length, 'v');
  for (let x = 0; x < 16; x += 4) {
    s.vline(x, 10, 18, R[0], 0.6);
    s.vline(x + 1, 10, 18, R[3], 0.3);
  }
  s.hline(0, 10, 16, R[4], 0.6);
  s.hline(0, 27, 16, P.OUTLINE, 0.95);
  // a single rail across the front, then the brass foot rail and a kick board
  s.hline(0, 17, 16, R[3], 0.75);
  s.hline(0, 18, 16, P.OUTLINE, 0.6);
  s.hline(0, 22, 16, P.BRONZE[3], 0.9);
  s.hline(0, 23, 16, P.BRONZE[1], 0.8);
  s.rect(0, 25, 16, 3, R[1]);
  s.hline(0, 25, 16, R[3], 0.5);
  // counter top with a bullnose overhang, a full step lighter than the front
  slab(s, 0, 4, 16, 6, P.WOOD_LIGHT, 3345, 3);
  s.hline(0, 4, 16, P.WOOD_LIGHT[4]);
  s.hline(0, 5, 16, P.WOOD_LIGHT[3], 0.6);
  s.hline(0, 12, 16, P.OUTLINE, 0.35); // the overhang's shadow on the front
  if (part === 'l') {
    s.vline(0, 4, 26, P.WOOD_LIGHT[4], 0.7);
    s.vline(1, 10, 18, P.WOOD_LIGHT[3], 0.4);
  }
  if (part === 'r') {
    s.vline(15, 4, 26, P.WOOD[0]);
    s.vline(14, 10, 18, P.WOOD[0], 0.5);
  }
  if (part === 'mid') { // pump handles and a cloth over the rail
    s.rect(6, 0, 2, 6, P.BRONZE[2]);
    s.vline(6, 0, 6, P.BRONZE[4]);
    s.vline(7, 0, 6, P.BRONZE[0]);
    s.rect(5, 0, 4, 2, P.BRONZE[3]);
    s.px(5, 0, P.BRONZE[4]);
    s.rect(10, 2, 4, 4, P.LINEN[3]);
    cloth(s, 10, 2, 4, 4, P.LINEN, 3346);
    s.hline(10, 5, 4, P.LINEN[0], 0.6);
  }
  return finish(s, 'lamp');
}

function innStool(): Surface {
  const s = new Surface(12, 20);
  contact(s, 6, 19, 11, 4, 0.28);
  leg(s, 1, 9, 10, P.WOOD, 2);
  leg(s, 9, 9, 10, P.WOOD, 2);
  leg(s, 5, 10, 9, P.WOOD, 2);
  s.hline(1, 15, 10, P.WOOD[1], 0.8); // stretcher
  s.ellipse(0, 4, 12, 7, P.WOOD_LIGHT[2]);
  const g = new Surface(12, 20);
  wood(g, 0, 4, 12, 7, P.WOOD_LIGHT, 3351, 'h');
  s.blitInside(g);
  s.ellipseOutline(0, 4, 12, 7, P.WOOD_LIGHT[0], 0.6);
  for (let i = 0; i < 8; i++) s.px(2 + i, 4, P.WOOD_LIGHT[4], 0.9);
  s.ellipse(3, 6, 6, 3, P.WOOD_LIGHT[3], 0.3);
  return finish(s, 'lamp');
}

function innShelf(kind: 'bottles' | 'mugs' | 'crocks'): Surface {
  const s = new Surface(32, 24);
  const R = P.WOOD;
  // brackets
  for (const bx of [2, 27]) {
    s.rect(bx, 16, 3, 6, R[1]);
    s.line(bx + 2, 16, bx + 2, 21, R[0]);
    s.vline(bx, 16, 6, R[3], 0.6);
  }
  slab(s, 0, 13, 32, 3, P.WOOD_LIGHT, 3361, 2);
  const r = rng(3362 + kind.length);
  if (kind === 'bottles') {
    const ramps: Ramp[] = [P.GLASS_GREEN, P.GLASS_CLEAR, P.COPPER, P.GLASS_GREEN, P.WOOD_LIGHT, P.GLASS_CLEAR];
    let x = 2;
    for (let i = 0; i < 7 && x < 29; i++) {
      const h = r.int(8, 12);
      bottle(s, x, 12, h, r.pick(ramps));
      x += r.int(4, 5);
    }
  } else if (kind === 'mugs') {
    // pewter tankards, stacked two deep so the shelf has depth
    for (let i = 0; i < 4; i++) {
      const x = 2 + i * 7, tall = i % 2 === 0;
      const h = tall ? 8 : 6;
      s.rect(x, 12 - h, 5, h, P.CERAMIC[2]);
      metal(s, x, 12 - h, 5, h, P.CERAMIC);
      s.hline(x, 12 - h, 5, P.CERAMIC[4]);
      s.hline(x - 1, 12 - h, 7, P.CERAMIC[3], 0.8);
      s.hline(x, 11, 5, P.OUTLINE, 0.7);
      s.px(x + 5, 12 - h + 2, P.CERAMIC[1]);
      s.px(x + 5, 12 - h + 3, P.CERAMIC[2]);
      s.px(x + 5, 12 - h + 4, P.CERAMIC[0]);
    }
    // one hanging from a hook under the shelf
    s.px(24, 16, P.IRON[2]);
    s.px(24, 17, P.IRON[1]);
    mug(s, 22, 18, P.CERAMIC, 'empty');
  } else {
    for (let i = 0; i < 3; i++) {
      const x = 3 + i * 9, h = r.int(7, 10);
      s.rect(x, 12 - h, 7, h, P.TERRACOTTA[2]);
      s.vline(x, 12 - h, h, P.TERRACOTTA[3]);
      s.vline(x + 6, 12 - h, h, P.TERRACOTTA[0]);
      s.hline(x - 1, 12 - h, 9, P.TERRACOTTA[3]);
      s.hline(x - 1, 12 - h + 1, 9, P.TERRACOTTA[1]);
      s.hline(x, 11, 7, P.OUTLINE, 0.6);
      s.hline(x + 1, 12 - h + 4, 5, P.CLOTH.cream[3], 0.5); // label
    }
  }
  wallShadow(s, 1, 2, 0.3);
  return finish(s, 'lamp');
}

function innPotsHanging(): Surface {
  const s = new Surface(34, 22);
  // a substantial iron rail, not a hairline
  s.rect(0, 2, 34, 3, P.IRON[2]);
  s.hline(0, 2, 34, P.IRON[4], 0.9);
  s.hline(0, 4, 34, P.IRON[0]);
  s.rect(0, 1, 3, 5, P.IRON[3]);   // the brackets it hangs from
  s.rect(31, 1, 3, 5, P.IRON[1]);
  const pans: Array<[number, number, number, Ramp, boolean]> = [
    [4, 11, 10, P.COPPER, true],
    [15, 9, 8, P.COPPER, false],
    [24, 12, 9, P.IRON, true],
  ];
  for (const [x, d, hang, ramp, handle] of pans) {
    const cx = x + d / 2;
    // the hook: a visible S over the rail
    s.vline(Math.round(cx), 5, hang - d + 1, P.IRON[2]);
    s.px(Math.round(cx) - 1, 1, P.IRON[3]);
    s.px(Math.round(cx), 0, P.IRON[4]);
    s.px(Math.round(cx) + 1, 1, P.IRON[1]);
    // the pan: a disc seen face-on, with a rim and a bowl
    const y = hang - d + 1;
    s.ellipse(x, y, d, d, ramp[1]);
    s.ellipse(x + 1, y + 1, d - 2, d - 2, ramp[2]);
    s.ellipse(x + 1, y + 1, d - 4, d - 4, ramp[3]);
    s.ellipse(x + 2, y + 2, Math.max(2, d - 7), Math.max(2, d - 7), ramp[4], 0.75);
    s.ellipseOutline(x, y, d, d, ramp[0], 0.85);
    s.ellipseOutline(x + 1, y + 1, d - 2, d - 2, ramp[4], 0.35);
    // hammer marks
    for (let k = 0; k < 4; k++) s.px(x + 3 + (k % 2) * 3, y + 4 + k, ramp[1], 0.4);
    if (handle) { // a riveted handle sticking out to the right
      s.hline(x + d - 1, y + Math.floor(d / 2), 5, P.IRON[3]);
      s.hline(x + d - 1, y + Math.floor(d / 2) + 1, 5, P.IRON[0]);
      s.px(x + d + 3, y + Math.floor(d / 2), P.IRON[4]);
    }
  }
  wallShadow(s, 1, 2, 0.28);
  return finish(s, 'lamp');
}

function innRange(frame: number): Surface {
  const s = new Surface(32, 36);
  contact(s, 16, 35, 30, 5, 0.32);
  // cast iron body
  s.rect(1, 12, 30, 22, P.IRON[2]);
  texture(s, 1, 12, 30, 22, P.IRON, 3381, { scale: 4.0, lo: 0.42, hi: 0.62 });
  s.hline(1, 12, 30, P.IRON[4], 0.8);
  s.vline(1, 12, 22, P.IRON[3], 0.7);
  s.vline(30, 12, 22, P.IRON[0]);
  s.hline(1, 33, 30, P.OUTLINE, 0.9);
  // fire door with a grille of light
  s.rect(4, 18, 13, 11, P.IRON[1]);
  s.rectOutline(4, 18, 13, 11, P.IRON[3], 0.8);
  s.rect(6, 20, 9, 7, P.SOOT[0]);
  for (let k = 0; k < 3; k++) {
    const on = (frame + k) % 4 !== 3;
    s.hline(6, 21 + k * 2, 9, on ? P.FIRE[3] : P.FIRE[1], on ? 0.95 : 0.7);
    s.hline(6, 22 + k * 2, 9, P.FIRE[1], 0.4);
  }
  s.px(16, 23, P.BRONZE[3]); s.px(17, 23, P.BRONZE[4]); // handle
  glow(s, 10, 24, 12, P.FIRE[3], 0.3);
  // hot plate + soup pot
  s.rect(0, 8, 32, 5, P.IRON[3]);
  s.hline(0, 8, 32, P.IRON[4]);
  s.hline(0, 12, 32, P.IRON[0]);
  s.ellipse(19, 9, 10, 3, P.IRON[1]);
  const pot = P.COPPER;
  s.rect(18, 2, 12, 8, pot[2]);
  metal(s, 18, 2, 12, 8, pot);
  s.ellipse(17, 0, 14, 4, pot[3]);
  s.ellipse(18, 1, 12, 3, pot[4], 0.6);
  s.hline(18, 9, 12, P.OUTLINE, 0.8);
  s.px(17, 4, pot[1]); s.px(30, 4, pot[0]);
  // steam, drifting on the frame counter
  const sr = rng(3390 + frame * 17);
  for (let i = 0; i < 5; i++) {
    const sx = 20 + sr.int(0, 8);
    const sy = sr.int(0, 3) - frame % 2;
    s.px(sx, sy, P.LINEN[3], 0.4);
    s.px(sx + 1, sy - 1, P.LINEN[4], 0.28);
  }
  // a kettle keeping warm on the left
  s.ellipse(3, 4, 10, 6, P.IRON[2]);
  s.ellipse(4, 4, 8, 4, P.IRON[3], 0.9);
  s.px(2, 4, P.IRON[4]);
  s.hline(6, 1, 3, P.IRON[3]); // handle
  s.px(5, 2, P.IRON[2]); s.px(9, 2, P.IRON[1]);
  s.hline(11, 5, 3, P.IRON[1]); // spout
  glow(s, 12, 26, 20, P.FIRE[2], 0.16);
  return finish(s, 'hearth');
}

function innBreadRack(): Surface {
  const s = new Surface(24, 34);
  contact(s, 12, 33, 22, 5, 0.3);
  // frame
  for (const x of [1, 21]) { s.rect(x, 2, 2, 30, P.WOOD[2]); s.vline(x, 2, 30, P.WOOD[3], 0.8); s.vline(x + 1, 2, 30, P.WOOD[0]); }
  const r = rng(3401);
  for (let k = 0; k < 3; k++) {
    const y = 8 + k * 9;
    slab(s, 0, y, 24, 2, P.WOOD_LIGHT, 3402 + k, 2);
    // loaves
    let x = 2;
    while (x < 20) {
      const w = r.int(5, 7);
      const h = r.int(4, 6);
      const ramp = r.chance(0.4) ? P.WOOD_LIGHT : P.THATCH;
      s.ellipse(x, y - h, w, h + 2, ramp[2]);
      s.ellipse(x + 1, y - h, w - 2, h, ramp[3]);
      s.ellipse(x + 1, y - h, w - 3, h - 2, ramp[4], 0.7);
      for (let c = 0; c < 2; c++) s.px(x + 2 + c * 2, y - h + 2, ramp[1]); // slashes
      s.hline(x, y - 1, w, P.OUTLINE, 0.5);
      x += w + 1;
    }
  }
  return finish(s, 'lamp');
}

function innBarrel(stack: boolean): Surface {
  const s = new Surface(stack ? 24 : 16, stack ? 30 : 22);
  const drawOne = (x: number, baseY: number, w: number, h: number, seed: number) => {
    const R = P.WOOD;
    s.rect(x, baseY - h, w, h, R[2]);
    wood(s, x, baseY - h, w, h, R, seed, 'v');
    // stave curvature
    for (let i = 0; i < w; i++) {
      const t = Math.abs(i - (w - 1) / 2) / ((w - 1) / 2);
      const c = t < 0.25 ? R[4] : t < 0.5 ? R[3] : t < 0.8 ? R[2] : R[0];
      for (let j = 0; j < h; j++) s.px(x + i, baseY - h + j, c, 0.55);
    }
    for (const hy of [baseY - h + 2, baseY - 3]) { // iron hoops
      s.hline(x, hy, w, P.IRON[3]);
      s.hline(x, hy + 1, w, P.IRON[0]);
      s.px(x + 2, hy, P.IRON[4]);
    }
    s.ellipse(x - 1, baseY - h - 2, w + 2, 5, R[3]);   // lid
    s.ellipse(x, baseY - h - 1, w, 3, R[4], 0.5);
    s.ellipseOutline(x - 1, baseY - h - 2, w + 2, 5, R[0], 0.8);
    s.hline(x, baseY - 1, w, P.OUTLINE, 0.8);
  };
  if (stack) {
    contact(s, 12, 29, 22, 5, 0.3);
    drawOne(1, 28, 11, 13, 3411);
    drawOne(12, 27, 11, 12, 3412);
    drawOne(6, 16, 12, 13, 3413);
  } else {
    contact(s, 8, 21, 15, 5, 0.3);
    drawOne(1, 20, 14, 16, 3414);
    s.px(4, 12, P.BRONZE[3]); s.px(5, 12, P.BRONZE[4]); s.px(4, 13, P.BRONZE[1]); // tap
  }
  return finish(s, 'lamp');
}

function innNewel(): Surface {
  const s = new Surface(12, 28);
  contact(s, 6, 27, 11, 4, 0.3);
  const R = P.WOOD;
  s.rect(2, 8, 8, 19, R[2]);
  wood(s, 2, 8, 8, 19, R, 3421, 'v');
  s.vline(2, 8, 19, R[4], 0.8);
  s.vline(3, 8, 19, R[3], 0.5);
  s.vline(8, 8, 19, R[1], 0.7);
  s.vline(9, 8, 19, R[0]);
  for (const y of [11, 20]) { s.hline(1, y, 10, R[3], 0.8); s.hline(1, y + 1, 10, R[0], 0.8); }
  // turned cap and a ball finial
  s.rect(1, 6, 10, 2, R[3]);
  s.hline(1, 6, 10, P.WOOD_LIGHT[4]);
  s.hline(1, 7, 10, R[0], 0.7);
  s.ellipse(3, 0, 6, 6, R[2]);
  s.ellipse(3, 0, 6, 6, R[3], 0.5);
  s.ellipse(4, 1, 3, 3, P.WOOD_LIGHT[4], 0.8);
  s.ellipseOutline(3, 0, 6, 6, R[0], 0.7);
  s.hline(2, 26, 8, P.OUTLINE, 0.85);
  return finish(s, 'lamp');
}

function innSconce(frame: number): Surface {
  const s = new Surface(12, 20);
  // iron back plate + bracket
  s.rect(4, 10, 4, 8, P.IRON[2]);
  s.vline(4, 10, 8, P.IRON[3]);
  s.vline(7, 10, 8, P.IRON[0]);
  s.ellipse(2, 16, 8, 4, P.IRON[1]);
  s.ellipse(3, 16, 6, 3, P.IRON[3], 0.7);
  s.hline(3, 18, 6, P.OUTLINE, 0.7);
  // candle
  const drip = frame % 2;
  s.rect(5, 4 + drip, 2, 7 - drip, P.CLOTH.cream[3]);
  s.vline(5, 4 + drip, 7 - drip, P.CLOTH.cream[4]);
  s.vline(6, 4 + drip, 7 - drip, P.CLOTH.cream[1]);
  s.px(5, 10, P.CLOTH.cream[0]);
  // flame
  const h = 3 + (frame % 3 === 1 ? 1 : 0);
  const sway = frame === 2 ? 1 : frame === 0 ? -1 : 0;
  for (let k = 0; k < h; k++) {
    const y = 3 + drip - k;
    const w = k < h - 1 ? 1 : 0;
    for (let i = -w; i <= w; i++) s.px(5 + sway * (k > 1 ? 1 : 0) + i, y, k === 0 ? P.FIRE[2] : k < h - 1 ? P.FIRE[4] : P.FIRE[3]);
  }
  s.px(5, 4 + drip - h, P.FIRE[1], 0.6);
  glow(s, 6, 4, 9, P.LANTERN[4], 0.4);
  wallShadow(s, 1, 2, 0.24);
  glow(s, 6, 3, 7, P.FIRE[4], 0.35);
  return s;
}

function innHerbs(): Surface {
  const s = new Surface(14, 22);
  const r = rng(3431);
  // string
  s.hline(0, 1, 14, P.ROPE[2]);
  s.hline(0, 2, 14, P.ROPE[0], 0.6);
  for (let b = 0; b < 3; b++) {
    const bx = 2 + b * 4;
    const len = r.int(9, 15);
    const ramp = b === 1 ? P.GRASS_DRY : b === 2 ? P.TREE_AUTUMN : P.MOSS;
    for (let i = 0; i < 7; i++) {
      const lean = r.int(-2, 2);
      const l = r.int(len - 4, len);
      for (let k = 0; k < l; k++) {
        const x = bx + Math.round((lean * k) / l);
        s.px(x, 3 + k, k < 2 ? ramp[1] : k > l - 4 ? ramp[3] : ramp[2]);
        if (k > l - 3) s.px(x + 1, 3 + k, ramp[4], 0.6);
      }
    }
    s.hline(bx - 1, 3, 3, P.ROPE[3]); // binding
    s.hline(bx - 1, 4, 3, P.ROPE[1]);
  }
  wallShadow(s, 1, 2, 0.24);
  return finish(s, 'lamp', 0.25);
}

function innLectern(): Surface {
  const s = new Surface(16, 28);
  contact(s, 8, 27, 14, 5, 0.3);
  leg(s, 6, 12, 14, P.WOOD, 4);
  s.rect(3, 25, 10, 2, P.WOOD[1]);
  s.hline(3, 25, 10, P.WOOD[3], 0.6);
  s.hline(3, 26, 10, P.OUTLINE, 0.8);
  // sloped desk
  for (let k = 0; k < 8; k++) {
    const w = 14 - k;
    s.hline(1 + Math.floor(k / 2), 4 + k, w, P.WOOD_LIGHT[k < 2 ? 4 : k < 5 ? 3 : 2]);
  }
  s.hline(1, 12, 14, P.OUTLINE, 0.8);
  // the guest register, open, with a pen
  s.rect(3, 3, 10, 6, P.UI_PARCHMENT[4]);
  s.vline(8, 3, 6, P.UI_PARCHMENT[1]);
  for (let i = 0; i < 4; i++) {
    s.hline(4, 4 + i, 3, P.UI_INK_SOFT, 0.5);
    if (i < 3) s.hline(9, 5 + i, 3, P.UI_INK_SOFT, 0.45);
  }
  s.hline(3, 9, 10, P.OUTLINE, 0.5);
  s.line(11, 1, 13, 5, P.FEATHER[4]); // quill
  s.px(12, 5, P.UI_INK);
  return finish(s, 'lamp');
}

function innCoatRack(): Surface {
  const s = new Surface(16, 36);
  contact(s, 8, 35, 12, 5, 0.3);
  s.rect(7, 4, 3, 29, P.WOOD[2]);
  s.vline(7, 4, 29, P.WOOD[3], 0.9);
  s.vline(9, 4, 29, P.WOOD[0]);
  s.rect(4, 32, 9, 2, P.WOOD[1]);
  s.hline(4, 33, 9, P.OUTLINE, 0.8);
  for (const [x, y, d] of [[4, 6, -1], [11, 8, 1]] as const) { // pegs
    s.hline(Math.min(x, x + d * 2), y, 3, P.WOOD[3]);
    s.px(x, y + 1, P.WOOD[0]);
  }
  // a heavy coat: collar, shoulders, a body that widens toward the hem
  const coat = P.CLOTH.oren;
  const hem: number[] = [];
  for (let y = 8; y < 27; y++) {
    const t = (y - 8) / 19;
    const half = 1.5 + t * 3.5 + (y < 11 ? -1 : 0);
    hem.push(half);
    const cxc = 5;
    for (let x = Math.round(cxc - half); x <= Math.round(cxc + half); x++) {
      const u = (x - (cxc - half)) / (2 * half);
      s.px(x, y, u < 0.25 ? coat[3] : u < 0.55 ? coat[2] : u < 0.82 ? coat[1] : coat[0]);
    }
  }
  const cg = new Surface(16, 36);
  cloth(cg, 1, 8, 9, 19, coat, 3441);
  s.blitInside(cg, 0, 0, 0.45);
  s.hline(3, 8, 5, coat[4], 0.9);            // collar
  s.px(2, 9, coat[3]); s.px(8, 9, coat[1]);
  s.vline(5, 10, 16, coat[0], 0.55);         // button placket
  for (const by of [12, 16, 20]) s.px(4, by, P.BRONZE[3]);
  for (let y = 24; y < 27; y++) s.hline(Math.round(5 - hem[y - 8]), y, Math.round(2 * hem[y - 8]) + 1, coat[0], 0.35);
  const scarf = P.CLOTH.mira;
  for (let k = 0; k < 14; k++) {
    const x = 11 + Math.round(Math.sin(k * 0.6));
    s.hline(x, 9 + k, 3, scarf[k % 3 === 0 ? 3 : 2]);
  }
  s.hline(11, 9, 4, scarf[4], 0.7);
  return finish(s, 'lamp');
}

function innCatBed(): Surface {
  const s = new Surface(18, 13);
  contact(s, 9, 12, 17, 4, 0.3);
  s.ellipse(0, 2, 18, 10, P.ROPE[1]);
  s.ellipse(1, 2, 16, 9, P.ROPE[2]);
  for (let a = 0; a < 18; a += 2) s.px(a, 6 + Math.round(Math.sin(a) * 2), P.ROPE[3], 0.6);
  s.ellipse(3, 4, 12, 7, P.RUG_RED[1]);
  cloth(s, 4, 5, 10, 5, P.RUG_RED, 3451);
  s.ellipse(3, 4, 12, 7, P.RUG_RED[0], 0.25);
  s.ellipse(4, 5, 10, 5, P.RUG_RED[2], 0.5);
  s.ellipseOutline(0, 2, 18, 10, P.ROPE[0], 0.7);
  s.hline(2, 1, 14, P.ROPE[4], 0.5);
  // a few ginger hairs left behind
  const r = rng(3452);
  for (let i = 0; i < 6; i++) s.px(r.int(4, 13), r.int(5, 9), P.CAT_GINGER[3], 0.55);
  return finish(s, 'lamp');
}

function innCatBowl(): Surface {
  const s = new Surface(12, 9);
  contact(s, 6, 8, 11, 3, 0.28);
  s.ellipse(0, 2, 12, 6, P.CERAMIC[2]);
  s.ellipse(1, 2, 10, 5, P.CERAMIC[3]);
  s.ellipse(2, 3, 8, 3, P.CERAMIC[1]);
  s.ellipse(3, 3, 6, 2, P.WATER[3], 0.85);
  s.px(4, 3, P.WATER[4]);
  s.ellipseOutline(0, 2, 12, 6, P.CERAMIC[0], 0.6);
  s.hline(3, 1, 6, P.CERAMIC[4], 0.7);
  s.hline(2, 7, 8, P.OUTLINE, 0.5);
  return finish(s, 'lamp');
}

function innFirewood(): Surface {
  const s = new Surface(20, 18);
  contact(s, 10, 17, 19, 4, 0.3);
  // basket: upright stakes with the cane woven across them in bands
  s.rect(1, 8, 18, 9, P.ROPE[2]);
  for (let j = 0; j < 9; j++) {
    const band = j % 2 === 0;
    s.hline(1, 8 + j, 18, band ? P.ROPE[3] : P.ROPE[1], 0.85);
  }
  for (let i = 0; i < 18; i += 3) {
    s.vline(1 + i, 8, 9, P.ROPE[4], 0.5);
    s.vline(2 + i, 8, 9, P.ROPE[0], 0.35);
  }
  s.hline(1, 8, 18, P.ROPE[4], 0.9);
  s.hline(1, 9, 18, P.ROPE[0], 0.35);
  s.hline(1, 16, 18, P.OUTLINE, 0.85);
  s.vline(1, 8, 9, P.ROPE[3], 0.6);
  s.vline(18, 8, 9, P.ROPE[0], 0.8);
  // split logs, end-on: the pale end grain is what makes them read as logs
  const r = rng(3461);
  const logs: Array<[number, number, number]> = [
    [2, 4, 6], [8, 3, 6], [13, 5, 5], [5, 9, 6], [11, 9, 6], [3, 0, 5], [9, 0, 6],
  ];
  for (let i = 0; i < logs.length; i++) {
    const [x, y, d] = logs[i];
    s.ellipse(x, y, d, d - 1, P.WOOD[1]);
    s.ellipse(x, y, d - 1, d - 2, P.WOOD_LIGHT[3]);
    s.ellipse(x + 1, y + 1, d - 3, d - 4, P.WOOD_LIGHT[4], 0.7);
    for (let k = 1; k < 3; k++) s.ellipseOutline(x + k, y + k, d - k * 2, d - 1 - k * 2, P.WOOD_LIGHT[1], 0.45);
    s.line(x + 1, y + 1, x + d - 2, y + d - 3, P.WOOD[0], 0.5); // the split
    s.ellipseOutline(x, y, d, d - 1, P.WOOD[0], 0.75);
    if (r.chance(0.4)) s.px(x + 1, y + d - 3, P.MOSS[2], 0.5);
  }
  return finish(s, 'hearth');
}

function innPicture(kind: 'a' | 'b'): Surface {
  const s = new Surface(kind === 'a' ? 16 : 20, kind === 'a' ? 14 : 17);
  const w = s.w, h = s.h;
  s.rect(0, 0, w, h, P.BRONZE[2]);
  s.rectOutline(0, 0, w, h, P.BRONZE[4], 0.8);
  s.hline(0, h - 1, w, P.OUTLINE, 0.9);
  s.vline(w - 1, 0, h, P.BRONZE[0]);
  s.rect(2, 2, w - 4, h - 4, P.UI_PARCHMENT[3]);
  if (kind === 'a') {
    // a valley landscape: hills, a river, a sun
    s.rect(2, 2, w - 4, 5, P.WINDOW_AMBER[3]);
    s.ellipse(9, 3, 3, 3, P.WINDOW_AMBER[4]);
    s.poly([[2, 8], [6, 5], [10, 8], [14, 6], [14, 10], [2, 10]], P.TREE_DARK[2]);
    s.poly([[2, 9], [7, 7], [12, 10], [14, 9], [14, 11], [2, 11]], P.GRASS[2]);
    s.hline(2, 11, 12, P.WATER[3]);
  } else {
    // a portrait: two figures, one small, one smaller
    s.rect(2, 2, w - 4, h - 4, P.SHRINE_STONE[3]);
    s.ellipse(5, 4, 5, 5, P.SKIN.warm[3]);
    s.rect(4, 8, 7, 6, P.CLOTH.mira[2]);
    s.ellipse(5, 3, 5, 3, P.HAIR.auburn[2]);
    s.ellipse(12, 7, 4, 4, P.SKIN.olive[3]);
    s.rect(11, 10, 6, 4, P.CLOTH.nia[2]);
    s.ellipse(12, 6, 4, 2, P.HAIR.black[2]);
  }
  s.rectOutline(2, 2, w - 4, h - 4, P.BRONZE[0], 0.7);
  s.hline(3, 3, w - 6, P.CLOTH.cream[4], 0.2); // glass sheen
  s.line(3, 4, w - 6, 3, P.CLOTH.cream[4], 0.12);
  wallShadow(s, 1, 2, 0.3);
  return finish(s, 'lamp', 0.2);
}

function innClock(): Surface {
  const s = new Surface(16, 44);
  contact(s, 8, 43, 14, 5, 0.32);
  const R = P.WALL_WOOD;
  // case
  panelFront(s, 2, 14, 12, 27, R, 3471, 1);
  // waist glass showing the pendulum
  s.rect(5, 18, 6, 16, P.SOOT[1]);
  s.rectOutline(5, 18, 6, 16, R[0], 0.8);
  s.vline(8, 19, 11, P.BRONZE[2]);
  s.ellipse(6, 29, 5, 5, P.BRONZE[3]);
  s.ellipse(7, 30, 3, 3, P.BRONZE[4], 0.8);
  s.px(6, 20, P.CLOTH.cream[4], 0.35);
  // hood
  s.rect(1, 4, 14, 11, R[2]);
  wood(s, 1, 4, 14, 11, R, 3472, 'v');
  s.hline(1, 4, 14, P.WOOD_LIGHT[4], 0.9);
  s.hline(1, 14, 14, P.OUTLINE, 0.8);
  s.poly([[1, 4], [8, 0], [15, 4]], R[3]);
  s.line(1, 4, 8, 0, P.WOOD_LIGHT[4]);
  s.line(8, 0, 15, 4, R[0]);
  // dial
  s.ellipse(3, 5, 10, 9, P.BRONZE[1]);
  s.ellipse(4, 6, 8, 7, P.UI_PARCHMENT[4]);
  s.ellipseOutline(3, 5, 10, 9, P.BRONZE[3], 0.9);
  for (const [dx, dy] of [[0, -3], [3, 0], [0, 3], [-3, 0]] as const) s.px(8 + dx, 9 + dy, P.UI_INK);
  s.line(8, 9, 8, 7, P.UI_INK);
  s.line(8, 9, 10, 10, P.UI_INK);
  s.px(8, 9, P.BRONZE[0]);
  return finish(s, 'lamp');
}

function innCurtain(side: 'l' | 'r'): Surface {
  const s = new Surface(16, 16);
  const R = P.RUG_RED;
  const flip = side === 'r';
  for (let x = 0; x < 7; x++) {
    const px = flip ? 15 - x : x;
    const fold = Math.sin(x * 1.5) * 0.5 + 0.5;
    const c = fold > 0.7 ? R[3] : fold > 0.4 ? R[2] : R[1];
    for (let y = 1; y < 16; y++) {
      const bulge = Math.round(Math.sin((y / 16) * Math.PI) * 1.6);
      if (x <= 4 + bulge) s.px(px, y, c);
    }
  }
  cloth(s, flip ? 9 : 0, 1, 7, 15, R, 3481 + side.length);
  for (let x = 0; x < 7; x++) {
    const px = flip ? 15 - x : x;
    const fold = Math.sin(x * 1.5) * 0.5 + 0.5;
    for (let y = 1; y < 16; y++) {
      if (s.alphaAt(px, y) === 0) continue;
      s.px(px, y, fold > 0.7 ? R[4] : fold > 0.45 ? R[3] : fold > 0.2 ? R[1] : R[0], 0.55);
    }
  }
  // rail + rings
  s.hline(0, 0, 16, P.BRONZE[3]);
  s.hline(0, 1, 16, P.BRONZE[1], 0.8);
  for (let x = flip ? 10 : 1; x < (flip ? 16 : 7); x += 3) { s.px(x, 0, P.BRONZE[4]); s.px(x, 2, P.BRONZE[2]); }
  // tie-back
  s.hline(flip ? 10 : 1, 9, 5, P.UI_GOLD[3], 0.85);
  s.hline(flip ? 10 : 1, 10, 5, P.UI_GOLD[1], 0.7);
  s.innerShade(P.OUTLINE, 0.35, [[0, 1], [flip ? -1 : 1, 0]]);
  return s;
}

function innPlant(kind: 'a' | 'b'): Surface {
  const s = new Surface(16, kind === 'a' ? 24 : 19);
  const h = s.h;
  contact(s, 8, h - 1, 13, 4, 0.3);
  // pot
  const py = h - 9;
  s.rect(3, py, 10, 8, P.TERRACOTTA[2]);
  for (let i = 0; i < 10; i++) {
    const t = Math.abs(i - 4.5) / 4.5;
    for (let j = 0; j < 8; j++) s.px(3 + i, py + j, t < 0.3 ? P.TERRACOTTA[3] : t < 0.7 ? P.TERRACOTTA[2] : P.TERRACOTTA[1], 0.7);
  }
  s.rect(2, py - 2, 12, 3, P.TERRACOTTA[3]);
  s.hline(2, py - 2, 12, P.TERRACOTTA[4]);
  s.hline(2, py, 12, P.TERRACOTTA[0], 0.8);
  s.hline(4, h - 2, 8, P.OUTLINE, 0.85);
  s.rect(4, py - 1, 8, 1, P.DIRT[1]);
  const r = rng(3491 + kind.length);
  const ramp = kind === 'a' ? P.VEG_LEAF : P.BUSH;
  if (kind === 'a') { // tall and leafy
    for (let i = 0; i < 9; i++) {
      const bx = 8 + r.int(-3, 3);
      const bh = r.int(7, 13);
      const lean = r.int(-3, 3);
      for (let k = 0; k < bh; k++) {
        const x = bx + Math.round((lean * k) / bh);
        s.px(x, py - 2 - k, k > bh - 4 ? ramp[3] : ramp[2]);
        if (k > bh - 3) { s.px(x + 1, py - 3 - k, ramp[4]); s.px(x - 1, py - 2 - k, ramp[1]); }
      }
    }
  } else { // a trailing plant spilling over the rim
    for (let i = 0; i < 7; i++) {
      const cx2 = 4 + r.int(0, 8), cy = py - 4 - r.int(0, 3);
      s.ellipse(cx2 - 2, cy - 2, 5, 4, ramp[2]);
      s.ellipse(cx2 - 1, cy - 2, 3, 3, ramp[3]);
      s.px(cx2, cy - 2, ramp[4]);
    }
    for (let k = 0; k < 6; k++) { s.px(2 + Math.round(k * 0.4), py + k, ramp[2]); s.px(13, py + k, ramp[1]); }
  }
  return finish(s, 'lamp');
}

function innBroom(): Surface {
  const s = new Surface(10, 26);
  contact(s, 5, 25, 8, 4, 0.28);
  s.rect(4, 0, 2, 17, P.WOOD_LIGHT[2]);
  s.vline(4, 0, 17, P.WOOD_LIGHT[4]);
  s.vline(5, 0, 17, P.WOOD_LIGHT[0]);
  s.hline(2, 16, 6, P.ROPE[3]);
  s.hline(2, 17, 6, P.ROPE[1]);
  const r = rng(3501);
  for (let i = 0; i < 14; i++) {
    const x = 1 + r.int(0, 7);
    const l = r.int(5, 8);
    const lean = (x - 4.5) * 0.25;
    for (let k = 0; k < l; k++) {
      s.px(Math.round(x + lean * k), 18 + k, k > l - 3 ? P.GRASS_DRY[1] : P.GRASS_DRY[r.int(2, 3)]);
    }
  }
  return finish(s, 'lamp', 0.25);
}

function innBucket(): Surface {
  const s = new Surface(14, 16);
  contact(s, 7, 15, 13, 4, 0.3);
  s.poly([[2, 5], [12, 5], [11, 14], [3, 14]], P.IRON[2]);
  metal(s, 2, 5, 11, 10, P.IRON);
  for (let y = 5; y < 14; y++) for (let x = 0; x < 14; x++) {
    const inside = x >= 2 + Math.floor((y - 5) * 0.11) && x <= 12 - Math.floor((y - 5) * 0.11);
    if (!inside) { const i = (y * 14 + x) * 4; if (s.data[i + 3] && y > 5) s.data[i + 3] = 0; }
  }
  s.ellipse(1, 3, 12, 4, P.IRON[3]);
  s.ellipse(2, 4, 10, 3, P.SOOT[1]);
  s.ellipse(3, 4, 8, 2, P.WATER[2], 0.8);
  s.px(4, 4, P.WATER[4], 0.9);
  s.ellipseOutline(1, 3, 12, 4, P.IRON[4], 0.7);
  s.hline(3, 13, 8, P.OUTLINE, 0.85);
  // handle, hanging to one side
  s.line(2, 4, 0, 9, P.IRON[3]);
  s.line(12, 4, 13, 9, P.IRON[1]);
  // a mop leaning in it
  s.rect(8, 0, 2, 5, P.WOOD_LIGHT[2]);
  s.vline(8, 0, 5, P.WOOD_LIGHT[4]);
  const r = rng(3511);
  for (let i = 0; i < 9; i++) {
    const x = 6 + r.int(0, 5);
    for (let k = 0; k < r.int(3, 5); k++) s.px(x, 4 + k, P.LINEN[r.int(1, 3)]);
  }
  return finish(s, 'lamp');
}

/** Quest One: the storeroom door, blocked. Reads as impassable — even to a cat. */
function innCratesBlocked(): Surface {
  const s = new Surface(48, 42);
  contact(s, 24, 41, 46, 6, 0.34);
  const r = rng(3521);
  /** One crate: a boarded box with a hard outline, so the pile reads as parts. */
  const crate = (x: number, y: number, w: number, h: number, seed: number, tone: number) => {
    const R: Ramp = tone > 0 ? P.WOOD_LIGHT : P.WOOD;
    s.rect(x, y, w, h, R[2]);
    wood(s, x, y, w, h, R, seed, 'h');
    // horizontal boards with a visible gap between each
    for (let k = 0; k * 5 < h - 2; k++) {
      const yy = y + 1 + k * 5;
      s.hline(x + 1, yy, w - 2, R[3], 0.7);
      s.hline(x + 1, Math.min(y + h - 2, yy + 3), w - 2, R[0], 0.85);
    }
    // corner battens, which is what makes a box read as a crate
    for (const bx of [x, x + w - 3]) {
      s.rect(bx, y, 3, h, R[bx === x ? 3 : 1]);
      wood(s, bx, y, 3, h, R, seed + bx, 'v');
      s.vline(bx, y, h, bx === x ? R[4] : R[1], 0.8);
      s.vline(bx + 2, y, h, R[0], 0.9);
      s.px(bx + 1, y + 2, P.IRON[2]);
      s.px(bx + 1, y + h - 3, P.IRON[1]);
    }
    s.hline(x, y, w, R[4], 0.8);
    s.rectOutline(x, y, w, h, P.OUTLINE, 0.7);
    s.hline(x, y + h - 1, w, P.OUTLINE, 0.95);
  };
  // the doorway behind: a dark opening with timber jambs, visible at the top
  s.rect(8, 0, 32, 36, P.SOOT[1]);
  texture(s, 8, 0, 32, 36, P.SOOT, 3520, { scale: 5, lo: 0.45, hi: 0.72 });
  for (let y = 0; y < 8; y++) s.hline(8, y, 32, P.OUTLINE, 0.5 - y * 0.05);
  s.rect(5, 0, 4, 38, P.WOOD_LIGHT[2]);
  wood(s, 5, 0, 4, 38, P.WOOD_LIGHT, 3529, 'v');
  s.vline(5, 0, 38, P.WOOD_LIGHT[4], 0.9);
  s.vline(8, 0, 38, P.WOOD[0]);
  s.rect(39, 0, 4, 38, P.WOOD[2]);
  wood(s, 39, 0, 4, 38, P.WOOD, 3530, 'v');
  s.vline(39, 0, 38, P.WOOD[0]);
  s.vline(42, 0, 38, P.WOOD[1], 0.8);
  // the pile, front row lowest so the stack reads back-to-front
  crate(10, 14, 17, 15, 3525, 1);
  crate(27, 11, 15, 18, 3526, 0);
  crate(2, 22, 16, 15, 3522, 0);
  crate(18, 24, 16, 13, 3523, 1);
  crate(33, 25, 14, 12, 3524, 0);
  // the fallen shelf, wedged diagonally across the whole thing
  for (let k = 0; k < 6; k++) {
    const y0 = 8 + k, y1 = 20 + k;
    s.line(1, y1, 46, y0, k === 0 ? P.WOOD_LIGHT[4] : k < 3 ? P.WOOD_LIGHT[2] : k < 5 ? P.WOOD_LIGHT[1] : P.OUTLINE,
      k === 5 ? 0.85 : 1);
  }
  s.rect(3, 18, 4, 12, P.WOOD[1]);      // its snapped uprights
  s.vline(3, 18, 12, P.WOOD[3], 0.7);
  s.line(3, 18, 6, 15, P.WOOD[0], 0.8);
  s.rect(41, 5, 4, 10, P.WOOD[2]);
  s.vline(41, 5, 10, P.WOOD[3], 0.7);
  s.vline(44, 5, 10, P.OUTLINE, 0.8);
  // a sack wedged in the last gap, and apples out of a split crate
  s.ellipse(0, 28, 12, 12, P.CLOTH.cream[2]);
  const sg = new Surface(48, 42);
  cloth(sg, 0, 28, 12, 12, P.CLOTH.cream, 3527);
  s.blitInside(sg, 0, 0, 0.7);
  s.ellipse(0, 28, 12, 12, P.CLOTH.cream[0], 0.18);
  s.hline(2, 27, 7, P.ROPE[2]);
  s.hline(2, 28, 7, P.ROPE[0], 0.7);
  for (let i = 0; i < 6; i++) {
    const ax = 30 + r.int(0, 14), ay = 34 + r.int(0, 5);
    s.ellipse(ax, ay, 5, 5, P.FLOWER_ROSE[0]);
    s.ellipse(ax, ay, 4, 4, P.FLOWER_ROSE[1]);
    s.ellipse(ax + 1, ay, 2, 2, P.FLOWER_ROSE[2]);
    s.px(ax + 2, ay - 1, P.MOSS[2]);
  }
  return finish(s, 'lamp');
}

function innHearthRug(): Surface {
  const s = new Surface(34, 18);
  contact(s, 17, 17, 32, 4, 0.22);
  s.ellipse(0, 0, 34, 17, P.RUG_RED[2]);
  const g = new Surface(34, 18);
  cloth(g, 0, 0, 34, 18, P.RUG_RED, 3531);
  s.blitInside(g);
  s.ellipse(3, 2, 28, 13, P.RUG_RED[1], 0.55);
  s.ellipse(6, 4, 22, 9, P.RUG_RED[3], 0.5);
  s.ellipse(10, 6, 14, 5, P.UI_GOLD[2], 0.5);
  s.ellipseOutline(0, 0, 34, 17, P.RUG_RED[0], 0.8);
  s.ellipseOutline(3, 2, 28, 13, P.UI_GOLD[3], 0.5);
  for (let i = 0; i < 34; i++) { // fringe, only where the rug actually reaches
    if (i % 2) continue;
    for (let y = 0; y < 17; y++) if (s.alphaAt(i, y)) { s.px(i, y, P.CLOTH.cream[3], 0.6); break; }
    for (let y = 17; y >= 0; y--) if (s.alphaAt(i, y)) { s.px(i, y, P.CLOTH.cream[2], 0.7); break; }
  }
  // a scorch mark and a cat-sized dent, both close to the fire
  s.ellipse(14, 1, 7, 3, P.SOOT[1], 0.35);
  s.ellipse(19, 7, 9, 5, P.RUG_RED[1], 0.4);
  return finish(s, 'hearth', 0.25);
}

function innKeg(): Surface {
  const s = new Surface(22, 24);
  contact(s, 11, 23, 21, 5, 0.3);
  s.rect(2, 6, 18, 16, P.WOOD[2]);
  wood(s, 2, 6, 18, 16, P.WOOD, 3541, 'h');
  for (let i = 0; i < 18; i++) {
    const t = Math.abs(i - 8.5) / 8.5;
    const c = t < 0.25 ? P.WOOD[4] : t < 0.55 ? P.WOOD[3] : t < 0.85 ? P.WOOD[2] : P.WOOD[0];
    for (let j = 0; j < 16; j++) s.px(2 + i, 6 + j, c, 0.5);
  }
  for (const hy of [7, 13, 20]) {
    s.hline(1, hy, 20, P.IRON[3]);
    s.hline(1, hy + 1, 20, P.IRON[0]);
    s.px(4, hy, P.IRON[4]);
  }
  s.ellipse(1, 3, 20, 6, P.WOOD[3]);
  s.ellipse(3, 4, 16, 4, P.WOOD[4], 0.45);
  s.ellipseOutline(1, 3, 20, 6, P.WOOD[0], 0.8);
  s.hline(3, 21, 16, P.OUTLINE, 0.85);
  s.rect(9, 15, 3, 3, P.BRONZE[2]);   // tap
  s.px(9, 15, P.BRONZE[4]);
  s.rect(10, 18, 1, 2, P.BRONZE[1]);
  return finish(s, 'lamp');
}

function innTableware(kind: 'mug' | 'mug_half' | 'plate' | 'soup'): Surface {
  const s = new Surface(kind === 'soup' ? 13 : kind === 'plate' ? 12 : 8, kind === 'soup' ? 11 : kind === 'plate' ? 7 : 10);
  contact(s, s.w / 2, s.h - 1, s.w - 1, 3, 0.26);
  if (kind === 'plate') {
    s.ellipse(0, 0, 12, 6, P.CERAMIC[2]);
    s.ellipse(1, 1, 10, 4, P.CERAMIC[4]);
    s.ellipseOutline(0, 0, 12, 6, P.CERAMIC[0], 0.7);
    s.px(4, 2, P.THATCH[2]); s.px(6, 3, P.THATCH[1]); s.px(7, 2, P.THATCH[3]); // crumbs
  } else if (kind === 'soup') {
    s.ellipse(0, 2, 13, 8, P.CERAMIC[2]);
    s.ellipse(1, 2, 11, 6, P.CERAMIC[3]);
    s.ellipse(2, 3, 9, 4, P.TREE_AUTUMN[2]);
    s.ellipse(3, 3, 7, 3, P.TREE_AUTUMN[3]);
    s.px(5, 4, P.VEG_LEAF[3]); s.px(7, 5, P.TERRACOTTA[3]);
    s.ellipseOutline(0, 2, 13, 8, P.CERAMIC[0], 0.7);
    s.hline(4, 1, 5, P.LINEN[4], 0.3); // a curl of steam
    s.px(6, 0, P.LINEN[3], 0.25);
  } else {
    mug(s, 1, 2, P.CERAMIC, kind === 'mug' ? 'full' : 'half');
  }
  return finish(s, 'lamp', 0.3);
}

// ── Sera's Workshop ─────────────────────────────────────────────────────────
// Colder light than the inn: one lamp, a lot of shadow, and exactly one
// saturated violet object in the room.

function labBookcase(variant: 0 | 1 | 2): Surface {
  const s = new Surface(28, 48);
  contact(s, 14, 47, 26, 5, 0.32);
  const R = P.WALL_WOOD;
  // carcass
  s.rect(0, 2, 28, 45, R[1]);
  wood(s, 0, 2, 28, 45, R, 3601 + variant, 'v');
  s.rect(2, 4, 24, 41, P.SOOT[1]);        // the dark interior
  s.hline(0, 2, 28, P.WOOD_LIGHT[4], 0.8);
  s.hline(0, 0, 28, R[3]);                 // cornice
  s.hline(0, 1, 28, R[0], 0.8);
  s.vline(0, 2, 45, R[3], 0.7);
  s.vline(27, 2, 45, R[0]);
  s.hline(0, 46, 28, P.OUTLINE, 0.9);
  const shelves = variant === 1 ? 5 : 4;
  const gap = Math.floor(41 / shelves);
  const r = rng(3611 + variant);
  for (let k = 0; k < shelves; k++) {
    const y = 4 + k * gap;
    const h = gap - 3;
    if (k === variant % shelves) {
      // one shelf of horizontal stacks and objects instead of spines
      let x = 3;
      while (x < 22) {
        const w = r.int(6, 9), n = r.int(2, 4);
        for (let b = 0; b < n; b++) {
          const yy = y + h - 2 - b * 2;
          s.hline(x, yy, w, r.pick([P.LEATHER, P.ROOF_TEAL, P.UI_PARCHMENT, P.ROOF_PLUM])[2]);
          s.hline(x, yy + 1, w, P.OUTLINE, 0.5);
        }
        x += w + 2;
      }
      if (variant === 2) { // a skull-ish specimen and a jar
        s.ellipse(20, y + h - 8, 6, 6, P.CERAMIC[3]);
        s.ellipse(21, y + h - 7, 4, 4, P.CERAMIC[4]);
        s.px(22, y + h - 5, P.SOOT[0]); s.px(24, y + h - 5, P.SOOT[0]);
      }
    } else {
      books(s, 3, y, 22, h, 3621 + variant * 13 + k * 7, r.chance(0.6));
    }
    // the shelf board itself
    s.hline(2, y + h, 24, P.WOOD_LIGHT[4], 0.85);
    s.hline(2, y + h + 1, 24, R[1]);
    s.hline(2, y + h + 2, 24, P.OUTLINE, 0.8);
  }
  if (variant === 0) { // it leans; the room is old
    s.vline(1, 2, 45, P.OUTLINE, 0.3);
  }
  return finish(s, 'cold');
}

function labDesk(): Surface {
  const s = new Surface(42, 34);
  contact(s, 21, 33, 40, 5, 0.3);
  const R = P.WALL_WOOD;
  panelFront(s, 2, 14, 14, 17, R, 3631, 1);   // drawer pedestal
  for (const dy of [16, 22, 27]) {
    s.hline(3, dy, 12, P.WOOD_LIGHT[3], 0.6);
    s.hline(3, dy + 1, 12, P.OUTLINE, 0.7);
    s.px(9, dy + 3, P.BRONZE[3]); s.px(10, dy + 3, P.BRONZE[1]);
  }
  s.rect(18, 14, 13, 4, P.SOOT[0], 0.55);      // the kneehole
  leg(s, 36, 14, 18, P.WOOD, 4);
  slab(s, 0, 8, 42, 7, P.WOOD_LIGHT, 3632, 3);
  // the mess on top
  papers(s, 4, 4, 11, 4, 3633);
  papers(s, 17, 6, 9, 3, 3634);
  s.rect(28, 3, 9, 6, P.UI_PARCHMENT[4]);      // an open notebook
  s.vline(32, 3, 6, P.UI_PARCHMENT[1]);
  for (let i = 0; i < 4; i++) {
    s.hline(29, 4 + i, 3, P.UI_INK_SOFT, 0.55);
    s.hline(33, 5 + i, 3, P.UI_INK_SOFT, 0.4);
  }
  s.hline(28, 9, 9, P.OUTLINE, 0.6);
  s.rect(38, 4, 4, 5, P.GLASS_CLEAR[1]);       // inkwell
  s.hline(38, 4, 4, P.GLASS_CLEAR[3]);
  s.rect(39, 3, 2, 1, P.IRON[2]);
  s.px(39, 5, P.UI_INK);
  s.line(36, 0, 40, 3, P.FEATHER[4]);          // quill in the well
  s.line(37, 0, 41, 3, P.FEATHER[2]);
  return finish(s, 'cold');
}

function labChalkboard(): Surface {
  const s = new Surface(48, 38);
  const R = P.WOOD;
  s.rect(0, 0, 48, 36, R[2]);
  wood(s, 0, 0, 48, 36, R, 3641, 'h');
  s.hline(0, 0, 48, P.WOOD_LIGHT[4], 0.85);
  s.vline(0, 0, 36, P.WOOD_LIGHT[3], 0.6);
  s.vline(47, 0, 36, R[0]);
  s.rect(2, 2, 44, 29, P.CHALKBOARD[2]);
  texture(s, 2, 2, 44, 29, P.CHALKBOARD, 3642, { scale: 5, lo: 0.4, hi: 0.62 });
  s.rectOutline(2, 2, 44, 29, P.CHALKBOARD[0], 0.8);
  // Diagrams, shapes only. A bell, an arrow, a cat, a curve that flattens out —
  // Sera working out conditioning without a word of text on the board.
  const C = P.CHALK;
  s.ellipseOutline(5, 6, 9, 9, C, 0.85);            // the bell
  s.hline(6, 14, 7, C, 0.85);
  s.px(9, 4, C, 0.7);
  s.line(16, 10, 24, 10, C, 0.85);                  // arrow
  s.line(24, 10, 21, 7, C, 0.8);
  s.line(24, 10, 21, 13, C, 0.8);
  s.ellipseOutline(27, 5, 10, 8, C, 0.8);           // the cat
  s.line(28, 6, 29, 3, C, 0.75);
  s.line(35, 6, 34, 3, C, 0.75);
  s.px(30, 8, C, 0.9); s.px(33, 8, C, 0.9);
  s.line(37, 12, 41, 9, C, 0.6);
  // an extinction curve on the lower half
  for (let x = 0; x < 26; x++) {
    const y = 27 - Math.round(9 * Math.exp(-x / 8));
    s.px(6 + x, y, C, 0.9);
    if (x % 6 === 0) s.px(6 + x, y + 1, C, 0.4);
  }
  s.line(5, 18, 5, 28, C, 0.7);
  s.line(5, 28, 33, 28, C, 0.7);
  // three tally-ish marks and a circled blob, half rubbed out
  for (let i = 0; i < 4; i++) s.line(36 + i * 2, 18, 36 + i * 2, 24, C, 0.55);
  s.ellipseOutline(34, 15, 12, 13, C, 0.35);
  s.ellipse(20, 14, 12, 8, P.CHALKBOARD[3], 0.5);   // a smeared erasure
  // chalk tray
  slab(s, 0, 31, 48, 3, P.WOOD_LIGHT, 3643, 2);
  s.hline(4, 31, 4, C, 0.9);
  s.hline(4, 32, 4, P.CLOTH.cream[1], 0.7);
  s.rect(12, 30, 6, 3, P.LINEN[2]);                 // the eraser
  s.hline(12, 30, 6, P.LINEN[4], 0.8);
  s.hline(12, 32, 6, P.OUTLINE, 0.6);
  wallShadow(s, 1, 2, 0.3);
  return finish(s, 'cold', 0.3);
}

function labJars(frame: number): Surface {
  const s = new Surface(30, 24);
  contact(s, 15, 23, 28, 4, 0.3);
  const r = rng(3651);
  const contents: Ramp[] = [P.MOSS, P.GLASS_GREEN, P.TREE_AUTUMN, P.WATER];
  let x = 1;
  for (let i = 0; i < 4 && x < 26; i++) {
    const w = r.int(6, 8), h = r.int(12, 18);
    const y = 22 - h;
    const fluid = contents[i % contents.length];
    // glass body
    s.rect(x, y, w, h, P.GLASS_CLEAR[1]);
    s.rect(x + 1, y + Math.floor(h * 0.35), w - 2, Math.ceil(h * 0.65) - 1, fluid[1]);
    s.rect(x + 1, y + Math.floor(h * 0.35), w - 2, 1, fluid[3]);
    // the specimen: a coiled shape, deliberately unidentifiable
    for (let k = 0; k < 5; k++) {
      s.px(x + 2 + (k % 3), y + Math.floor(h * 0.5) + k, fluid[3], 0.85);
      s.px(x + 3 + (k % 2), y + Math.floor(h * 0.5) + k + 1, fluid[4], 0.7);
    }
    s.vline(x, y, h, P.GLASS_CLEAR[3], 0.85);
    s.vline(x + 1, y, h, P.GLASS_CLEAR[4], 0.45);
    s.vline(x + w - 1, y, h, P.GLASS_CLEAR[0], 0.9);
    s.hline(x, y + h - 1, w, P.OUTLINE, 0.85);
    s.rect(x - 1, y - 2, w + 2, 3, P.IRON[2]);   // lid
    s.hline(x - 1, y - 2, w + 2, P.IRON[4], 0.8);
    s.hline(x - 1, y, w + 2, P.IRON[0]);
    // the faint glow, breathing on the frame
    const lit = (i + frame) % 2 === 0;
    glow(s, x + w / 2, y + h * 0.6, w + 3, fluid[4], lit ? 0.3 : 0.18);
    s.rect(x + 1, y + 1, 1, Math.floor(h * 0.3), P.GLASS_CLEAR[4], 0.5);
    x += w + r.int(1, 2);
  }
  return finish(s, 'cold');
}

function labOrrery(): Surface {
  const s = new Surface(28, 34);
  contact(s, 14, 33, 22, 5, 0.3);
  // base
  s.ellipse(6, 27, 16, 6, P.WALL_WOOD[2]);
  s.ellipse(7, 27, 14, 5, P.WALL_WOOD[3], 0.8);
  s.ellipseOutline(6, 27, 16, 6, P.OUTLINE, 0.7);
  s.rect(12, 20, 4, 8, P.BRONZE[2]);
  metal(s, 12, 20, 4, 8, P.BRONZE);
  // armillary rings
  s.ellipseOutline(2, 4, 24, 22, P.BRONZE[3]);
  s.ellipseOutline(3, 5, 22, 20, P.BRONZE[1], 0.6);
  s.ellipseOutline(8, 6, 12, 18, P.BRONZE[2], 0.9);
  s.ellipseOutline(4, 12, 20, 7, P.BRONZE[4], 0.95);
  s.ellipseOutline(5, 13, 18, 5, P.BRONZE[1], 0.5);
  for (let x = 3; x < 25; x++) s.pxOver(x, 15, P.BRONZE[4], 0.5);
  // the sun and two planets
  s.ellipse(11, 12, 6, 6, P.UI_GOLD[2]);
  s.ellipse(12, 13, 4, 4, P.UI_GOLD[4]);
  s.ellipse(4, 14, 3, 3, P.WATER[3]);
  s.ellipse(21, 9, 4, 4, P.TERRACOTTA[3]);
  s.px(22, 10, P.TERRACOTTA[4]);
  glow(s, 14, 14, 12, P.UI_GOLD[4], 0.2);
  return finish(s, 'cold');
}

function labWorkbench(): Surface {
  const s = new Surface(48, 32);
  contact(s, 24, 31, 46, 5, 0.3);
  leg(s, 3, 16, 14, P.WOOD, 4);
  leg(s, 41, 16, 14, P.WOOD, 4);
  s.rect(3, 24, 42, 2, P.WOOD[1], 0.9);
  // a lower shelf of junk
  for (let i = 0; i < 5; i++) {
    const x = 6 + i * 8;
    s.rect(x, 20 - (i % 2) * 2, 6, 4 + (i % 2) * 2, i % 2 ? P.IRON[2] : P.TERRACOTTA[2]);
    s.hline(x, 20 - (i % 2) * 2, 6, i % 2 ? P.IRON[4] : P.TERRACOTTA[4], 0.7);
  }
  slab(s, 0, 9, 48, 7, P.WOOD, 3661, 3);
  // scarred top
  const r = rng(3662);
  for (let i = 0; i < 12; i++) {
    const x = r.int(2, 44), y = r.int(10, 14);
    s.hline(x, y, r.int(2, 5), P.WOOD[0], 0.4);
  }
  s.ellipse(20, 10, 8, 4, P.SOOT[1], 0.35);  // a scorch
  // tools laid out: a vice, a file, pliers, a coil of wire
  s.rect(2, 4, 7, 6, P.IRON[2]);
  metal(s, 2, 4, 7, 6, P.IRON);
  s.hline(2, 4, 7, P.IRON[4], 0.9);
  s.rect(4, 2, 3, 3, P.IRON[3]);
  s.hline(9, 6, 3, P.IRON[1]);
  s.line(14, 8, 22, 6, P.IRON[3]);
  s.line(14, 9, 22, 7, P.IRON[1]);
  s.hline(22, 6, 3, P.WOOD_LIGHT[2]);
  s.line(26, 8, 31, 4, P.IRON[2]);
  s.line(28, 8, 33, 4, P.IRON[3]);
  s.px(30, 6, P.IRON[4]);
  s.ellipseOutline(36, 3, 9, 7, P.BRONZE[3], 0.9);
  s.ellipseOutline(37, 4, 7, 5, P.BRONZE[1], 0.8);
  s.ellipseOutline(38, 5, 5, 3, P.BRONZE[2], 0.7);
  return finish(s, 'cold');
}

function labMapTable(): Surface {
  const s = new Surface(42, 32);
  contact(s, 21, 31, 40, 5, 0.3);
  leg(s, 3, 18, 12, P.WOOD, 4);
  leg(s, 35, 18, 12, P.WOOD, 4);
  s.rect(3, 26, 36, 2, P.WOOD[1], 0.9);
  slab(s, 0, 12, 42, 6, P.WOOD, 3671, 3);
  // the map, curling at the corners
  s.rect(2, 2, 38, 12, P.UI_PARCHMENT[3]);
  texture(s, 2, 2, 38, 12, P.UI_PARCHMENT, 3672, { scale: 5, lo: 0.42, hi: 0.6 });
  s.hline(2, 2, 38, P.UI_PARCHMENT[4], 0.9);
  s.hline(2, 13, 38, P.OUTLINE, 0.6);
  s.vline(2, 2, 12, P.UI_PARCHMENT[4], 0.6);
  s.vline(39, 2, 12, P.UI_PARCHMENT[1], 0.8);
  for (const [cx, cy] of [[1, 1], [37, 0]] as const) { // curled corners
    for (let k = 0; k < 4; k++) s.hline(2 + cx + k, 2 + cy + k, 4 - k, P.UI_PARCHMENT[4], 0.8);
  }
  // coastline + river + roads, all shape and no text
  s.line(8, 4, 14, 7, P.WOODS_GRASS[3], 0.8);
  s.line(14, 7, 12, 11, P.WOODS_GRASS[3], 0.8);
  s.line(20, 3, 24, 8, P.WATER[2], 0.85);
  s.line(24, 8, 22, 12, P.WATER[2], 0.85);
  for (let x = 5; x < 36; x += 3) s.px(x, 9 + Math.round(Math.sin(x * 0.4)), P.DIRT[1], 0.7);
  s.ellipseOutline(28, 4, 8, 6, P.WOODS_GRASS[2], 0.6);
  // pins and string between them
  const pins: Array<[number, number]> = [[10, 6], [23, 5], [31, 9], [17, 11]];
  for (let i = 0; i < pins.length; i++) {
    const [ax, ay] = pins[i], [bx, by] = pins[(i + 1) % pins.length];
    s.line(ax, ay, bx, by, P.TWINE, 0.75);
  }
  for (const [px, py] of pins) {
    s.px(px, py, P.ROOF_RED[2]);
    s.px(px, py - 1, P.ROOF_RED[3]);
    s.px(px + 1, py, P.ROOF_RED[0]);
  }
  // a magnifier resting on it
  s.ellipseOutline(30, 1, 9, 8, P.BRONZE[3], 0.95);
  s.ellipse(31, 2, 7, 6, P.GLASS_CLEAR[3], 0.35);
  s.line(29, 9, 26, 12, P.WOOD_LIGHT[2]);
  return finish(s, 'cold');
}

function labRack(): Surface {
  const s = new Surface(26, 40);
  contact(s, 13, 39, 22, 5, 0.3);
  for (const x of [1, 22]) {
    s.rect(x, 2, 3, 36, P.IRON[2]);
    metal(s, x, 2, 3, 36, P.IRON);
    s.hline(x, 37, 3, P.OUTLINE, 0.8);
  }
  for (const y of [4, 16, 28]) {
    s.hline(1, y, 24, P.IRON[3]);
    s.hline(1, y + 1, 24, P.IRON[0], 0.8);
  }
  const r = rng(3681);
  // hanging instruments: a pendulum, tongs, a hoop, a hand-lens, coils
  s.vline(6, 5, 6, P.TWINE, 0.9);
  s.ellipse(4, 11, 5, 5, P.BRONZE[3]);
  s.ellipse(5, 12, 3, 3, P.BRONZE[4], 0.8);
  s.line(12, 5, 12, 13, P.IRON[3]);
  s.line(15, 5, 15, 13, P.IRON[2]);
  s.line(12, 13, 15, 13, P.IRON[1]);
  s.ellipseOutline(17, 6, 8, 8, P.BRONZE[2], 0.9);
  s.ellipseOutline(3, 18, 8, 7, P.IRON[3], 0.9);
  s.ellipse(4, 19, 6, 5, P.GLASS_CLEAR[2], 0.3);
  s.line(9, 24, 12, 27, P.WOOD_LIGHT[2]);
  for (let i = 0; i < 3; i++) {
    const x = 13 + i * 4;
    s.vline(x, 17, r.int(6, 10), P.COPPER[2]);
    s.vline(x + 1, 17, r.int(5, 9), P.COPPER[0], 0.7);
  }
  for (let i = 0; i < 4; i++) { // a shelf of small crocks at the bottom
    const x = 2 + i * 6;
    s.rect(x, 29, 5, 7, P.TERRACOTTA[2]);
    s.hline(x - 1, 29, 7, P.TERRACOTTA[3]);
    s.hline(x, 35, 5, P.OUTLINE, 0.7);
    s.vline(x, 30, 6, P.TERRACOTTA[3], 0.7);
    s.vline(x + 4, 30, 6, P.TERRACOTTA[0], 0.8);
  }
  wallShadow(s, 1, 2, 0.25);
  return finish(s, 'cold');
}

function labCoil(frame: number): Surface {
  const s = new Surface(22, 38);
  contact(s, 11, 37, 18, 5, 0.3);
  // base
  s.rect(3, 28, 16, 8, P.WALL_WOOD[2]);
  wood(s, 3, 28, 16, 8, P.WALL_WOOD, 3691, 'h');
  s.hline(3, 28, 16, P.WOOD_LIGHT[4], 0.85);
  s.hline(3, 35, 16, P.OUTLINE, 0.9);
  s.px(5, 31, P.BRONZE[3]); s.px(6, 31, P.BRONZE[1]);
  s.rect(14, 30, 4, 3, P.IRON[2]);           // a switch
  s.px(15, 29, P.BRONZE[4]);
  // the winding
  s.rect(7, 8, 8, 20, P.COPPER[2]);
  for (let y = 8; y < 28; y++) {
    const t = (y % 3) / 3;
    for (let i = 0; i < 8; i++) {
      const u = Math.abs(i - 3.5) / 3.5;
      s.px(7 + i, y, t < 0.34 ? (u < 0.4 ? P.COPPER[4] : P.COPPER[2]) : u < 0.4 ? P.COPPER[3] : P.COPPER[1]);
    }
  }
  s.vline(6, 8, 20, P.COPPER[1], 0.8);
  s.vline(15, 8, 20, P.COPPER[0], 0.9);
  // the toroid
  s.ellipse(2, 4, 18, 7, P.IRON[2]);
  s.ellipse(3, 4, 16, 5, P.IRON[3]);
  s.ellipse(6, 5, 10, 3, P.IRON[4], 0.6);
  s.ellipseOutline(2, 4, 18, 7, P.IRON[0], 0.8);
  // arcs — pale, never Echo cyan, because this is Sera's machine and not the Echo
  const r = rng(3695 + frame * 31);
  const arcs = frame % 4 === 3 ? 1 : 3;
  for (let a = 0; a < arcs; a++) {
    let x = 4 + r.int(0, 13), y = 4;
    for (let k = 0; k < 5; k++) {
      const nx = Math.max(0, Math.min(21, x + r.int(-3, 3)));
      const ny = Math.max(0, y - r.int(1, 2));
      s.line(x, y, nx, ny, k < 2 ? P.GLASS_CLEAR[4] : P.CLOTH.cream[4], 0.9 - k * 0.12);
      x = nx; y = ny;
    }
  }
  glow(s, 11, 3, 12, P.GLASS_CLEAR[4], frame % 4 === 3 ? 0.12 : 0.28);
  return finish(s, 'cold');
}

function labPlantShelf(): Surface {
  const s = new Surface(34, 36);
  contact(s, 17, 35, 30, 5, 0.3);
  const R = P.WOOD;
  for (const x of [1, 30]) { s.rect(x, 6, 3, 28, R[2]); s.vline(x, 6, 28, R[3], 0.8); s.vline(x + 2, 6, 28, R[0]); }
  const r = rng(3701);
  for (let k = 0; k < 2; k++) {
    const y = 18 + k * 14;
    slab(s, 0, y, 34, 2, P.WOOD_LIGHT, 3702 + k, 2);
    let x = 3;
    while (x < 28) {
      const w = r.int(6, 8);
      const py = y - 6;
      s.rect(x, py, w, 6, P.TERRACOTTA[2]);
      s.hline(x - 1, py, w + 2, P.TERRACOTTA[3]);
      s.hline(x - 1, py + 1, w + 2, P.TERRACOTTA[1]);
      s.vline(x, py, 6, P.TERRACOTTA[3], 0.7);
      s.vline(x + w - 1, py, 6, P.TERRACOTTA[0], 0.8);
      s.hline(x, py + 5, w, P.OUTLINE, 0.7);
      // overgrown: leaves above, tendrils spilling over the shelf edge
      const ramp = r.chance(0.5) ? P.VEG_LEAF : P.BUSH;
      for (let i = 0; i < 8; i++) {
        const lx = x + r.int(0, w - 1), ly = py - r.int(1, 7);
        s.ellipse(lx - 1, ly, 4, 3, ramp[2]);
        s.ellipse(lx - 1, ly, 3, 2, ramp[3]);
        s.px(lx, ly, ramp[4]);
      }
      const tl = r.int(3, 9);
      for (let k2 = 0; k2 < tl; k2++) {
        const tx = x + Math.round(Math.sin(k2 * 0.5) * 1.5);
        s.px(tx, y + 2 + k2, ramp[2]);
        if (k2 % 3 === 0) s.px(tx + 1, y + 2 + k2, ramp[3]);
      }
      x += w + 2;
    }
  }
  return finish(s, 'cold');
}

function labCrates(): Surface {
  const s = new Surface(32, 30);
  contact(s, 16, 29, 30, 5, 0.3);
  const box = (x: number, y: number, w: number, h: number, seed: number, open: boolean) => {
    s.rect(x, y, w, h, P.WOOD[2]);
    wood(s, x, y, w, h, P.WOOD, seed, 'h');
    s.hline(x, y, w, P.WOOD_LIGHT[4], 0.85);
    s.rectOutline(x, y, w, h, P.OUTLINE, 0.7);
    s.hline(x, y + h - 1, w, P.OUTLINE, 0.95);
    for (const bx of [x, x + w - 3]) {
      s.rect(bx, y, 3, h, P.WOOD[bx === x ? 3 : 1]);
      s.vline(bx + 2, y, h, P.WOOD[0], 0.8);
    }
    if (open) { // straw and an artefact poking out
      s.rect(x + 3, y - 3, w - 6, 4, P.GRASS_DRY[2]);
      for (let i = 0; i < 8; i++) s.px(x + 3 + i, y - 3 - (i % 2), P.GRASS_DRY[3], 0.8);
      s.ellipse(x + w / 2 - 3, y - 6, 6, 6, P.SHRINE_STONE[3]);
      s.ellipse(x + w / 2 - 2, y - 5, 4, 4, P.SHRINE_STONE[4]);
      s.px(x + w / 2 - 1, y - 4, P.SHRINE_TRIM[3]);
    }
  };
  box(1, 14, 18, 15, 3711, false);
  box(19, 17, 13, 12, 3712, false);
  box(4, 2, 15, 12, 3713, true);
  // rolled charts leaning against the stack — a fat bundle, not a stick
  for (let k = 0; k < 5; k++) {
    const x0 = 27 + k, x1 = 23 + k;
    s.line(x0, 9, x1, 29, k === 0 ? P.UI_PARCHMENT[4] : k < 3 ? P.UI_PARCHMENT[3] : P.UI_PARCHMENT[1]);
  }
  s.line(27, 9, 31, 9, P.UI_PARCHMENT[4]);
  s.line(23, 29, 27, 29, P.OUTLINE, 0.6);
  s.ellipse(27, 7, 6, 4, P.UI_PARCHMENT[3]);
  s.ellipse(28, 8, 4, 2, P.UI_PARCHMENT[1]);
  s.hline(25, 18, 5, P.TWINE, 0.85);
  return finish(s, 'cold');
}

/** The Echo artefact. The only saturated violet in any town interior. */
function labEchoStand(frame: number): Surface {
  const s = new Surface(22, 36);
  contact(s, 11, 35, 18, 5, 0.32);
  // a plain wooden stand, so the artefact does all the talking
  s.ellipse(3, 30, 16, 5, P.WALL_WOOD[2]);
  s.ellipse(4, 30, 14, 4, P.WALL_WOOD[3], 0.8);
  s.ellipseOutline(3, 30, 16, 5, P.OUTLINE, 0.7);
  leg(s, 9, 20, 11, P.WALL_WOOD, 4);
  s.ellipse(5, 17, 12, 5, P.WALL_WOOD[3]);
  s.ellipse(6, 17, 10, 4, P.WOOD_LIGHT[4], 0.6);
  s.ellipseOutline(5, 17, 12, 5, P.OUTLINE, 0.7);
  // a glass cloche
  s.ellipseOutline(3, 2, 16, 18, P.GLASS_CLEAR[3], 0.5);
  s.ellipse(4, 3, 14, 16, P.GLASS_CLEAR[2], 0.13);
  s.line(6, 5, 5, 11, P.GLASS_CLEAR[4], 0.4);
  // the shard itself, breathing on the frame
  const pulse = [0, 1, 2, 1][frame];
  const cy = 12 - (pulse > 1 ? 1 : 0);
  s.poly([[11, cy - 7], [15, cy], [11, cy + 7], [7, cy]], P.ECHO_VIOLET[2]);
  s.poly([[11, cy - 6], [14, cy], [11, cy + 5], [9, cy]], P.ECHO_VIOLET[3]);
  s.poly([[11, cy - 4], [12, cy], [11, cy + 3], [10, cy]], P.ECHO_VIOLET[4]);
  s.line(11, cy - 6, 11, cy + 5, P.ECHO_RUNE, 0.55 + pulse * 0.15);
  s.px(11, cy - 2, P.ECHO_GLOW);
  glow(s, 11, cy, 12 + pulse, P.ECHO_GLOW, 0.22 + pulse * 0.09);
  glow(s, 11, 30, 12, P.ECHO_VIOLET[3], 0.14 + pulse * 0.05);
  // motes orbiting inside the glass
  const r = rng(3721 + frame * 17);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + frame * 0.5;
    s.px(11 + Math.round(Math.cos(a) * 5), cy + Math.round(Math.sin(a) * 6), P.ECHO_RUNE, 0.8);
  }
  s.px(r.int(6, 15), r.int(5, 18), P.ECHO_CYAN[4], 0.7);
  return finish(s, 'cold', 0.28);
}

function labCarpetRoll(): Surface {
  const s = new Surface(32, 18);
  contact(s, 16, 17, 30, 4, 0.3);
  const rolls: Ramp[] = [P.RUG_BLUE, P.RUG_RED, P.ROPE];
  for (let i = 0; i < 3; i++) {
    const y = 14 - i * 4 - (i === 2 ? 1 : 0);
    const x = 1 + i * 2;
    const w = 30 - i * 4;
    const R = rolls[i];
    s.rect(x, y - 4, w, 5, R[2]);
    cloth(s, x, y - 4, w, 5, R, 3731 + i);
    s.hline(x, y - 4, w, R[4], 0.8);
    s.hline(x, y, w, P.OUTLINE, 0.8);
    // the spiral end
    s.ellipse(x - 1, y - 5, 6, 7, R[1]);
    s.ellipse(x, y - 4, 4, 5, R[3]);
    s.ellipse(x + 1, y - 3, 2, 3, R[0]);
    s.ellipseOutline(x - 1, y - 5, 6, 7, R[0], 0.7);
    s.hline(x + w - 6, y - 3, 5, R[0], 0.5);
  }
  return finish(s, 'cold');
}

function labStove(): Surface {
  const s = new Surface(24, 40);
  contact(s, 12, 39, 20, 5, 0.3);
  // flue
  s.rect(14, 0, 5, 14, P.IRON[2]);
  metal(s, 14, 0, 5, 14, P.IRON);
  s.hline(13, 4, 7, P.IRON[3]);
  s.hline(13, 5, 7, P.IRON[0], 0.8);
  // body
  s.rect(3, 12, 18, 22, P.IRON[2]);
  texture(s, 3, 12, 18, 22, P.IRON, 3741, { scale: 4, lo: 0.42, hi: 0.62 });
  s.hline(3, 12, 18, P.IRON[4], 0.85);
  s.vline(3, 12, 22, P.IRON[3], 0.7);
  s.vline(20, 12, 22, P.IRON[0]);
  s.hline(3, 33, 18, P.OUTLINE, 0.9);
  s.rect(2, 10, 20, 3, P.IRON[3]);        // the top plate
  s.hline(2, 10, 20, P.IRON[4]);
  s.hline(2, 12, 20, P.IRON[0], 0.8);
  // grate door with the fire behind it
  s.ellipse(6, 18, 12, 11, P.IRON[1]);
  s.ellipse(7, 19, 10, 9, P.SOOT[0]);
  for (let k = 0; k < 4; k++) {
    s.hline(8, 20 + k * 2, 8, k % 2 ? P.FIRE[2] : P.FIRE[3], 0.9);
    s.hline(8, 21 + k * 2, 8, P.FIRE[0], 0.5);
  }
  s.ellipseOutline(6, 18, 12, 11, P.IRON[3], 0.9);
  s.px(17, 23, P.BRONZE[3]);
  glow(s, 12, 24, 16, P.FIRE[3], 0.3);
  // legs and an ash pan
  for (const lx of [4, 17]) { s.rect(lx, 33, 3, 4, P.IRON[1]); s.vline(lx, 33, 4, P.IRON[3], 0.7); }
  s.rect(7, 34, 10, 3, P.IRON[2]);
  s.hline(7, 34, 10, P.IRON[4], 0.7);
  s.hline(7, 36, 10, P.OUTLINE, 0.8);
  speckle(s, rng(3742), 8, 35, 8, 2, P.SOOT[3], 5, 0.7);
  // a kettle on top
  s.ellipse(3, 4, 10, 7, P.IRON[2]);
  s.ellipse(4, 5, 8, 5, P.IRON[3], 0.9);
  s.px(3, 6, P.IRON[4]);
  s.hline(6, 2, 4, P.IRON[3]);
  s.hline(12, 6, 3, P.IRON[1]);
  return finish(s, 'hearth');
}

function labLadder(): Surface {
  const s = new Surface(18, 52);
  contact(s, 9, 51, 14, 4, 0.28);
  for (const x of [2, 13]) {
    s.rect(x, 0, 3, 50, P.WOOD_LIGHT[2]);
    wood(s, x, 0, 3, 50, P.WOOD_LIGHT, 3751 + x, 'v');
    s.vline(x, 0, 50, P.WOOD_LIGHT[4], 0.85);
    s.vline(x + 2, 0, 50, P.WOOD[0], 0.9);
    s.hline(x, 49, 3, P.OUTLINE, 0.85);
  }
  for (let k = 0; k < 8; k++) {
    const y = 3 + k * 6;
    s.rect(4, y, 10, 2, P.WOOD_LIGHT[3]);
    s.hline(4, y, 10, P.WOOD_LIGHT[4], 0.9);
    s.hline(4, y + 1, 10, P.WOOD[0], 0.85);
    s.px(3, y, P.WOOD[0], 0.6); s.px(14, y, P.WOOD[0], 0.6);
  }
  return finish(s, 'cold');
}

function labArmchair(scratched: boolean): Surface {
  const s = new Surface(28, 30);
  contact(s, 14, 29, 26, 5, 0.3);
  const R = scratched ? P.LEATHER : P.CLOTH.sera;
  // back
  s.rect(3, 2, 22, 16, R[2]);
  cloth(s, 3, 2, 22, 16, R, 3761 + (scratched ? 1 : 0));
  s.hline(3, 2, 22, R[4], 0.9);
  s.vline(3, 2, 16, R[3], 0.6);
  s.vline(24, 2, 16, R[0], 0.8);
  for (let i = 0; i < 3; i++) { // buttoning
    s.px(8 + i * 6, 7, R[0], 0.8);
    s.px(8 + i * 6, 6, R[4], 0.5);
  }
  // seat cushion, sunk between the arms. On the old leather chair it is a
  // loose linen cushion, which also gives that chair the value contrast the
  // leather ramp cannot supply on its own.
  const C = scratched ? P.LINEN : R;
  s.rect(5, 15, 18, 8, C[2]);
  cloth(s, 5, 15, 18, 8, C, 3765);
  s.hline(5, 15, 18, C[4], 0.85);
  s.hline(5, 16, 18, C[3], 0.5);
  s.hline(5, 22, 18, P.OUTLINE, 0.85);
  s.hline(6, 19, 16, C[1], 0.35);   // the crease of the cushion
  if (scratched) {
    s.ellipse(6, 16, 16, 6, C[3], 0.4);
    for (let i = 0; i < 5; i++) s.px(8 + i * 3, 21, C[1], 0.6);
  }
  // arms, drawn over the seat so they read as in front of it
  for (const [ax, lit] of [[0, true], [22, false]] as const) {
    s.rect(ax, 11, 6, 12, R[lit ? 3 : 1]);
    cloth(s, ax, 11, 6, 12, R, 3763 + ax);
    s.ellipse(ax, 8, 6, 6, R[lit ? 4 : 2]);
    s.ellipse(ax + 1, 9, 4, 4, R[lit ? 3 : 0], 0.5);
    s.ellipseOutline(ax, 8, 6, 6, R[0], 0.75);
    s.vline(lit ? ax : ax + 5, 11, 12, R[lit ? 4 : 0], 0.85);
    s.vline(lit ? ax + 5 : ax, 11, 12, R[lit ? 1 : 2], 0.6);
    s.hline(ax, 22, 6, P.OUTLINE, 0.9);
  }
  leg(s, 4, 23, 5, P.WOOD);
  leg(s, 20, 23, 5, P.WOOD);
  if (scratched) {
    // claw marks down the left arm, and stuffing coming out
    for (let i = 0; i < 4; i++) {
      s.line(1 + i, 12, 1 + i, 19, P.LEATHER[0], 0.8);
      s.px(1 + i, 12, P.LEATHER[4], 0.5);
    }
    s.ellipse(1, 17, 4, 3, P.LINEN[3]);
    s.ellipse(2, 18, 2, 2, P.LINEN[4]);
    s.px(0, 16, P.LINEN[2]);
  } else {
    // a blanket over one arm and a book left face-down on the seat
    s.rect(20, 8, 8, 9, P.RUG_BLUE[2]);
    cloth(s, 20, 8, 8, 9, P.RUG_BLUE, 3767);
    s.hline(20, 8, 8, P.RUG_BLUE[4], 0.8);
    s.hline(20, 16, 8, P.RUG_BLUE[0], 0.8);
    s.rect(9, 17, 9, 4, P.LEATHER[2]);
    s.hline(9, 17, 9, P.LEATHER[4], 0.8);
    s.hline(9, 20, 9, P.OUTLINE, 0.7);
    s.vline(13, 17, 4, P.LEATHER[0], 0.7);
  }
  return finish(s, 'cold');
}

function labPaperStack(): Surface {
  const s = new Surface(18, 24);
  contact(s, 9, 23, 16, 4, 0.3);
  const r = rng(3771);
  let y = 22;
  let ox = 0;
  while (y > 4) {
    const n = r.int(2, 4);
    ox += r.int(-1, 1);
    ox = Math.max(-2, Math.min(3, ox));
    for (let k = 0; k < n; k++) {
      s.hline(2 + ox, y, 13, P.UI_PARCHMENT[k === n - 1 ? 4 : 3]);
      s.px(2 + ox, y, P.UI_PARCHMENT[2]);
      s.px(14 + ox, y, P.UI_PARCHMENT[1]);
      y--;
    }
    s.hline(2 + ox, y + 1, 13, P.OUTLINE, 0.3);
  }
  // the top sheet slipping off, and a paperweight holding the rest
  s.hline(4, 3, 12, P.UI_PARCHMENT[4]);
  s.hline(5, 2, 11, P.UI_PARCHMENT[3]);
  for (let i = 0; i < 4; i++) s.hline(6, 4 + i, 6, P.UI_INK_SOFT, 0.35);
  s.ellipse(8, 0, 6, 5, P.SHRINE_STONE[3]);
  s.ellipse(9, 1, 4, 3, P.SHRINE_STONE[4], 0.8);
  return finish(s, 'cold');
}

function labOpenBook(): Surface {
  const s = new Surface(16, 10);
  contact(s, 8, 9, 14, 3, 0.25);
  s.poly([[0, 4], [7, 2], [15, 4], [15, 8], [7, 6], [0, 8]], P.UI_PARCHMENT[4]);
  s.poly([[0, 4], [7, 2], [7, 6], [0, 8]], P.UI_PARCHMENT[3]);
  s.line(7, 2, 7, 6, P.UI_PARCHMENT[1]);
  for (let i = 0; i < 3; i++) {
    s.hline(2, 5 + i, 4, P.UI_INK_SOFT, 0.45);
    s.hline(9, 5 + i, 4, P.UI_INK_SOFT, 0.4);
  }
  s.line(0, 8, 7, 6, P.LEATHER[1]);
  s.line(7, 6, 15, 8, P.LEATHER[0]);
  s.hline(1, 9, 14, P.OUTLINE, 0.4);
  return finish(s, 'cold', 0.25);
}

function labSpecimen(): Surface {
  const s = new Surface(14, 18);
  contact(s, 7, 17, 12, 3, 0.28);
  s.rect(3, 5, 8, 11, P.GLASS_CLEAR[1]);
  s.rect(4, 9, 6, 6, P.MOSS[1]);
  s.hline(4, 9, 6, P.MOSS[3], 0.8);
  for (let k = 0; k < 4; k++) s.px(5 + (k % 3), 11 + k, P.MOSS[3], 0.9);
  s.vline(3, 5, 11, P.GLASS_CLEAR[3], 0.85);
  s.vline(4, 5, 11, P.GLASS_CLEAR[4], 0.4);
  s.vline(10, 5, 11, P.GLASS_CLEAR[0], 0.9);
  s.hline(3, 15, 8, P.OUTLINE, 0.85);
  s.rect(2, 3, 10, 3, P.WOOD_LIGHT[2]);
  s.hline(2, 3, 10, P.WOOD_LIGHT[4], 0.85);
  s.hline(2, 5, 10, P.WOOD[0]);
  s.rect(4, 16, 6, 1, P.UI_PARCHMENT[3]); // a label, unreadable on purpose
  glow(s, 7, 12, 8, P.MOSS[4], 0.18);
  return finish(s, 'cold');
}

// ── The Courier Office ──────────────────────────────────────────────────────

/**
 * A parcel in wrap `i`. Quest Two turns on the player recognising a package
 * they saw somewhere else, so the wrap colour, the ROPE tie and the amber
 * label are taken straight from `prop/town/parcel_<i>`'s vocabulary — index i
 * here is index i there, and P.PARCEL_WRAP is the shared source.
 */
function parcelBox(s: Surface, x: number, y: number, w: number, h: number, wrap: number, seed: number) {
  const R = P.PARCEL_WRAP[wrap % P.PARCEL_WRAP.length];
  s.rect(x, y, w, h, R[2]);
  texture(s, x, y, w, h, [R[1], R[2], R[2], R[3], R[3]], seed, { scale: 3.6, lo: 0.42, hi: 0.6 });
  s.hline(x, y, w, R[3], 0.95);
  s.vline(x, y, h, R[3], 0.7);
  s.vline(x + w - 1, y, h, R[0], 0.9);
  s.hline(x, y + h - 1, w, R[0], 0.9);
  s.hline(x, y + h - 1, w, P.OUTLINE, 0.6);
  // paper creases
  for (let j = y + 2; j < y + h - 2; j += 3) s.hline(x + 1, j, w - 2, R[1], 0.35);
  // twine, both ways, with a knot
  const mx = x + Math.floor(w / 2);
  const my = y + Math.floor(h / 2);
  s.vline(mx, y, h, P.ROPE[3]);
  if (w > 6) s.vline(mx + 1, y, h, P.ROPE[0], 0.6);
  s.hline(x, my, w, P.ROPE[3]);
  s.hline(x, my + 1, w, P.ROPE[0], 0.6);
  s.px(mx - 1, y + 1, P.ROPE[4]);
  // the amber address label with a wax dot, as in town
  if (w >= 9 && h >= 7) {
    s.rect(x + 2, y + 2, 3, 2, P.LANTERN[1]);
    s.px(x + 2, y + 2, P.LANTERN[3]);
    s.px(x + 5, y + 2, P.FLOWER_ROSE[0]);
  }
}

function postParcel(wrap: number): Surface {
  const s = new Surface(16, 14);
  contact(s, 8, 13, 14, 4, 0.3);
  parcelBox(s, 1, 2, 14, 11, wrap, 3801 + wrap);
  return finish(s, 'lamp');
}

function postParcelStack(): Surface {
  const s = new Surface(28, 30);
  contact(s, 14, 29, 26, 5, 0.3);
  parcelBox(s, 1, 16, 17, 13, 0, 3811);
  parcelBox(s, 18, 19, 10, 10, 3, 3812);
  parcelBox(s, 4, 5, 13, 11, 1, 3813);
  parcelBox(s, 15, 8, 11, 11, 2, 3814);
  // a tube parcel across the top
  s.rect(3, 0, 18, 5, P.PARCEL_WRAP[0][2]);
  s.hline(3, 0, 18, P.PARCEL_WRAP[0][4], 0.9);
  s.hline(3, 4, 18, P.OUTLINE, 0.85);
  s.ellipse(2, 0, 4, 5, P.PARCEL_WRAP[0][3]);
  s.ellipse(3, 1, 2, 3, P.PARCEL_WRAP[0][1]);
  s.vline(12, 0, 5, P.TWINE, 0.85);
  return finish(s, 'lamp');
}

function postCounter(): Surface {
  const s = new Surface(48, 32);
  contact(s, 24, 31, 46, 5, 0.3);
  panelFront(s, 0, 12, 48, 18, P.WALL_WOOD, 3821, 3);
  slab(s, 0, 6, 48, 6, P.WOOD_LIGHT, 3822, 3);
  s.hline(0, 6, 48, P.WOOD_LIGHT[4]);
  // a hatch line and a worn patch where everything is slid across
  s.vline(31, 6, 6, P.WOOD[0], 0.5);
  s.ellipse(6, 7, 16, 4, P.WOOD_LIGHT[4], 0.22);
  // sorting slots along the back edge
  for (let i = 0; i < 5; i++) {
    const x = 2 + i * 6;
    s.rect(x, 1, 5, 6, P.WALL_WOOD[2]);
    s.rect(x + 1, 2, 3, 5, P.SOOT[1]);
    s.hline(x, 1, 5, P.WOOD_LIGHT[4], 0.7);
    s.vline(x + 4, 1, 6, P.WOOD[0], 0.8);
    if (i % 2 === 0) { s.hline(x + 1, 3, 3, P.UI_PARCHMENT[4]); s.hline(x + 1, 4, 3, P.UI_PARCHMENT[2]); }
  }
  // the day's work on the counter
  parcelBox(s, 34, 0, 11, 7, 2, 3823);
  s.rect(24, 2, 7, 4, P.UI_PARCHMENT[4]);
  s.hline(24, 2, 7, P.UI_PARCHMENT[3]);
  s.hline(24, 5, 7, P.OUTLINE, 0.5);
  s.line(25, 3, 29, 3, P.UI_INK_SOFT, 0.5);
  return finish(s, 'lamp');
}

function postPigeonholes(part: 'l' | 'mid' | 'r'): Surface {
  const s = new Surface(32, 48);
  const R = P.WALL_WOOD;
  s.rect(0, 0, 32, 46, R[1]);
  wood(s, 0, 0, 32, 46, R, 3831 + part.length, 'v');
  s.hline(0, 0, 32, P.WOOD_LIGHT[4], 0.85);
  s.hline(0, 45, 32, P.OUTLINE, 0.9);
  if (part === 'l') s.vline(0, 0, 46, P.WOOD_LIGHT[3], 0.8);
  if (part === 'r') s.vline(31, 0, 46, R[0]);
  const r = rng(3841 + part.length);
  const cols = 4, rows = 6;
  const cw = 8, ch = 7;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = cx * cw + 1, y = cy * ch + 2;
      s.rect(x, y, cw - 2, ch - 2, P.SOOT[1]);
      // the inside of the hole, dark at the top
      for (let j = 0; j < ch - 2; j++) s.hline(x, y + j, cw - 2, P.SOOT[0], 0.5 - j * 0.1);
      s.hline(x, y - 1, cw - 1, P.WOOD_LIGHT[4], 0.8);   // the lit shelf lip
      s.hline(x, y + ch - 2, cw - 1, P.WOOD[0], 0.9);
      s.vline(x - 1, y - 1, ch, R[3], 0.6);
      s.vline(x + cw - 2, y - 1, ch, R[0], 0.8);
      // contents
      const roll = r.next();
      if (roll < 0.34) {
        for (let k = 0; k < r.int(2, 4); k++) {
          s.hline(x + 1, y + ch - 4 + k - 2, cw - 4, P.UI_PARCHMENT[k % 2 ? 3 : 4]);
        }
      } else if (roll < 0.52) {
        parcelBox(s, x + 1, y + 1, cw - 4, ch - 4, r.int(0, 3), 3851 + cx * 7 + cy * 13);
      } else if (roll < 0.62) {
        s.rect(x + 1, y + 1, 3, ch - 4, P.LEATHER[2]);   // a ledger on its side
        s.vline(x + 1, y + 1, ch - 4, P.LEATHER[3]);
      }
      // a small brass number plate under each hole
      s.px(x + 1, y + ch - 3, P.BRONZE[3]);
      s.px(x + 2, y + ch - 3, P.BRONZE[1]);
    }
  }
  wallShadow(s, 1, 2, 0.28);
  return finish(s, 'lamp');
}

function postRouteMap(): Surface {
  const s = new Surface(48, 38);
  const R = P.WOOD;
  s.rect(0, 0, 48, 36, R[2]);
  wood(s, 0, 0, 48, 36, R, 3861, 'h');
  s.hline(0, 0, 48, P.WOOD_LIGHT[4], 0.85);
  s.hline(0, 35, 48, P.OUTLINE, 0.9);
  s.vline(47, 0, 36, R[0]);
  // cork
  s.rect(3, 3, 42, 30, P.ROPE[2]);
  texture(s, 3, 3, 42, 30, P.ROPE, 3862, { scale: 2.4, lo: 0.42, hi: 0.6 });
  s.rectOutline(3, 3, 42, 30, R[0], 0.8);
  // the valley map pinned in the middle
  s.rect(9, 6, 30, 21, P.UI_PARCHMENT[3]);
  texture(s, 9, 6, 30, 21, P.UI_PARCHMENT, 3863, { scale: 5, lo: 0.42, hi: 0.6 });
  s.rectOutline(9, 6, 30, 21, P.UI_PARCHMENT[1], 0.7);
  s.hline(9, 6, 30, P.UI_PARCHMENT[4], 0.8);
  s.line(13, 22, 20, 14, P.DIRT[2], 0.9);        // roads
  s.line(20, 14, 30, 16, P.DIRT[2], 0.9);
  s.line(20, 14, 24, 8, P.DIRT[1], 0.8);
  s.line(15, 9, 22, 11, P.WATER[2], 0.85);
  s.line(22, 11, 26, 20, P.WATER[2], 0.85);
  s.ellipseOutline(28, 18, 8, 7, P.WOODS_GRASS[2], 0.6);
  // pins, and string running between them and out to notes on the cork
  const pins: Array<[number, number]> = [[13, 22], [20, 14], [30, 16], [24, 8]];
  const notes: Array<[number, number]> = [[4, 8], [41, 5], [42, 26], [5, 28]];
  for (let i = 0; i < pins.length; i++) {
    s.line(pins[i][0], pins[i][1], pins[(i + 1) % pins.length][0], pins[(i + 1) % pins.length][1], P.TWINE, 0.8);
    s.line(pins[i][0], pins[i][1], notes[i][0] + 2, notes[i][1] + 2, P.TWINE, 0.55);
  }
  for (const [px, py] of pins) {
    s.px(px, py - 1, P.ROOF_RED[3]);
    s.px(px, py, P.ROOF_RED[2]);
    s.px(px + 1, py, P.ROOF_RED[0]);
  }
  // the notes themselves, one pinned crooked
  notes.forEach(([nx, ny], i) => {
    const w = 6, h = 6;
    s.rect(nx, ny, w, h, P.UI_PARCHMENT[4]);
    s.hline(nx, ny, w, P.UI_PARCHMENT[3]);
    s.hline(nx, ny + h - 1, w, P.OUTLINE, 0.5);
    for (let k = 0; k < 3; k++) s.hline(nx + 1, ny + 1 + k, w - 2 - (k % 2), P.UI_INK_SOFT, 0.4);
    if (i === 2) s.hline(nx, ny - 1, w, P.UI_PARCHMENT[2], 0.8); // curling
    s.px(nx + 3, ny, P.IRON[3]);
  });
  wallShadow(s, 1, 2, 0.3);
  return finish(s, 'lamp', 0.3);
}

function postScales(): Surface {
  const s = new Surface(20, 24);
  contact(s, 10, 23, 16, 4, 0.3);
  s.rect(5, 18, 10, 4, P.WALL_WOOD[2]);
  s.hline(5, 18, 10, P.WOOD_LIGHT[4], 0.85);
  s.hline(5, 21, 10, P.OUTLINE, 0.9);
  s.rect(9, 8, 2, 10, P.BRONZE[2]);
  s.vline(9, 8, 10, P.BRONZE[4], 0.9);
  s.vline(10, 8, 10, P.BRONZE[0]);
  // beam, tipped: one pan is loaded
  s.line(2, 7, 17, 9, P.BRONZE[3]);
  s.line(2, 8, 17, 10, P.BRONZE[1]);
  s.px(9, 7, P.BRONZE[4]);
  for (const [px, py] of [[2, 7], [17, 9]] as const) {
    s.line(px, py, px, py + 3, P.BRONZE[1], 0.8);
    s.ellipse(px - 3, py + 3, 7, 4, P.BRONZE[2]);
    s.ellipse(px - 2, py + 3, 5, 3, P.BRONZE[4], 0.7);
    s.ellipseOutline(px - 3, py + 3, 7, 4, P.BRONZE[0], 0.7);
  }
  parcelBox(s, 0, 6, 6, 5, 3, 3871);
  s.rect(15, 10, 4, 2, P.IRON[2]);          // the weights
  s.hline(15, 10, 4, P.IRON[4], 0.8);
  return finish(s, 'lamp');
}

function postStampDesk(): Surface {
  const s = new Surface(30, 28);
  contact(s, 15, 27, 28, 5, 0.3);
  panelFront(s, 1, 12, 28, 14, P.WALL_WOOD, 3881, 2);
  slab(s, 0, 7, 30, 5, P.WOOD_LIGHT, 3882, 3);
  // ink pad, stamps in a rack, a sponge and a pile of stamped sheets
  s.rect(2, 3, 8, 4, P.IRON[2]);
  s.rect(3, 2, 6, 3, P.ROOF_PLUM[1]);
  s.hline(3, 2, 6, P.ROOF_PLUM[2], 0.8);
  s.hline(2, 6, 8, P.OUTLINE, 0.7);
  for (let i = 0; i < 3; i++) {
    const x = 12 + i * 4;
    s.rect(x, 1, 3, 4, P.WOOD_LIGHT[2]);
    s.hline(x, 1, 3, P.WOOD_LIGHT[4], 0.9);
    s.rect(x, 5, 3, 2, P.IRON[1]);
    s.hline(x, 6, 3, P.OUTLINE, 0.7);
  }
  s.rect(11, 7, 13, 1, P.WOOD[0], 0.6);
  papers(s, 24, 2, 6, 4, 3883);
  s.px(25, 4, P.ROOF_PLUM[2]); s.px(26, 4, P.ROOF_PLUM[1]); // an ink smudge
  return finish(s, 'lamp');
}

function postSacks(): Surface {
  const s = new Surface(32, 26);
  contact(s, 16, 25, 30, 5, 0.3);
  const r = rng(3891);
  const sack = (x: number, baseY: number, w: number, h: number, seed: number, tied: boolean) => {
    s.ellipse(x, baseY - h, w, h + 2, P.CLOTH.cream[2]);
    const g = new Surface(32, 26);
    cloth(g, x, baseY - h, w, h + 2, P.CLOTH.cream, seed);
    s.blitInside(g, 0, 0, 0.6);
    s.ellipse(x + 1, baseY - h + 1, w - 3, h - 1, P.CLOTH.cream[3], 0.35);
    s.ellipseOutline(x, baseY - h, w, h + 2, P.CLOTH.cream[0], 0.75);
    for (let k = 0; k < 3; k++) { // creases
      const cx2 = x + 2 + k * 3;
      s.line(cx2, baseY - h + 3, cx2 - 1, baseY - 2, P.CLOTH.cream[1], 0.5);
    }
    if (tied) {
      s.hline(x + 2, baseY - h - 1, w - 4, P.ROPE[3], 0.9);
      s.hline(x + 2, baseY - h, w - 4, P.ROPE[1], 0.8);
      for (let i = 0; i < 4; i++) s.px(x + 3 + i * 2, baseY - h - 2 - (i % 2), P.CLOTH.cream[3]);
    }
    s.hline(x + 2, baseY - 1, w - 4, P.OUTLINE, 0.6);
  };
  sack(0, 25, 14, 14, 3892, true);
  sack(13, 25, 13, 12, 3893, true);
  sack(20, 24, 12, 15, 3894, false);
  sack(6, 14, 13, 9, 3895, true);
  // an official flap, stencilled with a shape rather than a word
  s.rect(3, 16, 6, 5, P.PARCEL_WRAP[1][2]);
  s.hline(3, 16, 6, P.PARCEL_WRAP[1][4], 0.8);
  s.px(5, 18, P.CLOTH.cream[4]); s.px(6, 18, P.CLOTH.cream[4]); s.px(5, 19, P.CLOTH.cream[3]);
  // letters spilling from the untied one
  for (let i = 0; i < 4; i++) {
    const lx = 24 + r.int(0, 6), ly = 20 + r.int(0, 4);
    s.rect(lx, ly, 5, 3, P.UI_PARCHMENT[4]);
    s.hline(lx, ly, 5, P.UI_PARCHMENT[3]);
    s.hline(lx, ly + 2, 5, P.OUTLINE, 0.5);
    s.px(lx + 2, ly + 1, P.ROOF_RED[2]);
  }
  return finish(s, 'lamp');
}

function postHandcart(): Surface {
  const s = new Surface(36, 30);
  contact(s, 18, 29, 32, 5, 0.3);
  // wheel
  s.ellipse(2, 14, 14, 14, P.WOOD[1]);
  s.ellipse(3, 15, 12, 12, P.WOOD[2]);
  s.ellipse(6, 18, 6, 6, P.WOOD[3]);
  s.ellipse(8, 20, 2, 2, P.IRON[3]);
  s.ellipseOutline(2, 14, 14, 14, P.IRON[2], 0.9);
  s.ellipseOutline(3, 15, 12, 12, P.WOOD[0], 0.7);
  for (let a = 0; a < 6; a++) {
    const ang = (a / 6) * Math.PI * 2;
    s.line(9, 21, 9 + Math.round(Math.cos(ang) * 6), 21 + Math.round(Math.sin(ang) * 6), P.WOOD[3], 0.8);
  }
  // the box
  s.rect(10, 8, 24, 13, P.WOOD[2]);
  wood(s, 10, 8, 24, 13, P.WOOD, 3901, 'h');
  s.hline(10, 8, 24, P.WOOD_LIGHT[4], 0.9);
  s.hline(10, 20, 24, P.OUTLINE, 0.9);
  s.vline(10, 8, 13, P.WOOD_LIGHT[3], 0.6);
  s.vline(33, 8, 13, P.WOOD[0]);
  for (const by of [14, 17]) { s.hline(10, by, 24, P.WOOD[0], 0.6); s.hline(10, by + 1, 24, P.WOOD_LIGHT[3], 0.25); }
  s.rect(10, 21, 24, 3, P.WOOD[1]);
  s.hline(10, 23, 24, P.OUTLINE, 0.8);
  // handles and a prop leg
  s.line(30, 6, 35, 2, P.WOOD_LIGHT[2]);
  s.line(31, 7, 36, 3, P.WOOD_LIGHT[0]);
  s.rect(28, 24, 2, 5, P.WOOD[1]);
  s.hline(28, 28, 2, P.OUTLINE, 0.8);
  // load
  parcelBox(s, 12, 1, 10, 8, 0, 3902);
  parcelBox(s, 22, 3, 9, 6, 1, 3903);
  s.hline(13, 0, 8, P.TWINE, 0.7);
  return finish(s, 'lamp');
}

function postClock(): Surface {
  const s = new Surface(18, 20);
  s.ellipse(0, 0, 18, 18, P.WALL_WOOD[2]);
  s.ellipse(1, 1, 16, 16, P.WALL_WOOD[3]);
  s.ellipse(2, 2, 14, 14, P.UI_PARCHMENT[4]);
  s.ellipseOutline(0, 0, 18, 18, P.OUTLINE, 0.8);
  s.ellipseOutline(2, 2, 14, 14, P.BRONZE[2], 0.8);
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    const x = 9 + Math.round(Math.cos(a) * 5.5);
    const y = 9 + Math.round(Math.sin(a) * 5.5);
    s.px(x, y, h % 3 === 0 ? P.UI_INK : P.UI_INK_SOFT);
  }
  s.line(9, 9, 9, 5, P.UI_INK);
  s.line(9, 9, 12, 11, P.UI_INK);
  s.px(9, 9, P.BRONZE[1]);
  s.ellipse(3, 3, 6, 5, P.CLOTH.cream[4], 0.16); // glass
  wallShadow(s, 1, 2, 0.3);
  return finish(s, 'lamp', 0.25);
}

function postRoster(): Surface {
  const s = new Surface(22, 28);
  const R = P.WOOD;
  s.rect(0, 0, 22, 26, R[2]);
  wood(s, 0, 0, 22, 26, R, 3911, 'v');
  s.hline(0, 0, 22, P.WOOD_LIGHT[4], 0.85);
  s.hline(0, 25, 22, P.OUTLINE, 0.9);
  s.rect(2, 2, 18, 22, P.UI_PARCHMENT[3]);
  s.rectOutline(2, 2, 18, 22, R[0], 0.8);
  // ruled rows, ticks, one crossing-out
  for (let k = 0; k < 6; k++) {
    const y = 4 + k * 3;
    s.hline(3, y + 2, 16, P.UI_INK_SOFT, 0.25);
    s.hline(4, y, 8 - (k % 3), P.UI_INK_SOFT, 0.5);
    if (k !== 3) { s.px(16, y, P.MOSS[3]); s.px(17, y + 1, P.MOSS[3]); s.px(15, y + 1, P.MOSS[2]); }
    else { s.line(4, y, 12, y + 1, P.ROOF_RED[2], 0.8); }
  }
  s.vline(13, 3, 21, P.UI_INK_SOFT, 0.3);
  s.px(11, 1, P.IRON[3]); // the nail it hangs from
  wallShadow(s, 1, 2, 0.28);
  return finish(s, 'lamp', 0.25);
}

function postBell(): Surface {
  const s = new Surface(14, 13);
  contact(s, 7, 12, 13, 4, 0.3);
  // a pale wooden base, so the brass dome has something to sit against
  s.ellipse(1, 8, 12, 4, P.WOOD_LIGHT[2]);
  s.ellipse(2, 8, 10, 3, P.WOOD_LIGHT[4], 0.85);
  s.ellipseOutline(1, 8, 12, 4, P.WOOD[0], 0.8);
  s.hline(3, 11, 8, P.OUTLINE, 0.7);
  // the dome, lit hard from the upper left
  s.ellipse(2, 2, 10, 8, P.BRONZE[2]);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 10; i++) {
      if (s.alphaAt(2 + i, 2 + j) === 0) continue;
      const u = (i / 9) * 0.55 + (j / 7) * 0.45;
      s.px(2 + i, 2 + j, u < 0.2 ? P.BRONZE[4] : u < 0.4 ? P.BRONZE[3] : u < 0.68 ? P.BRONZE[2] : u < 0.86 ? P.BRONZE[1] : P.BRONZE[0]);
    }
  }
  s.px(4, 3, P.UI_GOLD[4]);          // specular
  s.px(5, 3, P.UI_GOLD[4]);
  s.ellipse(2, 7, 10, 3, P.BRONZE[1]);
  s.hline(3, 9, 8, P.BRONZE[0], 0.9);
  s.ellipseOutline(2, 2, 10, 8, P.BRONZE[0], 0.5);
  // the plunger on top
  s.vline(6, 0, 2, P.BRONZE[3]);
  s.px(6, 0, P.UI_GOLD[4]);
  s.px(7, 1, P.BRONZE[1]);
  return finish(s, 'lamp');
}

function postLostShelf(): Surface {
  const s = new Surface(30, 34);
  contact(s, 15, 33, 28, 5, 0.3);
  const R = P.WALL_WOOD;
  s.rect(0, 0, 30, 32, R[1]);
  wood(s, 0, 0, 30, 32, R, 3921, 'v');
  s.rect(2, 2, 26, 28, P.SOOT[1]);
  s.hline(0, 0, 30, P.WOOD_LIGHT[4], 0.85);
  s.hline(0, 31, 30, P.OUTLINE, 0.9);
  s.vline(0, 0, 32, R[3], 0.7);
  s.vline(29, 0, 32, R[0]);
  // three shelves of things nobody came back for
  for (let k = 0; k < 3; k++) {
    const y = 2 + k * 9;
    if (k === 0) { // an umbrella and a hat
      s.line(4, y + 7, 9, y + 1, P.ROOF_TEAL[2]);
      s.line(5, y + 7, 10, y + 1, P.ROOF_TEAL[0]);
      s.px(4, y + 7, P.WOOD_LIGHT[3]);
      s.ellipse(13, y + 2, 12, 5, P.LEATHER[2]);
      s.ellipse(15, y, 8, 5, P.LEATHER[3]);
      s.hline(15, y + 2, 8, P.LEATHER[0], 0.8);
    } else if (k === 1) { // a single boot and a bundle of keys
      s.poly([[4, y + 7], [4, y + 2], [7, y + 2], [8, y + 5], [11, y + 5], [11, y + 7]], P.LEATHER[2]);
      s.hline(4, y + 7, 8, P.OUTLINE, 0.8);
      s.px(5, y + 3, P.LEATHER[4]);
      s.ellipseOutline(15, y + 2, 5, 5, P.BRONZE[3], 0.9);
      s.line(19, y + 4, 22, y + 6, P.BRONZE[2]);
      s.px(22, y + 7, P.BRONZE[1]); s.px(21, y + 7, P.BRONZE[3]);
    } else { // parcels never collected
      parcelBox(s, 3, y + 1, 10, 7, 2, 3922);
      parcelBox(s, 15, y + 2, 10, 6, 0, 3923);
    }
    s.hline(2, y + 8, 26, P.WOOD_LIGHT[4], 0.85);
    s.hline(2, y + 9, 26, P.OUTLINE, 0.8);
  }
  return finish(s, 'lamp');
}

function postBench(): Surface {
  const s = new Surface(32, 22);
  contact(s, 16, 21, 30, 5, 0.28);
  for (const lx of [2, 26]) {
    s.rect(lx, 12, 4, 9, P.WOOD[1]);
    s.vline(lx, 12, 9, P.WOOD[3], 0.7);
    s.hline(lx, 20, 4, P.OUTLINE, 0.85);
  }
  slab(s, 0, 8, 32, 5, P.WOOD_LIGHT, 3931, 3);
  // a back of two rails
  for (const by of [0, 4]) {
    s.rect(2, by, 28, 3, P.WOOD_LIGHT[2]);
    s.hline(2, by, 28, P.WOOD_LIGHT[4], 0.9);
    s.hline(2, by + 2, 28, P.WOOD[0], 0.85);
  }
  s.vline(3, 0, 9, P.WOOD[1], 0.8);
  s.vline(28, 0, 9, P.WOOD[0], 0.8);
  s.ellipse(6, 9, 10, 4, P.WOOD_LIGHT[4], 0.2); // worn seats
  s.ellipse(18, 9, 10, 4, P.WOOD_LIGHT[4], 0.2);
  return finish(s, 'lamp');
}

function postLetters(): Surface {
  const s = new Surface(14, 10);
  contact(s, 7, 9, 12, 3, 0.26);
  for (let k = 0; k < 3; k++) {
    const x = 1 + k, y = 6 - k * 2;
    s.rect(x, y, 11, 4, P.UI_PARCHMENT[4]);
    s.hline(x, y, 11, P.UI_PARCHMENT[3]);
    s.hline(x, y + 3, 11, P.OUTLINE, 0.55);
    s.line(x, y, x + 5, y + 2, P.UI_PARCHMENT[2], 0.7);
    s.line(x + 10, y, x + 5, y + 2, P.UI_PARCHMENT[2], 0.7);
  }
  s.ellipse(5, 4, 4, 3, P.ROOF_RED[2]);   // a wax seal
  s.ellipse(6, 4, 2, 2, P.ROOF_RED[3]);
  return finish(s, 'lamp', 0.3);
}

// ── Shared furnishings ──────────────────────────────────────────────────────

function bed(style: 'single' | 'double' | 'bunk'): Surface {
  const w = style === 'double' ? 34 : 24;
  const h = style === 'bunk' ? 54 : 42;
  const s = new Surface(w, h);
  contact(s, w / 2, h - 1, w - 2, 5, 0.3);
  const R = P.WALL_WOOD;
  const quilt = style === 'double' ? P.RUG_RED : style === 'bunk' ? P.RUG_BLUE : P.CLOTH.nia;
  const frame = (top: number, bot: number, headH: number) => {
    // headboard
    s.rect(1, top, w - 2, headH, R[2]);
    wood(s, 1, top, w - 2, headH, R, 3941 + top, 'v');
    s.hline(1, top, w - 2, P.WOOD_LIGHT[4], 0.9);
    s.hline(1, top + headH - 1, w - 2, P.OUTLINE, 0.8);
    for (let x = 4; x < w - 4; x += 5) s.vline(x, top + 1, headH - 2, R[0], 0.6);
    // mattress + pillow
    const my = top + headH;
    s.rect(2, my, w - 4, bot - my, P.LINEN[3]);
    cloth(s, 2, my, w - 4, bot - my, P.LINEN, 3942 + top);
    s.hline(2, my, w - 4, P.LINEN[4], 0.9);
    const pw = style === 'double' ? 12 : 14;
    s.ellipse(4, my + 1, pw, 7, P.LINEN[4]);
    s.ellipse(5, my + 2, pw - 2, 5, P.LINEN[2], 0.5);
    s.ellipseOutline(4, my + 1, pw, 7, P.LINEN[0], 0.55);
    if (style === 'double') {
      s.ellipse(w - 4 - pw, my + 1, pw, 7, P.LINEN[4]);
      s.ellipse(w - 3 - pw, my + 2, pw - 2, 5, P.LINEN[2], 0.5);
      s.ellipseOutline(w - 4 - pw, my + 1, pw, 7, P.LINEN[0], 0.55);
    }
    // quilt, folded back at an angle because nobody makes a bed square
    const qy = my + 9;
    s.rect(2, qy, w - 4, bot - qy, quilt[2]);
    cloth(s, 2, qy, w - 4, bot - qy, quilt, 3943 + top);
    s.hline(2, qy, w - 4, quilt[4], 0.85);
    s.hline(2, qy + 1, w - 4, quilt[0], 0.5);
    for (let x = 4; x < w - 4; x += 6) s.vline(x, qy + 2, bot - qy - 3, quilt[1], 0.35);
    for (let y = qy + 4; y < bot - 2; y += 5) s.hline(3, y, w - 6, quilt[1], 0.3);
    s.poly([[2, qy], [10, qy], [2, qy + 6]], P.LINEN[4]);
    s.line(10, qy, 2, qy + 6, quilt[0], 0.6);
    s.hline(2, bot - 1, w - 4, P.OUTLINE, 0.85);
  };
  if (style === 'bunk') {
    frame(0, 24, 5);
    // the ladder and posts
    for (const x of [1, w - 3]) {
      s.rect(x, 0, 2, h - 3, R[2]);
      s.vline(x, 0, h - 3, x === 1 ? P.WOOD_LIGHT[4] : P.WOOD[0], 0.85);
    }
    frame(28, h - 3, 5);
    for (let k = 0; k < 4; k++) s.hline(w - 8, 6 + k * 5, 6, P.WOOD_LIGHT[3]);
  } else {
    frame(0, h - 5, 6);
    // footboard
    s.rect(1, h - 6, w - 2, 5, R[2]);
    wood(s, 1, h - 6, w - 2, 5, R, 3944, 'v');
    s.hline(1, h - 6, w - 2, P.WOOD_LIGHT[4], 0.9);
    s.hline(1, h - 2, w - 2, P.OUTLINE, 0.9);
    for (const x of [0, w - 3]) { // posts with turned finials
      s.rect(x, 0, 3, h - 1, R[2]);
      s.vline(x, 0, h - 1, x === 0 ? P.WOOD_LIGHT[4] : P.WOOD[0], 0.9);
      s.vline(x + 2, 0, h - 1, P.WOOD[0], 0.8);
      s.ellipse(x - 1, 0, 5, 4, R[3]);
      s.ellipse(x, 1, 3, 2, P.WOOD_LIGHT[4], 0.7);
    }
  }
  return finish(s, 'lamp');
}

function nightstand(): Surface {
  const s = new Surface(16, 22);
  contact(s, 8, 21, 15, 4, 0.3);
  panelFront(s, 1, 6, 14, 13, P.WALL_WOOD, 3951, 1);
  s.hline(2, 12, 12, P.WOOD_LIGHT[3], 0.6);
  s.hline(2, 13, 12, P.OUTLINE, 0.7);
  s.px(7, 9, P.BRONZE[3]); s.px(8, 9, P.BRONZE[1]);
  s.px(7, 16, P.BRONZE[3]); s.px(8, 16, P.BRONZE[1]);
  for (const lx of [2, 12]) { s.rect(lx, 19, 2, 2, P.WOOD[1]); s.hline(lx, 20, 2, P.OUTLINE, 0.8); }
  slab(s, 0, 2, 16, 4, P.WOOD_LIGHT, 3952, 2);
  // a candle stub and a book, because someone reads here
  s.rect(3, 0, 2, 3, P.CLOTH.cream[4]);
  s.px(3, 0, P.CLOTH.cream[2]);
  s.rect(8, 0, 6, 2, P.LEATHER[2]);
  s.hline(8, 0, 6, P.LEATHER[4], 0.8);
  s.hline(8, 1, 6, P.OUTLINE, 0.6);
  return finish(s, 'lamp');
}

function dresser(): Surface {
  const s = new Surface(30, 28);
  contact(s, 15, 27, 28, 5, 0.3);
  panelFront(s, 0, 5, 30, 20, P.WALL_WOOD, 3961, 2);
  for (const dy of [10, 16]) {
    s.hline(1, dy, 28, P.WOOD_LIGHT[3], 0.55);
    s.hline(1, dy + 1, 28, P.OUTLINE, 0.75);
  }
  for (const [dx, dy] of [[7, 8], [21, 8], [7, 14], [21, 14], [7, 20], [21, 20]] as const) {
    s.hline(dx, dy, 3, P.BRONZE[3]);
    s.hline(dx, dy + 1, 3, P.BRONZE[0], 0.8);
  }
  s.hline(1, 20, 28, P.WOOD_LIGHT[3], 0.4); // one drawer left ajar
  s.rect(2, 21, 26, 4, P.WALL_WOOD[1]);
  s.hline(2, 21, 26, P.WOOD_LIGHT[4], 0.7);
  s.hline(3, 22, 8, P.LINEN[3], 0.9);       // cloth caught in it
  s.hline(4, 23, 6, P.LINEN[4], 0.7);
  for (const lx of [1, 26]) { s.rect(lx, 25, 3, 2, P.WOOD[1]); s.hline(lx, 26, 3, P.OUTLINE, 0.8); }
  slab(s, 0, 1, 30, 4, P.WOOD_LIGHT, 3962, 2);
  return finish(s, 'lamp');
}

function wardrobe(): Surface {
  const s = new Surface(28, 44);
  contact(s, 14, 43, 26, 5, 0.32);
  panelFront(s, 0, 4, 28, 38, P.WALL_WOOD, 3971, 2);
  s.vline(13, 5, 36, P.WOOD[0], 0.9);
  s.vline(14, 5, 36, P.WOOD_LIGHT[3], 0.4);
  s.px(11, 22, P.BRONZE[3]); s.px(11, 23, P.BRONZE[1]);
  s.px(16, 22, P.BRONZE[3]); s.px(16, 23, P.BRONZE[1]);
  // cornice + a suitcase stored on top
  s.rect(0, 0, 28, 4, P.WALL_WOOD[3]);
  s.hline(0, 0, 28, P.WOOD_LIGHT[4]);
  s.hline(0, 3, 28, P.OUTLINE, 0.8);
  for (const lx of [1, 24] as const) { s.rect(lx, 42, 3, 2, P.WOOD[1]); s.hline(lx, 43, 3, P.OUTLINE, 0.85); }
  return finish(s, 'lamp');
}

function smallTable(): Surface {
  const s = new Surface(22, 22);
  contact(s, 11, 21, 20, 4, 0.3);
  leg(s, 2, 10, 10, P.WOOD);
  leg(s, 17, 10, 10, P.WOOD);
  leg(s, 9, 9, 9, P.WOOD);
  s.hline(2, 16, 18, P.WOOD[1], 0.7);
  slab(s, 0, 4, 22, 6, P.WOOD_LIGHT, 3981, 3);
  s.ellipse(3, 5, 12, 4, P.WOOD_LIGHT[4], 0.22);
  return finish(s, 'lamp');
}

function lantern(frame: number): Surface {
  const s = new Surface(14, 22);
  contact(s, 7, 21, 10, 3, 0.26);
  // handle + cage
  s.ellipseOutline(4, 0, 6, 5, P.IRON[3], 0.9);
  s.rect(3, 3, 8, 2, P.IRON[2]);
  s.hline(3, 3, 8, P.IRON[4], 0.9);
  s.rect(2, 5, 10, 12, P.GLASS_CLEAR[1]);
  s.vline(2, 5, 12, P.IRON[3]);
  s.vline(11, 5, 12, P.IRON[0]);
  s.rect(2, 17, 10, 3, P.IRON[2]);
  s.hline(2, 17, 10, P.IRON[4], 0.85);
  s.hline(2, 19, 10, P.OUTLINE, 0.9);
  // the flame inside
  const h = 4 + (frame % 2);
  const sway = [0, 1, 0, -1][frame];
  for (let k = 0; k < h; k++) {
    const wdt = k < h - 1 ? 1 : 0;
    for (let i = -wdt; i <= wdt; i++) {
      s.px(6 + sway * (k > 1 ? 1 : 0) + i, 14 - k, k === 0 ? P.FIRE[2] : k < h - 1 ? P.FIRE[4] : P.FIRE[3]);
    }
  }
  s.hline(5, 15, 4, P.CLOTH.cream[3]);  // the wick holder
  glow(s, 7, 12, 11, P.LANTERN[4], 0.45 + (frame % 2) * 0.07);
  s.vline(3, 6, 10, P.GLASS_CLEAR[4], 0.3);
  return finish(s, 'lamp', 0.3);
}

function candle(frame: number): Surface {
  const s = new Surface(10, 18);
  contact(s, 5, 17, 9, 3, 0.28);
  // dish
  s.ellipse(0, 12, 10, 5, P.BRONZE[2]);
  s.ellipse(1, 12, 8, 4, P.BRONZE[4], 0.7);
  s.ellipseOutline(0, 12, 10, 5, P.BRONZE[0], 0.8);
  s.px(9, 13, P.BRONZE[1]);
  // wax, with drips
  const melt = frame % 2;
  s.rect(3, 4 + melt, 4, 9 - melt, P.CLOTH.cream[3]);
  s.vline(3, 4 + melt, 9 - melt, P.CLOTH.cream[4]);
  s.vline(6, 4 + melt, 9 - melt, P.CLOTH.cream[1]);
  s.px(6, 8, P.CLOTH.cream[0]);
  s.px(2, 9, P.CLOTH.cream[2]);
  s.px(2, 10, P.CLOTH.cream[1]);
  // flame
  const h = 4 + (frame === 1 ? 1 : 0);
  const sway = [0, 0, 1, -1][frame];
  for (let k = 0; k < h; k++) {
    const wdt = k < h - 1 ? 1 : 0;
    for (let i = -wdt; i <= wdt; i++) {
      s.px(4 + sway * (k > 1 ? 1 : 0) + i, 3 + melt - k, k === 0 ? P.FIRE[2] : k < h - 1 ? P.FIRE[4] : P.FIRE[3]);
    }
  }
  glow(s, 5, 2, 9, P.LANTERN[4], 0.4);
  return finish(s, 'lamp', 0.3);
}

function chest(open: boolean): Surface {
  const s = new Surface(24, open ? 24 : 20);
  contact(s, 12, s.h - 1, 22, 5, 0.3);
  const R = P.WOOD;
  const bodyY = open ? 10 : 8;
  s.rect(1, bodyY, 22, s.h - bodyY - 1, R[2]);
  wood(s, 1, bodyY, 22, s.h - bodyY - 1, R, 3991, 'h');
  s.hline(1, bodyY, 22, P.WOOD_LIGHT[4], 0.85);
  s.vline(1, bodyY, s.h - bodyY - 1, P.WOOD_LIGHT[3], 0.6);
  s.vline(22, bodyY, s.h - bodyY - 1, R[0]);
  s.hline(1, s.h - 2, 22, P.OUTLINE, 0.9);
  for (const bx of [3, 18]) { // iron straps
    s.rect(bx, bodyY, 3, s.h - bodyY - 1, P.IRON[2]);
    metal(s, bx, bodyY, 3, s.h - bodyY - 1, P.IRON);
    s.px(bx + 1, bodyY + 2, P.IRON[4]);
  }
  if (open) {
    // lid thrown back, and what is inside
    s.rect(2, 0, 20, 6, R[1]);
    wood(s, 2, 0, 20, 6, R, 3992, 'h');
    s.hline(2, 0, 20, P.WOOD_LIGHT[3], 0.7);
    s.hline(2, 5, 20, P.OUTLINE, 0.8);
    s.rect(2, 6, 20, 4, P.SOOT[0]);
    for (let k = 0; k < 3; k++) {
      s.hline(4 + k * 5, 8 - (k % 2), 5, [P.LINEN[3], P.RUG_BLUE[2], P.UI_GOLD[3]][k]);
      s.hline(4 + k * 5, 9 - (k % 2), 5, [P.LINEN[1], P.RUG_BLUE[0], P.UI_GOLD[1]][k]);
    }
  } else {
    // domed lid
    for (let k = 0; k < 6; k++) {
      const inset = k < 2 ? 3 - k : 1;
      s.hline(1 + inset, 2 + k, 22 - inset * 2, R[k < 2 ? 3 : 2]);
    }
    wood(s, 3, 2, 18, 6, R, 3993, 'h');
    s.hline(3, 2, 18, P.WOOD_LIGHT[4], 0.9);
    s.hline(1, 7, 22, R[0], 0.85);
    for (const bx of [3, 18]) { s.rect(bx, 2, 3, 6, P.IRON[2]); metal(s, bx, 2, 3, 6, P.IRON); }
  }
  s.rect(10, bodyY - 2, 4, 5, P.BRONZE[2]);   // lock plate
  s.hline(10, bodyY - 2, 4, P.BRONZE[4], 0.9);
  s.px(11, bodyY + 1, P.SOOT[0]);
  return finish(s, 'lamp');
}

function rugSprite(shape: 'round' | 'runner'): Surface {
  const s = new Surface(shape === 'round' ? 24 : 34, shape === 'round' ? 20 : 16);
  contact(s, s.w / 2, s.h - 1, s.w - 4, 3, 0.2);
  const R = shape === 'round' ? P.RUG_BLUE : P.RUG_RED;
  const A = shape === 'round' ? P.CLOTH.cream : P.UI_GOLD;
  if (shape === 'round') {
    s.ellipse(0, 0, 24, 19, R[2]);
    const g = new Surface(s.w, s.h);
    cloth(g, 0, 0, 24, 19, R, 4001);
    s.blitInside(g);
    for (let k = 0; k < 3; k++) {
      s.ellipseOutline(2 + k * 3, 2 + k * 2, 20 - k * 6, 15 - k * 4, k % 2 ? A[3] : R[k === 0 ? 4 : 1], 0.75);
    }
    s.ellipse(10, 8, 4, 3, A[2], 0.9);
    s.ellipseOutline(0, 0, 24, 19, R[0], 0.8);
  } else {
    s.rect(1, 1, 32, 14, R[2]);
    cloth(s, 1, 1, 32, 14, R, 4002);
    s.rectOutline(1, 1, 32, 14, R[0], 0.85);
    s.rectOutline(3, 3, 28, 10, A[3], 0.7);
    for (let x = 6; x < 30; x += 5) {
      for (let d = -2; d <= 2; d++) {
        const wdt = 2 - Math.abs(d);
        for (let i = -wdt; i <= wdt; i++) s.px(x + i, 8 + d, A[2], 0.8);
      }
    }
    s.hline(1, 1, 32, R[4], 0.5);
    for (let y = 2; y < 14; y += 2) { // fringe on the short ends only
      s.px(0, y, P.CLOTH.cream[3], 0.8);
      s.px(33, y, P.CLOTH.cream[2], 0.8);
    }
  }
  return finish(s, 'lamp', 0.22);
}

function doorSprite(open: boolean): Surface {
  const s = new Surface(16, 32);
  const R = P.WOOD;
  if (open) {
    // swung inward: a narrow face and the dark opening beside it
    s.rect(9, 0, 7, 32, R[2]);
    wood(s, 9, 0, 7, 32, R, 4011, 'v');
    s.vline(9, 0, 32, P.WOOD_LIGHT[4], 0.9);
    s.vline(15, 0, 32, R[0]);
    s.hline(9, 31, 7, P.OUTLINE, 0.85);
    for (const by of [4, 26]) { s.hline(9, by, 7, R[0], 0.7); s.hline(9, by + 1, 7, P.WOOD_LIGHT[3], 0.3); }
    s.px(10, 17, P.BRONZE[3]);
    // the room beyond: dark overhead, its lit floor showing at the bottom
    s.rect(0, 0, 9, 32, P.SOOT[0]);
    for (let j = 0; j < 32; j++) s.hline(0, j, 9, P.SOOT[2], (j / 32) * 0.35);
    for (let j = 22; j < 32; j++) {
      s.hline(0, j, 9, P.WINDOW_AMBER[2], (j - 21) * 0.05);
      if (j > 27) s.hline(1, j, 7, P.WINDOW_AMBER[3], (j - 27) * 0.07);
    }
    s.vline(8, 0, 32, P.OUTLINE, 0.7);
    s.vline(0, 0, 32, P.WOOD[0], 0.8);
  } else {
    s.rect(0, 0, 16, 32, R[2]);
    wood(s, 0, 0, 16, 32, R, 4012, 'v');
    s.hline(0, 0, 16, P.WOOD_LIGHT[4], 0.9);
    s.vline(0, 0, 32, P.WOOD_LIGHT[3], 0.6);
    s.vline(15, 0, 32, R[0]);
    s.hline(0, 31, 16, P.OUTLINE, 0.9);
    // two panels and a plank rhythm
    for (const [py, ph] of [[3, 12], [17, 11]] as const) {
      s.rectOutline(3, py, 10, ph, R[0], 0.8);
      s.hline(4, py + 1, 8, P.WOOD_LIGHT[4], 0.45);
      s.vline(4, py + 1, ph - 2, P.WOOD_LIGHT[3], 0.35);
      s.hline(4, py + ph - 2, 8, R[0], 0.5);
    }
    s.ellipse(11, 15, 4, 4, P.BRONZE[2]);   // knob
    s.ellipse(12, 15, 2, 2, P.BRONZE[4]);
    s.rect(1, 12, 2, 4, P.IRON[2]);         // hinges
    s.rect(1, 22, 2, 4, P.IRON[2]);
  }
  return finish(s, 'lamp');
}

function wallShelfSprite(variant: 'a' | 'b'): Surface {
  const s = new Surface(variant === 'a' ? 26 : 20, variant === 'a' ? 16 : 14);
  const R = P.WOOD;
  const sy = s.h - 4;
  for (const bx of [2, s.w - 5]) { // brackets
    s.line(bx, sy, bx, s.h - 1, R[1]);
    s.line(bx, sy, bx + (bx < 5 ? 3 : -3), s.h - 1, R[2]);
  }
  slab(s, 0, sy - 3, s.w, 3, P.WOOD_LIGHT, 4021 + variant.length, 2);
  const r = rng(4022 + variant.length);
  if (variant === 'a') {
    books(s, 2, sy - 12, 12, 9, 4023, false);
    s.ellipse(16, sy - 8, 7, 7, P.TERRACOTTA[2]);   // a small pot
    s.ellipse(17, sy - 7, 5, 5, P.TERRACOTTA[3]);
    for (let i = 0; i < 5; i++) {
      const lx = 17 + r.int(0, 4), ly = sy - 10 - r.int(0, 3);
      s.ellipse(lx - 1, ly, 4, 3, P.BUSH[2]);
      s.px(lx, ly, P.BUSH[4]);
    }
  } else {
    for (let i = 0; i < 3; i++) bottle(s, 2 + i * 5, sy - 4, 7 + i, i === 1 ? P.GLASS_GREEN : P.GLASS_CLEAR);
    s.ellipse(15, sy - 6, 5, 5, P.CERAMIC[3]);
    s.ellipse(16, sy - 5, 3, 3, P.CERAMIC[4]);
  }
  wallShadow(s, 1, 2, 0.28);
  return finish(s, 'lamp');
}

function mirror(): Surface {
  const s = new Surface(18, 26);
  s.ellipse(0, 0, 18, 25, P.BRONZE[2]);
  s.ellipse(1, 1, 16, 23, P.BRONZE[4], 0.7);
  s.ellipse(2, 2, 14, 21, P.GLASS_CLEAR[1]);
  // the room reflected: a wall, a floor line, and a warm lamp
  for (let y = 2; y < 23; y++) {
    for (let x = 2; x < 16; x++) {
      if (s.alphaAt(x, y) === 0) continue;
      const c = y < 13 ? P.GLASS_CLEAR[1] : P.GLASS_CLEAR[0];
      s.px(x, y, c);
    }
  }
  s.ellipse(4, 5, 5, 5, P.LANTERN[2], 0.55);
  s.ellipse(5, 6, 3, 3, P.LANTERN[4], 0.7);
  s.line(3, 13, 15, 13, P.GLASS_CLEAR[2], 0.6);
  s.line(3, 3, 8, 10, P.GLASS_CLEAR[4], 0.3);   // the sheen
  s.line(5, 3, 10, 10, P.GLASS_CLEAR[4], 0.18);
  s.ellipseOutline(0, 0, 18, 25, P.BRONZE[0], 0.7);
  s.ellipseOutline(2, 2, 14, 21, P.BRONZE[0], 0.6);
  wallShadow(s, 1, 2, 0.3);
  return finish(s, 'lamp', 0.25);
}

function washbasin(): Surface {
  const s = new Surface(22, 28);
  contact(s, 11, 27, 20, 5, 0.3);
  // the stand
  for (const lx of [2, 17]) {
    s.rect(lx, 10, 3, 16, P.WOOD[2]);
    s.vline(lx, 10, 16, lx < 8 ? P.WOOD_LIGHT[4] : P.WOOD[0], 0.85);
    s.hline(lx, 25, 3, P.OUTLINE, 0.85);
  }
  s.rect(2, 20, 18, 2, P.WOOD[1]);
  s.hline(2, 20, 18, P.WOOD[3], 0.6);
  s.rect(3, 15, 16, 4, P.LINEN[3]);           // a towel over the rail
  cloth(s, 3, 15, 16, 4, P.LINEN, 4031);
  s.hline(3, 15, 16, P.LINEN[4], 0.8);
  s.hline(3, 18, 16, P.LINEN[0], 0.7);
  slab(s, 0, 6, 22, 4, P.WOOD_LIGHT, 4032, 2);
  // basin and jug
  s.ellipse(1, 1, 14, 8, P.CERAMIC[2]);
  s.ellipse(2, 2, 12, 6, P.CERAMIC[4]);
  s.ellipse(3, 3, 10, 4, P.CERAMIC[1]);
  s.ellipse(4, 3, 8, 3, P.WATER[3], 0.85);
  s.px(5, 3, P.WATER[4]);
  s.ellipseOutline(1, 1, 14, 8, P.CERAMIC[0], 0.7);
  s.rect(15, 1, 6, 7, P.CERAMIC[2]);
  s.vline(15, 1, 7, P.CERAMIC[4], 0.9);
  s.vline(20, 1, 7, P.CERAMIC[0]);
  s.hline(15, 0, 6, P.CERAMIC[3]);
  s.px(14, 3, P.CERAMIC[3]); s.px(14, 4, P.CERAMIC[1]);
  s.hline(15, 7, 6, P.OUTLINE, 0.7);
  return finish(s, 'lamp');
}

function boots(): Surface {
  const s = new Surface(18, 14);
  contact(s, 9, 13, 16, 4, 0.3);
  for (const [bx, tone] of [[0, 3], [8, 2]] as const) {
    s.poly([[bx + 1, 12], [bx + 1, 4], [bx + 5, 3], [bx + 6, 8], [bx + 9, 9], [bx + 9, 12]], P.LEATHER[tone]);
    s.line(bx + 1, 4, bx + 5, 3, P.LEATHER[4], 0.9);
    s.line(bx + 6, 8, bx + 9, 9, P.LEATHER[1], 0.8);
    s.hline(bx + 1, 12, 9, P.OUTLINE, 0.9);
    s.hline(bx + 1, 11, 9, P.SOOT[3], 0.7);   // the sole
    s.px(bx + 2, 6, P.LEATHER[4]);
    s.px(bx + 3, 9, P.BRONZE[2]);
    speckle(s, rng(4041 + bx), bx + 1, 8, 8, 4, P.DIRT[2], 4, 0.5); // mud
  }
  return finish(s, 'lamp');
}

function bookStack(): Surface {
  const s = new Surface(16, 14);
  contact(s, 8, 13, 14, 3, 0.28);
  const r = rng(4051);
  const spines: Ramp[] = [P.ROOF_RED, P.ROOF_TEAL, P.LEATHER, P.ROOF_PLUM, P.ROOF_BLUE];
  let y = 12;
  for (let k = 0; k < 4 && y > 2; k++) {
    const w = r.int(10, 14);
    const x = r.int(1, 15 - w);
    const h = r.int(2, 3);
    const R = r.pick(spines);
    s.rect(x, y - h, w, h, R[2]);
    s.hline(x, y - h, w, R[4], 0.85);
    s.hline(x, y - 1, w, P.OUTLINE, 0.7);
    s.vline(x, y - h, h, R[3], 0.8);
    s.vline(x + w - 1, y - h, h, R[0]);
    s.hline(x + 1, y - h + 1, w - 2, P.UI_PARCHMENT[3], 0.35); // page edges
    y -= h;
  }
  // a ribbon bookmark hanging out of the top one
  s.vline(4, y, 3, P.UI_GOLD[3], 0.9);
  s.px(4, y + 3, P.UI_GOLD[1]);
  return finish(s, 'lamp');
}

// ══ registration ════════════════════════════════════════════════════════════

export function registerInteriors(b: ArtBuild): void {
  // ── floors ───────────────────────────────────────────────────────────────
  for (let i = 0; i < 4; i++) b.addTile(`tile/int/wood_floor_${i}`, woodFloorTile(P.FLOOR_WOOD, 1100, i));
  for (let i = 0; i < 4; i++) b.addTile(`tile/int/stone_floor_${i}`, stoneFloorTile(P.FLOOR_STONE, 1200, i));
  for (let i = 0; i < 4; i++) b.addTile(`tile/int/tile_floor_${i}`, tileFloorTile(1300, i));
  // plank floor with the hearth's amber pool baked in, for the ring of tiles
  // around a fire source
  for (let i = 0; i < 3; i++) {
    const s = woodFloorTile(P.FLOOR_WOOD, 1100, i);
    s.tint(P.LANTERN[3], 0.2);
    speckle(s, rng(1150 + i), 0, 0, T, T, P.LANTERN[4], 4, 0.18);
    b.addTile(`tile/int/wood_floor_warm_${i}`, s);
  }

  // ── walls ────────────────────────────────────────────────────────────────
  const styles: WallStyle[] = ['plaster', 'wood', 'stone'];
  styles.forEach((style, si) => {
    const seed = 1500 + si * 100;
    for (const part of ['top', 'mid', 'base'] as const) {
      b.addTile(`tile/int/wall_${style}_${part}`, wallTile(style, part, seed + part.length));
    }
    for (const kind of ['corner_l', 'corner_r', 'inner_l', 'inner_r'] as const) {
      b.addTile(`tile/int/wall_${style}_${kind}`, wallCorner(style, kind, seed + kind.length * 7));
    }
    b.addTile(`tile/int/wall_${style}_front`, wallFront(style, seed));
  });
  b.addTile('tile/int/wall_beam', wallBeam(1810));
  for (const d of ['n', 'w', 'e'] as const) b.addTile(`tile/int/floor_shadow_${d}`, floorShadow(d));
  for (let i = 0; i < 3; i++) b.addTile(`tile/int/wall_window_${i}`, windowTile(i));

  // ── doorways + mats ──────────────────────────────────────────────────────
  for (const part of ['top', 'mid', 'base'] as const) {
    b.addTile(`tile/int/doorway_${part}`, doorwayTile(part, false, 1900));
    b.addTile(`tile/int/doorway_lit_${part}`, doorwayTile(part, true, 1900));
  }
  for (let i = 0; i < 3; i++) b.addTile(`tile/int/doormat_${i}`, doormatTile(i));

  // ── stairs ───────────────────────────────────────────────────────────────
  for (const half of ['l', 'r'] as const) {
    b.addTile(`tile/int/stairs_up_${half}_near`, stairsTile('up', half, 'near', 2000));
    b.addTile(`tile/int/stairs_up_${half}_far`, stairsTile('up', half, 'far', 2010));
    b.addTile(`tile/int/stairs_down_${half}_near`, stairsTile('down', half, 'near', 2020));
    b.addTile(`tile/int/stairs_down_${half}_far`, stairsTile('down', half, 'far', 2030));
  }

  // ── overlay blob sets ────────────────────────────────────────────────────
  registerBlobSet(b, 'blob/rug_red', 2601, rugPainter(P.RUG_RED, P.UI_GOLD, 2601), { wobble: 0.35, radius: 5.6 });
  registerBlobSet(b, 'blob/rug_blue', 2701, rugPainter(P.RUG_BLUE, P.CLOTH.cream, 2701), { wobble: 0.35, radius: 5.6 });
  registerBlobSet(b, 'blob/floor_tile', 2801, tileOverlayPainter(1300), { wobble: 0.3, radius: 4.0 });

  // ── the Lantern Inn ──────────────────────────────────────────────────────
  b.addStrip('prop/int/inn_fireplace', [0, 1, 2, 3].map(fireplace), {
    key: 'fireplace_burn', frameRate: 8, repeat: -1,
  });
  b.addStrip('prop/int/inn_range', [0, 1, 2, 3].map(innRange), {
    key: 'range_steam', frameRate: 5, repeat: -1,
  });
  b.addStrip('prop/int/inn_sconce', [0, 1, 2, 3].map(innSconce), {
    key: 'sconce_flicker', frameRate: 6, repeat: -1,
  });
  b.add('prop/int/inn_hearth_rug', innHearthRug());
  b.add('prop/int/inn_table_round', innTableRound(false));
  b.add('prop/int/inn_table_round_set', innTableRound(true));
  b.add('prop/int/inn_table_long', innTableLong());
  b.add('prop/int/inn_chair_n', innChair('n'));
  b.add('prop/int/inn_chair_s', innChair('s'));
  b.add('prop/int/inn_chair_e', innChair('e'));
  b.add('prop/int/inn_chair_w', innChair('e').flipX());
  b.add('prop/int/inn_chair_pushed', innChair('pushed'));
  b.add('prop/int/inn_bench', innBench());
  b.add('prop/int/inn_bar_l', innBar('l'));
  b.add('prop/int/inn_bar_mid', innBar('mid'));
  b.add('prop/int/inn_bar_r', innBar('r'));
  b.add('prop/int/inn_stool', innStool());
  b.add('prop/int/inn_shelf_bottles', innShelf('bottles'));
  b.add('prop/int/inn_shelf_mugs', innShelf('mugs'));
  b.add('prop/int/inn_shelf_crocks', innShelf('crocks'));
  b.add('prop/int/inn_pots_hanging', innPotsHanging());
  b.add('prop/int/inn_bread_rack', innBreadRack());
  b.add('prop/int/inn_barrel', innBarrel(false));
  b.add('prop/int/inn_barrel_stack', innBarrel(true));
  b.add('prop/int/inn_keg', innKeg());
  b.add('prop/int/inn_newel', innNewel());
  b.add('prop/int/inn_herbs', innHerbs());
  b.add('prop/int/inn_lectern', innLectern());
  b.add('prop/int/inn_coatrack', innCoatRack());
  b.add('prop/int/inn_catbed', innCatBed());
  b.add('prop/int/inn_catbowl', innCatBowl());
  b.add('prop/int/inn_firewood', innFirewood());
  b.add('prop/int/inn_picture_a', innPicture('a'));
  b.add('prop/int/inn_picture_b', innPicture('b'));
  b.add('prop/int/inn_clock', innClock());
  b.add('prop/int/inn_curtain_l', innCurtain('l'));
  b.add('prop/int/inn_curtain_r', innCurtain('r'));
  b.add('prop/int/inn_plant_a', innPlant('a'));
  b.add('prop/int/inn_plant_b', innPlant('b'));
  b.add('prop/int/inn_broom', innBroom());
  b.add('prop/int/inn_bucket', innBucket());
  b.add('prop/int/inn_crates_blocked', innCratesBlocked());
  b.add('prop/int/inn_mug', innTableware('mug'));
  b.add('prop/int/inn_mug_half', innTableware('mug_half'));
  b.add('prop/int/inn_plate', innTableware('plate'));
  b.add('prop/int/inn_soup', innTableware('soup'));

  // ── Sera's Workshop ──────────────────────────────────────────────────────
  b.addStrip('prop/int/lab_coil', [0, 1, 2, 3].map(labCoil), {
    key: 'coil_arc', frameRate: 8, repeat: -1,
  });
  b.addStrip('prop/int/lab_echo_stand', [0, 1, 2, 3].map(labEchoStand), {
    key: 'echo_artefact', frameRate: 4, repeat: -1,
  });
  b.addStrip('prop/int/lab_jars', [0, 1].map(labJars), {
    key: 'lab_jars_glow', frameRate: 2, repeat: -1,
  });
  b.add('prop/int/lab_bookcase_a', labBookcase(0));
  b.add('prop/int/lab_bookcase_b', labBookcase(1));
  b.add('prop/int/lab_bookcase_c', labBookcase(2));
  b.add('prop/int/lab_desk', labDesk());
  b.add('prop/int/lab_chalkboard', labChalkboard());
  b.add('prop/int/lab_orrery', labOrrery());
  b.add('prop/int/lab_workbench', labWorkbench());
  b.add('prop/int/lab_maptable', labMapTable());
  b.add('prop/int/lab_rack', labRack());
  b.add('prop/int/lab_plantshelf', labPlantShelf());
  b.add('prop/int/lab_crates', labCrates());
  b.add('prop/int/lab_carpet_roll', labCarpetRoll());
  b.add('prop/int/lab_stove', labStove());
  b.add('prop/int/lab_ladder', labLadder());
  b.add('prop/int/lab_chair_comfy', labArmchair(false));
  b.add('prop/int/lab_armchair_scratched', labArmchair(true));
  b.add('prop/int/lab_paperstack', labPaperStack());
  b.add('prop/int/lab_openbook', labOpenBook());
  b.add('prop/int/lab_specimen', labSpecimen());

  // ── The Courier Office ───────────────────────────────────────────────────
  b.add('prop/int/post_counter', postCounter());
  b.add('prop/int/post_pigeon_l', postPigeonholes('l'));
  b.add('prop/int/post_pigeon_mid', postPigeonholes('mid'));
  b.add('prop/int/post_pigeon_r', postPigeonholes('r'));
  // index i is the same wrap as prop/town/parcel_i — the delivery quest reads
  // these by colour across both maps
  for (let i = 0; i < 4; i++) b.add(`prop/int/post_parcel_${i}`, postParcel(i));
  b.add('prop/int/post_parcel_stack', postParcelStack());
  b.add('prop/int/post_routemap', postRouteMap());
  b.add('prop/int/post_scales', postScales());
  b.add('prop/int/post_stampdesk', postStampDesk());
  b.add('prop/int/post_sacks', postSacks());
  b.add('prop/int/post_handcart', postHandcart());
  b.add('prop/int/post_clock', postClock());
  b.add('prop/int/post_roster', postRoster());
  b.add('prop/int/post_bell', postBell());
  b.add('prop/int/post_lostshelf', postLostShelf());
  b.add('prop/int/post_bench', postBench());
  b.add('prop/int/post_letters', postLetters());

  // ── shared furnishings ───────────────────────────────────────────────────
  b.addStrip('prop/int/lantern', [0, 1, 2, 3].map(lantern), {
    key: 'int_lantern_glow', frameRate: 6, repeat: -1,
  });
  b.addStrip('prop/int/candle', [0, 1, 2, 3].map(candle), {
    key: 'candle_flicker', frameRate: 5, repeat: -1,
  });
  b.add('prop/int/bed_single', bed('single'));
  b.add('prop/int/bed_double', bed('double'));
  b.add('prop/int/bed_bunk', bed('bunk'));
  b.add('prop/int/nightstand', nightstand());
  b.add('prop/int/dresser', dresser());
  b.add('prop/int/wardrobe', wardrobe());
  b.add('prop/int/table_small', smallTable());
  b.add('prop/int/chest_closed', chest(false));
  b.add('prop/int/chest_open', chest(true));
  b.add('prop/int/rug_round', rugSprite('round'));
  b.add('prop/int/rug_runner', rugSprite('runner'));
  b.add('prop/int/door_closed', doorSprite(false));
  b.add('prop/int/door_open', doorSprite(true));
  b.add('prop/int/wallshelf_a', wallShelfSprite('a'));
  b.add('prop/int/wallshelf_b', wallShelfSprite('b'));
  b.add('prop/int/mirror', mirror());
  b.add('prop/int/washbasin', washbasin());
  b.add('prop/int/boots', boots());
  b.add('prop/int/books_stack', bookStack());
}
