/**
 * FEEL STRIP — motion evidence for things a still screenshot cannot show.
 *
 * Numbers say the attack lasts 300ms; they do not say whether it reads as
 * anticipation → strike → follow-through, whether hitstop is visible, or
 * whether the dash trail holds together. So: grab the framebuffer every other
 * frame through a run, tile the frames into one image, and look at it.
 *
 *   npx tsx tools/feel_strip.ts               # all strips
 *   npx tsx tools/feel_strip.ts --only attack
 *
 * Output: shots/feel_<name>.png
 */
import { chromium, type Page, type Browser } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'shots');

/** Frames between captures, and how many to take. */
const EVERY = 2;
const COUNT = 24;
const COLS = 6;
/** Crop taken from the 480x270 framebuffer, centred on the view. */
const CROP = { w: 152, h: 104 };
const ZOOM = 2;

interface Strip {
  name: string;
  note: string;
  /** Runs in the page; schedules the action and returns when capture is done. */
  script: string;
}

const STRIPS: Strip[] = [
  {
    name: 'startstop',
    note: 'Standing start, full speed, dead stop — accel ramp, dust cadence, glide',
    script: `
      const o = F.arena();
      F.place(F.px(o.x + 1), F.py(o.y + Math.floor(o.h / 2)), 'e');
      F.at(2, 'F.move(1,0)');
      F.at(26, 'F.move(0,0)');
    `,
  },
  {
    name: 'attack',
    note: 'Sword connecting with a Bramble — anticipation, strike, hitstop, flash, knockback',
    script: `
      const o = F.arena();
      const cx = o.x + Math.floor(o.w / 2), cy = o.y + Math.floor(o.h / 2);
      F.place(F.px(cx) - 6, F.py(cy), 'e');
      F.scene.enemies.spawn('bramble', cx + 1, cy, { passive: true });
      F.at(4, "F.act('attack')");
    `,
  },
  {
    name: 'dash',
    note: 'Dash through a Wisp shot — i-frames, trail, and no damage taken',
    script: `
      const o = F.arena();
      const cx = o.x + Math.floor(o.w / 2), cy = o.y + Math.floor(o.h / 2);
      F.place(F.px(cx - 3), F.py(cy), 'e');
      const wisp = F.scene.enemies.spawn('wisp', cx + 3, cy, { passive: true });
      // Fire straight down the lane, then dash into the shot as it arrives.
      F.at(1, 'F.wisp.fire(F.scene.player.x, F.scene.player.y - 10)');
      F.wisp = wisp;
      F.dashArmed = false;
      for (let i = 2; i < 60; i++) {
        F.at(i, "if (!F.dashArmed) { const s = F.wisp.shots[0]; if (s && s.img.x - F.scene.player.x < 30) { F.dashArmed = true; F.act('dash'); } }");
      }
    `,
  },
];

/* ── page-side capture harness ─────────────────────────────────────────── */

function installStrip(): void {
  const w = window as any;
  const F = w.__F;
  const game = w.__game;

  F.frames = [] as HTMLImageElement[];

  /**
   * Phaser's WebGL canvas is not preserveDrawingBuffer, so toDataURL is blank;
   * snapshotArea is the supported way to read the framebuffer, and it resolves
   * at the end of the frame it was armed on.
   */
  F.grabArea = (x: number, y: number, cw: number, ch: number) => new Promise<void>((res) => {
    game.renderer.snapshotArea(x, y, cw, ch, (img: HTMLImageElement) => {
      F.frames.push(img);
      res();
    });
  });

  /** Run a scripted beat, capturing every `every` frames. */
  F.strip = async (setup: string, every: number, count: number, cw: number, ch: number) => {
    F.reset(); F.clean(); F.scripted(true);
    F.frames = [];
    new Function('F', 'w', setup)(F, w);
    const cx = Math.round((480 - cw) / 2);
    const cy = Math.round((270 - ch) / 2);
    for (let i = 0; i < count; i++) {
      await F.run(every);
      // run() resolves inside postupdate, which is exactly when a snapshot
      // armed now will capture this frame's render.
      await F.grabArea(cx, cy, cw, ch);
    }
    F.move(0, 0);
    return F.frames.length;
  };

  /** Tile the captured frames into one labelled sheet. */
  F.compose = (cols: number, zoom: number, cw: number, ch: number, label: string) => {
    const n = F.frames.length;
    const rows = Math.ceil(n / cols);
    const pad = 2;
    const cellW = cw * zoom + pad;
    const cellH = ch * zoom + pad + 14;
    const cv = document.createElement('canvas');
    cv.width = cols * cellW + pad;
    cv.height = rows * cellH + pad + 18;
    const g = cv.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#12101a';
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#e8dcc0';
    g.font = '13px monospace';
    g.fillText(label, 4, 13);
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const x = pad + c * cellW, y = 18 + pad + r * cellH;
      g.drawImage(F.frames[i], x, y, cw * zoom, ch * zoom);
      g.strokeStyle = '#3a3050';
      g.strokeRect(x - 0.5, y - 0.5, cw * zoom + 1, ch * zoom + 1);
      g.fillStyle = '#a9c0d6';
      g.fillText(`f${i * 2}`, x + 3, y + ch * zoom + 12);
    }
    return cv.toDataURL('image/png');
  };
}

/* ── driver ────────────────────────────────────────────────────────────── */

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer; base: string }> {
  const server = await createServer({
    root: ROOT,
    server: {
      port: 20000 + Math.floor(Math.random() * 20000), strictPort: false, host: '127.0.0.1',
      hmr: false, watch: { ignored: ['**'] },
    },
    logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    (window as unknown as { __name: <T>(f: T) => T }).__name = (f) => f;
  });
  page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`));
  return { browser, page, server, base: `http://127.0.0.1:${port}/` };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;

  const { browser, page, server, base } = await boot();
  try {
    await page.goto(`${base}?skiptitle=1&map=lumen_vale`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__psyche?.ready, undefined, { timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.evaluate(installProbeHarness);
    await page.evaluate(installStrip);

    mkdirSync(OUT, { recursive: true });
    for (const strip of STRIPS) {
      if (only && strip.name !== only) continue;
      const dataUrl = await page.evaluate(async (s) => {
        const F = (window as any).__F;
        await F.strip(s.script, s.every, s.count, s.cw, s.ch);
        return F.compose(s.cols, s.zoom, s.cw, s.ch, `${s.name.toUpperCase()} — ${s.note}`);
      }, { ...strip, every: EVERY, count: COUNT, cols: COLS, zoom: ZOOM, cw: CROP.w, ch: CROP.h });
      const png = Buffer.from(dataUrl.split(',')[1], 'base64');
      writeFileSync(join(OUT, `feel_${strip.name}.png`), png);
      console.log(`  shots/feel_${strip.name}.png  (${strip.note})`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

/**
 * A trimmed copy of the probe's harness: frame scheduling, arena search and
 * placement. Kept here rather than imported because Playwright serialises the
 * function into the page, so it cannot close over anything.
 */
function installProbeHarness(): void {
  const w = window as any;
  const F: any = {
    scene: w.__psyche.scene, frame: 0, samples: [], sched: {}, want: 0, resolve: null, lastDelta: 16.7,
  };
  w.__F = F;
  F.reset = () => { F.frame = 0; F.samples = []; F.sched = {}; };
  F.at = (frame: number, code: string) => { (F.sched[frame] ||= []).push(code); };
  F.scripted = (on: boolean) => {
    const k = F.scene.keys;
    if (on) k.scripted ||= { axis: { x: 0, y: 0 }, actions: new Set() };
    else k.scripted = null;
  };
  F.move = (x: number, y: number) => {
    F.scripted(true);
    const len = Math.hypot(x, y) || 1;
    F.scene.keys.scripted.axis = { x: len > 1 ? x / len : x, y: len > 1 ? y / len : y };
  };
  F.act = (a: string) => { F.scripted(true); F.scene.keys.scripted.actions.add(a); };
  F.scene.events.on('preupdate', (_t: number, d: number) => {
    F.lastDelta = d;
    const jobs = F.sched[F.frame];
    if (jobs) for (const code of jobs) { try { new Function('F', 'w', code)(F, w); } catch (e) { console.error(e); } }
  });
  F.scene.events.on('postupdate', () => {
    if (F.want > 0) {
      F.frame++;
      if (--F.want === 0 && F.resolve) { const r = F.resolve; F.resolve = null; r(); }
    }
  });
  F.run = (n: number) => new Promise((res) => { F.want = n; F.resolve = () => res(null); });
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
  F.arena = () => {
    for (const n of [13, 11, 9, 7]) { const o = F.findOpen(n, n); if (o) return o; }
    return null;
  };
  F.px = (tx: number) => tx * 16 + 8;
  F.py = (ty: number) => ty * 16 + 16;
  F.place = (px: number, py: number, dir = 's') => {
    const p = F.scene.player;
    p.setPosition(px, py, dir);
    p.vx = p.vy = 0;
    p.mode = 'free';
    p.modeUntil = 0; p.dashReadyAt = 0; p.attackReadyAt = 0; p.invulnUntil = 0;
    p.attackBufferedAt = -9999; p.dashBufferedAt = -9999;
    F.scene.cameras.main.centerOn(px, py);
  };
  F.clean = () => {
    F.scene.enemies.clear();
    F.move(0, 0);
    F.scene.keys.enabled = true;
    w.__psyche.hp(6);
  };
  // Same two boot chores as the probe: no cutscene may lock the player, and the
  // arrival cutscene's leaked per-frame handler must be detached.
  const s = F.scene;
  s.cutscene.run = async () => {};
  s.cutscene.talk = async () => {};
  s.cutscene.active = false;
  s.keys.enabled = true;
  s.player.unlock();
  const em = s.events;
  const cur = em._events && em._events.update;
  if (cur) {
    const arr = Array.isArray(cur) ? cur : [cur];
    for (const l of arr.slice()) {
      if (typeof l.fn === 'function' && String(l.fn).indexOf('target.x') >= 0) em.off('update', l.fn, l.context, l.once);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
