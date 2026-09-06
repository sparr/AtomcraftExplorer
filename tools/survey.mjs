/**
 * The top few substantially different ways to make the same thing.
 *
 * One answer is not much use for judging a planner. This takes the answer it
 * gets, finds a step in it that the ideal does not call for, disqualifies that
 * step, and asks again -- so each round is the best plan that cannot use what
 * the last one leant on. Repeat and you get a survey: several routes, what
 * each costs, and what each gives up.
 *
 * The banned step accumulates, so plan three cannot use what plans one or two
 * were built on. That is what makes them substantially different rather than
 * the same plan with a phase change moved.
 *
 * Run: node tools/survey.mjs [case-id] [how-many]
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { solveFresh, fetchPrices } from '../src/plan-fresh.js';
import { rnum, rstr } from '../src/rational.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const CASES = {
  columbite: {
    targets: [{ name: 'Tantalum', amount: 2 }, { name: 'Niobium', amount: 2 }],
    have: ['Columbite'], sources: ['weather', 'air', 'made'],
    ideal: ['rx:Hydrofluoric Acid Dissolves Columbite',
            'rx:Heptafluorotantalic Acid + Aqueous Potassium Hydroxide',
            'rx:Heptafluoroniobic Acid + Aqueous Potassium Hydroxide',
            'rx:Aqueous Potassium Heptafluorotantalate(V) + Water',
            'rx:Aqueous Potassium Heptafluoroniobate(V) + Water',
            'rx:Tantalum Pentoxide Reduction', 'rx:Niobium Pentoxide Reduction',
            'rx:Boudouard Equilibrium 500-725K',
            'rx:Molten Potassium + Carbon Dioxide', 'rx:Potassium Oxide + Water',
            'rx:Molten Potassium Hydroxide Electrolysis', 'rx:Hydrogen Combustion',
            'cond:Steam'],
  },
  lepidolite: {
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite'],
    ideal: ['rx:Lepidolite Decomposition', 'rx:Lepidolite Decomposition - Lithium',
            'rx:Lepidolite Decomposition - Potassium', 'rx:Silica Reduction',
            'rx:Molten Alumina Reduction', 'rx:Boudouard Equilibrium 500-725K',
            'rx:Molten Potassium + Carbon Dioxide', 'rx:Potassium Oxide + Water',
            'rx:Molten Potassium Hydroxide Electrolysis', 'rx:Hydrogen Combustion',
            'cond:Steam', 'rx:Hydrochloric Acid Dissolves Lithium Oxide',
            'rx:Electrolysis of Molten Lithium Chloride', 'rx:Chlorine Gas + Hydrogen Gas'],
  },
};

const graph = buildProcessGraph(await loadData());
const which = process.argv[2] || 'columbite';
const wanted = Number(process.argv[3] || 5);
const c = CASES[which];
if (!c) { console.log(`no such case: ${which}`); process.exit(1); }

const prices = fetchPrices(graph, new Set(['reaction', 'filter', 'phase', 'fire', 'grow', 'decay']));
const banned = [];
const seen = new Set();

for (let round = 0; round < wanted; round++) {
  const plan = solveFresh(graph, { ...c, excludeProcesses: [...banned] });
  if (!plan) { console.log(`\n#${round + 1}: no plan once ${banned.length} steps are barred`); break; }
  if (plan.shortfall) { console.log(`\n#${round + 1}: does not deliver`); break; }

  const orders = Math.min(...c.targets.map((t) => rnum(plan.madeOf(t.name)) / t.amount));
  const bill = plan.frontier.reduce((a, f) => a + rnum(f.amount) * (prices.get(f.name) ?? 1), 0);
  const units = plan.frontier.reduce((a, f) => a + rnum(f.amount), 0);
  const waste = plan.byproducts.reduce((a, b) => a + rnum(b.amount), 0);

  console.log(`\n#${round + 1}` + (banned.length ? `  (without ${banned[banned.length - 1]})` : '  as it comes'));
  console.log(`    cost ${(bill / orders).toFixed(2)} an order, ${(units / orders).toFixed(2)} units, ` +
    `${plan.steps.length} steps, ${(waste / orders).toFixed(1)} left over`);
  console.log(`    buys  ${plan.frontier.map((f) => `${f.name}×${rstr(f.amount)}`).join(', ') || 'nothing'}`);

  const off = plan.steps
    .filter((s) => !c.ideal.includes(s.process.id) && !seen.has(s.process.id))
    .sort((a, b) => rnum(b.runs) - rnum(a.runs));
  console.log(`    strays ${off.slice(0, 4).map((s) => s.process.id).join(', ') || '(none -- it is the ideal)'}`);

  if (!off.length) break;
  banned.push(off[0].process.id);
  seen.add(off[0].process.id);
}
