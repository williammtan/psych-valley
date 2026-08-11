/**
 * Mote — the player's Echo companion.
 *
 * Design rule from the plan: Mote is an *expressive companion*, not a tutorial
 * narrator. It never speaks. It communicates by where it looks, how brightly it
 * glows, and how it moves. So this class is mostly motion: a spring-damped
 * follow with a lazy orbit, plus a small set of gestures.
 */
import Phaser from 'phaser';
import { DEPTH } from '@/core/config';
import type { Player } from './Player';
import { hasFrame } from '@/core/textures';

type MoteState = 'follow' | 'point' | 'curious' | 'alert' | 'sad' | 'held';

export class Mote {
  sprite: Phaser.GameObjects.Sprite;
  private glow?: Phaser.GameObjects.Image;
  private trail: Phaser.GameObjects.Image[] = [];
  x: number;
  y: number;
  private vx = 0;
  private vy = 0;
  private phase = Math.random() * Math.PI * 2;
  private state: MoteState = 'follow';
  private stateUntil = 0;
  private target: { x: number; y: number } | null = null;
  private lastAnim = '';

  constructor(private scene: Phaser.Scene, x: number, y: number) {
    this.x = x;
    this.y = y;
    if (hasFrame(scene, 'fx/light_soft_64')) {
      this.glow = scene.add.image(x, y, 'atlas', 'fx/light_soft_64')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0x8ce6e6)
        .setAlpha(0.4)
        .setScale(0.75)
        .setDepth(DEPTH.LIGHT + 2);
    }
    for (let i = 0; i < 3; i++) {
      const t = scene.add.image(x, y, 'atlas', 'char/mote/idle_0')
        .setAlpha(0.28 - i * 0.07)
        .setScale(0.85 - i * 0.15)
        .setDepth(DEPTH.ENTITY_BASE + y - 2 - i);
      this.trail.push(t);
    }
    this.sprite = scene.add.sprite(x, y, 'atlas', 'char/mote/idle_0')
      .setDepth(DEPTH.ENTITY_BASE + y + 20);
    this.play('mote_idle');
  }

  private play(key: string): void {
    if (this.lastAnim === key) return;
    if (!this.scene.anims.exists(key)) return;
    this.lastAnim = key;
    this.sprite.play(key, true);
  }

  /** Look at a world point for a while — the game's primary soft hint. */
  pointAt(x: number, y: number, ms = 1800): void {
    this.state = 'point';
    this.target = { x, y };
    this.stateUntil = this.scene.time.now + ms;
    this.play('mote_alert');
  }

  react(kind: 'curious' | 'alert' | 'sad', ms = 1400): void {
    this.state = kind;
    this.stateUntil = this.scene.time.now + ms;
    this.play(`mote_${kind}`);
  }

  update(dt: number, player: Player): void {
    const now = this.scene.time.now;
    const dts = dt / 1000;
    this.phase += dts * 2.6;

    if (this.state !== 'follow' && now > this.stateUntil) {
      this.state = 'follow';
      this.target = null;
      this.play('mote_idle');
    }

    // Rest position: behind and above the player's trailing shoulder, so it
    // never covers the character or the thing in front of them.
    const behind = player.dir === 'e' ? -1 : player.dir === 'w' ? 1 : 0;
    let tx = player.x + behind * 13 + (behind === 0 ? 12 : 0);
    let ty = player.y - 26 + Math.sin(this.phase) * 3;

    if (this.state === 'point' && this.target) {
      // Drift toward the thing being indicated, but stay in the player's view.
      tx = player.x + (this.target.x - player.x) * 0.42;
      ty = player.y - 22 + (this.target.y - player.y) * 0.42;
    }

    // Critically damped spring — makes it feel alive rather than glued on.
    const k = 42, d = 11;
    this.vx += ((tx - this.x) * k - this.vx * d) * dts;
    this.vy += ((ty - this.y) * k - this.vy * d) * dts;
    this.x += this.vx * dts;
    this.y += this.vy * dts;

    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + player.y + 20);
    const pulse = 0.85 + Math.sin(this.phase * 1.6) * 0.15;
    this.sprite.setScale(this.state === 'alert' ? pulse * 1.15 : pulse);

    this.glow?.setPosition(Math.round(this.x), Math.round(this.y));
    this.glow?.setAlpha((this.state === 'sad' ? 0.16 : 0.36) + Math.sin(this.phase * 2.1) * 0.08);

    // Trail lags behind by fixed fractions of the velocity.
    this.trail.forEach((t, i) => {
      const lag = (i + 1) * 0.055;
      t.setPosition(Math.round(this.x - this.vx * lag), Math.round(this.y - this.vy * lag));
      t.setDepth(DEPTH.ENTITY_BASE + player.y + 19 - i);
      t.setFrame(this.sprite.frame.name);
    });
  }

  destroy(): void {
    this.sprite.destroy();
    this.glow?.destroy();
    this.trail.forEach((t) => t.destroy());
  }
}
