import Phaser from 'phaser';
import { CAMERA, DEPTH, GAME_H, GAME_W, TILE } from '@/core/config';
import { InputManager } from '@/core/input';
import { State } from '@/core/state';
import { emit, on } from '@/core/events';
import { Player, type Dir } from '@/entities/Player';
import { Npc } from '@/entities/Npc';
import { buildWorld, stepWaterFrame, type BuiltWorld } from '@/world/WorldBuilder';
import { getArea, getMap, type AreaScript } from '@/world/registry';
import type { Zone } from '@/world/types';
import { FxManager } from '@/systems/Fx';
import { Lighting } from '@/systems/Lighting';
import { EnemyManager } from '@/systems/EnemyManager';
import { Interactions, type Interactable } from '@/systems/Interactions';
import { Cutscene } from '@/systems/Cutscene';
import { Mote } from '@/entities/Mote';
import { CueBus, RecallSystem } from '@/systems/Abilities';
import { GameFlow } from '@/systems/GameFlow';
import { Audio } from '@/audio/Audio';
import { installDebugApi } from '@/debug/api';

export class WorldScene extends Phaser.Scene {
  keys!: InputManager;
  player!: Player;
  mote?: Mote;
  world!: BuiltWorld;
  npcs: Npc[] = [];
  fx!: FxManager;
  lighting!: Lighting;
  enemies!: EnemyManager;
  interactions!: Interactions;
  cutscene!: Cutscene;
  /** Learned-association cues (LINK) emitted by bells, moths and lanterns. */
  cues!: CueBus;
  /** Context evidence the player can read (RECALL). */
  recall!: RecallSystem;
  /** Death, respawn and autosave. */
  flow!: GameFlow;

  area?: AreaScript;
  mapId = '';

  /** Extra colliders contributed by area scripts (moving gates, blocks). */
  dynamicSolids: boolean[][] = [];
  private combinedSolid: boolean[][] = [];
  private solidDirty = true;

  private waterTimer = 0;
  private waterFrame = 0;
  private firedTriggers = new Set<string>();
  private transitioning = false;
  private observeReadyAt = 0;
  private timeScale = 1;

  constructor() {
    super('World');
  }

  create(): void {
    this.keys = new InputManager(this);
    this.fx = new FxManager(this);
    this.lighting = new Lighting(this);
    this.enemies = new EnemyManager(this);
    this.interactions = new Interactions(this);
    this.cutscene = new Cutscene(this);
    this.cues = new CueBus(this);
    this.recall = new RecallSystem(this);
    this.flow = new GameFlow(this);

    installDebugApi(this);

    const params = new URLSearchParams(location.search);
    const mapId = params.get('map') ?? State.currentMap;
    const spawn = params.get('spawn') ?? State.currentSpawn;

    on('request:changeMap', (p: { to: string; spawn?: string; facing?: Dir; instant?: boolean }) => {
      this.changeMap(p.to, p.spawn ?? 'default', p.facing, p.instant);
    });

    this.loadMap(mapId, spawn);

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.area?.onExit?.(this);
    });
  }

  // ── map lifecycle ────────────────────────────────────────────────────────

  loadMap(id: string, spawnId = 'default', facing?: Dir): void {
    this.area?.onExit?.(this);
    this.tearDown();

    this.mapId = id;
    State.currentMap = id;
    State.currentSpawn = spawnId;
    State.visited.add(id);

    const def = getMap(id);
    this.world = buildWorld(this, def);
    this.dynamicSolids = Array.from({ length: this.world.height }, () => new Array<boolean>(this.world.width).fill(false));
    this.combinedSolid = this.world.solid.map((row) => [...row]);
    this.solidDirty = true;

    const spawn = def.spawns[spawnId] ?? def.spawns.default;
    const px = spawn.x * TILE + TILE / 2;
    const py = spawn.y * TILE + TILE;

    this.player = new Player(this, px, py);
    this.player.face(facing ?? spawn.facing ?? 's');
    this.player.grid = this.collisionGrid();
    this.player.ensureUnstuck();

    for (const n of def.npcs ?? []) {
      this.npcs.push(new Npc(this, {
        id: n.id,
        actor: n.id,
        x: n.x,
        y: n.y,
        facing: n.facing,
        path: n.path,
        dwell: n.dwell,
      }));
    }

    if (State.hasAbility('observe') && !def.indoor) {
      this.mote = new Mote(this, px - 14, py - 18);
    } else if (State.hasAbility('observe')) {
      this.mote = new Mote(this, px - 14, py - 18);
    }

    this.cameras.main.setBounds(0, 0, this.world.pixelWidth, this.world.pixelHeight);
    this.cameras.main.startFollow(this.player.sprite, true, CAMERA.LERP, CAMERA.LERP);
    this.cameras.main.setDeadzone(CAMERA.DEADZONE_W, CAMERA.DEADZONE_H);
    this.cameras.main.setRoundPixels(true);
    if (def.tint !== undefined) this.cameras.main.setBackgroundColor(def.tint);

    this.lighting.configure(def);
    this.fx.configure(def);
    this.interactions.rebuild(this.world);
    this.enemies.clear();
    this.firedTriggers.clear();

    this.area = getArea(id);
    this.area?.onEnter?.(this);

    Audio.playMusic(def.music);
    emit('map:entered', { id, name: def.name, subtitle: def.subtitle });
  }

  changeMap(to: string, spawnId = 'default', facing?: Dir, instant = false): void {
    if (this.transitioning) return;
    this.transitioning = true;
    const go = () => {
      this.loadMap(to, spawnId, facing);
      this.cameras.main.fadeIn(instant ? 1 : 220, 0, 0, 0);
      this.time.delayedCall(instant ? 1 : 240, () => { this.transitioning = false; });
    };
    if (instant) { go(); return; }
    this.cameras.main.fadeOut(180, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
  }

  private tearDown(): void {
    this.npcs.forEach((n) => n.destroy());
    this.npcs = [];
    this.mote?.destroy();
    this.mote = undefined;
    this.enemies?.clear();
    this.cues?.clear();
    this.recall?.clear();
    this.fx?.clear();
    this.lighting?.clear();
    this.interactions?.clear();
    if (this.player) this.player.destroy();
    this.world?.map.destroy();
    this.children.removeAll();
    this.tweens.killAll();
  }

  // ── collision ────────────────────────────────────────────────────────────

  /** Static map collision OR'd with whatever area scripts have added. */
  collisionGrid(): boolean[][] {
    if (!this.solidDirty) return this.combinedSolid;
    this.solidDirty = false;
    for (let y = 0; y < this.world.height; y++) {
      const a = this.world.solid[y];
      const b = this.dynamicSolids[y];
      const out = this.combinedSolid[y];
      for (let x = 0; x < a.length; x++) out[x] = a[x] || b[x];
    }
    return this.combinedSolid;
  }

  setDynamicSolid(tx: number, ty: number, solid: boolean): void {
    if (ty < 0 || ty >= this.dynamicSolids.length) return;
    if (tx < 0 || tx >= this.dynamicSolids[ty].length) return;
    if (this.dynamicSolids[ty][tx] === solid) return;
    this.dynamicSolids[ty][tx] = solid;
    this.solidDirty = true;
  }

  setDynamicSolidRect(tx: number, ty: number, w: number, h: number, solid: boolean): void {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) this.setDynamicSolid(x, y, solid);
  }

  // ── main loop ────────────────────────────────────────────────────────────

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) * this.timeScale;
    State.playTimeMs += delta;
    this.keys.update();

    const grid = this.collisionGrid();

    if (this.cutscene.active) {
      this.cutscene.update(dt);
      this.player.update(dt, this.keys, grid);
    } else {
      if (this.keys.justPressed('journal')) { emit('ui:toggleJournal', {}); }
      if (this.keys.justPressed('observe') && State.hasAbility('observe')) this.tryObserve();
      this.player.update(dt, this.keys, grid);
      this.interactions.update(dt);
    }

    for (const n of this.npcs) n.update(dt, grid);
    this.mote?.update(dt, this.player);
    this.enemies.update(dt, grid);
    this.cues.update();
    this.fx.update(dt);
    this.lighting.update(dt);

    // Water tiles cycle on their own clock so every map animates identically.
    if (this.world.waterAnim) {
      this.waterTimer += dt;
      const period = 1000 / this.world.waterAnim.frameRate;
      if (this.waterTimer >= period) {
        this.waterTimer -= period;
        this.waterFrame = (this.waterFrame + 1) % this.world.waterAnim.frames.length;
        stepWaterFrame(this.world, this.waterFrame);
      }
    }

    this.checkZones();
    this.area?.onUpdate?.(this, dt);
  }

  // ── zones ────────────────────────────────────────────────────────────────

  private checkZones(): void {
    if (this.transitioning || this.cutscene.active) return;
    const tx = this.player.tileX;
    const ty = this.player.tileY;
    for (const z of this.world.def.zones ?? []) {
      if (z.kind !== 'door' && z.kind !== 'trigger') continue;
      if (tx < z.x || tx >= z.x + z.w || ty < z.y || ty >= z.y + z.h) continue;
      if (z.requires && !State.has(z.requires)) continue;
      if (z.forbids && State.has(z.forbids)) continue;
      if (!z.repeat && this.firedTriggers.has(z.id)) continue;

      if (z.kind === 'door' && z.to) {
        this.firedTriggers.add(z.id);
        Audio.sfx('door');
        this.changeMap(z.to, z.spawn ?? 'default', z.facing);
        return;
      }
      const handled = this.area?.onTrigger?.(this, z.id, z.data);
      this.firedTriggers.add(z.id);
      if (handled) return;
      emit('zone:trigger', { id: z.id, data: z.data });
    }
  }

  /** Let an area script re-arm a one-shot trigger. */
  resetTrigger(id: string): void {
    this.firedTriggers.delete(id);
  }

  zone(id: string): Zone | undefined {
    return this.world.def.zones?.find((z) => z.id === id);
  }

  // ── abilities ────────────────────────────────────────────────────────────

  private tryObserve(): void {
    if (this.time.now < this.observeReadyAt) return;
    this.observeReadyAt = this.time.now + 900;
    Audio.sfx('observe');
    this.fx.observePing(this.player.x, this.player.y - 10);
    this.cameras.main.zoomTo(1.03, 140, 'Sine.easeOut', true);
    this.time.delayedCall(180, () => this.cameras.main.zoomTo(1, 220, 'Sine.easeInOut', true));
    const marks = this.interactions.observables(this.player.x, this.player.y, 118);
    marks.forEach((m, i) => {
      this.time.delayedCall(60 + i * 55, () => this.fx.observeMark(m.x, m.y));
    });
    emit('observe:used', { count: marks.length });
  }

  // ── helpers used by area scripts ─────────────────────────────────────────

  npc(id: string): Npc | undefined {
    return this.npcs.find((n) => n.id === id);
  }

  spawnNpc(cfg: ConstructorParameters<typeof Npc>[1]): Npc {
    const n = new Npc(this, cfg);
    this.npcs.push(n);
    return n;
  }

  removeNpc(id: string): void {
    const i = this.npcs.findIndex((n) => n.id === id);
    if (i >= 0) { this.npcs[i].destroy(); this.npcs.splice(i, 1); }
  }

  addInteractable(i: Interactable): void {
    this.interactions.add(i);
  }

  prop(id: string) {
    return this.world.props.find((p) => p.id === id);
  }

  shake(intensity = 0.004, duration = 160): void {
    this.cameras.main.shake(duration, intensity);
  }

  flash(color = 0xffffff, duration = 120): void {
    const c = Phaser.Display.Color.IntegerToRGB(color);
    this.cameras.main.flash(duration, c.r, c.g, c.b);
  }

  /** Slow motion for impact moments. 1 = normal. */
  setTimeScale(v: number, restoreAfterMs?: number): void {
    this.timeScale = v;
    if (restoreAfterMs) this.time.delayedCall(restoreAfterMs, () => { this.timeScale = 1; });
  }

  /** Screen-space position of a world point (for UI anchoring). */
  toScreen(x: number, y: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return { x: (x - cam.worldView.x) * cam.zoom, y: (y - cam.worldView.y) * cam.zoom };
  }

  get viewCentre(): { x: number; y: number } {
    const v = this.cameras.main.worldView;
    return { x: v.centerX, y: v.centerY };
  }
}

export { GAME_W, GAME_H, DEPTH };
