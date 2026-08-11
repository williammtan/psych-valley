/**
 * THE LANTERN INN — area script. QUEST ONE: THE BELL AND THE CAT.
 *
 * ── the shape of it ────────────────────────────────────────────────────────
 *
 *   SETUP        The bell rings. Pip leaves the hearth rug at speed and wedges
 *                himself under the settle that is holding Mira's storeroom
 *                shut. Mira offers one sentence of explanation and no theory.
 *
 *   INVESTIGATE  Four things in this building, none of which say anything about
 *                cats: a new pipe run, a basket nobody has slept in, claw marks
 *                pointing at one dark gap, and Mira's account of four nights.
 *                The player assembles bell → crash → repeat → pipes fixed →
 *                cat still hiding. Nothing in the text does it for them.
 *
 *   PUZZLE       The player rings a hand bell near Pip and then has to make
 *                nothing happen for two seconds. Four of those and he comes out.
 *                One scare inside the window and the whole thing resets, because
 *                a bell that predicts a bang is exactly what put him under there.
 *
 *   NAME         Sera, who has been watching, gets the player to say it, agrees,
 *                and only then does the word appear.
 *
 * ── why the puzzle is a puzzle ─────────────────────────────────────────────
 *
 * The mechanic is not "press the button four times". It is:
 *
 *   1. RANGE.    He has to hear it. Rings outside `BELL_RANGE` do nothing at
 *                all, and the expanding ring shows exactly how far that is.
 *   2. SILENCE.  The two seconds after a ring belong to the player. The tower
 *                bell is on a fifteen-second clock and it is the loudest thing
 *                in the valley, so the real skill is reading the hour and
 *                ringing in the gaps.
 *   3. RESTRAINT. The player has a sword and a rack of hanging pots, and both
 *                undo the work. Knowing that, and then not doing it, is the
 *                whole of the understanding being tested.
 *
 * Strip every psychological word out of this file and it is still a puzzle
 * about a frightened animal, a bell, and keeping a room quiet. That is the
 * test the design has to pass, so it is the one this file is written against.
 *
 * All player-visible text comes from `@/data/dialogue`. The two placeholder
 * runs below are marked TODO(dialogue) and belong in `quest1_bell.ts`.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { State } from '@/core/state';
import { emit, on } from '@/core/events';
import { Audio } from '@/audio/Audio';
import { hasFrame } from '@/core/textures';
import { Pip } from '@/entities/Pip';
import { Lure } from '@/systems/Abilities';
import {
  FLAGS, TALK, ambient, describe, group, nar, play, say,
  type Beat, type Exchange, type ResolvedBeat,
} from '@/data/dialogue';
import type { CutsceneContext } from '@/systems/Cutscene';
import type { WorldScene } from '@/scenes/WorldScene';
import { tileIndex } from '../art';
import { registerArea } from '../registry';

// ── tuning ──────────────────────────────────────────────────────────────────

/** Where Pip is when the bell goes, and where he ends up. */
const RUG: [number, number] = [5, 6.4];
const HIDE: [number, number] = [21.5, 9];
/** The route he takes to get there — through the arch, at speed. */
const BOLT_PATH: Array<[number, number]> = [[8, 7], [13, 8.6], [17, 9], [20.4, 9]];

/** How far the hand bell carries, in pixels. Shown by the ring, never stated. */
const BELL_RANGE = 78;
/** A scare inside this window after a ring re-pairs the two. */
const PAIR_WINDOW = 2200;
const RING_COOLDOWN = 2700;
/** The tower's clock, and how long before a toll you can hear it coming. */
const TOWER_PERIOD = 15000;
const TOWER_TELEGRAPH = 3300;
/** Four safe rings, as Sera counts them in q1.naming. */
const RINGS_TO_CALM = 4;
const FEAR_PER_RING = 100 / RINGS_TO_CALM;

/** Pixels. An attack this close to Pip counts as something frightening. */
const ATTACK_RANGE = 120;

const WINDOW_PX: [number, number] = [8.5 * TILE + 8, 2 * TILE + 10];
const CALM_RINGS = 'q1_calm_rings';
/** TODO(dialogue): promote to FLAGS once quest1_bell.ts owns it. */
const ASKED_MIRA = 'clue_mira_pipes';

// ── runtime ─────────────────────────────────────────────────────────────────

interface Pending {
  at: number;
  /** Was Pip inside the bell's range when it rang? */
  heard: boolean;
}

interface Runtime {
  pip: Pip;
  bell: Lure | null;
  prompt?: Phaser.GameObjects.Image;
  ringReadyAt: number;
  pending: Pending | null;
  calmRings: number;
  towerAt: number;
  telegraphed: boolean;
  spoiledOnce: boolean;
  busy: boolean;
  lastProgressAt: number;
  hintStage: number;
  nextHintAt: number;
  followUntil: number;
  offs: Array<() => void>;
}

let R: Runtime | null = null;

const questDone = (): boolean => State.has(FLAGS.q1Done) || !!State.quests.q1_pip?.complete;
const hasBell = (): boolean => State.has(FLAGS.haveHandBell);

/** Clues found, out of the five the player can reach. */
function clueCount(): number {
  return [FLAGS.cluePipes, FLAGS.clueScratches, FLAGS.clueCatBed, FLAGS.clueBellLog, ASKED_MIRA]
    .filter((f) => State.has(f)).length;
}

// ── dialogue playback ───────────────────────────────────────────────────────

type CueHandler = (name: string, note?: string) => void | Promise<void>;

/** Walk a resolved run of beats through the cutscene director. */
async function runBeats(c: CutsceneContext, beats: ResolvedBeat[], cues?: CueHandler): Promise<void> {
  for (const b of beats) {
    switch (b.kind) {
      case 'line':
        await c.say(b.speaker, b.text, { emote: b.emote, auto: b.auto, emphasis: b.emphasis });
        break;
      case 'choose': {
        const i = await c.choose(b.prompt ?? '', b.options.map((o) => ({ text: o.text, flag: o.flag })));
        const chosen = b.options[i] ?? b.options[0];
        if (chosen?.flag) State.set(chosen.flag);
        if (chosen?.reply?.length) await runBeats(c, chosen.reply as ResolvedBeat[], cues);
        break;
      }
      case 'pause': await c.wait(b.ms); break;
      case 'insight': await c.insight(b.concept); break;
      case 'banner': c.banner(b.title, b.subtitle); await c.wait(1100); break;
      case 'cue': await cues?.(b.name, b.note); break;
      default: break;
    }
  }
}

/** Play a run of beats as a scene, with the world locked. */
async function scene(w: WorldScene, source: Exchange | Beat[], cues?: CueHandler): Promise<void> {
  if (!R || R.busy) return;
  R.busy = true;
  try {
    await w.cutscene.run(async (c) => { await runBeats(c, play(source), cues); });
  } finally {
    if (R) { R.busy = false; R.lastProgressAt = w.time.now; }
  }
}

// ── effects ─────────────────────────────────────────────────────────────────

/**
 * The bell's voice, drawn. The ring expands to exactly `radius`, so a player
 * who has watched it once knows whether Pip is inside it or not without being
 * told. That is the difference between a mechanic and a guessing game.
 */
function ringFx(w: WorldScene, x: number, y: number, radius: number, tint?: number, alpha = 0.85): void {
  if (!hasFrame(w, 'fx/bell_small_0')) return;
  const s = w.add.sprite(Math.round(x), Math.round(y), 'atlas', 'fx/bell_small_0')
    .setDepth(DEPTH.LIGHT - 2)
    .setAlpha(alpha)
    .setScale(0.3);
  if (tint) s.setTint(tint);
  if (w.anims.exists('fx_bell_small')) s.play('fx_bell_small');
  w.tweens.add({
    targets: s,
    scale: radius / 20,
    alpha: 0,
    duration: 640,
    ease: 'Cubic.easeOut',
    onComplete: () => s.destroy(),
  });
}

/** A small floating bell glyph — the hint system's only vocabulary. */
function bellGlyph(w: WorldScene, x: number, y: number, to?: { x: number; y: number }): void {
  if (!hasFrame(w, 'prop/town/bell_small')) return;
  const s = w.add.image(Math.round(x), Math.round(y - 18), 'atlas', 'prop/town/bell_small')
    .setDepth(DEPTH.HUD - 10)
    .setAlpha(0)
    .setScale(0.9);
  w.tweens.add({ targets: s, alpha: 1, duration: 240 });
  w.tweens.add({
    targets: s,
    x: to ? to.x : s.x,
    y: to ? to.y - 24 : s.y - 6,
    alpha: 0,
    delay: to ? 260 : 900,
    duration: to ? 1100 : 500,
    ease: 'Sine.easeInOut',
    onComplete: () => s.destroy(),
  });
}

// ── the quest ───────────────────────────────────────────────────────────────

registerArea('inn', {
  onEnter(w) {
    const done = questDone();
    const started = State.has(FLAGS.q1Started);
    const calm = State.has(FLAGS.pipCalm);

    const rings = Math.min(RINGS_TO_CALM, State.count(CALM_RINGS));
    const pip = new Pip(w, RUG[0], RUG[1], { facing: 's', wander: done || calm });

    R = {
      pip,
      bell: null,
      ringReadyAt: 0,
      pending: null,
      calmRings: rings,
      towerAt: w.time.now + TOWER_PERIOD,
      telegraphed: false,
      spoiledOnce: State.has(FLAGS.bellSpoiled),
      busy: false,
      lastProgressAt: w.time.now,
      hintStage: 0,
      nextHintAt: 0,
      followUntil: 0,
      offs: [],
    };

    // Pip is either on the rug waiting for a bell, or already under the settle
    // with however much progress the player made before they last left.
    if (started && !calm && !done) {
      pip.setFear(100 - rings * FEAR_PER_RING);
      pip.hideUnder(HIDE[0], HIDE[1], 's');
    }

    // Crates and settle carry their collision here rather than in the map,
    // because Mira shifts both of them at the end and static solids cannot be
    // taken back off the grid.
    if (!calm && !done) {
      w.setDynamicSolidRect(21, 6, 3, 2, true);
      w.setDynamicSolidRect(21, 9, 2, 2, true);
    } else {
      openStoreroom(w, true);
    }

    // If the player already has the bell, put it back in their hand.
    if (hasBell() && !done) giveBell(w, false);
    else if (!done) addBellPickup(w);

    // The claw marks have no prop — they are a place on the floor, which is the
    // point of them.
    w.addInteractable({
      id: 'clue.scratches',
      x: HIDE[0] * TILE + 8,
      y: HIDE[1] * TILE + 24,
      radius: 8,
      label: 'Look',
      observable: true,
      forbids: FLAGS.pipCalm,
    });

    // Pip himself, wherever he currently is.
    w.addInteractable({
      id: 'inn.pip',
      x: pip.x,
      y: pip.y - 6,
      radius: 6,
      label: 'Look',
      observable: true,
      follow: pip.sprite,
    });

    const offAttack = on('player:attack', (p: { x: number; y: number }) => {
      if (!R || R.busy) return;
      if (Math.hypot(p.x - R.pip.x, p.y - R.pip.y) > ATTACK_RANGE) return;
      startle(w, 'attack');
    });
    R.offs.push(offAttack);

    installQaHook(w);
  },

  onExit(w) {
    R?.offs.forEach((off) => off());
    R?.bell?.destroy();
    R?.prompt?.destroy();
    // Sprites are destroyed by the scene teardown; drop our handle to them.
    R = null;
    void w;
  },

  onTrigger(w, id) {
    if (id !== 'q1_intro') return false;
    if (State.has(FLAGS.q1Started) || questDone()) return false;
    void intro(w);
    return true;
  },

  onUpdate(w, dt) {
    const rt = R;
    if (!rt) return;
    const now = w.time.now;
    const grid = w.collisionGrid();

    rt.pip.update(dt, grid);
    rt.bell?.update(dt, w.cues);
    updatePrompt(w);

    // Nothing on a clock runs during a scene: being interrupted by the tower
    // while you are reading dialogue is not a skill test, it is an ambush.
    if (rt.busy || w.cutscene.active) {
      rt.towerAt = Math.max(rt.towerAt, now + 1200);
      return;
    }

    if (!questDone()) {
      towerClock(w, now);
      resolvePending(w, now);
      if (hasBell() && w.keys.justPressed('interact') && !w.interactions.target) ringBell(w);
      hints(w, now);
    } else if (hasBell() && w.keys.justPressed('interact') && !w.interactions.target) {
      ringBell(w);
    }

    // The inversion: once he is calm the bell is something he comes towards.
    if (State.has(FLAGS.pipCalm) && rt.bell) {
      if (now < rt.followUntil) rt.pip.follow(rt.bell);
      else rt.pip.follow(null);
    }
  },

  onInteract(w, id) {
    const rt = R;
    if (!rt || rt.busy) return false;

    switch (id) {
      case 'inn.handbell':
        void takeBell(w);
        return true;

      case 'clue.pipes':
        void clue(w, TALK.q1.cluePipes, FLAGS.cluePipes, true);
        return true;

      case 'clue.scratches':
        void clue(w, TALK.q1.clueScratches, FLAGS.clueScratches, false);
        return true;

      case 'clue.catbed':
        void clue(w, TALK.q1.clueCatBed, FLAGS.clueCatBed, false);
        return true;

      case 'inn.pots':
        knockPots(w);
        return true;

      case 'inn.pip':
        void lookAtPip(w);
        return true;

      case 'prop.innCrates':
        void scene(w, describe(State.has(FLAGS.pipCalm) ? 'prop.storeroom' : 'prop.innCrates') ?? []);
        return true;

      case 'npc:mira':
        void talkToMira(w);
        return true;

      case 'npc:sera':
        void talkTo(w, 'sera');
        return true;

      case 'npc:villager_a':
      case 'npc:villager_f':
        void talkTo(w, id.slice(4));
        return true;

      default: {
        // Everything else with an `interact` id is a look-at from the
        // environment dialogue: one short line, no ceremony.
        const beats = describe(id);
        if (!beats) return false;
        void scene(w, beats);
        return true;
      }
    }
  },
});

// ── setup ───────────────────────────────────────────────────────────────────

function addBellPickup(w: WorldScene): void {
  const p = w.prop('handbell');
  if (!p) return;
  w.addInteractable({
    id: 'inn.handbell',
    x: p.sprite.x,
    y: p.sprite.y - 6,
    radius: 10,
    label: 'Take',
    observable: true,
    requires: FLAGS.q1Started,
  });
}

/** Put the bell in the player's hand as a carried lure. */
function giveBell(w: WorldScene, announce: boolean): void {
  if (!R || R.bell) return;
  w.prop('handbell')?.sprite.setVisible(false);
  w.interactions.remove('inn.handbell');
  const lure = new Lure(w, 'bell', 13, 5, { idle: 'prop/town/bell_small' });
  lure.pickUp();
  R.bell = lure;
  if (announce) Audio.sfx('pickup', { volume: 0.5 });
}

async function takeBell(w: WorldScene): Promise<void> {
  await scene(w, TALK.q1.clueHandBell);
  State.set(FLAGS.haveHandBell);
  giveBell(w, true);
  State.advanceQuest('q1_pip', 'investigate');
  await maybeSera(w);
}

/** The interact glyph over the bell, so nobody has to be told it rings. */
function updatePrompt(w: WorldScene): void {
  const rt = R;
  if (!rt) return;
  const show = !!rt.bell && !w.cutscene.active && !rt.busy && !w.interactions.target;
  if (!show) { rt.prompt?.setVisible(false); return; }
  if (!rt.prompt) {
    if (!hasFrame(w, 'ui/key_space')) return;
    rt.prompt = w.add.image(0, 0, 'atlas', 'ui/key_space').setOrigin(0.5, 1).setDepth(DEPTH.HUD - 20);
  }
  rt.prompt.setVisible(true);
  rt.prompt.setPosition(Math.round(rt.bell!.x), Math.round(rt.bell!.y - 12));
}

// ── setup beat ──────────────────────────────────────────────────────────────

async function intro(w: WorldScene): Promise<void> {
  if (!State.has(FLAGS.metMira)) {
    await scene(w, TALK.mira.firstMeeting);
    State.set(FLAGS.metMira);
    State.meet('mira');
  }
  await scene(w, TALK.arrival.bell, (name) => {
    if (name === 'bell_toll') towerToll(w, false);
    if (name === 'pip_bolt') {
      R?.pip.setFear(100);
      R?.pip.bolt(BOLT_PATH, HIDE[0], HIDE[1], 's');
      State.set(FLAGS.pipBolted);
    }
    if (name === 'quest_start') {
      State.setAll([FLAGS.bellRang, FLAGS.q1Started]);
      State.startQuest('q1_pip');
      State.advanceQuest('q1_pip', 'find_pip');
      State.meet('pip');
    }
  });
  if (R) R.towerAt = w.time.now + TOWER_PERIOD * 1.5;
}

// ── investigation ───────────────────────────────────────────────────────────

async function clue(w: WorldScene, ex: Exchange, flag: string, important: boolean): Promise<void> {
  const first = !State.has(flag);
  if (first && important) w.mote?.react('curious', 1600);
  await scene(w, ex);
  if (!first) return;
  State.set(flag);
  State.bump('clues_found');
  Audio.sfx('recall', { volume: 0.45 });
  State.advanceQuest('q1_pip', 'find_pip');
  if (clueCount() >= 3) State.advanceQuest('q1_pip', 'investigate');
  await maybeSera(w);
}

async function lookAtPip(w: WorldScene): Promise<void> {
  const rt = R;
  if (!rt) return;
  if (State.has(FLAGS.pipCalm) || questDone()) {
    await scene(w, [nar('Pip, entirely at his ease, allowing exactly as much of this as suits him.')]);
    return;
  }
  w.mote?.react('sad', 1400);
  State.advanceQuest('q1_pip', 'find_pip');
  // TODO(dialogue): belongs in quest1_bell.ts as q1.pipUnderSettle.
  await scene(w, [
    nar('Two eyes in the dark under the settle, and as much cat as possible behind them.'),
    nar('He is not going to be carried out. Whatever moves him will have to be his idea.'),
  ]);
}

async function talkToMira(w: WorldScene): Promise<void> {
  if (!State.has(FLAGS.metMira)) {
    await scene(w, TALK.mira.firstMeeting);
    State.set(FLAGS.metMira);
    State.meet('mira');
    return;
  }
  // Her account of the storm is the clue that puts the two sounds in order,
  // and she only gives it once the player has found the new pipework.
  if (State.has(FLAGS.cluePipes) && !State.has(ASKED_MIRA) && !questDone()) {
    w.mote?.react('curious', 1600);
    await scene(w, TALK.q1.cluePipesAsk);
    State.set(ASKED_MIRA);
    State.bump('clues_found');
    if (clueCount() >= 3) State.advanceQuest('q1_pip', 'investigate');
    await maybeSera(w);
    return;
  }
  await talkTo(w, 'mira');
}

async function talkTo(w: WorldScene, person: string): Promise<void> {
  if (person === 'sera' && !State.has(FLAGS.metSera)) {
    await scene(w, TALK.sera.firstMeeting);
    State.set(FLAGS.metSera);
    State.meet('sera');
    return;
  }
  const line = ambient(person);
  if (!line) return;
  State.meet(person);
  await scene(w, [line]);
}

/** Sera turns up once the player has found their feet, and stays to watch. */
async function maybeSera(w: WorldScene): Promise<void> {
  if (State.has(FLAGS.metSera) || questDone()) return;
  if (clueCount() < 2 && !hasBell()) return;
  await scene(w, TALK.q1.seraArrives, (name) => {
    if (name !== 'sera_enter') return;
    const sera = w.spawnNpc({ id: 'sera', actor: 'sera', x: 10, y: 17 });
    sera.walkTo(12, 13);
  });
  await scene(w, TALK.sera.firstMeeting);
  State.set(FLAGS.metSera);
  State.meet('sera');
}

// ── the bell ────────────────────────────────────────────────────────────────

function ringBell(w: WorldScene): void {
  const rt = R;
  if (!rt || !rt.bell) return;
  const now = w.time.now;
  if (now < rt.ringReadyAt) return;
  rt.ringReadyAt = now + RING_COOLDOWN;

  const bx = rt.bell.x;
  const by = rt.bell.y - 4;
  Audio.sfx('bell_small', { volume: 0.5 });
  ringFx(w, bx, by, BELL_RANGE);
  w.cues.emitCue('bell', bx, by, BELL_RANGE, 900);

  const heard = rt.pip.distanceTo(bx, by) <= BELL_RANGE;

  if (State.has(FLAGS.pipCalm)) {
    if (heard) { rt.pip.noteBell(bx, by); rt.followUntil = now + 9000; }
    return;
  }

  if (heard) {
    // He still believes the bell means something. Showing that every time is
    // what makes the fourth ring worth anything.
    if (rt.pip.fear >= 40) rt.pip.spook();
    else rt.pip.faceTowards(bx, by);
  }
  rt.pending = { at: now, heard };

  if (!State.has(FLAGS.bellStartled)) {
    State.set(FLAGS.bellStartled);
    State.advanceQuest('q1_pip', 'experiment');
    void firstRing(w, heard);
  }
}

async function firstRing(w: WorldScene, heard: boolean): Promise<void> {
  await maybeSera(w);
  await scene(w, TALK.q1.bellFirst, (name) => {
    if (name === 'pip_flee_deeper') R?.pip.spook();
  });
  // The scene ate the silence, but nothing frightening happened during it, so
  // the ring counts. Failing the player for reading dialogue would be absurd.
  if (R) R.pending = null;
  if (heard) await safeRing(w);
}

/** A ring survived its two seconds. */
async function safeRing(w: WorldScene): Promise<void> {
  const rt = R;
  if (!rt) return;
  rt.calmRings = Math.min(RINGS_TO_CALM, rt.calmRings + 1);
  State.counters[CALM_RINGS] = rt.calmRings;
  rt.pip.changeFear(-FEAR_PER_RING);
  rt.pip.settleStep();
  rt.lastProgressAt = w.time.now;
  rt.hintStage = 0;

  const beats = rt.calmRings === 2 ? TALK.q1.bellCalm2
    : rt.calmRings === 3 ? TALK.q1.bellCalm3
    : rt.calmRings >= RINGS_TO_CALM ? TALK.q1.bellCalm4
    : null;
  if (beats) await scene(w, beats);
  if (rt.calmRings >= RINGS_TO_CALM) await finish(w);
}

function resolvePending(w: WorldScene, now: number): void {
  const rt = R;
  if (!rt || !rt.pending) return;
  if (now - rt.pending.at < PAIR_WINDOW) return;
  const p = rt.pending;
  rt.pending = null;
  // Out of earshot is not a failure. It is simply nothing, which is its own
  // small lesson about what the bell is doing.
  if (p.heard) void safeRing(w);
}

/**
 * Something loud, close to a ring.
 *
 * This is the only thing in the quest that takes progress away, and it always
 * has a visible cause the player could have avoided.
 */
function startle(w: WorldScene, source: 'tower' | 'attack' | 'pots'): void {
  const rt = R;
  if (!rt || questDone()) return;
  if (State.has(FLAGS.pipCalm)) { rt.pip.noteBell(...WINDOW_PX); return; }

  const paired = !!rt.pending && w.time.now - rt.pending.at <= PAIR_WINDOW && rt.pending.heard;
  if (!paired) { rt.pip.spook(); return; }

  rt.pending = null;
  rt.calmRings = 0;
  State.counters[CALM_RINGS] = 0;
  State.set(FLAGS.bellSpoiled);
  rt.pip.setFear(100);
  rt.pip.spook();
  w.shake(0.005, 280);
  w.mote?.react('alert', 1200);
  rt.lastProgressAt = w.time.now;
  // A grace period, so a reset never immediately cascades into another one.
  rt.towerAt = Math.max(rt.towerAt, w.time.now + TOWER_PERIOD);

  if (rt.spoiledOnce) return;
  rt.spoiledOnce = true;
  void scene(w, source === 'pots' ? TALK.q1.bellSpoiledKettle : SPOILED_BY_TOWER);
}

/** TODO(dialogue): move to quest1_bell.ts as q1.bellSpoiledTower. */
const SPOILED_BY_TOWER: Beat[] = [
  nar('You ring. Two seconds later the tower answers it, and the glasses on the bar answer the tower.'),
  nar('Pip is further back under the settle than when you started.'),
  group({ requires: FLAGS.metSera }, [
    say('sera', 'Not your fault. Entirely avoidable, though. Listen for the hour and go between.'),
  ]),
];

function knockPots(w: WorldScene): void {
  const rt = R;
  if (!rt) return;
  const p = w.prop('pots');
  Audio.sfx('clatter', { volume: 0.6 });
  w.shake(0.004, 220);
  if (p) {
    w.tweens.add({ targets: p.sprite, angle: { from: -5, to: 5 }, duration: 90, yoyo: true, repeat: 3,
      onComplete: () => p.sprite.setAngle(0) });
    w.fx.emote(p.sprite.x, p.sprite.y, 'note', 500);
  }
  w.cues.emitCue('clatter', p?.sprite.x ?? 0, p?.sprite.y ?? 0, 400, 500);
  startle(w, 'pots');
}

// ── the tower ───────────────────────────────────────────────────────────────

function towerClock(w: WorldScene, now: number): void {
  const rt = R;
  if (!rt) return;
  if (!rt.telegraphed && now >= rt.towerAt - TOWER_TELEGRAPH) {
    rt.telegraphed = true;
    // The warning is a real sound in the world: the tower winding up, heard
    // through the window it will come through.
    Audio.sfx('bell_tower_far', { volume: 0.22 });
    ringFx(w, WINDOW_PX[0], WINDOW_PX[1], 34, 0x9fc4ef, 0.4);
  }
  if (now < rt.towerAt) return;
  rt.towerAt = now + TOWER_PERIOD;
  rt.telegraphed = false;
  towerToll(w, true);
}

function towerToll(w: WorldScene, scares: boolean): void {
  Audio.sfx('bell_tower', { volume: 0.6 });
  ringFx(w, WINDOW_PX[0], WINDOW_PX[1], 120, 0xbfd8ff, 0.75);
  w.shake(0.0035, 320);
  w.cues.emitCue('bell', WINDOW_PX[0], WINDOW_PX[1], 420, 900);
  if (scares) startle(w, 'tower');
}

// ── hints (plan §66 — visual only) ──────────────────────────────────────────

function hints(w: WorldScene, now: number): void {
  const rt = R;
  if (!rt || !State.has(FLAGS.q1Started) || State.has(FLAGS.pipCalm)) return;
  const stuck = now - rt.lastProgressAt;
  if (stuck < 22000 || now < rt.nextHintAt) return;
  rt.nextHintAt = now + 11000;
  rt.hintStage = Math.min(3, rt.hintStage + 1);

  const pip = rt.pip;
  const bell = rt.bell;

  if (!bell) {
    // They have not found the bell yet: look at the shelf behind the bar.
    const p = w.prop('handbell');
    if (p) { w.mote?.pointAt(p.sprite.x, p.sprite.y, 2000); bellGlyph(w, p.sprite.x, p.sprite.y); }
    return;
  }

  switch (rt.hintStage) {
    case 1:
      // Look from one to the other, and back.
      w.mote?.pointAt(pip.x, pip.y - 8, 1500);
      bellGlyph(w, bell.x, bell.y);
      w.time.delayedCall(1600, () => { if (R?.bell) w.mote?.pointAt(R.bell.x, R.bell.y, 1400); });
      break;
    case 2:
      // Follow the bell across to him.
      w.mote?.pointAt(bell.x, bell.y, 1200);
      bellGlyph(w, bell.x, bell.y, { x: pip.x, y: pip.y });
      break;
    default:
      // A thought, over the cat, of the thing he is afraid of.
      w.fx.emote(pip.x, pip.y - 4, 'bubble', 2200);
      bellGlyph(w, pip.x, pip.y - 12);
      w.time.delayedCall(900, () => { if (R) bellGlyph(w, R.pip.x, R.pip.y - 12); });
      break;
  }
}

// ── resolution ──────────────────────────────────────────────────────────────

async function finish(w: WorldScene): Promise<void> {
  const rt = R;
  if (!rt) return;

  await scene(w, TALK.q1.pipOut, (name) => {
    if (name === 'pip_emerge') {
      rt.pip.release();
      rt.pip.setFear(0);
      rt.pip.setPose('happy');
      rt.pip.goTo(Math.round(w.player.x / TILE), Math.round((w.player.y - 1) / TILE) + 1);
    }
    if (name === 'pip_purr') {
      w.fx.emote(rt.pip.x, rt.pip.y - 4, 'heart', 1400);
      Audio.sfx('purr', { volume: 0.5 });
    }
    if (name === 'settle_moved') openStoreroom(w, false);
  });

  State.set(FLAGS.pipCalm);
  State.advanceQuest('q1_pip', 'calm');

  await scene(w, TALK.q1.naming);
  State.set('insight_conditioning');
  State.unlockInsight('conditioning');
  State.addInsightExample(
    'conditioning',
    'Pip, the Lantern Inn: four storm nights of bell-then-pipes, and four quiet rings to undo it.',
  );

  await scene(w, TALK.q1.link, (name) => {
    if (name === 'ability_grant') State.grant('link');
  });
  State.grant('link');

  State.completeQuest('q1_pip');
  // Both names are in use: the dialogue layer reads `q1_done`, the debug
  // checkpoints and the autosave watch `q1_complete`.
  State.setAll([FLAGS.q1Done, 'q1_complete', FLAGS.metSera]);
  State.addNote('pip', 'Afraid of a bell that never hurt him. Not any more.');

  rt.pip.setWander(true);
  rt.followUntil = 0;
}

/** Mira shifts the settle, the crates go back, and the storeroom is a room. */
function openStoreroom(w: WorldScene, instant: boolean): void {
  w.setDynamicSolidRect(21, 6, 3, 2, false);
  w.setDynamicSolidRect(21, 9, 2, 2, false);

  const crates = w.prop('crates');
  const settle = w.prop('settle');
  const move = (p: typeof crates, dx: number, dy: number) => {
    if (!p) return;
    if (instant) { p.sprite.x += dx; p.sprite.y += dy; p.sprite.setDepth(DEPTH.ENTITY_BASE + p.sprite.y); return; }
    w.tweens.add({
      targets: p.sprite,
      x: p.sprite.x + dx,
      y: p.sprite.y + dy,
      duration: 700,
      ease: 'Quad.easeInOut',
      onUpdate: () => p.sprite.setDepth(DEPTH.ENTITY_BASE + p.sprite.y),
    });
  };
  move(crates, 44, 26);
  move(settle, -6, 46);
  if (!instant) {
    Audio.sfx('push_block', { volume: 0.6 });
    w.fx.dust(21.5 * TILE, 8 * TILE);
    w.shake(0.003, 220);
  }
  // Whatever they end up standing on stays solid.
  w.setDynamicSolidRect(23, 8, 3, 2, true);
  w.setDynamicSolidRect(21, 12, 2, 1, true);

  // The room beyond is lit now, and reads as somewhere you could walk.
  try {
    for (const x of [21, 22]) {
      w.world.ground.putTileAt(tileIndex('tile/int/doorway_lit_top'), x, 4);
      w.world.ground.putTileAt(tileIndex('tile/int/doorway_lit_base'), x, 5);
    }
  } catch { /* a tileset without the lit variants is not worth crashing over */ }
  w.lighting.add({ x: 21.5, y: 5.5, radius: 40, color: 0xffc47a, intensity: 0.4, flicker: 0.3 });
  emit('puzzle:opened', { tx: 21, ty: 5 });
}
