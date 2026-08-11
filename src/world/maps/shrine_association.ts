/**
 * ECHO SHRINE — ROOM ONE. (plan.md §39)
 *
 * The room is a sentence with three nouns in it, and the player has to put them
 * in order themselves:
 *
 *      a heavy thing that walks after a light   (west, already happening)
 *      a light in a jar                          (centre, on a plinth, yours)
 *      a plate too heavy for you                 (east, in front of the door)
 *
 * Composition rules this room is built to:
 *
 *   THE PROBLEM IS STAGED BEFORE IT IS SET.  The creature is already plodding
 *   after a moth when you walk in, in the open, in the west third where nothing
 *   else is happening. You watch it for as long as you like. Nothing is
 *   explained and nothing is named. By the time you pick the jar up you have
 *   already seen the rule.
 *
 *   THE JAR IS THE FOCAL INTERACTABLE.  Four pillars stand around it like a
 *   canopy and it is the only thing at the room's exact centre, lit by its own
 *   crystal. It is the one object the eye lands on, which is the job the chest
 *   does in the A Link to the Past reference.
 *
 *   THE MACHINERY IS DRAWN.  A dead rune channel runs from the plate to the
 *   door. When the plate goes down the channel lights along its length. You are
 *   never asked to believe a door opened somewhere off-screen.
 *
 * Nothing in this room, in its dialogue, or in its logs, names a psychological
 * idea. The room asks a question with its floor plan and waits.
 */
import { GridPainter } from '../GridPainter';
import { hasMap, registerMap } from '../registry';
import type { LightDef, MapDef, PropPlacement, Zone } from '../types';
import {
  ROOM_FLOOR, ROOM_H, ROOM_W, SHRINE_LEGEND, SHRINE_OBJECTS, SHRINE_VIOLET,
  brazierLight, crystalLight, doorLight, doorNorth, doorSouth, northZoneY, southZoneY,
} from './shrine_common';

const F = ROOM_FLOOR;

/** Everything the area script needs to agree with the map about. */
export const R1 = {
  /** North threshold (in) and south threshold (out). */
  doorIn: 13,
  doorOut: 21,
  /** The plate the creature has to stand on. Weight 3 — you are weight 1. */
  plate: { x: 22, y: 11 },
  /** The dead rune channel from the plate to the door. */
  channel: [
    { x: 22, y: 12 },
    { x: 22, y: 13 },
  ],
  /** The moth jar, dead centre. */
  jar: { x: 14, y: 9 },
  /** The circuit the resident moth drifts around, in tiles. */
  patrol: [
    { x: 6, y: 6 },
    { x: 9.4, y: 5 },
    { x: 9.8, y: 9 },
    { x: 5.8, y: 10 },
  ],
  /** Where the creature is standing when you walk in. */
  creature: { x: 7.4, y: 7.6 },
} as const;

function build(): MapDef {
  const g = new GridPainter(ROOM_W, ROOM_H, '#');
  g.rect(F.x, F.y, F.w, F.h, '.');
  for (let x = F.x - 1; x <= F.x + F.w; x++) g.set(x, F.y - 1, 'N');
  for (let y = F.y; y < F.y + F.h; y++) { g.set(F.x - 1, y, 'W'); g.set(F.x + F.w, y, 'E'); }
  for (let x = F.x; x < F.x + F.w; x++) g.set(x, F.y + F.h, 'S');
  g.set(F.x - 1, F.y + F.h, 'q');
  g.set(F.x + F.w, F.y + F.h, 'p');

  doorNorth(g, R1.doorIn, F);
  doorSouth(g, R1.doorOut, F);

  // The west third is wet — the same seep that runs down the entrance stair.
  // The creature lives in it. Room five will ask the player to remember that
  // creatures live somewhere in particular; this is where they first see it.
  g.blob(6.5, 7.5, 4.2, 3.2, '*', 11, 0.55);
  g.blob(5.4, 8, 2.2, 1.4, 'w', 13, 0.5);
  g.scatter('*', ['.'], 0.22, 17, { x: F.x, y: F.y, w: F.w, h: 2 });

  // The east end is dry and broken: cracked slabs, rubble banked at the wall.
  g.blob(21, 8, 4.6, 3.4, ':', 19, 0.45);
  g.scatter('%', ['.', ':'], 0.3, 23, { x: 23, y: 4, w: 4, h: 4 });
  g.scatter(':', ['.'], 0.1, 29);

  // The channel: dead rune plates, plainly a mechanism, plainly not lit.
  for (const c of R1.channel) g.set(c.x, c.y, 'g');

  const ground = g.rows();

  const o = new GridPainter(ROOM_W, ROOM_H, ' ');
  o.scatter('R', [' '], 0.5, 31, { x: F.x, y: F.y + F.h - 2, w: 4, h: 2 });
  o.scatter('R', [' '], 0.45, 37, { x: F.x + F.w - 4, y: F.y, w: 4, h: 2 });
  o.scatter('R', [' '], 0.3, 41, { x: F.x, y: F.y, w: F.w, h: 1 });
  // The creature's ground, the jar's plinth and the plate stay clear.
  for (let y = 5; y <= 11; y++) for (let x = 4; x <= 12; x++) o.set(x, y, ' ');
  for (let y = 7; y <= 12; y++) for (let x = 12; x <= 17; x++) o.set(x, y, ' ');
  for (let y = 10; y <= 13; y++) for (let x = 20; x <= 24; x++) o.set(x, y, ' ');

  const above = new GridPainter(ROOM_W, ROOM_H, ' ');
  for (const x of [5, 10, 19, 25]) above.set(x, F.y - 1, 'T');

  const props: PropPlacement[] = [];
  const lights: LightDef[] = [];

  // The canopy: four pillars around the room's centre, and the jar inside it.
  const CANOPY: Array<[number, number, string | undefined]> = [
    [11.5, 6.6, 'carving.nineteen'],
    [17.5, 6.6, undefined],
    [11.5, 12, undefined],
    [17.5, 12, undefined],
  ];
  CANOPY.forEach(([x, y, carving], i) => {
    props.push({
      key: `prop/shrine/pillar_${i % 3}`,
      x, y,
      spec: { solid: [20, 10], ...(carving ? { interact: carving } : {}) },
    });
  });

  // The jar's own light, so the focal object is the brightest thing in the room.
  props.push({ key: 'prop/shrine/crystal_0', x: R1.jar.x + 1.4, y: R1.jar.y, spec: { anim: 'shrine_crystal' } });
  lights.push(crystalLight(R1.jar.x + 1.4, R1.jar.y - 1, 54));
  lights.push({ x: R1.jar.x, y: R1.jar.y - 1, radius: 44, color: 0xffe08a, intensity: 0.5, flicker: 0.3 });

  // Two braziers, at the two ends of the room's long axis.
  props.push({ key: 'prop/shrine/brazier_0', x: 4.5, y: 4.6, spec: { anim: 'shrine_brazier', solid: [14, 8] } });
  lights.push(brazierLight(4.5, 3.6, 66));
  props.push({ key: 'prop/shrine/brazier_0', x: 25.5, y: 13, spec: { anim: 'shrine_brazier', solid: [14, 8] } });
  lights.push(brazierLight(25.5, 12, 66));

  props.push({ key: 'prop/shrine/broken_instrument_1', x: 25.6, y: 6.4, spec: { solid: [22, 10] } });
  props.push({ key: 'prop/shrine/echo_pool_0', x: 5.6, y: 9.6, spec: { anim: 'shrine_echo_pool', depthBias: -60 } });
  lights.push({ x: 5.6, y: 9, radius: 44, color: SHRINE_VIOLET, intensity: 0.34, flicker: 0.24 });

  lights.push(doorLight(R1.doorOut + 1, F.y + F.h - 0.4));
  lights.push(doorLight(R1.doorIn + 1, F.y - 0.6));

  const zones: Zone[] = [
    { kind: 'camera', id: 'bounds', x: 0, y: 0, w: ROOM_W, h: ROOM_H },
    { kind: 'door', id: 'to_entrance', x: R1.doorIn, y: northZoneY(F), w: 2, h: 1, to: 'shrine_entrance', spawn: 'south', facing: 'n' },
    { kind: 'trigger', id: 'r1_enter', x: R1.doorIn, y: F.y, w: 2, h: 2 },
  ];
  if (hasMap('shrine_combat')) {
    zones.push({
      kind: 'door', id: 'to_r2', x: R1.doorOut, y: southZoneY(F), w: 2, h: 1,
      to: 'shrine_combat', spawn: 'north', facing: 's', requires: 'shrine_r1_done',
    });
  }

  return {
    id: 'shrine_association',
    name: 'The Echo Shrine',
    subtitle: 'the west chamber',
    music: 'shrine',
    tint: 0x0d1030,
    darkness: 0.5,
    ground,
    legend: SHRINE_LEGEND,
    objects: o.rows(),
    above: above.rows(),
    objectLegend: SHRINE_OBJECTS,
    props,
    lights,
    zones,
    spawns: {
      default: { x: R1.doorIn + 0.5, y: F.y, facing: 's' },
      north: { x: R1.doorIn + 0.5, y: F.y, facing: 's' },
      south: { x: R1.doorOut + 0.5, y: F.y + F.h - 1, facing: 'n' },
      respawn: { x: R1.doorIn + 0.5, y: F.y, facing: 's' },
    },
  };
}

registerMap('shrine_association', build);
