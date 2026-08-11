/** Zoomed look at part of the inn, for composition review. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = '/home/william/psych';
const [tx, ty, zoom, name] = process.argv.slice(2);

const server = await createServer({ root: ROOT, server: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { (window as any).__name = (f: any) => f; });
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&map=inn`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 });
await page.waitForTimeout(700);
const nolight = !!process.env.NOLIGHT;
await page.evaluate(([x, y, z, nl]) => {
  const p = (window as any).__psyche;
  p.teleport(Number(x), Number(y));
  p.scene.cameras.main.setZoom(Number(z));
  p.hideHud(true);
  if (nl) p.scene.lighting.clear();
}, [tx, ty, zoom, nolight] as any[]);
await page.waitForTimeout(900);
await page.screenshot({ path: join('/tmp/claude-1003/-home-william-psych/4121c17c-fb2d-4831-b855-46266fb68e71/scratchpad', `${name}.png`) });
console.log('errors:', errs.slice(0, 8));
await browser.close();
await server.close();
