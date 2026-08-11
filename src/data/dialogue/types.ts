/**
 * Dialogue data model.
 *
 * Every word a character says lives in this folder as data. Quest code asks for
 * an exchange by id, resolves it against the current State, and plays the beats
 * through Cutscene. Nothing in `src/quests` or `src/scenes` should ever contain
 * a string a player can read.
 *
 * The shapes here exist to support four things the writing needs:
 *
 *   1. a line              — one speaker, one short sentence
 *   2. conditional variants — the same moment, written differently once the
 *                             player has done something (`requires` / `forbids`
 *                             / `stage`)
 *   3. player choices       — participatory, never branching. An option changes
 *                             the tone and the immediate reply. It never changes
 *                             which beats come next, and never gates content.
 *   4. stage directions     — pauses, cues, insight cards — so a scripted scene
 *                             reads in one place instead of being split between
 *                             the writer's file and the programmer's.
 */
import type { Stage } from './flags';

/** The subset of GameState the dialogue layer reads. `State` satisfies it. */
export interface StateView {
  has(flag: string): boolean;
  count?(key: string): number;
  quests?: Record<string, { active: boolean; complete: boolean }>;
}

export interface Condition {
  /** Every flag must be set. */
  requires?: string | string[];
  /** No flag may be set. */
  forbids?: string | string[];
  /** Only during these story stages. */
  stage?: Stage | Stage[];
}

export interface Line extends Condition {
  kind: 'line';
  /** A key of PEOPLE, or 'player' / 'narrator'. */
  speaker: string;
  text: string;
  /** Emote glyph floated over the speaker. */
  emote?: string;
  /** Shake / punch the box. Use once a scene at most. */
  emphasis?: boolean;
  /** Hold for this long instead of waiting for a button. */
  auto?: number;
  /**
   * This line repeats another one on purpose — a crowd saying the same word,
   * or the Echo giving somebody's sentence back to them. Exempt from the
   * duplicate check, and a note to the next writer not to "fix" it.
   */
  dup?: boolean;
}

export interface ChoiceOption extends Condition {
  /** What the player says. Keep it under six words where you can. */
  text: string;
  /** Optional flavour flag, for callbacks. Never gates content. */
  flag?: string;
  /** The immediate reply. Tone only — the scene continues the same way. */
  reply?: Beat[];
}

export interface ChoiceBeat extends Condition {
  kind: 'choose';
  prompt?: string;
  options: ChoiceOption[];
}

/** A whole exchange gated on a condition. */
export interface GroupBeat extends Condition {
  kind: 'group';
  beats: Beat[];
}

/** First option whose condition passes is played; the rest are skipped. */
export interface VariantBeat {
  kind: 'variants';
  options: Array<GroupBeat | Line>;
}

export interface PauseBeat extends Condition {
  kind: 'pause';
  ms: number;
}

/** Show the concept card and wait for dismissal. */
export interface InsightBeat extends Condition {
  kind: 'insight';
  concept: string;
}

export interface BannerBeat extends Condition {
  kind: 'banner';
  title: string;
  subtitle?: string;
}

/**
 * A stage direction for the quest programmer: a sound, a camera move, an NPC
 * bolting under the furniture. Unknown cues are safe to ignore.
 */
export interface CueBeat extends Condition {
  kind: 'cue';
  name: string;
  note?: string;
}

export type Beat =
  | Line
  | ChoiceBeat
  | GroupBeat
  | VariantBeat
  | PauseBeat
  | InsightBeat
  | BannerBeat
  | CueBeat;

/** A named, playable run of beats. */
export interface Exchange {
  id: string;
  /** For the writer and the linter, not the player. */
  note?: string;
  beats: Beat[];
}

export type ExchangeMap = Record<string, Exchange>;

// ── authoring helpers ───────────────────────────────────────────────────────
// These keep the content files readable. They are the whole authoring API.

type LineOpts = Omit<Line, 'kind' | 'speaker' | 'text'>;

export function say(speaker: string, text: string, opts: LineOpts = {}): Line {
  return { kind: 'line', speaker, text, ...opts };
}

/** Narration and object descriptions. No name plate. */
export function nar(text: string, opts: LineOpts = {}): Line {
  return { kind: 'line', speaker: 'narrator', text, ...opts };
}

/** The player speaking. Used inside choice replies and short scripted beats. */
export function you(text: string, opts: LineOpts = {}): Line {
  return { kind: 'line', speaker: 'player', text, ...opts };
}

export function opt(text: string, reply: Beat[] = [], extra: Omit<ChoiceOption, 'text' | 'reply'> = {}): ChoiceOption {
  return { text, reply, ...extra };
}

export function choose(options: ChoiceOption[], prompt?: string): ChoiceBeat {
  return { kind: 'choose', options, ...(prompt ? { prompt } : {}) };
}

export function group(cond: Condition, beats: Beat[]): GroupBeat {
  return { kind: 'group', beats, ...cond };
}

export function variants(...options: Array<GroupBeat | Line>): VariantBeat {
  return { kind: 'variants', options };
}

export function pause(ms: number): PauseBeat {
  return { kind: 'pause', ms };
}

export function insight(concept: string): InsightBeat {
  return { kind: 'insight', concept };
}

export function banner(title: string, subtitle?: string): BannerBeat {
  return { kind: 'banner', title, ...(subtitle ? { subtitle } : {}) };
}

export function cue(name: string, note?: string): CueBeat {
  return { kind: 'cue', name, ...(note ? { note } : {}) };
}

export function exchange(id: string, beats: Beat[], note?: string): Exchange {
  return { id, beats, ...(note ? { note } : {}) };
}

/** An interactable's description: one or more narrator lines. */
export function look(id: string, ...texts: string[]): Exchange {
  return { id, beats: texts.map((t) => nar(t)) };
}

/** Give every exchange in a map its dotted id, so lint output points somewhere. */
export function namespaced(prefix: string, map: ExchangeMap): ExchangeMap {
  const out: ExchangeMap = {};
  for (const [key, ex] of Object.entries(map)) {
    out[key] = { ...ex, id: ex.id || `${prefix}.${key}` };
  }
  return out;
}

// ── resolution ──────────────────────────────────────────────────────────────

function list(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Does this condition hold right now? `stage` is passed in to avoid recomputing. */
export function matches(cond: Condition, s: StateView, stage: Stage): boolean {
  for (const f of list(cond.requires)) if (!s.has(f)) return false;
  for (const f of list(cond.forbids)) if (s.has(f)) return false;
  if (cond.stage) {
    const allowed = Array.isArray(cond.stage) ? cond.stage : [cond.stage];
    if (!allowed.includes(stage)) return false;
  }
  return true;
}

/** A beat that is definitely going to play: groups flattened, variants picked. */
export type ResolvedBeat = Line | ChoiceBeat | PauseBeat | InsightBeat | BannerBeat | CueBeat;

/**
 * Flatten `beats` for the current state: drop anything whose condition fails,
 * inline groups, pick the first passing variant, and filter choice options.
 */
export function resolveBeats(beats: Beat[], s: StateView, stage: Stage): ResolvedBeat[] {
  const out: ResolvedBeat[] = [];
  for (const b of beats) {
    if (b.kind === 'variants') {
      for (const o of b.options) {
        if (!matches(o, s, stage)) continue;
        if (o.kind === 'group') out.push(...resolveBeats(o.beats, s, stage));
        else out.push(o);
        break;
      }
      continue;
    }
    if (!matches(b, s, stage)) continue;
    if (b.kind === 'group') {
      out.push(...resolveBeats(b.beats, s, stage));
      continue;
    }
    if (b.kind === 'choose') {
      const options = b.options
        .filter((o) => matches(o, s, stage))
        .map((o) => ({ ...o, reply: o.reply ? resolveBeats(o.reply, s, stage) : [] }));
      if (options.length === 0) continue;
      out.push({ ...b, options });
      continue;
    }
    out.push(b);
  }
  return out;
}

/** Every line in a beat tree, conditions ignored. For tooling and lint. */
export function walkLines(beats: Beat[], visit: (l: Line, path: string) => void, path = ''): void {
  beats.forEach((b, i) => {
    const here = `${path}[${i}]`;
    switch (b.kind) {
      case 'line':
        visit(b, here);
        break;
      case 'group':
        walkLines(b.beats, visit, here);
        break;
      case 'variants':
        b.options.forEach((o, j) => {
          if (o.kind === 'group') walkLines(o.beats, visit, `${here}.v${j}`);
          else visit(o, `${here}.v${j}`);
        });
        break;
      case 'choose':
        // Choice text is text the player reads and "says", so it is linted too.
        if (b.prompt) visit({ kind: 'line', speaker: 'narrator', text: b.prompt }, `${here}.prompt`);
        b.options.forEach((o, j) => {
          visit({ kind: 'line', speaker: 'player', text: o.text }, `${here}.opt${j}`);
          if (o.reply) walkLines(o.reply, visit, `${here}.opt${j}`);
        });
        break;
      default:
        break;
    }
  });
}
