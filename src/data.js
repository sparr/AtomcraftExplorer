/**
 * Loads the baked bundle and builds the lookup structures the UI needs.
 *
 * Everything here is derived once at start-up; the search path only reads.
 */
import { parseFormula } from './formula.js';

/**
 * Fixed display order for back-reference relationships, so a material's
 * "Referenced by" groups always appear in the same sequence rather than
 * shuffling with each material's own counts.
 *
 * Ordered by how often each relationship occurs across the whole data set
 * (4906 deduped references over 19 relationships), measured once rather than
 * recomputed per build. "dissolves into" is defined but currently unused by any
 * material. Anything not listed sorts to the end alphabetically; the render
 * test asserts the list still covers every relationship in the data.
 */
export const REFERENCE_ORDER = [
  'made of',            // 1692
  'mines into',         //  490
  'evaporates into',    //  402
  'decays into',        //  258
  'alpha impact',       //  234
  'neutron impact',     //  228
  'proton impact',      //  221
  'ignites into',       //  210
  'builds into',        //  188
  'drops',              //  157
  'rotates left into',  //  147
  'rotates right into', //  147
  'condenses into',     //  144
  'grows into',         //  108
  'combusts into',      //   88
  'turns off into',     //   68
  'turns on into',      //   56
  'picked up into',     //   40
  'extinguishes into',  //   28
  'dissolves into',     //    0
];

/** Godot Color (0..1 floats) -> CSS. */
function cssColor(c, alpha) {
  if (!c) return null;
  const b = (v) => Math.round(Math.min(1, Math.max(0, v || 0)) * 255);
  const a = alpha === undefined || alpha === 0 ? 1 : alpha;
  return `rgba(${b(c.R)}, ${b(c.G)}, ${b(c.B)}, ${a})`;
}

/** Strip a trailing "(Off)" / "(Turning On)" / "-225" for grouping variants. */
function baseName(name) {
  return name.replace(/\s*\((?:On|Off|Turning On|Turning Off|Burning|[A-Z][a-z]+)\)\s*$/, '')
             .replace(/-\d+$/, '')
             .trim();
}

export async function loadData(url = './data/atomcraft.json') {
  // The single-file build embeds the bundle, so it never touches the network
  // -- that is what lets it run straight off the filesystem.
  let bundle = globalThis.__ATOMCRAFT_BUNDLE__;
  if (!bundle) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    bundle = await res.json();
  }

  const symbols = new Set(bundle.elements.map((e) => e.sym));
  const dangling = new Set(bundle.dangling);
  const states = bundle.enums.State;

  const materials = bundle.materials.map((raw, index) => {
    const formula = parseFormula(raw.Formula, symbols);
    // Isotopes all share their element's localized name ("Lead"), so put the
    // mass number back on to keep them distinguishable in a result list.
    const display = raw.MassNumber ? `${raw.Display || raw.Name}-${raw.MassNumber}`
                                   : (raw.Display || raw.Name);
    return {
      index,
      raw,
      name: raw.Name,
      display,
      base: baseName(raw.Name),
      formula,
      state: states[raw.State ?? 0] || String(raw.State),
      color: cssColor(raw.Color, raw.Alpha),
      description: raw.Description || '',
      hidden: !!raw.SuppressInGuide,
      // Lowercased once so the search loop never allocates.
      lcName: raw.Name.toLowerCase(),
      lcDisplay: display.toLowerCase(),
      lcFormula: (raw.Formula || '').toLowerCase(),
      lcDescription: (raw.Description || '').toLowerCase(),
    };
  });

  const byName = new Map(materials.map((m) => [m.name, m]));

  const bySymbol = new Map();
  for (const m of materials) {
    if (!m.formula) continue;
    for (const sym of m.formula.counts.keys()) {
      if (!bySymbol.has(sym)) bySymbol.set(sym, []);
      bySymbol.get(sym).push(m);
    }
  }

  // Reactions, with each material's involvement indexed both ways.
  const reactionsByMaterial = new Map();
  const involve = (name, role, reaction) => {
    let e = reactionsByMaterial.get(name);
    if (!e) reactionsByMaterial.set(name, (e = { inputs: [], outputs: [], catalysts: [] }));
    e[role].push(reaction);
  };
  const reactions = bundle.reactions.map((raw, index) => {
    const r = {
      index,
      name: raw.Name,
      raw,
      inputs: Object.entries(raw.Inputs || {}),
      outputs: Object.entries(raw.Outputs || {}),
      catalysts: Object.entries(raw.Catalysts || {}),
    };
    for (const [n] of r.inputs) involve(n, 'inputs', r);
    for (const [n] of r.outputs) involve(n, 'outputs', r);
    for (const [n] of r.catalysts) involve(n, 'catalysts', r);
    return r;
  });

  // Which materials name this one -- powers the "referenced by" section.
  const referencedBy = new Map();
  const link = (target, source, label) => {
    if (!target) return;
    let list = referencedBy.get(target);
    if (!list) referencedBy.set(target, (list = []));
    list.push({ source, label });
  };
  const DIRECT = {
    TurnsIntoFromAlphaParticleImpact: 'alpha impact',
    TurnsIntoFromProtonImpact: 'proton impact',
    TurnsIntoFromNeutronImpact: 'neutron impact',
    PickUpInto: 'picked up into',
    MinesInto: 'mines into',
    BuildsInto: 'builds into',
    TurnsOnInto: 'turns on into',
    TurnsOffInto: 'turns off into',
    RotatesRightInto: 'rotates right into',
    RotatesLeftInto: 'rotates left into',
    GrowsInto: 'grows into',
    DissolvesInto: 'dissolves into',
  };
  for (const m of materials) {
    for (const [field, label] of Object.entries(DIRECT)) link(m.raw[field], m, label);
    for (const [field, label] of [['Condensation', 'condenses into'],
                                  ['Evaporation', 'evaporates into'],
                                  ['Ignition', 'ignites into']]) {
      if (m.raw[field]) link(m.raw[field].TargetMaterialName, m, label);
    }
    const d = m.raw.DecaySettings;
    if (d) { link(d.MaterialName, m, 'decays into'); link(d.MaterialName2, m, 'decays into'); }
    const f = m.raw.Fire;
    if (f) {
      link(f.ExtinguishTargetMaterialName, m, 'extinguishes into');
      for (const t of f.CombustionTargetMaterialNames || []) link(t, m, 'combusts into');
    }
    for (const g of m.raw.GrowthRules || []) link(g.GrowthMaterialName, m, 'grows into');
    for (const t of Object.keys(m.raw.DropRates || {})) link(t, m, 'drops');
    for (const e of m.raw.Composition?.Elements || []) link(e.Item1, m, 'made of');
  }

  // How many places name each material.  Used as a mild centrality signal so
  // that, among equally good matches, the material the game actually leans on
  // wins -- "H2O" should land on Water rather than Steam.
  for (const m of materials) {
    const rx = reactionsByMaterial.get(m.name);
    m.refs = (referencedBy.get(m.name)?.length || 0) +
             (rx ? rx.inputs.length + rx.outputs.length + rx.catalysts.length : 0);
  }

  // Annotate the element table with the materials that carry each symbol.
  const elements = bundle.elements.map((e) => ({
    ...e,
    material: byName.get(e.mat) || null,
    count: (bySymbol.get(e.sym) || []).length,
  }));

  return {
    meta: bundle.meta,
    enums: bundle.enums,
    symbols,
    elements,
    elementBySymbol: new Map(elements.map((e) => [e.sym, e])),
    materials,
    byName,
    bySymbol,
    reactions,
    reactionsByMaterial,
    referencedBy,
    dangling,
    isDangling: (name) => dangling.has(name),
  };
}
