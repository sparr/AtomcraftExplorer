/**
 * The plan drawn as a graph: the sums behind the picture.
 *
 * What is worth checking here is not what it looks like -- nothing in a test
 * can see that -- but the three claims the layout makes. Every arrow points
 * the way the material moves, except the ones that close a wheel and say so.
 * The combing leaves fewer crossings than it found. And the springs settle
 * rather than wander.
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { solveFresh } from '../src/plan-fresh.js';
import { layoutPlan, relax, crossings, SPACING } from '../src/plan-diagram.js';
import { planToDot } from '../src/plan-dot.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const graph = buildProcessGraph(await loadData());
let fail = 0;
const ok = (m) => console.log(`ok    ${m}`);
const bad = (m) => { console.log(`FAIL  ${m}`); fail++; };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const plans = [
  ['carbon out of its dioxide', { targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Dioxide'] }],
  ['the columbite factory', { targets: [{ name: 'Tantalum', amount: 2 }, { name: 'Niobium', amount: 2 }],
                              have: ['Columbite'] }],
  ['lepidolite, all four ways', {
    targets: ['Potassium', 'Lithium', 'Aluminum', 'Silicon']
      .map((name, i) => ({ name, amount: [2, 2, 2, 3][i] })), have: ['Lepidolite'] }],
];

for (const [what, ask] of plans) {
  const plan = solveFresh(graph, ask);
  const state = layoutPlan(plan);
  console.log(`\n--- ${what}`);
  check(state.nodes.length > 0 && state.edges.length > 0,
        `${state.nodes.length} nodes and ${state.edges.length} arrows`);

  // Both halves of the plan are there: a box for every step, a chip for every
  // material any step touches.
  const steps = state.nodes.filter((n) => n.kind === 'step' && !n.pseudo);
  // Sparr: omit the phase changes, folding each into whatever comes next.
  const drawn = plan.steps.filter((st) => st.process.kind !== 'phase');
  check(steps.length === drawn.length,
        `a box for each of the ${drawn.length} steps that is a reaction, `
        + `and none for the ${plan.steps.length - drawn.length} phase changes`);

  /**
   * Sparr: put the reactions on the nodes and the materials on the arrows,
   * with input, output and primer as pseudo-reactions for those connections.
   *
   * Which is the default drawing now. A material with one maker and one user
   * was three marks and two arrows and is now one arrow with a word on it;
   * where it has several of either the arrows multiply instead, which is
   * honest, since that is a place the reader has to decide which supply feeds
   * which use. The three ends of the plan need somewhere to attach or the
   * arrows that matter most -- the ore in, the metal out -- have only one end.
   */
  check(!state.nodes.some((n) => n.kind === 'material'),
        'no material has a box of its own');
  const ends = state.nodes.filter((n) => n.pseudo).map((n) => n.label).sort();
  check(ends.length > 0, `the ends of the plan are reactions of a sort: ${ends.join(', ')}`);
  check(!ends.some((e) => /what you/.test(e)), 'named by the material rather than in a sentence');
  /**
   * Every arrow says what it carries -- on itself, or on the box at its end.
   *
   * An arrow between two reactions has to be labelled, because both its ends
   * are reactions and nothing else says what passes. An arrow to or from an
   * end-material does not: that box *is* the material, and writing the name
   * twice on the same short line is noise.
   */
  const where = new Map(state.nodes.map((n) => [n.id, n]));
  const anonymous = state.wires.filter((w) => {
    if (w.label) return false;
    const ends = [where.get(w.from), where.get(w.to)];
    return !ends.some((n) => n?.pseudo);
  });
  check(!anonymous.length,
        `each of the ${state.wires.length} arrows says what it carries, on itself or its end`);

  // And the other drawing is still there, with a box for every material.
  const full = layoutPlan(plan, { materials: true });
  check(full.nodes.some((n) => n.kind === 'material'),
        `asked for materials, ${full.nodes.filter((n) => n.kind === 'material').length} get boxes`);

  /**
   * Every arrow points right, bar the ones that close a wheel.
   *
   * This is the whole claim the picture makes -- that what is left of a step
   * goes into it -- and it is the one a plain force layout cannot make. A
   * plan is full of loops, so some edges must double back; those are marked,
   * and the check is that nothing else does.
   */
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const wrong = state.edges.filter((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    return !e.back && b.rank <= a.rank;
  });
  check(!wrong.length,
        `every arrow runs left to right unless it closes a loop (${wrong.length} do not)`);
  const loops = state.edges.filter((e) => e.back).length;
  check(loops < state.edges.length,
        `${loops} of ${state.edges.length} arrows close a wheel, and they are marked`);

  /**
   * Long arrows have somewhere to stand in every column they cross.
   *
   * Sparr: the line from the Columbite to its reaction cuts behind a dozen
   * other things. Without a place in the columns between, nothing there knows
   * the line is passing through and no reordering of its two ends can help.
   */
  const bends = state.nodes.filter((n) => n.kind === 'bend');
  const long = state.wires.filter((w) => w.points.length > 2);
  check(long.every((w) => w.points.length === Math.abs(
    byId.get(w.to).rank - byId.get(w.from).rank) + 1),
        `${long.length} long arrows, each standing in every column it crosses (${bends.length} places)`);

  /**
   * And the dead ends are together rather than sprinkled through.
   *
   * Sparr: the oxide leftovers are spread among the useful outputs. Nothing
   * waits on a leftover, so the comb has no opinion about where it goes and
   * drops it wherever the median landed. They are sorted to one end after the
   * combing, which costs nothing it was avoiding.
   */
  const feeds = new Set(state.edges.map((e) => e.from));
  const layers = new Map();
  for (const n of state.nodes) {
    if (!layers.has(n.rank)) layers.set(n.rank, []);
    layers.get(n.rank).push(n);
  }
  const mixed = [...layers.values()].filter((layer) => {
    const sorted = [...layer].sort((a, b) => a.at - b.at);
    let seenEnd = false;
    for (const n of sorted) {
      const ends = !feeds.has(n.id) && n.kind !== 'bend';
      if (ends) seenEnd = true;
      else if (seenEnd) return true;
    }
    return false;
  });
  check(!mixed.length,
        `nothing with further use sits below a dead end (${mixed.length} columns mixed)`);

  /**
   * The closing arrows are routed like the rest.
   *
   * Sparr: the dotted loop lines intersect many things and probably need their
   * own invisible nodes. They do -- a line drawn straight from a step back to
   * something five columns behind passes over everything between, and nothing
   * between knows it is there.
   */
  const loopWires = state.wires.filter((w) => w.back);
  const straightLoops = loopWires.filter((w) => {
    const span = Math.abs(byId.get(w.to).rank - byId.get(w.from).rank);
    return span > 1 && w.points.length !== span + 1;
  });
  check(!straightLoops.length,
        `each of the ${loopWires.length} closing arrows has standing room in every column it crosses`);

  /**
   * And both ways round fit the boxes they hold.
   *
   * A box is 150 wide and 34 tall, so which gap needs to be the big one
   * depends entirely on which way the picture runs. One pair of numbers for
   * both made the turned picture a column of overlapping boxes with vast gaps
   * between the rows.
   */
  for (const [way, gaps] of [['in columns', SPACING.down], ['in rows', SPACING.across]]) {
    const turned = layoutPlan(plan, gaps);
    const layers = new Map();
    for (const n of turned.nodes) {
      if (!layers.has(n.rank)) layers.set(n.rank, []);
      layers.get(n.rank).push(n);
    }
    const boxAcross = way === 'in columns' ? 34 : 150;
    const tooClose = [...layers.values()].some((layer) => {
      const ys = layer.filter((n) => n.kind !== 'bend').map((n) => n.y).sort((a, b) => a - b);
      return ys.some((y, i) => i > 0 && y - ys[i - 1] < boxAcross);
    });
    check(!tooClose, `${way}, nothing in a column overlaps its neighbour`);
  }

  // The combing earns its place.
  const raw = crossings(layoutPlan(plan, { rounds: 0 }));
  const combed = crossings(state);
  check(combed <= raw, `crossings ${raw} uncombed, ${combed} combed`);

  /**
   * And the springs settle rather than wander.
   *
   * They only ever move a node along its own column, so the ranks -- and with
   * them every claim above -- survive being relaxed.
   */
  const before = state.nodes.map((n) => n.rank).join(',');
  let last = Infinity;
  for (let i = 0; i < 400; i++) last = relax(state);
  check(last < 0.02, `the springs come to rest (${last.toFixed(4)} a node still moving)`);
  check(state.nodes.map((n) => n.rank).join(',') === before,
        'and nothing changed column while they did');
}

/**
 * And the same graph, written out for anything that speaks DOT.
 *
 * Sparr: try emitting DOT and letting graphviz lay it out. Worth having
 * whichever way that goes, because it separates two questions that had got
 * tangled: what the graph *is* is settled in one place and is the same graph
 * whoever draws it, and where the boxes go is somebody else's problem.
 */
console.log('\n--- written out as DOT');
{
  const plan = solveFresh(graph, {
    targets: [{ name: 'Tantalum', amount: 2 }, { name: 'Niobium', amount: 2 }],
    have: ['Columbite', 'Lepidolite'], sources: ['world'] });
  const dot = planToDot(plan);
  check(dot.startsWith('digraph plan {') && dot.trimEnd().endsWith('}'),
        'it is a digraph');
  // Every reaction, and the three ends of the plan.
  const boxes = [...dot.matchAll(/^\s+"([^"]+)"\s+\[label=/gm)].map((m) => m[1]);
  const drawn = plan.steps.filter((st) => st.process.kind !== 'phase');
  check(boxes.filter((b) => b.startsWith('s:')).length === drawn.length,
        `a box for each of the ${drawn.length} steps that is a reaction, `
        + `and none for the ${plan.steps.length - drawn.length} phase changes`);
  check(['in:', 'out:', 'prime:', 'spare:'].every((e) => boxes.some((b) => b.startsWith(e))),
        'and one for each material at each end of the plan');
  // What was asked for and what merely fell out are different answers, so
  // they land at different ends rather than the same one in two colours.
  /**
   * Sparr: omit the "(left over)", "(in)" and "(out)", those are obvious from
   * context.
   *
   * So the ends are told apart by where they sit and what colour they are.
   * Wanted output and leftover both hang off the bottom of the plan, and the
   * only thing between them is the ink, so the ink has to differ.
   */
  check(!/\((in|out|left over)\)/.test(dot),
        'no end says in, out or left over: the picture already did');
  const inkOf = (kind) => new Set([...dot.matchAll(
    new RegExp(`^\\s+"${kind}:[^"]+" \\[label=[^\\n]*?color="([^"]+)"`, 'gm'))]
    .map((m) => m[1]));
  const [wantInk, spareInk] = [inkOf('out'), inkOf('spare')];
  check(wantInk.size === 1 && spareInk.size === 1
        && [...wantInk][0] !== [...spareInk][0],
        `the wanted outputs (${[...wantInk][0]}) and the leftovers `
        + `(${[...spareInk][0]}) told apart by colour`);
  /**
   * The one word that stays, being the one the picture cannot say. A primer
   * hangs where an input hangs, arrows out and none in, and "you need this
   * once to start" against "you feed this in forever" is the whole of it.
   */
  check(/\(primer\)/.test(dot) && !/"(in|out|spare):[^"]*" \[label="[^"]*\\n/.test(dot),
        'and the primers alone say so, that being the one thing position cannot');
  // A hub is a star, and a star has to cross everything to reach the
  // reactions spread around it. No end has more arrows than a reaction does.
  const outgoing = new Map();
  for (const m of dot.matchAll(/^\s+"([^"]+)" -> "([^"]+)"/gm)) {
    for (const side of [m[1], m[2]]) outgoing.set(side, (outgoing.get(side) ?? 0) + 1);
  }
  const busiest = [...outgoing].filter(([k]) => /^(in|out|prime|spare):/.test(k))
    .reduce((a, b) => (b[1] > a[1] ? b : a), ['none', 0]);
  const busiestStep = [...outgoing].filter(([k]) => k.startsWith('s:'))
    .reduce((a, b) => (b[1] > a[1] ? b : a), ['none', 0]);
  check(busiest[1] <= busiestStep[1],
        `no end is a hub: the busiest has ${busiest[1]} arrows (${busiest[0]}), `
        + `no more than the busiest reaction's ${busiestStep[1]}`);
  // Every arrow says what it carries.
  const arrows = [...dot.matchAll(/^\s+"([^"]+)" -> "([^"]+)" \[label="([^"]*)"/gm)];
  const mute = arrows.filter(([, a, b, l]) =>
    !l && !/^(in|out|prime|spare):/.test(a) && !/^(in|out|prime|spare):/.test(b));
  check(arrows.length > 0 && !mute.length,
        `each of the ${arrows.length} arrows says what it carries, on itself or its end`);
  // Quotes in a material name would end the string early; nothing in the game
  // has one today, which is exactly when an escape stops being tested.
  check(planToDot({ ...plan, steps: [] }) === 'digraph plan {}\n',
        'and an empty plan is an empty graph rather than a broken one');

  const withMaterials = planToDot(plan, { materials: true });
  check(/shape=ellipse/.test(withMaterials),
        'asked for materials, they come as nodes of their own');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
