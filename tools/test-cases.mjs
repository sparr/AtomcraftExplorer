/**
 * The canonical plans, and what has to stay true of them.
 *
 * `cases.mjs` says which questions matter and what a right answer looks like;
 * this runs them. Kept apart from `test-plan.mjs`, which checks mechanisms one
 * at a time -- this checks the handful of whole answers the planner exists to
 * give, and it is the file to read when weighing whether a change is worth it.
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { solvePlan, balanceTargets, rstr, rnum, rzero } from '../src/plan-solve.js';
import { CASES, NEVER } from './cases.mjs';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const db = await loadData();
const graph = buildProcessGraph(db);
const kit = { rnum, rzero, rstr };

let fail = 0;
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => { console.log(`FAIL  ${msg}`); fail++; };

for (const c of CASES) {
  console.log(`\n--- ${c.id}: ${c.about} ---`);
  console.log(`      ${c.url}`);
  // The way the page asks it: amounts worked out unless the reader typed some.
  const targets = balanceTargets(graph, c.plan);
  const plan = solvePlan(graph, { ...c.plan, targets });

  console.log(`      makes ${plan.spec.targets.map((t) => `${t.amount} ${t.name}`).join(', ')}` +
              ` | fetch ${plan.frontier.map((f) => `${f.name}×${rstr(f.amount)}`).join(', ') || '-'}` +
              ` | over ${plan.byproducts.map((b) => `${b.name}×${rstr(b.amount)}`).join(', ') || '-'}`);

  for (const [what, holds] of [...c.want, ...NEVER]) {
    let good = false;
    try { good = holds(plan, kit); } catch (err) { bad(`${what} -- threw: ${err.message}`); continue; }
    good ? ok(what) : bad(`${c.id}: ${what}`);
  }
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
