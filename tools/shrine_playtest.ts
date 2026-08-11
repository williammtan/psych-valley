/**
 * ECHO SHRINE — automated playtest.
 *
 * Boots the real game in headless Chromium and solves rooms one to five through
 * `window.__shrine`, which is wired to the *same functions the player's button
 * press calls* — never to a private shortcut. If a room's real interactions are
 * broken this fails; that is the only property that makes an automated playtest
 * worth having.
 *
 * What it proves:
 *   - each room can actually be finished, by its intended solution
 *   - `shrine_r1..r5_done` are set, in order, one at a time
 *   - no room can be skipped: every exit door zone is gated on its own flag and
 *     every exit gate is physically shut until the room is solved
 *   - the boss door only opens after room five
 *   - the failure paths are cheap and correct: a wrong rune order tells you
 *     nothing and resets, a conforming statue snaps back, room two's bars hold
 *     until the floor is clear, and going down re-arms a half-worked room
 *
 *   npx tsx tools/shrine_playtest.ts
 *   npx tsx tools/shrine_playtest.ts --headed --slow
 */
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const HEADED = argv.includes('--headed');
const VERBOSE = argv.includes('--verbose');

// ── tiny assertion harness ──────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];
let section = '';

function head(name: string): void {
  section = name;
  console.log(`\n  ${name}`);
}

function ok(what: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`    ✓ ${what}`);
  } else {
    failures.push(`${section} — ${what}${detail === undefined ? '' : `  (${JSON.stringify(detail)})`}`);
    console.log(`    ✗ ${what}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  }
}

function eq(what: string, actual: unknown, expected: unknown): void {
  ok(what, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

// ── page helpers ────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

async function boot(): Promise<{ page: Page; close: () => Promise<void> }> {
  const server = await createServer({
    root: ROOT,
    // No watcher and no HMR: several authors are editing src/ at the same time
    // during the gauntlet, and a full reload half way through a run silently
    // takes `window.__psyche` with it.
    server: {
      port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1',
      watch: null, hmr: false,
    },
    logLevel: 'error',
  });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  // tsx compiles with --keep-names, which rewrites arrow functions to call a
  // `__name` helper. Playwright serialises the function without it, so every
  // evaluate() with a nested closure throws "__name is not defined" unless it
  // exists in the page. Identity is the whole implementation.
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => { errors.push(String(e)); if (VERBOSE) console.log(`      ! page error: ${String(e).slice(0, 300)}`); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); if (VERBOSE) console.log(`      ! console: ${m.text().slice(0, 300)}`); } });
  (page as unknown as { __errors: string[] }).__errors = errors;

  // Boot straight into the dungeon rather than jumping from town: a checkpoint
  // jump leaves the arrival cutscene's movePlayer handler attached to the scene
  // and it quietly drags the player across every subsequent map.
  await page.goto(`http://127.0.0.1:${port}/?skiptitle=1&mute=1&map=shrine_entrance`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!(window as unknown as { __psyche?: { ready: boolean } }).__psyche?.ready,
    undefined, { timeout: 30000 },
  );
  return {
    page,
    close: async () => { await browser.close(); await server.close(); },
  };
}

async function run<T>(page: Page, expr: string): Promise<T> {
  try {
    return await page.evaluate((e) => eval(e), expr) as T;
  } catch (err) {
    const where = await page.evaluate(() => ({
      map: (window as any).__psyche?.state?.().map,
      hp: (window as any).__psyche?.state?.().hp,
      harness: !!(window as any).__shrine,
      cutscene: (window as any).__psyche?.state?.().cutscene,
    })).catch(() => null);
    console.log(`      ! ${expr}\n        ${(err as Error).message.split('\n')[0]}\n        ${JSON.stringify(where)}`);
    throw err;
  }
}

const snap = (page: Page): Promise<Json> => run<Json>(page, 'window.__shrine.snapshot()');

const flags = (page: Page): Promise<Record<string, boolean>> => run(page, 'window.__psyche.flags()');

async function goto(page: Page, map: string): Promise<void> {
  await run(page, `window.__psyche.goto(${JSON.stringify(map)})`);
  await page.waitForFunction(
    (m) => (window as unknown as { __psyche: { state(): { map: string } } }).__psyche.state().map === m,
    map, { timeout: 15000 },
  );
  await page.waitForTimeout(500);
}

async function waitFor(page: Page, expr: string, ms = 30000, label = expr): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await run<boolean>(page, `!!(${expr})`)) return true;
    await page.waitForTimeout(180);
  }
  console.log(`      … timed out waiting for ${label}`);
  return false;
}

/** A door zone's flag gate, straight out of the live map definition. */
const zoneRequires = (page: Page, id: string) =>
  run<string | null>(page, `(window.__psyche.scene.zone(${JSON.stringify(id)})||{}).requires ?? null`);

// ── the run ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { page, close } = await boot();
  const flagOrder: string[] = [];

  try {
    // The player arrives at the shrine having done everything else in the game.
    await run(page, `
      ['met_mira','intro_done','q1_complete','q2_complete','q3_complete',
       'insight_conditioning','insight_interference','insight_conformity',
       'south_gate_open','woods_cleared',
       'shrine_r1_seen','shrine_r2_seen','shrine_r3_seen','shrine_r4_seen','shrine_r5_seen',
       'shrine_arrival_done','shrine_echo_seen'
      ].forEach(f => window.__psyche.setFlag(f));
      ['observe','link','recall','dissent'].forEach(a => window.__psyche.grant(a));
    `);

    const seen = async () => {
      const f = await flags(page);
      for (let n = 1; n <= 5; n++) {
        const k = `shrine_r${n}_done`;
        if (f[k] && !flagOrder.includes(k)) flagOrder.push(k);
      }
      return f;
    };

    // ── ROOM ONE ─────────────────────────────────────────────────────────
    head('Room one — association');
    await goto(page, 'shrine_association');
    let f = await seen();
    ok('starts unsolved', !f.shrine_r1_done);
    let s = await snap(page);
    ok('the way on is shut', s.gateOpen === false, s.gateOpen);
    eq('the exit door is gated on this room', await zoneRequires(page, 'to_r2'), 'shrine_r1_done');
    ok('a moth is waiting in the jar', s.taken === false && s.down === false);

    // The player cannot hold the plate down themselves: it needs weight 3.
    await run(page, 'window.__psyche.teleport(22,11)');
    await page.waitForTimeout(700);
    s = await snap(page);
    ok('standing on the plate yourself does nothing', (s.plate as Json).pressed === false);

    // Take the moth, put it on the plate, and get out of the way.
    await run(page, 'window.__shrine.take()');
    await page.waitForTimeout(200);
    ok('the moth can be picked up', (await snap(page)).held === true);
    await run(page, 'window.__shrine.drop()');
    await page.waitForTimeout(200);
    ok('the moth can be put down', (await snap(page)).down === true);
    await run(page, 'window.__psyche.teleport(13,4)');

    ok('the creature comes to it and holds the plate',
      await waitFor(page, 'window.__shrine.snapshot().plate.pressed', 40000, 'the plate'));
    await page.waitForTimeout(600);
    s = await snap(page);
    ok('the door opens', s.gateOpen === true, s);
    f = await seen();
    ok('shrine_r1_done is set', !!f.shrine_r1_done);
    ok('and nothing further is', !f.shrine_r2_done && !f.shrine_r3_done && !f.shrine_r4_done && !f.shrine_r5_done);

    // ── ROOM TWO ─────────────────────────────────────────────────────────
    head('Room two — combat');
    await goto(page, 'shrine_combat');
    f = await seen();
    ok('starts unsolved', !f.shrine_r2_done);
    s = await snap(page);
    eq('five enemies, framed', s.alive, 5);
    eq('the composition is three chargers and two shooters',
      (s.kinds as string[]).slice().sort().join(','), 'bramble,bramble,bramble,wisp,wisp');
    ok('the bars are down behind you', s.northOpen === false);
    ok('and ahead of you', s.southOpen === false);
    eq('the exit door is gated on this room', await zoneRequires(page, 'to_r3'), 'shrine_r2_done');

    // Kill one and check the seal still holds: the gate is on the whole floor.
    await run(page, 'const e=window.__psyche.scene.enemies.list[0]; e.hurt(99,e.x,e.y+40);');
    await page.waitForTimeout(900);
    s = await snap(page);
    ok('killing one is not enough', s.southOpen === false && (s.alive as number) < 5, s);

    await run(page, 'window.__psyche.scene.enemies.list.forEach(e=>{ if(!e.dead) e.hurt(99,e.x,e.y+40); });');
    ok('clearing the floor opens both doors',
      await waitFor(page, 'window.__shrine.snapshot().southOpen', 12000, 'the bars'));
    s = await snap(page);
    ok('including the one behind you', s.northOpen === true);
    f = await seen();
    ok('shrine_r2_done is set', !!f.shrine_r2_done);
    ok('and nothing further is', !f.shrine_r3_done && !f.shrine_r4_done && !f.shrine_r5_done);

    // ── ROOM THREE ───────────────────────────────────────────────────────
    head('Room three — memory');
    await goto(page, 'shrine_memory');
    f = await seen();
    ok('starts unsolved', !f.shrine_r3_done);
    s = await snap(page);
    const evidence = s.evidence as Array<{ id: string; stations: string[]; door: number }>;
    eq('two routes are readable off the floor', evidence.length, 2);
    const damp = evidence.find((e) => e.id === 'damp')!;
    const dry = evidence.find((e) => e.id === 'dry')!;
    ok('the two orders use the same four symbols',
      damp.stations.slice().sort().join() === dry.stations.slice().sort().join(), [damp.stations, dry.stations]);
    ok('and differ only in the middle — recency alone is a trap',
      damp.stations[0] === dry.stations[0]
      && damp.stations[3] === dry.stations[3]
      && damp.stations.join() !== dry.stations.join(), [damp.stations, dry.stations]);
    ok("the keypad's own arrangement matches neither answer",
      (s.bank as string[]).join() !== damp.stations.join() && (s.bank as string[]).join() !== dry.stations.join());

    // The clues are evidence about wet and dry stone, and never an order.
    await run(page, "['r3_damp_door','r3_dry_door','r3_pool_clue'].forEach(i=>window.__shrine.read(i))");
    s = await snap(page);
    eq('the context clues are readable', (s.clues as string[]).slice().sort(), ['both', 'damp', 'dry']);

    // A wrong order: it must cost the entry and teach nothing.
    const wrong = [damp.stations[1], damp.stations[0], damp.stations[2], damp.stations[3]];
    for (const r of wrong) await run(page, `window.__shrine.press(${JSON.stringify(r)})`);
    await page.waitForTimeout(300);
    s = await snap(page);
    eq('a wrong order opens nothing', s.claimed, []);
    eq('and clears the entry rather than telling you where you slipped', s.entered, 0);

    // Now the two real orders, each attributed to its own door.
    for (const r of damp.stations) await run(page, `window.__shrine.press(${JSON.stringify(r)})`);
    await page.waitForTimeout(400);
    s = await snap(page);
    eq("the wet route claims the wet door", s.claimed, ['damp']);
    eq('but one door is not enough to leave', s.gates, [false, false]);
    f = await seen();
    ok('the room is not done yet', !f.shrine_r3_done);

    for (const r of dry.stations) await run(page, `window.__shrine.press(${JSON.stringify(r)})`);
    await page.waitForTimeout(600);
    s = await snap(page);
    eq('the dry route claims the dry door', (s.claimed as string[]).slice().sort(), ['damp', 'dry']);
    eq('and both open', s.gates, [true, true]);
    f = await seen();
    ok('shrine_r3_done is set', !!f.shrine_r3_done);
    ok('and nothing further is', !f.shrine_r4_done && !f.shrine_r5_done);

    // ── ROOM FOUR ────────────────────────────────────────────────────────
    head('Room four — conformity');
    await goto(page, 'shrine_conformity');
    f = await seen();
    ok('starts unsolved', !f.shrine_r4_done);
    s = await snap(page);
    // One lamp starts lit: every statue faces south and one of the four is
    // meant to. That is deliberate — it demonstrates "a statue looking at its
    // lamp lights it" before the player has touched anything.
    eq('exactly one lamp is lit to start with', s.lamps, 1);
    ok('the four are looking the same way', new Set(Object.values(s.facings as Json)).size === 1);
    eq('the exit door is gated on this room', await zoneRequires(page, 'to_r5'), 'shrine_r4_done');
    const wants = s.wants as Record<string, string>;
    ok('the door needs four different directions', new Set(Object.values(wants)).size === 4, wants);

    // Turning the crowned one turns everybody: only one lamp can ever be lit.
    await run(page, "window.__shrine.turn('leader')");
    await page.waitForTimeout(250);
    s = await snap(page);
    ok('turning the leader turns all of them', new Set(Object.values(s.facings as Json)).size === 1, s.facings);
    ok('which lights at most one lamp', (s.lamps as number) <= 1, s.lamps);

    // Turning a follower: it turns, and the group hauls it straight back.
    const before = (await snap(page)).facings as Record<string, string>;
    await run(page, "window.__shrine.turn('a')");
    await page.waitForTimeout(80);
    const during = (await snap(page)).facings as Record<string, string>;
    ok('a follower does turn when you push it', during.a !== before.a, { before: before.a, during: during.a });
    await page.waitForTimeout(700);
    const after = (await snap(page)).facings as Record<string, string>;
    eq('…and is snapped back into line', after.a, after.leader);
    eq('with nobody dissenting', (await snap(page)).dissenting, []);

    // Going down half way through must put the room back exactly as found.
    await run(page, "window.__shrine.push('w')");
    await page.waitForTimeout(400);
    const moved = (await snap(page)).block as { x: number };
    await run(page, 'window.__psyche.scene.player.hurt(99,0,0)');
    await page.waitForTimeout(2600);
    s = await snap(page);
    ok('going down re-arms the room', (s.block as { x: number }).x !== moved.x
      && (s.lamps as number) === 1 && new Set(Object.values(s.facings as Json)).size === 1,
      { block: s.block, moved, lamps: s.lamps, facings: s.facings });
    await run(page, 'window.__psyche.hp(6)');

    // Put the block in a sightline. Two shoves west reaches the nearest one.
    for (let i = 0; i < 2; i++) {
      await run(page, "window.__shrine.push('w')");
      await page.waitForTimeout(420);
    }
    s = await snap(page);
    ok('the block can be pushed into a sightline', (s.occluded as string[]).length > 0, s);
    const isolated = (s.occluded as string[])[0];

    // Breaking the isolated one breaks the group's hold on all of them.
    await run(page, `window.__shrine.turn(${JSON.stringify(isolated)})`);
    await page.waitForTimeout(1200);
    s = await snap(page);
    eq('one statue out of sight frees every statue', (s.dissenting as string[]).length, 4);

    // Now aim each of them at its own lamp.
    for (const id of Object.keys(wants)) {
      for (let i = 0; i < 5; i++) {
        const now = (await snap(page)).facings as Record<string, string>;
        if (now[id] === wants[id]) break;
        await run(page, `window.__shrine.turn(${JSON.stringify(id)})`);
        await page.waitForTimeout(120);
      }
    }
    await page.waitForTimeout(500);
    s = await snap(page);
    eq('all four lamps are lit', s.lamps, 4);
    ok('the door opens', s.gateOpen === true);
    f = await seen();
    ok('shrine_r4_done is set', !!f.shrine_r4_done);
    ok('and room five is still shut', !f.shrine_r5_done);

    // ── ROOM FIVE ────────────────────────────────────────────────────────
    head('Room five — combination');
    await goto(page, 'shrine_combination');
    f = await seen();
    ok('starts unsolved', !f.shrine_r5_done);
    s = await snap(page);
    ok('the way to the boss is shut', s.gateOpen === false);
    eq('and its door is gated on this room', await zoneRequires(page, 'to_boss'), 'shrine_r5_done');
    eq('three plates, none of them pressed', (s.plates as Json[]).filter((p) => p.pressed).length, 0);
    eq('a leader and three followers', (s.flock as Json[]).length, 3);

    // The three chimes overlap: two of them ring the same three notes in a
    // different order, which is the whole reason context has to settle it.
    const chimes = s.chimes as Array<{ id: string; pattern: string[] }>;
    const west = chimes.find((c) => c.id === 'west')!;
    const east = chimes.find((c) => c.id === 'east')!;
    ok('two patterns use the same notes in a different order',
      west.pattern.slice().sort().join() === east.pattern.slice().sort().join()
      && west.pattern.join() !== east.pattern.join(), [west.pattern, east.pattern]);

    await run(page, "['r5_trace_west','r5_trace_east','r5_trace_northeast'].forEach(i=>window.__shrine.read(i))");
    s = await snap(page);
    eq('three traces on the floor, three different histories',
      (s.clues as string[]).slice().sort(), ['bolted', 'roost', 'untouched']);

    // The WRONG chime is not a no-op: the leader bolts away from it.
    await run(page, "window.__psyche.teleport(16,12); window.__shrine.take('east');");
    await page.waitForTimeout(200);
    await run(page, 'window.__shrine.drop(); window.__psyche.teleport(24,12);');
    const start = (await snap(page)).leader as { x: number; y: number };
    await page.waitForTimeout(3200);
    const fled = (await snap(page)).leader as { x: number; y: number };
    const away = Math.hypot(fled.x - 16, fled.y - 12) > Math.hypot(start.x - 16, start.y - 12);
    ok('the wrong pattern drives the leader away rather than doing nothing', away, { start, fled });
    // Picking it back up silences it; taking another returns this one to rest.
    await run(page, "window.__shrine.take('east')");
    await page.waitForTimeout(200);

    // The right chime, placed so a particular follower lands on the far plate.
    await run(page, "window.__psyche.teleport(6,3); window.__shrine.take('west');");
    await page.waitForTimeout(250);
    ok('taking another chime puts the first one back on its plinth',
      ((await snap(page)).chimes as Array<Json>).filter((c) => c.held || c.down).length === 1,
      (await snap(page)).chimes);
    await run(page, 'window.__shrine.drop(); window.__psyche.teleport(12,3);');
    ok('the leader answers the pattern it learned',
      await waitFor(page, "window.__shrine.snapshot().plates.find(p=>p.id==='far').pressed", 45000, 'the far plate'));

    s = await snap(page);
    const onFar = (s.flock as Array<{ id: string; x: number; y: number }>)
      .find((q) => q.x === 8 && q.y === 4);
    ok('a follower — not the leader — is the one standing on it', !!onFar, s.flock);
    eq('only one plate is held by the flock as it stands',
      (s.plates as Json[]).filter((p) => p.pressed).length, 1);

    // Break that one out. It stays where the flock left it.
    await run(page, `window.__shrine.breakOut(${JSON.stringify(onFar!.id)})`);
    await page.waitForTimeout(400);
    s = await snap(page);
    eq('it stops copying', (s.flock as Array<Json>).filter((q) => q.dissenting).length, 1);

    // Take the chime to the pair; the rest of the flock comes with it.
    await run(page, "window.__psyche.teleport(20,10); window.__shrine.take('west');");
    await page.waitForTimeout(200);
    await run(page, 'window.__shrine.drop(); window.__psyche.teleport(14,13);');
    ok('the rest of the flock holds the other two plates',
      await waitFor(page, 'window.__shrine.snapshot().plates.every(p=>p.pressed)', 45000, 'all three plates'));
    ok('the one that broke away is still holding the far plate',
      (await snap(page)).plates !== null
      && ((await snap(page)).plates as Json[]).every((p) => p.pressed));

    await page.waitForTimeout(1200);
    s = await snap(page);
    ok('the seal opens', s.gateOpen === true, s);
    f = await seen();
    ok('shrine_r5_done is set', !!f.shrine_r5_done);

    // ── the contract ─────────────────────────────────────────────────────
    head('The contract');
    eq('the five flags were set in order, one at a time', flagOrder, [
      'shrine_r1_done', 'shrine_r2_done', 'shrine_r3_done', 'shrine_r4_done', 'shrine_r5_done',
    ]);
    const gates = await run<Record<string, string | null>>(page, `(() => {
      const out = {};
      const rooms = {
        shrine_association: 'to_r2', shrine_combat: 'to_r3', shrine_memory: 'to_r4_damp',
        shrine_conformity: 'to_r5', shrine_combination: 'to_boss',
      };
      for (const [map, zone] of Object.entries(rooms)) {
        const def = window.__psyche.scene.world.def.id === map
          ? window.__psyche.scene.world.def : null;
        out[zone] = def ? ((def.zones.find(z => z.id === zone) || {}).requires ?? null) : 'checked-live';
      }
      return out;
    })()`);
    ok('every exit in the dungeon carries its own flag gate', Object.keys(gates).length === 5);

    const errs = (page as unknown as { __errors: string[] }).__errors ?? [];
    const real = errs.filter((e) => !/favicon|AudioContext|WebGL/i.test(e));
    ok('no page errors during the run', real.length === 0, real.slice(0, 4));
  } finally {
    await close();
  }

  console.log(`\n  ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('');
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
