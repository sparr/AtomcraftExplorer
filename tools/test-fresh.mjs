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
import { balanceTargets } from '../src/balance.js';
import { solveFresh, phaseGroup, chamberShares, withElements,
         normalizeFresh, fetchable, subgraph } from '../src/plan-fresh.js';
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
/**
 * The ground itself: static, and filed as landscape rather than as a material
 * you could carry. Mirrors `landscape` in the solver, asked from outside.
 */
const ground = (name) => graph.stateOf(name) === 'Static' &&
  ['deposit', 'terrain'].includes(graph.categoryOf(name));
const helpers = { rnum, rzero, rstr, carries, sameStuff, holdsAWant, chamber, ground };
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
/**
 * The ground, before any plan is solved.
 *
 * Sparr: deposits are never inputs, they cannot be fetched. Checked here
 * rather than only through the cases, because none of the seven asks a
 * question whose best answer is a tile of the world -- the fault showed up
 * when a plan was told not to buy Lepidolite and went shopping for twelve
 * Fluorite Deposits instead. A rule nothing exercises is a rule that quietly
 * stops working, so this asks the solver's two gates directly.
 */
console.log('--- the ground');
{
  const spec = normalizeFresh({ targets: [], have: [] });
  const canBuy = (n) => fetchable(graph, n, spec.kinds, spec.sources, spec);
  const dirt = graph.db.materials.map((m) => m.name).filter(ground);
  const forSale = dirt.filter(canBuy);
  // Told to make niobium out of columbite and nothing else, the walk once kept
  // 22 melts of unmined rock -- `evap:Hematite Deposit` among them.
  const asked = withElements(graph, normalizeFresh({
    targets: [{ name: 'Tantalum', amount: 1 }, { name: 'Niobium', amount: 1 }],
    have: ['Columbite'] }));
  const eaters = subgraph(graph, asked).processes
    .filter((p) => (p.consumes || []).some((i) => ground(i.name)));
  const groundChecks = [
    [`none of the ${dirt.length} tiles of landscape can be fetched`, !forSale.length,
     forSale.slice(0, 3).join(', ')],
    // Not by category alone: two things filed under `deposit` are Solid, loose
    // and no more landscape than any other ore. Whether either is *worth*
    // fetching is a separate question -- both have recipes -- but the rule
    // must not be what stops them.
    ['while the two loose things filed under deposit are not landscape',
     ['Galena Gravel', 'Pneumatocyst'].every((n) =>
       graph.categoryOf(n) === 'deposit' && !ground(n)), ''],
    ['and no candidate step puts one in a reactor', !eaters.length,
     eaters.slice(0, 3).map((p) => p.id).join(', ')],
  ];
  for (const [what, ok, detail] of groundChecks) {
    console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}${ok || !detail ? '' : ` -- ${detail}`}`);
    if (ok) met++; else broke++;
  }
  console.log('');
}

/**
 * That the pass which closes a loop is still alive.
 *
 * Not a claim about the game -- a guard against a way of breaking the solver
 * that nothing else here notices. Pricing the caps on that pass consistently
 * made them say "the closed answer must cost no more than the open one",
 * which closing never does, so the pass fired zero times and the Columbite
 * plan went back to buying four Magnesium Fluoride and eight Potassium and
 * venting both. Every invariant still passed: the dead answer is *cheaper*,
 * it carries no carbon, and no rule stated anywhere said it was wrong.
 *
 * "Buys no element it also vents" would be the honest general rule and it is
 * not true of any plan that buys an ore -- Columbite fetches Lepidolite and
 * throws away its potassium, lithium, silicon, aluminium and fluorine. So the
 * check is this narrow one, on the one question where the cheap answer is a
 * pile of pure carriers.
 */
console.log('--- closing a loop');
{
  const shut = [];
  solveFresh(graph, { targets: [{ name: 'Tantalum', amount: 4 }, { name: 'Niobium', amount: 4 }],
                      have: ['Columbite'], sources: ['world', 'weather', 'air', 'made'],
                      notes: shut });
  const closed = shut.filter((n) => n.startsWith('closed the'));
  const ok = closed.length > 0;
  console.log(`      ${ok ? 'MET  ' : 'BROKE'} the plan closes a loop rather than buying what it vents` +
              `${ok ? ` (${closed.length})` : ' -- the repair pass fired not once'}`);
  if (ok) met++; else broke++;
  console.log('');
}

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

/**
 * Starting from nothing, where exactly one ore may be bought.
 *
 * Sparr: the solver should be allowed to fetch a single material with the want
 * atoms if nothing held has them. Before this, holding nothing meant no answer
 * at all -- the only boron in the game arrives as Borax, and Borax carries
 * boron, so the shopping list refused it and the question had no reply.
 */
console.log('--- starting from nothing');
const fromNothing = (name) => solveFresh(graph, { targets: [{ name, amount: 1 }] });
const boron = fromNothing('Boron Oxide');
const iron = fromNothing('Iron');
const oreChecks = [
  ['Boron Oxide can be made after all, from bought Borax',
   !!boron && boron.frontier.some((f) => f.name === 'Borax')],
  ['and exactly one thing carrying the answer is bought',
   !!boron && boron.frontier.filter((f) => holdsAWant(boron, f.name)).length === 1],
  ['iron too, and not by simply buying iron',
   !!iron && iron.steps.length > 0 &&
     !iron.frontier.some((f) => sameStuff(f.name, 'Iron'))],
  ['and the ore still has to be worked, not just carried home',
   !!iron && iron.steps.filter((s) => s.process.kind !== 'phase').length > 0],
];
for (const [what, ok] of oreChecks) {
  console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}`);
  if (ok) met++; else broke++;
}
/**
 * The primer comes from the chain, never from the player.
 *
 * Sparr: the lithium chloride that starts the loop should come from the chain
 * that leads to the lithium, and the player should hand over nothing carrying
 * what they asked for. The combined factory's lithium sits in a wheel --
 * `LiCl -> molten -> chlorine -> hydrochloric acid -> LiCl` -- and two of its
 * four links carry no lithium at all. Seeded with chlorine gas the chain makes
 * its own lithium chloride; seeded with lithium chloride the player is
 * supplying the lithium.
 *
 * So a want-bearing charge is ranked last, not merely allowed. It briefly was
 * not, and the plan reached for two Lithium Chloride because that charge is one
 * atom lighter than the chlorine and nothing said lighter was not the point.
 */
/**
 * The temperature narrowing, ported from the older planner.
 *
 * A reaction runs in a chamber holding its inputs and outputs, and those are
 * the ingredients of other reactions -- hold it in one of their ranges and you
 * get those too. This used to report each range as written with nothing
 * dodged, which the page drew as "nothing else happens here" when it meant
 * "nobody looked".
 */
console.log('--- holding the chamber');
{
  const ask = { targets: ['Potassium', 'Lithium', 'Aluminum', 'Silicon']
                  .map((n) => ({ name: n, amount: 1 })), have: ['Lepidolite'] };
  const on = solveFresh(graph, ask);
  const off = solveFresh(graph, { ...ask, avoidSideEffects: false });
  const narrowed = on.steps.filter((s) => s.window.narrowed).length;
  const sig = (p) => p.steps.map((s) => `${s.process.id}x${rstr(s.runs)}`).sort().join(',');
  const checks = [
    ['ranges are trimmed to dodge what else would go off', narrowed > 0],
    ['and say what they dodged', on.sideEffects.length > 0],
    ['the apparatus knows it was narrowed', on.apparatus.narrowedBySideEffects === true],
    ['refused, nothing is trimmed', off.steps.every((s) => !s.window.narrowed)],
    ['and nothing is claimed to have been dodged', off.sideEffects.length === 0],
    ['either way the plan itself is the same', sig(on) === sig(off)],
  ];
  for (const [what, ok] of checks) {
    console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}`);
    if (ok) met++; else broke++;
  }
}
console.log('');

console.log('--- what starts the wheel');
const startChecks = [];
{
  const ask = { targets: ['Tantalum', 'Niobium', 'Potassium', 'Lithium']
                  .map((n) => ({ name: n, amount: 1 })),
                have: ['Columbite', 'Lepidolite'], sources: ['world'] };
  const p = solveFresh(graph, ask);
  const charge = (p.priming || []).map((x) => x.name);
  startChecks.push(['the combined factory starts on chlorine, not lithium chloride',
                    charge.includes('Chlorine Gas') && !charge.includes('Lithium Chloride')]);
}
for (const c of CASES) {
  const ask = { targets: c.plan.targets.map((t) => ({ name: t, amount: 1 })),
                have: c.plan.have || [],
                ...(c.plan.consume ? { consume: c.plan.consume } : {}),
                ...(c.plan.sources ? { sources: c.plan.sources } : {}) };
  let p = null;
  try { p = solveFresh(graph, ask); } catch { p = null; }
  startChecks.push([`${c.id} is started on nothing it was asked to make`,
                    !!p && !(p.priming || []).some((x) => holdsAWant(p, x.name))]);
}
for (const [what, ok] of startChecks) {
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
    /**
     * The way the page asks it, which is not what this used to do.
     *
     * Two things were being dropped on the floor. `consume` and `takeCharges`
     * never reached the solver, so `co-to-carbon-used-up` was never actually
     * told to use the carbon dioxide up and was then marked down for not
     * having done so. And the amounts were left at one apiece rather than
     * balanced, so what got measured was the solver's own batch scaling --
     * Lepidolite came out 2/2/2/2 and was read as failing to reach 2/2/2/3,
     * which it reaches perfectly well when it is asked to.
     *
     * Balancing costs a few dozen solves per case, about thirty seconds across
     * the seven. Worth it: the old solver's harness has always asked this way,
     * and a suite that asks a different question from the page is measuring
     * something nobody uses.
     */
    const ask = { targets: c.plan.targets.map((t) => ({ name: t, amount: 1 })),
                  have: c.plan.have || [],
                  ...(c.plan.consume ? { consume: c.plan.consume } : {}),
                  ...(c.plan.takeCharges ? { takeCharges: true } : {}),
                  ...(c.plan.sources ? { sources: c.plan.sources } : {}) };
    plan = solveFresh(graph, { ...ask, targets: balanceTargets(graph, ask, solveFresh) });
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
