/**
 * Frame existence checks.
 *
 * `scene.textures.getFrame(key, name)` does NOT return null for an unknown
 * frame — it falls back to the texture's `__BASE` frame, i.e. the entire atlas.
 * Using it as an existence test therefore silently draws a 2048px sheet into
 * the scene. Always use `hasFrame`.
 */
import type Phaser from 'phaser';

export function hasFrame(scene: Phaser.Scene, name: string, texture = 'atlas'): boolean {
  if (!scene.textures.exists(texture)) return false;
  return scene.textures.get(texture).has(name);
}

/** First existing frame from a list, or null. */
export function firstFrame(scene: Phaser.Scene, names: string[], texture = 'atlas'): string | null {
  for (const n of names) if (hasFrame(scene, n, texture)) return n;
  return null;
}

/** `base_0`..`base_<max-1>` if any exist, else `base`, else null. */
export function frameSeries(scene: Phaser.Scene, base: string, max = 8, texture = 'atlas'): string | null {
  for (let i = 0; i < max; i++) {
    const n = `${base}_${i}`;
    if (hasFrame(scene, n, texture)) return n;
  }
  return hasFrame(scene, base, texture) ? base : null;
}
