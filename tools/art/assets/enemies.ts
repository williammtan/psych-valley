/**
 * ENEMIES — things the Echo disturbed or made.
 *
 * House rules for this module (they are what make a fight fair):
 *
 *  1. SILHOUETTE FIRST. Every creature has a shape you can name with the colours
 *     covered: bramble = spiked knot on roots, wisp = tattered lantern bell,
 *     mimicling = hooded person, echomote = blank pawn, Echo = unstable mass.
 *  2. EVERY creature gets a full 1px P.OUTLINE silhouette *and* a 1px rim of its
 *     own glow colour outside that. The dark ring separates it from bright grass,
 *     the glow ring separates it from the dark shrine floor. Both, always.
 *  3. TELEGRAPHS CHANGE THE SILHOUETTE, not just the brightness. A wind-up frame
 *     that only gets brighter is invisible in a busy room. Compress, flare, split.
 *  4. Bodies stay natural (bracken, husk cloth, shadow cloth). Only the *light*
 *     inside them is Echo violet/cyan. That is the whole read of the setting:
 *     ordinary valley things pulled out of shape.
 *  5. Contact shadows always. Floaters get a smaller shadow with a gap between it
 *     and the body — that gap is how the player reads "airborne".
 */
import { Surface, rng, valueNoise, type Rng } from '../lib/pixel.js';
import { ArtBuild } from '../lib/registry.js';
import * as P from '../lib/palette.js';

type Dir = 's' | 'n' | 'e';
const DIRS: Dir[] = ['s', 'n', 'e'];

// ── shared helpers ─────────────────────────────────────────────────────────

/** hex + alpha byte — for the semi-transparent glow / ghost passes. */
function A(c: string, a: number): string {
  const v = Math.max(0, Math.min(255, Math.round(a * 255)));
  return c + v.toString(16).padStart(2, '0');
}

/**
 * Full dark silhouette + soft self-coloured rim outside it.
 * Rule 2. Do this to every creature body before it is composited over its shadow.
 */
function seal(s: Surface, glow: string, glowAlpha = 0.34, diagonals = true): Surface {
  s.outline(P.OUTLINE, diagonals);
  s.outline(A(glow, glowAlpha), diagonals);
  return s;
}

/** Contact shadow: doubled ellipse so the middle is denser than the edge. */
function contact(s: Surface, cx: number, cy: number, w: number, h: number, a = 0.30): Surface {
  s.ellipse(Math.round(cx - w / 2), Math.round(cy - h / 2), w, h, P.OUTLINE, a);
  s.ellipse(Math.round(cx - w / 2) + 1, Math.round(cy - h / 2), Math.max(2, w - 2), Math.max(1, h - 1), P.OUTLINE, a * 0.8);
  return s;
}

/** Cheap, consistent form shading: light upper-left, shadow lower-right. */
function volume(s: Surface, lit: string, dark: string, litA = 0.45, darkA = 0.5): Surface {
  s.innerShade(dark, darkA, [[0, 1], [1, 0], [1, 1]]);
  s.innerShade(lit, litA, [[0, -1], [-1, 0]]);
  return s;
}

/** Hit flash — used by every hurt frame so damage feedback is uniform. */
function flashed(s: Surface, amount: number, color = '#ffe6dc'): Surface {
  return s.clone().tint(color, amount);
}

/** Knock alternating pixels down in alpha — the "not quite here" look. */
function ghost(s: Surface, alpha = 0.5, phase = 0): Surface {
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = (y * s.w + x) * 4;
      if (s.data[i + 3] === 0) continue;
      if ((x + y + phase) % 2 === 0) s.data[i + 3] = Math.round(s.data[i + 3] * alpha);
    }
  }
  return s;
}

/** A rising mote of escaped Echo light — every death animation uses these. */
function mote(s: Surface, x: number, y: number, size: number, alpha: number, cyan = false): Surface {
  const core = cyan ? P.ECHO_RUNE : P.ECHO_SPARK;
  const halo = cyan ? P.ECHO_CYAN[3] : P.ECHO_GLOW;
  s.px(x, y, core, alpha);
  if (size > 0) {
    s.px(x + 1, y, halo, alpha * 0.8);
    s.px(x - 1, y, halo, alpha * 0.8);
    s.px(x, y - 1, halo, alpha * 0.8);
    s.px(x, y + 1, halo, alpha * 0.7);
  }
  if (size > 1) {
    s.px(x + 1, y - 1, halo, alpha * 0.4);
    s.px(x - 1, y - 1, halo, alpha * 0.4);
    s.px(x + 2, y, halo, alpha * 0.3);
    s.px(x - 2, y, halo, alpha * 0.3);
    s.px(x, y - 2, halo, alpha * 0.35);
  }
  return s;
}

/** Soft radial bloom, drawn under a light source. */
function bloom(s: Surface, cx: number, cy: number, r: number, color: string, alpha = 0.5): Surface {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      s.px(x, y, color, alpha * (1 - d / r) * (1 - d / r));
    }
  }
  return s;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. BRAMBLE — a knot of dead bracken that has learned to want something.
//    Reads as a coiled spring: wide low mass, thorns pointing outward, roots
//    bunched underneath. Charges in a straight line.
// ══════════════════════════════════════════════════════════════════════════

const BR_W = 22, BR_H = 22;
const BR_GROUND = 17;

/** Fixed thorn anchors (degrees, base length). Fixed, not random, so the thorns
 *  are the *same* thorns from frame to frame — random thorns look like static.
 *  Lengths are deliberately uneven: a uniform sunburst reads as a cartoon sun. */
const THORN_SET: Array<[number, number]> = [
  [-96, 6], [-70, 5], [-118, 6], [-46, 5], [-142, 4],
  [-16, 3], [-164, 3], [26, 2], [154, 2], [62, 2], [118, 2],
];

interface BrPose {
  dir: Dir;
  bob?: number;      // body y offset
  rx?: number;       // half-width  (6.2 = rest)
  ry?: number;       // half-height (4.8 = rest)
  dx?: number;       // body x offset
  flare?: number;    // 0..1 extra thorn length
  eye?: number;      // 0..1 eye brightness
  leg?: number;      // gait phase
  brace?: number;    // 0..1 legs splay outward and take weight
  seed?: number;
}

function brambleBody(p: BrPose): Surface {
  const s = new Surface(BR_W, BR_H);
  const seed = p.seed ?? 7;
  const r = rng(seed);
  const cx = 11 + (p.dx ?? 0);
  const cy = 10.4 + (p.bob ?? 0);
  const rx = p.rx ?? 6.2;
  const ry = p.ry ?? 4.8;
  const flare = p.flare ?? 0;
  const eye = p.eye ?? 0.55;
  const brace = p.brace ?? 0;

  // ── root legs. They are anchored to the GROUND, not to the body, so when
  //    the knot compresses for a charge the legs visibly brace and splay.
  const knotBottom = Math.round(cy + ry - 1);
  const legXs = p.dir === 'e' ? [-4, -1, 2, 5] : [-5, -2, 2, 5];
  legXs.forEach((ox, i) => {
    const step = (i + (p.leg ?? 0)) % 2; // 0 = planted, 1 = lifted
    const out = ox < 0 ? -1 : 1;
    const x0 = Math.round(cx + ox);
    const x1 = Math.round(cx + ox + out * (1 + brace * 2) + (step ? out : 0));
    const y1 = BR_GROUND - (step ? 1 : 0);
    s.line(x0, knotBottom, x0, knotBottom + 1, P.BRACKEN[1]);
    s.line(x0, knotBottom + 1, x1, y1, P.BRACKEN[1]);
    s.px(x1, y1, P.THORN[0]);
    s.px(x1 + out, y1, P.THORN[0]); // splayed root toe
    if (brace > 0.4) s.px(x1 + out * 2, y1, P.THORN[1]);
  });

  // ── the knot: a main mass plus a hump on the lit side, so it is never a
  //    plain circle. Low and wide = hunched = about to spring.
  const bx = Math.round(cx - rx), by = Math.round(cy - ry);
  const bw = Math.max(3, Math.round(rx * 2)), bh = Math.max(3, Math.round(ry * 2));
  s.ellipse(bx, by, bw, bh, P.BRACKEN[2]);
  s.ellipse(bx + 1, by - Math.max(1, Math.round(ry * 0.45)), Math.round(bw * 0.55), Math.max(3, Math.round(bh * 0.6)), P.BRACKEN[2]);
  if (p.dir === 'e') s.ellipse(Math.round(cx + rx - 4), Math.round(cy - 1), 5, Math.max(3, bh - 3), P.BRACKEN[2]);
  if (p.dir === 's') s.ellipse(Math.round(cx - 3), Math.round(cy + ry - 3), 7, 4, P.BRACKEN[2]);

  // tangled bracken, clipped inside the knot
  const tang = new Surface(BR_W, BR_H);
  for (let i = 0; i < 9; i++) {
    const a0 = r.range(0, Math.PI * 2);
    const a1 = a0 + r.range(1.5, 3.0);
    const rr = r.range(0.4, 1.05);
    tang.line(
      cx + Math.cos(a0) * rx * rr, cy + Math.sin(a0) * ry * rr,
      cx + Math.cos(a1) * rx * rr * 0.85, cy + Math.sin(a1) * ry * rr * 0.85,
      i % 3 === 0 ? P.THORN[2] : i % 3 === 1 ? P.BRACKEN[0] : P.BRACKEN[3],
    );
  }
  // broad top-left light so the mass has volume, not just a lit rim
  tang.ellipse(Math.round(cx - rx * 0.85), Math.round(cy - ry * 0.95), Math.round(rx), Math.round(ry * 0.9), A(P.BRACKEN[3], 0.5));
  for (let i = 0; i < 6; i++) tang.px(cx + r.int(-5, 3), cy + r.int(-5, 0), P.BRACKEN[4]);
  for (let i = 0; i < 3; i++) {
    // dry leaves still clinging to the bracken
    const lx = cx + r.int(-5, 4), ly = cy + r.int(-3, 2);
    tang.px(lx, ly, P.THORN[3]);
    tang.px(lx + 1, ly, P.THORN[2]);
    tang.px(lx, ly + 1, P.THORN[1]);
  }
  s.blitInside(tang);

  volume(s, P.BRACKEN[4], P.BRACKEN[0], 0.5, 0.55);

  // ── thorns. Tips are clamped inside the canvas so a flared wind-up never
  //    gets sliced off by the sprite edge.
  for (const [deg, len0] of THORN_SET) {
    const a = (deg * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const sx = cx + ca * (rx - 1.5), sy = cy + sa * (ry - 1.5);
    let len = len0 + flare * 3.2;
    if (ca > 0.1) len = Math.min(len, (BR_W - 3 - sx) / ca);
    if (ca < -0.1) len = Math.min(len, (2 - sx) / ca);
    if (sa < -0.1) len = Math.min(len, (2 - sy) / sa);
    len = Math.max(1, Math.round(len));
    const horiz = Math.abs(ca) > 0.5;
    for (let k = 0; k <= len; k++) {
      const t = k / len;
      const x = sx + ca * k, y = sy + sa * k;
      s.px(x, y, t > 0.72 ? P.THORN[4] : t > 0.38 ? P.THORN[2] : P.BRACKEN[1]);
      if (t < 0.45) s.px(horiz ? x : x + 1, horiz ? y + 1 : y, P.BRACKEN[0]);
    }
  }

  // ── eyes: two points of Echo light down in the tangle ───────────────────
  const drawEye = (ex: number, ey: number) => {
    const col = eye > 0.8 ? P.ECHO_SPARK : eye > 0.5 ? P.ECHO_GLOW : P.ECHO_VIOLET[4];
    bloom(s, ex + 0.5, ey, eye > 0.8 ? 4 : 3, P.ECHO_VIOLET[3], 0.3 + eye * 0.35);
    s.px(ex, ey, col);
    s.px(ex + 1, ey, col);
    if (eye > 0.75) {
      s.px(ex, ey - 1, col);
      s.px(ex + 1, ey - 1, col);
      s.px(ex - 1, ey, P.ECHO_GLOW, 0.8);
      s.px(ex + 2, ey, P.ECHO_GLOW, 0.8);
    }
    s.px(ex, ey + 1, P.ECHO_VIOLET[3], 0.7);
    s.px(ex + 1, ey + 1, P.ECHO_VIOLET[3], 0.7);
  };
  if (p.dir === 's') {
    drawEye(Math.round(cx - 4), Math.round(cy + 1));
    drawEye(Math.round(cx + 2), Math.round(cy + 1));
  } else if (p.dir === 'e') {
    drawEye(Math.round(cx + 1), Math.round(cy - 1));
    drawEye(Math.round(cx + 3), Math.round(cy + 1));
  } else {
    // facing away: the light only leaks out from under the knot
    for (let x = -4; x <= 4; x++) {
      s.pxOver(Math.round(cx + x), Math.round(cy + ry - 1), P.ECHO_VIOLET[3], 0.3 + eye * 0.3);
    }
    s.pxOver(Math.round(cx - 3), Math.round(cy + ry - 2), P.ECHO_VIOLET[4], 0.5);
    s.pxOver(Math.round(cx + 3), Math.round(cy + ry - 2), P.ECHO_VIOLET[4], 0.5);
  }
  return s;
}

/** Motion streaks / tension marks — drawn outside the sealed body so the
 *  outline pass never wraps them. */
function brambleFx(out: Surface, kind: 'none' | 'wind' | 'charge', p: BrPose, t: number) {
  const cx = 11 + (p.dx ?? 0);
  const cy = 10.4 + (p.bob ?? 0);
  if (kind === 'wind') {
    // Tension marks: dashes pointing *inward* at the knot, closing in as the
    // wind-up peaks. Reads as compression, not as an explosion.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const d0 = 11.5 - t * 3;
      for (let k = 0; k < 2; k++) {
        out.px(cx + Math.cos(a) * (d0 + k * 1.6), cy + Math.sin(a) * ((d0 - 1.5) * 0.8 + k * 1.3),
          k === 0 ? P.ECHO_SPARK : P.ECHO_GLOW, (0.95 - k * 0.35) * t);
      }
    }
    // ground scuff kicked back by the braced roots
    for (let i = 0; i < 5; i++) {
      const x = cx + (i - 2) * 3.5;
      out.px(x, BR_GROUND + 2, P.THORN[3], 0.7 * t);
      out.px(x + (i % 2 ? 1 : -1), BR_GROUND + 3, P.THORN[4], 0.5 * t);
    }
  } else if (kind === 'charge') {
    const back = p.dir === 's' ? [0, -1] : p.dir === 'n' ? [0, 1] : [-1, 0];
    for (let i = 0; i < 5; i++) {
      const off = (i - 2) * 2.2;
      const len = 5 + ((i * 3 + t * 2) % 4);
      for (let k = 3; k < 3 + len; k++) {
        const x = cx + back[0] * k + (back[0] === 0 ? off : 0);
        const y = cy + back[1] * k + (back[1] === 0 ? off : 0) + 1;
        out.px(x, y, k > 5 ? P.ECHO_GLOW : P.ECHO_SPARK, 0.9 - k * 0.06);
      }
    }
  }
}

function brambleFrame(
  p: BrPose,
  fx: 'none' | 'wind' | 'charge' = 'none',
  t = 0,
  fl?: { amt: number; col?: string },
): Surface {
  const body = brambleBody(p);
  // Flash the body *before* sealing, so a hit frame keeps its dark silhouette
  // instead of turning into a white smear.
  if (fl) body.tint(fl.col ?? '#ffe6dc', fl.amt);
  seal(body, P.ECHO_GLOW, 0.34, false);
  const out = new Surface(BR_W, BR_H);
  contact(out, 11 + (p.dx ?? 0) * 0.5, BR_GROUND + 2, 13 + Math.round(((p.rx ?? 6.2) - 6.2) * 2), 4, 0.32);
  brambleFx(out, fx, p, t);
  out.blit(body);
  return out;
}

function registerBramble(b: ArtBuild) {
  // idle — breathing, thorns twitching
  const idle = [
    brambleFrame({ dir: 's', bob: 0, eye: 0.5, leg: 0 }),
    brambleFrame({ dir: 's', bob: -1, ry: 5.1, eye: 0.65, flare: 0.14, leg: 0 }),
    brambleFrame({ dir: 's', bob: 0, eye: 0.55, leg: 1 }),
    brambleFrame({ dir: 's', bob: 0, ry: 4.5, rx: 6.5, eye: 0.42, flare: 0.04, leg: 1 }),
  ];
  b.addStrip('enemy/bramble/idle', idle, { key: 'bramble_idle', frameRate: 4, repeat: -1 });

  // walk — a scuttle: the knot rolls side to side over shuffling roots
  for (const dir of DIRS) {
    const f: Surface[] = [];
    const sway = dir === 'e' ? [0, 1, 0, 0] : [-1, 0, 1, 0];
    for (let i = 0; i < 4; i++) {
      f.push(brambleFrame({
        dir,
        bob: i % 2 === 0 ? 0 : -2,
        dx: sway[i],
        rx: i % 2 === 0 ? 6.4 : 5.9,
        ry: i % 2 === 0 ? 4.6 : 5.1,
        eye: 0.55,
        leg: i % 2,
        flare: i === 1 ? 0.12 : 0,
      }));
    }
    b.addStrip(`enemy/bramble/walk_${dir}`, f, { key: `bramble_walk_${dir}`, frameRate: 9, repeat: -1 });
  }

  // charge_wind — THE telegraph, and the whole fairness of the fight.
  // The knot flattens to two-thirds its height, spreads sideways, pulls back
  // over braced roots, every thorn nearly doubles, the eyes go white. The
  // silhouette changes from "spiked ball" to "drawn bow" — readable at 1x.
  const wind = [
    brambleFrame({ dir: 's', bob: 1, rx: 6.8, ry: 4.1, eye: 0.75, flare: 0.4, brace: 0.4, leg: 0 }, 'wind', 0.4),
    brambleFrame({ dir: 's', bob: 2, rx: 7.6, ry: 3.3, eye: 0.92, flare: 0.8, brace: 0.8, leg: 0 }, 'wind', 0.75),
    brambleFrame({ dir: 's', bob: 2, rx: 8.2, ry: 2.8, eye: 1, flare: 1, brace: 1, leg: 0 }, 'wind', 1),
  ];
  b.addStrip('enemy/bramble/charge_wind', wind, { key: 'bramble_charge_wind', frameRate: 6, repeat: 0 });

  // charge — stretched along the travel axis with streaks trailing behind
  for (const dir of DIRS) {
    const f: Surface[] = [];
    for (let i = 0; i < 2; i++) {
      const along = dir === 'e';
      f.push(brambleFrame({
        dir,
        bob: dir === 'n' ? -1 : 0,
        dx: along ? 1 : 0,
        rx: along ? 7.8 : 4.8,
        ry: along ? 3.8 : 6.4,
        eye: 1,
        flare: i === 0 ? 0.15 : 0.3,
        brace: 0.2,
        leg: i,
      }, 'charge', i));
    }
    b.addStrip(`enemy/bramble/charge_${dir}`, f, { key: `bramble_charge_${dir}`, frameRate: 12, repeat: -1 });
  }

  // hurt — flash + recoil, thorns splayed
  b.addStrip('enemy/bramble/hurt', [
    brambleFrame({ dir: 's', bob: 1, rx: 6.9, ry: 4.2, eye: 1, flare: 0.5, brace: 0.5 }, 'none', 0, { amt: 0.7 }),
    brambleFrame({ dir: 's', bob: 0, rx: 6.4, ry: 4.6, eye: 0.8, flare: 0.25 }, 'none', 0, { amt: 0.35, col: P.ECHO_GLOW }),
  ], { key: 'bramble_hurt', frameRate: 12, repeat: 0 });

  // die — the knot comes apart, thorns scatter, the Echo light escapes upward
  const die: Surface[] = [];
  die.push(brambleFrame({ dir: 's', bob: -1, rx: 6.9, ry: 5.4, eye: 1, flare: 0.6, brace: 0.6 }, 'none', 0, { amt: 0.78 }));
  for (let i = 1; i < 5; i++) {
    const t = i / 4;
    const out = new Surface(BR_W, BR_H);
    contact(out, 11, BR_GROUND + 2, Math.round(13 - t * 6), 4, 0.32 * (1 - t * 0.6));
    // the collapsing knot
    if (i < 4) {
      const body = brambleBody({
        dir: 's', bob: Math.round(t * 3), rx: 6.2 - t * 2.2, ry: 4.8 - t * 3.2,
        eye: Math.max(0, 0.9 - t * 1.2), flare: 0, seed: 7,
      });
      seal(body, P.ECHO_GLOW, 0.3, false);
      out.blit(body, 0, 0, 1 - t * 0.45);
    } else {
      for (let k = 0; k < 7; k++) {
        const rr = rng(900 + k);
        out.px(5 + rr.int(0, 12), 17 + rr.int(0, 2), P.BRACKEN[0], 0.75);
      }
    }
    // thorns thrown outward
    const rr = rng(4242);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 + 0.4;
      const d = 5 + t * (7 + rr.range(0, 4));
      const x = 11 + Math.cos(a) * d;
      const y = 11 + Math.sin(a) * d * 0.75;
      const alpha = 1 - t * 0.8;
      out.px(x, y, P.THORN[3], alpha);
      out.px(x - Math.sign(Math.cos(a)), y - Math.sign(Math.sin(a)) * 0.6, P.THORN[1], alpha * 0.8);
      out.px(x + 1, y + 1, P.OUTLINE, alpha * 0.5);
    }
    // the Echo light leaving: a thin shaft that lifts out of the wreck
    const lightY = 12 - t * 11;
    for (let y = Math.round(lightY); y < 14; y++) {
      const w = Math.max(0, 2 - (y - lightY) * 0.16);
      const a = 0.55 * (1 - t * 0.35) * (1 - (y - lightY) / 15);
      for (let x = -w; x <= w; x++) out.px(11 + x, y, Math.abs(x) < 1 ? P.ECHO_GLOW : P.ECHO_VIOLET[3], a);
    }
    bloom(out, 11, lightY + 1, 3 + t * 3, P.ECHO_VIOLET[3], 0.55 * (1 - t * 0.3));
    mote(out, 11, Math.round(lightY), 2, 0.95 - t * 0.2);
    mote(out, 9 - Math.round(t * 2), Math.round(lightY + 3), 1, 0.7 - t * 0.3, true);
    mote(out, 13 + Math.round(t * 2), Math.round(lightY + 4), 1, 0.6 - t * 0.25);
    die.push(out);
  }
  b.addStrip('enemy/bramble/die', die, { key: 'bramble_die', frameRate: 9, repeat: 0 });
}

// ══════════════════════════════════════════════════════════════════════════
// 2. WISP — a lantern husk that outlived its lantern. Floats, fires slowly.
//    Silhouette: a bell with a broken cage at the bottom and ribbons trailing.
//    Nothing else in the game is bell-shaped, so it is nameable at a glance.
// ══════════════════════════════════════════════════════════════════════════

const WI_W = 20, WI_H = 24;
const WI_CX = 10;

/** Half-widths of the cap, row by row: a brimmed lantern lid. */
const CAP_HW: Array<[number, number]> = [
  [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 5], [8, 4],
];

interface WiPose {
  bob?: number;
  core?: number;      // core half-width, 0..4
  bright?: number;    // 0..1
  clamp?: number;     // 0..1 cap descends and ribs close (aim)
  ribbon?: number;    // wave phase
  lift?: number;      // 0..1 ribbons rise and stiffen
  glow?: number;      // outer bloom radius multiplier
  splay?: number;     // 0..1 cap flares open (shoot / death)
  coreY?: number;     // core centre offset
}

/** The dark half: brimmed cap plus the two ribs of its broken cage. */
function wispCap(p: WiPose, withRibs = true): Surface {
  const s = new Surface(WI_W, WI_H);
  const bob = p.bob ?? 0;
  const clamp = p.clamp ?? 0;
  const splay = p.splay ?? 0;
  const cx = WI_CX;

  // hanging hook — this used to be a lantern on a nail somewhere
  s.px(cx, 1 + bob, P.WISP_HUSK[3]);
  s.px(cx - 1, 2 + bob, P.WISP_HUSK[4]);
  s.px(cx + 1, 2 + bob, P.WISP_HUSK[2]);

  for (const [y, hw0] of CAP_HW) {
    const hw = Math.max(1, Math.round(hw0 * (1 - clamp * 0.22) + (y > 5 ? splay * 2 : 0)));
    const yy = y + bob + Math.round(clamp * 2);
    for (let x = -hw; x <= hw; x++) {
      const col = x <= -hw + 1 ? P.WISP_HUSK[4] : x >= hw - 1 ? P.WISP_HUSK[0] : P.WISP_HUSK[2];
      s.px(cx + x, yy, col);
    }
    if (y === 6) { // brim: the widest, brightest line — the shape's anchor
      for (let x = -hw; x <= hw; x++) s.px(cx + x, yy, x < 0 ? P.WISP_HUSK[4] : P.WISP_HUSK[3]);
      // torn brim edges
      s.px(cx - hw - 1, yy, P.WISP_HUSK[3]);
      s.px(cx + hw + 1, yy, P.WISP_HUSK[1]);
      s.px(cx - hw, yy + 1, P.WISP_HUSK[1]);
      s.px(cx + hw, yy + 1, P.WISP_HUSK[0]);
    }
  }

  if (withRibs) {
    // two bent ribs of the cage, hanging over the exposed core
    const ribBottom = 15 + bob - Math.round(clamp * 3);
    for (const [ox, dir] of [[-3, -1], [3, 1]] as Array<[number, number]>) {
      const bend = Math.round((1 - clamp) * 1 + splay * 2);
      const x0 = cx + Math.round(ox * (1 - clamp * 0.3));
      for (let y = 9 + bob; y <= ribBottom; y++) {
        const t = (y - (9 + bob)) / Math.max(1, ribBottom - (9 + bob));
        s.px(x0 + Math.round(dir * bend * t), y, dir < 0 ? P.WISP_HUSK[3] : P.WISP_HUSK[1]);
      }
      s.px(x0 + dir * bend, ribBottom + 1, P.WISP_HUSK[0]); // hooked tip
    }
  }
  return s;
}

function wispFrame(
  p: WiPose,
  inner?: (s: Surface, cx: number, cy: number) => void,
  fx?: (s: Surface, cx: number, cy: number) => void,
): Surface {
  const bob = p.bob ?? 0;
  const cw = p.core ?? 3.2;
  const bright = p.bright ?? 0.6;
  const cx = WI_CX;
  const cy = 12 + bob + (p.coreY ?? 0) + Math.round((p.clamp ?? 0) * 1.5);

  const shell = new Surface(WI_W, WI_H);

  // ── the core: an exposed teardrop of light hanging under the cap. This is
  //    the wisp's whole read — dark lid, bright body — so it is drawn big.
  const top = cy - Math.round(cw * 1.2);
  const bot = cy + Math.round(cw * 1.6);
  for (let y = top; y <= bot; y++) {
    const t = (y - top) / Math.max(1, bot - top);
    const hw = cw * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.92) ** 0.7;
    for (let x = -Math.round(hw); x <= Math.round(hw); x++) {
      const e = Math.abs(x) / Math.max(0.5, hw);
      const col = e > 0.75 ? P.ECHO_CYAN[2] : e > 0.45 ? P.ECHO_CYAN[3] : P.ECHO_CYAN[4];
      shell.px(cx + x, y, col);
    }
  }
  // Hot centre, sitting high in the flame where a wick would be. When the core
  // contracts for an aim it must get *brighter*, never dimmer — a telegraph
  // that darkens is a telegraph nobody sees.
  const hotY = cy - Math.round(cw * 0.3);
  const hotCol = bright > 0.85 ? P.ECHO_SPARK : P.ECHO_RUNE;
  const hw2 = Math.max(2, Math.round(cw * 0.9));
  shell.ellipse(cx - Math.round(hw2 / 2), hotY - 1, hw2, Math.max(3, Math.round(cw * 1.1)), hotCol);
  if (bright > 0.5) { shell.px(cx, hotY, P.ECHO_SPARK); shell.px(cx - 1, hotY, P.ECHO_SPARK); }

  if (inner) inner(shell, cx, cy);
  shell.blit(wispCap(p));

  // ── ribbons: torn cloth still hanging off the brim ──────────────────────
  const phase = p.ribbon ?? 0;
  const lift = p.lift ?? 0;
  const brimY = 7 + bob + Math.round((p.clamp ?? 0) * 2);
  for (let i = 0; i < 4; i++) {
    const rx0 = cx + [-6, -4, 4, 6][i];
    const len = [6, 4, 4, 7][i] - Math.round(lift * 3);
    for (let k = 0; k < len; k++) {
      const wave = Math.sin(phase + i * 1.7 + k * 0.6) * (0.8 + k * 0.3) * (1 - lift * 0.7);
      const x = Math.round(rx0 + wave + (lift ? (i < 2 ? -1 : 1) * lift * 2 : 0));
      const y = Math.round(brimY + 1 + k * (1 - lift * 0.45) - lift * 2);
      shell.px(x, y, k >= len - 2 ? P.WISP_HUSK[1] : P.WISP_HUSK[2]);
      if (k === len - 1) shell.px(x, y, P.ECHO_CYAN[3], 0.6);
    }
  }

  seal(shell, P.ECHO_RUNE, 0.4, false);

  const out = new Surface(WI_W, WI_H);
  // Airborne read: the shadow is small and sits well below the creature.
  contact(out, cx + 1, 22, 7, 3, 0.3);
  bloom(out, cx, cy, (cw + 4) * (p.glow ?? 1), P.ECHO_CYAN[2], 0.3 + bright * 0.25);
  out.blit(shell);
  if (fx) fx(out, cx, cy);
  return out;
}

function registerWisp(b: ArtBuild) {
  // idle — bob on a slow sine, core breathing out of phase with it
  const idle: Surface[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    idle.push(wispFrame({
      bob: Math.round(Math.sin(a) * 1.6),
      core: 3.1 + Math.sin(a * 2 + 1) * 0.5,
      bright: 0.5 + Math.sin(a * 2 + 1) * 0.25,
      ribbon: a * 1.5,
      glow: 1 + Math.sin(a * 2 + 1) * 0.15,
    }));
  }
  b.addStrip('enemy/wisp/idle', idle, { key: 'wisp_idle', frameRate: 6, repeat: -1 });

  // aim — THE telegraph. The core collapses to a hard point and goes white,
  // the cap clamps down over it, the ribbons snap upward. Small + bright +
  // stiff is the opposite of the big + soft + drifting idle.
  const aim = [
    wispFrame({ bob: -1, core: 2.3, bright: 0.75, clamp: 0.35, ribbon: 0.4, lift: 0.35, glow: 0.8 }),
    wispFrame({ bob: -2, core: 1.5, bright: 0.9, clamp: 0.7, ribbon: 0.8, lift: 0.7, glow: 0.7 }),
    wispFrame({ bob: -2, core: 1.1, bright: 1, clamp: 1, ribbon: 1.2, lift: 1, glow: 1.9 }, undefined, (s, cx, cy) => {
      // sparks converging on the point of light (outside the seal, so they
      // stay sharp instead of picking up an outline)
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + 0.3;
        s.px(cx + Math.cos(ang) * 5.5, cy + Math.sin(ang) * 5.5, P.ECHO_RUNE, 0.95);
        s.px(cx + Math.cos(ang) * 7.2, cy + Math.sin(ang) * 7.2, P.ECHO_CYAN[4], 0.6);
      }
    }),
  ];
  b.addStrip('enemy/wisp/aim', aim, { key: 'wisp_aim', frameRate: 6, repeat: 0 });

  // shoot — the light is expelled downward and the cap gapes open
  const shoot = [
    wispFrame({ bob: -2, core: 4, bright: 1, splay: 0.3, ribbon: 1.6, lift: 0.5, glow: 1.7, coreY: 1 }),
    wispFrame({ bob: 0, core: 1.6, bright: 0.5, splay: 0.9, ribbon: 2.4, lift: 0.2, glow: 0.8, coreY: -1 },
      undefined, (s, cx, cy) => {
        s.ellipse(cx - 3, cy + 6, 6, 6, A(P.ECHO_CYAN[3], 0.8));
        s.ellipse(cx - 2, cy + 7, 4, 4, P.ECHO_CYAN[4]);
        s.px(cx - 1, cy + 8, P.ECHO_RUNE);
        s.px(cx, cy + 8, P.ECHO_SPARK);
        for (let i = 0; i < 5; i++) s.px(cx - 5 + i * 2.5, cy + 3, P.ECHO_CYAN[4], 0.65);
      }),
    wispFrame({ bob: 1, core: 2.2, bright: 0.35, splay: 0.35, ribbon: 3.2, glow: 0.8 },
      undefined, (s, cx, cy) => {
        for (let i = 0; i < 3; i++) s.px(cx - 2 + i * 2, cy + 7 + i, P.ECHO_CYAN[2], 0.45);
      }),
  ];
  b.addStrip('enemy/wisp/shoot', shoot, { key: 'wisp_shoot', frameRate: 9, repeat: 0 });

  // hurt
  const h0 = wispFrame({ bob: 1, core: 4, bright: 1, splay: 0.5, ribbon: 2.0, glow: 1.4 });
  const h1 = wispFrame({ bob: 0, core: 3, bright: 0.7, splay: 0.2, ribbon: 2.6, glow: 1 });
  b.addStrip('enemy/wisp/hurt', [flashed(h0, 0.7), flashed(h1, 0.3, P.ECHO_RUNE)], {
    key: 'wisp_hurt', frameRate: 12, repeat: 0,
  });

  // die — the cap splits, the light climbs out and goes up
  const die: Surface[] = [flashed(wispFrame({ bob: 0, core: 4.2, bright: 1, splay: 0.6, glow: 1.6 }), 0.72)];
  for (let i = 1; i < 5; i++) {
    const t = i / 4;
    const out = new Surface(WI_W, WI_H);
    contact(out, WI_CX + 1, 22, Math.round(7 - t * 4), 3, 0.3 * (1 - t * 0.7));
    // cap shards falling away
    const shard = wispCap({ bob: 0, splay: 0.4 + t * 0.4 }, false);
    seal(shard, P.ECHO_RUNE, 0.25, false);
    const left = shard.sub(0, 0, WI_CX, WI_H);
    const right = shard.sub(WI_CX, 0, WI_W - WI_CX, WI_H);
    out.blit(left, -Math.round(t * 4), Math.round(t * 5), 1 - t * 0.5);
    out.blit(right, WI_CX + Math.round(t * 4), Math.round(t * 6), 1 - t * 0.5);
    // the light escaping upward
    const ly = 12 - t * 10;
    bloom(out, WI_CX, ly, 4 + t * 6, P.ECHO_CYAN[3], 0.75 * (1 - t * 0.3));
    bloom(out, WI_CX, ly, 2 + t * 2, P.ECHO_CYAN[4], 0.8 * (1 - t * 0.25));
    mote(out, WI_CX, Math.round(ly), 2, 1 - t * 0.25, true);
    mote(out, WI_CX - 3, Math.round(ly + 4), 1, 0.6 - t * 0.2, true);
    mote(out, WI_CX + 4, Math.round(ly + 3), 1, 0.5 - t * 0.15, true);
    for (let k = 0; k < 4; k++) {
      out.px(WI_CX + Math.round(Math.sin(t * 6 + k) * 2), Math.round(ly + 2 + k * 2), P.ECHO_RUNE, (0.6 - k * 0.12) * (1 - t * 0.3));
    }
    die.push(out);
  }
  b.addStrip('enemy/wisp/die', die, { key: 'wisp_die', frameRate: 9, repeat: 0 });

  // ── the projectile ──────────────────────────────────────────────────────
  // Must read on a bright grass field AND a dark shrine floor, so it carries
  // both a hard dark rim (for the bright case) and a white-hot core (dark case).
  const shots: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new Surface(10, 8);
    const cx = 6.5, cy = 3.5;
    // trail behind (sprite points +x, so the tail runs to -x)
    for (let k = 0; k < 5; k++) {
      const a = 0.5 - k * 0.09;
      const yy = cy + Math.sin(i * 1.6 + k * 0.8) * 0.8;
      s.px(4 - k, Math.round(yy), k < 2 ? P.ECHO_CYAN[3] : P.ECHO_CYAN[1], a);
      if (k < 3) s.px(4 - k, Math.round(yy) + 1, P.ECHO_CYAN[1], a * 0.55);
    }
    s.ellipse(4, 1, 5, 5, P.ECHO_CYAN[2]);
    s.ellipse(5, 2, 3, 3, P.ECHO_CYAN[4]);
    s.px(6, 3, P.ECHO_RUNE);
    s.px(5, 3, P.ECHO_RUNE);
    s.px(6, 2, P.ECHO_SPARK);
    // orbiting spark so the projectile is legible as *animated*
    const a2 = (i / 4) * Math.PI * 2;
    s.px(Math.round(6.5 + Math.cos(a2) * 2.6), Math.round(3.5 + Math.sin(a2) * 2.6), P.ECHO_RUNE);
    s.outline(P.OUTLINE, false);
    s.outline(A(P.ECHO_CYAN[3], 0.45), false);
    shots.push(s);
  }
  b.addStrip('enemy/wisp/shot', shots, { key: 'wisp_shot', frameRate: 12, repeat: -1 });
}

// ══════════════════════════════════════════════════════════════════════════
// 3. MIMICLING — copies the player's last direction, so it is deliberately
//    built on the player's own proportions: hood where the head is, cloak
//    where the coat is, same stance. The face is a blank mirror. You are
//    supposed to feel that it is wearing you.
// ══════════════════════════════════════════════════════════════════════════

const MI_W = 20, MI_H = 24, MI_CX = 10;

/** Half-widths of the figure, row by row. The hard step at y=10 is the neck:
 *  without that notch a hooded figure reads as a traffic cone. */
const MIMIC_HW: Array<[number, number]> = [
  [1, 2], [2, 3], [3, 4], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5],
  [9, 4], [10, 3],
  [11, 5], [12, 5], [13, 5], [14, 4], [15, 4], [16, 4],
  [17, 5], [18, 5], [19, 5], [20, 4],
];

interface MiPose {
  dir: Dir;
  bob?: number;
  lean?: number;     // horizontal shear of the cloak
  step?: number;     // -1 | 0 | 1 which foot leads
  face?: number;     // 0..1 face brightness (1 = copy flash)
  solid?: number;    // 0..1 how *present* it is; 1 = fully opaque
  hem?: number;      // hem wave phase
  crumble?: number;  // 0..1 death dissolve
}

function mimicBody(p: MiPose): Surface {
  const s = new Surface(MI_W, MI_H);
  const cx = MI_CX;
  const bob = p.bob ?? 0;
  const lean = p.lean ?? 0;
  const solid = p.solid ?? 0;

  // feet — small, dark, only just visible under the hem
  const step = p.step ?? 0;
  {
    const fy = 21 + bob;
    s.rect(cx - 4 + (step > 0 ? 1 : 0), fy - (step > 0 ? 1 : 0), 3, 2, P.MIMIC_SHADE[1]);
    s.rect(cx + 1 + (step < 0 ? -1 : 0), fy - (step < 0 ? 1 : 0), 3, 2, P.MIMIC_SHADE[0]);
  }

  // ── robe + cowl ─────────────────────────────────────────────────────────
  for (const [y, hw0] of MIMIC_HW) {
    const t = Math.max(0, (y - 11) / 9);
    const hw = hw0;
    const yy = y + bob;
    const shear = Math.round(lean * t * 2);
    for (let x = -hw; x <= hw; x++) {
      const col = x <= -hw + 1 ? P.MIMIC_SHADE[3] : x >= hw - 1 ? P.MIMIC_SHADE[0] : P.MIMIC_SHADE[2];
      s.px(cx + x + shear, yy, col);
    }
  }
  if (p.dir === 'e') {
    // the cowl overhangs forward, so the profile has a brow
    for (let y = 4; y <= 7; y++) s.px(cx + 6, y + bob, P.MIMIC_SHADE[1]);
    s.px(cx + 6, 8 + bob, P.MIMIC_SHADE[0]);
  }
  // torn hem
  const hemY = 20 + bob;
  const hemPhase = p.hem ?? 0;
  for (let x = -5; x <= 5; x++) {
    if ((x + Math.round(hemPhase)) % 3 === 0) s.px(cx + x + Math.round(lean * 2), hemY + 1, P.MIMIC_SHADE[1]);
  }

  // shoulders and hood get a lit upper-left edge; the robe falls into shadow
  volume(s, P.MIMIC_SHADE[4], P.MIMIC_SHADE[0], 0.55, 0.5);
  // the shoulder line catches light — it is what separates hood from body
  for (let x = -5; x <= 5; x++) s.pxOver(cx + x, 11 + bob, P.MIMIC_SHADE[4], 0.5);

  // a fold line down the cloak so the robe is not a flat field
  for (let y = 13 + bob; y <= 19 + bob; y++) {
    s.pxOver(cx - 1 + Math.round(lean * 1.5), y, P.MIMIC_SHADE[1], 0.7);
    s.pxOver(cx + 3 + Math.round(lean * 1.5), y, P.MIMIC_SHADE[1], 0.45);
  }

  // Translucency — only the cloak, and only lightly. Heavy dithering over the
  // whole figure destroys the silhouette; a hint under the shoulders is enough
  // to say "not entirely here".
  {
    const cloak = s.sub(0, 12 + bob, MI_W, MI_H - 12 - bob);
    ghost(cloak, 0.55 + solid * 0.45, bob);
    for (let y = 12 + bob; y < MI_H; y++) {
      for (let x = 0; x < MI_W; x++) {
        const i = (y * MI_W + x) * 4;
        s.data[i + 3] = cloak.alphaAt(x, y - 12 - bob);
      }
    }
  }

  // ── the blank mirror face ───────────────────────────────────────────────
  const fb = p.face ?? 0;
  if (p.dir === 's' || p.dir === 'e') {
    const fx0 = p.dir === 'e' ? cx : cx - 3;
    const fw = p.dir === 'e' ? 5 : 6;
    const fy0 = 4 + bob;
    s.ellipse(fx0, fy0, fw, 5, P.MIRROR[1]);
    s.ellipse(fx0, fy0, fw, 4, P.MIRROR[2]);
    // reflective gradient: light collects in the upper-left of the plate
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < fw; x++) {
        if (s.alphaAt(fx0 + x, fy0 + y) === 0) continue;
        const g = (x / fw) * 0.5 + (y / 5) * 0.5;
        s.px(fx0 + x, fy0 + y, g < 0.3 ? P.MIRROR[4] : g < 0.55 ? P.MIRROR[3] : g < 0.8 ? P.MIRROR[2] : P.MIRROR[1]);
      }
    }
    // the specular streak — the only thing that ever moves on the face
    const sx = fx0 + 1 + Math.round((p.hem ?? 0) * 0.4) % 2;
    s.px(sx, fy0 + 1, P.MIRROR[4]);
    s.px(sx + 1, fy0, P.MIRROR[4]);
    if (fb > 0) {
      s.ellipse(fx0, fy0, fw, 5, A(P.ECHO_RUNE, fb * 0.85));
      s.ellipse(fx0 + 1, fy0 + 1, fw - 2, 3, A(P.ECHO_SPARK, fb));
    }
    // recessed shadow under the brow of the hood
    for (let x = 0; x < fw; x++) s.px(fx0 + x, fy0 - 1, P.OUTLINE, 0.8);
  } else {
    // facing away: a cyan seam down the back of the hood
    for (let y = 3 + bob; y <= 10 + bob; y++) s.pxOver(cx, y, P.ECHO_CYAN[2], 0.35 + fb * 0.6);
    s.pxOver(cx, 3 + bob, P.ECHO_CYAN[4], 0.5 + fb * 0.5);
    for (let x = -4; x <= 4; x++) s.pxOver(cx + x, 9 + bob, P.MIMIC_SHADE[0], 0.55); // hood hem
  }

  if (p.crumble) {
    // dissolve from the hem upward
    const t = p.crumble;
    const r = rng(1717);
    for (let y = MI_H - 1; y >= 0; y--) {
      const d = (MI_H - y) / MI_H;
      for (let x = 0; x < MI_W; x++) {
        if (s.alphaAt(x, y) === 0) continue;
        if (r.next() < t * 1.5 - d * 0.6) {
          const i = (y * MI_W + x) * 4;
          s.data[i + 3] = 0;
        }
      }
    }
  }
  return s;
}

function mimicFrame(p: MiPose, fx?: (s: Surface) => void): Surface {
  const body = mimicBody(p);
  seal(body, p.face && p.face > 0.4 ? P.ECHO_RUNE : P.ECHO_GLOW, 0.34, false);
  const out = new Surface(MI_W, MI_H);
  contact(out, MI_CX, 22 + Math.round((p.bob ?? 0) * 0.3), 12, 4, 0.32);
  if (fx) fx(out);
  out.blit(body);
  return out;
}

function registerMimicling(b: ArtBuild) {
  const idle: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    idle.push(mimicFrame({
      dir: 's', bob: i === 1 ? -1 : 0, hem: i, lean: (i === 2 ? 0.3 : 0) - (i === 0 ? 0.2 : 0),
    }));
  }
  b.addStrip('enemy/mimicling/idle', idle, { key: 'mimicling_idle', frameRate: 4, repeat: -1 });

  // walk — six frames: contact, down, pass, contact, down, pass
  for (const dir of DIRS) {
    const f: Surface[] = [];
    const bobs = [0, 1, 0, 0, 1, 0];
    const steps = [1, 1, 0, -1, -1, 0];
    for (let i = 0; i < 6; i++) {
      f.push(mimicFrame({
        dir, bob: bobs[i], step: steps[i], hem: i,
        lean: dir === 'e' ? 0.5 : steps[i] * 0.35,
      }));
    }
    b.addStrip(`enemy/mimicling/walk_${dir}`, f, { key: `mimicling_walk_${dir}`, frameRate: 10, repeat: -1 });
  }

  // copy_flash — the player's proof that the copy mechanic just fired.
  // A ground ripple plus the mirror face going white-cyan.
  const flashFrames: Surface[] = [];
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    flashFrames.push(mimicFrame(
      { dir: 's', bob: i === 0 ? -1 : 0, face: 1 - t * 0.55, solid: 1 - t * 0.6, hem: i * 2 },
      (out) => {
        const r = 4 + t * 8;
        out.ellipseOutline(MI_CX - r, 22 - r * 0.4, r * 2, r * 0.8, A(P.ECHO_RUNE, 0.95 - t * 0.5));
        if (t > 0) out.ellipseOutline(MI_CX - r + 2, 22 - (r - 2) * 0.4, (r - 2) * 2, (r - 2) * 0.8, A(P.ECHO_CYAN[3], 0.6 - t * 0.35));
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + t;
          out.px(MI_CX + Math.cos(a) * (r + 1), 12 + Math.sin(a) * (r * 0.75), P.ECHO_RUNE, 0.8 - t * 0.5);
        }
      },
    ));
  }
  b.addStrip('enemy/mimicling/copy_flash', flashFrames, { key: 'mimicling_copy_flash', frameRate: 12, repeat: 0 });

  b.addStrip('enemy/mimicling/hurt', [
    flashed(mimicFrame({ dir: 's', bob: 1, solid: 1, lean: -0.6, hem: 2 }), 0.72),
    flashed(mimicFrame({ dir: 's', bob: 0, solid: 0.6, lean: -0.3, hem: 3 }), 0.3, P.ECHO_GLOW),
  ], { key: 'mimicling_hurt', frameRate: 12, repeat: 0 });

  // die — the copy comes apart into the dither it was always made of, the
  // mirror face cracks and drops, the borrowed light goes up.
  const die: Surface[] = [flashed(mimicFrame({ dir: 's', solid: 1, face: 0.5, lean: -0.4 }), 0.75)];
  for (let i = 1; i < 5; i++) {
    const t = i / 4;
    const out = new Surface(MI_W, MI_H);
    contact(out, MI_CX, 22, Math.round(12 - t * 7), 4, 0.32 * (1 - t * 0.7));
    const body = mimicBody({ dir: 's', bob: Math.round(t * 2), solid: 0.4, crumble: t * 0.75, hem: i * 2 });
    seal(body, P.ECHO_GLOW, 0.28, false);
    out.blit(body, 0, 0, 1 - t * 0.35);
    // the face plate falls and shatters
    const fyd = 7 + Math.round(t * 11);
    if (t < 0.9) {
      out.ellipse(MI_CX - 3, fyd, 6, 5 - Math.round(t * 2), A(P.MIRROR[2], 1 - t * 0.4));
      out.line(MI_CX - 2, fyd, MI_CX + 1, fyd + 3, A(P.OUTLINE, 0.8));
      out.line(MI_CX + 1, fyd, MI_CX - 1, fyd + 3, A(P.OUTLINE, 0.6));
      out.px(MI_CX - 2, fyd + 1, P.MIRROR[4], 1 - t * 0.5);
    }
    const rr = rng(3311);
    for (let k = 0; k < 6; k++) {
      out.px(MI_CX + rr.int(-7, 6), 10 + rr.int(0, 10) + Math.round(t * 3), P.MIRROR[3], (1 - t) * 0.8);
    }
    const ly = 10 - t * 9;
    bloom(out, MI_CX, ly, 3 + t * 4, P.ECHO_VIOLET[3], 0.55 * (1 - t * 0.3));
    mote(out, MI_CX, Math.round(ly), 2, 0.95 - t * 0.2);
    mote(out, MI_CX - 4, Math.round(ly + 4), 1, 0.6 - t * 0.2, true);
    die.push(out);
  }
  b.addStrip('enemy/mimicling/die', die, { key: 'mimicling_die', frameRate: 9, repeat: 0 });
}

// ══════════════════════════════════════════════════════════════════════════
// 4. ECHOMOTE — the followers. Their entire design brief is "identical".
//    No face, no limbs, no asymmetry: a smooth violet pawn with one cyan
//    slit. They only become individuals when one of them dissents, and that
//    is exactly the moment the art has to shout.
// ══════════════════════════════════════════════════════════════════════════

const EM_W = 18, EM_H = 18, EM_CX = 9, EM_GROUND = 14;

const EM_HW: Array<[number, number]> = [
  [3, 2], [4, 3], [5, 4], [6, 5], [7, 5], [8, 5],
  [9, 5], [10, 5], [11, 5], [12, 4], [13, 4], [14, 3],
];

interface EmPose {
  dir?: Dir;
  bob?: number;
  squash?: number;   // >1 = squat, <1 = stretched
  slit?: number;     // 0..1 slit brightness
  warm?: number;     // 0..1 blend toward DISSENT
  wobble?: number;   // 0..1 irregular outline (dissent only)
  tilt?: number;     // lean, px at the crown
  seed?: number;
}

function echomoteBody(p: EmPose): Surface {
  const s = new Surface(EM_W, EM_H);
  const bob = p.bob ?? 0;
  const sq = p.squash ?? 1;
  const warm = p.warm ?? 0;
  const wob = p.wobble ?? 0;
  const tilt = p.tilt ?? 0;
  const r = rng(p.seed ?? 31);
  const ramp = warm > 0.5 ? P.DISSENT : P.ECHO_DEEP;
  const lit = warm > 0.5 ? P.DISSENT[4] : P.ECHO_VIOLET[3];
  const dark = warm > 0.5 ? P.DISSENT[0] : P.ECHO_DEEP[0];

  for (const [y0, hw0] of EM_HW) {
    const t = (y0 - 3) / 11;
    const y = Math.round(EM_GROUND - (EM_GROUND - y0) * sq) + bob;
    let hw = hw0;
    if (wob) hw = Math.max(1, Math.round(hw0 + (r.next() - 0.4) * wob * 3.2));
    const shear = Math.round(tilt * (1 - t));
    for (let x = -hw; x <= hw; x++) {
      const col = x <= -hw + 1 ? ramp[3] : x >= hw - 1 ? ramp[0] : ramp[2];
      s.px(EM_CX + x + shear, y, col);
    }
  }
  // a second, softer mass so it does not read as a flat blob
  volume(s, lit, dark, 0.45, 0.5);
  const inner = new Surface(EM_W, EM_H);
  inner.ellipse(EM_CX - 4, 4 + bob, 6, 6, A(warm > 0.5 ? P.DISSENT[3] : P.ECHO_VIOLET[2], 0.5));
  s.blitInside(inner);

  // ── the slit: the only feature they have ────────────────────────────────
  const sb = p.slit ?? 0.55;
  const sy = 9 + bob;
  if (p.dir !== 'n') {
    const half = p.dir === 'e' ? 2 : 3;
    const ox = p.dir === 'e' ? 2 : 0;
    const col = sb > 0.85 ? P.ECHO_SPARK : sb > 0.5 ? P.ECHO_RUNE : P.ECHO_CYAN[3];
    if (wob > 0.3) {
      // A dissenter's slit breaks into a jagged crack. Drawn dark with a hot
      // edge so it still reads against the warm body it now sits on.
      const zig: Array<[number, number]> = [[-3, 0], [-2, 1], [-1, 0], [0, -1], [1, 0], [2, 1], [3, 0]];
      for (const [dx, dy] of zig) {
        s.px(EM_CX + dx + ox, sy + dy, P.OUTLINE);
        s.px(EM_CX + dx + ox, sy + dy - 1, P.DISSENT[4]);
      }
      bloom(s, EM_CX + ox, sy, 4, P.DISSENT[3], 0.45);
    } else {
      bloom(s, EM_CX + ox, sy, 3 + sb * 2, warm > 0.5 ? P.DISSENT[2] : P.ECHO_CYAN[2], 0.35 + sb * 0.4);
      for (let x = -half; x <= half; x++) s.px(EM_CX + x + ox, sy, col);
      if (sb > 0.8) for (let x = -half; x <= half; x++) s.px(EM_CX + x + ox, sy - 1, col);
    }
  } else {
    for (let x = -3; x <= 3; x++) s.pxOver(EM_CX + x, sy + 2, warm > 0.5 ? P.DISSENT[1] : P.ECHO_VIOLET[1], 0.5);
  }
  return s;
}

function echomoteFrame(p: EmPose, fx?: (s: Surface) => void): Surface {
  const body = echomoteBody(p);
  seal(body, (p.warm ?? 0) > 0.5 ? P.DISSENT[4] : P.ECHO_GLOW, 0.36, false);
  const out = new Surface(EM_W, EM_H);
  contact(out, EM_CX, EM_GROUND + 2, 11, 4, 0.32);
  if (fx) fx(out);
  out.blit(body);
  return out;
}

function registerEchomote(b: ArtBuild) {
  const idle: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    idle.push(echomoteFrame({
      bob: Math.round(Math.sin(a) * 1.2) - 1,
      squash: 1 + Math.sin(a + 1) * 0.06,
      slit: 0.5 + Math.sin(a) * 0.2,
    }));
  }
  b.addStrip('enemy/echomote/idle', idle, { key: 'echomote_idle', frameRate: 4, repeat: -1 });

  // walk — a hop-shuffle: squash, launch, float, land
  for (const dir of DIRS) {
    const f: Surface[] = [];
    const bobs = [0, -2, -3, -1];
    const sqs = [1.12, 0.92, 0.94, 1.06];
    for (let i = 0; i < 4; i++) {
      f.push(echomoteFrame({ dir, bob: bobs[i], squash: sqs[i], slit: 0.55, tilt: dir === 'e' ? 1 : 0 }));
    }
    b.addStrip(`enemy/echomote/walk_${dir}`, f, { key: `echomote_walk_${dir}`, frameRate: 8, repeat: -1 });
  }

  // sync_pulse — the group speaking with one voice. Charge, flash, ring.
  const sync = [
    echomoteFrame({ bob: 0, squash: 1.15, slit: 0.25 }),
    flashed(echomoteFrame({ bob: -2, squash: 0.9, slit: 1 }, (out) => {
      bloom(out, EM_CX, 9, 9, P.ECHO_CYAN[3], 0.55);
    }), 0.4, P.ECHO_RUNE),
    echomoteFrame({ bob: -1, squash: 1, slit: 0.7 }, (out) => {
      out.ellipseOutline(EM_CX - 8, EM_GROUND - 3, 16, 7, A(P.ECHO_RUNE, 0.75));
      out.ellipseOutline(EM_CX - 6, EM_GROUND - 2, 12, 5, A(P.ECHO_CYAN[3], 0.45));
    }),
  ];
  b.addStrip('enemy/echomote/sync_pulse', sync, { key: 'echomote_sync_pulse', frameRate: 10, repeat: 0 });

  // dissent — one of them stops agreeing. Violet → warm amber, smooth → ragged,
  // upright → tilted. Every channel the art has, pushed at once, because the
  // player must spot the odd one out instantly.
  const dis: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    dis.push(echomoteFrame({
      bob: i === 1 ? -2 : -1,
      squash: 1 + (i === 1 ? -0.1 : 0.05),
      warm: t > 0.25 ? 1 : 0,
      wobble: t * 0.9,
      tilt: Math.round(t * 2),
      slit: 0.8,
      seed: 31 + i * 7,
    }, (out) => {
      if (t > 0.3) {
        bloom(out, EM_CX, 9, 6 + t * 4, P.DISSENT[2], 0.35 * t);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + t * 2;
          out.px(EM_CX + Math.cos(a) * (7 + t * 3), 9 + Math.sin(a) * (6 + t * 2), P.DISSENT[4], 0.85 * t);
        }
      }
    }));
  }
  b.addStrip('enemy/echomote/dissent', dis, { key: 'echomote_dissent', frameRate: 8, repeat: 0 });

  b.addStrip('enemy/echomote/hurt', [
    flashed(echomoteFrame({ bob: 0, squash: 1.14, slit: 1 }), 0.72),
    flashed(echomoteFrame({ bob: -1, squash: 0.96, slit: 0.6 }), 0.3, P.ECHO_GLOW),
  ], { key: 'echomote_hurt', frameRate: 12, repeat: 0 });

  const die: Surface[] = [flashed(echomoteFrame({ bob: -1, squash: 1.08, slit: 1 }), 0.75)];
  for (let i = 1; i < 4; i++) {
    const t = i / 3;
    const out = new Surface(EM_W, EM_H);
    contact(out, EM_CX, EM_GROUND + 2, Math.round(11 - t * 6), 4, 0.32 * (1 - t * 0.7));
    const body = echomoteBody({ bob: Math.round(t * 2), squash: 1 - t * 0.55, slit: Math.max(0, 0.8 - t * 1.2), wobble: t * 0.5, seed: 77 });
    seal(body, P.ECHO_GLOW, 0.28, false);
    out.blit(body, 0, 0, 1 - t * 0.5);
    const ly = 9 - t * 8;
    bloom(out, EM_CX, ly, 3 + t * 4, P.ECHO_VIOLET[3], 0.55 * (1 - t * 0.3));
    mote(out, EM_CX, Math.round(ly), 2, 0.95 - t * 0.25, true);
    mote(out, EM_CX + 3, Math.round(ly + 3), 1, 0.55 - t * 0.2);
    die.push(out);
  }
  b.addStrip('enemy/echomote/die', die, { key: 'echomote_die', frameRate: 9, repeat: 0 });
}

// ══════════════════════════════════════════════════════════════════════════
// 5. THE ECHO — the boss.
//
//    It is not a big monster; it is a mass of *borrowed shapes*. The body is
//    built from metaballs so the silhouette can genuinely churn between
//    frames instead of being a static blob that bobs, and the things it has
//    stolen from the town (a cat's ears, a courier's cap, a lantern, a
//    statue's face, the bell) surface out of it in warm amber and sink again.
//    Amber is the colour of the town: seeing the town's colour trapped inside
//    the violet is the whole idea of the fight.
// ══════════════════════════════════════════════════════════════════════════

const EC_W = 64, EC_H = 72, EC_CX = 32, EC_GROUND = 66;

interface Ball { x: number; y: number; rx: number; ry: number; w?: number }

/** Metaball field. Inside where the sum exceeds 1; the value doubles as depth. */
function metafield(balls: Ball[], w: number, h: number): Float32Array {
  const f = new Float32Array(w * h);
  for (const b of balls) {
    const wt = b.w ?? 1;
    const x0 = Math.max(0, Math.floor(b.x - b.rx * 2.2));
    const x1 = Math.min(w - 1, Math.ceil(b.x + b.rx * 2.2));
    const y0 = Math.max(0, Math.floor(b.y - b.ry * 2.2));
    const y1 = Math.min(h - 1, Math.ceil(b.y + b.ry * 2.2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - b.x) / b.rx, dy = (y - b.y) / b.ry;
        const d2 = dx * dx + dy * dy;
        f[y * w + x] += wt / Math.max(0.08, d2);
      }
    }
  }
  return f;
}

interface EcPose {
  t: number;          // churn phase
  hard?: number;      // 0..1 the churn stills and the edges harden
  upright?: number;   // 0..1 phase-three statue posture
  lean?: number;
  slump?: number;     // 0..1 stagger collapse
  sink?: number;      // 0..1 death retreat (whole body descends into the floor)
  light?: number;     // 0..1 internal cyan brightness
  seed?: number;
}

function echoBalls(p: EcPose): Ball[] {
  const t = p.t;
  const up = p.upright ?? 0;
  const slump = p.slump ?? 0;
  const churn = (1 - (p.hard ?? 0)) * (1 - up * 0.65);
  const lean = (p.lean ?? 0) + slump * 5;
  const sag = slump * 6;
  return [
    { x: EC_CX + lean * 0.2, y: 56 + sag * 0.4, rx: 21 - up * 5 + slump * 4, ry: 11 - up + slump * 2 },
    { x: EC_CX + lean * 0.5, y: 42 + sag * 0.6, rx: 15 - up * 3, ry: 14 + up * 2 - slump * 3 },
    { x: EC_CX - 1 + lean + Math.sin(t) * churn * 2, y: 24 - up * 5 + sag, rx: 10 - up * 2, ry: 11 - slump * 2 },
    { x: 21 + lean * 0.6 + Math.sin(t * 1.3) * churn * 2.5, y: 34 + sag * 0.8, rx: 8 - up * 3, ry: 7, w: 0.85 },
    { x: 43 + lean * 0.6 + Math.cos(t * 1.1) * churn * 2.5, y: 34 + sag * 0.5, rx: 8 - up * 3, ry: 7, w: 0.85 },
    { x: EC_CX + Math.cos(t * 0.9) * 11 * churn + lean, y: 47 + Math.sin(t * 1.4) * 7 * churn, rx: 4 + 4 * churn, ry: 4 + 3 * churn, w: 0.6 },
    { x: EC_CX + Math.cos(t * 1.7 + 2) * 13 * churn + lean, y: 32 + Math.sin(t * 0.8 + 1) * 9 * churn, rx: 3 + 4 * churn, ry: 3 + 3 * churn, w: 0.55 },
    { x: EC_CX + Math.cos(t * 2.1 + 4) * 9 * churn + lean, y: 20 + Math.sin(t * 1.9 + 3) * 6 * churn, rx: 2 + 3.5 * churn, ry: 2 + 3 * churn, w: 0.45 },
  ];
}

// ── the stolen shapes ──────────────────────────────────────────────────────
type Stolen = 'cat' | 'cap' | 'lantern' | 'face' | 'bell';

/** Bas-relief of a remembered thing, lit from the upper-left like everything
 *  else, so it reads as pressing *out* of the mass rather than painted on. */
function stolenShape(kind: Stolen, x: number, y: number, scale = 1): Surface {
  const s = new Surface(EC_W, EC_H);
  const A0 = P.STOLEN_AMBER[0], A1 = P.STOLEN_AMBER[1], A3 = P.STOLEN_AMBER[3], A4 = P.STOLEN_AMBER[4];
  const k = (v: number) => Math.round(v * scale);
  if (kind === 'cat') {
    // ears + the top of a small head, with two slit eyes
    s.poly([[x - k(8), y], [x - k(6), y - k(8)], [x - k(2), y - k(1)]], A1);
    s.poly([[x + k(8), y], [x + k(6), y - k(8)], [x + k(2), y - k(1)]], A1);
    s.ellipse(x - k(9), y - k(2), k(18), k(13), A1);
    s.ellipseOutline(x - k(9), y - k(2), k(18), k(13), A3);
    s.line(x - k(8), y - k(7), x - k(6), y - k(1), A4);
    s.line(x + k(6), y - k(7), x + k(4), y - k(1), A3);
    for (const ex of [-k(5), k(3)]) {
      s.rect(x + ex, y + k(3), k(3), 1, P.OUTLINE);
      s.px(x + ex, y + k(2), A4);
    }
  } else if (kind === 'cap') {
    // a courier's peaked cap
    s.ellipse(x - k(8), y - k(7), k(16), k(11), A1);
    s.rect(x - k(8), y - k(2), k(16), k(3), A1);
    s.rect(x - k(13), y + k(1), k(13), k(2), A0);      // brim
    s.hline(x - k(13), y + k(1), k(13), A3);
    s.ellipseOutline(x - k(8), y - k(7), k(16), k(11), A3);
    s.line(x - k(6), y - k(6), x - k(1), y - k(7), A4);
  } else if (kind === 'lantern') {
    s.line(x - k(4), y - k(9), x, y - k(12), A3);       // bail
    s.line(x, y - k(12), x + k(4), y - k(9), A3);
    s.rect(x - k(6), y - k(9), k(12), k(2), A1);        // cap
    s.poly([[x - k(5), y - k(7)], [x + k(5), y - k(7)], [x + k(6), y + k(5)], [x - k(6), y + k(5)]], A0);
    s.rect(x - k(3), y - k(5), k(6), k(8), A4);         // the pane still alight
    s.rect(x - k(2), y - k(4), k(4), k(6), P.LANTERN[4]);
    s.rect(x - k(6), y + k(5), k(12), k(2), A1);
    s.vline(x - k(5), y - k(7), k(12), A3);
    s.vline(x + k(5), y - k(7), k(12), A0);
  } else if (kind === 'face') {
    // a shrine statue's blank mask
    s.ellipse(x - k(8), y - k(10), k(16), k(21), A1);
    s.ellipseOutline(x - k(8), y - k(10), k(16), k(21), A3);
    s.hline(x - k(6), y - k(4), k(12), A0);             // brow
    s.rect(x - k(5), y - k(3), k(4), k(3), P.OUTLINE);  // hollow eyes
    s.rect(x + k(1), y - k(3), k(4), k(3), P.OUTLINE);
    s.vline(x, y - k(2), k(5), A0);                     // nose
    s.hline(x - k(3), y + k(5), k(6), A0);              // mouth
    s.line(x - k(7), y - k(8), x - k(4), y - k(9), A4);
  } else {
    // the bell from the first quest
    s.poly([[x - k(8), y + k(6)], [x - k(6), y - k(4)], [x, y - k(8)], [x + k(6), y - k(4)], [x + k(8), y + k(6)]], A1);
    s.rect(x - k(9), y + k(6), k(18), k(2), A0);
    s.hline(x - k(9), y + k(6), k(18), A3);
    s.px(x, y + k(9), A4);
    s.px(x, y + k(10), A3);
    s.line(x - k(5), y - k(3), x - k(2), y - k(7), A4);
    s.px(x, y - k(9), A3);
  }
  return s;
}

interface StolenPlace { kind: Stolen; x: number; y: number; a: number; scale?: number }

function echoMass(p: EcPose, stolen: StolenPlace[] = []): Surface {
  const s = new Surface(EC_W, EC_H);
  const F = metafield(echoBalls(p), EC_W, EC_H);
  const n1 = valueNoise((p.seed ?? 5501));
  const n2 = valueNoise((p.seed ?? 5501) + 733);
  const light = p.light ?? 1;
  const hard = p.hard ?? 0;

  for (let y = 0; y < EC_H; y++) {
    for (let x = 0; x < EC_W; x++) {
      const v = F[y * EC_W + x];
      if (v < 1) continue;
      // depth shading: bright at the rim, near-black in the middle. A shadow
      // creature has to be *darkest* where it is thickest.
      let col: string;
      if (v < 1.3) col = P.ECHO_VIOLET[2];
      else if (v < 1.8) col = P.ECHO_DEEP[3];
      else if (v < 2.8) col = P.ECHO_DEEP[2];
      else if (v < 5) col = P.ECHO_DEEP[1];
      else col = P.ECHO_DEEP[0];
      s.px(x, y, col);

      if (v > 1.6) {
        // churning smoke inside the mass
        const c = n1(x, y - p.t * 4, 7) * 0.65 + n2(x + p.t * 2, y, 3.5) * 0.35;
        if (c > 0.72) s.px(x, y, P.ECHO_VIOLET[1], 0.55 * (1 - hard * 0.6));
        else if (c < 0.3) s.px(x, y, P.ECHO_DEEP[0], 0.5);
        // internal light, pooling around the heart
        const d = Math.hypot((x - EC_CX) / 15, (y - 44) / 16);
        if (d < 1) {
          const g = (1 - d) * light;
          const cc = n2(x, y - p.t * 6, 5);
          if (cc > 0.62 - g * 0.25) {
            s.px(x, y, cc > 0.8 ? P.ECHO_CYAN[3] : P.ECHO_CYAN[2], Math.min(0.9, g * 1.1));
          }
        }
      }
    }
  }

  // borrowed shapes, clipped to the mass
  for (const st of stolen) {
    const tmp = stolenShape(st.kind, st.x, st.y, st.scale ?? 1);
    const glow = new Surface(EC_W, EC_H);
    bloom(glow, st.x, st.y, 14 * (st.scale ?? 1), P.STOLEN_AMBER[1], 0.5 * st.a);
    s.blitInside(glow);
    s.blitInside(tmp, 0, 0, st.a);
  }

  // form light, then the hard silhouette
  s.innerShade(P.ECHO_DEEP[0], 0.5, [[0, 1], [1, 0]]);
  s.innerShade(P.ECHO_VIOLET[3], 0.5, [[0, -1], [-1, 0]]);
  if (hard > 0.5) {
    // hardened: the rim becomes a crisp bright line rather than a soft edge
    s.innerShade(P.ECHO_CYAN[4], 0.5 * hard, [[0, -1], [-1, 0]]);
  }
  return s;
}

/** Compose a boss frame: shadow, optional under-fx, the sealed mass, over-fx. */
function echoFrame(
  p: EcPose,
  stolen: StolenPlace[] = [],
  under?: (s: Surface) => void,
  over?: (s: Surface) => void,
  paint?: (s: Surface) => void,
): Surface {
  const mass = echoMass(p, stolen);
  if (paint) paint(mass);
  seal(mass, P.ECHO_GLOW, 0.42, false);
  const sink = p.sink ?? 0;
  if (sink > 0) {
    // erase everything below the floor line: it is going *into* the ground
    for (let y = EC_GROUND; y < EC_H; y++) {
      for (let x = 0; x < EC_W; x++) mass.data[(y * EC_W + x) * 4 + 3] = 0;
    }
  }
  const out = new Surface(EC_W, EC_H);
  contact(out, EC_CX + (p.lean ?? 0) * 0.3, EC_GROUND + 2, Math.round(46 - (p.upright ?? 0) * 12), 9, 0.34);
  if (under) under(out);
  out.blit(mass);
  if (over) over(out);
  return out;
}

/** The five things it took from the town, and where each one likes to surface. */
const STOLEN_CYCLE: Array<{ kind: Stolen; x: number; y: number; scale: number }> = [
  { kind: 'cat', x: 24, y: 30, scale: 0.85 },
  { kind: 'cap', x: 42, y: 36, scale: 0.85 },
  { kind: 'lantern', x: 26, y: 47, scale: 0.9 },
  { kind: 'face', x: 33, y: 26, scale: 0.9 },
  { kind: 'bell', x: 40, y: 50, scale: 0.85 },
];

/** Which shapes are visible on a given frame, and how far surfaced. */
function stolenAt(frame: number, total: number, count = 2): StolenPlace[] {
  const out: StolenPlace[] = [];
  for (let i = 0; i < STOLEN_CYCLE.length; i++) {
    const st = STOLEN_CYCLE[i];
    const phase = ((frame / total) + i / STOLEN_CYCLE.length) % 1;
    // surfaces over the first half of its phase, sinks over the second
    const a = Math.sin(phase * Math.PI) ** 2;
    if (a < 0.22) continue;
    out.push({ kind: st.kind, x: st.x, y: st.y - Math.round((phase - 0.5) * 6), a: Math.min(1, a * 1.15), scale: st.scale });
    if (out.length >= count) break;
  }
  return out;
}

function registerEcho(b: ArtBuild) {
  // ── idle: the body churns, borrowed shapes surface and sink ─────────────
  const idle: Surface[] = [];
  for (let i = 0; i < 6; i++) {
    idle.push(echoFrame({ t: i * 1.05, light: 0.85 + Math.sin(i) * 0.15 }, stolenAt(i, 6)));
  }
  b.addStrip('enemy/echo/idle', idle, { key: 'echo_idle', frameRate: 6, repeat: -1 });

  // ── phase 1, learning: an eye forms in the upper mass and tracks you ────
  const learn: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    learn.push(echoFrame({ t: 2 + i * 0.6, light: 0.7 }, stolenAt(i, 8, 1), undefined, undefined, (m) => {
      const ex = EC_CX - 1, ey = 25;
      const open = Math.min(1, 0.35 + t * 1.1);
      const w = Math.round(20 * open), h = Math.round(11 * open);
      const lid = new Surface(EC_W, EC_H);
      lid.ellipse(ex - w / 2, ey - h / 2, w, h, P.ECHO_CYAN[2]);
      lid.ellipse(ex - w / 2 + 2, ey - h / 2 + 1, w - 4, h - 2, P.ECHO_CYAN[3]);
      lid.ellipseOutline(ex - w / 2, ey - h / 2, w, h, P.ECHO_RUNE);
      // pupil, tracking left → right across the wind-up
      const px = Math.round(ex - 4 + t * 8);
      lid.ellipse(px - 2, ey - 3, 5, 7, P.ECHO_DEEP[0]);
      lid.px(px, ey - 2, P.ECHO_SPARK);
      m.blitInside(lid);
      const gl = new Surface(EC_W, EC_H);
      bloom(gl, ex, ey, 16, P.ECHO_CYAN[2], 0.45);
      m.blitInside(gl);
      // study lines: it is measuring you
      for (let k = 0; k < 3; k++) {
        const yy = ey + 12 + k * 5;
        m.hline(EC_CX - 12 + k * 3, yy, Math.round(8 + t * 10), P.ECHO_CYAN[3], 0.35 + t * 0.3);
      }
    }));
  }
  b.addStrip('enemy/echo/phase1_learn', learn, { key: 'echo_phase1_learn', frameRate: 6, repeat: 0 });

  // ── phase 1, countering: it already knows, and the mass sets like stone ──
  const counter: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const hard = Math.min(1, 0.35 + t);
    counter.push(echoFrame({ t: 6 + i * 0.3, hard, light: 0.5 }, stolenAt(i + 2, 8, 1), undefined,
      (out) => {
        if (t > 0.5) for (let k = 0; k < 5; k++) {
          const a = -1.9 + k * 0.45;
          out.px(EC_CX + Math.cos(a) * 30, 44 + Math.sin(a) * 26, P.ECHO_CYAN[4], 0.8);
          out.px(EC_CX + Math.cos(a) * 32, 44 + Math.sin(a) * 28, P.ECHO_RUNE, 0.5);
        }
      },
      (m) => {
        // a faceted plate hardens across the front
        const w = Math.round(16 + t * 20), h = Math.round(20 + t * 20);
        const cx = EC_CX, cy = 42;
        const sh = new Surface(EC_W, EC_H);
        const pts: Array<[number, number]> = [
          [cx - w / 2, cy - h / 4], [cx - w / 4, cy - h / 2], [cx + w / 4, cy - h / 2],
          [cx + w / 2, cy - h / 4], [cx + w / 2, cy + h / 4], [cx, cy + h / 2], [cx - w / 2, cy + h / 4],
        ];
        sh.poly(pts, P.ECHO_VIOLET[1]);
        for (let i2 = 0; i2 < pts.length; i2++) {
          const a2 = pts[i2], b2 = pts[(i2 + 1) % pts.length];
          sh.line(a2[0], a2[1], b2[0], b2[1], i2 < 3 ? P.ECHO_CYAN[4] : P.ECHO_VIOLET[3]);
        }
        // facets
        sh.line(cx, cy - h / 2, cx, cy + h / 2, A(P.ECHO_VIOLET[3], 0.6));
        sh.line(cx - w / 2, cy - h / 4, cx, cy + h / 2, A(P.ECHO_VIOLET[0], 0.6));
        sh.line(cx + w / 2, cy - h / 4, cx, cy + h / 2, A(P.ECHO_VIOLET[0], 0.6));
        m.blitInside(sh, 0, 0, 0.55 + t * 0.45);
      }));
  }
  b.addStrip('enemy/echo/phase1_counter', counter, { key: 'echo_phase1_counter', frameRate: 6, repeat: 0 });

  // ── phase 2: it fragments into overlapping after-images ─────────────────
  const split: Surface[] = [];
  for (let i = 0; i < 6; i++) {
    const t = Math.sin((i / 5) * Math.PI); // separate, then recombine
    const off = Math.round(t * 9);
    split.push(echoFrame({ t: 3 + i * 0.8, light: 0.9 }, stolenAt(i, 6, 1), (out) => {
      // trailing copy (stale, violet) and leading copy (live, cyan)
      const ghostA = echoMass({ t: 3 + i * 0.8 - 1.2, light: 0.4 }, []);
      ghostA.tint(P.ECHO_PALE[2], 0.55);
      ghost(ghostA, 0.5, 0);
      out.blit(ghostA, -off, Math.round(t * 2), 0.6);
      const ghostB = echoMass({ t: 3 + i * 0.8 + 1.2, light: 0.6 }, []);
      ghostB.tint(P.ECHO_CYAN[3], 0.45);
      ghost(ghostB, 0.55, 1);
      out.blit(ghostB, off, -Math.round(t * 2), 0.6);
    }));
  }
  b.addStrip('enemy/echo/phase2_split', split, { key: 'echo_phase2_split', frameRate: 8, repeat: -1 });

  // ── phase 3: it stands up as the leader the little ones copy ────────────
  const lead: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    lead.push(echoFrame({ t: 1 + i * 0.25, upright: 1, hard: 0.75, light: 0.75 + t * 0.25 },
      stolenAt(i, 8, 1),
      (out) => {
        // the command pulse the followers copy, rolling out along the floor
        const r = 8 + t * 24;
        out.ellipseOutline(EC_CX - r, EC_GROUND - r * 0.22, r * 2, r * 0.44, A(P.ECHO_RUNE, 0.75 - t * 0.4));
        if (t > 0.3) {
          const r2 = r - 8;
          out.ellipseOutline(EC_CX - r2, EC_GROUND - r2 * 0.22, r2 * 2, r2 * 0.44, A(P.ECHO_CYAN[3], 0.5 - t * 0.25));
        }
      },
      undefined,
      (m) => {
        // a crown of light, and vertical bands: statue, not creature
        for (let k = -3; k <= 3; k++) {
          const h = 6 - Math.abs(k) * 1.2;
          for (let y = 0; y < h; y++) m.px(EC_CX + k * 3, 14 - y, y > h - 2 ? P.ECHO_RUNE : P.ECHO_CYAN[3], 0.9);
        }
        const bands = new Surface(EC_W, EC_H);
        for (let k = -2; k <= 2; k++) {
          bands.vline(EC_CX + k * 5, 26, 30, A(P.ECHO_CYAN[2], 0.4 + (k === 0 ? 0.3 : 0)));
        }
        m.blitInside(bands);
      }));
  }
  b.addStrip('enemy/echo/phase3_lead', lead, { key: 'echo_phase3_lead', frameRate: 5, repeat: -1 });

  // ── stagger: vulnerable. The shape gives up and the light gets out ──────
  const stagger: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    stagger.push(echoFrame({ t: 8 + i * 0.9, slump: 0.5 + t * 0.5, lean: -3 - t * 3, light: 1.4 },
      stolenAt(i, 4, 2), undefined,
      (out) => {
        // light leaking out of the cracks in beams
        for (let k = 0; k < 5; k++) {
          const a = -2.5 + k * 0.5 + t * 0.3;
          const x0 = EC_CX - 4 + Math.cos(a) * 10, y0 = 40 + Math.sin(a) * 10;
          for (let d = 0; d < 10 + t * 8; d++) {
            out.px(x0 + Math.cos(a) * d, y0 + Math.sin(a) * d, d < 4 ? P.ECHO_SPARK : P.ECHO_CYAN[3], (0.75 - d * 0.05) * (0.5 + t));
          }
        }
        for (let k = 0; k < 4; k++) mote(out, 18 + k * 9, 20 - Math.round(t * 8) + (k % 2) * 5, 1, 0.5 * t, true);
      },
      (m) => {
        // cracks
        const cr = new Surface(EC_W, EC_H);
        for (let k = 0; k < 4; k++) {
          let x = EC_CX - 6 + k * 5, y = 30 + k * 3;
          for (let seg = 0; seg < 5; seg++) {
            const nx = x + (k % 2 ? 3 : -3), ny = y + 4;
            cr.line(x, y, nx, ny, P.ECHO_RUNE);
            cr.line(x + 1, y, nx + 1, ny, A(P.ECHO_CYAN[2], 0.6));
            x = nx; y = ny;
          }
        }
        m.blitInside(cr, 0, 0, 0.55 + t * 0.45);
      }));
  }
  b.addStrip('enemy/echo/stagger', stagger, { key: 'echo_stagger', frameRate: 6, repeat: -1 });

  b.addStrip('enemy/echo/hurt', [
    flashed(echoFrame({ t: 4, light: 1.5, lean: 2 }, stolenAt(1, 6, 2)), 0.62),
    flashed(echoFrame({ t: 4.6, light: 1.2, lean: 1 }, stolenAt(2, 6, 1)), 0.28, P.ECHO_GLOW),
  ], { key: 'echo_hurt', frameRate: 12, repeat: 0 });

  // ── die: ten frames. It does not explode. It lets go of the town, piece
  //    by piece, and retreats downward. ─────────────────────────────────────
  const die: Surface[] = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const sink = Math.max(0, (t - 0.15) / 0.85) ** 1.4;
    const drop = Math.round(sink * 34);
    // the borrowed shapes fall away one at a time
    const held: StolenPlace[] = [];
    const falling: StolenPlace[] = [];
    STOLEN_CYCLE.forEach((st, k) => {
      const release = 0.12 + k * 0.14;
      if (t < release) {
        held.push({ ...st, y: st.y + drop, a: 0.75 });
      } else {
        const ft = Math.min(1, (t - release) * 3.2);
        falling.push({ ...st, y: st.y + Math.round(ft * 26), x: st.x + Math.round((k % 2 ? 1 : -1) * ft * 9), a: 1 - ft });
      }
    });

    const frame = echoFrame(
      {
        t: 10 + i * 0.7,
        slump: Math.min(1, t * 1.3),
        lean: -2,
        light: Math.max(0.1, 1.2 - t * 1.3),
        sink: sink,
        seed: 5501,
      },
      held,
      (out) => {
        // a violet stain spreading on the floor as it goes down
        out.ellipse(EC_CX - 22, EC_GROUND - 3, 44, 10, A(P.ECHO_VIOLET[0], 0.4 * t));
      },
      (out) => {
        for (const f of falling) {
          const sh = stolenShape(f.kind, f.x, f.y, (f.scale ?? 1) * 0.85);
          sh.outline(A(P.OUTLINE, 0.8), false);
          out.blit(sh, 0, 0, Math.max(0, f.a));
        }
        if (t > 0.55) {
          // the last of the light, sinking
          const ly = 44 + Math.round((t - 0.55) * 50);
          if (ly < EC_GROUND) {
            bloom(out, EC_CX, ly, 10 * (1 - t), P.ECHO_CYAN[2], 0.8 * (1 - t));
            mote(out, EC_CX, ly, 2, 1 - t, true);
          }
        }
        if (t > 0.8) {
          for (let k = 0; k < 5; k++) {
            mote(out, 20 + k * 6, EC_GROUND - 4 - k % 2 * 3, 0, (t - 0.8) * 2 * (1 - t) * 3, k % 2 === 0);
          }
        }
      },
    );
    // sink the whole body into the floor
    const out = new Surface(EC_W, EC_H);
    out.blit(frame, 0, drop);
    // re-erase below the floor after the shift
    for (let y = EC_GROUND + 3; y < EC_H; y++) {
      for (let x = 0; x < EC_W; x++) out.data[(y * EC_W + x) * 4 + 3] = 0;
    }
    die.push(i === 0 ? flashed(out, 0.5) : out);
  }
  b.addStrip('enemy/echo/die', die, { key: 'echo_die', frameRate: 7, repeat: 0 });

  registerEchoTells(b);
}

// ── attack telegraphs and the phase-two indicators ─────────────────────────

function registerEchoTells(b: ArtBuild) {
  // SLAM: a ground circle that fills. Four frames = four beats of warning.
  const slam: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const s = new Surface(48, 30);
    const cx = 24, cy = 15;
    const rx = 22, ry = 12;
    s.ellipse(cx - rx, cy - ry, rx * 2, ry * 2, A(P.ECHO_VIOLET[1], 0.2 + t * 0.35));
    // the filling disc
    const fr = t * rx;
    if (fr > 1) {
      s.ellipse(cx - fr, cy - fr * (ry / rx), fr * 2, fr * 2 * (ry / rx), A(P.ECHO_CYAN[2], 0.35 + t * 0.4));
      s.ellipseOutline(cx - fr, cy - fr * (ry / rx), fr * 2, fr * 2 * (ry / rx), A(P.ECHO_RUNE, 0.9));
    }
    s.ellipseOutline(cx - rx, cy - ry, rx * 2, ry * 2, P.ECHO_RUNE);
    s.ellipseOutline(cx - rx + 1, cy - ry + 1, rx * 2 - 2, ry * 2 - 2, A(P.OUTLINE, 0.7));
    // inward ticks
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const len = 2 + t * 3;
      for (let d = 0; d < len; d++) {
        s.px(cx + Math.cos(a) * (rx - 1 - d), cy + Math.sin(a) * (ry - 1 - d * (ry / rx)), P.ECHO_CYAN[4], 0.9 - d * 0.15);
      }
    }
    if (t > 0.9) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        s.px(cx + Math.cos(a) * (rx + 2), cy + Math.sin(a) * (ry + 2), P.ECHO_SPARK, 0.9);
      }
    }
    slam.push(s);
  }
  b.addStrip('enemy/echo/tell_slam', slam, { key: 'echo_tell_slam', frameRate: 8, repeat: 0 });

  // SWEEP: an arc that sharpens into a blade travelling left → right.
  const sweep: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const s = new Surface(64, 34);
    const cx = 32, cy = 40, R = 30;
    for (let k = 0; k <= 46; k++) {
      const a = Math.PI + 0.55 + (k / 46) * (Math.PI - 1.1);
      const lead = k / 46;
      const on = lead <= t + 0.28;
      if (!on) continue;
      const near = Math.abs(lead - t) < 0.16;
      const thick = near ? 3 : 1 + Math.round(t * 1.5);
      for (let d = 0; d < thick; d++) {
        const rr = R - d;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.86;
        s.px(x, y, near ? P.ECHO_SPARK : d === 0 ? P.ECHO_RUNE : P.ECHO_CYAN[3], near ? 1 : 0.55 + t * 0.35);
        s.px(x, y + 1, P.OUTLINE, 0.55);
      }
    }
    sweep.push(s);
  }
  b.addStrip('enemy/echo/tell_sweep', sweep, { key: 'echo_tell_sweep', frameRate: 8, repeat: 0 });

  // AFTER-IMAGES: ghosts of the boss body drifting through the arena.
  const after: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const m = echoMass({ t: 2 + i * 1.4, light: 0.5 }, []);
    m.tint(P.ECHO_PALE[3], 0.6);
    ghost(m, 0.45, i);
    m.outline(A(P.ECHO_PALE[4], 0.5), false);
    const out = new Surface(EC_W, EC_H);
    out.blit(m, 0, 0, 0.75 - t * 0.25);
    after.push(out);
  }
  b.addStrip('enemy/echo/afterimage', after, { key: 'echo_afterimage', frameRate: 8, repeat: -1 });

  // ── the phase-two reading test ──────────────────────────────────────────
  // LIVE and STALE are the same marker drawn two completely different ways.
  // Live: saturated cyan, hard 1px edge, opaque, filling. Stale: desaturated
  // violet, dithered edge, translucent, dissolving. If a player ever has to
  // squint at these, the fight is unfair.
  const live: Surface[] = [];
  const stale: Surface[] = [];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    // LIVE
    {
      const s = new Surface(34, 22);
      const cx = 17, cy = 11, rx = 15, ry = 9;
      s.ellipse(cx - rx, cy - ry, rx * 2, ry * 2, A(P.ECHO_CYAN[1], 0.55));
      const fr = 0.35 + t * 0.65;
      s.ellipse(cx - rx * fr, cy - ry * fr, rx * 2 * fr, ry * 2 * fr, A(P.ECHO_CYAN[3], 0.85));
      s.ellipseOutline(cx - rx, cy - ry, rx * 2, ry * 2, P.ECHO_RUNE);
      s.ellipseOutline(cx - rx + 1, cy - ry + 1, rx * 2 - 2, ry * 2 - 2, P.ECHO_CYAN[4]);
      // hard outer edge for readability on any floor
      s.outline(P.OUTLINE, false);
      // a crisp sigil in the middle: four blades pointing in
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        for (let d = 0; d < 4; d++) {
          s.px(cx + Math.cos(a) * (2 + d), cy + Math.sin(a) * (2 + d) * 0.62, d < 2 ? P.ECHO_SPARK : P.ECHO_RUNE);
        }
      }
      s.px(cx, cy, P.ECHO_SPARK);
      live.push(s);
    }
    // STALE
    {
      const s = new Surface(34, 22);
      const cx = 17, cy = 11, rx = 15, ry = 9;
      const body = new Surface(34, 22);
      body.ellipse(cx - rx, cy - ry, rx * 2, ry * 2, A(P.ECHO_PALE[1], 0.5));
      body.ellipseOutline(cx - rx, cy - ry, rx * 2, ry * 2, A(P.ECHO_PALE[3], 0.8));
      // doubled, offset ghost edge — it does not know where it is any more
      body.ellipseOutline(cx - rx + 1 + Math.round(t), cy - ry - 1, rx * 2 - 2, ry * 2 + 1, A(P.ECHO_PALE[2], 0.45));
      body.ellipseOutline(cx - rx - 1, cy - ry + 1 - Math.round(t), rx * 2 + 2, ry * 2, A(P.ECHO_PALE[2], 0.3));
      ghost(body, 0.42, i);
      s.blit(body, 0, 0, 0.8 - t * 0.35);
      // a smeared, unreadable sigil
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4 + t;
        s.px(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4 * 0.62, P.ECHO_PALE[4], 0.5 - t * 0.2);
      }
      stale.push(s);
    }
  }
  b.addStrip('enemy/echo/indicator_live', live, { key: 'echo_indicator_live', frameRate: 10, repeat: -1 });
  b.addStrip('enemy/echo/indicator_stale', stale, { key: 'echo_indicator_stale', frameRate: 6, repeat: -1 });
}

// ══════════════════════════════════════════════════════════════════════════

export function registerEnemies(b: ArtBuild): void {
  registerBramble(b);
  registerWisp(b);
  registerMimicling(b);
  registerEchomote(b);
  registerEcho(b);
}
