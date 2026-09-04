/**
 * Every material field that carries a value must reach the interface.
 *
 * Fields are easy to miss: the game adds one, the bake passes it through, and
 * nothing ever renders it. This walks every non-default value in the raw
 * material list and checks the UI code mentions its name somewhere.
 *
 * It needs the raw AllMaterials.json, so it is skipped when the game is not
 * installed rather than failing.
 */
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { locateGamePck } from './locate-game.mjs';
import { findPckTool } from './pck-tool.mjs';

// Nothing at present: every field with a value is shown somewhere.
const NOT_SHOWN = new Set([]);

const SRC = ['data.js', 'main.js', 'search.js', 'grouping.js', 'pattern-render.js',
             'formula.js', 'collapse.js', 'patterns.js']
  .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('\n');

let raw, temp = null;
try {
  const { pck } = await locateGamePck({});
  const tool = findPckTool();
  temp = mkdtempSync(join(tmpdir(), 'atomcraft-coverage-'));
  tool.extract(pck, temp, { include: '^Data/AllMaterials[.]json$' });
  const path = join(temp, 'Data', 'AllMaterials.json');
  if (!existsSync(path)) throw new Error('AllMaterials.json not where expected');
  raw = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.log(`skip  the game is not available, so field coverage is unchecked (${err.message})`);
  if (temp) rmSync(temp, { recursive: true, force: true });
  process.exit(0);
}
rmSync(temp, { recursive: true, force: true });

// Dotted paths that hold a non-default value, and how many materials have one.
const paths = new Map();
const walk = (obj, prefix) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === false || v === 0) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (prefix === 'DropRates') continue;      // dynamic keys: the drop targets
    paths.set(path, (paths.get(path) || 0) + 1);
    if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path);
    else if (Array.isArray(v)) for (const e of v) if (e && typeof e === 'object') walk(e, `${path}[]`);
  }
};
for (const m of raw) walk(m, '');

const leaf = (path) => path.split(/[.[]/).pop().replace(']', '');
const unread = [...paths]
  .filter(([path]) => !new RegExp(`\\b${leaf(path)}\\b`).test(SRC))
  .filter(([path]) => !NOT_SHOWN.has(path));

let fail = 0;
if (unread.length) {
  console.log(`FAIL  ${unread.length} material fields carry a value but reach nothing in the UI:`);
  for (const [path, n] of unread.sort((a, b) => b[1] - a[1])) {
    console.log(`        ${String(n).padStart(4)} materials  ${path}`);
  }
  console.log('        add them to the interface, or list them in NOT_SHOWN with a reason');
  fail++;
} else {
  console.log(`ok    all ${paths.size} material fields carrying a value are read by the UI`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
