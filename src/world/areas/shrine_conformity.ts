/**
 * ECHO SHRINE — ROOM FOUR: turning statues. (plan.md §42)
 *
 * ONE VERB, THREE ANSWERS
 * ───────────────────────
 * The player has exactly one thing they can do to a statue: press the button and
 * it turns a quarter to the right. What *happens* when they do escalates, and
 * the escalation is the lesson:
 *
 *   turn the crowned one     — all four swing with it, so one lamp lights and
 *                              the one you lit last time goes out
 *   turn a small one         — it turns, holds for a third of a second, and is
 *                              hauled back into line with a sweat pop
 *   turn one nobody can see  — it stays turned, and the other three shudder and
 *                              stop copying too
 *
 * `ConformityGroup.turnMember` already implements the middle one, snap-back and
 * all, and its own comment says the failure *is* the teaching moment. This room
 * is built around making the player meet that failure early and unmissably: the
 * first statue is four tiles from the door you walk in through.
 *
 * THE SIGHTLINES ARE DRAWN
 * ────────────────────────
 * Four faint violet lines run from the crowned statue to the others, every
 * frame, and a line stops dead at the block if the block is standing in it. The
 * player does not have to guess that the crowned one is doing it by looking, or
 * that a block would help. They can see both. What they have to work out is that
 * breaking *one* is enough to free all four — which is the festival's lesson,
 * transposed onto a floor plan.
 *
 * NOT GATED ON THE BADGE
 * ──────────────────────
 * `ConformityGroup.makeDissent` refuses without the DISSENT ability. Here, if it
 * refuses, the room breaks the statue out anyway. Nothing in this game is gated
 * on owning an ability, only on understanding the pattern, and a player who has
 * worked out what the block is for has understood the pattern by definition.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { registerArea } from '../registry';
import { R4, type StatueSpec } from '../maps/shrine_conformity';
import { ROOM_FLOOR, SHRINE_VIOLET, southWallY } from '../maps/shrine_common';
import { ConformityGroup, type ConformerLike } from '@/systems/Abilities';
import { PushBlock, type Gate } from '@/systems/Puzzle';
import { TALK, playExchange } from '@/data/dialogue';
import {
  HintDirector, RoomRig, clearHarness, completeRoom, doorGate, goLookAt, installHarness,
  lookBetween, readEnv, setRuneTile, showGoal, tc,
} from './shrine_kit';
import type { WorldScene } from '@/scenes/WorldScene';

type Dir = 'n' | 's' | 'e' | 'w';
const CW: Record<Dir, Dir> = { n: 'e', e: 's', s: 'w', w: 'n' };

/** How near the block has to be to a sightline to stand in it, in pixels. */
const OCCLUDE = 11;

class Statue implements ConformerLike {
  readonly id: string;
  x: number;
  y: number;
  facing: Dir = 's';
  dissenting = false;
  readonly sprite: Phaser.GameObjects.Sprite;

  constructor(w: WorldScene, id: string, tx: number, ty: number, private leader: boolean) {
    this.id = id;
    const p = tc(tx, ty);
    this.x = p.x;
    this.y = p.y;
    this.sprite = w.add.sprite(p.x, p.y, 'atlas', this.frame())
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + p.y);
    w.setDynamicSolidRect(Math.floor((p.x - 9) / TILE), Math.floor((p.y - 6) / TILE), 2, 1, true);
  }

  private frame(): string {
    if (this.leader) return `prop/shrine/statue_leader_${this.facing}`;
    return `prop/shrine/statue_${this.dissenting ? 'lit_' : ''}${this.facing}`;
  }

  setFacing(dir: Dir, copied: boolean): void {
    this.facing = dir;
    this.sprite.setTexture('atlas', this.frame());
    if (copied) {
      // Copying is not free of tell: a member being pulled into line flinches.
      this.sprite.setScale(0.94);
      this.sprite.scene.tweens.add({ targets: this.sprite, scale: 1, duration: 180, ease: 'Back.easeOut' });
    }
  }

  setDissenting(v: boolean): void {
    this.dissenting = v;
    this.sprite.setTexture('atlas', this.frame());
  }

  /** The point a sightline is drawn to: chest height, not feet. */
  get eye(): { x: number; y: number } { return { x: this.x, y: this.y - 20 }; }

  destroy(): void { this.sprite.destroy(); }
}

interface Lamp {
  spec: StatueSpec;
  sprite: Phaser.GameObjects.Sprite;
  light: { img: Phaser.GameObjects.Image } | null;
  lit: boolean;
}

interface S {
  rig: RoomRig;
  group: ConformityGroup;
  leader: Statue;
  followers: Statue[];
  lamps: Lamp[];
  block: PushBlock;
  gate: Gate;
  beams: Phaser.GameObjects.Graphics;
  solved: boolean;
  /** Held direction against the block, for walk-to-push. */
  shove: { dir: Dir | null; ms: number };
  hints: HintDirector;
}

let s: S | null = null;

// ── sightlines ──────────────────────────────────────────────────────────────

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** True if the block stands in the line between the crowned statue and `m`. */
function occluded(st: S, m: Statue): boolean {
  const b = { x: st.block.sprite.x, y: st.block.sprite.y - 12 };
  const a = st.leader.eye;
  const c = m.eye;
  return pointSegDist(b.x, b.y, a.x, a.y, c.x, c.y) < OCCLUDE;
}

function drawBeams(w: WorldScene, st: S, t: number): void {
  st.beams.clear();
  if (st.solved) return;
  const a = st.leader.eye;
  for (const m of st.followers) {
    if (m.dissenting) continue;
    const c = m.eye;
    const cut = occluded(st, m);
    const end = cut
      ? { x: st.block.sprite.x, y: st.block.sprite.y - 12 }
      : c;
    const pulse = 0.18 + Math.sin(t / 260 + m.x * 0.01) * 0.06;
    st.beams.lineStyle(1, SHRINE_VIOLET, cut ? pulse * 0.5 : pulse + 0.14);
    st.beams.lineBetween(a.x, a.y, end.x, end.y);
  }
}

// ── the lamps ───────────────────────────────────────────────────────────────

function setLamp(w: WorldScene, l: Lamp, on: boolean): void {
  if (l.lit === on) return;
  l.lit = on;
  if (on) {
    l.sprite.clearTint();
    if (w.anims.exists('shrine_brazier')) l.sprite.play('shrine_brazier');
    l.light = w.lighting.addPixel(l.sprite.x, l.sprite.y - 22, 58, 0xffb937, 0.62, 0.5);
    w.fx.burst(l.sprite.x, l.sprite.y - 20, 'fx/rune_activate');
    Audio.sfx('rune_activate', { volume: 0.45 });
  } else {
    l.sprite.stop();
    l.sprite.setTexture('atlas', 'prop/shrine/brazier_0');
    l.sprite.setTint(0x4a4866);
    l.light?.img.destroy();
    l.light = null;
    Audio.sfx('ui_cancel', { volume: 0.22, rate: 1.4 });
  }
}

function refresh(w: WorldScene): void {
  if (!s) return;
  let lit = 0;
  s.followers.forEach((m, i) => {
    const want = s!.lamps[i].spec.want;
    setLamp(w, s!.lamps[i], m.facing === want);
    if (m.facing === want) lit++;
  });
  R4.channel.forEach((c, i) => setRuneTile(w, c.x, c.y, 'bars', i < lit));

  if (lit === 4 && !s.solved) {
    s.solved = true;
    s.hints.stop();
    s.beams.clear();
    completeRoom(w, 4);
    s.gate.setOpen(true);
    w.shake(0.004, 260);
  }
}

// ── turning ─────────────────────────────────────────────────────────────────

function turn(w: WorldScene, m: Statue): void {
  if (!s || s.solved) return;
  s.hints.progress();
  const next = CW[m.facing];

  if (m === s.leader) {
    s.group.setLeaderFacing(next);
    w.fx.burst(m.x, m.y - 22, 'fx/link_node');
    refresh(w);
    return;
  }

  // Out of the crowned statue's sight? Then this is where the group breaks.
  if (!m.dissenting && occluded(s, m)) {
    if (!s.group.makeDissent(m)) {
      // Not gated on the badge — see the file header.
      m.setDissenting(true);
      Audio.sfx('dissent', { volume: 0.65 });
      w.fx.burst(m.x, m.y - 16, 'fx/dissent_break');
      w.shake(0.004, 200);
    }
    // One broken link and the rest stop holding. That is the whole idea of the
    // room, so it is staged rather than instantaneous: a beat, then each of the
    // others lets go in turn.
    s.followers.forEach((o, i) => {
      if (o === m || o.dissenting) return;
      w.time.delayedCall(240 + i * 130, () => {
        o.setDissenting(true);
        w.fx.burst(o.x, o.y - 16, 'fx/dissent_break');
        Audio.sfx('switch', { volume: 0.4, rate: 1.1 + i * 0.08 });
      });
    });
    w.mote?.react('alert', 1200);
  }

  // Dissenting: turns and stays turned. Still conforming: turns and is hauled
  // back, which is the failure the player has to see.
  s.group.turnMember(m, next);
  w.time.delayedCall(360, () => refresh(w));
  refresh(w);
}

// ── the block ───────────────────────────────────────────────────────────────

function shove(w: WorldScene, dir: Dir): void {
  if (!s || s.solved) return;
  const v = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[dir];
  if (s.block.push(v[0], v[1])) s.hints.progress();
}

// ── arming ──────────────────────────────────────────────────────────────────

function armRoom(w: WorldScene): void {
  if (!s) return;
  s.solved = State.has('shrine_r4_done');

  for (const m of s.followers) { m.setDissenting(false); m.setFacing('s', false); }
  s.leader.setFacing('s', false);
  s.shove = { dir: null, ms: 0 };

  // The block back where it started, which means putting its collision back too.
  const b = s.block;
  w.setDynamicSolid(b.tx, b.ty, false);
  b.tx = R4.block.x;
  b.ty = R4.block.y;
  b.sprite.setPosition(b.tx * TILE + TILE / 2, b.ty * TILE + TILE);
  b.sprite.setDepth(DEPTH.ENTITY_BASE + b.sprite.y);
  w.setDynamicSolid(b.tx, b.ty, true);

  if (s.solved) {
    // Already been through: leave it standing solved rather than re-posing a
    // puzzle the player has finished.
    s.followers.forEach((m, i) => { m.setDissenting(true); m.setFacing(s!.lamps[i].spec.want, false); });
    s.hints.stop();
  } else {
    s.hints.progress();
  }
  s.gate.setOpen(s.solved, true);
  refresh(w);
}

registerArea('shrine_conformity', {
  onEnter(w) {
    s?.rig.destroy();
    w.fx.setAmbient('shrine');

    const group = new ConformityGroup(w);
    const leader = new Statue(w, 'leader', R4.leader.x, R4.leader.y, true);
    group.add(leader, true);

    const followers: Statue[] = [];
    const lamps: Lamp[] = [];
    for (const spec of R4.followers) {
      const m = new Statue(w, spec.id, spec.x, spec.y, false);
      followers.push(m);
      group.add(m);
      const lp = tc(spec.lamp.x, spec.lamp.y);
      const sprite = w.add.sprite(lp.x, lp.y, 'atlas', 'prop/shrine/brazier_0')
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.ENTITY_BASE + lp.y)
        .setTint(0x4a4866);
      w.setDynamicSolid(Math.floor(lp.x / TILE), Math.floor((lp.y - 4) / TILE), true);
      lamps.push({ spec, sprite, light: null, lit: false });
    }

    const state: S = {
      rig: new RoomRig(w),
      group, leader, followers, lamps,
      block: new PushBlock(w, R4.block.x, R4.block.y),
      gate: doorGate(w, R4.doorOut, southWallY(ROOM_FLOOR)),
      beams: w.add.graphics().setDepth(DEPTH.ENTITY_BASE + 6),
      solved: State.has('shrine_r4_done'),
      shove: { dir: null, ms: 0 },
      hints: new HintDirector(w, [
        () => lookBetween(w, leader.eye, { x: state.block.sprite.x, y: state.block.sprite.y - 12 }),
        () => goLookAt(w, { x: state.block.sprite.x, y: state.block.sprite.y - 12 }),
        () => {
          // The goal state: the block standing in the line to the nearest one.
          const m = state.followers[2];
          const mid = { x: (leader.eye.x + m.eye.x) / 2, y: (leader.eye.y + m.eye.y) / 2 };
          showGoal(w, mid);
        },
      ]),
    };
    s = state;

    for (const m of [leader, ...followers]) {
      w.addInteractable({
        id: `r4_statue_${m.id}`,
        x: m.x, y: m.y - 20,
        label: 'Turn',
        observable: true,
        onInteract: () => turn(w, m),
      });
    }
    w.addInteractable({
      id: 'r4_block',
      x: 0, y: 0,
      follow: { get x() { return state.block.sprite.x; }, get y() { return state.block.sprite.y - 12; } },
      label: 'Push',
      observable: true,
      onInteract: () => shove(w, w.player.dir),
    });

    state.rig.onReset(() => armRoom(w));
    armRoom(w);

    installHarness(w, {
      /** Exactly what pressing the button in front of a statue does. */
      turn(id: string) {
        const m = id === 'leader' ? state.leader : state.followers.find((f) => f.id === id);
        if (m) turn(w, m);
      },
      /** Exactly what leaning on the block does. */
      push(dir: Dir) { shove(w, dir); },
      snapshot() {
        return {
          facings: Object.fromEntries([state.leader, ...state.followers].map((m) => [m.id, m.facing])),
          dissenting: state.followers.filter((m) => m.dissenting).map((m) => m.id),
          wants: Object.fromEntries(state.followers.map((m, i) => [m.id, state.lamps[i].spec.want])),
          lamps: state.lamps.filter((l) => l.lit).length,
          block: { x: state.block.tx, y: state.block.ty },
          occluded: state.followers.filter((m) => occluded(state, m)).map((m) => m.id),
          gateOpen: state.gate.open,
          solved: state.solved,
        };
      },
    });
  },

  onUpdate(w, dt) {
    if (!s) return;
    drawBeams(w, s, w.time.now);
    if (s.solved) return;

    // Walk-into-push, as well as the button. Leaning on a block until it gives
    // is the motion everybody already has in their hands from other games.
    const axis = w.keys.axis();
    const bx = s.block.tx;
    const by = s.block.ty;
    const px = w.player.tileX;
    const py = w.player.tileY;
    let want: Dir | null = null;
    if (bx === px && by === py - 1 && axis.y < -0.5) want = 'n';
    else if (bx === px && by === py + 1 && axis.y > 0.5) want = 's';
    else if (by === py && bx === px - 1 && axis.x < -0.5) want = 'w';
    else if (by === py && bx === px + 1 && axis.x > 0.5) want = 'e';
    if (want && want === s.shove.dir) {
      s.shove.ms += dt;
      if (s.shove.ms > 240) { s.shove.ms = 0; shove(w, want); }
    } else {
      s.shove = { dir: want, ms: 0 };
    }

    s.hints.update(dt);
  },

  onTrigger(w, id) {
    if (id === 'r4_enter') {
      if (State.has('shrine_r4_seen')) return false;
      State.set('shrine_r4_seen');
      void w.cutscene.run((c) => playExchange(c, TALK.shrine.roomConformity));
      return true;
    }
    return false;
  },

  onInteract(w, id) {
    if (id.startsWith('carving.')) return readEnv(w, id);
    return false;
  },

  onExit() {
    s?.beams.destroy();
    s?.block.destroy();
    s?.gate.destroy();
    s?.leader.destroy();
    s?.followers.forEach((m) => m.destroy());
    s?.lamps.forEach((l) => { l.sprite.destroy(); l.light?.img.destroy(); });
    s?.rig.destroy();
    clearHarness();
    s = null;
  },
});
