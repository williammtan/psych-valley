import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_H, GAME_W } from '@/core/config';
import { emit, on } from '@/core/events';
import { State } from '@/core/state';
import { makeText, wrapText, type TextHandle } from '@/ui/text';
import { Panel } from '@/ui/Panel';
import { DialogueBox } from '@/ui/DialogueBox';
import { Hud } from '@/ui/Hud';
import { Journal } from '@/ui/Journal';
import { InsightCard } from '@/ui/InsightCard';
import { LanternTrial } from '@/ui/LanternTrial';
import { MemoryThreads } from '@/ui/MemoryThreads';
import { Audio } from '@/audio/Audio';
import { hasFrame } from '@/core/textures';

/**
 * All non-diegetic UI lives in its own scene so it is never affected by the
 * world camera's zoom, shake or fades.
 */
export class UIScene extends Phaser.Scene {
  hud!: Hud;
  dialogue!: DialogueBox;
  journal!: Journal;
  insight!: InsightCard;
  lanternTrial!: LanternTrial;
  threads!: MemoryThreads;
  private banner?: Phaser.GameObjects.Container;
  private toasts: Phaser.GameObjects.Container[] = [];
  private hidden = false;

  constructor() {
    super({ key: 'UI', active: false });
  }

  create(): void {
    this.hud = new Hud(this);
    this.dialogue = new DialogueBox(this);
    this.journal = new Journal(this);
    this.insight = new InsightCard(this);
    this.lanternTrial = new LanternTrial(this);
    this.threads = new MemoryThreads(this);

    on('ui:banner', (p: { title: string; subtitle?: string }) => this.showBanner(p.title, p.subtitle));
    on('ui:toast', (p: { text: string; icon?: string }) => this.showToast(p.text, p.icon));
    on('map:entered', (p: { id: string; name: string; subtitle?: string }) => {
      // Anything still on screen belongs to the place we just left. A banner or
      // toast that outlives its map is worse than none — it labels the new
      // location with the old one's name.
      this.clearTransient();
      // Keyed by map id, not display name: the shrine rooms share a name and
      // each still deserves its own arrival card for its subtitle.
      if (!this.seen.has(p.id)) {
        this.seen.add(p.id);
        this.showBanner(p.name, p.subtitle);
      }
    });
    on('ui:setHidden', (p: { hidden: boolean }) => {
      this.hidden = p.hidden;
      this.hud.setVisible(!p.hidden);
    });
    on('ui:toggleJournal', () => this.journal.toggle());
    on('quest', (p: { id: string; kind: string }) => {
      if (p.kind === 'start') {
        const q = State.quests[p.id];
        if (q) this.showToast(`New: ${q.title}`, 'quest_new');
      } else if (p.kind === 'complete') {
        const q = State.quests[p.id];
        if (q) this.showToast(`Complete: ${q.title}`, 'quest_done');
      }
    });
    on('ability', (p: { ability: string }) => {
      this.showToast(`Learned ${p.ability.toUpperCase()}`, `icon_${p.ability}`);
    });

    this.scene.bringToTop();
  }

  private seen = new Set<string>();

  /** Drop banners and toasts that belong to the map we just left. */
  private clearTransient(): void {
    if (this.banner) {
      this.tweens.killTweensOf(this.banner);
      this.banner.destroy();
      this.banner = undefined;
    }
    for (const t of this.toasts) { this.tweens.killTweensOf(t); t.destroy(); }
    this.toasts = [];
  }

  update(_t: number, dt: number): void {
    this.dialogue.update(dt);
    this.hud.update(dt);
    this.journal.update(dt);
    this.lanternTrial.update(dt);
    this.threads.update(dt);
  }

  // ── location banner ──────────────────────────────────────────────────────

  showBanner(title: string, subtitle?: string): void {
    this.banner?.destroy();
    const c = this.add.container(GAME_W / 2, 40).setDepth(DEPTH.HUD + 50).setAlpha(0);

    const t = makeText(this, 0, 0, title.toUpperCase(), 'display', { tint: COLORS.parchment });
    t.setOrigin(0.5, 0.5);
    c.add(t.obj);

    let width = t.width + 40;
    if (subtitle) {
      const s = makeText(this, 0, 11, subtitle, 'body', { tint: COLORS.parchmentDim });
      s.setOrigin(0.5, 0.5);
      c.add(s.obj);
      width = Math.max(width, s.width + 40);
    }

    // Thin rules either side of the title — a quiet, film-title look.
    const half = width / 2;
    const ruleY = subtitle ? 2 : 1;
    const g = this.add.graphics();
    g.lineStyle(1, COLORS.gold, 0.85);
    g.lineBetween(-half, ruleY, -half + 18, ruleY);
    g.lineBetween(half - 18, ruleY, half, ruleY);
    c.addAt(g, 0);

    this.banner = c;
    this.tweens.add({ targets: c, alpha: 1, y: 36, duration: 380, ease: 'Cubic.easeOut' });
    this.tweens.add({
      targets: c, alpha: 0, y: 30, delay: 2100, duration: 480, ease: 'Cubic.easeIn',
      onComplete: () => { c.destroy(); if (this.banner === c) this.banner = undefined; },
    });
  }

  // ── toasts ───────────────────────────────────────────────────────────────

  showToast(text: string, icon?: string): void {
    const c = this.add.container(GAME_W - 8, 30 + this.toasts.length * 20).setDepth(DEPTH.HUD + 40);
    const label = makeText(this, 0, 0, text, 'body', { tint: COLORS.parchment });
    label.setOrigin(1, 0.5);
    const w = label.width + 16 + (icon ? 14 : 0);
    const panel = Panel.build(this, -w, -8, w, 17, 'parchment');
    c.add(panel);
    if (icon) {
      const frame = `ui/${icon}`;
      if (hasFrame(this, frame)) {
        const img = this.add.image(-w + 9, 0, 'atlas', frame).setOrigin(0.5);
        c.add(img);
        label.setPosition(-4, 0);
      }
    }
    c.add(label.obj);
    label.setTint(COLORS.ink);
    c.setAlpha(0);
    c.x = GAME_W + 20;
    this.toasts.push(c);
    Audio.sfx('ui_toast', { volume: 0.3 });
    this.tweens.add({ targets: c, alpha: 1, x: GAME_W - 8, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: c, alpha: 0, x: GAME_W + 20, delay: 2600, duration: 260,
      onComplete: () => {
        c.destroy();
        this.toasts = this.toasts.filter((t) => t !== c);
        this.toasts.forEach((t, i) => { t.y = 30 + i * 20; });
      },
    });
  }
}
