/**
 * ECHO SHRINE — ROOM TWO: the collapsed array. (plan.md §40)
 *
 * No lesson. This is the room that stops the dungeon being a quiz, and the plan
 * is explicit that it matters: "Not every room should be a lesson."
 *
 * The composition follows the A Link to the Past combat-room reference, which
 * is a small rectangle with a strong boundary and a *reason to move*:
 *
 *   THE WRECK.  An observation array came down through the ceiling and is lying
 *   in five pieces across the middle of the floor. It is solid, it is four tiles
 *   across, and it is the only thing in the room that is not a wall or an enemy.
 *   Everything the encounter is about is that mass: it breaks the wisps' line of
 *   fire, it stops a bramble charge dead, and it means the room can never be
 *   fought from one spot.
 *
 *   THE READ.  Two wisps hold the far corners and three brambles are spread
 *   across the middle. On entry that composition says one thing immediately —
 *   the shooters are at the back, the chargers are in the way, and there is
 *   cover in the middle. That is tactical information delivered by placement
 *   rather than by a tutorial.
 *
 *   THE FRAME.  Bars come down behind you and the way on is barred until the
 *   floor is clear. A combat room that you can walk out of is a corridor.
 *
 * It is also the only dry room in the first half of the shrine: no moss, no
 * water, cracked slabs and dust. Rooms one and three are wet; this one is not,
 * which keeps the shrine's damp/dry vocabulary in the player's eye between the
 * room that introduces it and the room that needs it.
 */
import { GridPainter } from '../GridPainter';
import { hasMap, registerMap } from '../registry';
import type { LightDef, MapDef, PropPlacement, Zone } from '../types';
import {
  ROOM_FLOOR, ROOM_H, ROOM_W, SHRINE_LEGEND, SHRINE_OBJECTS,
  brazierLight, crystalLight, doorLight, doorNorth, doorSouth, northZoneY, southZoneY,
} from './shrine_common';

const F = ROOM_FLOOR;

export const R2 = {
  doorIn: 13,
  doorOut: 13,
  /** Where the fight is composed. Tiles. */
  brambles: [[8, 6], [21, 6], [14.5, 12]] as Array<[number, number]>,
  wisps: [[5, 11], [24.5, 10]] as Array<[number, number]>,
} as const;

function build(): MapDef {
  const g = new GridPainter(ROOM_W, ROOM_H, '#');
  g.rect(F.x, F.y, F.w, F.h, '.');
  for (let x = F.x - 1; x <= F.x + F.w; x++) g.set(x, F.y - 1, 'N');
  for (let y = F.y; y < F.y + F.h; y++) { g.set(F.x - 1, y, 'W'); g.set(F.x + F.w, y, 'E'); }
  for (let x = F.x; x < F.x + F.w; x++) g.set(x, F.y + F.h, 'S');
  g.set(F.x - 1, F.y + F.h, 'q');
  g.set(F.x + F.w, F.y + F.h, 'p');

  doorNorth(g, R2.doorIn, F);
  doorSouth(g, R2.doorOut, F);

  // The impact: cracked slabs radiating from where the array came down, rubble
  // banked where it slid. All of it is floor you can fight on.
  g.blob(14.6, 8.6, 6.4, 3.4, ':', 11, 0.4);
  g.blob(14.6, 8.6, 3.2, 1.7, '%', 13, 0.45);
  g.scatter('%', ['.', ':'], 0.26, 17, { x: F.x, y: F.y, w: 4, h: 3 });
  g.scatter('%', ['.', ':'], 0.26, 19, { x: F.x + F.w - 4, y: F.y + F.h - 3, w: 4, h: 3 });
  g.scatter(':', ['.'], 0.12, 23);
  // A hole punched through the ceiling above the wreck let the rain in once.
  g.set(14, 3, '=');
  g.set(15, 3, '=');

  const ground = g.rows();

  const o = new GridPainter(ROOM_W, ROOM_H, ' ');
  o.scatter('R', [' '], 0.4, 29, { x: F.x, y: F.y, w: F.w, h: 1 });
  o.scatter('R', [' '], 0.34, 31, { x: F.x, y: F.y + F.h - 1, w: F.w, h: 1 });
  // The fighting floor stays clear of loose dressing: every solid in this room
  // has to be one the player can see and plan around.
  for (let y = F.y + 1; y < F.y + F.h - 1; y++) for (let x = F.x + 1; x < F.x + F.w - 1; x++) o.set(x, y, ' ');

  const above = new GridPainter(ROOM_W, ROOM_H, ' ');
  for (const x of [6, 13, 16, 23]) above.set(x, F.y - 1, 'T');

  const props: PropPlacement[] = [];
  const lights: LightDef[] = [];

  // ── the wreck ────────────────────────────────────────────────────────────
  props.push({ key: 'prop/shrine/broken_instrument_0', x: 13, y: 8.4, spec: { solid: [26, 12] } });
  props.push({ key: 'prop/shrine/broken_instrument_1', x: 16.2, y: 8.8, spec: { solid: [26, 12] } });
  props.push({ key: 'prop/shrine_ext/column_broken_1', x: 11.4, y: 9.6, spec: { solid: [20, 10] } });
  props.push({ key: 'prop/shrine_ext/column_broken_2', x: 18, y: 9.8, spec: { solid: [20, 10] } });
  props.push({ key: 'prop/shrine/rubble_0', x: 12.2, y: 10.6 });
  props.push({ key: 'prop/shrine/rubble_2', x: 17.2, y: 10.8 });
  // One crystal still lit in the wreckage: the room's centre has a light of its
  // own, so silhouettes stay readable in the middle of a fight.
  props.push({ key: 'prop/shrine/crystal_0', x: 14.7, y: 7.4, spec: { anim: 'shrine_crystal' } });
  lights.push(crystalLight(14.7, 7, 72));

  // ── the frame ────────────────────────────────────────────────────────────
  const CORNERS: Array<[number, number, string | undefined]> = [
    [4.6, 5, 'carving.twelve'],
    [25.4, 5, undefined],
    [4.6, 12.6, undefined],
    [25.4, 12.6, 'carving.fifteen'],
  ];
  CORNERS.forEach(([x, y, carving], i) => {
    props.push({
      key: `prop/shrine/pillar_${i % 3}`,
      x, y,
      spec: { solid: [20, 10], ...(carving ? { interact: carving } : {}) },
    });
  });

  // Four braziers and the brightest darkness level in the shrine. A combat room
  // is the one place where atmosphere must lose an argument with legibility:
  // an enemy silhouette you cannot separate from the flagstone is not a
  // telegraph, it is an ambush (see the Stardew mine reference).
  for (const [x, y] of [[3.8, 6], [26.2, 6], [3.8, 12.4], [26.2, 12.4]] as Array<[number, number]>) {
    props.push({ key: 'prop/shrine/brazier_0', x, y, spec: { anim: 'shrine_brazier', solid: [14, 8] } });
    lights.push(brazierLight(x, y - 1, 96));
  }
  // And the wreck itself throws light across the middle of the floor.
  lights.push({ x: 14.7, y: 8.4, radius: 104, color: 0x8ce6e6, intensity: 0.34, flicker: 0.1 });

  lights.push(doorLight(R2.doorIn + 1, F.y - 0.6));
  lights.push(doorLight(R2.doorOut + 1, F.y + F.h - 0.4));

  const zones: Zone[] = [
    { kind: 'camera', id: 'bounds', x: 0, y: 0, w: ROOM_W, h: ROOM_H },
    { kind: 'door', id: 'to_r1', x: R2.doorIn, y: northZoneY(F), w: 2, h: 1, to: 'shrine_association', spawn: 'south', facing: 'n', requires: 'shrine_r2_done' },
    { kind: 'trigger', id: 'r2_enter', x: R2.doorIn, y: F.y, w: 2, h: 2 },
  ];
  if (hasMap('shrine_memory')) {
    zones.push({
      kind: 'door', id: 'to_r3', x: R2.doorOut, y: southZoneY(F), w: 2, h: 1,
      to: 'shrine_memory', spawn: 'north', facing: 's', requires: 'shrine_r2_done',
    });
  }

  return {
    id: 'shrine_combat',
    name: 'The Echo Shrine',
    subtitle: 'the collapsed array',
    music: 'shrine',
    tint: 0x0d1030,
    darkness: 0.34,
    ground,
    legend: SHRINE_LEGEND,
    objects: o.rows(),
    above: above.rows(),
    objectLegend: SHRINE_OBJECTS,
    props,
    lights,
    zones,
    spawns: {
      default: { x: R2.doorIn + 0.5, y: F.y, facing: 's' },
      north: { x: R2.doorIn + 0.5, y: F.y, facing: 's' },
      south: { x: R2.doorOut + 0.5, y: F.y + F.h - 1, facing: 'n' },
      respawn: { x: R2.doorIn + 0.5, y: F.y, facing: 's' },
    },
  };
}

registerMap('shrine_combat', build);
