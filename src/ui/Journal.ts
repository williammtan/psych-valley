/**
 * The journal — Map / People / Insights / Quests.
 *
 * The Insights tab is the player's psychology notebook and is the only place
 * formal AP vocabulary appears. It is always optional: the game never blocks
 * progress on reading it.
 */
import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_H, GAME_W } from '@/core/config';
import { State } from '@/core/state';
import { CONCEPTS, CONCEPT_ORDER } from '@/data/concepts';
import { PEOPLE } from '@/data/people';
import { makeText, wrapText, type TextHandle } from './text';
import { Panel } from './Panel';
import { Audio } from '@/audio/Audio';
import { emit } from '@/core/events';

const TABS = ['Quests', 'Insights', 'People', 'Map'] as const;
type Tab = typeof TABS[number];

export class Journal {
  private root?: Phaser.GameObjects.Container;
  private content?: Phaser.GameObjects.Container;
  private texts: TextHandle[] = [];
  private tab: Tab = 'Quests';
  private open = false;
  private detailIndex = 0;

  constructor(private scene: Phaser.Scene) {
    scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (!this.open) return;
      const k = e.key.toLowerCase();
      if (k === 'tab' || k === 'escape' || k === 'i') { e.preventDefault(); this.close(); return; }
      if (k === 'arrowleft' || k === 'a' || k === 'q') this.cycleTab(-1);
      if (k === 'arrowright' || k === 'd') this.cycleTab(1);
      if (k === 'arrowup' || k === 'w') this.moveDetail(-1);
      if (k === 'arrowdown' || k === 's') this.moveDetail(1);
    });
  }

  toggle(): void {
    if (this.open) this.close(); else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    Audio.sfx('journal_open', { volume: 0.5 });
    const c = this.scene.add.container(0, 0).setDepth(DEPTH.HUD + 150);
    this.root = c;

    const dim = this.scene.add.rectangle(0, 0, GAME_W, GAME_H, 0x0d0b14, 0.78).setOrigin(0, 0);
    c.add(dim);

    const w = GAME_W - 48;
    const h = GAME_H - 40;
    c.add(Panel.build(this.scene, 24, 20, w, h, 'dark'));

    this.content = this.scene.add.container(0, 0);
    c.add(this.content);

    c.setAlpha(0);
    this.scene.tweens.add({ targets: c, alpha: 1, duration: 160 });
    this.render();
    emit('journal:opened', {});
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    Audio.sfx('journal_close', { volume: 0.4 });
    const c = this.root;
    this.root = undefined;
    this.clearTexts();
    this.scene.tweens.add({ targets: c, alpha: 0, duration: 140, onComplete: () => c?.destroy() });
    emit('journal:closed', {});
  }

  private cycleTab(d: number): void {
    const i = TABS.indexOf(this.tab);
    this.tab = TABS[(i + d + TABS.length) % TABS.length];
    this.detailIndex = 0;
    Audio.sfx('ui_move', { volume: 0.3 });
    this.render();
  }

  private moveDetail(d: number): void {
    this.detailIndex = Math.max(0, this.detailIndex + d);
    Audio.sfx('ui_move', { volume: 0.25 });
    this.render();
  }

  private clearTexts(): void {
    this.texts.forEach((t) => t.destroy());
    this.texts = [];
  }

  private text(x: number, y: number, s: string, font: 'body' | 'display' = 'body', tint = COLORS.parchment): TextHandle {
    const t = makeText(this.scene, x, y, s, font, { tint });
    this.content?.add(t.obj);
    this.texts.push(t);
    return t;
  }

  private render(): void {
    if (!this.content) return;
    this.clearTexts();
    this.content.removeAll(true);

    const left = 38;
    let y = 32;

    // Tab strip
    let tx = left;
    for (const t of TABS) {
      const active = t === this.tab;
      const label = this.text(tx, y, t.toUpperCase(), 'body', active ? COLORS.goldLight : 0x5d4e78);
      if (active) {
        const g = this.scene.add.graphics();
        g.lineStyle(1, COLORS.gold, 1);
        g.lineBetween(tx, y + 11, tx + label.width, y + 11);
        this.content.add(g);
      }
      tx += label.width + 14;
    }

    const hint = this.text(GAME_W - 38, y, '← → tabs   TAB close', 'body', 0x5d4e78);
    hint.setOrigin(1, 0);

    y += 22;

    switch (this.tab) {
      case 'Quests': this.renderQuests(left, y); break;
      case 'Insights': this.renderInsights(left, y); break;
      case 'People': this.renderPeople(left, y); break;
      case 'Map': this.renderMap(left, y); break;
    }
  }

  private renderQuests(x: number, y: number): void {
    const quests = Object.values(State.quests).filter((q) => q.active || q.complete).sort((a, b) => a.order - b.order);
    if (!quests.length) {
      this.text(x, y, 'Nothing yet. Talk to someone.', 'body', 0x8b8898);
      return;
    }
    for (const q of quests) {
      const title = this.text(x, y, q.title, 'display', q.complete ? 0x6cb069 : COLORS.parchment);
      y += title.height + 3;
      this.text(x + 4, y, q.complete ? 'Complete' : `Given by ${PEOPLE[q.giver]?.name ?? q.giver}`, 'body', 0x8b8898);
      y += 12;
      for (const s of q.steps) {
        if (!s.done && q.steps.indexOf(s) > q.steps.findIndex((k) => !k.done)) continue;
        this.text(x + 8, y, `${s.done ? '✓' : '·'} ${s.text}`, 'body', s.done ? 0x6b6580 : COLORS.parchment);
        y += 11;
      }
      y += 8;
    }
  }

  private renderInsights(x: number, y: number): void {
    const unlocked = CONCEPT_ORDER.filter((id) => State.insightUnlocked(id));
    if (!unlocked.length) {
      this.text(x, y, 'Empty. Things you work out yourself end up here.', 'body', 0x8b8898);
      return;
    }
    this.detailIndex = Math.min(this.detailIndex, unlocked.length - 1);
    // Left column: list. Right column: detail.
    let ly = y;
    unlocked.forEach((id, i) => {
      const active = i === this.detailIndex;
      this.text(x, ly, `${active ? '▸ ' : '  '}${CONCEPTS[id].name}`, 'body', active ? COLORS.goldLight : 0x8b8898);
      ly += 12;
    });

    const c = CONCEPTS[unlocked[this.detailIndex]];
    const dx = x + 118;
    let dy = y;
    this.text(dx, dy, c.apUnit, 'body', 0x5d4e78);
    dy += 13;
    const def = wrapText(this.scene, c.definition, 'body', GAME_W - dx - 44);
    const t = this.text(dx, dy, def, 'body', COLORS.parchment);
    dy += t.height + 8;

    for (const line of c.illustration) {
      this.text(dx, dy, line, 'body', 0xa69fb8);
      dy += 10;
    }
    dy += 6;
    this.text(dx, dy, 'FORMAL TERMS', 'body', 0xa87a22);
    dy += 12;
    for (const term of c.terms) {
      this.text(dx, dy, term.term, 'body', COLORS.goldLight);
      dy += 10;
      const m = wrapText(this.scene, `${term.meaning}  —  ${term.inGame}`, 'body', GAME_W - dx - 44);
      const mt = this.text(dx + 6, dy, m, 'body', 0x8b8898);
      dy += mt.height + 4;
    }
  }

  private renderPeople(x: number, y: number): void {
    const met = Object.values(State.people).filter((p) => p.met);
    if (!met.length) {
      this.text(x, y, 'You have not met anyone yet.', 'body', 0x8b8898);
      return;
    }
    let cy = y;
    for (const p of met) {
      const person = PEOPLE[p.id];
      if (!person) continue;
      this.text(x, cy, person.name, 'body', person.color);
      this.text(x + 76, cy, person.role, 'body', 0x5d4e78);
      cy += 11;
      const blurb = wrapText(this.scene, person.blurb, 'body', GAME_W - x - 44);
      const t = this.text(x + 6, cy, blurb, 'body', 0x8b8898);
      cy += t.height + 3;
      for (const note of p.notes) {
        const n = wrapText(this.scene, `· ${note}`, 'body', GAME_W - x - 50);
        const nt = this.text(x + 6, cy, n, 'body', 0xa69fb8);
        cy += nt.height + 2;
      }
      cy += 6;
    }
  }

  private renderMap(x: number, y: number): void {
    const places: Array<[string, string]> = [
      ['lumen_vale', 'Lumen Vale'],
      ['inn', 'The Lantern Inn'],
      ['workshop', "Sera's Workshop"],
      ['courier', 'Courier Office'],
      ['festival', 'Festival Plaza'],
      ['woods', 'Whisper Woods'],
      ['shrine_entrance', 'Echo Shrine'],
    ];
    this.text(x, y, 'PLACES YOU KNOW', 'body', 0xa87a22);
    let cy = y + 14;
    for (const [id, name] of places) {
      const known = State.visited.has(id);
      this.text(x, cy, known ? name : '— — —', 'body', known ? COLORS.parchment : 0x3a3050);
      cy += 12;
    }
  }

  update(_dt: number): void { /* static for now */ }

  get isOpen(): boolean { return this.open; }
}
