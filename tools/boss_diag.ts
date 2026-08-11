import { chromium } from 'playwright';
import { createServer } from 'vite';
import { DRIVER } from './boss_bot';
const ROOT = '/home/william/psych';
async function main() {
  const server = await createServer({ root: ROOT, server: { port: 20000 + Math.floor(Math.random()*20000), strictPort: false, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.addInitScript(() => { (window as any).__name = (f: any) => f; });
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0,300)));
  page.on('console', m => { if (m.type()==='error') console.log('CONSOLE', m.text().slice(0,300)); });
  await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&mute=1&map=shrine_boss`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 30000 });
  await page.evaluate((src) => { (0, eval)(src); }, DRIVER);
  await page.evaluate(() => (window as any).__psyche.jump('boss'));
  await page.waitForFunction(() => !!(window as any).__boss, undefined, { timeout: 15000 });
  await page.waitForTimeout(500);
  const log = await page.evaluate(async () => {
    const d = (window as any).__bossDriver, B = () => (window as any).__boss;
    B().phase(2);
    const out: any[] = []; const t0 = performance.now();
    let swings = 0, cleanWaves = 0, lastHp = B().state().hp, lastWave = -1;
    while (performance.now() - t0 < 40000) {
      const s = B().state();
      if (s.wave !== lastWave) { lastWave = s.wave; }
      if (s.staggered) { swings++; await d.strikeAt(s.x, s.y, 1000); }
      else {
        const avoid = s.braziers.filter((x: any) => x.lit);
        if (avoid.length) { const sp = d.bestSpot(avoid); await d.goTo(sp.x, sp.y, 420); }
        else await d.wait(70);
      }
      if (out.length < 46) {
        const p = d.player();
        out.push(`t=${Math.round(performance.now()-t0)} w=${s.wave} hp=${s.hp} stag=${s.staggered?1:0} lit=${s.braziers.filter((b:any)=>b.lit).length} ind=${s.indicators.length} p=(${Math.round(p.x)},${Math.round(p.y)}) b=(${Math.round(s.x)},${Math.round(s.y)}) d=${Math.round(Math.hypot(s.x-p.x,s.y-p.y))}`);
      }
      if (s.hp < lastHp) { lastHp = s.hp; }
    }
    return { out, swings, finalHp: B().state().hp, phase: B().state().phase, tally: B().tally() };
  });
  log.out.forEach((l: string) => console.log(l));
  console.log('swings', log.swings, 'finalHp', log.finalHp, 'phase', log.phase, JSON.stringify(log.tally));
  await browser.close(); await server.close();
}
main();
