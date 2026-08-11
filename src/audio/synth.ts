/**
 * WEB AUDIO ENGINE
 * ────────────────
 * Every sound in Project Psyche is generated here at runtime. There are no
 * sample files anywhere in the project, and that is a design requirement rather
 * than a download-size optimisation: the conditioning quest needs the hand bell
 * to quote the town bell's motif *exactly*, which is only possible when a sound
 * is a function of data instead of a recording.
 *
 * Everything in this file is deliberately context-agnostic. Generators take a
 * `Rack` — a bundle of an AudioContext plus its buses — so the identical code
 * path renders into the live AudioContext during play and into an
 * OfflineAudioContext for `tools/audio_probe.ts`. What the probe measures is
 * therefore what the player hears, not an approximation of it.
 */

// ── small numeric helpers ───────────────────────────────────────────────────

/** MIDI note number → frequency in Hz. */
export const mtof = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Uniform random in [a, b). Used for the small per-trigger variations. */
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Random multiplier centred on 1, e.g. `vary(0.03)` → 0.97..1.03. */
export const vary = (amount: number): number => 1 + (Math.random() * 2 - 1) * amount;

/** exponentialRampToValueAtTime cannot touch zero. */
const EPS = 0.0001;

/**
 * Deterministic RNG for anything baked into a buffer — the noise bed and the
 * reverb impulse. Those are the *room*, not a performance: they should sound
 * the same in every session, and making them reproducible is also what lets the
 * offline probe compare two renders of the same effect sample-for-sample.
 * Per-trigger variation still uses Math.random via `rand`/`vary`.
 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── the rack ────────────────────────────────────────────────────────────────

export interface Rack {
  readonly ctx: BaseAudioContext;
  /** Final gain before the compressor — the "master volume" knob. */
  readonly master: GainNode;
  /** Music bus. Music voices route here so `duckMusic` can dip only music. */
  readonly music: GainNode;
  /** Sound-effect bus. */
  readonly sfx: GainNode;
  /** Send bus into the shared convolution reverb. */
  readonly reverbSend: GainNode;
  /** Send bus into the shared feedback delay. */
  readonly delaySend: GainNode;
  readonly compressor: DynamicsCompressorNode;
}

export interface RackOpts {
  reverbSeconds?: number;
  reverbDecay?: number;
  reverbMix?: number;
  delayTime?: number;
  delayFeedback?: number;
  delayMix?: number;
  masterGain?: number;
  musicGain?: number;
}

/**
 * Soft-clip curve for the safety limiter: perfectly linear below 0.6, a tanh
 * knee above it, asymptotic to 0.98. Signals are mixed at levels that keep this
 * dormant; it exists so that an unlucky pile-up — a bell, a crit and a boss
 * roar landing on the same sample — saturates gently instead of clipping.
 */
function limiterCurve(): Float32Array<ArrayBuffer> {
  const n = 4097;
  // Explicitly ArrayBuffer-backed: WaveShaperNode.curve does not accept a view
  // that might sit on a SharedArrayBuffer.
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    // The shaper sees the signal at half level, so the curve covers ±2.
    const v = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(v);
    const y = a <= 0.6 ? a : 0.6 + 0.38 * Math.tanh((a - 0.6) / 0.4);
    curve[i] = v < 0 ? -y : y;
  }
  return curve;
}

/**
 * Build the full signal graph on a context:
 *
 *   voices ─┬─→ music ─┐
 *           └─→ sfx  ──┼─→ master ─→ compressor ─→ limiter ─→ destination
 *   sends ──→ reverb ──┤
 *          └─→ delay ──┘
 *
 * The compressor is gentle: it exists to stop a bell strike landing on top of a
 * sword swing and a full band from clipping, not to squash the mix.
 */
export function createRack(ctx: BaseAudioContext, o: RackOpts = {}): Rack {
  const master = ctx.createGain();
  master.gain.value = o.masterGain ?? 0.85;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -13;
  compressor.knee.value = 14;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.25;

  const half = ctx.createGain();
  half.gain.value = 0.5;
  const shaper = ctx.createWaveShaper();
  shaper.curve = limiterCurve();
  shaper.oversample = '2x';

  master.connect(compressor);
  compressor.connect(half);
  half.connect(shaper);
  shaper.connect(ctx.destination);

  const music = ctx.createGain();
  music.gain.value = o.musicGain ?? 0.62;
  music.connect(master);

  const sfx = ctx.createGain();
  sfx.gain.value = 1;
  sfx.connect(master);

  // Effect sends land back on the sfx bus, never on the master. A send that
  // bypasses its own bus is a send that cannot be faded, ducked or crossfaded,
  // and the wet tail carries on at full level while the dry signal ducks.
  const { reverbSend, delaySend } = createSends(ctx, sfx, o);

  return { ctx, master, music, sfx, reverbSend, delaySend, compressor };
}

/**
 * A reverb and a feedback delay feeding `dest`.
 *
 * Built per bus rather than once globally: the music player gives every playing
 * track its own pair so a track's reverb tail crossfades, ducks and stops with
 * the track that made it.
 */
export function createSends(
  ctx: BaseAudioContext, dest: AudioNode, o: RackOpts = {},
): { reverbSend: GainNode; delaySend: GainNode; nodes: AudioNode[] } {
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = impulse(ctx, o.reverbSeconds ?? 2.2, o.reverbDecay ?? 2.8);
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = 1;
  const revWet = ctx.createGain();
  revWet.gain.value = o.reverbMix ?? 0.85;
  reverbSend.connect(conv);
  conv.connect(revWet);
  revWet.connect(dest);

  // 0.27s is well above the 128-sample minimum a feedback loop through a
  // DelayNode requires, so the loop is legal.
  const dl = ctx.createDelay(2);
  dl.delayTime.value = o.delayTime ?? 0.27;
  const fb = ctx.createGain();
  fb.gain.value = o.delayFeedback ?? 0.34;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 2400;
  const delaySend = ctx.createGain();
  delaySend.gain.value = 1;
  const dlWet = ctx.createGain();
  dlWet.gain.value = o.delayMix ?? 0.5;
  delaySend.connect(dl);
  dl.connect(damp);
  damp.connect(fb);
  fb.connect(dl);
  dl.connect(dlWet);
  dlWet.connect(dest);

  return { reverbSend, delaySend, nodes: [reverbSend, conv, revWet, delaySend, dl, damp, fb, dlWet] };
}

// ── shared buffers ──────────────────────────────────────────────────────────

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of stereo white noise, generated once per context. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const hit = noiseCache.get(ctx);
  if (hit) return hit;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const rnd = prng(0x5eedbeef);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  }
  noiseCache.set(ctx, buf);
  return buf;
}

const irCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/**
 * Synthesised reverb impulse: a short pre-delay, a handful of early
 * reflections, then an exponentially decaying noise tail, one-pole lowpassed so
 * the room sounds like wood and stone rather than white noise.
 */
export function impulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  let map = irCache.get(ctx);
  if (!map) { map = new Map(); irCache.set(ctx, map); }
  const key = `${seconds.toFixed(2)}|${decay.toFixed(2)}`;
  const hit = map.get(key);
  if (hit) return hit;

  const sr = ctx.sampleRate;
  const pre = Math.floor(sr * 0.012);
  const len = Math.max(64, Math.floor(sr * seconds) + pre);
  const buf = ctx.createBuffer(2, len, sr);
  const early = [0.013, 0.021, 0.031, 0.044, 0.058, 0.077];
  const rnd = prng(0xa17e9b21);

  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = pre; i < len; i++) {
      const x = (i - pre) / (len - pre);
      d[i] = (rnd() * 2 - 1) * Math.pow(1 - x, decay);
    }
    // Early reflections give the tail a sense of size.
    for (let e = 0; e < early.length; e++) {
      const idx = pre + Math.floor(sr * early[e] * (c ? 1.07 : 1));
      if (idx < len) d[idx] += (e % 2 ? -1 : 1) * 0.45 * Math.pow(0.72, e);
    }
    // One-pole lowpass, then normalise so `reverbMix` means something stable.
    let z = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      z += 0.32 * (d[i] - z);
      d[i] = z;
      const a = Math.abs(z);
      if (a > peak) peak = a;
    }
    if (peak > 0) {
      const k = 0.42 / peak;
      for (let i = 0; i < len; i++) d[i] *= k;
    }
  }
  map.set(key, buf);
  return buf;
}

// ── envelopes and routing ───────────────────────────────────────────────────

export interface Env {
  attack?: number;
  decay?: number;
  /** Sustain LEVEL as a fraction of peak. 0 gives a purely percussive shape. */
  sustain?: number;
  /** Seconds held at the sustain level. */
  hold?: number;
  release?: number;
}

export interface VoiceOpts extends Env {
  gain?: number;
  pan?: number;
  /** Overrides the destination bus (defaults to the sfx bus). */
  dest?: AudioNode;
  /** 0..1 send into the shared reverb. */
  reverb?: number;
  /** 0..1 send into the shared delay. */
  delay?: number;
}

/**
 * Attack → decay → (sustain hold) → release, all exponential so it sounds like
 * something physical rather than a fader move. Returns the end time.
 */
export function applyEnv(p: AudioParam, t: number, peak: number, e: Env): number {
  const a = Math.max(0.0005, e.attack ?? 0.004);
  const d = Math.max(0.001, e.decay ?? 0.09);
  const s = clamp(e.sustain ?? 0, 0, 1);
  const h = Math.max(0, e.hold ?? 0);
  const r = Math.max(0.004, e.release ?? 0.06);
  const top = Math.max(peak, EPS * 2);

  p.setValueAtTime(EPS, t);
  p.exponentialRampToValueAtTime(top, t + a);
  if (s > 0.001) {
    const sus = Math.max(top * s, EPS * 2);
    p.exponentialRampToValueAtTime(sus, t + a + d);
    p.setValueAtTime(sus, t + a + d + h);
    p.exponentialRampToValueAtTime(EPS, t + a + d + h + r);
    return t + a + d + h + r;
  }
  p.exponentialRampToValueAtTime(EPS, t + a + d);
  return t + a + d;
}

/** Total length of an envelope, without needing to schedule it. */
export function envLength(e: Env): number {
  const a = Math.max(0.0005, e.attack ?? 0.004);
  const d = Math.max(0.001, e.decay ?? 0.09);
  const s = clamp(e.sustain ?? 0, 0, 1);
  if (s <= 0.001) return a + d;
  return a + d + Math.max(0, e.hold ?? 0) + Math.max(0.004, e.release ?? 0.06);
}

function connectOut(r: Rack, node: AudioNode, o: VoiceOpts): void {
  let n = node;
  if (o.pan) {
    const p = r.ctx.createStereoPanner();
    p.pan.value = clamp(o.pan, -1, 1);
    n.connect(p);
    n = p;
  }
  n.connect(o.dest ?? r.sfx);
  if (o.reverb) {
    const g = r.ctx.createGain();
    g.gain.value = o.reverb;
    n.connect(g);
    g.connect(r.reverbSend);
  }
  if (o.delay) {
    const g = r.ctx.createGain();
    g.gain.value = o.delay;
    n.connect(g);
    g.connect(r.delaySend);
  }
}

// ── tone ────────────────────────────────────────────────────────────────────

export interface FilterOpts {
  type?: BiquadFilterType;
  freq: number;
  q?: number;
  /** Sweep the cutoff here over `sweepTime` seconds. */
  sweepTo?: number;
  sweepTime?: number;
  gain?: number;
}

export interface ToneOpts extends VoiceOpts {
  freq: number;
  type?: OscillatorType;
  detune?: number;
  filter?: FilterOpts;
  /** Start at `freq * slideFrom` and glide to `freq`. */
  slideFrom?: number;
  slideTime?: number;
  /** Glide onward to `freq * slideTo` after the initial slide. */
  slideTo?: number;
  slideToTime?: number;
  vibrato?: { rate: number; cents: number; delay?: number };
}

/** One oscillator voice with an optional filter, slide and vibrato. */
export function tone(r: Rack, t: number, o: ToneOpts): number {
  const ctx = r.ctx;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  if (o.detune) osc.detune.value = o.detune;

  const f = Math.max(1, o.freq);
  if (o.slideFrom && o.slideFrom !== 1) {
    osc.frequency.setValueAtTime(Math.max(1, f * o.slideFrom), t);
    osc.frequency.exponentialRampToValueAtTime(f, t + (o.slideTime ?? 0.08));
  } else {
    osc.frequency.setValueAtTime(f, t);
  }
  if (o.slideTo && o.slideTo !== 1) {
    const from = t + (o.slideFrom ? (o.slideTime ?? 0.08) : 0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f * o.slideTo), from + (o.slideToTime ?? 0.2));
  }

  let node: AudioNode = osc;
  if (o.filter) {
    const bq = ctx.createBiquadFilter();
    bq.type = o.filter.type ?? 'lowpass';
    bq.frequency.setValueAtTime(clamp(o.filter.freq, 20, 20000), t);
    if (o.filter.q !== undefined) bq.Q.value = o.filter.q;
    if (o.filter.gain !== undefined) bq.gain.value = o.filter.gain;
    if (o.filter.sweepTo) {
      bq.frequency.exponentialRampToValueAtTime(
        clamp(o.filter.sweepTo, 20, 20000), t + (o.filter.sweepTime ?? 0.2),
      );
    }
    node.connect(bq);
    node = bq;
  }

  const g = ctx.createGain();
  node.connect(g);
  const end = applyEnv(g.gain, t, o.gain ?? 0.3, o);
  connectOut(r, g, o);

  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibrato.rate;
    const amt = ctx.createGain();
    amt.gain.setValueAtTime(EPS, t);
    amt.gain.exponentialRampToValueAtTime(Math.max(EPS, o.vibrato.cents), t + (o.vibrato.delay ?? 0.12));
    lfo.connect(amt);
    amt.connect(osc.detune);
    lfo.start(t);
    lfo.stop(end + 0.02);
  }

  osc.start(t);
  osc.stop(end + 0.03);
  return end;
}

// ── noise ───────────────────────────────────────────────────────────────────

export interface NoiseOpts extends VoiceOpts {
  duration?: number;
  filterType?: BiquadFilterType;
  filterFreq?: number;
  q?: number;
  /** Sweep the filter cutoff to here across `duration`. */
  sweepTo?: number;
  /** Second filter stage, useful for band-limiting a hiss. */
  filter2?: FilterOpts;
  /** Amplitude modulation, for rattles, purrs and grinds. */
  am?: { rate: number; depth: number };
  /** Resample the noise buffer; changes its spectral tilt subtly. */
  rate?: number;
}

/** Filtered noise burst — the backbone of every impact, step and whoosh. */
export function noise(r: Rack, t: number, o: NoiseOpts = {}): number {
  const ctx = r.ctx;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.playbackRate.value = o.rate ?? 1;
  // Start at a random offset so repeated bursts are not the same noise.
  const off = Math.random() * 1.5;

  let node: AudioNode = src;
  if (o.filterFreq) {
    const bq = ctx.createBiquadFilter();
    bq.type = o.filterType ?? 'bandpass';
    bq.frequency.setValueAtTime(clamp(o.filterFreq, 20, 20000), t);
    bq.Q.value = o.q ?? 1;
    if (o.sweepTo) {
      bq.frequency.exponentialRampToValueAtTime(
        clamp(o.sweepTo, 20, 20000), t + (o.duration ?? envLength(o)),
      );
    }
    node.connect(bq);
    node = bq;
  }
  if (o.filter2) {
    const bq = ctx.createBiquadFilter();
    bq.type = o.filter2.type ?? 'highpass';
    bq.frequency.setValueAtTime(clamp(o.filter2.freq, 20, 20000), t);
    if (o.filter2.q !== undefined) bq.Q.value = o.filter2.q;
    if (o.filter2.sweepTo) {
      bq.frequency.exponentialRampToValueAtTime(
        clamp(o.filter2.sweepTo, 20, 20000), t + (o.filter2.sweepTime ?? o.duration ?? 0.2),
      );
    }
    node.connect(bq);
    node = bq;
  }

  const g = ctx.createGain();
  node.connect(g);
  const env: Env = o.duration !== undefined && o.sustain === undefined
    ? { attack: o.attack ?? 0.002, decay: o.duration, sustain: 0 }
    : o;
  const end = applyEnv(g.gain, t, o.gain ?? 0.3, env);
  connectOut(r, g, o);

  if (o.am) {
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = o.am.rate;
    const amt = ctx.createGain();
    amt.gain.value = o.am.depth;
    const trim = ctx.createGain();
    trim.gain.value = 1 - o.am.depth;
    // g already carries the envelope; modulate a second stage after it.
    lfo.connect(amt);
    amt.connect(g.gain);
    lfo.start(t);
    lfo.stop(end + 0.02);
  }

  src.start(t, off);
  src.stop(end + 0.03);
  return end;
}

// ── pluck (Karplus-Strong) ──────────────────────────────────────────────────

const ksCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/**
 * Karplus-Strong string, rendered into an AudioBuffer.
 *
 * The obvious Web Audio implementation — a DelayNode in a feedback loop — is
 * unusable here because a cycle through a DelayNode is forced to at least one
 * render quantum (128 samples), capping the pitch at ~344 Hz. Generating the
 * string in JS is both more accurate and cheaper, and it works identically in an
 * OfflineAudioContext.
 */
function ksBuffer(ctx: BaseAudioContext, freq: number, bright: number, dur: number): AudioBuffer {
  let map = ksCache.get(ctx);
  if (!map) { map = new Map(); ksCache.set(ctx, map); }
  const key = `${freq.toFixed(1)}|${bright.toFixed(2)}|${dur.toFixed(2)}`;
  const hit = map.get(key);
  if (hit) return hit;

  const sr = ctx.sampleRate;
  const N = Math.max(2, Math.round(sr / Math.max(20, freq)));
  const len = Math.max(N + 16, Math.floor(sr * dur));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);

  // Excitation: lowpassed noise, so the pick is warm rather than fizzy.
  let z = 0;
  for (let i = 0; i < N; i++) {
    z += 0.5 * ((Math.random() * 2 - 1) - z);
    d[i] = z;
  }
  // Pick-position comb — plucking a quarter of the way along the string kills
  // the 4th harmonic and is most of what makes a guitar sound like a guitar.
  const pick = Math.max(1, Math.floor(N / 4));
  for (let i = N - 1; i >= pick; i--) d[i] -= 0.62 * d[i - pick];
  let mx = 0;
  for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(d[i]));
  if (mx > 0) for (let i = 0; i < N; i++) d[i] /= mx;

  // Loop gain chosen so the string decays to -60dB in `dur` seconds.
  const passes = Math.max(1, (dur * sr) / N);
  const g = Math.pow(0.001, 1 / passes);
  let lp = 0;
  for (let i = N; i < len; i++) {
    const x = 0.5 * (d[i - N] + d[i - N + 1]);
    lp += bright * (x - lp);
    d[i] = lp * g;
  }
  // Fade the last 40ms so looping the buffer source can never click.
  const fade = Math.min(len, Math.floor(sr * 0.04));
  for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;

  map.set(key, buf);
  return buf;
}

export interface PluckOpts extends VoiceOpts {
  /** 0..1, how much high end survives each pass round the string. */
  bright?: number;
  /** Seconds the open string would ring for. */
  ring?: number;
  /** Note length; the string is damped after this. */
  dur?: number;
  /** Body resonance emphasis, 0 turns the guitar body off. */
  body?: number;
  lowpass?: number;
}

/** Plucked string — the voice of the Lumen Vale town theme. */
export function pluck(r: Rack, t: number, freq: number, o: PluckOpts = {}): number {
  const ctx = r.ctx;
  const ring = o.ring ?? 1.9;
  const bright = clamp(o.bright ?? 0.62, 0.05, 0.95);
  const src = ctx.createBufferSource();
  src.buffer = ksBuffer(ctx, freq, bright, ring);

  let node: AudioNode = src;
  if (o.body !== 0) {
    // Two peaking filters standing in for the air resonance and top plate of a
    // small-bodied acoustic guitar.
    const b1 = ctx.createBiquadFilter();
    b1.type = 'peaking';
    b1.frequency.value = 108;
    b1.Q.value = 1.1;
    b1.gain.value = 5 * (o.body ?? 1);
    const b2 = ctx.createBiquadFilter();
    b2.type = 'peaking';
    b2.frequency.value = 232;
    b2.Q.value = 1.6;
    b2.gain.value = 3 * (o.body ?? 1);
    node.connect(b1);
    b1.connect(b2);
    node = b2;
  }
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.lowpass ?? 5200;
  node.connect(lp);
  node = lp;

  const g = ctx.createGain();
  node.connect(g);
  connectOut(r, g, o);

  const peak = o.gain ?? 0.3;
  const dur = o.dur ?? ring;
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, EPS * 2), t + 0.003);
  const end = t + Math.min(ring, dur + 0.18);
  // Damping the string is a fast but not instant release — a real hand.
  g.gain.setValueAtTime(Math.max(peak, EPS * 2), Math.max(t + 0.004, t + dur - 0.02));
  g.gain.exponentialRampToValueAtTime(EPS, end);

  src.start(t);
  src.stop(end + 0.03);
  return end;
}

// ── bell ────────────────────────────────────────────────────────────────────

/**
 * Partial structure of a tuned "minor third" church bell, as measured by
 * campanologists: hum an octave below the note, then prime, tierce (a minor
 * third above), quint, nominal (an octave above), and a thinning tail of
 * inharmonic upper partials.
 *
 * Each entry is [frequency ratio, amplitude, decay multiplier]. Low partials
 * ring far longer than high ones, which is the single most important detail —
 * get it wrong and a bell sounds like an organ.
 */
export const BELL_PARTIALS: Array<[number, number, number]> = [
  [0.5,  0.58, 1.70],  // hum
  [1.0,  1.00, 1.30],  // prime
  [1.2,  0.74, 1.00],  // tierce
  [1.5,  0.52, 0.82],  // quint
  [2.0,  0.70, 0.66],  // nominal
  [2.5,  0.28, 0.44],  // deciem
  [3.35, 0.19, 0.30],  // undeciem
  [4.2,  0.13, 0.21],
  [5.43, 0.09, 0.15],
];

export interface BellOpts extends VoiceOpts {
  /** Decay of the prime partial in seconds. */
  ring?: number;
  partials?: Array<[number, number, number]>;
  /** 0..1 clapper transient. */
  strike?: number;
  /** Cents of detune between the doubled low partials — the bell's warble. */
  beat?: number;
  /** Scales the amplitude of partials above the nominal. */
  bright?: number;
  /** Number of low partials that get a detuned twin (0 disables the warble). */
  doubled?: number;
}

/**
 * Additive bell.
 *
 * The town bell is the game's signature motif, so this is the one generator
 * that gets the full treatment: correct inharmonic ratios, per-partial decay
 * times, a slow beat between doubled low partials, a tiny downward pitch drift
 * as the metal settles, and a filtered clapper transient.
 */
export function bell(r: Rack, t: number, freq: number, o: BellOpts = {}): number {
  const ctx = r.ctx;
  const ring = o.ring ?? 2.6;
  const table = o.partials ?? BELL_PARTIALS;
  const bright = o.bright ?? 1;
  const doubled = o.doubled ?? 4;
  const beat = o.beat ?? 1.1;

  const bus = ctx.createGain();
  bus.gain.value = o.gain ?? 0.3;
  connectOut(r, bus, o);

  let end = t + 0.1;
  for (let i = 0; i < table.length; i++) {
    const [ratio, amp, dscale] = table[i];
    const f = freq * ratio;
    if (f > 17000) continue;
    const a = amp * (ratio > 2 ? bright : 1);
    const dec = ring * dscale;
    const voices = i < doubled ? 2 : 1;
    for (let v = 0; v < voices; v++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      // Real bells sag very slightly as the strike energy dissipates.
      osc.frequency.linearRampToValueAtTime(f * 0.9985, t + dec);
      osc.detune.value = voices === 2 ? (v ? beat : -beat) : 0;
      const g = ctx.createGain();
      const peak = (a / voices) * 0.5;
      g.gain.setValueAtTime(EPS, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, EPS * 2), t + 0.004 + i * 0.001);
      g.gain.exponentialRampToValueAtTime(EPS, t + dec);
      osc.connect(g);
      g.connect(bus);
      osc.start(t);
      osc.stop(t + dec + 0.02);
      if (t + dec > end) end = t + dec;
    }
  }

  const strike = o.strike ?? 0.5;
  if (strike > 0) {
    noise(r, t, {
      duration: 0.055,
      filterType: 'bandpass',
      filterFreq: clamp(freq * 6, 200, 9000),
      q: 0.9,
      sweepTo: clamp(freq * 3, 120, 6000),
      gain: strike * 0.28,
      attack: 0.0008,
      dest: bus,
    });
  }
  return end;
}

// ── FM helper ───────────────────────────────────────────────────────────────

export interface FmOpts extends VoiceOpts {
  freq: number;
  /** Modulator frequency as a multiple of the carrier. */
  ratio?: number;
  /** Modulation index in Hz of deviation. */
  index?: number;
  /** Index falls to this fraction over the note — FM's "brightness decay". */
  indexDecay?: number;
  type?: OscillatorType;
  modType?: OscillatorType;
}

/** Two-operator FM. Used for metallic and vocal-ish timbres. */
export function fm(r: Rack, t: number, o: FmOpts): number {
  const ctx = r.ctx;
  const car = ctx.createOscillator();
  car.type = o.type ?? 'sine';
  car.frequency.setValueAtTime(Math.max(1, o.freq), t);

  const mod = ctx.createOscillator();
  mod.type = o.modType ?? 'sine';
  mod.frequency.setValueAtTime(Math.max(1, o.freq * (o.ratio ?? 2)), t);
  const idx = ctx.createGain();
  const i0 = Math.max(1, o.index ?? o.freq);
  idx.gain.setValueAtTime(i0, t);
  const len = envLength(o);
  idx.gain.exponentialRampToValueAtTime(Math.max(1, i0 * (o.indexDecay ?? 0.08)), t + len);
  mod.connect(idx);
  idx.connect(car.frequency);

  const g = ctx.createGain();
  car.connect(g);
  const end = applyEnv(g.gain, t, o.gain ?? 0.25, o);
  connectOut(r, g, o);

  car.start(t); car.stop(end + 0.03);
  mod.start(t); mod.stop(end + 0.03);
  return end;
}

// ── formant voice (the cat) ─────────────────────────────────────────────────

export interface FormantOpts extends VoiceOpts {
  freq: number;
  /** [centre Hz, Q, gain] per formant. */
  formants: Array<[number, number, number]>;
  type?: OscillatorType;
  /** Pitch contour as [time fraction, frequency multiplier] pairs. */
  contour?: Array<[number, number]>;
  vibrato?: { rate: number; cents: number };
  /** Breath noise mixed under the glottal source. */
  breath?: number;
}

/**
 * A buzzy glottal source through parallel bandpass formants. This is how you
 * get a synthesised sound to read as a *voice* rather than a beep, and it is
 * what makes Pip's meow land as an animal rather than a siren.
 */
export function formant(r: Rack, t: number, o: FormantOpts): number {
  const ctx = r.ctx;
  const len = envLength(o);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sawtooth';
  const f0 = Math.max(20, o.freq);
  const contour = o.contour ?? [[0, 1], [1, 1]];
  osc.frequency.setValueAtTime(Math.max(20, f0 * contour[0][1]), t);
  for (let i = 1; i < contour.length; i++) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, f0 * contour[i][1]), t + len * clamp(contour[i][0], 0, 1),
    );
  }

  const mix = ctx.createGain();
  mix.gain.value = 1;
  for (const [cf, q, amp] of o.formants) {
    const bq = ctx.createBiquadFilter();
    bq.type = 'bandpass';
    bq.frequency.value = clamp(cf, 20, 18000);
    bq.Q.value = q;
    const gg = ctx.createGain();
    gg.gain.value = amp;
    osc.connect(bq);
    bq.connect(gg);
    gg.connect(mix);
  }

  if (o.breath) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 2600;
    hp.Q.value = 0.7;
    const bg = ctx.createGain();
    bg.gain.value = o.breath;
    src.connect(hp); hp.connect(bg); bg.connect(mix);
    src.start(t, Math.random());
    src.stop(t + len + 0.05);
  }

  const g = ctx.createGain();
  mix.connect(g);
  const end = applyEnv(g.gain, t, o.gain ?? 0.25, o);
  connectOut(r, g, o);

  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibrato.rate;
    const amt = ctx.createGain();
    amt.gain.value = o.vibrato.cents;
    lfo.connect(amt);
    amt.connect(osc.detune);
    lfo.start(t); lfo.stop(end + 0.02);
  }

  osc.start(t);
  osc.stop(end + 0.03);
  return end;
}

// ── lookahead scheduler ─────────────────────────────────────────────────────

/**
 * Music is scheduled ahead of time into the audio clock rather than fired from
 * a frame callback — a 60Hz game loop that occasionally drops to 40 would make
 * every note audibly late. A 25ms timer looking 100ms ahead is the standard
 * arrangement and is inaudibly stable.
 */
export const LOOKAHEAD = 0.1;
export const TICK_MS = 25;

type Ticker = (now: number, horizon: number) => void;

const tickers = new Set<Ticker>();
let clockRack: Rack | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function setClockRack(r: Rack | null): void {
  clockRack = r;
}

function tick(): void {
  if (!clockRack) return;
  const now = clockRack.ctx.currentTime;
  for (const fn of [...tickers]) {
    try { fn(now, now + LOOKAHEAD); } catch (e) { console.error('audio ticker threw', e); }
  }
}

export function addTicker(fn: Ticker): () => void {
  tickers.add(fn);
  if (!timer) timer = setInterval(tick, TICK_MS);
  return () => {
    tickers.delete(fn);
    if (!tickers.size && timer) { clearInterval(timer); timer = null; }
  };
}

/** Drive the schedulers manually — used when rendering offline. */
export function pump(now: number, horizon: number): void {
  for (const fn of [...tickers]) fn(now, horizon);
}

// ── parameter helpers ───────────────────────────────────────────────────────

/** Ramp a param smoothly, cancelling anything already scheduled on it. */
export function ramp(p: AudioParam, to: number, at: number, seconds: number): void {
  const v = Math.max(EPS, p.value);
  p.cancelScheduledValues(at);
  p.setValueAtTime(v, at);
  if (to <= EPS) p.linearRampToValueAtTime(0, at + seconds);
  else p.exponentialRampToValueAtTime(to, at + seconds);
}
