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
    const paint = { want: '#5ec8f2', fetch: '#f0b45e', have: '#7fd08a',
                    spare: '#1c222c', inner: '#262d38' };
    const seen = new Set();
    for (const step of plan.steps) {
      for (const m of [...(step.process.consumes || []), ...step.process.produces]) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        say(`  "m:${esc(m.name)}" [label="${esc(m.name)}" shape=ellipse `
            + `color="${paint[role(m.name)]}"];`);
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
  const kept = new Set([...plan.spec.targets.map((t) => t.name),
                        ...plan.byproducts.map((b) => b.name)]);

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
    if (brought.has(name)) for (const b of users.get(name) || []) wire('in', b, name, '#f0b45e');
    if (primed.has(name)) for (const b of users.get(name) || []) wire('prime', b, name, '#7fd08a');
    if (kept.has(name)) for (const a of makers.get(name) || []) wire(a, 'out', name, '#5ec8f2');
  }
  for (const key of wires.keys()) {
    const [a, b] = key.split('\u0000');
    if (a === 'in' || b === 'in') ends.push('in');
    if (a === 'prime' || b === 'prime') ends.push('prime');
    if (a === 'out' || b === 'out') ends.push('out');
  }
  const label = { in: 'what you put in', prime: 'what you start with', out: 'what you get' };
  const paint = { in: '#f0b45e', prime: '#7fd08a', out: '#5ec8f2' };
  for (const end of new Set(ends)) {
    say(`  "${end}" [label="${label[end]}" shape=box style="rounded,dashed,filled" `
        + `color="${paint[end]}" fillcolor="#0a0d12"];`);
  }
  for (const [key, names] of wires) {
    const [a, b, colour] = key.split('\u0000');
    say(`  ${id(a)} -> ${id(b)} [label="${esc(names.join(', '))}" color="${colour}"];`);
  }
  say('}');
  return `${out.join('\n')}\n`;
}
