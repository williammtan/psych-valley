import '../src/world/maps/lumen_vale';
import { getMap } from '../src/world/registry';
const m = getMap('lumen_vale');
const freq: Record<string, number> = {};
for (const p of m.props ?? []) freq[p.key] = (freq[p.key] ?? 0) + 1;
const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
console.log('TOP PROP KEYS');
for (const [k, n] of sorted.slice(0, 40)) console.log(String(n).padStart(4), k);
console.log('total props', (m.props ?? []).length);
// ground char histogram
const h: Record<string, number> = {};
for (const row of m.ground) for (const c of row) h[c] = (h[c] ?? 0) + 1;
console.log('GROUND', JSON.stringify(h));
const oh: Record<string, number> = {};
for (const row of m.objects ?? []) for (const c of row) oh[c] = (oh[c] ?? 0) + 1;
console.log('OBJECTS', JSON.stringify(oh));
