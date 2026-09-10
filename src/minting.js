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
export function mintsElement(graph, a, b, element) {
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
