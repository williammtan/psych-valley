/**
 * PROJECT PSYCHE — BITMAP FONTS
 *
 * Two original faces, authored as pixel data in this file and emitted as
 * Angel-Code (BMFont) PNG + XML pairs that Phaser's `load.bitmapFont` eats.
 *
 *   font_body     cap 7, true lowercase with descenders, 1 px stroke.
 *                 Carries every line of dialogue. Proportional, per-glyph
 *                 advance, hand-kerned in the few places it matters.
 *   font_display  cap 11, uppercase-focused slab. Free stem terminals flare
 *                 1 px inward at the cap line and the baseline — that wedge is
 *                 the whole personality of the face. 1 px inner highlight.
 *                 Location banner, insight headings, concept names, title.
 *
 * ── How the data works ──────────────────────────────────────────────────────
 * Every glyph is an array of strings, one string per pixel row, top-aligned to
 * the top of the line box. '#' is ink, '.' is nothing. Trailing empty rows may
 * be omitted; leading empty rows may NOT (they are what puts lowercase on the
 * x-height). All rows of one glyph must be the same length — `buildFont`
 * throws if they are not, which catches typos before they reach the atlas.
 *
 *   row 0 .............. top of the line box = cap line
 *   row baseline-1 ..... last row above the baseline
 *   rows baseline.. .... descenders
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 * Glyphs are drawn in light neutrals (P.FONT_*) so the runtime can multiply-
 * tint them to ink, gold, violet or whatever the moment needs. The display
 * face gets a 1 px highlight along its upper-left inner edge; because the two
 * neutrals are close together the bevel survives tinting without banding.
 */
import { Surface } from './pixel.js';
import { encodePNG } from './png.js';
import { hex } from './palette.js';
import * as P from './palette.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export type Glyph = readonly string[];

export interface FontSpec {
  /** File stem: font_body -> font_body.png / font_body.xml */
  name: string;
  /** Rows in one glyph cell (cap rows + descender rows). */
  cellRows: number;
  /** Rows from the top of the cell down to the baseline. */
  baseline: number;
  /** Distance between successive baselines. */
  lineHeight: number;
  /** Blank columns inserted after every glyph. */
  tracking: number;
  /** Advance of U+0020. */
  spaceAdvance: number;
  ink: string;
  /** If set, the upper-left inner edge of every glyph is painted with this. */
  bevel?: string;
  glyphs: Record<string, Glyph>;
  /** Per-glyph advance overrides (default: ink width + tracking). */
  advance?: Record<string, number>;
  /** Pairs 'AV' -> -1. Applied when the second char follows the first. */
  kerning?: Record<string, number>;
  /** Extra codepoints that reuse another glyph's pixels (e.g. a-z -> A-Z). */
  alias?: Record<string, string>;
}

// ───────────────────────────────────────────────────────────────────────────
//  BODY FACE — cap 7, x-height 5, descender 2. Cell 9 rows, baseline at 7.
//
//  Design notes: humanist skeleton, flat-ish terminals, wide counters. The
//  letters that usually collapse at 1x are given deliberate escape hatches —
//  'l' has a top-left flag and a bottom-right tail so it never reads as 'I'
//  or '1', 'r' keeps a full-width arm so "rn" never closes into "m", and 'e'
//  carries its crossbar one pixel above the middle so the eye stays open.
// ───────────────────────────────────────────────────────────────────────────

const BODY_GLYPHS: Record<string, Glyph> = {
  A: ['.###.',
      '#...#',
      '#...#',
      '#####',
      '#...#',
      '#...#',
      '#...#'],
  B: ['####.',
      '#...#',
      '#...#',
      '####.',
      '#...#',
      '#...#',
      '####.'],
  C: ['.###.',
      '#...#',
      '#....',
      '#....',
      '#....',
      '#...#',
      '.###.'],
  D: ['####.',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '####.'],
  E: ['#####',
      '#....',
      '#....',
      '####.',
      '#....',
      '#....',
      '#####'],
  F: ['#####',
      '#....',
      '#....',
      '####.',
      '#....',
      '#....',
      '#....'],
  G: ['.###.',
      '#...#',
      '#....',
      '#.###',
      '#...#',
      '#...#',
      '.###.'],
  H: ['#...#',
      '#...#',
      '#...#',
      '#####',
      '#...#',
      '#...#',
      '#...#'],
  I: ['###',
      '.#.',
      '.#.',
      '.#.',
      '.#.',
      '.#.',
      '###'],
  J: ['...#',
      '...#',
      '...#',
      '...#',
      '...#',
      '#..#',
      '.##.'],
  K: ['#...#',
      '#..#.',
      '#.#..',
      '##...',
      '#.#..',
      '#..#.',
      '#...#'],
  L: ['#...',
      '#...',
      '#...',
      '#...',
      '#...',
      '#...',
      '####'],
  M: ['#...#',
      '##.##',
      '#.#.#',
      '#.#.#',
      '#...#',
      '#...#',
      '#...#'],
  N: ['#...#',
      '##..#',
      '##..#',
      '#.#.#',
      '#..##',
      '#..##',
      '#...#'],
  O: ['.###.',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '.###.'],
  P: ['####.',
      '#...#',
      '#...#',
      '####.',
      '#....',
      '#....',
      '#....'],
  Q: ['.###.',
      '#...#',
      '#...#',
      '#...#',
      '#.#.#',
      '#..#.',
      '.##.#'],
  R: ['####.',
      '#...#',
      '#...#',
      '####.',
      '#.#..',
      '#..#.',
      '#...#'],
  S: ['.####',
      '#....',
      '#....',
      '.###.',
      '....#',
      '....#',
      '####.'],
  T: ['#####',
      '..#..',
      '..#..',
      '..#..',
      '..#..',
      '..#..',
      '..#..'],
  U: ['#...#',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '.###.'],
  V: ['#...#',
      '#...#',
      '#...#',
      '#...#',
      '#...#',
      '.#.#.',
      '..#..'],
  W: ['#...#',
      '#...#',
      '#...#',
      '#...#',
      '#.#.#',
      '##.##',
      '.#.#.'],
  X: ['#...#',
      '#...#',
      '.#.#.',
      '..#..',
      '.#.#.',
      '#...#',
      '#...#'],
  Y: ['#...#',
      '#...#',
      '.#.#.',
      '..#..',
      '..#..',
      '..#..',
      '..#..'],
  Z: ['#####',
      '....#',
      '...#.',
      '..#..',
      '.#...',
      '#....',
      '#####'],

  a: ['....',
      '....',
      '.##.',
      '...#',
      '.###',
      '#..#',
      '.###'],
  b: ['#...',
      '#...',
      '###.',
      '#..#',
      '#..#',
      '#..#',
      '###.'],
  c: ['....',
      '....',
      '.###',
      '#...',
      '#...',
      '#...',
      '.###'],
  d: ['...#',
      '...#',
      '.###',
      '#..#',
      '#..#',
      '#..#',
      '.###'],
  e: ['....',
      '....',
      '.##.',
      '#..#',
      '####',
      '#...',
      '.###'],
  f: ['.##',
      '.#.',
      '###',
      '.#.',
      '.#.',
      '.#.',
      '.#.'],
  g: ['....',
      '....',
      '.###',
      '#..#',
      '#..#',
      '#..#',
      '.###',
      '...#',
      '###.'],
  h: ['#...',
      '#...',
      '###.',
      '#..#',
      '#..#',
      '#..#',
      '#..#'],
  i: ['#',
      '.',
      '#',
      '#',
      '#',
      '#',
      '#'],
  j: ['..#',
      '...',
      '..#',
      '..#',
      '..#',
      '..#',
      '..#',
      '..#',
      '##.'],
  k: ['#...',
      '#...',
      '#..#',
      '#.#.',
      '##..',
      '#.#.',
      '#..#'],
  l: ['#.',
      '#.',
      '#.',
      '#.',
      '#.',
      '#.',
      '##'],
  m: ['.....',
      '.....',
      '#####',
      '#.#.#',
      '#.#.#',
      '#.#.#',
      '#.#.#'],
  n: ['....',
      '....',
      '###.',
      '#..#',
      '#..#',
      '#..#',
      '#..#'],
  o: ['....',
      '....',
      '.##.',
      '#..#',
      '#..#',
      '#..#',
      '.##.'],
  p: ['....',
      '....',
      '###.',
      '#..#',
      '#..#',
      '#..#',
      '###.',
      '#...',
      '#...'],
  q: ['....',
      '....',
      '.###',
      '#..#',
      '#..#',
      '#..#',
      '.###',
      '...#',
      '...#'],
  r: ['...',
      '...',
      '###',
      '#..',
      '#..',
      '#..',
      '#..'],
  s: ['....',
      '....',
      '.###',
      '#...',
      '.##.',
      '...#',
      '###.'],
  t: ['...',
      '.#.',
      '###',
      '.#.',
      '.#.',
      '.#.',
      '.##'],
  u: ['....',
      '....',
      '#..#',
      '#..#',
      '#..#',
      '#..#',
      '.###'],
  v: ['.....',
      '.....',
      '#...#',
      '#...#',
      '.#.#.',
      '.#.#.',
      '..#..'],
  w: ['.....',
      '.....',
      '#...#',
      '#...#',
      '#.#.#',
      '#.#.#',
      '.#.#.'],
  x: ['.....',
      '.....',
      '#...#',
      '.#.#.',
      '..#..',
      '.#.#.',
      '#...#'],
  y: ['....',
      '....',
      '#..#',
      '#..#',
      '#..#',
      '#..#',
      '.###',
      '...#',
      '###.'],
  z: ['....',
      '....',
      '####',
      '...#',
      '..#.',
      '.#..',
      '####'],

  '0': ['.###.',
        '#...#',
        '#..##',
        '#.#.#',
        '##..#',
        '#...#',
        '.###.'],
  '1': ['..#..',
        '.##..',
        '..#..',
        '..#..',
        '..#..',
        '..#..',
        '.###.'],
  '2': ['.###.',
        '#...#',
        '....#',
        '...#.',
        '..#..',
        '.#...',
        '#####'],
  '3': ['####.',
        '....#',
        '....#',
        '.###.',
        '....#',
        '....#',
        '####.'],
  '4': ['...#.',
        '..##.',
        '.#.#.',
        '#..#.',
        '#####',
        '...#.',
        '...#.'],
  '5': ['#####',
        '#....',
        '####.',
        '....#',
        '....#',
        '#...#',
        '.###.'],
  '6': ['..##.',
        '.#...',
        '#....',
        '####.',
        '#...#',
        '#...#',
        '.###.'],
  '7': ['#####',
        '....#',
        '...#.',
        '..#..',
        '..#..',
        '.#...',
        '.#...'],
  '8': ['.###.',
        '#...#',
        '#...#',
        '.###.',
        '#...#',
        '#...#',
        '.###.'],
  '9': ['.###.',
        '#...#',
        '#...#',
        '.####',
        '....#',
        '...#.',
        '.##..'],

  ' ': [],
  '!': ['#',
        '#',
        '#',
        '#',
        '#',
        '.',
        '#'],
  '"': ['#.#',
        '#.#'],
  "'": ['#',
        '#'],
  '(': ['.#',
        '#.',
        '#.',
        '#.',
        '#.',
        '#.',
        '#.',
        '.#'],
  ')': ['#.',
        '.#',
        '.#',
        '.#',
        '.#',
        '.#',
        '.#',
        '#.'],
  ',': ['..',
        '..',
        '..',
        '..',
        '..',
        '..',
        '.#',
        '#.'],
  '-': ['...',
        '...',
        '...',
        '...',
        '###'],
  '.': ['.',
        '.',
        '.',
        '.',
        '.',
        '.',
        '#'],
  ':': ['.',
        '.',
        '.',
        '#',
        '.',
        '.',
        '#'],
  ';': ['..',
        '..',
        '..',
        '.#',
        '..',
        '..',
        '.#',
        '#.'],
  '?': ['.##.',
        '#..#',
        '...#',
        '..#.',
        '.#..',
        '....',
        '.#..'],
  '/': ['...#',
        '..#.',
        '..#.',
        '.#..',
        '.#..',
        '#...',
        '#...'],
  '&': ['.##..',
        '#..#.',
        '#..#.',
        '.##..',
        '#..##',
        '#..#.',
        '.##.#'],
  '%': ['##...',
        '##..#',
        '...#.',
        '..#..',
        '.#...',
        '#..##',
        '...##'],
  '+': ['.....',
        '.....',
        '..#..',
        '..#..',
        '#####',
        '..#..',
        '..#..'],
  '*': ['..#..',
        '#.#.#',
        '.###.',
        '#.#.#',
        '..#..'],
  '<': ['...',
        '...',
        '..#',
        '.#.',
        '#..',
        '.#.',
        '..#'],
  '>': ['...',
        '...',
        '#..',
        '.#.',
        '..#',
        '.#.',
        '#..'],
  '[': ['##',
        '#.',
        '#.',
        '#.',
        '#.',
        '#.',
        '#.',
        '##'],
  ']': ['##',
        '.#',
        '.#',
        '.#',
        '.#',
        '.#',
        '.#',
        '##'],
  '#': ['.....',
        '.....',
        '.#.#.',
        '#####',
        '.#.#.',
        '#####',
        '.#.#.'],
  '@': ['.###.',
        '#...#',
        '#.##.',
        '#.#.#',
        '#.##.',
        '#....',
        '.###.'],
  '…': ['.....',   // …
             '.....',
             '.....',
             '.....',
             '.....',
             '.....',
             '#.#.#'],
  '—': ['......',  // —
             '......',
             '......',
             '......',
             '######'],
  '’': ['.#',      // ’
             '#.'],
  '“': ['.#.#',    // “
             '#.#.'],
  '”': ['#.#.',    // ”
             '.#.#'],
};

export const BODY: FontSpec = {
  name: 'font_body',
  cellRows: 9,
  baseline: 7,
  lineHeight: 12,
  tracking: 1,
  spaceAdvance: 3,
  ink: P.FONT_LIGHT,
  glyphs: BODY_GLYPHS,
  advance: {
    ' ': 3,
    'i': 2,
    'j': 4,
    'l': 3,
    'f': 4,
    't': 4,
    '.': 2,
    ',': 3,
    ':': 2,
    ';': 3,
    '!': 2,
    "'": 2,
    '’': 3,
  },
  // Only where the gap genuinely opens up. Over-kerning a 5 px face turns a
  // sentence into a rhythm problem, so this list stays short on purpose.
  kerning: {
    'Ta': -1, 'Te': -1, 'To': -1, 'Tr': -1, 'Tu': -1, 'Tw': -1, 'Ty': -1,
    'Ya': -1, 'Yo': -1, 'Ve': -1, 'Vo': -1, 'Wa': -1,
    'r.': -1, 'r,': -1, 'v.': -1, 'w.': -1, 'y.': -1, 'y,': -1,
    'P.': -1, 'F.': -1, 'L’': -1,
  },
};

// ───────────────────────────────────────────────────────────────────────────
//  DISPLAY FACE — cap 11, 2 px stems, flat-cut (wedged) corners on the round
//  letters, 2 px bars. Cell 13 rows, baseline at 11 so Q/,/; can descend.
//
//  The bevel is generated, not authored: every ink pixel whose upper or left
//  neighbour is empty takes FONT_HI. On a 2 px stem that lights the left
//  column and the top cap — an inner highlight that survives a runtime tint.
// ───────────────────────────────────────────────────────────────────────────

const DISPLAY_GLYPHS: Record<string, Glyph> = {
  A: ['...###...',
      '..##.##..',
      '..##.##..',
      '.##...##.',
      '.##...##.',
      '.##...##.',
      '.#######.',
      '.##...##.',
      '##.....##',
      '##.....##',
      '###...###'],
  B: ['######..',
      '##...##.',
      '##...##.',
      '##...##.',
      '##..##..',
      '######..',
      '##...##.',
      '##....##',
      '##....##',
      '##...##.',
      '######..'],
  C: ['.######.',
      '##....##',
      '##....##',
      '##......',
      '##......',
      '##......',
      '##......',
      '##......',
      '##....##',
      '##....##',
      '.######.'],
  D: ['######..',
      '##...##.',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##...##.',
      '######..'],
  E: ['########',
      '########',
      '##.....#',
      '##......',
      '##......',
      '######..',
      '######..',
      '##......',
      '##.....#',
      '########',
      '########'],
  F: ['########',
      '########',
      '##.....#',
      '##......',
      '##......',
      '######..',
      '######..',
      '##......',
      '##......',
      '##......',
      '###.....'],
  G: ['.######.',
      '##....##',
      '##....##',
      '##......',
      '##......',
      '##..####',
      '##..####',
      '##....##',
      '##....##',
      '##....##',
      '.######.'],
  H: ['###..###',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '########',
      '########',
      '##....##',
      '##....##',
      '##....##',
      '###..###'],
  I: ['######',
      '######',
      '..##..',
      '..##..',
      '..##..',
      '..##..',
      '..##..',
      '..##..',
      '..##..',
      '######',
      '######'],
  J: ['....###',
      '.....##',
      '.....##',
      '.....##',
      '.....##',
      '.....##',
      '.....##',
      '.....##',
      '##...##',
      '##...##',
      '.#####.'],
  K: ['###..##.',
      '##..##..',
      '##.##...',
      '##.##...',
      '####....',
      '###.....',
      '####....',
      '##.##...',
      '##..##..',
      '##...##.',
      '###...##'],
  L: ['###....',
      '##.....',
      '##.....',
      '##.....',
      '##.....',
      '##.....',
      '##.....',
      '##.....',
      '##.....',
      '#######',
      '#######'],
  M: ['##.......##',
      '###.....###',
      '####...####',
      '##.##.##.##',
      '##..###..##',
      '##...#...##',
      '##.......##',
      '##.......##',
      '##.......##',
      '##.......##',
      '###.....###'],
  N: ['##....###',
      '###....##',
      '###....##',
      '####...##',
      '##.##..##',
      '##..##.##',
      '##...####',
      '##....###',
      '##....###',
      '##.....##',
      '###....##'],
  O: ['.######.',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '.######.'],
  P: ['######..',
      '##...##.',
      '##....##',
      '##....##',
      '##....##',
      '##...##.',
      '######..',
      '##......',
      '##......',
      '##......',
      '###.....'],
  Q: ['.######..',
      '##....##.',
      '##....##.',
      '##....##.',
      '##....##.',
      '##....##.',
      '##....##.',
      '##....##.',
      '##....##.',
      '##....##.',
      '.######..',
      '....###..',
      '.....###.'],
  R: ['######...',
      '##...##..',
      '##....##.',
      '##....##.',
      '##...##..',
      '######...',
      '##.##....',
      '##..##...',
      '##..##...',
      '##...##..',
      '###...##.'],
  S: ['.######.',
      '##....##',
      '##......',
      '##......',
      '.#####..',
      '..#####.',
      '......##',
      '......##',
      '##....##',
      '##....##',
      '.######.'],
  T: ['########',
      '########',
      '#..##..#',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '..####..'],
  U: ['###..###',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '##....##',
      '.######.'],
  V: ['##....##',
      '##....##',
      '##....##',
      '.##..##.',
      '.##..##.',
      '.##..##.',
      '.##..##.',
      '..####..',
      '..####..',
      '...##...',
      '...##...'],
  W: ['##..###..##',
      '##..###..##',
      '##.##.##.##',
      '##.##.##.##',
      '##.##.##.##',
      '##.##.##.##',
      '##.##.##.##',
      '##.##.##.##',
      '####...####',
      '####...####',
      '####...####'],
  X: ['##....##',
      '##....##',
      '.##..##.',
      '.##..##.',
      '..####..',
      '..####..',
      '.##..##.',
      '.##..##.',
      '##....##',
      '##....##',
      '##....##'],
  Y: ['##....##',
      '##....##',
      '.##..##.',
      '.##..##.',
      '..####..',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '...##...',
      '..####..'],
  Z: ['########',
      '########',
      '.....##.',
      '....##..',
      '....##..',
      '...##...',
      '..##....',
      '..##....',
      '.##.....',
      '########',
      '########'],

  '0': ['.#####.',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '.#####.'],
  '1': ['..###..',
        '.####..',
        '##.##..',
        '...##..',
        '...##..',
        '...##..',
        '...##..',
        '...##..',
        '...##..',
        '#######',
        '#######'],
  '2': ['.#####.',
        '##...##',
        '##...##',
        '.....##',
        '....##.',
        '...##..',
        '..##...',
        '.##....',
        '##.....',
        '#######',
        '#######'],
  '3': ['.#####.',
        '##...##',
        '.....##',
        '....##.',
        '..####.',
        '..####.',
        '....##.',
        '.....##',
        '##...##',
        '##...##',
        '.#####.'],
  '4': ['....##.',
        '...###.',
        '..#.##.',
        '.##.##.',
        '##..##.',
        '##..##.',
        '#######',
        '#######',
        '....##.',
        '....##.',
        '....##.'],
  '5': ['#######',
        '#######',
        '##.....',
        '##.....',
        '######.',
        '##..###',
        '.....##',
        '.....##',
        '##...##',
        '##...##',
        '.#####.'],
  '6': ['..####.',
        '.##..##',
        '##.....',
        '##.....',
        '##.....',
        '######.',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '.#####.'],
  '7': ['#######',
        '#######',
        '.....##',
        '....##.',
        '....##.',
        '...##..',
        '...##..',
        '..##...',
        '..##...',
        '.##....',
        '.##....'],
  '8': ['.#####.',
        '##...##',
        '##...##',
        '##...##',
        '.#####.',
        '.#####.',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '.#####.'],
  '9': ['.#####.',
        '##...##',
        '##...##',
        '##...##',
        '##...##',
        '.######',
        '.....##',
        '.....##',
        '.....##',
        '##...##',
        '.#####.'],

  ' ': [],
  '!': ['##',
        '##',
        '##',
        '##',
        '##',
        '##',
        '##',
        '##',
        '..',
        '##',
        '##'],
  '?': ['.#####.',
        '##...##',
        '##...##',
        '.....##',
        '....##.',
        '...##..',
        '...##..',
        '.......',
        '.......',
        '...##..',
        '...##..'],
  '.': ['..',
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        '##',
        '##'],
  ',': ['...',
        '...',
        '...',
        '...',
        '...',
        '...',
        '...',
        '...',
        '...',
        '##.',
        '##.',
        '##.',
        '#..'],
  ':': ['..',
        '..',
        '..',
        '##',
        '##',
        '..',
        '..',
        '..',
        '..',
        '##',
        '##'],
  ';': ['...',
        '...',
        '...',
        '##.',
        '##.',
        '...',
        '...',
        '...',
        '...',
        '##.',
        '##.',
        '##.',
        '#..'],
  "'": ['##',
        '##',
        '##'],
  '"': ['##.##',
        '##.##',
        '##.##'],
  '-': ['.....',
        '.....',
        '.....',
        '.....',
        '.....',
        '#####',
        '#####'],
  '(': ['..##',
        '.##.',
        '##..',
        '##..',
        '##..',
        '##..',
        '##..',
        '##..',
        '##..',
        '.##.',
        '..##'],
  ')': ['##..',
        '.##.',
        '..##',
        '..##',
        '..##',
        '..##',
        '..##',
        '..##',
        '..##',
        '.##.',
        '##..'],
  '/': ['....##',
        '....##',
        '...##.',
        '...##.',
        '..##..',
        '..##..',
        '.##...',
        '.##...',
        '##....',
        '##....',
        '##....'],
  '—': ['.........',  // —
             '.........',
             '.........',
             '.........',
             '.........',
             '#########',
             '#########'],
  '…': ['........',   // …
             '........',
             '........',
             '........',
             '........',
             '........',
             '........',
             '........',
             '........',
             '##.##.##',
             '##.##.##'],
  '’': ['.##',        // ’
             '.##',
             '#..'],
};

export const DISPLAY: FontSpec = {
  name: 'font_display',
  cellRows: 13,
  baseline: 11,
  lineHeight: 15,
  tracking: 2,
  spaceAdvance: 5,
  ink: P.FONT_MID,
  bevel: P.FONT_LIGHT,
  glyphs: DISPLAY_GLYPHS,
  advance: {
    ' ': 5,
    '!': 4,
    '.': 4,
    ',': 4,
    ':': 4,
    ';': 4,
    "'": 4,
  },
  // Flat-sided caps need very little, but the diagonals leave holes you can
  // park a cart in at cap 11.
  kerning: {
    'AT': -2, 'AV': -2, 'AW': -2, 'AY': -2, 'AC': -1, 'AG': -1, 'AO': -1,
    'TA': -2, 'VA': -2, 'WA': -2, 'YA': -2, 'LT': -2, 'LV': -2, 'LW': -2,
    'LY': -2, 'PA': -1, 'FA': -1, 'RA': -1, 'AJ': -1,
    'T.': -2, 'V.': -2, 'W.': -2, 'Y.': -2, 'F.': -2, 'P.': -2, 'L.': -1,
    'T,': -2, 'V,': -2, 'Y,': -2,
    'OA': -1, 'CA': -1, 'GA': -1, 'TO': -1, 'TE': -1, 'TU': -1, 'TS': -1,
  },
  // The display face is uppercase-only, but nothing stops a writer typing a
  // lowercase string into a banner. Point a-z at the caps so it still renders.
  alias: Object.fromEntries(
    'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => [c, c.toUpperCase()]),
  ),
};

// ───────────────────────────────────────────────────────────────────────────
//  Build
// ───────────────────────────────────────────────────────────────────────────

export interface PackedChar {
  char: string;
  code: number;
  x: number;
  y: number;
  w: number;
  h: number;
  xoff: number;
  yoff: number;
  xadv: number;
}

export interface BuiltFont {
  spec: FontSpec;
  surface: Surface;
  chars: PackedChar[];
  /** char -> its rendered pixels, cell-sized. Used by specimens and keycaps. */
  cells: Map<string, Surface>;
  advanceOf(ch: string): number;
}

function glyphWidth(g: Glyph): number {
  return g.length ? g[0].length : 0;
}

/** Render one glyph into a (width x cellRows) surface, bevel included. */
function renderGlyph(spec: FontSpec, ch: string): Surface {
  const g = spec.glyphs[ch];
  const w = glyphWidth(g);
  const s = new Surface(Math.max(w, 1), spec.cellRows);
  if (!w) return s;
  if (g.length > spec.cellRows) {
    throw new Error(`${spec.name}: glyph '${ch}' has ${g.length} rows, cell is ${spec.cellRows}`);
  }
  for (let y = 0; y < g.length; y++) {
    if (g[y].length !== w) {
      throw new Error(`${spec.name}: glyph '${ch}' row ${y} is ${g[y].length} wide, expected ${w}`);
    }
    for (let x = 0; x < w; x++) if (g[y][x] === '#') s.px(x, y, spec.ink);
  }
  if (spec.bevel) s.innerShade(spec.bevel, 1, [[0, -1], [-1, 0]]);
  return s;
}

export function buildFont(spec: FontSpec): BuiltFont {
  const cells = new Map<string, Surface>();
  const order = Object.keys(spec.glyphs);
  for (const ch of order) cells.set(ch, renderGlyph(spec, ch));

  const advanceOf = (ch: string): number => {
    const alias = spec.alias?.[ch];
    const key = spec.glyphs[ch] ? ch : alias ?? ch;
    if (spec.advance?.[key] !== undefined) return spec.advance[key];
    const g = spec.glyphs[key];
    if (!g) return spec.spaceAdvance;
    return glyphWidth(g) + spec.tracking;
  };

  // Trim each glyph vertically, then shelf-pack tallest first.
  interface Item { ch: string; src: Surface; x: number; y: number; w: number; h: number; yoff: number }
  const items: Item[] = [];
  for (const ch of order) {
    const cell = cells.get(ch)!;
    const b = cell.bounds();
    if (b.w === 0) {
      items.push({ ch, src: cell, x: 0, y: 0, w: 0, h: 0, yoff: 0 });
      continue;
    }
    // Keep the full declared width (xoffset stays 0) — only rows are trimmed.
    items.push({ ch, src: cell.sub(0, b.y, cell.w, b.h), x: 0, y: 0, w: cell.w, h: b.h, yoff: b.y });
  }

  const PAD = 1;
  const MAXW = 192;
  const drawn = items.filter((i) => i.w > 0).sort((a, b) => b.h - a.h || b.w - a.w);
  let cx = PAD, cy = PAD, rowH = 0;
  for (const it of drawn) {
    if (cx + it.w + PAD > MAXW) { cx = PAD; cy += rowH + PAD; rowH = 0; }
    it.x = cx; it.y = cy;
    cx += it.w + PAD;
    rowH = Math.max(rowH, it.h);
  }
  const height = cy + rowH + PAD;
  const surface = new Surface(MAXW, height);
  for (const it of drawn) surface.blit(it.src, it.x, it.y);

  const byChar = new Map(items.map((i) => [i.ch, i]));
  const chars: PackedChar[] = [];
  const emit = (ch: string, src: Item) => {
    chars.push({
      char: ch,
      code: ch.codePointAt(0)!,
      x: src.x, y: src.y, w: src.w, h: src.h,
      xoff: 0, yoff: src.yoff,
      xadv: advanceOf(ch),
    });
  };
  for (const it of items) emit(it.ch, it);
  for (const [ch, target] of Object.entries(spec.alias ?? {})) {
    const src = byChar.get(target);
    if (src && !byChar.has(ch)) emit(ch, src);
  }

  return { spec, surface, chars, cells, advanceOf };
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fontXML(f: BuiltFont): string {
  const s = f.spec;
  const codes = new Set(f.chars.map((c) => c.code));
  const kerns: string[] = [];
  for (const [pair, amount] of Object.entries(s.kerning ?? {})) {
    const a = pair.codePointAt(0)!;
    const b = pair.codePointAt(String.fromCodePoint(a).length)!;
    if (!codes.has(a) || !codes.has(b)) continue;
    kerns.push(`    <kerning first="${a}" second="${b}" amount="${amount}"/>`);
  }
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<font>');
  lines.push(
    `  <info face="${xmlEscape(s.name)}" size="${s.lineHeight}" bold="0" italic="0" charset="" ` +
    'unicode="1" stretchH="100" smooth="0" aa="1" padding="0,0,0,0" spacing="0,0" outline="0"/>',
  );
  lines.push(
    `  <common lineHeight="${s.lineHeight}" base="${s.baseline}" scaleW="${f.surface.w}" ` +
    `scaleH="${f.surface.h}" pages="1" packed="0"/>`,
  );
  lines.push('  <pages>');
  lines.push(`    <page id="0" file="${s.name}.png"/>`);
  lines.push('  </pages>');
  lines.push(`  <chars count="${f.chars.length}">`);
  for (const c of f.chars) {
    lines.push(
      `    <char id="${c.code}" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" ` +
      `xoffset="${c.xoff}" yoffset="${c.yoff}" xadvance="${c.xadv}" page="0" chnl="15"/>`,
    );
  }
  lines.push('  </chars>');
  lines.push(`  <kernings count="${kerns.length}">`);
  lines.push(...kerns);
  lines.push('  </kernings>');
  lines.push('</font>');
  return lines.join('\n') + '\n';
}

/** Write `<name>.png` + `<name>.xml` into `dir`. Returns the built font. */
export function writeFont(dir: string, spec: FontSpec): BuiltFont {
  const f = buildFont(spec);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${spec.name}.png`), encodePNG(f.surface.w, f.surface.h, f.surface.data));
  writeFileSync(join(dir, `${spec.name}.xml`), fontXML(f));
  return f;
}

// ───────────────────────────────────────────────────────────────────────────
//  Text drawing (specimens, keycap glyphs, anything baked into a sprite)
// ───────────────────────────────────────────────────────────────────────────

/** Multiply a colour the way Phaser's tint does, so specimens tell the truth. */
function multiply(color: string, tint: string): string {
  const a = hex(color), b = hex(tint);
  const f = (i: number) => Math.round((a[i] * b[i]) / 255);
  return '#' + [f(0), f(1), f(2)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function textWidth(f: BuiltFont, text: string): number {
  let w = 0;
  let prev = '';
  for (const ch of text) {
    if (prev) w += f.spec.kerning?.[prev + ch] ?? 0;
    w += f.advanceOf(ch);
    prev = ch;
  }
  return w;
}

/**
 * Draw `text` with its line box top at `y`. Returns the advance width.
 * `tint` multiplies every glyph pixel, matching BitmapText.setTint.
 */
export function drawText(
  dst: Surface, f: BuiltFont, x: number, y: number, text: string, tint?: string,
): number {
  let cx = x;
  let prev = '';
  for (const ch of text) {
    if (prev) cx += f.spec.kerning?.[prev + ch] ?? 0;
    const key = f.spec.glyphs[ch] ? ch : f.spec.alias?.[ch] ?? ch;
    const cell = f.cells.get(key);
    if (cell) {
      for (let j = 0; j < cell.h; j++) {
        for (let i = 0; i < cell.w; i++) {
          const c = cell.get(i, j);
          if (c[3] === 0) continue;
          const hexc = '#' + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
          dst.px(cx + i, y + j, tint ? multiply(hexc, tint) : hexc);
        }
      }
    }
    cx += f.advanceOf(ch);
    prev = ch;
  }
  return cx - x;
}

/** Centre a string on `cx` (integer-snapped). Returns the left edge used. */
export function drawTextCentered(
  dst: Surface, f: BuiltFont, cx: number, y: number, text: string, tint?: string,
): number {
  const w = textWidth(f, text) - f.spec.tracking;
  const x = Math.round(cx - w / 2);
  drawText(dst, f, x, y, text, tint);
  return x;
}

// ───────────────────────────────────────────────────────────────────────────
//  Specimen sheet — the only honest way to judge a font is to read a sentence
//  at 1x on the colour it will actually sit on.
// ───────────────────────────────────────────────────────────────────────────

function scaled(src: Surface, factor: number): Surface {
  const s = new Surface(src.w * factor, src.h * factor);
  for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) {
    const c = src.get(i, j);
    if (c[3] === 0) continue;
    for (let b = 0; b < factor; b++) for (let a = 0; a < factor; a++) s.px(i * factor + a, j * factor + b, c);
  }
  return s;
}

const PANGRAM = 'Sphinx of black quartz, judge my vow!';
const DIALOGUE = 'The bell wasn’t frightening him — he learned what it meant.';

export function buildSpecimen(body: BuiltFont, display: BuiltFont): Surface {
  const ink = P.UI_INK;
  const gold = P.UI_GOLD[2];
  const parts: Array<{ s: Surface; scale: number; bg: string }> = [];

  const line = (text: string, f: BuiltFont, tint: string, scale: number, bg: string) => {
    const w = textWidth(f, text) + 8;
    const s = new Surface(w, f.spec.lineHeight + 2);
    drawText(s, f, 4, 1, text, tint);
    parts.push({ s, scale, bg });
  };
  const gap = () => parts.push({ s: new Surface(1, 2), scale: 1, bg: P.UI_PARCHMENT[1] });

  // 1x is the only scale that matters for shipping; the blown-up rows exist so
  // a critic can see *why* a 1x row does or doesn't work.
  line('font_body — cap 7, x-height 5, 2px descender. 1x:', body, ink, 1, P.UI_PARCHMENT[3]);
  line(PANGRAM, body, ink, 1, P.UI_PARCHMENT[3]);
  line('THE QUICK BROWN FOX JUMPS OVER A LAZY DOG', body, ink, 1, P.UI_PARCHMENT[3]);
  line(DIALOGUE, body, ink, 1, P.UI_PARCHMENT[3]);
  line('SERA: 0123456789 (12/30) 45% #3 [ok] a@b &c *d +e <f> …', body, ink, 1, P.UI_PARCHMENT[3]);
  line('illIl1 rn/m cl/d vv/w O/0 “quoted” it’s — long-ish', body, ink, 1, P.UI_PARCHMENT[3]);
  line(DIALOGUE, body, P.UI_PARCHMENT[4], 1, P.UI_PANEL[1]);
  line('Insight unlocked: CLASSICAL CONDITIONING', body, gold, 1, P.UI_PANEL[1]);
  gap();
  line(PANGRAM, body, ink, 2, P.UI_PARCHMENT[3]);
  line(DIALOGUE, body, ink, 2, P.UI_PARCHMENT[3]);
  gap();
  line(PANGRAM, body, ink, 4, P.UI_PARCHMENT[3]);
  line('illIl1 rn m cl d Whisper Woods', body, ink, 4, P.UI_PARCHMENT[3]);
  gap();

  line('font_display — cap 11, wedge stems, 1px inner highlight. 1x:', body, ink, 1, P.UI_PARCHMENT[3]);
  line('LUMEN VALE — FESTIVAL PLAZA', display, gold, 1, P.UI_PANEL[1]);
  line('MEMORY THREADS 0123456789', display, gold, 1, P.UI_PANEL[1]);
  line('WHY?! (X) ’OK’, … CLASSICAL CONDITIONING', display, P.UI_PARCHMENT[4], 1, P.UI_PANEL[1]);
  gap();
  line('ECHO SHRINE 2x', display, gold, 2, P.UI_PANEL[1]);
  line('AVA TOY 4x', display, gold, 4, P.UI_PANEL[1]);

  let h = 8;
  let w = 0;
  for (const p of parts) { h += p.s.h * p.scale + 3; w = Math.max(w, p.s.w * p.scale); }
  const out = new Surface(w, h, P.UI_PARCHMENT[1]);
  let y = 4;
  for (const p of parts) {
    const sh = p.s.h * p.scale;
    out.rect(0, y, w, sh, p.bg);
    out.blit(p.scale === 1 ? p.s : scaled(p.s, p.scale), 0, y);
    y += sh + 3;
  }
  return out;
}

/**
 * A 480x270 mock at 1x: exactly what the player sees. Dialogue set in
 * font_body inside a real-width box, a location banner in font_display.
 * If it doesn't read here it doesn't read.
 */
export function buildInGameMock(body: BuiltFont, display: BuiltFont): Surface {
  const s = new Surface(480, 270, P.GRASS[2]);
  for (let y = 0; y < 270; y++) for (let x = 0; x < 480; x++) {
    if ((x * 7 + y * 13) % 11 === 0) s.px(x, y, P.GRASS[1]);
    if ((x * 5 + y * 3) % 23 === 0) s.px(x, y, P.GRASS[3]);
  }

  // Location banner, top centre.
  const bw = textWidth(display, 'WHISPER WOODS') + 24;
  s.rect(240 - bw / 2, 14, bw, 21, P.UI_PANEL[1]);
  s.rectOutline(240 - bw / 2, 14, bw, 21, P.UI_GOLD[1]);
  drawTextCentered(s, display, 240, 18, 'WHISPER WOODS', P.UI_GOLD[3]);

  // Dialogue box, bottom, at the size the runtime will actually use.
  const bx = 24, by = 186, bwid = 432, bh = 62;
  s.rect(bx, by, bwid, bh, P.UI_PARCHMENT[3]);
  s.rectOutline(bx, by, bwid, bh, P.UI_INK);
  s.rectOutline(bx + 1, by + 1, bwid - 2, bh - 2, P.UI_GOLD[2]);
  s.rect(bx + 8, by - 10, textWidth(body, 'SERA') + 12, 14, P.UI_PANEL[1]);
  drawText(s, body, bx + 14, by - 8, 'SERA', P.UI_GOLD[3]);
  const lines = [
    'The bell wasn’t frightening him.',
    'Somewhere along the way he learned what it meant —',
    'and now he can’t hear it without bracing for the crash.',
  ];
  lines.forEach((t, i) => drawText(s, body, bx + 10, by + 10 + i * body.spec.lineHeight, t, P.UI_INK));

  // HUD-scale numerals and a heading, the other two places type appears.
  drawText(s, body, 8, 8, 'HP 6/6   Insights 2/3   Quests 1', P.UI_PARCHMENT[4]);
  drawTextCentered(s, display, 240, 96, 'PROACTIVE INTERFERENCE', P.UI_GOLD[4]);
  drawTextCentered(s, body, 240, 116,
    'Older information interferes with newer information.', P.UI_PARCHMENT[4]);
  return s;
}

export function writeSpecimen(path: string, body: BuiltFont, display: BuiltFont): void {
  const s = buildSpecimen(body, display);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(s.w, s.h, s.data));
}
