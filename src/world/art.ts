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
/** family name -> tile indices, e.g. 'grass' -> [0,1,2,3,4,5] */
const families = new Map<string, number[]>();

export function initArt(m: ArtManifest): void {
  manifest = m;
  families.clear();
  for (const name of Object.keys(m.tileset.index)) {
    // 'tile/town/grass_3' -> family 'grass'; 'tile/scatter/flower_gold_1' -> 'flower_gold'
    const leaf = name.split('/').pop()!;
    const fam = leaf.replace(/_\d+$/, '');
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push(m.tileset.index[name]);
  }
  for (const list of families.values()) list.sort((a, b) => a - b);
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

/** All tiles in a family, e.g. familyTiles('grass'). */
export function familyTiles(fam: string): number[] {
  const list = families.get(fam);
  if (!list) throw new Error(`unknown tile family '${fam}'`);
  return list;
}

export function hasFamily(fam: string): boolean {
  return families.has(fam);
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
