/**
 * Dialogue lint.
 *
 *   npx tsx tools/dialogue_lint.ts        report
 *   npx tsx tools/dialogue_lint.ts --all  report, and list every offending line
 *
 * The writing bar for Project Psyche is short lines, human voices and no
 * teacherly tells. This checks the parts of that a machine can check:
 *
 *   - line length (the dialogue box holds about two lines)
 *   - didactic tells ("this means that", "in psychology", ...)
 *   - psychology terminology outside the three designated naming moments
 *   - characters with too few lines to feel present
 *   - verbatim duplicates
 *   - unknown speakers, and characters missing from the cast
 *   - characters the body bitmap font cannot draw
 *   - Echo lines that are not verbatim quotes of something a person said
 *   - two exchanges claiming the same id (one of them would be unreachable)
 */
import { ALL_EXCHANGES, AMBIENT, STAGES, allExchanges, allLines } from '../src/data/dialogue/index.ts';
import { PEOPLE } from '../src/data/people.ts';

const MAX_LEN = 110;
const MIN_LINES_PER_CHARACTER = 8;

/** The only three exchanges allowed to contain a psychology term. */
const NAMING_MOMENTS = ['q1.naming', 'q2.naming', 'q3.naming'];

const DIDACTIC = [
  'is a type of',
  'this means that',
  'in psychology',
  'as you can see',
  'remember that',
  'the term for',
  'refers to',
  'is defined as',
  'in other words',
  'for example,',
];

const TERMINOLOGY = [
  'classical conditioning',
  'conditioning',
  'conditioned',
  'unconditioned',
  'stimulus',
  'stimuli',
  'reinforcement',
  'extinction',
  'psychology',
  'psychological',
  'proactive',
  'retroactive',
  'interference',
  'conformity',
  'conform',
  'normative',
  'informational',
  'social influence',
  'unanimity',
  'cognitive',
  'behaviourism',
  'behaviorism',
];

/**
 * Everything the body bitmap font can draw (tools/art/lib/font.ts). Anything
 * outside this renders as a hole in the dialogue box.
 */
const GLYPHS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'0123456789',
  ...' !"\'(),-.:;?/&%+*<>[]#@',
  ...'…—’“”',
]);

const lines = allLines();

interface Finding { rule: string; path: string; detail: string }
const findings: Finding[] = [];
const add = (rule: string, path: string, detail: string) => findings.push({ rule, path, detail });

// ── per-character counts ────────────────────────────────────────────────────
const counts = new Map<string, number>();
for (const l of lines) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);

// ── checks ──────────────────────────────────────────────────────────────────
const seen = new Map<string, string>();

for (const l of lines) {
  const lower = l.text.toLowerCase();

  if (l.text.length > MAX_LEN) {
    add('too-long', l.path, `${l.text.length} chars: ${l.text}`);
  }

  for (const tell of DIDACTIC) {
    if (lower.includes(tell)) add('didactic', l.path, `"${tell}" in: ${l.text}`);
  }

  const exchangeId = l.path.split('[')[0];
  if (!NAMING_MOMENTS.includes(exchangeId)) {
    for (const term of TERMINOLOGY) {
      if (new RegExp(`\\b${term}\\b`, 'i').test(l.text)) {
        add('terminology', l.path, `"${term}" in: ${l.text}`);
      }
    }
  }

  const key = l.text.trim().toLowerCase();
  const prev = seen.get(key);
  // `dup` marks deliberate repetition: a crowd chorus, or the Echo quoting.
  if (l.dup) { /* deliberate: never reported, never claims the canonical slot */ }
  else if (prev) add('duplicate', l.path, `same text as ${prev}: ${l.text}`);
  else seen.set(key, l.path);

  if (!PEOPLE[l.speaker]) add('unknown-speaker', l.path, `speaker "${l.speaker}"`);

  const bad = [...l.text].filter((ch) => !GLYPHS.has(ch));
  if (bad.length) add('bad-glyph', l.path, `${JSON.stringify(bad.join(''))} in: ${l.text}`);
}

// The Echo only ever says something it has heard a person say. Every one of its
// lines must be a verbatim quote of a line that exists elsewhere in the game.
const spokenElsewhere = new Set(
  lines.filter((l) => l.speaker !== 'echo').map((l) => l.text.trim()),
);
for (const l of lines) {
  if (l.speaker !== 'echo') continue;
  if (!spokenElsewhere.has(l.text.trim())) {
    add('echo-not-quoted', l.path, `no character ever says: ${l.text}`);
  }
}

// Two exchanges sharing an id means one of them is unreachable.
const idSeen = new Map<string, number>();
for (const ex of ALL_EXCHANGES) idSeen.set(ex.id, (idSeen.get(ex.id) ?? 0) + 1);
for (const [id, n] of idSeen) if (n > 1) add('duplicate-id', id, `${n} exchanges share this id`);

// Everyone in the cast who talks should have enough lines to feel present.
for (const [id, person] of Object.entries(PEOPLE)) {
  if (id === 'narrator' || id === 'player' || id === 'pip' || id === 'mote') continue;
  const n = counts.get(id) ?? 0;
  if (n < MIN_LINES_PER_CHARACTER) add('thin-character', id, `${person.name || id} has ${n} lines`);
}

// Ambient coverage: everyone should have something to say in every stage.
for (const [id, profile] of Object.entries(AMBIENT)) {
  for (const stage of STAGES) {
    const set = profile.idle[stage] ?? [];
    if (set.length < 2) add('thin-stage', `${id}.${stage}`, `${set.length} idle lines`);
    if (!profile.hint[stage]) add('missing-hint', `${id}.${stage}`, 'no hint line');
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const verbose = process.argv.includes('--all');
const byRule = new Map<string, Finding[]>();
for (const f of findings) {
  const arr = byRule.get(f.rule) ?? [];
  arr.push(f);
  byRule.set(f.rule, arr);
}

const nameOf = (id: string) => PEOPLE[id]?.name || (id === 'player' ? 'PLAYER' : id.toUpperCase());
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
const longest = lines.reduce((m, l) => Math.max(m, l.text.length), 0);

console.log('PROJECT PSYCHE — dialogue lint');
console.log('='.repeat(64));
console.log(`exchanges       ${allExchanges().length}`);
console.log(`lines           ${lines.length}`);
console.log(`longest line    ${longest} chars (limit ${MAX_LEN})`);
console.log(`distinct texts  ${seen.size}`);
console.log('');
console.log('LINES PER CHARACTER');
for (const [id, n] of sorted) {
  console.log(`  ${nameOf(id).padEnd(18)} ${String(n).padStart(4)}`);
}
console.log('');

const ORDER = [
  'too-long', 'didactic', 'terminology', 'duplicate', 'thin-character',
  'unknown-speaker', 'bad-glyph', 'echo-not-quoted', 'duplicate-id', 'thin-stage', 'missing-hint',
];

console.log('CHECKS');
let failures = 0;
for (const rule of ORDER) {
  const found = byRule.get(rule) ?? [];
  failures += found.length;
  const mark = found.length === 0 ? 'ok  ' : 'FAIL';
  console.log(`  [${mark}] ${rule.padEnd(16)} ${found.length}`);
  if (found.length && (verbose || found.length <= 12)) {
    for (const f of found) console.log(`         ${f.path}  ${f.detail}`);
  }
}
console.log('');
console.log(failures === 0 ? 'CLEAN.' : `${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);
