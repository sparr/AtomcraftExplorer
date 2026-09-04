/**
 * Renders every material's detail pane and a spread of queries against a DOM
 * shim, to catch runtime errors the unit tests would miss.
 */
import { readFileSync } from 'node:fs';
import { installDom } from './dom-shim.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
installDom(ids);

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

await import('../src/main.js');
await new Promise((r) => setTimeout(r, 0));   // let boot() settle

const app = globalThis.window.explorer;
if (!app) { console.log('FAIL boot did not complete'); process.exit(1); }
const { db } = app;
console.log(`booted: ${db.materials.length} materials indexed\n`);

let fail = 0;
const detail = document.querySelector('#detail');
const results = document.querySelector('#results');

// --- every material renders -------------------------------------------------
let thin = 0, strayNull = 0;
for (const m of db.materials) {
  try {
    app.select(m);
  } catch (err) {
    console.log(`FAIL renderDetail(${m.name}): ${err.message}`);
    if (++fail > 5) { console.log('...stopping'); break; }
    continue;
  }
  const text = detail.textContent;
  if (!text.includes(m.display)) {
    console.log(`FAIL detail for ${m.name} does not show its name`); fail++;
  }
  if (text.length < 40) thin++;
  // ParentNode.append(null) stringifies -- a null section leaks into the page.
  for (const n of detail.walk()) {
    for (const c of n.childNodes) {
      if (!(c instanceof globalThis.Node) && /^(null|undefined)$/.test(c.text)) {
        if (strayNull++ === 0) console.log(`FAIL stray "${c.text}" text node in detail for ${m.name}`);
      }
    }
  }
}
if (strayNull) { console.log(`     ...${strayNull} stray null/undefined text nodes in total`); fail++; }
console.log(`ok    rendered ${db.materials.length} detail panes (${thin} minimal)`);

// --- links resolve or are marked dead --------------------------------------
let dead = 0, live = 0;
for (const m of db.materials) {
  app.select(m);
  for (const n of detail.walk()) {
    if (n.className === 'mat') live++;
    else if (n.className === 'mat-missing') {
      dead++;
      if (!db.dangling.has(n.textContent)) {
        console.log(`FAIL "${n.textContent}" marked dead but is not in the dangling list`); fail++;
      }
    }
  }
}
console.log(`ok    ${live} live cross-links, ${dead} correctly marked dead`);

// --- sections are collapsible disclosures ----------------------------------
app.select(db.byName.get('Oxygen'));
const sections = [...detail.walk()].filter((n) => n.className === 'sec');
if (!sections.length) { console.log('FAIL no collapsible sections rendered'); fail++; }
for (const sec of sections) {
  if (sec.tagName !== 'DETAILS') { console.log(`FAIL section is <${sec.tagName}>, want <details>`); fail++; break; }
  const summary = sec.children.find((c) => c.tagName === 'SUMMARY');
  if (!summary) { console.log('FAIL section has no <summary>'); fail++; break; }
  const kids = summary.children;
  if (kids[0]?.className !== 'twisty') { console.log('FAIL twisty is not first in <summary>'); fail++; break; }
  if (kids[1]?.tagName !== 'H3') { console.log('FAIL heading missing from <summary>'); fail++; break; }
}
console.log(`ok    ${sections.length} sections, each a <details> with a left twisty`);

// --- "Referenced by" groups instead of repeating the label -----------------
const refSec = sections.find((s) => s.textContent.startsWith('Referenced by'));
if (!refSec) { console.log('FAIL Oxygen has no Referenced by section'); fail++; }
else {
  const subs = [...refSec.walk()].filter((n) => n.className === 'subsec');
  if (!subs.length) { console.log('FAIL Referenced by has no sub-sections'); fail++; }
  const madeOf = (refSec.textContent.match(/made of/g) || []).length;
  if (madeOf !== 1) { console.log(`FAIL "made of" appears ${madeOf}x, want 1 (the group heading)`); fail++; }
  else console.log(`ok    Referenced by -> ${subs.length} groups; "made of" written once, not 337x`);
  for (const sub of subs) {
    if (sub.tagName !== 'DETAILS' || !sub.children.some((c) => c.tagName === 'SUMMARY')) {
      console.log('FAIL sub-section is not a collapsible <details>'); fail++; break;
    }
  }
}

// --- collapsing sticks when you move to another material -------------------
const target = sections.find((s) => s.textContent.startsWith('Composition'));
target.open = false;
target.dispatch('toggle');
app.select(db.byName.get('Water'));
app.select(db.byName.get('Oxygen'));
const reopened = [...detail.walk()].find((n) => n.className === 'sec' && n.textContent.startsWith('Composition'));
if (reopened.open !== false) { console.log('FAIL collapsed section reopened after switching material'); fail++; }
else console.log('ok    collapse state persists across material selection');

// --- queries render a result list ------------------------------------------
const queries = ['', 'water', 'Cu', 'H2O', 'el:Au', 'state:gas', 'is:radioactive',
                 'iron -is:hidden', 'z:80-92', 'el:Fe el:S', 'name:"Molten Iron"',
                 'zzzznope', '((((', 'el:', ':', '"unclosed'];
for (const q of queries) {
  try {
    app.setQuery(q);
    const n = results.children.length;
    const label = q === '' ? '(empty)' : q;
    console.log(`ok    ${label.padEnd(22)} ${String(n).padStart(4)} rows  ${results.children[0]?.textContent.slice(0, 42) ?? ''}`);
  } catch (err) {
    console.log(`FAIL query ${JSON.stringify(q)}: ${err.message}`); fail++;
  }
}

// --- periodic table toggles round-trip through the query --------------------
app.setQuery('');
const grid = document.querySelector('#ptable-grid');
const cu = [...grid.children].find((c) => c.dataset.sym === 'Cu');
cu.dispatch('click');
if (!document.querySelector('#q').value.includes('el:Cu')) { console.log('FAIL element click did not add el:Cu'); fail++; }
else console.log(`ok    periodic table click -> "${document.querySelector('#q').value}"`);
cu.dispatch('click');
if (document.querySelector('#q').value.includes('el:Cu')) { console.log('FAIL second click did not remove el:Cu'); fail++; }
else console.log('ok    second click removes the filter');

// --- inert cells for elements with no materials -----------------------------
const emptyCells = [...grid.children].filter((c) => 'empty' in c.dataset);
console.log(`ok    ${grid.children.length} element cells, ${emptyCells.length} inert`);

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
