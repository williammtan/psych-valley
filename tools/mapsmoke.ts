/**
 * Loads every registered map in turn and reports errors, missing sprites and
 * frame rate. Cheap integration check while many areas are being built in
 * parallel — catches a map that crashes on load before anyone screenshots it.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: ROOT, server: { port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // tsx compiles with --keep-names, which rewrites arrow functions to call an
  // `__name` helper. When Playwright serialises such a function into the page
  // that helper does not exist, so every evaluate() with a nested closure throws
  // "__name is not defined". Defining it as identity in the page fixes them all.
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || (m.type() === 'warning' && t.includes('missing sprite'))) errors.push(t);
});

await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&mute=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 }).catch(() => {});
const maps: string[] = await page.evaluate(() => (window as any).__psyche.maps());
console.log(`  ${maps.length} map(s) registered: ${maps.join(', ')}\n`);

mkdirSync(join(ROOT, 'shots', 'maps'), { recursive: true });
/**
 * Each map is loaded from a fresh page. Sharing one page across maps is faster
 * but a single map that throws during load can tear down the execution context
 * and take the whole run with it — which then hides which map was at fault.
 */
async function freshPage(): Promise<void> {
  await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&mute=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 }).catch(() => {});
}

let failures = 0;
for (const m of maps) {
  errors.length = 0;
  try {
    await freshPage();
    await page.evaluate((id) => (window as any).__psyche.goto(id), m);
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => (window as any).__psyche.state());
    const fps = await page.evaluate(() => new Promise<number>((res) => {
      let f = 0; const t0 = performance.now();
      const tick = () => { f++; if (performance.now() - t0 < 700) requestAnimationFrame(tick); else res(Math.round(f * 1000 / (performance.now() - t0))); };
      requestAnimationFrame(tick);
    }));
    await page.screenshot({ path: join(ROOT, 'shots', 'maps', `${m}.jpg`), type: 'jpeg', quality: 74 });
    const npcs = (st?.npcs ?? []).length;
    const flag = errors.length ? `⚠ ${errors.length}` : '';
    if (errors.length) failures++;
    console.log(`  ${m.padEnd(22)} ${String(fps).padStart(3)}fps  npcs:${String(npcs).padStart(2)}  ${flag}`);
    errors.slice(0, 3).forEach((e) => console.log(`      ${e.slice(0, 200)}`));
  } catch (e) {
    failures++;
    console.log(`  ${m.padEnd(22)} ✗ FAILED TO LOAD — ${(e as Error).message.split('\n')[0].slice(0, 140)}`);
    errors.slice(0, 3).forEach((er) => console.log(`      ${er.slice(0, 200)}`));
  }
}
if (failures) process.exitCode = 1;
await browser.close();
await server.close();
