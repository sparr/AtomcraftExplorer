/**
 * What each material is made of, where the game does not say.
 *
 * 1038 of the 1871 materials carry a formula. The gaps are not evenly spread:
 * they fall on exactly the compounds a plan passes through. Every material on
 * the road from Columbite to tantalum metal -- Heptafluorotantalic Acid, the
 * potassium heptafluorotantalate, Tantalum Pentoxide -- has no formula at all,
 * so "this leftover has tantalum in it" was a question nothing could answer.
 *
 * It can be worked out, because the reactions are a system of statements about
 * where the atoms went. Three sources of evidence, strongest first, because
 * they are not equally trustworthy:
 *
 *   1. The formula, where there is one.
 *   2. A phase change, which is the same substance in another state. Silica
 *      melts into Molten Silica, so both are SiO2. Hard, and worth 215
 *      materials on its own.
 *   3. The reactions, which are only *mostly* conservation. Soft.
 *
 * Only presence is worked out, never counts. Counts would need the reactions to
 * balance and they do not -- one Aqueous Potassium Heptafluorotantalate(V)
 * really does come back as one Tantalum Pentoxide, which is two tantalum atoms
 * out for one in. Presence survives that; arithmetic would not.
 *
 * None of this is chemistry the game shipped, so it is kept apart from
 * `formula` and carries where it came from. An inference must never be able to
 * pass for a fact.
 */
import { operatingWindow } from './plan-graph.js';

/** Worked out once per graph: it walks every reaction several times over. */
const cache = new WeakMap();

/** The elements a parsed formula mentions, alternates and all. */
function fromFormula(material) {
  const ast = material?.formula?.ast;
  if (!ast) return null;
  const found = new Set();
  const walk = (items) => {
    for (const node of items) {
      if (node.k === 'el') found.add(node.sym);
      // `Fe(Ta,Nb)2O6` is two slots that are each one or the other, so
      // Columbite mentions both without containing two of each. For a question
      // about presence that is the right reading; for counts it would not be.
      else if (node.k === 'group') node.branches.forEach(walk);
    }
  };
  walk(ast);
  return found.size ? found : null;
}

/**
 * Reactions sharing a chamber, rolled into one.
 *
 * A branch of a probabilistic split is not a statement about conservation.
 * Lepidolite's three decompositions divide the same feed one way in three, and
 * the branch that makes the lithium does not mention the potassium at all --
 * so read on its own it says the potassium turned into silica, which is how
 * Molten Silica came out as "K Si Al". Read together, at one run each the way
 * the rest of the planner reads them, the potassium is accounted for by the
 * branch that actually carries it.
 *
 * Nine chambers out of 687 reactions, and they were the ones doing the damage.
 */
function constraintsOf(graph) {
  const reactions = graph.processes.filter((p) =>
    p.kind === 'reaction' && p.consumes.length && p.produces.length);
  const done = new Set();
  const out = [];

  for (const p of reactions) {
    if (done.has(p.id)) continue;
    const rivals = operatingWindow(p, true).competition;
    const members = rivals && rivals.length > 1
      ? rivals.map((m) => graph.byId.get(m.id)).filter(Boolean)
      : [p];
    for (const m of members) done.add(m.id);

    const roll = (pick) => {
      const total = new Map();
      for (const m of members) {
        for (const { name, count } of pick(m)) total.set(name, (total.get(name) || 0) + count);
      }
      return [...total].map(([name, count]) => ({ name, count }));
    };
    out.push({ consumes: roll((m) => m.consumes), produces: roll((m) => m.produces) });
  }
  return out;
}

/**
 * Everything the graph can say about what things are made of.
 *
 * Returns material name -> `{ elements, source, votes }`. `source` is
 * 'formula', 'phase' or 'voted', and the caller is expected to care which.
 */
export function composition(graph) {
  const hit = cache.get(graph);
  if (hit) return hit;

  const known = new Map();      // name -> Set, hard
  const source = new Map();     // name -> 'formula' | 'phase'

  for (const m of graph.db.materials) {
    const set = fromFormula(m);
    if (set) { known.set(m.name, set); source.set(m.name, 'formula'); }
  }

  /**
   * A phase change carries the formula across, because it is the same stuff.
   *
   * Guarded twice. One material in and one out, so a decomposition dressed as
   * a phase change cannot qualify. And the state has to actually change:
   * "Bitter Oyster Spore turns into Carbon" is filed as a phase change and is
   * Solid to Solid, which is the game using the mechanism for something else
   * entirely -- taken as identity it would declare a mushroom to be carbon.
   */
  for (let round = 0; round < 10; round++) {
    let changed = false;
    for (const p of graph.processes) {
      if (p.kind !== 'phase' || p.consumes.length !== 1 || p.produces.length !== 1) continue;
      const from = p.consumes[0].name;
      const to = p.produces[0].name;
      if (!graph.stateOf(from) || !graph.stateOf(to)) continue;
      if (graph.stateOf(from) === graph.stateOf(to)) continue;
      for (const [a, b] of [[from, to], [to, from]]) {
        if (!known.has(a) || known.has(b)) continue;
        known.set(b, new Set(known.get(a)));
        source.set(b, 'phase');
        changed = true;
      }
    }
    if (!changed) break;
  }

  /**
   * Then the reactions argue about the rest, and are believed on a majority.
   *
   * Two ways a reaction has an opinion. If one side has exactly one material
   * nothing is known about, whatever the other side brought that the rest of
   * this side cannot account for has to be in it. And if the other side is
   * wholly known and never mentions an element, then nothing on this side
   * contains it -- which is the more useful half, because it rules things out.
   *
   * Neither is sound on its own: the game's reactions lose and gain atoms, and
   * the same chemistry is sometimes written twice with the two copies
   * disagreeing. So they are counted rather than trusted, and a soft answer
   * feeds the next pass -- the acid can only be read once the salt beside it
   * is, and the salt once the acid is.
   */
  const constraints = constraintsOf(graph);
  const every = new Set();
  for (const set of known.values()) for (const el of set) every.add(el);

  const voted = new Map();      // name -> Set
  const tally = new Map();      // name -> Map(el -> {yes, no})
  const evidence = (name) => known.get(name) || voted.get(name);

  for (let pass = 0; pass < 6; pass++) {
    const round = new Map();
    const vote = (name, el, side) => {
      let per = round.get(name);
      if (!per) round.set(name, per = new Map());
      const count = per.get(el) || { yes: 0, no: 0 };
      count[side]++;
      per.set(el, count);
    };

    for (const c of constraints) {
      for (const [side, other] of [[c.produces, c.consumes], [c.consumes, c.produces]]) {
        if (!other.every(({ name }) => evidence(name))) continue;
        const theirs = new Set();
        for (const { name } of other) for (const el of evidence(name)) theirs.add(el);

        const blank = side.filter(({ name }) => !evidence(name));
        if (blank.length === 1) {
          const ours = new Set();
          for (const { name } of side) for (const el of (evidence(name) || [])) ours.add(el);
          for (const el of theirs) if (!ours.has(el)) vote(blank[0].name, el, 'yes');
        }
        for (const { name } of blank) {
          for (const el of every) if (!theirs.has(el)) vote(name, el, 'no');
        }
      }
    }

    let changed = false;
    for (const [name, per] of round) {
      if (known.has(name)) continue;
      for (const [el, count] of per) {
        if (count.yes <= count.no) continue;
        let set = voted.get(name);
        if (!set) voted.set(name, set = new Set());
        if (!set.has(el)) { set.add(el); changed = true; }
      }
    }
    tally.clear();
    for (const [name, per] of round) tally.set(name, per);
    if (!changed) break;
  }

  const out = new Map();
  for (const [name, elements] of known) {
    out.set(name, { elements, source: source.get(name), votes: null });
  }
  for (const [name, elements] of voted) {
    if (out.has(name)) continue;
    out.set(name, { elements, source: 'voted', votes: tally.get(name) || null });
  }
  cache.set(graph, out);
  return out;
}

/** Does this material contain that element, as far as anything can tell? */
export function contains(graph, name, element) {
  return composition(graph).get(name)?.elements.has(element) ?? false;
}

/**
 * The elements a set of materials is made of, for asking whether something else
 * is worth keeping. "Does this leftover have any tantalum in it" is the whole
 * question a plan needs answered about its own waste.
 */
export function elementsOf(graph, names) {
  const all = new Set();
  const table = composition(graph);
  for (const name of names) {
    for (const el of (table.get(name)?.elements || [])) all.add(el);
  }
  return all;
}
