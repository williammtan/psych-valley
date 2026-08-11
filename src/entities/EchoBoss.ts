/**
 * THE ECHO — the vertical slice's final boss.
 *
 * plan.md §44 is explicit that this must not be a monster with a lot of health,
 * and §37 is explicit that the dungeon introduces no new ideas: it only asks
 * whether the player can use what they already learned. So the Echo is three
 * short systemic phases, each of which is one of the game's three lessons put
 * into a situation the player has not seen before. Nothing is ever restated in
 * dialogue, and nothing here is a quiz.
 *
 *   PHASE ONE — CONDITIONING (§45)
 *     It watches how you attack and starts predicting it. Two attacks with the
 *     same approach and it has learned you: it turns to guard that side and
 *     hangs an afterimage of your own last swing in the air where it expects the
 *     next one. Attack into that and you bounce off. Attack from anywhere else
 *     and its guard is in the wrong place — triple damage and a stagger.
 *
 *     A player who repeats one approach can still win; they just spend most of
 *     the phase being blocked. A player who understands "it learns, so change"
 *     kills it in about a fifth of the swings. That gap is the whole thesis.
 *
 *   PHASE TWO — INTERFERENCE (§46)
 *     Attack markers cover the floor. Some are echoes of attacks that already
 *     happened and are harmless; some are real. The thing that separates them is
 *     not on the marker, it is in the room: the Echo relights the brazier of the
 *     quadrant it just swept through, and the runes under that quadrant wake up.
 *     Everything standing in that light is real. Everything in the dark is a
 *     memory of a previous pattern.
 *
 *     Read one wave correctly and the Echo over-commits and staggers — that is
 *     the only window in which it can be hurt. Read it wrong and you lose one
 *     heart and it simply goes again, harder.
 *
 *   PHASE THREE — CONFORMITY (§47)
 *     Six smaller Echoes ring it and copy it exactly: same facing, same beat,
 *     same flash. While they are unanimous the boss is shielded and the group
 *     mirrors each other's defence, so hitting any of them does nothing but make
 *     the group visibly drag the struck one back into line.
 *
 *     One of them is already not quite with the others — it flashes late and it
 *     faces slightly wrong. Break that one and unanimity is gone: the formation
 *     scatters, the shield shatters, and the boss is open. This is Nia, as a
 *     spatial rule.
 *
 * The class owns every moving part of the fight, including the braziers'
 * controllable light and the rune plates it wakes, because those are gameplay
 * signals rather than dressing and they must not drift out of sync with the
 * attack they are advertising.
 */
import Phaser from 'phaser';
import { COLORS, DEPTH } from '@/core/config';
import { emit } from '@/core/events';
import { hasFrame } from '@/core/textures';
import { Audio } from '@/audio/Audio';
import { ConformityGroup, type ConformerLike } from '@/systems/Abilities';
import type { WorldScene } from '@/scenes/WorldScene';
import type { Dir, Player } from '@/entities/Player';

// ── tuning ──────────────────────────────────────────────────────────────────
// Every number that decides whether the fight is fair lives here, in one block,
// because the difference between "readable" and "unfair" in this encounter is
// entirely a question of how long the player gets to look at things.

const HP = { 1: 12, 2: 6, 3: 8 } as const;

const P1 = {
  /** Identical approaches needed before it commits to a prediction. */
  LEARN_AT: 2,
  /** How long a prediction stays armed with no new information. */
  GUARD_MS: 7000,
  /** Free damage for hitting a guard that is in the wrong place. */
  PUNISH_DAMAGE: 3,
  PUNISH_STAGGER_MS: 1300,
  /**
   * A block is not just "no damage" — it counters. The Echo swipes the ground
   * it was already guarding, telegraphed, so backing off after being read is
   * free and walking straight back into the same approach is not.
   */
  COUNTER_FUSE_MS: 420,
  /** After it blocks, it has to re-learn from scratch — and it is open. */
  RECOVER_MS: 1250,
  /** Dash in, do not swing: it commits its counter to empty air. */
  FEINT_WINDOW_MS: 750,
  FEINT_STAGGER_MS: 900,
  SLAM_EVERY_MS: 3600,
};

const P2 = {
  /** Marks appear this long before they go off. A comprehension test, not a
   *  reflex test — plan.md §46. */
  READ_MS: 2000,
  /** The brazier flares first, so the cue always precedes the question. */
  FLARE_LEAD_MS: 620,
  /** Two, then four, then six (§46). */
  RAMP: [2, 4, 6],
  /** Reward for a clean read: the only real window it can be hurt in. */
  STAGGER_MS: 2300,
  /**
   * Every wave leaves a much shorter opening whether or not it was read.
   *
   * Without this, a player who never works out the braziers can never damage
   * the Echo at all and the fight is a wall rather than a slow grind — and
   * plan.md §67 is explicit that failure has to stay cheap. One hit here versus
   * four in a read window keeps the difference enormous without being absolute.
   */
  PITY_MS: 700,
  GAP_MS: 900,
  /** Live marks sit within this of a burning brazier... */
  LIVE_RADIUS: 54,
  /** ...and stale ones are never closer than this to one. */
  STALE_CLEARANCE: 92,
  /**
   * How far from every burning brazier the player has to BE when the wave goes
   * off for it to count as read.
   *
   * Surviving a wave is not the same as understanding it: a player standing in
   * the lit quadrant who happens not to be under a mark got lucky, and rewarding
   * that would make the phase a dice roll instead of a comprehension test. The
   * threshold is LIVE_RADIUS plus a mark's own half-width, i.e. "outside the
   * field of fire entirely", which is exactly the rule the braziers advertise.
   */
  SAFE_CLEARANCE: 78,
};

const P3 = {
  BEAT_MS: 1300,
  /** How late the odd one out is. Visible, but you have to be looking. */
  LATE_MS: 420,
  FOLLOWERS: 6,
  ORBIT: 46,
  /** Free hits once unanimity is gone. */
  BREAK_STAGGER_MS: 3000,
  /** Grinding one conformist eventually works too — slowly. See notes below. */
  SNAPBACKS_TO_BREAK: 5,
  /** If nobody has worked it out, the odd one drifts further out of line. */
  DESPERATION_MS: 26000,
  SLAM_EVERY_MS: 4200,
};

/** No progress for this long in a phase and the area script offers a nudge. */
const STUCK_MS = 38000;

type Side = 'n' | 's' | 'e' | 'w';
const SIDE_VEC: Record<Side, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export type Phase = 1 | 2 | 3;
export type Stage = 'dormant' | 'fighting' | 'dying' | 'done';

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

export interface EchoBossOpts {
  arena: Bounds;
  home: { x: number; y: number };
  grate: { x: number; y: number };
  braziers: ReadonlyArray<{ x: number; y: number; flame: { x: number; y: number } }>;
  /** Tiles of the inscribed ring, so a flare can wake the arc nearest it. */
  runeTiles: ReadonlyArray<readonly [number, number]>;
  onPhase?(p: Phase): void;
  onDefeated?(): void;
  /** Fired once per phase if the player has made no progress for a long time. */
  onStuck?(p: Phase): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attack markers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One attack marker on the floor.
 *
 * Phase one uses a single live marker for the Echo's slam, which is deliberate:
 * by the time phase two puts six of them on the floor and asks which are real,
 * the player has already been taught what a live one looks like when it goes
 * off. The lesson is never stated, it is just used earlier.
 */
class Indicator {
  sprite: Phaser.GameObjects.Sprite;
  struck = false;
  dead = false;

  constructor(
    private scene: WorldScene,
    public x: number,
    public y: number,
    public readonly live: boolean,
    public strikeAt: number,
    private scale = 1,
  ) {
    const base = live ? 'enemy/echo/indicator_live_0' : 'enemy/echo/indicator_stale_0';
    const frame = hasFrame(scene, base) ? base : 'ui/fade_pixel';
    this.sprite = scene.add.sprite(Math.round(x), Math.round(y), 'atlas', frame)
      .setOrigin(0.5, 0.5)
      // Floor decals: above the tiles, below every entity, so you can always see
      // your own feet standing on one.
      .setDepth(DEPTH.SCATTER + 6)
      .setScale(scale * 0.5)
      .setAlpha(0);
    const anim = live ? 'echo_indicator_live' : 'echo_indicator_stale';
    if (scene.anims.exists(anim)) this.sprite.play(anim);
    // Stale marks must be clearly *visible* and clearly *not charged*: the
    // player's job is to see them and decide they do not matter, which they
    // cannot do if the dark floor hides them.
    scene.tweens.add({
      targets: this.sprite,
      scale, alpha: live ? 1 : 0.88,
      duration: 220, ease: 'Back.easeOut',
    });
  }

  /** Half-extents of the damage footprint. */
  get halfW(): number { return 19 * this.scale; }
  get halfH(): number { return 13 * this.scale; }

  covers(px: number, py: number): boolean {
    return Math.abs(px - this.x) < this.halfW && Math.abs(py - this.y) < this.halfH;
  }

  /** Returns true on the frame it goes off. */
  update(now: number): boolean {
    if (this.dead || this.struck) return false;
    if (now < this.strikeAt) {
      // Live marks tighten as the strike approaches; stale ones just drift.
      const t = 1 - (this.strikeAt - now) / 900;
      if (this.live && t > 0) this.sprite.setScale(this.scale * (1 + Math.sin(t * Math.PI * 6) * 0.05));
      return false;
    }
    this.struck = true;
    return true;
  }

  /** Fizzle out — used by stale marks, which never do anything at all. */
  fade(): void {
    if (this.dead) return;
    this.dead = true;
    this.scene.tweens.add({
      targets: this.sprite, alpha: 0, scale: this.scale * 0.8, duration: 260,
      onComplete: () => this.sprite.destroy(),
    });
  }

  destroy(): void {
    this.dead = true;
    this.sprite.destroy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Braziers — the world cue phase two is read from
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A brazier the fight can light.
 *
 * The map places the bowls (they are architecture); this wraps one so the
 * encounter can turn it on. Cold is a hard tint and no flame animation; lit is
 * full colour, the flame cycle, and a large warm light. The difference has to
 * survive being glanced at, because it is the answer to phase two's question.
 */
class Brazier {
  private light: ReturnType<WorldScene['lighting']['addPixel']>;
  lit = false;

  /** Embers: enough to say "this is a brazier and it could be lit". */
  private static readonly COLD_ALPHA = 0.22;
  private static readonly HOT_ALPHA = 1;
  private static readonly COLD_TINT = 0x4a4a72;

  constructor(
    private scene: WorldScene,
    public readonly x: number,
    public readonly y: number,
    flame: { x: number; y: number },
    private sprite?: Phaser.GameObjects.Sprite,
  ) {
    this.light = scene.lighting.addPixel(flame.x, flame.y, 88, COLORS.amber, Brazier.COLD_ALPHA, 0.5);
    this.light.intensity = Brazier.COLD_ALPHA;
    this.sprite?.setTint(Brazier.COLD_TINT);
  }

  setLit(on: boolean, ms = 260): void {
    if (this.lit === on) return;
    this.lit = on;
    if (on) {
      this.sprite?.clearTint();
      if (this.sprite && this.scene.anims.exists('shrine_brazier')) this.sprite.play('shrine_brazier');
      Audio.sfx('rune_activate', { volume: 0.5, rate: 1.2 });
      this.scene.fx.burst(this.x, this.y - 22, 'fx/rune_activate');
      this.scene.tweens.add({ targets: this.sprite, scaleX: 1.12, scaleY: 1.12, duration: 160, yoyo: true });
    } else {
      this.sprite?.setTint(Brazier.COLD_TINT);
      this.sprite?.stop();
    }
    // `intensity` is what Lighting's flicker maths modulates around, so it has
    // to move with the alpha or a cold brazier flickers back up to full.
    this.light.intensity = on ? Brazier.HOT_ALPHA : Brazier.COLD_ALPHA;
    this.scene.tweens.add({
      targets: this.light.img,
      alpha: this.light.intensity,
      duration: ms,
      ease: on ? 'Quad.easeOut' : 'Quad.easeIn',
    });
  }

  destroy(): void {
    this.light.img.destroy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Followers — phase three
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A smaller Echo that copies the central one.
 *
 * It implements ConformerLike so the shared ConformityGroup from
 * systems/Abilities owns the actual social rule — including the snap-back that
 * happens when you try to turn one member of a unanimous group, which the
 * shrine's conformity room already taught the player to expect.
 */
class Follower implements ConformerLike {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  facing: Dir = 's';
  dissenting = false;
  /** The one that is already almost disagreeing. */
  odd = false;
  /** How many times the group has had to drag this one back into line. */
  snapbacks = 0;
  dead = false;
  angle: number;
  /** Set while it is running its own errand instead of the group's. */
  private pulseAt = 0;
  private vx = 0;
  private vy = 0;

  constructor(
    private scene: WorldScene,
    public readonly id: string,
    angle: number,
    public x: number,
    public y: number,
  ) {
    this.angle = angle;
    this.shadow = scene.add.image(x, y - 1, 'atlas', 'fx/shadow_small')
      .setOrigin(0.5, 0.5).setAlpha(0.3).setDepth(DEPTH.SHADOW);
    this.sprite = scene.add.sprite(x, y, 'atlas', 'enemy/echomote/idle_0')
      .setOrigin(0.5, 1).setDepth(DEPTH.ENTITY_BASE + y);
    if (scene.anims.exists('echomote_idle')) this.sprite.play('echomote_idle');
    this.sprite.setScale(0.4).setAlpha(0);
    scene.tweens.add({ targets: this.sprite, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
  }

  setFacing(dir: Dir, _copied: boolean): void {
    this.facing = dir;
    this.sprite.setFlipX(dir === 'w');
    const key = `echomote_walk_${dir === 'w' ? 'e' : dir}`;
    if (!this.dissenting && this.scene.anims.exists(key)) this.sprite.play(key, true);
  }

  setDissenting(v: boolean): void {
    this.dissenting = v;
    if (!v) return;
    if (this.scene.anims.exists('echomote_dissent')) this.sprite.play('echomote_dissent');
    // It stops holding formation and drifts off on its own line.
    const a = Math.random() * Math.PI * 2;
    this.vx = Math.cos(a) * 42;
    this.vy = Math.sin(a) * 42;
  }

  /** The unison flash. The whole phase is legible because of this one beat. */
  pulse(now: number): void {
    this.pulseAt = now;
    if (this.scene.anims.exists('echomote_sync_pulse')) this.sprite.play('echomote_sync_pulse');
    this.scene.tweens.add({
      targets: this.sprite, alpha: 1, duration: 90, yoyo: true,
      onStart: () => this.sprite.setAlpha(1),
    });
  }

  /** Dim between beats so the unison flash is the loudest thing on screen. */
  update(dt: number, now: number): void {
    if (this.dissenting) {
      this.x += this.vx * (dt / 1000);
      this.y += this.vy * (dt / 1000);
      this.vx *= 0.965;
      this.vy *= 0.965;
    }
    const since = now - this.pulseAt;
    const bright = since < 260 ? 1 : 0.62;
    this.sprite.setAlpha(this.dead ? this.sprite.alpha : bright);
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) - 1);
  }

  touches(px: number, py: number): boolean {
    return Math.abs(px - this.x) < 13 && Math.abs(py - (this.y - 9)) < 13;
  }

  overlapsRect(r: { x: number; y: number; w: number; h: number }): boolean {
    const ex = this.x - 9;
    const ey = this.y - 18;
    return ex < r.x + r.w && ex + 18 > r.x && ey < r.y + r.h && ey + 18 > r.y;
  }

  dissolve(): void {
    if (this.dead) return;
    this.dead = true;
    this.shadow.destroy();
    if (this.scene.anims.exists('echomote_die')) this.sprite.play('echomote_die');
    this.scene.tweens.add({
      targets: this.sprite, alpha: 0, y: this.sprite.y - 8, duration: 460,
      onComplete: () => this.sprite.destroy(),
    });
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The Echo
// ─────────────────────────────────────────────────────────────────────────────

export class EchoBoss {
  x: number;
  y: number;
  phase: Phase = 1;
  stage: Stage = 'dormant';
  hp: number = HP[1];
  /** Read by the debug/QA hook; see areas/shrine_boss.ts. */
  readonly log: Array<{ phase: Phase; at: number }> = [];

  sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Image;
  private braziers: Brazier[] = [];
  private indicators: Indicator[] = [];
  private lastAnim = '';
  private invulnUntil = 0;
  private staggerUntil = 0;
  private lastSwingAt = -9999;
  private nextSlamAt = 0;
  private phaseStartedAt = 0;
  private lastProgressAt = 0;
  private stuckFired = false;
  private drift = Math.random() * Math.PI * 2;

  // phase one
  private history: string[] = [];
  private predicted: string | null = null;
  private guardUntil = 0;
  private recoverUntil = 0;
  private ghost?: Phaser.GameObjects.Sprite;
  private lastDashAt = -9999;
  private dashWasIn = false;
  private attackedSinceDash = true;

  // phase two
  private wave = -1;
  private waveState: 'idle' | 'flare' | 'read' | 'settle' = 'idle';
  private waveAt = 0;
  private waveClean = true;
  private litRunes: Array<[number, number]> = [];

  // phase three
  private group?: ConformityGroup;
  private followers: Follower[] = [];
  private nextBeatAt = 0;
  private beat = 0;
  private shield?: Phaser.GameObjects.Graphics;
  private unanimousSince = 0;
  private cycle = 0;

  constructor(private scene: WorldScene, private opts: EchoBossOpts) {
    this.x = opts.home.x;
    this.y = opts.home.y;
    this.shadow = scene.add.image(this.x, this.y - 1, 'atlas', 'fx/shadow_large')
      .setOrigin(0.5, 0.5).setAlpha(0.34).setDepth(DEPTH.SHADOW).setVisible(false);
    this.sprite = scene.add.sprite(this.x, this.y, 'atlas', 'enemy/echo/idle_0')
      .setOrigin(0.5, 1).setDepth(DEPTH.ENTITY_BASE + this.y).setVisible(false);

    for (const b of opts.braziers) {
      const prop = scene.world.props.find((p) => Math.abs(p.sprite.x - b.x) < 2 && Math.abs(p.sprite.y - b.y) < 2);
      this.braziers.push(new Brazier(scene, b.x, b.y, b.flame, prop?.sprite));
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /** The seal cracks and it comes up out of the drain. */
  wake(): void {
    if (this.stage !== 'dormant') return;
    this.sprite.setVisible(true).setAlpha(0).setScale(0.4, 0.15);
    this.shadow.setVisible(true).setAlpha(0);
    this.play('echo_idle');
    Audio.sfx('echo_roar', { volume: 0.7 });
    this.scene.fx.burst(this.opts.grate.x, this.opts.grate.y - 8, 'fx/echo_burst');
    this.scene.shake(0.006, 700);
    this.x = this.opts.grate.x;
    this.y = this.opts.grate.y;
    this.scene.tweens.add({
      targets: this.sprite, alpha: 1, scaleX: 1, scaleY: 1, duration: 900, ease: 'Back.easeOut',
    });
    this.scene.tweens.add({ targets: this.shadow, alpha: 0.34, duration: 900 });
    this.scene.tweens.add({
      targets: this, x: this.opts.home.x, y: this.opts.home.y, duration: 1100, ease: 'Sine.easeInOut',
    });
  }

  /** Begin (or restart) a phase. Used by both progression and respawn. */
  beginPhase(p: Phase): void {
    this.clearPhase();
    this.phase = p;
    this.hp = HP[p];
    this.stage = 'fighting';
    this.sprite.setVisible(true).setAlpha(1).setScale(1);
    this.shadow.setVisible(true);
    this.x = this.opts.home.x;
    this.y = this.opts.home.y;
    const now = this.scene.time.now;
    this.phaseStartedAt = now;
    this.lastProgressAt = now;
    this.stuckFired = false;
    this.staggerUntil = 0;
    this.invulnUntil = now + 400;
    this.nextSlamAt = now + 2400;
    this.log.push({ phase: p, at: now });

    if (p === 1) {
      this.play('echo_idle');
    } else if (p === 2) {
      this.wave = -1;
      this.waveState = 'idle';
      this.waveAt = now + 700;
      this.play('echo_phase2_split');
    } else {
      this.spawnRing();
      this.play('echo_phase3_lead');
      this.nextBeatAt = now + 700;
      this.unanimousSince = now;
    }
    emit('boss:phase', { phase: p });
    this.opts.onPhase?.(p);
  }

  private clearPhase(): void {
    this.indicators.forEach((i) => i.destroy());
    this.indicators = [];
    this.braziers.forEach((b) => b.setLit(false, 120));
    this.dimRunes();
    this.clearGhost();
    this.history = [];
    this.predicted = null;
    this.guardUntil = 0;
    this.recoverUntil = 0;
    this.followers.forEach((f) => f.destroy());
    this.followers = [];
    this.group?.clear();
    this.group = undefined;
    this.shield?.destroy();
    this.shield = undefined;
    this.cycle = 0;
  }

  destroy(): void {
    this.clearPhase();
    this.braziers.forEach((b) => b.destroy());
    this.braziers = [];
    this.sprite.destroy();
    this.shadow.destroy();
  }

  // ── frame ─────────────────────────────────────────────────────────────────

  update(dt: number, player: Player): void {
    const now = this.scene.time.now;
    if (this.stage === 'dormant' || this.stage === 'done') return;

    if (this.stage === 'dying') {
      this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
      this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y);
      return;
    }

    this.drift += dt / 1000;

    switch (this.phase) {
      case 1: this.updatePhase1(dt, now, player); break;
      case 2: this.updatePhase2(dt, now, player); break;
      case 3: this.updatePhase3(dt, now, player); break;
    }

    this.updateIndicators(now, player);
    this.resolveWeapon(now, player);

    // Hint escalation (plan.md §66): only ever fires for a player who is stuck,
    // and only once per phase. It is never an explanation of the mechanic.
    if (!this.stuckFired && now - this.lastProgressAt > STUCK_MS) {
      this.stuckFired = true;
      this.opts.onStuck?.(this.phase);
    }

    this.clampToArena();
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y + Math.sin(this.drift * 1.6) * 1.6));
    this.sprite.setDepth(DEPTH.ENTITY_BASE + this.y);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) - 1);
    this.sprite.setAlpha(now < this.invulnUntil && Math.floor(now / 60) % 2 === 0 ? 0.55 : 1);
    this.ghost?.setAlpha(0.4 + Math.sin(this.drift * 5) * 0.14);
  }

  private clampToArena(): void {
    const a = this.opts.arena;
    // The Echo keeps to the north half so the player always has somewhere to be.
    this.x = Phaser.Math.Clamp(this.x, a.x0 + 26, a.x1 - 26);
    this.y = Phaser.Math.Clamp(this.y, a.y0 + 8, a.y1 - 46);
  }

  private play(key: string, force = false): void {
    if (!force && this.lastAnim === key) return;
    if (!this.scene.anims.exists(key)) return;
    this.lastAnim = key;
    this.sprite.play(key, true);
  }

  /** The Echo's own hit rectangle, in world pixels. */
  private get body(): { x: number; y: number; w: number; h: number } {
    return { x: this.x - 22, y: this.y - 58, w: 44, h: 54 };
  }

  get staggered(): boolean { return this.scene.time.now < this.staggerUntil; }

  get shielded(): boolean {
    return this.phase === 3 && !!this.group && !this.group.broken && !this.staggered;
  }

  // ── the player's sword ────────────────────────────────────────────────────

  /**
   * One resolution point for every swing, so "did that hit, and what did it
   * mean" is decided in exactly one place per phase.
   */
  private resolveWeapon(now: number, player: Player): void {
    const hb = player.hitbox;
    if (!hb.active || now < this.lastSwingAt + 280) return;

    // Phase three: followers are hit before the boss, because the answer to the
    // phase is a follower and the player should never feel their aim was eaten.
    if (this.phase === 3) {
      for (const f of this.followers) {
        if (f.dead || !f.overlapsRect(hb)) continue;
        this.lastSwingAt = now;
        this.hitFollower(f, now, player);
        return;
      }
    }

    const b = this.body;
    if (!(hb.x < b.x + b.w && hb.x + hb.w > b.x && hb.y < b.y + b.h && hb.y + hb.h > b.y)) return;
    this.lastSwingAt = now;

    if (now < this.invulnUntil) return;
    if (this.phase === 1) this.resolveP1Swing(now, player);
    else if (this.phase === 2) this.resolveP2Swing(now, player);
    else this.resolveP3Swing(now, player);
  }

  /** Damage, phase transition, death. Always goes through here. */
  private wound(amount: number, fromX: number, fromY: number, big = false): void {
    const now = this.scene.time.now;
    this.hp -= amount;
    this.lastProgressAt = now;
    this.invulnUntil = now + (big ? 260 : 190);
    this.scene.fx.impact(this.x, this.y - 34, big);
    this.scene.shake(big ? 0.007 : 0.0035, big ? 160 : 90);
    this.scene.setTimeScale(big ? 0.2 : 0.3, big ? 90 : 45);
    Audio.sfx(big ? 'crit' : 'echo_hit', { volume: big ? 0.7 : 0.5 });
    emit('boss:hurt', { phase: this.phase, hp: this.hp, amount });
    if (this.hp > 0) return;
    if (this.phase < 3) this.advancePhase();
    else this.die();
  }

  private advancePhase(): void {
    const next = (this.phase + 1) as Phase;
    this.clearPhase();
    this.invulnUntil = this.scene.time.now + 1400;
    this.staggerUntil = 0;
    this.play('echo_stagger', true);
    Audio.sfx('echo_roar', { volume: 0.75 });
    Audio.sfx('echo_phase', { volume: 0.6 });
    this.scene.shake(0.009, 620);
    this.scene.flash(0x8ce6e6, 180);
    this.scene.fx.burst(this.x, this.y - 30, 'fx/echo_burst');
    this.scene.time.delayedCall(1100, () => {
      if (this.stage === 'fighting' || this.stage === 'dormant') this.beginPhase(next);
    });
  }

  // ── PHASE ONE — conditioning ──────────────────────────────────────────────

  private updatePhase1(dt: number, now: number, player: Player): void {
    const staggered = this.staggered;
    if (staggered) {
      this.play('echo_stagger');
    } else if (now < this.recoverUntil) {
      this.play('echo_hurt');
    } else if (this.predicted) {
      this.play('echo_phase1_learn');
    } else {
      this.play('echo_idle');
    }

    // Prediction ages out if the player simply stops attacking.
    if (this.predicted && now > this.guardUntil) this.forget();

    // A dash toward it with no swing behind it: it commits to a counter that
    // has nothing to counter, and is wide open. Feinting is a real answer.
    if (this.predicted && !this.attackedSinceDash && this.dashWasIn
      && now - this.lastDashAt > P1.FEINT_WINDOW_MS) {
      this.attackedSinceDash = true;
      this.play('echo_phase1_counter', true);
      Audio.sfx('block', { volume: 0.4, rate: 0.85 });
      this.scene.fx.burst(this.x, this.y - 30, 'fx/echo_burst');
      this.forget();
      this.staggerUntil = now + P1.FEINT_STAGGER_MS;
      this.lastProgressAt = now;
    }

    if (staggered) return;

    // It closes slowly and never corners you: the phase is about reading, and
    // a boss that chases hard turns a reading problem into a running problem.
    const dx = player.x - this.x;
    const dy = (player.y - 22) - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const want = this.predicted ? 52 : 62;
    const speed = now < this.recoverUntil ? 8 : 26;
    if (d > want) {
      this.x += (dx / d) * speed * (dt / 1000);
      this.y += (dy / d) * speed * (dt / 1000);
    }
    this.sprite.setFlipX(dx < 0);

    if (now >= this.nextSlamAt && d < 150 && now >= this.recoverUntil) {
      this.nextSlamAt = now + P1.SLAM_EVERY_MS;
      this.slam(player);
    }
  }

  /**
   * The signature of an approach: which side of the Echo the swing came from,
   * and whether the player dashed in first. Eight of them, which is few enough
   * that repetition is genuinely visible and many enough that "do something
   * else" is always available.
   */
  private signature(player: Player): string {
    const dx = player.x - this.x;
    const dy = (player.y - 10) - (this.y - 30);
    const side: Side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
    const dashed = this.scene.time.now - this.lastDashAt < 700;
    return `${side}${dashed ? '+' : '-'}`;
  }

  private resolveP1Swing(now: number, player: Player): void {
    const sig = this.signature(player);
    this.attackedSinceDash = true;

    if (this.predicted && now < this.guardUntil && now >= this.recoverUntil) {
      if (sig === this.predicted) {
        // It was already standing where you were going to be.
        this.play('echo_phase1_counter', true);
        Audio.sfx('block', { volume: 0.55 });
        this.scene.fx.burst(this.x, this.y - 30, 'fx/echo_burst');
        this.scene.shake(0.004, 120);
        const a = Math.atan2(player.y - this.y, player.x - this.x);
        player.vx = Math.cos(a) * 190;
        player.vy = Math.sin(a) * 190;
        emit('boss:blocked', { signature: sig });

        // ...and it swipes the ground it was guarding. Telegraphed, so a player
        // who reads the block and backs off takes nothing; one who bounces off
        // and walks straight back into the same approach eats it.
        const [gx, gy] = SIDE_VEC[sig[0] as Side];
        this.indicators.push(new Indicator(
          this.scene,
          this.x + gx * 30,
          this.y - 14 + gy * 22,
          true,
          now + P1.COUNTER_FUSE_MS,
          1.4,
        ));

        // Blocking still costs it the read: it drops its guard and has to watch
        // you again from scratch. That is what stops a repeat-attacker
        // softlocking — mashing stays possible, it is just very slow.
        this.forget();
        this.recoverUntil = now + P1.RECOVER_MS;
        return;
      }
      // The guard is in the wrong place, and it is a long way out of position.
      this.clearGhost();
      this.wound(P1.PUNISH_DAMAGE, player.x, player.y, true);
      this.staggerUntil = now + P1.PUNISH_STAGGER_MS;
      this.predicted = null;
      this.history = [];
      emit('boss:punished', { signature: sig });
      return;
    }

    this.wound(1, player.x, player.y);
    if (now < this.recoverUntil) return;

    this.history.push(sig);
    if (this.history.length > 3) this.history.shift();
    const same = this.history.filter((s) => s === sig).length;
    if (same >= P1.LEARN_AT && !this.predicted) this.learn(sig);
  }

  /** It has seen enough. Commit to the read, and show the read. */
  private learn(sig: string): void {
    this.predicted = sig;
    this.guardUntil = this.scene.time.now + P1.GUARD_MS;
    this.play('echo_phase1_learn', true);
    Audio.sfx('echo_phase', { volume: 0.5 });
    this.scene.fx.emote(this.x, this.y - 30, 'excl', 700);

    // The tell: your own last swing, hanging in the air on the side it expects
    // the next one from. A player who never works out the rule still sees the
    // Echo turn and guard the place they keep attacking.
    const side = sig[0] as Side;
    const [vx, vy] = SIDE_VEC[side];
    this.clearGhost();
    const frame = hasFrame(this.scene, 'enemy/echo/afterimage_0') ? 'enemy/echo/afterimage_0' : 'ui/fade_pixel';
    this.ghost = this.scene.add.sprite(this.x + vx * 30, this.y + vy * 22, 'atlas', frame)
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.ENTITY_BASE + this.y - 4)
      .setAlpha(0)
      .setTint(COLORS.echoCyan)
      .setFlipX(side === 'w');
    if (this.scene.anims.exists('echo_afterimage')) this.ghost.play('echo_afterimage');
    this.scene.tweens.add({ targets: this.ghost, alpha: 0.5, duration: 240 });
    this.sprite.setFlipX(side === 'w');
    emit('boss:learned', { signature: sig });
  }

  private forget(): void {
    this.predicted = null;
    this.guardUntil = 0;
    this.history = [];
    this.clearGhost();
  }

  private clearGhost(): void {
    if (!this.ghost) return;
    const g = this.ghost;
    this.ghost = undefined;
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
  }

  /** Called by the area script from the player:dash event. */
  noteDash(px: number, py: number, dir: Dir): void {
    const now = this.scene.time.now;
    this.lastDashAt = now;
    this.attackedSinceDash = false;
    const [dx, dy] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[dir] as [number, number];
    const tx = this.x - px;
    const ty = (this.y - 30) - py;
    const len = Math.hypot(tx, ty) || 1;
    this.dashWasIn = (dx * tx + dy * ty) / len > 0.35;
  }

  /** The Echo's one baseline attack. Uses a live indicator, on purpose — by the
   *  time phase two asks which marks are real, the player has already watched a
   *  live one go off a dozen times. */
  private slam(player: Player): void {
    const tx = Phaser.Math.Clamp(player.x, this.opts.arena.x0, this.opts.arena.x1);
    const ty = Phaser.Math.Clamp(player.y - 6, this.opts.arena.y0, this.opts.arena.y1);
    this.play('echo_tell_slam', true);
    Audio.sfx('charge', { volume: 0.35, rate: 0.8 });
    this.indicators.push(new Indicator(this.scene, tx, ty, true, this.scene.time.now + 620, 1.6));
  }

  // ── PHASE TWO — interference ──────────────────────────────────────────────

  private updatePhase2(dt: number, now: number, player: Player): void {
    if (this.staggered) {
      this.play('echo_stagger');
    } else {
      this.play('echo_phase2_split');
    }

    // It circles the ring; the sweep is what "passes" a brazier and lights it.
    if (!this.staggered) {
      const c = this.opts.home;
      this.x = c.x + Math.cos(this.drift * 0.7) * 92;
      this.y = c.y + Math.sin(this.drift * 0.7) * 22;
    }

    if (now < this.waveAt) return;

    switch (this.waveState) {
      case 'idle': {
        // Choose the quadrant(s) it is about to strike, and light them FIRST.
        this.wave++;
        this.waveClean = true;
        const count = P2.RAMP[Math.min(this.wave, P2.RAMP.length - 1)];
        const lit = count >= 6 ? 2 : 1;
        const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5).slice(0, lit);
        this.braziers.forEach((b, i) => b.setLit(order.includes(i)));
        this.litRunes = [];
        for (const i of order) this.litRuneArc(this.opts.braziers[i]);
        this.play('echo_tell_sweep', true);
        Audio.sfx('echo_hum', { volume: 0.4 });
        this.waveState = 'flare';
        this.waveAt = now + P2.FLARE_LEAD_MS;
        emit('boss:wave', { wave: this.wave, count, lit: order });
        break;
      }
      case 'flare': {
        const count = P2.RAMP[Math.min(this.wave, P2.RAMP.length - 1)];
        this.spawnWave(count, now + P2.READ_MS);
        this.waveState = 'read';
        this.waveAt = now + P2.READ_MS + 260;
        break;
      }
      case 'read': {
        // Everything has gone off by now. A clean read over-commits it.
        this.indicators.forEach((i) => i.fade());
        this.braziers.forEach((b) => b.setLit(false, 420));
        this.dimRunes();
        this.waveState = 'settle';
        if (this.waveClean) {
          this.staggerUntil = now + P2.STAGGER_MS;
          this.lastProgressAt = now;
          this.play('echo_stagger', true);
          Audio.sfx('echo_roar', { volume: 0.45, rate: 1.3 });
          this.scene.fx.burst(this.x, this.y - 30, 'fx/echo_burst');
          this.waveAt = now + P2.STAGGER_MS + P2.GAP_MS;
        } else {
          this.staggerUntil = now + P2.PITY_MS;
          this.waveAt = now + P2.GAP_MS;
        }
        break;
      }
      case 'settle':
        this.waveState = 'idle';
        this.waveAt = now;
        break;
    }
  }

  /**
   * Place the wave. Live marks stand inside a burning brazier's light; stale
   * ones are kept well clear of every burning brazier, so the rule "in the
   * light is real" is never ambiguous at the edges.
   */
  private spawnWave(count: number, strikeAt: number): void {
    const burning = this.braziers.map((b, i) => (b.lit ? this.opts.braziers[i] : null)).filter(Boolean) as
      Array<{ x: number; y: number }>;
    if (!burning.length) return;
    const live = Math.max(1, Math.round(count / 2));
    const a = this.opts.arena;

    for (let i = 0; i < live; i++) {
      const b = burning[i % burning.length];
      const ang = Math.random() * Math.PI * 2;
      const r = 16 + Math.random() * (P2.LIVE_RADIUS - 16);
      const x = Phaser.Math.Clamp(b.x + Math.cos(ang) * r, a.x0, a.x1);
      const y = Phaser.Math.Clamp(b.y + Math.sin(ang) * r * 0.62, a.y0, a.y1);
      this.indicators.push(new Indicator(this.scene, x, y, true, strikeAt));
    }

    for (let i = 0; i < count - live; i++) {
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 40; tries++) {
        x = a.x0 + Math.random() * (a.x1 - a.x0);
        y = a.y0 + Math.random() * (a.y1 - a.y0);
        if (burning.every((b) => Math.hypot(b.x - x, b.y - y) > P2.STALE_CLEARANCE)) break;
      }
      this.indicators.push(new Indicator(this.scene, x, y, false, strikeAt));
    }
  }

  /** Wake the arc of the inscribed ring nearest a burning brazier. A second,
   *  redundant statement of the same cue, because this is the one thing in the
   *  fight the player absolutely has to be able to read. */
  private litRuneArc(b: { x: number; y: number }): void {
    for (const [tx, ty] of this.opts.runeTiles) {
      const cx = tx * 16 + 8;
      const cy = ty * 16 + 8;
      if (Math.hypot(cx - b.x, cy - (b.y - 8)) > 74) continue;
      this.setRune(tx, ty, true);
      this.litRunes.push([tx, ty]);
    }
  }

  private dimRunes(): void {
    for (const [tx, ty] of this.litRunes) this.setRune(tx, ty, false);
    this.litRunes = [];
  }

  private setRune(tx: number, ty: number, lit: boolean): void {
    const layer = this.scene.world?.ground;
    if (!layer) return;
    const tile = layer.getTileAt(tx, ty);
    if (!tile) return;
    // The lit and dim rune plates are parallel families in the tileset; the
    // index offset between them is constant, so a swap is one putTileAt.
    const fam = lit ? 'tile/shrine/rune_floor' : 'tile/shrine/rune_floor_dim';
    const idx = this.runeIndex(fam, tx, ty);
    if (idx >= 0) layer.putTileAt(idx, tx, ty);
  }

  private runeCache = new Map<string, number[]>();
  private runeIndex(fam: string, tx: number, ty: number): number {
    let list = this.runeCache.get(fam);
    if (!list) {
      const index = (this.scene.cache.json.get('art') as
        { tileset?: { index?: Record<string, number> } } | undefined)?.tileset?.index;
      if (!index) return -1;
      list = Object.keys(index).filter((k) => k.replace(/_\d+$/, '') === fam).sort().map((k) => index[k]);
      this.runeCache.set(fam, list);
    }
    if (!list.length) return -1;
    return list[(tx * 7 + ty * 13) % list.length];
  }

  private resolveP2Swing(now: number, player: Player): void {
    if (!this.staggered) {
      // It is six overlapping copies of itself; the sword goes through them.
      Audio.sfx('block', { volume: 0.32, rate: 1.25 });
      this.scene.fx.burst(this.x, this.y - 30, 'fx/echo_burst');
      this.invulnUntil = now + 180;
      return;
    }
    this.wound(1, player.x, player.y);
  }

  // ── PHASE THREE — conformity ──────────────────────────────────────────────

  private spawnRing(): void {
    this.group = new ConformityGroup(this.scene);
    const n = Math.max(3, P3.FOLLOWERS - this.cycle);
    const odd = Math.floor(Math.random() * n);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const f = new Follower(
        this.scene, `mote${this.cycle}_${i}`, ang,
        this.x + Math.cos(ang) * P3.ORBIT,
        this.y + Math.sin(ang) * P3.ORBIT * 0.55 + 10,
      );
      f.odd = i === odd;
      this.followers.push(f);
      this.group.add(f, false);
    }
    // The boss leads. ConformityGroup needs a leader to copy, and the leader is
    // the thing the followers are unanimous *about*.
    const leader: ConformerLike = {
      id: 'echo',
      x: this.x,
      y: this.y,
      facing: 's',
      dissenting: false,
      setFacing: (d) => { leader.facing = d; },
      setDissenting: () => {},
    };
    this.group.add(leader, true);
    this.buildShield();
    this.unanimousSince = this.scene.time.now;
  }

  private buildShield(): void {
    this.shield?.destroy();
    this.shield = this.scene.add.graphics().setDepth(DEPTH.ENTITY_BASE + this.y - 2);
  }

  private updatePhase3(dt: number, now: number, player: Player): void {
    const g = this.group;
    if (!g) return;
    const broken = g.broken;

    this.play(this.staggered ? 'echo_stagger' : 'echo_phase3_lead');

    if (!this.staggered && !broken) {
      // It leads from the middle, swaying, and the ring goes where it goes.
      this.x = this.opts.home.x + Math.sin(this.drift * 0.5) * 62;
      this.y = this.opts.home.y + Math.cos(this.drift * 0.42) * 14;
    }

    // ── the beat ──
    if (!broken && now >= this.nextBeatAt) {
      this.nextBeatAt = now + P3.BEAT_MS;
      this.beat++;
      const dirs: Dir[] = ['s', 'e', 'n', 'w'];
      g.setLeaderFacing(dirs[this.beat % dirs.length]);
      const late = now - this.unanimousSince > P3.DESPERATION_MS ? P3.LATE_MS * 1.6 : P3.LATE_MS;
      for (const f of this.followers) {
        if (f.dead || f.dissenting) continue;
        if (f.odd) {
          // Late, and facing one step off. Visible before it is understood.
          this.scene.time.delayedCall(late, () => {
            if (f.dead || f.dissenting) return;
            f.pulse(this.scene.time.now);
            f.setFacing(dirs[(this.beat + 1) % dirs.length], false);
          });
        } else {
          f.pulse(now);
        }
      }
      Audio.sfx('echo_hum', { volume: 0.3, rate: 1.1 });
    }

    // ── formation ──
    const spin = broken ? 0 : dt / 1000 * 0.55;
    for (const f of this.followers) {
      if (f.dead) continue;
      if (!f.dissenting) {
        f.angle += spin;
        // The odd one drifts a little further out the longer nobody notices.
        const stray = f.odd
          ? 1 + Math.min(0.42, (now - this.unanimousSince) / P3.DESPERATION_MS * 0.42)
          : 1;
        const tx = this.x + Math.cos(f.angle) * P3.ORBIT * stray;
        const ty = this.y + Math.sin(f.angle) * P3.ORBIT * 0.55 * stray + 10;
        f.x += (tx - f.x) * Math.min(1, dt / 140);
        f.y += (ty - f.y) * Math.min(1, dt / 140);
      }
      f.update(dt, now);
      if (!f.dead && f.touches(player.x, player.y - 8) && !player.invulnerable) {
        player.hurt(1, f.x, f.y);
      }
    }

    // ── the shield ──
    if (this.shield) {
      this.shield.clear();
      if (this.shielded) {
        const pulseA = 0.30 + Math.sin(this.drift * 3.4) * 0.12;
        this.shield.lineStyle(1, COLORS.echoCyan, pulseA + 0.3);
        this.shield.strokeEllipse(this.x, this.y - 26, 92, 74);
        this.shield.lineStyle(1, COLORS.echoGlow, pulseA);
        this.shield.strokeEllipse(this.x, this.y - 26, 80, 64);
        this.shield.setDepth(DEPTH.ENTITY_BASE + this.y + 2);
      }
    }

    if (!this.staggered && !broken && now >= this.nextSlamAt) {
      this.nextSlamAt = now + P3.SLAM_EVERY_MS;
      this.slam(player);
    }

    // ── re-forming ──
    // Once the stagger runs out it absorbs the dissenter and re-recruits, one
    // follower short. Each break is worth a big damage window, so understanding
    // it once is worth roughly a third of the phase.
    if (broken && !this.staggered && this.stage === 'fighting') {
      this.cycle++;
      this.followers.forEach((f) => f.dissolve());
      this.followers = [];
      this.group = undefined;
      this.scene.time.delayedCall(700, () => {
        if (this.stage !== 'fighting' || this.phase !== 3) return;
        this.spawnRing();
        this.nextBeatAt = this.scene.time.now + 500;
        Audio.sfx('echo_phase', { volume: 0.45 });
      });
    }
  }

  /**
   * Hitting a follower.
   *
   * While the group is unanimous this is the failure the shrine already taught:
   * the struck one turns to you and the group drags it straight back. Hit the
   * one that is already out of step and it goes over instead — and the whole
   * formation comes apart.
   */
  private hitFollower(f: Follower, now: number, player: Player): void {
    const g = this.group;
    if (!g || f.dead) return;

    if (f.dissenting) {
      f.dissolve();
      return;
    }

    if (f.odd || f.snapbacks >= P3.SNAPBACKS_TO_BREAK - 1) {
      // ConformityGroup owns the ability check; if the player somehow arrived
      // without DISSENT the fight must still be winnable, so fall through.
      if (!g.makeDissent(f)) f.setDissenting(true);
      this.breakUnanimity(now);
      return;
    }

    f.snapbacks++;
    const dir: Dir = Math.abs(player.x - f.x) > Math.abs(player.y - f.y)
      ? (player.x > f.x ? 'e' : 'w')
      : (player.y > f.y ? 's' : 'n');
    g.turnMember(f, dir);
    if (this.scene.anims.exists('echomote_hurt')) f.sprite.play('echomote_hurt');
    Audio.sfx('block', { volume: 0.4, rate: 1.1 });
    this.scene.fx.impact(f.x, f.y - 9);
  }

  /** The moment the phase turns. It has to be unmistakable. */
  private breakUnanimity(now: number): void {
    this.lastProgressAt = now;
    this.staggerUntil = now + P3.BREAK_STAGGER_MS;
    this.play('echo_stagger', true);
    Audio.sfx('dissent', { volume: 0.7 });
    Audio.sfx('echo_roar', { volume: 0.5, rate: 0.85 });
    this.scene.shake(0.008, 420);
    this.scene.setTimeScale(0.22, 220);
    this.scene.flash(0x8ce6e6, 140);
    this.scene.fx.burst(this.x, this.y - 30, 'fx/echo_burst');
    if (this.shield) this.shield.clear();

    // Everyone else loses the beat: random facings, scattered spacing, no pulse.
    for (const f of this.followers) {
      if (f.dead || f.dissenting) continue;
      f.angle += (Math.random() - 0.5) * 1.6;
      const dirs: Dir[] = ['n', 's', 'e', 'w'];
      f.setFacing(dirs[Math.floor(Math.random() * 4)], false);
      this.scene.fx.emote(f.x, f.y, 'sweat', 800);
    }
    emit('boss:unanimity_broken', { cycle: this.cycle });
  }

  private resolveP3Swing(now: number, player: Player): void {
    if (this.shielded) {
      Audio.sfx('block', { volume: 0.45, rate: 0.9 });
      this.scene.fx.burst(this.x, this.y - 26, 'fx/echo_burst');
      this.scene.shake(0.002, 70);
      this.invulnUntil = now + 200;
      emit('boss:deflected', {});
      return;
    }
    this.wound(1, player.x, player.y);
  }

  // ── markers ───────────────────────────────────────────────────────────────

  /**
   * Was the player standing somewhere the room told them was safe?
   *
   * Deliberately NOT "did a mark land on them". A player loitering inside the
   * burning quadrant who happens to be between two marks has survived by luck,
   * and a phase that cannot tell luck from comprehension is not testing
   * comprehension. Clearing a wave means being out of the fire-lit quadrant
   * altogether — the rule the braziers state, and the only rule that is 100%
   * reliable rather than probabilistic.
   */
  private stoodClear(player: Player): boolean {
    const py = player.y - 8;
    return this.braziers.every((b, i) => {
      if (!b.lit) return true;
      const src = this.opts.braziers[i];
      return Math.hypot(src.x - player.x, src.y - py) > P2.SAFE_CLEARANCE;
    });
  }

  private updateIndicators(now: number, player: Player): void {
    if (!this.indicators.length) return;
    for (const ind of this.indicators) {
      if (!ind.update(now)) continue;
      if (!ind.live) { ind.fade(); continue; }
      // Judged at the instant of the strike, not afterwards: the player is
      // never failed for stepping back into the light once it is over.
      if (this.phase === 2 && !this.stoodClear(player)) this.waveClean = false;
      Audio.sfx('echo_hit', { volume: 0.45, rate: 1.1 });
      this.scene.fx.burst(ind.x, ind.y, 'fx/echo_burst');
      this.scene.shake(0.003, 90);
      if (ind.covers(player.x, player.y - 8) && !player.invulnerable) {
        // One heart, never the run (plan.md §46, §67).
        player.hurt(1, ind.x, ind.y);
        this.waveClean = false;
      }
      ind.fade();
    }
    this.indicators = this.indicators.filter((i) => !i.dead);
  }

  // ── the end ───────────────────────────────────────────────────────────────

  /**
   * plan.md §48: it is not destroyed. It comes apart, the shapes it borrowed
   * fall away one at a time, and what is left goes down through the drain.
   */
  private die(): void {
    if (this.stage === 'dying' || this.stage === 'done') return;
    this.stage = 'dying';
    this.clearPhase();
    this.staggerUntil = 0;
    this.play('echo_die', true);
    Audio.sfx('echo_roar', { volume: 0.8, rate: 0.7 });
    this.scene.setTimeScale(0.3, 700);
    this.scene.shake(0.007, 900);
    emit('boss:dying', {});

    // The borrowed shapes come off it, one every 260ms, and drift away.
    for (let i = 0; i < 6; i++) {
      this.scene.time.delayedCall(260 + i * 260, () => {
        if (!hasFrame(this.scene, 'enemy/echo/afterimage_0')) return;
        const s = this.scene.add.sprite(this.x, this.y, 'atlas', 'enemy/echo/afterimage_0')
          .setOrigin(0.5, 1)
          .setDepth(DEPTH.ENTITY_BASE + this.y - 6)
          .setAlpha(0.6)
          .setTint(i % 2 ? COLORS.echoGlow : COLORS.echoCyan);
        if (this.scene.anims.exists('echo_afterimage')) s.play('echo_afterimage');
        const a = (i / 6) * Math.PI * 2 + 0.4;
        this.scene.tweens.add({
          targets: s,
          x: this.x + Math.cos(a) * 70,
          y: this.y + Math.sin(a) * 34 - 16,
          alpha: 0,
          scale: 0.7,
          duration: 1500,
          ease: 'Sine.easeOut',
          onComplete: () => s.destroy(),
        });
        Audio.sfx('echo_hum', { volume: 0.25, rate: 0.8 + i * 0.12 });
      });
    }

    // And then what is left of it pours down the drain.
    this.scene.tweens.add({
      targets: this, x: this.opts.grate.x, y: this.opts.grate.y, duration: 2200, ease: 'Sine.easeInOut',
    });
    this.scene.tweens.add({
      targets: this.shadow, alpha: 0, duration: 2600,
    });
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0, scaleX: 0.6, scaleY: 0.2, y: this.opts.grate.y + 6,
      delay: 2000, duration: 1400, ease: 'Quad.easeIn',
      onComplete: () => {
        this.stage = 'done';
        this.sprite.setVisible(false);
        Audio.sfx('echo_hum', { volume: 0.5, rate: 0.5 });
        this.opts.onDefeated?.();
      },
    });
  }

  // ── QA surface ────────────────────────────────────────────────────────────

  /** QA only: run the real death sequence now, for ending screenshots. */
  forceDefeat(): void {
    this.phase = 3;
    this.hp = 0;
    this.stage = 'fighting';
    this.die();
  }

  /** Everything a playtest bot or a screenshot script needs to see. */
  snapshot(): Record<string, unknown> {
    return {
      stage: this.stage,
      phase: this.phase,
      hp: this.hp,
      maxHp: HP[this.phase],
      staggered: this.staggered,
      shielded: this.shielded,
      predicted: this.predicted,
      wave: this.wave,
      x: this.x,
      y: this.y,
      indicators: this.indicators
        .filter((i) => !i.dead && !i.struck)
        .map((i) => ({ x: i.x, y: i.y, live: i.live, halfW: i.halfW, halfH: i.halfH })),
      braziers: this.braziers.map((b, i) => ({ x: b.x, y: b.y, lit: b.lit, index: i })),
      followers: this.followers
        .filter((f) => !f.dead)
        .map((f) => ({ id: f.id, x: f.x, y: f.y, odd: f.odd, dissenting: f.dissenting, facing: f.facing })),
      unanimous: !!this.group && !this.group.broken,
      log: this.log,
    };
  }
}
