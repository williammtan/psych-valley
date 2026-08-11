/**
 * The Insight Card.
 *
 * This is the moment the game names something the player already understands.
 * It appears three times in the whole slice, so it is allowed to be theatrical:
 * the world dims, a card blooms in, the concept gets its name, and one sentence
 * explains it. The formal vocabulary is *not* here — it waits in the journal.
 */
import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_H, GAME_W } from '@/core/config';
import { emit, on } from '@/core/events';
import { CONCEPTS } from '@/data/concepts';
import { State } from '@/core/state';
import { makeText, wrapText, type TextHandle } from './text';
import { Panel } from './Panel';
import { Audio } from '@/audio/Audio';
import { hasFrame } from '@/core/textures';

export class InsightCard {
  private root?: Phaser.GameObjects.Container;
  private open = false;
  private items: TextHandle[] = [];

  constructor(private scene: Phaser.Scene) {
    on('insight:show', (p: { id: string }) => this.show(p.id));
    scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (!this.open) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'enter' || k === 'e' || k === 'escape') this.close();
    });
  }

  show(id: string): void {
    const concept = CONCEPTS[id];
    if (!concept || this.open) { emit('insight:closed', {}); return; }
    this.open = true;
    State.unlockInsight(id);

    const c = this.scene.add.container(0, 0).setDepth(DEPTH.HUD + 200);
    this.root = c;

    const dim = this.scene.add.rectangle(0, 0, GAME_W, GAME_H, 0x0d0b14, 0).setOrigin(0, 0);
    c.add(dim);
    this.scene.tweens.add({ targets: dim, fillAlpha: 0.72, duration: 420 });

    const cardW = 300;
    const cardH = 128;
    const cx = GAME_W / 2;
    const cy = GAME_H / 2;

    const card = this.scene.add.container(cx, cy);
    card.add(Panel.build(this.scene, -cardW / 2, -cardH / 2, cardW, cardH, 'insight'));

    // Radiating burst behind the card.
    if (hasFrame(this.scene, 'fx/insight_burst_0')) {
      const burst = this.scene.add.sprite(cx, cy - 24, 'atlas', 'fx/insight_burst_0')
        .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.9);
      if (this.scene.anims.exists('fx_insight_burst')) burst.play('fx_insight_burst');
      c.add(burst);
      this.scene.tweens.add({ targets: burst, alpha: 0, scale: 2.2, duration: 1400, onComplete: () => burst.destroy() });
    }

    const eyebrow = makeText(this.scene, 0, -cardH / 2 + 16, 'YOU UNDERSTAND SOMETHING', 'body', { tint: 0xa87a22 });
    eyebrow.setOrigin(0.5, 0.5);
    card.add(eyebrow.obj);
    this.items.push(eyebrow);

    const title = makeText(this.scene, 0, -cardH / 2 + 36, concept.name, 'display', { tint: COLORS.ink });
    title.setOrigin(0.5, 0.5);
    card.add(title.obj);
    this.items.push(title);

    const rule = this.scene.add.graphics();
    rule.lineStyle(1, 0xd6a534, 0.9);
    rule.lineBetween(-cardW / 2 + 34, -cardH / 2 + 50, cardW / 2 - 34, -cardH / 2 + 50);
    card.add(rule);

    const bodyText = wrapText(this.scene, concept.definition, 'body', cardW - 52);
    const body = makeText(this.scene, 0, -cardH / 2 + 72, bodyText, 'body', { tint: 0x3a3050 });
    body.setOrigin(0.5, 0);
    card.add(body.obj);
    this.items.push(body);

    const hint = makeText(this.scene, 0, cardH / 2 - 14, 'The rest is in your journal.', 'body', { tint: 0x8a7458 });
    hint.setOrigin(0.5, 0.5);
    card.add(hint.obj);
    this.items.push(hint);

    c.add(card);
    card.setScale(0.82);
    card.setAlpha(0);
    this.scene.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 480, ease: 'Back.easeOut', delay: 160 });

    Audio.sfx('insight', { volume: 0.7 });
    Audio.duckMusic(0.35, 2600);
  }

  close(): void {
    if (!this.open || !this.root) return;
    this.open = false;
    const c = this.root;
    this.root = undefined;
    this.scene.tweens.add({
      targets: c, alpha: 0, duration: 320,
      onComplete: () => {
        this.items.forEach((i) => i.destroy());
        this.items = [];
        c.destroy();
        emit('insight:closed', {});
      },
    });
  }

  get isOpen(): boolean { return this.open; }
}
