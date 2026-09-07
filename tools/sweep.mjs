/**
 * Ask one question every way the sources allow, and print what is worth having.
 *
 *   node tools/sweep.mjs '{"targets":["Tantalum","Niobium"],"have":["Columbite"]}'
 *
 * Thirty-one source combinations, one solve each, then `digest` throws away
 * the duplicates and anything another answer beats outright. What comes back
 * is two to five rows, and the rows disagree: the cheapest in atoms is not the
 * shortest shopping list, and on Columbite they are as far apart as sixteen
 * atoms in three purchases against forty-four in one.
 *
 * The page does the same thing (see `renderMenu` in plan-view.js). This is
 * here to answer the question quickly for a spec nobody has put in the page
 * yet, and to time it: the Columbite sweep is forty seconds, which is why the
 * page runs its solves one per turn of the event loop rather than in a row.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(fs.readFileSync(path.join(root, 'data/atomcraft.json'), 'utf8')),
});

const { loadData } = await import('../src/data.js');
const { buildProcessGraph } = await import('../src/plan-graph.js');
const { solveFresh, SOURCES } = await import('../src/plan-fresh.js');
const { rnum } = await import('../src/rational.js');
const { digest, optionSets, SCORES } = await import('../src/plan-menu.js');

const raw = process.argv[2];
if (!raw) {
  console.error('usage: node tools/sweep.mjs \'{"targets":["X"],"have":["Y"]}\'');
  process.exit(2);
}
const spec = JSON.parse(raw);

const db = await loadData();
const graph = buildProcessGraph(db);
const tools = {
  matter: (n) => db.byName.get(n)?.matter ?? 1,
  toNumber: rnum,
};

const targets = spec.targets.map((n) => (typeof n === 'string' ? { name: n, amount: 1 } : n));
const entries = [];
let slowest = 0;
const began = Date.now();
for (const sources of optionSets([...SOURCES])) {
  const t0 = Date.now();
  let plan = null;
  try {
    plan = solveFresh(graph, { ...spec, targets, sources });
  } catch (e) {
    console.error(`  ${sources.join('+')} threw: ${e.message}`);
  }
  slowest = Math.max(slowest, Date.now() - t0);
  entries.push({ options: sources, plan });
}
const took = Date.now() - began;

const { menu, distinct, scored, barren } = digest(entries, tools);

const cell = (x) => String(Math.round(x * 100) / 100).padStart(7);
console.log(`${entries.length} runs in ${(took / 1000).toFixed(1)}s ` +
            `(slowest ${(slowest / 1000).toFixed(1)}s), ${scored} answered, ` +
            `${distinct} distinct, ${menu.length} on the menu`);
console.log('\n' + SCORES.map((s) => s.short.padStart(7)).join(' ') + '   sources');
for (const row of menu) {
  console.log(SCORES.map((s) => cell(row[s.id])).join(' ') + '   ' +
              row.via[0].join('+') + (row.via.length > 1 ? ` (+${row.via.length - 1})` : '') +
              (row.best.length ? `   best: ${row.best.join(', ')}` : ''));
}
if (barren.length) console.log(`\n${barren.length} combinations found no route at all.`);
