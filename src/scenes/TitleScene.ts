import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_H, GAME_W } from '@/core/config';
import { State, GameState } from '@/core/state';
import { makeText, type TextHandle } from '@/ui/text';
import { Audio } from '@/audio/Audio';
import { hasFrame } from '@/core/textures';

export class TitleScene extends Phaser.Scene {
  private index = 0;
  private items: Array<{ label: string; action: () => void; handle?: TextHandle }> = [];

  constructor() {
    super('Title');
  }

  create(): void {
    const cx = GAME_W / 2;

    this.cameras.main.setBackgroundColor('#0d0b14');

    // A quiet, moving backdrop: drifting motes over a deep gradient.
    const g = this.add.graphics();
    for (let y = 0; y < GAME_H; y++) {
      const t = y / GAME_H;
      const r = Math.round(13 + t * 24);
      const gr = Math.round(11 + t * 16);
      const b = Math.round(20 + t * 40);
      g.fillStyle((r << 16) | (gr << 8) | b, 1);
      g.fillRect(0, y, GAME_W, 1);
    }
    for (let i = 0; i < 34; i++) {
      const frame = hasFrame(this, 'fx/firefly_0') ? 'fx/firefly_0' : 'ui/fade_pixel';
      const s = this.add.image(Math.random() * GAME_W, Math.random() * GAME_H, 'atlas', frame)
        .setAlpha(0.1 + Math.random() * 0.5);
      if (frame === 'ui/fade_pixel') s.setTint(0xc8a6ff);
      this.tweens.add({
        targets: s,
        y: s.y - 30 - Math.random() * 60,
        alpha: 0,
        duration: 5000 + Math.random() * 6000,
        repeat: -1,
        delay: Math.random() * 4000,
      });
    }

    const title = makeText(this, cx, 92, 'PROJECT PSYCHE', 'display', { tint: COLORS.parchment });
    title.setOrigin(0.5, 0.5);
    const sub = makeText(this, cx, 110, 'a valley that remembers', 'body', { tint: 0x7a4fbd });
    sub.setOrigin(0.5, 0.5);

    this.tweens.add({ targets: title.obj, alpha: { from: 0, to: 1 }, y: { from: 96, to: 92 }, duration: 900, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: sub.obj, alpha: { from: 0, to: 1 }, duration: 900, delay: 400 });

    const hasSave = GameState.hasSave();
    this.items = [];
    if (hasSave) {
      this.items.push({ label: 'Continue', action: () => { State.load(); this.start(); } });
    }
    this.items.push({ label: hasSave ? 'New game' : 'Begin', action: () => { State.reset(); State.clearSave(); this.start(); } });

    this.items.forEach((item, i) => {
      const h = makeText(this, cx, 150 + i * 16, item.label, 'body', { tint: COLORS.parchmentDim });
      h.setOrigin(0.5, 0.5);
      item.handle = h;
    });

    const hint = makeText(this, cx, GAME_H - 22, 'WASD move   SPACE interact   J attack   SHIFT dash   TAB journal', 'body', { tint: 0x463a5c });
    hint.setOrigin(0.5, 0.5);

    this.highlight();

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') this.move(-1);
      else if (k === 'arrowdown' || k === 's') this.move(1);
      else if (k === ' ' || k === 'enter' || k === 'e') this.items[this.index].action();
    });
  }

  private move(d: number): void {
    this.index = (this.index + d + this.items.length) % this.items.length;
    Audio.sfx('ui_move', { volume: 0.3 });
    this.highlight();
  }

  private highlight(): void {
    this.items.forEach((it, i) => {
      it.handle?.setTint(i === this.index ? COLORS.goldLight : 0x5d4e78);
    });
  }

  private start(): void {
    Audio.sfx('ui_confirm', { volume: 0.5 });
    this.cameras.main.fadeOut(420, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('World');
      this.scene.launch('UI');
    });
  }
}
