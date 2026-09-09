/**
 * The ways a material could be got, priced and sorted for the inspector.
 *
 * Lifted out of `plan-solve.js` when that solver was retired. It never
 * belonged to it: the panel it draws is a fact about the graph and a plan --
 * what makes this, what would each way need, and how much of that is already
 * to hand -- and it is asked of whichever plan the page is showing.
 *
 * The weights are the subset `processCost` actually reads. The old solver
 * carried four more, `acquire`, `acquireRaw`, `acquireWorld` and the placed
 * case, which priced *having* a material against making it. Nothing here asks
 * that question, and the solver that did is gone.
 */
import { KIND, operatingWindow } from './plan-graph.js';
import { rat, rsub, rcmp, rmul, rzero } from './rational.js';

/**
 * What each thing costs, as a preference rather than a game number. These
 * decide the order Steam's 108 producers are offered in, and nothing else.
 */
export const ROUTE_WEIGHTS = {
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

/**
 * The cost of running one process, before its inputs are counted.
 *
 * The `Probability` field is a divisor rather than a fraction -- reactions
 * carry 4 to 10000, phase changes 2e6 to 6.4e7 -- so bigger means rarer. Its
 * decade count is a decent stand-in for how long you will be waiting.
 */
export function processCost(p, w = ROUTE_WEIGHTS, avoid = true) {
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
  /**
   * Everything you hold is finite, so everything you hold is stock.
   *
   * The old solver had a `plenty` set for things you could go on getting, and
   * this filtered them out. There is no such set any more -- the question it
   * answered, "which of these will run out", now has one answer.
   */
  const stock = new Set(spec.have);

  const routes = graph.producers(name)
    .filter((p) => spec.kinds.has(p.kind) || p.id === chosen || spec.alsoUse.has(p.id))
    .map((p) => {
      const inputs = [...p.consumes, ...p.requires].map((i) => ({
        ...i,
        have: spec.have.has(i.name),
        inPlan: inPlan.has(i.name),
      }));
      let c = processCost(p, ROUTE_WEIGHTS, spec.avoidSideEffects);
      /**
       * What the inputs cost, where anybody has worked that out.
       *
       * The older solver carries a table of what each material costs to get,
       * and a route is priced as its step plus its inputs. The newer one has
       * no such table -- it prices a *fetch* by the matter it carries and
       * decides the rest inside the simplex -- so for its plans a route is
       * priced by its step alone and the ordering falls through to the keys
       * below. Summing `?? Infinity` over an absent table would have made
       * every route cost Infinity and every comparison NaN, which sorts by
       * nothing at all.
       */
      if (cost) for (const i of inputs) c += cost.get(i.name) ?? Infinity;
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
