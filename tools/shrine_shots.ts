/**
 * Screenshot the Echo Shrine.
 *
 * Boots straight into each room by URL rather than through a checkpoint jump —
 * a jump leaves the town arrival cutscene's movePlayer handler attached and it
 * drags the player across the room while the camera is settling — and pre-sets
 * the "already read" flags so the room-entry narration box is not covering the
 * bottom third of every composition review.
 *
 *   npx tsx tools/shrine_shots.ts            # all rooms
 *   npx tsx tools/shrine_shots.ts r5         # one
 *   npx tsx tools/shrine_shots.ts --hud      # keep the HUD
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots');
const argv = process.argv.slice(2);
const KEEP_HUD = argv.includes('--hud');
const only = argv.find((a) => !a.startsWith('--'));

interface Shot {
  name: string;
  map: string;
  /** Where to stand. Omit for the room's default spawn. */
  at?: [number, number];
  settle?: number;
  note: string;
}

const SHOTS: Shot[] = [
  { name: 'r0_entrance_stair', map: 'shrine_entrance', at: [14, 6], note: 'the descent' },
  { name: 'r0_entrance_hall', map: 'shrine_entrance', at: [14, 16], note: 'the entrance hall' },
  { name: 'r1', map: 'shrine_association', note: 'room one — association' },
  { name: 'r2', map: 'shrine_combat', note: 'room two — combat' },
  { name: 'r3', map: 'shrine_memory', note: 'room three — memory' },
  { name: 'r4', map: 'shrine_conformity', note: 'room four — conformity' },
  { name: 'r5', map: 'shrine_combination', note: 'room five — combination' },
];

const SETUP = `
  ['met_mira','intro_done','q1_complete','q2_complete','q3_complete',
   'insight_conditioning','insight_interference','insight_conformity',
   'south_gate_open','woods_cleared','shrine_entered','shrine_arrival_done','shrine_echo_seen',
   'shrine_r1_seen','shrine_r2_seen','shrine_r3_seen','shrine_r4_seen','shrine_r5_seen'
  ].forEach(f => window.__psyche.setFlag(f));
  ['observe','link','recall','dissent'].forEach(a => window.__psyche.grant(a));
`;

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
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
});
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

mkdirSync(OUT, { recursive: true });
for (const shot of SHOTS.filter((s) => !only || s.name === only)) {
  errors.length = 0;
  await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&mute=1&map=${shot.map}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready,
    undefined, { timeout: 30000 },
  );
  await page.evaluate(SETUP);
  // The room's entry narration already fired on the first load, before the
  // flags above existed. Dismiss it, then reload the room so the trigger — now
  // marked as seen — stays quiet and the composition is unobstructed.
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(140); }
  await page.evaluate((m) => (window as unknown as { __psyche: { goto(m: string): void } }).__psyche.goto(m), shot.map);
  await page.waitForTimeout(500);
  for (let i = 0; i < 2; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(140); }
  if (shot.at) {
    await page.evaluate(([x, y]) => (window as unknown as { __psyche: { teleport(x: number, y: number): void } }).__psyche.teleport(x, y), shot.at);
  }
  if (!KEEP_HUD) {
    await page.evaluate(() => (window as unknown as { __psyche: { hideHud(h: boolean): void } }).__psyche.hideHud(true));
  }
  await page.waitForTimeout(shot.settle ?? 1500);
  await page.screenshot({ path: join(OUT, `${shot.name}.png`) });
  console.log(`  shots/${shot.name}.png   ${shot.note}${errors.length ? `   ⚠ ${errors.length} error(s)` : ''}`);
  errors.slice(0, 3).forEach((e) => console.log(`      ${e.slice(0, 200)}`));
}

await browser.close();
await server.close();
