/**
 * FEEL PROBE — measures game feel instead of guessing at it.
 *
 * Boots the real game in headless Chromium, hooks the scene's frame loop, and
 * drives input frame-by-frame so every number below is measured off the actual
 * running controller, not off the constants file.
 *
 *   npm run feel                          # full run, prints tables
 *   npx tsx tools/feel_probe.ts --label before
 *   npx tsx tools/feel_probe.ts --only dash,attack
 *
 * `--label X` writes .tmp/feel/X.json; a later run with `--label Y --vs X`
 * prints a before/after column.
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, '.tmp', 'feel');

/* ─────────────────────────── in-page harness ─────────────────────────── */

/**
 * Installed once per page load. Everything frame-accurate happens in here:
 * Node can only talk to the page between frames, so schedules are expressed in
 * frame numbers and executed from the scene's own pre-update hook.
 */
function installHarness(): void {
  const w = window as any;
  const scene = w.__psyche.scene;
  const F: any = {
    scene,
    frame: 0,
    samples: [] as any[],
    sched: {} as Record<number, string[]>,
    want: 0,
    resolve: null as null | (() => void),
    events: [] as Array<{ f: number; name: string; p: any }>,
  };
  w.__F = F;

  const player = () => F.scene.player;

  F.reset = () => {
    F.frame = 0;
    F.samples = [];
    F.sched = {};
    F.events = [];
  };

  /** Schedule a snippet of JS to run in pre-update of a given frame. */
  F.at = (frame: number, code: string) => {
    (F.sched[frame] ||= []).push(code);
  };

  F.scripted = (on: boolean) => {
    const k = F.scene.keys;
    if (on) k.scripted ||= { axis: { x: 0, y: 0 }, actions: new Set() };
    else k.scripted = null;
  };

  /** Movement intent, normalised exactly like the real stick/keys. */
  F.move = (x: number, y: number) => {
    F.scripted(true);
    const len = Math.hypot(x, y) || 1;
    F.scene.keys.scripted.axis = { x: len > 1 ? x / len : x, y: len > 1 ? y / len : y };
  };

  /**
   * Queue an action for THIS frame. Goes through scripted.actions rather than
   * inject() because inject() lands in a set that keys.update() clears at the
   * top of the next frame.
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
      shake: +(cam.shakeEffect?.isRunning ? 1 : 0),
      en: F.scene.enemies.list.filter((e: any) => !e.dead).map((e: any) => ({
        k: e.kind, x: +e.x.toFixed(2), y: +e.y.toFixed(2), m: e.mode, hp: e.hp,
        an: e.sprite.anims?.currentAnim?.key ?? '',
      })),
      shots: F.scene.enemies.list.reduce((n: number, e: any) => n + e.shots.length, 0),
    };
  };

  F.scene.events.on('preupdate', (_t: number, d: number) => {
    F.lastDelta = d;
    const jobs = F.sched[F.frame];
    if (jobs) for (const code of jobs) { try { new Function('F', 'w', code)(F, w); } catch (e) { console.error(e); } }
  });

  F.scene.events.on('postupdate', () => {
    if (F.want > 0) {
      F.samples.push(F.sample());
      F.frame++;
      if (--F.want === 0 && F.resolve) { const r = F.resolve; F.resolve = null; r(); }
    }
  });

  /** Record N frames. Resolves with the samples. */
  F.run = (n: number) => new Promise((res) => {
    F.want = n;
    F.resolve = () => res(F.samples);
  });

  /* ── arena construction ───────────────────────────────────────────────── */

  /** Find an open WxH block of static floor, nearest the map centre. */
  F.findOpen = (w2: number, h2: number) => {
    const solid = F.scene.world.solid;
    const H = solid.length, W = solid[0].length;
    let best: any = null;
    for (let y = 1; y + h2 < H - 1; y++) {
      for (let x = 1; x + w2 < W - 1; x++) {
        let ok = true;
        for (let j = 0; j < h2 && ok; j++) for (let i = 0; i < w2; i++) if (solid[y + j][x + i]) { ok = false; break; }
        if (!ok) continue;
        const d = Math.abs(x + w2 / 2 - W / 2) + Math.abs(y + h2 / 2 - H / 2);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    return best;
  };

  F.walls = [] as Array<[number, number]>;
  F.setWall = (cells: Array<[number, number]>) => {
    F.clearWalls();
    F.walls = cells;
    for (const [x, y] of cells) F.scene.setDynamicSolid(x, y, true);
  };
  F.clearWalls = () => {
    for (const [x, y] of F.walls) F.scene.setDynamicSolid(x, y, false);
    F.walls = [];
  };

  /** Put the player exactly here, in pixels, at rest. */
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

  F.trackHp = true;
  F.clean = () => {
    F.scene.enemies.clear();
    F.clearWalls();
    F.move(0, 0);
    F.trackHp = true;
    w.__psyche.hp(6);
  };

  /** Centre of the largest guaranteed-open test arena, in pixels. */
  F.arena = (w2 = 13, h2 = 13) => {
    const o = F.findOpen(w2, h2) ?? F.findOpen(9, 9) ?? F.findOpen(7, 7);
    return o;
  };

  /* ── event taps ───────────────────────────────────────────────────────── */
  // Only the three gameplay events that reach FxManager, which is where the
  // page-side shim can see them.
  for (const name of ['player:attack', 'player:step', 'player:dashtrail']) {
    w.__events_on(name, () => F.events.push({ f: F.frame, name }));
  }
}

/* ─────────────────────────────── driver ──────────────────────────────── */

type Row = Record<string, string | number>;

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
  // helper that does not exist in the browser; every evaluate() with a nested
  // closure would throw without this identity shim.
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));
  return { browser, page, server, base };
}

async function load(page: Page, base: string, map = 'lumen_vale'): Promise<void> {
  await page.goto(`${base}?skiptitle=1&map=${map}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__psyche?.ready, undefined, { timeout: 30000 });
  await page.waitForTimeout(900);
  // The event bus is module-scoped; re-export `on` through the scene's own
  // import graph so the harness can tap gameplay events.
  await page.evaluate(() => {
    const w = window as any;
    const bus: Record<string, Set<(p: any) => void>> = (w.__busTaps ||= {});
    w.__events_on = (name: string, fn: (p: any) => void) => {
      (bus[name] ||= new Set()).add(fn);
    };
    // Wrap FxManager's handlers is fragile; instead patch emit at the source by
    // monkey-patching the scene's known emitters through a shared shim.
    if (!w.__emitPatched) {
      w.__emitPatched = true;
      const fx = w.__psyche.scene.fx;
      const orig = fx.constructor.prototype;
      for (const [ev, meth] of [['player:attack', 'slash'], ['player:step', 'dust'], ['player:dashtrail', 'dashTrail']] as const) {
        const m = orig[meth];
        orig[meth] = function (this: any, ...a: any[]) {
          bus[ev]?.forEach((f) => f({ a }));
          return m.apply(this, a);
        };
      }
    }
  });
  await page.evaluate(installHarness);
}

const fmt = (n: number, d = 1): string => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');

function table(title: string, rows: Row[]): string {
  if (!rows.length) return `${title}\n  (no rows)\n`;
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells: Array<string | number>) =>
    '  ' + cells.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ');
  return [
    title,
    line(cols),
    '  ' + w.map((n) => '-'.repeat(n)).join('  '),
    ...rows.map((r) => line(cols.map((c) => r[c]))),
    '',
  ].join('\n');
}

/* ───────────────────────────── measurements ──────────────────────────── */

interface Ctx { page: Page; ms: (frames: number) => number; frameMs: number }

/** Mean frame delta, so frame counts can be reported honestly in ms. */
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
  // Pass 1: a real key on a real keyboard, through the real InputManager.
  await page.evaluate(() => {
    const F = (window as any).__F;
    F.reset(); F.clean();
    const o = F.arena();
    F.place((o.x + 2) * 16 + 8, (o.y + 6) * 16 + 16, 's');
    F.scripted(false);
  });
  await page.focus('canvas').catch(() => {});
  const run = page.evaluate(() => (window as any).__F.run(40));
  await page.waitForTimeout(120);
  await page.keyboard.down('ArrowRight');
  const s = (await run) as any[];
  await page.keyboard.up('ArrowRight');

  const firstAxis = s.findIndex((r) => r.ax !== 0);
  const ok = firstAxis > 0;
  const x0 = ok ? s[firstAxis - 1].x : 0;
  const firstMove = ok ? s.findIndex((r, i) => i >= firstAxis && r.x !== x0) : -1;

  // Pass 2: sub-pixel sweep. The sprite is drawn at Math.round(x), so where the
  // player happens to stand decides whether frame 1 moves a visible pixel.
  const sweep = await page.evaluate(async () => {
    const F = (window as any).__F;
    const out: any[] = [];
    for (const frac of [0, 0.25, 0.5, 0.75]) {
      F.reset(); F.clean(); F.scripted(true);
      const o = F.arena();
      F.place((o.x + 2) * 16 + 8 + frac, (o.y + 6) * 16 + 16, 's');
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

  const worstDraw = Math.max(...sweep.map((r) => r.draw));
  const worstPos = Math.max(...sweep.map((r) => r.pos));
  return [
    { metric: 'keyboard: axis→position (frames)', value: ok ? firstMove - firstAxis : 'KEYBOARD FAIL', target: '0' },
    { metric: 'scripted: input→position (frames)', value: worstPos - 1, target: '0' },
    { metric: 'input→rendered pixel, worst case (frames)', value: worstDraw - 1, target: '≤1' },
    { metric: 'first-frame displacement (px)', value: fmt(sweep[0].step, 2), target: '>0.5' },
  ];
}

async function ramp(ctx: Ctx): Promise<Row[]> {
  const s = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    F.place((o.x + 2) * 16 + 8, (o.y + 6) * 16 + 16, 's');
    F.at(2, 'F.move(1,0)');
    F.at(50, 'F.move(0,0)');
    return await F.run(100);
  }) as any[];
  const top = Math.max(...s.map((r) => r.sp));
  const startF = s.findIndex((r) => r.f >= 2);
  const to95 = s.findIndex((r, i) => i >= startF && r.sp >= top * 0.95);
  const to99 = s.findIndex((r, i) => i >= startF && r.sp >= top * 0.99);
  const relF = s.findIndex((r) => r.f >= 50);
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
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    F.place((o.x + 2) * 16 + 8, (o.y + 2) * 16 + 16, 's');
    F.at(2, 'F.move(1,0)');
    F.at(40, 'F.move(0,0)');
    F.at(46, 'F.move(1,1)');
    F.at(90, 'F.move(0,0)');
    // A stick-ish diagonal that sits just off 45°, the flicker-prone case.
    F.at(96, 'F.move(1,0.93)');
    F.at(140, 'F.move(0,0)');
    const s = await F.run(150);
    return s;
  }) as any[];
  const card = Math.max(...r.slice(0, 44).map((x) => x.sp));
  const diag = Math.max(...r.slice(50, 90).map((x) => x.sp));
  const near = r.slice(100, 140);
  let flips = 0;
  for (let i = 1; i < near.length; i++) if (near[i].dir !== near[i - 1].dir) flips++;
  const diagSeg = r.slice(50, 90);
  let flips45 = 0;
  for (let i = 1; i < diagSeg.length; i++) if (diagSeg[i].dir !== diagSeg[i - 1].dir) flips45++;
  return [
    { metric: 'cardinal top speed (px/s)', value: fmt(card, 1), target: '—' },
    { metric: 'diagonal top speed (px/s)', value: fmt(diag, 1), target: '= cardinal' },
    { metric: 'diagonal / cardinal (%)', value: fmt((diag / card) * 100, 1), target: '≤100' },
    { metric: 'facing flips on exact 45°', value: flips45, target: '0' },
    { metric: 'facing flips near 45° (43°)', value: flips, target: '0' },
  ];
}

async function corners(ctx: Ctx): Promise<Row[]> {
  const res = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    const TILE = 16;
    F.reset(); F.clean();
    const open = F.arena();
    if (!open) return { error: 'no open arena' };
    // Wall across the middle of the arena with a single 1-tile gap.
    const wy = open.y + 6;
    const gapX = open.x + 6;
    const cells: Array<[number, number]> = [];
    for (let x = open.x; x < open.x + 13; x++) if (x !== gapX) cells.push([x, wy]);
    F.setWall(cells);

    const gapCx = gapX * TILE + TILE / 2;
    const startY = (wy + 4) * TILE + TILE; // four tiles below the wall
    const trials: Array<{ name: string; off: number; vec: [number, number] }> = [];
    for (const off of [-7, -5, -3, -1, 1, 3, 5, 7]) trials.push({ name: `straight ${off > 0 ? '+' : ''}${off}px`, off, vec: [0, -1] });
    trials.push({ name: 'diag NE -5px', off: -5, vec: [0.7, -1] });
    trials.push({ name: 'diag NW +5px', off: 5, vec: [-0.7, -1] });
    trials.push({ name: 'diag NE -3px', off: -3, vec: [0.55, -1] });
    trials.push({ name: 'diag NW +3px', off: 3, vec: [-0.55, -1] });

    const out: any[] = [];
    for (const t of trials) {
      F.reset();
      F.place(gapCx + t.off, startY, 'n');
      F.at(1, `F.move(${t.vec[0]},${t.vec[1]})`);
      const s = await F.run(90);
      const throughY = wy * TILE; // top edge of the wall row
      const passed = s.some((r: any) => r.y <= throughY);
      const firstPass = s.findIndex((r: any) => r.y <= throughY);
      out.push({ name: t.name, passed, frames: firstPass < 0 ? -1 : firstPass });
      F.move(0, 0);
    }
    F.clearWalls();
    return { trials: out };
  }) as any;

  if (res.error) return [{ metric: 'corner assist', value: res.error, target: '' }];
  const rows: Row[] = res.trials.map((t: any) => ({
    approach: t.name,
    through: t.passed ? 'yes' : 'NO',
    frames: t.frames < 0 ? '—' : t.frames,
  }));
  const pass = res.trials.filter((t: any) => t.passed).length;
  rows.push({ approach: 'TOTAL', through: `${pass}/${res.trials.length}`, frames: '' });
  return rows;
}

async function wallSlide(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    const TILE = 16;
    F.reset(); F.clean();
    const open = F.arena();
    if (!open) return { error: 'no open arena' };
    const wy = open.y + 6;
    const cells: Array<[number, number]> = [];
    for (let x = open.x; x < open.x + 13; x++) cells.push([x, wy]);
    F.setWall(cells);
    const px = (open.x + 2) * TILE + 8;
    const py = (wy + 1) * TILE + TILE; // standing right below the wall

    // Open-field reference: same diagonal, no wall in the way.
    F.reset();
    F.place((open.x + 2) * TILE + 8, (wy + 4) * TILE + TILE, 's');
    F.at(1, 'F.move(1,-1)');
    const free = await F.run(45);
    F.move(0, 0);

    F.reset();
    F.place(px, py, 's');
    F.at(1, 'F.move(1,-1)');
    const slide = await F.run(45);
    F.move(0, 0);
    F.clearWalls();

    const freeVx = Math.max(...free.map((s: any) => Math.abs(s.vx)));
    const slideVx = Math.max(...slide.slice(10).map((s: any) => Math.abs(s.vx)));
    const freeSpeedX = (free[40].x - free[5].x) / 35;
    const slideSpeedX = (slide[40].x - slide[5].x) / 35;
    return { freeVx, slideVx, freeSpeedX, slideSpeedX };
  }) as any;
  if (r.error) return [{ metric: 'wall slide', value: r.error, target: '' }];
  return [
    { metric: 'open-field vx along axis (px/s)', value: fmt(r.freeVx, 1), target: '—' },
    { metric: 'vx while sliding on wall (px/s)', value: fmt(r.slideVx, 1), target: '—' },
    { metric: 'retention (%)', value: fmt((r.slideVx / r.freeVx) * 100, 1), target: '≥95' },
    { metric: 'px/frame retention (%)', value: fmt((r.slideSpeedX / r.freeSpeedX) * 100, 1), target: '≥95' },
  ];
}

async function attack(ctx: Ctx): Promise<Row[]> {
  const page = ctx.page;
  // Cadence: mash attack every frame for 3 seconds.
  const cad = await page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    F.place((o.x + 6) * 16 + 8, (o.y + 6) * 16 + 16, 's');
    for (let i = 1; i < 180; i++) F.at(i, "F.act('attack')");
    const s = await F.run(185);
    let starts = 0;
    for (let i = 1; i < s.length; i++) if (s[i].mode === 'attack' && s[i - 1].mode !== 'attack') starts++;
    let hbFrames = 0;
    for (const r of s) if (r.hb) hbFrames++;
    return { starts, frames: s.length, hbFrames };
  }) as any;

  // Buffer window: start one attack, press again N frames later, see if it takes.
  const buf = await page.evaluate(async () => {
    const F = (window as any).__F;
    const out: any[] = [];
    for (let k = 2; k <= 26; k++) {
      F.reset(); F.clean(); F.scripted(true);
      const o = F.arena();
      F.place((o.x + 6) * 16 + 8, (o.y + 6) * 16 + 16, 's');
      F.at(1, "F.act('attack')");
      F.at(1 + k, "F.act('attack')");
      const s = await F.run(60);
      let starts: number[] = [];
      for (let i = 1; i < s.length; i++) if (s[i].mode === 'attack' && s[i - 1].mode !== 'attack') starts.push(i);
      out.push({ k, starts: starts.length, first: starts[0] ?? -1, second: starts[1] ?? -1 });
    }
    // How long the first attack occupies, measured not assumed.
    F.reset(); F.clean(); F.scripted(true);
    F.at(1, "F.act('attack')");
    const s2 = await F.run(60);
    const a0 = s2.findIndex((r: any) => r.mode === 'attack');
    let a1 = a0;
    while (a1 < s2.length && s2[a1].mode === 'attack') a1++;
    const hb0 = s2.findIndex((r: any) => r.hb);
    let hb1 = hb0;
    while (hb1 < s2.length && s2[hb1].hb) hb1++;
    return { out, attackFrames: a1 - a0, hbStart: hb0 - a0, hbLen: hb1 - hb0 };
  }) as any;

  const fired = buf.out.filter((o: any) => o.starts >= 2);
  const earliest = fired.length ? Math.min(...fired.map((o: any) => o.k)) : NaN;
  const bufferMs = Number.isFinite(earliest) ? (buf.attackFrames - earliest + 1) * ctx.frameMs : NaN;

  // Movement retention while attacking.
  const mv = await page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    const ax = (o.x + 1) * 16 + 8, ay = (o.y + 6) * 16 + 16;
    F.place(ax, ay, 'e');
    F.at(1, 'F.move(1,0)');
    F.at(20, "F.act('attack')");
    F.at(80, 'F.move(0,0)');
    const s = await F.run(90);
    const atk = s.filter((r: any) => r.mode === 'attack');
    const minSp = Math.min(...atk.map((r: any) => r.sp));
    const dist = s[75].x - s[20].x;
    // Reference: same window, no attack.
    F.reset();
    F.place(ax, ay, 'e');
    F.at(1, 'F.move(1,0)');
    F.at(80, 'F.move(0,0)');
    const s2 = await F.run(90);
    const dist2 = s2[75].x - s2[20].x;
    // Recovery cancel: does pushing a direction end the attack early?
    F.reset();
    F.place(ax, ay, 'e');
    F.at(1, "F.act('attack')");
    F.at(14, 'F.move(0,1)');
    const s3 = await F.run(50);
    const a0 = s3.findIndex((r: any) => r.mode === 'attack');
    let a1 = a0; while (a1 < s3.length && s3[a1].mode === 'attack') a1++;
    return { minSp, dist, dist2, cancelFrames: a1 - a0 };
  }) as any;

  return [
    { metric: 'attack state length (ms)', value: fmt(buf.attackFrames * ctx.frameMs, 0), target: '240–320' },
    { metric: 'hitbox opens at (ms)', value: fmt(buf.hbStart * ctx.frameMs, 0), target: 'after anticipation' },
    { metric: 'hitbox active (ms)', value: fmt(buf.hbLen * ctx.frameMs, 0), target: '80–130' },
    { metric: 'max sustained attacks/s', value: fmt((cad.starts / (cad.frames * ctx.frameMs)) * 1000, 2), target: '3–4' },
    { metric: 'input buffer window (ms)', value: fmt(bufferMs, 0), target: '120–160' },
    { metric: 'speed floor while attacking (px/s)', value: fmt(mv.minSp, 1), target: '>0 (no dead stop)' },
    { metric: 'walk distance kept during attack (%)', value: fmt((mv.dist / mv.dist2) * 100, 0), target: '50–90' },
    { metric: 'attack length when move-cancelled (ms)', value: fmt(mv.cancelFrames * ctx.frameMs, 0), target: '< full length' },
  ];
}

async function hitstop(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const o = F.arena();
    const p = { x: (o.x + 6) * 16 + 8, y: (o.y + 6) * 16 + 16 };
    F.place(p.x, p.y, 'e');
    const tx = Math.floor((p.x + 22) / 16);
    const ty = Math.floor((p.y - 8) / 16);
    F.scene.enemies.spawn('bramble', tx, ty, { passive: true });
    F.at(2, "F.act('attack')");
    const s = await F.run(60);
    const hitF = s.findIndex((r: any) => r.ts < 1);
    let end = hitF; while (end < s.length && s[end].ts < 1) end++;
    const shakeF = s.filter((r: any) => r.shake).length;
    const en0 = s[0].en[0];
    const enHit = s.find((r: any) => r.en.length && r.en[0].hp < en0.hp);
    const enLast = s[s.length - 1].en[0];
    return {
      tsMin: Math.min(...s.map((x: any) => x.ts)),
      stopFrames: hitF < 0 ? 0 : end - hitF,
      shakeFrames: shakeF,
      damaged: !!enHit,
      knock: enLast ? Math.hypot(enLast.x - en0.x, enLast.y - en0.y) : 0,
      anim: enLast?.an ?? '',
    };
  }) as any;
  return [
    { metric: 'time scale during hitstop', value: fmt(r.tsMin, 3), target: '≈0' },
    { metric: 'hitstop length (ms)', value: fmt(r.stopFrames * ctx.frameMs, 0), target: '40–60' },
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
    const p = F.scene.player;
    F.place((o.x + 6) * 16 + 8, (o.y + 6) * 16 + 16, 'e');
    const x0 = p.x, y0 = p.y;
    F.at(2, 'F.scene.player.hurt(1, F.scene.player.x - 20, F.scene.player.y)');
    const s = await F.run(60);
    const far = Math.max(...s.map((r2: any) => Math.hypot(r2.x - x0, r2.y - y0)));
    const invF = s.filter((r2: any) => r2.inv).length;
    let m0 = s.findIndex((r2: any) => r2.mode === 'hurt');
    let m1 = m0; while (m1 < s.length && s[m1].mode === 'hurt') m1++;
    return { far, invF, hurtFrames: m1 - m0 };
  }) as any;
  return [
    { metric: 'player knockback (px)', value: fmt(r.far, 1), target: '8–14 (< enemy)' },
    { metric: 'player hurt lockout (ms)', value: fmt(r.hurtFrames * ctx.frameMs, 0), target: '180–260' },
    { metric: 'hurt i-frames (ms)', value: fmt(r.invF * ctx.frameMs, 0), target: '600–900' },
  ];
}

async function dash(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const open = F.arena();
    const px = (open.x + 2) * 16 + 8, py = (open.y + 6) * 16 + 16;
    F.place(px, py, 'e');
    F.at(2, "F.act('dash')");
    for (let i = 3; i < 120; i++) F.at(i, "F.act('dash')"); // mash: cooldown must hold
    const s = await F.run(130);
    const starts: number[] = [];
    for (let i = 1; i < s.length; i++) if (s[i].mode === 'dash' && s[i - 1].mode !== 'dash') starts.push(i);
    const d0 = starts[0];
    let d1 = d0; while (d1 < s.length && s[d1].mode === 'dash') d1++;
    const dist = Math.hypot(s[d1 - 1].x - s[d0 - 1].x, s[d1 - 1].y - s[d0 - 1].y);
    let inv0 = s.findIndex((x: any) => x.inv);
    let inv1 = inv0; while (inv1 < s.length && s[inv1].inv) inv1++;
    const trail = F.events.filter((e: any) => e.name === 'player:dashtrail' && e.f >= d0 && e.f <= d1).length;
    const cycle = starts.length > 1 ? starts[1] - starts[0] : NaN;
    return {
      dur: d1 - d0, dist, invLen: inv1 - inv0, invStart: inv0 - d0, cycle,
      dashes: starts.length, trail, covered: inv1 >= d1,
    };
  }) as any;

  // i-frame safety: dash straight through an enemy body.
  const safe = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const open = F.arena();
    const px = (open.x + 2) * 16 + 8, py = (open.y + 6) * 16 + 16;
    F.place(px, py, 'e');
    F.scene.enemies.spawn('bramble', Math.floor((px + 26) / 16), Math.floor((py - 8) / 16), { passive: true });
    const hp0 = (window as any).__psyche.state().hp;
    F.at(2, "F.act('dash')");
    const s = await F.run(45);
    const hpMin = Math.min(...s.map((r2: any) => r2.hp));
    // Control: walk through the same enemy without dashing.
    F.reset(); (window as any).__psyche.hp(6);
    F.place(px, py, 'e');
    F.at(1, 'F.move(1,0)');
    const s2 = await F.run(45);
    F.move(0, 0);
    const hpMin2 = Math.min(...s2.map((r2: any) => r2.hp));
    F.clean();
    return { hp0, hpMin, hpMin2 };
  }) as any;

  return [
    { metric: 'dash duration (ms)', value: fmt(r.dur * ctx.frameMs, 0), target: '160–220' },
    { metric: 'dash distance (px)', value: fmt(r.dist, 1), target: '34–48 (2–3 tiles)' },
    { metric: 'i-frames (ms)', value: fmt(r.invLen * ctx.frameMs, 0), target: '≥ dash duration' },
    { metric: 'i-frames cover whole dash', value: r.covered ? 'yes' : 'NO', target: 'yes' },
    { metric: 'dash→dash cycle when mashed (ms)', value: fmt(r.cycle * ctx.frameMs, 0), target: '550–700' },
    { metric: 'dashes in 2s of mashing', value: r.dashes, target: '3–4' },
    { metric: 'trail puffs per dash', value: r.trail, target: '4–7' },
    { metric: 'hp lost dashing through enemy', value: safe.hp0 - safe.hpMin, target: '0' },
    { metric: 'hp lost walking through enemy', value: safe.hp0 - safe.hpMin2, target: '>0 (control)' },
  ];
}

async function telegraphs(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    const out: any[] = [];

    // BRAMBLE — from the wind-up frame appearing to the body reaching the spot
    // the player was standing on when it appeared.
    {
      F.reset(); F.clean(); F.scripted(true);
      const open = F.arena();
      const px = (open.x + 6) * 16 + 8, py = (open.y + 9) * 16 + 16;
      F.place(px, py, 'n');
      F.scene.enemies.spawn('bramble', open.x + 6, open.y + 5);
      const s = await F.run(180);
      const tel = s.findIndex((x: any) => x.en[0] && x.en[0].m === 'telegraph');
      const atk = s.findIndex((x: any) => x.en[0] && x.en[0].m === 'attack');
      // First frame the charging body is within contact range of the start spot.
      let hit = -1;
      for (let i = tel; i >= 0 && i < s.length; i++) {
        const e = s[i].en[0];
        if (!e) break;
        if (Math.abs(e.x - px) < 11 && Math.abs(e.y - py) < 14) { hit = i; break; }
      }
      out.push({ kind: 'bramble', tel, atk, hit, windMs: atk - tel, totalMs: hit - tel, hpLost: 6 - Math.min(...s.map((x: any) => x.hp)) });
    }

    // WISP — aim frame to the projectile arriving at the player's position.
    {
      F.reset(); F.clean(); F.scripted(true);
      const open = F.arena();
      const px = (open.x + 6) * 16 + 8, py = (open.y + 9) * 16 + 16;
      F.place(px, py, 'n');
      F.scene.enemies.spawn('wisp', open.x + 6, open.y + 5);
      const s = await F.run(240);
      const tel = s.findIndex((x: any) => x.en[0] && x.en[0].m === 'telegraph');
      const shot = s.findIndex((x: any, i: number) => i > tel && x.shots > 0);
      const hurt = s.findIndex((x: any, i: number) => i > tel && x.hp < 6);
      out.push({ kind: 'wisp', tel, atk: shot, hit: hurt, windMs: shot - tel, totalMs: hurt - tel, hpLost: 6 - Math.min(...s.map((x: any) => x.hp)) });
    }

    // MIMICLING — no telegraph by design; measure the copy delay instead.
    {
      F.reset(); F.clean(); F.scripted(true);
      const open = F.arena();
      const px = (open.x + 6) * 16 + 8, py = (open.y + 9) * 16 + 16;
      F.place(px, py, 'n');
      F.scene.enemies.spawn('mimicling', open.x + 6, open.y + 6);
      F.at(2, 'F.move(1,0)');
      const s = await F.run(120);
      F.move(0, 0);
      const moved = s.findIndex((x: any) => x.en[0] && Math.abs(x.en[0].x - s[0].en[0].x) > 2);
      out.push({ kind: 'mimicling', tel: 0, atk: moved, hit: -1, windMs: moved, totalMs: moved, hpLost: 0 });
    }
    F.clean();
    return out;
  }) as any[];

  return r.map((e) => ({
    enemy: e.kind,
    'tell→commit (ms)': e.windMs > 0 ? fmt(e.windMs * ctx.frameMs, 0) : 'n/a',
    'tell→hit (ms)': e.totalMs > 0 ? fmt(e.totalMs * ctx.frameMs, 0) : 'never hit',
    'dodgeable @300ms react': e.totalMs * ctx.frameMs >= 400 ? 'yes' : 'NO',
  }));
}

async function load20(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    F.trackHp = false;
    const open = F.arena();
    const px = (open.x + 6) * 16 + 8, py = (open.y + 6) * 16 + 16;
    F.place(px, py, 's');
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const kind = ['bramble', 'wisp', 'mimicling'][i % 3];
      F.scene.enemies.spawn(kind, open.x + 1 + (i % 11), open.y + 1 + Math.floor(i / 11) * 3);
      n++;
    }
    F.at(2, 'F.move(1,0)');
    for (let i = 10; i < 300; i += 30) F.at(i, "F.act('attack')");
    const s = await F.run(300);
    F.move(0, 0);
    const dts = s.slice(30).map((x: any) => x.dt).sort((a: number, b: number) => a - b);
    F.clean();
    return {
      n,
      p50: dts[Math.floor(dts.length * 0.5)],
      p95: dts[Math.floor(dts.length * 0.95)],
      max: dts[dts.length - 1],
    };
  }) as any;
  return [
    { metric: 'enemies spawned', value: r.n, target: '20' },
    { metric: 'frame time p50 (ms)', value: fmt(r.p50, 2), target: '<16.7' },
    { metric: 'frame time p95 (ms)', value: fmt(r.p95, 2), target: '<16' },
    { metric: 'frame time max (ms)', value: fmt(r.max, 2), target: '—' },
  ];
}

async function snag(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    // A long tour of the town, held in one direction per leg.
    const legs: Array<[number, number, number]> = [
      [0, -1, 100], [1, -1, 90], [1, 0, 110], [1, 1, 90],
      [0, 1, 110], [-1, 1, 90], [-1, 0, 110], [-1, -1, 90],
      [0, -1, 90], [1, 0, 90], [0, 1, 90], [-1, 0, 90],
    ];
    let f = 2;
    for (const [x, y, n] of legs) { F.at(f, `F.move(${x},${y})`); f += n; }
    F.at(f, 'F.move(0,0)');
    const s = await F.run(f + 10);
    F.move(0, 0);

    // A snag: forward progress stops for a beat while the stick is still held,
    // then resumes. A permanent stop is a wall, not a snag.
    let snags = 0;
    const spans: number[] = [];
    let i = 1;
    while (i < s.length) {
      if (s[i].sp < 8 && (s[i].ax || s[i].ay) && s[i - 1].sp > 40) {
        let j = i;
        while (j < s.length && s[j].sp < 8) j++;
        const len = j - i;
        if (j < s.length && s[j].sp > 40 && len <= 20) { snags++; spans.push(len); }
        i = j + 1;
      } else i++;
    }
    const dist = s.reduce((acc: number, r2: any, k: number) => k ? acc + Math.hypot(r2.x - s[k - 1].x, r2.y - s[k - 1].y) : 0, 0);
    const held = s.filter((r2: any) => r2.ax || r2.ay).length;
    const moving = s.filter((r2: any) => r2.sp > 8).length;
    F.clean();
    return { snags, spans, dist, held, moving, frames: s.length };
  }) as any;
  return [
    { metric: 'snag events on town tour', value: r.snags, target: '0–2' },
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
    let fixed = 0, tried = 0, failed: any[] = [];
    for (let y = 2; y < solid.length - 2 && tried < 40; y += 3) {
      for (let x = 2; x < solid[0].length - 2 && tried < 40; x += 5) {
        if (!solid[y][x]) continue;
        tried++;
        const p = F.scene.player;
        p.setPosition(x * 16 + 8, y * 16 + 16);
        p.grid = F.scene.collisionGrid();
        p.ensureUnstuck();
        const bad = (function () {
          const g = F.scene.collisionGrid();
          const b = p.box;
          const l = b.x - b.w / 2, r2 = b.x + b.w / 2, t = b.y - b.h, bo = b.y;
          for (let ty = Math.floor(t / 16); ty <= Math.floor((bo - 0.001) / 16); ty++)
            for (let tx = Math.floor(l / 16); tx <= Math.floor((r2 - 0.001) / 16); tx++) {
              if (ty < 0 || ty >= g.length || tx < 0 || tx >= g[0].length || g[ty][tx]) return true;
            }
          return false;
        })();
        if (!bad) fixed++; else failed.push([x, y]);
      }
    }
    F.clean();
    return { tried, fixed, failed: failed.slice(0, 5) };
  }) as any;
  return [
    { metric: 'solid tiles tested', value: r.tried, target: '—' },
    { metric: 'unstick() recovered', value: `${r.fixed}/${r.tried}`, target: 'all' },
    { metric: 'failures', value: r.failed.length ? JSON.stringify(r.failed) : 'none', target: 'none' },
  ];
}

async function fxCadence(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean(); F.scripted(true);
    const open = F.arena();
    F.place((open.x + 1) * 16 + 8, (open.y + 6) * 16 + 16, 'e');
    F.at(2, 'F.move(1,0)');
    F.at(120, 'F.move(0,0)');
    const s = await F.run(130);
    const steps = F.events.filter((e: any) => e.name === 'player:step');
    const gaps: number[] = [];
    for (let i = 1; i < steps.length; i++) gaps.push(steps[i].f - steps[i - 1].f);
    F.clean();
    return { steps: steps.length, gaps, frames: 118 };
  }) as any;
  const mean = r.gaps.length ? r.gaps.reduce((a: number, b: number) => a + b, 0) / r.gaps.length : NaN;
  return [
    { metric: 'footstep dust events / 2s walk', value: r.steps, target: '6–9' },
    { metric: 'mean gap between steps (ms)', value: fmt(mean * ctx.frameMs, 0), target: '250–330' },
    { metric: 'gap spread (frames)', value: r.gaps.length ? `${Math.min(...r.gaps)}–${Math.max(...r.gaps)}` : 'n/a', target: 'tight' },
  ];
}

/* ─────────────────────────────── main ────────────────────────────────── */

/** Ad-hoc trajectory dump, for when a number looks wrong and you need frames. */
async function debugDump(ctx: Ctx): Promise<Row[]> {
  const r = await ctx.page.evaluate(async () => {
    const F = (window as any).__F;
    F.reset(); F.clean();
    const o = F.arena();
    const wy = o.y + 6, gapX = o.x + 6;
    const cells: Array<[number, number]> = [];
    for (let x = o.x; x < o.x + 13; x++) if (x !== gapX) cells.push([x, wy]);
    F.setWall(cells);
    const gapCx = gapX * 16 + 8;
    F.reset();
    F.place(gapCx + 5, (wy + 4) * 16 + 16, 'n');
    F.at(1, 'F.move(0,-1)');
    const s = await F.run(80);
    F.move(0, 0); F.clearWalls();
    return {
      map: F.scene.mapId, arena: o, wy, gapX, gapCx,
      rows: s.filter((_: any, i: number) => i % 4 === 0).map((x: any) => `${x.f} x=${x.x} y=${x.y} vx=${x.vx} vy=${x.vy} m=${x.mode}`),
    };
  }) as any;
  console.log(JSON.stringify({ map: r.map, arena: r.arena, wy: r.wy, gapX: r.gapX, gapCx: r.gapCx }));
  r.rows.forEach((l: string) => console.log('   ' + l));
  return [{ metric: 'dump', value: 'see above', target: '' }];
}

const TESTS: Record<string, (c: Ctx) => Promise<Row[]>> = {
  debug: debugDump,
  latency, ramp, diagonal, corners, wallslide: wallSlide, attack, hitstop,
  knockback, dash, telegraph: telegraphs, load: load20, snag, stuck, fx: fxCadence,
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
    const frameMs = await calibrate(page);
    const ctx: Ctx = { page, frameMs, ms: (f) => f * frameMs };
    console.log(`\nFEEL PROBE — median frame delta ${frameMs.toFixed(2)}ms\n${'='.repeat(60)}\n`);

    for (const [name, fn] of Object.entries(TESTS)) {
      if (only && !only.includes(name)) continue;
      try {
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
      console.log(`\n${'='.repeat(60)}\nDELTA vs ${vs}\n`);
      for (const [name, rows] of Object.entries(results)) {
        const old = prev.results[name] as Row[] | undefined;
        if (!old) continue;
        const key = Object.keys(rows[0] ?? {})[0];
        const val = Object.keys(rows[0] ?? {})[1];
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
