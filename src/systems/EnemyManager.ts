/**
 * Enemy spawning, updating and combat resolution.
 *
 * Combat is ~20% of playtime, so it is deliberately shallow but crisp:
 * a readable telegraph, a fair window to react, generous hit feedback.
 */
import { DEPTH } from '@/core/config';
import type { SolidGrid } from '@/core/collision';
import { emit } from '@/core/events';
import type { WorldScene } from '@/scenes/WorldScene';
import { Enemy, type EnemyKind, ENEMY_DEFS } from '@/entities/Enemy';

export class EnemyManager {
  list: Enemy[] = [];
  /** Set while a room's gate is sealed until every enemy dies. */
  private onCleared?: () => void;

  constructor(private scene: WorldScene) {}

  spawn(kind: EnemyKind, tileX: number, tileY: number, opts: Partial<Enemy['opts']> = {}): Enemy {
    const e = new Enemy(this.scene, kind, tileX * 16 + 8, tileY * 16 + 16, opts);
    this.list.push(e);
    return e;
  }

  spawnMany(kind: EnemyKind, positions: Array<[number, number]>): Enemy[] {
    return positions.map(([x, y]) => this.spawn(kind, x, y));
  }

  /** Seal a room until everything currently alive is dead. */
  lockUntilCleared(cb: () => void): void {
    this.onCleared = cb;
  }

  update(dt: number, grid: SolidGrid): void {
    const player = this.scene.player;
    let alive = 0;

    for (const e of this.list) {
      if (e.dead) continue;
      alive++;
      e.update(dt, grid, player);

      // Player weapon → enemy
      if (player.hitbox.active && !e.invulnerable && e.overlapsRect(player.hitbox)) {
        e.hurt(1, player.x, player.y);
      }

      // Enemy body → player
      if (e.contactDamage > 0 && !player.invulnerable && e.touchesPlayer(player)) {
        player.hurt(e.contactDamage, e.x, e.y);
      }
    }

    for (const e of this.list) if (e.dead && e.readyToRemove) e.destroy();
    this.list = this.list.filter((e) => !(e.dead && e.readyToRemove));

    if (this.onCleared && alive === 0 && this.list.every((e) => e.dead)) {
      const cb = this.onCleared;
      this.onCleared = undefined;
      cb();
    }
  }

  get aliveCount(): number {
    return this.list.filter((e) => !e.dead).length;
  }

  clear(): void {
    this.list.forEach((e) => e.destroy());
    this.list = [];
    this.onCleared = undefined;
  }
}

export { ENEMY_DEFS, DEPTH };
export type { EnemyKind };
