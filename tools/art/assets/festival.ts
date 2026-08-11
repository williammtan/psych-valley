/**
 * FESTIVAL OF LANTERNS — Lumen Vale's plaza in its transformed state (Act IV).
 *
 * The plaza is not "the plaza plus a banner". Every asset here exists to make
 * the player feel the town has changed: strung light, canvas, colour, smoke,
 * crowd furniture, and one unmistakable centrepiece — the Lantern Trial stage.
 *
 * House rules, same as the rest of the game:
 *   - light from the upper-left, EXCEPT on objects that are themselves lights,
 *     which are lit from their own core outward
 *   - scenery is rimmed on its lower and right edges only
 *   - every prop sits on a squashed contact shadow
 *   - anything that glows carries a soft baked halo behind it plus a clean
 *     bright core; the runtime's real light lands on top of that
 *
 * Shape language: Lumen Vale's motif is the lantern — an iron cap, a warm
 * paper body, a hook. Everything ceremonial here repeats that silhouette.
 */
import { Surface, rng, valueNoise, speckle, type Rng } from '../lib/pixel.js';
import { ArtBuild, TILE } from '../lib/registry.js';
import { registerBlobSet } from '../lib/autotile.js';
import * as P from '../lib/palette.js';

type Ramp = readonly string[];

// ── shared drawing helpers ─────────────────────────────────────────────────

/** Squashed contact shadow, painted *behind* whatever is already on the surface. */
function contact(
  s: Surface, cx: number, baseY: number, w: number,
  h = Math.max(3, Math.round(w * 0.3)), alpha = 0.3,
) {
  const sh = new Surface(s.w, s.h);
  sh.ellipse(Math.round(cx - w / 2), Math.round(baseY - h + 1), w, h, P.OUTLINE, alpha);
  s.blitBehind(sh);
}

/** Dark rim on the lower and right edges only. */
function rim(s: Surface, color = P.OUTLINE, alpha = 1): Surface {
  const src = s.clone();
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (src.alphaAt(i, j) !== 0) continue;
      if (src.alphaAt(i, j - 1) > 128 || src.alphaAt(i - 1, j) > 128) s.px(i, j, color, alpha);
    }
  }
  return s;
}

/**
 * Soft baked halo, drawn only where the sprite is still transparent. Falls to
 * zero well before the canvas edge so nothing gets a visible hard cut.
 */
function glow(
  s: Surface, cx: number, cy: number, radius: number, color: string,
  strength = 1, power = 2.3, squash = 1,
) {
  if (strength <= 0 || radius <= 0) return;
  const g = new Surface(s.w, s.h);
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(s.w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius * squash));
  const y1 = Math.min(s.h - 1, Math.ceil(cy + radius * squash));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot((x - cx) / radius, (y - cy) / (radius * squash));
      if (d >= 1) continue;
      const a = Math.pow(1 - d, power) * strength;
      if (a < 0.025) continue;
      g.px(x, y, color, Math.min(0.8, a));
    }
  }
  s.blitBehind(g);
}

/** Paint every pixel of `mask` through a colour function. */
function fillMask(s: Surface, mask: Surface, fn: (x: number, y: number) => string | null, alpha = 1) {
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (!mask.alphaAt(x, y)) continue;
      const c = fn(x, y);
      if (c) s.px(x, y, c, alpha);
    }
  }
}

/**
 * Lit paper: brightness radiates from the flame inside, so the ramp runs
 * outward from the core rather than down-right from a sun. A small ambient
 * tilt keeps the upper-left marginally warmer so it still agrees with the
 * rest of the scene.
 */
function paperShade(
  s: Surface, mask: Surface, ramp: Ramp,
  lx: number, ly: number, rx: number, ry: number, lit = 1,
) {
  fillMask(s, mask, (x, y) => {
    const d = Math.hypot((x - lx) / rx, (y - ly) / ry);
    const tilt = (lx - x) * 0.008 + (ly - y) * 0.006;
    const t = ((1 - d) + tilt) * lit;
    if (t > 0.82) return ramp[4];
    if (t > 0.58) return ramp[3];
    if (t > 0.33) return ramp[2];
    if (t > 0.10) return ramp[1];
    return ramp[0];
  });
}

/** Unlit paper / cloth: plain upper-left directional shading. */
function dirShade(
  s: Surface, mask: Surface, ramp: Ramp, cx: number, cy: number,
  kx = 0.045, ky = 0.05, bias = 0.5,
) {
  fillMask(s, mask, (x, y) => {
    const v = bias + (cx - x) * kx + (cy - y) * ky;
    if (v > 0.86) return ramp[4];
    if (v > 0.62) return ramp[3];
    if (v > 0.40) return ramp[2];
    if (v > 0.20) return ramp[1];
    return ramp[0];
  });
}

/** A 3/4 cylinder: elliptical lid, banded body, rounded bottom. */
function cylinder(
  s: Surface, x: number, y: number, w: number, h: number, capH: number, ramp: Ramp,
  opts: { lid?: boolean; lidRamp?: Ramp } = {},
) {
  const bodyTop = y + Math.floor(capH / 2);
  const bodyBot = y + h - Math.floor(capH / 2);
  s.ellipse(x, y + h - capH, w, capH, ramp[2]);
  for (let j = bodyTop; j < bodyBot; j++) {
    for (let i = 0; i < w; i++) {
      const u = i / Math.max(1, w - 1);
      let c: string;
      if (u < 0.10) c = ramp[1];
      else if (u < 0.28) c = ramp[3];
      else if (u < 0.40) c = ramp[4];
      else if (u < 0.70) c = ramp[2];
      else if (u < 0.87) c = ramp[1];
      else c = ramp[0];
      s.px(x + i, j, c);
    }
  }
  // round the bottom by re-shading the bottom ellipse with the same bands
  for (let j = 0; j < capH; j++) {
    for (let i = 0; i < w; i++) {
      const px = x + i, py = y + h - capH + j;
      if (s.alphaAt(px, py) === 0) continue;
      const u = i / Math.max(1, w - 1);
      const c = u < 0.28 ? ramp[2] : u < 0.70 ? ramp[1] : ramp[0];
      s.px(px, py, c);
    }
  }
  if (opts.lid !== false) {
    const lr = opts.lidRamp ?? ramp;
    s.ellipse(x, y, w, capH, lr[3]);
    for (let j = 0; j < capH; j++) {
      for (let i = 0; i < w; i++) {
        const px = x + i, py = y + j;
        if (s.alphaAt(px, py) === 0) continue;
        const u = i / Math.max(1, w - 1), v = j / Math.max(1, capH - 1);
        const t = (1 - u) * 0.55 + (1 - v) * 0.45;
        s.px(px, py, t > 0.72 ? lr[4] : t > 0.46 ? lr[3] : t > 0.26 ? lr[2] : lr[1]);
      }
    }
  }
}

/** Wood grain over an existing rect: broken striations plus two knots. */
function grain(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number, horizontal = true) {
  const n = valueNoise(seed);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (s.alphaAt(x + i, y + j) === 0) continue;
      const v = horizontal ? n(i, j * 3, 4.0) : n(i * 3, j, 4.0);
      if (v > 0.72) s.px(x + i, y + j, ramp[0], 0.30);
      else if (v < 0.26) s.px(x + i, y + j, ramp[4], 0.22);
    }
  }
}

/** A plank run — the timber vocabulary shared by the stage, stalls and carts. */
function planks(
  s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number,
  step = 4, horizontal = true,
) {
  s.rect(x, y, w, h, ramp[2]);
  if (horizontal) {
    for (let j = 0; j < h; j += step) {
      s.hline(x, y + j, w, ramp[3], 0.8);
      s.hline(x, y + j + step - 1, w, ramp[0], 0.55);
    }
  } else {
    for (let i = 0; i < w; i += step) {
      s.vline(x + i, y, h, ramp[3], 0.8);
      s.vline(x + i + step - 1, y, h, ramp[0], 0.55);
    }
  }
  grain(s, x, y, w, h, ramp, seed, horizontal);
}

/** Shear a hanging thing about a pivot row — a one-frame pendulum. */
function shearHang(src: Surface, pivotY: number, amount: number): Surface {
  if (amount === 0) return src;
  const out = new Surface(src.w, src.h);
  const span = Math.max(1, src.h - pivotY);
  for (let y = 0; y < src.h; y++) {
    const t = Math.max(0, y - pivotY) / span;
    const dx = Math.round(amount * t);
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (c[3]) out.px(x + dx, y, c);
    }
  }
  return out;
}

/** Iron hardware: a slim vertical post with a lit left edge. */
function ironPost(s: Surface, x: number, top: number, bottom: number, w = 3, ramp: Ramp = P.IRON) {
  for (let y = top; y <= bottom; y++) {
    for (let i = 0; i < w; i++) {
      const u = i / Math.max(1, w - 1);
      s.px(x + i, y, u < 0.34 ? ramp[4] : u < 0.7 ? ramp[2] : ramp[0]);
    }
  }
}

/** Ripple marks that read as an emitted tone. Drawn to the object's right. */
function toneRipple(s: Surface, cx: number, cy: number, r: number, color: string, alpha: number) {
  for (let a = -0.85; a <= 0.85; a += 0.09) {
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r * 1.05);
    if (((y + x) & 1) === 0) continue; // dashed, so it reads as sound not a shell
    s.px(x, y, color, alpha);
  }
}

/** Tiny four-point sparkle. */
function spark(s: Surface, x: number, y: number, color: string, alpha = 1, big = false) {
  s.px(x, y, color, alpha);
  s.px(x - 1, y, color, alpha * 0.6);
  s.px(x + 1, y, color, alpha * 0.6);
  s.px(x, y - 1, color, alpha * 0.6);
  s.px(x, y + 1, color, alpha * 0.6);
  if (big) {
    s.px(x - 2, y, color, alpha * 0.3);
    s.px(x + 2, y, color, alpha * 0.3);
    s.px(x, y - 2, color, alpha * 0.3);
    s.px(x, y + 2, color, alpha * 0.3);
  }
}

// ── the Lantern Trial lanterns ─────────────────────────────────────────────
//
// Three ceremonial lanterns the player must tell apart in one glance, in dim
// light, from across the plaza. They are separated on four axes at once:
//
//   shape   round paper globe / tall hexagonal tower / wide squat bell
//   colour  amber (tone A) / rose (tone B) / sea-green (tone C)
//   mount   post-and-cup / standing on its own feet / slung from a hook arm
//   motion  the struck globe rocks in its cup, the tower tips on its foot,
//           the bell swings from the hook — so even the animation identifies it
//
// The footing carries a painted glyph in the lantern's colour, which survives
// when the lantern is unlit and gives dialogue something to point at.

interface LampState {
  /** 0 = unlit, 1 = normal, >1 = struck / blooming */
  lit: number;
  /** rock / swing / tip amplitude in pixels */
  swing: number;
  /** halo radius + strength multiplier */
  halo: number;
  /** emitted tone ripple radius, 0 = none */
  ripple: number;
  /** confirming sparkle strength, 0 = none */
  bloom: number;
}

const REST: LampState = { lit: 1, swing: 0, halo: 1, ripple: 0, bloom: 0 };
const DIM: LampState = { lit: 0, swing: 0, halo: 0, ripple: 0, bloom: 0 };

/** Unlit paper still remembers which lantern it belongs to. */
function dimPaper(colour: string): Ramp {
  return P.PAPER_DIM.map((c) => P.mix(c, colour, 0.24));
}

type Glyph = 'circle' | 'chevron' | 'wave' | 'star';

/** Paint the trial glyph on the front face of a footing. */
function trialGlyph(s: Surface, cx: number, cy: number, g: Glyph, colour: string, shadow: string) {
  const put = (x: number, y: number, a = 1) => { s.pxOver(cx + x, cy + y, colour, a); };
  if (g === 'circle') {
    for (const [x, y] of [[-1, -2], [0, -2], [-2, -1], [1, -1], [-2, 0], [1, 0], [-1, 1], [0, 1]] as const) put(x, y);
  } else if (g === 'chevron') {
    for (const [x, y] of [[0, -2], [-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 1], [1, 1], [0, 2]] as const) put(x, y);
  } else if (g === 'wave') {
    for (const [x, y] of [[-2, 0], [-1, -1], [0, 0], [1, 1], [2, 0], [-1, 1], [1, -1]] as const) put(x, y);
  } else {
    for (const [x, y] of [[0, -2], [0, -1], [-1, 0], [0, 0], [1, 0], [0, 1], [-2, 0], [2, 0], [0, 2]] as const) put(x, y);
  }
  s.pxOver(cx, cy + 3, shadow, 0.4);
}

/** Ceremonial stone footing: a moulded drum with a painted band and glyph. */
function trialFooting(s: Surface, cx: number, baseY: number, w: number, colour: string, glyph: Glyph) {
  const x = Math.round(cx - w / 2);
  const capH = Math.max(5, Math.round(w * 0.34));
  const top = baseY - 11;
  cylinder(s, x, top, w, 12, capH, P.STONE_WALL);
  // painted band just under the lip, and a second thin one at the foot
  const bandY = top + capH;
  for (let i = 1; i < w - 1; i++) {
    if (s.alphaAt(x + i, bandY) === 0) continue;
    const u = i / (w - 1);
    s.px(x + i, bandY, u < 0.34 ? P.mix(colour, '#ffffff', 0.25) : u < 0.72 ? colour : P.mix(colour, P.OUTLINE, 0.35));
    s.px(x + i, bandY + 1, P.mix(colour, P.OUTLINE, 0.45), 0.8);
  }
  trialGlyph(s, cx, bandY + 5, glyph, colour, P.OUTLINE);
  s.hline(x + 2, baseY, w - 4, P.OUTLINE, 0.35);
}

/** Tip a standing thing about its foot — displacement grows toward the top. */
function tiltBase(src: Surface, baseY: number, amount: number): Surface {
  if (amount === 0) return src;
  const out = new Surface(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    const t = Math.max(0, baseY - y) / Math.max(1, baseY);
    const dx = Math.round(amount * t * t);
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (c[3]) out.px(x + dx, y, c);
    }
  }
  return out;
}

/** Struck / confirming decoration shared by all four ceremonial lanterns. */
function lampFx(s: Surface, st: LampState, cx: number, cy: number, ramp: Ramp, seed: number) {
  if (st.ripple > 0) {
    toneRipple(s, cx, cy, st.ripple, ramp[4], Math.max(0, 0.62 - st.ripple * 0.030));
    toneRipple(s, cx, cy, st.ripple - 4, ramp[3], Math.max(0, 0.40 - st.ripple * 0.020));
  }
  if (st.bloom > 0) {
    const r = rng(seed);
    for (let i = 0; i < 6; i++) {
      const a = r.range(0, Math.PI * 2);
      const rad = 9 + st.bloom * 6 + r.range(0, 3);
      spark(
        s, Math.round(cx + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad * 0.85),
        i % 2 ? ramp[4] : P.LANTERN[4], 0.28 + 0.55 * (1 - Math.abs(st.bloom - 0.6)), i === 0,
      );
    }
  }
}

/** A — round paper globe resting in an iron cup. Amber, tone A. */
function trialLanternA(st: LampState): Surface {
  const W = 28, H = 44;
  const s = new Surface(W, H);
  const cx = 14;
  const lit = st.lit > 0;
  const ramp = P.BELL_TONE;
  const paper = lit ? ramp : dimPaper(ramp[2]);

  trialFooting(s, cx, 43, 18, ramp[3], 'circle');
  ironPost(s, cx - 1, 24, 33, 3);
  // the cup the globe rests in
  s.hline(cx - 4, 24, 9, P.IRON[3]);
  s.hline(cx - 4, 25, 9, P.IRON[1]);
  s.px(cx - 5, 24, P.IRON[2]);
  s.px(cx + 5, 24, P.IRON[0]);

  const head = new Surface(W, H);
  const gy = 15, gr = 9;
  const mask = new Surface(W, H);
  mask.ellipse(cx - gr, gy - gr, gr * 2, gr * 2, '#ffffff');
  if (lit) paperShade(head, mask, ramp, cx - 1, gy + 1, gr * 1.02, gr * 1.06, st.lit);
  else dirShade(head, mask, paper, cx - 4, gy - 4, 0.028, 0.030, 0.66);

  // three paper gores, curving with the sphere
  for (const off of [-5.5, 0, 5.5]) {
    for (let y = gy - gr + 2; y <= gy + gr - 2; y++) {
      const t = (y - gy) / gr;
      const x = Math.round(cx + off * Math.sqrt(Math.max(0, 1 - t * t)));
      head.pxOver(x, y, paper[1], 0.34);
    }
  }
  // paper thickness at the underside
  for (let x = cx - gr; x <= cx + gr; x++) {
    for (let y = gy + gr; y > gy; y--) {
      if (head.alphaAt(x, y) === 0) continue;
      head.px(x, y, paper[0], 0.55);
      head.px(x, y - 1, paper[1], 0.3);
      break;
    }
  }
  // iron collar + finial
  head.hline(cx - 3, gy - gr, 7, P.IRON[3]);
  head.hline(cx - 3, gy - gr + 1, 7, P.IRON[1]);
  head.hline(cx - 2, gy + gr - 1, 5, P.IRON[0], 0.8);
  head.vline(cx - 1, gy - gr - 3, 3, P.IRON[2]);
  head.px(cx - 2, gy - gr - 2, P.IRON[3]);
  head.px(cx, gy - gr - 2, P.IRON[0]);
  head.px(cx - 1, gy - gr - 4, P.IRON[3]);
  head.px(cx, gy - gr - 4, P.IRON[1]);
  if (lit) {
    // flame: a clean, small, hot core
    head.px(cx - 1, gy + 2, P.LANTERN[4]);
    head.px(cx - 1, gy + 1, P.LANTERN[4]);
    head.px(cx, gy + 1, ramp[4]);
    head.px(cx, gy + 2, ramp[4]);
    head.px(cx - 1, gy, ramp[4]);
    head.px(cx - 1, gy + 3, ramp[3]);
  }
  s.blit(tiltBase(head, gy + gr, st.swing));

  rim(s, P.OUTLINE, 0.9);
  if (lit) {
    glow(s, cx, gy, 15 * st.halo, ramp[3], 0.46 * st.halo);
    glow(s, cx, gy, 9 * st.halo, ramp[4], 0.34 * st.halo);
  }
  lampFx(s, st, cx, gy, ramp, 9001);
  contact(s, cx, 43, 21, 6, 0.34);
  return s;
}

/** B — tall hexagonal tower standing on its own feet. Rose, tone B. */
function trialLanternB(st: LampState): Surface {
  const W = 28, H = 44;
  const s = new Surface(W, H);
  const cx = 14;
  const lit = st.lit > 0;
  const ramp = P.TONE_ROSE;
  const paper = lit ? ramp : dimPaper(ramp[2]);

  trialFooting(s, cx, 43, 16, ramp[3], 'chevron');

  const head = new Surface(W, H);
  const bodyTop = 12, bodyBot = 30;
  const hwAt = (y: number) => 5.5 + ((y - bodyTop) / (bodyBot - bodyTop)) * 2.2;
  const mask = new Surface(W, H);
  for (let y = bodyTop; y <= bodyBot; y++) {
    const hw = Math.round(hwAt(y));
    for (let x = cx - hw; x <= cx + hw; x++) mask.px(x, y, '#ffffff');
  }
  if (lit) paperShade(head, mask, ramp, cx - 1, 21, 9.5, 11.5, st.lit);
  else dirShade(head, mask, paper, cx - 5, 15, 0.030, 0.026, 0.68);

  // hexagonal framing: the two front corner posts of the hex, plus its edges.
  // Kept translucent so the paper still glows through the ironwork.
  for (let y = bodyTop; y <= bodyBot; y++) {
    const hw = Math.round(hwAt(y));
    const fp = Math.round(hw * 0.42);
    head.pxOver(cx - hw, y, P.IRON[2], 0.8);
    head.pxOver(cx - hw + 1, y, P.IRON[4], 0.35);
    head.pxOver(cx + hw, y, P.IRON[0], 0.85);
    head.pxOver(cx - fp, y, P.IRON[3], 0.4);
    head.pxOver(cx + fp, y, P.IRON[1], 0.5);
  }
  for (const y of [bodyTop + 1, bodyBot - 1]) {
    const hw = Math.round(hwAt(y));
    for (let x = cx - hw; x <= cx + hw; x++) head.pxOver(x, y, P.IRON[2], 0.7);
    head.hline(cx - hw, y + 1, hw * 2 + 1, P.IRON[0], 0.3);
  }

  // pointed cap — the town's lantern hat, with lit and shaded slopes
  for (let j = 0; j < 8; j++) {
    const hw = 1 + Math.round((j / 7) * 8);
    for (let x = cx - hw; x <= cx + hw; x++) {
      const u = (x - (cx - hw)) / Math.max(1, hw * 2);
      const c = u < 0.20 ? P.IRON[2] : u < 0.44 ? P.IRON[4] : u < 0.68 ? P.IRON[3] : u < 0.86 ? P.IRON[1] : P.IRON[0];
      head.px(x, 4 + j, c);
    }
  }
  head.hline(cx - 9, 12, 19, P.IRON[0], 0.9);
  head.hline(cx - 8, 11, 17, P.IRON[3], 0.45);
  head.px(cx - 9, 11, P.IRON[2]);
  head.px(cx + 9, 11, P.IRON[0]);
  // finial + hanging ring
  head.vline(cx, 0, 4, P.IRON[2]);
  head.px(cx - 1, 1, P.IRON[4]);
  head.px(cx - 1, 0, P.IRON[3]);
  head.px(cx + 1, 2, P.IRON[0]);
  head.px(cx, 0, lit ? ramp[4] : P.IRON[3]);
  // flared foot and three little legs
  head.hline(cx - 9, bodyBot + 1, 19, P.IRON[2]);
  head.hline(cx - 9, bodyBot + 2, 19, P.IRON[0]);
  head.hline(cx - 7, bodyBot + 3, 15, P.IRON[1]);
  for (const lx of [cx - 6, cx, cx + 6]) {
    head.vline(lx, bodyBot + 4, 2, P.IRON[2]);
    head.px(lx + 1, bodyBot + 4, P.IRON[0]);
  }
  if (lit) {
    head.rect(cx - 1, 20, 2, 3, P.LANTERN[4]);
    head.px(cx - 1, 19, ramp[4]);
    head.px(cx, 23, ramp[4]);
  }
  s.blit(tiltBase(head, bodyBot + 5, st.swing));

  rim(s, P.OUTLINE, 0.9);
  if (lit) {
    glow(s, cx, 21, 14 * st.halo, ramp[3], 0.46 * st.halo, 2.3, 1.2);
    glow(s, cx, 21, 8 * st.halo, ramp[4], 0.32 * st.halo, 2.3, 1.35);
  }
  lampFx(s, st, cx, 21, ramp, 9002);
  contact(s, cx, 43, 19, 6, 0.34);
  return s;
}

/** C — wide squat ribbed bell slung from a hook arm. Sea-green, tone C. */
function trialLanternC(st: LampState): Surface {
  const W = 28, H = 44;
  const s = new Surface(W, H);
  const lit = st.lit > 0;
  const ramp = P.TONE_TEAL;
  const paper = lit ? ramp : dimPaper(ramp[2]);
  const cx = 16;

  // hook post, deliberately off to one side so the silhouette is asymmetric
  trialFooting(s, 5, 43, 13, ramp[3], 'wave');
  ironPost(s, 4, 8, 32, 3);
  // the arm sweeps up and over
  const arm: Array<[number, number]> = [[5, 7], [6, 6], [8, 5], [11, 4], [14, 4], [16, 5]];
  for (const [x, y] of arm) {
    s.px(x, y, P.IRON[4]);
    s.px(x, y + 1, P.IRON[2]);
    s.px(x, y + 2, P.IRON[0], 0.75);
  }
  s.px(16, 6, P.IRON[2]);
  // diagonal brace back to the post
  for (let i = 0; i < 5; i++) s.px(6 + i, 11 - i, P.IRON[i < 2 ? 3 : 1]);

  const head = new Surface(W, H);
  const topY = 13, rimY = 31;
  /** Bell profile: rounded shoulder, near-vertical waist, flared mouth. */
  const hwAt = (y: number) => {
    const t = Math.max(0, Math.min(1, (y - topY) / (rimY - topY)));
    if (t < 0.34) return 3.6 + 5.4 * Math.sin((t / 0.34) * Math.PI * 0.5);
    if (t < 0.84) return 9.0 + 0.7 * Math.pow((t - 0.34) / 0.5, 2);
    return 9.7 + 2.1 * Math.pow((t - 0.84) / 0.16, 1.4);
  };
  const mask = new Surface(W, H);
  for (let y = topY; y <= rimY; y++) {
    const hw = hwAt(y);
    for (let x = Math.round(cx - hw); x <= Math.round(cx + hw); x++) mask.px(x, y, '#ffffff');
  }
  if (lit) paperShade(head, mask, ramp, cx - 1, 25, 11, 11, st.lit);
  else dirShade(head, mask, paper, cx - 6, 18, 0.030, 0.034, 0.68);

  // ribs, gathered toward the crown — the read-at-a-glance texture of this one
  for (const off of [-0.88, -0.5, 0.5, 0.88]) {
    for (let y = topY + 2; y <= rimY - 2; y++) {
      const x = Math.round(cx + off * hwAt(y));
      head.pxOver(x, y, off < 0 ? paper[4] : paper[0], off < 0 ? 0.4 : 0.55);
    }
  }
  // hollow mouth: the lip overhangs, and the inside of the bell is in shadow
  head.hline(cx - 12, rimY, 25, P.IRON[2]);
  head.hline(cx - 12, rimY + 1, 25, P.IRON[0]);
  head.px(cx - 12, rimY - 1, P.IRON[3]);
  head.px(cx + 12, rimY - 1, P.IRON[1]);
  head.hline(cx - 9, rimY - 1, 19, paper[0], 0.45);
  head.hline(cx - 7, rimY - 2, 15, paper[1], 0.25);
  // crown plate + ring, hung on two chain links
  head.hline(cx - 4, topY, 9, P.IRON[3]);
  head.hline(cx - 4, topY + 1, 9, P.IRON[1]);
  head.px(cx - 5, topY + 1, P.IRON[2]);
  head.px(cx + 5, topY + 1, P.IRON[0]);
  for (const [rx, ry] of [[-1, -3], [0, -4], [1, -3], [-1, -1], [0, 0], [1, -1]] as const) {
    head.px(cx + rx, topY + ry, ry < -2 ? P.IRON[3] : P.IRON[2]);
  }
  head.px(cx, topY - 2, P.IRON[0], 0.6);
  head.px(cx, topY - 6, P.IRON[3]);
  head.px(cx, topY - 7, P.IRON[2]);
  head.px(cx - 1, topY - 6, P.IRON[4]);
  if (lit) {
    // the flame hangs low inside the mouth of the bell
    head.px(cx - 1, 26, P.LANTERN[4]);
    head.px(cx - 1, 27, P.LANTERN[4]);
    head.px(cx, 26, ramp[4]);
    head.px(cx, 27, ramp[4]);
    head.px(cx - 1, 25, ramp[4]);
    head.px(cx, 28, ramp[3]);
  }
  s.blit(shearHang(head, topY - 7, st.swing));

  rim(s, P.OUTLINE, 0.9);
  if (lit) {
    glow(s, cx + Math.round(st.swing * 0.6), 26, 16 * st.halo, ramp[3], 0.44 * st.halo, 2.3, 0.88);
    glow(s, cx + Math.round(st.swing * 0.6), 27, 9 * st.halo, ramp[4], 0.3 * st.halo);
  }
  lampFx(s, st, cx, 24, ramp, 9003);
  contact(s, cx, 43, 24, 7, 0.3);
  return s;
}

/** The reference tone lantern — a gold lozenge on a fluted pedestal. */
function referenceLantern(st: LampState): Surface {
  const W = 28, H = 52;
  const s = new Surface(W, H);
  const cx = 14;
  const gold = P.UI_GOLD;
  const lit = st.lit > 0;
  const paper = lit ? P.UI_PARCHMENT : dimPaper(gold[3]);

  // pedestal: moulded foot, fluted column, capital
  s.ellipse(2, 43, 24, 8, P.STONE_WALL[2]);
  s.rect(3, 43, 22, 5, P.STONE_WALL[2]);
  s.ellipse(3, 45, 22, 7, P.STONE_WALL[1]);
  for (let j = 0; j < 9; j++) {
    for (let i = 0; i < 24; i++) {
      const px = 2 + i, py = 43 + j;
      if (s.alphaAt(px, py) === 0) continue;
      const u = i / 23, v = j / 8;
      const t = (1 - u) * 0.5 + (1 - v) * 0.5;
      s.px(px, py, t > 0.76 ? P.STONE_WALL[4] : t > 0.54 ? P.STONE_WALL[3] : t > 0.32 ? P.STONE_WALL[2] : P.STONE_WALL[1]);
    }
  }
  for (let i = 0; i < 12; i++) {
    const u = i / 11;
    const c = u < 0.14 ? P.STONE_WALL[1] : u < 0.34 ? P.STONE_WALL[4] : u < 0.52 ? P.STONE_WALL[3] : u < 0.76 ? P.STONE_WALL[2] : P.STONE_WALL[0];
    s.vline(8 + i, 30, 14, c);
  }
  for (const fx of [10, 13, 16, 19]) s.vline(fx, 32, 11, P.STONE_WALL[0], 0.28);
  s.rect(6, 27, 17, 3, P.STONE_WALL[3]);
  s.hline(6, 27, 17, P.STONE_WALL[4]);
  s.hline(6, 29, 17, P.STONE_WALL[0], 0.8);
  s.hline(7, 43, 15, P.STONE_WALL[4], 0.5);
  // gold plaque on the pedestal — this is the tone you compare against
  s.rect(11, 34, 7, 6, gold[1]);
  s.rectOutline(11, 34, 7, 6, gold[3]);
  s.px(12, 36, gold[4]); s.px(14, 36, gold[4]); s.px(16, 36, gold[4]);
  s.px(13, 37, gold[2]); s.px(15, 37, gold[2]);

  const head = new Surface(W, H);
  const cy = 13, hwMax = 9, hhMax = 12;
  const mask = new Surface(W, H);
  for (let y = cy - hhMax; y <= cy + hhMax; y++) {
    const hw = Math.round(hwMax * (1 - Math.abs(y - cy) / hhMax));
    for (let x = cx - hw; x <= cx + hw; x++) mask.px(x, y, '#ffffff');
  }
  if (lit) paperShade(head, mask, P.UI_PARCHMENT, cx - 1, cy, 10, 13, st.lit);
  else dirShade(head, mask, paper, cx - 5, cy - 5, 0.030, 0.028, 0.66);
  // gold frame down the four diagonals
  for (let k = 0; k <= hhMax; k++) {
    const hw = Math.round(hwMax * (1 - k / hhMax));
    for (const dy of [-k, k]) {
      head.pxOver(cx - hw, cy + dy, dy < 0 ? gold[4] : gold[2]);
      head.pxOver(cx + hw, cy + dy, dy < 0 ? gold[2] : gold[0]);
    }
  }
  // waist band + two ribs
  for (let x = cx - hwMax; x <= cx + hwMax; x++) {
    head.pxOver(x, cy, gold[3], 0.85);
    head.pxOver(x, cy + 1, gold[1], 0.55);
  }
  for (const off of [-4, 4]) {
    for (let y = cy - hhMax + 5; y <= cy + hhMax - 5; y++) head.pxOver(cx + off, y, paper[off < 0 ? 4 : 1], 0.3);
  }
  // crown, hook, and a small tassel so it is unmistakably the odd one out
  head.vline(cx, cy - hhMax - 4, 4, P.IRON[2]);
  head.px(cx - 1, cy - hhMax - 3, P.IRON[4]);
  head.px(cx, cy - hhMax - 5, gold[3]);
  head.px(cx - 1, cy - hhMax - 5, gold[4]);
  head.px(cx + 1, cy - hhMax - 5, gold[1]);
  head.vline(cx, cy + hhMax + 1, 3, gold[2]);
  head.px(cx - 1, cy + hhMax + 3, gold[3]);
  head.px(cx + 1, cy + hhMax + 3, gold[1]);
  head.px(cx, cy + hhMax + 4, gold[2]);
  if (lit) {
    head.rect(cx - 1, cy - 1, 2, 3, P.UI_PARCHMENT[4]);
    head.px(cx - 1, cy - 2, P.LANTERN[4]);
  }
  s.blit(shearHang(head, cy - hhMax - 5, st.swing));

  rim(s, P.OUTLINE, 0.9);
  if (lit) {
    glow(s, cx, cy, 15 * st.halo, gold[4], 0.42 * st.halo);
    glow(s, cx, cy, 9 * st.halo, P.UI_PARCHMENT[4], 0.28 * st.halo);
  }
  lampFx(s, st, cx, cy, P.UI_GOLD, 9004);
  contact(s, cx, 51, 25, 7, 0.34);
  return s;
}

/** The striker mallet. */
function striker(): Surface {
  const W = 20, H = 20;
  const s = new Surface(W, H);
  for (let i = 0; i < 13; i++) {
    const x = 4 + i, y = 16 - i;
    s.px(x, y, P.WOOD[3]);
    s.px(x + 1, y, P.WOOD[2]);
    s.px(x, y + 1, P.WOOD[0]);
  }
  for (let i = 0; i < 4; i++) {
    const x = 4 + i, y = 16 - i;
    s.px(x, y, P.ROPE[3]);
    s.px(x + 1, y, P.ROPE[1]);
  }
  s.ellipse(12, 1, 8, 7, P.FLOWER_ROSE[1]);
  for (let j = 0; j < 7; j++) {
    for (let i = 0; i < 8; i++) {
      if (s.alphaAt(12 + i, 1 + j) === 0) continue;
      const t = (1 - i / 7) * 0.5 + (1 - j / 6) * 0.5;
      s.px(12 + i, 1 + j, t > 0.72 ? P.FLOWER_ROSE[3] : t > 0.46 ? P.FLOWER_ROSE[2] : t > 0.26 ? P.FLOWER_ROSE[1] : P.FLOWER_ROSE[0]);
    }
  }
  s.hline(13, 4, 6, P.ROPE[2], 0.5);
  rim(s, P.OUTLINE, 0.85);
  contact(s, 10, 19, 12, 4, 0.28);
  return s;
}

// ── the trial stage ────────────────────────────────────────────────────────

/** Three little painted glyph plates, matching the three trial lanterns. */
const POST_GLYPHS: Glyph[] = ['circle', 'chevron', 'wave'];
const POST_COLOURS = [P.BELL_TONE[3], P.TONE_ROSE[3], P.TONE_TEAL[3]];

/**
 * The Lantern Trial stage: a raised timber platform the player stands on to
 * answer in front of everyone. Three mounting posts along the back carry the
 * three trial lanterns, each post glyph-matched to its lantern, so the map
 * author cannot line them up wrongly and the player always knows which is which.
 */
function trialStage(): Surface {
  const W = 96, H = 64;
  const s = new Surface(W, H);
  const deckTop = 22, deckBot = 47, fasciaBot = 57;

  // ── corner posts, each carrying a lantern: this is what makes the stage
  //    read as the plaza's focal point from across the map ─────────────────
  for (const cxp of [7, 88]) {
    for (let y = 12; y < deckTop + 6; y++) {
      for (let dx = -2; dx <= 2; dx++) {
        const u = (dx + 2) / 4;
        s.px(cxp + dx, y, u < 0.2 ? P.WOOD[1] : u < 0.42 ? P.WOOD[4] : u < 0.64 ? P.WOOD[3] : u < 0.84 ? P.WOOD[2] : P.WOOD[0]);
      }
    }
    grain(s, cxp - 2, 12, 5, 16, P.WOOD, 4300 + cxp, false);
    s.hline(cxp - 3, 10, 7, P.IRON[3]);
    s.hline(cxp - 3, 11, 7, P.IRON[1]);
    s.px(cxp, 9, P.IRON[2]);
    // bracket arm reaching inward
    const dir = cxp < W / 2 ? 1 : -1;
    for (let i = 1; i <= 5; i++) s.px(cxp + dir * i, 12, P.IRON[dir > 0 ? 3 : 1]);
    for (let i = 1; i <= 5; i++) s.px(cxp + dir * i, 13, P.IRON[0], 0.7);
    for (let i = 0; i < 3; i++) s.px(cxp + dir * (2 + i), 15 - i, P.IRON[2]);
    hangLantern(s, cxp + dir * 5, 14, P.LANTERN, 1);
  }

  // ── three mounting posts (drawn before the deck: it overlaps their feet) ─
  for (let i = 0; i < 3; i++) {
    const px = 24 + i * 24;
    for (let y = 8; y < deckTop + 4; y++) {
      for (let dx = -3; dx <= 3; dx++) {
        const u = (dx + 3) / 6;
        s.px(px + dx, y, u < 0.16 ? P.WOOD[1] : u < 0.36 ? P.WOOD[4] : u < 0.56 ? P.WOOD[3] : u < 0.80 ? P.WOOD[2] : P.WOOD[0]);
      }
    }
    grain(s, px - 3, 8, 7, deckTop - 4, P.WOOD, 4400 + i * 31, false);
    // iron cup + collar at the top, where the lantern is mounted
    s.hline(px - 4, 8, 9, P.IRON[3]);
    s.hline(px - 4, 9, 9, P.IRON[1]);
    s.px(px - 5, 9, P.IRON[2]);
    s.px(px + 5, 9, P.IRON[0]);
    s.hline(px - 3, 6, 7, P.IRON[2]);
    s.hline(px - 3, 7, 7, P.IRON[4], 0.5);
    // painted glyph plate on the post front
    s.rect(px - 3, 13, 7, 8, P.PLASTER[2]);
    s.hline(px - 3, 13, 7, P.PLASTER[4]);
    s.vline(px - 3, 13, 8, P.PLASTER[3]);
    s.hline(px - 3, 20, 7, P.OUTLINE, 0.55);
    s.vline(px + 3, 13, 8, P.PLASTER[1]);
    trialGlyph(s, px, 16, POST_GLYPHS[i], POST_COLOURS[i], P.OUTLINE);
  }

  // ── deck ────────────────────────────────────────────────────────────────
  planks(s, 4, deckTop, 88, deckBot - deckTop, P.WOOD_LIGHT, 4501, 5, true);
  // staggered board ends so it is not a stack of full-width stripes
  for (let j = 0; j < deckBot - deckTop; j += 5) {
    const jx = 18 + ((j / 5) % 3) * 24;
    s.vline(jx, deckTop + j, 5, P.WOOD[0], 0.5);
    s.vline(jx + 1, deckTop + j, 5, P.WOOD_LIGHT[4], 0.25);
  }
  // perspective: the far edge is in shadow, the near edge catches the light
  for (let y = deckTop; y < deckBot; y++) {
    const t = (y - deckTop) / (deckBot - deckTop);
    if (t < 0.30) s.rect(4, y, 88, 1, P.OUTLINE, (0.30 - t) * 1.5);
    else if (t > 0.80) s.rect(4, y, 88, 1, P.WOOD_LIGHT[4], (t - 0.80) * 0.9);
  }
  const wr = rng(4600);
  speckle(s, wr, 28, deckTop + 8, 40, 14, P.WOOD_LIGHT[1], 44, 0.26);
  speckle(s, wr, 8, deckTop + 3, 80, 20, P.WOOD_LIGHT[0], 26, 0.18);
  // painted ceremonial border along the front edge of the deck
  s.hline(4, deckBot - 4, 88, P.CARPET_RED[2], 0.9);
  s.hline(4, deckBot - 3, 88, P.CARPET_RED[1], 0.9);
  for (let x = 6; x < 92; x += 6) {
    s.px(x, deckBot - 4, P.UI_GOLD[3], 0.9);
    s.px(x + 1, deckBot - 3, P.UI_GOLD[1], 0.7);
  }
  s.hline(4, deckTop, 88, P.WOOD_LIGHT[4], 0.5);
  s.hline(4, deckBot - 2, 88, P.WOOD_LIGHT[4], 0.7);
  s.hline(4, deckBot - 1, 88, P.WOOD[0]);

  // ── fascia: deliberately much darker than the deck, so the stage reads
  //    as raised rather than as a flat rectangle of planks ────────────────
  planks(s, 4, deckBot, 88, fasciaBot - deckBot, P.WOOD, 4701, 6, false);
  s.rect(4, deckBot, 88, fasciaBot - deckBot, P.OUTLINE, 0.30);
  s.rect(4, deckBot, 88, 2, P.OUTLINE, 0.35);
  s.hline(4, fasciaBot - 1, 88, P.OUTLINE, 0.85);
  for (const lx of [10, 30, 64, 84]) {
    s.rect(lx, deckBot, 4, fasciaBot - deckBot, P.WOOD[1]);
    s.vline(lx, deckBot, fasciaBot - deckBot, P.WOOD[3]);
    s.vline(lx + 3, deckBot, fasciaBot - deckBot, P.WOOD[0]);
  }

  // ── bunting hung from the deck lip, over the fascia ─────────────────────
  const flagRamps = [P.CARPET_RED, P.DYE_SAFFRON, P.CANVAS, P.DYE_SEA, P.DYE_PLUM];
  for (let i = 0; i < 11; i++) {
    const fx = 8 + i * 8;
    const ramp = flagRamps[i % flagRamps.length];
    for (let j = 0; j < 7; j++) {
      const hw = 3 - Math.floor(j / 2.5);
      for (let x = fx - hw; x <= fx + hw; x++) {
        const u = (x - (fx - hw)) / Math.max(1, hw * 2);
        s.px(x, deckBot + j, u < 0.35 ? ramp[3] : u < 0.72 ? ramp[2] : ramp[1]);
      }
      s.px(fx + hw, deckBot + j, ramp[0]);
    }
    s.px(fx, deckBot + 7, ramp[0]);
  }
  s.hline(4, deckBot - 1, 88, P.ROPE[3], 0.8);

  // ── steps: three treads stepping out toward the player ─────────────────
  for (let k = 0; k < 3; k++) {
    const sw = 28 + k * 7;
    const sx = Math.round(W / 2 - sw / 2);
    const sy = fasciaBot - 1 + k * 2;
    s.rect(sx, sy, sw, 3, P.WOOD_LIGHT[2]);
    s.hline(sx, sy, sw, P.WOOD_LIGHT[4]);
    s.hline(sx, sy + 1, sw, P.WOOD_LIGHT[2]);
    s.hline(sx, sy + 2, sw, P.WOOD[0], 0.85);
    s.vline(sx, sy, 3, P.WOOD[1]);
    s.vline(sx + sw - 1, sy, 3, P.WOOD[0]);
    // red runner down the middle
    const rw = 14;
    const rx = Math.round(W / 2 - rw / 2);
    s.rect(rx, sy, rw, 2, P.CARPET_RED[2]);
    s.hline(rx, sy, rw, P.CARPET_RED[3]);
    s.vline(rx, sy, 2, P.CARPET_RED[4], 0.7);
    s.vline(rx + rw - 1, sy, 2, P.CARPET_RED[0]);
    s.hline(rx, sy + 2, rw, P.CARPET_RED[0], 0.8);
  }

  rim(s, P.OUTLINE, 0.9);
  contact(s, W / 2, 63, 94, 9, 0.3);
  return s;
}

// ── string lights: the biggest mood lever in the plaza ─────────────────────

/** One bulb: a hot core, a glass body, a dark cap, and a baked halo. */
function bulb(s: Surface, x: number, y: number, ramp: Ramp, on: number) {
  // cap
  s.px(x, y - 1, P.IRON[2]);
  s.px(x, y - 2, P.IRON[0]);
  // glass
  s.px(x - 1, y, ramp[3]);
  s.px(x, y, ramp[4]);
  s.px(x + 1, y, ramp[2]);
  s.px(x - 1, y + 1, ramp[2]);
  s.px(x, y + 1, ramp[3]);
  s.px(x + 1, y + 1, ramp[1]);
  s.px(x, y + 2, ramp[1]);
  if (on > 0) {
    glow(s, x, y + 0.5, 5 + 2 * on, ramp[3], 0.36 + 0.24 * on);
    glow(s, x, y + 0.5, 2.6, ramp[4], 0.5 * on);
  }
}

/** The sagging cable itself, as a y(x) function so bulbs can sit on it. */
function cableY(x: number, w: number, top: number, sag: number): number {
  const t = (x - (w - 1) / 2) / ((w - 1) / 2);
  return top + sag * (1 - t * t);
}

/**
 * A 48-wide span of strung bulbs. Spans butt together horizontally: the cable
 * always enters and leaves at the same height, so a map author can run them
 * across the whole plaza. Drawn on the "over" layer.
 */
function stringSpan(variant: number, phase: number, lit: boolean): Surface {
  const W = 48, H = 24;
  const s = new Surface(W, H);
  const top = 3, sag = variant === 1 ? 10 : variant === 2 ? 6 : 8;
  // cable
  for (let x = 0; x < W; x++) {
    const y = Math.round(cableY(x, W, top, sag));
    s.px(x, y, P.IRON[3]);
    s.px(x, y + 1, P.IRON[0], 0.85);
    if (x % 7 === 3) s.px(x, y - 1, P.IRON[4], 0.5);
  }
  // bulbs, colour-cycled per variant
  const ramps: Ramp[][] = [
    [P.LANTERN, P.LANTERN, P.WINDOW_AMBER, P.LANTERN],
    [P.LANTERN, P.TONE_ROSE, P.LANTERN, P.WINDOW_AMBER],
    [P.WINDOW_AMBER, P.LANTERN, P.TONE_TEAL, P.LANTERN],
  ];
  const set = ramps[variant % ramps.length];
  const xs = variant === 2 ? [5, 14, 24, 33, 42] : [4, 13, 23, 33, 43];
  xs.forEach((bx, i) => {
    const cy = Math.round(cableY(bx, W, top, sag));
    // little flex where the bulb hangs
    s.px(bx, cy + 1, P.IRON[1]);
    const on = lit ? 0.55 + 0.45 * Math.sin((phase + i * 1.7) * 1.05) : 0.5;
    bulb(s, bx, cy + 3, set[i % set.length], Math.max(0.15, on));
  });
  return s;
}

/** A 16x64 pole to hang the spans from: timber, iron hook, ribbon. */
function stringPole(): Surface {
  const W = 16, H = 64;
  const s = new Surface(W, H);
  const cx = 7;
  for (let y = 6; y < 60; y++) {
    for (let dx = -2; dx <= 2; dx++) {
      const u = (dx + 2) / 4;
      const c = u < 0.2 ? P.WOOD[1] : u < 0.42 ? P.WOOD[4] : u < 0.62 ? P.WOOD[3] : u < 0.84 ? P.WOOD[2] : P.WOOD[0];
      s.px(cx + dx, y, c);
    }
  }
  grain(s, cx - 2, 6, 5, 54, P.WOOD, 5100, false);
  // iron cap, hook arm and eyelet
  s.hline(cx - 3, 4, 7, P.IRON[3]);
  s.hline(cx - 3, 5, 7, P.IRON[1]);
  s.px(cx - 4, 5, P.IRON[2]);
  s.px(cx + 4, 5, P.IRON[0]);
  s.hline(cx - 2, 2, 5, P.IRON[2]);
  s.px(cx, 1, P.IRON[4]);
  for (const [x, y] of [[cx + 4, 7], [cx + 5, 8], [cx + 5, 9], [cx + 4, 10]] as const) s.px(x, y, P.IRON[3]);
  s.px(cx + 4, 9, P.IRON[0]);
  // ribbon tied below the cap, warm so the pole reads as festival kit
  for (let j = 0; j < 7; j++) {
    const w = j < 2 ? 3 : 2;
    s.rect(cx + 2, 11 + j, w, 1, j % 2 ? P.CARPET_RED[2] : P.CARPET_RED[3]);
    s.rect(cx - 4, 12 + j, w, 1, j % 2 ? P.DYE_SAFFRON[2] : P.DYE_SAFFRON[3]);
  }
  s.hline(cx - 3, 10, 7, P.ROPE[3]);
  s.hline(cx - 3, 11, 7, P.ROPE[1]);
  // foot: braces and a little pile of stones holding it up
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 5; i++) s.px(cx + dir * (2 + i), 55 + i, dir < 0 ? P.WOOD[3] : P.WOOD[1]);
  }
  s.ellipse(1, 57, 14, 5, P.COBBLE[2]);
  for (let i = 0; i < 14; i++) {
    const u = i / 13;
    for (let j = 0; j < 5; j++) {
      if (s.alphaAt(1 + i, 57 + j) === 0) continue;
      s.px(1 + i, 57 + j, u < 0.3 ? P.COBBLE[3] : u < 0.7 ? P.COBBLE[2] : P.COBBLE[1]);
    }
  }
  s.hline(3, 61, 10, P.COBBLE[0], 0.6);
  rim(s, P.OUTLINE, 0.9);
  contact(s, cx, 63, 16, 5, 0.32);
  return s;
}

// ── stalls ─────────────────────────────────────────────────────────────────

/** Striped canvas with a scalloped hem — the awning language of the plaza. */
function awning(
  s: Surface, x: number, y: number, w: number, h: number,
  a: Ramp, bRamp: Ramp, stripe = 6, scallop = true,
) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ramp = Math.floor(i / stripe) % 2 === 0 ? a : bRamp;
      const t = j / Math.max(1, h - 1);
      const c = t < 0.14 ? ramp[4] : t < 0.45 ? ramp[3] : t < 0.78 ? ramp[2] : ramp[1];
      s.px(x + i, y + j, c);
    }
  }
  // cloth sag between the ribs
  for (let i = 0; i < w; i++) {
    const d = Math.abs(((i % stripe) / stripe) - 0.5);
    if (d < 0.16) for (let j = 1; j < h - 1; j++) s.px(x + i, y + j, P.OUTLINE, 0.10);
  }
  if (scallop) {
    for (let i = 0; i < w; i++) {
      const p = (i % stripe) / stripe;
      const drop = Math.round(Math.sin(p * Math.PI) * 2.4);
      for (let j = 0; j < drop; j++) {
        const ramp = Math.floor(i / stripe) % 2 === 0 ? a : bRamp;
        s.px(x + i, y + h + j, j === drop - 1 ? ramp[0] : ramp[1]);
      }
    }
  }
  s.hline(x, y + h - 1, w, P.OUTLINE, 0.35);
}

/** A stall counter: front boards, a lit top lip, and a shadow beneath. */
function counter(s: Surface, x: number, y: number, w: number, h: number, ramp: Ramp, seed: number) {
  // top surface
  s.rect(x, y, w, 3, ramp[3]);
  s.hline(x, y, w, ramp[4]);
  s.hline(x, y + 2, w, ramp[1]);
  // front
  planks(s, x, y + 3, w, h - 3, ramp, seed, 6, false);
  s.rect(x, y + 3, w, 1, ramp[0], 0.5);
  s.hline(x, y + h - 1, w, P.OUTLINE, 0.7);
}

/** A hanging price board — a symbol only, never text. */
function priceBoard(s: Surface, x: number, y: number, symbol: 'loaf' | 'skewer' | 'cup' | 'coin' | 'fish') {
  s.px(x + 3, y - 2, P.ROPE[2]);
  s.px(x + 3, y - 1, P.ROPE[1]);
  s.rect(x, y, 8, 7, P.WOOD_LIGHT[2]);
  s.hline(x, y, 8, P.WOOD_LIGHT[4]);
  s.vline(x, y, 7, P.WOOD_LIGHT[3]);
  s.hline(x, y + 6, 8, P.WOOD[0]);
  s.vline(x + 7, y, 7, P.WOOD[1]);
  const ink = P.UI_INK;
  if (symbol === 'loaf') {
    s.ellipse(x + 2, y + 2, 5, 3, P.FOOD_BREAD[3]);
    s.px(x + 3, y + 2, P.FOOD_BREAD[4]);
    s.hline(x + 2, y + 4, 5, ink, 0.5);
  } else if (symbol === 'skewer') {
    s.line(x + 1, y + 5, x + 6, y + 1, P.WOOD[3]);
    for (const k of [0, 2, 4]) s.px(x + 2 + k, y + 4 - k, P.FOOD_MEAT[3]);
  } else if (symbol === 'cup') {
    s.rect(x + 2, y + 2, 4, 3, P.BRONZE[3]);
    s.hline(x + 2, y + 2, 4, P.LANTERN[3]);
    s.px(x + 6, y + 3, P.BRONZE[2]);
  } else if (symbol === 'coin') {
    s.ellipse(x + 2, y + 2, 4, 4, P.UI_GOLD[2]);
    s.px(x + 3, y + 3, P.UI_GOLD[4]);
  } else {
    s.ellipse(x + 1, y + 2, 5, 3, P.DYE_SEA[3]);
    s.px(x + 6, y + 2, P.DYE_SEA[2]);
    s.px(x + 6, y + 4, P.DYE_SEA[2]);
  }
}

/** The small hanging paper lantern used all over the plaza. */
function hangLantern(s: Surface, cx: number, top: number, ramp: Ramp, size: 0 | 1 | 2, lit = true) {
  const rw = size === 0 ? 4 : size === 1 ? 5 : 6;
  const rh = size === 0 ? 5 : size === 1 ? 7 : 8;
  const mask = new Surface(s.w, s.h);
  mask.ellipse(cx - rw, top + 2, rw * 2, rh, '#ffffff');
  const paper = lit ? ramp : dimPaper(ramp[2]);
  const body = new Surface(s.w, s.h);
  if (lit) paperShade(body, mask, ramp, cx - 1, top + 2 + rh / 2, rw * 1.05, rh * 0.62, 1);
  else dirShade(body, mask, paper, cx - rw, top, 0.05, 0.05, 0.66);
  // ribs
  for (let j = 0; j < rh; j++) {
    body.pxOver(cx - Math.round(rw * 0.55), top + 2 + j, paper[3], 0.3);
    body.pxOver(cx + Math.round(rw * 0.55), top + 2 + j, paper[0], 0.4);
  }
  s.blit(body);
  s.hline(cx - 2, top + 1, 5, P.IRON[2]);
  s.hline(cx - 2, top + rh + 2, 5, P.IRON[0], 0.85);
  s.px(cx, top, P.IRON[3]);
  if (lit) {
    s.px(cx - 1, top + 2 + Math.floor(rh / 2), P.LANTERN[4]);
    glow(s, cx, top + 2 + rh / 2, 6 + rw, ramp[3], 0.38);
    glow(s, cx, top + 2 + rh / 2, 4, ramp[4], 0.3);
  }
}

/** Steam / smoke plume. */
function plume(s: Surface, x: number, y: number, h: number, seed: number, ramp: Ramp = P.STEAM, spread = 3) {
  const r = rng(seed);
  for (let j = 0; j < h; j++) {
    const t = j / h;
    const w = 1 + Math.round(t * spread);
    const ox = Math.round(Math.sin(t * 3.4 + seed) * spread * 0.8);
    for (let i = -w; i <= w; i++) {
      if (r.chance(0.28 + t * 0.30)) continue;
      const edge = Math.abs(i) >= w - 0.5;
      s.px(x + ox + i, y - j, ramp[edge ? 2 : Math.min(4, 3 + Math.round((1 - t) * 1))], (0.62 - t * 0.42) * (edge ? 0.7 : 1));
    }
  }
}

/** stall 0 — canvas awning stall: breads and fruit under a striped roof. */
function stallFoodAwning(): Surface {
  const W = 64, H = 56;
  const s = new Surface(W, H);
  // back posts
  for (const px of [5, 56]) {
    s.rect(px, 12, 3, 40, P.WOOD[2]);
    s.vline(px, 12, 40, P.WOOD[3]);
    s.vline(px + 2, 12, 40, P.WOOD[0]);
  }
  // awning, sloping toward the viewer
  awning(s, 2, 8, 60, 11, P.CANVAS, P.CARPET_RED, 6);
  s.hline(2, 7, 60, P.WOOD[1]);
  s.hline(2, 6, 60, P.WOOD[3]);

  // counter, with a painted front panel so it is not a slab of brown
  counter(s, 4, 33, 56, 19, P.WOOD_LIGHT, 5301);
  s.rect(12, 39, 40, 9, P.DYE_SEA[1]);
  s.rect(13, 40, 38, 7, P.DYE_SEA[2]);
  s.hline(13, 40, 38, P.DYE_SEA[3]);
  s.hline(13, 46, 38, P.DYE_SEA[0]);
  for (let x = 16; x < 50; x += 7) {
    s.px(x, 43, P.CANVAS[3]);
    s.px(x + 1, 42, P.CANVAS[4]);
    s.px(x + 1, 44, P.CANVAS[2]);
    s.px(x + 2, 43, P.CANVAS[3]);
  }
  // cloth swag pinned along the counter lip
  for (let i = 0; i < 56; i++) {
    const d = Math.round(Math.sin((i / 56) * Math.PI * 4) * 1.6 + 1.6);
    s.px(4 + i, 34 + d, P.CARPET_RED[3]);
    s.px(4 + i, 35 + d, P.CARPET_RED[2]);
    s.px(4 + i, 36 + d, P.CARPET_RED[0], 0.8);
  }

  // goods ON the counter, each with a dark seat so it does not float
  const r = rng(5401);
  // bread board
  s.rect(7, 30, 22, 3, P.WOOD[2]);
  s.hline(7, 30, 22, P.WOOD[4]);
  for (let i = 0; i < 4; i++) {
    const bx = 8 + i * 5 + r.int(0, 1);
    s.ellipse(bx, 25, 6, 6, P.FOOD_BREAD[1]);
    s.ellipse(bx + 1, 25, 4, 5, P.FOOD_BREAD[3]);
    s.px(bx + 2, 26, P.FOOD_BREAD[4]);
    s.px(bx + 1, 27, P.FOOD_BREAD[2]);
    s.hline(bx, 29, 5, P.OUTLINE, 0.4);
    // slashed crust
    s.px(bx + 2, 24, P.FOOD_BREAD[0], 0.7);
    s.px(bx + 3, 25, P.FOOD_BREAD[0], 0.55);
  }
  // fruit basket, colour-graded so the fruit reads at 1x
  s.ellipse(36, 26, 20, 9, P.ROPE[1]);
  s.ellipse(37, 25, 18, 8, P.ROPE[3]);
  for (let i = 0; i < 4; i++) s.vline(38 + i * 4, 26, 5, P.ROPE[1], 0.5);
  const fruits: Ramp[] = [P.FLOWER_ROSE as unknown as Ramp, P.DYE_SAFFRON, P.VEG_LEAF, P.FLOWER_ROSE as unknown as Ramp, P.DYE_SAFFRON, P.VEG_LEAF];
  for (let i = 0; i < 6; i++) {
    const fx = 38 + (i % 3) * 6, fy = 22 + (i > 2 ? 3 : 0);
    const ramp = fruits[i];
    s.ellipse(fx, fy, 5, 5, ramp[1]);
    s.ellipse(fx + 1, fy, 3, 3, ramp[2]);
    s.px(fx + 1, fy + 1, ramp[3]);
    s.px(fx + 3, fy + 3, ramp[0]);
  }
  s.hline(36, 30, 20, P.OUTLINE, 0.4);

  // hanging price boards, herb bundles and a lantern under the awning
  priceBoard(s, 10, 20, 'loaf');
  priceBoard(s, 46, 20, 'coin');
  hangLantern(s, 31, 17, P.LANTERN, 1);
  for (const hx of [7, 58] as const) {
    for (let j = 0; j < 7; j++) {
      const w = j < 2 ? 1 : 2;
      for (let i = -w; i <= w; i++) s.px(hx + i, 20 + j, (i + j) % 2 ? P.VEG_LEAF[2] : P.VEG_LEAF[1]);
    }
    s.px(hx, 19, P.ROPE[2]);
  }
  // a crate of spare stock at the foot
  s.rect(0, 42, 12, 10, P.WOOD[2]);
  s.hline(0, 42, 12, P.WOOD[4]);
  s.hline(0, 47, 12, P.WOOD[0], 0.7);
  s.hline(0, 51, 12, P.OUTLINE, 0.7);
  s.vline(11, 42, 10, P.WOOD[0]);
  for (let i = 0; i < 3; i++) s.ellipse(1 + i * 4, 39, 4, 4, P.DYE_SAFFRON[i % 2 ? 1 : 2]);
  s.hline(0, 43, 12, P.WOOD[3], 0.5);

  rim(s, P.OUTLINE, 0.9);
  contact(s, 32, 55, 60, 8, 0.3);
  return s;
}

/** stall 1 — open grill cart: wheels, coals, skewers and a chimney. */
function stallFoodGrill(): Surface {
  const W = 64, H = 56;
  const s = new Surface(W, H);
  // chimney pipe, tall and thin — the whole point of this silhouette
  for (let y = 3; y < 26; y++) {
    s.px(46, y, P.IRON[3]);
    s.px(47, y, P.IRON[2]);
    s.px(48, y, P.IRON[0]);
  }
  s.hline(44, 2, 7, P.IRON[2]);
  s.hline(44, 1, 7, P.IRON[3]);
  s.px(43, 3, P.IRON[1]);
  s.px(50, 3, P.IRON[0]);
  plume(s, 47, 0, 6, 5451, P.STEAM, 2);
  // a garlic braid hung off the pipe — pale, so it reads against the night
  s.vline(51, 5, 18, P.ROPE[1]);
  for (let j = 0; j < 4; j++) {
    const by = 7 + j * 4;
    s.ellipse(49, by, 5, 5, P.CANVAS[1]);
    s.ellipse(50, by, 3, 4, P.CANVAS[3]);
    s.px(50, by + 1, P.CANVAS[4]);
    s.px(52, by + 3, P.CANVAS[0]);
    s.px(51, by - 1, P.VEG_LEAF[2]);
  }
  s.px(51, 4, P.ROPE[3]);

  // cart body, with a saffron painted board
  planks(s, 6, 30, 52, 16, P.WOOD, 5501, 6, false);
  s.rect(6, 30, 52, 2, P.WOOD[0], 0.5);
  s.hline(6, 45, 52, P.OUTLINE, 0.7);
  s.rect(14, 34, 36, 8, P.DYE_SAFFRON[1]);
  s.rect(15, 35, 34, 6, P.DYE_SAFFRON[2]);
  s.hline(15, 35, 34, P.DYE_SAFFRON[3]);
  s.hline(15, 40, 34, P.DYE_SAFFRON[0]);
  for (let x = 18; x < 48; x += 6) {
    s.px(x, 38, P.CARPET_RED[2]);
    s.px(x + 1, 37, P.CARPET_RED[3]);
    s.px(x + 1, 39, P.CARPET_RED[1]);
  }

  // grill bed: an iron tray of live coals
  s.rect(8, 22, 48, 8, P.IRON[1]);
  s.hline(8, 22, 48, P.IRON[3]);
  s.hline(8, 29, 48, P.IRON[0]);
  const cr = rng(5601);
  for (let i = 0; i < 110; i++) {
    const x = 10 + cr.int(0, 43), y = 24 + cr.int(0, 4);
    const t = cr.next();
    s.px(x, y, t > 0.90 ? P.FIRE[3] : t > 0.70 ? P.FIRE[1] : t > 0.44 ? P.COAL[4] : t > 0.22 ? P.COAL[3] : P.COAL[1]);
  }
  glow(s, 32, 26, 24, P.FIRE[2], 0.24, 2.6, 0.45);

  // skewers, sitting proud of the coals with their own shadow
  for (let i = 0; i < 4; i++) {
    const sx = 11 + i * 11, sy = 22 + (i % 2);
    s.hline(sx, sy + 3, 11, P.OUTLINE, 0.45);
    s.hline(sx, sy + 1, 12, P.WOOD_LIGHT[4]);
    s.hline(sx, sy + 2, 12, P.WOOD[1]);
    for (let k = 0; k < 3; k++) {
      const mx = sx + 1 + k * 3;
      s.rect(mx, sy - 1, 3, 4, P.FOOD_MEAT[2]);
      s.hline(mx, sy - 1, 3, P.FOOD_MEAT[4]);
      s.px(mx + 2, sy + 2, P.FOOD_MEAT[0]);
      s.px(mx, sy + 1, P.FOOD_MEAT[3]);
    }
  }
  // smoke drifting off the coals
  plume(s, 20, 20, 15, 5701, P.STEAM, 3);
  plume(s, 38, 20, 12, 5711, P.STEAM, 2);

  // wheels
  for (const wx of [15, 47] as const) {
    s.ellipse(wx - 8, 39, 17, 17, P.WOOD[1]);
    s.ellipseOutline(wx - 8, 39, 17, 17, P.WOOD[3]);
    s.ellipse(wx - 5, 42, 11, 11, P.OUTLINE, 0.55);
    for (let a = 0; a < 6; a++) {
      const th = (a / 6) * Math.PI * 2 + 0.3;
      s.line(wx, 47, Math.round(wx + Math.cos(th) * 7), Math.round(47 + Math.sin(th) * 7), a < 3 ? P.WOOD[3] : P.WOOD[2]);
    }
    s.ellipse(wx - 2, 45, 5, 5, P.IRON[2]);
    s.px(wx - 1, 46, P.IRON[4]);
    s.px(wx + 1, 48, P.IRON[0]);
  }
  // pull handle at the left
  for (let i = 0; i < 7; i++) s.px(5 - i, 32 + i, P.WOOD[i < 3 ? 3 : 2]);
  s.px(0, 38, P.WOOD[1]);
  // a small lantern clipped to the chimney
  hangLantern(s, 41, 8, P.WINDOW_AMBER, 0);
  rim(s, P.OUTLINE, 0.9);
  contact(s, 32, 55, 56, 8, 0.3);
  return s;
}

/** stall 2 — covered wagon counter: a hooped tilt over a wagon box. */
function stallFoodWagon(): Surface {
  const W = 64, H = 56;
  const s = new Surface(W, H);
  const cxw = 31, top = 3, rw = 25, rh = 23;

  // hooped canvas tilt, striped along the hoops
  const hwAt = (y: number) => {
    const t = (y - top) / rh;
    return rw * Math.sqrt(Math.max(0, 1 - Math.pow(1 - t, 2.1)));
  };
  const mask = new Surface(W, H);
  for (let y = top; y <= top + rh; y++) {
    const hw = Math.round(hwAt(y));
    for (let x = cxw - hw; x <= cxw + hw; x++) mask.px(x, y, '#ffffff');
  }
  dirShade(s, mask, P.CANVAS, cxw - 11, top + 4, 0.018, 0.022, 0.68);
  // canvas stripes: bands of sea-dye running over the hoops
  for (let y = top; y <= top + rh; y++) {
    const hw = hwAt(y);
    for (let x = Math.round(cxw - hw); x <= Math.round(cxw + hw); x++) {
      const u = (x - cxw) / Math.max(1, hw);
      const band = Math.floor((Math.asin(Math.max(-1, Math.min(1, u))) / Math.PI + 0.5) * 7);
      if (band % 2 === 1) {
        const cur = s.get(x, y);
        const lift = cur[0] > 190 ? 4 : cur[0] > 150 ? 3 : 2;
        s.px(x, y, P.DYE_SEA[lift], 0.34);
      }
    }
  }
  // hoop ribs
  for (const off of [-0.86, -0.46, 0.46, 0.86]) {
    for (let y = top; y <= top + rh; y++) {
      const hw = hwAt(y);
      const x = Math.round(cxw + off * hw);
      s.pxOver(x, y, off < 0 ? P.CANVAS[4] : P.OUTLINE, off < 0 ? 0.45 : 0.30);
    }
  }
  s.hline(cxw - Math.round(hwAt(top + rh)), top + rh, Math.round(hwAt(top + rh)) * 2 + 1, P.OUTLINE, 0.5);

  // the open end: a dark interior with a warm lamp and two shelves of jars
  const open = new Surface(W, H);
  for (let y = top + 5; y <= top + rh - 1; y++) {
    const t = (y - top - 5) / (rh - 6);
    const hw = Math.round(15 * Math.sqrt(Math.max(0, 1 - Math.pow(1 - t, 2.2))));
    for (let x = cxw - hw; x <= cxw + hw; x++) open.px(x, y, '#ffffff');
  }
  fillMask(s, open, () => P.SOOT[1]);
  fillMask(s, open, (x, y) => (((x + y) & 3) === 0 ? P.SOOT[2] : null), 0.5);
  glow(s, cxw - 6, top + 13, 13, P.LANTERN[2], 0.34);
  // shelves + jars inside
  s.rect(cxw - 13, top + 17, 27, 2, P.WOOD[1]);
  s.hline(cxw - 13, top + 17, 27, P.WOOD[3], 0.8);
  for (let i = 0; i < 4; i++) {
    const jx = cxw - 11 + i * 7;
    if (s.alphaAt(jx, top + 14) === 0) continue;
    cylinder(s, jx, top + 11, 5, 6, 2, i % 2 ? P.TERRACOTTA : P.COPPER);
    s.px(jx + 2, top + 12, P.LANTERN[3], 0.7);
  }
  hangLantern(s, cxw - 6, top + 6, P.LANTERN, 0);

  // wagon box
  planks(s, 3, 31, 58, 14, P.WOOD_LIGHT, 5801, 5, true);
  s.hline(3, 31, 58, P.WOOD_LIGHT[4]);
  s.hline(3, 44, 58, P.OUTLINE, 0.8);
  s.rect(3, 31, 58, 1, P.WOOD[0], 0.45);
  for (const bx of [8, 30, 52]) {
    s.vline(bx, 31, 14, P.WOOD[0], 0.6);
    s.vline(bx + 1, 31, 14, P.WOOD_LIGHT[4], 0.35);
  }
  // painted name-plate (a symbol, never text)
  s.rect(25, 34, 13, 8, P.WOOD[1]);
  s.rect(26, 35, 11, 6, P.PLASTER[2]);
  s.hline(26, 35, 11, P.PLASTER[4]);
  s.ellipse(29, 36, 5, 4, P.COPPER[2]);
  s.px(30, 37, P.LANTERN[3]);
  s.hline(28, 39, 6, P.OUTLINE, 0.5);

  // fold-down counter with copper pots
  s.rect(1, 27, 62, 4, P.WOOD_LIGHT[3]);
  s.hline(1, 27, 62, P.WOOD_LIGHT[4]);
  s.hline(1, 30, 62, P.WOOD[0]);
  for (const bx of [6, 54]) {
    for (let i = 0; i < 4; i++) s.px(bx + (bx < 30 ? i : -i), 31 + i, P.WOOD[1]);
  }
  for (const [px, ramp] of [[4, P.COPPER], [50, P.TERRACOTTA]] as const) {
    cylinder(s, px, 19, 10, 9, 4, ramp as Ramp);
    // lid + handle
    s.ellipse(px, 18, 10, 4, (ramp as Ramp)[3]);
    s.hline(px + 1, 18, 8, (ramp as Ramp)[4]);
    s.px(px + 4, 17, P.IRON[2]);
    s.px(px + 5, 17, P.IRON[0]);
    s.hline(px, 27, 10, P.OUTLINE, 0.45);
  }
  // a stack of bowls between the pots
  for (let i = 0; i < 3; i++) {
    s.ellipse(20, 22 + i * 2, 12, 4, P.PLASTER[2]);
    s.hline(21, 22 + i * 2, 10, P.PLASTER[4]);
    s.hline(21, 24 + i * 2, 10, P.PLASTER[0], 0.6);
  }
  plume(s, 8, 17, 13, 5901, P.STEAM, 2);
  plume(s, 54, 17, 10, 5911, P.STEAM, 2);

  // wheels, partly hidden behind the box
  for (const wx of [14, 50]) {
    s.ellipse(wx - 7, 39, 15, 15, P.WOOD[1]);
    s.ellipseOutline(wx - 7, 39, 15, 15, P.WOOD[3]);
    s.ellipse(wx - 4, 42, 9, 9, P.OUTLINE, 0.5);
    for (let a = 0; a < 6; a++) {
      const th = (a / 6) * Math.PI * 2;
      s.line(wx, 46, Math.round(wx + Math.cos(th) * 6), Math.round(46 + Math.sin(th) * 6), a < 3 ? P.WOOD[3] : P.WOOD[2]);
    }
    s.ellipse(wx - 2, 44, 5, 5, P.IRON[2]);
    s.px(wx - 1, 45, P.IRON[4]);
  }
  rim(s, P.OUTLINE, 0.9);
  contact(s, 32, 55, 58, 8, 0.3);
  return s;
}

// ── game and craft stalls ──────────────────────────────────────────────────

/** A small triangular pennant on a staff. */
function pennant(s: Surface, x: number, y: number, ramp: Ramp, dir = 1, len = 9) {
  for (let i = 0; i < len; i++) {
    const h = Math.max(1, Math.round((1 - i / len) * 7));
    for (let j = 0; j < h; j++) {
      const c = j === 0 ? ramp[4] : j < h - 1 ? ramp[2] : ramp[1];
      s.px(x + dir * i, y + j, c);
    }
    s.px(x + dir * i, y + h, ramp[0], 0.6);
  }
}

/** stall 3 — ring toss: a peg board, hoops, and a low counter. */
function stallGameRing(): Surface {
  const W = 64, H = 56;
  const s = new Surface(W, H);
  // side posts
  for (const px of [4, 57]) {
    s.rect(px, 8, 3, 42, P.WOOD[2]);
    s.vline(px, 8, 42, P.WOOD[3]);
    s.vline(px + 2, 8, 42, P.WOOD[0]);
    s.hline(px - 1, 7, 5, P.WOOD[4]);
  }
  pennant(s, 6, 2, P.DYE_SAFFRON, 1, 10);
  s.vline(5, 2, 8, P.WOOD[3]);
  pennant(s, 58, 2, P.DYE_PLUM, -1, 10);
  s.vline(58, 2, 8, P.WOOD[3]);
  s.hline(4, 9, 56, P.WOOD[1]);

  // backing board with pegs
  s.rect(7, 12, 50, 24, P.WOOD_LIGHT[1]);
  planks(s, 7, 12, 50, 24, P.WOOD_LIGHT, 6101, 6, true);
  s.rect(7, 12, 50, 24, P.OUTLINE, 0.18);
  s.hline(7, 12, 50, P.WOOD_LIGHT[4], 0.8);
  s.hline(7, 35, 50, P.OUTLINE, 0.7);
  const pegRamps = [P.CARPET_RED, P.DYE_SAFFRON, P.DYE_SEA, P.DYE_PLUM, P.TONE_ROSE];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const px = 12 + col * 10, py = 16 + row * 7;
      // peg
      s.rect(px, py, 2, 5, P.WOOD[3]);
      s.px(px + 1, py, P.WOOD[4]);
      s.px(px + 1, py + 4, P.WOOD[0]);
      s.hline(px - 1, py + 5, 4, P.OUTLINE, 0.4);
      // a hoop landed on some of them
      if ((row + col) % 3 !== 1) continue;
      const ramp = pegRamps[(row * 5 + col) % pegRamps.length];
      s.ellipseOutline(px - 3, py + 2, 8, 4, ramp[2]);
      s.px(px - 3, py + 4, ramp[1]);
      s.px(px + 4, py + 4, ramp[0]);
      s.px(px - 2, py + 2, ramp[4]);
    }
  }
  // score marks painted on the board (symbols, never text)
  for (let i = 0; i < 5; i++) {
    const dots = (i % 3) + 1;
    for (let d = 0; d < dots; d++) s.px(12 + i * 10 + d, 34, P.UI_GOLD[3]);
  }

  // counter with a rack of spare hoops
  counter(s, 4, 38, 56, 14, P.WOOD, 6201);
  s.rect(10, 42, 44, 7, P.CARPET_RED[1]);
  s.rect(11, 43, 42, 5, P.CARPET_RED[2]);
  s.hline(11, 43, 42, P.CARPET_RED[3]);
  s.hline(11, 47, 42, P.CARPET_RED[0]);
  for (let i = 0; i < 5; i++) {
    const ramp = pegRamps[i];
    s.ellipseOutline(14 + i * 9, 33, 9, 5, ramp[2]);
    s.px(14 + i * 9, 35, ramp[3]);
    s.px(22 + i * 9, 36, ramp[0]);
  }
  hangLantern(s, 31, 9, P.WINDOW_AMBER, 0);
  rim(s, P.OUTLINE, 0.9);
  contact(s, 32, 55, 58, 8, 0.3);
  return s;
}

/** stall 4 — lucky dip: a cloth-draped barrel under an arch of prizes. */
function stallGameDip(): Surface {
  const W = 56, H = 56;
  const s = new Surface(W, H);
  // prize arch
  for (const px of [5, 47]) {
    s.rect(px, 14, 3, 30, P.WOOD[2]);
    s.vline(px, 14, 30, P.WOOD[3]);
    s.vline(px + 2, 14, 30, P.WOOD[0]);
  }
  for (let x = 5; x < 51; x++) {
    const y = 14 - Math.round(Math.sin(((x - 5) / 45) * Math.PI) * 7);
    s.px(x, y, P.WOOD[3]);
    s.px(x, y + 1, P.WOOD[2]);
    s.px(x, y + 2, P.WOOD[0], 0.8);
  }
  // prizes hanging from the arch
  const prizes: Array<[number, Ramp, string]> = [
    [11, P.TONE_ROSE, 'lantern'], [20, P.DYE_SAFFRON, 'ribbon'],
    [28, P.LANTERN, 'lantern'], [36, P.DYE_SEA, 'ribbon'], [44, P.DYE_PLUM, 'lantern'],
  ];
  for (const [px, ramp, kind] of prizes) {
    const y = 14 - Math.round(Math.sin(((px - 5) / 45) * Math.PI) * 7) + 3;
    s.vline(px, y, 3, P.ROPE[2]);
    if (kind === 'lantern') {
      hangLantern(s, px, y + 2, ramp, 0, true);
    } else {
      // rosette + tails
      s.ellipse(px - 3, y + 3, 7, 6, ramp[1]);
      s.ellipse(px - 2, y + 4, 5, 4, ramp[3]);
      s.px(px, y + 5, ramp[4]);
      for (let j = 0; j < 5; j++) {
        s.px(px - 2, y + 8 + j, ramp[2]);
        s.px(px + 2, y + 8 + j, ramp[1]);
      }
    }
  }
  // the barrel, draped in cloth
  cylinder(s, 12, 30, 32, 24, 10, P.WOOD, { lid: false });
  for (const by of [33, 45]) {
    s.hline(12, by, 32, P.IRON[2]);
    s.hline(12, by + 1, 32, P.IRON[0]);
  }
  // cloth cover with a hole in the middle
  const cloth = new Surface(W, H);
  cloth.ellipse(10, 26, 36, 14, '#ffffff');
  for (let x = 10; x < 46; x++) {
    const d = Math.round(Math.sin(((x - 10) / 36) * Math.PI * 5) * 1.6 + 2);
    for (let j = 0; j < d + 6; j++) cloth.px(x, 33 + j, '#ffffff');
  }
  dirShade(s, cloth, P.DYE_PLUM, 18, 26, 0.024, 0.030, 0.66);
  for (let x = 12; x < 45; x += 4) {
    for (let j = 0; j < 12; j++) s.pxOver(x, 30 + j, P.DYE_PLUM[0], 0.22);
  }
  // the dip hole
  s.ellipse(21, 26, 14, 8, P.SOOT[1]);
  s.ellipse(22, 27, 12, 6, P.SOOT[0]);
  s.hline(23, 26, 10, P.DYE_PLUM[4], 0.7);
  s.ellipseOutline(21, 26, 14, 8, P.DYE_PLUM[3]);
  // a straw poking out
  for (let i = 0; i < 5; i++) s.px(26 + i, 27 - i, P.ROPE[i < 2 ? 3 : 2]);
  // gold trim on the cloth hem
  for (let x = 11; x < 46; x++) {
    const d = Math.round(Math.sin(((x - 10) / 36) * Math.PI * 5) * 1.6 + 2);
    s.px(x, 38 + d + 5, P.UI_GOLD[2], 0.9);
  }
  rim(s, P.OUTLINE, 0.9);
  contact(s, 28, 55, 40, 8, 0.32);
  return s;
}

/** stall 5 — the craft stall: lanterns and charms for sale. */
function stallCraft(): Surface {
  const W = 64, H = 56;
  const s = new Surface(W, H);
  // open frame: two uprights and two cross-rails
  for (const px of [4, 57]) {
    s.rect(px, 6, 3, 44, P.WOOD_LIGHT[2]);
    s.vline(px, 6, 44, P.WOOD_LIGHT[4]);
    s.vline(px + 2, 6, 44, P.WOOD[0]);
    s.hline(px - 1, 5, 5, P.WOOD_LIGHT[3]);
    s.px(px + (px < 30 ? 3 : -1), 4, P.WOOD_LIGHT[4]);
  }
  for (const ry of [7, 24]) {
    s.hline(4, ry, 56, P.WOOD_LIGHT[3]);
    s.hline(4, ry + 1, 56, P.WOOD_LIGHT[2]);
    s.hline(4, ry + 2, 56, P.WOOD[0], 0.8);
  }
  // corner braces
  for (const [bx, dir] of [[7, 1], [54, -1]] as const) {
    for (let i = 0; i < 5; i++) s.px(bx + dir * i, 10 + i, P.WOOD_LIGHT[i < 2 ? 3 : 2]);
  }
  // the goods: a row of paper lanterns for sale, in different colours
  const lanterns: Array<[number, Ramp, 0 | 1 | 2, boolean]> = [
    [12, P.LANTERN, 1, true], [23, P.TONE_ROSE, 0, true],
    [33, P.LANTERN, 2, true], [43, P.TONE_TEAL, 1, true], [52, P.WINDOW_AMBER, 0, false],
  ];
  for (const [lx, ramp, size, lit] of lanterns) {
    s.vline(lx, 10, 2, P.ROPE[2]);
    hangLantern(s, lx, 11, ramp, size, lit);
  }
  // charms hanging from the lower rail
  for (let i = 0; i < 9; i++) {
    const cx2 = 8 + i * 6;
    s.vline(cx2, 27, 3, P.ROPE[2]);
    const ramp = [P.UI_GOLD, P.BRONZE, P.DYE_SEA, P.TONE_ROSE][i % 4];
    if (i % 3 === 0) {
      s.ellipse(cx2 - 2, 30, 5, 5, ramp[1]);
      s.px(cx2 - 1, 31, ramp[3]);
      s.px(cx2, 32, ramp[0]);
    } else if (i % 3 === 1) {
      for (let j = 0; j < 4; j++) {
        const hw = j < 2 ? j : 3 - j;
        for (let x = cx2 - hw; x <= cx2 + hw; x++) s.px(x, 30 + j, x < cx2 ? ramp[3] : ramp[1]);
      }
    } else {
      s.rect(cx2 - 2, 30, 4, 5, ramp[2]);
      s.hline(cx2 - 2, 30, 4, ramp[4]);
      s.hline(cx2 - 2, 34, 4, ramp[0]);
    }
  }
  // low counter with folded paper stock and a brush pot
  counter(s, 6, 40, 52, 12, P.WOOD_LIGHT, 6401);
  for (let i = 0; i < 4; i++) {
    s.rect(9 + i * 4, 36, 3, 4, P.CANVAS[3]);
    s.hline(9 + i * 4, 36, 3, P.CANVAS[4]);
    s.px(11 + i * 4, 39, P.CANVAS[1]);
  }
  cylinder(s, 44, 33, 8, 8, 3, P.TERRACOTTA);
  for (let i = 0; i < 3; i++) {
    s.vline(46 + i * 2, 29, 5, P.WOOD[2]);
    s.px(46 + i * 2, 28, P.IRON[1]);
    s.px(46 + i * 2, 27, P.OUTLINE);
  }
  s.rect(26, 44, 14, 5, P.PLASTER[2]);
  s.hline(26, 44, 14, P.PLASTER[4]);
  s.hline(26, 48, 14, P.OUTLINE, 0.5);
  hangLantern(s, 33, 45, P.LANTERN, 0, false);
  rim(s, P.OUTLINE, 0.9);
  contact(s, 32, 55, 58, 8, 0.3);
  return s;
}

/** The bandstand: a small stage with a painted screen and three instruments. */
function stageMusic(): Surface {
  const W = 80, H = 56;
  const s = new Surface(W, H);
  const deckTop = 30, deckBot = 46;

  // backing screen with a curved head, painted with the lantern motif
  const screen = new Surface(W, H);
  for (let y = 6; y <= 32; y++) {
    const t = Math.max(0, (12 - y) / 6);
    const hw = 30 - Math.round(t * t * 10);
    for (let x = 40 - hw; x <= 40 + hw; x++) screen.px(x, y, '#ffffff');
  }
  dirShade(s, screen, P.CANVAS, 22, 12, 0.014, 0.018, 0.68);
  // painted arc bands
  for (let y = 6; y <= 32; y++) {
    const t = Math.max(0, (12 - y) / 6);
    const hw = 30 - Math.round(t * t * 10);
    if ((y - 6) % 7 < 2) {
      for (let x = 40 - hw; x <= 40 + hw; x++) s.pxOver(x, y, P.DYE_PLUM[(y - 6) % 7 === 0 ? 3 : 2], 0.55);
    }
    s.pxOver(40 - hw, y, P.CANVAS[4], 0.6);
    s.pxOver(40 + hw, y, P.OUTLINE, 0.5);
  }
  // a painted lantern in the middle of the screen
  s.ellipse(34, 12, 12, 12, P.LANTERN[2]);
  s.ellipse(36, 13, 8, 9, P.LANTERN[3]);
  s.px(39, 16, P.LANTERN[4]);
  s.hline(36, 10, 5, P.IRON[2]);
  s.hline(37, 24, 3, P.IRON[1]);
  s.vline(39, 7, 3, P.IRON[2]);
  for (let a = 0; a < 8; a++) {
    const th = (a / 8) * Math.PI * 2;
    s.px(Math.round(40 + Math.cos(th) * 11), Math.round(16 + Math.sin(th) * 11), P.UI_GOLD[3], 0.8);
  }
  // frame posts
  for (const px of [8, 69]) {
    s.rect(px, 10, 3, 24, P.WOOD[2]);
    s.vline(px, 10, 24, P.WOOD[3]);
    s.vline(px + 2, 10, 24, P.WOOD[0]);
  }
  pennant(s, 11, 6, P.CARPET_RED, 1, 8);
  s.vline(9, 6, 5, P.WOOD[3]);
  pennant(s, 69, 6, P.DYE_SEA, -1, 8);
  s.vline(70, 6, 5, P.WOOD[3]);

  // deck + fascia
  planks(s, 4, deckTop, 72, deckBot - deckTop, P.WOOD_LIGHT, 6501, 5, true);
  s.hline(4, deckTop, 72, P.WOOD_LIGHT[4], 0.7);
  for (let y = deckTop; y < deckTop + 4; y++) s.rect(4, y, 72, 1, P.OUTLINE, (4 - (y - deckTop)) * 0.06);
  s.hline(4, deckBot - 1, 72, P.WOOD[0]);
  planks(s, 4, deckBot, 72, 8, P.WOOD, 6601, 6, false);
  s.rect(4, deckBot, 72, 8, P.OUTLINE, 0.3);
  s.hline(4, 53, 72, P.OUTLINE, 0.8);
  for (let i = 0; i < 9; i++) {
    const fx = 8 + i * 8;
    for (let j = 0; j < 5; j++) {
      const hw = 2 - Math.floor(j / 2.5);
      const ramp = [P.CARPET_RED, P.DYE_SAFFRON, P.CANVAS, P.DYE_SEA][i % 4];
      for (let x = fx - hw; x <= fx + hw; x++) s.px(x, deckBot + j, x < fx ? ramp[3] : ramp[2]);
    }
  }

  // ── instruments ─────────────────────────────────────────────────────────
  // drum, on its side facing the viewer
  s.ellipse(10, 22, 18, 18, P.WOOD[1]);
  s.ellipse(11, 23, 16, 16, P.UI_PARCHMENT[1]);
  const drumHead = new Surface(W, H);
  drumHead.ellipse(11, 23, 16, 16, '#ffffff');
  dirShade(s, drumHead, P.UI_PARCHMENT, 15, 27, 0.040, 0.044, 0.62);
  s.ellipseOutline(10, 22, 18, 18, P.WOOD[3]);
  s.ellipseOutline(11, 23, 16, 16, P.WOOD[1], 0.8);
  // rope lacing round the shell
  for (let a = 0; a < 10; a++) {
    const th = (a / 10) * Math.PI * 2 + 0.3;
    const x0 = Math.round(19 + Math.cos(th) * 8), y0 = Math.round(31 + Math.sin(th) * 8);
    const x1 = Math.round(19 + Math.cos(th + 0.62) * 8), y1 = Math.round(31 + Math.sin(th + 0.62) * 8);
    s.line(x0, y0, x1, y1, a < 5 ? P.ROPE[3] : P.ROPE[1], 0.85);
    s.px(x0, y0, P.CARPET_RED[2]);
  }
  // a painted band across the head
  for (let i = 0; i < 16; i++) {
    if (s.alphaAt(11 + i, 30) === 0) continue;
    s.px(11 + i, 30, P.CARPET_RED[2], 0.75);
    s.px(11 + i, 31, P.CARPET_RED[1], 0.5);
  }
  s.hline(12, 39, 14, P.OUTLINE, 0.4);
  // drumsticks
  for (let i = 0; i < 9; i++) s.px(24 + i, 30 - i, P.WOOD_LIGHT[3]);
  for (let i = 0; i < 9; i++) s.px(26 + i, 30 - i, P.WOOD_LIGHT[2]);

  // fiddle on a stand
  s.vline(46, 26, 12, P.WOOD[2]);
  s.hline(43, 37, 7, P.WOOD[1]);
  const fid = new Surface(W, H);
  fid.ellipse(42, 14, 9, 9, '#ffffff');
  fid.ellipse(43, 20, 7, 8, '#ffffff');
  fid.rect(45, 4, 2, 12, '#ffffff');
  dirShade(s, fid, P.WOOD_LIGHT, 42, 12, 0.05, 0.045, 0.68);
  s.vline(46, 4, 12, P.WOOD[0], 0.5);
  for (let i = 0; i < 4; i++) s.vline(45 + (i % 2), 8 + i, 6, P.LINEN[3], 0.5);
  s.px(44, 4, P.WOOD[0]);
  s.px(47, 5, P.WOOD[0]);
  s.px(41, 18, P.OUTLINE, 0.6);
  s.px(48, 18, P.OUTLINE, 0.6);
  // bow leaning against the stand
  for (let i = 0; i < 16; i++) s.px(52 + Math.round(i * 0.3), 12 + i, i % 5 === 0 ? P.WOOD[1] : P.WOOD[3]);
  for (let i = 0; i < 16; i++) s.px(54 + Math.round(i * 0.3), 12 + i, P.LINEN[2]);

  // pipes, hung on the post
  for (let i = 0; i < 6; i++) {
    const px = 59 + i * 2;
    const len = 14 - i;
    s.vline(px, 18, len, P.ROPE[3]);
    s.vline(px + 1, 18, len, P.ROPE[1]);
    s.px(px, 18, P.ROPE[4]);
    s.px(px + 1, 18, P.ROPE[2]);
    s.px(px, 18 + len, P.OUTLINE, 0.7);
    s.px(px + 1, 18 + len, P.OUTLINE, 0.7);
  }
  s.hline(58, 17, 14, P.WOOD[3]);
  s.hline(58, 22, 14, P.ROPE[0], 0.7);
  s.hline(58, 23, 14, P.ROPE[2], 0.5);
  // stool
  s.ellipse(28, 34, 12, 5, P.WOOD[3]);
  s.rect(29, 36, 10, 2, P.WOOD[2]);
  for (const lx of [30, 37]) s.vline(lx, 37, 5, P.WOOD[1]);
  s.hline(29, 41, 9, P.OUTLINE, 0.35);
  hangLantern(s, 9, 12, P.LANTERN, 0);
  hangLantern(s, 70, 12, P.LANTERN, 0);
  rim(s, P.OUTLINE, 0.9);
  contact(s, 40, 55, 76, 8, 0.3);
  return s;
}

/** The judging table: rosettes, a ledger and an inkpot. */
function judgingTable(): Surface {
  const W = 48, H = 32;
  const s = new Surface(W, H);
  // table top
  s.rect(2, 12, 44, 4, P.WOOD_LIGHT[3]);
  s.hline(2, 12, 44, P.WOOD_LIGHT[4]);
  s.hline(2, 15, 44, P.WOOD[0]);
  // cloth hanging to the floor
  const cloth = new Surface(W, H);
  for (let x = 3; x < 45; x++) {
    const d = Math.round(Math.sin(((x - 3) / 42) * Math.PI * 6) * 1.4 + 1.5);
    for (let j = 0; j < 13 + d; j++) cloth.px(x, 15 + j, '#ffffff');
  }
  dirShade(s, cloth, P.CARPET_RED, 12, 16, 0.020, 0.026, 0.66);
  for (let x = 5; x < 45; x += 6) {
    for (let j = 0; j < 13; j++) s.pxOver(x, 16 + j, P.CARPET_RED[0], 0.20);
  }
  for (let x = 3; x < 45; x++) {
    const d = Math.round(Math.sin(((x - 3) / 42) * Math.PI * 6) * 1.4 + 1.5);
    s.px(x, 15 + 13 + d, P.UI_GOLD[2]);
    s.px(x, 14 + 13 + d, P.UI_GOLD[3], 0.7);
  }
  // rosettes pinned along the front
  for (let i = 0; i < 3; i++) {
    const rx = 10 + i * 14, ry = 21;
    const ramp = [P.UI_GOLD, P.LINEN, P.BRONZE][i];
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2;
      s.px(Math.round(rx + Math.cos(th) * 3), Math.round(ry + Math.sin(th) * 3), ramp[a < 4 ? 3 : 1]);
    }
    s.ellipse(rx - 2, ry - 2, 5, 5, ramp[2]);
    s.px(rx - 1, ry - 1, ramp[4]);
    s.px(rx - 1, ry + 4, ramp[1]);
    s.px(rx + 1, ry + 4, ramp[0]);
    s.px(rx - 1, ry + 5, ramp[2]);
    s.px(rx + 1, ry + 5, ramp[1]);
  }
  // ledger, quill and inkpot on the table
  s.rect(6, 8, 15, 5, P.UI_PARCHMENT[3]);
  s.hline(6, 8, 15, P.UI_PARCHMENT[4]);
  s.hline(6, 12, 15, P.UI_PARCHMENT[0]);
  s.vline(13, 8, 5, P.LEATHER[2]);
  for (let i = 0; i < 3; i++) s.hline(8, 9 + i, 4, P.UI_INK_SOFT, 0.6);
  for (let i = 0; i < 3; i++) s.hline(15, 9 + i, 4, P.UI_INK_SOFT, 0.6);
  cylinder(s, 26, 7, 6, 6, 3, P.GLASS_COLD);
  s.ellipse(26, 7, 6, 3, P.UI_INK);
  for (let i = 0; i < 6; i++) s.px(31 + i, 6 - i, i > 3 ? P.LINEN[4] : P.LINEN[2]);
  s.px(30, 7, P.UI_INK);
  // three small numbered paddles (dots, not text)
  for (let i = 0; i < 3; i++) {
    const px = 36 + i * 3;
    s.rect(px, 8, 2, 5, P.WOOD_LIGHT[2]);
    s.px(px, 8, P.WOOD_LIGHT[4]);
    for (let d = 0; d <= i; d++) s.px(px, 9 + d, P.UI_GOLD[3]);
  }
  rim(s, P.OUTLINE, 0.9);
  contact(s, 24, 31, 44, 6, 0.3);
  return s;
}

// ── fire, seating and clutter ──────────────────────────────────────────────

/** An iron fire bowl on three legs. 4 animation frames. */
function brazier(frame: number): Surface {
  const W = 28, H = 40;
  const s = new Surface(W, H);
  const cx = 14;
  // legs
  for (const [lx, dir] of [[6, -1], [22, 1], [14, 0]] as const) {
    for (let i = 0; i < 9; i++) s.px(lx + dir * Math.round(i * 0.35), 27 + i, dir < 0 ? P.IRON[3] : P.IRON[1]);
    s.px(lx, 36, P.IRON[0]);
  }
  for (let i = 0; i < 16; i++) s.px(6 + i, 31 + Math.round(Math.sin((i / 16) * Math.PI) * -2), P.IRON[2]);
  // bowl
  cylinder(s, 3, 18, 22, 12, 8, P.IRON, { lid: false });
  s.ellipse(3, 17, 22, 8, P.IRON[3]);
  s.ellipse(5, 19, 18, 6, P.SOOT[1]);
  for (let i = 0; i < 22; i++) {
    s.px(3 + i, 17 + Math.round(Math.abs(i - 10) * 0.06), P.IRON[i < 8 ? 4 : i < 15 ? 3 : 1]);
  }
  // coals
  const cr = rng(7100 + frame * 13);
  for (let i = 0; i < 46; i++) {
    const x = 6 + cr.int(0, 15), y = 20 + cr.int(0, 3);
    const t = cr.next();
    s.px(x, y, t > 0.7 ? P.FIRE[2] : t > 0.4 ? P.COAL[4] : P.COAL[2]);
  }
  // flames — four keyframes of a lively fire
  const fr = rng(7200 + frame * 977);
  const tongues = [
    [{ x: 0, h: 13 }, { x: -4, h: 8 }, { x: 4, h: 9 }],
    [{ x: 1, h: 15 }, { x: -5, h: 7 }, { x: 4, h: 11 }],
    [{ x: -1, h: 12 }, { x: -3, h: 10 }, { x: 5, h: 8 }],
    [{ x: 0, h: 14 }, { x: -4, h: 9 }, { x: 3, h: 10 }],
  ][frame % 4];
  for (const t of tongues) {
    for (let j = 0; j < t.h; j++) {
      const p = j / t.h;
      const w = Math.max(0, Math.round((1 - p) * 3.4 - (p > 0.7 ? 1 : 0)));
      const ox = Math.round(Math.sin(p * 2.6 + frame) * 1.6);
      for (let i = -w; i <= w; i++) {
        const edge = Math.abs(i) >= w - 0.4;
        const c = p > 0.78 ? P.FIRE[1] : p > 0.5 ? (edge ? P.FIRE[2] : P.FIRE[3]) : edge ? P.FIRE[3] : P.FIRE[4];
        s.px(cx + t.x + ox + i, 20 - j, c);
      }
    }
  }
  // sparks
  for (let i = 0; i < 3; i++) {
    s.px(cx + fr.int(-6, 6), 6 + fr.int(0, 8), P.FIRE[4], 0.8);
  }
  glow(s, cx, 15, 18, P.FIRE[2], 0.34 + (frame % 2) * 0.05);
  glow(s, cx, 17, 10, P.FIRE[4], 0.30);
  rim(s, P.OUTLINE, 0.85);
  contact(s, cx, 39, 22, 6, 0.34);
  return s;
}

/** Festival bench: plank seat, turned legs, a folded blanket on one. */
function benchFest(variant: number): Surface {
  const W = 40, H = 24;
  const s = new Surface(W, H);
  // seat
  s.rect(2, 10, 36, 4, P.WOOD_LIGHT[2]);
  s.hline(2, 10, 36, P.WOOD_LIGHT[4]);
  s.hline(2, 11, 36, P.WOOD_LIGHT[3]);
  s.hline(2, 13, 36, P.WOOD[0]);
  grain(s, 2, 10, 36, 4, P.WOOD_LIGHT, 7300 + variant, true);
  // back rail on variant 1
  if (variant === 1) {
    s.rect(4, 2, 32, 3, P.WOOD_LIGHT[2]);
    s.hline(4, 2, 32, P.WOOD_LIGHT[4]);
    s.hline(4, 4, 32, P.WOOD[0]);
    for (const px of [6, 33]) {
      s.vline(px, 3, 8, P.WOOD[2]);
      s.vline(px + 1, 3, 8, P.WOOD[0]);
    }
  }
  // legs
  for (const lx of [5, 32]) {
    s.rect(lx, 14, 4, 7, P.WOOD[2]);
    s.vline(lx, 14, 7, P.WOOD[3]);
    s.vline(lx + 3, 14, 7, P.WOOD[0]);
    s.hline(lx - 1, 16, 6, P.WOOD[1]);
    s.hline(lx - 1, 20, 6, P.WOOD[3]);
  }
  s.hline(9, 18, 24, P.WOOD[1]);
  s.hline(9, 19, 24, P.WOOD[0], 0.7);
  // a folded blanket / cushion
  const ramp = variant === 0 ? P.CARPET_RED : P.DYE_SEA;
  s.rect(20, 7, 15, 4, ramp[2]);
  s.hline(20, 7, 15, ramp[3]);
  s.hline(20, 8, 15, ramp[4], 0.4);
  s.hline(20, 10, 15, ramp[0]);
  for (let x = 21; x < 34; x += 3) s.px(x, 9, ramp[1], 0.7);
  rim(s, P.OUTLINE, 0.9);
  contact(s, 20, 23, 36, 6, 0.3);
  return s;
}

/** A stack of festival crates with cloth and stock. */
function crateStackFest(): Surface {
  const W = 34, H = 40;
  const s = new Surface(W, H);
  const crate = (x: number, y: number, w: number, h: number, seed: number) => {
    planks(s, x, y, w, h, P.WOOD, seed, 5, false);
    s.hline(x, y, w, P.WOOD[4], 0.8);
    s.hline(x, y + h - 1, w, P.OUTLINE, 0.75);
    s.vline(x, y, h, P.WOOD[3]);
    s.vline(x + w - 1, y, h, P.WOOD[0]);
    s.hline(x, y + Math.floor(h / 2), w, P.WOOD[1], 0.7);
    s.hline(x, y + Math.floor(h / 2) + 1, w, P.WOOD[4], 0.3);
  };
  crate(2, 22, 20, 16, 7401);
  crate(20, 26, 13, 12, 7402);
  crate(6, 10, 15, 13, 7403);
  // cloth thrown over the top crate
  const cloth = new Surface(W, H);
  cloth.rect(5, 7, 17, 5, '#ffffff');
  for (let x = 5; x < 22; x++) {
    const d = Math.round(Math.sin(((x - 5) / 17) * Math.PI * 3) * 1.6 + 2);
    for (let j = 0; j < d; j++) cloth.px(x, 12 + j, '#ffffff');
  }
  dirShade(s, cloth, P.DYE_SAFFRON, 9, 8, 0.032, 0.04, 0.68);
  // stock poking out: rolled banners and a lantern
  for (let i = 0; i < 3; i++) {
    const rx = 22 + i * 3;
    s.vline(rx, 18, 9, [P.CARPET_RED, P.DYE_SEA, P.DYE_PLUM][i][2]);
    s.px(rx, 18, [P.CARPET_RED, P.DYE_SEA, P.DYE_PLUM][i][4]);
    s.px(rx, 26, P.OUTLINE, 0.6);
  }
  hangLantern(s, 12, 1, P.LANTERN, 0, false);
  s.px(12, 0, P.ROPE[2]);
  rim(s, P.OUTLINE, 0.9);
  contact(s, 17, 39, 32, 7, 0.3);
  return s;
}

/** A cider barrel with a festival ribbon and a tap. */
function barrelFest(): Surface {
  const W = 24, H = 30;
  const s = new Surface(W, H);
  cylinder(s, 2, 6, 20, 22, 8, P.WOOD);
  // staves
  for (let x = 4; x < 21; x += 3) {
    for (let y = 10; y < 25; y++) if (s.alphaAt(x, y)) s.px(x, y, P.WOOD[0], 0.28);
  }
  for (const by of [10, 22]) {
    s.hline(2, by, 20, P.IRON[2]);
    s.hline(2, by + 1, 20, P.IRON[0]);
    s.hline(3, by, 8, P.IRON[4], 0.5);
  }
  // ribbon around the middle
  s.hline(2, 15, 20, P.CARPET_RED[2]);
  s.hline(2, 16, 20, P.CARPET_RED[3]);
  s.hline(2, 17, 20, P.CARPET_RED[1]);
  for (let j = 0; j < 5; j++) {
    s.px(15 - j, 18 + j, P.CARPET_RED[2]);
    s.px(19 + Math.floor(j / 3), 18 + j, P.CARPET_RED[1]);
  }
  s.ellipse(14, 14, 6, 5, P.CARPET_RED[3]);
  s.px(16, 16, P.CARPET_RED[4]);
  // tap
  s.rect(10, 20, 3, 2, P.BRONZE[3]);
  s.px(11, 22, P.BRONZE[2]);
  s.px(11, 23, P.BRONZE[1]);
  s.px(9, 20, P.BRONZE[4]);
  // lid marks
  s.ellipseOutline(4, 6, 16, 6, P.WOOD[4], 0.5);
  rim(s, P.OUTLINE, 0.9);
  contact(s, 12, 29, 20, 6, 0.3);
  return s;
}

// ── bunting, banners and hanging lanterns ──────────────────────────────────

/**
 * A 48-wide span of flag bunting. The rope enters and leaves at the same
 * height so spans chain, and the art is built symmetrically about its centre
 * so the runtime's `sway` looks right when it pivots the sprite.
 */
function bunting(variant: number): Surface {
  const W = 48, H = 26;
  const s = new Surface(W, H);
  const top = 3, sag = variant === 1 ? 7 : variant === 2 ? 4 : 6;
  const ropeY = (x: number) => Math.round(cableY(x, W, top, sag));
  for (let x = 0; x < W; x++) {
    const y = ropeY(x);
    s.px(x, y, P.ROPE[3]);
    s.px(x, y + 1, P.ROPE[1]);
    if (x % 5 === 2) s.px(x, y, P.ROPE[4]);
  }
  const sets: Ramp[][] = [
    [P.CARPET_RED, P.DYE_SAFFRON, P.CANVAS, P.DYE_SEA, P.DYE_PLUM],
    [P.LANTERN, P.CARPET_RED, P.CANVAS, P.LANTERN, P.DYE_SAFFRON],
    [P.DYE_SEA, P.CANVAS, P.TONE_ROSE, P.DYE_PLUM, P.CANVAS],
  ];
  const set = sets[variant % sets.length];
  const step = 6;
  for (let i = 0; i * step + 3 < W; i++) {
    const fx = 3 + i * step;
    const fy = ropeY(fx) + 2;
    const ramp = set[i % set.length];
    const shape = variant % 3;
    for (let j = 0; j < 9; j++) {
      let hw: number;
      if (shape === 0) hw = Math.max(0, 2 - Math.floor(j / 3)); // triangle
      else if (shape === 1) hw = j < 6 ? 2 : 2 - (j - 6); // swallowtail body
      else hw = j < 7 ? 2 : 0; // square
      if (shape === 1 && j >= 6) {
        // swallowtail: two points
        s.px(fx - 2, fy + j, ramp[2]);
        s.px(fx + 2, fy + j, ramp[1]);
        continue;
      }
      if (hw < 0) break;
      for (let x = fx - hw; x <= fx + hw; x++) {
        const u = hw === 0 ? 0.5 : (x - (fx - hw)) / (hw * 2);
        s.px(x, fy + j, u < 0.34 ? ramp[4] : u < 0.7 ? ramp[3] : ramp[1]);
      }
      s.px(fx + hw, fy + j, ramp[0], 0.7);
    }
    s.px(fx, fy - 1, P.ROPE[0]);
  }
  return s;
}

/** A vertical hanging banner with a painted symbol — never text. */
function banner(variant: number): Surface {
  const W = 24, H = 52;
  const s = new Surface(W, H);
  const ramps = [P.CARPET_RED, P.DYE_PLUM, P.DYE_SEA];
  const ramp = ramps[variant % ramps.length];
  const cx = 12;
  // cross-pole with finials
  s.rect(1, 3, 22, 2, P.WOOD[2]);
  s.hline(1, 3, 22, P.WOOD[4]);
  s.hline(1, 4, 22, P.WOOD[0]);
  s.px(0, 3, P.BRONZE[3]);
  s.px(0, 4, P.BRONZE[1]);
  s.px(23, 3, P.BRONZE[2]);
  s.px(23, 4, P.BRONZE[0]);
  // hanging cords
  for (const hx of [4, 19]) {
    s.px(hx, 5, P.ROPE[2]);
    s.px(hx, 6, P.ROPE[1]);
  }
  // cloth: slight taper, notched hem
  const cloth = new Surface(W, H);
  for (let y = 7; y < 44; y++) {
    const hw = 8 + Math.round(((y - 7) / 37) * 1.5);
    for (let x = cx - hw; x <= cx + hw; x++) cloth.px(x, y, '#ffffff');
  }
  for (let x = cx - 9; x <= cx + 9; x++) {
    const d = 4 - Math.abs(x - cx) < 0 ? 0 : Math.round(4 - Math.abs(x - cx) * 0.42);
    for (let j = 0; j < d; j++) cloth.px(x, 44 + j, '#ffffff');
  }
  dirShade(s, cloth, ramp, cx - 6, 14, 0.022, 0.012, 0.66);
  // vertical fold shading so the cloth has weight
  for (const off of [-5, 0, 6]) {
    for (let y = 8; y < 47; y++) s.pxOver(cx + off, y, off < 0 ? ramp[4] : ramp[0], off === 0 ? 0.18 : 0.3);
  }
  // gold border
  for (let y = 7; y < 44; y++) {
    const hw = 8 + Math.round(((y - 7) / 37) * 1.5);
    s.pxOver(cx - hw, y, P.UI_GOLD[3], 0.9);
    s.pxOver(cx + hw, y, P.UI_GOLD[1], 0.9);
  }
  s.hline(cx - 8, 7, 17, P.UI_GOLD[4], 0.9);
  s.hline(cx - 9, 8, 19, P.UI_GOLD[2], 0.5);

  // painted symbol
  const ink = P.UI_GOLD;
  if (variant % 3 === 0) {
    // a lantern
    s.ellipse(cx - 5, 17, 11, 12, ink[2]);
    s.ellipse(cx - 3, 19, 7, 8, ink[4]);
    s.hline(cx - 3, 15, 7, ink[3]);
    s.hline(cx - 2, 29, 5, ink[3]);
    s.vline(cx, 12, 3, ink[3]);
    s.px(cx, 11, ink[4]);
  } else if (variant % 3 === 1) {
    // a bell
    for (let j = 0; j < 12; j++) {
      const hw = 2 + Math.round(Math.pow(j / 11, 0.7) * 5);
      for (let x = cx - hw; x <= cx + hw; x++) s.px(x, 16 + j, x < cx ? ink[3] : ink[2]);
    }
    s.hline(cx - 8, 28, 17, ink[4]);
    s.px(cx, 29, ink[3]);
    s.px(cx, 30, ink[2]);
    s.vline(cx, 13, 3, ink[3]);
  } else {
    // three tones: the trial's own emblem
    const cols = [P.BELL_TONE[3], P.TONE_ROSE[3], P.TONE_TEAL[3]];
    for (let i = 0; i < 3; i++) {
      const px = cx - 6 + i * 6, py = 18 + (i === 1 ? -3 : 0);
      s.ellipse(px - 3, py - 3, 7, 7, cols[i]);
      s.ellipse(px - 2, py - 2, 4, 4, P.mix(cols[i], '#ffffff', 0.35));
      s.ellipseOutline(px - 3, py - 3, 7, 7, ink[2]);
    }
    s.hline(cx - 8, 27, 17, ink[3]);
    s.hline(cx - 6, 29, 13, ink[1]);
  }
  // tassels
  for (const tx of [cx - 7, cx, cx + 7]) {
    for (let j = 0; j < 3; j++) s.px(tx, 47 + j, j === 0 ? P.UI_GOLD[3] : P.UI_GOLD[1]);
  }
  rim(s, P.OUTLINE, 0.85);
  return s;
}

/** Six hanging paper lanterns: different shapes, different warm colours. */
function paperLantern(variant: number, pulse: number): Surface {
  const W = 22, H = 30;
  const s = new Surface(W, H);
  const cx = 11;
  const ramps: Ramp[] = [P.LANTERN, P.TONE_ROSE, P.DYE_SAFFRON, P.WINDOW_AMBER, P.TONE_TEAL, P.PAPER_RED];
  const ramp = ramps[variant % ramps.length];
  const top = 6;
  const mask = new Surface(W, H);
  let bodyBot = 22;
  switch (variant % 6) {
    case 0: { // round globe
      mask.ellipse(cx - 8, top, 17, 16, '#ffffff');
      bodyBot = top + 15;
      break;
    }
    case 1: { // tall cylinder
      for (let y = top; y < top + 18; y++) for (let x = cx - 6; x <= cx + 6; x++) mask.px(x, y, '#ffffff');
      mask.ellipse(cx - 6, top - 2, 13, 5, '#ffffff');
      mask.ellipse(cx - 6, top + 15, 13, 5, '#ffffff');
      bodyBot = top + 18;
      break;
    }
    case 2: { // teardrop: narrow shoulder, heavy belly, drawn to a point
      for (let y = top; y < top + 20; y++) {
        const t = (y - top) / 19;
        const hw = t < 0.62
          ? Math.round(1.5 + Math.pow(t / 0.62, 0.62) * 6.5)
          : Math.round(8 - Math.pow((t - 0.62) / 0.38, 1.5) * 8);
        for (let x = cx - hw; x <= cx + hw; x++) mask.px(x, y, '#ffffff');
      }
      bodyBot = top + 19;
      break;
    }
    case 3: { // hexagonal: flat top, hard shoulders, straight sides
      for (let y = top; y < top + 18; y++) {
        const t = (y - top) / 17;
        const hw = t < 0.22 ? Math.round(3 + (t / 0.22) * 4) : t > 0.80 ? Math.round(7 - ((t - 0.80) / 0.20) * 4) : 7;
        for (let x = cx - hw; x <= cx + hw; x++) mask.px(x, y, '#ffffff');
      }
      bodyBot = top + 17;
      break;
    }
    case 4: { // squat melon
      mask.ellipse(cx - 9, top + 2, 19, 13, '#ffffff');
      bodyBot = top + 14;
      break;
    }
    default: { // tall oval
      mask.ellipse(cx - 6, top - 1, 13, 21, '#ffffff');
      bodyBot = top + 19;
      break;
    }
  }
  const lit = pulse > 0;
  const paper = lit ? ramp : dimPaper(ramp[2]);
  if (lit) paperShade(s, mask, ramp, cx - 1, (top + bodyBot) / 2, 9 * (1 + pulse * 0.06), (bodyBot - top) * 0.62, 0.94 + pulse * 0.10);
  else dirShade(s, mask, paper, cx - 5, top + 2, 0.045, 0.04, 0.66);
  // ribs / gores
  if (variant % 6 === 3) {
    // hex: straight corner posts and two rails, so the facets read
    for (const off of [-7, -3, 3, 7]) {
      for (let y = top + 3; y <= bodyBot - 3; y++) {
        s.pxOver(cx + off, y, off < 0 ? P.IRON[4] : P.IRON[1], Math.abs(off) === 7 ? 0.55 : 0.35);
      }
    }
    for (const ry of [top + 3, bodyBot - 3]) {
      for (let x = cx - 7; x <= cx + 7; x++) s.pxOver(x, ry, P.IRON[2], 0.5);
    }
  } else {
    const gores = [-6, -2, 2, 6];
    for (const off of gores) {
      for (let y = top; y <= bodyBot; y++) {
        const t = (y - (top + bodyBot) / 2) / ((bodyBot - top) / 2);
        const x = Math.round(cx + off * Math.sqrt(Math.max(0, 1 - t * t * 0.7)));
        s.pxOver(x, y, off < 0 ? paper[4] : paper[0], off < 0 ? 0.26 : 0.36);
      }
    }
  }
  // caps and the cord it hangs from
  s.hline(cx - 3, top - 1, 7, P.IRON[3]);
  s.hline(cx - 3, top, 7, P.IRON[1]);
  s.hline(cx - 2, bodyBot, 5, P.IRON[0], 0.85);
  s.vline(cx, 0, top - 1, P.ROPE[2]);
  s.px(cx + 1, 2, P.ROPE[0], 0.6);
  // tassel
  for (let j = 1; j <= 3; j++) s.px(cx, bodyBot + j, j === 3 ? P.UI_GOLD[1] : P.UI_GOLD[3]);
  if (lit) {
    s.px(cx - 1, Math.round((top + bodyBot) / 2), P.LANTERN[4]);
    glow(s, cx, (top + bodyBot) / 2, 13 + pulse * 2, ramp[3], 0.34 + pulse * 0.08);
    glow(s, cx, (top + bodyBot) / 2, 7, ramp[4], 0.28 + pulse * 0.10);
  }
  rim(s, P.OUTLINE, 0.7);
  return s;
}

/** A little lantern raft drifting on the river. */
function lanternFloat(variant: number, frame: number): Surface {
  const W = 20, H = 18;
  const s = new Surface(W, H);
  const cx = 10;
  const bob = [0, -1, 0, 1][frame % 4];
  const ramps: Ramp[] = [P.LANTERN, P.TONE_ROSE, P.DYE_SAFFRON];
  const ramp = ramps[variant % ramps.length];
  // ripple rings on the water, widening with the frame
  for (let k = 0; k < 2; k++) {
    const rw = 12 + frame * 2 + k * 4;
    const rh = Math.max(3, Math.round(rw * 0.30));
    s.ellipseOutline(cx - Math.round(rw / 2), 14 - Math.round(rh / 2), rw, rh, k ? P.WATER[3] : P.WATER_FOAM, 0.55 - k * 0.18 - frame * 0.05);
  }
  // reflected light on the water
  for (let j = 0; j < 4; j++) {
    const w = 5 - j;
    for (let i = -w; i <= w; i++) {
      if (((i + j + frame) & 1) === 0) continue;
      s.px(cx + i, 13 + j, ramp[3], 0.3 - j * 0.06);
    }
  }
  // raft: a small board with folded paper sides
  s.rect(cx - 6, 11 + bob, 13, 2, P.WOOD[2]);
  s.hline(cx - 6, 11 + bob, 13, P.WOOD[4]);
  s.hline(cx - 6, 12 + bob, 13, P.WOOD[0]);
  for (const px of [cx - 6, cx + 6]) s.px(px, 10 + bob, P.WOOD[1]);
  // paper shade
  const mask = new Surface(W, H);
  for (let y = 4 + bob; y <= 10 + bob; y++) {
    const t = (y - (4 + bob)) / 6;
    const hw = variant % 3 === 1 ? 4 : Math.round(2 + t * 3);
    for (let x = cx - hw; x <= cx + hw; x++) mask.px(x, y, '#ffffff');
  }
  paperShade(s, mask, ramp, cx - 1, 8 + bob, 6, 5, 1);
  s.hline(cx - 2, 3 + bob, 5, P.IRON[2]);
  s.px(cx, 2 + bob, P.IRON[3]);
  s.px(cx - 1, 7 + bob, P.LANTERN[4]);
  glow(s, cx, 7 + bob, 9, ramp[3], 0.38);
  glow(s, cx, 7 + bob, 5, ramp[4], 0.3);
  return s;
}

/** Path-side lanterns that line the festival route. */
function groundLantern(variant: number): Surface {
  const W = 18, H = 26;
  const s = new Surface(W, H);
  const cx = 9;
  const ramps: Ramp[] = [P.LANTERN, P.WINDOW_AMBER, P.DYE_SAFFRON];
  const ramp = ramps[variant % ramps.length];
  if (variant === 0) {
    // stone cup with a candle
    cylinder(s, 2, 14, 14, 11, 6, P.STONE_WALL);
    s.ellipse(3, 13, 12, 5, P.SOOT[1]);
    const mask = new Surface(W, H);
    for (let y = 6; y < 14; y++) for (let x = cx - 3; x <= cx + 3; x++) mask.px(x, y, '#ffffff');
    paperShade(s, mask, ramp, cx - 1, 11, 5, 7, 1);
    s.px(cx - 1, 5, ramp[4]);
    s.px(cx - 1, 4, ramp[3]);
    s.px(cx, 5, ramp[2]);
  } else if (variant === 1) {
    // a small paper lantern on three sticks
    for (const [lx, dir] of [[4, -1], [14, 1], [9, 0]] as const) {
      for (let i = 0; i < 8; i++) s.px(lx + dir * Math.round(i * 0.3), 17 + i, dir < 0 ? P.WOOD[3] : P.WOOD[1]);
    }
    const mask = new Surface(W, H);
    mask.ellipse(cx - 6, 5, 13, 13, '#ffffff');
    paperShade(s, mask, ramp, cx - 1, 11, 8, 8, 1);
    s.hline(cx - 2, 4, 5, P.IRON[2]);
    s.hline(cx - 2, 17, 5, P.IRON[0]);
    s.px(cx - 1, 11, P.LANTERN[4]);
  } else {
    // a squat clay lamp
    cylinder(s, 1, 16, 16, 9, 6, P.TERRACOTTA);
    s.ellipse(3, 12, 12, 8, P.TERRACOTTA[3]);
    s.ellipse(5, 13, 8, 5, P.SOOT[1]);
    for (let j = 0; j < 6; j++) {
      const w = 3 - Math.floor(j / 2);
      for (let i = -w; i <= w; i++) {
        s.px(cx + i, 13 - j, Math.abs(i) >= w ? ramp[2] : j > 3 ? ramp[4] : ramp[3]);
      }
    }
    s.px(cx - 1, 10, P.LANTERN[4]);
  }
  glow(s, cx, variant === 1 ? 11 : 10, 13, ramp[3], 0.36);
  glow(s, cx, variant === 1 ? 11 : 10, 7, ramp[4], 0.28);
  rim(s, P.OUTLINE, 0.85);
  contact(s, cx, 25, 16, 5, 0.3);
  return s;
}

/** The flower arch at the plaza entrance. */
function flowerArch(): Surface {
  const W = 64, H = 72;
  const s = new Surface(W, H);
  const cx = 32;
  // posts
  for (const px of [8, 53]) {
    for (let y = 20; y < 68; y++) {
      for (let dx = 0; dx < 4; dx++) {
        const u = dx / 3;
        s.px(px + dx, y, u < 0.25 ? P.WOOD_LIGHT[4] : u < 0.55 ? P.WOOD_LIGHT[3] : u < 0.8 ? P.WOOD_LIGHT[2] : P.WOOD[0]);
      }
    }
    grain(s, px, 20, 4, 48, P.WOOD_LIGHT, 8100 + px, false);
    s.hline(px - 1, 66, 6, P.WOOD[1]);
    s.hline(px - 1, 67, 6, P.OUTLINE, 0.7);
  }
  // the arch itself
  const arch = (r: number, thick: number, fn: (x: number, y: number, t: number) => void) => {
    for (let a = 0; a <= 180; a += 1) {
      const th = (a / 180) * Math.PI;
      for (let k = 0; k < thick; k++) {
        const rr = r - k;
        const x = Math.round(cx - Math.cos(th) * rr);
        const y = Math.round(42 - Math.sin(th) * rr);
        fn(x, y, k / Math.max(1, thick - 1));
      }
    }
  };
  arch(22, 4, (x, y, t) => s.px(x, y, t < 0.3 ? P.WOOD_LIGHT[4] : t < 0.6 ? P.WOOD_LIGHT[3] : t < 0.85 ? P.WOOD_LIGHT[2] : P.WOOD[0]));
  // foliage wrapped around the arch and down the posts
  const fr = rng(8200);
  const leafAt = (x: number, y: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const ox = fr.int(-3, 3), oy = fr.int(-3, 3);
      const ramp = fr.chance(0.4) ? P.TREE_WARM : P.BUSH;
      const lit = oy < 0 || ox < 0;
      s.px(x + ox, y + oy, lit ? ramp[3] : ramp[1]);
      s.px(x + ox, y + oy + 1, ramp[0], 0.7);
      if (fr.chance(0.5)) s.px(x + ox + 1, y + oy, lit ? ramp[4] : ramp[2]);
    }
  };
  arch(22, 1, (x, y) => { if (fr.chance(0.55)) leafAt(x, y, 2); });
  arch(26, 1, (x, y) => { if (fr.chance(0.35)) leafAt(x, y, 2); });
  for (const px of [10, 55]) for (let y = 24; y < 66; y += 3) if (fr.chance(0.75)) leafAt(px, y, 2);
  // flowers, clustered rather than sprinkled
  const flowerRamps = [P.FLOWER_ROSE, P.FLOWER_GOLD, P.FLOWER_WHITE, P.BLOSSOM];
  const bloom = (x: number, y: number, ramp: readonly string[]) => {
    const n = ramp.length;
    s.px(x, y, ramp[n - 1]);
    s.px(x - 1, y, ramp[n - 3]);
    s.px(x + 1, y, ramp[n - 3]);
    s.px(x, y - 1, ramp[n - 2]);
    s.px(x, y + 1, ramp[n - 4 < 0 ? 0 : n - 4]);
    s.px(x + 1, y + 1, P.OUTLINE, 0.3);
  };
  arch(23, 1, (x, y) => { if (fr.chance(0.16)) bloom(x, y, fr.pick(flowerRamps)); });
  arch(20, 1, (x, y) => { if (fr.chance(0.12)) bloom(x, y, fr.pick(flowerRamps)); });
  for (const px of [10, 55]) for (let y = 26; y < 64; y += 4) if (fr.chance(0.5)) bloom(px + fr.int(-1, 2), y, fr.pick(flowerRamps));
  // hanging lanterns and ribbons under the crown
  hangLantern(s, cx, 22, P.LANTERN, 1);
  hangLantern(s, cx - 15, 27, P.WINDOW_AMBER, 0);
  hangLantern(s, cx + 15, 27, P.WINDOW_AMBER, 0);
  for (const [rx, ramp] of [[18, P.CARPET_RED], [46, P.DYE_SEA]] as const) {
    for (let j = 0; j < 9; j++) {
      s.px(rx + Math.round(Math.sin(j * 0.7) * 1.5), 30 + j, (ramp as Ramp)[j % 2 ? 2 : 3]);
      s.px(rx + 1 + Math.round(Math.sin(j * 0.7) * 1.5), 30 + j, (ramp as Ramp)[0], 0.7);
    }
  }
  rim(s, P.OUTLINE, 0.85);
  contact(s, 10, 71, 16, 5, 0.3);
  contact(s, 55, 71, 16, 5, 0.3);
  return s;
}

/** Drifting petals for the festival particle system. */
function petal(variant: number): Surface {
  const W = 8, H = 8;
  const s = new Surface(W, H);
  const ramps = [P.BLOSSOM, P.FLOWER_ROSE as unknown as Ramp, P.BLOSSOM, P.FLOWER_WHITE as unknown as Ramp];
  const ramp = ramps[variant % ramps.length];
  const hi = ramp.length - 1;
  if (variant % 4 === 0) {
    s.px(2, 3, ramp[hi - 1]); s.px(3, 2, ramp[hi]); s.px(4, 2, ramp[hi]);
    s.px(3, 3, ramp[hi]); s.px(4, 3, ramp[hi - 1]); s.px(5, 3, ramp[hi - 2]);
    s.px(4, 4, ramp[hi - 2]);
  } else if (variant % 4 === 1) {
    s.px(3, 2, ramp[hi]); s.px(3, 3, ramp[hi]); s.px(4, 3, ramp[hi - 1]);
    s.px(3, 4, ramp[hi - 2]); s.px(2, 3, ramp[hi - 1]);
  } else if (variant % 4 === 2) {
    s.px(2, 2, ramp[hi - 1]); s.px(3, 2, ramp[hi]); s.px(4, 3, ramp[hi]);
    s.px(5, 4, ramp[hi - 2]); s.px(3, 3, ramp[hi - 1]);
  } else {
    s.px(3, 3, ramp[hi]); s.px(4, 3, ramp[hi - 1]); s.px(3, 4, ramp[hi - 2]);
  }
  return s;
}

/** Confetti scraps thrown when the trial resolves. */
function confetti(variant: number): Surface {
  const W = 8, H = 8;
  const s = new Surface(W, H);
  const sets: Ramp[] = [P.DYE_SAFFRON, P.TONE_ROSE, P.DYE_SEA, P.UI_GOLD];
  const ramp = sets[variant % sets.length];
  if (variant % 4 === 0) {
    s.rect(2, 3, 3, 2, ramp[3]);
    s.hline(2, 3, 3, ramp[4]);
    s.px(4, 4, ramp[1]);
  } else if (variant % 4 === 1) {
    // a curl
    s.px(2, 4, ramp[2]); s.px(3, 3, ramp[3]); s.px(4, 3, ramp[4]); s.px(5, 4, ramp[2]);
    s.px(3, 4, ramp[1]);
  } else if (variant % 4 === 2) {
    s.px(3, 2, ramp[4]); s.px(4, 3, ramp[3]); s.px(3, 4, ramp[2]); s.px(2, 3, ramp[3]);
  } else {
    s.rect(3, 2, 2, 4, ramp[2]);
    s.px(3, 2, ramp[4]);
    s.px(4, 5, ramp[0]);
  }
  return s;
}

// ── crowd furniture ────────────────────────────────────────────────────────
//
// The conformity quest needs the player to feel *surrounded* — a ring of
// villagers whose attention is on the stage. A map author cannot build that
// from NPC positions alone: the crowd needs a boundary to gather along. These
// two pieces let them arc a barrier around the trial stage, which both shapes
// the gathering and keeps the walkable route obvious.

/** A short post with a brass ring, for the crowd rope. */
function crowdPost(): Surface {
  const W = 12, H = 28;
  const s = new Surface(W, H);
  const cx = 5;
  for (let y = 6; y < 25; y++) {
    for (let dx = 0; dx < 4; dx++) {
      const u = dx / 3;
      s.px(cx + dx - 1, y, u < 0.25 ? P.WOOD_LIGHT[4] : u < 0.55 ? P.WOOD_LIGHT[3] : u < 0.8 ? P.WOOD_LIGHT[2] : P.WOOD[0]);
    }
  }
  grain(s, cx - 1, 6, 4, 19, P.WOOD_LIGHT, 8800, false);
  // turned collar and a brass finial
  s.hline(cx - 2, 8, 6, P.BRONZE[2]);
  s.hline(cx - 2, 9, 6, P.BRONZE[0]);
  s.ellipse(cx - 2, 2, 6, 6, P.BRONZE[2]);
  s.ellipse(cx - 1, 3, 4, 4, P.BRONZE[3]);
  s.px(cx, 4, P.BRONZE[4]);
  s.px(cx + 2, 6, P.BRONZE[0]);
  // the ring the rope threads through
  s.ellipseOutline(cx - 3, 10, 8, 5, P.BRONZE[2]);
  s.px(cx - 3, 12, P.BRONZE[4]);
  s.px(cx + 4, 13, P.BRONZE[0]);
  // foot
  s.ellipse(cx - 4, 22, 10, 5, P.WOOD[1]);
  s.hline(cx - 3, 24, 8, P.OUTLINE, 0.5);
  rim(s, P.OUTLINE, 0.9);
  contact(s, cx, 27, 12, 5, 0.32);
  return s;
}

/** A sagging velvet rope between two posts. Three sags, so runs look placed. */
function crowdRope(variant: number): Surface {
  const W = 32, H = 20;
  const s = new Surface(W, H);
  const top = 3, sag = [6, 8, 5][variant % 3];
  const ramp = P.CARPET_RED;
  for (let x = 0; x < W; x++) {
    const y = Math.round(cableY(x, W, top, sag));
    s.px(x, y, ramp[3]);
    s.px(x, y + 1, ramp[2]);
    s.px(x, y + 2, ramp[0], 0.85);
    if (x % 4 === 1) s.px(x, y, ramp[4], 0.6);
  }
  // gold ferrules at both ends
  for (const ex of [0, 1, W - 2, W - 1]) {
    const y = Math.round(cableY(ex, W, top, sag));
    s.px(ex, y, P.UI_GOLD[3]);
    s.px(ex, y + 1, P.UI_GOLD[2]);
    s.px(ex, y + 2, P.UI_GOLD[0]);
  }
  return s;
}

// ── festival ground ────────────────────────────────────────────────────────

/** Plaza paving, dressed for the festival with painted lines and chalk. */
function plazaFlagTile(variant: number): Surface {
  const s = new Surface(TILE, TILE);
  const ramp = P.PATH_STONE;
  const n1 = valueNoise(8300 + variant * 17);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const v = n1(x, y, 3.4);
      s.px(x, y, v > 0.78 ? ramp[4] : v > 0.30 ? ramp[3] : ramp[2]);
    }
  }
  // flagstone joints, staggered per variant
  const cuts = [0, 6, 11, 16];
  for (const cy of cuts) {
    for (let x = 0; x < TILE; x++) {
      const j = Math.round(Math.sin((x + variant * 3) * 0.8) * 0.6);
      s.pxOver(x, cy + j, ramp[1], 0.85);
      s.pxOver(x, cy + j + 1, ramp[4], 0.5);
    }
  }
  const stagger = [3, 9, 13, 5];
  for (let band = 0; band < cuts.length - 1; band++) {
    const sx = (stagger[(band + variant) % stagger.length] + variant * 2) % 16;
    for (let y = cuts[band] + 1; y < cuts[band + 1]; y++) s.pxOver(sx, y, ramp[1], 0.8);
  }
  // festival dressing
  // Festival dressing. The runtime shuffles variants within a family per world
  // position, so nothing here may be directional: a painted line would land in
  // random broken segments and read as damage. Linear ceremony is the carpet
  // blob's job; these four are shuffle-safe.
  const r = rng(8400 + variant * 31);
  if (variant === 0) {
    // swept clean, a few flecks of confetti in the joints
    for (let i = 0; i < 3; i++) {
      const px = r.int(0, TILE - 1), py = r.int(0, TILE - 1);
      s.px(px, py, r.pick([P.DYE_SAFFRON[3], P.CANVAS[4], P.TONE_ROSE[3]]), 0.55);
    }
  } else if (variant === 1) {
    // trodden petals and confetti
    for (let i = 0; i < 8; i++) {
      const px = r.int(0, TILE - 2), py = r.int(0, TILE - 2);
      const c = r.pick([P.BLOSSOM[3], P.DYE_SAFFRON[3], P.DYE_SEA[3], P.TONE_ROSE[3], P.UI_GOLD[3]]);
      s.px(px, py, c, 0.85);
      if (r.chance(0.55)) s.px(px + 1, py, c, 0.5);
      if (r.chance(0.3)) s.px(px, py + 1, P.OUTLINE, 0.25);
    }
  } else if (variant === 2) {
    // chalk: where a stall was pitched, plus a scuff
    for (let a = 0; a < 34; a++) {
      const th = (a / 34) * Math.PI * 2;
      s.px(Math.round(8 + Math.cos(th) * 5.5), Math.round(8 + Math.sin(th) * 4.5), P.CANVAS[4], 0.30);
    }
    s.px(8, 8, P.CANVAS[4], 0.35);
    for (let i = 0; i < 3; i++) s.px(r.int(1, 14), r.int(1, 14), P.CANVAS[3], 0.3);
  } else {
    // a faded painted lantern motif, outlined not filled, so that at one tile
    // in four it reads as old ceremonial paintwork rather than as litter
    const cx = 8, cy = 9;
    const A = 0.34;
    for (const [dx, dy] of [
      [-2, -3], [-1, -3], [0, -3], [1, -3],
      [-3, -2], [2, -2], [-3, -1], [2, -1], [-3, 0], [2, 0], [-3, 1], [2, 1],
      [-2, 2], [-1, 2], [0, 2], [1, 2],
    ] as const) s.px(cx + dx, cy + dy, P.UI_GOLD[3], A);
    s.px(cx - 1, cy - 4, P.UI_GOLD[2], A * 0.8);
    s.px(cx, cy - 4, P.UI_GOLD[2], A * 0.8);
    s.px(cx - 1, cy + 3, P.UI_GOLD[1], A * 0.8);
    s.px(cx, cy + 3, P.UI_GOLD[1], A * 0.8);
    s.px(cx - 1, cy - 5, P.UI_GOLD[2], A * 0.6);
    s.px(cx - 1, cy - 1, P.UI_GOLD[4], A * 0.9);
  }
  return s;
}

/**
 * Edge classification for a blob coverage mask.
 *
 * The shared `edgePixels` treats the tile's own border as "outside", which is
 * right for a lone tile but wrong for a material that runs across many tiles:
 * it hems every tile boundary and the run reads as a grid. Here an
 * out-of-bounds neighbour counts as covered, so only real material edges are
 * returned.
 */
function runEdges(cov: Surface) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cov.w || y >= cov.h ? 1 : cov.alphaAt(x, y) ? 1 : 0);
  const top: Array<[number, number]> = [];
  const bottom: Array<[number, number]> = [];
  const side: Array<[number, number]> = [];
  for (let y = 0; y < cov.h; y++) {
    for (let x = 0; x < cov.w; x++) {
      if (!cov.alphaAt(x, y)) continue;
      if (!at(x, y - 1)) top.push([x, y]);
      else if (!at(x, y + 1)) bottom.push([x, y]);
      else if (!at(x - 1, y) || !at(x + 1, y)) side.push([x, y]);
    }
  }
  return { top, bottom, side, at };
}

/** The ceremonial runner laid down the centre of the plaza. */
function carpetPainter(coverage: Surface, _mask: number, r: Rng): Surface {
  const s = new Surface(TILE, TILE);
  const ramp = P.CARPET_RED;
  const n = valueNoise(8500);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (coverage.alphaAt(x, y) === 0) continue;
      const v = n(x, y, 2.6);
      // woven texture: a fine weft, low contrast
      const weave = ((x + y) & 1) === 0 ? 1 : 0;
      s.px(x, y, v > 0.70 ? ramp[4] : v < 0.30 ? ramp[2] : ramp[2 + weave]);
      if (((x * 3 + y) & 7) === 0) s.px(x, y, ramp[2], 0.45);
    }
  }
  // woven motif: a repeating diamond, low contrast, so the runner reads as
  // patterned cloth rather than as a flat red rectangle
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (coverage.alphaAt(x, y) === 0) continue;
      const d = Math.abs((x % 8) - 4) + Math.abs((y % 8) - 4);
      if (d === 4) s.px(x, y, ramp[4], 0.30);
      else if (d === 3) s.px(x, y, ramp[3], 0.35);
      else if (d === 0) s.px(x, y, P.UI_GOLD[2], 0.45);
    }
  }
  speckle(s, r, 0, 0, TILE, TILE, ramp[1], 6, 0.3);
  // hem: gold on the outer pixel, plus an inset gold thread two in from the
  // sides — both derived from the run's real edges, not the tile's border
  const { top, bottom, side, at } = runEdges(coverage);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (coverage.alphaAt(x, y) === 0) continue;
      const gapL = !at(x - 2, y) && at(x - 1, y);
      const gapR = !at(x + 2, y) && at(x + 1, y);
      if (gapL || gapR) s.px(x, y, gapL ? P.UI_GOLD[3] : P.UI_GOLD[1], 0.6);
    }
  }
  for (const [x, y] of top) {
    s.px(x, y, P.UI_GOLD[3], 0.9);
    s.px(x, y + 1, P.UI_GOLD[1], 0.5);
  }
  for (const [x, y] of bottom) {
    s.px(x, y, ramp[0]);
    s.px(x, y - 1, ramp[1], 0.6);
  }
  for (const [x, y] of side) s.px(x, y, P.UI_GOLD[2], 0.8);
  return s;
}

// ── food and small props ───────────────────────────────────────────────────

function skewer(): Surface {
  const W = 12, H = 20;
  const s = new Surface(W, H);
  s.vline(6, 2, 17, P.WOOD_LIGHT[3]);
  s.vline(7, 2, 17, P.WOOD[1]);
  s.px(6, 1, P.WOOD_LIGHT[4]);
  for (let k = 0; k < 3; k++) {
    const y = 3 + k * 5;
    s.rect(3, y, 8, 4, P.FOOD_MEAT[2]);
    s.hline(3, y, 8, P.FOOD_MEAT[3]);
    s.hline(4, y, 6, P.FOOD_MEAT[4]);
    s.hline(3, y + 3, 8, P.FOOD_MEAT[0]);
    s.px(10, y + 1, P.FOOD_MEAT[1]);
    if (k < 2) {
      s.rect(4, y + 4, 6, 1, P.VEG_LEAF[2]);
      s.px(5, y + 4, P.VEG_LEAF[4]);
    }
  }
  rim(s, P.OUTLINE, 0.85);
  contact(s, 6, 19, 8, 3, 0.28);
  return s;
}

function breadBasket(): Surface {
  const W = 24, H = 20;
  const s = new Surface(W, H);
  // loaves first, basket in front
  for (let i = 0; i < 3; i++) {
    const bx = 3 + i * 6;
    s.ellipse(bx, 2, 8, 7, P.FOOD_BREAD[1]);
    s.ellipse(bx + 1, 2, 6, 6, P.FOOD_BREAD[3]);
    s.px(bx + 2, 4, P.FOOD_BREAD[4]);
    s.px(bx + 4, 3, P.FOOD_BREAD[0], 0.6);
    s.px(bx + 3, 5, P.FOOD_BREAD[2]);
  }
  cylinder(s, 1, 7, 22, 12, 7, P.ROPE, { lid: false });
  for (let x = 2; x < 22; x += 3) {
    for (let y = 9; y < 17; y++) s.pxOver(x, y, P.ROPE[1], 0.45);
  }
  for (let y = 10; y < 17; y += 3) s.hline(1, y, 22, P.ROPE[4], 0.3);
  s.hline(1, 8, 22, P.ROPE[4], 0.7);
  rim(s, P.OUTLINE, 0.85);
  contact(s, 12, 19, 20, 5, 0.3);
  return s;
}

function fruitBowl(): Surface {
  const W = 22, H = 18;
  const s = new Surface(W, H);
  const fruits: Ramp[] = [P.FLOWER_ROSE as unknown as Ramp, P.DYE_SAFFRON, P.VEG_LEAF, P.DYE_SAFFRON, P.FLOWER_ROSE as unknown as Ramp];
  for (let i = 0; i < 5; i++) {
    const fx = 3 + (i % 3) * 6, fy = 2 + (i > 2 ? 3 : 0);
    const ramp = fruits[i];
    s.ellipse(fx, fy, 6, 6, ramp[1]);
    s.ellipse(fx + 1, fy + 1, 4, 4, ramp[2]);
    s.px(fx + 1, fy + 1, ramp[3]);
    s.px(fx + 4, fy + 4, ramp[0]);
  }
  s.px(9, 1, P.VEG_LEAF[3]);
  s.px(10, 0, P.VEG_LEAF[4]);
  // glazed bowl
  const bowl = new Surface(W, H);
  for (let y = 9; y < 17; y++) {
    const t = (y - 9) / 8;
    const hw = Math.round(10 * Math.sqrt(Math.max(0, 1 - t * t)));
    for (let x = 11 - hw; x <= 11 + hw; x++) bowl.px(x, y, '#ffffff');
  }
  dirShade(s, bowl, P.TERRACOTTA, 5, 10, 0.05, 0.05, 0.66);
  s.hline(1, 9, 21, P.TERRACOTTA[4], 0.85);
  s.hline(2, 10, 19, P.TERRACOTTA[1], 0.4);
  for (let x = 4; x < 19; x += 4) s.px(x, 12, P.CANVAS[3], 0.7);
  rim(s, P.OUTLINE, 0.85);
  contact(s, 11, 17, 18, 5, 0.3);
  return s;
}

function pieStack(): Surface {
  const W = 20, H = 22;
  const s = new Surface(W, H);
  for (let k = 2; k >= 0; k--) {
    const y = 5 + k * 5;
    // tin
    s.ellipse(2, y + 3, 16, 6, P.METAL[2]);
    s.rect(2, y + 3, 16, 3, P.METAL[2]);
    s.hline(2, y + 5, 16, P.METAL[0]);
    s.hline(2, y + 3, 16, P.METAL[4], 0.6);
    // filling / crust
    s.ellipse(3, y, 14, 6, P.FOOD_BREAD[2]);
    s.ellipse(4, y, 12, 5, P.FOOD_BREAD[3]);
    s.px(7, y + 1, P.FOOD_BREAD[4]);
    s.px(11, y + 2, P.FOOD_BREAD[1]);
    // lattice
    for (let i = 0; i < 3; i++) s.px(6 + i * 3, y + 2, P.FOOD_BREAD[0], 0.5);
    s.hline(5, y + 2, 10, P.FOOD_BREAD[4], 0.25);
  }
  rim(s, P.OUTLINE, 0.85);
  contact(s, 10, 21, 18, 5, 0.3);
  return s;
}

function drinkBarrel(): Surface {
  const W = 30, H = 34;
  const s = new Surface(W, H);
  // trestle
  for (const [lx, dir] of [[5, -1], [23, 1]] as const) {
    for (let i = 0; i < 8; i++) s.px(lx + dir * Math.round(i * 0.45), 25 + i, dir < 0 ? P.WOOD[3] : P.WOOD[1]);
    for (let i = 0; i < 8; i++) s.px(lx + dir * Math.round(i * 0.45) + 1, 25 + i, P.WOOD[0], 0.8);
  }
  s.hline(4, 28, 21, P.WOOD[2]);
  s.hline(4, 29, 21, P.WOOD[0]);

  // the barrel lying on its side: a horizontal cylinder, lit along the top-left
  const top = 4, bot = 26, cy = (top + bot) / 2;
  const halfAt = (x: number) => {
    const t = (x - 3) / 22;
    return ((bot - top) / 2) * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.5) * 2, 2) * 0.22));
  };
  for (let x = 3; x <= 25; x++) {
    const hh = halfAt(x);
    for (let y = Math.round(cy - hh); y <= Math.round(cy + hh); y++) {
      const v = (y - (cy - hh)) / Math.max(1, hh * 2);
      const R = P.WOOD_LIGHT;
      const c = v < 0.10 ? R[1] : v < 0.26 ? R[3] : v < 0.44 ? R[4] : v < 0.70 ? R[2] : v < 0.88 ? R[1] : R[0];
      s.px(x, y, c);
    }
  }
  // staves
  for (let x = 5; x <= 24; x += 3) {
    const hh = halfAt(x);
    for (let y = Math.round(cy - hh) + 1; y <= Math.round(cy + hh) - 1; y++) s.px(x, y, P.WOOD[0], 0.18);
  }
  // the top of the barrel catches the lantern light
  for (let x = 3; x <= 25; x++) {
    const hh = halfAt(x);
    s.px(x, Math.round(cy - hh) + 1, P.WOOD_LIGHT[4], 0.5);
  }
  // iron hoops
  for (const bx of [7, 15, 22]) {
    const hh = halfAt(bx);
    for (let y = Math.round(cy - hh); y <= Math.round(cy + hh); y++) {
      const v = (y - (cy - hh)) / Math.max(1, hh * 2);
      s.px(bx, y, v < 0.30 ? P.IRON[4] : v < 0.68 ? P.IRON[2] : P.IRON[0]);
      s.px(bx + 1, y, P.IRON[0], 0.75);
    }
  }
  // the near end cap
  const capHalf = halfAt(3);
  s.ellipse(0, Math.round(cy - capHalf), 8, Math.round(capHalf * 2) + 1, P.WOOD[1]);
  for (let j = 0; j <= capHalf * 2; j++) {
    for (let i = 0; i < 8; i++) {
      if (s.alphaAt(i, Math.round(cy - capHalf) + j) === 0) continue;
      const v = j / Math.max(1, capHalf * 2);
      s.px(i, Math.round(cy - capHalf) + j, v < 0.24 ? P.WOOD_LIGHT[3] : v < 0.55 ? P.WOOD_LIGHT[2] : v < 0.8 ? P.WOOD[1] : P.WOOD[0]);
    }
  }
  for (let j = 0; j <= capHalf * 2; j += 3) s.hline(1, Math.round(cy - capHalf) + j, 6, P.WOOD[0], 0.35);
  s.ellipseOutline(0, Math.round(cy - capHalf), 8, Math.round(capHalf * 2) + 1, P.IRON[2], 0.8);
  // tap, pouring
  s.rect(24, 18, 4, 3, P.BRONZE[2]);
  s.hline(24, 18, 4, P.BRONZE[4]);
  s.px(27, 21, P.BRONZE[3]);
  s.px(27, 22, P.BRONZE[1]);
  s.px(26, 17, P.BRONZE[3]);
  s.px(26, 16, P.BRONZE[1]);
  for (let j = 0; j < 4; j++) s.px(27, 23 + j, P.LANTERN[3], 0.7 - j * 0.12);
  // a chalk mark and a bung on the top
  s.ellipse(12, 5, 5, 3, P.WOOD[0], 0.6);
  s.hline(13, 5, 3, P.WOOD_LIGHT[3], 0.7);
  rim(s, P.OUTLINE, 0.85);
  contact(s, 15, 33, 24, 6, 0.3);
  return s;
}

function mug(): Surface {
  const W = 12, H = 14;
  const s = new Surface(W, H);
  cylinder(s, 2, 3, 8, 10, 4, P.PLASTER, { lid: false });
  // froth + drink
  s.ellipse(2, 2, 8, 4, P.CANVAS[4]);
  s.ellipse(3, 3, 6, 3, P.CANVAS[3]);
  s.px(4, 3, P.CANVAS[4]);
  s.ellipse(3, 4, 6, 2, P.LANTERN[1], 0.5);
  // handle
  for (const [x, y] of [[10, 6], [11, 7], [11, 8], [10, 9]] as const) s.px(x, y, P.PLASTER[2]);
  s.px(10, 6, P.PLASTER[4]);
  s.px(11, 9, P.PLASTER[0]);
  rim(s, P.OUTLINE, 0.85);
  contact(s, 6, 13, 9, 4, 0.28);
  return s;
}

function prizeRibbon(): Surface {
  const W = 16, H = 22;
  const s = new Surface(W, H);
  const ramp = P.UI_GOLD;
  // tails
  for (let j = 0; j < 9; j++) {
    s.px(5 - Math.round(j * 0.2), 11 + j, P.CARPET_RED[2]);
    s.px(6 - Math.round(j * 0.2), 11 + j, P.CARPET_RED[3]);
    s.px(9 + Math.round(j * 0.2), 11 + j, P.CARPET_RED[1]);
    s.px(10 + Math.round(j * 0.2), 11 + j, P.CARPET_RED[0]);
  }
  s.px(5, 19, P.CARPET_RED[0]);
  s.px(10, 19, P.CARPET_RED[0]);
  // pleated rosette
  for (let a = 0; a < 12; a++) {
    const th = (a / 12) * Math.PI * 2;
    const x = Math.round(8 + Math.cos(th) * 6), y = Math.round(8 + Math.sin(th) * 6);
    s.px(x, y, a < 6 ? ramp[3] : ramp[1]);
    s.line(8, 8, x, y, a < 6 ? ramp[2] : ramp[1], 0.9);
  }
  s.ellipse(4, 4, 9, 9, ramp[2]);
  s.ellipse(5, 5, 7, 7, ramp[3]);
  s.ellipse(6, 6, 5, 5, ramp[1]);
  s.px(7, 7, ramp[4]);
  s.ellipseOutline(4, 4, 9, 9, ramp[0], 0.6);
  rim(s, P.OUTLINE, 0.8);
  return s;
}

function toyWindmill(): Surface {
  const W = 18, H = 30;
  const s = new Surface(W, H);
  const cx = 9;
  // stick
  s.vline(cx, 10, 19, P.WOOD_LIGHT[3]);
  s.vline(cx + 1, 10, 19, P.WOOD[1]);
  s.px(cx, 29, P.OUTLINE, 0.6);
  // four sails, alternating colours
  const ramps = [P.CARPET_RED, P.DYE_SAFFRON, P.DYE_SEA, P.TONE_ROSE];
  for (let q = 0; q < 4; q++) {
    const ramp = ramps[q];
    const th = (q / 4) * Math.PI * 2 + Math.PI / 4;
    const dx = Math.cos(th), dy = Math.sin(th);
    for (let r2 = 1; r2 <= 7; r2++) {
      const w = Math.round(r2 * 0.55);
      for (let k = -w; k <= w; k++) {
        const px = Math.round(cx + dx * r2 - dy * k * 0.9);
        const py = Math.round(9 + dy * r2 + dx * k * 0.9);
        const lit = k < 0;
        s.px(px, py, lit ? ramp[3] : r2 > 5 ? ramp[1] : ramp[2]);
      }
    }
  }
  s.px(cx, 9, P.UI_GOLD[4]);
  s.px(cx - 1, 9, P.UI_GOLD[2]);
  s.px(cx, 8, P.UI_GOLD[3]);
  s.px(cx + 1, 10, P.UI_GOLD[1]);
  rim(s, P.OUTLINE, 0.8);
  contact(s, cx, 29, 8, 3, 0.28);
  return s;
}

// ── registration ───────────────────────────────────────────────────────────

type LampFn = (st: LampState) => Surface;

function registerTrialLantern(b: ArtBuild, name: string, key: string, fn: LampFn) {
  b.add(`prop/fest/${name}`, fn(REST));
  b.add(`prop/fest/${name}_dim`, fn(DIM));

  const struck: Surface[] = [];
  const swing = [-2, 0, 2, 0];
  const halo = [1.28, 1.1, 1.22, 1.04];
  const ripple = [7, 11, 15, 19];
  for (let i = 0; i < 4; i++) {
    struck.push(fn({ lit: 1 + (halo[i] - 1) * 0.8, swing: swing[i], halo: halo[i], ripple: ripple[i], bloom: 0 }));
  }
  b.addStrip(`prop/fest/${name}_struck`, struck, { key: `${key}_struck`, frameRate: 10, repeat: -1 });

  const correct: Surface[] = [];
  const cHalo = [1.15, 1.42, 1.34, 1.18];
  for (let i = 0; i < 4; i++) {
    correct.push(fn({ lit: 1 + (cHalo[i] - 1) * 1.1, swing: 0, halo: cHalo[i], ripple: 0, bloom: (i + 1) / 4 }));
  }
  b.addStrip(`prop/fest/${name}_correct`, correct, { key: `${key}_correct`, frameRate: 8, repeat: 0 });
}

export function registerFestival(b: ArtBuild): void {
  // ── A. the Lantern Trial ────────────────────────────────────────────────
  registerTrialLantern(b, 'trial_lantern_a', 'lantern_a', trialLanternA);
  registerTrialLantern(b, 'trial_lantern_b', 'lantern_b', trialLanternB);
  registerTrialLantern(b, 'trial_lantern_c', 'lantern_c', trialLanternC);

  b.add('prop/fest/reference_lantern', referenceLantern(REST));
  b.add('prop/fest/reference_lantern_dim', referenceLantern(DIM));
  const refStruck: Surface[] = [];
  const swing = [-2, 0, 2, 0];
  const halo = [1.3, 1.12, 1.24, 1.05];
  const ripple = [7, 11, 15, 19];
  for (let i = 0; i < 4; i++) {
    refStruck.push(referenceLantern({ lit: 1 + (halo[i] - 1) * 0.8, swing: swing[i], halo: halo[i], ripple: ripple[i], bloom: 0 }));
  }
  b.addStrip('prop/fest/reference_lantern_struck', refStruck, {
    key: 'reference_lantern_struck', frameRate: 10, repeat: -1,
  });

  b.add('prop/fest/striker', striker());
  b.add('prop/fest/trial_stage', trialStage());

  // ── C1. string lights — the transformation's biggest lever ──────────────
  for (let i = 0; i < 3; i++) b.add(`prop/fest/string_lights_span_${i}`, stringSpan(i, 0, false));
  b.add('prop/fest/string_lights_pole', stringPole());
  const shimmer: Surface[] = [];
  for (let f = 0; f < 4; f++) shimmer.push(stringSpan(0, (f / 4) * Math.PI * 2, true));
  b.addStrip('prop/fest/string_lights_span_lit', shimmer, {
    key: 'string_lights_shimmer', frameRate: 4, repeat: -1,
  });

  // ── B. stalls ───────────────────────────────────────────────────────────
  b.add('prop/fest/stall_food_0', stallFoodAwning());
  b.add('prop/fest/stall_food_1', stallFoodGrill());
  b.add('prop/fest/stall_food_2', stallFoodWagon());
  b.add('prop/fest/stall_game_0', stallGameRing());
  b.add('prop/fest/stall_game_1', stallGameDip());
  b.add('prop/fest/stall_craft', stallCraft());
  b.add('prop/fest/stage_music', stageMusic());
  b.add('prop/fest/judging_table', judgingTable());

  const fire: Surface[] = [];
  for (let f = 0; f < 4; f++) fire.push(brazier(f));
  b.addStrip('prop/fest/brazier_fest', fire, { key: 'brazier_fest', frameRate: 8, repeat: -1 });

  for (let i = 0; i < 2; i++) b.add(`prop/fest/bench_fest_${i}`, benchFest(i));
  b.add('prop/fest/crate_stack_fest', crateStackFest());
  b.add('prop/fest/barrel_fest', barrelFest());

  // ── C2. decoration ──────────────────────────────────────────────────────
  for (let i = 0; i < 3; i++) b.add(`prop/fest/bunting_${i}`, bunting(i));
  for (let i = 0; i < 3; i++) b.add(`prop/fest/banner_${i}`, banner(i));

  for (let i = 0; i < 6; i++) {
    b.add(`prop/fest/paper_lantern_${i}`, paperLantern(i, 1));
    b.add(`prop/fest/paper_lantern_${i}_dim`, paperLantern(i, 0));
    const frames: Surface[] = [];
    for (let f = 0; f < 3; f++) frames.push(paperLantern(i, [1, 1.6, 1.25][f]));
    b.addStrip(`prop/fest/paper_lantern_${i}_glow`, frames, {
      key: i === 0 ? 'paper_lantern_glow' : `paper_lantern_${i}_glow`, frameRate: 3, repeat: -1,
    });
  }

  const floats: Surface[] = [];
  for (let f = 0; f < 4; f++) floats.push(lanternFloat(0, f));
  b.addStrip('prop/fest/lantern_float', floats, { key: 'lantern_float', frameRate: 4, repeat: -1 });
  for (const [name, v] of [['b', 1], ['c', 2]] as const) {
    const fr: Surface[] = [];
    for (let f = 0; f < 4; f++) fr.push(lanternFloat(v, f));
    b.addStrip(`prop/fest/lantern_float_${name}`, fr, { key: `lantern_float_${name}`, frameRate: 4, repeat: -1 });
  }

  for (let i = 0; i < 3; i++) b.add(`prop/fest/ground_lantern_${i}`, groundLantern(i));
  b.add('prop/fest/crowd_post', crowdPost());
  for (let i = 0; i < 3; i++) b.add(`prop/fest/crowd_rope_${i}`, crowdRope(i));
  b.add('prop/fest/flower_arch', flowerArch());
  for (let i = 0; i < 4; i++) b.add(`prop/fest/petal_${i}`, petal(i));
  for (let i = 0; i < 4; i++) b.add(`prop/fest/confetti_${i}`, confetti(i));

  // ── C3. festival ground ─────────────────────────────────────────────────
  for (let i = 0; i < 4; i++) b.addTile(`tile/fest/plaza_flag_${i}`, plazaFlagTile(i));
  registerBlobSet(b, 'blob/fest_carpet', 8600, carpetPainter, { wobble: 0.4, radius: 2.4 });

  // ── D. food and small props ─────────────────────────────────────────────
  b.add('prop/fest/skewer', skewer());
  b.add('prop/fest/bread_basket', breadBasket());
  b.add('prop/fest/fruit_bowl', fruitBowl());
  b.add('prop/fest/pie_stack', pieStack());
  b.add('prop/fest/drink_barrel', drinkBarrel());
  b.add('prop/fest/mug', mug());
  b.add('prop/fest/prize_ribbon', prizeRibbon());
  b.add('prop/fest/toy_windmill', toyWindmill());
}
