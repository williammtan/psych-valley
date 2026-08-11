/**
 * ECHO SHRINE — ROOM ONE: the heavy thing and the light. (plan.md §39)
 *
 * THE SHAPE OF THE PROBLEM
 * ────────────────────────
 * A creature that has learned to walk after glowing moths. A plate that needs
 * something much heavier than you standing on it. A moth in a jar. That is the
 * whole room, and the player has to supply the only sentence that joins them.
 *
 * WHY THE RESIDENT MOTH EMITS NO CUE
 * ──────────────────────────────────
 * The moth already drifting round the west end when you arrive is scenery, and
 * the creature's plodding after it is scripted. That is not a shortcut, it is a
 * correctness fix: `CueBus.strongest` returns the *nearest* cue, so a real moth
 * parked two pixels from the creature's nose would beat the player's moth from
 * anywhere in the room and the puzzle could never be solved. The staging looks
 * identical from the player's chair — a heavy thing following a light — and the
 * moment a real cue exists the CueFollower takes over for good.
 *
 * WHY THE PLAYER'S MOTH CALLS FURTHER THAN A LURE NORMALLY DOES
 * ────────────────────────────────────────────────────────────
 * `Lure` calls at 150px, which is nine tiles; the plate is fourteen tiles from
 * where the creature lives. So the room emits a second, wider call from the
 * released moth. Releasing it and watching nothing happen because you were one
 * tile too far away is not a lesson, it is a bug with a moral.
 *
 * FAILURE
 * ───────
 * Nothing here can go wrong. The moth can be put down and picked up again as
 * often as you like, the plate latches so a drifting moth cannot undo the work,
 * and the creature cannot be moved, hurt into usefulness, or killed. Going down
 * to it re-arms the room at the door (plan.md §67).
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { registerArea } from '../registry';
import { R1 } from '../maps/shrine_association';
import { ROOM_FLOOR, southWallY } from '../maps/shrine_common';
import { CueFollower, Lure } from '@/systems/Abilities';
import { PuzzleRoom, type Gate, type PressurePlate } from '@/systems/Puzzle';
import { TALK, playExchange } from '@/data/dialogue';
import {
  HintDirector, RoomRig, clearHarness, completeRoom, doorGate, driveCue, goLookAt,
  installHarness, lookBetween, readEnv, setRuneTile, showGoal, stepToward, tc, tm,
} from './shrine_kit';
import type { Enemy } from '@/entities/Enemy';
import type { WorldScene } from '@/scenes/WorldScene';

/** A moth flies over walls, so it is pathed against nothing. */
const NO_WALLS: boolean[][] = [];

/**
 * The resident moth: a light on a circuit, and the reason the player already
 * understands the creature before they are handed anything.
 */
class PatrolMoth {
  x: number;
  y: number;
  /** stepToward wants a facing. A moth has not got one worth drawing. */
  dir: 'n' | 's' | 'e' | 'w' = 's';
  private sprite: Phaser.GameObjects.Sprite;
  private glow: Phaser.GameObjects.Image;
  private leg = 0;

  constructor(w: WorldScene) {
    const p = tc(R1.patrol[0].x, R1.patrol[0].y);
    this.x = p.x;
    this.y = p.y - 8;
    this.sprite = w.add.sprite(this.x, this.y, 'atlas', 'prop/shrine/moth_0').setOrigin(0.5, 1);
    if (w.anims.exists('shrine_moth')) this.sprite.play('shrine_moth');
    this.glow = w.add.image(this.x, this.y - 6, 'atlas', 'fx/light_soft_64')
      .setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe08a).setAlpha(0.42).setScale(0.5)
      .setDepth(DEPTH.LIGHT + 1);
  }

  update(dt: number): void {
    const next = R1.patrol[(this.leg + 1) % R1.patrol.length];
    const t = tc(next.x, next.y);
    if (stepToward(this, t.x, t.y - 8, 26, dt, NO_WALLS)) {
      this.leg = (this.leg + 1) % R1.patrol.length;
    }
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y + 20);
    this.glow.setPosition(Math.round(this.x), Math.round(this.y) - 6);
  }

  destroy(): void { this.sprite.destroy(); this.glow.destroy(); }
}

interface S {
  rig: RoomRig;
  room: PuzzleRoom;
  plate: PressurePlate;
  gate: Gate;
  creature: Enemy;
  follower: CueFollower;
  /** The creature's authoritative position — combat physics never wins. */
  pos: { x: number; y: number };
  patrol: PatrolMoth;
  lure: Lure;
  /** Interaction anchors, moved each frame. */
  carried: { x: number; y: number };
  dropped: { x: number; y: number };
  taken: boolean;
  solved: boolean;
  hints: HintDirector;
}

let s: S | null = null;

function litChannel(w: WorldScene, on: boolean): void {
  R1.channel.forEach((c, i) => {
    setRuneTile(w, c.x, c.y, 'ring', on);
    if (!on) return;
    w.time.delayedCall(i * 130, () => {
      const p = tm(c.x, c.y);
      w.fx.burst(p.x, p.y, 'fx/rune_activate', DEPTH.SCATTER + 8);
      Audio.sfx('rune_activate', { volume: 0.35, rate: 1 + i * 0.12 });
    });
  });
}

function spawnCreature(w: WorldScene): Enemy {
  return w.enemies.spawn('bramble', R1.creature.x, R1.creature.y, { passive: true, hp: 60 });
}

function armRoom(w: WorldScene): void {
  if (!s) return;
  s.plate.reset();
  s.solved = State.has('shrine_r1_done');
  s.gate.setOpen(s.solved, true);
  litChannel(w, s.solved);

  s.lure.held = false;
  s.lure.released = false;
  s.taken = false;
  s.lure.x = R1.jar.x * TILE + TILE / 2;
  s.lure.y = R1.jar.y * TILE + TILE - 14;
  w.cues.clear();

  // GameFlow clears every enemy in the room when the player goes down, and the
  // creature is an enemy. Without this the room comes back with nothing in it
  // to stand on the plate, which is the worst possible failure state: silent,
  // and only reachable by dying.
  const home = tc(R1.creature.x, R1.creature.y);
  if (!w.enemies.list.includes(s.creature)) s.creature = spawnCreature(w);
  s.pos = { x: home.x, y: home.y };
  s.creature.x = home.x;
  s.creature.y = home.y;
  s.follower = new CueFollower(s.creature, 'moth', 30);
  if (s.solved) s.hints.stop(); else s.hints.progress();
}

registerArea('shrine_association', {
  onEnter(w) {
    s?.rig.destroy();
    w.fx.setAmbient('shrine');

    const room = new PuzzleRoom(w);
    // requires 3: the creature is weight 3 and the player is weight 1, so the
    // plate is not something you can solve by standing on it and waiting.
    const plate = room.plate(R1.plate.x, R1.plate.y, { requires: 3, latching: true });
    const gate = doorGate(w, R1.doorOut, southWallY(ROOM_FLOOR));
    room.gates.push(gate);
    room.link([plate], gate);

    const creature = spawnCreature(w);
    const home = tc(R1.creature.x, R1.creature.y);
    // The moth is visible inside the jar from the moment you walk in. Half of
    // §39's staging is "observe moth", and a moth you cannot see until after
    // you have picked it up is staging that happens too late to be any use.
    const lure = new Lure(w, 'moth', R1.jar.x, R1.jar.y);
    lure.y -= 14;

    const state: S = {
      rig: new RoomRig(w),
      room, plate, gate, creature,
      follower: new CueFollower(creature, 'moth', 30),
      pos: { x: home.x, y: home.y },
      patrol: new PatrolMoth(w),
      lure,
      carried: { x: 0, y: 0 },
      dropped: { x: 0, y: 0 },
      taken: false,
      solved: State.has('shrine_r1_done'),
      hints: new HintDirector(w, [
        () => lookBetween(
          w,
          { x: state.creature.x, y: state.creature.y - 12 },
          state.taken ? tm(R1.plate.x, R1.plate.y) : tc(R1.jar.x, R1.jar.y),
        ),
        () => goLookAt(w, state.taken ? tm(R1.plate.x, R1.plate.y) : { x: state.patrol.x, y: state.patrol.y }),
        () => showGoal(w, tm(R1.plate.x, R1.plate.y)),
      ]),
    };
    s = state;

    // The jar: the one object at the room's exact centre, and the only thing in
    // the dungeon the player can pick up and carry.
    w.addInteractable({
      id: 'r1_jar',
      x: R1.jar.x * TILE + TILE / 2,
      y: R1.jar.y * TILE + 4,
      label: 'Take',
      observable: true,
      enabled: () => !state.taken,
      onInteract: () => {
        if (state.taken) return;
        state.taken = true;
        state.lure.pickUp();
        w.mote?.react('curious', 900);
        state.hints.progress();
      },
    });

    // Carrying: the button puts the moth down where you stand. Standing on the
    // plate and dropping it is the most direct expression of the idea, so that
    // is what the controls reward — no aiming, no throwing arc.
    w.addInteractable({
      id: 'r1_drop',
      x: 0, y: 0,
      follow: state.carried,
      label: 'Release',
      enabled: () => state.taken && state.lure.held,
      onInteract: () => {
        const p = tc(w.player.tileX, w.player.tileY);
        state.lure.release(p.x, p.y - 6);
        w.fx.burst(p.x, p.y - 8, 'fx/link_node');
        state.hints.progress();
      },
    });

    // …and picks it up again, so a wrong guess costs a walk and nothing else.
    w.addInteractable({
      id: 'r1_retake',
      x: 0, y: 0,
      follow: state.dropped,
      label: 'Take',
      radius: 6,
      enabled: () => state.lure.released,
      onInteract: () => {
        state.lure.pickUp();
        w.cues.clear();
        state.hints.progress();
      },
    });

    state.rig.onReset(() => armRoom(w));
    // Nothing here is meant to be killable. If something manages it anyway, put
    // the creature back rather than leaving the room unsolvable.
    state.rig.listen('enemy:died', (() => {
      if (!s || !s.creature.dead) return;
      w.time.delayedCall(400, () => {
        if (!s) return;
        s.creature = spawnCreature(w);
        s.follower = new CueFollower(s.creature, 'moth', 30);
      });
    }) as (p: never) => void);

    armRoom(w);

    installHarness(w, {
      /** Exactly what pressing the button at the jar does. */
      take() {
        if (state.taken) return;
        state.taken = true;
        state.lure.pickUp();
        state.hints.progress();
      },
      /** Exactly what pressing the button while carrying does. */
      drop() {
        if (!state.lure.held) return;
        const p = tc(w.player.tileX, w.player.tileY);
        state.lure.release(p.x, p.y - 6);
        state.hints.progress();
      },
      snapshot() {
        const tile = (x: number, y: number) => ({ x: Math.floor(x / TILE), y: Math.floor((y - 1) / TILE) });
        return {
          taken: state.taken,
          held: state.lure.held,
          down: state.lure.released,
          moth: tile(state.lure.x, state.lure.y + 6),
          creature: tile(state.creature.x, state.creature.y),
          plate: { x: R1.plate.x, y: R1.plate.y, pressed: state.plate.pressed },
          gateOpen: state.gate.open,
          solved: state.solved,
        };
      },
    });
  },

  onUpdate(w, dt) {
    if (!s) return;
    const grid = w.collisionGrid();

    s.patrol.update(dt);

    // The released moth calls across the room, not across a corner of it.
    if (s.lure.released) w.cues.emitCue('moth', s.lure.x, s.lure.y, 320, 260);
    s.lure.update(dt, w.cues);

    // The creature is authoritative from `pos`: whatever the combat code did to
    // it this frame is discarded, which is what "too heavy to move" means.
    s.creature.x = s.pos.x;
    s.creature.y = s.pos.y;
    if (!driveCue(w, s.creature, s.follower, 'moth', 30, dt, grid)) {
      stepToward(s.creature, s.patrol.x, s.patrol.y + 8, 17, dt, grid);
    }
    s.pos = { x: s.creature.x, y: s.creature.y };

    s.carried.x = w.player.x + (w.player.dir === 'e' ? 10 : w.player.dir === 'w' ? -10 : 0);
    s.carried.y = w.player.y - 14;
    s.dropped.x = s.lure.x;
    s.dropped.y = s.lure.y - 6;

    s.room.update();

    if (!s.solved && s.plate.pressed) {
      s.solved = true;
      s.hints.stop();
      completeRoom(w, 1);
      litChannel(w, true);
      w.shake(0.003, 220);
      w.mote?.react('alert', 1200);
    }
    if (!s.solved) s.hints.update(dt);
  },

  onTrigger(w, id) {
    if (id === 'r1_enter') {
      if (State.has('shrine_r1_seen')) return false;
      State.set('shrine_r1_seen');
      void w.cutscene.run((c) => playExchange(c, TALK.shrine.roomAssociation));
      return true;
    }
    return false;
  },

  onInteract(w, id) {
    if (id.startsWith('carving.')) return readEnv(w, id);
    return false;
  },

  onExit() {
    s?.rig.destroy();
    s?.room.destroy();
    s?.patrol.destroy();
    s?.lure.destroy();
    clearHarness();
    s = null;
  },
});
