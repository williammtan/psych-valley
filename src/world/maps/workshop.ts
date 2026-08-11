/**
 * SERA'S WORKSHOP — part laboratory, part library (plan.md §5.3).
 *
 * The room has one job before Sera says a word: tell you who she is. So it is
 * built as three overlapping working areas that have all overrun their
 * boundaries, because that is what a person who is *mid-investigation* looks
 * like from the doorway.
 *
 *        1         6        11        16        20
 *      ┌──────────────────────────────────────────┐
 *   1  │  ▤▤    ▓▓▓▓    ▤▤        ▓▓▓▓            │   ▤ window   ▓ wall
 *   3  │ ▉▉ ▉▉ ▉▉  ▬▬▬▬▬  ⌗⌗  ≈≈  ✿✿              │   ▉ bookcase ▬ chalkboard
 *   5  │ ▉▉ ▉▉ ▉▉         ⌗⌗  ≈≈  ✿✿              │   ⌗ rack     ≈ coil
 *   7  │ ╪  ▭▭▭▭▭▭       ✦        ▭▭▭ ▯           │   ✿ plants   ✦ ECHO ARTEFACT
 *   9  │ ╪  ▭ jars ▭              ▭desk▭          │   ▭ benches  ╪ ladder
 *  11  │      ═════════           ⊛     ☗         │   ═ map table ⊛ orrery
 *  13  │  ▧▧  ═ map ═            ☗  ▨▨            │   ☗ armchair ▨ crates
 *  15  │  ▧▧          ▩▩▩▩▩▩▩                     │   ▩ rug      ▧ stove
 *      └──────────────────╨───────────────────────┘   ╨ door to Lumen Vale
 *
 * THE ONE VIOLET. Every other interior in the vertical slice is warm — amber
 * lamps, wood, paper. The Echo artefact on its stand is the only saturated
 * violet the player has seen indoors, and it is deliberately placed on the
 * sight-line from the door so it registers before anything else in the room.
 * When they finally reach the shrine, that colour is already loaded.
 *
 * The map table is the room's mechanism: after the third quest it is what
 * connects the cat, the courier and the Trial to something underneath the
 * valley, and opens the south gate (plan.md §31, §36). The area script owns
 * that; this file only guarantees it is impossible to miss.
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { MapDef, PropPlacement } from '../types';

/**
 * The room must be wider than the 30-tile camera view or the scene shows void
 * at the edges: camera bounds are the world size, and Phaser clamps rather than
 * letterboxing.
 */
const W = 32;
const H = 18;

/** Anything the eye reads as built structure, for the cast-shadow pass. */
const STRUCTURE = new Set(['#', 'T', 'B', 'W', 'L', 'R', 'F', 'D', 'd']);

/** Landmarks shared with the area script and the shot tool. */
export const WORKSHOP = {
  w: W,
  h: H,
  door: [15, 16] as const,
  mapTable: [9, 13] as const,
  bookshelf: [3, 6] as const,
  artefact: [15, 8] as const,
  desk: [23, 9] as const,
  sera: [18, 11] as const,
};

function build(): MapDef {
  const g = new GridPainter(W, H, '#');

  // Floor, x 2..29, y 3..15. Boards throughout; the laboratory half is tiled,
  // because that is the half where things get spilled.
  g.rect(2, 3, 28, 13, '.');
  g.rect(2, 3, 13, 9, 'k');
  g.blob(8, 8, 7, 5, 'k', 7, 0.22);

  // Back wall: three courses, so the room has height for the bookcases to be
  // dwarfed by.
  g.hLine(2, 29, 0, 'T');
  g.hLine(2, 29, 1, 'B');
  g.hLine(2, 29, 2, 'B');
  g.vLine(0, 15, 1, 'L');
  g.vLine(0, 15, 30, 'R');
  g.hLine(1, 30, 16, 'F');

  // Windows: north light over the working half, which is why the benches are
  // on that side of the room.
  for (const x of [3, 4, 10, 11, 20, 21, 26, 27]) g.set(x, 1, 'W');

  // The door home.
  g.set(15, 16, '='); g.set(16, 16, '=');

  // Cast shadow under every built thing, so the walls sit on the floor rather
  // than being painted onto it.
  const shadowed: Record<string, string> = { '.': '-', 'k': '+' };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = g.get(x, y);
      if (!shadowed[c]) continue;
      if (STRUCTURE.has(g.get(x, y - 1))) g.set(x, y, shadowed[c]);
    }
  }

  return {
    id: 'workshop',
    name: "Sera's Workshop",
    subtitle: 'part laboratory, part library',
    music: 'inn',
    indoor: true,
    tint: 0x171426,
    darkness: 0.3,

    ground: g.rows(),
    legend: {
      '#': { base: 'blank', solid: true },
      '.': { base: 'int/wood_floor' },
      '-': { base: 'int/wood_floor', scatter: 'wall_shadow' },
      // The lab half is tiled over the same boards, using the blob autotile so
      // the two surfaces meet on a soft irregular edge rather than a rectangle.
      'k': { base: 'int/wood_floor', blob: 'floor_tile' },
      '+': { base: 'int/wood_floor', blob: 'floor_tile', scatter: 'wall_shadow' },
      '=': { base: 'int/doormat' },
      'T': { base: 'int/wall_plaster_top', solid: true },
      'B': { base: 'int/wall_plaster_base', solid: true },
      'W': { base: 'int/wall_window', solid: true },
      'L': { base: 'int/wall_plaster_corner_l', solid: true },
      'R': { base: 'int/wall_plaster_corner_r', solid: true },
      'F': { base: 'int/wall_plaster_front', solid: true },
    },
    scatterRules: {
      wall_shadow: { density: 1, tiles: [['int/floor_shadow_n', 1]] },
    },

    props: props(),

    zones: [
      { kind: 'door', id: 'to_town', x: 15, y: 16, w: 2, h: 1, to: 'lumen_vale', spawn: 'workshop_door', facing: 's' },
    ],

    lights: [
      // North windows: cool daylight over the working half.
      { x: 3.5, y: 2, radius: 44, color: 0xa8c8f0, intensity: 0.26 },
      { x: 10.5, y: 2, radius: 44, color: 0xa8c8f0, intensity: 0.26 },
      { x: 20.5, y: 2, radius: 44, color: 0xa8c8f0, intensity: 0.26 },
      { x: 26.5, y: 2, radius: 44, color: 0xa8c8f0, intensity: 0.24 },
      // Warm work light: desk, map table, stove.
      { x: 24.7, y: 8.4, radius: 44, color: 0xffb937, intensity: 0.52, flicker: 0.7 },
      { x: 26.2, y: 8.6, radius: 34, color: 0xffb937, intensity: 0.4, flicker: 0.4 },
      { x: 9, y: 13, radius: 48, color: 0xffb937, intensity: 0.44, flicker: 0.5 },
      { x: 2.4, y: 13.6, radius: 40, color: 0xff9436, intensity: 0.45, flicker: 0.9 },
      // Specimen jars: the only other cold light, and much weaker.
      { x: 5.6, y: 9.4, radius: 30, color: 0x8ce6e6, intensity: 0.36, flicker: 0.35 },
      // The artefact. Brighter and more saturated than anything else indoors.
      { x: 15, y: 7.6, radius: 60, color: 0xa681e6, intensity: 0.62, flicker: 0.5 },
    ],

    spawns: {
      default: { x: 15, y: 15, facing: 'n' },
      door: { x: 15, y: 15, facing: 'n' },
      respawn: { x: 15, y: 15, facing: 'n' },
      maptable: { x: 9, y: 13, facing: 'n' },
    },
  };
}

/**
 * Furniture.
 *
 * The composition rule is that no working surface is clear. Every bench, table
 * and shelf has something abandoned mid-use on it, and three separate
 * investigations are visibly running at once — that is the character note the
 * room has to carry before Sera speaks.
 */
function props(): PropPlacement[] {
  const p: PropPlacement[] = [];
  const P = (
    key: string, x: number, y: number,
    spec: PropPlacement['spec'] = {}, id?: string,
  ) => { p.push({ key, x, y, spec, ...(id ? { id } : {}) }); };

  // ── the library wall: bookcases, overflowing ─────────────────────────────
  // Sera's bookshelf (plan.md §49) is the leftmost and the only one with an
  // interaction — one shelf you can actually read is better than three you
  // cannot tell apart.
  P('prop/int/lab_bookcase_a', 2.9, 6, { solid: [26, 10], interact: 'sera_bookshelf' }, 'bookshelf');
  P('prop/int/lab_bookcase_b', 4.7, 6, { solid: [26, 10] });
  P('prop/int/lab_bookcase_c', 6.5, 6, { solid: [26, 10] });
  P('prop/int/lab_ladder', 8.3, 8, { depthBias: -2 });
  P('prop/int/books_stack', 2.4, 8, {});
  P('prop/int/books_stack', 3.6, 12, {});
  P('prop/int/wallshelf_a', 12, 4, {});

  // ── the chalkboard: the current argument, half rubbed out ───────────────
  P('prop/int/lab_chalkboard', 10.5, 5, { solid: [44, 8], interact: 'chalkboard' }, 'chalkboard');

  // ── apparatus along the north wall ──────────────────────────────────────
  P('prop/int/lab_rack', 14, 6, { solid: [22, 8] });
  P('prop/int/lab_coil_0', 16.2, 6, { solid: [18, 8], anim: 'coil_arc' });
  P('prop/int/lab_plantshelf', 19, 6, { solid: [30, 8], interact: 'plants' }, 'plants');
  // Plants that have outgrown the shelf and been put on the floor beside it.
  P('prop/int/inn_plant_a', 21.2, 6, { solid: [14, 8] });
  P('prop/int/inn_plant_b', 28.6, 7, { solid: [14, 8] });

  // ── the specimen bench ──────────────────────────────────────────────────
  P('prop/int/lab_workbench', 5.5, 10, { solid: [44, 10], interact: 'jars' }, 'jars');
  P('prop/int/lab_jars_0', 4.7, 9.6, { depthBias: 6, anim: 'lab_jars_glow' });
  P('prop/int/lab_jars_1', 6.6, 9.6, { depthBias: 6, anim: 'lab_jars_glow' });
  P('prop/int/lab_specimen', 3.4, 10, { depthBias: 6 });
  P('prop/int/lab_stove', 2.4, 14, { solid: [22, 10] });

  // ── THE ECHO ARTEFACT ───────────────────────────────────────────────────
  // On the sight-line from the door, alone, with nothing else within two tiles
  // of it. The one thing in the room that is treated like it might be
  // dangerous — and the only saturated violet in any town interior.
  P('prop/int/lab_echo_stand_0', 15, 8, { solid: [16, 10], anim: 'echo_artefact', interact: 'echo_artefact' }, 'artefact');

  // ── the desk, buried ────────────────────────────────────────────────────
  P('prop/int/lab_desk', 23, 9, { solid: [38, 10], interact: 'desk' }, 'desk');
  P('prop/int/lab_paperstack', 21.9, 8.8, { depthBias: 6 });
  P('prop/int/lab_openbook', 23.7, 8.7, { depthBias: 6 });
  P('prop/int/candle_0', 24.7, 8.6, { depthBias: 6, anim: 'candle_flicker' });
  P('prop/int/lab_chair_comfy', 23, 11, { solid: [20, 8] });
  P('prop/int/lantern_0', 26.2, 9, { anim: 'int_lantern_glow' });

  // ── the map table: pins, string, and the room's mechanism ───────────────
  P('prop/int/lab_maptable', 9, 14, { solid: [40, 12], interact: 'map_table' }, 'map_table');
  P('prop/int/lab_orrery', 13.5, 12, { solid: [22, 10], interact: 'orrery' }, 'orrery');
  P('prop/int/rug_runner', 15.5, 15, { depthBias: -200 });

  // ── the corner where the work stops ─────────────────────────────────────
  P('prop/int/lab_armchair_scratched', 20, 14, { solid: [22, 8], interact: 'armchair' }, 'armchair');
  P('prop/int/rug_round', 20, 15, { depthBias: -200 });
  P('prop/int/lab_crates', 24.5, 14, { solid: [28, 10], interact: 'crates' }, 'crates');
  P('prop/int/lab_carpet_roll', 27.6, 13, { solid: [28, 8] });
  P('prop/int/boots', 28.8, 15, {});

  // ── the overflow ────────────────────────────────────────────────────────
  // The room is out of surfaces, so the work has spread onto the floor. This
  // is the last thing that makes it read as *in progress* rather than tidy.
  P('prop/int/chest_closed', 27.4, 11, { solid: [22, 8], interact: 'crates' });
  P('prop/int/table_small', 20.2, 11, { solid: [18, 8] });
  P('prop/int/books_stack', 20.2, 10.7, { depthBias: 6 });
  P('prop/int/wallshelf_b', 24, 4, {});
  P('prop/int/lab_paperstack', 11.5, 11, {});
  P('prop/int/books_stack', 17.2, 13, {});
  P('prop/int/lab_specimen', 12.6, 10, {});
  P('prop/int/candle_1', 6.4, 13, { anim: 'candle_flicker' });
  P('prop/int/lab_openbook', 12.2, 14, {});
  P('prop/int/inn_plant_a', 29, 4, { solid: [14, 8] });

  return p;
}

registerMap('workshop', build);
