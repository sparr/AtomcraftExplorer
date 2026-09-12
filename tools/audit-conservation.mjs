/**
 * Which plans create matter, how much, and which recipe does it.
 *
 *   node tools/audit-conservation.mjs
 *
 * Counted, not guessed at. The bench in `phase-corpus.mjs` asks which elements
 * appear in what a plan hands back but in nothing it was given, which
 * over-reports badly: a purchased material whose formula omits its water reads
 * as minting hydrogen. This sums the actual element balance of every step
 * instead -- production minus consumption over the whole batch -- which needs
 * no reference to the shopping list, because whatever was bought enters as some
 * step's input and is counted there.
 *
 * A plan creates element E exactly when that sum is positive. Losing matter is
 * not creating it and is not reported. Where a material in a step has no
 * formula the element cannot be counted at all, and the plan is filed under
 * `cannot say` rather than either of the other two.
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { solveFresh } from '../src/plan-fresh.js';
import { atomsIn } from '../src/minting.js';
import { rnum } from '../src/rational.js';
import { CASES } from './cases.mjs';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const db = await loadData();
const graph = buildProcessGraph(db);
const every = Number(process.env.AUDIT_EVERY || 8);
const inputsOf = (p) => [...p.consumes, ...p.requires];

/** Every element any formula in the game names. */
const ELS = [...new Set(db.materials.flatMap((m) => {
  const out = [];
  const walk = (xs) => { for (const n of xs) {
    if (n.k === 'el') out.push(n.sym);
    else if (n.k === 'group') n.branches.forEach(walk);
  } };
  if (m.formula?.ast) walk(m.formula.ast);
  return out;
}))];

const specs = CASES.map((c) => ({ id: `case:${c.id}`, spec: {
  targets: c.plan.targets.map((n) => (typeof n === 'string' ? { name: n, amount: 1 } : n)),
  have: c.plan.have || [],
} }));
const makeable = db.materials.map((m) => m.name)
  .filter((n) => (graph.producers(n) || []).length).sort();
for (let i = 0; i < makeable.length; i += every) {
  specs.push({ id: makeable[i], spec: { targets: [{ name: makeable[i], amount: 1 }] } });
}

const NUCLEAR = new Set(['beam', 'decay']);
const tally = { clean: 0, nuclear: 0, cannotSay: 0, creates: 0, noPlan: 0 };
const blame = new Map();          // "process|element" -> plans it does it in
const byElement = new Map();      // element -> plans it is created in
const worst = [];

for (const { id, spec } of specs) {
  let plan = null;
  try { plan = solveFresh(graph, spec); } catch { plan = null; }
  if (!plan || !plan.steps.length) { tally.noPlan++; continue; }
  if (plan.steps.some((s) => NUCLEAR.has(s.process.kind))) { tally.nuclear++; continue; }
  const net = new Map();
  const per = new Map();          // element -> [[step, net]] where net > 0
  let blind = false;
  for (const s of plan.steps) {
    const q = s.process;
    const runs = rnum(s.runs);
    for (const el of ELS) {
      let d = 0;
      for (const o of q.produces) {
        const a = atomsIn(graph, o.name, el);
        if (a === null) { blind = true; continue; }
        d += a * o.count;
      }
      for (const c of inputsOf(q)) {
        const a = atomsIn(graph, c.name, el);
        if (a === null) { blind = true; continue; }
        d -= a * c.count;
      }
      if (!d) continue;
      net.set(el, (net.get(el) || 0) + d * runs);
      if (d > 0) {
        if (!per.has(el)) per.set(el, []);
        per.get(el).push([q.id, d * runs]);
      }
    }
  }
  if (blind) { tally.cannotSay++; continue; }
  const gained = [...net].filter(([, n]) => n > 1e-9);
  if (!gained.length) { tally.clean++; continue; }
  tally.creates++;
  worst.push({ id, gained: gained.map(([el, n]) => `${el}+${n}`).join(' ') });
  for (const [el] of gained) {
    byElement.set(el, (byElement.get(el) || 0) + 1);
    for (const [step] of per.get(el) || []) {
      const key = `${step}|${el}`;
      if (!blame.has(key)) blame.set(key, new Set());
      blame.get(key).add(id);
    }
  }
}

const answered = specs.length - tally.noPlan;
console.log(`${specs.length} questions, ${answered} answered\n`);
console.log(`  clean, counted            ${tally.clean}`);
console.log(`  create an element         ${tally.creates}`);
console.log(`  transmute (beam or decay) ${tally.nuclear}`);
console.log(`  cannot say (no formula)   ${tally.cannotSay}`);

console.log('\nelement created, by how many plans:');
for (const [el, n] of [...byElement].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${el.padEnd(4)} ${n}`);
}
console.log('\nthe recipes responsible, by how many plans each spoils:');
const ranked = [...blame].sort((a, b) => b[1].size - a[1].size);
for (const [key, plans] of ranked) {
  const [step, el] = key.split('|');
  console.log(`   ${String(plans.size).padStart(3)}  ${el.padEnd(3)} ${step}`);
}
console.log('\nthe plans, worst first:');
for (const w of worst.sort((a, b) => b.gained.length - a.gained.length).slice(0, 25)) {
  console.log(`   ${w.id.padEnd(34)} ${w.gained}`);
}
