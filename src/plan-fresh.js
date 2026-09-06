/**
 * A planner with two priorities and nothing else.
 *
 * The old solver ranks plans on six or seven things at once -- how much is
 * fetched, how many kinds, how much is thrown away, how long the plan is, what
 * has to be laid in -- and each of those was added because some plan came out
 * wrong without it. Read together they are no longer a statement of what a good
 * plan is; they are a record of arguments won.
 *
 * This one says: get what was asked for out of what the reader has, buying
 * nothing if that can be done and as little as possible otherwise, and among
 * the answers that manage it prefer the one with the fewest real steps. A
 * phase change is not a real step -- freezing water is not a stage of a
 * factory, it is the same material at a different temperature -- so those are
 * not counted.
 *
 * Everything else is a consequence, not a rule.
 */
import { DEFAULT_KINDS } from './plan-graph.js';
import { composition, elementsOf } from './composition.js';
import { solveLP } from './simplex.js';
import { solveLPFloat } from './simplex-float.js';
import { rat, R0, radd, rsub, rmul, rdiv, rcmp, rnum, rzero, rstr, lcm }
  from './rational.js';

/** Lying around outside: you go and pick it up. */
const WORLDLY = new Set(['deposit', 'terrain', 'plant']);

/** Static and not worldly: it exists only where somebody placed it. */
const placed = (graph, name) =>
  graph.stateOf(name) === 'Static' && !WORLDLY.has(graph.categoryOf(name));

/**
 * Whether the world will simply hand this over.
 *
 * The same division the old planner drew with its `acquire` weights, kept
 * because it is a fact about the game rather than a preference about plans:
 * ores and deposits and plants are where a chain bottoms out, and a thing with
 * a recipe is meant to be made. Without it "fetch as little as possible" has a
 * silly answer -- fetch the two Molten Aluminum and skip the smelting.
 */
export function fetchable(graph, name, kinds) {
  if (placed(graph, name)) return false;
  if (graph.fallsFromSky(name)) return true;
  if (WORLDLY.has(graph.categoryOf(name))) return true;
  if (graph.isManufactured(name)) return false;
  return !graph.producers(name).some((p) => kinds.has(p.kind));
}

/** A process's inputs: what it spends, and what it needs standing by. */
const inputsOf = (p) => [...p.consumes, ...p.requires];

export function subgraph(graph, spec) {
  const kinds = spec.kinds;
  const usable = (p) => kinds.has(p.kind) &&
    !spec.excludeProcesses.has(p.id) &&
    !inputsOf(p).some((i) => spec.excludeMaterials.has(i.name) || placed(graph, i.name)) &&
    !p.produces.some((o) => spec.excludeMaterials.has(o.name));
  const allowed = graph.processes.filter(usable);

  /**
   * How far from the ground a material is.
   *
   * Zero for anything the reader has or the world hands over; one more than
   * the furthest of its inputs for anything else. Worked out forwards over the
   * whole graph before anything is chosen, because the question a backward
   * walk cannot answer is the one that matters most -- not "what makes this"
   * but "which of the things that make it can actually be got".
   *
   * Picking producers without it was the first version and it could not plan
   * Columbite at all: three ways of making Tantalum, chosen by having the
   * fewest inputs, every one of them starting from something nothing here
   * could make.
   */
  const depth = new Map();
  for (const name of spec.have) depth.set(name, 0);
  for (const p of allowed) for (const i of inputsOf(p)) {
    if (!depth.has(i.name) && fetchable(graph, i.name, kinds)) depth.set(i.name, 0);
  }
  for (const t of spec.targets) {
    if (!depth.has(t.name) && fetchable(graph, t.name, kinds)) depth.set(t.name, 0);
  }
  for (let round = 0; round < spec.reach; round++) {
    let moved = false;
    for (const p of allowed) {
      let worst = 0;
      let ready = true;
      for (const i of inputsOf(p)) {
        const d = depth.get(i.name);
        if (d === undefined) { ready = false; break; }
        if (d > worst) worst = d;
      }
      if (!ready) continue;
      for (const o of p.produces) {
        const was = depth.get(o.name);
        if (was === undefined || was > worst + 1) { depth.set(o.name, worst + 1); moved = true; }
      }
    }
    if (!moved) break;
  }

  /** Runnable at all: everything it eats can be got from somewhere. */
  const reachable = (p) => inputsOf(p).every((i) => depth.has(i.name));

  /**
   * How much of what it eats has to be bought.
   *
   * This used to rank candidates by how shallow they were -- how quickly the
   * route bottomed out -- and that is a judgement about cost, which is the
   * objective's business and not the walk's. Worse, it is the wrong judgement:
   * a route that hands back what you already have is *made of* deep things, so
   * the deeper the loop the worse it ranked. Carbon has a hundred and twenty-
   * five producers in the Lepidolite plan; three were kept; the potassium
   * reduction that closes the carbon loop came a hundred and seventeenth,
   * because Molten Potassium is six deep and a chicken is lying on the ground.
   *
   * The priority the reader was promised is that buying anything is worse than
   * any amount of chain. So the walk counts what a route buys, not how far it
   * reaches: a producer that eats only things the plan can make ranks above one
   * that eats something off the shelf, and depth is left as a tie-break among
   * equals.
   */
  const buysIn = (p) => inputsOf(p)
    .filter((i) => !spec.have.has(i.name) && fetchable(graph, i.name, kinds)).length;
  const cost = (p) => inputsOf(p).reduce((a, i) => Math.max(a, depth.get(i.name) ?? 99), 0);

  const chosen = new Map();
  const take = (p) => { if (!chosen.has(p.id)) chosen.set(p.id, p); };
  /**
   * Keeping the ways that bottom out soonest is how the deep route gets lost.
   *
   * Asked for Carbon by somebody holding Carbon Dioxide, this kept a chicken,
   * a hamburger and a mushroom spore -- all one step from something lying
   * about outside -- and dropped the potassium reduction, which is six steps
   * deep and the only thing in the game that turns their carbon dioxide into
   * carbon. Then it reported that buying a chicken was cheaper than using the
   * stock, which was true of what it had been given and false of the game.
   *
   * Ranking candidates by how shallow they are is the old planner's bias
   * wearing a different hat, and it is worst exactly where an all-at-once
   * solver was supposed to help. So the first ring is taken whole -- every way
   * of making what was asked for, every way of spending what the reader has --
   * and the cap applies only further out, where the count really does explode.
   */
  const pick = (list, whole) => {
    const live = list.filter(reachable);
    if (whole) return live;
    return live.sort((a, b) => buysIn(a) - buysIn(b) ||
                               cost(a) - cost(b) ||
                               inputsOf(a).length - inputsOf(b).length ||
                               a.id.localeCompare(b.id))
      .slice(0, spec.ways);
  };

  // Backward: what makes the thing, and what makes that -- shallowest first,
  // so the ways kept are the ones that bottom out soonest.
  const seenBack = new Set();
  let front = spec.targets.map((t) => t.name);
  for (let d = 0; d < spec.reach && front.length; d++) {
    const next = [];
    for (const name of front) {
      if (seenBack.has(name)) continue;
      seenBack.add(name);
      if (spec.have.has(name) || fetchable(graph, name, kinds)) continue;
      for (const p of pick(graph.producers(name).filter(usable), d === 0)) {
        take(p);
        for (const i of inputsOf(p)) next.push(i.name);
      }
    }
    front = next;
  }

  // Forward: what the reader's stock can turn into, which a backward walk
  // cannot see -- "I have carbon dioxide" is only worth saying if something
  // that eats carbon dioxide is on the table.
  const seenFwd = new Set();
  front = [...spec.have];
  for (let d = 0; d < spec.reach && front.length; d++) {
    const next = [];
    for (const name of front) {
      if (seenFwd.has(name)) continue;
      seenFwd.add(name);
      for (const p of pick(graph.consumers(name).filter(usable), d === 0)) {
        take(p);
        for (const o of p.produces) next.push(o.name);
      }
    }
    front = next;
  }

  /**
   * And whatever would eat what this is about to throw away.
   *
   * Neither walk can find a recycling route, and no ranking rescues it. The
   * backward walk asks what makes Carbon and gets a hundred and twenty-five
   * answers, of which the useful one -- burn the carbon dioxide you are
   * venting back into carbon -- is far down any ordering, because its inputs
   * are deep by construction. The forward walk from the stock never gets there
   * either, because the carbon dioxide is six steps downstream of the ore.
   *
   * So the set is asked a third question, once it exists: what does this
   * produce that nothing here consumes, and what would consume it? Those are
   * offered too, along with what they need. It is the only one of the three
   * walks that is looking for a loop rather than a route, and it is the one
   * that puts `rx:Molten Potassium + Carbon Dioxide` and `rx:Hydrogen
   * Combustion` on the table at all.
   */
  const table = composition(graph);
  for (let round = 0; round < spec.loops; round++) {
    const made = new Set();
    const eaten = new Set();
    for (const p of chosen.values()) {
      for (const o of p.produces) made.add(o.name);
      for (const i of inputsOf(p)) eaten.add(i.name);
    }
    /**
     * Everything this makes that is worth trying to use up: it carries one of
     * the three elements the loops are built out of, and few enough things eat
     * it that all of them can be offered without the set running away.
     */
    const recyclable = [...made].filter((n) => {
      if (spec.targets.some((t) => t.name === n)) return false;
      const els = table.get(n)?.elements;
      if (!els || !(els.has('C') || els.has('O') || els.has('H'))) return false;
      return graph.consumers(n).filter(usable).length <= spec.eaters;
    });
    /**
     * Take every way of using it up, not the three that rank best.
     *
     * Ranking was the wrong tool twice over. Carbon Dioxide is not even spare
     * -- six of its thirteen consumers were already here, freezing it into Dry
     * Ice and dissolving it into Carbonic Acid -- so a pass that looked only at
     * what nothing eats never considered it, and a pass that ranked its
     * consumers put Dry Ice above the potassium reduction on the same
     * shallow-is-better reasoning that started all this.
     *
     * The thing that makes it tractable is that the numbers are small at this
     * end. Carbon Dioxide has thirteen consumers, Carbon Monoxide five, Steam
     * ten, Oxygen Gas nine. Producers are where the count explodes -- Carbon
     * has a hundred and fifty-three -- and this pass does not need those. So
     * for anything the plan makes that carries carbon, oxygen or hydrogen,
     * every way of consuming it is offered, and the simplex decides.
     */
    let added = 0;
    for (const name of recyclable) {
      const eaters = graph.consumers(name).filter(usable).filter(reachable);
      for (const p of eaters) {
        if (chosen.has(p.id)) continue;
        take(p);
        added++;
        // What that one needs, so it can actually run.
        for (const i of inputsOf(p)) {
          if (spec.have.has(i.name) || fetchable(graph, i.name, kinds)) continue;
          for (const q of pick(graph.producers(i.name).filter(usable), false)) take(q);
        }
      }
    }
    if (!added) break;
  }

  const materials = new Set();
  for (const p of chosen.values()) {
    for (const i of inputsOf(p)) materials.add(i.name);
    for (const o of p.produces) materials.add(o.name);
  }
  for (const t of spec.targets) materials.add(t.name);
  return { processes: [...chosen.values()], materials, depth };
}

/* ----------------------------------------------------------------- the ask */

export const FRESH_DEFAULTS = { ways: 3, reach: 9, loops: 3, eaters: 30 };

export function normalizeFresh(spec) {
  return {
    targets: (spec.targets || []).map((t) =>
      typeof t === 'string' ? { name: t, amount: 1 } : { name: t.name, amount: t.amount ?? 1 }),
    have: new Set(spec.have || []),
    kinds: new Set(spec.kinds || DEFAULT_KINDS),
    excludeProcesses: new Set(spec.excludeProcesses || []),
    excludeMaterials: new Set(spec.excludeMaterials || []),
    ways: spec.ways ?? FRESH_DEFAULTS.ways,
    loops: spec.loops ?? FRESH_DEFAULTS.loops,
    eaters: spec.eaters ?? FRESH_DEFAULTS.eaters,
    reach: spec.reach ?? FRESH_DEFAULTS.reach,
  };
}

/**
 * The two questions, asked in order, exactly.
 *
 * Buy as little as possible; then, among the answers that buy exactly that
 * much, use as few real steps as possible. The second is asked with the first
 * one's answer nailed down as an equality, so no amount of step-saving can
 * talk the shopping list back up -- which is what "if possible, with no fetch"
 * means when it is written down rather than weighted.
 */
/**
 * Supply against demand, one row a material, one column a step.
 *
 * Every material carries `made + supplied >= used + asked for`. A supply
 * column exists only where the world will hand the stuff over or the reader
 * said they have it; held stock costs nothing and there is as much of it as
 * you like, and everything else costs one a unit, which is the whole of what
 * "fetch total" means.
 */
export function model(graph, spec, procs, materials) {
  const index = new Map(procs.map((p, i) => [p.id, i]));
  const supply = new Map();
  let next = procs.length;
  for (const name of materials) {
    if (spec.have.has(name) || fetchable(graph, name, spec.kinds)) supply.set(name, next++);
  }
  const vars = next;
  const bought = (name) => !spec.have.has(name);

  const net = new Map();
  const put = (name, i, v) => {
    let row = net.get(name);
    if (!row) net.set(name, (row = new Map()));
    row.set(i, radd(row.get(i) || R0, v));
  };
  for (const p of procs) {
    const i = index.get(p.id);
    for (const o of p.produces) put(o.name, i, rat(o.count));
    for (const c of inputsOf(p)) put(c.name, i, rsub(R0, rat(c.count)));
  }
  for (const [name, i] of supply) put(name, i, rat(1));

  const demand = new Map(spec.targets.map((t) => [t.name, rat(t.amount)]));
  const rows = [];
  for (const name of materials) {
    const coeffs = net.get(name);
    if (!coeffs || !coeffs.size) continue;
    rows.push({ coeffs, op: '>=', rhs: demand.get(name) || R0 });
  }
  if (!rows.length) return null;

  const fetchCost = new Map();
  for (const [name, i] of supply) if (bought(name)) fetchCost.set(i, rat(1));
  return { index, supply, vars, rows, fetchCost, bought };
}

/**
 * Which of the candidates a good answer actually uses.
 *
 * The exact tableau cannot be asked this: four hundred processes over three
 * hundred materials is minutes a solve, and the step-elimination wants one
 * solve per step it tries to drop. So the same question is put in doubles,
 * which answers in well under a second, and all that is kept is the list of
 * processes that came out non-zero -- usually twenty or thirty. Every number
 * the reader is shown is then worked out exactly over that shortlist.
 *
 * A shortlist that is slightly wrong costs a slightly worse plan. It cannot
 * cost a wrong quantity, because no quantity from here survives.
 */
export function shortlist(graph, spec, sub, build) {
  const model = build(sub.processes, sub.materials);
  if (!model) return null;
  const rows = model.rows.map((row) => ({
    coeffs: new Map([...row.coeffs].map(([i, a]) => [i, rnum(a)])),
    op: row.op,
    rhs: rnum(row.rhs),
  }));
  const cost = new Map([...model.fetchCost].map(([i, a]) => [i, rnum(a)]));
  const answer = solveLPFloat({ vars: model.vars, rows, cost });
  if (!answer.ok) return null;
  const keep = sub.processes.filter((p) => answer.x[model.index.get(p.id)] > 0);
  if (!keep.length) return null;
  const materials = new Set();
  for (const p of keep) {
    for (const i of inputsOf(p)) materials.add(i.name);
    for (const o of p.produces) materials.add(o.name);
  }
  for (const t of spec.targets) materials.add(t.name);
  return { processes: keep, materials };
}

/**
 * A loop that makes something out of nothing.
 *
 * Asked to buy as little as possible, the solver will find any set of steps
 * that hands back more than it was given, and the game has them: three Molten
 * Iron and one Carbon make three Molten Steel, and each Molten Steel burns
 * back to a whole Carbon Dioxide, so one carbon becomes three. Given a wide
 * enough field the Lepidolite plan was built on that, and needed almost no ore
 * and no shopping list at all. It is not a cheap plan, it is a lie.
 *
 * The test is material-level and needs no chemistry: take the steps the plan
 * chose, cut off every supply -- nothing fetched, nothing held -- and ask
 * whether they can still produce anything. A set that can is a perpetual
 * motion machine, and the biggest wheel in it is the one to take out.
 *
 * Counting atoms was tried first and is the wrong tool. An aqueous salt's
 * formula does not carry its water, so evaporating one appears to conjure the
 * steam, and three hundred and fifty-six of the game's reactions read as
 * minting something. The game is deliberately approximate in places; this
 * question is not about chemistry at all, only about whether a wheel turns
 * for free.
 */
function freeLunch(graph, spec, plan) {
  const procs = plan.steps.map((s) => s.process);
  if (procs.length < 2) return null;
  const index = new Map(procs.map((p, i) => [p.id, i]));

  const net = new Map();
  const put = (name, i, v) => {
    let row = net.get(name);
    if (!row) net.set(name, (row = new Map()));
    row.set(i, (row.get(i) || 0) + v);
  };
  for (const p of procs) {
    const i = index.get(p.id);
    for (const o of p.produces) put(o.name, i, o.count);
    for (const c of inputsOf(p)) put(c.name, i, -c.count);
  }

  // Every material must come out even or ahead, with nothing coming in.
  const rows = [];
  for (const [, coeffs] of net) rows.push({ coeffs, op: '>=', rhs: 0 });
  // Bounded, so that a wheel which does turn for free reports a number rather
  // than running away and reporting nothing at all.
  for (const p of procs) {
    rows.push({ coeffs: new Map([[index.get(p.id), 1]]), op: '<=', rhs: 1000 });
  }

  /**
   * Asked once for each material the plan both makes and spends, because a
   * wheel has to be turning on something. Not the targets: the carbon wheel
   * does not make Potassium out of nothing, it makes Carbon out of nothing and
   * spends it reducing the silica, and by the time it reaches Potassium there
   * is real ore in the chain. And not the total number of units either --
   * three Carbon Dioxide out of one Carbon and three Oxygen is fewer things
   * than it started with, and still a carbon multiplied by three.
   */
  const spun = new Set();
  for (const p of procs) for (const o of p.produces) spun.add(o.name);
  for (const name of spun) {
    const coeffs = net.get(name);
    if (!coeffs) continue;
    if (!procs.some((p) => inputsOf(p).some((i) => i.name === name))) continue;
    const cost = new Map();
    for (const [i, v] of coeffs) if (v !== 0) cost.set(i, -v);
    const answer = solveLPFloat({ vars: procs.length, rows, cost });
    if (!answer.ok) continue;
    let made = 0;
    for (const [i, v] of coeffs) made += v * answer.x[i];
    if (made <= 1e-6) continue;

    let biggest = 0;
    let blame = null;
    for (const p of procs) {
      const runs = answer.x[index.get(p.id)];
      if (runs > biggest) { biggest = runs; blame = p.id; }
    }
    if (blame) return blame;
  }
  return null;
}

export function solveFresh(graph, rawSpec) {
  const barred = new Set(rawSpec.excludeProcesses || []);
  for (let round = 0; round < 8; round++) {
    const plan = planOnce(graph, { ...rawSpec, excludeProcesses: [...barred] });
    if (!plan) return null;
    const cheat = freeLunch(graph, normalizeFresh(rawSpec), plan);
    if (!cheat) return plan;
    barred.add(cheat);
  }
  return null;
}

function planOnce(graph, rawSpec) {
  const spec = normalizeFresh(rawSpec);
  const whole = subgraph(graph, spec);
  if (!whole.processes.length) return null;

  const build = (procs, materials) => model(graph, spec, procs, materials);
  const narrow = shortlist(graph, spec, whole, build);
  const sub = narrow || whole;
  const procs = sub.processes;
  if (!procs.length) return null;

  const built = model(graph, spec, procs, sub.materials);
  if (!built) return null;
  const { index, supply, vars, rows, fetchCost, bought } = built;

  /** Run the whole thing with some processes forbidden, and say what it cost. */
  /**
   * Everything that comes in from outside, held or bought alike.
   *
   * The second question, once the shopping list is as short as it goes: how
   * much has to go in at all. Held stock is free at the till and it is not
   * free in the world -- a plan that decomposes twenty-two Lepidolite to
   * manufacture water, and bins forty Molten Lithium on the way, buys nothing
   * and is nobody's idea of a good answer.
   */
  const inputCost = new Map();
  for (const [, i] of supply) inputCost.set(i, rat(1));

  const attempt = (banned, extra = [], cost = fetchCost) => {
    const lo = new Map();
    const caps = [...extra];
    for (const p of procs) if (banned.has(p.id)) {
      caps.push({ coeffs: new Map([[index.get(p.id), rat(1)]]), op: '=', rhs: R0 });
    }
    const first = solveLP({ vars, rows: [...rows, ...caps], cost, lo, steep: true });
    if (!first.ok) return null;
    let total = R0;
    let drawn = R0;
    for (const [name, i] of supply) {
      if (bought(name)) total = radd(total, first.x[i]);
      drawn = radd(drawn, first.x[i]);
    }
    return { total, drawn, x: first.x, caps };
  };

  const sumOf = (which) => {
    const coeffs = new Map();
    for (const [name, i] of supply) if (which(name)) coeffs.set(i, rat(1));
    return coeffs;
  };
  const pinnedFetch = (t) => ({ coeffs: sumOf(bought), op: '=', rhs: t });
  const pinnedInput = (t) => ({ coeffs: sumOf(() => true), op: '=', rhs: t });

  let base = attempt(new Set());
  if (!base) return null;

  /**
   * Then as little as possible in at the door, with the till pinned.
   *
   * Step count used to be the second question and it was making bad trades to
   * answer it: dropping `cond:Steam` saves one step, and costs twenty-two ore
   * decomposed to make the water another way. Nothing in "buy little, then run
   * few steps" can see that, because the ore was free and the forty Molten
   * Lithium it threw away were not counted at all. Asked for nine metal, that
   * plan spent thirteen ore where three would do.
   *
   * Sparr: maximise what comes out against what goes in. With the order at its
   * floor -- and it is, since nothing here rewards making more than was asked
   * -- that is the same thing as minimising what goes in, which is linear and
   * needs no ratio.
   */
  const leaner = attempt(new Set(), [pinnedFetch(base.total)], inputCost);
  if (leaner) base = leaner;

  /**
   * And it has to actually use what the reader said they have.
   *
   * "Lowest fetch total" on its own does not say this, and left to itself the
   * simplex does not do it. Asked for Carbon by somebody holding Carbon
   * Dioxide, it bought one Chicken (Raw) and cooked it: one thing fetched
   * against the one ore the potassium route needs, no real steps against two,
   * and the carbon dioxide untouched on the floor. By the stated priorities
   * that answer wins, which is how you find out the priorities were not the
   * whole of what was meant.
   *
   * So each stock is required to be spent, one material at a time and only
   * where requiring it costs nothing at the till -- a stock that cannot be
   * used without buying more is a stock the plan is right to leave alone.
   */
  const demands = [];

  /**
   * Fewest real steps, with the shopping list held where it was.
   *
   * Counting how many processes run is not something a linear objective can
   * do -- it is the number of non-zero variables, and the simplex minimises
   * sums, not counts. So it is done by asking: can this one be left out and
   * the rest still buy no more than before? Cheapest first, since a process
   * running a fraction of a time is the likeliest to be doing nothing much.
   */
  const pinned = pinnedFetch;
  /**
   * The same question in doubles, for deciding which steps to try dropping.
   *
   * Taking a step out and asking whether the rest still manages is one exact
   * rational solve per step tried, and there are as many tries as there are
   * steps: forty-five of them on the Columbite plan, which is where fourteen
   * of its fifteen seconds went. The answer to "can this be left out" does not
   * need to be exact -- it needs to be right, and then the numbers that come
   * out of it are worked out exactly once at the end.
   *
   * No equality pinning here. Floats and exact equalities do not mix, so the
   * screen asks the looser question -- does it still buy no more, and still
   * draw in no more -- with a hair of tolerance, and lets the exact pass be
   * the judge of that.
   */
  const floatRows = rows.map((row) => ({
    coeffs: new Map([...row.coeffs].map(([i, a]) => [i, rnum(a)])),
    op: row.op,
    rhs: rnum(row.rhs),
  }));
  const floatCost = new Map([...inputCost].map(([i, a]) => [i, rnum(a)]));
  const ceiling = { fetch: rnum(base.total) + 1e-6, drawn: rnum(base.drawn) + 1e-6 };

  const screen = (banned) => {
    const caps = [];
    for (const p of procs) if (banned.has(p.id)) {
      caps.push({ coeffs: new Map([[index.get(p.id), 1]]), op: '=', rhs: 0 });
    }
    const answer = solveLPFloat({ vars, rows: [...floatRows, ...caps], cost: floatCost });
    if (!answer.ok) return false;
    let fetched = 0;
    let drawn = 0;
    for (const [name, i] of supply) {
      if (bought(name)) fetched += answer.x[i];
      drawn += answer.x[i];
    }
    return fetched <= ceiling.fetch && drawn <= ceiling.drawn;
  };

  const banned = new Set();
  let best = base;
  for (;;) {
    const used = procs
      .filter((p) => p.kind !== 'phase' && !banned.has(p.id) && !rzero(best.x[index.get(p.id)]))
      .sort((a, b) => rcmp(best.x[index.get(a.id)], best.x[index.get(b.id)]) ||
                      a.id.localeCompare(b.id));
    let dropped = false;
    for (const p of used) {
      if (!screen(new Set([...banned, p.id]))) continue;
      banned.add(p.id);
      dropped = true;
      break;
    }
    if (!dropped) break;
    // The screen decides which to try; the numbers still come from the exact
    // solver, and the loop needs a solution to read its next candidates from.
    const settled = attempt(banned,
      [pinnedFetch(base.total), pinnedInput(base.drawn), ...demands], inputCost);
    if (!settled) { banned.delete([...banned].pop()); break; }
    best = settled;
  }

  return assemble(graph, spec, procs, index, supply, best.x, base.total, sub);
}

/* -------------------------------------------------------------- the answer */

/**
 * What the run counts add up to.
 *
 * The supplies are worked out here rather than read off the tableau, because
 * held stock costs nothing and a free variable will happily be taken in
 * quantities nobody needs and dumped straight back out as a leftover. What the
 * plan actually draws is what its steps come up short by.
 */
function assemble(graph, spec, procs, index, supply, x, fetchTotal, sub) {
  // Whole runs. A step cannot be run four sevenths of a time, so the plan is
  // multiplied up until every count is a whole number -- which is why asking
  // for one sometimes makes four.
  let mul = 1n;
  for (const p of procs) {
    const v = x[index.get(p.id)];
    if (!rzero(v)) mul = lcm(mul, v.d);
  }
  const scale = rat(mul);
  const runs = new Map();
  for (const p of procs) {
    const v = rmul(x[index.get(p.id)], scale);
    if (!rzero(v)) runs.set(p.id, v);
  }

  const made = new Map();
  const used = new Map();
  const add = (map, name, v) => map.set(name, radd(map.get(name) || R0, v));
  for (const [id, n] of runs) {
    const p = graph.byId.get(id);
    for (const o of p.produces) add(made, o.name, rmul(n, rat(o.count)));
    for (const c of inputsOf(p)) add(used, c.name, rmul(n, rat(c.count)));
  }

  const asked = new Map(spec.targets.map((t) => [t.name, rmul(rat(t.amount), scale)]));
  const drawn = new Map();       // what has to come from outside the steps
  const spare = new Map();       // what is left when they have all run
  for (const name of new Set([...made.keys(), ...used.keys(), ...asked.keys()])) {
    const have = made.get(name) || R0;
    const want = radd(used.get(name) || R0, asked.get(name) || R0);
    const short = rsub(want, have);
    if (rcmp(short, R0) > 0) drawn.set(name, short);
    else if (rcmp(short, R0) < 0) spare.set(name, rsub(R0, short));
  }

  const steps = [...runs].map(([id, n]) => ({ process: graph.byId.get(id), runs: n }))
    .sort((a, b) => a.process.id.localeCompare(b.process.id));

  const frontier = [];
  const feed = [];
  for (const [name, amount] of drawn) {
    if (spec.have.has(name)) feed.push({ name, amount });
    else frontier.push({ name, amount,
                         alternatives: graph.producers(name).filter((q) => spec.kinds.has(q.kind)).length });
  }
  const byproducts = [...spare]
    .filter(([name]) => !asked.has(name))
    .map(([name, amount]) => ({ name, amount, holds: [] }));

  const plan = {
    spec: { ...spec, targets: spec.targets.map((t) => ({ ...t, amount: t.amount * Number(mul) })) },
    fresh: true,
    steps, frontier, feed, byproducts,
    priming: [],
    brokenLoops: [],
    fetchTotal: rnum(rmul(fetchTotal, scale)),
    realSteps: steps.filter((s) => s.process.kind !== 'phase').length,
    considered: procs.length,
    runsOf: (id) => runs.get(id) || R0,
    madeOf: (name) => made.get(name) || R0,
    amountOf: (name) => used.get(name) || R0,
    otherSupplyOf: () => R0,
  };

  const want = elementsOf(graph, spec.targets.map((t) => t.name));
  if (want.size) {
    const table = composition(graph);
    for (const b of plan.byproducts) {
      const has = table.get(b.name)?.elements;
      if (!has) continue;
      const found = [...has].filter((el) => want.has(el));
      if (found.length) b.holds = found;
    }
  }
  return plan;
}
