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

/**
 * Where a thing comes from, which is not the same as what it is.
 *
 * The reader gets to say which of these they are willing to go and get, the
 * way they already say which kinds of reaction are allowed. Refusing a source
 * is a real question about a factory -- a deposit runs out and a kelp bed does
 * not -- and it is the difference between the Columbite plan buying acid and
 * hydroxide, and the same plan going off to dig up a Fluorite Deposit and
 * twenty-four Lepidolite because digging was cheaper.
 *
 * Sparr's five, in his words:
 *
 * - `world`   there is a fixed amount when the map is made and no more ever:
 *             deposits, the stone in the ground, and the ore you dig out of
 *             them.
 * - `weather` spawns for ever on its own: rain, snow, seawater off the source
 *             pixels, andesitic lava.
 * - `air`     a machine with no moving parts makes it for ever: the gases that
 *             condense out of empty space when you cool it.
 * - `farm`    a machine process makes it for ever: everything grown or bred.
 * - `made`    everything else, which is to say the things you are meant to
 *             make rather than find -- most pure elements and their compounds.
 */
export const SOURCES = ['world', 'weather', 'air', 'farm', 'made'];

/**
 * What a plan will go and get unless told otherwise.
 *
 * What the world hands over, and nothing else. Sparr: growing things off by
 * default -- a plan that answers "where will the carbon come from" with a
 * mushroom or a raw hamburger is a plan about foraging, and the reader asking
 * how to make silicon out of ore did not ask about foraging. Refused, the same
 * plans go and find a carbonate instead, which is the answer that was wanted.
 *
 * Manufactured goods are off for a different reason: they are what you are
 * meant to be making, and switching them on costs a great deal of time. A plan
 * that needs them says so.
 *
 * When a search comes back with nothing, the thing to show the reader is this
 * list and the offer to widen it.
 */
export const DEFAULT_SOURCES = ['world', 'weather', 'air'];

/**
 * Two of the five cannot be read off the data and are written down here.
 *
 * `FALLS_FROM_SKY` in `plan-graph` knows about the rain and the snow because
 * somebody read the simulation's weather branch; nothing anywhere says which
 * gases a cold box pulls out of empty air, or that seawater comes off source
 * pixels. Until it does, these are lists, and they are lists Sparr will want
 * to correct.
 */
const WEATHER_SEEDS = ['Water', 'Falling Snow', 'Snow', 'Seawater', 'Andesitic Lava'];

/**
 * And whatever those are when they are hotter or colder.
 *
 * If the sky keeps handing you water then it keeps handing you ice and steam,
 * which are the same substance at a different temperature; the same goes for
 * andesitic lava and the andesite it sets into. Naming only the seeds and
 * following the phase links from them means the list stays short and stays
 * right when it is corrected.
 */
const weatherCache = new WeakMap();
function weatherSet(graph) {
  let out = weatherCache.get(graph);
  if (out) return out;
  out = new Set();
  const walk = (name) => {
    if (!name || out.has(name)) return;
    out.add(name);
    const raw = graph.db.byName.get(name)?.raw;
    walk(raw?.Evaporation?.TargetMaterialName);
    walk(raw?.Condensation?.TargetMaterialName);
  };
  for (const seed of WEATHER_SEEDS) walk(seed);
  weatherCache.set(graph, out);
  return out;
}
const FROM_AIR = new Set(['Breathable Air', 'Nitrogen', 'Oxygen', 'Hydrogen',
                          'Radon', 'Neon (Fading)', 'Neon (Glowing)']);

/**
 * Things that grew or were bred and are filed as neither.
 *
 * The category data has `Hamburger (Raw)` and `Cow Manure` down as "other" and
 * nothing else to go on -- no recipe, no mine, nothing to follow -- so they
 * came out as things you are meant to manufacture. Excluding what grows then
 * left a plan buying a raw hamburger for its carbon. A short list, and one to
 * correct rather than to be proud of.
 */
const GREW = new Set(['Hamburger (Raw)', 'Cow Manure', 'Compost', 'Compost (Burning)']);

/**
 * Which of the five a material comes from.
 *
 * Follow the mine, because the category of a thing you dug up describes the
 * thing and not the digging. `Lepidolite` is filed as a compound and comes out
 * of a Lepidolite Deposit and nowhere else -- seventy-nine materials are in
 * that position, and they are the ores, which is most of what "there is a
 * fixed amount of it" is about. In the other direction `Pneumatocyst` is filed
 * as a deposit and is mined off a Kelp Stalk End, so it grows back and the
 * filing is wrong about the only thing that matters here.
 */
export function sourceOf(graph, name, seen = new Set()) {
  if (weatherSet(graph).has(name) || graph.fallsFromSky(name)) return 'weather';
  if (FROM_AIR.has(name)) return 'air';

  // What a thing *is* settles it when the thing is alive. A Fallen Leaf is
  // filed as biological and mined off a Berry Bush Leaves, which is filed as a
  // deposit -- follow the mine first and the leaf comes back as something the
  // world made once and will not make again.
  const own = graph.categoryOf(name);
  if (own === 'plant' || own === 'biological' || GREW.has(name)) return 'farm';

  /**
   * And a thing you mine a living thing off is part of the living thing.
   *
   * `Berry Bush Berry 2_1` is filed as a deposit and is what a Fallen Leaf is
   * mined from, so following the mine backward -- which is how `Pneumatocyst`
   * gets sorted -- finds nothing, there being nothing upstream of a bush. It
   * has to be read forward instead: what comes off it grew, so it grew.
   */
  for (const p of graph.consumers(name)) {
    if (p.kind !== 'mine') continue;
    for (const o of p.produces) {
      const made = graph.categoryOf(o.name);
      if (made === 'plant' || made === 'biological' || GREW.has(o.name)) return 'farm';
    }
  }

  if (!seen.has(name)) {
    seen.add(name);
    for (const p of graph.producers(name)) {
      if (p.kind !== 'mine') continue;
      for (const c of p.consumes) {
        const from = sourceOf(graph, c.name, seen);
        if (from !== 'made') return from;
      }
    }
  }

  if (own === 'deposit' || own === 'terrain') return 'world';
  return 'made';
}

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
/**
 * Never buy the answer, nor anything the answer is hiding inside.
 *
 * Sparr: never fetch something whose composition is a superset of a target.
 * Asked for Niobium, a plan may not go and get Niobium Pentoxide and call the
 * reduction a factory -- and the same for the metal itself, which is the
 * degenerate case the rest of this was tripping over. It is the one thing the
 * source categories cannot say, because "you are meant to make this" and "this
 * is the thing you asked me to make" are both `made`.
 */
/**
 * The elements a material is made of, with the game's spelling repaired.
 *
 * Eight formulas write fluorine as `Fl`, which is Flerovium: Magnesium
 * Fluoride is `MgFl2`. Thirty-one others write `F`. Sparr has reported it; in
 * the meantime both rules below read compositions, and without this they read
 * those eight as containing an element nobody has ever seen and not the one
 * they plainly do.
 */
const MISSPELT = new Map([['Fl', 'F']]);
function elementsIn(graph, name) {
  const raw = composition(graph).get(name)?.elements;
  if (!raw) return null;
  let fixed = null;
  for (const el of raw) if (MISSPELT.has(el)) { fixed ??= new Set(raw); fixed.delete(el); fixed.add(MISSPELT.get(el)); }
  return fixed || raw;
}

function holdsATarget(graph, name, targets) {
  if (!targets || !targets.length) return false;
  const has = elementsIn(graph, name);
  if (!has) return false;
  for (const wanted of targets) {
    let all = true;
    for (const el of wanted) if (!has.has(el)) { all = false; break; }
    if (all) return true;
  }
  return false;
}

/**
 * Nor anything you could have got out of what you already have.
 *
 * Sparr: never fetch something whose composition is a subset of an input. Holding Lepidolite is holding potassium, lithium, aluminium,
 * silicon, oxygen, hydrogen and fluorine, so going out for water or silica is
 * going out for something already in the yard. It does not touch a carbon
 * source, because there is no carbon in Lepidolite -- which is the point.
 */
function alreadyInHand(graph, name, held) {
  if (!held || !held.length) return false;
  const has = elementsIn(graph, name);
  if (!has || !has.size) return false;
  for (const stock of held) {
    let inside = true;
    for (const el of has) if (!stock.has(el)) { inside = false; break; }
    if (inside) return true;
  }
  return false;
}

export function fetchable(graph, name, kinds, sources = null, spec = null) {
  if (placed(graph, name)) return false;
  if (sources && !sources.has(sourceOf(graph, name))) return false;

  /**
   * The sky does not care whether you also know how to boil water.
   *
   * Having a recipe is what usually disqualifies a fetch, and that reasoning
   * does not apply to rain, or to seawater off a source pixel, or to nitrogen
   * out of a cold box. Seawater has seven recipes and Steam has more than a
   * hundred, and both were being refused as though they had to be built.
   *
   * Lifting it once made every plan worse and I put it back; Sparr's answer is
   * that being freely available is not the same as being free, and the
   * priorities are what should say so -- any amount of fetching is worse than
   * more steps or a poorer ratio. If a plan still reaches for the tap when the
   * shopping list is the first thing counted, the fault is in the counting.
   */
  /**
   * The sky does not care whether you can also boil water.
   *
   * Having a recipe is what usually disqualifies a fetch -- a thing you can
   * make is a thing you are meant to make -- and that reasoning does not reach
   * the rain, or seawater off a source pixel, or nitrogen out of a cold box.
   * Seawater has seven recipes and Steam more than a hundred, and both were
   * being refused as though the weather had to be built.
   *
   * Sparr: all nine belong in the infinitely fetchable set, even though some
   * of them can also be made. Being freely available is not the same as being
   * free -- the priorities count every unit bought, so a plan reaching for the
   * tap loses on the first question asked, which is where it should lose.
   */
  const from = sourceOf(graph, name);
  if (from === 'weather' || from === 'air') return true;
  if (graph.fallsFromSky(name)) return true;
  if (WORLDLY.has(graph.categoryOf(name))) return true;
  if (graph.isManufactured(name)) return false;

  /**
   * A thing with a recipe can be bought, but only if the reader asks for it.
   *
   * Having a recipe usually ends the question -- you can make it, so make it
   * -- and for most plans that is right and also fast, because it keeps the
   * supply columns down to what the world actually hands over. Turning it on
   * everywhere gives several hundred intermediates a column each, and the
   * Lepidolite plan went from under two seconds to not finishing in four
   * minutes.
   *
   * So it is off unless asked for. Columbite with its mines refused needs the
   * four Hydrofluoric Acid and four Potassium Hydroxide its ideal names, and
   * both have recipes; that plan asks, and pays the time. Lepidolite does not
   * need to and does not.
   *
   * Buying the answer outright is stopped elsewhere: nothing whose elements
   * cover a target gets a supply column, so a plan for Niobium cannot fetch
   * Niobium, nor Niobium Pentoxide, nor Columbite.
   */
  if (sources && sources.has('made')) return true;
  return !graph.producers(name).some((p) => kinds.has(p.kind));
}

/** A process's inputs: what it spends, and what it needs standing by. */
const inputsOf = (p) => [...p.consumes, ...p.requires];

/**
 * Atoms of one element in one unit, where the formula can be counted.
 *
 * `null` means the question cannot be answered -- no formula, an unknown
 * symbol, or a slot that is one thing or another like `Fe(Ta,Nb)2O6`.
 */
function atomsIn(graph, name, element) {
  const ast = graph.db.byName.get(name)?.formula?.ast;
  if (!ast) return null;
  let total = 0;
  let ok = true;
  const walk = (items, times) => {
    for (const node of items) {
      if (!ok) return;
      if (node.k === 'el') { if (node.sym === element) total += node.n * times; }
      else if (node.k === 'group') {
        if (node.branches.length !== 1) { ok = false; return; }
        walk(node.branches[0], times * node.n);
      } else if (node.k === 'unknown') { ok = false; return; }
    }
  };
  walk(ast, 1);
  return ok ? total : null;
}

/**
 * Two recipes that between them make an element out of nothing.
 *
 * Run the first once and the second as many times as it takes to use up what
 * the first made of the material they share, and see what is left. Anything
 * that cancels does not need a formula -- which is the only reason this can be
 * asked at all, since `Molten Steel` has none. Carburising three Molten Iron
 * with one Carbon and then burning all three back to Molten Iron leaves one
 * Carbon and three Oxygen Gas going in and three Carbon Dioxide coming out:
 * one carbon atom in and three out.
 */
function mintsElement(graph, a, b, element) {
  if (!a || !b) return false;
  const shared = a.produces.find((o) => b.consumes.some((c) => c.name === o.name));
  if (!shared) return false;
  const per = b.consumes.find((c) => c.name === shared.name).count;
  const times = shared.count / per;

  const net = new Map();
  const add = (name, n) => net.set(name, (net.get(name) || 0) + n);
  for (const o of a.produces) add(o.name, o.count);
  for (const c of inputsOf(a)) add(c.name, -c.count);
  for (const o of b.produces) add(o.name, o.count * times);
  for (const c of inputsOf(b)) add(c.name, -c.count * times);

  let made = 0;
  for (const [name, n] of net) {
    if (!n) continue;
    const atoms = atomsIn(graph, name, element);
    if (atoms === null) return false;      // cannot say, so do not claim
    made += atoms * n;
  }
  return made > 0;
}

/**
 * Recipes the game has wrong, and the check that says so.
 *
 * Excluding a recipe because it is a bug is a thing to do carefully and to
 * undo automatically. Each of these names a pair and the element it mints, and
 * the pair is measured against the data every time the graph is built: if the
 * arithmetic stops minting -- because the recipe was fixed -- the exclusion
 * lifts itself and nobody has to remember it was here.
 *
 * Sparr, on the steel: one-off the carburising recipe as a known error, and do
 * not allow both directions of steel to iron in the same plan. Given free
 * oxygen it is the cheapest carbon in the game, and the Lepidolite plan was
 * built on it -- eighteen Carbon in and fifty-four out, and a shopping list of
 * nothing.
 */
const KNOWN_BUGS = [
  { drop: 'rx:Steel Alloy', with: 'rx:Molten Steel + Oxygen Gas', mints: 'C' },
];

/**
 * Bugs that cannot be measured, and are excluded anyway.
 *
 * Sparr asked for these one-off, and they are the ones the gate above has to
 * decline: something in the cycle has no formula and does not cancel, so
 * nothing can count the element and nothing will ever be able to say the bug
 * is fixed. They are listed apart from the gated ones so that the difference
 * stays visible -- these want revisiting by hand, and nobody will be told when.
 *
 * `2 Potassium + 2 Water -> 2 Aqueous Potassium Hydroxide + 1 Hydrogen Gas`
 * is balanced chemistry written about the wrong material. Two potassium and
 * two water do give two potassium hydroxide and a hydrogen -- but the game
 * writes the product as the *aqueous* form, which it defines elsewhere as one
 * Potassium Hydroxide and one Water. Evaporate them again and two water come
 * out that never went in, along with the hydrogen.
 *
 * Which is where the Carbon Monoxide plan was getting hydrogen from. Its feed
 * is carbon monoxide and it buys nothing, so there was no hydrogen in the
 * question at all, and it was leaving two Steam.
 *
 * The sibling route `rx:Electrolysis of Aqueous Potassium Chloride` says the
 * same thing correctly -- aqueous in and aqueous out, and the water balances
 * -- so this is one recipe being careless rather than a modelling choice.
 *
 * It cannot be gated: `Potassium Hydroxide` has no formula, and unlike the
 * steel it does not cancel out of the cycle, so there is no counting the
 * hydrogen either side.
 */
const ALWAYS_DROP = new Set([
  'rx:Potassium + Water',

  /**
   * Dissolving andesite makes hydrogen out of nothing, and the steam it
   * becomes is four times the water that went in.
   *
   * `2 Andesite + 3 Sulfuric Acid + 3 Water -> 1 Sodium Sulfate + 1 Aluminum
   * Sulfate + 6 Orthosilicic Acid`. Andesite is `NaAlSi3O8` and carries no
   * hydrogen, so twelve hydrogen go in and twenty-four come out; the sulfur
   * goes three in and four out. Decomposing the orthosilicic acid afterwards
   * is honest -- `H4SiO4 -> SiO2 + 2 H2O` is exactly right -- which is what
   * turns the invented hydrogen into steam.
   *
   * That is why the Columbite plan bought four Andesite: not as a complicated
   * way of boiling water, but because three water came back as twelve steam
   * and `evap:Water` only gives one for one.
   *
   * The hydrochloric version does the same thing more modestly, ten hydrogen
   * in and twelve out, so barring only the first would move the plan onto the
   * second. The granite and sodium silicate reactions of the same shape all
   * balance, so this is two recipes being wrong rather than a way of writing
   * silicates.
   *
   * Neither can be gated: `Sulfuric Acid` has no formula and does not cancel,
   * so nothing can count the hydrogen going in.
   */
  'rx:Sulfuric Acid + Andesite',
  'rx:Hydrochloric Acid + Andesite',
]);

const buggyCache = new WeakMap();

/**
 * Which listed bugs are live, and which could not be judged at all.
 *
 * A gate that cannot answer must say so. `rx:Potassium + Water` writes its
 * product as Aqueous Potassium Hydroxide where it means the dry sort, so
 * evaporating it hands back water that never went in -- but `Potassium
 * Hydroxide` has no formula, and unlike the steel it does not cancel out of
 * the cycle, so there is no counting the hydrogen. Listed, unverifiable, and
 * therefore not applied: the alternative is an exclusion that never expires
 * because nothing can ever tell it to.
 */
function knownBugs(graph) {
  let out = buggyCache.get(graph);
  if (out) return out;
  out = { live: new Set(), unproven: [] };
  for (const bug of KNOWN_BUGS) {
    const a = graph.byId.get(bug.drop);
    const b = graph.byId.get(bug.with);
    if (!a || !b) { out.unproven.push({ ...bug, why: 'no such process' }); continue; }
    if (mintsElement(graph, a, b, bug.mints)) out.live.add(bug.drop);
    else out.unproven.push({ ...bug, why: 'cannot count the ' + bug.mints });
  }
  for (const id of ALWAYS_DROP) out.live.add(id);
  buggyCache.set(graph, out);
  return out;
}

/** What the gate could not judge, for a caller that wants to report it. */
export function unprovenBugs(graph) { return knownBugs(graph).unproven; }

export function subgraph(graph, spec) {
  const kinds = spec.kinds;
  const buggy = knownBugs(graph).live;
  const usable = (p) => kinds.has(p.kind) &&
    !buggy.has(p.id) &&
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
    if (!depth.has(i.name) && fetchable(graph, i.name, kinds, spec.sources, spec)) depth.set(i.name, 0);
  }
  for (const t of spec.targets) {
    if (!depth.has(t.name) && fetchable(graph, t.name, kinds, spec.sources, spec)) depth.set(t.name, 0);
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
    .filter((i) => !spec.have.has(i.name) &&
                   fetchable(graph, i.name, kinds, spec.sources, spec)).length;

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
      if (spec.have.has(name) || fetchable(graph, name, kinds, spec.sources, spec)) continue;
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
          if (spec.have.has(i.name) || fetchable(graph, i.name, kinds, spec.sources, spec)) continue;
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
    /** Which sorts of thing the reader will go and get. All of them, unless said. */
    sources: new Set(spec.sources || DEFAULT_SOURCES),
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
  /**
   * A rule about what may be bought is not a rule about what exists.
   *
   * Both of these were tried inside `fetchable` and it made the Lepidolite
   * plan impossible -- nothing could be made at all. `fetchable` is also how
   * the candidate walk decides where a chain bottoms out, so refusing forty-
   * three materials there did not make them unbuyable, it deleted the ground
   * from under the routes that ended on them. Here, where the shopping list is
   * actually decided, refusing one means only that: no column to buy it with,
   * and the plan must make it or do without.
   */
  const supply = new Map();
  let next = procs.length;
  for (const name of materials) {
    if (spec.have.has(name)) { supply.set(name, next++); continue; }
    if (!fetchable(graph, name, spec.kinds, spec.sources, spec)) continue;
    if (holdsATarget(graph, name, spec.wanted)) continue;
    if (alreadyInHand(graph, name, spec.held)) continue;
    supply.set(name, next++);
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
  const constrained = new Set();
  for (const name of materials) {
    const coeffs = net.get(name);
    if (!coeffs || !coeffs.size) continue;
    constrained.add(name);
    rows.push({ coeffs, op: '>=', rhs: demand.get(name) || R0 });
  }
  if (!rows.length) return null;

  /**
   * A demand nothing can touch is not a demand the solver will notice.
   *
   * Rows are built per material, and a material that no process here produces
   * or consumes gets none -- there would be nothing in it. That is fine for
   * some bystander material and quietly disastrous for a target: with no row
   * saying "make at least two Potassium", the solver is not ignoring the
   * constraint, it was never given one, and it says yes to a plan that makes
   * none.
   *
   * It happens when the conservation pass has barred enough processes that the
   * last route to a target is gone. The answer that came back had ninety-four
   * runs of the alumina branch and no potassium at all, and every check
   * downstream believed it.
   */
  for (const t of spec.targets) {
    if (!constrained.has(t.name) && !spec.have.has(t.name)) return null;
  }

  const prices = fetchPrices(graph, spec.kinds);
  const fetchCost = new Map();
  for (const [name, i] of supply) {
    if (!bought(name)) continue;
    const each = prices.get(name) ?? 1;
    fetchCost.set(i, rat(Math.round(each * 64), 64n));
  }
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

  /**
   * Shortlist on both questions, not just the first.
   *
   * The shortlist was picked by minimising the shopping list alone, and the
   * second question -- how much goes in at all -- was then asked only of what
   * that pass happened to choose. Where two routes both buy nothing the first
   * question cannot separate them, so it takes whichever vertex it lands on,
   * and the better one is not on the table when it matters.
   *
   * That is how the combined factory came to manufacture its water. Condensing
   * the steam it was already making costs nothing and buys nothing; so does
   * dissolving glass, and so does running a lithium chain and binning four
   * hundred Molten Lithium. All three fetch nothing, the first pass shrugged,
   * and `cond:Steam` -- which was in the candidate set the whole time -- never
   * reached the solver that would have preferred it.
   *
   * So the same walk is made a second time with the shopping list held where
   * the first left it and the input counted instead, and both supports are
   * kept. It costs one more float solve, which is tens of milliseconds.
   */
  const total = [...model.supply]
    .filter(([name]) => model.bought(name))
    .reduce((a, [, i]) => a + answer.x[i], 0);
  const cap = {
    coeffs: new Map([...model.supply]
      .filter(([name]) => model.bought(name))
      .map(([, i]) => [i, 1])),
    op: '<=',
    rhs: total + 1e-6,
  };
  const drawn = new Map([...model.supply].map(([, i]) => [i, 1]));
  const second = solveLPFloat({ vars: model.vars, rows: [...rows, cap], cost: drawn });

  const chosen = new Set();
  for (const p of sub.processes) {
    const i = model.index.get(p.id);
    if (answer.x[i] > 0) chosen.add(p.id);
    if (second.ok && second.x[i] > 0) chosen.add(p.id);
  }
  const keep = sub.processes.filter((p) => chosen.has(p.id));
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

/**
 * What a fetch really costs, in things the world actually hands over.
 *
 * Sparr: every way to make Silicon Tetrafluoride takes four Hydrofluoric Acid,
 * so buying one is buying four and doing a step, and the shopping list that
 * called it one unit was flattering it fourfold. The only way to Aqueous
 * Potash is Water and Potash together, so buying it is buying both and is
 * slightly worse than buying them, not better.
 *
 * So a material the world gives you -- mined, weather, air, grown -- is worth
 * one, because that is what going and getting it costs. Anything else is
 * priced at what its cheapest recipe would have cost you, plus a little for
 * the step, and that is what the shopping list counts.
 *
 * Worked out once per graph by walking down from each material to the things
 * that are simply had. A recipe that leads back to itself is no help pricing
 * itself, so a cycle prices as unreachable and some other route is taken.
 */
const STEP_PRICE = 1 / 64;

const priceCache = new WeakMap();
export function fetchPrices(graph, kinds) {
  let table = priceCache.get(graph);
  if (table) return table;
  table = new Map();
  const busy = new Set();

  /**
   * What every route to it must spend, and nothing more.
   *
   * Sparr: only where every way of making the thing has something in common.
   * Where there are several routes with nothing shared between them, that
   * choice is worth having and this should keep out of it -- a material with
   * options is genuinely easier to come by than one with a single recipe, and
   * pricing it as though it were the cheapest of them would be pretending to
   * know which the reader will use.
   *
   * So: the common inputs, at the smallest count any route needs, plus a
   * little for the step. Silicon Tetrafluoride is made four ways and all four
   * want four Hydrofluoric Acid, so it costs four of them and a step, and the
   * shopping list stops flattering it. Aqueous Potash has one recipe -- Water
   * and Potash -- so it costs both, which is slightly worse than buying the
   * two, and it should be.
   */
  const price = (name) => {
    if (table.has(name)) return table.get(name);
    if (busy.has(name)) return Infinity;
    if (sourceOf(graph, name) !== 'made') { table.set(name, 1); return 1; }

    const makers = graph.producers(name).filter((p) => kinds.has(p.kind));
    if (!makers.length) { table.set(name, 1); return 1; }

    /**
     * Phase changes are not alternatives to each other.
     *
     * Liquid Hydrogen is made two ways -- four Hydrogen Gas condensed, or four
     * Hydrogen Gas (Burning) condensed -- and they have no input in common,
     * one taking hydrogen and the other taking hydrogen that happens to be
     * alight. So the rule above saw a material with choices, left it at one,
     * and the Columbite plan bought four hydrogen for the price of one. The
     * same trick as Silicon Tetrafluoride, through a door I left open.
     *
     * Cooling something is not a route to it, it is the thing at a different
     * temperature, and two ways to cool the same substance are one way. So
     * where nothing but phase changes make a material, take the cheapest of
     * them and skip the question of what they share.
     */
    if (makers.every((p) => p.kind === 'phase')) {
      busy.add(name);
      let best = Infinity;
      for (const p of makers) {
        const out = p.produces.find((o) => o.name === name)?.count || 1;
        let sum = STEP_PRICE;
        for (const i of inputsOf(p)) {
          const each = price(i.name);
          if (!Number.isFinite(each)) { sum = Infinity; break; }
          sum += each * i.count;
        }
        if (sum / out < best) best = sum / out;
      }
      busy.delete(name);
      const answer = Number.isFinite(best) ? Math.max(best, 1) : 1;
      table.set(name, answer);
      return answer;
    }

    // Only what appears in every one of them, at the least any of them needs.
    const shared = new Map();
    for (const i of inputsOf(makers[0])) {
      const out = makers[0].produces.find((o) => o.name === name)?.count || 1;
      shared.set(i.name, i.count / out);
    }
    for (const p of makers.slice(1)) {
      const out = p.produces.find((o) => o.name === name)?.count || 1;
      const here = new Map(inputsOf(p).map((i) => [i.name, i.count / out]));
      for (const [n, per] of [...shared]) {
        if (!here.has(n)) shared.delete(n);
        else shared.set(n, Math.min(per, here.get(n)));
      }
    }
    if (!shared.size) { table.set(name, 1); return 1; }

    busy.add(name);
    let sum = STEP_PRICE;
    for (const [n, per] of shared) {
      const each = price(n);
      if (!Number.isFinite(each)) { sum = Infinity; break; }
      sum += each * per;
    }
    busy.delete(name);

    const answer = Number.isFinite(sum) ? Math.max(sum, 1) : 1;
    table.set(name, answer);
    return answer;
  };

  for (const m of graph.db.materials) price(m.name);
  priceCache.set(graph, table);
  return table;
}

/** The element sets the two composition rules compare against. */
function withElements(graph, spec) {
  const table = composition(graph);
  const setsOf = (names) => names
    .map((n) => elementsIn(graph, n))
    .filter((e) => e && e.size);
  return { ...spec,
           wanted: setsOf(spec.targets.map((t) => t.name)),
           held: setsOf([...spec.have]) };
}

/**
 * Does it actually make the things it was asked for.
 *
 * It should not be possible to fail this: every target carries a row saying
 * its net production is at least the demand, and the solver reports whether it
 * satisfied its rows. It failed anyway -- asked for two Potassium among four
 * metals the answer came back with none at all, ninety-four runs of the
 * aluminium branch, fifty-two Aluminum against the four wanted, and not one
 * step that makes potassium. The row was there, the producers were in the
 * candidate set, and the solve said yes.
 *
 * So the answer is read back rather than trusted. A plan that does not deliver
 * is not a worse plan, it is not a plan, and the caller is told so plainly
 * instead of being handed a shopping list for a factory that makes nothing.
 */
function shortfallOf(plan) {
  const short = [];
  for (const t of plan.spec.targets) {
    const made = plan.madeOf(t.name);
    if (rcmp(made, rat(t.amount)) < 0) short.push({ name: t.name, asked: t.amount, made });
  }
  return short.length ? short : null;
}

export function solveFresh(graph, rawSpec) {
  const barred = new Set(rawSpec.excludeProcesses || []);
  /**
   * The best answer so far, kept because barring a wheel can bar the road.
   *
   * Each round takes out the biggest wheel of a loop that turns for free and
   * asks again. Sometimes the re-ask is impossible -- the barred process was
   * also the only way to a target -- and throwing everything away then meant
   * the Lepidolite plan reported that it could not be made at all, having
   * already found a perfectly good answer two rounds earlier and discarded it.
   */
  let best = null;
  for (let round = 0; round < 8; round++) {
    const plan = planOnce(graph, { ...rawSpec, excludeProcesses: [...barred] });
    if (!plan) return best;
    /**
     * Handed back, not thrown away. Sparr: do not silently discard a bad plan,
     * surface it. A plan that does not deliver is evidence of a bug somewhere
     * upstream, and the one thing it must not do is look like a good answer --
     * so it comes back marked, and every caller that reports a plan reports
     * this first.
     */
    plan.shortfall = shortfallOf(plan);
    if (!plan.shortfall) best = plan;
    const cheat = freeLunch(graph, normalizeFresh(rawSpec), plan);
    if (!cheat) return plan;
    barred.add(cheat);
  }
  return null;
}

function planOnce(graph, rawSpec) {
  const spec = withElements(graph, normalizeFresh(rawSpec));
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
  /**
   * Priced the same way the shopping list is, so the two questions agree.
   *
   * Counting raw units here undid the pricing above. One Aqueous Potash is one
   * unit and the Water and Potash it is made of are two, so this stage
   * preferred the bottled version however honestly the first stage had priced
   * it -- and Sparr's tie-break is the other way round: where a one-step
   * process saves exactly one step, take the simpler and more numerous inputs.
   * Two plain things beat one compound thing that is only those two and a lid.
   *
   * Held stock is one a unit, being had rather than bought.
   */
  const inputCost = new Map();
  for (const [name, i] of supply) {
    inputCost.set(i, bought(name) ? (fetchCost.get(i) ?? rat(1)) : rat(1));
  }

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
    /**
     * Every step is a candidate for dropping, phase changes included.
     *
     * They do not count toward the tally -- freezing water is not a stage of a
     * factory -- but that is a reason not to *count* them, not a reason to keep
     * them. Left out of this, `cond:Oxygen Gas` sat in every plan turning waste
     * oxygen into waste liquid oxygen, costing nothing and helping nothing, and
     * the simplex was free to run it any number of times it liked. It settled
     * on forty-seven fortieths, and since the batch is the lowest common
     * multiple of every denominator, that one idle step made the Columbite plan
     * forty times the size of the order -- which is what made its arithmetic
     * slow, its rationals being forty times bigger than they needed to be.
     */
    const used = procs
      .filter((p) => !banned.has(p.id) && !rzero(best.x[index.get(p.id)]))
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
