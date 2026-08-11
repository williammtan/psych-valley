/**
 * Visual effects and ambient particle life.
 *
 * Two jobs:
 *   1. One-shot effects fired by gameplay (slash, impact, dust, insight burst).
 *   2. Ambient life — drifting pollen, leaves, fireflies, chimney smoke. This is
 *      most of what separates "a tilemap" from "a place"; a still screenshot of
 *      Stardew always has something in the air.
 */
import Phaser from 'phaser';
import { DEPTH, GAME_H, GAME_W } from '@/core/config';
import type { MapDef } from '@/world/types';
import { on } from '@/core/events';
import type { WorldScene } from '@/scenes/WorldScene';
import { hasFrame } from '@/core/textures';

interface Ambient {
  frames: string;
  count: number;
  speed: [number, number];
  drift: [number, number];
  alpha: [number, number];
  scale?: number;
  depth?: number;
  tint?: number;
}

const AMBIENT_PRESETS: Record<string, Ambient[]> = {
  town_day: [
    { frames: 'fx/pollen', count: 26, speed: [4, 11], drift: [-7, -2], alpha: [0.25, 0.6] },
    { frames: 'fx/leaf_green', count: 7, speed: [7, 16], drift: [-12, 4], alpha: [0.5, 0.85] },
  ],
  town_evening: [
    { frames: 'fx/firefly', count: 22, speed: [3, 9], drift: [-4, -3], alpha: [0.4, 0.95] },
    { frames: 'fx/leaf_gold', count: 6, speed: [6, 14], drift: [-10, 5], alpha: [0.45, 0.8] },
  ],
  woods: [
    { frames: 'fx/pollen', count: 14, speed: [2, 6], drift: [-3, -1], alpha: [0.18, 0.4] },
    { frames: 'fx/leaf_green', count: 10, speed: [6, 13], drift: [-9, 6], alpha: [0.4, 0.75] },
    { frames: 'fx/firefly', count: 8, speed: [2, 6], drift: [-2, -2], alpha: [0.3, 0.7] },
  ],
  shrine: [
    { frames: 'fx/echo_wisp', count: 16, speed: [2, 7], drift: [0, -6], alpha: [0.25, 0.7] },
  ],
  indoor: [
    { frames: 'fx/pollen', count: 10, speed: [1, 4], drift: [1, -2], alpha: [0.15, 0.35] },
  ],
  none: [],
};

interface Mote {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  phase: number;
  wobble: number;
  baseAlpha: number;
}

export class FxManager {
  private motes: Mote[] = [];
  private oneShots: Phaser.GameObjects.Sprite[] = [];
  private ambientKey = 'none';

  constructor(private scene: WorldScene) {
    on('player:step', (p: { x: number; y: number }) => this.dust(p.x, p.y));
    on('player:attack', (p: { x: number; y: number; dir: string }) => this.slash(p.x, p.y, p.dir));
    on('player:dashtrail', (p: { x: number; y: number }) => this.dashTrail(p.x, p.y));
    on('player:hurt', (p: { x: number; y: number }) => this.burst(p.x, p.y - 10, 'fx/hurt_flash'));
  }

  configure(def: MapDef): void {
    this.clear();
    this.ambientKey = def.indoor ? 'indoor'
      : def.id.startsWith('shrine') ? 'shrine'
      : def.id.startsWith('woods') ? 'woods'
      : 'town_day';
    this.spawnAmbient();
  }

  /** Switch ambient life without rebuilding the map (day → festival evening). */
  setAmbient(key: string): void {
    this.ambientKey = key;
    this.motes.forEach((m) => m.img.destroy());
    this.motes = [];
    this.spawnAmbient();
  }

  private spawnAmbient(): void {
    const presets = AMBIENT_PRESETS[this.ambientKey] ?? [];
    const cam = this.scene.cameras.main;
    for (const p of presets) {
      for (let i = 0; i < p.count; i++) {
        const frame = this.pickFrame(p.frames);
        if (!frame) continue;
        const img = this.scene.add.image(
          cam.scrollX + Math.random() * GAME_W,
          cam.scrollY + Math.random() * GAME_H,
          'atlas', frame,
        ).setDepth(p.depth ?? DEPTH.WEATHER);
        const a = p.alpha[0] + Math.random() * (p.alpha[1] - p.alpha[0]);
        img.setAlpha(a);
        if (p.tint) img.setTint(p.tint);
        this.motes.push({
          img,
          vx: p.drift[0] + (Math.random() - 0.5) * p.speed[1],
          vy: p.drift[1] + (Math.random() - 0.5) * p.speed[0],
          phase: Math.random() * Math.PI * 2,
          wobble: 4 + Math.random() * 10,
          baseAlpha: a,
        });
      }
    }
  }

  private pickFrame(base: string): string | null {
    for (let i = 0; i < 6; i++) {
      const n = `${base}_${i}`;
      if (hasFrame(this.scene, n)) return n;
    }
    return hasFrame(this.scene, base) ? base : null;
  }

  update(dt: number): void {
    const dts = dt / 1000;
    const cam = this.scene.cameras.main;
    const pad = 24;
    for (const m of this.motes) {
      m.phase += dts * 2;
      m.img.x += (m.vx + Math.sin(m.phase) * m.wobble) * dts;
      m.img.y += m.vy * dts;
      m.img.setAlpha(m.baseAlpha * (0.72 + 0.28 * Math.sin(m.phase * 1.7)));
      // Wrap around the camera view so density stays constant as you walk.
      const vx = cam.scrollX, vy = cam.scrollY;
      if (m.img.x < vx - pad) m.img.x = vx + GAME_W + pad;
      if (m.img.x > vx + GAME_W + pad) m.img.x = vx - pad;
      if (m.img.y < vy - pad) m.img.y = vy + GAME_H + pad;
      if (m.img.y > vy + GAME_H + pad) m.img.y = vy - pad;
    }
  }

  // ── one-shots ────────────────────────────────────────────────────────────

  private play(x: number, y: number, animKey: string, frame: string, depth: number, opts: {
    scale?: number; alpha?: number; flipX?: boolean; angle?: number; tint?: number;
  } = {}): Phaser.GameObjects.Sprite | null {
    if (!hasFrame(this.scene, frame)) return null;
    const s = this.scene.add.sprite(Math.round(x), Math.round(y), 'atlas', frame).setDepth(depth);
    if (opts.scale) s.setScale(opts.scale);
    if (opts.alpha !== undefined) s.setAlpha(opts.alpha);
    if (opts.flipX) s.setFlipX(true);
    if (opts.angle) s.setAngle(opts.angle);
    if (opts.tint) s.setTint(opts.tint);
    if (this.scene.anims.exists(animKey)) {
      s.play(animKey);
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    } else {
      this.scene.tweens.add({ targets: s, alpha: 0, duration: 220, onComplete: () => s.destroy() });
    }
    this.oneShots.push(s);
    return s;
  }

  /**
   * Footsteps and dash ghosts fire at the right moments — the feel probe
   * confirmed the cadence — but both were pitched so quietly they did not read
   * at 1x. Movement feedback you cannot see is the same as none, so both now
   * start bright and grow as they fade rather than sitting at a constant low
   * alpha.
   */
  dust(x: number, y: number): void {
    const s = this.play(x + (Math.random() - 0.5) * 4, y - 1, 'fx_dust', 'fx/dust_0',
      DEPTH.ENTITY_BASE + y - 2, { alpha: 0.95, flipX: Math.random() > 0.5 });
    if (!s) return;
    s.setScale(0.8);
    this.scene.tweens.add({ targets: s, scaleX: 1.35, scaleY: 1.15, duration: 260, ease: 'Quad.easeOut' });
  }

  dashTrail(x: number, y: number): void {
    const s = this.play(x, y, 'fx_dash_trail', 'fx/dash_trail_0', DEPTH.ENTITY_BASE + y - 3,
      { alpha: 0.9, tint: 0x95d0b3 });
    if (!s) return;
    // Each ghost stretches and thins as it is left behind, so a roll reads as
    // one continuous wake rather than a row of separate puffs.
    this.scene.tweens.add({
      targets: s, scaleX: 1.5, scaleY: 0.75, alpha: 0, duration: 220, ease: 'Quad.easeOut',
    });
  }

  slash(x: number, y: number, dir: string): void {
    const d = dir === 'w' ? 'e' : dir;
    const off: Record<string, [number, number]> = { n: [0, -18], s: [0, 4], e: [16, -8], w: [-16, -8] };
    const o = off[dir] ?? [0, 0];
    this.play(x + o[0], y + o[1] - 8, `fx_slash_${d}`, `fx/slash_${d}_0`, DEPTH.ENTITY_BASE + y + 4, {
      flipX: dir === 'w',
    });
  }

  impact(x: number, y: number, big = false): void {
    this.play(x, y, big ? 'fx_crit' : 'fx_impact', big ? 'fx/crit_0' : 'fx/impact_0', DEPTH.ENTITY_BASE + y + 8);
  }

  burst(x: number, y: number, base: string, depth?: number): void {
    const key = base.replace(/^fx\//, 'fx_');
    this.play(x, y, key, `${base}_0`, depth ?? DEPTH.ENTITY_BASE + y + 6);
  }

  observePing(x: number, y: number): void {
    this.play(x, y, 'fx_observe_ping', 'fx/observe_ping_0', DEPTH.LIGHT - 1);
  }

  observeMark(x: number, y: number): void {
    const s = this.play(x, y, 'fx_observe_mark', 'fx/observe_mark_0', DEPTH.LIGHT - 1);
    if (!s) return;
    // Marks linger, then fade — Observe says "something here matters", and then
    // gets out of the way.
    s.removeAllListeners(Phaser.Animations.Events.ANIMATION_COMPLETE);
    this.scene.tweens.add({ targets: s, alpha: 0, delay: 2000, duration: 500, onComplete: () => s.destroy() });
  }

  bellRing(x: number, y: number, small = false): void {
    this.play(x, y, small ? 'fx_bell_small' : 'fx_bell_ring', small ? 'fx/bell_small_0' : 'fx/bell_ring_0', DEPTH.LIGHT - 2);
  }

  insight(x: number, y: number): void {
    this.play(x, y, 'fx_insight_burst', 'fx/insight_burst_0', DEPTH.LIGHT - 1, { scale: 1 });
  }

  /** Simple sprite-based emote above an entity's head. */
  emote(x: number, y: number, kind: string, duration = 1400): void {
    const frame = `fx/emote_${kind}`;
    if (!hasFrame(this.scene, frame)) return;
    const s = this.scene.add.image(Math.round(x), Math.round(y) - 34, 'atlas', frame)
      .setDepth(DEPTH.ENTITY_BASE + y + 40)
      .setAlpha(0);
    this.scene.tweens.add({ targets: s, alpha: 1, y: s.y - 4, duration: 140, ease: 'Back.easeOut' });
    this.scene.tweens.add({
      targets: s, alpha: 0, y: s.y - 8, delay: duration, duration: 220,
      onComplete: () => s.destroy(),
    });
  }

  clear(): void {
    this.motes.forEach((m) => m.img.destroy());
    this.motes = [];
    this.oneShots.forEach((s) => s.destroy());
    this.oneShots = [];
  }
}
