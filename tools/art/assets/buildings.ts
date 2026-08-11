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
function baseWeeds(s: Surface, x: number, y: number, w: number, seed: number, density = 0.34) {
  const r = rng(seed);
  const ramp = P.GRASS;
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
    const courseH = Math.max(6, Math.round(h / Math.max(2, Math.round(h / 11))));
    for (let yy = y; yy < y + h; yy++) {
      const [L, Rt] = boundsAt(yy);
      const c = Math.floor((yy - y) / courseH);
      for (let xx = L; xx < Rt; xx++) {
        const jit = Math.round(h2(xx, c, seed) * 2.6);
        const cbot = y + (c + 1) * courseH - jit;
        const d = cbot - yy;
        let k = 2;
        if (h2(xx * 3, Math.floor(yy / 2), seed + 5) > 0.62) k += 0.8;
        if ((xx * 5 + c * 3) % 7 === 0) k += 0.7;
        if (h2(xx, yy, seed + 19) > 0.9) k -= 0.7;
        if (d <= 1) k -= 2.2;
        else if (d <= 3) k -= 1.1;
        const t = (yy - y) / h;
        k += t < 0.22 ? 0.7 : t > 0.8 ? -0.5 : 0;
        const lx = (xx - L) / Math.max(1, Rt - L);
        k += lx < 0.14 ? 0.6 : lx > 0.86 ? -0.9 : 0;
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
    // radial glazing bars springing from the transom
    const cx0 = x + w / 2 - 0.5;
    for (const ang of [-1.05, -0.5, 0, 0.5, 1.05]) {
      for (let t = 1; t <= ah; t++) {
        s.pxOver(Math.round(cx0 + Math.sin(ang) * t * 1.05), Math.round(y + ah - Math.cos(ang) * t), P.WOOD[1]);
      }
    }
    s.px(x + 2, y + ah - 3, P.WINDOW_AMBER[4]);
    s.px(x + 3, y + ah - 4, P.WINDOW_AMBER[4]);
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
    // upper half stands open on a warm interior
    for (let j = top; j < mid; j++) for (let i = 0; i < w; i++) {
      const t = (j - top) / (mid - top);
      s.px(x + i, j, pick(P.WINDOW_AMBER, 0.4 + t * 1.4));
    }
    shadeRect(s, x, top, w, 2, P.OUTLINE, 0.6);
    s.hline(x, mid, w, ramp[4]);
    s.hline(x, mid + 1, w, ramp[1]);
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
      let k = 2.4 - (j / gh) * 1.1;
      if (i / gw < 0.3) k += 0.3;
      if (h2(gx + i, top + j, seed) > 0.9) k += 0.5;
      s.px(gx + i, top + 2 + j, pick(P.WINDOW_AMBER, k));
    }
    s.vline(gx + Math.floor(gw / 2), top + 2, gh, P.WOOD[1]);
    s.hline(gx, top + 2 + Math.floor(gh / 2), gw, P.WOOD[1]);
    for (let j = 0; j < gh; j++) s.px(gx + Math.floor(gw / 2) + 1, top + 2 + j, P.WINDOW_AMBER[1], 0.5);
    for (let i = 0; i < Math.min(3, gh - 1); i++) s.px(gx + 1 + i, top + 4 - i + 1, P.WINDOW_AMBER[4]);
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

export function registerBuildings(b: ArtBuild): void {
  b.add('prop/build/inn', buildInn());
}
