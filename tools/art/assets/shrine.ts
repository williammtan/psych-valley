/**
 * ECHO SHRINE — an abandoned research observatory under the valley, colonised
 * by the Echo. Carved stone, old brass instrumentation, dark blue-violet.
 *
 * THE ONE IDEA THIS MODULE IS BUILT ON
 * ────────────────────────────────────
 * A dungeon reads because of its *value ladder*, and here it is inverted from
 * the town: the architecture is the dark end and the gameplay is the light end.
 *
 *   void      (SHRINE_VOID,   L 3)    ← "not room". Genuinely black.
 *   wall face (SHRINE_STONE,  L 60)   ← the boundary band, carved and textured.
 *   floor     (SHRINE_FLOOR,  L 42)   ← quiet ground. Two ramp steps, no incident.
 *   operable  (SHRINE_MARBLE, L 140+) ← everything the player can act on.
 *
 * THE MATERIAL RULE — read this before adding anything to this file
 * ─────────────────────────────────────────────────────────────────
 * The first version of this module put architecture, floor and puzzle objects
 * inside one narrow dark band and the result was measurable: pressure plates at
 * 1.5:1 against the flagstone they stood on, switch nodes at 1.02:1 — a
 * difference of two luminance levels out of 255. Nothing the player could act
 * on left the floor's luminance envelope at either end, so the eye had no way
 * to sort "thing I can touch" from "thing I walk over".
 *
 * The fix is a material rule, not a per-sprite fix:
 *
 *   DARK CARVED STONE  = architecture. Walls, pillars, rubble, wreckage,
 *                        the wall band, the ground. You cannot touch it.
 *   PALE DRESSED MARBLE + LIVE BRASS = the observatory's *instruments*.
 *                        Plates, switches, levers, statues, blocks, coffers,
 *                        doors, gates. You can always touch it.
 *
 * Everything operable goes through `operable()` as its final step, which:
 *   (a) remaps its stone and brass to marble and live brass;
 *   (b) lays a 1 px SHRINE_INK silhouette — darker than the floor's darkest
 *       pixel — plus a hard contact shadow, so it is pinned to the ground;
 *   (c) rims its top and left edges in SHRINE_MARBLE[4] — brighter than the
 *       floor's brightest pixel.
 *
 * (b) and (c) together are the property the ALTTP reference has and we did
 * not: the sprite contains pixels both darker *and* brighter than any floor
 * pixel. `tools/art/contrast_check.ts` measures all three and fails the build
 * if any operable prop falls under 3:1 mean luminance against the floor.
 *
 * THE GLYPH RULE
 * ──────────────
 * The four rune glyphs (`drawGlyph`) are the memory puzzle's *state*, and they
 * appear on nothing else. Anything that wants a carved decoration uses
 * `armillary()` instead — astronomical arcs, which is what an observatory
 * would have carved anyway. A glyph on a door, a chest, a wall or a standing
 * stone costs the four symbols the only job they have.
 *
 * WALL SYSTEM (16×16, tile/shrine/wall_*)
 * ───────────────────────────────────────
 * A rectangular room is enclosed like this — two rows for the north band so
 * the wall has visible thickness, one tile for the other three sides:
 *
 *     C C C C C C C     C = wall_top_cap   (the void beyond the room)
 *     N N N N N N N     N = wall_top_n     (the tall carved face, 4 variants)
 *     W . . . . . E     W/E = wall_w / wall_e
 *     W . . . . . E     . = floor_*
 *     w S S S S S s     S = wall_s,  w = wall_corner_sw,  s = wall_corner_se
 *
 * All four sides now get the SAME three-band treatment, packed into the single
 * tile the side walls are allotted: a hard shadow line against the floor, a lit
 * coping lip, a carved face, and then the fall into void. The side walls used
 * to be a 2 px hairline on a field of cap, measuring ΔL 17.7 against
 * out-of-bounds, while the north wall had a full cap/face/base; a room read as
 * having one wall and three edges. Corner tiles are named for *the room corner
 * they sit in* (wall_corner_sw = the room's south-west corner → coping on its N
 * and E edges). wall_inner_* are the diagonal joins where two wall bands meet
 * and only the very corner of the tile touches the room.
 */
import { Surface, rng, valueNoise, speckle, type Rng } from '../lib/pixel.js';
import { ArtBuild, TILE } from '../lib/registry.js';
import { registerBlobSet, edgePixels } from '../lib/autotile.js';
import * as P from '../lib/palette.js';

const CAP = P.SHRINE_VOID;
const ST = P.SHRINE_STONE;
const FL = P.SHRINE_FLOOR;
const TR = P.SHRINE_TRIM;
const BR = P.SHRINE_BRASS;
/** The operable materials. Never used on architecture — see the header. */
const MB = P.SHRINE_MARBLE;
const BL = P.SHRINE_BRASS_LIT;
const INK = P.SHRINE_INK;

// ── shared helpers ─────────────────────────────────────────────────────────

/**
 * Low-contrast noise fill. Everything larger than 4×4 px in this module goes
 * through here so no surface is ever a single flat colour, but the shrine's
 * `scale` values are deliberately large: big soft patches, never grit.
 */
function grain(
  s: Surface, x: number, y: number, w: number, h: number,
  ramp: readonly string[], seed: number,
  idx: [number, number, number] = [1, 2, 3], scale = 3.6, alpha = 1,
): void {
  const n1 = valueNoise(seed);
  const n2 = valueNoise(seed + 811);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = n1(x + i, y + j, scale) * 0.66 + n2(x + i, y + j, scale * 2.4) * 0.34;
      s.px(x + i, y + j, v > 0.63 ? ramp[idx[2]] : v < 0.37 ? ramp[idx[0]] : ramp[idx[1]], alpha);
    }
  }
}

/**
 * Soft radial halo. Always drawn *before* the thing that emits it, so the
 * emitter's core stays at full saturation and the bloom sits behind it.
 */
function halo(
  s: Surface, cx: number, cy: number, r: number, color: string,
  strength = 0.5, power = 2.1,
): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const a = strength * Math.pow(1 - d, power);
      if (a > 0.015) s.px(x, y, color, a);
    }
  }
}

/** Squashed contact shadow at a sprite's base. Nothing floats. */
function contact(s: Surface, cx: number, baseY: number, w: number, h = 4, alpha = 0.34): void {
  s.ellipse(Math.round(cx - w / 2), baseY - h + 1, w, h, P.OUTLINE, alpha);
}

// ── THE FIGURE-GROUND CONTRACT ─────────────────────────────────────────────

/**
 * A HARD contact shadow — opaque ink at the core, one dithered ring, done.
 *
 * The soft 34%-alpha ellipse every prop used to sit on composited to roughly
 * L 39 over a floor whose own darkest pixel is L 26: it was *lighter* than the
 * ground it was supposed to be darkening. A shadow that never gets darker than
 * the floor is not a shadow, it is a smudge, and the prop goes on floating.
 */
function hardContact(s: Surface, cx: number, baseY: number, w: number, h = 4): void {
  const x0 = Math.round(cx - w / 2);
  s.ellipse(x0, baseY - h + 1, w, h, INK, 0.92);
  s.ellipse(x0 + 1, baseY - h + 2, w - 2, h - 2, INK);
  // one dithered ring so the ellipse does not read as a painted-on decal
  for (let i = 0; i < w; i += 2) s.px(x0 + i, baseY - h, INK, 0.45);
}

/**
 * Turn a drawn figure into an operable object. THE contract; see the header.
 *
 * Order matters and is not negotiable:
 *   1. re-material  — stone → marble, dead brass → live brass. Doing this by
 *      exact ramp swap rather than by redrawing every prop means the rule can
 *      never drift out of sync between two props that were authored months
 *      apart, and it keeps each prop's own form shading intact.
 *   2. rim          — SHRINE_MARBLE[4] on the inside of the top and left
 *      edges. Light is upper-left everywhere in this game, so this is the
 *      specular a real dressed edge would catch, and it is three times
 *      brighter than the brightest pixel in the floor.
 *   3. anchor       — 1 px SHRINE_INK outside the silhouette, darker than the
 *      darkest pixel in the floor.
 *   4. shadow       — laid *behind* the finished figure, so the outline never
 *      gets outlined and the shadow never eats the rim.
 *
 * `shadow: null` is for objects that are already flush with the ground (floor
 * plates, portal voids) — they get their anchor from a socket instead.
 */
function operable(
  fig: Surface,
  shadow: { cx: number; y: number; w: number; h?: number } | null,
): Surface {
  fig.swapRamp(ST, MB);
  fig.swapRamp(BR, BL);
  fig.innerShade(MB[4], 0.9, [[0, -1], [-1, 0]]);
  fig.outline(INK, true);
  if (!shadow) return fig;
  const out = new Surface(fig.w, fig.h);
  hardContact(out, shadow.cx, shadow.y, shadow.w, shadow.h ?? 4);
  out.blit(fig);
  return out;
}

/**
 * The decorative motif that replaced the rune glyphs: an armillary quadrant.
 *
 * Concentric arcs about an off-centre pole with a single crossing bar — the
 * kind of thing the people who built an observatory would cut into their own
 * doors. It is deliberately *not* a closed symbol: no ring, no chevron, no
 * spiral, no bar stack, so it cannot be mistaken for puzzle state at a glance
 * even at 1×, which is the only reason it exists.
 */
function armillary(s: Surface, cx: number, cy: number, r: number, tone: string, alpha = 1): void {
  const arc = (rad: number, a0: number, a1: number, c: string, al: number) => {
    for (let t = a0; t <= a1; t += 0.06) {
      s.px(Math.round(cx + Math.cos(t) * rad), Math.round(cy + Math.sin(t) * rad * 0.86), c, al);
    }
  };
  arc(r, -2.5, 0.45, tone, alpha);
  arc(r, -2.5, 0.45, tone, alpha * 0.5);
  arc(r * 0.6, 0.5, 3.5, tone, alpha * 0.9);
  arc(r * 0.28, -3.2, 1.2, tone, alpha * 0.8);
  // the pole and its crossing bar
  s.vline(Math.round(cx + r * 0.32), Math.round(cy - r), Math.round(r * 2), tone, alpha * 0.75);
  s.hline(Math.round(cx - r * 0.7), Math.round(cy + r * 0.25), Math.round(r * 1.5), tone, alpha * 0.6);
}

/**
 * An engraved armillary: dark groove, lit lower-right lip, faint cold trace.
 * The drop-in replacement for `glyphPlate(..., lit=false)` as decoration.
 */
function armillaryPlate(s: Surface, cx: number, cy: number, r: number, tone = TR[3]): void {
  armillary(s, cx + 1, cy + 1, r, ST[4], 0.28);
  armillary(s, cx, cy, r, P.OUTLINE, 0.8);
  armillary(s, cx, cy, r, tone, 0.5);
}

/** A jagged crack. Returns nothing; draws a dark fissure with a lit lip. */
function crack(
  s: Surface, x: number, y: number, len: number, dir: 'v' | 'h',
  r: Rng, dark: string, lip: string, alpha = 0.9,
): void {
  let cx = x, cy = y;
  for (let i = 0; i < len; i++) {
    s.px(cx, cy, dark, alpha);
    if (dir === 'v') {
      s.px(cx - 1, cy, lip, 0.35);
      cy += 1;
      cx += r.chance(0.34) ? (r.chance(0.5) ? 1 : -1) : 0;
    } else {
      s.px(cx, cy - 1, lip, 0.35);
      cx += 1;
      cy += r.chance(0.34) ? (r.chance(0.5) ? 1 : -1) : 0;
    }
  }
}

// ── RUNE GLYPHS ────────────────────────────────────────────────────────────
// The four memory-puzzle symbols. They have to be tellable apart in a glance
// at 1× zoom, so each one is a different *kind* of shape rather than a
// different arrangement of the same shape: a swirl, stripes, arrows, a target.
// Strokes are 2 px; nothing here is finer than that.

export type Glyph = 0 | 1 | 2 | 3;

/**
 * Draws glyph `g` centred on (cx, cy) at roughly `size`×`size` px. `thin`
 * halves the stroke to 1 px, which is how the hot core of a lit rune is drawn
 * — inside the stroke, never over it, so the shape survives the bloom.
 */
function drawGlyph(
  s: Surface, g: Glyph, cx: number, cy: number, size: number,
  color: string, alpha = 1, thin = false,
): void {
  const R = (size - 1) / 2;
  const dot = (x: number, y: number) => {
    s.px(Math.round(x), Math.round(y), color, alpha);
  };
  const blob = thin
    ? dot
    : (x: number, y: number) => { dot(x, y); dot(x + 1, y); dot(x, y + 1); dot(x + 1, y + 1); };

  if (g === 0) {
    // SPIRAL — an archimedean coil of a little over one turn. The eye of the
    // spiral stays open; filling it turns the glyph into a dot.
    const turns = 2.4 * Math.PI;
    for (let t = 0; t <= turns; t += 0.1) {
      const rad = 1.7 + (t / turns) * (R - 2.0);
      blob(cx - 0.5 + Math.cos(t - Math.PI / 2) * rad, cy - 0.5 + Math.sin(t - Math.PI / 2) * rad);
    }
  } else if (g === 1) {
    // TRIPLE BAR — three horizontal rules, the middle one short.
    for (let k = 0; k < 3; k++) {
      const y = cy - R + 1 + k * (R - 0.5);
      const half = k === 1 ? Math.round(R * 0.5) : Math.round(R);
      for (let x = -half; x <= half; x++) { dot(cx + x, y); if (!thin) dot(cx + x, y + 1); }
    }
  } else if (g === 2) {
    // CHEVRON PAIR — two stacked arrowheads pointing up.
    for (let k = 0; k < 2; k++) {
      const y0 = cy - R + k * (R + 0.5);
      for (let i = 0; i <= R; i++) {
        dot(cx - i, y0 + i); dot(cx + i, y0 + i);
        if (!thin) { dot(cx - i, y0 + i + 1); dot(cx + i, y0 + i + 1); }
      }
    }
  } else {
    // RINGED DOT — a ring with a clear gap, then a pip at its centre.
    for (let t = 0; t < Math.PI * 2; t += 0.09) {
      blob(cx - 0.5 + Math.cos(t) * (R - 0.5), cy - 0.5 + Math.sin(t) * (R - 0.5));
    }
    if (thin) dot(cx, cy);
    else { dot(cx, cy); dot(cx - 1, cy); dot(cx, cy - 1); dot(cx - 1, cy - 1); }
  }
}

/**
 * A glyph as a room-scale sign: engraved groove, then either a cold trace
 * (`lit=false`) or a glowing core with a bloom behind it (`lit=true`).
 *
 * The bloom is kept tight (high falloff power) on purpose: a wide soft halo
 * eats the negative space inside the spiral and the ring and the four symbols
 * stop being tellable apart, which is the one thing they exist to do.
 */
function glyphPlate(
  s: Surface, g: Glyph, cx: number, cy: number, size: number, lit: boolean,
): void {
  // groove first — a carved glyph is a hole, so it gets a dark bed and a 1 px
  // lower-right lip catching the light that falls into it.
  drawGlyph(s, g, cx + 1, cy + 1, size, ST[3], 0.26);
  drawGlyph(s, g, cx, cy, size, P.OUTLINE, 0.85);
  if (lit) {
    halo(s, cx, cy, size * 0.95, P.ECHO_CYAN[2], 0.22, 3.2);
    drawGlyph(s, g, cx, cy, size, P.ECHO_RUNE, 0.95);
    drawGlyph(s, g, cx, cy, size, P.ECHO_RUNE_CORE, 0.7, true);
  } else {
    drawGlyph(s, g, cx, cy, size, P.ECHO_RUNE_DIM, 0.62);
  }
}

// ── WALLS ──────────────────────────────────────────────────────────────────

/**
 * Out-of-bounds. Not a wall top — the absence of room.
 *
 * This used to be a lit masonry surface at L 21 sitting next to a floor whose
 * darkest pixel was L 26, which is why every screenshot of this dungeon read as
 * one continuous dark field with some slightly-different dark shapes in it. It
 * is now genuinely black: three barely-separable steps of SHRINE_VOID, enough
 * to satisfy the no-flat-colour rule and nothing more. Every bit of legibility
 * the shrine has comes from the hard binary between this and the lit floor.
 */
function capBody(s: Surface, variant: number): void {
  const seed = 9000 + variant * 311;
  grain(s, 0, 0, TILE, TILE, CAP, seed, [0, 1, 2], 5.2);
  // A single course line per tile, at the very bottom of the ramp. At L 3 this
  // is invisible until the room's own light spills a few pixels onto it, and
  // then it reads as depth rather than as another surface.
  const jy = (variant * 5) % 10;
  if (jy < TILE) s.hline(0, jy, TILE, CAP[0], 0.85);
  speckle(s, rng(seed + 9), 0, 0, TILE, TILE, CAP[3], 3, 0.5);
}

/**
 * A full wall band on the edge of a tile that faces the room.
 *
 * `side` is which edge of the tile the room is on. North- and west-facing
 * surfaces catch the light; east- and south-facing ones stay in shadow (light
 * is upper-left, always).
 *
 * The band is 12 px deep and carries the same four elements the north wall's
 * dedicated tile does, because a room whose north edge is architecture and
 * whose other three edges are hairlines does not read as a room:
 *
 *   d0        hard shadow the wall throws onto the floor
 *   d1..d2    the lit coping nose — the "this is a step up" cue
 *   d3..d9    the carved face, in two courses with joints, falling into shadow
 *   d10..d11  the base line and the fall into void
 *   d12..     out-of-bounds
 */
function coping(s: Surface, side: 'n' | 's' | 'e' | 'w', from = 0, to = TILE): void {
  const lit = side === 'n' || side === 'w';
  const seq = lit
    ? [INK, ST[4], ST[3], ST[2], ST[3], ST[3], ST[2], ST[2], ST[1], ST[1], ST[0], P.OUTLINE]
    : [INK, ST[3], ST[2], ST[1], ST[2], ST[2], ST[1], ST[1], ST[0], ST[0], P.OUTLINE, CAP[3]];
  const at = (d: number, t: number): [number, number] => [
    side === 'w' ? d : side === 'e' ? TILE - 1 - d : t,
    side === 'n' ? d : side === 's' ? TILE - 1 - d : t,
  ];
  for (let d = 0; d < seq.length; d++) {
    for (let t = from; t < to; t++) {
      const [x, y] = at(d, t);
      s.px(x, y, seq[d], d === 0 ? 0.92 : 1);
    }
  }
  // Two ashlar courses across the face, with vertical joints staggered between
  // them. Without the courses the band is a smooth gradient and reads as a
  // painted vignette rather than as cut stone.
  for (const d of [6, 9]) {
    for (let t = from; t < to; t++) {
      const [x, y] = at(d, t);
      s.px(x, y, P.OUTLINE, 0.5);
    }
  }
  for (let t = from + ((side === 'n' || side === 's') ? 3 : 2); t < to; t += 7) {
    for (let d = 3; d < 10; d++) {
      const [x, y] = at(d + (t & 1 ? 0 : 0), t);
      s.px(x, y, P.OUTLINE, d < 6 ? 0.45 : 0.3);
      const [xl, yl] = at(d, t + 1);
      s.px(xl, yl, ST[4], 0.16);
    }
  }
  // A bite out of the coping nose every few tiles' worth of run — hand-cut.
  for (let t = from + 5; t < to; t += 11) {
    const [x, y] = at(1, t);
    s.px(x, y, ST[1], 0.7);
    const [x2, y2] = at(2, t);
    s.px(x2, y2, ST[0], 0.5);
  }
}

/**
 * One course of ashlar blocks on the wall face.
 *
 * Block tones sit at SHRINE_STONE[2..3] — a clear step *above* the floor.
 * The face is the one piece of architecture allowed to be lighter than the
 * ground, and it has to be, or the north wall stops separating from the room.
 */
function course(s: Surface, y0: number, h: number, stagger: number, seed: number): void {
  const r = rng(seed);
  for (let bx = stagger - 8; bx < TILE; bx += 8) {
    const tone = r.pick([2, 3, 3, 2, 3]);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = bx; x < bx + 8; x++) {
        if (x < 0 || x >= TILE) continue;
        s.px(x, y, ST[tone]);
      }
    }
    for (let x = bx; x < bx + 8; x++) {
      if (x < 0 || x >= TILE) continue;
      s.px(x, y0, ST[Math.min(4, tone + 1)]);          // lit top arris
      s.px(x, y0 + h - 1, ST[Math.max(0, tone - 1)]);  // shaded bottom
    }
    for (let y = y0; y < y0 + h; y++) s.px(bx, y, P.OUTLINE, 0.5); // vertical joint
    // a shallow bite out of one block corner — hand-cut stone, not extruded
    if (r.chance(0.35)) {
      const cxp = r.chance(0.5) ? bx + 1 : bx + 6;
      s.px(cxp, y0 + 1, ST[0], 0.7);
      s.px(cxp + 1, y0 + 1, ST[0], 0.45);
    }
  }
  s.hline(0, y0 + h - 1, TILE, P.OUTLINE, 0.45); // bed joint under the course
}

/**
 * wall_top_n — the tall face seen when a wall is north of you. This tile
 * carries most of the dungeon's character, so it ships in four states of wear.
 */
function wallFace(v: number): Surface {
  const s = new Surface(TILE, TILE);
  const seed = 9100 + v * 137;
  const r = rng(seed + 3);
  grain(s, 0, 0, TILE, TILE, ST, seed, [2, 3, 3], 3.0);

  course(s, 3, 6, v % 2 === 0 ? 0 : 4, seed + 21);
  course(s, 9, 5, v % 2 === 0 ? 4 : 0, seed + 47);

  // The wall's top: the cap's shadow, then the nose of the coping catching the
  // light, then the groove under the overhang. Three rows, and they do more
  // for the "this is a thick wall" read than the whole rest of the tile.
  s.hline(0, 0, TILE, CAP[1]);
  s.hline(0, 1, TILE, ST[4]);
  s.hline(0, 2, TILE, ST[1]);
  // Base: the face dies into shadow where it meets the floor.
  s.hline(0, 14, TILE, ST[0]);
  s.hline(0, 15, TILE, P.OUTLINE, 0.92);

  if (v === 1) {
    // fractured: a fissure running the height of both courses
    crack(s, 5 + r.int(0, 5), 3, 11, 'v', r, P.OUTLINE, ST[4]);
    speckle(s, r, 0, 3, TILE, 11, ST[0], 7, 0.5);
  } else if (v === 2) {
    // an armillary cut into the stone. NOT a rune: the four glyphs are memory
    // puzzle state and a wall that wears one is a wall the player will read as
    // a clue for the rest of the dungeon.
    armillaryPlate(s, 8, 8, 5);
  } else if (v === 3) {
    // observatory conduit: brass pipe bracketed to the stone
    for (let y = 0; y < TILE; y++) {
      s.px(6, y, BR[1]); s.px(7, y, BR[3]); s.px(8, y, BR[0]);
    }
    for (const by of [4, 11]) {
      s.rect(4, by, 7, 2, BR[2]);
      s.hline(4, by, 7, BR[4], 0.8);
      s.hline(4, by + 1, 7, BR[0]);
      s.px(4, by, ST[0]); s.px(10, by + 1, P.OUTLINE, 0.6);
    }
    s.hline(0, 1, TILE, ST[4]); // keep the nose unbroken
    s.hline(0, 15, TILE, P.OUTLINE, 0.92);
  } else {
    speckle(s, r, 0, 3, TILE, 11, ST[0], 5, 0.45);
    speckle(s, r, 0, 3, TILE, 11, ST[3], 4, 0.35);
  }
  return s;
}

// ── FLOORS ─────────────────────────────────────────────────────────────────

/**
 * Quiet flagstone — ONE 16 px slab per tile, plus a faint diamond lattice.
 *
 * The first pass of this floor was a brick bond, and in an assembled room it
 * read as the same material as the wall face: the boundary of the room
 * vanished. The fix is scale and motif, not colour — the wall is *horizontal
 * coursing at 8 px*, the floor is *big squares with a diagonal motif*, and the
 * two can never be confused again. The floor also sits a full step lighter
 * than the wall cap, so the ladder cap < floor < face is visible everywhere.
 */
function floorTile(v: number): Surface {
  const s = new Surface(TILE, TILE);
  const seed = 9400 + v * 91;
  const r = rng(seed + 11);
  // Fine grain, not broad cloud: at a large noise scale the patches read as
  // smudges on the lens rather than as stone.
  //
  // Weighted to the two darkest usable steps on purpose. The floor is the
  // reference value everything else in the room is judged against, so every
  // point of luminance it gains is a point every interactive object has to gain
  // twice over to stay three times brighter than it. Its brightness in play
  // comes from the room's lights, not from its own pigment.
  grain(s, 0, 0, TILE, TILE, FL, seed, [1, 1, 2], 2.8);

  // Slab joints: one horizontal, one vertical, both soft. A dungeon floor is
  // underfoot furniture; it does not get to have edges as strong as a wall's.
  s.hline(0, 0, TILE, FL[0], 0.55);
  s.hline(0, 1, TILE, FL[3], 0.22);
  s.vline(0, 0, TILE, FL[0], 0.55);
  s.vline(1, 0, TILE, FL[3], 0.16);

  // The geometric inlay: a lozenge on ONE variant in six, and cut from the
  // floor's own ramp rather than from the violet trim.
  //
  // At two-in-six in a saturated violet it turned into wallpaper — every
  // screenshot of the dungeon showed a diamond lattice running edge to edge,
  // which is both the loudest thing on the ground and the exact opposite of
  // what a floor is for. One in six, in FL[3], is a slab that has an inlay;
  // two in six in TR[2] is a patterned carpet.
  if (v === 5) {
    const cx = 8, cy = 8, rad = 5;
    for (let i = 0; i <= rad; i++) {
      const j = rad - i;
      for (const [px, py] of [[cx + i, cy + j], [cx - i, cy + j], [cx + i, cy - j], [cx - i, cy - j]]) {
        s.px(px, py, FL[3], 0.4);
        s.px(px, py + 1, FL[0], 0.35);
      }
    }
  }

  speckle(s, r, 0, 0, TILE, TILE, FL[0], 5, 0.4);
  speckle(s, r, 0, 0, TILE, TILE, FL[3], 2, 0.18);
  return s;
}

function floorCracked(v: number): Surface {
  const s = floorTile(v % 3);
  const r = rng(9500 + v * 57);
  crack(s, 2 + r.int(0, 4), 1, 13, 'v', r, P.OUTLINE, FL[3], 0.75);
  if (v !== 1) crack(s, 8 + r.int(0, 3), 4 + r.int(0, 3), 7, 'h', r, P.OUTLINE, FL[3], 0.6);
  speckle(s, r, 0, 0, TILE, TILE, FL[0], 6, 0.4);
  return s;
}

function floorRubble(v: number): Surface {
  const s = floorTile((v + 2) % 6);
  const r = rng(9600 + v * 41);
  // Grit, kept inside the floor's own value envelope. Chips at SHRINE_STONE[3]
  // put the *brightest* pixel in the room underfoot, which raises the bar every
  // interactive object has to clear to be seen — the floor is not allowed to
  // compete with the things standing on it.
  for (let i = 0; i < 3 + v; i++) {
    const x = r.int(1, TILE - 5), y = r.int(2, TILE - 4);
    const w = r.int(2, 4), h = r.int(2, 3);
    s.ellipse(x, y + 1, w + 1, h, P.OUTLINE, 0.35);
    s.rect(x, y, w, h, ST[r.pick([0, 1, 1])]);
    s.hline(x, y, w, ST[2]);
    s.hline(x, y + h - 1, w, ST[0]);
  }
  return s;
}

/** A floor grate: you can see the dark below, which is worth a lot of mood. */
function floorGrate(v: number): Surface {
  const s = floorTile(v);
  const vertical = v === 0;
  s.rect(2, 2, 12, 12, P.ECHO_DEEP[0]);
  s.rectOutline(2, 2, 12, 12, P.OUTLINE, 0.9);
  // recessed: the inside of the near/lower lip catches light, the far one doesn't
  s.hline(3, 3, 10, P.ECHO_DEEP[0]);
  s.hline(3, 12, 10, ST[1], 0.55);
  s.vline(12, 3, 10, ST[1], 0.4);
  for (let k = 0; k < 4; k++) {
    const p = 3 + k * 3;
    if (vertical) {
      s.vline(p, 3, 10, ST[2]); s.vline(p + 1, 3, 10, ST[0]);
    } else {
      s.hline(3, p, 10, ST[2]); s.hline(3, p + 1, 10, ST[0]);
    }
  }
  if (v === 1) halo(s, 8, 8, 7, P.ECHO_CYAN[2], 0.18, 2.6);
  s.rectOutline(1, 1, 14, 14, FL[3], 0.22);
  return s;
}

/**
 * A SEQUENCE SLAB — the memory room's puzzle state, set into the floor.
 *
 * The old version of this tile was the flagstone with a slightly darker disc
 * and a cold trace on it: it measured 1.12:1 against the floor beside it, a
 * difference of four luminance levels, and in a screenshot you genuinely could
 * not find the four plates the whole puzzle is played on.
 *
 * It is now built like every other operable thing in the shrine — dressed
 * marble in a socket — and it is the loudest object on the ground by a wide
 * margin, because it has to be findable from across a dark room before it is
 * ever read as a symbol.
 *
 *   socket ring   SHRINE_INK, opaque — darker than any floor pixel
 *   plate         SHRINE_MARBLE, filling the tile — the 3:1 mass
 *   rim           MARBLE[4] on the upper-left arc — brighter than any floor px
 *   glyph         engraved dark when dead; cyan with a hot core when live
 */
function runePlateTile(g: Glyph, lit: boolean): Surface {
  const s = floorTile(g % 4);
  // The socket: a hard shadow the plate sits down inside.
  s.ellipse(0, 0, TILE, TILE, INK, 0.55);
  s.ellipse(0, 1, TILE, TILE - 1, INK);
  // The plate itself. Two ramp steps plus a lit upper-left crescent, the same
  // way every other marble object in the dungeon is lit.
  s.ellipse(1, 1, 14, 14, MB[2]);
  s.ellipse(1, 1, 14, 13, MB[3]);
  s.ellipse(2, 1, 12, 12, MB[4]);
  s.ellipse(3, 2, 10, 9, MB[3]);
  s.ellipseOutline(1, 1, 14, 14, MB[4], 0.95);
  // and the shadowed lower-right quadrant of the bezel
  for (let y = 8; y < 15; y++) for (let x = 8; x < 15; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 6.1 && d < 7.4) s.px(x, y, MB[0], 0.85);
  }
  // Brass collar: four studs, so the plate reads as fitted rather than painted.
  for (const [sx, sy] of [[7, 1], [7, 13], [1, 7], [13, 7]] as const) {
    s.rect(sx, sy, 2, 2, lit ? BL[3] : BL[1]);
    s.px(sx, sy, lit ? BL[4] : BL[2]);
  }
  if (lit) {
    halo(s, 8, 8, 8.5, P.ECHO_CYAN[3], 0.5, 2.0);
    s.ellipse(3, 3, 10, 10, P.ECHO_CYAN[1], 0.85);
    s.ellipse(4, 4, 8, 8, P.ECHO_CYAN[2], 0.8);
    drawGlyph(s, g, 8, 8, 11, P.ECHO_RUNE, 1);
    drawGlyph(s, g, 8, 8, 11, P.ECHO_RUNE_CORE, 0.85, true);
  } else {
    drawGlyph(s, g, 9, 9, 11, MB[4], 0.6);          // the groove's lit far lip
    drawGlyph(s, g, 8, 8, 11, INK, 0.8);            // the groove
    drawGlyph(s, g, 8, 8, 11, P.ECHO_RUNE_DIM, 0.75, true);
  }
  return s;
}

/** Deep, still water for the middle of a pool (blob/shrine_water does edges). */
function floorWater(v: number): Surface {
  const s = new Surface(TILE, TILE);
  const seed = 9700 + v * 77;
  const r = rng(seed);
  grain(s, 0, 0, TILE, TILE, P.SHRINE_WATER, seed, [0, 1, 1], 6.5);
  for (let i = 0; i < 3; i++) {
    const y = r.int(1, TILE - 2), x = r.int(0, 10), w = r.int(3, 6);
    s.hline(x, y, w, P.SHRINE_WATER[3], 0.5);
    s.hline(x + 1, y + 1, w - 1, P.SHRINE_WATER[0], 0.35);
  }
  halo(s, r.int(4, 12), r.int(4, 12), 4, P.ECHO_CYAN[2], 0.16, 2.2);
  return s;
}

// ── STEPS & LEDGES ─────────────────────────────────────────────────────────

/**
 * Three treads per tile. `dir` says which way the flight climbs: 'n' recedes
 * into the wall and darkens upward, 's' descends and darkens downward. Both
 * have rails, which is what stops a stair reading as a striped floor.
 */
function stepTile(dir: 'n' | 's', v: number): Surface {
  const s = new Surface(TILE, TILE);
  const seed = 9800 + v * 33 + (dir === 'n' ? 0 : 7);
  grain(s, 0, 0, TILE, TILE, ST, seed, [1, 2, 2], 3.4);
  for (let k = 0; k < 3; k++) {
    const y = k * 5 + (v % 2);
    const t = dir === 'n' ? k : 2 - k;               // darker further from the light
    const tread = [3, 2, 1][t];
    s.rect(3, y, 10, 5, ST[tread]);
    s.hline(3, y, 10, ST[4]);                        // lit nose of the tread
    s.hline(3, y + 3, 10, ST[0], 0.7);
    s.hline(3, y + 4, 10, P.OUTLINE, 0.75);          // riser, in full shadow
  }
  // Rails. Without them a flight of stairs is just a striped floor, so they
  // get the full treatment: lit cap, dark body, hard outline against the tread.
  for (const [x0, lit] of [[0, true], [13, false]] as const) {
    s.rect(x0, 0, 3, TILE, lit ? ST[2] : ST[1]);
    s.vline(lit ? x0 : x0 + 2, 0, TILE, lit ? ST[4] : ST[0]);
    s.vline(lit ? x0 + 2 : x0, 0, TILE, P.OUTLINE, 0.85);
    for (let y = 2; y < TILE; y += 5) s.px(lit ? x0 + 1 : x0 + 1, y, ST[0], 0.5);
  }
  if (dir === 's') {
    for (let y = 11; y < TILE; y++) s.hline(0, y, TILE, P.ECHO_DEEP[0], (y - 10) * 0.15);
  }
  return s;
}

/**
 * A ledge tile is a whole elevation change in one row: upper floor, drop face,
 * lower floor with the shadow the drop casts onto it. `ledge_s` = the higher
 * ground is to the north of you and you cannot climb it.
 */
function ledgeS(v: number): Surface {
  const s = new Surface(TILE, TILE);
  const seed = 9900 + v * 61;
  const r = rng(seed);
  // upper floor running up to the brink
  grain(s, 0, 0, TILE, 4, FL, seed, [2, 2, 3], 5);
  s.hline(0, 3, TILE, ST[4]);                       // the lit arris — the brink
  // the drop face: five rows of stone falling into shadow
  for (let y = 4; y < 9; y++) s.hline(0, y, TILE, ST[y < 6 ? 2 : 1]);
  for (let x = (v % 2) * 4 + 2; x < TILE; x += 8) s.vline(x, 4, 5, P.OUTLINE, 0.4);
  s.hline(0, 9, TILE, ST[0]);
  s.hline(0, 10, TILE, P.OUTLINE, 0.9);
  // lower floor, with the shadow the drop throws across it
  grain(s, 0, 11, TILE, 5, FL, seed + 31, [2, 2, 3], 5);
  s.hline(0, 11, TILE, P.OUTLINE, 0.42);
  s.hline(0, 12, TILE, P.OUTLINE, 0.24);
  s.hline(0, 13, TILE, P.OUTLINE, 0.1);
  if (v === 1) crack(s, 4 + r.int(0, 6), 4, 5, 'v', r, P.OUTLINE, ST[4], 0.6);
  return s;
}

/**
 * A drop running north–south. Named for the side the *lower* ground is on, so
 * ledge_e faces east and stays in shadow while ledge_w faces west and catches
 * the light — same rule as everything else in the game.
 */
function ledgeSide(side: 'e' | 'w'): Surface {
  const s = new Surface(TILE, TILE);
  const seed = 9950 + (side === 'e' ? 1 : 2);
  const flip = side === 'w';
  const col = (d: number) => (flip ? TILE - 1 - d : d);
  grain(s, 0, 0, TILE, TILE, FL, seed, [2, 2, 3], 5);           // upper ground
  const faceTone = flip ? [ST[3], ST[2], ST[1]] : [ST[1], ST[1], ST[0]];
  s.vline(col(9), 0, TILE, ST[4]);                              // arris
  for (let d = 0; d < 3; d++) s.vline(col(10 + d), 0, TILE, faceTone[d]);
  s.vline(col(13), 0, TILE, P.OUTLINE, 0.9);
  // lower ground plus the shadow of the drop
  for (let d = 14; d < TILE; d++) {
    for (let y = 0; y < TILE; y++) s.px(col(d), y, FL[2]);
    s.vline(col(d), 0, TILE, P.OUTLINE, d === 14 ? 0.38 : 0.18);
  }
  for (let y = 1; y < TILE; y += 5) s.px(col(11), y, ST[0], 0.55);
  return s;
}

/** The corner where a south-facing drop turns and runs away from you. */
function ledgeCorner(side: 'sw' | 'se'): Surface {
  const s = ledgeS(0);
  const flip = side === 'sw';
  const col = (d: number) => (flip ? d : TILE - 1 - d);
  const faceTone = flip ? [ST[3], ST[2], ST[1]] : [ST[1], ST[1], ST[0]];
  for (let y = 3; y < TILE; y++) {
    s.px(col(0), y, ST[4]);
    for (let d = 0; d < 3; d++) s.px(col(1 + d), y, faceTone[d]);
    s.px(col(4), y, P.OUTLINE, 0.9);
    s.px(col(5), y, P.OUTLINE, 0.3);
  }
  return s;
}

/** The far side of a drop: you are on the low ground, the wall rises north. */
function ledgeN(): Surface {
  const s = new Surface(TILE, TILE);
  grain(s, 0, 0, TILE, TILE, FL, 9970, [1, 2, 2], 5);
  s.hline(0, 0, TILE, ST[3]);
  s.hline(0, 1, TILE, ST[1]);
  s.hline(0, 2, TILE, P.OUTLINE, 0.7);
  s.hline(0, 3, TILE, P.OUTLINE, 0.3);
  s.hline(0, 4, TILE, P.OUTLINE, 0.12);
  return s;
}

// ── BLOB SETS ──────────────────────────────────────────────────────────────

/**
 * Still water: a mirror, not a river.
 *
 * WHY THE SHORELINE IS DRAWN THIS HARD
 * ────────────────────────────────────
 * A pool in a dark dungeon is the single most ambiguous object there is: the
 * player has to know, from across the room and without testing it, whether it
 * is walkable, blocking or lethal. The old version faded into the flagstone at
 * a 0.6-alpha edge pixel and answered none of those questions, so:
 *
 *   - the SHORE gets a hard lip. Two rows of near-ink under the far bank, so
 *     the ground visibly *stops* and drops rather than changing colour;
 *   - the NEAR bank gets a foam line, the one bright mark on a black mirror;
 *   - the SURFACE moves. Nothing walkable in this dungeon animates, so motion
 *     is by itself the "this is liquid" signal, before any colour is read.
 *
 * `frame` drives the surface animation; the shoreline never moves, because a
 * moving boundary reads as damage rather than as a coast.
 */
function waterPainter(frame: number) {
  return (coverage: Surface, _mask: number, r: Rng): Surface => {
    const s = new Surface(TILE, TILE);
    const n1 = valueNoise(6100);
    // Sample the noise at a per-tile offset. Without this every tile in the set
    // carries an identical texture and a filled pool shows a hard grid.
    const ox = r.int(0, 97), oy = r.int(0, 97);
    const drift = frame * 1.7;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (coverage.alphaAt(x, y) === 0) continue;
        const v = n1(x + ox + drift, y + oy, 7);
        s.px(x, y, v > 0.62 ? P.SHRINE_WATER[2] : v < 0.36 ? P.SHRINE_WATER[0] : P.SHRINE_WATER[1]);
      }
    }
    // Two travelling glints. They are the animation the player actually sees:
    // the noise drift alone is too subtle to register at 1x.
    for (const k of [0, 1]) {
      const y = 3 + ((r.int(0, 9) + k * 6) % 10);
      const x = ((r.int(0, 11) + frame * 3 + k * 7) % 12) + 1;
      const w = 3 + ((frame + k) & 1);
      for (let i = 0; i < w; i++) {
        if (coverage.alphaAt(x + i, y)) s.px(x + i, y, P.SHRINE_WATER[3], 0.45);
        if (coverage.alphaAt(x + i, y + 1)) s.px(x + i, y + 1, P.SHRINE_WATER[0], 0.3);
      }
    }
    if (r.chance(0.45)) {
      const gx = r.int(3, 12), gy = r.int(3, 12);
      if (coverage.alphaAt(gx, gy)) {
        halo(s, gx, gy, 4.5, P.ECHO_CYAN[2], 0.22, 2.6);
        s.px(gx, gy, P.ECHO_CYAN[4], 0.5 + (frame & 1) * 0.35);
      }
    }
    const { top, bottom, side } = edgePixels(coverage);
    // Far bank: a hard shadow lip. The land is above the water and casts onto it.
    for (const [x, y] of top) {
      s.px(x, y, P.SHRINE_SHORE_LIP);
      s.px(x, y + 1, P.SHRINE_SHORE_LIP, 0.8);
      s.px(x, y + 2, P.SHRINE_WATER[0], 0.6);
    }
    // Near bank: foam. The only bright pixels in the pool, and they mark the
    // edge you can actually stand on.
    for (const [x, y] of bottom) {
      s.px(x, y - 1, P.SHRINE_WATER[0], 0.5);
      s.px(x, y, ((x + frame) & 3) === 0 ? P.SHRINE_FOAM : P.SHRINE_WATER[4], 0.9);
    }
    for (const [x, y] of side) {
      s.px(x, y, P.SHRINE_SHORE_LIP, 0.85);
    }
    return s;
  };
}

/** Echo moss: violet growth with a few live specks in it. */
function mossPainter(coverage: Surface, _mask: number, r: Rng): Surface {
  const s = new Surface(TILE, TILE);
  const n1 = valueNoise(6200);
  const n2 = valueNoise(6377);
  const ox = r.int(0, 97), oy = r.int(0, 97);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (coverage.alphaAt(x, y) === 0) continue;
      const v = n1(x + ox, y + oy, 3.2) * 0.6 + n2(x + ox, y + oy, 1.6) * 0.4;
      s.px(x, y, v > 0.66 ? P.SHRINE_MOSS[2] : v < 0.38 ? P.SHRINE_MOSS[0] : P.SHRINE_MOSS[1]);
    }
  }
  // tendrils reaching out along the stone
  for (let i = 0; i < 4; i++) {
    let x = r.int(2, TILE - 3), y = r.int(2, TILE - 3);
    for (let k = 0; k < r.int(3, 6); k++) {
      if (coverage.alphaAt(x, y)) s.px(x, y, P.SHRINE_MOSS[3], 0.6);
      x += r.int(-1, 1); y += r.int(-1, 1);
    }
  }
  // One live spore per tile at most: moss is a stain, not a light source.
  if (r.chance(0.5)) {
    const x = r.int(3, TILE - 4), y = r.int(3, TILE - 4);
    if (coverage.alphaAt(x, y)) {
      halo(s, x, y, 3.5, P.ECHO_GLOW, 0.22, 2.6);
      s.px(x, y, P.ECHO_GLOW, 0.7);
    }
  }
  const { top, bottom, side } = edgePixels(coverage);
  for (const [x, y] of top) s.px(x, y, P.SHRINE_MOSS[3], 0.6);
  for (const [x, y] of bottom) s.px(x, y, P.SHRINE_MOSS[0]);
  for (const [x, y] of side) s.px(x, y, P.SHRINE_MOSS[0], 0.7);
  return s;
}

/**
 * A pit. The far wall drops into black; the near rim is lit from below by
 * whatever is down there, so the boundary is a bright line you cannot misread.
 */
function pitPainter(coverage: Surface, _mask: number, r: Rng): Surface {
  const s = new Surface(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (coverage.alphaAt(x, y) === 0) continue;
      const t = y / (TILE - 1);
      s.px(x, y, t < 0.28 ? P.ECHO_DEEP[1] : t < 0.5 ? P.ECHO_DEEP[0] : '#05050c');
    }
  }
  speckle(s, r, 0, 0, TILE, 6, P.ECHO_DEEP[2], 4, 0.35);
  const { top, bottom, side } = edgePixels(coverage);
  for (const [x, y] of top) {
    s.px(x, y, ST[1]);                       // the pit's far inner wall
    s.px(x, y + 1, ST[0], 0.9);
    s.px(x, y + 2, P.ECHO_DEEP[1], 0.8);
  }
  for (const [x, y] of side) { s.px(x, y, ST[0], 0.9); s.px(x, y, P.OUTLINE, 0.35); }
  for (const [x, y] of bottom) {
    s.px(x, y, P.mix(ST[4], P.ECHO_CYAN[3], 0.35));   // lit near rim
    s.px(x, y - 1, P.ECHO_CYAN[2], 0.35);
  }
  return s;
}

// ── EXTERIOR ───────────────────────────────────────────────────────────────

/** Weathered flagstone on the approach: outdoor light, shrine geometry. */
function extFlag(v: number): Surface {
  const s = new Surface(TILE, TILE);
  const seed = 8300 + v * 71;
  const r = rng(seed + 3);
  grain(s, 0, 0, TILE, TILE, P.SHRINE_OUTER, seed, [1, 2, 3], 4.4);
  const cuts = [0, 7, TILE];
  for (const cy of cuts) if (cy < TILE) {
    s.hline(0, cy, TILE, P.SHRINE_OUTER[0], 0.75);
    s.hline(0, cy + 1, TILE, P.SHRINE_OUTER[4], 0.3);
  }
  const vx = [4, 10, 2, 13][v % 4];
  for (let y = 1; y < 7; y++) s.px(vx, y, P.SHRINE_OUTER[0], 0.75);
  for (let y = 8; y < TILE; y++) s.px((vx + 8) % TILE, y, P.SHRINE_OUTER[0], 0.75);
  // moss and grit — this is outdoors, so the valley is taking it back
  if (v % 2 === 0) {
    for (let i = 0; i < 5; i++) {
      const x = r.int(0, TILE - 2), y = r.int(1, TILE - 2);
      s.px(x, y, P.WOODS_UNDER[2], 0.55);
      s.px(x + 1, y, P.WOODS_UNDER[1], 0.4);
    }
  }
  speckle(s, r, 0, 0, TILE, TILE, P.SHRINE_OUTER[0], 5, 0.35);
  speckle(s, r, 0, 0, TILE, TILE, P.SHRINE_OUTER[4], 3, 0.25);
  return s;
}

function extFlagCracked(v: number): Surface {
  const s = extFlag(v);
  const r = rng(8400 + v * 29);
  crack(s, 3 + r.int(0, 7), 0, TILE, 'v', r, P.OUTLINE, P.SHRINE_OUTER[4], 0.7);
  for (let i = 0; i < 3; i++) {
    const x = r.int(1, TILE - 3), y = r.int(1, TILE - 3);
    s.px(x, y, P.WOODS_UNDER[3], 0.5);
  }
  return s;
}

/** Three tiles of stair descending out of daylight into the shrine. */
function extStair(v: number): Surface {
  const s = new Surface(TILE, TILE);
  grain(s, 0, 0, TILE, TILE, P.SHRINE_OUTER, 8500 + v * 13, [1, 2, 2], 3.4);
  for (let k = 0; k < 3; k++) {
    const y = k * 5;
    const dark = v * 3 + k;                            // darkens as it descends
    const tone = Math.max(0, 3 - Math.floor(dark / 2));
    s.rect(1, y, 14, 5, P.SHRINE_OUTER[tone]);
    s.hline(1, y, 14, P.SHRINE_OUTER[Math.min(4, tone + 1)]);
    s.hline(1, y + 4, 14, P.SHRINE_OUTER[0]);
  }
  s.rect(0, 0, 1, TILE, P.SHRINE_OUTER[2]);
  s.rect(15, 0, 1, TILE, P.SHRINE_OUTER[0]);
  if (v > 0) for (let y = 0; y < TILE; y++) {
    s.hline(0, y, TILE, P.ECHO_DEEP[0], Math.min(0.85, (v - 1) * 0.35 + y * 0.035));
  }
  return s;
}

// ── REGISTRATION ───────────────────────────────────────────────────────────

function registerArchitecture(b: ArtBuild): void {
  // Walls ------------------------------------------------------------------
  const caps = [0, 1, 2].map((v) => {
    const s = new Surface(TILE, TILE);
    capBody(s, v);
    return s;
  });
  b.addTile('tile/shrine/wall_top_cap', caps[0]);
  b.addTile('tile/shrine/wall_top_cap_1', caps[1]);
  b.addTile('tile/shrine/wall_top_cap_2', caps[2]);

  b.addTile('tile/shrine/wall_top_n', wallFace(0));
  for (let v = 1; v < 4; v++) b.addTile(`tile/shrine/wall_top_n_${v}`, wallFace(v));

  const sideWall = (side: 'n' | 's' | 'e' | 'w', v: number) => {
    const s = new Surface(TILE, TILE);
    capBody(s, v);
    coping(s, side);
    return s;
  };
  // wall_s: the room is north of it. wall_w: the room is east of it, etc.
  b.addTile('tile/shrine/wall_s', sideWall('n', 0));
  b.addTile('tile/shrine/wall_s_1', sideWall('n', 1));
  b.addTile('tile/shrine/wall_s_2', sideWall('n', 2));
  b.addTile('tile/shrine/wall_w', sideWall('e', 0));
  b.addTile('tile/shrine/wall_w_1', sideWall('e', 2));
  b.addTile('tile/shrine/wall_e', sideWall('w', 1));
  b.addTile('tile/shrine/wall_e_1', sideWall('w', 2));

  // Outer corners, named for the room corner they occupy.
  const corner = (a: 'n' | 's' | 'e' | 'w', c: 'n' | 's' | 'e' | 'w', v: number) => {
    const s = new Surface(TILE, TILE);
    capBody(s, v);
    coping(s, a);
    coping(s, c);
    return s;
  };
  b.addTile('tile/shrine/wall_corner_sw', corner('n', 'e', 0));
  b.addTile('tile/shrine/wall_corner_se', corner('n', 'w', 1));
  b.addTile('tile/shrine/wall_corner_nw', corner('s', 'e', 2));
  b.addTile('tile/shrine/wall_corner_ne', corner('s', 'w', 0));

  // Inner (diagonal) joins: only the tile's corner touches the room.
  const inner = (a: 'n' | 's' | 'e' | 'w', c: 'n' | 's' | 'e' | 'w', near: 'lo' | 'hi', v: number) => {
    const s = new Surface(TILE, TILE);
    capBody(s, v);
    const [f, t] = near === 'lo' ? [0, 6] : [10, TILE];
    coping(s, a, f, t);
    coping(s, c, near === 'lo' ? 0 : 10, near === 'lo' ? 6 : TILE);
    return s;
  };
  b.addTile('tile/shrine/wall_inner_nw', inner('n', 'w', 'lo', 1));
  b.addTile('tile/shrine/wall_inner_ne', inner('n', 'e', 'hi', 2));
  b.addTile('tile/shrine/wall_inner_sw', inner('s', 'w', 'lo', 0));
  b.addTile('tile/shrine/wall_inner_se', inner('s', 'e', 'hi', 1));

  // Floors -----------------------------------------------------------------
  const floors = [0, 1, 2, 3, 4, 5].map(floorTile);
  floors.forEach((s, i) => b.addTile(`tile/shrine/floor_${i}`, s));
  // The map format documents a ground layer written as `base: 'shrine_floor'`
  // (see src/world/types.ts). Families resolve by path with short aliases, and
  // 'floor' alone is ambiguous across areas, so register the same six slabs
  // under a name that gives map authors an unambiguous one-word family.
  floors.forEach((s, i) => b.addTile(`tile/shrine/shrine_floor_${i}`, s));

  for (let i = 0; i < 3; i++) b.addTile(`tile/shrine/floor_cracked_${i}`, floorCracked(i));
  for (let i = 0; i < 3; i++) b.addTile(`tile/shrine/floor_rubble_${i}`, floorRubble(i));
  for (let i = 0; i < 2; i++) b.addTile(`tile/shrine/floor_grate_${i}`, floorGrate(i));
  for (let i = 0; i < 3; i++) b.addTile(`tile/shrine/floor_water_${i}`, floorWater(i));

  // Rune floors: the four puzzle symbols, lit and dead. The ONLY tiles in the
  // shrine allowed to carry a glyph.
  for (let g = 0; g < 4; g++) {
    for (const lit of [true, false]) {
      b.addTile(`tile/shrine/rune_floor${lit ? '' : '_dim'}_${g}`, runePlateTile(g as Glyph, lit));
    }
  }

  // Steps and ledges -------------------------------------------------------
  b.addTile('tile/shrine/step_n_0', stepTile('n', 0));
  b.addTile('tile/shrine/step_n_1', stepTile('n', 1));
  b.addTile('tile/shrine/step_s', stepTile('s', 0));
  b.addTile('tile/shrine/ledge_s_0', ledgeS(0));
  b.addTile('tile/shrine/ledge_s_1', ledgeS(1));
  b.addTile('tile/shrine/ledge_e', ledgeSide('e'));
  b.addTile('tile/shrine/ledge_w', ledgeSide('w'));
  b.addTile('tile/shrine/ledge_sw', ledgeCorner('sw'));
  b.addTile('tile/shrine/ledge_se', ledgeCorner('se'));
  b.addTile('tile/shrine/ledge_n', ledgeN());

  // Blob sets --------------------------------------------------------------
  // Water ships as four whole blob sets and the runtime swaps between them, so
  // the surface is in constant motion. No walkable tile in the shrine animates,
  // which makes "is this liquid?" answerable without a single colour cue.
  const waterFrames: number[][] = [];
  for (let f = 0; f < 4; f++) {
    waterFrames.push(
      registerBlobSet(b, `blob/shrine_water_f${f}`, 6101, waterPainter(f), { wobble: 0.9, radius: 5 }),
    );
  }
  b.blobs['blob/shrine_water'] = waterFrames[0];
  b.blobFrames['blob/shrine_water'] = { frames: waterFrames, frameRate: 4 };
  registerBlobSet(b, 'blob/shrine_moss', 6201, mossPainter, { wobble: 1.7, radius: 4.6 });
  registerBlobSet(b, 'blob/shrine_pit', 6301, pitPainter, { wobble: 0.6, radius: 4.4 });

  // Exterior ---------------------------------------------------------------
  for (let i = 0; i < 4; i++) b.addTile(`tile/shrine_ext/flag_${i}`, extFlag(i));
  for (let i = 0; i < 2; i++) b.addTile(`tile/shrine_ext/flag_cracked_${i}`, extFlagCracked(i));
  for (let i = 0; i < 3; i++) b.addTile(`tile/shrine_ext/stair_${i}`, extStair(i));
}

// ── SPRITE HELPERS ─────────────────────────────────────────────────────────

/** Beveled block: lit top/left, shaded bottom/right, dark lower-right edge. */
function bevel(
  s: Surface, x: number, y: number, w: number, h: number,
  ramp: readonly string[], tone = 2, outline = true,
): void {
  s.rect(x, y, w, h, ramp[tone]);
  s.hline(x, y, w, ramp[Math.min(4, tone + 1)]);
  s.vline(x, y, h, ramp[Math.min(4, tone + 1)]);
  s.hline(x, y + h - 1, w, ramp[Math.max(0, tone - 1)]);
  s.vline(x + w - 1, y, h, ramp[Math.max(0, tone - 1)]);
  if (outline) {
    s.hline(x, y + h - 1, w, P.OUTLINE, 0.5);
    s.vline(x + w - 1, y, h, P.OUTLINE, 0.4);
  }
}

/** Punch a hole in a surface. `px` with a transparent colour is a no-op. */
function erase(s: Surface, x: number, y: number, w: number, h: number): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!s.inside(x + i, y + j)) continue;
      s.data[((y + j) * s.w + (x + i)) * 4 + 3] = 0;
    }
  }
}

/** Brass band with a lit top edge and two rivets. */
function brassBand(s: Surface, x: number, y: number, w: number, h = 3): void {
  s.rect(x, y, w, h, BR[2]);
  s.hline(x, y, w, BR[4], 0.85);
  s.hline(x, y + h - 1, w, BR[0]);
  s.px(x + 1, y + 1, BR[4]);
  s.px(x + w - 2, y + 1, BR[1]);
}

// ── DOORS & GATES ──────────────────────────────────────────────────────────
// 32×40, anchored bottom-centre: two tiles wide, standing in a wall band.
//
// ONE FRAME, ONE SILHOUETTE, THREE STATES
// ───────────────────────────────────────
// The shrine used to ship three unrelated openings: a barred gate with a blue
// rune, an arched gate with a purple rune, and a frameless purple portcullis.
// Three doors is three vocabularies, and a player who has learned that a barred
// gate means "locked" learns nothing from meeting a portcullis.
//
// Every opening in the dungeon is now the SAME object:
//
//   frame     jambs, lintel, cornice, keystone — identical in all states
//   barrier   the same 20x32 rectangle in the same place, always
//   state     carried entirely by COLOUR and ANIMATION on that barrier:
//               shut    — dressed marble leaves, dead brass bar, cold boss
//               sealed  — the same leaves, the bar blazing Echo violet
//               barred  — the leaves replaced by bars of Echo light, same
//                         rectangle, same brass rails, same footprint
//               open    — the barrier gone, the void behind it, a lit sill
//
// So the silhouette answers "there is a way through here", and the colour
// answers "and it is / is not open right now" — which is the division of labour
// the ALTTP reference uses and the reason its doors never need a legend.

const DOOR_W = 32, DOOR_H = 40;
/** The barrier rectangle. Every closed state fills exactly this. */
const BAR_X = 6, BAR_W = 20;

function doorFrame(): Surface {
  const s = new Surface(DOOR_W, DOOR_H);
  // jambs
  for (const [jx, lit] of [[0, true], [26, false]] as const) {
    bevel(s, jx, 8, 6, 32, ST, 2, false);
    s.vline(lit ? jx : jx + 5, 8, 32, ST[lit ? 4 : 0]);
    s.vline(lit ? jx + 5 : jx, 8, 32, ST[lit ? 0 : 3]);
    for (let y = 12; y < DOOR_H; y += 7) s.hline(jx, y, 6, P.OUTLINE, 0.5);
  }
  // lintel + cornice
  s.rect(0, 4, DOOR_W, 4, ST[2]);
  s.hline(0, 4, DOOR_W, ST[4]);
  s.hline(0, 7, DOOR_W, ST[0]);
  s.rect(1, 0, DOOR_W - 2, 4, ST[3]);
  s.hline(1, 0, DOOR_W - 2, ST[4]);
  s.hline(1, 3, DOOR_W - 2, ST[1]);
  for (let x = 4; x < DOOR_W - 2; x += 6) s.vline(x, 0, 4, P.OUTLINE, 0.4);
  // keystone
  s.poly([[12, 0], [20, 0], [19, 8], [13, 8]], ST[3]);
  s.poly([[13, 0], [19, 0], [18, 7], [14, 7]], ST[2]);
  s.px(15, 3, TR[2]); s.px(16, 3, TR[2]); s.px(15, 4, TR[1]); s.px(16, 4, TR[1]);
  s.hline(12, 8, 8, P.OUTLINE, 0.6);
  return s;
}

/** The dark beyond an open doorway, with a lit sill you can walk over. */
function doorwayVoid(s: Surface, topY: number): void {
  for (let y = topY; y < DOOR_H - 2; y++) {
    const t = (y - topY) / (DOOR_H - topY);
    s.rect(6, y, 20, 1, t > 0.72 ? P.ECHO_DEEP[1] : t > 0.4 ? '#05050c' : P.ECHO_DEEP[0]);
  }
  // Sill: the "you can walk through here" signal, so it is the brightest line
  // on an open doorway and it gets a little of the dark's light spilling out.
  halo(s, 16, DOOR_H - 4, 14, P.ECHO_CYAN[1], 0.34, 2.2);
  s.rect(6, DOOR_H - 3, 20, 3, ST[2]);
  s.hline(6, DOOR_H - 3, 20, ST[4]);
  s.hline(6, DOOR_H - 2, 20, ST[3]);
  s.hline(6, DOOR_H - 1, 20, ST[0]);
  for (let x = 8; x < 24; x += 5) s.px(x, DOOR_H - 2, ST[1], 0.6);
}

/**
 * The barrier: two leaves of dressed stone with a brass band top and bottom.
 * The ONE closed silhouette in the dungeon; `sealed` only changes its colour.
 */
function doorSlab(s: Surface, topY: number, sealed: boolean): void {
  bevel(s, BAR_X, topY, BAR_W, DOOR_H - topY, ST, 2, false);
  s.rect(BAR_X, topY, BAR_W, 2, ST[0]);              // recessed under the lintel
  s.vline(BAR_X, topY, DOOR_H - topY, ST[1]);
  s.vline(BAR_X + BAR_W - 1, topY, DOOR_H - topY, ST[0]);
  // two leaves with a centre seam
  s.vline(15, topY + 2, DOOR_H - topY - 2, P.OUTLINE, 0.85);
  s.vline(16, topY + 2, DOOR_H - topY - 2, ST[3], 0.7);
  for (let y = topY + 4; y < DOOR_H - 2; y += 5) s.hline(7, y, 18, ST[1], 0.45);
  brassBand(s, 7, topY + 6, 18);
  brassBand(s, 7, DOOR_H - 9, 18);
  // The boss in the middle. An armillary, not a rune — a door that wears one of
  // the memory puzzle's four symbols teaches the player to read doors as clues.
  s.ellipse(11, topY + 12, 10, 10, ST[3]);
  s.ellipse(11, topY + 12, 10, 9, ST[2]);
  s.ellipseOutline(11, topY + 12, 10, 10, P.OUTLINE, 0.9);
  armillaryPlate(s, 16, topY + 17, 3, sealed ? P.ECHO_VIOLET[4] : TR[3]);
}

function doorBar(s: Surface, y: number, extend: number, sealBright: number): void {
  // brackets bolted into both jambs — the mechanism is visible before you touch it
  for (const bx of [3, 24]) {
    bevel(s, bx, y - 2, 5, 9, BR, 2, false);
    s.px(bx + 1, y, BR[4]); s.px(bx + 3, y + 5, BR[0]);
  }
  const halfW = Math.round(9 * extend);
  if (halfW > 0) {
    brassBand(s, 8 - halfW + 9, y + 1, halfW * 2, 5);
    s.hline(8 - halfW + 9, y + 5, halfW * 2, BR[0]);
  }
  if (sealBright > 0) {
    halo(s, 16, y + 3, 9 + sealBright * 5, P.ECHO_VIOLET[4], 0.25 + sealBright * 0.4, 2.4);
    s.ellipse(13, y, 7, 7, P.ECHO_VIOLET[1]);
    s.ellipseOutline(13, y, 7, 7, P.ECHO_VIOLET[3]);
    s.ellipse(14, y + 1, 5, 5, P.ECHO_VIOLET[Math.min(4, 2 + Math.round(sealBright * 2))]);
    s.px(16, y + 3, P.ECHO_GLOW);
  }
}

/** The head the barrier retracts into, drawn identically in every open state. */
function doorHead(s: Surface, bottom: number): void {
  s.rect(BAR_X, 8, BAR_W, bottom - 8, ST[1]);
  s.hline(BAR_X, 8, BAR_W, ST[0]);
  s.hline(BAR_X, bottom - 1, BAR_W, ST[3]);
  s.hline(BAR_X, bottom, BAR_W, P.OUTLINE, 0.9);
}

const doorShadow = { cx: DOOR_W / 2, y: DOOR_H, w: 26, h: 5 };

function door(state: 'closed' | 'open' | 'locked'): Surface {
  const s = doorFrame();
  if (state === 'open') {
    doorwayVoid(s, 12);
    doorHead(s, 12);
  } else {
    doorSlab(s, 8, state === 'locked');
    doorBar(s, 20, 1, state === 'locked' ? 1 : 0);
  }
  return operable(s, doorShadow);
}

function doorFrames(): Surface[] {
  const out: Surface[] = [];
  // 0 shut → 1 the seal flares and the bar splits → 2 leaves lifting → 3 open.
  // The frame never moves; only the barrier does.
  for (let f = 0; f < 4; f++) {
    const s = doorFrame();
    if (f === 0) { doorSlab(s, 8, false); doorBar(s, 20, 1, 0.2); }
    else if (f === 1) { doorSlab(s, 8, true); doorBar(s, 20, 0.45, 1); }
    else if (f === 2) {
      doorwayVoid(s, 26);
      doorHead(s, 26);
      brassBand(s, 7, 18, 18);
      doorBar(s, 20, 0, 0.35);
    } else {
      doorwayVoid(s, 12);
      doorHead(s, 12);
    }
    out.push(operable(s, doorShadow));
  }
  return out;
}

/**
 * The same opening, barred with Echo light instead of stone.
 *
 * It fills the SAME rectangle as the slab, hangs from the SAME head and lands
 * in the SAME sill, so at a glance it is the dungeon's one door in a different
 * state rather than a fourth kind of object. Violet means blocked, everywhere.
 */
function gate(extend: number): Surface {
  const s = doorFrame();
  doorwayVoid(s, 12);
  doorHead(s, 12);
  // floor sockets the bars drop into — visible whether or not they are down
  for (let k = 0; k < 4; k++) {
    const x = BAR_X + 2 + k * 5;
    s.rect(x, DOOR_H - 3, 3, 2, P.ECHO_DEEP[0]);
    s.px(x, DOOR_H - 3, ST[0]);
  }
  const len = Math.round((DOOR_H - 14) * extend);
  if (len > 0) {
    for (let k = 0; k < 4; k++) {
      const x = BAR_X + 2 + k * 5;
      halo(s, x + 1, 12 + len / 2, len * 0.5 + 5, P.ECHO_VIOLET[3], 0.24, 2.6);
    }
    // the brass rail the bars hang from — the slab's top band, in the same place
    brassBand(s, 7, 12, 18);
    for (let k = 0; k < 4; k++) {
      const x = BAR_X + 2 + k * 5;
      s.rect(x, 14, 3, len, P.ECHO_VIOLET[2]);
      s.vline(x, 14, len, P.ECHO_VIOLET[1]);
      s.vline(x + 1, 14, len, P.ECHO_FLAME[4]);       // hot core
      s.vline(x + 2, 14, len, P.ECHO_VIOLET[3]);
      // tip
      s.px(x, 14 + len, P.ECHO_VIOLET[1]);
      s.px(x + 1, 14 + len, P.ECHO_VIOLET[4]);
      s.px(x + 2, 14 + len, P.ECHO_VIOLET[1]);
      s.px(x + 1, 15 + len, P.ECHO_VIOLET[2]);
    }
    if (extend > 0.9) brassBand(s, 7, DOOR_H - 6, 18);
  }
  return operable(s, doorShadow);
}

// ── PRESSURE PLATE ─────────────────────────────────────────────────────────

/**
 * The most reused puzzle object in the dungeon, so it gets the most explicit
 * state language in the game: UP is a raised slab with a side face and a drop
 * shadow and a dead centre; DOWN is flush in a socket, the bevel inverted
 * (light on the *lower* inside edge, the way a real recess reads) and the
 * centre lit hard enough to spill onto the floor around it.
 */
function plate(down: boolean): Surface {
  const s = new Surface(22, 20);
  const cx = 11;
  if (!down) {
    // The socket it stands proud of, drawn as a hard dark ring: without this
    // the plate has no edge against the floor and disappears.
    s.ellipse(1, 5, 20, 13, P.OUTLINE, 0.75);
    // side face — three rows of it, so the slab is visibly *raised*
    s.ellipse(3, 9, 16, 8, ST[1]);
    s.hline(5, 15, 12, P.OUTLINE, 0.85);
    // Top face: dressed marble, which is what every operable object in the
    // shrine is made of. Two earlier versions of this plate were carved stone
    // one shade off the flagstone and simply disappeared into it.
    s.ellipse(2, 3, 18, 12, P.OUTLINE, 0.9);
    s.ellipse(3, 4, 16, 10, ST[3]);
    s.ellipse(3, 4, 15, 9, ST[4]);
    // dead inlay: a shallow groove, not a dark disc
    s.ellipseOutline(6, 6, 10, 7, ST[1], 0.75);
    s.ellipse(7, 7, 8, 5, ST[2]);
    s.ellipseOutline(7, 7, 8, 5, BR[3], 0.8);
    s.ellipse(9, 8, 4, 3, P.ECHO_CYAN[1]);
    s.px(10, 9, P.ECHO_CYAN[2]); s.px(11, 9, P.ECHO_CYAN[2]);
  } else {
    // socket: far inside wall dark, near inside wall catching the light — the
    // exact inverse of the raised bevel above, which is what sells "pressed"
    s.ellipse(1, 5, 20, 13, ST[2], 0.9);
    s.ellipse(2, 6, 18, 11, ST[1]);
    s.hline(5, 6, 12, P.OUTLINE);
    s.hline(5, 7, 12, P.OUTLINE, 0.7);
    s.hline(5, 15, 12, ST[4], 0.95);
    s.hline(5, 16, 12, ST[4], 0.7);
    s.hline(5, 17, 12, ST[3], 0.5);
    halo(s, cx, 11, 11, P.ECHO_CYAN[2], 0.45, 2.0);
    s.ellipse(4, 8, 14, 8, ST[3]);
    s.ellipseOutline(4, 8, 14, 8, ST[4], 0.6);
    s.ellipse(6, 9, 10, 6, P.ECHO_CYAN[2]);
    s.ellipse(7, 10, 8, 4, P.ECHO_CYAN[3]);
    s.ellipse(8, 11, 6, 2, P.ECHO_RUNE);
    s.px(10, 11, P.ECHO_RUNE_CORE); s.px(11, 11, P.ECHO_RUNE_CORE);
  }
  return operable(s, { cx, y: 19, w: down ? 18 : 20, h: down ? 4 : 5 });
}

// ── SWITCHES & LEVERS ──────────────────────────────────────────────────────

/**
 * The switch-node — the object that measured 1.02:1 against its own floor.
 *
 * It is now a marble post: a bezel head on a squat plinth, so it has a real
 * silhouette from any distance, and the crystal in it only says *which state*
 * it is in. Finding it must not depend on it being switched on.
 */
function switchProp(on: boolean): Surface {
  const s = new Surface(18, 24);
  bevel(s, 3, 15, 12, 7, ST, 2);              // plinth
  s.hline(3, 15, 12, ST[4]);
  s.hline(3, 21, 12, ST[0]);
  bevel(s, 4, 12, 10, 4, ST, 3);              // neck
  s.rect(3, 10, 12, 3, BR[2]);                // brass collar
  s.hline(3, 10, 12, BR[4]);
  s.hline(3, 12, 12, BR[0]);
  // The bezel. Always pale, always the same shape, in both states.
  s.ellipse(2, 1, 14, 12, ST[4]);
  s.ellipse(3, 2, 12, 10, ST[3]);
  s.ellipseOutline(2, 1, 14, 12, P.OUTLINE, 0.85);
  if (on) {
    halo(s, 9, 7, 10, P.ECHO_CYAN[3], 0.45, 2.2);
    s.ellipse(4, 3, 10, 8, P.ECHO_CYAN[2]);
    s.ellipse(5, 4, 8, 6, P.ECHO_CYAN[3]);
    s.ellipse(6, 5, 6, 4, P.ECHO_RUNE);
    s.px(8, 6, P.ECHO_RUNE_CORE); s.px(9, 6, P.ECHO_RUNE_CORE);
  } else {
    s.ellipse(4, 3, 10, 8, TR[0]);
    s.ellipseOutline(4, 3, 10, 8, TR[2], 0.8);
    s.px(6, 5, TR[1]); s.px(10, 7, TR[1], 0.6);
    s.hline(5, 11, 8, P.OUTLINE, 0.5);
  }
  return operable(s, { cx: 9, y: 23, w: 14 });
}

function lever(right: boolean): Surface {
  const s = new Surface(18, 26);
  bevel(s, 2, 16, 14, 8, ST, 2);
  s.hline(2, 16, 14, ST[4]);
  s.hline(2, 23, 14, ST[0]);
  // the slot the handle travels in, so the two positions are legible as a pair
  s.rect(4, 17, 10, 3, P.OUTLINE, 0.8);
  s.hline(4, 20, 10, ST[4], 0.5);
  const litX = right ? 11 : 5;
  halo(s, litX + 1, 18, 5, right ? P.ECHO_CYAN[3] : P.ECHO_VIOLET[2], right ? 0.5 : 0.2, 2.2);
  s.rect(litX, 17, 3, 3, right ? P.ECHO_RUNE : P.ECHO_VIOLET[1]);
  // handle
  const x0 = right ? 12 : 6, x1 = right ? 7 : 11;
  s.line(x0, 17, x1, 5, BR[1]);
  s.line(x0 + 1, 17, x1 + 1, 5, BR[3]);
  s.line(x0 + 2, 17, x1 + 2, 5, BR[0]);
  s.ellipse(x1 - 1, 2, 6, 6, BR[2]);
  s.ellipse(x1, 3, 4, 3, BR[4]);
  s.ellipseOutline(x1 - 1, 2, 6, 6, P.OUTLINE, 0.6);
  return operable(s, { cx: 9, y: 25, w: 15 });
}

// ── STATUES ────────────────────────────────────────────────────────────────

/**
 * Conformity-room statues. The whole room is "who is facing where", so facing
 * has to survive at 1× from across the room. Three cues stack:
 *   1. a carved mask on the front, plain stone on the back;
 *   2. a chest emblem, visible full-on, edge-on, or not at all;
 *   3. a chevron cut into the plinth's top surface, pointing where it looks —
 *      readable for all four facings, including the one facing away.
 */
function statue(dir: 'n' | 's' | 'e', mode: 'plain' | 'lit' | 'leader'): Surface {
  const fig = new Surface(24, 36);
  const lit = mode !== 'plain';

  // plinth
  fig.ellipse(2, 26, 20, 8, ST[1]);
  fig.rect(3, 30, 18, 4, ST[1]);
  fig.ellipse(2, 27, 20, 7, ST[3]);
  fig.ellipse(3, 28, 18, 5, ST[2]);
  fig.hline(3, 33, 18, P.OUTLINE, 0.7);
  fig.ellipseOutline(2, 26, 20, 8, P.OUTLINE, 0.45);

  // Plinth chevron — the facing indicator, and the only cue that works for the
  // statue that has its back to you. Cut hard: a dark groove with a bright
  // upper lip, at full contrast, or it vanishes at 1×.
  {
    const cvx = 12, cvy = dir === 'n' ? 28 : 31;
    const mark = (x: number, y: number) => {
      fig.px(x, y, P.OUTLINE, 0.9);
      fig.px(x, y - 1, ST[4], 0.9);
    };
    for (let i = 0; i <= 4; i++) {
      if (dir === 's') { mark(cvx - 4 + i, cvy - 2 + i); mark(cvx + 4 - i, cvy - 2 + i); }
      else if (dir === 'n') { mark(cvx - 4 + i, cvy + 2 - i); mark(cvx + 4 - i, cvy + 2 - i); }
      else { mark(cvx - 1 + i, cvy - 3 + i); mark(cvx - 1 + i, cvy + 3 - i); }
    }
  }

  // robe
  fig.poly([[7, 12], [16, 12], [20, 30], [3, 30]], ST[2]);
  fig.poly([[7, 12], [11, 12], [11, 30], [3, 30]], ST[3]);
  fig.poly([[14, 12], [16, 12], [20, 30], [16, 30]], ST[1]);
  for (let y = 14; y < 30; y++) {
    if (y % 4 === 0) { fig.px(9 + Math.floor(y / 12), y, ST[1], 0.5); fig.px(15 - Math.floor(y / 14), y, ST[0], 0.5); }
  }
  fig.outline(P.OUTLINE);

  // shoulders + collar
  fig.rect(5, 10, 14, 4, ST[2]);
  fig.hline(5, 10, 14, ST[4]);
  fig.hline(5, 13, 14, ST[0]);
  fig.px(4, 11, ST[1]); fig.px(19, 11, ST[1]);

  // head
  const hx = dir === 'e' ? 8 : 7;
  fig.ellipse(hx, 1, 10, 10, ST[2]);
  fig.ellipse(hx, 1, 8, 8, ST[3]);
  fig.ellipseOutline(hx, 1, 10, 10, P.OUTLINE, 0.8);
  fig.ellipse(hx + 5, 5, 5, 6, ST[1], 0.5);

  const eyes: Array<[number, number]> = [];
  if (dir === 's') {
    // mask plate — pale stone against the dark head, so the face is the
    // brightest shape on the statue and the front is unmistakable
    fig.rect(hx + 1, 2, 8, 8, ST[4]);
    fig.rect(hx + 1, 4, 8, 6, ST[3]);
    fig.hline(hx + 1, 2, 8, ST[4]);
    fig.hline(hx + 1, 9, 8, ST[0]);
    fig.vline(hx, 3, 7, ST[1]);
    fig.vline(hx + 9, 3, 7, ST[1]);
    fig.rect(hx + 4, 4, 2, 5, ST[4]);                     // nose ridge
    for (const ex of [hx + 2, hx + 6]) {
      fig.rect(ex, 4, 2, 3, P.OUTLINE);
      eyes.push([ex + 0.5, 5]);
    }
    fig.hline(hx + 3, 8, 4, P.OUTLINE, 0.85);             // mouth slit
    // chest emblem
    fig.ellipse(8, 16, 8, 8, ST[1]);
    fig.ellipseOutline(8, 16, 8, 8, ST[3]);
    fig.ellipse(10, 18, 4, 4, TR[2]);
    fig.ellipseOutline(10, 18, 4, 4, P.OUTLINE, 0.5);
  } else if (dir === 'e') {
    fig.rect(hx + 3, 2, 6, 8, ST[4]);                     // mask, seen edge-on
    fig.rect(hx + 3, 4, 6, 6, ST[3]);
    fig.hline(hx + 3, 9, 6, ST[0]);
    fig.rect(hx + 9, 3, 2, 4, ST[4]);                     // brow / nose in profile
    fig.px(hx + 10, 5, ST[3]);
    fig.px(hx + 9, 7, ST[2]);
    fig.rect(hx + 5, 4, 2, 3, P.OUTLINE);
    eyes.push([hx + 5.5, 5]);
    fig.vline(hx + 2, 2, 8, ST[1]);
    fig.vline(hx + 1, 3, 7, ST[0], 0.7);                  // shadowed back of head
    fig.rect(14, 16, 3, 7, ST[1]);                        // emblem edge
    fig.vline(16, 16, 7, TR[2]);
    fig.px(16, 19, TR[3]);
  } else {
    fig.vline(hx + 4, 2, 8, ST[1]);                       // plain back, one seam
    fig.vline(hx + 5, 2, 8, ST[3], 0.5);
    fig.ellipse(hx + 1, 2, 8, 5, ST[4], 0.35);            // crown of the head
    fig.vline(11, 14, 15, ST[1], 0.7);
    fig.vline(12, 14, 15, ST[3], 0.4);
  }

  if (mode === 'leader') {
    // a crown: the leader has to be identifiable by silhouette alone
    for (const px of [hx + 1, hx + 4, hx + 7]) {
      fig.rect(px, 0, 2, 3, ST[4]);
      fig.px(px, 0, TR[3]);
    }
    fig.rect(hx, 2, 10, 2, BR[2]);
    fig.hline(hx, 2, 10, BR[4]);
    fig.hline(hx, 3, 10, BR[0]);
    fig.rect(hx + 4, 2, 2, 2, P.ECHO_GLOW);
  }

  // The statue is an operable object — its facing IS the puzzle state — so it
  // is marble, outlined and rim-lit like everything else the player can act on.
  const body = operable(fig, null);
  if (lit) {
    const gc = mode === 'leader' ? P.ECHO_GLOW : P.ECHO_RUNE;
    for (const [ex, ey] of eyes) {
      body.rect(Math.round(ex - 0.5), Math.round(ey - 0.5), 2, 2, gc);
      body.px(Math.round(ex), Math.round(ey), P.ECHO_RUNE_CORE);
    }
    if (dir === 'n') {
      body.vline(hx + 4, 3, 7, gc, 0.7);                   // light in the back seam
      body.vline(11, 15, 12, gc, 0.45);
    }
    if (dir === 's') { body.ellipse(10, 18, 4, 4, gc); body.px(11, 19, P.ECHO_RUNE_CORE); }
    if (dir === 'e') { body.vline(16, 16, 7, gc); body.px(16, 19, P.ECHO_RUNE_CORE); }
  }

  const out = new Surface(24, 36);
  hardContact(out, 12, 35, 20, 5);
  if (lit) {
    const gc = mode === 'leader' ? P.ECHO_GLOW : P.ECHO_RUNE;
    if (eyes.length) for (const [ex, ey] of eyes) halo(out, ex, ey, 7, gc, 0.5, 2.2);
    else halo(out, hx + 5, 5, 10, gc, 0.34, 2.4);          // facing away: rim bloom
    halo(out, 12, 18, 8, gc, 0.22, 2.6);
  }
  out.blit(body);
  return out;
}

// ── PILLARS, BRAZIERS, CRYSTALS, RUNE PILLARS ──────────────────────────────

/**
 * A column is a *cylinder*, and the first version of this read as a barred
 * cage because it was drawn as a row of evenly-spaced flutes. The shaft now
 * gets a proper round falloff — light left edge, mid body, dark right — with
 * only two flute pairs cut into it.
 */
function pillar(v: number): Surface {
  const s = new Surface(24, 48);
  const r = rng(7100 + v * 31);
  contact(s, 12, 47, 22, 5, 0.38);
  // base: two steps
  bevel(s, 0, 41, 24, 6, ST, 2);
  bevel(s, 2, 37, 20, 5, ST, 1);
  s.hline(2, 37, 20, ST[3]);
  // shaft, shaded as a cylinder
  const bands: Array<[number, number, number]> = [[4, 2, 4], [6, 8, 3], [14, 3, 2], [17, 2, 1], [19, 1, 0]];
  for (const [x, w, tone] of bands) s.rect(x, 8, w, 30, ST[tone]);
  s.vline(4, 8, 30, ST[4], 0.8);
  s.vline(19, 8, 30, P.OUTLINE, 0.65);
  for (const fx of [8, 15]) {                    // two shallow flutes, no more
    s.vline(fx, 9, 28, ST[Math.min(4, (fx === 8 ? 4 : 2))], 0.5);
    s.vline(fx + 1, 9, 28, ST[0], 0.45);
  }
  for (const jy of [17, 27]) {                   // drum joints
    s.hline(4, jy, 16, P.OUTLINE, 0.65);
    s.hline(4, jy + 1, 16, ST[4], 0.4);
  }
  // capital
  bevel(s, 0, 2, 24, 6, ST, 3);
  s.hline(0, 2, 24, ST[4]);
  s.hline(0, 5, 24, ST[1]);
  bevel(s, 3, 0, 18, 3, ST, 2);
  s.rect(3, 8, 18, 2, ST[1]);
  s.hline(3, 9, 18, P.OUTLINE, 0.7);

  if (v === 1) {
    // sheared off: the capital is gone and the shaft ends in a broken lip
    erase(s, 0, 0, 24, 14);
    for (let x = 4; x < 20; x++) {
      const top = 12 + Math.round(Math.sin((x - 4) * 0.8) * 2);
      erase(s, x, 0, 1, top);
      s.px(x, top, ST[4]);
      s.px(x, top + 1, ST[0], 0.6);
    }
    crack(s, 11, 18, 20, 'v', r, P.OUTLINE, ST[4], 0.8);
    speckle(s, r, 4, 30, 16, 8, ST[0], 6, 0.5);
    for (let i = 0; i < 5; i++) {                // fallen chips at the foot
      const x = r.int(0, 20), y = r.int(43, 46);
      s.rect(x, y, r.int(2, 4), 2, ST[2]);
      s.px(x, y, ST[3]);
    }
  } else if (v === 2) {
    // colonised: moss climbing the shaft, light in the fissure
    crack(s, 9, 12, 24, 'v', r, P.ECHO_VIOLET[1], ST[4], 0.9);
    for (let i = 0; i < 26; i++) {
      const y = 14 + r.int(0, 24), x = 5 + r.int(0, 13);
      s.px(x, y, P.SHRINE_MOSS[r.pick([1, 2, 3])], 0.85);
    }
    halo(s, 10, 26, 9, P.ECHO_VIOLET[3], 0.3, 2.4);
    for (let y = 14; y < 36; y += 5) s.px(9 + ((y / 5) & 1), y, P.ECHO_GLOW, 0.8);
  }
  return s;
}

function brazier(frame: number): Surface {
  const r = rng(7200 + frame * 17);
  // The fixture is the operable object; the flame is light and is composited
  // over it afterwards so the contract's outline never runs around the fire.
  const fig = new Surface(22, 32);
  for (const [x0, x1] of [[4, 2], [11, 11], [17, 19]] as const) {
    fig.line(x0, 18, x1, 29, BR[1]);
    fig.line(x0 + 1, 18, x1 + 1, 29, BR[3]);
    fig.px(x1, 29, BR[0]);
  }
  fig.ellipse(6, 27, 10, 3, BR[2]);
  fig.ellipse(1, 12, 20, 10, BR[2]);
  fig.ellipse(1, 12, 20, 8, BR[3]);
  fig.ellipseOutline(1, 12, 20, 10, P.OUTLINE, 0.6);
  fig.ellipse(3, 13, 16, 5, BR[1]);
  fig.hline(2, 12, 18, BR[4], 0.95);
  fig.hline(2, 13, 18, BR[4], 0.5);
  fig.px(4, 16, BR[4]); fig.px(16, 17, BR[1]);
  const body = operable(fig, null);

  const s = new Surface(22, 32);
  hardContact(s, 11, 31, 18, 5);
  halo(s, 11, 28, 12, P.ECHO_FLAME[2], 0.16, 2.6);        // light pooling on the floor
  s.blit(body);
  // flame
  const sway = [0, 1, 0, -1][frame];
  const hgt = [10, 12, 11, 9][frame];
  halo(s, 11 + sway, 12 - hgt / 2, 13 + hgt / 2, P.ECHO_FLAME[2], 0.34, 2.2);
  const lobes: Array<[number, number, number]> = [
    [11 + sway, 14 - hgt, 5],
    [7 + sway, 14 - hgt * 0.6, 3],
    [15 + sway, 14 - hgt * 0.7, 3],
  ];
  for (const [lx, ly, lw] of lobes) {
    s.poly([[lx, ly], [lx + lw, ly + lw + 3], [lx, ly + lw + 6], [lx - lw, ly + lw + 3]], P.ECHO_FLAME[1]);
    s.poly([[lx, ly + 2], [lx + lw - 1, ly + lw + 3], [lx, ly + lw + 4], [lx - lw + 1, ly + lw + 3]], P.ECHO_FLAME[3]);
  }
  s.ellipse(9 + sway, 8, 5, 6, P.ECHO_FLAME[4], 0.85);
  speckle(s, r, 6, 0, 11, 8, P.ECHO_FLAME[4], 3, 0.7);
  return s;
}

function crystal(frame: number): Surface {
  const pulse = [0, 1, 2, 1][frame];
  const fig = new Surface(18, 26);
  // dressed cradle — a crystal in this dungeon is always set in a cut socket,
  // never simply growing out of the flagstone
  fig.ellipse(1, 18, 16, 7, ST[2]);
  fig.ellipse(2, 18, 14, 5, ST[3]);
  fig.ellipse(3, 19, 12, 3, ST[4]);
  fig.ellipseOutline(1, 18, 16, 7, P.OUTLINE, 0.7);
  const shard = (x: number, top: number, w: number, bot: number, tone: number) => {
    fig.poly([[x, top], [x + w, top + 3], [x + w - 1, bot], [x + 1, bot]], P.ECHO_CYAN[tone]);
    fig.line(x + 1, top + 2, x + 1, bot - 1, P.ECHO_CYAN[Math.min(4, tone + 1)]);
    fig.line(x + w - 1, top + 4, x + w - 1, bot - 1, P.ECHO_CYAN[Math.max(0, tone - 1)]);
    fig.px(x, top, P.ECHO_RUNE);
  };
  shard(3, 12, 4, 20, 2);
  shard(11, 10, 4, 20, 2);
  shard(6, 3, 6, 21, 3);
  fig.vline(8, 7, 13, P.ECHO_RUNE, 0.7 + pulse * 0.12);
  fig.vline(9, 9, 10, P.ECHO_RUNE, 0.4);
  fig.px(8, 5, P.ECHO_RUNE_CORE, 0.8 + pulse * 0.07);
  fig.px(9, 6, P.ECHO_RUNE_CORE, 0.6);
  const body = operable(fig, null);

  const s = new Surface(18, 26);
  hardContact(s, 9, 25, 14, 4);
  halo(s, 9, 14, 10 + pulse * 2, P.ECHO_CYAN[3], 0.22 + pulse * 0.08, 2.3);
  s.blit(body);
  return s;
}

function runePillar(g: Glyph, lit: boolean): Surface {
  const fig = new Surface(18, 38);
  bevel(fig, 1, 31, 16, 6, ST, 3);               // base
  fig.poly([[3, 4], [14, 4], [15, 32], [2, 32]], ST[3]);
  fig.poly([[3, 4], [8, 4], [8, 32], [2, 32]], ST[4]);
  fig.poly([[12, 5], [14, 4], [15, 32], [12, 32]], ST[2]);
  fig.ellipse(3, 1, 12, 7, ST[4]);               // rounded head
  fig.ellipse(4, 2, 10, 5, ST[3]);
  fig.outline(P.OUTLINE);
  // recessed panel
  fig.rect(4, 10, 10, 14, ST[1]);
  fig.hline(4, 10, 10, P.OUTLINE, 0.7);
  fig.vline(4, 10, 14, P.OUTLINE, 0.5);
  fig.hline(4, 23, 10, ST[4], 0.6);
  const body = operable(fig, null);
  glyphPlate(body, g, 9, 17, 11, lit);

  const s = new Surface(18, 38);
  hardContact(s, 9, 37, 16, 5);
  if (lit) halo(s, 9, 34, 11, P.ECHO_CYAN[2], 0.24, 2.6);
  s.blit(body);
  return s;
}

// ── BLOCKS, CHESTS, DEBRIS ─────────────────────────────────────────────────

/** Movable block: brass corner brackets and a grip groove say "push me". */
function blockPush(): Surface {
  const s = new Surface(22, 24);
  s.rect(1, 7, 20, 14, ST[3]);
  s.rect(1, 1, 20, 6, ST[4]);                    // top face, seen in 3/4
  s.hline(1, 6, 20, ST[2]);
  s.hline(1, 7, 20, P.OUTLINE, 0.55);
  s.vline(1, 1, 20, ST[4]);
  s.vline(20, 1, 20, ST[1]);
  s.hline(1, 20, 20, ST[1]);
  s.rect(3, 10, 16, 4, ST[1], 0.9);              // grip groove
  s.hline(3, 10, 16, P.OUTLINE, 0.85);
  s.hline(3, 13, 16, ST[4], 0.6);
  s.rect(5, 11, 3, 2, P.OUTLINE, 0.65);
  s.rect(14, 11, 3, 2, P.OUTLINE, 0.65);
  for (const [bx, by] of [[1, 4], [17, 4], [1, 16], [17, 16]] as const) {
    s.rect(bx, by, 4, 4, BR[2]);
    s.hline(bx, by, 4, BR[4], 0.8);
    s.hline(bx, by + 3, 4, BR[0]);
    s.px(bx + 1, by + 1, BR[4]);
    s.px(bx + 2, by + 2, BR[0]);
  }
  return operable(s, { cx: 11, y: 23, w: 20 });
}

/**
 * Not a Zelda chest: an observatory specimen coffer — a stone box with brass
 * corner straps and a low brass lid, opened by a cyan seal on its face rather
 * than a padlock. Reads as a container because of the box-and-lid silhouette,
 * not because of any borrowed detail.
 */
function chest(open: boolean): Surface {
  const s = new Surface(26, 24);
  const lidBot = open ? 6 : 12;                  // where the lid stops
  // ── body: a stone box with brass straps, feet, and a lit top edge
  s.rect(1, lidBot, 24, 22 - lidBot, ST[3]);
  s.vline(1, lidBot, 22 - lidBot, ST[4]);
  s.vline(24, lidBot, 22 - lidBot, ST[1]);
  s.hline(1, 21, 24, ST[1]);
  s.hline(1, 22, 24, P.OUTLINE, 0.85);
  for (let y = lidBot + 3; y < 21; y += 4) s.hline(2, y, 22, ST[2], 0.4);
  // Bands run *across* the body. Vertical straps at the corners read as table
  // legs, which turned the first version of this into an altar.
  brassBand(s, 1, lidBot + 1, 24);
  brassBand(s, 1, 18, 24);
  for (const fx of [2, 20]) { s.rect(fx, 22, 4, 2, ST[1]); s.hline(fx, 23, 4, P.OUTLINE, 0.8); }

  if (!open) {
    // ── lid down: brass cap, stone body, a split line you can see
    s.rect(0, 4, 26, 8, ST[3]);
    s.rect(0, 6, 26, 6, ST[2]);
    s.hline(0, 3, 26, BR[2]);
    s.hline(0, 2, 26, BR[4], 0.9);
    s.hline(0, 4, 26, ST[4]);
    s.vline(0, 3, 9, ST[4]);
    s.vline(25, 3, 9, ST[0]);
    s.hline(0, 11, 26, ST[0]);
    s.hline(0, 12, 26, P.OUTLINE, 0.9);          // the lid/body split
    for (const rx of [5, 19]) { s.vline(rx, 3, 9, BR[2]); s.vline(rx + 1, 3, 9, BR[0], 0.6); }
    s.rect(11, 11, 4, 3, BR[3]);                 // latch tongue crossing the split
    s.hline(11, 11, 4, BR[4]);
    s.hline(11, 13, 4, BR[0]);
    s.ellipse(8, 3, 10, 9, BR[1]);               // seal plate on the lid face
    s.ellipse(9, 4, 8, 7, ST[2]);
    s.ellipseOutline(8, 3, 10, 9, BR[4], 0.8);
    armillaryPlate(s, 13, 7, 3);                 // an instrument mark, not a rune
  } else {
    // ── lid up and back; the light that was shut in is out
    halo(s, 13, 6, 17, P.ECHO_CYAN[3], 0.42, 2.0);
    s.rect(0, 0, 26, 4, ST[3]);
    s.hline(0, 0, 26, BR[3]);
    s.hline(0, 1, 26, ST[4]);
    s.hline(0, 3, 26, ST[0]);
    s.hline(0, 4, 26, P.OUTLINE, 0.85);
    for (const rx of [5, 19]) s.vline(rx, 0, 4, BR[1], 0.7);
    // The open mouth: light is pouring out of it, so the inside is the
    // brightest part of the sprite rather than a black rectangle with a strip
    // of cyan in it — an opened coffer should be legible from across the room.
    s.rect(2, 6, 22, 5, P.ECHO_CYAN[0]);
    s.hline(2, 6, 22, P.OUTLINE);
    s.rect(3, 7, 20, 4, P.ECHO_CYAN[2]);
    s.rect(5, 7, 16, 3, P.ECHO_CYAN[3]);
    s.rect(7, 7, 12, 2, P.ECHO_CYAN[4]);
    s.hline(9, 7, 8, P.ECHO_RUNE_CORE);
    s.hline(1, 10, 24, ST[4], 0.9);              // near rim, lit from inside
    s.hline(1, 11, 24, ST[3]);
    for (let i = 0; i < 5; i++) s.px(7 + i * 3, 5 - (i & 1), P.ECHO_RUNE, 0.55);
  }
  return operable(s, { cx: 13, y: 23, w: 24 });
}

function rubble(v: number): Surface {
  const s = new Surface(22, 18);
  const r = rng(7300 + v * 23);
  contact(s, 11, 17, 20, 5, 0.4);
  // Chunks of fallen ceiling: big enough and light enough to read as debris
  // rather than dirt. Small dark specks on a dark floor are worth nothing.
  const n = 3 + v;
  for (let i = 0; i < n; i++) {
    const w = r.int(6, 10), h = r.int(5, 8);
    const x = r.int(0, 22 - w), y = r.int(2, 17 - h);
    const tone = r.pick([2, 2, 3]);
    s.poly([[x, y + 2], [x + w - 3, y], [x + w, y + h - 2], [x + 3, y + h]], ST[tone]);
    s.line(x, y + 2, x + w - 3, y, ST[4]);
    s.line(x + w - 3, y, x + w, y + h - 2, ST[Math.max(0, tone - 1)]);
    s.line(x + 3, y + h, x + w, y + h - 2, P.OUTLINE, 0.8);
    s.line(x, y + 2, x + 3, y + h, P.OUTLINE, 0.4);
    s.px(x + 2, y + 3, ST[Math.min(4, tone + 1)]);
  }
  for (let i = 0; i < 4; i++) {                  // grit around the pile
    const x = r.int(0, 20), y = r.int(12, 16);
    s.rect(x, y, 2, 1, ST[2]);
    s.px(x, y, ST[3]);
  }
  if (v === 2) for (let i = 0; i < 6; i++) s.px(r.int(1, 20), r.int(4, 15), P.SHRINE_MOSS[3], 0.65);
  return s;
}

/** Roots from the Whisper Woods, forcing their way through the ceiling. */
function root(v: number): Surface {
  const s = new Surface(22, 30);
  const r = rng(7400 + v * 19);
  const strands = 2 + v;
  for (let k = 0; k < strands; k++) {
    let x = 3 + k * 6 + r.int(-1, 1);
    let w = 5;                                   // thick enough to read as timber
    const len = 20 + r.int(0, 8);
    for (let y = 0; y < len; y++) {
      s.rect(x, y, w, 1, P.WOODS_BARK[2]);
      s.px(x, y, P.WOODS_BARK[4]);               // lit left edge
      s.px(x + 1, y, P.WOODS_BARK[3]);
      s.px(x + w - 1, y, P.WOODS_BARK[0]);
      if (y > 10 && r.chance(0.2) && w > 2) w -= 1;
      x += r.chance(0.32) ? (r.chance(0.5) ? 1 : -1) : 0;
      if (y === Math.floor(len * 0.6) && r.chance(0.7)) {
        // a side branch, so a root is not a straight rod
        let bx = x, bw = Math.max(2, w - 1);
        for (let j = 0; j < 7; j++) {
          bx += k % 2 ? 1 : -1;
          s.rect(bx, y + j, bw, 1, P.WOODS_BARK[2]);
          s.px(bx, y + j, P.WOODS_BARK[3]);
          if (j > 3 && bw > 1) bw -= 1;
        }
      }
    }
    s.px(x + 1, len, P.WOODS_BARK[1]);
  }
  // the hole in the ceiling it forced its way through
  s.ellipse(2, 0, 18, 6, P.ECHO_DEEP[0]);
  s.ellipseOutline(2, 0, 18, 6, ST[1], 0.85);
  s.hline(4, 4, 14, ST[3], 0.45);
  for (let i = 0; i < 8; i++) s.px(r.int(3, 18), r.int(12, 27), P.SHRINE_MOSS[3], 0.55);
  s.outline(P.OUTLINE);
  return s;
}

// ── OBSERVATORY WRECKAGE ───────────────────────────────────────────────────
// The environmental storytelling: this was a place where people measured
// something. Brass, glass, and a fallen model of the sky.

function brokenInstrument(v: number): Surface {
  if (v === 0) {
    // a toppled orrery: rings off their axis, the central sphere loose
    const s = new Surface(30, 26);
    const r = rng(7500);
    contact(s, 15, 25, 26, 5, 0.4);
    s.rect(11, 18, 8, 6, ST[2]);                 // broken plinth
    s.hline(11, 18, 8, ST[3]);
    s.hline(11, 23, 8, P.OUTLINE, 0.7);
    s.ellipse(2, 6, 26, 16, BR[1], 0);           // (bounds only)
    s.ellipseOutline(2, 6, 26, 16, BR[2]);
    s.ellipseOutline(2, 7, 26, 16, BR[0], 0.7);
    s.ellipseOutline(6, 9, 18, 11, BR[3]);
    s.ellipseOutline(6, 10, 18, 11, BR[0], 0.6);
    s.line(3, 20, 12, 14, BR[2]);                // snapped arm on the floor
    s.line(3, 21, 12, 15, BR[0]);
    s.px(2, 20, BR[4]);
    halo(s, 15, 14, 7, P.ECHO_CYAN[2], 0.3, 2.4);
    s.ellipse(12, 11, 7, 7, P.ECHO_CYAN[1]);     // the sphere still holds light
    s.ellipse(13, 12, 5, 4, P.ECHO_CYAN[3]);
    s.px(14, 13, P.ECHO_RUNE_CORE);
    speckle(s, r, 2, 20, 26, 5, BR[2], 5, 0.7);
    return s;
  }
  if (v === 1) {
    // a telescope off its mounting, lens cracked
    const s = new Surface(26, 30);
    contact(s, 13, 29, 22, 5, 0.4);
    for (const [x0, x1] of [[6, 2], [13, 13], [20, 24]] as const) {
      s.line(x0, 16, x1, 27, ST[2]);
      s.line(x0 + 1, 16, x1 + 1, 27, ST[0]);
    }
    s.rect(7, 13, 12, 5, ST[1]);
    s.hline(7, 13, 12, ST[3]);
    // tube, tilted down
    s.poly([[3, 10], [19, 2], [23, 8], [7, 16]], BR[2]);
    s.poly([[3, 10], [19, 2], [20, 4], [4, 12]], BR[3]);
    s.poly([[6, 15], [22, 7], [23, 8], [7, 16]], BR[0]);
    s.line(9, 12, 13, 5, BR[0], 0.6);
    s.line(15, 9, 19, 2, BR[0], 0.4);
    // cracked objective lens
    s.ellipse(1, 7, 7, 8, P.GLASS_COLD[1]);
    s.ellipse(2, 8, 5, 6, P.GLASS_COLD[3]);
    s.line(2, 8, 6, 13, P.GLASS_COLD[0]);
    s.line(4, 8, 3, 13, P.GLASS_COLD[4], 0.7);
    s.line(3, 10, 6, 9, P.GLASS_COLD[0]);
    s.ellipseOutline(1, 7, 7, 8, BR[3]);
    s.outline(P.OUTLINE);
    return s;
  }
  // a resonance dish, dented, half off its cradle
  const s = new Surface(28, 24);
  const r = rng(7600);
  contact(s, 14, 23, 24, 5, 0.4);
  s.rect(10, 15, 8, 7, ST[2]);
  s.hline(10, 15, 8, ST[3]);
  s.hline(10, 21, 8, P.OUTLINE, 0.7);
  s.line(6, 21, 14, 16, ST[1]);
  s.line(21, 21, 14, 16, ST[1]);
  s.ellipse(3, 2, 22, 14, BR[1]);
  s.ellipse(4, 3, 20, 12, BR[2]);
  s.ellipse(6, 4, 16, 8, BR[0]);
  s.ellipse(7, 5, 14, 5, BR[1]);
  s.ellipseOutline(3, 2, 22, 14, P.OUTLINE, 0.7);
  s.hline(4, 3, 20, BR[4], 0.7);
  // dent + tear
  s.poly([[16, 4], [23, 6], [21, 12], [17, 9]], BR[0], 0.8);
  s.line(16, 4, 21, 12, P.OUTLINE, 0.7);
  s.vline(13, 9, 8, BR[3]);
  s.px(13, 8, P.ECHO_CYAN[3]);
  speckle(s, r, 3, 16, 22, 6, BR[1], 4, 0.6);
  return s;
}

// ── MOTHS, POOLS, THE SEAL ─────────────────────────────────────────────────

function moth(frame: number): Surface {
  const s = new Surface(12, 12);
  const spread = [4, 5, 4, 3][frame];
  const lift = [0, -1, 0, 1][frame];
  halo(s, 6, 6 + lift, 6, P.ECHO_CYAN[3], 0.45, 2.0);
  // trail
  for (let i = 1; i <= 3; i++) s.px(6 - i * 2, 7 + lift + (i & 1), P.ECHO_CYAN[3], 0.42 - i * 0.1);
  // wings
  for (const dir of [-1, 1]) {
    s.poly([
      [6, 5 + lift], [6 + dir * spread, 2 + lift], [6 + dir * (spread + 1), 6 + lift], [6 + dir * 2, 8 + lift],
    ], P.ECHO_CYAN[2], 0.9);
    s.poly([[6, 5 + lift], [6 + dir * (spread - 1), 4 + lift], [6 + dir * 2, 7 + lift]], P.ECHO_RUNE, 0.85);
  }
  // body
  s.vline(6, 4 + lift, 5, P.ECHO_DEEP[2]);
  s.px(6, 3 + lift, P.ECHO_RUNE_CORE);
  s.px(5, 3 + lift, P.ECHO_CYAN[4], 0.8);
  return s;
}

function mothJar(): Surface {
  const fig = new Surface(16, 22);
  // dressed base — the jar is a specimen on a stand, and the stand is what
  // makes it findable when the moth inside happens to be dim
  fig.rect(2, 17, 12, 4, ST[3]);
  fig.hline(2, 17, 12, ST[4]);
  fig.hline(2, 20, 12, ST[1]);
  // glass
  fig.rect(2, 6, 12, 12, P.GLASS_COLD[1], 0.55);
  fig.ellipse(2, 15, 12, 5, P.GLASS_COLD[1], 0.55);
  fig.ellipse(2, 4, 12, 5, P.GLASS_COLD[2], 0.7);
  fig.vline(2, 8, 10, P.GLASS_COLD[4], 0.7);
  fig.vline(13, 8, 10, P.GLASS_COLD[0], 0.6);
  fig.px(4, 9, P.GLASS_COLD[4], 0.9); fig.px(4, 10, P.GLASS_COLD[4], 0.6);
  // the moth inside
  fig.blit(moth(1), 2, 5);
  // brass lid
  fig.rect(3, 1, 10, 4, BR[2]);
  fig.hline(3, 1, 10, BR[4]);
  fig.hline(3, 4, 10, BR[0]);
  fig.rect(5, 0, 6, 2, BR[3]);
  fig.rect(2, 5, 12, 2, BR[1]);
  fig.hline(2, 5, 12, BR[3]);
  const body = operable(fig, null);

  const s = new Surface(16, 22);
  hardContact(s, 8, 21, 12, 4);
  halo(s, 8, 12, 11, P.ECHO_CYAN[2], 0.3, 2.3);
  s.blit(body);
  return s;
}

function echoPool(frame: number): Surface {
  const s = new Surface(26, 18);
  const r = rng(7700 + frame * 13);
  const puff = [0, 1, 2, 1][frame];
  // A cut stone kerb. The pool used to be a violet puddle painted straight onto
  // the flagstone with nothing to say where its edge was, and a puddle you can
  // walk into is a very different object from one you touch on purpose.
  const kerb = new Surface(26, 18);
  kerb.ellipse(0, 2, 26, 15, ST[2]);
  kerb.ellipse(0, 2, 26, 13, ST[4]);
  kerb.ellipse(1, 4, 24, 12, ST[3]);
  kerb.ellipse(2, 5, 22, 11, ST[1]);
  kerb.ellipseOutline(0, 2, 26, 15, P.OUTLINE, 0.8);
  const ring = operable(kerb, { cx: 13, y: 17, w: 24, h: 4 });
  s.blit(ring);

  halo(s, 13, 10, 13 + puff, P.ECHO_VIOLET[3], 0.22 + puff * 0.05, 2.5);
  s.ellipse(3, 6, 20, 10, P.ECHO_VIOLET[1], 0.9);
  s.ellipse(4, 6, 18, 9, P.ECHO_VIOLET[3]);
  s.ellipse(6 + puff, 8, 14 - puff * 2, 5, P.ECHO_VIOLET[4]);
  s.ellipse(9, 9, 8, 3, P.ECHO_GLOW, 0.9);
  s.ellipseOutline(3, 6, 20, 10, P.ECHO_GLOW, 0.7);
  // motes lifting off the surface
  for (let i = 0; i < 4; i++) {
    const x = r.int(5, 20), y = r.int(0, 6);
    s.px(x, y, P.ECHO_GLOW, 0.8);
    s.px(x, y + 1, P.ECHO_VIOLET[3], 0.4);
  }
  for (let i = 0; i < 3; i++) s.px(r.int(7, 18), r.int(8, 13), P.ECHO_SPARK, 0.7);
  return s;
}

/**
 * The boss door: an arch with an armillary ring and a violet chain across it.
 *
 * This is the one place the four rune glyphs used to appear together as pure
 * decoration — the dungeon's entire symbolic vocabulary, spent on a door the
 * player cannot interact with. It now wears four armillary quadrants instead,
 * which say "instrument" without saying "puzzle state".
 */
function bossSeal(frame: number): Surface {
  const fig = new Surface(48, 56);
  const pulse = [0, 1, 2, 1][frame];
  // jambs and arch
  for (const [jx, lit] of [[0, true], [40, false]] as const) {
    bevel(fig, jx, 10, 8, 46, ST, 2, false);
    fig.vline(lit ? jx : jx + 7, 10, 46, ST[lit ? 4 : 0]);
    for (let y = 14; y < 56; y += 8) fig.hline(jx, y, 8, P.OUTLINE, 0.5);
  }
  fig.rect(0, 4, 48, 8, ST[2]);
  fig.hline(0, 4, 48, ST[4]);
  fig.hline(0, 11, 48, ST[0]);
  fig.rect(2, 0, 44, 4, ST[3]);
  fig.hline(2, 0, 44, ST[4]);
  for (let x = 6; x < 44; x += 7) fig.vline(x, 0, 4, P.OUTLINE, 0.4);
  // the doorway, sealed
  fig.rect(8, 12, 32, 44, ST[2]);
  fig.rect(9, 13, 30, 42, ST[1]);
  for (let y = 16; y < 54; y += 9) fig.hline(9, y, 30, ST[3], 0.5);
  fig.vline(23, 13, 42, ST[3], 0.5);
  const body = operable(fig, { cx: 24, y: 55, w: 40, h: 6 });

  // ring
  halo(body, 24, 32, 20 + pulse * 2, P.ECHO_VIOLET[3], 0.2 + pulse * 0.06, 2.6);
  body.ellipseOutline(8, 16, 32, 32, P.ECHO_VIOLET[1]);
  body.ellipseOutline(9, 17, 30, 30, P.ECHO_VIOLET[3], 0.8);
  body.ellipseOutline(11, 19, 26, 26, P.ECHO_VIOLET[2], 0.55);
  // four armillary quadrants around the ring, one lighting at a time
  const spots: Array<[number, number]> = [[24, 21], [34, 32], [24, 43], [14, 32]];
  spots.forEach(([gx, gy], i) => {
    armillary(body, gx + 1, gy + 1, 4, P.SHRINE_INK, 0.7);
    armillary(body, gx, gy, 4, i === pulse ? P.ECHO_GLOW : P.SHRINE_MARBLE[3], i === pulse ? 1 : 0.75);
  });
  // chains of violet light across the middle
  for (const cy of [28, 36]) {
    for (let x = 9; x < 39; x++) {
      const w = Math.sin((x + frame * 2) * 0.5) > 0 ? 0 : 1;
      body.px(x, cy + w, P.ECHO_VIOLET[3], 0.85);
      body.px(x, cy + w + 1, P.ECHO_VIOLET[1], 0.6);
    }
  }
  body.ellipse(21, 29, 6, 6, P.ECHO_VIOLET[2]);
  body.ellipse(22, 30, 4, 4, P.ECHO_GLOW, 0.7 + pulse * 0.1);
  return body;
}

// ── SHRINE EXTERIOR PROPS ──────────────────────────────────────────────────

function brokenColumn(v: number): Surface {
  const h = [30, 20, 13][v];
  const s = new Surface(22, h);
  const r = rng(7800 + v * 29);
  contact(s, 11, h - 1, 20, 5, 0.36);
  bevel(s, 0, h - 6, 22, 5, P.SHRINE_OUTER, 2);
  s.rect(3, 2, 16, h - 6, P.SHRINE_OUTER[2]);
  for (let x = 3; x < 19; x += 3) {
    s.vline(x, 2, h - 8, P.SHRINE_OUTER[3]);
    s.vline(x + 1, 2, h - 8, P.SHRINE_OUTER[1]);
  }
  s.vline(18, 2, h - 8, P.SHRINE_OUTER[0]);
  // Sheared top. The break has to show a solid fractured cross-section — left
  // as bare flute ends it read as a row of teeth rather than snapped stone.
  for (let x = 3; x < 19; x++) {
    const top = 2 + Math.round(Math.sin((x + v * 3) * 0.9) * 1.6 + (v === 1 ? 1 : 0));
    erase(s, x, 0, 1, top);
    s.px(x, top, P.SHRINE_OUTER[4]);
    s.px(x, top + 1, P.SHRINE_OUTER[3]);
    s.px(x, top + 2, P.SHRINE_OUTER[1]);
    s.px(x, top + 3, P.SHRINE_OUTER[0], 0.7);
  }
  for (let i = 0; i < 4; i++) s.px(r.int(4, 17), r.int(4, h - 8), P.WOODS_UNDER[2], 0.5);
  s.outline(P.OUTLINE);
  return s;
}

function standingStone(v: number): Surface {
  const s = new Surface(18, 34);
  const r = rng(7900 + v * 37);
  contact(s, 9, 33, 16, 5, 0.36);
  const lean = v === 1 ? 2 : v === 2 ? -1 : 0;
  s.poly([[5 + lean, 1], [12 + lean, 2], [14, 32], [3, 32]], P.SHRINE_OUTER[2]);
  s.poly([[5 + lean, 1], [8 + lean, 1], [8, 32], [3, 32]], P.SHRINE_OUTER[3]);
  s.poly([[11 + lean, 2], [12 + lean, 2], [14, 32], [11, 32]], P.SHRINE_OUTER[1]);
  s.outline(P.OUTLINE);
  // Astronomical arcs, not runes. A standing stone on the approach that wore a
  // memory glyph taught the player the symbol before the puzzle that uses it,
  // and taught them wrong — that it was scenery.
  armillaryPlate(s, 8, 13, 4 + (v % 2), P.SHRINE_OUTER[4]);
  for (let i = 0; i < 7; i++) s.px(r.int(3, 13), r.int(20, 31), P.WOODS_UNDER[r.pick([1, 2])], 0.55);
  crack(s, 6 + r.int(0, 4), 22, 8, 'v', r, P.OUTLINE, P.SHRINE_OUTER[4], 0.6);
  return s;
}

/** The lintel over the stair down. The last built thing before the dark. */
function extArch(): Surface {
  const s = new Surface(56, 34);
  contact(s, 28, 33, 50, 6, 0.36);
  for (const [jx, lit] of [[0, true], [44, false]] as const) {
    bevel(s, jx, 8, 12, 26, P.SHRINE_OUTER, 2, false);
    s.vline(lit ? jx : jx + 11, 8, 26, P.SHRINE_OUTER[lit ? 4 : 0]);
    for (let y = 12; y < 34; y += 6) s.hline(jx, y, 12, P.OUTLINE, 0.45);
  }
  s.rect(0, 3, 56, 6, P.SHRINE_OUTER[2]);
  s.hline(0, 3, 56, P.SHRINE_OUTER[4]);
  s.hline(0, 8, 56, P.SHRINE_OUTER[0]);
  s.rect(3, 0, 50, 3, P.SHRINE_OUTER[3]);
  s.hline(3, 0, 50, P.SHRINE_OUTER[4]);
  for (let x = 6; x < 52; x += 8) s.vline(x, 0, 3, P.OUTLINE, 0.4);
  armillaryPlate(s, 28, 5, 3, P.SHRINE_OUTER[4]);
  // the dark under the arch
  for (let y = 9; y < 34; y++) {
    s.rect(12, y, 32, 1, P.ECHO_DEEP[0], Math.min(1, 0.35 + (y - 9) * 0.05));
  }
  halo(s, 28, 30, 14, P.ECHO_CYAN[1], 0.16, 2.6);
  return s;
}

function extRubble(v: number): Surface {
  const s = new Surface(22, 14);
  const r = rng(8000 + v * 17);
  contact(s, 11, 13, 20, 4, 0.32);
  for (let i = 0; i < 4 + v; i++) {
    const w = r.int(5, 8), h = r.int(3, 5);
    const x = r.int(0, 22 - w), y = r.int(3, 13 - h);
    const tone = r.pick([1, 2, 3]);
    s.poly([[x, y + 1], [x + w - 2, y], [x + w, y + h - 1], [x + 2, y + h]], P.SHRINE_OUTER[tone]);
    s.line(x, y + 1, x + w - 2, y, P.SHRINE_OUTER[4], 0.7);
    s.line(x + 2, y + h, x + w, y + h - 1, P.OUTLINE, 0.6);
    if (r.chance(0.5)) s.px(x + 2, y + 2, P.WOODS_UNDER[2], 0.6);
  }
  return s;
}

// ── PROP REGISTRATION ──────────────────────────────────────────────────────

function registerShrineProps(b: ArtBuild): void {
  b.add('prop/shrine/door_closed', door('closed'));
  b.add('prop/shrine/door_open', door('open'));
  b.add('prop/shrine/door_locked', door('locked'));
  b.addStrip('prop/shrine/door_barred', doorFrames(),
    { key: 'shrine_door_open', frameRate: 7, repeat: 0 });

  b.add('prop/shrine/gate_closed', gate(1));
  b.add('prop/shrine/gate_open', gate(0));
  b.addStrip('prop/shrine/gate_anim', [gate(1), gate(0.66), gate(0.33), gate(0)],
    { key: 'shrine_gate_open', frameRate: 8, repeat: 0 });

  b.add('prop/shrine/plate_up', plate(false));
  b.add('prop/shrine/plate_down', plate(true));
  b.add('prop/shrine/switch_off', switchProp(false));
  b.add('prop/shrine/switch_on', switchProp(true));
  b.add('prop/shrine/lever_l', lever(false));
  b.add('prop/shrine/lever_r', lever(true));

  for (const mode of ['plain', 'lit', 'leader'] as const) {
    const pre = mode === 'plain' ? 'statue' : mode === 'lit' ? 'statue_lit' : 'statue_leader';
    const east = statue('e', mode);
    b.add(`prop/shrine/${pre}_s`, statue('s', mode));
    b.add(`prop/shrine/${pre}_n`, statue('n', mode));
    b.add(`prop/shrine/${pre}_e`, east);
    b.add(`prop/shrine/${pre}_w`, east.flipX());
  }

  for (let i = 0; i < 3; i++) b.add(`prop/shrine/pillar_${i}`, pillar(i));
  b.addStrip('prop/shrine/brazier', [0, 1, 2, 3].map(brazier),
    { key: 'shrine_brazier', frameRate: 6, repeat: -1 });
  b.addStrip('prop/shrine/crystal', [0, 1, 2, 3].map(crystal),
    { key: 'shrine_crystal', frameRate: 4, repeat: -1 });
  for (let g = 0; g < 4; g++) {
    b.add(`prop/shrine/rune_pillar_${g}`, runePillar(g as Glyph, true));
    b.add(`prop/shrine/rune_pillar_dim_${g}`, runePillar(g as Glyph, false));
  }

  b.add('prop/shrine/block_push', blockPush());
  b.add('prop/shrine/chest_closed', chest(false));
  b.add('prop/shrine/chest_open', chest(true));
  for (let i = 0; i < 3; i++) b.add(`prop/shrine/rubble_${i}`, rubble(i));
  for (let i = 0; i < 3; i++) b.add(`prop/shrine/root_${i}`, root(i));
  for (let i = 0; i < 3; i++) b.add(`prop/shrine/broken_instrument_${i}`, brokenInstrument(i));

  b.addStrip('prop/shrine/moth', [0, 1, 2, 3].map(moth),
    { key: 'shrine_moth', frameRate: 8, repeat: -1 });
  b.add('prop/shrine/moth_jar', mothJar());
  b.addStrip('prop/shrine/echo_pool', [0, 1, 2, 3].map(echoPool),
    { key: 'shrine_echo_pool', frameRate: 5, repeat: -1 });
  b.addStrip('prop/shrine/boss_seal', [0, 1, 2, 3].map(bossSeal),
    { key: 'shrine_boss_seal', frameRate: 3, repeat: -1 });

  for (let i = 0; i < 3; i++) b.add(`prop/shrine_ext/column_broken_${i}`, brokenColumn(i));
  for (let i = 0; i < 3; i++) b.add(`prop/shrine_ext/standing_stone_${i}`, standingStone(i));
  b.add('prop/shrine_ext/arch', extArch());
  for (let i = 0; i < 2; i++) b.add(`prop/shrine_ext/rubble_${i}`, extRubble(i));
}

export function registerShrine(b: ArtBuild): void {
  registerArchitecture(b);
  registerShrineProps(b);
}
