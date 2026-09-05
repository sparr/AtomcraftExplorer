/**
 * The plan mode's pane: goals at the top, the steps as a table, and everything
 * still undecided down the side.
 *
 * This reads a solved plan and writes back a *specification* -- a target, a
 * pin, an exclusion -- never a graph. Every control edits the question and the
 * whole thing is solved again, which is why nothing here has to know how to
 * keep a rendered graph consistent with an edit.
 *
 * The table is the first of the plan's views and the plainest. It is also the
 * one that reads aloud, sorts, and copies into a note, so it stays whatever
 * else is drawn beside it later.
 */
import { search } from './search.js';
import { solvePlan, rstr, rcmp, R0 } from './plan-solve.js';
import { KIND, PROCESS_KINDS } from './plan-graph.js';
import { formatTemperature, formatTemperatureRange, formatTemperatureDelta } from './units.js';
import { emptyPlan, isEmptyPlan, addTarget, setTargetAmount, removeTarget, addHave,
         removeHave, pin, toggle, toggleKind, setOption } from './plan-state.js';

/** Everything the pane needs from the shell, handed over once at boot. */
let ctx = null;

/** The current question, and the answer last worked out from it. */
let plan = emptyPlan();
let solved = null;

const $ = (sel) => document.querySelector(sel);

export function getPlan() { return plan; }
export function planIsEmpty() { return isEmptyPlan(plan); }

/** Replace the plan wholesale -- from the URL, or from the explorer's buttons. */
export function setPlan(next, { save = true } = {}) {
  plan = next;
  render();
  if (save) ctx.onChange();
}

/** Edit it through one of `plan-state`'s helpers and re-solve. */
const edit = (fn, ...args) => setPlan(fn(plan, ...args));

/* ----------------------------------------------------------------- pieces */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function button(cls, label, title, onClick) {
  const b = el('button', cls, label);
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

/** A material, as a link into the explorer. */
function matLink(name) {
  const m = ctx.db.byName.get(name);
  const a = el('a', 'matlink' + (m ? '' : ' dangling'), m ? m.display : name);
  a.href = '#';
  a.title = m ? `Look up ${m.display}` : `${name} is named but never defined`;
  if (m) a.addEventListener('click', (e) => { e.preventDefault(); ctx.openInExplorer(m); });
  return a;
}

/** `3 Carbon + 1 Alumina`, with the counts the game writes. */
function side(parts) {
  const frag = document.createDocumentFragment();
  parts.forEach(({ name, count }, i) => {
    if (i) frag.append(' + ');
    if (count !== 1) frag.append(el('span', 'coef', `${count} `));
    frag.append(matLink(name));
  });
  return frag;
}

/** An amount, which is exact and may be a fraction. */
const amount = (r) => rstr(r);

/**
 * A material picker: type, and pick one of the matches.
 *
 * It runs the explorer's own query parser, so `el:Au`, `state:gas` and a plain
 * name all work here too and there is only one search grammar to learn.
 */
function picker({ placeholder, actions }) {
  const box = el('div', 'picker');
  const input = el('input', 'picker-input');
  input.type = 'search';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  const list = el('ul', 'picker-hits');
  box.append(input, list);

  // Kept rather than looked up again, so Enter works without a DOM query.
  let firstAction = null;
  const clear = () => { list.textContent = ''; firstAction = null; };
  const run = () => {
    clear();
    const q = input.value.trim();
    if (!q) return;
    for (const { m } of search(ctx.db, q).results.slice(0, 8)) {
      const li = el('li', 'picker-hit');
      const name = el('span', 'picker-name');
      name.append(ctx.swatch(m), el('span', 'picker-label', m.display));
      li.append(name);
      const acts = el('span', 'picker-acts');
      for (const [label, hint, run2] of actions) {
        const b = button('ghost small', label, hint, () => {
          input.value = '';
          clear();
          run2(m.name);
        });
        firstAction = firstAction || b;
        acts.append(b);
      }
      li.append(acts);
      list.append(li);
    }
  };
  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; clear(); }
    // Enter takes the first action on the first match, which is the one people
    // mean when they have typed a name in full and stopped.
    if (e.key === 'Enter' && firstAction) firstAction.click();
  });
  return box;
}

/* ------------------------------------------------------------------ goals */

function goalChip(cls, label, onRemove, extra) {
  const chip = el('span', `goal ${cls}`);
  if (extra) chip.append(extra);
  chip.append(label);
  chip.append(button('goal-x', '×', 'Remove', onRemove));
  return chip;
}

function renderGoals() {
  const box = $('#plan-goals');
  box.textContent = '';

  const wants = el('div', 'goal-row');
  wants.append(el('span', 'goal-head', 'Make'));
  for (const t of plan.targets) {
    const n = el('input', 'goal-amount');
    n.type = 'number';
    n.min = '1';
    n.value = String(t.amount);
    n.title = `How many ${t.name}`;
    n.addEventListener('change', () => edit(setTargetAmount, t.name, Number(n.value)));
    wants.append(goalChip('goal-target', '', () => edit(removeTarget, t.name),
                          (() => { const f = document.createDocumentFragment();
                                   f.append(n, matLink(t.name)); return f; })()));
  }
  if (!plan.targets.length) wants.append(el('span', 'muted', 'nothing yet'));
  box.append(wants);

  const haves = el('div', 'goal-row');
  haves.append(el('span', 'goal-head', 'Have'));
  for (const name of plan.have) {
    haves.append(goalChip('goal-have', '', () => edit(removeHave, name), matLink(name)));
  }
  if (!plan.have.length) haves.append(el('span', 'muted', 'nothing yet'));
  box.append(haves);
}

/* ------------------------------------------------------------------ steps */

/** The conditions a step runs under, as the game states them. */
function conditions(step) {
  const c = step.process.conditions;
  const w = step.window;
  const out = el('div', 'rx-cond');
  const bits = [];

  const band = formatTemperatureRange(w.lo || null, Number.isFinite(w.hi) ? w.hi : null);
  if (band) bits.push(band);
  if (c.changeInTemperature) bits.push(formatTemperatureDelta(c.changeInTemperature));
  if (c.electrolysis) bits.push('electrolysis');
  if (c.requiresSpark) bits.push('needs a spark');
  if (c.places) bits.push('you place it');
  if (c.medium) bits.push(`in ${c.medium}`);
  if (c.mode) bits.push(c.mode);
  for (const { name, count } of c.catalysts || []) {
    const span = el('span', 'rx-catalyst');
    span.append('needs ', count !== 1 ? `${count} ` : '', matLink(name));
    out.append(span);
  }
  if (bits.length) out.append(el('span', 'rx-bits', bits.join('  ·  ')));

  if (c.stochastic) {
    const odds = el('span', 'rx-odds');
    odds.title = 'One outcome per go, drawn at random. The amounts are what it averages.';
    odds.append(c.outcomes.map((o) => `${o.name} ${(o.chance * 100).toFixed(
      o.chance < 0.01 ? 2 : 0)}%`).join(' / '));
    out.append(odds);
  }
  for (const a of w.avoided) {
    out.append(el('span', 'rx-avoids', `avoids ${a.label}`));
  }
  for (const u of w.unavoidable) {
    const also = el('span', 'rx-also', `also runs ${u.label}`);
    if (solved.dag.processes.has(u.id)) {
      also.classList.add('wanted');
      also.title = 'Which this plan wants anyway, elsewhere';
    }
    out.append(also);
  }
  return out;
}

function renderSteps() {
  const box = $('#plan-steps');
  box.textContent = '';

  if (solved.unreachable.length) {
    const warn = el('div', 'plan-warn');
    warn.append('Nothing allowed can make ');
    solved.unreachable.forEach((n, i) => {
      if (i) warn.append(', ');
      warn.append(matLink(n));
    });
    warn.append('. Try switching on another kind of process under Options.');
    box.append(warn);
  }
  if (solved.cycles.length) {
    box.append(el('div', 'plan-warn',
      `A choice loops back on itself at ${solved.cycles.join(', ')}, so it was left open.`));
  }

  if (!solved.steps.length) {
    box.append(el('p', 'muted', isEmptyPlan(plan)
      ? 'Add something to make.'
      : 'Nothing to do yet — everything asked for is already in hand.'));
    return;
  }

  const head = el('div', 'plan-steps-head');
  head.append(el('h2', null, `${solved.steps.length} step${solved.steps.length === 1 ? '' : 's'}`));
  if (rcmp(solved.scale, R0) > 0 && solved.scale.n !== 1n) {
    head.append(el('span', 'muted', `scaled ×${rstr(solved.scale)} to come out whole`));
  }
  box.append(head);

  const table = el('table', 'plan-table');
  const tbody = el('tbody');
  for (const step of solved.steps) {
    const tr = el('tr', 'plan-step');
    const kind = KIND.get(step.process.kind);

    const runs = el('td', 'step-runs');
    runs.append(el('span', 'runs', `${amount(step.runs)}×`));
    tr.append(runs);

    const glyph = el('td', 'step-kind', kind?.glyph || '');
    glyph.title = kind?.label || step.process.kind;
    tr.append(glyph);

    const what = el('td', 'step-what');
    const eq = el('div', 'rx-eq');
    eq.append(side(step.process.inputs), el('span', 'arrow', '→'), side(step.process.outputs));
    what.append(eq);
    what.append(el('div', 'step-name', step.process.label));
    what.append(conditions(step));
    tr.append(what);

    const acts = el('td', 'step-acts');
    acts.append(button('ghost small', 'Not this', 'Keep this process out of the plan',
                       () => edit(toggle, 'excludeProcesses', step.process.id)));
    tr.append(acts);

    tbody.append(tr);
  }
  table.append(tbody);
  box.append(table);
}

/* ------------------------------------------------------------------- side */

/** Which processes could make this, so the reader can take a different one. */
function producerChoice(name) {
  const options = ctx.graph.producers(name).filter((p) => plan.kinds.includes(p.kind));
  if (!options.length) return null;
  const sel = el('select', 'route');
  const none = el('option', null, options.length === 1 ? 'make it' : `${options.length} ways to make it`);
  none.value = '';
  sel.append(none);
  for (const p of options) {
    const o = el('option', null, `${KIND.get(p.kind)?.glyph || ''} ${p.label}`);
    o.value = p.id;
    if (plan.pins[name] === p.id) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    // An empty choice still means "make it": pin the one the solver would pick.
    edit(pin, name, sel.value || solved.choice.get(name) || options[0].id);
  });
  return sel;
}

function renderSide() {
  const box = $('#plan-side');
  box.textContent = '';

  // --- what you still have to go and get ---------------------------------
  const front = el('section', 'plan-panel');
  front.append(el('h2', null, solved.frontier.length
    ? `${solved.frontier.length} to fetch` : 'Nothing left to fetch'));
  if (solved.frontier.length) {
    const ul = el('ul', 'plan-list');
    for (const f of solved.frontier) {
      const li = el('li', 'plan-item');
      const line = el('div', 'plan-item-main');
      line.append(el('span', 'amount', amount(f.amount)), ' ', matLink(f.name));
      li.append(line);
      // How the world hands this over, for the kinds this plan will not use.
      if (f.routes.length) {
        const how = el('div', 'plan-how');
        const kind = KIND.get(f.routes[0].kind);
        how.append(`${kind?.glyph || ''} ${f.routes[0].label}`);
        li.append(how);
      } else if (f.raw) {
        li.append(el('div', 'plan-how', 'found in the world'));
      }
      const acts = el('div', 'plan-item-acts');
      acts.append(button('ghost small', 'I have it', 'Stop planning for this one',
                         () => edit(addHave, f.name)));
      const route = producerChoice(f.name);
      if (route) acts.append(route);
      li.append(acts);
      ul.append(li);
    }
    front.append(ul);
  }
  box.append(front);

  // --- what it leaves lying around ---------------------------------------
  if (solved.byproducts.length) {
    const by = el('section', 'plan-panel');
    by.append(el('h2', null, `${solved.byproducts.length} left over`));
    const ul = el('ul', 'plan-list');
    for (const b of solved.byproducts) {
      const li = el('li', 'plan-item');
      const line = el('div', 'plan-item-main');
      line.append(el('span', 'amount', amount(b.amount)), ' ', matLink(b.name));
      li.append(line);
      const acts = el('div', 'plan-item-acts');
      acts.append(button('ghost small', 'I want it', 'Count it as something the plan is for',
                         () => edit(addTarget, b.name)));
      const feed = button('ghost small' + (b.credited ? ' on' : ''), 'Feed it back',
                          'Let this cover demand for the same material elsewhere',
                          () => edit(toggle, 'credit', b.name));
      feed.setAttribute('aria-pressed', String(!!b.credited));
      acts.append(feed);
      li.append(acts);
      ul.append(li);
    }
    by.append(ul);
    if (!solved.converged) {
      by.append(el('p', 'muted',
        'Feeding these back does not settle on a batch size, so the amounts are approximate.'));
    }
    box.append(by);
  }

  // --- what you have to build before any of it works ----------------------
  const a = solved.apparatus;
  const kit = [];
  if (a.hottestFloor) {
    kit.push({ always: 'A furnace reaching ', sometimes: 'Holding ',
               none: 'Working at ' }[a.heating] + formatTemperature(a.hottestFloor));
  }
  if (a.lowestCeiling) {
    kit.push({ always: 'Cooling below ', sometimes: 'A chamber kept under ',
               none: 'A chamber under ' }[a.cooling] + formatTemperature(a.lowestCeiling));
  }
  if (a.electrolysis) kit.push('Electrolysis');
  if (a.spark) kit.push('A spark');
  if (a.byHand) kit.push('Placing it yourself');
  for (const [name, count] of a.catalysts) kit.push(`${count > 1 ? count + ' ' : ''}${name}`);
  if (kit.length) {
    const app = el('section', 'plan-panel');
    app.append(el('h2', null, 'What it takes'));
    const ul = el('ul', 'plan-list');
    for (const line of kit) ul.append(el('li', 'plan-kit', line));
    app.append(ul);
    if (a.hottestFloor && a.lowestCeiling && a.hottestFloor > a.lowestCeiling) {
      app.append(el('p', 'muted',
        'The hottest and coldest of those are different steps, so they are different chambers.'));
    }
    box.append(app);
  }
}

/* ----------------------------------------------------------------- options */

/** Built once, then only ticked and unticked. Kept by hand rather than found
 *  again in the DOM, so this works against the render test's shim too. */
const kindBoxes = new Map();

function renderOptions() {
  const box = $('#plan-kinds');
  if (!kindBoxes.size) {
    for (const k of PROCESS_KINDS) {
      const label = el('label', 'plan-kind');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => edit(toggleKind, k.id));
      label.append(cb, el('span', 'kind-glyph', k.glyph), el('span', null, k.label));
      box.append(label);
      kindBoxes.set(k.id, cb);
    }
  }
  for (const [id, cb] of kindBoxes) cb.checked = plan.kinds.includes(id);
  $('#plan-avoid').checked = plan.avoidSideEffects;
}

/* ------------------------------------------------------------------ render */

export function render() {
  const empty = isEmptyPlan(plan);
  $('#plan-empty').hidden = !empty;
  $('#plan-work').hidden = empty;
  $('#toggle-plan-options').hidden = false;
  renderOptions();
  if (empty) { solved = null; return; }

  solved = solvePlan(ctx.graph, {
    targets: plan.targets,
    have: plan.have,
    pins: plan.pins,
    include: plan.include,
    runs: plan.runs,
    excludeProcesses: plan.excludeProcesses,
    excludeMaterials: plan.excludeMaterials,
    credit: plan.credit,
    kinds: plan.kinds,
    avoidSideEffects: plan.avoidSideEffects,
  });

  renderGoals();
  renderSteps();
  renderSide();
}

/** The solved plan, for the console and the tests. */
export const lastSolved = () => solved;

/* -------------------------------------------------------------------- boot */

export function initPlan(context) {
  ctx = context;

  $('#plan-want').append(picker({
    placeholder: 'A material to make',
    actions: [['Make it', 'Plan a way to produce this', (n) => edit(addTarget, n)]],
  }));
  $('#plan-got').append(picker({
    placeholder: 'A material you have',
    actions: [['I have it', 'Treat this as available', (n) => edit(addHave, n)]],
  }));
  $('#plan-bar').append(picker({
    placeholder: 'Add a material',
    actions: [['Make', 'Add as something to produce', (n) => edit(addTarget, n)],
              ['Have', 'Add as something available', (n) => edit(addHave, n)]],
  }));

  $('#plan-avoid').addEventListener('change', (e) =>
    edit(setOption, 'avoidSideEffects', e.target.checked));
  $('#toggle-plan-options').addEventListener('click', () => {
    const open = $('#plan-options').hidden;
    $('#plan-options').hidden = !open;
    $('#toggle-plan-options').setAttribute('aria-pressed', String(open));
  });
}
