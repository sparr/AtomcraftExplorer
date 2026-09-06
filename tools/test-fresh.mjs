/**
 * The canonical cases, put to the solver that has two priorities.
 *
 * Not a pass/fail suite yet -- it is the instrument for the question the
 * branch exists to answer: how much of what the reader wants falls out of
 * "buy nothing if you can, then use the fewest real steps", and what has to be
 * said on top. So it prints the score rather than exiting non-zero on it.
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { solveFresh } from '../src/plan-fresh.js';
import { rnum, rzero, rstr } from '../src/rational.js';
import { CASES, NEVER } from './cases.mjs';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const graph = buildProcessGraph(await loadData());
const helpers = { rnum, rzero, rstr };
const budget = Number(process.env.FRESH_BUDGET || 240000);

let met = 0, missed = 0, broke = 0;
for (const c of CASES) {
  console.log(`\n--- ${c.id}: ${c.about}`);
  console.log(`      ${c.url}`);
  const started = Date.now();
  let plan = null, err = null;
  try {
    plan = solveFresh(graph, { targets: c.plan.targets.map((t) => ({ name: t, amount: 1 })),
                               have: c.plan.have || [] });
  } catch (e) { err = e; }
  const took = Date.now() - started;
  if (err) { console.log(`      threw after ${took}ms: ${err.message}`); broke++; continue; }
  if (!plan) { console.log(`      no plan after ${took}ms`); broke++; continue; }

  console.log(`      ${took}ms, ${plan.considered} processes considered, ` +
    `${plan.steps.length} steps (${plan.realSteps} real)`);
  console.log(`      makes ${plan.spec.targets.map((t) => `${t.amount} ${t.name}`).join(', ')}`);
  console.log(`      fetch ${plan.frontier.map((f) => `${f.name}×${rstr(f.amount)}`).join(', ') || '-'}` +
    ` | feed ${plan.feed.map((f) => `${f.name}×${rstr(f.amount)}`).join(', ') || '-'}` +
    ` | over ${plan.byproducts.map((b) => `${b.name}×${rstr(b.amount)}`).join(', ') || '-'}`);

  for (const [label, test] of [...c.want, ...NEVER]) {
    let ok = false;
    try { ok = !!test(plan, helpers); } catch { ok = false; }
    console.log(`      ${ok ? 'MET  ' : 'MISS '} ${label}`);
    if (ok) met++; else missed++;
  }
}
console.log(`\n${met} met, ${missed} missed, ${broke} cases without a plan`);
