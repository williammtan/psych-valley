/**
 * THE ECHO — two bots, one question.
 *
 * The encounter's entire claim is that understanding beats reflexes: the three
 * phases are the game's three lessons in a new context, and a player who has
 * actually understood them should finish noticeably faster than one who is just
 * swinging. That is not a claim you can eyeball from a screenshot, so it is
 * measured.
 *
 *   NAIVE     always attacks from the same side, treats every mark on the floor
 *             as dangerous, and swings at whatever is nearest.
 *   INFORMED  baits the Echo into a read and then breaks it, stands clear of
 *             the burning quadrant instead of dodging the stale echoes, and
 *             goes straight for the follower that is out of step.
 *
 * Both bots have identical reflexes — same reaction time, same movement code,
 * same attack cadence. The ONLY difference between them is what they know. If
 * their times come out similar, the encounter is testing reaction speed and the
 * design has failed, so that is an assertion, not a note.
 *
 *   npx tsx tools/boss_playtest.ts
 *   npx tsx tools/boss_playtest.ts --runs 3
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { DRIVER } from './boss_bot';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots', 'boss');

/** Generous: a bot that has not won by now has demonstrated its point. */
const COMBAT_LIMIT_MS = 6 * 60 * 1000;
/** The informed run must be at least this much faster to count as a result. */
const REQUIRED_SPEEDUP = 1.4;

interface Metrics {
  mode: string;
  phaseMs: Record<string, number>;
  combatMs: number;
  totalMs: number;
  heartsLost: number;
  deaths: number;
  blocked: number;
  punished: number;
  deflected: number;
  unanimityBreaks: number;
  swings: number;
  completed: boolean;
  note: string;
}

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  const server = await createServer({
    root: ROOT,
    server: {
      port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1',
      // Other areas are being built in parallel; an HMR reload mid-run would
      // destroy the execution context and lose the measurement.
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
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { __errors: string[] }).__errors = errors;
  return { browser, page, server, base: `http://127.0.0.1:${port}/` };
}

async function run(page: Page, base: string, mode: 'naive' | 'informed'): Promise<{ m: Metrics; errors: string[] }> {
  const errs = (page as unknown as { __errors: string[] }).__errors;
  errs.length = 0;

  await page.goto(`${base}?skiptitle=1&mute=1&map=shrine_boss`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 30000 });
  await page.evaluate((src) => { (0, eval)(src); }, DRIVER);
  // Start from the checkpoint a real player reaches the chamber with.
  await page.evaluate(() => (window as any).__psyche.jump('boss'));
  await page.waitForFunction(() => !!(window as any).__boss, undefined, { timeout: 15000 });
  await page.waitForTimeout(600);

  const m = await page.evaluate(
    ([mo, limit]) => (window as any).__bossDriver.runBot(mo, limit),
    [mode, COMBAT_LIMIT_MS] as [string, number],
  ) as Metrics;

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `playtest_${mode}.png`) });
  return { m, errors: [...errs] };
}

function secs(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }

function report(m: Metrics): void {
  console.log(`  ${m.mode.toUpperCase().padEnd(9)} fight ${secs(m.combatMs).padStart(7)}`
    + `   p1 ${secs(m.phaseMs['1'] ?? 0).padStart(6)}`
    + `   p2 ${secs(m.phaseMs['2'] ?? 0).padStart(6)}`
    + `   p3 ${secs(m.phaseMs['3'] ?? 0).padStart(6)}`);
  console.log(`            ${m.swings} swings · ${m.heartsLost} hearts lost · ${m.deaths} death(s)`
    + ` · blocked ${m.blocked} · punished ${m.punished} · deflected ${m.deflected}`
    + ` · unanimity broken ${m.unanimityBreaks}`);
  if (m.note) console.log(`            note: ${m.note}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runs = argv.includes('--runs') ? Number(argv[argv.indexOf('--runs') + 1]) : 1;

  const { browser, page, server, base } = await boot();
  const problems: string[] = [];
  const all: Metrics[] = [];

  try {
    for (let i = 0; i < runs; i++) {
      if (runs > 1) console.log(`\n── run ${i + 1}/${runs} ──`);
      for (const mode of ['naive', 'informed'] as const) {
        const { m, errors } = await run(page, base, mode);
        all.push(m);
        report(m);
        errors.slice(0, 3).forEach((e) => problems.push(`[${mode}] ${e.slice(0, 200)}`));
      }
    }

    const mean = (mode: string, pick: (m: Metrics) => number) => {
      const xs = all.filter((m) => m.mode === mode).map(pick);
      return xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    };
    const naiveMs = mean('naive', (m) => m.combatMs);
    const infoMs = mean('informed', (m) => m.combatMs);
    const speedup = naiveMs / infoMs;

    console.log('\n── the measurement ──');
    console.log(`  naive     ${secs(naiveMs)}`);
    console.log(`  informed  ${secs(infoMs)}`);
    console.log(`  informed is ${speedup.toFixed(2)}x faster`);

    // ── assertions ──
    if (speedup < REQUIRED_SPEEDUP) {
      problems.push(
        `informed is only ${speedup.toFixed(2)}x faster (need ${REQUIRED_SPEEDUP}x) — `
        + 'the encounter is testing reflexes, not understanding',
      );
    }
    for (const m of all.filter((x) => x.mode === 'naive')) {
      if (m.combatMs < 12000) problems.push('naive bot finished implausibly fast — the fight is not a fight');
      if (m.deaths > 4) problems.push(`naive bot died ${m.deaths} times — failure is not cheap enough (§67)`);
      if (m.note) problems.push(`naive bot softlocked: ${m.note}`);
    }
    for (const m of all.filter((x) => x.mode === 'informed')) {
      if (m.note) problems.push(`informed bot softlocked: ${m.note}`);
      if (!m.completed) problems.push('game_complete was never set at the end of the informed run');
      if (m.punished < 1) problems.push('informed bot never punished a read — phase one is not rewarding variation');
      if (m.unanimityBreaks < 1) problems.push('informed bot never broke unanimity — phase three is not working');
    }
    // Every run has to reach the end of the prototype.
    for (const m of all) {
      if (!m.completed) problems.push(`[${m.mode}] never reached game_complete`);
    }

    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'playtest.json'), JSON.stringify({
      at: new Date().toISOString(), runs, speedup, naiveMs, infoMs, results: all, problems,
    }, null, 2));

    if (problems.length) {
      console.log('\n  ✗ problems');
      problems.forEach((p) => console.log(`      · ${p}`));
      process.exitCode = 1;
    } else {
      console.log('\n  ✓ understanding beats reflexes, both runs finished, game_complete set');
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
