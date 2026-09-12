/**
 * Whether two recipes, taken together, hand back more of an element than went
 * in -- and the atom counting that answers it.
 *
 * Its own module because two callers need exactly the same arithmetic and must
 * not drift: the gate in `plan-fresh.js` that decides whether a listed bug is
 * still a bug, and `tools/find-wheels.mjs`, which uses it to pick the culprit
 * out of a loop. Keeping it in the solver meant the generator importing the
 * solver, which imports the generator's own output -- a knot that only held
 * while that output happened to exist.
 */

/** A process's inputs: what it spends, and what it needs standing by. */
const inputsOf = (p) => [...p.consumes, ...p.requires];

/**
 * Atoms of one element in one unit, where the formula can be counted.
 *
 * `null` means the question cannot be answered -- no formula, an unknown
 * symbol, or a slot that is one thing or another like `Fe(Ta,Nb)2O6`.
 */
export function atomsIn(graph, name, element) {
  const ast = graph.db.byName.get(name)?.formula?.ast;
  if (!ast) return null;
  let total = 0;
  let ok = true;
  /**
   * The same arithmetic `tally` in `formula.js` does, and it has to be: this
   * walked the tree itself and quietly dropped two node kinds it had no case
   * for.
   *
   * A `coeff` is the number in front of a segment -- `HNO3 + 3HCl` for aqua
   * regia, `CaSO4·2H2O` for gypsum, `2 H2` for Hydrogen Gas x2 -- and skipping
   * it counted one hydrogen where there are four, three where there are three
   * chlorine, and two hydrogen in a container that holds four. Which is what
   * had `rx:Expansion of Hydrogen Gas x2` reading as making two hydrogen out
   * of nothing: one packet in at two, two gas out at two each. It holds four,
   * and `atoms` on the material has said so all along.
   *
   * A `pct` is a percentage, and 17% Co 83% Fe is not a count of anything --
   * so it is not counted, it is declined. Dropping it silently made a unit of
   * Molten Cobalt Steel read as one cobalt and one iron, and six of them out
   * of one cobalt and five iron as five cobalt and an iron created.
   */
  const walk = (items, mult) => {
    let pending = mult;
    for (const node of items) {
      if (!ok) return;
      switch (node.k) {
        case 'coeff': pending = mult * node.n; break;
        case 'el': if (node.sym === element) total += node.n * pending; break;
        case 'group':
          if (node.branches.length !== 1) { ok = false; return; }
          walk(node.branches[0], node.n * pending);
          break;
        // A segment break ends whatever coefficient was in front of it.
        case 'sep': pending = mult; break;
        case 'pct': ok = false; return;
        case 'unknown': ok = false; return;
        default: break;
      }
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
/**
 * Whichever of the two is named first.
 *
 * The handoff is looked for one way round -- what `a` makes that `b` eats --
 * and a pair named the other way finds nothing and is declared unprovable at
 * the first line. Three of the sixteen pairs `find-wheels.mjs` turns up are
 * named that way: the manganese dissolve against the condense that hands the
 * manganese back, the quicklime against the recipe that makes its hydrochloric
 * acid, and the potassium sulfide decomposition against the recipe that makes
 * the sulfide. All three were reported as "cannot count the H" or "cannot
 * count the O" -- which was never the trouble, every material in them counts
 * -- and all three exclusions sat disarmed.
 *
 * What they let through is not subtle. Asked for Oxygen Gas, the plan buys
 * nothing at all and hands back three of it a batch, turning potassium and
 * sulfur in a circle while the oxygen falls out of
 * `rx:Potassium Sulfide Decomposition`, which takes two Potassium Sulfide and
 * gives back two Potassium Oxide and two Sulfur Dioxide Gas.
 *
 * So the pair is tried the other way round before being given up on, which is
 * what the comment beside `KNOWN_BUGS` always said happened. The arithmetic
 * below nets the element whichever recipe is named first, so nothing else
 * needs to change.
 */
export function mintsElement(graph, a, b, element, swapped = false) {
  if (!a || !b) return false;
  const shared = a.produces.find((o) => b.consumes.some((c) => c.name === o.name));
  if (!shared) return swapped ? false : mintsElement(graph, b, a, element, true);
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
