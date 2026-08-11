/**
 * Puzzle primitives.
 *
 * The Echo Shrine is built out of these, and so are the town quests. Keeping
 * them in one place means every plate, gate and switch in the game looks and
 * behaves identically — which is what lets a player form a hypothesis in room
 * one and rely on it in room five.
 *
 * Every primitive is *legible before interaction*: an un-pressed plate is
 * raised and shadowed, a pressed one is sunk and lit; a locked gate shows its
 * bars. That is a design requirement, not a nicety — see the reference pack's
 * note that traversal rules must be communicated visually.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { emit } from '@/core/events';
import { hasFrame } from '@/core/textures';
import { Audio } from '@/audio/Audio';
import type { WorldScene } from '@/scenes/WorldScene';

export interface Occupant {
  x: number;
  y: number;
  /** Heavy enough to hold a plate down. */
  weight: number;
}

// ── Pressure plate ──────────────────────────────────────────────────────────

export interface PlateOptions {
  /** Stays down once triggered. */
  latching?: boolean;
  /** Minimum weight required; the player is weight 1. */
  requires?: number;
  /** Frame to use; defaults to the shrine set. */
  art?: { up: string; down: string };
}

export class PressurePlate {
  sprite: Phaser.GameObjects.Sprite;
  pressed = false;
  private latched = false;
  private art: { up: string; down: string };

  constructor(
    private scene: WorldScene,
    public tx: number,
    public ty: number,
    private opts: PlateOptions = {},
  ) {
    this.art = opts.art ?? { up: 'prop/shrine/plate_up', down: 'prop/shrine/plate_down' };
    const frame = hasFrame(scene, this.art.up) ? this.art.up : 'ui/fade_pixel';
    this.sprite = scene.add.sprite(tx * TILE + TILE / 2, ty * TILE + TILE, 'atlas', frame)
      .setOrigin(0.5, 1)
      // Plates sit on the floor: below every entity, above the tile layers.
      .setDepth(DEPTH.SCATTER + 5);
  }

  /** Returns true if the pressed state changed this frame. */
  update(occupants: Occupant[]): boolean {
    if (this.latched) return false;
    const need = this.opts.requires ?? 1;
    let weight = 0;
    for (const o of occupants) {
      if (Math.floor(o.x / TILE) === this.tx && Math.floor((o.y - 1) / TILE) === this.ty) {
        weight += o.weight;
      }
    }
    const now = weight >= need;
    if (now === this.pressed) return false;
    this.pressed = now;
    if (now && this.opts.latching) this.latched = true;
    const frame = now ? this.art.down : this.art.up;
    if (hasFrame(this.scene, frame)) this.sprite.setFrame(frame);
    Audio.sfx('pressure_plate', { volume: now ? 0.55 : 0.35, rate: now ? 1 : 0.85 });
    if (now) {
      this.scene.fx.burst(this.sprite.x, this.sprite.y - 4, 'fx/rune_activate', DEPTH.SCATTER + 6);
    }
    emit('puzzle:plate', { tx: this.tx, ty: this.ty, pressed: now });
    return true;
  }

  reset(): void {
    this.latched = false;
    this.pressed = false;
    if (hasFrame(this.scene, this.art.up)) this.sprite.setFrame(this.art.up);
  }

  destroy(): void { this.sprite.destroy(); }
}

// ── Gate / door ─────────────────────────────────────────────────────────────

export class Gate {
  sprite: Phaser.GameObjects.Sprite;
  open = false;

  constructor(
    private scene: WorldScene,
    public tx: number,
    public ty: number,
    private opts: { w?: number; h?: number; art?: { closed: string; open: string; anim?: string }; startOpen?: boolean } = {},
  ) {
    const art = opts.art ?? { closed: 'prop/shrine/gate_closed', open: 'prop/shrine/gate_open', anim: 'shrine_gate_open' };
    const frame = hasFrame(scene, art.closed) ? art.closed : 'ui/fade_pixel';
    this.sprite = scene.add.sprite(tx * TILE + TILE / 2, ty * TILE + TILE, 'atlas', frame)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + ty * TILE + TILE);
    if (opts.startOpen) this.setOpen(true, true);
    else this.applyCollision(true);
  }

  private get art() {
    return this.opts.art ?? { closed: 'prop/shrine/gate_closed', open: 'prop/shrine/gate_open', anim: 'shrine_gate_open' };
  }

  private applyCollision(solid: boolean): void {
    const w = this.opts.w ?? 2;
    const h = this.opts.h ?? 1;
    this.scene.setDynamicSolidRect(this.tx - Math.floor((w - 1) / 2), this.ty, w, h, solid);
  }

  setOpen(open: boolean, instant = false): void {
    if (this.open === open) return;
    this.open = open;
    this.applyCollision(!open);
    const art = this.art;
    if (open) {
      Audio.sfx('gate_open', { volume: 0.6 });
      if (!instant && art.anim && this.scene.anims.exists(art.anim)) {
        this.sprite.play(art.anim);
        this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          if (hasFrame(this.scene, art.open)) this.sprite.setFrame(art.open);
        });
      } else if (hasFrame(this.scene, art.open)) {
        this.sprite.setFrame(art.open);
      }
      if (!instant) {
        // A short camera nudge tells the player something opened off-screen.
        emit('puzzle:opened', { tx: this.tx, ty: this.ty });
      }
    } else {
      if (hasFrame(this.scene, art.closed)) this.sprite.setFrame(art.closed);
      Audio.sfx('door_stone', { volume: 0.5 });
    }
  }

  destroy(): void {
    this.applyCollision(false);
    this.sprite.destroy();
  }
}

// ── Push block ──────────────────────────────────────────────────────────────

export class PushBlock {
  sprite: Phaser.GameObjects.Sprite;
  private moving = false;

  constructor(
    private scene: WorldScene,
    public tx: number,
    public ty: number,
    private art = 'prop/shrine/block_push',
  ) {
    const frame = hasFrame(scene, art) ? art : 'ui/fade_pixel';
    this.sprite = scene.add.sprite(tx * TILE + TILE / 2, ty * TILE + TILE, 'atlas', frame)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + ty * TILE + TILE);
    scene.setDynamicSolid(tx, ty, true);
  }

  /** Try to shove the block one tile. Returns false if it can't move. */
  push(dx: number, dy: number): boolean {
    if (this.moving) return false;
    const nx = this.tx + Math.sign(dx);
    const ny = this.ty + Math.sign(dy);
    const grid = this.scene.collisionGrid();
    if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[0].length) return false;
    // Ignore our own cell when testing the destination.
    this.scene.setDynamicSolid(this.tx, this.ty, false);
    const blocked = this.scene.collisionGrid()[ny][nx];
    if (blocked) {
      this.scene.setDynamicSolid(this.tx, this.ty, true);
      return false;
    }
    this.moving = true;
    this.tx = nx;
    this.ty = ny;
    this.scene.setDynamicSolid(nx, ny, true);
    Audio.sfx('push_block', { volume: 0.5 });
    this.scene.tweens.add({
      targets: this.sprite,
      x: nx * TILE + TILE / 2,
      y: ny * TILE + TILE,
      duration: 260,
      ease: 'Quad.easeOut',
      onUpdate: () => { this.sprite.setDepth(DEPTH.ENTITY_BASE + this.sprite.y); },
      onComplete: () => {
        this.moving = false;
        this.scene.fx.dust(this.sprite.x, this.sprite.y);
        emit('puzzle:block', { tx: this.tx, ty: this.ty });
      },
    });
    return true;
  }

  get occupant(): Occupant {
    return { x: this.sprite.x, y: this.sprite.y, weight: 4 };
  }

  destroy(): void {
    this.scene.setDynamicSolid(this.tx, this.ty, false);
    this.sprite.destroy();
  }
}

// ── Rune display / sequence lock ────────────────────────────────────────────

/** The four shrine glyphs. Kept deliberately few so they stay tellable apart. */
export const RUNES = ['spiral', 'bars', 'chevron', 'ring'] as const;
export type Rune = typeof RUNES[number];

export class RuneLight {
  sprite: Phaser.GameObjects.Sprite;
  lit = false;

  constructor(
    private scene: WorldScene,
    public rune: Rune,
    x: number,
    y: number,
    private opts: { scale?: number } = {},
  ) {
    const idx = RUNES.indexOf(rune);
    const dim = `prop/shrine/rune_pillar_${idx}`;
    const frame = hasFrame(scene, dim) ? dim : 'ui/fade_pixel';
    this.sprite = scene.add.sprite(x, y, 'atlas', frame)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + y)
      .setAlpha(0.55);
    if (opts.scale) this.sprite.setScale(opts.scale);
  }

  flash(ms = 480): Promise<void> {
    this.lit = true;
    this.sprite.setAlpha(1);
    this.scene.fx.burst(this.sprite.x, this.sprite.y - 12, 'fx/rune_activate');
    Audio.sfx('rune_activate', { volume: 0.5, rate: 0.9 + RUNES.indexOf(this.rune) * 0.12 });
    return new Promise((resolve) => {
      this.scene.time.delayedCall(ms, () => {
        this.lit = false;
        this.sprite.setAlpha(0.55);
        resolve();
      });
    });
  }

  setLit(on: boolean): void {
    this.lit = on;
    this.sprite.setAlpha(on ? 1 : 0.55);
  }

  destroy(): void { this.sprite.destroy(); }
}

/**
 * A lock that opens only for one exact ordered sequence.
 *
 * Used by the Memory room: two similar sequences are shown, and only the one
 * matching this door's *context* opens it. Guessing is punished only by having
 * to start the entry over — failure in this game is always cheap.
 */
export class SequenceLock {
  private entered: Rune[] = [];

  constructor(
    private scene: WorldScene,
    public readonly answer: Rune[],
    private onSolved: () => void,
    private onWrong?: (entered: Rune[]) => void,
  ) {}

  press(rune: Rune): { ok: boolean; complete: boolean } {
    this.entered.push(rune);
    const i = this.entered.length - 1;
    if (this.answer[i] !== rune) {
      const wrong = [...this.entered];
      this.entered = [];
      Audio.sfx('ui_cancel', { volume: 0.5 });
      this.scene.shake(0.003, 140);
      this.onWrong?.(wrong);
      return { ok: false, complete: false };
    }
    Audio.sfx('rune_activate', { volume: 0.45, rate: 1 + i * 0.08 });
    if (this.entered.length === this.answer.length) {
      this.entered = [];
      this.onSolved();
      return { ok: true, complete: true };
    }
    return { ok: true, complete: false };
  }

  get progress(): number { return this.entered.length; }

  reset(): void { this.entered = []; }
}

/**
 * A lock that judges a whole entry at once, and says nothing until it is done.
 *
 * `SequenceLock` rejects on the first wrong symbol, which is the right feedback
 * for a lock whose answer the player has been *shown*: it tells you exactly
 * where you slipped. It is the wrong feedback for a lock whose answer the
 * player has to *reconstruct*, because per-press rejection is a free oracle —
 * press each rune until one is accepted and you have position one, repeat, and
 * a four-symbol order falls out in about ten presses without understanding
 * anything at all.
 *
 * `OrderLock` takes the whole entry before it judges. A wrong order costs one
 * full entry and yields no positional information, so guessing an order out of
 * twenty-four is not a strategy. Failure is still free — nothing is lost but
 * the four presses (plan.md §67) — it just is not *informative*.
 */
export class OrderLock {
  private entered: Rune[] = [];

  constructor(
    private scene: WorldScene,
    /** How many symbols make one entry. */
    public readonly length: number,
    /** Judge a completed entry. Return true if it opened something. */
    private onSubmit: (entry: Rune[]) => boolean,
  ) {}

  /** The entry so far — the caller lights its runes so input is never blind. */
  get entry(): Rune[] { return [...this.entered]; }
  get progress(): number { return this.entered.length; }

  press(rune: Rune): { complete: boolean; ok: boolean } {
    if (this.entered.length >= this.length) this.entered = [];
    this.entered.push(rune);
    const i = this.entered.length - 1;
    Audio.sfx('rune_activate', { volume: 0.45, rate: 0.94 + i * 0.06 });
    if (this.entered.length < this.length) return { complete: false, ok: false };

    const submitted = [...this.entered];
    this.entered = [];
    const ok = this.onSubmit(submitted);
    if (!ok) {
      // Deliberately uninformative: the same shrug for every wrong order.
      Audio.sfx('ui_cancel', { volume: 0.5 });
      this.scene.shake(0.003, 160);
    }
    return { complete: true, ok };
  }

  reset(): void { this.entered = []; }
}

// ── Room controller ─────────────────────────────────────────────────────────

/**
 * Convenience wrapper an area script uses to wire plates → gates and to run the
 * per-frame occupancy check for a room.
 */
export class PuzzleRoom {
  plates: PressurePlate[] = [];
  gates: Gate[] = [];
  blocks: PushBlock[] = [];
  runes: RuneLight[] = [];
  private rules: Array<{ plates: PressurePlate[]; gate: Gate; all: boolean }> = [];

  constructor(private scene: WorldScene) {}

  plate(tx: number, ty: number, opts?: PlateOptions): PressurePlate {
    const p = new PressurePlate(this.scene, tx, ty, opts);
    this.plates.push(p);
    return p;
  }

  gate(tx: number, ty: number, opts?: ConstructorParameters<typeof Gate>[3]): Gate {
    const g = new Gate(this.scene, tx, ty, opts);
    this.gates.push(g);
    return g;
  }

  block(tx: number, ty: number): PushBlock {
    const b = new PushBlock(this.scene, tx, ty);
    this.blocks.push(b);
    return b;
  }

  /** Gate opens when all (or any) of these plates are pressed. */
  link(plates: PressurePlate[], gate: Gate, all = true): void {
    this.rules.push({ plates, gate, all });
  }

  update(): void {
    const occupants: Occupant[] = [
      { x: this.scene.player.x, y: this.scene.player.y, weight: 1 },
      ...this.scene.enemies.list.filter((e) => !e.dead).map((e) => ({ x: e.x, y: e.y, weight: 3 })),
      ...this.blocks.map((b) => b.occupant),
    ];
    let changed = false;
    for (const p of this.plates) changed = p.update(occupants) || changed;
    if (!changed) return;
    for (const r of this.rules) {
      const ok = r.all ? r.plates.every((p) => p.pressed) : r.plates.some((p) => p.pressed);
      r.gate.setOpen(ok);
    }
  }

  destroy(): void {
    this.plates.forEach((p) => p.destroy());
    this.gates.forEach((g) => g.destroy());
    this.blocks.forEach((b) => b.destroy());
    this.runes.forEach((r) => r.destroy());
    this.plates = []; this.gates = []; this.blocks = []; this.runes = []; this.rules = [];
  }
}
