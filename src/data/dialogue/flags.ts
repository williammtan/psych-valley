/**
 * The flags dialogue conditions on, and the six story stages the town reacts to.
 *
 * Quest code should set flags from this table rather than inventing strings, so
 * that a villager's line about "the business with the cat" and the quest that
 * caused it can never drift apart.
 */
import type { StateView } from './types';

export const FLAGS = {
  // Act I — arrival
  arrived: 'arrived',
  metMira: 'met_mira',
  bellRang: 'bell_rang',
  pipBolted: 'pip_bolted',
  q1Started: 'q1_started',

  // Quest one — the bell and the cat
  metSera: 'met_sera',
  cluePipes: 'clue_pipes',
  clueBellLog: 'clue_bell_log',
  clueScratches: 'clue_scratches',
  clueCatBed: 'clue_catbed',
  haveHandBell: 'have_hand_bell',
  bellStartled: 'bell_startled',
  bellSpoiled: 'bell_spoiled',
  pipCalm: 'pip_calm',
  q1Done: 'q1_done',
  metMote: 'met_mote',

  // Quest two — the mixed-up delivery
  orenPanic: 'oren_panic',
  q2Started: 'q2_started',
  clueReceipt: 'clue_receipt',
  clueBootprints: 'clue_bootprints',
  clueShutters: 'clue_shutters',
  cluePaint: 'clue_paint',
  clueBlueBox: 'clue_blue_box',
  clueRoster: 'clue_roster',
  threadsOpen: 'threads_open',
  threadsSolved: 'threads_solved',
  q2Done: 'q2_done',

  // Quest three — the lantern trial
  festivalOpen: 'festival_open',
  trialJoined: 'trial_joined',
  trialR1: 'trial_r1_done',
  trialR2: 'trial_r2_done',
  trialR3: 'trial_r3_done',
  /** Set when the player publicly matched the group in round three. */
  playerConformed: 'player_conformed',
  niaDissented: 'nia_dissented',
  trialR4: 'trial_r4_done',
  villagersHonest: 'villagers_honest',
  q3Done: 'q3_done',

  // Act V–VI — south, woods, shrine
  southGateOpen: 'south_gate_open',
  enteredWoods: 'entered_woods',
  woodsChest: 'woods_chest',
  enteredShrine: 'entered_shrine',
  bossBeaten: 'boss_beaten',
  shrineDone: 'shrine_done',
} as const;

export type FlagName = (typeof FLAGS)[keyof typeof FLAGS];

/**
 * Where the town is in the story. Ambient dialogue is written per stage: this
 * is the cheapest way to make the valley feel like it noticed what you did.
 *
 *   arrival     — you have just walked in; Pip is still under the settle
 *   afterQ1     — the cat is fine; nobody can stop talking about it
 *   afterQ2     — Oren's routes are untangled
 *   festival    — the plaza is lit and the Trial is running
 *   afterQ3     — the Trial is over and everyone is quietly embarrassed
 *   afterShrine — you came back up the south road
 */
export type Stage = 'arrival' | 'afterQ1' | 'afterQ2' | 'festival' | 'afterQ3' | 'afterShrine';

export const STAGES: Stage[] = ['arrival', 'afterQ1', 'afterQ2', 'festival', 'afterQ3', 'afterShrine'];

function done(s: StateView, flag: string, questId: string): boolean {
  if (s.has(flag)) return true;
  return !!s.quests?.[questId]?.complete;
}

/** Latest stage the state has reached. */
export function stageOf(s: StateView): Stage {
  if (s.has(FLAGS.shrineDone) || s.has(FLAGS.bossBeaten)) return 'afterShrine';
  if (done(s, FLAGS.q3Done, 'q3_lanterns')) return 'afterQ3';
  if (s.has(FLAGS.festivalOpen)) return 'festival';
  if (done(s, FLAGS.q2Done, 'q2_oren')) return 'afterQ2';
  if (done(s, FLAGS.q1Done, 'q1_pip')) return 'afterQ1';
  return 'arrival';
}
