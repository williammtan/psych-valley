/**
 * UI — PARCHMENT, INK AND BRASS
 *
 * The interface language of Lumen Vale is a field notebook: warm vellum pages
 * held in thin brass hardware, written in violet-black ink. Nothing here is a
 * fantasy scroll border and nothing is a chunky console frame — the game is
 * about noticing things, so the chrome stays quiet and the *content* is what
 * carries colour.
 *
 * ── The rules every panel in this file obeys ────────────────────────────────
 *  1. BORDER WEIGHT is always 3 px, in this order from the outside in:
 *       0  P.OUTLINE              the silhouette, never anything else
 *       1  band                   brass on chrome, paper-brown on content
 *       2  rule                   the inner highlight/shade line
 *     ...then the field.
 *  2. CORNER RADIUS is always a 2 px diagonal chamfer (CUT). Every band and
 *     rule follows the chamfer, so corners never look mitred-by-accident.
 *  3. HIGHLIGHT RULE: the band and rule are lit on the top and left edges and
 *     dim on the bottom and right. Light comes from the upper left, here as
 *     everywhere else in the game.
 *  4. FIELD carries a low-contrast vellum grain — two steps either side of the
 *     field tone, never more, so a 400 px wide panel is not a dot screen.
 *
 * Everything is registered as 9-slice pieces (`_tl _t _tr _l _c _r _bl _b _br`)
 * so the runtime can build a panel at any size from the same nine sprites.
 *
 * This module also emits the two bitmap fonts into public/assets, because the
 * fonts are UI, and keeps their specimen sheet alive in art_preview/.
 */
import { Surface, rng } from '../lib/pixel.js';
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

/** The one corner radius. */
const CUT = 2;

const INK = P.OUTLINE;

function hash2(x: number, y: number, seed: number): number {
  let n = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Zero the alpha inside an ellipse — used to make rings and cut-outs. */
function punch(s: Surface, x: number, y: number, w: number, h: number): void {
  const m = new Surface(s.w, s.h);
  m.ellipse(x, y, w, h, '#ffffff');
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (m.alphaAt(i, j)) s.data[(j * s.w + i) * 4 + 3] = 0;
    }
  }
}

/** A soft drop shadow under a UI element that is meant to float. */
function floatShadow(s: Surface, dx = 1, dy = 1): void {
  const src = s.clone();
  for (let j = 0; j < s.h; j++) {
    for (let i = 0; i < s.w; i++) {
      if (src.alphaAt(i, j) === 0) continue;
      if (s.alphaAt(i + dx, j + dy) === 0) s.px(i + dx, j + dy, INK, 0.32);
    }
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
  /** Tabs: the bottom edge has no frame so the tab merges into its panel. */
  openBottom?: boolean;
  /** Extra pass over a finished piece, keyed by its slice name. */
  detail?: (s: Surface, name: string, st: PanelStyle) => void;
}

const SLICE = [
  ['tl', 't', 'tr'],
  ['l', 'c', 'r'],
  ['bl', 'b', 'br'],
];

function panelPiece(st: PanelStyle, dx: number, dy: number): Surface {
  const S = st.size;
  const cut = st.cut ?? CUT;
  const fi = st.fi ?? 3;
  const grain = st.grain ?? 1;
  const seed = st.seed ?? 7;
  const s = new Surface(S, S);
  const open = st.openBottom === true;

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
      // The chamfer is just another distance field, so bands follow it.
      if (dx === -1 && dy === -1) consider(x + y - cut, true);
      if (dx === 1 && dy === -1) consider((S - 1 - x) + y - cut, true);
      if (!open && dx === -1 && dy === 1) consider(x + (S - 1 - y) - cut, false);
      if (!open && dx === 1 && dy === 1) consider((S - 1 - x) + (S - 1 - y) - cut, false);

      if (d < 0) continue; // chamfered away
      if (d === 0) { s.px(x, y, INK); continue; }
      if (d === 1) { s.px(x, y, lit ? st.bandLit : st.bandDim); continue; }
      if (d === 2) { s.px(x, y, lit ? st.ruleLit : st.ruleDim); continue; }

      // Field + vellum grain. Two steps of contrast, mixed halfway toward the
      // neighbouring ramp entries so a big panel reads as paper, not noise.
      const h = hash2(x, y, seed);
      let c = st.fill[fi];
      if (grain > 0) {
        if (h < 0.13 * grain) c = P.mix(st.fill[fi], st.fill[Math.max(0, fi - 1)], 0.55);
        else if (h > 1 - 0.10 * grain) c = P.mix(st.fill[fi], st.fill[Math.min(st.fill.length - 1, fi + 1)], 0.7);
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
      st.detail?.(s, name, st);
      b.add(`${base}_${name}`, s);
    }
  }
}

// The five panel personalities. Chrome wears brass; content wears paper.
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
      // A single cyan mote in each corner: Echo panels are never quite still.
      if (name === 'tl') s.px(4, 4, P.ECHO_RUNE, 0.7);
      if (name === 'br') s.px(3, 3, P.ECHO_RUNE, 0.5);
    },
  });

  // Dialogue: the same hardware, a lighter page, and a dog-eared bottom-right
  // corner so the box reads as a sheet of paper someone has handled.
  nine(b, 'ui/dialogue', {
    ...PARCHMENT_STYLE,
    fi: 3,
    seed: 404,
    grain: 0.7,
    detail: (s, name) => {
      if (name !== 'br') return;
      // Fold the corner up: the back of the sheet is darker and its edge
      // catches the light.
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x + y < 9) continue;
          s.px(x, y, P.UI_VELLUM[2]);
        }
      }
      for (let k = 0; k <= 5; k++) {
        s.px(7 - k, 2 + k, INK);
        if (k < 5) s.px(7 - k, 3 + k, P.UI_VELLUM[4]);
      }
      // Keep the silhouette square where the fold meets the outer border.
      for (let k = 0; k < 8; k++) { s.pxOver(7, k, INK); s.pxOver(k, 7, INK); }
      s.px(7, 7, INK);
    },
  });

  // Speaker plate: small, dark, brass-edged, sits half over the dialogue box.
  nine(b, 'ui/name_tag', { ...DARK_STYLE, size: 6, seed: 505, grain: 0.6 });

  // Journal tabs. The active one is a lit page with no bottom edge, so it
  // fuses with the panel below it; the inactive one is a closed, dimmer page.
  nine(b, 'ui/tab_active', {
    ...PARCHMENT_STYLE, size: 6, seed: 606, openBottom: true,
  });
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

  // Content elements: no brass. A soft paper-brown band keeps them one step
  // quieter than the chrome they sit inside.
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
      // A ruled line under the card's heading area.
      if (name === 't') for (let x = 0; x < 6; x++) s.px(x, 5, P.UI_VELLUM[1], 0.7);
      if (name === 'tl') s.px(5, 5, P.UI_VELLUM[1], 0.7);
      if (name === 'tr') s.px(0, 5, P.UI_VELLUM[1], 0.7);
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

  // Minimap: brass ring, dark interior with a faint survey grid.
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
      if (name === 'c') for (let k = 0; k < 6; k++) { s.px(k, 2, P.UI_PANEL[2], 0.5); s.px(2, k, P.UI_PANEL[2], 0.5); }
      // Rivets in the corners of the frame.
      if (name === 'tl') s.px(2, 2, P.UI_BRASS[4]);
      if (name === 'tr') s.px(3, 2, P.UI_BRASS[4]);
      if (name === 'bl') s.px(2, 3, P.UI_BRASS[2]);
      if (name === 'br') s.px(3, 3, P.UI_BRASS[2]);
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
//  2. Dialogue furniture
// ───────────────────────────────────────────────────────────────────────────

function registerDialogue(b: ArtBuild): void {
  // Tails point from the box down toward the speaker.
  const tail = (flip: boolean) => {
    const s = new Surface(11, 8);
    for (let y = 0; y < 7; y++) {
      const w = 10 - y * 2 + 2;
      for (let x = 0; x < Math.max(w, 0); x++) s.px(x, y, P.UI_VELLUM[3]);
    }
    s.innerShade(P.UI_VELLUM[1], 1, [[0, 1], [1, 0]]);
    s.innerShade(P.UI_VELLUM[4], 1, [[0, -1]]);
    s.outline(INK, true);
    // The tail hangs off the box, so its top row must not be outlined.
    for (let x = 0; x < 11; x++) s.px(x, 0, s.alphaAt(x, 1) ? P.UI_BRASS[1] : [0, 0, 0, 0]);
    return flip ? s.flipX() : s;
  };
  b.add('ui/dialogue_tail_l', tail(false));
  b.add('ui/dialogue_tail_r', tail(true));

  // "Press to continue" chevron. Bobs one pixel and breathes in brightness.
  const arrowFrames: Surface[] = [];
  const bob = [0, 1, 2, 1];
  const tone = [P.UI_BRASS[4], P.UI_BRASS[3], P.UI_BRASS[2], P.UI_BRASS[3]];
  for (let f = 0; f < 4; f++) {
    const s = new Surface(9, 9);
    const y0 = 1 + bob[f];
    for (let k = 0; k < 4; k++) {
      s.px(1 + k, y0 + k, tone[f]);
      s.px(7 - k, y0 + k, tone[f]);
      s.px(1 + k, y0 + k + 1, P.UI_BRASS[1]);
      s.px(7 - k, y0 + k + 1, P.UI_BRASS[1]);
    }
    s.px(4, y0 + 3, tone[f]);
    s.px(4, y0 + 4, P.UI_BRASS[1]);
    s.outline(INK);
    arrowFrames.push(s);
  }
  b.addStrip('ui/advance_arrow', arrowFrames, { key: 'ui_advance', frameRate: 6, repeat: -1 });
}

// ───────────────────────────────────────────────────────────────────────────
//  3. Hearts
//
//  Not a Zelda heart: this one is a folded paper charm — square shoulders, a
//  deep centre notch and a short blunt point, so it reads as *made* rather
//  than as a symbol lifted off a valentine.
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

function heartSilhouette(): Surface {
  const s = new Surface(11, 11);
  HEART_SHAPE.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') s.px(x + 1, y + 1, '#ffffff');
  });
  return s;
}

function heartFull(): Surface {
  const mask = heartSilhouette();
  const s = new Surface(11, 11);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (mask.alphaAt(x, y)) s.px(x, y, P.UI_HEART[2]);
  s.innerShade(P.UI_HEART[3], 1, [[0, -1], [-1, 0]]);
  s.innerShade(P.UI_HEART[0], 1, [[0, 1], [1, 0]]);
  // Specular on the upper-left lobe, the only place the brightest step lands.
  s.pxOver(2, 2, P.UI_HEART[4]);
  s.pxOver(3, 2, P.UI_HEART[4]);
  s.pxOver(2, 3, P.UI_HEART[4]);
  s.outline(INK, true);
  return s;
}

function heartEmpty(): Surface {
  const mask = heartSilhouette();
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

function heartHalf(): Surface {
  const full = heartFull();
  const empty = heartEmpty();
  const s = new Surface(11, 11);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    const c = x <= 5 ? full.get(x, y) : empty.get(x, y);
    if (c[3]) s.px(x, y, c);
  }
  for (let y = 1; y < 10; y++) if (s.alphaAt(6, y)) s.px(6, y, P.UI_HEART[0], 0.55);
  return s;
}

function registerHearts(b: ArtBuild): void {
  const full = heartFull();
  b.add('ui/heart_full', full);
  b.add('ui/heart_half', heartHalf());
  b.add('ui/heart_empty', heartEmpty());

  const centred = (src: Surface) => {
    const s = new Surface(15, 15);
    s.blit(src, 2, 2);
    return s;
  };
  const spark = (s: Surface, cx: number, cy: number, r: number, n: number, phase: number, c: string, a = 1) => {
    for (let i = 0; i < n; i++) {
      const t = phase + (i / n) * Math.PI * 2;
      s.px(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), c, a);
    }
  };

  // Gain: a bright core blooms into the finished heart, sparks fly outward.
  const gain: Surface[] = [];
  for (let f = 0; f < 5; f++) {
    const s = new Surface(15, 15);
    if (f === 0) {
      s.ellipse(5, 5, 5, 5, P.UI_HEART[4]);
      s.ellipse(6, 6, 3, 3, P.FONT_LIGHT);
      spark(s, 7, 7, 4, 8, 0, P.UI_HEART[4], 0.9);
    } else {
      s.blit(centred(full));
      if (f === 1) {
        s.tint(P.FONT_LIGHT, 0.55);
        spark(s, 7, 7, 6, 8, 0.2, P.UI_HEART[4]);
      } else if (f === 2) {
        spark(s, 7, 7, 6, 6, 0.5, P.UI_HEART[4], 0.85);
      } else if (f === 3) {
        spark(s, 7, 7, 7, 4, 0.9, P.UI_HEART[3], 0.55);
      }
    }
    gain.push(s);
  }
  b.addStrip('ui/heart_gain', gain, { key: 'ui_heart_gain', frameRate: 14, repeat: 0 });

  // Loss: white flash, crack, drain, shards, socket.
  const empty = heartEmpty();
  const lose: Surface[] = [];
  for (let f = 0; f < 5; f++) {
    const s = new Surface(15, 15);
    if (f === 0) {
      s.blit(centred(full));
      s.tint(P.FONT_LIGHT, 0.75);
    } else if (f === 4) {
      s.blit(centred(empty));
    } else {
      // Drain from the top down: rows above the waterline go to the socket.
      const cut = 2 + f * 2;
      const fu = centred(full), em = centred(empty);
      for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
        const c = y < 2 + cut ? em.get(x, y) : fu.get(x, y);
        if (c[3]) s.px(x, y, c);
      }
      // The crack that opened it.
      for (let k = 0; k < 5; k++) s.pxOver(7 + (k % 2 === 0 ? 0 : 1), 3 + k, INK);
      if (f === 3) {
        s.px(2, 12, P.UI_HEART[2]); s.px(12, 11, P.UI_HEART[2]); s.px(9, 14, P.UI_HEART[1]);
      }
    }
    lose.push(s);
  }
  b.addStrip('ui/heart_lose', lose, { key: 'ui_heart_lose', frameRate: 14, repeat: 0 });
}

// ───────────────────────────────────────────────────────────────────────────
//  4. Icons — 16x16, silhouette first, three ramp steps, no interior fuss.
//     They must be told apart with the colour switched off, so no two share
//     an outline: lens, rings, beaded thread, hand, book, folded map, scroll,
//     two heads, star, bell, box, lantern, paw.
// ───────────────────────────────────────────────────────────────────────────

type IconDraw = (s: Surface) => void;

function icon(draw: IconDraw): Surface {
  const s = new Surface(16, 16);
  draw(s);
  return s;
}

/** Disabled state: everything drifts toward the panel shadow and loses value. */
function dimmed(src: Surface): Surface {
  return src.clone().tint(P.UI_PANEL[1], 0.55).brightness(0.88);
}

const ICONS: Record<string, IconDraw> = {
  // OBSERVE — a lens with three attention rays. The one icon with rays.
  observe: (s) => {
    s.poly([[1, 8], [5, 4], [11, 4], [15, 8], [11, 12], [5, 12]], P.UI_PARCHMENT[4]);
    s.innerShade(P.UI_PARCHMENT[2], 1, [[0, 1], [1, 0]]);
    s.ellipse(5, 5, 6, 6, P.ECHO_CYAN[2]);
    s.ellipse(6, 6, 4, 4, P.ECHO_CYAN[0]);
    s.px(6, 6, P.ECHO_CYAN[4]);
    s.outline(INK, true);
    for (const [x, dx] of [[3, -1], [8, 0], [13, 1]] as const) {
      s.px(x, 2, P.UI_BRASS[3]);
      s.px(x + dx, 0, P.UI_BRASS[2]);
      s.px(x + dx, 1, P.UI_BRASS[3]);
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
    s.blit(ring(6, 4, P.UI_BRASS[2], P.UI_BRASS[0]));
    s.blit(ring(0, 3, P.UI_BRASS[3], P.UI_BRASS[1]));
    // The left ring passes behind on its lower arc, so they interlock.
    const back = ring(6, 4, P.UI_BRASS[2], P.UI_BRASS[0]);
    for (let y = 9; y < 15; y++) for (let x = 6; x < 12; x++) {
      const c = back.get(x, y);
      if (c[3]) s.px(x, y, c);
    }
  },

  // RECALL — three beads on a thread. Straight from the Memory Thread board.
  recall: (s) => {
    const pt = (t: number): [number, number] => [
      Math.round(1 + t * 13),
      Math.round(12 - t * 9 + Math.sin(t * Math.PI) * 2.4),
    ];
    for (let i = 0; i <= 40; i++) {
      const [x, y] = pt(i / 40);
      s.px(x, y + 1, P.UI_VELLUM[0]);
      s.px(x, y, P.UI_VELLUM[3]);
    }
    for (const t of [0.12, 0.5, 0.88]) {
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
    s.rect(5, 3, 2, 7, sk[2]);
    s.rect(8, 2, 2, 8, sk[2]);
    s.rect(11, 3, 2, 7, sk[2]);
    s.rect(4, 8, 10, 4, sk[2]);
    s.rect(2, 7, 3, 3, sk[2]);
    s.innerShade(sk[1], 1, [[1, 0], [0, 1]]);
    s.vline(5, 3, 6, sk[4]);
    s.vline(8, 2, 6, sk[4]);
    s.rect(4, 12, 10, 3, P.CLOTH.nia[2]);
    s.hline(4, 12, 10, P.CLOTH.nia[4]);
    s.hline(4, 14, 10, P.CLOTH.nia[0]);
    s.outline(INK, true);
  },

  // JOURNAL — a shut book with a ribbon out the bottom.
  journal: (s) => {
    s.rect(3, 1, 10, 13, P.ROOF_PLUM[2]);
    s.rect(3, 1, 2, 13, P.ROOF_PLUM[1]);
    s.rect(12, 2, 2, 11, P.UI_VELLUM[4]);
    s.hline(12, 5, 2, P.UI_VELLUM[2]);
    s.hline(12, 9, 2, P.UI_VELLUM[2]);
    s.innerShade(P.ROOF_PLUM[0], 1, [[0, 1]]);
    s.hline(3, 1, 10, P.ROOF_PLUM[4]);
    s.hline(6, 4, 5, P.UI_BRASS[3]);
    s.hline(6, 10, 5, P.UI_BRASS[2]);
    s.rect(8, 14, 2, 2, P.UI_HEART[2]);
    s.px(8, 15, P.UI_HEART[1]);
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
    // A route across it: dashes and a cross where it ends.
    for (let x = 2; x < 13; x += 2) s.px(x, 9 - Math.round(Math.sin(x * 0.6) * 2), P.UI_HEART[1]);
    s.px(12, 5, P.UI_HEART[2]); s.px(13, 6, P.UI_HEART[2]);
    s.px(13, 5, P.UI_HEART[2]); s.px(12, 6, P.UI_HEART[2]);
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
    const bust = (x: number, y: number, ramp: readonly string[], w: number) => {
      s.ellipse(x + 1, y, 5, 5, ramp[2]);
      s.poly([[x - 1, y + 11], [x, y + 6], [x + 6, y + 6], [x + w, y + 11]], ramp[1]);
    };
    bust(8, 2, P.CLOTH.neutral, 7);
    s.outline(INK, true);
    bust(2, 4, P.CLOTH.sera, 7);
    s.px(4, 5, P.CLOTH.sera[4]);
    s.px(11, 3, P.CLOTH.neutral[4]);
    s.outline(INK, true);
  },

  // INSIGHT — a four-point spark with a small companion.
  insight: (s) => {
    s.poly([[7, 1], [9, 7], [15, 9], [9, 11], [7, 15], [5, 11], [0, 9], [5, 7]], P.UI_GOLD[3]);
    s.innerShade(P.UI_GOLD[1], 1, [[0, 1], [1, 0]]);
    s.px(6, 8, P.UI_GOLD[4]);
    s.px(7, 8, P.UI_GOLD[4]);
    s.px(6, 7, P.UI_GOLD[4]);
    s.poly([[13, 0], [14, 3], [15, 4], [14, 5], [13, 3]], P.UI_GOLD[4]);
    s.outline(INK, true);
  },

  // BELL — the town bell. Quest one lives or dies on this reading clearly.
  bell: (s) => {
    s.rect(6, 1, 3, 2, P.UI_BRASS[2]);
    s.ellipse(3, 3, 10, 10, P.UI_BRASS[2]);
    s.rect(3, 7, 10, 5, P.UI_BRASS[2]);
    s.rect(1, 11, 14, 2, P.UI_BRASS[2]);
    s.innerShade(P.UI_BRASS[0], 1, [[0, 1], [1, 0]]);
    s.vline(5, 4, 8, P.UI_BRASS[4]);
    s.px(4, 5, P.UI_BRASS[4]);
    s.hline(1, 11, 12, P.UI_BRASS[3]);
    s.ellipse(6, 13, 4, 3, P.UI_BRASS[1]);
    s.outline(INK, true);
  },

  // PACKAGE — Oren's parcel. Kraft paper, twine cross, a lopsided bow.
  package: (s) => {
    s.rect(2, 3, 12, 11, P.SAND[2]);
    s.hline(2, 3, 12, P.SAND[4]);
    s.innerShade(P.SAND[0], 1, [[0, 1], [1, 0]]);
    s.vline(7, 3, 11, P.WOOD[1]);
    s.hline(2, 8, 12, P.WOOD[1]);
    s.vline(8, 3, 11, P.WOOD[3], 0.5);
    s.px(6, 1, P.WOOD[2]); s.px(5, 2, P.WOOD[2]); s.px(6, 2, P.WOOD[2]);
    s.px(9, 1, P.WOOD[2]); s.px(10, 2, P.WOOD[2]); s.px(9, 2, P.WOOD[2]);
    s.px(7, 2, P.WOOD[3]); s.px(8, 2, P.WOOD[3]);
    s.outline(INK, true);
  },

  // LANTERN — the festival, and every safe place in the game.
  lantern: (s) => {
    s.ellipseOutline(5, 0, 6, 6, P.UI_BRASS[1]);
    for (let x = 5; x < 11; x++) s.px(x, 3, [0, 0, 0, 0]);
    s.rect(3, 3, 10, 2, P.UI_BRASS[2]);
    s.rect(4, 5, 8, 8, P.WINDOW_AMBER[3]);
    s.rect(2, 12, 12, 3, P.UI_BRASS[2]);
    s.vline(4, 5, 8, P.UI_BRASS[3]);
    s.vline(11, 5, 8, P.UI_BRASS[1]);
    s.ellipse(6, 7, 4, 5, P.FIRE[3]);
    s.ellipse(7, 8, 2, 3, P.FIRE[4]);
    s.hline(2, 12, 12, P.UI_BRASS[3]);
    s.hline(2, 14, 12, P.UI_BRASS[0]);
    s.hline(3, 3, 10, P.UI_BRASS[4]);
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
    div.px(x, 1, P.UI_BRASS[4], a * 0.55);
    div.px(x, 3, P.UI_BRASS[0], a * 0.5);
  }
  for (let k = 0; k < 3; k++) {
    for (let i = -k; i <= k; i++) {
      div.px(16 + i, 2 - (2 - k), P.UI_BRASS[3]);
      div.px(16 + i, 2 + (2 - k), P.UI_BRASS[1]);
    }
  }
  div.px(16, 2, P.UI_BRASS[4]);
  b.add('ui/divider', div);

  // Bookmarks: four ribbons, one per journal tab.
  const ribbons: Array<readonly string[]> = [P.UI_BRASS, P.UI_HEART, P.ECHO_VIOLET, P.ROOF_TEAL];
  ribbons.forEach((ramp, i) => {
    const s = new Surface(6, 13);
    s.rect(1, 0, 4, 11, ramp[2]);
    s.vline(1, 0, 11, ramp[3]);
    s.vline(4, 0, 11, ramp[1]);
    s.px(1, 11, ramp[2]); s.px(2, 11, ramp[1]);
    s.px(4, 11, ramp[2]); s.px(3, 11, ramp[1]);
    s.px(1, 12, ramp[1]); s.px(4, 12, ramp[1]);
    s.hline(1, 0, 4, ramp[4]);
    s.outline(INK);
    b.add(`ui/bookmark_${i}`, s);
  });

  // Scroll affordances: a small vellum disc with a brass chevron.
  const scroller = (up: boolean) => {
    const s = new Surface(9, 9);
    s.ellipse(0, 0, 9, 9, P.UI_VELLUM[3]);
    s.innerShade(P.UI_VELLUM[1], 1, [[0, 1], [1, 0]]);
    s.innerShade(P.UI_VELLUM[4], 1, [[0, -1], [-1, 0]]);
    for (let k = 0; k < 3; k++) {
      const y = up ? 5 - k : 3 + k;
      s.px(4 - k, y, P.UI_BRASS[1]);
      s.px(4 + k, y, P.UI_BRASS[1]);
    }
    s.outline(INK, true);
    return s;
  };
  b.add('ui/scroll_up', scroller(true));
  b.add('ui/scroll_down', scroller(false));

  // Checkboxes: an ink square on vellum; ticked ones take a brass check.
  const box = (on: boolean) => {
    const s = new Surface(9, 9);
    s.rect(0, 0, 9, 9, P.UI_VELLUM[3]);
    for (const [x, y] of [[0, 0], [8, 0], [0, 8], [8, 8]] as const) s.px(x, y, [0, 0, 0, 0]);
    s.innerShade(P.UI_VELLUM[1], 1, [[0, -1], [-1, 0]]);
    s.innerShade(P.UI_VELLUM[4], 1, [[0, 1], [1, 0]]);
    s.outline(INK, true);
    if (on) {
      const pts: Array<[number, number]> = [[2, 4], [3, 5], [4, 6], [5, 4], [6, 3], [7, 2]];
      for (const [x, y] of pts) { s.px(x, y, P.UI_BRASS[3]); s.px(x, y + 1, P.UI_BRASS[0]); }
    }
    return s;
  };
  b.add('ui/checkbox_on', box(true));
  b.add('ui/checkbox_off', box(false));

  // Bullet: a brass lozenge, the smallest piece of hardware in the game.
  const bullet = new Surface(5, 5);
  for (let k = 0; k < 3; k++) for (let i = -k; i <= k; i++) {
    bullet.px(2 + i, 2 - (2 - k), P.UI_BRASS[3]);
    bullet.px(2 + i, 2 + (2 - k), P.UI_BRASS[1]);
  }
  bullet.px(1, 1, P.UI_BRASS[4]);
  bullet.outline(INK);
  b.add('ui/bullet', bullet);

  // Page corner: the bottom-right of a page, turned up.
  const corner = new Surface(11, 11);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
    if (x + y < 10) continue;
    corner.px(x, y, P.UI_VELLUM[2]);
  }
  for (let k = 0; k <= 10; k++) {
    corner.px(10 - k, k, INK);
    if (k > 0) corner.px(10 - k, k + 1, P.UI_VELLUM[4]);
  }
  corner.innerShade(P.UI_VELLUM[0], 1, [[0, 1], [1, 0]]);
  b.add('ui/page_corner', corner);
}

// ───────────────────────────────────────────────────────────────────────────
//  6. Insight card — the reward moment. This is the only place in the whole
//     interface allowed to be ornate.
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
        const at = (x: number, y: number, c: string) => s.px(fx === 1 ? 11 - x : x, fy === 1 ? 11 - y : y, c);
        for (let k = 0; k < 5; k++) at(3 + k, 3, P.UI_GOLD[2]);
        for (let k = 0; k < 5; k++) at(3, 3 + k, P.UI_GOLD[2]);
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
      // Beaded top and bottom rails.
      if (name === 't' || name === 'b') {
        const y = name === 't' ? 3 : 8;
        for (let x = 0; x < 12; x += 3) { s.px(x, y, P.UI_GOLD[3]); s.px(x + 1, y, P.UI_GOLD[1]); }
      }
      // Faint rays behind the heading area, repeating so the edge tiles.
      if (name === 't') {
        for (let x = 0; x < 12; x++) {
          for (let y = 5; y < 12; y++) {
            const d = Math.abs(((x + y * 2) % 12) - 6);
            if (d < 1.2) s.px(x, y, P.UI_GOLD[4], 0.16);
          }
        }
      }
    },
  });

  // The seal: poured wax, pressed with the Vale's spiral.
  const seal = new Surface(17, 17);
  seal.ellipse(1, 1, 15, 15, P.ROOF_RED[2]);
  // Scalloped rim.
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * Math.PI * 2;
    seal.ellipse(Math.round(8 + Math.cos(t) * 7) - 1, Math.round(8 + Math.sin(t) * 7) - 1, 3, 3, P.ROOF_RED[2]);
  }
  seal.innerShade(P.ROOF_RED[0], 1, [[0, 1], [1, 0]]);
  seal.innerShade(P.ROOF_RED[4], 1, [[0, -1], [-1, 0]]);
  // Pressed spiral, cut into the wax.
  const spiral: Array<[number, number]> = [];
  for (let i = 0; i <= 34; i++) {
    const t = i / 34;
    const a = t * Math.PI * 3.2;
    const r = 1 + t * 4.2;
    spiral.push([Math.round(8 + Math.cos(a) * r), Math.round(8 + Math.sin(a) * r)]);
  }
  for (const [x, y] of spiral) { seal.pxOver(x, y, P.ROOF_RED[0]); seal.pxOver(x, y - 1, P.ROOF_RED[4], 0.6); }
  seal.outline(INK, true);
  b.add('ui/insight_seal', seal);

  // Rays behind the seal: four frames, slowly turning.
  const rays: Surface[] = [];
  for (let f = 0; f < 4; f++) {
    const s = new Surface(37, 37);
    const cx = 18, cy = 18;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + (f / 4) * (Math.PI / 6);
      const long = i % 2 === 0;
      const len = long ? 17 : 11;
      for (let r = 6; r < len; r++) {
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r);
        const fade = 1 - (r - 6) / (len - 6);
        s.px(x, y, long ? P.UI_GOLD[4] : P.UI_GOLD[3], 0.16 + fade * 0.5);
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
    const s = new Surface(13, 13);
    const rim = kind === 'empty' ? P.UI_VELLUM : kind === 'filled' ? P.UI_BRASS : P.UI_HEART;
    s.ellipse(0, 0, 13, 13, rim[2]);
    s.innerShade(rim[0], 1, [[0, 1], [1, 0]]);
    s.innerShade(rim[4], 1, [[0, -1], [-1, 0]]);
    punch(s, 3, 3, 7, 7);
    s.outline(INK, true);
    if (kind === 'empty') {
      // A dashed inner edge: the slot is waiting for something.
      for (let i = 0; i < 12; i += 2) {
        const t = (i / 12) * Math.PI * 2;
        s.px(Math.round(6 + Math.cos(t) * 3), Math.round(6 + Math.sin(t) * 3), P.UI_VELLUM[1], 0.8);
      }
    } else if (kind === 'filled') {
      s.ellipse(4, 4, 5, 5, P.ECHO_CYAN[2]);
      s.px(5, 5, P.ECHO_CYAN[4]);
      s.px(7, 7, P.ECHO_CYAN[0]);
    } else {
      for (let k = 0; k < 4; k++) {
        s.px(4 + k, 4 + k, P.UI_HEART[4]);
        s.px(7 - k, 4 + k, P.UI_HEART[4]);
      }
    }
    return s;
  };
  b.add('ui/thread_node_empty', node('empty'));
  b.add('ui/thread_node_filled', node('filled'));
  b.add('ui/thread_node_wrong', node('wrong'));

  // Connector: a dashed run with a pulse travelling along it.
  const conn: Surface[] = [];
  for (let f = 0; f < 3; f++) {
    const s = new Surface(14, 7);
    for (let x = 0; x < 11; x++) {
      if (x % 3 === 2) continue;
      s.px(x, 3, P.UI_VELLUM[1]);
      s.px(x, 4, P.UI_VELLUM[0], 0.5);
    }
    for (let k = 0; k < 3; k++) {
      const x = (f * 4 + k) % 12;
      s.px(x, 3, P.ECHO_CYAN[3]);
      s.px(x, 2, P.ECHO_CYAN[4], 0.4);
    }
    s.px(11, 3, P.UI_VELLUM[1]);
    s.px(10, 2, P.UI_VELLUM[1]); s.px(10, 4, P.UI_VELLUM[1]);
    s.px(9, 1, P.UI_VELLUM[1]); s.px(9, 5, P.UI_VELLUM[1]);
    conn.push(s);
  }
  b.addStrip('ui/thread_connector', conn, { key: 'ui_thread_flow', frameRate: 8, repeat: -1 });

  // Brass push-pin for holding a clue card down.
  const pin = new Surface(9, 12);
  pin.ellipse(1, 0, 7, 7, P.UI_BRASS[2]);
  pin.innerShade(P.UI_BRASS[0], 1, [[0, 1], [1, 0]]);
  pin.px(3, 2, P.UI_BRASS[4]);
  pin.px(2, 2, P.UI_BRASS[4]);
  pin.vline(4, 6, 5, P.UI_KEY[3]);
  pin.px(4, 10, P.UI_KEY[1]);
  pin.outline(INK, true);
  pin.ellipse(2, 10, 6, 2, INK, 0.28);
  b.add('ui/clue_pin', pin);

  // Timeline track: rounded caps left and right, a tiling middle with ticks.
  const bar = (kind: 'l' | 'm' | 'r') => {
    const s = new Surface(8, 9);
    const x0 = kind === 'l' ? 1 : 0;
    const w = kind === 'm' ? 8 : 7;
    s.rect(x0, 1, w, 7, P.UI_VELLUM[1]);
    s.hline(x0, 1, w, P.UI_VELLUM[0]);
    s.rect(x0, 3, w, 3, P.UI_PANEL[2]);
    s.hline(x0, 7, w, P.UI_VELLUM[3]);
    if (kind === 'l') { s.px(1, 1, [0, 0, 0, 0]); s.px(1, 7, [0, 0, 0, 0]); }
    if (kind === 'r') { s.px(6, 1, [0, 0, 0, 0]); s.px(6, 7, [0, 0, 0, 0]); }
    if (kind === 'm') { s.px(3, 2, P.UI_VELLUM[4]); s.px(3, 6, P.UI_VELLUM[0]); }
    s.outline(INK, true);
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
    const s = new Surface(13, 13);
    s.ellipse(0, 0, 13, 13, ramp[2]);
    s.innerShade(ramp[0], 1, [[0, 1], [1, 0]]);
    s.innerShade(ramp[4], 1, [[0, -1], [-1, 0]]);
    s.outline(INK, true);
    const xs = pips === 1 ? [6] : pips === 2 ? [4, 8] : [3, 6, 9];
    for (const x of xs) {
      s.rect(x - 1, 5, 2, 3, INK);
      s.px(x - 1, 5, ramp[4]);
    }
    b.add(`ui/vote_marker_${key}`, s);
  }

  // Confidence meter: a groove with a brass fill. Three pieces each so the
  // runtime can stretch it to any width.
  const track = (kind: 'l' | 'm' | 'r', filled: boolean) => {
    const s = new Surface(6, 9);
    const ramp = filled ? P.UI_BRASS : P.UI_PANEL;
    const fi = filled ? 2 : 1;
    s.rect(0, 1, 6, 7, ramp[fi]);
    s.hline(0, 1, 6, filled ? P.UI_BRASS[4] : P.UI_PANEL[3]);
    s.hline(0, 7, 6, filled ? P.UI_BRASS[0] : P.UI_PANEL[0]);
    if (kind === 'l') { s.px(0, 1, [0, 0, 0, 0]); s.px(0, 7, [0, 0, 0, 0]); }
    if (kind === 'r') { s.px(5, 1, [0, 0, 0, 0]); s.px(5, 7, [0, 0, 0, 0]); }
    if (filled) for (let x = kind === 'l' ? 2 : 0; x < 6; x += 3) s.px(x, 4, P.UI_BRASS[4], 0.5);
    s.outline(INK, true);
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

function registerMisc(b: ArtBuild, body: BuiltFont): void {
  // Cursor.
  const cur = new Surface(9, 13);
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
  CURSOR.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') cur.px(x, y, P.UI_VELLUM[4]);
  });
  cur.innerShade(P.UI_VELLUM[2], 1, [[1, 0], [0, 1]]);
  cur.outline(INK, true);
  b.add('ui/cursor', cur);

  // Selection bracket: four corners that breathe in and out by a pixel.
  const sel: Surface[] = [];
  const inset = [2, 1, 0, 1];
  const tone = [P.UI_GOLD[4], P.UI_GOLD[3], P.UI_GOLD[2], P.UI_GOLD[3]];
  for (let f = 0; f < 4; f++) {
    const s = new Surface(20, 20);
    const i = inset[f];
    const c = tone[f];
    const arm = 5;
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const x0 = sx ? 19 - i : i;
      const y0 = sy ? 19 - i : i;
      const dx = sx ? -1 : 1;
      const dy = sy ? -1 : 1;
      for (let k = 0; k < arm; k++) {
        s.px(x0 + dx * k, y0, c);
        s.px(x0, y0 + dy * k, c);
        s.px(x0 + dx * k, y0 + dy, P.UI_GOLD[0], 0.6);
        s.px(x0 + dx, y0 + dy * k, P.UI_GOLD[0], 0.6);
      }
    }
    sel.push(s);
  }
  b.addStrip('ui/selector', sel, { key: 'ui_selector', frameRate: 8, repeat: -1 });

  // Keycap glyphs: ink marks meant to sit inside ui/key_prompt.
  const glyph = (w: number, h: number, draw: (s: Surface) => void) => {
    const s = new Surface(w, h);
    draw(s);
    return s;
  };
  const label = (text: string) => glyph(textWidth(body, text) - 1, 7, (s) => {
    drawText(s, body, 0, 0, text, INK);
  });
  b.add('ui/key_e', label('E'));
  b.add('ui/key_j', label('J'));
  b.add('ui/key_q', label('Q'));
  b.add('ui/key_esc', label('ESC'));
  b.add('ui/key_tab', label('TAB'));
  b.add('ui/key_wasd', label('WASD'));
  b.add('ui/key_shift', glyph(9, 9, (s) => {
    s.poly([[4, 0], [8, 4], [6, 4], [6, 9], [3, 9], [3, 4], [0, 4]], INK);
    s.px(4, 1, P.UI_KEY[4]);
  }));
  b.add('ui/key_space', glyph(17, 7, (s) => {
    s.hline(0, 5, 17, INK);
    s.vline(0, 2, 4, INK);
    s.vline(16, 2, 4, INK);
  }));

  // Map pin.
  const pin = new Surface(11, 15);
  pin.ellipse(1, 0, 9, 9, P.UI_GOLD[3]);
  pin.poly([[2, 7], [9, 7], [5, 14]], P.UI_GOLD[2]);
  pin.innerShade(P.UI_GOLD[0], 1, [[0, 1], [1, 0]]);
  pin.px(3, 2, P.UI_GOLD[4]);
  pin.ellipse(4, 3, 4, 4, P.UI_PANEL[1]);
  pin.outline(INK, true);
  pin.ellipse(2, 13, 7, 3, INK, 0.3);
  b.add('ui/objective_pin', pin);

  // Quest markers: gold "there is something here", green "that's done".
  const badge = (ramp: readonly string[], mark: 'new' | 'done') => {
    const s = new Surface(13, 15);
    s.poly([[6, 0], [12, 7], [6, 14], [0, 7]], ramp[2]);
    s.innerShade(ramp[0], 1, [[0, 1], [1, 0]]);
    s.innerShade(ramp[4], 1, [[0, -1], [-1, 0]]);
    s.outline(INK, true);
    if (mark === 'new') {
      s.rect(5, 3, 2, 6, INK);
      s.rect(5, 10, 2, 2, INK);
      s.px(5, 3, P.FONT_LIGHT);
    } else {
      for (const [x, y] of [[3, 7], [4, 8], [5, 9], [6, 8], [7, 6], [8, 5], [9, 4]] as const) {
        s.px(x, y, INK); s.px(x, y + 1, INK);
      }
      s.px(9, 4, P.FONT_LIGHT);
    }
    return s;
  };
  b.add('ui/quest_new', badge(P.UI_GOLD, 'new'));
  b.add('ui/quest_done', badge(P.UI_GOOD, 'done'));

  // A single white pixel the runtime stretches for fades and flashes.
  b.add('ui/fade_pixel', new Surface(1, 1, '#ffffff'));
}

// ───────────────────────────────────────────────────────────────────────────
//  10. Fonts + inspection sheets
//
//  build.ts wipes art_preview/ *after* the asset modules have run, so the font
//  specimen and the UI contact sheet are written from an exit hook. They are
//  the two sheets a critic actually needs, and per-sprite sheets are useless
//  for a 9-slice.
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
  const get = (n: string) => b.sprites.find((s) => s.name === `${base}_${n}`)!.s;
  const S = get('tl').w;
  const out = new Surface(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const cx = x < S ? -1 : x >= w - S ? 1 : 0;
      const cy = y < S ? -1 : y >= h - S ? 1 : 0;
      const name = SLICE[cy + 1][cx + 1];
      const sx = cx === -1 ? x : cx === 1 ? x - (w - S) : (x - S) % S;
      const sy = cy === -1 ? y : cy === 1 ? y - (h - S) : (y - S) % S;
      const c = get(name).get(sx, sy);
      if (c[3]) out.px(x, y, c);
    }
  }
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

  // Journal panel, left.
  s.blit(assemble(b, 'ui/panelDark', 190, 150), 8, 40);
  s.blit(assemble(b, 'ui/tab_active', 46, 16), 16, 28);
  s.blit(assemble(b, 'ui/tab_inactive', 46, 14), 64, 30);
  s.blit(assemble(b, 'ui/tab_inactive', 46, 14), 112, 30);
  drawTextCentered(s, body, 39, 33, 'MAP', P.UI_VELLUM[4]);
  drawTextCentered(s, body, 87, 34, 'PEOPLE', P.UI_VELLUM[2]);
  drawTextCentered(s, body, 135, 34, 'QUESTS', P.UI_VELLUM[2]);
  sprite('ui/divider', 20, 62);
  const rows = ['The Bell and the Cat', 'The Mixed-Up Delivery', 'The Lantern Trial'];
  rows.forEach((t, i) => {
    sprite(i === 0 ? 'ui/checkbox_on' : 'ui/checkbox_off', 18, 70 + i * 16);
    drawText(s, body, 31, 71 + i * 16, t, i === 0 ? P.UI_VELLUM[2] : P.UI_VELLUM[4]);
  });
  sprite('ui/bullet', 20, 122);
  drawText(s, body, 28, 120, 'Pip fears the bell.', P.UI_VELLUM[3]);
  sprite('ui/scroll_up', 180, 48);
  sprite('ui/scroll_down', 180, 172);
  sprite('ui/bookmark_0', 168, 34);

  // Insight card, right.
  s.blit(assemble(b, 'ui/insight_frame', 236, 128), 236, 34);
  sprite('ui/insight_ray_0', 335, 30);
  sprite('ui/insight_seal', 345, 40);
  drawTextCentered(s, display, 354, 66, 'INSIGHT', P.UI_GOLD[1]);
  drawTextCentered(s, display, 354, 84, 'CLASSICAL', P.UI_GOLD[2]);
  drawTextCentered(s, display, 354, 99, 'CONDITIONING', P.UI_GOLD[2]);
  drawTextCentered(s, body, 354, 120, 'When one stimulus keeps predicting', P.UI_INK);
  drawTextCentered(s, body, 354, 132, 'another, the first begins to', P.UI_INK);
  drawTextCentered(s, body, 354, 144, 'produce the learned response.', P.UI_INK);

  // HUD.
  for (let i = 0; i < 3; i++) sprite(i === 2 ? 'ui/heart_half' : 'ui/heart_full', 8 + i * 12, 8);
  sprite('ui/heart_empty', 44, 8);
  const ic = ['observe', 'link', 'recall', 'dissent'];
  ic.forEach((n, i) => sprite(`ui/icon_${n}${i > 1 ? '_dim' : ''}`, 380 + i * 20, 6);
  );

  // Dialogue.
  s.blit(assemble(b, 'ui/dialogue', 400, 58), 40, 200);
  sprite('ui/dialogue_tail_l', 80, 194);
  s.blit(assemble(b, 'ui/name_tag', 46, 14), 48, 190);
  drawTextCentered(s, body, 71, 193, 'SERA', P.UI_GOLD[3]);
  drawText(s, body, 52, 212, 'The bell wasn’t frightening him.', P.UI_INK);
  drawText(s, body, 52, 224, 'Somewhere along the way he learned what it', P.UI_INK);
  drawText(s, body, 52, 236, 'meant — and now he braces every time.', P.UI_INK);
  sprite('ui/advance_arrow_0', 424, 238);

  // Key prompt strip.
  s.blit(assemble(b, 'ui/key_prompt', 15, 13), 300, 250);
  sprite('ui/key_e', 305, 253);
  drawText(s, body, 318, 252, 'talk', P.FONT_LIGHT);
  s.blit(assemble(b, 'ui/key_prompt', 27, 13), 348, 250);
  sprite('ui/key_esc', 353, 253);
  drawText(s, body, 378, 252, 'back', P.FONT_LIGHT);

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

  // Fonts go straight into public/assets — they are not atlas frames, Phaser
  // loads them as their own texture + XML pair.
  writeFont(ASSETS, BODY);
  writeFont(ASSETS, DISPLAY);

  process.on('exit', () => {
    try {
      writePNG(join(PREVIEW, 'font_specimen.png'), buildSpecimen(body, display));
      writePNG(join(PREVIEW, 'font_ingame.png'), buildInGameMock(body, display));
      writePNG(join(PREVIEW, 'ui_sheet_4x.png'), uiContactSheet(b, 4, '#161327'));
      writePNG(join(PREVIEW, 'ui_sheet_1x.png'), uiContactSheet(b, 1, '#161327'));
      writePNG(join(PREVIEW, 'ui_mock_1x.png'), uiMock(b, body, display));
    } catch { /* never let an inspection sheet break the build */ }
  });
}
