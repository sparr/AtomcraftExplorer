/**
 * A plan written out in the DOT language, for anything that speaks it.
 *
 * Sparr: the hand-rolled routing looks awful -- try emitting DOT and letting
 * graphviz lay it out, to see whether that is worth pursuing in the page.
 *
 * The right first move, because it separates two questions that have been
 * tangled together. What the graph *is* -- which reactions, which materials on
 * which arrows, where the plan begins and ends -- is settled here, and it is
 * the same graph whoever draws it. Where the boxes go is somebody else's
 * problem, and graphviz has spent thirty years on it.
 *
 * Written to be read by `dot` and by `neato` alike: the first ranks things and
 * the second lets them find their own places, and the difference between the
 * two on the same plan is exactly the question being asked.
 */
import { rnum } from './rational.js';
import { planGraph } from './plan-diagram.js';

const esc = (s) => String(s).replace(/["\\]/g, '\\$&');

/**
 * The same graph the diagram draws, as text.
 *
 * `materials: true` gives every material a node of its own; left off, the
 * reactions are the nodes and the materials ride on the arrows, with the three
 * ends of the plan -- what you put in, what you start with, what you get --
 * as reactions of a sort so those arrows have somewhere to attach.
 */
export function planToDot(plan, { materials = false, rankdir = 'LR', engine = 'dot',
                                  foldPhases = true, joints = true } = {}) {
  if (!plan || !plan.steps?.length) return 'digraph plan {}\n';
  const out = [];
  const say = (s) => out.push(s);

  say('digraph plan {');
  if (engine === 'dot') say(`  rankdir=${rankdir};`);
  say('  bgcolor="#0e1116";');
  say('  splines=true;');
  say('  overlap=false;');
  say('  nodesep=0.35;');
  say('  ranksep=0.8;');
  say('  node [shape=box style="rounded,filled" fillcolor="#161b22" color="#262d38" '
      + 'fontcolor="#d6dde8" fontname="Helvetica" fontsize=11 margin="0.14,0.07"];');
  say('  edge [color="#3a4553" fontcolor="#8b96a6" fontname="Helvetica" fontsize=9 '
      + 'arrowsize=0.7];');

  const id = (s) => `"${esc(s)}"`;
  const stepId = (p) => `s:${p.id}`;

  if (materials) {
    for (const step of plan.steps) {
      const label = `${rnum(step.runs)}× ${step.process.label}`;
      say(`  ${id(stepId(step.process))} [label="${esc(label)}"];`);
    }

    const role = (name) => {
      if (plan.spec.targets.some((t) => t.name === name)) return 'want';
      if (plan.frontier.some((f) => f.name === name)) return 'fetch';
      if (plan.feed.some((f) => f.name === name)) return 'have';
      if (plan.byproducts.some((b) => b.name === name)) return 'spare';
      return 'inner';
    };
    /**
     * Sparr: does mat not represent primers and leftovers at all?
     *
     * Not primers, and barely leftovers -- they were drawn in a grey a shade
     * off the background, which is present in the way a whisper is audible.
     * A primed material now says so, and a leftover is drawn in something a
     * reader can see.
     */
    const primedHere = new Set(plan.priming.map((c) => c.name));
    const paint = { want: '#5ec8f2', fetch: '#f0b45e', have: '#7fd08a',
                    spare: '#8b96a6', inner: '#262d38' };
    const seen = new Set();
    for (const step of plan.steps) {
      for (const m of [...(step.process.consumes || []), ...step.process.produces]) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        const mark = primedHere.has(m.name) ? '\\n(primer)' : '';
        say(`  "m:${esc(m.name)}" [label="${esc(m.name)}${mark}" shape=ellipse `
            + `color="${paint[role(m.name)]}"`
            + `${primedHere.has(m.name) ? ' style="filled,dashed" penwidth=2' : ''}];`);
      }
    }
    for (const step of plan.steps) {
      for (const i of step.process.consumes || []) {
        say(`  "m:${esc(i.name)}" -> ${id(stepId(step.process))};`);
      }
      for (const o of step.process.produces) {
        say(`  ${id(stepId(step.process))} -> "m:${esc(o.name)}";`);
      }
    }
    say('}');
    return `${out.join('\n')}\n`;
  }

  // --- reactions on the nodes, materials on the arrows ----------------------
  /**
   * Built by the diagram, so that the page and this agree on what the graph is.
   *
   * It was built twice, once here and once there, and the two drifted: the
   * ends stopped being a handful of hubs in one of them a day before the
   * other. One builder, two renderers.
   */
  const { nodes, edges } = planGraph(plan, { foldPhases, joints });

  // Sparr: a primer should be a different colour from an input. It is not one
  // -- you hold it once to get the wheel turning, and never again.
  const paint = { fetch: '#f0b45e', have: '#7fd08a', prime: '#c08cf0',
                  want: '#5ec8f2', spare: '#5c6675', inner: '#3a4553' };

  for (const n of nodes) {
    /**
     * A phase change, drawn as the joint it is rather than a box.
     *
     * It still holds its rank, which is the whole point: contracting these
     * away let the arrows that had stopped here skip a rank each, and every
     * skipped rank is a long spline. Sparr: try a rank-holding box for each.
     */
    if (n.hold) {
      say(`  ${id(n.id)} [shape=point width=0.06 color="#3a4553" `
          + `fillcolor="#3a4553" label=""];`);
      continue;
    }
    if (!n.pseudo) {
      /**
       * Sparr: restore the run counts on the reactors, the arrows now saying
       * how much goes each way per run. The box says how many times and the
       * arrow says how much each time, and the two multiply back to the plan.
       */
      say(`  ${id(n.id)} [label="${esc(`${n.runs}× ${n.label}`)}"];`);
      continue;
    }
    /**
     * Sparr: omit the "(left over)", "(in)" and "(out)", those are obvious
     * from context.
     *
     * They are: an end with nothing arriving is where the plan starts, one
     * with nothing leaving is where it finishes, and the colour says whether
     * a finish was the point or the sweepings. The word was the picture
     * repeating itself.
     *
     * "(primer)" stays, being the one he did not name and the one that is not
     * obvious. A primer sits exactly where an input sits, with arrows out and
     * none in, and the difference between "you feed this in continuously" and
     * "you need this once, to get started" is the whole of what a primer
     * means. Nothing about the position carries it.
     */
    const mark = n.role === 'prime' ? '\\n(primer)' : '';
    say(`  ${id(n.id)} [label="${esc(n.label)}${mark}" `
        + `shape=box style="rounded,dashed,filled" color="${paint[n.role] || '#3a4553'}" `
        + `fillcolor="#0a0d12" fontsize=10${n.role === 'prime' ? ' penwidth=2' : ''}];`);
  }
  /**
   * Sparr: a loop through a phase change leaves downward and comes back up
   * from the joint -- can the first arrow go up too, and lose the u-turn?
   *
   * It can, and the fix is to stop lying to the layout about which way the
   * loop runs. `Electrolysis of Water` hands its packed hydrogen to the
   * expansion and the expansion hands it back up to `Electrolysis of Carbon
   * Dioxide`, which sits above: a cycle. Ranking is a hierarchy and a cycle
   * has no place in one, so dot ranks the joint below the reaction that feeds
   * it, and the way back up is a hairpin round the bottom of it.
   *
   * Written the other way round with `dir=back` -- the arrow still drawn from
   * the maker to the eater, but the *rank* running the other way -- the joint
   * sits above its feeder and the whole path climbs. Both halves have to be
   * turned together or the joint is pulled from both ends and the hairpin
   * moves rather than goes.
   */
  const outOf = new Map();
  for (const e of edges) {
    if (!outOf.has(e.from)) outOf.set(e.from, []);
    outOf.get(e.from).push(e);
  }
  const closes = new Set();
  const state = new Map();
  const walk = (id) => {
    state.set(id, 1);
    for (const e of outOf.get(id) || []) {
      const at = state.get(e.to) || 0;
      if (at === 1) closes.add(e);
      else if (at === 0) walk(e.to);
    }
    state.set(id, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) walk(n.id);
  // A joint on a closing path turns with it, both halves at once.
  const joint = new Map(nodes.filter((n) => n.hold).map((n) => [n.id, n]));
  for (let again = true; again;) {
    again = false;
    for (const e of edges) {
      if (!closes.has(e)) continue;
      for (const side of [e.from, e.to]) {
        if (!joint.has(side)) continue;
        for (const other of edges) {
          if (closes.has(other)) continue;
          if (other.from !== side && other.to !== side) continue;
          closes.add(other);
          again = true;
        }
      }
    }
  }

  for (const e of edges) {
    /**
     * Sparr: the labels are still ambiguously placed, and various of them
     * overlap.
     *
     * Both are the one mistake. `taillabel` puts a label at the end it leaves
     * from, which is what was asked for, but graphviz reserves no room for it:
     * a head or tail label is painted after the drawing is decided and lands
     * wherever that leaves it. Hence eight overlapping pairs on the Columbite
     * plan, and hence a label between two reactions that feed each other
     * sitting as near one line as the other, however far it was leaned.
     *
     * A plain `label` is part of the layout -- dot gives it a place of its own
     * and routes around it -- so nothing collides and each sits against its
     * own line. Nought overlapping pairs across all six plans, against
     * twenty-two. It costs room, a fifth to a half more of it, which is the
     * price of every label being readable.
     */
    const bits = [`color="${paint[e.role] || '#3a4553'}"`];
    if (closes.has(e)) bits.push('dir=back');
    if (e.label) bits.push(`label="${esc(e.label)}"`);
    // Sparr: no arrow ends where lines come together at the invisible nodes.
    if (e.join) bits.push('arrowhead=none');
    say(closes.has(e)
      ? `  ${id(e.to)} -> ${id(e.from)} [${bits.join(' ')}];`
      : `  ${id(e.from)} -> ${id(e.to)} [${bits.join(' ')}];`);
  }
  say('}');
  return `${out.join('\n')}\n`;
}
