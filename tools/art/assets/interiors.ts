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

/** Kitchen tile: 8px squares, cream and clay, deliberately low contrast. */
function tileFloorTile(seed: number, variant: number): Surface {
  const s = new Surface(T, T);
  const r = rng(seed + variant * 61);
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      const clay = (qx + qy) % 2 === 1;
      const ramp = clay ? P.FLOOR_TILE_CLAY : P.FLOOR_TILE;
      const x = qx * 8, y = qy * 8;
      texture(s, x, y, 8, 8, [ramp[1], ramp[2], ramp[2], ramp[3], ramp[3]],
        seed + variant * 13 + qx * 7 + qy * 29, { scale: 3.2, lo: 0.42, hi: 0.6 });
      s.hline(x + 1, y + 1, 6, ramp[4], 0.55);  // glazed lit edge
      s.vline(x + 1, y + 1, 6, ramp[3], 0.45);
      s.hline(x + 1, y + 6, 6, ramp[0], 0.4);
      s.vline(x + 6, y + 1, 6, ramp[0], 0.3);
      if (variant === 2 && !clay) s.px(x + 5, y + 4, ramp[1], 0.5);
    }
  }
  // grout: a continuous lattice, which is what makes tiling read as tiling
  for (let i = 0; i < T; i++) {
    for (const g of [0, 7, 8, 15]) {
      s.px(i, g, P.FLOOR_TILE[0], g === 0 || g === 8 ? 0.4 : 0.3);
      s.px(g, i, P.FLOOR_TILE[0], g === 0 || g === 8 ? 0.35 : 0.26);
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
  plaster: P.WALL_PLASTER,
  wood: sunk(P.WALL_WOOD),
  stone: sunk(P.STONE_WALL),
};

/** The wall material itself, filling the whole tile. Vertically tileable. */
function wallField(s: Surface, style: WallStyle, seed: number) {
  const ramp = WALL_RAMP[style];
  if (style === 'plaster') {
    // Deliberately narrow value range — plaster mottled across the full ramp
    // reads as camouflage, not a wall.
    // Featureless on purpose: a `mid` tile repeats every 16px across a whole
    // wall, so any mark bigger than a speckle becomes a visible grid.
    texture(s, 0, 0, T, T, [ramp[1], ramp[2], ramp[2], ramp[3], ramp[3]], seed, { scale: 6.4, lo: 0.42, hi: 0.6 });
    const r = rng(seed + 5);
    speckle(s, r, 0, 0, T, T, ramp[1], 5, 0.2);
    speckle(s, r, 0, 0, T, T, ramp[3], 4, 0.2);
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
  const th = 4;
  for (let k = 0; k < 4; k++) {
    const y = k * th;
    // Read order top-to-bottom for one step: hard riser shadow, bright nosing,
    // tread surface falling away. The black line is what makes it a step and
    // not a plank.
    wood(s, 0, y, T, th, tread, seed + k * 17, 'h');
    s.hline(0, y, T, P.OUTLINE, 0.85);           // riser in shadow
    s.hline(0, y + 1, T, tread[4], 0.95);        // lit nosing
    s.hline(0, y + 2, T, tread[2], 0.5);
    s.hline(0, y + 3, T, tread[0], 0.55);        // the tread falling away
    // worn strip up the middle where everyone treads
    for (let x = 4; x < T - 4; x++) s.px(x, y + 2, tread[3], 0.4);
    // each step further from the room loses light
    const depth = (part === 'far' ? 0 : 4) + k;
    const amt = dir === 'up' ? (7 - depth) * 0.035 : depth * 0.03;
    s.rect(0, y, T, th, P.SHRINE_STONE[0], Math.max(0, amt));
  }
  // stringer + banister on the outer edge, wall crease on the inner edge
  const bx = left ? 0 : T - 4;
  wood(s, bx, 0, 4, T, P.WOOD, seed + 71, 'v');
  s.vline(left ? 0 : T - 1, 0, T, P.WOOD[1], 0.9);
  s.vline(left ? 1 : T - 2, 0, T, P.WOOD_LIGHT[4], 0.75);
  s.vline(left ? 2 : T - 3, 0, T, P.WOOD[2], 0.7);
  s.vline(left ? 3 : T - 4, 0, T, P.WOOD[0]);
  for (let y = 0; y < T; y++) s.px(left ? 4 : T - 5, y, P.OUTLINE, 0.4);
  for (let y = 2; y < T; y += 8) { // baluster shadows on the stringer
    s.hline(bx + 1, y, 2, P.WOOD[0], 0.5);
  }
  // the dark end of the flight
  if (dir === 'up' && part === 'far') {
    for (let y = 0; y < 9; y++) s.hline(0, y, T, P.SOOT[0], 0.7 - y * 0.075);
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
    for (const [x, y] of top) s.px(x, y, accent[4], 0.55);
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
  const s = new Surface(view === 'pushed' ? 18 : 14, 24);
  const R = P.WOOD;
  const cx = s.w / 2;
  contact(s, cx, 23, s.w - 2, 5, 0.28);
  const tilt = view === 'pushed' ? 1 : 0;
  const backX = 2 + tilt;
  if (view === 'e') {
    // side view: back on the left, seat running right
    leg(s, 3, 14, 9, R);
    leg(s, 9, 15, 8, R);
    s.rect(2, 12, 11, 3, P.WOOD_LIGHT[2]);
    s.hline(2, 12, 11, P.WOOD_LIGHT[4], 0.9);
    s.hline(2, 14, 11, P.OUTLINE, 0.8);
    s.rect(2, 2, 3, 11, R[2]);
    s.vline(2, 2, 11, R[3]);
    s.vline(4, 2, 11, R[0]);
    s.hline(2, 2, 3, P.WOOD_LIGHT[4]);
  } else {
    // backrest
    const bw = 10;
    s.rect(backX, 1, bw, 10, R[2]);
    wood(s, backX, 1, bw, 10, R, 3321, 'v');
    s.hline(backX, 1, bw, P.WOOD_LIGHT[4], 0.95);
    s.hline(backX, 2, bw, P.WOOD_LIGHT[2], 0.5);
    s.vline(backX, 1, 10, R[3], 0.7);
    s.vline(backX + bw - 1, 1, 10, R[0]);
    // pierced heart-ish splat so the silhouette is not a plain rectangle
    s.rect(backX + 3, 4, 4, 5, view === 'n' ? P.OUTLINE : P.SOOT[1], 0.85);
    s.hline(backX + 3, 4, 4, R[0]);
    s.hline(backX + 1, 11, bw - 2, R[0], 0.8);
    // seat
    const sy = view === 'n' ? 12 : 13;
    s.rect(1 + tilt, sy, 12, 4, P.WOOD_LIGHT[2]);
    wood(s, 1 + tilt, sy, 12, 4, P.WOOD_LIGHT, 3322, 'h');
    s.hline(1 + tilt, sy, 12, P.WOOD_LIGHT[4], 0.9);
    s.hline(1 + tilt, sy + 3, 12, P.OUTLINE, 0.85);
    if (view === 's') { // a cushion, tied at the corners
      s.rect(3, sy - 1, 8, 3, P.RUG_RED[2]);
      cloth(s, 3, sy - 1, 8, 3, P.RUG_RED, 3323);
      s.hline(3, sy - 1, 8, P.RUG_RED[4], 0.7);
      s.hline(3, sy + 1, 8, P.RUG_RED[0], 0.8);
    }
    leg(s, 2 + tilt, sy + 4, 24 - sy - 5, R);
    leg(s, 9 + tilt, sy + 4, 24 - sy - 5, R);
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
  const R = P.WALL_WOOD;
  panelFront(s, 0, 10, 16, 18, R, 3341 + part.length, 1);
  // brass foot rail
  s.hline(0, 25, 16, P.BRONZE[3], 0.8);
  s.hline(0, 26, 16, P.BRONZE[1], 0.7);
  // counter top with a bullnose overhang
  slab(s, 0, 4, 16, 6, P.WOOD_LIGHT, 3345, 3);
  s.hline(0, 4, 16, P.WOOD_LIGHT[4]);
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
  const s = new Surface(32, 20);
  // the rail
  s.hline(0, 3, 32, P.IRON[3]);
  s.hline(0, 4, 32, P.IRON[1]);
  s.hline(0, 5, 32, P.IRON[0], 0.7);
  const r = rng(3371);
  let x = 3;
  for (let i = 0; i < 4; i++) {
    const w = r.int(7, 9), h = r.int(6, 8);
    const ramp = i % 2 ? P.COPPER : P.CERAMIC;
    s.vline(x + w / 2, 5, 2, P.IRON[2]);   // hook
    // body: a squat pan seen from the front
    s.rect(x, 7, w, h, ramp[2]);
    metal(s, x, 7, w, h, ramp);
    s.hline(x, 7, w, ramp[4], 0.9);
    s.hline(x, 6, w, ramp[3]);
    s.hline(x, 7 + h - 1, w, P.OUTLINE, 0.85);
    s.ellipse(x, 7 + h - 2, w, 3, ramp[1], 0.8);
    if (i % 2) { // a long handle sticking out
      s.hline(x + w, 9, 4, P.IRON[2]);
      s.hline(x + w, 10, 4, P.IRON[0]);
    }
    x += w + r.int(1, 2);
  }
  wallShadow(s, 1, 2, 0.26);
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
  // basket
  s.rect(1, 8, 18, 9, P.ROPE[2]);
  for (let j = 0; j < 9; j++) {
    for (let i = 0; i < 18; i++) {
      const w = ((i + j) % 4 < 2) ? P.ROPE[3] : P.ROPE[1];
      s.px(1 + i, 8 + j, w, 0.8);
    }
  }
  s.hline(1, 8, 18, P.ROPE[4], 0.8);
  s.hline(1, 16, 18, P.OUTLINE, 0.85);
  s.vline(1, 8, 9, P.ROPE[3], 0.6);
  s.vline(18, 8, 9, P.ROPE[0], 0.8);
  // split logs
  const r = rng(3461);
  for (let i = 0; i < 7; i++) {
    const x = 2 + r.int(0, 13), y = 2 + r.int(0, 5), w = r.int(4, 6);
    s.rect(x, y, w, 4, P.WOOD[2]);
    wood(s, x, y, w, 4, P.WOOD, 3462 + i, 'h');
    s.ellipse(x, y, 3, 4, P.WOOD_LIGHT[3]);
    s.ellipse(x + 1, y + 1, 1, 2, P.WOOD_LIGHT[1]);
    s.hline(x, y + 3, w, P.OUTLINE, 0.6);
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
}
