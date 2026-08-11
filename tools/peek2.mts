import { chromium } from 'playwright';
import { createServer } from 'vite';
const ROOT = '/home/william/psych';
const server = await createServer({ root: ROOT, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => { (window as any).__name = (f: any) => f; });
await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&map=inn`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 });
await page.waitForTimeout(700);
const info = await page.evaluate(() => {
  const p = (window as any).__psyche;
  p.teleport(25, 10); p.hideHud(true);
  const s = p.scene;
  const out: any = { children: [] };
  for (const c of s.children.list) {
    const b = c as any;
    if (b.type === 'Sprite' || b.type === 'Image' || b.type === 'Rectangle') {
      const fx = 300, fy = 140; // world point inside the pale band (tile 19.5, 8.7)
      const x = b.x ?? 0, y = b.y ?? 0;
      const w = (b.displayWidth ?? 0), h = (b.displayHeight ?? 0);
      const ox = b.originX ?? 0.5, oy = b.originY ?? 0.5;
      const l = x - w * ox, t = y - h * oy;
      if (b.scrollFactorX === 0) continue;
      if (fx >= l && fx <= l + w && fy >= t && fy <= t + h) {
        out.children.push({ type: b.type, frame: b.frame?.name, x, y, w, h, depth: b.depth, blend: b.blendMode, alpha: b.alpha });
      }
    }
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
await server.close();
