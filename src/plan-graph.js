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
import { phaseChange } from './data.js';

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
 * What falls out of the sky.
 *
 * The world hands these over for nothing, which no amount of reading the
 * material list will tell you: they are named in the simulation's weather
 * branch, not in the data. `Simulation.cs` sets the tile directly, one in 128
 * per tick along the top of the weather range.
 *
 * Only these two. `Simulation.cs` has branches for a Firestorm dropping
 * `BURNING_COAL` and an AcidRain dropping `SULFURIC_ACID`, but `Weather.Process`
 * only ever turns Sunny into a Rainstorm or a Snowstorm, and the only callers
 * of `StartFirestorm` and `StartAcidRain` are in `Console.cs`. Weather nobody
 * can have without the developer console is not a supply.
 *
 * Without this the planner had no way to know that water is collectable. It
 * inferred "raw" from the absence of a recipe, which is why it understood that
 * Falling Snow could simply be gathered -- nothing makes any -- and thought
 * water, with 77 ways to make it, had to be manufactured. It is the same
 * storm.
 */
export const FALLS_FROM_SKY = new Set([
  'Water',          // Rainstorm -- Materials.WATER
  'Falling Snow',   // Snowstorm -- Materials.SNOW_FALLING
]);

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
  /** Both ends of a label name their material the same way -- see `label` in
   *  data.js. A target named by its internal name while its subject goes by
   *  its display reads as "Reversible Conveyor Left builds into Reversible
   *  Conveyor Left", which is two different machines. */
  const lbl = (name) => db.byName.get(name)?.label ?? name;

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
    for (const field of ['Evaporation', 'Condensation']) {
      const t = raw[field];
      if (!t?.TargetMaterialName) continue;
      const heating = field === 'Evaporation';
      // Named for what actually happens between those two states, not for the
      // field it was stored in.
      const { verb } = phaseChange(m.state, db.byName.get(t.TargetMaterialName)?.state,
                                   heating ? 'heat' : 'cool');
      add({
        id: `${heating ? 'evap' : 'cond'}:${m.name}`,
        kind: 'phase',
        label: `${m.label} ${verb} ${lbl(t.TargetMaterialName)}`,
        inputs: self(),
        outputs: one(t.TargetMaterialName, t.Amount || 1),
        requires: [],
        // Which side of the number you have to be on depends on the
        // direction. Evaporation needs the tile at least that hot;
        // condensation needs it no hotter -- Molten Aluminum sets at 932 K by
        // *cooling* through it, so recording that as a floor would have a plan
        // telling you to fire up a furnace to freeze something.
        conditions: {
          ...(heating ? { temperature: t.Temperature } : { maxTemperature: t.Temperature }),
          probability: t.Probability,
          direction: heating ? 'heat' : 'cool',
        },
        source: m,
      });
    }

    // --- fire: light it, let it burn out, or put it out ----------------------
    if (raw.Ignition?.TargetMaterialName) {
      add({
        id: `ignite:${m.name}`,
        kind: 'fire',
        label: `${m.label} ignites into ${lbl(raw.Ignition.TargetMaterialName)}`,
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
          label: `${m.label} burns`,
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
          label: `${m.label} extinguishes into ${lbl(fire.ExtinguishTargetMaterialName)}`,
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
        label: `${m.label} grows into ${lbl(raw.GrowsInto)}`,
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
        label: `${m.label} grows ${lbl(g.GrowthMaterialName)}`,
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
          label: `${m.label} decays into ${products.map(lbl).join(' + ')}`,
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
        label: `${m.label} mines into ${lbl(raw.MinesInto)}`,
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
        label: `${m.label} drops`,
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
        label: `${m.label} under ${beam} impact becomes ${lbl(raw[field])}`,
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
        label: `${m.label} ${verb} ${lbl(raw[field])}`,
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
 * A run of phase changes in the same direction, as one step.
 *
 * Steam does not stop at Water on the way to Ice. Cool it far enough and it
 * goes all the way, so a plan that lists "Steam condenses into Water" and then
 * "Water solidifies into Ice" is describing one chamber held at one
 * temperature as though it were two.
 *
 * The chain's limit is the tightest of its parts -- to reach the end you must
 * be past every threshold on the way, so cooling takes the lowest and heating
 * the highest. Each length is offered separately, so stopping at the middle
 * is still there to be chosen: the two-step route is what you get by asking
 * for the intermediate.
 */
const CHAIN_MAX = 4;

function phaseChains(db) {
  const out = [];
  const lbl = (name) => db.byName.get(name)?.label ?? name;

  for (const field of ['Evaporation', 'Condensation']) {
    const heating = field === 'Evaporation';
    for (const start of db.materials) {
      if (PSEUDO.has(start.name)) continue;
      const hops = [];
      const seen = new Set([start.name]);
      let cur = start;
      while (hops.length < CHAIN_MAX) {
        const t = cur.raw[field];
        const next = t?.TargetMaterialName && db.byName.get(t.TargetMaterialName);
        if (!next || seen.has(next.name) || PSEUDO.has(next.name)) break;
        hops.push({ to: next, t, from: cur });
        seen.add(next.name);
        cur = next;
        if (hops.length < 2) continue;

        const last = hops[hops.length - 1].to;
        const amount = hops.reduce((n, h) => n * (h.t.Amount || 1), 1);
        const limit = hops.map((h) => h.t.Temperature ?? (heating ? 0 : Infinity));
        const verbs = hops.map((h) =>
          phaseChange(h.from.state, h.to.state, heating ? 'heat' : 'cool').verb.replace(/ into$/, ''));
        const said = verbs.length > 1
          ? `${verbs.slice(0, -1).join(', ')} and ${verbs[verbs.length - 1]}`
          : verbs[0];
        out.push(makeProcess({
          id: `chain:${heating ? 'heat' : 'cool'}:${start.name}#${hops.length}`,
          kind: 'phase',
          label: `${start.label} ${said} into ${lbl(last.name)}`,
          inputs: [{ name: start.name, count: 1 }],
          outputs: [{ name: last.name, count: amount }],
          requires: [],
          conditions: {
            ...(heating ? { temperature: Math.max(...limit) }
                        : { maxTemperature: Math.min(...limit) }),
            direction: heating ? 'heat' : 'cool',
            probability: Math.max(...hops.map((h) => h.t.Probability || 0)) || undefined,
            // Present in the chamber on the way through, so they count when
            // working out what else the temperature would set off.
            via: hops.slice(0, -1).map((h) => h.to.name),
            // Its own hops, which are not side effects of itself.
            parts: hops.map((h) => `${heating ? 'evap' : 'cond'}:${h.from.name}`),
          },
          source: start,
        }));
      }
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
 * Which reactions this one is sharing its feedstock with, and how often each
 * of them gets it.
 *
 * A tile runs the first reaction in its own list that is valid this tick and
 * then stops -- `foreach (r in Reactions) if (IsReactionValid(...)) { DoReaction
 * (...); return true; }`. The list belongs to the material, so the rivals are
 * the reactions sharing a PrimaryInput, tried in the order they were loaded.
 *
 * Which would mean the first one always wins, except that most of them carry a
 * Probability: a 1-in-P gate rolled per tick. Lepidolite's three decompositions
 * are gated at 51, 52 and 50, so each takes about a third of the ore and the
 * plan has to say so -- two thirds of what you feed in comes out as the other
 * two reactions' products.
 *
 * Where an earlier rival has no gate at all it fires every time and everything
 * after it in the list never runs, which is worth knowing too.
 */
function competitionFor(graph, p, window) {
  if (p.kind !== 'reaction') return null;
  const primary = p.source?.raw?.PrimaryInput;
  if (!primary) return null;

  // Competing for the feed means running on what is *put in*, not on what
  // comes out. A reaction needing this one's products is a later event in the
  // same chamber, not a rival for the same tick -- counting it as one had
  // "Antimony Pentafluoride + Water" reported as never running, starved by a
  // reaction that cannot happen until it has.
  const fed = new Set(p.inputs.map((i) => i.name));
  for (const c of p.conditions.catalysts || []) fed.add(c.name);

  const rivals = window.unavoidable
    .map((u) => graph.byId.get(u.id))
    .filter((q) => q?.kind === 'reaction' && q.source?.raw?.PrimaryInput === primary &&
                   [...q.consumes, ...q.requires].every((i) => fed.has(i.name)));
  if (!rivals.length) return null;

  // Tried in the order the game loaded them, which is the order they are baked.
  const all = [p, ...rivals].sort((a, b) => a.source.index - b.source.index);
  let left = 1;
  const members = all.map((q) => {
    const gate = q.source.raw.Probability || 1;    // no gate means every tick
    const fires = left / gate;
    left -= fires;
    return { id: q.id, label: q.label, probability: q.source.raw.Probability || null, fires };
  });
  const total = members.reduce((a, m) => a + m.fires, 0) || 1;
  for (const m of members) m.chance = m.fires / total;
  return members;
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
  for (const name of p.conditions.via || []) present.add(name);
  const catalysts = new Set((p.conditions.catalysts || []).map((c) => c.name));
  for (const name of catalysts) present.add(name);

  // Anything that could fire on what is standing there -- but only what would
  // fire *by itself*. Three things gate a process on something other than its
  // ingredients, and none of them is present unless this reaction brought it:
  // a catalyst, a current, and a spark. Without these, every reaction touching
  // water reads as if Electrolysis of Water were going off in it.
  // Its own steps are not side effects of itself, and a chain is a composition
  // of transitions already counted one by one -- listing it as well would have
  // every chamber holding water accused of freezing twice.
  const seen = new Set([p.id, ...(p.conditions.parts || [])]);
  const candidates = [];
  for (const name of present) {
    for (const q of graph.consumers(name)) {
      if (seen.has(q.id) || !TEMPERATURE_DRIVEN.has(q.kind)) continue;
      seen.add(q.id);
      if (q.conditions.parts) continue;
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
  // Several side reactions may be dodged at once and only one of them decides
  // the limit -- blending spores keeps under 101 °C because the spores go at
  // 102 °C, not because the Blender melts at 1538 °C. Both are worth listing;
  // only one explains the number.
  for (const a of window.avoided) {
    a.binding = a.range[0] === window.hi + 1 || a.range[1] === window.lo - 1;
  }
  window.competition = competitionFor(graph, p, window);
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
  const processes = [...reactionProcesses(db), ...materialProcesses(db), ...phaseChains(db)];

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
    /** Does the weather deliver this one? */
    fallsFromSky: (name) => FALLS_FROM_SKY.has(name),
    isManufactured: (name) => manufactured.has(name),
    producersOf,
    consumersOf,
    requiredBy,
    /** Every process that makes `name`, whether or not the kind is allowed. */
    producers: (name) => producersOf.get(name) || [],
    consumers: (name) => consumersOf.get(name) || [],
    kindsThatProduce: (name) => new Set((producersOf.get(name) || []).map((p) => p.kind)),
  };

  // A process that eats something Static happens where that thing sits: you
  // cannot pipe a Corundum Deposit into a furnace, you have to go and heat it
  // in the ground. It is a real route and the game allows it, but it is not
  // how a production line is built -- the player mines the deposit and feeds
  // the ore. Mining and handling are exempt, being player actions on placed
  // things by their nature.
  for (const p of processes) {
    p.inPlace = p.kind !== 'mine' && p.kind !== 'handling' &&
                p.consumes.some((i) => state.get(i.name) === 'Static');
  }

  // Depends on the finished index, so it runs last. Plan-independent: what a
  // chamber's contents would also do is a fact about the game, not about what
  // the reader asked for, so it is worked out once here rather than per solve.
  for (const p of processes) p.window = temperatureWindow(graph, p);

  return graph;
}
