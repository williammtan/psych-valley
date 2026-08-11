/**
 * THE MEMORY THREAD BOARD  (plan.md §11, §12)
 *
 * Two horizontal timelines and a tray of evidence. The player lifts a card and
 * drops it on a slot to say "this happened here". The board's whole argument is
 * carried by one rule:
 *
 *   A slot ANCHORS only when the card in it is *contextual* evidence — a thing
 *   in the world that cannot change its mind — and only when it belongs there.
 *   A memory card can be placed anywhere and will sit there, plausible, pinless
 *   and wavering, forever. It never anchors.
 *
 * That is the lesson expressed as a lock, not as a quiz. A player who treats
 * "Oren is sure" and "the receipt is stamped" as the same kind of fact fills all
 * six slots and watches nothing happen — and the board tells them why, by
 * showing the two accounts that cannot both be true shoving at each other.
 *
 * ── placing is a claim; ENTER is the submission ─────────────────────────────
 *
 * Nothing is checked as it lands. Dropping a card says "I think this happened
 * here" and the board simply holds it. Only when the player commits the whole
 * arrangement — ENTER, "that is both days" — does anything resolve, and it
 * resolves all at once or not at all.
 *
 * A refused commit is never told which card is wrong. The board answers with an
 * argument instead: the two accounts that collide, or Oren on his own memory,
 * or a plain restatement of a physical fact and the thing that dates it. The
 * conclusion stays the player's to draw. There is no score anywhere on screen.
 *
 * Art contract: everything here degrades. `ui/clue_card_*`, `ui/panelDark_*`,
 * `ui/thread_node_*`, `ui/timeline_bar_*`, `ui/thread_connector_*` and
 * `ui/clue_pin` are used when the UI art module has built them, and equivalent
 * Graphics are drawn when it has not, so layout work is never blocked on art.
 *
 * Input is keyboard-first (the game has no mouse dependency); pointer support is
 * a convenience layered on the same cell model.
 */
import Phaser from 'phaser';
import { COLORS, DEPTH, GAME_H, GAME_W } from '@/core/config';
import { emit, on, once } from '@/core/events';
import { hasFrame } from '@/core/textures';
import { Audio } from '@/audio/Audio';
import { Panel } from './Panel';
import { makeText, wrapText, type TextHandle } from './text';

// ── data ────────────────────────────────────────────────────────────────────

export type ThreadDay = 'yesterday' | 'today';
export type ClueKind = 'context' | 'memory';

export interface ThreadCard {
  id: string;
  kind: ClueKind;
  /**
   * Which real-world event this card is *about*. Two cards may describe the
   * same delivery and disagree — that disagreement is the puzzle.
   */
  delivery: string;
  /** Wrap colour word, shown on the card face: 'SLATE'. */
  parcel: string;
  /** Swatch / text tint for the wrap. */
  tint: number;
  /** Where it went, short enough to fit a card: "Verris, weaver". */
  address: string;
  /** What the card claims. Memory cards claim things that are not true. */
  claim: { day: ThreadDay; slot: number };
  /** One short line: the proof, or whose recollection this is. */
  note: string;
  /**
   * For contextual cards: the fact that dates the thing in `note` — the rain,
   * the roll of cord, the wet paint. Stated on its own, never as a ruling.
   */
  context?: string;
}

export interface ThreadRow {
  day: ThreadDay;
  label: string;
  /** The one contextual fact that separates the two days. */
  sub: string;
}

export interface ThreadBoard {
  title: string;
  /** The ordering rule the route board contributes. */
  rule: string;
  columns: string[];
  rows: ThreadRow[];
  cards: ThreadCard[];
  /** delivery id → where it actually happened. */
  truth: Record<string, { day: ThreadDay; slot: number }>;
  /** Authored lines the board says back. See `src/data/dialogue/`. */
  messages?: {
    /** Played when the player commits a board that leans on a recollection. */
    memory?: string;
    /** The prompt on a full board. */
    ready?: string;
  };
}

/** Open the board and resolve when it closes. `true` if it was solved. */
export function openMemoryThreads(board: ThreadBoard): Promise<boolean> {
  return new Promise((resolve) => {
    once('threads:closed', (p: { solved: boolean }) => resolve(!!p.solved));
    emit('threads:open', { board });
  });
}

// ── layout ──────────────────────────────────────────────────────────────────

const L = {
  panel: { x: 6, y: 4, w: 468, h: 262 },
  titleY: 10,
  ruleY: 25,
  headerY: 38,
  labelX: 14,
  slotX: 84,
  slotW: 118,
  slotGap: 10,
  slotH: 32,
  strip: [52, 110],
  cardY: [62, 120],
  trayLabelY: 152,
  trayX: 12,
  trayW: 86,
  trayGap: 6,
  trayH: 30,
  trayY: [164, 197],
  detailY: 232,
  statusY: 252,
} as const;

const INK = 0x241d33;
const INK_SOFT = 0x6b5a44;
const SLOT_EMPTY = 0x1a1628;
const SLOT_LINE = 0x4a3f68;

type Cell =
  | { kind: 'slot'; row: number; col: number }
  | { kind: 'tray'; index: number };

interface CardView {
  c: Phaser.GameObjects.Container;
  baseX: number;
  baseY: number;
  ghost: boolean;
  /** Unit vector this card is shoved along while it conflicts. */
  push?: { x: number; y: number };
  phase: number;
}

interface Conflict {
  a: string;
  b: string;
  reason: string;
}

export class MemoryThreads {
  private board?: ThreadBoard;
  private root?: Phaser.GameObjects.Container;
  private content?: Phaser.GameObjects.Container;
  private texts: TextHandle[] = [];
  private views: CardView[] = [];
  private cursorGfx?: Phaser.GameObjects.Graphics;

  private open = false;
  private solved = false;
  private t = 0;

  /** slot key `${row}:${col}` → card id. */
  private placed = new Map<string, string>();
  private anchored = new Set<string>();
  private held: string | null = null;
  private cursor = { row: 0, col: 0 };
  private conflicts: Conflict[] = [];
  /** What the board said back the last time the player committed. */
  private answer = '';
  private argueIndex = 0;
  private art = { card: false, node: false, bar: false, conn: false, pin: false };

  constructor(private scene: Phaser.Scene) {
    on('threads:open', (p: { board: ThreadBoard }) => this.show(p.board));

    scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (!this.open || this.solved) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd'].includes(k)) {
        e.preventDefault();
      }
      if (k === 'arrowleft' || k === 'a') this.moveCursor(-1, 0);
      else if (k === 'arrowright' || k === 'd') this.moveCursor(1, 0);
      else if (k === 'arrowup' || k === 'w') this.moveCursor(0, -1);
      else if (k === 'arrowdown' || k === 's') this.moveCursor(0, 1);
      else if (k === ' ' || k === 'e') this.act();
      else if (k === 'enter') this.commit();
      else if (k === 'escape' || k === 'backspace') this.back();
    });

    // Mouse is a bonus: it drives exactly the same cell model.
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.open || this.solved) return;
      const cell = this.cellAt(p.worldX, p.worldY);
      if (!cell) return;
      this.cursor = this.cursorFor(cell);
      this.act();
    });

    // A live handle for the automated playtest; the game itself never uses it.
    (window as unknown as { __threads: unknown }).__threads = {
      isOpen: () => this.open,
      state: () => this.debugState(),
      place: (cardId: string, day: ThreadDay, slot: number) => this.debugPlace(cardId, day, slot),
      clear: (day: ThreadDay, slot: number) => this.debugClear(day, slot),
      commit: () => this.commit(),
      close: () => this.close(false),
    };
  }

  get isOpen(): boolean { return this.open; }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  private show(board: ThreadBoard): void {
    if (this.open) return;
    this.board = board;
    this.open = true;
    this.solved = false;
    this.placed.clear();
    this.anchored.clear();
    this.conflicts = [];
    this.answer = '';
    this.argueIndex = 0;
    this.held = null;
    this.cursor = { row: 2, col: 0 };

    this.art = {
      card: Panel.available(this.scene, 'clue'),
      node: hasFrame(this.scene, 'ui/thread_node_empty'),
      bar: hasFrame(this.scene, 'ui/timeline_bar_m'),
      conn: hasFrame(this.scene, 'ui/thread_connector_0'),
      pin: hasFrame(this.scene, 'ui/clue_pin'),
    };

    const c = this.scene.add.container(0, 0).setDepth(DEPTH.HUD + 170);
    this.root = c;
    c.add(this.scene.add.rectangle(0, 0, GAME_W, GAME_H, 0x0d0b14, 0.86).setOrigin(0, 0));
    c.add(Panel.build(this.scene, L.panel.x, L.panel.y, L.panel.w, L.panel.h, 'dark'));

    this.content = this.scene.add.container(0, 0);
    c.add(this.content);

    c.setAlpha(0);
    this.scene.tweens.add({ targets: c, alpha: 1, duration: 180 });
    Audio.sfx('journal_open', { volume: 0.5 });
    this.render();
  }

  private close(solved: boolean): void {
    if (!this.open) return;
    this.open = false;
    const c = this.root;
    this.root = undefined;
    this.clearContent();
    this.scene.tweens.add({
      targets: c, alpha: 0, duration: 200,
      onComplete: () => { c?.destroy(); emit('threads:closed', { solved }); },
    });
    Audio.sfx('journal_close', { volume: 0.4 });
  }

  private back(): void {
    if (this.held) {
      this.held = null;
      Audio.sfx('ui_cancel', { volume: 0.35 });
      this.render();
      return;
    }
    this.close(false);
  }

  // ── cells + cursor ────────────────────────────────────────────────────────

  private rowLength(row: number): number {
    return row < 2 ? 3 : 5;
  }

  private cellFromCursor(): Cell {
    const { row, col } = this.cursor;
    if (row < 2) return { kind: 'slot', row, col };
    return { kind: 'tray', index: (row - 2) * 5 + col };
  }

  private cursorFor(cell: Cell): { row: number; col: number } {
    if (cell.kind === 'slot') return { row: cell.row, col: cell.col };
    return { row: 2 + Math.floor(cell.index / 5), col: cell.index % 5 };
  }

  private moveCursor(dx: number, dy: number): void {
    const rows = 2 + Math.ceil(this.cardCount / 5);
    let { row, col } = this.cursor;
    if (dy) {
      row = Math.max(0, Math.min(rows - 1, row + dy));
      col = Math.min(col, this.rowLength(row) - 1);
    }
    if (dx) col = Math.max(0, Math.min(this.rowLength(row) - 1, col + dx));
    if (row === this.cursor.row && col === this.cursor.col) return;
    this.cursor = { row, col };
    Audio.sfx('ui_move', { volume: 0.28 });
    this.render();
  }

  private get cardCount(): number { return this.board?.cards.length ?? 0; }

  private cellAt(x: number, y: number): Cell | null {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const r = this.slotRect(row, col);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { kind: 'slot', row, col };
      }
    }
    for (let i = 0; i < this.cardCount; i++) {
      const r = this.trayRect(i);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { kind: 'tray', index: i };
    }
    return null;
  }

  private slotRect(row: number, col: number) {
    return { x: L.slotX + col * (L.slotW + L.slotGap), y: L.cardY[row], w: L.slotW, h: L.slotH };
  }

  private trayRect(i: number) {
    const r = Math.floor(i / 5);
    const c = i % 5;
    return { x: L.trayX + c * (L.trayW + L.trayGap), y: L.trayY[r], w: L.trayW, h: L.trayH };
  }

  // ── the one rule ──────────────────────────────────────────────────────────

  private card(id: string): ThreadCard | undefined {
    return this.board?.cards.find((c) => c.id === id);
  }

  private isAnchoring(card: ThreadCard, row: number, col: number): boolean {
    const truth = this.board?.truth[card.delivery];
    if (!truth) return false;
    const day = this.board!.rows[row].day;
    // A memory is never enough, however right it happens to be.
    return card.kind === 'context' && truth.day === day && truth.slot === col;
  }

  private placedCards(): Array<{ key: string; row: number; col: number; card: ThreadCard }> {
    const out: Array<{ key: string; row: number; col: number; card: ThreadCard }> = [];
    for (const [key, id] of this.placed) {
      const card = this.card(id);
      if (!card) continue;
      const [row, col] = key.split(':').map(Number);
      out.push({ key, row, col, card });
    }
    return out;
  }

  /**
   * Run after every change. This does NOT check anybody's answer — it only
   * notices the one thing the player could notice unaided: that two cards on the
   * board describe the same delivery, and one parcel cannot have gone to one
   * door on two days. Those two are then made to argue in public.
   */
  private evaluate(): void {
    const placed = this.placedCards();
    this.answer = '';
    this.conflicts = [];
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (a.card.delivery !== b.card.delivery) continue;
        this.conflicts.push({ a: a.card.id, b: b.card.id, reason: conflictReason(a.card, b.card) });
      }
    }
    if (this.conflicts.length && this.conflicts.length !== this.lastConflictCount) {
      Audio.sfx('ui_cancel', { volume: 0.45 });
      emit('threads:conflict', { reason: this.conflicts[0].reason });
    }
    this.lastConflictCount = this.conflicts.length;
  }

  private lastConflictCount = 0;

  /**
   * "That is both days." The only moment anything is judged, and it is judged
   * whole: six slots resolve together or none of them do.
   *
   * A refusal never says which card is wrong. It says one true thing about what
   * is on the board and stops talking.
   */
  private commit(): void {
    if (!this.board || this.solved) return;
    if (this.placed.size < 6) {
      const empty = 6 - this.placed.size;
      this.answer = empty === 1 ? 'One slot is still empty.' : `${empty} slots are still empty.`;
      Audio.sfx('ui_cancel', { volume: 0.3 });
      this.render();
      return;
    }
    const held = this.placedCards().every((p) => this.isAnchoring(p.card, p.row, p.col));
    if (!held) {
      this.answer = this.argue();
      Audio.sfx('ui_cancel', { volume: 0.5 });
      this.scene.cameras.main.shake(160, 0.003);
      emit('threads:refused', { reason: this.answer });
      this.render();
      return;
    }
    this.anchored = new Set(this.placedCards().map((p) => p.key));
    emit('threads:anchor', { count: this.anchored.size });
    this.render();
    this.finish();
  }

  /**
   * What the board says when it will not close. Never a verdict — a collision,
   * Oren on his own memory, or a physical fact and the thing that dates it.
   */
  private argue(): string {
    if (this.conflicts.length) return this.conflicts[0].reason;

    const memories = this.placedCards().filter((p) => p.card.kind === 'memory');
    if (memories.length) {
      const i = this.argueIndex++;
      if (i % 2 === 0 && this.board?.messages?.memory) return this.board.messages.memory;
      const m = memories[Math.floor(i / 2) % memories.length];
      return `Nothing holds ${sourceOf(m.card)}'s account in place.`;
    }

    const facts = this.placedCards().filter((p) => p.card.context);
    if (!facts.length) return 'Something on this board is standing in the wrong day.';
    const f = facts[this.argueIndex++ % facts.length];
    return `${f.card.note} ${f.card.context}`;
  }

  private finish(): void {
    this.solved = true;
    emit('threads:solved', {});
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const r = this.slotRect(row, col);
        this.scene.time.delayedCall(120 * (row * 3 + col), () => {
          this.shimmer(r.x + r.w / 2, r.y + r.h / 2);
          Audio.sfx('recall', { volume: 0.4, rate: 0.9 + (row * 3 + col) * 0.07 });
        });
      }
    }
    this.scene.time.delayedCall(1500, () => this.close(true));
  }

  private shimmer(x: number, y: number): void {
    if (!hasFrame(this.scene, 'fx/recall_shimmer_0')) return;
    const s = this.scene.add.sprite(x, y, 'atlas', 'fx/recall_shimmer_0')
      .setDepth(DEPTH.HUD + 180);
    this.root?.add(s);
    if (this.scene.anims.exists('fx_recall_shimmer')) {
      s.play('fx_recall_shimmer');
      s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    } else {
      this.scene.tweens.add({ targets: s, alpha: 0, scale: 1.6, duration: 420, onComplete: () => s.destroy() });
    }
  }

  // ── actions ───────────────────────────────────────────────────────────────

  private act(): void {
    if (!this.board) return;
    const cell = this.cellFromCursor();

    if (this.held) {
      if (cell.kind === 'tray') {
        this.held = null;
        Audio.sfx('ui_cancel', { volume: 0.3 });
        this.render();
        return;
      }
      const key = `${cell.row}:${cell.col}`;
      if (this.anchored.has(key)) { Audio.sfx('ui_cancel', { volume: 0.4 }); return; }
      // Whatever was there goes back to the tray; nothing is ever lost.
      this.placed.set(key, this.held);
      this.held = null;
      Audio.sfx('ui_confirm', { volume: 0.45 });
      this.answer = '';
      this.evaluate();
      this.render();
      return;
    }

    if (cell.kind === 'slot') {
      const key = `${cell.row}:${cell.col}`;
      const id = this.placed.get(key);
      if (!id || this.anchored.has(key)) { Audio.sfx('ui_cancel', { volume: 0.3 }); return; }
      this.placed.delete(key);
      this.held = id;
      Audio.sfx('pickup', { volume: 0.4 });
      this.evaluate();
      this.render();
      return;
    }

    const card = this.board.cards[cell.index];
    if (!card || [...this.placed.values()].includes(card.id)) { Audio.sfx('ui_cancel', { volume: 0.3 }); return; }
    this.held = card.id;
    Audio.sfx('pickup', { volume: 0.4 });
    this.render();
  }

  // ── debug hooks (playtest harness) ────────────────────────────────────────

  private debugPlace(cardId: string, day: ThreadDay, slot: number): boolean {
    if (!this.board || !this.open) return false;
    const row = this.board.rows.findIndex((r) => r.day === day);
    if (row < 0 || !this.card(cardId)) return false;
    const key = `${row}:${slot}`;
    if (this.anchored.has(key)) return false;
    for (const [k, v] of [...this.placed]) if (v === cardId) this.placed.delete(k);
    this.placed.set(key, cardId);
    this.evaluate();
    this.render();
    return true;
  }

  private debugClear(day: ThreadDay, slot: number): boolean {
    if (!this.board || !this.open) return false;
    const row = this.board.rows.findIndex((r) => r.day === day);
    const key = `${row}:${slot}`;
    if (this.anchored.has(key)) return false;
    const had = this.placed.delete(key);
    this.evaluate();
    this.render();
    return had;
  }

  private debugState() {
    return {
      open: this.open,
      solved: this.solved,
      anchored: [...this.anchored],
      conflicts: this.conflicts.map((c) => ({ ...c })),
      placed: Object.fromEntries(this.placed),
      cards: (this.board?.cards ?? []).map((c) => ({ id: c.id, kind: c.kind, delivery: c.delivery })),
      cursor: { ...this.cursor },
      held: this.held,
      answer: this.answer,
    };
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  private clearContent(): void {
    this.texts.forEach((t) => t.destroy());
    this.texts = [];
    this.views = [];
    this.cursorGfx = undefined;
    this.content?.removeAll(true);
  }

  private text(x: number, y: number, s: string, font: 'body' | 'display' = 'body', tint = COLORS.parchment): TextHandle {
    const t = makeText(this.scene, x, y, s, font, { tint });
    this.content?.add(t.obj);
    this.texts.push(t);
    return t;
  }

  private render(): void {
    if (!this.content || !this.board) return;
    this.clearContent();
    const b = this.board;

    // ── header ─────────────────────────────────────────────────────────────
    this.text(L.labelX, L.titleY, b.title, 'display', COLORS.goldLight);
    const hint = this.text(L.panel.x + L.panel.w - 8, L.titleY + 2, 'WASD move  SPACE lift  ENTER commit  ESC back', 'body', 0x6f6390);
    hint.setOrigin(1, 0);
    this.text(L.labelX, L.ruleY, b.rule, 'body', 0x9a90b8);

    const g = this.scene.add.graphics();
    this.content.add(g);
    g.lineStyle(1, SLOT_LINE, 0.7);
    g.lineBetween(L.labelX, L.ruleY + 12, L.panel.x + L.panel.w - 14, L.ruleY + 12);

    // ── column headings ────────────────────────────────────────────────────
    b.columns.forEach((name, i) => {
      const r = this.slotRect(0, i);
      const t = this.text(r.x + r.w / 2, L.headerY, name.toUpperCase(), 'body', 0x8f83ae);
      t.setOrigin(0.5, 0);
    });

    // ── the two timelines ──────────────────────────────────────────────────
    b.rows.forEach((rowDef, row) => {
      const stripY = L.strip[row];
      this.drawRail(g, row);
      const label = this.text(L.labelX, stripY - 8, rowDef.label, 'body', COLORS.goldLight);
      label.setOrigin(0, 0);
      const sub = this.text(L.labelX, stripY + 3, rowDef.sub, 'body', 0x8f83ae);
      sub.setOrigin(0, 0);

      for (let col = 0; col < 3; col++) {
        const r = this.slotRect(row, col);
        const key = `${row}:${col}`;
        const id = this.placed.get(key);
        const card = id ? this.card(id) : undefined;
        this.drawNode(r.x + r.w / 2, stripY, key, card);
        if (col < 2) this.drawConnector(r.x + r.w + L.slotGap / 2, stripY);
        if (!card) this.drawEmptySlot(g, r);
        else this.drawCard(card, r.x, r.y, r.w, r.h, key);
      }
    });

    // ── the evidence tray ──────────────────────────────────────────────────
    this.text(L.trayX + 2, L.trayLabelY, 'EVIDENCE', 'body', 0xa87a22);
    const placedIds = new Set(this.placed.values());
    b.cards.forEach((card, i) => {
      const r = this.trayRect(i);
      if (placedIds.has(card.id) || this.held === card.id) {
        g.lineStyle(1, SLOT_LINE, 0.55);
        g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        return;
      }
      this.drawCard(card, r.x, r.y, r.w, r.h);
    });

    // ── the card in hand, riding the cursor ────────────────────────────────
    if (this.held) {
      const held = this.card(this.held);
      const cell = this.cellFromCursor();
      const r = cell.kind === 'slot' ? this.slotRect(cell.row, cell.col) : this.trayRect(cell.index);
      if (held) {
        g.fillStyle(0x000000, 0.4);
        g.fillRect(r.x + 2, r.y + 2, r.w, r.h);
        this.drawCard(held, r.x - 2, r.y - 4, r.w, r.h);
      }
    }

    // ── conflict threads ───────────────────────────────────────────────────
    for (const c of this.conflicts) this.drawConflict(g, c);

    // ── detail + status ────────────────────────────────────────────────────
    this.drawFooter();
    this.drawCursor();
  }

  private drawRail(g: Phaser.GameObjects.Graphics, row: number): void {
    const y = L.strip[row];
    const x0 = this.slotRect(row, 0).x + 10;
    const x1 = this.slotRect(row, 2).x + L.slotW - 10;
    if (this.art.bar) {
      for (let x = x0; x < x1; x += 8) {
        const frame = x === x0 ? 'ui/timeline_bar_l' : x + 8 >= x1 ? 'ui/timeline_bar_r' : 'ui/timeline_bar_m';
        const img = this.scene.add.image(x, y, 'atlas', frame).setOrigin(0, 0.5);
        this.content?.add(img);
      }
      return;
    }
    g.lineStyle(1, 0x6b5a90, 0.9);
    g.lineBetween(x0, y, x1, y);
  }

  private drawNode(cx: number, cy: number, key: string, card?: ThreadCard): void {
    const conflicted = !!card && this.conflicts.some((c) => c.a === card.id || c.b === card.id);
    const state = this.anchored.has(key) ? 'filled' : conflicted ? 'wrong' : 'empty';
    if (this.art.node) {
      const img = this.scene.add.image(cx, cy, 'atlas', `ui/thread_node_${state}`).setOrigin(0.5);
      this.content?.add(img);
      return;
    }
    const g = this.scene.add.graphics();
    this.content?.add(g);
    const color = state === 'filled' ? COLORS.gold : state === 'wrong' ? COLORS.danger : 0x5d4e78;
    g.fillStyle(color, 1);
    g.fillCircle(cx, cy, state === 'empty' ? 3 : 4);
  }

  private drawConnector(cx: number, cy: number): void {
    if (this.art.conn) {
      const s = this.scene.add.sprite(cx, cy, 'atlas', 'ui/thread_connector_0').setOrigin(0.5);
      if (this.scene.anims.exists('ui_thread_flow')) s.play('ui_thread_flow');
      this.content?.add(s);
      return;
    }
    const g = this.scene.add.graphics();
    this.content?.add(g);
    g.lineStyle(1, 0x6b5a90, 0.9);
    g.lineBetween(cx - 5, cy, cx + 4, cy);
    g.lineBetween(cx + 1, cy - 3, cx + 4, cy);
    g.lineBetween(cx + 1, cy + 3, cx + 4, cy);
  }

  private drawEmptySlot(g: Phaser.GameObjects.Graphics, r: { x: number; y: number; w: number; h: number }): void {
    g.fillStyle(SLOT_EMPTY, 0.85);
    g.fillRect(r.x, r.y, r.w, r.h);
    g.lineStyle(1, SLOT_LINE, 0.9);
    g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }

  /**
   * One card face, in slot size or tray size.
   *
   * The two kinds are told apart three ways at once, because at 480x270 one way
   * is never enough: contextual cards carry a pin and sit still; memory cards
   * have no pin, are drawn pale, and waver.
   */
  private drawCard(card: ThreadCard, x: number, y: number, w: number, h: number, slotKey?: string): void {
    const c = this.scene.add.container(0, 0);
    this.content?.add(c);
    const ghost = card.kind === 'memory';
    const anchored = !!slotKey && this.anchored.has(slotKey);
    const conflicted = this.conflicts.some((k) => k.a === card.id || k.b === card.id);

    if (this.art.card) {
      c.add(Panel.build(this.scene, x, y, w, h, 'clue'));
    } else {
      const g = this.scene.add.graphics();
      g.fillStyle(0xd8c69c, 1);
      g.fillRect(x, y, w, h);
      g.lineStyle(1, 0x8a7458, 1);
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      c.add(g);
    }

    // Border state: anchored is gold, conflicted is danger, otherwise nothing.
    if (anchored || conflicted) {
      const g = this.scene.add.graphics();
      g.lineStyle(1, anchored ? COLORS.gold : COLORS.danger, 1);
      g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      c.add(g);
    }

    // A colour bar rather than a swatch: the wrap has to be findable at a
    // glance in a tray of ten, and a bar survives being 4px wide.
    const bar = this.scene.add.rectangle(x + 6, y + 6, 4, h - 12, card.tint).setOrigin(0, 0);
    c.add(bar);

    const p = makeText(this.scene, x + 14, y + 7, card.parcel.toUpperCase(), 'body', { tint: INK });
    const a = makeText(this.scene, x + 14, y + 18, card.address, 'body', { tint: INK_SOFT });
    c.add(p.obj); c.add(a.obj);
    this.texts.push(p, a);

    // The pin is the whole tell: only evidence that stays put gets one.
    if (card.kind === 'context') {
      if (this.art.pin) {
        c.add(this.scene.add.image(x + w - 7, y + 3, 'atlas', 'ui/clue_pin').setOrigin(0.5, 0));
      } else {
        const g = this.scene.add.graphics();
        g.fillStyle(COLORS.gold, 1);
        g.fillCircle(x + w - 7, y + 6, 2.5);
        c.add(g);
      }
    }

    if (ghost) c.setAlpha(0.62);

    const view: CardView = { c, baseX: 0, baseY: 0, ghost, phase: hashPhase(card.id) };
    if (conflicted && slotKey) {
      const other = this.conflicts.find((k) => k.a === card.id || k.b === card.id)!;
      const otherId = other.a === card.id ? other.b : other.a;
      const mine = { x: x + w / 2, y: y + h / 2 };
      const theirs = this.centreOf(otherId);
      if (theirs) {
        const dx = mine.x - theirs.x;
        const dy = mine.y - theirs.y;
        const d = Math.hypot(dx, dy) || 1;
        view.push = { x: dx / d, y: dy / d };
      }
    }
    this.views.push(view);
  }

  private centreOf(cardId: string): { x: number; y: number } | null {
    for (const [key, id] of this.placed) {
      if (id !== cardId) continue;
      const [row, col] = key.split(':').map(Number);
      const r = this.slotRect(row, col);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }
    return null;
  }

  private drawConflict(g: Phaser.GameObjects.Graphics, c: Conflict): void {
    const a = this.centreOf(c.a);
    const b = this.centreOf(c.b);
    if (!a || !b) return;
    g.lineStyle(1, COLORS.danger, 0.95);
    // A frayed thread, not a clean line — this connection does not hold. The
    // kink is perpendicular to the run, so it reads on any pair of slots.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px0 = -dy / len;
    const py0 = dx / len;
    const steps = 9;
    let px = a.x, py = a.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const k = i < steps ? (i % 2 ? 3.5 : -3.5) : 0;
      const nx = a.x + dx * t + px0 * k;
      const ny = a.y + dy * t + py0 * k;
      g.lineBetween(px, py, nx, ny);
      px = nx; py = ny;
    }
  }

  private drawFooter(): void {
    const cell = this.cellFromCursor();
    const focus = this.held
      ? this.card(this.held)
      : cell.kind === 'tray'
        ? this.board!.cards[cell.index]
        : this.card(this.placed.get(`${cell.row}:${cell.col}`) ?? '');

    if (this.answer) {
      const wrapped = wrapText(this.scene, this.answer, 'body', L.panel.w - 40);
      this.text(L.trayX + 2, L.detailY, wrapped, 'body', COLORS.goldLight);
    } else if (focus) {
      const wrapped = wrapText(this.scene, focus.note, 'body', L.panel.w - 40);
      this.text(L.trayX + 2, L.detailY, wrapped, 'body', focus.kind === 'context' ? COLORS.parchment : 0x9f95bd);
    }

    // The bottom line is the board's own voice: the collision it can see, or
    // the invitation to commit. It never counts anything.
    let status = this.board!.messages?.ready ?? 'ENTER — that is both days';
    let tint = 0x8f83ae;
    if (this.conflicts.length) {
      status = this.conflicts[0].reason;
      tint = COLORS.danger;
    } else if (this.placed.size < 6) {
      status = 'Pin all six, then ENTER.';
    }
    this.text(L.trayX + 2, L.statusY, status, 'body', tint);
  }

  private drawCursor(): void {
    const cell = this.cellFromCursor();
    const r = cell.kind === 'slot' ? this.slotRect(cell.row, cell.col) : this.trayRect(cell.index);
    const g = this.scene.add.graphics();
    this.content?.add(g);
    this.cursorGfx = g;
    this.paintCursor(r);
  }

  private paintCursor(r: { x: number; y: number; w: number; h: number }): void {
    const g = this.cursorGfx;
    if (!g) return;
    g.clear();
    g.lineStyle(1, this.held ? COLORS.echoCyan : COLORS.goldLight, 1);
    const k = 6;
    const x0 = r.x - 2.5, y0 = r.y - 2.5, x1 = r.x + r.w + 1.5, y1 = r.y + r.h + 1.5;
    g.lineBetween(x0, y0, x0 + k, y0); g.lineBetween(x0, y0, x0, y0 + k);
    g.lineBetween(x1, y0, x1 - k, y0); g.lineBetween(x1, y0, x1, y0 + k);
    g.lineBetween(x0, y1, x0 + k, y1); g.lineBetween(x0, y1, x0, y1 - k);
    g.lineBetween(x1, y1, x1 - k, y1); g.lineBetween(x1, y1, x1, y1 - k);
  }

  // ── per-frame life ────────────────────────────────────────────────────────

  update(dt: number): void {
    if (!this.open) return;
    this.t += dt;
    for (const v of this.views) {
      let ox = 0;
      let oy = 0;
      if (v.ghost) {
        v.c.setAlpha(0.5 + Math.sin(this.t / 280 + v.phase) * 0.17);
        ox += Math.sin(this.t / 330 + v.phase) * 0.9;
        oy += Math.cos(this.t / 410 + v.phase) * 0.7;
      }
      if (v.push) {
        // The two accounts shove at each other; neither gives way.
        const s = 1.6 + Math.sin(this.t / 110) * 1.6;
        ox += v.push.x * s;
        oy += v.push.y * s;
      }
      v.c.setPosition(v.baseX + ox, v.baseY + oy);
    }
    if (this.cursorGfx) this.cursorGfx.setAlpha(0.65 + Math.sin(this.t / 190) * 0.35);
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function hashPhase(id: string): number {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) | 0;
  return ((n >>> 0) % 628) / 100;
}

/** Whose account a memory card is, taken from its note: "OREN: ..." → "Oren". */
function sourceOf(card: ThreadCard): string {
  const m = /^([A-Z][A-Z ]+):/.exec(card.note);
  if (!m) return 'that';
  const name = m[1].trim().toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function conflictReason(a: ThreadCard, b: ThreadCard): string {
  const both = a.kind === 'memory' && b.kind === 'memory';
  if (both) return `Two people, one ${a.parcel.toLowerCase()} parcel, two days. Neither of them checked.`;
  const mem = a.kind === 'memory' ? a : b;
  const ctx = a.kind === 'memory' ? b : a;
  return `${mem.note} But: ${ctx.note.toLowerCase()}`;
}
