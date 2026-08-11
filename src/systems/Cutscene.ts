/**
 * Cutscene / dialogue director.
 *
 * Scenes are written as async functions so quest code reads like a screenplay:
 *
 *   await w.cutscene.run(async (c) => {
 *     await c.say('mira', "That's Pip. He's been like this since the storm.");
 *     await c.walk('mira', 12, 9);
 *     await c.wait(400);
 *   });
 *
 * The plan's dialogue philosophy is enforced here by convention: `say` takes
 * one short line. If you need a paragraph, you are writing the wrong scene.
 */
import Phaser from 'phaser';
import { emit, once } from '@/core/events';
import type { WorldScene } from '@/scenes/WorldScene';
import type { Dir } from '@/entities/Player';

export interface Choice {
  text: string;
  /** Optional flag set when chosen. */
  flag?: string;
  value?: string;
}

export interface SayOptions {
  /** Emote glyph shown above the speaker. */
  emote?: string;
  /** Hold the line for this long instead of waiting for input. */
  auto?: number;
  /** Screen-shake / emphasis. */
  emphasis?: boolean;
}

export class CutsceneContext {
  /** The map generation this scene was started for. */
  generation = -1;

  constructor(private w: WorldScene) {}

  /**
   * True once the map has changed under this scene. Every awaitable below
   * resolves immediately when it is set, so a scene that is still running when
   * the player leaves unwinds instead of narrating over the next place.
   */
  get aborted(): boolean {
    return this.generation >= 0 && this.w.mapGeneration !== this.generation;
  }

  /** One short line of dialogue. speaker is an NPC id, or 'player'/'narrator'. */
  say(speaker: string, text: string, opts: SayOptions = {}): Promise<void> {
    if (this.aborted) return Promise.resolve();
    const npc = this.w.npc(speaker);
    if (npc) { npc.talking = true; npc.faceTowards(this.w.player.x, this.w.player.y); }
    if (opts.emote && npc) this.w.fx.emote(npc.x, npc.y, opts.emote);
    return new Promise((resolve) => {
      once('dialogue:closed', () => {
        if (npc) npc.talking = false;
        resolve();
      });
      emit('dialogue:show', { speaker, text, ...opts });
    });
  }

  /** A player dialogue choice. Resolves to the chosen index. */
  choose(prompt: string, choices: Choice[]): Promise<number> {
    if (this.aborted) return Promise.resolve(0);
    return new Promise((resolve) => {
      once('dialogue:chose', (p: { index: number }) => resolve(p.index));
      emit('dialogue:choices', { prompt, choices });
    });
  }

  wait(ms: number): Promise<void> {
    if (this.aborted) return Promise.resolve();
    return new Promise((resolve) => this.w.time.delayedCall(ms, resolve));
  }

  /** Walk an NPC to a tile and wait for arrival. */
  walk(npcId: string, tx: number, ty: number): Promise<void> {
    if (this.aborted) return Promise.resolve();
    const npc = this.w.npc(npcId);
    if (!npc) return Promise.resolve();
    return new Promise((resolve) => npc.walkTo(tx, ty, resolve));
  }

  face(npcId: string, dir: Dir): void {
    if (npcId === 'player') { this.w.player.face(dir); return; }
    this.w.npc(npcId)?.face(dir);
  }

  pose(npcId: string, pose: string): void {
    this.w.npc(npcId)?.setPose(pose);
  }

  /** Move the player along a path (arrival sequences). */
  movePlayer(tx: number, ty: number, speed = 60): Promise<void> {
    if (this.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const target = { x: tx * 16 + 8, y: ty * 16 + 16 };
      const startedOn = this.w.mapId;
      const startedPlayer = this.w.player;
      let done = false;
      const finish = (snap: boolean) => {
        if (done) return;
        done = true;
        this.w.events.off(Phaser.Scenes.Events.UPDATE, step);
        if (snap) startedPlayer.setPosition(target.x, target.y, startedPlayer.dir);
        resolve();
      };
      const step = (_: unknown, dt: number) => {
        // Abandon if the world moved on under us. Without this the handler
        // outlives its map and keeps walking whoever the player is now.
        if (this.w.mapId !== startedOn || this.w.player !== startedPlayer) { finish(false); return; }
        const p = this.w.player;
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 2) { finish(true); return; }
        const m = (speed * dt) / 1000;
        p.x += (dx / d) * m;
        p.y += (dy / d) * m;
        p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : (dy > 0 ? 's' : 'n');
      };
      this.w.events.on(Phaser.Scenes.Events.UPDATE, step);
      // Hard ceiling: a path blocked by geometry must not hang a cutscene.
      this.w.time.delayedCall(12000, () => finish(false));
    });
  }

  panTo(tx: number, ty: number, ms = 700): Promise<void> {
    if (this.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const cam = this.w.cameras.main;
      cam.stopFollow();
      cam.pan(tx * 16 + 8, ty * 16 + 8, ms, 'Sine.easeInOut', false, (_c, progress) => {
        if (progress === 1) resolve();
      });
    });
  }

  followPlayer(ms = 500): void {
    const cam = this.w.cameras.main;
    cam.pan(this.w.player.x, this.w.player.y, ms, 'Sine.easeInOut', false, (_c, progress) => {
      if (progress === 1) cam.startFollow(this.w.player.sprite, true, 0.14, 0.14);
    });
  }

  fadeOut(ms = 400): Promise<void> {
    return new Promise((resolve) => {
      this.w.cameras.main.fadeOut(ms, 0, 0, 0);
      this.w.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, resolve);
    });
  }

  fadeIn(ms = 400): Promise<void> {
    return new Promise((resolve) => {
      this.w.cameras.main.fadeIn(ms, 0, 0, 0);
      this.w.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, resolve);
    });
  }

  shake(intensity = 0.006, ms = 220): void {
    this.w.shake(intensity, ms);
  }

  /** Show the big concept-unlock card and wait for dismissal. */
  insight(id: string): Promise<void> {
    if (this.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      once('insight:closed', () => resolve());
      emit('insight:show', { id });
    });
  }

  banner(title: string, subtitle?: string): void {
    if (this.aborted) return;
    emit('ui:banner', { title, subtitle });
  }

  toast(text: string): void {
    if (this.aborted) return;
    emit('ui:toast', { text });
  }

  get scene(): WorldScene { return this.w; }
}

export class Cutscene {
  active = false;
  private ctx: CutsceneContext;

  constructor(private w: WorldScene) {
    this.ctx = new CutsceneContext(w);
  }

  async run(fn: (c: CutsceneContext) => Promise<void>): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.ctx.generation = this.w.mapGeneration;
    this.w.player.lock();
    this.w.keys.enabled = false;
    emit('cutscene:start', {});
    try {
      await fn(this.ctx);
    } catch (e) {
      console.error('cutscene failed', e);
    } finally {
      this.active = false;
      // Only hand control back if we are still in the map that took it; the new
      // map has its own idea of whether the player should be able to move.
      if (!this.ctx.aborted) {
        this.w.keys.enabled = true;
        this.w.player.unlock();
      }
      this.ctx.generation = -1;
      emit('cutscene:end', {});
    }
  }

  /** A dialogue-only exchange: same lock, lighter ceremony. */
  async talk(fn: (c: CutsceneContext) => Promise<void>): Promise<void> {
    return this.run(fn);
  }

  update(_dt: number): void { /* NPC movement is driven by their own update */ }
}
