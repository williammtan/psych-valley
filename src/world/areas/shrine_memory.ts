/**
 * ECHO SHRINE — ROOM THREE: reconstructing two routes. (plan.md §41)
 *
 * THE PULSE
 * ─────────
 * Every few seconds a light runs along one of the two channels, from the wall
 * it starts at to the door it ends at, flaring each inscribed plate as it
 * passes. Dry first, then wet, then a pause, forever. That is the room showing
 * the player two similar sequences one after another — and showing the second
 * one last on purpose, so that anybody working from what they saw most recently
 * gets the wrong answer for the door they are standing at.
 *
 * The pulses are not the only copy of the information. The plates stay lit
 * between pulses and the channels stay on the floor, so a player who missed a
 * pulse can walk a route and read it off. Nothing here is ever recoverable only
 * by having been watching at the right moment.
 *
 * THE CONTEXT DOES THE ATTRIBUTING
 * ────────────────────────────────
 * Which route belongs to which door is not written down anywhere. It is on the
 * floor: one channel is full of water and it runs to the door with water under
 * it. Three `RecallSystem` clues make that legible for a player who wants to be
 * sure — one at each door and one at the pool — and none of them says which
 * order goes where. They describe wet stone and dry stone, and the player does
 * the rest.
 *
 * FAILURE
 * ───────
 * A wrong order buzzes, the pillars go dark, and the room is exactly as it was.
 * `OrderLock` deliberately gives no per-symbol feedback (see its own comment in
 * Puzzle.ts): a wrong entry must not narrow the search, or the puzzle becomes a
 * ten-press oracle instead of a reconstruction.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { registerArea } from '../registry';
import { DAMP, DRY, R3, type Route } from '../maps/shrine_memory';
import { ROOM_FLOOR, SHRINE_CYAN, southWallY } from '../maps/shrine_common';
import { OrderLock, RuneLight, type Gate, type Rune } from '@/systems/Puzzle';
import { TALK, playExchange } from '@/data/dialogue';
import {
  HintDirector, RoomRig, clearHarness, completeRoom, doorGate, flareRune, goLookAt,
  installHarness, lookBetween, readEnv, setRuneTile, showGoal, tc, tm,
} from './shrine_kit';
import type { WorldScene } from '@/scenes/WorldScene';

const AMBER = 0xffb937;

interface DoorRig {
  route: Route;
  gate: Gate;
  lamp: Phaser.GameObjects.Sprite;
  light: { img: Phaser.GameObjects.Image } | null;
  claimed: boolean;
}

interface S {
  rig: RoomRig;
  lock: OrderLock;
  pillars: RuneLight[];
  doors: DoorRig[];
  solved: boolean;
  /** Pulse scheduling. */
  timer: number;
  turn: number;
  hints: HintDirector;
}

let s: S | null = null;

const order = (r: Route): Rune[] => r.stations.map((st) => st.rune);

// ── the pulse ───────────────────────────────────────────────────────────────

/**
 * Run a light down one channel, in the direction the team walked, flaring each
 * plate as it reaches it. The plate order IS the door order — the player is
 * watching the answer being drawn, they just have to know whose answer it is.
 */
function pulse(w: WorldScene, r: Route): void {
  const colour = r.id === 'damp' ? SHRINE_CYAN : AMBER;
  const head = w.add.image(0, 0, 'atlas', 'fx/light_soft_64')
    .setBlendMode(Phaser.BlendModes.ADD).setTint(colour).setAlpha(0.85).setScale(0.55)
    .setDepth(DEPTH.LIGHT + 2);

  const step = 92;
  r.path.forEach(([x, y], i) => {
    w.time.delayedCall(i * step, () => {
      if (!head.active) return;
      const p = tm(x, y);
      head.setPosition(p.x, p.y);
      const st = r.stations.find((q) => q.x === x && q.y === y);
      if (st) {
        flareRune(w, st.x, st.y, st.rune, colour);
        Audio.sfx(r.id === 'damp' ? 'step_water' : 'step_stone', { volume: 0.45, rate: 0.9 });
        Audio.sfx('rune_activate', { volume: 0.32, rate: 0.86 + r.stations.indexOf(st) * 0.14 });
      }
    });
  });
  w.time.delayedCall(r.path.length * step, () => {
    w.tweens.add({ targets: head, alpha: 0, duration: 280, onComplete: () => head.destroy() });
  });
}

/** How long one channel's pulse takes, end to end. */
const pulseMs = (r: Route) => r.path.length * 92 + 400;

// ── entry ───────────────────────────────────────────────────────────────────

function claim(w: WorldScene, d: DoorRig): void {
  if (!s || d.claimed) return;
  d.claimed = true;
  d.lamp.clearTint();
  if (w.anims.exists('shrine_brazier')) d.lamp.play('shrine_brazier');
  d.light = w.lighting.addPixel(d.lamp.x, d.lamp.y - 22, 62, AMBER, 0.62, 0.5);
  for (const st of d.route.stations) flareRune(w, st.x, st.y, st.rune, AMBER);
  Audio.sfx('quest_start', { volume: 0.5 });
  w.fx.burst(d.lamp.x, d.lamp.y - 20, 'fx/rune_activate');
  w.mote?.react('alert', 900);
  s.hints.progress();

  if (s.doors.every((x) => x.claimed)) {
    s.solved = true;
    s.hints.stop();
    completeRoom(w, 3);
    for (const x of s.doors) x.gate.setOpen(true);
    w.shake(0.004, 280);
  }
}

function press(w: WorldScene, rune: Rune): void {
  if (!s || s.solved) return;
  const before = s.lock.entry;
  const res = s.lock.press(rune);
  const shown = res.complete ? [] : [...before, rune];
  s.pillars.forEach((p) => p.setLit(false));
  for (const r of shown) s.pillars.find((p) => p.rune === r)?.setLit(true);
  const hit = s.pillars.find((p) => p.rune === rune);
  if (hit) void hit.flash(res.complete ? 420 : 240);
  s.hints.progress();
}

function judge(w: WorldScene, entry: Rune[]): boolean {
  if (!s) return false;
  for (const d of s.doors) {
    if (d.claimed) continue;
    const want = order(d.route);
    if (want.every((r, i) => entry[i] === r)) { claim(w, d); return true; }
  }
  return false;
}

// ── arming ──────────────────────────────────────────────────────────────────

function armRoom(w: WorldScene): void {
  if (!s) return;
  s.lock.reset();
  s.pillars.forEach((p) => p.setLit(false));
  s.solved = State.has('shrine_r3_done');

  // The plates on the floor are always readable — the puzzle is which route
  // they belong to, never whether you were looking when the light went past.
  for (const r of R3.routes) for (const st of r.stations) setRuneTile(w, st.x, st.y, st.rune, true);

  for (const d of s.doors) {
    d.claimed = false;
    d.light?.img.destroy();
    d.light = null;
    d.lamp.stop();
    d.lamp.setTexture('atlas', 'prop/shrine/brazier_0');
    d.lamp.setTint(0x4a4866);
    d.gate.setOpen(false, true);
  }
  if (s.solved) {
    for (const d of s.doors) { d.claimed = true; d.lamp.clearTint(); d.gate.setOpen(true, true); }
    s.hints.stop();
  } else {
    s.timer = 1400;
    s.turn = 0;
    s.hints.progress();
  }
}

registerArea('shrine_memory', {
  onEnter(w) {
    s?.rig.destroy();
    w.fx.setAmbient('shrine');

    const doors: DoorRig[] = R3.routes.map((route) => {
      const lp = tc(route.lamp.x, route.lamp.y);
      const lamp = w.add.sprite(lp.x, lp.y, 'atlas', 'prop/shrine/brazier_0')
        .setOrigin(0.5, 1).setDepth(DEPTH.ENTITY_BASE + lp.y).setTint(0x4a4866);
      w.setDynamicSolid(Math.floor(lp.x / TILE), Math.floor((lp.y - 4) / TILE), true);
      return {
        route,
        gate: doorGate(w, route.door, southWallY(ROOM_FLOOR)),
        lamp,
        light: null,
        claimed: false,
      };
    });

    const pillars = R3.bank.map((b) => {
      const p = tc(b.x, b.y);
      return new RuneLight(w, b.rune, p.x, p.y);
    });

    const state: S = {
      rig: new RoomRig(w),
      lock: new OrderLock(w, 4, (entry) => judge(w, entry)),
      pillars,
      doors,
      solved: State.has('shrine_r3_done'),
      timer: 1400,
      turn: 0,
      hints: new HintDirector(w, [
        // 1: look from the wet door to the wet channel's first plate.
        () => lookBetween(w, tm(DAMP.door + 1, 13), tm(DAMP.stations[0].x, DAMP.stations[0].y)),
        // 2: walk the wet channel with them.
        () => {
          DAMP.stations.forEach((st, i) => {
            w.time.delayedCall(i * 620, () => goLookAt(w, tm(st.x, st.y)));
          });
        },
        // 3: the keypad, and the door it is for.
        () => showGoal(w, tc(R3.bank[0].x + 3, R3.bank[0].y - 1), 'think'),
      ], 50_000, 50_000),
    };
    s = state;

    R3.bank.forEach((b, i) => {
      const p = tc(b.x, b.y);
      w.addInteractable({
        id: `r3_rune_${b.rune}`,
        x: p.x, y: p.y - 22,
        label: 'Press',
        observable: true,
        onInteract: () => press(w, R3.bank[i].rune),
      });
    });

    const pool = w.prop('pool');
    if (pool) {
      w.addInteractable({
        id: 'r3_pool',
        x: pool.sprite.x, y: pool.sprite.y - 6,
        label: 'Listen',
        observable: true,
        onInteract: () => {
          if (!s || s.solved) return;
          s.timer = 0;
          w.fx.burst(pool.sprite.x, pool.sprite.y - 4, 'fx/recall_shimmer');
          Audio.sfx('recall', { volume: 0.5 });
        },
      });
    }

    // The evidence, physically in the room. None of it gives an order; all of
    // it is about which stone is wet and which is not.
    const damp = tc(DAMP.door + 1, 13);
    const dry = tc(DRY.door + 1, 13);
    w.recall.add({
      id: 'r3_damp_door',
      x: damp.x, y: damp.y - 12,
      context: 'damp',
      text: 'The stone under this door is wet through, and the moss on the jamb is old.',
    });
    w.recall.add({
      id: 'r3_dry_door',
      x: dry.x, y: dry.y - 12,
      context: 'dry',
      text: 'Dry as paper. The grit on this sill has not been walked through in years.',
    });
    w.recall.add({
      id: 'r3_pool_clue',
      x: R3.pool.x * TILE + TILE / 2, y: R3.pool.y * TILE + 4,
      context: 'both',
      text: 'Two crossings, laid one over the other. One of them came with water in it.',
    });

    state.rig.onReset(() => armRoom(w));
    armRoom(w);

    installHarness(w, {
      /** Exactly what pressing a rune pillar does. */
      press(rune: Rune) { press(w, rune); },
      /** Exactly what standing at a clue and pressing the button does. */
      read(id: string) {
        const c = w.recall.clues.find((q) => q.id === id);
        if (c) w.recall.read(c);
      },
      snapshot() {
        return {
          // What a player can read off the floor, in the order the pulse runs.
          evidence: R3.routes.map((r) => ({
            id: r.id,
            stations: r.stations.map((st) => st.rune),
            door: r.door,
          })),
          bank: R3.bank.map((b) => b.rune),
          entered: state.lock.progress,
          claimed: state.doors.filter((d) => d.claimed).map((d) => d.route.id),
          gates: state.doors.map((d) => d.gate.open),
          clues: w.recall.knownContexts(),
          solved: state.solved,
        };
      },
    });
  },

  onUpdate(w, dt) {
    if (!s || s.solved) return;
    s.timer -= dt;
    if (s.timer <= 0) {
      // Dry first, wet second — recency points at the wrong door on purpose.
      const r = s.turn % 2 === 0 ? DRY : DAMP;
      pulse(w, r);
      s.turn++;
      s.timer = pulseMs(r) + (s.turn % 2 === 0 ? 3200 : 900);
    }
    s.hints.update(dt);
  },

  onTrigger(w, id) {
    if (id === 'r3_enter') {
      if (State.has('shrine_r3_seen')) return false;
      State.set('shrine_r3_seen');
      void w.cutscene.run((c) => playExchange(c, TALK.shrine.roomMemory));
      return true;
    }
    return false;
  },

  onInteract(w, id) {
    if (id.startsWith('carving.')) return readEnv(w, id);
    return false;
  },

  onExit() {
    s?.pillars.forEach((p) => p.destroy());
    s?.doors.forEach((d) => { d.gate.destroy(); d.lamp.destroy(); d.light?.img.destroy(); });
    s?.rig.destroy();
    clearHarness();
    s = null;
  },
});
