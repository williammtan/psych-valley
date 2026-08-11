/**
 * QUEST ONE PLAYTEST — "The Bell and the Cat".
 *
 * Plays the whole quest through the real game in headless Chromium, using only
 * the debug API and real key presses, and asserts the sequence a player would
 * actually experience:
 *
 *   walk in → bell → Pip bolts → quest starts
 *   → clues found → Mira's account → Sera arrives
 *   → bell taken → first ring → fear falls with each safe ring
 *   → a ring followed by a scare puts the fear back up  (the mechanic)
 *   → four clean rings → Pip out, storeroom clear
 *   → q1_complete + insight_conditioning + LINK
 *
 * Screenshots land in shots/q1/. Run:  npx tsx tools/q1_playtest.ts
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'shots', 'q1');

interface Check { name: string; ok: boolean; detail?: string }
const checks: Check[] = [];
const errors: string[] = [];
let shotN = 0;

function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// ── page helpers ────────────────────────────────────────────────────────────

/** Everything the quest exposes about itself, read straight out of the game. */
async function probe(page: Page): Promise<{
  flags: string[]; abilities: string[]; objective: string | null; cutscene: boolean;
  quests: Array<{ id: string; active: boolean; complete: boolean }>;
  fear: number; pipState: string; pipX: number; pipY: number;
  calmRings: number; insights: string[]; hasBell: boolean;
}> {
  return page.evaluate(() => {
    const p = (window as any).__psyche;
    const st = p.state();
    const S = (window as any).__state;
    const pip = (window as any).__pip;
    return {
      flags: st.flags,
      abilities: st.abilities,
      objective: st.objective,
      cutscene: st.cutscene,
      quests: st.quests,
      fear: pip ? pip.fear : -1,
      pipState: pip ? pip.state : '?',
      pipX: pip ? pip.x : -1,
      pipY: pip ? pip.y : -1,
      calmRings: S ? (S.counters.q1_calm_rings ?? 0) : -1,
      insights: S ? Object.keys(S.insights).filter((k: string) => S.insights[k].unlocked) : [],
      hasBell: st.flags.includes('have_hand_bell'),
    };
  });
}

async function shot(page: Page, label: string): Promise<void> {
  shotN += 1;
  const name = `${String(shotN).padStart(2, '0')}_${label}`;
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`        shots/q1/${name}.png`);
}

/** Hold a direction for `ms`, letting the real movement code run. */
async function walk(page: Page, dx: number, dy: number, ms: number): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__psyche.move(Number(x), Number(y)), [dx, dy]);
  await page.waitForTimeout(ms);
  await page.evaluate(() => (window as any).__psyche.stop());
  await page.waitForTimeout(120);
}

async function at(page: Page, tx: number, ty: number): Promise<void> {
  await page.evaluate(([x, y]) => (window as any).__psyche.teleport(Number(x), Number(y)), [tx, ty]);
  await page.waitForTimeout(160);
}

/** Advance dialogue until the world hands control back. */
async function clearDialogue(page: Page, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    const busy = await page.evaluate(() => {
      const p = (window as any).__psyche;
      const ui = (window as any).__ui;
      return p.state().cutscene || !!ui?.dialogue?.isOpen || !!ui?.insight?.isOpen;
    });
    if (!busy) return;
    await page.keyboard.press('Space');
    await page.waitForTimeout(230);
  }
}

/** Press interact, then clear whatever it opened. */
async function interact(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__psyche.press('interact'));
  await page.waitForTimeout(320);
  await clearDialogue(page);
}

/** Face a direction so the interaction cone points at the right thing. */
async function face(page: Page, dir: 'n' | 's' | 'e' | 'w'): Promise<void> {
  const v = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[dir];
  await walk(page, v[0], v[1], 90);
}

/**
 * Ring the hand bell and wait out the pairing window undisturbed.
 * Mirrors exactly what a player does: stand near Pip, press interact with
 * nothing else in reach, then keep the room quiet.
 */
async function safeRing(page: Page): Promise<void> {
  await waitForQuietWindow(page);
  await page.evaluate(() => (window as any).__psyche.press('interact'));
  await page.waitForTimeout(2600);
  await clearDialogue(page);
  await page.waitForTimeout(400);
}

/**
 * Wait until the tower bell is far enough away that a ring can survive its
 * two seconds — the read a player makes by ear.
 */
async function waitForQuietWindow(page: Page): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const ms = await page.evaluate(() => (window as any).__q1?.msToTower ?? 9999);
    if (ms > 5200) return;
    await page.waitForTimeout(400);
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server: ViteDevServer = await createServer({
    root: ROOT, server: { port: 0, strictPort: false, host: '127.0.0.1' }, logLevel: 'error',
  });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;

  const browser: Browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  // tsx keeps function names by rewriting arrows through a __name helper that
  // does not exist inside the page; identity makes every evaluate() work.
  await page.addInitScript(() => { (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f; });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    if (m.type() === 'warning' && /missing sprite|missing frame/i.test(t)) errors.push(t);
  });

  try {
    console.log('\nQUEST ONE — THE BELL AND THE CAT\n');

    await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&map=inn&spawn=default`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as any).__psyche?.ready, undefined, { timeout: 30000 });
    await page.evaluate(() => {
      const p = (window as any).__psyche;
      p.setFlag('intro_done');
      p.grant('observe');
    });
    await page.waitForTimeout(900);

    // ── SETUP ───────────────────────────────────────────────────────────────
    console.log('SETUP');
    let s = await probe(page);
    check('the inn loads with Pip out on the hearth rug', s.fear === 0 && s.pipY < 140, `fear=${s.fear} y=${Math.round(s.pipY)}`);
    await shot(page, 'arrival');

    // Walk in. The bell fires off a trigger zone, exactly as for a player.
    await walk(page, 0, -1, 1400);
    await page.waitForTimeout(600);
    await clearDialogue(page);
    await page.waitForTimeout(700);

    s = await probe(page);
    check('the town bell starts quest one', s.flags.includes('q1_started'));
    check('Pip bolted', s.flags.includes('pip_bolted'));
    check('Pip is hiding, frightened', s.fear >= 99 && (s.pipState === 'hiding' || s.pipState === 'scared'), `fear=${s.fear} state=${s.pipState}`);
    check('Pip crossed the room to the settle', s.pipX > 300, `x=${Math.round(s.pipX)}`);
    check('the quest is active with an objective', !!s.objective, s.objective ?? 'none');
    await shot(page, 'pip_bolted');

    // ── INVESTIGATION ───────────────────────────────────────────────────────
    console.log('\nINVESTIGATION');

    // The new pipework, in the kitchen.
    await at(page, 24, 7);
    await face(page, 'n');
    await interact(page);
    s = await probe(page);
    check('clue: the repaired pipe run', s.flags.includes('clue_pipes'));

    // Claw marks under the settle.
    await at(page, 22, 11);
    await face(page, 'n');
    await interact(page);
    s = await probe(page);
    check('clue: the claw marks', s.flags.includes('clue_scratches'));
    await shot(page, 'clue_scratches');

    // The basket under the window, across the room.
    await at(page, 8, 5);
    await face(page, 'n');
    await interact(page);
    s = await probe(page);
    check('clue: the unused basket', s.flags.includes('clue_catbed'));

    // Mira's account: bell, then the pipe. Four nights.
    await at(page, 13, 8);
    await face(page, 'n');
    await interact(page);
    await clearDialogue(page);
    s = await probe(page);
    check("clue: Mira's account of the storm", s.flags.includes('clue_mira_pipes'));
    check('Sera has arrived to watch', s.flags.includes('met_sera'));
    check('the investigation step is done', !!s.objective && !/Look around/i.test(s.objective), s.objective ?? '');
    await shot(page, 'sera_arrived');

    // ── THE BELL ────────────────────────────────────────────────────────────
    console.log('\nTHE PUZZLE');
    await at(page, 12, 8);
    await face(page, 'n');
    await interact(page);
    s = await probe(page);
    check('the hand bell is taken', s.hasBell);
    await shot(page, 'bell_taken');

    // Out of earshot: a ring across the building does nothing to him.
    await at(page, 6, 12);
    const beforeFar = (await probe(page)).fear;
    await safeRing(page);
    s = await probe(page);
    check('ringing out of earshot changes nothing', s.fear === beforeFar && s.calmRings === 0,
      `fear ${beforeFar}→${s.fear}, rings=${s.calmRings}`);
    await shot(page, 'ring_out_of_range');

    // In earshot. The first ring plays out and counts.
    await at(page, 22, 11);
    await page.waitForTimeout(300);
    await safeRing(page);
    s = await probe(page);
    check('the first ring registers', s.flags.includes('bell_startled'));
    check('fear falls after one safe ring', s.fear < 100, `fear=${s.fear}`);
    const afterFirst = s.fear;
    await shot(page, 'first_ring');

    // A second safe ring — progress is monotonic while the room stays quiet.
    await at(page, 22, 11);
    await safeRing(page);
    s = await probe(page);
    check('fear falls again on the second safe ring', s.fear < afterFirst, `fear ${afterFirst}→${s.fear}`);
    check('Pip has come further out from under the settle', s.pipY > 150, `y=${Math.round(s.pipY)}`);
    await shot(page, 'two_safe_rings');

    // ── THE MECHANIC: spoil a ring on purpose ───────────────────────────────
    console.log('\nRE-PAIRING (the ring that goes wrong)');
    const beforeSpoil = (await probe(page)).fear;
    await at(page, 22, 11);
    await waitForQuietWindow(page);
    await page.evaluate(() => (window as any).__psyche.press('interact'));
    await page.waitForTimeout(500);
    // Something loud, immediately after the bell: the player's own sword.
    await page.evaluate(() => (window as any).__psyche.press('attack'));
    await page.waitForTimeout(1400);
    await clearDialogue(page);
    s = await probe(page);
    check('a scare just after a ring puts the fear back up', s.fear > beforeSpoil,
      `fear ${beforeSpoil}→${s.fear}`);
    check('the calm rings are reset', s.calmRings === 0, `rings=${s.calmRings}`);
    check('the game records the spoiled pairing', s.flags.includes('bell_spoiled'));
    await shot(page, 'ring_spoiled');

    // ── FINISH IT ───────────────────────────────────────────────────────────
    console.log('\nEXTINCTION');
    for (let i = 0; i < 6; i++) {
      s = await probe(page);
      if (s.flags.includes('pip_calm')) break;
      await at(page, 22, 11);
      await safeRing(page);
      const now = await probe(page);
      console.log(`        ring ${i + 1}: rings=${now.calmRings} fear=${Math.round(now.fear)} state=${now.pipState}`);
    }
    await clearDialogue(page, 120);
    await page.waitForTimeout(600);

    s = await probe(page);
    check('four clean rings and Pip comes out', s.flags.includes('pip_calm'), `fear=${Math.round(s.fear)}`);
    check('Pip is out from under the furniture', s.pipState !== 'hiding', `state=${s.pipState}`);
    await shot(page, 'pip_out');

    // The naming moment and the ability run straight on from pipOut.
    await clearDialogue(page, 160);
    await page.waitForTimeout(700);
    await clearDialogue(page, 160);

    s = await probe(page);
    check('q1_complete is set', s.flags.includes('q1_complete'));
    check('q1_done is set (dialogue stage advances)', s.flags.includes('q1_done'));
    check('the quest is marked complete', !!s.quests.find((q) => q.id === 'q1_pip')?.complete);
    check('insight_conditioning is set', s.flags.includes('insight_conditioning'));
    check('the conditioning insight is unlocked in the journal', s.insights.includes('conditioning'));
    check('LINK is granted', s.abilities.includes('link'));
    check('Sera has been met', s.flags.includes('met_sera'));
    await shot(page, 'after_insight');

    // ── AFTERWARDS ──────────────────────────────────────────────────────────
    console.log('\nAFTERWARDS');
    const storeroom = await page.evaluate(() => {
      const p = (window as any).__psyche;
      const g = p.scene.collisionGrid();
      // The tiles the crates and the settle were standing on.
      return { crates: g[7][22], settle: g[10][21] };
    });
    check('the storeroom corner is clear again', !storeroom.crates && !storeroom.settle,
      `crates=${storeroom.crates} settle=${storeroom.settle}`);

    // The whole point of the epilogue: the same bell, and nothing happens.
    await at(page, 22, 11);
    await page.waitForTimeout(400);
    const calmBefore = await probe(page);
    await page.evaluate(() => (window as any).__psyche.press('interact'));
    await page.waitForTimeout(1200);
    s = await probe(page);
    check('a calm Pip no longer flees the bell', s.fear <= calmBefore.fear + 1 && s.pipState !== 'hiding',
      `fear=${Math.round(s.fear)} state=${s.pipState}`);
    await shot(page, 'calm_pip_and_bell');

  } catch (e) {
    check('the run completed without throwing', false, (e as Error).message.slice(0, 300));
    await shot(page, 'crash').catch(() => {});
  } finally {
    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    if (errors.length) {
      console.log(`\n${errors.length} console error(s):`);
      [...new Set(errors)].slice(0, 12).forEach((e) => console.log(`  ${e.slice(0, 240)}`));
    } else {
      console.log('\nno console errors, no missing sprites');
    }
    writeFileSync(join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), checks, errors }, null, 2));
    await browser.close();
    await server.close();
    process.exitCode = failed.length ? 1 : 0;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
