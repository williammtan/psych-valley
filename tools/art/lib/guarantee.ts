/**
 * Frames the runtime cannot function without.
 *
 * Art modules are built by different people at different times. Rather than let
 * the game render Phaser's green "texture missing" box (which makes review
 * screenshots useless), the build guarantees every required frame exists — the
 * real one if a module produced it, an obvious magenta-hatched placeholder if
 * not. `npm run art` prints anything it had to stand in for, so a gap is loud
 * rather than silent.
 */
import { Surface, rng } from './pixel.js';
import { ArtBuild } from './registry.js';
import * as P from './palette.js';

interface Req { name: string; w: number; h: number; kind: 'shadow' | 'light' | 'pixel' | 'box' }

const REQUIRED: Req[] = [
  { name: 'fx/shadow_small', w: 12, h: 6, kind: 'shadow' },
  { name: 'fx/shadow_med', w: 18, h: 8, kind: 'shadow' },
  { name: 'fx/shadow_large', w: 28, h: 11, kind: 'shadow' },
  { name: 'fx/light_soft_64', w: 64, h: 64, kind: 'light' },
  { name: 'fx/light_soft_128', w: 128, h: 128, kind: 'light' },
  { name: 'fx/light_soft_192', w: 192, h: 192, kind: 'light' },
  { name: 'ui/fade_pixel', w: 1, h: 1, kind: 'pixel' },
];

function charFrames(): Req[] {
  const out: Req[] = [];
  for (const d of ['s', 'n', 'e']) {
    for (const p of ['idle', 'walk', 'attack', 'dash', 'talk']) {
      out.push({ name: `char/player/${p}_${d}_0`, w: 24, h: 32, kind: 'box' });
    }
  }
  return out;
}

function placeholder(r: Req): Surface {
  const s = new Surface(r.w, r.h);
  if (r.kind === 'shadow') {
    // Dithered elliptical contact shadow — good enough to ship if nobody
    // overrides it, since every entity in the game needs one.
    const cx = r.w / 2 - 0.5, cy = r.h / 2 - 0.5;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const nx = (x - cx) / (r.w / 2);
        const ny = (y - cy) / (r.h / 2);
        const d = nx * nx + ny * ny;
        if (d > 1) continue;
        const a = 0.42 * (1 - d * 0.55);
        s.px(x, y, P.OUTLINE, a);
      }
    }
  } else if (r.kind === 'light') {
    // Radial falloff, dithered so it composites like pixel art rather than a
    // smooth gradient. Drawn white; the runtime tints it.
    const cx = r.w / 2 - 0.5, cy = r.h / 2 - 0.5;
    const rad = r.w / 2;
    const rnd = rng(9001 + r.w);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d > 1) continue;
        let a = Math.pow(1 - d, 2.1);
        // ordered dither in the tail so the edge breaks up into pixels
        if (a < 0.34) {
          const t = ((x & 3) * 4 + (y & 3)) / 16;
          a = a * 3 > t ? a : 0;
        }
        if (a <= 0) continue;
        s.px(x, y, '#ffffff', Math.min(1, a));
      }
    }
    void rnd;
  } else if (r.kind === 'pixel') {
    s.fill('#ffffff');
  } else {
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        s.px(x, y, (x + y) % 8 < 4 ? '#ff00c8' : '#2b1030');
      }
    }
  }
  return s;
}

/** Returns the names that had to be stubbed. */
export function guaranteeFrames(b: ArtBuild): string[] {
  const stubbed: string[] = [];
  for (const req of [...REQUIRED, ...charFrames()]) {
    if (b.spriteNames.has(req.name)) continue;
    b.add(req.name, placeholder(req));
    stubbed.push(req.name);
  }
  return stubbed;
}
