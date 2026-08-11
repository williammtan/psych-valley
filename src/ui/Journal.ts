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
  private insightPage = 0;

  constructor(private scene: Phaser.Scene) {
    scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (!this.open) return;
      const k = e.key.toLowerCase();
      if (k === 'tab' || k === 'escape' || k === 'i') { e.preventDefault(); this.close(); return; }
      if (k === 'arrowleft' || k === 'a' || k === 'q') this.cycleTab(-1);
      if (k === 'arrowright' || k === 'd') this.cycleTab(1);
      if (k === 'arrowup' || k === 'w') this.moveDetail(-1);
      if (k === 'arrowdown' || k === 's') this.moveDetail(1);
      if (k === ' ' && this.tab === 'Insights') { this.insightPage = 1 - this.insightPage; Audio.sfx('ui_move', { volume: 0.3 }); this.render(); }
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
    this.insightPage = 0;
    Audio.sfx('ui_move', { volume: 0.3 });
    this.render();
  }

  private moveDetail(d: number): void {
    this.detailIndex = Math.max(0, this.detailIndex + d);
    this.insightPage = 0;
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

    const hint = this.text(GAME_W - 38, y, 'A D tabs   TAB close', 'body', 0x5d4e78);
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

  /**
   * The Insights tab — the player's psychology notebook.
   *
   * Two pages per concept, and the order matters. Page one is what happened to
   * *you*: the sentence, the evening it came from, and the thing people usually
   * get wrong about it. Page two is the formal vocabulary, where each term is
   * anchored to the moment in your own playthrough that produced it, plus the
   * examples you personally witnessed.
   *
   * Putting the vocabulary second is the whole design: this is a notebook that
   * happens to contain AP terms, not a term list with flavour text attached.
   */
  private renderInsights(x: number, y: number): void {
    const unlocked = CONCEPT_ORDER.filter((id) => State.insightUnlocked(id));
    if (!unlocked.length) {
      this.text(x, y, 'Empty. Things you work out yourself end up here.', 'body', 0x8b8898);
      return;
    }
    this.detailIndex = Math.min(this.detailIndex, unlocked.length - 1);

    // Left column: the concepts you have. Right column: the open one.
    let ly = y;
    unlocked.forEach((id, i) => {
      const active = i === this.detailIndex;
      this.text(x, ly, `${active ? '▸ ' : '  '}${CONCEPTS[id].name}`, 'body', active ? COLORS.goldLight : 0x8b8898);
      ly += 12;
    });
    this.text(x, ly + 8, 'W S concept', 'body', 0x463a5c);
    this.text(x, ly + 19, 'SPACE turn page', 'body', 0x463a5c);

    const id = unlocked[this.detailIndex];
    const c = CONCEPTS[id];
    const dx = x + 118;
    const width = GAME_W - dx - 44;
    let dy = y;

    const heading = (label: string) => {
      dy += 4;
      this.text(dx, dy, label, 'body', 0xa87a22);
      dy += 12;
    };
    const para = (s2: string, tint = COLORS.parchment, indent = 0) => {
      const t = this.text(dx + indent, dy, wrapText(this.scene, s2, 'body', width - indent), 'body', tint);
      dy += t.height + 3;
    };

    if (this.insightPage === 0) {
      this.text(dx, dy, c.apUnit, 'body', 0x5d4e78);
      dy += 13;
      para(c.definition);
      dy += 5;
      heading('WHAT HAPPENED');
      for (const line of c.illustration) {
        this.text(dx, dy, line, 'body', 0xa69fb8);
        dy += 10;
      }
      dy += 4;
      heading('WHAT PEOPLE GET WRONG');
      para(c.misconception, 0xa69fb8);
    } else {
      heading('FORMAL TERMS');
      for (const term of c.terms) {
        this.text(dx, dy, term.term, 'body', COLORS.goldLight);
        dy += 10;
        para(term.meaning, 0x8b8898, 6);
        para(term.inGame, 0x7389a0, 6);
        dy += 2;
      }
      dy += 2;
      heading('ELSEWHERE');
      for (const line of c.realWorld) {
        this.text(dx, dy, `· ${line}`, 'body', 0xa69fb8);
        dy += 10;
      }
      // Examples the player actually witnessed, recorded as they happened.
      const seen = State.insights[id]?.examples ?? [];
      if (seen.length) {
        dy += 4;
        heading('YOU SAW');
        for (const line of seen) para(`· ${line}`, 0xa69fb8);
      }
    }

    // Page marker, bottom right of the panel.
    const pages = `${this.insightPage + 1}/2`;
    const marker = this.text(GAME_W - 44, GAME_H - 34, pages, 'body', 0x5d4e78);
    marker.setOrigin(1, 0);
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
