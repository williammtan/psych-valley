import '../src/world/maps/lumen_vale';
import { getMap } from '../src/world/registry';
const m = getMap('lumen_vale');
const args = process.argv.slice(2);
if (args[0] === 'dump') {
  const [x0, y0, x1, y1] = args.slice(1).map(Number);
  const grid = args[5] === 'obj' ? (m.objects ?? []) : m.ground;
  let hdr = '    ';
  for (let x = x0; x <= x1; x++) hdr += String(x % 10);
  console.log(hdr);
  for (let y = y0; y <= y1; y++) console.log(String(y).padStart(3) + ' ' + grid[y].slice(x0, x1 + 1));
} else if (args[0] === 'keys') {
  const freq: Record<string, number> = {};
  for (const p of m.props ?? []) freq[p.key] = (freq[p.key] ?? 0) + 1;
  for (const [k, n] of Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, Number(args[1] ?? 30))) console.log(String(n).padStart(4), k);
  console.log('total props', (m.props ?? []).length, ' lights', (m.lights ?? []).length);
} else {
  const h: Record<string, number> = {};
  for (const row of m.ground) for (const c of row) h[c] = (h[c] ?? 0) + 1;
  console.log('GROUND', JSON.stringify(h));
  const oh: Record<string, number> = {};
  for (const row of m.objects ?? []) for (const c of row) oh[c] = (oh[c] ?? 0) + 1;
  console.log('OBJECTS', JSON.stringify(oh));
  console.log('props', (m.props ?? []).length, 'lights', (m.lights ?? []).length, 'npcs', (m.npcs ?? []).length);
}
