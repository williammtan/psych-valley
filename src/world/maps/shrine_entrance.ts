/**
 * ECHO SHRINE — THE ENTRANCE HALL AND THE DESCENT.
 *
 * The first room of the dungeon has one job and it is not a puzzle: it has to
 * make the player believe they have gone underground into somewhere that was
 * built, used, and then left. Everything here is composition.
 *
 *   THE SHAFT.  You do not arrive in the hall, you arrive in a four-tile slot
 *   cut through solid rock and walk down seven rows of steps to reach it. That
 *   descent costs about four seconds and it is the cheapest possible way to
 *   sell "this is under the valley now". The shaft is deliberately claustrophobic
 *   so the hall reads as enormous when it opens out.
 *
 *   THE COLONNADE.  Two rows of pillars run the length of the hall with the aisle
 *   between them, and the aisle points at exactly one thing: the door down. A
 *   player who has never played a Zelda game still walks straight to it.
 *
 *   THE ARRAY.  Broken brass instruments stand against both long walls, all of
 *   them aimed downward. The place was an observatory pointed at the ground.
 *   Nobody says this out loud; the props say it.
 *
 *   THE WATER.  A spring has been running down the stair for a century. Moss
 *   climbs out of the shaft mouth and the west end of the hall is under an inch
 *   of water. It is the first appearance of the damp/dry vocabulary that room
 *   three then makes load-bearing — by the time it matters the player has been
 *   reading it for ten minutes without noticing.
 *
 * Light comes from four braziers, two crystals and the echo pool. Nothing here
 * is lit by ambience.
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import { hasMap } from '../registry';
import type { LightDef, MapDef, PropPlacement, Zone } from '../types';
import {
  SHRINE_LEGEND, SHRINE_OBJECTS, brazierLight, crystalLight, doorLight, echoLight,
  doorNorth, doorSouth, roomFill, shell, southZoneY, type Rect,
} from './shrine_common';

const W = 30;
const H = 26;

/** The hall proper. The shaft above it is carved separately. */
export const HALL: Rect = { x: 3, y: 9, w: 24, h: 14 };
/** The descent: four tiles wide, which is as narrow as two people can walk. */
const SHAFT = { x: 13, w: 4, top: 2, bottom: 8 };

function build(): MapDef {
  const g = shell(W, H, HALL);

  // ── the shaft ────────────────────────────────────────────────────────────
  // Carved out of the cap, with its own wall faces, so the corridor reads as
  // masonry rather than as a hole someone forgot to fill in.
  for (let y = SHAFT.top; y <= SHAFT.bottom; y++) {
    for (let x = SHAFT.x; x < SHAFT.x + SHAFT.w; x++) g.set(x, y, '.');
    g.set(SHAFT.x - 1, y, 'W');
    g.set(SHAFT.x + SHAFT.w, y, 'E');
  }
  for (let x = SHAFT.x - 1; x <= SHAFT.x + SHAFT.w; x++) g.set(x, SHAFT.top - 1, 'N');
  // The stair itself. Five rows of steps, then a landing before the hall.
  for (let y = 3; y <= 7; y++) for (let x = SHAFT.x; x < SHAFT.x + SHAFT.w; x++) g.set(x, y, 'x');
  // Open the shaft into the hall's north wall band.
  for (let x = SHAFT.x; x < SHAFT.x + SHAFT.w; x++) g.set(x, HALL.y - 1, '_');

  // ── thresholds ───────────────────────────────────────────────────────────
  doorNorth(g, 14, { x: SHAFT.x, y: SHAFT.top, w: SHAFT.w, h: 1 });  // up, to the woods
  doorSouth(g, 14, HALL);                                            // down, to room one

  // ── water and moss ───────────────────────────────────────────────────────
  // The spring comes down the stair and pools at the low west end.
  for (let y = 3; y <= 8; y++) g.setIf(SHAFT.x + 1, y, 'w', ['x', '.']);
  g.blob(14.5, 10.2, 3.2, 1.2, 'w', 11, 0.5);
  g.blob(14.5, 10.8, 4.2, 1.7, '*', 13, 0.6);
  g.blob(5.2, 20.4, 2.4, 1.4, 'w', 17, 0.55);
  g.blob(5.2, 20.4, 3.6, 2.1, '*', 19, 0.6);
  g.scatter('*', ['.'], 0.16, 23, { x: HALL.x, y: HALL.y, w: HALL.w, h: 1 });

  // Dry damage at the far end: cracked slabs, then rubble against the walls.
  g.blob(21, 18, 4.4, 2.6, ':', 29, 0.5);
  g.scatter('%', ['.', ':'], 0.34, 31, { x: 22, y: HALL.y + 8, w: 5, h: 5 });
  g.scatter(':', ['.'], 0.1, 37);

  const ground = g.rows();

  // ── loose dressing ───────────────────────────────────────────────────────
  const o = new GridPainter(W, H, ' ');
  // Rubble banks in the corners: the hall is 24 tiles wide and the corners are
  // where a big empty room shows the seams.
  o.scatter('R', [' '], 0.5, 41, { x: HALL.x, y: HALL.y + 11, w: 4, h: 3 });
  o.scatter('R', [' '], 0.5, 43, { x: HALL.x + HALL.w - 4, y: HALL.y + 11, w: 4, h: 3 });
  o.scatter('R', [' '], 0.4, 47, { x: HALL.x, y: HALL.y, w: HALL.w, h: 1 });
  // Keep the aisle and the stair mouth absolutely clear.
  for (let y = HALL.y; y < HALL.y + HALL.h; y++) for (let x = 10; x <= 19; x++) o.set(x, y, ' ');

  const above = new GridPainter(W, H, ' ');
  for (const x of [12, 17]) above.set(x, SHAFT.top - 1, 'T');
  for (const x of [4, 8, 21, 25]) above.set(x, HALL.y - 1, 'T');

  // ── props ────────────────────────────────────────────────────────────────
  const props: PropPlacement[] = [];
  const lights: LightDef[] = [];

  const brazier = (x: number, y: number) => {
    props.push({ key: 'prop/shrine/brazier_0', x, y, spec: { anim: 'shrine_brazier', solid: [14, 8] } });
    lights.push(brazierLight(x, y - 1, 68));
  };
  const crystal = (x: number, y: number) => {
    props.push({ key: 'prop/shrine/crystal_0', x, y, spec: { anim: 'shrine_crystal' } });
    lights.push(crystalLight(x, y - 1, 44));
  };

  // The colonnade. Three pairs, evenly spaced, with the aisle between them.
  const COLUMNS: Array<[number, number, string | undefined]> = [
    [6.5, 12, 'carving.one'],
    [23.5, 12, 'carving.four'],
    [6.5, 16, undefined],
    [23.5, 16, 'carving.seven'],
    [6.5, 20, undefined],
    [23.5, 20, undefined],
  ];
  COLUMNS.forEach(([x, y, carving], i) => {
    props.push({
      key: `prop/shrine/pillar_${i % 3}`,
      x, y,
      spec: { solid: [20, 10], ...(carving ? { interact: carving } : {}) },
    });
  });

  // Two crystals in the shaft, so the descent is lit by something you can see.
  crystal(12.5, 4);
  crystal(17.5, 6);

  brazier(4.5, 11);
  brazier(25.5, 11);
  brazier(4.5, 22);
  brazier(25.5, 22);

  // The observation array, ruined, aimed at the floor.
  props.push({ key: 'prop/shrine/broken_instrument_0', x: 3.8, y: 15, spec: { solid: [22, 10] } });
  props.push({ key: 'prop/shrine/broken_instrument_1', x: 26.2, y: 15, spec: { solid: [22, 10] } });
  props.push({ key: 'prop/shrine/broken_instrument_2', x: 3.8, y: 18, spec: { solid: [22, 10] } });
  props.push({ key: 'prop/shrine/broken_instrument_0', x: 26.2, y: 18.6, spec: { solid: [22, 10] } });

  // The echo pool: the room's centre and the reason the hall is violet.
  props.push({ key: 'prop/shrine/echo_pool_0', x: 14.5, y: 16, spec: { anim: 'shrine_echo_pool', depthBias: -60 }, id: 'pool' });
  lights.push(echoLight(14.5, 15.4, 76));

  // A chest by the west wall — the last thing you find before it gets serious.
  props.push({ key: 'prop/shrine/chest_closed', x: 4.6, y: 20.6, spec: { solid: [22, 10] }, id: 'chest' });

  lights.push(roomFill(14.5, 9, 260, 0.46));
  lights.push(doorLight(14.5, HALL.y + HALL.h - 0.4));
  lights.push(doorLight(14.5, SHAFT.top - 0.4));

  const zones: Zone[] = [
    { kind: 'camera', id: 'bounds', x: 0, y: 0, w: W, h: H },
    { kind: 'door', id: 'to_woods', x: 14, y: 0, w: 2, h: 1, to: 'woods', spawn: 'shrine', facing: 'n' },
    { kind: 'trigger', id: 'shrine_arrive', x: SHAFT.x, y: 9, w: SHAFT.w, h: 2 },
    { kind: 'trigger', id: 'echo_sighting', x: 10, y: 13, w: 10, h: 3 },
  ];
  if (hasMap('shrine_association')) {
    zones.push({
      kind: 'door', id: 'to_r1', x: 14, y: southZoneY(HALL), w: 2, h: 1,
      to: 'shrine_association', spawn: 'north', facing: 's',
    });
  }

  return {
    id: 'shrine_entrance',
    name: 'The Echo Shrine',
    subtitle: 'the entrance hall',
    music: 'shrine',
    indoor: false,
    tint: 0x0d1030,
    darkness: 0.2,
    ground,
    legend: SHRINE_LEGEND,
    objects: o.rows(),
    above: above.rows(),
    objectLegend: SHRINE_OBJECTS,
    props,
    lights,
    npcs: [
      // "Together as far as the first door. Then I hold the lantern and shout
      // usefully." — she means it, and she does not follow you down.
      { id: 'sera', x: 11.5, y: 17, facing: 'e' },
    ],
    zones,
    spawns: {
      default: { x: 14.5, y: SHAFT.top, facing: 's' },
      north: { x: 14.5, y: SHAFT.top, facing: 's' },
      south: { x: 14.5, y: HALL.y + HALL.h - 1, facing: 'n' },
      /** plan.md §67: back on your feet at the bottom of the stair. */
      respawn: { x: 14.5, y: HALL.y + 1, facing: 's' },
    },
  };
}

registerMap('shrine_entrance', build);
