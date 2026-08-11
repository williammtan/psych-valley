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
}
