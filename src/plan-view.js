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
import { solvePlan, balanceTargets, routesFor, usesFor,
         rat, rmul, rsub, rstr, rcmp, R0 } from './plan-solve.js';
import { KIND, PROCESS_KINDS } from './plan-graph.js';
import { AMBIENT, formatTemperature, formatTemperatureRange,
         formatTemperatureDelta } from './units.js';
import { emptyPlan, isEmptyPlan, addTarget, setTargetAmount, removeTarget, addHave,
         removeHave, pin, toggle, toggleKind, setOption,
         selectMaterial, includeProcess, isFedBack, toggleFedBack,
         primeInstead, makeInstead, keepOutput, isKept,
         useSpare, isUsingSpare, setOption as setPlanOption,
         hasPlenty, togglePlenty } from './plan-state.js';

/** Everything the pane needs from the shell, handed over once at boot. */
let ctx = null;

/** The amounts this render is working in: balanced, or exactly what was typed. */
let shownTargets = [];

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
  if (lo > 0 && open) return `≥ ${formatTemperature(lo)}`;
  if (lo > 0) return `${formatTemperature(lo)}–${formatTemperature(hi)}`;
  if (!open) return `≤ ${formatTemperature(hi)}`;
  return 'any temperature';
}

/** "a", "a and b", "a, b and c". */
const listed = (parts) => (parts.length < 2 ? (parts[0] || '')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

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
  for (const t of shownTargets) {
    const n = el('input', 'goal-amount');
    n.type = 'number';
    n.min = '1';
    n.value = String(t.amount);
    n.title = `How many ${t.name}`;
    n.title = plan.balance
      ? `How many ${t.name} — worked out to use the feed up. Typing here takes it over.`
      : `How many ${t.name}`;
    n.addEventListener('change', () => edit(setTargetAmount, t.name, Number(n.value)));
    const inner = document.createDocumentFragment();
    inner.append(n, matLink(t.name));
    wants.append(goalChip('goal-target', '', () => edit(removeTarget, t.name), inner));
  }

  // One button for the arithmetic nobody wants to do: hold the amounts in the
  // proportion the feed actually comes out in. It stays on, so adding a
  // product or ruling a step out re-works them rather than leaving a ratio
  // that was right for the last question.
  const bal = $('#goal-balance');
  bal.textContent = '';
  if (plan.targets.length) {
    const b = button('ghost small' + (plan.balance ? ' on' : ''), 'Balanced',
      plan.balance
        ? 'Amounts are worked out to use up what you have. Press to keep your own.'
        : 'Work the amounts out so nothing you have goes to waste',
      () => edit(setPlanOption, 'balance', !plan.balance));
    bal.append(b);
  }

  // How much of each you actually have to supply. Not editable, unlike the
  // amounts above: it is worked out from the plan rather than asked for, and
  // a zero says the material was declared but never used.
  //
  // Net of anything the plan makes for itself. Nine Carbon go into the two
  // reductions, but four come back off the spare Carbon Monoxide, so five is
  // the number you have to find -- and the gross figure was a request for four
  // you would never be asked for.
  const haves = $('#goal-haves');
  haves.textContent = '';
  for (const name of plan.have) {
    const wanted = solved ? solved.amountOf(name) : null;
    const own = solved ? solved.madeOf(name) : null;
    const used = wanted && (rcmp(wanted, own) > 0 ? rsub(wanted, own) : R0);
    const inner = document.createDocumentFragment();
    if (used) {
      const n = el('span', 'goal-used' + (rcmp(used, R0) > 0 ? '' : ' none'), amount(used));
      n.title = rcmp(used, R0) <= 0 ? 'The plan does not use this'
        : rcmp(own, R0) > 0
          ? `The plan uses ${amount(wanted)} ${name} and makes ${amount(own)} of them itself`
          : `The plan uses ${amount(used)} ${name}`;
      inner.append(n);
    }
    inner.append(matLink(name));
    // The two kinds of "I have it", and the difference is only ever visible
    // here: a fixed stock is what the amounts are balanced against, and
    // something you can go on making is not a limit at all. Both stop the plan
    // from working out how to make it.
    const plenty = hasPlenty(plan, name);
    const mark = button('goal-kind', plenty ? 'as needed' : 'all I have',
      plenty
        ? `The plan needs this much ${name} and you can get it. Press if that is all you have.`
        : `All the ${name} you have, so the amounts are balanced against it. ` +
          'Press if you can get more.',
      () => edit(togglePlenty, name));
    if (plenty) mark.classList.add('on');
    inner.append(mark);
    haves.append(goalChip('goal-have', '', () => edit(removeHave, name), inner));
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
    // Either filter block does the job, so the other is offered rather than
    // demanded alongside it.
    if (c.eitherFilter) { span.append(' or ', matLink(c.eitherFilter)); }
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
    const line = el('span', 'rx-avoids', `avoids ${a.label} at ${firesAt(a.range)}`);
    line.title = a.binding
      ? "The step's range stops just short of this one."
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
    line.append(`this also runs ${u.label} at ${firesAt(u.range)}`);
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
  // A run is a whole thing. Where getting exactly what was asked for would take
  // a fraction of one -- the potassium hydroxide electrolysis goes two at a
  // time, so one Potassium is half a run of it -- the plan is multiplied up.
  // Saying only that it was "scaled ×2" leaves the reader to work out what they
  // now get, while the goal bar still says 1.
  if (solved.scale.n !== 1n) {
    const makes = shownTargets.map((t) => {
      const m = ctx.db.byName.get(t.name);
      return `${rstr(rmul(rat(t.amount), solved.scale))} ${m ? m.display : t.name}`;
    });
    const note = el('span', 'muted', makes.length
      ? `one batch makes ${listed(makes)}`
      : `every run multiplied by ${rstr(solved.scale)} to come out whole`);
    note.title = `A run is a whole thing, and making exactly what was asked for ` +
      `would take a fraction of one, so the whole plan is multiplied by ` +
      `${rstr(solved.scale)}.`;
    head.append(note);
  }
  box.append(head);

  const table = el('table', 'plan-table');
  const tbody = el('tbody');
  for (const step of solved.steps) {
    const onSpare = solved.spec.alsoUse.has(step.process.id);
    const tr = el('tr', 'plan-step' + (step.sharesWith ? ' step-shared' : '') +
                        (onSpare ? ' step-spare-run' : ''));
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
    // Running on what the plan already throws off, and no further: it makes
    // what the spare stretches to and the material's usual route makes up the
    // difference. Without saying so, a step that plainly could run more times
    // than it does looks like an arithmetic mistake.
    if (onSpare) {
      const note = el('div', 'step-spare');
      note.append(`on the spare ${listed(step.process.consumes.map((i) => i.name))}`);
      for (const o of step.process.produces) {
        const rest = rsub(solved.amountOf(o.name), rmul(step.runs, rat(o.count)));
        const other = solved.dag.materials.get(o.name)?.producer;
        if (rcmp(rest, R0) <= 0 || !other) continue;
        note.append(` — the other ${amount(rest)} ${o.name} ${
          rcmp(rest, rat(1)) === 0 ? 'comes' : 'come'} from `);
        note.append(el('span', 'step-share-with', ctx.graph.byId.get(other)?.label ?? other));
      }
      what.append(note);
    }
    what.append(conditions(step));
    tr.append(what);

    const acts = el('td', 'step-acts');
    // What this step is in the plan to make, as against what it also throws
    // off. The constructive action first: banning a step one at a time until
    // the solver lands on something you like is not choosing, and the
    // inspector was no use to anyone who did not think to click the output.
    const made = step.process.produces
      .map((o) => o.name)
      .find((n) => solved.dag.materials.get(n)?.producer === step.process.id) ??
      // A step running on the leavings is nobody's chosen producer -- it makes
      // part of the demand and the chosen route makes the rest -- so what it
      // is here for has to be read off the demand instead.
      (onSpare ? step.process.produces.map((o) => o.name)
        .find((n) => rcmp(solved.amountOf(n), R0) > 0) : undefined);
    if (step.sharesWith) {
      // Not a choice, so not offered as one.
      tr.append(el('td', 'step-acts'));
      tbody.append(tr);
      continue;
    }

    // Some steps are here only because the plan would otherwise have to be
    // primed: the water is condensed out of spare steam rather than taken back
    // off the acid, which costs a step and saves a charge. That is a trade the
    // reader may want the other way round, so it is offered where the step it
    // bought is standing.
    // Only the step *chosen* to make it. Others may produce it in passing --
    // the acid step hands back water too -- and they are not here for it.
    const loop = made && solved.brokenLoops.includes(made) ? made : null;
    if (loop) {
      const why = el('div', 'step-loop');
      why.append(`here so the ${ctx.db.byName.get(loop)?.display ?? loop} ` +
                 'does not have to be laid in');
      what.append(why);
      acts.append(button('ghost small', 'Prime instead',
        `Drop this step and lay in the ${loop} to start the loop off`,
        () => edit(primeInstead, loop)));
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
  else if (node?.reason === 'credited') role.push('surplus, fed back into the plan');
  else if (node?.reason === 'produced') role.push('made here');
  // Something nobody chose to make, but which comes out anyway. Only what the
  // plan cannot cover that way is on the shopping list, so a byproduct that
  // meets its own demand is not "to be fetched" -- it is already here.
  else if (node?.reason === 'byproduct' && rcmp(made, need) >= 0) {
    role.push(rcmp(need, R0) > 0 ? 'a byproduct the plan then uses' : 'a byproduct');
  }
  else if (node) role.push('to be fetched');
  else role.push('not in the plan');
  if (rcmp(need, R0) > 0) role.push(`${amount(need)} needed`);
  if (rcmp(made, R0) > 0) role.push(`${amount(made)} made`);
  panel.append(el('p', 'inspector-role', role.join(' · ')));

  const acts = el('div', 'plan-item-acts');
  if (!plan.targets.some((t) => t.name === name)) {
    // Something the plan already has going spare is claimed, not demanded.
    // Asking for it as a target would set a fresh batch going for what is
    // sitting there -- and the two are counted differently, since a target is
    // stated before the batch scaling and a surplus is shown after it.
    const spare = rcmp(rsub(made, need), R0) > 0;
    if (spare) {
      acts.append(button('ghost small' + (isKept(plan, name) ? ' on' : ''),
                         isKept(plan, name) ? 'Kept' : 'Keep it',
                         'Count the spare as something you wanted, without making more',
                         () => edit(keepOutput, name)));
    } else {
      acts.append(button('ghost small', 'I want it', 'Plan a way to make some',
                         () => edit(addTarget, name)));
    }
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
  // Saying you have it drops the pin that said how to make it, which is right
  // -- unless that pin was read as a route run on the leavings. That is not a
  // claim about how the material is made, so it survives, as itself: the four
  // Carbon still come off the spare Carbon Monoxide and only the other five
  // are yours to supply.
  const standingIn = solved.sharedPins.get(name);
  const takeIt = (p) => (standingIn ? useSpare(addHave(p, name, true), name, standingIn)
                                    : addHave(p, name, true));
  const mineBtn = button('route-pick', '', has ? 'Stop treating this as available'
                                               : 'Treat this as available and plan no further',
                         () => edit(has ? removeHave : takeIt));
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

    const head = allRoutes ? routes : routes.slice(0, ROUTES_SHOWN);
    // A route you ruled out sorts last, so with 153 of them it falls off the
    // end and takes the only way to take it back with it. It comes along
    // whatever the cut.
    const shown = allRoutes ? head
      : [...head, ...routes.filter((r) => r.banned && !head.includes(r))];
    const shared = routes.some((r) => r.spare);
    for (const r of shown) {
      const li = el('li', 'route-opt' + (r.chosen || r.spare ? ' on' : '') +
                          (r.banned ? ' banned' : ''));
      const pick = button('route-pick', '', `Make ${m.display} this way`,
                          () => edit(pin, name, r.process.id));
      pick.append(el('span', 'kind-glyph', KIND.get(r.process.kind)?.glyph || ''));
      pick.append(el('span', 'route-label', r.process.label));
      // Two routes can be live at once: one running on what the plan throws
      // off, and the usual one making up the difference. Saying which is
      // which, and by how much, is the whole of the difference between them.
      if (shared && (r.chosen || r.spare)) {
        const much = el('span', 'route-share');
        much.append(`${amount(r.covers)} of the ${amount(solved.amountOf(name))}`);
        if (r.spare) {
          const on = r.process.consumes.map((i) => i.name);
          much.append(el('span', 'faint', ` — on the spare ${listed(on)}`));
          much.title = 'Only what the plan is already throwing off feeds this, ' +
                       'so it makes what that stretches to and no more.';
        }
        pick.append(much);
      }
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
      // The other thing a route can be: not how the material is made, but a
      // use for what the plan is already throwing away. Offered wherever the
      // plan has some of what it eats, since that is when it can do anything.
      const on = isUsingSpare(plan, r.process.id);
      const acts = el('div', 'route-acts');
      // A rejected route sorts to the bottom and is otherwise inert, so this
      // is where it can be taken back. Picking it would only pin a process the
      // planner is not allowed to use.
      if (r.banned) {
        acts.append(button('ghost small on', 'Ruled out', 'Let the planner use this again',
                           () => edit(toggle, 'excludeProcesses', r.process.id)));
      } else if (!r.chosen && (on || r.runnable)) {
        acts.append(button('ghost small' + (on ? ' on' : ''),
          on ? 'On the spare' : 'Use the spare',
          `Run ${r.process.label} on whatever the plan leaves over, and no further`,
          () => edit(useSpare, name, r.process.id)));
        if (on && !r.spare) {
          acts.append(el('span', 'faint', 'nothing spare to run it on'));
        }
      }
      if (acts.children.length) li.append(acts);
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
      if (f.credited) {
        li.append(el('div', 'plan-how',
          'the plan makes some of this and it is being fed back, but not enough'));
      }
      const acts = el('div', 'plan-item-acts');
      // A deposit is never a question. It is in the ground somewhere and you
      // are going to go and find it, so offering to mark it as already had is
      // a button that means nothing.
      if (ctx.graph.categoryOf(f.name) !== 'deposit') {
        acts.append(button('ghost small', 'I have it', 'Stop planning for this one',
                           () => edit(addHave, f.name, true)));
      }
      acts.append(button('ghost small', 'Other ways', `How else ${f.name} could be got`,
                         () => edit(selectMaterial, f.name)));
      li.append(acts);
      ul.append(li);
    }
    front.append(ul);
  }
  box.append(front);

  // --- what has been ruled out -------------------------------------------
  //
  // "Not this" and "Never use it" are one press each and, until this panel,
  // could not be taken back: the step goes, and the button goes with it. A
  // reader who narrows a plan into a dead end is then stuck with no way out
  // and nothing on the page saying what narrowed it.
  const ruledProcesses = plan.excludeProcesses;
  const ruledMaterials = plan.excludeMaterials;
  const ruled = ruledProcesses.length + ruledMaterials.length;
  if (ruled) {
    const out = el('section', 'plan-panel ruled-out');
    const title = el('h2', null, `${ruled} ruled out`);
    title.title = 'Everything you have kept out of the plan by hand, and the way back.';
    out.append(title);
    // A plan that could have made something and is asking you to fetch it has
    // given up on it, and a rejection is the likeliest reason.
    const gaveUp = solved.frontier.filter((f) => f.alternatives > 0);
    if (gaveUp.length) {
      out.append(el('p', 'muted', `The plan gave up on ${
        listed(gaveUp.map((f) => ctx.db.byName.get(f.name)?.display ?? f.name))
      } and asks you to fetch ${gaveUp.length === 1 ? 'it' : 'them'} instead. ` +
        'One of these may be why.'));
    }
    const ul = el('ul', 'plan-list');
    for (const id of ruledProcesses) {
      const p = ctx.graph.byId.get(id);
      const li = el('li', 'plan-item');
      const line = el('div', 'plan-item-main');
      line.append(el('span', 'kind-glyph', KIND.get(p?.kind)?.glyph || ''));
      // A link that no longer resolves is still worth showing: it is a saved
      // choice about a reaction this build of the data no longer has, and the
      // reader needs to be able to clear it.
      line.append(p ? p.label : id);
      li.append(line);
      if (p) li.append(el('div', 'plan-how', 'this step, kept out of the plan'));
      else li.append(el('div', 'plan-how', 'no longer in the game data'));
      const acts = el('div', 'plan-item-acts');
      acts.append(button('ghost small', 'Allow it', 'Let the planner use this again',
                         () => edit(toggle, 'excludeProcesses', id)));
      li.append(acts);
      ul.append(li);
    }
    for (const name of ruledMaterials) {
      const li = el('li', 'plan-item');
      li.dataset.material = name;
      const line = el('div', 'plan-item-main');
      line.append(matLink(name));
      li.append(line);
      li.append(el('div', 'plan-how', 'this material, kept out of the plan entirely'));
      const acts = el('div', 'plan-item-acts');
      acts.append(button('ghost small', 'Allow it', 'Let the planner use this again',
                         () => edit(toggle, 'excludeMaterials', name)));
      li.append(acts);
      ul.append(li);
    }
    out.append(ul);
    box.append(out);
  }

  // --- what has to be in there before it starts ---------------------------
  //
  // Not a shopping list: none of this is spent. The plan hands back as much
  // chlorine as it takes, so over a cycle it needs none -- but it cannot turn
  // over without some in the chamber to begin with.
  if (solved.priming.length) {
    const prime = el('section', 'plan-panel priming');
    const title = el('h2', null, 'To get it going');
    title.title = 'The plan gives all of this back as fast as it uses it, so it needs ' +
      'none of it over a cycle — but it cannot start without some in the chamber.';
    prime.append(title);
    const ul = el('ul', 'plan-list');
    for (const item of solved.priming) {
      const li = el('li', 'plan-item');
      li.dataset.material = item.name;
      const line = el('div', 'plan-item-main');
      line.append(el('span', 'amount', amount(item.amount)), ' ', matLink(item.name));
      li.append(line);
      li.append(el('div', 'plan-how', 'put in once, never spent'));
      // A charge is a one-off and an extra step is forever, so which is better
      // is the reader's call, not the solver's. This is the other option, at
      // the moment it arises: make the material outright instead of taking it
      // back off the loop.
      const acts = el('div', 'plan-item-acts');
      // A charge that exists because a route was set to run on the leavings is
      // undone by dropping that route, not by adding a step: the step is
      // already there. Turning the four spare Carbon Monoxide back into Carbon
      // costs four Carbon to set the loop turning, and the reader may decide
      // that is not worth it.
      const recycles = [...solved.sharedPins].find(([mat, id]) =>
        mat === item.name && solved.spec.alsoUse.has(id));
      if (recycles) {
        acts.append(button('ghost small', 'Stop recycling it',
          `Drop ${ctx.graph.byId.get(recycles[1])?.label ?? recycles[1]}, which is ` +
          `what the charge is for`,
          () => edit(pin, item.name, null)));
      } else {
        acts.append(button('ghost small', 'Make it instead',
                           `Add a step that makes ${item.name}, rather than laying some in`,
                           () => edit(makeInstead, item.name)));
      }
      li.append(acts);
      ul.append(li);
    }
    prime.append(ul);
    box.append(prime);
  }

  // --- what it makes besides what was asked for --------------------------
  //
  // Kept output and waste are the same surplus read two ways, so they are two
  // panels over one list. Keeping something asks for nothing to be made: it
  // says the spare water is a product. Asking for it as a *target* would
  // demand a fresh batch -- and since a target's amount is stated before the
  // batch scaling and a leftover is shown after it, wanting the 1 spare Water
  // came out as a demand for 2, which sent the planner off after Vanadinite.
  for (const [wanted, heading] of [[true, 'You also get'], [false, 'left over']]) {
    const group = solved.byproducts.filter((b) => b.kept === wanted);
    if (!group.length) continue;
    const by = el('section', 'plan-panel' + (wanted ? ' kept' : ''));
    by.append(el('h2', null, wanted ? heading : `${group.length} ${heading}`));
    const ul = el('ul', 'plan-list');
    for (const b of group) {
      const li = el('li', 'plan-item');
      li.dataset.material = b.name;
      const line = el('div', 'plan-item-main');
      line.append(el('span', 'amount', amount(b.amount)), ' ', matLink(b.name));
      li.append(line);
      /**
       * A leftover that has some of the thing you asked for still in it.
       *
       * Ten Heptafluorotantalic Acid in the bin on a plan for tantalum is
       * worth saying out loud, and nothing could say it before: the game gives
       * that acid no formula, so what it is made of has to be read off the
       * reactions. Said quietly, because it is an inference and because it is
       * sometimes the right answer -- some of it really is out of balance.
       */
      if (b.holds?.length) {
        const el2 = b.holds.map((sym) => ctx.db.elementBySymbol.get(sym)?.name ?? sym);
        const note = el('div', 'plan-item-note',
                        `still has ${listed(el2.map((n) => n.toLowerCase()))} in it`);
        note.title = 'Worked out from the reactions it takes part in, not from a ' +
                     'formula the game gave it';
        li.append(note);
      }
      const acts = el('div', 'plan-item-acts');
      acts.append(button('ghost small' + (b.kept ? ' on' : ''),
                         b.kept ? 'Kept' : 'Keep it',
                         b.kept ? 'Count it as waste again'
                                : 'Count this spare output as something you wanted, ' +
                                  'without making any more',
                         () => edit(keepOutput, b.name)));
      const fed = isFedBack(plan, b.name);
      const feed = button('ghost small' + (fed ? ' on' : ''),
                          fed ? 'Fed back' : 'Feed it back',
                          fed ? 'Stop using this surplus as an input'
                              : 'Let the plan use this surplus instead of fetching more',
                          () => edit(toggleFedBack, b.name));
      feed.setAttribute('aria-pressed', String(!!b.credited));
      acts.append(feed);
      li.append(acts);
      ul.append(li);
    }
    by.append(ul);
    if (!wanted && !solved.converged) {
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
  $('#plan-feedback').checked = plan.feedBackAll;
}

/* --------------------------------------------------------------- balancing */

/**
 * The amounts the plan is actually solved and drawn with.
 *
 * Balancing costs a dozen solves, so the answer is kept: it depends on what is
 * being made and out of what, not on the numbers in the boxes, and those are
 * the things that change least often. Everything else in the question goes
 * into the key because it can move the ratio -- ruling a step out changes what
 * the feed comes to.
 */
let balancedFor = null;
let balancedTo = null;

function targetsFor(spec) {
  if (!plan.balance || !plan.targets.length) return plan.targets;
  const key = JSON.stringify([plan.targets.map((t) => t.name), spec.have, spec.plenty,
                              spec.include,
                              spec.alsoUse, spec.pins, spec.runs, spec.excludeProcesses,
                              spec.excludeMaterials, spec.credit, spec.noFeedBack,
                              spec.feedBackAll, spec.kinds, spec.avoidSideEffects]);
  if (key !== balancedFor) {
    balancedFor = key;
    balancedTo = balanceTargets(ctx.graph, { ...spec, targets: plan.targets });
  }
  return balancedTo;
}

/* ------------------------------------------------------------------ render */

export function render() {
  const empty = isEmptyPlan(plan);
  $('#plan-empty').hidden = !empty;
  $('#plan-work').hidden = empty;
  $('#toggle-plan-options').hidden = false;
  renderOptions();
  if (empty) { solved = null; return; }

  const question = {
    have: plan.have,
    plenty: plan.plenty,
    pins: plan.pins,
    include: plan.include,
    alsoUse: plan.alsoUse,
    runs: plan.runs,
    excludeProcesses: plan.excludeProcesses,
    excludeMaterials: plan.excludeMaterials,
    credit: plan.credit,
    kept: plan.kept,
    feedBackAll: plan.feedBackAll,
    noFeedBack: plan.noFeedBack,
    kinds: plan.kinds,
    avoidSideEffects: plan.avoidSideEffects,
  };
  shownTargets = targetsFor(question);

  solved = solvePlan(ctx.graph, {
    ...question,
    targets: shownTargets,
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
  $('#plan-feedback').addEventListener('change', (e) =>
    edit(setOption, 'feedBackAll', e.target.checked));
  $('#toggle-plan-options').addEventListener('click', () => {
    const open = $('#plan-options').hidden;
    $('#plan-options').hidden = !open;
    $('#toggle-plan-options').setAttribute('aria-pressed', String(open));
  });
}
