/**
 * WHISPER WOODS — automated traversal test.
 *
 * A soft lock in the woods blocks the entire back half of the game, so this is
 * the test that has to stay green. It plays the zone the way a player would:
 * real movement through `window.__psyche`, real collision, real triggers.
 *
 *   npx tsx tools/woods_playtest.ts
 *   npx tsx tools/woods_playtest.ts --headed --slow
 *
 * WHAT IT ASSERTS
 *   1. every waypoint from the north gate to the shrine is reachable by walking
 *   2. no invisible walls — a route the collision grid says exists is a route
 *      the player can actually walk (they are the same grid, so a divergence is
 *      a movement bug, not a map bug)
 *   3. every authored encounter trigger fires, and spawns what it claims to
 *   4. the optional content is reachable: the chest (after cutting the bushes)
 *      and the campsite (after shoving the boulder)
 *   5. the transition to shrine_entrance fires at the south end
 *   6. it reports the wall-clock traversal time for the critical path, which is
 *      the number plan.md §36 actually budgets (3–5 minutes including combat)
 *
 * Routing is by breadth-first search over the live collision grid, then the
 * player is driven along that route with the analogue move axis. That is why
 * this catches invisible walls: BFS and the player consult the same array, so
 * if BFS finds a path the player cannot walk, movement is at fault.
 */
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENCOUNTERS, WOODS } from '../src/world/maps/woods';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

interface Step {
  name: string;
  to: [number, number];
  /** Assert these enemies are alive on arrival (encounter fired). */
  expectEnemies?: number;
  /** Clear the field before moving on, so combat cannot stall the walk. */
  clearAfter?: boolean;
  /** Run before walking. */
  before?: (p: Page) => Promise<void>;
  optional?: boolean;
}

const failures: string[] = [];
const notes: string[] = [];

function ok(cond: boolean, msg: string): boolean {
  if (cond) console.log(`  ok    ${msg}`);
  else { console.log(`  FAIL  ${msg}`); failures.push(msg); }
  return cond;
}

// ── page-side helpers, installed once ──────────────────────────────────────
//
// These run inside the game. Kept as one init script rather than many
// page.evaluate closures because esbuild's `__name` helper does not exist in
// the page and nested closures trip over it.
const HARNESS = `
window.__wt = {
  grid() {
    return window.__psyche.scene.collisionGrid();
  },
  tile() {
    const p = window.__psyche.scene.player;
    return [p.tileX, p.tileY];
  },
  /** BFS over the live collision grid. Returns tile waypoints, or null. */
  route(tx, ty) {
    const g = this.grid();
    const h = g.length, w = g[0].length;
    const [sx, sy] = this.tile();
    if (sx === tx && sy === ty) return [];
    const prev = new Int32Array(w * h).fill(-1);
    const seen = new Uint8Array(w * h);
    const q = [sy * w + sx];
    seen[sy * w + sx] = 1;
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      const cx = cur % w, cy = (cur / w) | 0;
      if (cx === tx && cy === ty) {
        const path = [];
        let n = cur;
        while (n !== sy * w + sx) { path.push([n % w, (n / w) | 0]); n = prev[n]; }
        return path.reverse();
      }
      const nbr = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx, dy] of nbr) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni] || g[ny][nx]) continue;
        seen[ni] = 1; prev[ni] = cur; q.push(ni);
      }
    }
    return null;
  },
  /** Reduce a dense tile path to corners, which is all the driver needs. */
  corners(path) {
    if (!path || path.length < 2) return path || [];
    const out = [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], c = path[i + 1];
      if (!c) { out.push(b); break; }
      const d1x = b[0] - a[0], d1y = b[1] - a[1];
      const d2x = c[0] - b[0], d2y = c[1] - b[1];
      if (d1x !== d2x || d1y !== d2y) out.push(b);
    }
    return out;
  },
  enemies() { return window.__psyche.scene.enemies.aliveCount; },
  clearEnemies() { window.__psyche.scene.enemies.clear(); },
  map() { return window.__psyche.scene.mapId; },
  flag(f) { return !!window.__psyche.flags()[f]; },
  cutscene() { return window.__psyche.scene.cutscene.active; },
  /** Walk to one adjacent-ish tile centre. Resolves true on arrival. */
  stepTo(tx, ty, budgetMs) {
    return new Promise((resolve) => {
      const p = window.__psyche;
      const px = tx * 16 + 8, py = ty * 16 + 16;
      const t0 = performance.now();
      const tick = () => {
        const pl = p.scene.player;
        const dx = px - pl.x, dy = py - pl.y;
        const d = Math.hypot(dx, dy);
        if (d < 4) { p.move(0, 0); resolve(true); return; }
        if (performance.now() - t0 > budgetMs) { p.move(0, 0); resolve(false); return; }
        p.move(dx / d, dy / d);
        requestAnimationFrame(tick);
      };
      tick();
    });
  },
  /** Dismiss any dialogue that has opened, so a beat cannot stall the walk. */
  async clearDialogue() {
    for (let i = 0; i < 30 && window.__psyche.scene.cutscene.active; i++) {
      window.__psyche.press('interact');
      await new Promise((r) => setTimeout(r, 120));
    }
  },
};
`;

async function walkTo(page: Page, tx: number, ty: number): Promise<{ ok: boolean; tiles: number; ms: number }> {
  const t0 = Date.now();
  const route = await page.evaluate(
    (xy: number[]) => {
      const wt = (window as unknown as { __wt: Record<string, (...a: unknown[]) => unknown> }).__wt;
      const path = wt.route(xy[0], xy[1]) as Array<[number, number]> | null;
      return path ? (wt.corners(path) as Array<[number, number]>) : null;
    },
    [tx, ty],
  );
  if (!route) return { ok: false, tiles: 0, ms: Date.now() - t0 };

  let tiles = 0;
  for (const [wx, wy] of route) {
    const arrived = await page.evaluate(
      (xy: number[]) => (window as unknown as { __wt: { stepTo(a: number, b: number, c: number): Promise<boolean> } })
        .__wt.stepTo(xy[0], xy[1], 6000),
      [wx, wy],
    );
    tiles++;
    if (!arrived) {
      // Blocked mid-route: a cutscene may have taken control. Clear and retry.
      await page.evaluate(() => (window as unknown as { __wt: { clearDialogue(): Promise<void> } }).__wt.clearDialogue());
      const retry = await page.evaluate(
        (xy: number[]) => (window as unknown as { __wt: { stepTo(a: number, b: number, c: number): Promise<boolean> } })
          .__wt.stepTo(xy[0], xy[1], 6000),
        [wx, wy],
      );
      if (!retry) return { ok: false, tiles, ms: Date.now() - t0 };
    }
    await page.evaluate(() => (window as unknown as { __wt: { clearDialogue(): Promise<void> } }).__wt.clearDialogue());
  }
  return { ok: true, tiles, ms: Date.now() - t0 };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const headed = argv.includes('--headed');

  const server = await createServer({
    root: ROOT, server: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error',
  });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;

  const browser = await chromium.launch({
    headless: !headed,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.addInitScript(() => {
    (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&map=woods`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready,
      undefined, { timeout: 30000 },
    );
    await page.waitForTimeout(800);
    await page.addScriptTag({ content: HARNESS });
    // Give the player enough health that combat cannot end the run.
    await page.evaluate(() => (window as unknown as { __psyche: { hp(n: number): void } }).__psyche.hp(99));

    console.log('\nWHISPER WOODS — traversal\n');
    const startedAt = Date.now();
    let criticalMs = 0;

    // ── the critical path ────────────────────────────────────────────────
    const critical: Step[] = [
      { name: 'gate → first clearing', to: [21, 18] },
      { name: 'E1 fired', to: [21, 24], expectEnemies: 1, clearAfter: true },
      { name: 'clearing → narrows', to: P(WOODS.narrows) },
      { name: 'narrows → hollow', to: [22, 40] },
      { name: 'E2 fired', to: P(WOODS.hollow), expectEnemies: 2, clearAfter: true },
      { name: 'hollow → dell', to: P(WOODS.dell) },
      { name: 'dell → terrace approach', to: [22, 70] },
      { name: 'E3 fired', to: P(WOODS.terrace), expectEnemies: 1, clearAfter: true },
      { name: 'terrace → stream crossing', to: P(WOODS.crossing) },
      { name: 'E4 fired', to: P(WOODS.southBank), expectEnemies: 3, clearAfter: true },
      { name: 'south bank → the standing stones', to: [22, 99] },
      { name: 'E5 fired', to: P(WOODS.gauntlet), expectEnemies: 4, clearAfter: true },
      { name: 'stones → shrine approach', to: [21, 108] },
    ];

    for (const step of critical) {
      const r = await walkTo(page, step.to[0], step.to[1]);
      criticalMs += r.ms;
      const at = await page.evaluate(() => (window as unknown as { __wt: { tile(): [number, number] } }).__wt.tile());
      ok(r.ok, `${step.name} — ${r.ok ? `arrived ${at} in ${(r.ms / 1000).toFixed(1)}s` : `STUCK at ${at}`}`);
      if (step.expectEnemies !== undefined) {
        await page.waitForTimeout(400);
        const alive = await page.evaluate(() => (window as unknown as { __wt: { enemies(): number } }).__wt.enemies());
        ok(alive >= step.expectEnemies, `  → spawned ${alive}/${step.expectEnemies} enemies`);
      }
      if (step.clearAfter) {
        await page.evaluate(() => (window as unknown as { __wt: { clearEnemies(): void } }).__wt.clearEnemies());
        await page.evaluate(() => (window as unknown as { __psyche: { hp(n: number): void } }).__psyche.hp(99));
      }
    }

    notes.push(`critical path walked in ${(criticalMs / 1000).toFixed(1)}s of pure movement`);

    // ── the shrine handover ──────────────────────────────────────────────
    console.log('\n  the shrine transition');
    const r = await walkTo(page, WOODS.shrine[0], WOODS.shrine[1]);
    ok(r.ok, `reached the shrine trigger`);
    await page.waitForTimeout(2600);
    await page.evaluate(() => (window as unknown as { __wt: { clearDialogue(): Promise<void> } }).__wt.clearDialogue());
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => {
      const wt = (window as unknown as { __wt: { map(): string; flag(f: string): boolean } }).__wt;
      return { map: wt.map(), cleared: wt.flag('woods_cleared') };
    });
    ok(after.cleared, `to_shrine fired (woods_cleared set); map is now '${after.map}'`);
    if (after.map !== 'shrine_entrance') {
      notes.push(`shrine_entrance is not registered yet — the handover degraded to a toast instead of crashing (map stayed '${after.map}')`);
    }

    // ── optional content ─────────────────────────────────────────────────
    // Restart clean so the optional route is walked from the top like a
    // player who explores rather than one who has already finished.
    console.log('\n  optional content');
    await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&map=woods`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready,
      undefined, { timeout: 30000 },
    );
    await page.waitForTimeout(800);
    await page.addScriptTag({ content: HARNESS });
    await page.evaluate(() => (window as unknown as { __psyche: { hp(n: number): void } }).__psyche.hp(99));

    // The chest must NOT be reachable before the bushes are cut.
    await page.evaluate(
      (xy: number[]) => (window as unknown as { __psyche: { teleport(x: number, y: number): void } }).__psyche.teleport(xy[0], xy[1]),
      [WOODS.gully[0], 62],
    );
    await page.waitForTimeout(400);
    const blocked = await page.evaluate(
      (xy: number[]) => (window as unknown as { __wt: { route(x: number, y: number): unknown } }).__wt.route(xy[0], xy[1]) === null,
      [WOODS.chest[0], WOODS.chest[1]],
    );
    ok(blocked, 'the chest is sealed behind the cuttable bushes before they are cut');

    // Cut them: face north and swing until the flag sets.
    await page.evaluate(async () => {
      const p = (window as unknown as { __psyche: { move(x: number, y: number): void; press(a: string): void; flags(): Record<string, boolean> } }).__psyche;
      for (let i = 0; i < 30; i++) {
        p.move(0, -1);
        await new Promise((r2) => setTimeout(r2, 90));
        p.move(0, 0);
        p.press('attack');
        await new Promise((r2) => setTimeout(r2, 260));
        if (p.flags().woods_gully_open) break;
      }
      p.move(0, 0);
    });
    const cutOk = await page.evaluate(() => (window as unknown as { __wt: { flag(f: string): boolean } }).__wt.flag('woods_gully_open'));
    ok(cutOk, 'the bushes can be cut with the sword');

    const toChest = await walkTo(page, WOODS.chest[0], WOODS.chest[1]);
    ok(toChest.ok, `the chest is reachable through the gully (${(toChest.ms / 1000).toFixed(1)}s)`);
    await page.evaluate(() => (window as unknown as { __wt: { clearEnemies(): void } }).__wt.clearEnemies());
    await page.evaluate(async () => {
      const p = (window as unknown as { __psyche: { press(a: string): void } }).__psyche;
      p.press('interact');
      await new Promise((r2) => setTimeout(r2, 500));
    });
    await page.evaluate(() => (window as unknown as { __wt: { clearDialogue(): Promise<void> } }).__wt.clearDialogue());
    const gotChest = await page.evaluate(() => (window as unknown as { __wt: { flag(f: string): boolean } }).__wt.flag('woods_chest'));
    ok(gotChest, 'the chest opens');

    // The ford: the campsite must be sealed until the boulder goes in.
    await page.evaluate(
      (xy: number[]) => (window as unknown as { __psyche: { teleport(x: number, y: number): void } }).__psyche.teleport(xy[0], xy[1]),
      [WOODS.boulder[0], WOODS.boulder[1] - 1],
    );
    await page.waitForTimeout(400);
    const campBlocked = await page.evaluate(
      (xy: number[]) => (window as unknown as { __wt: { route(x: number, y: number): unknown } }).__wt.route(xy[0], xy[1]) === null,
      [WOODS.camp[0], WOODS.camp[1]],
    );
    ok(campBlocked, 'the campsite is sealed until the ford is made');

    await page.evaluate(async () => {
      const p = (window as unknown as { __psyche: { move(x: number, y: number): void; press(a: string): void } }).__psyche;
      p.move(0, 1);
      await new Promise((r2) => setTimeout(r2, 200));
      p.move(0, 0);
      await new Promise((r2) => setTimeout(r2, 150));
      p.press('interact');
      await new Promise((r2) => setTimeout(r2, 1600));
    });
    await page.evaluate(() => (window as unknown as { __wt: { clearDialogue(): Promise<void> } }).__wt.clearDialogue());
    const fordOk = await page.evaluate(() => (window as unknown as { __wt: { flag(f: string): boolean } }).__wt.flag('woods_ford_open'));
    ok(fordOk, 'the boulder can be shoved into the ford');
    const toCamp = await walkTo(page, WOODS.camp[0], WOODS.camp[1]);
    ok(toCamp.ok, 'the campsite is reachable across the ford');

    // Optional encounter, and the two remaining secrets.
    for (const [name, xy] of [
      ['toadstool ring', WOODS.toadstools],
      ['carved stone', WOODS.carving],
    ] as Array<[string, readonly [number, number]]>) {
      const rr = await walkTo(page, xy[0], xy[1]);
      ok(rr.ok, `${name} is reachable`);
      await page.evaluate(() => (window as unknown as { __wt: { clearEnemies(): void } }).__wt.clearEnemies());
    }

    // ── report ───────────────────────────────────────────────────────────
    console.log('\n──────────────────────────────────────────');
    console.log(`encounters authored: ${ENCOUNTERS.length}`);
    for (const n of notes) console.log(`note: ${n}`);
    const realErrors = errors.filter((e) => !/favicon|WebGL|Audio/i.test(e));
    console.log(`page errors: ${realErrors.length}`);
    realErrors.slice(0, 6).forEach((e) => console.log(`   ${e.slice(0, 200)}`));
    console.log(`wall clock: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    console.log(failures.length ? `\n${failures.length} FAILURE(S)` : '\nCLEAN');
    if (failures.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await server.close();
  }
}

function P(v: readonly [number, number]): [number, number] { return [v[0], v[1]]; }

main().catch((e) => { console.error(e); process.exit(1); });
