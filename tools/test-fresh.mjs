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
 * A charge borrowed from the wheel, not fetched from outside.
 *
 * Sparr: it is fine to prime a loop with something the reactor produces
 * indefinitely, as long as it is not needed before it is ever produced. The
 * reactor can use some of the Hydrofluoric Acid the Lepidolite hands back to
 * prime the acid loop that reduces the niobium and tantalum salts.
 *
 * It could not, because a charge was priced as a purchase: out of reach unless
 * you could go and buy it, and Hydrofluoric Acid with Fluorine Gas on the
 * order is barred from being bought. So the acid the plan makes every cycle
 * cost a million, and the plan laid in Aqueous Potassium Heptafluoroniobate(V)
 * instead -- a niobium salt, to make niobium.
 *
 * What the plan makes is now affordable to start with. Wanting a want is still
 * ranked last, which is what keeps the Lepidolite wheel starting on chlorine
 * rather than lithium chloride; when every member of a wheel carries a want,
 * as here, the ordinary price ranking decides and the acid at five beats the
 * salt.
 */
/**
 * Sparr: condensing steam to water is free if it is going into a reactor at
 * water temperatures, just like any other phase change.
 *
 * So it is not something a reader can decline. Offered as a tick box, a plan
 * told that steam may not become water went round by Sulfur Trioxide, Zinc
 * Oxide and Zinc Sulfate Decomposition -- three reactions to do what cooling
 * does by itself.
 */
/**
 * Sparr: how do we explain to the solver that some charges amortize away?
 *
 * By running the factory without each one, at the size asked for and at twice
 * that. A charge is laid in once however long the plant runs, so a cost that
 * is the same at both sizes was filling the pipe, and one that doubles with
 * the plant is holding it up.
 */
console.log('--- what each charge is buying');
{
  const alu = solveFresh(graph, { targets: [{ name: 'Aluminum', amount: 1 }],
                                  have: ['Lepidolite'], sources: ['world'] });
  const checks = [
    ['every charge says whether it is holding the plan up',
     alu.primingAll.length > 0 && alu.primingAll.every((c) => typeof c.holdsUp === 'boolean'
                                                           && typeof c.lag === 'number')],
    /**
     * Some of these charges start a closed wheel -- the only maker of the
     * material is fed by what it makes -- so nothing outside ever turns it and
     * no amount of running helps. Which material that is depends on the route,
     * and this plan has more than one of equal cost, so the check is that at
     * least one charge is called out rather than that a named one is.
     */
    ['at least one charge is holding the plan up',
     alu.primingAll.some((c) => c.holdsUp === true)],
    /**
     * And at least one is not: its chain reaches something fetched, so it does
     * arrive, later than it is first wanted.
     *
     * Named by the property rather than by the material, for the same reason
     * the check above it is. This said "the Carbon, whose chain reaches
     * fetched Dolomite, does not" -- and the plan buys Limestone Gravel rather
     * than Dolomite, and its carbon loop closes exactly, three made against
     * three spent, so a charge that seeds that loop is the expected answer and
     * not a fault. Sparr, on the plan that does it: three in and three out
     * needing a charge of one to three carbon is a perfectly fine outcome.
     */
    ['at least one charge is not holding the plan up',
     alu.primingAll.some((c) => c.holdsUp === false)],
    /**
     * So the reader is sent out for those and not the others, and told what
     * the first cycle costs while the plant fills its own pipes.
     */
    ['exactly the charges that hold the plan up are asked for',
     alu.priming.map((c) => c.name).sort().join() ===
     alu.primingAll.filter((c) => c.holdsUp).map((c) => c.name).sort().join()],
    ['the rest are the plant getting itself going, with the lag said out loud',
     alu.warmup.length > 0 && alu.warmup.every((c) => c.holdsUp === false) &&
     alu.warmupLag === alu.warmup.reduce((a, c) => Math.max(a, c.lag || 0), 0)],
  ];
  for (const [what, ok] of checks) {
    console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}`);
    if (ok) met++; else broke++;
  }
  console.log('');
}

/**
 * Sparr: Limestone Gravel can be mined out of terrain, so it counts as world
 * stuff and not made stuff.
 *
 * The door rule -- a thing with a recipe is a thing you are meant to make --
 * could not see that it also comes off a limestone tile with a pick. So a plan
 * for Steel could not buy the gravel that carries a carbon for five atoms, and
 * bought Dolomite instead at twenty atoms for the same carbon, to crack the
 * gravel out of it.
 */
/**
 * Sparr: Sand and Dirt spawn loose on the ground, limited like an ore but with
 * no mining step in between.
 *
 * Nothing in the material table says so, so it is written down beside the rain
 * for the same reason. Without it a plan for Glass could not buy sand -- every
 * route to sand is a reaction -- and bought seven Bertrandite to crack two out
 * of instead.
 */
console.log('--- what is lying on the ground can be picked up');
{
  const kinds = new Set(['reaction', 'filter', 'phase', 'fire', 'grow', 'decay']);
  const world = new Set(['world']);
  const glass = solveFresh(graph, { targets: [{ name: 'Glass', amount: 1 }],
                                    have: [], sources: ['world'] });
  const checks = [
    ['sand may be picked up, though every recipe for it is a reaction',
     fetchable(graph, 'Sand', kinds, world)],
    ['so Glass melts sand rather than cracking it out of Bertrandite',
     glass.steps.length === 2 && glass.frontier.every((f) => f.name === 'Sand')],
  ];
  for (const [what, ok] of checks) {
    console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}`);
    if (ok) met++; else broke++;
  }
  console.log('');
}

console.log('--- what comes out of the ground can be bought, recipe or no');
{
  const kinds = new Set(['reaction', 'filter', 'phase', 'fire', 'grow', 'decay']);
  const world = new Set(['world']);
  const steel = solveFresh(graph, { targets: [{ name: 'Steel', amount: 1 }],
                                    have: [], sources: ['world'] });
  const bought = steel.frontier.map((f) => f.name);
  const atoms = steel.frontier.reduce(
    (a, f) => a + Number(f.amount.n) / Number(f.amount.d)
      * (graph.db.byName.get(f.name)?.matter ?? 1), 0);
  const checks = [
    ['Limestone Gravel, which a pick takes off a limestone tile, may be bought',
     fetchable(graph, 'Limestone Gravel', kinds, world)],
    /**
     * And the tile itself may not, whatever is done to it: `landscape` still
     * refuses the ground, which is the rule this one has to live beside.
     */
    ['the limestone it comes off may not, being the ground',
     !fetchable(graph, 'Limestone', kinds, world)],
    ['so Steel buys the gravel rather than Dolomite to crack it out of',
     bought.includes('Limestone Gravel') && !bought.includes('Dolomite')],
    /**
     * The weight, not the route -- the route is the check above.
     *
     * This read `<= 26` against "46 atoms before", and both figures were
     * computed with a Hematite that weighed one atom. It weighs five, which is
     * what `Fe2O3` comes to: `assignMatter` was following ore smelting
     * backwards as though it were a phase change, and anchoring the iron group
     * on whichever member it reached first. Six Hematite and four Limestone
     * Gravel is the same shopping list it always was, and it comes to fifty.
     *
     * The 46 it was being compared against was counted the same wrong way, so
     * there is no honest comparison to restate -- only the corrected weight of
     * the list the plan actually buys.
     */
    ['and its shopping list weighs what the ore in it weighs', atoms <= 50],
  ];
  for (const [what, ok] of checks) {
    console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}`);
    if (ok) met++; else broke++;
  }
  console.log('');
}

console.log('--- what a material does at a temperature is not on offer');
{
  const withoutPhase = solveFresh(graph, {
    targets: [{ name: 'Water', amount: 1 }], have: ['Steam'],
    kinds: ['reaction', 'filter', 'fire', 'grow', 'decay'] });
  const ok = withoutPhase?.steps?.length === 1 &&
    withoutPhase.steps[0].process.kind === 'phase';
  console.log(`      ${ok ? 'MET  ' : 'BROKE'} steam still condenses when phase changes `
              + `are unticked (${withoutPhase?.steps?.length ?? 0} steps)`);
  if (ok) met++; else broke++;
  console.log('');
}

console.log('--- starting a wheel on what it makes');
{
  const both = ['Columbite', 'Lepidolite'];
  const ask = (names) => solveFresh(graph, {
    targets: names.map(([name, amount]) => ({ name, amount })), have: both });
  const primes = (p) => p.priming.map((c) => c.name);
  // What a charge weighs, which is the only thing the pass is trying to make
  // small: atoms the reader has to lay their hands on before starting.
  const weigh = (charge) => charge.reduce(
    (a, c) => a + Number(c.amount.n) / Number(c.amount.d) * (graph.db.byName.get(c.name)?.matter ?? 0), 0);

  const metals = ask([['Tantalum', 2], ['Niobium', 2]]);
  const andF2 = ask([['Tantalum', 2], ['Niobium', 2], ['Fluorine Gas', 1]]);
  /**
   * And the amounts are the proportion the ore gives, not the one typed.
   *
   * One of each comes back quoted at twelve of each on forty-eight Lepidolite.
   * Two, two and one is four, four and two on twelve -- 28 atoms a thing
   * against 33 -- and it is what the ore hands out: the Columbite chain leaves
   * two Hydrofluoric Acid a cycle, which electrolyses to one Fluorine Gas.
   */
  const balanced = balanceTargets(graph,
    { targets: [{ name: 'Tantalum', amount: 1 }, { name: 'Niobium', amount: 1 },
                { name: 'Fluorine Gas', amount: 1 }], have: both }, solveFresh);
  const wheelChecks = [
    ['the amounts come out in the proportion the ore gives, two to two to one',
     balanced.map((t) => t.amount).join('/') === '4/4/2'],
    ['asking for the fluorine as well adds only the electrolysis',
     andF2.steps.some((s) => /Electrolysis Hydrofluoric Acid/i.test(s.process.label)) &&
     metals.steps.every((s) => andF2.steps.some((t) => t.process.id === s.process.id))],
    /**
     * And nothing fluorine-bearing is asked for at all.
     *
     * First it wanted a niobium salt, which is the answer laid in to make the
     * answer. Making what the plan produces affordable to start with got it
     * down to two Hydrofluoric Acid, which was fair -- the acid is on the
     * wheel and comes back every turn. Sparr: it should be priming that loop
     * from the acid it is generating. It has twelve of it from the ore, and
     * was spending four on the electrolysis before the dissolution that the
     * rest of the factory waits on. Ordered by which step has the most left to
     * get through, the dissolution takes what it needs and the charge goes.
     */
    ['and the acid loop needs no charge at all, being fed by the ore',
     !primes(andF2).some((n) => /Hydrofluoric/.test(n))],
    ['nor a niobium or tantalum salt, to make niobium and tantalum',
     !primes(andF2).some((n) => /Heptafluoro/.test(n))],
    /**
     * Sparr: why does this need water primers when it has water leftovers?
     *
     * It did not. The plan makes twenty-three water and spends twenty; the
     * one it asked to be handed bought a way out of a stall that a different
     * push earlier would have covered anyway, and the pass never looked back.
     * Now each charge is refused in turn and the whole thing re-run, and one
     * stands only if doing without it costs more. Four charges became one.
     */
    ['nothing is both asked for at the start and left at the end',
     !metals.priming.some((c) => metals.byproducts.some((b) => b.name === c.name)) &&
     !andF2.priming.some((c) => andF2.byproducts.some((b) => b.name === c.name))],
    /**
     * Sparr: no toll on the number of entries, the scoreboard will let the
     * reader pick between one errand and two.
     *
     * So the charge is weighed as stuff and nothing else, and what it has to
     * be is a bottom: refusing any one thing on the list must not come back
     * with a lighter list. This is the property the pass claims, checked
     * against the pass rather than against a remembered answer.
     */
    ['refusing any one thing it asks for gives nothing lighter',
     metals.priming.every((c) => {
       const other = solveFresh(graph, {
         targets: [{ name: 'Tantalum', amount: 2 }, { name: 'Niobium', amount: 2 }],
         have: both, noPrime: [c.name] });
       return !other || weigh(other.priming) >= weigh(metals.priming);
     })],
    /**
     * Each charge knows the reaction it starts, which is what lets the picture
     * draw one arrow instead of one per eater of the stuff.
     */
    ['each charge says which reaction it was laid in for',
     metals.priming.every((c) => c.forSteps?.length
       && c.forSteps.every((f) => metals.steps.some((st) => st.process.id === f.step)))],
  ];
  for (const [what, ok] of wheelChecks) {
    console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}`);
    if (ok) met++; else broke++;
  }
  console.log('');
}

/**
 * The same substance, in a state you can get back from.
 *
 * Sparr: "same stuff" should follow burning and extinguishing if it is a loop,
 * but not if burning then extinguishing produces a different material than the
 * start.
 *
 * Melting and boiling are always reversible, so following them is safe. Fire
 * mostly is not -- 534 of the 580 fire and decay transitions in the data are
 * one way -- and calling those the same substance would be plainly wrong. The
 * 46 that come back are 23 pairs of a thing and the same thing alight.
 *
 * It is the bar on buying the answer that needs this. Asked for Charcoal with
 * nothing in hand, the solver reached for a Charcoal (Burning) and let it go
 * out: one step, no work, and it read as an honest plan because nothing could
 * see that the two were the same coal.
 */
console.log('--- the same stuff in another state');
{
  const same = (a, b) => phaseGroup(graph, a) === phaseGroup(graph, b);
  const stateChecks = [
    ['a thing and the same thing alight are one substance', same('Charcoal', 'Charcoal (Burning)')],
    ['as are a liquid and its vapour', same('Water', 'Steam')],
    ['but a decay chain is not, however short', !same('Actinium-225', 'Francium-221')],
    ['nor is what burning leaves behind', !same('Wood', 'Charcoal')],
  ];
  /**
   * The rule from both ends, without trying to reconstruct which edges it
   * followed.
   *
   * Group membership cannot tell a pair this rule joined from one it inherited:
   * Liquid Methane and Methane (Burning) share a group because Liquid Methane
   * boils into Methane and Methane round-trips with its flame, and the oils
   * were one group before any of this through a chain of evaporations the
   * refinery shares. So the two directions are checked instead -- everything
   * fire can undo is one substance, and nothing decay touches is.
   */
  const burns = new Map();
  for (const p of graph.processes) {
    if (p.kind !== 'fire' && p.kind !== 'decay') continue;
    for (const i of p.consumes || []) {
      for (const o of p.produces) {
        if (!burns.has(i.name)) burns.set(i.name, new Set());
        burns.get(i.name).add(o.name);
      }
    }
  }
  const roundTrip = [];
  for (const [a, tos] of burns) {
    for (const b of tos) if (a !== b && burns.get(b)?.has(a)) roundTrip.push([a, b]);
  }
  stateChecks.push([`the ${roundTrip.length / 2} pairs fire can undo are each one substance`,
    roundTrip.length > 0 && roundTrip.every(([a, b]) => same(a, b))]);

  /**
   * And decay joins nothing, being the one-way case throughout.
   *
   * 534 of the 580 fire and decay transitions never come back, and the decay
   * chains are all of them: an atom that has decayed is a different element.
   * If any of those ever reads as one substance the rule has stopped being
   * about round trips.
   */
  const decayed = [];
  for (const p of graph.processes) {
    if (p.kind !== 'decay') continue;
    for (const i of p.consumes || []) {
      for (const o of p.produces) if (i.name !== o.name) decayed.push([i.name, o.name]);
    }
  }
  stateChecks.push([`and none of the ${decayed.length} decays makes one substance of two`,
    decayed.length > 0 && decayed.every(([a, b]) => !same(a, b))]);

  // The one that started it: no plan is better than a false one.
  const charcoal = solveFresh(graph, { targets: [{ name: 'Charcoal', amount: 1 }] });
  stateChecks.push(['so Charcoal is not made by buying some and putting it out',
    !charcoal]);
  for (const [what, ok] of stateChecks) {
    console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what}`);
    if (ok) met++; else broke++;
  }
  console.log('');
}

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
const fromNothing2 = (names) =>
  solveFresh(graph, { targets: names.map((name) => ({ name, amount: 1 })) });
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
  /**
   * And what it buys is put through something, rather than carried home.
   *
   * This used to demand a step that was not a phase change, on the reading
   * that melting a thing is not work. Melting an ore is exactly the work:
   * `Hematite melts into Molten Iron` is the game's smelter, five atoms in and
   * one metal out. With the workshop switched on by default the plan reaches
   * for it, which is right, and the claim worth keeping is the one this was
   * standing in for -- the ore does not simply become the answer by being
   * carried home. Its sibling above already says the ore is not the answer in
   * another phase; this says something happens to it.
   */
  /**
   * And the one it may buy is chosen for what it starts, not just its price.
   *
   * Asked for Lithium and Potassium there are fifty candidate ores, exactly
   * one carries both, and Lepidolite is forty-sixth of the fifty by price. Six
   * are tried, so the question had no answer at all -- while the ore that
   * answers it is the first thing anyone would reach for. Price still settles
   * ties, which is every candidate when there is one thing to make.
   */
  ['an ore that starts two of the wants is tried before a cheap one that starts one',
   !!fromNothing2(['Lithium', 'Potassium'])],
  /**
   * And having bought it, the plan uses it the way anyone would.
   *
   * Three ways per material is enough when you hold the ore: the routes
   * starting from what is in your hand rank high and survive the cut. It is
   * not enough when the ore has to be bought, because then it ranks like any
   * other purchase and its routes fall below -- all three Lepidolite
   * decompositions were pruned, and the answer came back as thirty-five steps
   * and 228 atoms of sulfates rather than fourteen steps on three Lepidolite.
   */
  ['and the ore it bought is decomposed, not dissolved into a sulfate chain',
   (() => {
     const p = fromNothing2(['Lithium', 'Potassium']);
     return !!p && p.steps.some((s) => /Lepidolite Decomposition/.test(s.process.label));
   })()],
  ['on three of it and nothing else', (() => {
    const p = fromNothing2(['Lithium', 'Potassium']);
    return !!p && p.frontier.length === 1 && p.frontier[0].name === 'Lepidolite';
  })()],
  ['and the ore it buys is put through something',
   !!iron && iron.steps.some((s) => (s.process.consumes || [])
     .some((i) => iron.frontier.some((f) => f.name === i.name)))],
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

/**
 * Sparr: a plan offered at four times the size is the balancer multiplying
 * it, not a display problem.
 *
 * `assemble` runs every step a whole number of times, which it arranges by
 * multiplying the plan by the lowest common multiple of the run counts'
 * denominators. So a vertex carrying a denominator of four multiplies the
 * whole thing by four: twelve Lepidolite where three would do, and four times
 * the potassium nobody asked for. That is not the same answer written larger,
 * because the reader is sent shopping for what they did not order.
 *
 * Nothing else here sees it. The cases below are put the way the page puts
 * them -- balanced -- and balancing absorbs the multiple: at a comparison
 * threshold that quadrupled this plan, the whole suite still read 72 met, 0
 * missed, 0 broken and only a display assertion in the plan-UI tests noticed.
 * So these are asked plainly, one apiece, where the batch is still visible.
 *
 * A ceiling and not a number, because a smaller batch is a better answer and
 * must not fail. The first four are the plans IDEAL-PLANS.md writes out, whose
 * batch is part of what that file states; the last two are here because they
 * are the ones that moved.
 */
console.log('--- the size of the batch it offers');
{
  const MADE = ['weather', 'air', 'made'];
  const batches = [
    // One Carbon Dioxide into one Carbon and one Oxygen Gas -- IDEAL-PLANS 2.
    ['Carbon from Carbon Dioxide', 1,
     { targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Dioxide'] }],
    // Two Carbon Monoxide are two Carbon, so the batch is two -- IDEAL-PLANS 3.
    ['Carbon from Carbon Monoxide', 2,
     { targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Monoxide'] }],
    // Three ore an order, one down each branch of the decomposition, which is
    // a batch of two against 2/2/2/3 -- IDEAL-PLANS 1.
    ['the four out of Lepidolite', 2,
     { targets: ['Potassium', 'Lithium', 'Aluminum', 'Silicon']
         .map((n) => ({ name: n, amount: 1 })),
       have: ['Lepidolite'], sources: MADE }],
    /**
     * Sparr: the batch is two ore because water is recycled in pairs.
     *
     * The dissolution gives three Water per Columbite and the electrolysis
     * takes them two at a time, so an odd number of ore leaves a water with
     * nothing to pair off against and the circuit will not close. Two ore is
     * the smallest batch that comes out even, and that is four of each metal
     * -- which is IDEAL-PLANS 4's rate of two per Columbite exactly. The rate
     * is what that file states; the batch is twice the ore because the parity
     * says it must be.
     *
     * Asked for one, two or four of each, the solver returns the same
     * nineteen-step factory on two Columbite every time and only relabels the
     * batch. So four is the floor here, not a figure waiting to improve.
     */
    ['Tantalum and Niobium out of Columbite', 4,
     { targets: [{ name: 'Tantalum', amount: 1 }, { name: 'Niobium', amount: 1 }],
       have: ['Columbite'], sources: MADE }],
    // The one that moved: eight, on twelve ore, for an order of one.
    ['Potassium out of Lepidolite', 2,
     { targets: [{ name: 'Potassium', amount: 1 }], have: ['Lepidolite'] }],
    ['Aluminum out of Lepidolite', 4,
     { targets: [{ name: 'Aluminum', amount: 1 }], have: ['Lepidolite'],
       sources: ['world'] }],
  ];
  for (const [what, ceiling, ask] of batches) {
    let plan = null;
    try { plan = solveFresh(graph, ask); } catch { plan = null; }
    if (!plan) {
      console.log(`      BROKE ${what} -- no plan at all`);
      broke++;
      continue;
    }
    const batch = rnum(plan.scale);
    const ok = batch <= ceiling;
    console.log(`      ${ok ? 'MET  ' : 'BROKE'} ${what} comes in batches of ` +
      `${ceiling} or fewer: ${batch}` +
      (ok ? '' : ` -- ${plan.feed.map((f) => `${f.name}×${rstr(f.amount)}`).join(', ')}`));
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
