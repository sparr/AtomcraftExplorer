#!/usr/bin/env node
/**
 * Find the loops that turn for free, once, and write them out.
 *
 * A wheel that produces with nothing going in lets the planner mint material,
 * so `solveFresh` has always hunted them: solve, look for one, bar a member,
 * solve again. That costs a full solve per wheel and finds the same wheels
 * over and over -- Glass from Granite Gravel spent eight rounds and nine
 * seconds barring eight unrelated wheels, none of them anything to do with
 * silica. Which wheels exist is a property of the graph and not of the
 * question, so it is settled here instead, and every solve starts knowing.
 *
 * What is written down is the loop, not a culprit inside it. Sparr: every one
 * of these reactions is a fine reaction and the game means all of them; what
 * must not happen is this particular set of them feeding each other round.
 * Barring a member is both too much and too little -- too much because it
 * takes a good recipe off the table everywhere, too little because the choice
 * of which member to blame is arbitrary and moves plans that were never
 * cheating. So the solver is given the membership and forbids the turn.
 *
 * Wheels are found by counting whole units of material. Hold every material to
 * net >= 0 with nothing supplied and maximise the total surplus: since no
 * material may go negative, any positive total means some material is being
 * made from nothing. The only numbers involved are the recipe coefficients,
 * which the game states outright -- not the `matter` field, which disagrees
 * with the formulas for 31 reactions, and not atom counts, which read 356
 * reactions as minting because an aqueous salt's formula does not carry its
 * water.
 *
 * Usage: node tools/find-wheels.mjs [--out src/wheels.js]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(join(ROOT, 'data', 'atomcraft.json'), 'utf8')),
});

const { loadData } = await import('../src/data.js');
const { buildProcessGraph } = await import('../src/plan-graph.js');
const { solveLPFloat } = await import('../src/simplex-float.js');
// The same arithmetic the solver's gate applies, so the two cannot drift.
const { mintsElement } = await import('../src/minting.js');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const db = await loadData();
const graph = buildProcessGraph(db);
const inputsOf = (p) => [...p.consumes, ...p.requires];

/** Net units out. Positive means more things came out than went in. */
const units = (p) => {
  let n = 0;
  for (const o of p.produces) n += o.count;
  for (const c of inputsOf(p)) n -= c.count;
  return n;
};

const formulaOf = (name) => db.byName.get(name)?.formula?.counts ?? null;

/**
 * What can be said about this recipe's conservation, from its own formulas.
 *
 * 'clean'   -- every element comes out at or below what went in, so it cannot
 *              be the source of anything. 2107 of the 4264 processes.
 * 'creates' -- some element comes out ahead. 864 of them.
 * 'unknown' -- something involved has no formula, so nothing can be said. 1293.
 *
 * The 'clean' verdict is what makes the rest of this tractable. A loop mints
 * because some member does not conserve, so the ones that provably do can be
 * set aside outright -- and they are exactly the ones that kept being blamed.
 * `Chlorine Gas + Hydrogen Gas` is in nine of the sixteen loops and balances
 * perfectly; `Electrolysis of Carbon Dioxide` is in seven, balances, and is
 * the only way back from carbon dioxide to carbon, so barring it had plans
 * buying carbon at the door and venting the same carbon out of the back.
 *
 * Set those aside and a twenty-nine member loop has seven suspects, and six of
 * the sixteen loops have exactly one -- which needs no judgement at all, since
 * every other member provably conserves.
 */
function verdictOf(p) {
  const balance = new Map();
  for (const [list, sign] of [[inputsOf(p), -1], [p.produces, 1]]) {
    for (const x of list) {
      const counts = formulaOf(x.name);
      if (!counts) return 'unknown';
      for (const [el, n] of counts) balance.set(el, (balance.get(el) || 0) + sign * n * x.count);
    }
  }
  for (const v of balance.values()) if (v > 1e-9) return 'creates';
  return 'clean';
}

/**
 * Does this recipe create atoms of some element, by its own formulas?
 *
 * Unknown where anything involved has no formula to read, which is not the
 * same as innocent -- it only means this cannot be the one we blame.
 */
function createsAtoms(p) {
  const balance = new Map();
  for (const [list, sign] of [[inputsOf(p), -1], [p.produces, 1]]) {
    for (const x of list) {
      const counts = formulaOf(x.name);
      if (!counts) return false;
      for (const [el, n] of counts) balance.set(el, (balance.get(el) || 0) + sign * n * x.count);
    }
  }
  for (const v of balance.values()) if (v > 1e-9) return true;
  return false;
}

/**
 * Processes grouped into the cycles they can take part in.
 *
 * A wheel is a loop, so it lives inside one strongly connected component of
 * material -> process -> material. Splitting first turns one intractable
 * question into 117 small ones: the largest component holds 857 processes and
 * most hold a couple, so the search is over a few hundred columns rather than
 * four thousand.
 */
function cyclicComponents() {
  const adj = new Map();
  const at = (n) => { let a = adj.get(n); if (!a) adj.set(n, a = []); return a; };
  // Mining takes from the world, and is allowed to make something from nothing.
  const procs = graph.processes.filter((p) => p.kind !== 'mine');
  for (const p of procs) {
    for (const c of inputsOf(p)) at(`m:${c.name}`).push(`p:${p.id}`);
    for (const o of p.produces) at(`p:${p.id}`).push(`m:${o.name}`);
  }

  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], out = [];
  let counter = 0;
  for (const root of adj.keys()) {
    if (idx.has(root)) continue;
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, from] = frame;
      if (from === 0) {
        idx.set(v, counter); low.set(v, counter); counter++;
        stack.push(v); onStack.add(v);
      }
      let descended = false;
      const edges = adj.get(v) || [];
      for (let i = from; i < edges.length; i++) {
        const w = edges[i];
        if (!idx.has(w)) { frame[1] = i + 1; work.push([w, 0]); descended = true; break; }
        if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      }
      if (descended) continue;
      if (low.get(v) === idx.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1) out.push(comp.filter((x) => x[0] === 'p').map((x) => x.slice(2)));
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
    }
  }
  return out.filter((c) => c.length > 1).sort((a, b) => b.length - a.length);
}

/**
 * Does this exact set turn for free, on its own?
 *
 * The question `spin` asks of a whole component, asked again of a handful.
 */
function turnsAlone(members) {
  if (members.length < 2) return false;
  const index = new Map(members.map((p, i) => [p.id, i]));
  const net = new Map();
  const put = (name, i, v) => {
    let row = net.get(name);
    if (!row) net.set(name, row = new Map());
    row.set(i, (row.get(i) || 0) + v);
  };
  for (const p of members) {
    const i = index.get(p.id);
    for (const o of p.produces) put(o.name, i, o.count);
    for (const c of inputsOf(p)) put(c.name, i, -c.count);
  }
  const rows = [];
  for (const [, coeffs] of net) rows.push({ coeffs, op: '>=', rhs: 0 });
  for (const p of members) rows.push({ coeffs: new Map([[index.get(p.id), 1]]), op: '<=', rhs: 1 });
  const cost = new Map();
  for (const p of members) { const n = units(p); if (n !== 0) cost.set(index.get(p.id), -n); }
  if (!cost.size) return false;
  const answer = solveLPFloat({ vars: members.length, rows, cost });
  if (!answer.ok) return false;
  let surplus = 0;
  for (const [i, c] of cost) surplus += -c * answer.x[i];
  return surplus > 1e-6;
}

/**
 * The smallest set inside this one that still turns for free.
 *
 * What the LP hands back is not a loop but a crowd: maximising the surplus
 * recruits every process that helps, so the witness came back with thirty and
 * forty members. A row constraining forty processes is bound to catch honest
 * work -- it broke the combined Tantalum factory, whose chlorine those same
 * reactions make perfectly legitimately out of ore.
 *
 * So members are dropped one at a time for as long as what is left still
 * turns. What survives is irreducible: every one of them is needed for the
 * free turn, which is exactly the set worth naming.
 */
function pareDown(turning) {
  let kept = [...turning];
  // Least busy first: the hangers-on are likelier to be the ones just helping.
  for (const p of [...turning].reverse()) {
    if (kept.length <= 2) break;
    const without = kept.filter((q) => q !== p);
    if (turnsAlone(without)) kept = without;
  }
  return kept;
}

/** One wheel, or null when this component has stopped turning for free. */
function spin(live) {
  const index = new Map(live.map((p, i) => [p.id, i]));
  const net = new Map();
  const put = (name, i, v) => {
    let row = net.get(name);
    if (!row) net.set(name, row = new Map());
    row.set(i, (row.get(i) || 0) + v);
  };
  for (const p of live) {
    const i = index.get(p.id);
    for (const o of p.produces) put(o.name, i, o.count);
    for (const c of inputsOf(p)) put(c.name, i, -c.count);
  }

  const rows = [];
  for (const [, coeffs] of net) rows.push({ coeffs, op: '>=', rhs: 0 });
  // Bounded, so a wheel that does turn reports a number rather than running away.
  for (const p of live) rows.push({ coeffs: new Map([[index.get(p.id), 1]]), op: '<=', rhs: 1 });

  const cost = new Map();
  for (const p of live) {
    const n = units(p);
    if (n !== 0) cost.set(index.get(p.id), -n);
  }
  if (!cost.size) return null;

  const answer = solveLPFloat({ vars: live.length, rows, cost });
  if (!answer.ok) return null;
  let surplus = 0;
  for (const [i, c] of cost) surplus += -c * answer.x[i];
  if (surplus <= 1e-6) return null;

  const witness = live.filter((p) => answer.x[index.get(p.id)] > 1e-9)
    .sort((a, b) => answer.x[index.get(b.id)] - answer.x[index.get(a.id)]);
  const turning = pareDown(witness);
  // Measured on what survived the paring, not on the crowd that found it.
  const kept = new Set(turning.map((p) => p.id));
  const gains = [];
  for (const [name, coeffs] of net) {
    let v = 0;
    for (const [i, c] of coeffs) if (kept.has(live[i].id)) v += c * answer.x[i];
    if (v > 1e-6) gains.push([name, +v.toFixed(3)]);
  }
  gains.sort((a, b) => b[1] - a[1]);

  if (!gains.length) return null;
  /**
   * One member is still picked, but only to stop the search going round on the
   * same wheel: dropping it from this component's next pass is how the next
   * wheel is reached. It is not what gets written down.
   */
  let hardest = 0, next = null;
  for (const p of turning) {
    const runs = answer.x[index.get(p.id)];
    if (!createsAtoms(p) || runs <= hardest) continue;
    hardest = runs; next = p;
  }
  if (!next) {
    for (const p of turning) {
      const runs = answer.x[index.get(p.id)];
      if (units(p) <= 0 || runs <= hardest) continue;
      hardest = runs; next = p;
    }
  }
  if (!next) return null;
  return { next, members: turning.map((p) => p.id), material: gains[0][0],
           surplus: gains[0][1], gains: gains.slice(0, 3) };
}

const byId = new Map(graph.processes.map((p) => [p.id, p]));
const barred = new Set();
const found = [];
const started = Date.now();

for (const comp of cyclicComponents()) {
  for (let round = 0; round < 200; round++) {
    const live = comp.map((id) => byId.get(id)).filter((p) => p && !barred.has(p.id));
    if (live.length < 2) break;
    const wheel = spin(live);
    if (!wheel) break;
    barred.add(wheel.next.id);
    found.push({
      material: wheel.material,
      surplus: wheel.surplus,
      members: wheel.members,
      gains: wheel.gains,
    });
  }
}

/**
 * The pair inside a loop that mints between them, and which of the two to drop.
 *
 * Irreducibility already says every member is needed, so any two of them would
 * stop the turn -- but that says nothing about which two are at fault. This
 * looks for the stronger thing: a pair that, on its own, hands back more of an
 * element than went in, measured by the solver's own `mintsElement`. All 16
 * loops have one.
 *
 * Which half to drop follows Sparr's rule from the steel: not the one that is
 * the only way to something. `Steel Alloy` is the only reaction in the game
 * that makes molten steel, so barring it does not break a wheel, it puts steel
 * out of reach -- the burn is the half to drop. Mechanised, that is: prefer the
 * member whose every product has another maker.
 */
const elementsSeen = [...new Set(db.materials
  .flatMap((m) => (m.formula ? [...m.formula.counts.keys()] : [])))];

const soleMakerOf = (p) => p.produces.some((o) =>
  graph.producers(o.name).filter((q) => q.kind !== 'mine').length <= 1);

/** How replaceable a process is: the makers its products have besides it. */
const spares = (p) => p.produces.reduce((n, o) =>
  n + Math.max(0, graph.producers(o.name).length - 1), 0);

function culprits(members) {
  const ps = members.map((id) => byId.get(id)).filter(Boolean);
  /**
   * Only something that might not conserve can be at fault, so the provably
   * clean are never dropped -- they may still stand as the other half of a
   * pair, since that half is only there as evidence.
   */
  const suspects = ps.filter((p) => verdictOf(p) !== 'clean');
  if (!suspects.length) return null;

  // Proven before unreadable, then the replaceable before the irreplaceable.
  const ranked = [...suspects].sort((x, y) =>
    (verdictOf(x) === 'creates' ? 0 : 1) - (verdictOf(y) === 'creates' ? 0 : 1) ||
    Number(soleMakerOf(x)) - Number(soleMakerOf(y)) || spares(y) - spares(x));

  for (const a of ranked) {
    for (const b of ps) {
      if (a === b) continue;
      for (const el of elementsSeen) {
        // Measured both ways round, as the gate in the solver does.
        const mints = mintsElement(graph, a, b, el) ? [a, b]
                    : mintsElement(graph, b, a, el) ? [b, a] : null;
        if (!mints) continue;
        return { drop: a.id, with: b.id, mints: el,
                 only: suspects.length === 1, verdict: verdictOf(a),
                 sole: soleMakerOf(a) };
      }
    }
  }
  return null;
}

const pairs = [];
const seenPair = new Set();
let unpaired = 0;
for (const w of found) {
  const pair = culprits(w.members);
  if (!pair) { unpaired++; continue; }
  const key = `${pair.drop}\u241f${pair.with}`;
  if (seenPair.has(key)) continue;
  seenPair.add(key);
  pairs.push({ ...pair, loop: w.members.length, material: w.material });
}

const out = arg('--out', join(ROOT, 'src', 'wheels.js'));
const listed = found.map((w) =>
  `  // ${w.members.length} turning together, making ${
    w.gains.map(([n, v]) => `${v} ${n}`).join(', ')} out of nothing\n` +
  `  { material: ${JSON.stringify(w.material)},\n` +
  `    members: [\n${w.members.map((m) => `      ${JSON.stringify(m)},`).join('\n')}\n    ] },`
).join('\n');

writeFileSync(out, `/**
 * Loops that turn for free, and the member of each that is at fault.
 *
 * GENERATED by tools/find-wheels.mjs -- edit that, not this.
 *
 * A wheel producing material with nothing going in lets a plan mint whatever
 * it likes. Which wheels exist is a property of the game's recipes, not of any
 * question asked of them, so they are found once here rather than rediscovered
 * a solve at a time -- which cost Glass from Granite Gravel eight solves and
 * nine seconds, none of them about silica.
 *
 * Each entry is a whole loop and the material it makes out of nothing. Nothing
 * here is barred: every one of these reactions is a fine reaction, and the
 * solver is told only that this set of them may not be a net source of that
 * material between them. Blaming one member instead took a good recipe off the
 * table everywhere, and moved plans that were not cheating at all.
 *
 * Found by counting whole units: hold every material to net >= 0 with nothing
 * supplied, and any positive total is something made from nothing.
 */
export const FREE_WHEELS = [
${listed}
];

/**
 * The pair inside each loop that mints between them, and which to drop.
 *
 * Shaped for \`KNOWN_BUGS\` in plan-fresh.js, and gated the same way: the pair
 * is re-measured against the data on every build, so an exclusion lifts itself
 * if the recipe is ever fixed. \`sole\` marks the ones where the half being
 * dropped is the only maker of something, which is a judgement worth a look.
 */
export const MINTING_PAIRS = ${JSON.stringify(pairs, null, 2)};
`);

console.log(`wrote ${out}`);
console.log(`  ${found.length} wheels, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
for (const w of found) {
  console.log(`    ${String(w.members.length).padStart(3)} turning -> ${w.surplus} ${w.material}`);
}
console.log(`  ${pairs.length} distinct minting pairs` +
            (unpaired ? `, ${unpaired} loops with none` : ', one for every loop'));
for (const p of pairs) {
  console.log(`    drop ${p.drop.replace(/^rx:/, '')}` +
              `\n      with ${p.with.replace(/^rx:/, '')}  (mints ${p.mints})` +
              (p.sole ? '   [only maker of something -- check]' : ''));
}
