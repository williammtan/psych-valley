/**
 * FIGURE-GROUND CONTRAST GATE for the Echo Shrine.
 *
 *   npx tsx tools/art/contrast_check.ts
 *
 * WHY THIS EXISTS
 * ───────────────
 * A dungeon fails the moment the player cannot separate "thing I can act on"
 * from "thing I walk over". That failure is measurable, so it should be a build
 * gate rather than a matter of taste. The rule this file enforces is the
 * rendering contract every interactive shrine prop must satisfy:
 *
 *   (a) ANCHOR   — the prop contains pixels DARKER than the darkest floor pixel
 *                  (a near-black outline or a hard contact shadow).
 *   (b) RIM      — the prop contains pixels BRIGHTER than the brightest floor
 *                  pixel (a top-lit rim or specular highlight).
 *   (c) RATIO    — the prop's mean Rec.709 luminance is at least 3x the mean of
 *                  the shrine floor family it stands on.
 *
 * (a) and (b) together are the ALTTP property: the Armos spans L 65..254 while
 * its floor spans only L 101..136, so the sprite pokes out of the floor's
 * luminance envelope at BOTH ends. (c) is the coarse "is it even a different
 * value" test that our first pass failed at 1.02:1.
 *
 * Measurement is done on the generated art, not on a screenshot: the same
 * modules the packer runs are registered into a throwaway ArtBuild and read
 * back by name. Screenshots move with lighting; the contract is about the art.
 */
import { ArtBuild } from './lib/registry.js';
import { Surface } from './lib/pixel.js';
import { registerShrine } from './assets/shrine.js';
import { registerEnemies } from './assets/enemies.js';

// ── luminance ──────────────────────────────────────────────────────────────

/** Rec.709 luminance of one RGB triple, 0..255. */
function lum(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

interface Stats { mean: number; min: number; max: number; n: number }

/**
 * Luminance statistics over the *opaque* pixels of a surface.
 *
 * Partially transparent pixels are weighted by their alpha, because a 30%-alpha
 * contact shadow really does only darken the floor by 30% of the way — counting
 * it as a solid black pixel would let a prop pass the ANCHOR test on a shadow
 * far too faint to see.
 */
function stats(s: Surface, alphaFloor = 0.5): Stats {
  let sum = 0, n = 0, min = 255, max = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const c = s.get(x, y);
      const a = c[3] / 255;
      if (a < alphaFloor) continue;
      // composite against the floor mean is not knowable here, so a partially
      // transparent pixel is measured at its own colour, scaled by coverage
      // toward mid-dark. Alpha >= alphaFloor keeps this honest.
      const l = lum(c[0], c[1], c[2]) * a + 45 * (1 - a);
      sum += l; n += 1;
      if (l < min) min = l;
      if (l > max) max = l;
    }
  }
  if (!n) return { mean: 0, min: 0, max: 0, n: 0 };
  return { mean: sum / n, min, max, n };
}

/** Merge several surfaces' statistics into one envelope (used for families). */
function merge(all: Stats[]): Stats {
  let sum = 0, n = 0, min = 255, max = 0;
  for (const s of all) {
    if (!s.n) continue;
    sum += s.mean * s.n; n += s.n;
    min = Math.min(min, s.min); max = Math.max(max, s.max);
  }
  return n ? { mean: sum / n, min, max, n } : { mean: 0, min: 0, max: 0, n: 0 };
}

// ── the contract ───────────────────────────────────────────────────────────

/** Minimum mean-luminance ratio of an interactive prop against its floor. */
const MIN_RATIO = 3.0;

/**
 * Every interactive object in the seven shrine rooms, by the name the runtime
 * asks for. `states` are the sprite names to test; ALL of them must pass,
 * because a puzzle object is just as often seen in its dead state as its live
 * one and the dead state is the one that used to disappear.
 */
const INTERACTIVE: Array<{ label: string; room: string; names: string[] }> = [
  { label: 'sequence slab (dim)', room: 'memory', names: ['tile/shrine/rune_floor_dim_0', 'tile/shrine/rune_floor_dim_1', 'tile/shrine/rune_floor_dim_2', 'tile/shrine/rune_floor_dim_3'] },
  { label: 'sequence slab (lit)', room: 'memory', names: ['tile/shrine/rune_floor_0', 'tile/shrine/rune_floor_1', 'tile/shrine/rune_floor_2', 'tile/shrine/rune_floor_3'] },
  { label: 'rune pillar (dim)', room: 'memory', names: ['prop/shrine/rune_pillar_dim_0', 'prop/shrine/rune_pillar_dim_1', 'prop/shrine/rune_pillar_dim_2', 'prop/shrine/rune_pillar_dim_3'] },
  { label: 'rune pillar (lit)', room: 'memory', names: ['prop/shrine/rune_pillar_0', 'prop/shrine/rune_pillar_1', 'prop/shrine/rune_pillar_2', 'prop/shrine/rune_pillar_3'] },
  { label: 'switch-node (off)', room: 'combination', names: ['prop/shrine/switch_off'] },
  { label: 'switch-node (on)', room: 'combination', names: ['prop/shrine/switch_on'] },
  { label: 'lever', room: 'combination', names: ['prop/shrine/lever_l', 'prop/shrine/lever_r'] },
  { label: 'pressure plate', room: 'association', names: ['prop/shrine/plate_up', 'prop/shrine/plate_down'] },
  { label: 'statue (plain)', room: 'conformity', names: ['prop/shrine/statue_s', 'prop/shrine/statue_n', 'prop/shrine/statue_e', 'prop/shrine/statue_w'] },
  { label: 'statue (lit)', room: 'conformity', names: ['prop/shrine/statue_lit_s', 'prop/shrine/statue_lit_n', 'prop/shrine/statue_lit_e', 'prop/shrine/statue_lit_w'] },
  { label: 'statue (leader)', room: 'conformity', names: ['prop/shrine/statue_leader_s', 'prop/shrine/statue_leader_n', 'prop/shrine/statue_leader_e', 'prop/shrine/statue_leader_w'] },
  { label: 'push block', room: 'conformity', names: ['prop/shrine/block_push'] },
  { label: 'coffer (closed)', room: 'association', names: ['prop/shrine/chest_closed'] },
  { label: 'coffer (open)', room: 'association', names: ['prop/shrine/chest_open'] },
  { label: 'moth jar', room: 'association', names: ['prop/shrine/moth_jar'] },
  { label: 'crystal', room: 'all', names: ['prop/shrine/crystal_0', 'prop/shrine/crystal_2'] },
  { label: 'brazier', room: 'all', names: ['prop/shrine/brazier_0', 'prop/shrine/brazier_2'] },
  { label: 'echo pool', room: 'memory', names: ['prop/shrine/echo_pool_0', 'prop/shrine/echo_pool_2'] },
  { label: 'gate (closed)', room: 'all', names: ['prop/shrine/gate_closed'] },
  { label: 'gate (open)', room: 'all', names: ['prop/shrine/gate_open'] },
  { label: 'door (closed)', room: 'all', names: ['prop/shrine/door_closed'] },
  { label: 'door (locked)', room: 'all', names: ['prop/shrine/door_locked'] },
  { label: 'door (open)', room: 'all', names: ['prop/shrine/door_open'] },
  { label: 'boss seal', room: 'boss', names: ['prop/shrine/boss_seal_0', 'prop/shrine/boss_seal_2'] },
];

/**
 * Scenery. Not gated — a pillar SHOULD sit closer to the floor's value than a
 * switch does — but printed, because the day a statue measures the same as a
 * broken instrument is the day the room stops telling the player anything.
 */
const SCENERY: Array<{ label: string; names: string[] }> = [
  { label: 'pillar', names: ['prop/shrine/pillar_0', 'prop/shrine/pillar_1', 'prop/shrine/pillar_2'] },
  { label: 'rubble', names: ['prop/shrine/rubble_0', 'prop/shrine/rubble_1', 'prop/shrine/rubble_2'] },
  { label: 'root', names: ['prop/shrine/root_0', 'prop/shrine/root_1', 'prop/shrine/root_2'] },
  { label: 'broken instrument', names: ['prop/shrine/broken_instrument_0', 'prop/shrine/broken_instrument_1', 'prop/shrine/broken_instrument_2'] },
];

/** Enemies live in enemies.ts, which this pass does not own — informational. */
const ENEMIES: Array<{ label: string; prefix: string }> = [
  { label: 'bramble', prefix: 'enemy/bramble/walk_s_' },
  { label: 'wisp', prefix: 'enemy/wisp/idle_s_' },
  { label: 'mimic', prefix: 'enemy/mimic/idle_s_' },
];

// ── run ────────────────────────────────────────────────────────────────────

const b = new ArtBuild();
registerShrine(b);
try { registerEnemies(b); } catch { /* enemies are informational only */ }

const byName = new Map<string, Surface>();
for (const t of b.tiles) byName.set(t.name, t.s);
for (const s of b.sprites) byName.set(s.name, s.s);

function group(names: string[]): { st: Stats; missing: string[] } {
  const missing: string[] = [];
  const all: Stats[] = [];
  for (const n of names) {
    const s = byName.get(n);
    if (!s) { missing.push(n); continue; }
    all.push(stats(s));
  }
  return { st: merge(all), missing };
}

// The ground truth every prop is measured against: the shrine floor family the
// rooms are actually paved with, including its cracked and rubbled variants.
const FLOOR_NAMES: string[] = [];
for (let i = 0; i < 6; i++) FLOOR_NAMES.push(`tile/shrine/floor_${i}`);
for (let i = 0; i < 3; i++) FLOOR_NAMES.push(`tile/shrine/floor_cracked_${i}`);
for (let i = 0; i < 3; i++) FLOOR_NAMES.push(`tile/shrine/floor_rubble_${i}`);
const floor = group(FLOOR_NAMES).st;

const VOID_NAMES = ['tile/shrine/wall_top_cap', 'tile/shrine/wall_top_cap_1', 'tile/shrine/wall_top_cap_2'];
const voidStats = group(VOID_NAMES).st;
const faceStats = group(['tile/shrine/wall_top_n', 'tile/shrine/wall_top_n_1', 'tile/shrine/wall_top_n_2', 'tile/shrine/wall_top_n_3']).st;
const sideStats = group(['tile/shrine/wall_w', 'tile/shrine/wall_e', 'tile/shrine/wall_s']).st;

const f1 = (n: number) => n.toFixed(1);
const pad = (s: string, n: number) => s.padEnd(n);
const rpad = (s: string, n: number) => s.padStart(n);

console.log('\n  ECHO SHRINE — figure-ground contrast gate');
console.log('  ' + '─'.repeat(76));
console.log(
  `  floor family     mean L ${f1(floor.mean)}   envelope L ${f1(floor.min)}..${f1(floor.max)}`,
);
console.log(
  `  out-of-bounds    mean L ${f1(voidStats.mean)}   (must be darker than every floor pixel)`,
);
console.log(
  `  wall face        mean L ${f1(faceStats.mean)}   side walls mean L ${f1(sideStats.mean)}`,
);
console.log('  ' + '─'.repeat(76));

interface Row { label: string; room: string; st: Stats; ratio: number; anchor: boolean; rim: boolean; ok: boolean; missing: string[] }

const rows: Row[] = [];
for (const item of INTERACTIVE) {
  const { st, missing } = group(item.names);
  const ratio = floor.mean > 0 ? st.mean / floor.mean : 0;
  const anchor = st.min < floor.min;
  const rim = st.max > floor.max;
  rows.push({
    label: item.label, room: item.room, st, ratio, anchor, rim,
    ok: ratio >= MIN_RATIO && anchor && rim && missing.length === 0,
    missing,
  });
}

console.log(
  `  ${pad('interactive prop', 22)}${pad('room', 13)}${rpad('mean L', 8)}` +
  `${rpad('min', 7)}${rpad('max', 7)}${rpad('ratio', 8)}  anchor rim`,
);
for (const r of rows) {
  console.log(
    `  ${r.ok ? ' ' : '!'} ${pad(r.label, 20)}${pad(r.room, 13)}${rpad(f1(r.st.mean), 8)}` +
    `${rpad(f1(r.st.min), 7)}${rpad(f1(r.st.max), 7)}${rpad(f1(r.ratio) + ':1', 8)}` +
    `${rpad(r.anchor ? 'yes' : 'NO', 8)}${rpad(r.rim ? 'yes' : 'NO', 5)}`,
  );
}

console.log('  ' + '─'.repeat(76));
console.log(`  ${pad('scenery (not gated)', 22)}${pad('', 13)}${rpad('mean L', 8)}${rpad('ratio', 22)}`);
for (const item of SCENERY) {
  const { st } = group(item.names);
  console.log(
    `    ${pad(item.label, 20)}${pad('', 13)}${rpad(f1(st.mean), 8)}` +
    `${rpad(f1(floor.mean > 0 ? st.mean / floor.mean : 0) + ':1', 22)}`,
  );
}

const enemyRows: Array<[string, Stats]> = [];
for (const e of ENEMIES) {
  const names = [...byName.keys()].filter((n) => n.startsWith(e.prefix));
  if (!names.length) continue;
  enemyRows.push([e.label, group(names).st]);
}
if (enemyRows.length) {
  console.log('  ' + '─'.repeat(76));
  console.log(`  ${pad('enemies (informational — enemies.ts is not owned by this pass)', 43)}${rpad('mean L', 8)}${rpad('ratio', 22)}`);
  for (const [label, st] of enemyRows) {
    console.log(
      `    ${pad(label, 20)}${pad('', 13)}${rpad(f1(st.mean), 8)}` +
      `${rpad(f1(floor.mean > 0 ? st.mean / floor.mean : 0) + ':1', 22)}`,
    );
  }
}

// ── verdict ────────────────────────────────────────────────────────────────

const failures = rows.filter((r) => !r.ok);
const voidFail = voidStats.max >= floor.min;

console.log('  ' + '─'.repeat(76));
if (voidFail) {
  console.log(
    `  FAIL  out-of-bounds is not below the floor: void max L ${f1(voidStats.max)} ` +
    `>= floor min L ${f1(floor.min)}`,
  );
}
if (failures.length) {
  console.log(`  FAIL  ${failures.length} interactive prop(s) break the rendering contract:\n`);
  for (const r of failures) {
    const why: string[] = [];
    if (r.missing.length) why.push(`missing sprite(s): ${r.missing.join(', ')}`);
    if (r.ratio < MIN_RATIO) why.push(`ratio ${f1(r.ratio)}:1 < ${MIN_RATIO}:1`);
    if (!r.anchor) why.push(`no pixel darker than floor min (L ${f1(floor.min)})`);
    if (!r.rim) why.push(`no pixel brighter than floor max (L ${f1(floor.max)})`);
    console.log(`    ${pad(r.label, 22)} ${why.join('; ')}`);
  }
  console.log('');
}
if (!failures.length && !voidFail) {
  console.log(`  PASS  ${rows.length} interactive props clear ${MIN_RATIO}:1 + anchor + rim.\n`);
} else {
  process.exitCode = 1;
}
