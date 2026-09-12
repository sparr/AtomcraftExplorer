/**
 * The states of one substance, sharing a row.
 *
 * `test-fresh.mjs` is an instrument: it scores whole plans against what the
 * reader wants and prints how it did. This is the suite underneath it, and it
 * exists because none of the collapse machinery had one -- `phaseFamilies`,
 * `worth`, the dropped crossings, the re-solve on the finer rows, the
 * conditional bars and the pair gate were all verified by the canonical cases
 * happening to walk through them, which would not have noticed any of them
 * being deleted.
 *
 * Properties rather than snapshots, with two exceptions noted where they are.
 * Cheap on purpose: the graph and model assertions are tens of milliseconds
 * and only two plans are actually solved, the two cheapest that exercise a
 * family -- Liquid Hydrogen packs four to a unit, Molten Aluminum is one for
 * one. Oxygen Gas and Liquid Oxygen would be another forty-five seconds to say
 * the same thing.
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { phaseFamilies, hydrationFamilies, mergeableStates, model, subgraph, withElements,
         normalizeFresh, solveFresh, unprovenBugs, WEIGH_BY } from '../src/plan-fresh.js';
import { SCORES } from '../src/plan-menu.js';
import { rnum, rzero } from '../src/rational.js';
import { atomsIn } from '../src/minting.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

let fail = 0;
const check = (ok, what) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
};

const graph = buildProcessGraph(await loadData());
const { family, stands, worth, repOf } = phaseFamilies(graph);
const inputsOf = (p) => [...p.consumes, ...p.requires];
/** Every phase step that is one material in and one out, with its ratio. */
const crossings = graph.processes.filter((p) => p.kind === 'phase' &&
  inputsOf(p).length === 1 && p.produces.length === 1 &&
  inputsOf(p)[0].count && p.produces[0].count);

console.log('--- who stands for whom ---');
check(family.size > 100, `${family.size} families over ${repOf.size} materials`);
check([...family.keys()].every((rep) => stands(rep) === rep),
      'a representative stands for itself');
check([...family].every(([rep, members]) => members.every((m) => stands(m) === rep)),
      'and for every member of its family');
check([...family.keys()].every((rep) => graph.stateOf(rep) !== 'Static'),
      'no representative is a placed pixel, which a plan cannot carry');
const dressed = (n) => /^(Molten|Frozen|Dry|Liquid|Solid) /.test(n);
check([...family].every(([rep, members]) =>
        !dressed(rep) || members.every((m) => dressed(m))),
      'and none wears a Molten or Liquid prefix while a plain sibling exists');

/**
 * The one that matters: a family is only sound if travelling round it neither
 * gains nor loses anything. Every crossing between two members has to agree
 * with what the two are worth, or some way round the family mints -- and
 * collapsing would bake the gain into the row where nothing could see it.
 */
console.log('\n--- every crossing inside a family closes ---');
{
  const inside = crossings.filter((p) => {
    const rep = stands(inputsOf(p)[0].name);
    return family.has(rep) && stands(p.produces[0].name) === rep;
  });
  check(inside.length > 200, `${inside.length} crossings to check`);
  const wrong = inside.filter((p) => {
    const from = inputsOf(p)[0], to = p.produces[0];
    return rnum(worth(from.name)) * from.count !== rnum(worth(to.name)) * to.count;
  });
  check(!wrong.length,
        `what goes in is worth what comes out${wrong.length ? `: ${wrong[0].id}` : ''}`);
}

console.log('\n--- a ratio is not a reason to keep them apart ---');
check(stands('Liquid Oxygen') === stands('Oxygen Gas'),
      'four Oxygen Gas and one Liquid Oxygen are one substance');
check(rnum(worth('Liquid Oxygen')) === 4 * rnum(worth('Oxygen Gas')),
      'and a Liquid Oxygen is worth four of them');
check(rnum(worth('Heavy Oil Vapor')) * 2 === rnum(worth('Heavy Oil')),
      'a Heavy Oil Vapor is half a Heavy Oil');
/**
 * Sparr: `evap:Sand` gives Molten Silica and molten silica condenses to Glass,
 * not to sand, so the melt is one way. A one-way crossing is a real step and a
 * real column, and following it would have a plan freezing molten silica into
 * sand.
 */
check(stands('Sand') !== stands('Molten Silica'),
      'sand melts one way, so it is nobody\'s family');
/**
 * Pins a decision rather than a law: nothing is held back. If a family is ever
 * held back again, `HELD_BACK` is where, and this is the check that will say
 * so -- see the note beside it for what the batch used to cost.
 */
check(stands('Steam') === stands('Water'), 'and nothing is held back: Steam stands for Water');
check(mergeableStates(graph).length === 0,
      'so the scoreboard has no state to offer both ways');

/**
 * The aqueous identities: which ones there are, and that a plan still works.
 *
 * `hydrationFamilies` is not a phase family and must not be mistaken for one.
 * The test worth having is that the identity it writes down is the one the game
 * supports in both directions, and that spending the row does not cost the
 * reader the step: the plan still has to say "dissolve this", because that is
 * work somebody does in a vessel.
 */
console.log('\n--- the aqueous identities ---');
{
  const { pairs } = hydrationFamilies(graph);
  check(pairs.size === 32, `32 salts close their round trip, and ${pairs.size} were found`);
  check([...pairs.values()].every((h) => h.split && h.join),
        'each has a way out and a way back');
  /**
   * The identity is only as good as the agreement between the two crossings,
   * which is the whole reason 32 and not 69. Re-derived here from the steps
   * rather than trusted: what the way out gives back, the way in must take.
   */
  const per = (id, name, side) => {
    const q = graph.byId.get(id);
    const list = side === 'in' ? inputsOf(q) : q.produces;
    return list.find((x) => x.name === name)?.count ?? 0;
  };
  const WET = new Set(['Water', 'Steam', 'Ice']);
  const waterOn = (id, side) => {
    const q = graph.byId.get(id);
    const list = side === 'in' ? inputsOf(q) : q.produces;
    return list.filter((x) => WET.has(x.name)).reduce((a, x) => a + x.count, 0);
  };
  check([...pairs].every(([aq, h]) => {
          const outUnits = per(h.split, aq, 'in');
          const inUnits = per(h.join, aq, 'out');
          if (!outUnits || !inUnits) return false;
          // `filter:` is the block, whose rule is one tile in, one of each out.
          const outWater = h.split.startsWith('filter:') ? 1 : waterOn(h.split, 'out');
          return outWater * inUnits === waterOn(h.join, 'in') * outUnits;
        }),
        'and the two agree on the water, per unit of salt, in every one');
  check(!pairs.has('Limewater'),
        'Limewater is left out: one Water back out, two needed in, so a cycle leaks');
  check(!pairs.has('Aqueous Zinc Sulfate'),
        'and so is Aqueous Zinc Sulfate, which the filter will not take apart at all');
  /**
   * The row is spent, the step is not. A plan that wants a dissolved salt still
   * has to be told to dissolve it, and `assemble` is what puts that back.
   */
  const p = solveFresh(graph, { targets: [{ name: 'Aqueous Lithium Sulfate', amount: 1 }] });
  check(!!p && p.steps.length > 0, 'a plan for a dissolved salt is still answerable');
  /**
   * Rarely needed, which is the point: of 64 questions asked about a salt or
   * its dry half, 62 come out with no crossing to put back at all -- the row
   * was spent and nothing missed it. This is one of the two that does.
   */
  const notes = [];
  const q = solveFresh(graph, { targets: [{ name: 'Aqueous Magnesium Sulfate', amount: 1 }], notes });
  check(!!q, 'and so is one that has to cross a salt on the way');
  check(notes.some((n) => n.startsWith('hydration: put back')),
        'and the crossing it needs is put back by name, not left for the reader to guess');
}

console.log('\n--- what the collapse takes out of the model ---');
{
  const spec = withElements(graph, normalizeFresh({ targets: [{ name: 'Glass', amount: 1 }] }));
  const sub = subgraph(graph, spec);
  const loose = model(graph, spec, sub.processes, sub.materials, true);
  const whole = model(graph, spec, sub.processes, sub.materials, false);
  check(loose && whole, 'the same question models both ways');
  check(loose.rows.length < whole.rows.length,
        `rows ${whole.rows.length} -> ${loose.rows.length}`);
  check(loose.vars < whole.vars, `columns ${whole.vars} -> ${loose.vars}`);
  check(loose.procs.length < whole.procs.length,
        `steps ${whole.procs.length} -> ${loose.procs.length}`);
  /**
   * A crossing inside a family contributes nothing to any row once the rows
   * are one, so it is a null direction and goes. This is the whole point of
   * the exercise and the thing a refactor would silently undo.
   */
  const dropped = whole.procs.filter((p) => !loose.procs.some((q) => q.id === p.id));
  /**
   * Two kinds now, and nothing else may be in here.
   *
   * This used to say every dropped column is a phase change, which stopped
   * being true when the aqueous identities started spending rows too: the step
   * that dissolves a salt contributes nothing to the dry row or the water row
   * once the salt is written as the two of them, so it is as null as a melt is
   * and goes the same way. The check is worth more stated as a partition --
   * every dropped column is one of the two, and each is a genuine crossing of
   * its own kind -- than it was as a single `kind === 'phase'`.
   */
  const inOneFamily = (p) => {
    const ins = inputsOf(p);
    return p.kind === 'phase' && ins.length === 1 && p.produces.length === 1 &&
           stands(ins[0].name) === stands(p.produces[0].name);
  };
  const { pairs } = hydrationFamilies(graph);
  const hydIds = new Set();
  for (const h of pairs.values()) { hydIds.add(h.split); hydIds.add(h.join); }
  for (const h of pairs.values()) for (const id of [...h.splits, ...h.joins]) hydIds.add(id);
  const phased = dropped.filter(inOneFamily);
  const wetted = dropped.filter((p) => !inOneFamily(p) && hydIds.has(p.id));
  check(dropped.length > 0 && phased.length + wetted.length === dropped.length,
        `and all ${dropped.length} dropped are crossings: ${phased.length} phase, ` +
        `${wetted.length} hydration`);
  check(phased.length > 0 && wetted.length > 0,
        'both kinds are actually pulling their weight here');
  /**
   * Each hydration column that went is one whose round trip closed. Limewater
   * is the standing counter-example: its filter gives one Water back and the
   * only reaction in takes two, so its columns must both survive.
   */
  check(wetted.every((p) => [...pairs.values()].some((h) =>
          h.splits.includes(p.id) || h.joins.includes(p.id))),
        'each hydration column belongs to a pair whose round trip closes');
  check(!pairs.has('Limewater'), 'and Limewater, which leaks a water, is not one of them');
  /** But a one-way melt is not a no-op, and keeps its column. */
  const sandInSet = whole.procs.some((p) => p.id === 'evap:Sand');
  check(!sandInSet || loose.procs.some((p) => p.id === 'evap:Sand'),
        'while `evap:Sand`, which does not come back, keeps its column');
  /** And no row is named after a member that does not stand for its family. */
  check(loose.rows.every((row) => String(row.name).startsWith('chamber:') ||
                                  String(row.name).startsWith('weld:') ||
                                  stands(row.name) === row.name),
        'no row is keyed on a material that stands for nothing');
}

console.log('\n--- and puts back at the end ---');
/**
 * The row is keyed on the substance, so satisfying it does not by itself
 * produce the state that was asked for. What must never happen is a plan that
 * balances its family and hands over nothing of the name on the order.
 *
 * Which does not mean a crossing every time: `rx:Alumina Reduction` makes
 * Molten Aluminum outright, so that plan needs none and should not have one.
 * Liquid Hydrogen is the case that does -- nothing makes it but the condense
 * -- and it is named to keep one concrete example of the crossing coming back.
 */
for (const name of ['Liquid Hydrogen', 'Molten Aluminum']) {
  let plan = null;
  try { plan = solveFresh(graph, { targets: [{ name, amount: 1 }] }); } catch { plan = null; }
  if (!plan || !plan.steps.length) { check(false, `${name} plans at all`); continue; }
  const asked = plan.spec.targets[0].amount;
  check(rnum(plan.madeOf(name)) >= asked,
        `${name}: makes the ${asked} it says it makes`);
  const makers = plan.steps.filter((s) => s.process.produces.some((o) => o.name === name));
  check(makers.length > 0, 'and something in it produces that state by name');
  if (name === 'Liquid Hydrogen') {
    check(makers.every((s) => s.process.kind === 'phase') &&
          plan.steps.some((s) => s.process.id === 'cond:Hydrogen Gas'),
          'and where only a crossing can make it, the crossing is put back');
  }
  /** A step cannot be run four sevenths of a time, crossings included. */
  check(plan.steps.every((s) => !rzero(s.runs) && s.runs.d === 1n),
        'every run count is whole, the crossings among them');
  /**
   * Nothing comes of nothing. The wheel test used to skip the material a plan
   * hands over when no step consumed it, which let a plan buy nothing at all
   * and still produce.
   */
  check(plan.frontier.length + plan.feed.length > 0,
        'and something came in at the door for it');
}

console.log('\n--- nothing comes of nothing ---');
/**
 * The wheel test asked only about materials the plan both makes and spends, so
 * the one thing it never asked about was the thing a wheel hands over. Asked
 * for Oxygen Gas the plan circulated potassium, sulfur and carbon, all of them
 * netting to nothing and all of them duly cleared, and handed out three Oxygen
 * Gas a batch having bought and fed nothing whatsoever.
 *
 * This is the only check here that costs real time -- about seventeen seconds,
 * where every other plan in this file is two or three -- and it is the only
 * witness there is. Reverting the fix is caught by nothing else in the suite:
 * with the hole back the same question answers in four seconds and buys
 * nothing, and every other check in this file still passes.
 */
{
  let plan = null;
  try { plan = solveFresh(graph, { targets: [{ name: 'Oxygen Gas', amount: 1 }] }); } catch { plan = null; }
  check(plan && plan.steps.length > 0, 'Oxygen Gas has a plan');
  check(plan && plan.frontier.length + plan.feed.length > 0,
        'and it buys or is fed something, rather than making oxygen out of a charge');
}

console.log('\n--- barred where it would be used, and only there ---');
{
  /**
   * `rx:Hydrochloric Acid Dissolves Steel` gains a chlorine and a hydrogen:
   * one Hydrochloric Acid in, one Iron(II) Chloride out. It is the direct
   * maker of Iron(II) Chloride, so a walk for that target would certainly keep
   * it -- and does not, because the target is made of what it mints. Iron is
   * one reaction away and made of neither, and keeps it.
   */
  const ID = 'rx:Hydrochloric Acid Dissolves Steel';
  const walk = (name) => {
    const spec = withElements(graph, normalizeFresh({ targets: [{ name, amount: 1 }] }));
    return subgraph(graph, spec).processes.some((p) => p.id === ID);
  };
  check(graph.byId.has(ID), 'the recipe is still in the graph');
  check(!walk('Iron(II) Chloride'),
        'and out of the walk for its own product, which is made of the chlorine it gains');
  check(walk('Iron'), 'and in the walk for Iron, which is not');
}

console.log('\n--- counting the atoms in a formula ---');
/**
 * `atomsIn` walked the formula tree itself and had no case for two of the node
 * kinds in it, so it quietly dropped them. A `coeff` is the number in front of
 * a segment -- `HNO3 + 3HCl`, `CaSO4·2H2O`, `2 H2` -- and skipping it counted
 * one hydrogen in aqua regia where there are four, and two in a container that
 * holds four. That last is what had `rx:Expansion of Hydrogen Gas x2` reading
 * as making hydrogen out of nothing.
 *
 * The material's own `atoms` had it right the whole time, which is what makes
 * this checkable: wherever `atomsIn` will answer at all, it has to agree.
 */
{
  let compared = 0;
  let declined = 0;
  const off = [];
  for (const m of graph.db.materials) {
    if (!m.formula?.ast || !m.atoms) continue;
    for (const [el, want] of m.atoms) {
      const got = atomsIn(graph, m.name, el);
      if (got === null) { declined++; continue; }
      compared++;
      // A unit may hold several formula-units, and `matter` says how many --
      // Liquid Oxygen is `O2` written on a unit that holds four Oxygen Gas.
      const sum = [...m.atoms.values()].reduce((a, b) => a + b, 0);
      const times = sum && m.matter ? m.matter / sum : 1;
      const holds = Number.isInteger(times) && times > 0 ? times : 1;
      if (got !== want * holds) off.push(`${m.name} ${el}: ${got} not ${want * holds}`);
    }
  }
  check(compared > 2000, `${compared} element counts to compare, ${declined} declined`);
  check(!off.length,
        `every one agrees with the material's own atoms, times what a unit holds` +
        `${off.length ? `: ${off[0]}` : ''}`);
  check(atomsIn(graph, 'Hydrogen Gas x2', 'H') === 4,
        'a container of two hydrogen gas holds four hydrogen');
  check(atomsIn(graph, 'Aqua Regia', 'Cl') === 3 && atomsIn(graph, 'Gypsum', 'O') === 6,
        'and a coefficient counts for the segment it stands in front of');
  /**
   * A percentage is not a count of anything, so it is declined rather than
   * dropped. Dropped, a unit of Molten Cobalt Steel read as one cobalt and one
   * iron, and six of them out of one cobalt and five iron read as five cobalt
   * created.
   */
  check(atomsIn(graph, 'Molten Cobalt Steel', 'Fe') === null,
        'while 17% cobalt 83% iron is declined, not counted as one of each');
  /**
   * A unit of Liquid Oxygen holds four Oxygen Gas, so eight oxygen, though its
   * formula says `O2` -- the formula describes the substance and `matter` the
   * unit. Ammonium Ion weighs four fifths of its formula, which is no whole
   * number of anything, so its own count stands rather than being scaled into
   * fractions of an atom.
   */
  check(atomsIn(graph, 'Liquid Oxygen', 'O') === 8,
        'a unit of Liquid Oxygen tallies eight oxygen, not two');
  check(atomsIn(graph, 'Oxygen Gas', 'O') === 2, 'and a unit of the gas still two');
  check(atomsIn(graph, 'Ammonium Ion', 'N') === 1,
        'while a ratio that is not whole leaves the formula to speak for itself');
  /**
   * And those two are the only materials whose weight is not their own
   * formula's sum, which is worth pinning: the scaling only means anything
   * while the data disagrees with itself somewhere.
   */
  {
    const off = graph.db.materials.filter((m) => {
      if (!m.atoms || m.matter === null || m.matter === undefined) return false;
      const sum = [...m.atoms.values()].reduce((a, b) => a + b, 0);
      return sum && m.matter !== sum;
    }).map((m) => m.name).sort();
    check(off.join() === 'Ammonium Ion,Liquid Oxygen',
          `and only those two weigh anything but their formula: ${off.join(', ')}`);
  }
}

console.log('\n--- the pair gate proves them either way round ---');
/**
 * `mintsElement` looked for the handoff only as what the first recipe makes
 * that the second eats, so three of the sixteen pairs -- named the other way
 * about -- were declared unprovable at the first line and their exclusions sat
 * disarmed. One of them is how a plan came to make three Oxygen Gas a batch
 * out of nothing.
 */
check(unprovenBugs(graph).length === 0,
      `every known minting pair is proven${unprovenBugs(graph).length ? `: ${unprovenBugs(graph).map((u) => u.drop).join(', ')}` : ''}`);

console.log('\n--- which cost is weighed first ---');
/**
 * `weighPlan` settles which ore a plan starting from nothing buys, and it read
 * atoms, then items, then reactors, in that order and no other. Read strictly
 * that pays twenty-five reactors to save an atom. Carbon is the plainest case:
 * a third of an atom a unit across five reactors, or a whole atom in one.
 *
 * The default must not have moved -- it is the same three in the same order --
 * so the check is that asking for something else answers differently and in
 * the direction asked for.
 */
check(WEIGH_BY.join() === SCORES.filter((s) => !s.tiebreak).map((s) => s.id).join(),
      'every cost the menu scores can be weighed first, and only those');
{
  const ask = (weigh) => {
    try { return solveFresh(graph, { targets: [{ name: 'Carbon', amount: 1 }], weigh }); }
    catch { return null; }
  };
  const usual = ask([]);
  const lean = ask(['reactors']);
  check(usual && usual.steps.length && lean && lean.steps.length,
        'Carbon answers both ways');
  check(lean.realSteps < usual.realSteps,
        `asked for fewest reactors it uses fewer: ${usual.realSteps} -> ${lean.realSteps}`);
  check(rnum(usual.madeOf('Carbon')) >= usual.spec.targets[0].amount &&
        rnum(lean.madeOf('Carbon')) >= lean.spec.targets[0].amount,
        'and both still make the carbon they promise');
  check(ask(['nonsense']).steps.length === usual.steps.length,
        'a name that is not a cost is ignored rather than obeyed');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
