/**
 * AUDIO PROBE
 * ───────────
 * Nobody on this project can listen to the build during a gauntlet run, so the
 * audio gets reviewed the same way the art does: by measurement.
 *
 * This boots the real game in headless Chromium, renders every effect and every
 * music track through an OfflineAudioContext using the *same* signal chain the
 * player hears, pulls the samples back, and checks the things that would
 * actually break the game if they were wrong:
 *
 *   · nothing clips and nothing is inaudible
 *   · the dialogue blip — the most-heard sound in the build — stays short and
 *     stays underneath the combat sounds
 *   · the hand bell really is the town bell (their partial ratios match), which
 *     is the premise of the conditioning quest
 *   · the three lantern tones are far enough apart in pitch to be a fair puzzle
 *   · every track produces continuous sound for at least eight seconds
 *
 *   npx tsx tools/audio_probe.ts              # everything
 *   npx tsx tools/audio_probe.ts --only bell  # names containing 'bell'
 *   npx tsx tools/audio_probe.ts --json out.json
 */
import { chromium, type Browser, type Page } from 'playwright';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

interface SoundAnalysis {
  name: string;
  sampleRate: number;
  peak: number;
  rms: number;
  durationMs: number;
  onsetMs: number;
  head: string;
  windows: number[];
}

interface Row extends SoundAnalysis {
  samples: Float32Array;
  dominant: number;
  peaks: Array<{ freq: number; mag: number }>;
}

// ── signal analysis ─────────────────────────────────────────────────────────

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const xr = re[i + k + half];
        const xi = im[i + k + half];
        const vr = xr * cr - xi * ci;
        const vi = xr * ci + xi * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Hann-windowed magnitude spectrum of the first `n` samples. */
function spectrum(samples: Float32Array, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = (samples[i] ?? 0) * w;
  }
  fft(re, im);
  const half = n >> 1;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/** Parabolic interpolation around a bin, for sub-bin frequency accuracy. */
function refine(mag: Float64Array, k: number, binHz: number): number {
  if (k <= 0 || k >= mag.length - 1) return k * binHz;
  const a = mag[k - 1];
  const b = mag[k];
  const c = mag[k + 1];
  const d = a - 2 * b + c;
  const off = d === 0 ? 0 : (0.5 * (a - c)) / d;
  return (k + off) * binHz;
}

/** Strongest frequency component, ignoring DC and infrasound. */
function dominant(samples: Float32Array, n: number, sr: number): number {
  const mag = spectrum(samples, n);
  const binHz = sr / n;
  const lo = Math.max(1, Math.floor(35 / binHz));
  let best = lo;
  for (let i = lo; i < mag.length; i++) if (mag[i] > mag[best]) best = i;
  return refine(mag, best, binHz);
}

/** Spectral peaks, strongest first. Used to compare the two bells' partials. */
function findPeaks(samples: Float32Array, n: number, sr: number, count: number): Array<{ freq: number; mag: number }> {
  const mag = spectrum(samples, n);
  const binHz = sr / n;
  let max = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > max) max = mag[i];
  const minSep = Math.max(3, Math.round(18 / binHz));
  const cand: Array<{ freq: number; mag: number; bin: number }> = [];
  const lo = Math.max(2, Math.floor(35 / binHz));
  for (let i = lo; i < mag.length - 1; i++) {
    if (mag[i] <= mag[i - 1] || mag[i] < mag[i + 1]) continue;
    if (mag[i] < max * 0.08) continue;
    cand.push({ freq: refine(mag, i, binHz), mag: mag[i], bin: i });
  }
  cand.sort((a, b) => b.mag - a.mag);
  const out: Array<{ freq: number; mag: number; bin: number }> = [];
  for (const c of cand) {
    if (out.some((o) => Math.abs(o.bin - c.bin) < minSep)) continue;
    out.push(c);
    if (out.length >= count) break;
  }
  return out.map(({ freq, mag: m }) => ({ freq, mag: m }));
}

function decode(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// ── call-site coverage ──────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Every name the game passes to `Audio.sfx(...)`. Template literals such as
 * `lantern_tone_${id}` are kept as patterns and satisfied if the library has at
 * least one name that fits. This is the check that catches a system asking for
 * a sound that was never written — which is silence at runtime, and invisible
 * in a screenshot.
 */
function callSiteNames(): { literals: string[]; patterns: string[] } {
  const literals = new Set<string>();
  const patterns = new Set<string>();
  const re = /Audio\.sfx\(\s*(?:[a-zA-Z0-9_.?!=:'"\s]*\?\s*)?(['"`])([^'"`]+)\1/g;
  const ternary = /Audio\.sfx\([^)]*?\?\s*'([^']+)'\s*:\s*'([^']+)'/g;
  for (const file of walk(join(ROOT, 'src'))) {
    if (file.includes(`${'/'}audio${'/'}`)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      (m[2].includes('${') ? patterns : literals).add(m[2]);
    }
    for (const m of src.matchAll(ternary)) { literals.add(m[1]); literals.add(m[2]); }
  }
  return { literals: [...literals].sort(), patterns: [...patterns].sort() };
}

// ── harness ─────────────────────────────────────────────────────────────────

async function boot(): Promise<{ browser: Browser; page: Page; server: ViteDevServer }> {
  const server = await createServer({
    root: ROOT,
    server: { port: 0, strictPort: false, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await server.listen();
  const addr = server.httpServer!.address();
  const port = typeof addr === 'object' && addr ? addr.port : 5199;

  const browser = await chromium.launch({
    // Headless Chrome allows autoplay by default, which would hide the very bug
    // this harness exists to catch. Force the policy a real player's browser
    // uses; OfflineAudioContext is exempt from it, so rendering is unaffected.
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--autoplay-policy=user-gesture-required',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', (e) => console.log(`  page error: ${String(e).slice(0, 200)}`));
  // `?mute=1` so the harness itself is silent; the probe renders offline and
  // never touches the live context.
  await page.goto(`http://127.0.0.1:${port}/?mute=1`, { waitUntil: 'domcontentloaded' });
  // Vite reloads the page once after it pre-bundles Phaser, which destroys any
  // execution context we were holding. Settle, then confirm the module is up.
  await page.waitForTimeout(2500);
  await waitForAudio(page);
  return { browser, page, server };
}

async function waitForAudio(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !!(window as unknown as { __audio?: unknown }).__audio,
    undefined,
    { timeout: 30000 },
  );
}

let sinceReload = 0;
/** Chrome holds every OfflineAudioContext we build; recycle before it gives up. */
async function recycle(page: Page, every = 20): Promise<void> {
  if (++sinceReload < every) return;
  sinceReload = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await waitForAudio(page);
}

/** page.evaluate, retried once if a reload pulled the context out from under us. */
async function ev<T>(page: Page, fn: (arg: string) => T | Promise<T>, arg = ''): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate<T, string>(fn, arg);
    } catch (e) {
      if (attempt >= 3 || !/context was destroyed|Target closed/i.test(String(e))) throw e;
      await page.waitForTimeout(1500);
      await waitForAudio(page);
    }
  }
}

const num = (v: number, d = 3): string => (Number.isFinite(v) ? v.toFixed(d) : '—');

function table(headers: string[], rows: string[][]): string {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]): string =>
    cells.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  return [line(headers), w.map((n) => '─'.repeat(n)).join('  '), ...rows.map(line)].join('\n');
}

interface Check { name: string; ok: boolean; detail: string }

/**
 * Exercises the real, non-offline path: the autoplay gesture, `?mute=1`, and
 * the rule that walking between two maps on the same track must not restart it.
 */
async function liveChecks(page: Page): Promise<Check[]> {
  const out: Check[] = [];
  const base = page.url().split('?')[0];

  // `?mute=1` — the screenshot and playthrough harnesses pass it every run.
  await page.goto(`${base}?mute=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await waitForAudio(page);
  await ev(page, () => { (window as any).__audio.playMusic('town'); return 0; });
  // A real click, not a synthetic event: only trusted gestures unlock audio.
  await page.mouse.click(400, 300);
  await page.waitForTimeout(600);
  const muted = await ev<{ ready: boolean; starts: number }>(page, async () => {
    const a = (window as any).__audio;
    a.playMusic('town');
    a.sfx('sword');
    await new Promise((r) => setTimeout(r, 250));
    return { ready: a.ready(), starts: a.musicStarts() };
  });
  out.push({
    name: '?mute=1 creates no audio at all',
    ok: !muted.ready && muted.starts === 0,
    detail: `ready=${muted.ready} musicStarts=${muted.starts}`,
  });

  // Unmuted: nothing before a gesture, everything after one.
  const warnings: string[] = [];
  const onConsole = (m: { type(): string; text(): string }): void => {
    if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text());
  };
  page.on('console', onConsole as never);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await waitForAudio(page);

  const before = await ev<boolean>(page, () => {
    (window as any).__audio.playMusic('town');
    return (window as any).__audio.ready();
  });
  out.push({
    name: 'silent until the player touches something',
    ok: before === false,
    detail: `ready before gesture = ${before}`,
  });

  await page.mouse.click(400, 300);
  await page.keyboard.press('z');
  await page.waitForTimeout(800);
  const after = await ev<{ ready: boolean; started: string | null; s1: number; s2: number; now: string | null; s3: number }>(page, async () => {
    const a = (window as any).__audio;
    const started = a.currentTrack();
    const s1 = a.musicStarts();
    a.playMusic('town');            // same map's track again
    await new Promise((r) => setTimeout(r, 300));
    const s2 = a.musicStarts();
    for (const n of a.listSfx()) a.sfx(n, { volume: 0.2 });
    await new Promise((r) => setTimeout(r, 400));
    a.playMusic('woods');
    await new Promise((r) => setTimeout(r, 400));
    return { ready: a.ready(), started, s1, s2, now: a.currentTrack(), s3: a.musicStarts() };
  });
  page.off('console', onConsole as never);

  out.push({
    name: 'music requested before the gesture starts on it',
    ok: after.ready === true && after.started === 'town',
    detail: `ready=${after.ready} track=${after.started}`,
  });
  out.push({
    name: 're-entering a map on the same track does not restart it',
    ok: after.s1 === after.s2 && after.s1 > 0,
    detail: `starts ${after.s1} → ${after.s2}, then 'woods' → ${after.s3} (${after.now})`,
  });
  const sfxWarnings = warnings.filter((w) => w.includes('[audio]'));
  out.push({
    name: 'no audio warnings when firing every sound live',
    ok: sfxWarnings.length === 0,
    detail: sfxWarnings.length ? sfxWarnings.slice(0, 3).join(' | ') : 'clean',
  });
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : undefined;

  const { browser, page, server } = await boot();
  const checks: Check[] = [];

  try {
    const sfxNames: string[] = await ev<string[]>(page, () => (window as any).__audio.listSfx());
    const musicNames: string[] = await ev<string[]>(page, () => (window as any).__audio.listMusic());
    const wanted = only ? sfxNames.filter((n) => n.includes(only)) : sfxNames;

    // ── effects ────────────────────────────────────────────────────────────
    const rows: Row[] = [];
    for (const name of wanted) {
      await recycle(page);
      const a: SoundAnalysis = await ev<SoundAnalysis>(page, (n) => (window as any).__audio.renderSfx(n), name);
      const samples = decode(a.head);
      rows.push({
        ...a,
        samples,
        dominant: dominant(samples, 4096, a.sampleRate),
        peaks: findPeaks(samples, 16384, a.sampleRate, 5),
      });
    }

    console.log('\nSOUND EFFECTS\n');
    console.log(table(
      ['name', 'peak', 'rms', 'dur ms', 'dom Hz'],
      rows.map((r) => [r.name, num(r.peak), num(r.rms, 4), r.durationMs.toFixed(0), r.dominant.toFixed(1)]),
    ));

    const clipped = rows.filter((r) => r.peak > 0.99);
    const quiet = rows.filter((r) => r.peak < 0.02);
    checks.push({
      name: 'no effect clips (peak ≤ 0.99)',
      ok: clipped.length === 0,
      detail: clipped.length ? clipped.map((r) => `${r.name}=${num(r.peak)}`).join(', ') : `${rows.length} effects`,
    });
    checks.push({
      name: 'no effect inaudible (peak ≥ 0.02)',
      ok: quiet.length === 0,
      detail: quiet.length ? quiet.map((r) => `${r.name}=${num(r.peak)}`).join(', ') : `${rows.length} effects`,
    });

    const byName = new Map(rows.map((r) => [r.name, r]));
    const blip = byName.get('dialogue_blip');
    const sword = byName.get('sword');
    if (blip) {
      checks.push({
        name: 'dialogue_blip shorter than 120ms',
        ok: blip.durationMs < 120,
        detail: `${blip.durationMs.toFixed(0)}ms`,
      });
    }
    if (blip && sword) {
      const ratio = blip.peak / sword.peak;
      checks.push({
        name: 'dialogue_blip quieter than sword',
        ok: ratio < 0.7,
        detail: `${num(ratio, 2)}× sword peak (${num(blip.peak)} vs ${num(sword.peak)})`,
      });
    }

    // ── the bells share a partial structure ────────────────────────────────
    const town = byName.get('bell_town');
    const small = byName.get('bell_small');
    if (town && small) {
      const ratios = (r: Row): number[] => {
        const fs = r.peaks.map((p) => p.freq).sort((a, b) => a - b);
        return fs.length ? fs.map((f) => f / fs[0]) : [];
      };
      const a = ratios(town);
      const b = ratios(small);
      const len = Math.min(a.length, b.length);
      let worst = 0;
      for (let i = 0; i < len; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]) / Math.max(a[i], 0.001));
      checks.push({
        name: 'bell_town and bell_small share partial ratios',
        ok: len >= 3 && worst < 0.05,
        detail: `town [${a.map((x) => x.toFixed(2)).join(' ')}] small [${b.map((x) => x.toFixed(2)).join(' ')}] worst ${(worst * 100).toFixed(1)}%`,
      });
      const octaves = Math.log2(small.peaks[0].freq / town.peaks[0].freq);
      checks.push({
        name: 'hand bell sits ~2 octaves above the tower bell',
        ok: Math.abs(octaves - 2) < 0.35,
        detail: `${octaves.toFixed(2)} octaves`,
      });
    }

    // ── lantern tones ──────────────────────────────────────────────────────
    const lant = ['lantern_tone_a', 'lantern_tone_b', 'lantern_tone_c']
      .map((n) => byName.get(n))
      .filter((r): r is Row => !!r);
    if (lant.length === 3) {
      const fs = lant.map((r) => r.dominant).sort((a, b) => a - b);
      let closest = Infinity;
      for (let i = 1; i < fs.length; i++) closest = Math.min(closest, (fs[i] - fs[i - 1]) / fs[i - 1]);
      checks.push({
        name: 'lantern tones separated by > 15%',
        ok: closest > 0.15,
        detail: `${fs.map((f) => f.toFixed(0)).join(' / ')} Hz, closest gap ${(closest * 100).toFixed(0)}%`,
      });
      const ref = byName.get('lantern_tone_ref');
      if (ref) {
        const match = lant.find((r) => Math.abs(r.dominant - ref.dominant) / ref.dominant < 0.01);
        checks.push({
          name: 'lantern_tone_ref matches one lantern exactly',
          ok: !!match && Math.abs(ref.peak - match.peak) < 1e-6,
          detail: match ? `${match.name} (${ref.dominant.toFixed(0)}Hz, peak Δ ${(ref.peak - match.peak).toExponential(1)})` : 'no match',
        });
      }
    }

    // ── music ──────────────────────────────────────────────────────────────
    const mrows: Array<{ name: string; a: SoundAnalysis; gapMs: number; startMs: number }> = [];
    for (const name of musicNames) {
      await recycle(page, 4);
      const a: SoundAnalysis = await ev<SoundAnalysis>(page, (n) => (window as any).__audio.renderMusic(n, 12), name);
      // Longest run of near-silent 100ms windows inside the first 10 seconds,
      // measured from the first window that sounds — a track is allowed to fade
      // in, it is not allowed to drop out once it has started.
      const w10 = a.windows.slice(0, 100);
      const start = w10.findIndex((w) => w >= 8e-4);
      let gap = 0;
      let run = 0;
      if (start >= 0) {
        for (const w of w10.slice(start)) {
          if (w < 8e-4) { run++; gap = Math.max(gap, run); } else run = 0;
        }
      } else {
        gap = w10.length;
      }
      mrows.push({ name, a, gapMs: gap * 100, startMs: Math.max(0, start) * 100 });
    }

    console.log('\n\nMUSIC (12s render)\n');
    console.log(table(
      ['track', 'peak', 'rms', 'starts ms', 'sounding s', 'longest gap ms'],
      mrows.map((m) => [
        m.name, num(m.a.peak), num(m.a.rms, 4), m.startMs.toFixed(0),
        (m.a.windows.filter((w) => w >= 8e-4).length / 10).toFixed(1),
        m.gapMs.toFixed(0),
      ]),
    ));

    const musicClip = mrows.filter((m) => m.a.peak > 0.99);
    checks.push({
      name: 'no track clips',
      ok: musicClip.length === 0,
      detail: musicClip.length ? musicClip.map((m) => `${m.name}=${num(m.a.peak)}`).join(', ') : `${mrows.length} tracks`,
    });
    // Sound within half a second of starting, then no dropout longer than
    // 250ms across the following eight seconds.
    const notContinuous = mrows.filter(
      (m) => m.gapMs > 250 || m.startMs > 500
        || m.a.windows.slice(0, 90).filter((w) => w >= 8e-4).length < 80,
    );
    checks.push({
      name: 'every track sounds continuously for 8s+',
      ok: notContinuous.length === 0,
      detail: notContinuous.length
        ? notContinuous.map((m) => `${m.name} starts ${m.startMs}ms gap ${m.gapMs}ms`).join(', ')
        : `${mrows.length} tracks`,
    });

    // Boss escalation must be audibly bigger than the ambient shrine.
    const calm = mrows.find((m) => m.name === 'shrine');
    await recycle(page, 4);
    const boss: SoundAnalysis = await ev<SoundAnalysis>(page, () => (window as any).__audio.renderMusic('boss', 12));
    if (calm) {
      checks.push({
        name: 'shrine at intensity 1.0 is louder than at 0',
        ok: boss.rms > calm.a.rms * 1.3,
        detail: `rms ${num(calm.a.rms, 4)} → ${num(boss.rms, 4)} (${(boss.rms / calm.a.rms).toFixed(2)}×)`,
      });
    }

    // ── every call site resolves ───────────────────────────────────────────
    const { literals, patterns } = callSiteNames();
    const have = new Set(sfxNames);
    const missing = literals.filter((n) => !have.has(n));
    const unmatched = patterns.filter((p) => {
      const rx = new RegExp(`^${p.replace(/\$\{[^}]*\}/g, '[A-Za-z0-9_]+')}$`);
      return !sfxNames.some((n) => rx.test(n));
    });
    checks.push({
      name: 'every Audio.sfx() call site has a sound',
      ok: missing.length === 0 && unmatched.length === 0,
      detail: missing.length || unmatched.length
        ? `missing: ${[...missing, ...unmatched].join(', ')}`
        : `${literals.length} names + ${patterns.length} patterns across src/`,
    });

    // ── live behaviour ─────────────────────────────────────────────────────
    const live = await liveChecks(page);
    checks.push(...live);

    console.log('\n\nCHECKS\n');
    for (const c of checks) {
      console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(46)} ${c.detail}`);
    }
    const failed = checks.filter((c) => !c.ok).length;
    console.log(`\n  ${checks.length - failed}/${checks.length} checks pass\n`);

    if (jsonOut) {
      writeFileSync(jsonOut, JSON.stringify({
        sfx: rows.map(({ samples, head, windows, ...r }) => r),
        music: mrows.map((m) => ({ name: m.name, peak: m.a.peak, rms: m.a.rms, gapMs: m.gapMs })),
        checks,
      }, null, 2));
    }
    process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
