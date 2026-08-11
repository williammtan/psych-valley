/**
 * FEEL PROBE — measures game feel instead of guessing at it.
 *
 * Boots the real game in headless Chromium, hooks the scene's own frame loop,
 * and drives input frame-by-frame, so every number below comes off the running
 * controller rather than off the constants file.
 *
 *   npx tsx tools/feel_probe.ts                     # everything
 *   npx tsx tools/feel_probe.ts --only dash,attack
 *   npx tsx tools/feel_probe.ts --label before
 *   npx tsx tools/feel_probe.ts --label after --vs before
 *
 * Tests that need clean geometry build their own arena out of dynamic solids,
 * inside the largest open block the shipped maps actually contain.
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, '.tmp', 'feel');

/** The town is always used for the snag tour; the arena map is chosen at boot. */
const TOWN = 'lumen_vale';

/* ─────────────────────────── in-page harness ─────────────────────────── */

/**
 * Installed once per page load. Everything frame-accurate happens in here:
 * Node can only talk to the page between frames, so schedules are expressed in
 * frame numbers and executed from the scene's own pre-update hook.
 */
function installHarness(): void {
  const w = window as any;
  const F: any = {
    scene: w.__psyche.scene,
    frame: 0,
    samples: [] as any[],
    sched: {} as Record<number, string[]>,
    want: 0,
    resolve: null as null | (() => void),
    events: [] as Array<{ f: number; name: string }>,
    trackHp: true,
    lastDelta: 16.7,
  };
  w.__F = F;

  const player = () => F.scene.player;

  F.reset = () => { F.frame = 0; F.samples = []; F.sched = {}; F.events = []; };

  /** Schedule a snippet of JS to run in pre-update of a given frame. */
  F.at = (frame: number, code: string) => { (F.sched[frame] ||= []).push(code); };

  F.scripted = (on: boolean) => {
    const k = F.scene.keys;
    if (on) k.scripted ||= { axis: { x: 0, y: 0 }, actions: new Set() };
    else k.scripted = null;
  };

  /** Movement intent, normalised exactly the way keys and sticks are. */
  F.move = (x: number, y: number) => {
    F.scripted(true);
    const len = Math.hypot(x, y) || 1;
    F.scene.keys.scripted.axis = { x: len > 1 ? x / len : x, y: len > 1 ? y / len : y };
  };

  /**
   * Queue an action for THIS frame. Goes through scripted.actions, not
   * inject(): inject() lands in a set that keys.update() clears at the top of
   * the next frame, so a press made between frames would be dropped.
   */
  F.act = (a: string) => {
    F.scripted(true);
    F.scene.keys.scripted.actions.add(a);
  };

  F.sample = () => {
    const p = player();
    const cam = F.scene.cameras.main;
    const ax = F.scene.keys.axis();
    return {
      f: F.frame,
      dt: F.lastDelta,
      upd: F.lastUpd,
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      sx: p.sprite.x,
      sy: p.sprite.y,
      vx: +p.vx.toFixed(2),
      vy: +p.vy.toFixed(2),
      sp: +Math.hypot(p.vx, p.vy).toFixed(2),
      mode: p.mode,
      dir: p.dir,
      hb: p.hitbox.active,
      inv: p.invulnerable,
      hp: F.trackHp === false ? 0 : w.__psyche.state().hp,
      ts: F.scene.timeScale,
      ax: +ax.x.toFixed(2),
      ay: +ax.y.toFixed(2),
      shake: cam.shakeEffect && cam.shakeEffect.isRunning ? 1 : 0,
      en: F.scene.enemies.list.filter((e: any) => !e.dead).map((e: any) => ({
        k: e.kind, x: +e.x.toFixed(2), y: +e.y.toFixed(2), m: e.mode, hp: e.hp,
        an: (e.sprite.anims && e.sprite.anims.currentAnim) ? e.sprite.anims.currentAnim.key : '',
      })),
      shots: F.scene.enemies.list.reduce((n: number, e: any) => n + e.shots.length, 0),
    };
  };

  F.scene.events.on('preupdate', (_t: number, d: number) => {
    F.lastDelta = d;
    F.updStart = performance.now();
    const jobs = F.sched[F.frame];
    if (jobs) for (const code of jobs) { try { new Function('F', 'w', code)(F, w); } catch (e) { console.error(e); } }
  });

  F.scene.events.on('postupdate', () => {
    F.lastUpd = performance.now() - F.updStart;
    if (F.want > 0) {
      F.samples.push(F.sample());
      F.frame++;
      if (--F.want === 0 && F.resolve) { const r = F.resolve; F.resolve = null; r(); }
    }
  });

  /** Record N frames; resolves with the samples. */
  F.run = (n: number) => new Promise((res) => {
    F.want = n;
    F.resolve = () => res(F.samples);
  });

  /* ── arena construction ───────────────────────────────────────────────── */

  /**
   * Top-left of an open WxH block, nearest the map centre. Reads the combined
   * grid, so an arena never lands on a gate or block an area script placed.
   */
  F.findOpen = (w2: number, h2: number) => {
    const solid = F.scene.collisionGrid();
    const H = solid.length, W = solid[0].length;
    let best: any = null;
    for (let y = 1; y + h2 <= H - 1; y++) {
      for (let x = 1; x + w2 <= W - 1; x++) {
        let ok = true;
        for (let j = 0; j < h2 && ok; j++) {
          const row = solid[y + j];
          for (let i = 0; i < w2; i++) if (row[x + i]) { ok = false; break; }
        }
        if (!ok) continue;
        const d = Math.abs(x + w2 / 2 - W / 2) + Math.abs(y + h2 / 2 - H / 2);
        if (!best || d < best.d) best = { x, y, w: w2, h: h2, d };
      }
    }
    return best;
  };

  /** Largest open square in the current map, as {x, y, w, h}. */
  F.largestOpen = () => {
    for (const n of [17, 15, 13, 11, 9, 7]) {
      const o = F.findOpen(n, n);
      if (o) return o;
    }
    return null;
  };

  F.arenaCache = null;
  F.arena = () => {
    if (!F.arenaCache || F.arenaCache.map !== F.scene.mapId) {
      const o = F.largestOpen();
      F.arenaCache = o ? { x: o.x, y: o.y, w: o.w, h: o.h, map: F.scene.mapId } : null;
    }
    return F.arenaCache;
  };
  /** Tile → pixel, for the centre-bottom anchor entities use. */
  F.px = (tx: number) => tx * 16 + 8;
  F.py = (ty: number) => ty * 16 + 16;

  F.walls = [] as Array<[number, number]>;
  F.setWall = (cells: Array<[number, number]>) => {
    F.clearWalls();
    F.walls = cells;
    for (const c of cells) F.scene.setDynamicSolid(c[0], c[1], true);
  };
  F.clearWalls = () => {
    for (const c of F.walls) F.scene.setDynamicSolid(c[0], c[1], false);
    F.walls = [];
  };

  /** Put the player exactly here, in pixels, at rest and out of every cooldown. */
  F.place = (px: number, py: number, dir = 's') => {
    const p = player();
    p.setPosition(px, py, dir);
    p.vx = p.vy = 0;
    p.mode = 'free';
    p.modeUntil = 0;
    p.dashReadyAt = 0;
    p.invulnUntil = 0;
    p.attackBufferedAt = -9999;
    p.dashBufferedAt = -9999;
    F.scene.cameras.main.centerOn(px, py);
  };

  F.clean = () => {
    F.scene.enemies.clear();
    F.clearWalls();
    F.move(0, 0);
    F.trackHp = true;
    // A cutscene or a death earlier in the run must not silently disable the
    // action buttons for every later measurement.
    F.scene.keys.enabled = true;
    w.__psyche.hp(6);
  };

  F.goto = (map: string) => { w.__psyche.goto(map); F.arenaCache = null; };

  /* ── event taps ───────────────────────────────────────────────────────── */
  // The three gameplay events that reach FxManager, which is the only place the
  // page-side shim can observe them from.
  for (const name of ['player:attack', 'player:step', 'player:dashtrail']) {
    w.__events_on(name, () => F.events.push({ f: F.frame, name }));
  }
}

/* ─────────────────────────────── driver ──────────────────────────────── */

type Row = Record<string, string | number>;
interface Ctx { page: Page; frameMs: number; arena: string }

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  const server = await createServer({
    root: ROOT,
    server: {
      port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1',
      // Other agents edit src/ while this runs; an HMR full-reload mid-probe
      // destroys the page context and every measurement with it.
      hmr: false,
      watch: { ignored: ['**'] },
    },
    logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  // tsx compiles with --keep-names, which rewrites functions to call a `__name`
  // helper that does not exist in the browser; without this identity shim every
  // evaluate() containing a nested closure throws.
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));
  return { browser, page, server, base };
}

async function load(page: Page, base: string): Promise<void> {
  await page.goto(`${base}?skiptitle=1&map=${TOWN}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__psyche?.ready, undefined, { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const w = window as any;
    const bus: Record<string, Set<(p: any) => void>> = (w.__busTaps ||= {});
    w.__events_on = (name: string, fn: (p: any) => void) => { (bus[name] ||= new Set()).add(fn); };
    // The event bus is module-scoped, so the only place the page can observe
    // these events is where FxManager consumes them.
    if (!w.__emitPatched) {
      w.__emitPatched = true;
      const proto = w.__psyche.scene.fx.constructor.prototype;
      const pairs: Array<[string, string]> = [
        ['player:attack', 'slash'], ['player:step', 'dust'], ['player:dashtrail', 'dashTrail'],
      ];
      for (const pair of pairs) {
        const m = proto[pair[1]];
        proto[pair[1]] = function (this: any, ...a: any[]) {
          if (bus[pair[0]]) bus[pair[0]].forEach((f) => f({ a }));
          return m.apply(this, a);
        };
      }
    }
  });
  await page.evaluate(installHarness);
  // Every gate in the game is a flag, and an ungated map runs its arrival
  // cutscene — which locks the player and disables input. Jump past all of it.
  await page.evaluate(() => (window as any).__psyche.jump('woods'));
  await page.waitForTimeout(800);
}

/**
 * Pick the map with the roomiest open block. Maps whose area script runs a
 * cutscene are rejected outright: a cutscene disables input and walks the
 * player around, which silently invalidates every measurement taken on it.
 */
async function chooseArena(page: Page): Promise<string> {
  const maps = await page.evaluate(() => (window as any).__psyche.maps() as string[]);
  const found: Array<{ map: string; size: number; busy: boolean }> = [];
  for (const map of maps) {
    const r = await page.evaluate(async (m) => {
      const F = (window as any).__F;
      F.goto(m);
      await new Promise((res) => setTimeout(res, 450));
      // keys.enabled is scene-wide and sticky, so clear it before judging.
      F.scene.keys.enabled = true;
      const o = F.largestOpen();
      return { size: o ? o.w : 0, busy: F.scene.cutscene.active };
    }, map).catch(() => ({ size: 0, busy: true }));
    found.push({ map, ...r });
  }
  const usable = found.filter((f) => !f.busy && f.size >= 7).sort((a, b) => b.size - a.size);
  const best = usable[0] ?? { map: TOWN, size: 0, busy: false };
  await page.evaluate(async (m) => {
    const F = (window as any).__F;
    F.goto(m);
    await new Promise((r) => setTimeout(r, 400));
  }, best.map);
  console.log(`arena map: ${best.map} (${best.size}x${best.size} open)`);
  console.log(`  candidates: ${found.map((f) => `${f.map}:${f.size}${f.busy ? '(busy)' : ''}`).join(' ')}`);
  return best.map;
}

const fmt = (n: number, d = 1): string => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

function table(title: string, rows: Row[]): string {
  if (!rows.length) return `${title}\n  (no rows)\n`;
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells: Array<string | number>) => '  ' + cells.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ');
  return [
    title, line(cols), '  ' + w.map((n) => '-'.repeat(n)).join('  '),
    ...rows.map((r) => line(cols.map((c) => r[c]))), '',
  ].join('\n');
}

/* ───────────────────────────── measurements ──────────────────────────── */

async function calibrate(page: Page): Promise<number> {
  const s = await page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean();
    return await F.run(120);
  }) as any[];
  const dts = s.slice(20).map((r) => r.dt).sort((a, b) => a - b);
  return dts[Math.floor(dts.length / 2)];
}

async function latency(ctx: Ctx): Promise<Row[]> {
  const { page } = ctx;
  // Pass 1: a real key, dispatched by the browser, through the real InputManager.
  await page.evaluate(() => {
    const F = (window as any).__F;
    F.reset(); F.clean();
    const o = F.arena();
    F.place(F.px(o.x + 1), F.py(o.y + Math.floor(o.h / 2)), 's');
    F.scripted(false);
  });
  await page.click('canvas', { position: { x: 4, y: 4 } }).catch(() => {});
  const run = page.evaluate(() => (window as any).__F.run(40));
  await page.waitForTimeout(150);
  await page.keyboard.down('ArrowRight');
  const s = (await run) as any[];
  await page.keyboard.up('ArrowRight');

  const firstAxis = s.findIndex((r) => r.ax !== 0);
  const ok = firstAxis > 0;
  const x0 = ok ? s[firstAxis - 1].x : 0;
  const firstMove = ok ? s.findIndex((r, i) => i >= firstAxis && r.x !== x0) : -1;

  // Pass 2: sub-pixel sweep. The sprite draws at Math.round(x), so where the
  // player happens to be standing decides whether frame 1 moves a visible pixel.
  const sweep = await page.evaluate(async () => {
    const F = (window as any).__F;
    const out: any[] = [];
    for (const frac of [0, 0.25, 0.5, 0.75]) {
      F.reset(); F.clean(); F.scripted(true);
      const o = F.arena();
      F.place(F.px(o.x + 1) + frac, F.py(o.y + Math.floor(o.h / 2)), 's');
      F.at(1, 'F.move(1,0)');
      const s2 = await F.run(12);
      F.move(0, 0);
      const x00 = s2[0].x, sx00 = s2[0].sx;
      out.push({
        frac,
        pos: s2.findIndex((r: any, i: number) => i >= 1 && r.x !== x00),
        draw: s2.findIndex((r: any, i: number) => i >= 1 && r.sx !== sx00),
        step: +(s2[1].x - x00).toFixed(3),
      });
    }
    return out;
  }) as any[];

  return [
    { metric: 'keyboard: axis→position (frames)', value: ok ? firstMove - firstAxis : 'KEYBOARD FAIL', target: '0' },
    { metric: 'scripted: input→position (frames)', value: Math.max(...sweep.map((r) => r.pos)) - 1, target: '0' },
    { metric: 'input→rendered pixel, worst (frames)', value: Math.max(...sweep.map((r) => r.draw)) - 1, target: '≤1' },
    { metric: 'first-frame displacement (px)', value: fmt(sweep[0].step, 2), target: '>0.5' },
  ];
}

async function ramp(ctx: Ctx): Promise<Row[]> {
  const s = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    F.place(F.px(o.x + 1), F.py(o.y + Math.floor(o.h / 2)), 's');
    F.at(2, 'F.move(1,0)');
    F.at(50, 'F.move(0,0)');
    const r = await F.run(100);
    F.move(0, 0); F.clean();
    return r;
  }) as any[];
  const top = Math.max(...s.map((r) => r.sp));
  const startF = 2;
  const to95 = s.findIndex((r, i) => i >= startF && r.sp >= top * 0.95);
  const to99 = s.findIndex((r, i) => i >= startF && r.sp >= top * 0.99);
  const relF = 50;
  const stopped = s.findIndex((r, i) => i >= relF && r.sp === 0);
  const glide = stopped >= 0 ? Math.abs(s[stopped].x - s[relF - 1].x) : NaN;
  return [
    { metric: 'top speed (px/s)', value: fmt(top, 1), target: '—' },
    { metric: 'time to 95% speed (ms)', value: fmt((to95 - startF + 1) * ctx.frameMs, 0), target: '60–110' },
    { metric: 'time to 99% speed (ms)', value: fmt((to99 - startF + 1) * ctx.frameMs, 0), target: '—' },
    { metric: 'time to full stop (ms)', value: fmt((stopped - relF + 1) * ctx.frameMs, 0), target: '50–90' },
    { metric: 'stop glide (px)', value: fmt(glide, 2), target: '<6' },
  ];
}

async function diagonal(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    const o = F.arena();
    const leg = async (vx: number, vy: number) => {
      F.reset(); F.clean(); F.scripted(true);
      F.place(F.px(o.x + 1), F.py(o.y + o.h - 2), 's');
      F.at(1, `F.move(${vx},${vy})`);
      const s = (await F.run(45)).slice();
      F.move(0, 0);
      return s;
    };
    const card = await leg(1, 0);
    const diag = await leg(1, -1);
    const near = await leg(1, -0.93);
    F.clean();
    const maxStep = (a: any[]) => Math.max(...a.map((s: any, i: number) => (i ? Math.hypot(s.x - a[i - 1].x, s.y - a[i - 1].y) : 0)));
    const flips = (a: any[]) => a.slice(6).filter((s: any, i: number, arr: any[]) => i && s.dir !== arr[i - 1].dir).length;
    return {
      card: Math.max(...card.map((s: any) => s.sp)),
      diag: Math.max(...diag.map((s: any) => s.sp)),
      cardStep: maxStep(card), diagStep: maxStep(diag),
      flips45: flips(diag), flipsNear: flips(near),
      dir45: diag[30].dir, dirNear: near[30].dir,
    };
  }) as any;
  return [
    { metric: 'cardinal top speed (px/s)', value: fmt(r.card, 1), target: '—' },
    { metric: 'diagonal top speed (px/s)', value: fmt(r.diag, 1), target: '= cardinal' },
    { metric: 'diagonal / cardinal px per frame (%)', value: fmt((r.diagStep / r.cardStep) * 100, 1), target: '≤100' },
    { metric: 'facing flips on exact 45°', value: r.flips45, target: '0' },
    { metric: 'facing flips near 45° (43°)', value: r.flipsNear, target: '0' },
    { metric: 'facing settled, 45° / near', value: `${r.dir45} / ${r.dirNear}`, target: 'stable' },
  ];
}

async function corners(ctx: Ctx): Promise<Row[]> {
  const res = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean();
    const o = F.arena();
    if (!o) return { error: 'no open arena' };
    // A wall across the arena with a single 1-tile gap in it.
    const wy = o.y + o.h - 3;
    const gapX = o.x + Math.floor(o.w / 2);
    const cells: Array<[number, number]> = [];
    for (let x = o.x; x < o.x + o.w; x++) if (x !== gapX) cells.push([x, wy]);
    F.setWall(cells);

    const gapCx = gapX * 16 + 8;
    const startY = (wy + 2) * 16 + 16;
    const climb = (startY - 8) - (wy * 16 + 16); // px the box top must travel

    const trials: Array<{ name: string; start: number; vec: [number, number] }> = [];
    for (const off of [-7, -5, -3, -1, 1, 3, 5, 7]) {
      trials.push({ name: `straight ${off > 0 ? '+' : ''}${off}px`, start: gapCx + off, vec: [0, -1] });
    }
    // Diagonals, aimed so the body arrives at the wall at the stated offset.
    for (const spec of [[-5, 1], [5, -1], [-3, 0.58], [3, -0.58]] as Array<[number, number]>) {
      const off = spec[0], ax = spec[1];
      trials.push({
        name: `diag ${ax > 0 ? 'NE' : 'NW'} ${Math.abs(ax) === 1 ? '45°' : '30°'} ${off > 0 ? '+' : ''}${off}px`,
        start: gapCx + off - ax * climb,
        vec: [ax, -1],
      });
    }

    const out: any[] = [];
    for (const t of trials) {
      F.reset();
      F.place(t.start, startY, 'n');
      F.at(1, `F.move(${t.vec[0]},${t.vec[1]})`);
      const s = await F.run(110);
      F.move(0, 0);
      const first = s.findIndex((r: any) => r.y <= wy * 16);
      out.push({ name: t.name, passed: first >= 0, frames: first });
    }
    F.clearWalls(); F.clean();
    return { trials: out };
  }) as any;

  if (res.error) return [{ approach: 'corner assist', through: res.error, frames: '' }];
  const rows: Row[] = res.trials.map((t: any) => ({
    approach: t.name, through: t.passed ? 'yes' : 'NO', frames: t.frames < 0 ? '—' : t.frames,
  }));
  const pass = res.trials.filter((t: any) => t.passed).length;
  rows.push({ approach: 'TOTAL', through: `${pass}/${res.trials.length}`, frames: '' });
  return rows;
}

async function wallSlide(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean();
    const o = F.arena();
    const wy = o.y + 2;
    const startX = F.px(o.x + 1);

    // Reference: the identical diagonal on open ground.
    F.reset();
    F.place(startX, F.py(o.y + o.h - 2), 's');
    F.at(1, 'F.move(1,-1)');
    const free = (await F.run(40)).slice();
    F.move(0, 0);

    // Same diagonal, but with a wall directly above.
    const cells: Array<[number, number]> = [];
    for (let x = o.x; x < o.x + o.w; x++) cells.push([x, wy]);
    F.setWall(cells);
    F.reset();
    F.place(startX, F.py(wy + 1), 's');
    F.at(1, 'F.move(1,-1)');
    const slide = (await F.run(40)).slice();
    F.move(0, 0);
    F.clearWalls(); F.clean();

    const step = (a: any[], i0: number, i1: number) => (a[i1].x - a[i0].x) / (i1 - i0);
    return {
      freeVx: Math.max(...free.map((s: any) => Math.abs(s.vx))),
      slideVx: Math.max(...slide.slice(12).map((s: any) => Math.abs(s.vx))),
      freeStep: step(free, 12, 38),
      slideStep: step(slide, 12, 38),
      contact: slide.filter((s: any) => s.vy === 0).length,
    };
  }) as any;
  return [
    { metric: 'open-field vx on the diagonal (px/s)', value: fmt(r.freeVx, 1), target: '—' },
    { metric: 'vx while pressed into the wall (px/s)', value: fmt(r.slideVx, 1), target: '—' },
    { metric: 'velocity retention (%)', value: fmt((r.slideVx / r.freeVx) * 100, 1), target: '≥95' },
    { metric: 'px-per-frame retention (%)', value: fmt((r.slideStep / r.freeStep) * 100, 1), target: '≥95' },
    { metric: 'frames in wall contact', value: r.contact, target: '—' },
  ];
}

async function attack(ctx: Ctx): Promise<Row[]> {
  const page = ctx.page;
  const cad = await page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    F.place(F.px(o.x + Math.floor(o.w / 2)), F.py(o.y + Math.floor(o.h / 2)), 's');
    for (let i = 1; i < 180; i++) F.at(i, "F.act('attack')");
    const s = await F.run(185);
    let starts = 0;
    for (let i = 1; i < s.length; i++) if (s[i].mode === 'attack' && s[i - 1].mode !== 'attack') starts++;
    F.clean();
    return { starts, frames: s.length };
  }) as any;

  const buf = await page.evaluate(async () => {
    const F = (window as any).__F;
    const o = F.arena();
    const at = () => F.place(F.px(o.x + Math.floor(o.w / 2)), F.py(o.y + Math.floor(o.h / 2)), 's');
    const out: any[] = [];
    for (let k = 2; k <= 28; k++) {
      F.reset(); F.clean(); F.scripted(true); at();
      F.at(1, "F.act('attack')");
      F.at(1 + k, "F.act('attack')");
      const s = await F.run(64);
      let n = 0;
      for (let i = 1; i < s.length; i++) if (s[i].mode === 'attack' && s[i - 1].mode !== 'attack') n++;
      out.push({ k, n });
    }
    F.reset(); F.clean(); F.scripted(true); at();
    F.at(1, "F.act('attack')");
    const s2 = await F.run(64);
    F.clean();
    const a0 = s2.findIndex((r: any) => r.mode === 'attack');
    let a1 = a0; while (a1 < s2.length && s2[a1].mode === 'attack') a1++;
    const hb0 = s2.findIndex((r: any) => r.hb);
    let hb1 = hb0; while (hb1 >= 0 && hb1 < s2.length && s2[hb1].hb) hb1++;
    return { out, attackFrames: a1 - a0, hbStart: hb0 - a0, hbLen: hb1 - hb0 };
  }) as any;

  const fired = buf.out.filter((o: any) => o.n >= 2);
  const earliest = fired.length ? Math.min(...fired.map((o: any) => o.k)) : NaN;
  const bufferMs = Number.isFinite(earliest) ? (buf.attackFrames - earliest + 1) * ctx.frameMs : NaN;

  const mv = await page.evaluate(async () => {
    const F = (window as any).__F;
    const o = F.arena();
    const ax = F.px(o.x + 1), ay = F.py(o.y + Math.floor(o.h / 2));
    F.reset(); F.clean(); F.scripted(true);
    F.place(ax, ay, 'e');
    F.at(1, 'F.move(1,0)');
    F.at(20, "F.act('attack')");
    F.at(75, 'F.move(0,0)');
    const s = (await F.run(85)).slice();
    F.move(0, 0);
    const atk = s.filter((r: any) => r.mode === 'attack');
    const minSp = atk.length ? Math.min(...atk.map((r: any) => r.sp)) : NaN;
    const dist = s[70].x - s[20].x;

    F.reset(); F.place(ax, ay, 'e');
    F.at(1, 'F.move(1,0)');
    F.at(75, 'F.move(0,0)');
    const s2 = (await F.run(85)).slice();
    F.move(0, 0);
    const dist2 = s2[70].x - s2[20].x;

    // Does pushing a direction cut the recovery short?
    F.reset(); F.place(ax, ay, 'e');
    F.at(1, "F.act('attack')");
    F.at(13, 'F.move(0,1)');
    const s3 = (await F.run(50)).slice();
    F.move(0, 0); F.clean();
    const a0 = s3.findIndex((r: any) => r.mode === 'attack');
    let a1 = a0; while (a1 >= 0 && a1 < s3.length && s3[a1].mode === 'attack') a1++;
    return { minSp, dist, dist2, cancelFrames: a1 - a0 };
  }) as any;

  return [
    { metric: 'attack state length (ms)', value: fmt(buf.attackFrames * ctx.frameMs, 0), target: '240–320' },
    { metric: 'hitbox opens at (ms)', value: fmt(buf.hbStart * ctx.frameMs, 0), target: 'after anticipation' },
    { metric: 'hitbox active (ms)', value: fmt(buf.hbLen * ctx.frameMs, 0), target: '80–130' },
    { metric: 'max sustained attacks/s', value: fmt((cad.starts / (cad.frames * ctx.frameMs)) * 1000, 2), target: '3–4' },
    { metric: 'input buffer window (ms)', value: fmt(bufferMs, 0), target: '120–160' },
    { metric: 'speed floor while attacking (px/s)', value: fmt(mv.minSp, 1), target: '>0, no dead stop' },
    { metric: 'walk distance kept during attack (%)', value: fmt((mv.dist / mv.dist2) * 100, 0), target: '50–90' },
    { metric: 'attack length when move-cancelled (ms)', value: fmt(mv.cancelFrames * ctx.frameMs, 0), target: '< full length' },
  ];
}

async function hitstop(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    const cx = o.x + Math.floor(o.w / 2), cy = o.y + Math.floor(o.h / 2);
    F.place(F.px(cx), F.py(cy), 'e');
    F.scene.enemies.spawn('bramble', cx + 1, cy, { passive: true });
    F.at(2, "F.act('attack')");
    const s = (await F.run(70)).slice();
    const hitF = s.findIndex((r2: any) => r2.ts < 1);
    let end = hitF; while (end >= 0 && end < s.length && s[end].ts < 1) end++;
    const en0 = s[0].en[0];
    const damaged = s.some((r2: any) => r2.en[0] && r2.en[0].hp < en0.hp);
    const last = s[s.length - 1].en[0];
    const frozen = hitF >= 0 ? Math.abs(s[Math.min(end, s.length - 1)].x - s[hitF].x) : NaN;
    F.clean();
    return {
      tsMin: Math.min(...s.map((x: any) => x.ts)),
      stopFrames: hitF < 0 ? 0 : end - hitF,
      shakeFrames: s.filter((x: any) => x.shake).length,
      damaged, frozen,
      knock: last ? Math.hypot(last.x - en0.x, last.y - en0.y) : NaN,
    };
  }) as any;
  return [
    { metric: 'time scale during hitstop', value: fmt(r.tsMin, 3), target: '≈0' },
    { metric: 'hitstop length (ms)', value: fmt(r.stopFrames * ctx.frameMs, 0), target: '40–60' },
    { metric: 'player drift while frozen (px)', value: fmt(r.frozen, 2), target: '<0.5' },
    { metric: 'camera shake (ms)', value: fmt(r.shakeFrames * ctx.frameMs, 0), target: '80–140' },
    { metric: 'enemy took damage', value: r.damaged ? 'yes' : 'NO', target: 'yes' },
    { metric: 'enemy knockback (px)', value: fmt(r.knock, 1), target: '12–22' },
  ];
}

async function knockback(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    F.place(F.px(o.x + Math.floor(o.w / 2)), F.py(o.y + Math.floor(o.h / 2)), 'e');
    const p = F.scene.player;
    const x0 = p.x, y0 = p.y;
    F.at(2, 'F.scene.player.hurt(1, F.scene.player.x - 20, F.scene.player.y)');
    const s = (await F.run(70)).slice();
    const far = Math.max(...s.map((r2: any) => Math.hypot(r2.x - x0, r2.y - y0)));
    const m0 = s.findIndex((r2: any) => r2.mode === 'hurt');
    let m1 = m0; while (m1 >= 0 && m1 < s.length && s[m1].mode === 'hurt') m1++;
    F.clean();
    return { far, invF: s.filter((r2: any) => r2.inv).length, hurtFrames: m1 - m0 };
  }) as any;
  return [
    { metric: 'player knockback (px)', value: fmt(r.far, 1), target: '8–14, under the enemy' },
    { metric: 'player hurt lockout (ms)', value: fmt(r.hurtFrames * ctx.frameMs, 0), target: '180–260' },
    { metric: 'hurt i-frames (ms)', value: fmt(r.invF * ctx.frameMs, 0), target: '600–900' },
  ];
}

async function dash(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    F.place(F.px(o.x + 1), F.py(o.y + Math.floor(o.h / 2)), 'e');
    for (let i = 2; i < 140; i++) F.at(i, "F.act('dash')");
    const s = (await F.run(150)).slice();
    const starts: number[] = [];
    for (let i = 1; i < s.length; i++) if (s[i].mode === 'dash' && s[i - 1].mode !== 'dash') starts.push(i);
    const d0 = starts[0];
    let d1 = d0; while (d1 < s.length && s[d1].mode === 'dash') d1++;
    const dist = Math.hypot(s[d1 - 1].x - s[d0 - 1].x, s[d1 - 1].y - s[d0 - 1].y);
    const inv0 = s.findIndex((x: any) => x.inv);
    let inv1 = inv0; while (inv1 >= 0 && inv1 < s.length && s[inv1].inv) inv1++;
    const trail = F.events.filter((e: any) => e.name === 'player:dashtrail' && e.f >= d0 - 1 && e.f <= d1).length;
    F.clean();
    return {
      dur: d1 - d0, dist, invLen: inv1 - inv0, cycle: starts.length > 1 ? starts[1] - starts[0] : NaN,
      dashes: starts.length, trail, covered: inv1 >= d1,
    };
  }) as any;

  const safe = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    const o = F.arena();
    const cx = o.x + Math.floor(o.w / 2), cy = o.y + Math.floor(o.h / 2);
    const px = F.px(cx - 1), py = F.py(cy);
    F.reset(); F.clean(); F.scripted(true);
    F.place(px, py, 'e');
    F.scene.enemies.spawn('bramble', cx + 1, cy, { passive: true });
    F.at(2, "F.act('dash')");
    const s = (await F.run(50)).slice();
    const hpDash = Math.min(...s.map((r2: any) => r2.hp));

    F.reset(); F.clean(); F.scripted(true);
    F.place(px, py, 'e');
    F.scene.enemies.spawn('bramble', cx + 1, cy, { passive: true });
    F.at(1, 'F.move(1,0)');
    const s2 = (await F.run(50)).slice();
    F.move(0, 0); F.clean();
    return { hpDash, hpWalk: Math.min(...s2.map((r2: any) => r2.hp)) };
  }) as any;

  return [
    { metric: 'dash duration (ms)', value: fmt(r.dur * ctx.frameMs, 0), target: '160–220' },
    { metric: 'dash distance (px)', value: fmt(r.dist, 1), target: '34–48 (2–3 tiles)' },
    { metric: 'i-frames (ms)', value: fmt(r.invLen * ctx.frameMs, 0), target: '≥ dash duration' },
    { metric: 'i-frames cover the whole dash', value: r.covered ? 'yes' : 'NO', target: 'yes' },
    { metric: 'dash→dash cycle when mashed (ms)', value: fmt(r.cycle * ctx.frameMs, 0), target: '550–700' },
    { metric: 'dashes in 2.3s of mashing', value: r.dashes, target: '3–4' },
    { metric: 'trail puffs per dash', value: r.trail, target: '4–7' },
    { metric: 'hp lost dashing through an enemy', value: 6 - safe.hpDash, target: '0' },
    { metric: 'hp lost walking through one (control)', value: 6 - safe.hpWalk, target: '>0' },
  ];
}

async function telegraphs(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    const o = F.arena();
    const cx = o.x + Math.floor(o.w / 2);
    const out: any[] = [];

    // BRAMBLE: wind-up frame appearing → body reaching where the player stood.
    {
      F.reset(); F.clean(); F.scripted(true);
      const px = F.px(cx), py = F.py(o.y + o.h - 2);
      F.place(px, py, 'n');
      F.scene.enemies.spawn('bramble', cx, o.y + o.h - 6);
      const s = (await F.run(220)).slice();
      const tel = s.findIndex((x: any) => x.en[0] && x.en[0].m === 'telegraph');
      const atk = s.findIndex((x: any) => x.en[0] && x.en[0].m === 'attack');
      let hit = -1;
      for (let i = Math.max(tel, 0); i < s.length; i++) {
        const e = s[i].en[0];
        if (!e) break;
        if (Math.abs(e.x - px) < 11 && Math.abs(e.y - py) < 14) { hit = i; break; }
      }
      out.push({ kind: 'bramble', wind: atk - tel, total: hit - tel });
    }

    // WISP: aim frame → projectile reaching the player.
    {
      F.reset(); F.clean(); F.scripted(true);
      F.place(F.px(cx), F.py(o.y + o.h - 2), 'n');
      F.scene.enemies.spawn('wisp', cx, o.y + o.h - 6);
      const s = (await F.run(260)).slice();
      const tel = s.findIndex((x: any) => x.en[0] && x.en[0].m === 'telegraph');
      const shot = s.findIndex((x: any, i: number) => i > tel && x.shots > 0);
      const hurt = s.findIndex((x: any, i: number) => i > tel && x.hp < 6);
      out.push({ kind: 'wisp', wind: shot - tel, total: hurt - tel });
    }

    // MIMICLING: no telegraph by design; measure how delayed the copy is.
    {
      F.reset(); F.clean(); F.scripted(true);
      F.place(F.px(o.x + 1), F.py(o.y + Math.floor(o.h / 2)), 'e');
      F.scene.enemies.spawn('mimicling', o.x + 1, o.y + Math.floor(o.h / 2) - 1);
      F.at(2, 'F.move(1,0)');
      const s = (await F.run(140)).slice();
      F.move(0, 0);
      const x0 = s[0].en[0] ? s[0].en[0].x : 0;
      const moved = s.findIndex((x: any) => x.en[0] && Math.abs(x.en[0].x - x0) > 2);
      out.push({ kind: 'mimicling', wind: moved - 2, total: moved - 2 });
    }
    F.clean();
    return out;
  }) as any[];

  return r.map((e) => ({
    enemy: e.kind,
    'tell→commit (ms)': e.wind > 0 ? fmt(e.wind * ctx.frameMs, 0) : 'n/a',
    'tell→hit (ms)': e.total > 0 ? fmt(e.total * ctx.frameMs, 0) : 'never landed',
    'fair at 300ms reaction': e.total > 0 ? (e.total * ctx.frameMs >= 400 ? 'yes' : 'NO') : '—',
  }));
}

async function load20(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    F.trackHp = false;
    const o = F.arena();
    F.place(F.px(o.x + Math.floor(o.w / 2)), F.py(o.y + Math.floor(o.h / 2)), 's');
    const kinds = ['bramble', 'wisp', 'mimicling'];
    for (let i = 0; i < 20; i++) F.scene.enemies.spawn(kinds[i % 3], o.x + (i % o.w), o.y + (i % (o.h - 2)));
    F.at(2, 'F.move(1,0)');
    for (let i = 10; i < 300; i += 24) F.at(i, "F.act('attack')");
    const s = (await F.run(300)).slice();
    F.move(0, 0);
    const sorted = (k: string) => s.slice(40).map((x: any) => x[k]).sort((a: number, b: number) => a - b);
    const dts = sorted('dt'), ups = sorted('upd');
    const alive = s[s.length - 1].en.length;
    F.clean();
    return {
      p50: dts[Math.floor(dts.length * 0.5)], p95: dts[Math.floor(dts.length * 0.95)], max: dts[dts.length - 1],
      u50: ups[Math.floor(ups.length * 0.5)], u95: ups[Math.floor(ups.length * 0.95)], umax: ups[ups.length - 1],
      alive,
    };
  }) as any;
  return [
    { metric: 'enemies spawned / still alive', value: `20 / ${r.alive}`, target: '—' },
    { metric: 'frame delta p95 (ms)', value: fmt(r.p95, 2), target: '<16.7 (vsync-capped)' },
    { metric: 'frame delta max (ms)', value: fmt(r.max, 2), target: '—' },
    { metric: 'scene update cost p50 (ms)', value: fmt(r.u50, 2), target: '—' },
    { metric: 'scene update cost p95 (ms)', value: fmt(r.u95, 2), target: '<8' },
    { metric: 'scene update cost max (ms)', value: fmt(r.umax, 2), target: '<16' },
  ];
}

async function snag(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async (town) => {
    const F = (window as any).__F;
    F.goto(town);
    await new Promise((res) => setTimeout(res, 400));
    F.clean(); F.scripted(true);
    // Walk between real destinations across the town rather than blindly into
    // buildings: aim straight at an open tile 6–12 tiles away, hold that
    // direction, and see whether progress ever stutters on the way.
    const solid = F.scene.world.solid;
    const open: Array<[number, number]> = [];
    for (let y = 2; y < solid.length - 2; y++) {
      for (let x = 2; x < solid[0].length - 2; x++) if (!solid[y][x] && !F.scene.dynamicSolids[y][x]) open.push([x, y]);
    }
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    let snags = 0, held = 0, moving = 0, dist = 0, frames = 0;
    const spans: number[] = [];
    let here = open[Math.floor(rnd() * open.length)];
    F.place(F.px(here[0]), F.py(here[1]), 's');
    for (let leg = 0; leg < 16; leg++) {
      const near = open.filter((t) => {
        const d = Math.hypot(t[0] - here[0], t[1] - here[1]);
        return d > 6 && d < 12;
      });
      if (!near.length) { here = open[Math.floor(rnd() * open.length)]; F.place(F.px(here[0]), F.py(here[1]), 's'); continue; }
      const to = near[Math.floor(rnd() * near.length)];
      const dx = to[0] - here[0], dy = to[1] - here[1];
      // Just enough frames to arrive, so the leg does not end up grinding into
      // whatever lies past the destination.
      const legFrames = Math.round((Math.hypot(dx, dy) * 16) / 1.37) + 8;
      F.reset();
      F.at(1, `F.move(${dx},${dy})`);
      const s = (await F.run(legFrames)).slice();
      F.move(0, 0);
      frames += s.length;
      for (let k = 1; k < s.length; k++) dist += Math.hypot(s[k].x - s[k - 1].x, s[k].y - s[k - 1].y);
      held += s.filter((r2: any) => r2.ax || r2.ay).length;
      moving += s.filter((r2: any) => r2.sp > 8).length;
      // A snag is forward progress stopping for a beat while the stick is still
      // held, and then resuming. A permanent stop is a wall, not a snag.
      let i = 1;
      while (i < s.length) {
        if (s[i].sp < 8 && (s[i].ax || s[i].ay) && s[i - 1].sp > 40) {
          let j = i;
          while (j < s.length && s[j].sp < 8) j++;
          if (j < s.length && s[j].sp > 40 && j - i <= 20) { snags++; spans.push(j - i); }
          i = j + 1;
        } else i++;
      }
      const last = s[s.length - 1];
      here = [Math.floor(last.x / 16), Math.floor((last.y - 1) / 16)];
    }
    F.clean();
    return { snags, spans, dist, held, moving, frames };
  }, TOWN) as any;
  return [
    { metric: 'snag events on the town tour', value: r.snags, target: '0–2' },
    { metric: 'longest snag (frames)', value: r.spans.length ? Math.max(...r.spans) : 0, target: '≤4' },
    { metric: 'frames moving / input held (%)', value: fmt((r.moving / r.held) * 100, 1), target: '≥85' },
    { metric: 'distance travelled (px)', value: fmt(r.dist, 0), target: '—' },
  ];
}

async function stuck(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean();
    const solid = F.scene.world.solid;
    const blocked = (p: any) => {
      const g = F.scene.collisionGrid();
      const b = p.box;
      const l = b.x - b.w / 2, r2 = b.x + b.w / 2, t = b.y - b.h, bo = b.y;
      for (let ty = Math.floor(t / 16); ty <= Math.floor((bo - 0.001) / 16); ty++) {
        for (let tx = Math.floor(l / 16); tx <= Math.floor((r2 - 0.001) / 16); tx++) {
          if (ty < 0 || ty >= g.length || tx < 0 || tx >= g[0].length || g[ty][tx]) return true;
        }
      }
      return false;
    };
    let tried = 0, fixed = 0;
    const failed: number[][] = [];
    const p = F.scene.player;
    for (let y = 2; y < solid.length - 2 && tried < 60; y += 3) {
      for (let x = 2; x < solid[0].length - 2 && tried < 60; x += 5) {
        if (!solid[y][x]) continue;
        tried++;
        p.setPosition(x * 16 + 8, y * 16 + 16);
        p.grid = F.scene.collisionGrid();
        p.ensureUnstuck();
        if (!blocked(p)) fixed++; else failed.push([x, y]);
      }
    }
    F.clean();
    return { tried, fixed, failed: failed.slice(0, 6) };
  }) as any;
  return [
    { metric: 'solid tiles the player was dropped into', value: r.tried, target: '—' },
    { metric: 'unstick() recovered', value: `${r.fixed}/${r.tried}`, target: 'all' },
    { metric: 'failures', value: r.failed.length ? JSON.stringify(r.failed) : 'none', target: 'none' },
  ];
}

async function fxCadence(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    F.place(F.px(o.x + 1), F.py(o.y + Math.floor(o.h / 2)), 'e');
    F.at(2, 'F.move(1,0)');
    F.at(122, 'F.move(0,0)');
    await F.run(130);
    F.move(0, 0);
    const steps = F.events.filter((e: any) => e.name === 'player:step').map((e: any) => e.f);
    const gaps: number[] = [];
    for (let i = 1; i < steps.length; i++) gaps.push(steps[i] - steps[i - 1]);

    // Slash effects must fire once per swing, not once per frame.
    F.reset();
    F.place(F.px(o.x + 1), F.py(o.y + Math.floor(o.h / 2)), 'e');
    for (let i = 1; i < 120; i++) F.at(i, "F.act('attack')");
    const s2 = (await F.run(125)).slice();
    let swings = 0;
    for (let i = 1; i < s2.length; i++) if (s2[i].mode === 'attack' && s2[i - 1].mode !== 'attack') swings++;
    const slashes = F.events.filter((e: any) => e.name === 'player:attack').length;
    F.clean();
    return { steps: steps.length, gaps, swings, slashes };
  }) as any;
  const mean = r.gaps.length ? r.gaps.reduce((a: number, b: number) => a + b, 0) / r.gaps.length : NaN;
  return [
    { metric: 'footstep dust per 2s of walking', value: r.steps, target: '6–9' },
    { metric: 'mean gap between steps (ms)', value: fmt(mean * ctx.frameMs, 0), target: '250–330' },
    { metric: 'step gap spread (frames)', value: r.gaps.length ? `${Math.min(...r.gaps)}–${Math.max(...r.gaps)}` : 'n/a', target: 'tight' },
    { metric: 'slash fx per swing', value: r.swings ? fmt(r.slashes / r.swings, 2) : 'n/a', target: '1.00' },
  ];
}

/* ─────────────────────────────── main ────────────────────────────────── */

const TESTS: Record<string, (c: Ctx) => Promise<Row[]>> = {
  latency, ramp, diagonal, corners, wallslide: wallSlide, attack, hitstop,
  knockback, dash, telegraph: telegraphs, load: load20, fx: fxCadence, snag, stuck,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const label = arg('--label');
  const vs = arg('--vs');
  const only = arg('--only')?.split(',').map((s) => s.trim());

  const { browser, page, server, base } = await boot();
  const results: Record<string, Row[]> = {};
  try {
    await load(page, base);
    const arena = await chooseArena(page);
    const frameMs = await calibrate(page);
    const ctx: Ctx = { page, frameMs, arena };
    console.log(`\nFEEL PROBE — median frame delta ${frameMs.toFixed(2)}ms\n${'='.repeat(64)}\n`);

    for (const [name, fn] of Object.entries(TESTS)) {
      if (only && !only.includes(name)) continue;
      try {
        // Arena tests need the arena map; snag and stuck run on the town.
        const want = name === 'snag' || name === 'stuck' ? TOWN : arena;
        await page.evaluate(async (m) => {
          const F = (window as any).__F;
          if (F.scene.mapId !== m) { F.goto(m); await new Promise((r) => setTimeout(r, 350)); }
        }, want);
        const rows = await fn(ctx);
        results[name] = rows;
        console.log(table(name.toUpperCase(), rows));
      } catch (e) {
        console.log(`${name.toUpperCase()}\n  FAILED: ${(e as Error).message.slice(0, 300)}\n`);
        results[name] = [{ metric: 'error', value: (e as Error).message.slice(0, 120), target: '' }];
      }
    }

    if (label) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${label}.json`), JSON.stringify({ frameMs, results }, null, 2));
      console.log(`saved .tmp/feel/${label}.json`);
    }
    if (vs && existsSync(join(OUT, `${vs}.json`))) {
      const prev = JSON.parse(readFileSync(join(OUT, `${vs}.json`), 'utf8'));
      console.log(`\n${'='.repeat(64)}\nBEFORE (${vs}) / AFTER\n`);
      for (const [name, rows] of Object.entries(results)) {
        const old = prev.results[name] as Row[] | undefined;
        if (!old || !rows.length) continue;
        const key = Object.keys(rows[0])[0];
        const val = Object.keys(rows[0])[1];
        const merged = rows.map((r) => {
          const o = old.find((x) => x[key] === r[key]);
          return { [key]: r[key], before: o ? o[val] : '—', after: r[val] };
        });
        console.log(table(name.toUpperCase(), merged as Row[]));
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
