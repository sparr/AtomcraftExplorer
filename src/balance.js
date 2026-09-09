/**
 * How much of each thing to ask for, so the feed is not wasted.
 *
 * Lived in `plan-solve.js` and belonged to neither solver: it drove the older
 * one and the newer one alike, taking whichever was answering as an argument.
 * The older one is gone and the argument stays, there being no reason for this
 * to know which solver it is driving.
 */
import { rsub, radd, rcmp, R0, rdiv, rnum } from './rational.js';

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
export function balanceTargets(graph, rawSpec, solveWith) {
  const names = (rawSpec.targets || []).map((t) => (typeof t === 'string' ? t : t.name));
  const typed = (rawSpec.targets || []).map((t) => (typeof t === 'string' ? 1 : t.amount || 1));
  if (!names.length) return [];

  /** Solves are the cost here, so they are counted and capped. */
  let budget = 60;
  /**
   * Whichever solver is answering the question, not always the older one.
   *
   * Sparr: choosing a row of the scoreboard changes what the plan is allowed
   * to fetch, and the amounts at the top did not move with it. They could not:
   * this balanced every plan with the older solver, which had no notion of
   * source categories at all, so questions were being weighed by a solver that
   * could not read half of them.
   */
  const solve = (a) => (budget-- > 0
    ? solveWith(graph, { ...rawSpec, targets: names.map((n, i) => ({ name: n, amount: a[i] })) })
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
      const net = rsub(p.amountOf(n), p.madeOf(n));
      /**
       * Per unit of the order, because the batch moves underneath this.
       *
       * A plan is quoted at whatever size makes every run count whole, and
       * that size jumps about as the amounts change: asking for one more
       * Lithium took the Lepidolite question from a batch of two to a batch of
       * four, and the feed line from nine Lepidolite to eighteen. Read as
       * written that is twice the ore, so the search stopped -- and it was the
       * same ore at twice the quotation. Three Lithium, one step further on,
       * is nine Lepidolite again for three times the lithium and nothing left
       * on the floor, and it was never tried.
       */
      if (rcmp(net, R0) > 0) feed.set(n, rdiv(net, p.scale));
    }
    return feed;
  };
  const costsMore = (was, now) => [...now].some(([n, v]) => rcmp(v, was.get(n) ?? R0) > 0);

  /**
   * What the feed comes to per thing the plan actually makes.
   *
   * `feedOf` reads per unit of the order, which is what the climb wants: it is
   * walking towards a bigger quotation of the same plan, and flat ground there
   * means the plan is not getting worse. It cannot compare two different
   * *proportions*, because asking for one of each of three things and being
   * handed twelve of each reports the same feed per unit ordered as asking for
   * two, two and one -- while the ore per thing made is 1.33 against 1.20.
   */
  const perThing = (p) => {
    let made = R0;
    for (const t of p.spec.targets) made = radd(made, p.madeOf(t.name));
    if (rcmp(made, R0) <= 0) return Infinity;
    /**
     * One number, in atoms, because two held things can disagree.
     *
     * Two, two and one uses less Lepidolite per thing than one of each and
     * slightly more Columbite, so a rule of "less of everything" refuses it
     * and the better proportion is never taken. What is actually being
     * compared is how much of the ore heap goes in for what comes out, and
     * that is a sum -- weighed by matter, as the shopping list is, so that a
     * Lepidolite at twenty-two atoms does not count the same as a Columbite
     * at eight.
     */
    let atoms = 0;
    for (const n of p.spec.have) {
      const net = rsub(p.amountOf(n), p.madeOf(n));
      if (rcmp(net, R0) > 0) atoms += rnum(net) * (p.graph?.db.byName.get(n)?.matter ?? 1);
    }
    return atoms / rnum(made);
  };
  const gcdN = (a, b) => (b ? gcdN(b, a % b) : a);
  /**
   * A runaway guard, and now a load-bearing one.
   *
   * It used to sit at a hundred thousand because nothing ever approached it:
   * the feed was compared in absolute terms, so the batch growing was itself
   * read as costing more ore and the search stopped almost at once. Comparing
   * per unit of the order fixed that -- and took the guard off, because a
   * solver that can make a product out of nothing holds its feed-per-unit flat
   * for ever. The older planner has no check on a free-turning wheel and went
   * to two hundred and ninety-four thousand Lithium.
   *
   * Sixty-four is past any ratio a real question has wanted -- the widest here
   * is two-two-two-six -- and near enough to stop a runaway being mistaken for
   * an answer.
   */
  const CEILING = 64;

  let amounts = [...typed];
  let plan = solve(amounts);
  if (!plan) return names.map((name, i) => ({ name, amount: typed[i] }));
  let feed = feedOf(plan);
  /**
   * One product is still a question about the feed.
   *
   * This used to need two or more, on the reading that balancing is about the
   * proportion between products -- and with one there is no proportion. But
   * the other half of the question survives perfectly well on its own: how
   * much of this will what I have make? Carbon out of Carbon Monoxide, told to
   * get rid of the carbon dioxide, costs two Carbon Monoxide whether you ask
   * for one Carbon or two, because the Boudouard equilibrium cannot be run
   * half a time. Asking for one and being handed a spare is the same plan
   * described worse.
   */
  const ratio = feed.size > 0;
  if (ratio) { amounts = names.map(() => 1); plan = solve(amounts); feed = feedOf(plan); }

  /**
   * The proportion first, before the quotation is folded in.
   *
   * Sparr: the balancer should prefer the ratio the feed actually gives.
   *
   * Folding first locks whatever proportion was typed. One Tantalum, one
   * Niobium and one Fluorine Gas out of Columbite and Lepidolite comes back
   * quoted at twelve, so the amounts became twelve of each and every later
   * step asked how to make 1:1:1 bigger -- when the ore gives 2:2:1, which is
   * four, four and two on a quarter of the feed.
   *
   * Raising one at a time cannot find it either: one of each costs 1.33 ore a
   * thing, two-one-one costs 1.50, and two-two-one costs 1.20. The good
   * proportion sits behind a worse one on every single-coordinate path, so
   * pairs move together here, and only where that is strictly cheaper per
   * thing made -- on flat ground a pair step walks for ever, which took
   * Tantalum and Niobium to fifty-seven of each before this was pinned down.
   */
  if (ratio && names.length > 1) {
    let per = perThing(plan);
    for (let i = 0; i < amounts.length && budget > 0; i++) {
      for (let j = i + 1; j < amounts.length && budget > 0; j++) {
        for (;;) {
          const trial = [...amounts];
          trial[i] += 1; trial[j] += 1;
          if (trial[i] > CEILING || trial[j] > CEILING) break;
          const q = solve(trial);
          if (!q || !(perThing(q) < per - 1e-9)) break;
          amounts = trial; plan = q; per = perThing(q);
        }
      }
    }
    feed = feedOf(plan);
  }

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
      // Only where there is a ratio: with one product the number is not a
      // proportion to be reduced, it is the answer, and dividing it out puts
      // the spare straight back.
      /**
       * Every divisor, not just the whole of it.
       *
       * Four Tantalum and four Niobium is two and two said twice, and the
       * reduction only ever tried the full common factor: four into one, which
       * the plan quotes back at four, so it was refused and the fours stood.
       * Halving is what was wanted, and it is the same test one step less far.
       * Largest reduction first, so the smallest honest numbers win.
       */
      const g = names.length > 1 ? amounts.reduce(gcdN) : 1;
      for (let d = g; d > 1 && budget > 0; d--) {
        if (g % d !== 0) continue;
        const smaller = amounts.map((a) => a / d);
        const r = solve(smaller);
        if (r && r.scale.n === 1n) {
          amounts = smaller; plan = r; feed = feedOf(plan); moved = true;
          break;
        }
      }
    }
    if (!moved) break;
  }
  return names.map((name, i) => ({ name, amount: amounts[i] }));
}
