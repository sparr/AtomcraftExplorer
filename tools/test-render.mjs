/**
 * Renders every material's detail pane and a spread of queries against a DOM
 * shim, to catch runtime errors the unit tests would miss.
 */
import { readFileSync } from 'node:fs';
import { installDom } from './dom-shim.mjs';
import { REFERENCE_ORDER } from '../src/data.js';
import { COLLAPSIBLE, packCollapsed, unpackCollapsed, collapseKey } from '../src/collapse.js';
import { CATEGORIES } from '../src/grouping.js';

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
const bad = (m) => { console.log(`FAIL ${m}`); fail++; };
const detail = document.querySelector('#detail');
const results = document.querySelector('#results');

// --- every material renders -------------------------------------------------
let thin = 0, strayNull = 0;
const brokenValues = new Map();
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
  // A field the baker dropped as a default zero renders as "undefined" inside
  // otherwise fine text -- "at undefined K", "mode undefined". \bNaN\b avoids
  // matching NaNO3 and friends.
  for (const frag of text.match(/.{0,30}(\bundefined\b|\bNaN\b).{0,16}/g) || []) {
    if (!brokenValues.has(frag)) brokenValues.set(frag, m.name);
  }
}
if (strayNull) { console.log(`     ...${strayNull} stray null/undefined text nodes in total`); fail++; }
if (brokenValues.size) {
  console.log(`FAIL ${brokenValues.size} detail panes render undefined/NaN values:`);
  for (const [frag, name] of [...brokenValues].slice(0, 6)) {
    console.log(`        ${name}: …${frag.replace(/\s+/g, ' ')}…`);
  }
  fail++;
} else {
  console.log('ok    no undefined or NaN values in any detail pane');
}
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

// --- the frozen relationship order still covers the data -------------------
{
  const seen = new Set();
  for (const list of db.referencedBy.values()) for (const r of list) seen.add(r.label);
  const missing = [...seen].filter((l) => !REFERENCE_ORDER.includes(l)).sort();
  if (missing.length) {
    console.log(`FAIL REFERENCE_ORDER is missing: ${missing.join(', ')}`); fail++;
  } else {
    console.log(`ok    REFERENCE_ORDER covers all ${seen.size} relationships in the data`);
  }
  if (new Set(REFERENCE_ORDER).size !== REFERENCE_ORDER.length) {
    console.log('FAIL REFERENCE_ORDER has duplicates'); fail++;
  }
}

// --- groups appear in the frozen order, not by per-material size -----------
{
  // Carbon has the most varied back-references, so it exercises the ordering.
  app.select(db.byName.get('Carbon'));
  const sec = [...detail.walk()].find((n) => n.className === 'sec' &&
                                             n.textContent.startsWith('Referenced by'));
  const labels = [...sec.walk()].filter((n) => n.className === 'subsec')
    .map((n) => n.dataset.slot.replace(/^subsec:/, ''));
  const expected = [...labels].sort((a, b) => REFERENCE_ORDER.indexOf(a) - REFERENCE_ORDER.indexOf(b));
  if (labels.join(' | ') !== expected.join(' | ')) {
    console.log(`FAIL group order ${labels.join(', ')}\n     want      ${expected.join(', ')}`); fail++;
  } else {
    console.log(`ok    groups in frozen order: ${labels.join(', ')}`);
  }
  app.select(db.byName.get('Oxygen'));
}

// --- every key the UI produces has a slot in the wire format ---------------
{
  const seen = new Set();
  for (const m of db.materials) {
    app.select(m);
    for (const n of detail.walk()) {
      if (n.className !== 'sec' && n.className !== 'subsec') continue;
      seen.add(n.dataset.slot);   // the real slot, not one re-derived from the heading
    }
  }
  const missing = [...seen].filter((k) => !COLLAPSIBLE.includes(k)).sort();
  if (missing.length) {
    console.log(`FAIL COLLAPSIBLE has no slot for: ${missing.join(', ')}`); fail++;
  } else {
    console.log(`ok    all ${seen.size} section keys in use have a slot (of ${COLLAPSIBLE.length})`);
  }
}

// --- codec round-trips, and stays small ------------------------------------
{
  const cases = [[], ['sec:Referenced by'], ['sec:Physical', 'subsec:made of'], COLLAPSIBLE];
  for (const keys of cases) {
    const back = [...unpackCollapsed(packCollapsed(keys))].sort();
    if (back.join('|') !== [...keys].sort().join('|')) {
      console.log(`FAIL codec round-trip for ${keys.length} keys`); fail++;
    }
  }
  const all = packCollapsed(COLLAPSIBLE);
  if (all.length > 12) { console.log(`FAIL packed payload is ${all.length} chars`); fail++; }
  else console.log(`ok    codec round-trips; everything collapsed packs to "${all}" (${all.length} chars)`);
  if (unpackCollapsed('!!!').size || unpackCollapsed(null).size) {
    console.log('FAIL junk in the URL was not ignored'); fail++;
  }
}

// --- collapsing writes the URL, and a reload restores it -------------------
{
  app.setQuery('water');
  app.select(db.byName.get('Water'));
  const before = globalThis.location.hash;
  const sec = [...detail.walk()].find((n) => n.className === 'sec' &&
                                             n.textContent.startsWith('Physical'));
  sec.open = false;
  sec.dispatch('toggle');
  const after = globalThis.location.hash;
  if (after === before || !/[#&]c=/.test(after)) {
    console.log(`FAIL collapsing did not reach the URL: ${after}`); fail++;
  } else {
    console.log(`ok    collapsing writes the URL: ${after}`);
  }
  // A reload is readHash() over that same fragment, then a fresh render.
  app.reload();
  const reloaded = [...detail.walk()].find((n) => n.className === 'sec' &&
                                                  n.textContent.startsWith('Physical'));
  if (reloaded.open !== false) { console.log('FAIL section reopened after reload'); fail++; }
  else console.log('ok    reload restores the collapsed section from the URL');
  if (document.querySelector('#q').value !== 'water') {
    console.log('FAIL reload lost the query'); fail++;
  }
}

// --- building a pane must not look like a user toggle ----------------------
{
  // Browsers queue a toggle event when .open is set during construction. The
  // shim does not, so replay it: dispatch toggle with the state unchanged and
  // check nothing moved.
  // The set mutation is a no-op either way, so watch the history writes: an
  // unguarded handler calls replaceState once per section on every render.
  app.select(db.byName.get('Water'));
  const realReplace = globalThis.history.replaceState;
  let writes = 0;
  globalThis.history.replaceState = (...a) => { writes++; return realReplace(...a); };
  const nodes = [...detail.walk()].filter((n) => n.className === 'sec' || n.className === 'subsec');
  for (const n of nodes) n.dispatch('toggle');
  globalThis.history.replaceState = realReplace;
  if (writes) {
    console.log(`FAIL ${nodes.length} construction-time toggles caused ${writes} history writes`);
    fail++;
  } else {
    console.log(`ok    ${nodes.length} construction-time toggle events ignored, 0 history writes`);
  }
}

// --- back-reference headings state their direction -------------------------
{
  app.select(db.byName.get('Carbon'));
  const sec = [...detail.walk()].find((n) => n.className === 'sec' &&
                                             n.textContent.startsWith('Referenced by'));
  const heads = [...sec.walk()].filter((n) => n.className === 'subsec')
    .map((n) => n.children.find((c) => c.tagName === 'SUMMARY').textContent);
  const bare = heads.filter((h) => !/^\d+ materials? /.test(h));
  if (bare.length) { console.log(`FAIL heading does not name its subject: ${bare[0]}`); fail++; }
  else if (!heads.every((h) => /\bthis$/.test(h))) {
    console.log('FAIL heading does not end by pointing at this material'); fail++;
  } else console.log(`ok    back-ref headings read as sentences: "${heads[0]}"`);

  // Singular and plural must agree.
  const wrong = heads.filter((h) => /^1 materials /.test(h) || /^(?!1 )\d+ material /.test(h));
  if (wrong.length) { console.log(`FAIL bad plural: ${wrong[0]}`); fail++; }

  app.select(db.byName.get('Water'));
  const one = [...detail.walk()].filter((n) => n.className === 'subsec')
    .map((n) => n.children.find((c) => c.tagName === 'SUMMARY').textContent)
    .find((h) => h.startsWith('1 material '));
  if (one && !/^1 material [a-z]/.test(one)) { console.log(`FAIL singular form: ${one}`); fail++; }
  else if (one) console.log(`ok    singular agrees: "${one}"`);
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

// --- grouped result list ---------------------------------------------------
{
  const sortHost = document.querySelector('#sort');
  const buttons = () => sortHost.children.filter((c) => c.className === 'sortbtn');

  app.setQuery('');
  globalThis.location.hash = '#s=name';
  app.reload();

  if (buttons().length !== 3) bad(`sort control has ${buttons().length} buttons, want 3`);
  const pressed = buttons().find((b) => b.getAttribute('aria-pressed') === 'true');
  if (pressed?.dataset.mode !== 'name') { console.log('FAIL sort control does not show the active mode'); fail++; }
  else console.log(`ok    sort control: ${buttons().map((b) => b.textContent).join(', ')} (active: ${pressed.textContent})`);

  const heads = results.children.filter((r) => r.className === 'cat-head');
  if (heads.length < 3) { console.log(`FAIL grouped view rendered ${heads.length} category headings`); fail++; }
  else console.log(`ok    grouped view: ${heads.length} categories, ${results.children.length} rows`);

  // Categories must appear in the declared order, never interleaved.
  const order = heads.map((h) => h.textContent.replace(/\s*\(\d+\)$/, ''));
  const want = CATEGORIES.map((c) => c.label).filter((l) => order.includes(l));
  if (order.join('|') !== want.join('|')) {
    console.log(`FAIL categories out of order: ${order.join(', ')}`); fail++;
  } else console.log(`ok    categories in declared order: ${order.slice(0, 4).join(', ')}…`);

  // Sorting by atomic number must actually reorder the elements.
  const firstRow = () => results.children.find((r) => r.className === 'row')?.dataset.name;
  const byName = firstRow();
  globalThis.location.hash = '#s=z';
  app.reload();
  const byZ = firstRow();
  if (byName === byZ) { console.log(`FAIL name and atomic-number sort agree (${byZ})`); fail++; }
  else console.log(`ok    sort by name -> ${byName}; by atomic number -> ${byZ}`);

  // The expander sits in the row's leading column and toggles its variants.
  const lead = results.children.find((r) => r.children.some(
    (c) => c.className === 'row-lead' && c.children.length));
  const toggle = lead && lead.children.find((c) => c.className === 'row-lead').children[0];
  if (!toggle) { console.log('FAIL no group expander rendered in a row'); fail++; }
  else if (!/twisty/.test(toggle.className)) {
    console.log(`FAIL expander is "${toggle.className}", want a twisty`); fail++;
  } else {
    const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
    const before = results.children.length;
    toggle.dispatch('click', { stopPropagation() {} });
    const after = results.children.length;
    const moved = wasOpen ? after < before : after > before;
    if (!moved) { console.log(`FAIL expander did not change the row count (${before} -> ${after})`); fail++; }
    else console.log(`ok    left-hand expander toggles ${Math.abs(after - before)} variant rows`);
  }

  // Selecting a row opens its group. Collapse it first so the check is real --
  // earlier steps in this file have already selected every material.
  {
    const isotopeRows = () => results.children
      .filter((r) => /\bvariant\b/.test(r.className) && /^Uranium-/.test(r.dataset.name)).length;
    const uraniumRow = results.children.find((r) => r.dataset.name === 'Uranium');
    const twisty = uraniumRow.children.find((c) => c.className === 'row-lead').children[0];
    if (twisty.getAttribute('aria-expanded') === 'true') twisty.dispatch('click', { stopPropagation() {} });
    if (isotopeRows()) { console.log('FAIL could not collapse the Uranium group to set up the check'); fail++; }
    else {
      app.select(app.db.byName.get('Uranium'));
      if (!isotopeRows()) { console.log('FAIL selecting Uranium did not reveal its isotopes'); fail++; }
      else console.log(`ok    selecting a row expands its group (${isotopeRows()} isotopes revealed)`);

      // Clicking the selected row again works its twisty, without deselecting.
      const selectedNames = () => results.children
        .filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => r.dataset.name);
      results.children.find((r) => r.dataset.name === 'Uranium').dispatch('click');
      if (isotopeRows()) { console.log('FAIL second click did not collapse the group'); fail++; }
      else if (selectedNames().join() !== 'Uranium') {
        console.log(`FAIL second click changed the selection to ${selectedNames()}`); fail++;
      } else if (!detail.textContent.startsWith('Uranium')) {
        console.log('FAIL second click cleared the detail pane'); fail++;
      } else console.log('ok    clicking the selected row collapses its group, selection intact');

      results.children.find((r) => r.dataset.name === 'Uranium').dispatch('click');
      if (!isotopeRows()) { console.log('FAIL third click did not reopen the group'); fail++; }
      else console.log('ok    clicking again reopens it');

      // A variant only ever closes what it heads, so it cannot collapse the
      // group it is sitting in -- which would hide its own row.
      const variantRow = results.children.find((r) => /^Uranium-/.test(r.dataset.name || ''));
      const before = isotopeRows();
      variantRow.dispatch('click');                       // selects it
      variantRow.dispatch('click');                       // second click on the selected variant
      if (isotopeRows() !== before) {
        console.log(`FAIL clicking a variant collapsed its parent (${before} -> ${isotopeRows()})`); fail++;
      } else if (!detail.textContent.startsWith('Uranium-')) {
        console.log('FAIL clicking a variant did not select it'); fail++;
      } else console.log(`ok    a selected variant does not collapse its parent (${isotopeRows()} rows kept)`);
    }
  }
}
globalThis.location.hash = '';
app.reload();

// --- one row per substance, however the results are filtered ---------------
{
  // Water and +H2O are one substance only by way of Ice and Steam. A search
  // that excludes those must not split them back into two rows.
  app.setQuery('water');
  const shown = results.children.filter((r) => r.className === 'row')
    .map((r) => db.byName.get(r.dataset.name).display);
  const dupes = shown.filter((d, i) => shown.indexOf(d) !== i);
  if (dupes.length) { console.log(`FAIL duplicate rows: ${[...new Set(dupes)].join(', ')}`); fail++; }
  else console.log(`ok    "water" shows ${shown.length} rows, no two the same`);

  // The head is still re-picked from what survived the filter.
  app.setQuery('molten iron');
  const first = results.children.find((r) => r.className === 'row')?.dataset.name;
  if (first !== 'Molten Iron') { console.log(`FAIL "molten iron" heads with ${first}`); fail++; }
  else console.log('ok    a filtered group is headed by a survivor, not by its absent base');
}

// --- the game's art ---------------------------------------------------------
{
  const art = db.art;
  const uri = (v) => typeof v === 'string' && /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/.test(v);

  const states = Object.keys(art.swatches);
  if (!states.length || !states.every((k) => uri(art.swatches[k]))) {
    console.log(`FAIL swatch shapes missing or malformed: ${states.join(', ')}`); fail++;
  } else console.log(`ok    swatch shapes for ${states.join(', ')}`);

  const noTile = db.elements.filter((e) => !uri(art.tiles[e.sym]));
  if (noTile.length) {
    console.log(`FAIL ${noTile.length} elements have no tile, e.g. ${noTile[0].sym}`); fail++;
  } else console.log(`ok    all ${db.elements.length} elements have a tile`);
  if (art.patterns || art.symbols) {
    console.log('FAIL the pattern sheet and symbol glyphs should no longer be baked'); fail++;
  } else console.log('ok    no pattern sheet or unused glyphs carried');

  // Swatches in the list must carry the shape, not the old plain square.
  app.setQuery('water');
  const row = results.children.find((r) => r.className.startsWith('row'));
  const sw = [...row.walk()].find((n) => /swatch/.test(n.className));
  if (!/shaped/.test(sw?.className ?? '')) { console.log('FAIL row swatch is not shaped'); fail++; }
  else console.log('ok    list swatches use the game shape');

  // Periodic-table cells carry the tile image and the count bar.
  const grid = document.querySelector('#ptable-grid');
  const cell = grid.children[0];
  const kids = cell.children.map((c) => c.className);
  if (!kids.includes('ptile')) {
    console.log(`FAIL periodic cell holds ${kids.join(', ')}`); fail++;
  } else console.log('ok    periodic-table cells use the game tile');
}

// --- animated delegates actually animate, in both places -------------------
{
  const iconOf = (name, where) => {
    if (where === 'row') {
      app.setQuery(name);
      const row = results.children.find((r) => r.dataset.name === name);
      return row && row.children.find((c) => /swatch/.test(c.className));
    }
    app.select(db.byName.get(name));
    return [...detail.walk()].find((n) => /pattern-preview|swatch/.test(n.className));
  };

  for (const where of ['row', 'detail']) {
    const gem = iconOf('Ruby', where);          // twinkles
    const rock = iconOf('Granite', where);      // static pattern
    if (!gem || !rock) { bad(`could not find the ${where} icons`); continue; }

    if (!gem.style.animation) {
      bad(`${where}: an animated material has no animation`);
    } else if (rock.style.animation) {
      bad(`${where}: a static material should not animate`);
    } else {
      const secs = Number(/([\d.]+)s/.exec(gem.style.animation)?.[1]);
      const steps = Number(/steps\((\d+)/.exec(gem.style.animation)?.[1]);
      // jump-none is what keeps each frame on an exact icon boundary.
      const exact = /jump-none/.test(gem.style.animation);
      if (!(secs > 4 && secs < 7) || steps !== 12 || !exact) {
        bad(`${where}: animation is "${gem.style.animation}", want ~5.3s over 12 jump-none steps`);
      } else {
        console.log(`ok    ${where} icon animates: ${steps} frames over ${secs}s, on exact boundaries`);
      }
    }
  }

  // Both places must pull the same strip, so the cache serves one canvas each.
  const rowIcon = iconOf('Ruby', 'row');
  const detailIcon = iconOf('Ruby', 'detail');
  if (rowIcon.style.backgroundImage !== detailIcon.style.backgroundImage) {
    bad('the row icon and the detail tile use different strips');
  } else console.log('ok    both icons share one rendered strip');
}
app.setQuery('');

// --- category headings collapse, and persist like detail sections ----------
{
  globalThis.location.hash = '#s=name';
  app.reload();
  const heads = () => results.children.filter((r) => r.className === 'cat-head');
  const rows = () => results.children.filter((r) => r.className.startsWith('row'));
  const toggleOf = (h) => h.children[0];

  const first = heads()[0];
  if (!first || !/twisty/.test(toggleOf(first).children[0]?.className ?? '')) {
    console.log('FAIL category heading has no twisty'); fail++;
  } else {
    const label = first.textContent.replace(/\s+/g, ' ');
    const headsBefore = heads().length;
    toggleOf(first).dispatch('click');
    if (toggleOf(heads()[0]).getAttribute('aria-expanded') !== 'false') {
      console.log('FAIL category heading did not report itself collapsed'); fail++;
    }
    // Its rows go, and the freed budget reveals categories further down.
    if (heads().length <= headsBefore) {
      console.log('FAIL collapsing a category revealed no further categories'); fail++;
    } else console.log(`ok    collapsing "${label}" reveals ${heads().length - headsBefore} more categories`);

    if (!/[#&]c=/.test(globalThis.location.hash)) {
      console.log(`FAIL category collapse not written to the URL: ${globalThis.location.hash}`); fail++;
    } else {
      app.reload();
      if (toggleOf(heads()[0]).getAttribute('aria-expanded') !== 'false') {
        console.log('FAIL category re-expanded after reload'); fail++;
      } else console.log(`ok    survives a reload via ${globalThis.location.hash}`);
    }

    const rowsCollapsed = rows().length;
    toggleOf(heads()[0]).dispatch('click');
    if (toggleOf(heads()[0]).getAttribute('aria-expanded') !== 'true') {
      console.log('FAIL category did not re-expand'); fail++;
    } else console.log(`ok    re-expands (${rowsCollapsed} -> ${rows().length} rows)`);
  }

  // Category slots must not collide with the detail pane's section slots.
  const catSlots = COLLAPSIBLE.filter((k) => k.startsWith('cat:'));
  const unslotted = CATEGORIES.filter((c) => !catSlots.includes(`cat:${c.id}`));
  if (unslotted.length) {
    console.log(`FAIL categories with no collapse slot: ${unslotted.map((c) => c.id).join(', ')}`); fail++;
  } else if (new Set(COLLAPSIBLE).size !== COLLAPSIBLE.length) {
    console.log('FAIL slot collision after adding categories'); fail++;
  } else console.log(`ok    ${COLLAPSIBLE.length} slots total, ${catSlots.length} of them categories`);
}
globalThis.location.hash = '';
app.reload();

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
