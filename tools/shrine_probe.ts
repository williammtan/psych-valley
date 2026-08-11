/**
 * Quick interactive probe for a shrine room: boot the game, jump to a
 * checkpoint, run an arbitrary snippet, print the resulting state.
 *
 *   npx tsx tools/shrine_probe.ts shrine_association "__psyche.state().player"
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkpoint = process.argv[2] ?? 'shrine_association';
const expr = process.argv[3] ?? '__psyche.state()';

const server = await createServer({
  root: ROOT,
  server: {
    port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1',
    watch: null, hmr: false,
  },
  logLevel: 'error',
});
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript(() => {
  (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
});
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('  [page]', m.text().slice(0, 240));
});
page.on('pageerror', (e) => console.log('  [error]', String(e).slice(0, 300)));

await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&mute=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready, undefined, { timeout: 30000 });
await page.evaluate((c) => (window as unknown as { __psyche: { jump(c: string): void } }).__psyche.jump(c), checkpoint);
await page.waitForTimeout(1400);
const out = await page.evaluate(async (e) => JSON.stringify(await eval(e), null, 1), expr);
console.log(out);
await browser.close();
await server.close();
