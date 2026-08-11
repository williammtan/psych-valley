/**
 * ECHO SHRINE — ROOM THREE: the two ways down. (plan.md §41)
 *
 * WHAT IS IN THE ROOM
 * ───────────────────
 * Two doors in the south wall. The west one is set in wet stone: water still
 * runs down the wall above it, moss has climbed the jamb, the floor in front of
 * it is under an inch of water. The east one is bone dry, cracked and thick with
 * fallen grit.
 *
 * Two teams worked here (carving.twentythree, on the pillar) and each learned
 * its own way down. The routes are still on the floor. The wet team's is a
 * channel of standing water; the dry team's is a scuffed track through the
 * grit. Each route passes over four inscribed plates, and the *order* it passes
 * over them is that team's door order. Every few seconds the shrine runs a pulse
 * along each channel in turn, in the direction the team walked, so the order
 * plays itself out in front of the player, twice, in two different contexts.
 *
 * WHY IT CANNOT BE GUESSED
 * ────────────────────────
 * The keypad is a bank of four rune pillars at the south centre, physically
 * between the doors and belonging to neither. Four symbols, twenty-four possible
 * orders, and `OrderLock` does not judge until all four are in — so a wrong
 * order costs four presses and tells you nothing about which of them was wrong.
 * There is no version of "try sequence A, then try sequence B" here: there are
 * no sequences on offer, only evidence to read.
 *
 * Both doors have to be opened. That is deliberate: it is not enough to
 * reconstruct one route, the player has to keep both of them straight at once,
 * and the two orders are chosen to make that as hard as it honestly can be —
 * the same four symbols, the same first symbol, the same last symbol, and only
 * the middle pair swapped. Follow the wrong channel for one plate and the whole
 * entry fails.
 *
 * The pillar bank's own left-to-right arrangement matches neither answer, so
 * there is nothing to copy positionally.
 */
import { GridPainter } from '../GridPainter';
import { hasMap, registerMap } from '../registry';
import type { Rune } from '@/systems/Puzzle';
import type { LightDef, MapDef, PropPlacement, Zone } from '../types';
import {
  ROOM_FLOOR, ROOM_H, ROOM_W, SHRINE_LEGEND, SHRINE_OBJECTS, SHRINE_VIOLET,
  brazierLight, crystalLight, doorLight, doorNorth, doorSouth, northZoneY, roomFill, southZoneY,
} from './shrine_common';

const F = ROOM_FLOOR;

export interface Station { x: number; y: number; rune: Rune }

/** A route: the tiles it runs along, and the plates it crosses, in order. */
export interface Route {
  id: 'damp' | 'dry';
  path: Array<[number, number]>;
  stations: Station[];
  /** Left tile of this route's door. */
  door: number;
  /** The lamp that lights when this route's order is entered. */
  lamp: { x: number; y: number };
}

export const DAMP: Route = {
  id: 'damp',
  door: 5,
  lamp: { x: 7.8, y: 13 },
  path: [
    [3, 3], [3, 4], [3, 5], [4, 5], [4, 6], [4, 7], [5, 7], [5, 8],
    [5, 9], [4, 9], [4, 10], [4, 11], [5, 11], [5, 12], [5, 13], [6, 13],
  ],
  stations: [
    { x: 4, y: 6, rune: 'ring' },
    { x: 5, y: 8, rune: 'chevron' },
    { x: 4, y: 10, rune: 'spiral' },
    { x: 5, y: 12, rune: 'bars' },
  ],
};

export const DRY: Route = {
  id: 'dry',
  door: 21,
  lamp: { x: 19.2, y: 13 },
  path: [
    [26, 3], [26, 4], [26, 5], [25, 5], [25, 6], [25, 7], [24, 7], [24, 8],
    [24, 9], [25, 9], [25, 10], [25, 11], [24, 11], [24, 12], [23, 12], [23, 13], [22, 13],
  ],
  stations: [
    { x: 25, y: 6, rune: 'ring' },
    { x: 24, y: 8, rune: 'spiral' },
    { x: 25, y: 10, rune: 'chevron' },
    { x: 23, y: 12, rune: 'bars' },
  ],
};

export const R3 = {
  doorIn: 13,
  routes: [DAMP, DRY] as Route[],
  /** The keypad. Its left-to-right order deliberately matches neither answer. */
  bank: [
    { x: 11, y: 12, rune: 'spiral' as Rune },
    { x: 13, y: 12, rune: 'chevron' as Rune },
    { x: 15, y: 12, rune: 'ring' as Rune },
    { x: 17, y: 12, rune: 'bars' as Rune },
  ],
  pool: { x: 14.5, y: 6.4 },
} as const;

function build(): MapDef {
  const g = new GridPainter(ROOM_W, ROOM_H, '#');
  g.rect(F.x, F.y, F.w, F.h, '.');
  for (let x = F.x - 1; x <= F.x + F.w; x++) g.set(x, F.y - 1, 'N');
  for (let y = F.y; y < F.y + F.h; y++) { g.set(F.x - 1, y, 'W'); g.set(F.x + F.w, y, 'E'); }
  for (let x = F.x; x < F.x + F.w; x++) g.set(x, F.y + F.h, 'S');
  g.set(F.x - 1, F.y + F.h, 'q');
  g.set(F.x + F.w, F.y + F.h, 'p');

  doorNorth(g, R3.doorIn, F);
  doorSouth(g, DAMP.door, F);
  doorSouth(g, DRY.door, F);

  // ── the wet side ─────────────────────────────────────────────────────────
  // Moss first and wide, then the channel cut through the middle of it, so the
  // water reads as something that has been running here a very long time.
  g.blob(5, 8, 3.4, 5.4, '*', 11, 0.5);
  g.scatter('*', ['.'], 0.4, 13, { x: F.x, y: F.y, w: 6, h: F.h });
  for (const [x, y] of DAMP.path) g.set(x, y, 'w');

  // ── the dry side ─────────────────────────────────────────────────────────
  // Grit fallen from a cracked ceiling, and a track scuffed through it.
  g.blob(24.6, 8, 3.2, 5.2, ':', 17, 0.45);
  g.scatter(':', ['.'], 0.42, 19, { x: F.x + F.w - 6, y: F.y, w: 6, h: F.h });
  g.scatter('%', ['.', ':'], 0.34, 23, { x: F.x + F.w - 6, y: F.y, w: 6, h: F.h });
  for (const [x, y] of DRY.path) g.set(x, y, '%');

  // ── the plates ───────────────────────────────────────────────────────────
  // Placed dead here; the area script sets each one's actual glyph, because a
  // tile family picks its variant at random and these four are not decoration.
  for (const r of R3.routes) for (const st of r.stations) g.set(st.x, st.y, 'g');

  g.scatter(':', ['.'], 0.08, 29, { x: 10, y: F.y, w: 10, h: F.h });

  const ground = g.rows();

  const o = new GridPainter(ROOM_W, ROOM_H, ' ');
  o.scatter('R', [' '], 0.4, 31, { x: F.x, y: F.y, w: F.w, h: 1 });
  o.scatter('R', [' '], 0.4, 37, { x: F.x + F.w - 5, y: F.y + 1, w: 5, h: 3 });
  // Nothing loose on a route, on the keypad, or on the walk between them.
  for (const r of R3.routes) for (const [x, y] of r.path) { o.set(x, y, ' '); o.set(x, y - 1, ' '); }
  for (let y = 9; y <= 13; y++) for (let x = 9; x <= 19; x++) o.set(x, y, ' ');
  for (let y = F.y; y <= 8; y++) for (let x = 10; x <= 19; x++) o.set(x, y, ' ');

  const above = new GridPainter(ROOM_W, ROOM_H, ' ');
  // Roots only over the wet side: they are what the water comes down through.
  for (const x of [4, 6, 8]) above.set(x, F.y - 1, 'T');
  above.set(24, F.y - 1, 'T');

  const props: PropPlacement[] = [];
  const lights: LightDef[] = [];

  // The pool: the room's centre, and the thing you touch to make it all play
  // again if you looked away.
  props.push({ key: 'prop/shrine/echo_pool_0', x: R3.pool.x, y: R3.pool.y, spec: { anim: 'shrine_echo_pool', depthBias: -60 }, id: 'pool' });
  lights.push({ x: R3.pool.x, y: R3.pool.y - 0.6, radius: 68, color: SHRINE_VIOLET, intensity: 0.44, flicker: 0.24 });

  // Cold crystals over the wet side, a live brazier over the dry side. The two
  // halves of this room are lit by different things on purpose.
  props.push({ key: 'prop/shrine/crystal_0', x: 3.6, y: 4.4, spec: { anim: 'shrine_crystal' } });
  props.push({ key: 'prop/shrine/crystal_0', x: 6.4, y: 11.4, spec: { anim: 'shrine_crystal' } });
  lights.push(crystalLight(3.6, 3.8, 64));
  lights.push(crystalLight(6.4, 10.8, 58));

  props.push({ key: 'prop/shrine/brazier_0', x: 26, y: 4.4, spec: { anim: 'shrine_brazier', solid: [14, 8] } });
  lights.push(brazierLight(26, 3.4, 72));
  props.push({ key: 'prop/shrine/brazier_0', x: 22.4, y: 10.4, spec: { anim: 'shrine_brazier', solid: [14, 8] } });
  lights.push(brazierLight(22.4, 9.4, 64));

  props.push({ key: 'prop/shrine/pillar_0', x: 10, y: 5.6, spec: { solid: [20, 10], interact: 'carving.twentythree' } });
  props.push({ key: 'prop/shrine/pillar_2', x: 19, y: 5.6, spec: { solid: [20, 10] } });
  props.push({ key: 'prop/shrine/broken_instrument_1', x: 8.6, y: 3.8, spec: { solid: [22, 10] } });
  props.push({ key: 'prop/shrine/broken_instrument_2', x: 20.6, y: 3.8, spec: { solid: [22, 10] } });

  // The room's diffuse floor. Memory's cold-left / warm-right split is the
  // design working — it only ever needed both halves lifted out of the
  // near-black band so the split reads as temperature and not as darkness.
  lights.push(roomFill(14.5, 8.4, 250, 0.48));

  lights.push(doorLight(R3.doorIn + 1, F.y - 0.6));
  lights.push(doorLight(DAMP.door + 1, F.y + F.h - 0.4));
  lights.push(doorLight(DRY.door + 1, F.y + F.h - 0.4));

  const zones: Zone[] = [
    { kind: 'camera', id: 'bounds', x: 0, y: 0, w: ROOM_W, h: ROOM_H },
    { kind: 'door', id: 'to_r2', x: R3.doorIn, y: northZoneY(F), w: 2, h: 1, to: 'shrine_combat', spawn: 'south', facing: 'n', requires: 'shrine_r3_done' },
    { kind: 'trigger', id: 'r3_enter', x: R3.doorIn, y: F.y, w: 2, h: 2 },
  ];
  if (hasMap('shrine_conformity')) {
    for (const r of R3.routes) {
      zones.push({
        kind: 'door', id: `to_r4_${r.id}`, x: r.door, y: southZoneY(F), w: 2, h: 1,
        to: 'shrine_conformity', spawn: 'north', facing: 's', requires: 'shrine_r3_done',
      });
    }
  }

  return {
    id: 'shrine_memory',
    name: 'The Echo Shrine',
    subtitle: 'the two ways down',
    music: 'shrine',
    tint: 0x0d1030,
    darkness: 0.18,
    ground,
    legend: SHRINE_LEGEND,
    objects: o.rows(),
    above: above.rows(),
    objectLegend: SHRINE_OBJECTS,
    props,
    lights,
    zones,
    spawns: {
      default: { x: R3.doorIn + 0.5, y: F.y, facing: 's' },
      north: { x: R3.doorIn + 0.5, y: F.y, facing: 's' },
      south: { x: DAMP.door + 0.5, y: F.y + F.h - 1, facing: 'n' },
      respawn: { x: R3.doorIn + 0.5, y: F.y, facing: 's' },
    },
  };
}

registerMap('shrine_memory', build);
