/** Exercises the formula parser against every formula in the baked bundle. */
import { readFileSync } from 'node:fs';
import { parseFormula, formulaHtml, querySymbols } from '../src/formula.js';

const bundle = JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url)));
const symbols = new Set(bundle.elements.map((e) => e.sym));

let fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); fail++; }
};
const counts = (f) => Object.fromEntries([...parseFormula(f, symbols).counts].sort());

check('Al2O3', counts('Al2O3'), { Al: 2, O: 3 });
check('Al(OH)3', counts('Al(OH)3'), { Al: 1, H: 3, O: 3 });
check('CaSO4·2H2O', counts('CaSO4·2H2O'), { Ca: 1, H: 4, O: 6, S: 1 });
check('AgNO3+H2O', counts('AgNO3+H2O'), { Ag: 1, H: 2, N: 1, O: 4 });
check('H2O + CO2', counts('H2O + CO2'), { C: 1, H: 2, O: 3 });
check('2H2', counts('2H2'), { H: 4 });
check('Al2O3:Cr', counts('Al2O3:Cr'), { Al: 2, Cr: 1, O: 3 });
check('17% Co 83% Fe', counts('17% Co 83% Fe'), { Co: 1, Fe: 1 });
check('(Cs,Na)AlSi2O6·H2O', counts('(Cs,Na)AlSi2O6·H2O'),
      { Al: 1, Cs: 1, H: 2, Na: 1, O: 7, Si: 2 });
check('Al2SiO4(F,OH)2', counts('Al2SiO4(F,OH)2'),
      { Al: 2, F: 2, H: 2, O: 6, Si: 1 });
check('KLi3Al4O10(OH,F)2', counts('KLi3Al4O10(OH,F)2'),
      { Al: 4, F: 2, H: 2, K: 1, Li: 3, O: 12 });
check('Fe(Ta,Nb)2O6', counts('Fe(Ta,Nb)2O6'), { Fe: 1, Nb: 2, O: 6, Ta: 2 });
check('Pb5(VO4)3Cl', counts('Pb5(VO4)3Cl'), { Cl: 1, O: 12, Pb: 5, V: 3 });
check('X3Y2(SiO4)3 unknowns', parseFormula('X3Y2(SiO4)3', symbols).unknown, ['X']);
check('alternates flagged', [...parseFormula('(Fe,Mn)WO4', symbols).alternates].sort(),
      ['Fe', 'Mn']);

// Rendering must preserve every character of the source.
check('render Al2(SO4)3', formulaHtml(parseFormula('Al2(SO4)3', symbols)),
      '<span class="sym">Al</span><sub>2</sub>(<span class="sym">S</span>' +
      '<span class="sym">O</span><sub>4</sub>)<sub>3</sub>');

// querySymbols gates composition search.
check('query "water" is not chemistry', querySymbols('water', symbols), null);
check('query "Zz" is not chemistry', querySymbols('Zz', symbols), null);
check('query "Cu"', [...querySymbols('Cu', symbols).counts.keys()], ['Cu']);
check('query "H2O"', [...querySymbols('H2O', symbols).counts.keys()], ['H', 'O']);

// Whole-corpus sweep: nothing may parse to an empty result or lose text.
const strip = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const seen = new Set(), unknowns = new Map();
let empty = 0, roundtripFail = 0;
for (const m of bundle.materials) {
  if (!m.Formula || seen.has(m.Formula)) continue;
  seen.add(m.Formula);
  const p = parseFormula(m.Formula, symbols);
  if (!p.counts.size) { console.log(`  no elements parsed: ${m.Formula}`); empty++; }
  for (const u of p.unknown) unknowns.set(u, (unknowns.get(u) || 0) + 1);
  // Subscript rendering drops the "1" the source never wrote, so compare with
  // implicit ones removed on both sides.
  if (strip(formulaHtml(p)) !== m.Formula) {
    console.log(`  round-trip: ${m.Formula} -> ${strip(formulaHtml(p))}`);
    roundtripFail++;
  }
}
console.log(`\nswept ${seen.size} distinct formulas`);
console.log(`  parsed to zero elements: ${empty}`);
console.log(`  round-trip mismatches:   ${roundtripFail}`);
console.log(`  unknown tokens:          ${[...unknowns].map(([k, v]) => `${k}(${v})`).join(', ') || 'none'}`);
if (empty || roundtripFail) fail++;
console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
