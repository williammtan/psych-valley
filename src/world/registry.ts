/**
 * Map + area-script registry.
 *
 * WorldScene knows nothing about specific places. Each area registers a MapDef
 * and (optionally) an AreaScript that owns its cutscenes, quest logic and
 * bespoke interactions. This is what lets several people build Lumen Vale, the
 * inn, the woods and the shrine in parallel without touching the same file.
 */
import type { MapDef } from './types';
import type { WorldScene } from '@/scenes/WorldScene';

export interface AreaScript {
  /** Runs after the map is built and the player is placed. */
  onEnter?(w: WorldScene): void;
  /** Runs every frame while this map is active. */
  onUpdate?(w: WorldScene, dt: number): void;
  /**
   * Called when the player interacts with something carrying this id.
   * Return true if handled.
   */
  onInteract?(w: WorldScene, id: string): boolean;
  /** Called when the player enters a trigger zone. Return true if handled. */
  onTrigger?(w: WorldScene, id: string, data?: Record<string, unknown>): boolean;
  /** Called before the map is torn down. */
  onExit?(w: WorldScene): void;
}

const maps = new Map<string, () => MapDef>();
const scripts = new Map<string, AreaScript>();

export function registerMap(id: string, factory: () => MapDef): void {
  maps.set(id, factory);
}

export function registerArea(id: string, script: AreaScript): void {
  const existing = scripts.get(id);
  if (!existing) {
    scripts.set(id, script);
    return;
  }
  // Compose, so a quest module and an area module can both hook one map.
  scripts.set(id, {
    onEnter: (w) => { existing.onEnter?.(w); script.onEnter?.(w); },
    onUpdate: (w, dt) => { existing.onUpdate?.(w, dt); script.onUpdate?.(w, dt); },
    onInteract: (w, i) => existing.onInteract?.(w, i) || script.onInteract?.(w, i) || false,
    onTrigger: (w, i, d) => existing.onTrigger?.(w, i, d) || script.onTrigger?.(w, i, d) || false,
    onExit: (w) => { existing.onExit?.(w); script.onExit?.(w); },
  });
}

export function getMap(id: string): MapDef {
  const f = maps.get(id);
  if (!f) throw new Error(`no map registered with id '${id}' (have: ${[...maps.keys()].join(', ')})`);
  return f();
}

export function hasMap(id: string): boolean {
  return maps.has(id);
}

export function getArea(id: string): AreaScript | undefined {
  return scripts.get(id);
}

export function allMapIds(): string[] {
  return [...maps.keys()];
}
