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
import { solveFresh, phaseGroup, chamberShares, withElements,
         normalizeFresh } from '../src/plan-fresh.js';
import { rnum, rzero, rstr } from '../src/rational.js';
import { composition } from '../src/composition.js';
import { CASES, NEVER } from './cases.mjs';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const graph = buildProcessGraph(await loadData());
// Which elements a material carries, so an invariant can ask.
const table = composition(graph);
const carries = (name, el) => table.get(name)?.elements?.has(el) ?? false;
// Whether two materials are the same substance in different states, so an
// invariant can say "do not ask me to start with the thing I am making".
const sameStuff = (a, b) => phaseGroup(graph, a) === phaseGroup(graph, b);
/**
 * The planner's own rule, asked from outside: does this material contain every
 * element of something the plan was told to make? Mirrors `holdsATarget`,
 * which is what the shopping list and the charge both consult.
 */
const holdsAWant = (p, name) => {
  const has = table.get(name)?.elements;
  if (!has) return false;
  return p.spec.targets.some((t) => {
    const want = table.get(t.name)?.elements;
    return want && want.size && [...want].every((el) => has.has(el));
  });
};
// The chamber a reaction shares, as the planner sees it for this plan: the
// branches tied to each other, at the rounded split, with the too-rare ones
// left out.
const chamber = (p, id) => chamberShares(graph, id, p.spec.wanted);
const helpers = { rnum, rzero, rstr, carries, sameStuff, holdsAWant, chamber };
const budget = Number(process.env.FRESH_BUDGET || 240000);

let met = 0, missed = 0, broke = 0;

/**
 * The chambers, before any plan is solved.
 *
 * Sparr: 52:50:51 should be 1:1:1 at a five per cent margin, and anything one
 * in a hundred or less is nought unless the rare thing is what you asked for.
 * Both halves are checked here because both are claims about the game rather
 * than about any one question put to it.
 */
console.log('--- chambers');
const shownAs = (id, wanted) => {
  const c = chamberShares(graph, id, wanted);
  return c ? `${c.ids.map((x, i) => rstr(c.chances[i])).join(':') || '-'}` : 'none';
};
const wantedFor = (names) => withElements(graph, normalizeFresh({
  targets: names.map((n) => ({ name: n, amount: 1 })), have: ['Lepidolite'] })).wanted;
const wantSi = wantedFor(['Silicon']);
const wantTa = wantedFor(['Tantalum']);
const chamberChecks = [
  ['the three Lepidolite branches round 52:50:51 to even thirds',
   shownAs('rx:Lepidolite Decomposition - Potassium', wantSi) === '1/3:1/3:1/3'],
  ['and a genuinely lopsided chamber keeps its shape',
   shownAs('rx:Calcium Sulfide Roasting to Calcium Sulfate', wantSi) === '8/13:5/13'],
  ['a branch that fires once in ten thousand is pinned to none',
   chamberShares(graph, 'rx:Compost from Fallen Leaves', wantSi)
     .zeroed.includes('rx:Compost from Fallen Leaves')],
  ['a branch that never fires is pinned too, when nobody wants what it makes',
   chamberShares(graph, 'rx:Silica Reduction', wantTa).zeroed.includes('rx:Silica Reduction')],
  ['but not when it is the only way to the thing being asked for',
   !chamberShares(graph, 'rx:Silica Reduction', wantSi).zeroed.length],
];
for (const [what, ok] of chamberChecks) {
  console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}`);
  if (ok) met++; else broke++;
}
console.log('');

for (const c of CASES) {
  console.log(`\n--- ${c.id}: ${c.about}`);
  console.log(`      ${c.url}`);
  const started = Date.now();
  let plan = null, err = null;
  try {
    plan = solveFresh(graph, { targets: c.plan.targets.map((t) => ({ name: t, amount: 1 })),
                               have: c.plan.have || [],
                               ...(c.plan.sources ? { sources: c.plan.sources } : {}) });
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

  /**
   * What the case hopes for is scored; what must never happen is enforced.
   *
   * This file was written as an instrument rather than a suite -- how much of
   * what the reader wants falls out on its own -- and that is still what
   * `want` is for. The NEVER list is a different thing: those are not
   * aspirations, and a plan that breaks one is wrong however well it scores,
   * so the run fails on them and only on them.
   */
  for (const [label, test] of c.want) {
    let ok = false;
    try { ok = !!test(plan, helpers); } catch { ok = false; }
    console.log(`      ${ok ? 'MET  ' : 'MISS '} ${label}`);
    if (ok) met++; else missed++;
  }
  /**
   * A known break is named in the case and does not fail the run -- but it has
   * to still be broken. One that starts passing is a note nobody removed, and
   * a stale note is worse than none, so that fails instead.
   */
  for (const [label, test] of NEVER) {
    const known = c.knownBroken?.[label];
    let ok = false;
    try { ok = !!test(plan, helpers); } catch (e) {
      if (known) { console.log(`      KNOWN ${label} -- ${known}`); continue; }
      console.log(`      BROKE ${label} -- threw: ${e.message}`);
      broke++; continue;
    }
    if (ok && known) {
      console.log(`      STALE ${label} -- holds now; drop it from knownBroken`);
      broke++;
    } else if (!ok && known) {
      console.log(`      KNOWN ${label} -- ${known}`);
    } else if (!ok) {
      console.log(`      BROKE ${label}`);
      broke++;
    }
  }
}
console.log(`\n${met} met, ${missed} missed, ${broke} broken`);
process.exit(broke ? 1 : 0);
