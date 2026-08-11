/**
 * Lumen Vale screen sweep.
 *
 * Walks the town in 30x17-tile windows and captures each one, so the density
 * rule ("every screen the player can stand in must be worth looking at") can be
 * checked as evidence rather than asserted. Modelled on tools/shot.ts.
 *
 *   npx tsx tools/lv_shots.ts            # every screen
 *   npx tsx tools/lv_shots.ts sq inn     # only the named screens
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots', 'lv');

const SCREENS: Array<[string, number, number]> = [
  ['sq', 44, 46],            // Town Square + fountain
  ['sq_north', 45, 34],      // bell tower + general store
  ['plaza', 44, 15],         // Festival Plaza, ordinary state
  ['plaza_n', 44, 8],        // plaza north arch / festival transition
  ['courier', 16, 34],       // Courier Row
  ['courier_s', 12, 44],     // Courier Row south + house_a
  ['farm', 12, 15],          // north farm
  ['workshop', 16, 57],      // Sera's Workshop
  ['gardens', 18, 68],       // market gardens
  ['bridge', 62, 44],        // the bridge
  ['inn', 79, 40],           // The Lantern Inn
  ['inn_yard', 80, 47],      // inn garden
  ['pool', 65, 55],          // the slow pool + jetties
  ['ford', 68, 27],          // the ford
  ['south_road', 42, 62],    // south houses
  ['gate', 42, 71],          // South Gate
  ['east_wood', 78, 22],     // east bank overlook
  ['sq_west', 32, 47],       // square west approach
];

const only = process.argv.slice(2);
const list = only.length ? SCREENS.filter((s) => only.includes(s[0])) : SCREENS;

const server = await createServer({
  root: ROOT,
  server: { port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
});

const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || t.includes('missing sprite')) errors.push(t);
});

await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&map=lumen_vale&mute=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 }).catch(() => {});
// A fresh save runs the arrival cutscene, which drives the camera and ends on
// a player choice — teleporting under it captures whatever the pan is looking
// at. The 'town' checkpoint is the state straight after arrival, so the map
// comes up in its ordinary, walk-around condition.
// Jump straight to the post-arrival state, then dismiss whatever the arrival
// cutscene already had on screen — it ends on a dialogue choice, and an
// abandoned choice would sit in the corner of all eighteen shots. The box
// listens for real keydowns, not injected actions.
await page.evaluate(() => (window as any).__psyche?.jump('town'));
for (let i = 0; i < 40; i++) {
  const busy = await page.evaluate(() => (window as any).__psyche?.state()?.cutscene !== false);
  if (!busy) break;
  await page.keyboard.press('Space');
  await page.waitForTimeout(280);
}
await page.evaluate(() => (window as any).__psyche?.hideHud(true));
await page.waitForTimeout(2600);   // let the location banner expire

mkdirSync(OUT, { recursive: true });
for (const [name, x, y] of list) {
  // Two teleports with a wait between: the camera follows on an exponential
  // lerp and swiftshader runs well under 60fps, so a single call leaves the
  // view part-way through the jump.
  await page.evaluate(([tx, ty]) => (window as any).__psyche?.teleport(tx, ty), [x, y]);
  await page.waitForTimeout(700);
  await page.evaluate(([tx, ty]) => (window as any).__psyche?.teleport(tx, ty), [x, y]);
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  shots/lv/${name}.png  (${x},${y})`);
}

const missing = await page.evaluate(() => (window as any).__missingProps ?? {});
console.log('\n  missing sprites:', JSON.stringify(missing));
if (errors.length) {
  console.log(`  ⚠ ${errors.length} console error(s):`);
  [...new Set(errors)].slice(0, 8).forEach((e) => console.log(`     ${e.slice(0, 220)}`));
} else {
  console.log('  no console errors');
}

await browser.close();
await server.close();
