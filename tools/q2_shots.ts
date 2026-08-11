/**
 * Memory Thread board — visual review shots.
 *
 *   npx tsx tools/q2_shots.ts
 *
 * Drives the board through `window.__psyche` and `window.__threads` and
 * captures it in the four states that matter: empty, part-anchored, in conflict
 * (a memory-only arrangement being refused), and solved. Every shot is also
 * written at 1x so legibility can be judged at the real internal resolution.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'shots');

const ALL_CLUES = [
  'c_slip_wet', 'c_slip_dry', 'c_cord', 'c_tape', 'c_clean', 'c_paint',
  'm_oren_dov', 'm_oren_wren', 'm_wren', 'm_hesta', 'r_rain', 'r_roster',
];

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  const server = await createServer({
    root: ROOT,
    // HMR off: other agents are editing this repo, and a stray file save
    // reloads the page mid-run and takes `window.__psyche` with it.
    server: { port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
    logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  // tsx keeps names by rewriting arrows through a `__name` helper that does not
  // exist inside the page; define it as identity so evaluate() closures work.
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
  return { browser, page, server, base: `http://127.0.0.1:${port}/` };
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  // A 1x copy: the board has to be legible at the internal resolution, and a
  // 4x screenshot flatters everything.
  const png = await page.locator('canvas').screenshot();
  writeFileSync(join(OUT, `${name}_raw.png`), png);
  console.log(`  shots/${name}.png`);
}

async function main(): Promise<void> {
  const { browser, page, server, base } = await boot();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    await page.goto(`${base}?skiptitle=1&map=courier`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 });
    await page.waitForTimeout(900);

    // Quest started, every clue found, standing at the route board.
    await page.evaluate((clues) => {
      const p = (window as any).__psyche;
      p.setFlag('q2_started');
      p.setFlag('met_oren');
      p.setFlag('threads_open');
      p.grant('observe');
      for (const c of clues) p.setFlag('q2_clue_' + c);
      p.teleport(12, 11);
    }, ALL_CLUES);
    await page.waitForTimeout(500);

    // Open the board directly rather than walking into the pin board.
    await page.evaluate(() => {
      const w = window as any;
      w.__psyche.scene.area.onInteract(w.__psyche.scene, 'route_board');
    });
    await page.waitForFunction(() => (window as any).__threads?.isOpen(), undefined, { timeout: 10000 });
    await page.waitForTimeout(700);
    await shot(page, 'q2_threads_empty');

    // A memory-only arrangement: four people being certain, nothing proved.
    await page.evaluate(() => {
      const t = (window as any).__threads;
      t.place('m_hesta', 'yesterday', 0);
      t.place('m_oren_dov', 'today', 1);
      t.place('m_oren_wren', 'yesterday', 2);
      t.place('m_wren', 'today', 2);
    });
    await page.waitForTimeout(900);
    await shot(page, 'q2_threads_memory_conflict');
    const conflictState = await page.evaluate(() => (window as any).__threads.state());
    console.log('  memory-only anchors:', conflictState.anchored.length,
      ' conflicts:', conflictState.conflicts.map((c: any) => c.reason));

    // Half proved: two things and two recollections still on the board.
    await page.evaluate(() => {
      const t = (window as any).__threads;
      t.clear('yesterday', 0); t.clear('today', 1);
      t.place('c_slip_wet', 'yesterday', 0);
      t.place('c_cord', 'yesterday', 1);
      t.place('c_tape', 'today', 1);
    });
    await page.waitForTimeout(900);
    await shot(page, 'q2_threads_partial');

    // The arrangement the room supports.
    await page.evaluate(() => {
      const t = (window as any).__threads;
      t.clear('yesterday', 2); t.clear('today', 2);
      t.place('c_clean', 'yesterday', 2);
      t.place('c_slip_dry', 'today', 0);
      t.place('c_paint', 'today', 2);
    });
    await page.waitForTimeout(450);
    await shot(page, 'q2_threads_solved');
    console.log('  solved:', (await page.evaluate(() => (window as any).__threads.state())).solved);

    await page.waitForTimeout(2200);
    await shot(page, 'q2_reveal');
  } finally {
    await browser.close();
    await server.close();
  }

  if (errors.length) {
    console.log(`\n  ⚠ ${errors.length} console error(s):`);
    errors.slice(0, 8).forEach((e) => console.log(`      ${e.slice(0, 240)}`));
  } else {
    console.log('\n  no console errors');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
