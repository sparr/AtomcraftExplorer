/**
 * The production hypergraph: every way one material can become another.
 *
 * The explorer shows a material's transformations one material at a time. The
 * planner needs them as a single graph, and it needs more than reactions --
 * 121 of the 681 reactions' feedstocks have no reaction that produces them at
 * all, only a phase change, a fire, a plant or a mine. A reactions-only graph
 * dead-ends on every one of those.
 *
 * So a *process* here is any transformation, whatever mechanism drives it, and
 * the reader chooses which mechanisms are allowed. Everything is indexed once
 * and filtered at solve time, so turning a kind on cannot require a rebuild --
 * and the solver can still see a route it is not allowed to take, which is how
 * it can say "there is a way, but it needs mining".
 */
import { makeClassifier } from './grouping.js';

/**
 * Process kinds, in the order they appear in the options panel.
 *
 * `automatic` is the default-on set, and the rule behind it is whether the game
 * can run the process unattended: a reaction, a temperature, a fire, a growing
 * plant and a decaying nucleus all proceed on their own, while mining, firing
 * the accelerator and rotating a machine need a player. `weight` is the base
 * cost of using one step of this kind, which is what makes the solver prefer
 * boiling water over waiting out a half-life.
 */
export const PROCESS_KINDS = [
  { id: 'reaction', label: 'Reactions',      glyph: '⚗', automatic: true,  weight: 1 },
  { id: 'phase',    label: 'Phase changes',  glyph: '♨', automatic: true,  weight: 0.5 },
  { id: 'fire',     label: 'Fire',           glyph: '\u{1f525}', automatic: true, weight: 1 },
  { id: 'grow',     label: 'Growth',         glyph: '\u{1f331}', automatic: true, weight: 2 },
  { id: 'decay',    label: 'Nuclear decay',  glyph: '☢', automatic: true,  weight: 4 },
  { id: 'mine',     label: 'Mining & drops', glyph: '⛏', automatic: false, weight: 1 },
  { id: 'beam',     label: 'Particle beams', glyph: '⚛', automatic: false, weight: 6 },
  { id: 'handling', label: 'Handling',       glyph: '✋', automatic: false, weight: 1 },
];

export const KIND = new Map(PROCESS_KINDS.map((k) => [k.id, k]));

/** The kinds a fresh plan allows: everything a mechanism or time can do alone. */
export const DEFAULT_KINDS = PROCESS_KINDS.filter((k) => k.automatic).map((k) => k.id);

/**
 * `+H2O` is the marker for water of hydration in a Composition, not a material
 * anyone can hold. It carries an Evaporation, so left in the graph it would
 * offer itself as a (never obtainable) source of Steam.
 */
const PSEUDO = new Set(['+H2O']);

/** Sum the counts of a `{name: count}` map into a list, dropping pseudo-materials. */
function pairs(obj) {
  if (!obj) return [];
  return Object.entries(obj)
    .filter(([name]) => !PSEUDO.has(name))
    .map(([name, count]) => ({ name, count: count || 1 }));
}

/**
 * Build one process.
 *
 * `inputs` and `outputs` are as the game writes them, because that is what a
 * reaction card has to show. `net` is what the quantity solver uses: 17
 * reactions name a material on both sides -- "Compost from Fallen Leaves" takes
 * 9 Fallen Leaf and hands 7 back -- and only the difference is really consumed.
 * A material whose net is zero is neither made nor used up, so it moves to
 * `requires`, which is also where catalysts and a growing plant's parent live:
 * things that must be present without being spent.
 */
function makeProcess({ id, kind, label, inputs = [], outputs = [], requires = [],
                       conditions = {}, source = null }) {
  const net = new Map();
  for (const { name, count } of inputs) net.set(name, (net.get(name) || 0) - count);
  for (const { name, count } of outputs) net.set(name, (net.get(name) || 0) + count);

  const consumes = [], produces = [], holds = [...requires];
  for (const [name, delta] of net) {
    if (delta < 0) consumes.push({ name, count: -delta });
    else if (delta > 0) produces.push({ name, count: delta });
    else holds.push({ name, count: Math.max(...inputs.filter((i) => i.name === name)
                                                    .map((i) => i.count), 1) });
  }

  return {
    id, kind, label, source, conditions,
    inputs, outputs,                 // as written, for display
    consumes, produces, requires: holds,   // netted, for solving
  };
}

/**
 * A process that nets out to nothing is not a process. 88 machine parts list
 * themselves as what they build into -- placing a Balance Input Left to Up
 * yields a Balance Input Left to Up -- and after netting there is no product
 * left to offer.
 */
const real = (p) => (p.produces.length ? [p] : []);

/** Reactions are the only processes that already come as hyperedges. */
function reactionProcesses(db) {
  return db.reactions.flatMap((rx) => real(makeProcess({
    id: `rx:${rx.name}`,
    kind: 'reaction',
    label: rx.name,
    inputs: pairs(rx.raw.Inputs),
    outputs: pairs(rx.raw.Outputs),
    requires: [],
    conditions: {
      temperature: rx.raw.Temperature,
      maxTemperature: rx.raw.MaxTemperature,
      changeInTemperature: rx.raw.ChangeInTemperature,
      probability: rx.raw.Probability,
      electrolysis: !!rx.raw.Electrolysis,
      // Not an ingredient. `DoReaction` reads only `InputTypes`; the catalyst
      // appears solely in the gate deciding whether the reaction may run, and
      // is never consumed -- one Blender makes yeast forever. So it belongs
      // with the temperature and the electrolysis flag: a condition on the
      // apparatus, not a material the plan has to supply.
      catalysts: pairs(rx.raw.Catalysts),
    },
    source: rx,
  })));
}

/**
 * Everything else is written on the material that undergoes it, one field at a
 * time, so each field becomes a process with that material as its sole input.
 *
 * Two shapes need care. A `GrowthRule` grows a *new* segment beside a plant
 * that stays where it is, so the parent is a requirement rather than an input.
 * Spontaneous fission names no product at all -- 4 nuclides just cease -- so
 * those decays produce nothing and are skipped.
 */
function materialProcesses(db) {
  const out = [];
  const one = (name, count = 1) => (PSEUDO.has(name) ? [] : [{ name, count }]);

  /**
   * A weighted one-of draw, written as a ratio.
   *
   * Both of the game's random tables work the same way: an array with each
   * outcome repeated by its weight, indexed at random. Over enough draws that
   * is exactly `sum(weights)` in for `weight` of each out, with no rounding --
   * so the expectation is expressible in whole numbers and becomes the
   * process's coefficients.
   */
  const weighted = (from, pairsIn) => {
    const tally = new Map();
    let total = 0;
    for (const [name, w] of pairsIn) { tally.set(name, (tally.get(name) || 0) + w); total += w; }
    return { inputs: one(from, total),
             outputs: [...tally].flatMap(([t, n]) => one(t, n)) };
  };

  /** The same table, as the chances a reader wants to see. */
  const odds = (pairsIn) => {
    const tally = new Map();
    let total = 0;
    for (const [name, w] of pairsIn) { tally.set(name, (tally.get(name) || 0) + w); total += w; }
    return {
      stochastic: tally.size > 1,
      outcomes: [...tally].map(([name, w]) => ({ name, weight: w, chance: w / total }))
                          .sort((a, b) => b.weight - a.weight),
    };
  };

  for (const m of db.materials) {
    const raw = m.raw;
    const self = () => one(m.name);
    const add = (spec) => {
      if (!spec.outputs.length || !(spec.inputs.length + spec.requires.length)) return;
      out.push(...real(makeProcess(spec)));
    };

    // --- phase: a temperature crossing, both directions ----------------------
    for (const [field, verb] of [['Evaporation', 'evaporates'], ['Condensation', 'condenses']]) {
      const t = raw[field];
      if (!t?.TargetMaterialName) continue;
      add({
        id: `${field === 'Evaporation' ? 'evap' : 'cond'}:${m.name}`,
        kind: 'phase',
        label: `${m.display} ${verb} into ${t.TargetMaterialName}`,
        inputs: self(),
        outputs: one(t.TargetMaterialName, t.Amount || 1),
        requires: [],
        // Which side of the number you have to be on depends on the
        // direction. Evaporation needs the tile at least that hot;
        // condensation needs it no hotter -- Molten Aluminum sets at 932 K by
        // *cooling* through it, so recording that as a floor would have a plan
        // telling you to fire up a furnace to freeze something.
        conditions: {
          ...(field === 'Evaporation' ? { temperature: t.Temperature }
                                      : { maxTemperature: t.Temperature }),
          probability: t.Probability,
          direction: field === 'Evaporation' ? 'heat' : 'cool',
        },
        source: m,
      });
    }

    // --- fire: light it, let it burn out, or put it out ----------------------
    if (raw.Ignition?.TargetMaterialName) {
      add({
        id: `ignite:${m.name}`,
        kind: 'fire',
        label: `${m.display} ignites into ${raw.Ignition.TargetMaterialName}`,
        inputs: self(),
        outputs: one(raw.Ignition.TargetMaterialName),
        requires: [],
        conditions: { temperature: raw.Ignition.Temperature,
                      requiresSpark: !!raw.Ignition.RequiresSpark,
                      explodes: !!raw.Ignition.Explodes },
        source: m,
      });
    }
    const fire = raw.Fire;
    if (fire) {
      // The combustion list is a bag, not a set: Ethanol (Burning) lists Carbon
      // Dioxide three times and Steam twice. The game picks one entry of that
      // array at random -- `RNG.Roll(...) % CombustionTargetMaterialTypeIds
      // .Length` -- so a repeat is a weight, and each product has a
      // probability of (repeats / bag size).
      const bag = fire.CombustionTargetMaterialNames || [];
      if (bag.length) {
        add({
          id: `burn:${m.name}`,
          kind: 'fire',
          label: `${m.display} burns`,
          ...weighted(m.name, bag.map((t) => [t, 1])),
          requires: [],
          conditions: { probability: fire.ProbabilityToCombust,
                        heatOutput: fire.HeatOutput,
                        ...odds(bag.map((t) => [t, 1])) },
          source: m,
        });
      }
      if (fire.ExtinguishTargetMaterialName) {
        add({
          id: `douse:${m.name}`,
          kind: 'fire',
          label: `${m.display} extinguishes into ${fire.ExtinguishTargetMaterialName}`,
          inputs: self(),
          outputs: one(fire.ExtinguishTargetMaterialName),
          requires: [],
          conditions: {},
          source: m,
        });
      }
    }

    // --- growth: a seed becomes a plant, a plant extends itself --------------
    if (raw.GrowsInto) {
      add({
        id: `sprout:${m.name}`,
        kind: 'grow',
        label: `${m.display} grows into ${raw.GrowsInto}`,
        inputs: self(),
        outputs: one(raw.GrowsInto),
        requires: [],
        conditions: {},
        source: m,
      });
    }
    for (const [i, g] of (raw.GrowthRules || []).entries()) {
      if (!g.GrowthMaterialName) continue;
      add({
        // Indexed rather than keyed on the target: a plant may list the same
        // segment for more than one direction.
        id: `grow:${m.name}#${i}`,
        kind: 'grow',
        // The stalk stays; it puts out a new segment. So it is held, not spent.
        label: `${m.display} grows ${g.GrowthMaterialName}`,
        inputs: [],
        outputs: one(g.GrowthMaterialName),
        requires: self(),
        conditions: { medium: db.enums.GrowthMedium?.[g.MediumType],
                      growthRate: g.GrowthRate,
                      direction: db.enums.Direction?.[g.Direction] },
        source: m,
      });
    }

    // --- decay: time, and nothing else ---------------------------------------
    const dec = raw.DecaySettings;
    if (dec) {
      const products = [dec.MaterialName, dec.MaterialName2].filter(Boolean);
      if (products.length) {
        add({
          id: `decay:${m.name}`,
          kind: 'decay',
          label: `${m.display} decays into ${products.join(' + ')}`,
          inputs: self(),
          outputs: products.flatMap((p) => one(p)),
          requires: [],
          conditions: { mode: db.enums.DecayMode?.[dec.Mode], ticks: dec.TickModValue },
          source: m,
        });
      }
    }

    // --- mining and drops: a player with a tool ------------------------------
    if (raw.MinesInto) {
      add({
        id: `mine:${m.name}`,
        kind: 'mine',
        label: `${m.display} mines into ${raw.MinesInto}`,
        inputs: self(),
        outputs: one(raw.MinesInto),
        requires: [],
        conditions: { hardness: raw.Hardness },
        source: m,
      });
    }
    // One roll per swing, over a lookup array holding each material as many
    // times as its rate -- `DropTable` builds exactly that and rolls uniformly
    // over it. So the rates are relative weights out of their own sum, not
    // chances out of a thousand, and mining Granite 6007 times is what yields
    // its 2 rubies.
    const drops = Object.entries(raw.DropRates || {});
    if (drops.length) {
      add({
        id: `drop:${m.name}`,
        kind: 'mine',
        label: `${m.display} drops`,
        ...weighted(m.name, drops),
        requires: [],
        conditions: odds(drops),
        source: m,
      });
    }

    // --- the accelerator ------------------------------------------------------
    for (const [field, beam] of [['TurnsIntoFromProtonImpact', 'proton'],
                                 ['TurnsIntoFromNeutronImpact', 'neutron'],
                                 ['TurnsIntoFromAlphaParticleImpact', 'alpha']]) {
      if (!raw[field]) continue;
      add({
        id: `${beam}:${m.name}`,
        kind: 'beam',
        label: `${m.display} under ${beam} impact becomes ${raw[field]}`,
        inputs: self(),
        outputs: one(raw[field]),
        requires: [],
        conditions: { beam },
        source: m,
      });
    }

    // --- handling: things only a pair of hands does ---------------------------
    for (const [field, verb] of [['MinesInto', null],   // already covered above
                                 ['BuildsInto', 'builds into'],
                                 ['PickUpInto', 'is picked up as'],
                                 ['DissolvesInto', 'dissolves into'],
                                 ['TurnsOnInto', 'turns on into'],
                                 ['TurnsOffInto', 'turns off into'],
                                 ['RotatesLeftInto', 'rotates left into'],
                                 ['RotatesRightInto', 'rotates right into']]) {
      if (!verb || !raw[field]) continue;
      add({
        id: `${field}:${m.name}`,
        kind: 'handling',
        label: `${m.display} ${verb} ${raw[field]}`,
        inputs: self(),
        outputs: one(raw[field]),
        requires: [],
        // Placing something is the one player action a plan still wants to
        // show, and only ever as its last step -- see `solveCosts`.
        conditions: field === 'BuildsInto' ? { places: true } : {},
        source: m,
      });
    }
  }
  return out;
}

/**
 * Kinds that fire on temperature, and so can go off by accident.
 *
 * Decay ignores temperature entirely, and mining, growth and handling are
 * things you do rather than things that happen to you, so none of them can be
 * triggered by running a chamber too hot.
 */
const TEMPERATURE_DRIVEN = new Set(['reaction', 'phase', 'fire']);

/** When does this process fire, in kelvin? `[0, Infinity]` means always. */
function firingRange(p) {
  return [p.conditions.temperature ?? 0, p.conditions.maxTemperature ?? Infinity];
}

/** Remove `[a, b]` from a set of disjoint ascending ranges. */
function without(ranges, [a, b]) {
  const out = [];
  for (const [s, e] of ranges) {
    if (b < s || a > e) { out.push([s, e]); continue; }
    if (a > s) out.push([s, Math.min(e, a - 1)]);
    if (b < e) out.push([Math.max(s, b + 1), e]);
  }
  return out;
}

/**
 * The temperatures at which a process runs *and nothing else does*.
 *
 * A reaction happens in a chamber holding its inputs, its outputs and whatever
 * catalyst it needs, and those same materials are the ingredients of other
 * reactions. Run the chamber into one of their ranges and you get that too --
 * so a reaction stated as "≥ 0 °C" whose contents would also react at 100 °C is
 * really a reaction for 0-99 °C, and saying so is the difference between a plan
 * that works and one that quietly turns into something else.
 *
 * Each interfering range is cut out of the stated one. What is left may be
 * several intervals; the one holding the stated minimum is the operating range,
 * since that is the temperature the game is pointing at. A cut that would leave
 * nothing at all is not applied -- the side reaction is then unavoidable, which
 * is worth reporting rather than pretending the process cannot run.
 */
function temperatureWindow(graph, p) {
  const base = firingRange(p);
  const window = { lo: base[0], hi: base[1], base, avoided: [], unavoidable: [] };
  if (!TEMPERATURE_DRIVEN.has(p.kind)) return window;

  // Everything standing in the chamber while this runs.
  const present = new Set();
  for (const { name } of [...p.inputs, ...p.outputs, ...p.requires]) present.add(name);
  const catalysts = new Set((p.conditions.catalysts || []).map((c) => c.name));
  for (const name of catalysts) present.add(name);

  // Anything that could fire on what is standing there -- but only what would
  // fire *by itself*. Three things gate a process on something other than its
  // ingredients, and none of them is present unless this reaction brought it:
  // a catalyst, a current, and a spark. Without these, every reaction touching
  // water reads as if Electrolysis of Water were going off in it.
  const seen = new Set([p.id]);
  const candidates = [];
  for (const name of present) {
    for (const q of graph.consumers(name)) {
      if (seen.has(q.id) || !TEMPERATURE_DRIVEN.has(q.kind)) continue;
      seen.add(q.id);
      if (![...q.consumes, ...q.requires].every((i) => present.has(i.name))) continue;
      if (!(q.conditions.catalysts || []).every((c) => catalysts.has(c.name))) continue;
      if (q.conditions.electrolysis && !p.conditions.electrolysis) continue;
      if (q.conditions.requiresSpark && !p.conditions.requiresSpark) continue;
      candidates.push(q);
    }
  }
  // Deterministic order, so the operating range does not depend on Map order.
  candidates.sort((a, b) => a.id.localeCompare(b.id));

  let ranges = [base];
  for (const q of candidates) {
    const range = firingRange(q);
    const next = without(ranges, range);
    if (!next.length) { window.unavoidable.push({ id: q.id, label: q.label, range }); continue; }
    const key = (rs) => rs.map(([s, e]) => `${s}:${e}`).join(',');
    if (key(next) !== key(ranges)) window.avoided.push({ id: q.id, label: q.label, range });
    ranges = next;
  }

  const operating = ranges.find(([s, e]) => base[0] >= s && base[0] <= e) || ranges[0];
  window.lo = operating[0];
  window.hi = operating[1];
  window.narrowed = window.lo !== base[0] || window.hi !== base[1];
  window.alternatives = ranges.filter((r) => r !== operating);
  return window;
}

/**
 * The temperature range a step is actually run at.
 *
 * With `avoid` off this is simply what the game states, side reactions and all.
 */
export function operatingWindow(p, avoid = true) {
  if (avoid && p.window) return p.window;
  const base = firingRange(p);
  return { lo: base[0], hi: base[1], base, avoided: [], unavoidable: [],
           narrowed: false, alternatives: [] };
}

/**
 * Index every process once. Nothing here consults the reader's chosen kinds --
 * the solver filters, so that a disabled route is still visible as one.
 */
export function buildProcessGraph(db) {
  const processes = [...reactionProcesses(db), ...materialProcesses(db)];

  // The explorer's own categoriser, reused. The planner needs it because how a
  // material is *had* differs by kind of thing: an ore is dug up, a wall is
  // built, and a compound is generally meant to be made. Melting an Aluminum
  // Wall really is written in the data as a source of Molten Aluminum, and
  // without knowing a wall is a built thing there is no way to prefer the ore.
  const classify = makeClassifier(db.materials);
  const category = new Map(db.materials.map((m) => [m.name, classify(m)]));
  const state = new Map(db.materials.map((m) => [m.name, m.state]));
  // Things the player builds, in both their forms: the placed machine and the
  // item you carry to place it. `Aluminum Wire` is the second kind -- Solid,
  // portable, and got by picking a placed wire back up -- so state alone does
  // not tell them apart from an ore.
  const manufactured = new Set(db.materials
    .filter((m) => m.raw.IsBuilt || m.raw.IsMechanical).map((m) => m.name));

  const byId = new Map();
  const producersOf = new Map();
  const consumersOf = new Map();
  const requiredBy = new Map();
  const push = (map, key, p) => {
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push(p);
  };

  for (const p of processes) {
    if (byId.has(p.id)) throw new Error(`duplicate process id: ${p.id}`);
    byId.set(p.id, p);
    for (const { name } of p.produces) push(producersOf, name, p);
    for (const { name } of p.consumes) push(consumersOf, name, p);
    for (const { name } of p.requires) push(requiredBy, name, p);
  }

  const graph = {
    db,
    processes,
    byId,
    category,
    categoryOf: (name) => category.get(name) || 'other',
    stateOf: (name) => state.get(name) || null,
    isManufactured: (name) => manufactured.has(name),
    producersOf,
    consumersOf,
    requiredBy,
    /** Every process that makes `name`, whether or not the kind is allowed. */
    producers: (name) => producersOf.get(name) || [],
    consumers: (name) => consumersOf.get(name) || [],
    kindsThatProduce: (name) => new Set((producersOf.get(name) || []).map((p) => p.kind)),
  };

  // Depends on the finished index, so it runs last. Plan-independent: what a
  // chamber's contents would also do is a fact about the game, not about what
  // the reader asked for, so it is worked out once here rather than per solve.
  for (const p of processes) p.window = temperatureWindow(graph, p);

  return graph;
}
