/**
 * LUMEN VALE — the town.
 *
 * SCAFFOLD VERSION. This exists to validate the pipeline end-to-end; the full
 * composition (density, landmarks, NPC routines, all six buildings) is built by
 * the Lumen Vale map pass. Layout follows plan.md §4:
 *
 *              Festival Plaza (N)
 *                     |
 *   Courier Row ── Bell Tower
 *        |            |
 *        |        Town Square
 *   Sera's Lab ──────┴────── Lantern Inn
 *                     |
 *                South Gate → Whisper Woods
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { MapDef } from '../types';

const W = 56;
const H = 44;

function build(): MapDef {
  const g = new GridPainter(W, H, '.');

  // Grass texture variation: two scatter densities so the field isn't uniform.
  g.scatter(',', ['.'], 0.34, 11);
  g.scatter('"', ['.', ','], 0.09, 29);

  // The river runs down the east side with a bridge at the town's latitude.
  g.vLine(0, H - 1, 45, '~', 4);
  g.blob(45, 12, 4, 5, '~', 3, 0.35);
  g.blob(46, 32, 4, 6, '~', 5, 0.35);
  // Banks read as sand where the water meets the field.
  for (let y = 0; y < H; y++) {
    for (let x = 40; x < W; x++) {
      if (g.get(x, y) !== '~') continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (g.get(x + dx, y + dy) === '.' || g.get(x + dx, y + dy) === ',' || g.get(x + dx, y + dy) === '"') {
          g.set(x + dx, y + dy, 's');
        }
      }
    }
  }

  // Town square: flagstone, the navigational anchor the player returns to.
  g.rect(20, 20, 15, 11, 'p');
  g.blob(27, 25, 8, 6, 'p', 9, 0.18);

  // Main north-south road through town, and the east-west street.
  g.vLine(2, H - 2, 27, 'p', 3);
  g.hLine(6, 44, 25, 'p', 3);
  // Bridge over the river.
  g.hLine(42, 50, 25, '=', 3);

  // Courier Row: a narrower western lane.
  g.vLine(14, 30, 10, 'd', 3);
  g.hLine(10, 26, 15, 'd', 2);

  // Festival plaza to the north.
  g.rect(20, 4, 16, 10, 'c');
  g.blob(28, 9, 8, 5, 'c', 13, 0.2);

  // South gate approach.
  g.rect(25, 38, 5, 6, 'd');

  // Building footprints are solid ground; the sprites sit on top.
  const footprints: Array<[number, number, number, number]> = [
    [36, 19, 7, 6],   // Lantern Inn
    [6, 19, 6, 6],    // Sera's Workshop
    [5, 9, 6, 5],     // Courier Office
    [37, 8, 6, 5],    // General store
    [25, 15, 5, 4],   // Bell tower base
    [14, 32, 6, 5],   // house
    [36, 31, 6, 5],   // house
  ];
  for (const [x, y, w, h] of footprints) g.rect(x, y, w, h, '#');

  // Tree line framing the map edges so the world doesn't end in flat grass.
  g.scatter('f', ['.', ','], 0.5, 41, { x: 0, y: 0, w: W, h: 3 });
  g.scatter('f', ['.', ','], 0.42, 43, { x: 0, y: 0, w: 4, h: H });
  g.scatter('f', ['.', ','], 0.3, 47, { x: 0, y: H - 3, w: 20, h: 3 });

  const ground = g.rows();

  // ── object layer ────────────────────────────────────────────────────────
  const o = new GridPainter(W, H, ' ');
  // Trees follow the 'f' marker cells.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) === 'f') o.set(x, y, 'T');
    }
  }
  // Bushes and flowers soften the edges of paths.
  o.scatter('b', [' '], 0.05, 61);
  o.scatter('l', [' '], 0.04, 67);

  // Clear objects off walkable surfaces and footprints.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gc = g.get(x, y);
      if (gc === 'p' || gc === 'c' || gc === 'd' || gc === '~' || gc === '=' || gc === '#' || gc === 's') {
        o.set(x, y, ' ');
      }
    }
  }

  return {
    id: 'lumen_vale',
    name: 'Lumen Vale',
    subtitle: 'a valley that remembers',
    music: 'town',
    ground,
    legend: {
      '.': { base: 'town/grass' },
      ',': { base: 'town/grass', scatter: 'sparse' },
      '"': { base: 'town/grass', scatter: 'lush' },
      'f': { base: 'town/grass' },
      'p': { base: 'town/grass', blob: 'path' },
      'c': { base: 'town/grass', blob: 'cobble' },
      'd': { base: 'town/grass', blob: 'dirt' },
      's': { base: 'town/grass', blob: 'sand' },
      '~': { base: 'town/grass', blob: 'water', solid: true },
      '=': { base: 'town/grass', blob: 'path', bridge: true },
      '#': { base: 'town/soil', solid: true },
    },
    scatterRules: {
      sparse: { density: 0.45, tiles: [['scatter/tuft_sm', 5], ['scatter/tuft_md', 3], ['scatter/pebbles', 1], ['', 6]] },
      lush: { density: 0.85, tiles: [['scatter/tuft_md', 4], ['scatter/tuft_lg', 3], ['scatter/flower_gold', 2], ['scatter/flower_white', 2], ['scatter/flower_rose', 1]] },
    },
    objects: o.rows(),
    objectLegend: {
      'T': { key: ['prop/town/tree_oak_0', 'prop/town/tree_oak_1', 'prop/town/tree_oak_2', 'prop/town/tree_oak_3'], solid: [14, 8] },
      'b': { key: ['prop/town/bush_0', 'prop/town/bush_1', 'prop/town/bush_2'], sway: 0.4 },
      'l': { key: ['prop/town/flowerbed_0', 'prop/town/flowerbed_1'] },
    },
    props: [
      { key: 'prop/build/inn', x: 39.5, y: 25, spec: { solid: [96, 40] }, id: 'inn' },
      { key: 'prop/build/workshop', x: 9, y: 25, spec: { solid: [84, 36] }, id: 'workshop' },
      { key: 'prop/build/courier', x: 8, y: 14, spec: { solid: [84, 32] }, id: 'courier' },
      { key: 'prop/build/store', x: 40, y: 13, spec: { solid: [84, 32] }, id: 'store' },
      { key: 'prop/build/belltower', x: 27.5, y: 19, spec: { solid: [64, 30] }, id: 'belltower' },
      { key: 'prop/build/house_a', x: 17, y: 37, spec: { solid: [72, 30] } },
      { key: 'prop/build/house_b', x: 39, y: 36, spec: { solid: [72, 30] } },
      { key: 'prop/town/fountain', x: 27, y: 26, spec: { solid: [40, 26], anim: 'fountain_idle' }, id: 'fountain' },
      { key: 'prop/town/notice_board', x: 23, y: 22, spec: { solid: [26, 10], interact: 'notice_board' }, id: 'notice_board' },
      { key: 'prop/town/bench_0', x: 31, y: 22, spec: { solid: [28, 8] } },
      { key: 'prop/town/bench_0', x: 23, y: 29, spec: { solid: [28, 8] } },
      { key: 'prop/town/lamppost', x: 21, y: 21, spec: {} },
      { key: 'prop/town/lamppost', x: 34, y: 30, spec: {} },
      { key: 'prop/town/cart', x: 15, y: 26, spec: { solid: [40, 14] } },
    ],
    npcs: [
      { id: 'mira', x: 37, y: 27, facing: 's', path: [[37, 27], [33, 27], [33, 24], [37, 24]], dwell: 2.4 },
      { id: 'villager_a', x: 24, y: 24, path: [[24, 24], [30, 24], [30, 28], [24, 28]], dwell: 2 },
      { id: 'villager_b', x: 12, y: 16, path: [[12, 16], [20, 16], [20, 22]], dwell: 3 },
      { id: 'villager_c', x: 43, y: 27, facing: 'e', dwell: 4 },
    ],
    zones: [
      { kind: 'door', id: 'to_inn', x: 39, y: 25, w: 2, h: 1, to: 'inn', spawn: 'default' },
      { kind: 'camera', id: 'bounds', x: 0, y: 0, w: W, h: H },
    ],
    lights: [
      { x: 21, y: 21, radius: 34, color: 0xffb937, intensity: 0.4, flicker: 0.5 },
      { x: 34, y: 30, radius: 34, color: 0xffb937, intensity: 0.4, flicker: 0.5 },
    ],
    spawns: {
      default: { x: 27, y: 27, facing: 'n' },
      arrival: { x: 27, y: 40, facing: 'n' },
      inn_door: { x: 39, y: 26, facing: 's' },
      north: { x: 27, y: 6, facing: 's' },
      south: { x: 27, y: 41, facing: 'n' },
    },
  };
}

registerMap('lumen_vale', build);
