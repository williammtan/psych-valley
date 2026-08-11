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
 *   2. THE DAIS. The room is a rectangle but the FLOOR is an oval island: the
 *      four corners of the rectangle are void, and inside the island a raised
 *      platform of a stone used nowhere else in the shrine carries a hard,
 *      shadowed south edge. Two inlaid courses ring a drain at the exact centre.
 *      A stair causeway climbs onto it from the barred door, so the door, the
 *      steps, the inlaid path, the drain and the great seal above it all sit on
 *      one vertical axis — and that axis terminates on the Echo's spawn point.
 *      Nothing stands on the dais except the four braziers: the dais is the fight.
 *
 *   3. FOUR BRAZIERS, one per quadrant. They are cold when you arrive. In phase
 *      two the Echo relights whichever one it has just passed, and the attack
 *      indicators standing in that light are the ones that are actually coming.
 *      They are placed here, in the architecture, rather than spawned by the
 *      fight, because the cue has to look like part of the room.
 *
 * The floor carries no rune glyphs. That vocabulary encodes puzzle state in the
 * memory room, and thirty of them used as decoration here would have cost them
 * their meaning; the platform is inlaid flagstone instead.
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

/** The playable floor, in tiles. */
export const FLOOR = { x: 2, y: 3, w: 26, h: 11 };

const TILE = 16;
/** Tile coords -> the pixel a sprite's feet sit on. */
const px = (tx: number) => tx * TILE + TILE / 2;
const py = (ty: number) => ty * TILE + TILE;

/** Centre of the room, in tiles. Everything here is concentric about it. */
const CX = 14.5;
const CY = 8;
/** Beyond this the floor is gone: the four corners of the rectangle are void. */
const ISLAND = { rx: 12.4, ry: 5.4 };
/** The raised platform. Different stone, hard south edge, and the whole fight. */
const DAIS = { rx: 11.2, ry: 4.5 };
/** The causeway columns, which is where the ring opens. */
const GATE_X0 = 13;
const GATE_X1 = 16;

const norm = (x: number, y: number, r: { rx: number; ry: number }) =>
  Math.hypot((x - CX) / r.rx, (y - CY) / r.ry);
const inside = (x: number, y: number, r: { rx: number; ry: number }) => norm(x, y, r) <= 1;

/**
 * Everything the encounter needs to know about the room's shape, in PIXELS.
 * The area script and EchoBoss import this rather than re-deriving tile maths,
 * so the arena and the fight can never disagree about where the walls are.
 */
export const CHAMBER = {
  /**
   * Where the fight may PUT things — boss, attack markers, followers.
   *
   * This is the largest axis-aligned rectangle that fits inside the dais
   * ellipse, so nothing is ever spawned on a tile the player cannot stand on.
   * The player's own movement is not limited to it; they have the whole dais.
   */
  arena: { x0: 100, y0: 96, x1: 380, y1: 194 },
  /** Dead centre of the dais, the drain, and the sightline. */
  centre: { x: 240, y: 144 },
  /** Where the Echo hangs when it is not committed to anything. */
  home: { x: 240, y: 126 },
  /** The drain it comes up out of and eventually goes back down. */
  grate: { x: 240, y: 136 },
  /** One per quadrant of the dais, well inside the ledge. */
  braziers: [
    { x: px(7.5), y: py(5.5), flame: { x: px(7.5), y: py(5.5) - 20 } },
    { x: px(21.5), y: py(5.5), flame: { x: px(21.5), y: py(5.5) - 20 } },
    { x: px(7.5), y: py(10.5), flame: { x: px(7.5), y: py(10.5) - 20 } },
    { x: px(21.5), y: py(10.5), flame: { x: px(21.5), y: py(10.5) - 20 } },
  ],
  /** On the causeway, just inside the barred door. Also the respawn point. */
  entrance: { x: px(14.5), y: py(13) },
} as const;

const LEGEND: Record<string, Material> = {
  ...SHRINE_LEGEND,
  /**
   * THE DAIS, and the value structure of the whole room.
   *
   * The platform is the BRIGHT stone and everything around it is the dungeon's
   * ordinary dark floor. That way round matters: a raised surface reads as
   * raised because it catches more light than what surrounds it, and it makes
   * the arena the brightest shape on the floor without a single extra light.
   * The first attempt had the dais in a stone one shade off the apron's and the
   * platform simply vanished.
   */
  'd': { base: 'tile/shrine_ext/flag' },
  /** The apron: the same floor as the rest of the shrine, so the dais is what
   *  is unusual rather than the surround. */
  'f': { base: 'tile/shrine/floor' },
  /** Courses inlaid into the platform — darker stone set into the bright. */
  'F': { base: 'tile/shrine/shrine_floor' },
  /** The dais edge. Solid, so the platform has a real lip you can be backed against. */
  'L': { base: 'tile/shrine/ledge_s', solid: true },
  'M': { base: 'tile/shrine/ledge_sw', solid: true },
  'm': { base: 'tile/shrine/ledge_se', solid: true },
};

const OBJECTS: Record<string, ObjectSpec> = {
  ...SHRINE_OBJECTS,
  /** Non-solid rubble, for texture on the apron. */
  'R': { key: ['prop/shrine/rubble_0', 'prop/shrine/rubble_1', 'prop/shrine/rubble_2'] },
};

function build(): MapDef {
  const g = shell(ROOM_W, ROOM_H, FLOOR as Rect);

  // ── the island ──────────────────────────────────────────────────────────
  // The room is a rectangle; the FLOOR is not. The four corners are chamfered
  // away to void, which turns the chamber into an octagon and is the one piece
  // of geometry that exists nowhere else in the shrine. Straight diagonal runs
  // rather than a curve, because the pit's edge art autotiles cleanly along
  // them and a wobbling rim reads as damage rather than as architecture.
  const edgeX = (x: number) => Math.min(x - FLOOR.x, FLOOR.x + FLOOR.w - 1 - x);
  const edgeY = (y: number) => Math.min(y - FLOOR.y, FLOOR.y + FLOOR.h - 1 - y);
  const chamfered = (x: number, y: number) => edgeX(x) + edgeY(y) * 2.2 < 6.5;

  for (let y = FLOOR.y; y < FLOOR.y + FLOOR.h; y++) {
    for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x++) {
      if (chamfered(x, y)) g.set(x, y, 'o');
      else if (inside(x, y, DAIS)) g.set(x, y, 'd');
      else g.set(x, y, 'f');
    }
  }

  // ── the causeway ────────────────────────────────────────────────────────
  // A processional path from the barred door to the middle of the dais. It is
  // the room's sightline: door, steps, path, drain, and the great seal above it
  // are all on one vertical axis, and that axis terminates exactly where the
  // Echo comes up.
  for (let x = GATE_X0; x <= GATE_X1; x++) {
    for (let y = 12; y <= 13; y++) if (g.get(x, y) !== '#') g.set(x, y, 'd');
    g.set(x, 13, 'x');
  }
  for (let y = 9; y <= 12; y++) for (let x = 14; x <= 15; x++) g.set(x, y, 'F');

  // ── the dais edge ───────────────────────────────────────────────────────
  // In a top-down view elevation is sold almost entirely by the south-facing
  // edge, so only the bottom of the platform gets a ledge course, with a hard
  // shadow under it. Running one along the north edge too was tried and read as
  // a wall cutting the room in half. The causeway is the one gap in it.
  for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x++) {
    if (x >= GATE_X0 && x <= GATE_X1) continue;
    let lowest = -1;
    for (let y = FLOOR.y; y < FLOOR.y + FLOOR.h; y++) if (g.get(x, y) === 'd') lowest = y;
    if (lowest < 0) continue;
    const leftEnd = g.get(x - 1, lowest) !== 'd' && g.get(x - 1, lowest) !== 'L';
    const rightEnd = g.get(x + 1, lowest) !== 'd';
    g.set(x, lowest, leftEnd ? 'M' : rightEnd ? 'm' : 'L');
  }

  // ── the inlay ───────────────────────────────────────────────────────────
  // Two concentric courses set into the platform. Deliberately NOT rune plates:
  // those glyphs carry puzzle state elsewhere in the dungeon and using thirty of
  // them as wallpaper would strip them of meaning.
  for (let y = FLOOR.y; y < FLOOR.y + FLOOR.h; y++) {
    for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x++) {
      if (g.get(x, y) !== 'd') continue;
      const outer = Math.abs(norm(x, y, { rx: 8.6, ry: 3.5 }) - 1);
      const inner = Math.abs(norm(x, y, { rx: 4.8, ry: 2.0 }) - 1);
      if (outer < 0.12 || inner < 0.16) g.set(x, y, 'F');
    }
  }

  // The drain, dead centre, where it comes up and where it goes back down.
  g.rect(14, 7, 2, 2, '=');

  // Wear: heaviest in the middle, where something has been standing a long time.
  g.scatter('*', ['f'], 0.42, 41);
  g.scatter('%', ['f'], 0.12, 43);
  g.scatter(':', ['d'], 0.13, 47);

  const ground = g.rows();

  // ── loose dressing ──────────────────────────────────────────────────────
  // Only on the apron: nothing is allowed to stand on the dais except the four
  // braziers, because the dais is the fight.
  const o = new GridPainter(ROOM_W, ROOM_H, ' ');
  for (let y = FLOOR.y; y < FLOOR.y + FLOOR.h; y++) {
    for (let x = FLOOR.x; x < FLOOR.x + FLOOR.w; x++) {
      if (g.get(x, y) === 'f' && (x + y * 3) % 7 === 0) o.set(x, y, 'R');
    }
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

    // The ring of pillars, pushed out onto the apron so they frame the arena
    // instead of standing in it. Six, on the island's own ellipse.
    { key: 'prop/shrine/pillar_0', x: 26.1, y: 8, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_1', x: 22.9, y: 11.6, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_2', x: 6.1, y: 11.6, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_0', x: 2.9, y: 8, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_1', x: 6.1, y: 4.4, spec: { solid: [20, 10] } },
    { key: 'prop/shrine/pillar_2', x: 22.9, y: 4.4, spec: { solid: [20, 10] } },

    // Cold braziers. The fight lights them; see areas/shrine_boss.ts.
    { key: 'prop/shrine/brazier_0', x: 7.5, y: 5.5, spec: {}, id: 'brazier0' },
    { key: 'prop/shrine/brazier_0', x: 21.5, y: 5.5, spec: {}, id: 'brazier1' },
    { key: 'prop/shrine/brazier_0', x: 7.5, y: 10.5, spec: {}, id: 'brazier2' },
    { key: 'prop/shrine/brazier_0', x: 21.5, y: 10.5, spec: {}, id: 'brazier3' },

    { key: 'prop/shrine/echo_pool_0', x: 14.5, y: 8.4, spec: { anim: 'shrine_echo_pool', depthBias: -60 } },
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
    { x: 14.5, y: 8.2, radius: 70, color: SHRINE_VIOLET, intensity: 0.32, flicker: 0.3 },
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
      { kind: 'trigger', id: 'boss_wake', x: 10, y: 7, w: 10, h: 5 },
      { kind: 'camera', id: 'bounds', x: 0, y: 0, w: ROOM_W, h: ROOM_H },
    ],
    spawns: {
      default: { x: 14.5, y: 13, facing: 'n' },
      /** plan.md §67: death puts you back at the door, not back in the dungeon. */
      respawn: { x: 14.5, y: 13, facing: 'n' },
      south: { x: 14.5, y: 13, facing: 'n' },
    },
  };
}

registerMap('shrine_boss', build);
