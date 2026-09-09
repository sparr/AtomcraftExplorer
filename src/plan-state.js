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
import { SOURCES, DEFAULT_SOURCES as FRESH_SOURCES } from './plan-fresh.js';

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
     * How many ores to try when the plan is starting from nothing.
     *
     * Each one is a whole solve, so this is a budget rather than a preference:
     * asked for something with nothing in hand, the solver may buy one
     * material carrying the answer, and which one is not a thing a rule can
     * name. Six covers every question anyone has put to it; the page says so
     * when it runs out and offers to spend more.
     */
    oreTries: 6,
    excludeProcesses: [],
    excludeMaterials: [],
    /**
     * Materials the reader will not buy, and will not start with.
     *
     * Narrower than `excludeMaterials`, which keeps a material out of the plan
     * altogether: these two let the plan make the thing and spend it, and
     * refuse it only at the door. "Get the fluorine from somewhere else" is a
     * different instruction from "pretend fluorine does not exist", and the
     * first is the one a reader looking at a shopping list usually means.
     *
     * Read by the newer solver only.
     */
    noFetch: [],
    noPrime: [],
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
    /**
     * Which way to settle a draw over what is left on the floor.
     *
     * Sparr: leavings that appear without more going in are the game's
     * conservation errors, and a planner should not go looking for them -- but
     * make it an option either way, and keep it one of the lowest priorities
     * regardless. It is the last thing the newer solver decides, once the
     * steps, the shopping list and the feed are all settled, so it can only
     * choose between answers that are otherwise identical.
     */
    keepLeftovers: false,
    kinds: [...DEFAULT_KINDS],
    /**
     * Which sorts of thing the plan may go and get, for the newer solver.
     *
     * The older one has no notion of these and ignores the setting; the
     * checkboxes are hidden while it is the one answering.
     */
    sources: [...FRESH_SOURCES],
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
export const isEmptyPlan = (p) => !p.targets.length && !p.have.length;

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
  plan.excludeProcesses = list(params.get('x'));
  plan.excludeMaterials = list(params.get('xm'));
  const tries = Number(params.get('ot'));
  if (Number.isFinite(tries) && tries > 0) plan.oreTries = Math.min(Math.round(tries), ORE_TRIES_MAX);
  plan.noFetch = list(params.get('xf'));
  plan.noPrime = list(params.get('xp'));
  plan.kept = list(params.get('kp'));
  if (params.get('lv') === '1') plan.keepLeftovers = true;


  // Written only when it differs from the default, so an old link that predates
  // a new kind still means "the usual set" rather than "everything but that".
  const kinds = params.get('k');
  if (kinds === NO_KINDS) plan.kinds = [];
  else if (kinds) {
    const known = new Set(PROCESS_KINDS.map((k) => k.id));
    plan.kinds = list(kinds).filter((k) => known.has(k));
  }
  const sources = params.get('sr');
  if (sources === NO_KINDS) plan.sources = [];
  else if (sources) {
    const known = new Set(SOURCES);
    plan.sources = list(sources).filter((k) => known.has(k));
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
  put('x', plan.excludeProcesses.join(SEP));
  put('xm', plan.excludeMaterials.join(SEP));
  if (plan.oreTries !== 6) params.set('ot', String(plan.oreTries));
  put('xf', plan.noFetch.join(SEP));
  put('xp', plan.noPrime.join(SEP));
  put('kp', plan.kept.join(SEP));
  if (plan.keepLeftovers) params.set('lv', '1');

  const usual = plan.kinds.length === DEFAULT_KINDS.length &&
                DEFAULT_KINDS.every((k) => plan.kinds.includes(k));
  // `-` rather than nothing, because an absent `k` means the usual set and
  // turning every kind off has to survive a reload as itself.
  if (!usual) params.set('k', plan.kinds.join(SEP) || NO_KINDS);
  const usualSources = plan.sources.length === FRESH_SOURCES.length &&
                       FRESH_SOURCES.every((k) => plan.sources.includes(k));
  if (!usualSources) params.set('sr', plan.sources.join(SEP) || NO_KINDS);
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
  excludeProcesses: [...p.excludeProcesses],
  excludeMaterials: [...p.excludeMaterials],
  noFetch: [...p.noFetch],
  noPrime: [...p.noPrime],
  kept: [...p.kept],
  kinds: [...p.kinds],
});

/**
 * Past this it is not a budget any more.
 *
 * The longest candidate list in the game is twenty-two, so anything above that
 * is "try them all" spelled at length, and a number typed into a box should
 * not be able to ask for a thousand solves.
 */
export const ORE_TRIES_MAX = 32;

const drop = (arr, value) => arr.filter((x) => x !== value);

/**
 * Several at once, for a picker that offers a whole set.
 *
 * The elements of what you hold are chosen together or not at all -- asking
 * for potassium and lithium out of the same ore is one decision, and making
 * it one press at a time re-plans between each, which is both slow and a
 * different question every time.
 */
export function addTargets(plan, names) {
  return names.reduce((p, n) => addTarget(p, n), plan);
}

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

/** Is this byproduct being plumbed back into the plan? */
/**
 * Leave a material on its loop and lay some in, rather than making it.
 *
 * The other side of the default. A charge is put in once and never spent, so
 * where the alternative is a step running for the life of the factory it may
 * well be the better bargain -- and only the reader knows which.
 */

/** And back: make it outright rather than taking it off the loop. */

/** Has the reader pinned this one to being primed? */

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
 * Naming something you have takes it off the list of things to make.
 *
 * The second argument used to say whether you could get as much of it as the
 * plan turned out to need -- true where the reader waved a line of the
 * shopping list away, false for the have box, where naming a material is
 * stating your stock. Everything you hold is finite now, that distinction
 * having belonged to the solver that is gone, and callers still pass the flag
 * because it reads as what they mean.
 */
export function addHave(plan, name, _plenty = false) {
  const next = clone(plan);
  if (!next.have.includes(name)) next.have.push(name);
  next.targets = next.targets.filter((t) => t.name !== name);
  return next;
}

export function removeHave(plan, name) {
  const next = clone(plan);
  next.have = drop(next.have, name);
  return next;
}


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

export function toggleSource(plan, id) {
  const next = clone(plan);
  next.sources = next.sources.includes(id) ? drop(next.sources, id) : [...next.sources, id];
  return next;
}

export function setOption(plan, key, value) {
  return { ...clone(plan), [key]: value };
}

/**
 * Seed a plan from a reaction the reader picked out in the explorer: make what
 * it makes.
 *
 * It used to hold the plan to that reaction as well, by pinning each product
 * to it. Pins went with the solver that read them, so this asks for the
 * products and leaves the route to the planner -- which is the honest version
 * of the same press, and the button says so.
 */
export function planProcess(plan, process) {
  let next = plan;
  for (const { name } of process.produces) next = addTarget(next, name);
  return next;
}
