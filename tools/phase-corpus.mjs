/**
 * A wide net of plans, digested to something two runs can be diffed on.
 *
 *   node tools/phase-corpus.mjs before.json
 *
 * The canonical cases plus an even sample of everything the planner can be
 * asked for, one plan each, recorded as steps, shopping list and leavings.
 * Nothing here judges a plan; it exists so a change to the model can be read
 * as "these forty plans moved and the rest did not" rather than as a handful
 * of eyeballed examples.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { solveFresh } from '../src/plan-fresh.js';
import { rnum } from '../src/rational.js';
import { CASES } from './cases.mjs';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const db = await loadData();
const graph = buildProcessGraph(db);

const out = process.argv[2] || 'corpus.json';
const every = Number(process.env.CORPUS_EVERY || 4);

const specs = [];
for (const c of CASES) {
  specs.push({ id: `case:${c.id}`, spec: {
    targets: c.plan.targets.map((n) => (typeof n === 'string' ? { name: n, amount: 1 } : n)),
    have: c.plan.have || [],
  } });
}
// Everything something can make, sampled evenly by name so the list is stable.
const makeable = db.materials
  .map((m) => m.name)
  .filter((n) => (graph.producers(n) || []).length)
  .sort();
for (let i = 0; i < makeable.length; i += every) {
  specs.push({ id: `one:${makeable[i]}`, spec: { targets: [{ name: makeable[i], amount: 1 }] } });
}

const digest = (p) => {
  if (!p || !p.steps) return { ok: false, why: p?.why?.reason || p?.reason || 'no plan' };
  return {
    ok: true,
    steps: p.steps.map((s) => `${s.process.id}x${rnum(s.runs)}`).sort(),
    buy: p.frontier.map((f) => `${f.name}x${rnum(f.amount)}`).sort(),
    feed: (p.feed || []).map((f) => `${f.name}x${rnum(f.amount)}`).sort(),
    spare: p.byproducts.map((b) => `${b.name}x${rnum(b.amount)}`).sort(),
    charge: (p.priming || []).map((c) => `${c.name}x${rnum(c.amount)}`).sort(),
  };
};

const rows = {};
let done = 0;
for (const { id, spec } of specs) {
  const began = Date.now();
  let got;
  try {
    got = digest(solveFresh(graph, spec));
  } catch (e) {
    got = { ok: false, why: `threw: ${e.message}` };
  }
  got.ms = Date.now() - began;
  rows[id] = got;
  done++;
  // Written as it goes, so a plan that never finishes still leaves everything
  // before it to compare against.
  writeFileSync(out, JSON.stringify(rows, null, 1));
  if (done % 20 === 0) {
    process.stderr.write(`${done}/${specs.length} (${got.ms}ms on ${id})\n`);
  }
}
const answered = Object.values(rows).filter((r) => r.ok).length;
console.log(`${specs.length} plans, ${answered} answered, written to ${out}`);
