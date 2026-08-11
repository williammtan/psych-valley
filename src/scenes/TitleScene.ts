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
    this.buildValley();

    for (let i = 0; i < 34; i++) {
      const frame = hasFrame(this, 'fx/firefly_0') ? 'fx/firefly_0' : 'ui/fade_pixel';
      const s = this.add.image(Math.random() * GAME_W, 60 + Math.random() * (GAME_H - 60), 'atlas', frame)
        .setAlpha(0.1 + Math.random() * 0.5)
        .setDepth(60);
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

    const title = makeText(this, cx, 78, 'PROJECT PSYCHE', 'display', { tint: COLORS.parchment });
    title.setOrigin(0.5, 0.5);
    title.setDepth(80);
    const sub = makeText(this, cx, 96, 'a valley that remembers', 'body', { tint: 0x9d85c6 });
    sub.setOrigin(0.5, 0.5);
    sub.setDepth(80);

    this.tweens.add({ targets: title.obj, alpha: { from: 0, to: 1 }, y: { from: 82, to: 78 }, duration: 900, ease: 'Cubic.easeOut' });
    this.tweens.add({ targets: sub.obj, alpha: { from: 0, to: 1 }, duration: 900, delay: 400 });

    const hasSave = GameState.hasSave();
    this.items = [];
    if (hasSave) {
      this.items.push({ label: 'Continue', action: () => { State.load(); this.start(); } });
    }
    this.items.push({ label: hasSave ? 'New game' : 'Begin', action: () => { State.reset(); State.clearSave(); this.start(); } });

    this.items.forEach((item, i) => {
      const h = makeText(this, cx, 132 + i * 15, item.label, 'body', { tint: COLORS.parchmentDim });
      h.setOrigin(0.5, 0.5);
      h.setDepth(80);
      item.handle = h;
    });

    const hint = makeText(this, cx, GAME_H - 9, 'WASD move   SPACE interact   J attack   SHIFT dash   TAB journal', 'body', { tint: 0x5d4e78 });
    hint.setOrigin(0.5, 0.5);
    hint.setDepth(80);

    this.highlight();

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'arrowup' || k === 'w') this.move(-1);
      else if (k === 'arrowdown' || k === 's') this.move(1);
      else if (k === ' ' || k === 'enter' || k === 'e') this.items[this.index].action();
    });
  }

  /**
   * The valley at dusk, as a silhouette.
   *
   * Built from the game's own building and tree sprites tinted almost to
   * black, so the title screen is unmistakably *this* place: the bell tower
   * stands over the roofline, warm window lights sit at the horizon, and a
   * violet glow leaks up from under the hill — the Echo, before you know what
   * it is. Three parallax bands give it depth without any new art.
   */
  private buildValley(): void {
    const horizon = GAME_H - 46;

    // Warm dusk band behind the ridge, cooling upward.
    const glow = this.add.graphics().setDepth(5);
    for (let i = 0; i < 34; i++) {
      const t = i / 34;
      const a = 0.055 * (1 - t);
      glow.fillStyle(0xff9d5c, a);
      glow.fillRect(0, horizon - i, GAME_W, 1);
    }

    // Violet leak from beneath the valley floor.
    const echo = this.add.graphics().setDepth(6);
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      echo.fillStyle(0x7a4fbd, 0.09 * (1 - t));
      echo.fillRect(0, GAME_H - 26 + i, GAME_W, 1);
    }

    const silhouette = (frame: string, x: number, y: number, tint: number, scale = 1, depth = 10) => {
      if (!hasFrame(this, frame)) return null;
      const img = this.add.image(Math.round(x), Math.round(y), 'atlas', frame)
        .setOrigin(0.5, 1)
        .setTint(tint)
        .setDepth(depth);
      if (scale !== 1) img.setScale(scale);
      return img;
    };

    // Far ridge: a run of dark treetops, flattened so it reads as distance.
    const farTrees = ['prop/woods/tree_dark_0', 'prop/woods/tree_dark_1', 'prop/town/tree_pine_0', 'prop/town/tree_oak_2'];
    for (let x = -10; x < GAME_W + 20; x += 13 + ((x * 7) % 9)) {
      const f = farTrees[(x * 3) % farTrees.length];
      const img = silhouette(f, x, horizon + 8, 0x1a1730, 0.4, 10);
      img?.setAlpha(0.85);
    }

    // Mid band: the town's roofline, with the bell tower as the landmark.
    const mid = 0x241d33;
    silhouette('prop/build/house_c', 46, horizon + 22, mid, 0.5, 20);
    silhouette('prop/build/house_a', 92, horizon + 26, mid, 0.48, 21);
    silhouette('prop/build/belltower', 148, horizon + 30, mid, 0.55, 24);
    silhouette('prop/build/inn', 204, horizon + 27, mid, 0.5, 22);
    silhouette('prop/build/house_d', 258, horizon + 24, mid, 0.47, 21);
    silhouette('prop/build/workshop', 312, horizon + 27, mid, 0.46, 22);
    silhouette('prop/build/house_b', 368, horizon + 23, mid, 0.48, 21);
    silhouette('prop/build/store', 424, horizon + 26, mid, 0.45, 22);

    // Amber windows: a few warm points along the roofline so the town is lit.
    const lampPositions = [52, 96, 150, 208, 262, 316, 372, 428];
    for (const lx of lampPositions) {
      const dot = this.add.rectangle(lx, horizon + 14 + ((lx * 5) % 6), 1, 1, 0xffb937, 0.9).setDepth(26);
      this.tweens.add({
        targets: dot,
        alpha: { from: 0.55, to: 1 },
        duration: 1400 + ((lx * 37) % 900),
        yoyo: true,
        repeat: -1,
      });
      if (hasFrame(this, 'fx/light_soft_64')) {
        this.add.image(dot.x, dot.y, 'atlas', 'fx/light_soft_64')
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(0xffb937)
          .setAlpha(0.16)
          .setScale(0.42)
          .setDepth(25);
      }
    }

    // Near band: foreground grass and trees, almost black, framing the frame.
    const near = 0x110e1c;
    this.add.rectangle(0, GAME_H - 18, GAME_W, 18, near, 1).setOrigin(0, 0).setDepth(40);
    silhouette('prop/town/tree_oak_0', 18, GAME_H + 6, near, 0.85, 42);
    silhouette('prop/woods/tree_dark_2', 460, GAME_H + 8, near, 0.8, 42);
    silhouette('prop/town/bush_1', 62, GAME_H - 6, near, 0.9, 41);
    silhouette('prop/town/bush_2', 418, GAME_H - 4, near, 0.9, 41);
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
