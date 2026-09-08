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

/** Scores, and which way is better. Everything is per unit of what was asked. */
export const SCORES = [
  { id: 'atoms', short: 'atoms', label: 'atoms fetched', dir: 1,
    hint: 'How much matter you have to go and get' },
  { id: 'units', short: 'items', label: 'things bought', dir: 1,
    hint: 'How many items, whatever their size' },
  { id: 'shop', short: 'list', label: 'shopping list', dir: 1,
    hint: 'How many different materials to source' },
  { id: 'reactors', short: 'react', label: 'reactors', dir: 1,
    hint: 'Machines to build; a step run twice still costs one' },
  { id: 'steps', short: 'steps', label: 'steps', dir: 1,
    hint: 'Reactors plus the phase changes, which are free' },
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
export function measure(plan, { matter, toNumber }) {
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
  return {
    atoms: atoms / batch,
    units: units / batch,
    shop: plan.frontier.length,
    reactors: plan.steps.filter((s) => s.process.kind !== 'phase').length,
    steps: plan.steps.length,
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
    if (row) scored.push({ ...row, options: e.options, plan: e.plan });
    else barren.push(e.options);
  }

  const byOutcome = new Map();
  for (const row of scored) {
    const key = signature(row);
    if (!byOutcome.has(key)) byOutcome.set(key, { ...row, via: [] });
    byOutcome.get(key).via.push(row.options);
  }
  const distinct = [...byOutcome.values()];
  // The shortest option set first, so a row is offered by the least the player
  // has to switch on to reach it.
  for (const row of distinct) row.via.sort((a, b) => a.length - b.length);

  const menu = distinct.filter((row) =>
    !distinct.some((other) => other !== row && beats(other, row, want)));
  for (const row of menu) {
    row.best = COSTS.filter((s) => {
      const mine = s.dir * row[s.id];
      return !menu.some((other) => s.dir * other[s.id] < mine - SAME);
    }).map((s) => s.id);
  }
  menu.sort((a, b) => a.atoms - b.atoms || a.reactors - b.reactors || a.units - b.units);
  return { menu, distinct: distinct.length, scored: scored.length, barren };
}
