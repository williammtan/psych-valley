import Phaser from 'phaser';
import { GAME_W, GAME_H, COLORS } from '@/core/config';
import { initArt, art, type ArtManifest } from '@/world/art';
import { ensureFallbacks } from '@/core/fallback';
import { State } from '@/core/state';
import { registerAllQuests } from '@/quests';
import { Audio } from '@/audio/Audio';
import { hasFrame } from '@/core/textures';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;
    const bar = this.add.rectangle(cx, cy + 20, 160, 3, COLORS.gold).setOrigin(0.5);
    bar.scaleX = 0;
    const frame = this.add.rectangle(cx, cy + 20, 164, 7, COLORS.ink).setOrigin(0.5).setDepth(-1);
    const title = this.add.text(cx, cy - 10, 'PROJECT PSYCHE', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: '11px',
      color: '#d8c69c',
    }).setOrigin(0.5);
    title.setLetterSpacing?.(3);

    this.load.on('progress', (p: number) => { bar.scaleX = p; });
    this.load.once('complete', () => { frame.destroy(); bar.destroy(); title.destroy(); });

    this.load.image('tiles', 'assets/tiles.png');
    this.load.atlas('atlas', 'assets/atlas.png', 'assets/atlas.json');
    this.load.bitmapFont('body', 'assets/font_body.png', 'assets/font_body.xml');
    this.load.bitmapFont('display', 'assets/font_display.png', 'assets/font_display.xml');
  }

  create(): void {
    const manifest = this.cache.json.get('art') as ArtManifest;
    initArt(manifest);

    ensureFallbacks(this);

    for (const def of art().anims) {
      if (this.anims.exists(def.key)) continue;
      const frames = def.frames
        .filter((f) => hasFrame(this, f))
        .map((f) => ({ key: 'atlas', frame: f }));
      if (!frames.length) continue;
      this.anims.create({
        key: def.key,
        frames,
        frameRate: def.frameRate,
        repeat: def.repeat,
      });
    }

    registerAllQuests();
    Audio.init(this);

    const params = new URLSearchParams(location.search);
    if (params.get('skiptitle') === '1' || params.has('map') || params.has('jump')) {
      if (params.get('fresh') !== '0') State.reset();
      this.scene.start('World');
      this.scene.launch('UI');
    } else {
      this.scene.start('Title');
    }

    document.getElementById('boot')?.classList.add('hidden');
  }
}
