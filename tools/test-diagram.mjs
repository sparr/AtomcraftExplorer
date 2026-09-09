/**
 * The plan drawn as a graph: the sums behind the picture.
 *
 * What is worth checking here is not what it looks like -- nothing in a test
 * can see that -- but the three claims the layout makes. Every arrow points
 * the way the material moves, except the ones that close a wheel and say so.
 * The combing leaves fewer crossings than it found. And the springs settle
 * rather than wander.
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { solveFresh } from '../src/plan-fresh.js';
import { layoutPlan, relax, crossings } from '../src/plan-diagram.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const graph = buildProcessGraph(await loadData());
let fail = 0;
const ok = (m) => console.log(`ok    ${m}`);
const bad = (m) => { console.log(`FAIL  ${m}`); fail++; };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const plans = [
  ['carbon out of its dioxide', { targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Dioxide'] }],
  ['the columbite factory', { targets: [{ name: 'Tantalum', amount: 2 }, { name: 'Niobium', amount: 2 }],
                              have: ['Columbite'] }],
  ['lepidolite, all four ways', {
    targets: ['Potassium', 'Lithium', 'Aluminum', 'Silicon']
      .map((name, i) => ({ name, amount: [2, 2, 2, 3][i] })), have: ['Lepidolite'] }],
];

for (const [what, ask] of plans) {
  const plan = solveFresh(graph, ask);
  const state = layoutPlan(plan);
  console.log(`\n--- ${what}`);
  check(state.nodes.length > 0 && state.edges.length > 0,
        `${state.nodes.length} nodes and ${state.edges.length} arrows`);

  // Both halves of the plan are there: a box for every step, a chip for every
  // material any step touches.
  const steps = state.nodes.filter((n) => n.kind === 'step');
  check(steps.length === plan.steps.length,
        `a box for each of the ${plan.steps.length} steps`);

  /**
   * Every arrow points right, bar the ones that close a wheel.
   *
   * This is the whole claim the picture makes -- that what is left of a step
   * goes into it -- and it is the one a plain force layout cannot make. A
   * plan is full of loops, so some edges must double back; those are marked,
   * and the check is that nothing else does.
   */
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const wrong = state.edges.filter((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    return !e.back && b.rank <= a.rank;
  });
  check(!wrong.length,
        `every arrow runs left to right unless it closes a loop (${wrong.length} do not)`);
  const loops = state.edges.filter((e) => e.back).length;
  check(loops < state.edges.length,
        `${loops} of ${state.edges.length} arrows close a wheel, and they are marked`);

  // The combing earns its place.
  const raw = crossings(layoutPlan(plan, { rounds: 0 }));
  const combed = crossings(state);
  check(combed <= raw, `crossings ${raw} uncombed, ${combed} combed`);

  /**
   * And the springs settle rather than wander.
   *
   * They only ever move a node along its own column, so the ranks -- and with
   * them every claim above -- survive being relaxed.
   */
  const before = state.nodes.map((n) => n.rank).join(',');
  let last = Infinity;
  for (let i = 0; i < 400; i++) last = relax(state);
  check(last < 1, `the springs come to rest (${last.toFixed(3)} left moving)`);
  check(state.nodes.map((n) => n.rank).join(',') === before,
        'and nothing changed column while they did');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
