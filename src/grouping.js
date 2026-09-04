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
 *   group    -- variants of one thing. "Molten Iron", "Iron Gas" and the 30
 *               isotopes all belong under "Iron"; the eight And Gate
 *               direction/state permutations belong under "And Gate".
 *
 * Grouping works by stripping variant markers off names. Phase affixes are only
 * stripped when what is left names a material that actually exists, so
 * "Arsenic Trioxide Gas" stays put (there is no "Arsenic Trioxide") while
 * "Bromine Gas" folds into "Bromine".
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

/**
 * The name a material's group is filed under.
 * @param {object} m       material
 * @param {string} category its category id
 * @param {(name: string) => boolean} exists
 */
export function groupKeyOf(m, category, exists) {
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
      if (name.startsWith(p) && exists(name.slice(p.length))) { name = name.slice(p.length); break; }
    }
    for (const s of PHASE_SUFFIXES) {
      if (name.endsWith(s) && exists(name.slice(0, -s.length))) { name = name.slice(0, -s.length); break; }
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

/** Within a group, the plainest-named member represents it. */
function pickHead(key, members) {
  return members.find((m) => m.name === key)
      ?? [...members].sort((a, b) => a.name.length - b.name.length ||
                                     a.name.localeCompare(b.name))[0];
}

/**
 * Group and order materials.
 * @param {object[]} materials
 * @param {object} db
 * @param {{sortBy?: 'name'|'z'}} opts  'z' orders elements by atomic number;
 *   everything else is always by name, since compounds have no atomic number.
 * @returns {{category: string, label: string, key: string, head: object, members: object[]}[]}
 */
export function buildGroups(materials, db, { sortBy = 'name' } = {}) {
  const classify = makeClassifier(db.materials);
  const exists = (name) => db.byName.has(name);

  // Group by name alone, then let the head decide the category: a variant is
  // whatever its plainest form is. Classifying first would split "Iron" from
  // "Molten Iron", which the game ships without a formula and which would
  // therefore land in a different bucket than the metal it is made of.
  const groups = new Map();
  for (const m of materials) {
    const key = groupKeyOf(m, classify(m), exists);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, head: null, members: [] }));
    g.members.push(m);
  }

  const zOf = (m) => db.elementBySymbol.get(m.raw.Formula)?.z ?? 999;

  for (const g of groups.values()) {
    g.head = pickHead(g.key, g.members);
    g.category = categoryOf(g, classify);
    g.label = CATEGORIES[CATEGORY_RANK.get(g.category)].label;
    g.members.sort((a, b) =>
      (a === g.head ? -1 : b === g.head ? 1 : 0) ||
      // Isotopes read best in mass order, not alphabetically.
      (a.raw.MassNumber || 0) - (b.raw.MassNumber || 0) ||
      a.display.localeCompare(b.display));
  }

  return [...groups.values()].sort((a, b) =>
    CATEGORY_RANK.get(a.category) - CATEGORY_RANK.get(b.category) ||
    (a.category === 'element' && sortBy === 'z' ? zOf(a.head) - zOf(b.head) : 0) ||
    a.key.localeCompare(b.key));
}

/** The same order, flattened -- for callers that just want a sorted list. */
export function sortMaterials(materials, db, opts) {
  return buildGroups(materials, db, opts).flatMap((g) => g.members);
}
