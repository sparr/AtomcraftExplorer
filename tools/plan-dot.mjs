/**
 * A plan, as DOT, from the same address the page uses.
 *
 *   node tools/plan-dot.mjs '#mode=plan&t=Tantalum~Niobium&h=Columbite' [--materials] [--tb]
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { solveFresh } from '../src/plan-fresh.js';
import { balanceTargets } from '../src/balance.js';
import { readPlan } from '../src/plan-state.js';
import { planToDot } from '../src/plan-dot.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const args = process.argv.slice(2);
const hash = args.find((a) => !a.startsWith('--')) ?? '#mode=plan&t=Carbon&h=Carbon+Dioxide';
const materials = args.includes('--materials');
const engine = args.includes('--neato') ? 'neato' : 'dot';
const rankdir = args.includes('--tb') ? 'TB' : 'LR';

const graph = buildProcessGraph(await loadData());
const plan0 = readPlan(new URLSearchParams(hash.replace(/^#/, '')));
const ask = {
  targets: plan0.targets, have: plan0.have, kinds: plan0.kinds, sources: plan0.sources,
  excludeProcesses: plan0.excludeProcesses, excludeMaterials: plan0.excludeMaterials,
  noFetch: plan0.noFetch, noPrime: plan0.noPrime, kept: plan0.kept,
  avoidSideEffects: plan0.avoidSideEffects, keepLeftovers: plan0.keepLeftovers,
  oreTries: plan0.oreTries,
};
const targets = plan0.balance ? balanceTargets(graph, ask, solveFresh) : plan0.targets;
const plan = solveFresh(graph, { ...ask, targets });
if (!plan) { console.error('no plan'); process.exit(1); }
process.stdout.write(planToDot(plan, { materials, rankdir, engine }));
