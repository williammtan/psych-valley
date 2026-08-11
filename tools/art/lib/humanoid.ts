/**
 * HUMANOID CHARACTER RIG — every human in Project Psyche is drawn by this file.
 *
 * A character is a `CharSpec` (skin / hair / garment / accessories / build) plus
 * a direction, a pose and a frame index. Everything else — proportions, light,
 * shading, secondary motion — is fixed here so that eleven NPCs authored by
 * eleven different callers still look like one artist drew them.
 *
 * ── Canvas contract ───────────────────────────────────────────────────────
 *   24 wide x 32 tall, figure centred on x=12, feet on the bottom row (y=31).
 *   Landmarks (for heightAdj = 0):
 *     hair     y  1..3     head    y  3..12   (11 x 10 — deliberately large)
 *     neck     y 12..13    torso   y 13..22
 *     legs     y 22..29    boots   y 30..31
 *   The contact shadow lives on rows 29..31 *behind* the figure and is never
 *   part of the outlined silhouette.
 *
 * ── How the drawing works ─────────────────────────────────────────────────
 *   Every body part is first rasterised into a 1-bit *mask* (a Surface full of
 *   white), then `paint()` maps that mask through a 5-step ramp with an
 *   upper-left light: bright at the top-left of the part's own bounding box,
 *   ramp[0] at the bottom-right. Because each part is lit inside its own box,
 *   arms read as cylinders and the coat reads as a cone, without a single
 *   hand-placed shading pixel. Swapping a ramp swaps a garment — nothing is
 *   ever drawn with a literal colour.
 *
 * ── Motion rules (the difference between alive and amateur) ───────────────
 *   * The whole upper body (shoulders, hips, head) carries the bob; the planted
 *     foot does not. Legs therefore stretch and compress on their own.
 *   * Hair masses and garment hems *lag* the body: they are offset by `hairSway`
 *     / `hem` which peak one frame after the body does.
 *   * Arms counter-swing the legs, always.
 *   * A face only exists facing south and east. North is the back of the head.
 *
 * 'w' is not generated: the runtime plays the 'e' animation with flipX.
 */
import { Surface } from './pixel.js';
import * as P from './palette.js';
import type { Ramp } from './palette.js';

// ── Public types ───────────────────────────────────────────────────────────

export type Dir = 's' | 'n' | 'e';
export type Pose =
  | 'idle' | 'walk' | 'talk' | 'surprised' | 'happy' | 'attack' | 'sit' | 'carry' | 'dash';
export type HairStyle =
  | 'short' | 'messy' | 'bun' | 'long' | 'ponytail' | 'braid' | 'curly' | 'wild' | 'bald' | 'cropped';
export type Outfit = 'coat' | 'dress' | 'apron' | 'tunic' | 'vest' | 'robe' | 'jacket' | 'overalls';
export type Accessory =
  | 'notebook' | 'satchel' | 'scarf' | 'wide_hat' | 'cap' | 'goggles'
  | 'flower' | 'bag' | 'basket' | 'sash' | 'glasses' | 'none';
export type Build = 'slim' | 'normal' | 'stout';

export interface CharSpec {
  skin: keyof typeof P.SKIN | Ramp;
  hair: keyof typeof P.HAIR | Ramp;
  hairStyle: HairStyle;
  /** Primary garment ramp. */
  cloth: keyof typeof P.CLOTH | Ramp;
  /** Secondary ramp: trousers, apron, trim, hat. Defaults to a darker `cloth`. */
  cloth2?: keyof typeof P.CLOTH | Ramp;
  outfit: Outfit;
  /** One accessory, or several (Sera carries a notebook *and* a satchel). */
  accessory?: Accessory | Accessory[];
  build?: Build;
  /** -2..+2 px. Positive = taller (torso and legs both lengthen). */
  heightAdj?: number;
  /** Put a blade in the leading hand on `attack` frames. Player only. */
  weapon?: boolean;
}

/** Frame count per pose. Walk is a true 6-frame cycle; idle breathes over 4. */
export const POSE_FRAMES: Record<Pose, number> = {
  idle: 4, walk: 6, talk: 2, surprised: 2, happy: 4, attack: 4, sit: 2, carry: 4, dash: 2,
};

/** House playback rates. Walk at 10fps is the reference the whole game moves at. */
export const POSE_FPS: Record<Pose, number> = {
  idle: 3.5, walk: 10, talk: 4, surprised: 5, happy: 7, attack: 12, sit: 2, carry: 5, dash: 14,
};

/** Poses that play once and hold (the runtime returns to idle afterwards). */
export const POSE_ONCE: Partial<Record<Pose, boolean>> = { attack: true, surprised: true, dash: true };

// ── Canvas + small maths helpers ───────────────────────────────────────────

export const CW = 24;
export const CH = 32;
const CX = 12;
const GROUND = 31;
const MASK = '#ffffff';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function pickRamp(v: string | Ramp, table: Record<string, Ramp>): Ramp {
  if (typeof v !== 'string') return v;
  return table[v] ?? table[Object.keys(table)[0]];
}

/** Slide a ramp darker (n<0) or lighter (n>0) — used for far limbs and trim. */
function shift(r: Ramp, n: number): Ramp {
  return r.map((_, i) => r[clamp(i + n, 0, r.length - 1)]);
}

// ── Mask primitives ────────────────────────────────────────────────────────

function mask(draw: (m: Surface) => void): Surface {
  const m = new Surface(CW, CH);
  draw(m);
  return m;
}

/**
 * Tapered limb. Steps along the dominant axis one pixel at a time and stamps a
 * perpendicular run, so there are never diagonal holes and the width can breathe
 * from shoulder to wrist.
 */
function limb(m: Surface, x0: number, y0: number, x1: number, y1: number, w0: number, w1 = w0): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const vertical = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = Math.round(lerp(x0, x1, t));
    const y = Math.round(lerp(y0, y1, t));
    const w = Math.max(1, Math.round(lerp(w0, w1, t)));
    const half = (w - 1) >> 1;
    for (let k = 0; k < w; k++) {
      if (vertical) m.px(x - half + k, y, MASK);
      else m.px(x, y - half + k, MASK);
    }
  }
}

/**
 * Vertical body mass between two rows. `pow` bends the width curve: 1 is a
 * straight trapezoid, >1 keeps the shape narrow then flares late (skirts,
 * coat-tails), which is what stops garments looking like traffic cones.
 */
function taper(
  m: Surface, yTop: number, yBot: number,
  cxTop: number, halfTop: number, cxBot: number, halfBot: number, pow = 1,
): void {
  for (let y = Math.round(yTop); y <= Math.round(yBot); y++) {
    const t = yBot === yTop ? 0 : (y - yTop) / (yBot - yTop);
    const c = lerp(cxTop, cxBot, t);
    const h = lerp(halfTop, halfBot, Math.pow(clamp(t, 0, 1), pow));
    for (let x = Math.round(c - h); x <= Math.round(c + h); x++) m.px(x, y, MASK);
  }
}

/**
 * Ramp a mask with an upper-left key light, inside the mask's own bounding box
 * (or an explicit `box` when several parts must share one lighting solution).
 */
function paint(
  dst: Surface, m: Surface, r: Ramp,
  o: { kx?: number; ky?: number; bias?: number; box?: { x: number; y: number; w: number; h: number } } = {},
): void {
  const b = o.box ?? m.bounds();
  if (!b.w || !b.h) return;
  const kx = o.kx ?? 0.52;
  const ky = o.ky ?? 0.30;
  const bias = o.bias ?? 0;
  const dw = Math.max(1, b.w - 1);
  const dh = Math.max(1, b.h - 1);
  const last = r.length - 1;
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (m.alphaAt(x, y) === 0) continue;
      const nx = (x - b.x) / dw;
      const ny = (y - b.y) / dh;
      const t = 0.5 + kx * (0.5 - nx) + ky * (0.5 - ny) + bias;
      dst.px(x, y, r[clamp(Math.round(t * last), 0, last)]);
    }
  }
}

/** 1px darker lip down one side of a just-painted part — reads as a seam. */
function rim(dst: Surface, m: Surface, side: 'l' | 'r', color: string, alpha = 1): void {
  for (let y = 0; y < CH; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < CW; x++) {
      if (m.alphaAt(x, y) === 0) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    dst.pxOver(side === 'l' ? first : last, y, color, alpha);
  }
}

// ── Skeleton ───────────────────────────────────────────────────────────────

interface Geom {
  hx: number; hy: number;              // head box top-left (11 x 10)
  neckY: number; shoulderY: number; waistY: number; hipY: number; footY: number;
  sh: number; wh: number;              // shoulder / waist half-width
  armW: number; legW: number;
  shA: number; shB: number;            // shoulder x  (A = screen-left / far)
  handA: number; handB: number;        // resting hand x
  handY: number;
  hipA: number; hipB: number;
  footA: number; footB: number;
}

const HEAD_W = 11;
const HEAD_H = 10;
/** Per-row [x0,x1] of the head, offset from the head box. Rounded skull, tapered jaw. */
const HEAD_ROWS: ReadonlyArray<readonly [number, number]> = [
  [3, 7], [1, 9], [0, 10], [0, 10], [0, 10], [0, 10], [1, 9], [1, 9], [2, 8], [3, 7],
];

function geom(spec: CharSpec, dir: Dir): Geom {
  const build = spec.build ?? 'normal';
  const rise = clamp(spec.heightAdj ?? 0, -2, 2);
  const east = dir === 'e';
  const sh = (build === 'slim' ? 4 : build === 'stout' ? 6 : 5) - (east ? 1 : 0);
  const wh = (build === 'slim' ? 3 : build === 'stout' ? 5 : 4) - (east ? 1 : 0);
  return {
    hx: CX - 5 + (east ? 1 : 0),      // the head leads slightly in profile
    hy: 3 - rise,
    neckY: 11 - rise,
    shoulderY: 14 - rise,
    waistY: 20 - rise,
    hipY: 21 - rise,
    footY: GROUND - 1,
    sh, wh,
    armW: build === 'slim' ? 2 : 3,
    legW: build === 'stout' ? 4 : 3,
    shA: east ? CX - 2 : CX - sh,
    shB: east ? CX + 1 : CX + sh,
    handA: east ? CX - 4 : CX - sh - 1,
    handB: east ? CX + 2 : CX + sh + 1,
    handY: 24 - Math.round(rise / 2),
    hipA: east ? CX - 1 : CX - 2,
    hipB: east ? CX + 1 : CX + 2,
    footA: east ? CX - 3 : CX - 2,
    footB: east ? CX + 1 : CX + 2,
  };
}

// ── Expression + kinematics ────────────────────────────────────────────────

interface Expr {
  eyes: 'open' | 'blink' | 'wide' | 'happy' | 'squint';
  mouth: 'small' | 'open' | 'smile' | 'grit' | 'o';
  brow: 'flat' | 'up' | 'down';
}

interface V { x: number; y: number }
const v = (x = 0, y = 0): V => ({ x, y });

interface Kin {
  bob: number;        // upper body vertical offset (negative = up)
  lean: number;       // shoulders/head horizontal shift
  crouch: number;     // shortens the torso from the top (dash, sit)
  headX: number; headY: number;
  handA: V; handB: V; // offsets from the resting hand position
  footA: V; footB: V; // offsets from the resting foot position
  elbowA: number; elbowB: number; // how far the elbows bow outwards
  hem: number; hemLift: number;
  hairSway: number; hairLift: number;
  shrug: number;
  shadow: number;     // contact-shadow scale
  sit: boolean;
  expr: Expr;
  /** Absolute canvas positions that override the resting hands (attack poses). */
  absA?: V; absB?: V;
  /** Absolute canvas position of the blade tip; the hilt sits in hand B. */
  weaponTip?: V;
}

function baseKin(): Kin {
  return {
    bob: 0, lean: 0, crouch: 0, headX: 0, headY: 0,
    handA: v(), handB: v(), footA: v(), footB: v(),
    elbowA: -1, elbowB: 1,
    hem: 0, hemLift: 0, hairSway: 0, hairLift: 0, shrug: 0, shadow: 1, sit: false,
    expr: { eyes: 'open', mouth: 'small', brow: 'flat' },
  };
}

/**
 * Walk cycle, one half at a time: contact → down → pass.
 * `lead` is +1 while leg B (screen-right / near) is the leading leg.
 * The east table swings along the travel axis; the flat table compresses that
 * swing into a splay + a lift, which is how a front-on walk reads.
 */
const WALK_EAST: ReadonlyArray<readonly [number, number, number, number, number]> = [
  //  leadDX leadDY  trailDX trailDY  bob
  [4, 0, -4, 0, 0],
  [2, 0, -3, -1, 1],
  [0, 0, 0, -3, -1],
];
// Facing the camera the stride cannot be read along x, so it becomes a splay
// (positive = away from the centre line) plus a lift on the swinging leg.
const WALK_FLAT: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [3, 0, -1, 0, 0],
  [2, 0, -1, -2, 1],
  [0, 0, -1, -3, -1],
];

function kinematics(dir: Dir, pose: Pose, f: number, spec: CharSpec): Kin {
  const k = baseKin();
  const east = dir === 'e';

  switch (pose) {
    case 'idle': {
      // Breathing: chest and head rise for two frames of four. The blink is
      // parked on the frame after the peak so it never syncs with the bob.
      const up = f === 1 || f === 2 ? -1 : 0;
      k.bob = up;
      k.hairLift = f === 2 ? -1 : 0;
      k.hemLift = up;
      k.handA.y = up === 0 ? 0 : 1;
      k.handB.y = k.handA.y;
      if (f === 3) k.expr.eyes = 'blink';
      break;
    }

    case 'walk': {
      const half = f % 3;
      const lead = f < 3 ? 1 : -1;
      const row = east ? WALK_EAST[half] : WALK_FLAT[half];
      const [ldx, ldy, tdx, tdy, bob] = row;
      k.bob = bob;
      const A = lead === 1 ? v(tdx, tdy) : v(ldx, ldy);
      const B = lead === 1 ? v(ldx, ldy) : v(tdx, tdy);
      if (!east) { A.x = -A.x; }          // mirror the splay on the screen-left leg
      k.footA = A;
      k.footB = B;

      // Arms counter-swing the legs. amp peaks at contact, crosses at pass.
      const amp = [1, 0.6, 0][half];
      const sB = -lead, sA = lead;        // +1 = that arm is swinging forward
      if (east) {
        k.handB.x = Math.round(3 * amp * sB);
        k.handA.x = Math.round(3 * amp * sA);
        k.handB.y = sB > 0 ? -Math.round(amp) : 0;
        k.handA.y = sA > 0 ? -Math.round(amp) : 0;
      } else {
        // Front-on the swing shows as the hand crossing in toward the hip and
        // lifting; the trailing hand drifts out and drops.
        k.handB.x = -Math.round(amp * sB);
        k.handB.y = -Math.round(2 * amp * sB);
        k.handA.x = Math.round(amp * sA);
        k.handA.y = -Math.round(2 * amp * sA);
      }

      // Secondary motion. Cloth and hair trail the body by roughly a frame.
      if (east) {
        k.hem = half === 2 ? -2 : -1;
        k.hairSway = -1;
        k.hairLift = half === 2 ? -1 : 0;
      } else {
        k.hem = half === 2 ? 0 : lead;
        k.hairSway = half === 0 ? lead : 0;
        k.hairLift = half === 2 ? -1 : 0;
      }
      k.hemLift = half === 2 ? -1 : 0;
      k.lean = east ? 1 : 0;
      break;
    }

    case 'talk': {
      // Two frames: mouth shut / mouth open with a small nod and a hand up.
      // The gesturing hand has to clear the torso or the whole beat is invisible.
      if (f === 1) {
        k.headY = -1;
        k.headX = east ? 1 : 0;
        k.expr.mouth = 'open';
        k.handB = east ? v(4, -7) : v(2, -7);
        k.elbowB = 3;
        k.hairLift = -1;
        k.hairSway = east ? 1 : 1;
      } else {
        k.expr.mouth = 'small';
        k.handB = east ? v(2, -3) : v(1, -3);
        k.elbowB = 2;
      }
      break;
    }

    case 'surprised': {
      // Recoil: body pulls up and back, shoulders climb, both hands come up.
      const hard = f === 0;
      k.bob = hard ? -1 : 0;
      k.lean = east ? (hard ? -2 : -1) : 0;
      k.headY = hard ? -1 : 0;
      k.shrug = 1;
      // Hands snap up beside the face — elbows stay out so the arms read as
      // bent, not as a scarecrow crossbar.
      k.handA = v(east ? 2 : 3, hard ? -11 : -9);
      k.handB = v(east ? 4 : -3, hard ? -11 : -9);
      k.elbowA = -2; k.elbowB = 2;
      k.footA = v(east ? -1 : -1, 0);
      k.footB = v(east ? -1 : 1, 0);
      k.hairLift = hard ? -2 : -1;
      k.hairSway = east ? -1 : 1;
      k.hem = east ? -1 : 0;
      k.hemLift = hard ? -1 : 0;
      k.expr = { eyes: 'wide', mouth: 'o', brow: 'up' };
      break;
    }

    case 'happy': {
      // A little hop with a head tilt. The shadow shrinks when the feet leave
      // the ground — without that the hop reads as a glitch instead of a jump.
      const bobs = [0, -2, 0, -1];
      const tilts = [0, -1, -1, 1];
      k.bob = bobs[f];
      k.headX = tilts[f];
      k.shadow = f === 1 ? 0.76 : f === 3 ? 0.88 : 1;
      const air = f === 1 ? -1 : 0;
      k.footA = v(0, air);
      k.footB = v(0, air);
      k.handA = v(east ? 1 : -2, -4 + (f === 1 ? -2 : 0));
      k.handB = v(east ? 3 : 2, -4 + (f === 1 ? -2 : 0));
      k.elbowA = -2; k.elbowB = 2;
      k.hairLift = f === 1 ? -2 : f === 3 ? -1 : 0;
      k.hairSway = tilts[f];
      k.hemLift = f === 1 ? -2 : 0;
      k.hem = -tilts[f];
      k.expr = { eyes: 'happy', mouth: 'smile', brow: 'flat' };
      break;
    }

    case 'attack': {
      // anticipation -> strike -> follow-through -> recover.
      // Hands are absolute here: a swing has to be composed against the canvas,
      // not nudged off a resting pose, or the strike never clears the body.
      k.expr = { eyes: 'squint', mouth: 'grit', brow: 'down' };
      if (east) {
        // A forward thrust-slash. The blade leaves the silhouette entirely on
        // frame 1, which is what makes the hit read at 1x.
        k.lean = [-2, 3, 2, 0][f];
        k.headX = [-1, 2, 1, 0][f];
        k.bob = [0, 0, 1, 0][f];
        k.crouch = [1, 0, 0, 0][f];
        k.absB = [v(8, 15), v(17, 15), v(17, 21), v(14, 23)][f];
        k.absA = [v(7, 22), v(12, 21), v(11, 23), v(9, 24)][f];
        k.weaponTip = [v(1, 9), v(23, 25), v(21, 31), v(19, 29)][f];
        k.footB = [v(-1, 0), v(4, 0), v(4, 0), v(1, 0)][f];
        k.footA = [v(-3, 0), v(-3, 0), v(-3, 0), v(-1, 0)][f];
        k.hem = [-2, 2, 2, 0][f];
        k.hairSway = [-1, 1, 1, 0][f];
        k.hairLift = f === 1 ? -1 : 0;
      } else if (dir === 's') {
        // Overhead chop toward the camera: the blade ends up vertical, in front
        // of the body and below the hands, so nothing is hidden by the torso.
        k.lean = [1, 0, -1, 0][f];
        k.headX = [1, 0, -1, 0][f];
        k.bob = [-1, 1, 1, 0][f];
        k.absB = [v(18, 14), v(17, 18), v(9, 22), v(10, 22)][f];
        k.absA = [v(9, 17), v(9, 21), v(7, 23), v(7, 23)][f];
        k.weaponTip = [v(23, 4), v(23, 28), v(1, 29), v(3, 26)][f];
        k.footB = [v(1, 0), v(3, 0), v(3, 0), v(1, 0)][f];
        k.footA = [v(1, 0), v(3, 0), v(3, 0), v(1, 0)][f];
        k.hem = [1, -1, -2, 0][f];
        k.hairSway = [1, -1, -1, 0][f];
        k.hairLift = f === 0 ? -1 : 0;
      } else {
        // Facing away: the swing rises across the shoulders, so the blade is
        // read against the sky rather than against the character's own back.
        k.lean = [-1, 1, 2, 0][f];
        k.headX = [-1, 1, 1, 0][f];
        k.bob = [0, -1, 0, 0][f];
        k.absB = [v(7, 21), v(15, 14), v(18, 17), v(16, 21)][f];
        k.absA = [v(6, 23), v(9, 22), v(9, 23), v(8, 24)][f];
        k.weaponTip = [v(1, 26), v(21, 2), v(23, 11), v(22, 17)][f];
        k.footB = [v(1, 0), v(2, 0), v(2, 0), v(1, 0)][f];
        k.footA = [v(-1, 0), v(-2, 0), v(-2, 0), v(-1, 0)][f];
        k.hem = [-1, 1, 2, 0][f];
        k.hairSway = [-1, 1, 1, 0][f];
        k.hairLift = f === 1 ? -2 : 0;
      }
      break;
    }

    case 'sit': {
      // Knees splay outwards (or forwards, in profile) — a front-on sit that
      // keeps the legs vertical just reads as a short person standing.
      k.sit = true;
      k.bob = 4 + (f === 1 ? -1 : 0);
      k.footA = v(east ? 3 : -3, 0);
      k.footB = v(east ? 5 : 3, 0);
      k.handA = v(east ? 2 : -2, -1);
      k.handB = v(east ? 3 : 2, -1);
      k.elbowA = -2; k.elbowB = 2;
      k.hairLift = f === 1 ? -1 : 0;
      k.shadow = 0.85;
      break;
    }

    case 'carry': {
      const bobs = [0, -1, 0, 0];
      k.bob = bobs[f];
      k.handA = east ? v(4, -6) : v(2, -6);
      k.handB = east ? v(4, -6) : v(-2, -6);
      k.elbowA = east ? 0 : -2;
      k.elbowB = east ? 0 : 2;
      k.hairLift = f === 1 ? -1 : 0;
      k.hemLift = f === 1 ? -1 : 0;
      break;
    }

    case 'dash': {
      // Handled by drawRoll(); only the face and shadow come from here.
      k.shadow = 0.8;
      k.expr = { eyes: 'squint', mouth: 'grit', brow: 'down' };
      break;
    }
  }

  // A carried object forces the hands up and in whatever the pose says.
  const acc = accessoriesOf(spec);
  if (acc.includes('notebook') && (pose === 'idle' || pose === 'walk' || pose === 'talk')) {
    k.handB.x += east ? 1 : -1;
    k.handB.y -= 5;
    k.elbowB = east ? 1 : 2;
  }
  if (acc.includes('basket') && pose !== 'attack' && pose !== 'dash') {
    k.handA.x += east ? 3 : 2;
    k.handB.x += east ? 3 : -2;
    k.handA.y -= 5;
    k.handB.y -= 5;
  }
  return k;
}

function accessoriesOf(spec: CharSpec): Accessory[] {
  if (!spec.accessory) return [];
  return (Array.isArray(spec.accessory) ? spec.accessory : [spec.accessory]).filter((a) => a !== 'none');
}

// ── Parts ──────────────────────────────────────────────────────────────────

function drawLeg(
  b: Surface, hipX: number, hipY: number, footX: number, footY: number,
  w: number, cloth: Ramp, boot: Ramp, dir: Dir, sit: boolean,
): void {
  const kneeY = sit ? hipY + 1 : Math.round(lerp(hipY, footY, 0.55));
  const kneeX = sit ? Math.round(footX + (footX - hipX) * 0.2) : Math.round(lerp(hipX, footX, 0.45));
  const leg = mask((m) => {
    limb(m, hipX, hipY, kneeX, kneeY, w + 1, w);
    limb(m, kneeX, kneeY, footX, footY - 1, w, w);
  });
  paint(b, leg, cloth, { kx: 0.7, ky: 0.15 });

  // Boot: three rows (cuff + foot) so it reads as footwear and not a stub.
  // Facing east it grows a toe forward.
  const east = dir === 'e';
  const shoe = mask((m) => {
    m.rect(footX - 1, footY - 1, 3, 3, MASK);
    if (east) { m.px(footX + 2, footY, MASK); m.px(footX + 2, footY + 1, MASK); }
  });
  paint(b, shoe, boot, { kx: 0.45, ky: 0.45 });
  b.pxOver(footX - 1, footY - 1, boot[4], 0.7);
}

function drawArm(
  b: Surface, shX: number, shY: number, handX: number, handY: number,
  w: number, sleeve: Ramp, skin: Ramp, elbowOut: number,
  opts: { seam?: 'l' | 'r'; longSleeve?: boolean } = {},
): void {
  const ex = Math.round(lerp(shX, handX, 0.5)) + elbowOut;
  const ey = Math.round(lerp(shY, handY, 0.52));
  const arm = mask((m) => {
    limb(m, shX, shY, ex, ey, w + 1, w);
    limb(m, ex, ey, handX, handY, w, w);
  });
  // Slightly darker than the torso: an arm is a separate cylinder in front of
  // the body, and without that step the two masses fuse at 1x.
  paint(b, arm, sleeve, { kx: 0.75, ky: 0.12, bias: -0.1 });
  // Seam: without a hard lip the arm dissolves into a same-coloured torso.
  if (opts.seam) rim(b, arm, opts.seam, P.OUTLINE, 0.55);
  if (!opts.longSleeve) {
    const hand = mask((m) => { m.ellipse(handX - 1, handY - 1, 3, 3, MASK); });
    paint(b, hand, skin, { kx: 0.5, ky: 0.4 });
  } else {
    const cuff = mask((m) => { m.ellipse(handX - 1, handY - 1, 3, 3, MASK); });
    paint(b, cuff, shift(sleeve, -1), { kx: 0.5, ky: 0.4 });
  }
}

function headMask(hx: number, hy: number): Surface {
  return mask((m) => {
    for (let j = 0; j < HEAD_H; j++) {
      const [x0, x1] = HEAD_ROWS[j];
      for (let x = x0; x <= x1; x++) m.px(hx + x, hy + j, MASK);
    }
  });
}

function drawEye(b: Surface, x: number, y: number, e: Expr, skin: Ramp, hair: Ramp): void {
  switch (e.eyes) {
    case 'blink':
      b.px(x, y + 1, P.OUTLINE);
      b.pxOver(x, y, skin[3]);
      break;
    case 'wide':
      b.rect(x - 1, y - 1, 2, 3, P.OUTLINE);
      b.px(x - 1, y - 1, skin[4]);
      break;
    case 'happy':
      b.px(x - 1, y + 1, P.OUTLINE);
      b.px(x, y, P.OUTLINE);
      b.px(x + 1, y + 1, P.OUTLINE);
      break;
    case 'squint':
      b.px(x, y + 1, P.OUTLINE);
      b.px(x - 1, y + 1, P.OUTLINE);
      break;
    default:
      b.px(x, y, P.OUTLINE);
      b.px(x, y + 1, P.OUTLINE);
      break;
  }
  if (e.brow === 'up') { b.pxOver(x - 1, y - 2, hair[1]); b.pxOver(x, y - 2, hair[1]); }
  if (e.brow === 'down') { b.pxOver(x, y - 1, hair[1]); }
}

function drawMouth(b: Surface, x: number, y: number, e: Expr, skin: Ramp): void {
  const dark = shift(skin, -3)[0];
  switch (e.mouth) {
    case 'open':
      b.pxOver(x - 1, y, dark); b.pxOver(x, y, dark); b.pxOver(x + 1, y, dark);
      b.pxOver(x, y + 1, dark);
      break;
    case 'o':
      b.pxOver(x, y, dark); b.pxOver(x + 1, y, dark);
      b.pxOver(x, y + 1, dark); b.pxOver(x + 1, y + 1, dark);
      break;
    case 'smile':
      b.pxOver(x - 1, y, dark); b.pxOver(x, y + 1, dark); b.pxOver(x + 1, y, dark);
      break;
    case 'grit':
      b.pxOver(x - 1, y, dark); b.pxOver(x, y, dark); b.pxOver(x + 1, y, dark);
      break;
    default:
      b.pxOver(x, y, dark); b.pxOver(x + 1, y, dark);
      break;
  }
}

function drawFace(b: Surface, dir: Dir, hx: number, hy: number, skin: Ramp, hair: Ramp, e: Expr): void {
  if (dir === 'n') return;                       // the back of a head has no face
  const eyeY = hy + 5;
  if (dir === 's') {
    drawEye(b, hx + 3, eyeY, e, skin, hair);
    drawEye(b, hx + 7, eyeY, e, skin, hair);
    b.pxOver(hx + 5, hy + 7, shift(skin, -1)[1]);   // nose shadow
    drawMouth(b, hx + 4, hy + 8, e, skin);
    b.pxOver(hx + 1, hy + 6, skin[1]);              // ears
    b.pxOver(hx + 9, hy + 6, skin[1]);
  } else {
    drawEye(b, hx + 7, eyeY, e, skin, hair);
    // Nose bump: pushed one pixel past the silhouette so the profile reads.
    b.px(hx + 11, eyeY + 1, skin[2]);
    b.pxOver(hx + 10, eyeY + 2, shift(skin, -1)[2]);
    drawMouth(b, hx + 8, hy + 8, e, skin);
    b.pxOver(hx + 3, hy + 6, skin[1]);              // ear
    b.pxOver(hx + 3, hy + 7, shift(skin, -1)[1]);
  }
}

/**
 * Hair. The cap is the head silhouette dilated by one pixel and then cut along
 * a per-column fringe line, so every style inherits a correct skull shape and
 * only differs where it should: the fringe and the loose masses.
 */
function drawHair(
  b: Surface, spec: CharSpec, dir: Dir, g: Geom,
  hx: number, hy: number, k: Kin, hair: Ramp,
): void {
  if (spec.hairStyle === 'bald') {
    // Not nothing: a thin rim above the ears keeps a bald head from reading as
    // an egg, and the crown gets a highlight.
    b.pxOver(hx + 1, hy + 5, hair[1]);
    b.pxOver(hx + 9, hy + 5, hair[1]);
    if (dir !== 'n') b.pxOver(hx + 2, hy + 1, shift(hair, 2)[4]);
    return;
  }
  const style = spec.hairStyle;
  const sway = k.hairSway;
  const lift = k.hairLift;
  const cap = headMask(hx, hy).outline(MASK);   // dilate by 1 = hair volume

  const fringeAt = (x: number): number => {
    const c = x - hx;
    let y: number;
    if (dir === 'n') y = hy + 8;
    else if (dir === 'e') y = c <= 3 ? hy + 7 : c <= 5 ? hy + 5 : hy + 3;
    else y = hy + 3;
    if (c <= 0 || c >= 10) y += 3;                     // hair frames the face
    else if (c <= 1 || c >= 9) y += 1;
    if (style === 'cropped') y -= 1;
    if (style === 'messy') y += ((c * 5) % 3 === 0 ? 1 : 0);
    if (style === 'curly') y += (c % 2 === 0 ? 1 : 0);
    if (style === 'long' || style === 'braid') y += 1;
    return y;
  };

  const m = new Surface(CW, CH);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (cap.alphaAt(x, y) === 0) continue;
      if (y <= fringeAt(x)) m.px(x, y, MASK);
    }
  }
  if (style === 'cropped') {
    // shave the volume back down onto the skull
    const skull = headMask(hx, hy);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      if (m.alphaAt(x, y) && skull.alphaAt(x, y) === 0 && y > hy) m.px(x, y, '#00000000');
    }
  }

  const shoulder = g.shoulderY + k.bob;
  switch (style) {
    case 'long': {
      if (dir === 'n') {
        taper(m, hy + 2, shoulder + 6 + lift, CX, 5.5, CX + sway, 5, 1.1);
      } else {
        limb(m, hx, hy + 3, hx - 1 + sway, shoulder + 4 + lift, 4, 3);
        limb(m, hx + 10, hy + 3, hx + 11 + sway, shoulder + 4 + lift, 4, 3);
      }
      break;
    }
    case 'ponytail': {
      if (dir === 'n') limb(m, CX, hy + 6, CX + sway, hy + 16 + lift, 4, 2);
      else if (dir === 'e') limb(m, hx + 1, hy + 3, hx - 3 + sway, hy + 10 + lift, 4, 2);
      else limb(m, hx + 9, hy + 3, hx + 12 + sway, hy + 10 + lift, 4, 2);
      break;
    }
    case 'braid': {
      const bx = dir === 'n' ? CX : dir === 'e' ? hx - 1 : hx + 11;
      for (let i = 0; i < 3; i++) {
        const yy = hy + 5 + i * 3 + (i === 2 ? lift : 0);
        const xx = bx + Math.round((sway * i) / 2) + (dir === 'e' ? -i : dir === 's' ? i : 0);
        m.ellipse(xx - 1, yy, 4 - (i === 2 ? 1 : 0), 4, MASK);
      }
      break;
    }
    case 'bun': {
      if (dir === 'n') m.ellipse(CX - 3, hy + 1, 7, 6, MASK);
      else if (dir === 'e') m.ellipse(hx - 2, hy + 0, 6, 6, MASK);
      else m.ellipse(CX - 2 + sway, hy - 3 + lift, 6, 5, MASK);
      break;
    }
    case 'wild': {
      for (let i = 0; i < 6; i++) {
        const sx = hx + 1 + i * 2;
        const h = 2 + ((i * 3) % 3);
        limb(m, sx, hy + 1, sx + (i % 2 ? 1 : -1) + sway, hy - h + lift, 2, 1);
      }
      break;
    }
    case 'curly': {
      for (let i = 0; i < 7; i++) {
        const a = (i / 6) * Math.PI;
        const cx2 = Math.round(hx + 5 - Math.cos(a) * 6.2);
        const cy2 = Math.round(hy + 4 - Math.sin(a) * 5.4) + (i === 3 ? lift : 0);
        m.ellipse(cx2 - 1, cy2 - 1, 3, 3, MASK);
      }
      break;
    }
    case 'messy': {
      limb(m, hx + 2, hy + 1, hx - 1 + sway, hy - 2 + lift, 2, 1);
      limb(m, hx + 6, hy, hx + 8 + sway, hy - 3 + lift, 2, 1);
      limb(m, hx + 9, hy + 2, hx + 12 + sway, hy + lift, 2, 1);
      break;
    }
    default:
      break;
  }

  paint(b, m, hair, { kx: 0.62, ky: 0.5 });
  // Crisp the fringe: the lower edge of every hair mass goes one step down the
  // ramp. This is what stops hair reading as a painted-on helmet.
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (m.alphaAt(x, y) === 0 || m.alphaAt(x, y + 1) !== 0) continue;
      b.pxOver(x, y, hair[0], 0.85);
    }
  }
  // One strand of parting so the mass has internal structure at 1x.
  if (dir === 'n') {
    b.pxOver(hx + 5, hy + 1, hair[1]);
    b.pxOver(hx + 5, hy + 2, hair[1]);
    b.pxOver(hx + 6, hy + 3, hair[1]);
  } else {
    b.pxOver(hx + 7, hy + 1, hair[4], 0.5);
    b.pxOver(hx + 6, hy, hair[4], 0.5);
  }
}

interface Outfitting { sleeve: Ramp; legs: Ramp; longSleeve: boolean; hemY: number }

/**
 * Garments. Each outfit changes the silhouette, not just the colour: the coat
 * and robe fall past the knee, the dress flares late, the vest and overalls
 * leave the shirt showing on the arms.
 */
function drawGarment(
  b: Surface, spec: CharSpec, dir: Dir, g: Geom, k: Kin, c1: Ramp, c2: Ramp,
): Outfitting {
  const bob = k.bob;
  const top = g.shoulderY - 1 + bob + k.crouch;
  const waist = g.waistY + bob;
  const hip = g.hipY + bob;
  const lean = k.lean;
  const hemX = CX + k.hem;
  const outfit = spec.outfit;

  let sleeve = c1;
  let legs = c2;
  let longSleeve = false;
  let hemY = hip + 2;
  let hemHalf = g.wh + 1.5;
  let pow = 1.3;
  let bodyRamp = c1;

  switch (outfit) {
    case 'coat': hemY = hip + 6; hemHalf = g.sh + 1; pow = 1.4; break;
    case 'robe': hemY = 29; hemHalf = g.sh + 1.5; pow = 1.3; longSleeve = true; break;
    case 'dress': hemY = hip + 6; hemHalf = g.sh + 1.5; pow = 2.1; break;
    case 'jacket': hemY = hip + 1; hemHalf = g.wh + 0.5; break;
    case 'vest': bodyRamp = c2; sleeve = c2; hemY = hip + 1; hemHalf = g.wh; break;
    case 'overalls': bodyRamp = c2; sleeve = c2; legs = c1; hemY = hip; hemHalf = g.wh - 0.5; break;
    case 'apron': hemY = hip + 1; hemHalf = g.wh + 0.5; break;
    case 'tunic': hemY = hip + 1; hemHalf = g.wh + 0.5; break;
  }

  const body = mask((m) => {
    taper(m, top, waist, CX + lean, g.sh, CX, g.wh, 1);
    taper(m, waist, hemY + k.hemLift, CX, g.wh, hemX, hemHalf, pow);
  });
  const box = body.bounds();
  paint(b, body, bodyRamp, { ky: 0.34, box });

  const front = dir !== 'n';
  const trim = shift(c2, 0);

  switch (outfit) {
    case 'coat':
    case 'jacket': {
      if (front) {
        // open front + lapels
        const openX = CX + Math.round(lean / 2);
        for (let y = top + 2; y <= hemY + k.hemLift; y++) {
          const t = (y - top) / Math.max(1, hemY - top);
          const x = Math.round(lerp(openX, CX + k.hem, t));
          b.pxOver(x, y, c1[0]);
          b.pxOver(x - 1, y, c1[3], 0.8);
        }
        const lap = mask((m) => {
          limb(m, CX - 2 + lean, top + 1, CX - g.sh + 1 + lean, top + 3, 2, 2);
          limb(m, CX + 2 + lean, top + 1, CX + g.sh - 1 + lean, top + 3, 2, 2);
        });
        paint(b, lap, outfit === 'jacket' ? trim : shift(c1, 1), { ky: 0.5 });
      } else {
        for (let y = top + 2; y <= hemY; y++) b.pxOver(CX, y, c1[1], 0.7);
        for (let x = CX - g.sh + 1; x <= CX + g.sh - 1; x++) b.pxOver(x, top + 3, c1[1], 0.5);
      }
      // belt
      const belt = mask((m) => { taper(m, waist, waist, CX, g.wh - 0.5, CX, g.wh - 0.5); });
      paint(b, belt, P.LEATHER, { ky: 0.6 });
      break;
    }
    case 'dress': {
      const band = mask((m) => { taper(m, waist - 1, waist, CX, g.wh - 0.5, CX, g.wh - 0.5); });
      paint(b, band, trim, { ky: 0.6 });
      if (front) {
        b.pxOver(CX, top + 2, c1[3]);
        b.pxOver(CX, top + 3, c1[3]);
      }
      // hem pleats — three vertical marks that move with the sway
      for (let i = -1; i <= 1; i++) {
        const x = CX + k.hem + i * 3;
        b.pxOver(x, hemY + k.hemLift - 1, c1[1], 0.7);
        b.pxOver(x, hemY + k.hemLift - 2, c1[1], 0.45);
      }
      break;
    }
    case 'apron': {
      const ap = mask((m) => {
        taper(m, top + 3, waist, CX, g.wh - 1, CX, g.wh - 0.5, 1);
        taper(m, waist, hemY + k.hemLift + 1, CX, g.wh - 0.5, hemX, g.wh + 0.5, 1.2);
      });
      paint(b, ap, trim, { ky: 0.4 });
      if (front) {
        // shoulder straps + waist tie
        b.pxOver(CX - 2 + lean, top + 1, trim[3]);
        b.pxOver(CX - 2 + lean, top + 2, trim[2]);
        b.pxOver(CX + 2 + lean, top + 1, trim[3]);
        b.pxOver(CX + 2 + lean, top + 2, trim[2]);
        for (let x = CX - g.wh; x <= CX + g.wh; x++) b.pxOver(x, waist, trim[1]);
      }
      break;
    }
    case 'vest': {
      const vest = mask((m) => { taper(m, top, waist + 1, CX + lean, g.sh - 1, CX, g.wh, 1); });
      paint(b, vest, c1, { ky: 0.36 });
      if (front) {
        for (let y = top + 1; y <= waist; y++) b.pxOver(CX + Math.round(lean / 2), y, c1[0]);
        b.pxOver(CX - 1, top + 4, P.UI_GOLD[3]);
        b.pxOver(CX - 1, top + 7, P.UI_GOLD[3]);
      }
      break;
    }
    case 'overalls': {
      const bib = mask((m) => { taper(m, top + 2, hip, CX + Math.round(lean / 2), g.wh - 1, CX, g.wh, 1); });
      paint(b, bib, c1, { ky: 0.4 });
      if (front) {
        b.pxOver(CX - 2 + lean, top, c1[3]);
        b.pxOver(CX - 2 + lean, top + 1, c1[2]);
        b.pxOver(CX + 2 + lean, top, c1[3]);
        b.pxOver(CX + 2 + lean, top + 1, c1[2]);
        b.pxOver(CX - g.wh + 2, top + 3, P.METAL[4]);
        b.pxOver(CX + g.wh - 2, top + 3, P.METAL[4]);
      }
      break;
    }
    case 'robe': {
      const sash = mask((m) => { taper(m, waist - 1, waist + 1, CX, g.wh, CX, g.wh); });
      paint(b, sash, trim, { ky: 0.5 });
      if (front) for (let y = top + 2; y <= waist - 2; y++) b.pxOver(CX, y, c1[0], 0.7);
      break;
    }
    case 'tunic': {
      const belt = mask((m) => { taper(m, waist, waist + 1, CX, g.wh + 0.5, CX, g.wh + 0.5); });
      paint(b, belt, P.LEATHER, { ky: 0.55 });
      if (front) {
        b.pxOver(CX, waist, P.UI_GOLD[3]);
        b.pxOver(CX, waist + 1, P.UI_GOLD[1]);
        b.pxOver(CX - 1, top + 2, c1[1]);
        b.pxOver(CX + 1, top + 2, c1[1]);
      }
      break;
    }
  }

  // Collar: a 1px darker arc under the chin sells the neck opening.
  if (front) {
    for (let x = CX - 2 + lean; x <= CX + 2 + lean; x++) b.pxOver(x, top + 1, shift(bodyRamp, -2)[0], 0.85);
  }
  // The hem casts onto whatever is under it. One pixel, huge readability win.
  const hemRow = Math.round(hemY + k.hemLift) + 1;
  for (let x = CX - Math.round(hemHalf) - 2; x <= CX + Math.round(hemHalf) + 2; x++) {
    b.pxOver(x, hemRow, P.OUTLINE, 0.34);
  }
  return { sleeve, legs, longSleeve, hemY };
}

// ── Accessories ────────────────────────────────────────────────────────────

/** Straps and sashes go on before the arms so the arms sit on top of them. */
function drawAccUnder(b: Surface, spec: CharSpec, dir: Dir, g: Geom, k: Kin, c2: Ramp): void {
  const acc = accessoriesOf(spec);
  const bob = k.bob;
  if (acc.includes('satchel') || acc.includes('bag')) {
    const strap = mask((m) => {
      limb(m, CX - g.sh + 1 + k.lean, g.shoulderY + bob, CX + g.wh - 1, g.hipY - 1 + bob, 2, 2);
    });
    paint(b, strap, P.LEATHER, { kx: 0.6, ky: 0.2 });
  }
  if (acc.includes('sash')) {
    const sash = mask((m) => {
      limb(m, CX + g.sh - 2 + k.lean, g.shoulderY + bob, CX - g.wh + 1, g.hipY + bob, 3, 3);
    });
    paint(b, sash, c2, { kx: 0.6, ky: 0.25 });
    // knot + two tails that swing with the hem
    const tail = mask((m) => {
      m.rect(CX - g.wh - 1, g.hipY + bob, 3, 2, MASK);
      limb(m, CX - g.wh, g.hipY + 1 + bob, CX - g.wh + k.hem, g.hipY + 5 + bob + k.hemLift, 2, 1);
      limb(m, CX - g.wh + 2, g.hipY + 1 + bob, CX - g.wh + 2 + k.hem, g.hipY + 4 + bob + k.hemLift, 2, 1);
    });
    paint(b, tail, c2, { kx: 0.5, ky: 0.4 });
  }
  if (acc.includes('scarf')) {
    const sc = mask((m) => {
      taper(m, g.shoulderY - 2 + bob, g.shoulderY + bob, CX + k.lean, g.wh - 0.5, CX, g.wh, 1);
      if (dir !== 'n') limb(m, CX + 2, g.shoulderY + bob, CX + 2 + k.hem, g.shoulderY + 6 + bob + k.hemLift, 3, 2);
      else limb(m, CX - 1, g.shoulderY + bob, CX - 1 + k.hem, g.shoulderY + 7 + bob + k.hemLift, 3, 2);
    });
    paint(b, sc, c2, { kx: 0.5, ky: 0.35 });
  }
}

/** Bags, headwear, held props — everything that must sit above the arms. */
function drawAccOver(
  b: Surface, spec: CharSpec, dir: Dir, g: Geom, k: Kin, pose: Pose,
  c2: Ramp, hair: Ramp, hx: number, hy: number,
): void {
  const acc = accessoriesOf(spec);
  const bob = k.bob;
  const east = dir === 'e';

  if (acc.includes('satchel')) {
    const bx = CX + g.wh - 2;
    const bag = mask((m) => {
      m.rect(bx, g.hipY - 1 + bob, 6, 5, MASK);
      m.px(bx, g.hipY + 3 + bob, '#00000000');
    });
    paint(b, bag, P.LEATHER, { kx: 0.45, ky: 0.4 });
    for (let x = bx; x < bx + 6; x++) b.pxOver(x, g.hipY + bob, shift(P.LEATHER, -2)[0], 0.8); // flap line
    b.pxOver(bx + 3, g.hipY + 1 + bob, P.METAL[4]);
  }
  if (acc.includes('bag')) {
    const bx = CX + g.wh - 2;
    const bag = mask((m) => { m.rect(bx, g.hipY - 2 + bob, 7, 7, MASK); });
    paint(b, bag, c2, { kx: 0.45, ky: 0.4 });
    const flap = mask((m) => { m.rect(bx, g.hipY - 2 + bob, 7, 3, MASK); });
    paint(b, flap, shift(c2, -1), { kx: 0.45, ky: 0.6 });
    b.pxOver(bx + 3, g.hipY + 1 + bob, P.METAL[4]);
  }
  if (acc.includes('notebook') && pose !== 'attack' && pose !== 'dash') {
    const nx = CX + (east ? 2 : g.sh - 1) + k.handB.x;
    const ny = g.handY + k.handB.y - 1;
    const bk = mask((m) => { m.rect(nx - 2, ny - 1, 5, 6, MASK); });
    paint(b, bk, P.LEATHER, { kx: 0.4, ky: 0.35 });
    for (let y = ny - 1; y < ny + 5; y++) b.pxOver(nx + 2, y, P.UI_PARCHMENT[3]);
    b.pxOver(nx + 2, ny + 1, P.UI_GOLD[3]);
  }
  if (acc.includes('basket')) {
    const bx = CX - 4 + (east ? 3 : 0);
    const by = g.handY + k.handB.y - 2;
    const ba = mask((m) => { m.rect(bx, by, 9, 6, MASK); m.px(bx, by + 5, '#00000000'); m.px(bx + 8, by + 5, '#00000000'); });
    paint(b, ba, P.THATCH, { kx: 0.4, ky: 0.4 });
    for (let y = by + 1; y < by + 6; y += 2) for (let x = bx; x < bx + 9; x += 2) b.pxOver(x, y, P.THATCH[1], 0.8);
    for (let x = bx; x < bx + 9; x++) b.pxOver(x, by, P.THATCH[4]);
  }
  if (acc.includes('wide_hat')) {
    const brim = mask((m) => { m.ellipse(CX - 8 + k.headX, hy + 1, 17, 5, MASK); });
    paint(b, brim, c2, { kx: 0.4, ky: 0.55 });
    const crown = mask((m) => { taper(m, hy - 3, hy + 2, CX + k.headX, 3, CX + k.headX, 4.5, 1); });
    paint(b, crown, c2, { kx: 0.5, ky: 0.35 });
    for (let x = CX - 4 + k.headX; x <= CX + 4 + k.headX; x++) b.pxOver(x, hy + 1, shift(c2, -2)[0], 0.9); // band
  }
  if (acc.includes('cap')) {
    const crown = mask((m) => {
      m.ellipse(hx - 1, hy - 2, 13, 9, MASK);
      for (let y = hy + 3; y < CH; y++) for (let x = 0; x < CW; x++) m.px(x, y, '#00000000');
    });
    paint(b, crown, c2, { kx: 0.5, ky: 0.4 });
    const peak = mask((m) => {
      if (east) m.rect(hx + 8, hy + 2, 5, 2, MASK);
      else if (dir === 's') m.rect(hx + 1, hy + 3, 9, 2, MASK);
      else m.rect(hx + 3, hy + 1, 5, 1, MASK);
    });
    paint(b, peak, shift(c2, -1), { kx: 0.4, ky: 0.6 });
  }
  if (acc.includes('goggles')) {
    const band = mask((m) => { m.rect(hx - 1, hy + 1, 13, 2, MASK); });
    paint(b, band, P.LEATHER, { kx: 0.4, ky: 0.5 });
    const lens = (lx: number) => {
      const l = mask((m) => { m.ellipse(lx, hy, 4, 4, MASK); });
      paint(b, l, P.METAL, { kx: 0.5, ky: 0.5 });
      b.pxOver(lx + 1, hy + 1, P.WATER[3]);
      b.pxOver(lx + 2, hy + 1, P.WATER[2]);
      b.pxOver(lx + 1, hy + 2, P.WATER[1]);
      b.pxOver(lx + 2, hy + 2, P.WATER[1]);
    };
    if (dir === 's') { lens(hx + 1); lens(hx + 6); }
    else if (east) lens(hx + 6);
    else lens(hx + 4);
  }
  if (acc.includes('glasses') && dir !== 'n') {
    const ring = (lx: number) => {
      b.pxOver(lx - 1, hy + 4, P.METAL[3]);
      b.pxOver(lx + 1, hy + 4, P.METAL[3]);
      b.pxOver(lx - 1, hy + 5, P.METAL[2]);
      b.pxOver(lx + 1, hy + 5, P.METAL[2]);
      b.pxOver(lx, hy + 4, P.METAL[4], 0.35);
    };
    if (dir === 's') { ring(hx + 3); ring(hx + 7); b.pxOver(hx + 5, hy + 5, P.METAL[3]); }
    else { ring(hx + 7); b.pxOver(hx + 5, hy + 5, P.METAL[3]); b.pxOver(hx + 4, hy + 5, P.METAL[2]); }
  }
  if (acc.includes('flower')) {
    const fx = dir === 'e' ? hx + 1 : hx + 9;
    const fy = hy + 1 + k.hairLift;
    b.px(fx, fy, P.FLOWER_ROSE[1]);
    b.px(fx + 1, fy, P.FLOWER_ROSE[2]);
    b.px(fx, fy + 1, P.FLOWER_ROSE[2]);
    b.px(fx + 1, fy + 1, P.FLOWER_ROSE[3]);
    b.pxOver(fx, fy + 2, P.GRASS[1]);
  }
}

/** A short blade: wooden grip, gold crossguard, bright steel with a dark contour. */
function drawWeapon(b: Surface, hand: V, tip: V): void {
  const dx = tip.x - hand.x, dy = tip.y - hand.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len, uy = dy / len;
  const grip = mask((m) => {
    limb(m, hand.x, hand.y, Math.round(hand.x - ux * 2), Math.round(hand.y - uy * 2), 2, 2);
  });
  paint(b, grip, P.WOOD, { kx: 0.5, ky: 0.4 });

  const blade = mask((m) => {
    limb(m, Math.round(hand.x + ux), Math.round(hand.y + uy), tip.x, tip.y, 2, 1);
  });
  // A dark contour wherever the blade crosses the body, so steel never fuses
  // with a garment. pxOver leaves empty space alone — the silhouette outline
  // pass handles that side.
  const ring = blade.clone().outline(MASK);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (ring.alphaAt(x, y) === 0 || blade.alphaAt(x, y) !== 0) continue;
      b.pxOver(x, y, P.OUTLINE, 0.8);
    }
  }
  // Biased bright: steel has to out-value both the garment and the terrain.
  paint(b, blade, P.METAL, { kx: 0.55, ky: 0.35, bias: 0.3 });

  const gx = Math.round(-uy * 1.4), gy = Math.round(ux * 1.4);
  const guard = mask((m) => { limb(m, hand.x - gx, hand.y - gy, hand.x + gx, hand.y + gy, 1, 1); });
  paint(b, guard, P.UI_GOLD, { kx: 0.5, ky: 0.4 });
}

// ── Body assembly ──────────────────────────────────────────────────────────

function drawBody(spec: CharSpec, dir: Dir, pose: Pose, k: Kin): Surface {
  const b = new Surface(CW, CH);
  const g = geom(spec, dir);
  const skin = pickRamp(spec.skin, P.SKIN);
  const hair = pickRamp(spec.hair, P.HAIR);
  const c1 = pickRamp(spec.cloth, P.CLOTH);
  const c2 = spec.cloth2 ? pickRamp(spec.cloth2, P.CLOTH) : shift(c1, -1);
  const east = dir === 'e';
  const bob = k.bob;

  const hx = g.hx + k.headX + k.lean;
  const hy = g.hy + k.headY + bob + k.crouch;

  // 1. Neck — drawn first so the collar and the head both overlap it.
  const neck = mask((m) => { m.rect(CX - 1 + k.lean, hy + 8, 3, g.shoulderY + bob - hy - 6, MASK); });
  paint(b, neck, shift(skin, -2), { kx: 0.4, ky: 0.2 });

  // 2. Legs. The far leg goes down first and one ramp step darker.
  const bootNear = P.LEATHER;
  const bootFar = shift(P.LEATHER, -1);
  const legs = trouserRamp(spec, c1, c2);
  const hipYA = g.hipY + bob;
  drawLeg(b, g.hipA + Math.round(k.footA.x / 3), hipYA, g.footA + k.footA.x, g.footY + k.footA.y,
    g.legW, east ? shift(legs, -1) : legs, east ? bootFar : bootNear, dir, k.sit);
  drawLeg(b, g.hipB + Math.round(k.footB.x / 3), hipYA, g.footB + k.footB.x, g.footY + k.footB.y,
    g.legW, legs, bootNear, dir, k.sit);

  // 3. The far arm lives behind the torso in profile.
  const shY = g.shoulderY + 1 + bob - k.shrug;
  const hAx = k.absA ? k.absA.x : g.handA + k.handA.x;
  const hAy = k.absA ? k.absA.y : g.handY + k.handA.y;
  const hBx = k.absB ? k.absB.x : g.handB + k.handB.x;
  const hBy = k.absB ? k.absB.y : g.handY + k.handB.y;
  if (east) {
    const armRamp = shift(spec.outfit === 'vest' || spec.outfit === 'overalls' ? c2 : c1, -1);
    drawArm(b, g.shA + k.lean, shY, hAx, hAy,
      g.armW, armRamp, shift(skin, -1), k.elbowA, { longSleeve: spec.outfit === 'robe' });
  }

  // 4. Garment (covers the top of the legs and the far arm).
  const fit = drawGarment(b, spec, dir, g, k, c1, c2);
  drawAccUnder(b, spec, dir, g, k, c2);

  // 5. Arms.
  if (east) {
    drawArm(b, g.shB + k.lean, shY + 1, hBx, hBy,
      g.armW, fit.sleeve, skin, k.elbowB, { seam: 'l', longSleeve: fit.longSleeve });
  } else {
    drawArm(b, g.shA + k.lean, shY, hAx, hAy,
      g.armW, fit.sleeve, skin, k.elbowA, { seam: 'r', longSleeve: fit.longSleeve });
    drawArm(b, g.shB + k.lean, shY, hBx, hBy,
      g.armW, fit.sleeve, skin, k.elbowB, { seam: 'l', longSleeve: fit.longSleeve });
  }

  // 6. Head, hair, face.
  const head = headMask(hx, hy);
  paint(b, head, skin, { kx: 0.42, ky: 0.36 });
  drawFace(b, dir, hx, hy, skin, hair, k.expr);
  drawHair(b, spec, dir, g, hx, hy, k, hair);

  // 7. Anything worn or carried on top.
  drawAccOver(b, spec, dir, g, k, pose, c2, hair, hx, hy);
  if (spec.weapon && k.weaponTip) drawWeapon(b, v(hBx, hBy), k.weaponTip);

  return b;
}

/** Overalls put the primary colour on the legs; everything else uses cloth2. */
function trouserRamp(spec: CharSpec, c1: Ramp, c2: Ramp): Ramp {
  if (spec.outfit === 'overalls') return c1;
  if (spec.outfit === 'dress' || spec.outfit === 'robe') return shift(c2, -1);
  return c2;
}

/**
 * The dodge roll. A rig pose cannot sell this at 24x32 — a tucked body is a
 * ball, so it is drawn as one: a shaded sphere of garment with the head, the
 * boots and one hand orbiting it. Frame 1 advances the orbit by ~110 degrees,
 * which is a real rotation rather than a squash.
 */
function drawRoll(spec: CharSpec, dir: Dir, frame: number): Surface {
  const b = new Surface(CW, CH);
  const skin = pickRamp(spec.skin, P.SKIN);
  const hair = pickRamp(spec.hair, P.HAIR);
  const c1 = pickRamp(spec.cloth, P.CLOTH);
  const c2 = spec.cloth2 ? pickRamp(spec.cloth2, P.CLOTH) : shift(c1, -1);

  const cx = CX, cy = 23, r = 7.5;
  const base = dir === 'e' ? 0.35 : dir === 's' ? 1.4 : -1.5;   // radians: where the head starts
  const th = base + frame * 1.95;
  const ux = Math.cos(th), uy = Math.sin(th);
  const px = -uy, py = ux;                                       // perpendicular

  // Body: one shaded sphere of garment.
  const ball = mask((m) => { m.ellipse(cx - r, cy - r, r * 2, r * 2, MASK); });
  paint(b, ball, c1, { kx: 0.55, ky: 0.4 });
  // Two cloth folds that rotate with the tuck so the ball is not a billiard.
  for (let i = -1; i <= 1; i += 2) {
    const fold = mask((m) => {
      limb(m, Math.round(cx + px * 5 * i - ux * 3), Math.round(cy + py * 5 * i - uy * 3),
        Math.round(cx + px * 3 * i + ux * 4), Math.round(cy + py * 3 * i + uy * 4), 1, 1);
    });
    paint(b, fold, shift(c1, -2), { kx: 0.4, ky: 0.4 });
  }

  // Boots trail the head by half a turn.
  for (let i = -1; i <= 1; i += 2) {
    const bx = Math.round(cx - ux * 6 + px * 2.4 * i);
    const by = Math.round(cy - uy * 6 + py * 2.4 * i);
    const shin = mask((m) => { m.ellipse(bx - 2, by - 2, 4, 4, MASK); });
    paint(b, shin, i < 0 ? shift(c2, -1) : c2, { kx: 0.5, ky: 0.4 });
    const boot = mask((m) => { m.ellipse(bx - ux * 2 - 1, by - uy * 2 - 1, 3, 3, MASK); });
    paint(b, boot, i < 0 ? shift(P.LEATHER, -1) : P.LEATHER, { kx: 0.5, ky: 0.4 });
  }

  // The tucked head: hair crescent outside, face inside.
  const hcx = cx + ux * 5.5, hcy = cy + uy * 5.5;
  if (spec.hairStyle !== 'bald') {
    const hm = mask((m) => { m.ellipse(hcx + ux * 1.6 - 4.5, hcy + uy * 1.6 - 4.5, 9, 9, MASK); });
    paint(b, hm, hair, { kx: 0.55, ky: 0.45 });
  }
  const hd = mask((m) => { m.ellipse(hcx - 4, hcy - 4, 8, 8, MASK); });
  paint(b, hd, skin, { kx: 0.45, ky: 0.4 });
  // Squeezed-shut eye, oriented along the tuck.
  const ex = Math.round(hcx + px * 1.6 + ux * 1.2);
  const ey = Math.round(hcy + py * 1.6 + uy * 1.2);
  b.pxOver(ex, ey, P.OUTLINE);
  b.pxOver(Math.round(ex - px), Math.round(ey - py), P.OUTLINE);

  // One hand clamped around the shins.
  const gx = Math.round(cx + px * 5.5 - ux * 1);
  const gy = Math.round(cy + py * 5.5 - uy * 1);
  const hand = mask((m) => { m.ellipse(gx - 1, gy - 1, 3, 3, MASK); });
  paint(b, hand, skin, { kx: 0.5, ky: 0.4 });
  return b;
}

// ── Public entry point ─────────────────────────────────────────────────────

export function drawChar(spec: CharSpec, dir: Dir, pose: Pose, frame: number): Surface {
  const n = POSE_FRAMES[pose];
  const f = ((frame % n) + n) % n;
  const k = kinematics(dir, pose, f, spec);
  const body = pose === 'dash' ? drawRoll(spec, dir, f) : drawBody(spec, dir, pose, k);

  const out = new Surface(CW, CH);
  const sw = Math.round(13 * k.shadow);
  out.ellipse(CX - Math.round(sw / 2), 29, sw, 3, P.SHADOW_CAST);
  body.outline(P.OUTLINE);
  out.blit(body);
  return out;
}

/** All frames of one pose in order. */
export function charStrip(spec: CharSpec, dir: Dir, pose: Pose): Surface[] {
  const out: Surface[] = [];
  for (let i = 0; i < POSE_FRAMES[pose]; i++) out.push(drawChar(spec, dir, pose, i));
  return out;
}
