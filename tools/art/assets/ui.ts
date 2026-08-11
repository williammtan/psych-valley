/**
 * UI — PARCHMENT, INK AND BRASS
 *
 * The interface language of Lumen Vale is a field notebook: warm vellum pages
 * held in thin brass hardware, written in violet-black ink. Nothing here is a
 * fantasy scroll border and nothing is a chunky console frame — the game is
 * about noticing things, so the chrome stays quiet and the *content* carries
 * the colour.
 *
 * ── The rules every panel in this file obeys ────────────────────────────────
 *  1. BORDER WEIGHT is always 3 px, in this order from the outside in:
 *       0  P.OUTLINE   the silhouette, never anything else
 *       1  band        brass on chrome, paper-brown on content
 *       2  rule        the inner highlight / shade line
 *     ...then the field.
 *  2. CORNER RADIUS is always a 2 px diagonal chamfer (CUT). Every band and
 *     rule follows the chamfer, so no corner ever looks mitred by accident.
 *  3. HIGHLIGHT RULE: band and rule are lit on the top and left edges and dim
 *     on the bottom and right. Light comes from the upper left, here as
 *     everywhere else in the game.
 *  4. FIELD carries a low-contrast vellum grain — one step either side of the
 *     field tone, never more, so a 400 px panel is paper and not a dot screen.
 *
 * Everything is registered as 9-slice pieces (`_tl _t _tr _l _c _r _bl _b _br`)
 * so the runtime builds a panel at any size from the same nine sprites.
 *
 * This module also emits the two bitmap fonts into public/assets — the fonts
 * are UI — and keeps their specimen sheets alive in art_preview/.
 */
import { Surface, type RGBA } from '../lib/pixel.js';
import { ArtBuild } from '../lib/registry.js';
import * as P from '../lib/palette.js';
import { encodePNG } from '../lib/png.js';
import {
  BODY, DISPLAY, buildFont, writeFont, drawText, drawTextCentered, textWidth,
  buildSpecimen, buildInGameMock, type BuiltFont,
} from '../lib/font.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const ASSETS = join(ROOT, 'public', 'assets');
const PREVIEW = join(ROOT, 'art_preview');

// ───────────────────────────────────────────────────────────────────────────
//  Shared vocabulary
// ───────────────────────────────────────────────────────────────────────────

/** The one corner radius in the whole interface. */
const CUT = 2;
const INK = P.OUTLINE;

function hash2(x: number, y: number, seed: number): number {
  let n = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Surface.px composites, so clearing a pixel needs a direct write. */
function erase(s: Surface, x: number, y: number): void {
  if (!s.inside(x | 0, y | 0)) return;
  s.data[(((y | 0) * s.w) + (x | 0)) * 4 + 3] = 0;
}

/** Zero the alpha inside an ellipse — how rings and cut-outs get made. */
function punch(s: Surface, x: number, y: number, w: number, h: number): void {
  const m = new Surface(s.w, s.h);
  m.ellipse(x, y, w, h, '#ffffff');
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) if (m.alphaAt(i, j)) erase(s, i, j);
  }
}

// ── 9-slice engine ─────────────────────────────────────────────────────────

interface PanelStyle {
  /** Edge length of every one of the nine pieces. */
  size: number;
  bandLit: string;
  bandDim: string;
  ruleLit: string;
  ruleDim: string;
  /** Field ramp; `fi` selects the field tone, fi±1 are the grain flecks. */
  fill: readonly string[];
  fi?: number;
  grain?: number;
  seed?: number;
  cut?: number;
  /** Tabs: no bottom frame, so the tab fuses with the panel beneath it. */
  openBottom?: boolean;
  /** Extra pass over a finished piece, keyed by its slice name. */
  detail?: (s: Surface, name: string) => void;
}

const SLICE = [
  ['tl', 't', 'tr'],
  ['l', 'c', 'r'],
  ['bl', 'b', 'br'],
];

/**
 * Paint one slice. Every band is a level set of a distance field measured from
 * whichever outer edges this slice owns — which is why the chamfer, the edges
 * and the corners all carry the same three-layer border for free.
 */
function panelPiece(st: PanelStyle, dx: number, dy: number): Surface {
  const S = st.size;
  const cut = st.cut ?? CUT;
  const fi = st.fi ?? 3;
  const grain = st.grain ?? 1;
  const seed = st.seed ?? 7;
  const open = st.openBottom === true;
  const s = new Surface(S, S);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d = Infinity;
      let lit = true;
      const consider = (dist: number, isLit: boolean) => {
        if (dist < d) { d = dist; lit = isLit; }
      };
      if (dy === -1) consider(y, true);
      if (dx === -1) consider(x, true);
      if (dy === 1 && !open) consider(S - 1 - y, false);
      if (dx === 1) consider(S - 1 - x, false);
      if (dx === -1 && dy === -1) consider(x + y - cut, true);
      if (dx === 1 && dy === -1) consider((S - 1 - x) + y - cut, true);
      if (!open && dx === -1 && dy === 1) consider(x + (S - 1 - y) - cut, false);
      if (!open && dx === 1 && dy === 1) consider((S - 1 - x) + (S - 1 - y) - cut, false);

      if (d < 0) continue; // chamfered away
      if (d === 0) { s.px(x, y, INK); continue; }
      if (d === 1) { s.px(x, y, lit ? st.bandLit : st.bandDim); continue; }
      if (d === 2) { s.px(x, y, lit ? st.ruleLit : st.ruleDim); continue; }

      // The field repeats every `size` px — that is what 9-slicing is — so the
      // grain has to be quiet enough to read as tooth rather than as a motif.
      const h = hash2(x, y, seed);
      let c = st.fill[fi];
      if (grain > 0) {
        if (h < 0.10 * grain) c = P.mix(st.fill[fi], st.fill[Math.max(0, fi - 1)], 0.34);
        else if (h > 1 - 0.07 * grain) c = P.mix(st.fill[fi], st.fill[Math.min(st.fill.length - 1, fi + 1)], 0.45);
      }
      s.px(x, y, c);
    }
  }
  return s;
}

function nine(b: ArtBuild, base: string, st: PanelStyle): void {
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const name = SLICE[j][i];
      const s = panelPiece(st, i - 1, j - 1);
      st.detail?.(s, name);
      b.add(`${base}_${name}`, s);
    }
  }
}

const PARCHMENT_STYLE: PanelStyle = {
  size: 8,
  bandLit: P.UI_BRASS[3],
  bandDim: P.UI_BRASS[1],
  ruleLit: P.UI_VELLUM[4],
  ruleDim: P.UI_VELLUM[1],
  fill: P.UI_VELLUM,
  fi: 3,
  seed: 101,
};

const DARK_STYLE: PanelStyle = {
  size: 8,
  bandLit: P.UI_BRASS[2],
  bandDim: P.UI_BRASS[0],
  ruleLit: P.UI_PANEL[3],
  ruleDim: P.UI_PANEL[0],
  fill: P.UI_PANEL,
  fi: 2,
  seed: 202,
  grain: 0.8,
};

const ECHO_STYLE: PanelStyle = {
  size: 8,
  bandLit: P.ECHO_CYAN[3],
  bandDim: P.ECHO_CYAN[1],
  ruleLit: P.ECHO_VIOLET[3],
  ruleDim: P.ECHO_VIOLET[0],
  fill: P.ECHO_VIOLET,
  fi: 1,
  seed: 303,
  grain: 0.9,
};

// ───────────────────────────────────────────────────────────────────────────
//  1. Panels
// ───────────────────────────────────────────────────────────────────────────

function registerPanels(b: ArtBuild): void {
  nine(b, 'ui/panel', PARCHMENT_STYLE);
  nine(b, 'ui/panelDark', DARK_STYLE);
  nine(b, 'ui/panelEcho', {
    ...ECHO_STYLE,
    detail: (s, name) => {
      // A mote in the corners: Echo panels are never quite still.
      if (name === 'tl') s.pxOver(4, 4, P.ECHO_RUNE, 0.7);
      if (name === 'br') s.pxOver(3, 3, P.ECHO_RUNE, 0.5);
    },
  });

  // Dialogue: the same hardware, a quieter grain, and a dog-eared bottom-right
  // corner so the box reads as a sheet of paper someone has been handling.
  nine(b, 'ui/dialogue', {
    ...PARCHMENT_STYLE,
    seed: 404,
    grain: 0.6,
    detail: (s, name) => {
      if (name !== 'br') return;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) if (x + y >= 9) s.px(x, y, P.UI_VELLUM[2]);
      }
      for (let k = 0; k <= 5; k++) {
        s.px(7 - k, 2 + k, INK);
        if (k < 5) s.px(7 - k, 3 + k, P.UI_VELLUM[4]);
      }
      // Keep the silhouette square where the fold meets the outer border.
      for (let k = 2; k < 8; k++) { s.px(7, k, INK); s.px(k, 7, INK); }
    },
  });

  // Speaker plate: small, dark, brass-edged, sits half over the dialogue box.
  nine(b, 'ui/name_tag', { ...DARK_STYLE, size: 6, seed: 505, grain: 0.6 });

  // Journal tabs. The active one is a lit page with no bottom edge so it fuses
  // with the panel below; the inactive one is a closed, dimmer page.
  nine(b, 'ui/tab_active', { ...PARCHMENT_STYLE, size: 6, seed: 606, openBottom: true });
  nine(b, 'ui/tab_inactive', {
    size: 6,
    bandLit: P.UI_BRASS[1],
    bandDim: P.UI_BRASS[0],
    ruleLit: P.UI_VELLUM[2],
    ruleDim: P.UI_VELLUM[0],
    fill: P.UI_VELLUM,
    fi: 2,
    seed: 707,
    grain: 0.7,
  });

  // Content elements wear no brass — one step quieter than the chrome they
  // sit inside, so a card on a panel never fights its own frame.
  nine(b, 'ui/clue_card', {
    size: 6,
    bandLit: P.UI_VELLUM[4],
    bandDim: P.UI_VELLUM[1],
    ruleLit: P.UI_VELLUM[3],
    ruleDim: P.UI_VELLUM[2],
    fill: P.UI_VELLUM,
    fi: 4,
    seed: 808,
    grain: 0.6,
    detail: (s, name) => {
      if (name === 't') for (let x = 0; x < 6; x++) s.px(x, 5, P.UI_VELLUM[1], 0.65);
      if (name === 'tl') s.px(5, 5, P.UI_VELLUM[1], 0.65);
      if (name === 'tr') s.px(0, 5, P.UI_VELLUM[1], 0.65);
    },
  });

  nine(b, 'ui/vote_bubble', {
    size: 6,
    bandLit: P.UI_PARCHMENT[4],
    bandDim: P.UI_PARCHMENT[1],
    ruleLit: P.UI_PARCHMENT[3],
    ruleDim: P.UI_PARCHMENT[2],
    fill: P.UI_PARCHMENT,
    fi: 4,
    seed: 909,
    grain: 0.5,
  });

  // Keycaps are hardware, not paper: cool grey, hard top light, dark underside.
  nine(b, 'ui/key_prompt', {
    size: 5,
    cut: 1,
    bandLit: P.UI_KEY[4],
    bandDim: P.UI_KEY[1],
    ruleLit: P.UI_KEY[3],
    ruleDim: P.UI_KEY[0],
    fill: P.UI_KEY,
    fi: 3,
    seed: 1010,
    grain: 0.35,
  });

  // Minimap: brass ring, dark interior with a faint survey grid and rivets.
  nine(b, 'ui/minimap_frame', {
    size: 6,
    bandLit: P.UI_BRASS[3],
    bandDim: P.UI_BRASS[1],
    ruleLit: P.UI_PANEL[3],
    ruleDim: P.UI_PANEL[0],
    fill: P.UI_PANEL,
    fi: 1,
    seed: 1111,
    grain: 0.4,
    detail: (s, name) => {
      if (name === 'c') {
        for (let k = 0; k < 6; k++) { s.px(k, 2, P.UI_PANEL[2], 0.55); s.px(2, k, P.UI_PANEL[2], 0.55); }
      }
      if (name === 'tl') s.pxOver(2, 2, P.UI_BRASS[4]);
      if (name === 'tr') s.pxOver(3, 2, P.UI_BRASS[4]);
      if (name === 'bl') s.pxOver(2, 3, P.UI_BRASS[2]);
      if (name === 'br') s.pxOver(3, 3, P.UI_BRASS[2]);
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  2. Dialogue furniture
// ───────────────────────────────────────────────────────────────────────────

function registerDialogue(b: ArtBuild): void {
  // The tail hangs off the bottom edge of the box and narrows to a point.
  const tail = (flip: boolean) => {
    const s = new Surface(12, 9);
    const widths = [10, 9, 7, 5, 4, 3, 2];
    widths.forEach((w, y) => {
      for (let x = 0; x < w; x++) s.px(1 + x, y, P.UI_VELLUM[3]);
    });
    s.innerShade(P.UI_VELLUM[1], 1, [[1, 0], [0, 1]]);
    s.innerShade(P.UI_VELLUM[4], 1, [[-1, 0]]);
    s.outline(INK, true);
    return flip ? s.flipX() : s;
  };
  b.add('ui/dialogue_tail_l', tail(false));
  b.add('ui/dialogue_tail_r', tail(true));

  // "Press to continue" chevron: bobs a pixel and breathes in brightness.
  const bob = [0, 1, 2, 1];
  const tone = [P.UI_BRASS[4], P.UI_BRASS[3], P.UI_BRASS[2], P.UI_BRASS[3]];
  const arrows: Surface[] = [];
  for (let f = 0; f < 4; f++) {
    const s = new Surface(9, 10);
    const y0 = 1 + bob[f];
    for (let k = 0; k < 4; k++) {
      s.px(1 + k, y0 + k, tone[f]);
      s.px(7 - k, y0 + k, tone[f]);
      s.px(1 + k, y0 + k + 1, P.UI_BRASS[1]);
      s.px(7 - k, y0 + k + 1, P.UI_BRASS[1]);
    }
    s.outline(INK, true);
    arrows.push(s);
  }
  b.addStrip('ui/advance_arrow', arrows, { key: 'ui_advance', frameRate: 6, repeat: -1 });
}

// ───────────────────────────────────────────────────────────────────────────
//  3. Hearts
//
//  Not a Zelda heart: square shoulders, a deep centre notch and a short blunt
//  point, so it reads as a folded paper charm someone made rather than as a
//  symbol lifted off a valentine.
// ───────────────────────────────────────────────────────────────────────────

const HEART_SHAPE = [
  '.##...##.',
  '#########',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
];

function heartMask(): Surface {
  const s = new Surface(11, 11);
  HEART_SHAPE.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') s.px(x + 1, y + 1, '#ffffff');
  });
  return s;
}

function heartFull(): Surface {
  const mask = heartMask();
  const s = new Surface(11, 11);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (mask.alphaAt(x, y)) s.px(x, y, P.UI_HEART[2]);
  s.innerShade(P.UI_HEART[3], 1, [[0, -1], [-1, 0]]);
  s.innerShade(P.UI_HEART[0], 1, [[0, 1], [1, 0]]);
  // The only place the brightest step lands.
  s.pxOver(2, 2, P.UI_HEART[4]);
  s.pxOver(3, 2, P.UI_HEART[4]);
  s.pxOver(2, 3, P.UI_HEART[4]);
  s.outline(INK, true);
  return s;
}

function heartEmpty(): Surface {
  const mask = heartMask();
  const s = new Surface(11, 11);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    if (!mask.alphaAt(x, y)) continue;
    s.px(x, y, (x + y) % 2 === 0 ? P.UI_PANEL[2] : P.UI_PANEL[1]);
  }
  s.innerShade(P.UI_PANEL[3], 1, [[0, -1], [-1, 0]]);
  s.innerShade(P.UI_PANEL[0], 1, [[0, 1], [1, 0]]);
  s.outline(INK, true);
  return s;
}

function heartHalf(full: Surface, empty: Surface): Surface {
  const s = new Surface(11, 11);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    const c = x <= 5 ? full.get(x, y) : empty.get(x, y);
    if (c[3]) s.px(x, y, c);
  }
  for (let y = 1; y < 10; y++) s.pxOver(6, y, P.UI_HEART[0], 0.5);
  return s;
}

function registerHearts(b: ArtBuild): void {
  const full = heartFull();
  const empty = heartEmpty();
  b.add('ui/heart_full', full);
  b.add('ui/heart_half', heartHalf(full, empty));
  b.add('ui/heart_empty', empty);

  const centred = (src: Surface) => {
    const s = new Surface(15, 15);
    s.blit(src, 2, 2);
    return s;
  };
  const ring = (s: Surface, r: number, n: number, phase: number, c: string, a = 1) => {
    for (let i = 0; i < n; i++) {
      const t = phase + (i / n) * Math.PI * 2;
      s.px(Math.round(7 + Math.cos(t) * r), Math.round(7 + Math.sin(t) * r), c, a);
    }
  };

  // Gain: a bright core blooms into the finished heart, sparks fly outward.
  const gain: Surface[] = [];
  for (let f = 0; f < 5; f++) {
    const s = new Surface(15, 15);
    if (f === 0) {
      s.ellipse(5, 5, 5, 5, P.UI_HEART[4]);
      s.ellipse(6, 6, 3, 3, P.FONT_LIGHT);
      ring(s, 4, 8, 0, P.UI_HEART[4], 0.9);
    } else {
      s.blit(centred(full));
      if (f === 1) { s.tint(P.FONT_LIGHT, 0.5); ring(s, 6, 8, 0.2, P.UI_HEART[4]); }
      else if (f === 2) ring(s, 6, 6, 0.5, P.UI_HEART[4], 0.85);
      else if (f === 3) ring(s, 7, 4, 0.9, P.UI_HEART[3], 0.5);
    }
    gain.push(s);
  }
  b.addStrip('ui/heart_gain', gain, { key: 'ui_heart_gain', frameRate: 14, repeat: 0 });

  // Loss: flash, crack, drain from the top down, shards, empty socket.
  const lose: Surface[] = [];
  const fu = centred(full), em = centred(empty);
  for (let f = 0; f < 5; f++) {
    const s = new Surface(15, 15);
    if (f === 0) { s.blit(fu); s.tint(P.FONT_LIGHT, 0.72); }
    else if (f === 4) s.blit(em);
    else {
      const line = 2 + f * 3;
      for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
        const c = y < line ? em.get(x, y) : fu.get(x, y);
        if (c[3]) s.px(x, y, c);
      }
      for (let k = 0; k < 6; k++) s.pxOver(7 + (k % 2), 3 + k, INK);
      if (f === 3) { s.px(2, 12, P.UI_HEART[2]); s.px(12, 11, P.UI_HEART[2]); s.px(9, 14, P.UI_HEART[1]); }
    }
    lose.push(s);
  }
  b.addStrip('ui/heart_lose', lose, { key: 'ui_heart_lose', frameRate: 14, repeat: 0 });
}

// ───────────────────────────────────────────────────────────────────────────
//  4. Icons — 16x16, silhouette first, three ramp steps, no interior fuss.
//     They must be told apart with the colour switched off, so no two share a
//     shape: lens, rings, beaded thread, hand, book, folded map, scroll, two
//     heads, star, bell, box, lantern, paw.
// ───────────────────────────────────────────────────────────────────────────

function icon(draw: (s: Surface) => void): Surface {
  const s = new Surface(16, 16);
  draw(s);
  return s;
}

/** Disabled state: drifts toward the panel shadow and loses value. */
function dimmed(src: Surface): Surface {
  return src.clone().tint(P.UI_PANEL[1], 0.55).brightness(0.88);
}

const ICONS: Record<string, (s: Surface) => void> = {
  // OBSERVE — a lens with three attention rays. The only icon with rays.
  observe: (s) => {
    s.poly([[1, 8], [5, 4], [11, 4], [15, 8], [11, 12], [5, 12]], P.UI_PARCHMENT[4]);
    s.innerShade(P.UI_PARCHMENT[2], 1, [[0, 1], [1, 0]]);
    s.ellipse(5, 5, 6, 6, P.ECHO_CYAN[2]);
    s.ellipse(6, 6, 4, 4, P.ECHO_CYAN[0]);
    s.px(6, 6, P.ECHO_CYAN[4]);
    s.outline(INK, true);
    for (const [x, dx] of [[3, -1], [8, 0], [13, 1]] as const) {
      for (let k = 0; k < 3; k++) {
        s.px(x + dx * (2 - k), k, P.UI_BRASS[4]);
        s.px(x + dx * (2 - k) + 1, k, INK, 0.5);
      }
    }
  },

  // LINK — two rings caught in each other. Association, made of hardware.
  link: (s) => {
    const ring = (x: number, y: number, lit: string, dim: string) => {
      const r = new Surface(16, 16);
      r.ellipse(x, y, 10, 10, lit);
      r.innerShade(dim, 1, [[0, 1], [1, 0]]);
      punch(r, x + 2, y + 2, 6, 6);
      r.outline(INK, true);
      return r;
    };
    const back = ring(6, 5, P.UI_BRASS[2], P.UI_BRASS[0]);
    s.blit(back);
    s.blit(ring(0, 2, P.UI_BRASS[3], P.UI_BRASS[1]));
    // The right ring passes in front on its lower arc, so they interlock.
    for (let y = 10; y < 16; y++) for (let x = 6; x < 16; x++) {
      const c = back.get(x, y);
      if (c[3]) s.px(x, y, c);
    }
  },

  // RECALL — three beads on a thread, straight off the Memory Thread board.
  recall: (s) => {
    const pt = (t: number): [number, number] => [
      Math.round(2 + t * 12),
      Math.round(12 - t * 9 + Math.sin(t * Math.PI) * 2.4),
    ];
    for (let i = 0; i <= 48; i++) {
      const [x, y] = pt(i / 48);
      s.px(x, y + 1, P.UI_VELLUM[0]);
      s.px(x, y, P.UI_VELLUM[3]);
    }
    for (const t of [0.08, 0.5, 0.92]) {
      const [x, y] = pt(t);
      s.ellipse(x - 2, y - 2, 5, 5, P.UI_BRASS[2]);
      s.px(x - 1, y - 1, P.UI_BRASS[4]);
      s.px(x + 1, y + 1, P.UI_BRASS[0]);
    }
    s.outline(INK, true);
  },

  // DISSENT — one raised hand. Nia's blue on the cuff, because she goes first.
  dissent: (s) => {
    const sk = P.SKIN.warm;
    s.rect(5, 2, 2, 8, sk[2]);
    s.rect(8, 1, 2, 9, sk[2]);
    s.rect(11, 2, 2, 8, sk[2]);
    s.rect(4, 7, 10, 4, sk[2]);
    s.rect(2, 6, 3, 3, sk[2]);
    s.innerShade(sk[1], 1, [[1, 0], [0, 1]]);
    s.vline(5, 2, 6, sk[4]);
    s.vline(8, 1, 6, sk[4]);
    s.rect(4, 11, 10, 3, P.CLOTH.nia[2]);
    s.hline(4, 11, 10, P.CLOTH.nia[4]);
    s.hline(4, 13, 10, P.CLOTH.nia[0]);
    s.outline(INK, true);
  },

  // JOURNAL — a shut book with a ribbon out the bottom.
  journal: (s) => {
    s.rect(3, 1, 10, 12, P.ROOF_PLUM[2]);
    s.rect(3, 1, 2, 12, P.ROOF_PLUM[1]);
    s.rect(12, 2, 2, 10, P.UI_VELLUM[4]);
    s.hline(12, 5, 2, P.UI_VELLUM[2]);
    s.hline(12, 9, 2, P.UI_VELLUM[2]);
    s.innerShade(P.ROOF_PLUM[0], 1, [[0, 1]]);
    s.hline(3, 1, 10, P.ROOF_PLUM[4]);
    s.hline(6, 4, 5, P.UI_BRASS[3]);
    s.hline(6, 9, 5, P.UI_BRASS[2]);
    s.rect(8, 13, 2, 2, P.UI_HEART[2]);
    s.px(8, 14, P.UI_HEART[1]);
    s.outline(INK, true);
  },

  // MAP — three folded panels, so the silhouette steps up and down.
  map: (s) => {
    const cols: Array<[number, number, number]> = [[1, 2, 5], [6, 3, 5], [11, 2, 4]];
    for (const [x, y, w] of cols) {
      s.rect(x, y, w, 11, P.UI_VELLUM[3]);
      s.vline(x, y, 11, P.UI_VELLUM[4]);
      s.vline(x + w - 1, y, 11, P.UI_VELLUM[1]);
    }
    for (let x = 2; x < 12; x += 2) s.pxOver(x, 9 - Math.round(Math.sin(x * 0.6) * 2), P.UI_HEART[1]);
    for (const [x, y] of [[12, 5], [13, 6], [13, 5], [12, 6]] as const) s.pxOver(x, y, P.UI_HEART[2]);
    s.outline(INK, true);
  },

  // QUEST — a scroll, rolled top and bottom.
  quest: (s) => {
    s.rect(4, 3, 8, 10, P.UI_VELLUM[4]);
    s.vline(4, 3, 10, P.UI_VELLUM[2]);
    s.rect(2, 1, 12, 3, P.UI_VELLUM[2]);
    s.rect(2, 12, 12, 3, P.UI_VELLUM[2]);
    s.hline(2, 1, 12, P.UI_VELLUM[4]);
    s.hline(2, 12, 12, P.UI_VELLUM[4]);
    s.hline(2, 3, 12, P.UI_VELLUM[0]);
    s.hline(2, 14, 12, P.UI_VELLUM[0]);
    s.hline(6, 6, 5, P.UI_INK_SOFT);
    s.hline(6, 8, 4, P.UI_INK_SOFT);
    s.hline(6, 10, 5, P.UI_INK_SOFT);
    s.outline(INK, true);
  },

  // PEOPLE — two heads and shoulders, one behind the other.
  people: (s) => {
    const bust = (x: number, y: number, ramp: readonly string[]) => {
      const t = new Surface(16, 16);
      t.ellipse(x + 1, y, 5, 5, ramp[2]);
      t.poly([[x - 1, y + 11], [x, y + 5], [x + 6, y + 5], [x + 7, y + 11]], ramp[1]);
      t.pxOver(x + 2, y + 1, ramp[4]);
      t.outline(INK, true);
      return t;
    };
    s.blit(bust(8, 2, P.CLOTH.neutral));
    s.blit(bust(2, 4, P.CLOTH.sera));
  },

  // INSIGHT — a four-point spark with a small companion.
  insight: (s) => {
    s.poly([[7, 1], [9, 7], [15, 9], [9, 11], [7, 15], [5, 11], [0, 9], [5, 7]], P.UI_GOLD[3]);
    s.innerShade(P.UI_GOLD[1], 1, [[0, 1], [1, 0]]);
    s.pxOver(6, 8, P.UI_GOLD[4]);
    s.pxOver(7, 8, P.UI_GOLD[4]);
    s.pxOver(6, 7, P.UI_GOLD[4]);
    s.poly([[13, 0], [14, 3], [15, 4], [14, 5], [13, 3]], P.UI_GOLD[4]);
    s.outline(INK, true);
  },

  // BELL — quest one lives or dies on this reading clearly at 16px.
  bell: (s) => {
    s.rect(7, 0, 2, 2, P.UI_BRASS[2]);
    s.ellipse(3, 2, 10, 10, P.UI_BRASS[2]);
    s.rect(3, 6, 10, 4, P.UI_BRASS[2]);
    s.rect(1, 10, 14, 2, P.UI_BRASS[2]);
    s.innerShade(P.UI_BRASS[0], 1, [[0, 1], [1, 0]]);
    s.vline(5, 4, 6, P.UI_BRASS[4]);
    s.px(4, 5, P.UI_BRASS[4]);
    s.hline(1, 10, 12, P.UI_BRASS[3]);
    s.ellipse(6, 12, 4, 3, P.UI_BRASS[1]);
    s.outline(INK, true);
  },

  // PACKAGE — Oren's parcel. Kraft paper, twine cross, a lopsided bow.
  package: (s) => {
    s.rect(2, 3, 12, 11, P.SAND[2]);
    s.hline(2, 3, 12, P.SAND[4]);
    s.innerShade(P.SAND[0], 1, [[0, 1], [1, 0]]);
    s.vline(7, 3, 11, P.WOOD[1]);
    s.hline(2, 8, 12, P.WOOD[1]);
    s.vline(8, 3, 11, P.WOOD[3], 0.45);
    for (const [x, y] of [[6, 1], [5, 2], [6, 2], [9, 1], [10, 2], [9, 2]] as const) s.px(x, y, P.WOOD[2]);
    s.px(7, 2, P.WOOD[3]);
    s.px(8, 2, P.WOOD[3]);
    s.outline(INK, true);
  },

  // LANTERN — the festival, and every safe place in the game.
  lantern: (s) => {
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI + (i / 20) * Math.PI;
      s.px(Math.round(8 + Math.cos(a) * 3.5), Math.round(4 + Math.sin(a) * 3.5), P.UI_BRASS[1]);
    }
    s.rect(3, 3, 10, 2, P.UI_BRASS[2]);
    s.rect(4, 5, 8, 8, P.WINDOW_AMBER[3]);
    s.rect(2, 12, 12, 3, P.UI_BRASS[2]);
    s.ellipse(6, 7, 4, 5, P.FIRE[3]);
    s.ellipse(7, 8, 2, 3, P.FIRE[4]);
    s.vline(4, 5, 8, P.UI_BRASS[3]);
    s.vline(11, 5, 8, P.UI_BRASS[1]);
    s.hline(3, 3, 10, P.UI_BRASS[4]);
    s.hline(2, 12, 12, P.UI_BRASS[3]);
    s.hline(2, 14, 12, P.UI_BRASS[0]);
    s.outline(INK, true);
  },

  // PAW — Pip. One pad, four toes, nothing else.
  paw: (s) => {
    const fur = P.SAND;
    s.ellipse(3, 7, 10, 8, fur[2]);
    s.ellipse(1, 3, 4, 5, fur[2]);
    s.ellipse(5, 1, 4, 5, fur[2]);
    s.ellipse(9, 1, 4, 5, fur[2]);
    s.ellipse(12, 3, 4, 5, fur[2]);
    s.innerShade(fur[0], 1, [[0, 1], [1, 0]]);
    s.innerShade(fur[4], 1, [[0, -1], [-1, 0]]);
    s.outline(INK, true);
  },
};

function registerIcons(b: ArtBuild): void {
  for (const [name, draw] of Object.entries(ICONS)) {
    const lit = icon(draw);
    b.add(`ui/icon_${name}`, lit);
    b.add(`ui/icon_${name}_dim`, dimmed(lit));
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  5. Journal furniture
// ───────────────────────────────────────────────────────────────────────────

function registerJournal(b: ArtBuild): void {
  // Divider: a brass rule with a centred lozenge, tapering to nothing.
  const div = new Surface(32, 5);
  for (let x = 3; x < 29; x++) {
    const edge = Math.min(x - 3, 28 - x);
    const a = Math.min(1, 0.25 + edge * 0.25);
    div.px(x, 2, P.UI_BRASS[2], a);
    div.px(x, 1, P.UI_BRASS[4], a * 0.5);
    div.px(x, 3, P.UI_BRASS[0], a * 0.45);
  }
  for (let k = 0; k < 3; k++) {
    for (let i = -k; i <= k; i++) {
      div.px(16 + i, k, P.UI_BRASS[3]);
      div.px(16 + i, 4 - k, P.UI_BRASS[1]);
    }
  }
  div.px(16, 2, P.UI_BRASS[4]);
  b.add('ui/divider', div);

  // Bookmarks: four ribbons, one per journal tab.
  const ribbons: Array<readonly string[]> = [P.UI_BRASS, P.UI_HEART, P.ECHO_VIOLET, P.ROOF_TEAL];
  ribbons.forEach((ramp, i) => {
    const s = new Surface(7, 14);
    s.rect(1, 0, 4, 11, ramp[2]);
    s.vline(1, 0, 11, ramp[3]);
    s.vline(4, 0, 11, ramp[1]);
    s.px(1, 11, ramp[2]); s.px(2, 11, ramp[1]);
    s.px(4, 11, ramp[2]); s.px(3, 11, ramp[1]);
    s.px(1, 12, ramp[1]); s.px(4, 12, ramp[1]);
    s.hline(1, 0, 4, ramp[4]);
    s.outline(INK);
    return b.add(`ui/bookmark_${i}`, s);
  });

  // Scroll affordances: a vellum disc with a brass chevron.
  const scroller = (up: boolean) => {
    const s = new Surface(11, 11);
    s.ellipse(1, 1, 9, 9, P.UI_VELLUM[3]);
    s.innerShade(P.UI_VELLUM[1], 1, [[0, 1], [1, 0]]);
    s.innerShade(P.UI_VELLUM[4], 1, [[0, -1], [-1, 0]]);
    for (let k = 0; k < 3; k++) {
      const y = up ? 6 - k : 4 + k;
      s.pxOver(5 - k, y, INK);
      s.pxOver(5 + k, y, INK);
      s.pxOver(5 - k, y + (up ? -1 : 1), P.UI_VELLUM[4], 0.8);
      s.pxOver(5 + k, y + (up ? -1 : 1), P.UI_VELLUM[4], 0.8);
    }
    s.outline(INK, true);
    return s;
  };
  b.add('ui/scroll_up', scroller(true));
  b.add('ui/scroll_down', scroller(false));

  // Checkboxes: an ink square on vellum; ticked ones take a brass check.
  const box = (on: boolean) => {
    const s = new Surface(11, 11);
    s.rect(1, 1, 9, 9, P.UI_VELLUM[3]);
    for (const [x, y] of [[1, 1], [9, 1], [1, 9], [9, 9]] as const) erase(s, x, y);
    s.innerShade(P.UI_VELLUM[1], 1, [[0, -1], [-1, 0]]);
    s.innerShade(P.UI_VELLUM[4], 1, [[0, 1], [1, 0]]);
    s.outline(INK, true);
    if (on) {
      for (const [x, y] of [[3, 5], [4, 6], [5, 7], [6, 5], [7, 4], [8, 3]] as const) {
        s.pxOver(x, y, P.UI_BRASS[3]);
        s.pxOver(x, y + 1, P.UI_BRASS[0]);
      }
    }
    return s;
  };
  b.add('ui/checkbox_on', box(true));
  b.add('ui/checkbox_off', box(false));

  // Bullet: a brass lozenge, the smallest piece of hardware in the game.
  const bullet = new Surface(7, 7);
  for (let k = 0; k < 3; k++) for (let i = -k; i <= k; i++) {
    bullet.px(3 + i, 1 + k, P.UI_BRASS[3]);
    bullet.px(3 + i, 5 - k, P.UI_BRASS[1]);
  }
  bullet.px(2, 2, P.UI_BRASS[4]);
  bullet.outline(INK);
  b.add('ui/bullet', bullet);

  // Page corner: the bottom-right of a page, turned up.
  const corner = new Surface(11, 11);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (x + y >= 10) corner.px(x, y, P.UI_VELLUM[2]);
  for (let k = 0; k <= 10; k++) {
    corner.px(10 - k, k, INK);
    if (k > 0) corner.pxOver(10 - k, k + 1, P.UI_VELLUM[4]);
  }
  corner.innerShade(P.UI_VELLUM[0], 1, [[0, 1], [1, 0]]);
  b.add('ui/page_corner', corner);
}

// ───────────────────────────────────────────────────────────────────────────
//  6. Insight card — the reward moment, and the only place in this interface
//     allowed to be ornate.
// ───────────────────────────────────────────────────────────────────────────

function registerInsight(b: ArtBuild): void {
  nine(b, 'ui/insight_frame', {
    size: 12,
    bandLit: P.UI_GOLD[4],
    bandDim: P.UI_GOLD[1],
    ruleLit: P.UI_GOLD[2],
    ruleDim: P.UI_GOLD[0],
    fill: P.UI_VELLUM,
    fi: 3,
    seed: 1212,
    grain: 0.7,
    detail: (s, name) => {
      // Corner flourishes: a brass curl with a lit bead at its eye.
      const curl = (fx: number, fy: number) => {
        const at = (x: number, y: number, c: string) =>
          s.pxOver(fx ? 11 - x : x, fy ? 11 - y : y, c);
        for (let k = 0; k < 5; k++) { at(3 + k, 3, P.UI_GOLD[2]); at(3, 3 + k, P.UI_GOLD[2]); }
        at(4, 4, P.UI_GOLD[4]);
        at(5, 5, P.UI_GOLD[3]);
        at(6, 6, P.UI_GOLD[1]);
        at(7, 4, P.UI_GOLD[1]);
        at(4, 7, P.UI_GOLD[1]);
      };
      if (name === 'tl') curl(0, 0);
      if (name === 'tr') curl(1, 0);
      if (name === 'bl') curl(0, 1);
      if (name === 'br') curl(1, 1);
      if (name === 't' || name === 'b') {
        const y = name === 't' ? 3 : 8;
        for (let x = 0; x < 12; x += 3) { s.pxOver(x, y, P.UI_GOLD[3]); s.pxOver(x + 1, y, P.UI_GOLD[1]); }
      }
      // Rays behind the heading, fanning down off the top rail. The period
      // divides 12, so the edge still tiles seamlessly at any panel width.
      if (name === 't') {
        for (let x = 0; x < 12; x++) for (let y = 5; y < 12; y++) {
          const d = Math.abs(((x + y * 2) % 12) - 6);
          if (d < 1) s.pxOver(x, y, P.UI_GOLD[2], 0.34 - (y - 5) * 0.03);
          else if (d < 2) s.pxOver(x, y, P.UI_GOLD[2], 0.14);
        }
      }
    },
  });

  // The seal: poured wax, pressed with the Vale's spiral.
  const seal = new Surface(17, 17);
  seal.ellipse(1, 1, 15, 15, P.ROOF_RED[2]);
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    seal.ellipse(Math.round(8 + Math.cos(t) * 6) - 1, Math.round(8 + Math.sin(t) * 6) - 1, 4, 4, P.ROOF_RED[2]);
  }
  seal.innerShade(P.ROOF_RED[0], 1, [[0, 1], [1, 0]]);
  seal.innerShade(P.ROOF_RED[4], 1, [[0, -1], [-1, 0]]);
  for (let i = 0; i <= 34; i++) {
    const t = i / 34;
    const a = t * Math.PI * 3.2;
    const r = 1 + t * 4;
    const x = Math.round(8 + Math.cos(a) * r);
    const y = Math.round(8 + Math.sin(a) * r);
    seal.pxOver(x, y, P.ROOF_RED[0]);
    seal.pxOver(x, y - 1, P.ROOF_RED[4], 0.55);
  }
  seal.outline(INK, true);
  b.add('ui/insight_seal', seal);

  // Rays behind the seal: eight tapered wedges plus a soft core, turning
  // slowly. Wedges rather than hairlines — a 1 px ray at 1x is just noise.
  const rays: Surface[] = [];
  for (let f = 0; f < 4; f++) {
    const s = new Surface(37, 37);
    const cx = 18, cy = 18;
    s.ellipse(cx - 9, cy - 9, 19, 19, P.UI_GOLD[4], 0.1);
    s.ellipse(cx - 6, cy - 6, 13, 13, P.UI_GOLD[4], 0.12);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (f / 4) * (Math.PI / 4);
      const long = i % 2 === 0;
      const len = long ? 18 : 13;
      for (let r = 6; r < len; r++) {
        const t = (r - 6) / (len - 6);
        const half = Math.max(0, 1.6 * (1 - t));
        for (let o = -half; o <= half; o += 0.5) {
          s.px(
            Math.round(cx + Math.cos(a) * r - Math.sin(a) * o),
            Math.round(cy + Math.sin(a) * r + Math.cos(a) * o),
            long ? P.UI_GOLD[4] : P.UI_GOLD[3],
            0.16 + (1 - t) * 0.5,
          );
        }
      }
    }
    rays.push(s);
  }
  b.addStrip('ui/insight_ray', rays, { key: 'ui_insight_ray', frameRate: 6, repeat: -1 });
}

// ───────────────────────────────────────────────────────────────────────────
//  7. Memory Threads (quest two)
// ───────────────────────────────────────────────────────────────────────────

function registerThreads(b: ArtBuild): void {
  const node = (kind: 'empty' | 'filled' | 'wrong') => {
    const s = new Surface(15, 15);
    const rim = kind === 'empty' ? P.UI_VELLUM : kind === 'filled' ? P.UI_BRASS : P.UI_HEART;
    s.ellipse(1, 1, 13, 13, rim[2]);
    s.innerShade(rim[0], 1, [[0, 1], [1, 0]]);
    s.innerShade(rim[4], 1, [[0, -1], [-1, 0]]);
    punch(s, 4, 4, 7, 7);
    s.outline(INK, true);
    if (kind === 'empty') {
      for (let i = 0; i < 12; i += 2) {
        const t = (i / 12) * Math.PI * 2;
        s.px(Math.round(7 + Math.cos(t) * 3), Math.round(7 + Math.sin(t) * 3), P.UI_VELLUM[1], 0.8);
      }
    } else if (kind === 'filled') {
      s.ellipse(5, 5, 5, 5, P.ECHO_CYAN[2]);
      s.px(6, 6, P.ECHO_CYAN[4]);
      s.px(8, 8, P.ECHO_CYAN[0]);
    } else {
      for (let k = 0; k < 4; k++) {
        s.px(5 + k, 5 + k, P.UI_HEART[4]);
        s.px(8 - k, 5 + k, P.UI_HEART[4]);
      }
    }
    return s;
  };
  b.add('ui/thread_node_empty', node('empty'));
  b.add('ui/thread_node_filled', node('filled'));
  b.add('ui/thread_node_wrong', node('wrong'));

  // Connector: a dashed run with a pulse travelling along it, into an arrow.
  const conn: Surface[] = [];
  for (let f = 0; f < 3; f++) {
    const s = new Surface(14, 7);
    for (let x = 0; x < 10; x++) {
      if (x % 3 === 2) continue;
      s.px(x, 3, P.UI_VELLUM[1]);
      s.px(x, 4, P.UI_VELLUM[0], 0.45);
    }
    for (let k = 0; k < 3; k++) {
      const x = (f * 4 + k) % 12;
      if (x > 9) continue;
      s.px(x, 3, P.ECHO_CYAN[3]);
      s.px(x, 2, P.ECHO_CYAN[4], 0.4);
    }
    for (let k = 0; k < 3; k++) {
      s.px(10 + k, 3, P.UI_VELLUM[1]);
      s.px(12 - k, 2 - k + 1, P.UI_VELLUM[1]);
      s.px(12 - k, 4 + k - 1, P.UI_VELLUM[1]);
    }
    conn.push(s);
  }
  b.addStrip('ui/thread_connector', conn, { key: 'ui_thread_flow', frameRate: 8, repeat: -1 });

  // Brass push-pin holding a clue card down.
  const pin = new Surface(9, 13);
  pin.ellipse(1, 1, 7, 7, P.UI_BRASS[2]);
  pin.innerShade(P.UI_BRASS[0], 1, [[0, 1], [1, 0]]);
  pin.px(3, 3, P.UI_BRASS[4]);
  pin.px(2, 3, P.UI_BRASS[4]);
  pin.vline(4, 8, 4, P.UI_KEY[3]);
  pin.px(4, 11, P.UI_KEY[1]);
  pin.outline(INK, true);
  pin.ellipse(2, 11, 6, 2, INK, 0.26);
  b.add('ui/clue_pin', pin);

  // Timeline track. Drawn edge by edge rather than outlined, so the middle
  // piece tiles without a seam down every join.
  const bar = (kind: 'l' | 'm' | 'r') => {
    const W = 8;
    const s = new Surface(W, 9);
    const x0 = kind === 'l' ? 1 : 0;
    const x1 = kind === 'r' ? W - 2 : W - 1;
    for (let x = x0; x <= x1; x++) {
      s.px(x, 0, INK);
      s.px(x, 8, INK);
      s.px(x, 1, P.UI_VELLUM[0]);
      s.px(x, 2, P.UI_PANEL[2]);
      s.px(x, 3, P.UI_PANEL[1]);
      s.px(x, 4, P.UI_PANEL[1]);
      s.px(x, 5, P.UI_PANEL[2]);
      s.px(x, 6, P.UI_VELLUM[1]);
      s.px(x, 7, P.UI_VELLUM[3]);
    }
    if (kind === 'l') {
      s.vline(0, 2, 5, INK);
      s.px(1, 1, INK); s.px(1, 7, INK);
    }
    if (kind === 'r') {
      s.vline(W - 1, 2, 5, INK);
      s.px(W - 2, 1, INK); s.px(W - 2, 7, INK);
    }
    if (kind === 'm') { s.px(3, 1, P.UI_VELLUM[3]); s.px(3, 7, P.UI_VELLUM[1]); }
    return s;
  };
  b.add('ui/timeline_bar_l', bar('l'));
  b.add('ui/timeline_bar_m', bar('m'));
  b.add('ui/timeline_bar_r', bar('r'));
}

// ───────────────────────────────────────────────────────────────────────────
//  8. Lantern Trial (quest three)
// ───────────────────────────────────────────────────────────────────────────

function registerTrial(b: ArtBuild): void {
  // Three answer tokens: different hue AND different pip count, because in a
  // conformity puzzle the player must never mistake which lantern is which.
  const markers: Array<[string, readonly string[], number]> = [
    ['a', P.WINDOW_AMBER, 1],
    ['b', P.ROOF_TEAL, 2],
    ['c', P.UI_HEART, 3],
  ];
  for (const [key, ramp, pips] of markers) {
    const s = new Surface(15, 15);
    s.ellipse(1, 1, 13, 13, ramp[2]);
    s.innerShade(ramp[0], 1, [[0, 1], [1, 0]]);
    s.innerShade(ramp[4], 1, [[0, -1], [-1, 0]]);
    s.outline(INK, true);
    const xs = pips === 1 ? [7] : pips === 2 ? [5, 9] : [4, 7, 10];
    for (const x of xs) {
      s.rect(x - 1, 5, 2, 4, INK);
      s.pxOver(x - 1, 5, ramp[4]);
    }
    b.add(`ui/vote_marker_${key}`, s);
  }

  // Confidence meter: a groove with a brass fill, three pieces each so the
  // runtime can stretch it to any width without a seam.
  const track = (kind: 'l' | 'm' | 'r', filled: boolean) => {
    const W = 6;
    const s = new Surface(W, 9);
    const ramp = filled ? P.UI_BRASS : P.UI_PANEL;
    const base = filled ? 2 : 1;
    const x0 = kind === 'l' ? 1 : 0;
    const x1 = kind === 'r' ? W - 2 : W - 1;
    for (let x = x0; x <= x1; x++) {
      s.px(x, 0, INK);
      s.px(x, 8, INK);
      s.px(x, 1, filled ? P.UI_BRASS[4] : P.UI_PANEL[3]);
      for (let y = 2; y < 7; y++) s.px(x, y, ramp[base]);
      s.px(x, 7, filled ? P.UI_BRASS[0] : P.UI_PANEL[0]);
    }
    if (kind === 'l') { s.vline(0, 2, 5, INK); s.px(1, 1, INK); s.px(1, 7, INK); }
    if (kind === 'r') { s.vline(W - 1, 2, 5, INK); s.px(W - 2, 1, INK); s.px(W - 2, 7, INK); }
    if (filled && kind === 'm') { s.px(2, 3, P.UI_BRASS[4], 0.5); s.px(4, 5, P.UI_BRASS[0], 0.5); }
    return s;
  };
  for (const k of ['l', 'm', 'r'] as const) {
    b.add(`ui/confidence_bar_${k}`, track(k, false));
    b.add(`ui/confidence_bar_fill_${k}`, track(k, true));
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  9. Odds and ends
// ───────────────────────────────────────────────────────────────────────────

const CURSOR = [
  '#........',
  '##.......',
  '###......',
  '####.....',
  '#####....',
  '######...',
  '#######..',
  '########.',
  '#####....',
  '##.###...',
  '#...###..',
  '.....###.',
  '......##.',
];

function registerMisc(b: ArtBuild, body: BuiltFont): void {
  const cur = new Surface(10, 14);
  CURSOR.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') cur.px(x, y, P.UI_VELLUM[4]);
  });
  cur.innerShade(P.UI_VELLUM[2], 1, [[1, 0], [0, 1]]);
  cur.outline(INK, true);
  b.add('ui/cursor', cur);

  // Selection bracket: four corners that breathe in and out by a pixel.
  const inset = [2, 1, 0, 1];
  const tone = [P.UI_GOLD[4], P.UI_GOLD[3], P.UI_GOLD[2], P.UI_GOLD[3]];
  const sel: Surface[] = [];
  for (let f = 0; f < 4; f++) {
    const s = new Surface(20, 20);
    const i = inset[f];
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const x0 = sx ? 19 - i : i;
      const y0 = sy ? 19 - i : i;
      const dx = sx ? -1 : 1;
      const dy = sy ? -1 : 1;
      for (let k = 0; k < 5; k++) {
        s.px(x0 + dx * k, y0 + dy, INK, 0.5);
        s.px(x0 + dx, y0 + dy * k, INK, 0.5);
        s.px(x0 + dx * k, y0, tone[f]);
        s.px(x0, y0 + dy * k, tone[f]);
      }
    }
    sel.push(s);
  }
  b.addStrip('ui/selector', sel, { key: 'ui_selector', frameRate: 8, repeat: -1 });

  // Keycap glyphs: ink marks sized to sit inside ui/key_prompt. The lettered
  // ones reuse the body face so a prompt and a sentence share a voice.
  const label = (text: string) => {
    const s = new Surface(Math.max(1, textWidth(body, text) - body.spec.tracking), 7);
    drawText(s, body, 0, 0, text, INK);
    return s;
  };
  b.add('ui/key_e', label('E'));
  b.add('ui/key_j', label('J'));
  b.add('ui/key_q', label('Q'));
  b.add('ui/key_esc', label('ESC'));
  b.add('ui/key_tab', label('TAB'));
  b.add('ui/key_wasd', label('WASD'));

  const shift = new Surface(9, 9);
  shift.poly([[4, 0], [8, 4], [6, 4], [6, 9], [3, 9], [3, 4], [0, 4]], INK);
  shift.pxOver(4, 1, P.UI_KEY[4]);
  b.add('ui/key_shift', shift);

  const space = new Surface(17, 7);
  space.hline(0, 5, 17, INK);
  space.vline(0, 2, 4, INK);
  space.vline(16, 2, 4, INK);
  b.add('ui/key_space', space);

  // Map pin.
  const pin = new Surface(11, 16);
  pin.ellipse(1, 1, 9, 9, P.UI_GOLD[3]);
  pin.poly([[2, 8], [9, 8], [5, 14]], P.UI_GOLD[2]);
  pin.innerShade(P.UI_GOLD[0], 1, [[0, 1], [1, 0]]);
  pin.pxOver(3, 3, P.UI_GOLD[4]);
  pin.ellipse(4, 4, 4, 4, P.UI_PANEL[1]);
  pin.outline(INK, true);
  pin.ellipse(2, 13, 7, 3, INK, 0.28);
  b.add('ui/objective_pin', pin);

  // Quest markers: gold "something is here", green "that one is done".
  const badge = (ramp: readonly string[], mark: 'new' | 'done') => {
    const s = new Surface(13, 15);
    s.poly([[6, 1], [11, 7], [6, 13], [1, 7]], ramp[2]);
    s.innerShade(ramp[0], 1, [[0, 1], [1, 0]]);
    s.innerShade(ramp[4], 1, [[0, -1], [-1, 0]]);
    s.outline(INK, true);
    if (mark === 'new') {
      s.rect(5, 4, 2, 5, INK);
      s.rect(5, 10, 2, 2, INK);
      s.pxOver(5, 4, P.FONT_LIGHT);
    } else {
      for (const [x, y] of [[3, 7], [4, 8], [5, 9], [6, 7], [7, 6], [8, 5]] as const) {
        s.pxOver(x, y, INK);
        s.pxOver(x, y + 1, INK);
      }
      s.pxOver(8, 5, P.FONT_LIGHT);
    }
    return s;
  };
  b.add('ui/quest_new', badge(P.UI_GOLD, 'new'));
  b.add('ui/quest_done', badge(P.UI_GOOD, 'done'));

  // A single white pixel the runtime stretches for fades and flashes.
  b.add('ui/fade_pixel', new Surface(1, 1, '#ffffff'));
}

// ───────────────────────────────────────────────────────────────────────────
//  10. Inspection sheets
//
//  build.ts wipes art_preview/ *after* the asset modules have run, and its
//  per-group sheets put every 9-slice piece in a file of its own, which tells
//  you nothing about a panel. So the sheets that matter — the assembled
//  panels, the icon row, the font specimen — are written from an exit hook.
// ───────────────────────────────────────────────────────────────────────────

function writePNG(path: string, s: Surface): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(s.w, s.h, s.data));
}

function uiContactSheet(b: ArtBuild, scale: number, bg: string): Surface {
  const items = b.sprites.filter((s) => s.name.startsWith('ui/'));
  const cols = 16;
  const cellW = Math.max(...items.map((i) => i.s.w)) * scale + 6;
  const cellH = Math.max(...items.map((i) => i.s.h)) * scale + 6;
  const rows = Math.ceil(items.length / cols);
  const out = new Surface(cols * cellW, rows * cellH, bg);
  items.forEach((it, i) => {
    const x = (i % cols) * cellW + 3;
    const y = Math.floor(i / cols) * cellH + 3;
    for (let j = 0; j < it.s.h; j++) for (let k = 0; k < it.s.w; k++) {
      const c = it.s.get(k, j);
      if (c[3] === 0) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        out.px(x + k * scale + dx, y + j * scale + dy, c);
      }
    }
  });
  return out;
}

/** Assemble a panel from its nine slices, exactly the way the runtime will. */
function assemble(b: ArtBuild, base: string, w: number, h: number): Surface {
  const cache = new Map<string, Surface>();
  const get = (n: string) => {
    let s = cache.get(n);
    if (!s) { s = b.sprites.find((q) => q.name === `${base}_${n}`)!.s; cache.set(n, s); }
    return s;
  };
  const S = get('tl').w;
  const out = new Surface(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = x < S ? -1 : x >= w - S ? 1 : 0;
      const cy = y < S ? -1 : y >= h - S ? 1 : 0;
      const sx = cx === -1 ? x : cx === 1 ? x - (w - S) : (x - S) % S;
      const sy = cy === -1 ? y : cy === 1 ? y - (h - S) : (y - S) % S;
      const c = get(SLICE[cy + 1][cx + 1]).get(sx, sy);
      if (c[3]) out.px(x, y, c);
    }
  }
  return out;
}

/**
 * Every 9-slice, assembled at a size the runtime would actually ask for, at 1x
 * beside 3x. Individual slices tell you nothing — a panel is only right or
 * wrong once it is built.
 */
function panelSheet(b: ArtBuild, body: BuiltFont): Surface {
  const sets: Array<[string, number, number]> = [
    ['ui/panel', 120, 54],
    ['ui/panelDark', 120, 54],
    ['ui/panelEcho', 120, 54],
    ['ui/dialogue', 150, 46],
    ['ui/name_tag', 52, 15],
    ['ui/tab_active', 44, 16],
    ['ui/tab_inactive', 44, 15],
    ['ui/insight_frame', 120, 60],
    ['ui/clue_card', 44, 26],
    ['ui/vote_bubble', 52, 22],
    ['ui/key_prompt', 30, 13],
    ['ui/minimap_frame', 56, 44],
  ];
  const built = sets.map(([n, w, h]) => ({ n, s: assemble(b, n, w, h) }));
  const rowH = Math.max(...built.map((p) => p.s.h)) * 3 + 14;
  const colW = Math.max(...built.map((p) => p.s.w)) * 4 + 24;
  const out = new Surface(colW * 3, rowH * Math.ceil(built.length / 3), P.UI_PANEL[0]);
  built.forEach((p, i) => {
    const ox = (i % 3) * colW + 8;
    const oy = Math.floor(i / 3) * rowH + 10;
    drawText(out, body, ox, oy - 9, p.n, P.UI_VELLUM[2]);
    out.blit(p.s, ox, oy);
    for (let y = 0; y < p.s.h; y++) for (let x = 0; x < p.s.w; x++) {
      const c = p.s.get(x, y);
      if (c[3] === 0) continue;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        out.px(ox + p.s.w + 6 + x * 3 + dx, oy + y * 3 + dy, c);
      }
    }
  });
  return out;
}

/** A 480x270 dress rehearsal: real panels, real type, at 1x. */
function uiMock(b: ArtBuild, body: BuiltFont, display: BuiltFont): Surface {
  const s = new Surface(480, 270, P.GRASS[2]);
  for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) {
    if ((x * 7 + y * 13) % 11 === 0) s.px(x, y, P.GRASS[1]);
  }
  const sprite = (n: string, x: number, y: number) => {
    const sp = b.sprites.find((q) => q.name === n);
    if (sp) s.blit(sp.s, x, y);
  };

  // Journal, left.
  s.blit(assemble(b, 'ui/panelDark', 190, 150), 8, 40);
  s.blit(assemble(b, 'ui/tab_active', 46, 16), 16, 28);
  s.blit(assemble(b, 'ui/tab_inactive', 46, 14), 64, 30);
  s.blit(assemble(b, 'ui/tab_inactive', 46, 14), 112, 30);
  drawTextCentered(s, body, 39, 34, 'QUESTS', P.UI_INK);
  drawTextCentered(s, body, 87, 35, 'PEOPLE', P.UI_VELLUM[0]);
  drawTextCentered(s, body, 135, 35, 'MAP', P.UI_VELLUM[0]);
  sprite('ui/divider', 20, 60);
  const rows = ['The Bell and the Cat', 'The Mixed-Up Delivery', 'The Lantern Trial'];
  rows.forEach((t, i) => {
    sprite(i === 0 ? 'ui/checkbox_on' : 'ui/checkbox_off', 18, 68 + i * 16);
    drawText(s, body, 31, 71 + i * 16, t, i === 0 ? P.UI_VELLUM[2] : P.UI_VELLUM[4]);
  });
  sprite('ui/bullet', 19, 120);
  drawText(s, body, 28, 120, 'Pip is afraid of the bell.', P.UI_VELLUM[3]);
  sprite('ui/bullet', 19, 132);
  drawText(s, body, 28, 132, 'Oren mixed up two routes.', P.UI_VELLUM[3]);
  sprite('ui/scroll_up', 179, 46);
  sprite('ui/scroll_down', 179, 170);
  sprite('ui/bookmark_0', 166, 34);
  sprite('ui/page_corner', 187, 179);

  // Insight card, right.
  s.blit(assemble(b, 'ui/insight_frame', 232, 130), 238, 34);
  sprite('ui/insight_ray_0', 336, 30);
  sprite('ui/insight_seal', 346, 40);
  drawTextCentered(s, display, 354, 62, 'CLASSICAL', P.UI_GOLD[1]);
  drawTextCentered(s, display, 354, 78, 'CONDITIONING', P.UI_GOLD[1]);
  drawTextCentered(s, body, 354, 100, 'When one thing keeps predicting', P.UI_INK);
  drawTextCentered(s, body, 354, 112, 'another, the first begins to', P.UI_INK);
  drawTextCentered(s, body, 354, 124, 'produce the learned response.', P.UI_INK);
  sprite('ui/thread_node_filled', 262, 138);
  sprite('ui/thread_connector_0', 278, 141);
  sprite('ui/thread_node_filled', 292, 138);
  sprite('ui/thread_connector_1', 308, 141);
  sprite('ui/thread_node_empty', 322, 138);
  sprite('ui/thread_node_wrong', 352, 138);
  sprite('ui/clue_pin', 372, 136);
  s.blit(assemble(b, 'ui/clue_card', 52, 24), 388, 138);
  drawText(s, body, 392, 144, 'the bell', P.UI_INK);

  // HUD.
  for (let i = 0; i < 3; i++) sprite('ui/heart_full', 8 + i * 12, 8);
  sprite('ui/heart_half', 44, 8);
  sprite('ui/heart_empty', 56, 8);
  ['observe', 'link', 'recall', 'dissent'].forEach((n, i) => {
    sprite(`ui/icon_${n}${i > 1 ? '_dim' : ''}`, 392 + i * 20, 6);
  });
  sprite('ui/selector_1', 390, 4);
  s.blit(assemble(b, 'ui/minimap_frame', 60, 46), 412, 30);
  sprite('ui/objective_pin', 436, 44);

  // Dialogue.
  s.blit(assemble(b, 'ui/dialogue', 400, 58), 40, 196);
  sprite('ui/dialogue_tail_l', 74, 252);
  s.blit(assemble(b, 'ui/name_tag', 44, 14), 48, 188);
  drawTextCentered(s, body, 70, 191, 'SERA', P.UI_GOLD[3]);
  drawText(s, body, 52, 206, 'The bell wasn’t frightening him.', P.UI_INK);
  drawText(s, body, 52, 218, 'Somewhere along the way he learned what it', P.UI_INK);
  drawText(s, body, 52, 230, 'meant — and now he braces every time.', P.UI_INK);
  sprite('ui/advance_arrow_0', 422, 236);

  // Vote bubble + key prompts.
  s.blit(assemble(b, 'ui/vote_bubble', 46, 20), 246, 168);
  sprite('ui/vote_marker_b', 249, 170);
  drawText(s, body, 266, 175, 'That one!', P.UI_INK);
  const prompt = (x: number, glyph: string, word: string) => {
    const g = b.sprites.find((q) => q.name === glyph)!.s;
    const w = 10 + g.w;
    s.blit(assemble(b, 'ui/key_prompt', w, 13), x, 250);
    s.blit(g, x + 5, 253);
    drawText(s, body, x + w + 3, 252, word, P.FONT_LIGHT);
    return x + w + 6 + textWidth(body, word);
  };
  let px = 8;
  px = prompt(px, 'ui/key_e', 'talk');
  px = prompt(px, 'ui/key_esc', 'back');
  prompt(px, 'ui/key_wasd', 'move');
  sprite('ui/quest_new', 202, 58);
  sprite('ui/quest_done', 202, 78);
  sprite('ui/cursor', 216, 60);
  return s;
}

// ───────────────────────────────────────────────────────────────────────────

export function registerUI(b: ArtBuild): void {
  const body = buildFont(BODY);
  const display = buildFont(DISPLAY);

  registerPanels(b);
  registerDialogue(b);
  registerHearts(b);
  registerIcons(b);
  registerJournal(b);
  registerInsight(b);
  registerThreads(b);
  registerTrial(b);
  registerMisc(b, body);

  // The fonts are UI, but they are not atlas frames: Phaser loads each as its
  // own texture plus an Angel-Code XML, so they go straight into public/assets.
  writeFont(ASSETS, BODY);
  writeFont(ASSETS, DISPLAY);

  process.on('exit', () => {
    try {
      writePNG(join(PREVIEW, 'font_specimen.png'), buildSpecimen(body, display));
      writePNG(join(PREVIEW, 'font_ingame.png'), buildInGameMock(body, display));
      writePNG(join(PREVIEW, 'ui_sheet_4x.png'), uiContactSheet(b, 4, '#161327'));
      writePNG(join(PREVIEW, 'ui_sheet_1x.png'), uiContactSheet(b, 1, '#161327'));
      writePNG(join(PREVIEW, 'ui_panels.png'), panelSheet(b, body));
      writePNG(join(PREVIEW, 'ui_mock_1x.png'), uiMock(b, body, display));
    } catch { /* an inspection sheet must never break the build */ }
  });
}
