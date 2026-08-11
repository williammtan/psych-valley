/**
 * ACT IV — the Festival of Lanterns and the Lantern Trial.
 *
 * The design rule this file exists to serve (plan.md §16) is that the player has
 * to *feel* the pressure, not answer a question about it. So:
 *
 *   THE TASK IS REAL.  Three lanterns each ring with their own tone; the
 *   reference lantern rings with one of them. Striking a lantern is free and
 *   unlimited — the answer prompt is also the instrument, and moving the cursor
 *   sounds that lantern. Anyone paying attention will be sure they are right.
 *   That certainty is the whole load-bearing beam: round three only hurts if you
 *   *know*.
 *
 *   THE FALLBACK CARRIES THE SAME INFORMATION AND NO MORE.  With sound off, a
 *   struck lantern flashes a pattern — two slow, three, or five quick, all over
 *   the same total time, so it is the rhythm that identifies it, never the
 *   duration. The reference flashes the matching lantern's rhythm in its *own*
 *   colour, never the matching lantern's colour: a silent player does the same
 *   comparison a hearing player does.
 *
 *   NOTHING IS PUNISHED.  Rounds two to four never announce who was right. The
 *   player's round-three answer sets one flag, `q3_conformed`, and that flag
 *   only changes what people say to them afterwards. Conforming is a reasonable
 *   bet and the game treats it as one.
 *
 *   TAVI IS NOT A VILLAIN (§27).  He is quick, warm, funny and never once
 *   entertains the possibility that he is wrong. He is liked. That is what makes
 *   him work.
 *
 * The words this quest is about appear nowhere until Sera's Insight Card.
 */
import Phaser from 'phaser';
import { DEPTH } from '@/core/config';
import { emit, once } from '@/core/events';
import { on as busOn } from '@/core/events';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { registerArea } from '../registry';
import { TRIAL_COLORS } from '../maps/festival';
import type { WorldScene } from '@/scenes/WorldScene';
import type { CutsceneContext, SayOptions } from '@/systems/Cutscene';

type L = 'a' | 'b' | 'c';

const PARTICIPANTS = ['tavi', 'villager_a', 'villager_b', 'villager_c', 'villager_d', 'villager_e', 'nia'];

/**
 * How a struck lantern flashes. Same total length, different rhythm — the rate
 * is the signal, so a silent player is doing a comparison, not reading a label.
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

interface Answer {
  id: string;
  says: L;
  /** The answer they give first, before visibly changing it. */
  from?: L;
  line?: [string, string];
  emote?: string;
}

interface RoundDef {
  n: number;
  correct: L;
  label: string;
  mode: 'private' | 'public';
  /** How many scripted answers land before the player is asked. */
  askAfter: number;
  script: Answer[];
  /** Round 1 only: the slips are read out after everyone has written. */
  reveal?: boolean;
}

/**
 * The four rounds of plan.md §16, as data. Only one thing changes between round
 * three and round four — whether anybody has broken ranks — which is what makes
 * the pair readable as an experiment the player lived through.
 */
const ROUNDS: RoundDef[] = [
  {
    n: 1, correct: 'b', mode: 'private', label: 'nobody hears your answer', askAfter: 0, reveal: true,
    script: [
      { id: 'tavi', says: 'b' }, { id: 'villager_a', says: 'b' }, { id: 'villager_b', says: 'b' },
      { id: 'villager_c', says: 'b' }, { id: 'villager_d', says: 'c' }, { id: 'villager_e', says: 'b' },
      { id: 'nia', says: 'b' },
    ],
  },
  {
    n: 2, correct: 'c', mode: 'public', label: 'Tavi answers first', askAfter: 4,
    script: [
      { id: 'tavi', says: 'a', line: ['tavi', 'First one. Not close.'], emote: 'excl' },
      { id: 'villager_a', says: 'a', from: 'c', line: ['villager_a', 'The first, then.'] },
      { id: 'villager_b', says: 'a' },
      { id: 'villager_c', says: 'a', from: 'c' },
      { id: 'villager_d', says: 'a' },
      { id: 'villager_e', says: 'c' },
      { id: 'nia', says: 'a' },
    ],
  },
  {
    n: 3, correct: 'a', mode: 'public', label: 'you answer last', askAfter: 7,
    script: [
      { id: 'tavi', says: 'c', line: ['tavi', 'Third. Easy.'], emote: 'excl' },
      { id: 'villager_a', says: 'c' },
      { id: 'villager_b', says: 'c' },
      { id: 'villager_c', says: 'c' },
      { id: 'villager_d', says: 'c' },
      { id: 'villager_e', says: 'c', from: 'a' },
      { id: 'nia', says: 'c' },
    ],
  },
  {
    n: 4, correct: 'c', mode: 'public', label: 'you answer last', askAfter: 7,
    script: [
      { id: 'tavi', says: 'b', line: ['tavi', 'Second.'] },
      { id: 'nia', says: 'a', line: ['nia', 'No. The first one.'], emote: 'excl' },
      { id: 'villager_a', says: 'c' },
      { id: 'villager_b', says: 'b' },
      { id: 'villager_c', says: 'c' },
      { id: 'villager_d', says: 'a' },
      { id: 'villager_e', says: 'c' },
    ],
  },
];

/** What people say afterwards. Two kinds of person, never labelled as such. */
const AFTERMATH: Record<string, string[]> = {
  tavi: ['Good trial. I was on form.', 'Third one, round three. I would say it again.'],
  nia: ['I only went first.', 'Then three others said something different. Odd, that.'],
  villager_a: ['Round three?', 'I had the first one. I just did not fancy being the only hand up.'],
  villager_b: ['I would have sworn it was the first.', 'But that many people... I stopped trusting my own ears.'],
  villager_c: ['I knew.', 'I was not going to be the one, though.'],
  villager_d: ['Six people cannot all be wrong.', 'Can they?'],
  villager_e: ['I held out a round.', 'Then I felt silly, so I stopped.'],
  elia: ['Same every year.', 'Every single year, and I still cannot predict it.'],
  mira: ['Skewer? They are good this year.'],
  oren: ['I am not playing. I have had enough of trusting my own head this week.'],
  villager_f: ['One more set and I am done. Three days of tuning for this.'],
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
      const img = w.add.image(p.sprite.x, p.sprite.y - (key === 'ref' ? 34 : 26), 'atlas', 'fx/light_soft_128')
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

  /** Total time a strike takes, so the ceremony can wait for it. */
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
        w.tweens.add({ targets: img, alpha: 0.95, duration: Math.round(gap * 0.2), yoyo: true, hold: Math.round(gap * 0.08), ease: 'Quad.easeOut' });
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
  strikeReference(w: WorldScene, correct: L): number {
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
  correct: L;
  tavi: L;
  /** Everyone's final public answer this round. */
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
  correct: 'b' as L,
  awaiting: 0,
  answers: {} as Record<string, L>,
  history: [] as RoundRecord[],
  pending: null as ((a: L) => void) | null,
  talkedTo: new Set<string>(),
  named: false,
};

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
  S.pending = null;
  S.talkedTo = new Set();
  S.named = false;
}

function head(w: WorldScene, id: string): { wx: number; wy: number } {
  const n = w.npc(id);
  return { wx: n?.x ?? 0, wy: (n?.y ?? 0) - 38 };
}

// ─────────────────────────────────────────────────────────────────────────────
// The ceremony
// ─────────────────────────────────────────────────────────────────────────────

function startTrial(w: WorldScene, fast = false): void {
  if (S.started || S.finished) return;
  S.started = true;
  S.fast = fast;
  State.startQuest('q3_lanterns');
  State.advanceQuest('q3_lanterns', 'join');

  void w.cutscene.run(async (c) => {
    const say = (who: string, text: string, opts?: SayOptions) => (S.fast ? c.wait(1) : c.say(who, text, opts));
    const beat = (ms: number) => c.wait(S.fast ? Math.min(ms, 16) : ms);
    const cam = w.cameras.main;

    // Take the stand. The player's spot is the mouth of the arc, which is what
    // makes them part of the group rather than an audience for it.
    cam.stopFollow();
    await c.movePlayer(23, 25, 92);
    c.face('player', 'n');
    for (const id of PARTICIPANTS) w.npc(id)?.face('n');
    await c.panTo(23.5, 23, S.fast ? 1 : 620);

    await say('elia', 'Everyone! Four rounds. Ears open.');
    await say('tavi', "Four? I'll take all four.");
    await say('villager_a', 'You said that last year, Tavi.');
    await say('tavi', 'And I was right last year.');
    await say('elia', 'You were right twice.');

    for (const r of ROUNDS) await runRound(w, c, r, say, beat);

    // ── the trial ends ─────────────────────────────────────────────────────
    emit('trial:end', {});
    await beat(400);
    await say('elia', "That's the trial. Thank you, all.");
    await say('elia', 'Stay. Eat something. Argue about it.');

    cam.zoomTo(1, 380, 'Sine.easeInOut', true);
    c.followPlayer(420);
    S.finished = true;
    State.set('q3_trial_done');
    State.advanceQuest('q3_lanterns', 'rounds');
    c.toast('Ask around');
  });
}

async function runRound(
  w: WorldScene,
  c: CutsceneContext,
  r: RoundDef,
  say: (who: string, text: string, opts?: SayOptions) => Promise<void>,
  beat: (ms: number) => Promise<void>,
): Promise<void> {
  const cam = w.cameras.main;
  S.round = r.n;
  S.correct = r.correct;
  S.answers = {};
  const rec: RoundRecord = { n: r.n, correct: r.correct, tavi: r.script[0].says, answers: {}, shifted: [], unanimous: false };

  emit('trial:clear', {});
  emit('trial:round', { n: r.n, total: ROUNDS.length, label: r.label });
  await beat(520);

  if (r.n === 1) await say('elia', 'Round one. Write it down. No calling out.');
  if (r.n === 2) await say('elia', 'Round two. Out loud this time. Tavi, you start.');
  if (r.n === 3) await say('elia', "Round three. We'll come to you last.");
  if (r.n === 4) await say('elia', 'Last round. Same as before.');

  await beat(300);
  await c.wait(S.fast ? 16 : S.rig!.strikeReference(w, r.correct));
  await beat(520);

  const speak = async (e: Answer) => {
    const npc = w.npc(e.id);
    if (npc) npc.face('n');
    if (e.from) {
      // Their honest answer, a visible wobble, and then the group's answer.
      emit('trial:bubble', { id: e.id, answer: e.from, ...head(w, e.id) });
      await beat(760);
      if (npc) w.fx.emote(npc.x, npc.y, 'sweat', 620);
      await beat(220);
      emit('trial:bubble', { id: e.id, answer: e.says, changed: true, ...head(w, e.id) });
      rec.shifted.push(e.id);
    } else {
      emit('trial:bubble', { id: e.id, answer: e.says, ...head(w, e.id) });
    }
    if (e.emote && npc) w.fx.emote(npc.x, npc.y, e.emote, 700);
    S.answers[e.id] = e.says;
    rec.answers[e.id] = e.says;
    if (e.line) await say(e.line[0], e.line[1]);
    await beat(420);
  };

  const ask = async (): Promise<void> => {
    if (r.n === 3) {
      // The pressure staging. Everything here is about attention, not threat:
      // the group turns, the frame tightens, and then the game waits. No timer.
      for (const id of PARTICIPANTS) w.npc(id)?.faceTowards(w.player.x, w.player.y);
      cam.zoomTo(1.12, S.fast ? 1 : 900, 'Sine.easeInOut', true);
      await c.panTo(23.5, 24.4, S.fast ? 1 : 900);
      await beat(500);
      await say('elia', 'And you?');
      await beat(400);
    } else if (r.mode === 'public') {
      await say('elia', 'And you?');
    }
    const answer = await askPlayer(r);
    rec.player = answer;
    if (r.n === 3) {
      const group = rec.tavi;
      State.set('q3_conformed', answer === group);
      // Deliberately neutral. Neither answer is congratulated or corrected.
      await beat(300);
      await say('elia', 'Noted.');
      if (answer === group) await say('tavi', 'See? Everyone hears it.');
      else await say('tavi', 'Huh.');
      for (const id of PARTICIPANTS) w.npc(id)?.face('n');
      cam.zoomTo(1, S.fast ? 1 : 600, 'Sine.easeInOut', true);
      await c.panTo(23.5, 23, S.fast ? 1 : 600);
    }
  };

  for (let i = 0; i < r.script.length; i++) {
    if (i === r.askAfter) await ask();
    await speak(r.script[i]);
  }
  if (r.askAfter >= r.script.length) await ask();

  const vals = Object.values(rec.answers);
  rec.unanimous = vals.length > 1 && vals.every((v) => v === vals[0]);

  if (r.reveal) {
    // Round one, and only round one, tells the player they were right. After
    // this the game never grades an answer again.
    await beat(400);
    await say('elia', 'Slips in. Let me read them out.');
    for (const e of r.script) {
      emit('trial:bubble', { id: e.id, answer: e.says, ...head(w, e.id) });
      S.answers[e.id] = e.says;
      await beat(240);
    }
    await beat(400);
    await say('elia', 'The second lantern. Almost everyone.');
    await say('tavi', 'Told you. Easy.');
  }

  S.history.push(rec);
  await beat(700);
}

function askPlayer(r: RoundDef): Promise<L> {
  return new Promise((resolve) => {
    S.awaiting = r.n;
    S.pending = (a: L) => { S.awaiting = 0; S.pending = null; resolve(a); };
    once('trial:answer', (p: { answer: L }) => S.pending?.(p.answer));
    emit('trial:ask', { mode: r.mode });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Afterwards, and the naming moment
// ─────────────────────────────────────────────────────────────────────────────

function afterLine(w: WorldScene, id: string): boolean {
  const lines = AFTERMATH[id];
  if (!lines) return false;
  S.talkedTo.add(id);
  State.meet(id);
  void w.cutscene.talk(async (c) => {
    for (const l of lines) await c.say(id, l);
    if (id === 'tavi' && State.has('q3_conformed')) await c.say('tavi', 'You had it too. Good ear.');
    if (id === 'tavi' && !State.has('q3_conformed')) await c.say('tavi', 'You said something else in three. Bold.');
    if (id === 'nia' && !State.has('q3_conformed')) await c.say('nia', 'You went first, once. I noticed.');
  });
  return true;
}

function nameIt(w: WorldScene): boolean {
  if (S.named) return false;
  const asked = [...S.talkedTo].filter((id) => id !== 'sera' && AFTERMATH[id]).length;
  if (asked < 2) {
    void w.cutscene.talk(async (c) => {
      await c.say('sera', 'Not yet. Go and ask them what they heard.');
      await c.say('sera', 'Two or three. Their answers will not match.');
    });
    return true;
  }
  S.named = true;

  void w.cutscene.run(async (c) => {
    const conformed = State.has('q3_conformed');
    await c.say('sera', 'Round three.');
    if (conformed) {
      await c.say('player', 'I said what they said.');
      await c.say('sera', 'I know. I was watching your face.');
      await c.say('sera', 'Did you believe it?');
      await c.say('player', 'No.');
    } else {
      await c.say('player', 'I said the first one.');
      await c.say('sera', 'On your own, with seven people looking at you.');
      await c.say('player', 'It was harder than it should have been.');
    }
    await c.say('sera', 'Nobody argued with you. Nobody had to.');
    await c.say('sera', 'It was the agreeing that did it.');
    await c.say('sera', 'Then Nia said one word in round four.');
    await c.say('sera', 'She was wrong, by the way.');
    await c.say('sera', 'It made no difference. Three people spoke up anyway.');
    await c.say('sera', 'People adjust what they say — and what they think they heard —');
    await c.say('sera', 'to match a group. Most of all when the group agrees completely.');

    await c.insight('conformity');

    State.setAll(['q3_complete', 'insight_conformity', 'south_gate_open']);
    State.grant('dissent');
    State.addInsightExample(
      'conformity',
      'Round three: seven people named the third lantern. It was the first.',
    );
    State.addInsightExample(
      'conformity',
      State.has('q3_conformed')
        ? 'You were asked last, and you said the third one too.'
        : 'You were asked last, and you said the first one anyway.',
    );
    State.addInsightExample(
      'conformity',
      'Round four: Nia broke the agreement and three others changed their answers.',
    );
    State.advanceQuest('q3_lanterns', 'after');
    State.completeQuest('q3_lanterns');
    State.addNote('nia', 'Broke a unanimous group by being wrong out loud.');
    State.addNote('tavi', 'Never once checked. Everyone followed him anyway.');

    await c.say('sera', 'Break the agreement and the group stops holding.');
    await c.say('sera', 'That is worth knowing where we are going.');
    await c.say('sera', 'The south road is clear. Whenever you are ready.');
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
    State.setAll(['festival_started', 'q3_started']);
    State.startQuest('q3_lanterns');
    for (const id of ['tavi', 'nia', 'elia']) State.meet(id);

    if (State.has('q3_complete')) { S.started = true; S.finished = true; S.named = true; }

    // Before the ceremony, the lanterns are yours to play with. Learning the
    // task while nobody is watching is the point of round one, and this is
    // where it actually starts.
    const strike = (id: L) => () => { if (!S.started) S.rig?.strike(w, id); };
    for (const id of ['a', 'b', 'c'] as L[]) {
      const p = w.prop(`lantern_${id}`);
      if (!p) continue;
      w.addInteractable({
        id: `trial_lantern_${id}`,
        x: p.sprite.x, y: p.sprite.y - 20,
        label: 'Strike', observable: true,
        forbids: 'q3_trial_done',
        onInteract: strike(id),
      });
    }
    const ref = w.prop('ref_lantern');
    if (ref) {
      w.addInteractable({
        id: 'trial_reference',
        x: ref.sprite.x, y: ref.sprite.y - 24,
        label: 'Strike', observable: true,
        forbids: 'q3_trial_done',
        onInteract: () => { if (!S.started) S.rig?.strikeReference(w, S.correct); },
      });
    }

    // The prompt doubles as the instrument: the cursor sounds the lantern.
    const offPreview = on2('trial:preview', (p: { answer: L }) => S.rig?.strike(w, p.answer));
    const offReplay = on2('trial:replay', () => S.rig?.strikeReference(w, S.correct));
    cleanup.push(offPreview, offReplay);

    installHarness(w);
  },

  onTrigger(w, id) {
    if (id === 'festival_arrival') {
      State.set('q3_intro_done');
      void w.cutscene.run(async (c) => {
        c.banner('The Festival of Lanterns');
        await c.say('elia', 'There you are. We were about to start without you.');
        await c.say('elia', 'The Lantern Trial. Old game, one rule.');
        await c.say('elia', 'A lantern is struck. You say which of the three matched it.');
        await c.say('elia', 'Go and listen to them. Then stand with the others.');
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
    if (who === 'elia' && !S.started && !S.finished) { startTrial(w); return true; }
    if (who === 'sera' && S.finished) return nameIt(w);
    if (who === 'sera') {
      void w.cutscene.talk(async (c) => {
        await c.say('sera', 'Go and play. I want to watch this one.');
      });
      return true;
    }
    if (S.finished) return afterLine(w, who);
    if (AFTERMATH[who]) {
      void w.cutscene.talk(async (c) => {
        await c.say(who, who === 'tavi' ? "Stand where you can hear. You'll want to." : 'It starts in a moment.');
      });
      return true;
    }
    return false;
  },

  onExit() {
    cleanup.forEach((f) => f());
    cleanup.length = 0;
    delete (window as unknown as { __trial?: unknown }).__trial;
    resetState();
  },
});

/** `on` that returns its unsubscribe, kept local so onExit can tear down cleanly. */
const cleanup: Array<() => void> = [];
function on2(event: string, fn: (p: never) => void): () => void {
  const off = busOn(event, fn as (p: unknown) => void);
  cleanup.push(off);
  return off;
}

// ─────────────────────────────────────────────────────────────────────────────
// QA harness
// ─────────────────────────────────────────────────────────────────────────────

export interface TrialSnapshot {
  started: boolean;
  finished: boolean;
  round: number;
  /** Non-zero while the game is waiting for the player's answer in that round. */
  awaitingRound: number;
  correct: L;
  answers: Record<string, L>;
  unanimous: boolean;
  history: RoundRecord[];
  participants: string[];
  conformed: boolean;
  named: boolean;
}

function installHarness(w: WorldScene): void {
  const api = {
    /** Begin the ceremony. `fast` skips dialogue and shortens beats. */
    start(opts?: { fast?: boolean }) { startTrial(w, !!opts?.fast); },
    /** Answer the open prompt without synthesising key events. */
    answer(a: L) { emit('trial:answer', { answer: a }); },
    /** Strike a lantern, exactly as the prompt cursor does. */
    strike(a: L) { S.rig?.strike(w, a); },
    /** Run an NPC's post-trial line, exactly as walking up and talking does. */
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
        correct: S.correct,
        answers: { ...S.answers },
        unanimous: vals.length > 1 && vals.every((v) => v === vals[0]),
        history: S.history.map((h) => ({ ...h, answers: { ...h.answers }, shifted: [...h.shifted] })),
        participants: [...PARTICIPANTS],
        conformed: State.has('q3_conformed'),
        named: S.named,
      };
    },
  };
  (window as unknown as { __trial: typeof api }).__trial = api;
}
