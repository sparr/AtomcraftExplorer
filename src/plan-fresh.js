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
import { DEFAULT_KINDS, PROCESS_KINDS, operatingWindow, reactorsIn } from './plan-graph.js';
import { listed } from './prose.js';
import { composition, elementsOf } from './composition.js';
import { heatingNeed, coolingNeed } from './units.js';
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
 * The five, with something a reader can tick.
 *
 * Sparr's own division, in his words: what the world was made holding, what it
 * keeps making, what a machine with no moving parts can condense, what can be
 * grown or bred, and everything else -- which is most of the pure elements and
 * their compounds, and the only one that is properly a cost.
 */
export const SOURCE_KINDS = [
  { id: 'world', glyph: '\u26cf', label: 'Dug up',
    hint: 'There when the world was made and no more of it: deposits, ores, standing stone.' },
  { id: 'weather', glyph: '\u2614', label: 'Falls from the sky',
    hint: 'Made again for ever: rain, snow, seawater off a source pixel.' },
  { id: 'air', glyph: '\u{1f4a8}', label: 'Out of the air',
    hint: 'Condensed from empty space by cooling it, so a box with no moving parts will do.' },
  { id: 'farm', glyph: '\u{1f331}', label: 'Grown',
    hint: 'Plant and animal products, which come back if you wait.' },
  { id: 'made', glyph: '\u2699', label: 'Manufactured',
    hint: 'Everything else, most pure elements among it. Turning this on lets the plan ' +
          'buy a thing it could have built, which is sometimes the cheaper answer.' },
];

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
export const DEFAULT_SOURCES = ['world', 'weather', 'air', 'made'];

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
const sourceCache = new WeakMap();
export function sourceOf(graph, name, seen = new Set(), followPhase = true) {
  // Memoised on the top-level question only: a nested call carries a `seen`
  // set and its answer is conditional on that walk, not on the material.
  let cache = null;
  if (!seen.size && followPhase) {
    cache = sourceCache.get(graph);
    if (!cache) sourceCache.set(graph, (cache = new Map()));
    const hit = cache.get(name);
    if (hit) return hit;
  }
  const answer = sourceUncached(graph, name, seen, followPhase);
  if (cache) cache.set(name, answer);
  return answer;
}

function sourceUncached(graph, name, seen, followPhase) {
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

  /**
   * Follow the mine backward, even where that is arguably too eager.
   *
   * Carbon is filed as an element, made by half the reactions in the game, and
   * also minable off a Mite -- so following the mine makes elemental carbon a
   * farm product, which is wrong. Narrowing the rule to materials whose every
   * route is a mine or a phase change fixes the label and moves a few hundred
   * materials from `farm` to `made`, and any plan permitted to buy
   * manufactured goods then has eight hundred and sixty-one columns to
   * consider instead of six hundred. The doubles cannot settle that, the
   * fallback cannot grind it, and the combined factory went from a plan in
   * under a second to no plan at all.
   *
   * It also changed nothing that anyone would see: carbon is behind a switch
   * either way, off as a farm product and off as a manufactured one, and the
   * Lepidolite plan buys Limestone in both worlds. A better label for a worse
   * planner is a bad trade, so the eager rule stays until the float pass can
   * carry the wider question.
   */
  /**
   * An element is what it is, whatever you dug some of it out of.
   *
   * Carbon is minable off a Mite (Fed) and a Mite (Hungry), and following the
   * mine backward made elemental carbon a farm product -- so a plan that had
   * switched off growing things could not buy carbon as carbon at any price,
   * and the Lepidolite plan bought Limestone because that was the only carbon
   * left standing. Sparr: being able to supply carbon matters, so excluding it
   * is not the answer.
   *
   * The wider version of this rule -- ignore the mine wherever a reaction can
   * make the thing -- is correct and far too expensive: it moves a few hundred
   * materials into `made`, and a plan allowed to buy manufactured goods then
   * has more columns than the doubles can settle. This is the same idea at the
   * width the evidence supports. Twenty-one materials are pulled into `farm`
   * by their mines, and exactly one of them is an element.
   *
   * Carbon Dioxide is filed as a compound and lands in `farm` the same way,
   * which is just as wrong and does not matter yet: no plan here buys it.
   */
  if (own !== 'element' && !seen.has(name)) {
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

  /**
   * Follow the melt as well as the mine.
   *
   * `Calcium Fluoride` is terrain and so `world`; `Molten Calcium Fluoride` is
   * the same mineral one phase change away, filed as a compound, and so came
   * back `made`. The columbite plan is told to use no mined things, and bought
   * forty-eight of the melt and froze them -- one `cond:` step, and the ban
   * walked around. Forty-seven phase pairs disagree like this, among them
   * Alumina, Columbite and Chromite.
   *
   * Melting is free and reversible, so the scarcer end of the pair governs
   * both: if you can only get the solid by digging, the liquid is dug too.
   */
  /**
   * One hop, and not for an element. Following the melt as far as it goes made
   * Molten Copper `world` and copper with it, and an element is `made` however
   * you came by it -- Sparr's categories put the pure elements there by name.
   * What this is for is narrower: the melt of something you had to dig.
   */
  if (followPhase && own !== 'element') {
    const dug = (n) => sourceOf(graph, n, new Set(), false) === 'world';
    for (const p of graph.producers(name)) {
      if (p.kind !== 'phase') continue;
      for (const c of p.consumes) if (dug(c.name)) return 'world';
    }
    for (const p of graph.consumers(name)) {
      if (p.kind !== 'phase') continue;
      for (const o of p.produces) if (dug(o.name)) return 'world';
    }
  }

  return 'made';
}

/** Static and not worldly: it exists only where somebody placed it. */
const placed = (graph, name) =>
  graph.stateOf(name) === 'Static' && !WORLDLY.has(graph.categoryOf(name));

/**
 * The ground itself, which nobody placed and nobody can carry.
 *
 * Sparr: deposits are never inputs, they cannot be fetched. A deposit is a
 * tile of the world. What travels is what the mine hands back -- the Columbite
 * Deposit stays where it is and `Columbite` goes in the sack -- so a plan may
 * ask for the ore and may never ask for the ground it came out of.
 *
 * `placed` will not say this, and should not: it means "somebody put this
 * here", which is true of a wall and false of a hematite seam. `WORLDLY`
 * exempts deposits from it precisely because the world does hand them over --
 * through the mine, and only through the mine.
 *
 * Static as well as the category, because two things filed under `deposit` are
 * not landscape at all: Galena Gravel and Pneumatocyst are Solid, loose, and
 * fetchable like any other ore.
 */
const landscape = (graph, name) =>
  graph.stateOf(name) === 'Static' &&
  (graph.categoryOf(name) === 'deposit' || graph.categoryOf(name) === 'terrain');

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

/**
 * The ban on buying the answer, with the one exception Sparr allowed.
 *
 * Fetching the want atoms is never legitimate -- except that with nothing in
 * hand it is the only way to start. Asked for Boron Oxide holding nothing, the
 * only boron in the game arrives as Borax, and refusing it left the question
 * unanswerable rather than answered honestly. So exactly one material may be
 * let through, chosen before the solve; `spec.oreAllowed` is that choice, and
 * it is empty whenever something held already carries what was asked for.
 */
function barredAsTarget(graph, name, spec) {
  if (spec.oreAllowed?.has(name)) return false;
  return holdsATarget(graph, name, spec.wanted);
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
  if (landscape(graph, name)) return false;
  /**
   * Sparr: refusing a material at the door steers a plan better than refusing
   * a reaction.
   *
   * `excludeMaterials` is the blunt version -- it deletes every step that so
   * much as touches the thing, so a plan cannot make it, use it or see it.
   * This is the narrow one: the material may still be made and spent inside
   * the plan, it just may not be bought. "Get the fluorine from somewhere
   * else" rather than "pretend fluorine does not exist".
   *
   * Answered here rather than at the eight places that ask, so that the
   * candidate walk, the reachability sweep, the shopping columns and the
   * charge all agree without being told separately.
   */
  if (spec?.noFetch?.has(name)) return false;
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
 *
 * Three molten iron and one carbon make three molten steel; each of those
 * three, burnt, gives back a molten iron and a whole carbon dioxide. One carbon
 * in, three out. Barring either direction stops it -- but `Steel Alloy` is the
 * only reaction in the game that makes molten steel at all, so barring that one
 * does not merely break the wheel, it puts steel out of reach: asked for Steel
 * the newer solver had two processes to work with, both of them phase changes
 * between Steel and Molten Steel, and said the shortlist could not fill the
 * order. Barring the burn instead leaves steel makeable out of iron and carbon,
 * which is the direction anyone actually wants, and costs only the ability to
 * decarburise steel back to iron.
 *
 * The pair is still measured both ways round -- `mintsElement` scales the
 * second recipe to eat what the first makes, and the arithmetic nets carbon
 * whichever is named first -- so the exclusion still lifts itself if the game
 * is ever fixed.
 */
const KNOWN_BUGS = [
  { drop: 'rx:Molten Steel + Oxygen Gas', with: 'rx:Steel Alloy', mints: 'C' },
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

/**
 * The same walk, asked for again and again with different numbers on it.
 *
 * Balancing a plan is a few dozen solves that differ only in how much of each
 * target is wanted, and this walk never looks at an amount -- it reads names,
 * kinds, sources and exclusions and nothing else. So forty per cent of the
 * time balancing the Lepidolite question went on deriving the same six hundred
 * processes twenty times over.
 *
 * Keyed on everything it actually reads. Nothing mutates what comes back --
 * the shortlist filters into a new array and builds its own material set --
 * so one answer can be handed to every caller that asks the same question.
 *
 * Bounded, because a page left open asks a great many different questions.
 */
const KEEP_SUBGRAPHS = 24;
const subgraphCache = new WeakMap();

const subgraphKey = (spec) => JSON.stringify([
  [...spec.kinds].sort(),
  [...spec.sources].sort(),
  [...spec.have].sort(),
  spec.targets.map((t) => t.name).sort(),
  [...spec.excludeProcesses].sort(),
  [...spec.excludeMaterials].sort(),
  spec.oreTries,
  /**
   * The knobs, which decide the shape of the walk and were not in this key.
   *
   * Tuning one and asking again returned the walk from before it, so an
   * experiment on `ways` looked like it changed nothing at all -- which is
   * exactly how the Lepidolite decompositions kept their secret: at three ways
   * per material they are pruned, at six they are not, and the measurement
   * that would have shown it was reading a cached answer.
   */
  spec.ways, spec.loops, spec.eaters, spec.reach,
  [...spec.noFetch].sort(),
  [...spec.noPrime].sort(),
  [...(spec.oreAllowed || [])].sort(),
]);

export function subgraph(graph, spec) {
  let store = subgraphCache.get(graph);
  if (!store) subgraphCache.set(graph, store = new Map());
  const key = subgraphKey(spec);
  const had = store.get(key);
  if (had) return had;
  const found = walkSubgraph(graph, spec);
  if (store.size >= KEEP_SUBGRAPHS) store.delete(store.keys().next().value);
  store.set(key, found);
  return found;
}

function walkSubgraph(graph, spec) {
  const kinds = spec.kinds;
  const buggy = knownBugs(graph).live;
  /**
   * A reaction that eats something static is a reaction done on the spot.
   *
   * Sparr: we are not dissolving unmined rocks or the walls of machines. A
   * static material is one that sits where it was put -- a deposit in the
   * ground, a placed wall, a growing plant -- and you cannot carry it to the
   * apparatus, so a recipe that consumes one is not a step in a factory. It is
   * something you go and do to the landscape, and what it hands back is the
   * only part that travels.
   *
   * `placed` already refused the machinery, being static and not worldly. This
   * refuses the rest of it: nineteen deposit decompositions that duplicate the
   * ordinary reaction on the mined ore, and the rock and plant ones besides.
   *
   * Reactions only. Melting is not a reaction and Ice is static, so a blanket
   * rule would take Ice to Water with it; growth eats a standing plant by
   * definition; and mining a deposit is the one thing you are supposed to do
   * to a deposit.
   */
  /**
   * Unless it melts into something you can carry.
   *
   * Sparr: make an exception for anything with a phase change to a non-static
   * material. Being static is only a reason to leave it where it is if it
   * stays that way -- heat a static thing that melts and the melt pours, so
   * the reaction is on a substance the plan can actually hold rather than on
   * the landscape. Ice is the everyday case and the ores that go straight to a
   * melt are the rest of it.
   *
   * Thirteen deposits and four terrains come back this way, and about a
   * hundred machines and sixty projectiles would too -- an oscillator melts
   * into Molten Copper -- except that `placed` refuses those a line further
   * down and goes on refusing them. Melting the machinery is still not a
   * recipe. What stays out is what is truly fixed: sixty-three deposits, the
   * standing plants, and the growing things.
   */
  const meltsOut = (name) => {
    /**
     * Not for the landscape, whatever it melts into.
     *
     * The exception is for a substance that happens to be solid where you
     * found it -- ice, which you melt and pour and then react as water. It is
     * not a way back to the ground itself, and read without this it was: seven
     * reactions came back, five of them the very thing they were meant to
     * stop. `Sulfuric Acid + Fluorite Deposit` is acid on unmined rock, and it
     * qualified because a fluorite deposit melts.
     *
     * What breaks the reasoning is that these recipes name the deposit and not
     * the melt, so being able to melt it buys nothing -- melting a fluorite
     * deposit gives Molten Calcium Fluoride, which is a different input to a
     * different recipe. And every one of the seven has a portable twin doing
     * the same chemistry on the mined mineral: `Sulfuric Acid + Fluorite`
     * against `Sulfuric Acid + Fluorite Deposit`, Limestone Gravel's eight
     * reactions against Limestone's five.
     */
    const cat = graph.categoryOf(name);
    if (cat === 'deposit' || cat === 'terrain') return false;
    const raw = graph.db.byName.get(name)?.raw;
    for (const field of ['Evaporation', 'Condensation']) {
      const to = raw?.[field]?.TargetMaterialName;
      if (to && graph.stateOf(to) !== 'Static') return true;
    }
    return false;
  };

  const staticFeed = (p) => p.kind === 'reaction' &&
    inputsOf(p).some((i) => graph.stateOf(i.name) === 'Static' && !meltsOut(i.name));

  /**
   * And the ground itself, whatever is being done to it.
   *
   * `staticFeed` says "reactions only" on purpose -- a blanket rule would take
   * Ice to Water with it, and growth eats a standing plant by definition. But
   * that left the melt open, and melting is how the landscape got back in: 22
   * phase changes turn unmined rock straight into metal. `evap:Hematite
   * Deposit` gives Molten Iron and `evap:Columbite Deposit` gives Molten
   * Columbite, so a plan told not to buy Lepidolite went shopping for twelve
   * Fluorite Deposits instead -- twelve tiles of the world, delivered.
   *
   * The reasoning `meltsOut` already gives for the reactions is the same one
   * here: melting a fluorite deposit makes molten calcium fluoride *in the
   * ground*. Being able to melt a thing is not a way to carry it.
   *
   * Mining and handling are exempt. They are player actions on a placed thing
   * rather than steps in a factory, and mining a deposit is the one thing a
   * deposit is for -- neither kind runs by default, but the exemption is the
   * rule, not an accident of which kinds are switched on.
   */
  const digsIn = (p) => p.kind !== 'mine' && p.kind !== 'handling' &&
    inputsOf(p).some((i) => landscape(graph, i.name));

  const usable = (p) => kinds.has(p.kind) &&
    !buggy.has(p.id) &&
    !spec.excludeProcesses.has(p.id) &&
    !staticFeed(p) &&
    !digsIn(p) &&
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
  /**
   * Where a chain is allowed to stop.
   *
   * Not "can this be fetched" but "will the model actually sell it", and the
   * two came apart. Turning `made` on makes Silicon fetchable, so the backward
   * walk stopped there and never went looking for what produces it -- while
   * `model` refused it a supply column, Silicon being made of the very element
   * the plan was asked for. Nothing made it and nothing could buy it, so the
   * combined factory had no plan at all, and said so as "the doubles could not
   * settle" eight hundred processes later.
   *
   * The rules that decide the shopping list therefore have to decide where a
   * chain bottoms out too, or the walk removes the ground from under a route
   * the model was counting on. This is the safe direction: everything buyable
   * is fetchable, so consulting it here only ever keeps the walk going.
   */
  const bottomsOut = (name) =>
    fetchable(graph, name, kinds, spec.sources, spec) &&
    !barredAsTarget(graph, name, spec) &&
    !alreadyInHand(graph, name, spec.held);

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
      if (spec.have.has(name) || bottomsOut(name)) continue;
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
    /**
     * And a phase change is offered for anything at all, composition aside.
     *
     * The filter above asks whether a material carries carbon, oxygen or
     * hydrogen, which is the right question about a reaction and the wrong one
     * about cooling something down. Electrolysing Molten Potassium Hydroxide
     * gives Potassium Gas, and Potassium Gas is potassium: no carbon, no
     * oxygen, no hydrogen, so the pass would not follow it, `cond:Potassium
     * Gas` never came in, and Molten Potassium had nothing at all that made
     * it. The electrolysis was then a step into a dead end, and columbite
     * bought its potassium by the unit and its carbon besides, because the
     * loop that would have returned both had a hole in it one cooling wide.
     *
     * The pricing already says this -- cooling something is not a route to it,
     * it is the thing at a different temperature -- and the walk has to agree
     * or it will keep severing loops at their phase changes.
     */
    const recycles = new Set(recyclable);
    let added = 0;
    for (const name of made) {
      const all = graph.consumers(name).filter(usable).filter(reachable);
      const eaters = recycles.has(name) ? all : all.filter((p) => p.kind === 'phase');
      for (const p of eaters) {
        if (chosen.has(p.id)) continue;
        take(p);
        added++;
        // What that one needs, so it can actually run.
        for (const i of inputsOf(p)) {
          if (spec.have.has(i.name) || bottomsOut(i.name)) continue;
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
  /**
   * A chamber is all or none of it.
   *
   * Half a competition is worse than none: the plan would run the potassium
   * branch of the Lepidolite decomposition and never account for the two
   * thirds of the ore the other two branches take. If any member is worth
   * having, all of them come.
   */
  for (const g of rivalGroups(graph)) {
    if (!g.ids.some((id) => chosen.has(id))) continue;
    for (const id of g.ids) {
      const q = graph.byId.get(id);
      if (!q || chosen.has(id)) continue;
      chosen.set(id, q);
      for (const i of inputsOf(q)) materials.add(i.name);
      for (const o of q.produces) materials.add(o.name);
    }
  }
  return { processes: [...chosen.values()], materials, depth };
}

/* ----------------------------------------------------------------- the ask */

export const FRESH_DEFAULTS = { ways: 3, reach: 9, loops: 3, eaters: 30 };

/**
 * The leavings were briefly a thing to minimise, ranked above step count.
 * Sparr: that is backwards. A plan that buys nothing is giving them away free,
 * more of them is more value, and fewer steps matters more than either. They
 * are the last tie-break now and there is nothing to configure.
 */

export function normalizeFresh(spec) {
  return {
    targets: (spec.targets || []).map((t) =>
      typeof t === 'string' ? { name: t, amount: 1 } : { name: t.name, amount: t.amount ?? 1 }),
    have: new Set(spec.have || []),
    // The kinds that are physics rather than machinery go in whatever the
    // reader picked, including on a link saved before they stopped being
    // offered. See `always` in PROCESS_KINDS.
    kinds: new Set([...(spec.kinds || DEFAULT_KINDS),
                    ...PROCESS_KINDS.filter((k) => k.always).map((k) => k.id)]),
    /** Which sorts of thing the reader will go and get. All of them, unless said. */
    sources: new Set(spec.sources || DEFAULT_SOURCES),
    /** How many ores to try, each one a whole solve. See `ORES_TRIED`. */
    oreTries: Math.max(1, Math.round(spec.oreTries ?? ORES_TRIED)),
    excludeProcesses: new Set(spec.excludeProcesses || []),
    excludeMaterials: new Set(spec.excludeMaterials || []),
    /** Things the reader will not buy, though the plan may still make them. */
    noFetch: new Set(spec.noFetch || []),
    /** Things the reader will not start with, though the plan may still use them. */
    noPrime: new Set(spec.noPrime || []),
    /**
     * Spare output the reader has claimed as a product rather than waste.
     *
     * Asks for nothing to be made -- it is not a target, and must not become
     * one: a target's amount is stated before the batch scaling and a leftover
     * is shown after it, so asking for the 1 spare Water came out as a demand
     * for 2. All it does is move the row from "left over" to "you also get",
     * and stop the last tie-break trying to get rid of it.
     */
    kept: new Set(spec.kept || []),
    /**
     * Which way to settle a draw over what is left on the floor.
     *
     * The lowest priority there is: by the time it is consulted the steps, the
     * shopping list and the feed are all pinned, so it can only choose between
     * answers that are otherwise the same. Off by default, because leavings
     * that appear without more going in are matter the game invented.
     */
    keepLeftovers: !!spec.keepLeftovers,
    /**
     * Whether a step's temperature range may be trimmed to set nothing else off.
     *
     * On unless refused, as in the older planner. It changes nothing about
     * which steps run or how often -- it is a fact about how to hold the
     * chamber once the plan is settled -- so it is read at the end rather than
     * during the solve.
     */
    avoidSideEffects: spec.avoidSideEffects !== false,
    /**
     * The one material that may be bought despite carrying the want atoms.
     * Empty unless `solveFresh` put something here; see `barredAsTarget`.
     */
    oreAllowed: new Set(spec.oreAllowed || []),
    /**
     * How many ways to make each material the walk keeps.
     *
     * Three is enough when you hold the ore: the routes that start from what
     * is in your hand rank high and survive the cut. It is not enough when the
     * ore has to be bought, because then it ranks like any other purchase and
     * its routes fall below the cut -- asked for Lithium and Potassium, all
     * three Lepidolite decompositions were pruned, and the answer came back as
     * thirty-five steps and 228 atoms of sulfates rather than fourteen steps
     * on three Lepidolite.
     *
     * So it is widened exactly where it was too narrow. Six across the board
     * costs about twice the wall clock on every question; six only where an
     * ore is being bought costs it on the questions that were getting the
     * wrong answer.
     */
    ways: spec.ways ?? ((spec.oreAllowed?.length ?? (spec.oreAllowed?.size ?? 0))
      ? ORE_WAYS : FRESH_DEFAULTS.ways),
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
/** How coarse a chamber's split may be rounded, and how far off it may land. */
const SHARE_PARTS = 10;
const SHARE_SLACK = 0.05;

/**
 * The gates as small whole numbers.
 *
 * Sparr: 52:50:51 should be 1:1:1, and five per cent is an acceptable margin.
 *
 * The exact split is a fact about the game's dice and a nuisance about
 * everything else: three branches at 52, 50 and 51 in 153 mean the chamber has
 * to turn a hundred and fifty-three times before every count is whole, so a
 * plan for two metals came back offering fifty. Nobody wants a hundred and
 * fifty-three of anything to answer a question about two. Rounded to 1:1:1 the
 * same plan needs three turns.
 *
 * The rounding is a search rather than a formula, because the best small ratio
 * is not the one you get by rounding each share on its own: it is whichever
 * whole numbers, none bigger than ten, land every branch inside the margin.
 * Smallest total wins the ties, so 1:1 is preferred to 2:2.
 *
 * Returns null when nothing that coarse will do -- two of the composting
 * chambers fire one time in ten thousand, and there is no ratio in tenths that
 * says so. Those are left untied rather than rounded into a lie.
 */
function simplifyShares(chances) {
  const n = chances.length;
  if (n < 2 || n > 4) return null;               // the search is parts^n
  let best = null;
  const parts = new Array(n);
  const walk = (at) => {
    if (at === n) {
      let sum = 0;
      for (const v of parts) sum += v;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        worst = Math.max(worst, Math.abs(parts[i] / sum - chances[i]) / chances[i]);
      }
      if (!best || worst < best.worst - 1e-12 ||
          (Math.abs(worst - best.worst) < 1e-12 && sum < best.sum)) {
        best = { parts: [...parts], worst, sum };
      }
      return;
    }
    for (let v = 1; v <= SHARE_PARTS; v++) { parts[at] = v; walk(at + 1); }
  };
  walk(0);
  if (!best || best.worst > SHARE_SLACK) return null;
  return best.parts.map((v) => rat(BigInt(v), BigInt(best.sum)));
}

const rivalCache = new WeakMap();

/**
 * Reactions that share a chamber, and how the feed divides between them.
 *
 * Sparr: the plan thought it could run one of the Lepidolite reactions without
 * the other two. It cannot. Three decompositions sit on the same primary input
 * gated at 51, 52 and 50, so a tick in that chamber fires one of them and which
 * one is not yours to choose. Over a run they take about a third of the ore
 * each, and a plan that helps itself to the potassium branch alone is claiming
 * two thirds of its feed came back as something it did not ask for.
 *
 * The chances are worked out again here rather than read off `competition`,
 * which carries them as doubles. Everything downstream of this is exact, and a
 * third is not a double.
 *
 * Twenty-two chambers, forty-seven reactions.
 */
export function rivalGroups(graph) {
  let groups = rivalCache.get(graph);
  if (groups) return groups;
  groups = [];
  const seen = new Set();
  for (const p of graph.processes) {
    if (p.kind !== 'reaction' || seen.has(p.id)) continue;
    const all = operatingWindow(p, true).competition;
    if (!all || all.length < 2) continue;
    /**
     * One chamber each, first come.
     *
     * Which reactions compete depends on the window the chamber is held at,
     * so the sets overlap: `Hydrogen Sulfide Gas + Oxygen Gas` is a rival in
     * three of them, at nought, two and forty-nine per cent. Tying it into all
     * three at once is not a model of anything -- it forced it to zero in one
     * and then dragged its partners to zero with it, and the Lepidolite plan
     * stopped having an answer at all.
     */
    const members = all.filter((m) => !seen.has(m.id));
    if (members.length < 2) continue;
    for (const m of members) seen.add(m.id);
    // A 1-in-P gate rolled per tick, tried in the order the game baked them:
    // the first takes 1/P of the ticks, the next that fraction of what is left,
    // and a member with no gate at all takes everything still going.
    let rest = rat(1);
    const fires = members.map((m) => {
      const gate = rat(BigInt(m.probability || 1));
      const mine = rdiv(rest, gate);
      rest = rsub(rest, mine);
      return mine;
    });
    let total = R0;
    for (const f of fires) total = radd(total, f);
    if (rzero(total)) continue;
    /**
     * Only the branches that actually fire are tied to each other.
     *
     * Where an earlier rival carries no gate it takes every tick and the ones
     * after it never run at all -- `Silica Reduction` sits behind `Molten
     * Silica + Carbon` and comes out at nought. Tying a nought in means
     * declaring that route dead, and with it any silicon out of Lepidolite,
     * which is one of the four things the flagship plan is asked for. That is
     * a claim about the game, not about arithmetic, and it is not this
     * function's to make: a nought is left untied and goes on being treated
     * the way it always was.
     */
    groups.push({
      ids: members.map((m) => m.id),
      chances: fires.map((f) => rdiv(f, total)),
    });
  }
  rivalCache.set(graph, groups);
  return groups;
}

/** A branch this rare is not a route; it is a rounding error with a label. */
const NEVER_FIRES = 1 / 100;

/**
 * What a chamber does, once you know what the plan is for.
 *
 * Sparr: anything one in a hundred or less is nought, unless the rare thing is
 * what you asked for.
 *
 * Two rules, and the second is why the first is safe. A branch that fires once
 * in ten thousand -- the composting chambers -- is not a route anyone can
 * plan on, and rounding it to a tenth would be a worse lie than dropping it,
 * so it is pinned to no runs at all. But `Silica Reduction` sits behind an
 * ungated rival and comes out at nought, and it is the only way from molten
 * silica to molten silicon: pin that and a plan asked for silicon out of
 * Lepidolite has no answer, which is not a fact about the game. So a rare
 * branch that makes something the plan was asked for is exempt, and goes on
 * being free the way it always was.
 *
 * What is left over -- the branches that really do share the chamber -- is
 * tied at the small whole numbers `simplifyShares` finds.
 */
export function chamberShares(graph, id, wanted) {
  const group = rivalGroups(graph).find((g) => g.ids.includes(id));
  if (!group) return null;
  const tiedIds = [];
  const tiedChances = [];
  const zeroed = [];
  for (let i = 0; i < group.ids.length; i++) {
    const chance = group.chances[i];
    if (rnum(chance) > NEVER_FIRES) { tiedIds.push(group.ids[i]); tiedChances.push(chance); continue; }
    const makesAWant = (graph.byId.get(group.ids[i])?.produces || [])
      .some((o) => holdsATarget(graph, o.name, wanted));
    if (!makesAWant) zeroed.push(group.ids[i]);
  }
  const shares = tiedIds.length > 1 ? simplifyShares(tiedChances.map(rnum)) : null;
  return {
    ids: shares ? tiedIds : [],
    chances: shares || [],
    zeroed,
  };
}

/** Which chamber a reaction shares, if it shares one. */
export function rivalsOf(graph, id) {
  for (const g of rivalGroups(graph)) if (g.ids.includes(id)) return g;
  return null;
}

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
  /**
   * Only things something here would actually eat.
   *
   * A column to buy a material nothing in the plan consumes can never be worth
   * using -- it would buy the stuff and set it down. Most of the candidate
   * set's materials are like that: they are outputs, and they appear only
   * because some step makes them.
   *
   * It matters because a plan permitted to buy manufactured goods was opening
   * a column for nearly three hundred of them, which is most of a thousand-
   * variable model, and the exact solver at the end of the pipeline cannot
   * carry that. The combined factory went from two seconds to not finishing.
   */
  const eaten = new Set();
  for (const p of procs) for (const i of inputsOf(p)) eaten.add(i.name);

  const supply = new Map();
  let next = procs.length;
  for (const name of materials) {
    if (spec.have.has(name)) { supply.set(name, next++); continue; }
    if (!eaten.has(name)) continue;
    if (!fetchable(graph, name, spec.kinds, spec.sources, spec)) continue;
    if (barredAsTarget(graph, name, spec)) continue;
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
    // The name rides along so a later pass can weigh this row's slack -- which
    // is exactly the leftover of this material -- by what a unit of it is.
    rows.push({ name, coeffs, op: '>=', rhs: demand.get(name) || R0 });
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
  /**
   * A chamber runs as one, and the feed divides by the gates.
   *
   * Not a preference: which branch fires on a given tick is the game's roll,
   * so over a run the counts are fixed against each other. Written as
   * `runs(a) * chance(b) = runs(b) * chance(a)`, which is linear and exact --
   * and which pins a branch that never fires at all to zero runs, since an
   * earlier ungated rival takes every tick.
   */
  for (const g of rivalGroups(graph)) {
    const shared = chamberShares(graph, g.ids[0], spec.wanted);
    if (!shared) continue;
    // A branch too rare to plan on, and not the thing being asked for.
    for (const id of shared.zeroed) {
      const at = index.get(id);
      if (at === undefined) continue;
      rows.push({ name: `chamber:${g.ids[0]}`, coeffs: new Map([[at, rat(1)]]), op: '=', rhs: R0 });
    }
    const here = [];
    for (let k = 0; k < shared.ids.length; k++) {
      const at = index.get(shared.ids[k]);
      if (at !== undefined) here.push([at, shared.chances[k]]);
    }
    if (here.length < 2) continue;
    const [first, firstChance] = here[0];
    for (let k = 1; k < here.length; k++) {
      const [other, otherChance] = here[k];
      rows.push({
        name: `chamber:${g.ids[0]}`,
        coeffs: new Map([[first, otherChance], [other, rsub(R0, firstChance)]]),
        op: '=',
        rhs: R0,
      });
    }
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
/**
 * Narrowings, kept by the shape of the question rather than its size.
 *
 * The support of a linear programme does not change when every requirement is
 * scaled by the same factor -- ask for twice as much of everything and the same
 * routes serve, at twice the run counts. So two-two-two-three and eight-eight-
 * eight-twelve narrow to the same twenty-nine processes, and balancing a plan
 * asks for both.
 *
 * It very much does change when the requirements move against each other:
 * Lepidolite narrows to twenty-nine processes at one of each and forty-three at
 * one-two-three-four. So the ratio is in the key and the scale is not, which is
 * exactly the difference between "the same question, bigger" and "a different
 * question".
 */
const KEEP_SHORTLISTS = 24;
const shortlistCache = new WeakMap();

const ratioOf = (amounts) => {
  const whole = amounts.map((a) => Math.round(a * 1e6));
  const hcf = whole.reduce((a, b) => (b ? hcfOf(b, a % b) : a), 0) || 1;
  return whole.map((n) => n / hcf);
};
const hcfOf = (a, b) => (b ? hcfOf(b, a % b) : a);

export function shortlist(graph, spec, sub, build) {
  let store = shortlistCache.get(graph);
  if (!store) shortlistCache.set(graph, store = new Map());
  const key = `${subgraphKey(spec)}|${ratioOf(spec.targets.map((t) => t.amount)).join(',')}`;
  const had = store.get(key);
  if (had !== undefined) return had;
  const found = narrowTo(graph, spec, sub, build);
  if (store.size >= KEEP_SHORTLISTS) store.delete(store.keys().next().value);
  store.set(key, found);
  return found;
}

function narrowTo(graph, spec, sub, build) {
  const model = build(sub.processes, sub.materials);
  if (!model) return null;
  /**
   * Rows that cannot fail are not worth carrying to a float solve.
   *
   * A material nothing in the candidate set consumes, and nobody asked for,
   * gives a row that says "make at least none of it" with nothing but
   * production on the left -- true for every non-negative answer there is.
   * Fifty-five of Lepidolite's three hundred and seventy-two are like that,
   * seventy-nine of Columbite-with-everything's.
   *
   * They are not free to carry. Each one is a row of the tableau and an
   * artificial column that phase one has to drive back out, and this walk is
   * over six hundred columns -- five hundred pivots and forty milliseconds,
   * twice per plan, which is the largest single cost in the solver.
   *
   * Dropped only here. The exact models are small enough not to care, and the
   * pass that closes a bought-and-vented loop reads these very rows to find
   * out what is being thrown away -- so the model keeps them and this walk
   * does not.
   */
  const idle = (row) => row.op === '>=' && rnum(row.rhs) <= 0 &&
    [...row.coeffs.values()].every((a) => rnum(a) >= 0);
  const rows = model.rows.filter((row) => !idle(row)).map((row) => ({
    coeffs: new Map([...row.coeffs].map(([i, a]) => [i, rnum(a)])),
    op: row.op,
    rhs: rnum(row.rhs),
  }));
  /**
   * A thumb on the scale for the shorter way round, where the price is equal.
   *
   * The shortlist is settled by one solve, and only what that solve used
   * survives into the step-elimination -- so a route dropped here can never be
   * found again, however few steps it would have taken. Which of two equally
   * cheap routes wins was arbitrary, and Carbon Monoxide to Carbon shows what
   * that costs: with the potassium loop in the candidate set it shortlists the
   * potassium route, seven steps, and the four-step hydrogen route is not
   * merely beaten but absent, `rx:Electrolysis of Water` never having reached
   * the tableau. Same fetch, same draw per carbon, same leavings, three steps
   * more.
   *
   * So each run costs a little, and among answers the two real questions call
   * equal the simplex takes the one that runs fewer times. A hundredth of a
   * step price at a hundred runs, which is far too small to outweigh anything
   * either question actually cares about -- it decides ties and nothing else.
   */
  /**
   * Asked plainly first, and the nudge only if the plain question landed.
   *
   * The nudge is a tie-break and it is not free: a cost on every column is a
   * different problem to walk, and on a degenerate one it walks much worse.
   * Chalcopyrite to Copper settles in 135ms without it and spends six seconds
   * failing with it, all three walks exhausting their budget on improvements
   * worth a hundred-thousandth each. Columbite does not notice it at all.
   *
   * So the plain solve decides whether there is an answer, and the nudged one
   * only gets to say which of the equally good answers to keep. When it cannot
   * manage that, the plain answer stands and the shortlist is merely arbitrary
   * again, which is where it was before the tie-break existed.
   */
  const NUDGE = 1e-5;
  const plainCost = new Map([...model.fetchCost].map(([i, a]) => [i, rnum(a)]));
  const cost = new Map(plainCost);
  for (const [, i] of model.index) cost.set(i, (cost.get(i) || 0) + NUDGE);
  const nudged = solveLPFloat({ vars: model.vars, rows, cost });
  // Nudged first, since it almost always lands and asking twice every time
  // doubled the shortlist. The plain question is the one that decides whether
  // there is an answer at all, so it is what we fall back to.
  const answer = nudged.ok ? nudged : solveLPFloat({ vars: model.vars, rows, cost: plainCost });
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
  const plainDrawn = new Map(drawn);
  for (const [, i] of model.index) drawn.set(i, (drawn.get(i) || 0) + NUDGE);
  let second = solveLPFloat({ vars: model.vars, rows: [...rows, cap], cost: drawn });
  if (!second.ok) second = solveLPFloat({ vars: model.vars, rows: [...rows, cap], cost: plainDrawn });

  const chosen = new Set();
  for (const p of sub.processes) {
    const i = model.index.get(p.id);
    if (answer.x[i] > 0) chosen.add(p.id);
    if (second.ok && second.x[i] > 0) chosen.add(p.id);
  }
  // And a chamber stays whole through the narrowing too, for the same reason.
  for (const g of rivalGroups(graph)) {
    if (g.ids.some((id) => chosen.has(id))) for (const id of g.ids) chosen.add(id);
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

    /**
     * The busiest step that actually makes atoms, not the busiest step.
     *
     * A wheel turns for free because at least one of its reactions does not
     * conserve, and the game has plenty that do not, on purpose. Barring any
     * member stops the wheel, so the old rule -- whichever ran most in the
     * witness -- always worked, and that is why it lasted. What it does not do
     * is remove the reason. It barred `Electrolysis of Carbon Dioxide` on the
     * Columbite plan: a reaction that balances, sitting at the bound because
     * the simplex reports a ray and the size of a coefficient in a ray is an
     * artefact of how the recipes are written. That step is also the only way
     * back from carbon dioxide to carbon, so with it gone the plan bought
     * carbon at the door and vented the same carbon out of the back.
     *
     * So: among the members that gain matter, the busiest. Both halves earn
     * their place. Ignoring the gain barred an innocent step; ignoring the
     * runs and taking whichever gained most barred a load-bearing one instead,
     * and cost the plain Columbite plan thirteen extra reactors. Where nothing
     * in the wheel gains -- the packing chains, where a unit is a container and
     * not an amount -- there is no culprit to find and the old rule answers.
     */
    const perUnit = (name) => graph.db.byName.get(name)?.matter ?? 1;
    const minted = (p) => {
      let out = 0;
      for (const o of p.produces) out += o.count * perUnit(o.name);
      for (const c of inputsOf(p)) out -= c.count * perUnit(c.name);
      return out;
    };
    let biggest = 0;
    let blame = null;
    for (const p of procs) {
      const runs = answer.x[index.get(p.id)];
      if (minted(p) <= 1e-9 || runs <= biggest) continue;
      biggest = runs; blame = p.id;
    }
    if (!blame) {
      for (const p of procs) {
        const runs = answer.x[index.get(p.id)];
        if (runs > biggest) { biggest = runs; blame = p.id; }
      }
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
/**
 * Which phase group a material belongs to, named for its first member.
 *
 * Two temperatures of one substance answer the same, so a rule comparing the
 * inputs of competing recipes can tell "acid or its vapour" from a real fork.
 */
const groupCache = new WeakMap();
export function phaseGroup(graph, name) {
  let table = groupCache.get(graph);
  if (!table) {
    table = new Map();
    groupCache.set(graph, table);

    /**
     * Sparr: burning and extinguishing are the same stuff where they make a
     * round trip, and not where they do not.
     *
     * Melting and boiling are always reversible, so following them is safe.
     * Fire is not: most of what the game burns is gone -- 534 of the 580
     * fire and decay transitions are one way, Actinium to Francium and wood to
     * ash among them -- and calling those the same substance would be plainly
     * wrong. The 46 that come back are the twenty-three pairs of a thing and
     * the same thing alight: Charcoal, Coal, the oils, the vapours, hydrogen.
     *
     * The test is structural rather than by name: does a fire or decay step
     * take you there, and another one back. It finds every `X (Burning)` and
     * nothing else, without knowing that the game writes them that way.
     *
     * It matters because the bar on buying the answer is written in terms of
     * this: asked for Charcoal from nothing, the solver reached for a
     * Charcoal (Burning) and let it go out, one step, and that read as an
     * honest plan because the two were unrelated as far as this could see.
     */
    const burns = new Map();
    for (const p of graph.processes) {
      if (p.kind !== 'fire' && p.kind !== 'decay') continue;
      for (const i of p.consumes || []) {
        for (const o of p.produces) {
          if (!burns.has(i.name)) burns.set(i.name, new Set());
          burns.get(i.name).add(o.name);
        }
      }
    }
    const backAgain = (at) => [...(burns.get(at) || [])]
      .filter((to) => to !== at && burns.get(to)?.has(at));

    for (const m of graph.db.materials) {
      if (table.has(m.name)) continue;
      const seen = [m.name];
      table.set(m.name, m.name);
      for (let i = 0; i < seen.length; i++) {
        const raw = graph.db.byName.get(seen[i])?.raw;
        for (const field of ['Evaporation', 'Condensation']) {
          const to = raw?.[field]?.TargetMaterialName;
          if (to && !table.has(to)) { table.set(to, m.name); seen.push(to); }
        }
        for (const to of backAgain(seen[i])) {
          if (!table.has(to)) { table.set(to, m.name); seen.push(to); }
        }
      }
    }
  }
  return table.get(name) ?? name;
}

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
  /**
   * What going and getting one costs, before any recipe is considered.
   *
   * Not one. Everything the world hands over used to cost a unit however much
   * of it a unit was, so Carbon at one atom cost the same as Aqueous Potassium
   * Hydroxide at six, and a plan minimising its shopping list learnt to carry
   * its fluorine home dissolved in as much else as possible. Columbite bought
   * sixty-eight Hydrofluoric Acid and sixty Potassium Oxide and came out four
   * atoms over its ideal while its unit count looked fine.
   *
   * A unit's matter is what you are actually carrying, so that is the price.
   * One where nothing in the phase group has a formula to anchor with, which
   * is the old behaviour and the most that can be said about it.
   */
  const carrying = (name) => graph.db.byName.get(name)?.matter ?? 1;

  const price = (name) => {
    if (table.has(name)) return table.get(name);
    if (busy.has(name)) return Infinity;
    if (sourceOf(graph, name) !== 'made') {
      const each = carrying(name);
      table.set(name, each);
      return each;
    }

    const makers = graph.producers(name).filter((p) => kinds.has(p.kind));
    if (!makers.length) { const each = carrying(name); table.set(name, each); return each; }

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
      const answer = Number.isFinite(best) ? Math.max(best, 1) : carrying(name);
      table.set(name, answer);
      return answer;
    }

    /**
     * Only what appears in every one of them, at the least any of them needs
     * -- and two temperatures of the same substance are not two of them.
     *
     * Beryllium Fluoride is made two ways: Beryllium Oxide with two
     * Hydrofluoric Acid Gas, and Beryllium Oxide with two Hydrofluoric Acid.
     * That is one recipe, and whether the acid is boiling is not a choice
     * worth pricing. Compared by name they share only the oxide, the two acid
     * fall out as the part the routes disagree on, and the fluoride came back
     * at 1.78 -- less than the three atoms in it, and cheaper per fluorine
     * than the acid it is made of. Columbite bought it by the crate.
     *
     * So inputs are matched by phase group. The rule is the one already used a
     * few lines up, where a material made only by cooling is priced as the
     * substance rather than as a choice between temperatures.
     */
    const shared = new Map();
    const perOf = (p) => {
      const out = p.produces.find((o) => o.name === name)?.count || 1;
      const m = new Map();
      for (const i of inputsOf(p)) {
        const key = phaseGroup(graph, i.name);
        const each = { name: i.name, per: i.count / out };
        const had = m.get(key);
        if (!had || each.per < had.per) m.set(key, each);
      }
      return m;
    };
    for (const [key, each] of perOf(makers[0])) shared.set(key, each);
    for (const p of makers.slice(1)) {
      const here = perOf(p);
      for (const [key, each] of [...shared]) {
        const mine = here.get(key);
        if (!mine) shared.delete(key);
        else if (mine.per < each.per) shared.set(key, mine);
      }
    }
    // Nothing shared between the routes, so the recipe says nothing about what
    // it costs -- but a unit of it is still a unit of something, and that much
    // is known. Sparr's rule is that the flexibility is worth keeping out of;
    // it is not that the stuff is free.
    if (!shared.size) { const each = carrying(name); table.set(name, each); return each; }

    busy.add(name);
    let sum = STEP_PRICE;
    for (const { name: n, per } of shared.values()) {
      const each = price(n);
      if (!Number.isFinite(each)) { sum = Infinity; break; }
      sum += each * per;
    }
    busy.delete(name);

    const answer = Number.isFinite(sum) ? Math.max(sum, 1) : carrying(name);
    table.set(name, answer);
    return answer;
  };

  for (const m of graph.db.materials) price(m.name);
  priceCache.set(graph, table);
  return table;
}

/** The element sets the two composition rules compare against. */
/**
 * The element sets the composition rules are asked about.
 *
 * Exported so a diagnostic can reproduce what the solver actually searched.
 * `why-not.mjs` built its own subgraph and shortlist without these and was
 * describing a different search: it reported twelve shortlisted where the plan
 * ran twenty-seven, and called a step the plan runs twenty-four times "offered
 * and NOT CHOSEN".
 */
export function withElements(graph, spec) {
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

/**
 * A plan-shaped nothing, for when there is no plan.
 *
 * `solveFresh` returns null when it cannot answer, which is the right thing to
 * tell a caller that wants to know -- the diagnostics test for it. The page is
 * not such a caller: it reads a plan and would throw on the first field. So it
 * asks for this instead, which is empty everywhere and names the targets as
 * unreachable, and carries the reason the solver gave for saying so.
 */
export function blankFresh(graph, rawSpec, why = null) {
  const spec = normalizeFresh(rawSpec);
  return {
    // Carried like the older solver's plans carry it: the page's inspector and
    // its "what could I do with this" list are drawn by helpers that take a
    // plan and reach through it to the graph, and an empty plan is exactly the
    // one that list is drawn from.
    graph,
    spec, fresh: true, why,
    steps: [], frontier: [], feed: [], byproducts: [],
    priming: [], brokenLoops: [], cycles: [],
    fetchTotal: 0, realSteps: 0, considered: 0,
    runsOf: () => R0, madeOf: () => R0, amountOf: () => R0, otherSupplyOf: () => R0,
    dag: { processes: new Map(), materials: new Map(),
           groups: new Map(), forced: new Map(), cycles: [] },
    scale: rat(1),
    apparatus: { hottestFloor: 0, lowestCeiling: null, hottestStep: null, coolestStep: null,
                 hottestShared: 0, coolestShared: 0, heating: 'none', cooling: 'none',
                 electrolysis: false, spark: false, byHand: false,
                 catalysts: new Map(), kinds: new Set(), slowest: null,
                 narrowedBySideEffects: false, sideEffects: false, stochastic: false },
    sharedPins: new Map(),
    converged: true,
    unreachable: spec.targets.map((t) => t.name),
  };
}

/** Ways per material kept while an ore is being bought. See `normalizeFresh`. */
const ORE_WAYS = 6;

/** How many ores to try when the plan is starting from nothing, unless told. */
const ORES_TRIED = 6;

/**
 * The ores that could start a plan that has nothing to start from.
 *
 * Only reached when the reader holds nothing carrying what they asked for. A
 * candidate has to be something you could actually go and get, something some
 * step will actually eat, and something that is not simply the answer: asked
 * for Iron, `Iron` itself qualifies on every other count and turns the plan
 * into "buy one", so anything in a target's own phase group is out. Molten
 * Iron is Iron in another coat.
 */
/**
 * Whether this question is one that buys an ore, and how far it will look.
 *
 * The page needs to know two things a note in prose cannot safely tell it:
 * that the cap is what stopped the search, and what the numbers were. Asked
 * here so the answer comes from the same reasoning the solver uses -- the loop
 * only runs when nothing held carries what was asked for, and a question that
 * never reaches it has no cap to raise.
 */
export function oreReach(graph, rawSpec) {
  const spec = withElements(graph, normalizeFresh(rawSpec));
  if ([...spec.have].some((n) => holdsATarget(graph, n, spec.wanted))) return null;
  const all = oreCandidates(graph, spec).length;
  return { all, tried: Math.min(all, spec.oreTries), cap: spec.oreTries };
}

export function oreCandidates(graph, spec) {
  const targetPhases = new Set(spec.targets.map((t) => phaseGroup(graph, t.name)));
  const eaten = new Set();
  for (const p of graph.processes) {
    if (!spec.kinds.has(p.kind)) continue;
    for (const i of inputsOf(p)) eaten.add(i.name);
  }
  const prices = fetchPrices(graph, spec.kinds);
  const out = [];
  for (const m of graph.db.materials) {
    const name = m.name;
    if (!eaten.has(name)) continue;
    if (targetPhases.has(phaseGroup(graph, name))) continue;
    if (!holdsATarget(graph, name, spec.wanted)) continue;
    if (alreadyInHand(graph, name, spec.held)) continue;
    if (!fetchable(graph, name, spec.kinds, spec.sources, spec)) continue;
    // How many of the things asked for this one ore could start. One is the
    // usual answer and the reason the sort below used to be price alone.
    let covers = 0;
    for (const wanted of spec.wanted) if (holdsATarget(graph, name, [wanted])) covers++;
    out.push([name, covers, prices.get(name) ?? Infinity]);
  }
  /**
   * The ore that starts the most of what was asked for, then the cheapest.
   *
   * Only one may be bought, so an ore that carries two of the wants is worth
   * more than a cheap one that carries a third of them -- and price alone did
   * not know that. Asked for Lithium and Potassium there are fifty candidates,
   * exactly one carries both, and Lepidolite is forty-sixth by price. The six
   * tried never came near it and the question had no answer, though the ore
   * that answers it is the first thing anyone would reach for.
   *
   * Price still decides between equals, which is every candidate when there is
   * one thing to make -- so a single-target question is sorted exactly as it
   * was, and only the questions that were losing by this gain.
   */
  return out
    .sort((a, b) => b[1] - a[1] || a[2] - b[2] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** What a finished plan costs, for choosing between them. Lower is better. */
function weighPlan(graph, plan) {
  const per = plan.spec.targets[0]?.amount || 1;
  let atoms = 0;
  let units = 0;
  for (const f of plan.frontier) {
    const n = rnum(f.amount);
    units += n;
    atoms += n * (graph.db.byName.get(f.name)?.matter ?? 1);
  }
  return [atoms / per, units / per, reactorsIn(plan.steps)];
}

const cheaperThan = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - 1e-9) return true;
    if (a[i] > b[i] + 1e-9) return false;
  }
  return false;
};

/**
 * What two questions have to share for their answers to be the same.
 *
 * The scoreboard asks one question thirty-one times, once per combination of
 * source categories, and most of those combinations differ in ways the answer
 * cannot see. Every one of them makes a different set of materials buyable --
 * all thirty-one differ there -- but nearly half come out with the identical
 * model, because the extra materials are ones no step in the candidate set
 * would eat. Columbite has seventeen real questions in its thirty-one;
 * Lepidolite twenty-two.
 *
 * The shape is the candidate set, the columns there are to buy with, and which
 * of those materials a charge could be laid in from -- the last because the
 * priming pass consults the sources on its own account, so two questions alike
 * in the first two could still be charged differently. Folding it in costs
 * nothing: it splits no group in any case measured.
 *
 * Null where no promise can be made. With nothing held that carries what was
 * asked for, `solveFresh` goes looking for an ore to buy and that search reads
 * the sources itself, so those questions are answered rather than matched.
 */
export function questionShape(graph, rawSpec) {
  const spec = withElements(graph, normalizeFresh(rawSpec));
  if (![...spec.have].some((name) => holdsATarget(graph, name, spec.wanted))) return null;
  const sub = subgraph(graph, spec);
  if (!sub.processes.length) return null;
  const built = model(graph, spec, sub.processes, sub.materials);
  if (!built) return null;
  return [
    sub.processes.map((p) => p.id).sort().join('|'),
    [...built.supply.keys()].sort().join('|'),
    [...sub.materials]
      .filter((name) => fetchable(graph, name, spec.kinds, spec.sources, spec))
      .sort().join('|'),
  ].join('##');
}

export function solveFresh(graph, rawSpec) {
  /**
   * Starting from nothing: one ore may be bought, and which one is tried.
   *
   * Sparr: the solver should be allowed to fetch a single material with the
   * want atoms if nothing held has them. Which single material is not
   * something a rule can name -- Boron Oxide has one candidate and Aluminium
   * twenty-two -- so the cheap ones are tried and the best answer kept. Tried
   * rather than reasoned about, because the ore that looks cheapest at the door
   * is not always the one that leads anywhere.
   */
  if (!rawSpec.oreAllowed) {
    const spec = withElements(graph, normalizeFresh(rawSpec));
    const alreadyHolds = [...spec.have].some((n) => holdsATarget(graph, n, spec.wanted));
    if (!alreadyHolds) {
      const all = oreCandidates(graph, spec);
      const tried = all.slice(0, spec.oreTries);
      if (all.length > tried.length && rawSpec.notes) {
        rawSpec.notes.push(`tried the ${tried.length} cheapest of ${all.length} ores that ` +
                           `could start this; the rest were not looked at`);
      }
      let best = null;
      let bestCost = null;
      for (const ore of tried) {
        const plan = solveFresh(graph, { ...rawSpec, oreAllowed: [ore], notes: undefined });
        if (!plan || plan.shortfall) continue;
        const cost = weighPlan(graph, plan);
        if (!best || cheaperThan(cost, bestCost)) { best = plan; bestCost = cost; }
      }
      if (best && rawSpec.notes) {
        rawSpec.notes.push(`nothing held carries what was asked for, so one ore was ` +
                           `bought: ${[...best.spec.oreAllowed].join(' or ')}`);
      }
      if (best) return best;
      // Nothing worked with an ore either; fall through and fail the usual way.
    }
  }

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
    if (!plan) {
      if (rawSpec.notes && round) {
        rawSpec.notes.push(`...after ${round} round${round === 1 ? '' : 's'} of ` +
          `barring a free-turning wheel${best ? ', keeping an earlier answer' : ''}`);
      }
      return best;
    }
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
  /**
   * Why there is no plan, when there is no plan.
   *
   * Sparr: do not silently discard a bad plan. A missing one is the same
   * complaint -- five ways out of here return the same bare null, and telling
   * "the shortlist came back empty" from "the model would not build" from "the
   * simplex says infeasible" is the whole of knowing where to look. Callers
   * that want to know pass `notes`; callers that do not are unaffected.
   */
  const notes = rawSpec.notes;
  const giveUp = (why) => { if (notes) notes.push(why); return null; };

  const spec = withElements(graph, normalizeFresh(rawSpec));

  /**
   * Answer the unanswerable questions before doing any work on them.
   *
   * Sparr: an unusable have or an unproducible want should exit immediately.
   * Asked for Copper by somebody holding Chalcopyrite -- which not one process
   * in the game consumes -- the walk went looking for Copper anyway, because
   * it works backward from the target and never asks whether the stock is good
   * for anything. Four hundred and eight candidates and six seconds later it
   * said the doubles could not settle, which was true and told nobody
   * anything.
   *
   * Neither check is a proof of impossibility -- copper might have come from
   * somewhere else entirely, and the plan would then simply have ignored the
   * ore. That is the point. If you name a stock, you mean to use it, and being
   * told nothing eats it is the answer you wanted.
   */
  const eats = (name) => graph.consumers(name).some((p) => spec.kinds.has(p.kind));
  const held = [...spec.have];
  if (held.length && held.every((name) => !eats(name))) {
    return giveUp(`nothing consumes ${listed(held, 'or')}, so holding ` +
      `${held.length > 1 ? 'them' : 'it'} cannot help`);
  }

  /**
   * And a want nothing can reach, said before four hundred candidates are
   * walked looking for it.
   *
   * "Does anything anywhere make this" is too weak a question. Aluminium is
   * made by dozens of reactions, so it passed -- and asked for Caesium and
   * Aluminium out of Pollucite the walk chased every one of them, blew past
   * the size ceiling and blamed its own arithmetic. Pollucite's one reaction
   * yields Nepheline, which not a single process in the game consumes, so the
   * aluminium is locked in it for good; and every other aluminium source is
   * barred from the shopping list for covering a target. There was no answer
   * and no cheap way to hear so.
   *
   * The question worth asking is what can be reached at all: close forward
   * over everything held and everything the model would actually sell, and see
   * whether the target turns up. If it does not, nothing downstream will find
   * it either, because this is the most generous supply the plan will ever
   * have.
   *
   * Any target, not every: a plan owes all of them, so one unreachable want is
   * the end of it. That is the opposite of the stock rule above, where holding
   * one useless thing among several useful ones is no reason to stop.
   */
  const reach = new Set(spec.have);
  for (const m of graph.db.materials) {
    const name = m.name;
    if (reach.has(name)) continue;
    if (!fetchable(graph, name, spec.kinds, spec.sources, spec)) continue;
    if (barredAsTarget(graph, name, spec)) continue;
    if (alreadyInHand(graph, name, spec.held)) continue;
    reach.add(name);
  }
  const allowed = graph.processes.filter((p) => spec.kinds.has(p.kind));
  for (let grew = true; grew;) {
    grew = false;
    for (const p of allowed) {
      if (!inputsOf(p).every((i) => reach.has(i.name))) continue;
      for (const o of p.produces) if (!reach.has(o.name)) { reach.add(o.name); grew = true; }
    }
  }
  const lost = spec.targets.filter((t) => !reach.has(t.name)).map((t) => t.name);
  if (lost.length) {
    return giveUp(`nothing can reach ${listed(lost, 'or')} from what is held, ` +
      `and buying ${lost.length > 1 ? 'them' : 'it'} is barred`);
  }

  const whole = subgraph(graph, spec);
  if (!whole.processes.length) {
    return giveUp('the candidate walk found no process at all');
  }

  const build = (procs, materials) => model(graph, spec, procs, materials);
  const narrow = shortlist(graph, spec, whole, build);

  /**
   * Falling back to the whole candidate set is fine, until it is not.
   *
   * When the doubles cannot settle, the exact solver is asked about everything
   * instead -- slow and right, which is the trade this pipeline is built on.
   * It stops being a trade somewhere past a few hundred variables: the
   * combined factory's model is eight hundred and sixty-one, and asking
   * exactly about that does not finish in any time worth waiting.
   *
   * So the fallback has a ceiling. Past it, no plan and a reason, rather than
   * a solver that appears to be thinking.
   */
  const TOO_BIG_TO_GRIND = 400;
  if (!narrow && whole.processes.length > TOO_BIG_TO_GRIND) {
    return giveUp(`the doubles could not settle and the whole candidate set is ` +
      `${whole.processes.length}, past the ${TOO_BIG_TO_GRIND} an exact solve finishes`);
  }

  const sub = narrow || whole;
  const procs = sub.processes;
  if (!procs.length) return giveUp('the shortlist came back empty');

  const built = model(graph, spec, procs, sub.materials);
  if (!built) {
    return giveUp(`no model over ${procs.length} processes -- a target nothing ` +
      `in the shortlist touches, or no row to constrain it`);
  }
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

  /**
   * The doubles say which columns matter; the rationals say how much.
   *
   * That division already runs at the shortlist. This is the same trick one
   * level down: ask the float simplex the very question about to be put to the
   * exact one, keep the columns it actually used, and hand the exact solver a
   * narrower problem. Across two dozen models the float support has never once
   * been missing a column the exact answer needed -- it carries the odd spare,
   * never a gap -- and Columbite sheds ten of forty-nine columns for it.
   *
   * Not proof, though, so it is checked rather than trusted. Both solvers are
   * answering the same relaxation, so the float optimum is what the exact
   * answer should come to; if the narrowed exact solve comes back dearer than
   * that, a needed column was dropped and the full problem is asked instead.
   * Pinning the spare columns to zero was tried first and is worse than doing
   * nothing: an equality row brings an artificial column with it, and phase
   * one has to pivot every one of them back out -- Columbite went from a
   * hundred and six pivots to a hundred and twenty-seven.
   */
  const asFloat = (row) => ({
    coeffs: new Map([...row.coeffs].map(([i, a]) => [i, rnum(a)])),
    op: row.op,
    rhs: rnum(row.rhs),
  });
  const inDoubles = rows.map(asFloat);
  /**
   * Only where there is enough to save.
   *
   * The float solve is not free, and on a small tableau it costs more than the
   * columns it removes are worth: Lepidolite is thirty-three columns and the
   * doubles use twenty-nine of them, so the walk pays for a whole extra solve
   * to shed four. Columbite is forty-nine and sheds ten, and that is worth
   * having.
   */
  const WORTH_NARROWING = 40;
  const narrowed = (all, cost) => {
    if (vars < WORTH_NARROWING) return null;
    const guess = solveLPFloat({
      vars,
      rows: [...inDoubles, ...all.slice(rows.length).map(asFloat)],
      cost: new Map([...cost].map(([i, a]) => [i, rnum(a)])),
    });
    if (!guess.ok) return null;
    const keep = [];
    for (let i = 0; i < vars; i++) if (guess.x[i] > 1e-9) keep.push(i);
    if (keep.length >= vars) return null;              // nothing to save
    const at = new Map(keep.map((was, now) => [was, now]));
    const shrink = (row) => {
      const coeffs = new Map();
      for (const [i, a] of row.coeffs) if (at.has(i)) coeffs.set(at.get(i), a);
      return { name: row.name, coeffs, op: row.op, rhs: row.rhs };
    };
    const small = solveLP({
      vars: keep.length,
      rows: all.map(shrink),
      cost: new Map([...cost].filter(([i]) => at.has(i)).map(([i, a]) => [at.get(i), a])),
      lo: new Map(),
      steep: true,
    });
    if (!small.ok) return null;
    // The float optimum is what this ought to come to. Dearer means a column
    // it needed was left out.
    let paid = R0;
    let guessed = 0;
    for (const [i, a] of cost) {
      if (at.has(i)) paid = radd(paid, rmul(a, small.x[at.get(i)]));
      guessed += rnum(a) * guess.x[i];
    }
    if (rnum(paid) > guessed + 1e-6) return null;
    const x = new Array(vars).fill(R0);
    for (const [was, now] of at) x[was] = small.x[now];
    return { ok: true, x };
  };

  const attempt = (banned, extra = [], cost = fetchCost) => {
    const lo = new Map();
    const caps = [...extra];
    for (const p of procs) if (banned.has(p.id)) {
      caps.push({ coeffs: new Map([[index.get(p.id), rat(1)]]), op: '=', rhs: R0 });
    }
    const all = [...rows, ...caps];
    const first = narrowed(all, cost) || solveLP({ vars, rows: all, cost, lo, steep: true });
    if (!first.ok) return null;
    /**
     * What the till came to, not how many things were on the counter.
     *
     * Priced the same way `fetchCost` and `inputCost` price them, because
     * every later stage holds one of these two against a bound and the bound
     * has to be in the currency the stage was optimised in. Counted raw, a pin
     * on "the shopping list stays as it was" let the mix underneath it change
     * to a dearer one of the same length.
     */
    let total = R0;
    let drawn = R0;
    for (const [name, i] of supply) {
      if (bought(name)) total = radd(total, rmul(first.x[i], fetchCost.get(i) ?? rat(1)));
      drawn = radd(drawn, rmul(first.x[i], inputCost.get(i) ?? rat(1)));
    }
    return { total, drawn, x: first.x, caps };
  };

  /**
   * A row measuring some of the supply, in the currency it was priced in.
   *
   * The weights are the cost map's own, so `sumOf(bought, fetchCost)` is
   * literally the objective the shopping list was minimised under, written as
   * a constraint. That is what makes a pin hold what was won: pinning any
   * other quantity leaves the simplex free to move within it.
   */
  const sumOf = (which, cost) => {
    const coeffs = new Map();
    for (const [name, i] of supply) if (which(name)) coeffs.set(i, cost.get(i) ?? rat(1));
    return coeffs;
  };
  const pinnedFetch = (t) => ({ coeffs: sumOf(bought, fetchCost), op: '=', rhs: t });
  const pinnedInput = (t) => ({ coeffs: sumOf(() => true, inputCost), op: '=', rhs: t });

  let base = attempt(new Set());
  if (!base) {
    return giveUp(`the simplex says infeasible over ${procs.length} processes ` +
      `and ${rows.length} rows -- the shortlist cannot fill the order at all`);
  }

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
  /**
   * Then as little left on the floor, with both tills pinned.
   *
   * Sparr: minimising leftovers outranks minimising steps. A row's slack is
   * that material's leftover -- it is what the plan makes and neither uses nor
   * was asked for -- so the sum of the slacks is linear and the simplex can be
   * asked for it directly, no counting required.
   *
   * `units` counts a leftover Magnesium Oxide the same as a leftover Oxygen
   * Gas; `atoms` counts what is actually being thrown away, and is the reason
   * to prefer a one-atom carrier over a five-atom one. Where a material has no
   * countable formula a unit is worth one, which is the most that can be said.
   */
  const leftoverCost = (weigh) => {
    const c = new Map();
    for (const row of rows) {
      const w = weigh(row.name);
      if (!w) continue;
      const each = rat(Math.round(w * 64), 64n);
      for (const [i, a] of row.coeffs) c.set(i, radd(c.get(i) || R0, rmul(a, each)));
    }
    return c;
  };
  const perUnit = () => 1;
  /**
   * What a unit of it really is, packing included.
   *
   * Not the formula: Oxygen Gas condenses four to one into Liquid Oxygen, so a
   * unit of the liquid holds eight atoms where its formula says two. Weighed
   * by the formula, this stage learnt it could vent the liquid instead of the
   * gas, throw away exactly as much, and be charged a quarter of it -- which
   * is what both carbon plans spent their extra step doing. One a unit where
   * nothing in the phase group has a formula to anchor with.
   */
  const perAtom = (name) => graph.db.byName.get(name)?.matter ?? 1;
  /**
   * What the plan leaves on the floor, priced by matter.
   *
   * Used at the very end and not here. Sparr: a plan that buys nothing is
   * giving those leavings away free, so more of them is more value, and the
   * only way two plans from the same stock leave different amounts is that
   * something along the way does not conserve. The game does that on purpose
   * in places -- air is not modelled, so a reaction helps itself to oxygen
   * where that is convenient -- and a plan is not wrong for using it.
   *
   * So this is no longer a thing to minimise, and it no longer outranks step
   * count. It breaks the last tie: same shopping list, same draw, same steps,
   * then take the one that hands back the most.
   */
  /**
   * Except what the reader has said they want.
   *
   * The tie-break asks which answer hands back the least, and a material
   * claimed with "Keep it" is not something handed back -- it is a product the
   * plan was not asked for and gets anyway. Counting it here would have the
   * solver quietly working to produce less of the thing just claimed.
   */
  const spoilsCost = leftoverCost((name) => (spec.kept.has(name) ? 0 : perAtom(name)));
  const spoilsIn = (x) => {
    let n = R0;
    for (const [i, a] of spoilsCost) n = radd(n, rmul(a, x[i]));
    return n;
  };

  /**
   * Do not pay at the door for what is going out of the back.
   *
   * Sparr: when a plan both consumes and produces carbon, something is wrong.
   * Asked for tantalum and niobium with every source switched on, it bought
   * eight Carbon and vented eight Carbon Dioxide -- and the closed answer
   * costs exactly the same, which is the trouble. Pin the Carbon column to
   * zero and the model is still feasible at the identical fetch total, so this
   * was never a judgement the objective could make. It was a tie, and ties go
   * wherever the simplex happened to be standing.
   *
   * So it is asked again, once per suspect: for each thing bought that shares
   * an element with something the plan throws away, try the same plan without
   * buying it at all. Where that works at the same price the closed answer
   * wins, and where it does not the purchase was real and stands.
   *
   * Carbon is the case this was written for, but the rule is not about carbon
   * -- buying anything you are simultaneously discarding is the same mistake.
   * Oxygen is excluded because it is not a mistake there: air is not modelled,
   * so half the reactions help themselves and vent the rest on purpose.
   */
  /**
   * Kept for the rest of the solve, not just for this pass.
   *
   * The step-elimination re-solves from scratch each time it drops a step, and
   * it was free to buy the carbon straight back -- which it did, so the repair
   * showed in the notes and never in the answer.
   */
  const shut = [];
  {
    const table = composition(graph);
    const elementsOfName = (name) => table.get(name)?.elements;
    const surplusOf = (x) => {
      const out = new Set();
      for (const row of rows) {
        let net = R0;
        for (const [i, a] of row.coeffs) net = radd(net, rmul(a, x[i]));
        if (rcmp(rsub(net, row.rhs), R0) > 0) out.add(row.name);
      }
      return out;
    };
    const surplus = () => surplusOf(base.x);
    /** Still paying for this element at the door and still binning it. */
    const buysAndVents = (x, el) => {
      let vented = false;
      for (const s of surplusOf(x)) {
        const e = elementsOfName(s);
        if (e && e.has(el)) { vented = true; break; }
      }
      if (!vented) return false;
      for (const [name, i] of supply) {
        if (!bought(name) || rzero(x[i])) continue;
        const mine = elementsOfName(name);
        if (mine && mine.has(el)) return true;
      }
      return false;
    };
    /**
     * By element, not by material.
     *
     * Pinning one column at a time and starting over let the solver buy the
     * other one instead, and the pass spent its rounds swapping Carbon for
     * Hydrofluoric Acid and back -- so the pins are kept. But keeping them was
     * not enough either: told it may not buy Carbon, the Columbite plan bought
     * five Carbon Monoxide and vented the carbon just the same. The complaint
     * was never about a material. It is that an element is being paid for at
     * the door and thrown out of the back, so every door it could come in by
     * has to shut at once.
     */
    const closedOff = new Set();
    for (let round = 0; round < 10; round++) {
      const spare = surplus();
      const spareHas = (el) => {
        for (const s of spare) { const e = elementsOfName(s); if (e && e.has(el)) return true; }
        return false;
      };
      // The biggest offender first, not whichever comes first in the map. Taken
      // in map order it spent its rounds on a Hydrofluoric Acid here and a
      // Potassium Oxide there and never reached the forty-five Carbon, which
      // was the whole complaint.
      const weight = new Map();
      const carriers = new Map();
      for (const [name, i] of supply) {
        if (!bought(name) || rzero(base.x[i])) continue;
        const mine = elementsOfName(name);
        if (!mine) continue;
        for (const el of mine) {
          if (el === 'O' || closedOff.has(el) || !spareHas(el)) continue;
          weight.set(el, radd(weight.get(el) || R0, base.x[i]));
          if (!carriers.has(el)) carriers.set(el, []);
          carriers.get(el).push([name, i]);
        }
      }
      const [guilty] = [...weight].sort((a, b) => rcmp(b[1], a[1]) || a[0].localeCompare(b[0]));
      if (!guilty) break;
      const [el] = guilty;
      const shutToo = carriers.get(el).map(([, i]) =>
        ({ coeffs: new Map([[i, rat(1)]]), op: '=', rhs: R0 }));
      /**
       * Bounded by nothing but the price, which is the only honest bound.
       *
       * There were two caps here, `<=` on the things bought and on the things
       * drawn, and the note under them said "what this pass must not do is
       * spend more". Counted raw that was satisfiable, because closing a loop
       * swaps many cheap units for fewer dear ones and the count goes down
       * while the bill goes up. Priced, the same two caps say the closed
       * answer must cost no more than the open one -- and closing costs more
       * by definition, or there would have been nothing to close. Kept, they
       * refused every repair there was: the Columbite plan went straight back
       * to buying four Magnesium Fluoride and eight Potassium and venting
       * both, and the whole pass fired zero times.
       *
       * A cap on the count was never protecting anything a cap on the price
       * would not protect better, and there is no bound that is both in this
       * currency and satisfiable. So there is none. What is left is the thing
       * that was wanted all along: of the answers that do not buy the element
       * they throw away, the cheapest.
       */
      const closed = attempt(new Set(), [...shut, ...shutToo], inputCost);
      closedOff.add(el);
      /**
       * Sparr: a leftover nothing can eat should not count against the plan.
       *
       * Nearly. What the dead end tells you is that the leftover cannot be
       * taken back, and this pass has two ways to stop a buy-and-vent -- take
       * it back off the floor, or buy the element in some other shape. Reading
       * "dead end" as "no complaint" throws the second away with the first,
       * and on the newer data that let a plan buy Clay for carbon it binned as
       * Ceramic, which nothing consumes.
       *
       * So the test is not what the leftover is, it is whether the close did
       * anything. Shutting the cheap door on potassium sent Columbite off to
       * buy Potassium Oxide and vent the same four Potassium Fluoride: still
       * bought, still binned, twelve atoms where eight would do. Shutting it
       * on carbon leaves a plan buying no carbon at all. The first is undone,
       * the second kept, and neither needs to know whether anybody eats
       * Potassium Fluoride.
       */
      if (!closed || buysAndVents(closed.x, el)) continue;
      shut.push(...shutToo);
      if (notes) {
        notes.push(`closed the ${el} loop rather than buying ` +
                   listed(carriers.get(el).map(([n]) => n), 'or'));
      }
      base = closed;
    }
  }

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
  const floatFetch = new Map([...fetchCost].map(([i, a]) => [i, rnum(a)]));
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
      if (bought(name)) fetched += answer.x[i] * (floatFetch.get(i) ?? 1);
      drawn += answer.x[i] * (floatCost.get(i) ?? 1);
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
      [pinnedFetch(base.total), pinnedInput(base.drawn), ...shut, ...demands], inputCost);
    if (!settled) { banned.delete([...banned].pop()); break; }
    best = settled;
  }

  /**
   * Last of all, and only among answers already equal on everything else.
   *
   * The steps are settled, the shopping list is pinned and so is what goes in
   * at the door, so this cannot trade any of them away. What it can still
   * choose is which corner of the remaining face to sit in, and the corner to
   * take is the one that leaves the least behind.
   *
   * This asked for the most, once, on the reasoning that free matter is free
   * matter. Sparr: more leftover atoms from the same inputs is just
   * conservation errors in play, and I do not want to incentivise that. Quite
   * right -- the feed is pinned here, so anything extra on the floor did not
   * come from anywhere. It was minted by a reaction that does not balance, and
   * asking for more of it is asking the plan to go looking for the game's
   * mistakes. Where the answer is genuinely determined this changes nothing,
   * which is most of the time: it only has room to move where such a reaction
   * is being run at all.
   */
  if (spoilsCost.size) {
    /**
     * Every supply held exactly where it stands, not merely its total.
     *
     * Pinning the totals alone was far too loose a rein: maximising what is
     * left over rewards a plan for running whatever the game does not balance,
     * and given room to rearrange the shopping list at the same price it took
     * it. Columbite went from buying thirty atoms to seventy, swapping into
     * silicon tetrafluoride and slaked lime, and threw a hundred and sixteen
     * hydrofluoric acid away to do it. Sparr's condition is a constant number
     * of steps *and inputs* and production ratio, so the inputs have to be
     * constant one by one.
     */
    const fixed = [];
    for (const [, i] of supply) {
      fixed.push({ coeffs: new Map([[i, rat(1)]]), op: '=', rhs: best.x[i] });
    }
    // Maximised by minimising its negative; the LP has no other way to be asked.
    const aim = spec.keepLeftovers
      ? new Map([...spoilsCost].map(([i, a]) => [i, rsub(R0, a)]))
      : spoilsCost;
    const other = attempt(banned, [...fixed, ...demands], aim);
    if (other) {
      if (notes) {
        notes.push(`spoils: ${rstr(spoilsIn(best.x))} -> ${rstr(spoilsIn(other.x))} atoms left over`);
      }
      const better = rcmp(spoilsIn(other.x), spoilsIn(best.x));
      if (spec.keepLeftovers ? better > 0 : better < 0) best = other;
    }
  }

  return assemble(graph, spec, procs, index, supply, best.x, base.total, sub, notes);
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
function assemble(graph, spec, procs, index, supply, x, fetchTotal, sub, notes) {
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

  /**
   * Each step's temperature range, trimmed to set nothing else off.
   *
   * A reaction runs in a chamber holding its inputs and its outputs, and those
   * are the ingredients of other reactions: hold the chamber in one of their
   * ranges and you get those too, wanted or not. `operatingWindow` narrows the
   * range to dodge them where it can and names what it could not.
   *
   * This used to report the floor and ceiling as written, with `avoided` and
   * `unavoidable` empty -- which the page drew as "nothing else happens here",
   * when what it meant was "nobody looked". It is the same answer wherever
   * nothing needed dodging and an understatement everywhere else.
   *
   * Read at the end, not during the solve. Which steps run and how often does
   * not depend on it; how to hold the chamber afterwards does.
   */
  /**
   * What share of a shared chamber each step takes.
   *
   * A tile runs the first reaction in its list that is valid this tick and
   * stops, so rivals on one feed divide it between them whether you wanted
   * them to or not. That is why three Lepidolite decompositions show up when
   * you asked for potassium, and without saying so the plan reads as though it
   * were running two steps for no reason.
   *
   * The older solver said this by hiding the passengers behind the chosen one
   * and naming it. This one lists all three as steps, because all three run,
   * so each says its own share and the panel adds "the rest runs the other
   * reactions below". Same fact, told the way this solver models it.
   */
  const shareOf = (id) => {
    const c = chamberShares(graph, id, spec.wanted);
    const at = c ? c.ids.indexOf(id) : -1;
    if (at < 0) return null;
    const chance = c.chances[at];
    return { k: Number(chance.n), of: Number(chance.d), rounded: true };
  };

  const steps = [...runs].map(([id, n]) => ({
    process: graph.byId.get(id),
    runs: n,
    share: shareOf(id),
    window: operatingWindow(graph.byId.get(id), spec.avoidSideEffects),
  })).sort((a, b) => a.process.id.localeCompare(b.process.id));

  /**
   * The shopping list and the leavings, in the shape the side panel reads.
   *
   * It wants more of each line than this solver needs for itself: what a
   * fetched thing goes on to feed, the other ways of getting it, whether the
   * world simply hands it over. All of that is knowable here and none of it
   * was being filled in, so the panel threw on the first line it drew -- and
   * only where something was actually bought, which is why a plan for Carbon
   * out of Carbon Dioxide never showed it.
   *
   * `credited` and `kept` are false throughout: this solver has no notion of
   * agreeing to plumb a byproduct back or of setting one aside, so the honest
   * answer is that nothing has been.
   */
  const frontier = [];
  const feed = [];
  const routesTo = (name) => graph.producers(name).filter((q) => spec.kinds.has(q.kind));
  /**
   * What a fetched thing goes into, named as the steps that eat it name it.
   *
   * These are immediate products and not ultimate ones, which is worth knowing
   * when reading them: buying hydrogen sulfide reports "Tungsten Disulfide and
   * Water", and the disulfide is not made in any useful sense -- it is roasted
   * straight back to the trioxide it came from, with the water the actual
   * point. Filtering out whatever nets to nothing was tried and is worse: in a
   * plan that closes its loops properly almost everything nets to nothing, and
   * the line becomes "for nothing that leaves". The charge below is where a
   * circulating material gets explained, by asking to be laid in.
   */
  const feedsOf = (name) => {
    const ends = new Set();
    for (const { process: p } of steps) {
      if (!inputsOf(p).some((i) => i.name === name)) continue;
      for (const o of p.produces) if (o.name !== name) ends.add(o.name);
    }
    return [...ends].sort();
  };

  for (const [name, amount] of drawn) {
    if (spec.have.has(name)) { feed.push({ name, amount }); continue; }
    const routes = routesTo(name);
    frontier.push({ name, amount,
                    alternatives: routes.length,
                    routes,
                    raw: routes.length === 0,
                    feeds: feedsOf(name),
                    credited: false });
  }
  const byproducts = [...spare]
    .filter(([name]) => !asked.has(name))
    .map(([name, amount]) =>
      ({ name, amount, holds: [], kept: spec.kept.has(name), credited: false }));

  /**
   * Enough of the older solver's shape for the page to render this one.
   *
   * `plan-view` reads a plan through a wider hole than this solver was built
   * to fill: a dag to link materials to the step that makes them, a scale, and
   * an apparatus summary. None of it changes what the plan *is* -- it is the
   * same steps and the same shopping list -- but without it the view throws on
   * the first byproduct it tries to link.
   *
   * What is honestly absent stays absent and says so: there are no pins here,
   * no cycles left open, and nothing was narrowed to dodge a side effect.
   */
  const nodes = new Map(steps.map((s) => [s.process.id, s.process]));
  const materials = new Map();
  const node = (name) => {
    let m = materials.get(name);
    if (!m) materials.set(name, (m = { producer: null, consumers: [], byproductOf: [],
                                       reason: spec.have.has(name) ? 'have' : 'make' }));
    return m;
  };
  for (const { process: p } of steps) {
    for (const o of p.produces) {
      const m = node(o.name);
      if (m.producer === null) m.producer = p.id; else m.byproductOf.push(p.id);
    }
    for (const i of inputsOf(p)) node(i.name).consumers.push(p.id);
  }
  for (const f of frontier) node(f.name).reason = 'acquire';

  /** The kit, read off the ranges the steps will actually be held at. */
  const apparatus = { hottestFloor: 0, lowestCeiling: null,
                      hottestStep: null, coolestStep: null,
                      hottestShared: 0, coolestShared: 0,
                      heating: 'none', cooling: 'none',
                      electrolysis: false, spark: false, byHand: false,
                      catalysts: new Map(), kinds: new Set(), slowest: null,
                      narrowedBySideEffects: false, sideEffects: false,
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
   * A loop that gives back everything it takes shows a net of nothing, and so
   * appears on no list: asked for Tantalum and Niobium with everything
   * switched on, the plan roasts Tungsten Disulfide to the trioxide and makes
   * the disulfide back from it, buying hydrogen sulfide and getting water --
   * a water factory with tungsten going round inside. Net tungsten zero, so
   * neither the shopping list nor the leavings mentioned it, and nothing said
   * you cannot start without owning some.
   *
   * So: run whatever can run, and only when nothing can does something have to
   * be laid in. Which is a question about whether *some* order works, not
   * about the order the steps happen to be printed in.
   *
   * Charging something a step still waiting would have produced is the
   * ordering giving up early rather than a real charge -- unless everything is
   * waiting on everything, which is the genuine deadlock a loop needs seeding
   * out of. Being on the shopping list already settles it either way: you are
   * going out for the stuff regardless, so laying some in is not a second
   * errand.
   */
  const priming = [];
  {
    const prices = fetchPrices(graph, spec.kinds);
    /**
     * One go at starting the factory, refusing to be started on `refuse`.
     *
     * Sparr: why does this need water primers when it has water leftovers?
     *
     * It does not. The plan makes twenty-three water and spends twenty, and
     * the one it asked to be handed was never needed -- refuse it and the same
     * twenty-one steps come out with the same three water left at the end and
     * one charge fewer. The charge is an artefact of the order: the pass fires
     * what it can, reaches a moment when nothing turns, and buys the cheapest
     * way out. Cheapest at that moment, and it never looks back to see that a
     * different push at an earlier stall would have covered this one too.
     *
     * So it is asked more than once. Each thing it wanted to be handed is
     * refused in turn and the whole pass run again; where the run comes back
     * with a shorter or cheaper list, the refusal stands. A charge survives
     * only by being needed under a rule that tried to do without it.
     */
    const layIn = (refuse, cap = new Map()) => {
    const said = [];
    const unlimited = (name) => spec.have.has(name) || drawn.has(name);
    const stock = new Map();
    const held = (name) => stock.get(name) || R0;
    const charge = new Map();
    const chargedFor = new Map();             // name -> step id -> amount
    /**
     * Runs still owed, not steps still to do.
     *
     * The first version of this treated a step as all-or-nothing: twenty runs
     * of the Boudouard equilibrium wanted forty carbon monoxide in the chamber
     * before it would turn at all. That is not how a loop starts. It wants
     * enough for one turn, and then it feeds itself -- and asking for the whole
     * batch up front both invented deadlocks that were not there and, where
     * one really was, charged twenty times what it takes to break it.
     */
    const owed = new Map(steps.map((step) => [step, step.runs]));
    const floorR = (v) => (rcmp(v, R0) <= 0 ? R0 : rat(v.n / v.d));

    /** How many more times this could run right now, whole times only. */
    const affordable = (step) => {
      // Apparatus has to be there, but is not spent.
      for (const r of step.process.requires) {
        if (unlimited(r.name)) continue;
        if (rcmp(held(r.name), rat(r.count)) < 0) return R0;
      }
      let times = owed.get(step);
      for (const i of step.process.consumes) {
        if (unlimited(i.name) || !i.count) continue;
        const can = rdiv(held(i.name), rat(i.count));
        if (rcmp(can, times) < 0) times = can;
      }
      return floorR(times);
    };

    /** What one more turn of it would want that is not to hand. */
    const missing = (step) => {
      const short = [];
      for (const i of step.process.consumes) {
        if (unlimited(i.name)) continue;
        const want = rat(i.count);
        if (rcmp(held(i.name), want) < 0) short.push([i.name, rsub(want, held(i.name))]);
      }
      for (const r of step.process.requires) {
        if (unlimited(r.name)) continue;
        if (rcmp(held(r.name), rat(r.count)) < 0) {
          short.push([r.name, rsub(rat(r.count), held(r.name))]);
        }
      }
      return short;
    };

    const fire = (step, times) => {
      for (const i of step.process.consumes) {
        if (unlimited(i.name)) continue;
        stock.set(i.name, rsub(held(i.name), rmul(times, rat(i.count))));
      }
      for (const o of step.process.produces) {
        stock.set(o.name, radd(held(o.name), rmul(times, rat(o.count))));
      }
      owed.set(step, rsub(owed.get(step), times));
    };

    const fetched = new Set(frontier.map((f) => f.name));
    const stillOwed = () => steps.filter((step) => rcmp(owed.get(step), R0) > 0);

    // Every pass either turns something or lays something in, and a charge is
    // always enough to turn the thing it was laid in for, so this ends.
    /**
     * Only look again at what could have changed.
     *
     * A step becomes runnable when something it eats turns up, and the only
     * things that turn up are what the last firing made. Re-asking every step
     * on every sweep is how fifteen steps came to want eighteen thousand
     * affordability checks over eleven hundred sweeps: the plan runs its
     * Boudouard equilibrium twenty times, the loop yields one turn at a time,
     * and each turn re-examined the whole factory.
     *
     * So a step is asked again only when one of its inputs is on the list of
     * things that moved. Everything is on that list to begin with, and again
     * after a charge is laid in.
     */
    let stirred = null;                       // null means "everything"
    const eatersOf = new Map();
    for (const step of steps) {
      for (const i of step.process.consumes) {
        if (!eatersOf.has(i.name)) eatersOf.set(i.name, new Set());
        eatersOf.get(i.name).add(step);
      }
      for (const r of step.process.requires) {
        if (!eatersOf.has(r.name)) eatersOf.set(r.name, new Set());
        eatersOf.get(r.name).add(step);
      }
    }

    let guard = steps.length * 64 + 64;
    for (;;) {
      const left = stillOwed();
      if (!left.length || guard-- <= 0) break;

      const ask = stirred === null ? left : left.filter((step) => stirred.has(step));
      /**
       * What something else is waiting on goes first.
       *
       * Sparr: it should be priming that loop from the Hydrofluoric Acid it is
       * generating, and outputting one fewer.
       *
       * It had the acid and spent it on the wrong thing. Firing whatever could
       * afford to run, in whatever order they came, let `Electrolysis
       * Hydrofluoric Acid` -- which makes the fluorine and feeds nothing --
       * take four of the acid before `Hydrofluoric Acid Dissolves Columbite`,
       * which the rest of the factory waits on. Six were then wanted where
       * four were left, and the reader was asked for two.
       *
       * There is an order with no charge at all: the twelve the ore hands back
       * dissolve the Columbite, the hydrolyses give four more, and the
       * electrolysis takes those. What separates them is not which is nearer
       * the end of a chain -- the electrolysis feeds its hydrogen onward like
       * anything else -- but how much of the scarce thing each still has to
       * get through. The dissolution wants twelve acid before it is done and
       * the electrolysis four, so the dissolution has the better claim on
       * what there is, and going hungriest-first is enough to give it.
       */
      const hungriest = (step) => {
        let n = 0;
        for (const i of step.process.consumes) n += i.count * rnum(owed.get(step));
        return n;
      };
      const inOrder = [...ask].sort((a, b) => hungriest(b) - hungriest(a));
      let moved = false;
      const woke = new Set();
      for (const step of inOrder) {
        const times = affordable(step);
        if (rcmp(times, R0) <= 0) continue;
        fire(step, times);
        moved = true;
        for (const o of step.process.produces) {
          for (const eater of (eatersOf.get(o.name) || [])) woke.add(eater);
        }
      }
      if (moved) { stirred = woke; continue; }
      // Nothing stirred what was watched; before giving up, look at everything.
      if (stirred !== null) { stirred = null; guard++; continue; }

      /**
       * Only a wheel needs a push.
       *
       * Nothing can turn, so at least one of what is left is in a loop: follow
       * a blocked step back through whatever it waits for and you either reach
       * something runnable, which contradicts being stuck, or you arrive back
       * where you started. A step that is *not* in a loop is therefore never
       * the one to charge -- it is waiting its turn, and running its producer
       * first would have done.
       *
       * Without this the Columbite plan laid in four Molten Niobium to run the
       * step that freezes them, and then, two charges later, laid in the carbon
       * to run the reduction that makes Molten Niobium. It was paying for the
       * thing it was about to make, having given up on the ordering early.
       */
      const producersOf = new Map();
      for (const step of left) {
        for (const o of step.process.produces) {
          if (!producersOf.has(o.name)) producersOf.set(o.name, []);
          producersOf.get(o.name).push(step);
        }
      }
      const waitsOn = (step) => {
        const out = [];
        for (const [name] of missing(step)) out.push(...(producersOf.get(name) || []));
        return out;
      };
      const inLoop = (start) => {
        const seen = new Set();
        const stack = [...waitsOn(start)];
        while (stack.length) {
          const step = stack.pop();
          if (step === start) return true;
          if (seen.has(step)) continue;
          seen.add(step);
          stack.push(...waitsOn(step));
        }
        return false;
      };
      const wheels = left.filter(inLoop);
      // If nothing is in a loop this is a deadlock it does not understand, and
      // charging something still beats handing back a plan that cannot start.
      const candidates = wheels.length ? wheels : left;

      const pending = new Set();
      for (const step of left) for (const o of step.process.produces) pending.add(o.name);
      /**
       * And a charge has to be something you could turn up holding.
       *
       * Priced by the shopping list alone, Molten Tantalum costs one and Water
       * costs three, so breaking the deadlock by laying in Molten Tantalum
       * looked like the bargain -- for a plan whose whole purpose is to make
       * tantalum, and which is barred from buying any precisely because it is
       * the thing being asked for. Anything the shopping list would refuse is
       * priced out of reach here too, so it is charged only if nothing else
       * will do.
       */
      /**
       * What the plan makes, which is not the same as what you can go and buy.
       *
       * Sparr: it is fine to prime a loop with something the reactor produces
       * indefinitely, as long as it is not needed before it is ever produced.
       * A charge of that kind is borrowed from the wheel and repaid on the
       * first turn -- the reader is not supplying it, they are starting it.
       */
      const makesItself = new Set();
      for (const step of steps) for (const o of step.process.produces) makesItself.add(o.name);

      const gettable = (name) => spec.have.has(name) || makesItself.has(name) ||
        (fetchable(graph, name, spec.kinds, spec.sources, spec) &&
         !barredAsTarget(graph, name, spec) &&
         !alreadyInHand(graph, name, spec.held));
      const OUT_OF_REACH = 1e6;
      /**
       * Sparr: fetching the want atoms is never legitimate, under any
       * circumstances.
       *
       * A charge is a fetch -- it is stuff you have to turn up holding -- so
       * this is the same rule the shopping list obeys, and it has to be a
       * refusal rather than a high price. Priced merely out of reach, it was
       * still the bargain when every other way out of a deadlock was out of
       * reach too, and the Columbite plan asked to be started with a niobium
       * salt while being asked to make niobium.
       *
       * A wheel has more than one place to push it. The two-step loop here is
       * the heptafluoro salt against the potassium hydroxide it gives back;
       * refusing the salt does not stop the wheel turning, it just picks the
       * other side.
       */
      /**
       * A want is the last thing to reach for, never the first.
       *
       * Sparr: the primer should come from the chain that leads to the output;
       * the player should not be handing over anything containing what they
       * asked for. The loop under the Lepidolite lithium is
       * `LiCl -> molten -> chlorine -> hydrochloric acid -> LiCl`, and two of
       * its four members carry no lithium at all. Seeded with chlorine gas the
       * chain makes its own lithium chloride; seeded with lithium chloride the
       * player is supplying lithium, which is the thing being asked for.
       *
       * Ranked rather than forbidden, so a wheel with nothing lithium-free
       * anywhere on it can still be started -- and when that happens the notes
       * say so, because the reader is then being asked for the thing they
       * asked to be made.
       */
      /**
       * And what the reader has said they will not start with.
       *
       * Ranked with the wants rather than forbidden outright, for the same
       * reason: a wheel with nothing else on it still has to be started, and a
       * plan that cannot begin is worse than one that begins awkwardly. The
       * notes say which it was.
       */
      /**
       * Still ranked last, which the chlorine says is right: the Lepidolite
       * wheel has a member carrying no lithium and that is the one to start
       * on. What changed is only whether a want-bearing charge is *affordable*
       * once it is reached -- see `gettable` above.
       */
      const carriesAWant = (name) =>
        holdsATarget(graph, name, spec.wanted) || spec.noPrime.has(name) ||
        refuse.has(name);
      let best = null;
      for (const step of candidates) {
        const short = missing(step);
        /**
         * And a ceiling on how much of a thing may be laid in at all.
         *
         * Sparr: it is always losing that carbon, not once at the beginning.
         *
         * True, and the loss is paid for by the dolomite. What the charge buys
         * is the stock that has to be going round before the first turn can
         * turn, and the pass arrived at it a unit at a time without ever
         * asking whether one of them had stopped being needed. Two Carbon and
         * one Carbon Monoxide start this factory; it was asking for three.
         *
         * Refusing a material outright could never find that -- Carbon is
         * needed, just less of it -- so the ceiling is what makes the question
         * askable, and it is ranked with the other refusals rather than
         * enforced, for the same reason they are.
         */
        const overCap = ([name, amount]) => cap.has(name) &&
          rnum(radd(charge.get(name) || R0, amount)) > cap.get(name);
        const forbidden = short.some((s) => carriesAWant(s[0]) || overCap(s));
        const price = short.reduce((a, [name, amount]) =>
          a + (gettable(name) ? (prices.get(name) ?? 1) : OUT_OF_REACH) * rnum(amount), 0);
        const outside = short.every(([name]) => fetched.has(name) || !pending.has(name));
        const better = !best ? true
          : forbidden !== best.forbidden ? !forbidden
          : outside !== best.outside ? outside
          : price < best.price;
        if (better) best = { step, short, price, outside, forbidden };
      }
      if (best && best.forbidden) {
        said.push(`nothing but ${listed(best.short.map(([n]) => n))} would start ` +
                  `this, and the plan never makes any to give back`);
      }
      if (!best || !best.short.length) break;
      for (const [name, amount] of best.short) {
        charge.set(name, radd(charge.get(name) || R0, amount));
        stock.set(name, radd(held(name), amount));
        /**
         * And which reaction it was laid in for.
         *
         * Sparr: make a separate node for each place a primer gets used, so
         * they are not star-like.
         *
         * Which needs knowing where each one goes, and the charge map knew
         * only the material. So the picture drew an arrow from the primer to
         * every reaction that eats the stuff -- five, for the water -- when
         * the charge was laid in to start exactly one of them and the other
         * four are fed by the plan. The star was not just ugly, it was four
         * arrows that are not true.
         */
        if (!chargedFor.has(name)) chargedFor.set(name, new Map());
        const where = chargedFor.get(name);
        where.set(best.step.process.id,
                  radd(where.get(best.step.process.id) || R0, amount));
      }
      stirred = null;                         // a charge can wake anything
    }
      return { charge, chargedFor, said };
    };

    /**
     * Ask once, then ask again without each thing it asked for.
     *
     * Only a strictly shorter or cheaper list is taken, so this can make the
     * charge no worse than leaving it alone, and a refusal that the pass works
     * around by asking for something dearer is dropped on the floor.
     */
    /**
     * What a charge costs, which is what it is made of and not how many
     * entries it has.
     *
     * Sparr: why does this want eighteen Carbon Monoxide for a Boudouard that
     * runs twelve times, and why Carbon Monoxide rather than Carbon into the
     * reduction, and why enough for all four turns of the loop instead of one?
     *
     * Three questions with one answer, and counting entries was half of it.
     * Refusing the Carbon Monoxide gives three Carbon and one Carbon Monoxide
     * -- three entries against two, so a count-first rule kept the eighteen.
     * Eighteen Carbon Monoxide is thirty-six atoms and the other is five. What
     * the reader has to lay their hands on is stuff, so stuff is what is
     * weighed, and the number of entries only settles a tie.
     */
    /**
     * What a charge costs is what it is made of, full stop.
     *
     * Sparr: no toll on the number of entries -- the scoreboard will let the
     * reader pick between one errand and two. So the only question here is how
     * much stuff has to be found, and the entry count is kept solely to settle
     * a tie between two answers that weigh the same.
     */
    const worth = (got) => {
      let paid = 0;
      for (const [name, amount] of got.charge) paid += (prices.get(name) ?? 1) * rnum(amount);
      return [paid, got.charge.size];
    };
    let laid = layIn(new Set());
    const refused = new Set();
    /**
     * Refusing one thing turns up others to refuse, and sometimes the first
     * step has to be uphill.
     *
     * Sparr: why prime with hydrogen when there are steam leftovers and a
     * water electrolysis already?
     *
     * Because refusing the hydrogen on its own makes it worse -- eighteen
     * Carbon Monoxide, forty atoms, against the eighteen it started at -- so a
     * rule that only ever steps downhill stops there and keeps the hydrogen.
     * Refuse the hydrogen *and* the Carbon Monoxide and it comes back with
     * nine Carbon, one Carbon Monoxide and one Sulfur Trioxide: fifteen. The
     * good answer is over a hill.
     *
     * So each round tries every single refusal, and if none of them is an
     * improvement it tries every pair before giving up. Only the weight
     * decides, only a strict improvement is taken, and the number of runs is
     * capped, since each is a full pass over the factory.
     */
    const tried = new Map();
    let spent = 1;
    const LOOKS = 80;
    const ask = (names, cap = new Map()) => {
      const key = `${[...names].sort().join('\u0000')}|`
        + [...cap].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join(',');
      if (tried.has(key)) return tried.get(key);
      if (spent >= LOOKS) return null;
      spent++;
      const got = layIn(new Set(names), cap);
      tried.set(key, got);
      return got;
    };
    const namesIn = (got) => [...got.charge.keys()];
    for (let round = 0; round < 8; round++) {
      const candidates = [...new Set([...namesIn(laid), ...refused])]
        .filter((n) => !refused.has(n)).sort();
      let best = null;
      for (const name of candidates) {
        const got = ask([...refused, name]);
        if (!got) continue;
        const [p1] = worth(got);
        if (!best || p1 < best.price) best = { price: p1, got, add: [name] };
      }
      // Uphill once, if no single step goes down.
      if (!best || best.price >= worth(laid)[0]) {
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            const got = ask([...refused, candidates[i], candidates[j]]);
            if (!got) continue;
            const [p1] = worth(got);
            if (!best || p1 < best.price) {
              best = { price: p1, got, add: [candidates[i], candidates[j]] };
            }
          }
        }
      }
      const [p0, n0] = worth(laid);
      if (!best) break;
      const [p1, n1] = worth(best.got);
      if (!(p1 < p0 || (p1 === p0 && n1 < n0))) break;
      laid = best.got;
      for (const n of best.add) refused.add(n);
    }
    /**
     * Then pare each amount down while the whole stays cheaper.
     *
     * The refusal search asks whether a thing is needed. This asks how much of
     * it is, which is a different question and the one left over: a charge is
     * built a unit at a time at successive stalls, and nothing ever went back
     * to see whether a later unit had been made redundant by an earlier one.
     * One at a time from the top, since the amounts are small and a ceiling
     * that is too low simply comes back dearer and is dropped.
     */
    let caps = new Map();
    for (const name of [...laid.charge.keys()].sort()) {
      for (;;) {
        const now = rnum(laid.charge.get(name) || R0);
        if (now <= 0) break;
        const trim = new Map([...caps, [name, now - 1]]);
        const got = ask([...refused], trim);
        if (!got) break;
        const [p1, n1] = worth(got);
        const [p0, n0] = worth(laid);
        if (!(p1 < p0 || (p1 === p0 && n1 < n0))) break;
        laid = got;
        caps = trim;
      }
    }

    if (notes) notes.push(...laid.said);

    for (const [name, amount] of laid.charge) {
      if (rcmp(amount, R0) > 0) {
        priming.push({ name, amount,
                       forSteps: [...(laid.chargedFor.get(name) || new Map())]
                         .map(([step, part]) => ({ step, amount: part })) });
      }
    }
    priming.sort((a, b) => a.name.localeCompare(b.name));
  }

  const plan = {
    spec: { ...spec, targets: spec.targets.map((t) => ({ ...t, amount: t.amount * Number(mul) })) },
    fresh: true,
    steps, frontier, feed, byproducts,
    priming,
    brokenLoops: [],
    graph,
    fetchTotal: rnum(rmul(fetchTotal, scale)),
    realSteps: reactorsIn(steps),
    considered: procs.length,
    runsOf: (id) => runs.get(id) || R0,
    madeOf: (name) => made.get(name) || R0,
    amountOf: (name) => used.get(name) || R0,
    otherSupplyOf: () => R0,
    // --- what the page reads, beyond what this solver needs for itself ---
    dag: { processes: nodes, materials, groups: new Map(), forced: new Map(), cycles: [] },
    /**
     * What else would go off in each chamber, dodged or not.
     *
     * `inPlan` because a reaction you are already running elsewhere is a
     * different matter from a stranger: it is a problem in this chamber and
     * the whole point in the next one.
     */
    sideEffects: steps.flatMap(({ process, window }) => [
      ...window.avoided.map((e) => ({ ...e, step: process.id, avoided: true,
                                      inPlan: nodes.has(e.id) })),
      ...window.unavoidable.map((e) => ({ ...e, step: process.id, avoided: false,
                                          inPlan: nodes.has(e.id) })),
    ]),
    scale,
    apparatus,
    cycles: [],
    sharedPins: new Map(),
    converged: true,
    unreachable: spec.targets
      .filter((t) => rcmp(made.get(t.name) || R0, rmul(rat(t.amount), scale)) < 0)
      .map((t) => t.name),
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
