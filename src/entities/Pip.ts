/**
 * PIP — Mira's cat.
 *
 * Pip carries the whole first quest, so his job is to be readable from posture
 * alone. There is no fear bar anywhere in the game; the player judges how
 * frightened he is from three things, in this order of legibility:
 *
 *   1. WHERE HE IS.   While he is wedged under something, `fear` drives his
 *                     position along a line from deep under the furniture to
 *                     out in the open. Progress is spatial before it is
 *                     anything else — you can see it from across the room.
 *   2. HOW HE HOLDS HIMSELF.  hide → flattened, scared → crouched and staring,
 *                     calm → sitting up, happy → the tail goes vertical.
 *   3. TREMBLING.     Amplitude scales with fear and stops entirely at zero.
 *
 * Movement is the other half of the character. Cats do not walk at a constant
 * velocity: they burst, stop, look at nothing, and burst again. That cadence is
 * `burst`/`rest` below and it is most of why he reads as an animal rather than
 * a sprite being lerped.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { on } from '@/core/events';
import { hasFrame } from '@/core/textures';
import { moveBox, type Box, type SolidGrid } from '@/core/collision';
import { Audio } from '@/audio/Audio';
import type { WorldScene } from '@/scenes/WorldScene';

export type PipState = 'idle' | 'walk' | 'scared' | 'hiding' | 'calm' | 'happy' | 'following';
export type PipDir = 'n' | 's' | 'e' | 'w';

/** Pixels/second. A trot is what he uses to follow; a bolt is pure panic. */
const SPEED_WALK = 30;
const SPEED_TROT = 48;
const SPEED_BOLT = 128;

/** How far out from under the furniture a completely calm Pip ends up. */
const EMERGE_DISTANCE = 30;

export interface PipOptions {
  facing?: PipDir;
  /** Wander a little around his starting tile when idle. */
  wander?: boolean;
}

export class Pip {
  readonly id = 'pip';
  sprite: Phaser.GameObjects.Sprite;
  shadow?: Phaser.GameObjects.Image;

  x: number;
  y: number;
  dir: PipDir = 's';
  state: PipState = 'idle';

  /** 0 = at ease, 100 = flattened under the furthest corner of the furniture. */
  fear = 0;

  /** Set while he is wedged under something; position is then fear-driven. */
  private anchored = false;
  private anchorX = 0;
  private anchorY = 0;
  private emergeAngle = Math.PI / 2;
  /** Smoothed version of `fear`, so posture changes glide instead of snapping. */
  private shownFear = 0;

  private home: { x: number; y: number };
  private wandering = false;
  private target: { x: number; y: number } | null = null;
  private followTarget: { x: number; y: number } | null = null;
  private onArrive?: () => void;
  private waypoints: Array<{ x: number; y: number }> = [];
  private bolting = false;

  private resting = false;
  private phaseUntil = 0;
  private idleUntil = 0;
  private t = 0;
  private lastAnim = '';
  private dead = false;
  private speed = SPEED_WALK;

  constructor(private scene: WorldScene, tx: number, ty: number, opts: PipOptions = {}) {
    this.x = tx * TILE + TILE / 2;
    this.y = ty * TILE + TILE;
    this.home = { x: this.x, y: this.y };
    this.dir = opts.facing ?? 's';
    this.wandering = !!opts.wander;

    if (hasFrame(scene, 'fx/shadow_med')) {
      this.shadow = scene.add.image(this.x, this.y - 1, 'atlas', 'fx/shadow_med')
        .setOrigin(0.5, 0.5)
        .setScale(0.62, 0.55)
        .setAlpha(0.32)
        .setDepth(DEPTH.SHADOW);
    }
    this.sprite = scene.add.sprite(this.x, this.y, 'atlas', 'char/pip/idle_0')
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + this.y);
    this.play('pip_idle');
  }

  // ── queries ──────────────────────────────────────────────────────────────

  get box(): Box {
    return { x: this.x, y: this.y, w: 8, h: 5 };
  }

  get tileX(): number { return Math.floor(this.x / TILE); }
  get tileY(): number { return Math.floor((this.y - 1) / TILE); }

  /** True once he has come out and will walk with you. */
  get settled(): boolean { return this.fear <= 0.5; }

  distanceTo(x: number, y: number): number {
    return Math.hypot(x - this.x, y - this.y);
  }

  // ── fear ─────────────────────────────────────────────────────────────────

  /**
   * Wedge him under a piece of furniture. `outDir` is the direction he will
   * emerge in as he calms down — usually the side the room is on.
   */
  hideUnder(tx: number, ty: number, outDir: PipDir = 's'): void {
    this.anchored = true;
    this.anchorX = tx * TILE + TILE / 2;
    this.anchorY = ty * TILE + TILE;
    this.emergeAngle = outDir === 'n' ? -Math.PI / 2 : outDir === 'e' ? 0 : outDir === 'w' ? Math.PI : Math.PI / 2;
    this.target = null;
    this.followTarget = null;
    this.bolting = false;
    this.applyAnchoredPosition(true);
  }

  /** Let go of the furniture — he is free to walk again. */
  release(): void {
    this.anchored = false;
    this.home = { x: this.x, y: this.y };
  }

  setFear(v: number): void {
    this.fear = Math.max(0, Math.min(100, v));
  }

  changeFear(delta: number): number {
    this.setFear(this.fear + delta);
    return this.fear;
  }

  /** A visible flinch: he shrinks back, whether or not fear actually changed. */
  spook(): void {
    this.shownFear = Math.min(100, Math.max(this.shownFear, this.fear) + 22);
    this.setPose('scared');
    Audio.sfx('cat_hiss', { volume: 0.35 });
    this.scene.fx.emote(this.x, this.y - 2, 'sweat', 500);
    if (!this.anchored) {
      // Not wedged under anything: scramble a short way from where he stands.
      const a = Math.random() * Math.PI * 2;
      this.target = { x: this.x + Math.cos(a) * 26, y: this.y + Math.sin(a) * 20 };
      this.speed = SPEED_BOLT * 0.7;
      this.idleUntil = this.scene.time.now + 900;
    }
  }

  /** One safe bell: a small, legible unclenching. */
  settleStep(): void {
    this.scene.fx.emote(this.x, this.y - 2, this.fear <= 0 ? 'heart' : 'note', 620);
    Audio.sfx(this.fear <= 0 ? 'purr' : 'cat_mew', { volume: 0.3 });
  }

  /** Panic run along a scripted path, ending wedged under (tx, ty). */
  bolt(path: Array<[number, number]>, tx: number, ty: number, outDir: PipDir = 's'): void {
    this.anchored = false;
    this.bolting = true;
    this.speed = SPEED_BOLT;
    this.setPose('scared');
    Audio.sfx('cat_hiss', { volume: 0.5 });
    this.waypoints = path.map(([px, py]) => ({ x: px * TILE + TILE / 2, y: py * TILE + TILE }));
    this.target = this.waypoints.shift() ?? null;
    this.onArrive = () => {
      this.bolting = false;
      this.hideUnder(tx, ty, outDir);
    };
  }

  // ── movement orders ──────────────────────────────────────────────────────

  /** Follow a moving point (the hand bell). Pass null to stop. */
  follow(target: { x: number; y: number } | null): void {
    this.followTarget = target;
    if (target) {
      this.anchored = false;
      this.speed = SPEED_TROT;
    }
  }

  goTo(tx: number, ty: number, onArrive?: () => void): void {
    this.anchored = false;
    this.bolting = false;
    this.speed = SPEED_TROT;
    this.target = { x: tx * TILE + TILE / 2, y: ty * TILE + TILE };
    this.onArrive = onArrive;
  }

  setWander(on: boolean): void {
    this.wandering = on;
    this.home = { x: this.x, y: this.y };
  }

  face(dir: PipDir): void {
    this.dir = dir;
    this.sprite.setFlipX(dir === 'w');
  }

  faceTowards(x: number, y: number): void {
    const dx = x - this.x;
    const dy = y - this.y;
    this.face(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n'));
  }

  setPose(state: PipState): void {
    this.state = state;
    this.idleUntil = Math.max(this.idleUntil, this.scene.time.now + 300);
  }

  /**
   * A calm, ordinary reaction to a bell — ears up, a glance, back to business.
   * This is the whole point of the quest's epilogue: the same sound, and
   * nothing happens.
   */
  noteBell(x: number, y: number): void {
    if (this.fear > 4) { this.spook(); return; }
    this.faceTowards(x, y);
    this.setPose('calm');
    this.idleUntil = this.scene.time.now + 1500;
    this.scene.fx.emote(this.x, this.y - 2, 'note', 700);
  }

  // ── per-frame ────────────────────────────────────────────────────────────

  update(dt: number, grid: SolidGrid): void {
    if (this.dead) return;
    const now = this.scene.time.now;
    this.t += dt;

    // Posture tracks fear with a little lag so it eases rather than snaps.
    this.shownFear += (this.fear - this.shownFear) * Math.min(1, dt / 260);

    if (this.anchored) {
      this.applyAnchoredPosition(false);
      this.sync();
      return;
    }

    if (this.followTarget) this.stepTowards(this.followTarget, dt, grid, 20);
    else if (this.target) this.stepTowards(this.target, dt, grid, 3);
    else if (this.wandering && now > this.idleUntil) this.pickWanderTarget(now);
    else this.stand(now);

    this.sync();
  }

  private stand(now: number): void {
    if (this.state === 'walk' || this.state === 'following') this.state = this.fear > 20 ? 'scared' : 'idle';
    if (now > this.idleUntil) {
      // A sudden look at nothing in particular. Very cat.
      if (Math.random() < 0.02) {
        const dirs: PipDir[] = ['n', 's', 'e', 'w'];
        this.face(dirs[Math.floor(Math.random() * dirs.length)]);
        this.idleUntil = now + 700 + Math.random() * 1800;
      }
    }
    this.applyIdlePose();
  }

  private applyIdlePose(): void {
    if (this.fear >= 45) this.state = 'scared';
    else if (this.fear >= 12) this.state = 'calm';
    else if (this.state !== 'happy' && this.state !== 'calm') this.state = 'idle';
    this.playForState();
  }

  private pickWanderTarget(now: number): void {
    if (Math.random() > 0.012) return;
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * 34;
    this.target = { x: this.home.x + Math.cos(a) * r, y: this.home.y + Math.sin(a) * r * 0.7 };
    this.speed = SPEED_WALK;
    this.idleUntil = now + 400;
  }

  /**
   * Burst-and-pause travel. `stopWithin` lets a follower hang back rather than
   * standing on top of what it is following.
   */
  private stepTowards(to: { x: number; y: number }, dt: number, grid: SolidGrid, stopWithin: number): void {
    const now = this.scene.time.now;
    const dx = to.x - this.x;
    const dy = to.y - this.y;
    const d = Math.hypot(dx, dy);

    if (d <= stopWithin) {
      if (this.waypoints.length) {
        this.target = this.waypoints.shift()!;
        return;
      }
      if (this.target === to) {
        this.target = null;
        const cb = this.onArrive;
        this.onArrive = undefined;
        cb?.();
      }
      this.state = this.fear > 20 ? 'scared' : this.fear > 0 ? 'calm' : 'idle';
      this.playForState();
      return;
    }

    if (!this.bolting) {
      if (now > this.phaseUntil) {
        this.resting = !this.resting;
        this.phaseUntil = now + (this.resting ? 110 + Math.random() * 260 : 320 + Math.random() * 420);
      }
      if (this.resting) {
        this.state = this.fear > 20 ? 'scared' : 'idle';
        this.playForState();
        return;
      }
    }

    const step = (this.speed * dt) / 1000;
    const nx = (dx / d) * step;
    const ny = (dy / d) * step;
    const res = moveBox(grid, this.box, nx, ny, { cornerAssist: true });
    // Wedged against geometry mid-panic: give up on this leg rather than grind.
    if (res.hitX && res.hitY && this.waypoints.length) {
      this.target = this.waypoints.shift()!;
    }
    this.x = res.x;
    this.y = res.y;
    this.face(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n'));
    this.state = this.followTarget ? 'following' : 'walk';
    this.playForState();
  }

  /** Position and posture while wedged under furniture, driven entirely by fear. */
  private applyAnchoredPosition(instant: boolean): void {
    const f = Math.max(0, Math.min(100, this.shownFear)) / 100;
    // Non-linear so the first ring shows a real move rather than a nudge.
    const out = Math.pow(1 - f, 0.72) * EMERGE_DISTANCE;
    const tx = this.anchorX + Math.cos(this.emergeAngle) * out;
    const ty = this.anchorY + Math.sin(this.emergeAngle) * out;
    if (instant) { this.x = tx; this.y = ty; } else {
      this.x += (tx - this.x) * 0.14;
      this.y += (ty - this.y) * 0.14;
    }

    if (this.shownFear >= 55) this.state = 'hiding';
    else if (this.shownFear >= 22) this.state = 'scared';
    else if (this.shownFear > 0.5) this.state = 'calm';
    else this.state = 'happy';
    this.face(this.emergeAngle === Math.PI / 2 ? 's' : this.emergeAngle === -Math.PI / 2 ? 'n' : this.emergeAngle === 0 ? 'e' : 'w');
    this.playForState();
  }

  private playForState(): void {
    switch (this.state) {
      case 'hiding': this.play('pip_hide'); break;
      case 'scared': this.play('pip_scared'); break;
      case 'calm': this.play('pip_sit'); break;
      case 'happy': this.play('pip_happy'); break;
      case 'walk':
      case 'following': this.play(`pip_walk_${this.dir === 'w' ? 'e' : this.dir}`); break;
      default: this.play('pip_idle');
    }
  }

  private play(key: string): void {
    if (this.lastAnim === key) return;
    if (!this.scene.anims.exists(key)) return;
    this.lastAnim = key;
    this.sprite.play(key, true);
  }

  private sync(): void {
    // Trembling: fast, sub-pixel-ish, and gone completely once he is calm.
    const tremble = this.shownFear > 12 ? Math.sin(this.t / 26) * (this.shownFear / 100) * 1.4 : 0;
    this.sprite.setPosition(Math.round(this.x + tremble), Math.round(this.y));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y);
    // Flattened when frightened; upright when not.
    this.sprite.setScale(1, 1 - (this.shownFear / 100) * 0.1);
    this.sprite.setFlipX(this.dir === 'w');
    this.shadow?.setPosition(Math.round(this.x), Math.round(this.y) - 1);
    this.shadow?.setAlpha(this.state === 'hiding' ? 0.14 : 0.3);
  }

  destroy(): void {
    this.dead = true;
    this.sprite.destroy();
    this.shadow?.destroy();
  }
}

/**
 * Drop a calm Pip into any map and let him look after himself.
 *
 * This exists so the rest of the town can show the quest's result without
 * re-implementing him: after the inn, Pip turns up on a doorstep, the tower
 * bell rings, and he flicks an ear and goes back to sleep. Plan §25 asks for
 * exactly that, and it is the cheapest reinforcement in the game.
 */
export function placeCalmPip(w: WorldScene, tx: number, ty: number, opts: PipOptions = {}): Pip {
  const pip = new Pip(w, tx, ty, { wander: true, ...opts });
  pip.setFear(0);
  pip.setPose('calm');

  const step = (_t: number, dt: number) => pip.update(Math.min(dt, 50), w.collisionGrid());
  w.events.on(Phaser.Scenes.Events.UPDATE, step);

  // Any bell within earshot gets a glance and nothing more.
  const offCue = on('cue', (p: { kind: string; x: number; y: number }) => {
    if (!p.kind.includes('bell')) return;
    if (pip.distanceTo(p.x, p.y) > 220) return;
    pip.noteBell(p.x, p.y);
  });

  // Maps are swapped without restarting the scene, so detach on the next load.
  const offMap = on('map:entered', () => {
    w.events.off(Phaser.Scenes.Events.UPDATE, step);
    offCue();
    offMap();
    pip.destroy();
  });

  return pip;
}
