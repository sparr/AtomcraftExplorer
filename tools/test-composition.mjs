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
check(src('Molten Silica') === 'phase' && els('Molten Silica') === 'O Si',
      'Molten Silica is Silica, so it is SiO2');
check(src('Molten Alumina') === 'phase' && els('Molten Alumina') === 'Al O',
      'and Molten Alumina is Alumina');
// Filed as a phase change, Solid to Solid, and not one. Taken as identity it
// would declare a mushroom to be carbon.
check(!table.has('Bitter Oyster Spore') || src('Bitter Oyster Spore') !== 'phase',
      'but a spore "turning into" Carbon is not a state change and carries nothing');

console.log('\n--- and the rest is argued out of the reactions ---');
// None of these has a formula, and every one of them is on the road from
// Columbite to the metal. This is the case the whole module exists for.
for (const [name, want] of [['Heptafluorotantalic Acid', 'F H Ta'],
                            ['Aqueous Potassium Heptafluorotantalate(V)', 'F K Ta'],
                            ['Tantalum Pentoxide', 'O Ta'],
                            ['Heptafluoroniobic Acid', 'F H Nb'],
                            ['Niobium Pentoxide', 'Nb O']]) {
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

console.log('\n--- coverage, and knowing when to say nothing ---');
const by = { formula: 0, phase: 0, voted: 0 };
for (const v of table.values()) by[v.source]++;
console.log(`      formula ${by.formula}, phase ${by.phase}, voted ${by.voted}, ` +
            `silent on ${db.materials.length - table.size}`);
check(by.formula > 1000 && by.phase > 100 && by.voted > 50,
      'all three sources carry their share');
check(table.size < db.materials.length,
      'and it abstains rather than guessing at the ones with nothing to go on');
check(composition(graph) === table, 'worked out once and kept');

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
