/**
 * ECHO SHRINE — ROOM FIVE: all three at once. (plan.md §43)
 *
 * THE ROOM, IN THE ORDER YOU SEE IT
 * ─────────────────────────────────
 *   the flock      four creatures in the middle of the floor, three of them
 *                  holding station on the fourth
 *   three chimes   three stone bowls on plinths, west, north-east and east,
 *                  each of which rings a three-note pattern when it is put down
 *   three plates   one in the far north-west alcove and two in the south-east,
 *                  none of them anywhere near each other
 *   the seal       a barred door under a great cracked disc. That is the way on,
 *                  and it is the only room in the dungeon where the door tells
 *                  you what is behind it.
 *
 * THE EVIDENCE
 * ────────────
 * The leader has lived in this room for a long time. It has worn a hollow in the
 * moss hard up against the *west* plinth, and the dust in front of the east one
 * is scored with long straight lines all leading away. The third plinth, in the
 * north-east, has not been touched at all. Three plinths, three pieces of
 * physical evidence, three completely different results — and the player is
 * never told which is which, only shown what the floor looks like.
 *
 * WHY THE PLATES ARE WHERE THEY ARE
 * ─────────────────────────────────
 * The flock holds a fixed shape: two out to the sides and one behind. The two
 * south-east plates are exactly one of those offsets apart, so a single well
 * placed chime holds both. The north-west plate is nowhere near any of the
 * offsets from either of them. There is no position of the leader that holds all
 * three, which is what forces the third idea.
 *
 * The floor is otherwise as bare as the room can be made. Five creatures, three
 * plinths, three plates and a seal is already more loud objects than any other
 * room in the shrine, and the composition only survives if the flagstone under
 * them is silent.
 */
import { GridPainter } from '../GridPainter';
import { hasMap, registerMap } from '../registry';
import type { LightDef, MapDef, PropPlacement, Zone } from '../types';
import {
  ROOM_FLOOR, ROOM_H, ROOM_W, SHRINE_LEGEND, SHRINE_OBJECTS, SHRINE_VIOLET,
  brazierLight, crystalLight, doorLight, doorNorth, doorSouth, northZoneY, southZoneY,
} from './shrine_common';

const F = ROOM_FLOOR;

export interface ChimeSpec {
  id: 'west' | 'northeast' | 'east';
  /** Tile coords of the plinth. */
  x: number;
  y: number;
  /** Which of the three shrine tones it rings, in order. */
  pattern: Array<'a' | 'b' | 'c'>;
  /** What the leader learned this pattern means. */
  effect: 'come' | 'flee' | 'nothing';
  /** The physical trace it left on the floor, for RECALL. */
  clue: { context: string; text: string };
}

export const R5 = {
  doorIn: 13,
  doorOut: 13,
  /** Where the flock is standing when you walk in. */
  leader: { x: 14, y: 8 },
  /** Follower stations, as tile offsets from the leader. */
  offsets: [
    { id: 'left', dx: -2, dy: 1 },
    { id: 'right', dx: 2, dy: 1 },
    { id: 'back', dx: 0, dy: 2 },
  ],
  /**
   * Three plates. `far` cannot be reached by the same placement as the pair,
   * because (far - pair) is not a difference between any two flock stations.
   */
  plates: [
    { id: 'far', x: 8, y: 4 },
    { id: 'pair_a', x: 20, y: 10 },
    { id: 'pair_b', x: 18, y: 11 },
  ],
  chimes: [
    {
      id: 'west', x: 4.6, y: 9, pattern: ['a', 'c', 'b'], effect: 'come',
      clue: {
        context: 'roost',
        text: 'A hollow worn smooth in the moss, hard up against the plinth. Something sleeps as close to this as it can get.',
      },
    },
    {
      id: 'east', x: 25.4, y: 8, pattern: ['a', 'b', 'c'], effect: 'flee',
      clue: {
        context: 'bolted',
        text: 'The grit here is scored in long straight lines, every one of them leading away from the plinth.',
      },
    },
    {
      id: 'northeast', x: 22, y: 4, pattern: ['c', 'c', 'a'], effect: 'nothing',
      clue: {
        context: 'untouched',
        text: 'Dust lying flat to the foot of the plinth, undisturbed. Nothing has ever come to this one.',
      },
    },
  ] as ChimeSpec[],
  /** The progress channel under the seal: one plate per pressure plate held. */
  channel: [
    { x: 13, y: 12 },
    { x: 14, y: 12 },
    { x: 13, y: 13 },
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

  doorNorth(g, R5.doorIn, F);
  doorSouth(g, R5.doorOut, F);

  // The roost. Wet, mossy, and unmistakably lived in — the same material
  // vocabulary the player has been reading since the entrance hall.
  g.blob(5, 9.4, 3.4, 3.4, '*', 11, 0.55);
  g.blob(4.4, 9.6, 1.6, 1.2, 'w', 13, 0.5);
  g.scatter('*', ['.'], 0.3, 17, { x: F.x, y: F.y + 4, w: 4, h: 7 });

  // The east end is dry: grit, cracked slabs, and the scored lines leading away
  // from the plinth that the player is supposed to notice.
  g.blob(24.4, 8.4, 3.2, 3.6, ':', 19, 0.45);
  g.scatter('%', ['.', ':'], 0.3, 23, { x: F.x + F.w - 5, y: F.y, w: 5, h: F.h });
  for (let i = 0; i < 5; i++) g.set(24 - i, 8 + (i % 2), '%');
  for (let i = 0; i < 4; i++) g.set(24 - i, 9 - (i % 2), '%');

  g.scatter(':', ['.'], 0.09, 29);
  for (const c of R5.channel) g.set(c.x, c.y, 'g');

  const ground = g.rows();

  const o = new GridPainter(ROOM_W, ROOM_H, ' ');
  o.scatter('R', [' '], 0.42, 31, { x: F.x, y: F.y, w: F.w, h: 1 });
  o.scatter('R', [' '], 0.3, 37, { x: F.x, y: F.y + F.h - 2, w: 3, h: 2 });
  // The flock's floor is empty. All of it. Nothing loose anywhere a creature
  // might have to stand, which is most of the room.
  for (let y = F.y + 1; y < F.y + F.h; y++) for (let x = F.x + 1; x < F.x + F.w - 1; x++) o.set(x, y, ' ');

  const above = new GridPainter(ROOM_W, ROOM_H, ' ');
  for (const x of [5, 9, 20, 25]) above.set(x, F.y - 1, 'T');

  const props: PropPlacement[] = [];
  const lights: LightDef[] = [];

  // The three plinths. Broken instruments: the observatory's own resonators,
  // which is why there are three of them and why they ring.
  const PLINTH_LIGHT: Record<string, number> = { west: 0x8ce6e6, east: 0xffb046, northeast: 0xc48cff };
  R5.chimes.forEach((c, i) => {
    props.push({
      key: `prop/shrine/broken_instrument_${i % 3}`,
      x: c.x, y: c.y,
      spec: { solid: [22, 10] },
      id: `plinth_${c.id}`,
    });
    // Each plinth is lit in its own colour: the chime you are carrying and the
    // plinth it came from have to be identifiable from across the room, and the
    // trace on the floor beside it has to be readable at all.
    lights.push({ x: c.x, y: c.y - 1.2, radius: 62, color: PLINTH_LIGHT[c.id], intensity: 0.5, flicker: 0.16 });
  });

  // The seal over the way on. It is the only door in the shrine that is lit
  // from behind, and it is the reason nobody has to be told where to go next.
  props.push({ key: 'prop/shrine/boss_seal_0', x: R5.doorOut + 0.5, y: F.y + F.h - 1, spec: { anim: 'shrine_boss_seal', depthBias: -80 }, id: 'seal' });
  lights.push({ x: R5.doorOut + 1, y: F.y + F.h - 1.6, radius: 96, color: SHRINE_VIOLET, intensity: 0.56, flicker: 0.26 });

  // Pillars along the south wall only, flanking the seal. The middle of this
  // room is a road the flock has to be able to walk, and a pillar standing in
  // it would wedge a creature against it for the rest of the dungeon.
  const PILLARS: Array<[number, number, string | undefined]> = [
    [5, 13, 'carving.last'],
    [10, 13, 'carving.thirtythree'],
    [17, 13, 'carving.thirtysix'],
    [22, 13, undefined],
  ];
  PILLARS.forEach(([x, y, carving], i) => {
    props.push({
      key: `prop/shrine/pillar_${i % 3}`,
      x, y,
      spec: { solid: [20, 10], ...(carving ? { interact: carving } : {}) },
    });
  });

  props.push({ key: 'prop/shrine/crystal_0', x: 3.8, y: 11.4, spec: { anim: 'shrine_crystal' } });
  lights.push(crystalLight(3.8, 10.8, 58));
  props.push({ key: 'prop/shrine/brazier_0', x: 26.2, y: 12.6, spec: { anim: 'shrine_brazier', solid: [14, 8] } });
  lights.push(brazierLight(26.2, 11.6, 70));
  props.push({ key: 'prop/shrine/brazier_0', x: 26.2, y: 4.4, spec: { anim: 'shrine_brazier', solid: [14, 8] } });
  lights.push(brazierLight(26.2, 3.4, 64));
  props.push({ key: 'prop/shrine/echo_pool_0', x: 5.4, y: 6, spec: { anim: 'shrine_echo_pool', depthBias: -60 } });
  lights.push({ x: 5.4, y: 5.4, radius: 44, color: SHRINE_VIOLET, intensity: 0.32, flicker: 0.24 });

  // The three plates get their own light. They are the goal state and they are
  // three tiles apart from anything else in the room.
  // Amber, in a room that is otherwise entirely violet and cyan. A plate is the
  // goal state of this puzzle and there are three of them in three corners of
  // the floor; they have to be findable from anywhere, not just recognisable
  // once you are standing on one.
  for (const p of R5.plates) {
    lights.push({ x: p.x, y: p.y, radius: 60, color: 0xffb937, intensity: 0.78, flicker: 0.08 });
  }
  // A wash over the middle so the flock reads as four bodies rather than four
  // smudges. They are the piece of puzzle state the player has to count.
  lights.push({ x: 14, y: 8.6, radius: 190, color: 0x7d8cc4, intensity: 0.38, flicker: 0 });

  lights.push(doorLight(R5.doorIn + 1, F.y - 0.6));

  const zones: Zone[] = [
    { kind: 'camera', id: 'bounds', x: 0, y: 0, w: ROOM_W, h: ROOM_H },
    { kind: 'door', id: 'to_r4', x: R5.doorIn, y: northZoneY(F), w: 2, h: 1, to: 'shrine_conformity', spawn: 'south', facing: 'n', requires: 'shrine_r5_done' },
    { kind: 'trigger', id: 'r5_enter', x: R5.doorIn, y: F.y, w: 2, h: 2 },
  ];
  // The boss chamber is another author's map. Never hard-fail on its absence —
  // without it the seal simply stays shut and `shrine_r5_done` is still set.
  if (hasMap('shrine_boss')) {
    zones.push({
      kind: 'door', id: 'to_boss', x: R5.doorOut, y: southZoneY(F), w: 2, h: 1,
      to: 'shrine_boss', spawn: 'south', facing: 's', requires: 'shrine_r5_done',
    });
  }

  return {
    id: 'shrine_combination',
    name: 'The Echo Shrine',
    subtitle: 'the last door',
    music: 'shrine',
    tint: 0x0d1030,
    darkness: 0.40,
    ground,
    legend: SHRINE_LEGEND,
    objects: o.rows(),
    above: above.rows(),
    objectLegend: SHRINE_OBJECTS,
    props,
    lights,
    zones,
    spawns: {
      default: { x: R5.doorIn + 0.5, y: F.y, facing: 's' },
      north: { x: R5.doorIn + 0.5, y: F.y, facing: 's' },
      south: { x: R5.doorOut + 0.5, y: F.y + F.h - 1, facing: 'n' },
      respawn: { x: R5.doorIn + 0.5, y: F.y, facing: 's' },
    },
  };
}

registerMap('shrine_combination', build);
