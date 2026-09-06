/**
 * Where a wanted step falls out.
 *
 * `IDEAL-PLANS.md` says which reactions a right answer uses. This says, for
 * each of them, how far it got: whether the graph has it at all, whether the
 * candidate walk kept it, whether the shortlist chose it, whether the plan ran
 * it. A step that never reaches the simplex was never rejected -- it was never
 * offered -- and those two failures want fixing in different places.
 *
 * Run: node tools/why-not.mjs [case-id]
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph, DEFAULT_KINDS } from '../src/plan-graph.js';
import { solveFresh, subgraph, shortlist, model, normalizeFresh, fetchable }
  from '../src/plan-fresh.js';
import { rnum, rstr } from '../src/rational.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

/** The edges `IDEAL-PLANS.md` says each answer turns on. */
const CARBON_LOOP = [
  'rx:Molten Potassium + Carbon Dioxide',
  'rx:Potassium Oxide + Water',
  'rx:Molten Potassium Hydroxide Electrolysis',
  'rx:Hydrogen Combustion',
  'cond:Steam',
];

const WANTED = [
  {
    id: 'co2-to-carbon',
    targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Dioxide'],
    edges: CARBON_LOOP,
  },
  {
    id: 'co-to-carbon',
    targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Monoxide'],
    edges: ['rx:Boudouard Equilibrium 500-725K', ...CARBON_LOOP],
  },
  {
    id: 'lepidolite',
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite'],
    edges: ['rx:Lepidolite Decomposition', 'rx:Lepidolite Decomposition - Lithium',
            'rx:Lepidolite Decomposition - Potassium',
            'rx:Silica Reduction', 'rx:Molten Alumina Reduction',
            'rx:Boudouard Equilibrium 500-725K', ...CARBON_LOOP],
  },
  {
    id: 'columbite',
    targets: [{ name: 'Tantalum', amount: 1 }, { name: 'Niobium', amount: 1 }],
    have: ['Columbite'],
    edges: ['rx:Hydrofluoric Acid Dissolves Columbite',
            'rx:Heptafluorotantalic Acid + Aqueous Potassium Hydroxide',
            'rx:Heptafluoroniobic Acid + Aqueous Potassium Hydroxide',
            'rx:Aqueous Potassium Heptafluorotantalate(V) + Water',
            'rx:Aqueous Potassium Heptafluoroniobate(V) + Water',
            'rx:Tantalum Pentoxide Reduction', 'rx:Niobium Pentoxide Reduction',
            'rx:Boudouard Equilibrium 500-725K', ...CARBON_LOOP],
  },
];

const graph = buildProcessGraph(await loadData());
const only = process.argv[2];

for (const c of WANTED) {
  if (only && c.id !== only) continue;
  const spec = normalizeFresh({ targets: c.targets, have: c.have });
  const sub = subgraph(graph, spec);
  const inSub = new Set(sub.processes.map((p) => p.id));

  const short = shortlist(graph, spec, sub, (procs, mats) => model(graph, spec, procs, mats));
  const inShort = new Set((short?.processes || []).map((p) => p.id));

  const plan = solveFresh(graph, { targets: c.targets, have: c.have });
  const ran = new Map((plan?.steps || []).map((s) => [s.process.id, s.runs]));

  console.log(`\n--- ${c.id}: ${sub.processes.length} considered, ` +
    `${short ? short.processes.length : 'no'} shortlisted, ` +
    `${plan ? plan.steps.length : 'no'} run`);

  for (const id of c.edges) {
    const p = graph.byId.get(id);
    let verdict;
    if (!p) verdict = 'NOT IN THE GRAPH -- wrong id?';
    else if (!spec.kinds.has(p.kind)) verdict = `kind "${p.kind}" is switched off`;
    else if (!inSub.has(id)) verdict = 'NEVER OFFERED -- the candidate walk did not keep it';
    else if (!short) verdict = 'offered, but the shortlist pass failed outright';
    else if (!inShort.has(id)) verdict = 'offered and NOT CHOSEN -- the simplex saw it and said no';
    else if (!ran.has(id)) verdict = 'shortlisted but dropped by the step-elimination';
    else verdict = `RUN ${rstr(ran.get(id))}x`;
    const mark = verdict.startsWith('RUN') ? 'ok  ' : '    ';
    console.log(`  ${mark}${id.padEnd(52)} ${verdict}`);
  }
}
