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

const esc = (s) => String(s).replace(/["\\]/g, '\\$&');

/**
 * The same graph the diagram draws, as text.
 *
 * `materials: true` gives every material a node of its own; left off, the
 * reactions are the nodes and the materials ride on the arrows, with the three
 * ends of the plan -- what you put in, what you start with, what you get --
 * as reactions of a sort so those arrows have somewhere to attach.
 */
export function planToDot(plan, { materials = false, rankdir = 'LR', engine = 'dot' } = {}) {
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

  for (const step of plan.steps) {
    const label = `${rnum(step.runs)}× ${step.process.label}`;
    say(`  ${id(stepId(step.process))} [label="${esc(label)}"];`);
  }

  if (materials) {
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
  const makers = new Map();
  const users = new Map();
  for (const step of plan.steps) {
    for (const o of step.process.produces) {
      if (!makers.has(o.name)) makers.set(o.name, []);
      makers.get(o.name).push(stepId(step.process));
    }
    for (const i of step.process.consumes || []) {
      if (!users.has(i.name)) users.set(i.name, []);
      users.get(i.name).push(stepId(step.process));
    }
  }
  const brought = new Set([...plan.feed.map((f) => f.name), ...plan.frontier.map((f) => f.name)]);
  const primed = new Set(plan.priming.map((c) => c.name));
  const wanted = new Set(plan.spec.targets.map((t) => t.name));
  const spare = new Set(plan.byproducts.map((b) => b.name));

  /**
   * Sparr: rx is much messier, owing to combining all the inputs, outputs and
   * primers.
   *
   * It is, and that is what a hub does. Every material the reader brings
   * arriving from one box makes that box a star of a dozen arrows, and a star
   * has to cross everything to reach the reactions spread across the picture.
   * Four of them, and the crossings are mostly theirs.
   *
   * So each end-material gets its own little node instead -- which is what
   * made the materials drawing readable in the first place, and costs nothing
   * here because these are the materials that already had only one end. The
   * ones in the middle stay on the arrows, where they belong: they have a
   * reaction at each end and need no box to hang from.
   */
  const ends = [];
  const wires = new Map();                      // "a\u0000b" -> [labels]
  const wire = (a, b, label, colour) => {
    const key = `${a}\u0000${b}\u0000${colour}`;
    if (!wires.has(key)) wires.set(key, []);
    if (label && !wires.get(key).includes(label)) wires.get(key).push(label);
  };

  for (const name of new Set([...makers.keys(), ...users.keys()])) {
    for (const a of makers.get(name) || []) {
      for (const b of users.get(name) || []) wire(a, b, name, '#3a4553');
    }
    if (brought.has(name)) {
      for (const b of users.get(name) || []) wire(`in:${name}`, b, '', '#f0b45e');
    }
    if (primed.has(name)) {
      for (const b of users.get(name) || []) wire(`prime:${name}`, b, '', '#7fd08a');
    }
    /**
     * What was asked for and what merely fell out are different answers.
     *
     * Sparr: possibly with different colours for wanted outputs against
     * leftovers. They earn more than a colour -- they earn separate ends,
     * because a reader looking at a plan wants to know at a glance which
     * arrows are the point of it and which are the sweepings, and an arrow
     * that lands somewhere labelled "Leftovers" has said so before its colour
     * is read.
     */
    if (wanted.has(name)) {
      for (const a of makers.get(name) || []) wire(a, `out:${name}`, '', '#5ec8f2');
    } else if (spare.has(name)) {
      for (const a of makers.get(name) || []) wire(a, `spare:${name}`, '', '#5c6675');
    }
  }
  for (const key of wires.keys()) {
    const [a, b] = key.split('\u0000');
    for (const side of [a, b]) {
      if (/^(in|prime|out|spare):/.test(side)) ends.push(side);
    }
  }
  const paint = { in: '#f0b45e', prime: '#7fd08a', out: '#5ec8f2', spare: '#5c6675' };
  const said = { in: 'in', prime: 'primer', out: 'out', spare: 'left over' };
  const amountOf = (name) => {
    for (const list of [plan.frontier, plan.feed, plan.priming, plan.byproducts]) {
      const hit = list.find((x) => x.name === name);
      if (hit) return `${rnum(hit.amount)} `;
    }
    return '';
  };
  for (const end of new Set(ends)) {
    const at = end.indexOf(':');
    const role = end.slice(0, at);
    const name = end.slice(at + 1);
    say(`  "${esc(end)}" [label="${esc(amountOf(name) + name)}\n(${said[role]})" `
        + `shape=box style="rounded,dashed,filled" color="${paint[role]}" `
        + `fillcolor="#0a0d12" fontsize=10];`);
  }
  for (const [key, names] of wires) {
    const [a, b, colour] = key.split('\u0000');
    say(`  ${id(a)} -> ${id(b)} [label="${esc(names.join(', '))}" color="${colour}"];`);
  }
  say('}');
  return `${out.join('\n')}\n`;
}
