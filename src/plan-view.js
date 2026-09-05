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
import { solvePlan, routesFor, usesFor, rstr, rcmp, R0 } from './plan-solve.js';
import { KIND, PROCESS_KINDS } from './plan-graph.js';
import { AMBIENT, formatTemperature, formatTemperatureRange,
         formatTemperatureDelta } from './units.js';
import { emptyPlan, isEmptyPlan, addTarget, setTargetAmount, removeTarget, addHave,
         removeHave, pin, toggle, toggleKind, setOption,
         selectMaterial, includeProcess } from './plan-state.js';

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

/**
 * A material, anywhere in the plan.
 *
 * Clicking one opens it in the inspector rather than leaving for the explorer.
 * That is the difference between a plan you can steer and a plan you can only
 * read: the material you most want to redirect is one already being made, and
 * before this the only way to say "not like that" was to ban the step it
 * happened to pick and see what it picked next. The explorer is one press
 * further on, from the inspector.
 */
function matLink(name) {
  const m = ctx.db.byName.get(name);
  const a = el('a', 'matlink' + (m ? '' : ' dangling') + (name === plan.selected ? ' on' : ''),
                m ? m.display : name);
  a.href = '#';
  a.title = m ? `What ${m.display} is for, and how else to get it`
              : `${name} is named but never defined`;
  if (m) a.addEventListener('click', (e) => { e.preventDefault(); edit(selectMaterial, name); });
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
 * The temperatures at which a side reaction goes off.
 *
 * Worth spelling out on every line: a step may dodge several at once and only
 * one of them explains the limit it ended up with.
 */
function firesAt([lo, hi]) {
  const open = !Number.isFinite(hi);
  if (lo > 0 && open) return `${formatTemperature(lo)} and above`;
  if (lo > 0) return `${formatTemperature(lo)}–${formatTemperature(hi)}`;
  if (!open) return `${formatTemperature(hi)} and below`;
  return 'any temperature';
}

/**
 * Everything currently showing suggestions, so a click elsewhere can put them
 * all away. There is no `contains` check: each picker stops clicks inside
 * itself from reaching the document, so anything that gets here was outside.
 */
const openPickers = [];

/**
 * A material picker: type, and pick one of the matches.
 *
 * It runs the explorer's own query parser, so `el:Au`, `state:gas` and a plain
 * name all work here too and there is only one search grammar to learn.
 *
 * The whole row is the target. Making people find a small button to the right
 * of the thing they just picked out is a second decision where there was only
 * one, and arrow keys and Enter do the same without the mouse at all.
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

  let rows = [];
  let active = -1;

  const close = () => { list.textContent = ''; rows = []; active = -1; };
  const highlight = () => rows.forEach((r, i) =>
    (i === active ? r.li.classList.add('on') : r.li.classList.remove('on')));

  const run = () => {
    close();
    const q = input.value.trim();
    if (!q) return;
    for (const { m } of search(ctx.db, q).results.slice(0, 8)) {
      const li = el('li', 'picker-hit');
      const name = el('span', 'picker-name');
      name.append(ctx.swatch(m), el('span', 'picker-label', m.display));
      li.append(name);

      const take = (run2) => () => { input.value = ''; close(); run2(m.name); };
      const acts = el('span', 'picker-acts');
      for (const [label, hint, run2] of actions) {
        acts.append(button('ghost small', label, hint, take(run2)));
      }
      // One action: the buttons are noise, since the row is the button.
      if (actions.length > 1) li.append(acts);
      li.addEventListener('click', take(actions[0][2]));
      li.addEventListener('mouseenter', () => {
        active = rows.findIndex((r) => r.li === li);
        highlight();
      });
      rows.push({ li, take: take(actions[0][2]) });
      list.append(li);
    }
    active = rows.length ? 0 : -1;
    highlight();
  };

  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      active = e.key === 'ArrowDown' ? Math.min(rows.length - 1, active + 1)
                                     : Math.max(0, active - 1);
      highlight();
      return;
    }
    if (e.key === 'Enter' && rows[active]) { e.preventDefault(); rows[active].take(); }
  });
  // Clicks inside a picker are its own business; everything else dismisses it.
  box.addEventListener('click', (e) => e.stopPropagation());
  openPickers.push(close);
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

/**
 * The chips only. Each row's input is built once at boot and left alone, so
 * typing into it survives the plan being solved again on every keystroke.
 */
function renderGoals() {
  const wants = $('#goal-targets');
  wants.textContent = '';
  for (const t of plan.targets) {
    const n = el('input', 'goal-amount');
    n.type = 'number';
    n.min = '1';
    n.value = String(t.amount);
    n.title = `How many ${t.name}`;
    n.addEventListener('change', () => edit(setTargetAmount, t.name, Number(n.value)));
    const inner = document.createDocumentFragment();
    inner.append(n, matLink(t.name));
    wants.append(goalChip('goal-target', '', () => edit(removeTarget, t.name), inner));
  }

  const haves = $('#goal-haves');
  haves.textContent = '';
  for (const name of plan.have) {
    haves.append(goalChip('goal-have', '', () => edit(removeHave, name), matLink(name)));
  }
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
  // Kept out of this range: what would happen, and where.
  for (const a of w.avoided) {
    const line = el('span', 'rx-avoids');
    line.append(`avoids ${a.label}, which starts at ${firesAt(a.range)}`);
    if (a.binding) {
      line.append(el('span', 'rx-binding', ' — this is what sets the limit'));
    }
    line.title = a.binding
      ? "The step's range stops just short of this."
      : 'Also dodged, though something else is the tighter limit.';
    out.append(line);
  }
  // Not kept out: no temperature in the range avoids these, so they happen.
  // Anything sharing the feed is left out here: it is a step of its own now,
  // with its share of the throughput, which says far more than a note would.
  const sharing = new Set((step.share ? solved.dag.groups.get(
    solved.dag.forced.get(step.process.id) ?? step.process.id) || [] : []).map((m) => m.id));
  for (const u of w.unavoidable) {
    if (sharing.has(u.id)) continue;
    const wanted = solved.dag.processes.has(u.id);
    const line = el('span', 'rx-also');
    line.append(`this also runs ${u.label} (${firesAt(u.range)})`);
    line.append(el('span', 'rx-why',
      wanted ? ' — which is a step of this plan anyway'
             : ' — no temperature in range avoids it'));
    if (wanted) line.classList.add('wanted');
    line.title = 'The same chamber contents drive this too, at every temperature ' +
      'the step can be run at.';
    out.append(line);
  }
  return out;
}

function renderSteps() {
  const box = $('#plan-steps');

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

  if (!solved.steps.length && plan.targets.length) {
    box.append(el('p', 'muted', 'Nothing to do — everything asked for is already in hand.'));
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
    const tr = el('tr', 'plan-step' + (step.sharesWith ? ' step-shared' : ''));
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
    // Reactions on the same feed are tried in turn and one wins each tick, so
    // the feed is divided between them whether you wanted it or not.
    if (step.share) {
      const note = el('div', 'step-share');
      note.append(`${step.share.k} in ${step.share.of} of the ${
        step.process.consumes[0]?.name ?? 'feed'} goes this way`);
      if (step.sharesWith) {
        note.append(', sharing the chamber with ');
        note.append(el('span', 'step-share-with', step.sharesWith.label));
      } else {
        note.append(' — the rest runs the other reactions below');
      }
      if (step.share.rounded) note.append(' (roughly)');
      what.append(note);
    }
    what.append(conditions(step));
    tr.append(what);

    const acts = el('td', 'step-acts');
    // The constructive action first. Banning a step one at a time until the
    // solver lands on something you like is not choosing, and the inspector
    // was no use to anyone who did not think to click the output.
    const made = step.process.produces
      .map((o) => o.name)
      .find((n) => solved.dag.materials.get(n)?.producer === step.process.id);
    if (step.sharesWith) {
      // Not a choice, so not offered as one.
      tr.append(el('td', 'step-acts'));
      tbody.append(tr);
      continue;
    }
    if (made) {
      acts.append(button('ghost small', 'Other ways',
                         `Every way of getting ${made}, to choose from`,
                         () => edit(selectMaterial, made)));
    }
    acts.append(button('ghost small', 'Not this', 'Keep this process out of the plan',
                       () => edit(toggle, 'excludeProcesses', step.process.id)));
    tr.append(acts);

    tbody.append(tr);
  }
  table.append(tbody);
  box.append(table);
}

/**
 * What you could do with what you have.
 *
 * Naming one thing you have is a question, not a plan, and answering it with
 * an empty table says nothing. This is the list of processes that would take
 * it, nearest first: the ones you could run right now come before the ones
 * still short of an ingredient.
 */
function renderUses() {
  const box = $('#plan-steps');
  const available = new Set(plan.have);
  for (const id of plan.include) {
    for (const o of ctx.graph.byId.get(id)?.produces || []) available.add(o.name);
  }
  const uses = usesFor(solved, available);

  const head = el('div', 'plan-steps-head plan-uses-head');
  head.append(el('h2', null, uses.length
    ? `${uses.length} thing${uses.length === 1 ? '' : 's'} you could do with that`
    : 'Nothing the plan is allowed to use takes any of that'));
  head.append(el('span', 'muted', 'or name something to make, above'));
  box.append(head);
  if (!uses.length) return;

  const ready = uses.filter((u) => u.ready).length;
  if (ready) {
    box.append(el('p', 'muted',
      `${ready} you could run as things stand; the rest are short of something.`));
  }

  const list = el('ul', 'use-list');
  for (const u of uses.slice(0, allUses ? uses.length : USES_SHOWN)) {
    const li = el('li', 'use-opt' + (u.ready ? ' ready' : '') + (u.included ? ' on' : ''));
    const pick = button('route-pick', '', 'Put this step in the plan',
                        () => edit(includeProcess, u.process.id));
    pick.append(el('span', 'kind-glyph', KIND.get(u.process.kind)?.glyph || ''));
    pick.append(el('span', 'route-label', u.process.label));
    const eq = el('span', 'route-from');
    u.inputs.forEach((i, k) => {
      if (k) eq.append(' + ');
      const tag = el('span', 'route-in' + (i.have ? ' have' : ''));
      tag.append((i.count !== 1 ? `${i.count} ` : '') + i.name);
      eq.append(tag);
    });
    eq.append(' → ');
    u.process.produces.forEach((o, k) => {
      if (k) eq.append(' + ');
      eq.append(el('span', 'route-out', (o.count !== 1 ? `${o.count} ` : '') + o.name));
    });
    pick.append(eq);
    li.append(pick);
    list.append(li);
  }
  box.append(list);
  if (uses.length > USES_SHOWN) {
    box.append(button('ghost small', allUses ? 'Show fewer' : `Show all ${uses.length}`, null,
                      () => { allUses = !allUses; render(); }));
  }
}

/* ------------------------------------------------------------------- side */

/** How many routes to show before the list has to be asked for in full. */
const ROUTES_SHOWN = 6;
let allRoutes = false;
const USES_SHOWN = 12;
let allUses = false;

/**
 * One material: what it is doing here, and every other way to get it.
 *
 * The list of routes is the answer to "not like that, like this". It is sorted
 * by what each costs, marks the one in use, and says which of a route's inputs
 * you already have -- with 149 ways to make Carbon, that is the only way to
 * choose between them at a glance.
 */
function renderInspector(box) {
  const name = plan.selected;
  if (!name) return;
  const m = ctx.db.byName.get(name);
  if (!m) return;
  const node = solved.dag.materials.get(name);

  const panel = el('section', 'plan-panel inspector');
  const head = el('div', 'inspector-head');
  const title = el('h2', 'inspector-name');
  title.append(ctx.swatch(m), el('span', null, m.display));
  head.append(title);
  head.append(button('ghost small', 'Look up', `Open ${m.display} in the explorer`,
                     () => ctx.openInExplorer(m)));
  head.append(button('goal-x', '×', 'Close', () => edit(selectMaterial, null)));
  panel.append(head);

  const need = solved.amountOf(name);
  const made = solved.madeOf(name);
  const role = [];
  if (plan.targets.some((t) => t.name === name)) role.push('something the plan is for');
  if (plan.have.includes(name)) role.push('yours already');
  else if (node?.reason === 'produced') role.push('made here');
  else if (node) role.push('to be fetched');
  else role.push('not in the plan');
  if (rcmp(need, R0) > 0) role.push(`${amount(need)} needed`);
  if (rcmp(made, R0) > 0) role.push(`${amount(made)} made`);
  panel.append(el('p', 'inspector-role', role.join(' · ')));

  const acts = el('div', 'plan-item-acts');
  if (!plan.targets.some((t) => t.name === name)) {
    acts.append(button('ghost small', 'I want it', 'Count it as something the plan is for',
                       () => edit(addTarget, name)));
  }
  const banned = plan.excludeMaterials.includes(name);
  acts.append(button('ghost small' + (banned ? ' on' : ''), 'Never use it',
                     'Keep this material out of the plan entirely',
                     () => edit(toggle, 'excludeMaterials', name)));

  // --- how to get it -------------------------------------------------------
  //
  // Having one is the first and best answer, so it heads the list rather than
  // sitting in a row of buttons above it: "I have water" is an alternative to
  // every way of making water, not a different kind of thing.
  const routes = routesFor(solved, name);
  const has = plan.have.includes(name);
  panel.append(el('h3', 'inspector-sub', routes.length
    ? `${routes.length + 1} ways to get it` : 'How to get it'));
  const list = el('ul', 'route-list');

  const mine = el('li', 'route-opt' + (has ? ' on' : ''));
  const mineBtn = button('route-pick', '', has ? 'Stop treating this as available'
                                               : 'Treat this as available and plan no further',
                         () => edit(has ? removeHave : addHave, name));
  mineBtn.append(el('span', 'kind-glyph', '\u2713'));
  mineBtn.append(el('span', 'route-label', has ? 'You have it' : 'I have it'));
  mineBtn.append(el('span', 'route-from', 'nothing to make, nothing to fetch'));
  mine.append(mineBtn);
  list.append(mine);

  if (routes.length) {
    const pinned = plan.pins[name];
    const auto = el('li', 'route-opt' + (!pinned && !has ? ' on' : ''));
    auto.append(button('route-pick', 'Let the planner choose',
                       'Undo a choice made here', () => edit(pin, name, null)));
    list.append(auto);

    const shown = allRoutes ? routes : routes.slice(0, ROUTES_SHOWN);
    for (const r of shown) {
      const li = el('li', 'route-opt' + (r.chosen ? ' on' : '') + (r.banned ? ' banned' : ''));
      const pick = button('route-pick', '', `Make ${m.display} this way`,
                          () => edit(pin, name, r.process.id));
      pick.append(el('span', 'kind-glyph', KIND.get(r.process.kind)?.glyph || ''));
      pick.append(el('span', 'route-label', r.process.label));
      const from = el('span', 'route-from');
      if (r.inputs.length) {
        r.inputs.forEach((i, k) => {
          if (k) from.append(' + ');
          const tag = el('span', 'route-in' + (i.have ? ' have' : i.inPlan ? ' inplan' : ''));
          tag.append((i.count !== 1 ? `${i.count} ` : '') + i.name);
          tag.title = i.have ? 'You have this' : i.inPlan ? 'Already in the plan' : 'Would have to be got';
          from.append(tag);
        });
      } else {
        from.append('nothing else');
      }
      pick.append(from);
      li.append(pick);
      list.append(li);
    }
  }
  panel.append(list);
  if (routes.length > ROUTES_SHOWN) {
    panel.append(button('ghost small', allRoutes ? 'Show fewer'
                        : `Show all ${routes.length}`, null,
                        () => { allRoutes = !allRoutes; render(); }));
  }
  if (!routes.length) {
    panel.append(el('p', 'muted', 'Nothing the plan is allowed to make this with, so it has ' +
      'to be found — or another kind of process switched on under Options.'));
  }

  panel.append(acts);
  box.append(panel);
}

function renderSide() {
  const box = $('#plan-side');
  box.textContent = '';
  renderInspector(box);

  // --- what you still have to go and get ---------------------------------
  const front = el('section', 'plan-panel');
  front.append(el('h2', null, solved.frontier.length
    ? `${solved.frontier.length} to fetch` : 'Nothing left to fetch'));
  if (solved.frontier.length) {
    const ul = el('ul', 'plan-list');
    for (const f of solved.frontier) {
      const li = el('li', 'plan-item');
      li.dataset.material = f.name;
      const line = el('div', 'plan-item-main');
      line.append(el('span', 'amount', amount(f.amount)), ' ', matLink(f.name));
      li.append(line);
      // How the world hands this over, for the kinds this plan will not use.
      if (f.routes.length) {
        const how = el('div', 'plan-how');
        const kind = KIND.get(f.routes[0].kind);
        how.append(`${kind?.glyph || ''} ${f.routes[0].label}`);
        li.append(how);
      } else if (ctx.graph.categoryOf(f.name) === 'deposit') {
        li.append(el('div', 'plan-how', 'out there somewhere — go and find one'));
      } else if (f.raw) {
        li.append(el('div', 'plan-how', 'found in the world'));
      }
      const acts = el('div', 'plan-item-acts');
      // A deposit is never a question. It is in the ground somewhere and you
      // are going to go and find it, so offering to mark it as already had is
      // a button that means nothing.
      if (ctx.graph.categoryOf(f.name) !== 'deposit') {
        acts.append(button('ghost small', 'I have it', 'Stop planning for this one',
                           () => edit(addHave, f.name)));
      }
      acts.append(button('ghost small', 'Other ways', `How else ${f.name} could be got`,
                         () => edit(selectMaterial, f.name)));
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
      li.dataset.material = b.name;
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

  // --- the extremes, and which step is responsible for each ---------------
  //
  // A summary of conditions the steps already state, so it earns its place
  // only by picking out the demanding ones and saying which chamber they are
  // about. Catalysts are deliberately not repeated here: they are named on the
  // step that needs them, and a second listing says nothing new.
  const a = solved.apparatus;
  const kit = [];
  // Naming one step of six that all want the same thing would be a lie.
  const which = (p, shared) =>
    (shared > 1 ? `${shared} steps, the first being ${p.label}` : (p ? p.label : ''));
  const ambient = `ambient runs ${formatTemperature(AMBIENT.min)} to ` +
                  `${formatTemperature(AMBIENT.max)}`;

  if (a.heating === 'always') {
    kit.push(['Heating', `to ${formatTemperature(a.hottestFloor)}`,
              which(a.hottestStep, a.hottestShared)]);
  } else if (a.heating === 'sometimes') {
    kit.push(['No furnace', `the hottest step only wants ${formatTemperature(a.hottestFloor)}`,
              `${which(a.hottestStep, a.hottestShared)} — ${ambient}, so this is about ` +
              'insulating it from anything colder rather than heating it']);
  }
  if (a.cooling === 'always') {
    kit.push(['Cooling', `below ${formatTemperature(a.lowestCeiling)}`,
              which(a.coolestStep, a.coolestShared)]);
  } else if (a.lowestCeiling) {
    kit.push(['A ceiling', `${formatTemperature(a.lowestCeiling)}, not to be gone over`,
              which(a.coolestStep, a.coolestShared)]);
  }
  if (a.electrolysis) kit.push(['Electrolysis', 'a current in the chamber', '']);
  if (a.spark) kit.push(['A spark', 'to set something off', '']);
  if (a.byHand) kit.push(['You', 'placing the last of it yourself', '']);

  if (kit.length) {
    const app = el('section', 'plan-panel');
    app.append(el('h2', null, 'The demanding bits'));
    const dl = el('dl', 'plan-kit');
    for (const [term, value, why] of kit) {
      dl.append(el('dt', null, term));
      const dd = el('dd');
      dd.append(value);
      if (why) dd.append(el('span', 'plan-kit-why', why));
      dl.append(dd);
    }
    app.append(dl);
    if (a.hottestStep && a.coolestStep && a.hottestStep !== a.coolestStep) {
      app.append(el('p', 'muted', 'Different steps, so different chambers.'));
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
  // With nothing named to make, the question is "what can I do with this?" --
  // and once something has been picked, both: the steps so far, then what
  // those leave you able to do next.
  $('#plan-steps').textContent = '';
  if (plan.targets.length || plan.include.length) renderSteps();
  if (!plan.targets.length) renderUses();
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

  // A box on each goal row, so adding to one is not a trip to the top bar and
  // a choice of button. Built once and never re-rendered, so what you have
  // typed survives the plan being solved again between keystrokes.
  $('#goal-make-add').append(picker({
    placeholder: 'something to make',
    actions: [['Make it', 'Plan a way to produce this', (n) => edit(addTarget, n)]],
  }));
  $('#goal-have-add').append(picker({
    placeholder: 'something you have',
    actions: [['I have it', 'Treat this as available', (n) => edit(addHave, n)]],
  }));

  // Anything showing suggestions puts them away when you click elsewhere.
  document.addEventListener('click', () => {
    for (const close of openPickers) close();
  });

  $('#plan-avoid').addEventListener('change', (e) =>
    edit(setOption, 'avoidSideEffects', e.target.checked));
  $('#toggle-plan-options').addEventListener('click', () => {
    const open = $('#plan-options').hidden;
    $('#plan-options').hidden = !open;
    $('#toggle-plan-options').setAttribute('aria-pressed', String(open));
  });
}
