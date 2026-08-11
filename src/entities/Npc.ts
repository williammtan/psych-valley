/**
 * Townsfolk.
 *
 * NPCs are what make Lumen Vale feel inhabited, so the default behaviour is
 * deliberately not "stand still": they walk a path, pause, look around, and
 * turn to face the player when spoken to. A town of statues reads as a
 * prototype no matter how good the art is.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { moveBox, type Box, type SolidGrid } from '@/core/collision';
import type { Dir } from './Player';

export interface NpcConfig {
  id: string;
  /** Sprite/animation prefix, e.g. 'mira' → anims 'mira_idle_s'. */
  actor: string;
  x: number;
  y: number;
  facing?: Dir;
  path?: Array<[number, number]>;
  dwell?: number;
  speed?: number;
  /** Never moves (shopkeeper behind a counter, someone sitting). */
  stationary?: boolean;
  /** Uses the 'sit' pose. */
  sitting?: boolean;
  /** Small idle emote shown occasionally above the head. */
  emote?: string;
}

export class Npc {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  dir: Dir;
  readonly id: string;
  readonly actor: string;

  x: number;
  y: number;
  private pathIndex = 0;
  private waitUntil = 0;
  private speed: number;
  private lastAnim = '';
  private cfg: NpcConfig;
  private frozenUntil = 0;
  /** Set while the player is talking to this NPC. */
  talking = false;
  /** Overrides the walk path; used by cutscenes. */
  scriptTarget: { x: number; y: number; onArrive?: () => void } | null = null;
  private lookTimer = 0;

  constructor(private scene: Phaser.Scene, cfg: NpcConfig) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.actor = cfg.actor;
    this.x = cfg.x * TILE + TILE / 2;
    this.y = cfg.y * TILE + TILE;
    this.dir = cfg.facing ?? 's';
    this.speed = cfg.speed ?? 32;

    this.shadow = scene.add.image(this.x, this.y - 1, 'atlas', 'fx/shadow_med')
      .setOrigin(0.5, 0.5).setAlpha(0.38).setDepth(DEPTH.SHADOW);
    this.sprite = scene.add.sprite(this.x, this.y, 'atlas', `char/${cfg.actor}/idle_s_0`)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + this.y);
    this.playAnim(`${cfg.actor}_${cfg.sitting ? 'sit' : 'idle'}_${this.animDir}`);
    this.lookTimer = 1200 + Math.random() * 3000;
  }

  private get animDir(): 'n' | 's' | 'e' {
    return this.dir === 'w' ? 'e' : this.dir;
  }

  private playAnim(key: string): void {
    if (this.lastAnim === key) return;
    if (!this.scene.anims.exists(key)) {
      // Fall back to the actor's south idle, then to a static frame.
      const alt = `${this.actor}_idle_s`;
      if (key !== alt && this.scene.anims.exists(alt)) { this.playAnim(alt); return; }
      return;
    }
    this.lastAnim = key;
    this.sprite.play(key, true);
  }

  get box(): Box {
    return { x: this.x, y: this.y, w: 10, h: 6 };
  }

  face(dir: Dir): void {
    this.dir = dir;
    this.sprite.setFlipX(dir === 'w');
    this.playAnim(`${this.actor}_${this.talking ? 'talk' : this.cfg.sitting ? 'sit' : 'idle'}_${this.animDir}`);
  }

  faceTowards(x: number, y: number): void {
    const dx = x - this.x;
    const dy = y - this.y;
    this.face(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n'));
  }

  /** Stop walking for a while (used when the player is nearby / during scenes). */
  freeze(ms: number): void {
    this.frozenUntil = this.scene.time.now + ms;
  }

  walkTo(tileX: number, tileY: number, onArrive?: () => void): void {
    this.scriptTarget = { x: tileX * TILE + TILE / 2, y: tileY * TILE + TILE, onArrive };
  }

  update(dt: number, grid: SolidGrid): void {
    const now = this.scene.time.now;
    const dts = dt / 1000;

    if (this.talking || now < this.frozenUntil) {
      this.playAnim(`${this.actor}_${this.talking ? 'talk' : this.cfg.sitting ? 'sit' : 'idle'}_${this.animDir}`);
      this.sync();
      return;
    }

    let target: { x: number; y: number } | null = null;
    let arriveCb: (() => void) | undefined;

    if (this.scriptTarget) {
      target = this.scriptTarget;
      arriveCb = this.scriptTarget.onArrive;
    } else if (!this.cfg.stationary && this.cfg.path && this.cfg.path.length > 1) {
      if (now < this.waitUntil) {
        this.playAnim(`${this.actor}_idle_${this.animDir}`);
        // Idle "looking around" so stationary moments still read as alive.
        this.lookTimer -= dt;
        if (this.lookTimer <= 0) {
          this.lookTimer = 1600 + Math.random() * 3400;
          const dirs: Dir[] = ['n', 's', 'e', 'w'];
          this.face(dirs[Math.floor(Math.random() * dirs.length)]);
        }
        this.sync();
        return;
      }
      const wp = this.cfg.path[this.pathIndex];
      target = { x: wp[0] * TILE + TILE / 2, y: wp[1] * TILE + TILE };
    }

    if (!target) {
      this.playAnim(`${this.actor}_${this.cfg.sitting ? 'sit' : 'idle'}_${this.animDir}`);
      this.lookTimer -= dt;
      if (this.lookTimer <= 0 && !this.cfg.sitting) {
        this.lookTimer = 2400 + Math.random() * 4000;
        const dirs: Dir[] = ['n', 's', 'e', 'w'];
        this.face(dirs[Math.floor(Math.random() * dirs.length)]);
      }
      this.sync();
      return;
    }

    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 2) {
      if (this.scriptTarget) {
        this.scriptTarget = null;
        arriveCb?.();
      } else if (this.cfg.path) {
        this.pathIndex = (this.pathIndex + 1) % this.cfg.path.length;
        this.waitUntil = now + (this.cfg.dwell ?? 1.6) * 1000 * (0.6 + Math.random() * 0.8);
      }
      this.playAnim(`${this.actor}_idle_${this.animDir}`);
      this.sync();
      return;
    }

    const nx = (dx / dist) * this.speed * dts;
    const ny = (dy / dist) * this.speed * dts;
    const res = moveBox(grid, this.box, nx, ny, { cornerAssist: true });
    this.x = res.x;
    this.y = res.y;

    if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'e' : 'w';
    else this.dir = dy > 0 ? 's' : 'n';
    this.sprite.setFlipX(this.dir === 'w');
    this.playAnim(`${this.actor}_walk_${this.animDir}`);

    // If we're wedged, skip to the next waypoint rather than grinding a wall.
    if (res.hitX && res.hitY && this.cfg.path) {
      this.pathIndex = (this.pathIndex + 1) % this.cfg.path.length;
      this.waitUntil = now + 600;
    }

    this.sync();
  }

  private sync(): void {
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) - 1);
  }

  setPose(pose: string): void {
    this.playAnim(`${this.actor}_${pose}_${this.animDir}`);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
