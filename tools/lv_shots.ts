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

/**
 * [name, camera centre x, camera centre y, optional tile the player stands on].
 *
 * The stand tile exists because `teleport` puts the player's feet on the target
 * and `ensureUnstuck` then shoves them out of anything solid — which, framed on
 * a building, means the door. A door transition mid-sweep sent every screen
 * after it into the inn's interior, so framing and standing are now separate.
 */
const SCREENS: Array<[string, number, number, number?, number?]> = [
  ['sq', 44, 46],            // Town Square + fountain
  ['sq_north', 45, 34],      // bell tower + general store
  ['square_n', 44, 40],      // the north approach to the square
  ['plaza', 44, 15],         // Festival Plaza, ordinary state
  ['plaza_n', 44, 8],        // plaza north arch / festival transition
  ['store', 36, 32, 36, 38], // the bakery frontage and its apron
  ['courier', 16, 34],       // Courier Row
  ['courier_s', 12, 44],     // Courier Row south + house_a
  ['farm', 12, 15],          // north farm
  ['workshop', 16, 57],      // Sera's Workshop
  ['gardens', 18, 68],       // market gardens
  ['bridge', 62, 44],        // the bridge
  ['inn', 79, 41, 79, 46],   // The Lantern Inn — stand in the yard, frame the door
  ['inn_yard', 80, 47],      // inn garden
  ['pool', 65, 55],          // the slow pool + jetties
  ['ford', 68, 27],          // the ford
  ['south_road', 42, 62],    // south houses
  ['gate', 42, 71],          // South Gate
  ['east_wood', 78, 22],     // east bank overlook
  ['sq_west', 32, 47],       // square west approach
  ['north_edge', 44, 6],     // the top border — check the frame does not leak
  ['west_edge', 6, 30],      // the west border
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
// The arrival holds the camera for a ~9s valley pan between its lines, so this
// has to outlast the whole sequence, not just the dialogue.
let settled = false;
for (let i = 0; i < 160 && !settled; i++) {
  settled = await page.evaluate(() => (window as any).__psyche?.state()?.cutscene === false);
  if (settled) break;
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
}
if (!settled) console.log('  ⚠ arrival cutscene never settled');
await page.evaluate(() => (window as any).__psyche?.hideHud(true));
await page.waitForTimeout(2600);   // let the location banner expire

mkdirSync(OUT, { recursive: true });
/**
 * A teleport lands the player's feet on the target tile, so a window centred
 * near a threshold walks straight through the door and every screen after it
 * captures an interior. Re-assert the map before each capture and say so
 * loudly, rather than silently shipping eighteen shots of somebody's pub.
 */
async function ensureTown(name: string): Promise<void> {
  const where = await page.evaluate(() => (window as any).__psyche?.state()?.map);
  if (where === 'lumen_vale') return;
  console.log(`  ⚠ ${name}: fell into '${where}' — returning to lumen_vale`);
  await page.evaluate(() => (window as any).__psyche?.goto('lumen_vale', 'default'));
  await page.waitForTimeout(2600);   // let the location banner expire again
  await page.evaluate(() => (window as any).__psyche?.hideHud(true));
}

for (const [name, x, y, sx, sy] of list) {
  await ensureTown(name);
  const stand: [number, number] = [sx ?? x, sy ?? y];
  // Two teleports with a wait between: the camera follows on an exponential
  // lerp and swiftshader runs well under 60fps, so a single call leaves the
  // view part-way through the jump.
  await page.evaluate(([tx, ty]) => (window as any).__psyche?.teleport(tx, ty), stand);
  await page.waitForTimeout(600);
  await page.evaluate(([tx, ty]) => (window as any).__psyche?.teleport(tx, ty), stand);
  await page.waitForTimeout(500);
  // Pin the camera on the framing point rather than trusting the follow lerp,
  // so the window is exactly the 30x17 tiles the screen name claims.
  await page.evaluate(([cx, cy]) => {
    const cam = (window as any).__psyche?.scene?.cameras?.main;
    cam?.stopFollow();
    cam?.centerOn(cx * 16 + 8, cy * 16 + 8);
  }, [x, y]);
  await page.waitForTimeout(700);
  const map = await page.evaluate(() => (window as any).__psyche?.state()?.map);
  if (map !== 'lumen_vale') { console.log(`  ⚠ ${name} landed in '${map}' — shot skipped`); continue; }
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
