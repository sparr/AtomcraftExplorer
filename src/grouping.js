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
  { id: 'terrain',    label: 'Terrain & minerals' },
  { id: 'plant',      label: 'Plants' },
  { id: 'biological', label: 'Biological' },
  { id: 'projectile', label: 'Projectiles & beams' },
  { id: 'structure',  label: 'Placed blocks' },
  { id: 'machine',    label: 'Machines' },
  { id: 'other',      label: 'Other' },
];

const CATEGORY_RANK = new Map(CATEGORIES.map((c, i) => [c.id, i]));

// Categories that are made of, or hold, a material without being it. Melting
// one yields the material, which is extraction rather than a change of state.
// Terrain is not among them: melting Apatite really does give Molten Apatite.
const HOLDS_MATERIAL = new Set(['machine', 'structure', 'deposit']);

/**
 * Living things, their parts and their products.
 *
 * There is no flag for this. IsFoodIngredient catches the food but not the
 * anatomy, MAT_BIO_ covers only the fireflies and mites, and an organic
 * composition also describes a wooden wall. So this is a list, keyed on the
 * LocIdName stem because the names carry indices -- Trunk1 through Trunk25,
 * Left Branch1 through Right Branch5.
 */
const BIOLOGICAL_STEMS = new Set([
  // anatomy
  'ALVEOLAR_CELL', 'ARACHNOID_MATER', 'BLOOD', 'BONE', 'BONE_MARROW',
  'CEREBROSPINAL_FLUID', 'DURA_MATER', 'ENDOTHELIAL_CELL', 'LYMPH', 'MUCUS',
  'NEURON', 'PIA_MATER', 'SMOOTH_MUSCLE_CELL', 'STEM_CELL',
  // fungi
  'BITTEROYSTER', 'BITTEROYSTER_SPORE', 'BITTEROYSTER_STALK', 'BITTEROYSTER_STREAMER',
  'DEATH_MOSS', 'DEATH_MOSS_SPORE', 'DEATH_MOSS_STALK', 'DEATH_MOSS_STREAMER',
  'EMBERCROWN', 'EMBERCROWN_SPORE', 'EMBERCROWN_STALK', 'EMBERCROWN_STREAMER',
  'FOXFIRE', 'FOXFIRE_SPORE', 'FOXFIRE_STALK', 'FOXFIRE_STREAMER', 'MOSS',
  // plant tissue that carries no growth rules of its own
  'BRANCH', 'FALLEN_LEAF', 'GRASS', 'GRASS_BURNING', 'GRASS_CUT', 'LEAF',
  'LEAVES', 'LEAVES_BURNING', 'ROOT', 'TREE', 'TREE_BURNING', 'TRUNK',
  'WOOD', 'WOOD_ASH', 'WOOD_BURNING',
  'KELP', 'KELP_BURNING', 'KELP_STALK', 'KELP_STALK_END',
  // seeds
  'SEED', 'CORNFLOWER_SEED', 'GRASS_SEED', 'KELP_SEED', 'MARIGOLD_SEED',
  'ROSE_SEED', 'SESAME_SEED', 'SUNFLOWER_SEED', 'VIOLET_SEED',
  // produce that carries no food flag
  'TOMATO',
  // creatures and what comes off them
  'CHICKEN_RAW', 'CHICKEN_COOKED', 'CHICKEN_FRIED', 'CHICKEN_MARINATED',
  'CHICKEN_EGG', 'EGG_SHELL', 'EGG_YOLK', 'ECTOPLASM',
  'FIREFLY_EGG', 'FIREFLY_FED', 'FIREFLY_HUNGRY', 'FIREFLY_OLD', 'FIREFLY_PREGNANT',
  'MITE_FED', 'MITE_HUNGRY',
  'SLIME_BLUE', 'SLIME_CYAN', 'SLIME_GREEN', 'SLIME_MAGNETA', 'SLIME_ORANGE',
  'SLIME_PURPLE', 'SLIME_RED', 'SLIME_ULTIMATE', 'SLIME_WHITE', 'SLIME_YELLOW',
]);

const locStem = (m) => m.raw.LocIdName.replace(/^MAT_[A-Z]+_/, '');

/**
 * Food, minus the minerals the game also flags as edible.
 * Salt (NaCl) and Snow (H2O) carry IsFoodIngredient, so require an organic
 * formula or none at all.
 */
function isFood(m) {
  if (!m.raw.IsFoodIngredient) return false;
  const f = m.raw.Formula;
  return !f || (/C/.test(f) && /H/.test(f));
}

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
    if (BIOLOGICAL_STEMS.has(locStem(m)) || isFood(m)) return 'biological';
    if (/(^|\s)(Bullet|Laser)(\s|$)/.test(m.name) || m.state === 'Plasma') return 'projectile';
    if (/ Deposit$/.test(m.name) || m.raw.DropRates) return 'deposit';

    // Everything below is placed in the world, and their formula names what
    // they are built from rather than what they are, so they come before the
    // formula tests: an oscillator is Cu but it is not copper.
    if (m.raw.IsMechanical || m.name.startsWith(BITS_PREFIX)) return 'machine';
    if (m.raw.IsBuilt || / Wall$/.test(m.name)) return 'structure';
    if (m.state === 'Static') return 'terrain';

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

/** Reciprocal phase partners: each names the other as its opposite transition. */
function phasePartners(materials) {
  const byName = new Map(materials.map((m) => [m.name, m]));
  const evaporatesTo = (m) => m?.raw.Evaporation?.TargetMaterialName;
  const condensesTo = (m) => m?.raw.Condensation?.TargetMaterialName;

  const partners = new Map(materials.map((m) => [m, []]));
  for (const m of materials) {
    for (const [forward, back] of [[evaporatesTo, condensesTo], [condensesTo, evaporatesTo]]) {
      const target = byName.get(forward(m));
      if (!target || back(target) !== m.name) continue;
      // A device and a puddle of its metal are never one substance, however the
      // game links them: Bits of Heating Element melts into Molten Nichrome and
      // freezes back out of it. Ice is Static too but is not machinery, which
      // is what lets it stay with Water.
      if (!!m.raw.IsMechanical !== !!target.raw.IsMechanical) continue;
      partners.get(m).push(target);
    }
  }
  return partners;
}

/**
 * Formulas, with a formula-less material adopting the one its phase partner
 * states -- the game's own statement that they are one substance, which beats
 * what a name happens to look like.
 *
 * Liquid Hydrogen states nothing, so by name alone it files under Hydrogen (H).
 * Its partner Hydrogen Gas says H2, and once it inherits that it goes where it
 * belongs. Partners that disagree leave the formula unset rather than guessing.
 */
export function effectiveFormulas(materials) {
  const partners = phasePartners(materials);
  const formula = new Map(materials.map((m) => [m, m.raw.Formula || null]));

  for (let pass = 0; pass < materials.length; pass++) {
    let changed = false;
    for (const m of materials) {
      if (formula.get(m)) continue;
      const stated = new Set(partners.get(m).map((p) => formula.get(p)).filter(Boolean));
      if (stated.size === 1) { formula.set(m, [...stated][0]); changed = true; }
    }
    if (!changed) break;
  }
  return formula;
}

/**
 * The name a material's group is filed under.
 * @param {object} m       material
 * @param {string} category its category id
 * @param {(name: string) => object|undefined} lookup  resolves a material by name
 * @param {(m: object) => string|null} [formulaOf]  formula to compare on
 */
export function groupKeyOf(m, category, lookup, formulaOf = (x) => x.raw.Formula || null) {
  // Plants are named "<Plant> <Part> <Index>"; the plant is the first word.
  if (category === 'plant') return m.name.split(' ')[0];
  // Biological parts carry indices the names cannot be stripped of -- Trunk1
  // through Trunk25, Left Branch1 through Right Branch5 -- but the game gives
  // every one of them the same LocIdName stem, so use that.
  if (category === 'biological') return locStem(m);

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
      if (base && sameSubstance(formulaOf(m), formulaOf(base))) {
        name = name.slice(p.length);
        break;
      }
    }
    for (const suffix of PHASE_SUFFIXES) {
      if (!name.endsWith(suffix)) continue;
      const base = lookup(name.slice(0, -suffix.length));
      if (base && sameSubstance(formulaOf(m), formulaOf(base))) {
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
 * Machine variants carry a power state and a facing, written three ways:
 * "Laser Ruby Down Off", "And Gate (Down) (Off)", "Plasma Gun Down (Active)".
 * State sorts ahead of facing, so all the off ones sit together instead of
 * being scattered one per direction.
 */
const VARIANT_STATES = ['', 'On', 'Off', 'Turning On', 'Turning Off', 'Active', 'Rest'];
const VARIANT_FACINGS = ['', 'Up', 'Down', 'Left', 'Right'];

function variantState(name) {
  const paren = /\((On|Off|Turning On|Turning Off|Active|Rest)\)\s*$/.exec(name);
  if (paren) return paren[1];
  const bare = /\s(On|Off)$/.exec(name);
  return bare ? bare[1] : '';
}

function variantFacing(name) {
  const m = /\((Up|Down|Left|Right)\)|\b(Up|Down|Left|Right)\b/.exec(name);
  return m ? (m[1] ?? m[2]) : '';
}

const rankIn = (list, value) => {
  const i = list.indexOf(value);
  return i < 0 ? list.length : i;
};

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

  // Phase partners settle formulas before names get a say.
  const effective = effectiveFormulas(db.materials);
  const formulaOf = (m) => effective.get(m) ?? m.raw.Formula ?? null;

  const keyOf = new Map();
  for (const m of materials) keyOf.set(m, groupKeyOf(m, classify(m), lookup, formulaOf));

  // Union the name-derived keys that phase transitions say are one substance.
  const parent = new Map();
  const formulas = new Map();          // component -> the formulas its members state
  for (const [m, k] of keyOf) {
    if (!parent.has(k)) { parent.set(k, k); formulas.set(k, new Set()); }
    if (formulaOf(m)) formulas.get(k).add(formulaOf(m));
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
      // both being the substance itself rather than something that merely
      // contains it. Bromine Gas condenses straight to Solid Bromine, skipping
      // the liquid, and all three are Br2 -- while a Silver Wall melts into
      // Molten Silver and a Gold Deposit into Molten Gold, each stating the
      // same formula as the metal without being that metal in another state.
      const reciprocal = back(target) === m.name;
      const isSubstance = (x) => !HOLDS_MATERIAL.has(classify(x));
      const oneWay = !!formulaOf(m) && !!formulaOf(target) &&
                     isSubstance(m) && isSubstance(target);
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
    g.keyOf = keyOf;                 // kept so a filtered view can re-pick a head
    g.head = pickHead(g.members, (m) => keyOf.get(m));
    g.key = keyOf.get(g.head);       // name the group after the form that heads it
    g.category = categoryOf(g, classify);
    g.label = CATEGORIES[CATEGORY_RANK.get(g.category)].label;
    g.members.sort((a, b) =>
      (a === g.head ? -1 : b === g.head ? 1 : 0) ||
      (a.raw.MassNumber || 0) - (b.raw.MassNumber || 0) ||
      rankIn(VARIANT_STATES, variantState(a.name)) - rankIn(VARIANT_STATES, variantState(b.name)) ||
      rankIn(VARIANT_FACINGS, variantFacing(a.name)) - rankIn(VARIANT_FACINGS, variantFacing(b.name)) ||
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

/**
 * Narrow already-built groups to a subset of materials.
 *
 * Grouping must run over the whole catalogue, because what joins two materials
 * can be a third one: Water and +H2O are one substance only by way of Ice and
 * Steam. Grouping the results of a search for "water" would drop those bridges
 * and split the group, showing two rows both reading "Water". So group
 * everything once, then filter.
 *
 * The head is re-picked from the survivors, so a search for "molten iron" still
 * shows Molten Iron rather than the Iron it files under.
 *
 * @param {object[]} groups     output of buildGroups over every material
 * @param {object[]} materials  the subset to keep, in relevance order
 */
export function filterGroups(groups, materials, { sortBy = 'name' } = {}) {
  const rank = new Map(materials.map((m, i) => [m, i]));
  const kept = [];

  for (const g of groups) {
    const members = g.members.filter((m) => rank.has(m));
    if (!members.length) continue;
    kept.push({
      ...g,
      members,
      head: pickHead(members, (m) => g.keyOf.get(m)),
      rank: Math.min(...members.map((m) => rank.get(m))),
    });
  }

  if (sortBy === 'relevance') return kept.sort((a, b) => a.rank - b.rank);
  return kept;                       // buildGroups already ordered these
}

/** The same order, flattened -- for callers that just want a sorted list. */
export function sortMaterials(materials, db, opts) {
  return buildGroups(materials, db, opts).flatMap((g) => g.members);
}
