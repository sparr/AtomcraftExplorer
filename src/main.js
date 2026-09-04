/** Search UI: query box, element filter, result list, material detail. */
import { loadData, REFERENCE_ORDER, referencePhrase } from './data.js';
import { collapseKey, packCollapsed, unpackCollapsed } from './collapse.js';
import { buildGroups, filterGroups, CATEGORIES } from './grouping.js';
import { search, parseQuery, FIELDS, TERM_RE } from './search.js';
import { formulaHtml } from './formula.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let db = null;
let hits = [];
let selected = null;

/* ------------------------------------------------------------------ query */

const state = { q: '', sel: null, sort: 'relevance' };

/** Groups whose variants are shown. Grouping hides 794 variant rows by default. */
const expanded = new Set();

/** Materials in rendered order, for keyboard navigation. */
let visible = [];

/** Material name -> the group it is rendered in, rebuilt on every render. */
let groupIndex = new Map();

/** Reference groups whose variants are shown, keyed relationship + group. */
const expandedRefs = new Set();

/** Sections the reader has collapsed. Mirrored into the URL. */
const collapsed = new Set();

// Set while we rewrite location.hash ourselves, so the resulting hashchange
// does not bounce back through readHash and re-render everything.
let selfHashWrite = false;

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.q = p.get('q') || '';
  state.sel = p.get('m') || null;
  state.sort = ['name', 'z'].includes(p.get('s')) ? p.get('s') : 'relevance';
  collapsed.clear();
  for (const key of unpackCollapsed(p.get('c'))) collapsed.add(key);
}

function writeHash({ replace = false } = {}) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.sel) p.set('m', state.sel);
  if (state.sort !== 'relevance') p.set('s', state.sort);
  const packed = packCollapsed(collapsed);
  if (packed) p.set('c', packed);
  const hash = p.toString() ? '#' + p.toString() : ' ';
  try {
    if (replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
  } catch {
    // Some browsers refuse history manipulation on a file:// document. Writing
    // the fragment directly always works; suppress the hashchange it causes.
    if (location.hash !== hash) {
      selfHashWrite = true;
      location.hash = hash;
    }
  }
}

function setQuery(q, { fromInput = false } = {}) {
  state.q = q;
  if (!fromInput) $('#q').value = q;
  $('#clear').hidden = !q;
  runSearch();
  renderChips();
  renderPeriodicTable();
  writeHash({ replace: true });
}

/** Add or remove a `field:value` term, keeping the query the source of truth. */
function toggleTerm(field, value) {
  const term = `${field}:${value}`;
  const terms = state.q.split(/\s+/).filter(Boolean);
  const i = terms.indexOf(term);
  if (i >= 0) terms.splice(i, 1);
  else terms.push(term);
  setQuery(terms.join(' '));
}

function removeTermAt(idx) {
  const terms = state.q.match(TERM_RE) || [];
  terms.splice(idx, 1);
  setQuery(terms.join(' '));
}

/* ---------------------------------------------------------------- helpers */

function swatch(m) {
  const s = el('span', 'swatch');
  // The game draws a material as a shape chosen by state -- a filled square, a
  // droplet, a puff -- tinted with its colour. Static and Plasma have no shape
  // of their own and fall back to the solid square.
  const shape = db.art.swatches[m.state] ?? db.art.swatches.Solid;
  if (shape) {
    s.classList.add('shaped');
    s.style.setProperty('--shape', `url("${shape}")`);
  }
  if (m.color) s.style.background = m.color;
  else s.dataset.none = '';
  return s;
}

function stateBadge(m) {
  const b = el('span', `badge ${m.state.toLowerCase()}`, m.state);
  return b;
}

function formulaSpan(m) {
  const s = el('span', 'formula');
  s.innerHTML = formulaHtml(m.formula);
  return s;
}

/** A cross-reference to another material -- a link if it exists, dead text if not. */
function matLink(name) {
  if (!name) return el('span', 'faint', 'nothing');
  const target = db.byName.get(name);
  if (!target) {
    const s = el('span', 'mat-missing', name);
    s.title = 'Referenced by the game data but no such material is defined';
    return s;
  }
  const a = el('a', 'mat', target.display);
  a.href = '#';
  a.addEventListener('click', (e) => { e.preventDefault(); select(target, { push: true }); });
  if (target.display !== target.name) a.title = target.name;
  return a;
}

/* ---------------------------------------------------------------- results */

function runSearch() {
  const t0 = performance.now();
  // Results are always grouped, so the cap belongs on groups, not materials --
  // capping materials first would show only a slice of the catalogue.
  const r = search(db, state.q, { limit: Infinity });
  hits = r.results;
  const ms = performance.now() - t0;

  const list = $('#results');
  list.textContent = '';

  visible = [];
  let groupCount = 0;
  if (!hits.length) {
    list.append(el('li', 'empty', state.q ? 'No materials match this query.' : 'No materials.'));
  } else {
    const built = groupedResults(hits.map((h) => h.m));
    groupCount = built.groupCount;
    list.append(built.frag);
  }

  renderSortControl();
  const parts = [`${r.total.toLocaleString()} of ${db.materials.length.toLocaleString()} materials`];
  if (groupCount) {
    parts.push(`${groupCount.toLocaleString()} group${groupCount === 1 ? '' : 's'}`);
    if (groupCount > GROUP_LIMIT) parts.push(`showing first ${GROUP_LIMIT}`);
  } else if (visible.length < r.total) {
    parts.push(`showing first ${visible.length}`);
  }
  $('#summary-counts').innerHTML =
    `<span>${parts.join(' &middot; ')}</span> <span class="faint">${ms.toFixed(1)} ms</span>`;

  if (selected) markSelected();
}

const GROUP_LIMIT = 400;

/** Grouped view: a heading per category, one row per group, variants on demand. */
// Grouping the whole catalogue does not depend on the query, so it is done once
// per sort order and reused for every keystroke.
const allGroups = new Map();
function groupsFor(sortBy) {
  if (!allGroups.has(sortBy)) allGroups.set(sortBy, buildGroups(db.materials, db, { sortBy }));
  return allGroups.get(sortBy);
}

function groupedResults(materials) {
  const frag = document.createDocumentFragment();
  const groups = filterGroups(groupsFor(state.sort), materials, { sortBy: state.sort });
  // Relevance interleaves categories by score, so headings would be meaningless.
  const headings = state.sort !== 'relevance';
  let lastCategory = null;

  groupIndex = new Map();
  for (const g of groups) for (const m of g.members) groupIndex.set(m.name, g);

  const perCategory = new Map();
  for (const g of groups) perCategory.set(g.category, (perCategory.get(g.category) || 0) + 1);

  let emitted = 0;
  for (const g of groups) {
    if (headings && g.category !== lastCategory) {
      lastCategory = g.category;
      frag.append(categoryHead(g.category, g.label, perCategory.get(g.category)));
    }
    // A collapsed category shows its heading and nothing else -- and spends
    // none of the row budget, so collapsing one reveals the categories below it.
    if (headings && collapsed.has(`cat:${g.category}`)) continue;
    if (emitted >= GROUP_LIMIT) break;
    emitted++;

    frag.append(resultRow({ m: g.head, why: [] }, { group: g }));
    visible.push(g.head);

    if (expanded.has(g.key)) {
      for (const m of g.members) {
        if (m === g.head) continue;
        frag.append(resultRow({ m, why: [] }, { variant: true }));
        visible.push(m);
      }
    }
  }
  return { frag, groupCount: groups.length };
}

/** A collapsible category heading in the result list. */
function categoryHead(id, label, count) {
  const key = `cat:${id}`;
  const li = el('li', 'cat-head');
  const btn = el('button', 'cat-toggle');
  btn.setAttribute('aria-expanded', String(!collapsed.has(key)));
  const twisty = el('span', 'twisty');
  twisty.setAttribute('aria-hidden', 'true');
  btn.append(twisty, el('span', null, `${label} (${count})`));
  btn.addEventListener('click', () => {
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    writeHash({ replace: true });
    runSearch();
  });
  li.append(btn);
  return li;
}

const SORT_MODES = [
  ['relevance', 'Relevance'],
  ['name', 'Name'],
  ['z', 'Atomic number'],
];

function renderSortControl() {
  const host = $('#sort');
  if (host.children.length) {
    for (const b of host.children) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === state.sort));
    }
    return;
  }
  host.append(el('span', 'faint', 'sort'));
  for (const [mode, label] of SORT_MODES) {
    const b = el('button', 'sortbtn', label);
    b.dataset.mode = mode;
    b.setAttribute('aria-pressed', String(mode === state.sort));
    b.addEventListener('click', () => {
      state.sort = mode;
      writeHash({ replace: true });
      runSearch();
    });
    host.append(b);
  }
}

function toggleGroup(key) {
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  runSearch();
}

function resultRow(hit, { group = null, variant = false } = {}) {
  const m = hit.m;
  const li = el('li', variant ? 'row variant' : 'row');
  li.dataset.name = m.name;
  li.setAttribute('role', 'option');

  // Expander column, kept even when empty so every row lines up.
  const lead = el('span', 'row-lead');
  const hidden = group ? group.members.length - 1 : 0;
  if (hidden > 0) {
    const t = el('button', 'row-twisty twisty');
    t.setAttribute('aria-expanded', String(expanded.has(group.key)));
    t.setAttribute('aria-label', `${hidden} more in this group`);
    t.title = `${hidden} more: ` +
              group.members.filter((x) => x !== group.head).map((x) => x.display)
                   .slice(0, 8).join(', ');
    t.addEventListener('click', (e) => { e.stopPropagation(); toggleGroup(group.key); });
    lead.append(t);
  }

  const main = el('div', 'row-main');
  const title = el('div', 'row-title');
  title.append(el('span', 'name', m.display));
  if (m.name !== m.display) title.append(el('span', 'alias', m.name));
  main.append(title);

  const sub = el('div', 'row-sub');
  if (m.formula) sub.append(formulaSpan(m));
  if (m.description) sub.append(el('span', 'desc', m.description));
  else if (hit.why.length) sub.append(el('span', 'faint', 'matched ' + hit.why.join(', ')));
  if (sub.childNodes.length) main.append(sub);

  const right = el('div', 'row-right');
  right.append(stateBadge(m));
  if (m.hidden) right.append(el('span', 'badge hidden', 'hidden'));

  li.append(lead, swatch(m), main, right);
  li.addEventListener('click', () => {
    // First click selects and opens the group; clicking the selected row again
    // works the twisty of the group this row *heads*, so one row does both jobs.
    // Keying on what the row heads rather than what it belongs to means a
    // variant cannot collapse its parent out from under itself -- and if
    // sub-groups are ever nested here, a variant will close its own children
    // with no change to this rule.
    if (selected === m) {
      const g = groupIndex.get(m.name);
      if (g && g.head === m && g.members.length > 1) toggleGroup(g.key);
    } else {
      select(m, { push: true });
    }
  });
  return li;
}

function markSelected() {
  for (const row of $('#results').children) {
    row.setAttribute('aria-selected', row.dataset.name === selected?.name ? 'true' : 'false');
  }
}

/* ----------------------------------------------------------------- detail */

const NUMERIC_FIELDS = [
  ['Density', 'Density'], ['Hardness', 'Hardness'], ['Weight', 'Weight'],
  ['Friction', 'Friction'], ['Viscosity', 'Viscosity'], ['Bounciness', 'Bounciness'],
  ['ActorFriction', 'Actor friction'],
  ['DefaultTemperature', 'Default temperature', 'K'],
  ['ThermalConductivity', 'Thermal conductivity'],
  ['ConductanceDivisor', 'Conductance divisor'],
  ['HealthChange', 'Health change'], ['AcidDamage', 'Acid damage'],
  ['ToxicityLevel', 'Toxicity'], ['ExplosionRadius', 'Explosion radius'],
  ['LightRange', 'Light range'], ['Alpha', 'Alpha'],
];

const FLAG_FIELDS = [
  ['IsInteractable', 'interactable'], ['IsBurning', 'burning'],
  ['IsUnstable', 'unstable'], ['IsMechanical', 'mechanical'],
  ['IsBuilt', 'built'], ['IsForeground', 'foreground'],
  ['IsCarryingSignal', 'carries signal'], ['IsFoodIngredient', 'food ingredient'],
  ['CanBeCutByPlasma', 'cuttable by plasma'], ['CanPickUpStatic', 'pick up static'],
  ['DoNotBlockLaser', 'does not block laser'], ['IgnoreFogOfWar', 'ignores fog of war'],
  ['IsOn', 'on'], ['SuppressInGuide', 'hidden from guide'],
];

const TRANSITION_FIELDS = [
  ['MinesInto', 'Mines into'], ['PickUpInto', 'Picks up into'],
  ['BuildsInto', 'Builds into'], ['GrowsInto', 'Grows into'],
  ['DissolvesInto', 'Dissolves into'],
  ['TurnsOnInto', 'Turns on into'], ['TurnsOffInto', 'Turns off into'],
  ['RotatesRightInto', 'Rotates right into'], ['RotatesLeftInto', 'Rotates left into'],
  ['TurnsIntoFromAlphaParticleImpact', 'Alpha impact'],
  ['TurnsIntoFromProtonImpact', 'Proton impact'],
  ['TurnsIntoFromNeutronImpact', 'Neutron impact'],
  ['ProgrammableDelegate', 'Programmable delegate'],
];

function kv(rows) {
  const dl = el('dl', 'kv');
  for (const [k, v] of rows) {
    if (v === null || v === undefined || v === '') continue;
    dl.append(el('dt', null, k));
    const dd = el('dd');
    if (v instanceof Node) dd.append(v);
    else dd.textContent = v;
    dl.append(dd);
  }
  return dl.children.length ? dl : null;
}

/** Append only real nodes -- append(null) would render the text "null". */
function mount(parent, ...nodes) {
  for (const n of nodes) if (n) parent.append(n);
}

/**
 * A <details> disclosure -- native keyboard handling and toggle behaviour, with
 * the twisty drawn on the left of the heading.
 */
function disclosure(cls, headingTag, spec, nodes) {
  const kept = nodes.filter(Boolean);
  if (!kept.length) return null;

  // A heading that does not end in "(12)" needs its slot named explicitly.
  const { title, key: slot } = typeof spec === 'string' ? { title: spec, key: spec } : spec;
  const key = collapseKey(cls, slot);
  const wantOpen = !collapsed.has(key);
  const d = el('details', cls);
  d.dataset.slot = key;          // the collapse slot, not the visible wording
  d.open = wantOpen;

  const summary = el('summary');
  const twisty = el('span', 'twisty');
  twisty.setAttribute('aria-hidden', 'true');
  summary.append(twisty, el(headingTag, null, title));
  d.append(summary);

  const body = el('div', 'disclosure-body');
  mount(body, ...kept);
  d.append(body);

  d.addEventListener('toggle', () => {
    // Setting .open while building also queues a toggle event; ignore that one.
    if (!d.open === collapsed.has(key)) return;
    if (d.open) collapsed.delete(key);
    else collapsed.add(key);
    writeHash({ replace: true });
  });
  return d;
}

function section(spec, ...nodes) {
  return disclosure('sec', 'h3', spec, nodes);
}

function subsection(spec, ...nodes) {
  return disclosure('subsec', 'h4', spec, nodes);
}

function phaseLine(t, verb) {
  const span = el('span');
  // A handful of materials evaporate into nothing at all.
  span.append(`${verb} `, matLink(t.TargetMaterialName));
  span.append(` at ${t.Temperature || 0} K`);
  if (t.Amount > 1) span.append(` ×${t.Amount}`);
  if (t.Probability) span.append(` (p=${t.Probability})`);
  return span;
}

function reactionCard(rx, role, self) {
  const card = el('div', `rx is-${role}`);
  card.append(el('div', 'rx-name', rx.name));

  const eq = el('div', 'rx-eq');
  const side = (pairs) => {
    const frag = document.createDocumentFragment();
    pairs.forEach(([name, n], i) => {
      if (i) frag.append(' + ');
      const count = n ?? 0;
      if (count !== 1) frag.append(el('span', 'coef', `${count} `));
      const link = matLink(name);
      if (name === self) link.classList.add('rx-self');
      frag.append(link);
    });
    return frag;
  };
  eq.append(side(rx.inputs));
  eq.append(el('span', 'arrow', '→'));
  eq.append(side(rx.outputs));
  card.append(eq);

  const cond = [];
  if (rx.catalysts.length) {
    cond.push('catalyst: ' + rx.catalysts.map(([n, c]) => (c !== 1 ? `${c} ` : '') + n).join(', '));
  }
  const t = rx.raw.Temperature, tmax = rx.raw.MaxTemperature;
  if (t && tmax) cond.push(`${t}–${tmax} K`);
  else if (t) cond.push(`≥ ${t} K`);
  else if (tmax) cond.push(`≤ ${tmax} K`);
  if (rx.raw.ChangeInTemperature) {
    const d = rx.raw.ChangeInTemperature;
    cond.push(`${d > 0 ? '+' : ''}${d} K`);
  }
  if (rx.raw.Electrolysis) cond.push('electrolysis');
  if (rx.raw.Probability) cond.push(`p=${rx.raw.Probability}`);
  if (cond.length) card.append(el('div', 'rx-cond', cond.join('  ·  ')));
  return card;
}

/** One entry in a reference list: the group head, expandable to its variants. */
function refEntry(label, group) {
  const key = `${label}\u241f${group.key}`;
  const hidden = group.members.filter((m) => m !== group.head);
  const wrap = el('span', 'refentry');
  wrap.append(matLink(group.head.name));
  if (!hidden.length) return wrap;

  const open = expandedRefs.has(key);
  const t = el('button', 'ref-twisty twisty');
  t.setAttribute('aria-expanded', String(open));
  t.setAttribute('aria-label', `${hidden.length} more like ${group.head.display}`);
  t.title = hidden.map((m) => m.display).slice(0, 8).join(', ');
  t.addEventListener('click', () => {
    if (open) expandedRefs.delete(key);
    else expandedRefs.add(key);
    renderDetail(selected);
  });
  wrap.append(t);
  if (!open) wrap.append(el('span', 'label', `+${hidden.length}`));
  else for (const m of hidden) { wrap.append(el('span', 'label', ',')); wrap.append(matLink(m.name)); }
  return wrap;
}

function renderDetail(m) {
  const pane = $('#detail');
  pane.textContent = '';
  if (!m) {
    pane.append(el('div', 'detail-empty', 'Select a material to see its properties, reactions and links.'));
    return;
  }
  const r = m.raw;

  const head = el('div', 'detail-head');
  const h1 = el('h1');
  h1.append(swatch(m), document.createTextNode(m.display));
  head.append(h1);

  const sub = el('div', 'subline');
  if (m.formula) sub.append(formulaSpan(m));
  sub.append(stateBadge(m));
  if (m.name !== m.display) sub.append(el('span', 'mono faint', m.name));
  sub.append(el('span', 'mono faint', r.LocIdName));
  head.append(sub);
  pane.append(head);

  if (m.description) pane.append(el('div', 'detail-desc', m.description));

  // --- composition -------------------------------------------------------
  const compRows = [];
  if (m.formula) {
    const parts = [...m.formula.counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const box = el('div', 'flags');
    for (const [sym, n] of parts) {
      const e = db.elementBySymbol.get(sym);
      const chip = el('button', 'flag', n === 1 ? sym : `${sym}×${n}`);
      chip.title = (e ? `${e.name} (Z=${e.z})` : sym) +
                   (m.formula.alternates.has(sym) ? ' — alternative site' : '');
      if (m.formula.alternates.has(sym)) chip.style.borderStyle = 'dashed';
      chip.addEventListener('click', () => toggleTerm('el', sym));
      box.append(chip);
    }
    compRows.push(box);
  }
  if (r.Composition?.Elements) {
    const box = el('div', 'reflist');
    r.Composition.Elements.forEach((e, i) => {
      if (i) box.append(el('span', 'label', '+'));
      const w = el('span');
      if ((e.Item2 ?? 0) !== 1) w.append(el('span', 'coef', `${e.Item2 ?? 0} `));
      w.append(matLink(e.Item1));
      box.append(w);
    });
    compRows.push(subsection('Constituent materials', box));
  }
  mount(pane, section('Composition', ...compRows));

  // --- nuclear -----------------------------------------------------------
  const decay = r.DecaySettings;
  const nuclear = [];
  if (r.ProtonNumber) {
    nuclear.push(['Protons (Z)', String(r.ProtonNumber)]);
    nuclear.push(['Neutrons (N)', String(r.NeutronNumber || 0)]);
    nuclear.push(['Mass number (A)', String(r.ProtonNumber + (r.NeutronNumber || 0))]);
  }
  if (decay) {
    const mode = decay.Mode ?? 0;
    nuclear.push(['Decay mode', db.enums.DecayMode[String(mode)] || `mode ${mode}`]);
    if (decay.MaterialName) {
      const w = el('span');
      w.append(matLink(decay.MaterialName));
      if (decay.MaterialName2) { w.append(' + '); w.append(matLink(decay.MaterialName2)); }
      nuclear.push(['Decays into', w]);
    }
    if (decay.TickModValue) nuclear.push(['Decay interval', `${decay.TickModValue.toLocaleString()} ticks`]);
  }
  for (const [f, label] of TRANSITION_FIELDS.slice(9, 12)) {
    if (r[f]) nuclear.push([label, matLink(r[f])]);
  }
  mount(pane, section('Nuclear', kv(nuclear)));

  // --- thermal -----------------------------------------------------------
  const thermal = [];
  if (r.Condensation) thermal.push(['Condensation', phaseLine(r.Condensation, 'to')]);
  if (r.Evaporation) thermal.push(['Evaporation', phaseLine(r.Evaporation, 'to')]);
  if (r.Ignition) {
    // Temperature 0 is no threshold at all rather than a cryogenic one, so say
    // what actually sets it off instead of printing "at 0 K".
    const t = r.Ignition.Temperature || 0;
    const spark = r.Ignition.RequiresSpark;
    const w = el('span');
    w.append('to ', matLink(r.Ignition.TargetMaterialName));
    if (t && spark) w.append(` at ${t} K, with a spark`);
    else if (t) w.append(` at ${t} K`);
    else if (spark) w.append(' on a spark, at any temperature');
    else w.append(' at any temperature');
    if (r.Ignition.Explodes) w.append(' (explodes)');
    thermal.push(['Ignition', w]);
  }
  if (r.Fire) {
    const w = el('span');
    w.append('extinguishes to ', matLink(r.Fire.ExtinguishTargetMaterialName));
    thermal.push(['Fire', w]);
    if (r.Fire.CombustionTargetMaterialNames?.length) {
      const c = el('span');
      r.Fire.CombustionTargetMaterialNames.forEach((n, i) => {
        if (i) c.append(' + ');
        c.append(matLink(n));
      });
      thermal.push(['Combusts into', c]);
    }
    if (r.Fire.HeatOutput) thermal.push(['Heat output', String(r.Fire.HeatOutput)]);
    if (r.Fire.PercentChanceToSpread) thermal.push(['Spread chance', `${r.Fire.PercentChanceToSpread}%`]);
  }
  mount(pane, section('Thermal & fire', kv(thermal)));

  // --- reactions ---------------------------------------------------------
  const rx = db.reactionsByMaterial.get(m.name);
  if (rx) {
    for (const [role, label] of [['inputs', 'Consumed by'], ['outputs', 'Produced by'],
                                 ['catalysts', 'Catalyses']]) {
      if (!rx[role].length) continue;
      const list = el('div', 'rxlist');
      const roleClass = role === 'inputs' ? 'input' : role === 'outputs' ? 'output' : 'catalyst';
      for (const reaction of rx[role]) list.append(reactionCard(reaction, roleClass, m.name));
      mount(pane, section(`${label} (${rx[role].length})`, list));
    }
  }

  // --- transitions -------------------------------------------------------
  const trans = [];
  for (const [f, label] of TRANSITION_FIELDS) {
    if (f.startsWith('TurnsIntoFrom')) continue;   // shown under Nuclear
    if (r[f]) trans.push([label, matLink(r[f])]);
  }
  if (r.GrowthRules) {
    for (const g of r.GrowthRules) {
      const w = el('span');
      w.append(matLink(g.GrowthMaterialName),
               ` ${db.enums.Direction[g.Direction ?? 0]}, rate ${g.GrowthRate ?? 0}`);
      trans.push(['Grows', w]);
    }
  }
  if (r.DropRates) {
    const box = el('div', 'reflist');
    for (const [name, rate] of Object.entries(r.DropRates)) {
      const w = el('span');
      w.append(matLink(name), el('span', 'label', ` ${rate ?? 0}`));
      box.append(w);
    }
    mount(pane, section('Transitions', kv(trans), subsection('Drops', box)));
  } else {
    mount(pane, section('Transitions', kv(trans)));
  }

  // --- physical ----------------------------------------------------------
  const nums = NUMERIC_FIELDS
    .filter(([f]) => r[f] !== undefined && r[f] !== null)
    .map(([f, label, unit]) => [label, `${r[f]}${unit ? ' ' + unit : ''}`]);
  if (r.Direction) nums.push(['Direction', db.enums.Direction[r.Direction] || r.Direction]);
  if (r.RequiredSupportDirection) {
    nums.push(['Needs support', db.enums.Direction[r.RequiredSupportDirection]]);
  }
  if (r.WireIndex !== undefined) nums.push(['Wire index', String(r.WireIndex)]);
  if (r.ColorDelegate) nums.push(['Colour delegate', r.ColorDelegate]);
  const flags = FLAG_FIELDS.filter(([f]) => r[f]);
  const flagBox = flags.length ? el('div', 'flags') : null;
  if (flagBox) for (const [, label] of flags) flagBox.append(el('span', 'flag', label));
  mount(pane, section('Physical', kv(nums), flagBox));

  // --- referenced by -----------------------------------------------------
  const refs = db.referencedBy.get(m.name);
  if (refs?.length) {
    // Group by relationship so the label is written once per group rather than
    // once per entry -- Oxygen is "made of" 337 times.
    const seen = new Set();
    const groups = new Map();
    let total = 0;
    for (const { source, label } of refs) {
      const dedupe = `${source.name}|${label}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(source);
      total++;
    }
    const rank = (label) => {
      const i = REFERENCE_ORDER.indexOf(label);
      return i < 0 ? REFERENCE_ORDER.length : i;
    };
    const subs = [...groups]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
      .map(([label, sources]) => {
        const box = el('div', 'reflist');
        // Group the referencing materials too: Carbon's 129 "made of" entries
        // are largely molten and gas variants of the same few compounds.
        for (const rg of buildGroups(sources, db, { sortBy: 'name' })) {
          box.append(refEntry(label, rg));
        }
        // The count is the material count, matching the section header; the
        // +n expanders account for the difference between that and the rows.
        return subsection({ title: referencePhrase(label, sources.length), key: label }, box);
      });
    mount(pane, section(`Referenced by (${total})`, ...subs));
  }

  pane.scrollTop = 0;
}

function select(m, { push = false } = {}) {
  selected = m;
  state.sel = m ? m.name : null;
  // Selecting a row reveals what is filed under it.
  const group = m && groupIndex.get(m.name);
  if (group && group.members.length > 1 && !expanded.has(group.key)) {
    expanded.add(group.key);
    runSearch();
  }
  renderDetail(m);
  markSelected();
  if (push) writeHash({ replace: true });
  const row = $(`#results .row[data-name="${CSS.escape(m?.name || '')}"]`);
  if (row) row.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------------ chips */

function renderChips() {
  const box = $('#chips');
  box.textContent = '';
  const raw = state.q.match(TERM_RE) || [];
  const parsed = parseQuery(state.q);
  if (parsed.length < 2 && !parsed.some((t) => t.kind === 'field')) return;

  raw.forEach((text, i) => {
    const t = parsed[i];
    if (!t) return;
    const chip = el('span', 'chip' + (t.negate ? ' negated' : ''));
    if (t.kind === 'field') {
      chip.append(el('b', null, t.field + ':'), document.createTextNode(t.value));
    } else {
      chip.append(document.createTextNode(t.value));
    }
    const x = el('button', null, '×');
    x.title = 'Remove';
    x.addEventListener('click', () => removeTermAt(i));
    chip.append(x);
    box.append(chip);
  });
}

/* --------------------------------------------------------- periodic table */

function renderPeriodicTable() {
  const grid = $('#ptable-grid');
  const active = new Set(parseQuery(state.q)
    .filter((t) => t.kind === 'field' && (t.field === 'el' || t.field === 'element') && !t.negate)
    .map((t) => t.value));

  if (!grid.children.length) {
    for (const e of db.elements) {
      const cell = el('button', 'pcell');
      cell.style.setProperty('--row', e.row);
      cell.style.setProperty('--col', e.col);
      // The material count lives in the tooltip; the tile carries the colour.
      cell.title = `${e.name} — Z=${e.z} — ${e.count} material${e.count === 1 ? '' : 's'}`;
      cell.dataset.sym = e.sym;

      // The game's own 16x16 tile carries the symbol and the family colour.
      const tile = db.art.tiles[e.sym];
      if (tile) {
        const img = el('img', 'ptile');
        img.src = tile;
        img.alt = e.sym;
        cell.append(img);
      } else {
        cell.append(el('span', 'psym', e.sym));
      }
      if (!e.count) cell.dataset.empty = '';
      else cell.addEventListener('click', () => toggleTerm('el', e.sym));
      grid.append(cell);
    }
  }
  for (const cell of grid.children) {
    cell.setAttribute('aria-pressed', active.has(cell.dataset.sym) ? 'true' : 'false');
  }
}

/* -------------------------------------------------------------- keyboard */

function moveSelection(delta) {
  if (!visible.length) return;
  const i = visible.indexOf(selected);
  const next = Math.min(visible.length - 1, Math.max(0, (i < 0 ? -1 : i) + delta));
  select(visible[next], { push: true });
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = e.target.tagName === 'INPUT';
    if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
    if (e.key === 'Escape') {
      if (typing && $('#q').value) setQuery('');
      else $('#q').blur();
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'j' && !typing)) { e.preventDefault(); moveSelection(1); }
    if (e.key === 'ArrowUp' || (e.key === 'k' && !typing)) { e.preventDefault(); moveSelection(-1); }
  });
}

/* ------------------------------------------------------------------- boot */

function renderHelp() {
  const dl = $('#help-fields');
  const seen = new Set();
  for (const [field, desc] of Object.entries(FIELDS)) {
    if (seen.has(desc)) continue;
    seen.add(desc);
    const aliases = Object.entries(FIELDS).filter(([, d]) => d === desc).map(([f]) => f + ':');
    dl.append(el('dt', null, aliases.join(' ')), el('dd', null, desc));
  }
}

function bindChrome() {
  $('#q').addEventListener('input', (e) => setQuery(e.target.value, { fromInput: true }));
  $('#clear').addEventListener('click', () => { setQuery(''); $('#q').focus(); });
  for (const [btn, panel] of [['#toggle-table', '#ptable'], ['#toggle-help', '#help']]) {
    $(btn).addEventListener('click', () => {
      const open = $(panel).hidden;
      $(panel).hidden = !open;
      $(btn).setAttribute('aria-pressed', String(open));
    });
  }
  window.addEventListener('hashchange', () => {
    if (selfHashWrite) { selfHashWrite = false; return; }
    readHash();
    $('#q').value = state.q;
    $('#clear').hidden = !state.q;
    runSearch();
    renderChips();
    renderPeriodicTable();
    select(state.sel ? db.byName.get(state.sel) : null);
  });
}

(async function boot() {
  try {
    db = await loadData();
    // Exposed for the console and for tools/test_render.mjs.
    window.explorer = {
      db, select, setQuery, renderDetail, runSearch,
      // What a page load does: re-read the fragment and rebuild from it.
      reload: () => {
        readHash();
        $('#q').value = state.q;
        runSearch();
        renderChips();
        renderPeriodicTable();
        select(state.sel ? db.byName.get(state.sel) : null);
      },
    };
    window.db = db;
    readHash();
    renderHelp();
    bindChrome();
    bindKeys();
    $('#q').value = state.q;
    $('#clear').hidden = !state.q;
    runSearch();
    renderChips();
    renderPeriodicTable();
    select(state.sel ? db.byName.get(state.sel) : null);
    $('#boot').remove();
  } catch (err) {
    const boot = $('#boot');
    boot.className = 'boot error';
    boot.textContent = `Failed to load data.\n\n${err.message}\n\n` +
      'Run: npm run build-data\nThen serve over HTTP (npm run serve), or open atomcraft-explorer.html.';
    console.error(err);
  }
})();
