/**
 * WHISPER WOODS — visual review harness.
 *
 * Captures the zone at every beat along the spine plus each authored encounter,
 * so the woods can be critiqued from evidence rather than from source. Modelled
 * on tools/shot.ts.
 *
 *   npx tsx tools/woods_shots.ts                  # everything
 *   npx tsx tools/woods_shots.ts --shot e3_terrace
 *   npx tsx tools/woods_shots.ts --list
 *   npx tsx tools/woods_shots.ts --nohud          # composition pass
 *
 * The dark-area shots exist specifically to be compared against
 * references/stardew/stardew_mine_atmosphere.png:
 *   - is darkness creating atmosphere without hiding gameplay information?
 *   - do the enemies separate from the background?
 *   - are the light sources doing compositional work?
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { ENCOUNTERS, WOODS } from '../src/world/maps/woods';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'shots', 'woods');

interface WoodsShot {
  name: string;
  at: [number, number];
  note: string;
  /** Spawn these before capturing, so combat shots contain actual combat. */
  enemies?: Array<[string, number, number]>;
  flags?: string[];
  settle?: number;
}

const P = (v: readonly [number, number]): [number, number] => [v[0], v[1]];

export const WOODS_SHOTS: WoodsShot[] = [
  { name: '01_gate', at: P(WOODS.gate), note: 'Town gate. Tone handover: the last of the town road, canopy starting to close.' },
  { name: '02_clearing', at: P(WOODS.clearing), note: 'First Clearing — E1 arena. Lanterns frame it; the canopy is deliberately open overhead.' },
  { name: '03_narrows', at: P(WOODS.narrows), note: 'The Narrows. Heaviest canopy in the zone; the path should still read unambiguously.' },
  { name: '04_toadstools', at: P(WOODS.toadstools), note: '◆ Secret: the toadstool ring. Cyan spore light marks it from the junction.' },
  { name: '05_hollow', at: P(WOODS.hollow), note: 'The Hollow — E2 arena. Boulder in the middle, leaf litter floor.' },
  { name: '06_dell', at: P(WOODS.dell), note: 'The Dell. THE reveal: the cliff face, and the lit chest on the plateau above it.' },
  { name: '07_gully', at: P(WOODS.gully), note: 'The cuttable bushes screening the gully. Does this look like something to hit?' },
  { name: '08_plateau', at: P(WOODS.plateau), note: 'On the plateau. Read from up here: the chest, the wisp, the drop.' },
  { name: '09_chest', at: P(WOODS.chest), note: '◆ Secret: the chest, lit.' },
  { name: '10_terrace', at: P(WOODS.terrace), note: 'The Broken Terrace — E3 arena. Cut stone surfacing through the forest floor.' },
  { name: '11_carving', at: P(WOODS.carving), note: '◆ Secret: the carved standing stone.' },
  { name: '12_crossing', at: P(WOODS.crossing), note: 'The stream crossing on the spine.' },
  { name: '13_ford', at: P(WOODS.boulder), note: '◆ Optional puzzle: the boulder above the shallow ford.' },
  { name: '14_camp', at: P(WOODS.camp), note: '◆ Secret: the old campsite, across the ford.' },
  { name: '15_south_bank', at: P(WOODS.southBank), note: 'South Bank — E4 arena.' },
  { name: '16_stones', at: P(WOODS.gauntlet), note: 'The Standing Stones — E5 arena. Trees thinning, flagstone starting.' },
  { name: '17_shrine', at: P(WOODS.shrine), note: 'Shrine approach. Violet, flagstone, the only saturated colour in the zone.' },
];

/** One shot per encounter, with the enemies actually on the field. */
for (const e of ENCOUNTERS) {
  const first = e.spawns[0];
  WOODS_SHOTS.push({
    name: `enc_${e.id}`,
    at: [first[1], first[2] - 3],
    enemies: e.spawns.map(([k, x, y]) => [k, x, y] as [string, number, number]),
    note: e.note,
    settle: 1200,
  });
}

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
  // esbuild's `__name` helper is not defined inside page.evaluate closures.
  await page.addInitScript(() => {
    (window as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f;
  });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { __errors: string[] }).__errors = errors;

  return { browser, page, server, base };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const s of WOODS_SHOTS) console.log(`${s.name.padEnd(22)} ${s.note}`);
    return;
  }
  const only = argv.includes('--shot') ? argv[argv.indexOf('--shot') + 1] : undefined;
  const noHud = argv.includes('--nohud');
  const list = only ? WOODS_SHOTS.filter((s) => s.name === only) : WOODS_SHOTS;

  const { browser, page, server, base } = await boot();
  mkdirSync(OUT, { recursive: true });
  const results: Array<{ name: string; note: string; errors: string[] }> = [];

  try {
    await page.goto(`${base}?skiptitle=1&map=woods`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready,
      undefined, { timeout: 30000 },
    );
    await page.waitForTimeout(900);

    for (const shot of list) {
      // A clean slate per shot: no leftover enemies from the previous capture.
      await page.evaluate(() => {
        const p = (window as unknown as { __psyche: { scene: { enemies: { clear(): void } } } }).__psyche;
        p.scene.enemies.clear();
      });
      for (const f of shot.flags ?? []) {
        await page.evaluate((flag) => (window as unknown as { __psyche: { setFlag(f: string): void } }).__psyche.setFlag(flag), f);
      }
      await page.evaluate(
        (xy) => (window as unknown as { __psyche: { teleport(x: number, y: number): void } }).__psyche.teleport(xy[0], xy[1]),
        shot.at,
      );
      for (const [kind, x, y] of shot.enemies ?? []) {
        await page.evaluate(
          (e) => (window as unknown as { __psyche: { spawnEnemy(k: string, x: number, y: number): void } })
            .__psyche.spawnEnemy(e[0] as string, e[1] as number, e[2] as number),
          [kind, x, y] as unknown[],
        );
      }
      await page.evaluate(
        (h) => (window as unknown as { __psyche: { hideHud(h: boolean): void } }).__psyche.hideHud(h as boolean),
        noHud,
      );
      await page.waitForTimeout(shot.settle ?? 800);
      await page.screenshot({ path: join(OUT, `${shot.name}${noHud ? '_nohud' : ''}.png`) });

      const errs = [...((page as unknown as { __errors: string[] }).__errors ?? [])];
      (page as unknown as { __errors: string[] }).__errors.length = 0;
      results.push({ name: shot.name, note: shot.note, errors: errs });
      console.log(`  shots/woods/${shot.name}.png${errs.length ? `  ⚠ ${errs.length} error(s)` : ''}`);
      errs.slice(0, 3).forEach((e) => console.log(`      ${e.slice(0, 200)}`));
    }
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
