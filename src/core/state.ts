/**
 * Global game state: flags, quests, abilities, journal.
 *
 * One mutable singleton, saved to localStorage. Everything that gates content
 * reads flags — never scene-local booleans — so the debug harness can jump the
 * game to any point by setting flags and reloading a map.
 */
import { SAVE_KEY, PLAYER } from './config';
import { emit } from './events';

export type Ability = 'observe' | 'link' | 'recall' | 'dissent';

export interface QuestStep {
  id: string;
  text: string;
  done: boolean;
}

export interface QuestState {
  id: string;
  title: string;
  giver: string;
  steps: QuestStep[];
  active: boolean;
  complete: boolean;
  /** Order in the journal. */
  order: number;
}

export interface InsightState {
  id: string;
  unlocked: boolean;
  /** Examples the player has personally witnessed. */
  examples: string[];
}

export interface PersonState {
  id: string;
  met: boolean;
  /** Extra note lines revealed by story beats. */
  notes: string[];
}

export interface PlayerAppearance {
  name: string;
  skin: string;
  hair: string;
  hairStyle: string;
  cloth: string;
}

export interface SaveData {
  version: 1;
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  abilities: Ability[];
  quests: Record<string, { active: boolean; complete: boolean; steps: Record<string, boolean> }>;
  insights: Record<string, InsightState>;
  people: Record<string, PersonState>;
  appearance: PlayerAppearance;
  hp: number;
  maxHp: number;
  map: string;
  spawn: string;
  playTimeMs: number;
  visited: string[];
}

class GameState {
  flags: Record<string, boolean> = {};
  counters: Record<string, number> = {};
  abilities = new Set<Ability>();
  quests: Record<string, QuestState> = {};
  insights: Record<string, InsightState> = {};
  people: Record<string, PersonState> = {};
  appearance: PlayerAppearance = {
    name: 'Wren',
    skin: 'warm',
    hair: 'auburn',
    hairStyle: 'short',
    cloth: 'player',
  };
  hp = PLAYER.MAX_HP;
  maxHp = PLAYER.MAX_HP;
  currentMap = 'lumen_vale';
  currentSpawn = 'arrival';
  playTimeMs = 0;
  visited = new Set<string>();

  // ── flags ────────────────────────────────────────────────────────────────
  has(flag: string): boolean {
    return !!this.flags[flag];
  }

  set(flag: string, value = true): void {
    if (!!this.flags[flag] === value) return;
    this.flags[flag] = value;
    emit('flag', { flag, value });
  }

  /** Set several flags at once without firing duplicate work. */
  setAll(flags: string[]): void {
    for (const f of flags) this.set(f);
  }

  count(key: string): number {
    return this.counters[key] ?? 0;
  }

  bump(key: string, by = 1): number {
    this.counters[key] = (this.counters[key] ?? 0) + by;
    emit('counter', { key, value: this.counters[key] });
    return this.counters[key];
  }

  // ── abilities ────────────────────────────────────────────────────────────
  hasAbility(a: Ability): boolean {
    return this.abilities.has(a);
  }

  grant(a: Ability): void {
    if (this.abilities.has(a)) return;
    this.abilities.add(a);
    emit('ability', { ability: a });
  }

  // ── quests ───────────────────────────────────────────────────────────────
  registerQuest(q: Omit<QuestState, 'active' | 'complete'> & Partial<Pick<QuestState, 'active' | 'complete'>>): void {
    if (this.quests[q.id]) return;
    this.quests[q.id] = {
      active: false,
      complete: false,
      ...q,
      steps: q.steps.map((s) => ({ ...s })),
    };
  }

  startQuest(id: string): void {
    const q = this.quests[id];
    if (!q || q.active || q.complete) return;
    q.active = true;
    emit('quest', { id, kind: 'start' });
  }

  advanceQuest(id: string, stepId: string): void {
    const q = this.quests[id];
    if (!q) return;
    const step = q.steps.find((s) => s.id === stepId);
    if (!step || step.done) return;
    step.done = true;
    emit('quest', { id, kind: 'step', step: stepId });
  }

  completeQuest(id: string): void {
    const q = this.quests[id];
    if (!q || q.complete) return;
    q.steps.forEach((s) => { s.done = true; });
    q.active = false;
    q.complete = true;
    emit('quest', { id, kind: 'complete' });
  }

  activeQuests(): QuestState[] {
    return Object.values(this.quests).filter((q) => q.active).sort((a, b) => a.order - b.order);
  }

  currentObjective(): string | null {
    const q = this.activeQuests()[0];
    if (!q) return null;
    const step = q.steps.find((s) => !s.done);
    return step ? step.text : null;
  }

  // ── insights ─────────────────────────────────────────────────────────────
  unlockInsight(id: string): void {
    const cur = this.insights[id] ?? { id, unlocked: false, examples: [] };
    if (cur.unlocked) return;
    cur.unlocked = true;
    this.insights[id] = cur;
    emit('insight', { id });
  }

  addInsightExample(id: string, text: string): void {
    const cur = this.insights[id] ?? { id, unlocked: false, examples: [] };
    if (!cur.examples.includes(text)) cur.examples.push(text);
    this.insights[id] = cur;
  }

  insightUnlocked(id: string): boolean {
    return !!this.insights[id]?.unlocked;
  }

  // ── people ───────────────────────────────────────────────────────────────
  meet(id: string): void {
    const p = this.people[id] ?? { id, met: false, notes: [] };
    if (!p.met) { p.met = true; emit('person', { id }); }
    this.people[id] = p;
  }

  addNote(id: string, note: string): void {
    const p = this.people[id] ?? { id, met: true, notes: [] };
    if (!p.notes.includes(note)) p.notes.push(note);
    this.people[id] = p;
  }

  // ── persistence ──────────────────────────────────────────────────────────
  toJSON(): SaveData {
    const quests: SaveData['quests'] = {};
    for (const [id, q] of Object.entries(this.quests)) {
      quests[id] = {
        active: q.active,
        complete: q.complete,
        steps: Object.fromEntries(q.steps.map((s) => [s.id, s.done])),
      };
    }
    return {
      version: 1,
      flags: { ...this.flags },
      counters: { ...this.counters },
      abilities: [...this.abilities],
      quests,
      insights: JSON.parse(JSON.stringify(this.insights)),
      people: JSON.parse(JSON.stringify(this.people)),
      appearance: { ...this.appearance },
      hp: this.hp,
      maxHp: this.maxHp,
      map: this.currentMap,
      spawn: this.currentSpawn,
      playTimeMs: this.playTimeMs,
      visited: [...this.visited],
    };
  }

  loadJSON(d: SaveData): void {
    this.flags = { ...d.flags };
    this.counters = { ...d.counters };
    this.abilities = new Set(d.abilities);
    for (const [id, q] of Object.entries(d.quests)) {
      const target = this.quests[id];
      if (!target) continue;
      target.active = q.active;
      target.complete = q.complete;
      target.steps.forEach((s) => { s.done = !!q.steps[s.id]; });
    }
    this.insights = JSON.parse(JSON.stringify(d.insights));
    this.people = JSON.parse(JSON.stringify(d.people));
    this.appearance = { ...d.appearance };
    this.hp = d.hp;
    this.maxHp = d.maxHp;
    this.currentMap = d.map;
    this.currentSpawn = d.spawn;
    this.playTimeMs = d.playTimeMs;
    this.visited = new Set(d.visited);
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.toJSON()));
      emit('saved', {});
    } catch { /* private browsing, quota — never break the game over a save */ }
  }

  load(): boolean {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as SaveData;
      if (data.version !== 1) return false;
      this.loadJSON(data);
      return true;
    } catch {
      return false;
    }
  }

  static hasSave(): boolean {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  clearSave(): void {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  }

  /** Reset to a brand-new game while keeping registered quest definitions. */
  reset(): void {
    this.flags = {};
    this.counters = {};
    this.abilities = new Set();
    for (const q of Object.values(this.quests)) {
      q.active = false;
      q.complete = false;
      q.steps.forEach((s) => { s.done = false; });
    }
    this.insights = {};
    this.people = {};
    this.hp = this.maxHp = PLAYER.MAX_HP;
    this.currentMap = 'lumen_vale';
    this.currentSpawn = 'arrival';
    this.playTimeMs = 0;
    this.visited = new Set();
  }
}

export const State = new GameState();
export { GameState };
