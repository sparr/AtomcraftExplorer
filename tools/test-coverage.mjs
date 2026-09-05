/**
 * The interface and the game's field list must agree, in both directions.
 *
 * Fields are easy to miss: the game adds one, the bake passes it through, and
 * nothing ever renders it. They are just as easy to keep after they have gone,
 * leaving a row in the detail pane that can never appear.
 *
 * Both directions caught the 2026-09-05 build out. It added `SpecificHeat`,
 * `LaserAbsorption` and `IsReflective`, which the first check found; it also
 * replaced `Density` and `Weight` with `Mass`, and nothing noticed either half
 * of that. `Density` and `Weight` sat in the field list pointing at nothing,
 * and `Mass` passed for being read because the string `'Mass number (A)'` --
 * an unrelated label -- contains it.
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

const read = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const MAIN = read('main.js');
const SRC = ['data.js', 'search.js', 'grouping.js', 'pattern-render.js',
             'formula.js', 'collapse.js', 'patterns.js'].map(read).join('\n') + '\n' + MAIN;

/**
 * Is this field actually *read*, rather than merely mentioned?
 *
 * Only the three shapes a field name really appears in: a property access, a
 * name quoted whole in one of the field lists, or a key in an object literal.
 * Matching the bare word anywhere in the source let `Mass` hide inside the
 * label `'Mass number (A)'` for a whole release.
 */
const referenced = (name) => new RegExp(
  `\\.${name}\\b` +                        // m.raw.Mass
  `|(?:'|"|\`)${name}(?:'|"|\`)` +          // 'Mass' in a field list
  `|(?:^|[{,(\\s])${name}\\s*:`,             // Mass: 'label' as a key
  'm').test(SRC);

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
  .filter(([path]) => !referenced(leaf(path)))
  .filter(([path]) => !NOT_SHOWN.has(path));

// Every key the game writes, whatever its value -- a field that is false on
// every material still exists, and a row for it is not a stale row.
const known = new Set();
const keys = (obj) => {
  for (const [k, v] of Object.entries(obj)) {
    known.add(k);
    if (v && typeof v === 'object' && !Array.isArray(v)) keys(v);
    else if (Array.isArray(v)) for (const e of v) if (e && typeof e === 'object') keys(e);
  }
};
for (const m of raw) keys(m);

// And what the code says it will read. Two places name fields as data rather
// than touching them as properties, and a rename in the game would leave
// either of them quietly pointing at nothing: the detail pane's ['Field',
// 'Label'] lists, and the map in data.js that turns a field into a
// back-reference. Anything reached as `m.raw.Whatever` is not covered here --
// that shape is the other check's business.
const declared = new Set();
for (const block of MAIN.matchAll(/const\s+\w*FIELDS\s*=\s*\[([\s\S]*?)\n\];/g)) {
  for (const m of block[1].matchAll(/\[\s*'([A-Za-z_]\w*)'/g)) declared.add(m[1]);
}
for (const block of read('data.js').matchAll(/const DIRECT = \{([\s\S]*?)\n\s*\};/g)) {
  for (const m of block[1].matchAll(/^\s*([A-Z]\w*)\s*:/gm)) declared.add(m[1]);
}
const stale = [...declared].filter((f) => !known.has(f));

let fail = 0;
if (stale.length) {
  console.log(`FAIL  ${stale.length} fields are listed in the interface but no longer exist:`);
  for (const f of stale.sort()) console.log(`             ${f}`);
  console.log('        the game dropped them; drop the rows too');
  fail++;
} else {
  console.log(`ok    all ${declared.size} fields the detail pane lists still exist in the game`);
}
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
