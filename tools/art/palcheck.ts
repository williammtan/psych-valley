/**
 * Palette integrity check.
 *
 * Several art modules append to palette.ts concurrently, so a lost write shows
 * up as a module crashing on `SOMERAMP[2]` of an undefined export. This names
 * exactly which module wants which missing ramp.
 */
import { readFileSync } from 'node:fs';
import * as P from './lib/palette.js';

const exported = new Set(Object.keys(P));
const MODULES = ['terrain', 'buildings', 'interiors', 'props', 'festival', 'woods', 'shrine', 'characters', 'enemies', 'fx', 'ui'];
let bad = 0;
for (const f of MODULES) {
  let src: string;
  try { src = readFileSync(`tools/art/assets/${f}.ts`, 'utf8'); } catch { continue; }
  const used = new Set([...src.matchAll(/\bP\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  const missing = [...used].filter((u) => !exported.has(u));
  if (missing.length) { console.log(`  ${f.padEnd(12)} MISSING: ${missing.join(', ')}`); bad++; }
}
console.log(bad ? `\n  ${bad} module(s) reference missing palette entries.` : `  palette OK (${exported.size} exports)`);
