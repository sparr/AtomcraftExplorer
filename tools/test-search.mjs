/** Ranking smoke tests for the search engine (runs headless via a fetch shim). */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { search } from '../src/search.js';

globalThis.fetch = async (u) => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const db = await loadData();
console.log(`loaded ${db.materials.length} materials, ${db.reactions.length} reactions, ` +
            `${db.bySymbol.size} symbols in use\n`);

let fail = 0;
const top = (q, n = 5) => search(db, q).results.slice(0, n).map((r) => r.m.display);

function expectTop(q, want) {
  const got = search(db, q).results[0]?.m;
  const name = got && (got.display === want || got.name === want);
  if (!name) { console.log(`FAIL  "${q}" -> ${got?.display ?? '(none)'}  want ${want}`); fail++; }
  else console.log(`ok    "${q}" -> ${got.display}`);
}
function expectContains(q, want) {
  const hits = search(db, q).results;
  if (!hits.some((r) => r.m.name === want || r.m.display === want)) {
    console.log(`FAIL  "${q}" (${hits.length} hits) does not contain ${want}`); fail++;
  } else console.log(`ok    "${q}" contains ${want} (${hits.length} hits)`);
}
function expectCount(q, pred, label) {
  const hits = search(db, q).results;
  const bad = hits.filter((r) => !pred(r.m));
  if (bad.length) { console.log(`FAIL  "${q}": ${bad.length} results violate ${label}, e.g. ${bad[0].m.name}`); fail++; }
  else console.log(`ok    "${q}" -> ${hits.length} hits, all ${label}`);
}

console.log('--- by name ---');
expectTop('water', 'Water');
expectTop('aluminum', 'Aluminum');
expectTop('molten iron', 'Molten Iron');
expectTop('vinegar', 'Vinegar');
expectContains('oscillator', '2 Step Oscillator');

console.log('\n--- by chemical symbol ---');
expectTop('H2O', 'Water');
expectTop('Al2O3', 'Alumina');
expectContains('Cu', 'Copper');
expectContains('Cu', 'Chalcopyrite');
expectContains('Au', 'Gold');

console.log('\n--- field filters ---');
expectCount('state:gas', (m) => m.state === 'Gas', 'Gas');
expectCount('el:U', (m) => m.formula?.counts.has('U'), 'contain U');
expectTop('z:26', 'Iron');
expectCount('z:92', (m) => m.raw.ProtonNumber === 92 || m.name === 'Uranium', 'Z=92');
expectCount('is:radioactive', (m) => !!m.raw.DecaySettings, 'radioactive');
expectCount('el:Fe state:liquid', (m) => m.formula?.counts.has('Fe') && m.state === 'Liquid',
            'liquid iron compounds');
expectCount('gold -is:hidden', (m) => !m.hidden, 'not hidden');

console.log('\n--- sample output ---');
for (const q of ['Cu', 'H2O', 'iron', 'el:Pt', 'state:plasma', 'z:80-92 is:isotope']) {
  const r = search(db, q);
  console.log(`  ${q.padEnd(22)} ${String(r.total).padStart(4)} hits  ${top(q, 5).join(' | ')}`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
