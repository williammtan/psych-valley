/**
 * Art build: runs every asset module, packs the results, writes them into
 * public/assets, and emits inspection sheets into art_preview/ so visual
 * critics can look at the raw art without launching the game.
 *
 *   npm run art
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtBuild, packTileset, packAtlas, atlasJSON } from './lib/registry.js';
import { guaranteeFrames } from './lib/guarantee.js';
import { Surface, upscale } from './lib/pixel.js';
import { encodePNG } from './lib/png.js';


const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, 'public', 'assets');
const PREVIEW = join(ROOT, 'art_preview');

function writePNG(path: string, s: Surface) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(s.w, s.h, s.data));
}

const build = new ArtBuild();

/**
 * Modules are imported one at a time rather than statically.
 *
 * Several people work on different asset modules simultaneously, so at any
 * moment one file may be mid-edit and fail to parse. A static import graph
 * makes that one broken file break everyone's build; a dynamic import lets the
 * pipeline skip it, report it loudly, and still produce usable assets.
 */
const MODULE_ORDER = [
  'terrain', 'woods', 'shrine', 'buildings', 'interiors', 'props',
  'festival', 'characters', 'enemies', 'fx', 'ui',
] as const;

const REGISTER_NAME: Record<string, string> = {
  terrain: 'registerTerrain', woods: 'registerWoods', shrine: 'registerShrine',
  buildings: 'registerBuildings', interiors: 'registerInteriors', props: 'registerProps',
  festival: 'registerFestival', characters: 'registerCharacters', enemies: 'registerEnemies',
  fx: 'registerFx', ui: 'registerUI',
};

const t0 = Date.now();
const failed: Array<[string, string]> = [];

for (const name of MODULE_ORDER) {
  const before = { t: build.tiles.length, s: build.sprites.length };
  try {
    const mod = await import(`./assets/${name}.js`) as Record<string, (b: ArtBuild) => void>;
    const fn = mod[REGISTER_NAME[name]];
    if (typeof fn !== 'function') throw new Error(`missing export ${REGISTER_NAME[name]}`);
    fn(build);
    console.log(
      `  ${name.padEnd(12)} +${String(build.tiles.length - before.t).padStart(4)} tiles  ` +
      `+${String(build.sprites.length - before.s).padStart(4)} sprites`,
    );
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0].slice(0, 160);
    failed.push([name, msg]);
    console.log(`  ${name.padEnd(12)} ✗ SKIPPED — ${msg}`);
  }
}

const stubbed = guaranteeFrames(build);
if (stubbed.length) {
  console.log(`\n  ⚠ ${stubbed.length} required frame(s) stubbed with placeholders:`);
  console.log(`    ${stubbed.join(', ')}`);
}

// ── Tileset ────────────────────────────────────────────────────────────────
const tileset = packTileset(build.tiles);
writePNG(join(OUT, 'tiles.png'), tileset.surface);

const tileIndex: Record<string, number> = {};
build.tileIndex.forEach((v, k) => { tileIndex[k] = v; });

// ── Atlas ──────────────────────────────────────────────────────────────────
const atlas = packAtlas(build.sprites);
writePNG(join(OUT, 'atlas.png'), atlas.surface);
writeFileSync(
  join(OUT, 'atlas.json'),
  JSON.stringify(atlasJSON(atlas.frames, 'atlas.png', { width: atlas.width, height: atlas.height })),
);

// ── Manifest consumed by the runtime ───────────────────────────────────────
writeFileSync(
  join(OUT, 'art.json'),
  JSON.stringify({
    tileset: {
      image: 'tiles.png',
      tileWidth: tileset.tileWidth,
      tileHeight: tileset.tileHeight,
      margin: tileset.margin,
      spacing: tileset.spacing,
      columns: tileset.columns,
      count: build.tiles.length,
      index: tileIndex,
    },
    blobs: build.blobs,
    blobFrames: build.blobFrames,
    tileAnims: build.tileAnims,
    anims: build.anims,
    stubbed,
  }, null, 0),
);

// ── Inspection sheets (4x nearest upscale, grouped by top-level folder) ─────
if (existsSync(PREVIEW)) rmSync(PREVIEW, { recursive: true, force: true });

function sheet(items: { name: string; s: Surface }[], title: string, cols = 12) {
  if (!items.length) return;
  const scale = 4;
  const cellW = Math.max(...items.map((i) => i.s.w)) * scale + 8;
  const cellH = Math.max(...items.map((i) => i.s.h)) * scale + 8;
  const rows = Math.ceil(items.length / cols);
  const out = new Surface(cols * cellW, rows * cellH, '#12101a');
  items.forEach((it, i) => {
    const x = (i % cols) * cellW + 4;
    const y = Math.floor(i / cols) * cellH + 4;
    // checker so transparency is visible
    for (let j = 0; j < it.s.h * scale; j += 8) {
      for (let k = 0; k < it.s.w * scale; k += 8) {
        out.rect(x + k, y + j, 8, 8, ((j + k) / 8) % 2 ? '#26223a' : '#1c1930');
      }
    }
    out.blit(upscale(it.s, scale), x, y);
  });
  writePNG(join(PREVIEW, `${title}.png`), out);
}

const groups = new Map<string, { name: string; s: Surface }[]>();
for (const sp of build.sprites) {
  // 3+ segments group by their first two ('char/sera/...' -> char_sera);
  // 2-segment names group by their first ('fx/dust_0' -> fx), otherwise every
  // effect gets its own one-item sheet.
  const parts = sp.name.split('/');
  const g = parts.length >= 3 ? parts.slice(0, 2).join('_') : parts[0];
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g)!.push(sp);
}
for (const [g, items] of groups) sheet(items, `sprite_${g}`, items.length > 40 ? 16 : 8);
sheet(build.tiles, 'tiles_all', 24);

if (failed.length) {
  console.log(`\n  ⚠ ${failed.length} module(s) failed to load and were skipped:`);
  for (const [n, m] of failed) console.log(`    ${n}: ${m}`);
}

console.log(
  `\n  tileset ${tileset.surface.w}x${tileset.surface.h} (${build.tiles.length} tiles)` +
  `\n  atlas   ${atlas.width}x${atlas.height} (${build.sprites.length} sprites, ${build.anims.length} anims)` +
  `\n  done in ${Date.now() - t0}ms\n`,
);
