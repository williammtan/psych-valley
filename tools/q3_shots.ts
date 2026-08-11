/**
 * Act IV capture harness.
 *
 * Boots the real game, drives the Festival Plaza and the Lantern Trial through
 * the debug API, and captures the frames that the composition and pressure
 * critiques are argued from:
 *
 *   npx tsx tools/q3_shots.ts                 # every frame
 *   npx tsx tools/q3_shots.ts --only r3       # one frame
 *   npx tsx tools/q3_shots.ts --list
 *
 * `r3_unanimity` is the important one: the whole group's bubbles showing the
 * same wrong answer with the player still to speak.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'shots');

interface Frame {
  name: string;
  note: string;
  /** Tile to stand on before capturing. */
  at?: [number, number];
  hideHud?: boolean;
  /** Run the trial up to (and pausing at) this round's player prompt. */
  toRound?: number;
  settle?: number;
}

const FRAMES: Frame[] = [
  { name: 'fest_entry', note: 'Arriving through the arch from town', at: [23, 32], settle: 1600 },
  { name: 'fest_stage', note: 'The trial stage, the centre of attention', at: [23, 22], settle: 1600 },
  { name: 'fest_stage_nohud', note: 'Same, HUD hidden — the composition test', at: [23, 22], hideHud: true, settle: 1600 },
  { name: 'fest_food_row', note: 'West food row', at: [10, 20], settle: 1400 },
  { name: 'fest_bandstand', note: 'East bandstand and games', at: [37, 20], settle: 1400 },
  { name: 'fest_river', note: 'Floating lanterns on the river', at: [23, 13], settle: 1400 },
  { name: 'fest_wide_nohud', note: 'Crowd + stage together, HUD hidden', at: [23, 24], hideHud: true, settle: 1600 },
  { name: 'r2_consensus', note: 'Round 2 — the group visibly moving to Tavi', toRound: 2, settle: 700 },
  { name: 'r3_unanimity', note: 'Round 3 — unanimous, and the player answers last', toRound: 3, settle: 700 },
  { name: 'r4_broken', note: 'Round 4 — Nia has broken it and others followed', toRound: 4, settle: 700 },
];

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  const server = await createServer({
    root: ROOT,
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  (page as unknown as { __errors: string[] }).__errors = errors;
  return { browser, page, server, base };
}

async function load(page: Page, base: string): Promise<void> {
  await page.goto(`${base}?skiptitle=1&map=festival`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as any).__psyche?.ready && !!(window as any).__trial,
    undefined, { timeout: 25000 },
  );
  await page.evaluate(() => (window as any).__psyche.jump('festival'));
  await page.waitForTimeout(700);
}

/** Run the trial to the moment the player is asked in `round`, and stop there. */
export async function driveToRound(page: Page, round: number): Promise<void> {
  await page.evaluate((r) => (window as any).__trial.runTo(r), round);
  await page.waitForFunction(
    (r) => (window as any).__trial.snapshot().awaitingRound === r,
    round, { timeout: 40000 },
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const f of FRAMES) console.log(`${f.name.padEnd(20)} ${f.note}`);
    return;
  }
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
  const list = only ? FRAMES.filter((f) => f.name.includes(only)) : FRAMES;

  const { browser, page, server, base } = await boot();
  mkdirSync(OUT, { recursive: true });
  try {
    for (const f of list) {
      await load(page, base);
      if (f.at) await page.evaluate(([x, y]) => (window as any).__psyche.teleport(x, y), f.at);
      if (f.hideHud) await page.evaluate(() => (window as any).__psyche.hideHud(true));
      if (f.toRound) await driveToRound(page, f.toRound);
      await page.waitForTimeout(f.settle ?? 1200);
      await page.screenshot({ path: join(OUT, `${f.name}.png`) });
      const errs = (page as unknown as { __errors: string[] }).__errors;
      console.log(`  shots/${f.name}.png${errs.length ? `   ${errs.length} console message(s)` : ''}`);
      errs.slice(0, 5).forEach((e) => console.log(`      ${e.slice(0, 260)}`));
      errs.length = 0;
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
