/**
 * LUMEN VALE — the town.
 *
 *              Festival Plaza (N)
 *                     |
 *   Courier Row ── Bell Tower
 *        |            |
 *        |        Town Square ──── bridge ──── Lantern Inn (east bank)
 *   Sera's Lab ──────┴──────
 *                     |
 *                South Gate → Whisper Woods
 *
 * Composition rules this file exists to enforce (references.md, "Environmental
 * Density Rule" + the Stardew density plate):
 *
 *  1. NO FLOOR PLAN. Ground is drawn first but must not be *visible* as
 *     geometry: every rectangle boundary is broken by something tall standing
 *     across it. Trees, hedges, stalls and fences are placed to overlap path
 *     edges and building bases, never to sit politely beside them.
 *  2. NO BARE SLABS. Buildings get collision from `kind: 'block'` zones, not
 *     from a rectangle of soil painted under them. The only bare earth is a
 *     small worn threshold at a door and irregular, fenced, *occupied* yards.
 *  3. PAVING IS EXPENSIVE. The square is the only large paved area and it is
 *     deliberately small, kerbed with a coarser stone, and broken by planting.
 *     Everything else is grass, dirt lane or worn verge.
 *  4. TALL, DARK THINGS EVERYWHERE. Canopy is the darkest value available in
 *     this palette; without it the frame has no tonal range to read against.
 *  5. PATHS LEAD SOMEWHERE VISIBLE. Every lane ends at a door, a crossing, a
 *     gate or a landmark, and every door has a paved stub out to a route.
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { LightDef, MapDef, NpcPlacement, PropPlacement, Zone } from '../types';

const W = 88;
const H = 78;

// ── the river ────────────────────────────────────────────────────────────────
// [row, centre column, half-width]. Enters top-right, sweeps west past the
// town, bulges into a slow pool beside the inn, bends back south-east and
// leaves. The town sits inside the curve.
const RIVER: Array<[number, number, number]> = [
  [-6, 79, 3],
  [12, 73, 3],
  [24, 70, 3.2],
  [36, 67, 3.2],
  [46, 65, 3.4],
  [54, 65, 4.4],
  [62, 66, 4],
  [70, 69, 3.4],
  [84, 74, 3],
];

function riverAt(y: number): [number, number] {
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [y0, x0, h0] = RIVER[i];
    const [y1, x1, h1] = RIVER[i + 1];
    if (y >= y0 && y <= y1) {
      const t = (y - y0) / (y1 - y0);
      const ease = t * t * (3 - 2 * t);
      const wob = Math.sin(y * 0.41) * 0.55 + Math.sin(y * 0.17 + 1.3) * 0.45;
      return [x0 + (x1 - x0) * ease + wob, h0 + (h1 - h0) * ease];
    }
  }
  const last = RIVER[RIVER.length - 1];
  return [last[1], last[2]];
}

// ── buildings ────────────────────────────────────────────────────────────────
// `tx,ty,w,h` is the tile footprint the building occupies: it is the collision
// rect, and the sprite is placed so its drawn ground line lands exactly on the
// footprint's bottom edge. `gap` is the transparent shadow margin below each
// sprite (sprite height minus the artwork's ground line).
interface Bld {
  id: string;
  key: string;
  tx: number; ty: number; w: number; h: number;
  gap: number;
  /** [column offset from tx, width in tiles]; omitted if you cannot enter. */
  door?: [number, number];
}

const BUILDINGS: Bld[] = [
  { id: 'store', key: 'prop/build/store', tx: 33, ty: 29, w: 7, h: 7, gap: 8, door: [3, 1] },
  { id: 'belltower', key: 'prop/build/belltower', tx: 48, ty: 25, w: 5, h: 11, gap: 8, door: [2, 1] },
  { id: 'courier', key: 'prop/build/courier', tx: 10, ty: 29, w: 7, h: 6, gap: 12, door: [3, 1] },
  { id: 'workshop', key: 'prop/build/workshop', tx: 12, ty: 52, w: 7, h: 7, gap: 8, door: [3, 1] },
  { id: 'inn', key: 'prop/build/inn', tx: 76, ty: 33, w: 8, h: 8, gap: 10, door: [3, 2] },
  { id: 'house_b', key: 'prop/build/house_b', tx: 22, ty: 28, w: 4, h: 7, gap: 6, door: [1, 2] },
  { id: 'house_a', key: 'prop/build/house_a', tx: 5, ty: 38, w: 5, h: 6, gap: 8, door: [2, 1] },
  { id: 'house_c', key: 'prop/build/house_c', tx: 30, ty: 58, w: 6, h: 6, gap: 10, door: [2, 2] },
  { id: 'house_d', key: 'prop/build/house_d', tx: 50, ty: 58, w: 5, h: 6, gap: 6, door: [2, 1] },
  { id: 'house_e', key: 'prop/build/house_e', tx: 8, ty: 62, w: 6, h: 5, gap: 10, door: [2, 2] },
  { id: 'barn', key: 'prop/build/barn_small', tx: 8, ty: 9, w: 6, h: 5, gap: 5 },
  { id: 'wellhouse', key: 'prop/build/wellhouse', tx: 22, ty: 64, w: 3, h: 4, gap: 10 },
  // Moved two tiles west out of what is now the Market Green, so the stall row
  // has a clear north side to stand on.
  { id: 'shed_courier', key: 'prop/build/shed', tx: 23, ty: 29, w: 3, h: 3, gap: 4 },
  { id: 'shed_inn', key: 'prop/build/shed', tx: 84, ty: 45, w: 3, h: 3, gap: 4 },
  { id: 'outhouse', key: 'prop/build/outhouse', tx: 18, ty: 68, w: 2, h: 3, gap: 4 },
  { id: 'south_gate', key: 'prop/build/south_gate_closed', tx: 39, ty: 71, w: 6, h: 6, gap: 6 },
];

const bld = (id: string): Bld => BUILDINGS.find((b) => b.id === id)!;
const doorX = (b: Bld): number => b.tx + b.door![0];
const doorY = (b: Bld): number => b.ty + b.h;

function build(): MapDef {
  const g = new GridPainter(W, H, '.');
  const props: PropPlacement[] = [];
  const zones: Zone[] = [];
  const lights: LightDef[] = [];

  /** Deterministic 0..1 noise, so "random" dressing is stable across reloads. */
  const rnd = (a: number, b = 0) => {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  /**
   * VARIANT SPREADING
   * ─────────────────
   * A blind A/B against a commercial reference counted, in one frame, twelve
   * pixel-identical trees, ten identical twigs, five identical crates and
   * three identical lampposts. Nearly all of it came from hand-placed props:
   * an author writing dressing reaches for `crate_1` and `chicken_0` every
   * time, and 393 placements later the town is a copy-paste sheet.
   *
   * The grid legend already lists every variant, so this table does the same
   * job for the explicit `props` array: any key whose family appears here is
   * re-picked from the family's full range using the position it stands on.
   * Deterministic, so the town looks the same on every load, and the fix
   * survives someone adding another crate next month.
   *
   * Counts come from `public/assets/atlas.json`. Families NOT listed are
   * deliberate: signposts point in different directions, bunting and string
   * lights are laid in ordered runs, awnings are chosen per building, and
   * chimney smoke plays an animation that replaces the frame anyway.
   */
  const VARIANTS: Record<string, number> = {
    'prop/town/tree_oak': 4, 'prop/town/tree_pine': 3, 'prop/town/tree_blossom': 2,
    'prop/town/bush': 4, 'prop/town/sapling': 2, 'prop/town/rock': 4,
    'prop/town/mossy_rock': 2, 'prop/town/river_rock': 3, 'prop/town/lilypad': 2,
    'prop/town/reeds': 3, 'prop/town/vegetable_row': 3, 'prop/town/flowerbed': 3,
    'prop/town/planter': 2, 'prop/town/bench': 2, 'prop/town/crate': 3,
    'prop/town/basket': 3, 'prop/town/barrel': 2, 'prop/town/sack': 2,
    'prop/town/woodpile': 2, 'prop/town/log': 2, 'prop/town/parcel': 4,
    'prop/town/chicken': 4, 'prop/town/duck': 4, 'prop/town/butterfly': 4,
    'prop/town/bird_perched': 2, 'prop/town/cat_sleeping': 2, 'prop/town/chair': 2,
    'prop/town/laundry_line': 3, 'prop/fest/ground_lantern': 3,
  };

  /**
   * CONTACT SHADOWS
   * ───────────────
   * The builder now drops a shadow under every prop, which is right for the
   * ninety per cent of them that stand on the ground and wrong — visibly,
   * embarrassingly wrong — for the rest. Two kinds opt out:
   *
   *   airborne   chimney smoke, hanging trade signs, wall-mounted awnings and
   *              window boxes, butterflies, birds sitting on a roof ridge. A
   *              shadow directly under these lands several tiles from where
   *              the thing actually is.
   *   flat       lilypads and rocks lying in the river, the jetty deck. A dark
   *              ellipse painted on open water reads as a hole in the river.
   *
   * Held here rather than at each of the forty call sites, so it cannot be
   * forgotten the next time somebody hangs a sign.
   */
  const NO_SHADOW = [
    'prop/build/chimney_smoke', 'prop/build/sign_', 'prop/build/awning_',
    'prop/town/window_box', 'prop/town/butterfly_', 'prop/town/bird_perched_',
    'prop/town/lilypad_', 'prop/town/river_rock_', 'prop/town/jetty',
  ];
  /** Low boxes: they stand up, but only just. A tight ellipse, not a blob. */
  const SMALL_SHADOW = ['prop/town/flowerbed_', 'prop/town/vegetable_row_'];

  const P = (key: string, x: number, y: number, spec?: PropPlacement['spec'], id?: string) => {
    const m = /^(.*)_(\d+)$/.exec(key);
    const n = m ? VARIANTS[m[1]] : undefined;
    const k = n ? `${m![1]}_${Math.floor(rnd(Math.round(x * 4) * 131 + 7, Math.round(y * 4) * 197 + 13) * n) % n}` : key;
    let s = spec;
    if (!s?.shadow) {
      if (NO_SHADOW.some((p) => k.startsWith(p))) s = { ...s, shadow: 'none' };
      else if (SMALL_SHADOW.some((p) => k.startsWith(p))) s = { ...s, shadow: 'small' };
    }
    props.push({ key: k, x, y, spec: s, id });
  };

  /**
   * A washing line and the two posts holding it up.
   *
   * The line sprite is a rope and three garments with nothing at either end,
   * so at normal framing the washing floats. The posts are the bridge's
   * railing posts — 22px, which is exactly where the rope sits — and they are
   * ordinary ground props, so they take a contact shadow and the player walks
   * behind them. There is no dedicated laundry post in the atlas; this is the
   * closest existing part and it reads correctly. (Art gap, noted.)
   */
  const laundry = (x: number, y: number, spec?: PropPlacement['spec']) => {
    P('prop/town/laundry_line_0', x, y, { over: true, sway: 0.5, ...spec });
    P('prop/town/bridge_post', x - 1.5, y, { depthBias: 60 });
    P('prop/town/bridge_post', x + 1.5, y, { depthBias: 60 });
  };

  /**
   * A lamppost plus the light it actually casts.
   *
   * There is one lamppost design in the atlas and no budget to draw another,
   * so the variation has to come from here. Three things vary per lamp: which
   * of the three lit frames it rests on, whether it runs the flicker cycle at
   * all (running it on every lamp put thirty-one posts in perfect lockstep,
   * which reads worse than no animation), and the size and warmth of the pool
   * it throws. The light layer is the one thing this engine has that the
   * reference does not, so it is where the individuality goes.
   */
  const lamp = (x: number, y: number, radius = 46, intensity = 0.42) => {
    const v = rnd(Math.round(x * 8) + 91, Math.round(y * 8) + 37);
    const frame = Math.floor(v * 3) % 3;
    const warm = [0xffb937, 0xffc766, 0xffa62e, 0xffd08a][Math.floor(v * 4) % 4];
    props.push({
      key: `prop/town/lamppost_lit_${frame}`,
      x, y,
      spec: { solid: [8, 6], ...(v < 0.42 ? { anim: 'lamppost_flicker' } : {}) },
    });
    lights.push({
      x, y: y - 2,
      radius: Math.round(radius * (0.86 + v * 0.3)),
      color: warm,
      intensity: intensity * (0.86 + rnd(Math.round(x * 8) + 5, Math.round(y * 8) + 3) * 0.32),
      flicker: 0.34 + v * 0.4,
    });
  };

  const SOFT = '.,"*;y';
  const WALK = 'pdcxgWEQK=';
  /** Every cell a `route()` painted. Squares and greens are deliberately not in
   *  here: only roads get a worn centre lane rubbed through them. */
  const onRoute: boolean[][] = Array.from({ length: H }, () => new Array<boolean>(W).fill(false));

  // ══ 1. grass, in bands rather than one flat texture ══════════════════════
  g.scatter(',', ['.'], 0.44, 11);
  g.scatter('"', ['.', ','], 0.15, 29);
  // Sun-scorched patches: the only warm ground tone that is not a path.
  for (const [cx, cy, rx, ry, sd] of [
    [30, 41, 4, 3, 401], [50, 53, 4, 3, 403], [39, 25, 4, 2.5, 405],
    [22, 47, 3.5, 3, 407], [62, 34, 4, 3.5, 409], [46, 64, 4, 3, 411],
    [14, 27, 3, 3, 413], [78, 44, 3.5, 3, 415],
    // Around the Market Green and the bakery: the town's biggest remaining
    // sheets of one flat green, broken with the dry-grass overlay.
    [29, 40, 4, 2.5, 417], [39, 33, 3, 3.5, 419], [26, 28, 3.5, 2.5, 421],
    [35, 42, 3, 2, 423], [18, 40, 3.5, 3, 425], [52, 36, 3.5, 3, 427],
  ] as const) g.blob(cx, cy, rx, ry, 'y', sd, 0.5);
  // Wildflower meadows: clustered colour accents, never sprinkled evenly.
  for (const [cx, cy, rx, ry, sd] of [
    [18, 20, 7, 5, 3], [61, 16, 5, 5, 7], [25, 50, 4, 4, 13],
    [27, 73, 8, 3, 17], [58, 67, 5, 4, 19], [59, 30, 4, 4, 23],
    [80, 30, 4, 4, 29], [15, 74, 6, 3, 31], [66, 48, 3, 4, 37],
  ] as const) g.blob(cx, cy, rx, ry, '*', sd, 0.45);

  // ══ 2. the tree line ═════════════════════════════════════════════════════
  // 'X' is grass that is solid: deep wood the player reads as scenery, not as
  // a route. Blobs only — no straight edges anywhere on the map border.
  //
  // The wood is deliberately DEEP on the north and west sides. A blind review
  // found the frame leaking at every border — trees cut mid-canopy, a lane
  // running off the edge — and the cure is not a fence, it is enough wood that
  // the canopy the camera crops is the third row back rather than the first.
  // Roads leave through gaps cut on purpose, listed below.
  g.rect(0, 0, W, 3, 'X');
  g.rect(0, 0, 3, H, 'X');
  g.rect(W - 2, 0, 2, H, 'X');
  g.rect(0, H - 2, W, 2, 'X');
  // NB: these are sized to the space actually free. The farm's north fence sits
  // at y=7, its west fence at x=6, and the market gardens run out to x=7 —
  // push a blob past any of those and the wood swallows a fence line or a
  // vegetable plot, which costs far more than the extra depth buys.
  for (const [cx, cy, rx, ry, sd] of [
    [10, 2, 12, 4, 2], [34, 1, 14, 4, 3], [58, 2, 12, 4, 5], [80, 3, 10, 5, 7],
    [22, 1, 9, 4, 91], [48, 1, 10, 4, 93], [68, 2, 9, 4, 95],
    [3, 14, 4, 12, 11], [2, 34, 4, 10, 13], [3, 54, 4, 9, 17], [4, 70, 6, 6, 19],
    [2, 24, 3, 6, 97], [2, 44, 3, 7, 99], [2, 62, 3, 5, 101],
    [82, 12, 7, 14, 23], [84, 34, 5, 10, 29], [83, 58, 6, 10, 31],
    [20, 76, 10, 4, 37], [46, 76, 12, 4, 41], [70, 75, 12, 5, 43],
    [79, 19, 5, 9, 47], [78, 66, 8, 8, 53], [64, 72, 8, 5, 61],
    [30, 21, 3, 3, 67], [8, 31, 3, 3, 71], [1, 45, 3, 6, 73],
  ] as const) g.blob(cx, cy, rx, ry, 'X', sd, 0.34);
  // The one gap cut on purpose in the north border: the road out to Festival
  // Plaza. The south exit is the gate building itself, which frames its own.
  g.blob(43.5, 7, 3.6, 6, ',', 111, 0.22);
  g.blob(18, 20, 8, 6, ',', 79, 0.3);   // keep the north meadow open
  // The overlook: a bench and a wayside shrine looking back down the valley.
  // Without this the east screen is one unbroken wall of canopy and the only
  // authored thing in it is invisible.
  g.blob(78.5, 22, 3.6, 3.2, ',', 115, 0.3);
  g.blob(12, 62, 6, 5, ',', 83, 0.3);   // keep the south-west gardens open

  // ══ 3. the river ═════════════════════════════════════════════════════════
  for (let y = 0; y < H; y++) {
    const [cx, half] = riverAt(y);
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x + 0.5 - cx);
      if (d <= half) g.set(x, y, '~');
      else if (d <= half + 1.5) g.set(x, y, 's');
      else if (d <= half + 2.7 && rnd(x, y * 3) < 0.5) g.set(x, y, 's');
    }
  }

  // ══ 4. roads and lanes ═══════════════════════════════════════════════════
  // Drawn as polylines with a varying radius and a jittered shoulder, so no
  // road in the town is a constant-width rectangle.
  const route = (pts: Array<[number, number]>, w0: number, w1: number, ch: string, sd: number) => {
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(len * 3));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = x0 + (x1 - x0) * t;
        const cy = y0 + (y1 - y0) * t;
        const u = (acc + len * t) / Math.max(1, total);
        // Width breathes along the run: wider at junctions, tighter between.
        const r = (w0 + (w1 - w0) * u) / 2 * (0.86 + 0.24 * Math.sin(u * 9 + sd));
        const R = Math.ceil(r) + 1;
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const px = Math.round(cx) + dx;
            const py = Math.round(cy) + dy;
            const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
            if (d <= r + (rnd(px * 3 + sd, py * 5) - 0.45) * 0.9) {
              g.set(px, py, ch);
              if (g.inside(px, py)) onRoute[py][px] = true;
            }
          }
        }
      }
      acc += len;
    }
  };

  /**
   * A junction, a doorway apron or a passing place: a road is not a constant
   * ribbon, it swells wherever people stop, turn or set something down. Every
   * crossing in the town gets one, which is what stops the lanes reading as
   * pipes laid over a lawn.
   */
  const bulge = (cx: number, cy: number, r: number, ch: string, sd: number) => {
    const R = Math.ceil(r) + 1;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        const d = Math.hypot(dx, dy);
        if (d > r + (rnd(px * 7 + sd, py * 11 + sd) - 0.4) * 1.3) continue;
        if (!g.inside(px, py)) continue;
        const c = g.get(px, py);
        if (!SOFT.includes(c) && !WALK.includes(c)) continue;   // never over water, fence or bridge
        g.set(px, py, ch);
        onRoute[py][px] = true;
      }
    }
  };

  // Vale Road: the north-south spine, with a dogleg so nothing lines up. It
  // starts at the plaza's flower arch — NOT in the trees above it. A road that
  // fades into scenery is the single loudest tell that a map was painted
  // rather than planned, so every polyline here ends on a door, a crossing, a
  // gate or a landmark, and the treeline closes over it afterwards.
  route([[44, 8], [44, 16], [45, 24], [44, 32], [44, 40], [43, 47]], 4.4, 4.0, 'p', 1);
  route([[43, 47], [42, 54], [42, 62], [41, 68], [41, 71]], 4.0, 3.6, 'p', 2);
  // Bridge Street: Courier Row → square → bridge → the inn.
  route([[15, 44], [24, 45], [33, 45], [44, 45]], 2.8, 3.6, 'p', 3);
  route([[44, 45], [52, 44], [58, 44]], 3.6, 3.2, 'p', 4);

  // Lanes — narrower, dirt, district-flavoured.
  route([[8, 35], [17, 35], [24, 35], [29, 35]], 1.9, 2.1, 'd', 5);   // Courier Row → the market
  route([[17, 35], [17, 40], [16, 44]], 1.7, 1.9, 'd', 6);            // down to Bridge Street
  route([[20, 15], [20, 24], [20, 30], [20, 34]], 1.5, 1.9, 'd', 7);  // farm road → the row
  route([[6, 45], [11, 45], [16, 44]], 1.9, 1.7, 'd', 8);             // house_a's lane
  route([[13, 14], [13, 22], [13, 30], [12, 34]], 1.7, 1.7, 'd', 9);  // farm lane
  route([[13, 14], [20, 14], [27, 15], [34, 16]], 1.9, 1.9, 'd', 10); // farm → plaza
  route([[36, 48], [28, 50], [22, 51], [21, 56], [21, 61]], 2.1, 1.9, 'd', 11); // Sera's lane
  route([[21, 61], [16, 61], [14, 65], [13, 69]], 1.9, 1.7, 'd', 12); // Sera's → the gardens
  route([[21, 61], [21, 67], [20, 70], [13, 70]], 1.9, 1.7, 'd', 13); // market gardens
  route([[42, 64], [48, 65], [52, 64]], 1.9, 1.7, 'd', 14);           // house_d lane
  route([[42, 64], [36, 65], [33, 64]], 1.9, 1.7, 'd', 15);           // house_c lane
  route([[46, 19], [52, 24], [57, 25], [64, 27]], 1.9, 1.7, 'd', 16); // plaza → ford
  route([[74, 27], [74, 34], [74, 41], [74, 48], [73, 56]], 1.9, 1.7, 'd', 17); // east track
  route([[74, 41], [78, 41]], 1.7, 2.1, 'd', 18);                     // inn approach
  route([[73, 56], [70, 57]], 1.7, 1.7, 'd', 19);                     // down to the jetty
  route([[74, 27], [78, 24], [79, 21]], 1.7, 1.5, 'd', 20);           // up to the overlook
  route([[71, 44], [74, 44]], 2.6, 2.4, 'p', 21);                     // bridge → east track
  // The Market Green's own approaches: down to Bridge Street, and across to
  // the square's north-west shoulder. Both exist so the bakery is reachable
  // from every direction a player might arrive from.
  route([[32, 38], [31, 42], [30, 45]], 2.1, 2.4, 'd', 22);
  route([[35, 38], [37, 39], [39, 40]], 2.4, 2.8, 'p', 23);

  // Junctions and doorway aprons: the road swells wherever people stop or turn.
  for (const [jx, jy, jr, jc, js] of [
    [44, 16, 3.4, 'p', 301], [45, 24, 3.2, 'p', 302], [44, 40, 3.8, 'p', 303],
    [43, 47, 3.6, 'p', 304], [42, 62, 3.2, 'p', 305], [41, 68, 3.4, 'p', 306],
    [16, 44, 3.0, 'p', 307], [24, 45, 3.0, 'p', 308], [33, 45, 3.0, 'p', 309],
    [17, 35, 2.8, 'd', 310], [20, 34, 2.4, 'd', 311], [13, 14, 2.6, 'd', 312],
    [20, 14, 2.4, 'd', 313], [21, 61, 2.8, 'd', 314], [42, 64, 3.0, 'p', 315],
    [74, 41, 2.6, 'd', 316], [74, 27, 2.6, 'd', 317], [30, 45, 2.6, 'd', 318],
    [12, 34, 2.2, 'd', 319], [52, 24, 2.2, 'd', 320], [73, 56, 2.2, 'd', 321],
    [11, 45, 2.2, 'd', 322], [13, 70, 2.2, 'd', 323], [48, 65, 2.2, 'd', 324],
    [44, 9, 3.0, 'p', 325],                            // under the plaza's flower arch
    [30, 36, 2.6, 'd', 326], [35, 37, 2.4, 'c', 327],  // the market and the bakery apron
    [30, 45, 2.6, 'd', 328],
  ] as const) bulge(jx, jy, jr, jc, js);

  // ══ 5. paved places ══════════════════════════════════════════════════════
  // Festival Plaza: a green. The paving is a ring where the stalls stand, not
  // a parade ground — the middle of a plaza is the easiest place in a map to
  // end up with fifty identical tiles.
  g.blob(43, 15, 6.5, 4, 'c', 103, 0.26);
  g.blob(38, 13, 2.5, 2, 'c', 105, 0.4);
  g.blob(49, 18, 2.5, 2, 'c', 106, 0.4);

  // Bell-tower green: an apron at the foot of the tower, not a courtyard.
  g.blob(49, 31, 6, 3.5, 'c', 109, 0.26);

  // THE MARKET GREEN — the dead band.
  //
  // Everything between Courier Row's east end and the bakery's west wall was
  // eight tiles by thirteen of unbroken lawn with three oaks on it: measurably
  // the lowest structural energy anywhere in the town, sitting between the
  // blossom line and the rooftops where the eye rests longest. A blind A/B
  // review found it before anyone here did.
  //
  // It is now the working half of the town's public life: the bakery's
  // forecourt, a stall row, the well, and the point where four routes meet.
  // Its paving is coarser and dirtier than the square's — this is where carts
  // unload, not where the town poses for itself.
  g.blob(31.0, 35.2, 5.0, 3.4, 'c', 141, 0.26);
  g.blob(29.0, 32.0, 2.8, 2.2, 'c', 145, 0.42);   // the arm up the bakery's west flank
  g.blob(35.5, 37.4, 3.0, 1.9, 'c', 143, 0.34);   // the bakery apron
  g.blob(31.0, 35.2, 3.0, 1.7, 'p', 147, 0.22);   // the well court, in the coarser stone

  // TOWN SQUARE — deliberately small. Roughly 17x13 including its kerb, which
  // is under half of what it was: the space it gave up is now planting,
  // market frontage and front gardens.
  g.blob(44, 45, 8.2, 6.2, 'c', 113, 0.20);
  // The noticeboard pocket. It was a two-tile ledge of paving with the board
  // parked on it; it is now a recess deep enough to stand a group in.
  g.blob(37.2, 42.4, 4.0, 3.0, 'c', 127, 0.32);
  g.blob(50, 49.5, 3, 2.5, 'c', 131, 0.35);
  // The fountain court: a contrasting stone circle, so the centrepiece sits in
  // a frame instead of floating in a field of one tile.
  g.blob(44, 45.5, 4.2, 3.4, 'p', 139, 0.16);

  // A kerb course of coarser stone wherever paving meets grass. This is the
  // single change that stops the paved areas reading as rectangles.
  {
    const snap = g.rows();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (snap[y][x] !== 'c') continue;
        if (SOFT.includes(snap[y - 1][x]) || SOFT.includes(snap[y + 1][x])
          || SOFT.includes(snap[y][x - 1]) || SOFT.includes(snap[y][x + 1])) g.set(x, y, 'p');
      }
    }
  }
  // Repairs: single slabs of the other stone dropped into each paved area.
  // A blob autotiler only ever draws one interior tile, so an unbroken paved
  // field repeats that tile forever; this scatters edges through the middle of
  // it and the repeat disappears.
  {
    const snap = g.rows();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = snap[y][x];
        if (c !== 'c' && c !== 'p') continue;
        const solo = snap[y - 1][x] === c && snap[y + 1][x] === c
          && snap[y][x - 1] === c && snap[y][x + 1] === c;
        if (!solo) continue;
        const r = rnd(x * 97 + 11, y * 53 + 7);
        if (r < 0.19) g.set(x, y, c === 'c' ? 'p' : 'c');
      }
    }
  }

  // ══ 6. the bridge ════════════════════════════════════════════════════════
  // Span measured off the water it actually crosses, so the deck never runs
  // out across the grass as a slab.
  let BR_X0 = W, BR_X1 = 0;
  for (let y = 42; y <= 45; y++) {
    for (let x = 0; x < W; x++) if (g.get(x, y) === '~') { BR_X0 = Math.min(BR_X0, x); BR_X1 = Math.max(BR_X1, x); }
  }
  BR_X0 -= 2;
  BR_X1 += 2;
  for (let x = BR_X0; x <= BR_X1; x++) {
    g.set(x, 42, 'N');
    g.set(x, 43, '=');
    g.set(x, 44, '=');
    g.set(x, 45, 'S');
  }

  // ══ 7. the ford ══════════════════════════════════════════════════════════
  for (let y = 26; y <= 28; y++) {
    const [cx, half] = riverAt(y);
    for (let x = Math.floor(cx - half - 2); x <= Math.ceil(cx + half + 2); x++) {
      if (g.get(x, y) === '~' || g.get(x, y) === 's') g.set(x, y, 'g');
    }
  }

  // ══ 8. yards: irregular, worn, and fenced ════════════════════════════════
  const yard = (cx: number, cy: number, rx: number, ry: number, sd: number) =>
    g.blob(cx, cy, rx, ry, 'x', sd, 0.55);
  yard(11, 16, 4, 2.4, 201);   // the farm, below the barn
  yard(24.5, 32.5, 2.4, 1.8, 203); // courier parcel yard
  yard(36.5, 27, 3.2, 1.8, 205);   // store delivery yard
  yard(80, 44, 3.4, 2.4, 207);     // inn yard
  yard(16, 66, 3.4, 1.8, 209);     // market-garden working ground
  yard(47, 69, 2.6, 1.6, 211);     // gate lay-by

  // ══ 9. thresholds: a worn step at each door and a paved stub to a route ══
  for (const b of BUILDINGS) {
    if (!b.door) continue;
    const dx = doorX(b);
    const dy = doorY(b);
    // The step itself: a small irregular scuff, never a rectangle.
    for (let x = dx - 1; x <= dx + b.door[1]; x++) {
      for (let y = dy; y <= dy + 1; y++) {
        const edge = (x < dx || x > dx + b.door[1] - 1) ? 0.45 : 0.9;
        if (rnd(x * 7 + b.ty, y * 13) < edge && SOFT.includes(g.get(x, y))) g.set(x, y, 'd');
      }
    }
    for (let i = 0; i < b.door[1]; i++) g.set(dx + i, dy, 'd');
    // Walk outward until a route is met, paving as we go. Guarantees the eye
    // can trace every entrance back to a road.
    //
    // A dirt lane counts as a route. It did not before, which is why the two
    // buildings whose only neighbour was a lane — house_e and the bakery —
    // ended up standing in bare grass with nothing leading to them.
    const dirs: Array<[number, number]> = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let best: [number, number] | null = null;
    let bestD = 99;
    for (const [ox, oy] of dirs) {
      for (let k = 1; k <= 7; k++) {
        const c = g.get(dx + ox * k, dy + oy * k);
        if (c === 'p' || c === 'c' || c === 'd') { if (k < bestD) { bestD = k; best = [ox, oy]; } break; }
        if (!SOFT.includes(c)) break;
      }
    }
    if (best) {
      // The stub widens as it leaves the door: a threshold is a funnel, not a
      // corridor. One tile of overspill each side at the outer end.
      for (let k = 0; k <= bestD; k++) {
        const flare = k >= Math.max(1, bestD - 1) ? 1 : 0;
        for (let s = -flare; s < b.door[1] + flare; s++) {
          const px = dx + best[0] * k + (best[0] === 0 ? s : 0);
          const py = dy + best[1] * k + (best[1] === 0 ? 0 : s);
          const c = g.get(px, py);
          if (SOFT.includes(c) || c === 'd') g.set(px, py, 'p');
        }
      }
    }
  }

  // The bakery is the most eye-catching object in the frame and had neither a
  // path to it nor a readable way in. It gets a proper stepped entrance: a
  // band of the pale stone across the doorway, sitting in the market's cobble.
  {
    const b = bld('store');
    for (let x = doorX(b) - 2; x <= doorX(b) + 2; x++) {
      for (let y = doorY(b); y <= doorY(b) + 1; y++) {
        if (Math.abs(x - doorX(b)) + (y - doorY(b)) <= 3) g.set(x, y, 'p');
      }
    }
  }

  // ── fences: the farm, the market gardens, the inn paddock, the boundary ──
  // There is one fence rail tile and one post tile in the atlas, so a long run
  // is inherently a repeat. What can vary is the rhythm: posts every third or
  // fourth bay rather than metronomically every fourth, which is enough to
  // stop the eye locking onto the period.
  const fenceH = (x0: number, x1: number, y: number, gapAt?: number) => {
    for (let x = x0; x <= x1; x++) {
      if (gapAt !== undefined && (x === gapAt || x === gapAt + 1)) continue;
      if (!SOFT.includes(g.get(x, y)) && g.get(x, y) !== 'x') continue;
      const post = (x - x0) % 4 === 0 || rnd(x * 61 + y, 17) < 0.16;
      g.set(x, y, x === x0 ? '<' : x === x1 ? '>' : post ? 'o' : 'f');
    }
  };
  // Vertical runs are posts, not rails. The atlas has one rail tile and it is
  // drawn horizontal; stacking it down a column produced a ladder lying in the
  // field. A column of posts is both correct art and correct perspective — a
  // fence running away from the camera shows its posts, not its rails.
  const fenceV = (y0: number, y1: number, x: number, gapAt?: number) => {
    for (let y = y0; y <= y1; y++) {
      if (gapAt !== undefined && (y === gapAt || y === gapAt + 1)) continue;
      if (!SOFT.includes(g.get(x, y)) && g.get(x, y) !== 'x') continue;
      g.set(x, y, 'o');
    }
  };
  fenceH(6, 17, 18, 12);
  fenceH(6, 12, 7, 9);
  fenceV(8, 18, 6);
  fenceV(8, 18, 17);
  fenceH(6, 27, 71, 20);
  fenceH(46, 58, 71, 52);
  fenceH(24, 30, 56, 27);
  fenceH(77, 85, 49, 80);
  fenceV(43, 49, 85);
  fenceH(6, 15, 72, 11);
  fenceV(66, 72, 6);

  // ══ 10. verges: worn edges and loose stones beside everything walked on ══
  {
    const snap = g.rows();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!SOFT.includes(snap[y][x])) continue;
        const near = WALK.includes(snap[y - 1][x]) || WALK.includes(snap[y + 1][x])
          || WALK.includes(snap[y][x - 1]) || WALK.includes(snap[y][x + 1]);
        if (!near) continue;
        const r = rnd(x * 31 + 5, y * 17);
        if (r < 0.07) g.set(x, y, 'p');       // stones spilled off the road
        else if (r < 0.25) g.set(x, y, 'y');  // scorched, trodden grass
        else if (r < 0.62) g.set(x, y, ';');
      }
    }
  }

  // ══ 10b. the worn centre lane ════════════════════════════════════════════
  // A real road is not one tone across its width: boots and cartwheels rub a
  // paler track down the middle and leave the shoulders rough. Erode the route
  // mask once — anything still standing after erosion is by definition the
  // core of a road wide enough to have a middle — and lay the pale, dusty
  // surface through it. Narrow lanes erode to nothing and correctly get none.
  {
    const snap = g.rows();
    const walkAt = (x: number, y: number) => WALK.includes(snap[y]?.[x] ?? ' ');
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!onRoute[y][x]) continue;
        // Dirt lanes only. A dust track rubbed through a laid cobble square
        // reads as a patch of missing floor, which is what it looked like the
        // first time this ran across the fountain court.
        if (snap[y][x] !== 'd') continue;
        let core = true;
        for (let j = -1; j <= 1 && core; j++) for (let i = -1; i <= 1; i++) {
          if (!walkAt(x + i, y + j)) { core = false; break; }
        }
        if (!core) continue;
        // Broken, not continuous — a worn track fades in and out along its run.
        if (rnd(x * 5 + 91, y * 3 + 17) < 0.30) continue;
        g.set(x, y, 'W');
      }
    }
  }

  // ══ 10c. the ragged edge ═════════════════════════════════════════════════
  // The hard cut from paving straight to grass was the second-worst thing in
  // the frame. The outer ring of every walkable surface swaps to a variant of
  // the same blob that carries the verge scatter, so tufts and loose pebbles
  // grow up through the edge of the stone and the boundary dissolves instead
  // of stopping. Same autotile family, so the silhouette does not change.
  {
    const snap = g.rows();
    const EDGE: Record<string, string> = { p: 'E', d: 'Q', c: 'K', W: 'Q' };
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const to = EDGE[snap[y][x]];
        if (!to) continue;
        const soft = SOFT.includes(snap[y - 1][x]) || SOFT.includes(snap[y + 1][x])
          || SOFT.includes(snap[y][x - 1]) || SOFT.includes(snap[y][x + 1]);
        if (!soft) continue;
        if (rnd(x * 13 + 41, y * 29 + 7) < 0.28) continue;   // ragged, not an outline
        g.set(x, y, to);
      }
    }
  }

  // ══ 11. object layer: mass planting ══════════════════════════════════════
  const o = new GridPainter(W, H, ' ');

  // Woodland proper.
  //
  // Pines are the tallest and darkest thing in this palette, so their share
  // rises towards the border: the outermost rows are almost pure conifer and
  // the wood pales into broadleaf as it comes down to the town. That gradient
  // is what makes the edge of the map read as depth rather than as a crop.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) !== 'X') continue;
      // The brief is a darker, taller wall on the LEFT and TOP specifically —
      // those are the borders the frame was leaking at. Running the same
      // treatment all the way round buried the market gardens behind a hedge
      // of conifer, so the south and east keep their mixed broadleaf.
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const framing = Math.min(x, y);
      const conifer = framing <= 3 ? 0.74 : framing <= 6 ? 0.46 : (y < 26 || x > 74) ? 0.22 : 0.08;
      const r = rnd(x * 3 + 1, y * 5 + 2);
      if (r < 0.52 + (framing <= 4 ? 0.16 : edge <= 3 ? 0.06 : 0)) {
        o.set(x, y, rnd(x * 7 + 3, y * 11 + 5) < conifer ? 'P' : 'T');
      }
      else if (r < 0.66) o.set(x, y, 'b');
      else if (r < 0.72) o.set(x, y, 'r');
      else if (r < 0.76) o.set(x, y, 'u');
    }
  }
  // The fringe: thinning trees and undergrowth on walkable ground in front of
  // the wood, so the tree line is a gradient rather than a wall.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!SOFT.includes(g.get(x, y))) continue;
      let near = false;
      for (let j = -2; j <= 2 && !near; j++) for (let i = -2; i <= 2; i++) {
        if (g.get(x + i, y + j) === 'X') { near = true; break; }
      }
      if (!near) continue;
      const r = rnd(x * 11 + 3, y * 7 + 4);
      if (r < 0.13) o.set(x, y, 'T');
      else if (r < 0.27) o.set(x, y, 'b');
      else if (r < 0.33) o.set(x, y, 'y');
      else if (r < 0.38) o.set(x, y, 'r');
    }
  }
  // Undergrowth so open grass is never a flat green sheet.
  o.scatter('b', [' '], 0.055, 61);
  o.scatter('r', [' '], 0.022, 67);
  o.scatter('y', [' '], 0.026, 71);

  // Reeds, wet rocks and lilies down every bank.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) !== 's') continue;
      const r = rnd(x * 13 + 7, y * 3 + 9);
      if (r < 0.34) o.set(x, y, 'e');
      else if (r < 0.44) o.set(x, y, 'm');
      else if (r < 0.51) o.set(x, y, 'j');
    }
  }

  // Groves: each district gets its own species so they do not blur together.
  const grove = (cx: number, cy: number, rx: number, ry: number, ch: string, d: number, sd: number) => {
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        if (rnd(x * 5 + sd, y * 9 + sd) < d) o.set(x, y, ch);
      }
    }
  };
  grove(18, 22, 5, 4, 'B', 0.32, 301);
  grove(80, 30, 4, 4, 'B', 0.30, 303);
  grove(59, 19, 4, 4, 'T', 0.30, 305);
  grove(27, 63, 4, 3, 'B', 0.28, 307);
  grove(57, 61, 4, 3, 'T', 0.28, 309);
  grove(29, 45, 3, 4, 'T', 0.26, 311);
  grove(35, 22, 3, 3, 'T', 0.28, 313);
  grove(52, 68, 4, 3, 'T', 0.26, 315);
  grove(8, 25, 3, 4, 'T', 0.26, 317);
  grove(63, 37, 3, 4, 'T', 0.24, 319);
  // The Market Green's backdrop: blossom behind the stalls, and a stand of oak
  // filling the strip that used to sit blank between the bakery and Vale Road.
  grove(29.5, 27.5, 4, 2.5, 'B', 0.30, 331);
  grove(41, 29.5, 2.5, 3.5, 'T', 0.28, 333);
  grove(38.5, 41, 2.5, 2, 'B', 0.24, 335);

  // Kitchen gardens: hedged plots with rows in them.
  const plot = (x0: number, y0: number, w: number, h: number) => {
    for (let x = x0; x < x0 + w; x++) o.set(x, y0 - 1, x === x0 ? '[' : x === x0 + w - 1 ? ']' : 'h');
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) if ((y - y0) % 2 === 0 && (x - x0) % 2 === 0) o.set(x, y, 'v');
    }
  };
  plot(7, 67, 8, 4);
  plot(23, 68, 6, 4);
  plot(6, 11, 6, 3);
  plot(30, 51, 4, 3);
  plot(78, 36, 4, 3);

  // Hedges. Every run is placed to cross a ground boundary, not to trace one.
  const hedge = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x++) o.set(x, y, x === x0 ? '[' : x === x1 ? ']' : 'h');
  };
  const hedgeV = (y0: number, y1: number, x: number) => {
    for (let y = y0; y <= y1; y++) o.set(x, y, 'h');
  };
  hedge(51, 56, 39);
  hedge(28, 32, 30);      // the Market Green's back wall, open at its east end
  hedgeV(27, 31, 41);     // screening the bakery's yard from Vale Road
  hedge(33, 37, 52);
  hedge(48, 54, 53);
  hedgeV(27, 31, 46);
  hedgeV(27, 31, 54);
  hedge(47, 53, 24);
  hedge(12, 18, 61);
  hedgeV(54, 59, 20);
  hedge(78, 83, 47);
  hedge(29, 35, 57);
  hedge(50, 56, 57);
  hedge(23, 27, 41);
  hedge(9, 14, 48);
  hedge(56, 61, 50);

  // ══ 12. clear objects off routes and footprints ══════════════════════════
  for (const b of BUILDINGS) {
    for (let y = b.ty - 1; y < b.ty + b.h + 1; y++) {
      for (let x = b.tx - 1; x < b.tx + b.w + 1; x++) o.set(x, y, ' ');
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // NB: 's' (riverbank) is deliberately absent — the banks keep their
      // reeds, wet rocks and river stones. That planting is what stops the
      // water reading as a flat blue rectangle with a tan border.
      const c = g.get(x, y);
      if ('pdcxWEQK~=NSgfo<>'.includes(c)) o.set(x, y, ' ');
    }
  }

  // ── encroachment ────────────────────────────────────────────────────────
  // Having cleared the routes, put a little back — but only on the outer ring,
  // and only things with no collision. A bush or a sapling leaning over the
  // kerb is what makes a path look walked rather than laid, and it is the one
  // trick the reference uses everywhere that we were not using at all.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!'EQK'.includes(g.get(x, y))) continue;
      // Keep doorways, the fountain court and the market's working floor clear.
      let blocked = false;
      for (const b of BUILDINGS) {
        if (!b.door) continue;
        if (Math.abs(x - doorX(b)) <= 2 && Math.abs(y - doorY(b)) <= 2) { blocked = true; break; }
      }
      if (blocked) continue;
      const r = rnd(x * 23 + 5, y * 41 + 3);
      if (r < 0.13) o.set(x, y, 'b');
      else if (r < 0.19) o.set(x, y, 'y');
    }
  }

  // ══ 13. buildings ════════════════════════════════════════════════════════
  for (const b of BUILDINGS) {
    P(b.key, b.tx + b.w / 2 - 0.5, b.ty + b.h - 1 + b.gap / 16, {}, b.id);
    zones.push({ kind: 'block', id: `blk_${b.id}`, x: b.tx, y: b.ty, w: b.w, h: b.h });
    if (b.door) {
      zones.push({ kind: 'region', id: b.id, x: doorX(b), y: doorY(b), w: b.door[1], h: 1 });
    }
  }

  // Chimney smoke, so roofs are never static.
  for (const [id, dx, dy] of [
    ['inn', 1.7, -6.2], ['house_a', 0.4, -4.6], ['house_c', 1.6, -4.8],
    ['workshop', 1.9, -5.6], ['house_e', -1.4, -3.6], ['house_b', 0.9, -6.4],
    ['courier', 2.4, -4.4],
  ] as const) {
    const b = bld(id);
    P('prop/build/chimney_smoke_0', b.tx + b.w / 2 - 0.5 + dx, b.ty + b.h - 1 + b.gap / 16 + dy,
      { anim: 'chimney_smoke', depthBias: 40000 });
  }

  // Trade signs and awnings: what the building is, readable from the road.
  const sign = (id: string, dx: number, dy: number, key: string, look?: string) => {
    const b = bld(id);
    P(key, b.tx + b.w / 2 - 0.5 + dx, b.ty + b.h - 1 + b.gap / 16 + dy,
      { depthBias: 30000, interact: look });
  };
  sign('store', 2.6, -1.4, 'prop/build/sign_bakery', 'sign.bakery');
  sign('courier', 2.7, -0.6, 'prop/build/sign_courier', 'sign.courier');
  sign('workshop', 2.6, -1.2, 'prop/build/sign_herbalist', 'sign.workshop');
  sign('inn', -3.4, -1.6, 'prop/build/sign_inn', 'sign.inn');
  sign('house_c', -3.2, -1.2, 'prop/build/sign_fishmonger');

  // Warm windows: the light layer is the thing this engine has that the
  // reference does not, so every inhabited building glows.
  for (const [id, dx, dy, r, i] of [
    ['inn', 0, -3.5, 82, 0.30], ['courier', 0, -2, 62, 0.24],
    ['workshop', 0.4, -3, 66, 0.26], ['store', 0, -2.4, 62, 0.22],
    ['house_a', 0, -2, 52, 0.20], ['house_b', 0, -3, 52, 0.20],
    ['house_c', 0, -2, 56, 0.20], ['house_d', 0, -2.4, 52, 0.20],
    ['house_e', 0, -1.8, 52, 0.20], ['belltower', 0, -6, 74, 0.26],
  ] as const) {
    const b = bld(id);
    lights.push({ x: b.tx + b.w / 2 - 0.5 + dx, y: b.ty + b.h - 1 + dy, radius: r, color: 0xffc45e, intensity: i, flicker: 0.15 });
  }

  // ══ 14. town trees ═══════════════════════════════════════════════════════
  // Placed by hand, specifically to overlap roof corners, path shoulders and
  // the kerb of the square. Nothing here sits alone in the middle of grass.
  const TOWN_TREES: Array<[number, number, string]> = [
    // around the square
    [34.5, 40.5, 'o'], [35, 51.5, 'o'], [53.5, 40, 'o'], [53, 52, 'o'],
    [38.5, 37.5, 'B'], [48.5, 38.5, 'o'], [50.5, 52.5, 'B'], [36.5, 47.5, 'o'],
    // bell green + store
    [45.5, 26.5, 'o'], [56, 27.5, 'o'], [56.5, 34, 'B'], [32.5, 30.5, 'o'],
    [41, 30.5, 'o'], [30, 26.5, 'o'],
    // Market Green: trees standing in the paving, not politely beside it, and
    // a blossom on the bakery's corner so the frame has a light value up high.
    [33.5, 36.4, 'B'], [26.5, 30.5, 'o'], [36.5, 40.5, 'o'], [25.5, 40.5, 'B'],
    [39.5, 36.5, 'o'], [40.5, 27.5, 'o'], [30.5, 40.4, 'o'],
    // Courier Row
    [8.5, 32.5, 'o'], [19.5, 30.5, 'o'], [28.5, 38.5, 'o'], [11.5, 47.5, 'o'],
    [23.5, 43, 'B'], [7.5, 36.5, 'o'],
    // Sera's + gardens
    [10, 54.5, 'o'], [21.5, 55, 'o'], [25.5, 65.5, 'B'], [15, 51.5, 'o'],
    // south road + houses
    [37, 59.5, 'o'], [47.5, 67.5, 'o'], [28.5, 60.5, 'o'], [56.5, 63, 'B'],
    [37.5, 71.5, 'o'], [48.5, 73, 'o'], [44.5, 57.5, 'o'],
    // plaza
    [31.5, 12.5, 'o'], [56.5, 10.5, 'o'], [33.5, 20.5, 'B'], [54.5, 21.5, 'o'],
    [38.5, 8.5, 'o'], [50, 7.5, 'o'],
    // farm
    [15.5, 7.5, 'o'], [5.5, 16.5, 'o'], [16.5, 12.5, 'B'],
    // river banks + inn
    [57.5, 39.5, 'o'], [56.5, 57.5, 'o'], [72.5, 35.5, 'o'], [85, 38.5, 'o'],
    [81.5, 51.5, 'o'], [75, 51, 'B'], [70.5, 32.5, 'o'], [69, 62.5, 'o'],
    [62.5, 24.5, 'o'], [77.5, 27, 'B'],
  ];
  for (const [x, y, kind] of TOWN_TREES) {
    // The variant is chosen inside P() from the family's full range; naming
    // the _0 frame here would previously have put seventeen copies of
    // tree_oak_2 on the map, which is exactly the count the critic made.
    P(kind === 'B' ? 'prop/town/tree_blossom_0' : 'prop/town/tree_oak_0', x, y, { solid: [20, 10] });
    // Clear the mass-planted object grid where a feature tree now stands.
    for (let j = -1; j <= 0; j++) for (let i = -1; i <= 1; i++) o.set(Math.round(x) + i, Math.round(y) + j, ' ');
  }

  // ══ 15. set dressing, district by district ══════════════════════════════

  // ── Town Square: fountain court ─────────────────────────────────────────
  P('prop/town/fountain', 44, 46, { solid: [44, 44], anim: 'fountain_idle', interact: 'prop.fountain' }, 'fountain');
  lights.push({ x: 44, y: 45, radius: 78, color: 0xbfe4ff, intensity: 0.20, flicker: 0.1 });
  // Benches set radially around it, so the court reads as a place to sit.
  P('prop/town/bench_0', 44, 42.6, { solid: [30, 10] });
  P('prop/town/bench_0', 44, 49.4, { solid: [30, 10] });
  P('prop/town/bench_1', 40.4, 46.4, { solid: [30, 10] });
  P('prop/town/bench_1', 47.8, 46.4, { solid: [30, 10] });
  for (const [x, y] of [[41.4, 43.4], [46.6, 43.4], [41.4, 48.8], [46.6, 48.8]] as const) {
    P('prop/town/stone_lantern', x, y, { solid: [10, 8] });
    lights.push({ x, y: y - 1, radius: 30, color: 0xffd08a, intensity: 0.26, flicker: 0.7 });
  }
  // The noticeboard pocket. It was a two-tile ledge with the board parked on
  // it and nothing else — the second-quietest spot in the frame. It is now a
  // recess you can stand a group in: the board, a bench facing it, a lantern
  // to read by after dark, and somebody's basket left on the step.
  P('prop/town/notice_board', 38.4, 43.6, { solid: [30, 12], interact: 'notice_board' }, 'notice_board');
  P('prop/town/bench_1', 37.6, 41.4, { solid: [30, 10], interact: 'prop.bench' });
  P('prop/town/stone_lantern', 35.4, 42.6, { solid: [10, 8] });
  lights.push({ x: 35.4, y: 41.8, radius: 34, color: 0xffd08a, intensity: 0.30, flicker: 0.7 });
  lights.push({ x: 38.4, y: 42.8, radius: 30, color: 0xffc45e, intensity: 0.22, flicker: 0.1 });
  P('prop/town/basket_0', 39.4, 42.4, {});
  P('prop/town/barrel_1', 35.6, 44.4, { solid: [20, 8] });
  P('prop/town/planter_1', 36.4, 40.4, { solid: [18, 8] });
  P('prop/town/bird_perched_0', 38.4, 41.8, { anim: 'bird_perched_idle', depthBias: 30000 });
  P('prop/town/signpost_0', 45.4, 39.4, { solid: [12, 8], interact: 'sign.plaza' });
  P('prop/town/signpost_1', 41.6, 52.4, { solid: [12, 8], interact: 'sign.woods' });
  P('prop/town/signpost_2', 55.4, 43.4, { solid: [12, 8], interact: 'sign.bridge' });
  for (const [x, y] of [[38, 40], [50, 40], [38, 51], [50, 51]] as const) lamp(x, y);
  // Planters only where they have a wall or a kerb to sit against.
  P('prop/town/planter_0', 39.4, 46, { solid: [14, 8] });
  P('prop/town/planter_1', 48.6, 51.6, { solid: [18, 8] });
  P('prop/town/planter_0', 42.6, 40.4, { solid: [14, 8] });
  P('prop/town/flowerbed_0', 35.5, 44, { solid: [28, 8] });
  P('prop/town/flowerbed_2', 52.5, 47.5, { solid: [28, 8] });
  // A market on the square's east shoulder — implied activity, no NPC needed.
  P('prop/build/stall_frame', 52.5, 42.5, { solid: [60, 14], interact: 'prop.festStall' });
  P('prop/build/awning_wide_teal', 52.5, 39.94, { depthBias: 12000 });
  P('prop/town/crate_1', 51, 43.6, {});
  P('prop/town/basket_1', 54, 43.6, {});
  P('prop/town/basket_2', 50.2, 44.4, {});
  P('prop/town/sack_0', 54.6, 44.5, {});
  P('prop/town/cart', 47.5, 52.4, { solid: [42, 14], interact: 'prop.cart' });
  P('prop/town/crate_0', 46.1, 53, {});
  P('prop/town/barrel_0', 49.4, 52.8, {});
  P('prop/town/birdbath', 43, 41.4, { solid: [16, 8], interact: 'prop.birdbath' });
  P('prop/town/bird_perched_0', 43, 40.6, { anim: 'bird_perched_idle', depthBias: 6 });
  for (const [x, y] of [[42.4, 44.4], [46.2, 48.2], [36.6, 45.6]] as const) {
    P('prop/town/butterfly_0', x, y, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -10] });
  }

  // ── General store frontage ──────────────────────────────────────────────
  //
  // The bakery is the loudest object on the map and a blind review could not
  // find its way in: no path led to it, and the wide teal awning that used to
  // hang here was pinned straight across the shopfront, covering the doorway
  // the building sprite already draws. The awning has gone to the market
  // stalls where it belongs; the door now has a stepped apron, a lantern on
  // each side and the produce cleared out of the middle of it.
  {
    const b = bld('store');
    const dx = doorX(b);
    const dy = doorY(b);
    P('prop/town/vegetable_row_0', b.tx + 0.5, dy, { solid: [28, 8] });
    P('prop/town/vegetable_row_2', b.tx + 5.8, dy, { solid: [28, 8] });
    P('prop/town/crate_1', b.tx + 6.2, dy - 0.4, {});
    P('prop/town/basket_1', b.tx + 0.6, dy - 0.5, { interact: 'store_apples' });
    P('prop/town/milk_churn', b.tx + 6.6, dy - 0.8, {});
    // The entrance, flanked. Two stone lanterns on the step and a bakery-warm
    // pool spilling out of the open door — the brightest doorway in the town,
    // because it is the one the player is meant to find first.
    P('prop/town/stone_lantern', dx - 1.4, dy + 0.4, { solid: [10, 8] });
    P('prop/town/stone_lantern', dx + 1.4, dy + 0.4, { solid: [10, 8] });
    lights.push({ x: dx - 1.4, y: dy - 0.4, radius: 30, color: 0xffd08a, intensity: 0.26, flicker: 0.6 });
    lights.push({ x: dx + 1.4, y: dy - 0.4, radius: 30, color: 0xffd08a, intensity: 0.26, flicker: 0.6 });
    lights.push({ x: dx, y: dy - 0.6, radius: 56, color: 0xffb26b, intensity: 0.34, flicker: 0.1 });
    P('prop/town/planter_1', dx - 2.6, dy + 0.6, { solid: [18, 8] });
    P('prop/town/planter_0', dx + 2.6, dy + 0.6, { solid: [14, 8] });
    lamp(b.tx - 1.4, dy - 1, 44, 0.40);
    // Delivery yard behind.
    P('prop/town/cart', 37.5, 27.4, { solid: [42, 14] });
    P('prop/town/crate_0', 34.6, 27.2, {});
    P('prop/town/crate_2', 35.4, 27.9, {});
    P('prop/town/sack_1', 39.4, 27.6, {});
    P('prop/town/woodpile_0', 33.5, 28.4, { solid: [28, 10], interact: 'woodpile' });
    P('prop/town/chicken_0', 35.2, 26.4, { anim: 'chicken_peck' });
    P('prop/town/chicken_2', 36.8, 26.1, { anim: 'chicken_peck', interact: 'prop.chicken' });
    laundry(36, 25.4, { interact: 'laundry' });
    // The oven yard, in the two-tile strip between the shop and Vale Road. It
    // was the last stretch of blank lawn in this frame, and a bakery is
    // exactly the building that would fill it with split wood.
    P('prop/town/woodpile_1', 40.6, 33.4, { solid: [20, 10], interact: 'woodpile' });
    P('prop/town/log_1', 40.6, 35.4, { solid: [22, 8] });
    P('prop/town/tree_stump', 41.4, 36.6, { solid: [16, 8], interact: 'prop.stump' });
    P('prop/town/barrel_0', 40.4, 37.4, { solid: [14, 8] });
    P('prop/town/hay_bale', 41.4, 31.4, { solid: [22, 10] });
    P('prop/town/crate_0', 40.4, 30.4, {});
    P('prop/town/cat_sleeping_0', 41.5, 34.4, { anim: 'cat_sleeping_idle', interact: 'cat' });
    lamp(41.4, 38.4, 42, 0.38);
  }

  // ── THE MARKET GREEN ────────────────────────────────────────────────────
  //
  // The town's working square: the bakery's forecourt on one side, the stall
  // row on the other, the well in the middle, and four routes meeting in it.
  // Everything here is deliberately a little rougher than the fountain square
  // — this is where carts unload and where the frame gets the focal point it
  // was missing between the blossom line and the rooftops.
  {
    // The well, the landmark. It moves up from the market gardens, which keep
    // their water in the wellhouse and gain a pump instead: one town, one well,
    // and it belongs where people are.
    P('prop/town/well', 31.6, 35.2, { solid: [26, 12], interact: 'prop.well' }, 'well');
    lights.push({ x: 31.6, y: 34.4, radius: 40, color: 0xbfe4ff, intensity: 0.16, flicker: 0.08 });
    P('prop/town/water_trough', 33.6, 34.4, { solid: [28, 8], interact: 'prop.trough' });
    // The stall row down the green's west side, one behind the other, which is
    // how a market actually forms — along the side the carts come in on.
    P('prop/build/stall_frame', 27.8, 33.4, { solid: [60, 14], interact: 'prop.festStall' });
    P('prop/build/awning_wide_teal', 27.8, 30.84, { depthBias: 12000 });
    P('prop/town/crate_1', 26.4, 34.4, {});
    P('prop/town/basket_2', 29.4, 34.3, {});
    P('prop/build/stall_frame', 27.8, 38.6, { solid: [60, 14] });
    P('prop/build/awning_wide_blue', 27.8, 36.04, { depthBias: 12000 });
    P('prop/town/basket_0', 26.4, 39.5, { interact: 'garden_basket' });
    P('prop/town/sack_0', 29.4, 39.4, {});
    P('prop/town/vegetable_row_1', 31.5, 32.4, { solid: [28, 8] });
    // Seating, planting and the things people leave behind them.
    P('prop/town/bench_0', 31.4, 38.4, { solid: [30, 10], interact: 'prop.bench' });
    P('prop/town/bench_1', 34.6, 37.6, { solid: [30, 10] });
    P('prop/town/flowerbed_1', 30.5, 31.4, { solid: [28, 8] });
    P('prop/town/flowerbed_0', 35.5, 34.2, { solid: [28, 8] });
    P('prop/town/planter_0', 33.4, 38.6, { solid: [14, 8] });
    P('prop/town/cart', 34.4, 31.6, { solid: [42, 14], interact: 'prop.cart' });
    P('prop/town/barrel_0', 29.6, 36.4, { solid: [14, 8] });
    P('prop/town/barrel_1', 30.6, 37.0, { solid: [20, 8] });
    P('prop/town/stool', 32.6, 37.4, {});
    P('prop/town/hay_bale', 25.6, 36.4, { solid: [22, 10], interact: 'prop.hayBale' });
    P('prop/town/chicken_1', 29.8, 34.8, { anim: 'chicken_peck' });
    P('prop/town/chicken_3', 33.1, 36.4, { anim: 'chicken_peck' });
    P('prop/town/cat_sleeping_1', 35.4, 38.4, { anim: 'cat_sleeping_idle', interact: 'cat' });
    P('prop/town/butterfly_2', 32.5, 39.4, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
    P('prop/town/bird_perched_1', 31.6, 34.0, { anim: 'bird_perched_idle', depthBias: 6 });
    P('prop/town/signpost_1', 36.4, 39.6, { solid: [12, 8], interact: 'sign.plaza' });
    for (const [x, y] of [[25.4, 33.4], [36.4, 36.2], [30.4, 39.6], [34.6, 30.4]] as const) lamp(x, y, 44, 0.42);
    P('prop/town/stone_lantern', 33.4, 32.6, { solid: [10, 8], interact: 'prop.stoneLantern' });
    lights.push({ x: 33.4, y: 31.8, radius: 32, color: 0xffd08a, intensity: 0.26, flicker: 0.7 });
    // A lamp hung under each awning. Warm pools under the canvas are what make
    // a stall look open rather than shut, and they give the market its own
    // pocket of light distinct from the square's cool fountain.
    lights.push({ x: 27.8, y: 32.6, radius: 44, color: 0xffc45e, intensity: 0.30, flicker: 0.2 });
    lights.push({ x: 27.8, y: 37.8, radius: 44, color: 0xffc45e, intensity: 0.30, flicker: 0.2 });
  }

  // ── Bell tower green ────────────────────────────────────────────────────
  P('prop/town/shrine_small', 46.4, 30, { solid: [16, 8], interact: 'prop.roadShrine' });
  P('prop/town/bench_0', 47, 33.6, { solid: [30, 10] });
  P('prop/town/bench_1', 54.4, 32.4, { solid: [30, 10] });
  for (const [x, y] of [[47, 27], [55, 28], [47, 35.4], [55, 35]] as const) lamp(x, y, 44, 0.40);
  P('prop/town/stone_lantern', 51, 36.4, { solid: [10, 8], interact: 'prop.stoneLantern' });
  P('prop/town/stone_lantern', 49, 36.4, { solid: [10, 8] });
  lights.push({ x: 50, y: 36, radius: 34, color: 0xffd08a, intensity: 0.24, flicker: 0.6 });
  P('prop/town/flowerbed_1', 46.5, 36.4, { solid: [28, 8] });
  P('prop/town/flowerbed_2', 54.5, 30, { solid: [28, 8] });
  P('prop/town/bird_perched_1', 51, 25.6, { anim: 'bird_perched_idle', depthBias: 30000 });

  // ── Festival Plaza, ordinary state ──────────────────────────────────────
  P('prop/fest/flower_arch', 43.5, 8.6, { interact: 'plaza_arch', depthBias: -8 });
  for (const [x, y] of [[36, 12], [51, 12], [36, 19], [51, 19]] as const) {
    P('prop/fest/string_lights_pole', x, y, { solid: [8, 8] });
  }
  P('prop/fest/string_lights_span_0', 39, 11.2, { over: true });
  P('prop/fest/string_lights_span_1', 42, 11.2, { over: true });
  P('prop/fest/string_lights_span_2', 45, 11.2, { over: true });
  P('prop/fest/bunting_0', 38, 19.6, { over: true, sway: 0.5 });
  P('prop/fest/bunting_1', 41, 19.6, { over: true, sway: 0.5 });
  P('prop/fest/bunting_2', 47, 19.6, { over: true, sway: 0.5 });
  P('prop/build/stall_frame', 34, 15.5, { solid: [60, 14], interact: 'prop.festStall' });
  P('prop/build/stall_frame', 53, 15.5, { solid: [60, 14] });
  P('prop/build/awning_wide_blue', 53, 12.94, { depthBias: 12000 });
  P('prop/fest/crate_stack_fest', 47, 17.6, { solid: [28, 10], interact: 'prop.festJudging' });
  P('prop/fest/crate_stack_fest', 40.6, 17.4, { solid: [28, 10] });
  P('prop/fest/barrel_fest', 48.4, 18.2, { solid: [18, 8] });
  P('prop/fest/drink_barrel', 39.4, 18.2, { solid: [22, 8] });
  P('prop/town/hay_bale', 51.5, 21.4, { solid: [22, 10], interact: 'prop.hayBale' });
  P('prop/town/hay_bale', 53, 22.2, { solid: [22, 10] });
  P('prop/town/picnic_table', 37.5, 21.5, { solid: [36, 12] });
  P('prop/town/picnic_table', 49.5, 12.5, { solid: [36, 12] });
  // The plaza's lanterns actually cast now. Three ground lanterns and the run
  // of strung lights across the middle: dim, close-spaced, cool-warm — the
  // festival is a week away and the town is already testing the wiring.
  P('prop/fest/ground_lantern_0', 40, 13.4, {});
  P('prop/fest/ground_lantern_1', 47, 13.4, {});
  P('prop/fest/ground_lantern_2', 43.5, 19.6, { interact: 'prop.festLights' });
  for (const [x, y, r, i] of [[40, 13, 30, 0.28], [47, 13, 30, 0.28], [43.5, 19.2, 32, 0.30]] as const) {
    lights.push({ x, y, radius: r, color: 0xffd08a, intensity: i, flicker: 0.8 });
  }
  for (const x of [39.5, 41.5, 43.5, 45.5]) {
    lights.push({ x, y: 11, radius: 26, color: 0xffcf7a, intensity: 0.20, flicker: 0.9 });
  }
  lights.push({ x: 43.5, y: 8.2, radius: 34, color: 0xffe0a0, intensity: 0.26, flicker: 0.4 });
  P('prop/town/notice_board', 46.6, 22, { solid: [30, 12], interact: 'courier_roster' }, 'plaza_board');
  for (const [x, y] of [[38, 8.6], [49, 8.6], [34, 22], [53, 22]] as const) lamp(x, y, 44, 0.38);
  P('prop/town/flowerbed_0', 33, 11, { solid: [28, 8] });
  P('prop/town/flowerbed_2', 54.5, 20, { solid: [28, 8] });
  // The middle of the plaza is where the festival will stand: right now it is
  // the delivery yard for all of it, which is what keeps the paving occupied.
  P('prop/town/cart', 42, 12.4, { solid: [42, 14] });
  P('prop/town/crate_1', 40.4, 12.9, {});
  P('prop/town/crate_0', 44.2, 12.6, {});
  P('prop/town/sack_0', 39.6, 13.4, {});
  P('prop/town/sack_1', 45.4, 13.2, {});
  P('prop/fest/judging_table', 45.6, 16.4, { solid: [42, 10], interact: 'prop.festStall' });
  P('prop/fest/bread_basket', 45.2, 16.1, {});
  P('prop/town/barrel_0', 41.4, 16.4, { solid: [14, 8] });
  P('prop/town/barrel_1', 40.4, 16.9, { solid: [20, 8] });
  P('prop/town/woodpile_1', 36.4, 17.4, { solid: [20, 10], interact: 'woodpile' });
  P('prop/town/stool', 44, 18.4, {});
  P('prop/town/basket_0', 42.4, 18.6, {});
  P('prop/town/basket_2', 48.6, 12.6, {});
  P('prop/fest/toy_windmill', 50.4, 20.4, { sway: 0.4 });
  P('prop/town/bird_perched_0', 43, 11.4, { anim: 'bird_perched_idle' });
  for (const [x, y] of [[41, 16.5], [46.5, 14], [35, 19]] as const) {
    P('prop/town/butterfly_1', x, y, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
  }

  // ── the north farm ──────────────────────────────────────────────────────
  {
    const b = bld('barn');
    P('prop/town/water_trough', b.tx + 6.5, b.ty + 4, { solid: [28, 8], interact: 'prop.trough' });
    P('prop/town/hay_bale', b.tx - 0.6, b.ty + 4.6, { solid: [22, 10] });
    P('prop/town/hay_bale', b.tx + 0.6, b.ty + 5.4, { solid: [22, 10] });
    P('prop/town/wheelbarrow', 13.4, 16.4, { solid: [22, 10], interact: 'prop.wheelbarrow' });
    P('prop/town/milk_churn', 9, 16.2, { interact: 'prop.churn' });
    P('prop/town/milk_churn', 9.8, 16.7, {});
    P('prop/town/woodpile_1', 7, 15.4, { solid: [20, 10] });
    P('prop/town/scarecrow', 9, 10.5, { solid: [10, 8], interact: 'prop.scarecrow' });
    for (const [x, y] of [[11.4, 16.9], [12.6, 15.6], [10.2, 17.4], [14, 15]] as const) {
      P('prop/town/chicken_0', x, y, { anim: 'chicken_peck' });
    }
    P('prop/town/beehive', 16.6, 20.6, { solid: [14, 8], interact: 'prop.beehive' });
    P('prop/town/beehive', 17.6, 21.4, { solid: [14, 8] });
    P('prop/town/log_0', 6.5, 22.5, { solid: [26, 8] });
    P('prop/town/tree_stump', 8, 24, { solid: [16, 8], interact: 'prop.stump' });
    laundry(15, 18.4);
    lamp(13, 19.6, 38, 0.32);
  }

  // ── Courier Row ─────────────────────────────────────────────────────────
  {
    const b = bld('courier');
    P('prop/build/awning_small_gold', b.tx + 1.4, b.ty + b.h - 1.6, { depthBias: 12000 });
    for (const [x, y, k] of [
      [11.4, 35.6, 'prop/town/parcel_0'], [12.2, 36.2, 'prop/town/parcel_2'],
      [15.6, 35.5, 'prop/town/parcel_1'], [16.4, 36.1, 'prop/town/parcel_3'],
      [24.4, 32.4, 'prop/town/parcel_0'], [25.2, 33.0, 'prop/town/parcel_1'],
      [23.6, 33.2, 'prop/town/parcel_3'],
    ] as const) P(k, x, y, { interact: x < 20 ? 'prop.courierParcels' : undefined });
    P('prop/town/cart', 22.5, 36.6, { solid: [42, 14], interact: 'prop.cart' });
    P('prop/town/crate_1', 21.1, 37.2, {});
    P('prop/town/sack_0', 24.4, 36.8, {});
    P('prop/town/notice_board', 18.6, 36.4, { solid: [30, 12], interact: 'prop.courierPinboard' }, 'courier_board');
    laundry(20, 27.2, { interact: 'laundry' });
    laundry(20, 31.2);
    laundry(9, 27.4);
    const sh = bld('shed_courier');
    P('prop/town/bird_perched_0', sh.tx + 0.6, sh.ty + 0.2, { anim: 'bird_perched_idle', depthBias: 20000, interact: 'pigeons' });
    P('prop/town/bird_perched_1', sh.tx + 2.2, sh.ty + 0.4, { anim: 'bird_perched_idle', depthBias: 20000 });
    P('prop/town/bird_perched_0', sh.tx + 1.4, sh.ty + 3.6, { anim: 'bird_perched_idle' });
    P('prop/town/basket_0', sh.tx + 3.4, sh.ty + 3.2, {});
    for (const [x, y] of [[16.6, 33.4], [16.6, 42.6], [9, 36.6], [26, 28]] as const) lamp(x, y, 40, 0.38);
    P('prop/town/window_box', 6.5, 43.2, { depthBias: 12000, interact: 'prop.windowBox' });
    P('prop/town/window_box', 24, 33.2, { depthBias: 12000 });
    P('prop/town/planter_0', 14.6, 35, { solid: [14, 8] });
    P('prop/town/pump', 19.4, 44.4, { solid: [14, 8], interact: 'prop.pump' });
    P('prop/town/barrel_1', 20.6, 45, {});
    P('prop/town/cat_sleeping_0', 12.6, 37.6, { anim: 'cat_sleeping_idle', interact: 'cat' }, 'cat');
    P('prop/town/woodpile_0', 5.5, 46.4, { solid: [28, 10], interact: 'woodpile' });
    P('prop/town/basket_2', 8.4, 45.4, {});
    P('prop/town/crate_0', 21.6, 33.6, {});
    P('prop/town/barrel_0', 26.4, 29.4, {});
  }

  // ── the west approach: the ground between the square and Sera's lane ────
  // Left as open lawn this was the emptiest screen on the map.
  P('prop/town/log_0', 27.4, 47.4, { solid: [26, 8] });
  P('prop/town/tree_stump', 26.4, 48.6, { solid: [16, 8] });
  P('prop/town/woodpile_0', 25.4, 45.4, { solid: [28, 10], interact: 'woodpile' });
  P('prop/town/bench_1', 31.4, 49.4, { solid: [30, 10] });
  P('prop/town/wheelbarrow', 29.6, 53.4, { solid: [22, 10] });
  P('prop/town/beehive', 24.6, 53.4, { solid: [14, 8] });
  P('prop/town/hay_bale', 27.6, 55.4, { solid: [22, 10] });
  P('prop/town/rock_3', 32.6, 44.4, { solid: [22, 8] });
  P('prop/town/butterfly_2', 29, 51.5, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
  lamp(28, 50.6, 40, 0.36);

  // ── Sera's Workshop ─────────────────────────────────────────────────────
  {
    const b = bld('workshop');
    P('prop/town/planter_0', b.tx - 0.6, b.ty + b.h - 0.4, { solid: [14, 8] });
    P('prop/town/crate_1', b.tx + 7.5, b.ty + 2.4, { solid: [16, 8] });
    P('prop/town/barrel_0', b.tx + 7.6, b.ty + 3.6, { solid: [14, 8] });
    P('prop/town/barrel_1', b.tx - 0.5, b.ty + 3.4, { solid: [20, 8] });
    P('prop/town/table_round', 20.6, 62.6, { solid: [22, 10], interact: 'sera_bench' });
    P('prop/town/stool', 19.3, 63, {});
    P('prop/town/chair_0', 21.9, 62.8, {});
    P('prop/town/birdbath', 10.6, 62.4, { solid: [16, 8] });
    P('prop/town/beehive', 10, 57.5, { solid: [14, 8] });
    P('prop/town/vegetable_row_1', 13.5, 63, { solid: [28, 8] });
    P('prop/town/vegetable_row_0', 16.5, 63, { solid: [28, 8] });
    P('prop/town/flowerbed_0', 23.5, 55.4, { solid: [28, 8] });
    P('prop/town/stone_lantern', 19, 59.6, { solid: [10, 8] });
    P('prop/town/stone_lantern', 11, 59.6, { solid: [10, 8] });
    lights.push({ x: 19, y: 59, radius: 28, color: 0xffd08a, intensity: 0.24, flicker: 0.7 });
    for (const [x, y] of [[19.4, 51.4], [11, 65.4], [23, 60]] as const) lamp(x, y, 40, 0.36);
    P('prop/town/butterfly_2', 14, 64, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
    P('prop/town/butterfly_3', 17.5, 61.4, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -14] });
    laundry(11, 51.4);
  }

  // ── market gardens and the south-west ───────────────────────────────────
  P('prop/town/scarecrow', 12, 71.4, { solid: [10, 8] });
  P('prop/town/wheelbarrow', 16.5, 66.6, { solid: [22, 10] });
  P('prop/town/sack_1', 15, 66.8, {});
  P('prop/town/sack_0', 17.6, 65.8, {});
  P('prop/town/basket_1', 14.4, 67.2, { interact: 'garden_basket' });
  // The well used to stand out here with nothing around it; it is the market
  // green's landmark now. The gardens keep the wellhouse and get the pump,
  // which is what a working plot would have had in the first place.
  P('prop/town/pump', 25.6, 71.4, { solid: [14, 8], interact: 'prop.pump' });
  P('prop/town/water_trough', 26.8, 71.8, { solid: [28, 8], interact: 'prop.trough' });
  P('prop/town/barrel_1', 24.4, 71.6, { solid: [20, 8] });
  P('prop/town/water_trough', 21.4, 66.6, { solid: [28, 8] });
  P('prop/town/hay_bale', 28.6, 66.4, { solid: [22, 10] });
  // The working ground between the gardens and Sera's lane read as one bare
  // brown field; it is a market garden, so it gets the clutter of one.
  P('prop/town/hay_bale', 13.6, 65.4, { solid: [22, 10] });
  P('prop/town/crate_0', 18.4, 68.4, {});
  P('prop/town/barrel_0', 19.4, 69.0, { solid: [14, 8] });
  P('prop/town/woodpile_0', 12.6, 69.4, { solid: [28, 10], interact: 'woodpile' });
  P('prop/town/log_0', 15.5, 72.4, { solid: [26, 8] });
  P('prop/town/bench_1', 19.6, 71.4, { solid: [30, 10], interact: 'prop.bench' });
  for (const [x, y] of [[15.4, 69.4], [16.6, 70.2], [17.4, 64.4]] as const) {
    P('prop/town/chicken_0', x, y, { anim: 'chicken_peck' });
  }
  P('prop/town/butterfly_0', 20.5, 68.5, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
  lamp(19.4, 65.4, 40, 0.36);
  P('prop/town/log_1', 6.5, 60, { solid: [22, 8] });
  P('prop/town/duck_0', 8.5, 58.6, { anim: 'duck_waddle', interact: 'prop.duck' });
  for (const [x, y] of [[9.5, 61.6], [10.6, 60.8]] as const) P('prop/town/chicken_1', x, y, { anim: 'chicken_peck' });
  lamp(24, 70, 40, 0.36);

  // ── south houses and the road to the gate ───────────────────────────────
  {
    const c = bld('house_c');
    P('prop/town/flowerbed_1', c.tx + 0.5, doorY(c), { solid: [28, 8] });
    P('prop/town/window_box', c.tx + 1, c.ty + c.h - 2.4, { depthBias: 12000 });
    P('prop/town/bench_0', c.tx + 5.4, doorY(c) - 0.2, { solid: [30, 10] });
    P('prop/town/woodpile_1', c.tx - 0.5, c.ty + 4.6, { solid: [20, 10] });
    const d = bld('house_d');
    P('prop/town/flowerbed_0', d.tx + 3.5, doorY(d), { solid: [28, 8] });
    P('prop/town/planter_0', d.tx - 0.4, doorY(d) - 0.4, { solid: [14, 8] });
    P('prop/town/barrel_0', d.tx + 5.4, d.ty + 4.4, { solid: [14, 8] });
    P('prop/town/cat_sleeping_1', d.tx + 4.4, doorY(d) - 0.3, { anim: 'cat_sleeping_idle', interact: 'cat' });
    P('prop/town/picnic_table', 46.5, 62.5, { solid: [36, 12] });
    P('prop/town/table_round', 38, 61.5, { solid: [22, 10] });
    P('prop/town/stool', 36.9, 61.9, {});
    for (const [x, y] of [[38, 56.6], [48, 56.6], [38.6, 68], [45.4, 68]] as const) lamp(x, y, 42, 0.38);
    P('prop/town/signpost_2', 44.4, 66.4, { solid: [12, 8], interact: 'sign.southGate' });
    P('prop/town/flowerbed_2', 44.5, 59.4, { solid: [28, 8] });
  }

  // ── South Gate ──────────────────────────────────────────────────────────
  {
    const b = bld('south_gate');
    P('prop/town/crate_0', b.tx - 1.4, b.ty - 0.4, {});
    P('prop/town/crate_2', b.tx - 0.6, b.ty + 0.2, {});
    P('prop/town/barrel_0', b.tx + 6.5, b.ty - 0.3, {});
    P('prop/town/signpost_0', b.tx + 6.4, b.ty - 1.4, { solid: [12, 8], interact: 'sign.townEdge' });
    P('prop/town/hay_bale', 47.5, 69.6, { solid: [22, 10] });
    P('prop/town/log_0', 36.5, 69.6, { solid: [26, 8] });
    lights.push({ x: 40, y: 72, radius: 40, color: 0xffb937, intensity: 0.40, flicker: 0.6 });
    lights.push({ x: 44, y: 72, radius: 40, color: 0xffb937, intensity: 0.40, flicker: 0.6 });
  }

  // ── the river: bridge, jetties, ford, wildlife ──────────────────────────
  // Posts every few tiles: without them a long deck is one flat plank field.
  for (let x = BR_X0; x <= BR_X1; x += 4) {
    P('prop/town/bridge_post', x, 42, { depthBias: 200, interact: x === BR_X0 ? 'prop.bridgeBoards' : undefined });
    P('prop/town/bridge_post', x, 45.6, { depthBias: 8000 });
  }
  P('prop/town/bridge_post', BR_X1, 42, { depthBias: 200 });
  P('prop/town/bridge_post', BR_X1, 45.6, { depthBias: 8000 });
  // Life in the water the whole length of the river, not only in the pool.
  for (let y = 6; y < H - 6; y += 3) {
    const [cx, half] = riverAt(y);
    const r = rnd(y * 17, 3);
    if (y >= 40 && y <= 47) continue;                       // keep the bridge clear
    if (r < 0.34) P('prop/town/lilypad_0', Math.round(cx + (r - 0.17) * half), y, { depthBias: -60 });
    else if (r < 0.58) P('prop/town/river_rock_1', Math.round(cx - half + 0.5), y, { depthBias: -20 });
    else if (r < 0.74) P('prop/town/river_rock_0', Math.round(cx + half - 0.5), y, { depthBias: -20 });
    else if (r < 0.86) P('prop/town/duck_0', cx + (r - 0.8) * 6, y, { anim: 'duck_waddle', depthBias: -40 });
  }
  P('prop/town/jetty', 59.5, 55, { solid: [28, 8], interact: 'prop.jetty' }, 'jetty');
  P('prop/town/jetty', 71.5, 58, { solid: [28, 8] });
  for (const [x, y] of [[62, 52], [66, 55], [63.5, 57], [67, 51]] as const) {
    P('prop/town/lilypad_0', x, y, { depthBias: -60 });
  }
  P('prop/town/lilypad_1', 64.5, 53.5, { depthBias: -60 });
  P('prop/town/lilypad_1', 61.5, 58.5, { depthBias: -60 });
  for (const [x, y] of [[63, 54.4], [65.5, 56.6], [62.5, 50.5]] as const) {
    P('prop/town/duck_0', x, y, { anim: 'duck_waddle', depthBias: -40 });
  }
  P('prop/town/reeds_0', 58.5, 51, { sway: 0.6 });
  P('prop/town/reeds_1', 58.6, 59, { sway: 0.6 });
  P('prop/town/reeds_2', 70.6, 52.5, { sway: 0.6 });
  P('prop/town/bench_0', 58.4, 48.6, { solid: [30, 10], interact: 'prop.bench' });
  P('prop/town/stone_lantern', 57, 47.4, { solid: [10, 8] });
  lights.push({ x: 57, y: 46.6, radius: 30, color: 0xffd08a, intensity: 0.26, flicker: 0.7 });
  lamp(56.6, 41.6, 44, 0.42);
  lamp(73.4, 41.6, 44, 0.42);
  P('prop/town/mossy_rock_1', 60, 61.5, { solid: [20, 8] });
  P('prop/town/river_rock_1', 66, 27.5, { depthBias: -20 });
  P('prop/town/river_rock_0', 69, 26.6, { depthBias: -20 });
  P('prop/town/river_rock_2', 71, 28.4, { depthBias: -20 });
  P('prop/town/signpost_1', 62.6, 25.4, { solid: [12, 8], interact: 'sign.bridge' });

  // ── the Lantern Inn and its garden ──────────────────────────────────────
  {
    const b = bld('inn');
    lamp(b.tx - 1, doorY(b) - 1, 52, 0.48);
    lamp(b.tx + b.w, doorY(b) - 1, 52, 0.48);
    P('prop/town/flowerbed_0', b.tx + 0.5, doorY(b), { solid: [28, 8] });
    P('prop/town/flowerbed_1', b.tx + 6.5, doorY(b), { solid: [28, 8] });
    P('prop/town/picnic_table', 79, 44.6, { solid: [36, 12], interact: 'prop.picnicTable' });
    P('prop/fest/mug', 78.6, 44.2, {});
    P('prop/town/picnic_table', 82.4, 47.4, { solid: [36, 12] });
    P('prop/town/bench_1', 76, 46.6, { solid: [30, 10] });
    P('prop/town/cart', 76.5, 43.4, { solid: [42, 14] });
    P('prop/town/barrel_0', 84.4, 43.4, { solid: [14, 8] });
    P('prop/town/barrel_1', 83.4, 44.2, { solid: [20, 8] });
    P('prop/town/crate_1', 85.4, 44.4, {});
    P('prop/town/woodpile_0', 85.5, 48.4, { solid: [28, 10], interact: 'woodpile' });
    laundry(80, 42.2, { interact: 'laundry' });
    P('prop/town/cat_sleeping_0', 77.6, 43.8, { anim: 'cat_sleeping_idle', interact: 'cat' }, 'inn_cat');
    for (const [x, y] of [[81.6, 45.8], [82.8, 46.6], [80.4, 47]] as const) {
      P('prop/town/chicken_0', x, y, { anim: 'chicken_peck' });
    }
    P('prop/town/water_trough', 75, 47.6, { solid: [28, 8] });
    P('prop/town/birdbath', 79.4, 50.4, { solid: [16, 8] });
    P('prop/town/bird_perched_0', 79.4, 49.6, { anim: 'bird_perched_idle', depthBias: 6 });
    P('prop/town/beehive', 83.6, 31.4, { solid: [14, 8] });
    P('prop/town/basket_1', 77.4, 31.6, {});
    P('prop/town/basket_0', 81.6, 32.4, {});
    for (const [x, y] of [[78, 30.5], [81, 33], [76.5, 45.4]] as const) {
      P('prop/town/butterfly_0', x, y, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
    }
    P('prop/town/stone_lantern', 75.4, 41.6, { solid: [10, 8] });
    lights.push({ x: 75.4, y: 40.8, radius: 30, color: 0xffd08a, intensity: 0.26, flicker: 0.6 });
  }

  // ── east-bank woodland: the woodcutter's clearing and the overlook ──────
  P('prop/town/log_0', 76.5, 62, { solid: [26, 8] });
  P('prop/town/log_1', 78, 63.6, { solid: [22, 8] });
  P('prop/town/tree_stump', 75, 63.4, { solid: [16, 8] });
  P('prop/town/woodpile_1', 74.5, 61, { solid: [20, 10], interact: 'woodpile' });
  P('prop/town/bench_0', 79.6, 22.6, { solid: [30, 10], interact: 'overlook' });
  P('prop/town/shrine_small', 78, 20.6, { solid: [16, 8], interact: 'prop.roadShrine' });
  P('prop/town/stone_lantern', 76.6, 21.6, { solid: [10, 8] });
  lights.push({ x: 76.6, y: 20.8, radius: 34, color: 0xffd08a, intensity: 0.34, flicker: 0.8 });
  P('prop/town/mossy_rock_0', 81, 25.5, { solid: [16, 8] });
  // Enough dressing that the clearing reads as somewhere people come to sit.
  P('prop/town/stone_lantern', 80.6, 20.4, { solid: [10, 8] });
  lights.push({ x: 80.6, y: 19.6, radius: 32, color: 0xffd08a, intensity: 0.30, flicker: 0.8 });
  P('prop/town/log_1', 77.5, 24.4, { solid: [22, 8] });
  P('prop/town/tree_stump', 80.5, 24.2, { solid: [16, 8], interact: 'prop.stump' });
  P('prop/town/flowerbed_2', 78.5, 19.4, { solid: [28, 8] });
  P('prop/town/basket_1', 79.2, 23.2, {});
  P('prop/town/bird_perched_0', 79.6, 21.8, { anim: 'bird_perched_idle', depthBias: 6 });
  P('prop/town/butterfly_1', 77.5, 22.5, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
  lamp(75.6, 24.4, 42, 0.40);

  // ══ 16. townsfolk ════════════════════════════════════════════════════════
  const npcs: NpcPlacement[] = [
    { id: 'mira', x: 79, y: 42, facing: 's', path: [[79, 42], [79, 45], [82, 46], [79, 45]], dwell: 3.2 },
    { id: 'sera', x: 15, y: 60, facing: 's', path: [[15, 60], [20, 61], [21, 63], [16, 61]], dwell: 4 },
    { id: 'oren', x: 13, y: 36, facing: 's', path: [[13, 36], [20, 35], [28, 36], [22, 35], [17, 43], [17, 37]], dwell: 1.6 },
    { id: 'elia', x: 44, y: 17, facing: 's', path: [[44, 17], [37, 17], [37, 13], [48, 13], [50, 18], [44, 20]], dwell: 2.2 },
    { id: 'tavi', x: 45, y: 22, facing: 's', path: [[45, 22], [44, 27], [45, 32], [44, 27]], dwell: 3.4 },
    { id: 'nia', x: 58, y: 51, facing: 'e', path: [[58, 51], [58, 54], [59, 57], [58, 53]], dwell: 5 },
    // The baker: shop door, across the market, down to the square and back.
    { id: 'villager_a', x: 36, y: 37, facing: 's', path: [[36, 37], [31, 37], [30, 34], [33, 37], [38, 40], [44, 48], [39, 41], [36, 37]], dwell: 2.4 },
    // The fisher, on the east bank of the pool.
    { id: 'villager_b', x: 71, y: 57, facing: 'w', dwell: 6 },
    { id: 'villager_c', x: 17, y: 40, facing: 'n', path: [[17, 40], [17, 35], [26, 36], [31, 38], [26, 36], [17, 35], [17, 43], [24, 45]], dwell: 2 },
    { id: 'villager_d', x: 42, y: 61, facing: 'n', path: [[42, 61], [42, 65], [34, 64], [42, 65], [42, 57]], dwell: 2.8 },
    // The gate keeper.
    { id: 'villager_e', x: 45, y: 70, facing: 'w', dwell: 8 },
    { id: 'villager_f', x: 54, y: 44, facing: 'e', path: [[54, 44], [64, 44], [73, 44], [76, 42], [64, 44]], dwell: 2.4 },
  ];

  // ══ 17. zones ════════════════════════════════════════════════════════════
  const doorZone = (id: string, to: string, spawn: string): Zone => {
    const b = bld(id);
    return { kind: 'door', id: `to_${to}`, x: doorX(b), y: doorY(b), w: b.door![1], h: 1, to, spawn, facing: 'n' };
  };
  zones.push(doorZone('inn', 'inn', 'default'));
  zones.push(doorZone('workshop', 'workshop', 'default'));
  zones.push(doorZone('courier', 'courier', 'door'));
  zones.push({
    kind: 'door', id: 'to_festival', x: 42, y: 7, w: 4, h: 2,
    to: 'festival', spawn: 'default', facing: 'n', requires: 'festival_started',
  });
  zones.push({
    kind: 'door', id: 'to_woods', x: 41, y: 70, w: 2, h: 1,
    to: 'woods', spawn: 'default', facing: 's', requires: 'south_gate_open',
  });
  zones.push({ kind: 'trigger', id: 'gate_shut', x: 40, y: 69, w: 4, h: 1, forbids: 'south_gate_open', repeat: true });
  zones.push({ kind: 'trigger', id: 'plaza_gate', x: 40, y: 9, w: 8, h: 1, forbids: 'festival_started', repeat: true });
  zones.push({ kind: 'camera', id: 'bounds', x: 0, y: 0, w: W, h: H });

  return {
    id: 'lumen_vale',
    name: 'Lumen Vale',
    subtitle: 'a valley that remembers',
    music: 'town',
    ambience: 'town_day',
    // Late-afternoon shade. Pushed up from 0.17: the light layer is the one
    // thing this engine has that the reference plate does not, and it was
    // being wasted on a frame that had almost no dark end to read against.
    // Every lamp, window and doorway gains contrast from this single number,
    // and at 0.21 nothing gameplay-relevant is any harder to see.
    darkness: 0.21,
    ground: g.rows(),
    legend: {
      '.': { base: 'town/grass' },
      ',': { base: 'town/grass', scatter: 'sparse' },
      '"': { base: 'town/grass', scatter: 'lush' },
      '*': { base: 'town/grass', scatter: 'meadow' },
      ';': { base: 'town/grass', scatter: 'verge' },
      // Dry grass and worn earth are blob OVERLAYS, not base families. A base
      // family swap paints hard tile-aligned rectangles, which a blind A/B
      // review read as a rendering bug across the whole frame; the blob sets
      // give the same variation an organic, wobbled boundary.
      'y': { base: 'town/grass', blob: 'grass_dry', scatter: 'verge' },
      'X': { base: 'town/grass', scatter: 'lush', solid: true },
      'p': { base: 'town/grass', blob: 'path' },
      'c': { base: 'town/grass', blob: 'cobble' },
      // Dirt carries a scatter as well as its blob: bare lanes are the largest
      // single-tone areas in the map and need grit and weeds on top of them.
      'd': { base: 'town/grass', blob: 'dirt', scatter: 'rut' },
      // The worn centre lane: same road, paler and dustier down the middle
      // where the traffic actually runs.
      'W': { base: 'town/grass', blob: 'sand', scatter: 'grit' },
      // Ragged edges. Identical blob family to the surface they trim, so the
      // autotile silhouette is unchanged — only the scatter on top differs,
      // which is what lets grass and pebbles grow up through the boundary
      // instead of the paving stopping dead against the lawn.
      'E': { base: 'town/grass', blob: 'path', scatter: 'encroach' },
      'Q': { base: 'town/grass', blob: 'dirt', scatter: 'encroach' },
      'K': { base: 'town/grass', blob: 'cobble', scatter: 'encroach' },
      'x': { base: 'town/grass', blob: 'turf_worn', scatter: 'grit' },
      's': { base: 'town/grass', blob: 'sand' },
      'g': { base: 'town/grass', blob: 'sand' },
      '~': { base: 'town/grass', blob: 'water', solid: true },
      '=': { base: 'bridge/h' },
      'N': { base: 'bridge/h', scatter: 'rail_n', solid: true },
      'S': { base: 'bridge/h', scatter: 'rail_s', solid: true },
      'f': { base: 'town/grass', scatter: 'fence_h', solid: true },
      'o': { base: 'town/grass', scatter: 'fence_post', solid: true },
      '<': { base: 'town/grass', scatter: 'fence_end_l', solid: true },
      '>': { base: 'town/grass', scatter: 'fence_end_r', solid: true },
    },
    scatterRules: {
      sparse: {
        density: 0.5,
        tiles: [['scatter/tuft_sm', 6], ['scatter/tuft_md', 3], ['scatter/pebbles', 1], ['', 5]],
      },
      lush: {
        density: 0.92,
        tiles: [['scatter/tuft_md', 5], ['scatter/tuft_lg', 4], ['scatter/tuft_sm', 3], ['scatter/flower_white', 1]],
      },
      meadow: {
        density: 0.95,
        tiles: [
          ['scatter/flower_gold', 4], ['scatter/flower_white', 3], ['scatter/flower_rose', 3],
          ['scatter/flower_violet', 2], ['scatter/tuft_md', 4], ['scatter/tuft_lg', 2],
        ],
      },
      verge: {
        density: 0.6,
        tiles: [['scatter/tuft_sm', 5], ['scatter/pebbles', 4], ['scatter/tuft_md', 2], ['', 5]],
      },
      grit: { density: 0.3, tiles: [['scatter/pebbles', 4], ['scatter/tuft_sm', 1], ['', 3]] },
      // Denser than 'verge' on purpose: this rule only ever lands on the outer
      // ring of a path, and it is doing the whole job of softening the join.
      encroach: {
        density: 0.72,
        tiles: [
          ['scatter/tuft_sm', 6], ['scatter/tuft_md', 4], ['scatter/pebbles', 5],
          ['scatter/tuft_lg', 1], ['scatter/flower_white', 1], ['', 4],
        ],
      },
      rut: { density: 0.42, tiles: [['scatter/pebbles', 5], ['scatter/tuft_sm', 3], ['scatter/tuft_md', 1], ['', 6]] },
      rail_n: { density: 1, tiles: [['bridge/rail_n', 1]] },
      rail_s: { density: 1, tiles: [['bridge/rail_s', 1]] },
      fence_h: { density: 1, tiles: [['fence/h', 1]] },
      fence_post: { density: 1, tiles: [['fence/post', 1]] },
      fence_end_l: { density: 1, tiles: [['fence/end_l', 1]] },
      fence_end_r: { density: 1, tiles: [['fence/end_r', 1]] },
    },
    objects: o.rows(),
    objectLegend: {
      'T': { key: ['prop/town/tree_oak_0', 'prop/town/tree_oak_1', 'prop/town/tree_oak_2', 'prop/town/tree_oak_3'], solid: [18, 10] },
      'P': { key: ['prop/town/tree_pine_0', 'prop/town/tree_pine_1', 'prop/town/tree_pine_2'], solid: [16, 10] },
      'B': { key: ['prop/town/tree_blossom_0', 'prop/town/tree_blossom_1'], solid: [18, 10] },
      'b': { key: ['prop/town/bush_0', 'prop/town/bush_1', 'prop/town/bush_2', 'prop/town/bush_3'], sway: 0.4 },
      'y': { key: ['prop/town/sapling_0', 'prop/town/sapling_1'], sway: 0.5 },
      'h': { key: 'prop/town/hedge_mid', solid: [16, 10] },
      '[': { key: 'prop/town/hedge_end_l', solid: [16, 10] },
      ']': { key: 'prop/town/hedge_end_r', solid: [16, 10] },
      // Raised beds: they do stand up, so they keep a shadow — but a tight one.
      // 'auto' would size a 32px-wide ellipse off the sprite width and put a
      // soft blob under a box that is ten pixels tall.
      'v': { key: ['prop/town/vegetable_row_0', 'prop/town/vegetable_row_1', 'prop/town/vegetable_row_2'], solid: [28, 8], shadow: 'small' },
      'r': { key: ['prop/town/rock_0', 'prop/town/rock_1', 'prop/town/rock_2', 'prop/town/rock_3'], solid: [16, 8] },
      'm': { key: ['prop/town/mossy_rock_0', 'prop/town/mossy_rock_1'], solid: [16, 8] },
      'u': { key: ['prop/town/tree_stump', 'prop/town/log_0', 'prop/town/log_1'], solid: [18, 8] },
      'e': { key: ['prop/town/reeds_0', 'prop/town/reeds_1', 'prop/town/reeds_2'], sway: 0.7 },
      // Rocks standing in the shallows. A contact shadow on open water reads as
      // a hole in the river, so they are the one legend entry that opts out.
      'j': { key: ['prop/town/river_rock_0', 'prop/town/river_rock_1', 'prop/town/river_rock_2'], shadow: 'none' },
    },
    props,
    npcs,
    zones,
    lights,
    spawns: {
      default: { x: 44, y: 50, facing: 'n' },
      arrival: { x: 41, y: 68, facing: 'n' },
      south: { x: 41, y: 69, facing: 'n' },
      north: { x: 44, y: 10, facing: 's' },
      inn_door: { x: doorX(bld('inn')), y: doorY(bld('inn')) + 1, facing: 'n' },
      workshop_door: { x: doorX(bld('workshop')), y: doorY(bld('workshop')) + 1, facing: 'n' },
      courier_door: { x: doorX(bld('courier')), y: doorY(bld('courier')) + 1, facing: 'n' },
      store_door: { x: doorX(bld('store')), y: doorY(bld('store')) + 1, facing: 'n' },
      bridge: { x: 64, y: 44, facing: 'e' },
      square: { x: 44, y: 50, facing: 'n' },
    },
  };
}

registerMap('lumen_vale', build);
