/** Renders a field of grass tiles exactly as the runtime would place them. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { Surface, upscale } from './lib/pixel.js';
import { encodePNG } from './lib/png.js';
import { ArtBuild, TILE } from './lib/registry.js';
import { registerTerrain } from './assets/terrain.js';

const b = new ArtBuild();
registerTerrain(b);
const grass = b.tiles.filter((t) => /tile\/town\/grass_\d+$/.test(t.name));
console.log('grass variants:', grass.map((g) => g.name).join(', '));

// average luminance per variant
for (const g of grass) {
  let sum = 0;
  for (let i = 0; i < TILE * TILE; i++) {
    sum += 0.299 * g.s.data[i * 4] + 0.587 * g.s.data[i * 4 + 1] + 0.114 * g.s.data[i * 4 + 2];
  }
  console.log(`  ${g.name}  mean luma ${(sum / (TILE * TILE)).toFixed(2)}`);
}

const variantAt = (x: number, y: number) => {
  let n = (x * 374761393 + y * 668265263 + 11 * 2246822519) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = (n ^ (n >>> 16)) >>> 0;
  return grass[n % grass.length];
};

const W = 20, H = 14;
const field = new Surface(W * TILE, H * TILE);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) field.blit(variantAt(x, y).s, x * TILE, y * TILE);
mkdirSync('.tmp', { recursive: true });
const up = upscale(field, 3);
writeFileSync('.tmp/field_grass.png', encodePNG(up.w, up.h, up.data));
console.log('wrote .tmp/field_grass.png');
