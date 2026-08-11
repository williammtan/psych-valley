/**
 * ECHO SHRINE — THE BOSS CHAMBER.
 *
 * The last room of the slice, and the only one built for a fight rather than a
 * puzzle. It follows the shrine's shared grammar (`shrine_common.ts`) so the
 * player reads it instantly as the same building, but three things are different
 * and all three are load-bearing:
 *
 *   1. THE OBSERVATION ARRAY. The north wall is not a wall, it is an instrument.
 *      A great cracked seal flanked by broken brass rigs and two dead crystals,
 *      all aimed down into the floor. This was a room built to watch something
 *      that was already here. Nothing in it is interactive — it is there so the
 *      player understands what the place was for without a line of dialogue.
 *
 *   2. THE BASIN. The floor is inscribed: a ring of rune plates on an ellipse,
 *      a drain grate at the exact centre, moss creeping in from the wall line.
 *      The ring is the arena's readable centre and the thing the Echo circles.
 *
 *   3. FOUR BRAZIERS, one per quadrant. They are cold when you arrive. In phase
 *      two the Echo relights whichever one it has just passed, and the attack
 *      indicators standing in that light are the ones that are actually coming.
 *      They are placed here, in the architecture, rather than spawned by the
 *      fight, because the cue has to look like part of the room.
 *
 * The chamber is exactly one screen (30x17 = 480x272 against a 480x270 view),
 * so the entire problem is visible at all times — no camera work can hide a
 * telegraph from you. The south door is barred behind you and never opens.
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { LightDef, MapDef, PropPlacement, Material, ObjectSpec } from '../types';
import {
  ROOM_H, ROOM_W, SHRINE_LEGEND, SHRINE_OBJECTS, SHRINE_CYAN, SHRINE_VIOLET, shell, type Rect,
} from './shrine_common';

/** The playable floor, in tiles. Wider than a puzzle room: you have to dodge. */
export const FLOOR = { x: 2, y: 3, w: 26, h: 11 };

const TILE = 16;
/** Tile coords -> the pixel a sprite's feet sit on. */
const px = (tx: number) => tx * TILE + TILE / 2;
const py = (ty: number) => ty * TILE + TILE;

/**
 * Everything the encounter needs to know about the room's shape, in PIXELS.
 * The area script and EchoBoss import this rather than re-deriving tile maths,
 * so the arena and the fight can never disagree about where the walls are.
 */
export const CHAMBER = {
  /** Bounds for an entity's feet — inset from the walls by half a tile. */
  arena: {
    x0: FLOOR.x * TILE + 10,
    y0: FLOOR.y * TILE + 14,
    x1: (FLOOR.x + FLOOR.w) * TILE - 10,
    y1: (FLOOR.y + FLOOR.h) * TILE - 2,
  },
  /** Dead centre of the rune basin. */
  centre: { x: 240, y: 136 },
  /** Where the Echo hangs when it is not committed to anything. */
  home: { x: 240, y: 118 },
  /** The drain it eventually goes down. */
  grate: { x: 240, y: 136 },
  /** One per quadrant, at the flame bowl rather than the base. */
  braziers: [
    { x: px(7.5), y: py(5.5), flame: { x: px(7.5), y: py(5.5) - 20 } },
    { x: px(21.5), y: py(5.5), flame: { x: px(21.5), y: py(5.5) - 20 } },
    { x: px(7.5), y: py(11.5), flame: { x: px(7.5), y: py(11.5) - 20 } },
    { x: px(21.5), y: py(11.5), flame: { x: px(21.5), y: py(11.5) - 20 } },
  ],
  /** Just inside the barred door. Also the respawn point (plan.md §67). */
  entrance: { x: px(14.5), y: py(12.5) },
} as const;

/** The rune ring the basin is inscribed with, in tile coords. */
const RUNE_RING: Array<[number, number]> = [];
{
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const t: [number, number] = [
      Math.round(14.5 + Math.cos(a) * 10.6),
      Math.round(7.6 + Math.sin(a) * 4.2),
    ];
    const key = `${t[0]},${t[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    RUNE_RING.push(t);
  }
}
/** Exported so the encounter can light the arc nearest a flaring brazier. */
export const RUNE_TILES: ReadonlyArray<readonly [number, number]> = RUNE_RING;

const LEGEND: Record<string, Material> = {
  ...SHRINE_LEGEND,
  /** Dead rune plate. The encounter swaps these to the lit family in phase two. */
  'g': { base: 'tile/shrine/rune_floor_dim' },
};

const OBJECTS: Record<string, ObjectSpec> = {
  ...SHRINE_OBJECTS,
  /** Non-solid rubble, for texture along the wall line. */
  'R': { key: ['prop/shrine/rubble_0', 'prop/shrine/rubble_1', 'prop/shrine/rubble_2'] },
};

function build(): MapDef {
  const g = shell(ROOM_W, ROOM_H, FLOOR as Rect);

  // ── the basin ───────────────────────────────────────────────────────────
  // Worn stone spreading out from the middle, mossy where the wall meets the
  // floor. The centre is the most damaged part of the room, because it is the
  // part something has been standing on for a very long time.
  g.blob(14.5, 7.6, 9, 3.6, ':', 17, 0.22);
  g.blob(14.5, 7.6, 5, 2.1, '%', 23, 0.3);
  for (const [x, y] of RUNE_RING) g.set(x, y, 'g');
  g.rect(14, 7, 2, 2, '=');

  // Moss creeps in from the wall line, heaviest in the corners.
  g.scatter('*', ['.'], 0.5, 31, { x: FLOOR.x, y: FLOOR.y, w: FLOOR.w, h: 1 });
  g.scatter('*', ['.'], 0.45, 37, { x: FLOOR.x, y: FLOOR.y + FLOOR.h - 1, w: FLOOR.w, h: 1 });
  g.scatter('*', ['.'], 0.4, 41, { x: FLOOR.x, y: FLOOR.y, w: 2, h: FLOOR.h });
  g.scatter('*', ['.'], 0.4, 43, { x: FLOOR.x + FLOOR.w - 2, y: FLOOR.y, w: 2, h: FLOOR.h });
  g.scatter(':', ['.'], 0.14, 47);

  const ground = g.rows();

  // ── loose dressing ──────────────────────────────────────────────────────
  const o = new GridPainter(ROOM_W, ROOM_H, ' ');
  o.scatter('R', [' '], 0.55, 53, { x: FLOOR.x, y: FLOOR.y, w: FLOOR.w, h: 1 });
  o.scatter('R', [' '], 0.35, 59, { x: FLOOR.x, y: FLOOR.y + FLOOR.h - 1, w: FLOOR.w, h: 1 });
  // Never let dressing stand inside the ring the fight uses.
  for (let y = FLOOR.y + 1; y < FLOOR.y + FLOOR.h - 1; y++) {
    for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x++) o.set(x, y, ' ');
  }

  // Roots hang through the ceiling above the wall band, breaking its straight
  // top edge so the room does not read as a rectangle drawn in a text editor.
  const above = new GridPainter(ROOM_W, ROOM_H, ' ');
  for (const x of [4, 9, 21, 26]) above.set(x, 2, 'T');

  // ── the observation array ───────────────────────────────────────────────
  // Mounted IN the north wall band: anchored on the wall's last row and nudged
  // down so each piece's foot just touches the floor line. Costs no floor.
  const props: PropPlacement[] = [
    { key: 'prop/shrine/boss_seal_0', x: 14.5, y: 2, spec: { anim: 'shrine_boss_seal', offset: [0, 10] }, id: 'seal' },
    { key: 'prop/shrine/broken_instrument_0', x: 9.5, y: 2, spec: { offset: [0, 12] } },
    { key: 'prop/shrine/broken_instrument_1', x: 19.5, y: 2, spec: { offset: [0, 12] } },
    { key: 'prop/shrine/broken_instrument_2', x: 6, y: 2, spec: { offset: [0, 12] } },
    { key: 'prop/shrine/broken_instrument_0', x: 23, y: 2, spec: { offset: [0, 12] } },
    { key: 'prop/shrine/crystal_0', x: 3.2, y: 2, spec: { anim: 'shrine_crystal', offset: [0, 12] } },
    { key: 'prop/shrine/crystal_0', x: 25.8, y: 2, spec: { anim: 'shrine_crystal', offset: [0, 12] } },

    // The way you came in, and the reason you are not going back out of it.
    // NOTE (art gap): door_barred_0..3 exist as frames but no animation is
    // registered for them, so the bars are static. Frame 0 reads correctly.
    { key: 'prop/shrine/door_barred_0', x: 14.5, y: 14, spec: { offset: [0, 6], depthBias: -90 }, id: 'door' },

    // The ring of pillars. Six, on the same ellipse as the rune plates, so the
    // architecture and the inscription agree about where the middle is.
    { key: 'prop/shrine/pillar_0', x: 25.5, y: 7.5, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_1', x: 20, y: 11.4, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_2', x: 9, y: 11.4, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_0', x: 3.5, y: 7.5, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_1', x: 9, y: 3.6, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_2', x: 20, y: 3.6, spec: { solid: [20, 10] } },

    // Cold braziers. The fight lights them; see areas/shrine_boss.ts.
    { key: 'prop/shrine/brazier_0', x: 7.5, y: 5.5, spec: {}, id: 'brazier0' },
    { key: 'prop/shrine/brazier_0', x: 21.5, y: 5.5, spec: {}, id: 'brazier1' },
    { key: 'prop/shrine/brazier_0', x: 7.5, y: 11.5, spec: {}, id: 'brazier2' },
    { key: 'prop/shrine/brazier_0', x: 21.5, y: 11.5, spec: {}, id: 'brazier3' },

    { key: 'prop/shrine/echo_pool_0', x: 14.5, y: 8.6, spec: { anim: 'shrine_echo_pool', depthBias: -60 } },
  ];

  /**
   * Every light in the room comes from something the player can point at (the
   * shrine's rule), and between them they have to keep the whole floor readable
   * — a boss arena where a telegraph can hide in shadow is a broken arena.
   *
   * The four braziers are lit separately, by the encounter, because their state
   * is gameplay information; see `Brazier` in entities/EchoBoss.ts.
   */
  const lights: LightDef[] = [
    // The seal lights the APPARATUS, not the arena. An earlier pass had it
    // throwing a wide violet wash over the whole floor, which is exactly where
    // the fight happens and exactly the colour the Echo is — the boss and its
    // followers disappeared into their own background.
    { x: 14.5, y: 2.4, radius: 100, color: SHRINE_VIOLET, intensity: 0.44, flicker: 0.18 },
    { x: 3.2, y: 2.6, radius: 62, color: SHRINE_CYAN, intensity: 0.5, flicker: 0.14 },
    { x: 25.8, y: 2.6, radius: 62, color: SHRINE_CYAN, intensity: 0.5, flicker: 0.14 },
    // The pool over the drain: the room's centre, and where it goes at the end.
    { x: 14.5, y: 7.8, radius: 70, color: SHRINE_VIOLET, intensity: 0.3, flicker: 0.3 },
    // The door you came in by stays lit, so the room always has a bottom edge.
    { x: 14.5, y: 13.4, radius: 56, color: SHRINE_VIOLET, intensity: 0.4, flicker: 0.1 },
  ];

  return {
    id: 'shrine_boss',
    name: 'The Observatory Floor',
    subtitle: 'something was measured here',
    music: 'boss',
    tint: 0x0d1030,
    // Dark, but never so dark that a telegraph can hide in it. Phase two puts
    // marks on the unlit floor that the player has to SEE and then correctly
    // ignore, so "unlit" has to mean dim, not invisible.
    darkness: 0.36,
    ground,
    legend: LEGEND,
    objects: o.rows(),
    above: above.rows(),
    objectLegend: OBJECTS,
    props,
    lights,
    zones: [
      // Walking into the middle of the basin is what wakes it. Putting the
      // trigger here rather than on entry means the player gets a beat to look
      // at the room first — and it keeps a plain map screenshot free of a
      // dialogue box.
      { kind: 'trigger', id: 'boss_wake', x: 10, y: 8, w: 10, h: 5 },
      { kind: 'camera', id: 'bounds', x: 0, y: 0, w: ROOM_W, h: ROOM_H },
    ],
    spawns: {
      default: { x: 14.5, y: 12.5, facing: 'n' },
      /** plan.md §67: death puts you back at the door, not back in the dungeon. */
      respawn: { x: 14.5, y: 12.5, facing: 'n' },
      south: { x: 14.5, y: 12.5, facing: 'n' },
    },
  };
}

registerMap('shrine_boss', build);
