/**
 * Screenshot harness.
 *
 * Boots the real game in headless Chromium, drives it through the debug API,
 * and captures PNGs for visual review. This is how every visual critique in the
 * project gets its evidence — nobody reviews the game from source.
 *
 *   npm run shot                       # the standard review set
 *   npm run shot -- --shot town        # one named shot
 *   npm run shot -- --list             # list available shots
 *   npm run shot -- --url "?map=inn"   # arbitrary state
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'shots');

export interface ShotSpec {
  name: string;
  /** Debug checkpoint to jump to before capturing. */
  checkpoint?: string;
  map?: string;
  spawn?: string;
  /** Tile coordinates to teleport to after loading. */
  at?: [number, number];
  flags?: string[];
  abilities?: string[];
  /** Extra script run in the page before capture. */
  setup?: string;
  /** Milliseconds to let the scene settle/animate. */
  settle?: number;
  hideHud?: boolean;
  note?: string;
}

export const SHOTS: ShotSpec[] = [
  { name: 'title', settle: 1400, note: 'Title screen' },
  { name: 'town_square', checkpoint: 'town', at: [27, 27], settle: 1200, note: 'Town Square — main navigation anchor' },
  { name: 'town_square_nohud', checkpoint: 'town', at: [27, 27], settle: 1200, hideHud: true, note: 'Town Square, HUD hidden (composition review)' },
  { name: 'town_north', checkpoint: 'town', at: [27, 14], settle: 1000, note: 'Bell tower approach' },
  { name: 'town_river', checkpoint: 'town', at: [42, 25], settle: 1000, note: 'River and bridge' },
  { name: 'town_courier_row', checkpoint: 'town', at: [11, 16], settle: 1000, note: 'Courier Row' },
  { name: 'town_south_gate', checkpoint: 'town', at: [27, 39], settle: 1000, note: 'South gate' },
  { name: 'inn', checkpoint: 'inn', settle: 1200, note: 'The Lantern Inn interior' },
  { name: 'workshop', map: 'workshop', settle: 1200, note: "Sera's Workshop" },
  { name: 'courier_office', map: 'courier', settle: 1200, note: 'Courier Office' },
  { name: 'festival', checkpoint: 'festival', settle: 1600, note: 'Festival Plaza, event state' },
  { name: 'festival_nohud', checkpoint: 'festival', settle: 1600, hideHud: true, note: 'Festival Plaza, HUD hidden' },
  { name: 'woods', checkpoint: 'woods', settle: 1400, note: 'Whisper Woods' },
  { name: 'shrine_entrance', checkpoint: 'shrine', settle: 1400, note: 'Echo Shrine entrance' },
  { name: 'shrine_association', checkpoint: 'shrine_association', settle: 1400, note: 'Dungeon room 1 — association' },
  { name: 'shrine_combat', checkpoint: 'shrine_combat', settle: 1400, note: 'Dungeon room 2 — combat' },
  { name: 'shrine_memory', checkpoint: 'shrine_memory', settle: 1400, note: 'Dungeon room 3 — memory' },
  { name: 'shrine_conformity', checkpoint: 'shrine_conformity', settle: 1400, note: 'Dungeon room 4 — conformity' },
  { name: 'shrine_combination', checkpoint: 'shrine_combination', settle: 1400, note: 'Dungeon room 5 — combination' },
  { name: 'boss', checkpoint: 'boss', settle: 1600, note: 'The Echo — boss chamber' },
  { name: 'journal_insights', checkpoint: 'q3_done', settle: 900, setup: `window.__psyche.press('journal')`, note: 'Journal, Insights tab' },
];

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  // Port 0 lets the OS pick a free one — several harnesses run concurrently
  // during the gauntlet and a fixed port makes them collide.
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { __errors: string[] }).__errors = errors;

  return { browser, page, server, base };
}

async function waitForGame(page: Page, timeout = 25000): Promise<void> {
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { __game?: { isRunning: boolean } }).__game;
      return !!g && (window as unknown as { __booted?: boolean }).__booted !== false;
    },
    undefined,
    { timeout },
  ).catch(() => {});
}

async function capture(page: Page, spec: ShotSpec, base: string): Promise<{ errors: string[]; state: unknown }> {
  const needsWorld = !!(spec.checkpoint || spec.map);
  const url = needsWorld
    ? `${base}?skiptitle=1${spec.map ? `&map=${spec.map}` : ''}${spec.spawn ? `&spawn=${spec.spawn}` : ''}`
    : base;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForGame(page);
  if (needsWorld) {
    await page.waitForFunction(
      () => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready,
      undefined, { timeout: 20000 },
    ).catch(() => {});
  }
  await page.waitForTimeout(500);

  if (spec.checkpoint) {
    await page.evaluate((c) => (window as any).__psyche.jump(c), spec.checkpoint);
    await page.waitForTimeout(600);
  }
  for (const f of spec.flags ?? []) await page.evaluate((flag) => (window as any).__psyche.setFlag(flag), f);
  for (const a of spec.abilities ?? []) await page.evaluate((ab) => (window as any).__psyche.grant(ab), a);
  if (spec.at) await page.evaluate(([x, y]) => (window as any).__psyche.teleport(x, y), spec.at);
  if (spec.hideHud) await page.evaluate(() => (window as any).__psyche.hideHud(true));
  if (spec.setup) await page.evaluate(spec.setup);
  await page.waitForTimeout(spec.settle ?? 900);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${spec.name}.png`) });
  // A compressed copy for the workbench page, which embeds images inline.
  await page.screenshot({ path: join(OUT, `${spec.name}.jpg`), type: 'jpeg', quality: 74 });

  const state = await page.evaluate(() => {
    const p = (window as any).__psyche;
    return p ? p.state() : null;
  }).catch(() => null);

  const errors = [...((page as unknown as { __errors: string[] }).__errors ?? [])];
  (page as unknown as { __errors: string[] }).__errors.length = 0;
  return { errors, state };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = argv.includes('--shot') ? argv[argv.indexOf('--shot') + 1] : undefined;
  const rawUrl = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : undefined;
  const outName = argv.includes('--name') ? argv[argv.indexOf('--name') + 1] : 'custom';

  if (argv.includes('--list')) {
    for (const s of SHOTS) console.log(`${s.name.padEnd(24)} ${s.note ?? ''}`);
    return;
  }

  const { browser, page, server, base } = await boot();
  const results: Array<{ name: string; errors: string[]; state: unknown }> = [];

  try {
    if (rawUrl) {
      await page.goto(`${base}${rawUrl}`, { waitUntil: 'domcontentloaded' });
      await waitForGame(page);
      await page.waitForTimeout(1800);
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: join(OUT, `${outName}.png`) });
      const errs = (page as unknown as { __errors: string[] }).__errors ?? [];
      console.log(`  shots/${outName}.png${errs.length ? `  ⚠ ${errs.length} error(s)` : ''}`);
      errs.slice(0, 6).forEach((e) => console.log(`      ${e.slice(0, 300)}`));
    } else {
      const list = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
      if (!list.length) {
        console.error(`no shot named '${only}'. Use --list.`);
        process.exitCode = 1;
      }
      for (const spec of list) {
        try {
          const r = await capture(page, spec, base);
          results.push({ name: spec.name, ...r });
          console.log(`  shots/${spec.name}.png${r.errors.length ? `  ⚠ ${r.errors.length} error(s)` : ''}`);
          if (r.errors.length) r.errors.slice(0, 3).forEach((e) => console.log(`      ${e.slice(0, 240)}`));
        } catch (e) {
          console.log(`  ✗ ${spec.name}: ${(e as Error).message.slice(0, 200)}`);
          results.push({ name: spec.name, errors: [(e as Error).message], state: null });
        }
      }
      writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
