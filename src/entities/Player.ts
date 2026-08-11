/**
 * The player character.
 *
 * Movement is deliberately not Phaser arcade physics — see core/collision.ts.
 * The feel targets are:
 *   - zero input latency: pressing a direction moves you on the same frame
 *   - fast ramp-up but not instant, so the character has weight
 *   - full speed retained when sliding along a wall
 *   - attacks and dashes are buffered, so a press just before you're able to
 *     act still fires (nothing feels more broken than a dropped input)
 */
import Phaser from 'phaser';
import { PLAYER, DEPTH, TILE } from '@/core/config';
import { moveBox, unstick, type Box, type SolidGrid } from '@/core/collision';
import type { InputManager } from '@/core/input';
import { State } from '@/core/state';
import { emit } from '@/core/events';

export type Dir = 'n' | 's' | 'e' | 'w';

export const DIR_VEC: Record<Dir, [number, number]> = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
};

type Mode = 'free' | 'attack' | 'dash' | 'hurt' | 'locked';

export class Player {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  dir: Dir = 's';
  mode: Mode = 'free';

  x = 0;
  y = 0;
  vx = 0;
  vy = 0;

  private modeUntil = 0;
  private dashReadyAt = 0;
  private invulnUntil = 0;
  private attackBufferedAt = -9999;
  private dashBufferedAt = -9999;
  private dashDir: [number, number] = [0, 1];
  private stepAccum = 0;
  private lastAnim = '';
  /** Set by the scene each frame. */
  grid: SolidGrid = [];
  /** Ring buffer of recent positions, used by the Mimicling enemy. */
  readonly trail: Array<{ x: number; y: number; dir: Dir; t: number }> = [];

  hitbox = { x: 0, y: 0, w: 0, h: 0, active: false };

  constructor(private scene: Phaser.Scene, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.shadow = scene.add.image(x, y, 'atlas', 'fx/shadow_med')
      .setOrigin(0.5, 0.5)
      .setAlpha(0.4)
      .setDepth(DEPTH.SHADOW);
    this.sprite = scene.add.sprite(x, y, 'atlas', 'char/player/idle_s_0')
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + y);
  }

  get box(): Box {
    return { x: this.x, y: this.y, w: PLAYER.BODY_W, h: PLAYER.BODY_H };
  }

  get tileX(): number { return Math.floor(this.x / TILE); }
  get tileY(): number { return Math.floor((this.y - 1) / TILE); }

  get invulnerable(): boolean { return this.scene.time.now < this.invulnUntil; }
  get busy(): boolean { return this.mode !== 'free'; }

  setPosition(x: number, y: number, dir?: Dir): void {
    this.x = x;
    this.y = y;
    if (dir) this.dir = dir;
    this.vx = this.vy = 0;
    this.mode = 'free';
    this.syncSprite();
  }

  lock(): void {
    this.mode = 'locked';
    this.vx = this.vy = 0;
    this.playAnim(`player_idle_${this.animDir}`);
  }

  unlock(): void {
    if (this.mode === 'locked') this.mode = 'free';
  }

  face(dir: Dir): void {
    this.dir = dir;
    this.playAnim(`player_idle_${this.animDir}`);
    this.sprite.setFlipX(this.dir === 'w');
  }

  faceTowards(x: number, y: number): void {
    const dx = x - this.x;
    const dy = y - this.y;
    this.face(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n'));
  }

  private get animDir(): 'n' | 's' | 'e' {
    return this.dir === 'w' ? 'e' : this.dir;
  }

  private playAnim(key: string): void {
    if (this.lastAnim === key) return;
    if (!this.scene.anims.exists(key)) return;
    this.lastAnim = key;
    this.sprite.play(key, true);
  }

  update(dt: number, input: InputManager, grid: SolidGrid): void {
    this.grid = grid;
    const now = this.scene.time.now;
    const dts = dt / 1000;

    if (input.justPressed('attack')) this.attackBufferedAt = now;
    if (input.justPressed('dash')) this.dashBufferedAt = now;

    if (this.mode === 'attack' || this.mode === 'dash' || this.mode === 'hurt') {
      if (now >= this.modeUntil) this.mode = 'free';
    }

    if (this.mode === 'free') {
      // Buffered actions fire the instant we're able to act.
      if (now - this.attackBufferedAt <= PLAYER.ATTACK_BUFFER_MS) {
        this.attackBufferedAt = -9999;
        this.startAttack();
      } else if (now - this.dashBufferedAt <= PLAYER.ATTACK_BUFFER_MS && now >= this.dashReadyAt) {
        this.dashBufferedAt = -9999;
        this.startDash(input);
      }
    }

    let targetVx = 0;
    let targetVy = 0;

    if (this.mode === 'free') {
      const axis = input.axis();
      targetVx = axis.x * PLAYER.SPEED;
      targetVy = axis.y * PLAYER.SPEED;
      if (axis.x !== 0 || axis.y !== 0) {
        // Facing prefers the dominant axis, and only flips on a clear change so
        // diagonal movement doesn't make the sprite jitter between two facings.
        if (Math.abs(axis.x) > Math.abs(axis.y) + 0.15) this.dir = axis.x > 0 ? 'e' : 'w';
        else if (Math.abs(axis.y) > Math.abs(axis.x) + 0.15) this.dir = axis.y > 0 ? 's' : 'n';
        this.playAnim(`player_walk_${this.animDir}`);
      } else {
        this.playAnim(`player_idle_${this.animDir}`);
      }
    } else if (this.mode === 'dash') {
      targetVx = this.dashDir[0] * PLAYER.DASH_SPEED;
      targetVy = this.dashDir[1] * PLAYER.DASH_SPEED;
    } else if (this.mode === 'attack') {
      // Small forward lunge, decaying over the attack window.
      const t = 1 - (this.modeUntil - now) / PLAYER.ATTACK_MS;
      const push = Math.max(0, 1 - t * 2.2);
      const [dx, dy] = DIR_VEC[this.dir];
      targetVx = dx * PLAYER.ATTACK_LUNGE * push;
      targetVy = dy * PLAYER.ATTACK_LUNGE * push;
    } else if (this.mode === 'hurt') {
      targetVx = this.vx * 0.86;
      targetVy = this.vy * 0.86;
    }

    const rate = this.mode === 'free'
      ? (targetVx === 0 && targetVy === 0 ? PLAYER.DECEL : PLAYER.ACCEL)
      : 1;
    // Frame-rate independent exponential approach.
    const k = 1 - Math.pow(1 - rate, dt / 16.667);
    this.vx += (targetVx - this.vx) * k;
    this.vy += (targetVy - this.vy) * k;
    if (Math.abs(this.vx) < 1.5) this.vx = 0;
    if (Math.abs(this.vy) < 1.5) this.vy = 0;

    const res = moveBox(grid, this.box, this.vx * dts, this.vy * dts, {
      cornerAssist: this.mode === 'free',
    });
    this.x = res.x;
    this.y = res.y;
    if (res.hitX) this.vx = 0;
    if (res.hitY) this.vy = 0;

    // Footstep dust on the beat of the walk cycle.
    const speed = Math.hypot(this.vx, this.vy);
    if (this.mode === 'free' && speed > 20) {
      this.stepAccum += speed * dts;
      if (this.stepAccum > 20) {
        this.stepAccum = 0;
        emit('player:step', { x: this.x, y: this.y });
      }
    } else {
      this.stepAccum = 12;
    }

    if (this.mode === 'dash') emit('player:dashtrail', { x: this.x, y: this.y, dir: this.dir });

    this.trail.push({ x: this.x, y: this.y, dir: this.dir, t: now });
    if (this.trail.length > 240) this.trail.shift();

    this.updateHitbox(now);
    this.syncSprite();

    // Damage flash while invulnerable.
    this.sprite.setAlpha(this.invulnerable && Math.floor(now / 60) % 2 === 0 ? 0.45 : 1);
  }

  private syncSprite(): void {
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y);
    this.sprite.setFlipX(this.dir === 'w');
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) - 1);
    this.shadow.setVisible(this.mode !== 'dash' || true);
  }

  private startAttack(): void {
    this.mode = 'attack';
    this.modeUntil = this.scene.time.now + PLAYER.ATTACK_MS;
    this.lastAnim = '';
    this.playAnim(`player_attack_${this.animDir}`);
    emit('player:attack', { x: this.x, y: this.y, dir: this.dir });
  }

  private startDash(input: InputManager): void {
    const axis = input.axis();
    let [dx, dy] = axis.x === 0 && axis.y === 0 ? DIR_VEC[this.dir] : [axis.x, axis.y];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    this.dashDir = [dx, dy];
    this.mode = 'dash';
    this.modeUntil = this.scene.time.now + PLAYER.DASH_MS;
    this.dashReadyAt = this.scene.time.now + PLAYER.DASH_MS + PLAYER.DASH_COOLDOWN_MS;
    this.invulnUntil = Math.max(this.invulnUntil, this.scene.time.now + PLAYER.DASH_IFRAMES_MS);
    this.lastAnim = '';
    this.playAnim(`player_dash_${this.animDir}`);
    emit('player:dash', { x: this.x, y: this.y, dir: this.dir });
  }

  /** The attack's damage rectangle, live only during the strike frames. */
  private updateHitbox(now: number): void {
    if (this.mode !== 'attack') { this.hitbox.active = false; return; }
    const elapsed = PLAYER.ATTACK_MS - (this.modeUntil - now);
    // Active window: after the wind-up, through the strike.
    const active = elapsed > 70 && elapsed < 190;
    this.hitbox.active = active;
    if (!active) return;
    const [dx, dy] = DIR_VEC[this.dir];
    const reach = 20;
    const width = 26;
    this.hitbox.w = dx !== 0 ? reach : width;
    this.hitbox.h = dy !== 0 ? reach : width;
    this.hitbox.x = this.x + dx * (reach / 2 + 4) - this.hitbox.w / 2;
    this.hitbox.y = (this.y - 10) + dy * (reach / 2 + 2) - this.hitbox.h / 2;
  }

  hurt(amount: number, fromX: number, fromY: number): boolean {
    if (this.invulnerable || this.mode === 'locked') return false;
    State.hp = Math.max(0, State.hp - amount);
    this.invulnUntil = this.scene.time.now + PLAYER.HURT_IFRAMES_MS;
    this.mode = 'hurt';
    this.modeUntil = this.scene.time.now + 220;
    const a = Math.atan2(this.y - fromY, this.x - fromX);
    this.vx = Math.cos(a) * PLAYER.KNOCKBACK;
    this.vy = Math.sin(a) * PLAYER.KNOCKBACK;
    emit('player:hurt', { x: this.x, y: this.y, hp: State.hp, amount });
    if (State.hp <= 0) emit('player:down', { x: this.x, y: this.y });
    return true;
  }

  heal(amount: number): void {
    const before = State.hp;
    State.hp = Math.min(State.maxHp, State.hp + amount);
    if (State.hp !== before) emit('player:heal', { hp: State.hp });
  }

  /** Point in front of the player used for interaction searches. */
  facingPoint(distance = 12): { x: number; y: number } {
    const [dx, dy] = DIR_VEC[this.dir];
    return { x: this.x + dx * distance, y: this.y - 8 + dy * distance };
  }

  ensureUnstuck(): void {
    const p = unstick(this.grid, this.box);
    this.x = p.x;
    this.y = p.y;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
