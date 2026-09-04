/**
 * Categorising, grouping and ordering materials.
 *
 * Two ideas, kept separate:
 *
 *   category -- what kind of thing a material is. Every material lands in
 *               exactly one, tested in the order below because the tests
 *               overlap: Kelp Stalk has drop rates but is a plant, and an
 *               oscillator's formula is "Cu" but it is a machine, not copper.
 *
 *   group    -- variants of one thing. "Molten Iron" and the 30 isotopes all
 *               belong under "Iron"; the eight And Gate direction/state
 *               permutations belong under "And Gate".
 *
 * Grouping works two ways, because neither alone is right.
 *
 * Names carry variant markers, which get stripped -- but a phase affix is only
 * stripped when what remains names a material that exists AND states the same
 * formula. "Oxygen Gas" is O2 while "Oxygen" is O: different substances that
 * merely read like phases of each other, and the game agrees, giving them no
 * transition between them.
 *
 * Phase transitions are the other half. Evaporation and condensation targets
 * say outright that two materials are one substance in different states, which
 * catches what names cannot: "Liquid Oxygen" belongs with "Oxygen Gas" rather
 * than with "Oxygen", and "Steam" belongs with "Water" despite sharing no part
 * of its name.
 */

export const CATEGORIES = [
  { id: 'element',    label: 'Elements' },
  { id: 'allotrope',  label: 'Single-element compounds' },
  { id: 'ion',        label: 'Polyatomic ions' },
  { id: 'compound',   label: 'Compounds' },
  { id: 'mixture',    label: 'Mixtures & solutions' },
  { id: 'deposit',    label: 'Deposits' },
  { id: 'plant',      label: 'Plants' },
  { id: 'projectile', label: 'Projectiles & beams' },
  { id: 'machine',    label: 'Machines & structures' },
  { id: 'other',      label: 'Other' },
];

const CATEGORY_RANK = new Map(CATEGORIES.map((c, i) => [c.id, i]));

// Trailing "(Off)", "(Up)", "(1500)" mark variants. Roman numerals must survive:
// "Potassium Heptafluoroniobate(V)" is an oxidation state, not a variant.
const VARIANT_PAREN = /\s*\((?:On|Off|Turning On|Turning Off|Active|Rest|Burning|Up|Down|Left|Right|\d+)\)\s*$/;
const VARIANT_WORD = /\s+(?:On|Off|Up|Down|Left|Right)$/;

const PHASE_PREFIXES = ['Molten ', 'Frozen ', 'Liquid ', 'Falling ', 'Solid '];
const PHASE_SUFFIXES = [' Gas', ' Vapor', ' Powder', ' Crystal'];
const BITS_PREFIX = 'Bits of ';

/** Materials that are, or grow into, a plant. */
function plantNames(materials) {
  const names = new Set();
  for (const m of materials) {
    if (m.raw.GrowthRules) {
      names.add(m.name);
      for (const g of m.raw.GrowthRules) names.add(g.GrowthMaterialName);
    }
  }
  return names;
}

/** A material is a solution if its formula says so, or its composition does. */
function isMixture(m) {
  if (/[+·]/.test(m.raw.Formula || '')) return true;
  return (m.raw.Composition?.Elements || [])
    .some((e) => e.Item1 === '+H2O' || e.Item1 === 'Water');
}

export function makeClassifier(materials) {
  const plants = plantNames(materials);

  return function classify(m) {
    if (plants.has(m.name)) return 'plant';
    if (/(^|\s)(Bullet|Laser)(\s|$)/.test(m.name) || m.state === 'Plasma') return 'projectile';
    if (/ Deposit$/.test(m.name) || m.raw.DropRates) return 'deposit';
    // Before the formula tests: a machine's formula is its build material.
    if (m.state === 'Static' || m.raw.IsMechanical || m.name.startsWith(BITS_PREFIX)) return 'machine';
    if (m.raw.ShowParenthesesWhenInFormula) return 'ion';

    if (m.formula && m.formula.counts.size === 1) {
      const [count] = m.formula.counts.values();
      return count === 1 ? 'element' : 'allotrope';
    }
    if (isMixture(m)) return 'mixture';
    if (m.formula) return 'compound';
    return 'other';
  };
}

/** Same substance, or one side simply does not state a formula. */
function sameSubstance(a, b) {
  return !a || !b || a === b;
}

/**
 * The name a material's group is filed under.
 * @param {object} m       material
 * @param {string} category its category id
 * @param {(name: string) => object|undefined} lookup  resolves a material by name
 */
export function groupKeyOf(m, category, lookup) {
  // Plants are named "<Plant> <Part> <Index>"; the plant is the first word.
  if (category === 'plant') return m.name.split(' ')[0];

  let name = m.name;
  for (let guard = 0; guard < 8; guard++) {
    const before = name;

    if (name.startsWith(BITS_PREFIX)) name = name.slice(BITS_PREFIX.length);
    name = name.replace(VARIANT_PAREN, '').replace(VARIANT_WORD, '');
    // Only isotopes carry a mass-number suffix; other trailing digits are real.
    if (m.raw.ProtonNumber) name = name.replace(/-\d+$/, '');

    for (const p of PHASE_PREFIXES) {
      if (!name.startsWith(p)) continue;
      const base = lookup(name.slice(p.length));
      if (base && sameSubstance(m.raw.Formula, base.raw.Formula)) {
        name = name.slice(p.length);
        break;
      }
    }
    for (const suffix of PHASE_SUFFIXES) {
      if (!name.endsWith(suffix)) continue;
      const base = lookup(name.slice(0, -suffix.length));
      if (base && sameSubstance(m.raw.Formula, base.raw.Formula)) {
        name = name.slice(0, -suffix.length);
        break;
      }
    }

    if (name === before) break;
  }
  return name.trim() || m.name;
}

/**
 * A group takes its head's category -- unless the head falls in "other", which
 * is a fallback rather than a kind. Harvested Sugarcane has no formula and no
 * growth rules, but it heads a group of seven Sugarcane stalks, so the group is
 * plants.
 */
function categoryOf(group, classify) {
  const headCategory = classify(group.head);
  if (headCategory !== 'other') return headCategory;

  const votes = new Map();
  for (const m of group.members) {
    const c = classify(m);
    if (c !== 'other') votes.set(c, (votes.get(c) || 0) + 1);
  }
  if (!votes.size) return 'other';
  return [...votes].sort((a, b) =>
    b[1] - a[1] || CATEGORY_RANK.get(a[0]) - CATEGORY_RANK.get(b[0]))[0][0];
}

/**
 * Within a group, the plainest form represents it: a member that is already its
 * own base name, else the one the rest of the data leans on most.
 */
function pickHead(members, keyOf) {
  const base = members.filter((m) => m.name === keyOf(m));
  const pool = base.length ? base : members;
  return [...pool].sort((a, b) =>
    (b.refs || 0) - (a.refs || 0) ||
    a.name.length - b.name.length ||
    a.name.localeCompare(b.name))[0];
}

/**
 * Group and order materials.
 * @param {object[]} materials
 * @param {object} db
 * @param {{sortBy?: 'name'|'z'|'relevance'}} opts  'z' orders elements by atomic
 *   number and everything else by name, since compounds have no atomic number;
 *   'relevance' keeps the order the materials arrived in, ranking each group by
 *   its best-placed member.
 * @returns {{category: string, label: string, key: string, head: object, members: object[]}[]}
 */
export function buildGroups(materials, db, { sortBy = 'name' } = {}) {
  const classify = makeClassifier(db.materials);
  const lookup = (name) => db.byName.get(name);

  const keyOf = new Map();
  for (const m of materials) keyOf.set(m, groupKeyOf(m, classify(m), lookup));

  // Union the name-derived keys that phase transitions say are one substance.
  const parent = new Map();
  const formulas = new Map();          // component -> the formulas its members state
  for (const [m, k] of keyOf) {
    if (!parent.has(k)) { parent.set(k, k); formulas.set(k, new Set()); }
    if (m.raw.Formula) formulas.get(k).add(m.raw.Formula);
  }
  const find = (k) => {
    while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); }
    return k;
  };
  /**
   * Merge two components, unless between them they would state more than one
   * formula. Checking whole components rather than the two linked materials
   * matters when a formula-less material bridges them: Liquid Hydrogen states
   * none, so it files under Hydrogen (H) by name and then links reciprocally to
   * Hydrogen Gas (H2), which would drag H2 in behind it.
   */
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a === b) return;
    const merged = new Set([...formulas.get(a), ...formulas.get(b)]);
    if (merged.size > 1) return;
    parent.set(a, b);
    formulas.set(b, merged);
  };

  // Phase transitions say two materials are one substance in different states.
  const byName = new Map(materials.map((m) => [m.name, m]));
  const evaporatesTo = (m) => m?.raw.Evaporation?.TargetMaterialName;
  const condensesTo = (m) => m?.raw.Condensation?.TargetMaterialName;

  for (const m of materials) {
    for (const [forward, back] of [[evaporatesTo, condensesTo], [condensesTo, evaporatesTo]]) {
      const target = byName.get(forward(m));
      if (!target) continue;

      // A device and a puddle of its metal are never the same substance, even
      // when the game links them both ways: Bits of Heating Element melts into
      // Molten Nichrome and freezes back out of it. Ice is Static too but is
      // not machinery, which is what lets it stay with Water.
      if (!!m.raw.IsMechanical !== !!target.raw.IsMechanical) continue;

      // A reciprocal pair is trusted outright: Water freezes to Ice and Ice
      // melts back to Water, and Ice states no formula at all.
      //
      // A one-way link needs more: both sides naming the same formula, and
      // neither being a machine. Bromine Gas condenses straight to Solid
      // Bromine, skipping the liquid, and all three are Br2 -- while a Silver
      // Wall melts one-way into Molten Silver and states Ag just like the metal
      // does, but it is a thing built from silver, not silver in another state.
      const reciprocal = back(target) === m.name;
      const oneWay = !!m.raw.Formula && !!target.raw.Formula &&
                     classify(m) !== 'machine' && classify(target) !== 'machine';
      if (reciprocal || oneWay) union(keyOf.get(m), keyOf.get(target));
    }
  }

  const groups = new Map();
  materials.forEach((m, i) => {
    const id = find(keyOf.get(m));
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { key: id, head: null, members: [], rank: i }));
    g.members.push(m);
    g.rank = Math.min(g.rank, i);
  });

  const zOf = (m) => db.elementBySymbol.get(m.raw.Formula)?.z ?? 999;

  for (const g of groups.values()) {
    g.head = pickHead(g.members, (m) => keyOf.get(m));
    g.key = keyOf.get(g.head);       // name the group after the form that heads it
    g.category = categoryOf(g, classify);
    g.label = CATEGORIES[CATEGORY_RANK.get(g.category)].label;
    g.members.sort((a, b) =>
      (a === g.head ? -1 : b === g.head ? 1 : 0) ||
      (a.raw.MassNumber || 0) - (b.raw.MassNumber || 0) ||
      a.display.localeCompare(b.display));
  }

  const all = [...groups.values()];
  // Relevance keeps the incoming order, so categories interleave by score.
  if (sortBy === 'relevance') return all.sort((a, b) => a.rank - b.rank);

  return all.sort((a, b) =>
    CATEGORY_RANK.get(a.category) - CATEGORY_RANK.get(b.category) ||
    (a.category === 'element' && sortBy === 'z' ? zOf(a.head) - zOf(b.head) : 0) ||
    a.key.localeCompare(b.key));
}

/** The same order, flattened -- for callers that just want a sorted list. */
export function sortMaterials(materials, db, opts) {
  return buildGroups(materials, db, opts).flatMap((g) => g.members);
}
