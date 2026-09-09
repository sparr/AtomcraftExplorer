/**
 * A plan as a picture: what feeds what, laid out so it can be read.
 *
 * Sparr asked for this at the start of the project and again now, wondering
 * about libraries for spring forces and untangling. The single-file build
 * settles half of that: `dist/atomcraft-explorer.html` inlines every module
 * and fetches nothing, so a layout library would have to be vendored into the
 * repository and inlined with the rest. That is a fair thing to do and it is
 * not what this needs, because the interesting half of the problem is not the
 * physics.
 *
 * A reaction plan is not a social network. Dropped into a plain force
 * simulation it settles into a hairball, because springs know only that
 * connected things should be near each other -- and what a reader wants to
 * know first is which way the material flows. So the flow is decided first, by
 * layering: everything the plan starts from on the left, everything it makes
 * on the right, each step to the right of what it eats. Then the crossings are
 * combed out within each layer, which is where the untangling actually
 * happens. Only then do springs run, and only along the layer, where they
 * spread things that would otherwise sit on top of each other and let a
 * dragged node push its neighbours aside.
 *
 * That order matters: relaxing before the combing undoes it, and combing
 * without the layering has nothing to comb along.
 */
import { rnum } from './rational.js';

/** A step is a box; a material is a chip. Both are nodes here. */
const STEP = 'step';
const MATERIAL = 'material';

/**
 * The edges that close a loop, found so they can be left out of the layering.
 *
 * A plan is full of wheels -- that is what charges are for -- and a wheel has
 * no left-to-right reading. Relaxing ranks over one does not converge on
 * anything: it walks the cycle raising everything by one each time round, and
 * the Lepidolite plan came out with a step at rank 292 of a fifty-node graph,
 * a picture five thousand pixels wide and one node tall in most columns.
 *
 * So a depth-first walk marks every edge that points back at something already
 * on the stack. Those are the closing edges; the rest is a directed acyclic
 * graph and lays out properly. The marked ones are still drawn -- a loop the
 * reader cannot see is a loop they will not understand -- but drawn as what
 * they are, an arrow pointing back the way it came.
 */
function backEdges(nodes, edges) {
  const out = new Map();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from).push(e);
  }
  const state = new Map();                    // unseen | open | done
  const back = new Set();
  const walk = (id) => {
    state.set(id, 'open');
    for (const e of out.get(id) || []) {
      const at = state.get(e.to);
      if (at === 'open') back.add(e);
      else if (at === undefined) walk(e.to);
    }
    state.set(id, 'done');
  };
  for (const n of nodes) if (!state.has(n.id)) walk(n.id);
  return back;
}

/**
 * Longest path from the things nothing makes.
 *
 * A material's layer is one past the step that makes it, and a step's is one
 * past the last of what it eats, so an edge always points right. Only the
 * forward edges are counted; the ones that close a wheel are set aside first.
 */
function rank(nodes, edges, back) {
  const into = new Map();
  for (const e of edges) {
    if (back.has(e)) continue;
    if (!into.has(e.to)) into.set(e.to, []);
    into.get(e.to).push(e.from);
  }
  for (const n of nodes) n.rank = 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const n of nodes) {
      let want = 0;
      for (const from of into.get(n.id) || []) {
        want = Math.max(want, (byId.get(from)?.rank ?? 0) + 1);
      }
      if (want > n.rank) { n.rank = want; moved = true; }
    }
    if (!moved) break;
  }
}

/**
 * Fewer crossings, by putting each node beside the average of its neighbours.
 *
 * The median heuristic, swept forwards and back a few times. It is not
 * optimal -- minimising crossings exactly is NP-hard and nobody needs the
 * exact answer -- but it is what turns a plan of twenty steps from a cat's
 * cradle into something with legible strands, and it costs a few passes over
 * the edge list.
 */
function comb(layers, edges, rounds = 4, settle = null) {
  const near = new Map();
  const add = (a, b) => { if (!near.has(a)) near.set(a, []); near.get(a).push(b); };
  for (const e of edges) { add(e.to, e.from); add(e.from, e.to); }

  const place = (layer) => new Map(layer.map((n, i) => [n.id, i]));

  /**
   * How many pairs of edges cross, read off the running order alone.
   *
   * Wanted during the sweeping, before anything has coordinates, so it counts
   * on `at` rather than on `y`: two edges between the same pair of layers
   * cross when one starts above the other and ends below it.
   */
  const tangled = () => {
    const at = new Map();
    layers.forEach((layer, r) => layer.forEach((n, i) => at.set(n.id, [r, i])));
    const spans = [];
    for (const e of edges) {
      const a = at.get(e.from);
      const b = at.get(e.to);
      if (a && b && b[0] === a[0] + 1) spans.push([a[0], a[1], b[1]]);
    }
    let n = 0;
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        if (spans[i][0] !== spans[j][0]) continue;
        if ((spans[i][1] - spans[j][1]) * (spans[i][2] - spans[j][2]) < 0) n++;
      }
    }
    return n;
  };

  /**
   * Keep the best sweep, not the last one.
   *
   * The sweeps alternate direction and each is only a heuristic, so they
   * wander: the Lepidolite plan goes from twenty-five crossings to twelve on
   * the first pass and back up to eighteen by the fourth, and the Columbite
   * one from twelve to three to two. Running more rounds and taking whatever
   * fell out last was leaving the picture worse than one round would have.
   */
  if (settle) layers.forEach(settle);
  let best = layers.map((layer) => [...layer]);
  let fewest = tangled();
  for (let round = 0; round < rounds; round++) {
    const list = round % 2 === 0 ? layers : [...layers].reverse();
    for (let i = 1; i < list.length; i++) {
      const fixed = place(list[i - 1]);
      const median = (n) => {
        const seen = (near.get(n.id) || []).map((m) => fixed.get(m)).filter((v) => v !== undefined);
        if (!seen.length) return n.at ?? 0;
        seen.sort((a, b) => a - b);
        return seen[(seen.length - 1) >> 1];
      };
      list[i].sort((a, b) => median(a) - median(b));
      list[i].forEach((n, k) => { n.at = k; });
    }
    if (settle) layers.forEach(settle);
    const now = tangled();
    if (now < fewest) { fewest = now; best = layers.map((layer) => [...layer]); }
  }
  layers.forEach((layer, r) => {
    layer.length = 0;
    layer.push(...best[r]);
    layer.forEach((n, k) => { n.at = k; });
  });
}

/**
 * The plan as nodes and edges, laid out.
 *
 * Materials and steps both become nodes, which is the honest shape: a plan is
 * a bipartite graph and drawing it as one means every arrow says the same
 * thing, "this goes into that". Drawing only the steps would need an arrow to
 * carry a label saying which material it stood for, and a reader chasing one
 * material through five reactions would have nothing to follow.
 */
/**
 * How far apart, along the flow and across it.
 *
 * A box is 150 wide and 34 tall, so the room it needs depends entirely on
 * which way the picture runs. Drawn in columns, the flow needs the width and
 * the layer needs the height; turned on its side those swap, and using one
 * pair of numbers for both is what made the turned picture a column of
 * overlapping boxes with vast gaps between the rows.
 */
export const SPACING = {
  down: { gapX: 190, gapY: 58 },        // flow left to right
  across: { gapX: 72, gapY: 176 },      // flow top to bottom, the boxes side by side
};

export function layoutPlan(plan, { gapX = 190, gapY = 58, rounds = 4,
                                  materials = false } = {}) {
  if (!plan || !plan.steps) return { nodes: [], edges: [], width: 0, height: 0 };
  const nodes = [];
  const edges = [];
  const seen = new Map();

  const amountOf = (name) => {
    const f = plan.frontier.find((x) => x.name === name);
    if (f) return rnum(f.amount);
    const h = plan.feed.find((x) => x.name === name);
    if (h) return rnum(h.amount);
    return null;
  };
  const roleOf = (name) => {
    if (plan.spec.targets.some((t) => t.name === name)) return 'want';
    if (plan.frontier.some((f) => f.name === name)) return 'fetch';
    if (plan.feed.some((f) => f.name === name)) return 'have';
    if (plan.byproducts.some((b) => b.name === name)) return 'spare';
    return 'inner';
  };
  const material = (name) => {
    const id = `m:${name}`;
    if (!seen.has(id)) {
      const node = { id, kind: MATERIAL, name, label: name,
                     role: roleOf(name), amount: amountOf(name) };
      seen.set(id, node);
      nodes.push(node);
    }
    return seen.get(id);
  };

  for (const step of plan.steps) {
    const id = `s:${step.process.id}`;
    const node = { id, kind: STEP, name: step.process.label,
                   label: step.process.label, runs: rnum(step.runs),
                   kindOf: step.process.kind };
    seen.set(id, node);
    nodes.push(node);
  }

  if (materials) {
    for (const step of plan.steps) {
      const id = `s:${step.process.id}`;
      for (const i of step.process.consumes || []) {
        edges.push({ from: material(i.name).id, to: id, count: i.count });
      }
      for (const o of step.process.produces || []) {
        edges.push({ from: id, to: material(o.name).id, count: o.count });
      }
    }
  } else {
    /**
     * Sparr: a node for every material as well as every reaction may be too
     * busy -- put the reactions on the nodes and the materials on the arrows.
     *
     * It is the denser drawing and it says the same thing. A material with one
     * maker and one user was three marks and two arrows; it is now one arrow
     * with a word on it. Where a material has several makers or several users
     * the arrows multiply instead, which is honest: that really is a place
     * where the reader has to decide which supply feeds which use.
     *
     * The three ends of a plan need somewhere to attach, so they become
     * reactions of a sort: everything the reader brings comes out of "what you
     * put in", everything left at the end goes into "what you get", and a
     * charge is laid in by "what you start with". Without them the arrows that
     * matter most -- the ore going in, the metal coming out -- would have only
     * one end.
     */
    const pseudo = (id, label, role) => {
      if (seen.has(id)) return seen.get(id);
      const node = { id, kind: STEP, pseudo: true, label, name: label, role };
      seen.set(id, node);
      nodes.push(node);
      return node;
    };
    const makers = new Map();
    const users = new Map();
    for (const step of plan.steps) {
      const id = `s:${step.process.id}`;
      for (const o of step.process.produces || []) {
        if (!makers.has(o.name)) makers.set(o.name, []);
        makers.get(o.name).push([id, o.count]);
      }
      for (const i of step.process.consumes || []) {
        if (!users.has(i.name)) users.set(i.name, []);
        users.get(i.name).push([id, i.count]);
      }
    }
    const brought = new Set([...plan.feed.map((f) => f.name), ...plan.frontier.map((f) => f.name)]);
    const primed = new Set(plan.priming.map((c) => c.name));
    const kept = new Set([...plan.spec.targets.map((t) => t.name),
                          ...plan.byproducts.map((b) => b.name)]);

    for (const name of new Set([...makers.keys(), ...users.keys()])) {
      const from = makers.get(name) || [];
      const to = users.get(name) || [];
      const label = name;
      for (const [a] of from) {
        for (const [b] of to) edges.push({ from: a, to: b, label, role: 'inner' });
      }
      if (brought.has(name) && to.length) {
        const src = pseudo('in', 'what you put in', 'have');
        for (const [b] of to) edges.push({ from: src.id, to: b, label, role: roleOf(name) });
      }
      if (primed.has(name) && to.length) {
        const src = pseudo('prime', 'what you start with', 'prime');
        for (const [b] of to) edges.push({ from: src.id, to: b, label, role: 'prime' });
      }
      if (kept.has(name) && from.length) {
        const sink = pseudo('out', 'what you get', 'want');
        for (const [a] of from) edges.push({ from: a, to: sink.id, label, role: roleOf(name) });
      }
    }
  }

  /**
   * One arrow between any two reactions, however many things it carries.
   *
   * Three decompositions of the same ore all hand their steam to the same
   * condenser, and drawn as three arrows between the same two boxes they are
   * three lines on top of each other saying one thing. Joined into one, with
   * both names on it, the Columbite plan drops from eighty-seven arrows to
   * rather fewer and from three hundred crossings to something a reader can
   * follow.
   */
  if (!materials) {
    const joined = new Map();
    for (const e of edges) {
      const key = `${e.from}\u0000${e.to}`;
      const had = joined.get(key);
      if (!had) { joined.set(key, { ...e, labels: [e.label] }); continue; }
      if (e.label && !had.labels.includes(e.label)) had.labels.push(e.label);
    }
    edges.length = 0;
    for (const e of joined.values()) {
      e.label = e.labels.filter(Boolean).join(', ');
      delete e.labels;
      edges.push(e);
    }
  }

  const back = backEdges(nodes, edges);
  for (const e of edges) e.back = back.has(e);
  rank(nodes, edges, back);

  /**
   * A long arrow gets somewhere to stand in every column it crosses.
   *
   * Sparr: the line from the Columbite to its reaction cuts behind a dozen
   * other things. It does, and no amount of reordering the two ends will fix
   * it, because nothing in the columns between knows the line is passing
   * through. So it is given a place there: an invisible node in each column it
   * crosses, threaded onto the same combing as everything else. The comb then
   * treats the line as a thing to be kept out of the way, and it comes out
   * running between the nodes rather than behind them.
   *
   * This is the piece that makes a layered drawing readable, and it is why
   * long edges are the standard hard case: without it the picture is only
   * tidy where the arrows happen to be short.
   */
  const byId0 = new Map(nodes.map((n) => [n.id, n]));
  const segments = [];
  const wires = [];
  let bends = 0;
  for (const e of edges) {
    const a = byId0.get(e.from);
    const b = byId0.get(e.to);
    if (!a || !b) continue;
    /**
     * The arrows that close a wheel need standing room too.
     *
     * Sparr: the dotted lines intersect many things and probably need their
     * own invisible nodes. They do, and for the same reason the forward ones
     * did -- a line drawn straight from a step back to something five columns
     * behind it passes over everything in between, and nothing in between
     * knows. The only difference is which way it is read: the waypoints are
     * laid down along the columns it crosses exactly as before, and the line
     * is drawn through them backwards.
     */
    const lo = Math.min(a.rank, b.rank);
    const hi = Math.max(a.rank, b.rank);
    if (hi - lo <= 1) {
      segments.push(e);
      wires.push({ from: e.from, to: e.to, back: e.back, count: e.count,
                   label: e.label, role: e.role, points: [a, b] });
      continue;
    }
    const low = a.rank < b.rank ? a : b;
    const high = a.rank < b.rank ? b : a;
    const through = [];
    let last = low;
    for (let r = lo + 1; r < hi; r++) {
      const bend = { id: `b:${bends++}`, kind: 'bend', rank: r, label: '' };
      nodes.push(bend);
      through.push(bend);
      segments.push({ from: last.id, to: bend.id, bend: true });
      last = bend;
    }
    segments.push({ from: last.id, to: high.id, bend: true });
    // Drawn the way the arrow is read, which for a closing edge is backwards.
    const points = a === low ? [a, ...through, b] : [a, ...through.reverse(), b];
    wires.push({ from: e.from, to: e.to, back: e.back, count: e.count,
                 label: e.label, role: e.role, points });
  }

  const byRank = new Map();
  for (const n of nodes) {
    if (!byRank.has(n.rank)) byRank.set(n.rank, []);
    byRank.get(n.rank).push(n);
  }
  const layers = [...byRank.keys()].sort((a, b) => a - b).map((r) => byRank.get(r));
  layers.forEach((layer) => layer.forEach((n, i) => { n.at = i; }));
  /**
   * Sparr: the oxide leftovers are spread among the useful outputs; they
   * should be together at one end, and the ones with further use grouped.
   *
   * Nothing waits on a leftover, so the comb has no opinion about where one
   * goes and drops it wherever the median landed -- among the things that do
   * matter. Sorted to the end of its column it costs no crossing the comb was
   * avoiding, because an arrow that ends there ends there whatever height it
   * ends at.
   *
   * Applied inside the sweep rather than after it, which is where it started:
   * the comb keeps its best round, and a round rearranged afterwards is not
   * the round it measured. On the smallest plan that turned one crossing into
   * three.
   */
  const feedsOn = new Set();
  for (const e of segments) feedsOn.add(e.from);
  const endsHere = (n) => !feedsOn.has(n.id) && n.kind !== 'bend';
  const groupDeadEnds = (layer) => {
    const going = layer.filter((n) => !endsHere(n));
    const ending = layer.filter(endsHere);
    if (!ending.length || !going.length) return;
    layer.length = 0;
    layer.push(...going, ...ending);
    layer.forEach((n, i) => { n.at = i; });
  };
  comb(layers, segments, rounds, groupDeadEnds);

  const tallest = Math.max(1, ...layers.map((l) => l.length));
  for (const layer of layers) {
    // Centred in the column, so a short layer sits beside the middle of a long
    // one rather than at its top.
    const top = (tallest - layer.length) / 2;
    layer.forEach((n, i) => {
      n.x = n.rank * gapX;
      n.y = (top + i) * gapY;
    });
  }
  return {
    nodes,
    edges: segments,
    wires,
    gapX,
    gapY,
    width: (layers.length - 1) * gapX,
    height: (tallest - 1) * gapY,
  };
}

/**
 * One tick of the springs, along the layer only.
 *
 * Ranks are the one thing the reader can rely on -- everything to the left of
 * a step goes into it -- so a force that moved a node between columns would be
 * trading the only guarantee the picture makes for a prettier tangle. What is
 * left is worth having: connected things pull level with each other, so a long
 * strand straightens out, and things in the same column push apart so nothing
 * hides behind anything.
 *
 * A dragged node is pinned and pushes; that is the whole of the interaction.
 */
export function relax(state, { spring = 0.05, repel = 26, reach = null,
                               damp = 0.78, cap = 14 } = {}) {
  reach = reach ?? (state.gapY ? state.gapY * 1.1 : 64);
  const { nodes, edges } = state;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) n.vy = n.vy ?? 0;

  for (const e of edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const pull = (b.y - a.y) * spring;
    if (!a.held) a.vy += pull;
    if (!b.held) b.vy -= pull;
  }

  /**
   * Push apart, but only near, and never harder than a shove.
   *
   * An inverse-square repulsion is what a physics engine would use and it is
   * wrong here: two nodes that start level are zero apart, the force is
   * unbounded, and the whole picture explodes. The Columbite plan was still
   * moving two thousand pixels a tick after four hundred of them. What is
   * actually wanted is much smaller -- keep neighbours in a column from
   * sitting on top of each other -- so the push falls off to nothing over one
   * node's height and is capped on the way.
   */
  const byRank = new Map();
  for (const n of nodes) {
    if (!byRank.has(n.rank)) byRank.set(n.rank, []);
    byRank.get(n.rank).push(n);
  }
  for (const layer of byRank.values()) {
    for (let i = 0; i < layer.length; i++) {
      for (let j = i + 1; j < layer.length; j++) {
        const a = layer[i];
        const b = layer[j];
        const d = b.y - a.y;
        const away = Math.abs(d);
        if (away >= reach) continue;
        // Level with each other and needing to be told apart: the one listed
        // first goes up, which is arbitrary and settles.
        const dir = away < 1e-6 ? (i < j ? -1 : 1) : Math.sign(d);
        const push = repel * (1 - away / reach) * dir;
        if (!a.held) a.vy -= push;
        if (!b.held) b.vy += push;
      }
    }
  }

  /**
   * Reported per node, because a total says nothing about a picture's size.
   *
   * The Lepidolite plan carries a hundred and forty invisible waypoints
   * alongside its fifty real nodes, and a total of one and a third pixels
   * across all of them is seven thousandths each -- which is still. Judged by
   * the total it looked like a simulation that would not settle.
   */
  let moved = 0;
  let free = 0;
  for (const n of nodes) {
    if (n.held) { n.vy = 0; continue; }
    n.vy = Math.max(-cap, Math.min(cap, n.vy * damp));
    n.y += n.vy;
    moved += Math.abs(n.vy);
    free += 1;
  }
  return free ? moved / free : 0;
}

/** How many edges cross, for saying whether the combing did anything. */
export function crossings(state) {
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const spans = [];
  for (const e of state.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (a && b && b.rank === a.rank + 1) spans.push([a.rank, a.y, b.y]);
  }
  let n = 0;
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i][0] !== spans[j][0]) continue;
      const [, a1, b1] = spans[i];
      const [, a2, b2] = spans[j];
      if ((a1 - a2) * (b1 - b2) < 0) n++;
    }
  }
  return n;
}
