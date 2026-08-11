/**
 * ACT IV — the Festival of Lanterns and the Lantern Trial.
 *
 * Every word spoken in this quest lives in `src/data/dialogue/quest3_lantern.ts`
 * and is played through `playExchange`. This file owns only what the words
 * cannot: the tones, the light, the camera, the crowd's bubbles, and the moment
 * the game stops and waits for the player.
 *
 * The design rule it exists to serve (plan.md §16) is that the player has to
 * *feel* the pressure, not answer a question about it:
 *
 *   THE TASK IS REAL, AND IT NEVER CHANGES.  The reference rings the third
 *   lantern in every round. The player establishes that for themselves in round
 *   one, privately, with nobody watching. Nothing about the lanterns is
 *   different in round three — only the number of people pointing the same way.
 *   Striking a lantern is free and unlimited; the answer prompt is also the
 *   instrument, so a player can compare for as long as they like. That certainty
 *   is the load-bearing beam: round three only hurts if you *know*.
 *
 *   THE SILENT FALLBACK CARRIES THE SAME INFORMATION AND NO MORE.  A struck
 *   lantern flashes a pattern — two slow, three, or five quick, all over the
 *   same total time, so it is the rhythm that identifies it and never the
 *   duration. The reference flashes the matching lantern's rhythm in its *own*
 *   colour, never the matching lantern's colour: a player with the sound off
 *   does the same comparison a hearing player does, not an easier one.
 *
 *   NOTHING IS PUNISHED.  No round announces who was right until round four
 *   reveals it for everybody at once. The player's round-three answer is checked
 *   against THE GROUP, never against the truth, and sets one flag. That flag
 *   only changes what people say to them afterwards. Conforming is a reasonable
 *   bet and the game treats it as one.
 *
 *   TAVI IS NOT A VILLAIN (§27).  He is quick, warm, funny and never once
 *   entertains the possibility that he is wrong. He is liked. That is the point.
 *
 * The words this quest is about appear nowhere until Sera's Insight Card.
 */
import Phaser from 'phaser';
import { DEPTH } from '@/core/config';
import { emit, on as busOn, once } from '@/core/events';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { registerArea } from '../registry';
import { TRIAL_COLORS } from '../maps/festival';
import { FLAGS, TALK, ambient, playExchange, type Beat, type CutsceneLike } from '@/data/dialogue';
import type { WorldScene } from '@/scenes/WorldScene';
import type { CutsceneContext } from '@/systems/Cutscene';
import type { Dir } from '@/entities/Player';

type L = 'a' | 'b' | 'c';

/** Everyone standing in the horseshoe around the player. */
const PARTICIPANTS = [
  'tavi', 'villager_a', 'villager_b', 'villager_c', 'villager_d', 'villager_e', 'villager_f', 'nia',
];

/** The reference rings the THIRD lantern. Every round. That is the whole trick. */
const TRUTH: L = 'c';
/** What the plaza decides it is, from round two on. */
const GROUP: L = 'b';

/**
 * How a struck lantern flashes for a player with the sound off. Same total
 * length, different rhythm — the rate is the signal, so a silent player is
 * doing a comparison, not reading a label.
 */
const PATTERN: Record<L, { count: number; gap: number }> = {
  a: { count: 2, gap: 430 },
  b: { count: 3, gap: 287 },
  c: { count: 5, gap: 172 },
};

const BASE_FRAME: Record<L | 'ref', string> = {
  a: 'prop/fest/trial_lantern_a',
  b: 'prop/fest/trial_lantern_b',
  c: 'prop/fest/trial_lantern_c',
  ref: 'prop/fest/reference_lantern',
};

/**
 * The ceremony is shot in two setups, and the cut between them is the round's
 * rhythm: look at the lanterns while the reference rings, look at the people
 * while the people answer. Round three tightens onto the group a third time.
 */
const FRAME_STAGE = 20.0;
const FRAME_GROUP = 25.4;
const FRAME_PRESSURE = 25.9;

// ─────────────────────────────────────────────────────────────────────────────
// What the crowd's bubbles do, round by round
// ─────────────────────────────────────────────────────────────────────────────

interface Vote {
  says: L;
  /** Their honest answer, shown first, before they visibly change it. */
  from?: L;
}

/**
 * The public answers, keyed by who gives them. A bubble goes up the instant its
 * owner's authored line lands, so the player watches the consensus form rather
 * than being told about it afterwards.
 *
 * Nia has no entry until round four: Elia's "you have not answered all evening"
 * has to be true.
 */
const VOTES: Array<Record<string, Vote>> = [
  // Round 1 — private slates, revealed only after the player has committed.
  {
    tavi: { says: 'c' }, villager_a: { says: 'c' }, villager_b: { says: 'c' },
    villager_c: { says: 'c' }, villager_d: { says: 'a' }, villager_e: { says: 'c' },
    villager_f: { says: 'c' }, nia: { says: 'c' },
  },
  // Round 2 — Tavi first, and two of them audibly change their minds.
  {
    tavi: { says: 'b' }, villager_a: { says: 'b' },
    villager_b: { says: 'b', from: 'c' }, villager_c: { says: 'b', from: 'c' },
    villager_d: { says: 'b' }, villager_f: { says: 'b' },
  },
  // Round 3 — six voices, one answer, and the player has not spoken yet.
  {
    tavi: { says: 'b' }, villager_a: { says: 'b' }, villager_b: { says: 'b' },
    villager_c: { says: 'b' }, villager_d: { says: 'b' }, villager_e: { says: 'b', from: 'c' },
  },
  // Round 4 — Nia is wrong out loud, and the group comes apart anyway.
  {
    nia: { says: 'a' }, villager_b: { says: 'c' }, villager_f: { says: 'c' },
    villager_c: { says: 'c' },
  },
];

/** Post-trial exchanges, played once each before ambient life resumes. */
const AFTER: Record<string, string> = {
  tavi: 'taviAfter',
  nia: 'afterNia',
  villager_a: 'afterBram',
  villager_b: 'afterHesta',
  villager_c: 'afterDov',
  villager_d: 'afterWren',
  villager_e: 'afterTomas',
  villager_f: 'afterIsolde',
  elia: 'afterElia',
};

// ─────────────────────────────────────────────────────────────────────────────
// The lanterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four ceremonial lanterns: their sprites, their tones, and the additive
 * glow each one pulses when struck. The glows are owned here rather than by the
 * map's static `lights` because they have to be driven frame by frame.
 */
class LanternRig {
  private glow: Partial<Record<L | 'ref', Phaser.GameObjects.Image>> = {};
  private sprite: Partial<Record<L | 'ref', Phaser.GameObjects.Sprite>> = {};

  constructor(w: WorldScene) {
    const bind = (key: L | 'ref', propId: string, color: number) => {
      const p = w.prop(propId);
      if (!p) return;
      this.sprite[key] = p.sprite;
      // Anchored on the lit head, not the sprite's base: the mounted lanterns
      // carry their globe 28px up, the reference its diamond 38px up.
      const img = w.add.image(p.sprite.x, p.sprite.y - (key === 'ref' ? 38 : 28), 'atlas', 'fx/light_soft_128')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.LIGHT + 2)
        .setScale(key === 'ref' ? 0.95 : 0.8)
        .setAlpha(0)
        .setTint(color);
      this.glow[key] = img;
    };
    bind('a', 'lantern_a', TRIAL_COLORS.a);
    bind('b', 'lantern_b', TRIAL_COLORS.b);
    bind('c', 'lantern_c', TRIAL_COLORS.c);
    // The reference glows in its own moon-white, never in the answer's colour.
    bind('ref', 'ref_lantern', 0xfff2d2);
  }

  /** How long a strike takes, so the ceremony can wait for it. */
  static duration(p: L): number {
    return PATTERN[p].count * PATTERN[p].gap + 260;
  }

  private flash(w: WorldScene, key: L | 'ref', pattern: L, delay = 0): void {
    const img = this.glow[key];
    const spr = this.sprite[key];
    const { count, gap } = PATTERN[pattern];
    if (spr) {
      const anim = key === 'ref' ? 'reference_lantern_struck' : `lantern_${key}_struck`;
      if (w.anims.exists(anim)) spr.play(anim, true);
    }
    for (let i = 0; i < count; i++) {
      w.time.delayedCall(delay + i * gap, () => {
        if (!img?.active) return;
        img.setAlpha(0);
        w.tweens.add({
          targets: img, alpha: 0.95, duration: Math.round(gap * 0.2), yoyo: true,
          hold: Math.round(gap * 0.08), ease: 'Quad.easeOut',
        });
        if (i === 0) w.fx.bellRing(img.x, img.y + 12, true);
      });
    }
    w.time.delayedCall(delay + count * gap + 240, () => {
      img?.setAlpha(0);
      if (spr) { spr.stop(); spr.setTexture('atlas', BASE_FRAME[key]); }
    });
  }

  strike(w: WorldScene, id: L): number {
    Audio.sfx(`lantern_tone_${id}`, { volume: 0.8 });
    this.flash(w, id, id);
    return LanternRig.duration(id);
  }

  /** The reference speaks: a call to attention, then the tone it is holding. */
  strikeReference(w: WorldScene, correct: L = TRUTH): number {
    Audio.sfx('lantern_tone_ref', { volume: 0.4 });
    const spr = this.sprite.ref;
    if (spr && w.anims.exists('reference_lantern_struck')) spr.play('reference_lantern_struck', true);
    w.time.delayedCall(240, () => Audio.sfx(`lantern_tone_${correct}`, { volume: 0.85 }));
    this.flash(w, 'ref', correct, 240);
    return LanternRig.duration(correct) + 240;
  }

  destroy(): void {
    Object.values(this.glow).forEach((g) => g?.destroy());
    this.glow = {};
    this.sprite = {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trial state
// ─────────────────────────────────────────────────────────────────────────────

interface RoundRecord {
  n: number;
  truth: L;
  group: L;
  /** Everyone's public answer this round. */
  answers: Record<string, L>;
  /** Who was seen changing their answer to match. */
  shifted: string[];
  player?: L;
  unanimous: boolean;
}

const S = {
  rig: null as LanternRig | null,
  started: false,
  finished: false,
  fast: false,
  round: 0,
  awaiting: 0,
  answers: {} as Record<string, L>,
  history: [] as RoundRecord[],
  record: null as RoundRecord | null,
  pending: null as ((a: L) => void) | null,
  heard: new Set<string>(),
  named: false,
  rosette: false,
};

const cleanup: Array<() => void> = [];

function sub(event: string, fn: (p: never) => void): void {
  cleanup.push(busOn(event, fn as (p: unknown) => void));
}

function resetState(): void {
  S.rig?.destroy();
  S.rig = null;
  S.started = false;
  S.finished = false;
  S.fast = false;
  S.round = 0;
  S.awaiting = 0;
  S.answers = {};
  S.history = [];
  S.record = null;
  S.pending = null;
  S.heard = new Set();
  S.named = false;
  S.rosette = false;
}

function headOf(w: WorldScene, id: string): { wx: number; wy: number } {
  const n = w.npc(id);
  return { wx: n?.x ?? 0, wy: (n?.y ?? 0) - 38 };
}

/**
 * Npc.update() turns idle characters to look around every few seconds, which is
 * right for a market and wrong for a ceremony: a directed facing would silently
 * un-set itself two seconds later. Freezing the participants for the duration is
 * what lets round three's turn-and-stare hold.
 */
function holdStill(w: WorldScene, ids: string[], ms = 10 * 60 * 1000): void {
  for (const id of ids) w.npc(id)?.freeze(ms);
}

function faceAll(w: WorldScene, ids: string[], dir: Dir): void {
  for (const id of ids) w.npc(id)?.face(dir);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bubbles, wired to the authored lines
// ─────────────────────────────────────────────────────────────────────────────

/** Raise (or move) one villager's public answer. */
function showVote(w: WorldScene, id: string, vote: Vote, changed = false): void {
  emit('trial:bubble', { id, answer: vote.says, changed, ...headOf(w, id) });
  S.answers[id] = vote.says;
  if (S.record) {
    S.record.answers[id] = vote.says;
    if (changed && !S.record.shifted.includes(id)) S.record.shifted.push(id);
  }
}

/**
 * A CutsceneLike that raises a speaker's vote bubble at the instant their line
 * lands, and — for the two who cave in round two — shows the honest answer, a
 * wobble, and then the group's answer, in that order. Watching an answer move is
 * the whole of round two; being told about it afterwards is not the same thing.
 */
function withVotes(c: CutsceneContext, w: WorldScene, votes: Record<string, Vote>): CutsceneLike {
  const said = new Set<string>();
  return {
    say: async (speaker, text, opts) => {
      const v = votes[speaker];
      if (v && !said.has(speaker)) {
        said.add(speaker);
        const npc = w.npc(speaker);
        if (v.from) {
          showVote(w, speaker, { says: v.from });
          await c.wait(S.fast ? 16 : 700);
          if (npc) w.fx.emote(npc.x, npc.y, 'sweat', 620);
          await c.wait(S.fast ? 16 : 240);
          showVote(w, speaker, v, true);
          await c.wait(S.fast ? 16 : 200);
        } else {
          showVote(w, speaker, v);
        }
      }
      if (S.fast) { await c.wait(1); return; }
      await c.say(speaker, text, opts);
    },
    choose: (prompt, choices) => (S.fast ? Promise.resolve(0) : c.choose(prompt, choices)),
    wait: (ms) => c.wait(S.fast ? Math.min(ms, 16) : ms),
    // Never skipped, even for the harness: the card is what unlocks the
    // journal entry, so a run that skipped it would not be a run of the quest.
    insight: (id) => c.insight(id),
    banner: (t, s2) => c.banner(t, s2),
  };
}

/** Everyone in this round's table who has not spoken yet answers now, silently. */
async function fillVotes(w: WorldScene, c: CutsceneContext, votes: Record<string, Vote>): Promise<void> {
  for (const [id, v] of Object.entries(votes)) {
    if (S.answers[id]) continue;
    showVote(w, id, v);
    await c.wait(S.fast ? 8 : 260);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The ceremony
// ─────────────────────────────────────────────────────────────────────────────

function askPlayer(mode: 'private' | 'public'): Promise<L> {
  return new Promise((resolve) => {
    S.awaiting = S.round;
    S.pending = (a: L) => { S.awaiting = 0; S.pending = null; resolve(a); };
    once('trial:answer', (p: { answer: L }) => S.pending?.(p.answer));
    emit('trial:ask', { mode });
  });
}

/** A murmur runs round the horseshoe when the newcomer speaks. */
function plazaReacts(w: WorldScene): void {
  Audio.sfx('ui_confirm', { volume: 0.3, rate: 0.8 });
  ['tavi', 'villager_c', 'villager_d'].forEach((id, i) => {
    const n = w.npc(id);
    if (!n) return;
    w.time.delayedCall(120 + i * 130, () => w.fx.emote(n.x, n.y, 'think', 520));
  });
}

/** Play an authored exchange with vote bubbles and the ceremony's cue handlers. */
function runExchange(
  w: WorldScene,
  c: CutsceneContext,
  source: Parameters<typeof playExchange>[1],
  votes: Record<string, Vote> = {},
  extraCues: Record<string, () => void | Promise<void>> = {},
): Promise<void> {
  return playExchange(withVotes(c, w, votes), source, {
    cue: async (name, note) => {
      const extra = extraCues[name];
      if (extra) { await extra(); return; }
      await defaultCue(w, c, name, note);
    },
  });
}

async function defaultCue(w: WorldScene, c: CutsceneContext, name: string, note?: string): Promise<void> {
  switch (name) {
    case 'tone_reference': {
      // Look at the lanterns while they speak...
      await c.panTo(23.5, FRAME_STAGE, S.fast ? 1 : 460);
      await c.wait(S.fast ? 16 : 260);
      await c.wait(S.fast ? 16 : S.rig!.strikeReference(w));
      await c.wait(S.fast ? 16 : 320);
      // ...and back to the people, who are the actual subject of this quest.
      await c.panTo(23.5, FRAME_GROUP, S.fast ? 1 : 460);
      break;
    }
    case 'tone_all': {
      await c.panTo(23.5, FRAME_STAGE, S.fast ? 1 : 460);
      for (const id of ['a', 'b', 'c'] as L[]) {
        await c.wait(S.fast ? 16 : S.rig!.strike(w, id));
        await c.wait(S.fast ? 8 : 220);
      }
      await c.panTo(23.5, FRAME_GROUP, S.fast ? 1 : 460);
      break;
    }
    case 'ability_grant':
      State.grant((note ?? 'dissent') as 'dissent');
      break;
    case 'festival_lights':
      w.fx.setAmbient('town_evening');
      break;
    default:
      break;
  }
}

function beginRound(n: number): void {
  S.round = n;
  S.answers = {};
  S.record = { n, truth: TRUTH, group: n === 1 ? TRUTH : GROUP, answers: {}, shifted: [], unanimous: false };
  emit('trial:clear', {});
  emit('trial:round', {
    n, total: 4,
    label: n === 1 ? 'nobody hears your answer' : n === 2 ? 'Tavi answers first' : 'you answer last',
  });
}

function recordPlayer(a: L): void {
  if (S.record) S.record.player = a;
}

function endRound(flag: string): void {
  const r = S.record;
  if (r) {
    const vals = Object.values(r.answers);
    r.unanimous = vals.length > 1 && vals.every((v) => v === vals[0]);
    S.history.push(r);
  }
  S.record = null;
  State.set(flag);
}

async function round1(w: WorldScene, c: CutsceneContext, beat: (ms: number) => Promise<void>): Promise<void> {
  beginRound(1);
  // The only round nobody can see. Whatever the player answers here is the thing
  // they will be asked to give up later, so it has to be theirs alone.
  await runExchange(w, c, TALK.q3.round1, {}, {
    trial_answer: async () => {
      const a = await askPlayer('private');
      recordPlayer(a);
      State.set('trial_r1_wrong', a !== TRUTH);
    },
  });
  await beat(300);
  // The slates come up only now, so nobody's answer could have swayed anybody.
  await fillVotes(w, c, VOTES[0]);
  await runExchange(w, c, TALK.q3.round1Result);
  endRound(FLAGS.trialR1);
}

async function round2(w: WorldScene, c: CutsceneContext, beat: (ms: number) => Promise<void>): Promise<void> {
  beginRound(2);
  await runExchange(w, c, TALK.q3.round2, VOTES[1], {
    trial_answer: async () => {
      await fillVotes(w, c, VOTES[1]);
      recordPlayer(await askPlayer('public'));
      plazaReacts(w);
    },
  });
  await beat(200);
  endRound(FLAGS.trialR2);
}

async function round3(w: WorldScene, c: CutsceneContext, beat: (ms: number) => Promise<void>): Promise<void> {
  beginRound(3);
  const cam = w.cameras.main;
  await runExchange(w, c, TALK.q3.round3, VOTES[2], {
    trial_answer: async () => {
      await fillVotes(w, c, VOTES[2]);
      // The pressure staging. All of it is about attention, none about threat:
      // eight people stop looking at the lanterns and look at you, the frame
      // tightens by a tenth, and then the game waits. There is no timer here,
      // and there must never be one.
      for (const id of PARTICIPANTS) w.npc(id)?.faceTowards(w.player.x, w.player.y);
      cam.zoomTo(1.10, S.fast ? 1 : 900, 'Sine.easeInOut', true);
      await c.panTo(23.5, FRAME_PRESSURE, S.fast ? 1 : 900);
      await beat(500);

      const answer = await askPlayer('public');
      recordPlayer(answer);
      // Checked against THE GROUP, never against the truth. Matching six wrong
      // people is what conforming means; being wrong is not.
      const conformed = answer === GROUP;
      State.set(FLAGS.playerConformed, conformed);
      State.set('q3_conformed', conformed);
      plazaReacts(w);

      faceAll(w, PARTICIPANTS, 'n');
      cam.zoomTo(1, S.fast ? 1 : 600, 'Sine.easeInOut', true);
      await c.panTo(23.5, FRAME_GROUP, S.fast ? 1 : 600);
    },
  });
  // Neither answer is congratulated and neither is corrected.
  await runExchange(w, c, TALK.q3.round3After);
  await beat(200);
  endRound(FLAGS.trialR3);
}

async function round4(w: WorldScene, c: CutsceneContext, beat: (ms: number) => Promise<void>): Promise<void> {
  beginRound(4);
  const beats = TALK.q3.round4.beats as Beat[];
  // Nia goes first and is wrong, three people immediately say something else,
  // and only then is the player asked — into a group that no longer agrees.
  // That is the controlled comparison with round three, so the split has to be
  // on screen before the prompt opens. Tavi's "Hold on—" is the seam.
  const cut = beats.findIndex((b) => b.kind === 'line' && b.speaker === 'tavi');
  const opening = cut > 0 ? beats.slice(0, cut) : beats;
  const closing = cut > 0 ? beats.slice(cut) : [];

  await runExchange(w, c, opening, VOTES[3]);
  State.set(FLAGS.niaDissented);
  await fillVotes(w, c, VOTES[3]);
  await beat(300);
  recordPlayer(await askPlayer('public'));
  plazaReacts(w);
  if (closing.length) await runExchange(w, c, closing, VOTES[3]);
  await beat(200);
  endRound(FLAGS.trialR4);
}

/**
 * The village-game stake. It attaches to turning up and answering four times in
 * front of everyone — never to being right — so it can never become a punishment
 * for conforming.
 */
function awardRosette(w: WorldScene, c: CutsceneContext): void {
  if (S.rosette) return;
  S.rosette = true;
  State.set('q3_rosette');
  w.prop('prize_ribbon')?.sprite.destroy();
  c.toast("Newcomer's Rosette");
  State.addNote('elia', "Gave you the Newcomer's Rosette for answering four times out loud.");
}

function startTrial(w: WorldScene, fast = false): void {
  if (S.started || S.finished) return;
  S.started = true;
  S.fast = fast;
  State.set(FLAGS.trialJoined);
  State.startQuest('q3_lanterns');
  State.advanceQuest('q3_lanterns', 'join');

  void w.cutscene.run(async (c) => {
    const cam = w.cameras.main;
    const beat = (ms: number) => c.wait(S.fast ? Math.min(ms, 16) : ms);

    // Take the stand. The player's spot is the open end of the horseshoe, which
    // is what makes them part of the group rather than an audience for it.
    cam.stopFollow();
    await c.movePlayer(23, 27.4, 92);
    c.face('player', 'n');
    holdStill(w, [...PARTICIPANTS, 'elia', 'sera']);
    faceAll(w, PARTICIPANTS, 'n');
    await c.panTo(23.5, FRAME_GROUP, S.fast ? 1 : 620);

    await runExchange(w, c, TALK.q3.trialRules);

    await round1(w, c, beat);
    await round2(w, c, beat);
    await round3(w, c, beat);
    await round4(w, c, beat);

    // ── the trial ends ─────────────────────────────────────────────────────
    emit('trial:end', {});
    await beat(400);
    awardRosette(w, c);
    cam.zoomTo(1, 380, 'Sine.easeInOut', true);
    c.followPlayer(420);
    // Give everyone their idle life back now the ceremony is over.
    holdStill(w, [...PARTICIPANTS, 'elia', 'sera'], 0);
    S.finished = true;
    State.set('q3_trial_done');
    State.advanceQuest('q3_lanterns', 'rounds');
    c.toast('Ask around');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Afterwards, and the naming moment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * After the trial each villager has one thing they want to say about it, and
 * then they go back to being themselves. Half of them knew and said second
 * anyway; the other half genuinely stopped trusting their own ears. Nobody
 * labels which they are, and the plaza's own ambient life takes over after.
 */
function afterLine(w: WorldScene, id: string): boolean {
  const key = AFTER[id];
  State.meet(id);
  if (key && !S.heard.has(id)) {
    S.heard.add(id);
    if (S.heard.size >= 3) State.set(FLAGS.villagersHonest);
    void w.cutscene.talk((c) => runExchange(w, c, TALK.q3[key]));
    return true;
  }
  const line = ambient(id);
  if (!line) return false;
  void w.cutscene.talk(async (c) => { await c.say(line.speaker, line.text, line); });
  return true;
}

function nameIt(w: WorldScene): boolean {
  if (S.named) return false;
  if (S.heard.size < 2) {
    void w.cutscene.talk(async (c) => {
      await c.say('sera', 'Not yet. Go and ask them what they heard.');
      await c.say('sera', 'Two or three of them. Their answers will not match.');
    });
    return true;
  }
  S.named = true;

  void w.cutscene.run(async (c) => {
    await runExchange(w, c, TALK.q3.naming);

    State.setAll(['q3_complete', FLAGS.q3Done, 'insight_conformity', FLAGS.southGateOpen]);
    State.addInsightExample(
      'conformity',
      'Round one, on your own slate, you heard the third lantern. So did almost everybody.',
    );
    State.addInsightExample(
      'conformity',
      State.has('q3_conformed')
        ? 'Round three: six people said second, you were asked last, and you said second too.'
        : 'Round three: six people said second, you were asked last, and you said third anyway.',
    );
    State.addInsightExample(
      'conformity',
      'Round four: Nia said first — also wrong — and three people immediately said third.',
    );
    State.addNote('nia', 'Broke a unanimous plaza by being wrong out loud.');
    State.addNote('tavi', 'Never once checked. Six people followed him anyway.');

    // DISSENT is granted by the `ability_grant` cue inside the exchange.
    await runExchange(w, c, TALK.q3.dissent);

    State.advanceQuest('q3_lanterns', 'after');
    State.completeQuest('q3_lanterns');
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Area script
// ─────────────────────────────────────────────────────────────────────────────

registerArea('festival', {
  onEnter(w) {
    resetState();
    // Evening life: fireflies over the crowd and drifting gold in the air.
    w.fx.setAmbient('town_evening');
    S.rig = new LanternRig(w);
    State.setAll(['festival_started', 'q3_started', FLAGS.festivalOpen]);
    State.startQuest('q3_lanterns');
    for (const id of ['tavi', 'nia', 'elia']) State.meet(id);

    if (State.has('q3_complete')) { S.started = true; S.finished = true; S.named = true; }
    else if (State.has('q3_trial_done')) { S.started = true; S.finished = true; }

    // The lanterns are mounted up on the stage posts, so the thing the player
    // walks up to is the deck edge below each one. Three anchors, 24px apart,
    // means standing in front of a post and pressing the button rings that
    // post's lantern — which is how the task gets learned before it matters.
    const strike = (id: L) => () => { if (!S.started) S.rig?.strike(w, id); };
    for (const id of ['a', 'b', 'c'] as L[]) {
      const p = w.prop(`lantern_${id}`);
      if (!p) continue;
      w.addInteractable({
        id: `trial_lantern_${id}`,
        x: p.sprite.x, y: 312,
        radius: 26,
        label: 'Strike', observable: true,
        forbids: 'q3_trial_done',
        onInteract: strike(id),
      });
    }
    const ref = w.prop('ref_lantern');
    if (ref) {
      w.addInteractable({
        id: 'trial_reference',
        x: ref.sprite.x, y: ref.sprite.y - 12,
        radius: 6,
        label: 'Strike', observable: true,
        forbids: 'q3_trial_done',
        onInteract: () => { if (!S.started) S.rig?.strikeReference(w); },
      });
    }

    // The prompt doubles as the instrument: the cursor sounds the lantern, and
    // the player may compare for as long as they like.
    sub('trial:preview', (p: { answer: L }) => S.rig?.strike(w, p.answer));
    sub('trial:replay', () => S.rig?.strikeReference(w));

    installHarness(w);
  },

  onTrigger(w, id) {
    if (id === 'festival_arrival') {
      State.set('q3_intro_done');
      void w.cutscene.run(async (c) => {
        c.banner('The Festival of Lanterns');
        await runExchange(w, c, TALK.q3.festivalOpen);
      });
      return true;
    }
    if (id === 'trial_ready') {
      if (S.started || S.finished) return false;
      startTrial(w);
      return true;
    }
    return false;
  },

  onInteract(w, id) {
    if (!id.startsWith('npc:')) return false;
    const who = id.slice(4);
    if (who === 'sera') {
      if (S.finished) return nameIt(w);
      void w.cutscene.talk(async (c) => {
        await c.say('sera', 'Go and play. I want to watch this one.');
      });
      return true;
    }
    if (S.finished) return afterLine(w, who);
    if (who === 'elia' && !S.started) { startTrial(w); return true; }
    // Before the ceremony everyone is just at a festival, and the town's own
    // ambient dialogue already covers that. Nothing is intercepted here.
    return false;
  },

  onExit() {
    cleanup.forEach((f) => f());
    cleanup.length = 0;
    delete (window as unknown as { __trial?: unknown }).__trial;
    resetState();
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// QA harness
// ─────────────────────────────────────────────────────────────────────────────

export interface TrialSnapshot {
  started: boolean;
  finished: boolean;
  round: number;
  /** Non-zero while the game is waiting for the player's answer in that round. */
  awaitingRound: number;
  truth: L;
  group: L;
  answers: Record<string, L>;
  unanimous: boolean;
  history: RoundRecord[];
  participants: string[];
  conformed: boolean;
  named: boolean;
  heard: string[];
}

function installHarness(w: WorldScene): void {
  const api = {
    /** Begin the ceremony. `fast` skips dialogue and shortens beats. */
    start(opts?: { fast?: boolean }) { startTrial(w, !!opts?.fast); },
    /** Answer the open prompt without synthesising key events. */
    answer(a: L) { emit('trial:answer', { answer: a }); },
    /** Strike a lantern, exactly as the prompt cursor does. */
    strike(a: L) { S.rig?.strike(w, a); },
    /** Run an NPC's post-trial conversation, as walking up and talking does. */
    talkTo(id: string) {
      if (id === 'sera') return nameIt(w);
      return afterLine(w, id);
    },
    snapshot(): TrialSnapshot {
      const vals = Object.values(S.answers);
      return {
        started: S.started,
        finished: S.finished,
        round: S.round,
        awaitingRound: S.awaiting,
        truth: TRUTH,
        group: GROUP,
        answers: { ...S.answers },
        unanimous: vals.length > 1 && vals.every((v) => v === vals[0]),
        history: S.history.map((h) => ({ ...h, answers: { ...h.answers }, shifted: [...h.shifted] })),
        participants: [...PARTICIPANTS],
        conformed: State.has('q3_conformed'),
        named: S.named,
        heard: [...S.heard],
      };
    },
  };
  (window as unknown as { __trial: typeof api }).__trial = api;
}
