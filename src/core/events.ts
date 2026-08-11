/**
 * Tiny global event bus. Used for cross-scene messaging (world → HUD, quests →
 * journal) so scenes never hold references to each other.
 */

type Handler = (payload: any) => void;

const handlers = new Map<string, Set<Handler>>();

export function on(event: string, fn: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event)!.add(fn);
  return () => off(event, fn);
}

export function once(event: string, fn: Handler): () => void {
  const wrapped = (p: any) => { off(event, wrapped); fn(p); };
  return on(event, wrapped);
}

export function off(event: string, fn: Handler): void {
  handlers.get(event)?.delete(fn);
}

export function emit(event: string, payload: any = {}): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(payload); } catch (e) { console.error(`event handler for '${event}' threw`, e); }
  }
}

export function clearAll(): void {
  handlers.clear();
}
