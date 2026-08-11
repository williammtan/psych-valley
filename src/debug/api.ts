/**
 * Debug / QA API exposed on `window.__psyche`.
 *
 * The gauntlet depends on this: critics and the automated play harness drive
 * the real game through it rather than screenshotting a menu and hoping. Every
 * gate in the game is a flag, so any point in the 40-minute slice is reachable
 * in one call.
 */
import { State } from '@/core/state';
import { emit } from '@/core/events';
import { allMapIds } from '@/world/registry';
import type { WorldScene } from '@/scenes/WorldScene';
import type { Action } from '@/core/input';

export interface PsycheDebug {
  scene: WorldScene;
  goto(map: string, spawn?: string): void;
  teleport(tileX: number, tileY: number): void;
  setFlag(flag: string, value?: boolean): void;
  flags(): Record<string, boolean>;
  grant(ability: 'observe' | 'link' | 'recall' | 'dissent'): void;
  jump(checkpoint: string): void;
  checkpoints(): string[];
  maps(): string[];
  state(): Record<string, unknown>;
  hold(action: Action | 'up' | 'down' | 'left' | 'right', ms: number): void;
  press(action: Action): void;
  move(x: number, y: number): void;
  stop(): void;
  settle(): Promise<void>;
  hideHud(hidden: boolean): void;
  hp(n: number): void;
  spawnEnemy(kind: string, tx: number, ty: number): void;
  ready: boolean;
}

/**
 * Named jump points across the golden path. Each sets exactly the flags a
 * player would have at that moment, so a critic can inspect any beat from a
 * fresh page load.
 */
export const CHECKPOINTS: Record<string, { map: string; spawn?: string; flags: string[]; abilities?: string[] }> = {
  arrival: { map: 'lumen_vale', spawn: 'arrival', flags: [] },
  town: { map: 'lumen_vale', spawn: 'default', flags: ['met_mira', 'intro_done'] },
  inn: { map: 'inn', spawn: 'default', flags: ['met_mira', 'intro_done'] },
  q1_start: { map: 'inn', spawn: 'default', flags: ['met_mira', 'intro_done', 'bell_rang', 'q1_started'] },
  q1_done: {
    map: 'lumen_vale', spawn: 'inn_door',
    flags: ['met_mira', 'intro_done', 'bell_rang', 'q1_started', 'q1_complete', 'met_sera', 'insight_conditioning'],
    abilities: ['observe', 'link'],
  },
  q2_start: {
    map: 'lumen_vale', spawn: 'default',
    flags: ['q1_complete', 'insight_conditioning', 'q2_started', 'met_oren'],
    abilities: ['observe', 'link'],
  },
  courier: {
    map: 'courier', spawn: 'default',
    flags: ['q1_complete', 'insight_conditioning', 'q2_started', 'met_oren'],
    abilities: ['observe', 'link'],
  },
  q2_done: {
    map: 'lumen_vale', spawn: 'default',
    flags: ['q1_complete', 'q2_complete', 'insight_conditioning', 'insight_interference'],
    abilities: ['observe', 'link', 'recall'],
  },
  festival: {
    map: 'festival', spawn: 'default',
    flags: ['q1_complete', 'q2_complete', 'insight_conditioning', 'insight_interference', 'festival_started', 'q3_started'],
    abilities: ['observe', 'link', 'recall'],
  },
  q3_done: {
    map: 'lumen_vale', spawn: 'default',
    flags: ['q1_complete', 'q2_complete', 'q3_complete', 'insight_conditioning', 'insight_interference', 'insight_conformity', 'festival_started', 'south_gate_open'],
    abilities: ['observe', 'link', 'recall', 'dissent'],
  },
  woods: {
    map: 'woods', spawn: 'default',
    flags: ['q1_complete', 'q2_complete', 'q3_complete', 'insight_conditioning', 'insight_interference', 'insight_conformity', 'south_gate_open'],
    abilities: ['observe', 'link', 'recall', 'dissent'],
  },
  shrine: {
    map: 'shrine_entrance', spawn: 'default',
    flags: ['q1_complete', 'q2_complete', 'q3_complete', 'insight_conditioning', 'insight_interference', 'insight_conformity', 'south_gate_open', 'woods_cleared'],
    abilities: ['observe', 'link', 'recall', 'dissent'],
  },
  shrine_association: { map: 'shrine_association', flags: ['all_quests'], abilities: ['observe', 'link', 'recall', 'dissent'] },
  shrine_combat: { map: 'shrine_combat', flags: ['all_quests', 'shrine_r1_done'], abilities: ['observe', 'link', 'recall', 'dissent'] },
  shrine_memory: { map: 'shrine_memory', flags: ['all_quests', 'shrine_r1_done', 'shrine_r2_done'], abilities: ['observe', 'link', 'recall', 'dissent'] },
  shrine_conformity: { map: 'shrine_conformity', flags: ['all_quests', 'shrine_r1_done', 'shrine_r2_done', 'shrine_r3_done'], abilities: ['observe', 'link', 'recall', 'dissent'] },
  shrine_combination: { map: 'shrine_combination', flags: ['all_quests', 'shrine_r1_done', 'shrine_r2_done', 'shrine_r3_done', 'shrine_r4_done'], abilities: ['observe', 'link', 'recall', 'dissent'] },
  boss: { map: 'shrine_boss', flags: ['all_quests', 'shrine_r1_done', 'shrine_r2_done', 'shrine_r3_done', 'shrine_r4_done', 'shrine_r5_done'], abilities: ['observe', 'link', 'recall', 'dissent'] },
};

/** Story flag -> the quest it completes, so a jump leaves a coherent journal. */
const QUEST_FOR_FLAG: Record<string, string> = {
  q1_complete: 'q1_pip',
  q2_complete: 'q2_oren',
  q3_complete: 'q3_lanterns',
  game_complete: 'q4_shrine',
};

/** Story flag -> people the player must have met by then. */
const PEOPLE_FOR_FLAG: Record<string, string[]> = {
  intro_done: ['mira'],
  q1_complete: ['mira', 'pip', 'sera'],
  q2_complete: ['mira', 'pip', 'sera', 'oren'],
  q3_complete: ['mira', 'pip', 'sera', 'oren', 'tavi', 'nia', 'elia'],
};

const ALL_QUEST_FLAGS = [
  'met_mira', 'intro_done', 'bell_rang', 'q1_started', 'q1_complete', 'met_sera',
  'q2_started', 'met_oren', 'q2_complete', 'festival_started', 'q3_started', 'q3_complete',
  'insight_conditioning', 'insight_interference', 'insight_conformity', 'south_gate_open',
];

export function installDebugApi(scene: WorldScene): void {
  const applyFlags = (flags: string[]) => {
    const all: string[] = [];
    for (const f of flags) {
      if (f === 'all_quests') { State.setAll(ALL_QUEST_FLAGS); all.push(...ALL_QUEST_FLAGS); continue; }
      State.set(f);
      all.push(f);
    }
    // Bring the derived state in line with the flags, so the journal, the
    // objective line and the People tab all read as they would in real play.
    for (const f of all) {
      const q = QUEST_FOR_FLAG[f];
      if (q) { State.startQuest(q); State.completeQuest(q); }
      for (const person of PEOPLE_FOR_FLAG[f] ?? []) State.meet(person);
    }
    for (const [flag, concept] of [['insight_conditioning', 'conditioning'],
                                   ['insight_interference', 'interference'],
                                   ['insight_conformity', 'conformity']] as const) {
      if (all.includes(flag)) State.unlockInsight(concept);
    }
  };

  const api: PsycheDebug = {
    scene,
    ready: true,
    goto(map, spawn = 'default') {
      scene.changeMap(map, spawn, undefined, true);
    },
    teleport(tileX, tileY) {
      scene.player.setPosition(tileX * 16 + 8, tileY * 16 + 16);
      scene.player.ensureUnstuck();
      scene.cameras.main.centerOn(scene.player.x, scene.player.y);
    },
    setFlag(flag, value = true) {
      State.set(flag, value);
    },
    flags() {
      return { ...State.flags };
    },
    grant(a) {
      State.grant(a);
    },
    jump(checkpoint) {
      const c = CHECKPOINTS[checkpoint];
      if (!c) { console.warn(`unknown checkpoint '${checkpoint}'`); return; }
      State.reset();
      applyFlags(c.flags);
      for (const a of c.abilities ?? []) State.grant(a as 'observe');
      scene.changeMap(c.map, c.spawn ?? 'default', undefined, true);
    },
    checkpoints() { return Object.keys(CHECKPOINTS); },
    maps() { return allMapIds(); },
    state() {
      return {
        map: scene.mapId,
        player: { x: scene.player.x, y: scene.player.y, tx: scene.player.tileX, ty: scene.player.tileY, dir: scene.player.dir },
        hp: State.hp,
        abilities: [...State.abilities],
        flags: Object.keys(State.flags).filter((k) => State.flags[k]),
        quests: Object.values(State.quests).map((q) => ({ id: q.id, active: q.active, complete: q.complete })),
        objective: State.currentObjective(),
        enemies: scene.enemies.aliveCount,
        npcs: scene.npcs.map((n) => n.id),
        cutscene: scene.cutscene.active,
        missingArt: (window as unknown as { __missingArt?: string[] }).__missingArt ?? [],
      };
    },
    hold(action, ms) {
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
        const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[action];
        this.move(v[0], v[1]);
        setTimeout(() => this.stop(), ms);
        return;
      }
      this.press(action);
    },
    press(action) {
      scene.keys.inject(action);
    },
    move(x, y) {
      if (!scene.keys.scripted) scene.keys.scripted = { axis: { x: 0, y: 0 }, actions: new Set() };
      const len = Math.hypot(x, y) || 1;
      scene.keys.scripted.axis = { x: len > 1 ? x / len : x, y: len > 1 ? y / len : y };
    },
    stop() {
      if (scene.keys.scripted) scene.keys.scripted.axis = { x: 0, y: 0 };
      scene.keys.scripted = null;
    },
    settle() {
      return new Promise((resolve) => setTimeout(resolve, 350));
    },
    hideHud(hidden) {
      emit('ui:setHidden', { hidden });
    },
    hp(n) {
      State.hp = Math.max(0, Math.min(State.maxHp, n));
      emit('player:heal', { hp: State.hp });
    },
    spawnEnemy(kind, tx, ty) {
      scene.enemies.spawn(kind as 'bramble', tx, ty);
    },
  };

  (window as unknown as { __psyche: PsycheDebug }).__psyche = api;
}
