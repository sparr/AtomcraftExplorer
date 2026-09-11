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
import { listed } from './prose.js';
import { composition } from './composition.js';
import { balanceTargets } from './balance.js';
import { routesFor } from './routes.js';
import { drawPlan } from './plan-picture.js';
import { rat, rmul, rsub, rdiv, rstr, rcmp, R0 } from './rational.js';
import { solveFresh, blankFresh, questionShape, oreReach, oreCandidates,
         withElements, normalizeFresh,
         SOURCE_KINDS, SOURCES } from './plan-fresh.js';
import { SCORES, optionSets, digest } from './plan-menu.js';
import { rnum } from './rational.js';
import { KIND, PROCESS_KINDS } from './plan-graph.js';
import { AMBIENT, formatTemperature, formatTemperatureRange,
         formatTemperatureDelta } from './units.js';
import { emptyPlan, isEmptyPlan, addTarget, setTargetAmount, removeTarget, addHave,
         removeHave, toggle, toggleKind, toggleSource, setOption,
         selectMaterial, addTargets, keepOutput, isKept,
         setOption as setPlanOption, ORE_TRIES_MAX } from './plan-state.js';

/** Everything the pane needs from the shell, handed over once at boot. */
let ctx = null;
/** Which elements of the haves are ticked, until they are sent or dropped. */
let elementPicks = new Set();

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
    haves.append(goalChip('goal-have', '', () => edit(removeHave, name), inner));
  }
}

/* ------------------------------------------------------------------ steps */

/** The conditions a step runs under, as the game states them. */
/**
 * Sparr: the hazards go behind a button, not down the side of every step.
 *
 * What a step avoids, what it drags along with it, and why the batch is the
 * size it is are all worth knowing and none of them are worth three lines of
 * the plan each. They are gathered into `notes` and the caller puts them under
 * a flag the reader can hover: grey for something merely worth saying, orange
 * for a hazard this step is dodging on purpose, red for one it cannot dodge.
 *
 * A side reaction the plan was going to run anyway is not a danger and is
 * filed as information, which is the distinction `.rx-also.wanted` was already
 * drawing in the stylesheet.
 */
function conditions(step, notes) {
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
    notes.warn.push(`avoids ${a.label} at ${firesAt(a.range)} — ` + (a.binding
      ? "the step's range stops just short of this one"
      : 'also dodged, though something else is the tighter limit'));
  }
  // Not kept out: no temperature in the range avoids these, so they happen.
  // Anything sharing the feed is left out here: it is a step of its own now,
  // with its share of the throughput, which says far more than a note would.
  const sharing = new Set((step.share ? solved.dag.groups.get(
    solved.dag.forced.get(step.process.id) ?? step.process.id) || [] : []).map((m) => m.id));
  for (const u of w.unavoidable) {
    if (sharing.has(u.id)) continue;
    const wanted = solved.dag.processes.has(u.id);
    const line = `this also runs ${u.label} at ${firesAt(u.range)} — ` +
      (wanted ? 'which is a step of this plan anyway'
              : 'no temperature in range avoids it');
    (wanted ? notes.info : notes.danger).push(line);
  }
  return out;
}

/**
 * Which switch would make an unanswerable question answerable.
 *
 * "Nothing allowed can make Charcoal" is true and unhelpful: what the reader
 * needs to know is that *allowed* is a setting, and which one. So the question
 * is put again with each category the plan is not using, and whichever ones
 * come back with an answer are named. Charcoal, Flour and an Egg Shell all
 * want the same one, and it is not guessable from the material.
 *
 * Only on failure, and only over what is switched off -- at most four solves,
 * and a solve that fails is a cheap one because the walk it fails on is small.
 * Forty milliseconds each here against a plan that cannot be drawn at all.
 */
function wouldRescue() {
  if (!askedFor) return [];
  const out = [];
  for (const k of SOURCE_KINDS) {
    if (plan.sources.includes(k.id)) continue;
    const sources = [...plan.sources, k.id];
    if (solveFresh(ctx.graph, { ...askedFor, sources })) {
      out.push({ label: k.label, take: () => edit(toggleSource, k.id) });
    }
  }
  for (const k of PROCESS_KINDS) {
    if (plan.kinds.includes(k.id)) continue;
    const kinds = [...plan.kinds, k.id];
    if (solveFresh(ctx.graph, { ...askedFor, kinds })) {
      out.push({ label: k.label ?? k.id, take: () => edit(toggleKind, k.id) });
    }
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
    warn.append(solved.why ? `. ${solved.why[0].toUpperCase()}${solved.why.slice(1)}.` : '.');
    box.append(warn);

    /**
     * And what to do about it, which the sentence above never said.
     *
     * The old wording ended "try switching on another kind of process under
     * Options", and only when there was no other reason to give -- so the one
     * question that had a specific explanation was the one that lost the
     * pointer. Both belong: what went wrong, then where the switch is.
     */
    const fix = el('div', 'plan-warn plan-fix');

    /**
     * The cap that stopped the search, and an offer to spend more.
     *
     * Starting from nothing the solver may buy one material carrying the
     * answer, and it tries the cheapest few in full because which one leads
     * anywhere is not a thing a rule can name. Each is another whole solve --
     * Lithium Oxide is 42ms at six and 355ms at twelve -- so it stops, says
     * where it stopped, and lets the reader decide whether to pay for more.
     */
    const reach = askedFor ? oreReach(ctx.graph, askedFor) : null;
    if (reach && reach.all > reach.tried) {
      const next = Math.min(plan.oreTries * 2, ORE_TRIES_MAX, reach.all);
      fix.append(`Only the ${reach.tried} cheapest of ${reach.all} ores that could ` +
                 'start this were tried. ');
      fix.append(button('ghost small', `Try ${next}`,
        `Each one is another whole solve, so this will take longer`,
        () => edit(setPlanOption, 'oreTries', next)));
      fix.append(' — or ');
    }

    const helps = wouldRescue();
    if (helps.length) {
      fix.append('there is a plan if you allow ');
      helps.forEach((h, i) => {
        if (i) fix.append(i === helps.length - 1 ? ' or ' : ', ');
        fix.append(button('ghost small', h.label, `Switch on ${h.label} and plan again`, h.take));
      });
      fix.append(' — these and the rest are under ');
    } else {
      fix.append('what the plan may use and how it may work is under ');
    }
    fix.append(button('ghost small', 'Options', 'What the plan may use', () => {
      $('#plan-options').hidden = false;
      $('#toggle-plan-options').setAttribute('aria-pressed', 'true');
    }));
    box.append(fix);
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

  /**
   * Which steps are the reason the plan comes in the batch it does.
   *
   * The batch is the lowest common multiple of what the run counts would
   * otherwise be fractions of, so a step whose count divides by it cleanly was
   * never the cause -- one order takes a whole number of those either way. The
   * ones that do not divide are the whole of the reason, and there are usually
   * very few: the Tantalum plan runs twenty-one steps four times over because
   * of exactly one of them, the water electrolysis, which would have to run
   * three and a quarter times for a single order.
   *
   * Sparr: water is where this lands most often. Splitting it takes two at a
   * time, it is the compound most reactors recycle, and a loop that comes out
   * odd has to go round twice before the electrolysis has a whole pair to work
   * on.
   *
   * The same multiple reaches the reader by two different routes and the note
   * belongs on both. Unbalanced, it is `scale` and the goal bar still says one
   * -- balanced, `scale` is one because the multiple was folded into the
   * amounts instead, and the reader is looking at a goal bar that says four
   * without being told why. Multiplying the two gives the batch whichever way
   * the question was put. Where balancing has moved the targets unequally --
   * Lepidolite comes out at 2/2/2/3 because that is the ratio in the ore --
   * the smallest of the moves is the one the whole plan made.
   */
  const asked = new Map(plan.targets.map((t) => [t.name, t.amount]));
  let times = rat(1);
  for (const t of shownTargets) {
    const was = asked.get(t.name);
    if (!was) continue;
    const grew = rdiv(rat(t.amount), rat(was));
    if (rcmp(grew, times) > 0 && (times.n === 1n && times.d === 1n)) times = grew;
    else if (rcmp(grew, times) < 0 && rcmp(grew, rat(1)) > 0) times = grew;
  }
  const batch = rmul(solved.scale, times);
  const multiplied = batch.d === 1n && batch.n > 1n;

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
    // Reactions on the same feed are tried in turn and one wins each tick, so
    // the feed is divided between them whether you wanted it or not.
    if (step.share) {
      const note = el('div', 'step-share');
      note.append(`${step.share.k} in ${step.share.of} of the ${
        step.process.consumes[0]?.name ?? 'feed'} goes this way`);
      // Every rival is a step of its own here, so the rest of the feed is
      // accounted for on rows the reader can see.
      note.append(' — the rest runs the other reactions below');
      if (step.share.rounded) note.append(' (roughly)');
      what.append(note);
    }
    const notes = { info: [], warn: [], danger: [] };
    what.append(conditions(step, notes));
    tr.append(what);

    const acts = el('td', 'step-acts');
    // What this step is in the plan to make, as against what it also throws
    // off. The constructive action first: banning a step one at a time until
    // the solver lands on something you like is not choosing, and the
    // inspector was no use to anyone who did not think to click the output.
    const made = step.process.produces
      .map((o) => o.name)
      .find((n) => solved.dag.materials.get(n)?.producer === step.process.id);

    /**
     * A step that is here so a charge does not have to be.
     *
     * It makes something the plan hands back from somewhere else too, so it
     * sits on a loop that could have been started with a charge instead --
     * and the solver decided the step was the better of the two. Worth saying,
     * since a step that looks redundant is not.
     *
     * There was a button beside this offering the other way round: drop the
     * step, lay some in once. It wrote `credit`, which the solver that
     * survives does not read -- it feeds every spare output back regardless --
     * so it went with the solver that did.
     */
    if (made && solved.brokenLoops.includes(made)) {
      const why = el('div', 'step-loop');
      why.append(`here so the ${ctx.db.byName.get(made)?.display ?? made} ` +
                 'does not have to be laid in');
      what.append(why);
    }
    if (multiplied) {
      const each = rdiv(step.runs, batch);
      if (each.d !== 1n) {
        /**
         * What this step forces, not what the batch happens to be.
         *
         * Saying "the plan runs four times over" on every step that does not
         * divide is true and misleading: on the Tantalum plan nine steps do
         * not divide, and eight of them only ever needed two. The step that
         * takes the batch from two to four is the one whose share is a
         * quarter, and it should be the one that says so.
         */
        notes.info.push(`one order would take ${rstr(each)} of these, so the batch ` +
          `has to be a multiple of ${each.d}` +
          (each.d === batch.n ? `, which is what sets it at ${rstr(batch)}` : ''));
      }
    }
    /**
     * One flag per kind, and nothing at all when there is nothing to say.
     *
     * The word rather than a glyph, because a coloured dot beside a reaction
     * reads as part of the chemistry. Pressing one opens its lines underneath
     * in the colour they used to be written in; pressing again shuts them.
     * Each flag opens only its own kind, so a plan with a danger to read is
     * not also unfolding the arithmetic behind the batch.
     *
     * No tooltip. It held the same words the button now writes out, and a
     * control that says one thing on hover and the same thing on press is
     * offering the reader a choice that is not worth making -- the hover also
     * arrives on its own schedule, cannot be styled, and never appears at all
     * for anyone reaching the button by keyboard.
     */
    const flags = el('div', 'step-flags');
    const panels = [];
    for (const [kind, label, lines] of [['info', 'info', notes.info],
                                        ['warn', 'warning', notes.warn],
                                        ['danger', 'danger', notes.danger]]) {
      if (!lines.length) continue;
      const panel = el('div', `step-note step-note-${kind}`);
      for (const line of lines) panel.append(el('div', 'step-note-line', line));
      panel.hidden = true;
      const flag = button(`step-flag step-flag-${kind}`, label, null, () => {
        panel.hidden = !panel.hidden;
        flag.setAttribute('aria-expanded', String(!panel.hidden));
        flag.classList.toggle('open', !panel.hidden);
      });
      flag.setAttribute('aria-expanded', 'false');
      flags.append(flag);
      panels.push(panel);
    }
    if (panels.length) what.append(flags, ...panels);
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
/**
 * What you have, taken apart, and what could be put back together from it.
 *
 * Sparr: with just a have and no want, a list of steps is not useful. It was
 * the wrong answer to a fair question -- naming something you hold is asking
 * "what is this good for", and a hundred and fifty reactions that happen to
 * take it is not an answer, it is the search space.
 *
 * So: the elements the haves are made of, and then everything that can be
 * built out of nothing but those. Pick one and it becomes a want, which is a
 * question the planner can actually answer; the leftovers of that plan can
 * then be claimed with "Keep it" to make them outputs too.
 *
 * Only things something can make, which is what turns a list of 54 into a list
 * of 30 -- the rest are walls, debris and bits of blender that share an
 * element by accident and no recipe with anything.
 */
function renderMakeable() {
  const box = $('#plan-steps');
  const table = composition(ctx.graph);
  const held = plan.have.filter((n) => table.get(n)?.elements?.size);

  const symbols = new Set();
  for (const n of held) for (const el of table.get(n).elements) symbols.add(el);

  const head = el('div', 'plan-steps-head plan-uses-head');
  head.append(el('h2', null, symbols.size
    ? `What ${listed(held.map((n) => ctx.db.byName.get(n)?.display ?? n))} is made of`
    : 'Nothing here has a formula to take apart'));
  head.append(el('span', 'muted', 'or name something to make, above'));
  box.append(head);
  if (!symbols.size) return;

  /**
   * The elements themselves first, in the order the table puts them.
   *
   * Each is a material in its own right, and the shortest possible answer to
   * "what could I get out of this".
   *
   * Chosen together rather than one at a time. Sparr: make them toggles, then
   * a button to send the lot. Asking for the potassium and the lithium out of
   * one ore is a single decision -- the plan that makes both is not the plan
   * that makes either -- so pressing them one by one would re-plan in between
   * and answer a different question each time.
   */
  for (const sym of [...elementPicks]) if (!symbols.has(sym)) elementPicks.delete(sym);

  const elements = el('div', 'make-row');
  const send = button('ghost small make-send', '', 'Add every element you have picked', () => {
    const names = [...elementPicks].map((sym) => ctx.db.elementBySymbol.get(sym)?.mat)
      .filter((n) => n && ctx.db.byName.has(n));
    elementPicks = new Set();
    edit(addTargets, names);
  });
  const label = el('span');
  send.append(label);
  const refresh = () => {
    label.textContent = elementPicks.size
      ? `Make ${elementPicks.size === 1 ? 'it' : `these ${elementPicks.size}`}`
      : 'Pick the ones you want';
    send.disabled = !elementPicks.size;
  };
  for (const e of ctx.db.elements) {
    if (!symbols.has(e.sym) || !e.mat || !ctx.db.byName.has(e.mat)) continue;
    const chip = button('make-chip make-element' + (elementPicks.has(e.sym) ? ' on' : ''),
                        '', `Make ${e.name} too`, () => {
      if (elementPicks.has(e.sym)) {
        elementPicks.delete(e.sym);
        chip.classList.remove('on');
      } else {
        elementPicks.add(e.sym);
        chip.classList.add('on');
      }
      refresh();
    });
    chip.append(el('span', 'make-sym', e.sym));
    chip.append(el('span', 'make-name', e.name));
    elements.append(chip);
  }
  elements.append(send);
  refresh();
  box.append(elements);

  /**
   * Then everything made of those and nothing else.
   *
   * Not "everything containing them": a compound that also wants carbon is a
   * bigger question than the one being asked, and belongs to a different set
   * of haves.
   */
  const inside = (name) => {
    const has = table.get(name)?.elements;
    if (!has || !has.size) return false;
    for (const el of has) if (!symbols.has(el)) return false;
    return true;
  };
  const makeable = (name) => ctx.graph.producers(name)
    .some((p) => plan.kinds.includes(p.kind));
  const made = ctx.db.materials
    .filter((m) => !m.hidden && !plan.have.includes(m.name) &&
                   !ctx.db.elements.some((e) => e.mat === m.name) &&
                   inside(m.name) && makeable(m.name))
    .sort((a, b) => (a.display ?? a.name).localeCompare(b.display ?? b.name));

  box.append(el('h2', 'plan-make-head', made.length
    ? `${made.length} thing${made.length === 1 ? '' : 's'} made of nothing else`
    : 'Nothing else is made of only those'));
  if (!made.length) return;
  const list = el('div', 'make-row');
  for (const m of made) {
    // One press each: a compound is a whole answer on its own, and asking for
    // two of them at once is a question for the plan you get from the first.
    list.append(button('make-chip', m.display ?? m.name,
                       `Plan a way to make ${m.display ?? m.name}`,
                       () => edit(addTarget, m.name)));
  }
  box.append(list);
}

/* ------------------------------------------------------------------- side */

/** How many routes to show before the list has to be asked for in full. */
const ROUTES_SHOWN = 6;
let allRoutes = false;

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
  const mineBtn = button('route-pick', '', has ? 'Stop treating this as available'
                                               : 'Treat this as available and plan no further',
                         () => edit(has ? removeHave : addHave, name, true));
  mineBtn.append(el('span', 'kind-glyph', '\u2713'));
  mineBtn.append(el('span', 'route-label', has ? 'You have it' : 'I have it'));
  mineBtn.append(el('span', 'route-from', 'nothing to make, nothing to fetch'));
  mine.append(mineBtn);
  list.append(mine);

  if (routes.length) {
    /**
     * The ways to get it, to read rather than to choose between.
     *
     * Sparr: this goes the same way as "Get rid of it", and gets a new
     * interface later. Choosing a route by hand is another way of saying
     * "show me a different plan", and the place to ask that is where whole
     * plans are compared -- by what they fetch, what they need laying in and
     * what they leave -- not one row of one material's inspector. "Let the
     * planner choose" went with them, being the undo for a choice that can no
     * longer be made.
     *
     * The list stays. What each route costs, what it needs, and how much of
     * that is already to hand is worth knowing whether or not you can press
     * it, and it is still the thing that says which way the plan went.
     */
    const head = allRoutes ? routes : routes.slice(0, ROUTES_SHOWN);
    // A route you ruled out sorts last, so with 153 of them it falls off the
    // end and takes the only way to take it back with it. It comes along
    // whatever the cut.
    const shown = allRoutes ? head
      : [...head, ...routes.filter((r) => r.banned && !head.includes(r))];
    for (const r of shown) {
      const li = el('li', 'route-opt' + (r.chosen ? ' on' : '') +
                          (r.banned ? ' banned' : ''));
      const pick = el('div', 'route-read');
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
      /**
       * There was a second thing a route could be: not how the material is
       * made, but a use for what the plan was already throwing away, run on
       * the spare and no further.
       *
       * It wrote `alsoUse`, and the surviving solver never read it -- it
       * stored the field and hashed it into a cache key and nothing else, so
       * pressing the button relabelled a plan it could not alter. The
       * instruction it carried is this solver's default: every spare output is
       * fed back already. Which is also why the offer had stopped appearing --
       * it wanted a route the plan could feed from its own leavings *without*
       * having chosen it, and here that route is the chosen one.
       */
      const acts = el('div', 'route-acts');
      // A rejected route sorts to the bottom and is otherwise inert, so this
      // is where it can be taken back. Picking it would only pin a process the
      // planner is not allowed to use.
      if (r.banned) {
        acts.append(button('ghost small on', 'Ruled out', 'Let the planner use this again',
                           () => edit(toggle, 'excludeProcesses', r.process.id)));
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
      /**
       * What it is being fetched *for*, as links you can go and press on.
       *
       * "Six Lepidolite" tells you nothing you can act on. The plan wants it
       * for the potassium oxide and the hydrogen fluoride it decomposes into,
       * and those are where "Other ways" and "I have it" would actually bite --
       * so they are named here, and each one goes straight to its own inspector.
       */
      if (f.feeds.length) {
        const why = el('div', 'plan-how');
        why.append('for ');
        f.feeds.forEach((name, i) => {
          if (i) why.append(i === f.feeds.length - 1 ? ' and ' : ', ');
          why.append(matLink(name));
        });
        li.append(why);
      }
      /**
       * How the world hands this over, for the kinds this plan will not use.
       *
       * The solver's `routes` are the other ways it could have made the thing
       * *within the kinds it is allowed* -- mining is not one of them, so an
       * ore comes back with none and the row would only say "found in the
       * world". Which deposit it comes out of is the useful half of that, and
       * the graph knows it whether or not the plan may run it.
       */
      const dug = f.routes.length ? f.routes[0]
        : ctx.graph.producers(f.name).find((p) => p.kind === 'mine' || p.kind === 'handling');
      if (dug) {
        const how = el('div', 'plan-how');
        how.append(`${KIND.get(dug.kind)?.glyph || ''} ${dug.label}`);
        li.append(how);
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
      /**
       * Sparr: refusing a material steers a plan better than refusing a step.
       *
       * "Never use it" is next door in the inspector and is a bigger hammer:
       * it deletes every step that touches the thing, so the plan can neither
       * make it nor spend it. This one only shuts the shop door. The plan is
       * free to make its own and put it straight back in, which is usually
       * what a reader staring at a shopping list actually wants.
       *
       */
      acts.append(button('ghost small', 'Not this one',
                         `Plan without buying ${f.name}, though it may still be made along the way`,
                         () => edit(toggle, 'noFetch', f.name)));
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
  const ruledFetch = plan.noFetch;
  const ruledPrime = plan.noPrime;
  const ruled = ruledProcesses.length + ruledMaterials.length
    + ruledFetch.length + ruledPrime.length;
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
    for (const [field, names, how, back] of [
      ['excludeMaterials', ruledMaterials,
       'this material, kept out of the plan entirely', 'Let the planner use this again'],
      ['noFetch', ruledFetch,
       'not bought — the plan may still make some', 'Let the plan buy this again'],
      ['noPrime', ruledPrime,
       'not laid in — the plan must start some other way', 'Let the plan start with this again'],
    ]) {
      for (const name of names) {
        const li = el('li', 'plan-item');
        li.dataset.material = name;
        const line = el('div', 'plan-item-main');
        line.append(matLink(name));
        li.append(line);
        li.append(el('div', 'plan-how', how));
        const acts = el('div', 'plan-item-acts');
        acts.append(button('ghost small', 'Allow it', back,
                           () => edit(toggle, field, name)));
        li.append(acts);
        ul.append(li);
      }
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
      /**
       * One thing to say about a charge: not this one.
       *
       * There were two more. "Make it instead" added a step that made the
       * material rather than taking it off the loop, and "Stop recycling it"
       * dropped the route that needed the charge in the first place. Both
       * wrote fields only the old solver read -- it feeds every spare output
       * back and lays a charge in wherever a loop needs one, whatever it is
       * told -- so they went with it.
       */
      const acts = el('div', 'plan-item-acts');
      acts.append(button('ghost small', 'Not this one',
                         `Start the plan with something other than ${item.name}`,
                         () => edit(toggle, 'noPrime', item.name)));
      li.append(acts);
      ul.append(li);
    }
    prime.append(ul);
    box.append(prime);
  }

  /**
   * What the plant lays in for itself, which is not a shopping list at all.
   *
   * Sparr: the Carbon should be acquirable through the Dolomite and Carbonated
   * Water chain, so stop asking for it.
   *
   * It is, and it stopped. But withholding it still costs four aluminium the
   * first time round while the carbon loop fills, and a plan that quietly
   * makes less than it says it makes would be worse than one that asks for
   * something it need not. So the reader is not sent out for these, and is
   * told what the first cycle costs -- which on a plant that keeps running is
   * a one-off and on a single batch is the whole of it.
   */
  if (solved.warmup?.length) {
    const warm = el('section', 'plan-panel warmup');
    const title = el('h2', null, 'It gets going by itself on');
    title.title = 'The plan makes all of this out of what you already put in, so it is '
      + 'not yours to find. It just does not have any until it has run a little.';
    warm.append(title);
    const ul = el('ul', 'plan-list');
    for (const item of solved.warmup) {
      const li = el('li', 'plan-item');
      li.dataset.material = item.name;
      const line = el('div', 'plan-item-main');
      line.append(el('span', 'amount', amount(item.amount)), ' ', matLink(item.name));
      li.append(line);
      li.append(el('div', 'plan-how', 'made on the way, not fetched'));
      ul.append(li);
    }
    warm.append(ul);
    if (solved.warmupLag > 0) {
      warm.append(el('p', 'plan-note',
        `The first cycle makes ${solved.warmupLag} less than the amounts above while `
        + 'this builds up. Every cycle after that runs on what the plan makes.'));
    }
    box.append(warm);
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
      /**
       * There used to be a third thing you could say about a leftover.
       *
       * "Get rid of it" went looking for a route that ate the thing and built
       * whatever that route needed. Sparr, on being offered it for the newer
       * solver: what he would expect from that button is the next best plan
       * that does not make the leftover at all -- which is a different
       * question, and one a single button on one row is the wrong shape for.
       * Asking it properly means comparing whole plans by what they fetch,
       * what they need laying in and what they leave, and the comparison
       * scoreboard is already that interface. So the button goes rather than
       * being taught, and the choice moves to where the alternatives are.
       *
       * `consume` stays in the question: old links carry it and the older
       * solver still reads it.
       */
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
const sourceBoxes = new Map();

function renderOptions() {
  const box = $('#plan-kinds');
  if (!kindBoxes.size) {
    for (const k of PROCESS_KINDS) {
      // What a material does at a temperature is not on offer. See `always` in
      // PROCESS_KINDS: a plan told that steam may not become water went three
      // reactions round to do what cooling does by itself.
      if (k.always) continue;
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

  /**
   * And what it may go and fetch, which only the newer solver reads.
   *
   * Hidden while the older one is answering rather than shown greyed: a
   * control that cannot do anything is worse than one that is not there, and
   * the checkbox above says plainly enough which solver is in charge.
   */
  const srcBox = $('#plan-sources');
  if (!sourceBoxes.size) {
    for (const k of SOURCE_KINDS) {
      const label = el('label', 'plan-kind');
      label.title = k.hint;
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => edit(toggleSource, k.id));
      label.append(cb, el('span', 'kind-glyph', k.glyph), el('span', null, k.label));
      srcBox.append(label);
      sourceBoxes.set(k.id, cb);
    }
  }
  for (const [id, cb] of sourceBoxes) cb.checked = plan.sources.includes(id);

  $('#plan-ores').value = String(plan.oreTries);
  $('#plan-leftovers').checked = plan.keepLeftovers;
  $('#plan-avoid').checked = plan.avoidSideEffects;
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
  /**
   * Everything about the question, less the few things that cannot move the
   * amounts.
   *
   * Read off the question rather than listed by hand, because the hand-kept
   * version went stale the moment something was added to it. "Get rid of it"
   * arrived in 0.3.4 and was not in the list, so pressing it kept the amounts
   * worked out before it: the page said one Carbon with a Carbon left over,
   * and the very same address reloaded said two Carbon and nothing left over.
   * A cache that disagrees with a fresh load of its own URL is worse than no
   * cache. Anything added from here on is in the key unless it is named below.
   *
   * `targets` is in by name only -- the amounts are what is being worked out.
   * `kept` is out because it changes nothing about what is made, only whether
   * a surplus is called waste, and re-balancing on it would cost a dozen
   * solves to arrive back where it started.
   */
  const NOT_IN_BALANCE = new Set(['targets', 'kept']);
  const key = JSON.stringify([
    plan.targets.map((t) => t.name),
    ...Object.keys(spec).filter((k) => !NOT_IN_BALANCE.has(k)).sort().map((k) => spec[k]),
  ]);
  if (key !== balancedFor) {
    balancedFor = key;
    balancedTo = balanceTargets(ctx.graph, { ...spec, targets: plan.targets },
                                solveFresh);
  }
  return balancedTo;
}

/* ------------------------------------------------------------------ render */

/* ------------------------------------------------------------------- menu */

/**
 * The same question asked every way the sources allow, side by side.
 *
 * Not run unless asked for. Thirty-one solves is forty-five seconds on the
 * Columbite question, which is a very long time to hold a tab still, so this
 * does one per turn of the event loop and redraws as each lands. The rows
 * appear cheapest-first and settle as the slow combinations come in.
 *
 * Kept against the *question* rather than the plan, because picking a row
 * changes the sources and nothing else: the sweep that produced the menu is
 * still the right sweep, and re-running it because the player took one of its
 * own suggestions would be absurd.
 */
let sweep = null;
let sweepToken = 0;
let askedFor = null;

const questionKey = (ask) => JSON.stringify({
  targets: ask.targets, have: ask.have, kinds: ask.kinds,
  excludeProcesses: ask.excludeProcesses, excludeMaterials: ask.excludeMaterials,
  noFetch: ask.noFetch, noPrime: ask.noPrime, oreTries: ask.oreTries,
  avoidSideEffects: ask.avoidSideEffects, kept: ask.kept, keepLeftovers: ask.keepLeftovers,
});

const menuTools = () => ({
  matter: (name) => ctx.graph.db.byName.get(name)?.matter ?? 1,
  toNumber: rnum,
});

/**
 * What to ask, and in what order.
 *
 * Every combination of sources, and then -- when the plan is starting from
 * nothing and the solver is choosing an ore for it -- one more question per
 * ore it might have chosen. That choice is a real fork and the menu was hiding
 * it: Boron Oxide is one step off Boric Acid or eight off Borax, for less than
 * half the matter, and neither beats the other. The solver picks by its own
 * weighing and the reader never learns the other existed.
 *
 * The ore questions are asked against the sources the plan is already using
 * rather than crossed with all thirty-one, because the cross is thirty-one
 * times eleven and the answer to "which ore" does not usually turn on which
 * sources are switched on.
 */
function sweepQueue(ask) {
  const queue = optionSets([...SOURCES]).map((options) => ({ options }));
  let ores = [];
  try {
    ores = oreCandidates(ctx.graph, withElements(ctx.graph, normalizeFresh(ask)));
  } catch { ores = []; }
  for (const ore of ores) queue.push({ options: [...ask.sources], ore });
  return queue;
}

function startSweep(ask) {
  const token = ++sweepToken;
  sweep = { key: questionKey(ask), ask, entries: [], queue: sweepQueue(ask),
            token, shapes: new Map() };
  const turn = () => {
    if (!sweep || sweep.token !== token) return;      // a newer question won
    const step = sweep.queue.shift();
    if (!step) { sweep.queue = null; renderMenu(); return; }
    const { options, ore } = step;
    /**
     * Two source sets can be the same question wearing different clothes.
     *
     * Every one of the thirty-one makes a different set of materials buyable,
     * but nearly half come out with the same candidate set, the same columns to
     * buy with and the same materials a charge could come from -- because the
     * extra materials are ones no step here would eat. Columbite has sixteen
     * real questions in its thirty-one, and asking the other eight again gets
     * the same answer more slowly.
     */
    let answer = null;
    const asked = { ...ask, sources: options, ...(ore ? { oreAllowed: [ore] } : {}) };
    // The shape says two source sets are the same question. It knows nothing
    // about which ore may be bought, so an ore question is never served from it.
    const shape = ore ? null : questionShape(ctx.graph, asked);
    if (shape !== null && sweep.shapes.has(shape)) {
      answer = sweep.shapes.get(shape);
    } else {
      try {
        answer = solveFresh(ctx.graph, asked);
      } catch { answer = null; }                      // a combination that cannot: a row of its own
      if (shape !== null) sweep.shapes.set(shape, answer);
    }
    sweep.entries.push({ options, ore, plan: answer });
    renderMenu();
    setTimeout(turn, 0);
  };
  setTimeout(turn, 0);
}

const sameSources = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function menuRow(row, table) {
  const tr = el('tr', 'menu-row');
  const isOre = !!row.ore;
  const oreNow = plan.oreAllowed.length === 1 && plan.oreAllowed[0] === row.ore;
  if (sameSources(row.via[0], plan.sources) && (isOre ? oreNow : !plan.oreAllowed.length)) {
    tr.classList.add('is-current');
  }
  for (const score of SCORES) {
    const td = el('td', 'menu-num', String(Math.round(row[score.id] * 100) / 100));
    if (row.best.includes(score.id)) td.classList.add('is-best');
    tr.append(td);
  }
  const via = el('td', 'menu-via');
  /**
   * A row is reached either by which sources are on or by which ore is bought,
   * and it says which. The ore rows all share the sources the plan is already
   * using, so naming those again would be noise; what distinguishes them is
   * the thing on the shopping list.
   */
  const label = row.ore
    ? `buy ${ctx.db.byName.get(row.ore)?.display ?? row.ore}`
    : row.via[0].map((id) => SOURCE_KINDS.find((k) => k.id === id)?.label ?? id).join(' + ');
  const pick = button('link', label, `Switch the plan to ${label}`,
                      () => setPlan(row.ore
                        ? { ...plan, sources: [...row.via[0]], oreAllowed: [row.ore] }
                        : { ...plan, sources: [...row.via[0]], oreAllowed: [] }));
  via.append(pick);
  if (row.via.length > 1) {
    via.append(el('span', 'menu-also', ` and ${row.via.length - 1} other way${row.via.length > 2 ? 's' : ''}`));
  }
  /**
   * Every row says why it is here, including the ones that win nothing.
   *
   * A plan can be on the menu without being the best at anything: this one
   * takes fewer reactors than the cheaper row above it and fewer atoms than
   * the shorter-list row below, so neither beats it, and it is the compromise
   * between them. Sparr found one of those and it had no caption at all, which
   * reads as an oversight rather than as the answer it is.
   */
  via.append(el('div', 'menu-best', row.best.length
    ? `best on ${listed(row.best.map((id) => SCORES.find((s) => s.id === id).label))}`
    : 'a compromise — nothing here beats it outright'));
  tr.append(via);
  table.append(tr);
}

function renderMenu() {
  const key = askedFor ? questionKey(askedFor) : null;
  // A sweep for a question nobody is asking any more. Dropping it is not
  // tidiness: `turn` reschedules itself, so without this it would go on
  // solving the old question thirty times over behind a menu that will never
  // be shown.
  if (sweep && sweep.key !== key) { sweepToken++; sweep = null; }

  const box = $('#plan-menu');
  const show = plan.targets.length > 0;
  box.hidden = !show;
  if (!show) return;

  const run = $('#plan-menu-run');
  const status = $('#plan-menu-status');
  const body = $('#plan-menu-body');
  const shut = $('#plan-menu-close');
  const mine = sweep && sweep.key === key;
  // Nothing to put away until there is something on the table.
  shut.hidden = !mine;
  const running = mine && sweep.queue !== null;

  run.textContent = running ? 'Stop' : (mine ? 'Compare again' : 'Compare options');
  run.disabled = false;

  if (!mine) {
    body.textContent = '';
    status.textContent = 'Thirty-one ways to answer this, scored side by side. It takes a moment.';
    return;
  }

  const { menu, distinct, barren } =
    digest(sweep.entries, menuTools(), { keepLeftovers: plan.keepLeftovers });
  const done = sweep.entries.length;
  status.textContent = running
    ? `${done} of 31 tried…`
    : `${distinct} different answer${distinct === 1 ? '' : 's'} from 31 ways of asking` +
      (barren.length ? `; ${barren.length} found no route at all` : '');

  body.textContent = '';
  if (!menu.length) {
    body.append(el('p', 'menu-none', running ? 'Working…' : 'No combination of sources can answer this.'));
    return;
  }
  const table = el('table', 'menu-table');
  const head = el('tr');
  for (const score of SCORES) {
    const th = el('th', 'menu-num', score.short);
    th.title = score.hint;
    head.append(th);
  }
  head.append(el('th', 'menu-via', 'may fetch'));
  table.append(head);
  for (const row of menu) menuRow(row, table);
  body.append(table);
  body.append(el('p', 'menu-note',
    'Nothing here beats anything else outright: every row is better than every ' +
    'other at something. Most are the best answer at something too, and say so. ' +
    'Numbers are per unit of what you asked for.'));
}

export function render() {
  const empty = isEmptyPlan(plan);
  $('#plan-empty').hidden = !empty;
  $('#plan-work').hidden = empty;
  $('#toggle-plan-options').hidden = false;
  renderOptions();
  if (empty) { solved = null; return; }

  const question = {
    have: plan.have,
    excludeProcesses: plan.excludeProcesses,
    excludeMaterials: plan.excludeMaterials,
    noFetch: plan.noFetch,
    noPrime: plan.noPrime,
    kept: plan.kept,
    kinds: plan.kinds,
    oreTries: plan.oreTries,
    avoidSideEffects: plan.avoidSideEffects,
    // In the question, not bolted on after: the amounts are balanced from this
    // object, and a key built from it could not see a change of sources.
    sources: plan.sources,
    keepLeftovers: plan.keepLeftovers,
    // Empty is the usual case and means the solver picks; a row of the menu
    // having been pressed is what puts one here.
    ...(plan.oreAllowed.length ? { oreAllowed: plan.oreAllowed } : {}),
  };
  shownTargets = targetsFor(question);

  // The fresh solver answers the same question a different way; it fills in
  // enough of the same shape for everything below to render it.
  const ask = { ...question, targets: shownTargets, sources: plan.sources };
  askedFor = ask;
  {
    /**
     * The comparison already solved this one, so do not solve it again.
     *
     * Sparr: choosing a row from the scoreboard pauses -- is it re-running the
     * solver on the plan it just showed me? It was. Every row of that table is
     * a solved plan the sweep is still holding, and picking one changes the
     * sources and nothing else, which is exactly the difference the sweep
     * enumerated. So the answer is already in hand and the wait was for
     * arithmetic that had been done.
     */
    const ready = sweep && sweep.key === questionKey(ask) &&
      sweep.entries.find((e) => e.plan && sameSources(e.options, plan.sources));
    // It says null when it cannot answer, and says why if asked. The page has
    // to render something either way, so an empty plan carries the reason.
    const notes = [];
    solved = (ready && ready.plan) || solveFresh(ctx.graph, { ...ask, notes })
      || blankFresh(ctx.graph, ask, notes.find((n) => !n.startsWith('spoils')) || null);
  }

  renderGoals();
  // With nothing named to make, the question is "what can I do with this?"
  $('#plan-steps').textContent = '';
  if (plan.targets.length) renderSteps(); else renderMakeable();
  renderSide();
  renderMenu();
  renderPicture();
}

/**
 * The plan as a picture, when the reader asks for one.
 *
 * Drawn only while it is open: it costs a layout and a few hundred frames of
 * settling, which is nothing beside a solve but is pure waste on a page nobody
 * is looking at. Torn down on the way out so the springs stop with it.
 */
let picture = null;
let showPicture = false;
let acrossPicture = false;
let materialNodes = false;
function renderPicture() {
  const host = $('#plan-picture');
  host.hidden = !showPicture || !solved;
  if (picture) { picture.stop(); picture = null; }
  if (host.hidden) return;
  picture = drawPlan($('#plan-picture-canvas'), solved, {
    onPick: (name) => edit(selectMaterial, name),
    across: acrossPicture,
    materials: materialNodes,
  });
}

/** Open or shut the picture, from the button in the bar. */
export function togglePicture() {
  showPicture = !showPicture;
  $('#toggle-plan-picture').setAttribute('aria-pressed', String(showPicture));
  renderPicture();
}

/** The solved plan, for the console and the tests. */
export const lastSolved = () => solved;

/* -------------------------------------------------------------------- boot */

export function initPlan(context) {
  ctx = context;

  $('#plan-leftovers').addEventListener('change', () =>
    edit(setOption, 'keepLeftovers', $('#plan-leftovers').checked));

  /**
   * Putting the comparison away, rather than hiding the whole panel.
   *
   * The rows go and the offer stays, so the same question can be asked again
   * without hunting for where the button went. A sweep still running is
   * stopped: it would go on solving into a table nobody is looking at.
   */
  $('#plan-menu-close').addEventListener('click', () => {
    sweepToken++;
    sweep = null;
    renderMenu();
  });

  $('#plan-menu-run').addEventListener('click', () => {
    const running = sweep && askedFor && sweep.key === questionKey(askedFor) && sweep.queue !== null;
    // Stopping keeps what has come back so far: half a menu is still a menu,
    // and the rows that arrive first are the cheap ones.
    if (running) { sweep.queue = null; renderMenu(); return; }
    startSweep(askedFor);
    renderMenu();
  });

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
  // Typed rather than ticked, since the useful answers are not two.
  $('#plan-ores').addEventListener('change', (e) => {
    const n = Math.round(Number(e.target.value));
    if (Number.isFinite(n) && n > 0) edit(setOption, 'oreTries', Math.min(n, ORE_TRIES_MAX));
    else e.target.value = String(plan.oreTries);
  });
  $('#toggle-plan-picture').addEventListener('click', togglePicture);
  // Rows or columns, since a plan is a long thin thing and a page scrolls down.
  // Reactions with the materials written on the arrows, or a node for each.
  $('#plan-picture-materials').addEventListener('click', () => {
    materialNodes = !materialNodes;
    $('#plan-picture-materials').setAttribute('aria-pressed', String(materialNodes));
    renderPicture();
  });
  $('#plan-picture-turn').addEventListener('click', () => {
    acrossPicture = !acrossPicture;
    $('#plan-picture-turn').setAttribute('aria-pressed', String(acrossPicture));
    renderPicture();
  });
  $('#toggle-plan-options').addEventListener('click', () => {
    const open = $('#plan-options').hidden;
    $('#plan-options').hidden = !open;
    $('#toggle-plan-options').setAttribute('aria-pressed', String(open));
  });
}
