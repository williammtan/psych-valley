/** Opens a dialogue box and captures it, so panel rendering can be reviewed. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: ROOT, server: { port: 20000 + Math.floor(Math.random()*20000), strictPort: false, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { (window as any).__name = (f: unknown) => f; });
await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&mute=1&map=inn`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 });
await page.waitForTimeout(1200);
await page.evaluate(() => {
  const ev = (window as any).__psyche.scene.game.scene.getScene('UI');
  ev.dialogue.show('mira', 'That is Pip. He has been like this ever since the storm, and nothing I do shifts him.');
});
await page.waitForTimeout(2500);
await page.screenshot({ path: join(ROOT, 'shots', 'panel_dialogue.png') });
await browser.close(); await server.close();
console.log('  shots/panel_dialogue.png');
