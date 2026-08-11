/**
 * Lighting.
 *
 * Implemented as a single additive light layer plus a multiply darkness layer,
 * both drawn in screen space. The Stardew mine reference makes the rule
 * explicit: darkness must never hide gameplay information, so every light is
 * placed to do compositional work — it frames the readable play space rather
 * than merely tinting it.
 */
import Phaser from 'phaser';
import { DEPTH, GAME_H, GAME_W } from '@/core/config';
import type { LightDef, MapDef } from '@/world/types';
import type { WorldScene } from '@/scenes/WorldScene';
import { hasFrame } from '@/core/textures';

interface Light extends LightDef {
  img: Phaser.GameObjects.Image;
  phase: number;
}

export class Lighting {
  private lights: Light[] = [];
  private darkness?: Phaser.GameObjects.Rectangle;
  private vignette?: Phaser.GameObjects.Image;
  private layer?: Phaser.GameObjects.Container;
  private level = 0;
  private tintColor = 0x000000;

  constructor(private scene: WorldScene) {}

  configure(def: MapDef): void {
    this.clear();
    this.level = def.darkness ?? 0;

    this.layer = this.scene.add.container(0, 0).setDepth(DEPTH.LIGHT).setScrollFactor(0);

    if (this.level > 0) {
      this.tintColor = def.tint ?? (def.id.startsWith('shrine') ? 0x0d1030 : 0x141026);
      this.darkness = this.scene.add.rectangle(0, 0, GAME_W, GAME_H, this.tintColor, this.level)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH.LIGHT);
      this.darkness.setBlendMode(Phaser.BlendModes.MULTIPLY);
    }

    if (hasFrame(this.scene, 'fx/vignette')) {
      this.vignette = this.scene.add.image(0, 0, 'atlas', 'fx/vignette')
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH.VIGNETTE)
        .setAlpha(def.indoor ? 0.5 : def.darkness ? 0.75 : 0.32);
    }

    for (const l of def.lights ?? []) this.add(l);
  }

  add(def: LightDef): void {
    const size = def.radius <= 40 ? 64 : def.radius <= 80 ? 128 : 192;
    const frame = `fx/light_soft_${size}`;
    if (!hasFrame(this.scene, frame)) return;
    const img = this.scene.add.image(def.x * 16 + 8, def.y * 16 + 8, 'atlas', frame)
      .setDepth(DEPTH.LIGHT + 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale((def.radius * 2) / size)
      .setAlpha(def.intensity ?? 0.55);
    if (def.color) img.setTint(def.color);
    this.lights.push({ ...def, img, phase: Math.random() * Math.PI * 2 });
  }

  /** Add a light in pixel coordinates (used by props and moving lights). */
  addPixel(x: number, y: number, radius: number, color?: number, intensity?: number, flicker?: number): Light {
    this.add({ x: x / 16 - 0.5, y: y / 16 - 0.5, radius, color, intensity, flicker });
    return this.lights[this.lights.length - 1];
  }

  update(dt: number): void {
    for (const l of this.lights) {
      if (!l.flicker) continue;
      l.phase += dt / 1000 * (6 + l.flicker * 6);
      const base = l.intensity ?? 0.55;
      const n = Math.sin(l.phase) * 0.5 + Math.sin(l.phase * 2.7) * 0.3 + Math.sin(l.phase * 5.3) * 0.2;
      l.img.setAlpha(base * (1 + n * l.flicker * 0.35));
    }
  }

  setDarkness(level: number, duration = 400): void {
    this.level = level;
    if (!this.darkness) {
      this.darkness = this.scene.add.rectangle(0, 0, GAME_W, GAME_H, this.tintColor || 0x141026, 0)
        .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.LIGHT)
        .setBlendMode(Phaser.BlendModes.MULTIPLY);
    }
    this.scene.tweens.add({ targets: this.darkness, fillAlpha: level, duration });
  }

  clear(): void {
    this.lights.forEach((l) => l.img.destroy());
    this.lights = [];
    this.darkness?.destroy();
    this.darkness = undefined;
    this.vignette?.destroy();
    this.vignette = undefined;
    this.layer?.destroy();
    this.layer = undefined;
  }
}
