/**
 * AUDIO INTEGRATION
 * ─────────────────
 * Wires the synth, the effect library and the score into the `AudioApi` the
 * rest of the game talks to, and installs it over the null implementation.
 *
 * Three things this layer is responsible for and nothing else is:
 *
 *  1. The autoplay gesture. Browsers refuse to start an AudioContext until the
 *     player touches something, so the context is created lazily and whatever
 *     music the game asked for in the meantime is started the moment they do.
 *  2. Never breaking the game. Every entry point is guarded; if Web Audio is
 *     missing, blocked, or throws, the game runs in silence and no call site
 *     ever finds out.
 *  3. The QA surface — `window.__audio`, including offline rendering, which is
 *     how `tools/audio_probe.ts` measures every sound in the build.
 */
import type Phaser from 'phaser';
import { installAudio, type AudioApi } from './Audio';
import { createRack, setClockRack, type Rack } from './synth';
import { playSfx, sfxNames, setLanternRef, SFX_LENGTH } from './sfx';
import { MusicPlayer, trackNames } from './music';

const MUTE_PARAM = (() => {
  try {
    return new URLSearchParams(location.search).get('mute') === '1';
  } catch {
    return false;
  }
})();

/** Identical sfx fired closer together than this are dropped. */
const REPEAT_MS = 22;
/** Backstop against a runaway caller filling the graph with voices. */
const BURST_LIMIT = 32;
const BURST_MS = 100;

class WebAudio implements AudioApi {
  private rack: Rack | null = null;
  private player: MusicPlayer | null = null;
  private ctx: AudioContext | null = null;
  /** Set by `?mute=1`; suppresses context creation entirely. */
  private silent = MUTE_PARAM;
  private muted = false;
  private volume = 1;
  private failed = false;
  private desired = '';
  private wasRunning = false;
  private lastPlayed = new Map<string, number>();
  private burst: number[] = [];
  private listening = false;

  get ready(): boolean {
    return !!this.rack && this.ctx?.state === 'running';
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  init(_scene: Phaser.Scene): void {
    this.listen();
  }

  private listen(): void {
    if (this.listening || typeof window === 'undefined') return;
    this.listening = true;
    const unlock = (): void => { this.unlock(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) {
      window.addEventListener(ev, unlock, { passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      try {
        if (document.hidden) {
          this.wasRunning = this.ctx.state === 'running';
          if (this.wasRunning) void this.ctx.suspend();
        } else if (this.wasRunning) {
          void this.ctx.resume();
        }
      } catch { /* nothing to do about it */ }
    });
  }

  /** Create the context if we can, and resume it. Safe to call repeatedly. */
  private unlock(): void {
    const r = this.ensure();
    if (!r || !this.ctx) return;
    if (this.ctx.state !== 'running') {
      void this.ctx.resume().then(() => this.flushPending()).catch(() => {});
    }
    this.flushPending();
  }

  private flushPending(): void {
    if (!this.player || !this.desired) return;
    if (this.ctx?.state !== 'running') return;
    this.player.play(this.desired, 800);
  }

  private ensure(): Rack | null {
    if (this.rack) return this.rack;
    if (this.silent || this.failed) return null;
    try {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) { this.failed = true; return null; }
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const rack = createRack(ctx);
      this.ctx = ctx;
      this.rack = rack;
      this.player = new MusicPlayer(rack);
      setClockRack(rack);
      this.applyVolume();
      return rack;
    } catch (e) {
      console.warn('[audio] unavailable, running silent', e);
      this.failed = true;
      return null;
    }
  }

  private applyVolume(): void {
    if (!this.rack) return;
    const g = this.muted ? 0 : 0.85 * this.volume;
    const now = this.rack.ctx.currentTime;
    this.rack.master.gain.cancelScheduledValues(now);
    this.rack.master.gain.setTargetAtTime(g, now, 0.02);
  }

  // ── AudioApi ──────────────────────────────────────────────────────────────

  playMusic(track?: string, fadeMs = 800): void {
    const id = track ?? '';
    this.desired = id;
    const r = this.ensure();
    if (!r || !this.player) return;
    if (this.ctx?.state !== 'running') return; // resumes on first gesture
    try {
      if (!id) this.player.stop(fadeMs);
      else this.player.play(id, fadeMs);
    } catch (e) {
      console.warn('[audio] playMusic failed', e);
    }
  }

  stopMusic(fadeMs = 800): void {
    this.desired = '';
    try { this.player?.stop(fadeMs); } catch { /* ignore */ }
  }

  duckMusic(amount: number, ms: number): void {
    try { this.player?.duckBy(amount, ms); } catch { /* ignore */ }
  }

  sfx(name: string, opts?: { volume?: number; rate?: number; pan?: number }): void {
    const r = this.ensure();
    if (!r || !this.ctx || this.ctx.state !== 'running') return;
    const nowMs = performance.now();

    const last = this.lastPlayed.get(name);
    if (last !== undefined && nowMs - last < REPEAT_MS) return;
    this.lastPlayed.set(name, nowMs);

    while (this.burst.length && nowMs - this.burst[0] > BURST_MS) this.burst.shift();
    if (this.burst.length >= BURST_LIMIT) return;
    this.burst.push(nowMs);

    try {
      const t = this.ctx.currentTime + 0.008;
      if (!playSfx(r, name, t, opts?.volume ?? 1, opts?.rate ?? 1, opts?.pan ?? 0)) {
        console.warn(`[audio] no sfx named '${name}'`);
      }
    } catch (e) {
      console.warn(`[audio] sfx '${name}' failed`, e);
    }
  }

  setMasterVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!m) this.silent = false;
    this.applyVolume();
  }

  // ── extras used by quests and QA ──────────────────────────────────────────

  setIntensity(x: number, seconds?: number): void {
    try { this.player?.setIntensity(x, seconds); } catch { /* ignore */ }
  }

  currentTrack(): string | null {
    return this.player?.currentId ?? null;
  }

  /** How many times a track has actually been started, for QA. */
  musicStarts(): number {
    return this.player?.starts ?? 0;
  }
}

const api = new WebAudio();
installAudio(api);
api.init(undefined as unknown as Phaser.Scene);

/** Raise or lower the shrine track's intensity — the boss fight uses this. */
export function setMusicIntensity(x: number, seconds?: number): void {
  api.setIntensity(x, seconds);
}

export { setLanternRef };

// ── offline rendering, for the audio probe ──────────────────────────────────

export interface SoundAnalysis {
  name: string;
  sampleRate: number;
  /** Highest absolute sample across both channels. */
  peak: number;
  /** RMS of the mono mix over the whole render. */
  rms: number;
  /** Time from the first to the last sample above the noise floor, in ms. */
  durationMs: number;
  onsetMs: number;
  /** Mono samples from the onset, base64-encoded little-endian float32. */
  head: string;
  /** RMS of each 100ms window across the whole render. */
  windows: number[];
}

const FLOOR = 3e-4;
const HEAD_SAMPLES = 16384;

function encode(f: Float32Array): string {
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(s);
}

function analyse(name: string, buf: AudioBuffer): SoundAnalysis {
  const n = buf.length;
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const mono = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < chans.length; c++) {
      const v = chans[c][i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      s += v;
    }
    mono[i] = s / chans.length;
  }

  let sum = 0;
  for (let i = 0; i < n; i++) sum += mono[i] * mono[i];
  const rms = Math.sqrt(sum / Math.max(1, n));

  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (Math.abs(mono[i]) > FLOOR) { if (first < 0) first = i; last = i; }
  }
  if (first < 0) { first = 0; last = 0; }

  const win = Math.max(1, Math.floor(buf.sampleRate * 0.1));
  const windows: number[] = [];
  for (let i = 0; i < n; i += win) {
    let s = 0;
    const end = Math.min(n, i + win);
    for (let j = i; j < end; j++) s += mono[j] * mono[j];
    windows.push(Math.sqrt(s / Math.max(1, end - i)));
  }

  const head = mono.slice(first, Math.min(n, first + HEAD_SAMPLES));
  const padded = head.length === HEAD_SAMPLES ? head : (() => {
    const p = new Float32Array(HEAD_SAMPLES);
    p.set(head);
    return p;
  })();

  return {
    name,
    sampleRate: buf.sampleRate,
    peak,
    rms,
    durationMs: ((last - first) / buf.sampleRate) * 1000,
    onsetMs: (first / buf.sampleRate) * 1000,
    head: encode(padded),
    windows,
  };
}

async function render(seconds: number, fill: (r: Rack) => void): Promise<AudioBuffer> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.max(128, Math.ceil(seconds * sr)), sr);
  const rack = createRack(ctx);
  fill(rack);
  return ctx.startRendering();
}

/** Render one effect through the real signal chain and measure it. */
export async function renderSfx(name: string, seconds?: number): Promise<SoundAnalysis> {
  const secs = seconds ?? SFX_LENGTH[name] ?? 1.0;
  const buf = await render(secs, (r) => { playSfx(r, name, 0.02, 1, 1, 0); });
  return analyse(name, buf);
}

/** Render the first `seconds` of a track, intro included. */
export async function renderMusic(name: string, seconds = 12): Promise<SoundAnalysis> {
  const buf = await render(seconds, (r) => {
    const p = new MusicPlayer(r, true);
    p.renderOffline(name, seconds);
  });
  return analyse(name, buf);
}

// ── QA surface ──────────────────────────────────────────────────────────────

export interface AudioDebug {
  sfx(name: string, opts?: { volume?: number; rate?: number; pan?: number }): void;
  playMusic(track?: string, fadeMs?: number): void;
  stopMusic(fadeMs?: number): void;
  setMasterVolume(v: number): void;
  setMuted(m: boolean): void;
  setIntensity(x: number, seconds?: number): void;
  setLanternRef(which: 'a' | 'b' | 'c'): void;
  listSfx(): string[];
  listMusic(): string[];
  currentTrack(): string | null;
  musicStarts(): number;
  ready(): boolean;
  renderSfx(name: string, seconds?: number): Promise<SoundAnalysis>;
  renderMusic(name: string, seconds?: number): Promise<SoundAnalysis>;
}

declare global {
  interface Window { __audio?: AudioDebug }
}

if (typeof window !== 'undefined') {
  window.__audio = {
    sfx: (n, o) => api.sfx(n, o),
    playMusic: (t, f) => api.playMusic(t, f),
    stopMusic: (f) => api.stopMusic(f),
    setMasterVolume: (v) => api.setMasterVolume(v),
    setMuted: (m) => api.setMuted(m),
    setIntensity: (x, s) => api.setIntensity(x, s),
    setLanternRef,
    listSfx: () => sfxNames(),
    listMusic: () => trackNames(),
    currentTrack: () => api.currentTrack(),
    musicStarts: () => api.musicStarts(),
    ready: () => api.ready,
    renderSfx,
    renderMusic,
  };
}
