/**
 * ECHO SHRINE — ROOM FIVE: the last door. (plan.md §43)
 *
 * THE CHAIN
 * ─────────
 *   1. READ THE FLOOR.   Three plinths. One has a hollow worn into the moss
 *      against it; one has drag-marks leading away; one has undisturbed dust.
 *      Three traces, three different histories, and the player has been reading
 *      wet stone and dry stone since the entrance hall.
 *   2. RING THE RIGHT ONE.  Put the west chime down and the leader comes to it,
 *      and the flock comes with it. Put the east one down and the leader bolts
 *      away from it — a wrong answer that *does something*, visibly, harmlessly,
 *      and tells you exactly what the mechanism is. The north-east one does
 *      nothing at all and the leader looks up and settles again.
 *   3. PLACE THE FLOCK.  Two of the three plates are exactly one flock station
 *      apart, so one good placement holds both. The third is in the far corner
 *      and no placement reaches it and the pair together — the shape of the
 *      flock is the obstacle.
 *   4. BREAK ONE OUT.  Lead the flock so that a *particular* follower — the one
 *      that ends up on the far plate, which depends entirely on where you put
 *      the chime — is standing on it, and break that one out of formation. It
 *      stays. Then take the chime to the pair and the rest follow.
 *
 * Step four cannot be done before step two, and which follower it applies to is
 * decided by step two, so the chain does not come apart into independent halves.
 *
 * NOTHING IS PERMANENT
 * ────────────────────
 * A broken-out follower can be talked back into the flock by pressing the button
 * again. A chime can be picked up and moved as often as you like. There is no
 * arrangement of this room that has to be reset, and going down to the creatures
 * puts it back at the door anyway (plan.md §67).
 *
 * WHAT IS NOT CHECKED
 * ───────────────────
 * There is no `hasAbility` test anywhere in this file. Breaking a follower out
 * is available to anybody who works out that they should — which is the only
 * gate this game has ever used.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { registerArea } from '../registry';
import { R5, type ChimeSpec } from '../maps/shrine_combination';
import { ROOM_FLOOR, SHRINE_CYAN, southWallY } from '../maps/shrine_common';
import { CueFollower, Lure } from '@/systems/Abilities';
import { PuzzleRoom, type Gate, type PressurePlate } from '@/systems/Puzzle';
import { TALK, playExchange } from '@/data/dialogue';
import {
  HintDirector, RoomRig, SEALED_ART, clearHarness, completeRoom, doorGate, driveCue,
  goLookAt, installHarness, lookBetween, readEnv, setRuneTile, showGoal, stepToward, tc, tm,
} from './shrine_kit';
import type { Enemy } from '@/entities/Enemy';
import type { WorldScene } from '@/scenes/WorldScene';

const TINT: Record<ChimeSpec['id'], number> = {
  west: SHRINE_CYAN,
  east: 0xffb046,
  northeast: 0xc48cff,
};

interface Chime {
  spec: ChimeSpec;
  lure: Lure;
  /** Where it was put down, so a dropped chime does not wander off a plate. */
  pinned: { x: number; y: number } | null;
  anchor: { x: number; y: number };
}

interface Follower {
  id: string;
  dx: number;
  dy: number;
  enemy: Enemy;
  anchor: { x: number; y: number };
}

interface S {
  rig: RoomRig;
  room: PuzzleRoom;
  plates: PressurePlate[];
  gate: Gate;
  leader: Enemy;
  pos: { x: number; y: number };
  follower: CueFollower;
  flock: Follower[];
  chimes: Chime[];
  carried: { x: number; y: number };
  held: Chime | null;
  solved: boolean;
  hints: HintDirector;
}

let s: S | null = null;

const comeKind = (c: ChimeSpec) => `chime_${c.id}`;

// ── the chimes ──────────────────────────────────────────────────────────────

/** Ring a pattern: three tones, and three glyphs for anyone playing silent. */
function ring(w: WorldScene, c: Chime, x: number, y: number): void {
  c.spec.pattern.forEach((tone, i) => {
    w.time.delayedCall(i * 260, () => {
      Audio.sfx(`lantern_tone_${tone}`, { volume: 0.62 });
      w.fx.burst(x + (i - 1) * 9, y - 16, `fx/tone_${tone}`);
    });
  });
}

function drop(w: WorldScene): void {
  if (!s || !s.held) return;
  const c = s.held;
  const p = tc(w.player.tileX, w.player.tileY);
  const at = { x: p.x, y: p.y - 6 };
  c.lure.release(at.x, at.y);
  c.pinned = at;
  s.held = null;
  ring(w, c, at.x, at.y);
  s.hints.progress();

  // Whatever this pattern means to the leader, it means it now.
  if (c.spec.effect === 'come') {
    // A fresh follower so an older heading can never fight the new one.
    s.follower = new CueFollower(s.leader, comeKind(c.spec), 24);
    w.fx.emote(s.leader.x, s.leader.y, 'note', 900);
  } else if (c.spec.effect === 'flee') {
    s.follower = new CueFollower(s.leader, comeKind(s.chimes[0].spec), 24);
    w.fx.emote(s.leader.x, s.leader.y, 'excl', 1100);
    Audio.sfx('aggro', { volume: 0.32 });
  } else {
    // It looks up, decides the noise is nothing to do with it, and settles.
    w.fx.emote(s.leader.x, s.leader.y, 'quest', 1200);
  }
}

/** Put a chime back on the plinth it came from, quiet and at rest. */
function stow(c: Chime): void {
  c.lure.held = false;
  c.lure.released = false;
  c.pinned = null;
  c.lure.x = c.anchor.x;
  c.lure.y = c.anchor.y;
}

function take(w: WorldScene, c: Chime): void {
  if (!s || c.lure.held) return;
  // You can only carry one. Picking up a second returns the first to its
  // plinth rather than refusing — otherwise a player who has picked up the
  // wrong chime is stuck holding a thing they cannot put down anywhere useful.
  if (s.held && s.held !== c) stow(s.held);
  c.lure.pickUp();
  c.pinned = null;
  s.held = c;
  ring(w, c, c.lure.x, c.lure.y);
  s.hints.progress();
}

// ── the flock ───────────────────────────────────────────────────────────────

function setDissent(w: WorldScene, f: Follower, on: boolean): void {
  if (!s || f.enemy.opts.dissenting === on) return;
  f.enemy.opts.dissenting = on;
  if (on) {
    Audio.sfx('dissent', { volume: 0.65 });
    w.fx.burst(f.enemy.x, f.enemy.y - 14, 'fx/dissent_break');
    w.shake(0.004, 200);
  } else {
    Audio.sfx('switch', { volume: 0.45 });
    w.fx.burst(f.enemy.x, f.enemy.y - 14, 'fx/link_node');
  }
  s.hints.progress();
}

// ── arming ──────────────────────────────────────────────────────────────────

function spawnFlock(w: WorldScene): { leader: Enemy; flock: Follower[] } {
  const leader = w.enemies.spawn('bramble', R5.leader.x, R5.leader.y, { passive: true, hp: 60 });
  const flock = R5.offsets.map((o) => ({
    id: o.id,
    dx: o.dx,
    dy: o.dy,
    enemy: w.enemies.spawn('echomote', R5.leader.x + o.dx, R5.leader.y + o.dy, {
      passive: true, leader, hp: 40,
    }),
    anchor: { x: 0, y: 0 },
  }));
  return { leader, flock };
}

function armRoom(w: WorldScene): void {
  if (!s) return;
  s.solved = State.has('shrine_r5_done');
  s.plates.forEach((p) => p.reset());
  R5.channel.forEach((c) => setRuneTile(w, c.x, c.y, 'chevron', false));
  s.gate.setOpen(s.solved, true);

  w.cues.clear();
  s.held = null;
  for (const c of s.chimes) {
    c.lure.held = false;
    c.lure.released = false;
    c.pinned = null;
    c.lure.x = c.anchor.x;
    c.lure.y = c.anchor.y;
  }

  // GameFlow clears the room's enemies when the player goes down, and the whole
  // flock are enemies. Put them back before re-posing them.
  if (!w.enemies.list.includes(s.leader)) {
    const next = spawnFlock(w);
    s.leader = next.leader;
    s.flock = next.flock.map((f, i) => ({ ...f, anchor: s!.flock[i].anchor }));
  }
  const home = tc(R5.leader.x, R5.leader.y);
  s.pos = { x: home.x, y: home.y };
  s.leader.x = home.x;
  s.leader.y = home.y;
  s.follower = new CueFollower(s.leader, comeKind(s.chimes[0].spec), 24);
  for (const f of s.flock) {
    f.enemy.opts.dissenting = false;
    f.enemy.x = home.x + f.dx * TILE;
    f.enemy.y = home.y + f.dy * TILE;
  }
  if (s.solved) s.hints.stop(); else s.hints.progress();
}

registerArea('shrine_combination', {
  onEnter(w) {
    s?.rig.destroy();
    w.fx.setAmbient('shrine');

    const room = new PuzzleRoom(w);
    // requires 3: a creature holds a plate down and you do not.
    const plates = R5.plates.map((p) => room.plate(p.x, p.y, { requires: 3 }));
    const gate = doorGate(w, R5.doorOut, southWallY(ROOM_FLOOR), { art: SEALED_ART });

    const { leader, flock } = spawnFlock(w);
    const home = tc(R5.leader.x, R5.leader.y);

    const chimes: Chime[] = R5.chimes.map((spec) => {
      const anchor = { x: spec.x * TILE + TILE / 2, y: spec.y * TILE + TILE - 18 };
      const lure = new Lure(w, comeKind(spec), spec.x, spec.y, {
        idle: 'prop/shrine/crystal_0', anim: 'shrine_crystal',
      });
      lure.x = anchor.x;
      lure.y = anchor.y;
      lure.sprite.setTint(TINT[spec.id]);
      return { spec, lure, pinned: null, anchor };
    });

    const state: S = {
      rig: new RoomRig(w),
      room, plates, gate, leader,
      pos: { x: home.x, y: home.y },
      follower: new CueFollower(leader, comeKind(R5.chimes[0]), 24),
      flock, chimes,
      carried: { x: 0, y: 0 },
      held: null,
      solved: State.has('shrine_r5_done'),
      hints: new HintDirector(w, [
        // 1: between the creature and the hollow it has worn by the west plinth.
        () => lookBetween(w, { x: state.leader.x, y: state.leader.y - 12 }, tc(R5.chimes[0].x, R5.chimes[0].y)),
        // 2: the plate nothing can reach.
        () => goLookAt(w, tm(R5.plates[0].x, R5.plates[0].y)),
        // 3: the goal — a body standing on the far plate.
        () => showGoal(w, tm(R5.plates[0].x, R5.plates[0].y)),
      ], 50_000, 50_000),
    };
    s = state;

    // Each plinth: take the chime standing on it.
    for (const c of state.chimes) {
      const p = tc(c.spec.x, c.spec.y);
      w.addInteractable({
        id: `r5_chime_${c.spec.id}`,
        x: p.x, y: p.y - 20,
        label: 'Take',
        observable: true,
        enabled: () => !c.lure.held && !c.lure.released,
        onInteract: () => take(w, c),
      });
      // …and take it back off the floor once it has been put down.
      w.addInteractable({
        id: `r5_retake_${c.spec.id}`,
        x: 0, y: 0,
        follow: c.lure,
        label: 'Take',
        radius: 6,
        enabled: () => c.lure.released,
        onInteract: () => { w.cues.clear(); take(w, c); },
      });
      // The trace on the floor beside it. This is the whole of the evidence.
      w.recall.add({
        id: `r5_trace_${c.spec.id}`,
        x: p.x, y: p.y + 2,
        context: c.spec.clue.context,
        text: c.spec.clue.text,
      });
    }

    w.addInteractable({
      id: 'r5_drop',
      x: 0, y: 0,
      follow: state.carried,
      label: 'Set down',
      enabled: () => !!state.held,
      onInteract: () => drop(w),
    });

    // Each follower: break it out, or talk it back in.
    for (const f of state.flock) {
      w.addInteractable({
        id: `r5_follower_${f.id}`,
        x: 0, y: 0,
        follow: f.anchor,
        label: 'Break',
        observable: true,
        onInteract: () => setDissent(w, f, !f.enemy.opts.dissenting),
      });
    }

    state.rig.onReset(() => armRoom(w));
    state.rig.listen('enemy:died', (() => {
      // Nothing here is meant to die. If something does, the room is rebuilt.
      if (!s) return;
      if (!s.leader.dead && !s.flock.some((f) => f.enemy.dead)) return;
      w.time.delayedCall(400, () => {
        if (!s) return;
        w.enemies.clear();
        const next = spawnFlock(w);
        s.leader = next.leader;
        s.flock = next.flock.map((f, i) => ({ ...f, anchor: s!.flock[i].anchor }));
        armRoom(w);
      });
    }) as (p: never) => void);

    armRoom(w);

    installHarness(w, {
      /** Exactly what pressing the button at a plinth does. */
      take(id: string) {
        const c = state.chimes.find((q) => q.spec.id === id);
        if (c) take(w, c);
      },
      /** Exactly what pressing the button while carrying does. */
      drop() { drop(w); },
      /** Exactly what pressing the button at a follower does. */
      breakOut(id: string) {
        const f = state.flock.find((q) => q.id === id);
        if (f) setDissent(w, f, !f.enemy.opts.dissenting);
      },
      read(id: string) {
        const c = w.recall.clues.find((q) => q.id === id);
        if (c) w.recall.read(c);
      },
      snapshot() {
        const tile = (x: number, y: number) => ({ x: Math.floor(x / TILE), y: Math.floor((y - 1) / TILE) });
        return {
          leader: tile(state.leader.x, state.leader.y),
          flock: state.flock.map((f) => ({
            id: f.id,
            ...tile(f.enemy.x, f.enemy.y),
            dissenting: !!f.enemy.opts.dissenting,
            offset: [f.dx, f.dy],
          })),
          plates: R5.plates.map((p, i) => ({ id: p.id, x: p.x, y: p.y, pressed: state.plates[i].pressed })),
          chimes: state.chimes.map((c) => ({ id: c.spec.id, pattern: c.spec.pattern, held: c.lure.held, down: c.lure.released })),
          clues: w.recall.knownContexts(),
          gateOpen: state.gate.open,
          solved: state.solved,
        };
      },
    });
  },

  onUpdate(w, dt) {
    if (!s) return;
    const grid = w.collisionGrid();

    // ── chimes ─────────────────────────────────────────────────────────────
    for (const c of s.chimes) {
      c.lure.update(dt, w.cues);
      if (c.pinned) {
        // A put-down chime stays exactly where it was put. `Lure` drifts on
        // purpose, but a drifting chime would drag a creature off a plate.
        c.lure.x = c.pinned.x;
        c.lure.y = c.pinned.y;
        w.cues.emitCue(comeKind(c.spec), c.lure.x, c.lure.y, 340, 260);
      }
    }
    s.carried.x = w.player.x + (w.player.dir === 'e' ? 10 : w.player.dir === 'w' ? -10 : 0);
    s.carried.y = w.player.y - 14;

    // ── the leader ─────────────────────────────────────────────────────────
    // Authoritative from `pos`, so nothing the player can do with a sword moves
    // it. Only sound does.
    s.leader.x = s.pos.x;
    s.leader.y = s.pos.y;
    const scare = s.chimes.find((c) => c.spec.effect === 'flee' && c.pinned);
    const alarm = scare ? w.cues.strongest(comeKind(scare.spec), s.leader.x, s.leader.y) : null;
    if (alarm) {
      const away = Math.atan2(s.leader.y - alarm.y, s.leader.x - alarm.x);
      stepToward(s.leader, s.leader.x + Math.cos(away) * 64, s.leader.y + Math.sin(away) * 64, 34, dt, grid);
    } else {
      driveCue(w, s.leader, s.follower, comeKind(s.chimes[0].spec), 24, dt, grid);
    }
    s.pos = { x: s.leader.x, y: s.leader.y };

    // ── the flock ──────────────────────────────────────────────────────────
    for (const f of s.flock) {
      if (!f.enemy.opts.dissenting) {
        stepToward(f.enemy, s.leader.x + f.dx * TILE, s.leader.y + f.dy * TILE, 52, dt, grid);
      }
      f.anchor.x = f.enemy.x;
      f.anchor.y = f.enemy.y - 12;
    }

    // ── the plates ─────────────────────────────────────────────────────────
    s.room.update();
    const held = s.plates.filter((p) => p.pressed).length;
    R5.channel.forEach((c, i) => setRuneTile(w, c.x, c.y, 'chevron', i < held));

    if (!s.solved && held === s.plates.length) {
      s.solved = true;
      s.hints.stop();
      completeRoom(w, 5);
      const seal = w.prop('seal');
      if (seal) {
        w.tweens.add({ targets: seal.sprite, alpha: 0.25, duration: 900, ease: 'Sine.easeInOut' });
      }
      Audio.sfx('echo_phase', { volume: 0.6 });
      w.shake(0.008, 520);
      w.flash(0xa681e6, 220);
      w.time.delayedCall(500, () => s?.gate.setOpen(true));
    }
    if (!s.solved) s.hints.update(dt);
  },

  onTrigger(w, id) {
    if (id === 'r5_enter') {
      if (State.has('shrine_r5_seen')) return false;
      State.set('shrine_r5_seen');
      void w.cutscene.run((c) => playExchange(c, TALK.shrine.roomCombination));
      return true;
    }
    return false;
  },

  onInteract(w, id) {
    if (id.startsWith('carving.')) return readEnv(w, id);
    return false;
  },

  onExit() {
    s?.chimes.forEach((c) => c.lure.destroy());
    s?.gate.destroy();
    s?.room.destroy();
    s?.rig.destroy();
    clearHarness();
    s = null;
  },
});
