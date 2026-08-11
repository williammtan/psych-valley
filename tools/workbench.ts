/**
 * Builds the live progress workbench: a single self-contained HTML page showing
 * where the game currently stands — latest screenshots, side-by-side reference
 * comparisons, open critic findings, and the build's own health report.
 *
 *   npm run workbench
 *
 * Everything is inlined as data URIs so the page can be published as an
 * artifact and read without the repo.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS = join(ROOT, 'shots');
const REFS = join(ROOT, 'project_psyche_reference_pack', 'references');
const STATUS = join(ROOT, 'docs', 'status.json');

interface Finding {
  area: string;
  severity: 'blocker' | 'major' | 'minor' | 'polish';
  text: string;
  status: 'open' | 'fixed';
  round?: number;
}

interface Status {
  updated: string;
  phase: string;
  headline: string;
  areas: Array<{ name: string; state: 'not-started' | 'building' | 'critiqued' | 'good'; note?: string }>;
  findings: Finding[];
  comparisons: Array<{ title: string; ours: string; reference: string; verdict?: string }>;
  notes?: string[];
}

const DEFAULT_STATUS: Status = {
  updated: new Date().toISOString(),
  phase: 'Foundation',
  headline: 'Art pipeline, engine core and screenshot harness online.',
  areas: [],
  findings: [],
  comparisons: [],
};

function dataUri(path: string): string | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  const ext = path.split('.').pop()!.toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Prefer the compressed jpeg; fall back to the png. */
function shotUri(name: string): string | null {
  return dataUri(join(SHOTS, `${name}.jpg`)) ?? dataUri(join(SHOTS, `${name}.png`));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function git(cmd: string): string {
  try { return execSync(`git ${cmd}`, { cwd: ROOT }).toString().trim(); } catch { return ''; }
}

function main(): void {
  const status: Status = existsSync(STATUS)
    ? { ...DEFAULT_STATUS, ...JSON.parse(readFileSync(STATUS, 'utf8')) }
    : DEFAULT_STATUS;

  const art = existsSync(join(ROOT, 'public/assets/art.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'public/assets/art.json'), 'utf8'))
    : null;
  const report = existsSync(join(SHOTS, 'report.json'))
    ? JSON.parse(readFileSync(join(SHOTS, 'report.json'), 'utf8'))
    : null;

  const shotNames = existsSync(SHOTS)
    ? [...new Set(readdirSync(SHOTS).filter((f) => /\.(png|jpg)$/.test(f)).map((f) => f.replace(/\.(png|jpg)$/, '')))]
    : [];

  const commits = git('log --oneline -14').split('\n').filter(Boolean);
  const stubbed: string[] = art?.stubbed ?? [];

  const sevColor: Record<string, string> = {
    blocker: 'var(--red)', major: 'var(--orange)', minor: 'var(--yellow)', polish: 'var(--dim)',
  };
  const stateColor: Record<string, string> = {
    'not-started': 'var(--dim)', building: 'var(--blue)', critiqued: 'var(--orange)', good: 'var(--green)',
  };

  const shotCards = shotNames.map((n) => {
    const uri = shotUri(n);
    if (!uri) return '';
    const r = report?.results?.find((x: { name: string }) => x.name === n);
    const errs: string[] = r?.errors ?? [];
    return `<figure class="shot">
      <img src="${uri}" alt="${esc(n)}" loading="lazy">
      <figcaption>
        <span class="shot-name">${esc(n)}</span>
        ${errs.length ? `<span class="badge err">${errs.length} console error${errs.length > 1 ? 's' : ''}</span>` : ''}
      </figcaption>
    </figure>`;
  }).join('\n');

  const comparisons = status.comparisons.map((c) => {
    const ours = shotUri(c.ours);
    const ref = dataUri(join(REFS, c.reference));
    if (!ours || !ref) return '';
    return `<div class="cmp">
      <h3>${esc(c.title)}</h3>
      <div class="cmp-grid">
        <figure><img src="${ours}" loading="lazy"><figcaption>Project Psyche</figcaption></figure>
        <figure><img src="${ref}" loading="lazy"><figcaption>Reference — ${esc(c.reference.split('/').pop()!)}</figcaption></figure>
      </div>
      ${c.verdict ? `<p class="verdict">${esc(c.verdict)}</p>` : ''}
    </div>`;
  }).join('\n');

  const html = `<title>Psyche Workbench</title>
<style>
  :root {
    --bg: #14121c; --panel: #1c1a28; --panel2: #232032; --line: #322e44;
    --text: #e8e2f0; --dim: #8e88a4; --gold: #d6a534; --green: #6cb069;
    --blue: #6d94a8; --orange: #d08a4a; --yellow: #d6c034; --red: #c2456a;
    --echo: #a681e6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 32px 20px 80px; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 20px; margin-bottom: 28px; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h1 .sub { color: var(--echo); font-weight: 400; }
  .meta { color: var(--dim); font-size: 13px; }
  .headline { margin-top: 12px; font-size: 16px; color: var(--text); }
  h2 {
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.14em;
    color: var(--dim); margin: 38px 0 14px; font-weight: 600;
  }
  .grid { display: grid; gap: 14px; }
  .areas { grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
  .area {
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
    padding: 11px 13px;
  }
  .area .name { font-weight: 600; font-size: 13px; }
  .area .state { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 3px; }
  .area .note { color: var(--dim); font-size: 12px; margin-top: 5px; }
  .shots { grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
  .shot { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .shot img { width: 100%; display: block; image-rendering: pixelated; background: #000; }
  .shot figcaption {
    padding: 8px 11px; font-size: 12px; display: flex; justify-content: space-between;
    align-items: center; gap: 8px;
  }
  .shot-name { color: var(--dim); font-family: ui-monospace, monospace; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
  .badge.err { background: rgba(194,69,106,0.18); color: var(--red); }
  .cmp { margin-bottom: 28px; }
  .cmp h3 { font-size: 15px; margin: 0 0 10px; }
  .cmp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .cmp-grid img { width: 100%; display: block; border-radius: 6px; border: 1px solid var(--line); image-rendering: pixelated; }
  .cmp-grid figcaption { font-size: 11px; color: var(--dim); margin-top: 5px; text-align: center; }
  .verdict {
    margin: 10px 0 0; padding: 9px 12px; background: var(--panel);
    border-left: 2px solid var(--echo); border-radius: 0 6px 6px 0; font-size: 13px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--dim); font-weight: 600; font-size: 11px;
       text-transform: uppercase; letter-spacing: 0.1em; padding: 0 10px 8px 0; }
  td { padding: 7px 10px 7px 0; border-top: 1px solid var(--line); vertical-align: top; }
  td.sev { white-space: nowrap; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
  td.area-cell { color: var(--dim); white-space: nowrap; }
  .fixed { opacity: 0.45; text-decoration: line-through; }
  .commits { font-family: ui-monospace, monospace; font-size: 12px; color: var(--dim); }
  .commits li { margin-bottom: 3px; }
  .stat-row { display: flex; gap: 26px; flex-wrap: wrap; margin-bottom: 8px; }
  .stat { }
  .stat .n { font-size: 22px; font-weight: 600; }
  .stat .l { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.1em; }
  .empty { color: var(--dim); font-style: italic; }
  code { background: var(--panel2); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  @media (max-width: 680px) { .cmp-grid { grid-template-columns: 1fr; } }
</style>

<div class="wrap">
  <header>
    <h1>Project Psyche <span class="sub">— workbench</span></h1>
    <div class="meta">${esc(status.phase)} · updated ${new Date(status.updated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
    <p class="headline">${esc(status.headline)}</p>
  </header>

  <div class="stat-row">
    <div class="stat"><div class="n">${art?.tileset?.count ?? 0}</div><div class="l">tiles</div></div>
    <div class="stat"><div class="n">${art ? Object.keys(art.anims ?? {}).length || (art.anims?.length ?? 0) : 0}</div><div class="l">animations</div></div>
    <div class="stat"><div class="n">${shotNames.length}</div><div class="l">captures</div></div>
    <div class="stat"><div class="n">${status.findings.filter((f) => f.status === 'open').length}</div><div class="l">open findings</div></div>
    <div class="stat"><div class="n">${stubbed.length}</div><div class="l">placeholder frames</div></div>
  </div>

  <h2>Areas</h2>
  <div class="grid areas">
    ${status.areas.length ? status.areas.map((a) => `
      <div class="area">
        <div class="name">${esc(a.name)}</div>
        <div class="state" style="color:${stateColor[a.state] ?? 'var(--dim)'}">${esc(a.state)}</div>
        ${a.note ? `<div class="note">${esc(a.note)}</div>` : ''}
      </div>`).join('') : '<p class="empty">No areas registered yet.</p>'}
  </div>

  ${comparisons ? `<h2>Reference comparisons</h2>${comparisons}` : ''}

  <h2>Current critic findings</h2>
  ${status.findings.length ? `<table>
    <tr><th>Sev</th><th>Area</th><th>Finding</th></tr>
    ${status.findings.map((f) => `<tr class="${f.status === 'fixed' ? 'fixed' : ''}">
      <td class="sev" style="color:${sevColor[f.severity] ?? 'var(--dim)'}">${esc(f.severity)}</td>
      <td class="area-cell">${esc(f.area)}</td>
      <td>${esc(f.text)}</td>
    </tr>`).join('')}
  </table>` : '<p class="empty">No findings recorded yet.</p>'}

  <h2>Latest captures</h2>
  ${shotCards ? `<div class="grid shots">${shotCards}</div>` : '<p class="empty">No screenshots captured yet. Run <code>npm run shot</code>.</p>'}

  ${stubbed.length ? `<h2>Placeholder art still in the build</h2>
    <p class="empty">${stubbed.map(esc).join(', ')}</p>` : ''}

  <h2>Recent commits</h2>
  <ul class="commits">${commits.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
</div>`;

  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(join(ROOT, 'docs', 'progress.html'), html);
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  console.log(`  docs/progress.html  (${kb} KB, ${shotNames.length} captures)`);
}

main();
