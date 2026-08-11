/**
 * HUD: hearts, abilities, current objective.
 *
 * Deliberately minimal and out of the way — the plan wants the world to be the
 * interface. Hearts sit top-left, learned abilities under them, and the current
 * objective is a single line, not a quest log.
 */
import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_W } from '@/core/config';
import { on } from '@/core/events';
import { State } from '@/core/state';
import { makeText, type TextHandle } from './text';
import { hasFrame } from '@/core/textures';

const ABILITIES = ['observe', 'link', 'recall', 'dissent'] as const;

export class Hud {
  private root: Phaser.GameObjects.Container;
  private hearts: Phaser.GameObjects.Image[] = [];
  private heartFallback: Phaser.GameObjects.Rectangle[] = [];
  private abilityIcons = new Map<string, Phaser.GameObjects.Image>();
  private objective: TextHandle;
  private objectiveBg: Phaser.GameObjects.Container;
  private lastObjective = '';
  private pulse = 0;

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(DEPTH.HUD);

    this.buildHearts();
    this.buildAbilities();

    this.objectiveBg = scene.add.container(0, 0);
    this.root.add(this.objectiveBg);
    this.objective = makeText(scene, 10, 40, '', 'body', { tint: COLORS.parchmentDim });
    this.root.add(this.objective.obj);

    on('player:hurt', () => this.refreshHearts(true));
    on('player:heal', () => this.refreshHearts(false));
    on('ability', () => this.buildAbilities());
    this.refreshHearts(false);
  }

  private buildHearts(): void {
    this.hearts.forEach((h) => h.destroy());
    this.heartFallback.forEach((h) => h.destroy());
    this.hearts = [];
    this.heartFallback = [];
    const hasArt = hasFrame(this.scene, 'ui/heart_full');
    for (let i = 0; i < Math.ceil(State.maxHp / 2); i++) {
      if (hasArt) {
        const img = this.scene.add.image(9 + i * 11, 9, 'atlas', 'ui/heart_full').setOrigin(0.5);
        this.hearts.push(img);
        this.root.add(img);
      } else {
        const r = this.scene.add.rectangle(9 + i * 11, 9, 8, 8, 0xc2456a).setOrigin(0.5);
        this.heartFallback.push(r);
        this.root.add(r);
      }
    }
  }

  private buildAbilities(): void {
    let x = 9;
    for (const a of ABILITIES) {
      if (!State.hasAbility(a)) {
        this.abilityIcons.get(a)?.destroy();
        this.abilityIcons.delete(a);
        continue;
      }
      let icon = this.abilityIcons.get(a);
      const frame = `ui/icon_${a}`;
      if (!icon) {
        if (!hasFrame(this.scene, frame)) continue;
        icon = this.scene.add.image(x, 24, 'atlas', frame).setOrigin(0.5);
        this.root.add(icon);
        this.abilityIcons.set(a, icon);
        // Pop-in when newly learned.
        icon.setScale(0);
        this.scene.tweens.add({ targets: icon, scale: 1, duration: 320, ease: 'Back.easeOut' });
      }
      icon.setPosition(x, 24);
      x += 17;
    }
  }

  private refreshHearts(damaged: boolean): void {
    const hasArt = this.hearts.length > 0;
    if (hasArt) {
      this.hearts.forEach((img, i) => {
        const v = State.hp - i * 2;
        img.setFrame(v >= 2 ? 'ui/heart_full' : v === 1 ? 'ui/heart_half' : 'ui/heart_empty');
      });
    } else {
      this.heartFallback.forEach((r, i) => {
        const v = State.hp - i * 2;
        r.setFillStyle(v >= 2 ? 0xc2456a : v === 1 ? 0x8c2b47 : 0x3a3050);
      });
    }
    if (damaged) {
      const target = this.hearts.length ? this.hearts : this.heartFallback;
      this.scene.tweens.add({
        targets: target, scale: 1.35, duration: 90, yoyo: true, ease: 'Quad.easeOut',
      });
    }
  }

  update(dt: number): void {
    const obj = State.currentObjective();
    if (obj !== this.lastObjective) {
      this.lastObjective = obj ?? '';
      this.objective.setText(obj ? `▸ ${obj}` : '');
      if (obj) {
        this.objective.setAlpha(0);
        this.scene.tweens.add({ targets: this.objective.obj, alpha: 1, duration: 400 });
      }
    }
    this.pulse += dt / 1000;
  }

  setVisible(v: boolean): void {
    this.root.setVisible(v);
  }
}
