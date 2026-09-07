/**
 * What things are made of, where the game does not say.
 *
 * Run against the real bake, because the whole point is the shape of the game's
 * own data: which materials were given a formula, which reactions conserve what
 * they claim to, and which are a probabilistic split wearing a reaction's
 * clothes. A fixture would be written from the same misreading as the code.
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph } from '../src/plan-graph.js';
import { composition, contains, elementsOf } from '../src/composition.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const db = await loadData();
const graph = buildProcessGraph(db);

let fail = 0;
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => { console.log(`FAIL  ${msg}`); fail++; };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

const table = composition(graph);
const els = (n) => [...(table.get(n)?.elements || [])].sort().join(' ');
const src = (n) => table.get(n)?.source ?? null;

console.log('--- what the game states ---');
check(src('Water') === 'formula' && els('Water') === 'H O', 'a formula is read as it stands');
check(els('Columbite') === 'Fe Nb O Ta',
      'and `Fe(Ta,Nb)2O6` mentions both, which for a question about presence is right');

console.log('\n--- a phase change is the same substance ---');
// Both now have a formula of their own out of src/formulas.js, so they are
// read rather than inherited. The answer is the one the phase link used to
// give, which is the point: a melt is the same substance.
check(src('Molten Silica') === 'formula' && els('Molten Silica') === 'O Si',
      'Molten Silica is Silica, so it is SiO2');
check(src('Molten Alumina') === 'formula' && els('Molten Alumina') === 'Al O',
      'and Molten Alumina is Alumina');
// Still carried across a phase link, and worth checking because the water
// comes from our "Aqueous X is X + H2O" rule two steps back: the rule feeds
// Aqueous Potassium Chloride, which freezing then inherits.
check(src('Frozen Aqueous Potassium Chloride') === 'phase' &&
      els('Frozen Aqueous Potassium Chloride') === 'Cl H K O',
      'and freezing a solution keeps both the salt and the water');
// Filed as a phase change, Solid to Solid, and not one. Taken as identity it
// would declare a mushroom to be carbon.
check(!table.has('Bitter Oyster Spore') || src('Bitter Oyster Spore') !== 'phase',
      'but a spore "turning into" Carbon is not a state change and carries nothing');

console.log('\n--- the road from Columbite, which we now supply formulas for ---');
// Every one of these is on the road from Columbite to the metal, and none of
// them had a formula in the game data. Composition used to argue them out of
// the reactions; src/formulas.js now states them outright, so the source has
// moved -- but the answer must not. That is the point of checking them here.
for (const [name, want] of [['Heptafluorotantalic Acid', 'F H Ta'],
                            // H and O because it is K2TaF7 dissolved in water,
                            // which the voted answer used to miss.
                            ['Aqueous Potassium Heptafluorotantalate(V)', 'F H K O Ta'],
                            ['Tantalum Pentoxide', 'O Ta'],
                            ['Heptafluoroniobic Acid', 'F H Nb'],
                            ['Niobium Pentoxide', 'Nb O']]) {
  check(src(name) === 'formula' && els(name) === want, `${name} comes out as ${want}`);
}

console.log('\n--- and the rest is argued out of the reactions ---');
// No formula anywhere, ours included: these are knowable only from what goes
// into them and what comes back out. This is the case the module exists for.
for (const [name, want] of [['Ammonium Paratungstate', 'H N O W'],
                            ['Fluoroantimonic Acid', 'F H O Sb'],
                            ['Bertrandite', 'Be H O Si'],
                            ['Nepheline', 'Al Ca Na Si'],
                            ['Molten Brass', 'Cu Zn']]) {
  check(src(name) === 'voted' && els(name) === want, `${name} comes out as ${want}`);
}

console.log('\n--- competing branches are read together, not one by one ---');
// Lepidolite's three decompositions share a chamber one way in three, and the
// branch that makes the lithium never mentions the potassium. Read alone it
// says the potassium became silica, and Molten Silica came out "K Si Al".
check(!contains(graph, 'Molten Silica', 'K'), 'no potassium is invented for Molten Silica');
check(!contains(graph, 'Molten Silica', 'Al'), 'nor aluminium');
check(!contains(graph, 'Molten Alumina', 'Fe'), 'nor iron for Molten Alumina');

console.log('\n--- the question a plan actually asks ---');
check(contains(graph, 'Heptafluorotantalic Acid', 'Ta'),
      'a leftover acid can be told to have tantalum in it');
const asked = elementsOf(graph, ['Tantalum', 'Niobium']);
check(asked.has('Ta') && asked.has('Nb') && asked.size === 2,
      'and what was asked for reduces to Ta and Nb');

console.log('\n--- one typo, corrected by name ---');
// The game writes Magnesium Fluoride as MgFl2, and Fl is flerovium. Seven
// other formulas say Fl and all seven mean it, so the mend has to be this
// narrow. Asserted on the answer, not on where the answer came from.
check(contains(graph, 'Magnesium Fluoride', 'F'),
      'Magnesium Fluoride is made of fluorine');
check(!contains(graph, 'Magnesium Fluoride', 'Fl'),
      'and not of a superheavy that lasts two seconds');
check(contains(graph, 'Magnesium Fluoride', 'Mg'), 'its magnesium survives the mend');
check(contains(graph, 'Flerovium', 'Fl') && !contains(graph, 'Flerovium', 'F'),
      'while flerovium itself is left alone');
check(elementsOf(graph, ['Magnesium Fluoride', 'Hydrofluoric Acid']).has('F'),
      'so a question about fluorine reaches both ways of buying it');

console.log('\n--- coverage, and knowing when to say nothing ---');
const by = { formula: 0, phase: 0, voted: 0 };
for (const v of table.values()) by[v.source]++;
console.log(`      formula ${by.formula}, phase ${by.phase}, voted ${by.voted}, ` +
            `silent on ${db.materials.length - table.size}`);
// The thresholds for phase and voting are lower than they once were: the 249
// formulas in src/formulas.js took over materials those two used to carry.
check(by.formula > 1200 && by.phase > 50 && by.voted > 30,
      'all three sources carry their share');
check(table.size < db.materials.length,
      'and it abstains rather than guessing at the ones with nothing to go on');
check(composition(graph) === table, 'worked out once and kept');

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
