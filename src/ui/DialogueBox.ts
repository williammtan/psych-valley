/**
 * Dialogue.
 *
 * The plan's rule is that dialogue is short and NPCs sound like people. The UI
 * enforces the shape: one speaker, one short line, a name plate, and a visible
 * "continue" beat. There is no multi-paragraph scroll view, because if a line
 * needs one, the writing is wrong.
 */
import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_H, GAME_W } from '@/core/config';
import { emit, on } from '@/core/events';
import { makeText, wrapText, type TextHandle } from './text';
import { Panel } from './Panel';
import { Audio } from '@/audio/Audio';
import { PEOPLE } from '@/data/people';
import { hasFrame } from '@/core/textures';
import { captureInput, releaseInput } from '@/core/uiState';

const BOX_H = 58;
const BOX_MARGIN = 8;
const TEXT_PAD_X = 12;
const CHARS_PER_SEC = 55;

interface Choice { text: string; flag?: string; value?: string }

export class DialogueBox {
  private root: Phaser.GameObjects.Container;
  private panel?: Phaser.GameObjects.Container;
  private namePlate?: Phaser.GameObjects.Container;
  private nameText?: TextHandle;
  private body?: TextHandle;
  private arrow?: Phaser.GameObjects.Image | Phaser.GameObjects.Triangle;
  private portrait?: Phaser.GameObjects.Sprite;

  private full = '';
  private shown = 0;
  private typing = false;
  private open = false;
  private canAdvance = false;

  private choices: Choice[] = [];
  private choiceEls: Array<{ c: Phaser.GameObjects.Container; t: TextHandle }> = [];
  private choiceIndex = 0;
  private choosing = false;

  constructor(private scene: Phaser.Scene) {
    this.root = scene.add.container(0, 0).setDepth(DEPTH.HUD + 100).setVisible(false);

    on('dialogue:show', (p: { speaker: string; text: string; auto?: number; emphasis?: boolean }) => {
      this.show(p.speaker, p.text, p);
    });
    on('dialogue:choices', (p: { prompt: string; choices: Choice[] }) => {
      this.showChoices(p.prompt, p.choices);
    });

    scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (!this.open) return;
      const key = e.key.toLowerCase();
      if (this.choosing) {
        if (key === 'arrowup' || key === 'w') this.moveChoice(-1);
        else if (key === 'arrowdown' || key === 's') this.moveChoice(1);
        else if (key === ' ' || key === 'enter' || key === 'e') this.confirmChoice();
        return;
      }
      if (key === ' ' || key === 'enter' || key === 'e') this.advance();
    });
  }

  private ensurePanel(): void {
    if (this.panel) return;
    const w = GAME_W - BOX_MARGIN * 2;
    const y = GAME_H - BOX_H - BOX_MARGIN;
    this.panel = Panel.build(this.scene, BOX_MARGIN, y, w, BOX_H, 'dialogue');
    this.root.add(this.panel);

    this.body = makeText(this.scene, BOX_MARGIN + TEXT_PAD_X, y + 20, '', 'body', { tint: COLORS.ink });
    this.root.add(this.body.obj);

    if (hasFrame(this.scene, 'ui/advance_arrow_0')) {
      this.arrow = this.scene.add.image(GAME_W - BOX_MARGIN - 12, y + BOX_H - 10, 'atlas', 'ui/advance_arrow_0');
      if (this.scene.anims.exists('ui_advance')) (this.arrow as Phaser.GameObjects.Sprite).play?.('ui_advance');
    } else {
      this.arrow = this.scene.add.triangle(GAME_W - BOX_MARGIN - 12, y + BOX_H - 10, 0, 0, 6, 0, 3, 5, COLORS.ink);
    }
    this.root.add(this.arrow);
  }

  show(speaker: string, text: string, opts: { auto?: number; emphasis?: boolean } = {}): void {
    this.ensurePanel();
    this.clearChoices();
    if (!this.open) captureInput('dialogue');
    this.open = true;
    this.choosing = false;
    this.root.setVisible(true);

    const person = PEOPLE[speaker];
    const displayName = speaker === 'player' ? '' : person?.name ?? '';
    this.setName(displayName, person?.color ?? COLORS.gold);

    const w = GAME_W - BOX_MARGIN * 2 - TEXT_PAD_X * 2 - (this.portrait ? 40 : 0);
    this.full = wrapText(this.scene, text, 'body', w);
    this.shown = 0;
    this.typing = true;
    this.canAdvance = false;
    this.body!.setText('');
    this.arrow?.setVisible(false);

    if (opts.emphasis) this.scene.cameras.main.shake(140, 0.004);
    if (opts.auto) {
      this.scene.time.delayedCall(opts.auto, () => { if (this.open) this.advance(); });
    }

    // Slide-up on first open only; subsequent lines just swap text.
    if (this.root.y !== 0) {
      this.root.y = 12;
      this.scene.tweens.add({ targets: this.root, y: 0, duration: 160, ease: 'Cubic.easeOut' });
    }
  }

  private setName(name: string, color: number): void {
    this.namePlate?.destroy();
    this.nameText?.destroy();
    this.namePlate = undefined;
    this.nameText = undefined;
    if (!name) return;
    const y = GAME_H - BOX_H - BOX_MARGIN;
    const t = makeText(this.scene, BOX_MARGIN + 18, y - 8, name, 'body', { tint: COLORS.parchment });
    t.setOrigin(0, 0.5);
    const plate = Panel.build(this.scene, BOX_MARGIN + 10, y - 16, t.width + 16, 16, 'dark');
    this.namePlate = plate;
    this.nameText = t;
    this.root.add(plate);
    this.root.add(t.obj);
    t.setTint(color);
  }

  update(dt: number): void {
    if (!this.open || !this.typing || !this.body) return;
    this.shown += (CHARS_PER_SEC * dt) / 1000;
    const n = Math.floor(this.shown);
    if (n >= this.full.length) {
      this.body.setText(this.full);
      this.typing = false;
      this.canAdvance = true;
      this.arrow?.setVisible(true);
      return;
    }
    const next = this.full.slice(0, n);
    if (next !== this.body.obj.text) {
      this.body.setText(next);
      const ch = this.full[n - 1];
      if (ch && ch !== ' ' && ch !== '\n' && n % 2 === 0) {
        Audio.sfx('dialogue_blip', { volume: 0.14, rate: 0.95 + Math.random() * 0.12 });
      }
    }
  }

  advance(): void {
    if (!this.open) return;
    if (this.typing) {
      // First press completes the line — never make the player wait twice.
      this.shown = this.full.length;
      this.body?.setText(this.full);
      this.typing = false;
      this.canAdvance = true;
      this.arrow?.setVisible(true);
      return;
    }
    if (!this.canAdvance) return;
    this.hide();
    emit('dialogue:closed', {});
  }

  // ── choices ──────────────────────────────────────────────────────────────

  showChoices(prompt: string, choices: Choice[]): void {
    this.ensurePanel();
    if (!this.open) captureInput('dialogue');
    this.open = true;
    this.root.setVisible(true);
    this.choices = choices;
    this.choiceIndex = 0;
    this.choosing = true;
    this.typing = false;
    this.canAdvance = false;
    this.arrow?.setVisible(false);
    this.setName('', COLORS.gold);

    const w = GAME_W - BOX_MARGIN * 2 - TEXT_PAD_X * 2;
    this.full = prompt ? wrapText(this.scene, prompt, 'body', w) : '';
    this.body!.setText(this.full);

    const startY = GAME_H - BOX_H - BOX_MARGIN + (prompt ? 30 : 16);
    choices.forEach((ch, i) => {
      const c = this.scene.add.container(0, 0);
      const t = makeText(this.scene, BOX_MARGIN + TEXT_PAD_X + 12, startY + i * 11, ch.text, 'body', { tint: COLORS.ink });
      c.add(t.obj);
      this.root.add(c);
      this.choiceEls.push({ c, t });
    });
    this.highlightChoice();
  }

  private moveChoice(d: number): void {
    this.choiceIndex = (this.choiceIndex + d + this.choices.length) % this.choices.length;
    Audio.sfx('ui_move', { volume: 0.3 });
    this.highlightChoice();
  }

  private highlightChoice(): void {
    this.choiceEls.forEach((el, i) => {
      const active = i === this.choiceIndex;
      el.t.setTint(active ? COLORS.ink : 0x8a7458);
      el.t.setPosition(
        BOX_MARGIN + TEXT_PAD_X + (active ? 16 : 12),
        (el.t.obj as Phaser.GameObjects.Text).y,
      );
    });
  }

  private confirmChoice(): void {
    const idx = this.choiceIndex;
    const choice = this.choices[idx];
    Audio.sfx('ui_confirm', { volume: 0.4 });
    this.clearChoices();
    this.hide();
    emit('dialogue:chose', { index: idx, choice });
  }

  private clearChoices(): void {
    this.choiceEls.forEach((el) => { el.t.destroy(); el.c.destroy(); });
    this.choiceEls = [];
    this.choices = [];
    this.choosing = false;
  }

  hide(): void {
    if (this.open) releaseInput('dialogue', this.scene.time.now);
    this.open = false;
    this.root.setVisible(false);
    this.root.y = 12;
  }

  get isOpen(): boolean { return this.open; }
}
