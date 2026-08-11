/**
 * Runtime view over the generated art manifest (public/assets/art.json).
 *
 * Everything the game asks for is by *name*, never by raw tileset index, so
 * the art build is free to reorder tiles between runs.
 */

export interface ArtManifest {
  tileset: {
    image: string;
    tileWidth: number;
    tileHeight: number;
    margin: number;
    spacing: number;
    columns: number;
    count: number;
    index: Record<string, number>;
  };
  blobs: Record<string, number[]>;
  blobFrames: Record<string, { frames: number[][]; frameRate: number }>;
  tileAnims: Record<string, { frames: number[]; frameRate: number }>;
  anims: Array<{ key: string; frames: string[]; frameRate: number; repeat: number }>;
}

let manifest: ArtManifest;
/**
 * Tile families, keyed by their FULL path minus the variant suffix:
 *   'tile/town/grass_3'  -> family 'tile/town/grass'
 *   'tile/woods/grass_1' -> family 'tile/woods/grass'
 *
 * Keying by leaf name alone silently merges `town/grass` with `woods/grass`,
 * which paints half a field in the wrong biome's colours. Short aliases
 * ('town/grass', and bare 'grass' when unambiguous) are registered too, so map
 * authors can write the shortest form that is unique.
 */
const families = new Map<string, number[]>();
const aliases = new Map<string, string>();

export function initArt(m: ArtManifest): void {
  manifest = m;
  families.clear();
  aliases.clear();

  for (const name of Object.keys(m.tileset.index)) {
    const fam = name.replace(/_\d+$/, '');
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(m.tileset.index[name]);
  }
  for (const list of families.values()) list.sort((a, b) => a - b);

  // Build shorter aliases, dropping any that would be ambiguous.
  const claims = new Map<string, string[]>();
  for (const fam of families.keys()) {
    const parts = fam.split('/');
    for (let i = 1; i < parts.length; i++) {
      const short = parts.slice(i).join('/');
      if (!claims.has(short)) claims.set(short, []);
      claims.get(short)!.push(fam);
    }
  }
  for (const [short, owners] of claims) {
    if (owners.length === 1 && !families.has(short)) aliases.set(short, owners[0]);
  }
}

function resolveFamily(fam: string): string | undefined {
  if (families.has(fam)) return fam;
  return aliases.get(fam);
}

export function art(): ArtManifest {
  if (!manifest) throw new Error('art manifest not initialised');
  return manifest;
}

export function tileIndex(name: string): number {
  const i = manifest.tileset.index[name];
  if (i === undefined) throw new Error(`unknown tile '${name}'`);
  return i;
}

export function hasTile(name: string): boolean {
  return manifest.tileset.index[name] !== undefined;
}

/** All tiles in a family, e.g. familyTiles('tile/town/grass') or 'town/grass'. */
export function familyTiles(fam: string): number[] {
  const key = resolveFamily(fam);
  if (!key) {
    const candidates = [...families.keys()].filter((k) => k.includes(fam.split('/').pop()!));
    throw new Error(
      `unknown tile family '${fam}'` +
      (candidates.length ? ` — did you mean: ${candidates.slice(0, 6).join(', ')}?` : ''),
    );
  }
  return families.get(key)!;
}

export function hasFamily(fam: string): boolean {
  return !!resolveFamily(fam);
}

/** Every registered family name — used by the art-coverage QA report. */
export function allFamilies(): string[] {
  return [...families.keys()];
}

/** Deterministic, spatially-hashed variant pick — stable across reloads. */
export function variantAt(fam: string, x: number, y: number, salt = 0): number {
  const list = familyTiles(fam);
  let n = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = (n ^ (n >>> 16)) >>> 0;
  return list[n % list.length];
}

export function hash01(x: number, y: number, salt = 0): number {
  let n = (x * 2654435761 + y * 1597334677 + salt * 3266489917) | 0;
  n = (n ^ (n >>> 15)) * 2246822519;
  n = (n ^ (n >>> 13)) * 3266489917;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function blobTable(name: string): number[] {
  const t = manifest.blobs[`blob/${name}`] ?? manifest.blobs[name];
  if (!t) throw new Error(`unknown blob set '${name}'`);
  return t;
}

export function blobAnimation(name: string): { frames: number[][]; frameRate: number } | undefined {
  return manifest.blobFrames[`blob/${name}`] ?? manifest.blobFrames[name];
}
