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
    if (e.label) bits.push(`label="${esc(e.label)}"`);
    // Sparr: no arrow ends where lines come together at the invisible nodes.
    if (e.join) bits.push('arrowhead=none');
    say(`  ${id(e.from)} -> ${id(e.to)} [${bits.join(' ')}];`);
  }
  say('}');
  return `${out.join('\n')}\n`;
}
