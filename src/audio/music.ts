/**
 * THE SCORE
 * ─────────
 * Five tracks, written as note data and played by a lookahead sequencer. None
 * of them is a random arpeggiator: the pitches below are a composition, and the
 * arrangement decisions (when the drum enters, when the melody rests) are part
 * of the data rather than emergent.
 *
 * The tonal plan for the slice:
 *
 *   town      D major, 96bpm  — the home key. Everything the player likes.
 *   inn       the town melody reharmonised into B minor, 74bpm. Same place,
 *             indoors, at night.
 *   festival  D major, 132bpm — the town theme with its sleeves rolled up.
 *   woods     D dorian, 68bpm — one note away from home, and that note is the
 *             one that makes you uneasy.
 *   shrine    C / F# — a tritone, no key, no pulse. Not music the town made.
 *
 * The boss does not get a sixth composition; it raises `shrine`'s intensity,
 * which is both a production saving and the correct dramatic reading — the
 * Echo is the shrine, escalated.
 */
import {
  type Rack, addTicker, bell, clamp, createSends, mtof, noise, pluck, ramp, rand, tone,
} from './synth';

// ── data model ──────────────────────────────────────────────────────────────

export interface NoteEvent {
  /** Beat within the part's timeline. */
  b: number;
  /** Duration in beats. */
  d: number;
  /** MIDI note number. */
  n: number;
  /** Velocity 0..1. */
  v?: number;
  /** Overrides the part pan for this note. */
  p?: number;
}

export interface Part {
  voice: string;
  notes: NoteEvent[];
  gain?: number;
  pan?: number;
  reverb?: number;
  delay?: number;
  transpose?: number;
  /** Below this intensity the part is silent; it fades in over the next 0.25. */
  minIntensity?: number;
}

export interface TrackDef {
  id: string;
  bpm: number;
  /** Length of the looping section, in beats. */
  loop: number;
  /** Beats of one-shot introduction before the loop begins. */
  introBeats?: number;
  intro?: Part[];
  parts: Part[];
  gain?: number;
  /** Starting intensity, for tracks that have one. */
  intensity?: number;
}

const N = (b: number, d: number, n: number, v = 1): NoteEvent => ({ b, d, n, v });

// ── instrument voices ───────────────────────────────────────────────────────

interface VoiceArgs {
  r: Rack;
  dest: AudioNode;
  t: number;
  freq: number;
  /** Note length in seconds. */
  secs: number;
  vel: number;
  pan: number;
  reverb: number;
  delay: number;
}

type Voice = (a: VoiceArgs) => void;

const VOICES: Record<string, Voice> = {
  /** Steel-strung acoustic. The sound of Lumen Vale. */
  guitar: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    pluck(r, t, freq, {
      gain: 0.3 * vel, dur: secs, ring: 2.4, bright: 0.66, body: 1,
      lowpass: 5000, dest, pan, reverb,
    });
  },

  /** Softer, rounder pluck for the inn and for harp punctuation in the woods. */
  harp: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    pluck(r, t, freq, {
      gain: 0.26 * vel, dur: secs, ring: 3.2, bright: 0.5, body: 0.4,
      lowpass: 3200, dest, pan, reverb,
    });
  },

  /** Two detuned saws under a lowpass. Never the melody, always the floor. */
  pad: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    for (let i = 0; i < 2; i++) {
      tone(r, t, {
        freq, type: 'sawtooth', detune: i ? 6 : -6,
        filter: { type: 'lowpass', freq: 900, q: 0.8 },
        attack: Math.min(0.5, secs * 0.35), decay: 0.15, sustain: 0.7,
        hold: Math.max(0.05, secs * 0.6), release: Math.max(0.25, secs * 0.4),
        gain: 0.05 * vel, pan: pan + (i ? 0.16 : -0.16), dest, reverb,
      });
    }
  },

  /** Bowed ensemble: wider detune, slower bow, darker. */
  strings: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    for (let i = 0; i < 3; i++) {
      tone(r, t, {
        freq, type: 'sawtooth', detune: (i - 1) * 9,
        filter: { type: 'lowpass', freq: 700 + i * 120, q: 1.1 },
        attack: Math.min(0.85, secs * 0.4), decay: 0.2, sustain: 0.75,
        hold: Math.max(0.05, secs * 0.55), release: Math.max(0.4, secs * 0.5),
        gain: 0.038 * vel, pan: pan + (i - 1) * 0.22, dest, reverb,
        vibrato: { rate: 4.4, cents: 6, delay: 0.6 },
      });
    }
  },

  /** Warm sine bass with a triangle octave for definition on small speakers. */
  bass: ({ r, dest, t, freq, secs, vel, pan }) => {
    tone(r, t, {
      freq, type: 'sine',
      attack: 0.012, decay: 0.1, sustain: 0.72,
      hold: Math.max(0.05, secs * 0.7), release: 0.16,
      gain: 0.19 * vel, pan, dest,
    });
    tone(r, t, {
      freq: freq * 2, type: 'triangle',
      filter: { type: 'lowpass', freq: 1100, q: 0.7 },
      attack: 0.012, decay: 0.1, sustain: 0.5,
      hold: Math.max(0.05, secs * 0.5), release: 0.14,
      gain: 0.04 * vel, pan, dest,
    });
  },

  /** The singable line: triangle body, sine octave, human vibrato. */
  melody: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    tone(r, t, {
      freq, type: 'triangle',
      filter: { type: 'lowpass', freq: 2600, q: 0.7 },
      attack: 0.03, decay: 0.09, sustain: 0.72,
      hold: Math.max(0.04, secs * 0.72), release: Math.min(0.4, secs * 0.5 + 0.08),
      gain: 0.115 * vel, pan, dest, reverb,
      vibrato: { rate: 5.1, cents: 9, delay: 0.28 },
    });
    tone(r, t, {
      freq: freq * 2, type: 'sine',
      attack: 0.035, decay: 0.1, sustain: 0.4,
      hold: Math.max(0.04, secs * 0.6), release: 0.2,
      gain: 0.026 * vel, pan, dest, reverb,
    });
  },

  /** Indoors version: no vibrato to speak of, more air, sits lower. */
  hum: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    tone(r, t, {
      freq, type: 'sine',
      attack: 0.09, decay: 0.12, sustain: 0.75,
      hold: Math.max(0.05, secs * 0.7), release: Math.min(0.6, secs * 0.6 + 0.1),
      gain: 0.12 * vel, pan, dest, reverb: reverb || 0.35,
      vibrato: { rate: 4.2, cents: 5, delay: 0.5 },
    });
    tone(r, t, {
      freq: freq * 3, type: 'sine',
      attack: 0.12, decay: 0.12, sustain: 0.3,
      hold: Math.max(0.05, secs * 0.5), release: 0.3,
      gain: 0.014 * vel, pan, dest, reverb: 0.4,
    });
  },

  /** Sawtooth through a formant-ish bandpass, plus bow noise. A fiddle. */
  fiddle: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    tone(r, t, {
      freq, type: 'sawtooth',
      filter: { type: 'lowpass', freq: 3000, q: 1.4 },
      attack: 0.018, decay: 0.06, sustain: 0.8,
      hold: Math.max(0.03, secs * 0.75), release: 0.09,
      gain: 0.085 * vel, pan, dest, reverb,
      vibrato: { rate: 5.8, cents: 14, delay: 0.15 },
    });
    tone(r, t, {
      freq: freq * 2, type: 'triangle',
      attack: 0.02, decay: 0.06, sustain: 0.35,
      hold: Math.max(0.03, secs * 0.6), release: 0.08,
      gain: 0.018 * vel, pan, dest,
    });
    noise(r, t, {
      duration: 0.035, filterType: 'bandpass', filterFreq: clamp(freq * 5, 400, 9000), q: 1.2,
      gain: 0.02 * vel, attack: 0.004, pan, dest,
    });
  },

  /** Sine plus breath. Distant, and always a long way off. */
  flute: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    tone(r, t, {
      freq, type: 'sine',
      attack: 0.07, decay: 0.08, sustain: 0.8,
      hold: Math.max(0.04, secs * 0.72), release: Math.min(0.5, secs * 0.5 + 0.1),
      gain: 0.1 * vel, pan, dest, reverb: reverb || 0.4,
      vibrato: { rate: 4.8, cents: 11, delay: 0.35 },
    });
    tone(r, t, {
      freq: freq * 2, type: 'sine',
      attack: 0.09, decay: 0.1, sustain: 0.25,
      hold: Math.max(0.04, secs * 0.5), release: 0.25,
      gain: 0.012 * vel, pan, dest, reverb: 0.4,
    });
    noise(r, t, {
      attack: 0.08, decay: 0.1, sustain: 0.5, hold: Math.max(0.04, secs * 0.5), release: 0.2,
      filterType: 'bandpass', filterFreq: clamp(freq * 2.2, 300, 9000), q: 1.6,
      gain: 0.014 * vel, pan, dest, reverb: 0.35,
    });
  },

  /** Frame drum: a pitched thump with a skin transient. */
  drum: ({ r, dest, t, vel, pan, freq }) => {
    tone(r, t, {
      freq: freq || 84, type: 'sine', slideFrom: 1.6, slideTime: 0.05,
      attack: 0.001, decay: 0.22, gain: 0.24 * vel, pan, dest,
    });
    noise(r, t, {
      duration: 0.05, filterType: 'bandpass', filterFreq: 900, q: 0.8,
      gain: 0.05 * vel, attack: 0.001, pan, dest,
    });
  },

  /** Deep tom, for the shrine at full intensity. */
  tom: ({ r, dest, t, vel, pan, freq }) => {
    tone(r, t, {
      freq: freq || 62, type: 'sine', slideFrom: 1.9, slideTime: 0.09,
      attack: 0.001, decay: 0.42, gain: 1.0 * vel, pan, dest, reverb: 0.25,
    });
    noise(r, t, {
      duration: 0.09, filterType: 'lowpass', filterFreq: 700, q: 1.2,
      gain: 0.28 * vel, attack: 0.001, pan, dest,
    });
  },

  shaker: ({ r, dest, t, vel, pan }) => {
    noise(r, t, {
      duration: 0.038 * rand(0.85, 1.15), filterType: 'highpass',
      filterFreq: 5200 * rand(0.94, 1.06),
      gain: 0.05 * vel, attack: 0.002, pan, dest,
    });
  },

  tamb: ({ r, dest, t, vel, pan }) => {
    noise(r, t, {
      duration: 0.07, filterType: 'highpass', filterFreq: 4200,
      gain: 0.045 * vel, attack: 0.001, pan, dest,
    });
    // The jingles: a couple of high inharmonic partials.
    [5100, 6900].forEach((f, i) => {
      tone(r, t, {
        freq: f * rand(0.98, 1.02), type: 'sine',
        attack: 0.001, decay: 0.1 - i * 0.03, gain: 0.012 * vel, pan, dest,
      });
    });
  },

  /** Struck metal with a deliberately wrong partial set. The shrine's voice. */
  chime: ({ r, dest, t, freq, vel, pan, reverb }) => {
    bell(r, t, freq, {
      ring: 3.4,
      partials: [
        [1, 1, 1.2], [1.41, 0.62, 0.9], [2.37, 0.4, 0.6],
        [3.14, 0.22, 0.42], [4.73, 0.13, 0.3], [6.19, 0.08, 0.2],
      ],
      gain: 0.11 * vel, strike: 0.3, bright: 1, doubled: 2, beat: 3,
      pan, dest, reverb: reverb || 0.5,
    });
  },

  /** Very slow, very wide, barely moving. */
  drone: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    for (let i = 0; i < 3; i++) {
      tone(r, t, {
        freq, type: i === 2 ? 'sine' : 'sawtooth', detune: (i - 1) * 11,
        filter: { type: 'lowpass', freq: 420 + i * 90, q: 1.6 },
        // Slow, but never so slow that the track takes two seconds to exist.
        attack: Math.min(1.4, secs * 0.3), decay: 0.5, sustain: 0.85,
        hold: Math.max(0.1, secs * 0.5), release: Math.max(1.2, secs * 0.35),
        gain: 0.036 * vel, pan: pan + (i - 1) * 0.3, dest, reverb: reverb || 0.4,
      });
    }
  },

  /** High detuned sines. Beautiful and slightly wrong. */
  shimmer: ({ r, dest, t, freq, secs, vel, pan, reverb }) => {
    for (let i = 0; i < 2; i++) {
      tone(r, t, {
        freq, type: 'sine', detune: i ? 14 : -14,
        attack: Math.min(1.6, secs * 0.4), decay: 0.4, sustain: 0.6,
        hold: Math.max(0.1, secs * 0.4), release: Math.max(0.8, secs * 0.4),
        gain: 0.022 * vel, pan: i ? 0.5 : -0.5, dest, reverb: reverb || 0.5,
      });
    }
  },

  /** The driving low pulse the boss fight brings in. */
  pulse: ({ r, dest, t, freq, secs, vel, pan }) => {
    tone(r, t, {
      freq, type: 'sawtooth',
      filter: { type: 'lowpass', freq: 260, q: 5, sweepTo: 120, sweepTime: Math.max(0.1, secs) },
      attack: 0.004, decay: 0.09, sustain: 0.55,
      hold: Math.max(0.03, secs * 0.55), release: 0.1,
      gain: 0.95 * vel, pan, dest,
    });
    // A click of definition on top, so the pulse reads on small speakers.
    tone(r, t, {
      freq: freq * 4, type: 'triangle',
      filter: { type: 'lowpass', freq: 900, q: 1 },
      attack: 0.002, decay: 0.07, gain: 0.2 * vel, pan, dest,
    });
  },
};

// ── shared musical material ─────────────────────────────────────────────────

/** Four-note guitar voicings: [bass root, bass fifth, mid, top]. */
const CH = {
  D:  [50, 57, 62, 66],
  Bm: [47, 54, 59, 62],
  G:  [43, 50, 55, 59],
  A:  [45, 52, 57, 61],
  Em: [40, 47, 55, 59],
};

/** Bass roots, kept inside 62–110Hz where a small speaker can still find them. */
const ROOT: Record<string, number> = { D: 38, Bm: 35, G: 43, A: 45, Em: 40 };

/** Triads for the pad, voiced above the guitar so nothing fights. */
const TRIAD: Record<string, number[]> = {
  D: [62, 66, 69], Bm: [59, 62, 66], G: [55, 59, 62], A: [57, 61, 64], Em: [52, 55, 59],
};

type ChordName = keyof typeof CH;

/**
 * Travis-style fingerpicking: alternating bass on beats 1 and 3 with the treble
 * strings filling the gaps. One pattern, sixteen bars — a real guitarist's right
 * hand does not change every bar, and neither should this.
 */
const PICK: Array<[number, number, number]> = [
  [0.0, 0, 0.95], [0.5, 2, 0.55], [1.0, 3, 0.62], [1.5, 2, 0.5],
  [2.0, 1, 0.85], [2.5, 2, 0.55], [3.0, 3, 0.6], [3.5, 2, 0.46],
];

function fingerpick(bars: ChordName[], pattern = PICK, hold = 1.1, startBar = 0): NoteEvent[] {
  const out: NoteEvent[] = [];
  bars.forEach((name, i) => {
    const chord = CH[name];
    for (const [off, idx, v] of pattern) out.push(N((startBar + i) * 4 + off, hold, chord[idx], v));
  });
  return out;
}

function chordPart(bars: ChordName[], table: Record<string, number[]>, dur = 4, v = 1): NoteEvent[] {
  const out: NoteEvent[] = [];
  bars.forEach((name, i) => {
    for (const n of table[name]) out.push(N(i * 4, dur, n, v));
  });
  return out;
}

function bassPart(bars: ChordName[], pattern: Array<[number, number]> = [[0, 2.5], [2, 1.5]]): NoteEvent[] {
  const out: NoteEvent[] = [];
  bars.forEach((name, i) => {
    for (const [off, d] of pattern) out.push(N(i * 4 + off, d, ROOT[name], off === 0 ? 1 : 0.7));
  });
  return out;
}

/** Downstroke across a voicing, with the human 12ms of roll between strings. */
function strum(beat: number, name: ChordName, vel: number, spread = 0.012, up = false): NoteEvent[] {
  const chord = up ? [...CH[name]].reverse() : CH[name];
  return chord.map((n, i) => N(beat + i * spread, 0.45, n, vel * (1 - i * 0.08)));
}

// ── 1. TOWN — Lumen Vale ────────────────────────────────────────────────────

/**
 * Sixteen bars, forty seconds, D major.
 *
 * The brief for this one is restraint: it has to survive the twentieth loop, so
 * the melody rests for four of the sixteen bars, the percussion only plays in
 * the second half of each eight-bar phrase, and nothing ever gets louder than
 * the guitar.
 */
const TOWN_BARS: ChordName[] = [
  'D', 'Bm', 'G', 'A', 'D', 'G', 'A', 'D',
  'G', 'D', 'Em', 'A', 'G', 'A', 'D', 'D',
];

/**
 * The tune. It is deliberately stepwise and inside one octave — you should be
 * able to hum it back after one pass, because the inn and the festival are both
 * going to ask you to recognise it.
 */
export const TOWN_MELODY: NoteEvent[] = [
  // bars 1–2 rest: the guitar states the harmony alone first.
  N(8, 1, 74), N(9, 1, 71), N(10, 2, 67),
  N(12, 1, 69), N(13, 1, 73), N(14, 2, 76),
  N(16, 1.5, 74), N(17.5, 0.5, 76), N(18, 2, 78),
  N(20, 1, 76), N(21, 1, 74), N(22, 2, 71),
  N(24, 1, 73), N(25, 1, 71), N(26, 1, 69), N(27, 1, 71),
  N(28, 3, 74),
  // bars 9–10 rest again — the phrase breathes in the same place twice.
  N(40, 1, 71), N(41, 1, 67), N(42, 2, 64),
  N(44, 1, 69), N(45, 1, 71), N(46, 2, 73),
  N(48, 1.5, 74), N(49.5, 0.5, 71), N(50, 2, 67),
  N(52, 1, 69), N(53, 1, 73), N(54, 1, 76), N(55, 1, 78),
  N(56, 1, 78), N(57, 1, 76), N(58, 1, 74), N(59, 1, 73),
  N(60, 3, 74),
];

/** Light hand percussion, second half of each eight-bar phrase only. */
function townPerc(): { drum: NoteEvent[]; shaker: NoteEvent[] } {
  const drum: NoteEvent[] = [];
  const shaker: NoteEvent[] = [];
  for (const bar of [4, 5, 6, 7, 12, 13, 14, 15]) {
    const b = bar * 4;
    drum.push(N(b, 0.5, 36, 0.85), N(b + 2, 0.5, 36, 0.7));
    if (bar % 2 === 1) drum.push(N(b + 2.75, 0.4, 36, 0.35));
    for (const off of [0.5, 1.5, 2.5, 3.5]) shaker.push(N(b + off, 0.2, 60, 0.55));
    for (const off of [1, 3]) shaker.push(N(b + off, 0.2, 60, 0.25));
  }
  return { drum, shaker };
}

const townP = townPerc();

const TOWN: TrackDef = {
  id: 'town',
  bpm: 96,
  loop: 64,
  introBeats: 8,
  gain: 0.95,
  intro: [
    { voice: 'guitar', gain: 0.85, notes: fingerpick(['D', 'A'], PICK, 1.1) },
    { voice: 'pad', gain: 0.7, notes: chordPart(['D', 'A'], TRIAD, 3.8, 0.7) },
  ],
  parts: [
    { voice: 'guitar', notes: fingerpick(TOWN_BARS), pan: -0.12, reverb: 0.12 },
    { voice: 'melody', notes: TOWN_MELODY, pan: 0.1, reverb: 0.16 },
    { voice: 'pad', notes: chordPart(TOWN_BARS, TRIAD, 3.7, 0.8), gain: 0.9, reverb: 0.2 },
    { voice: 'bass', notes: bassPart(TOWN_BARS), gain: 0.95 },
    { voice: 'drum', notes: townP.drum, gain: 0.8, pan: -0.2 },
    { voice: 'shaker', notes: townP.shaker, gain: 0.8, pan: 0.3 },
  ],
};

// ── 2. INN — the same melody, indoors ───────────────────────────────────────

/**
 * The town theme's tune, reharmonised.
 *
 * The melody's first phrase over Em7 / F#m7 / Bm turns a major folk song into
 * something wistful without changing a single note of the tune. That is the
 * whole trick, and it is why the inn feels like the same place rather than a
 * different game: the player recognises the melody before they notice the mode
 * has moved underneath it.
 */
const INN_VOICING: Record<string, number[]> = {
  Em7:  [40, 47, 55, 62],
  Fsm7: [42, 49, 57, 64],
  Bm:   [47, 54, 59, 66],
  G:    [43, 50, 55, 62],
  A:    [45, 52, 57, 64],
  D:    [50, 57, 62, 66],
};
const INN_TRIAD: Record<string, number[]> = {
  Em7: [55, 59, 62], Fsm7: [57, 61, 64], Bm: [59, 62, 66],
  G: [55, 59, 62], A: [57, 61, 64], D: [57, 62, 66],
};
const INN_ROOT: Record<string, number> = { Em7: 40, Fsm7: 42, Bm: 47, G: 43, A: 45, D: 38 };
const INN_BARS = ['Em7', 'Fsm7', 'Bm', 'G', 'A', 'D', 'Bm', 'A'];

/** Half the notes of the town pattern — a late-evening right hand. */
const INN_PICK: Array<[number, number, number]> = [
  [0.0, 0, 0.8], [1.0, 2, 0.42], [2.0, 1, 0.6], [3.0, 3, 0.38],
];

function innPart(table: Record<string, number[]>, pattern: Array<[number, number, number]>): NoteEvent[] {
  const out: NoteEvent[] = [];
  INN_BARS.forEach((name, i) => {
    for (const [off, idx, v] of pattern) out.push(N(i * 4 + off, 1.6, table[name][idx], v));
  });
  return out;
}

const INN: TrackDef = {
  id: 'inn',
  bpm: 74,
  loop: 32,
  introBeats: 4,
  gain: 0.26,
  intro: [
    { voice: 'harp', gain: 0.7, reverb: 0.4, notes: [N(0, 2, 40, 0.7), N(2, 2, 59, 0.5)] },
  ],
  parts: [
    { voice: 'harp', notes: innPart(INN_VOICING, INN_PICK), pan: -0.15, reverb: 0.36, gain: 0.95 },
    {
      voice: 'hum',
      pan: 0.08,
      reverb: 0.45,
      notes: [
        N(0, 1.5, 62), N(1.5, 0.5, 59), N(2, 2, 55),
        N(4, 1, 57), N(5, 1, 61), N(6, 2, 64),
        N(8, 1.5, 62), N(9.5, 0.5, 64), N(10, 2, 66),
        N(12, 1, 64), N(13, 1, 62), N(14, 2, 59),
        N(16, 1, 61), N(17, 1, 59), N(18, 1, 57), N(19, 1, 59),
        N(20, 3, 62),
        N(24, 2, 66), N(26, 2, 62),
        // bar 8 rests. Indoors, at night, nobody finishes the sentence.
      ],
    },
    {
      voice: 'pad',
      gain: 0.85,
      reverb: 0.4,
      notes: INN_BARS.flatMap((name, i) => INN_TRIAD[name].map((n) => N(i * 4, 3.6, n, 0.75))),
    },
    {
      voice: 'bass',
      gain: 0.8,
      notes: INN_BARS.map((name, i) => N(i * 4, 3.4, INN_ROOT[name], 0.85)),
    },
  ],
};

// ── 3. FESTIVAL — the town, celebrating ─────────────────────────────────────

/**
 * Same key, same chords, twice the tempo and a fiddle on top. The lead quotes
 * the town melody's contour (D–F#–A, E–D–B, C#–B–A) at every phrase start, so
 * the festival reads as *these people* having a party rather than as a
 * different soundtrack playing over the same sprites.
 */
const FEST_BARS: ChordName[] = ['D', 'D', 'G', 'A', 'Bm', 'G', 'A', 'D'];

const FEST_FIDDLE: NoteEvent[] = [
  N(0, 0.5, 74), N(0.5, 0.5, 78), N(1, 0.5, 81), N(1.5, 0.5, 78),
  N(2, 0.5, 74), N(2.5, 0.5, 76), N(3, 1, 78),
  N(4, 0.5, 81), N(4.5, 0.5, 83), N(5, 0.5, 81), N(5.5, 0.5, 78),
  N(6, 1, 76), N(7, 1, 74),
  N(8, 0.5, 71), N(8.5, 0.5, 74), N(9, 0.5, 79), N(9.5, 0.5, 74),
  N(10, 0.5, 71), N(10.5, 0.5, 74), N(11, 1, 79),
  N(12, 0.5, 73), N(12.5, 0.5, 76), N(13, 0.5, 81), N(13.5, 0.5, 76),
  N(14, 1, 73), N(15, 1, 76),
  N(16, 0.5, 78), N(16.5, 0.5, 74), N(17, 0.5, 71), N(17.5, 0.5, 74),
  N(18, 1, 78), N(19, 1, 81),
  N(20, 0.5, 79), N(20.5, 0.5, 78), N(21, 0.5, 76), N(21.5, 0.5, 74),
  N(22, 1, 71), N(23, 1, 74),
  N(24, 0.5, 73), N(24.5, 0.5, 71), N(25, 0.5, 69), N(25.5, 0.5, 71),
  N(26, 1, 73), N(27, 1, 76),
  N(28, 2, 74), N(30, 1, 69), N(31, 1, 73),
];

/** A second fiddle a third below, only where the phrase needs weight. */
const FEST_COUNTER: NoteEvent[] = [
  N(8, 2, 59, 0.8), N(10, 2, 62, 0.8),
  N(12, 2, 61, 0.8), N(14, 2, 64, 0.8),
  N(24, 2, 57, 0.8), N(26, 2, 61, 0.8),
  N(28, 4, 62, 0.75),
];

function festGuitar(): NoteEvent[] {
  const out: NoteEvent[] = [];
  FEST_BARS.forEach((name, i) => {
    const b = i * 4;
    out.push(N(b, 0.4, CH[name][0], 0.9), N(b + 2, 0.4, CH[name][1], 0.8));
    out.push(...strum(b + 1, name, 0.62), ...strum(b + 1.5, name, 0.34, 0.01, true));
    out.push(...strum(b + 3, name, 0.62), ...strum(b + 3.5, name, 0.34, 0.01, true));
  });
  return out;
}

function festPerc(): { drum: NoteEvent[]; tamb: NoteEvent[] } {
  const drum: NoteEvent[] = [];
  const tamb: NoteEvent[] = [];
  for (let bar = 0; bar < 8; bar++) {
    const b = bar * 4;
    drum.push(N(b, 0.4, 36, 1), N(b + 1.5, 0.4, 36, 0.5), N(b + 2, 0.4, 41, 0.8), N(b + 3.5, 0.4, 36, 0.55));
    for (let e = 0; e < 8; e++) tamb.push(N(b + e * 0.5, 0.2, 60, e % 2 ? 0.85 : 0.42));
  }
  return { drum, tamb };
}

const festP = festPerc();

const FESTIVAL: TrackDef = {
  id: 'festival',
  bpm: 132,
  loop: 32,
  introBeats: 4,
  gain: 1.25,
  // A four-beat pickup: drum, a tambourine roll that never stops, and the
  // fiddle scooping up into the downbeat.
  intro: [
    { voice: 'bass', gain: 0.9, notes: [N(0, 4, 38, 0.75)] },
    { voice: 'drum', gain: 1.1, notes: [N(0, 0.4, 36, 0.9), N(1, 0.4, 36, 0.6), N(2, 0.4, 36, 1), N(3, 0.4, 41, 0.7), N(3.5, 0.4, 41, 0.85)] },
    { voice: 'tamb', gain: 1.5, notes: Array.from({ length: 8 }, (_, i) => N(i * 0.5, 0.2, 60, 0.6 + i * 0.05)) },
    { voice: 'fiddle', gain: 0.85, pan: 0.18, notes: [N(2, 1, 69, 0.55), N(3, 0.5, 71, 0.75), N(3.5, 0.5, 73, 0.9)] },
  ],
  parts: [
    { voice: 'guitar', notes: festGuitar(), pan: -0.2, gain: 0.85 },
    { voice: 'fiddle', notes: FEST_FIDDLE, pan: 0.18, reverb: 0.15 },
    { voice: 'fiddle', notes: FEST_COUNTER, pan: -0.4, gain: 0.6, reverb: 0.15 },
    { voice: 'bass', notes: bassPart(FEST_BARS, [[0, 1.4], [1, 0.8], [2, 1.4], [3, 0.8]]), gain: 0.95 },
    { voice: 'drum', notes: festP.drum, gain: 0.9, pan: -0.15 },
    { voice: 'tamb', notes: festP.tamb, gain: 0.75, pan: 0.35 },
    { voice: 'pad', notes: chordPart(FEST_BARS, TRIAD, 3.6, 0.6), gain: 0.6, reverb: 0.2 },
  ],
};

// ── 4. WOODS — exploration ──────────────────────────────────────────────────

/**
 * D dorian. The mode is the whole point: it is a minor scale with a major
 * sixth, which means the woods sound gentle and slightly wrong at the same
 * time. The B natural in the flute's last phrase is that sixth, and the G#
 * shimmer at bar 6 is the tritone from the tonic — one note, once per loop,
 * quiet enough that the player feels it rather than hears it.
 */
const WOODS_VOICING: Record<string, number[]> = {
  Dm: [38, 50, 57, 62],
  C:  [36, 48, 55, 60],
  Am: [33, 45, 52, 57],
  F:  [41, 53, 60, 65],
  G:  [43, 50, 55, 62], // no third — the F natural above must not make a tritone
};
const WOODS_BARS = ['Dm', 'Dm', 'C', 'Am', 'F', 'C', 'G', 'Dm'];

const WOODS: TrackDef = {
  id: 'woods',
  bpm: 68,
  loop: 32,
  introBeats: 8,
  gain: 0.36,
  intro: [
    { voice: 'drone', gain: 0.8, notes: [N(0, 8, 38, 0.7)] },
    { voice: 'harp', gain: 0.6, reverb: 0.5, notes: [N(0, 3, 50, 0.5), N(4, 3, 62, 0.5)] },
  ],
  parts: [
    // The pedal D that never leaves.
    { voice: 'drone', gain: 0.9, reverb: 0.45, notes: [N(0, 16, 38, 0.8), N(16, 16, 38, 0.8)] },
    {
      voice: 'strings',
      gain: 0.95,
      reverb: 0.4,
      notes: WOODS_BARS.flatMap((name, i) =>
        [1, 2, 3].map((idx) => N(i * 4, 3.6, WOODS_VOICING[name][idx], 0.8))),
    },
    {
      voice: 'flute',
      pan: 0.3,
      reverb: 0.55,
      gain: 0.9,
      notes: [
        N(8, 1, 69), N(9, 1, 72), N(10, 2, 74),
        N(12, 1.5, 77), N(13.5, 0.5, 76), N(14, 2, 74),
        N(24, 1, 74), N(25, 1, 77), N(26, 2, 79),
        N(28, 2, 71), N(30, 2, 69),
      ],
    },
    {
      voice: 'harp',
      gain: 0.7,
      pan: -0.35,
      reverb: 0.5,
      notes: [N(0, 2, 62, 0.6), N(6, 2, 57, 0.45), N(16, 2, 65, 0.55), N(21, 2, 60, 0.4)],
    },
    // The tritone. Once per loop, and you are not sure you heard it.
    { voice: 'shimmer', gain: 0.7, reverb: 0.6, notes: [N(22, 2.5, 80, 0.55)] },
  ],
};

// ── 5. SHRINE — atmosphere, and the boss ────────────────────────────────────

/**
 * No key, no pulse, and no bar lines the player can find. The two drones are a
 * tritone apart (C and F#) and the metallic pings land on beats chosen to avoid
 * any grid — 1.3, 4.7, 6.2, 10.9 — so the ear never locks on.
 *
 * `intensity` escalates it into the boss fight rather than cutting to a sixth
 * track: at 0.45 a low pulse arrives and gives the room a heartbeat it did not
 * have, and at 0.72 toms and a rising line turn the same material into a fight.
 * The player has been listening to the Echo's theme for the whole dungeon
 * without knowing it.
 */
const SHRINE: TrackDef = {
  id: 'shrine',
  bpm: 60,
  loop: 32,
  introBeats: 2,
  intensity: 0,
  gain: 0.24,
  intro: [
    { voice: 'drone', gain: 0.6, notes: [N(0, 2, 36, 0.5)] },
  ],
  parts: [
    { voice: 'drone', gain: 1, reverb: 0.55, notes: [N(0, 32, 36, 0.9)] },
    { voice: 'drone', gain: 0.8, reverb: 0.55, pan: 0.3, notes: [N(0, 32, 42, 0.8)] },
    // A third drone that comes and goes on its own schedule.
    { voice: 'drone', gain: 0.55, reverb: 0.6, pan: -0.4, notes: [N(9, 11, 48, 0.6), N(26, 6, 43, 0.5)] },
    {
      voice: 'shimmer',
      gain: 0.8,
      reverb: 0.6,
      notes: [N(2, 7, 84, 0.6), N(14, 5, 78, 0.5), N(23, 8, 90, 0.45)],
    },
    {
      voice: 'chime',
      reverb: 0.6,
      notes: [
        N(1.3, 1, 72, 0.75), N(4.7, 1, 78, 0.6), N(6.2, 1, 84, 0.45),
        N(10.9, 1, 73, 0.7), N(13.1, 1, 79, 0.5), N(17.4, 1, 66, 0.8),
        N(20.05, 1, 85, 0.4), N(23.9, 1, 72, 0.65), N(26.4, 1, 78, 0.55),
        N(30.7, 1, 90, 0.35),
      ],
    },
    // ── escalation ───────────────────────────────────────────────────────
    {
      voice: 'pulse',
      minIntensity: 0.45,
      gain: 2.4,
      reverb: 0.2,
      notes: Array.from({ length: 32 }, (_, i) => N(i, 0.85, i % 4 === 0 ? 36 : 36, i % 4 === 0 ? 1 : 0.55)),
    },
    {
      voice: 'chime',
      minIntensity: 0.6,
      gain: 1.1,
      reverb: 0.5,
      notes: [
        N(3.55, 1, 78, 0.5), N(8.15, 1, 84, 0.45), N(12.4, 1, 66, 0.6),
        N(18.85, 1, 79, 0.5), N(22.3, 1, 73, 0.55), N(28.6, 1, 85, 0.4),
      ],
    },
    {
      voice: 'tom',
      minIntensity: 0.72,
      gain: 2.4,
      notes: Array.from({ length: 8 }, (_, bar) => [
        N(bar * 4, 0.5, 36, 1), N(bar * 4 + 1.5, 0.5, 36, 0.55),
        N(bar * 4 + 2.5, 0.5, 38, 0.75), N(bar * 4 + 3.25, 0.5, 33, 0.5),
      ]).flat(),
    },
    {
      voice: 'strings',
      minIntensity: 0.72,
      gain: 9,
      reverb: 0.35,
      notes: [
        N(0, 8, 48, 0.9), N(8, 8, 49, 0.9), N(16, 8, 54, 0.95), N(24, 8, 55, 1),
      ],
    },
  ],
};

export const TRACKS: Record<string, TrackDef> = {
  town: TOWN,
  inn: INN,
  festival: FESTIVAL,
  woods: WOODS,
  shrine: SHRINE,
};

/** `boss` is the shrine track at full intensity — see the module header. */
export const TRACK_ALIASES: Record<string, string> = {
  boss: 'shrine:1',
  echo_shrine: 'shrine',
  lumen_vale: 'town',
  dungeon: 'shrine',
};

export function trackNames(): string[] {
  return Object.keys(TRACKS);
}

// ── sequencer ───────────────────────────────────────────────────────────────

interface LivePart {
  def: Part;
  gain: GainNode;
}

interface Playing {
  def: TrackDef;
  out: GainNode;
  /**
   * A view of the rack whose effect sends feed this track's own output, so the
   * reverb tail belongs to the track and fades with it.
   */
  rack: Rack;
  /** Send-chain nodes, torn down with the track (the delay loop is a cycle). */
  sends: AudioNode[];
  parts: LivePart[];
  /** ctx time of beat 0. */
  origin: number;
  /** Everything up to here has been scheduled. */
  cursor: number;
  intensity: number;
  /** Set when fading out; removed once past. */
  stopAt: number;
}

export class MusicPlayer {
  private r: Rack;
  /** All track gains land here, so ducking is one node rather than a search. */
  private duck: GainNode;
  private playing: Playing[] = [];
  private current: Playing | null = null;
  private detach: (() => void) | null = null;
  private duckUntil = 0;
  private duckRelease = 0.4;
  /** Incremented per track start; QA uses it to prove music does not restart. */
  starts = 0;
  /** Offline players are pumped by hand; they must not join the global clock. */
  private offline: boolean;

  constructor(r: Rack, offline = false) {
    this.r = r;
    this.offline = offline;
    this.duck = r.ctx.createGain();
    this.duck.gain.value = 1;
    this.duck.connect(r.music);
  }

  get currentId(): string | null {
    return this.current ? this.current.def.id : null;
  }

  get intensity(): number {
    return this.current ? this.current.intensity : 0;
  }

  /**
   * `name` may carry an intensity, e.g. `shrine:0.8`. Re-requesting the track
   * that is already playing does nothing — walking between two maps that share
   * a track must not restart the music.
   */
  play(name: string, fadeMs = 800): void {
    const resolved = TRACK_ALIASES[name] ?? name;
    const colon = resolved.indexOf(':');
    const id = colon > 0 ? resolved.slice(0, colon) : resolved;
    const intensity = colon > 0 ? clamp(parseFloat(resolved.slice(colon + 1)) || 0, 0, 1) : undefined;

    const def = TRACKS[id];
    if (!def) {
      if (name) console.warn(`[audio] no music track '${name}'`);
      this.stop(fadeMs);
      return;
    }

    if (this.current && this.current.def.id === id) {
      if (intensity !== undefined) this.setIntensity(intensity);
      return;
    }

    this.fadeOutAll(fadeMs);

    const now = this.r.ctx.currentTime;
    const out = this.r.ctx.createGain();
    out.gain.setValueAtTime(0.0001, now);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0001, def.gain ?? 1), now + fadeMs / 1000);
    out.connect(this.duck);

    const sends = createSends(this.r.ctx, out);
    const p: Playing = {
      def,
      out,
      rack: { ...this.r, reverbSend: sends.reverbSend, delaySend: sends.delaySend },
      sends: sends.nodes,
      parts: [],
      origin: now + 0.06,
      cursor: now + 0.06,
      intensity: intensity ?? def.intensity ?? 0,
      stopAt: Infinity,
    };
    const all = [...(def.intro ?? []), ...def.parts];
    for (const part of all) {
      const g = this.r.ctx.createGain();
      g.gain.value = this.partGain(part, p.intensity);
      g.connect(out);
      p.parts.push({ def: part, gain: g });
    }
    this.playing.push(p);
    this.current = p;
    this.starts++;
    this.ensureTicker();
  }

  stop(fadeMs = 800): void {
    this.fadeOutAll(fadeMs);
    this.current = null;
  }

  /** Dip the music by `amount` (0..1) for `ms`, then bring it back. */
  duckBy(amount: number, ms: number): void {
    const now = this.r.ctx.currentTime;
    const target = clamp(1 - amount, 0.02, 1);
    ramp(this.duck.gain, target, now, 0.12);
    this.duckUntil = Math.max(this.duckUntil, now + Math.max(0, ms) / 1000);
    this.duckRelease = 0.5;
    this.ensureTicker();
  }

  setIntensity(x: number, seconds = 1.6): void {
    const p = this.current;
    if (!p) return;
    p.intensity = clamp(x, 0, 1);
    const now = this.r.ctx.currentTime;
    for (const lp of p.parts) ramp(lp.gain.gain, this.partGain(lp.def, p.intensity), now, seconds);
  }

  /** Render `seconds` of a track into the current rack, for offline probing. */
  renderOffline(name: string, seconds: number): void {
    this.play(name, 1);
    const start = this.r.ctx.currentTime;
    // Schedule the whole span in one pass; there is no real-time clock offline.
    this.tick(start, start + seconds);
  }

  private partGain(part: Part, intensity: number): number {
    const base = part.gain ?? 1;
    if (part.minIntensity === undefined) return base;
    return base * clamp((intensity - part.minIntensity) / 0.25, 0, 1);
  }

  private fadeOutAll(fadeMs: number): void {
    const now = this.r.ctx.currentTime;
    const f = Math.max(0.02, fadeMs / 1000);
    for (const p of this.playing) {
      if (p.stopAt !== Infinity) continue;
      ramp(p.out.gain, 0, now, f);
      p.stopAt = now + f;
    }
  }

  private ensureTicker(): void {
    if (this.detach || this.offline) return;
    this.detach = addTicker((now, horizon) => this.tick(now, horizon));
  }

  private tick(now: number, horizon: number): void {
    if (this.duckUntil && now > this.duckUntil) {
      this.duckUntil = 0;
      ramp(this.duck.gain, 1, now, this.duckRelease);
    }

    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i];
      if (now > p.stopAt + 0.4) {
        try {
          for (const n of p.sends) n.disconnect();
          p.out.disconnect();
        } catch { /* already gone */ }
        this.playing.splice(i, 1);
        if (this.current === p) this.current = null;
        continue;
      }
      // A backgrounded tab throttles timers; slide the whole timeline forward
      // rather than dumping a second of missed notes into the present.
      if (p.cursor < now - 0.25) {
        const skip = now - p.cursor;
        p.origin += skip;
        p.cursor = now;
      }
      if (horizon > p.cursor) {
        this.schedule(p, p.cursor, horizon);
        p.cursor = horizon;
      }
    }

    if (!this.playing.length && this.detach) {
      this.detach();
      this.detach = null;
    }
  }

  private schedule(p: Playing, from: number, to: number): void {
    const spb = 60 / p.def.bpm;
    const b0 = (from - p.origin) / spb;
    const b1 = (to - p.origin) / spb;
    const introBeats = p.def.introBeats ?? 0;
    const loop = p.def.loop;
    const introCount = p.def.intro?.length ?? 0;

    for (let pi = 0; pi < p.parts.length; pi++) {
      const lp = p.parts[pi];
      const isIntro = pi < introCount;
      if (lp.gain.gain.value < 0.004 && this.partGain(lp.def, p.intensity) < 0.004) continue;
      const tr = lp.def.transpose ?? 0;

      const emit = (beat: number, note: NoteEvent): void => {
        const t = p.origin + beat * spb;
        const voice = VOICES[lp.def.voice];
        if (!voice) return;
        voice({
          r: p.rack,
          dest: lp.gain,
          t,
          freq: mtof(note.n + tr),
          secs: note.d * spb,
          vel: note.v ?? 1,
          pan: note.p ?? lp.def.pan ?? 0,
          reverb: lp.def.reverb ?? 0,
          delay: lp.def.delay ?? 0,
        });
      };

      if (isIntro) {
        for (const note of lp.def.notes) {
          if (note.b >= b0 && note.b < b1) emit(note.b, note);
        }
        continue;
      }
      const c0 = Math.floor((b0 - introBeats) / loop);
      const c1 = Math.floor((b1 - introBeats) / loop);
      for (let c = Math.max(0, c0); c <= c1; c++) {
        const base = introBeats + c * loop;
        for (const note of lp.def.notes) {
          const abs = base + note.b;
          if (abs >= b0 && abs < b1) emit(abs, note);
        }
      }
    }
  }
}
