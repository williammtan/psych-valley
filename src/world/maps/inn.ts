/**
 * THE LANTERN INN — Mira's, and the location of Quest One.
 *
 * ONE BUILDING, THREE ZONES. The outline is a single rectangle, because an inn
 * drawn as two rectangles joined by a corridor reads as two buildings that
 * happen to touch. What separates the zones is a pier of internal wall with a
 * five-tile arch through it, and a change of floor material — planks in the
 * common room, kitchen tiling through the arch, planks again in the back
 * pantry. Function changes, so the floor changes.
 *
 *      2                  18 19 21              31
 *    1 ┌────────────────────────▪▪──────────────┐   ▪ storeroom door
 *    3 │ ▓▓▓ ▤▤   ▬▬▬▬ ═╗  │ ▓▓▓  ▨▨   ▬▬▬      │   ▓ fireplace / crates
 *    5 │ ▒▒ 🐈  ▉▉▉▉▉      │ ══                 │   ▨ range   ═ settle
 *    7 │        ○○○        │      ▯            │   ○ stools  ▯ prep table
 *    9 │  ⊙⊙        ⊙⊙     ╎        ▮▮          │   ⊙ dining sets (on rugs)
 *   11 │  ⊙⊙        ⊙⊙     ╎   ▮▮               │   ▮ barrels, kegs
 *   13 │                   │ ─────────────────  │   ── pantry (planks again)
 *   15 │   ═╤═     ⊙⊙      │      ▤▤▤           │   ╤ long table
 *   17 │ ▮ ══╧══   ⊙⊙   ▯  │  ▮       ▮         │
 *   18 └───────╨───────────┴─────────────────────┘   ╨ front door
 *
 * The quest geometry lives in the top-left of the kitchen: crates against the
 * storeroom door, the settle wedged in front of the crates, and the dark gap
 * under the settle where a cat can get and a person cannot.
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

  // ── the building: one rectangle, x 2..31, y 1..18 ────────────────────────
  g.rect(3, 3, 28, 15, '.');        // every floor tile, before zoning
  g.hLine(3, 30, 1, 'T');           // back wall: crown course...
  g.hLine(3, 30, 2, 'B');           // ...and the skirted course below it
  g.vLine(1, 17, 2, 'L');           // west side
  g.vLine(1, 17, 31, 'R');          // east side
  g.hLine(2, 31, 18, 'F');          // near wall, seen from above

  // Windows either side of the hearth, and the staircase to the guest rooms.
  g.set(8, 2, 'W');
  g.set(9, 2, 'W');
  g.set(16, 1, '/'); g.set(17, 1, '\\');
  g.set(16, 2, '<'); g.set(17, 2, '>');

  // The storeroom, shut, in the back wall of the kitchen.
  g.set(21, 1, 'D'); g.set(22, 1, 'D');
  g.set(21, 2, 'd'); g.set(22, 2, 'd');

  // ── the pier between common room and kitchen ─────────────────────────────
  // Two courses of wall with a five-tile arch through the middle of it. Wide
  // enough to read as one building; solid enough to be two rooms.
  g.vLine(3, 17, 19, 'R');
  g.vLine(3, 17, 20, 'L');
  g.rect(19, 8, 2, 5, '.');

  // ── floor zoning ─────────────────────────────────────────────────────────
  g.rect(21, 3, 10, 10, 'k');       // kitchen tiling, x 21..30, y 3..12
  g.rect(3, 3, 6, 5, 'w');          // the pool of firelight at the hearth
  // Rugs under the two dining clusters. Overlay blob sets, so they take the
  // shape of the patch and stop the plank courses running the room's width.
  g.blob(6, 10.5, 2.6, 2.2, 'r', 3, 0.22);
  g.blob(13, 11.5, 2.6, 2.2, 'u', 7, 0.22);

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
      'k': { base: 'int/tile_floor' },
      ';': { base: 'int/tile_floor', scatter: 'wall_shadow' },
      'r': { base: 'int/wood_floor', blob: 'rug_red' },
      'u': { base: 'int/wood_floor', blob: 'rug_blue' },
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
      // Mira works the west end of the counter, clear of the supper bell, so
      // that leaning over the bar to talk to her and reaching for the bell are
      // two different gestures rather than a coin toss.
      { id: 'mira', x: 11, y: 4, facing: 's' },
      { id: 'villager_a', x: 13, y: 8, facing: 'n' },
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
      { x: 13, y: 11, radius: 28, color: 0xffb937, intensity: 0.36, flicker: 0.9 },
      { x: 7, y: 14.4, radius: 26, color: 0xffb937, intensity: 0.36, flicker: 0.9 },
      { x: 10.5, y: 17.5, radius: 40, color: 0xa8c8f0, intensity: 0.22 },           // front door
      { x: 26.6, y: 4.6, radius: 48, color: 0xff8a3c, intensity: 0.4, flicker: 0.6 }, // range
      { x: 25.4, y: 8, radius: 44, color: 0xffb937, intensity: 0.42, flicker: 0.4 }, // kitchen lantern
      { x: 22, y: 6, radius: 30, color: 0xffc47a, intensity: 0.22 },                 // the settle corner
      { x: 26, y: 15, radius: 40, color: 0xffc47a, intensity: 0.26, flicker: 0.3 },  // pantry
    ],

    spawns: {
      default: { x: 10, y: 16, facing: 'n' },
      door: { x: 10, y: 16, facing: 'n' },
      /** GameFlow puts the player here after a death. */
      respawn: { x: 10, y: 16, facing: 'n' },
      hearth: { x: 7, y: 8, facing: 'n' },
      kitchen: { x: 25, y: 8, facing: 'n' },
    },
  };
}

/**
 * Furniture.
 *
 * Three rules run through this list. Tables and counters are solid, chairs are
 * not — a chair you can catch on is a chair that ruins the room. Anything
 * resting on a surface needs a positive depthBias, or the table it stands on
 * draws over the top of it. And chairs belong to a table: every one of them is
 * within half a tile of the table it was pulled out from, because a chair
 * adrift in open floor is the single fastest way to make a room look unfinished.
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
    { key: 'prop/int/inn_picture_a', x: 10, y: 2, spec: { interact: 'prop.innPicture' } },
    { key: 'prop/int/inn_shelf_bottles', x: 12, y: 2, spec: {} },
    { key: 'prop/int/inn_shelf_mugs', x: 14, y: 2, spec: {} },
    { key: 'prop/int/inn_sconce_0', x: 15, y: 2, spec: { anim: 'sconce_flicker' } },
    { key: 'prop/int/post_roster', x: 18, y: 2, spec: { interact: 'prop.innStairs' }, id: 'roster' },
    { key: 'prop/int/inn_newel', x: 15.4, y: 3, spec: {} },
    { key: 'prop/int/inn_barrel', x: 18, y: 4.4, spec: { solid: [12, 8] } },
    { key: 'prop/int/inn_barrel_stack', x: 18, y: 6.6, spec: { solid: [20, 8] } },

    // ── the bar ────────────────────────────────────────────────────────────
    { key: 'prop/int/inn_bar_l', x: 11, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_bar_mid', x: 12, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_bar_mid', x: 13, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_bar_mid', x: 14, y: 6, spec: { solid: [16, 26] } },
    { key: 'prop/int/inn_bar_r', x: 15, y: 6, spec: { solid: [16, 26], interact: 'prop.innBar' } },
    { key: 'prop/int/inn_lectern', x: 9.6, y: 5.4, spec: { solid: [12, 8], interact: 'prop.innGuestBook' }, id: 'ledger' },
    { key: 'prop/int/inn_mug', x: 11.7, y: 4.9, spec: { depthBias: 30 } },
    // The supper bell, out on the counter where nobody can walk past without
    // seeing it. A quest object nobody finds is a quest nobody finishes.
    { key: 'prop/town/bell_small', x: 13.2, y: 4.9, spec: { depthBias: 30 }, id: 'handbell' },
    { key: 'prop/int/inn_plate', x: 14.2, y: 4.9, spec: { depthBias: 30 } },
    { key: 'prop/int/inn_mug_half', x: 14.9, y: 4.9, spec: { depthBias: 30 } },
    { key: 'prop/int/inn_stool', x: 11.6, y: 7.6, spec: {} },
    { key: 'prop/int/inn_stool', x: 14.4, y: 7.6, spec: {} },
    { key: 'prop/int/inn_stool', x: 15.6, y: 7.5, spec: {} },

    // ── dining set one, on the red rug ─────────────────────────────────────
    { key: 'prop/int/inn_table_round_set', x: 6, y: 10, spec: { solid: [26, 12] } },
    { key: 'prop/int/inn_chair_n', x: 6, y: 9.1, spec: {} },
    { key: 'prop/int/inn_chair_s', x: 6.2, y: 11.4, spec: {} },
    { key: 'prop/int/inn_chair_e', x: 7.4, y: 10.7, spec: {} },
    { key: 'prop/int/inn_chair_pushed', x: 4.7, y: 10.5, spec: {} },
    { key: 'prop/int/candle_0', x: 6, y: 9.5, spec: { anim: 'candle_flicker', depthBias: 30 } },

    // ── dining set two, on the blue rug ────────────────────────────────────
    { key: 'prop/int/inn_table_round', x: 13, y: 11, spec: { solid: [26, 12] } },
    { key: 'prop/int/inn_chair_n', x: 13, y: 10.1, spec: {} },
    { key: 'prop/int/inn_chair_w', x: 11.7, y: 11.5, spec: {} },
    { key: 'prop/int/inn_chair_e', x: 14.3, y: 11.5, spec: {} },
    { key: 'prop/int/candle_0', x: 13, y: 10.5, spec: { anim: 'candle_flicker', depthBias: 30 } },
    { key: 'prop/int/inn_mug', x: 13.7, y: 10.6, spec: { depthBias: 30 } },

    // ── the long table by the door ─────────────────────────────────────────
    { key: 'prop/int/inn_table_long', x: 8, y: 15, spec: { solid: [44, 12] } },
    { key: 'prop/int/inn_bench', x: 8, y: 16.4, spec: {} },
    { key: 'prop/int/inn_chair_e', x: 10.4, y: 15.2, spec: {} },
    { key: 'prop/int/inn_chair_w', x: 5.6, y: 15.1, spec: {} },
    { key: 'prop/int/candle_0', x: 7, y: 14.4, spec: { anim: 'candle_flicker', depthBias: 30 } },
    { key: 'prop/int/inn_soup', x: 9, y: 14.4, spec: { depthBias: 30, interact: 'prop.innSoup' } },
    { key: 'prop/int/inn_mug', x: 8.2, y: 14.5, spec: { depthBias: 30 } },

    // ── the corner table, for somebody who wants to be left alone ──────────
    { key: 'prop/int/inn_table_round', x: 16.4, y: 15.4, spec: { solid: [26, 12] } },
    { key: 'prop/int/inn_chair_w', x: 15.1, y: 15.5, spec: {} },
    { key: 'prop/int/inn_chair_n', x: 16.4, y: 14.5, spec: {} },
    { key: 'prop/int/inn_mug_half', x: 16.4, y: 14.9, spec: { depthBias: 30 } },

    // ── odds and ends that say somebody lives here ─────────────────────────
    { key: 'prop/int/rug_runner', x: 11, y: 17.2, spec: { depthBias: -70 } },
    { key: 'prop/int/inn_coatrack', x: 4, y: 17, spec: { solid: [12, 6] } },
    { key: 'prop/int/boots', x: 5.5, y: 17.3, spec: {} },
    { key: 'prop/int/inn_clock', x: 3.4, y: 9, spec: { solid: [12, 6], interact: 'prop.innClock' } },
    { key: 'prop/int/inn_plant_b', x: 3.5, y: 12.4, spec: {} },
    { key: 'prop/int/inn_plant_a', x: 18.2, y: 17.4, spec: {} },
    { key: 'prop/int/inn_broom', x: 18.4, y: 13.4, spec: { interact: 'prop.innBroom' } },
    { key: 'prop/int/inn_bucket', x: 18.2, y: 14.6, spec: {} },

    // ── kitchen: the storeroom corner ──────────────────────────────────────
    // Crates against the door, settle wedged in front of the crates, and the
    // dark gap under the settle. Both take their collision from the area
    // script, because Mira shifts them at the end and static solids cannot be
    // taken back off the grid.
    { key: 'prop/int/inn_crates_blocked', x: 21.5, y: 4, spec: { interact: 'prop.innCrates' }, id: 'crates' },
    { key: 'prop/int/inn_bench', x: 21.5, y: 6.4, spec: {}, id: 'settle' },

    // ── kitchen: the working side ──────────────────────────────────────────
    { key: 'prop/int/inn_herbs', x: 23.4, y: 3.6, spec: { interact: 'prop.innHerbs' } },
    { key: 'prop/int/washbasin', x: 24.7, y: 3.7, spec: { solid: [18, 6], interact: 'clue.pipes' }, id: 'basin' },
    { key: 'prop/int/inn_range_0', x: 26.6, y: 4.6, spec: { anim: 'range_steam', solid: [28, 26] }, id: 'range' },
    { key: 'prop/int/inn_pots_hanging', x: 29, y: 3.6, spec: { interact: 'inn.pots' }, id: 'pots' },
    { key: 'prop/int/inn_broom', x: 30.4, y: 3.6, spec: {} },
    { key: 'prop/int/inn_bread_rack', x: 29.6, y: 6.4, spec: { solid: [20, 8] } },
    { key: 'prop/int/inn_shelf_crocks', x: 24, y: 2, spec: {} },

    { key: 'prop/int/table_small', x: 25.4, y: 8.4, spec: { solid: [16, 8] } },
    { key: 'prop/int/lantern_0', x: 25.4, y: 7.9, spec: { anim: 'int_lantern_glow', depthBias: 30 } },
    { key: 'prop/int/inn_plate', x: 26, y: 8.2, spec: { depthBias: 30 } },
    { key: 'prop/int/inn_keg', x: 21.4, y: 10, spec: { solid: [18, 8], interact: 'prop.innKeg' } },
    { key: 'prop/int/inn_barrel_stack', x: 22.9, y: 10.6, spec: { solid: [20, 8] } },
    { key: 'prop/int/inn_bucket', x: 24.6, y: 10.2, spec: {} },
    { key: 'prop/int/inn_barrel', x: 30, y: 9.6, spec: { solid: [12, 8] } },
    { key: 'prop/int/inn_soup', x: 27.4, y: 10.4, spec: { depthBias: 30 } },

    // ── the back pantry, planks again ──────────────────────────────────────
    { key: 'prop/int/dresser', x: 22.2, y: 14.4, spec: { solid: [26, 8] } },
    { key: 'prop/int/books_stack', x: 22.2, y: 13.6, spec: { depthBias: 30 } },
    { key: 'prop/int/table_small', x: 26.4, y: 14.4, spec: { solid: [16, 8] } },
    { key: 'prop/int/inn_bread_rack', x: 28.6, y: 14, spec: { solid: [20, 8] } },
    { key: 'prop/int/inn_barrel', x: 21.4, y: 17.2, spec: { solid: [12, 8] } },
    { key: 'prop/int/inn_barrel_stack', x: 24.2, y: 17.4, spec: { solid: [20, 8] } },
    { key: 'prop/int/inn_bucket', x: 25.8, y: 17.2, spec: {} },
    { key: 'prop/int/inn_keg', x: 29.8, y: 17.2, spec: { solid: [18, 8] } },
    { key: 'prop/int/inn_broom', x: 30.4, y: 12.6, spec: {} },
    { key: 'prop/int/chest_closed', x: 30, y: 15.4, spec: { solid: [20, 8] } },
    { key: 'prop/int/rug_runner', x: 26.4, y: 16.4, spec: { depthBias: -70 } },
  ];
}

registerMap('inn', build);
