/**
 * FX — every visible reaction in the game.
 *
 * Effects are *light*, not matter. So this module does not draw shapes and fill
 * them: it accumulates a scalar intensity field and then quantises that field
 * into palette bands, dithering the two faintest bands. That gives the one
 * thing a soft alpha gradient can never give next to hard-edged pixel art:
 * a fade-out made of pixels.
 *
 * House rules obeyed here:
 *   - thin bright lines and sparse shards, never filled blobs
 *   - frame 1 (index 1) of every impact is the widest and brightest
 *   - pure white only as a 1–2 px specular core (P.SPECULAR)
 *   - cyan/violet = Echo, amber = warmth. Nothing borrows the other's hue.
 */
import { Surface, rng, type Rng } from '../lib/pixel.js';
import { ArtBuild } from '../lib/registry.js';
import * as P from '../lib/palette.js';

// ── intensity field ────────────────────────────────────────────────────────

interface Field { w: number; h: number; v: Float32Array; }

function field(w: number, h: number): Field {
  return { w, h, v: new Float32Array(w * h) };
}

function fMax(F: Field, x: number, y: number, val: number): void {
  if (x < 0 || y < 0 || x >= F.w || y >= F.h) return;
  const i = y * F.w + x;
  if (val > F.v[i]) F.v[i] = val;
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const bayer = (x: number, y: number) => (BAYER[y & 3][x & 3] + 0.5) / 16;

/** threshold, colour, dither amplitude. */
type Stop = [number, string, number?];

/**
 * Quantise a field into palette bands. Stops are tested from brightest to
 * faintest; the dither amplitude jitters a stop's threshold with an ordered
 * matrix so band edges break up into pixels instead of stair-stepping.
 */
function paint(s: Surface, F: Field, st: Stop[], alpha = 1): Surface {
  const sorted = [...st].sort((a, b) => b[0] - a[0]);
  for (let y = 0; y < F.h; y++) {
    for (let x = 0; x < F.w; x++) {
      const v = F.v[y * F.w + x];
      if (v <= 0) continue;
      for (const [t, c, d] of sorted) {
        const jitter = d ? (bayer(x, y) - 0.5) * d : 0;
        if (v + jitter >= t) { s.px(x, y, c, alpha); break; }
      }
    }
  }
  return s;
}

/**
 * Five bands across a ramp between `lo` (faint outer wisp) and `hi` (core).
 * The two faintest bands dither so the effect dissolves rather than stops.
 */
function bands(ramp: readonly string[], lo: number, hi: number, dither = 0.13): Stop[] {
  const out: Stop[] = [];
  for (let i = 0; i < 5; i++) {
    const t = lo + ((hi - lo) * i) / 4;
    out.push([t, ramp[i], i === 0 ? dither : i === 1 ? dither * 0.6 : 0]);
  }
  return out;
}

/**
 * Bands rescaled to a frame's own peak intensity.
 *
 * Without this, a decaying effect's late frames land in the darkest ramp steps
 * and the thing reads as a *dark outline* instead of dimming light. Rescaling
 * (softened by the exponent, so late frames still lose a step or two) makes the
 * fade happen the way it must in pixel art: fewer, sparser, dithered pixels
 * rather than muddier ones.
 */
function bandsAt(
  ramp: readonly string[], lo: number, hi: number, dither: number,
  peak: number, ref: number, top?: string,
): Stop[] {
  const f = Math.pow(Math.max(0.08, peak / ref), 0.62);
  const out = bands(ramp, lo * f, hi * f, dither * f);
  // An optional sixth step above the ramp: the hottest 1-2 px of a burst.
  if (top) out.push([hi * f * 1.14, top]);
  return out;
}

// ── field primitives ───────────────────────────────────────────────────────

/**
 * A puff of *matter* rather than light: a blob with a lit upper-left and a
 * shaded lower-right, so dust and smoke obey the same light direction as
 * everything else in the game.
 */
function fPuff(F: Field, cx: number, cy: number, rx: number, ry: number, amp = 1, soft = 0.55): void {
  const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(F.w - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(F.h - 1, Math.ceil(cy + ry + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d = Math.hypot(nx, ny);
      if (d >= 1) continue;
      const light = 1 - 0.34 * (nx + ny) * 0.5;
      fMax(F, x, y, amp * light * Math.pow(1 - d, soft));
    }
  }
}

/** Soft round splat: 1 at the centre, 0 at radius r. */
function fDot(F: Field, cx: number, cy: number, r: number, amp = 1, power = 1.6): void {
  const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(F.w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(F.h - 1, Math.ceil(cy + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d >= 1) continue;
      fMax(F, x, y, amp * Math.pow(1 - d, power));
    }
  }
}

/** Tapered soft line — the workhorse for shards, streaks and threads. */
function fLine(
  F: Field, x0: number, y0: number, x1: number, y1: number,
  w0: number, w1: number, a0: number, a1 = a0,
): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-6;
  const pad = Math.max(w0, w1) + 2;
  const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const bx1 = Math.min(F.w - 1, Math.ceil(Math.max(x0, x1) + pad));
  const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const by1 = Math.min(F.h - 1, Math.ceil(Math.max(y0, y1) + pad));
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0;
      let t = (px * dx + py * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - dx * t, py - dy * t);
      const w = w0 + (w1 - w0) * t;
      if (w <= 0.01 || d > w) continue;
      const a = a0 + (a1 - a0) * t;
      fMax(F, x, y, a * (1 - Math.pow(d / w, 1.7)));
    }
  }
}

interface RingOpts {
  cx: number; cy: number; r: number;
  squash?: number;      // vertical squash for the ground plane (1 = circle)
  thick?: number;       // half-thickness in px
  amp?: number;
  a0?: number; a1?: number;      // degrees, clockwise from east (y down)
  ampAt?: (a: number) => number; // angular intensity, a in 0..1 across the sweep
  broken?: number;      // 0 = solid, >0 = dash frequency
  brokenDepth?: number;
}

/** Elliptical ring or arc as a distance field. */
function fRing(F: Field, o: RingOpts): void {
  const sq = o.squash ?? 1;
  const th = o.thick ?? 1;
  const amp = o.amp ?? 1;
  const a0 = o.a0 ?? -180, a1 = o.a1 ?? 180;
  const span = a1 - a0;
  for (let y = 0; y < F.h; y++) {
    for (let x = 0; x < F.w; x++) {
      const dx = x + 0.5 - o.cx;
      const dy = (y + 0.5 - o.cy) / sq;
      const dist = Math.hypot(dx, dy);
      const d = Math.abs(dist - o.r);
      if (d > th) continue;
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      while (a < a0) a += 360;
      while (a > a0 + 360) a -= 360;
      if (a > a1) continue;
      const p = span === 0 ? 0 : (a - a0) / span;
      let m = amp * (o.ampAt ? o.ampAt(p) : 1);
      if (o.broken) {
        // Two beating frequencies, so the gaps land irregularly. A single sine
        // makes a clock face, which reads as a UI element, not an effect.
        const wave = Math.sin(p * Math.PI * o.broken * 2) * 0.62
          + Math.sin(p * Math.PI * o.broken * 3.4 + 1.1) * 0.38;
        m *= 1 - (o.brokenDepth ?? 0.75) * Math.max(0, -wave * 1.6);
      }
      if (m <= 0) continue;
      fMax(F, x, y, m * (1 - Math.pow(d / th, 1.8)));
    }
  }
}

interface ArcOpts {
  cx: number; cy: number; r: number;
  squash?: number;
  lead: number;    // leading edge angle (deg, clockwise from east, y down)
  span: number;    // how far the trail reaches behind the leading edge
  dir?: number;    // -1 mirrors the sweep
  width: number;   // half-width at the fattest point
  amp: number;
  dash?: number;   // >0 breaks the trail into wisps
}

/**
 * Width profile of a sword trail: a 1 px wisp at the tail that swells to the
 * full width just behind the leading edge and comes back to a point at the tip.
 * The 0.3 floor is what keeps the tail *visible* — without it the trail
 * quantises away and the arc reads as a short comma instead of a sweep.
 */
const arcWidth = (p: number) =>
  0.3 + 0.7 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(p, 1.45))), 0.75);

/** A swept blade afterimage: bright and fat near the leading edge, wisp behind. */
function fArc(F: Field, o: ArcOpts): void {
  const sq = o.squash ?? 0.72;
  const dir = o.dir ?? 1;
  const tail = o.lead - o.span;
  const pad = o.width + 2;
  for (let y = 0; y < F.h; y++) {
    for (let x = 0; x < F.w; x++) {
      const dx = x + 0.5 - o.cx;
      const dy = (y + 0.5 - o.cy) / sq;
      const dist = Math.hypot(dx, dy);
      const d = Math.abs(dist - o.r);
      if (d > pad) continue;
      let a = ((Math.atan2(dy, dx) * 180) / Math.PI) * dir;
      while (a < tail) a += 360;
      while (a > tail + 360) a -= 360;
      const p = (a - tail) / o.span;
      if (p < 0 || p > 1) continue;
      const w = o.width * arcWidth(p);
      if (w <= 0.25 || d > w) continue;
      let along = 0.34 + 0.66 * Math.pow(p, 1.1);
      if (o.dash) along *= 1 - 0.55 * Math.max(0, -Math.sin(p * Math.PI * o.dash * 2));
      // Plateau cross-section: stays hot until the last pixel, so the dark
      // outer band is a 1 px fringe instead of a fat outline.
      const cross = 1 - Math.pow(d / w, 3);
      fMax(F, x, y, o.amp * along * cross);
    }
  }
}

/** Point on the arc's centreline at parameter p (0 = tail, 1 = leading edge). */
function arcPoint(o: ArcOpts, p: number): [number, number] {
  const sq = o.squash ?? 0.72;
  const dir = o.dir ?? 1;
  const a = ((o.lead - o.span * (1 - p)) * dir * Math.PI) / 180;
  return [o.cx + Math.cos(a) * o.r, o.cy + Math.sin(a) * o.r * sq];
}

// ── sword arcs ─────────────────────────────────────────────────────────────

const SLASH_W = 40, SLASH_H = 32;

/**
 * Four frames of one swing. The sweep travels ~230° across the four frames,
 * which at 24fps is ~42ms per frame: the eye reads it as a single fast arc
 * rather than four drawings. Frame 1 is the money frame — widest, brightest,
 * and the only one carrying a specular core.
 */
function slashFrames(dir: 'n' | 's' | 'e'): Surface[] {
  const cx = 20, cy = 16;
  // Leading edge angle per frame, in the sprite's own sweep space. The radius
  // punches out on frame 1 and pulls back in after: the arc is *thrown*.
  const keys = [
    { lead: 26, span: 66, r: 11.5, width: 1.8, amp: 0.95, dash: 0 },
    { lead: 104, span: 142, r: 14.0, width: 3.6, amp: 1.10, dash: 0 },
    { lead: 174, span: 134, r: 13.0, width: 2.3, amp: 0.88, dash: 0 },
    { lead: 216, span: 106, r: 12.2, width: 1.6, amp: 0.52, dash: 3.5 },
  ];
  // Sweep space → screen: south sweeps right→bottom→left; north is its mirror;
  // east sweeps top→right→bottom (the sweep is rotated a quarter turn).
  const rot = dir === 'e' ? -95 : 0;
  const mirror = dir === 'n' ? -1 : 1;

  return keys.map((k, i) => {
    const s = new Surface(SLASH_W, SLASH_H);
    const F = field(SLASH_W, SLASH_H);
    const o: ArcOpts = {
      cx, cy, r: k.r, lead: k.lead + rot, span: k.span, dir: mirror,
      width: k.width, amp: k.amp, dash: k.dash || undefined,
      squash: 0.72,
    };
    fArc(F, o);

    // A second, tighter inner arc gives the blade a hot core line rather than
    // a uniformly fat band — light has an edge, not a body.
    if (i === 1) {
      fArc(F, { ...o, r: k.r - 0.8, width: 1.05, amp: 1.55, span: k.span * 0.78, lead: o.lead - 3 });
    }
    if (i === 2) {
      fArc(F, { ...o, r: k.r + 0.5, width: 0.9, amp: 1.05, span: k.span * 0.55 });
    }

    // Shards thrown off the leading edge: the cue that reads as *speed*.
    if (i === 1 || i === 2) {
      const rnd = rng(9100 + i * 31);
      const n = i === 1 ? 6 : 3;
      for (let j = 0; j < n; j++) {
        const p = 0.68 + rnd.range(0, 0.32);
        const [px, py] = arcPoint(o, p);
        const away = rnd.range(2.5, 6);
        const ang = Math.atan2(py - cy, px - cx) + rnd.range(-0.4, 0.4);
        fLine(F, px, py, px + Math.cos(ang) * away, py + Math.sin(ang) * away * 0.72,
          0.9, 0.15, i === 1 ? 0.9 : 0.55, 0.05);
      }
      // Tip flare — a bright knot exactly where the blade is *now*.
      if (i === 1) {
        const [tx, ty] = arcPoint(o, 0.93);
        fDot(F, tx, ty, 2.6, 1.6, 1.2);
      }
    }

    paint(s, F, bands(P.SLASH, 0.16, 1.15, 0.2));

    // Specular core: two pixels, on the money frame only.
    if (i === 1) {
      const [tx, ty] = arcPoint(o, 0.86);
      s.pxOver(Math.round(tx), Math.round(ty), P.SPECULAR);
      s.pxOver(Math.round(tx) + (dir === 'e' ? 0 : 1), Math.round(ty) + (dir === 'e' ? 1 : 0), P.SPECULAR);
    }
    return s;
  });
}

// ── shards ─────────────────────────────────────────────────────────────────

interface Needle { a: number; len: number; w: number; amp: number; }

/** Tapered spikes radiating from a point — the vocabulary of every hit. */
function fNeedles(F: Field, cx: number, cy: number, ns: Needle[], squash = 1, inner = 0): void {
  for (const n of ns) {
    const c = Math.cos(n.a), s = Math.sin(n.a) * squash;
    fLine(
      F, cx + c * inner, cy + s * inner,
      cx + c * (inner + n.len), cy + s * (inner + n.len),
      n.w, 0.1, n.amp, 0.04,
    );
  }
}

/** Evenly spread angles with a deterministic wobble, so shards never look combed. */
function spreadAngles(n: number, r: Rng, jitter = 0.34, offset = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(offset + (i / n) * Math.PI * 2 + r.range(-jitter, jitter));
  return out;
}

/** The classic four-point pixel sparkle: long thin arms, tiny hot centre. */
function fSparkle(F: Field, cx: number, cy: number, len: number, amp: number, diag = 0): void {
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    fLine(F, cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, 0.85, 0.1, amp, 0.03);
  }
  if (diag > 0) {
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      fLine(F, cx, cy, cx + Math.cos(a) * diag, cy + Math.sin(a) * diag, 0.6, 0.1, amp * 0.55, 0.03);
    }
  }
  fDot(F, cx, cy, 1.6, amp * 1.15, 1.1);
}

// ── impact / crit ──────────────────────────────────────────────────────────

/**
 * A hit burst. The shard angles are generated once and reused across frames,
 * so each spike is the *same* spike travelling outward — that consistency is
 * what makes 5 drawings read as one event instead of five explosions.
 */
function impactFrames(): Surface[] {
  const S = 24, c = 11.5;
  const r = rng(4401);
  const angles = spreadAngles(8, r, 0.3);
  const lens = angles.map(() => r.range(0.7, 1.25));
  const keys = [
    { n: 5, inner: 0.4, len: 3.2, w: 1.0, amp: 0.95, core: 2.4, coreAmp: 1.25 },
    { n: 8, inner: 1.2, len: 6.6, w: 1.6, amp: 1.45, core: 3.6, coreAmp: 1.85 },
    { n: 8, inner: 3.2, len: 5.4, w: 1.0, amp: 1.00, core: 2.2, coreAmp: 0.95 },
    { n: 7, inner: 5.6, len: 3.4, w: 0.7, amp: 0.62, core: 0, coreAmp: 0 },
    { n: 6, inner: 7.6, len: 2.0, w: 0.55, amp: 0.36, core: 0, coreAmp: 0 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    fNeedles(F, c, c, angles.slice(0, k.n).map((a, j) => ({
      a, len: k.len * lens[j], w: k.w, amp: k.amp * (0.8 + 0.2 * lens[j]),
    })), 1, k.inner);
    if (k.core > 0) fDot(F, c, c, k.core, k.coreAmp, 1.3);
    paint(s, F, bandsAt(P.IMPACT, 0.16, 1.25, 0.22, k.amp, 1.45));
    if (i === 1) { s.pxOver(11, 11, P.SPECULAR); s.pxOver(12, 11, P.SPECULAR); }
    return s;
  });
}

/** Crit: the impact plus a ring shockwave that outruns the shards. */
function critFrames(): Surface[] {
  const S = 32, c = 15.5;
  const r = rng(4507);
  const angles = spreadAngles(10, r, 0.26);
  const lens = angles.map(() => r.range(0.7, 1.3));
  const keys = [
    { n: 6, inner: 0.5, len: 3.4, w: 1.1, amp: 1.00, core: 2.6, coreAmp: 1.35, ring: 0, rThick: 0, rAmp: 0 },
    { n: 10, inner: 1.2, len: 6.6, w: 1.6, amp: 1.50, core: 3.0, coreAmp: 1.95, ring: 8.4, rThick: 0.95, rAmp: 1.30 },
    { n: 5, inner: 4.0, len: 3.6, w: 1.0, amp: 1.05, core: 1.8, coreAmp: 0.85, ring: 11.6, rThick: 0.8, rAmp: 0.95 },
    { n: 5, inner: 7.4, len: 2.2, w: 0.75, amp: 0.52, core: 0, coreAmp: 0, ring: 13.6, rThick: 0.7, rAmp: 0.62 },
    { n: 3, inner: 9.0, len: 1.4, w: 0.55, amp: 0.30, core: 0, coreAmp: 0, ring: 15.2, rThick: 0.6, rAmp: 0.34 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    if (k.ring > 0) {
      fRing(F, {
        cx: c, cy: c, r: k.ring, squash: 0.82, thick: k.rThick, amp: k.rAmp,
        broken: i >= 2 ? 7 : 0, brokenDepth: 0.5,
        ampAt: (p) => 0.86 + 0.14 * Math.cos(p * Math.PI * 2 - 1.2),
      });
    }
    fNeedles(F, c, c, angles.slice(0, k.n).map((a, j) => ({
      a, len: k.len * lens[j], w: k.w, amp: k.amp * (0.8 + 0.2 * lens[j]),
    })), 1, k.inner);
    if (k.core > 0) fDot(F, c, c, k.core, k.coreAmp, 1.25);
    paint(s, F, bandsAt(P.IMPACT, 0.15, 1.3, 0.22, k.amp, 1.5));
    if (i === 1) {
      s.pxOver(15, 15, P.SPECULAR); s.pxOver(16, 15, P.SPECULAR);
      s.pxOver(15, 16, P.SPECULAR);
    }
    return s;
  });
}

// ── ground dust ────────────────────────────────────────────────────────────

/**
 * Footstep puff: one lobe under the foot that splits into two, pushes sideways
 * and up, and dissolves into grit. Two separating lobes read as *dust*; one
 * growing blob reads as a stain.
 */
function dustFrames(seed: number): Surface[] {
  const W = 14, H = 12;
  const r = rng(seed);
  const keys = [
    { spread: 0.0, rise: 0.0, rx: 1.7, ry: 1.2, amp: 1.30, lobes: 1, grit: 0 },
    { spread: 1.6, rise: 0.6, rx: 2.4, ry: 1.7, amp: 1.45, lobes: 2, grit: 2 },
    { spread: 2.8, rise: 1.4, rx: 2.5, ry: 1.9, amp: 1.10, lobes: 2, grit: 2 },
    { spread: 3.7, rise: 2.2, rx: 2.3, ry: 1.8, amp: 0.80, lobes: 2, grit: 2 },
    { spread: 4.4, rise: 2.9, rx: 1.9, ry: 1.6, amp: 0.55, lobes: 2, grit: 1 },
    { spread: 4.9, rise: 3.5, rx: 1.4, ry: 1.2, amp: 0.34, lobes: 2, grit: 1 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    const cy = 9.2 - k.rise;
    if (k.lobes === 1) {
      fPuff(F, 7, cy, k.rx, k.ry, k.amp);
    } else {
      fPuff(F, 7 - k.spread, cy + 0.3, k.rx, k.ry, k.amp);
      fPuff(F, 7 + k.spread, cy, k.rx * 0.9, k.ry * 0.9, k.amp * 0.92);
      if (i <= 2) fPuff(F, 7, cy - 0.6, k.rx * 0.7, k.ry * 0.7, k.amp * 0.8);
    }
    for (let j = 0; j < k.grit; j++) {
      fDot(F, 7 + r.range(-5, 5), cy - r.range(0, 2.5), 0.85, k.amp * 0.75, 1);
    }
    return paint(s, F, bandsAt(P.DUST, 0.46, 1.26, 0.3, k.amp, 1.45));
  });
}

/** Landing ring: dust pushed outward along the ground. */
function landFrames(): Surface[] {
  const W = 26, H = 12, cx = 13, cy = 7;
  const keys = [
    { r: 3.0, thick: 1.6, amp: 1.1, broken: 0 },
    { r: 6.0, thick: 2.0, amp: 1.2, broken: 3 },
    { r: 9.0, thick: 1.5, amp: 0.8, broken: 4 },
    { r: 11.5, thick: 1.1, amp: 0.45, broken: 6 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    fRing(F, {
      cx, cy, r: k.r, squash: 0.44, thick: k.thick, amp: k.amp,
      broken: k.broken, brokenDepth: 0.55,
      ampAt: (p) => 0.75 + 0.25 * Math.sin(p * Math.PI * 2),
    });
    if (i <= 1) fDot(F, cx, cy + 1, 2.4 + i, 0.55 - i * 0.2, 2);
    return paint(s, F, bandsAt(P.DUST, 0.34, 1.02, 0.28, k.amp, 1.2));
  });
}

/**
 * Dash trail: a few sparse wisps that taper at *both* ends, plus one scuff of
 * dust at ground level. Solid bars read as a barcode; a roll leaves streaks of
 * displaced air, so each one is a needle, not a rectangle.
 */
function dashTrailFrames(): Surface[] {
  const W = 26, H = 22;
  // Lengths are deliberately uneven and longest in the middle, so the streaks
  // add up to one lens-shaped smear instead of a stack of equal rules.
  const streaks = [
    { y: 5.0, x: 10.0, len: 10, w: 0.7, a: 0.55 },
    { y: 8.0, x: 3.5, len: 19, w: 1.5, a: 0.9 },
    { y: 11.5, x: 1.5, len: 23, w: 1.9, a: 1.0 },
    { y: 15.0, x: 4.0, len: 18, w: 1.4, a: 0.85 },
    { y: 17.5, x: 11.0, len: 9, w: 0.65, a: 0.5 },
  ];
  const keys = [
    { amp: 1.55, shrink: 0.0, off: 0, n: 5 },
    { amp: 1.15, shrink: 0.24, off: 2.5, n: 5 },
    { amp: 0.74, shrink: 0.48, off: 5.0, n: 4 },
    { amp: 0.40, shrink: 0.70, off: 7.5, n: 3 },
  ];
  return keys.map((k) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    streaks.slice(0, k.n).forEach((st) => {
      const len = st.len * (1 - k.shrink);
      const x0 = st.x + k.off;
      const amp = k.amp * st.a;
      // head half: sharp point → full width. tail half: full width → nothing.
      fLine(F, x0, st.y, x0 + len * 0.4, st.y, 0.2, st.w, amp * 0.45, amp);
      fLine(F, x0 + len * 0.4, st.y, x0 + len, st.y, st.w, 0.15, amp, amp * 0.1);
    });
    // one scuff of dust where the body met the ground
    fPuff(F, 8 + k.off * 0.6, 19.4, 3.0, 1.6, k.amp * 0.7);
    fPuff(F, 14 + k.off * 0.5, 20.0, 2.2, 1.2, k.amp * 0.55);
    return paint(s, F, bandsAt(P.DUST, 0.42, 1.3, 0.3, k.amp, 1.55));
  });
}

// ── damage / block ─────────────────────────────────────────────────────────

/** Damage burst: red-violet, jagged, gone in three frames. */
function hurtFrames(): Surface[] {
  const S = 28, c = 13.5;
  const r = rng(6101);
  const angles = spreadAngles(9, r, 0.4);
  const lens = angles.map(() => r.range(0.6, 1.35));
  const keys = [
    { n: 6, inner: 0.5, len: 4.5, w: 1.3, amp: 1.1, core: 3.2, coreAmp: 1.4 },
    { n: 9, inner: 1.5, len: 9.0, w: 2.0, amp: 1.5, core: 5.0, coreAmp: 1.8 },
    { n: 8, inner: 4.5, len: 5.5, w: 1.1, amp: 0.75, core: 2.4, coreAmp: 0.6 },
  ];
  return keys.map((k) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    fNeedles(F, c, c, angles.slice(0, k.n).map((a, j) => ({
      a, len: k.len * lens[j], w: k.w, amp: k.amp * (0.75 + 0.25 * lens[j]),
    })), 0.95, k.inner);
    if (k.core > 0) fDot(F, c, c, k.core, k.coreAmp, 1.5);
    return paint(s, F, bandsAt(P.HURT, 0.16, 1.3, 0.24, k.amp, 1.5));
  });
}

/** Block: a hard metallic clang. Cold needles, a white centre, no glow. */
function blockFrames(): Surface[] {
  const S = 22, c = 10.5;
  const r = rng(6203);
  const angles = spreadAngles(7, r, 0.5, 0.3);
  const lens = angles.map(() => r.range(0.55, 1.4));
  const keys = [
    { n: 4, inner: 0.3, len: 4.0, w: 0.9, amp: 1.2, core: 2.0, coreAmp: 1.5 },
    { n: 7, inner: 0.8, len: 8.0, w: 1.1, amp: 1.5, core: 2.8, coreAmp: 1.9 },
    { n: 6, inner: 3.5, len: 5.0, w: 0.7, amp: 0.9, core: 1.4, coreAmp: 0.7 },
    { n: 5, inner: 6.0, len: 2.4, w: 0.5, amp: 0.45, core: 0, coreAmp: 0 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    fNeedles(F, c, c, angles.slice(0, k.n).map((a, j) => ({
      a, len: k.len * lens[j], w: k.w, amp: k.amp * (0.7 + 0.3 * lens[j]),
    })), 1, k.inner);
    if (k.core > 0) fDot(F, c, c, k.core, k.coreAmp, 1.1);
    paint(s, F, bandsAt(P.COLD_SPARK, 0.18, 1.35, 0.2, k.amp, 1.5));
    // A single warm pixel keeps the clang from reading as an Echo effect.
    if (i <= 1) s.pxOver(c - 0.5, c - 0.5, P.SPECULAR);
    if (i === 1) { s.pxOver(c + 0.5, c - 0.5, P.LANTERN[3]); s.pxOver(c - 0.5, c + 0.5, P.LANTERN[3]); }
    return s;
  });
}

// ── pickups ────────────────────────────────────────────────────────────────

const HEART = [
  '.XX.XX.',
  'XHHXHHX',
  'XHHHHHX',
  'XHHHHHX',
  '.XHHHX.',
  '..XHX..',
  '...X...',
];

/** Heart pickup: the heart rises, brightens, and pops into sparks. */
function heartPickupFrames(): Surface[] {
  const W = 16, H = 16;
  const out: Surface[] = [];
  const rose = P.FLOWER_ROSE;
  for (let i = 0; i < 4; i++) {
    const s = new Surface(W, H);
    const y0 = 8 - i * 2;
    if (i < 3) {
      for (let j = 0; j < HEART.length; j++) {
        for (let k = 0; k < HEART[j].length; k++) {
          const ch = HEART[j][k];
          if (ch === '.') continue;
          const x = 4 + k, y = y0 + j;
          if (ch === 'X') s.px(x, y, rose[i === 2 ? 2 : 1]);
          else s.px(x, y, j <= 1 && k <= 3 ? rose[3] : rose[2]);
        }
      }
      // specular glint on the upper-left lobe
      s.pxOver(6, y0 + 1, P.SPECULAR);
    }
    // sparks around it, growing as it rises
    const F = field(W, H);
    const r = rng(7001 + i);
    const n = i === 3 ? 7 : 2 + i;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + r.range(-0.3, 0.3);
      const rad = 3 + i * 1.9;
      fSparkle(F, 7.5 + Math.cos(a) * rad, y0 + 3 + Math.sin(a) * rad * 0.8,
        i === 3 ? 1.6 : 1.2, i === 3 ? 0.9 : 0.7);
    }
    paint(s, F, bands(P.LANTERN, 0.3, 1.1, 0.3));
    out.push(s);
  }
  return out;
}

/** Generic collect sparkle: a star that blooms, spins out and settles. */
function pickupSparkleFrames(): Surface[] {
  const S = 16, c = 7.5;
  const r = rng(7103);
  const motes = spreadAngles(6, r, 0.5).map((a) => ({ a, sp: r.range(0.8, 1.3) }));
  const keys = [
    { star: 2.5, amp: 0.9, mote: 1.2, moteAmp: 0.0 },
    { star: 6.0, amp: 1.5, mote: 2.6, moteAmp: 0.9 },
    { star: 4.5, amp: 1.15, mote: 4.4, moteAmp: 0.8 },
    { star: 3.0, amp: 0.8, mote: 5.8, moteAmp: 0.62 },
    { star: 1.8, amp: 0.5, mote: 6.8, moteAmp: 0.42 },
    { star: 0.0, amp: 0.0, mote: 7.4, moteAmp: 0.24 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    if (k.star > 0) fSparkle(F, c, c, k.star, k.amp, k.star * 0.45);
    if (k.moteAmp > 0) {
      for (const m of motes) {
        const rad = k.mote * m.sp;
        fDot(F, c + Math.cos(m.a) * rad, c + Math.sin(m.a) * rad, 1.0, k.moteAmp, 1);
      }
    }
    paint(s, F, bandsAt(P.LANTERN, 0.22, 1.25, 0.3, Math.max(k.amp, k.moteAmp * 1.4), 1.5));
    if (i === 1) s.pxOver(c - 0.5, c - 0.5, P.SPECULAR);
    return s;
  });
}

// ── environmental life ─────────────────────────────────────────────────────

/**
 * A drifting leaf, seen tumbling: broad face, tilted, edge-on, tilted back.
 * Four frames is enough for the eye to invent the rotation between them.
 */
function leafFrames(ramp: readonly string[]): Surface[] {
  // Four hand-set poses of one tumbling leaf: broad face, three-quarter,
  // edge-on (a 1 px sliver — that frame is what sells the spin), and back.
  const poses = [
    [
      '..*XX..',
      '.*XvXXo',
      'XXvXXo.',
      '.oXvo..',
      '..o....',
    ],
    [
      '...*X..',
      '..*XXo.',
      '.XvXXo.',
      '.XvXo..',
      '..oo...',
    ],
    [
      '...*...',
      '...X...',
      '...X...',
      '...o...',
      '...o...',
    ],
    [
      '..X*...',
      '.oXXX*.',
      '.oXvXX.',
      '..ooXo.',
      '....o..',
    ],
  ];
  return poses.map((rows) => {
    const s = new Surface(9, 9);
    const oy = 2;
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        const c = ch === '*' ? ramp[4] : ch === 'o' ? ramp[0] : ch === 'v' ? ramp[1] : ramp[2];
        s.px(x + 1, y + oy, c);
      }
    }
    return s;
  });
}

/** Warm daytime motes. Sparse, tiny, and never bright enough to distract. */
function pollenFrames(): Surface[] {
  const S = 10;
  const motes = [
    { x: 2.5, y: 6.5, ph: 0 },
    { x: 6.0, y: 3.5, ph: 1.7 },
    { x: 7.5, y: 7.5, ph: 3.4 },
    { x: 4.0, y: 1.8, ph: 5.0 },
  ];
  return [0, 1, 2, 3].map((f) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    motes.forEach((m, j) => {
      const t = f / 4;
      const x = m.x + Math.sin(m.ph + t * Math.PI * 2) * 1.2;
      const y = m.y - t * 1.4 + Math.cos(m.ph + t * Math.PI * 2) * 0.5;
      const amp = 0.75 + 0.45 * Math.sin(m.ph + t * Math.PI * 2 + j);
      fDot(F, x, y, 1.5, amp, 1.8);
    });
    return paint(s, F, bands(P.LANTERN, 0.3, 1.15, 0.34));
  });
}

/** Evening firefly: a hard 1 px core inside a dithered halo, pulsing. */
function fireflyFrames(): Surface[] {
  const S = 10, c = 4.5;
  const keys = [
    { halo: 2.2, amp: 0.55, core: false },
    { halo: 3.6, amp: 1.15, core: true },
    { halo: 4.4, amp: 0.95, core: true },
    { halo: 3.0, amp: 0.7, core: false },
  ];
  return keys.map((k) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    fDot(F, c, c, k.halo, k.amp * 0.6, 1.7);
    fDot(F, c, c, 1.4, k.amp * 1.3, 1);
    paint(s, F, bandsAt(P.LANTERN, 0.26, 1.25, 0.22, k.amp, 1.15));
    if (k.core) s.pxOver(4, 4, P.SPECULAR);
    return s;
  });
}

/** Chimney smoke: a puff that rises, leans downwind, swells and dissolves. */
function smokeFrames(): Surface[] {
  const W = 18, H = 22;
  const keys = [
    { y: 19.0, x: 6.0, rx: 1.9, ry: 1.7, amp: 1.30, soft: 0.5, lobes: 1 },
    { y: 15.5, x: 6.6, rx: 2.7, ry: 2.5, amp: 1.35, soft: 0.6, lobes: 2 },
    { y: 12.2, x: 7.6, rx: 3.4, ry: 3.1, amp: 1.28, soft: 0.9, lobes: 3 },
    { y: 9.0, x: 9.0, rx: 4.0, ry: 3.6, amp: 1.20, soft: 1.4, lobes: 3 },
    { y: 6.2, x: 10.6, rx: 4.6, ry: 4.0, amp: 1.10, soft: 2.1, lobes: 3 },
    { y: 4.0, x: 12.0, rx: 5.0, ry: 4.2, amp: 1.00, soft: 3.1, lobes: 3 },
  ];
  return keys.map((k) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    fPuff(F, k.x, k.y, k.rx, k.ry, k.amp, k.soft);
    if (k.lobes > 1) {
      fPuff(F, k.x - k.rx * 0.62, k.y + k.ry * 0.42, k.rx * 0.68, k.ry * 0.66, k.amp * 0.94, k.soft);
    }
    if (k.lobes > 2) {
      fPuff(F, k.x + k.rx * 0.6, k.y - k.ry * 0.36, k.rx * 0.6, k.ry * 0.58, k.amp * 0.88, k.soft);
      fPuff(F, k.x - k.rx * 0.2, k.y - k.ry * 0.6, k.rx * 0.5, k.ry * 0.5, k.amp * 0.82, k.soft);
    }
    // Dissipation is coverage, not colour: the puff keeps its value and loses
    // its pixels, which is the only fade that looks right in pixel art.
    return paint(s, F, bands(P.SMOKE_PUFF, 0.34, 1.3, 0.5));
  });
}

/** Cooking steam: two thin wavering wisps, no body at all. */
function steamFrames(): Surface[] {
  const W = 12, H = 18;
  return [0, 1, 2, 3].map((f) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    const t = f / 4;
    for (let j = 0; j < 2; j++) {
      const bx = 4 + j * 3.5;
      const phase = t * Math.PI * 2 + j * 2.1;
      let px = bx, py = 16 - j * 1.5;
      for (let k = 0; k < 6; k++) {
        const ny = py - 2.4;
        const nx = bx + Math.sin(phase + k * 0.9) * (1.1 + k * 0.28);
        const amp = (1.35 - k * 0.21) * (j === 0 ? 1 : 0.86);
        fLine(F, px, py, nx, ny, 1.05 - k * 0.07, 0.95 - k * 0.07, amp, amp * 0.9);
        px = nx; py = ny;
      }
    }
    return paint(s, F, bands(P.STEAM, 0.42, 1.25, 0.22));
  });
}

/** Water splash: a crown of droplets, then a ring left on the surface. */
function splashFrames(): Surface[] {
  const W = 22, H = 16, cx = 11, cy = 11;
  const r = rng(9301);
  const angles = spreadAngles(7, r, 0.25, -Math.PI / 2 - 0.4).map((a) => a * 0.55 - 1.0);
  const keys = [
    { crown: 3.2, amp: 1.20, ring: 0, rAmp: 0, drops: 0, dist: 0 },
    { crown: 6.5, amp: 1.45, ring: 3.5, rAmp: 1.0, drops: 5, dist: 5.5 },
    { crown: 3.5, amp: 1.00, ring: 6.5, rAmp: 0.9, drops: 6, dist: 8.5 },
    { crown: 0, amp: 0.66, ring: 8.5, rAmp: 0.66, drops: 5, dist: 10.5 },
    { crown: 0, amp: 0.36, ring: 10.0, rAmp: 0.36, drops: 3, dist: 11.5 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    if (k.ring > 0) {
      fRing(F, {
        cx, cy: cy + 1, r: k.ring, squash: 0.38, thick: 0.9, amp: k.rAmp,
        broken: i >= 2 ? 5 : 0, brokenDepth: 0.55,
      });
    }
    if (k.crown > 0) {
      // the crown: a splayed V of water thrown up from the point of entry
      for (let j = -1; j <= 1; j += 2) {
        fLine(F, cx, cy, cx + j * k.crown * 0.55, cy - k.crown, 1.3, 0.4, k.amp, k.amp * 0.7);
      }
      fLine(F, cx, cy, cx, cy - k.crown * 1.15, 1.0, 0.35, k.amp * 1.1, k.amp * 0.75);
    }
    for (let j = 0; j < k.drops; j++) {
      const a = angles[j % angles.length];
      const d = k.dist * (0.7 + 0.3 * ((j % 3) / 2));
      // ballistic arc: up fast, then falling back toward the surface
      const h = Math.max(0, 5.8 * Math.sin(((i + 0.6) / 4.6) * Math.PI));
      fDot(F, cx + Math.cos(a) * d, cy - h + Math.sin(a) * d * 0.35, 0.95, k.amp * 0.85, 1);
    }
    paint(s, F, bandsAt(P.WATER, 0.2, 1.25, 0.3, k.amp, 1.45));
    // foam only where the water is thickest — the one near-white in the effect
    if (i <= 2) {
      s.pxOver(cx, cy - Math.round(k.crown * 0.8), P.WATER_FOAM);
      s.pxOver(cx - 1, cy - Math.round(k.crown * 0.55), P.WATER_FOAM);
    }
    return s;
  });
}

/** A spreading ring on the water surface. Two rings so it reads as a wave train. */
function rippleFrames(): Surface[] {
  const W = 26, H = 14, cx = 13, cy = 7;
  const keys = [
    { r: 3.0, amp: 1.15, r2: 0, a2: 0 },
    { r: 6.0, amp: 0.95, r2: 2.5, a2: 0.8 },
    { r: 9.0, amp: 0.72, r2: 5.0, a2: 0.62 },
    { r: 11.8, amp: 0.48, r2: 7.5, a2: 0.4 },
  ];
  return keys.map((k) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    fRing(F, { cx, cy, r: k.r, squash: 0.42, thick: 0.85, amp: k.amp, broken: 4, brokenDepth: 0.4 });
    if (k.r2 > 0) fRing(F, { cx, cy, r: k.r2, squash: 0.42, thick: 0.7, amp: k.a2, broken: 3, brokenDepth: 0.5 });
    const out = paint(s, F, bandsAt(P.WATER, 0.18, 1.05, 0.3, k.amp, 1.15));
    return out;
  });
}

/** Grass parting where something moved through it, then springing back. */
function grassRustleFrames(): Surface[] {
  const W = 18, H = 13;
  const r = rng(9407);
  const blades: Array<{ x: number; h: number; side: number }> = [];
  for (let i = 0; i < 9; i++) {
    blades.push({ x: 1 + i * 2 + r.int(0, 1), h: 4 + r.int(0, 3), side: i < 4 ? -1 : i > 4 ? 1 : 0 });
  }
  const lean = [0.4, 1.0, 0.6, -0.3];
  return lean.map((L) => {
    const s = new Surface(W, H);
    for (const b of blades) {
      const tipX = b.x + Math.round(b.side * L * 3.6);
      const base = H - 2;
      // blades in the path are pressed down as well as aside
      const press = b.side === 0 ? Math.max(0, L) * 0.55 : Math.max(0, L) * 0.2;
      const hgt = Math.max(2, Math.round(b.h * (1 - press)));
      for (let k = 0; k <= hgt; k++) {
        const t = k / hgt;
        const x = Math.round(b.x + (tipX - b.x) * t * t);
        const y = base - k;
        const c = k >= hgt - 1 ? P.GRASS[4] : k > hgt * 0.5 ? P.GRASS[3] : P.GRASS[1];
        s.px(x, y, c);
      }
      s.px(b.x, base + 1, P.GRASS[0], 0.5);
    }
    return s;
  });
}

/** A small bird startled into the air — pure silhouette, read from shape alone. */
function birdFlyFrames(): Surface[] {
  const S = 16;
  // Startled → wings thrown up → power stroke down → gliding away.
  const poses: Array<{ y: number; wing: 'up' | 'mid' | 'down' | 'rest'; sx: number }> = [
    { y: 11, wing: 'rest', sx: 0 },
    { y: 9, wing: 'up', sx: 1 },
    { y: 5, wing: 'down', sx: 2 },
    { y: 3, wing: 'mid', sx: 3 },
  ];
  return poses.map((p) => {
    const s = new Surface(S, S);
    const bx = 6 + p.sx, by = p.y;
    const ink = P.OUTLINE;
    // body + head + beak + tail
    s.ellipse(bx, by, 5, 3, ink);
    s.px(bx + 5, by - 1, ink);
    s.px(bx + 4, by - 1, ink);
    s.px(bx + 6, by, ink);
    s.px(bx - 1, by + 1, ink);
    s.px(bx - 2, by + 1, ink);
    if (p.wing === 'rest') {
      s.hline(bx + 1, by - 1, 3, ink);
    } else if (p.wing === 'down') {
      s.line(bx + 1, by, bx - 2, by + 3, ink);
      s.line(bx + 2, by, bx - 1, by + 3, ink);
      s.line(bx + 3, by, bx + 6, by + 3, ink);
      s.line(bx + 3, by + 1, bx + 5, by + 3, ink);
    } else if (p.wing === 'up') {
      s.line(bx + 1, by - 1, bx - 2, by - 5, ink);
      s.line(bx + 2, by - 1, bx - 1, by - 5, ink);
      s.line(bx + 3, by - 1, bx + 6, by - 5, ink);
      s.line(bx + 3, by, bx + 5, by - 4, ink);
    } else {
      s.line(bx + 1, by - 1, bx - 3, by - 2, ink);
      s.line(bx + 1, by, bx - 3, by - 1, ink);
      s.line(bx + 3, by - 1, bx + 7, by - 2, ink);
      s.line(bx + 3, by, bx + 7, by - 1, ink);
    }
    // one lit pixel on the back keeps it from being a hole in the world
    s.pxOver(bx + 1, by, P.OUTLINE_SOFT);
    s.pxOver(bx + 2, by, P.OUTLINE_SOFT);
    return s;
  });
}

// ── sound made visible ─────────────────────────────────────────────────────

/**
 * The town bell. Concentric rings expanding from the tower, thin and warm.
 * This is the motif the whole conditioning quest hangs on, so it is drawn as
 * *lines of light*: a 1 px ring, brighter at the leading wave, dithering out at
 * the rim, with the light-direction bias every other sprite obeys.
 */
function toneRingFrames(
  size: number, count: number, ramp: readonly string[],
  opts: { step: number; spacing: number; thick?: number; squash?: number; style?: 'plain' | 'dotted' | 'double' },
): Surface[] {
  const c = size / 2 - 0.5;
  const maxR = size / 2 - 1.5;
  const thick = opts.thick ?? 0.85;
  const squash = opts.squash ?? 0.9;
  return Array.from({ length: count }, (_, f) => {
    const s = new Surface(size, size);
    const F = field(size, size);
    let peak = 0;
    for (let wave = 0; wave < 5; wave++) {
      const rad = f * opts.step - wave * opts.spacing + 2.5;
      if (rad < 1 || rad > maxR + 3) continue;
      // Waves fade as they travel, and fade *out* as they reach the rim — a
      // wave that vanishes on one frame reads as a bug, not as distance.
      const rim = Math.max(0, Math.min(1, (maxR - rad) / 3));
      const amp = (1.35 - (rad / maxR) * 0.95) * (wave === 0 ? 1 : 0.82 - wave * 0.06) * rim;
      if (amp <= 0.05) continue;
      peak = Math.max(peak, amp);
      fRing(F, {
        cx: c, cy: c, r: rad, squash, thick, amp,
        broken: opts.style === 'dotted' ? 9 : 0,
        brokenDepth: 0.5,
        ampAt: (p) => 0.82 + 0.18 * Math.cos(p * Math.PI * 2 - 0.9),
      });
      if (opts.style === 'double' && rad > 4) {
        fRing(F, { cx: c, cy: c, r: rad - 2, squash, thick: thick * 0.7, amp: amp * 0.6 });
      }
    }
    return paint(s, F, bandsAt(ramp, 0.30, 1.08, 0.3, Math.max(peak, 0.2), 1.3));
  });
}

/**
 * The pipe crash: everything the bell is not. Jagged polylines, no ring, cold
 * white, irregular lengths. It should be actively unpleasant next to the bell.
 */
function crashFrames(): Surface[] {
  const S = 48, c = 23.5;
  const r = rng(9601);
  const spikes = spreadAngles(11, r, 0.5).map((a) => ({
    a,
    kink: r.range(-0.34, 0.34),
    kink2: r.range(-0.45, 0.45),
    len: r.range(0.6, 1.35),
  }));
  const keys = [
    { reach: 7, inner: 0.0, w: 1.6, amp: 1.15, n: 6, chips: 0 },
    { reach: 17, inner: 1.0, w: 2.0, amp: 1.55, n: 11, chips: 4 },
    { reach: 15, inner: 6.0, w: 1.3, amp: 1.15, n: 11, chips: 6 },
    { reach: 11, inner: 11.0, w: 1.0, amp: 0.82, n: 9, chips: 6 },
    { reach: 8, inner: 15.0, w: 0.8, amp: 0.54, n: 7, chips: 5 },
    { reach: 5, inner: 18.5, w: 0.6, amp: 0.32, n: 5, chips: 4 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    spikes.slice(0, k.n).forEach((sp, j) => {
      const L = k.reach * sp.len;
      // three straight segments, each bent — a broken pipe, not a ray of light
      const p0: [number, number] = [c + Math.cos(sp.a) * k.inner, c + Math.sin(sp.a) * k.inner];
      const p1: [number, number] = [p0[0] + Math.cos(sp.a) * L * 0.42, p0[1] + Math.sin(sp.a) * L * 0.42];
      const a2 = sp.a + sp.kink;
      const p2: [number, number] = [p1[0] + Math.cos(a2) * L * 0.34, p1[1] + Math.sin(a2) * L * 0.34];
      const a3 = a2 + sp.kink2;
      const p3: [number, number] = [p2[0] + Math.cos(a3) * L * 0.3, p2[1] + Math.sin(a3) * L * 0.3];
      const amp = k.amp * (0.7 + 0.3 * ((j % 3) / 2));
      fLine(F, p0[0], p0[1], p1[0], p1[1], k.w, k.w * 0.7, amp, amp * 0.9);
      fLine(F, p1[0], p1[1], p2[0], p2[1], k.w * 0.7, k.w * 0.45, amp * 0.9, amp * 0.7);
      fLine(F, p2[0], p2[1], p3[0], p3[1], k.w * 0.45, 0.12, amp * 0.7, amp * 0.15);
    });
    // detached chips of metal flying off
    for (let j = 0; j < k.chips; j++) {
      const a = r.range(0, Math.PI * 2);
      const d = (k.inner + k.reach) * r.range(0.75, 1.05);
      const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
      fLine(F, x, y, x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 0.8, 0.1, k.amp * 0.8, 0.05);
    }
    if (i <= 1) fDot(F, c, c, 3.5 + i * 2, k.amp * 1.2, 1.1);
    if (i === 2) fDot(F, c, c, 4.5, k.amp * 0.5, 2.2);
    paint(s, F, bandsAt(P.COLD_SPARK, 0.16, 1.35, 0.24, k.amp, 1.55));
    if (i === 1) {
      s.pxOver(23, 23, P.SPECULAR); s.pxOver(24, 23, P.SPECULAR);
      s.pxOver(23, 24, P.SPECULAR); s.pxOver(24, 24, P.SPECULAR);
    }
    return s;
  });
}

// ── the Echo ───────────────────────────────────────────────────────────────

/** Observe: one thin cyan ring sweeping the ground, with a fainter one behind. */
function observePingFrames(): Surface[] {
  const S = 96, c = 47.5;
  return Array.from({ length: 6 }, (_, f) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    const lead = 7 + f * 7.6;
    const amp = 1.35 - f * 0.16;
    fRing(F, {
      cx: c, cy: c, r: lead, squash: 0.6, thick: 0.85, amp,
      ampAt: (p) => 0.8 + 0.2 * Math.cos(p * Math.PI * 2 - 0.9),
    });
    if (f > 0) {
      fRing(F, { cx: c, cy: c, r: lead - 6.5, squash: 0.6, thick: 0.7, amp: amp * 0.5 });
    }
    if (f > 2) {
      fRing(F, { cx: c, cy: c, r: lead - 13, squash: 0.6, thick: 0.6, amp: amp * 0.26, broken: 11, brokenDepth: 0.6 });
    }
    // the pulse's origin keeps a small glow for the first half of the sweep
    if (f < 3) fDot(F, c, c, 5 - f, (1.0 - f * 0.3) * 0.9, 2);
    return paint(s, F, bandsAt(P.ECHO_CYAN, 0.30, 0.95, 0.3, amp, 1.35));
  });
}

/** Observe marker: a rotating bracket-diamond. "Something here matters." */
function observeMarkFrames(): Surface[] {
  const S = 16, c = 7.5;
  return [0, 1, 2, 3].map((f) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    const rot = (f * Math.PI) / 4;
    const rad = 5.7 + Math.sin((f / 4) * Math.PI * 2) * 0.7;
    const pts: Array<[number, number]> = [0, 1, 2, 3].map((k) => {
      const a = rot + (k * Math.PI) / 2;
      return [c + Math.cos(a) * rad, c + Math.sin(a) * rad];
    });
    // corner brackets rather than a closed diamond: it points, it doesn't frame
    for (let k = 0; k < 4; k++) {
      const p = pts[k], q = pts[(k + 1) % 4];
      fLine(F, p[0], p[1], p[0] + (q[0] - p[0]) * 0.36, p[1] + (q[1] - p[1]) * 0.36, 0.85, 0.6, 1.3, 0.85);
      fLine(F, q[0], q[1], q[0] + (p[0] - q[0]) * 0.36, q[1] + (p[1] - q[1]) * 0.36, 0.85, 0.6, 1.3, 0.85);
    }
    fDot(F, c, c, 1.9, 0.95, 1.4);
    paint(s, F, bands(P.ECHO_CYAN, 0.36, 1.18, 0.26));
    if (f % 2 === 0) s.pxOver(7, 7, P.ECHO_RUNE);
    return s;
  });
}

/** A tileable 32×8 length of luminous thread with a pulse travelling along it. */
function linkThreadFrames(): Surface[] {
  const W = 32, H = 8, y = 3.6;
  return [0, 1, 2, 3].map((f) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    for (let x = 0; x < W; x++) {
      // period 16 px, shifted 4 px per frame → the loop closes seamlessly
      const u = ((x - f * 4) % 16 + 16) % 16;
      const pulse = Math.exp(-Math.pow((u - 8) / 2.6, 2));
      const amp = 0.62 + 0.75 * pulse;
      for (let dy = -1; dy <= 1; dy++) {
        const d = Math.abs(dy + 0.5 - (y - Math.floor(y)));
        fMax(F, x, Math.floor(y) + dy, amp * (1 - Math.pow(Math.min(1, d / 1.35), 1.8)));
      }
    }
    return paint(s, F, bands(P.ECHO_CYAN, 0.42, 1.22, 0.24));
  });
}

/** The endpoint of a link: a small pulsing node. */
function linkNodeFrames(): Surface[] {
  const S = 12, c = 5.5;
  const keys = [
    { r: 2.6, amp: 1.0, core: 1.3 },
    { r: 3.4, amp: 1.3, core: 1.7 },
    { r: 4.2, amp: 1.05, core: 1.4 },
    { r: 3.2, amp: 0.85, core: 1.2 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    fRing(F, { cx: c, cy: c, r: k.r, thick: 0.8, amp: k.amp });
    fDot(F, c, c, k.core, k.amp * 1.15, 1.2);
    paint(s, F, bands(P.ECHO_CYAN, 0.42, 1.22, 0.24));
    if (i === 1) s.pxOver(5, 5, P.ECHO_RUNE);
    return s;
  });
}

/** A soft diamond glyph — the shape memory takes in this game's language. */
function memoryGlyph(F: Field, cx: number, cy: number, rad: number, amp: number): void {
  for (let k = 0; k < 4; k++) {
    const a1 = (k * Math.PI) / 2;
    const a2 = ((k + 1) * Math.PI) / 2;
    fLine(
      F, cx + Math.cos(a1) * rad, cy + Math.sin(a1) * rad * 1.25,
      cx + Math.cos(a2) * rad, cy + Math.sin(a2) * rad * 1.25,
      0.9, 0.9, amp, amp,
    );
  }
  fDot(F, cx, cy, rad * 0.45, amp * 0.7, 1.6);
}

/**
 * Recall: two ghosts of the same memory pull apart until one of them is clearly
 * the real one. Violet is the interfering trace; cyan is the true memory.
 */
function recallShimmerFrames(): Surface[] {
  const S = 32, c = 15.5;
  const keys = [
    { sep: 0.8, ghost: 0.95, real: 0.95, rad: 5.0 },
    { sep: 2.2, ghost: 1.05, real: 1.05, rad: 5.2 },
    { sep: 4.2, ghost: 0.95, real: 1.15, rad: 5.4 },
    { sep: 6.4, ghost: 0.7, real: 1.25, rad: 5.6 },
    { sep: 8.4, ghost: 0.42, real: 1.35, rad: 5.4 },
    { sep: 10.0, ghost: 0.18, real: 1.4, rad: 5.0 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const G = field(S, S);
    memoryGlyph(G, c - k.sep, c, k.rad, k.ghost);
    paint(s, G, bandsAt(P.ECHO_VIOLET, 0.34, 1.2, 0.34, k.ghost, 1.15));
    const R = field(S, S);
    memoryGlyph(R, c + k.sep * 0.45, c, k.rad, k.real);
    if (i >= 4) fDot(R, c + k.sep * 0.45, c, 2.4, k.real * 0.8, 1.6);
    paint(s, R, bands(P.ECHO_CYAN, 0.36, 1.22, 0.24));
    if (i >= 4) s.pxOver(Math.round(c + k.sep * 0.45), Math.round(c), P.ECHO_RUNE);
    return s;
  });
}

/** A ring of agreement that cracks, splits and flies apart. */
function dissentBreakFrames(): Surface[] {
  const S = 32, c = 15.5;
  const keys = [
    { r: 10.0, amp: 1.05, gap: 0, spread: 0, arcs: 1 },
    { r: 10.4, amp: 1.35, gap: 0, spread: 0, arcs: 1 },
    { r: 10.6, amp: 1.30, gap: 26, spread: 0, arcs: 1 },
    { r: 10.8, amp: 1.05, gap: 34, spread: 1.0, arcs: 3 },
    { r: 11.2, amp: 0.72, gap: 46, spread: 2.0, arcs: 3 },
    { r: 11.6, amp: 0.40, gap: 62, spread: 3.0, arcs: 3 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    if (k.arcs === 1) {
      if (k.gap === 0) {
        fRing(F, { cx: c, cy: c, r: k.r, thick: 0.95, amp: k.amp });
      } else {
        fRing(F, { cx: c, cy: c, r: k.r, thick: 0.95, amp: k.amp, a0: -180 + k.gap / 2, a1: 180 - k.gap / 2 });
      }
    } else {
      // three arcs, each pushed outward along its own bisector
      for (let a = 0; a < 3; a++) {
        const mid = -180 + 60 + a * 120;
        const half = 60 - k.gap / 3;
        const push = k.spread;
        const rad = (mid * Math.PI) / 180;
        fRing(F, {
          cx: c + Math.cos(rad) * push, cy: c + Math.sin(rad) * push,
          r: k.r, thick: 0.9 - i * 0.06, amp: k.amp,
          a0: mid - half, a1: mid + half,
        });
      }
    }
    // the four conformers riding the ring
    if (i <= 3) {
      for (let d = 0; d < 4; d++) {
        const a = (-90 + d * 90 + (i >= 2 && d === 0 ? 16 : 0)) * Math.PI / 180;
        fDot(F, c + Math.cos(a) * (k.r + 0.4), c + Math.sin(a) * (k.r + 0.4), 2.1, k.amp * 1.35, 1.1);
      }
    }
    // the crack itself: a bright fracture at the top-right, the moment it gives
    if (i === 2) {
      const a = (-52 * Math.PI) / 180;
      const bx = c + Math.cos(a) * k.r, by = c + Math.sin(a) * k.r;
      fLine(F, bx - 2, by + 2, bx + 3, by - 3, 1.0, 0.2, 1.6, 0.3);
      fLine(F, bx - 1, by - 2, bx + 2, by + 3, 0.8, 0.2, 1.2, 0.2);
    }
    paint(s, F, bandsAt(P.ECHO_VIOLET, 0.32, 1.25, 0.28, k.amp, 1.35));
    if (i === 2) {
      const a = (-52 * Math.PI) / 180;
      s.pxOver(Math.round(c + Math.cos(a) * k.r), Math.round(c + Math.sin(a) * k.r), P.SPECULAR);
    }
    return s;
  });
}

/** Shrine motes: slow violet drifters with a short tail. */
function echoWispFrames(): Surface[] {
  const W = 12, H = 18;
  return Array.from({ length: 6 }, (_, f) => {
    const s = new Surface(W, H);
    const F = field(W, H);
    const t = f / 6;
    const x = 5.5 + Math.sin(t * Math.PI * 2) * 2.0;
    const y = 12.5 - t * 7;
    const amp = 1.05 + 0.35 * Math.sin(t * Math.PI * 2 + 1);
    // a short tail, then the mote itself
    fLine(F, x - Math.sin(t * Math.PI * 2) * 1.6, y + 4.0, x, y, 0.4, 1.2, amp * 0.34, amp * 0.9);
    fDot(F, x, y, 2.6, amp, 1.15);
    paint(s, F, bands(P.ECHO_VIOLET, 0.36, 1.0, 0.3));
    s.pxOver(Math.round(x), Math.round(y), P.ECHO_GLOW);
    return s;
  });
}

/** Boss impact: the Echo hitting something. Violet, asymmetric, violent. */
function echoBurstFrames(): Surface[] {
  const S = 40, c = 19.5;
  const r = rng(9803);
  const angles = spreadAngles(11, r, 0.45);
  const lens = angles.map(() => r.range(0.55, 1.4));
  const keys = [
    { n: 6, inner: 0.5, len: 5.0, w: 1.3, amp: 1.10, core: 3.6, coreAmp: 1.4, ring: 0, rAmp: 0 },
    { n: 11, inner: 1.4, len: 7.0, w: 2.1, amp: 1.55, core: 5.0, coreAmp: 1.95, ring: 9.5, rAmp: 1.45 },
    { n: 10, inner: 4.5, len: 5.5, w: 1.3, amp: 1.10, core: 2.6, coreAmp: 1.0, ring: 13.0, rAmp: 1.10 },
    { n: 8, inner: 8.0, len: 3.6, w: 0.9, amp: 0.78, core: 0, coreAmp: 0, ring: 15.8, rAmp: 0.78 },
    { n: 6, inner: 11.0, len: 2.4, w: 0.7, amp: 0.50, core: 0, coreAmp: 0, ring: 17.6, rAmp: 0.50 },
    { n: 4, inner: 13.5, len: 1.6, w: 0.5, amp: 0.28, core: 0, coreAmp: 0, ring: 0, rAmp: 0 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    if (k.ring > 0) {
      fRing(F, {
        cx: c, cy: c, r: k.ring, squash: 0.88, thick: 1.0, amp: k.rAmp,
        broken: i >= 2 ? 5 : 3, brokenDepth: i >= 2 ? 0.7 : 0.35,
      });
    }
    fNeedles(F, c, c, angles.slice(0, k.n).map((a, j) => ({
      a, len: k.len * lens[j], w: k.w, amp: k.amp * (0.7 + 0.3 * lens[j]),
    })), 1, k.inner);
    if (k.core > 0) fDot(F, c, c, k.core, k.coreAmp, 1.4);
    paint(s, F, bandsAt(P.ECHO_VIOLET, 0.28, 1.15, 0.26, k.amp, 1.55, P.ECHO_GLOW));
    if (i === 1) s.pxOver(19, 20, P.SPECULAR);
    return s;
  });
}

/** A rune waking up: the glyph fills with cyan, then the ring pops off it. */
function runeActivateFrames(): Surface[] {
  const S = 26, c = 12.5;
  // The glyph as strokes, not as a scaled-up bitmap: a stem, two raised arms,
  // a crossbar and a heart. Drawn at 1 px it stays legible at 1x.
  const strokes: Array<[number, number, number, number]> = [
    [0, -7.5, 0, 7.5],
    [0, -3.0, -4.5, -7.5],
    [0, -3.0, 4.5, -7.5],
    [-3.5, 2.0, 3.5, 2.0],
    [-3.5, 2.0, -3.5, 5.0],
    [3.5, 2.0, 3.5, 5.0],
  ];
  const keys = [
    { glyph: 0.42, ring: 0, rAmp: 0, halo: 0.0 },
    { glyph: 0.72, ring: 0, rAmp: 0, halo: 0.22 },
    { glyph: 1.05, ring: 0, rAmp: 0, halo: 0.42 },
    { glyph: 1.40, ring: 5.0, rAmp: 1.25, halo: 0.58 },
    { glyph: 1.15, ring: 8.5, rAmp: 0.88, halo: 0.38 },
    { glyph: 0.85, ring: 11.5, rAmp: 0.52, halo: 0.20 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    if (k.halo > 0) fDot(F, c, c, 8.5, k.halo, 2.4);
    if (k.ring > 0) {
      fRing(F, { cx: c, cy: c, r: k.ring, thick: 0.85, amp: k.rAmp, broken: i >= 5 ? 7 : 0, brokenDepth: 0.5 });
    }
    for (const [x0, y0, x1, y1] of strokes) {
      fLine(F, c + x0, c + y0, c + x1, c + y1, 0.72, 0.72, k.glyph, k.glyph);
    }
    fDot(F, c, c - 1, 1.6, k.glyph * 0.8, 1.4);
    paint(s, F, bandsAt(P.ECHO_CYAN, 0.34, 1.1, 0.26, Math.max(k.glyph, k.rAmp), 1.4, P.ECHO_RUNE));
    return s;
  });
}

/**
 * The concept-unlock bloom. Eight frames, and the only effect in the game that
 * gets to take its time: rays reach out, a ring lifts off, and the sparks
 * settle rather than snapping off. It plays three times in the whole slice.
 */
function insightBurstFrames(): Surface[] {
  const S = 64, c = 31.5;
  const r = rng(9907);
  const rays = spreadAngles(9, r, 0.3).map((a) => ({ a, len: r.range(0.45, 1.0) }));
  const sparks = spreadAngles(9, r, 0.6).map((a) => ({ a, sp: r.range(0.75, 1.25) }));
  // The ring always travels *outside* the ray tips. A ring crossing its own
  // rays draws a wagon wheel, which is the one thing this must not look like.
  const keys = [
    { core: 2.4, coreAmp: 1.35, ray: 0, rayW: 0, ring: 0, rAmp: 0, spark: 0, sparkAmp: 0 },
    { core: 4.2, coreAmp: 1.60, ray: 14, rayW: 1.6, ring: 0, rAmp: 0, spark: 0, sparkAmp: 0 },
    { core: 5.6, coreAmp: 1.78, ray: 26, rayW: 2.0, ring: 0, rAmp: 0, spark: 0, sparkAmp: 0 },
    { core: 4.8, coreAmp: 1.50, ray: 21, rayW: 1.4, ring: 24, rAmp: 1.20, spark: 10, sparkAmp: 0.9 },
    { core: 3.8, coreAmp: 1.20, ray: 15, rayW: 1.0, ring: 29, rAmp: 0.85, spark: 16, sparkAmp: 1.0 },
    { core: 2.8, coreAmp: 0.90, ray: 10, rayW: 0.7, ring: 0, rAmp: 0, spark: 21, sparkAmp: 0.85 },
    { core: 2.0, coreAmp: 0.60, ray: 6, rayW: 0.45, ring: 0, rAmp: 0, spark: 25, sparkAmp: 0.6 },
    { core: 1.3, coreAmp: 0.35, ray: 3, rayW: 0.3, ring: 0, rAmp: 0, spark: 28, sparkAmp: 0.35 },
  ];
  return keys.map((k, i) => {
    const s = new Surface(S, S);
    const F = field(S, S);
    if (k.ring > 0) {
      fRing(F, {
        cx: c, cy: c, r: k.ring, squash: 0.94, thick: 0.9,
        amp: k.rAmp * Math.max(0, Math.min(1, (30.5 - k.ring) / 2.5)),
        broken: i >= 4 ? 9 : 0, brokenDepth: 0.5,
        ampAt: (p) => 0.84 + 0.16 * Math.cos(p * Math.PI * 2 - 0.9),
      });
    }
    if (k.ray > 0) {
      rays.forEach((ray, j) => {
        // alternating long/short rays — an even star reads as a wheel
        const L = k.ray * ray.len * (j % 2 === 0 ? 1 : 0.62);
        const w = k.rayW * (j % 2 === 0 ? 1 : 0.7);
        fLine(F, c, c, c + Math.cos(ray.a) * L, c + Math.sin(ray.a) * L, w, 0.12, k.coreAmp * 0.8, 0.05);
      });
    }
    if (k.spark > 0) {
      sparks.forEach((sp, j) => {
        const d = k.spark * sp.sp;
        // sparks drift down as they go: they settle rather than snap off
        const x = c + Math.cos(sp.a) * d, y = c + Math.sin(sp.a) * d * 0.92 + i * 0.55;
        if (j % 3 === 0) fSparkle(F, x, y, 2.0, k.sparkAmp);
        else fDot(F, x, y, 1.15, k.sparkAmp * 0.95, 1.1);
      });
    }
    if (k.core > 0) fDot(F, c, c, k.core, k.coreAmp, 1.35);
    paint(s, F, bandsAt(P.UI_GOLD, 0.16, 1.3, 0.26, k.coreAmp, 1.7, P.LANTERN[4]));
    if (i >= 1 && i <= 3) {
      s.pxOver(31, 31, P.SPECULAR); s.pxOver(32, 31, P.SPECULAR);
      s.pxOver(31, 32, P.SPECULAR); s.pxOver(32, 32, P.SPECULAR);
    }
    return s;
  });
}

// ── framing: vignette, lights, shadows, bubbles ────────────────────────────

/** Screen vignette. Dithered coverage, never a smooth alpha gradient. */
function vignette(): Surface {
  const W = 480, H = 270;
  const s = new Surface(W, H);
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x - cx) / (W * 0.56);
      const ny = (y - cy) / (H * 0.58);
      const d = Math.sqrt(nx * nx + ny * ny);
      const t = Math.max(0, Math.min(1, (d - 0.68) / 0.56));
      if (t <= 0) continue;
      const cov = Math.pow(t, 1.35);
      // coverage dithering: how many pixels are dark, not how dark each is.
      // It never reaches opaque — a vignette frames the scene, it doesn't
      // black it out.
      if (cov > 0.92) { s.px(x, y, P.OUTLINE, 0.62); continue; }
      const b = bayer(x, y) * 0.75 + bayer(x >> 2, y >> 2) * 0.25;
      if (cov > b) s.px(x, y, P.OUTLINE, cov > 0.6 ? 0.55 : 0.42);
    }
  }
  return s;
}

/** Radial light sprite, drawn white; the runtime tints and adds it. */
function softLight(size: number): Surface {
  const s = new Surface(size, size);
  const F = field(size, size);
  const c = size / 2 - 0.5;
  const rad = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / rad;
      if (d >= 1) continue;
      fMax(F, x, y, Math.pow(1 - d, 2.0));
    }
  }
  // Every step dithers into the next: an undithered falloff bands into visible
  // rings once the runtime tints and adds it.
  return paint(s, F, [
    [0.80, P.LIGHT_RAMP[4], 0.10],
    [0.52, P.LIGHT_RAMP[3], 0.14],
    [0.29, P.LIGHT_RAMP[2], 0.13],
    [0.13, P.LIGHT_RAMP[1], 0.11],
    [0.035, P.LIGHT_RAMP[0], 0.07],
  ]);
}

/** Contact shadow: the thing that stops sprites reading as stickers. */
function contactShadow(w: number, h: number): Surface {
  const s = new Surface(w, h);
  const cx = w / 2 - 0.5, cy = h / 2 - 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - cx) / (w / 2), ny = (y - cy) / (h / 2);
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      if (d > 0.62) {
        // dithered rim so the ellipse doesn't have a hard edge
        if (bayer(x, y) > (1 - d) * 2.4) continue;
        s.px(x, y, P.OUTLINE, 0.26);
      } else {
        s.px(x, y, P.OUTLINE, d > 0.3 ? 0.34 : 0.44);
      }
    }
  }
  return s;
}

/** Rounded speech/emote bubble frame with a tail, drawn once and reused. */
function emoteBubble(): Surface {
  const W = 22, H = 18;
  const s = new Surface(W, H);
  s.ellipse(1, 1, W - 2, H - 6, P.UI_PARCHMENT[3]);
  s.ellipse(2, 2, W - 4, H - 8, P.UI_PARCHMENT[4]);
  // tail
  s.poly([[9, H - 7], [14, H - 7], [9, H - 1]], P.UI_PARCHMENT[3]);
  s.outline(P.OUTLINE, true);
  s.innerShade(P.UI_PARCHMENT[1], 0.55, [[0, 1], [1, 0]]);
  return s;
}

function speechTail(): Surface {
  const s = new Surface(9, 7);
  s.poly([[0, 0], [7, 0], [1, 6]], P.UI_PARCHMENT[4]);
  s.innerShade(P.UI_PARCHMENT[1], 0.6, [[0, 1], [1, 0]]);
  s.outline(P.OUTLINE, true);
  return s;
}

/** Emote glyphs. '#' = outline, 'X' = fill, 'o' = shade, '*' = highlight. */
const EMOTES: Record<string, { rows: string[]; ramp: readonly string[] }> = {
  excl: {
    ramp: P.UI_GOLD,
    rows: [
      '.XX.',
      '.*X.',
      '.*X.',
      '.*X.',
      '.oX.',
      '.oo.',
      '....',
      '.XX.',
      '.oo.',
    ],
  },
  quest: {
    ramp: P.UI_GOLD,
    rows: [
      '.XXX.',
      'X*..X',
      'o...X',
      '...X.',
      '..X..',
      '..o..',
      '.....',
      '..X..',
      '..o..',
    ],
  },
  heart: {
    ramp: P.FLOWER_ROSE,
    rows: [
      '.XX.XX.',
      'X*XXXXX',
      'X*XXXXX',
      '.XXXXX.',
      '..XXX..',
      '...o...',
    ],
  },
  note: {
    ramp: P.WINDOW_AMBER,
    rows: [
      '...XX',
      '...X*',
      '...XX',
      '...X.',
      '...X.',
      'XX.X.',
      'XXXX.',
      'oXo..',
    ],
  },
  sweat: {
    ramp: P.WATER,
    rows: [
      '..X..',
      '..X..',
      '.X*X.',
      'X*XXX',
      'X*XXX',
      '.XXX.',
    ],
  },
  think: {
    ramp: P.UI_PARCHMENT,
    rows: [
      '.........',
      'XX.XX.XX.',
      'oo.oo.oo.',
    ],
  },
  zzz: {
    ramp: P.LINEN,
    rows: [
      '....XXX',
      '.....X.',
      '....X..',
      '....XXX',
      'XXX....',
      '..X....',
      '.X.....',
      'XXX....',
    ],
  },
  idea: {
    ramp: P.LANTERN,
    rows: [
      '..X.X.X..',
      '.........',
      '...XXX...',
      '..X*XXX..',
      '.X*XXXXX.',
      '.X*XXXXX.',
      '..XXXXX..',
      '...XXX...',
      '...ooo...',
      '...ooo...',
    ],
  },
};

function emoteGlyph(name: string): Surface {
  const def = EMOTES[name];
  const w = Math.max(...def.rows.map((r) => r.length));
  const s = new Surface(w + 2, def.rows.length + 2);
  for (let y = 0; y < def.rows.length; y++) {
    for (let x = 0; x < def.rows[y].length; x++) {
      const ch = def.rows[y][x];
      if (ch === '.') continue;
      const c = ch === '*' ? def.ramp[def.ramp.length - 1]
        : ch === 'o' ? def.ramp[1]
          : def.ramp[def.ramp.length - 2];
      s.px(x + 1, y + 1, c);
    }
  }
  s.outline(P.OUTLINE, true);
  return s;
}

// ── registration ───────────────────────────────────────────────────────────

export function registerFx(b: ArtBuild): void {
  for (const d of ['s', 'n', 'e'] as const) {
    b.addStrip(`fx/slash_${d}`, slashFrames(d), {
      key: `fx_slash_${d}`, frameRate: 24, repeat: 0,
    });
  }

  b.addStrip('fx/impact', impactFrames(), { key: 'fx_impact', frameRate: 22, repeat: 0 });
  b.addStrip('fx/crit', critFrames(), { key: 'fx_crit', frameRate: 20, repeat: 0 });
  b.addStrip('fx/dust', dustFrames(5101), { key: 'fx_dust', frameRate: 14, repeat: 0 });
  b.addStrip('fx/land', landFrames(), { key: 'fx_land', frameRate: 18, repeat: 0 });
  b.addStrip('fx/dash_trail', dashTrailFrames(), { key: 'fx_dash_trail', frameRate: 20, repeat: 0 });
  b.addStrip('fx/hurt_flash', hurtFrames(), { key: 'fx_hurt_flash', frameRate: 18, repeat: 0 });
  b.addStrip('fx/block', blockFrames(), { key: 'fx_block', frameRate: 20, repeat: 0 });
  b.addStrip('fx/heart_pickup', heartPickupFrames(), { key: 'fx_heart_pickup', frameRate: 10, repeat: 0 });
  b.addStrip('fx/pickup_sparkle', pickupSparkleFrames(), { key: 'fx_pickup_sparkle', frameRate: 16, repeat: 0 });

  // ── environmental life ───────────────────────────────────────────────────
  b.addStrip('fx/leaf_green', leafFrames(P.TREE_WARM), { key: 'fx_leaf_green', frameRate: 6, repeat: -1 });
  b.addStrip('fx/leaf_gold', leafFrames(P.TREE_AUTUMN), { key: 'fx_leaf_gold', frameRate: 6, repeat: -1 });
  b.addStrip('fx/leaf_red', leafFrames(P.LEAF_RED), { key: 'fx_leaf_red', frameRate: 6, repeat: -1 });
  b.addStrip('fx/pollen', pollenFrames(), { key: 'fx_pollen', frameRate: 5, repeat: -1 });
  b.addStrip('fx/firefly', fireflyFrames(), { key: 'fx_firefly', frameRate: 6, repeat: -1 });
  b.addStrip('fx/smoke', smokeFrames(), { key: 'fx_smoke', frameRate: 6, repeat: 0 });
  b.addStrip('fx/steam', steamFrames(), { key: 'fx_steam', frameRate: 6, repeat: -1 });
  b.addStrip('fx/splash', splashFrames(), { key: 'fx_splash', frameRate: 16, repeat: 0 });
  b.addStrip('fx/ripple', rippleFrames(), { key: 'fx_ripple', frameRate: 8, repeat: 0 });
  b.addStrip('fx/grass_rustle', grassRustleFrames(), { key: 'fx_grass_rustle', frameRate: 12, repeat: 0 });
  b.addStrip('fx/bird_fly', birdFlyFrames(), { key: 'fx_bird_fly', frameRate: 10, repeat: 0 });

  // ── sound made visible ───────────────────────────────────────────────────
  b.addStrip('fx/bell_ring', toneRingFrames(64, 6, P.BELL_TONE, { step: 5.2, spacing: 10.5, squash: 0.9 }), {
    key: 'fx_bell_ring', frameRate: 11, repeat: 0,
  });
  b.addStrip('fx/bell_small', toneRingFrames(40, 5, P.BELL_TONE, { step: 4.0, spacing: 8.0, thick: 0.75, squash: 0.92 }), {
    key: 'fx_bell_small', frameRate: 12, repeat: 0,
  });
  b.addStrip('fx/crash', crashFrames(), { key: 'fx_crash', frameRate: 18, repeat: 0 });
  // Three lantern tones. Each gets its own hue *and* its own ring pattern, so
  // they stay distinguishable for a colourblind player.
  b.addStrip('fx/tone_a', toneRingFrames(32, 5, P.BELL_TONE, { step: 4.2, spacing: 7.5, style: 'plain' }), {
    key: 'fx_tone_a', frameRate: 12, repeat: 0,
  });
  b.addStrip('fx/tone_b', toneRingFrames(32, 5, P.TONE_ROSE, { step: 4.2, spacing: 7.5, style: 'double' }), {
    key: 'fx_tone_b', frameRate: 12, repeat: 0,
  });
  b.addStrip('fx/tone_c', toneRingFrames(32, 5, P.TONE_TEAL, { step: 4.2, spacing: 7.5, style: 'dotted' }), {
    key: 'fx_tone_c', frameRate: 12, repeat: 0,
  });

  // ── the Echo / psychology mechanics ──────────────────────────────────────
  b.addStrip('fx/observe_ping', observePingFrames(), { key: 'fx_observe_ping', frameRate: 14, repeat: 0 });
  b.addStrip('fx/observe_mark', observeMarkFrames(), { key: 'fx_observe_mark', frameRate: 8, repeat: -1 });
  b.addStrip('fx/link_thread', linkThreadFrames(), { key: 'fx_link_thread', frameRate: 8, repeat: -1 });
  b.addStrip('fx/link_node', linkNodeFrames(), { key: 'fx_link_node', frameRate: 8, repeat: -1 });
  b.addStrip('fx/recall_shimmer', recallShimmerFrames(), { key: 'fx_recall_shimmer', frameRate: 9, repeat: 0 });
  b.addStrip('fx/dissent_break', dissentBreakFrames(), { key: 'fx_dissent_break', frameRate: 10, repeat: 0 });
  b.addStrip('fx/echo_wisp', echoWispFrames(), { key: 'fx_echo_wisp', frameRate: 6, repeat: -1 });
  b.addStrip('fx/echo_burst', echoBurstFrames(), { key: 'fx_echo_burst', frameRate: 18, repeat: 0 });
  b.addStrip('fx/rune_activate', runeActivateFrames(), { key: 'fx_rune_activate', frameRate: 10, repeat: 0 });
  b.addStrip('fx/insight_burst', insightBurstFrames(), { key: 'fx_insight_burst', frameRate: 12, repeat: 0 });

  // ── framing ──────────────────────────────────────────────────────────────
  b.add('fx/vignette', vignette());
  b.add('fx/light_soft_64', softLight(64));
  b.add('fx/light_soft_128', softLight(128));
  b.add('fx/light_soft_192', softLight(192));
  b.add('fx/shadow_small', contactShadow(12, 6));
  b.add('fx/shadow_med', contactShadow(18, 8));
  b.add('fx/shadow_large', contactShadow(28, 11));
  b.add('fx/emote_bubble', emoteBubble());
  b.add('fx/speech_tail', speechTail());
  for (const name of Object.keys(EMOTES)) b.add(`fx/emote_${name}`, emoteGlyph(name));
}
