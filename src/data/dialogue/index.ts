/**
 * THE DIALOGUE INDEX.
 *
 * Quest and scene code imports from here and from nowhere else:
 *
 *   import { TALK, play, ambient } from '@/data/dialogue';
 *
 *   await w.cutscene.run(async (c) => {
 *     for (const b of play(TALK.mira.firstMeeting)) {
 *       if (b.kind === 'line') await c.say(b.speaker, b.text, b);
 *       else if (b.kind === 'choose') { ... }
 *     }
 *   });
 *
 * `play` resolves flag- and stage-conditional variants against the live State,
 * so an NPC's lines change after each quest without the caller knowing.
 */
import { State } from '@/core/state';
import { AMBIENT, type AmbientProfile } from './ambient';
import { ARRIVAL } from './arrival';
import {
  BOOK_SPINES, GRAVES, INSCRIPTIONS, LABELS, NOTICE_BOARD, PROPS, ROSTER, SIGNS, STOREROOM,
} from './environment';
import { STAGES, stageOf } from './flags';
import { BARKER, PIP_SIGHTINGS, SHELF } from './optional';
import { Q1 } from './quest1_bell';
import { Q2 } from './quest2_delivery';
import { Q3 } from './quest3_lantern';
import { BOSS, ENDING, SHRINE, SOUTH, WOODS } from './shrine';
import {
  resolveBeats, walkLines,
  type Beat, type Exchange, type ExchangeMap, type Line, type ResolvedBeat, type StateView,
} from './types';

export * from './types';
export { FLAGS, STAGES, stageOf } from './flags';
export type { Stage } from './flags';
export type { AmbientProfile } from './ambient';
export { AMBIENT } from './ambient';

/** Every character's first-meeting exchange, keyed by person id. */
const CHARACTER_TALK: Record<string, ExchangeMap> = Object.fromEntries(
  Object.entries(AMBIENT).map(([id, p]: [string, AmbientProfile]) => [id, { firstMeeting: p.firstMeeting }]),
);

/**
 * Named exchanges, by bucket. Story beats sit under their act or quest; each
 * character's own bucket holds the exchanges that belong to them personally.
 */
export const TALK: Record<string, ExchangeMap> = {
  arrival: ARRIVAL,
  q1: Q1,
  q2: Q2,
  q3: Q3,
  south: SOUTH,
  woods: WOODS,
  shrine: SHRINE,
  boss: BOSS,
  ending: ENDING,
  ...CHARACTER_TALK,
};

/** Everything readable that is not a person: signs, props, labels, stones. */
export const ENV: ExchangeMap = {
  ...SIGNS,
  ...PROPS,
  ...BOOK_SPINES,
  ...LABELS,
  ...GRAVES,
  ...INSCRIPTIONS,
  ...PIP_SIGHTINGS,
  ...SHELF,
  ...BARKER,
  notice_board: NOTICE_BOARD,
  courier_roster: ROSTER,
  storeroom: STOREROOM,
};

// ── lookup ──────────────────────────────────────────────────────────────────

const BY_ID: Record<string, Exchange> = (() => {
  const out: Record<string, Exchange> = {};
  for (const map of Object.values(TALK)) for (const ex of Object.values(map)) out[ex.id] = ex;
  for (const ex of Object.values(ENV)) out[ex.id] = ex;
  return out;
})();

/** Look an exchange up by its dotted id, e.g. 'q1.naming'. */
export function exchangeById(id: string): Exchange | undefined {
  return BY_ID[id];
}

/** Every exchange in the game, for tooling. */
export function allExchanges(): Exchange[] {
  return Object.values(BY_ID);
}

// ── playback ────────────────────────────────────────────────────────────────

/**
 * Resolve an exchange (or a loose run of beats) for the current state: drop
 * anything gated off, inline groups, pick variants, filter choice options.
 */
export function play(source: Exchange | Beat[], s: StateView = State): ResolvedBeat[] {
  const beats = Array.isArray(source) ? source : source.beats;
  return resolveBeats(beats, s, stageOf(s));
}

/** Same, by id. Returns an empty run rather than throwing on a bad id. */
export function playById(id: string, s: StateView = State): ResolvedBeat[] {
  const ex = BY_ID[id];
  if (!ex) {
    console.warn(`[dialogue] no exchange with id "${id}"`);
    return [];
  }
  return play(ex, s);
}

/** The description for a prop / sign / object id, or null if it has none. */
export function describe(id: string, s: StateView = State): ResolvedBeat[] | null {
  const ex = ENV[id] ?? BY_ID[id];
  return ex ? play(ex, s) : null;
}

// ── ambient ─────────────────────────────────────────────────────────────────

const cycle = new Map<string, number>();

/** The idle lines a character has available right now. */
export function ambientLines(person: string, s: StateView = State): string[] {
  const profile = AMBIENT[person];
  if (!profile) return [];
  const stage = stageOf(s);
  const here = profile.idle[stage];
  if (here && here.length) return here;
  // Fall back down the stages so nobody is ever mute.
  for (let i = STAGES.indexOf(stage) - 1; i >= 0; i--) {
    const earlier = profile.idle[STAGES[i]];
    if (earlier && earlier.length) return earlier;
  }
  return [];
}

/**
 * The next idle line for a character, cycling through their set for the current
 * stage so that talking to someone twice never repeats immediately.
 */
export function ambient(person: string, s: StateView = State): Line | null {
  const lines = ambientLines(person, s);
  if (!lines.length) return null;
  const key = `${person}:${stageOf(s)}`;
  const n = cycle.get(key) ?? 0;
  cycle.set(key, n + 1);
  return { kind: 'line', speaker: person, text: lines[n % lines.length] };
}

/** Their "here is where to go next" line for the current stage. */
export function hint(person: string, s: StateView = State): Line | null {
  const profile = AMBIENT[person];
  if (!profile) return null;
  const stage = stageOf(s);
  const text = profile.hint[stage];
  return text ? { kind: 'line', speaker: person, text } : null;
}

/** Anyone's hint, for a nudge from whoever happens to be standing nearby. */
export function anyHint(s: StateView = State): Line | null {
  for (const id of ['sera', 'mira', 'nia', 'elia', 'oren', 'tavi']) {
    const l = hint(id, s);
    if (l) return l;
  }
  return null;
}

export function firstMeeting(person: string): Exchange | undefined {
  return AMBIENT[person]?.firstMeeting;
}

/** Has this person been met? Convenience so callers do not reach into State. */
export function shouldPlayFirstMeeting(person: string, s: StateView = State): boolean {
  return !!AMBIENT[person] && !s.has(`met_${person}`);
}

// ── tooling ─────────────────────────────────────────────────────────────────

export interface IndexedLine {
  /** Where it lives: exchange id plus beat path, or an ambient slot. */
  path: string;
  speaker: string;
  text: string;
  /** Deliberate repetition (a crowd chorus, or the Echo quoting someone). */
  dup?: boolean;
}

/** Every player-visible line in the game, conditions ignored. Used by the lint. */
export function allLines(): IndexedLine[] {
  const out: IndexedLine[] = [];
  const pushExchange = (ex: Exchange) => {
    walkLines(ex.beats, (l, p) => out.push({
      path: `${ex.id}${p}`, speaker: l.speaker, text: l.text, ...(l.dup ? { dup: true } : {}),
    }));
  };
  for (const ex of allExchanges()) pushExchange(ex);
  for (const [id, profile] of Object.entries(AMBIENT)) {
    for (const stage of STAGES) {
      (profile.idle[stage] ?? []).forEach((text, i) => {
        out.push({ path: `ambient.${id}.idle.${stage}[${i}]`, speaker: id, text });
      });
      const h = profile.hint[stage];
      if (h) out.push({ path: `ambient.${id}.hint.${stage}`, speaker: id, text: h });
    }
  }
  return out;
}
