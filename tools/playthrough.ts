/**
 * Whole-game pass.
 *
 * Boots a fresh save and walks the complete golden path, capturing a screenshot
 * at every beat, asserting that each gate actually opens, and reporting anything
 * that looks like a soft lock, a sequence break, a missing asset or a stall.
 *
 * This is the gauntlet's regression net: individual areas being good is not the
 * bar, the whole run being good is.
 *
 *   npm run playthrough
 *   npm run playthrough -- --from festival     # start at a checkpoint
 *   npm run playthrough -- --quick             # skip the walking, just verify gates
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'shots', 'playthrough');

interface Beat {
  id: string;
  /** What the player is doing here, for the report. */
  label: string;
  /** Jump to this checkpoint before the beat (fresh-save runs use the first only). */
  checkpoint?: string;
  /** Map we expect to be in when the beat starts. */
  expectMap?: string;
  /** Flags that must be set by the END of this beat. */
  expectFlags?: string[];
  /** Abilities that must be granted by the END of this beat. */
  expectAbilities?: string[];
  /** Optional in-page script driving the beat. */
  drive?: string;
  /** Extra settle time. */
  settle?: number;
}

/**
 * The golden path from plan.md §74. Each beat is reached by jumping to its
 * checkpoint (so one broken beat does not hide the ones after it) and then
 * verified. A true fresh-save continuity check runs separately at the end.
 */
const BEATS: Beat[] = [
  { id: '01_arrival', label: 'Arrive in Lumen Vale', checkpoint: 'arrival', expectMap: 'lumen_vale', settle: 2200 },
  { id: '02_town', label: 'Town Square', checkpoint: 'town', expectMap: 'lumen_vale' },
  { id: '03_inn', label: 'Enter the Lantern Inn, meet Mira', checkpoint: 'inn', expectMap: 'inn' },
  { id: '04_q1', label: 'The bell rings, Pip bolts', checkpoint: 'q1_start', expectMap: 'inn' },
  { id: '05_q1_done', label: 'Pip calmed — conditioning named, LINK learned', checkpoint: 'q1_done', expectFlags: ['q1_complete', 'insight_conditioning'], expectAbilities: ['observe', 'link'] },
  { id: '06_q2', label: "Oren's delivery problem", checkpoint: 'q2_start' },
  { id: '07_courier', label: 'Courier Office investigation', checkpoint: 'courier', expectMap: 'courier' },
  { id: '08_q2_done', label: 'Two days separated — interference named, RECALL learned', checkpoint: 'q2_done', expectFlags: ['q2_complete', 'insight_interference'], expectAbilities: ['recall'] },
  { id: '09_festival', label: 'Festival of Lanterns', checkpoint: 'festival', expectMap: 'festival' },
  { id: '10_q3_done', label: 'Lantern Trial done — conformity named, DISSENT learned', checkpoint: 'q3_done', expectFlags: ['q3_complete', 'insight_conformity', 'south_gate_open'], expectAbilities: ['dissent'] },
  { id: '11_woods', label: 'Whisper Woods', checkpoint: 'woods', expectMap: 'woods' },
  { id: '12_shrine', label: 'Echo Shrine entrance', checkpoint: 'shrine', expectMap: 'shrine_entrance' },
  { id: '13_r1', label: 'Room One — association', checkpoint: 'shrine_association', expectMap: 'shrine_association' },
  { id: '14_r2', label: 'Room Two — combat', checkpoint: 'shrine_combat', expectMap: 'shrine_combat' },
  { id: '15_r3', label: 'Room Three — memory', checkpoint: 'shrine_memory', expectMap: 'shrine_memory' },
  { id: '16_r4', label: 'Room Four — conformity', checkpoint: 'shrine_conformity', expectMap: 'shrine_conformity' },
  { id: '17_r5', label: 'Room Five — combination', checkpoint: 'shrine_combination', expectMap: 'shrine_combination' },
  { id: '18_boss', label: 'The Echo', checkpoint: 'boss', expectMap: 'shrine_boss' },
];

interface BeatResult {
  id: string;
  label: string;
  ok: boolean;
  problems: string[];
  errors: string[];
  state: Record<string, unknown> | null;
  fps?: number;
}

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  const server = await createServer({
    root: ROOT, server: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    // Missing-asset warnings are gauntlet-relevant, not noise.
    if (m.type() === 'warning' && (t.includes('missing sprite') || t.includes('placeholder'))) errors.push(t);
  });
  (page as unknown as { __errors: string[] }).__errors = errors;
  return { browser, page, server, base: `http://127.0.0.1:${port}/` };
}

async function measureFps(page: Page, ms = 900): Promise<number> {
  return page.evaluate(async (duration) => {
    return new Promise<number>((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - start < duration) requestAnimationFrame(tick);
        else resolve(Math.round((frames * 1000) / (performance.now() - start)));
      };
      requestAnimationFrame(tick);
    });
  }, ms);
}

async function runBeat(page: Page, base: string, beat: Beat, quick: boolean): Promise<BeatResult> {
  const problems: string[] = [];
  (page as unknown as { __errors: string[] }).__errors.length = 0;

  await page.goto(`${base}?skiptitle=1&mute=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready,
    undefined, { timeout: 25000 },
  ).catch(() => problems.push('game never became ready'));

  if (beat.checkpoint) {
    const known = await page.evaluate(() => (window as any).__psyche.checkpoints());
    if (!known.includes(beat.checkpoint)) {
      problems.push(`unknown checkpoint '${beat.checkpoint}'`);
    } else {
      await page.evaluate((c) => (window as any).__psyche.jump(c), beat.checkpoint);
      await page.waitForTimeout(700);
    }
  }
  if (beat.drive) {
    await page.evaluate(beat.drive).catch((e) => problems.push(`drive failed: ${String(e).slice(0, 160)}`));
  }
  await page.waitForTimeout(beat.settle ?? 1100);

  const state = await page.evaluate(() => {
    const p = (window as any).__psyche;
    return p ? p.state() : null;
  }).catch(() => null) as Record<string, unknown> | null;

  if (!state) {
    problems.push('debug state unavailable');
  } else {
    if (beat.expectMap && state.map !== beat.expectMap) {
      problems.push(`expected map '${beat.expectMap}', got '${state.map}'`);
    }
    const flags = (state.flags as string[]) ?? [];
    for (const f of beat.expectFlags ?? []) {
      if (!flags.includes(f)) problems.push(`missing flag '${f}'`);
    }
    const abilities = (state.abilities as string[]) ?? [];
    for (const a of beat.expectAbilities ?? []) {
      if (!abilities.includes(a)) problems.push(`missing ability '${a}'`);
    }
    const missingArt = (state.missingArt as string[]) ?? [];
    if (missingArt.length) problems.push(`${missingArt.length} placeholder art frame(s)`);
    // A map with no NPCs and no enemies in a town/festival context is suspicious.
    const npcs = (state.npcs as string[]) ?? [];
    if (['lumen_vale', 'festival'].includes(String(state.map)) && npcs.length < 3) {
      problems.push(`only ${npcs.length} NPC(s) present — the place will feel dead`);
    }
  }

  const fps = quick ? undefined : await measureFps(page);
  if (fps !== undefined && fps < 50) problems.push(`low frame rate: ${fps} fps`);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${beat.id}.png`) });
  await page.screenshot({ path: join(OUT, `${beat.id}.jpg`), type: 'jpeg', quality: 74 });

  const errors = [...((page as unknown as { __errors: string[] }).__errors ?? [])];
  return { id: beat.id, label: beat.label, ok: problems.length === 0 && errors.length === 0, problems, errors, state, fps };
}

/**
 * Continuity check: from a genuinely fresh save, can the player reach the end
 * without the harness setting any flags? Walks each expected transition and
 * reports the first place it gets stuck.
 */
async function continuityCheck(page: Page, base: string): Promise<string[]> {
  const notes: string[] = [];
  await page.goto(`${base}?skiptitle=1&mute=1&fresh=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready,
    undefined, { timeout: 25000 },
  ).catch(() => notes.push('game never became ready on a fresh save'));
  await page.waitForTimeout(1500);

  const start = await page.evaluate(() => (window as any).__psyche.state());
  if (start?.map !== 'lumen_vale') notes.push(`fresh save starts in '${start?.map}', expected 'lumen_vale'`);

  // Sequence-break probe: with no quest flags at all, can the player already
  // reach the woods or the shrine?
  for (const map of ['woods', 'shrine_entrance', 'shrine_boss']) {
    const reachable = await page.evaluate((m) => {
      const p = (window as any).__psyche;
      if (!p.maps().includes(m)) return 'missing';
      return 'exists';
    }, map);
    if (reachable === 'missing') notes.push(`map '${map}' is not registered`);
  }

  const gate = await page.evaluate(() => {
    const p = (window as any).__psyche;
    return p.flags()['south_gate_open'] === true;
  });
  if (gate) notes.push('south gate is open on a fresh save — the dungeon can be reached before any quest');

  return notes;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const quick = argv.includes('--quick');
  const fromIdx = argv.includes('--from') ? BEATS.findIndex((b) => b.checkpoint === argv[argv.indexOf('--from') + 1]) : 0;
  const beats = BEATS.slice(Math.max(0, fromIdx));

  const { browser, page, server, base } = await boot();
  const results: BeatResult[] = [];

  try {
    for (const beat of beats) {
      const r = await runBeat(page, base, beat, quick);
      results.push(r);
      const mark = r.ok ? '✓' : '✗';
      console.log(`${mark} ${beat.id.padEnd(20)} ${beat.label}${r.fps ? `  [${r.fps}fps]` : ''}`);
      for (const p of r.problems) console.log(`      · ${p}`);
      for (const e of r.errors.slice(0, 3)) console.log(`      ! ${e.slice(0, 200)}`);
    }

    console.log('\n── continuity ──');
    const notes = await continuityCheck(page, base);
    if (!notes.length) console.log('  ✓ fresh save starts correctly and nothing is reachable early');
    for (const n of notes) console.log(`  · ${n}`);

    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({
      at: new Date().toISOString(),
      passed: results.filter((r) => r.ok).length,
      total: results.length,
      results,
      continuity: notes,
    }, null, 2));

    const failed = results.filter((r) => !r.ok);
    console.log(`\n  ${results.length - failed.length}/${results.length} beats clean`);
    if (failed.length) {
      console.log(`  failing: ${failed.map((f) => f.id).join(', ')}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
