/**
 * Turning a wish into a plan.
 *
 * The reader states what they want, what they already have, and any choices
 * they have made by hand. This works out the rest: which process makes each
 * material, what that leaves them still needing, what it produces that nobody
 * asked for, and how much of everything.
 *
 * Three passes, in order:
 *
 *   1. `costs`   -- a fixpoint over the whole hypergraph giving, for every
 *                   material, the cheapest way to have one. Knuth's shortest
 *                   hyperpath: the same relaxation as Dijkstra, generalised to
 *                   edges with several tails.
 *   2. `extract` -- follow the winning choice back from each target into a DAG,
 *                   memoised, so a material two branches both need is one node.
 *   3. `amounts` -- walk that DAG from the targets backwards, in exact
 *                   fractions, working out how many times each process runs.
 *
 * Nothing here draws anything. The plan it returns is plain data, so the graph
 * view and the table view are two readings of one object.
 */
import { KIND, DEFAULT_KINDS, operatingWindow } from './plan-graph.js';
import { heatingNeed, coolingNeed } from './units.js';

/* ------------------------------------------------------------- fractions */

/**
 * Exact rationals over BigInt.
 *
 * Run counts divide: one reaction makes 2 Molten Aluminum, so half a run makes
 * one. Floating point would turn a chain of those into 0.30000000000000004 of a
 * run and a bill of materials nobody trusts. Denominators are cleared at the
 * end by scaling the whole plan to a whole-numbered batch.
 */
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b;
                        while (b) { const t = a % b; a = b; b = t; } return a; };

export function rat(n, d = 1n) {
  n = BigInt(n); d = BigInt(d);
  if (!d) throw new Error('rational with zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

export const R0 = rat(0);
export const radd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const rsub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const rmul = (a, b) => rat(a.n * b.n, a.d * b.d);
export const rdiv = (a, b) => rat(a.n * b.d, a.d * b.n);
export const rcmp = (a, b) => { const l = a.n * b.d, r = b.n * a.d;
                                return l < r ? -1 : l > r ? 1 : 0; };
export const rmax = (a, b) => (rcmp(a, b) >= 0 ? a : b);
export const rnum = (a) => Number(a.n) / Number(a.d);
export const rzero = (a) => a.n === 0n;

/** "3", or "5/2" when it will not divide. */
export function rstr(a) {
  return a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
}

const lcm = (a, b) => (a / gcd(a, b)) * b;

/* --------------------------------------------------------------- weights */

/**
 * What each thing costs the solver. These are preferences, not game numbers --
 * they decide which of Steam's 108 producers a plan reaches for.
 *
 * The four `acquire*` weights are the price of simply *having* a material,
 * against which making it competes, and they differ by what kind of thing it
 * is because that is how the world hands it over:
 *
 * - `acquireWorld` -- deposits, terrain, plants. It is lying around outside.
 * - `acquireRaw`   -- an ore or an ingredient nothing allowed can make. This is
 *                     where a chain is meant to bottom out, so it is cheap and
 *                     the material lands on the frontier as something to fetch.
 * - `acquire`      -- something the reader could make. High, so the plan works
 *                     backwards through it; this is the "how far back should
 *                     this go" dial, and lowering it stops the plan earlier.
 *
 * A fourth case has no price at all: see `PLACED` below.
 */
export const DEFAULT_WEIGHTS = {
  acquire: 20,
  acquireRaw: 1,
  acquireWorld: 0.5,
  catalyst: 1,            // the apparatus a catalysed reaction needs building
  electrolysis: 1,
  /**
   * Doing it yourself. Placing a block is a real way to get one, but it is you
   * standing there doing it, so an automatic route should always win: ice is
   * water that froze, not a block you carried in, even though the game will
   * take either.
   */
  byHand: 10,
  /** Per side reaction no temperature can dodge: a mild nudge toward clean routes. */
  sideEffect: 0.5,
  /**
   * Working on something where it lies, because it cannot be moved. Heating a
   * deposit in the ground does produce the melt, and it is nobody's idea of a
   * production line -- the ore route wins unless there is not one.
   */
  inPlace: 4,
  perKelvin: 1 / 1200,     // a 2400 K furnace costs 2 more than a warm one
  slowness: 0.5,           // per decade of the probability divisor
  spark: 0.25,
};

/** Categories the world provides directly, wherever you find them. */
const WORLDLY = new Set(['deposit', 'terrain', 'plant']);

/**
 * Anything else in the Static state exists only where it was placed.
 *
 * An Aluminum Wall is not a loose material. You cannot have a stack of them,
 * pipe them into a machine or feed them to a reaction you are setting up
 * somewhere else -- and yet the data really does record one evaporating into
 * Molten Aluminum at 933 K, which made "melt a wall" the first plan this
 * solver ever produced. It is disqualified for not being portable, not for
 * being expensive: there is no price at which a wall becomes feedstock.
 *
 * It can still appear in a plan, as something a step *makes*, and a reaction
 * that eats one in place -- "Hydrochloric Acid Dissolves Iron Wall", and 19
 * others -- still works once the plan has built the wall.
 */
const placed = (graph, name) =>
  graph.stateOf(name) === 'Static' && !WORLDLY.has(graph.categoryOf(name));

/**
 * The cost of running one process, before its inputs are counted.
 *
 * The `Probability` field is a divisor rather than a fraction -- reactions
 * carry 4 to 10000, phase changes 2e6 to 6.4e7 -- so bigger means rarer. Its
 * decade count is a decent stand-in for how long you will be waiting.
 */
export function processCost(p, w = DEFAULT_WEIGHTS, avoid = true) {
  let c = KIND.get(p.kind)?.weight ?? 1;
  const cond = p.conditions || {};
  // Priced on the range it can actually be run at: dodging a side reaction can
  // mean running hotter than the game's stated minimum, and that is real work.
  const { lo, unavoidable } = operatingWindow(p, avoid);
  if (lo) c += Math.max(0, lo - 300) * w.perKelvin;
  c += w.sideEffect * unavoidable.length;
  if (cond.electrolysis) c += w.electrolysis;
  if (cond.requiresSpark) c += w.spark;
  if (cond.probability > 1) c += w.slowness * Math.log10(cond.probability);
  if (cond.places) c += w.byHand;
  if (p.inPlace) c += w.inPlace;
  c += w.catalyst * (cond.catalysts?.length || 0);
  return c;
}

/**
 * A set of chances, as small whole numbers that still sum to one.
 *
 * Lepidolite's three decompositions take 33.99%, 32.68% and 33.33% of the ore.
 * Carried around exactly those denominators multiply through the whole plan and
 * come out as "scaled x132600 to make it whole", which tells nobody anything.
 * One in three each is what is meant, is within a percentage point, and is a
 * number a person can hold -- and the split is a per-tick sampling anyway, so
 * these were always averages.
 */
export function shareRatio(chances) {
  for (let d = chances.length; d <= 24; d++) {
    const k = chances.map((c) => Math.round(c * d));
    if (k.some((x) => x < 1)) continue;
    if (k.reduce((a, b) => a + b, 0) !== d) continue;
    if (k.every((x, i) => Math.abs(x / d - chances[i]) <= 0.03)) return { k, d, rounded: false };
  }
  const k = chances.map((c) => Math.max(1, Math.round(c * 100)));
  const sum = k.reduce((a, b) => a + b, 0);
  k[k.indexOf(Math.max(...k))] += 100 - sum;
  return { k, d: 100, rounded: true };
}

/** Reactions that can never fire: an ungated rival ahead of them takes everything. */
const NEVER = 1e-6;

/**
 * The set of reactions sharing this one's chamber and feed, as whole-number
 * shares -- or null where it has the feed to itself.
 */
export function competitionOf(p, avoid = true) {
  const members = operatingWindow(p, avoid).competition;
  if (!members || members.length < 2) return null;
  const live = members.filter((m) => m.chance > NEVER);
  if (live.length < 2) return null;
  const { k, d, rounded } = shareRatio(live.map((m) => m.chance));
  return live.map((m, i) => ({ ...m, k: k[i], of: d, rounded }));
}

/* ------------------------------------------------------------------ spec */

/** Fill in a partial plan specification. Everything downstream reads this. */
export function normalizeSpec(spec = {}) {
  return {
    targets: (spec.targets || []).map((t) =>
      (typeof t === 'string' ? { name: t, amount: 1 } : { amount: 1, ...t })),
    have: new Set(spec.have || []),
    /** material -> process id, or 'have' to stop there. */
    pins: new Map(Object.entries(spec.pins || {})),
    /** processes the reader added going forwards, from what they have. */
    include: new Set(spec.include || []),
    excludeProcesses: new Set(spec.excludeProcesses || []),
    excludeMaterials: new Set(spec.excludeMaterials || []),
    kinds: new Set(spec.kinds || DEFAULT_KINDS),
    /** byproducts the reader has agreed to plumb back in. */
    credit: new Set(spec.credit || []),
    /** minimum run counts for processes added by hand. */
    runs: new Map(Object.entries(spec.runs || {})),
    /**
     * Narrow each step's temperature range to one that sets nothing else off.
     *
     * A chamber holds a reaction's inputs, outputs and catalyst together, and
     * those are the ingredients of other reactions. "Acetic Acid + Water =
     * Vinegar" is stated as ≥ 0 °C, but at 125 °C the water boils away, so the
     * range you can actually run it at is 0-124 °C.
     */
    avoidSideEffects: spec.avoidSideEffects !== false,
    /**
     * Nothing may be acquired: the only materials to start from are the ones
     * the reader says they have. This is the "what can I make with this"
     * question, where being told to go and fetch something is not an answer.
     */
    closed: !!spec.closed,
    weights: { ...DEFAULT_WEIGHTS, ...(spec.weights || {}) },
  };
}

/* ------------------------------------------------------------------ costs */

/**
 * Cheapest way to have each material, as a fixpoint.
 *
 * Input costs are added without regard to their coefficients: this is a measure
 * of how awkward a route is, not how much of it you need. Quantities come
 * later, once the route is settled, and multiplying them in here would make the
 * solver dodge any reaction that happens to be written in large numbers.
 *
 * The relaxation only ever lowers a cost, and every process costs something, so
 * a material can never be cheapest via a chain that runs through itself -- the
 * choices this leaves behind are acyclic by construction.
 */
export function solveCosts(graph, spec) {
  const { have, pins, kinds, excludeProcesses, excludeMaterials, weights } = spec;
  const wanted = new Set(spec.targets.map((t) => t.name));

  /**
   * Placing a thing is a player's act, and a plan only asks for one when the
   * reader is building something.
   *
   * No machine builds an Aluminum Wall; somebody puts it there. So a
   * `BuildsInto` never appears in a plan for a loose material -- that would
   * have a plan quietly instructing you to wall up your base to get at some
   * iron -- but a plan whose *end product* is a placed thing is already a
   * building job, and there placing is allowed throughout. It has to be:
   * `Clay Wall into Ceramic Wall` reacts one wall into another, so reaching a
   * Ceramic Wall that way means placing a Clay Wall first.
   *
   * This is narrower than "static things are player-made", which is not true:
   * water freezes into ice, and Ruby Crystal Growth grows a crystal out of two
   * molten metals. Those are automatic and stay. Placing also costs
   * `weights.byHand`, so wherever an automatic route exists it still wins.
   */
  const building = spec.targets.some((t) => placed(graph, t.name));
  const usable = (p) => (p.conditions.places
    ? building || p.produces.some((o) => wanted.has(o.name))
    : kinds.has(p.kind));

  /**
   * A reaction an ungated rival always beats to the feed never runs at all --
   * 18 of them -- so it is not a route to anything, whatever it says it makes.
   */
  const fires = (p) => {
    const members = operatingWindow(p, spec.avoidSideEffects).competition;
    return !members || (members.find((m) => m.id === p.id)?.chance ?? 1) > NEVER;
  };

  const allowed = graph.processes.filter((p) =>
    usable(p) && fires(p) &&
    !excludeProcesses.has(p.id) &&
    !p.consumes.some((i) => excludeMaterials.has(i.name)) &&
    !p.produces.some((o) => excludeMaterials.has(o.name)) &&
    !p.requires.some((r) => excludeMaterials.has(r.name)));

  /** What it costs to just have one, with no process involved. */
  const acquire = (name) => {
    if (have.has(name)) return 0;
    // Agreeing to plumb a byproduct back makes it free: the plan is already
    // making it, and routing through it is the whole point of saying so.
    // Without this, "feed it back" only cancelled demand for the same material
    // and could not do the one thing anybody wants it for -- taking the Steam
    // the furnace is throwing off and condensing it, rather than fetching snow.
    if (spec.credit.has(name)) return 0;
    if (excludeMaterials.has(name) || spec.closed) return Infinity;
    if (WORLDLY.has(graph.categoryOf(name))) return weights.acquireWorld;
    if (placed(graph, name)) return Infinity;
    // `acquireRaw` means the world hands it over. A thing the player builds is
    // never that, whichever form it is in: melting an Aluminum Wire back down
    // for its aluminium is only sensible if you already had the wire.
    return graph.isManufactured(name) || graph.producers(name).some((p) => kinds.has(p.kind))
      ? weights.acquire : weights.acquireRaw;
  };

  /**
   * `requires` is what a process needs standing by without spending it: a
   * plant that puts out a new segment and stays where it is, and the 17
   * reactions that hand a material straight back. Both are real materials the
   * plan has to have, so they are priced as such -- unlike a catalyst, which
   * is not a material dependency at all and never reaches this function.
   */
  const requireCost = (name) => cost.get(name) ?? Infinity;

  // `made` is the cheapest way to *produce* a material and `cost` is the
  // cheapest way to end up holding one, which is that or acquiring it. They are
  // kept apart because a target is never satisfied by acquiring it: asking for
  // Vinegar and being told to go and find Vinegar is not a plan.
  const cost = new Map();
  const made = new Map();
  const choice = new Map();
  for (const m of graph.db.materials) cost.set(m.name, acquire(m.name));
  // A pin is the reader overruling the search, so it is applied as a fact
  // before the relaxation rather than checked during it.
  for (const [name, target] of pins) if (target === 'have') cost.set(name, 0);

  const base = new Map(allowed.map((p) => [p.id, processCost(p, weights, spec.avoidSideEffects)]));

  for (let round = 0; round < 200; round++) {
    let changed = false;
    for (const p of allowed) {
      let c = base.get(p.id);
      for (const { name } of p.consumes) c += cost.get(name) ?? Infinity;
      for (const { name } of p.requires) c += requireCost(name);
      if (!Number.isFinite(c)) continue;
      for (const { name } of p.produces) {
        // A pin narrows the field to one process; it must not stop the cost
        // being worked out. Left out of the relaxation entirely, a pinned
        // material kept the price of merely acquiring one -- so pinning how to
        // make Carbon made Carbon look expensive, and the plan went off to melt
        // down aluminium wire instead of smelting the ore.
        const chosen = pins.get(name);
        if (chosen && chosen !== p.id) continue;
        if ((made.get(name) ?? Infinity) <= c) continue;
        made.set(name, c);
        choice.set(name, p.id);
        if (c < (cost.get(name) ?? Infinity)) cost.set(name, c);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Honour the pins that name a process, whatever the search preferred. The
  // relaxation above already priced them; this only settles the choice for a
  // pin whose process could not be costed at all, so extraction still follows
  // it and reports what that leaves unresolved.
  for (const [name, target] of pins) {
    if (target === 'have') { choice.delete(name); made.delete(name); continue; }
    if (!graph.byId.has(target)) continue;
    choice.set(name, target);
    if (!made.has(name)) made.set(name, weights.acquire);
  }

  return { cost, made, choice, acquire, allowed };
}

/* --------------------------------------------------------------- extract */

/**
 * Walk the winning choices back from the targets into a DAG.
 *
 * A material is a node once however many things need it, so the plan shows
 * sharing rather than repeating a subtree. A material is a *leaf* when the
 * reader has it, when acquiring it beats making it, or when nothing allowed can
 * make it -- and every leaf that is not already in hand is the frontier, the
 * list of things this plan still needs somebody to go and get.
 *
 * Following `choice` cannot loop, but a pin can point at a process that needs
 * the very material it makes. That is caught here and broken by demoting the
 * material to a leaf, which is reported rather than silently patched.
 */
export function extract(graph, spec, solved) {
  const { made, choice, acquire } = solved;
  const wanted = new Set(spec.targets.map((t) => t.name));
  const broken = new Set();
  // Reported across attempts, not just the last one: by the time extraction
  // succeeds, the loop it tripped over has been broken and is invisible.
  const cycles = [];

  for (let attempt = 0; ; attempt++) {
    const materials = new Map();
    const processes = new Map();
    /** Rival process id -> the chosen process whose chamber it shares. */
    const forced = new Map();
    /** Chosen process id -> every reaction sharing its feed, with shares. */
    const groups = new Map();
    let looped = false;

    const producerFor = (name) => {
      if (broken.has(name)) return null;
      const pin = spec.pins.get(name);
      if (pin === 'have') return null;
      if (pin) return graph.byId.get(pin) || null;
      if (spec.have.has(name) || spec.credit.has(name)) return null;
      const id = choice.get(name);
      if (!id) return null;
      // Making it has to actually beat having it, or every plan drags a whole
      // chemistry set behind materials the reader could simply pick up. A
      // target is exempt: it is the thing being asked for.
      if (wanted.has(name)) return graph.byId.get(id);
      return (made.get(name) ?? Infinity) < acquire(name) ? graph.byId.get(id) : null;
    };

    const visitMaterial = (name, stack) => {
      if (stack.has(name)) { cycles.push(name); broken.add(name); looped = true; return; }
      if (materials.has(name)) return;
      const node = { name, producer: null, reason: 'acquire', consumers: [], byproductOf: [] };
      materials.set(name, node);
      if (spec.have.has(name) || spec.pins.get(name) === 'have') { node.reason = 'have'; return; }
      if (spec.credit.has(name)) { node.reason = 'credited'; return; }
      const p = producerFor(name);
      if (!p) { node.reason = graph.producers(name).length ? 'acquire' : 'raw'; return; }
      node.reason = 'produced';
      node.producer = p.id;
      visitProcess(p, new Set(stack).add(name));
    };

    const visitProcess = (p, stack, leader = null) => {
      if (processes.has(p.id)) return;
      processes.set(p.id, p);
      if (leader) forced.set(p.id, leader);
      for (const { name } of p.consumes) visitMaterial(name, stack);
      for (const { name } of p.requires) visitMaterial(name, stack);
      for (const { name } of p.produces) {
        if (!materials.has(name)) {
          // A byproduct: it exists in the plan but nothing chose to make it.
          materials.set(name, { name, producer: null, reason: 'byproduct',
                                consumers: [], byproductOf: [] });
        }
      }
      // Whatever else is running on the same feed comes too. It is not a
      // choice: the tile tries them in turn and one of them wins each tick,
      // so two thirds of the Lepidolite fed in leaves as the other two
      // decompositions' products whether the plan mentions them or not.
      if (leader) return;
      const rivals = competitionOf(p, spec.avoidSideEffects);
      if (!rivals) return;
      groups.set(p.id, rivals);
      for (const m of rivals) {
        const q = graph.byId.get(m.id);
        if (q && q !== p) visitProcess(q, stack, p.id);
      }
    };

    for (const t of spec.targets) visitMaterial(t.name, new Set());
    for (const id of spec.include) {
      const p = graph.byId.get(id);
      if (p) visitProcess(p, new Set());
    }

    if (looped && attempt < 20) continue;

    // Cross-link, now that every node exists.
    for (const p of processes.values()) {
      for (const { name } of [...p.consumes, ...p.requires]) materials.get(name)?.consumers.push(p.id);
      for (const { name } of p.produces) {
        const node = materials.get(name);
        if (node && node.producer !== p.id) node.byproductOf.push(p.id);
      }
    }

    return { materials, processes, cycles, forced, groups };
  }
}

/* --------------------------------------------------------------- ordering */

/**
 * Topological order over the plan: inputs, then the process, then its outputs.
 *
 * Only the edges the amounts pass follows are used -- a material's chosen
 * producer, and the inputs each process eats. Byproduct edges are deliberately
 * left out: crediting a byproduct back into the chain that produced it is a
 * genuine circularity, and it is handled by iterating rather than by ordering.
 */
export function topoOrder(dag) {
  const succ = new Map();
  const indeg = new Map();
  const nodes = [...[...dag.materials.keys()].map((n) => `m:${n}`), ...dag.processes.keys()];
  for (const id of nodes) { succ.set(id, []); indeg.set(id, 0); }
  const edge = (a, b) => { succ.get(a).push(b); indeg.set(b, indeg.get(b) + 1); };

  for (const p of dag.processes.values()) {
    for (const { name } of [...p.consumes, ...p.requires]) {
      if (dag.materials.has(name)) edge(`m:${name}`, p.id);
    }
  }
  for (const m of dag.materials.values()) {
    if (m.producer && dag.processes.has(m.producer)) edge(m.producer, `m:${m.name}`);
  }
  // A rival runs as often as the reaction it shares a chamber with, so it has
  // to be settled at the same moment -- which means after it, in this order.
  for (const [rival, leader] of dag.forced) {
    if (dag.processes.has(leader)) edge(leader, rival);
  }

  const queue = nodes.filter((id) => !indeg.get(id));
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of succ.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (!indeg.get(next)) queue.push(next);
    }
  }
  const placed = new Set(order);
  // Anything left has an edge into it that never cleared: a loop the reader's
  // pins built. Ordering the rest is still useful, so they are reported, not
  // thrown, and appended so the amounts pass still sees them.
  const stuck = nodes.filter((id) => !placed.has(id));
  return { order: [...order, ...stuck], stuck };
}

/* ---------------------------------------------------------------- amounts */

/**
 * How many times each process runs, and how much of each material moves.
 *
 * One pass from the targets backwards: by the time the walk reaches a process,
 * everything downstream of it has already said how much it wants, so the run
 * count is simply the largest demand any of its outputs makes divided by how
 * many that run yields.
 *
 * Byproduct credit is the exception. Letting a spare output cover demand
 * elsewhere is circular whenever that demand is upstream of the process making
 * it, so the whole pass is repeated with the previous round's surplus fed in,
 * and stops when the run counts settle. `converged: false` says they did not,
 * which is a real answer -- some loops have no fixed batch size.
 */
export function amounts(dag, spec, order) {
  const useCredit = spec.credit.size > 0;
  let credit = new Map();
  let runs = new Map(), demand = new Map(), supply = new Map();
  let converged = true;

  for (let round = 0; round < (useCredit ? 12 : 1); round++) {
    runs = new Map();
    demand = new Map();
    supply = new Map();

    for (const t of spec.targets) {
      demand.set(t.name, radd(demand.get(t.name) || R0, rat(t.amount)));
    }

    /** Book one process's consumption and production at `n` runs. */
    const book = (p, n) => {
      runs.set(p.id, n);
      if (rzero(n)) return;
      for (const { name, count } of p.consumes) {
        demand.set(name, radd(demand.get(name) || R0, rmul(n, rat(count))));
      }
      // Apparatus is needed once, however long the process runs.
      for (const { name, count } of p.requires) {
        demand.set(name, rmax(demand.get(name) || R0, rat(count)));
      }
      for (const { name, count } of p.produces) {
        supply.set(name, radd(supply.get(name) || R0, rmul(n, rat(count))));
      }
    };

    for (const id of [...order].reverse()) {
      if (id.startsWith('m:')) continue;
      const p = dag.processes.get(id);
      if (!p) continue;
      // A rival's run count comes from the reaction it shares a chamber with,
      // never from demand: nobody asked for it, it just happens.
      if (dag.forced.has(id)) continue;

      // What this process still has to cover, after any credited surplus.
      let need = R0;
      for (const { name, count } of p.produces) {
        const want = rsub(demand.get(name) || R0, credit.get(name) || R0);
        if (rcmp(want, R0) <= 0) continue;
        need = rmax(need, rdiv(want, rat(count)));
      }
      const floor = spec.include.has(p.id) ? rat(spec.runs.get(p.id) ?? 1) : R0;
      const n = rmax(need, floor);
      book(p, n);

      // Then everything sharing its feed, in proportion: one in three of the
      // ore going in comes out of each of Lepidolite's three decompositions.
      const group = dag.groups.get(p.id);
      if (!group) continue;
      const mine = group.find((m) => m.id === p.id);
      for (const m of group) {
        if (m.id === p.id) continue;
        const rival = dag.processes.get(m.id);
        if (rival) book(rival, rmul(n, rat(m.k, BigInt(mine.k))));
      }
    }

    if (!useCredit) break;
    const next = new Map();
    for (const name of spec.credit) {
      const node = dag.materials.get(name);
      if (!node) continue;
      // Only surplus from processes that are not this material's own producer
      // can offset its demand; its producer's output is the demand being met.
      let spare = R0;
      for (const id of node.byproductOf) {
        const p = dag.processes.get(id);
        const n = runs.get(id) || R0;
        for (const { name: o, count } of p.produces) {
          if (o === name) spare = radd(spare, rmul(n, rat(count)));
        }
      }
      next.set(name, spare);
    }
    const same = next.size === credit.size &&
                 [...next].every(([k, v]) => credit.has(k) && rcmp(credit.get(k), v) === 0);
    credit = next;
    if (same) break;
    converged = round < 11;
  }

  return { runs, demand, supply, credit, converged };
}

/** The smallest whole-number batch: clear every denominator at once. */
export function batchScale(runs) {
  let l = 1n;
  for (const r of runs.values()) if (!rzero(r)) l = lcm(l, r.d);
  return rat(l);
}

/* ------------------------------------------------------------------- plan */

/**
 * Everything the views need, as data.
 *
 * `frontier` is the reader's shopping list and `byproducts` is what the plan
 * leaves lying around; between them they are most of what there is to decide.
 * `apparatus` is the answer to "what do I have to build before any of this
 * works", gathered from conditions that are otherwise scattered over every
 * process in the plan.
 */
export function solvePlan(graph, rawSpec) {
  const spec = normalizeSpec(rawSpec);
  const solved = solveCosts(graph, spec);
  const dag = extract(graph, spec, solved);
  const { order, stuck } = topoOrder(dag);
  const scaled = amounts(dag, spec, order);
  const scale = batchScale(scaled.runs);

  const at = (map, name) => rmul(map.get(name) || R0, scale);
  const targets = new Set(spec.targets.map((t) => t.name));

  const frontier = [];
  const byproducts = [];
  for (const node of dag.materials.values()) {
    const need = at(scaled.demand, node.name);
    const made = at(scaled.supply, node.name);
    // What the plan cannot cover itself. For most leaves that is all of it;
    // for one being fed back it is only what its own byproduct falls short by.
    const shortfall = rsub(need, made);
    if (['acquire', 'raw', 'credited'].includes(node.reason)) {
      if (rcmp(shortfall, R0) > 0) {
        frontier.push({
          name: node.name,
          amount: shortfall,
          credited: node.reason === 'credited',
          raw: node.reason === 'raw',
          // How the world hands this over, for the kinds the plan will not use.
          routes: graph.producers(node.name)
            .filter((p) => !spec.kinds.has(p.kind))
            .map((p) => ({ id: p.id, kind: p.kind, label: p.label })),
          alternatives: graph.producers(node.name).filter((p) => spec.kinds.has(p.kind)).length,
        });
      }
    }
    const spare = rsub(made, need);
    if (rcmp(spare, R0) > 0 && !targets.has(node.name)) {
      byproducts.push({ name: node.name, amount: spare,
                        from: node.producer ? [node.producer, ...node.byproductOf]
                                            : node.byproductOf,
                        credited: spec.credit.has(node.name) });
    }
  }
  frontier.sort((a, b) => a.name.localeCompare(b.name));
  byproducts.sort((a, b) => a.name.localeCompare(b.name));

  const steps = [...dag.processes.values()]
    .filter((p) => !rzero(scaled.runs.get(p.id) || R0))
    .map((p) => {
      // What share of its chamber's feed this one takes, when it is sharing.
      const leader = dag.forced.get(p.id) ?? p.id;
      const share = (dag.groups.get(leader) || []).find((m) => m.id === p.id) || null;
      return {
        process: p,
        runs: rmul(scaled.runs.get(p.id), scale),
        window: operatingWindow(p, spec.avoidSideEffects),
        /** Set when other reactions are running on the same feed. */
        share,
        sharesWith: dag.forced.has(p.id) ? dag.processes.get(leader) : null,
      };
    });
  // Presentation order is the order you would actually do them in.
  const rank = new Map(order.map((id, i) => [id, i]));
  steps.sort((a, b) => (rank.get(a.process.id) ?? 0) - (rank.get(b.process.id) ?? 0));

  // Described from the steps, in the order they are done, so that attributing
  // an extreme to a step is stable rather than a side effect of how the graph
  // happened to be walked.
  const apparatus = { /**
                       * The most demanding step in each direction -- and they
                       * are rarely the same step. A plan that smelts iron and
                       * ferments beer needs a furnace *and* a cold room, not
                       * one chamber somehow at both temperatures.
                       */
                      hottestFloor: 0, lowestCeiling: null,
                      hottestStep: null, coolestStep: null,
                      /** How many steps sit at that extreme: naming one of six is a lie. */
                      hottestShared: 0, coolestShared: 0,
                      /** 'always' | 'sometimes' | 'none' -- how much kit that implies. */
                      heating: 'none', cooling: 'none',
                      electrolysis: false, spark: false, byHand: false,
                      catalysts: new Map(), kinds: new Set(), slowest: null,
                      /** A range was cut down to dodge something, or could not be. */
                      narrowedBySideEffects: false, sideEffects: false,
                      /** Some step's yield is an average over a random draw. */
                      stochastic: false };
  for (const { process: p, window: w } of steps) {
    apparatus.kinds.add(p.kind);
    const c = p.conditions || {};
    if (w.lo > apparatus.hottestFloor) {
      apparatus.hottestFloor = w.lo;
      apparatus.hottestStep = p;
      apparatus.hottestShared = 1;
    } else if (w.lo && w.lo === apparatus.hottestFloor) {
      apparatus.hottestShared++;
    }
    if (Number.isFinite(w.hi)) {
      if (w.hi < (apparatus.lowestCeiling ?? Infinity)) {
        apparatus.lowestCeiling = w.hi;
        apparatus.coolestStep = p;
        apparatus.coolestShared = 1;
      } else if (w.hi === apparatus.lowestCeiling) {
        apparatus.coolestShared++;
      }
    }
    if (c.electrolysis) apparatus.electrolysis = true;
    if (c.requiresSpark) apparatus.spark = true;
    if (c.places) apparatus.byHand = true;
    for (const { name, count } of c.catalysts || []) {
      apparatus.catalysts.set(name, Math.max(apparatus.catalysts.get(name) || 0, count));
    }
    if (w.narrowed) apparatus.narrowedBySideEffects = true;
    if (w.unavoidable.length) apparatus.sideEffects = true;
    if (c.stochastic) apparatus.stochastic = true;
    if (c.probability > (apparatus.slowest?.conditions?.probability ?? 0)) apparatus.slowest = p;
  }
  apparatus.heating = heatingNeed(apparatus.hottestFloor || null);
  apparatus.cooling = coolingNeed(apparatus.lowestCeiling);

  return {
    spec, graph, dag, order, stuck,
    cost: solved.cost,
    choice: solved.choice,
    scale,
    runs: scaled.runs,
    demand: scaled.demand,
    supply: scaled.supply,
    converged: scaled.converged,
    cycles: dag.cycles,
    steps,
    /**
     * Every side reaction the plan dodges, and every one it cannot.
     *
     * `inPlan` marks the ones the reader actually wants -- somewhere else.
     * Making Wine at 0 °C cannot help also turning it into Vinegar, which is
     * a problem in this chamber and the whole point in the next one.
     */
    sideEffects: steps.flatMap(({ process, window }) => [
      ...window.avoided.map((e) => ({ ...e, step: process.id, avoided: true,
                                      inPlan: dag.processes.has(e.id) })),
      ...window.unavoidable.map((e) => ({ ...e, step: process.id, avoided: false,
                                          inPlan: dag.processes.has(e.id) })),
    ]),
    frontier,
    byproducts,
    apparatus,
    unreachable: spec.targets.filter((t) => {
      const node = dag.materials.get(t.name);
      return !node || (node.reason !== 'produced' && node.reason !== 'have');
    }).map((t) => t.name),
    /** Amounts, already scaled to the whole-number batch. */
    amountOf: (name) => at(scaled.demand, name),
    madeOf: (name) => at(scaled.supply, name),
    runsOf: (id) => rmul(scaled.runs.get(id) || R0, scale),
  };
}

/**
 * Every way the plan could make a material, best first.
 *
 * The frontier's routes were only ever offered for things left to fetch, which
 * is the wrong half: the material you most want to redirect is one the plan has
 * already decided how to make. Steam has 108 producers and Carbon 20, so the
 * list has to say enough to choose by -- what each one costs, what it would
 * need, and how much of that is already to hand.
 */
export function routesFor(plan, name) {
  const { graph, spec, cost } = plan;
  const inPlan = plan.dag.materials;
  const chosen = plan.dag.materials.get(name)?.producer;

  const routes = graph.producers(name)
    .filter((p) => spec.kinds.has(p.kind) || p.id === chosen)
    .map((p) => {
      const inputs = [...p.consumes, ...p.requires].map((i) => ({
        ...i,
        have: spec.have.has(i.name),
        inPlan: inPlan.has(i.name),
      }));
      let c = processCost(p, spec.weights, spec.avoidSideEffects);
      for (const i of inputs) c += cost.get(i.name) ?? Infinity;
      return {
        process: p,
        cost: c,
        inputs,
        chosen: p.id === chosen,
        banned: spec.excludeProcesses.has(p.id),
        /** How much of what it needs you would not have to go on and plan. */
        ready: inputs.filter((i) => i.have || i.inPlan).length,
      };
    });

  routes.sort((a, b) => Number(a.banned) - Number(b.banned) ||
                        a.cost - b.cost ||
                        a.process.label.localeCompare(b.process.label));
  return routes;
}

/**
 * What could be done with the materials in hand, best first.
 *
 * The other half of `routesFor`. Naming one thing you have is not a plan and
 * should not be answered with an empty table -- it is a question, and the
 * answer is the list of processes that would take it.
 *
 * Ranked by how much of each one you could already supply, because a reaction
 * needing three things you have not got is not really an option yet.
 */
export function usesFor(plan, available) {
  const has = new Set(available);
  const seen = new Set();
  const uses = [];
  for (const name of has) {
    for (const p of plan.graph.consumers(name)) {
      if (seen.has(p.id) || !plan.spec.kinds.has(p.kind)) continue;
      if (plan.spec.excludeProcesses.has(p.id)) continue;
      seen.add(p.id);
      const inputs = [...p.consumes, ...p.requires].map((i) => ({ ...i, have: has.has(i.name) }));
      uses.push({
        process: p,
        inputs,
        ready: inputs.every((i) => i.have),
        missing: inputs.filter((i) => !i.have).length,
        cost: processCost(p, plan.spec.weights, plan.spec.avoidSideEffects),
        included: plan.spec.include.has(p.id),
      });
    }
  }
  uses.sort((a, b) => a.missing - b.missing || a.cost - b.cost ||
                      a.process.label.localeCompare(b.process.label));
  return uses;
}

/**
 * Everything the reader could make from what they have, cheapest first.
 *
 * This is the other way into a plan: rather than naming an output and working
 * back, name the inputs and see where they lead. It is the same fixpoint --
 * only the question asked of it differs.
 */
export function reachableFrom(graph, rawSpec) {
  // Closed world: fetching something is not an answer to "what can I make from
  // this". Every route has to start at what the reader actually has.
  const spec = normalizeSpec({ ...rawSpec, closed: true });
  const { made, choice } = solveCosts(graph, spec);
  const out = [];
  for (const [name, c] of made) {
    if (!Number.isFinite(c) || spec.have.has(name)) continue;
    out.push({ name, cost: c, via: choice.get(name) });
  }
  out.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  return out;
}
