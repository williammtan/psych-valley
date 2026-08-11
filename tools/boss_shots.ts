/**
 * THE ECHO — phase-by-phase screenshots.
 *
 * The boss cannot be reviewed from a still of an empty room: every claim the
 * encounter makes is about what the player can *tell apart* mid-fight. So this
 * drives the real game into each specific moment that has to be legible and
 * captures it — in particular `p2_marks`, which is the one shot that decides
 * whether phase two works, because it has live and stale indicators on screen
 * at the same time with the brazier cue visible.
 *
 *   npx tsx tools/boss_shots.ts
 *   npx tsx tools/boss_shots.ts --shot p2_marks
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots', 'boss');

// ── page-side helpers, injected once per page load ──────────────────────────
// Written as a source string rather than an imported module because it has to
// run inside the game's window, next to __psyche and __boss.
const DRIVER = `
window.__bossDriver = (() => {
  const P = () => window.__psyche;
  const B = () => window.__boss;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function until(pred, timeout) {
    const t0 = performance.now();
    while (performance.now() - t0 < (timeout || 12000)) {
      let v = false;
      try { v = !!pred(); } catch (e) { v = false; }
      if (v) return true;
      await wait(40);
    }
    return false;
  }

  function player() { return P().state().player; }

  /** Walk to a world pixel position. */
  async function goTo(tx, ty, timeout) {
    const t0 = performance.now();
    while (performance.now() - t0 < (timeout || 3000)) {
      const p = player();
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 7) break;
      P().move(dx / d, dy / d);
      await wait(28);
    }
    P().stop();
  }

  /** Stand on the given side of the Echo, at reach, and swing. */
  async function strikeFrom(side, timeout) {
    const s = B().state();
    const off = { n: [0, -30], s: [0, 34], e: [34, -14], w: [-34, -14] }[side];
    await goTo(s.x + off[0], s.y - 20 + off[1], timeout || 2200);
    P().press('attack');
    await wait(320);
  }

  return { wait, until, goTo, strikeFrom, player };
})();
`;

interface Shot {
  name: string;
  note: string;
  /** Runs in the page; resolves when the moment to capture has arrived. */
  drive: string;
  hideHud?: boolean;
  settle?: number;
}

const SHOTS: Shot[] = [
  {
    name: 'arena',
    note: 'The chamber before anything happens',
    hideHud: true,
    drive: `await window.__bossDriver.wait(900);`,
  },
  {
    name: 'wake',
    note: 'The Echo comes up out of the drain',
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(1);
      await d.wait(900);
    `,
  },
  {
    name: 'p1_learn',
    note: 'PHASE ONE — it has seen the same approach twice and is guarding it. '
      + 'The afterimage of the last swing hangs where it expects the next one.',
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(1);
      await d.wait(700);
      await d.strikeFrom('s');
      await d.wait(500);
      await d.strikeFrom('s');
      await d.until(() => window.__boss.state().predicted, 4000);
      await d.wait(500);
    `,
  },
  {
    name: 'p1_punish',
    note: 'PHASE ONE — the same player attacks from a different side. The guard '
      + 'is in the wrong place and the Echo is staggered.',
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(1);
      await d.wait(700);
      await d.strikeFrom('s');
      await d.wait(450);
      await d.strikeFrom('s');
      await d.until(() => window.__boss.state().predicted, 4000);
      await d.strikeFrom('e');
      await d.wait(260);
    `,
  },
  {
    name: 'p2_marks',
    note: 'PHASE TWO — live and stale indicators on screen together. The live '
      + 'ones stand in the light of the brazier the Echo just passed.',
    hideHud: true,
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(2);
      await d.until(() => {
        const s = window.__boss.state();
        return s.indicators.length >= 4 && s.indicators.some((i) => i.live) && s.indicators.some((i) => !i.live);
      }, 20000);
      await d.wait(500);
    `,
  },
  {
    name: 'p2_marks_six',
    note: 'PHASE TWO at full ramp — six indicators, two braziers burning.',
    hideHud: true,
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(2);
      await d.until(() => {
        const s = window.__boss.state();
        return s.wave >= 2 && s.indicators.length >= 6;
      }, 40000);
      await d.wait(500);
    `,
  },
  {
    name: 'p3_sync',
    note: 'PHASE THREE — six followers, unanimous, boss shielded. One of them '
      + 'is flashing late.',
    hideHud: true,
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(3);
      await d.until(() => window.__boss.state().followers.length >= 5, 8000);
      await d.goTo(240, 210, 2000);
      // Capture on the beat, so the unison flash is what you see.
      await d.wait(1500);
    `,
  },
  {
    name: 'p3_break',
    note: 'PHASE THREE — the odd one out has been broken. The formation is gone '
      + 'and the shield with it.',
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(3);
      await d.until(() => window.__boss.state().followers.some((f) => f.odd), 8000);
      const odd = window.__boss.state().followers.find((f) => f.odd);
      await d.goTo(odd.x, odd.y + 26, 3000);
      for (let i = 0; i < 6; i++) {
        const s = window.__boss.state();
        if (!s.unanimous) break;
        const o = s.followers.find((f) => f.odd);
        if (o) await d.goTo(o.x, o.y + 24, 900);
        window.__psyche.press('attack');
        await d.wait(360);
      }
      await d.wait(420);
    `,
  },
  {
    name: 'death',
    note: 'The borrowed shapes falling away (plan.md §48)',
    hideHud: true,
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(3);
      await d.wait(400);
      window.__boss.defeat();
      await d.wait(1900);
    `,
  },
  {
    name: 'ending_vista',
    note: 'The valley, with more lights in it than there should be',
    drive: `
      const d = window.__bossDriver;
      window.__boss.phase(3);
      await d.wait(300);
      window.__boss.defeat();
      // Advance the dialogue to the vista.
      for (let i = 0; i < 60; i++) {
        window.__psyche.press('interact');
        await d.wait(320);
        if (document.body.dataset.done) break;
      }
    `,
    settle: 200,
  },
];

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  const server = await createServer({
    root: ROOT,
    server: {
      port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1',
      // Several areas are built in parallel, so the tree changes under us. HMR
      // would reload the page mid-capture and destroy the execution context.
      hmr: false,
      watch: { ignored: ['**/*'] },
    },
    logLevel: 'error',
  });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  // tsx keeps function names by wrapping them in a `__name` helper that does not
  // exist in the page; define it as identity or every nested closure throws.
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { __errors: string[] }).__errors = errors;
  return { browser, page, server, base: `http://127.0.0.1:${port}/` };
}

async function capture(page: Page, base: string, shot: Shot): Promise<string[]> {
  const errs = (page as unknown as { __errors: string[] }).__errors;
  errs.length = 0;
  await page.goto(`${base}?skiptitle=1&mute=1&map=shrine_boss`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 25000 }).catch(() => {});
  await page.evaluate((src) => { (0, eval)(src); }, DRIVER);
  await page.evaluate(() => (window as any).__psyche.jump('boss'));
  await page.waitForFunction(() => !!(window as any).__boss, undefined, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  if (shot.hideHud) await page.evaluate(() => (window as any).__psyche.hideHud(true));

  await page.evaluate(`(async () => { ${shot.drive} })()`).catch((e) => errs.push(`drive: ${String(e).slice(0, 200)}`));
  await page.waitForTimeout(shot.settle ?? 120);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${shot.name}.png`) });

  // Dump what the game thinks is on screen, so a reviewer can check the picture
  // against the state rather than guessing which ellipse was which.
  const state = await page.evaluate(() => (window as any).__boss?.state() ?? null).catch(() => null);
  if (state) {
    const inds = (state.indicators as Array<{ live: boolean }>) ?? [];
    const braz = (state.braziers as Array<{ lit: boolean }>) ?? [];
    const foll = (state.followers as Array<{ odd: boolean; dissenting: boolean }>) ?? [];
    console.log(
      `      state: phase ${state.phase} hp ${state.hp}/${state.maxHp}`
      + ` · marks ${inds.filter((i) => i.live).length} live / ${inds.filter((i) => !i.live).length} stale`
      + ` · braziers lit ${braz.filter((b) => b.lit).length}/${braz.length}`
      + ` · followers ${foll.length}${foll.some((f) => f.dissenting) ? ' (broken)' : ''}`
      + ` · ${state.staggered ? 'staggered' : state.shielded ? 'shielded' : 'active'}`,
    );
  }
  return [...errs];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = argv.includes('--shot') ? argv[argv.indexOf('--shot') + 1] : undefined;
  const list = only ? SHOTS.filter((s) => s.name === only) : SHOTS;
  if (!list.length) { console.error(`no shot '${only}'`); process.exit(1); }

  const { browser, page, server, base } = await boot();
  try {
    for (const shot of list) {
      const errors = await capture(page, base, shot);
      console.log(`  shots/boss/${shot.name}.png${errors.length ? `   ⚠ ${errors.length}` : ''}`);
      console.log(`      ${shot.note}`);
      errors.slice(0, 3).forEach((e) => console.log(`      ! ${e.slice(0, 200)}`));
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
