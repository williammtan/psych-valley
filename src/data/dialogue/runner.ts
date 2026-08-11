/**
 * Playing dialogue data through a cutscene.
 *
 * Every quest otherwise writes the same switch statement, so it lives here once:
 *
 *   import { TALK, playExchange } from '@/data/dialogue';
 *
 *   await w.cutscene.run((c) => playExchange(c, TALK.mira.firstMeeting, {
 *     cue: (name, note) => w.handleCue(name, note),
 *   }));
 *
 * `CutsceneLike` is structural on purpose — this file imports nothing from
 * `src/systems`, so the dialogue package stays loadable by tools and tests.
 * `CutsceneContext` satisfies it as-is.
 */
import { State } from '@/core/state';
import { stageOf } from './flags';
import { resolveBeats, type Beat, type Exchange, type ResolvedBeat, type StateView } from './types';

export interface CutsceneLike {
  say(speaker: string, text: string, opts?: { emote?: string; emphasis?: boolean; auto?: number }): Promise<void>;
  choose(prompt: string, choices: Array<{ text: string; flag?: string; value?: string }>): Promise<number>;
  wait(ms: number): Promise<void>;
  insight(id: string): Promise<void>;
  banner(title: string, subtitle?: string): void;
}

export interface RunOptions {
  /** Stage directions: sounds, camera moves, an NPC bolting under furniture. */
  cue?: (name: string, note?: string) => void | Promise<void>;
  /** Called with the chosen option's index and flavour flag, if it has one. */
  onChoice?: (index: number, flag?: string) => void;
  /** Which state to resolve against, and where choice flags are recorded. */
  state?: StateView & { set?: (flag: string, value?: boolean) => void };
}

/** Play an already-resolved run of beats. */
export async function runBeats(c: CutsceneLike, beats: ResolvedBeat[], opts: RunOptions = {}): Promise<void> {
  const state = opts.state ?? State;
  for (const b of beats) {
    switch (b.kind) {
      case 'line':
        await c.say(b.speaker, b.text, b);
        break;
      case 'choose': {
        const index = await c.choose(b.prompt ?? '', b.options.map((o) => ({ text: o.text, flag: o.flag })));
        const chosen = b.options[index] ?? b.options[0];
        if (chosen.flag) state.set?.(chosen.flag, true);
        opts.onChoice?.(index, chosen.flag);
        // Tone only: every option rejoins the same script immediately after.
        await runBeats(c, chosen.reply ?? [], opts);
        break;
      }
      case 'pause':
        await c.wait(b.ms);
        break;
      case 'insight':
        await c.insight(b.concept);
        break;
      case 'banner':
        c.banner(b.title, b.subtitle);
        break;
      case 'cue':
        await opts.cue?.(b.name, b.note);
        break;
    }
  }
}

/** Resolve an exchange for the current state, then play it. */
export function playExchange(
  c: CutsceneLike,
  source: Exchange | Beat[],
  opts: RunOptions = {},
): Promise<void> {
  const s = opts.state ?? State;
  const beats = Array.isArray(source) ? source : source.beats;
  return runBeats(c, resolveBeats(beats, s, stageOf(s)), opts);
}
