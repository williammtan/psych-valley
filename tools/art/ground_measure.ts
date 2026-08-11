/**
 * Measures the qualities a blind A/B review keeps grading us on, directly from
 * the generated tiles — so a palette change can be verified before it costs a
 * screenshot round. Reports Rec.709 luminance, HSV saturation, flatness (share
 * of pixels whose 3x3 neighbourhood is uniform) and the step between materials.
 */
import { ArtBuild } from './lib/registry.js';
import { registerTerrain } from './assets/terrain.js';
import type { Surface } from './lib/pixel.js';

const b = new ArtBuild();
registerTerrain(b);

const luma = (r: number, g: number, bl: number) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
const sat = (r: number, g: number, bl: number) => {
  const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

function stats(name: string, s: Surface) {
  let L = 0, S = 0, n = 0, flat = 0;
  const colours = new Set<string>();
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const c = s.get(x, y);
      if (c[3] === 0) continue;
      L += luma(c[0], c[1], c[2]);
      S += sat(c[0], c[1], c[2]);
      colours.add(`${c[0]},${c[1]},${c[2]}`);
      n++;
      // uniform 3x3 (wrapping, since these tiles tile)
      let uniform = true;
      for (let dy = -1; dy <= 1 && uniform; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const o = s.get((x + dx + s.w) % s.w, (y + dy + s.h) % s.h);
          if (o[0] !== c[0] || o[1] !== c[1] || o[2] !== c[2]) { uniform = false; break; }
        }
      }
      if (uniform) flat++;
    }
  }
  return { name, L: L / n, S: S / n, colours: colours.size, flat: (flat / n) * 100 };
}

const pick = (re: RegExp) => b.tiles.filter((t) => re.test(t.name));
// Index 46 is the fully-enclosed blob tile — the one a player actually spends
// their time standing on. Edge tiles carry deliberate lips and would inflate
// both the colour count and the noise figure.
const groups: Array<[string, RegExp]> = [
  ['grass', /tile\/town\/grass_\d+$/],
  ['dirt (interior)', /blob\/dirt\/46$/],
  ['flagstone (interior)', /blob\/path\/46$/],
  ['cobble (interior)', /blob\/cobble\/46$/],
  ['sand (interior)', /blob\/sand\/46$/],
  ['grass_dry (interior)', /blob\/grass_dry\/46$/],
];

const rows = groups.map(([name, re]) => {
  const tiles = pick(re);
  if (!tiles.length) return { name, L: 0, S: 0, colours: 0, flat: 0 };
  const all = tiles.map((t) => stats(name, t.s));
  return {
    name,
    L: all.reduce((a, r) => a + r.L, 0) / all.length,
    S: all.reduce((a, r) => a + r.S, 0) / all.length,
    colours: Math.max(...all.map((r) => r.colours)),
    flat: all.reduce((a, r) => a + r.flat, 0) / all.length,
  };
});

console.log('\n  material            mean L   mean S   colours   flat 3x3');
for (const r of rows) {
  console.log(`  ${r.name.padEnd(18)} ${r.L.toFixed(1).padStart(6)} ${r.S.toFixed(3).padStart(8)} ${String(r.colours).padStart(8)} ${r.flat.toFixed(1).padStart(9)}%`);
}
const grass = rows[0].L;
console.log('\n  luminance step from grass:');
for (const r of rows.slice(1)) {
  const d = r.L - grass;
  // grass_dry is ground VARIATION, not a walkable surface — it is supposed to
  // stay inside the grass family, so it is exempt from the >=40 target.
  const exempt = r.name.startsWith('grass_dry');
  const verdict = exempt ? 'variation (exempt)' : d >= 40 ? 'OK' : 'TOO CLOSE';
  console.log(`    ${r.name.padEnd(22)} ${d >= 0 ? '+' : ''}${d.toFixed(1)}  ${verdict}`);
}
console.log('');
