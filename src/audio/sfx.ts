/**
 * SOUND EFFECT LIBRARY
 * ────────────────────
 * Each effect is a function of (rack, time, volume, rate, pan). Nothing is
 * pre-rendered, so every trigger can vary slightly — repeated sounds are the
 * fastest way to make a game feel cheap, and a few percent of pitch and timbre
 * drift is most of the cure.
 *
 * Two families deliberately opt out of that variation:
 *
 *  - the bells, because the conditioning quest is built on the player
 *    recognising one motif inside another, and
 *  - the lantern tones, because the Lantern Trial asks the player to match a
 *    reference tone to one of three lanterns. If `lantern_tone_ref` were not
 *    bit-identical to the lantern it names, the puzzle would be unfair.
 *
 * Those are gameplay data that happen to be audible, not decoration.
 */
import {
  type Rack, bell, fm, formant, mtof, noise, pluck, rand, tone, vary, clamp,
} from './synth';

export interface SfxCtx {
  r: Rack;
  t: number;
  /** Multiplies every gain in the effect. */
  vol: number;
  /** Multiplies every frequency in the effect. */
  rate: number;
  pan: number;
}

export type SfxFn = (c: SfxCtx) => void;

// ── the bells ───────────────────────────────────────────────────────────────

/**
 * THE MOTIF.
 *
 * Semitone offsets from the bell's root: 5 – 3 – 2 – 1 of the major scale, a
 * descending change-ringing figure of the sort every English tower rings on the
 * quarter hour. It is short enough to hum after one hearing, which is the whole
 * requirement — Pip learned it, and so must the player.
 *
 * The hand bell plays this same array two octaves up. Because it is data rather
 * than a recording, the kinship is exact and not a matter of taste.
 */
export const BELL_MOTIF: number[] = [7, 4, 2, 0];

/** G2 — deep enough to feel in the chest, high enough to carry across a valley. */
export const BELL_TOWN_ROOT = 43;
/** G4. The same note two octaves up: a hand bell, quoting a tower. */
export const BELL_SMALL_ROOT = 67;

const bellTown: SfxFn = (c) => {
  const root = mtof(BELL_TOWN_ROOT) * c.rate * vary(0.002);
  const gap = 0.66;
  BELL_MOTIF.forEach((semi, i) => {
    bell(c.r, c.t + i * gap, root * Math.pow(2, semi / 12), {
      ring: 2.55,
      gain: c.vol * (i === 0 ? 0.30 : 0.26) * vary(0.03),
      strike: 0.55,
      beat: 1.2,
      bright: 0.85,
      doubled: 4,
      pan: c.pan * 0.3,
      reverb: 0.34,
    });
  });
};

const bellSmall: SfxFn = (c) => {
  const root = mtof(BELL_SMALL_ROOT) * c.rate * vary(0.002);
  const gap = 0.34;
  BELL_MOTIF.forEach((semi, i) => {
    bell(c.r, c.t + i * gap, root * Math.pow(2, semi / 12), {
      // A hand bell is the same shape, small: identical partial ratios, a third
      // of the ring, and no lazy low warble.
      ring: 0.9,
      gain: c.vol * (i === 0 ? 0.26 : 0.22) * vary(0.03),
      strike: 0.7,
      beat: 2.4,
      bright: 1.05,
      doubled: 2,
      pan: c.pan * 0.3,
      reverb: 0.2,
    });
  });
};

// ── the storm's pipes ───────────────────────────────────────────────────────

/**
 * The unconditioned stimulus. Everything about this is chosen to be the
 * opposite of a bell: inharmonic ratios that never resolve, a spectrum weighted
 * to the 2-5kHz band the ear finds hardest to ignore, and an attack with no
 * ramp at all.
 */
const PIPE_PARTIALS = [1, 1.41, 2.37, 3.14, 4.73, 5.61, 7.19, 9.02, 11.4];

const pipeCrash: SfxFn = (c) => {
  const { r, t } = c;
  const base = 168 * c.rate * vary(0.05);
  // Body of the impact.
  tone(r, t, {
    freq: 62 * c.rate, type: 'sine', slideFrom: 1.7, slideTime: 0.05,
    attack: 0.001, decay: 0.34, gain: c.vol * 0.3, pan: c.pan * 0.2,
  });
  // The clang itself.
  PIPE_PARTIALS.forEach((ratio, i) => {
    const f = base * ratio * vary(0.02);
    if (f > 16000) return;
    tone(r, t + i * 0.0015, {
      freq: f, type: i < 3 ? 'triangle' : 'sine',
      attack: 0.0008, decay: 1.5 * Math.pow(0.72, i) + 0.12,
      gain: c.vol * 0.13 * Math.pow(0.82, i), pan: c.pan * 0.4,
      reverb: 0.18,
    });
  });
  // Sheet-metal shear.
  noise(r, t, {
    duration: 0.5, filterType: 'bandpass', filterFreq: 3100 * c.rate, q: 0.55,
    sweepTo: 900 * c.rate, gain: c.vol * 0.26, attack: 0.0005, pan: c.pan * 0.3,
    reverb: 0.2,
  });
  noise(r, t, {
    duration: 0.09, filterType: 'highpass', filterFreq: 4800 * c.rate,
    gain: c.vol * 0.2, attack: 0.0004,
  });
  // A late, uglier second rattle — pipes do not ring once.
  noise(r, t + 0.11, {
    duration: 0.3, filterType: 'bandpass', filterFreq: 2200 * c.rate, q: 3.5,
    gain: c.vol * 0.1, attack: 0.002, am: { rate: 41, depth: 0.05 },
  });
};

// ── Pip ─────────────────────────────────────────────────────────────────────

const catMeow: SfxFn = (c) => {
  const { r, t } = c;
  const f0 = 470 * c.rate * vary(0.09);
  formant(r, t, {
    freq: f0,
    type: 'sawtooth',
    contour: [[0, 0.70], [0.18, 1.14], [0.55, 1.02], [1, 0.74]],
    formants: [[860 * c.rate, 7, 1], [1720 * c.rate, 9, 0.5], [2950 * c.rate, 11, 0.18]],
    breath: 0.04,
    attack: 0.055, decay: 0.1, sustain: 0.72, hold: rand(0.16, 0.26), release: 0.19,
    gain: c.vol * 0.26, pan: c.pan, vibrato: { rate: rand(5, 7), cents: 14 },
    reverb: 0.1,
  });
};

const catHiss: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    attack: 0.02, decay: 0.06, sustain: 0.85, hold: rand(0.2, 0.32), release: 0.16,
    filterType: 'bandpass', filterFreq: 3200 * c.rate * vary(0.08), q: 1.0,
    sweepTo: 5400 * c.rate, filter2: { type: 'highpass', freq: 1500 },
    gain: c.vol * 0.24, pan: c.pan, am: { rate: rand(24, 34), depth: 0.05 },
  });
  // The growl underneath is what makes it read as an animal and not a kettle.
  tone(r, t + 0.01, {
    freq: 96 * c.rate * vary(0.06), type: 'sawtooth',
    filter: { type: 'lowpass', freq: 420, q: 3 },
    attack: 0.03, decay: 0.08, sustain: 0.7, hold: 0.24, release: 0.14,
    gain: c.vol * 0.09, pan: c.pan,
  });
};

const catPurr: SfxFn = (c) => {
  const { r, t } = c;
  const rate = rand(24, 28);
  tone(r, t, {
    freq: 47 * c.rate, type: 'sawtooth',
    filter: { type: 'lowpass', freq: 300, q: 2 },
    attack: 0.12, decay: 0.1, sustain: 0.85, hold: 1.05, release: 0.3,
    gain: c.vol * 0.2, pan: c.pan,
  });
  noise(r, t, {
    attack: 0.12, decay: 0.1, sustain: 0.85, hold: 1.05, release: 0.3,
    filterType: 'lowpass', filterFreq: 620 * c.rate, q: 1.4,
    gain: c.vol * 0.12, pan: c.pan, am: { rate, depth: 0.08 },
  });
  // The purr's pulse train — roughly 25Hz, which is a real cat.
  tone(r, t, {
    freq: 118 * c.rate, type: 'triangle',
    attack: 0.1, decay: 0.1, sustain: 0.8, hold: 1.05, release: 0.28,
    gain: c.vol * 0.05, pan: c.pan,
    vibrato: { rate, cents: 90 },
  });
};

// ── the Lantern Trial ───────────────────────────────────────────────────────

/**
 * Three lanterns, three tones. They are stacked perfect fourths (E4 / A4 / D5)
 * so the set is pleasant when the festival crowd strikes them in any order, and
 * a third apart in *timbre* as well as pitch so a player who cannot name
 * intervals can still tell them apart: warm and glassy, hollow and reedy,
 * bright and metallic.
 *
 * Deterministic on purpose — see the module header.
 */
interface LanternSpec {
  freq: number;
  partials: Array<[number, number]>;
  type: OscillatorType;
  attack: number;
  decay: number;
  lowpass: number;
}

export const LANTERN: Record<'a' | 'b' | 'c', LanternSpec> = {
  // E4, warm: fundamental plus a soft octave. Glass.
  a: { freq: 329.63, partials: [[1, 1], [2, 0.22], [3, 0.06]], type: 'sine', attack: 0.02, decay: 1.25, lowpass: 3200 },
  // A4, hollow: odd harmonics only. Reed.
  b: { freq: 440.00, partials: [[1, 1], [3, 0.3], [5, 0.12]], type: 'triangle', attack: 0.008, decay: 0.95, lowpass: 5000 },
  // D5, bright: inharmonic upper partials. Struck metal.
  c: { freq: 587.33, partials: [[1, 1], [2, 0.14], [2.76, 0.22], [5.4, 0.09]], type: 'sine', attack: 0.002, decay: 0.8, lowpass: 9000 },
};

let lanternRef: 'a' | 'b' | 'c' = 'a';

/** Choose which lantern `lantern_tone_ref` answers to for this round. */
export function setLanternRef(which: 'a' | 'b' | 'c'): void {
  lanternRef = which;
}

export function getLanternRef(): 'a' | 'b' | 'c' {
  return lanternRef;
}

function lantern(c: SfxCtx, which: 'a' | 'b' | 'c'): void {
  const spec = LANTERN[which];
  for (const [ratio, amp] of spec.partials) {
    const f = spec.freq * ratio * c.rate;
    if (f > 17000) continue;
    tone(c.r, c.t, {
      freq: f,
      type: ratio === 1 ? spec.type : 'sine',
      attack: spec.attack,
      decay: spec.decay * Math.pow(0.78, ratio - 1),
      gain: c.vol * 0.3 * amp,
      pan: c.pan,
      filter: ratio === 1 ? { type: 'lowpass', freq: spec.lowpass, q: 0.7 } : undefined,
      reverb: 0.22,
    });
  }
}

// ── player and combat ───────────────────────────────────────────────────────

const step = (band: number, q: number, dur: number, gain: number, hp?: number): SfxFn => (c) => {
  noise(c.r, c.t, {
    duration: dur * vary(0.18),
    filterType: 'bandpass',
    filterFreq: band * c.rate * vary(0.14),
    q,
    filter2: hp ? { type: 'highpass', freq: hp } : undefined,
    gain: c.vol * gain * vary(0.2),
    attack: 0.001,
    pan: c.pan,
  });
};

const stepGrass = step(1500, 0.9, 0.055, 0.15, 500);
const stepStone = step(2600, 1.6, 0.035, 0.16, 900);

const stepWood: SfxFn = (c) => {
  noise(c.r, c.t, {
    duration: 0.05 * vary(0.2), filterType: 'bandpass',
    filterFreq: 460 * c.rate * vary(0.1), q: 5.5,
    gain: c.vol * 0.18 * vary(0.2), attack: 0.001, pan: c.pan,
  });
  tone(c.r, c.t, {
    freq: 178 * c.rate * vary(0.08), type: 'sine',
    attack: 0.001, decay: 0.06, gain: c.vol * 0.1, pan: c.pan,
  });
};

const stepWater: SfxFn = (c) => {
  noise(c.r, c.t, {
    duration: 0.11 * vary(0.2), filterType: 'lowpass',
    filterFreq: 2400 * c.rate * vary(0.15), q: 0.9, sweepTo: 500,
    gain: c.vol * 0.16 * vary(0.2), attack: 0.002, pan: c.pan,
  });
  tone(c.r, c.t + 0.012, {
    freq: 880 * c.rate * vary(0.2), type: 'sine', slideFrom: 1.5, slideTime: 0.05,
    attack: 0.002, decay: 0.07, gain: c.vol * 0.07, pan: c.pan,
  });
};

const sword: SfxFn = (c) => {
  const { r, t } = c;
  // Air first, then a faint edge ring — a swing, not a lightsaber.
  noise(r, t, {
    duration: 0.15 * vary(0.1), filterType: 'bandpass',
    filterFreq: 900 * c.rate, q: 0.75, sweepTo: 4200 * c.rate * vary(0.1),
    gain: c.vol * 0.3 * vary(0.1), attack: 0.008, pan: c.pan,
  });
  noise(r, t + 0.02, {
    duration: 0.1, filterType: 'highpass', filterFreq: 3400 * c.rate,
    gain: c.vol * 0.09, attack: 0.004, pan: c.pan,
  });
  tone(r, t + 0.03, {
    freq: 2350 * c.rate * vary(0.06), type: 'sine',
    attack: 0.003, decay: 0.14, gain: c.vol * 0.05, pan: c.pan,
  });
};

const hit: SfxFn = (c) => {
  const { r, t } = c;
  tone(r, t, {
    freq: 138 * c.rate * vary(0.1), type: 'sine', slideFrom: 2.1, slideTime: 0.045,
    attack: 0.001, decay: 0.13, gain: c.vol * 0.32, pan: c.pan,
  });
  noise(r, t, {
    duration: 0.09 * vary(0.15), filterType: 'bandpass',
    filterFreq: 1900 * c.rate * vary(0.12), q: 0.8, sweepTo: 700,
    gain: c.vol * 0.22, attack: 0.0008, pan: c.pan,
  });
};

const crit: SfxFn = (c) => {
  const { r, t } = c;
  hit({ ...c, vol: c.vol * 0.9 });
  // The extra is metal, and a semitone of upward bend so it reads as *better*.
  [1, 1.68, 2.51].forEach((ratio, i) => {
    tone(r, t + 0.008, {
      freq: 620 * ratio * c.rate * vary(0.03), type: 'sine', slideFrom: 0.94, slideTime: 0.06,
      attack: 0.001, decay: 0.42 * Math.pow(0.7, i),
      gain: c.vol * 0.13 * Math.pow(0.72, i), pan: c.pan, reverb: 0.12,
    });
  });
  noise(r, t, {
    duration: 0.06, filterType: 'highpass', filterFreq: 5200 * c.rate,
    gain: c.vol * 0.14, attack: 0.0005,
  });
};

const enemyDie: SfxFn = (c) => {
  const { r, t } = c;
  tone(r, t, {
    freq: 90 * c.rate, type: 'triangle', slideFrom: 3.6, slideTime: 0.3,
    attack: 0.004, decay: 0.34, gain: c.vol * 0.24, pan: c.pan,
  });
  noise(r, t, {
    duration: 0.42, filterType: 'bandpass', filterFreq: 2600 * c.rate, q: 0.7,
    sweepTo: 340, gain: c.vol * 0.2, attack: 0.003, pan: c.pan,
  });
  // A little puff of nothing on the way out.
  noise(r, t + 0.16, {
    duration: 0.24, filterType: 'lowpass', filterFreq: 900, q: 0.6,
    gain: c.vol * 0.08, attack: 0.05, pan: c.pan, reverb: 0.15,
  });
};

const hurt: SfxFn = (c) => {
  const { r, t } = c;
  // A minor second, detuned. Unpleasant by construction.
  [1, 1.06].forEach((ratio, i) => {
    tone(r, t, {
      freq: 330 * ratio * c.rate * vary(0.04), type: 'sawtooth',
      slideFrom: 1.25, slideTime: 0.05, slideTo: 0.62, slideToTime: 0.2,
      filter: { type: 'lowpass', freq: 2200, q: 1.2, sweepTo: 700, sweepTime: 0.24 },
      attack: 0.002, decay: 0.26, gain: c.vol * 0.16 * (i ? 0.8 : 1), pan: c.pan,
    });
  });
  noise(r, t, {
    duration: 0.07, filterType: 'bandpass', filterFreq: 1400 * c.rate, q: 0.8,
    gain: c.vol * 0.16, attack: 0.0008,
  });
};

const dash: SfxFn = (c) => {
  noise(c.r, c.t, {
    attack: 0.03, decay: 0.05, sustain: 0.6, hold: 0.04, release: 0.12,
    filterType: 'bandpass', filterFreq: 420 * c.rate, q: 0.7,
    sweepTo: 1700 * c.rate * vary(0.1),
    gain: c.vol * 0.17 * vary(0.1), pan: c.pan,
  });
};

const block: SfxFn = (c) => {
  const { r, t } = c;
  [1, 2.14, 3.41, 5.02].forEach((ratio, i) => {
    tone(r, t, {
      freq: 430 * ratio * c.rate * vary(0.03), type: 'sine',
      attack: 0.0008, decay: 0.3 * Math.pow(0.66, i),
      gain: c.vol * 0.16 * Math.pow(0.7, i), pan: c.pan,
    });
  });
  noise(r, t, {
    duration: 0.05, filterType: 'highpass', filterFreq: 3600 * c.rate,
    gain: c.vol * 0.17, attack: 0.0005, pan: c.pan,
  });
};

const charge: SfxFn = (c) => {
  const { r, t } = c;
  tone(r, t, {
    freq: 560 * c.rate * vary(0.04), type: 'sawtooth', slideFrom: 0.26, slideTime: 0.46,
    filter: { type: 'lowpass', freq: 400, q: 4, sweepTo: 2600, sweepTime: 0.46 },
    attack: 0.06, decay: 0.06, sustain: 0.8, hold: 0.28, release: 0.09,
    gain: c.vol * 0.15, pan: c.pan,
    vibrato: { rate: 11, cents: 25, delay: 0.25 },
  });
  noise(r, t, {
    attack: 0.14, decay: 0.05, sustain: 0.7, hold: 0.2, release: 0.1,
    filterType: 'bandpass', filterFreq: 700, q: 2, sweepTo: 3000,
    gain: c.vol * 0.07, pan: c.pan,
  });
};

const shoot: SfxFn = (c) => {
  const { r, t } = c;
  tone(r, t, {
    freq: 380 * c.rate * vary(0.06), type: 'square', slideFrom: 2.4, slideTime: 0.09,
    filter: { type: 'bandpass', freq: 1600, q: 1.4, sweepTo: 700, sweepTime: 0.1 },
    attack: 0.001, decay: 0.11, gain: c.vol * 0.16, pan: c.pan,
  });
  noise(r, t, {
    duration: 0.04, filterType: 'highpass', filterFreq: 2600 * c.rate,
    gain: c.vol * 0.11, attack: 0.0005, pan: c.pan,
  });
};

const aggro: SfxFn = (c) => {
  const { r, t } = c;
  // Root then tritone. Two notes and the player knows something noticed them.
  [[0, 1], [0.1, Math.SQRT2]].forEach(([dt, ratio]) => {
    tone(r, t + dt, {
      freq: 300 * ratio * c.rate * vary(0.03), type: 'triangle',
      filter: { type: 'lowpass', freq: 2000, q: 1 },
      attack: 0.004, decay: 0.16, gain: c.vol * 0.18, pan: c.pan,
    });
  });
  noise(r, t, {
    duration: 0.1, filterType: 'bandpass', filterFreq: 1800, q: 1.5,
    gain: c.vol * 0.06, attack: 0.004,
  });
};

const heart: SfxFn = (c) => {
  const { r, t } = c;
  [[0, 1], [0.09, 1.25], [0.18, 1.5]].forEach(([dt, ratio], i) => {
    tone(r, t + dt, {
      freq: 523.25 * ratio * c.rate, type: 'sine',
      attack: 0.004, decay: 0.42 - i * 0.05,
      gain: c.vol * 0.17, pan: c.pan, reverb: 0.2,
    });
    tone(r, t + dt, {
      freq: 523.25 * ratio * 2 * c.rate, type: 'sine',
      attack: 0.003, decay: 0.2, gain: c.vol * 0.05, pan: c.pan,
    });
  });
};

const land: SfxFn = (c) => {
  const { r, t } = c;
  tone(r, t, {
    freq: 58 * c.rate, type: 'sine', slideFrom: 1.9, slideTime: 0.05,
    attack: 0.001, decay: 0.16, gain: c.vol * 0.26, pan: c.pan,
  });
  noise(r, t, {
    duration: 0.13, filterType: 'lowpass', filterFreq: 1500 * c.rate, q: 0.8,
    sweepTo: 350, gain: c.vol * 0.15, attack: 0.001, pan: c.pan,
  });
};

// ── world ───────────────────────────────────────────────────────────────────

const door: SfxFn = (c) => {
  const { r, t } = c;
  // Creak: a narrow resonance dragged upward, then the latch.
  noise(r, t, {
    attack: 0.05, decay: 0.06, sustain: 0.7, hold: 0.16, release: 0.12,
    filterType: 'bandpass', filterFreq: 320 * c.rate * vary(0.1), q: 9,
    sweepTo: 620 * c.rate, gain: c.vol * 0.17, pan: c.pan,
    am: { rate: rand(15, 22), depth: 0.035 },
  });
  noise(r, t + 0.33, {
    duration: 0.06, filterType: 'bandpass', filterFreq: 900 * c.rate, q: 3,
    gain: c.vol * 0.16, attack: 0.001, pan: c.pan,
  });
  tone(r, t + 0.33, {
    freq: 150 * c.rate * vary(0.06), type: 'sine',
    attack: 0.001, decay: 0.1, gain: c.vol * 0.12, pan: c.pan,
  });
};

const doorStone: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    attack: 0.12, decay: 0.12, sustain: 0.75, hold: 0.55, release: 0.32,
    filterType: 'lowpass', filterFreq: 260 * c.rate, q: 2.2, sweepTo: 150,
    gain: c.vol * 0.3, pan: c.pan, am: { rate: rand(9, 14), depth: 0.06 },
    reverb: 0.3,
  });
  tone(r, t, {
    freq: 44 * c.rate, type: 'sine',
    attack: 0.12, decay: 0.1, sustain: 0.8, hold: 0.5, release: 0.4,
    gain: c.vol * 0.22, pan: c.pan,
  });
  noise(r, t + 1.05, {
    duration: 0.18, filterType: 'lowpass', filterFreq: 400, q: 1,
    gain: c.vol * 0.22, attack: 0.002, pan: c.pan, reverb: 0.35,
  });
};

const chest: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    duration: 0.12, filterType: 'bandpass', filterFreq: 520 * c.rate, q: 4,
    gain: c.vol * 0.2, attack: 0.002, pan: c.pan,
  });
  tone(r, t, {
    freq: 130 * c.rate, type: 'sine', attack: 0.002, decay: 0.14,
    gain: c.vol * 0.16, pan: c.pan,
  });
  // The reward figure — a rising major triad, warm.
  [0, 4, 7].forEach((semi, i) => {
    tone(r, t + 0.16 + i * 0.075, {
      freq: mtof(74 + semi) * c.rate, type: 'triangle',
      attack: 0.004, decay: 0.5 - i * 0.07,
      gain: c.vol * 0.13, pan: c.pan, reverb: 0.25,
    });
  });
};

const pressurePlate: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    duration: 0.03, filterType: 'highpass', filterFreq: 2800 * c.rate,
    gain: c.vol * 0.15, attack: 0.0005, pan: c.pan,
  });
  tone(r, t + 0.015, {
    freq: 118 * c.rate * vary(0.04), type: 'sine', slideFrom: 1.4, slideTime: 0.04,
    attack: 0.001, decay: 0.19, gain: c.vol * 0.26, pan: c.pan,
  });
  tone(r, t + 0.05, {
    freq: 660 * c.rate, type: 'sine', attack: 0.004, decay: 0.24,
    gain: c.vol * 0.08, pan: c.pan, reverb: 0.2,
  });
};

const gateOpen: SfxFn = (c) => {
  const { r, t } = c;
  // Chain, then the counterweight.
  for (let i = 0; i < 9; i++) {
    noise(r, t + i * 0.055 + rand(0, 0.02), {
      duration: 0.035, filterType: 'bandpass',
      filterFreq: rand(2600, 5200) * c.rate, q: rand(4, 9),
      gain: c.vol * rand(0.06, 0.13), attack: 0.0006, pan: c.pan * 0.6,
    });
  }
  noise(r, t + 0.05, {
    attack: 0.15, decay: 0.1, sustain: 0.7, hold: 0.45, release: 0.3,
    filterType: 'lowpass', filterFreq: 320 * c.rate, q: 1.8, sweepTo: 700,
    gain: c.vol * 0.2, pan: c.pan, reverb: 0.3, am: { rate: 8, depth: 0.04 },
  });
  tone(r, t + 0.85, {
    freq: 82 * c.rate, type: 'sine', attack: 0.004, decay: 0.4,
    gain: c.vol * 0.2, pan: c.pan,
  });
};

const switchSfx: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    duration: 0.02, filterType: 'bandpass', filterFreq: 3200 * c.rate * vary(0.1), q: 2,
    gain: c.vol * 0.22, attack: 0.0004, pan: c.pan,
  });
  noise(r, t + 0.055, {
    duration: 0.03, filterType: 'bandpass', filterFreq: 1900 * c.rate * vary(0.1), q: 2.5,
    gain: c.vol * 0.2, attack: 0.0004, pan: c.pan,
  });
  tone(r, t + 0.055, {
    freq: 300 * c.rate, type: 'sine', attack: 0.001, decay: 0.07,
    gain: c.vol * 0.12, pan: c.pan,
  });
};

const runeActivate: SfxFn = (c) => {
  const { r, t } = c;
  // Four voices rising into a stacked fifth — the shrine waking up politely.
  [0, 7, 12, 19].forEach((semi, i) => {
    tone(r, t + i * 0.045, {
      freq: mtof(69 + semi) * c.rate, type: 'sine',
      slideFrom: 0.945, slideTime: 0.3,
      attack: 0.05, decay: 0.1, sustain: 0.6, hold: 0.2, release: 0.5,
      gain: c.vol * 0.13 * Math.pow(0.86, i), pan: c.pan, reverb: 0.45,
    });
  });
  bell(r, t + 0.12, mtof(81) * c.rate, {
    ring: 1.4, gain: c.vol * 0.1, strike: 0.2, bright: 1.2, doubled: 2, reverb: 0.4,
  });
  noise(r, t, {
    attack: 0.12, decay: 0.08, sustain: 0.5, hold: 0.2, release: 0.35,
    filterType: 'bandpass', filterFreq: 2200 * c.rate, q: 1.2, sweepTo: 7000,
    gain: c.vol * 0.07, pan: c.pan, reverb: 0.3,
  });
};

const splash: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    duration: 0.4, filterType: 'lowpass', filterFreq: 4200 * c.rate, q: 0.8,
    sweepTo: 420, gain: c.vol * 0.26, attack: 0.002, pan: c.pan,
  });
  for (let i = 0; i < 4; i++) {
    tone(r, t + rand(0.01, 0.22), {
      freq: rand(700, 1800) * c.rate, type: 'sine',
      slideFrom: rand(1.3, 2.0), slideTime: 0.05,
      attack: 0.002, decay: rand(0.05, 0.11), gain: c.vol * 0.07, pan: c.pan * rand(-1, 1),
    });
  }
};

const bushCut: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    duration: 0.16, filterType: 'bandpass', filterFreq: 2500 * c.rate * vary(0.12), q: 0.7,
    sweepTo: 1100, gain: c.vol * 0.24, attack: 0.001, pan: c.pan,
  });
  for (let i = 0; i < 5; i++) {
    noise(r, t + rand(0.02, 0.24), {
      duration: rand(0.012, 0.03), filterType: 'bandpass',
      filterFreq: rand(2800, 6500) * c.rate, q: 3,
      gain: c.vol * rand(0.03, 0.08), attack: 0.0005, pan: c.pan * rand(-1, 1),
    });
  }
};

const pushBlock: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    attack: 0.06, decay: 0.08, sustain: 0.8, hold: 0.34, release: 0.16,
    filterType: 'lowpass', filterFreq: 700 * c.rate, q: 2.5, sweepTo: 380,
    gain: c.vol * 0.24, pan: c.pan, am: { rate: rand(26, 38), depth: 0.05 },
  });
  tone(r, t, {
    freq: 66 * c.rate, type: 'sine',
    attack: 0.05, decay: 0.08, sustain: 0.7, hold: 0.3, release: 0.16,
    gain: c.vol * 0.16, pan: c.pan,
  });
};

const pickup: SfxFn = (c) => {
  const { r, t } = c;
  [[0, 880], [0.07, 1320]].forEach(([dt, f]) => {
    tone(r, t + dt, {
      freq: f * c.rate * vary(0.01), type: 'triangle',
      attack: 0.002, decay: 0.14, gain: c.vol * 0.16, pan: c.pan,
    });
    tone(r, t + dt, {
      freq: f * 2 * c.rate, type: 'sine',
      attack: 0.002, decay: 0.08, gain: c.vol * 0.05, pan: c.pan,
    });
  });
};

const waterAmbient: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    attack: 0.6, decay: 0.2, sustain: 0.85, hold: 1.4, release: 0.7,
    filterType: 'bandpass', filterFreq: 900 * c.rate, q: 0.55, sweepTo: 1500,
    gain: c.vol * 0.11, pan: c.pan, am: { rate: 0.7, depth: 0.02 },
  });
  noise(r, t, {
    attack: 0.5, decay: 0.2, sustain: 0.8, hold: 1.5, release: 0.7,
    filterType: 'lowpass', filterFreq: 420 * c.rate, q: 1,
    gain: c.vol * 0.07, pan: c.pan * -0.5, am: { rate: 0.31, depth: 0.015 },
  });
  // Occasional stones under the current.
  for (let i = 0; i < 6; i++) {
    tone(r, t + rand(0.2, 2.4), {
      freq: rand(500, 1500) * c.rate, type: 'sine',
      slideFrom: rand(1.2, 1.8), slideTime: 0.04,
      attack: 0.003, decay: rand(0.04, 0.1), gain: c.vol * 0.035, pan: rand(-0.7, 0.7),
    });
  }
};

// ── UI ──────────────────────────────────────────────────────────────────────

/**
 * The most-heard sound in the game by an order of magnitude: one per character
 * of dialogue. Everything about it is subtraction — 45ms, a single triangle
 * through a lowpass, gain low enough that a sentence reads as texture rather
 * than as a sequence of beeps.
 */
const dialogueBlip: SfxFn = (c) => {
  tone(c.r, c.t, {
    freq: 430 * c.rate * vary(0.07), type: 'triangle',
    filter: { type: 'lowpass', freq: 1500, q: 0.6 },
    attack: 0.004, decay: 0.038, gain: c.vol * 0.1, pan: c.pan,
  });
};

const uiMove: SfxFn = (c) => {
  tone(c.r, c.t, {
    freq: 640 * c.rate * vary(0.02), type: 'triangle',
    filter: { type: 'lowpass', freq: 2600, q: 0.7 },
    attack: 0.003, decay: 0.055, gain: c.vol * 0.14, pan: c.pan,
  });
};

const uiConfirm: SfxFn = (c) => {
  const { r, t } = c;
  [[0, 523.25], [0.065, 783.99]].forEach(([dt, f]) => {
    tone(r, t + dt, {
      freq: f * c.rate, type: 'triangle',
      attack: 0.003, decay: 0.16, gain: c.vol * 0.16, pan: c.pan,
    });
    tone(r, t + dt, {
      freq: f * 2 * c.rate, type: 'sine',
      attack: 0.003, decay: 0.07, gain: c.vol * 0.04, pan: c.pan,
    });
  });
};

const uiCancel: SfxFn = (c) => {
  const { r, t } = c;
  [[0, 523.25], [0.06, 392.0]].forEach(([dt, f]) => {
    tone(r, t + dt, {
      freq: f * c.rate, type: 'triangle',
      filter: { type: 'lowpass', freq: 2200, q: 0.7 },
      attack: 0.003, decay: 0.13, gain: c.vol * 0.14, pan: c.pan,
    });
  });
};

const uiToast: SfxFn = (c) => {
  const { r, t } = c;
  bell(r, t, 880 * c.rate, {
    ring: 0.75, gain: c.vol * 0.13, strike: 0.25, bright: 0.7, doubled: 1, reverb: 0.2,
  });
  tone(r, t + 0.06, {
    freq: 1174.66 * c.rate, type: 'sine',
    attack: 0.004, decay: 0.28, gain: c.vol * 0.07, pan: c.pan, reverb: 0.2,
  });
};

const journalOpen: SfxFn = (c) => {
  const { r, t } = c;
  for (let i = 0; i < 3; i++) {
    noise(r, t + i * 0.045, {
      duration: rand(0.04, 0.08), filterType: 'bandpass',
      filterFreq: rand(2200, 4200) * c.rate, q: 0.9,
      gain: c.vol * 0.13, attack: 0.004, pan: c.pan,
    });
  }
  tone(r, t + 0.02, {
    freq: 392 * c.rate, type: 'sine', attack: 0.01, decay: 0.3,
    gain: c.vol * 0.08, pan: c.pan, reverb: 0.15,
  });
};

const journalClose: SfxFn = (c) => {
  const { r, t } = c;
  for (let i = 0; i < 2; i++) {
    noise(r, t + i * 0.05, {
      duration: rand(0.04, 0.07), filterType: 'bandpass',
      filterFreq: rand(1600, 3000) * c.rate, q: 0.9,
      gain: c.vol * 0.12, attack: 0.004, pan: c.pan,
    });
  }
  tone(r, t + 0.1, {
    freq: 262 * c.rate, type: 'sine', attack: 0.005, decay: 0.2,
    gain: c.vol * 0.09, pan: c.pan,
  });
};

/**
 * The concept-unlock chime. This plays exactly three times in the slice, at the
 * moments the game names what the player has just worked out for themselves, so
 * it is allowed to be the most beautiful sound in the build: a D major arpeggio
 * on struck glass over a slow swell, with a long reverb tail.
 */
const insight: SfxFn = (c) => {
  const { r, t } = c;
  const notes = [62, 66, 69, 74, 78];
  notes.forEach((n, i) => {
    const at = t + i * 0.115;
    bell(r, at, mtof(n) * c.rate, {
      ring: 2.2 - i * 0.15, gain: c.vol * 0.15, strike: 0.18,
      bright: 0.55, doubled: 2, beat: 0.6, reverb: 0.5,
      pan: clamp((i - 2) * 0.12, -1, 1),
    });
    tone(r, at, {
      freq: mtof(n + 12) * c.rate, type: 'sine',
      attack: 0.02, decay: 0.9, gain: c.vol * 0.035, reverb: 0.5,
    });
  });
  // The swell underneath: root and fifth, slow in, slow out.
  [50, 57].forEach((n, i) => {
    tone(r, t, {
      freq: mtof(n) * c.rate, type: 'triangle',
      filter: { type: 'lowpass', freq: 700, q: 0.8, sweepTo: 1600, sweepTime: 0.9 },
      attack: 0.45, decay: 0.2, sustain: 0.7, hold: 0.5, release: 1.0,
      gain: c.vol * (i ? 0.07 : 0.1), reverb: 0.3,
    });
  });
};

const questStart: SfxFn = (c) => {
  const { r, t } = c;
  [[0, 69], [0.1, 74]].forEach(([dt, n], i) => {
    tone(r, t + dt, {
      freq: mtof(n) * c.rate, type: 'triangle',
      attack: 0.006, decay: 0.34 + i * 0.1, gain: c.vol * 0.15, pan: c.pan, reverb: 0.25,
    });
    tone(r, t + dt, {
      freq: mtof(n + 12) * c.rate, type: 'sine',
      attack: 0.005, decay: 0.16, gain: c.vol * 0.05, pan: c.pan,
    });
  });
};

const questDone: SfxFn = (c) => {
  const { r, t } = c;
  [[0, 69], [0.11, 73], [0.22, 76], [0.34, 81]].forEach(([dt, n], i) => {
    tone(r, t + dt, {
      freq: mtof(n) * c.rate, type: 'triangle',
      attack: 0.005, decay: 0.4 + i * 0.12, gain: c.vol * 0.14, pan: c.pan, reverb: 0.3,
    });
  });
  bell(r, t + 0.34, mtof(81) * c.rate, {
    ring: 1.6, gain: c.vol * 0.1, strike: 0.2, bright: 0.6, doubled: 2, reverb: 0.35,
  });
};

// ── the Echo ────────────────────────────────────────────────────────────────

/**
 * The Echo's harmonic language is the tritone and the inharmonic spectrum —
 * intervals that never settle. `echo_hum` is a four-second loopable bed;
 * everything else in this section is built from the same intervals so the
 * creature sounds like one thing.
 */
const echoHum: SfxFn = (c) => {
  const { r, t } = c;
  const root = 55 * c.rate;
  [[1, 0.16], [Math.SQRT2, 0.1], [2.02, 0.055], [2.83, 0.03]].forEach(([ratio, amp], i) => {
    for (let d = 0; d < 2; d++) {
      tone(r, t, {
        freq: root * ratio, type: i < 2 ? 'sawtooth' : 'sine',
        detune: d ? 6 : -6,
        filter: { type: 'lowpass', freq: 600 + i * 300, q: 1.5 },
        attack: 0.9, decay: 0.3, sustain: 0.8, hold: 2.0, release: 1.0,
        gain: c.vol * amp * 0.5, pan: d ? 0.35 : -0.35, reverb: 0.35,
      });
    }
  });
  noise(r, t, {
    attack: 1.0, decay: 0.3, sustain: 0.8, hold: 1.8, release: 1.0,
    filterType: 'bandpass', filterFreq: 260 * c.rate, q: 0.8, sweepTo: 520,
    gain: c.vol * 0.055, am: { rate: 0.23, depth: 0.012 }, reverb: 0.3,
  });
};

const echoHit: SfxFn = (c) => {
  const { r, t } = c;
  [1, 1.41, 2.37, 3.62].forEach((ratio, i) => {
    tone(r, t, {
      freq: 190 * ratio * c.rate * vary(0.04), type: 'sine',
      slideFrom: 1.5, slideTime: 0.09,
      attack: 0.002, decay: 0.32 * Math.pow(0.7, i),
      gain: c.vol * 0.16 * Math.pow(0.7, i), pan: c.pan, reverb: 0.25,
    });
  });
  noise(r, t, {
    duration: 0.22, filterType: 'lowpass', filterFreq: 1800 * c.rate, q: 1.2,
    sweepTo: 300, gain: c.vol * 0.2, attack: 0.001, pan: c.pan,
  });
};

const echoRoar: SfxFn = (c) => {
  const { r, t } = c;
  [1, 1.007, 1.414, 2.01].forEach((ratio, i) => {
    tone(r, t, {
      freq: 72 * ratio * c.rate * vary(0.02), type: 'sawtooth',
      slideFrom: 0.7, slideTime: 0.35, slideTo: 0.82, slideToTime: 0.8,
      filter: { type: 'lowpass', freq: 300, q: 3.5, sweepTo: 1900, sweepTime: 0.55 },
      attack: 0.09, decay: 0.15, sustain: 0.8, hold: 0.6, release: 0.55,
      gain: c.vol * 0.15 * Math.pow(0.8, i), pan: (i % 2 ? 0.3 : -0.3) * c.pan,
      vibrato: { rate: 7.5, cents: 40, delay: 0.2 },
      reverb: 0.3,
    });
  });
  noise(r, t + 0.05, {
    attack: 0.15, decay: 0.15, sustain: 0.7, hold: 0.5, release: 0.5,
    filterType: 'bandpass', filterFreq: 500 * c.rate, q: 0.6, sweepTo: 2400,
    gain: c.vol * 0.13, am: { rate: 19, depth: 0.03 }, reverb: 0.3,
  });
};

const echoPhase: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    attack: 0.06, decay: 0.08, sustain: 0.6, hold: 0.16, release: 0.28,
    filterType: 'bandpass', filterFreq: 600 * c.rate, q: 2.2, sweepTo: 6000,
    gain: c.vol * 0.16, pan: c.pan, reverb: 0.3, delay: 0.18,
  });
  // Two voices sliding past one another — the sound of something not quite here.
  [[0.7, 1], [1.45, 1]].forEach(([from], i) => {
    tone(r, t, {
      freq: 620 * c.rate, type: 'sine', slideFrom: from, slideTime: 0.42,
      attack: 0.03, decay: 0.1, sustain: 0.55, hold: 0.15, release: 0.25,
      gain: c.vol * 0.09, pan: (i ? 0.5 : -0.5), reverb: 0.35,
    });
  });
};

const moteChirp: SfxFn = (c) => {
  tone(c.r, c.t, {
    freq: 1650 * c.rate * vary(0.09), type: 'sine',
    slideFrom: 0.62, slideTime: 0.055,
    attack: 0.004, decay: 0.075, gain: c.vol * 0.11, pan: c.pan, reverb: 0.2,
  });
};

/**
 * OBSERVE. Soft, curious, and — the brief says cyan — bright without any edge:
 * pure sines, a gentle upward glide, a shimmer an octave and a fifth above, and
 * enough reverb that it sounds like the world answering rather than a UI beep.
 */
const observe: SfxFn = (c) => {
  const { r, t } = c;
  [[0, 659.25, 0.11], [0.055, 987.77, 0.08], [0.11, 1318.5, 0.045]].forEach(([dt, f, g]) => {
    tone(r, t + dt, {
      freq: f * c.rate, type: 'sine', slideFrom: 0.97, slideTime: 0.18,
      attack: 0.035, decay: 0.12, sustain: 0.5, hold: 0.1, release: 0.42,
      gain: c.vol * g, pan: c.pan, reverb: 0.42,
    });
  });
  noise(r, t, {
    attack: 0.05, decay: 0.1, sustain: 0.4, hold: 0.06, release: 0.3,
    filterType: 'bandpass', filterFreq: 4200 * c.rate, q: 1.8, sweepTo: 7500,
    gain: c.vol * 0.035, reverb: 0.4,
  });
};

/**
 * LINK. Two tones a fourth apart glide together and lock into unison — the
 * ability is "these two things are associated", so the sound is literally two
 * things becoming one.
 */
const link: SfxFn = (c) => {
  const { r, t } = c;
  const target = 587.33 * c.rate;
  [0.75, 1.335].forEach((from, i) => {
    tone(r, t, {
      freq: target, type: 'triangle', slideFrom: from, slideTime: 0.34,
      attack: 0.03, decay: 0.1, sustain: 0.6, hold: 0.2, release: 0.3,
      gain: c.vol * 0.12, pan: i ? 0.45 : -0.45, reverb: 0.3,
    });
  });
  tone(r, t + 0.38, {
    freq: target * 2, type: 'sine',
    attack: 0.004, decay: 0.5, gain: c.vol * 0.07, reverb: 0.35,
  });
};

/**
 * RECALL. Backwards-feeling: a long swell that arrives rather than decays, and
 * a figure that falls, because the player is reaching for something already
 * behind them.
 */
const recall: SfxFn = (c) => {
  const { r, t } = c;
  noise(r, t, {
    attack: 0.42, decay: 0.06, sustain: 0.25, hold: 0.02, release: 0.1,
    filterType: 'bandpass', filterFreq: 700 * c.rate, q: 1.2, sweepTo: 3800,
    gain: c.vol * 0.11, reverb: 0.35,
  });
  [[0.4, 74], [0.5, 71], [0.6, 66]].forEach(([dt, n], i) => {
    tone(r, t + dt, {
      freq: mtof(n) * c.rate, type: 'sine',
      attack: 0.006, decay: 0.45 + i * 0.1, gain: c.vol * 0.11, pan: c.pan, reverb: 0.4,
    });
  });
};

/**
 * DISSENT. Three voices in unison; one breaks away. Once it has moved, the
 * other two follow it — which is exactly what happens in the Lantern Trial when
 * Nia disagrees out loud.
 */
const dissent: SfxFn = (c) => {
  const { r, t } = c;
  const base = 523.25 * c.rate;
  tone(r, t, {
    freq: base * 1.122, type: 'triangle', slideFrom: 1 / 1.122, slideTime: 0.3,
    attack: 0.02, decay: 0.08, sustain: 0.7, hold: 0.22, release: 0.28,
    gain: c.vol * 0.13, pan: -0.5, reverb: 0.28,
  });
  [0.06, 0.14].forEach((dt, i) => {
    tone(r, t, {
      freq: base * 1.122, type: 'triangle',
      slideFrom: 1 / 1.122, slideTime: 0.3 + dt + 0.14,
      attack: 0.02, decay: 0.08, sustain: 0.7, hold: 0.2, release: 0.26,
      gain: c.vol * 0.1, pan: i ? 0.5 : 0.1, reverb: 0.28,
    });
  });
  noise(r, t + 0.3, {
    duration: 0.05, filterType: 'bandpass', filterFreq: 3000 * c.rate, q: 2,
    gain: c.vol * 0.1, attack: 0.001,
  });
};

// ── registry ────────────────────────────────────────────────────────────────

export const SFX: Record<string, SfxFn> = {
  // signature
  bell_town: bellTown,
  bell_small: bellSmall,
  pipe_crash: pipeCrash,
  cat_meow: catMeow,
  cat_hiss: catHiss,
  cat_purr: catPurr,
  lantern_tone_a: (c) => lantern(c, 'a'),
  lantern_tone_b: (c) => lantern(c, 'b'),
  lantern_tone_c: (c) => lantern(c, 'c'),
  lantern_tone_ref: (c) => lantern(c, lanternRef),

  // player / combat
  step_grass: stepGrass,
  step_stone: stepStone,
  step_wood: stepWood,
  step_water: stepWater,
  sword,
  hit,
  crit,
  enemy_die: enemyDie,
  hurt,
  dash,
  block,
  charge,
  shoot,
  aggro,
  heart,
  land,

  // world
  door,
  door_stone: doorStone,
  chest,
  pressure_plate: pressurePlate,
  gate_open: gateOpen,
  switch: switchSfx,
  rune_activate: runeActivate,
  splash,
  bush_cut: bushCut,
  push_block: pushBlock,
  pickup,
  water_ambient: waterAmbient,

  // UI
  dialogue_blip: dialogueBlip,
  ui_move: uiMove,
  ui_confirm: uiConfirm,
  ui_cancel: uiCancel,
  ui_toast: uiToast,
  journal_open: journalOpen,
  journal_close: journalClose,
  insight,
  quest_start: questStart,
  quest_done: questDone,

  // Echo
  echo_hum: echoHum,
  echo_hit: echoHit,
  echo_roar: echoRoar,
  echo_phase: echoPhase,
  mote_chirp: moteChirp,
  observe,
  link,
  recall,
  dissent,
};

/**
 * Longest plausible tail per effect, in seconds. Only used by the offline probe
 * to decide how much silence to render; nothing at runtime depends on it.
 */
export const SFX_LENGTH: Record<string, number> = {
  bell_town: 5.2,
  bell_small: 2.4,
  pipe_crash: 2.2,
  cat_meow: 1.2,
  cat_hiss: 1.2,
  cat_purr: 2.2,
  door_stone: 2.4,
  gate_open: 2.0,
  water_ambient: 4.2,
  insight: 4.0,
  quest_done: 2.6,
  echo_hum: 6.0,
  echo_roar: 3.0,
  rune_activate: 2.6,
  chest: 1.4,
  recall: 1.8,
  observe: 1.4,
  link: 1.4,
  dissent: 1.4,
  echo_phase: 1.4,
  crit: 1.2,
  heart: 1.2,
  ui_toast: 1.4,
};

export function sfxNames(): string[] {
  return Object.keys(SFX).sort();
}

/** Resolve `name` or `name:variant` (used by `lantern_tone_ref:b`). */
export function playSfx(r: Rack, name: string, t: number, vol = 1, rate = 1, pan = 0): boolean {
  let key = name;
  const colon = name.indexOf(':');
  if (colon > 0) {
    key = name.slice(0, colon);
    const variant = name.slice(colon + 1);
    if (key === 'lantern_tone_ref' && (variant === 'a' || variant === 'b' || variant === 'c')) {
      setLanternRef(variant);
    }
  }
  const fn = SFX[key];
  if (!fn) return false;
  fn({ r, t, vol: Math.max(0, vol), rate: clamp(rate || 1, 0.25, 4), pan: clamp(pan, -1, 1) });
  return true;
}

// `pluck` and `fm` are part of the toolkit the music module uses; re-exported
// here so the sound library and the score share one import surface.
export { pluck, fm };
