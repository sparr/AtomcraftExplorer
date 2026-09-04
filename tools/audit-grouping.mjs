import { readFileSync } from 'node:fs';
globalThis.fetch = async () => ({ ok:true, json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))) });
const { loadData } = await import('../src/data.js');
const { buildGroups, effectiveFormulas, makeClassifier } = await import('../src/grouping.js');
const db = await loadData();
const classify = makeClassifier(db.materials);
const eff = effectiveFormulas(db.materials);
const F = m => eff.get(m) ?? m.raw.Formula ?? null;
const gs = buildGroups(db.materials, db, {});
const G = new Map(); for (const g of gs) for (const m of g.members) G.set(m.name, g);
const sec = t => console.log('\n=== ' + t + ' ===');

// 1. phase links the rules rejected, with the reason
sec('1. rejected phase links');
const evap = m => m?.raw.Evaporation?.TargetMaterialName, cond = m => m?.raw.Condensation?.TargetMaterialName;
const reasons = new Map();
for (const m of db.materials) {
  for (const [f, b] of [[evap, cond], [cond, evap]]) {
    const t = db.byName.get(f(m)); if (!t) continue;
    if (G.get(m.name) === G.get(t.name)) continue;
    const recip = b(t) === m.name;
    const holds = (x) => ['machine', 'deposit'].includes(classify(x));
    let why;
    if (!!m.raw.IsMechanical !== !!t.raw.IsMechanical) why = 'mechanical boundary';
    else if (!recip && (!F(m) || !F(t))) why = 'one-way, a formula missing';
    else if (!recip && (holds(m) || holds(t))) why = 'one-way, holds the material';
    else why = 'would make a group state two formulas';
    if (!reasons.has(why)) reasons.set(why, []);
    reasons.get(why).push(`${m.name} -> ${t.name}`);
  }
}
for (const [why, list] of [...reasons].sort((a,b)=>b[1].length-a[1].length))
  console.log('  ' + String(list.length).padStart(4), why.padEnd(26), list.slice(0,3).join(' ; '));

// 2. same formula, different groups
sec('2. same formula but separate groups (possible missed merges)');
const byFormula = new Map();
for (const m of db.materials) { const f = F(m); if (!f) continue; (byFormula.get(f) ?? byFormula.set(f, []).get(f)).push(m); }
const split = [];
for (const [f, ms] of byFormula) {
  const groups = new Set(ms.map(m => G.get(m.name)));
  if (groups.size > 1) split.push([f, ms.length, groups.size, [...groups].map(g=>g.key)]);
}
console.log('  ' + split.length + ' formulas span multiple groups (mostly legitimate: different compounds share a formula)');
for (const [f,n,k,keys] of split.sort((a,b)=>b[2]-a[2]).slice(0,10)) console.log('    ' + f.padEnd(10), n + ' materials in ' + k + ' groups: ' + keys.slice(0,5).join(', '));

// 3. name-stem families split across groups
sec('3. "<affix> X" separated from X');
const AFF = [['Molten ','p'],['Liquid ','p'],['Frozen ','p'],['Solid ','p'],[' Gas','s'],[' Vapor','s']];
let sep = 0;
for (const m of db.materials) {
  for (const [a, kind] of AFF) {
    const has = kind==='p' ? m.name.startsWith(a) : m.name.endsWith(a);
    if (!has) continue;
    const baseName = kind==='p' ? m.name.slice(a.length) : m.name.slice(0, -a.length);
    const base = db.byName.get(baseName); if (!base) continue;
    if (G.get(m.name) !== G.get(base.name)) {
      if (sep++ < 14) console.log('  ' + m.name.padEnd(28), F(m)??'-', ' vs ', baseName.padEnd(22), F(base)??'-');
    }
  }
}
console.log('  ...' + sep + ' total');

// 4. isotopes away from their element
sec('4. isotopes not grouped with their element');
let iso = 0;
for (const m of db.materials) {
  const mm = /^(.*)-\d+$/.exec(m.name); if (!mm || !m.raw.ProtonNumber) continue;
  const el = db.byName.get(mm[1]); if (!el) continue;
  if (G.get(m.name) !== G.get(el.name)) { if (iso++ < 6) console.log('  ' + m.name + ' apart from ' + mm[1]); }
}
console.log('  ' + iso + ' total');

// 5. category sanity
sec('5. category sanity');
const elems = gs.filter(g=>g.category==='element');
const oddElem = elems.filter(g => { const f = F(g.head); return f && !db.elementBySymbol.has(f); });
console.log('  element groups whose head formula is not an element symbol:', oddElem.length, oddElem.slice(0,6).map(g=>g.key+'='+F(g.head)).join(', '));
const allo = gs.filter(g=>g.category==='allotrope');
console.log('  single-element compound groups:', allo.length, allo.map(g=>g.key).join(', '));

// 6. groups spanning odd state ranges
sec('6. groups whose members span many states');
for (const g of gs) {
  const st = new Set(g.members.map(m=>m.state));
  if (st.size >= 3) console.log('  ' + g.key.padEnd(22), '[' + g.category + ']', [...st].join('/'), ':', g.members.map(m=>m.name).join(', ').slice(0,60));
}
