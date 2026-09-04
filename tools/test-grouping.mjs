/** Categorisation, grouping and ordering of materials. */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildGroups, sortMaterials, CATEGORIES, makeClassifier, groupKeyOf } from '../src/grouping.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const db = await loadData();
const groups = buildGroups(db.materials, db, {});
const byKey = new Map(groups.map((g) => [g.key, g]));
console.log(`${db.materials.length} materials -> ${groups.length} groups\n`);

let fail = 0;
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => { console.log(`FAIL  ${msg}`); fail++; };

// --- every material is placed exactly once ---------------------------------
{
  const seen = new Map();
  for (const g of groups) for (const m of g.members) seen.set(m.name, (seen.get(m.name) || 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1);
  const missing = db.materials.filter((m) => !seen.has(m.name));
  if (dupes.length) bad(`${dupes.length} materials in more than one group, e.g. ${dupes[0][0]}`);
  else if (missing.length) bad(`${missing.length} materials in no group, e.g. ${missing[0].name}`);
  else ok(`all ${db.materials.length} materials placed exactly once`);
  const known = new Set(CATEGORIES.map((c) => c.id));
  const stray = groups.filter((g) => !known.has(g.category));
  if (stray.length) bad(`${stray.length} groups have an unknown category`);
  else ok(`${CATEGORIES.length} categories, none unknown`);
}

// --- the groupings that were asked for -------------------------------------
const contains = (key, ...names) => {
  const g = byKey.get(key);
  if (!g) return bad(`no group "${key}"`);
  const have = new Set(g.members.map((m) => m.name));
  const missing = names.filter((n) => !have.has(n));
  if (missing.length) bad(`group "${key}" is missing ${missing.join(', ')}`);
  else ok(`"${key}" [${g.category}] holds ${g.members.length}: ${names.slice(0, 3).join(', ')}…`);
};
contains('Iron', 'Iron', 'Molten Iron');                       // states of one element
contains('Water', 'Water', 'Steam', 'Ice');                    // phases with unrelated names
contains('Bromine Gas', 'Bromine Gas', 'Liquid Bromine', 'Solid Bromine');
contains('Oxygen Gas', 'Oxygen Gas', 'Liquid Oxygen');
contains('Uranium', 'Uranium', 'Uranium-235');                 // isotopes under the element
contains('And Gate', 'And Gate', 'And Gate (Up) (On)', 'And Gate (Down) (Off)');
contains('Aluminum Wire', 'Aluminum Wire', 'Aluminum Wire On', 'Aluminum Wire (Turning Off)');
contains('Blender', 'Blender', 'Bits of Blender');             // "Bits of" under its machine
contains('Cornflower', 'Cornflower Stalk 1', 'Cornflower Petal L');
contains('Bullet', 'Bullet Up', 'Bullet Down', 'Bullet Left', 'Bullet Right');
contains('Laser Ruby', 'Laser Ruby Up On', 'Bits of Laser Ruby');
contains('Sugarcane', 'Sugarcane', 'Sugarcane Stalk 1');       // head has no formula

// --- category assignment ---------------------------------------------------
const catOf = (name) => groups.find((g) => g.members.some((m) => m.name === name))?.category;
for (const [name, want] of [
  ['Iron', 'element'], ['Molten Iron', 'element'], ['Uranium-235', 'element'],
  ['Sulfate Ion', 'ion'], ['Alumina', 'compound'], ['Aqueous Ammonia', 'mixture'],
  ['Aqueous Zinc Sulfate', 'mixture'],           // formula omits water; composition does not
  ['Bastnäsite Deposit', 'deposit'], ['Cornflower Stalk 1', 'plant'],
  ['Bullet Up', 'projectile'], ['And Gate', 'machine'], ['2 Step Oscillator', 'machine'],
]) {
  const got = catOf(name);
  if (got !== want) bad(`${name} is "${got}", want "${want}"`);
}
ok('category assignment for 12 representative materials');

// --- a name that looks like a phase but names another substance ------------
{
  // "Oxygen Gas" is O2 and "Oxygen" is O -- different substances that read like
  // phases of each other. The game gives them no transition between them.
  for (const [variant, element] of [['Oxygen Gas', 'Oxygen'], ['Bromine Gas', 'Bromine'],
                                    ['Nitrogen Gas', 'Nitrogen'], ['Chlorine Gas', 'Chlorine']]) {
    const g = groups.find((x) => x.members.some((m) => m.name === variant));
    if (g.members.some((m) => m.name === element)) {
      bad(`${variant} (${db.byName.get(variant).raw.Formula}) grouped with ` +
          `${element} (${db.byName.get(element).raw.Formula})`);
    }
  }
  ok('diatomic gases are not filed under their monatomic element');

  const allotropes = groups.filter((g) => g.category === 'allotrope');
  if (allotropes.length < 6) bad(`only ${allotropes.length} single-element compound groups`);
  else ok(`${allotropes.length} single-element compound groups: ${allotropes.map((g) => g.key).slice(0, 4).join(', ')}…`);

  // A machine melting into its metal must not join the metal.
  for (const [machine, metal] of [['Silver Wall', 'Silver'], ['Iron Wall', 'Iron']]) {
    const g = groups.find((x) => x.members.some((m) => m.name === machine));
    if (g?.members.some((m) => m.name === metal)) bad(`${machine} grouped with ${metal}`);
  }
  ok('machines are not filed under the metal they melt into');
}

// --- things that must NOT be stripped or merged ----------------------------
{
  const classify = makeClassifier(db.materials);
  const exists = (n) => db.byName.has(n);
  const key = (n) => { const m = db.byName.get(n); return groupKeyOf(m, classify(m), exists); };

  // Roman numerals are oxidation states, not variant markers.
  for (const n of ['Aqueous Potassium Heptafluoroniobate(V)', 'Copper(II) Chloride', 'Antimony(III) Oxide']) {
    if (!key(n).includes('(')) bad(`oxidation state stripped from ${n} -> ${key(n)}`);
  }
  ok('oxidation states survive: (V), (II), (III)');

  // A phase suffix only folds in when the base material exists.
  if (key('Arsenic Trioxide Gas') !== 'Arsenic Trioxide Gas') {
    bad(`"Arsenic Trioxide Gas" folded into a base that does not exist`);
  } else ok('phase suffixes only fold when the base material exists');

  // Non-isotope trailing digits are part of the name.
  if (key('Cornflower Stalk 1') === 'Cornflower Stalk') bad('trailing digit stripped from a plant stage');
  else ok('trailing digits kept on non-isotopes');
}

// --- sort parameter --------------------------------------------------------
{
  const els = (opts) => buildGroups(db.materials, db, opts).filter((g) => g.category === 'element');
  const zOrder = els({ sortBy: 'z' }).map((g) => g.key);
  const nameOrder = els({ sortBy: 'name' }).map((g) => g.key);
  if (zOrder[0] !== 'Hydrogen') bad(`sortBy z starts at ${zOrder[0]}, want Hydrogen`);
  if (nameOrder.join() === zOrder.join()) bad('sortBy made no difference to elements');
  const sorted = [...nameOrder].sort((a, b) => a.localeCompare(b));
  if (nameOrder.join() !== sorted.join()) bad('sortBy name did not order elements alphabetically');
  else ok(`sortBy: z starts ${zOrder.slice(0, 4).join(', ')}; name starts ${nameOrder.slice(0, 3).join(', ')}`);

  // Compounds are always by name, whatever the parameter says.
  for (const by of ['name', 'z']) {
    const keys = buildGroups(db.materials, db, { sortBy: by })
      .filter((g) => g.category === 'compound').map((g) => g.key);
    const want = [...keys].sort((a, b) => a.localeCompare(b));
    if (keys.join() !== want.join()) bad(`compounds not name-ordered under sortBy ${by}`);
  }
  ok('compounds are name-ordered under either sort parameter');
}

// --- stable and total ------------------------------------------------------
{
  const a = sortMaterials(db.materials, db, { sortBy: 'z' }).map((m) => m.name);
  const b = sortMaterials(db.materials, db, { sortBy: 'z' }).map((m) => m.name);
  if (a.join() !== b.join()) bad('sort is not deterministic');
  else if (a.length !== db.materials.length) bad(`flattened sort returned ${a.length} of ${db.materials.length}`);
  else ok(`sortMaterials returns a stable total order over all ${a.length} materials`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
