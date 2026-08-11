/**
 * ECHO SHRINE — ROOM FOUR: the ring of statues. (plan.md §42)
 *
 * THE ROOM IS THE RULE
 * ────────────────────
 * One statue stands on a dais at the north, larger and crowned. Four smaller
 * ones stand around the floor. Each of the four has a cold lamp in front of it,
 * in a *different direction*, and a lamp lights when the statue in front of it
 * is looking at it. Four lamps open the door.
 *
 * That is the whole statement of the problem and it is legible in one second,
 * because the answer to "what do I do here" is drawn on the floor: four statues,
 * four lamps, four different directions.
 *
 * What is not legible in one second — and is the room — is that the four cannot
 * be aimed. Turn the big one and all four swing with it, so exactly one lamp can
 * ever be lit at a time. Turn a small one and the group hauls it straight back.
 *
 * THE THING THAT MAKES IT SOLVABLE IS DRAWN TOO
 * ─────────────────────────────────────────────
 * Four faint lines run from the crowned statue to each of the others; the area
 * script draws them every frame. A block sits in the middle of the floor. It
 * takes about four seconds of looking at those two facts together, and the room
 * has said everything it is going to say.
 *
 * Composition notes: you enter at the north-west corner rather than the middle,
 * so the arrangement is laid out across the screen in front of you instead of
 * being something you are standing in. The dais, the pillars and the lamp ring
 * are the only architecture; the floor is otherwise deliberately bare, because
 * five statues, four lamps and a block are already a lot of loud objects.
 */
import { GridPainter } from '../GridPainter';
import { hasMap, registerMap } from '../registry';
import type { LightDef, MapDef, PropPlacement, Zone } from '../types';
import {
  ROOM_FLOOR, ROOM_H, ROOM_W, SHRINE_LEGEND, SHRINE_OBJECTS, SHRINE_VIOLET,
  crystalLight, doorLight, doorNorth, doorSouth, northZoneY, roomFill, southZoneY,
} from './shrine_common';

const F = ROOM_FLOOR;

export interface StatueSpec {
  id: string;
  /** Tile coords of the statue's foot. */
  x: number;
  y: number;
  /** The direction it must end up facing. */
  want: 'n' | 's' | 'e' | 'w';
  /** Its lamp, in tile coords. */
  lamp: { x: number; y: number };
}

export const R4 = {
  doorIn: 6,
  doorOut: 13,
  leader: { x: 14.5, y: 5.4 },
  /** The four, and the four different directions the door needs. */
  followers: [
    { id: 'a', x: 6.5, y: 9, want: 'w', lamp: { x: 3.9, y: 9 } },
    { id: 'b', x: 23.5, y: 8, want: 'e', lamp: { x: 26.1, y: 8 } },
    { id: 'c', x: 10.5, y: 11.6, want: 's', lamp: { x: 10.5, y: 13 } },
    { id: 'd', x: 19.5, y: 12, want: 'n', lamp: { x: 19.5, y: 9.6 } },
  ] as StatueSpec[],
  /** Where the block starts: between two sightlines and on neither. */
  block: { x: 14, y: 8 },
  /** The progress channel by the door — one plate per lamp. */
  channel: [
    { x: 13, y: 12 },
    { x: 14, y: 12 },
    { x: 13, y: 13 },
    { x: 14, y: 13 },
  ],
} as const;

function build(): MapDef {
  const g = new GridPainter(ROOM_W, ROOM_H, '#');
  g.rect(F.x, F.y, F.w, F.h, '.');
  for (let x = F.x - 1; x <= F.x + F.w; x++) g.set(x, F.y - 1, 'N');
  for (let y = F.y; y < F.y + F.h; y++) { g.set(F.x - 1, y, 'W'); g.set(F.x + F.w, y, 'E'); }
  for (let x = F.x; x < F.x + F.w; x++) g.set(x, F.y + F.h, 'S');
  g.set(F.x - 1, F.y + F.h, 'q');
  g.set(F.x + F.w, F.y + F.h, 'p');

  doorNorth(g, R4.doorIn, F);
  doorSouth(g, R4.doorOut, F);

  // The dais the crowned statue stands on: a worn plate, nothing more, because
  // the statue on it has to be the loud thing.
  g.blob(14.5, 5, 3.4, 1.7, ':', 11, 0.3);
  g.blob(14.5, 5, 1.8, 0.9, '%', 13, 0.35);
  // Dry room. A little moss has crept along the west wall from room three's
  // side of the building and stops there.
  g.scatter('*', ['.'], 0.3, 17, { x: F.x, y: F.y + 6, w: 2, h: 5 });
  g.scatter(':', ['.'], 0.11, 19);
  g.scatter('%', ['.', ':'], 0.22, 23, { x: F.x + F.w - 4, y: F.y, w: 4, h: 3 });

  for (const c of R4.channel) g.set(c.x, c.y, 'g');

  const ground = g.rows();

  const o = new GridPainter(ROOM_W, ROOM_H, ' ');
  o.scatter('R', [' '], 0.42, 29, { x: F.x, y: F.y, w: F.w, h: 1 });
  o.scatter('R', [' '], 0.3, 31, { x: F.x + F.w - 3, y: F.y + F.h - 3, w: 3, h: 3 });
  // The floor the puzzle happens on is clear, all of it. Every solid in this
  // room is a statue, a lamp, a pillar or the block.
  for (let y = F.y + 1; y < F.y + F.h; y++) for (let x = F.x + 1; x < F.x + F.w - 1; x++) o.set(x, y, ' ');

  const above = new GridPainter(ROOM_W, ROOM_H, ' ');
  for (const x of [4, 11, 18, 25]) above.set(x, F.y - 1, 'T');

  const props: PropPlacement[] = [];
  const lights: LightDef[] = [];

  const PILLARS: Array<[number, number, string | undefined]> = [
    [11, 4.4, 'carving.twentysix'],
    [18, 4.4, 'carving.thirty'],
    [4.4, 13, undefined],
    [25.6, 13, undefined],
  ];
  PILLARS.forEach(([x, y, carving], i) => {
    props.push({
      key: `prop/shrine/pillar_${i % 3}`,
      x, y,
      spec: { solid: [20, 10], ...(carving ? { interact: carving } : {}) },
    });
  });

  // Two crystals over the dais: the crowned statue is always the best-lit thing
  // in the room, which is how the player knows which one it is before anything
  // has moved.
  props.push({ key: 'prop/shrine/crystal_0', x: 12.6, y: 4.6, spec: { anim: 'shrine_crystal' } });
  props.push({ key: 'prop/shrine/crystal_0', x: 16.4, y: 4.6, spec: { anim: 'shrine_crystal' } });
  lights.push(crystalLight(12.6, 4, 46));
  lights.push(crystalLight(16.4, 4, 46));
  lights.push({ x: 14.5, y: 4.4, radius: 78, color: SHRINE_VIOLET, intensity: 0.6, flicker: 0.16 });
  // A wash over the floor the four stand on. Their facing is the entire puzzle
  // state, and a facing you have to squint at is a puzzle state you cannot read.
  lights.push(roomFill(14.5, 8.6, 250, 0.52));
  for (const f of R4.followers) {
    lights.push({ x: f.x, y: f.y - 1.2, radius: 42, color: 0x9fb0e0, intensity: 0.3, flicker: 0 });
  }

  props.push({ key: 'prop/shrine/broken_instrument_0', x: 3.9, y: 4.6, spec: { solid: [22, 10] } });
  props.push({ key: 'prop/shrine/echo_pool_0', x: 26, y: 11, spec: { anim: 'shrine_echo_pool', depthBias: -60 } });
  lights.push({ x: 26, y: 10.4, radius: 40, color: SHRINE_VIOLET, intensity: 0.3, flicker: 0.24 });

  lights.push(doorLight(R4.doorIn + 1, F.y - 0.6));
  lights.push(doorLight(R4.doorOut + 1, F.y + F.h - 0.4));

  const zones: Zone[] = [
    { kind: 'camera', id: 'bounds', x: 0, y: 0, w: ROOM_W, h: ROOM_H },
    { kind: 'door', id: 'to_r3', x: R4.doorIn, y: northZoneY(F), w: 2, h: 1, to: 'shrine_memory', spawn: 'south', facing: 'n', requires: 'shrine_r4_done' },
    { kind: 'trigger', id: 'r4_enter', x: R4.doorIn, y: F.y, w: 2, h: 2 },
  ];
  if (hasMap('shrine_combination')) {
    zones.push({
      kind: 'door', id: 'to_r5', x: R4.doorOut, y: southZoneY(F), w: 2, h: 1,
      to: 'shrine_combination', spawn: 'north', facing: 's', requires: 'shrine_r4_done',
    });
  }

  return {
    id: 'shrine_conformity',
    name: 'The Echo Shrine',
    subtitle: 'the hall of agreement',
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
      default: { x: R4.doorIn + 0.5, y: F.y, facing: 's' },
      north: { x: R4.doorIn + 0.5, y: F.y, facing: 's' },
      south: { x: R4.doorOut + 0.5, y: F.y + F.h - 1, facing: 'n' },
      respawn: { x: R4.doorIn + 0.5, y: F.y, facing: 's' },
    },
  };
}

registerMap('shrine_conformity', build);
