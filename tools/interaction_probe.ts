/**
 * Interaction regression probe.
 *
 * A playtest found that reading any piece of scenery locked the game forever:
 * the keypress that dismissed the dialogue was also read by the world, which
 * immediately re-opened the same dialogue, with the player unable to walk away.
 * Every automated check missed it because they drive the game through the debug
 * API instead of pressing keys like a player.
 *
 * This probe presses real keys. For each map it walks up to interactables,
 * reads them, dismisses them, and asserts the player can move afterwards.
 *
 *   npx tsx tools/interaction_probe.ts
 */
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS = ['inn', 'courier', 'lumen_vale', 'workshop', 'festival'];

const server = await createServer({
  root: ROOT,
  server: { port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  logLevel: 'error',
});
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page: Page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.addInitScript(() => { (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f; });

const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));

/** Real key events, not injected actions — the bug lived in the raw key path. */
async function tap(key: string, ms = 60): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(90);
}

async function pos(): Promise<{ x: number; y: number }> {
  const s = await page.evaluate(() => (window as any).__psyche.state());
  return { x: Math.round(s.player.x), y: Math.round(s.player.y) };
}

/** Can the player still walk? Holds a direction and checks they actually moved. */
async function canMove(): Promise<boolean> {
  const before = await pos();
  for (const key of ['a', 'd', 'w', 's']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(320);
    await page.keyboard.up(key);
    const after = await pos();
    if (Math.hypot(after.x - before.x, after.y - before.y) > 3) return true;
  }
  return false;
}

mkdirSync(join(ROOT, 'shots', 'probe'), { recursive: true });
let failures = 0;

for (const map of MAPS) {
  await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&mute=1&map=${map}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 });
  await page.waitForTimeout(1400);
  // Clear any arrival scene properly: tap until the game reports the cutscene
  // has ended, rather than assuming a fixed number of presses covers it.
  for (let i = 0; i < 80; i++) {
    const busy = await page.evaluate(() => (window as any).__psyche.state().cutscene);
    if (!busy) break;
    await tap('Space', 40);
  }
  await page.waitForTimeout(400);
  const stillBusy = await page.evaluate(() => (window as any).__psyche.state().cutscene);
  if (stillBusy) {
    failures++;
    console.log(`  ${map.padEnd(12)} ✗ arrival cutscene never released control`);
    continue;
  }

  const targets: Array<{ x: number; y: number; id: string }> = await page.evaluate(() => {
    const s = (window as any).__psyche.scene;
    return (s.interactions.items ?? [])
      .filter((i: { id: string }) => !i.id.startsWith('npc:'))
      .slice(0, 6)
      .map((i: { id: string; x: number; y: number }) => ({ id: i.id, x: i.x, y: i.y }));
  }).catch(() => []);

  if (!targets.length) {
    console.log(`  ${map.padEnd(12)} — no interactables registered`);
    continue;
  }

  let tested = 0;
  let locked = 0;
  for (const t of targets) {
    // Stand just below the prop and face it, then read it twice in a row —
    // the second read is what used to trap the player.
    await page.evaluate((p) => {
      const api = (window as any).__psyche;
      api.teleport(Math.round(p.x / 16), Math.round(p.y / 16) + 1);
      api.scene.player.face('n');
    }, t);
    await page.waitForTimeout(250);

    await tap('Space');          // open
    await page.waitForTimeout(450);

    // Drain the exchange the way a reader would — these are multi-line — and
    // count the presses. The lock signature is that the box NEVER closes no
    // matter how many times you press, so a generous cap distinguishes "a long
    // exchange" from "trapped".
    let presses = 0;
    const MAX_PRESSES = 40;
    while (presses < MAX_PRESSES) {
      // Drain while EITHER the box is open or a scene is still running: the
      // box closes for a frame between beats, and breaking out on that gap
      // reads a mid-exchange pause as a finished conversation.
      const busy = await page.evaluate(() => {
        const api = (window as any).__psyche;
        const ui = api.scene.game.scene.getScene('UI');
        return !!ui?.dialogue?.isOpen || api.state().cutscene;
      });
      if (!busy) break;
      await tap('Space');
      await page.waitForTimeout(160);
      presses++;
    }
    if (presses >= MAX_PRESSES) {
      failures++;
      await page.screenshot({ path: join(ROOT, 'shots', 'probe', `unclosable_${map}_${t.id.replace(/[^\w]/g, '_')}.png`) });
      console.log(`  ${map.padEnd(12)} ✗ '${t.id}' — dialogue would not close after ${MAX_PRESSES} presses`);
      continue;
    }
    await page.waitForTimeout(300);

    // Step off the prop before testing mobility: a repeating trigger zone under
    // the player would otherwise re-fire and look exactly like a lock.
    await page.keyboard.down('s');
    await page.waitForTimeout(260);
    await page.keyboard.up('s');
    await page.waitForTimeout(200);

    tested++;
    if (!(await canMove())) {
      // Distinguish an input lock from the probe simply having parked the
      // player inside solid geometry — they look identical from outside.
      const diag = await page.evaluate(() => {
        const api = (window as any).__psyche;
        const sc = api.scene;
        const st = api.state();
        const ui = sc.game.scene.getScene('UI');
        const grid = sc.collisionGrid();
        const tx = Math.floor(sc.player.x / 16);
        const ty = Math.floor((sc.player.y - 1) / 16);
        const solid = !!(grid[ty] && grid[ty][tx]);
        return {
          cutscene: st.cutscene,
          keysEnabled: sc.keys.enabled,
          playerMode: sc.player.mode,
          dialogueOpen: !!ui?.dialogue?.isOpen,
          wedged: solid,
        };
      });
      const cause = diag.wedged ? 'WEDGED IN GEOMETRY (probe placement, not a lock)'
        : diag.dialogueOpen ? 'DIALOGUE STILL OPEN'
        : diag.cutscene ? 'CUTSCENE NEVER ENDED'
        : !diag.keysEnabled ? 'INPUT LEFT DISABLED'
        : `player.mode=${diag.playerMode}`;
      if (!diag.wedged) { locked++; failures++; }
      await page.screenshot({ path: join(ROOT, 'shots', 'probe', `lock_${map}_${t.id.replace(/[^\w]/g, '_')}.png`) });
      console.log(`  ${map.padEnd(12)} ${diag.wedged ? '·' : '✗'} '${t.id}' — ${cause}`);
    }
  }
  if (!locked) console.log(`  ${map.padEnd(12)} ✓ ${tested} interactable(s) read and dismissed, player still mobile`);
}

if (errors.length) {
  console.log(`\n  ⚠ ${errors.length} page error(s):`);
  errors.slice(0, 5).forEach((e) => console.log(`    ${e.slice(0, 180)}`));
}
console.log(failures ? `\n  ${failures} soft lock(s)\n` : '\n  no soft locks\n');
await browser.close();
await server.close();
if (failures) process.exitCode = 1;
