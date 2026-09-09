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
import { rnum, rstr, rat, radd, rsub, rmul, rdiv, rcmp, rmin, R0 } from './rational.js';
import { dag } from './dag.js';

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
  down: { gapX: 190, gapY: 58 },                 // flow left to right
  across: { gapX: 72, gapY: 176, turned: true }, // flow top to bottom, boxes side by side
};

/**
 * The plan as nodes and edges, before anything is placed.
 *
 * Pulled out so that the drawing on the page and the DOT written for other
 * layout engines are the same graph. They were two, and every change to what
 * the graph *is* had to be made twice -- the ends stopped being hubs in one
 * of them a day before the other.
 */
export function planGraph(plan, { materials = false, foldPhases = true,
                                  joints = true } = {}) {
  if (!plan || !plan.steps) return { nodes: [], edges: [] };
  const nodes = [];
  const edges = [];
  const seen = new Map();

  const amountOf = (name) => {
    // Targets first: the one box the whole plan is for was the one box
    // without a number on it.
    for (const list of [plan.spec.targets, plan.frontier, plan.feed,
                        plan.priming, plan.byproducts]) {
      const hit = list.find((x) => x.name === name);
      // A target's amount is asked for as a plain number; everything the
      // solver worked out comes back as a rational.
      if (hit) return typeof hit.amount === 'number' ? hit.amount : rnum(hit.amount);
    }
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
    /**
     * Sparr: "Expansion of Hydrogen Gas x2" can be folded in as a phase change
     * of hydrogen, as a one-off rule -- no other material has that.
     *
     * It is one input and one output, the same substance packed two ways, and
     * that is what a phase change is in everything but the game's own
     * bookkeeping. Written as the rule rather than as the name, because the
     * rule is what makes it true; it happens to match exactly one reaction.
     */
    const ins = step.process.consumes || [];
    const outs = step.process.produces || [];
    const packs = ins.length === 1 && outs.length === 1 &&
      (ins[0].name === `${outs[0].name} x2` || outs[0].name === `${ins[0].name} x2`);
    const node = { id, kind: STEP, name: step.process.label,
                   label: step.process.label, runs: rnum(step.runs),
                   runsR: step.runs, kindOf: step.process.kind, packs };
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
     * with a word on it.
     *
     * Where a material has several makers and several users, though, drawing
     * every maker to every user is a lie dressed as caution. Three reactions
     * making steam and six spending it is not eighteen arrows of unknown size;
     * it is a pool, and any way of dividing the pool that adds up is a true
     * account of it. So one is picked: supply is walked against demand in
     * order and each arrow gets the amount that actually passes along it.
     * At most makers-plus-users-minus-one arrows survive, which is fewer than
     * were drawn before, and every one of them now carries a number.
     */
    const pseudo = (id, label, role) => {
      if (seen.has(id)) return seen.get(id);
      const node = { id, kind: STEP, pseudo: true, label, name: label, role };
      seen.set(id, node);
      nodes.push(node);
      return node;
    };

    const supply = new Map();                 // name -> [{ id, amount }]
    const wants = new Map();                  // name -> [{ id, amount }]
    const put = (into, name, entry) => {
      if (rcmp(entry.amount, R0) <= 0) return;
      if (!into.has(name)) into.set(name, []);
      into.get(name).push(entry);
    };

    for (const step of plan.steps) {
      const id = `s:${step.process.id}`;
      for (const o of step.process.produces || []) {
        put(supply, o.name, { id, amount: rmul(step.runs, rat(BigInt(o.count))) });
      }
      for (const i of step.process.consumes || []) {
        put(wants, i.name, { id, amount: rmul(step.runs, rat(BigInt(i.count))) });
      }
    }

    const said = (name) => {
      const a = amountOf(name);
      return a === null ? name : `${a} ${name}`;
    };
    for (const f of [...plan.feed, ...plan.frontier]) {
      if (!wants.has(f.name)) continue;
      put(supply, f.name,
          { id: pseudo(`in:${f.name}`, said(f.name), roleOf(f.name)).id, amount: f.amount });
    }
    for (const t of plan.spec.targets) {
      if (!supply.has(t.name)) continue;
      put(wants, t.name,
          { id: pseudo(`out:${t.name}`, said(t.name), 'want').id,
            amount: rat(BigInt(Math.round(t.amount))) });
    }
    /**
     * Sparr: clean up the "1 Hydrogen Gas x2" leftover, merge it into the
     * hydrogen group.
     *
     * Same substance, packed two ways, which is the rule that made the
     * expansion a phase change three paragraphs ago. Leaving one of it in a
     * box of its own says the plan produced something else, and it did not: it
     * produced two hydrogen and did not get round to unpacking them. So the
     * ends count it as what it is, and any loose hydrogen it lands beside is
     * the same pile.
     */
    const unpack = (name) => (name.endsWith(' x2')
      ? { base: name.slice(0, -3), times: 2n }
      : { base: name, times: 1n });
    const spareTotal = new Map();
    for (const b of plan.byproducts) {
      if (!supply.has(b.name)) continue;
      const { base, times } = unpack(b.name);
      spareTotal.set(base, radd(spareTotal.get(base) || R0, rmul(b.amount, rat(times))));
    }
    for (const b of plan.byproducts) {
      if (!supply.has(b.name)) continue;
      const { base } = unpack(b.name);
      const whole = spareTotal.get(base);
      put(wants, b.name,
          { id: pseudo(`spare:${base}`, `${rnum(whole)} ${base}`, 'spare').id,
            amount: b.amount });
    }

    /**
     * A charge is drawn beside the pool, never taken out of it.
     *
     * Sparr: why does the hydrogen end at a node that is not there, instead of
     * wrapping back up to the electrolysis that was primed?
     *
     * Because the charge was being subtracted from that reaction's demand, as
     * though laying two hydrogen in your hand meant the reaction no longer
     * needed two. It needs two every cycle. What the charge buys is the first
     * cycle, before the loop has come round; the loop supplies every one after
     * that and is repaid. Subtracting it left the expansion's two hydrogen
     * with no use anywhere in the plan, and an arrow with nothing at the end
     * of it -- which is exactly the loop, deleted.
     *
     * So the charge is an extra arrow into the reaction it starts, and the
     * pool is matched without it. The wheel closes.
     */
    for (const c of plan.priming) {
      for (const one of c.forSteps || []) {
        const at = `s:${one.step}`;
        if (!seen.has(at)) continue;
        const src = pseudo(`prime:${c.name}@${one.step}`,
                           `${rnum(one.amount)} ${c.name}`, 'prime');
        edges.push({ from: src.id, to: at, label: '', amount: one.amount, role: 'prime' });
      }
    }

    /**
     * Supply walked against demand, in a fixed order so the same plan draws
     * the same way twice.
     */
    const shareOut = (from, to) => {
      const src = from.filter((x) => rcmp(x.amount, R0) > 0)
        .map((x) => ({ ...x })).sort((a, b) => a.id.localeCompare(b.id));
      const dst = to.filter((x) => rcmp(x.amount, R0) > 0)
        .map((x) => ({ ...x })).sort((a, b) => a.id.localeCompare(b.id));
      const out = [];
      let i = 0;
      let j = 0;
      while (i < src.length && j < dst.length) {
        const take = rmin(src[i].amount, dst[j].amount);
        if (rcmp(take, R0) > 0) out.push({ from: src[i].id, to: dst[j].id, amount: take });
        src[i].amount = rsub(src[i].amount, take);
        dst[j].amount = rsub(dst[j].amount, take);
        if (rcmp(src[i].amount, R0) <= 0) i++;
        if (rcmp(dst[j].amount, R0) <= 0) j++;
      }
      return out;
    };

    const roleOfEdge = (from, to) => {
      const a = seen.get(from);
      const b = seen.get(to);
      if (a?.pseudo) return a.role;
      if (b?.pseudo) return b.role;
      return 'inner';
    };
    for (const name of new Set([...supply.keys(), ...wants.keys()])) {
      for (const f of shareOut(supply.get(name) || [], wants.get(name) || [])) {
        edges.push({ from: f.from, to: f.to, label: name, mat: name, amount: f.amount,
                     role: roleOfEdge(f.from, f.to) });
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
  const join = () => {
    const joined = new Map();
    for (const e of edges) {
      const key = `${e.from}\u0000${e.to}`;
      const had = joined.get(key);
      if (!had) { joined.set(key, { ...e, labels: [e.label] }); continue; }
      for (const l of e.label ? e.label.split(', ') : []) {
        if (!had.labels.includes(l)) had.labels.push(l);
      }
    }
    edges.length = 0;
    for (const e of joined.values()) {
      e.label = [...new Set(e.labels.filter(Boolean))].join(', ');
      delete e.labels;
      edges.push(e);
    }
  };
  /**
   * Sparr: omit the phase changes, folding each into whatever comes next --
   * then, try a rank-holding box for each.
   *
   * Melting a thing is not a reaction, it is the same thing at another
   * temperature, and a box saying "6x Steam condenses into Water" between two
   * boxes doing chemistry is a stile in the middle of a field.
   *
   * Contracting them away cost more than it saved: every arrow that had
   * stopped at one skipped a rank instead, the engine drew a long spline for
   * each, and the ordered picture went curvy. The condensers had been doing
   * quiet work as places for lines to stop. So the box goes and the place it
   * held stays -- the step keeps its node, drawn as a joint, still ranked.
   */
  if (!materials && foldPhases) {
    for (const n of nodes) {
      if (n.kind !== STEP || n.pseudo) continue;
      if (n.kindOf !== 'phase' && !n.packs) continue;
      n.hold = true;
      n.label = '';
    }

    /**
     * Sparr: get rid of the combined nodes for materials in the middle -- the
     * one Steam can be split into a node for each path it appears along, each
     * of which will also have a Water label.
     *
     * One condenser taking steam from three reactions and handing water to six
     * is a crossroads every line in the middle of the plan has to go through,
     * and it is a crossroads the plan never asked for: nothing says this
     * reaction's steam is that reaction's water. Split along the flow already
     * worked out, each path gets its own joint, and no line goes through
     * anything it did not have to. Walking one side against the other keeps
     * the count to ins-plus-outs-minus-one rather than ins-times-outs.
     */
    for (const h of nodes.filter((n) => n.hold)) {
      const ins = edges.filter((e) => e.to === h.id);
      const outs = edges.filter((e) => e.from === h.id);
      if (ins.length <= 1 && outs.length <= 1) continue;
      const sum = (list) => list.reduce((a, e) => radd(a, e.amount || R0), R0);
      const totIn = sum(ins);
      const totOut = sum(outs);
      if (rcmp(totIn, R0) <= 0 || rcmp(totOut, R0) <= 0) continue;
      // Each side as a share of its own total, so the two can be walked
      // against each other however different the counts either side are.
      const left = ins.map((e) => ({ e, share: rdiv(e.amount, totIn) }));
      const right = outs.map((e) => ({ e, share: rdiv(e.amount, totOut) }));
      const made = [];
      let i = 0;
      let j = 0;
      while (i < left.length && j < right.length) {
        const take = rmin(left[i].share, right[j].share);
        if (rcmp(take, R0) > 0) made.push({ a: left[i].e, b: right[j].e, share: take });
        left[i].share = rsub(left[i].share, take);
        right[j].share = rsub(right[j].share, take);
        if (rcmp(left[i].share, R0) <= 0) i++;
        if (rcmp(right[j].share, R0) <= 0) j++;
      }
      if (made.length <= 1) continue;
      const gone = new Set([...ins, ...outs]);
      for (let k = edges.length - 1; k >= 0; k--) if (gone.has(edges[k])) edges.splice(k, 1);
      nodes.splice(nodes.indexOf(h), 1);
      made.forEach((m, k) => {
        const copy = { ...h, id: `${h.id}#${k}`,
                       runsR: rmul(m.share, h.runsR), runs: rnum(rmul(m.share, h.runsR)) };
        nodes.push(copy);
        seen.set(copy.id, copy);
        edges.push({ ...m.a, to: copy.id, amount: rmul(m.share, totIn) });
        edges.push({ ...m.b, from: copy.id, amount: rmul(m.share, totOut) });
      });
    }

    /**
     * Sparr: shorten the bottom of the output path by one level rather than
     * having an empty row with just a hidden node. And colour the molten
     * aluminium arrow like the aluminium arrow -- a phase change into an
     * output is an output.
     *
     * Both are the same joint. One that sits between a reaction and an end has
     * nothing to hold: no other line stops at its rank, so it buys a whole
     * empty row to say that the metal cooled. And what runs through it is not
     * an interior arrow that happens to end at the edge of the picture, it is
     * the plan delivering what was asked for, so it is drawn as one. Folded
     * out, the arrow says what leaves the reaction and the box says what you
     * get: "8 Molten Aluminum" into "8 Aluminum".
     *
     * Only where the joint leads nowhere else. One with a reaction after it is
     * holding a rank for a reason, and stays.
     */
    for (const h of nodes.filter((n) => n.hold).slice()) {
      const outs = edges.filter((e) => e.from === h.id);
      const ins = edges.filter((e) => e.to === h.id);
      if (outs.length !== 1 || !ins.length) continue;
      const end = seen.get(outs[0].to);
      if (!end?.pseudo || (end.role !== 'want' && end.role !== 'spare')) continue;
      const gone = new Set([...ins, ...outs]);
      for (let k = edges.length - 1; k >= 0; k--) if (gone.has(edges[k])) edges.splice(k, 1);
      nodes.splice(nodes.indexOf(h), 1);
      for (const a of ins) {
        edges.push({ ...a, to: end.id, role: end.role, keepName: true });
      }
    }

    /**
     * Sparr: can the lines curve smoothly into each other instead of turning
     * hard at the invisible node?
     *
     * Not while there are two of them. Two arrows meeting at a node are two
     * splines, each routed to the middle of it on its own, and where they meet
     * there is a corner however small the node is made. One arrow through a
     * rank is one spline, and a layout engine bends it smoothly because that
     * is all a long edge ever is.
     *
     * Contracting was tried before and made the picture curvy, but that was
     * when a phase change with three feeders and six eaters became eighteen
     * arrows, each skipping a rank. It is one in and one out now -- the flow
     * is attributed, and a crossroads was split into a joint per path -- so
     * contracting is one arrow for one arrow, and both material names ride it.
     *
     * Kept as marks by default all the same. Contracting suits a phase change
     * standing alone in a chain -- the Carbon plan and the aluminium one both
     * come out smaller -- but the Columbite plan goes from 1454 wide to 2252,
     * because there the joints came of splitting a crossroads and the ranks
     * they hold are carrying other lines. So `joints: false` is offered and
     * not taken, and the smoothing is done where the curve is drawn instead.
     */
    if (!joints) {
      for (const h of nodes.filter((n) => n.hold).slice()) {
        const ins = edges.filter((e) => e.to === h.id);
        const outs = edges.filter((e) => e.from === h.id);
        if (ins.length !== 1 || outs.length !== 1) continue;
        const [a] = ins;
        const [b] = outs;
        if (a.from === b.to) continue;              // a wheel of one, worth nothing
        const gone = new Set([a, b]);
        for (let k = edges.length - 1; k >= 0; k--) if (gone.has(edges[k])) edges.splice(k, 1);
        nodes.splice(nodes.indexOf(h), 1);
        seen.delete(h.id);
        edges.push({ ...a, to: b.to,
                     through: [{ mat: a.mat, amount: a.amount },
                               { mat: b.mat, amount: b.amount }].filter((x) => x.mat),
                     role: b.role === 'inner' ? a.role : b.role,
                     keepName: a.keepName || b.keepName });
      }
    }

    /**
     * Sparr: split up the spare water.
     *
     * Seven reactions leave water over and all seven arrows ended at one box,
     * which is the crossroads again in its last hiding place: the box is
     * ranked below the lowest of its feeders, so the arrow from the highest
     * crosses the picture to reach it, and seven lines converging on one word
     * reads as seven separate leftovers besides.
     *
     * One box per arrow, each beside the reaction it came from, each carrying
     * its own share. The total is unchanged and no line travels to find it.
     * Only the leavings: what you asked for stays in one box, because the
     * amount you asked for is a single fact and splitting it would be telling
     * the reader their four tantalum are two lots of two.
     */
    for (const end of nodes.filter((n) => n.pseudo && n.role === 'spare').slice()) {
      const ins = edges.filter((e) => e.to === end.id);
      if (ins.length <= 1) continue;
      nodes.splice(nodes.indexOf(end), 1);
      seen.delete(end.id);
      ins.forEach((e, k) => {
        const copy = { ...end, id: `${end.id}#${k}`,
                       label: `${rstr(e.amount)} ${e.mat || end.name}` };
        nodes.push(copy);
        seen.set(copy.id, copy);
        e.to = copy.id;
      });
    }

    /**
     * Sparr: get rid of the arrow ends where lines come together at the
     * invisible nodes.
     *
     * An arrowhead is for saying which way a thing goes into something. A
     * joint is not something it goes into, it is a bend in the way, so the
     * line runs through it and only the far end is tipped.
     */
    for (const e of edges) if (seen.get(e.to)?.hold) e.join = true;
  }

  /**
   * Sparr: add the quantities of the materials to the edge labels.
   *
   * Which the arrows can now say, each carrying a definite amount rather than
   * a share of an unknown pool. An arrow onto one of the ends says only the
   * number, and only when the end has more than one arrow: the box beside it
   * already gives the name and the total, and repeating both on every line
   * into it is the picture talking over itself.
   */
  if (!materials) {
    const arrowsAt = new Map();
    for (const e of edges) {
      arrowsAt.set(e.from, (arrowsAt.get(e.from) ?? 0) + 1);
      arrowsAt.set(e.to, (arrowsAt.get(e.to) ?? 0) + 1);
    }
    for (const e of edges) {
      if (!e.label || e.amount === undefined) { e.label = ''; continue; }
      /**
       * Sparr: ditch the fractions, full numbers on the material lines.
       *
       * Dividing by the runs of the box an arrow leaves gave the recipe, which
       * is checkable against the game, but it normalised every arrow to a
       * different denominator. Three carbon dioxide arrives at the electrolysis
       * from three places carrying twelve, two and two, and all three printed
       * "1 Carbon Dioxide" because each was one per run of its own maker. The
       * proportions -- which is where the plan's arithmetic lives -- were
       * invisible without multiplying each arrow by the run count on the box
       * behind it. And it was the only thing producing fractions: eight ninths
       * of a packed hydrogen is a real quantity per run and a silly thing to
       * read.
       *
       * So an arrow says what actually goes along it, whole, and the box still
       * says how many times it runs.
       */
      const each = e.amount;
      // An arrow onto one of the ends says only its number, and only where the
      // end has more than one arrow: the box beside it already gives the name.
      const end = e.keepName ? null : [e.from, e.to].find((x) => seen.get(x)?.pseudo);
      const names = e.through?.length
        ? e.through.map((x) => `${rstr(x.amount)} ${x.mat}`).join(', ')
        : `${rstr(each)} ${e.mat || e.label}`;
      e.label = end ? (arrowsAt.get(end) > 1 ? rstr(each) : '') : names;
    }
    join();
  }


  return { nodes, edges };
}

export function layoutPlan(plan, { gapX = 190, gapY = 58, rounds = 4, turned = false,
                                   materials = false, foldPhases = true } = {}) {
  const built = planGraph(plan, { materials, foldPhases });
  const nodes = built.nodes;
  const edges = built.edges;
  if (!nodes.length) return { nodes: [], edges: [], wires: [], width: 0, height: 0 };

  const back = backEdges(nodes, edges);
  for (const e of edges) e.back = back.has(e);

  /**
   * Sparr: ship d3-dag.
   *
   * The ranking, the ordering within a rank and the places along it were ours,
   * and ours came last of everything measured: fifty crossing pairs on the
   * fluorine plan where d3-dag has twenty and graphviz twenty-three. What is
   * kept is everything above and below the layout -- the graph we hand it, and
   * the drawing, dragging and turning that read what comes back -- so this is
   * a swap of the middle and not of the picture.
   *
   * It wants a graph with no cycles, so the arrows that close a loop are held
   * out and drawn straight afterwards, which is worse than what graphviz does
   * with them and is the first thing to improve.
   *
   * Laid out with the ranks running down and turned a quarter on the way out,
   * because the rest of the code has ranks running across: our x is its y.
   */
  const BOX = { w: 150, h: 34 };
  /**
   * How much room a box wants, in the layout's own frame: across the rank
   * first, along it second. Which way round that is depends on which way the
   * picture runs -- a box is 150 wide and 34 tall however it is turned, so
   * one pair of numbers for both orientations made the turned picture a
   * column of overlapping boxes.
   */
  const sizeOf = (n) => (n.hold ? [7, 7]
    : (turned ? [BOX.w, BOX.h] : [BOX.h, BOX.w]));
  const size = new Map(nodes.map((n) => [n.id, sizeOf(n)]));
  const forward = edges.filter((e) => !e.back);
  const placed = new Map();
  const wires = [];
  const segments = [];

  /**
   * Sparr: gate the exact layout at thirty-two boxes.
   *
   * d3-dag can solve the crossing problem outright rather than heuristically,
   * and below about thirty boxes it costs nothing to ask: the aluminium plan
   * goes from eleven crossings to three for seven more milliseconds, Steel
   * from fourteen to five for ten, and on the smallest plans the exact answer
   * arrives sooner than the guess.
   *
   * Then it falls off a cliff. Thirty-three boxes cost 175ms, thirty-nine cost
   * half a second, and the same thirty-nine with four more arrows cost six
   * seconds -- the arrows drive it harder than the boxes. So it is asked only
   * of the small ones, and its own size check is caught as well, because a
   * number picked from six measurements is not a guarantee.
   */
  const EXACT_UP_TO = 32;
  let dim = { width: 0, height: 0 };
  if (forward.length) {
    const built2 = dag.graphConnect().nodeDatum((id) => id)(
      forward.map((e) => [e.from, e.to]));
    const shape = dag.sugiyama()
      .nodeSize((n) => size.get(n.data) || sizeOf({}))
      .gap([Math.max(6, gapY - (turned ? BOX.w : BOX.h)),
            Math.max(6, gapX - (turned ? BOX.h : BOX.w))]);
    dim = null;
    if (nodes.length <= EXACT_UP_TO) {
      try { dim = shape.decross(dag.decrossOpt().check('oom'))(built2); } catch { dim = null; }
    }
    if (!dim) dim = shape(built2);
    for (const n of built2.nodes()) placed.set(n.data, { x: n.y, y: n.x });
    for (const l of built2.links()) {
      const key = `${l.source.data}\u0000${l.target.data}`;
      const pts = l.points.map(([x, y]) => ({ x: y, y: x }));
      if (!placed.has(`p:${key}`)) placed.set(`p:${key}`, pts);
    }
  }

  /**
   * Anything the layout never saw: a box whose only arrows close a loop is not
   * in the graph handed over, and it still has to go somewhere.
   */
  const ranks = [...new Set([...placed.values()]
    .filter((p) => p && p.x !== undefined).map((p) => p.x))].sort((a, b) => a - b);
  let spare = (ranks[ranks.length - 1] ?? 0) + gapX;
  for (const n of nodes) {
    const at = placed.get(n.id);
    if (at && at.x !== undefined) { n.x = at.x; n.y = at.y; continue; }
    n.x = spare;
    n.y = 0;
    spare += gapX;
  }
  // A column apiece, for the springs and for anything that asks which rank a
  // box is in. The layout gives places, not numbers.
  const column = new Map([...new Set(nodes.map((n) => n.x))].sort((a, b) => a - b)
    .map((x, i) => [x, i]));
  for (const n of nodes) n.rank = column.get(n.x);

  for (const e of edges) {
    segments.push(e);
    const a = nodes.find((n) => n.id === e.from);
    const b = nodes.find((n) => n.id === e.to);
    if (!a || !b) continue;
    const through = placed.get(`p:${e.from}\u0000${e.to}`);
    const points = through && through.length > 2
      ? [a, ...through.slice(1, -1).map((q) => ({ ...q, id: `b:${e.from}:${e.to}` })), b]
      : [a, b];
    wires.push({ from: e.from, to: e.to, back: e.back, count: e.count,
                 label: e.label, role: e.role, join: e.join, points });
  }

  /**
   * Sparr: can the lines curve smoothly into each other rather than turning
   * hard at the invisible node, and the same for all of them?
   *
   * They can, once they stop being two lines. A phase change was the end of
   * one arrow and the start of another, and two curves meeting at a point make
   * a corner there however small the point is. Threaded as one arrow with the
   * joint among its waypoints there is no corner at all: the curve is drawn
   * with its handles along the run at every stop it passes, so the piece
   * arriving and the piece leaving share a tangent.
   *
   * The joint is still drawn and still holds its rank. It is only no longer a
   * place where the drawing stops and starts again.
   */
  const jointAt = new Map(nodes.filter((n) => n.hold).map((n) => [n.id, n]));
  for (const id of jointAt.keys()) {
    const into = wires.filter((w) => w.to === id);
    const outOf = wires.filter((w) => w.from === id);
    if (into.length !== 1 || outOf.length !== 1) continue;
    const [a] = into;
    const [b] = outOf;
    if (a.back || b.back) continue;              // read backwards, threaded apart
    a.to = b.to;
    a.points = [...a.points, ...b.points.slice(1)];
    a.label = [a.label, b.label].filter(Boolean).join(', ');
    a.role = b.role === 'inner' ? a.role : b.role;
    a.join = false;                              // the tip belongs at the far end
    wires.splice(wires.indexOf(b), 1);
  }

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  for (const n of nodes) { n.x -= left; n.y -= top; }
  for (const w of wires) {
    for (const p of w.points) {
      if (p.id) continue;                   // a box, already moved
      p.x -= left;
      p.y -= top;
    }
  }
  return {
    nodes,
    edges: segments,
    wires,
    gapX,
    gapY,
    width: Math.max(...nodes.map((n) => n.x)),
    height: Math.max(...nodes.map((n) => n.y)),
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
