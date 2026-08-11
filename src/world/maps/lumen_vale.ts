/**
 * LUMEN VALE — the town.
 *
 * Composition notes (plan.md §3, §4, §5.1-5.5; references.md "Environmental
 * Density Rule"):
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
 * Three rules this file tries to obey everywhere:
 *
 *  1. NO BARE SLABS. Buildings are not stood on rectangles of soil. Their
 *     collision comes from `kind: 'block'` zones; the ground under and around
 *     them stays whatever the district is made of, and the only bare earth is
 *     a *shaped* swept approach at the door.
 *  2. EVERY SCREEN EARNS ITS KEEP. The map is walked in 30x17 windows; each
 *     one has to contain gameplay (a path, a door, an NPC), structure (a
 *     building, water, a tree line, a fence) and texture (props, flowers,
 *     lights, animals).
 *  3. PATHS LEAD SOMEWHERE VISIBLE. Every lane terminates at a door, a
 *     crossing, a gate or a landmark — never in grass.
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { LightDef, MapDef, NpcPlacement, PropPlacement, Zone } from '../types';

const W = 88;
const H = 78;

// ── the river ────────────────────────────────────────────────────────────────
// Control points: [row, centre column, half-width]. The river enters top-right,
// sweeps west past the town, bulges into a slow pool beside the inn, then bends
// back south-east and leaves the map. Town sits in the inside of the curve.
const RIVER: Array<[number, number, number]> = [
  [-6, 79, 3],
  [12, 73, 3],
  [24, 70, 3.2],
  [36, 67, 3.2],
  [46, 65, 3.4],
  [54, 65, 5],
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
// `tx,ty,w,h` is the tile footprint the building physically occupies; it is the
// collision rect and the sprite is placed so its drawn base sits exactly on the
// footprint's bottom edge. `gap` is the transparent shadow margin under each
// sprite (sprite height minus the artwork's ground line).
interface Bld {
  id: string;
  key: string;
  tx: number; ty: number; w: number; h: number;
  gap: number;
  /** Door column offset from tx; omitted for buildings you cannot enter. */
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
  { id: 'shed_courier', key: 'prop/build/shed', tx: 26, ty: 30, w: 3, h: 3, gap: 4 },
  { id: 'shed_inn', key: 'prop/build/shed', tx: 84, ty: 45, w: 3, h: 3, gap: 4 },
  { id: 'outhouse', key: 'prop/build/outhouse', tx: 18, ty: 68, w: 2, h: 3, gap: 4 },
  { id: 'south_gate', key: 'prop/build/south_gate_closed', tx: 39, ty: 71, w: 6, h: 6, gap: 6 },
];

const bld = (id: string): Bld => BUILDINGS.find((b) => b.id === id)!;
/** Tile column of a building's door. */
const doorX = (b: Bld): number => b.tx + b.door![0];
/** Tile row the player stands on to use a building's door. */
const doorY = (b: Bld): number => b.ty + b.h;

function build(): MapDef {
  const g = new GridPainter(W, H, '.');
  const props: PropPlacement[] = [];
  const zones: Zone[] = [];
  const lights: LightDef[] = [];

  const P = (key: string, x: number, y: number, spec?: PropPlacement['spec'], id?: string) => {
    props.push({ key, x, y, spec, id });
  };
  /** Deterministic 0..1 noise so "random" dressing is stable across reloads. */
  const rnd = (a: number, b = 0) => {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  // ══ 1. ground: grass texture ══════════════════════════════════════════════
  g.scatter(',', ['.'], 0.42, 11);
  g.scatter('"', ['.', ','], 0.13, 29);

  // Wildflower meadows: the map's colour accents, deliberately clustered rather
  // than sprinkled evenly (references.md: "repetitive procedural decoration").
  for (const [cx, cy, rx, ry, sd] of [
    [18, 20, 7, 5, 3], [60, 16, 6, 5, 7], [24, 50, 5, 4, 13],
    [26, 72, 8, 4, 17], [58, 66, 6, 4, 19], [60, 30, 4, 4, 23],
    [78, 30, 5, 4, 29], [16, 74, 6, 3, 31],
  ] as const) g.blob(cx, cy, rx, ry, '*', sd, 0.45);

  // ══ 2. the tree line: what stops the world ending in flat grass ═══════════
  // 'X' is walkable-looking grass that is solid: dense wood the player reads as
  // scenery, not as a route. Painted as blobs so no border is a straight line.
  const wood = (cx: number, cy: number, rx: number, ry: number, sd: number) =>
    g.blob(cx, cy, rx, ry, 'X', sd, 0.34);
  g.rect(0, 0, W, 2, 'X');
  g.rect(0, 0, 2, H, 'X');
  g.rect(W - 2, 0, 2, H, 'X');
  g.rect(0, H - 2, W, 2, 'X');
  for (const [cx, cy, rx, ry, sd] of [
    [10, 2, 12, 4, 2], [34, 1, 14, 4, 3], [58, 2, 12, 4, 5], [80, 3, 10, 5, 7],
    [3, 14, 4, 12, 11], [2, 34, 4, 10, 13], [3, 54, 4, 9, 17], [4, 70, 6, 6, 19],
    [82, 12, 7, 14, 23], [84, 34, 5, 10, 29], [83, 58, 6, 10, 31],
    [20, 76, 10, 4, 37], [46, 76, 12, 4, 41], [70, 75, 12, 5, 43],
    [79, 20, 6, 10, 47], [78, 66, 8, 8, 53], [12, 62, 4, 4, 59],
    [64, 72, 8, 5, 61], [30, 20, 3, 3, 67], [8, 30, 3, 4, 71],
  ] as const) wood(cx, cy, rx, ry, sd);
  // Re-open the pockets the blobs just swallowed that need to stay walkable.
  g.blob(18, 20, 8, 6, ',', 73, 0.3);
  g.blob(12, 62, 6, 5, ',', 79, 0.3);

  // ══ 3. the river ═════════════════════════════════════════════════════════
  for (let y = 0; y < H; y++) {
    const [cx, half] = riverAt(y);
    for (let x = 0; x < W; x++) {
      const d = Math.abs(x + 0.5 - cx);
      if (d <= half) g.set(x, y, '~');
      else if (d <= half + 1.6) g.set(x, y, 's');
      else if (d <= half + 2.6 && rnd(x, y * 3) < 0.55) g.set(x, y, 's');
    }
  }

  // ══ 4. districts ═════════════════════════════════════════════════════════

  // Festival Plaza — a big green with a paved centre. Ordinary state: the
  // village hall's ring of flagstone, worn grass, and preparations half done.
  g.blob(43, 15, 17, 10, ',', 101, 0.18);
  g.blob(43, 15, 12, 7, 'c', 103, 0.16);
  g.blob(43, 15, 7, 4, 'p', 107, 0.2);

  // Bell-tower green: cobble apron, the tower on its north side.
  g.blob(48, 31, 11, 6, 'c', 109, 0.2);

  // Town Square: an irregular flagstone field, not a parade ground. Cobble
  // outside, a ring of warm path stone around the fountain, and dirt
  // desire-lines worn between the doors people actually use.
  g.blob(44, 45, 12, 9.5, 'c', 113, 0.16);
  g.blob(37, 41, 5, 4, 'c', 127, 0.3);
  g.blob(52, 50, 5, 4, 'c', 131, 0.3);
  g.blob(50, 39, 4, 3, 'c', 137, 0.3);
  g.blob(44, 45, 5.5, 4.5, 'p', 139, 0.22);

  // ── roads ────────────────────────────────────────────────────────────────
  // Vale Road: the north-south spine. Plaza → bell green → square → gate.
  g.vLine(20, 37, 44, 'p', 4);
  g.vLine(55, 71, 41, 'p', 4);
  // Bridge Street: Courier Row → square → bridge → the inn.
  g.hLine(16, 72, 44, 'p', 3);
  // Plaza approach off the top of Vale Road.
  g.vLine(8, 22, 44, 'p', 3);

  // ── lanes (narrower, dirt, district-flavoured) ───────────────────────────
  // Courier Row: two tight lanes and a service yard.
  g.hLine(8, 28, 35, 'd', 2);
  g.vLine(35, 44, 17, 'd', 2);
  g.vLine(22, 34, 20, 'd', 2);
  g.hLine(6, 17, 45, 'd', 2);
  // North lane: Courier Row → the farm → the plaza's west gate.
  g.vLine(14, 33, 13, 'd', 2);
  g.hLine(13, 28, 14, 'd', 2);
  // Sera's lane: square → workshop → the market gardens.
  g.hLine(20, 34, 51, 'd', 2);
  g.vLine(51, 61, 21, 'd', 2);
  g.hLine(15, 21, 60, 'd', 2);
  g.vLine(60, 70, 21, 'd', 2);
  g.hLine(11, 21, 69, 'd', 2);
  // South-east house lane and the well.
  g.hLine(44, 53, 65, 'd', 2);
  g.vLine(57, 65, 52, 'd', 2);
  g.hLine(33, 41, 65, 'd', 2);
  g.vLine(63, 65, 33, 'd', 2);
  // Plaza east walk out to the ford.
  g.hLine(56, 64, 27, 'd', 2);
  g.vLine(19, 27, 57, 'd', 2);
  // East bank track: ford → inn → the pool and the jetty.
  g.vLine(27, 60, 74, 'd', 2);
  g.hLine(74, 79, 41, 'd', 2);
  g.hLine(68, 74, 56, 'd', 2);
  g.vLine(20, 27, 78, 'd', 2);

  // ── the bridge ───────────────────────────────────────────────────────────
  const BR_X0 = 57, BR_X1 = 72;
  for (let x = BR_X0; x <= BR_X1; x++) {
    g.set(x, 42, 'N');
    g.set(x, 43, '=');
    g.set(x, 44, '=');
    g.set(x, 45, '=');
    g.set(x, 46, 'S');
  }

  // ── the ford: a gravel bar the player can wade across ────────────────────
  for (let y = 26; y <= 28; y++) {
    const [cx, half] = riverAt(y);
    for (let x = Math.floor(cx - half - 2); x <= Math.ceil(cx + half + 2); x++) {
      if (g.get(x, y) === '~' || g.get(x, y) === 's') g.set(x, y, 'g');
    }
  }

  // ── yards: bare, trodden earth where work happens (shaped, never square) ──
  const yard = (cx: number, cy: number, rx: number, ry: number, sd: number) =>
    g.blob(cx, cy, rx, ry, 'x', sd, 0.4);
  yard(11, 15, 5, 3, 201);            // the farm yard, below the barn
  yard(27, 33, 3, 2, 203);            // courier parcel yard
  yard(36, 27, 4, 2, 205);            // store delivery yard
  yard(80, 43, 4, 3, 207);            // inn yard
  yard(16, 66, 4, 2, 209);            // market-garden working ground
  yard(48, 68, 3, 2, 211);            // gate lay-by

  // ══ 5. swept approaches — a shaped doorstep for every entrance ═══════════
  for (const b of BUILDINGS) {
    if (!b.door) continue;
    const dx = doorX(b);
    const dy = doorY(b);
    for (let x = dx - 1; x <= dx + b.door[1]; x++) {
      for (let y = dy; y <= dy + 1; y++) {
        if (rnd(x * 7, y * 13) < 0.86 && '.,"*;yX'.includes(g.get(x, y))) g.set(x, y, 'd');
      }
    }
    g.set(dx, dy, 'd');
    if (b.door[1] > 1) g.set(dx + 1, dy, 'd');
  }
  // Gate road runs right up to the arch.
  g.rect(40, 69, 4, 2, 'p');

  // ── fences: the farm, the market gardens, the inn paddock ────────────────
  const fenceH = (x0: number, x1: number, y: number, gapAt?: number) => {
    for (let x = x0; x <= x1; x++) {
      if (gapAt !== undefined && (x === gapAt || x === gapAt + 1)) continue;
      g.set(x, y, x === x0 ? '<' : x === x1 ? '>' : (x - x0) % 4 === 0 ? 'o' : 'f');
    }
  };
  fenceH(6, 17, 18, 11);              // farm paddock, south side
  fenceH(6, 12, 7, 9);                // farm, north side
  fenceH(6, 27, 71, 20);              // the town's southern boundary, west run
  fenceH(46, 58, 71, 51);             // the town's southern boundary, east run
  fenceH(24, 30, 56, 27);             // between square and the south houses
  fenceH(78, 84, 49, 81);             // inn paddock

  // ══ 6. verges: worn edges beside everything people walk on ═══════════════
  const walk = 'pdcx=g';
  const gsoft = '.,"*';
  const grid0 = g.rows();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!gsoft.includes(grid0[y][x])) continue;
      const near = walk.includes(grid0[y - 1][x]) || walk.includes(grid0[y + 1][x])
        || walk.includes(grid0[y][x - 1]) || walk.includes(grid0[y][x + 1]);
      if (!near) continue;
      const r = rnd(x * 31 + 5, y * 17);
      if (r < 0.14) g.set(x, y, 'p');       // the road spreading where it's used
      else if (r < 0.30) g.set(x, y, 'y');  // scorched, trodden grass
      else if (r < 0.62) g.set(x, y, ';');
    }
  }

  // ══ 7. object layer: mass planting ═══════════════════════════════════════
  const o = new GridPainter(W, H, ' ');

  // Woodland: the 'X' cells get trees, and the walkable fringe in front of them
  // gets thinning trees and undergrowth so the edge is soft, not a wall.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) !== 'X') continue;
      const r = rnd(x * 3 + 1, y * 5 + 2);
      if (r < 0.46) o.set(x, y, y < 26 || x > 74 ? (r < 0.16 ? 'P' : 'T') : 'T');
      else if (r < 0.60) o.set(x, y, 'b');
      else if (r < 0.66) o.set(x, y, 'r');
      else if (r < 0.70) o.set(x, y, 'u');
    }
  }
  // The fringe: anything soft-grass within 2 tiles of woodland.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (!gsoft.includes(g.get(x, y))) continue;
      let near = false;
      for (let j = -2; j <= 2 && !near; j++) for (let i = -2; i <= 2; i++) {
        if (g.get(x + i, y + j) === 'X') { near = true; break; }
      }
      if (!near) continue;
      const r = rnd(x * 11 + 3, y * 7 + 4);
      if (r < 0.13) o.set(x, y, 'T');
      else if (r < 0.24) o.set(x, y, 'b');
      else if (r < 0.29) o.set(x, y, 'y');
      else if (r < 0.33) o.set(x, y, 'r');
    }
  }
  // General undergrowth so open grass is never a flat green sheet.
  o.scatter('b', [' '], 0.045, 61);
  o.scatter('r', [' '], 0.018, 67);
  o.scatter('y', [' '], 0.022, 71);

  // Reeds and river rocks along every bank.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) !== 's') continue;
      const r = rnd(x * 13 + 7, y * 3 + 9);
      if (r < 0.30) o.set(x, y, 'e');
      else if (r < 0.40) o.set(x, y, 'm');
      else if (r < 0.46) o.set(x, y, 'j');
    }
  }

  // Orchards and gardens: clustered, each with its own species so districts
  // don't blur into one another.
  const grove = (cx: number, cy: number, rx: number, ry: number, ch: string, d: number, sd: number) => {
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        if (rnd(x * 5 + sd, y * 9 + sd) < d) o.set(x, y, ch);
      }
    }
  };
  grove(19, 22, 5, 4, 'B', 0.30, 301);    // blossom orchard, north-west farm
  grove(79, 30, 5, 4, 'B', 0.28, 303);    // inn orchard, east bank
  grove(60, 20, 4, 4, 'T', 0.26, 305);    // plaza's east copse
  grove(26, 63, 4, 3, 'B', 0.26, 307);    // market gardens
  grove(56, 60, 4, 3, 'T', 0.24, 309);    // south houses
  grove(30, 46, 3, 3, 'T', 0.22, 311);    // west of the square

  // Kitchen gardens: rows of vegetables inside their own hedged plots.
  const plot = (x0: number, y0: number, w: number, h: number) => {
    for (let x = x0; x < x0 + w; x++) {
      o.set(x, y0 - 1, x === x0 ? '[' : x === x0 + w - 1 ? ']' : 'h');
    }
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if ((y - y0) % 2 === 0 && (x - x0) % 2 === 0) o.set(x, y, 'v');
      }
    }
  };
  plot(7, 67, 8, 4);
  plot(23, 68, 6, 4);
  plot(6, 11, 6, 3);
  plot(30, 50, 4, 3);

  // Hedges framing the square, the tower green and the gardens.
  const hedge = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x++) o.set(x, y, x === x0 ? '[' : x === x1 ? ']' : 'h');
  };
  const hedgeV = (y0: number, y1: number, x: number) => {
    for (let y = y0; y <= y1; y++) o.set(x, y, 'h');
  };
  hedge(34, 39, 37);              // in front of the store, square side
  hedge(53, 57, 38);              // square north-east planting
  hedge(33, 37, 54);              // square south-west planting
  hedge(48, 54, 55);              // square south-east planting
  hedgeV(26, 30, 47);             // tower green, west
  hedgeV(26, 30, 54);             // tower green, east
  hedge(48, 53, 24);              // behind the tower — stops you walking behind it
  hedge(12, 18, 60);              // Sera's garden wall
  hedgeV(53, 59, 20);
  hedge(77, 82, 48);              // inn garden
  hedge(30, 35, 57);
  hedge(50, 55, 57);

  // ══ 8. clear objects off anything walkable or built on ═══════════════════
  const clearRect = (x0: number, y0: number, w: number, h: number, pad = 0) => {
    for (let y = y0 - pad; y < y0 + h + pad; y++) {
      for (let x = x0 - pad; x < x0 + w + pad; x++) o.set(x, y, ' ');
    }
  };
  for (const b of BUILDINGS) clearRect(b.tx, b.ty, b.w, b.h, 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = g.get(x, y);
      if ('pdcxs~=NSg'.includes(c)) o.set(x, y, ' ');
      if ('fo<>'.includes(c)) o.set(x, y, ' ');
    }
  }

  // ══ 9. buildings ═════════════════════════════════════════════════════════
  for (const b of BUILDINGS) {
    P(b.key, b.tx + b.w / 2 - 0.5, b.ty + b.h - 1 + b.gap / 16, {}, b.id);
    zones.push({ kind: 'block', id: `blk_${b.id}`, x: b.tx, y: b.ty, w: b.w, h: b.h });
  }

  // Chimney smoke, so roofs are not static. Anchors are eyeballed per sprite.
  for (const [id, dx, dy] of [
    ['inn', 1.7, -6.2], ['house_a', 0.4, -4.6], ['house_c', 1.6, -4.8],
    ['workshop', 1.9, -5.6], ['house_e', -1.4, -3.6],
  ] as const) {
    const b = bld(id);
    P('prop/build/chimney_smoke_0', b.tx + b.w / 2 - 0.5 + dx, b.ty + b.h - 1 + b.gap / 16 + dy,
      { anim: 'chimney_smoke', depthBias: 40000 });
  }

  // Hanging trade signs, so the player never has to guess which building is which.
  const sign = (id: string, dx: number, dy: number, key: string) => {
    const b = bld(id);
    P(key, b.tx + b.w / 2 - 0.5 + dx, b.ty + b.h - 1 + b.gap / 16 + dy, { depthBias: 30000 });
  };
  sign('store', 2.6, -1.4, 'prop/build/sign_bakery');
  sign('courier', 2.7, -0.6, 'prop/build/sign_courier');
  sign('workshop', 2.6, -1.2, 'prop/build/sign_herbalist');
  sign('inn', -3.4, -1.6, 'prop/build/sign_inn');

  // ══ 10. set dressing, district by district ══════════════════════════════

  // ── Town Square ─────────────────────────────────────────────────────────
  P('prop/town/fountain', 44, 46, { solid: [44, 44], anim: 'fountain_idle', interact: 'fountain' }, 'fountain');
  P('prop/town/notice_board', 39.5, 41, { solid: [30, 12], interact: 'notice_board' }, 'notice_board');
  P('prop/town/signpost_0', 46.5, 37.5, { solid: [12, 8], interact: 'signpost_square' });
  P('prop/town/signpost_1', 41, 55.5, { solid: [12, 8], interact: 'signpost_south' });
  P('prop/town/signpost_2', 56, 43, { solid: [12, 8], interact: 'signpost_bridge' });
  for (const [x, y, k] of [
    [41, 42.5, 'prop/town/bench_0'], [47.5, 42.5, 'prop/town/bench_0'],
    [41, 49.5, 'prop/town/bench_1'], [47.5, 49.5, 'prop/town/bench_1'],
    [37, 46, 'prop/town/bench_0'], [51.5, 46, 'prop/town/bench_0'],
  ] as const) P(k, x, y, { solid: [30, 10] });
  for (const [x, y] of [[36, 39], [52, 39], [36, 52], [52, 52], [44, 37], [44, 54]] as const) {
    P('prop/town/lamppost_lit_0', x, y, { anim: 'lamppost_flicker', solid: [8, 6] });
    lights.push({ x, y: y - 2, radius: 40, color: 0xffb937, intensity: 0.22, flicker: 0.5 });
  }
  for (const [x, y, k] of [
    [38, 44, 'prop/town/planter_0'], [38, 48, 'prop/town/planter_1'],
    [50, 44, 'prop/town/planter_1'], [50, 48, 'prop/town/planter_0'],
    [43, 39, 'prop/town/planter_0'], [46, 39, 'prop/town/planter_1'],
  ] as const) P(k, x, y, { solid: [16, 8] });
  P('prop/town/flowerbed_0', 34.5, 42, { solid: [28, 8] });
  P('prop/town/flowerbed_1', 34.5, 50, { solid: [28, 8] });
  P('prop/town/flowerbed_2', 54, 48, { solid: [28, 8] });
  // A small market on the square's east edge — implied activity, no NPC needed.
  P('prop/build/stall_frame', 53.5, 41.5, { solid: [60, 14], interact: 'market_stall' });
  P('prop/build/awning_wide_red', 53.5, 39.6, { depthBias: 12000 });
  P('prop/town/crate_1', 52, 42.6, {});
  P('prop/town/basket_1', 55, 42.6, {});
  P('prop/town/basket_2', 51, 43.4, {});
  P('prop/town/sack_0', 55.6, 43.6, {});
  P('prop/town/cart', 49, 53, { solid: [42, 14], interact: 'square_cart' });
  P('prop/town/crate_0', 47.6, 53.6, {});
  P('prop/town/barrel_0', 51.4, 53.4, {});
  P('prop/town/birdbath', 44, 41, { solid: [16, 8] });
  P('prop/town/bird_perched_0', 44, 40.1, { anim: 'bird_perched_idle', depthBias: 6 });
  for (const [x, y] of [[42.4, 43.4], [45.6, 48.6], [39, 45]] as const) {
    P('prop/town/butterfly_0', x, y, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -10] });
  }
  P('prop/town/stone_lantern', 43, 43, { solid: [10, 8] });
  P('prop/town/stone_lantern', 45, 48, { solid: [10, 8] });

  // ── General store frontage ──────────────────────────────────────────────
  {
    const b = bld('store');
    P('prop/build/awning_wide_teal', b.tx + 2.5, b.ty + b.h - 1.3, { depthBias: 12000 });
    P('prop/town/vegetable_row_0', b.tx + 0.5, doorY(b), { solid: [28, 8] });
    P('prop/town/vegetable_row_2', b.tx + 5.5, doorY(b), { solid: [28, 8] });
    P('prop/town/crate_1', b.tx + 5.6, doorY(b) - 0.4, {});
    P('prop/town/basket_1', b.tx + 0.6, doorY(b) - 0.5, { interact: 'store_apples' });
    P('prop/town/milk_churn', b.tx + 6.4, doorY(b) - 0.2, {});
    // Delivery yard behind it.
    P('prop/town/cart', 37, 27.5, { solid: [42, 14] });
    P('prop/town/crate_0', 34.4, 27.2, {});
    P('prop/town/crate_2', 35.3, 27.9, {});
    P('prop/town/sack_1', 39.4, 27.6, {});
    P('prop/town/woodpile_0', 33.5, 28.4, { solid: [28, 10] });
    P('prop/town/chicken_0', 35, 26.4, { anim: 'chicken_peck' });
    P('prop/town/chicken_2', 36.6, 26.1, { anim: 'chicken_peck' });
  }

  // ── Bell tower green ────────────────────────────────────────────────────
  P('prop/town/shrine_small', 45, 30, { solid: [16, 8], interact: 'shrine_small' });
  P('prop/town/bench_0', 45.5, 33.5, { solid: [30, 10] });
  P('prop/town/bench_1', 54.5, 32.5, { solid: [30, 10] });
  for (const [x, y] of [[47, 27], [54, 27], [47, 35], [54, 35]] as const) {
    P('prop/town/lamppost_lit_0', x, y, { anim: 'lamppost_flicker', solid: [8, 6] });
    lights.push({ x, y: y - 2, radius: 40, color: 0xffb937, intensity: 0.22, flicker: 0.5 });
  }
  P('prop/town/stone_lantern', 51, 36.4, { solid: [10, 8] });
  P('prop/town/stone_lantern', 49, 36.4, { solid: [10, 8] });
  P('prop/town/flowerbed_1', 42.5, 30, { solid: [28, 8] });
  P('prop/town/flowerbed_2', 55.5, 30, { solid: [28, 8] });
  P('prop/town/bird_perched_1', 51, 25.8, { anim: 'bird_perched_idle', depthBias: 30000 });
  lights.push({ x: 50, y: 27, radius: 52, color: 0xffd08a, intensity: 0.20, flicker: 0.3 });

  // ── Festival Plaza, ordinary state ──────────────────────────────────────
  P('prop/fest/flower_arch', 43.5, 9, { solid: [50, 10], interact: 'plaza_arch' });
  for (const [x, y] of [[36, 12], [51, 12], [36, 19], [51, 19]] as const) {
    P('prop/fest/string_lights_pole', x, y, { solid: [8, 8] });
  }
  P('prop/fest/string_lights_span_0', 39, 11.2, { over: true });
  P('prop/fest/string_lights_span_1', 42, 11.2, { over: true });
  P('prop/fest/string_lights_span_2', 45, 11.2, { over: true });
  P('prop/fest/bunting_0', 38, 19.6, { over: true, sway: 0.5 });
  P('prop/fest/bunting_1', 41, 19.6, { over: true, sway: 0.5 });
  P('prop/fest/bunting_2', 47, 19.6, { over: true, sway: 0.5 });
  P('prop/build/stall_frame', 34, 15.5, { solid: [60, 14], interact: 'plaza_stall' });
  P('prop/build/stall_frame', 53, 15.5, { solid: [60, 14] });
  P('prop/build/awning_wide_blue', 53, 13.6, { depthBias: 12000 });
  P('prop/fest/crate_stack_fest', 47, 17.6, { solid: [28, 10], interact: 'plaza_crates' });
  P('prop/fest/crate_stack_fest', 40.6, 17.4, { solid: [28, 10] });
  P('prop/fest/barrel_fest', 48.4, 18.2, { solid: [18, 8] });
  P('prop/fest/drink_barrel', 39.4, 18.2, { solid: [22, 8] });
  P('prop/town/hay_bale', 51.5, 21.4, { solid: [22, 10] });
  P('prop/town/hay_bale', 53, 22.2, { solid: [22, 10] });
  P('prop/town/picnic_table', 37.5, 21.5, { solid: [36, 12] });
  P('prop/town/picnic_table', 49.5, 12.5, { solid: [36, 12] });
  P('prop/fest/ground_lantern_0', 40, 13.4, {});
  P('prop/fest/ground_lantern_1', 47, 13.4, {});
  P('prop/fest/ground_lantern_2', 43.5, 19.6, {});
  P('prop/town/notice_board', 46.6, 22, { solid: [30, 12], interact: 'plaza_board' }, 'plaza_board');
  for (const [x, y] of [[38, 8], [49, 8], [34, 22], [53, 22]] as const) {
    P('prop/town/lamppost_lit_0', x, y, { anim: 'lamppost_flicker', solid: [8, 6] });
    lights.push({ x, y: y - 2, radius: 40, color: 0xffb937, intensity: 0.20, flicker: 0.5 });
  }
  P('prop/town/flowerbed_0', 33, 11, { solid: [28, 8] });
  P('prop/town/flowerbed_2', 54.5, 20, { solid: [28, 8] });
  for (const [x, y] of [[41, 16.5], [46.5, 14], [35, 19]] as const) {
    P('prop/town/butterfly_1', x, y, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
  }

  // ── the north farm ──────────────────────────────────────────────────────
  {
    const b = bld('barn');
    P('prop/town/water_trough', b.tx + 6.5, b.ty + 4, { solid: [28, 8] });
    P('prop/town/hay_bale', b.tx - 0.6, b.ty + 4.6, { solid: [22, 10] });
    P('prop/town/hay_bale', b.tx + 0.6, b.ty + 5.4, { solid: [22, 10] });
    P('prop/town/wheelbarrow', 13.4, 16.4, { solid: [22, 10] });
    P('prop/town/milk_churn', 9, 16.2, {});
    P('prop/town/milk_churn', 9.8, 16.7, {});
    P('prop/town/woodpile_1', 7, 15.4, { solid: [20, 10] });
    P('prop/town/scarecrow', 9, 10.5, { solid: [10, 8], interact: 'scarecrow' });
    for (const [x, y] of [[11.4, 16.9], [12.6, 15.6], [10.2, 17.4], [14, 15]] as const) {
      P('prop/town/chicken_0', x, y, { anim: 'chicken_peck' });
    }
    P('prop/town/beehive', 16.6, 20.6, { solid: [14, 8], interact: 'beehive' });
    P('prop/town/beehive', 17.6, 21.4, { solid: [14, 8] });
    P('prop/town/log_0', 6.5, 22.5, { solid: [26, 8] });
    P('prop/town/tree_stump', 8, 24, { solid: [16, 8] });
  }

  // ── Courier Row ─────────────────────────────────────────────────────────
  {
    const b = bld('courier');
    P('prop/build/awning_small_gold', b.tx + 1.4, b.ty + b.h - 1.6, { depthBias: 12000 });
    // Parcels waiting to go out — the district's signature prop.
    for (const [x, y, k] of [
      [11.4, 35.6, 'prop/town/parcel_0'], [12.2, 36.2, 'prop/town/parcel_2'],
      [15.6, 35.5, 'prop/town/parcel_1'], [16.4, 36.1, 'prop/town/parcel_3'],
      [27.4, 33.4, 'prop/town/parcel_0'], [28.2, 34, 'prop/town/parcel_1'],
      [26.6, 34.2, 'prop/town/parcel_3'],
    ] as const) P(k, x, y, { interact: x < 20 ? 'parcels' : undefined });
    P('prop/town/cart', 24, 36.4, { solid: [42, 14], interact: 'courier_cart' });
    P('prop/town/crate_1', 22.6, 37, {});
    P('prop/town/sack_0', 26.4, 36.6, {});
    P('prop/town/notice_board', 18.6, 36, { solid: [30, 12], interact: 'courier_board' }, 'courier_board');
    // Laundry strung between the houses, drawn over the player.
    P('prop/town/laundry_line_0', 20, 27.2, { over: true, sway: 0.5 });
    P('prop/town/laundry_line_1', 20, 31.2, { over: true, sway: 0.5 });
    P('prop/town/laundry_line_2', 9, 27.4, { over: true, sway: 0.5 });
    // The pigeon roost: the shed with birds on and around it.
    const sh = bld('shed_courier');
    P('prop/town/bird_perched_0', sh.tx + 0.6, sh.ty + 0.2, { anim: 'bird_perched_idle', depthBias: 20000, interact: 'pigeons' });
    P('prop/town/bird_perched_1', sh.tx + 2.2, sh.ty + 0.4, { anim: 'bird_perched_idle', depthBias: 20000 });
    P('prop/town/bird_perched_0', sh.tx + 1.4, sh.ty + 3.6, { anim: 'bird_perched_idle' });
    P('prop/town/basket_0', sh.tx + 3.4, sh.ty + 3.2, {});
    for (const [x, y] of [[17, 33], [17, 43], [9, 36], [26, 28]] as const) {
      P('prop/town/lamppost_lit_0', x, y, { anim: 'lamppost_flicker', solid: [8, 6] });
      lights.push({ x, y: y - 2, radius: 36, color: 0xffb937, intensity: 0.20, flicker: 0.5 });
    }
    P('prop/town/window_box', 6.5, 43.2, { depthBias: 12000 });
    P('prop/town/window_box', 24, 33.2, { depthBias: 12000 });
    P('prop/town/planter_0', 14.6, 35, { solid: [14, 8] });
    P('prop/town/planter_1', 21, 34.6, { solid: [18, 8] });
    P('prop/town/pump', 19.4, 44, { solid: [14, 8], interact: 'pump' });
    P('prop/town/barrel_1', 20.6, 44.6, {});
    P('prop/town/cat_sleeping_0', 12.6, 37.5, { anim: 'cat_sleeping_idle', interact: 'cat' }, 'cat');
    P('prop/town/woodpile_0', 5.5, 45.6, { solid: [28, 10] });
    P('prop/town/basket_2', 8.4, 44.5, {});
  }

  // ── Sera's Workshop ─────────────────────────────────────────────────────
  {
    const b = bld('workshop');
    P('prop/town/planter_0', b.tx - 0.6, b.ty + b.h - 0.4, { solid: [14, 8] });
    P('prop/town/planter_1', b.tx + 7.4, b.ty + b.h - 0.6, { solid: [18, 8] });
    P('prop/town/crate_1', b.tx + 7.5, b.ty + 2.4, { solid: [16, 8] });
    P('prop/town/barrel_0', b.tx + 7.6, b.ty + 3.6, { solid: [14, 8] });
    P('prop/town/barrel_1', b.tx - 0.5, b.ty + 3.4, { solid: [20, 8] });
    P('prop/town/table_round', 20.5, 62, { solid: [22, 10], interact: 'sera_bench' });
    P('prop/town/stool', 19.2, 62.4, {});
    P('prop/town/chair_0', 21.8, 62.2, {});
    P('prop/town/birdbath', 11, 62, { solid: [16, 8] });
    P('prop/town/beehive', 10, 57.5, { solid: [14, 8] });
    P('prop/town/vegetable_row_1', 13.5, 62, { solid: [28, 8] });
    P('prop/town/vegetable_row_0', 16.5, 62, { solid: [28, 8] });
    P('prop/town/flowerbed_0', 23.5, 55, { solid: [28, 8] });
    P('prop/town/flowerbed_2', 10.5, 51, { solid: [28, 8] });
    P('prop/town/stone_lantern', 19, 59.4, { solid: [10, 8] });
    P('prop/town/stone_lantern', 11, 59.4, { solid: [10, 8] });
    for (const [x, y] of [[19, 51], [11, 65], [23, 60]] as const) {
      P('prop/town/lamppost_lit_0', x, y, { anim: 'lamppost_flicker', solid: [8, 6] });
      lights.push({ x, y: y - 2, radius: 36, color: 0xffb937, intensity: 0.20, flicker: 0.5 });
    }
    P('prop/town/butterfly_2', 14, 63.5, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
    P('prop/town/butterfly_3', 17.5, 61, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -14] });
  }

  // ── market gardens and the south-west ───────────────────────────────────
  P('prop/town/scarecrow', 12, 71, { solid: [10, 8] });
  P('prop/town/wheelbarrow', 16.5, 66.4, { solid: [22, 10] });
  P('prop/town/sack_1', 15, 66.6, {});
  P('prop/town/sack_0', 17.6, 65.6, {});
  P('prop/town/basket_1', 14.4, 67, { interact: 'garden_basket' });
  P('prop/town/well', 25.5, 71.5, { solid: [26, 12], interact: 'well' }, 'well');
  P('prop/town/water_trough', 21.5, 66.4, { solid: [28, 8] });
  P('prop/town/hay_bale', 28.5, 66, { solid: [22, 10] });
  P('prop/town/log_1', 6.5, 60, { solid: [22, 8] });
  P('prop/town/duck_0', 8.5, 58.5, { anim: 'duck_waddle' });
  for (const [x, y] of [[9.5, 61.6], [10.6, 60.8]] as const) P('prop/town/chicken_1', x, y, { anim: 'chicken_peck' });

  // ── south houses and the road to the gate ───────────────────────────────
  {
    const c = bld('house_c');
    P('prop/town/flowerbed_1', c.tx + 0.5, doorY(c), { solid: [28, 8] });
    P('prop/town/window_box', c.tx + 1, c.ty + c.h - 2.4, { depthBias: 12000 });
    P('prop/town/bench_0', c.tx + 5.5, doorY(c) - 0.2, { solid: [30, 10] });
    P('prop/town/woodpile_1', c.tx - 0.5, c.ty + 4.6, { solid: [20, 10] });
    const d = bld('house_d');
    P('prop/town/flowerbed_0', d.tx + 3.5, doorY(d), { solid: [28, 8] });
    P('prop/town/planter_0', d.tx - 0.4, doorY(d) - 0.4, { solid: [14, 8] });
    P('prop/town/barrel_0', d.tx + 5.4, d.ty + 4.4, { solid: [14, 8] });
    P('prop/town/cat_sleeping_1', d.tx + 4.4, doorY(d) - 0.3, { anim: 'cat_sleeping_idle', interact: 'cat_south' });
    P('prop/town/picnic_table', 46.5, 62.5, { solid: [36, 12] });
    P('prop/town/table_round', 38, 61.5, { solid: [22, 10] });
    P('prop/town/stool', 36.8, 61.8, {});
    for (const [x, y] of [[38, 57], [48, 57], [39, 68], [46, 68], [37, 47]] as const) {
      P('prop/town/lamppost_lit_0', x, y, { anim: 'lamppost_flicker', solid: [8, 6] });
      lights.push({ x, y: y - 2, radius: 38, color: 0xffb937, intensity: 0.21, flicker: 0.5 });
    }
    P('prop/town/signpost_2', 44.5, 66, { solid: [12, 8], interact: 'signpost_gate' });
    P('prop/town/flowerbed_2', 44.5, 59, { solid: [28, 8] });
    P('prop/town/bush_3', 47.5, 59.5, { sway: 0.4 });
  }

  // ── South Gate ──────────────────────────────────────────────────────────
  {
    const b = bld('south_gate');
    P('prop/town/crate_0', b.tx - 1.4, b.ty - 0.4, {});
    P('prop/town/crate_2', b.tx - 0.6, b.ty + 0.2, {});
    P('prop/town/barrel_0', b.tx + 6.5, b.ty - 0.3, {});
    P('prop/town/signpost_0', b.tx + 6.4, b.ty - 1.4, { solid: [12, 8], interact: 'gate_sign' });
    P('prop/town/hay_bale', 47.5, 69.6, { solid: [22, 10] });
    P('prop/town/log_0', 36.5, 69.6, { solid: [26, 8] });
    lights.push({ x: 40, y: 72, radius: 34, color: 0xffb937, intensity: 0.24, flicker: 0.6 });
    lights.push({ x: 44, y: 72, radius: 34, color: 0xffb937, intensity: 0.24, flicker: 0.6 });
  }

  // ── the river: bridge, jetty, ford, wildlife ────────────────────────────
  for (const [x, y] of [[BR_X0, 42], [BR_X1, 42], [BR_X0, 46], [BR_X1, 46]] as const) {
    P('prop/town/bridge_post', x, y, { depthBias: 200 });
  }
  P('prop/town/jetty', 59.5, 55, { solid: [28, 8], interact: 'jetty' }, 'jetty');
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
  P('prop/town/bench_0', 58, 48.5, { solid: [30, 10], interact: 'river_bench' });
  P('prop/town/stone_lantern', 57, 47, { solid: [10, 8] });
  P('prop/town/mossy_rock_1', 60, 61.5, { solid: [20, 8] });
  P('prop/town/river_rock_1', 66, 27.5, { depthBias: -20 });
  P('prop/town/river_rock_0', 69, 26.6, { depthBias: -20 });
  P('prop/town/river_rock_2', 71, 28.4, { depthBias: -20 });
  P('prop/town/signpost_1', 63, 25, { solid: [12, 8], interact: 'ford_sign' });

  // ── the Lantern Inn and its garden ──────────────────────────────────────
  {
    const b = bld('inn');
    P('prop/town/lamppost_lit_0', b.tx - 1, doorY(b) - 1, { anim: 'lamppost_flicker', solid: [8, 6] });
    P('prop/town/lamppost_lit_0', b.tx + b.w, doorY(b) - 1, { anim: 'lamppost_flicker', solid: [8, 6] });
    lights.push({ x: b.tx - 1, y: doorY(b) - 3, radius: 44, color: 0xffb937, intensity: 0.26, flicker: 0.6 });
    lights.push({ x: b.tx + b.w, y: doorY(b) - 3, radius: 44, color: 0xffb937, intensity: 0.26, flicker: 0.6 });
    lights.push({ x: b.tx + 3.5, y: b.ty + 5, radius: 60, color: 0xffc45e, intensity: 0.20, flicker: 0.2 });
    P('prop/town/flowerbed_0', b.tx + 0.5, doorY(b), { solid: [28, 8] });
    P('prop/town/flowerbed_1', b.tx + 6.5, doorY(b), { solid: [28, 8] });
    P('prop/town/picnic_table', 78.5, 44.5, { solid: [36, 12], interact: 'inn_table' });
    P('prop/town/picnic_table', 82, 47.5, { solid: [36, 12] });
    P('prop/town/mug', 78, 44.1, {});
    P('prop/town/bench_1', 75.5, 46.5, { solid: [30, 10] });
    P('prop/town/cart', 76, 43, { solid: [42, 14] });
    P('prop/town/barrel_0', 84.4, 43.4, { solid: [14, 8] });
    P('prop/town/barrel_1', 83.4, 44.2, { solid: [20, 8] });
    P('prop/town/crate_1', 85.4, 44.4, {});
    P('prop/town/woodpile_0', 85.5, 48.4, { solid: [28, 10] });
    P('prop/town/laundry_line_1', 80, 42.2, { over: true, sway: 0.5 });
    P('prop/town/cat_sleeping_0', 77.4, 43.6, { anim: 'cat_sleeping_idle', interact: 'inn_cat' }, 'inn_cat');
    for (const [x, y] of [[81.5, 45.6], [82.6, 46.4], [80.4, 46.8]] as const) {
      P('prop/town/chicken_0', x, y, { anim: 'chicken_peck' });
    }
    P('prop/town/water_trough', 74.5, 47.4, { solid: [28, 8] });
    P('prop/town/birdbath', 79, 50, { solid: [16, 8] });
    P('prop/town/bird_perched_0', 79, 49.2, { anim: 'bird_perched_idle', depthBias: 6 });
    P('prop/town/beehive', 82.6, 31.4, { solid: [14, 8] });
    P('prop/town/basket_1', 77.4, 31.6, {});
    P('prop/town/basket_0', 80.6, 32.4, {});
    for (const [x, y] of [[78, 30.5], [81, 33], [76.5, 45]] as const) {
      P('prop/town/butterfly_0', x, y, { anim: 'butterfly_fly', depthBias: 400, offset: [0, -12] });
    }
    P('prop/town/stone_lantern', 73.4, 40, { solid: [10, 8] });
    P('prop/town/stone_lantern', 73.4, 48, { solid: [10, 8] });
    lights.push({ x: 73.4, y: 39, radius: 30, color: 0xffb937, intensity: 0.16, flicker: 0.4 });
  }

  // ── east-bank woodland: the woodcutter's clearing and the overlook ──────
  P('prop/town/log_0', 76.5, 62, { solid: [26, 8] });
  P('prop/town/log_1', 78, 63.6, { solid: [22, 8] });
  P('prop/town/tree_stump', 75, 63.4, { solid: [16, 8] });
  P('prop/town/woodpile_1', 74.5, 61, { solid: [20, 10] });
  P('prop/town/bench_0', 79.5, 23.5, { solid: [30, 10], interact: 'overlook' });
  P('prop/town/shrine_small', 78, 21.5, { solid: [16, 8], interact: 'roadside_shrine' });
  P('prop/town/stone_lantern', 76.6, 22.4, { solid: [10, 8] });
  lights.push({ x: 76.6, y: 21.6, radius: 26, color: 0xffd08a, intensity: 0.20, flicker: 0.7 });
  P('prop/town/mossy_rock_0', 81, 25.5, { solid: [16, 8] });

  // ══ 11. townsfolk ════════════════════════════════════════════════════════
  const npcs: NpcPlacement[] = [
    // Mira works the inn front: door, tables, the well of her own garden.
    { id: 'mira', x: 79, y: 42, facing: 's', path: [[79, 42], [79, 45], [82, 46], [79, 45]], dwell: 3.2 },
    // Sera between her door and the garden table she works at outdoors.
    { id: 'sera', x: 15, y: 60, facing: 's', path: [[15, 60], [20, 61], [20, 63], [16, 61]], dwell: 4 },
    // Oren, fast-moving: office door, parcel yard, the square's notice board.
    { id: 'oren', x: 13, y: 36, facing: 's', path: [[13, 36], [20, 36], [27, 35], [20, 36], [17, 44], [17, 38]], dwell: 1.6 },
    // Elia bustles around the plaza's preparations.
    { id: 'elia', x: 44, y: 17, facing: 's', path: [[44, 17], [37, 17], [37, 13], [48, 13], [50, 18], [44, 20]], dwell: 2.2 },
    // Tavi holds court where the plaza meets the road down to town.
    { id: 'tavi', x: 45, y: 22, facing: 's', path: [[45, 22], [44, 26], [45, 31], [44, 26]], dwell: 3.4 },
    // Nia keeps to the quiet water below the square.
    { id: 'nia', x: 58, y: 50, facing: 'e', path: [[58, 50], [58, 54], [59, 57], [58, 53]], dwell: 5 },
    // The baker: store to square and back, exactly as briefed.
    { id: 'villager_a', x: 36, y: 37, facing: 's', path: [[36, 37], [38, 43], [44, 48], [40, 42], [36, 37]], dwell: 2.6 },
    // The fisher stands on the east bank of the pool.
    { id: 'villager_b', x: 71, y: 57, facing: 'w', dwell: 6 },
    // Courier Row local, doing the rounds of the lanes.
    { id: 'villager_c', x: 17, y: 40, facing: 'n', path: [[17, 40], [17, 35], [24, 35], [17, 35], [17, 44], [24, 44]], dwell: 2 },
    // South road: between the well, the gardens and the houses.
    { id: 'villager_d', x: 41, y: 62, facing: 'n', path: [[41, 62], [41, 66], [34, 65], [41, 66], [41, 58]], dwell: 2.8 },
    // The gate keeper. Stationary, beside the crossbar.
    { id: 'villager_e', x: 46, y: 70, facing: 'w', dwell: 8 },
    // Crossing the bridge on an errand, over and over.
    { id: 'villager_f', x: 55, y: 44, facing: 'e', path: [[55, 44], [64, 44], [73, 44], [76, 42], [64, 44]], dwell: 2.4 },
  ];

  // ══ 12. zones ════════════════════════════════════════════════════════════
  const doorZone = (id: string, to: string, spawn: string): Zone => {
    const b = bld(id);
    return { kind: 'door', id: `to_${to}`, x: doorX(b), y: doorY(b), w: b.door![1], h: 1, to, spawn, facing: 'n' };
  };
  zones.push(doorZone('inn', 'inn', 'default'));
  zones.push(doorZone('workshop', 'workshop', 'default'));
  zones.push(doorZone('courier', 'courier', 'door'));
  zones.push({
    kind: 'door', id: 'to_festival', x: 42, y: 8, w: 4, h: 1,
    to: 'festival', spawn: 'default', facing: 'n', requires: 'festival_started',
  });
  zones.push({
    kind: 'door', id: 'to_woods', x: 41, y: 70, w: 2, h: 1,
    to: 'woods', spawn: 'default', facing: 's', requires: 'south_gate_open',
  });
  zones.push({ kind: 'trigger', id: 'gate_shut', x: 40, y: 69, w: 4, h: 2, forbids: 'south_gate_open', repeat: true });
  zones.push({ kind: 'trigger', id: 'plaza_gate', x: 40, y: 9, w: 8, h: 2, forbids: 'festival_started', repeat: true });
  zones.push({ kind: 'camera', id: 'bounds', x: 0, y: 0, w: W, h: H });

  return {
    id: 'lumen_vale',
    name: 'Lumen Vale',
    subtitle: 'a valley that remembers',
    music: 'town',
    ambience: 'town_day',
    ground: g.rows(),
    legend: {
      '.': { base: 'town/grass' },
      ',': { base: 'town/grass', scatter: 'sparse' },
      '"': { base: 'town/grass', scatter: 'lush' },
      '*': { base: 'town/grass', scatter: 'meadow' },
      ';': { base: 'town/grass', scatter: 'verge' },
      'y': { base: 'town/grass_dry', scatter: 'verge' },
      'X': { base: 'town/grass', scatter: 'lush', solid: true },
      'p': { base: 'town/grass', blob: 'path' },
      'c': { base: 'town/grass', blob: 'cobble' },
      'd': { base: 'town/grass', blob: 'dirt' },
      'x': { base: 'town/soil', scatter: 'grit' },
      's': { base: 'town/grass', blob: 'sand' },
      'g': { base: 'town/soil', blob: 'sand' },
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
        density: 0.9,
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
        density: 0.55,
        tiles: [['scatter/tuft_sm', 5], ['scatter/pebbles', 4], ['scatter/tuft_md', 2], ['', 6]],
      },
      grit: { density: 0.28, tiles: [['scatter/pebbles', 4], ['scatter/tuft_sm', 1], ['', 3]] },
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
      'v': { key: ['prop/town/vegetable_row_0', 'prop/town/vegetable_row_1', 'prop/town/vegetable_row_2'], solid: [28, 8] },
      'r': { key: ['prop/town/rock_0', 'prop/town/rock_1', 'prop/town/rock_2', 'prop/town/rock_3'], solid: [16, 8] },
      'm': { key: ['prop/town/mossy_rock_0', 'prop/town/mossy_rock_1'], solid: [16, 8] },
      'u': { key: ['prop/town/tree_stump', 'prop/town/log_0', 'prop/town/log_1'], solid: [18, 8] },
      'e': { key: ['prop/town/reeds_0', 'prop/town/reeds_1', 'prop/town/reeds_2'], sway: 0.7 },
      'j': { key: ['prop/town/river_rock_0', 'prop/town/river_rock_1', 'prop/town/river_rock_2'] },
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
