import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ root: process.cwd(), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(`http://127.0.0.1:${port}/?mute=1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.waitForFunction(() => !!window.__audio, null, { timeout: 30000 });
for (const t of ['festival']) {
  const a = await page.evaluate(async (n) => await window.__audio.renderMusic(n, 12), t);
  console.log(t, 'peak', a.peak.toFixed(3), 'rms', a.rms.toFixed(4));
  console.log(a.windows.map((w,i)=> (w<8e-4? `[${(i/10).toFixed(1)}s ---]` : (i%10===0?`|${(i/10).toFixed(0)}s`:'') + w.toFixed(3))).join(' '));
}
await browser.close(); await server.close();
