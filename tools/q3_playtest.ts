/**
 * ACT IV PLAYTEST — the Lantern Trial, driven end to end in the real game.
 *
 *   npx tsx tools/q3_playtest.ts
 *
 * Boots the actual build in headless Chromium and plays the whole quest twice:
 * once conforming in round three, once dissenting. It asserts the things the
 * design of plan.md §16 actually depends on, rather than that the code runs:
 *
 *   - all four rounds happen, with the player asked in each
 *   - round two: villagers visibly move their answers onto Tavi's
 *   - round three: the group is unanimous, wrong, and the player answers last
 *   - round four: Nia breaks it with an answer that is also wrong, and others
 *     immediately give different answers
 *   - both conforming and dissenting proceed; neither is punished
 *   - `q3_conformed` records the choice and tracks THE GROUP, not the truth
 *   - the naming moment grants DISSENT and sets q3_complete /
 *     insight_conformity / south_gate_open
 *   - the terminology never appears before the Insight Card
 *
 * Modelled on tools/shot.ts. Exits non-zero on any failure.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type L = 'a' | 'b' | 'c';

interface RoundRecord {
  n: number;
  truth: L;
  group: L;
  answers: Record<string, L>;
  shifted: string[];
  player?: L;
  unanimous: boolean;
}

interface Snapshot {
  started: boolean;
  finished: boolean;
  round: number;
  awaitingRound: number;
  truth: L;
  group: L;
  answers: Record<string, L>;
  unanimous: boolean;
  history: RoundRecord[];
  participants: string[];
  conformed: boolean;
  named: boolean;
  heard: string[];
}

// ── tiny assertion harness ──────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) { passed++; console.log(`  ok    ${label}`); return; }
  failures.push(label);
  console.log(`  FAIL  ${label}${detail === undefined ? '' : `\n          ${JSON.stringify(detail)}`}`);
}

// ── boot ────────────────────────────────────────────────────────────────────

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  const server = await createServer({
    root: ROOT,
    // HMR off and the watcher muzzled: several agents edit this repo at once,
    // and a stray write mid-run reloads the page and resets the playthrough.
    server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } },
    logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  // tsx compiles with --keep-names, which wraps arrows in a `__name` helper the
  // page does not have. Defining it as identity fixes every evaluate().
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  (page as unknown as { __errors: string[] }).__errors = errors;
  return { browser, page, server, base: `http://127.0.0.1:${port}/` };
}

const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as any).__trial.snapshot() as Snapshot);

async function load(page: Page, base: string): Promise<void> {
  await page.goto(`${base}?skiptitle=1&map=festival&mute=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as any).__psyche?.ready && !!(window as any).__trial,
    undefined, { timeout: 30000 },
  );
  await page.evaluate(() => (window as any).__psyche.jump('festival'));
  await page.waitForTimeout(600);
}

/**
 * Play the ceremony through, answering each round with `answers[n]`, and return
 * the snapshot taken at the moment the game was waiting for each answer.
 */
async function playTrial(page: Page, answers: Record<number, L>): Promise<Snapshot[]> {
  await page.evaluate(() => (window as any).__trial.start({ fast: true }));
  const atPrompt: Snapshot[] = [];
  for (let r = 1; r <= 4; r++) {
    await page.waitForFunction(
      (n) => (window as any).__trial.snapshot().awaitingRound === n,
      r, { timeout: 60000 },
    );
    atPrompt.push(await snap(page));
    await page.evaluate((a) => (window as any).__trial.answer(a), answers[r]);
  }
  await page.waitForFunction(() => (window as any).__trial.snapshot().finished, undefined, { timeout: 60000 });
  return atPrompt;
}

/** Ask around, then let Sera name it and dismiss the Insight Card for real. */
async function finishQuest(page: Page): Promise<void> {
  for (const id of ['villager_b', 'villager_d', 'tavi']) {
    await page.evaluate((who) => (window as any).__trial.talkTo(who), id);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => (window as any).__trial.talkTo('sera'));
  // The card is a real modal; dismiss it the way a player does.
  await page.waitForTimeout(900);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(220);
    const done = await page.evaluate(() => (window as any).__psyche.flags().q3_complete === true);
    if (done) break;
  }
  await page.waitForTimeout(400);
}

const flags = (page: Page): Promise<Record<string, boolean>> =>
  page.evaluate(() => (window as any).__psyche.flags());
const abilities = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as any).__psyche.state().abilities as string[]);

// ── the run ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { browser, page, server, base } = await boot();
  try {
    // ── pass one: the player conforms in round three ────────────────────────
    console.log('\nRUN 1 — the player goes with the group in round three');
    await load(page, base);
    const before = await snap(page);
    check('trial has not started on arrival', !before.started && !before.finished);
    check('eight villagers stand in the trial', before.participants.length === 8, before.participants);
    check('the truth and the group disagree from round two', before.truth !== before.group,
      { truth: before.truth, group: before.group });

    const TRUTH = before.truth;
    const GROUP = before.group;

    const prompts = await playTrial(page, { 1: TRUTH, 2: TRUTH, 3: GROUP, 4: TRUTH });
    const s1 = await snap(page);
    const [r1, r2, r3, r4] = s1.history;

    check('all four rounds ran', s1.history.length === 4, s1.history.map((h) => h.n));
    check('the player was asked in every round',
      prompts.length === 4 && prompts.every((p, i) => p.awaitingRound === i + 1),
      prompts.map((p) => p.awaitingRound));

    // Round one — private, and easy.
    check('round one is answered before anyone else is visible',
      Object.keys(prompts[0].answers).length === 0, prompts[0].answers);
    const r1Right = Object.values(r1.answers).filter((v) => v === TRUTH).length;
    check('round one: almost everyone hears it correctly',
      r1Right >= Object.keys(r1.answers).length - 1, r1.answers);

    // Round two — the consensus visibly forms around Tavi.
    check('round two: Tavi is wrong', r2.answers.tavi === GROUP && GROUP !== TRUTH, r2.answers);
    check('round two: at least two villagers visibly change their answer',
      r2.shifted.length >= 2, r2.shifted);
    check('round two: everyone who changed ended on Tavi\'s answer',
      r2.shifted.every((id) => r2.answers[id] === r2.answers.tavi), r2.shifted);
    const withTavi = Object.values(r2.answers).filter((v) => v === r2.answers.tavi).length;
    check('round two: the group has moved onto Tavi', withTavi >= 5, r2.answers);
    check('round two: the player answers after seeing the group',
      Object.keys(prompts[1].answers).length >= 5, prompts[1].answers);

    // Round three — unanimity, and the player last.
    const r3vals = Object.values(r3.answers);
    check('round three: at least six villagers answer', r3vals.length >= 6, r3.answers);
    check('round three: the group is unanimous', r3.unanimous, r3.answers);
    check('round three: unanimously on the wrong lantern',
      r3vals.every((v) => v === GROUP) && GROUP !== TRUTH, { GROUP, TRUTH });
    check('round three: the whole group has spoken before the player is asked',
      Object.keys(prompts[2].answers).length === r3vals.length && prompts[2].unanimous,
      prompts[2].answers);

    // Round four — Nia, and the collapse.
    check('round four: Nia gives a different answer from the group',
      r4.answers.nia !== undefined && r4.answers.nia !== GROUP, r4.answers);
    check('round four: Nia is not right either', r4.answers.nia !== TRUTH, r4.answers.nia);
    const others = Object.entries(r4.answers).filter(([id]) => id !== 'nia');
    check('round four: at least two others then break from the group',
      others.filter(([, v]) => v !== GROUP).length >= 2, r4.answers);
    check('round four: the group is no longer unanimous', !r4.unanimous, r4.answers);
    check('round four: the player answers into a split group',
      new Set(Object.values(prompts[3].answers)).size >= 2, prompts[3].answers);

    // Conforming is recorded, and proceeds.
    check('conforming is recorded', s1.conformed === true);
    check('conforming proceeds to the end of the trial', s1.finished === true);

    await finishQuest(page);
    const f1 = await flags(page);
    const a1 = await abilities(page);
    check('conform path: q3_complete', f1.q3_complete === true);
    check('conform path: insight_conformity', f1.insight_conformity === true);
    check('conform path: south_gate_open', f1.south_gate_open === true);
    check('conform path: DISSENT granted', a1.includes('dissent'), a1);
    check('conform path: q3_conformed set', f1.q3_conformed === true);
    check('conform path: the insight is in the journal',
      await page.evaluate(() => (window as any).__psyche.scene !== undefined
        && !!(window as any).__psyche.state().flags.includes('insight_conformity')));

    // ── pass two: the player dissents in round three ────────────────────────
    console.log('\nRUN 2 — the player says the third lantern anyway');
    await load(page, base);
    const prompts2 = await playTrial(page, { 1: TRUTH, 2: TRUTH, 3: TRUTH, 4: TRUTH });
    const s2 = await snap(page);
    check('dissenting is recorded as not conforming', s2.conformed === false);
    check('dissenting proceeds to the end of the trial', s2.finished === true);
    check('dissent path: round three was still unanimous against the player',
      prompts2[2].unanimous === true, prompts2[2].answers);
    check('dissent path: all four rounds ran', s2.history.length === 4);

    await finishQuest(page);
    const f2 = await flags(page);
    const a2 = await abilities(page);
    check('dissent path: q3_complete', f2.q3_complete === true);
    check('dissent path: insight_conformity', f2.insight_conformity === true);
    check('dissent path: south_gate_open', f2.south_gate_open === true);
    check('dissent path: DISSENT granted', a2.includes('dissent'), a2);
    check('dissent path: q3_conformed NOT set', !f2.q3_conformed);
    check('neither choice is punished — both reach the same state',
      f1.q3_complete === f2.q3_complete
      && f1.south_gate_open === f2.south_gate_open
      && a1.includes('dissent') === a2.includes('dissent'));

    // ── run three: a player who answers wrongly in round one is not blocked ─
    console.log('\nRUN 3 — a player who mishears round one');
    await load(page, base);
    await playTrial(page, { 1: 'a', 2: TRUTH, 3: TRUTH, 4: TRUTH });
    const s3 = await snap(page);
    check('a wrong private answer still completes the trial', s3.finished === true);

    // ── the terminology rule ────────────────────────────────────────────────
    console.log('\nTERMINOLOGY');
    checkTerminology();

    // ── console health ──────────────────────────────────────────────────────
    const errs = (page as unknown as { __errors: string[] }).__errors;
    check('no console errors during the quest', errs.length === 0, errs.slice(0, 4));
    const missing = await page.evaluate(() => (window as any).__psyche.state().missingArt as string[]);
    check('no missing sprites reported', !missing || missing.length === 0, missing);
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

/**
 * The words this quest is about must not reach the player before the Insight
 * Card. Checked against the source, because that is where the guarantee has to
 * hold — a runtime check would only cover the lines this run happened to play.
 */
function checkTerminology(): void {
  const sources = [
    join(ROOT, 'src/data/dialogue/quest3_lantern.ts'),
    join(ROOT, 'src/world/areas/festival.ts'),
    join(ROOT, 'src/ui/LanternTrial.ts'),
    join(ROOT, 'src/world/maps/festival.ts'),
  ];
  const banned = ['normative', 'informational', 'social influence'];

  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    // Only player-visible strings matter; comments explain the design.
    const spoken = [...text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => (m[1] ?? m[2] ?? ''))
      .filter((s) => /\s/.test(s) && s.length > 12);
    const name = file.replace(`${ROOT}/`, '');
    for (const word of banned) {
      const hit = spoken.find((s) => s.toLowerCase().includes(word));
      check(`${name}: never says "${word}"`, !hit, hit);
    }
  }

  // "Conformity" is allowed exactly once, in the line that introduces the card.
  const q3 = readFileSync(join(ROOT, 'src/data/dialogue/quest3_lantern.ts'), 'utf8');
  const cardAt = q3.indexOf("insight('conformity')");
  const spokenHits = [...q3.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
    .filter((m) => /conformity/i.test(m[1]) && /\s/.test(m[1]))
    .map((m) => ({ text: m[1], at: m.index ?? 0 }));
  check('quest3_lantern: "conformity" is spoken exactly once', spokenHits.length === 1, spokenHits);
  check('quest3_lantern: and only as the line that reveals the card',
    cardAt > 0 && spokenHits.every((h) => h.at < cardAt && cardAt - h.at < 200), { cardAt, spokenHits });
}

main().catch((e) => { console.error(e); process.exit(1); });
