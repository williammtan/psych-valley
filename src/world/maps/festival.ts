/**
 * FESTIVAL PLAZA — the Festival of Lanterns, evening.
 *
 * This is the same field north of Lumen Vale that the player has walked past
 * all game. The brief for it is an event-state *transformation*, not a banner
 * and three extra NPCs, so the composition follows the Night Market lesson:
 *
 *   1. LIGHT IS THE TRANSFORMATION.  The map is dark (0.42) and every single
 *      light in it is a real object — a lantern, a brazier, a string-light span,
 *      a stall awning, the stage. Nothing is lit "ambiently". That is what makes
 *      a night event read as an event rather than a day map with a filter.
 *   2. ONE CENTRE.  The trial stage sits dead centre-north with the river behind
 *      it; the carpet, the lantern ring, the string-light runs and the entry
 *      path all point at it. If you stand anywhere in the plaza you can see
 *      where the evening is happening.
 *   3. CLUSTERS, NOT SPRINKLES.  Three activity clusters — food row (west),
 *      bandstand and games (east), the trial (centre) — each with its own
 *      lighting pool, seating and implied crowd. The gaps between them are the
 *      route, so density never eats navigation.
 *
 *              river + floating lanterns          y 4-8
 *      ┌──────────────────────────────────────────────────┐
 *      │  food row      TRIAL STAGE        bandstand       │  y 13-18
 *      │                 ref lantern                       │
 *      │  tables       A    B    C          games          │  y 19-24
 *      │                 the crowd                         │  y 24-30
 *      │                   arch                            │  y 31-33
 *      └───────────────────┬──────────────────────────────┘
 *                     south → Lumen Vale
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { LightDef, MapDef, ObjectSpec, PropPlacement } from '../types';

const W = 48;
const H = 36;

/**
 * The trial stage's base row. Everything ceremonial hangs off this: the three
 * lanterns sit in the cups on its posts, the reference stands in front of it,
 * and the crowd arcs below. Kept as one constant so the ensemble stays a
 * single readable object when it is nudged.
 */
const STAGE_Y = 19.6;

/** Warm lantern-paper amber — the festival's signature colour. */
const AMBER = 0xffb04a;
const CANDLE = 0xffc978;
const ROSE = 0xff7fb0;
const TEAL = 0x6fe3d2;
const MOONWHITE = 0xfff2d2;

/** Trial lantern identity colours. Identity only — never the answer. */
export const TRIAL_COLORS = { a: 0xffc247, b: 0xff6f9d, c: 0x5fd8dd } as const;

interface Placer {
  props: PropPlacement[];
  lights: LightDef[];
}

function build(): MapDef {
  // ── ground ───────────────────────────────────────────────────────────────
  const g = new GridPainter(W, H, '.');
  g.scatter(',', ['.'], 0.36, 11);
  g.scatter('"', ['.', ','], 0.11, 29);

  // The river runs across the north; the stage is composed against it.
  g.rect(0, 4, W, 5, '~');
  g.blob(9, 8, 8, 2, '~', 17, 0.5);
  g.blob(31, 8, 9, 2, '~', 23, 0.5);
  g.blob(21, 4, 7, 2, '.', 31, 0.6);
  // Sand where water meets land.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) !== '~') continue;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, 1]]) {
        const c = g.get(x + dx, y + dy);
        if (c === '.' || c === ',' || c === '"') g.set(x + dx, y + dy, 's');
      }
    }
  }

  // The plaza itself: festival flagstone, wobbled at the edges so it reads as a
  // place that grew rather than a rectangle someone dropped on a field.
  g.rect(3, 12, 42, 20, 'c');
  g.blob(7, 13, 6, 3, 'c', 41, 0.4);
  g.blob(41, 13, 6, 3, 'c', 43, 0.4);
  g.blob(8, 30, 7, 3, 'c', 47, 0.45);
  g.blob(39, 30, 7, 3, 'c', 53, 0.45);
  g.blob(3, 22, 3, 6, '.', 59, 0.5);
  g.blob(44, 22, 3, 6, '.', 61, 0.5);

  // The trial ground — a laid carpet, which is what tells the player where the
  // evening's event actually is before anyone says a word.
  g.blob(23, 23.6, 8, 4.8, 'f', 21, 0.16);

  // Entry road from town, and the two service lanes to the stall rows.
  g.vLine(28, H - 1, 23, 'p', 5);
  g.hLine(5, 14, 19, 'p', 3);
  g.hLine(33, 43, 19, 'p', 3);

  // Building/stall footprints — solid ground the sprites sit on.
  const footprints: Array<[number, number, number, number]> = [
    [20, 16, 8, 4],   // trial stage
    [4, 15, 5, 2],    // food stall 0
    [9, 15, 4, 2],    // food stall 1
    [34, 15, 5, 2],   // bandstand
    [40, 15, 4, 2],   // game stall
  ];
  for (const [x, y, w, h] of footprints) g.rect(x, y, w, h, '#');

  // Treeline. The plaza is a clearing; the dark mass around it is what makes the
  // lit centre feel bright.
  g.scatter('T', ['.', ',', '"'], 0.62, 41, { x: 0, y: 0, w: W, h: 4 });
  g.scatter('T', ['.', ',', '"'], 0.5, 43, { x: 0, y: 0, w: 3, h: H });
  g.scatter('T', ['.', ',', '"'], 0.5, 45, { x: W - 3, y: 0, w: 3, h: H });
  g.scatter('T', ['.', ',', '"'], 0.4, 47, { x: 0, y: H - 3, w: 19, h: 3 });
  g.scatter('T', ['.', ',', '"'], 0.4, 49, { x: 28, y: H - 3, w: 20, h: 3 });

  const ground = g.rows();

  // ── object layer ─────────────────────────────────────────────────────────
  const o = new GridPainter(W, H, ' ');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) === 'T') o.set(x, y, 'T');
    }
  }
  o.scatter('b', [' '], 0.04, 63);
  // Reeds along the waterline.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) !== 's') continue;
      if ((x * 7 + y * 13) % 5 === 0) o.set(x, y, 'r');
    }
  }
  // Nothing loose on walkable or built surfaces.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = g.get(x, y);
      if (c === 'c' || c === 'p' || c === 'f' || c === '#' || c === '~') o.set(x, y, ' ');
    }
  }

  // ── above layer: bunting and string lights over the player's head ────────
  const a = new GridPainter(W, H, ' ');
  const P: Placer = { props: [], lights: [] };

  /** A prop plus, optionally, the light it actually emits. */
  const put = (
    key: string | string[],
    x: number,
    y: number,
    spec: Omit<ObjectSpec, 'key'> = {},
    light?: Partial<LightDef> & { radius: number; dy?: number },
    id?: string,
  ) => {
    P.props.push({ key: Array.isArray(key) ? key[0] : key, x, y, spec, id });
    if (light) {
      P.lights.push({
        x, y: y + (light.dy ?? -1),
        radius: light.radius,
        color: light.color,
        intensity: light.intensity,
        flicker: light.flicker,
      });
    }
  };

  /**
   * A run of string lights between two poles, hung on the `above` grid so the
   * player walks underneath it. Each span is a real light source; six runs of
   * these are the single biggest reason the plaza reads as transformed.
   */
  const stringRun = (x0: number, x1: number, y: number, poles = true) => {
    if (poles) {
      put('prop/fest/string_lights_pole', x0, y + 2, { solid: [8, 8], depthBias: -4 });
      put('prop/fest/string_lights_pole', x1, y + 2, { solid: [8, 8], depthBias: -4 });
    }
    for (let x = x0 + 2; x <= x1 - 1; x += 3) {
      a.set(x, y, 'G');
      P.lights.push({ x, y: y - 0.6, radius: 30, color: CANDLE, intensity: 0.3, flicker: 0.25 });
    }
  };

  const buntingRun = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x += 3) a.set(x, y, ['U', 'V', 'X'][(x + y) % 3]);
  };

  // ── the trial: the centre of attention ───────────────────────────────────
  put('prop/fest/trial_stage', 23.5, STAGE_Y, { solid: [88, 44] }, { radius: 82, color: AMBER, intensity: 0.36, dy: -2.6 }, 'trial_stage');
  put('prop/fest/banner_0', 19.6, 19.8, {}, { radius: 34, color: ROSE, intensity: 0.22, dy: -1.6 });
  put('prop/fest/banner_2', 27.4, 19.8, {}, { radius: 34, color: TEAL, intensity: 0.22, dy: -1.6 });
  put('prop/fest/banner_1', 21.6, 15.8, { depthBias: -6 }, { radius: 30, color: AMBER, intensity: 0.2, dy: -1.6 });
  put('prop/fest/banner_1', 25.4, 15.8, { depthBias: -6 }, { radius: 30, color: AMBER, intensity: 0.2, dy: -1.6 });

  /**
   * The three trial lanterns are MOUNTED, not standing loose on the grass: the
   * stage art carries three posts with iron cups and a painted glyph for each
   * lantern, at sprite-local x 24 / 48 / 72 and cup floor y 9. Dropping the
   * lanterns into those cups is what makes them read on sight as instruments
   * belonging to this stage rather than three ornaments someone left out.
   *
   *   stage centre 23.5 → sprite left edge px 336 → posts at px 360/384/408
   *   stage base STAGE_Y → sprite top 64px up → cup floor 9px below that
   */
  const POST_Y = STAGE_Y - (64 - 9) / 16;
  put('prop/fest/trial_lantern_a', 22.0, POST_Y, {}, { radius: 48, color: TRIAL_COLORS.a, intensity: 0.62, dy: -1.3 }, 'lantern_a');
  put('prop/fest/trial_lantern_b', 23.5, POST_Y, {}, { radius: 48, color: TRIAL_COLORS.b, intensity: 0.62, dy: -1.3 }, 'lantern_b');
  put('prop/fest/trial_lantern_c', 25.0, POST_Y, {}, { radius: 48, color: TRIAL_COLORS.c, intensity: 0.62, dy: -1.3 }, 'lantern_c');

  // The reference stands alone on the carpet, forward of the stage and lower
  // than the three — its own stone pedestal, its own pool of white light.
  put('prop/fest/reference_lantern', 23.5, 22.2, { solid: [14, 8], anim: 'reference_lantern_struck' },
    { radius: 56, color: MOONWHITE, intensity: 0.54, flicker: 0.15, dy: -2.0 }, 'ref_lantern');
  put('prop/fest/striker', 21.0, 22.0, {}, undefined, 'striker');

  put('prop/fest/judging_table', 29.2, 21.2, { solid: [44, 12] }, { radius: 30, color: CANDLE, intensity: 0.24, dy: -1.2 });
  put('prop/fest/prize_ribbon', 30.4, 20.6, {});

  // ── west: the food row ───────────────────────────────────────────────────
  put('prop/fest/stall_food_0', 6.2, 17.2, { solid: [58, 22] }, { radius: 46, color: AMBER, intensity: 0.38, dy: -2.2 });
  put('prop/fest/stall_food_1', 11.0, 17.2, { solid: [58, 22] }, { radius: 46, color: AMBER, intensity: 0.38, dy: -2.2 });
  put('prop/fest/stall_food_2', 15.2, 17.6, { solid: [56, 20] }, { radius: 42, color: CANDLE, intensity: 0.34, dy: -2.0 });
  put('prop/fest/brazier_fest_0', 4.4, 21.4, { solid: [14, 8], anim: 'brazier_fest' }, { radius: 54, color: 0xff8a3c, intensity: 0.5, flicker: 0.9, dy: -1.8 });
  put('prop/fest/brazier_fest_0', 16.4, 14.4, { solid: [14, 8], anim: 'brazier_fest' }, { radius: 54, color: 0xff8a3c, intensity: 0.5, flicker: 0.9, dy: -1.8 });
  put('prop/fest/crate_stack_fest', 3.8, 18.6, { solid: [28, 12] });
  put('prop/fest/drink_barrel', 12.9, 20.6, { solid: [24, 10] });
  put('prop/fest/barrel_fest', 13.9, 21.5, { solid: [18, 8] });
  put('prop/town/picnic_table', 8.6, 23.4, { solid: [44, 14] });
  put('prop/fest/pie_stack', 8.0, 22.9, {});
  put('prop/fest/mug', 9.3, 23.1, {});
  put('prop/fest/fruit_bowl', 9.9, 22.7, {});
  put('prop/fest/bench_fest_0', 6.4, 20.4, { solid: [34, 8] });
  put('prop/fest/bench_fest_1', 11.2, 20.4, { solid: [34, 8] });
  put('prop/fest/bench_fest_0', 6.0, 26.4, { solid: [34, 8] });
  put('prop/town/table_round', 10.4, 27.2, { solid: [26, 10] });
  put('prop/fest/mug', 10.0, 27.0, {});
  put('prop/fest/skewer', 11.0, 26.9, {});
  put('prop/fest/toy_windmill', 14.2, 25.4, {});

  // ── east: bandstand and games ────────────────────────────────────────────
  put('prop/fest/stage_music', 36.0, 17.2, { solid: [72, 26] }, { radius: 56, color: 0xffcf7a, intensity: 0.4, dy: -2.4 });
  put('prop/fest/stall_game_0', 41.8, 17.2, { solid: [58, 22] }, { radius: 46, color: ROSE, intensity: 0.36, dy: -2.2 });
  put('prop/fest/stall_game_1', 41.8, 23.4, { solid: [52, 22] }, { radius: 44, color: TEAL, intensity: 0.36, dy: -2.2 });
  put('prop/fest/stall_craft', 35.6, 23.6, { solid: [58, 22] }, { radius: 44, color: CANDLE, intensity: 0.34, dy: -2.2 });
  put('prop/fest/brazier_fest_0', 32.6, 20.6, { solid: [14, 8], anim: 'brazier_fest' }, { radius: 54, color: 0xff8a3c, intensity: 0.5, flicker: 0.9, dy: -1.8 });
  put('prop/fest/brazier_fest_0', 43.6, 27.4, { solid: [14, 8], anim: 'brazier_fest' }, { radius: 54, color: 0xff8a3c, intensity: 0.5, flicker: 0.9, dy: -1.8 });
  put('prop/fest/bench_fest_1', 37.2, 20.4, { solid: [34, 8] });
  put('prop/fest/bench_fest_0', 39.4, 27.0, { solid: [34, 8] });
  put('prop/fest/toy_windmill', 39.0, 20.8, {});
  put('prop/fest/prize_ribbon', 44.0, 21.0, {});
  put('prop/fest/crate_stack_fest', 44.2, 18.4, { solid: [28, 12] });
  put('prop/town/table_round', 38.0, 24.6, { solid: [26, 10] });
  put('prop/fest/mug', 37.7, 24.4, {});
  put('prop/fest/bread_basket', 38.4, 24.3, {});

  // ── the ring of ground lanterns that draws the trial floor ───────────────
  const ring: Array<[number, number]> = [
    [31.8, 23.6], [29.2, 27.6], [25.2, 29.2], [20.8, 29.2], [16.8, 27.6],
    [14.2, 23.6], [16.8, 19.6], [29.2, 19.6],
  ];
  ring.forEach(([x, y], i) => {
    put(`prop/fest/ground_lantern_${i % 3}`, x, y, {}, { radius: 30, color: AMBER, intensity: 0.4, flicker: 0.35, dy: -0.9 });
  });

  // ── the entry: an arch, a lit approach, a signpost ───────────────────────
  put('prop/fest/flower_arch', 23.4, 32.6, {}, { radius: 40, color: ROSE, intensity: 0.3, dy: -2.6 });
  for (const y of [30.6, 33.2, 35.2]) {
    put('prop/fest/ground_lantern_0', 20.2, y, {}, { radius: 28, color: AMBER, intensity: 0.42, flicker: 0.35, dy: -0.9 });
    put('prop/fest/ground_lantern_1', 26.6, y, {}, { radius: 28, color: AMBER, intensity: 0.42, flicker: 0.35, dy: -0.9 });
  }
  put('prop/town/signpost_0', 28.2, 33.4, { solid: [12, 8] });

  // ── hanging paper lanterns, strung with the light runs ───────────────────
  const hung: Array<[number, number, number]> = [
    [7, 13.6, 0], [12, 13.6, 1], [17, 13.6, 2], [30, 13.6, 3], [35, 13.6, 4], [40, 13.6, 5],
    [9, 27.6, 2], [14, 27.6, 5], [33, 27.6, 1], [38, 27.6, 3],
    [18.5, 20.0, 4], [28.5, 20.0, 0],
  ];
  for (const [x, y, i] of hung) {
    P.props.push({
      key: `prop/fest/paper_lantern_${i}`,
      x, y,
      spec: { over: true, offset: [0, -26], anim: i === 0 ? 'paper_lantern_glow' : `paper_lantern_${i}_glow` },
    });
    P.lights.push({ x, y: y - 2.4, radius: 30, color: [AMBER, ROSE, CANDLE, TEAL, AMBER, ROSE][i], intensity: 0.3, flicker: 0.2 });
  }

  // ── string light runs and bunting ────────────────────────────────────────
  stringRun(4, 13, 12);
  stringRun(13, 22, 12, false);
  stringRun(25, 34, 12, false);
  stringRun(34, 44, 12);
  stringRun(4, 13, 29);
  stringRun(13, 22, 29, false);
  stringRun(25, 34, 29, false);
  stringRun(34, 44, 29);
  buntingRun(5, 43, 15);
  buntingRun(5, 17, 26);
  buntingRun(31, 43, 26);
  buntingRun(20, 27, 31);

  // ── the river: floating lanterns drifting past the stage ─────────────────
  const floats: Array<[number, number, string]> = [
    [5.5, 6.2, ''], [9.0, 5.4, '_b'], [13.5, 6.8, '_c'], [18.0, 5.6, ''],
    [27.5, 6.4, '_b'], [31.0, 5.2, '_c'], [35.5, 6.6, ''], [40.0, 5.8, '_b'],
    [43.5, 7.0, '_c'], [22.0, 7.4, ''],
  ];
  for (const [x, y, v] of floats) {
    P.props.push({ key: `prop/fest/lantern_float${v}_0`, x, y, spec: { anim: `lantern_float${v}` } });
    P.lights.push({ x, y: y - 0.6, radius: 26, color: v === '_b' ? ROSE : v === '_c' ? TEAL : AMBER, intensity: 0.42, flicker: 0.3 });
  }
  put('prop/town/jetty', 30.5, 10.6, {});
  put('prop/town/jetty', 12.5, 10.6, {});

  // A little confetti and petal litter where the crowd has been standing.
  const litter: Array<[string, number, number]> = [
    ['prop/fest/confetti_0', 17.4, 24.7], ['prop/fest/confetti_1', 29.6, 25.3],
    ['prop/fest/confetti_2', 21.2, 28.4], ['prop/fest/confetti_3', 26.8, 27.1],
    ['prop/fest/petal_0', 15.6, 21.3], ['prop/fest/petal_2', 31.4, 23.8],
    ['prop/fest/petal_1', 24.6, 29.6], ['prop/fest/petal_3', 19.4, 19.4],
  ];
  for (const [k, x, y] of litter) P.props.push({ key: k, x, y, spec: { depthBias: -60 } });

  return {
    id: 'festival',
    name: 'Festival Plaza',
    subtitle: 'the Festival of Lanterns',
    music: 'festival',
    tint: 0x1b1740,
    darkness: 0.42,
    ground,
    legend: {
      '.': { base: 'town/grass' },
      ',': { base: 'town/grass', scatter: 'sparse' },
      '"': { base: 'town/grass', scatter: 'lush' },
      'T': { base: 'town/grass' },
      'c': { base: 'fest/plaza_flag', blob: 'cobble' },
      'p': { base: 'town/grass', blob: 'path' },
      'f': { base: 'fest/plaza_flag', blob: 'fest_carpet' },
      's': { base: 'town/grass', blob: 'sand' },
      '~': { base: 'town/grass', blob: 'water', solid: true },
      '#': { base: 'town/soil', solid: true },
    },
    scatterRules: {
      sparse: { density: 0.45, tiles: [['scatter/tuft_sm', 5], ['scatter/tuft_md', 3], ['scatter/pebbles', 1], ['', 6]] },
      lush: { density: 0.85, tiles: [['scatter/tuft_md', 4], ['scatter/tuft_lg', 3], ['scatter/flower_gold', 2], ['scatter/flower_white', 2], ['scatter/flower_rose', 1]] },
    },
    objects: o.rows(),
    above: a.rows(),
    objectLegend: {
      'T': { key: ['prop/town/tree_oak_0', 'prop/town/tree_oak_1', 'prop/town/tree_oak_2', 'prop/town/tree_oak_3', 'prop/town/tree_pine_0', 'prop/town/tree_pine_1'], solid: [14, 8] },
      'b': { key: ['prop/town/bush_0', 'prop/town/bush_1', 'prop/town/bush_2'], sway: 0.4 },
      'r': { key: ['prop/town/reeds_0', 'prop/town/reeds_1', 'prop/town/reeds_2'], sway: 0.6 },
      'G': { key: 'prop/fest/string_lights_span_lit_0', anim: 'string_lights_shimmer', offset: [0, -34] },
      'U': { key: 'prop/fest/bunting_0', offset: [0, -38] },
      'V': { key: 'prop/fest/bunting_1', offset: [0, -38] },
      'X': { key: 'prop/fest/bunting_2', offset: [0, -38] },
    },
    props: P.props,
    npcs: [
      // The seven who take part in the trial, arranged as an arc that opens
      // toward the stage. The player's answering spot is the gap at its mouth —
      // standing IN the group, not in front of it, is what makes round three
      // work, so this arrangement is gameplay, not decoration.
      { id: 'tavi', x: 19.4, y: 24.4, facing: 'n' },
      { id: 'nia', x: 29.6, y: 25.6, facing: 'n' },
      { id: 'villager_a', x: 17.6, y: 26.2, facing: 'n' },
      { id: 'villager_b', x: 19.2, y: 28.0, facing: 'n' },
      { id: 'villager_c', x: 21.2, y: 25.0, facing: 'n' },
      { id: 'villager_d', x: 25.8, y: 25.0, facing: 'n' },
      { id: 'villager_e', x: 27.4, y: 28.0, facing: 'n' },
      // Host, observer, and the two who are here for the food.
      { id: 'elia', x: 27.8, y: 22.4, facing: 'w' },
      { id: 'sera', x: 15.8, y: 23.0, facing: 'e' },
      { id: 'mira', x: 6.2, y: 15.4, facing: 's' },
      { id: 'oren', x: 12.0, y: 19.4, facing: 'n', path: [[12, 19], [9, 21], [12, 22]], dwell: 3.2 },
      { id: 'villager_f', x: 36.0, y: 15.6, facing: 's' },
    ],
    zones: [
      { kind: 'camera', id: 'bounds', x: 0, y: 0, w: W, h: H },
      { kind: 'door', id: 'to_town', x: 21, y: H - 1, w: 5, h: 1, to: 'lumen_vale', spawn: 'north', facing: 's' },
      // Fires as the player comes under the arch, before they reach the crowd.
      { kind: 'trigger', id: 'festival_arrival', x: 20, y: 30, w: 7, h: 2, forbids: 'q3_intro_done' },
      // Stepping into the back of the arc is what starts the ceremony.
      { kind: 'trigger', id: 'trial_ready', x: 19, y: 29, w: 10, h: 2, forbids: 'q3_trial_done' },
    ],
    lights: P.lights,
    spawns: {
      // South of the arrival trigger, so a harness jump does not fire a cutscene.
      default: { x: 23, y: 34, facing: 'n' },
      south: { x: 23, y: 34, facing: 'n' },
      trial: { x: 23, y: 27, facing: 'n' },
      stage: { x: 23, y: 21, facing: 'n' },
    },
  };
}

registerMap('festival', build);
