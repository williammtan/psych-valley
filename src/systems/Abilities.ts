/**
 * The three knowledge abilities.
 *
 * The design rule from the plan is that these are NOT spells — each one is the
 * player's understanding of a system, expressed as an interaction that only
 * becomes available once they have understood it. So none of them has its own
 * button: they extend what the normal interact button can do, and the HUD
 * simply shows which ones you have.
 *
 *   LINK    you know creatures act on learned cues, so you can bait one
 *   RECALL  you know similar memories interfere, so you can read context
 *   DISSENT you know unanimity is what holds a group, so you can break it
 *
 * Each is implemented as a small component an area script attaches to entities.
 */
import Phaser from 'phaser';
import { DEPTH, TILE } from '@/core/config';
import { emit } from '@/core/events';
import { State } from '@/core/state';
import { hasFrame } from '@/core/textures';
import { Audio } from '@/audio/Audio';
import type { WorldScene } from '@/scenes/WorldScene';
import type { Enemy } from '@/entities/Enemy';

// ─────────────────────────────────────────────────────────────────────────────
// LINK — learned associations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A cue the world can emit: a ringing bell, a released moth, a struck lantern.
 * Creatures that have *learned* this cue respond to it.
 */
export interface Cue {
  kind: string;
  x: number;
  y: number;
  /** How far the cue carries, in pixels. */
  range: number;
  /** Wall-clock ms the cue stays active. */
  until: number;
}

export class CueBus {
  private cues: Cue[] = [];

  constructor(private scene: WorldScene) {}

  /** Emit a cue at a world position. */
  emitCue(kind: string, x: number, y: number, range = 140, duration = 2600): void {
    this.cues.push({ kind, x, y, range, until: this.scene.time.now + duration });
    emit('cue', { kind, x, y });
  }

  /** The strongest active cue of a kind that reaches this point, or null. */
  strongest(kind: string, x: number, y: number): Cue | null {
    const now = this.scene.time.now;
    let best: Cue | null = null;
    let bestD = Infinity;
    for (const c of this.cues) {
      if (c.kind !== kind || c.until < now) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d > c.range || d >= bestD) continue;
      bestD = d;
      best = c;
    }
    return best;
  }

  update(): void {
    const now = this.scene.time.now;
    if (this.cues.length && this.cues.some((c) => c.until < now)) {
      this.cues = this.cues.filter((c) => c.until >= now);
    }
  }

  clear(): void { this.cues = []; }
}

/**
 * A carryable object that emits a cue when used — the hand bell in the inn, the
 * moth jar in the shrine. The player picks it up, carries it, and releases it.
 */
export class Lure {
  sprite: Phaser.GameObjects.Sprite;
  held = false;
  released = false;
  x: number;
  y: number;
  private vx = 0;
  private vy = 0;

  constructor(
    private scene: WorldScene,
    public readonly cueKind: string,
    tx: number,
    ty: number,
    private art: { idle: string; anim?: string } = { idle: 'prop/shrine/moth_0', anim: 'shrine_moth' },
  ) {
    this.x = tx * TILE + TILE / 2;
    this.y = ty * TILE + TILE;
    const frame = hasFrame(scene, art.idle) ? art.idle : 'ui/fade_pixel';
    this.sprite = scene.add.sprite(this.x, this.y, 'atlas', frame)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + this.y);
    if (art.anim && scene.anims.exists(art.anim)) this.sprite.play(art.anim);
  }

  pickUp(): void {
    this.held = true;
    this.released = false;
    Audio.sfx('pickup', { volume: 0.5 });
  }

  /** Drop the lure at a world position; it begins emitting its cue. */
  release(x: number, y: number): void {
    this.held = false;
    this.released = true;
    this.x = x;
    this.y = y;
    Audio.sfx(this.cueKind === 'bell' ? 'bell_small' : 'pickup', { volume: 0.6 });
    emit('lure:released', { kind: this.cueKind, x, y });
  }

  update(dt: number, cues: CueBus): void {
    if (this.held) {
      const p = this.scene.player;
      // Carried just above and behind the player's shoulder.
      const tx = p.x + (p.dir === 'e' ? 8 : p.dir === 'w' ? -8 : 0);
      const ty = p.y - 16;
      this.x += (tx - this.x) * Math.min(1, dt / 90);
      this.y += (ty - this.y) * Math.min(1, dt / 90);
    } else if (this.released) {
      // Once released, it drifts gently and keeps calling.
      this.vx += (Math.random() - 0.5) * 6;
      this.vy += (Math.random() - 0.5) * 6;
      this.vx *= 0.92;
      this.vy *= 0.92;
      this.x += this.vx * (dt / 1000);
      this.y += this.vy * (dt / 1000);
      cues.emitCue(this.cueKind, this.x, this.y, 150, 400);
    }
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y + (this.held ? 30 : 0));
  }

  destroy(): void { this.sprite.destroy(); }
}

/**
 * Attaches to an enemy: it walks toward any active cue of the kind it has
 * learned, ignoring the player entirely while it does.
 *
 * This is the transfer of the Pip lesson into a spatial puzzle — the creature's
 * behaviour makes sense only if you understand that it learned an association.
 */
export class CueFollower {
  private target: { x: number; y: number } | null = null;

  constructor(
    public readonly enemy: Enemy,
    public readonly learnedCue: string,
    private speed = 26,
  ) {}

  update(dt: number, cues: CueBus, grid: boolean[][]): boolean {
    const cue = cues.strongest(this.learnedCue, this.enemy.x, this.enemy.y);
    if (cue) this.target = { x: cue.x, y: cue.y };
    if (!this.target) return false;
    const dx = this.target.x - this.enemy.x;
    const dy = this.target.y - this.enemy.y;
    const d = Math.hypot(dx, dy);
    if (d < 5) return true;
    const step = (this.speed * dt) / 1000;
    // Deliberately simple movement: these creatures are dumb, which is the point.
    // But "dumb" must not mean "wedges against a pillar forever" — if the direct
    // line is blocked, slide along whichever single axis is still free. That is
    // enough to round an obstacle without turning this into pathfinding.
    const free = (px: number, py: number) => {
      const tx = Math.floor(px / TILE);
      const ty = Math.floor((py - 1) / TILE);
      return ty >= 0 && ty < grid.length && tx >= 0 && tx < grid[0].length && !grid[ty][tx];
    };
    const mx = (dx / d) * step;
    const my = (dy / d) * step;
    if (free(this.enemy.x + mx, this.enemy.y + my)) {
      this.enemy.x += mx;
      this.enemy.y += my;
    } else if (free(this.enemy.x + mx, this.enemy.y)) {
      this.enemy.x += mx;
    } else if (free(this.enemy.x, this.enemy.y + my)) {
      this.enemy.y += my;
    }
    this.enemy.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECALL — reading context to separate interfering memories
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Something in the world that carries *contextual* evidence about which of two
 * overlapping sequences belongs to it: a damp floor, a scorched wall, dust that
 * has not been disturbed.
 *
 * Recall never gives the answer. It surfaces the cue that distinguishes the two
 * situations, and the player has to notice which situation it belongs to.
 */
export interface ContextClue {
  id: string;
  x: number;
  y: number;
  /** Which context this evidence belongs to, e.g. 'yesterday' / 'wet_side'. */
  context: string;
  /** One short line shown when the player reads it. */
  text: string;
  found?: boolean;
}

export class RecallSystem {
  clues: ContextClue[] = [];
  private marks: Phaser.GameObjects.Sprite[] = [];

  constructor(private scene: WorldScene) {}

  add(clue: ContextClue): void {
    this.clues.push(clue);
    this.scene.addInteractable({
      id: `clue:${clue.id}`,
      x: clue.x,
      y: clue.y,
      label: 'Examine',
      observable: true,
      onInteract: () => this.read(clue),
    });
  }

  read(clue: ContextClue): void {
    const first = !clue.found;
    clue.found = true;
    if (first) {
      State.bump('clues_found');
      Audio.sfx('recall', { volume: 0.5 });
      this.scene.fx.burst(clue.x, clue.y, 'fx/recall_shimmer');
    }
    emit('clue:read', { id: clue.id, context: clue.context, text: clue.text, first });
  }

  get foundCount(): number { return this.clues.filter((c) => c.found).length; }

  /** Contexts the player has actually gathered evidence for. */
  knownContexts(): string[] {
    return [...new Set(this.clues.filter((c) => c.found).map((c) => c.context))];
  }

  clear(): void {
    this.clues = [];
    this.marks.forEach((m) => m.destroy());
    this.marks = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISSENT — breaking a group's unanimity
// ─────────────────────────────────────────────────────────────────────────────

export interface ConformerLike {
  id: string;
  x: number;
  y: number;
  facing: 'n' | 's' | 'e' | 'w';
  dissenting: boolean;
  setFacing(dir: 'n' | 's' | 'e' | 'w', copied: boolean): void;
  setDissenting(v: boolean): void;
}

/**
 * A group that copies its leader.
 *
 * While every member is copying, changing one member is impossible — the group
 * snaps it back. Isolate one so it stops copying, and the rest become
 * individually manipulable. That is the conformity lesson as a spatial rule:
 * unanimity is doing the work, not the leader.
 */
export class ConformityGroup {
  members: ConformerLike[] = [];
  leader: ConformerLike | null = null;
  /** True once at least one member has been made to dissent. */
  get broken(): boolean { return this.members.some((m) => m.dissenting); }

  constructor(private scene: WorldScene) {}

  add(m: ConformerLike, isLeader = false): void {
    this.members.push(m);
    if (isLeader) this.leader = m;
  }

  /** Point the leader somewhere; everyone still conforming follows. */
  setLeaderFacing(dir: 'n' | 's' | 'e' | 'w'): void {
    if (!this.leader) return;
    this.leader.setFacing(dir, false);
    for (const m of this.members) {
      if (m === this.leader || m.dissenting) continue;
      m.setFacing(dir, true);
    }
    Audio.sfx('switch', { volume: 0.4 });
    emit('conformity:sync', { dir, broken: this.broken });
  }

  /**
   * Try to turn one member independently.
   *
   * While the group is unanimous this fails visibly — the member turns and is
   * pulled straight back. That failure IS the teaching moment; do not remove it.
   */
  turnMember(m: ConformerLike, dir: 'n' | 's' | 'e' | 'w'): boolean {
    if (m.dissenting) {
      m.setFacing(dir, false);
      Audio.sfx('switch', { volume: 0.45 });
      emit('conformity:turned', { id: m.id, dir });
      return true;
    }
    m.setFacing(dir, false);
    this.scene.time.delayedCall(320, () => {
      if (m.dissenting) return;
      const back = this.leader?.facing ?? 's';
      m.setFacing(back, true);
      this.scene.fx.emote(m.x, m.y, 'sweat', 700);
      Audio.sfx('ui_cancel', { volume: 0.35 });
      emit('conformity:snapback', { id: m.id });
    });
    return false;
  }

  /** Make one member stop copying. Requires the DISSENT understanding. */
  makeDissent(m: ConformerLike): boolean {
    if (!State.hasAbility('dissent')) return false;
    if (m.dissenting) return false;
    m.setDissenting(true);
    Audio.sfx('dissent', { volume: 0.65 });
    this.scene.fx.burst(m.x, m.y - 16, 'fx/dissent_break');
    this.scene.shake(0.004, 200);
    emit('conformity:dissent', { id: m.id });
    return true;
  }

  clear(): void {
    this.members = [];
    this.leader = null;
  }
}
