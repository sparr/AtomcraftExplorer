/**
 * The same question asked several ways, and the answers worth keeping.
 *
 * A plan is not one thing. Told it may buy manufactured goods, the Columbite
 * question comes back with sixteen atoms and thirteen reactors; told it may
 * only mine, it comes back with forty-four atoms in a single purchase -- twelve
 * Lepidolite and nothing else to carry. Neither is the right answer. One is for
 * a player who wants a short shopping list and the other is for a player who
 * wants to move less rock, and the planner has no way of knowing which.
 *
 * So it answers all of them, and this works out which answers are worth
 * showing. Two rules do nearly all of it:
 *
 *   Dedupe by *outcome*, not by the options that produced it. Twelve of the
 *   thirty-one source sets give the identical Lepidolite plan. Listing twelve
 *   rows would bury the two real choices.
 *
 *   Then keep only what nothing else beats. "Minimal on some score" is the
 *   obvious rule and it is too loose: on Lepidolite five plans tie at half an
 *   atom, so all five are minimal on atoms and all five make the list, even
 *   though one of them is better on reactors and steps with every other column
 *   equal. Pareto -- drop a row if another is at least as good everywhere and
 *   better somewhere -- cuts those five to one and leaves genuine trade-offs
 *   alone.
 *
 * Nothing here solves anything. The caller does the solving, one option set at
 * a time, because in the page that has to happen without locking the tab up.
 */

import { reactorsIn } from './plan-graph.js';

/** Scores, and which way is better. Everything is per unit of what was asked. */
export const SCORES = [
  { id: 'atoms', short: 'atoms', label: 'atoms fetched', dir: 1,
    hint: 'How much matter you have to go and get' },
  { id: 'units', short: 'items', label: 'things bought', dir: 1,
    hint: 'How many items, whatever their size' },
  { id: 'shop', short: 'list', label: 'shopping list', dir: 1,
    hint: 'How many different materials to source' },
  { id: 'reactors', short: 'react', label: 'reactors', dir: 1,
    hint: 'Machines to build; a step run twice still costs one, and a phase ' +
          'change costs none -- it happens in the open air or inside the ' +
          'reactor that wanted the hot form' },
  /**
   * How much running it takes, which is not how much building it takes.
   *
   * Sparr: one reactor run four times is four steps. So this counts runs where
   * `reactors` counts vessels, and the two answer different questions -- one
   * reactor turned forty times and four reactors turned ten times each are the
   * same forty steps and not the same factory.
   *
   * It used to be `plan.steps.length`, hinted as "reactors plus the phase
   * changes, which are free", which counted neither: a step run forty times
   * was one, and a condenser that costs nothing to own was one as well. That
   * decided the comparison this whole column exists for -- of two Lepidolite
   * plans alike in ore, purchases, reactors and leavings, the one that
   * condenses its steam rather than venting it scored a step worse for owning
   * the condenser, and the menu threw away the plan that needed no charge. A
   * phase change is still not counted, being free in the same sense it is free
   * of a reactor. The running is.
   *
   * Per unit, like everything else that scales: a plan quoted at four times
   * the size turns its steps four times as often, and that is the batch
   * talking rather than the plan.
   */
  { id: 'steps', short: 'steps', label: 'steps', dir: 1,
    hint: 'How many times something has to be run; one reactor run four ' +
          'times is four steps, and a phase change is none' },
  /**
   * What has to be found before the plant will turn at all.
   *
   * Not the shopping list. A charge is matter that has to be in the pipes
   * before the first batch, and `priming` is the part of it the plant never
   * pays back -- nothing outside the wheel it seeds will ever fill it, so no
   * amount of running helps. That is a different kind of cost from a thing you
   * buy each batch, and nothing here was measuring it: two plans identical in
   * ore, purchases, reactors and leavings, one of which needs two Hydrogen Gas
   * laid in and one of which does not, scored the same.
   *
   * Absolute, not per unit. Measured, rather than assumed: the Lepidolite plan
   * asks for one Chlorine Gas and two Hydrogen Gas whether it is making two of
   * each product or six. A charge is laid in once however long the plant runs,
   * so dividing it through would say a bigger order needs less of it.
   */
  { id: 'charge', short: 'charge', label: 'to lay in', dir: 1,
    hint: 'Matter that must be in the pipes before the first batch, and that ' +
          'the plant never pays back' },
  /**
   * How many it makes when you asked for one.
   *
   * A run is a whole thing, so the plan multiplies up by the common
   * denominator of whatever the steps landed on, and the reader who wanted one
   * Aluminum is told to make eight. Everything else here is divided by that
   * number precisely so the rows mean the same thing; this is the number
   * itself, which is a real difference between two answers and was the one
   * thing no column could say.
   */
  { id: 'batch', short: 'batch', label: 'batch size', dir: 1,
    hint: 'How many it makes at once; asking for one can make four' },
  /**
   * Leftovers: lowest priority, and which way is a preference.
   *
   * Sparr, twice. First: more leftover atoms from the same inputs is just
   * conservation errors in play, so do not incentivise it -- fewer leavings is
   * the sign of not having fetched what you did not need. Then: make it an
   * option either way, but keep it one of the lowest priorities regardless.
   *
   * So it is a tie-break and never a reason to prefer one answer to another.
   * Ranked alongside the rest it credited the Columbite plan that fetched
   * sixty-six atoms and left thirty-six of them lying about as the best of the
   * five at leftovers, which is the opposite of what that number means.
   * `dir` here is only the default; `digest` takes the reader's choice.
   */
  { id: 'left', short: 'left', label: 'leftovers', dir: 1, tiebreak: true,
    hint: 'Matter left on the floor. Broken ties only -- never a reason to ' +
          'prefer one plan to another' },
];

/** Every non-empty combination of the categories, smallest first. */
export function optionSets(categories) {
  const out = [];
  for (let mask = 1; mask < (1 << categories.length); mask++) {
    out.push(categories.filter((_, i) => mask & (1 << i)));
  }
  return out.sort((a, b) => a.length - b.length);
}

/**
 * One solved plan, scored.
 *
 * Per unit of target, because the batch size is not a choice anyone made: it
 * is the lowest common multiple of whatever denominators the steps landed on,
 * so one answer is quoted for four tantalum and the next for six. Dividing
 * through is the only way two rows mean the same thing.
 */
export function measure(plan, { matter, toNumber, charges = true }) {
  if (!plan || !plan.steps || !plan.steps.length) return null;
  const batch = (plan.spec && plan.spec.targets && plan.spec.targets[0] &&
                 plan.spec.targets[0].amount) || 1;
  let units = 0;
  let atoms = 0;
  for (const f of plan.frontier) {
    const n = toNumber(f.amount);
    units += n;
    atoms += n * matter(f.name);
  }
  let left = 0;
  for (const b of plan.byproducts) left += toNumber(b.amount) * matter(b.name);
  /**
   * Reading `priming` is what runs the charge pass, so a caller that will not
   * look at this column says `charges: false` and is not billed for it.
   */
  let charge = 0;
  if (charges) for (const c of plan.priming || []) charge += toNumber(c.amount) * matter(c.name);
  let runs = 0;
  for (const step of plan.steps) {
    if ((step.process ? step.process.kind : step.kind) === 'phase') continue;
    // A step that does not say how often it runs has run once.
    runs += step.runs === undefined ? 1 : toNumber(step.runs);
  }
  return {
    atoms: atoms / batch,
    units: units / batch,
    shop: plan.frontier.length,
    reactors: reactorsIn(plan.steps),
    steps: runs / batch,
    // Laid in once however long the plant runs, so it is not divided through.
    charge,
    batch,
    left: left / batch,
  };
}

const SAME = 1e-9;
const signature = (row) => SCORES.map((s) => row[s.id].toFixed(6)).join('|');

/** The scores a plan is judged on, and the one that only settles draws. */
const COSTS = SCORES.filter((s) => !s.tiebreak);
const TIES = SCORES.filter((s) => s.tiebreak);

/**
 * At least as good everywhere that counts, and better somewhere -- or level
 * all through and ahead on a tie-break.
 *
 * `want` is +1 to keep the leavings down and -1 to pile them up.
 */
function beats(a, b, want) {
  let strictly = false;
  for (const s of COSTS) {
    const mine = s.dir * a[s.id];
    const theirs = s.dir * b[s.id];
    if (mine > theirs + SAME) return false;
    if (mine < theirs - SAME) strictly = true;
  }
  if (strictly) return true;
  return TIES.some((s) => want * a[s.id] < want * b[s.id] - SAME);
}

/**
 * The menu: distinct outcomes that nothing else beats, each labelled with what
 * it is best at.
 *
 * `entries` are `{ options, plan }`, where a null plan means that combination
 * could not answer -- kept and returned separately, because "farming alone
 * cannot make tantalum" is worth saying rather than quietly dropping.
 */
export function digest(entries, tools, { keepLeftovers = false } = {}) {
  const want = keepLeftovers ? -1 : 1;
  const scored = [];
  const barren = [];
  for (const e of entries) {
    const row = e.plan ? measure(e.plan, tools) : null;
    if (row) scored.push({ ...row, options: e.options, ore: e.ore, merge: e.merge,
                           weigh: e.weigh, plan: e.plan });
    else barren.push(e.options);
  }

  const byOutcome = new Map();
  for (const row of scored) {
    /**
     * The ore is part of which row this is, not of how good it is: two plans
     * that score alike but buy different ores are two answers, not one. So is
     * which states the question was willing to treat as one substance.
     *
     * The weighing order is not. It is not a property of the plan, it is a
     * question somebody asked -- and four of them reaching the same one-reactor
     * Carbon plan is one answer offered four ways, not four answers. So it
     * stays out of the key and merges on score like the sources do; whichever
     * order reached the row first is the one it is named for.
     */
    const key = `${signature(row)}|${row.ore ?? ''}|${row.merge ?? ''}`;
    if (!byOutcome.has(key)) byOutcome.set(key, { ...row, via: [] });
    byOutcome.get(key).via.push(row.options);
  }
  /**
   * The ore the solver would have chosen anyway is not a second answer.
   *
   * Every ore is asked about, including the one the plan already buys, so the
   * winner comes back twice -- once as the row the reader is on and once as
   * "buy Borax", scoring identically. Offering both invites a choice between a
   * thing and itself. The named row goes and the plain one stays, because the
   * plain one is where the reader already is.
   */
  /**
   * And a merge that changes nothing is not a second answer either.
   *
   * Asked whether Hydrofluoric Acid and its gas may be one substance, the
   * Lepidolite plan comes back identical -- same ore, same purchases, same
   * charge, same batch. Offering it would be offering a choice between a thing
   * and itself.
   */
  for (const [key, row] of [...byOutcome]) {
    if (!row.ore && !row.merge) continue;
    if (byOutcome.has(`${signature(row)}||`)) byOutcome.delete(key);
  }
  const distinct = [...byOutcome.values()];
  /**
   * The shortest option set first, so a row is offered by the least the player
   * has to switch on to reach it -- and each set once, because a row reached by
   * four weighings of the same sources is not reached four ways.
   */
  for (const row of distinct) {
    const seen = new Set();
    row.via = row.via.filter((v) => {
      const key = [...v].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.length - b.length);
  }

  const menu = distinct.filter((row) =>
    !distinct.some((other) => other !== row && beats(other, row, want)));
  /**
   * Every column says who leads it, the leavings among them.
   *
   * This was the costs only, so the leftovers column was the one column on the
   * board with nothing marked in it and no row ever crediting it -- which
   * reads as an oversight rather than as a decision, and Sparr read it as one.
   *
   * The decision it came from stands and is a different thing: leftovers must
   * never decide which answers survive. They do not -- `beats` still treats
   * this as a tie-break and nothing else, so a plan that buys sixty-six atoms
   * and bins thirty-six of them cannot win a place by binning them. Saying
   * which row leaves least is a remark about the board, not a reason.
   *
   * In the reader's direction, because which way they want the leavings is
   * theirs: `want` is what `keepLeftovers` chose, and asked to pile them up it
   * is the row that piles most that leads the column.
   */
  for (const row of menu) {
    row.best = SCORES.filter((s) => {
      const dir = s.tiebreak ? want : s.dir;
      const mine = dir * row[s.id];
      return !menu.some((other) => dir * other[s.id] < mine - SAME);
    }).map((s) => s.id);
  }
  menu.sort((a, b) => a.atoms - b.atoms || a.reactors - b.reactors || a.units - b.units);
  return { menu, distinct: distinct.length, scored: scored.length, barren };
}
