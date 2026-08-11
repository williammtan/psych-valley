/**
 * ECHO SHRINE — the shared room shell.
 *
 * Every shrine room is the same architectural object: a rectangle of quiet
 * floor wrapped in a wall band three tiles deep. That is not laziness, it is
 * the whole readability strategy, taken from the A Link to the Past room
 * reference:
 *
 *   - the boundary between "room" and "not room" is the most important line in
 *     a dungeon, so it is thick, dark and identical everywhere;
 *   - the floor is deliberately the most boring surface on screen, so every
 *     puzzle object is loud by comparison;
 *   - a room is 30x17 tiles, which is exactly one screen, so the whole problem
 *     is visible the moment the player walks in.
 *
 * The wall art is a set of pieces that only makes sense assembled one way (see
 * tools/art/assets/shrine.ts):
 *
 *     # # # # # # #     '#' wall_top_cap  — the dark mass beyond the room
 *     N N N N N N N     'N' wall_top_n    — the tall carved face
 *     W . . . . . E     'W' / 'E'         — side walls, coping facing the room
 *     W . . . . . E     '.' floor
 *     q S S S S S p     'S' south wall, 'q'/'p' the two floor-level corners
 *
 * `shell()` assembles that; `openN/S/W/E` cut a doorway through it.
 */
import { GridPainter } from '../GridPainter';
import type { LightDef, Material, ObjectSpec } from '../types';

export interface Rect { x: number; y: number; w: number; h: number }

/** One screen. 30x17 tiles = 480x272 px against a 480x270 viewport. */
export const ROOM_W = 30;
export const ROOM_H = 17;

/**
 * Ground characters. Deliberately few: a dungeon floor that reads as five
 * different materials in one room is noise, not texture.
 */
export const SHRINE_LEGEND: Record<string, Material> = {
  '.': { base: 'tile/shrine/floor' },
  ':': { base: 'tile/shrine/floor_cracked' },
  '%': { base: 'tile/shrine/floor_rubble' },
  '=': { base: 'tile/shrine/floor_grate' },
  '*': { base: 'tile/shrine/floor', blob: 'shrine_moss' },
  '~': { base: 'tile/shrine/floor_water', blob: 'shrine_water', solid: true },
  /** Shallow water you can wade through — joins '~' seamlessly, same blob set. */
  'w': { base: 'tile/shrine/floor_water', blob: 'shrine_water' },
  'o': { base: 'tile/shrine/floor', blob: 'shrine_pit', pit: true },
  /** A dead rune plate set into the floor. */
  'g': { base: 'tile/shrine/rune_floor_dim' },
  /** A flight of steps. */
  'x': { base: 'tile/shrine/step_n' },
  // Doorway floor. Same tile as '.', but a distinct char so a doorway is
  // obvious when you read the map source.
  '_': { base: 'tile/shrine/floor' },
  '#': { base: 'tile/shrine/wall_top_cap', solid: true },
  'N': { base: 'tile/shrine/wall_top_n', solid: true },
  'S': { base: 'tile/shrine/wall_s', solid: true },
  'W': { base: 'tile/shrine/wall_w', solid: true },
  'E': { base: 'tile/shrine/wall_e', solid: true },
  'q': { base: 'tile/shrine/wall_corner_sw', solid: true },
  'p': { base: 'tile/shrine/wall_corner_se', solid: true },
};

/**
 * Object characters. Anything that is *part of a puzzle* is never placed from
 * this table — puzzle objects are spawned by the area script so they can carry
 * state. This table is only architecture and dressing.
 */
export const SHRINE_OBJECTS: Record<string, ObjectSpec> = {
  'P': { key: ['prop/shrine/pillar_0', 'prop/shrine/pillar_1', 'prop/shrine/pillar_2'], solid: [20, 10] },
  'R': { key: ['prop/shrine/rubble_0', 'prop/shrine/rubble_1', 'prop/shrine/rubble_2'] },
  'r': { key: ['prop/shrine/rubble_0', 'prop/shrine/rubble_1', 'prop/shrine/rubble_2'], solid: [18, 8] },
  'I': { key: ['prop/shrine/broken_instrument_0', 'prop/shrine/broken_instrument_1', 'prop/shrine/broken_instrument_2'], solid: [22, 10] },
  'C': { key: 'prop/shrine/crystal_0', anim: 'shrine_crystal' },
  'B': { key: 'prop/shrine/brazier_0', anim: 'shrine_brazier', solid: [14, 8] },
  'O': { key: 'prop/shrine/echo_pool_0', anim: 'shrine_echo_pool', depthBias: -40 },
  // Roots hang from the ceiling, so they belong in the `above` grid.
  'T': { key: ['prop/shrine/root_0', 'prop/shrine/root_1', 'prop/shrine/root_2'] },
};

/** The room's floor rect for a standard one-screen room with 3-thick walls. */
export const ROOM_FLOOR: Rect = { x: 3, y: 3, w: 24, h: 11 };

/** Build the wall shell around a floor rect. Everything outside is solid cap. */
export function shell(w = ROOM_W, h = ROOM_H, f: Rect = ROOM_FLOOR): GridPainter {
  const g = new GridPainter(w, h, '#');
  g.rect(f.x, f.y, f.w, f.h, '.');
  // North band: the carved face runs the full width including over the side
  // walls, which is what makes the corner joins read.
  for (let x = f.x - 1; x <= f.x + f.w; x++) g.set(x, f.y - 1, 'N');
  for (let y = f.y; y < f.y + f.h; y++) {
    g.set(f.x - 1, y, 'W');
    g.set(f.x + f.w, y, 'E');
  }
  for (let x = f.x; x < f.x + f.w; x++) g.set(x, f.y + f.h, 'S');
  g.set(f.x - 1, f.y + f.h, 'q');
  g.set(f.x + f.w, f.y + f.h, 'p');
  return g;
}

/**
 * Cut a doorway. Doorways are two tiles wide because that is the width a door
 * sprite is drawn at, and because a one-tile gap makes a player feel like the
 * game is trying to catch them out.
 */
export function openN(g: GridPainter, x: number, f: Rect = ROOM_FLOOR, w = 2): void {
  for (let i = 0; i < w; i++) g.set(x + i, f.y - 1, '_');
}

export function openS(g: GridPainter, x: number, f: Rect = ROOM_FLOOR, w = 2): void {
  for (let i = 0; i < w; i++) g.set(x + i, f.y + f.h, '_');
}

/** Tile coordinates of a north doorway's two floor tiles. */
export function doorwayN(x: number, f: Rect = ROOM_FLOOR): { x: number; y: number; w: number; h: number } {
  return { x, y: f.y - 1, w: 2, h: 1 };
}

export function doorwayS(x: number, f: Rect = ROOM_FLOOR): { x: number; y: number; w: number; h: number } {
  return { x, y: f.y + f.h, w: 2, h: 1 };
}

// ── thresholds ──────────────────────────────────────────────────────────────
// A doorway is cut TWO rows deep rather than one. That extra row is doing real
// work: it gives the wall visible thickness from inside the room (you can see
// the jamb you are standing between), it puts the transition zone off the room
// floor so a player pacing along the south wall never triggers it by accident,
// and it leaves one row of cap outside so the screen still has a solid frame.
//
//        row 0    # # # # # #      cap — the frame
//        row 1    # # _ _ # #      threshold, door zone lives here
//        row 2    N N _ _ N N      the wall face, where the door sprite stands
//        row 3    . . . . . .      floor

/** Cut a north doorway through the wall face and the row beyond it. */
export function doorNorth(g: GridPainter, x: number, f: Rect = ROOM_FLOOR, w = 2): void {
  for (let i = 0; i < w; i++) {
    g.set(x + i, f.y - 1, '_');
    g.set(x + i, f.y - 2, '_');
  }
}

/** Cut a south doorway through the wall face and the row beyond it. */
export function doorSouth(g: GridPainter, x: number, f: Rect = ROOM_FLOOR, w = 2): void {
  for (let i = 0; i < w; i++) {
    g.set(x + i, f.y + f.h, '_');
    g.set(x + i, f.y + f.h + 1, '_');
  }
}

/** Row a north door zone sits on. */
export function northZoneY(f: Rect = ROOM_FLOOR): number { return f.y - 2; }
/** Row a south door zone sits on. */
export function southZoneY(f: Rect = ROOM_FLOOR): number { return f.y + f.h + 1; }
/** Wall-face row a north / south door sprite stands in. */
export function northWallY(f: Rect = ROOM_FLOOR): number { return f.y - 1; }
export function southWallY(f: Rect = ROOM_FLOOR): number { return f.y + f.h; }

// ── lights ──────────────────────────────────────────────────────────────────
// Every light in the shrine comes from an object the player can see. Nothing
// is lit by ambience, because "where is the light coming from" is one of the
// questions a dungeon room should always answer.

export const SHRINE_AMBER = 0xffb937;
export const SHRINE_CYAN = 0x8ce6e6;
export const SHRINE_VIOLET = 0xa681e6;

export function brazierLight(x: number, y: number, radius = 62): LightDef {
  return { x, y: y - 1, radius, color: SHRINE_AMBER, intensity: 0.62, flicker: 0.55 };
}

export function crystalLight(x: number, y: number, radius = 48): LightDef {
  return { x, y: y - 1, radius, color: SHRINE_CYAN, intensity: 0.5, flicker: 0.16 };
}

export function echoLight(x: number, y: number, radius = 54): LightDef {
  return { x, y, radius, color: SHRINE_VIOLET, intensity: 0.5, flicker: 0.22 };
}

/** A door is always lit, so an exit is never something you have to hunt for. */
export function doorLight(x: number, y: number): LightDef {
  return { x, y, radius: 44, color: SHRINE_VIOLET, intensity: 0.42, flicker: 0.1 };
}
