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

/**
 * A phase change that hands back more than it was given.
 *
 * Thirty-nine of the game's nine hundred and forty-six do: heating one Heavy
 * Oil gives four Diesel Vapor, which is what cracking is, and mass is
 * conserved even though the count is not. Run one of them beside its opposite
 * and the count is all the arithmetic sees -- one Heavy Oil Vapor condenses to
 * two Heavy Oil, which evaporate to four Heavy Oil Vapor, and matter is being
 * minted. Asked for Carbon and given a free hand, the first thing the simplex
 * found was that loop: burn the oil it had just made out of nothing, and take
 * the Carbon out of the smoke.
 *
 * A solver that works backwards from what it needs never goes looking for
 * this. One that minimises what it buys goes looking for exactly this. So the
 * gainful ones are set aside, and cracking routes are not available here --
 * a real limitation, and a smaller wrong answer than free matter.
 */
const mints = (p) => p.kind === 'phase' &&
  p.produces.reduce((a, o) => a + o.count, 0) >
  inputsOf(p).reduce((a, i) => a + i.count, 0);

/**
 * The part of the graph worth handing to the simplex.
 *
 * Two thousand three hundred processes over eighteen hundred materials is far
 * past what an exact rational tableau will pivot in a hurry, so the question
 * has to be made smaller before it is asked. This walks back from what was
 * asked for and forward from what the reader has, and stops at anything the
 * world hands over.
 *
 * It is a restriction on the search and not a ranking of plans: everything it
 * keeps competes on equal terms, and the only judgement in here is how many
 * ways of making one material are worth carrying at once.
 */
export function subgraph(graph, spec) {
  const kinds = spec.kinds;
  const usable = (p) => kinds.has(p.kind) && !mints(p) &&
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

  /** Runnable at all, and how deep a hole it is at its deepest input. */
  const reachable = (p) => inputsOf(p).every((i) => depth.has(i.name));
  const cost = (p) => inputsOf(p).reduce((a, i) => Math.max(a, depth.get(i.name) ?? 99), 0);

  const chosen = new Map();
  const take = (p) => { if (!chosen.has(p.id)) chosen.set(p.id, p); };
  const pick = (list) => list.filter(reachable)
    .sort((a, b) => cost(a) - cost(b) ||
                    inputsOf(a).length - inputsOf(b).length ||
                    a.id.localeCompare(b.id))
    .slice(0, spec.ways);

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
      for (const p of pick(graph.producers(name).filter(usable))) {
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
      for (const p of pick(graph.consumers(name).filter(usable))) {
        take(p);
        for (const o of p.produces) next.push(o.name);
      }
    }
    front = next;
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

export const FRESH_DEFAULTS = { ways: 3, reach: 9 };

export function normalizeFresh(spec) {
  return {
    targets: (spec.targets || []).map((t) =>
      typeof t === 'string' ? { name: t, amount: 1 } : { name: t.name, amount: t.amount ?? 1 }),
    have: new Set(spec.have || []),
    kinds: new Set(spec.kinds || DEFAULT_KINDS),
    excludeProcesses: new Set(spec.excludeProcesses || []),
    excludeMaterials: new Set(spec.excludeMaterials || []),
    ways: spec.ways ?? FRESH_DEFAULTS.ways,
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
export function solveFresh(graph, rawSpec) {
  const spec = normalizeFresh(rawSpec);
  const sub = subgraph(graph, spec);
  const procs = sub.processes;
  if (!procs.length) return null;

  const index = new Map(procs.map((p, i) => [p.id, i]));
  const P = procs.length;

  // One supply variable per material the world will hand over, and one per
  // material the reader says they have. What is held costs nothing; what is
  // bought costs one a unit, which is what "fetch total" counts.
  const supply = new Map();
  let next = P;
  for (const name of sub.materials) {
    if (spec.have.has(name) || fetchable(graph, name, spec.kinds)) supply.set(name, next++);
  }
  const vars = next;
  const bought = (name) => !spec.have.has(name);

  const net = new Map();               // material -> Map(var -> rational)
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
  for (const name of sub.materials) {
    const coeffs = net.get(name);
    if (!coeffs || !coeffs.size) continue;
    rows.push({ coeffs, op: '>=', rhs: demand.get(name) || R0 });
  }
  if (!rows.length) return null;

  const fetchCost = new Map();
  for (const [name, i] of supply) if (bought(name)) fetchCost.set(i, rat(1));

  /** Run the whole thing with some processes forbidden, and say what it cost. */
  const attempt = (banned, extra = []) => {
    const lo = new Map();
    const caps = [...extra];
    for (const p of procs) if (banned.has(p.id)) {
      caps.push({ coeffs: new Map([[index.get(p.id), rat(1)]]), op: '=', rhs: R0 });
    }
    const first = solveLP({ vars, rows: [...rows, ...caps], cost: fetchCost, lo, steep: true });
    if (!first.ok) return null;
    let total = R0;
    for (const [name, i] of supply) if (bought(name)) total = radd(total, first.x[i]);
    return { total, x: first.x, caps };
  };

  let base = attempt(new Set());
  if (!base) return null;

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
  const eats = (name) => {
    const coeffs = new Map();
    for (const p of procs) {
      const c = inputsOf(p).find((i) => i.name === name);
      if (c) coeffs.set(index.get(p.id), rat(c.count));
    }
    return coeffs.size ? { coeffs, op: '>=', rhs: rat(1) } : null;
  };
  const demands = [];
  for (const name of spec.have) {
    const row = eats(name);
    if (!row) continue;
    const trial = attempt(new Set(), [...demands, row]);
    if (trial && rcmp(trial.total, base.total) <= 0) { demands.push(row); base = trial; }
  }

  /**
   * Fewest real steps, with the shopping list held where it was.
   *
   * Counting how many processes run is not something a linear objective can
   * do -- it is the number of non-zero variables, and the simplex minimises
   * sums, not counts. So it is done by asking: can this one be left out and
   * the rest still buy no more than before? Cheapest first, since a process
   * running a fraction of a time is the likeliest to be doing nothing much.
   */
  const pinned = (t) => {
    const coeffs = new Map();
    for (const [name, i] of supply) if (bought(name)) coeffs.set(i, rat(1));
    return { coeffs, op: '=', rhs: t };
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
      const trial = attempt(new Set([...banned, p.id]), [pinned(base.total), ...demands]);
      if (!trial) continue;
      banned.add(p.id);
      best = trial;
      dropped = true;
      break;
    }
    if (!dropped) break;
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
