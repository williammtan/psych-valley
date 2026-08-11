/**
 * ECHO SHRINE — the shared runtime kit.
 *
 * Not an area script: no `registerArea` call lives here. It is the small pile of
 * things all five shrine rooms do identically, kept in one place so that a plate
 * in room one and a plate in room five behave, sound and read the same. A player
 * forms a hypothesis in the first room and spends the rest of the dungeon
 * relying on it; that only works if the rooms agree with each other.
 *
 * What is here:
 *   doorGate()      a door centred in a two-tile threshold, at a depth that
 *                   never hides the player
 *   RoomRig         reset/teardown bookkeeping — every room re-arms itself on
 *                   `room:reset` (plan.md §67), and unsubscribes on exit
 *   HintDirector    Mote's escalating *visual* hints (plan.md §66). No text.
 *   setRuneTile()   light or dim a rune plate set into the floor
 *   readEnv()       play an authored environment exchange (the observatory logs)
 *   pinTo()         hold a puzzle creature in place; they are scenery with legs
 *                   and must never be shovable by an impatient sword
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { emit, on } from '@/core/events';
import { State } from '@/core/state';
import { Audio } from '@/audio/Audio';
import { tileIndex } from '@/world/art';
import { Gate } from '@/systems/Puzzle';
import { RUNES, type Rune } from '@/systems/Puzzle';
import { describe, runBeats } from '@/data/dialogue';
import type { Enemy } from '@/entities/Enemy';
import type { WorldScene } from '@/scenes/WorldScene';

// ── geometry ────────────────────────────────────────────────────────────────

/** Centre of a tile, in world pixels, at the point a sprite's feet sit. */
export function tc(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE };
}

/** Centre of a tile, in world pixels, at its middle rather than its base. */
export function tm(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

// ── doors ───────────────────────────────────────────────────────────────────

export const DOOR_ART = { closed: 'prop/shrine/door_closed', open: 'prop/shrine/door_open', anim: 'shrine_door_open' };
export const SEALED_ART = { closed: 'prop/shrine/door_locked', open: 'prop/shrine/door_open', anim: 'shrine_door_open' };
export const BARS_ART = { closed: 'prop/shrine/gate_closed', open: 'prop/shrine/gate_open', anim: 'shrine_gate_open' };

/**
 * A door standing in a two-tile threshold at `x`, `x+1`.
 *
 * Two corrections over a bare `Gate`: the 32px sprite is nudged half a tile so
 * it is centred on the gap rather than on its left tile, and its depth is
 * pinned *below* the whole floor so a closed door can never draw over the
 * player walking up to it. A door you cannot see yourself standing in front of
 * is a door you will walk into twice.
 */
export function doorGate(
  w: WorldScene,
  x: number,
  wallY: number,
  opts: { art?: typeof DOOR_ART; startOpen?: boolean } = {},
): Gate {
  const g = new Gate(w, x, wallY, { w: 2, h: 1, art: opts.art ?? DOOR_ART, startOpen: opts.startOpen });
  g.sprite.x += TILE / 2;
  g.sprite.setDepth(DEPTH.ENTITY_BASE + wallY * TILE - 24);
  return g;
}

// ── rune plates set into the floor ──────────────────────────────────────────

/**
 * Swap a floor rune plate between its dead and lit tile.
 *
 * The four glyphs are the shrine's whole symbolic vocabulary (`RUNES`), so a
 * plate is always one of exactly four things and never a decoration that only
 * looks like a plate.
 */
export function setRuneTile(w: WorldScene, tx: number, ty: number, rune: Rune, lit: boolean): void {
  const i = RUNES.indexOf(rune);
  if (i < 0) return;
  try {
    w.world.ground.putTileAt(tileIndex(`tile/shrine/rune_floor${lit ? '' : '_dim'}_${i}`), tx, ty);
  } catch { /* art gap: leave the floor as it is rather than crash a room */ }
}

/** A plate flaring as something passes over it. */
export function flareRune(w: WorldScene, tx: number, ty: number, rune: Rune, color = 0xa681e6): void {
  const p = tm(tx, ty);
  setRuneTile(w, tx, ty, rune, true);
  w.fx.burst(p.x, p.y, 'fx/rune_activate', DEPTH.SCATTER + 8);
  const glow = w.add.image(p.x, p.y, 'atlas', 'fx/light_soft_64')
    .setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.LIGHT + 1).setTint(color).setAlpha(0.9).setScale(0.7);
  w.tweens.add({ targets: glow, alpha: 0, scale: 1.1, duration: 620, onComplete: () => glow.destroy() });
}

// ── authored environment text ───────────────────────────────────────────────

/**
 * Play one of the authored exchanges from `@/data/dialogue` — in the shrine
 * that means the observatory's research logs, which are the only voice down
 * here besides the room itself. Nothing in them names a concept; they are nine
 * people writing down what they saw and slowly stopping.
 */
export function readEnv(w: WorldScene, id: string): boolean {
  const beats = describe(id);
  if (!beats || !beats.length) return false;
  void w.cutscene.talk((c) => runBeats(c, beats));
  return true;
}

// ── room rig ────────────────────────────────────────────────────────────────

/**
 * Per-room bookkeeping.
 *
 * Every shrine room subscribes to `room:reset` — GameFlow fires it after the
 * player goes down, and the room has to come back exactly as it was found.
 * Rooms also need their listeners removed on exit, because the maps are torn
 * down and rebuilt and a stale listener holds a dead scene.
 */
export class RoomRig {
  private offs: Array<() => void> = [];
  private timers: Phaser.Time.TimerEvent[] = [];

  constructor(private w: WorldScene) {}

  /** Subscribe to a bus event for as long as this room is loaded. */
  listen(event: string, fn: (p: never) => void): void {
    this.offs.push(on(event, fn as (p: unknown) => void));
  }

  /** Re-arm this room whenever the player respawns into it. */
  onReset(fn: () => void): void {
    this.listen('room:reset', ((p: { map: string }) => {
      if (p.map === this.w.mapId) fn();
    }) as (p: never) => void);
  }

  after(ms: number, fn: () => void): void {
    this.timers.push(this.w.time.delayedCall(ms, fn));
  }

  destroy(): void {
    this.offs.forEach((f) => f());
    this.offs = [];
    this.timers.forEach((t) => t.remove(false));
    this.timers = [];
  }
}

// ── hints ───────────────────────────────────────────────────────────────────

/**
 * Mote's escalating hints (plan.md §66).
 *
 * Three levels, each purely visual: look between the two things that matter,
 * then follow the one that moves, then show the goal state as a thought. The
 * clock resets whenever the room reports progress, so a player who is *doing*
 * things is never nagged — only a player who is genuinely stuck.
 *
 * Hints never speak. If a hint needs a sentence, the room is not built right.
 */
export class HintDirector {
  private idle = 0;
  private level = 0;

  constructor(
    private w: WorldScene,
    private steps: Array<() => void>,
    private firstAfter = 45_000,
    private gap = 45_000,
  ) {}

  /** Something happened that means the player is working it out. */
  progress(): void {
    this.idle = 0;
    this.level = 0;
  }

  /** Stop hinting entirely (the room is solved). */
  stop(): void {
    this.idle = -1e9;
    this.level = this.steps.length;
  }

  update(dt: number): void {
    if (this.w.cutscene.active || this.level >= this.steps.length + 1) return;
    this.idle += dt;
    const due = this.level === 0 ? this.firstAfter : this.firstAfter + this.level * this.gap;
    if (this.idle < due) return;
    const step = this.steps[Math.min(this.level, this.steps.length - 1)];
    this.level++;
    this.w.mote?.react('curious', 500);
    step();
  }
}

/** Mote looks from one thing to another and back — hint one, every time. */
export function lookBetween(w: WorldScene, a: { x: number; y: number }, b: { x: number; y: number }): void {
  w.mote?.pointAt(a.x, a.y, 1200);
  w.time.delayedCall(1250, () => w.mote?.pointAt(b.x, b.y, 1200));
  w.time.delayedCall(2500, () => w.mote?.pointAt(a.x, a.y, 1000));
}

/** Mote goes and sits on the thing that matters — hint two. */
export function goLookAt(w: WorldScene, p: { x: number; y: number }): void {
  w.mote?.pointAt(p.x, p.y, 3200);
  Audio.sfx('mote_chirp', { volume: 0.4 });
}

/** A thought bubble over the goal state — hint three. */
export function showGoal(w: WorldScene, p: { x: number; y: number }, emote = 'idea'): void {
  w.mote?.pointAt(p.x, p.y, 2600);
  w.fx.emote(p.x, p.y + 6, emote, 2200);
  Audio.sfx('mote_chirp', { volume: 0.5, rate: 1.2 });
}

// ── puzzle creatures ────────────────────────────────────────────────────────

/**
 * Hold a creature exactly where the puzzle wants it.
 *
 * Shrine creatures are heavy, dim and entirely uninterested in the player. They
 * are also `Enemy` instances, which means a player who swings at one will make
 * it aggro and try to charge. Pinning the position every frame — after
 * EnemyManager has run — is what makes "too heavy for you to move" literally
 * true, so hitting it produces a thud and nothing else.
 */
export function pinTo(e: Enemy, x: number, y: number): void {
  e.x = x;
  e.y = y;
}

/** Step a creature toward a point at a fixed speed, respecting walls. */
export function stepToward(
  e: { x: number; y: number; dir: 'n' | 's' | 'e' | 'w' },
  tx: number,
  ty: number,
  speed: number,
  dt: number,
  grid: boolean[][],
): boolean {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 3) return true;
  const step = Math.min(d, (speed * dt) / 1000);
  const nx = e.x + (dx / d) * step;
  const ny = e.y + (dy / d) * step;
  e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
  // An empty grid means "this thing does not collide" — a moth, for instance.
  if (!grid.length) { e.x = nx; e.y = ny; return false; }
  const gx = Math.floor(nx / TILE);
  const gy = Math.floor((ny - 1) / TILE);
  if (gy >= 0 && gy < grid.length && gx >= 0 && gx < grid[0].length && !grid[gy][gx]) {
    e.x = nx;
    e.y = ny;
  } else {
    // Slide along whichever axis is still clear, so a creature never wedges.
    const sx = Math.floor(nx / TILE), sy = Math.floor((e.y - 1) / TILE);
    if (sy >= 0 && sy < grid.length && sx >= 0 && sx < grid[0].length && !grid[sy][sx]) e.x = nx;
    const ux = Math.floor(e.x / TILE), uy = Math.floor((ny - 1) / TILE);
    if (uy >= 0 && uy < grid.length && ux >= 0 && ux < grid[0].length && !grid[uy][ux]) e.y = ny;
  }
  return false;
}

// ── room completion ─────────────────────────────────────────────────────────

/**
 * One room done. Always the same beat: the door works, the room says so, and
 * the flag that gates the next room goes up. The flags are the contract the
 * rest of the dungeon and the playtest harness read.
 */
export function completeRoom(w: WorldScene, n: number): void {
  const flag = `shrine_r${n}_done`;
  if (State.has(flag)) return;
  State.set(flag);
  Audio.sfx('quest_done', { volume: 0.55 });
  w.mote?.react('alert', 900);
  emit('puzzle:solved', { room: n });
}
