/**
 * WHISPER WOODS — Act V (plan.md §5.6, §36).
 *
 * A 3–5 minute pacing zone, not a maze. Its jobs, in order:
 *
 *   1. cool the world down after the festival
 *   2. let the player just play — combat and secrets, no new concepts (§5.6)
 *   3. carry the tone from cosy town to alien dungeon
 *
 * COMPOSITION
 * ───────────
 * One legible north→south spine with four short deviations hanging off it. The
 * spine is `woods_path`; deviations are narrower `soil` trails, so the player
 * can tell "the way on" from "somewhere else" at a glance, without a map.
 *
 *      y   0  ── town gate ────────────────── enter from lumen_vale/south
 *         13  ── First Clearing ───────────── E1  one bramble, safe learning
 *         26  ── The Narrows ──────────────┬─ canopy closes over the path
 *         30                               └─ ◆ toadstool ring (east)
 *         36  ── The Hollow ──────────────── E2  two brambles, pincer
 *         48  ── the plateau (west) ───────── ◆ chest, seen from below
 *         59  ── the cliff face ───────────── ◆ gully up, behind cuttable bushes
 *         61  ── The Dell ────────────────── the reveal: you look UP at it
 *         69  ── The Broken Terrace ──────┬─ E3  wisp across open stone
 *         74                              └─ ◆ carved standing stone (east)
 *         84  ── the stream ──────────────┬─ ◆ boulder ford → old campsite
 *         88  ── South Bank ──────────────── E4  two brambles + a wisp
 *         97  ── The Standing Stones ─────── E5  two brambles + two wisps
 *        106  ── shrine approach ──────────── flagstone; zone to shrine_entrance
 *
 * DARKNESS AND LIGHT (Stardew mine reference)
 * ───────────────────────────────────────────
 * `darkness: 0.3` is deliberately mild. Darkness here is a frame, never a mask:
 * every light in `lights` is placed to do compositional work — lantern posts
 * mark the spine, glowing mushrooms mark the three secrets, the chest has its
 * own light so it reads as a prize from across a cliff, and the shrine arch is
 * the only violet in the zone. The canopy over-layer supplies the contrast the
 * darkness alone cannot: holes are punched in it over every clearing and every
 * lantern, so the bright readable pockets are exactly the places the player has
 * to fight, read or decide in.
 *
 * IMPASSABLE LOOKS IMPASSABLE (ALTTP navigation reference)
 * ────────────────────────────────────────────────────────
 * There is not one invisible wall in this map. Every boundary is either
 * `woods_bramble` (a solid, obviously thorny thicket), water, or a rock face.
 * The one place the player is stopped by something they could plausibly walk
 * through — the cuttable bushes at the gully — is the one place the game wants
 * them to try hitting it.
 */
import { GridPainter } from '../GridPainter';
import { registerMap } from '../registry';
import type { LightDef, MapDef, PropPlacement, Zone } from '../types';

const W = 44;
const H = 116;

/**
 * Landmarks, in tile coords. Exported because the area script, the screenshot
 * tool and the playtest all need to agree on where things are; a duplicated
 * literal in three files is how a map and its script drift apart.
 */
export const WOODS = {
  w: W,
  h: H,
  gate: [21, 6] as const,
  clearing: [21, 20] as const,
  narrows: [21, 31] as const,
  toadstools: [35, 31] as const,
  hollow: [23, 45] as const,
  /** Stand here and the cliff, the plateau and the lit chest are all on screen. */
  dell: [18, 64] as const,
  gully: [4, 60] as const,
  plateau: [9, 53] as const,
  /** The tile you stand on to open the chest — the chest itself is solid. */
  chest: [9, 58] as const,
  terrace: [22, 74] as const,
  carving: [36, 77] as const,
  boulder: [9, 84] as const,
  ford: [9, 85] as const,
  camp: [8, 90] as const,
  crossing: [21, 85] as const,
  southBank: [22, 92] as const,
  gauntlet: [22, 102] as const,
  shrine: [21, 110] as const,
};

/** Enemy set-pieces. The area script spawns these; the playtest asserts them. */
export interface Encounter {
  id: string;
  /** Trigger rect, tile space. */
  zone: [number, number, number, number];
  spawns: Array<['bramble' | 'wisp', number, number]>;
  note: string;
}

export const ENCOUNTERS: Encounter[] = [
  {
    id: 'e1_clearing',
    zone: [14, 15, 15, 2],
    spawns: [['bramble', 21, 22]],
    note: 'One bramble in an open moss clearing. Nothing to hide behind, nothing to be surprised by: the player learns the telegraph in safety.',
  },
  {
    id: 'e2_hollow',
    zone: [15, 37, 15, 2],
    spawns: [['bramble', 17, 44], ['bramble', 27, 44]],
    note: 'Two brambles from opposite sides of the hollow, with a boulder in the middle. Teaches that you cannot face both at once — move.',
  },
  {
    id: 'e3_terrace',
    zone: [18, 68, 9, 2],
    spawns: [['wisp', 22, 76]],
    note: 'A wisp holding an old stone terrace. The approach is eight tiles of open flagstone with two broken columns as the only cover.',
  },
  {
    id: 'e4_bank',
    zone: [16, 88, 13, 2],
    spawns: [['bramble', 18, 94], ['bramble', 27, 94], ['wisp', 23, 91]],
    note: 'Mixed pair plus a charger. The wisp holds the middle and the brambles flank, so the player has to choose a target order.',
  },
  {
    id: 'e5_stones',
    zone: [17, 97, 11, 2],
    spawns: [['bramble', 16, 101], ['bramble', 28, 101], ['wisp', 18, 105], ['wisp', 26, 105]],
    note: 'The gauntlet between the standing stones. Everything the zone taught, at once, immediately before the shrine.',
  },
  {
    id: 'e6_plateau',
    zone: [3, 57, 3, 2],
    spawns: [['wisp', 10, 51]],
    note: 'Optional. The wisp guarding the chest on the plateau — the reward is defended, so finding the way up is not the whole puzzle.',
  },
];

/** Ground chars a later pass is allowed to paint over. */
const OPEN = ['.', ',', '"', 'l', 'm', 'd', 'S', 'p'];

/**
 * Draw into a scratch grid, then stamp the result only onto cells that are
 * currently walkable. Structure (bramble, water, rock) is never overwritten by
 * a decorative pass, which is what stops a surface treatment from accidentally
 * opening a hole in a wall.
 */
function overlay(g: GridPainter, ch: string, draw: (t: GridPainter) => void): void {
  const t = new GridPainter(g.w, g.h, ' ');
  draw(t);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (t.get(x, y) !== ' ') g.setIf(x, y, ch, OPEN);
    }
  }
}

/** Chebyshev distance from every cell to the nearest solid thicket cell. */
function brambleDistance(g: GridPainter): number[][] {
  const dist: number[][] = Array.from({ length: g.h }, () => new Array<number>(g.w).fill(99));
  const queue: Array<[number, number]> = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) === '#') { dist[y][x] = 0; queue.push([x, y]); }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        if (dist[ny][nx] <= dist[y][x] + 1) continue;
        dist[ny][nx] = dist[y][x] + 1;
        queue.push([nx, ny]);
      }
    }
  }
  return dist;
}

function h01(x: number, y: number, salt: number): number {
  let n = (x * 374761393 + y * 668265263 + salt * 1442695041) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * Lantern posts. One list drives the prop, its light and the hole punched in
 * the canopy above it — a lantern the canopy has swallowed lights nothing and
 * marks nothing, which is the opposite of the job.
 */
const LANTERNS: Array<[number, number]> = [
  [18, 9], [13, 16], [29, 16], [18, 33],
  [24, 63], [19, 68], [25, 81], [17, 91],
];

/** Where the canopy must NOT close: clearings, lanterns, the shrine mouth. */
const LIGHT_HOLES: Array<[number, number, number]> = [
  ...LANTERNS.map(([x, y]) => [x, y, 4] as [number, number, number]),
  [21, 20, 8],   // first clearing
  [35, 31, 5],   // toadstool ring
  [23, 42, 8],   // the hollow
  [9, 54, 6],    // the plateau + chest
  [16, 65, 8],   // the dell, under the cliff
  [22, 75, 8],   // the terrace
  [36, 75, 4],   // the carving
  [8, 90, 5],    // the campsite
  [21, 85, 7],   // the stream crossing
  [22, 93, 8],   // south bank
  [22, 102, 9],  // the standing stones
  [21, 110, 9],  // shrine approach
];

function inLightHole(x: number, y: number): boolean {
  for (const [cx, cy, r] of LIGHT_HOLES) {
    if ((x - cx) * (x - cx) / (r * r) + (y - cy) * (y - cy) / (r * r * 0.55) <= 1) return true;
  }
  return false;
}

export function buildWoods(): MapDef {
  // ── 1. structure: everything is thicket until it is carved ────────────────
  const g = new GridPainter(W, H, '#');

  // The spine is carved first and eight tiles wide — two clear tiles either
  // side of the four-tile path. Everything after this only ever widens the
  // walkable space, so the route from the gate to the shrine cannot be broken
  // by a decorative pass.
  g.vLine(0, 28, 21, '.', 8);
  g.vLine(26, 38, 20, '.', 8);
  g.vLine(36, 50, 22, '.', 8);
  g.vLine(48, 67, 22, '.', 8);
  g.hLine(22, 14, 65, '.', 8);
  g.vLine(63, 70, 14, '.', 8);
  g.hLine(14, 22, 69, '.', 8);
  g.vLine(68, 85, 22, '.', 8);
  g.vLine(83, 91, 21, '.', 8);
  g.vLine(88, 100, 22, '.', 8);
  g.vLine(98, 110, 21, '.', 8);

  // the road down from the town gate
  g.rect(17, 0, 10, 9, '.');
  // First Clearing
  g.blob(21, 20, 11, 6, '.', 5, 0.2);
  // east spur → toadstool ring
  g.hLine(21, 33, 30, '.', 4);
  g.blob(35, 31, 6, 4, '.', 7, 0.26);
  // The Hollow
  g.blob(23, 42, 11, 6, '.', 11, 0.24);
  // the plateau: a sealed pocket, reachable only through the gully
  g.rect(2, 48, 13, 11, '.');
  g.blob(8, 53, 6, 5, '.', 13, 0.18);
  // The Dell, at the foot of the cliff
  g.rect(2, 61, 25, 6, '.');
  g.blob(14, 65, 13, 4, '.', 17, 0.18);
  // The Broken Terrace
  g.blob(22, 75, 10, 5, '.', 19, 0.2);
  // east spur → the carved stone
  g.hLine(27, 36, 74, '.', 4);
  g.blob(36, 75, 5, 4, '.', 23, 0.24);
  // the stream and both its banks
  g.rect(2, 80, 40, 8, '.');
  // the island campsite
  g.blob(8, 90, 7, 4, '.', 29, 0.18);
  // South Bank
  g.blob(23, 92, 10, 5, '.', 31, 0.2);
  // The Standing Stones
  g.blob(22, 102, 12, 5, '.', 37, 0.16);
  // shrine approach
  g.rect(15, 105, 14, 9, '.');

  // Thickets standing in the wide river banks, so the crossing reads as a
  // place rather than as forty tiles of empty floor.
  g.rect(2, 80, 4, 2, '#');
  g.rect(33, 80, 8, 2, '#');
  g.rect(29, 87, 5, 2, '#');
  // The campsite island is sealed off from the south bank: the ford is the
  // only way in, which is the only thing that makes the ford worth solving.
  g.rect(13, 87, 4, 10, '#');

  // the frame, re-asserted after the carving
  g.rect(0, 0, W, 3, '#');
  g.rect(0, 0, 2, H, '#');
  g.rect(W - 2, 0, 2, H, '#');
  g.rect(0, H - 2, W, 2, '#');
  // the gate itself
  g.rect(19, 0, 6, 4, '.');

  // seal the plateau off from everything except the gully
  g.rect(15, 46, 4, 14, '#');
  g.rect(2, 46, 14, 2, '#');

  // ── 2. surfaces ───────────────────────────────────────────────────────────
  // moss in the first clearing: the safest-feeling ground in the zone
  overlay(g, 'm', (t) => { t.blob(21, 20, 9, 5, '*', 41, 0.3); });
  overlay(g, 'm', (t) => { t.blob(35, 31, 5, 3, '*', 43, 0.3); });
  // leaf litter where the canopy is thickest
  overlay(g, 'l', (t) => { t.blob(23, 42, 9, 5, '*', 47, 0.28); });
  overlay(g, 'l', (t) => { t.blob(22, 70, 7, 5, '*', 53, 0.3); });
  overlay(g, 'l', (t) => { t.blob(22, 93, 8, 5, '*', 59, 0.28); });
  // The dell floor: dry rubble at the foot of the rock, softening to leaf
  // litter and moss further out, so it is not one flat brown field.
  overlay(g, 'd', (t) => { t.blob(9, 62, 8, 2, '*', 61, 0.35); });
  overlay(g, 'l', (t) => { t.blob(17, 65, 9, 3, '*', 63, 0.3); });
  overlay(g, 'm', (t) => { t.blob(6, 66, 5, 2, '*', 65, 0.35); });
  overlay(g, 'd', (t) => { t.rect(2, 82, 40, 2, '*'); t.rect(2, 87, 40, 2, '*'); });
  // the old terrace: cut stone, the shrine's architecture surfacing early
  overlay(g, 'S', (t) => { t.blob(22, 75, 8, 4, '*', 67, 0.16); });
  overlay(g, 'S', (t) => { t.blob(22, 102, 9, 4, '*', 71, 0.2); });

  // ── 3. the spine, and the trails off it ───────────────────────────────────
  overlay(g, 'p', (t) => {
    t.vLine(0, 14, 21, '*', 4);
    t.vLine(14, 27, 21, '*', 4);
    t.vLine(27, 37, 20, '*', 4);
    t.vLine(37, 48, 22, '*', 4);
    t.vLine(48, 64, 22, '*', 4);
    // the S-bend through the dell, which turns the player to face the cliff
    t.hLine(22, 14, 65, '*', 4);
    t.vLine(65, 68, 14, '*', 4);
    t.hLine(14, 22, 69, '*', 4);
    t.vLine(69, 83, 22, '*', 4);
    t.vLine(83, 89, 21, '*', 4);
    t.vLine(89, 99, 22, '*', 4);
    t.vLine(99, 108, 21, '*', 4);
  });
  // side trails are narrower and unpaved: "somewhere else", not "the way on"
  overlay(g, 'd', (t) => {
    t.hLine(24, 34, 30, '*', 2);
    t.hLine(27, 35, 74, '*', 2);
    t.hLine(13, 9, 82, '*', 2);
    t.vLine(82, 84, 9, '*', 2);
  });

  // ── 4. water ──────────────────────────────────────────────────────────────
  // The stream runs the full width and pinches at the ford, which is the only
  // reason the boulder is worth shoving.
  for (let x = 2; x < W - 2; x++) {
    const pinch = x >= 6 && x <= 12;
    for (let y = 84; y <= 86; y++) {
      if (pinch && y !== 85) { g.setIf(x, y, 'd', OPEN); continue; }
      g.set(x, y, '~');
    }
  }
  // the crossing on the spine
  g.rect(20, 84, 4, 3, 'p');
  // the ford: shallow enough to step on once there is something to step on.
  // Solid until the boulder goes in — the area script owns that collision.
  g.set(9, 85, '_');

  // ── 5. the cliff ──────────────────────────────────────────────────────────
  // Row 59 is the rock face, row 60 its foot. The gully at x=4 is the only way
  // through, and it is screened by cuttable bushes down in the dell.
  for (let x = 2; x <= 14; x++) {
    g.set(x, 59, 'K');
    g.set(x, 60, 'J');
  }
  g.set(2, 59, '('); g.set(2, 60, '[');
  g.set(3, 59, ')'); g.set(3, 60, ']');
  g.set(4, 59, 'd'); g.set(4, 60, 'd');
  g.set(5, 59, '('); g.set(5, 60, '[');
  g.set(14, 59, ')'); g.set(14, 60, ']');

  // ── 6. the shrine's flagstone, creeping up out of the ground ──────────────
  overlay(g, 'F', (t) => { t.blob(21, 111, 8, 5, '*', 73, 0.14); });
  overlay(g, 'F', (t) => { t.blob(21, 106, 5, 2, '*', 79, 0.4); });

  // ── 7. texture ────────────────────────────────────────────────────────────
  g.scatter(',', ['.'], 0.44, 83);
  g.scatter('"', ['.', ','], 0.11, 89);
  g.scatter(',', ['l'], 0.22, 97);

  const ground = g.rows();
  const dist = brambleDistance(g);
  const solidChar = (c: string) => c === '#' || c === '~' || c === 'K' || c === 'J'
    || c === '(' || c === ')' || c === '[' || c === ']';

  // ── 8. object layer ───────────────────────────────────────────────────────
  const o = new GridPainter(W, H, ' ');
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = g.get(x, y);
      const d = dist[y][x];

      // Trees stand IN the thicket, on its inner fringe, so the wall has a
      // silhouette and a canopy rather than being a flat green mass.
      if (c === '#') {
        if (d !== 0) continue;
        // distance from this thicket cell out to open ground
        let near = false;
        for (let j = -4; j <= 4 && !near; j++) {
          for (let i = -4; i <= 4 && !near; i++) {
            if (!solidChar(g.get(x + i, y + j)) && g.get(x + i, y + j) !== ' ') near = true;
          }
        }
        if (!near) continue;
        const r = h01(x, y, 101);
        if (y > 96 && r < 0.13) { o.set(x, y, 'Y'); continue; }
        if (r < 0.2) o.set(x, y, 'T');
        else if (r < 0.24) o.set(x, y, 'b');
        continue;
      }

      if (solidChar(c) || c === 'p' || c === '_') continue;

      // Undergrowth thins out as you move away from the thicket, so the middle
      // of every clearing stays clean enough to fight in.
      const r = h01(x, y, 211);
      if (d <= 1) {
        if (r < 0.3) o.set(x, y, 'f');
        else if (r < 0.42) o.set(x, y, 'b');
        else if (r < 0.46) o.set(x, y, 'k');
      } else if (d <= 3) {
        if (r < 0.1) o.set(x, y, 'f');
        else if (r < 0.15) o.set(x, y, 'r');
        else if (r < 0.17) o.set(x, y, 'g');
      } else if (r < 0.04) {
        o.set(x, y, 'r');
      }
    }
  }

  // Keep the fighting floor and the spine itself clear of clutter.
  const clearRing = (cx: number, cy: number, rx: number, ry: number) => {
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) o.setIf(x, y, ' ', ['f', 'b', 'r', 'g', 'k']);
    }
  };
  for (const e of ENCOUNTERS) {
    for (const [, sx, sy] of e.spawns) clearRing(sx, sy, 3, 3);
  }
  clearRing(21, 20, 6, 4);
  clearRing(23, 42, 6, 4);
  clearRing(22, 75, 6, 4);
  clearRing(22, 102, 7, 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g.get(x, y) === 'p') o.set(x, y, ' ');
    }
  }

  // ── 9. the canopy, over the player's head ─────────────────────────────────
  // The single best trick for depth, and the single easiest thing to overdo.
  // These sprites are up to four tiles wide, so the lattice is coarse and the
  // probabilities are low: the goal is a broken fringe the path runs *under*,
  // not a mat that turns the whole screen into one green texture. Anything that
  // hides the thicket also hides the difference between "wall" and "floor".
  const a = new GridPainter(W, H, ' ');
  for (let y = 4; y < H - 2; y += 3) {
    for (let x = 2; x < W - 2; x += 2) {
      const c = g.get(x, y);
      if (c === ' ') continue;
      const d = dist[y][x];
      if (d > 3) continue;
      if (inLightHole(x, y)) continue;
      const r = h01(x, y, 307);
      if (d === 0) {
        if (r < 0.28) a.set(x, y, r < 0.1 ? '4' : '3');
      } else if (d <= 2) {
        if (r < 0.18) a.set(x, y, r < 0.07 ? '3' : '2');
      } else if (r < 0.09) {
        a.set(x, y, '1');
      }
    }
  }
  // hanging vines where the canopy is heaviest
  for (let y = 26; y < 40; y += 3) {
    for (let x = 16; x < 28; x += 5) if (a.get(x, y) === ' ' && dist[y][x] <= 2) a.set(x, y, '6');
  }

  // ── 10. authored props ────────────────────────────────────────────────────
  const props: PropPlacement[] = [
    // — the gate: the last of the town's carpentry
    // Interaction ids are authored-dialogue exchange ids: the map declares
    // what a thing IS, and `src/data/dialogue` decides what it says.
    { key: 'prop/woods/signpost_woods', x: 24, y: 8, spec: { solid: [14, 8], interact: 'sign.woods' }, id: 'signpost' },
    { key: 'prop/woods/mossy_stone_2', x: 18, y: 13, spec: { interact: 'prop.woodsMilestone' } },
    // the first Echo-touched thing in the zone: Mote notices it, and so should you
    { key: 'prop/woods/standing_stone_0', x: 26, y: 10, spec: { solid: [14, 10], interact: 'carving.one' }, id: 'first_stone' },

    // — First Clearing: an arena you can read on entry
    { key: 'prop/woods/log_fallen_0', x: 15, y: 24, spec: { solid: [34, 8] } },
    { key: 'prop/woods/log_fallen_1', x: 28, y: 23, spec: { solid: [26, 8] } },
    { key: 'prop/woods/stump_0', x: 25, y: 17, spec: { solid: [14, 8] } },
    { key: 'prop/woods/mushroom_1', x: 13, y: 22, spec: {} },
    { key: 'prop/woods/mushroom_2', x: 12, y: 23, spec: {} },

    // — The Narrows
    { key: 'prop/woods/mist_0', x: 20, y: 29, spec: { anim: 'woods_mist', over: true } },
    { key: 'prop/woods/mist_0', x: 24, y: 35, spec: { anim: 'woods_mist', over: true } },

    // — ◆ toadstool ring
    { key: 'prop/woods/toadstool_ring', x: 35, y: 31, spec: { interact: 'woods.toadstools' }, id: 'toadstools' },
    { key: 'prop/woods/mushroom_3', x: 33, y: 29, spec: {} },
    { key: 'prop/woods/mushroom_3', x: 37, y: 33, spec: {} },
    { key: 'prop/woods/mushroom_0', x: 37, y: 29, spec: {} },
    { key: 'prop/woods/stump_1', x: 32, y: 33, spec: { solid: [12, 8] } },

    // — The Hollow: the boulder is the whole tactic of the encounter
    { key: 'prop/woods/boulder_0', x: 22, y: 42, spec: { solid: [26, 12] } },
    { key: 'prop/woods/log_fallen_2', x: 16, y: 47, spec: { solid: [40, 8] } },
    { key: 'prop/woods/tree_hollow', x: 30, y: 39, spec: { solid: [16, 8], interact: 'woods.hollow' }, id: 'hollow_oak' },
    { key: 'prop/woods/mist_0', x: 18, y: 45, spec: { anim: 'woods_mist', over: true } },
    { key: 'prop/woods/branch_pile', x: 27, y: 46, spec: {} },

    // — the plateau: the prize, and the thing guarding it
    { key: 'prop/woods/chest_wood_closed', x: 9, y: 57, spec: { solid: [20, 8], interact: 'woods_chest' }, id: 'woods_chest' },
    { key: 'prop/woods/mushroom_3', x: 7, y: 57, spec: {} },
    { key: 'prop/woods/mushroom_3', x: 11, y: 56, spec: {} },
    { key: 'prop/woods/boulder_1', x: 12, y: 51, spec: { solid: [22, 10] } },
    { key: 'prop/woods/tree_dead_0', x: 6, y: 50, spec: { solid: [14, 8] } },
    { key: 'prop/woods/bones_0', x: 11, y: 54, spec: {} },

    // — The Dell: read the cliff, find the gully
    { key: 'prop/woods/mushroom_3', x: 6, y: 62, spec: {} },
    { key: 'prop/woods/mushroom_3', x: 7, y: 63, spec: {} },
    { key: 'prop/woods/rock_0', x: 8, y: 62, spec: {} },
    { key: 'prop/woods/mossy_stone_0', x: 12, y: 62, spec: {} },
    { key: 'prop/woods/mist_0', x: 17, y: 66, spec: { anim: 'woods_mist', over: true } },
    { key: 'prop/woods/old_cart_broken', x: 20, y: 62, spec: { solid: [40, 10] } },

    // — The Broken Terrace
    { key: 'prop/woods/broken_column_0', x: 17, y: 71, spec: { solid: [14, 10] } },
    { key: 'prop/woods/broken_column_1', x: 27, y: 71, spec: { solid: [14, 10] } },
    { key: 'prop/woods/broken_column_2', x: 18, y: 79, spec: { solid: [20, 8] } },
    { key: 'prop/woods/broken_column_0', x: 26, y: 79, spec: { solid: [14, 10] } },
    { key: 'prop/woods/vine_0', x: 17, y: 74, spec: { over: true } },

    // — ◆ the carved stone
    { key: 'prop/woods/standing_stone_1', x: 34, y: 73, spec: { solid: [12, 8] } },
    { key: 'prop/woods/standing_stone_2', x: 36, y: 75, spec: { solid: [16, 10], interact: 'carving.thirtysix' }, id: 'carving' },
    { key: 'prop/woods/standing_stone_0', x: 38, y: 73, spec: { solid: [12, 8] } },
    { key: 'prop/woods/mushroom_3', x: 34, y: 76, spec: {} },

    // — the stream
    { key: 'prop/woods/boulder_1', x: 9, y: 84, spec: { interact: 'woods_boulder' }, id: 'ford_boulder' },
    { key: 'prop/woods/mossy_stone_1', x: 19, y: 83, spec: {} },
    { key: 'prop/woods/mossy_stone_2', x: 24, y: 87, spec: {} },
    { key: 'prop/woods/log_fallen_2', x: 26, y: 83, spec: { solid: [40, 8], interact: 'woods.bridge' } },
    { key: 'prop/woods/mist_0', x: 14, y: 85, spec: { anim: 'woods_mist', over: true } },
    { key: 'prop/woods/mist_0', x: 30, y: 85, spec: { anim: 'woods_mist', over: true } },

    // — ◆ the old campsite on the island
    { key: 'prop/woods/campfire_out', x: 8, y: 90, spec: { interact: 'prop.woodsGate' }, id: 'campsite' },
    { key: 'prop/woods/old_cart_broken', x: 10, y: 92, spec: { solid: [36, 10], interact: 'woods.deeper' } },
    { key: 'prop/woods/branch_pile', x: 10, y: 91, spec: {} },
    { key: 'prop/woods/bones_1', x: 6, y: 91, spec: {} },
    { key: 'prop/woods/mushroom_3', x: 11, y: 89, spec: {} },
    { key: 'prop/woods/stump_0', x: 6, y: 88, spec: { solid: [14, 8] } },
    { key: 'prop/woods/spider_web_0', x: 5, y: 92, spec: { over: true } },

    // — South Bank
    { key: 'prop/woods/log_fallen_0', x: 29, y: 96, spec: { solid: [34, 8] } },
    { key: 'prop/woods/tree_hollow', x: 15, y: 96, spec: { solid: [16, 8] } },

    // — The Standing Stones: the woods hand over to the shrine
    { key: 'prop/woods/standing_stone_0', x: 16, y: 99, spec: { solid: [12, 8] } },
    { key: 'prop/woods/standing_stone_1', x: 28, y: 99, spec: { solid: [12, 8] } },
    { key: 'prop/woods/standing_stone_2', x: 15, y: 104, spec: { solid: [16, 10] } },
    { key: 'prop/woods/standing_stone_0', x: 29, y: 104, spec: { solid: [12, 8] } },
    { key: 'prop/shrine_ext/standing_stone_1', x: 18, y: 107, spec: { solid: [12, 8] } },
    { key: 'prop/shrine_ext/standing_stone_2', x: 25, y: 107, spec: { solid: [12, 8] } },
    { key: 'prop/woods/tree_dead_1', x: 12, y: 101, spec: { solid: [14, 8] } },
    { key: 'prop/woods/tree_dead_2', x: 32, y: 102, spec: { solid: [14, 8] } },

    // — shrine approach
    { key: 'prop/shrine_ext/column_broken_0', x: 17, y: 111, spec: { solid: [16, 10] } },
    { key: 'prop/shrine_ext/column_broken_1', x: 25, y: 111, spec: { solid: [16, 10] } },
    { key: 'prop/woods/signpost_woods', x: 17, y: 107, spec: { solid: [14, 8], interact: 'sign.shrineRoad' } },
    { key: 'prop/shrine_ext/rubble_0', x: 19, y: 109, spec: {} },
    { key: 'prop/shrine_ext/rubble_1', x: 24, y: 110, spec: {} },
    { key: 'prop/shrine_ext/arch', x: 21, y: 113, spec: { solid: [16, 8] }, id: 'shrine_arch' },
    { key: 'prop/woods/mist_0', x: 21, y: 112, spec: { anim: 'woods_mist', over: true } },
  ];

  // Cuttable bushes screening the gully. Authored here so the map still reads
  // correctly in a static screenshot; the area script gives them collision and
  // takes them away when they are cut.
  for (const x of [3, 4, 5]) {
    props.push({ key: `prop/woods/cuttable_bush_${x - 3}`, x, y: 61, spec: {}, id: `gully_bush_${x}` });
  }
  for (const [x, y] of LANTERNS) {
    props.push({ key: 'prop/woods/lantern_post_0', x, y, spec: { anim: 'lantern_post' } });
  }

  // ── 11. lights ────────────────────────────────────────────────────────────
  const lantern = (x: number, y: number): LightDef =>
    ({ x, y: y - 1, radius: 54, color: 0xffb937, intensity: 0.5, flicker: 0.55 });
  const spore = (x: number, y: number, r = 30): LightDef =>
    ({ x, y, radius: r, color: 0x8ce6e6, intensity: 0.4, flicker: 0.18 });

  const lights: LightDef[] = [
    ...LANTERNS.map(([x, y]) => lantern(x, y)),
    // the secrets announce themselves with colour, not with a marker
    spore(35, 31, 46),
    spore(6, 62, 34), spore(7, 63, 26),
    spore(34, 76, 26),
    spore(9, 90, 34),
    // the chest is lit so it reads as a prize from the far side of a cliff
    { x: 9, y: 57, radius: 40, color: 0xf2ca5e, intensity: 0.55, flicker: 0.25 },
    // and the shrine is the only violet in the zone
    { x: 21, y: 113, radius: 76, color: 0xa681e6, intensity: 0.5, flicker: 0.3 },
    { x: 21, y: 109, radius: 54, color: 0xa681e6, intensity: 0.28, flicker: 0.35 },
  ];

  // ── 12. zones ─────────────────────────────────────────────────────────────
  const zones: Zone[] = [
    { kind: 'door', id: 'to_town', x: 19, y: 0, w: 6, h: 2, to: 'lumen_vale', spawn: 'south', facing: 'n' },
    { kind: 'trigger', id: 'woods_arrive', x: 17, y: 9, w: 10, h: 2 },
    { kind: 'trigger', id: 'woods_narrows', x: 17, y: 33, w: 8, h: 2 },
    { kind: 'trigger', id: 'woods_dell', x: 12, y: 63, w: 14, h: 2 },
    { kind: 'trigger', id: 'to_shrine', x: 17, y: 110, w: 10, h: 2 },
    { kind: 'camera', id: 'bounds', x: 0, y: 0, w: W, h: H },
  ];
  for (const e of ENCOUNTERS) {
    zones.push({ kind: 'trigger', id: e.id, x: e.zone[0], y: e.zone[1], w: e.zone[2], h: e.zone[3] });
  }

  return {
    id: 'woods',
    name: 'Whisper Woods',
    subtitle: 'the road south',
    music: 'woods',
    ambience: 'woods',
    darkness: 0.3,

    ground,
    legend: {
      '.': { base: 'woods/grass' },
      ',': { base: 'woods/grass', scatter: 'undergrowth' },
      '"': { base: 'woods/grass', scatter: 'lush' },
      'l': { base: 'woods/leaflitter' },
      'm': { base: 'woods/grass', blob: 'woods_moss' },
      'd': { base: 'woods/soil' },
      'p': { base: 'woods/grass', blob: 'woods_path' },
      'S': { base: 'woods/shrine_stone' },
      'F': { base: 'shrine_ext/flag' },
      '#': { base: 'woods/grass', blob: 'woods_bramble', solid: true },
      '~': { base: 'woods/grass', blob: 'woods_water', solid: true },
      '_': { base: 'woods/grass', blob: 'woods_water' },
      'K': { base: 'woods/cliff_face', solid: true },
      'J': { base: 'woods/cliff_base', solid: true },
      '(': { base: 'woods/cliff_face_l', solid: true },
      ')': { base: 'woods/cliff_face_r', solid: true },
      '[': { base: 'woods/cliff_base_l', solid: true },
      ']': { base: 'woods/cliff_base_r', solid: true },
    },

    scatterRules: {
      undergrowth: {
        density: 0.5,
        tiles: [['scatter/tuft_sm', 5], ['scatter/tuft_md', 4], ['scatter/pebbles', 2], ['', 5]],
      },
      lush: {
        density: 0.85,
        tiles: [['scatter/tuft_md', 4], ['scatter/tuft_lg', 4], ['scatter/flower_white', 2], ['scatter/flower_violet', 2]],
      },
    },

    objects: o.rows(),
    above: a.rows(),
    objectLegend: {
      'T': { key: ['prop/woods/tree_dark_0', 'prop/woods/tree_dark_1', 'prop/woods/tree_dark_2', 'prop/woods/tree_dark_3'], solid: [18, 10], sway: 0.18 },
      'Y': { key: ['prop/woods/tree_dead_0', 'prop/woods/tree_dead_1', 'prop/woods/tree_dead_2'], solid: [14, 8] },
      'b': { key: ['prop/woods/bush_0', 'prop/woods/bush_1', 'prop/woods/bush_2', 'prop/woods/bush_3'], sway: 0.4 },
      'f': { key: ['prop/woods/fern_0', 'prop/woods/fern_1', 'prop/woods/fern_2', 'prop/woods/fern_3'], sway: 0.5 },
      'r': { key: ['prop/woods/rock_0', 'prop/woods/rock_1', 'prop/woods/rock_2', 'prop/woods/rock_3'] },
      'k': { key: ['prop/woods/mossy_stone_0', 'prop/woods/mossy_stone_1', 'prop/woods/mossy_stone_2'] },
      'g': { key: ['prop/woods/branch_pile', 'prop/woods/log_fallen_1'] },
      // over-layer
      '1': { key: 'prop/woods/canopy_0', sway: 0.22 },
      '2': { key: 'prop/woods/canopy_1', sway: 0.22 },
      '3': { key: 'prop/woods/canopy_2', sway: 0.18 },
      '4': { key: 'prop/woods/canopy_3', sway: 0.15 },
      '6': { key: ['prop/woods/vine_0', 'prop/woods/vine_1', 'prop/woods/vine_2'], sway: 0.35 },
    },

    props,
    lights,
    zones,
    spawns: {
      default: { x: 21, y: 6, facing: 's' },
      north: { x: 21, y: 6, facing: 's' },
      town_gate: { x: 21, y: 6, facing: 's' },
      shrine: { x: 21, y: 108, facing: 'n' },
      dell: { x: 20, y: 65, facing: 's' },
      // Backstop for GameFlow when no encounter checkpoint has been marked yet.
      respawn: { x: 21, y: 12, facing: 's' },
    },
  };
}

registerMap('woods', buildWoods);
