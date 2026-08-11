/**
 * Experience probe — a fresh-context playtester's driving seat.
 *
 * Unlike `shot.ts` (which jumps to a beat and photographs it) this harness is
 * built to *play*: it walks routes at player speed, times them with a wall
 * clock, scrapes the on-screen text so the tester can read dialogue without
 * squinting at a PNG, and records every page error along the way.
 *
 * Scenarios are separate ES modules that default-export an async function
 * receiving the context below, so a tester can iterate without rebooting the
 * harness plumbing.
 *
 *   npx tsx tools/experience_probe.ts --scenario /path/to/scenario.ts
 *   npx tsx tools/experience_probe.ts --scenario ... --out shots/probe/seg1
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export interface ProbeCtx {
  page: Page;
  /** Where screenshots land. */
  out: string;
  /** Screenshot into the run's output dir. Returns the path. */
  shot(name: string): Promise<string>;
  /** Full debug state snapshot. */
  state(): Promise<any>;
  /** Every visible text string currently on screen, in draw order. */
  text(): Promise<string[]>;
  jump(cp: string): Promise<void>;
  goto(map: string, spawn?: string): Promise<void>;
  teleport(tx: number, ty: number): Promise<void>;
  setFlag(f: string, v?: boolean): Promise<void>;
  grant(a: string): Promise<void>;
  hp(n: number): Promise<void>;
  spawnEnemy(kind: string, tx: number, ty: number): Promise<void>;
  press(a: string): Promise<void>;
  /** Fire a gameplay action only (no dialogue advance). */
  act(a: string): Promise<void>;
  /** Advance a dialogue line only (no gameplay action). */
  advance(): Promise<void>;
  move(x: number, y: number): Promise<void>;
  stop(): Promise<void>;
  wait(ms: number): Promise<void>;
  /** Hold a direction for ms at player speed. Returns tile pos afterwards. */
  walk(dx: number, dy: number, ms: number): Promise<{ tx: number; ty: number; map: string }>;
  /**
   * Steer toward a tile the way a player does (no pathfinding — straight
   * pushing, with a little wall-slide). Reports wall-clock ms and whether it
   * got there, so "how long is this walk" is measurable and "I got stuck on a
   * corner" is detectable.
   */
  walkTo(tx: number, ty: number, opts?: { timeout?: number; tol?: number }): Promise<{
    reached: boolean; ms: number; from: [number, number]; to: [number, number];
    end: [number, number]; map: string; stuckAt?: [number, number];
  }>;
  /** Mash interact until dialogue stops producing new lines. Returns the script. */
  talk(max?: number, gap?: number): Promise<string[]>;
  /** Console/page errors captured so far; clears the buffer. */
  errors(): string[];
  /** Timestamped note into the run log. */
  log(...parts: unknown[]): void;
  /** Wall clock helper. */
  clock(): { ms(): number; lap(label: string): number };
  reload(url?: string): Promise<void>;
}

const TEXT_SCRAPE = `(() => {
  const out = [];
  const seen = new Set();
  const g = window.__game;
  if (!g) return out;
  const walk = (list, sceneVisible) => {
    for (const o of list) {
      if (!o) continue;
      const vis = sceneVisible && (o.visible !== false) && ((o.alpha ?? 1) > 0.05);
      if (o.type === 'Container' && o.list) { walk(o.list, vis); continue; }
      if (typeof o.text === 'string' && o.text.trim() && vis) {
        const t = o.text.replace(/\\s+/g, ' ').trim();
        if (!seen.has(t)) { seen.add(t); out.push(t); }
      }
    }
  };
  for (const s of g.scene.scenes) {
    if (!s.sys.isActive || !s.sys.isVisible()) continue;
    walk(s.children.list, true);
  }
  return out;
})()`;

async function boot(headed = false): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string; errors: string[] }> {
  const server = await createServer({
    root: ROOT,
    // HMR + watching off: another agent editing source mid-run would silently
    // full-reload the page and reset the save under the playtest.
    server: { port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;
  const base = `http://127.0.0.1:${port}/`;

  const browser = await chromium.launch({
    headless: !headed,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  // tsx's --keep-names rewrites arrows through a `__name` helper that does not
  // exist inside the page; define it as identity or every closure-bearing
  // evaluate() throws.
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  return { browser, page, server, base, errors };
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__game, undefined, { timeout: 25000 }).catch(() => {});
  await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(400);
}

function makeCtx(page: Page, out: string, errBuf: string[], logPath: string, base: string): ProbeCtx {
  const ev = <T>(fn: string, ...args: any[]): Promise<T> =>
    page.evaluate(new Function('a', `return (${fn}).apply(null, a)`) as any, args) as Promise<T>;

  const log = (...parts: unknown[]) => {
    const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    console.log(line);
    appendFileSync(logPath, line + '\n');
  };

  const ctx: ProbeCtx = {
    page,
    out,
    async shot(name) {
      const p = join(out, `${name}.png`);
      mkdirSync(dirname(p), { recursive: true });
      await page.screenshot({ path: p });
      return p;
    },
    state: () => ev('() => window.__psyche.state()'),
    text: () => page.evaluate(TEXT_SCRAPE) as Promise<string[]>,
    jump: async (cp) => { await ev('(c) => window.__psyche.jump(c)', cp); await page.waitForTimeout(700); },
    goto: async (m, s = 'default') => { await ev('(m,s) => window.__psyche.goto(m,s)', m, s); await page.waitForTimeout(700); },
    teleport: async (x, y) => { await ev('(x,y) => window.__psyche.teleport(x,y)', x, y); await page.waitForTimeout(150); },
    setFlag: async (f, v = true) => { await ev('(f,v) => window.__psyche.setFlag(f,v)', f, v); },
    grant: async (a) => { await ev('(a) => window.__psyche.grant(a)', a); },
    hp: async (n) => { await ev('(n) => window.__psyche.hp(n)', n); },
    spawnEnemy: async (k, x, y) => { await ev('(k,x,y) => window.__psyche.spawnEnemy(k,x,y)', k, x, y); },
    // Two channels on purpose. Gameplay actions come off the InputManager, but
    // the dialogue box binds raw `keydown` on the scene's keyboard, so an
    // injected action alone never advances a line. A player pressing SPACE
    // produces both, so the probe produces both.
    press: async (a) => {
      const KEY: Record<string, string> = {
        interact: 'Space', attack: 'j', dash: 'Shift', observe: 'q',
        journal: 'i', pause: 'Escape', cancel: 'Escape', map: 'm',
        up: 'w', down: 's', left: 'a', right: 'd',
      };
      // One real key event is exactly what a player produces, and both the
      // InputManager and the dialogue box's raw listener see it. Injecting as
      // well would fire the action twice and invent bugs.
      // Held for a couple of frames on purpose. Playwright's press() fires
      // keydown+keyup back to back, and the InputManager polls
      // Keyboard.JustDown once per frame — a zero-length press is dropped
      // there while the dialogue box (which listens to the raw event) still
      // sees it, which looks exactly like "interact is broken".
      if (KEY[a]) {
        await page.keyboard.down(KEY[a]);
        await page.waitForTimeout(70);
        await page.keyboard.up(KEY[a]);
      } else {
        await ev('(a) => window.__psyche.press(a)', a);
      }
      await page.waitForTimeout(90);
    },
    // The two halves of a SPACE press, separable.
    //
    // A real press feeds the dialogue box (raw keydown) *and* the InputManager
    // (polled JustDown). Splitting them lets the probe keep playing past a beat
    // where doing both at once traps the player.
    act: async (a) => { await ev('(a) => window.__psyche.press(a)', a); await page.waitForTimeout(90); },
    advance: async () => { await page.keyboard.press('Space'); await page.waitForTimeout(60); },
    move: async (x, y) => { await ev('(x,y) => window.__psyche.move(x,y)', x, y); },
    stop: async () => { await ev('() => window.__psyche.stop()'); },
    wait: (ms) => page.waitForTimeout(ms),
    async walk(dx, dy, ms) {
      await ctx.move(dx, dy);
      await page.waitForTimeout(ms);
      await ctx.stop();
      await page.waitForTimeout(80);
      const s = await ctx.state();
      return { tx: s.player.tx, ty: s.player.ty, map: s.map };
    },
    async walkTo(tx, ty, opts = {}) {
      const timeout = opts.timeout ?? 20000;
      const tol = opts.tol ?? 1.2;
      const s0 = await ctx.state();
      const from: [number, number] = [s0.player.tx, s0.player.ty];
      const startMap = s0.map;
      const t0 = Date.now();
      let last = { x: s0.player.x, y: s0.player.y, t: t0 };
      let stuckAt: [number, number] | undefined;
      let slideDir = 1;
      let reached = false;
      let end: [number, number] = from;
      let map = startMap;
      for (;;) {
        const s = await ctx.state();
        map = s.map;
        end = [s.player.tx, s.player.ty];
        const px = tx * 16 + 8, py = ty * 16 + 16;
        const dx = px - s.player.x, dy = py - s.player.y;
        const dist = Math.hypot(dx, dy);
        if (dist < tol * 16 || map !== startMap) { reached = map === startMap; break; }
        if (Date.now() - t0 > timeout) break;
        // stuck detection: barely moved for 900ms while pushing
        const moved = Math.hypot(s.player.x - last.x, s.player.y - last.y);
        if (moved < 2) {
          if (Date.now() - last.t > 900) {
            stuckAt = [s.player.tx, s.player.ty];
            // try sliding along the wall for a beat, alternating sides
            const perp = Math.abs(dx) > Math.abs(dy) ? [0, slideDir] : [slideDir, 0];
            await ctx.move(perp[0], perp[1]);
            await page.waitForTimeout(420);
            slideDir *= -1;
            last = { x: s.player.x, y: s.player.y, t: Date.now() };
            continue;
          }
        } else {
          last = { x: s.player.x, y: s.player.y, t: Date.now() };
        }
        await ctx.move(dx / dist, dy / dist);
        await page.waitForTimeout(110);
      }
      await ctx.stop();
      return { reached, ms: Date.now() - t0, from, to: [tx, ty], end, map, stuckAt };
    },
    async talk(max = 40, gap = 260) {
      const script: string[] = [];
      let idle = 0;
      for (let i = 0; i < max; i++) {
        const before = await ctx.text();
        for (const t of before) if (!script.includes(t)) script.push(t);
        await ctx.press('interact');
        await page.waitForTimeout(gap);
        const after = await ctx.text();
        const fresh = after.filter((t) => !script.includes(t));
        if (!fresh.length) { idle++; if (idle >= 2) break; } else { idle = 0; script.push(...fresh); }
      }
      return script;
    },
    errors() { const c = [...errBuf]; errBuf.length = 0; return c; },
    log,
    clock() {
      const t0 = Date.now();
      let lastLap = t0;
      return {
        ms: () => Date.now() - t0,
        lap: (label: string) => { const d = Date.now() - lastLap; lastLap = Date.now(); log(`   ⏱ ${label}: ${(d / 1000).toFixed(1)}s`); return d; },
      };
    },
    async reload(url = '?skiptitle=1') {
      await page.goto(base + url, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
    },
  };
  return ctx;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (n: string, d?: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const scenario = arg('--scenario');
  const out = resolve(ROOT, arg('--out', 'shots/probe')!);
  const startUrl = arg('--url', '?skiptitle=1')!;
  if (!scenario) { console.error('need --scenario <file>'); process.exit(1); }

  mkdirSync(out, { recursive: true });
  const logPath = join(out, 'run.log');
  writeFileSync(logPath, `# probe run ${new Date().toISOString()}  scenario=${scenario}\n`);

  const { browser, page, server, base, errors } = await boot(argv.includes('--headed'));
  const ctx = makeCtx(page, out, errors, logPath, base);
  try {
    await page.goto(base + startUrl, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    const mod = await import(pathToFileURL(resolve(scenario)).href);
    await mod.default(ctx);
    const left = ctx.errors();
    if (left.length) { ctx.log(`\n!! ${left.length} page error(s):`); left.slice(0, 20).forEach((e) => ctx.log('   ' + e.slice(0, 400))); }
  } catch (e) {
    ctx.log('SCENARIO THREW: ' + (e as Error).stack?.slice(0, 2000));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
