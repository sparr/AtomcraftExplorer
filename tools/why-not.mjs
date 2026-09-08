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
import { reactorsIn } from '../src/plan-graph.js';
import { solveFresh, subgraph, shortlist, model, normalizeFresh, withElements, fetchable, sourceOf, DEFAULT_SOURCES, unprovenBugs }
  from '../src/plan-fresh.js';
import { rnum, rstr } from '../src/rational.js';
import { composition } from '../src/composition.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

/**
 * `IDEAL-PLANS.md`, in a form a program can check.
 *
 * `edges` are the reactions a right answer runs; `buys` is everything its
 * shopping list is allowed to contain. Anything fetched that is not in `buys`
 * is the plan going somewhere the ideal does not -- twenty chickens, say, or
 * an ore nobody offered it -- and that is a different complaint from an edge
 * it never picked, so both are reported.
 *
 * Keep this in step with the file. The file is the argument; this is the
 * assertion.
 */
/**
 * Closing the carbon on hydrogen, which is what cases 2 and 3 now ask for.
 *
 * Reduce the dioxide to monoxide, let the Boudouard split that into carbon and
 * dioxide, and split the water the reduction made to get the hydrogen back.
 * Four steps and a charge of one hydrogen.
 */
const HYDROGEN_LOOP = [
  'rx:Boudouard Equilibrium 500-725K',
  'rx:Electrolysis of Carbon Dioxide',
  'rx:Electrolysis of Water',
  'rx:Expansion of Hydrogen Gas x2',
];

/**
 * Closing it on potassium instead: five steps and a charge of four potassium,
 * so it loses to the hydrogen route on its own. Kept because cases 1, 4 and 5
 * turn the potassium circuit for their own reasons, and where its steps are
 * already paid for, closing the carbon on it costs one reaction rather than
 * four. See the note under case 2 in IDEAL-PLANS.md.
 */
const CARBON_LOOP = [
  'rx:Molten Potassium + Carbon Dioxide',
  'rx:Potassium Oxide + Water',
  'rx:Molten Potassium Hydroxide Electrolysis',
  'rx:Hydrogen Combustion',
  'cond:Steam',
];

const COLUMBITE_CHAIN = [
  'rx:Hydrofluoric Acid Dissolves Columbite',
  'rx:Heptafluorotantalic Acid + Aqueous Potassium Hydroxide',
  'rx:Heptafluoroniobic Acid + Aqueous Potassium Hydroxide',
  'rx:Aqueous Potassium Heptafluorotantalate(V) + Water',
  'rx:Aqueous Potassium Heptafluoroniobate(V) + Water',
  'rx:Tantalum Pentoxide Reduction',
  'rx:Niobium Pentoxide Reduction',
];

const LEPIDOLITE_CHAIN = [
  'rx:Lepidolite Decomposition',
  'rx:Lepidolite Decomposition - Lithium',
  'rx:Lepidolite Decomposition - Potassium',
  'rx:Silica Reduction',
  'rx:Molten Alumina Reduction',
];

/**
 * The four steps that get the tungsten out, and the reagents that come back.
 *
 * Both tungstate ores run these thirteen and should run them the same number
 * of times; what differs between the two cases is only how the leftover metal
 * oxide is reduced. Keeping them as a pair is the point -- anything that moves
 * in one and not the other is either the deoxidation or a bug, which is how
 * the paratungstate disagreement turned up.
 */
const TUNGSTEN_CHAIN = [
  'rx:Sodium Tungstate to APT',
  'rx:Ammonium Paratungstate Roasting',
  'rx:Tungsten Trioxide Reduction',
  // sodium: carbonate -> tungstate -> seawater -> lye -> carbonate
  'rx:Electrolysis of Seawater',
  'rx:Carbonic Acid',
  'rx:Carbonic Acid + Lye',
  // ammonium and chloride, round to the APT step and back on the seawater
  'rx:Chlorine Gas + Hydrogen Gas',
  'evap:Hydrochloric Acid',
  'rx:HCl Gas + Ammonia Gas',
  'rx:Aqueous Ammonium Chloride',
  // hydrogen for the reduction, and the roast's dioxide back to monoxide
  'rx:Electrolysis of Water',
  'rx:Electrolysis of Carbon Dioxide',
];

const WANTED = [
  {
    id: 'co2-to-carbon',
    targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Dioxide'],
    edges: HYDROGEN_LOOP,
    // One Carbon Dioxide into one Carbon and one Oxygen Gas, and that is all.
    buys: [], budget: 0,
    // The oxygen it came in with, and nothing else.
    leaves: ['Oxygen Gas', 'Liquid Oxygen'],
  },
  {
    id: 'co-to-carbon',
    targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Monoxide'],
    edges: HYDROGEN_LOOP,
    // Two carbon monoxide are two carbon, not one and a leftover. Venting the
    // Carbon Dioxide is keeping half the carbon and calling it done.
    buys: [], budget: 0,
    leaves: ['Oxygen Gas', 'Liquid Oxygen'],
  },
  {
    id: 'lepidolite',
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite'],
    // Sparr: let it buy manufactured goods. Carbon is a `made` resource, so
    // with this off the ideal was unsatisfiable -- the best carbon it could
    // legally buy was Limestone at five atoms where the ideal asks for one.
    // (Still want this faster; it is the slowest of the five.)
    sources: ['weather', 'air', 'made'],
    edges: [...LEPIDOLITE_CHAIN, 'rx:Boudouard Equilibrium 500-725K', ...CARBON_LOOP],
    // Nine carbon in and eight back, so one thing that is carbon per three ore,
    // and an order is three ore.
    buys: [], carbon: true,
    budget: 1,
    idealAtoms: 1,   // one Carbon
    leaves: ['Steam', 'Water', 'Hydrofluoric Acid Gas', 'Hydrofluoric Acid',
             'Oxygen Gas', 'Liquid Oxygen', 'Hydrogen Gas'],
  },
  {
    id: 'columbite',
    targets: [{ name: 'Tantalum', amount: 2 }, { name: 'Niobium', amount: 2 }],
    have: ['Columbite'],
    edges: [...COLUMBITE_CHAIN, 'rx:Boudouard Equilibrium 500-725K', ...CARBON_LOOP],
    // Sparr: no mined things -- the ore it was given is the only ore it gets
    // -- and manufactured goods switched on, because the acid and the
    // hydroxide it is meant to buy both have recipes.
    sources: ['weather', 'air', 'made'],
    // Per Columbite: four Hydrofluoric Acid, four Potassium Hydroxide, one
    // Water. Carbon closed, and no ore but the Columbite.
    // Four fluorine and four potassium, in whatever carries them, and a water.
    buys: ['Water'], carries: ['F', 'K'],
    budget: 9,
    // Four Hydrofluoric Acid, four Potassium Hydroxide and a Water is nine
    // units. As atoms it is 35, not the 23 this said before: the game's
    // Hydrofluoric Acid is `HF+H2O` and so five atoms a unit, not the two the
    // bare molecule would be. Counting it at two made every columbite plan
    // look further over its ideal than it was.
    idealAtoms: 35,
    leaves: ['Iron(II) Fluoride', 'Potassium Fluoride', 'Water', 'Steam',
             'Oxygen Gas', 'Liquid Oxygen'],
  },
  {
    id: 'combined',
    targets: [{ name: 'Tantalum', amount: 2 }, { name: 'Niobium', amount: 2 },
              { name: 'Lithium', amount: 4 }, { name: 'Aluminum', amount: 4 },
              { name: 'Silicon', amount: 6 }],
    have: ['Columbite', 'Lepidolite'],
    edges: [...COLUMBITE_CHAIN, ...LEPIDOLITE_CHAIN,
            'rx:Hydrochloric Acid Dissolves Lithium Oxide',
            'rx:Electrolysis of Molten Lithium Chloride',
            'rx:Chlorine Gas + Hydrogen Gas',
            'rx:Boudouard Equilibrium 500-725K', ...CARBON_LOOP],
    // The same, and the two ores it stands on are `have` rather than fetched,
    // so refusing the mines does not take them away.
    sources: ['weather', 'air', 'made'],
    // Six Lepidolite to a Columbite, and two carbon. Nothing else at all.
    buys: [], carbon: true,
    budget: 2,
    idealAtoms: 2,   // two Carbon
    leaves: ['Iron(II) Fluoride', 'Potassium Fluoride', 'Hydrofluoric Acid Gas',
             'Hydrofluoric Acid', 'Water', 'Steam', 'Oxygen Gas', 'Liquid Oxygen'],
  },
  {
    id: 'wolframite-iron',
    targets: [{ name: 'Tungsten', amount: 2 }, { name: 'Iron', amount: 2 }],
    have: ['Iron(II) Tungstate'],
    // The chain wants sodium carbonate and ammonium chloride, and both are
    // manufactured, so this is one of the cases that has to be allowed to buy
    // them -- it does not, in the end, but it cannot plan without the offer.
    sources: ['weather', 'air', 'made'],
    edges: [...TUNGSTEN_CHAIN,
            'rx:Iron(II) Tungstate + Sodium Carbonate',
            // No reduction of Iron Oxide exists, so the iron comes out wet:
            // dissolve, cement with zinc, and put the zinc back.
            'rx:Sulfuric Acid + Iron Oxide',
            'rx:Aqueous Iron(II) Sulfate',
            'rx:Aqueous Iron(II) Sulfate + Zinc',
            'rx:Aqueous Zinc Sulfate Evaporation',
            'rx:Zinc Sulfate Decomposition',
            'rx:Zinc Oxide Reduction 2',
            'rx:Sulfur Trioxide Gas + Steam'],
    // FeWO4 holds one of each metal, so two ore make the order and nothing is
    // bought at all.
    buys: [], budget: 0, idealAtoms: 0,
    // The ore's oxygen, and the water the paratungstate disagreement mints --
    // recorded in FORMULA-ODDITIES.md and allowed rather than scored against.
    leaves: ['Oxygen Gas', 'Liquid Oxygen', 'Steam', 'Water'],
  },
  {
    id: 'wolframite-manganese',
    targets: [{ name: 'Tungsten', amount: 2 }, { name: 'Manganese', amount: 2 }],
    have: ['Manganese(II) Tungstate'],
    sources: ['weather', 'air', 'made'],
    edges: [...TUNGSTEN_CHAIN,
            'rx:Manganese(II) Tungstate + Sodium Carbonate',
            // Two steps where the iron takes seven, because this reduction
            // exists and `Iron(II) Oxide Reduction` does not.
            'rx:Manganese(II) Oxide Reduction',
            'rx:Boudouard Equilibrium 500-725K'],
    buys: [], budget: 0, idealAtoms: 0,
    leaves: ['Oxygen Gas', 'Liquid Oxygen', 'Steam', 'Water'],
  },
];

const graph = buildProcessGraph(await loadData());

/**
 * "One thing that is carbon" is a shape, not a list.
 *
 * The ideal says a Lepidolite order is one carbon short and buys one thing to
 * cover it. Which thing is not the point -- a spore, a chicken, a fallen leaf,
 * a cut of grass are all the same answer -- so the check asks whether what was
 * bought carries carbon, rather than naming the four I happened to think of.
 */
const table = composition(graph);

/**
 * Anything grown or bred is carbon, whatever the formula table says.
 *
 * Composition is inferred and it abstains on plenty -- a Chicken (Raw) and a
 * Chicken Egg both come back unknown -- so asking the table alone flagged a
 * plan for buying a chicken to make carbon out of, which is the very thing the
 * ideal permits. Where the table cannot say, being something that grew is
 * answer enough.
 */
const carbonish = (name) =>
  (table.get(name)?.elements?.has('C') ?? false) || sourceOf(graph, name) === 'farm';

/**
 * Anything that carries one of the elements the ideal actually asks for.
 *
 * `Fl` counts as fluorine because one of the game's formulas writes it that
 * way -- Magnesium Fluoride is `MgFl2` -- and `Fl` is Flerovium, which is not
 * what anyone meant. Exactly one: the seven other formulas containing `Fl` are
 * genuine Flerovium isotopes, so this is a single typo and not a convention.
 * It is not only cosmetic either, since `Beryllium Fluoride + Magnesium
 * Liquid` bridges the two and comes out off by `F-2 Fl2`. Worth fixing at the
 * source; until then, reading it here.
 */
/**
 * How much stuff a unit of the stuff is, where it can be counted at all.
 *
 * A shopping list measured in units flatters whatever is densest -- one
 * Silicon Tetrafluoride against four Hydrofluoric Acid -- and measured in
 * atoms it does not. Neither is the truth on its own: units are what you carry
 * and atoms are what you are actually buying, so both are printed and the gap
 * between them says how concentrated the purchase is.
 *
 * `m.matter` rather than the formula, because the formula is not the whole
 * story: a unit of a condensed phase can hold several units of the vapour it
 * came from, and this used to read Liquid Oxygen as two atoms where it holds
 * eight. It also handles the minerals whose formula names a site holding one
 * of several elements, which the old walk gave up on.
 */
const atomsOf = (graph, name) => graph.db.byName.get(name)?.matter ?? null;

const SPELT = { F: ['F', 'Fl'] };
const carries = (c, name) => (c.carries || []).some((el) =>
  (SPELT[el] || [el]).some((sym) => table.get(name)?.elements?.has(sym) ?? false));

const allowed = (c, name) =>
  c.buys.includes(name) || (c.carbon && carbonish(name)) || carries(c, name);
const only = process.argv[2];

for (const bug of unprovenBugs(graph)) {
  console.log(`??? listed as a game bug and NOT applied -- ${bug.why}: ${bug.drop}`);
}

for (const c of WANTED) {
  if (only && c.id !== only) continue;
  const notes = [];
  const ask = { targets: c.targets, have: c.have, sources: c.sources, notes };
  // The same spec the solver builds. Without the element sets this walked a
  // different graph and shortlisted a different set, and then reported on it.
  const spec = withElements(graph, normalizeFresh(ask));
  const sub = subgraph(graph, spec);
  const inSub = new Set(sub.processes.map((p) => p.id));

  const short = shortlist(graph, spec, sub, (procs, mats) => model(graph, spec, procs, mats));
  const inShort = new Set((short?.processes || []).map((p) => p.id));

  const plan = solveFresh(graph, ask);
  const ran = new Map((plan?.steps || []).map((s) => [s.process.id, s.runs]));

  if (plan && plan.shortfall) {
    console.log(`\n!!! ${c.id}: THE PLAN DOES NOT DELIVER -- ` +
      plan.shortfall.map((x) => `${x.name}: asked ${x.asked}, made ${rstr(x.made)}`).join('; '));
  }
  /**
   * Reactors, which is what the step count is really asking about.
   *
   * Sparr: a step is a reactor you have to build, and once built it runs as
   * many times as you like -- so how often a step fires does not matter, only
   * how many distinct ones there are. Phase changes are not among them.
   * Cooling happens in the open air, and the heating happens inside whichever
   * reactor wants the hot form, so neither needs a vessel of its own. Filters
   * do: no heat and no current, but materials still have to be carried to a
   * place and different ones carried out.
   *
   * The raw step count is printed beside it because the plan below lists every
   * step, phase changes included, and the two numbers should be reconcilable.
   */
  const reactors = reactorsIn(plan?.steps || []);
  console.log(`\n--- ${c.id}: ${sub.processes.length} considered, ` +
    `${short ? short.processes.length : 'no'} shortlisted, ` +
    `${plan ? `${reactors} reactors in ${plan.steps.length} steps` : 'no plan'}`);
  // The channel carries both "why there is no plan" and running commentary
  // from a plan that came out fine, so it must not label the second as the
  // first: "gave up: spoils: 34 -> 34 atoms" is a plan, not a failure.
  for (const n of notes) console.log(`      ${plan ? 'note' : 'gave up'}: ${n}`);

  if (plan) {
    // Per order, since a plan may fill the order several times over.
    const orders = Math.min(...c.targets.map((t) => rnum(plan.madeOf(t.name)) / t.amount));
    const bought = plan.frontier.reduce((a, f) => a + rnum(f.amount), 0);
    const stray = plan.frontier.filter((f) => !allowed(c, f.name));
    console.log(`      fills the order ${orders}x | shopping list: ` +
      (plan.frontier.map((f) => `${f.name}×${rstr(f.amount)}`).join(', ') || 'nothing'));
    let atoms = 0;
    let unknown = 0;
    for (const f of plan.frontier) {
      const each = atomsOf(graph, f.name);
      if (each === null) unknown += rnum(f.amount);
      else atoms += each * rnum(f.amount);
    }
    console.log(`      in atoms: ${(atoms / (orders || 1)).toFixed(2)} an order` +
      (unknown ? ` (plus ${(unknown / (orders || 1)).toFixed(2)} units nothing can count)` : '') +
      (c.idealAtoms ? `  -- the ideal is ${c.idealAtoms}` : ''));
    console.log(`      ideal buys ${c.budget} per order` +
      (c.buys.length ? ` of: ${c.buys.join(', ')}` : c.carbon ? ' of anything that is carbon' : ', of nothing at all') +
      ` -- this buys ${(bought / (orders || 1)).toFixed(2)}`);
    /**
     * What it throws away, which the shopping list does not catch.
     *
     * Carbon Monoxide to Carbon buys nothing and looked like a pass, while
     * making one Carbon and venting the Carbon Dioxide holding the other one.
     * A plan can be wrong by keeping too little as easily as by buying too
     * much.
     */
    const dumped = plan.byproducts.filter((b) => !(c.leaves || []).includes(b.name));
    console.log(`      leaves: ` +
      (plan.byproducts.map((b) => `${b.name}×${rstr(b.amount)}`).join(', ') || 'nothing') +
      `  (ideal leaves only: ${(c.leaves || []).join(', ') || 'nothing'})`);
    if (dumped.length) {
      console.log(`      THROWS AWAY WHAT IT SHOULD NOT: ` +
        dumped.map((b) => `${b.name}×${rstr(b.amount)}`).join(', '));
    }

    if (stray.length) {
      console.log(`      BUYS WHAT IT SHOULD NOT: ` +
        stray.map((f) => `${f.name}×${rstr(f.amount)}`).join(', '));
    } else if (bought / (orders || 1) > c.budget + 1e-9) {
      console.log(`      BUYS TOO MUCH: the right things, ` +
        `${(bought / (orders || 1) / (c.budget || 1)).toFixed(1)}x over`);
    }
  }

  for (const id of c.edges) {
    const p = graph.byId.get(id);
    let verdict;
    if (!p) verdict = 'NOT IN THE GRAPH -- wrong id?';
    else if (!spec.kinds.has(p.kind)) verdict = `kind "${p.kind}" is switched off`;
    else if (!inSub.has(id)) verdict = 'NEVER OFFERED -- the candidate walk did not keep it';
    else if (!short) verdict = 'offered, but the shortlist pass failed outright';
    // Ran beats every other reading of events. Asked last, a step the plan runs
    // was being reported as one the shortlist never picked.
    else if (ran.has(id)) verdict = `RUN ${rstr(ran.get(id))}x`;
    // `!inShort` is the shortlist dropping it, which means the simplex never
    // saw it at all -- the old wording here said the opposite and sent me
    // looking for a rejection that never happened.
    else if (!inShort.has(id)) verdict = 'CUT BY THE SHORTLIST -- the simplex was never offered it';
    else verdict = 'shortlisted but dropped by the step-elimination';
    const mark = verdict.startsWith('RUN') ? 'ok  ' : '    ';
    console.log(`  ${mark}${id.padEnd(52)} ${verdict}`);
  }
}
