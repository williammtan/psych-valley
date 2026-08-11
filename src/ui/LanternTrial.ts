/**
 * The Lantern Trial's on-screen furniture.
 *
 * Three pieces, and each one exists because the *mechanic* needs it, not because
 * a screen looked empty:
 *
 *   VOTE BUBBLES    one coloured chip over each villager's head, in the same
 *                   colour as the lantern they named. The whole point of the
 *                   quest is watching a consensus form, so the group's answers
 *                   have to be readable at a glance, as a shape, without
 *                   reading anything.
 *   ROUND INDICATOR tells the player where they are in the ceremony and — more
 *                   importantly — what the social condition is this round
 *                   ("nobody can see your answer" / "you answer last").
 *   ANSWER PROMPT   the player's own answer. Moving the cursor *strikes* that
 *                   lantern out in the world, so the prompt is also the
 *                   listening instrument: you can compare as long as you like.
 *                   There is deliberately no timer anywhere in this file.
 *
 * It is driven entirely by events so the area script owns the ceremony and this
 * file owns none of it.
 */
import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_H, GAME_W } from '@/core/config';
import { emit, on } from '@/core/events';
import { Panel } from './Panel';
import { makeText, type TextHandle } from './text';
import { Audio } from '@/audio/Audio';
import { hasFrame } from '@/core/textures';
import { TRIAL_COLORS } from '@/world/maps/festival';

export type LanternId = 'a' | 'b' | 'c';

const ORDER: LanternId[] = ['a', 'b', 'c'];
const NUMERAL: Record<LanternId, string> = { a: '1', b: '2', c: '3' };

interface Bubble {
  id: string;
  answer: LanternId;
  /** World position of the speaker's head. */
  wx: number;
  wy: number;
  root: Phaser.GameObjects.Container;
  gfx: Phaser.GameObjects.Graphics;
  label: TextHandle;
}

export class LanternTrial {
  private bubbles: Bubble[] = [];
  private bubbleLayer: Phaser.GameObjects.Container;

  private roundBox?: Phaser.GameObjects.Container;
  private prompt?: Phaser.GameObjects.Container;
  private chips: Array<{ box: Phaser.GameObjects.Graphics; art?: Phaser.GameObjects.Image; num: TextHandle; x: number }> = [];
  private cursor = 0;
  private asking = false;

  constructor(private scene: Phaser.Scene) {
    this.bubbleLayer = scene.add.container(0, 0).setDepth(DEPTH.HUD + 20);

    on('trial:bubble', (p: { id: string; answer: LanternId; wx: number; wy: number; changed?: boolean }) => this.setBubble(p));
    on('trial:clear', () => this.clearBubbles());
    on('trial:round', (p: { n: number; total: number; label?: string }) => this.showRound(p.n, p.total, p.label));
    on('trial:roundOff', () => this.hideRound());
    on('trial:ask', (p: { mode: 'private' | 'public'; start?: LanternId }) => this.ask(p.mode, p.start));
    on('trial:end', () => { this.closeAsk(); this.clearBubbles(); this.hideRound(); });

    scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  // ── vote bubbles ─────────────────────────────────────────────────────────

  /**
   * Add or update one villager's public answer. `changed` is the beat that
   * matters: an answer that moves gets a visible shove rather than a quiet
   * swap, because the player is supposed to notice it happening.
   */
  private setBubble(p: { id: string; answer: LanternId; wx: number; wy: number; changed?: boolean }): void {
    let b = this.bubbles.find((x) => x.id === p.id);
    if (!b) {
      const root = this.scene.add.container(-999, -999);
      const gfx = this.scene.add.graphics();
      const label = makeText(this.scene, 0, 0, '', 'body', { tint: COLORS.ink });
      label.setOrigin(0.5, 0.5);
      root.add([gfx, label.obj]);
      this.bubbleLayer.add(root);
      b = { id: p.id, answer: p.answer, wx: p.wx, wy: p.wy, root, gfx, label };
      this.bubbles.push(b);
      root.setScale(0.2);
      this.scene.tweens.add({ targets: root, scale: 1, duration: 190, ease: 'Back.easeOut' });
    }
    b.wx = p.wx;
    b.wy = p.wy;
    const moved = b.answer !== p.answer;
    b.answer = p.answer;
    this.drawBubble(b);

    if (p.changed && moved) {
      // A shove, not a fade — this is the moment the player is meant to catch.
      this.scene.tweens.add({
        targets: b.root, scaleX: 1.35, scaleY: 0.72, duration: 90, yoyo: true, ease: 'Sine.easeOut',
      });
      Audio.sfx('ui_move', { volume: 0.4, rate: 0.8 });
    }
    this.reposition();
  }

  private drawBubble(b: Bubble): void {
    const c = TRIAL_COLORS[b.answer];
    const w = 17;
    const h = 15;
    const g = b.gfx;
    g.clear();
    g.fillStyle(COLORS.ink, 0.55);
    g.fillRoundedRect(-w / 2 + 1, -h / 2 + 2, w, h, 4);
    g.fillStyle(COLORS.ink, 1);
    g.fillRoundedRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 5);
    g.fillTriangle(-3, h / 2, 3, h / 2, 0, h / 2 + 4);
    g.fillStyle(c, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
    g.fillStyle(0xffffff, 0.28);
    g.fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, 3, 1);
    b.label.setText(NUMERAL[b.answer]);
  }

  private clearBubbles(): void {
    for (const b of this.bubbles) {
      this.scene.tweens.add({
        targets: b.root, alpha: 0, y: b.root.y - 5, duration: 180,
        onComplete: () => { b.label.destroy(); b.root.destroy(); },
      });
    }
    this.bubbles = [];
  }

  /** Bubbles are anchored to people, so they track the world camera every frame. */
  private reposition(): void {
    const world = this.scene.scene.get('World') as Phaser.Scene | undefined;
    const cam = world?.cameras?.main;
    if (!cam) return;
    for (const b of this.bubbles) {
      const x = Math.round((b.wx - cam.worldView.x) * cam.zoom);
      const y = Math.round((b.wy - cam.worldView.y) * cam.zoom);
      b.root.setPosition(x, y);
      const off = x < -20 || x > GAME_W + 20 || y < -20 || y > GAME_H + 20;
      b.root.setVisible(!off);
    }
  }

  // ── round indicator ──────────────────────────────────────────────────────

  private showRound(n: number, total: number, label?: string): void {
    this.hideRound();
    const c = this.scene.add.container(GAME_W / 2, 20).setDepth(DEPTH.HUD + 22).setAlpha(0);

    const title = makeText(this.scene, 0, -6, `ROUND ${n} OF ${total}`, 'display', { tint: COLORS.parchment });
    title.setOrigin(0.5, 0.5);
    let w = title.width + 44;
    let sub: TextHandle | undefined;
    if (label) {
      sub = makeText(this.scene, 0, 6, label, 'body', { tint: COLORS.goldLight });
      sub.setOrigin(0.5, 0.5);
      w = Math.max(w, sub.width + 30);
    }
    c.add(Panel.build(this.scene, -w / 2, -16, w, label ? 32 : 22, 'dark'));
    c.add(title.obj);
    if (sub) c.add(sub.obj);

    // Four pips: which rounds are behind you, without a progress bar.
    for (let i = 0; i < total; i++) {
      const x = -((total - 1) * 5) / 2 + i * 5;
      const done = i < n;
      c.add(this.scene.add.rectangle(x, label ? 15 : 12, 3, 3, done ? COLORS.gold : COLORS.inkSoft).setOrigin(0.5));
    }

    this.roundBox = c;
    this.scene.tweens.add({ targets: c, alpha: 1, y: 22, duration: 260, ease: 'Cubic.easeOut' });
  }

  private hideRound(): void {
    this.roundBox?.destroy();
    this.roundBox = undefined;
  }

  // ── the player's answer ──────────────────────────────────────────────────

  private ask(mode: 'private' | 'public', start?: LanternId): void {
    this.closeAsk();
    this.asking = true;
    this.cursor = start ? ORDER.indexOf(start) : 1;

    const w = 224;
    const h = 66;
    const x = (GAME_W - w) / 2;
    const y = GAME_H - h - 8;
    const c = this.scene.add.container(0, 0).setDepth(DEPTH.HUD + 30).setAlpha(0);
    c.add(Panel.build(this.scene, x, y, w, h, 'dark'));

    const q = makeText(this.scene, GAME_W / 2, y + 11, 'Which lantern matched?', 'body', { tint: COLORS.parchment });
    q.setOrigin(0.5, 0.5);
    c.add(q.obj);

    const note = makeText(
      this.scene, GAME_W / 2, y + 21,
      mode === 'private' ? 'nobody can see your answer' : 'out loud, in front of everyone',
      'body', { tint: mode === 'private' ? COLORS.good : COLORS.goldLight },
    );
    note.setOrigin(0.5, 0.5);
    c.add(note.obj);

    this.chips = [];
    ORDER.forEach((id, i) => {
      const cx = GAME_W / 2 + (i - 1) * 46;
      const box = this.scene.add.graphics();
      c.add(box);
      let art: Phaser.GameObjects.Image | undefined;
      const frame = `prop/fest/trial_lantern_${id}`;
      if (hasFrame(this.scene, frame)) {
        art = this.scene.add.image(cx, y + 44, 'atlas', frame).setOrigin(0.5, 1).setScale(0.62);
        c.add(art);
      }
      const num = makeText(this.scene, cx, y + 51, NUMERAL[id], 'body', { tint: COLORS.parchmentDim });
      num.setOrigin(0.5, 0.5);
      c.add(num.obj);
      this.chips.push({ box, art, num, x: cx });
    });

    const hint = makeText(this.scene, GAME_W / 2, y + h - 6, '← → listen    SPACE answer    ↓ reference', 'body', { tint: COLORS.inkSoft });
    hint.setOrigin(0.5, 0.5);
    hint.setTint(0x9a8fb5);
    c.add(hint.obj);

    this.prompt = c;
    this.scene.tweens.add({ targets: c, alpha: 1, duration: 200 });
    this.paintChips();
    // Sound the selected lantern once, so the prompt opens by demonstrating
    // what it is for.
    this.scene.time.delayedCall(260, () => { if (this.asking) emit('trial:preview', { answer: ORDER[this.cursor] }); });
  }

  private paintChips(): void {
    this.chips.forEach((chip, i) => {
      const id = ORDER[i];
      const active = i === this.cursor;
      const g = chip.box;
      const y = GAME_H - 66 - 8;
      g.clear();
      g.fillStyle(COLORS.ink, active ? 0.95 : 0.6);
      g.fillRoundedRect(chip.x - 17, y + 26, 34, 30, 4);
      g.lineStyle(1, active ? COLORS.goldLight : 0x4a3f66, 1);
      g.strokeRoundedRect(chip.x - 17, y + 26, 34, 30, 4);
      if (active) {
        g.fillStyle(TRIAL_COLORS[id], 0.22);
        g.fillRoundedRect(chip.x - 16, y + 27, 32, 28, 4);
      }
      chip.art?.setAlpha(active ? 1 : 0.55);
      chip.art?.setPosition(chip.x, y + 44 + (active ? -2 : 0));
      chip.num.setTint(active ? COLORS.goldLight : 0x7d7196);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.asking) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { this.moveCursor(-1); e.preventDefault(); return; }
    if (k === 'arrowright' || k === 'd') { this.moveCursor(1); e.preventDefault(); return; }
    if (k === 'arrowdown' || k === 's' || k === 'r') { emit('trial:replay', {}); e.preventDefault(); return; }
    if (k === ' ' || k === 'enter' || k === 'e') { this.submit(); e.preventDefault(); }
  }

  private moveCursor(d: number): void {
    this.cursor = (this.cursor + d + ORDER.length) % ORDER.length;
    this.paintChips();
    // Moving the cursor strikes the lantern: the prompt *is* the instrument.
    emit('trial:preview', { answer: ORDER[this.cursor] });
  }

  private submit(): void {
    const answer = ORDER[this.cursor];
    this.closeAsk();
    Audio.sfx('ui_confirm', { volume: 0.45 });
    emit('trial:answer', { answer });
  }

  /** Used by the QA harness to answer without synthesising key events. */
  answerWith(id: LanternId): void {
    if (!this.asking) return;
    this.cursor = ORDER.indexOf(id);
    this.submit();
  }

  get isAsking(): boolean { return this.asking; }

  closeAsk(): void {
    this.asking = false;
    this.chips.forEach((c) => { c.num.destroy(); });
    this.chips = [];
    this.prompt?.destroy();
    this.prompt = undefined;
  }

  update(_dt: number): void {
    if (this.bubbles.length) this.reposition();
  }
}
