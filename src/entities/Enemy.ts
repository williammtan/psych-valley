/**
 * Enemies.
 *
 * Three types, each a different *reading* problem rather than a different DPS
 * number, which is what keeps a shallow combat system interesting:
 *   bramble   — charges in a straight line; you read the telegraph and sidestep
 *   wisp      — fires slow shots; you read spacing and close the distance
 *   mimicling — copies your last direction; you read your own inputs
 *   echomote  — copies its leader; used by the conformity puzzles
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { moveBox, type Box, type SolidGrid } from '@/core/collision';
import { emit } from '@/core/events';
import type { Player } from './Player';
import type { WorldScene } from '@/scenes/WorldScene';
import { Audio } from '@/audio/Audio';

export type EnemyKind = 'bramble' | 'wisp' | 'mimicling' | 'echomote';

interface EnemyDef {
  hp: number;
  speed: number;
  contact: number;
  sight: number;
  bodyW: number;
  bodyH: number;
  hitW: number;
  hitH: number;
  shadow: string;
  floats?: boolean;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  bramble: { hp: 2, speed: 34, contact: 1, sight: 96, bodyW: 12, bodyH: 8, hitW: 18, hitH: 18, shadow: 'fx/shadow_med' },
  wisp: { hp: 2, speed: 22, contact: 1, sight: 128, bodyW: 12, bodyH: 6, hitW: 16, hitH: 20, shadow: 'fx/shadow_small', floats: true },
  mimicling: { hp: 3, speed: 58, contact: 1, sight: 160, bodyW: 11, bodyH: 7, hitW: 16, hitH: 22, shadow: 'fx/shadow_med' },
  echomote: { hp: 2, speed: 30, contact: 1, sight: 140, bodyW: 11, bodyH: 6, hitW: 15, hitH: 15, shadow: 'fx/shadow_small' },
};

type Mode = 'idle' | 'chase' | 'telegraph' | 'attack' | 'recover' | 'hurt' | 'dying';

export interface EnemyOpts {
  /** Patrol anchor; the enemy returns here when it loses the player. */
  home?: { x: number; y: number };
  /** Never chases (statue-like puzzle enemies). */
  passive?: boolean;
  /** For echomote: the entity it copies. */
  leader?: Enemy | null;
  /** For echomote: has this one been made to dissent? */
  dissenting?: boolean;
  /** Extra HP for set-piece encounters. */
  hp?: number;
  onDeath?: (e: Enemy) => void;
}

export class Enemy {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  readonly kind: EnemyKind;
  readonly def: EnemyDef;
  opts: EnemyOpts;

  x: number;
  y: number;
  hp: number;
  dir: 'n' | 's' | 'e' | 'w' = 's';
  dead = false;
  readyToRemove = false;

  private vx = 0;
  private vy = 0;
  private mode: Mode = 'idle';
  private modeUntil = 0;
  private invulnUntil = 0;
  private nextThink = 0;
  private chargeDir: [number, number] = [0, 1];
  private lastAnim = '';
  private bob = Math.random() * Math.PI * 2;
  private shots: Array<{ img: Phaser.GameObjects.Sprite; vx: number; vy: number; life: number }> = [];
  private aggro = false;

  constructor(private scene: WorldScene, kind: EnemyKind, x: number, y: number, opts: EnemyOpts = {}) {
    this.kind = kind;
    this.def = ENEMY_DEFS[kind];
    this.opts = { home: { x, y }, ...opts };
    this.x = x;
    this.y = y;
    this.hp = opts.hp ?? this.def.hp;

    this.shadow = scene.add.image(x, y - 1, 'atlas', this.def.shadow)
      .setOrigin(0.5, 0.5).setAlpha(this.def.floats ? 0.22 : 0.38).setDepth(DEPTH.SHADOW);
    this.sprite = scene.add.sprite(x, y, 'atlas', `enemy/${kind}/idle_0`)
      .setOrigin(0.5, 1).setDepth(DEPTH.ENTITY_BASE + y);
    this.play(`${kind}_idle`);
    // Materialise effect so enemies never just pop into existence.
    this.sprite.setScale(0.5);
    this.sprite.setAlpha(0);
    scene.tweens.add({ targets: this.sprite, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
  }

  private get animDir(): 'n' | 's' | 'e' {
    return this.dir === 'w' ? 'e' : this.dir;
  }

  private play(key: string): void {
    if (this.lastAnim === key) return;
    if (!this.scene.anims.exists(key)) return;
    this.lastAnim = key;
    this.sprite.play(key, true);
  }

  get box(): Box {
    return { x: this.x, y: this.y, w: this.def.bodyW, h: this.def.bodyH };
  }

  get invulnerable(): boolean {
    return this.scene.time.now < this.invulnUntil || this.dead;
  }

  get contactDamage(): number {
    return this.dead || this.mode === 'hurt' ? 0 : this.def.contact;
  }

  overlapsRect(r: { x: number; y: number; w: number; h: number }): boolean {
    const ex = this.x - this.def.hitW / 2;
    const ey = this.y - this.def.hitH;
    return ex < r.x + r.w && ex + this.def.hitW > r.x && ey < r.y + r.h && ey + this.def.hitH > r.y;
  }

  touchesPlayer(p: Player): boolean {
    return Math.abs(p.x - this.x) < (this.def.bodyW + 10) / 2 &&
      Math.abs((p.y - 6) - (this.y - this.def.hitH / 2)) < (this.def.hitH + 12) / 2;
  }

  update(dt: number, grid: SolidGrid, player: Player): void {
    const now = this.scene.time.now;
    const dts = dt / 1000;
    this.bob += dts * 3;

    if (this.dead) {
      this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
      return;
    }

    if ((this.mode === 'hurt' || this.mode === 'recover' || this.mode === 'telegraph' || this.mode === 'attack')
      && now >= this.modeUntil) {
      this.mode = this.aggro ? 'chase' : 'idle';
    }

    const dx = player.x - this.x;
    const dy = (player.y - 8) - (this.y - 8);
    const dist = Math.hypot(dx, dy);

    if (!this.opts.passive && !this.aggro && dist < this.def.sight) {
      this.aggro = true;
      this.mode = 'chase';
      this.scene.fx.emote(this.x, this.y, 'excl', 500);
      Audio.sfx('aggro', { volume: 0.4 });
    }

    switch (this.kind) {
      case 'bramble': this.updateBramble(dt, dist, dx, dy, now); break;
      case 'wisp': this.updateWisp(dt, dist, dx, dy, now, player); break;
      case 'mimicling': this.updateMimicling(dt, now, player); break;
      case 'echomote': this.updateEchomote(dt, now); break;
    }

    if (this.mode !== 'hurt') {
      const res = moveBox(grid, this.box, this.vx * dts, this.vy * dts, { cornerAssist: false });
      if (res.hitX && this.mode === 'attack') { this.vx = 0; this.endCharge(now); }
      if (res.hitY && this.mode === 'attack') { this.vy = 0; this.endCharge(now); }
      this.x = res.x;
      this.y = res.y;
    } else {
      const res = moveBox(grid, this.box, this.vx * dts, this.vy * dts, { cornerAssist: false });
      this.x = res.x;
      this.y = res.y;
      this.vx *= 0.86;
      this.vy *= 0.86;
    }

    this.updateShots(dt, grid, player);

    const yOff = this.def.floats ? Math.sin(this.bob) * 2.2 : 0;
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y + yOff));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y);
    this.sprite.setFlipX(this.dir === 'w');
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) - 1);
    this.sprite.setAlpha(this.invulnerable && Math.floor(now / 50) % 2 === 0 ? 0.5 : 1);
  }

  // ── per-type behaviour ───────────────────────────────────────────────────

  private updateBramble(dt: number, dist: number, dx: number, dy: number, now: number): void {
    if (this.mode === 'telegraph') { this.vx = this.vy = 0; return; }
    if (this.mode === 'attack') {
      this.vx = this.chargeDir[0] * this.def.speed * 3.4;
      this.vy = this.chargeDir[1] * this.def.speed * 3.4;
      return;
    }
    if (!this.aggro || this.mode === 'hurt') { this.vx = this.vy = 0; this.play('bramble_idle'); return; }

    if (dist < 78 && now >= this.nextThink) {
      // Telegraph: hold still, compress, then commit to a straight line.
      this.mode = 'telegraph';
      this.modeUntil = now + 460;
      this.nextThink = now + 1900;
      const len = Math.hypot(dx, dy) || 1;
      this.chargeDir = [dx / len, dy / len];
      this.faceVec(dx, dy);
      this.play('bramble_charge_wind');
      this.scene.time.delayedCall(460, () => {
        if (this.dead || this.mode !== 'telegraph') return;
        this.mode = 'attack';
        this.modeUntil = this.scene.time.now + 520;
        this.play(`bramble_charge_${this.animDir}`);
        Audio.sfx('charge', { volume: 0.35 });
      });
      return;
    }

    const len = Math.hypot(dx, dy) || 1;
    this.vx = (dx / len) * this.def.speed;
    this.vy = (dy / len) * this.def.speed;
    this.faceVec(dx, dy);
    this.play(`bramble_walk_${this.animDir}`);
  }

  private endCharge(now: number): void {
    this.mode = 'recover';
    this.modeUntil = now + 340;
    this.vx = this.vy = 0;
    this.play('bramble_idle');
  }

  private updateWisp(dt: number, dist: number, dx: number, dy: number, now: number, player: Player): void {
    if (!this.aggro) { this.vx = this.vy = 0; this.play('wisp_idle'); return; }
    // Keeps its distance: closes if far, backs off if close.
    const want = 62;
    const len = Math.hypot(dx, dy) || 1;
    const sign = dist > want + 14 ? 1 : dist < want - 14 ? -1 : 0;
    this.vx = (dx / len) * this.def.speed * sign;
    this.vy = (dy / len) * this.def.speed * sign;
    // Slow orbital drift so it isn't a static turret.
    this.vx += (-dy / len) * 12;
    this.vy += (dx / len) * 12;
    this.faceVec(dx, dy);

    if (now >= this.nextThink && dist < this.def.sight) {
      this.nextThink = now + 2100;
      this.mode = 'telegraph';
      this.modeUntil = now + 420;
      this.play('wisp_aim');
      this.scene.time.delayedCall(420, () => {
        if (this.dead) return;
        this.play('wisp_shoot');
        this.fire(player.x, player.y - 8);
      });
    } else if (this.mode !== 'telegraph') {
      this.play('wisp_idle');
    }
  }

  private updateMimicling(dt: number, now: number, player: Player): void {
    if (!this.aggro) { this.vx = this.vy = 0; this.play('mimicling_idle'); return; }
    // Replays the player's movement from ~0.7s ago.
    const delay = 700;
    const want = now - delay;
    let sample = player.trail[0];
    for (let i = player.trail.length - 1; i >= 0; i--) {
      if (player.trail[i].t <= want) { sample = player.trail[i]; break; }
    }
    if (!sample) { this.vx = this.vy = 0; return; }
    const dx = sample.x - this.x;
    const dy = sample.y - this.y;
    const len = Math.hypot(dx, dy) || 1;
    if (len < 3) { this.vx = this.vy = 0; this.play('mimicling_idle'); return; }
    this.vx = (dx / len) * this.def.speed;
    this.vy = (dy / len) * this.def.speed;
    this.faceVec(dx, dy);
    this.play(`mimicling_walk_${this.animDir}`);
  }

  private updateEchomote(dt: number, now: number): void {
    const leader = this.opts.leader;
    if (this.opts.dissenting || !leader || leader.dead) {
      this.vx = this.vy = 0;
      this.play('echomote_dissent');
      return;
    }
    // Copies the leader's facing and shuffles to keep formation.
    this.dir = leader.dir;
    this.play(`echomote_walk_${this.animDir}`);
    this.vx = leader.vx * 0.9;
    this.vy = leader.vy * 0.9;
  }

  private faceVec(dx: number, dy: number): void {
    this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  }

  // ── projectiles ──────────────────────────────────────────────────────────

  private fire(tx: number, ty: number): void {
    const a = Math.atan2(ty - (this.y - 10), tx - this.x);
    const speed = 62;
    const img = this.scene.add.sprite(this.x, this.y - 10, 'atlas', 'enemy/wisp/shot_0')
      .setDepth(DEPTH.ENTITY_BASE + this.y + 4);
    if (this.scene.anims.exists('wisp_shot')) img.play('wisp_shot');
    this.shots.push({ img, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 3200 });
    Audio.sfx('shoot', { volume: 0.3 });
  }

  private updateShots(dt: number, grid: SolidGrid, player: Player): void {
    const dts = dt / 1000;
    for (const s of this.shots) {
      s.img.x += s.vx * dts;
      s.img.y += s.vy * dts;
      s.life -= dt;
      s.img.setDepth(DEPTH.ENTITY_BASE + s.img.y);
      const tx = Math.floor(s.img.x / TILE);
      const ty = Math.floor(s.img.y / TILE);
      const blocked = ty < 0 || ty >= grid.length || tx < 0 || tx >= grid[0].length || grid[ty][tx];
      const hit = Math.abs(player.x - s.img.x) < 9 && Math.abs((player.y - 10) - s.img.y) < 12;
      if (hit && !player.invulnerable) {
        player.hurt(1, s.img.x, s.img.y);
        s.life = 0;
      }
      if (blocked) s.life = 0;
      if (s.life <= 0) {
        this.scene.fx.impact(s.img.x, s.img.y);
        s.img.destroy();
      }
    }
    this.shots = this.shots.filter((s) => s.life > 0);
  }

  // ── damage ───────────────────────────────────────────────────────────────

  hurt(amount: number, fromX: number, fromY: number): void {
    if (this.invulnerable) return;
    this.hp -= amount;
    this.invulnUntil = this.scene.time.now + 320;
    this.scene.fx.impact(this.x, this.y - this.def.hitH / 2, amount > 1);
    this.scene.shake(0.0035, 90);
    this.scene.setTimeScale(0.25, 45);
    Audio.sfx('hit', { volume: 0.5 });

    const a = Math.atan2(this.y - fromY, this.x - fromX);
    this.vx = Math.cos(a) * 150;
    this.vy = Math.sin(a) * 150;
    this.mode = 'hurt';
    this.modeUntil = this.scene.time.now + 240;
    this.aggro = true;
    this.play(`${this.kind}_hurt`);

    if (this.hp <= 0) this.die();
  }

  die(): void {
    if (this.dead) return;
    this.dead = true;
    this.mode = 'dying';
    this.vx = this.vy = 0;
    this.shadow.destroy();
    this.play(`${this.kind}_die`);
    Audio.sfx('enemy_die', { volume: 0.45 });
    emit('enemy:died', { kind: this.kind, x: this.x, y: this.y });
    this.opts.onDeath?.(this);
    const finish = () => {
      this.scene.tweens.add({
        targets: this.sprite, alpha: 0, y: this.sprite.y - 6, duration: 240,
        onComplete: () => { this.readyToRemove = true; },
      });
    };
    if (this.scene.anims.exists(`${this.kind}_die`)) {
      this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, finish);
      this.scene.time.delayedCall(1200, finish);
    } else {
      finish();
    }
  }

  destroy(): void {
    this.shots.forEach((s) => s.img.destroy());
    this.shots = [];
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
