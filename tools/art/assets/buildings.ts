/**
 * LUMEN VALE — ARCHITECTURE
 *
 * Buildings are single large sprites anchored bottom-centre. Their doorway is
 * centred on the sprite's horizontal midpoint so it lands on a tile boundary
 * when the map author drops it.
 *
 * The architectural language every building here shares:
 *
 *  1. THREE-QUARTER. You see the roof surface *and* the front wall. The roof is
 *     roughly a third of the sprite height and is built from individual shingle /
 *     tile / thatch units with per-unit tone variation. A roof that is a smooth
 *     gradient is the loudest amateur tell there is.
 *  2. EAVES OVERHANG. Every roof is wider than the wall it sits on, terminates in
 *     a dark fascia board, and drops a 3px shadow band onto the wall below it.
 *  3. WINDOWS ARE THE WARMTH. Frame, mullion cross, sill, amber interior with a
 *     reflection streak in the upper-left pane, and a soft glow bleeding a few
 *     pixels onto the surrounding plaster.
 *  4. GROUNDED. The bottom of every building is a stone/brick foundation course
 *     with weeds growing against it and a soft cast shadow spreading down-right,
 *     so it sits *in* the terrain rather than on top of it.
 *  5. LIVED IN. Brooms, boot scrapers, cat flaps, drainpipes, ivy, woodpiles,
 *     laundry hooks, doormats. Occupancy detail is what separates a house from
 *     a box with a triangle on it.
 *  6. LANDMARK SILHOUETTE. The player navigates by shape and roof colour, so no
 *     two buildings share both. Cover the colours and you can still name them.
 *
 * Light is upper-left, always. Highlights drift warm, shadows drift violet.
 */
import { Surface, rng, speckle } from '../lib/pixel.js';
import { ArtBuild } from '../lib/registry.js';
import * as P from '../lib/palette.js';

type R = readonly string[];

// ── micro-utilities ────────────────────────────────────────────────────────

/** Fractional ramp lookup, clamped. Lets shading maths read as "base + 1.2". */
function pick(ramp: R, i: number): string {
  const n = ramp.length;
  return ramp[Math.max(0, Math.min(n - 1, Math.round(i)))];
}

/** Deterministic 2D hash — per-shingle / per-plank / per-stone variation. */
function h2(a: number, b: number, seed = 0): number {
  let n = (Math.round(a) * 374761393 + Math.round(b) * 668265263 + seed * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Shade a rect but only where pixels already exist (never paints into air). */
function shadeRect(s: Surface, x: number, y: number, w: number, h: number, color: string, alpha: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) s.pxOver(x + i, y + j, color, alpha);
}

/** Add the dark contact edge on the lower/right silhouette only (ART_GUIDE §3.5). */
function outlineDownRight(s: Surface, color = P.OUTLINE, alpha = 0.9) {
  const src = s.clone();
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (src.alphaAt(x, y) !== 0) continue;
      if (src.alphaAt(x, y - 1) > 180 || src.alphaAt(x - 1, y) > 180) s.px(x, y, color, alpha);
    }
  }
}

/** Warm 1px rim along the up/left silhouette — sunlight catching the edges. */
function rimLight(s: Surface, color = P.PLASTER[4], alpha = 0.2) {
  s.innerShade(color, alpha, [[0, -1], [-1, 0]]);
}

// ── ground contact ─────────────────────────────────────────────────────────

/**
 * Soft cast shadow spreading down-right from the building's base line.
 * Drawn onto a separate surface and composited *behind* the building so the
 * silhouette outline never traces around it.
 */
function groundShadow(s: Surface, x: number, y: number, w: number, rows = 6) {
  for (let j = 0; j < rows; j++) {
    const t = j / rows;
    const alpha = 0.36 * (1 - t * 0.85);
    const x0 = x + Math.round(t * 7);
    const x1 = x + w + Math.round(2 + j * 1.5);
    for (let xx = x0; xx < x1; xx++) {
      const edge = Math.min(xx - x0, x1 - 1 - xx);
      const a = edge < 3 ? alpha * (0.3 + 0.24 * edge) : alpha;
      s.px(xx, y + j, P.OUTLINE, a);
    }
  }
}

/** Weeds and grass tufts growing against the base course. Kills "pasted on". */
function baseWeeds(s: Surface, x: number, y: number, w: number, seed: number, density = 0.34, ramp: R = P.GRASS) {
  const r = rng(seed);
  for (let i = 0; i < w; i++) {
    if (!r.chance(density)) continue;
    const hgt = r.int(2, 5);
    const xx = x + i;
    for (let k = 0; k < hgt; k++) {
      s.px(xx, y - k, k >= hgt - 2 ? ramp[3] : ramp[2]);
    }
    if (hgt > 3) s.px(xx + (r.chance(0.5) ? 1 : -1), y - hgt + 1, ramp[4]);
    i += r.int(1, 3);
  }
}

// ── wall materials ─────────────────────────────────────────────────────────

interface WallOpts { seed: number; grad?: number; damp?: boolean }

/** Lime plaster: soft mottling, hairline cracks, damp staining near the ground. */
function wallPlaster(s: Surface, x: number, y: number, w: number, h: number, ramp: R, o: WallOpts) {
  const { seed } = o;
  const grad = o.grad ?? 1;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const xx = x + i, yy = y + j;
      // Large, low-contrast patches only. High-frequency noise on a wall the
      // size of a house turns into visible dirt streaks at 1x.
      const v =
        h2(Math.floor(xx / 9), Math.floor(yy / 7), seed) * 0.65 +
        h2(Math.floor(xx / 4), Math.floor(yy / 5), seed + 41) * 0.35;
      let k = 2.55;
      if (v > 0.72) k += 0.55;
      else if (v < 0.3) k -= 0.6;
      // smooth left-lit / right-shaded falloff, no banding
      k -= (i / Math.max(1, w - 1) - 0.42) * 1.5 * grad;
      if (j < 2) k += 0.25 * grad;
      s.px(xx, yy, pick(ramp, k));
    }
  }
  // hairline cracks — a couple, short, and only in the shaded half
  const r = rng(seed + 17);
  for (let c = 0; c < Math.max(1, Math.round(w / 46)); c++) {
    let cx = x + r.int(Math.floor(w / 2), w - 4);
    const cy = y + r.int(2, Math.max(3, h - 8));
    const len = r.int(4, Math.min(10, h - 3));
    for (let k = 0; k < len; k++) {
      s.pxOver(cx, cy + k, ramp[1], 0.5);
      if (r.chance(0.34)) cx += r.chance(0.5) ? 1 : -1;
    }
  }
  // splash staining rising off the ground
  if (o.damp ?? true) {
    for (let j = 0; j < Math.min(5, h); j++) {
      const a = 0.2 * (1 - j / 5);
      for (let i = 0; i < w; i++) {
        if (h2(x + i, j, seed + 91) > 0.4) s.pxOver(x + i, y + h - 1 - j, ramp[1], a);
      }
    }
  }
  speckle(s, rng(seed + 5), x + 1, y + 1, w - 2, h - 2, ramp[4], Math.round(w * h / 260), 0.3);
}

/** Horizontal lapped weatherboard — light top lip, hard shadow under each board. */
function wallBoard(s: Surface, x: number, y: number, w: number, h: number, ramp: R, seed: number, boardH = 4) {
  for (let j = 0; j < h; j++) {
    const yy = y + j;
    const b = Math.floor(j / boardH);
    const inB = j - b * boardH;
    for (let i = 0; i < w; i++) {
      const xx = x + i;
      let k = 2;
      const v = h2(b, Math.floor(xx / 11), seed);
      if (v > 0.66) k += 0.5;
      else if (v < 0.3) k -= 0.5;
      if (inB === 0) k += 1.1;
      else if (inB === boardH - 1) k -= 1.7;
      const lx = i / w;
      k += lx < 0.08 ? 0.7 : lx > 0.9 ? -0.8 : lx > 0.78 ? -0.35 : 0;
      if (h2(xx, yy, seed + 31) > 0.955) k -= 0.7;
      s.px(xx, yy, pick(ramp, k));
    }
  }
}

/** Vertical board-and-batten planking with knots. Sheds, barns, gates. */
function wallPlank(s: Surface, x: number, y: number, w: number, h: number, ramp: R, seed: number, plankW = 6) {
  for (let i = 0; i < w; i++) {
    const xx = x + i;
    const p = Math.floor(i / plankW);
    const inP = i - p * plankW;
    const tone = h2(p, 3, seed) > 0.6 ? 0.5 : h2(p, 7, seed) < 0.3 ? -0.6 : 0;
    for (let j = 0; j < h; j++) {
      const yy = y + j;
      let k = 2 + tone;
      if (inP === 0) k -= 1.6;
      else if (inP === 1) k += 0.9;
      else if (inP === plankW - 1) k -= 0.7;
      const ly = j / h;
      k += ly > 0.86 ? -0.7 : ly < 0.06 ? 0.4 : 0;
      if (h2(xx * 2, Math.floor(yy / 3), seed + 13) > 0.86) k -= 0.5;
      s.px(xx, yy, pick(ramp, k));
    }
    // knots
    if (inP === 3 && h2(p, 11, seed + 3) > 0.62) {
      const ky = y + 3 + Math.floor(h2(p, 13, seed) * (h - 8));
      s.px(xx, ky, ramp[0]); s.px(xx - 1, ky, ramp[1]);
      s.px(xx, ky + 1, ramp[1]); s.px(xx - 1, ky + 1, ramp[0]);
      s.px(xx, ky - 1, pick(ramp, 3.4), 0.7);
    }
  }
}

/** Irregular stone coursing: varied block widths, mortar joints, lit top edges. */
function wallStone(s: Surface, x: number, y: number, w: number, h: number, ramp: R, seed: number, course = 5) {
  s.rect(x, y, w, h, ramp[0]);
  let cy = y;
  let ci = 0;
  while (cy < y + h) {
    const ch = Math.min(course + (h2(ci, 1, seed) > 0.6 ? 1 : 0), y + h - cy);
    let bx = x + (ci % 2 ? -Math.round(h2(ci, 5, seed) * 4) : 0);
    while (bx < x + w) {
      const bw = 4 + Math.round(h2(bx, ci, seed) * 6);
      const x0 = Math.max(x, bx);
      const x1 = Math.min(x + w, bx + bw - 1);
      if (x1 > x0) {
        const tone = 1.4 + h2(bx * 3, ci * 7, seed + 9) * 1.7;
        for (let j = 0; j < ch - 1; j++) {
          for (let i = x0; i < x1; i++) {
            let k = tone;
            if (h2(i, cy + j, seed + 77) > 0.86) k -= 0.6;
            const lx = (i - x0) / Math.max(1, x1 - x0);
            k += lx < 0.2 ? 0.3 : lx > 0.8 ? -0.4 : 0;
            s.px(i, cy + j, pick(ramp, k));
          }
        }
        for (let i = x0; i < x1; i++) s.px(i, cy, pick(ramp, tone + 1.2));
        for (let j = 0; j < ch - 1; j++) s.px(x1 - 1, cy + j, pick(ramp, tone - 1.1));
      }
      bx += bw;
    }
    cy += ch;
    ci++;
  }
  // overall vertical falloff so the base of a wall is grounded
  for (let j = 0; j < Math.min(5, h); j++) {
    shadeRect(s, x, y + h - 1 - j, w, 1, P.OUTLINE, 0.16 * (1 - j / 5));
  }
}

// ── timber framing ─────────────────────────────────────────────────────────

function beamH(s: Surface, x: number, y: number, w: number, h: number, ramp: R, seed = 0, tone = 2) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let k = tone;
    if (j === 0) k += 1.1;
    else if (j === h - 1) k -= 1.2;
    if (h2(x + i, (y + j) * 3, seed + 21) > 0.88) k -= 0.5;
    s.px(x + i, y + j, pick(ramp, k));
  }
  shadeRect(s, x + 1, y + h, w, 1, P.OUTLINE, 0.34);
}

function beamV(s: Surface, x: number, y: number, w: number, h: number, ramp: R, seed = 0, tone = 2) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let k = tone;
    if (i === 0) k += 1.0;
    else if (i === w - 1) k -= 1.2;
    if (h2((x + i) * 3, y + j, seed + 33) > 0.88) k -= 0.5;
    s.px(x + i, y + j, pick(ramp, k));
  }
  shadeRect(s, x + w, y + 1, 1, h, P.OUTLINE, 0.34);
}

function beamDiag(s: Surface, x0: number, y0: number, x1: number, y1: number, ramp: R, thick = 3, tone = 1.6) {
  for (let t = 0; t < thick; t++) {
    const c = t === 0 ? pick(ramp, tone + 1.3) : t === thick - 1 ? pick(ramp, tone - 1.2) : pick(ramp, tone);
    s.line(x0 + t, y0, x1 + t, y1, c);
  }
  s.line(x0 + thick, y0 + 1, x1 + thick, y1 + 1, P.OUTLINE, 0.3);
}

interface FrameOpts {
  bays?: number; braces?: boolean; midRail?: boolean; ramp?: R; post?: number; tone?: number;
  /** which bays (0-indexed) get a diagonal brace; defaults to the outer two */
  braceBays?: number[];
}

/**
 * Exposed timber frame over an already-painted infill wall. Beams sit a full
 * ramp step *below* the infill so the frame reads as dark lines on cream —
 * a frame the same value as its plaster is a frame you cannot see.
 */
function timberFrame(s: Surface, x: number, y: number, w: number, h: number, seed: number, o: FrameOpts = {}) {
  const ramp = o.ramp ?? P.WOOD;
  const post = o.post ?? 3;
  const tone = o.tone ?? 1.5;
  const bays = o.bays ?? Math.max(2, Math.round(w / 26));
  beamH(s, x, y, w, 3, ramp, seed, tone);
  beamH(s, x, y + h - 3, w, 3, ramp, seed + 4, tone);
  if (o.midRail) beamH(s, x, y + Math.round(h / 2) - 1, w, 3, ramp, seed + 8, tone);
  for (let i = 0; i <= bays; i++) {
    const px0 = Math.round(x + (i * (w - post)) / bays);
    beamV(s, px0, y, post, h, ramp, seed + i * 7, tone);
  }
  if (o.braces) {
    const list = o.braceBays ?? [0, bays - 1];
    for (const bi of list) {
      const bx0 = Math.round(x + (bi * (w - post)) / bays) + post;
      const bx1 = Math.round(x + ((bi + 1) * (w - post)) / bays);
      const reach = Math.round((bx1 - bx0) * 0.62);
      if (reach < 4) continue;
      // braces fall away from the centre of the wall, like real bracing
      if (bx0 + reach < x + w / 2) beamDiag(s, bx0, y + h - 5, bx0 + reach, y + 3, ramp, 3, tone);
      else beamDiag(s, bx1 - reach - 3, y + 3, bx1 - 3, y + h - 5, ramp, 3, tone);
    }
  }
}

// ── roofs ──────────────────────────────────────────────────────────────────

type RoofMat = 'shingle' | 'tile' | 'thatch' | 'slate';

interface RoofOpts {
  ramp: R;
  seed: number;
  /** px the ridge is inset per side — 0 is a plain gable slope, >0 hips it. */
  hip?: number;
  rowH?: number;
  unitW?: number;
  mat?: RoofMat;
  ridge?: boolean;
  moss?: number;
  /** draw the eave board (2 rows) directly below the roof body */
  fascia?: boolean;
  fasciaRamp?: R;
  /** slope only to the right (lean-to / pent roof) */
  pent?: 'l' | 'r' | null;
}

/**
 * The single most important function in this module.
 *
 * A roof is drawn as a trapezoid of individual units. Each unit gets its own
 * tone from a hash, each course gets a lit top lip and a hard lap shadow at its
 * base, and courses are offset by half a unit so the vertical seams stagger.
 * On top of that sits a gentle upper-left light bias. The result reads as a
 * *surface made of things* rather than a coloured triangle.
 */
function roof(s: Surface, x: number, y: number, w: number, h: number, o: RoofOpts) {
  const hip = o.hip ?? 0;
  const rowH = o.rowH ?? 4;
  const unitW = o.unitW ?? 6;
  const mat = o.mat ?? 'shingle';
  const ramp = o.ramp;
  const seed = o.seed;

  const boundsAt = (yy: number): [number, number] => {
    const t = h <= 1 ? 1 : (yy - y) / (h - 1);
    if (o.pent === 'l') return [x, Math.round(x + w - hip * (1 - t))];
    if (o.pent === 'r') return [Math.round(x + hip * (1 - t)), x + w];
    return [Math.round(x + hip * (1 - t)), Math.round(x + w - hip * (1 - t))];
  };

  if (mat === 'thatch') {
    // Thatch is not shingles. It is a stack of thick straw courses, each one
    // overhanging the next with a deep shadow under its ragged lip, striated
    // vertically by the individual bundles. Get the lips wrong and it reads as
    // a flat khaki slab, which is exactly what cheap procedural thatch does.
    const courses = Math.max(2, Math.round(h / 10));
    const courseH = h / courses;
    for (let yy = y; yy < y + h; yy++) {
      const [L, Rt] = boundsAt(yy);
      const t = (yy - y) / h;
      for (let xx = L; xx < Rt; xx++) {
        const strand = Math.floor(xx / 2);
        let c = Math.floor((yy - y) / courseH);
        const jit = h2(strand, c, seed) * 3.2;
        let cbot = y + (c + 1) * courseH - jit;
        if (yy >= cbot) { c += 1; cbot = y + (c + 1) * courseH - h2(strand, c, seed) * 3.2; }
        const d = cbot - yy;                 // px above this course's lip
        const depth = Math.min(courseH, cbot - (y + c * courseH));
        let k: number;
        if (d <= 1.2) k = 0.4;               // the dark line under the overhang
        else if (d <= 2.6) k = 1.2;
        else if (d > depth - 2.2) k = 3.5;   // fresh straw on the course's crown
        else k = 2.5 + (1 - d / depth) * 0.5;
        // straw bundles: each 2px strand keeps its own tone down the whole course
        const sv = h2(strand, c * 7, seed + 3);
        k += sv > 0.66 ? 0.55 : sv < 0.3 ? -0.6 : 0;
        // individual stalks
        if ((xx * 3 + c * 5) % 7 === 0) k += 0.4;
        if (h2(xx, yy, seed + 19) > 0.93) k -= 0.8;
        k += t < 0.2 ? 0.6 : t > 0.82 ? -0.6 : 0;
        const lx = (xx - L) / Math.max(1, Rt - L);
        k += lx < 0.12 ? 0.6 : lx > 0.88 ? -1.0 : lx > 0.74 ? -0.4 : 0;
        s.px(xx, yy, pick(ramp, k));
      }
    }
    if (o.ridge !== false) {
      // bound ridge: a rolled cap stitched down with hazel spars
      const [L0, R0] = boundsAt(y);
      for (let j = 0; j < 4; j++) {
        for (let xx = L0 - 1; xx <= R0; xx++) {
          let k = j === 0 ? 3.4 : j === 3 ? 0.8 : 2.6;
          if ((xx + j) % 5 === 0) k -= 0.9;
          s.px(xx, y + j - 1, pick(ramp, k));
        }
      }
      for (let xx = L0; xx <= R0; xx += 7) {
        s.vline(xx, y - 1, 4, pick(ramp, 0.6), 0.8);
        s.px(xx + 1, y, pick(ramp, 4), 0.5);
      }
    }
  } else {
    for (let yy = y; yy < y + h; yy++) {
      const [L, Rt] = boundsAt(yy);
      const row = Math.floor((yy - y) / rowH);
      const inRow = (yy - y) - row * rowH;
      const off = row % 2 ? Math.floor(unitW / 2) : 0;
      const t = (yy - y) / h;
      for (let xx = L; xx < Rt; xx++) {
        const u = xx + off + 512;
        const sIdx = Math.floor(u / unitW);
        const inS = u - sIdx * unitW;
        const nv = h2(sIdx, row, seed);
        let k = 2;
        if (mat === 'slate') k += nv > 0.72 ? 1 : nv > 0.46 ? 0.4 : nv < 0.2 ? -1.1 : -0.4;
        else k += nv > 0.68 ? 0.8 : nv < 0.32 ? -0.8 : 0;
        const lx = (xx - x) / w;
        k += lx < 0.2 ? 0.55 : lx < 0.36 ? 0.22 : lx > 0.82 ? -0.85 : lx > 0.66 ? -0.35 : 0;
        k += t < 0.24 ? 0.5 : t > 0.78 ? -0.5 : 0;

        if (mat === 'tile') {
          // barrel pantiles: bright crown, dark valley, rounded bottom
          if (inS === 0) k -= 1.5;
          else if (inS === 1) k += 1.2;
          else if (inS === unitW - 1) k -= 0.9;
          if (inRow === rowH - 1) k -= 1.5;
          if (inRow === rowH - 1 && (inS === 0 || inS === unitW - 1)) k -= 1.2;
          if (inRow === 0) k += 0.5;
        } else {
          if (inRow === 0) k += 1.15;
          else if (inRow === rowH - 1) k -= 1.6;
          if (inS === 0) k -= 1.3;
          // scallop: the corners of a shingle's bottom row are the course
          // *below* peeking through, so they take that shingle's own tone.
          if (mat === 'shingle' && inRow === rowH - 1 && (inS === 0 || inS === unitW - 1)) {
            const below = h2(Math.floor((xx + (row % 2 ? 0 : Math.floor(unitW / 2)) + 512) / unitW), row + 1, seed);
            k = 2 + (below > 0.68 ? 0.8 : below < 0.32 ? -0.8 : 0) - 1.1;
          }
          // the odd lifted / weather-worn shingle
          if (mat === 'shingle' && h2(sIdx, row * 5, seed + 303) > 0.975) k -= 1.5;
        }
        s.px(xx, yy, pick(ramp, k));
      }
    }

    // hip creases — lit on the left, shadowed on the right
    if (hip > 0 && !o.pent) {
      s.line(x + hip, y, x, y + h - 1, pick(ramp, 3.6), 0.85);
      s.line(x + hip + 1, y, x + 1, y + h - 1, pick(ramp, 0.8), 0.4);
      s.line(x + w - hip - 1, y, x + w - 1, y + h - 1, pick(ramp, 0.4), 0.75);
      s.line(x + w - hip - 2, y, x + w - 2, y + h - 1, pick(ramp, 3.4), 0.35);
    }

    // ridge cap
    if (o.ridge !== false && !o.pent) {
      const [L0, R0] = boundsAt(y);
      for (let xx = L0 - 1; xx <= R0; xx++) {
        s.px(xx, y - 2, pick(ramp, 3.2));
        s.px(xx, y - 1, pick(ramp, 2.4));
        if ((xx + 100) % 5 === 0) { s.px(xx, y - 2, pick(ramp, 1)); s.px(xx, y - 1, pick(ramp, 0.6)); }
      }
      s.hline(L0 - 1, y - 3, R0 - L0 + 2, pick(ramp, 4), 0.85);
      shadeRect(s, L0, y, R0 - L0, 1, P.OUTLINE, 0.25);
    }
  }

  // moss / lichen collecting on the shaded lower courses
  if (o.moss) {
    const r = rng(seed + 404);
    const n = Math.round(w * h * 0.0022 * o.moss * 10);
    for (let i = 0; i < n; i++) {
      const yy = y + Math.round(h * (0.45 + r.next() * 0.5));
      const [L, Rt] = boundsAt(yy);
      const xx = L + r.int(0, Math.max(1, Rt - L - 1));
      const pw = r.int(2, 4), ph = r.int(1, 2);
      for (let j = 0; j < ph; j++) for (let i2 = 0; i2 < pw; i2++) {
        s.pxOver(xx + i2, yy + j, r.chance(0.6) ? P.MOSS[2] : P.MOSS[1], 0.62);
      }
      s.pxOver(xx, yy - 1, P.MOSS[3], 0.4);
    }
  }

  if (o.fascia) {
    const fr = o.fasciaRamp ?? P.WOOD;
    const [L, Rt] = boundsAt(y + h - 1);
    s.hline(L - 1, y + h, Rt - L + 2, fr[3]);
    s.hline(L - 1, y + h + 1, Rt - L + 2, fr[1]);
    s.hline(L - 1, y + h + 2, Rt - L + 2, fr[0]);
    // rafter tails peeking under the eave
    for (let xx = L + 2; xx < Rt - 2; xx += 9) s.px(xx, y + h + 2, pick(fr, 0), 1);
  }
}

/** The shadow a roof/awning throws onto the wall directly beneath it. */
function eaveShadow(s: Surface, x: number, y: number, w: number, depth = 4) {
  const a = [0.46, 0.32, 0.2, 0.11, 0.06];
  for (let j = 0; j < depth; j++) shadeRect(s, x, y + j, w, 1, P.OUTLINE, a[Math.min(j, a.length - 1)]);
}

// ── windows ────────────────────────────────────────────────────────────────

interface WinOpts {
  lit?: boolean;
  cols?: number;
  rows?: number;
  frame?: R;
  sill?: 'wood' | 'stone' | 'none';
  glow?: boolean;
  curtain?: boolean;
  clutter?: 'none' | 'books' | 'jars' | 'plant' | 'goods';
  shutters?: R | null;
  seed?: number;
  arch?: boolean;
}

/**
 * A window is a frame, a mullion cross, a sill, an amber interior, and a
 * reflection. Drop any one of those and it stops reading as glass.
 */
function win(s: Surface, x: number, y: number, w: number, h: number, o: WinOpts = {}) {
  const lit = o.lit ?? true;
  const fr = o.frame ?? P.WOOD;
  const cols = o.cols ?? 2;
  const rows = o.rows ?? 2;
  const seed = o.seed ?? 11;
  const glass = lit ? P.WINDOW_AMBER : P.GLASS_COLD;

  if (lit && (o.glow ?? true)) {
    const a = [0, 0.17, 0.1, 0.05];
    for (let d = 1; d <= 3; d++) {
      for (let i = -d; i < w + d; i++) {
        s.pxOver(x + i, y - d, P.WINDOW_AMBER[3], a[d]);
        s.pxOver(x + i, y + h - 1 + d, P.WINDOW_AMBER[3], a[d]);
      }
      for (let j = -d + 1; j < h + d - 1; j++) {
        s.pxOver(x - d, y + j, P.WINDOW_AMBER[3], a[d]);
        s.pxOver(x + w - 1 + d, y + j, P.WINDOW_AMBER[3], a[d]);
      }
    }
  }

  // reveal / recess: the opening is cut into the wall, so it has a dark lip
  shadeRect(s, x - 1, y - 1, w + 2, 1, P.OUTLINE, 0.45);
  shadeRect(s, x - 1, y, 1, h + 1, P.OUTLINE, 0.35);

  // frame
  s.rect(x, y, w, h, fr[2]);
  s.hline(x, y, w, fr[3]);
  s.vline(x, y, h, fr[3]);
  s.hline(x, y + h - 1, w, fr[0]);
  s.vline(x + w - 1, y, h, fr[0]);
  s.px(x + w - 1, y, fr[1]);
  s.px(x, y + h - 1, fr[1]);

  const gx = x + 2, gy = y + 2, gw = w - 4, gh = h - 4;
  if (gw <= 0 || gh <= 0) return;

  // glass body
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const t = j / gh;
      let k = lit ? 2 : 1.6;
      k += t < 0.3 ? 0.8 : t > 0.72 ? -0.9 : 0;
      k += i / gw < 0.28 ? 0.3 : i / gw > 0.8 ? -0.4 : 0;
      if (h2(gx + i, gy + j, seed) > 0.9) k += 0.6;
      s.px(gx + i, gy + j, pick(glass, k));
    }
  }
  // inner shadow at the head of the opening (the reveal casts down)
  shadeRect(s, gx, gy, gw, 1, P.OUTLINE, 0.28);

  // clutter silhouetted against the glow — the room behind the glass
  if (o.clutter && o.clutter !== 'none') {
    const r = rng(seed + 77);
    if (o.clutter === 'books') {
      let bx = gx + 1;
      while (bx < gx + gw - 1) {
        const bh = r.int(3, Math.max(4, Math.floor(gh * 0.55)));
        const bw = r.int(1, 2);
        for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
          s.px(bx + i, gy + gh - 1 - j, pick(P.WOOD, j === bh - 1 ? 1.4 : 0.3));
        }
        bx += bw + (r.chance(0.3) ? 1 : 0);
      }
    } else if (o.clutter === 'jars') {
      let bx = gx + 1;
      while (bx < gx + gw - 2) {
        const bh = r.int(3, 5), bw = r.int(2, 3);
        for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
          s.px(bx + i, gy + gh - 1 - j, pick(P.WOOD, j === bh - 1 ? 1.6 : 0.5));
        }
        s.px(bx, gy + gh - bh, pick(P.WINDOW_AMBER, 3), 0.5);
        bx += bw + 2;
      }
    } else if (o.clutter === 'plant') {
      const px0 = gx + Math.floor(gw / 2);
      s.rect(px0 - 2, gy + gh - 4, 5, 4, P.TERRACOTTA[2]);
      s.hline(px0 - 2, gy + gh - 4, 5, P.TERRACOTTA[3]);
      for (let i = 0; i < 7; i++) {
        const lx = px0 + r.int(-3, 3), ly = gy + gh - 5 - r.int(0, 4);
        s.px(lx, ly, P.BUSH[2]); s.px(lx, ly - 1, P.BUSH[3]);
      }
    } else if (o.clutter === 'goods') {
      let bx = gx + 1;
      while (bx < gx + gw - 2) {
        const bh = r.int(4, Math.max(5, gh - 3)), bw = r.int(3, 5);
        for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
          s.px(bx + i, gy + gh - 1 - j, pick(P.WOOD, j === bh - 1 ? 1.8 : i === 0 ? 1.2 : 0.6));
        }
        bx += bw + 2;
      }
    }
  }

  // mullions
  for (let c = 1; c < cols; c++) {
    const mx = gx + Math.round((c * gw) / cols) - 1;
    s.vline(mx, gy, gh, fr[1]);
    s.px(mx, gy, fr[3]);
    for (let j = 0; j < gh; j++) s.px(mx + 1, gy + j, pick(glass, 0.6), 0.55);
  }
  for (let c = 1; c < rows; c++) {
    const my = gy + Math.round((c * gh) / rows) - 1;
    s.hline(gx, my, gw, fr[1]);
    for (let i = 0; i < gw; i++) s.px(gx + i, my + 1, pick(glass, 0.6), 0.55);
  }

  // reflection streak in the upper-left pane
  const pw = Math.max(2, Math.floor(gw / cols));
  const ph = Math.max(2, Math.floor(gh / rows));
  const len = Math.min(pw, ph) - 1;
  for (let i = 0; i < len; i++) {
    s.px(gx + 1 + i, gy + ph - 3 - i, pick(glass, 4));
    if (i < len - 1) s.px(gx + 2 + i, gy + ph - 3 - i, pick(glass, 4));
    s.px(gx + i, gy + ph - 3 - i, pick(glass, 3.4), 0.7);
  }

  // curtain
  if (o.curtain) {
    const cr = P.CANVAS;
    for (let i = 0; i < gw; i++) {
      const dip = ((i + seed) % 6 < 3) ? 1 : 0;
      for (let j = 0; j < 2 + dip; j++) s.px(gx + i, gy + j, pick(cr, j === 0 ? 4 : 2.6));
    }
    shadeRect(s, gx, gy + 3, gw, 1, P.OUTLINE, 0.2);
  }

  // sill
  const sill = o.sill ?? 'wood';
  if (sill !== 'none') {
    const sr = sill === 'stone' ? P.STONE_WALL : P.WOOD_LIGHT;
    s.rect(x - 1, y + h, w + 2, 2, sr[2]);
    s.hline(x - 1, y + h, w + 2, sr[4]);
    s.hline(x - 1, y + h + 1, w + 2, sr[0]);
    shadeRect(s, x, y + h + 2, w + 2, 1, P.OUTLINE, 0.34);
    shadeRect(s, x + 1, y + h + 3, w + 1, 1, P.OUTLINE, 0.16);
  }

  // shutters
  if (o.shutters) {
    const sr = o.shutters;
    for (const sx of [x - 4, x + w]) {
      wallPlank(s, sx, y, 4, h, sr, seed + sx, 2);
      s.vline(sx === x - 4 ? sx : sx + 3, y, h, sr[0]);
      s.hline(sx, y, 4, sr[3]);
      s.px(sx + 1, y + 2, P.IRON[3]); s.px(sx + 2, y + 2, P.IRON[1]);
      s.px(sx + 1, y + h - 3, P.IRON[3]); s.px(sx + 2, y + h - 3, P.IRON[1]);
      shadeRect(s, sx + (sx === x - 4 ? 4 : 0), y + 1, 1, h, P.OUTLINE, 0.3);
    }
  }
}

/** Small round or arched attic light. */
function oculus(s: Surface, cx: number, cy: number, d: number, lit = true) {
  const glass = lit ? P.WINDOW_AMBER : P.GLASS_COLD;
  const x = cx - Math.floor(d / 2), y = cy - Math.floor(d / 2);
  if (lit) {
    s.ellipse(x - 2, y - 2, d + 4, d + 4, P.WINDOW_AMBER[3], 0.12);
    s.ellipse(x - 1, y - 1, d + 2, d + 2, P.WINDOW_AMBER[3], 0.12);
  }
  s.ellipse(x, y, d, d, P.WOOD[2]);
  s.ellipseOutline(x, y, d, d, P.WOOD[0]);
  s.ellipse(x + 1, y + 1, d - 2, d - 2, glass[2]);
  s.ellipse(x + 1, y + 1, d - 2, Math.max(1, Math.floor((d - 2) / 2)), glass[3]);
  s.hline(x + 1, y + Math.floor(d / 2), d - 2, P.WOOD[1]);
  s.vline(x + Math.floor(d / 2), y + 1, d - 2, P.WOOD[1]);
  s.px(x + 2, y + 2, glass[4]);
  s.px(x + 3, y + 2, glass[4]);
  s.ellipseOutline(x, y, d, Math.max(2, d - 1), P.WOOD[3], 0.35);
}

// ── doors ──────────────────────────────────────────────────────────────────

type DoorStyle = 'plank' | 'panel' | 'arch' | 'stable' | 'shrine';

interface DoorOpts {
  ramp?: R;
  seed?: number;
  catflap?: boolean;
  knocker?: boolean;
  step?: boolean;
  /** lit glazed panes in the upper third of the leaf */
  glazed?: boolean;
  /** cased surround: a light architrave so the opening reads against a dark wall */
  architrave?: R;
}

function door(s: Surface, x: number, y: number, w: number, h: number, style: DoorStyle, o: DoorOpts = {}) {
  const ramp = o.ramp ?? P.WOOD;
  const seed = o.seed ?? 5;

  // cased surround
  if (o.architrave) {
    const a = o.architrave;
    for (const jx of [x - 3, x + w]) beamV(s, jx, y - 3, 3, h + 3, a, seed + jx, 2.2);
    beamH(s, x - 3, y - 3, w + 6, 3, a, seed + 9, 2.6);
    s.hline(x - 4, y - 4, w + 8, a[3]);
    s.hline(x - 4, y - 3, w + 8, a[4], 0.6);
    s.px(x - 4, y - 3, a[2]);
  }
  // opening recess: dark reveal on the head and left jamb
  shadeRect(s, x - 1, y - 1, w + 2, 1, P.OUTLINE, 0.6);
  shadeRect(s, x - 1, y, 1, h, P.OUTLINE, 0.5);
  shadeRect(s, x + w, y, 1, h, P.OUTLINE, 0.35);

  let top = y;
  if (style === 'arch') {
    const ah = Math.max(4, Math.round(w * 0.42));
    // warm spill above the fanlight before anything is drawn over it
    for (let d = 1; d <= 4; d++) {
      for (let i = -d; i < w + d; i++) {
        s.pxOver(x + i, y - d + 1, P.WINDOW_AMBER[3], [0, 0.2, 0.13, 0.07, 0.03][d]);
      }
    }
    // fanlight: a half ellipse of glass in a timber arch
    s.ellipse(x - 1, y - 1, w + 2, ah * 2 + 2, P.WOOD[0]);
    s.ellipse(x, y, w, ah * 2, P.WOOD[3]);
    s.ellipse(x + 1, y + 1, w - 2, ah * 2 - 2, P.WINDOW_AMBER[2]);
    for (let j = 1; j < ah; j++) {
      for (let i = 1; i < w - 1; i++) {
        if (s.get(x + i, y + j)[3] === 0) continue;
        const t = j / ah;
        s.pxOver(x + i, y + j, pick(P.WINDOW_AMBER, 3.2 - t * 1.4));
      }
    }
    // radial glazing bars springing from the transom, clipped to the glass
    const cx0 = x + w / 2 - 0.5;
    for (const ang of [-0.85, 0, 0.85]) {
      for (let t = 0; t <= ah * 1.2; t += 0.34) {
        const bx = Math.round(cx0 + Math.sin(ang) * t);
        const by = Math.round(y + ah - Math.cos(ang) * t);
        const c = s.get(bx, by);
        if (c[3] === 0 || c[0] < 120) continue;   // only paint on lit glass
        s.px(bx, by, P.WOOD[1]);
      }
    }
    s.pxOver(x + 2, y + ah - 3, P.WINDOW_AMBER[4]);
    s.pxOver(x + 3, y + ah - 4, P.WINDOW_AMBER[4]);
    top = y + ah;
    // transom bar
    s.rect(x - 1, top, w + 2, 2, P.WOOD[2]);
    s.hline(x - 1, top, w + 2, P.WOOD[4]);
    s.hline(x - 1, top + 1, w + 2, P.WOOD[0]);
    top += 2;
  }

  const dh = y + h - top;
  if (style === 'shrine') {
    // no door — an opening into cold dark
    for (let j = 0; j < dh; j++) for (let i = 0; i < w; i++) {
      const t = 1 - j / dh;
      s.px(x + i, top + j, pick(P.SHRINE_FLOOR, t * 1.4));
    }
    shadeRect(s, x, top, w, 3, P.OUTLINE, 0.7);
    for (let i = 0; i < w; i++) s.px(x + i, top + dh - 1, P.SHRINE_FLOOR[1], 0.8);
    return;
  }

  // door leaf
  wallPlank(s, x, top, w, dh, ramp, seed, style === 'panel' ? Math.floor(w / 2) : 4);
  if (style === 'stable') {
    const mid = top + Math.round(dh * 0.45);
    // upper leaf stands open on a warm room
    for (let j = top; j < mid; j++) for (let i = 0; i < w; i++) {
      const t = (j - top) / (mid - top);
      s.px(x + i, j, pick(P.WINDOW_AMBER, 0.6 + t * 1.6));
    }
    // a shelf and a couple of jars silhouetted in the opening
    s.hline(x + 1, mid - 4, w - 2, pick(P.WOOD, 0.6));
    s.hline(x + 1, mid - 5, w - 2, pick(P.WOOD, 1.8));
    for (let i = 2; i < w - 3; i += 4) {
      s.rect(x + i, mid - 8, 3, 3, pick(P.WOOD, 0.4));
      s.px(x + i, mid - 8, pick(P.WOOD, 1.6));
    }
    shadeRect(s, x, top, w, 3, P.OUTLINE, 0.62);
    shadeRect(s, x, top, 2, mid - top, P.OUTLINE, 0.35);
    s.hline(x, mid, w, ramp[4]);
    s.hline(x, mid + 1, w, ramp[1]);
    s.hline(x, mid + 2, w, ramp[0]);
  }
  if (style === 'panel') {
    for (const [py, ph] of [[3, Math.floor(dh * 0.36)], [Math.floor(dh * 0.5), Math.floor(dh * 0.4)]] as const) {
      const px0 = x + 3, pw = w - 6;
      s.rect(px0, top + py, pw, ph, ramp[2]);
      s.hline(px0, top + py, pw, ramp[4]);
      s.vline(px0, top + py, ph, ramp[4]);
      s.hline(px0, top + py + ph - 1, pw, ramp[0]);
      s.vline(px0 + pw - 1, top + py, ph, ramp[0]);
      shadeRect(s, px0 + 1, top + py + 1, pw - 2, ph - 2, ramp[1], 0.35);
    }
  } else if (style === 'plank' || style === 'arch') {
    // ledger boards + iron strap hinges
    const ledgers = o.glazed ? [Math.round(dh * 0.58)] : [Math.round(dh * 0.18), Math.round(dh * 0.72)];
    for (const ly of ledgers) {
      s.hline(x, top + ly, w, ramp[3]);
      s.hline(x, top + ly + 1, w, ramp[1]);
      s.hline(x, top + ly + 2, w, ramp[0]);
      const hw = Math.max(4, Math.round(w * 0.55));
      for (let i = 0; i < hw; i++) {
        s.px(x + i, top + ly, P.IRON[3]);
        s.px(x + i, top + ly + 1, P.IRON[2]);
        s.px(x + i, top + ly + 2, P.IRON[0]);
      }
      s.px(x + 1, top + ly + 1, P.IRON[4]);
      s.px(x + hw - 2, top + ly + 1, P.IRON[4]);
    }
  }

  // glazed upper panes — a door that glows is a door you walk toward
  if (o.glazed) {
    const gh = Math.round(dh * 0.34);
    const gx = x + 2, gw = w - 4;
    for (let d = 1; d <= 2; d++) {
      for (let i = -d; i < gw + d; i++) s.pxOver(gx + i, top + 1 - d, P.WINDOW_AMBER[3], d === 1 ? 0.16 : 0.07);
    }
    s.rect(gx - 1, top + 1, gw + 2, gh + 2, P.WOOD[1]);
    s.hline(gx - 1, top + 1, gw + 2, P.WOOD[3]);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = 2.9 - (j / gh) * 1.2 + (i / gw < 0.3 ? 0.3 : 0);
      s.px(gx + i, top + 2 + j, pick(P.WINDOW_AMBER, k));
    }
    const mx = gx + Math.floor(gw / 2);
    const my = top + 2 + Math.floor(gh / 2);
    s.vline(mx, top + 2, gh, P.WOOD[1]);
    s.hline(gx, my, gw, P.WOOD[1]);
    for (let j = 0; j < gh; j++) s.px(mx + 1, top + 2 + j, P.WINDOW_AMBER[1], 0.6);
    for (let i = 0; i < gw; i++) s.px(gx + i, my + 1, P.WINDOW_AMBER[1], 0.6);
    for (let i = 0; i < Math.min(4, mx - gx - 1, my - top - 3); i++) {
      s.px(gx + 1 + i, my - 2 - i, P.WINDOW_AMBER[4]);
    }
    shadeRect(s, gx, top + 2, gw, 1, P.OUTLINE, 0.3);
    s.hline(gx - 1, top + gh + 2, gw + 2, P.WOOD[0]);
    s.hline(gx - 1, top + gh + 3, gw + 2, P.WOOD[3]);
  }

  // handle + keyhole
  const kx = x + w - 4, ky = top + Math.round(dh * 0.46);
  s.ellipse(kx - 1, ky, 3, 3, P.BRONZE[1]);
  s.px(kx - 1, ky, P.BRONZE[3]);
  s.px(kx, ky, P.BRONZE[4]);
  s.px(kx, ky + 2, P.IRON[1]);
  s.px(kx - 1, ky + 3, P.OUTLINE);
  if (o.knocker) {
    const nx = x + Math.floor(w / 2), ny = top + Math.round(dh * 0.3);
    s.ellipseOutline(nx - 3, ny, 6, 5, P.BRONZE[2]);
    s.px(nx - 3, ny + 1, P.BRONZE[4]);
    s.rect(nx - 1, ny - 2, 2, 2, P.BRONZE[3]);
  }
  if (o.catflap) {
    const fx = x + 1, fy = y + h - 8;
    s.rect(fx, fy, 7, 7, P.WOOD[0]);
    s.rect(fx + 1, fy + 1, 5, 5, P.WOOD[1]);
    s.hline(fx + 1, fy + 1, 5, P.WOOD[3]);
    shadeRect(s, fx + 1, fy + 2, 5, 4, P.OUTLINE, 0.5);
  }

  // threshold
  if (o.step ?? true) {
    s.rect(x - 1, y + h, w + 2, 2, P.PATH_STONE[2]);
    s.hline(x - 1, y + h, w + 2, P.PATH_STONE[4]);
    s.hline(x - 1, y + h + 1, w + 2, P.PATH_STONE[0]);
  }
  // ambient occlusion in the door corners
  shadeRect(s, x, top, w, 1, P.OUTLINE, 0.4);
  shadeRect(s, x, y + h - 2, w, 2, P.OUTLINE, 0.22);
}

// ── fittings & occupancy detail ────────────────────────────────────────────

function foundation(s: Surface, x: number, y: number, w: number, h: number, seed: number, ramp: R = P.STONE_WALL) {
  wallStone(s, x, y, w, h, ramp, seed, 4);
  // plinth lip catches the light
  s.hline(x, y, w, pick(ramp, 4), 0.8);
  s.hline(x + 1, y + 1, w - 1, pick(ramp, 3), 0.4);
  // hard contact line at the very bottom
  s.hline(x, y + h - 1, w, P.OUTLINE, 0.85);
  s.hline(x + 1, y + h - 2, w - 1, P.OUTLINE, 0.35);
}

function chimney(
  s: Surface, x: number, y: number, w: number, h: number,
  style: 'brick' | 'stone' | 'flue', seed: number,
) {
  if (style === 'flue') {
    const cw = Math.max(4, Math.min(w, 6));
    const cx0 = x + Math.floor((w - cw) / 2);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < cw; i++) {
        let k = 2;
        if (i === 0) k += 1.2; else if (i === cw - 1) k -= 1.4; else if (i === 1) k += 0.6;
        if ((j + 2) % 9 === 0) k -= 1.2;
        if ((j + 3) % 9 === 0) k += 0.8;
        s.px(cx0 + i, y + j, pick(P.IRON, k));
      }
    }
    // conical rain cap
    for (let j = 0; j < 4; j++) {
      const cw2 = cw + 4 - j * 1;
      const cx1 = cx0 + Math.floor((cw - cw2) / 2);
      for (let i = 0; i < cw2; i++) s.px(cx1 + i, y - 4 + j, pick(P.IRON, j === 0 ? 3.6 : i < 2 ? 3 : i > cw2 - 3 ? 0.8 : 2));
    }
    return;
  }
  const ramp = style === 'brick' ? P.BRICK : P.STONE_WALL;
  // stack
  if (style === 'brick') {
    for (let j = 0; j < h; j++) {
      const row = Math.floor(j / 3);
      for (let i = 0; i < w; i++) {
        const off = row % 2 ? 3 : 0;
        const bi = Math.floor((i + off) / 6);
        let k = 1.6 + h2(bi, row, seed) * 1.6;
        if (j % 3 === 0) k -= 1.3;
        if ((i + off) % 6 === 0) k -= 1.1;
        if (j % 3 === 1) k += 0.4;
        const lx = i / w;
        k += lx < 0.2 ? 0.5 : lx > 0.78 ? -0.8 : 0;
        s.px(x + i, y + j, pick(ramp, k));
      }
    }
  } else {
    wallStone(s, x, y, w, h, ramp, seed, 5);
  }
  // corbelled cap
  s.rect(x - 2, y - 4, w + 4, 4, ramp[2]);
  s.hline(x - 2, y - 4, w + 4, pick(ramp, 4));
  s.hline(x - 2, y - 1, w + 4, pick(ramp, 0));
  s.vline(x + w + 1, y - 4, 4, pick(ramp, 0));
  // the flue mouth: soot and a hint of the fire below
  s.rect(x + 2, y - 3, w - 4, 2, P.OUTLINE);
  s.hline(x + 2, y - 3, w - 4, '#1a1526');
  s.px(x + 3, y - 2, P.FIRE[1], 0.35);
}

/** Hanging iron bracket + swinging board. Symbols only, never text. */
type SignKind = 'lantern' | 'loaf' | 'anvil' | 'herb' | 'spool' | 'fish' | 'book' | 'parcel' | 'boot';

function signBoard(s: Surface, x: number, y: number, w: number, h: number, kind: SignKind, seed: number, face: R = P.CANVAS) {
  // painted board — a light face so the pictogram reads against a dark wall
  wallPlank(s, x, y, w, h, face, seed, 5);
  s.rect(x + 1, y + 1, w - 2, h - 2, face[3]);
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    let k = 3;
    if (h2(x + i, y + j, seed) > 0.86) k -= 0.6;
    if (i > w - 4) k -= 0.7;
    if (j > h - 4) k -= 0.6;
    s.px(x + i, y + j, pick(face, k));
  }
  s.rectOutline(x, y, w, h, P.WOOD[0]);
  s.rectOutline(x + 1, y + 1, w - 2, h - 2, P.WOOD[2], 0.55);
  s.hline(x + 1, y + 1, w - 2, face[4], 0.55);
  for (const [sx, sy] of [[x + 1, y + 1], [x + w - 2, y + 1], [x + 1, y + h - 2], [x + w - 2, y + h - 2]]) {
    s.px(sx, sy, P.IRON[3]);
  }
  shadeRect(s, x + 1, y + h - 3, w - 2, 2, P.OUTLINE, 0.2);

  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2);
  const ink = P.OUTLINE;
  switch (kind) {
    case 'lantern': {
      s.rect(cx - 3, cy - 4, 7, 8, P.LANTERN[2]);
      s.rect(cx - 2, cy - 3, 5, 6, P.LANTERN[4]);
      s.rectOutline(cx - 3, cy - 4, 7, 8, ink);
      s.hline(cx - 4, cy - 5, 9, ink);
      s.hline(cx - 4, cy + 4, 9, ink);
      s.vline(cx, cy - 7, 2, ink);
      s.px(cx - 1, cy - 6, ink); s.px(cx + 1, cy - 6, ink);
      s.vline(cx, cy - 3, 6, P.LANTERN[3], 0.6);
      break;
    }
    case 'loaf': {
      s.ellipse(cx - 6, cy - 3, 13, 8, P.WOOD_LIGHT[4]);
      s.ellipse(cx - 6, cy - 3, 13, 5, P.THATCH[3]);
      s.ellipseOutline(cx - 6, cy - 3, 13, 8, ink);
      for (let i = -3; i <= 3; i += 3) s.line(cx + i - 1, cy - 2, cx + i + 1, cy, ink, 0.75);
      break;
    }
    case 'anvil': {
      s.rect(cx - 5, cy - 2, 10, 3, P.IRON[2]);
      s.hline(cx - 5, cy - 2, 10, P.IRON[4]);
      s.rect(cx - 2, cy + 1, 4, 3, P.IRON[1]);
      s.rect(cx - 4, cy + 4, 8, 2, P.IRON[2]);
      s.px(cx + 5, cy - 1, P.IRON[2]); s.px(cx + 6, cy - 1, P.IRON[1]);
      s.line(cx - 4, cy - 6, cx + 1, cy - 3, P.WOOD[2]);
      s.rect(cx + 1, cy - 5, 4, 3, P.IRON[3]);
      break;
    }
    case 'herb': {
      s.line(cx, cy + 5, cx, cy - 5, P.BUSH[1]);
      for (let i = 0; i < 5; i++) {
        const yy = cy + 4 - i * 2;
        s.ellipse(cx - 5 + (i % 2), yy - 1, 5, 3, P.BUSH[3]);
        s.ellipse(cx + 1, yy - 2, 5, 3, P.BUSH[2]);
      }
      s.px(cx - 2, cy - 4, P.FLOWER_VIOLET[2]);
      s.px(cx + 2, cy - 2, P.FLOWER_VIOLET[3]);
      break;
    }
    case 'spool': {
      s.rect(cx - 4, cy - 5, 9, 2, P.WOOD[1]);
      s.rect(cx - 4, cy + 3, 9, 2, P.WOOD[1]);
      s.rect(cx - 3, cy - 3, 7, 6, P.FLOWER_ROSE[1]);
      s.hline(cx - 3, cy - 3, 7, P.FLOWER_ROSE[2]);
      s.hline(cx - 3, cy + 1, 7, P.FLOWER_ROSE[0]);
      s.line(cx + 4, cy, cx + 7, cy - 4, P.LINEN[3]);
      break;
    }
    case 'fish': {
      s.ellipse(cx - 6, cy - 3, 11, 7, P.WATER[3]);
      s.ellipse(cx - 5, cy - 2, 8, 4, P.WATER[4]);
      s.poly([[cx + 5, cy], [cx + 8, cy - 4], [cx + 8, cy + 4]], P.WATER[2]);
      s.ellipseOutline(cx - 6, cy - 3, 11, 7, ink);
      s.px(cx - 4, cy - 1, ink);
      break;
    }
    case 'book': {
      s.poly([[cx - 7, cy - 3], [cx, cy - 5], [cx, cy + 3], [cx - 7, cy + 4]], P.LINEN[3]);
      s.poly([[cx + 7, cy - 3], [cx, cy - 5], [cx, cy + 3], [cx + 7, cy + 4]], P.LINEN[2]);
      s.line(cx, cy - 5, cx, cy + 3, P.WOOD[1]);
      for (let i = 0; i < 3; i++) {
        s.hline(cx - 6, cy - 1 + i * 2, 5, P.UI_INK_SOFT, 0.6);
        s.hline(cx + 2, cy - 1 + i * 2, 5, P.UI_INK_SOFT, 0.6);
      }
      break;
    }
    case 'parcel': {
      s.rect(cx - 6, cy - 4, 12, 9, P.PARCEL_WRAP.kraft[2]);
      s.hline(cx - 6, cy - 4, 12, P.PARCEL_WRAP.kraft[4]);
      s.hline(cx - 6, cy + 4, 12, P.PARCEL_WRAP.kraft[0]);
      s.vline(cx - 1, cy - 4, 9, P.TWINE);
      s.hline(cx - 6, cy, 12, P.TWINE);
      s.px(cx - 2, cy - 1, P.TWINE); s.px(cx + 1, cy - 1, P.TWINE);
      break;
    }
    case 'boot': {
      s.poly([[cx - 2, cy - 5], [cx + 2, cy - 5], [cx + 3, cy + 2], [cx - 5, cy + 3], [cx - 5, cy + 5], [cx + 4, cy + 5], [cx + 4, cy + 2]], P.LEATHER[2]);
      s.hline(cx - 5, cy + 5, 10, P.LEATHER[0]);
      s.px(cx - 1, cy - 4, P.LEATHER[4]);
      break;
    }
  }
}

/** Wall-mounted iron bracket with a chain, and the sign hanging off it. */
function hangingSign(
  s: Surface, wallX: number, armY: number, armLen: number, kind: SignKind,
  boardW: number, boardH: number, seed: number, dir: 1 | -1 = 1, face: R = P.CANVAS,
) {
  const tipX = wallX + armLen * dir;
  // mounting plate
  s.rect(wallX - 1, armY - 3, 3, 9, P.IRON[2]);
  s.vline(wallX - 1, armY - 3, 9, P.IRON[3]);
  s.vline(wallX + 1, armY - 3, 9, P.IRON[0]);
  s.px(wallX, armY - 1, P.IRON[4]);
  s.px(wallX, armY + 4, P.IRON[4]);
  // arm with a scroll curl
  const x0 = Math.min(wallX, tipX), x1 = Math.max(wallX, tipX);
  s.hline(x0, armY, x1 - x0 + 1, P.IRON[3]);
  s.hline(x0, armY + 1, x1 - x0 + 1, P.IRON[1]);
  s.hline(x0, armY + 2, x1 - x0 + 1, P.IRON[0], 0.7);
  for (let i = 0; i < 5; i++) {
    s.px(wallX + (4 + i) * dir, armY + 1 + Math.round(i * 0.8), P.IRON[2]);
  }
  s.px(tipX, armY - 1, P.IRON[3]);
  // chains
  const boardX = tipX - Math.floor(boardW / 2);
  for (const cxo of [2, boardW - 3]) {
    for (let j = 0; j < 3; j++) s.px(boardX + cxo, armY + 2 + j, j % 2 ? P.IRON[3] : P.IRON[1]);
  }
  signBoard(s, boardX, armY + 5, boardW, boardH, kind, seed, face);
}

/**
 * Striped canvas awning with a scalloped valance. The stripe runs the full
 * depth so it reads as fabric stretched over a frame, and the bottom edge is
 * cut per-column so the silhouette wobbles the way cloth does.
 */
function awning(
  s: Surface, x: number, y: number, w: number, h: number,
  a: R, bStripe: R, seed: number, scallop = true, period = 6,
) {
  const cut = (i: number) => {
    if (!scallop) return 0;
    const p = i % period;
    const e = Math.min(p, period - 1 - p);
    return e === 0 ? 2 : e === 1 ? 1 : 0;
  };
  for (let i = 0; i < w; i++) {
    const bot = h - cut(i);
    const ramp = Math.floor(i / period) % 2 === 0 ? a : bStripe;
    for (let j = 0; j < bot; j++) {
      const t = j / h;
      let k = 2;
      k += t < 0.22 ? 1.1 : t < 0.45 ? 0.45 : t > 0.78 ? -1.0 : t > 0.6 ? -0.4 : 0;
      k += i / w < 0.1 ? 0.4 : i / w > 0.9 ? -0.5 : 0;
      if (h2(x + i, y + j, seed) > 0.92) k += 0.5;
      // fabric sag between the frame ribs
      if (i % period === Math.floor(period / 2)) k -= 0.35;
      s.px(x + i, y + j, pick(ramp, k));
    }
    s.px(x + i, y + bot - 1, P.OUTLINE, 0.55);
    if (cut(i) === 0 && cut(i + 1) > 0) s.px(x + i, y + bot - 2, P.OUTLINE, 0.3);
  }
  // frame ribs and the front rail
  for (let i = 0; i < w; i += period) s.vline(x + i, y, h - cut(i) - 1, P.IRON[1], 0.35);
  s.hline(x, y, w, pick(a, 4), 0.5);
  s.vline(x, y, h - cut(0), P.IRON[2], 0.6);
  s.vline(x + w - 1, y, h - cut(w - 1), P.IRON[1], 0.6);
}

/**
 * A hanging lantern: iron cage, warm glass, and — the part that matters — a
 * broad soft pool of light thrown onto whatever it hangs in front of.
 */
function lanternHanging(s: Surface, x: number, y: number, seed: number, hang = 3) {
  const w = 7, h = 9;
  const cx = x + 3;
  // suspension
  for (let j = 1; j <= hang; j++) s.px(cx, y - j, j === hang ? P.IRON[3] : P.IRON[2]);
  s.px(cx - 1, y - hang, P.IRON[3]);
  s.px(cx + 1, y - hang, P.IRON[1]);
  // light pool, painted only on surfaces behind it
  for (let d = 9; d >= 1; d--) {
    const rw = w + d * 2, rh = h + d * 2;
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
      const nx = (i - rw / 2) / (rw / 2), ny = (j - rh / 2) / (rh / 2);
      if (nx * nx + ny * ny > 1) continue;
      s.pxOver(x - d + i, y - d + j, P.LANTERN[3], 0.05);
    }
  }
  // cap
  s.hline(x + 1, y - 1, w - 2, P.IRON[3]);
  s.hline(x, y, w, P.IRON[2]);
  s.px(x, y, P.IRON[3]);
  s.px(x + w - 1, y, P.IRON[0]);
  // glazed body
  for (let j = 1; j < h - 2; j++) {
    for (let i = 0; i < w; i++) {
      const t = (j - 1) / (h - 4);
      let k = 3.6 - t * 1.3;
      if (i === 0 || i === w - 1) k -= 2.2;
      if (i === 1) k += 0.4;
      s.px(x + i, y + j, pick(P.LANTERN, k));
    }
  }
  s.px(x + 1, y + 2, P.LANTERN[4]);
  s.px(x + 2, y + 2, P.LANTERN[4]);
  s.px(x + 2, y + 3, P.LANTERN[4]);
  // cage bars
  s.vline(x, y + 1, h - 3, P.IRON[2]);
  s.vline(x + w - 1, y + 1, h - 3, P.IRON[0]);
  s.px(cx, y + 1, P.IRON[1]);
  // base
  s.hline(x, y + h - 2, w, P.IRON[2]);
  s.hline(x + 1, y + h - 1, w - 2, P.IRON[0]);
  if (seed % 2 === 0) s.px(x + w - 2, y + 4, P.LANTERN[4], 0.6);
}

/** `y` is the top of the box itself; foliage spills up and over it. */
function flowerBox(s: Surface, x: number, y: number, w: number, seed: number, colors: R = P.FLOWER_ROSE) {
  const r = rng(seed);
  wallPlank(s, x, y, w, 5, P.WOOD, seed, 4);
  s.hline(x, y, w, P.WOOD[4]);
  s.hline(x, y + 4, w, P.WOOD[0]);
  s.px(x - 1, y + 1, P.WOOD[2]); s.px(x - 1, y + 2, P.WOOD[1]);
  s.px(x + w, y + 1, P.WOOD[1]); s.px(x + w, y + 2, P.WOOD[0]);
  shadeRect(s, x + 1, y + 5, w, 1, P.OUTLINE, 0.4);
  shadeRect(s, x + 2, y + 6, w, 1, P.OUTLINE, 0.18);
  // trailing foliage over the front lip and mounding above it
  for (let i = 0; i < w; i++) {
    const hgt = 2 + Math.round(h2(x + i, seed, 3) * 3);
    for (let j = 0; j < hgt; j++) s.px(x + i, y - 1 - j, pick(P.BUSH, j >= hgt - 1 ? 3.4 : 2.4));
    if (r.chance(0.3)) {
      const tl = r.int(1, 3);
      for (let j = 0; j < tl; j++) s.px(x + i, y + 1 + j, pick(P.BUSH, 1.6));
    }
  }
  for (let i = 0; i < Math.max(3, Math.floor(w / 3)); i++) {
    const fx = x + r.int(0, w - 1);
    const fy = y - 2 - r.int(0, 2);
    s.px(fx, fy, colors[2]);
    s.px(fx - 1, fy, colors[1]);
    s.px(fx + 1, fy, colors[1]);
    s.px(fx, fy - 1, colors[3]);
  }
}

function ivy(s: Surface, x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed);
  const stems = Math.max(2, Math.round(w / 4));
  for (let st = 0; st < stems; st++) {
    let sx = x + r.int(0, w - 1);
    const top = y + r.int(0, Math.floor(h * 0.5));
    for (let yy = y + h - 1; yy >= top; yy--) {
      s.pxOver(sx, yy, P.BUSH[1], 0.9);
      const dens = (yy - top) / Math.max(1, y + h - top);
      if (r.chance(0.45 + dens * 0.4)) {
        const lx = sx + (r.chance(0.5) ? 1 : -1);
        s.pxOver(lx, yy, P.BUSH[3], 0.95);
        s.pxOver(lx, yy - 1, P.BUSH[2], 0.8);
        if (r.chance(0.3)) s.pxOver(lx + 1, yy, P.MOSS[3], 0.8);
      }
      if (r.chance(0.25)) sx += r.chance(0.5) ? 1 : -1;
      sx = Math.max(x - 1, Math.min(x + w, sx));
    }
  }
}

function woodpile(s: Surface, x: number, y: number, w: number, h: number, seed: number) {
  const r = rng(seed);
  const d = 5;
  for (let row = 0; row * d < h; row++) {
    const yy = y + h - d - row * d;
    if (yy < y) break;
    const off = row % 2 ? 2 : 0;
    for (let cx = x + off; cx + d <= x + w; cx += d) {
      if (row > 0 && r.chance(0.12)) continue;
      const tone = r.int(1, 3);
      s.ellipse(cx, yy, d, d, pick(P.WOOD, tone));
      s.ellipse(cx + 1, yy + 1, d - 2, d - 2, pick(P.WOOD_LIGHT, tone + 1));
      s.ellipseOutline(cx, yy, d, d, P.WOOD[0], 0.8);
      s.px(cx + 2, yy + 2, pick(P.WOOD_LIGHT, 0.8));
      s.px(cx + 1, yy + 1, pick(P.WOOD_LIGHT, 4), 0.6);
    }
  }
  shadeRect(s, x, y + h - 1, w, 1, P.OUTLINE, 0.5);
}

function crate(s: Surface, x: number, y: number, w: number, h: number, seed: number) {
  wallPlank(s, x, y, w, h, P.WOOD_LIGHT, seed, Math.max(3, Math.floor(w / 3)));
  s.rectOutline(x, y, w, h, P.WOOD[0]);
  s.hline(x + 1, y + 1, w - 2, P.WOOD_LIGHT[4], 0.55);
  s.hline(x, y + 2, w, P.WOOD[1]);
  s.hline(x, y + h - 3, w, P.WOOD[1]);
  s.line(x + 1, y + h - 3, x + w - 2, y + 3, P.WOOD[1], 0.6);
  shadeRect(s, x + Math.floor(w * 0.7), y + 2, Math.ceil(w * 0.3), h - 3, P.OUTLINE, 0.2);
}

function barrel(s: Surface, x: number, y: number, w: number, h: number, seed: number) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const bulge = Math.abs(j - h / 2) / (h / 2);
      if (i === 0 && bulge > 0.72) continue;
      if (i === w - 1 && bulge > 0.72) continue;
      let k = 2.2;
      const lx = i / w;
      k += lx < 0.22 ? 0.9 : lx < 0.4 ? 0.3 : lx > 0.8 ? -1.2 : lx > 0.62 ? -0.5 : 0;
      if (h2(i * 3, j, seed) > 0.9) k -= 0.5;
      if ((i + 1) % 4 === 0) k -= 0.5;
      s.px(x + i, y + j, pick(P.WOOD_LIGHT, k));
    }
  }
  for (const hy of [1, Math.floor(h / 2) - 1, h - 3]) {
    for (let i = 0; i < w; i++) {
      const bulge = Math.abs(hy - h / 2) / (h / 2);
      if ((i === 0 || i === w - 1) && bulge > 0.72) continue;
      s.px(x + i, y + hy, pick(P.IRON, i < 2 ? 3.4 : i > w - 3 ? 0.8 : 2.4));
    }
  }
  // lid
  s.ellipse(x + 1, y - 1, w - 2, 4, P.WOOD_LIGHT[3]);
  s.ellipse(x + 2, y - 1, w - 4, 3, P.WOOD_LIGHT[4]);
  s.ellipseOutline(x + 1, y - 1, w - 2, 4, P.WOOD[1]);
  shadeRect(s, x + w - 2, y, 2, h, P.OUTLINE, 0.25);
}

function bucket(s: Surface, x: number, y: number, seed: number) {
  const w = 7, h = 7;
  for (let j = 0; j < h; j++) {
    const inset = j > h - 2 ? 1 : 0;
    for (let i = inset; i < w - inset; i++) {
      let k = 2.4;
      k += i < 2 ? 0.8 : i > w - 3 ? -1.1 : 0;
      s.px(x + i, y + j, pick(P.WOOD_LIGHT, k));
    }
  }
  s.hline(x, y, w, P.IRON[3]);
  s.hline(x + 1, y + h - 1, w - 2, P.IRON[0]);
  s.hline(x, y + 3, w, P.IRON[2], 0.8);
  for (let i = 1; i < w - 1; i++) s.px(x + i, y - 2 - (i === 3 ? 1 : 0), P.IRON[2]);
  void seed;
}

function broom(s: Surface, x: number, y: number, h: number, lean = 1) {
  for (let j = 0; j < h; j++) {
    const xx = x + Math.round((j / h) * 2 * lean);
    s.px(xx, y + j, j < 2 ? P.WOOD_LIGHT[4] : P.WOOD_LIGHT[2]);
    s.px(xx + 1, y + j, P.WOOD[1]);
  }
  const bx = x + Math.round(2 * lean), by = y + h;
  for (let j = 0; j < 6; j++) {
    const w = 3 + j;
    for (let i = 0; i < w; i++) {
      s.px(bx - Math.floor(w / 2) + i + 1, by + j, pick(P.THATCH, ((i + j) % 3) + 1.5));
    }
  }
  s.hline(bx - 1, by, 4, P.IRON[2]);
}

function doormat(s: Surface, x: number, y: number, w: number, seed: number) {
  const h = 4;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let k = 2;
      if (j === 0) k += 0.9; else if (j === h - 1) k -= 1.2;
      if ((i + j) % 3 === 0) k -= 0.5;
      if (h2(x + i, y + j, seed) > 0.85) k += 0.5;
      s.px(x + i, y + j, pick(P.THATCH, k));
    }
  }
  s.rectOutline(x, y, w, h, P.WOOD[0], 0.6);
  s.rectOutline(x + 2, y + 1, w - 4, h - 2, P.THATCH[4], 0.35);
}

function bootScraper(s: Surface, x: number, y: number) {
  s.rect(x, y + 3, 6, 2, P.STONE_WALL[2]);
  s.hline(x, y + 3, 6, P.STONE_WALL[3]);
  s.hline(x, y + 4, 6, P.OUTLINE, 0.6);
  s.vline(x + 1, y, 3, P.IRON[3]);
  s.vline(x + 4, y, 3, P.IRON[1]);
  s.hline(x + 1, y, 4, P.IRON[4]);
}

function drainpipe(s: Surface, x: number, y: number, h: number, kink = 0) {
  for (let j = 0; j < h; j++) {
    const off = kink && j > h * 0.45 ? kink : 0;
    s.px(x + off, y + j, P.IRON[3]);
    s.px(x + 1 + off, y + j, P.IRON[2]);
    s.px(x + 2 + off, y + j, P.IRON[0]);
    if (j % 11 === 4) {
      s.hline(x - 1 + off, y + j, 5, P.IRON[3]);
      s.hline(x - 1 + off, y + j + 1, 5, P.IRON[0]);
    }
  }
  if (kink) {
    const ky = y + Math.round(h * 0.45);
    for (let i = 0; i <= Math.abs(kink); i++) {
      const xx = x + (kink > 0 ? i : -i);
      s.px(xx, ky, P.IRON[3]); s.px(xx + 1, ky, P.IRON[2]); s.px(xx + 2, ky, P.IRON[0]);
      s.px(xx, ky + 1, P.IRON[2]); s.px(xx + 1, ky + 1, P.IRON[1]); s.px(xx + 2, ky + 1, P.IRON[0]);
    }
  }
  // hopper head
  s.rect(x - 1, y, 5, 3, P.IRON[2]);
  s.hline(x - 1, y, 5, P.IRON[4]);
  s.hline(x - 1, y + 2, 5, P.IRON[0]);
}

function laundryHook(s: Surface, x: number, y: number) {
  s.vline(x, y, 4, P.IRON[2]);
  s.px(x, y - 1, P.IRON[3]);
  s.px(x + 1, y - 1, P.IRON[3]);
  s.px(x + 2, y, P.IRON[1]);
  s.px(x + 2, y + 1, P.IRON[2]);
  s.px(x + 1, y + 2, P.IRON[1]);
}

/** Steps read only if every tread is bright and every riser is dark. */
function steps(s: Surface, cx: number, y: number, topW: number, n: number, ramp: R = P.PATH_STONE) {
  for (let i = 0; i < n; i++) {
    const w = topW + i * 5;
    const x = cx - Math.floor(w / 2);
    const yy = y + i * 2;
    // tread (lit) then riser (dark) — the alternation is the whole illusion
    for (let k = 0; k < w; k++) {
      s.px(x + k, yy, pick(ramp, h2(x + k, yy, 33) > 0.6 ? 4 : 3.4));
      s.px(x + k, yy + 1, pick(ramp, h2(x + k, yy, 71) > 0.7 ? 1 : 0.4));
    }
    s.px(x, yy, pick(ramp, 4));
    s.px(x + w - 1, yy, pick(ramp, 2));
    s.px(x + w - 1, yy + 1, P.OUTLINE, 0.75);
    // worn hollow in the middle of each tread
    for (let k = Math.floor(w * 0.35); k < Math.ceil(w * 0.65); k++) s.px(x + k, yy, pick(ramp, 2.6));
  }
}

function post(s: Surface, x: number, y: number, w: number, h: number, ramp: R = P.WOOD, bracket = true) {
  beamV(s, x, y, w, h, ramp, x * 7);
  s.hline(x - 1, y + h - 3, w + 2, ramp[3]);
  s.hline(x - 1, y + h - 2, w + 2, ramp[2]);
  s.hline(x - 1, y + h - 1, w + 2, ramp[0]);
  if (bracket) {
    for (let i = 0; i < 6; i++) {
      const yy = y + i;
      s.px(x + w + i, yy, ramp[3]);
      s.px(x + w + i, yy + 1, ramp[2]);
      s.px(x + w + i, yy + 2, ramp[0]);
      s.px(x - 1 - i, yy, ramp[3]);
      s.px(x - 1 - i, yy + 1, ramp[2]);
      s.px(x - 1 - i, yy + 2, ramp[0]);
    }
  }
}

// ── composition helper ─────────────────────────────────────────────────────

/**
 * Finishes a building: dark contact edge on the down/right silhouette, a warm
 * rim on the up/left, then the ground shadow composited underneath.
 */
function finish(s: Surface, shadowX: number, shadowY: number, shadowW: number, rows = 6): Surface {
  rimLight(s, P.PLASTER[4], 0.16);
  outlineDownRight(s, P.OUTLINE, 0.85);
  const sh = new Surface(s.w, s.h);
  groundShadow(sh, shadowX, shadowY, shadowW, rows);
  s.blitBehind(sh);
  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// THE LANTERN INN — Mira's. The warmest thing in Lumen Vale and the first
// interior the player enters. Two storeys, jettied belt course, deep red hip
// roof, a covered porch that glows, and a lantern sign you can read from
// twenty tiles away.
// ════════════════════════════════════════════════════════════════════════════

function buildInn(): Surface {
  const W = 128, H = 136;
  const s = new Surface(W, H);
  const seed = 8801;

  const roofY = 10, roofH = 36;         // body 10..46, eave board 46..48
  const roofX = 8, roofW = 112;
  const wallX = 14, wallW = 100;        // 14..113
  const upTop = 49, upBot = 78;
  const beltTop = 78, beltH = 4;
  const loTop = 82, loBot = 118;
  const fndTop = 118, fndH = 8;         // 118..126
  const baseY = 126;

  // ── upper storey: cream plaster infill inside a dark timber frame
  wallPlaster(s, wallX, upTop, wallW, upBot - upTop, P.PLASTER, { seed, damp: false });
  timberFrame(s, wallX, upTop, wallW, upBot - upTop, seed + 3, {
    bays: 5, braces: true, braceBays: [1, 3], ramp: P.WOOD, tone: 1.4,
  });

  // ── lower storey: lapped weatherboard, warmer and heavier
  wallBoard(s, wallX, loTop, wallW, loBot - loTop, P.WOOD_LIGHT, seed + 11, 4);

  // ── jettied belt course dividing the storeys
  beamH(s, wallX - 2, beltTop, wallW + 4, beltH, P.WOOD, seed + 21, 2);
  s.hline(wallX - 2, beltTop, wallW + 4, P.WOOD_LIGHT[4]);
  eaveShadow(s, wallX, beltTop + beltH, wallW, 3);
  for (let x = wallX + 6; x < wallX + wallW - 6; x += 14) {
    s.px(x, beltTop + beltH, P.WOOD[2]);
    s.px(x + 1, beltTop + beltH, P.WOOD[3]);
    s.px(x, beltTop + beltH + 1, P.WOOD[0]);
    s.px(x + 1, beltTop + beltH + 1, P.WOOD[1]);
  }

  foundation(s, wallX - 2, fndTop, wallW + 4, fndH, seed + 31);

  // ── the big red hip roof
  roof(s, roofX, roofY, roofW, roofH, {
    ramp: P.ROOF_RED, seed: seed + 41, hip: 18, rowH: 4, unitW: 6,
    mat: 'shingle', ridge: true, moss: 0.5, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, wallX, upTop, wallW, 4);

  // ── chimney. Smoke anchor: (91, 2).
  chimney(s, 84, 6, 14, 34, 'brick', seed + 51);
  for (let j = 0; j < 28; j++) {
    const y = 12 + j;
    if (y < roofY + 2 || y > roofY + roofH - 1) continue;
    shadeRect(s, 98, y, 5 + Math.round(j * 0.25), 1, P.OUTLINE, 0.3 - j * 0.007);
  }

  // ── upper windows flanking an attic oculus
  for (const wx of [22, 90]) {
    win(s, wx, 53, 16, 19, {
      lit: true, cols: 2, rows: 3, frame: P.WOOD, sill: 'wood',
      curtain: true, seed: seed + wx,
    });
    flowerBox(s, wx - 1, 74, 18, seed + wx * 3, wx === 22 ? P.FLOWER_ROSE : P.FLOWER_GOLD);
  }
  oculus(s, 64, 60, 14, true);

  // ── ground floor left: shuttered window over a flower box
  win(s, 21, 90, 14, 16, {
    lit: true, cols: 2, rows: 2, frame: P.WOOD, sill: 'wood',
    seed: seed + 101, shutters: P.ROOF_TEAL, clutter: 'jars',
  });
  flowerBox(s, 20, 108, 16, seed + 111, P.FLOWER_GOLD);
  bucket(s, 15, 110, seed + 121);

  // ── ground floor right: barrel and crate, then ivy spilling off the eave
  barrel(s, 92, 104, 12, 14, seed + 141);
  crate(s, 104, 109, 10, 9, seed + 143);
  drainpipe(s, 15, 50, 66, 0);
  laundryHook(s, 20, 56);
  ivy(s, 105, 47, 9, 38, seed + 161);

  // ── the porch canopy: a gabled hood that breaks up into the storey above,
  //    so the entrance is the first thing the eye lands on.
  const canX = 38, canW = 52;
  roof(s, canX, 72, canW, 12, {
    ramp: P.ROOF_RED, seed: seed + 61, hip: 8, rowH: 4, unitW: 6,
    mat: 'shingle', ridge: true, fascia: true, fasciaRamp: P.WOOD,
  });
  shadeRect(s, canX + 3, 87, canW - 6, loBot - 87, P.OUTLINE, 0.15);
  shadeRect(s, canX + 1, 87, 2, loBot - 87, P.OUTLINE, 0.08);
  shadeRect(s, canX + canW - 3, 87, 2, loBot - 87, P.OUTLINE, 0.08);
  eaveShadow(s, canX + 1, 87, canW - 2, 4);

  post(s, 40, 87, 3, 31, P.WOOD);
  post(s, 85, 87, 3, 31, P.WOOD);

  door(s, 56, 90, 16, 28, 'plank', {
    ramp: P.ROOF_TEAL, seed: seed + 71, catflap: true, step: false, glazed: true,
    architrave: P.WOOD_LIGHT,
  });
  // light spilling out under the door onto the threshold
  for (let j = 0; j < 4; j++) {
    shadeRect(s, 55 - j, 118 + j, 18 + j * 2, 1, P.WINDOW_AMBER[3], 0.18 - j * 0.04);
  }

  lanternHanging(s, 45, 89, 2, 4);
  lanternHanging(s, 76, 89, 3, 4);

  bootScraper(s, 75, 112);
  broom(s, 46, 100, 13, 1);
  doormat(s, 56, 114, 16, seed + 151);

  // ── the sign. It projects past the corner so it reads against the sky.
  hangingSign(s, 108, 84, 10, 'lantern', 20, 22, seed + 131, 1, P.CANVAS);

  // ── steps up to the door, then grounding
  steps(s, 64, 118, 24, 4);
  baseWeeds(s, wallX - 3, fndTop + fndH - 1, wallW + 7, seed + 171, 0.3);
  return finish(s, wallX - 3, baseY, wallW + 8, 7);
}

// ════════════════════════════════════════════════════════════════════════════
// SERA'S WORKSHOP — part laboratory, part library. Tall and narrow where the
// inn is broad, with an extension that does not quite line up, copper venting
// bolted on as an afterthought, and a glazed cupola she watches the valley
// from. It should read as clever and slightly out of control.
// ════════════════════════════════════════════════════════════════════════════

function buildWorkshop(): Surface {
  const W = 104, H = 124;
  const s = new Surface(W, H);
  const seed = 4201;

  // ── right extension: lower, and deliberately a few pixels out of square
  wallBoard(s, 76, 78, 22, 30, P.WOOD, seed + 5, 4);
  roof(s, 74, 68, 26, 11, {
    ramp: P.ROOF_TEAL, seed: seed + 7, hip: 4, rowH: 4, unitW: 5,
    mat: 'shingle', ridge: false, pent: 'r', fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 76, 82, 22, 3);
  win(s, 80, 88, 12, 14, { lit: true, cols: 2, rows: 2, seed: seed + 9, sill: 'wood', clutter: 'jars' });
  foundation(s, 74, 108, 26, 8, seed + 11);

  // ── left lean-to: an open clutter shed
  roof(s, 4, 78, 28, 10, {
    ramp: P.ROOF_TEAL, seed: seed + 13, hip: 0, rowH: 4, unitW: 5,
    mat: 'shingle', ridge: false, pent: 'l', fascia: true, fasciaRamp: P.WOOD,
  });
  post(s, 6, 88, 3, 22, P.WOOD, false);
  post(s, 26, 88, 3, 22, P.WOOD, false);
  shadeRect(s, 8, 91, 19, 19, P.OUTLINE, 0.22);
  crate(s, 8, 92, 12, 11, seed + 15);
  crate(s, 9, 103, 10, 9, seed + 17);
  crate(s, 20, 98, 10, 14, seed + 19);
  barrel(s, 20, 88, 9, 10, seed + 21);
  s.hline(4, 110, 26, P.OUTLINE, 0.7);

  // ── main block
  const wallX = 28, wallW = 48;
  wallPlaster(s, wallX, 58, wallW, 50, P.PLASTER, { seed: seed + 23, damp: true });
  timberFrame(s, wallX, 58, wallW, 50, seed + 25, {
    bays: 3, braces: true, braceBays: [0, 2], midRail: true, ramp: P.WOOD, tone: 1.4,
  });
  foundation(s, wallX - 2, 108, wallW + 4, 8, seed + 27);

  roof(s, 20, 24, 64, 32, {
    ramp: P.ROOF_TEAL, seed: seed + 29, hip: 12, rowH: 4, unitW: 5,
    mat: 'shingle', ridge: true, moss: 0.8, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, wallX, 58, wallW, 4);

  // ── the cupola: her observation post, lit from within
  s.rect(42, 14, 20, 14, P.WOOD[1]);
  for (let j = 0; j < 12; j++) for (let i = 0; i < 16; i++) {
    const k = 2.9 - (j / 12) * 1.3 + (i < 4 ? 0.4 : 0);
    s.px(44 + i, 15 + j, pick(P.WINDOW_AMBER, k));
  }
  for (const mx of [48, 53, 58]) s.vline(mx, 15, 12, P.WOOD[1]);
  s.hline(44, 21, 16, P.WOOD[1]);
  s.px(45, 18, P.WINDOW_AMBER[4]); s.px(46, 17, P.WINDOW_AMBER[4]);
  s.rectOutline(42, 14, 20, 14, P.WOOD[0]);
  s.vline(42, 14, 14, P.WOOD[3]);
  for (let d = 1; d <= 4; d++) {
    for (let i = -d; i < 20 + d; i++) s.pxOver(42 + i, 14 - d, P.WINDOW_AMBER[3], [0, 0.15, 0.08, 0.04, 0.02][d]);
  }
  roof(s, 38, 7, 28, 8, {
    ramp: P.COPPER_PATINA, seed: seed + 31, hip: 9, rowH: 3, unitW: 4,
    mat: 'slate', ridge: true, fascia: true, fasciaRamp: P.WOOD,
  });
  // weathervane
  s.vline(52, 0, 8, P.IRON[2]);
  s.px(51, 1, P.IRON[3]);
  s.hline(48, 2, 8, P.IRON[1]);
  s.poly([[55, 0], [59, 2], [55, 4]], P.IRON[3]);
  s.rect(46, 1, 3, 2, P.IRON[2]);
  s.rect(42, 28, 20, 2, P.WOOD[1]);
  s.hline(42, 28, 20, P.WOOD[3]);
  shadeRect(s, 62, 30, 6, 12, P.OUTLINE, 0.25);

  // ── copper venting bolted up the right flank
  for (let j = 0; j < 42; j++) {
    const y = 66 + j;
    s.px(76, y, P.COPPER[4]); s.px(77, y, P.COPPER[3]);
    s.px(78, y, P.COPPER[2]); s.px(79, y, P.COPPER[0]);
    if (j % 13 === 5) {
      s.hline(75, y, 6, P.COPPER[4]);
      s.hline(75, y + 1, 6, P.COPPER[2]);
      s.hline(75, y + 2, 6, P.COPPER[0]);
    }
  }
  for (let i = 0; i < 14; i++) {
    s.px(64 + i, 69, P.COPPER[4]); s.px(64 + i, 70, P.COPPER[3]);
    s.px(64 + i, 71, P.COPPER[2]); s.px(64 + i, 72, P.COPPER[0]);
  }
  // pressure vessel bolted to the wall
  s.ellipse(60, 64, 10, 12, P.COPPER[2]);
  s.ellipse(61, 65, 6, 8, P.COPPER[3]);
  s.ellipse(62, 66, 3, 4, P.COPPER[4]);
  s.ellipseOutline(60, 64, 10, 12, P.COPPER[0]);
  s.rect(63, 61, 4, 3, P.IRON[2]);
  s.hline(63, 61, 4, P.IRON[4]);
  chimney(s, 28, 18, 8, 28, 'flue', seed + 33);   // smoke anchor: (32, 14)

  // ── tall library windows, book stacks silhouetted against the lamplight
  for (const wx of [32, 60]) {
    win(s, wx, 64, 12, 26, {
      lit: true, cols: 2, rows: 4, frame: P.WOOD, sill: 'stone',
      seed: seed + wx, clutter: 'books',
    });
  }
  oculus(s, 52, 68, 13, true);

  door(s, 45, 82, 14, 26, 'panel', {
    ramp: P.ROOF_TEAL, seed: seed + 35, step: false, knocker: true, architrave: P.WOOD_LIGHT,
  });

  // occupancy
  ivy(s, 29, 60, 6, 48, seed + 37);
  bucket(s, 62, 100, seed + 39);
  crate(s, 30, 96, 12, 12, seed + 43);

  steps(s, 52, 108, 18, 3);
  baseWeeds(s, 4, 115, 96, seed + 41, 0.32);
  return finish(s, 24, 116, 78, 7);
}

// ════════════════════════════════════════════════════════════════════════════
// COURIER OFFICE — wide and low, all counter and no ceremony. A service hatch
// with the shutter propped open, a route board bristling with pins, a pigeon
// loft on the ridge, and parcels stacked wherever they fit.
// ════════════════════════════════════════════════════════════════════════════

function routeBoard(s: Surface, x: number, y: number, w: number, h: number, seed: number) {
  // frame
  s.rect(x, y, w, h, P.WOOD[2]);
  s.hline(x, y, w, P.WOOD[4]); s.vline(x, y, h, P.WOOD[3]);
  s.hline(x, y + h - 1, w, P.WOOD[0]); s.vline(x + w - 1, y, h, P.WOOD[0]);
  // parchment
  const px0 = x + 2, py0 = y + 2, pw = w - 4, ph = h - 4;
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
    let k = 3;
    if (h2(px0 + i, py0 + j, seed) > 0.82) k -= 0.6;
    if (i > pw - 3 || j > ph - 3) k -= 0.7;
    s.px(px0 + i, py0 + j, pick(P.UI_PARCHMENT, k));
  }
  // valley outline and roads
  const r = rng(seed);
  s.line(px0 + 2, py0 + ph - 4, px0 + Math.floor(pw / 2), py0 + 3, P.WOOD[1], 0.7);
  s.line(px0 + Math.floor(pw / 2), py0 + 3, px0 + pw - 3, py0 + ph - 5, P.WOOD[1], 0.7);
  s.line(px0 + 3, py0 + 4, px0 + pw - 4, py0 + 6, P.UI_INK_SOFT, 0.55);
  for (let i = 0; i < 5; i++) {
    const cx = px0 + r.int(2, pw - 3), cy = py0 + r.int(2, ph - 3);
    const col = [P.FLOWER_ROSE, P.FLOWER_GOLD, P.FLOWER_VIOLET][i % 3];
    s.px(cx, cy, col[2]); s.px(cx, cy + 1, P.OUTLINE);
  }
  // pinned notes curling off the frame
  for (let i = 0; i < 3; i++) {
    const nx = px0 + 2 + i * Math.floor(pw / 3), ny = py0 + ph - 8 + (i % 2);
    s.rect(nx, ny, 6, 7, P.LINEN[3]);
    s.hline(nx, ny, 6, P.LINEN[4]);
    s.hline(nx, ny + 6, 6, P.OUTLINE, 0.5);
    for (let k = 1; k < 5; k += 2) s.hline(nx + 1, ny + k, 4, P.UI_INK_SOFT, 0.5);
    s.px(nx + 3, ny, P.IRON[4]);
  }
  shadeRect(s, x + 1, y + h, w, 1, P.OUTLINE, 0.35);
}

function buildCourier(): Surface {
  const W = 104, H = 104;
  const s = new Surface(W, H);
  const seed = 6301;

  const wallX = 10, wallW = 84;   // 10..93
  wallPlaster(s, wallX, 46, wallW, 38, P.PLASTER, { seed, damp: true });
  timberFrame(s, wallX, 46, wallW, 38, seed + 3, {
    bays: 5, braces: true, braceBays: [0, 4], ramp: P.WOOD, tone: 1.5,
  });
  wallStone(s, wallX, 72, wallW, 12, P.STONE_WALL, seed + 5, 4);
  foundation(s, wallX - 2, 84, wallW + 4, 8, seed + 7);

  roof(s, 4, 14, 96, 30, {
    ramp: P.ROOF_BLUE, seed: seed + 9, hip: 22, rowH: 4, unitW: 6,
    mat: 'slate', ridge: true, moss: 0.3, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, wallX, 46, wallW, 4);

  // ── pigeon loft straddling the ridge
  s.rect(24, 4, 20, 14, P.WOOD_LIGHT[2]);
  wallPlank(s, 24, 4, 20, 14, P.WOOD_LIGHT, seed + 11, 4);
  s.rectOutline(24, 4, 20, 14, P.WOOD[0]);
  for (const [hx, hy] of [[28, 8], [36, 8], [32, 13]] as const) {
    s.ellipse(hx, hy, 5, 5, P.OUTLINE);
    s.ellipse(hx + 1, hy + 1, 3, 3, '#1a1526');
    s.ellipseOutline(hx, hy, 5, 5, P.WOOD_LIGHT[4], 0.6);
  }
  s.hline(22, 18, 24, P.WOOD[2]); s.hline(22, 19, 24, P.WOOD[0]);
  roof(s, 21, -2, 26, 7, {
    ramp: P.ROOF_BLUE, seed: seed + 13, hip: 7, rowH: 3, unitW: 4,
    mat: 'slate', ridge: true, fascia: true, fasciaRamp: P.WOOD,
  });
  // two birds on the perch
  for (const bx of [26, 40]) {
    s.ellipse(bx, 14, 5, 4, P.FEATHER[2]);
    s.ellipse(bx + 1, 13, 3, 3, P.FEATHER[3]);
    s.px(bx + (bx === 26 ? 0 : 4), 14, P.FEATHER[1]);
    s.px(bx + 2, 13, P.OUTLINE);
    s.px(bx + 2, 18, P.BRONZE[2]);
  }
  chimney(s, 68, 18, 10, 24, 'brick', seed + 15);   // smoke anchor: (73, 14)

  // ── route board
  routeBoard(s, 13, 50, 28, 24, seed + 17);
  // a lantern to read it by
  lanternHanging(s, 44, 50, 4, 4);

  // ── service counter: awning, propped hatch, warm interior, parcels on the sill
  awning(s, 58, 46, 38, 11, P.CANVAS, P.ROOF_BLUE, seed + 19, true, 6);
  shadeRect(s, 58, 57, 38, 3, P.OUTLINE, 0.3);
  const hx0 = 62, hy0 = 58, hw = 30, hh = 16;
  s.rect(hx0 - 2, hy0 - 2, hw + 4, hh + 4, P.WOOD[2]);
  s.hline(hx0 - 2, hy0 - 2, hw + 4, P.WOOD[4]);
  s.vline(hx0 - 2, hy0 - 2, hh + 4, P.WOOD[3]);
  s.hline(hx0 - 2, hy0 + hh + 1, hw + 4, P.WOOD[0]);
  for (let j = 0; j < hh; j++) for (let i = 0; i < hw; i++) {
    let k = 1.6 + (1 - j / hh) * 1.4;
    if (i < 5) k += 0.4;
    if (h2(hx0 + i, hy0 + j, seed) > 0.9) k += 0.6;
    s.px(hx0 + i, hy0 + j, pick(P.WINDOW_AMBER, k));
  }
  shadeRect(s, hx0, hy0, hw, 2, P.OUTLINE, 0.5);
  // clerk's shelf silhouettes
  for (let i = 0; i < 4; i++) {
    const bx = hx0 + 2 + i * 7;
    s.rect(bx, hy0 + hh - 7 - (i % 2) * 2, 5, 7 + (i % 2) * 2, pick(P.WOOD, 0.6));
    s.hline(bx, hy0 + hh - 7 - (i % 2) * 2, 5, pick(P.WOOD, 1.6));
  }
  // counter slab jutting out
  s.rect(hx0 - 4, hy0 + hh, hw + 8, 4, P.WOOD_LIGHT[2]);
  s.hline(hx0 - 4, hy0 + hh, hw + 8, P.WOOD_LIGHT[4]);
  s.hline(hx0 - 4, hy0 + hh + 3, hw + 8, P.WOOD[0]);
  shadeRect(s, hx0 - 3, hy0 + hh + 4, hw + 8, 2, P.OUTLINE, 0.3);
  // a parcel and a bell on the counter
  s.rect(hx0 + 1, hy0 + hh - 6, 9, 6, P.PARCEL_WRAP.kraft[2]);
  s.hline(hx0 + 1, hy0 + hh - 6, 9, P.PARCEL_WRAP.kraft[4]);
  s.vline(hx0 + 5, hy0 + hh - 6, 6, P.TWINE);
  s.ellipse(hx0 + hw - 8, hy0 + hh - 5, 5, 5, P.BRONZE[2]);
  s.ellipse(hx0 + hw - 7, hy0 + hh - 5, 3, 3, P.BRONZE[4]);
  s.px(hx0 + hw - 6, hy0 + hh - 7, P.BRONZE[3]);

  // ── door
  door(s, 45, 60, 14, 24, 'panel', {
    ramp: P.ROOF_BLUE, seed: seed + 21, step: false, architrave: P.WOOD_LIGHT,
  });
  // letter slot
  s.rect(48, 74, 8, 2, P.IRON[1]);
  s.hline(48, 74, 8, P.IRON[3]);

  // ── parcel pile and sacks against the corner
  crate(s, 90, 68, 12, 11, seed + 23);
  s.rect(89, 79, 13, 5, P.PARCEL_WRAP.slate[2]);
  s.hline(89, 79, 13, P.PARCEL_WRAP.slate[4]);
  s.hline(89, 83, 13, P.PARCEL_WRAP.slate[0]);
  s.vline(95, 79, 5, P.TWINE);
  s.rect(90, 62, 11, 6, P.PARCEL_WRAP.rose[2]);
  s.hline(90, 62, 11, P.PARCEL_WRAP.rose[4]);
  s.vline(95, 62, 6, P.TWINE);
  s.hline(90, 65, 11, P.TWINE, 0.85);

  // a parcel plaque bolted over the door instead of a swinging sign — the
  // courier office is too wide for a bracket to clear the eave.
  signBoard(s, 42, 48, 20, 11, 'parcel', seed + 25, P.CANVAS);
  drainpipe(s, 92, 48, 36, 0);

  steps(s, 52, 84, 20, 3);
  baseWeeds(s, 6, 91, 92, seed + 27, 0.3);
  return finish(s, 6, 92, 90, 6);
}

// ════════════════════════════════════════════════════════════════════════════
// GENERAL STORE — a shopfront. Two big glazed display bays full of goods, a
// striped awning the width of the building, produce out front, plum roof.
// ════════════════════════════════════════════════════════════════════════════

function buildStore(): Surface {
  const W = 104, H = 112;
  const s = new Surface(W, H);
  const seed = 5501;

  const wallX = 8, wallW = 88;   // 8..95
  wallPlaster(s, wallX, 46, wallW, 50, P.PLASTER, { seed, damp: true });
  timberFrame(s, wallX, 46, wallW, 50, seed + 3, {
    bays: 4, braces: false, midRail: false, ramp: P.WOOD, tone: 1.5,
  });
  foundation(s, wallX - 2, 96, wallW + 4, 8, seed + 5);

  roof(s, 2, 12, 100, 32, {
    ramp: P.ROOF_PLUM, seed: seed + 7, hip: 16, rowH: 4, unitW: 6,
    mat: 'tile', ridge: true, moss: 0.3, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, wallX, 46, wallW, 4);
  chimney(s, 18, 16, 11, 24, 'brick', seed + 9);   // smoke anchor: (23, 12)

  // ── the shop's fascia board, then the awning below it
  s.rect(20, 48, 56, 10, P.WOOD[2]);
  wallPlank(s, 20, 48, 56, 10, P.WOOD, seed + 11, 7);
  s.hline(20, 48, 56, P.WOOD_LIGHT[4]);
  s.hline(20, 57, 56, P.WOOD[0]);
  s.rectOutline(21, 49, 54, 8, P.UI_GOLD[2], 0.6);
  // a painted basket of goods instead of a name
  const bcx = 48;
  s.poly([[bcx - 9, 51], [bcx + 9, 51], [bcx + 6, 56], [bcx - 6, 56]], P.WOOD_LIGHT[2]);
  s.hline(bcx - 9, 51, 19, P.WOOD_LIGHT[4]);
  for (let i = 0; i < 5; i++) s.px(bcx - 6 + i * 3, 50, P.VEG_LEAF[3]);
  s.ellipse(bcx - 5, 48, 5, 4, P.FLOWER_ROSE[1]);
  s.ellipse(bcx + 1, 47, 5, 5, P.TREE_AUTUMN[3]);
  s.ellipse(bcx + 5, 49, 4, 4, P.VEG_LEAF[3]);

  awning(s, 8, 58, 88, 12, P.CANVAS, P.ROOF_PLUM, seed + 13, true, 8);
  shadeRect(s, 10, 70, 84, 4, P.OUTLINE, 0.28);
  eaveShadow(s, 10, 70, 84, 4);

  // ── display bays
  win(s, 12, 72, 28, 22, {
    lit: true, cols: 3, rows: 2, frame: P.WOOD, sill: 'stone',
    seed: seed + 15, clutter: 'goods',
  });
  win(s, 64, 72, 28, 22, {
    lit: true, cols: 3, rows: 2, frame: P.WOOD, sill: 'stone',
    seed: seed + 17, clutter: 'jars',
  });

  // ── centre door, glazed, between the bays. Honey timber so it separates
  //    from the plum awning directly above it.
  door(s, 44, 72, 16, 24, 'panel', {
    ramp: P.WOOD_LIGHT, seed: seed + 19, step: false, glazed: true, architrave: P.PLASTER,
  });

  // ── produce crates on the pavement
  const produce = (x: number, y: number, sd: number, colors: R) => {
    crate(s, x, y, 14, 11, sd);
    const r = rng(sd + 3);
    for (let i = 0; i < 7; i++) {
      const px0 = x + 1 + r.int(0, 11), py0 = y - 1 - r.int(0, 2);
      s.ellipse(px0, py0, 4, 4, colors[1]);
      s.ellipse(px0 + 1, py0, 2, 2, colors[3]);
      s.px(px0 + 2, py0 + 3, P.VEG_LEAF[1]);
    }
  };
  produce(6, 85, seed + 21, P.TREE_AUTUMN);
  produce(84, 85, seed + 23, P.FLOWER_ROSE);
  barrel(s, 26, 84, 11, 12, seed + 25);
  // brooms for sale
  broom(s, 78, 74, 16, -1);
  broom(s, 81, 76, 14, 1);

  hangingSign(s, 92, 48, 8, 'loaf', 18, 18, seed + 27, 1, P.CANVAS);
  ivy(s, 8, 50, 6, 46, seed + 29);

  steps(s, 52, 96, 22, 3);
  baseWeeds(s, 4, 103, 94, seed + 31, 0.26);
  return finish(s, 4, 104, 94, 6);
}

// ════════════════════════════════════════════════════════════════════════════
// THE BELL TOWER — the tallest thing in Lumen Vale, and the anchor of the
// first quest. Battered stone base, timber upper stage, an open belfry with
// the bronze bell hanging in plain sight, slate spire, weathervane.
// ════════════════════════════════════════════════════════════════════════════

/** The bell itself, drawn at a swing offset. Shared by the tower and overlay. */
function bronzeBell(s: Surface, cx: number, topY: number, tilt: number) {
  const t = Math.round(tilt);
  // headstock + yoke
  s.rect(cx - 8, topY, 16, 3, P.WOOD[2]);
  s.hline(cx - 8, topY, 16, P.WOOD[4]);
  s.hline(cx - 8, topY + 2, 16, P.WOOD[0]);
  s.px(cx - 9, topY + 1, P.IRON[2]); s.px(cx + 8, topY + 1, P.IRON[2]);
  // crown loop
  s.rect(cx - 2 + t, topY + 3, 4, 3, P.BRONZE[2]);
  s.hline(cx - 2 + t, topY + 3, 4, P.BRONZE[4]);
  s.px(cx - 1 + t, topY + 4, P.OUTLINE);
  s.px(cx + t, topY + 4, P.OUTLINE);
  /**
   * A bell silhouette is a straight shoulder, a concave waist, then a fast
   * flare into the sound bow. Interpolate it linearly and you get a cone,
   * which is what the first attempt at this looked like.
   */
  const bh = 17;
  const half = (p: number) => 3.6 + 6.6 * Math.pow(Math.max(0, p - 0.12) / 0.88, 2.1);
  for (let j = 0; j < bh; j++) {
    const p = j / (bh - 1);
    const halfW = Math.round(half(p));
    const off = Math.round(t * (0.3 + p * 0.8));
    for (let i = -halfW; i <= halfW; i++) {
      const lx = (i + halfW) / (halfW * 2 || 1);
      let k = 2.4;
      k += lx < 0.16 ? 0.9 : lx < 0.34 ? 1.5 : lx < 0.5 ? 0.5 : lx > 0.88 ? -1.6 : lx > 0.7 ? -0.8 : 0;
      k -= p * 0.4;
      if (j === 0) k += 0.5;
      s.px(cx + i + off, topY + 6 + j, pick(P.BRONZE, k));
    }
    // the two incised bands above the sound bow
    if (j === bh - 5 || j === bh - 3) {
      for (let i = -halfW + 1; i <= halfW - 1; i++) s.px(cx + i + off, topY + 6 + j, pick(P.BRONZE, 0.7));
    }
  }
  // sound bow: thicker and wider than the body, so the lip reads
  const lipHalf = Math.round(half(1)) + 2;
  const lipOff = Math.round(t * 1.1);
  for (let j = 0; j < 3; j++) {
    for (let i = -lipHalf + (j === 2 ? 1 : 0); i <= lipHalf - (j === 2 ? 1 : 0); i++) {
      const lx = (i + lipHalf) / (lipHalf * 2);
      const k = j === 0 ? (lx < 0.35 ? 4 : lx > 0.8 ? 1.6 : 3.2) : j === 1 ? (lx < 0.3 ? 2.6 : 1.6) : 0.4;
      s.px(cx + i + lipOff, topY + 6 + bh + j, pick(P.BRONZE, k));
    }
  }
  // clapper peeking under the mouth
  s.px(cx + lipOff - 1, topY + 9 + bh, P.IRON[1]);
  s.px(cx + lipOff, topY + 9 + bh, P.IRON[2]);
  s.px(cx + lipOff, topY + 10 + bh, P.IRON[3]);
  // rope falling from the yoke
  for (let j = 0; j < 8; j++) s.px(cx - 6 - Math.round(t * 0.4), topY + 22 + j, pick(P.ROPE, j % 2 ? 3 : 2));
}

function belfryInterior(s: Surface, x: number, y: number, w: number, h: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const t = j / h;
    s.px(x + i, y + j, pick(P.SHRINE_FLOOR, 1.4 - t * 1.2));
  }
  shadeRect(s, x, y, w, 3, P.OUTLINE, 0.6);
  shadeRect(s, x, y, 2, h, P.OUTLINE, 0.4);
}

function buildBellTower(): Surface {
  const W = 80, H = 176;
  const s = new Surface(W, H);
  const seed = 9101;
  const cx = 40;

  // ── battered stone base (wider at the bottom)
  for (let j = 0; j < 46; j++) {
    const y = 124 + j;
    const inset = Math.round((1 - j / 45) * 3);
    wallStone(s, 8 + inset, y, 64 - inset * 2, 1, P.STONE_WALL, seed + y, 5);
  }
  wallStone(s, 8, 124, 64, 46, P.STONE_WALL, seed + 3, 6);
  foundation(s, 6, 160, 68, 8, seed + 5);

  // ── stone cornice under the timber stage
  s.rect(6, 118, 68, 6, P.STONE_WALL[2]);
  s.hline(6, 118, 68, P.STONE_WALL[4]);
  s.hline(6, 119, 68, P.STONE_WALL[3]);
  s.hline(6, 123, 68, P.STONE_WALL[0]);
  eaveShadow(s, 9, 124, 62, 3);

  // ── timber upper stage
  wallPlaster(s, 12, 86, 56, 32, P.PLASTER, { seed: seed + 7, damp: false });
  timberFrame(s, 12, 86, 56, 32, seed + 9, {
    bays: 3, braces: true, braceBays: [0, 2], ramp: P.WOOD, tone: 1.3,
  });
  oculus(s, 40, 101, 15, false);
  s.rect(10, 82, 60, 5, P.WOOD[2]);
  s.hline(10, 82, 60, P.WOOD_LIGHT[4]);
  s.hline(10, 86, 60, P.WOOD[0]);
  eaveShadow(s, 12, 87, 56, 3);

  // ── the belfry: three open arches, the bell hanging in the centre one
  wallStone(s, 10, 44, 60, 38, P.STONE_WALL, seed + 11, 6);
  const arches: Array<[number, number]> = [[14, 12], [30, 20], [54, 12]];
  for (const [ax, aw] of arches) {
    const ay = 52, ah = 30;
    belfryInterior(s, ax, ay, aw, ah);
    s.ellipse(ax, ay - Math.floor(aw / 2), aw, aw, '#141225');
    s.ellipseOutline(ax - 1, ay - Math.floor(aw / 2) - 1, aw + 2, aw + 2, P.STONE_WALL[3]);
    s.ellipseOutline(ax, ay - Math.floor(aw / 2), aw, aw, P.STONE_WALL[0], 0.7);
    for (let j = 0; j < ah; j++) {
      s.px(ax - 1, ay + j, P.STONE_WALL[3]);
      s.px(ax + aw, ay + j, P.STONE_WALL[0]);
    }
    // louvre slats in the side arches
    if (aw < 16) {
      for (let j = 2; j < ah; j += 4) {
        s.hline(ax, ay + j, aw, P.WOOD[2], 0.85);
        s.hline(ax, ay + j + 1, aw, P.WOOD[0], 0.85);
      }
    }
  }
  bronzeBell(s, cx, 50, 0);
  // sill the arches sit on
  s.rect(8, 82, 64, 3, P.STONE_WALL[2]);
  s.hline(8, 82, 64, P.STONE_WALL[4]);
  s.hline(8, 84, 64, P.STONE_WALL[0]);

  // ── slate spire + weathervane
  roof(s, 4, 14, 72, 30, {
    ramp: P.ROOF_SLATE, seed: seed + 13, hip: 32, rowH: 4, unitW: 5,
    mat: 'slate', ridge: true, moss: 0.3, fascia: true, fasciaRamp: P.WOOD,
  });
  s.rect(2, 44, 76, 4, P.STONE_WALL[2]);
  s.hline(2, 44, 76, P.STONE_WALL[4]);
  s.hline(2, 47, 76, P.STONE_WALL[0]);
  s.vline(cx, 2, 14, P.IRON[2]);
  s.vline(cx - 1, 3, 12, P.IRON[3]);
  s.ellipse(cx - 3, 10, 7, 7, P.COPPER_PATINA[2]);
  s.ellipse(cx - 2, 11, 4, 4, P.COPPER_PATINA[4]);
  s.hline(cx - 12, 6, 25, P.IRON[1]);
  s.hline(cx - 12, 5, 25, P.IRON[3]);
  s.poly([[cx + 7, 2], [cx + 15, 6], [cx + 7, 10]], P.IRON[3]);
  s.poly([[cx + 8, 4], [cx + 12, 6], [cx + 8, 8]], P.IRON[1]);
  s.rect(cx - 13, 3, 4, 2, P.IRON[2]);
  s.rect(cx - 13, 7, 4, 2, P.IRON[2]);

  // ── base: arched door, slit window, ivy, a bench
  s.ellipse(31, 122, 18, 18, P.STONE_WALL[1]);
  s.ellipseOutline(31, 122, 18, 18, P.STONE_WALL[4], 0.7);
  door(s, 33, 132, 14, 28, 'arch', {
    ramp: P.WOOD, seed: seed + 15, step: false, knocker: true,
  });
  for (let j = 0; j < 3; j++) {
    // voussoir ring over the door
    const r0 = 20 + j * 2;
    s.ellipseOutline(cx - Math.floor(r0 / 2), 132 - Math.floor(r0 / 2), r0, r0, pick(P.STONE_WALL, j === 0 ? 4 : 2), 0.55);
  }
  win(s, 14, 132, 10, 20, { lit: false, cols: 1, rows: 3, frame: P.STONE_WALL, sill: 'stone', seed: seed + 17 });
  win(s, 56, 132, 10, 20, { lit: false, cols: 1, rows: 3, frame: P.STONE_WALL, sill: 'stone', seed: seed + 19 });
  ivy(s, 62, 120, 10, 44, seed + 21);
  // a stone bench against the base
  s.rect(12, 150, 20, 4, P.PATH_STONE[2]);
  s.hline(12, 150, 20, P.PATH_STONE[4]);
  s.hline(12, 153, 20, P.PATH_STONE[0]);
  s.rect(14, 154, 3, 6, P.PATH_STONE[1]);
  s.rect(27, 154, 3, 6, P.PATH_STONE[1]);
  shadeRect(s, 13, 154, 18, 2, P.OUTLINE, 0.3);

  steps(s, cx, 160, 20, 4);
  baseWeeds(s, 4, 167, 72, seed + 23, 0.34);
  return finish(s, 4, 168, 70, 7);
}

/** 3-frame swinging overlay. Draw at (tower.x + 20, tower.y + 44). */
function bellFrames(): Surface[] {
  return [-4, 0, 4].map((tilt) => {
    const s = new Surface(40, 40);
    belfryInterior(s, 10, 8, 20, 30);
    s.ellipse(10, 8 - 10, 20, 20, '#141225');
    s.ellipseOutline(10, -2, 20, 20, P.STONE_WALL[0], 0.7);
    bronzeBell(s, 20, 6, tilt);
    // motion smear on the leading edge
    if (tilt !== 0) {
      const dir = tilt > 0 ? 1 : -1;
      for (let j = 0; j < 18; j++) {
        s.pxOver(20 + dir * (11 + Math.round(j * 0.3)), 14 + j, P.BRONZE[4], 0.22);
      }
    }
    return s;
  });
}

// ════════════════════════════════════════════════════════════════════════════
// COTTAGES — five of them, and no two share a roof material, a storey count,
// a chimney position or a wall treatment. Cover the colours and you can still
// tell them apart.
// ════════════════════════════════════════════════════════════════════════════

/** A: squat plaster cottage under a heavy thatch hip. Chimney dead centre. */
function buildHouseA(): Surface {
  const W = 76, H = 100;
  const s = new Surface(W, H);
  const seed = 3101;

  wallPlaster(s, 10, 48, 56, 36, P.PLASTER, { seed, damp: true });
  timberFrame(s, 10, 48, 56, 36, seed + 3, { bays: 3, braces: false, ramp: P.WOOD, tone: 1.6 });
  foundation(s, 8, 84, 60, 8, seed + 5);

  roof(s, 2, 10, 72, 36, {
    ramp: P.THATCH, seed: seed + 7, hip: 16, rowH: 6, unitW: 6,
    mat: 'thatch', ridge: true, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 10, 48, 56, 4);
  chimney(s, 32, 2, 12, 26, 'stone', seed + 9);   // smoke anchor: (38, -2)

  win(s, 14, 54, 14, 16, { lit: true, cols: 2, rows: 2, seed: seed + 11, curtain: true, sill: 'wood' });
  win(s, 48, 54, 14, 16, { lit: true, cols: 2, rows: 2, seed: seed + 13, sill: 'wood', clutter: 'plant' });
  flowerBox(s, 13, 72, 16, seed + 15, P.FLOWER_ROSE);
  door(s, 31, 60, 14, 24, 'plank', { ramp: P.WOOD_LIGHT, seed: seed + 17, step: false, catflap: true });

  woodpile(s, 48, 72, 18, 12, seed + 19);
  bucket(s, 10, 76, seed + 21);
  laundryHook(s, 66, 54);
  drainpipe(s, 66, 52, 32, 0);

  steps(s, 38, 84, 18, 3);
  baseWeeds(s, 6, 91, 64, seed + 23, 0.34);
  return finish(s, 6, 92, 62, 6);
}

/** B: narrow two-storey townhouse, jettied upper floor, blue slate. */
function buildHouseB(): Surface {
  const W = 64, H = 120;
  const s = new Surface(W, H);
  const seed = 3201;

  wallPlaster(s, 4, 41, 56, 30, P.PLASTER, { seed, damp: false });
  timberFrame(s, 4, 41, 56, 30, seed + 3, { bays: 3, braces: true, braceBays: [0, 2], ramp: P.WOOD, tone: 1.2 });
  beamH(s, 2, 70, 60, 4, P.WOOD, seed + 5, 2);
  s.hline(2, 70, 60, P.WOOD_LIGHT[4]);
  eaveShadow(s, 7, 74, 50, 3);
  for (let x = 8; x < 56; x += 12) {
    s.px(x, 74, P.WOOD[2]); s.px(x + 1, 74, P.WOOD[3]); s.px(x, 75, P.WOOD[0]);
  }

  wallBoard(s, 7, 74, 50, 32, P.WOOD_LIGHT, seed + 7, 4);
  foundation(s, 5, 106, 54, 8, seed + 9);

  roof(s, 0, 10, 64, 28, {
    ramp: P.ROOF_BLUE, seed: seed + 11, hip: 12, rowH: 4, unitW: 5,
    mat: 'shingle', ridge: true, moss: 0.4, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 4, 41, 56, 4);
  chimney(s, 44, 0, 11, 26, 'brick', seed + 13);   // smoke anchor: (49, -4)

  win(s, 8, 46, 12, 16, { lit: true, cols: 2, rows: 2, seed: seed + 15, sill: 'wood', curtain: true });
  win(s, 44, 46, 12, 16, { lit: false, cols: 2, rows: 2, seed: seed + 17, sill: 'wood' });
  flowerBox(s, 43, 64, 14, seed + 19, P.FLOWER_VIOLET);

  win(s, 9, 80, 13, 17, { lit: true, cols: 2, rows: 2, seed: seed + 21, sill: 'stone', shutters: P.ROOF_RED, clutter: 'jars' });
  door(s, 25, 80, 14, 26, 'panel', { ramp: P.ROOF_RED, seed: seed + 23, step: false, knocker: true, architrave: P.WOOD_LIGHT });

  barrel(s, 44, 94, 11, 12, seed + 25);
  ivy(s, 55, 76, 6, 30, seed + 27);
  bootScraper(s, 41, 100);

  steps(s, 32, 106, 18, 3);
  baseWeeds(s, 3, 113, 58, seed + 29, 0.32);
  return finish(s, 3, 114, 56, 6);
}

/** C: broad stone-based cottage with a full-width covered porch, plum pantiles. */
function buildHouseC(): Surface {
  const W = 92, H = 108;
  const s = new Surface(W, H);
  const seed = 3301;

  wallPlaster(s, 8, 41, 76, 30, P.PLASTER, { seed, damp: false });
  wallStone(s, 8, 68, 76, 22, P.STONE_WALL, seed + 3, 5);
  foundation(s, 6, 90, 80, 8, seed + 5);

  roof(s, 0, 8, 92, 32, {
    ramp: P.ROOF_PLUM, seed: seed + 7, hip: 20, rowH: 5, unitW: 5,
    mat: 'tile', ridge: true, moss: 0.5, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 8, 41, 76, 4);
  chimney(s, 10, 0, 12, 26, 'brick', seed + 9);   // smoke anchor: (16, -4)

  win(s, 14, 46, 14, 16, { lit: true, cols: 2, rows: 2, seed: seed + 11, sill: 'wood', curtain: true });
  win(s, 62, 46, 14, 16, { lit: true, cols: 2, rows: 2, seed: seed + 13, sill: 'wood' });
  flowerBox(s, 13, 64, 16, seed + 15, P.FLOWER_GOLD);
  flowerBox(s, 61, 64, 16, seed + 17, P.FLOWER_WHITE);

  // full-width porch
  roof(s, 6, 62, 80, 9, {
    ramp: P.ROOF_PLUM, seed: seed + 19, hip: 0, rowH: 4, unitW: 5,
    mat: 'tile', ridge: false, fascia: true, fasciaRamp: P.WOOD,
  });
  shadeRect(s, 8, 74, 76, 16, P.OUTLINE, 0.16);
  eaveShadow(s, 8, 74, 76, 3);
  post(s, 10, 74, 3, 16, P.WOOD);
  post(s, 44, 74, 3, 16, P.WOOD);
  post(s, 78, 74, 3, 16, P.WOOD);
  lanternHanging(s, 18, 76, 2, 3);

  door(s, 39, 72, 14, 18, 'plank', {
    ramp: P.ROOF_RED, seed: seed + 21, step: false, catflap: true, architrave: P.WOOD_LIGHT,
  });
  broom(s, 56, 76, 11, 1);
  crate(s, 63, 80, 11, 10, seed + 25);
  woodpile(s, 14, 78, 18, 12, seed + 27);
  ivy(s, 82, 44, 6, 46, seed + 29);

  steps(s, 46, 90, 20, 3);
  baseWeeds(s, 4, 97, 84, seed + 31, 0.3);
  return finish(s, 4, 98, 82, 6);
}

/** D: gable-front cottage. Steep teal roof, shuttered windows, entry hood. */
function buildHouseD(): Surface {
  const W = 72, H = 104;
  const s = new Surface(W, H);
  const seed = 3401;

  wallPlank(s, 8, 52, 56, 38, P.WOOD_LIGHT, seed, 7);
  foundation(s, 6, 90, 60, 8, seed + 3);

  roof(s, 2, 6, 68, 44, {
    ramp: P.ROOF_TEAL, seed: seed + 5, hip: 28, rowH: 4, unitW: 5,
    mat: 'shingle', ridge: true, moss: 0.5, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 8, 52, 56, 4);
  oculus(s, 36, 26, 12, true);
  chimney(s, 14, 20, 10, 26, 'brick', seed + 7);   // smoke anchor: (19, 16)

  win(s, 12, 58, 12, 16, { lit: true, cols: 2, rows: 2, seed: seed + 9, sill: 'wood', shutters: P.ROOF_RED });
  win(s, 48, 58, 12, 16, { lit: false, cols: 2, rows: 2, seed: seed + 11, sill: 'wood', shutters: P.ROOF_RED });

  // entry hood on brackets
  roof(s, 24, 58, 24, 7, {
    ramp: P.ROOF_TEAL, seed: seed + 13, hip: 0, rowH: 4, unitW: 5,
    mat: 'shingle', ridge: false, fascia: true, fasciaRamp: P.WOOD,
  });
  for (const bx of [25, 44]) {
    for (let i = 0; i < 4; i++) {
      s.px(bx + (bx === 25 ? i : -i), 68 + i, P.WOOD[2]);
      s.px(bx + (bx === 25 ? i : -i), 69 + i, P.WOOD[0]);
    }
  }
  shadeRect(s, 26, 68, 20, 22, P.OUTLINE, 0.14);
  door(s, 29, 68, 14, 22, 'plank', { ramp: P.WOOD, seed: seed + 15, step: false, glazed: true });

  bucket(s, 46, 82, seed + 17);
  barrel(s, 54, 78, 10, 12, seed + 19);
  drainpipe(s, 61, 54, 34, 2);
  ivy(s, 9, 60, 6, 30, seed + 21);

  steps(s, 36, 90, 18, 3);
  baseWeeds(s, 4, 97, 64, seed + 23, 0.34);
  return finish(s, 4, 98, 62, 6);
}

/** E: long low cottage with a log lean-to bolted on the right. Dry thatch. */
function buildHouseE(): Surface {
  const W = 92, H = 92;
  const s = new Surface(W, H);
  const seed = 3501;

  // lean-to first, so the main block overlaps it
  wallPlank(s, 72, 50, 18, 24, P.WOOD, seed + 3, 5);
  roof(s, 70, 42, 22, 9, {
    ramp: P.THATCH, seed: seed + 5, hip: 0, rowH: 6, unitW: 5,
    mat: 'thatch', ridge: false, pent: 'r', fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 72, 51, 18, 3);
  woodpile(s, 73, 58, 16, 16, seed + 7);

  wallBoard(s, 8, 40, 66, 34, P.WOOD_LIGHT, seed + 9, 4);
  foundation(s, 6, 74, 70, 8, seed + 11);

  roof(s, 2, 8, 76, 30, {
    ramp: P.THATCH, seed: seed + 13, hip: 15, rowH: 6, unitW: 6,
    mat: 'thatch', ridge: true, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 8, 40, 66, 4);
  chimney(s, 56, 0, 11, 24, 'stone', seed + 15);   // smoke anchor: (61, -4)

  win(s, 12, 46, 13, 16, { lit: true, cols: 2, rows: 2, seed: seed + 17, sill: 'wood', curtain: true });
  win(s, 56, 46, 13, 16, { lit: true, cols: 2, rows: 2, seed: seed + 19, sill: 'wood', clutter: 'plant' });
  flowerBox(s, 11, 64, 15, seed + 21, P.FLOWER_WHITE);
  door(s, 39, 50, 14, 24, 'stable', { ramp: P.WOOD_LIGHT, seed: seed + 23, step: false });

  bucket(s, 32, 66, seed + 25);
  crate(s, 26, 62, 11, 12, seed + 27);
  laundryHook(s, 10, 44);
  laundryHook(s, 70, 44);
  ivy(s, 8, 44, 6, 30, seed + 29);

  steps(s, 46, 74, 18, 3);
  baseWeeds(s, 4, 81, 74, seed + 31, 0.34);
  return finish(s, 4, 82, 72, 6);
}

// ════════════════════════════════════════════════════════════════════════════
// SMALL STRUCTURES — the things that fill the gaps between the landmarks.
// ════════════════════════════════════════════════════════════════════════════

function buildShed(): Surface {
  const W = 52, H = 60;
  const s = new Surface(W, H);
  const seed = 2101;

  wallPlank(s, 6, 24, 40, 26, P.WOOD, seed, 6);
  foundation(s, 4, 50, 44, 6, seed + 3, P.PATH_STONE);
  roof(s, 2, 6, 48, 16, {
    ramp: P.ROOF_SLATE, seed: seed + 5, hip: 6, rowH: 4, unitW: 5,
    mat: 'slate', ridge: true, moss: 0.7, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 6, 24, 40, 3);

  // double doors with a diagonal brace on each leaf
  door(s, 17, 28, 18, 22, 'plank', { ramp: P.WOOD_LIGHT, seed: seed + 7, step: false });
  s.vline(26, 28, 22, P.WOOD[0]);
  s.vline(25, 28, 22, P.WOOD[3], 0.6);
  beamDiag(s, 18, 47, 24, 30, P.WOOD, 2, 1.8);
  beamDiag(s, 28, 30, 33, 47, P.WOOD, 2, 1.8);

  win(s, 8, 30, 8, 9, { lit: false, cols: 2, rows: 1, seed: seed + 9, sill: 'wood', glow: false });
  // tools leaning against the corner
  broom(s, 38, 30, 16, 1);
  for (let j = 0; j < 18; j++) { s.px(43 + Math.round(j * 0.15), 32 + j, P.WOOD_LIGHT[3]); s.px(44 + Math.round(j * 0.15), 32 + j, P.WOOD[1]); }
  s.rect(44, 30, 4, 3, P.IRON[2]);
  s.hline(44, 30, 4, P.IRON[4]);
  bucket(s, 38, 43, seed + 11);

  baseWeeds(s, 3, 55, 46, seed + 13, 0.34);
  return finish(s, 3, 56, 44, 4);
}

function buildBarnSmall(): Surface {
  const W = 92, H = 84;
  const s = new Surface(W, H);
  const seed = 2201;

  wallPlank(s, 8, 44, 76, 28, P.ROOF_RED, seed, 7);
  foundation(s, 6, 72, 80, 7, seed + 3, P.PATH_STONE);

  // gambrel: shallow cap over a steep lower slope
  roof(s, 4, 22, 84, 20, {
    ramp: P.ROOF_SLATE, seed: seed + 5, hip: 0, rowH: 4, unitW: 5,
    mat: 'slate', ridge: false, moss: 0.6, fascia: true, fasciaRamp: P.WOOD,
  });
  roof(s, 16, 6, 60, 16, {
    ramp: P.ROOF_SLATE, seed: seed + 7, hip: 14, rowH: 4, unitW: 5,
    mat: 'slate', ridge: true, moss: 0.4,
  });
  // the gambrel kink line
  s.hline(4, 22, 84, P.ROOF_SLATE[4], 0.7);
  s.hline(4, 23, 84, P.ROOF_SLATE[0], 0.5);
  eaveShadow(s, 8, 44, 76, 4);

  // hayloft door + hoist beam
  s.rect(38, 26, 16, 14, P.WOOD[1]);
  wallPlank(s, 39, 27, 14, 12, P.WOOD_LIGHT, seed + 9, 5);
  s.rectOutline(38, 26, 16, 14, P.WOOD[0]);
  shadeRect(s, 39, 27, 14, 2, P.OUTLINE, 0.45);
  for (let i = 0; i < 10; i++) { s.px(46 + i, 20, P.WOOD[3]); s.px(46 + i, 21, P.WOOD[1]); s.px(46 + i, 22, P.WOOD[0]); }
  for (let j = 0; j < 7; j++) s.px(54, 22 + j, pick(P.ROPE, j % 2 ? 3 : 2));
  s.px(54, 29, P.IRON[2]); s.px(53, 30, P.IRON[3]); s.px(55, 30, P.IRON[1]);

  // big braced doors
  door(s, 34, 46, 24, 26, 'plank', { ramp: P.WOOD_LIGHT, seed: seed + 11, step: false });
  s.vline(46, 46, 26, P.WOOD[0]);
  s.vline(45, 46, 26, P.WOOD[3], 0.6);
  beamDiag(s, 35, 69, 43, 48, P.WOOD, 3, 1.6);
  beamDiag(s, 49, 48, 55, 69, P.WOOD, 3, 1.6);

  win(s, 14, 50, 12, 12, { lit: true, cols: 2, rows: 1, seed: seed + 13, sill: 'wood' });
  win(s, 66, 50, 12, 12, { lit: false, cols: 2, rows: 1, seed: seed + 15, sill: 'wood' });
  // hay bales and a trough
  for (const [bx, by] of [[12, 62], [22, 64], [66, 62]] as const) {
    s.rect(bx, by, 12, 9, P.THATCH[2]);
    for (let j = 0; j < 9; j++) for (let i = 0; i < 12; i++) {
      if (h2(bx + i, by + j, seed) > 0.6) s.px(bx + i, by + j, pick(P.THATCH, j < 2 ? 4 : 3));
    }
    s.rectOutline(bx, by, 12, 9, P.THATCH[0], 0.7);
    s.hline(bx, by + 3, 12, P.ROPE[1]); s.hline(bx, by + 6, 12, P.ROPE[1]);
  }
  // weathervane on the ridge
  s.vline(46, 0, 8, P.IRON[2]);
  s.poly([[47, 0], [53, 3], [47, 6]], P.IRON[3]);
  s.hline(41, 4, 8, P.IRON[1]);

  baseWeeds(s, 4, 78, 82, seed + 17, 0.36);
  return finish(s, 4, 79, 80, 5);
}

function buildOuthouse(): Surface {
  const W = 32, H = 52;
  const s = new Surface(W, H);
  const seed = 2301;

  wallPlank(s, 4, 14, 24, 30, P.WOOD, seed, 6);
  foundation(s, 3, 44, 26, 4, seed + 3, P.PATH_STONE);
  roof(s, 1, 5, 30, 8, {
    ramp: P.ROOF_SLATE, seed: seed + 5, hip: 0, rowH: 4, unitW: 5,
    mat: 'slate', ridge: false, pent: 'r', moss: 1.2, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 4, 14, 24, 3);

  door(s, 10, 18, 12, 26, 'plank', { ramp: P.WOOD_LIGHT, seed: seed + 7, step: false });
  // crescent vent
  s.ellipse(13, 22, 7, 7, P.OUTLINE);
  s.ellipse(15, 22, 5, 6, P.WOOD_LIGHT[2]);
  s.ellipseOutline(13, 22, 7, 7, P.WOOD[0], 0.6);
  // it leans, very slightly
  s.px(3, 20, P.WOOD[1]); s.px(28, 42, P.WOOD[0]);
  ivy(s, 25, 26, 5, 18, seed + 9);
  baseWeeds(s, 2, 47, 28, seed + 11, 0.4);
  return finish(s, 2, 48, 26, 4);
}

function buildWellhouse(): Surface {
  const W = 56, H = 68;
  const s = new Surface(W, H);
  const seed = 2401;

  // stone drum
  wallStone(s, 12, 40, 32, 18, P.STONE_WALL, seed, 5);
  s.ellipse(11, 36, 34, 9, P.STONE_WALL[3]);
  s.ellipse(12, 37, 32, 7, P.STONE_WALL[1]);
  s.ellipse(15, 38, 26, 5, '#141225');
  s.ellipseOutline(11, 36, 34, 9, P.STONE_WALL[4], 0.8);
  // water glint down the shaft
  s.ellipse(20, 39, 14, 3, P.WATER[1], 0.85);
  s.px(24, 40, P.WATER[4], 0.8);
  s.hline(12, 57, 32, P.OUTLINE, 0.7);

  post(s, 8, 22, 4, 34, P.WOOD, false);
  post(s, 44, 22, 4, 34, P.WOOD, false);
  roof(s, 2, 6, 52, 16, {
    ramp: P.ROOF_SLATE, seed: seed + 3, hip: 12, rowH: 4, unitW: 5,
    mat: 'shingle', ridge: true, moss: 0.8, fascia: true, fasciaRamp: P.WOOD,
  });
  // winding drum, crank and bucket
  s.rect(12, 26, 32, 5, P.WOOD_LIGHT[2]);
  s.hline(12, 26, 32, P.WOOD_LIGHT[4]);
  s.hline(12, 30, 32, P.WOOD[0]);
  for (let i = 14; i < 42; i += 3) s.vline(i, 27, 3, P.WOOD[1], 0.5);
  s.ellipse(44, 25, 7, 7, P.IRON[2]);
  s.ellipse(45, 26, 5, 5, P.IRON[3]);
  s.px(50, 28, P.WOOD_LIGHT[3]); s.px(51, 29, P.WOOD_LIGHT[2]);
  for (let j = 0; j < 6; j++) s.px(28, 31 + j, pick(P.ROPE, j % 2 ? 3 : 2));
  bucket(s, 25, 37, seed + 5);

  baseWeeds(s, 8, 58, 40, seed + 7, 0.4);
  return finish(s, 10, 58, 36, 6);
}

function buildStallFrame(): Surface {
  const W = 68, H = 60;
  const s = new Surface(W, H);
  const seed = 2501;

  post(s, 4, 16, 4, 34, P.WOOD, false);
  post(s, 60, 16, 4, 34, P.WOOD, false);
  awning(s, 0, 4, 68, 13, P.CANVAS, P.ROOF_RED, seed, true, 7);
  // ridge pole and ties
  s.hline(0, 3, 68, P.WOOD[2]);
  s.hline(0, 2, 68, P.WOOD[4]);
  for (let x = 4; x < 64; x += 7) s.px(x, 17, P.ROPE[2]);
  shadeRect(s, 6, 18, 56, 4, P.OUTLINE, 0.28);

  // counter
  s.rect(6, 34, 56, 5, P.WOOD_LIGHT[2]);
  wallBoard(s, 6, 34, 56, 5, P.WOOD_LIGHT, seed + 3, 5);
  s.hline(6, 34, 56, P.WOOD_LIGHT[4]);
  s.hline(6, 38, 56, P.WOOD[0]);
  wallPlank(s, 8, 39, 52, 11, P.WOOD, seed + 5, 6);
  shadeRect(s, 8, 39, 52, 3, P.OUTLINE, 0.35);
  // back shelf
  s.rect(10, 24, 48, 3, P.WOOD[2]);
  s.hline(10, 24, 48, P.WOOD[4]);
  s.hline(10, 26, 48, P.WOOD[0]);
  for (const bx of [12, 26, 44]) {
    s.px(bx, 23, P.WOOD[1]); s.px(bx + 1, 23, P.WOOD[1]);
  }
  foundation(s, 4, 50, 60, 4, seed + 7, P.PATH_STONE);
  baseWeeds(s, 3, 53, 62, seed + 9, 0.3);
  return finish(s, 3, 54, 60, 5);
}

// ════════════════════════════════════════════════════════════════════════════
// SOUTH GATE — where Lumen Vale stops and Whisper Woods starts. Stone piers,
// a timber lintel, a slate cap, and a lantern on each side.
// ════════════════════════════════════════════════════════════════════════════

function buildGate(closed: boolean): Surface {
  const W = 96, H = 108;
  const s = new Surface(W, H);
  const seed = 7101 + (closed ? 17 : 0);

  // piers
  for (const px0 of [8, 66]) {
    wallStone(s, px0, 40, 22, 54, P.STONE_WALL, seed + px0, 6);
    s.rect(px0 - 2, 36, 26, 4, P.STONE_WALL[2]);
    s.hline(px0 - 2, 36, 26, P.STONE_WALL[4]);
    s.hline(px0 - 2, 39, 26, P.STONE_WALL[0]);
    foundation(s, px0 - 2, 94, 26, 8, seed + px0 + 3, P.PATH_STONE);
    beamV(s, px0 + 3, 30, 4, 8, P.WOOD, seed + px0, 2);
    beamV(s, px0 + 15, 30, 4, 8, P.WOOD, seed + px0 + 1, 2);
  }

  // the gap
  if (closed) {
    wallPlank(s, 30, 46, 36, 48, P.WOOD, seed + 5, 6);
    s.vline(48, 46, 48, P.WOOD[0]);
    s.vline(47, 46, 48, P.WOOD[3], 0.5);
    beamDiag(s, 31, 90, 45, 50, P.WOOD, 3, 1.4);
    beamDiag(s, 51, 50, 63, 90, P.WOOD, 3, 1.4);
    // the heavy crossbar
    beamH(s, 26, 62, 44, 7, P.WOOD_LIGHT, seed + 7, 2.2);
    for (const bx of [30, 40, 54, 64]) {
      s.px(bx, 63, P.IRON[4]); s.px(bx, 64, P.IRON[2]); s.px(bx + 1, 64, P.IRON[0]);
    }
    s.rect(44, 60, 8, 11, P.IRON[2]);
    s.hline(44, 60, 8, P.IRON[4]);
    s.hline(44, 70, 8, P.IRON[0]);
    s.px(47, 65, P.OUTLINE); s.px(48, 65, P.OUTLINE);
    shadeRect(s, 30, 46, 36, 3, P.OUTLINE, 0.45);
    foundation(s, 28, 94, 40, 8, seed + 9, P.PATH_STONE);
  } else {
    // the road running through, seen in the gap
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 36; i++) {
        if (h2(30 + i, 82 + j, seed) > 0.55) s.px(30 + i, 82 + j, pick(P.PATH_STONE, 2 + (j % 3 === 0 ? 1 : 0)));
        else s.px(30 + i, 82 + j, pick(P.PATH_STONE, 1.4));
      }
    }
    shadeRect(s, 30, 82, 36, 4, P.OUTLINE, 0.35);
    s.hline(30, 101, 36, P.OUTLINE, 0.5);
  }

  // lintel + cap roof
  beamH(s, 4, 26, 88, 8, P.WOOD, seed + 11, 2);
  s.hline(4, 26, 88, P.WOOD_LIGHT[4]);
  for (let x = 10; x < 86; x += 12) {
    s.px(x, 34, P.WOOD[2]); s.px(x + 1, 34, P.WOOD[3]); s.px(x, 35, P.WOOD[0]);
  }
  roof(s, 0, 8, 96, 18, {
    ramp: P.ROOF_SLATE, seed: seed + 13, hip: 24, rowH: 4, unitW: 5,
    mat: 'slate', ridge: true, moss: 0.5, fascia: true, fasciaRamp: P.WOOD,
  });
  eaveShadow(s, 6, 26, 84, 3);

  // town crest board bolted to the lintel
  signBoard(s, 38, 14, 20, 14, 'herb', seed + 15, P.CANVAS);
  lanternHanging(s, 24, 38, 2, 4);
  lanternHanging(s, 65, 38, 3, 4);
  ivy(s, 8, 42, 8, 52, seed + 17);
  ivy(s, 82, 46, 6, 48, seed + 19);

  baseWeeds(s, 4, 101, 88, seed + 21, 0.4);
  return finish(s, 5, 102, 86, 6);
}

// ════════════════════════════════════════════════════════════════════════════
// ECHO SHRINE ENTRANCE — where town warmth ends. Same palette, no amber, no
// timber, no lived-in clutter. Cracked megaliths half-eaten by roots, cold
// cyan carving light, and a doorway with nothing behind it.
// ════════════════════════════════════════════════════════════════════════════

function runeGlyph(s: Surface, x: number, y: number, kind: number, alpha: number) {
  const g = P.ECHO_RUNE;
  const strokes: Array<Array<[number, number, number, number]>> = [
    [[0, 0, 0, 6], [0, 0, 4, 0], [0, 3, 3, 3]],
    [[2, 0, 2, 6], [0, 2, 4, 2], [0, 5, 4, 5]],
    [[0, 0, 4, 4], [4, 0, 0, 4], [2, 5, 2, 6]],
    [[0, 1, 0, 5], [4, 1, 4, 5], [0, 0, 4, 0], [2, 2, 2, 4]],
    [[0, 6, 2, 0], [2, 0, 4, 6], [1, 4, 3, 4]],
  ];
  for (const [ax, ay, bx, by] of strokes[kind % strokes.length]) {
    s.line(x + ax, y + ay, x + bx, y + by, g, alpha);
  }
  s.pxOver(x + 2, y + 3, P.ECHO_SPARK, alpha * 0.7);
}

function buildShrineEntrance(): Surface {
  const W = 104, H = 108;
  const s = new Surface(W, H);
  const seed = 8101;
  const stone = P.SHRINE_OUTER;

  // ── the two jambs, leaning very slightly inward
  for (const [jx, jw] of [[12, 26], [66, 26]] as const) {
    wallStone(s, jx, 30, jw, 66, stone, seed + jx, 8);
    // deep vertical fluting
    for (let fx = jx + 4; fx < jx + jw - 3; fx += 8) {
      for (let j = 0; j < 62; j++) {
        s.pxOver(fx, 32 + j, stone[0], 0.4);
        s.pxOver(fx + 1, 32 + j, stone[3], 0.25);
      }
    }
    // carved rune column
    for (let i = 0; i < 5; i++) {
      runeGlyph(s, jx + Math.floor(jw / 2) - 2, 40 + i * 11, i + (jx > 40 ? 2 : 0), 0.5);
    }
  }

  // ── cracked lintel
  wallStone(s, 6, 14, 92, 20, stone, seed + 3, 7);
  s.hline(6, 14, 92, stone[4], 0.75);
  s.hline(6, 15, 92, stone[3], 0.4);
  s.hline(6, 33, 92, P.OUTLINE, 0.6);
  // the crack running down through it
  let crackX = 62;
  for (let j = 0; j < 20; j++) {
    s.pxOver(crackX, 14 + j, P.OUTLINE, 0.85);
    s.pxOver(crackX + 1, 14 + j, stone[1], 0.5);
    if (h2(crackX, j, seed) > 0.55) crackX += h2(j, crackX, seed + 1) > 0.5 ? 1 : -1;
  }
  for (let i = 0; i < 4; i++) runeGlyph(s, 18 + i * 17, 20, i, 0.42);

  // ── tympanum: the solid block the arch is cut out of
  wallStone(s, 36, 30, 32, 62, stone, seed + 51, 7);
  // ── the carved arch over the doorway: concentric voussoir courses
  for (let ring = 0; ring < 4; ring++) {
    const rw = 24 + ring * 6;
    const rx = 52 - Math.floor(rw / 2);
    const ry = 46 - Math.floor(rw / 2);
    for (let j = 0; j < Math.floor(rw / 2) + 2; j++) {
      for (let i = 0; i < rw; i++) {
        const nx = (i - rw / 2 + 0.5) / (rw / 2);
        const ny = (j - rw / 2 + 0.5) / (rw / 2);
        const d = nx * nx + ny * ny;
        if (d > 1 || d < 0.62) continue;
        let k = 2.2 - ring * 0.25;
        if (nx < -0.25 && ny < -0.1) k += 1.2;
        else if (nx > 0.35) k -= 1.1;
        if ((i + j * 3) % 7 === 0) k -= 0.9;
        s.pxOver(rx + i, ry + j, pick(stone, k));
      }
    }
  }
  // keystone
  s.rect(48, 28, 9, 9, stone[2]);
  s.hline(48, 28, 9, stone[4]);
  s.vline(56, 28, 9, stone[0]);
  runeGlyph(s, 50, 30, 2, 0.85);

  // ── the doorway: cold, empty, and slightly wrong. Its head is a true arch
  //    cut through the tympanum, not a rectangle.
  for (let j = 0; j < 9; j++) {
    for (let i = 0; i < 16; i++) {
      const nx = (i - 7.5) / 8, ny = (j - 8) / 8.5;
      if (nx * nx + ny * ny > 1) continue;
      s.px(44 + i, 38 + j, pick(P.SHRINE_FLOOR, 1.2 - j * 0.08));
    }
  }
  shadeRect(s, 44, 38, 16, 4, P.OUTLINE, 0.55);
  // crisp carved edge: lit on the upper-left of the arch, cut dark on the right
  for (let a = 0; a <= 64; a++) {
    const th = Math.PI * (a / 64);
    const ex = Math.round(51.5 - Math.cos(th) * 8.6);
    const ey = Math.round(46.5 - Math.sin(th) * 9.2);
    s.pxOver(ex, ey, th < 1.9 ? stone[4] : stone[1], 0.85);
    s.pxOver(ex, ey + 1, th < 1.9 ? stone[3] : stone[0], 0.5);
  }
  s.vline(43, 46, 50, stone[4], 0.7);
  s.vline(60, 46, 50, stone[0], 0.8);
  door(s, 44, 46, 16, 50, 'shrine', { seed: seed + 5, step: false });
  // faint violet breath leaking out of it
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 20; i++) {
      if (h2(42 + i, 46 + j, seed + 7) > 0.7) s.pxOver(42 + i, 48 + j, P.ECHO_VIOLET[3], 0.11);
    }
  }
  for (let d = 1; d <= 4; d++) {
    for (let i = -d; i < 16 + d; i++) s.pxOver(44 + i, 46 - d, P.ECHO_VIOLET[2], [0, 0.1, 0.06, 0.03, 0.02][d]);
    for (let j = 0; j < 50; j++) {
      s.pxOver(44 - d, 46 + j, P.ECHO_VIOLET[2], [0, 0.08, 0.05, 0.02, 0.01][d]);
      s.pxOver(59 + d, 46 + j, P.ECHO_VIOLET[2], [0, 0.08, 0.05, 0.02, 0.01][d]);
    }
  }
  // threshold slab, sunk and cracked
  s.rect(36, 92, 32, 6, P.SHRINE_STONE[1]);
  s.hline(36, 92, 32, P.SHRINE_STONE[3]);
  s.hline(37, 93, 30, P.SHRINE_STONE[2]);
  s.hline(36, 97, 32, P.OUTLINE, 0.85);
  s.vline(50, 92, 6, P.OUTLINE, 0.7);
  s.vline(58, 92, 6, P.OUTLINE, 0.5);

  // ── roots. The forest is taking this back, and it started at the top.
  const r = rng(seed + 9);
  const root = (x0: number, y0: number, len: number, dx: number, thick = 3) => {
    let x = x0, y = y0;
    for (let i = 0; i < len; i++) {
      for (let t = 0; t < thick; t++) {
        s.pxOver(x + t, y, pick(P.WOODS_BARK, t === 0 ? 3.4 : t === thick - 1 ? 0.5 : 2));
      }
      y += 1;
      if (r.chance(0.5)) x += dx > 0 ? 1 : -1;
      // tendrils branching off
      if (r.chance(0.1)) {
        let bx = x + (dx > 0 ? thick : -1);
        for (let k = 0; k < r.int(3, 8); k++) {
          s.pxOver(bx, y + k, P.WOODS_BARK[3]);
          s.pxOver(bx + 1, y + k, P.WOODS_BARK[1]);
          bx += dx > 0 ? 1 : -1;
        }
      }
    }
  };
  // heavy roots spilling over the lintel and down the left jamb
  for (let i = 0; i < 4; i++) root(8 + i * 7, 8 + r.int(0, 4), 34 + r.int(0, 38), -1, 3 + (i % 2));
  for (let i = 0; i < 3; i++) root(70 + i * 9, 4 + r.int(0, 5), 20 + r.int(0, 22), 1, 3);
  // a root running along the top of the lintel like a knuckle
  for (let i = 0; i < 78; i++) {
    const rx = 10 + i;
    const ry = 12 + Math.round(Math.sin(i * 0.22) * 2.2);
    s.pxOver(rx, ry, P.WOODS_BARK[3]);
    s.pxOver(rx, ry + 1, P.WOODS_BARK[2]);
    s.pxOver(rx, ry + 2, P.WOODS_BARK[0]);
    if (h2(rx, ry, seed) > 0.85) s.pxOver(rx, ry - 1, P.MOSS[2], 0.7);
  }
  for (let i = 0; i < 70; i++) {
    const mx = r.int(4, 98), my = r.int(14, 96);
    if (s.alphaAt(mx, my) === 0) continue;
    if (h2(mx, my, seed + 11) < 0.5) continue;
    s.pxOver(mx, my, r.chance(0.5) ? P.MOSS[1] : P.MOSS[2], 0.6);
    s.pxOver(mx, my - 1, P.MOSS[3], 0.3);
  }

  // ── fallen blocks and grass at the base
  for (const [bx, by, bw, bh] of [[6, 88, 14, 9], [84, 90, 16, 8], [22, 92, 11, 6]] as const) {
    wallStone(s, bx, by, bw, bh, stone, seed + bx, 5);
    s.hline(bx, by, bw, stone[4], 0.7);
    s.hline(bx, by + bh - 1, bw, P.OUTLINE, 0.8);
  }
  // the growth here is the woods' colour, not the town's
  baseWeeds(s, 4, 98, 96, seed + 13, 0.45, P.WOODS_GRASS);
  // broken stones missing from the top edge, so the silhouette is not a box
  const gone = rng(seed + 17);
  for (let i = 0; i < 7; i++) {
    const bx = 8 + gone.int(0, 84), bw = gone.int(3, 8), bh = gone.int(1, 3);
    for (let j = 0; j < bh; j++) for (let k = 0; k < bw; k++) {
      const idx = ((14 + j) * s.w + bx + k) * 4;
      s.data[idx + 3] = 0;
    }
  }
  return finish(s, 6, 98, 92, 8);
}

// ════════════════════════════════════════════════════════════════════════════
// OVERLAYS — awnings, signs, smoke and doors that map authors layer onto
// walls to make a street look like it was built by different people.
// ════════════════════════════════════════════════════════════════════════════

function awningSprite(w: number, h: number, a: R, bStripe: R, seed: number, period: number): Surface {
  const s = new Surface(w, h + 4);
  // mounting rail
  s.rect(0, 0, w, 2, P.WOOD[2]);
  s.hline(0, 0, w, P.WOOD[4]);
  s.hline(0, 1, w, P.WOOD[0]);
  awning(s, 0, 2, w, h, a, bStripe, seed, true, period);
  // stay bars folding back to the wall
  for (const bx of [1, w - 2]) {
    for (let j = 0; j < h - 3; j++) s.px(bx, 2 + j, P.IRON[j < 2 ? 3 : 1], 0.8);
  }
  outlineDownRight(s, P.OUTLINE, 0.7);
  return s;
}

function signSprite(kind: SignKind, seed: number, face: R): Surface {
  const s = new Surface(34, 40);
  hangingSign(s, 2, 4, 14, kind, 22, 24, seed, 1, face);
  outlineDownRight(s, P.OUTLINE, 0.8);
  rimLight(s, P.PLASTER[4], 0.14);
  return s;
}

/** Four-frame chimney smoke: puffs rising, drifting right, thinning out. */
function smokeFrames(): Surface[] {
  const W = 28, H = 40;
  return [0, 1, 2, 3].map((f) => {
    const s = new Surface(W, H);
    const r = rng(6600 + f * 131);
    for (let p = 0; p < 5; p++) {
      // each puff's age within the loop
      const age = ((p * 0.25 + f * 0.25) % 1);
      const y = H - 4 - age * 34;
      const x = 8 + age * age * 12 + Math.sin(age * 6 + p) * 2;
      const rad = 3 + age * 7;
      const alpha = 0.92 * (1 - age * 0.85);
      const tone = 2 + Math.round(age * 2);
      for (let j = -rad; j <= rad; j++) {
        for (let i = -rad; i <= rad; i++) {
          const d = (i * i) / (rad * rad) + (j * j) / (rad * rad * 0.62);
          if (d > 1) continue;
          // ragged edge, solid core — a puff, not a gradient blob
          if (d > 0.55 && h2(Math.round(x + i), Math.round(y + j), 77 + p) < 0.42) continue;
          const k = tone + (i < 0 && j < 0 ? 1.2 : i > rad * 0.4 ? -0.9 : 0);
          s.px(Math.round(x + i), Math.round(y + j), pick(P.SMOKE_PUFF, k), alpha * (d > 0.7 ? 0.55 : 1));
        }
      }
      if (age < 0.5) {
        s.px(Math.round(x - 1), Math.round(y - rad + 1), P.SMOKE_PUFF[4], alpha * 0.9);
        s.px(Math.round(x - 2), Math.round(y - rad + 2), P.SMOKE_PUFF[4], alpha * 0.6);
      }
      void r;
    }
    return s;
  });
}

function doorSprite(style: DoorStyle, ramp: R, seed: number): Surface {
  const s = new Surface(20, 30);
  // a scrap of wall so the door has a jamb to sit in
  wallPlaster(s, 0, 0, 20, 30, P.PLASTER, { seed: seed + 1, damp: false, grad: 0.6 });
  door(s, 3, 4, 14, 24, style, {
    ramp, seed, step: true, catflap: style === 'plank',
    knocker: style === 'panel', glazed: style === 'stable' ? false : style === 'panel',
    architrave: P.WOOD_LIGHT,
  });
  outlineDownRight(s, P.OUTLINE, 0.8);
  return s;
}

// ════════════════════════════════════════════════════════════════════════════

export function registerBuildings(b: ArtBuild): void {
  // landmarks
  b.add('prop/build/inn', buildInn());
  b.add('prop/build/workshop', buildWorkshop());
  b.add('prop/build/courier', buildCourier());
  b.add('prop/build/store', buildStore());
  b.add('prop/build/belltower', buildBellTower());

  // the swinging-bell overlay, aligned to (belltower.x + 20, belltower.y + 44)
  b.addStrip('prop/build/belltower_bell', bellFrames(), {
    key: 'belltower_ring', frameRate: 6, repeat: -1,
  });

  // cottages
  b.add('prop/build/house_a', buildHouseA());
  b.add('prop/build/house_b', buildHouseB());
  b.add('prop/build/house_c', buildHouseC());
  b.add('prop/build/house_d', buildHouseD());
  b.add('prop/build/house_e', buildHouseE());

  // outbuildings
  b.add('prop/build/shed', buildShed());
  b.add('prop/build/barn_small', buildBarnSmall());
  b.add('prop/build/outhouse', buildOuthouse());
  b.add('prop/build/wellhouse', buildWellhouse());
  b.add('prop/build/stall_frame', buildStallFrame());

  // gate + shrine
  b.add('prop/build/south_gate', buildGate(false));
  b.add('prop/build/south_gate_closed', buildGate(true));
  b.add('prop/build/shrine_entrance', buildShrineEntrance());

  // ── overlays ─────────────────────────────────────────────────────────────
  b.add('prop/build/awning_wide_red', awningSprite(48, 13, P.CANVAS, P.ROOF_RED, 101, 8));
  b.add('prop/build/awning_wide_teal', awningSprite(48, 13, P.CANVAS, P.ROOF_TEAL, 103, 6));
  b.add('prop/build/awning_wide_blue', awningSprite(48, 13, P.CANVAS, P.ROOF_BLUE, 105, 8));
  b.add('prop/build/awning_small_plum', awningSprite(32, 11, P.CANVAS, P.ROOF_PLUM, 107, 6));
  b.add('prop/build/awning_small_gold', awningSprite(32, 11, P.CANVAS, P.UI_GOLD, 109, 8));

  b.add('prop/build/sign_inn', signSprite('lantern', 201, P.CANVAS));
  b.add('prop/build/sign_bakery', signSprite('loaf', 203, P.CANVAS));
  b.add('prop/build/sign_smith', signSprite('anvil', 205, P.PLASTER));
  b.add('prop/build/sign_herbalist', signSprite('herb', 207, P.CANVAS));
  b.add('prop/build/sign_tailor', signSprite('spool', 209, P.PLASTER));
  b.add('prop/build/sign_fishmonger', signSprite('fish', 211, P.CANVAS));
  b.add('prop/build/sign_books', signSprite('book', 213, P.PLASTER));
  b.add('prop/build/sign_courier', signSprite('parcel', 215, P.CANVAS));
  b.add('prop/build/sign_cobbler', signSprite('boot', 217, P.PLASTER));

  b.addStrip('prop/build/chimney_smoke', smokeFrames(), {
    key: 'chimney_smoke', frameRate: 4, repeat: -1,
  });

  b.add('prop/build/door_plank', doorSprite('plank', P.WOOD_LIGHT, 301));
  b.add('prop/build/door_panel', doorSprite('panel', P.ROOF_TEAL, 303));
  b.add('prop/build/door_arch', doorSprite('arch', P.WOOD, 305));
  b.add('prop/build/door_stable', doorSprite('stable', P.WOOD_LIGHT, 307));
}
