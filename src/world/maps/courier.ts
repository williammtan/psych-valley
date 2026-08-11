/**
 * THE COURIER OFFICE — Courier Row, western Lumen Vale. (plan.md §5.4)
 *
 * A small business mid-crisis. Oren's office is normally the tidiest room in
 * the valley; today the sorting counter is buried, four parcels are on the
 * floor where they were put down and never picked up again, his chair is
 * shoved back from the stamp desk and half the duty roster has been rubbed out
 * and not rewritten.
 *
 * Everything the player needs to reconstruct two days is a physical object in
 * this room, so the layout is arranged around evidence rather than around
 * furniture:
 *
 *      pigeonholes ────────────  route board  roster clock  lost property
 *      ┌──────────────────────┐                                   ▐ door ▐
 *      │      staff side      │   stamp desk   scales   parcel stack
 *      ╞═ sorting counter ════╡
 *      │     public side      │   ← loose parcels, pushed-back chair
 *      │  handcart   sacks    │
 *      └──────────────────────┘
 *
 * The room is exactly one screen wide (30 tiles) so the whole crisis is
 * legible in a single frame when the player walks in.
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { MapDef } from '../types';

const W = 30;
const H = 19;

/** Back wall occupies rows 0-2; the floor runs 3-17; row 18 is the near wall. */
const WALL_ROWS = 3;
const FLOOR_TOP = WALL_ROWS;
const FLOOR_BOTTOM = H - 2;
/** Doorway columns, in the back wall. */
const DOOR_X = 24;

function build(): MapDef {
  const g = new GridPainter(W, H, '.');

  // ── shell ───────────────────────────────────────────────────────────────
  g.rect(0, 0, W, 1, '#');       // wall top
  g.rect(0, 1, W, 1, '=');       // wall mid
  g.rect(0, 2, W, 1, '_');       // wall base
  g.rect(0, H - 1, W, 1, 'F');   // near wall, seen from above
  g.vLine(FLOOR_TOP, FLOOR_BOTTOM, 0, 'L');
  g.vLine(FLOOR_TOP, FLOOR_BOTTOM, W - 1, 'R');

  // Windows over the public side, so the bench and the door get daylight.
  g.set(21, 1, 'w');
  g.set(22, 1, 'w');

  // The doorway punches through all three wall rows; only its base is walkable.
  for (const x of [DOOR_X, DOOR_X + 1]) {
    g.set(x, 0, 'D');
    g.set(x, 1, 'E');
    g.set(x, 2, 'd');
  }
  g.set(DOOR_X, 3, 'm');
  g.set(DOOR_X + 1, 3, 'm');

  // The public half of the floor is tiled — it takes the boots and the mud.
  g.rect(12, 9, 16, 8, 'o');
  // A warm patch under the window where the sun lands.
  g.rect(19, 4, 5, 4, ',');

  const ground = g.rows();

  return {
    id: 'courier',
    name: 'Courier Office',
    subtitle: 'Courier Row',
    music: 'town',
    indoor: true,
    darkness: 0.22,

    ground,
    legend: {
      '.': { base: 'int/wood_floor' },
      ',': { base: 'int/wood_floor_warm' },
      'o': { base: 'int/wood_floor', blob: 'floor_tile' },
      'm': { base: 'int/doormat' },
      '#': { base: 'int/wall_wood_top', solid: true },
      '=': { base: 'int/wall_wood_mid', solid: true },
      '_': { base: 'int/wall_wood_base', solid: true },
      'w': { base: 'int/wall_window', solid: true },
      'L': { base: 'int/wall_wood_corner_l', solid: true },
      'R': { base: 'int/wall_wood_corner_r', solid: true },
      'F': { base: 'int/wall_wood_front', solid: true },
      'D': { base: 'int/doorway_top', solid: true },
      'E': { base: 'int/doorway_mid', solid: true },
      'd': { base: 'int/doorway_base' },
    },

    props: [
      // ── the wall of pigeonholes ──────────────────────────────────────────
      // Five cabinets butted together, 32px each, filling the left back wall.
      { key: 'prop/int/post_pigeon_l', x: 1.5, y: 3, spec: { solid: [32, 10] }, id: 'pigeon_l' },
      { key: 'prop/int/post_pigeon_mid', x: 3.5, y: 3, spec: { solid: [32, 10] } },
      { key: 'prop/int/post_pigeon_mid', x: 5.5, y: 3, spec: { solid: [32, 10] }, id: 'pigeonholes' },
      { key: 'prop/int/post_pigeon_mid', x: 7.5, y: 3, spec: { solid: [32, 10] } },
      { key: 'prop/int/post_pigeon_r', x: 9.5, y: 3, spec: { solid: [32, 10] }, id: 'pigeon_r' },

      // ── the rest of the back wall ────────────────────────────────────────
      { key: 'prop/int/post_routemap', x: 12.5, y: 3, spec: { solid: [46, 8], interact: 'route_board' }, id: 'route_board' },
      { key: 'prop/int/post_roster', x: 15.5, y: 3, spec: { solid: [20, 8], interact: 'roster' }, id: 'roster' },
      { key: 'prop/int/post_clock', x: 17.5, y: 2.6, spec: { depthBias: -8 } },
      { key: 'prop/int/post_lostshelf', x: 19.5, y: 3.4, spec: { solid: [28, 8], interact: 'lost_shelf' }, id: 'lost_shelf' },
      { key: 'prop/int/inn_coatrack', x: 27, y: 3.6, spec: { solid: [12, 8] } },
      { key: 'prop/int/inn_sconce_0', x: 11.4, y: 2.4, spec: { anim: 'sconce_flicker', depthBias: -8 } },
      { key: 'prop/int/inn_sconce_0', x: 23.4, y: 2.4, spec: { anim: 'sconce_flicker', depthBias: -8 } },

      // ── the sorting counter, three units wide ────────────────────────────
      { key: 'prop/int/post_counter', x: 2.5, y: 8, spec: { solid: [48, 14] } },
      { key: 'prop/int/post_counter', x: 5.5, y: 8, spec: { solid: [48, 14] }, id: 'counter' },
      { key: 'prop/int/post_counter', x: 8.5, y: 8, spec: { solid: [48, 14] } },
      // On the counter: the bell nobody has rung today, and two parcels from
      // the pile outside — the same wraps the player saw on Courier Row.
      { key: 'prop/int/post_bell', x: 3, y: 7.5, spec: { depthBias: 6 } },
      { key: 'prop/town/parcel_1', x: 6, y: 7.4, spec: { depthBias: 6 } },
      { key: 'prop/town/parcel_0', x: 9.2, y: 7.5, spec: { depthBias: 6 } },
      { key: 'prop/int/post_letters', x: 7.6, y: 7.6, spec: { depthBias: 6 } },

      // ── the working line: stamp desk, scales, the parcel mountain ────────
      { key: 'prop/int/post_stampdesk', x: 12.4, y: 8, spec: { solid: [28, 12], interact: 'stamp_desk' }, id: 'stamp_desk' },
      { key: 'prop/int/inn_chair_pushed', x: 12.6, y: 10.4, spec: { solid: [14, 8] } },
      { key: 'prop/int/post_scales', x: 14.6, y: 8, spec: { solid: [18, 10], interact: 'scales' }, id: 'scales' },
      { key: 'prop/int/post_parcel_stack', x: 17.2, y: 8, spec: { solid: [26, 12], interact: 'parcel_stack' }, id: 'parcel_stack' },
      { key: 'prop/int/lab_paperstack', x: 19.4, y: 8 },
      { key: 'prop/int/post_parcel_1', x: 18.6, y: 6.6 },

      // ── the public side ──────────────────────────────────────────────────
      { key: 'prop/int/post_bench', x: 26, y: 7, spec: { solid: [30, 8] } },
      { key: 'prop/int/post_handcart', x: 5.4, y: 15.4, spec: { solid: [34, 12], interact: 'handcart' }, id: 'handcart' },
      { key: 'prop/int/post_sacks', x: 2.2, y: 16.4, spec: { solid: [30, 10] } },
      { key: 'prop/int/post_sacks', x: 21.4, y: 15.6, spec: { solid: [30, 10] } },
      { key: 'prop/int/inn_bucket', x: 8.6, y: 16.6 },
      { key: 'prop/int/inn_broom', x: 1.4, y: 12.6 },
      { key: 'prop/int/boots', x: 25.8, y: 4.6 },
      // Yesterday's boots, still caked, well away from today's clean pair.
      { key: 'prop/int/boots', x: 2.6, y: 10.4 },
      { key: 'prop/int/inn_stool', x: 4.2, y: 5.6 },
      { key: 'prop/int/inn_stool', x: 9.6, y: 5.4 },
      { key: 'prop/int/lab_paperstack', x: 1.6, y: 6.4 },
      { key: 'prop/int/books_stack', x: 6.4, y: 5.2 },
      { key: 'prop/int/inn_barrel', x: 10.6, y: 16.6, spec: { solid: [14, 8] } },
      { key: 'prop/int/post_sacks', x: 8.4, y: 12.4, spec: { solid: [30, 10] } },
      { key: 'prop/int/rug_runner', x: 4.6, y: 9.8, spec: { depthBias: -70 } },

      // Parcels put down and never picked up again — the crisis, in objects.
      { key: 'prop/int/post_parcel_0', x: 14.2, y: 12.2 },
      { key: 'prop/int/post_parcel_3', x: 16.4, y: 11.4 },
      { key: 'prop/int/post_parcel_2', x: 12.6, y: 14.2 },
      { key: 'prop/int/post_parcel_1', x: 15.6, y: 13.8 },
      { key: 'prop/int/post_parcel_0', x: 18.4, y: 13.2 },
      { key: 'prop/town/parcel_2', x: 10.6, y: 13.4 },
      { key: 'prop/town/parcel_3', x: 9.4, y: 11.6 },
      { key: 'prop/int/post_parcel_3', x: 23.4, y: 12.6 },
      { key: 'prop/int/lab_crates', x: 27.2, y: 13, spec: { solid: [28, 10] } },
      { key: 'prop/int/books_stack', x: 24.4, y: 16.4 },
      { key: 'prop/int/post_parcel_1', x: 3.4, y: 13.6 },
      { key: 'prop/int/post_parcel_3', x: 5.8, y: 11.8 },
      { key: 'prop/int/post_parcel_0', x: 7.2, y: 14.8 },
      { key: 'prop/int/post_parcel_2', x: 2.4, y: 15.4 },
      { key: 'prop/int/post_letters', x: 6.6, y: 17.2 },
      { key: 'prop/town/parcel_3', x: 11.4, y: 10.6 },
    ],

    npcs: [
      { id: 'oren', x: 13, y: 10, facing: 'n', dwell: 2 },
      { id: 'villager_b', x: 20, y: 11, facing: 'w', dwell: 3 },
      { id: 'villager_d', x: 25, y: 10, facing: 'n', dwell: 3 },
      { id: 'villager_c', x: 23, y: 13, facing: 'n', path: [[23, 13], [19, 14], [23, 13]], dwell: 4 },
    ],

    zones: [
      // Back out onto Courier Row, not into the town square. lumen_vale's
      // 'default' spawn is the fountain, so sending the player there teleported
      // them halfway across the map every time they left Oren's office.
      { kind: 'door', id: 'to_town', x: DOOR_X, y: 2, w: 2, h: 1, to: 'lumen_vale', spawn: 'courier_door', facing: 's' },
      // Set back from the doormat: walking in should start the scene, but
      // spawning here (debug jumps, a door transition) should not.
      { kind: 'trigger', id: 'oren_intro', x: 18, y: 7, w: 10, h: 3, forbids: 'q2_started' },
      { kind: 'camera', id: 'bounds', x: 0, y: 0, w: W, h: H },
    ],

    lights: [
      { x: 11.4, y: 3, radius: 46, color: 0xffb937, intensity: 0.5, flicker: 0.6 },
      { x: 23.4, y: 3, radius: 46, color: 0xffb937, intensity: 0.5, flicker: 0.6 },
      { x: 21.5, y: 4, radius: 62, color: 0xc9dcff, intensity: 0.34 },
    ],

    spawns: {
      default: { x: 24, y: 5, facing: 's' },
      door: { x: 24, y: 4, facing: 's' },
      counter: { x: 12, y: 11, facing: 'n' },
      board: { x: 12, y: 6, facing: 'n' },
    },
  };
}

registerMap('courier', build);
