/**
 * Works out formulas for the materials AllMaterials.json leaves blank, and
 * writes src/formulas.js.
 *
 * Two sources of evidence. A hand table for named compounds whose chemistry is
 * not in doubt, and conservation of atoms: where a reaction has exactly one
 * participant of unknown composition, the rest of the equation determines it.
 *
 * The second only works if you are choosy about which reactions you believe.
 * About a third of them do not conserve atoms, so an inference resting on a
 * single reaction is thrown away and only agreement between two or more
 * independent ones is kept. Nuclear decay, beam impact, growth and mining are
 * excluded outright -- those are supposed to create and destroy matter.
 *
 * Usage: node tools/derive-formulas.mjs
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const R = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(fs.readFileSync(`${R}/data/atomcraft.json`)),
});
const {loadData}=await import(R+'/src/data.js');
const {buildProcessGraph,DEFAULT_KINDS}=await import(R+'/src/plan-graph.js');
const rt=await import(R+'/src/rational.js');
const {rat,radd,rmul,rdiv,rcmp,rstr}=rt; const R0=rt.R0||rat(0);
const db=await loadData(); const g=buildProcessGraph(db);
const kinds=new Set(DEFAULT_KINDS);
// nuclear and growth legitimately do not conserve atoms; never infer from them
const INFER_KINDS=new Set(['reaction','phase','filter','handling']);
const BUGGY=new Set(['rx:Potassium + Water','rx:Sulfuric Acid + Andesite','rx:Hydrochloric Acid + Andesite',
  'rx:Steel Alloy','rx:Molten Steel + Oxygen Gas','rx:Hydrochloric Acid Dissolves Steel',
  'rx:Hydrochloric Acid Dissolves Potash']);

const HAND={
  // No "Molten X" or "X Vapor" entries: composition already carries a formula
  // across a phase link, and stating it again here would shadow that.
  'Sulfuric Acid':'H2SO4','Lye':'NaOH','Sand':'SiO2',
  'Limestone Gravel':'CaCO3','Seawater':'NaCl+H2O','Quicklime':'CaO','Slaked Lime':'Ca(OH)2',
  'Limewater':'Ca(OH)2+H2O','Potash':'K2CO3','Aqueous Potash':'K2CO3+H2O',
  'Aqua Regia':'HNO3+3HCl','Steel':'Fe',
  'Niobium Pentoxide':'Nb2O5','Tantalum Pentoxide':'Ta2O5',
  'Heptafluoroniobic Acid':'H2NbF7','Heptafluorotantalic Acid':'H2TaF7',
  'Potassium Heptafluoroniobate(V)':'K2NbF7','Potassium Heptafluorotantalate(V)':'K2TaF7',
  'Aqueous Potassium Heptafluoroniobate(V)':'K2NbF7+H2O',
  'Aqueous Potassium Heptafluorotantalate(V)':'K2TaF7+H2O',
  'Antimony(III) Oxide':'Sb2O3','Antimony Pentoxide':'Sb2O5',
  'Acetic Acid':'C2H4O2','Aluminum Hydroxide':'Al(OH)3','Ammonium Nitrate':'NH4NO3',
  'Ammonium Oxalate':'(NH4)2C2O4','Ammonium Metavanadate':'NH4VO3',
  'Antimony Pentachloride':'SbCl5','Antimony Pentafluoride':'SbF5','Antimony Tribromide':'SbBr3',
  'Antimony Trichloride':'SbCl3','Antimony Trifluoride':'SbF3','Antimony Triiodide':'SbI3',
  'Antimony Oxytrifluoride':'SbOF3',
};
// Chains of inference that reach a plausible-looking answer for the wrong
// reason. Apatite takes part in no reaction that fixes its composition -- only
// phase changes, mining, and blending into Clay -- so what comes back is
// really Clay's composition wearing apatite's name, and it lands on CaCO3.
// Apatite is a phosphate, and this data has both Phosphorus and Calcium
// Phosphate in it, so that answer is wrong however many reactions agree.
// It also mattered: a formula on Molten Apatite moved the whole Apatite
// phase-group out of "terrain" and in with the compounds.
const DOUBTED=new Set(['Apatite','Apatite Gravel','Molten Apatite','Clay','Clay Wall','Loam']);

const key=(v)=>[...v].sort().map(([e,n])=>e+':'+rstr(n)).join(',');
const clean=(v)=>{for(const [e,n] of [...v]) if(rcmp(n,R0)===0) v.delete(e); return v;};
const addInto=(a,v,k)=>{for(const [e,n] of v) a.set(e,radd(a.get(e)||R0,rmul(n,k)));};
const plusWater=(v)=>{const o=new Map(v);o.set('H',radd(o.get('H')||R0,rat(2)));o.set('O',radd(o.get('O')||R0,rat(1)));return o;};
// Hill order: C first, then H, then the rest alphabetically
const render=(v)=>{const es=[...v.keys()].sort();
  const ord=[...(v.has('C')?['C']:[]),...(v.has('H')?['H']:[]),...es.filter(e=>e!=='C'&&e!=='H')];
  return ord.map(e=>{const n=v.get(e);return e+(rcmp(n,rat(1))===0?'':rstr(n));}).join('');};
const integral=(v)=>[...v.values()].every(n=>!rstr(n).includes('/'));

const vec=new Map(),src=new Map();
const symbols=new Set(db.elements?db.elements.map(e=>e.sym):[]);
// Read raw.Formula, never m.formula: data.js now fills the blanks from
// src/formulas.js, so trusting the loaded value would let this script inherit
// its own last output and re-derive nothing.
for(const m of db.materials){
  if(!m.raw.Formula) continue;
  const f=m.formula; if(!f||!f.counts||!f.counts.size) continue;
  if((f.unknown&&f.unknown.length)||(f.alternates&&f.alternates.size)) continue;
  const v=new Map(); for(const [e,n] of f.counts) v.set(e,rat(n));
  vec.set(m.name,v); src.set(m.name,'game');
}
const gameHas=new Set(db.materials.filter((m)=>m.raw.Formula).map((m)=>m.name));
// Seed the hand table before inference so its knowledge propagates: without
// this, `Lye` sat outside the map and `Aqueous Lye` could not find its base.
const {parseFormula}=await import(R+'/src/formula.js');
const SYM=new Set(db.elements.map(e=>e.sym));
for(const [n,f] of Object.entries(HAND)){
  const p=parseFormula(f,SYM);
  if(!p||!p.counts.size||p.unknown.length){ console.log('  BAD HAND ENTRY',n,f); continue; }
  const v=new Map(); for(const [e,c] of p.counts) v.set(e,rat(c));
  vec.set(n,v); src.set(n,'hand');
}
// internal only: make aqueous entries consistent so inference is not poisoned
const bareAq=[];
for(const m of db.materials){
  if(!/^Aqueous /.test(m.name)||!vec.has(m.name)||!m.raw.Formula) continue;
  if(!/\+\s*H2O/.test(m.raw.Formula)){ vec.set(m.name,plusWater(vec.get(m.name))); bareAq.push(m.name); }
}
const procs=g.processes.filter(p=>INFER_KINDS.has(p.kind)&&!BUGGY.has(p.id));
const conflicts=[],single=[];
let added=1,round=0;
while(added&&round<12){
  added=0;round++;
  const cand=new Map();
  for(const p of procs){
    const parts=[...(p.consumes||[]).map(x=>[x,-1]),...(p.produces||[]).map(x=>[x,1])];
    const names=new Set(parts.filter(([x])=>!vec.has(x.name)).map(([x])=>x.name));
    if(names.size!==1) continue;
    const t=[...names][0]; if(HAND[t]) continue;
    let coef=R0; const kn=new Map();
    for(const [x,s] of parts){
      if(x.name===t) coef=radd(coef,rmul(rat(x.count||1),rat(s)));
      else addInto(kn,vec.get(x.name),rmul(rat(x.count||1),rat(s)));
    }
    if(rcmp(coef,R0)===0) continue;
    const v=new Map(); for(const [e,n] of kn) v.set(e,rdiv(rmul(n,rat(-1)),coef)); clean(v);
    if(!v.size||![...v.values()].every(n=>rcmp(n,R0)>0)) continue;
    if(!cand.has(t)) cand.set(t,new Map());
    const b=cand.get(t),k=key(v); if(!b.has(k)) b.set(k,{v,ids:[]}); b.get(k).ids.push(p.id);
  }
  for(const [t,b] of cand){
    const am=/^Aqueous (.+)$/.exec(t);
    if(am&&vec.has(am[1])){ vec.set(t,plusWater(vec.get(am[1]))); src.set(t,'rule'); added++; continue; }
    const opts=[...b.values()].sort((a,c)=>c.ids.length-a.ids.length);
    if(opts.length>1&&opts[0].ids.length===opts[1].ids.length){
      conflicts.push([t,opts.slice(0,3).map(o=>render(o.v)+'×'+o.ids.length).join(' vs ')]); continue; }
    vec.set(t,opts[0].v); src.set(t,'reaction'); src.set(t+'#n',opts[0].ids.length);
    if(opts[0].ids.length<2) single.push([t,render(opts[0].v),opts[0].ids[0]]);
    added++;
  }
}
// Final pass, not first-come: an aqueous form resolved in round 1 would have
// missed its water if its own base was still unknown at the time.
for(const m of db.materials){
  const am=/^Aqueous (.+)$/.exec(m.name);
  if(am&&!HAND[m.name]&&vec.has(am[1])){ vec.set(m.name,plusWater(vec.get(am[1]))); src.set(m.name,'rule'); }
}
// emit: only materials the game gives no formula for
const singleNames=new Set(single.map(s=>s[0]));
const table=[];
for(const m of db.materials){
  if(gameHas.has(m.name)) continue;
  if(HAND[m.name]){ table.push([m.name,HAND[m.name],'hand']); continue; }
  if(DOUBTED.has(m.name)) continue;
  const v=vec.get(m.name); if(!v) continue;
  if(!integral(v)) continue;
  if(singleNames.has(m.name)) continue;         // one reaction is not evidence enough
  table.push([m.name,render(v),src.get(m.name)==='rule'?'rule':'reaction']);
}
table.sort((a,b)=>a[0]<b[0]?-1:1);
const by={}; for(const [,,q] of table) by[q]=(by[q]||0)+1;
console.log('table entries:',table.length,JSON.stringify(by));
console.log('dropped: conflicting',conflicts.length,' single-reaction',single.length);
console.log('bare-formula aqueous entries needing +H2O:',bareAq.length,JSON.stringify(bareAq));

const groups = { hand: [], reaction: [], rule: [] };
for (const [n, f, q] of table) groups[q].push([n, f]);
const pad = Math.max(...table.map(([n]) => n.length)) + 3;
const emit = (rows) => rows.map(([n, f]) =>
  `  ${JSON.stringify(n)}:${' '.repeat(Math.max(1, pad - n.length))}${JSON.stringify(f)},`).join('\n');

const header = fs.readFileSync(`${R}/src/formulas.js`, 'utf8').split('export const')[0];
fs.writeFileSync(`${R}/src/formulas.js`, `${header}export const DERIVED_FORMULAS = {
  // -- named compounds the data omits, written by hand
${emit(groups.hand)}

  // -- solved from reactions, corroborated by two or more of them
${emit(groups.reaction)}

  // -- "Aqueous X" is X + H2O
${emit(groups.rule)}
};

/** The formula we believe a material has, when the game gives none. */
export function derivedFormula(name) {
  return Object.prototype.hasOwnProperty.call(DERIVED_FORMULAS, name)
    ? DERIVED_FORMULAS[name] : null;
}
`);
console.log(`wrote src/formulas.js: ${table.length} entries`,
  JSON.stringify(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length]))));
console.log(`dropped: ${conflicts.length} conflicting, ${single.length} resting on one reaction`);
