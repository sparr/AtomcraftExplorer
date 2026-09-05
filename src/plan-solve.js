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
export const rmin = (a, b) => (rcmp(a, b) <= 0 ? a : b);
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
  /**
   * Per decade of the probability divisor, above `brisk`.
   *
   * The divisor is a per-tick gate, and the two populations are far apart:
   * reactions carry 4 to 10000, phase changes 2e6 to 6.4e7. A one-in-a-hundred
   * gate is a rate, not an obstacle -- charging for it had the planner send you
   * out for a mushroom to evaporate rather than use the carbon monoxide you
   * already had. A one-in-two-million gate really is a wait.
   */
  slowness: 0.5,
  brisk: 100,
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
  if (cond.probability > w.brisk) {
    c += w.slowness * (Math.log10(cond.probability) - Math.log10(w.brisk));
  }
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
 * How many ways of getting through the reader's stock are worth solving for.
 *
 * Carbon has three that touch carbon dioxide and 153 in all, so this is a
 * bound on the work rather than on the answer -- but a target with a dozen
 * would otherwise cost a dozen full solves to choose between.
 */
const STOCK_ROUTES = 4;

/** And how many ways of making a shopping-list item out of the leavings. */
const SPARE_ROUTES = 6;

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
    /**
     * Held materials you can get as much of as the plan turns out to need.
     *
     * Nothing to the solver, which stops at anything held either way. It is
     * `balanceTargets` that cares: a limited stock is what the amounts are
     * balanced against, and something you can go on making is no constraint.
     */
    plenty: new Set(spec.plenty || []),
    /** material -> process id, or 'have' to stop there. */
    pins: new Map(Object.entries(spec.pins || {})),
    /** processes the reader added going forwards, from what they have. */
    include: new Set(spec.include || []),
    /**
     * Routes run on what the plan is already throwing away, and no further.
     *
     * The other reading of a pin. "Make Carbon by the Boudouard equilibrium"
     * taken as the whole answer wants eighteen Carbon Monoxide, and the plan
     * goes off to gasify ninety Wood for them -- to feed a reaction whose
     * entire appeal was the eight Carbon Monoxide already going spare. Taken
     * this way it runs four times on what is there and the material's usual
     * producer makes up the difference.
     *
     * Not written to the URL: `solvePlan` works out which reading of a pin is
     * the better one, so the question the reader asked is still just the pin.
     */
    alsoUse: new Set(spec.alsoUse || []),
    excludeProcesses: new Set(spec.excludeProcesses || []),
    excludeMaterials: new Set(spec.excludeMaterials || []),
    kinds: new Set(spec.kinds || DEFAULT_KINDS),
    /** Spare output counted as a product rather than waste. Changes nothing
     *  about what is made -- it is a reading of the same surplus. */
    kept: new Set(spec.kept || []),
    /** byproducts the reader has agreed to plumb back in, one by one. */
    credit: new Set(spec.credit || []),
    /**
     * ...or all of them, with these left out. On by default: a plan that
     * throws off steam and then fetches snow to make water is not a plan
     * anybody wanted, and saying so for each byproduct in turn is work the
     * solver can do itself.
     */
    feedBackAll: spec.feedBackAll !== false,
    noFeedBack: new Set(spec.noFeedBack || []),
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
    // The weather delivers a few materials for nothing. Nothing in the
    // material list says so, and without it the planner could not tell that
    // water is collectable: it inferred "raw" from having no recipe, so it
    // understood Falling Snow, which nothing makes, and thought water -- with
    // 77 ways to make it -- had to be manufactured. It is the same storm.
    if (graph.fallsFromSky(name)) return weights.acquireWorld;
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
      // chemistry set behind materials the reader could simply pick up.
      //
      // A target is normally exempt -- asking for Vinegar and being told to go
      // and find Vinegar is not a plan -- but not when the world simply hands
      // the stuff over. Asking for water when it rains is answered by going
      // outside, and the rule without this had the planner fetch snow and melt
      // it instead.
      if (wanted.has(name)) {
        return graph.fallsFromSky(name) || WORLDLY.has(graph.categoryOf(name))
          ? null : graph.byId.get(id);
      }
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

    /**
     * Then the routes running on the leavings, which are not visited.
     *
     * Walking into their inputs is exactly what this is meant to avoid: asking
     * how the eight spare Carbon Monoxide would be *made* is what fetches the
     * ninety Wood. They take what is over and no more, so their inputs enter
     * the plan as leaves and `amounts` sizes the run from what is actually
     * there -- nothing, if it comes to that, and then the step drops out.
     */
    const extra = new Set();
    for (const id of spec.alsoUse) {
      const p = graph.byId.get(id);
      if (!p || processes.has(id)) continue;
      processes.set(p.id, p);
      extra.add(p.id);
      for (const { name } of [...p.consumes, ...p.requires, ...p.produces]) {
        if (materials.has(name)) continue;
        materials.set(name, { name, producer: null, reason: 'byproduct',
                              consumers: [], byproductOf: [] });
      }
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

    return { materials, processes, cycles, forced, groups, extra };
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
  // A route running on the leavings comes after whatever leaves them, or it is
  // printed before the steps whose spare output it lives on. It is only ever a
  // *target* of an edge -- nothing names it as a producer -- so this can add
  // no cycle.
  for (const id of dag.extra) {
    for (const { name } of dag.processes.get(id).consumes) {
      const node = dag.materials.get(name);
      for (const from of node ? [node.producer, ...node.byproductOf] : []) {
        if (from && from !== id && dag.processes.has(from)) edge(from, id);
      }
    }
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
  const extra = [...dag.extra].map((id) => dag.processes.get(id)).filter(Boolean);
  // A surplus route hands its output back to the plan, which is a credit like
  // any other -- so the same fixpoint settles both.
  const useCredit = spec.credit.size > 0 || extra.length > 0;
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
      // A surplus route is sized by what is left over, which is not known
      // until everything else has said what it takes. It is booked below.
      if (dag.extra.has(id)) continue;

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

    /**
     * Then the routes running on the leavings, on what is actually left.
     *
     * Two bounds, and the smaller wins: how many runs the spare inputs will
     * feed, and how many the plan has a use for. Eight spare Carbon Monoxide
     * feed four runs of the Boudouard equilibrium, the plan wants nine Carbon,
     * so it runs four times and five still come from somewhere else. Where
     * nothing is spare the first bound is zero and the step is not in the plan
     * at all.
     */
    const handedBack = new Map();
    for (const p of extra) {
      const left = (name) => rsub(supply.get(name) || R0, demand.get(name) || R0);
      let cap = null;
      for (const { name, count } of p.consumes) {
        const over = left(name);
        const runsOn = rcmp(over, R0) > 0 ? rdiv(over, rat(count)) : R0;
        cap = cap === null ? runsOn : rmin(cap, runsOn);
      }
      // Apparatus is not spent, but it still has to be there and spare.
      for (const { name, count } of p.requires) {
        if (rcmp(left(name), rat(count)) < 0) cap = R0;
      }
      let want = R0;
      for (const { name, count } of p.produces) {
        want = rmax(want, rdiv(demand.get(name) || R0, rat(count)));
      }
      const n = cap === null ? want : rmin(cap, want);
      book(p, n);
      if (rzero(n)) continue;
      for (const { name, count } of p.produces) {
        handedBack.set(name, radd(handedBack.get(name) || R0, rmul(n, rat(count))));
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
    // What a surplus route hands over is a credit too -- it is the whole
    // reason it is here. A name the reader credited outright is left alone:
    // the sum above already counted this run among its producers.
    for (const [name, amount] of handedBack) {
      if (!spec.credit.has(name)) next.set(name, amount);
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
 * Which of two plans is the better one to be handed.
 *
 * Being told to fetch something the plan could have made is the worst outcome
 * -- "go and find some Molten Beryllium" is a shrug, not a plan -- so those
 * count first, then the shopping list, then the length of it, then how much
 * has to be laid in to start.
 *
 * Counting only the length of the shopping list gets this backwards: a plan
 * that gives up entirely has a very short one.
 */
const score = (p) => [p.frontier.filter((f) => f.alternatives > 0).length,
                      p.frontier.length, p.steps.length, p.priming.length];
const better = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/**
 * The same, with what the plan throws away counted above its length.
 *
 * A byproduct is a standing obligation where a step is a one-off: something has
 * to carry the two Carbon Monoxide away for as long as the factory runs, and
 * one more step to not make any is a bargain.
 *
 * Not folded into `score`, which decides every comparison in this file, because
 * it was tried there and the cost was too specific to ignore. Over 260 targets
 * it moved three plans, took 364 units of waste out of them and cost one step
 * in total -- but among the three was the last plan in the whole data set that
 * still traded a step for a charge, and "Prime instead" is offered on the step
 * that trade buys. Boron Oxide stopped fetching seven Water to vent six Steam,
 * which is a better plan and left a real feature with nothing to attach to.
 *
 * So it is asked only where the choice is between ways of closing a shopping
 * list out of the leavings, which is where waste is what the reader is choosing
 * by. Anything this pass accepts has already had to be better by `score`.
 *
 * Kinds rather than amounts: how much comes off scales with the batch, and a
 * plan is not worse for being asked about in larger numbers.
 */
const scoreWaste = (p) => [p.frontier.filter((f) => f.alternatives > 0).length,
                           p.frontier.length,
                           p.byproducts.filter((b) => !b.kept).length,
                           p.steps.length, p.priming.length];

/**
 * Everything the views need, as data.
 *
 * `frontier` is the reader's shopping list and `byproducts` is what the plan
 * leaves lying around; between them they are most of what there is to decide.
 * `apparatus` is the answer to "what do I have to build before any of this
 * works", gathered from conditions that are otherwise scattered over every
 * process in the plan.
 */
/**
 * Solve, then feed back whatever it turns out to be throwing away, and solve
 * again until that settles.
 *
 * Which materials are spare cannot be known before the plan exists, and
 * knowing changes the plan -- so it is worked out by going round. Only genuine
 * byproducts are taken: a material with a chosen producer is being made on
 * purpose, and feeding it back would make it a leaf and delete the very step
 * that makes it.
 *
 * Rounds are capped, and a set of credits seen before means it is flipping
 * between two answers rather than settling, at which point the current one
 * will do. Anything credited that the final plan does not actually make is
 * dropped, so a route can never rest on a supply that talked itself out of
 * existence.
 */
export function solvePlan(graph, rawSpec) {
  let spec = normalizeSpec(rawSpec);
  const solve = (s) => {
    if (s.feedBackAll) return solveFedBack(graph, s);
    const only = solveOnce(graph, s);
    only.brokenLoops = [];
    return only;
  };

  let plan = solve(spec);

  /**
   * Stock the reader wants used, as against stock they are merely waving off.
   *
   * `have` says two things at once. Naming a material in the have box is
   * stating what you are sitting on, and the question that goes with it is
   * "what can I get out of this". Ticking "I have it" on a line of the
   * shopping list is the other thing entirely: stop here, I will sort that out
   * myself. `plenty` already tells the two apart for `balanceTargets`, and the
   * difference is every bit as real to the search.
   */
  const stock = new Set([...spec.have].filter((n) => !spec.plenty.has(n)));
  const eatsStock = (p) =>
    p.steps.some((s) => s.process.consumes.some((i) => stock.has(i.name)));

  /**
   * A plan that gets through the stock beats one that does not, at any price.
   *
   * Costing the stock at zero only ever said a route is not *charged* for
   * eating your carbon dioxide. It never said a route is worth anything for
   * doing so -- and against a spore that turns straight into Carbon for 1.56,
   * a reduction that has to make four Potassium first cannot win on price,
   * however much of your stock it would get through. So the stock sat
   * untouched and the plan answered a question nobody had asked.
   *
   * Asked here rather than as a discount in `solveCosts`, for three reasons.
   * There is no discount that would do: small enough to leave the rest of the
   * scale meaning anything and it never overturns the spore, large enough to
   * overturn the spore and every price below it collapses together. The cost
   * model is a fixpoint that stays acyclic by only ever lowering a price, and
   * a thumb on one side of it re-routed Carbon through the Carbon Monoxide it
   * had just made. And it is the wrong question to ask of a price: what makes
   * the Potassium route worth having is not that it is cheap -- it is dearer,
   * and stays dearer -- but that the Potassium Oxide it throws off comes back
   * round to make the Potassium again, so the plan asks for Water and a charge
   * laid in once rather than Lepidolite for ever. `solveCosts` cannot see that
   * and `score` can, because by then the loop has been found.
   *
   * So each route through the stock is tried as though it had been pinned, and
   * they are judged the way two plans are always judged here: by the shopping
   * list they leave. That is what picks the four Potassium over the two
   * Magnesium, which is cheaper by the cost model and sends you out for
   * Vanadinite besides.
   *
   * One route, over all the targets together, and only where the plan was not
   * going to touch the stock anyway. The reader said what they have and asked
   * what could be got out of it; they did not ask for a plan that reaches for
   * the same barrel wherever it possibly can.
   */
  if (stock.size && !eatsStock(plan)) {
    const chainCost = (p) => p.consumes.reduce(
      (c, i) => c + (plan.cost.get(i.name) ?? Infinity),
      processCost(p, spec.weights, spec.avoidSideEffects));

    let best = null;
    let bestScore = null;
    let bestCost = Infinity;
    let bestPins = null;

    for (const { name } of spec.targets) {
      // A pin is the reader saying it outright, and outranks a preference.
      if (spec.pins.has(name)) continue;
      const routes = graph.producers(name)
        .filter((p) => spec.kinds.has(p.kind) && !spec.excludeProcesses.has(p.id) &&
                       // Eating the stock counts; standing it by does not.
                       // `requires` hands the material straight back, and a
                       // plan that only borrows your carbon dioxide has not
                       // used any of it.
                       p.consumes.some((i) => stock.has(i.name)))
        .map((p) => ({ p, cost: chainCost(p) }))
        .filter((r) => Number.isFinite(r.cost))
        .sort((a, b) => a.cost - b.cost || a.p.label.localeCompare(b.p.label));

      // Solves are the cost here. The cheapest few by the ordinary measure are
      // where a workable plan is, and trying all 153 routes to Carbon to find
      // the three that touch the stock is not worth what it would take.
      for (const { p, cost: c } of routes.slice(0, STOCK_ROUTES)) {
        const pins = new Map(spec.pins).set(name, p.id);
        const trial = solve({ ...spec, pins });
        // It has to actually run, and it has to actually leave the target
        // made. A route the extraction had to break a loop around comes back
        // with the thing you asked for sitting on the shopping list, which is
        // not a plan for making it out of anything.
        if (rzero(trial.runsOf(p.id)) || !eatsStock(trial)) continue;
        if (trial.frontier.some((f) => f.name === name)) continue;
        const s = score(trial);
        if (best && !better(s, bestScore) && (better(bestScore, s) || c >= bestCost)) continue;
        best = trial; bestScore = s; bestCost = c; bestPins = pins;
      }
    }

    if (best) { spec = { ...spec, pins: bestPins }; plan = best; }
  }

  /**
   * Make the last of the shopping list out of what the plan is throwing away.
   *
   * The Carbon plan asked for two Water while venting two Hydrogen Gas and two
   * Oxygen Gas -- which is the water it was buying, in pieces. Hydrogen
   * Combustion puts them back together as Steam and Steam condenses, so the
   * whole list closes and the factory runs on carbon dioxide and a charge.
   *
   * Nothing in the search was ever going to find that. Water falls from the
   * sky, so `acquire` prices it at 0.5 and no way of making it out of your own
   * exhaust can beat that on cost -- `made` came to 3.0 and `producerFor` duly
   * ruled that having one beats making one. The price is not wrong, either:
   * water really is free, and a plan that manufactures it from scratch when it
   * is raining would be a worse plan. What is wrong is that the price cannot
   * see the shopping list, and the last item on a list is worth more than its
   * price -- it is the difference between a factory that runs and an errand.
   *
   * `score` already knows this. It counts the shopping list first and settles
   * ties on length, and it ranks the closed plan above the open one without
   * being asked. So this pass only has to make the candidate exist: for each
   * thing left to fetch, the ways of making it that the leavings would cover,
   * pinned so the price does not overrule them, with whatever converts the
   * leavings into their feed run on the leavings alone.
   *
   * Two steps out and no further. `alsoUse` is exactly the right shape for the
   * second one -- run this on the spare, and no more of it than the spare will
   * stretch to -- and it keeps the search from wandering off building a
   * chemistry set to use up an awkward byproduct.
   */
  for (let round = 0; round < 2 && plan.frontier.length; round++) {
    const spare = new Set(plan.byproducts.map((b) => b.name));
    if (!spare.size) break;

    const usable = (p) => spec.kinds.has(p.kind) && !spec.excludeProcesses.has(p.id) &&
      !p.conditions.places &&
      !p.consumes.some((i) => spec.excludeMaterials.has(i.name)) &&
      !p.produces.some((o) => spec.excludeMaterials.has(o.name)) &&
      !p.requires.some((r) => spec.excludeMaterials.has(r.name));

    /** Held or going spare: either way it is there for the taking. */
    const toHand = (name) => spare.has(name) || spec.have.has(name);

    // What one more step on the leavings alone would get you.
    const makes = new Map();
    for (const p of graph.processes) {
      if (!usable(p) || !p.consumes.length) continue;
      if (!p.consumes.every((i) => toHand(i.name))) continue;
      for (const { name } of p.produces) {
        if (!makes.has(name)) makes.set(name, []);
        makes.get(name).push(p.id);
      }
    }

    const tries = [];
    for (const f of plan.frontier) {
      if (spec.pins.has(f.name)) continue;
      for (const p of graph.producers(f.name)) {
        if (!usable(p) || !p.consumes.length) continue;
        // Every input has to be to hand already, or one step off something
        // that is. More than one input needing fetching of its own is not the
        // leavings covering the list, it is a plan for something else.
        const need = p.consumes.filter((i) => !toHand(i.name));
        if (need.some((i) => !makes.has(i.name))) continue;
        if (need.length > 1) continue;
        const options = need.length ? makes.get(need[0].name) : [null];
        for (const via of options) {
          tries.push({ name: f.name, id: p.id, via,
                       cost: processCost(p, spec.weights, spec.avoidSideEffects) });
        }
      }
    }
    // The plain ones first: a route needing nothing converted is a shorter
    // plan than one that does, and solves are what this costs.
    tries.sort((a, b) => (a.via ? 1 : 0) - (b.via ? 1 : 0) || a.cost - b.cost ||
                         a.id.localeCompare(b.id));

    let best = null;
    let bestScore = score(plan);
    let bestWaste = null;
    let bestSpec = null;
    for (const t of tries.slice(0, SPARE_ROUTES)) {
      const trial = { ...spec,
        pins: new Map(spec.pins).set(t.name, t.id),
        alsoUse: t.via ? new Set([...spec.alsoUse, t.via]) : spec.alsoUse };
      const got = solve(trial);
      // The converter has to actually run on the spare. Where it does not,
      // this is not the leavings covering the list at all -- it is the ordinary
      // search with a pin on it, and the pin was never the reader's.
      if (t.via && rzero(got.runsOf(t.via))) continue;
      if (rzero(got.runsOf(t.id))) continue;
      // Better than the plan we came in with, on the usual measure...
      if (!better(score(got), score(plan))) continue;
      // ...and then the least wasteful of the ones that are. Carbon can be had
      // in six steps leaving two Carbon Monoxide or in seven leaving nothing
      // but the oxygen the carbon dioxide came with, and the seven-step plan is
      // the one anybody would rather be handed.
      if (best && !better(scoreWaste(got), bestWaste)) continue;
      best = got; bestScore = score(got); bestWaste = scoreWaste(got); bestSpec = trial;
    }
    if (!best) break;
    spec = bestSpec;
    plan = best;
  }

  const sharedPins = new Map();

  /**
   * A pin that reads two ways.
   *
   * "Make Carbon by the Boudouard equilibrium" can mean make all of it that
   * way, or run it on the two-Carbon-Monoxide-per-Carbon the plan is already
   * throwing off. Taken the first way it wants eighteen Carbon Monoxide when
   * eight are going spare, and the plan goes off to gasify ninety Wood for the
   * rest -- to feed a reaction whose entire appeal was the spare. Taken the
   * second it makes four of the nine and the old route makes five.
   *
   * A pin cannot say which was meant, so both are worked out and the better
   * one kept. Where there is nothing spare to run on, the second reading makes
   * nothing and the pin stands exactly as written.
   */
  for (const [name, id] of spec.pins) {
    if (id === 'have' || spec.alsoUse.has(id)) continue;
    const p = graph.byId.get(id);
    // Nothing to share out: a route with no inputs, or one whose inputs the
    // plan does not leave any of, is the same question either way round.
    if (!p || !p.consumes.length) continue;
    if (!p.consumes.some((i) => rcmp(plan.otherSupplyOf(i.name), R0) > 0)) continue;

    const pins = new Map(spec.pins);
    pins.delete(name);
    const shared = { ...spec, pins, alsoUse: new Set([...spec.alsoUse, id]) };
    const trial = solve(shared);
    // It has to actually run. Otherwise this is not a second reading of the
    // pin at all, it is the pin thrown away.
    if (rzero(trial.runsOf(id))) continue;
    if (!better(score(trial), score(plan))) continue;
    spec = shared;
    plan = trial;
    sharedPins.set(name, id);
  }

  if (!spec.feedBackAll) { plan.sharedPins = sharedPins; return plan; }

  /**
   * A step is preferred to a charge.
   *
   * Taking a material off the loop means making it outright, which is a step
   * you run forever instead of a charge you lay in once -- and that is the way
   * round the reader wants it. So each remaining charge is tried: refuse to
   * feed that one material back, and see whether the loop it sits in goes
   * away. The Lithium plan makes its water from the steam it is already
   * throwing off, and needs only the chlorine laid in.
   *
   * Not every loop can be broken. Refusing the chlorine sends the planner back
   * to fetching Vanadinite for it, which is worse in every way, so a trial that
   * lengthens the shopping list is rejected and the charge stands. What the
   * reader credited by hand is never overruled.
   */
  const off = new Set(spec.noFeedBack);
  for (let round = 0; round < 3 && plan.priming.length; round++) {
    let better = null;
    for (const item of plan.priming) {
      if (off.has(item.name) || spec.credit.has(item.name)) continue;
      const trial = solveFedBack(graph, { ...spec, noFeedBack: new Set([...off, item.name]) });
      if (trial.priming.length >= plan.priming.length) continue;
      if (trial.frontier.length > plan.frontier.length) continue;
      better = { trial, name: item.name };
      break;
    }
    if (!better) break;
    off.add(better.name);
    plan = better.trial;
  }

  /**
   * Materials being made outright that the plan could take off its own loop
   * instead, at the price of a charge. The reverse of "Make it instead", and
   * the reader may want it either way round.
   */
  plan.brokenLoops = [...off].filter((n) => rcmp(plan.otherSupplyOf(n), R0) > 0);
  plan.sharedPins = sharedPins;
  return plan;
}

/** Solve, feeding back everything spare, going round until the set settles. */
function solveFedBack(graph, spec) {
  const key = (set) => [...set].sort().join('\u241f');
  const wanted = new Set(spec.targets.map((t) => t.name));

  /**
   * A byproduct that cannot cover what routing through it would demand.
   *
   * The cost model knows what a material costs, not how much of it there is,
   * so a free supply is an unlimited one as far as the search is concerned.
   * Offered every spare output at once it will happily plan around six Steam
   * when three are going spare -- Aqueous Aluminum Bromide went from six steps
   * to eighteen that way, chasing a supply that was never there. So each round
   * is checked, and anything that promised more than it delivers is not
   * offered again. What the reader credited by hand stands regardless: the
   * shortfall is then their business, and it is reported.
   */
  /** Solves are cheap but not free. */
  let budget = 16;
  const solve = (credit) => (budget-- > 0 ? solveOnce(graph, { ...spec, credit }) : null);
  const overdraws = (trial, credit) => [...credit].filter((n) => !spec.credit.has(n) &&
    rcmp(trial.madeOf(n), trial.amountOf(n)) < 0);

  let plan = solveOnce(graph, { ...spec, credit: new Set(spec.credit) });
  let best = plan;
  let bestScore = score(plan);
  const seen = new Set();
  /**
   * Materials that asked for more than they had. Not a verdict -- the plan
   * that over-committed them may still be the best one -- but a direction to
   * look in: without them the search reaches smaller credit sets it would
   * otherwise never try, and one of those may be better than anything on the
   * generous side of the fork.
   */
  const overdrawn = new Set();

  for (let round = 0; round < 8 && budget > 0; round++) {
    const credit = new Set(spec.credit);
    for (const node of plan.dag.materials.values()) {
      if (wanted.has(node.name) || spec.noFeedBack.has(node.name)) continue;
      if (overdrawn.has(node.name)) continue;
      // Something being made on purpose is normally left alone -- crediting it
      // would make it a leaf and delete the step that makes it. Unless the
      // rest of the plan already hands back as much as it uses, in which case
      // deleting that step is the point: chlorine used to make the acid comes
      // straight back out of the electrolysis downstream, and fetching
      // Vanadinite to make more of it is work for nothing.
      const own = node.reason === 'byproduct' || node.reason === 'credited';
      const covered = rcmp(plan.otherSupplyOf(node.name), plan.amountOf(node.name)) >= 0;
      if (!own && !(node.reason === 'produced' && covered)) continue;
      if (rcmp(plan.madeOf(node.name), R0) > 0) credit.add(node.name);
    }
    if (seen.has(key(credit))) break;
    seen.add(key(credit));

    const trial = solve(credit);
    if (!trial) break;
    if (better(score(trial), bestScore)) { best = trial; bestScore = score(trial); }

    /**
     * A free supply is an unlimited one as far as the cost model is concerned
     * -- it knows what a material costs, not how much of it there is -- so a
     * plan offered every spare output at once will route more through one of
     * them than exists. Three spare Steam, and it planned around seven.
     *
     * Which is not on its own a reason to refuse: the shortfall is reported,
     * and a plan that asks for four more Steam may still be a better one than
     * a plan that goes off after Falling Snow and Vanadinite instead. So the
     * version without them is worked out too, and the two are compared rather
     * than one being ruled out in advance.
     */
    const short = overdraws(trial, credit);
    if (short.length) {
      const trimmed = new Set([...credit].filter((n) => !short.includes(n)));
      const t = solve(trimmed);
      if (t && better(score(t), bestScore)) { best = t; bestScore = score(t); }
      for (const n of short) overdrawn.add(n);
    }
    plan = trial;
  }
  return best;
  return plan;
}

function solveOnce(graph, spec) {
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
    // 'byproduct' is in this list because a material can be seen coming out of
    // a step before anything is known to want it, and it keeps that label even
    // once something does. If more is wanted than comes out, that difference
    // has to be fetched like any other -- and until it was reported, a plan
    // four Steam short looked like a plan with nothing to fetch.
    if (['acquire', 'raw', 'credited', 'byproduct'].includes(node.reason)) {
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
                        credited: spec.credit.has(node.name),
                        kept: spec.kept.has(node.name) });
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

  // Then a chamber is kept together. Reactions sharing a feed are one piece of
  // apparatus doing three things, and the topological order has no reason to
  // put them next to each other -- it dropped the water-making between them.
  {
    const bySid = new Map(steps.map((x) => [x.process.id, x]));
    const shown = new Set();
    const together = [];
    for (const step of steps) {
      if (dag.forced.has(step.process.id)) continue;   // comes in beside its leader
      together.push(step);
      shown.add(step.process.id);
      for (const m of dag.groups.get(step.process.id) || []) {
        const rival = m.id !== step.process.id && bySid.get(m.id);
        if (rival) { together.push(rival); shown.add(m.id); }
      }
    }
    // A rival whose leader dropped out would otherwise vanish with it.
    for (const step of steps) if (!shown.has(step.process.id)) together.push(step);
    steps.length = 0;
    steps.push(...together);
  }

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

  /**
   * What has to be in the chamber before any of this can turn over.
   *
   * Not a walk down the listed order -- that reports a charge whenever a
   * producer happens to be printed after a consumer, whether or not anything
   * forced it to be. It is a question about whether *some* order works, so it
   * is answered by trying: run whatever can run, and only when nothing can does
   * something have to be laid in.
   *
   * Chlorine really does need priming. Nothing makes any until the lithium
   * electrolysis, which cannot happen until the acid, which needs the chlorine.
   * Hydrogen only looked like it did: the potassium hydroxide can be
   * electrolysed for it long before the acid is wanted.
   */
  const priming = [];
  {
    const unlimited = (name) => {
      const node = dag.materials.get(name);
      return !node || ['have', 'acquire', 'raw'].includes(node.reason);
    };
    const stock = new Map();
    const held = (name) => stock.get(name) || R0;
    const left = new Set(steps);
    const charge = new Map();

    const missing = (step) => {
      const short = [];
      for (const i of step.process.consumes) {
        if (unlimited(i.name)) continue;
        const want = rmul(step.runs, rat(i.count));
        if (rcmp(held(i.name), want) < 0) short.push([i.name, rsub(want, held(i.name))]);
      }
      // Apparatus has to be there, but is not spent.
      for (const r of step.process.requires) {
        if (unlimited(r.name)) continue;
        if (rcmp(held(r.name), rat(r.count)) < 0) {
          short.push([r.name, rsub(rat(r.count), held(r.name))]);
        }
      }
      return short;
    };

    const run = (step) => {
      for (const i of step.process.consumes) {
        if (unlimited(i.name)) continue;
        stock.set(i.name, rsub(held(i.name), rmul(step.runs, rat(i.count))));
      }
      for (const o of step.process.produces) {
        stock.set(o.name, radd(held(o.name), rmul(step.runs, rat(o.count))));
      }
      left.delete(step);
    };

    while (left.size) {
      const ready = [...left].find((step) => !missing(step).length);
      if (ready) { run(ready); continue; }
      // Nothing can run. Lay in whichever shortfall is cheapest to go and get:
      // being told to prime with water beats being told to prime with acid,
      // and the search already has an opinion about what things cost.
      //
      /**
       * But first: a charge has to be something you could actually turn up
       * with. A step still waiting its turn will make the thing when it runs,
       * so charging it is not a charge at all -- it is the ordering giving up
       * early, and it asks the reader for the one material this plan is the
       * only way to get.
       *
       * Tantalum and Niobium out of Columbite came back "prime with six
       * Heptafluorotantalic Acid and six Heptafluoroniobic Acid", which you
       * can have only by dissolving Columbite, which is the plan. The
       * dissolution was sitting in `left` the whole time, waiting on the
       * Hydrofluoric Acid that had to be laid in regardless; charging that
       * first lets it run and hand both acids over. So a shortfall something
       * still to come produces is taken only when there is nothing else left
       * to charge -- a genuine deadlock, where the loop really does need
       * seeding and the reader really does have to find some.
       */
      const pending = new Set();
      for (const step of left) {
        for (const o of step.process.produces) pending.add(o.name);
      }
      // Except that being on the shopping list settles it. You are already
      // going out for ninety Hydrofluoric Acid, so laying some of it in is not
      // a second errand -- and the loop here is a real one, every material in
      // it made by some step waiting on another, so something has to seed it.
      const fetched = new Set(frontier.map((f) => f.name));
      let best = null;
      for (const step of left) {
        const short = missing(step);
        // What it would really take to get one, not what the search charges
        // for it: a material being fed back costs nothing there, which is the
        // whole reason it is the one short of a charge.
        const price = short.reduce((a, [name, amount]) =>
          a + (solved.made.get(name) ?? solved.cost.get(name) ?? 100) * rnum(amount), 0);
        // Nothing still to come makes any of what this one is short of, so it
        // is a charge the reader can go and buy.
        const outside = short.every(([name]) => fetched.has(name) || !pending.has(name));
        if (!best || (outside !== best.outside ? outside : price < best.price)) {
          best = { step, short, price, outside };
        }
      }
      for (const [name, amount] of best.short) {
        charge.set(name, radd(charge.get(name) || R0, amount));
        stock.set(name, radd(held(name), amount));
      }
      run(best.step);
    }

    for (const [name, amount] of charge) {
      if (rcmp(amount, R0) > 0) priming.push({ name, amount });
    }
    priming.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    spec, graph, dag, order, stuck, priming,
    /** Filled in by the caller when a loop was broken to avoid a charge. */
    brokenLoops: [],
    /**
     * Pins the caller read as "run it on the leavings" rather than as the
     * whole answer: material -> process. Kept so the pane can undo the one
     * choice that put a surplus route in the plan.
     */
    sharedPins: new Map(),
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
    /**
     * What comes out of steps that are not this material's chosen producer.
     *
     * The measure of whether that producer is needed at all. Lithium's chlorine
     * comes back out of the electrolysis further down the chain, so the step
     * fetching Vanadinite to make some is redundant -- but only this tells the
     * difference between that and a material genuinely being made on purpose.
     */
    otherSupplyOf: (name) => {
      const node = dag.materials.get(name);
      if (!node) return R0;
      let spare = R0;
      for (const id of node.byproductOf) {
        const q = dag.processes.get(id);
        const n = scaled.runs.get(id) || R0;
        for (const o of q?.produces || []) {
          if (o.name === name) spare = radd(spare, rmul(n, rat(o.count)));
        }
      }
      return rmul(spare, scale);
    },
    runsOf: (id) => rmul(scaled.runs.get(id) || R0, scale),
  };
}

/**
 * Amounts that use the feed up rather than leaving half of it on the floor.
 *
 * Ask for one each of Potassium, Lithium, Aluminum and Silicon out of
 * Lepidolite and you get two of each -- a run is a whole thing, so the plan
 * doubles -- with one Molten Silica left over, because the ore's three
 * decompositions share a chamber and hand back three Molten Silica whether you
 * wanted them or not. Two, two, two and *three* is what three Lepidolite
 * actually comes to, and working that out by hand is arithmetic nobody should
 * be doing.
 *
 * Two things, in order:
 *
 *   1. The batch scale is folded in, so the numbers say what you get rather
 *      than what you asked for before the plan rounded it up.
 *   2. Each amount is raised as far as it will go without the plan wanting
 *      more of anything you said you have, and the result reduced to its
 *      smallest whole numbers.
 *
 * The second only applies where there are two products to hold in proportion
 * *and* something held that they compete for. One product has no ratio to be
 * in, and a feed nothing draws on is no constraint -- Molten Aluminum out of
 * Water would climb forever -- so both of those keep the amounts they were
 * given and take only the scaling.
 *
 * The ratio is a property of the question, not of the numbers already in the
 * box, so the climb starts from one of each. Starting from what was typed lets
 * a lopsided request keep the oversized feed it committed to: 2/2/2/4 buys
 * twelve Lepidolite, and filling those gives 8/2/2/12 rather than the 2/2/2/3
 * that three would have got.
 */
export function balanceTargets(graph, rawSpec) {
  const names = (rawSpec.targets || []).map((t) => (typeof t === 'string' ? t : t.name));
  const typed = (rawSpec.targets || []).map((t) => (typeof t === 'string' ? 1 : t.amount || 1));
  if (!names.length) return [];

  /** Solves are the cost here, so they are counted and capped. */
  let budget = 60;
  const solve = (a) => (budget-- > 0
    ? solvePlan(graph, { ...rawSpec, targets: names.map((n, i) => ({ name: n, amount: a[i] })) })
    : null);

  /**
   * What the plan asks you to supply of the things you have a fixed stock of.
   *
   * Only those: something you can go on making is not a limit, and counting it
   * as one caps the plan at whatever the first guess happened to need. Say you
   * have Carbon as well as Lepidolite and the Silicon drops from three to two,
   * for no better reason than that the third one wanted more Carbon.
   */
  const feedOf = (p) => {
    const feed = new Map();
    for (const n of p.spec.have) {
      if (p.spec.plenty.has(n)) continue;
      const net = rsub(p.amountOf(n), p.madeOf(n));
      if (rcmp(net, R0) > 0) feed.set(n, net);
    }
    return feed;
  };
  const costsMore = (was, now) => [...now].some(([n, v]) => rcmp(v, was.get(n) ?? R0) > 0);
  const gcdN = (a, b) => (b ? gcdN(b, a % b) : a);
  /** A runaway guard, not a judgement about what anybody might want. */
  const CEILING = 100000;

  let amounts = [...typed];
  let plan = solve(amounts);
  if (!plan) return names.map((name, i) => ({ name, amount: typed[i] }));
  let feed = feedOf(plan);
  const ratio = names.length > 1 && feed.size > 0;
  if (ratio) { amounts = names.map(() => 1); plan = solve(amounts); feed = feedOf(plan); }

  for (let round = 0; round < 3 && plan; round++) {
    let moved = false;
    // Say what you get, not what you asked for before it was rounded up.
    if (plan.scale.n !== 1n) {
      amounts = amounts.map((a) => a * Number(plan.scale.n));
      plan = solve(amounts);
      if (!plan) break;
      feed = feedOf(plan);
      moved = true;
    }
    if (ratio) {
      for (let i = 0; i < amounts.length && budget > 0; i++) {
        // Double until it costs more feed, then halve back onto the edge.
        let lo = amounts[i], hi = Infinity;
        for (let step = 1; amounts[i] + step <= CEILING; step *= 2) {
          const trial = [...amounts]; trial[i] = amounts[i] + step;
          const q = solve(trial);
          if (!q || costsMore(feed, feedOf(q))) { hi = amounts[i] + step; break; }
          lo = amounts[i] + step;
        }
        while (Number.isFinite(hi) && hi - lo > 1 && budget > 0) {
          const mid = Math.floor((lo + hi) / 2);
          const trial = [...amounts]; trial[i] = mid;
          const q = solve(trial);
          if (!q || costsMore(feed, feedOf(q))) hi = mid; else lo = mid;
        }
        if (lo !== amounts[i]) { amounts[i] = lo; moved = true; }
      }
      const q = solve(amounts);
      if (q) { plan = q; feed = feedOf(plan); }
      // Smallest whole numbers, so the same ratio always reads the same way.
      const g = amounts.reduce(gcdN);
      if (g > 1) {
        const smaller = amounts.map((a) => a / g);
        const r = solve(smaller);
        if (r && r.scale.n === 1n) { amounts = smaller; plan = r; feed = feedOf(plan); moved = true; }
      }
    }
    if (!moved) break;
  }
  return names.map((name, i) => ({ name, amount: amounts[i] }));
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
  const stock = new Set([...spec.have].filter((n) => !spec.plenty.has(n)));

  const routes = graph.producers(name)
    .filter((p) => spec.kinds.has(p.kind) || p.id === chosen || spec.alsoUse.has(p.id))
    .map((p) => {
      const inputs = [...p.consumes, ...p.requires].map((i) => ({
        ...i,
        have: spec.have.has(i.name),
        inPlan: inPlan.has(i.name),
      }));
      let c = processCost(p, spec.weights, spec.avoidSideEffects);
      for (const i of inputs) c += cost.get(i.name) ?? Infinity;
      const runs = plan.runsOf(p.id);
      const yields = p.produces.find((o) => o.name === name)?.count ?? 0;
      // Could be switched on right now and get somewhere: the plan is already
      // leaving enough of everything it eats for one run of it.
      const runnable = p.consumes.length > 0 && p.consumes.every(({ name: i, count }) =>
        rcmp(rsub(plan.madeOf(i), plan.amountOf(i)), rat(count)) >= 0);
      return {
        process: p,
        cost: c,
        inputs,
        chosen: p.id === chosen,
        /**
         * In the plan, but only on the leavings: it makes what the spare will
         * stretch to and the chosen route makes the rest. Both rows are then
         * live at once, which is the truth of it.
         */
        spare: spec.alsoUse.has(p.id) && !rzero(runs),
        /** Enough is going spare to run it, whether or not it has been asked for. */
        runnable,
        /**
         * It gets through the stock the reader said they had.
         *
         * The solver prefers one of these outright, so the chosen row is
         * usually one already -- but the *others* are the rows worth finding,
         * and they sort by price like everything else. The three ways to
         * Carbon that eat carbon dioxide sat at 115, 116 and 117 of 153,
         * behind six shown and a "Show all" button, which is a list you can
         * only search if you already know the answer.
         */
        draws: p.consumes.some((i) => stock.has(i.name)),
        runs,
        /** How much of this material it supplies, as the plan stands. */
        covers: rmul(runs, rat(yields)),
        banned: spec.excludeProcesses.has(p.id),
        /** How much of what it needs you would not have to go on and plan. */
        ready: inputs.filter((i) => i.have || i.inPlan).length,
      };
    });

  // A route the plan is already using heads the list. Carbon has 153 of them
  // and eight are shown: a route picked out by hand that then costs more than
  // the one it joined would otherwise disappear off the end of the list.
  const using = (r) => Number(r.chosen || r.spare);
  routes.sort((a, b) => Number(a.banned) - Number(b.banned) ||
                        using(b) - using(a) ||
                        // Then the ones that use what the reader has, which is
                        // the whole of why they said they had it.
                        Number(b.draws) - Number(a.draws) ||
                        // Then the ones the plan could feed out of its own
                        // leavings, which is the offer worth noticing and is
                        // otherwise buried: Carbon has 153 routes and eight
                        // are shown.
                        Number(b.runnable) - Number(a.runnable) ||
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
