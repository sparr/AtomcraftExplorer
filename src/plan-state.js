/**
 * The plan a reader is building, and how it survives a reload.
 *
 * Only the *question* is kept: what is wanted, what is to hand, and which
 * choices have been overruled by hand. The graph, the amounts and the shopping
 * list are all worked out from that, so nothing derived is ever written to the
 * URL and no saved link can disagree with the solver that reads it.
 *
 * The explorer's own keys (`q`, `m`, `s`, `c`) are untouched and both modes'
 * state is written on every change, so a link never quietly drops the half of
 * it you were not looking at.
 */
import { DEFAULT_KINDS, PROCESS_KINDS } from './plan-graph.js';

/**
 * List and pair separators.
 *
 * Both are percent-encoded by URLSearchParams, as material names with spaces
 * and brackets already are. They are chosen to read back rather than to stay
 * short: a hash nobody can decipher is no worse for being three bytes smaller.
 */
const SEP = '~';
const PAIR = '>';
const AMOUNT = '*';

/** Stands for "no kinds at all", which an absent parameter cannot say. */
const NO_KINDS = '-';

const list = (s) => (s ? s.split(SEP).filter(Boolean) : []);

/** A fresh, empty plan. */
export function emptyPlan() {
  return {
    targets: [],                  // [{name, amount}]
    have: [],                     // names
    /**
     * Which of those you can get as much of as you need.
     *
     * Both halves of `have` mean the same thing to the solver -- stop here,
     * this is not to be made -- and differ only to `balanceTargets`. A limited
     * stock is what the amounts are balanced *against*: three Lepidolite is
     * two Potassium, two Lithium, two Aluminum and three Silicon, and that is
     * the question worth asking of it. Something you can make more of as you
     * go is no constraint at all, and treating it as one caps the plan at
     * whatever the first guess happened to need.
     */
    plenty: [],
    pins: {},                     // material -> process id, or 'have'
    include: [],                  // process ids added going forwards
    /**
     * Routes to run on what the plan is already throwing away, and no further.
     *
     * Not a claim about how anything is made -- that is what `pins` is for --
     * so the two compose: a route can eat the eight spare Carbon Monoxide for
     * four Carbon while the other five are still yours to supply.
     */
    alsoUse: [],
    runs: {},                     // process id -> batch size set by hand
    excludeProcesses: [],
    excludeMaterials: [],
    /**
     * Spare output the reader wants counted as a product rather than waste.
     *
     * Not a target: it asks for nothing to be made. Asking for a leftover as a
     * target instead demands a fresh batch of it -- and, because target amounts
     * are stated before the batch scaling and leftovers are shown after it, a
     * request for the 1 spare Water came out as a demand for 2.
     */
    kept: [],
    /**
     * Leftovers the reader has asked the plan to deal with.
     *
     * Not the same as feeding one back, which offers it to the plan as it
     * stands and does nothing if nothing wants it. This says: go and find
     * something that eats this, and build whatever that needs. The Carbon
     * plan leaves a Carbon Dioxide with another carbon still in it, and
     * nothing in the plan wants carbon dioxide -- the way to get at it is to
     * add the reduction that does, which is a step the plan would never reach
     * for on its own.
     */
    consume: [],
    credit: [],                   // byproducts agreed to be plumbed back, one by one
    /** Or agree to all of them, and name the exceptions instead. */
    feedBackAll: true,
    noFeedBack: [],
    /**
     * Whether to lay a charge in rather than add a step that runs for ever.
     *
     * Off, because a step is the standing bargain and a charge is the price,
     * and that is the way round the plan is written. On where the loop is a
     * real one and the charge comes back every run: the Lepidolite plan
     * reducing Carbon Dioxide with potassium drops from twenty-seven ore an
     * order to under seven, because the potassium is only put in once.
     */
    takeCharges: false,
    kinds: [...DEFAULT_KINDS],
    avoidSideEffects: true,
    /**
     * Hold the amounts in the proportion the feed actually comes out in.
     *
     * On, because the arithmetic is the planner's job: three Lepidolite make
     * two Potassium, two Lithium, two Aluminum and three Silicon, and asking
     * for one of each gets you that anyway with a Molten Silica thrown away.
     * Typing an amount turns it off -- at that point you have said what you
     * want and it is not the planner's place to argue.
     */
    balance: true,
    /**
     * Which material is being inspected. Not part of the question -- it is
     * where you are looking -- but it rides along in the URL for the same
     * reason the explorer's selection does: so a link points at the thing you
     * wanted to show somebody.
     */
    selected: null,
  };
}

/** Is there anything here to solve? */
export const isEmptyPlan = (p) =>
  !p.targets.length && !p.have.length && !p.include.length;

/* --------------------------------------------------------------- the URL */

/** Read the plan out of the fragment's parameters. */
export function readPlan(params) {
  const plan = emptyPlan();

  plan.targets = list(params.get('t')).map((entry) => {
    const at = entry.lastIndexOf(AMOUNT);
    if (at <= 0) return { name: entry, amount: 1 };
    const amount = Number(entry.slice(at + 1));
    return Number.isFinite(amount) && amount > 0
      ? { name: entry.slice(0, at), amount }
      : { name: entry, amount: 1 };
  });
  plan.have = list(params.get('h'));
  plan.plenty = list(params.get('pl'));
  plan.include = list(params.get('i'));
  plan.alsoUse = list(params.get('au'));
  plan.excludeProcesses = list(params.get('x'));
  plan.excludeMaterials = list(params.get('xm'));
  plan.credit = list(params.get('cr'));
  plan.kept = list(params.get('kp'));
  plan.consume = list(params.get('cu'));
  plan.noFeedBack = list(params.get('nf'));
  if (params.get('fb') === '0') plan.feedBackAll = false;
  if (params.get('ch') === '1') plan.takeCharges = true;

  for (const entry of list(params.get('pin'))) {
    const at = entry.indexOf(PAIR);
    if (at > 0) plan.pins[entry.slice(0, at)] = entry.slice(at + 1);
  }
  for (const entry of list(params.get('n'))) {
    const at = entry.lastIndexOf(PAIR);
    const n = Number(entry.slice(at + 1));
    if (at > 0 && Number.isFinite(n) && n > 0) plan.runs[entry.slice(0, at)] = n;
  }

  // Written only when it differs from the default, so an old link that predates
  // a new kind still means "the usual set" rather than "everything but that".
  const kinds = params.get('k');
  if (kinds === NO_KINDS) plan.kinds = [];
  else if (kinds) {
    const known = new Set(PROCESS_KINDS.map((k) => k.id));
    plan.kinds = list(kinds).filter((k) => known.has(k));
  }
  if (params.get('ss') === '0') plan.avoidSideEffects = false;
  if (params.get('b') === '0') plan.balance = false;
  plan.selected = params.get('pm') || null;
  return plan;
}

/** Write it back, omitting everything still at its default. */
export function writePlan(plan, params) {
  const put = (key, value) => { if (value) params.set(key, value); };

  put('t', plan.targets
    .map((t) => (t.amount === 1 ? t.name : `${t.name}${AMOUNT}${t.amount}`)).join(SEP));
  put('h', plan.have.join(SEP));
  put('pl', plan.plenty.join(SEP));
  put('i', plan.include.join(SEP));
  put('au', plan.alsoUse.join(SEP));
  put('x', plan.excludeProcesses.join(SEP));
  put('xm', plan.excludeMaterials.join(SEP));
  put('cr', plan.credit.join(SEP));
  put('kp', plan.kept.join(SEP));
  put('cu', plan.consume.join(SEP));
  put('nf', plan.noFeedBack.join(SEP));
  if (!plan.feedBackAll) params.set('fb', '0');
  if (plan.takeCharges) params.set('ch', '1');
  put('pin', Object.entries(plan.pins).map(([m, p]) => `${m}${PAIR}${p}`).join(SEP));
  put('n', Object.entries(plan.runs).map(([p, n]) => `${p}${PAIR}${n}`).join(SEP));

  const usual = plan.kinds.length === DEFAULT_KINDS.length &&
                DEFAULT_KINDS.every((k) => plan.kinds.includes(k));
  // `-` rather than nothing, because an absent `k` means the usual set and
  // turning every kind off has to survive a reload as itself.
  if (!usual) params.set('k', plan.kinds.join(SEP) || NO_KINDS);
  if (!plan.avoidSideEffects) params.set('ss', '0');
  if (!plan.balance) params.set('b', '0');
  put('pm', plan.selected);
}

/* ------------------------------------------------------------- editing it */

/**
 * Every change goes through one of these, and each returns a *new* plan rather
 * than editing in place -- so re-solving is always "here is the plan, what does
 * it come to" and never depends on what the last render happened to leave
 * behind.
 */
const clone = (p) => ({
  ...p,
  targets: p.targets.map((t) => ({ ...t })),
  have: [...p.have],
  plenty: [...p.plenty],
  pins: { ...p.pins },
  include: [...p.include],
  alsoUse: [...p.alsoUse],
  runs: { ...p.runs },
  excludeProcesses: [...p.excludeProcesses],
  excludeMaterials: [...p.excludeMaterials],
  credit: [...p.credit],
  kept: [...p.kept],
  consume: [...p.consume],
  noFeedBack: [...p.noFeedBack],
  kinds: [...p.kinds],
});

const drop = (arr, value) => arr.filter((x) => x !== value);

export function addTarget(plan, name, amount = 1) {
  const next = clone(plan);
  const found = next.targets.find((t) => t.name === name);
  if (found) found.amount += amount;
  else next.targets.push({ name, amount });
  // Asking to make something you had said you have is a change of mind, not a
  // contradiction to be solved around.
  next.have = drop(next.have, name);
  return next;
}

export function setTargetAmount(plan, name, amount) {
  const next = clone(plan);
  const found = next.targets.find((t) => t.name === name);
  if (found) found.amount = Math.max(1, Math.round(amount) || 1);
  // Typing a number is taking the wheel. Balancing would overwrite it on the
  // next render, which is a box that will not hold what you put in it.
  next.balance = false;
  return next;
}

/** Count this spare output as something the plan is for, without making more. */
export const keepOutput = (plan, name) => toggle(plan, 'kept', name);
export const isKept = (plan, name) => plan.kept.includes(name);

/**
 * Go and find something that eats this, and build whatever that needs.
 *
 * The third thing you can say about a leftover, after keeping it and feeding
 * it back. Feeding back offers it to the plan as it stands and does nothing
 * where nothing wants it; this goes looking.
 */
export const useUp = (plan, name) => toggle(plan, 'consume', name);
export const isUsedUp = (plan, name) => plan.consume.includes(name);

/** Is this byproduct being plumbed back into the plan? */
export const isFedBack = (plan, name) =>
  (plan.feedBackAll ? !plan.noFeedBack.includes(name) : plan.credit.includes(name));

/** Turn that round, whichever way the blanket option has it. */
export const toggleFedBack = (plan, name) =>
  toggle(plan, plan.feedBackAll ? 'noFeedBack' : 'credit', name);

/**
 * Leave a material on its loop and lay some in, rather than making it.
 *
 * The other side of the default. A charge is put in once and never spent, so
 * where the alternative is a step running for the life of the factory it may
 * well be the better bargain -- and only the reader knows which.
 */
export function primeInstead(plan, name) {
  const next = clone(plan);
  next.noFeedBack = drop(next.noFeedBack, name);
  if (!next.credit.includes(name)) next.credit.push(name);
  return next;
}

/** And back: make it outright rather than taking it off the loop. */
export function makeInstead(plan, name) {
  const next = clone(plan);
  next.credit = drop(next.credit, name);
  if (!next.noFeedBack.includes(name)) next.noFeedBack.push(name);
  return next;
}

/** Has the reader pinned this one to being primed? */
export const isPrimedByChoice = (plan, name) => plan.credit.includes(name);

/** Look at a material: what it is for, how it is being made, and what else could. */
export function selectMaterial(plan, name) {
  return { ...clone(plan), selected: name || null };
}

export function removeTarget(plan, name) {
  const next = clone(plan);
  next.targets = next.targets.filter((t) => t.name !== name);
  return next;
}

/**
 * `plenty` says you can get as much as the plan turns out to need.
 *
 * True wherever the reader is waving something off -- "I have it" on a line of
 * the shopping list is not a statement about how much of it they have -- and
 * false for the have box, where naming a material is stating your stock and
 * "how much can I get out of this" is the question being asked.
 */
export function addHave(plan, name, plenty = false) {
  const next = clone(plan);
  if (!next.have.includes(name)) next.have.push(name);
  if (plenty && !next.plenty.includes(name)) next.plenty.push(name);
  next.targets = next.targets.filter((t) => t.name !== name);
  // A pin saying how to make it is moot once you have it.
  delete next.pins[name];
  return next;
}

export function removeHave(plan, name) {
  const next = clone(plan);
  next.have = drop(next.have, name);
  next.plenty = drop(next.plenty, name);
  return next;
}

/** Between "this is all I have" and "as much as it needs". */
export const hasPlenty = (plan, name) => plan.plenty.includes(name);
export const togglePlenty = (plan, name) => toggle(plan, 'plenty', name);

/** Choose which process makes a material, or 'have' to stop expanding there. */
export function pin(plan, material, processId) {
  const next = clone(plan);
  if (processId) next.pins[material] = processId;
  else delete next.pins[material];
  return next;
}

/** Add a process going forwards, from something already in hand. */
export function includeProcess(plan, id, runs) {
  const next = clone(plan);
  if (!next.include.includes(id)) next.include.push(id);
  if (runs) next.runs[id] = runs;
  return next;
}

/**
 * Run this route on the plan's leavings, or stop.
 *
 * A pin on the same material is cleared: it was standing in for this, and
 * leaving both would have the material claiming to be made two ways at once.
 */
export function useSpare(plan, material, processId) {
  const next = toggle(plan, 'alsoUse', processId);
  if (next.alsoUse.includes(processId) && next.pins[material] === processId) {
    delete next.pins[material];
  }
  return next;
}

export const isUsingSpare = (plan, id) => plan.alsoUse.includes(id);

export function toggle(plan, key, value) {
  const next = clone(plan);
  next[key] = next[key].includes(value) ? drop(next[key], value) : [...next[key], value];
  return next;
}

export function toggleKind(plan, id) {
  const next = clone(plan);
  next.kinds = next.kinds.includes(id) ? drop(next.kinds, id) : [...next.kinds, id];
  return next;
}

export function setOption(plan, key, value) {
  return { ...clone(plan), [key]: value };
}

/**
 * Seed a plan from a reaction the reader picked out in the explorer: make what
 * it makes, and hold it to that reaction rather than letting the solver pick a
 * different route to the same product.
 */
export function planProcess(plan, process) {
  let next = plan;
  for (const { name } of process.produces) next = addTarget(next, name);
  for (const { name } of process.produces) next = pin(next, name, process.id);
  return next;
}
