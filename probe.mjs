import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://127.0.0.1:${port}/?skiptitle=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__psyche?.ready, null, { timeout: 20000 });
await page.waitForTimeout(1200);
const info = await page.evaluate(() => {
  const s = window.__psyche.scene;
  const list = s.children.list.map(o => ({
    type: o.type, depth: o.depth, x: Math.round(o.x), y: Math.round(o.y),
    w: Math.round(o.displayWidth||0), h: Math.round(o.displayHeight||0),
    alpha: +(o.alpha||0).toFixed(2), blend: o.blendMode,
    frame: o.frame?.name, tex: o.texture?.key,
  }));
  const byDepth = list.sort((a,b)=>b.depth-a.depth).slice(0,25);
  return { count: list.length, top: byDepth, renderer: s.game.renderer.type };
});
console.log(JSON.stringify(info, null, 1).slice(0, 4000));
await browser.close(); await server.close();
