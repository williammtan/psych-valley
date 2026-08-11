/**
 * THE LANTERN INN — Mira's, and the location of Quest One.
 *
 * The reference pack asks for "a place where someone lives and works, not a
 * rectangular quest room", so the footprint is deliberately L-shaped: a tall
 * common room with the hearth and the bar, and a kitchen wing off its
 * north-east corner reached through a three-tile arch. You cannot see the whole
 * building from any one position, which is what makes it worth walking around.
 *
 *        3        11      16 18
 *     ┌──────────────────────┐
 *   1 │  ▓▓▓  ▤▤   ▬▬▬▬  ═╗  │              ▓ fireplace   ▤ window
 *   3 │  ▓▓▓        ▦▦▦  ═╝  ├──────────┐   ▬ shelves     ═ stairs up
 *   5 │  ▒▒  🐈  ▉▉▉▉▉      │▪▪ ▬▬▬▬▬▬ │   ▉ bar         ▪ storeroom door
 *   7 │                     ╞═══╡ ▨▨   │   ▒ hearth rug   ▨ range
 *   9 │   ⊙    ⊙            │ ▬▬▬▬     │   ⊙ dining table
 *  11 │                     │  ▬  ▯    │   ▯ pantry
 *  13 │   ▤▤▤▤▤             └──────────┘
 *  15 │      ═╤═                            ╤ long table
 *  17 │   ▮  ══╧══   ▯                      ▮ coat rack
 *     └───────╨──────────────┘              ╨ front door
 *
 * The quest geometry is the whole point of the north-east corner: the crates
 * blocking Mira's storeroom, and the prep table Pip wedges himself under, are
 * within one screen of each other. Standing between them, the player can see
 * both the problem and the cat at the same time.
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { MapDef, PropPlacement } from '../types';

const W = 34;
const H = 20;

/** Anything the eye reads as built structure. Used for the wall-shadow pass. */
const STRUCTURE = new Set(['#', 'T', 'B', 'W', 'L', 'R', 'F', 'D', 'd', '/', '\\', '<', '>']);

function build(): MapDef {
  const g = new GridPainter(W, H, '#');

  // ── common room ──────────────────────────────────────────────────────────
  g.rect(3, 3, 16, 15, '.');        // floor, x 3..18, y 3..17
  g.hLine(3, 18, 1, 'T');           // back wall: crown course...
  g.hLine(3, 18, 2, 'B');           // ...and the skirted course below it
  g.vLine(1, 17, 2, 'L');           // west side
  g.vLine(1, 17, 19, 'R');          // east side
  g.hLine(2, 19, 18, 'F');          // near wall, seen from above

  // Windows either side of the hearth, and the staircase to the guest rooms.
  g.set(8, 2, 'W');
  g.set(9, 2, 'W');
  g.set(16, 1, '/'); g.set(17, 1, '\\');
  g.set(16, 2, '<'); g.set(17, 2, '>');

  // ── kitchen wing ─────────────────────────────────────────────────────────
  g.rect(21, 6, 10, 8, 'k');        // floor, x 21..30, y 6..13
  g.hLine(21, 30, 4, 'T');
  g.hLine(21, 30, 5, 'B');
  g.vLine(4, 13, 20, 'L');
  g.vLine(4, 13, 31, 'R');
  g.hLine(20, 31, 14, 'F');
  // The storeroom: a doorway in the wing's back wall. It stays shut all quest.
  g.set(21, 4, 'D'); g.set(22, 4, 'D');
  g.set(21, 5, 'd'); g.set(22, 5, 'd');

  // ── the arch between them ────────────────────────────────────────────────
  g.rect(19, 8, 1, 3, '.');
  g.rect(20, 8, 1, 3, 'k');

  // Warm plank floor in the pool of firelight, so the hearth reads from the door.
  g.rect(3, 3, 6, 5, 'w');

  // Front door.
  g.set(10, 18, '='); g.set(11, 18, '=');

  // ── wall shadow pass ─────────────────────────────────────────────────────
  // Every floor tile directly under built structure gets the soft cast shadow.
  // This is what stops the walls looking like painted stripes on the floor.
  const shadowed: Record<string, string> = { '.': '-', 'w': '+', 'k': ';' };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = g.get(x, y);
      if (!shadowed[c]) continue;
      if (STRUCTURE.has(g.get(x, y - 1))) g.set(x, y, shadowed[c]);
    }
  }

  return {
    id: 'inn',
    name: 'The Lantern Inn',
    subtitle: 'Mira\'s',
    music: 'inn',
    indoor: true,
    tint: 0x1b1526,
    darkness: 0.34,

    ground: g.rows(),
    legend: {
      '#': { base: 'blank', solid: true },
      '.': { base: 'int/wood_floor' },
      '-': { base: 'int/wood_floor', scatter: 'wall_shadow' },
      'w': { base: 'int/wood_floor_warm' },
      '+': { base: 'int/wood_floor_warm', scatter: 'wall_shadow' },
      'k': { base: 'int/stone_floor' },
      ';': { base: 'int/stone_floor', scatter: 'wall_shadow' },
      '=': { base: 'int/doormat' },
      'T': { base: 'int/wall_wood_top', solid: true },
      'B': { base: 'int/wall_wood_base', solid: true },
      'W': { base: 'int/wall_window', solid: true },
      'L': { base: 'int/wall_wood_corner_l', solid: true },
      'R': { base: 'int/wall_wood_corner_r', solid: true },
      'F': { base: 'int/wall_wood_front', solid: true },
      'D': { base: 'int/doorway_top', solid: true },
      'd': { base: 'int/doorway_base', solid: true },
      '/': { base: 'int/stairs_up_l_far', solid: true },
      '\\': { base: 'int/stairs_up_r_far', solid: true },
      '<': { base: 'int/stairs_up_l_near', solid: true },
      '>': { base: 'int/stairs_up_r_near', solid: true },
    },
    scatterRules: {
      wall_shadow: { density: 1, tiles: [['int/floor_shadow_n', 1]] },
    },

    props: props(),

    npcs: [
      { id: 'mira', x: 13, y: 4, facing: 's' },
      { id: 'villager_a', x: 12, y: 8, facing: 'n' },
      { id: 'villager_f', x: 6, y: 8, facing: 'n' },
    ],

    zones: [
      { kind: 'door', id: 'to_town', x: 10, y: 18, w: 2, h: 1, to: 'lumen_vale', spawn: 'inn_door', facing: 's' },
      // Wide enough that nobody can walk in without tripping it.
      { kind: 'trigger', id: 'q1_intro', x: 3, y: 12, w: 16, h: 4, forbids: 'q1_started' },
    ],

    lights: [
      { x: 5, y: 5, radius: 74, color: 0xff9436, intensity: 0.6, flicker: 0.85 },   // hearth
      { x: 8.5, y: 3, radius: 52, color: 0xa8c8f0, intensity: 0.3 },                // window
      { x: 7, y: 2.5, radius: 32, color: 0xffb937, intensity: 0.42, flicker: 0.5 }, // sconce
      { x: 15, y: 2.5, radius: 32, color: 0xffb937, intensity: 0.42, flicker: 0.5 },
      { x: 13, y: 6, radius: 46, color: 0xffc47a, intensity: 0.3 },                 // over the bar
      { x: 13, y: 10.4, radius: 26, color: 0xffb937, intensity: 0.36, flicker: 0.9 },
      { x: 7, y: 14.4, radius: 26, color: 0xffb937, intensity: 0.36, flicker: 0.9 },
      { x: 10.5, y: 17.5, radius: 40, color: 0xa8c8f0, intensity: 0.22 },           // front door
      { x: 26.5, y: 7, radius: 46, color: 0xff8a3c, intensity: 0.38, flicker: 0.6 },// range
      { x: 25.4, y: 10.4, radius: 42, color: 0xffb937, intensity: 0.4, flicker: 0.4 },
      { x: 22, y: 12, radius: 34, color: 0xffc47a, intensity: 0.2 },
    ],

    spawns: {
      default: { x: 10, y: 16, facing: 'n' },
      door: { x: 10, y: 16, facing: 'n' },
      hearth: { x: 7, y: 8, facing: 'n' },
      kitchen: { x: 22, y: 12, facing: 'n' },
    },
  };
}

/**
 * Furniture.
 *
 * Two rules run through this list. Tables and counters are solid, chairs are
 * not — a chair you can catch on is a chair that ruins the room. And anything
 * resting on a surface (mugs, candles, the hand bell) needs a positive
 * depthBias, or the table it stands on draws over the top of it.
 */
function props(): PropPlacement[] {
  return [
    // ── hearth ─────────────────────────────────────────────────────────────
    // Pip's rug, and — under the window, deliberately across the room from it —
    // the basket he has not slept in for nine days.
    { key: 'prop/int/inn_fireplace_0', x: 5, y: 4, spec: { anim: 'fireplace_burn', solid: [44, 26], interact: 'prop.innFireplace' }, id: 'fireplace' },
    { key: 'prop/int/inn_hearth_rug', x: 5, y: 6.4, spec: { depthBias: -70 }, id: 'hearthrug' },
    { key: 'prop/int/inn_firewood', x: 3.4, y: 5.2, spec: {} },
    { key: 'prop/int/inn_catbed', x: 8.4, y: 3.7, spec: { depthBias: -40, interact: 'clue.catbed' }, id: 'catbed' },
    { key: 'prop/int/inn_catbowl', x: 9.6, y: 3.7, spec: { depthBias: -40, interact: 'prop.innCatBowl' } },
    { key: 'prop/int/inn_picture_b', x: 3, y: 2, spec: {} },

    // ── back wall ──────────────────────────────────────────────────────────
    { key: 'prop/int/inn_sconce_0', x: 7, y: 2, spec: { anim: 'sconce_flicker' } },
    { key: 'prop/int/inn_curtain_l', x: 8, y: 2, spec: {} },
    { key: 'prop/int/inn_curtain_r', x: 9, y: 2, spec: {} },
    { key: 'prop/int/inn_picture_a', x: 10, y: 2, spec: {} },
    { key: 'prop/int/inn_shelf_bottles', x: 12, y: 2, spec: {} },
    { key: 'prop/int/inn_shelf_mugs', x: 14, y: 2, spec: {} },
    { key: 'prop/int/inn_sconce_0', x: 15, y: 2, spec: { anim: 'sconce_flicker' } },
    { key: 'prop/int/post_roster', x: 18, y: 2, spec: {}, id: 'roster' },
    { key: 'prop/int/inn_newel', x: 15.4, y: 3, spec: {} },
    { key: 'prop/int/inn_barrel', x: 18, y: 4.4, spec: { solid: [12, 8] } },

    // ── bar ────────────────────────────────────────────────────────────────
    { key: 'prop/int/inn_bar_l', x: 11, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_bar_mid', x: 12, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_bar_mid', x: 13, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_bar_mid', x: 14, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_bar_r', x: 15, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_lectern', x: 10, y: 5.4, spec: { solid: [12, 8] }, id: 'ledger' },
    { key: 'prop/int/inn_mug', x: 11.7, y: 4.9, spec: { depthBias: 26 } },
    { key: 'prop/town/bell_small', x: 12.8, y: 4.9, spec: { depthBias: 26 }, id: 'handbell' },
    { key: 'prop/int/inn_plate', x: 13.9, y: 4.9, spec: { depthBias: 26 } },
    { key: 'prop/int/inn_mug_half', x: 14.8, y: 4.9, spec: { depthBias: 26 } },
    { key: 'prop/int/inn_stool', x: 11.6, y: 7.6, spec: {} },
    { key: 'prop/int/inn_stool', x: 13.4, y: 7.6, spec: {} },
    { key: 'prop/int/inn_stool', x: 15.2, y: 7.6, spec: {} },

    // ── dining ─────────────────────────────────────────────────────────────
    { key: 'prop/int/rug_round', x: 6, y: 11, spec: { depthBias: -70 } },
    { key: 'prop/int/inn_table_round_set', x: 6, y: 10, spec: { solid: [26, 12] } },
    { key: 'prop/int/inn_chair_n', x: 6, y: 8.9, spec: {} },
    { key: 'prop/int/inn_chair_s', x: 6.2, y: 11.8, spec: {} },
    { key: 'prop/int/inn_chair_e', x: 7.7, y: 10.9, spec: {} },
    { key: 'prop/int/inn_chair_pushed', x: 4.4, y: 10.6, spec: {} },

    { key: 'prop/int/inn_table_round', x: 13, y: 11, spec: { solid: [26, 12] } },
    { key: 'prop/int/inn_chair_w', x: 11.5, y: 11.9, spec: {} },
    { key: 'prop/int/inn_chair_e', x: 14.5, y: 11.7, spec: {} },
    { key: 'prop/int/inn_chair_n', x: 13, y: 9.9, spec: {} },
    { key: 'prop/int/candle_0', x: 13, y: 10.4, spec: { anim: 'candle_flicker', depthBias: 26 } },

    { key: 'prop/int/inn_table_long', x: 8, y: 15, spec: { solid: [44, 12] } },
    { key: 'prop/int/inn_bench', x: 8, y: 16.7, spec: {} },
    { key: 'prop/int/inn_chair_e', x: 10.7, y: 15.4, spec: {} },
    { key: 'prop/int/inn_chair_w', x: 5.3, y: 15.2, spec: {} },
    { key: 'prop/int/candle_0', x: 7, y: 14.4, spec: { anim: 'candle_flicker', depthBias: 26 } },
    { key: 'prop/int/inn_soup', x: 9, y: 14.4, spec: { depthBias: 26 } },
    { key: 'prop/int/inn_mug', x: 8.2, y: 14.5, spec: { depthBias: 26 } },

    // ── odds and ends that say somebody lives here ─────────────────────────
    { key: 'prop/int/rug_runner', x: 11, y: 17.2, spec: { depthBias: -70 } },
    { key: 'prop/int/inn_coatrack', x: 4, y: 17, spec: { solid: [12, 6] } },
    { key: 'prop/int/boots', x: 5.5, y: 17.3, spec: {} },
    { key: 'prop/int/inn_clock', x: 3.4, y: 9, spec: { solid: [12, 6] } },
    { key: 'prop/int/inn_plant_b', x: 3.5, y: 12.4, spec: {} },
    { key: 'prop/int/inn_plant_a', x: 17.8, y: 16.8, spec: {} },
    { key: 'prop/int/inn_broom', x: 18.4, y: 13, spec: {} },
    { key: 'prop/int/inn_bucket', x: 17.6, y: 14.2, spec: {} },

    // ── kitchen wing ───────────────────────────────────────────────────────
    // The crates take their collision from the area script instead of the map,
    // because at the end of the quest they get shoved aside and the tiles they
    // were standing on have to become walkable again.
    { key: 'prop/int/inn_crates_blocked', x: 21.5, y: 7, spec: {}, id: 'crates' },
    { key: 'prop/int/inn_herbs', x: 23.4, y: 6, spec: {} },
    { key: 'prop/int/washbasin', x: 24.6, y: 6, spec: { solid: [18, 6] }, id: 'basin' },
    { key: 'prop/int/inn_range_0', x: 26.6, y: 7, spec: { anim: 'range_steam', solid: [28, 26] } },
    { key: 'prop/int/inn_pots_hanging', x: 29, y: 6, spec: {}, id: 'pots' },
    { key: 'prop/int/inn_broom', x: 30.4, y: 6.6, spec: {} },
    { key: 'prop/int/inn_bread_rack', x: 29.6, y: 9, spec: { solid: [20, 8] } },

    { key: 'prop/int/inn_table_long', x: 22, y: 10, spec: { solid: [44, 12] }, id: 'piptable' },
    { key: 'prop/int/inn_soup', x: 22.4, y: 9.6, spec: { depthBias: 26 } },
    { key: 'prop/int/table_small', x: 25.4, y: 11, spec: { solid: [16, 8] } },
    { key: 'prop/int/lantern_0', x: 25.4, y: 10.5, spec: { anim: 'int_lantern_glow', depthBias: 26 } },
    { key: 'prop/int/inn_keg', x: 21.4, y: 12.8, spec: { solid: [18, 8] } },
    { key: 'prop/int/inn_barrel_stack', x: 22.9, y: 13.4, spec: { solid: [20, 8] } },
    { key: 'prop/int/inn_bucket', x: 24.6, y: 12.8, spec: {} },
    { key: 'prop/int/inn_barrel', x: 30, y: 12.6, spec: { solid: [12, 8] } },
  ];
}

registerMap('inn', build);
