/**
 * The two modes, and the plan pane, driven headlessly.
 *
 * What is worth testing here is not what anything looks like -- the shim knows
 * no CSS -- but the two claims the shell makes: that switching modes loses
 * nothing, and that a link carries both halves of the state whichever half you
 * were looking at when you copied it.
 */
import { readFileSync } from 'node:fs';
import { installDom, idsWithHidden } from './dom-shim.mjs';
import { emptyPlan, addTarget, addHave, removeTarget,
         readPlan, writePlan } from '../src/plan-state.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
installDom(idsWithHidden(html));

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

await import('../src/main.js');
await new Promise((r) => setTimeout(r, 0));

/**
 * Nothing the page always shows is left hidden in the markup.
 *
 * The shim builds its DOM from the ids in `index.html` and reads no
 * attributes, so an element marked `hidden` there looks perfectly visible to
 * every test in this file. The source categories were hidden in the markup and
 * unhidden by a line that only ran for the newer solver; when that line went
 * with the older solver, the boxes vanished from the real page and the whole
 * suite stayed green. Checked as text, since that is the only place it shows.
 */
const alwaysShown = ['plan-sources'];
for (const id of alwaysShown) {
  const tag = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
  if (/\bhidden\b/.test(tag)) {
    console.log(`FAIL  #${id} is hidden in the markup and nothing unhides it: ${tag}`);
    process.exit(1);
  }
}

const app = globalThis.window.explorer;
if (!app) { console.log('FAIL boot did not complete'); process.exit(1); }

let fail = 0;
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => { console.log(`FAIL  ${msg}`); fail++; };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

const $ = (sel) => document.querySelector(sel);
/**
 * The grown things, switched on.
 *
 * The old planner had no notion of where a material comes from and would fetch
 * anything. The one that survives asks, and its default set is what the world
 * hands over -- dug up, fallen from the sky, out of the air -- with the farm
 * and the workshop left off. Vinegar is a mushroom and a grain of wheat, so
 * every plan here that wants one says so.
 */
const FARMED = ['world', 'weather', 'air', 'farm'];
const farming = (p) => ({ ...p, sources: FARMED });
const nodes = (root, cls) => [...root.walk()].filter((n) => n.classList.contains(cls));
const text = (sel) => $(sel).textContent;
const goals = () => text('#goal-targets') + ' ' + text('#goal-haves');

console.log(`booted with ${app.db.materials.length} materials and ` +
            `${app.graph.processes.length} processes\n`);

/* ------------------------------------------------------------------ modes */

console.log('--- switching ---');
check(!$('#explore-main').hidden && $('#plan-main').hidden, 'it opens in explore mode');

app.setMode('plan');
check($('#explore-main').hidden && !$('#plan-main').hidden, 'the plan pane takes over');
check($('#explore-bar').hidden && !$('#plan-bar').hidden, 'and the search box gives way to it');
check($('#mode-plan').getAttribute('aria-selected') === 'true', 'the tab says which is showing');
check(!$('#plan-empty').hidden && $('#plan-work').hidden,
      'an empty plan offers the two ways to start rather than an empty table');

app.setMode('explore');
check(!$('#explore-main').hidden, 'and back');

/* --------------------------------------------------- nothing is lost -----*/

console.log('\n--- switching loses nothing ---');
app.setQuery('el:Au state:solid');
app.select(app.db.byName.get('Gold'));
const before = text('#results');
app.setMode('plan');
app.setMode('explore');
check(text('#results') === before, 'the result list is not rebuilt, so it cannot lose its place');
check($('#q').value === 'el:Au state:solid', 'the query survives the round trip');
check(text('#detail').includes('Gold'), 'so does the selected material');

/* ------------------------------------------------------------- planning --*/

console.log('\n--- a plan ---');
app.setPlan(farming(addTarget(emptyPlan(), 'Vinegar')));
app.setMode('plan');
check($('#plan-empty').hidden && !$('#plan-work').hidden, 'a plan with a target shows the table');

/**
 * Every side reaction says when it would happen, since a step may dodge
 * several and only one of them explains the limit it ended up with.
 *
 * These are behind the step's flags now rather than written down the side of
 * it, so the text is read off the hover. Which flag a line sits under is part
 * of what is being checked: a hazard the step dodges is a warning, one it
 * cannot dodge is a danger, and one the plan was going to run anyway is
 * neither.
 */
const said = (kind) => nodes($('#plan-steps'), `step-note-${kind}`)
  .flatMap((n) => nodes(n, 'step-note-line').map((l) => l.textContent));
check(nodes($('#plan-steps'), 'step-flag').every((n) => !n.getAttribute('title')),
      'a flag carries no tooltip, since pressing it says the same thing');
check(nodes($('#plan-steps'), 'step-flag').length ===
      nodes($('#plan-steps'), 'step-note').length,
      'and every flag has a panel of its own to open');
/**
 * And pressing one writes it out under the step.
 *
 * Hovering is the glance; pressing is for reading it beside the reaction while
 * looking at something else. Shut until asked, open on the press, shut again
 * on the next -- and only the flag pressed, so opening a danger does not also
 * unfold the arithmetic behind the batch.
 */
{
  const withFlags = nodes($('#plan-steps'), 'plan-step')
    .find((r) => nodes(r, 'step-flag').length > 1);
  const flag = nodes(withFlags, 'step-flag')[0];
  const shown = () => nodes(withFlags, 'step-note').filter((n) => !n.hidden);
  check(shown().length === 0, 'the lines stay shut until a flag is pressed');
  flag.click();
  check(shown().length === 1 && shown()[0].textContent.trim().length > 0,
        'pressing one writes its lines out under the step');
  check(flag.getAttribute('aria-expanded') === 'true', 'and says so for a screen reader');
  check(nodes(withFlags, 'step-flag').filter((f) => f.classList.contains('open')).length === 1,
        'and only the one pressed');
  flag.click();
  check(shown().length === 0, 'pressing it again shuts it');
}
const avoided = said('warn').filter((t) => t.startsWith('avoids '));
check(avoided.length > 0 && avoided.every((t) => /at [≥≤]|at \d|any temperature/.test(t)),
      'each dodged side reaction says at what temperature it would happen');
check(avoided.some((t) => /at ≥|at ≤/.test(t)),
      'as a bound rather than a sentence');
const also = [...said('danger'), ...said('info')].filter((t) => t.startsWith('this also runs'));
check(also.every((t) => /°C|any temperature/.test(t)),
      'so does one that cannot be dodged');
check(also.some((t) => /a step of this plan|no temperature in range/.test(t)),
      'and it says why it could not be');
check(said('danger').every((t) => !/a step of this plan/.test(t)),
      'and a side reaction the plan wanted anyway is not called a danger');

const steps = nodes($('#plan-steps'), 'plan-step');
check(steps.length === 5, `Vinegar comes out as ${steps.length} steps`);
{
  // A run is a whole thing, so a plan that would need half of one is multiplied
  // up -- and has to say what that leaves you with, since the goal bar still
  // says what you asked for.
  const one = addHave(addTarget(emptyPlan(), 'Potassium'), 'Lepidolite');
  app.setPlan({ ...one, balance: false });
  const head = text('#plan-steps');
  check(head.includes('one batch makes 2 Potassium'),
        `a doubled plan says what a batch makes: ${head.slice(0, 60).trim()}`);
  // Balanced, the goal bar says 2 in the first place and there is nothing to
  // explain -- which is most of the point of it being on.
  app.setPlan(one);
  // The amount lives in an input, so it is read rather than scraped.
  const asked = nodes($('#goal-targets'), 'goal-amount')[0];
  check(asked?.value === '2' && !text('#plan-steps').includes('one batch makes'),
        `and balanced, it simply asks for the 2 it was always going to make: ${asked?.value}`);
  app.setPlan(farming(addTarget(emptyPlan(), 'Vinegar')));
  check(!text('#plan-steps').includes('one batch makes'),
        'and a plan that comes out whole says nothing about it');
}
check(text('#plan-steps').includes('Acetic Acid'), 'naming the materials along the way');
check(goals().includes('Vinegar'), 'and the goal bar says what it is for');
/**
 * Which spore this asks for is a coin toss between equals.
 *
 * Vinegar wants a spore blended into yeast and several of them do that at the
 * same cost, so which one comes back is down to how a tie inside the solver
 * falls -- it has moved from Death Moss to Ember Crown without the plan
 * getting any better or any worse. What is being tested here is that the thing
 * to fetch is listed, offered, and can be handed over, so the name is read off
 * the list rather than written down.
 */
const spores = () => nodes($('#plan-side'), 'plan-item')
  .filter((n) => (n.dataset.material || '').endsWith('Spore'));
const sporeName = spores()[0]?.dataset.material;
check(!!sporeName, `the side lists what to go and fetch: ${sporeName}`);
// A catalyst belongs on the step that needs it, named once. Not on the
// shopping list, since nothing consumes it, and not repeated in the summary.
check(text('#plan-steps').includes('needs Blender'), 'a catalyst is named on its step');
check(!nodes($('#plan-side'), 'plan-item').some((n) => n.textContent.includes('Blender')),
      'not on the shopping list, since nothing consumes it');
check(!text('#plan-side').includes('needs Blender'),
      'and not said a second time in the summary');

// The frontier's "I have it" is the loop the whole mode is built around.
const haveIt = nodes(spores()[0], 'small').find((b) => b.textContent === 'I have it');
check(!!haveIt, 'each thing to fetch offers "I have it"');
haveIt.click();
check(app.getPlan().have.includes(sporeName), 'pressing it moves the material to have');
check(!spores().some((n) => n.dataset.material === sporeName),
      'and off the shopping list');
check(goals().includes(sporeName), 'into the goal bar');
// And the have row says how much of it the plan actually wants.
check(new RegExp(`1\\s*${sporeName}`).test(text('#goal-haves')),
      `saying how much has to be supplied: ${text('#goal-haves').trim()}`);

// Excluding a step has to change the answer, not just grey something out.
const stepCount = nodes($('#plan-steps'), 'plan-step').length;
const notThis = nodes($('#plan-steps'), 'step-acts')
  .flatMap((a) => a.children).find((b) => b.textContent === 'Not this');
notThis.click();
check(app.getPlan().excludeProcesses.length === 1, '"Not this" bans a process');
check(nodes($('#plan-steps'), 'plan-step').length !== stepCount ||
      text('#plan-steps') !== '', 'and the plan is worked out again around it');

/* ------------------------------------------------------------- adding one */

console.log('\n--- adding a material ---');
{
  app.setPlan(emptyPlan());
  app.setMode('plan');
  // A box on each goal row, so adding to one is not a trip to the top bar and
  // a choice of button afterwards.
  const box = nodes($('#goal-have-add'), 'picker-input')[0];
  check(!!box, 'the have row has a box of its own');
  check(!!nodes($('#goal-make-add'), 'picker-input')[0], 'and so does the make row');

  box.value = 'lepidolite';
  box.dispatch('input');
  const hits = nodes($('#goal-have-add'), 'picker-hit');
  check(hits.length > 0, `typing offers ${hits.length} matches`);
  check(hits[0].classList.contains('on'), 'with the first one already picked out');

  // The row is the button. Finding a small one to the right of the thing you
  // just chose is a second decision where there was only one.
  hits[0].click();
  check(app.getPlan().have.includes('Lepidolite'), 'and clicking the row adds it');
  check(!nodes($('#goal-have-add'), 'picker-hit').length, 'the suggestions close behind it');

  // Arrow keys and Enter do the same without the mouse.
  const make = nodes($('#goal-make-add'), 'picker-input')[0];
  make.value = 'potassium';
  make.dispatch('input');
  make.dispatch('keydown', { key: 'ArrowDown' });
  const second = nodes($('#goal-make-add'), 'picker-hit')[1];
  check(second.classList.contains('on'), 'arrow keys move down the list');
  make.dispatch('keydown', { key: 'Enter' });
  check(app.getPlan().targets.length === 1, 'and Enter takes the one that is picked out');
  make.value = 'x';
  make.dispatch('input');
  make.dispatch('keydown', { key: 'Escape' });
  check(!nodes($('#goal-make-add'), 'picker-hit').length, 'Escape puts them away');
}

/* --------------------------------------------------------- the other way */

console.log('\n--- what you can make from what you have ---');
{
  /**
   * Sparr: a list of steps is not useful here.
   *
   * It was the wrong answer to a fair question. Naming something you hold
   * asks "what is this good for", and a hundred and fifty reactions that
   * happen to take it is not an answer, it is the search space. What the
   * elements allow is an answer, and every row of it is a want you could ask
   * for.
   */
  app.setPlan(addHave(emptyPlan(), 'Lepidolite'));
  check(!$('#plan-work').hidden, 'naming something you have is enough of a plan to show');
  check(/What Lepidolite is made of/.test(text('#plan-steps')),
        'and it takes the thing apart rather than listing what eats it');

  const chips = nodes($('#plan-steps'), 'make-chip');
  const els = nodes($('#plan-steps'), 'make-element');
  check(els.length === 6, `the six elements of Lepidolite come first: ${els.length}`);
  const syms = els.map((c) => nodes(c, 'make-sym')[0].textContent);
  check(syms.join(' ') === 'Li O F Al Si K',
        `in the order the table puts them, by atomic number: ${syms.join(' ')}`);

  const rest = chips.filter((c) => !els.includes(c));
  check(rest.length > 10, `then the ${rest.length} things made of nothing else`);
  const named = rest.map((c) => c.textContent);
  check(named.includes('Glass') && named.includes('Lithium Oxide'),
        `things you would actually want among them: ${named.slice(0, 5).join(', ')}`);
  // Only what something can make: the rest are walls, debris and bits of
  // blender that share an element by accident and no recipe with anything.
  check(!named.some((n) => /Bits of|Wall|Wire/.test(n)),
        'and no walls or debris, which share an element and nothing else');
  check(!named.includes('Lepidolite'), 'nor the thing you already have');

  /**
   * The elements are ticked and sent together; the compounds are one press.
   *
   * Sparr: asking for the potassium and the lithium out of one ore is a single
   * decision. The plan that makes both is not the plan that makes either, so
   * pressing them one at a time would re-plan in between and answer a
   * different question each time.
   */
  const send = nodes($('#plan-steps'), 'make-send')[0];
  check(!!send && send.disabled, 'nothing is picked to start with, so there is nothing to send');
  els.find((c) => nodes(c, 'make-sym')[0].textContent === 'K').click();
  check(!send.disabled, 'ticking one arms the button');
  check(!app.getPlan().targets.length, 'and changes nothing yet');
  els.find((c) => nodes(c, 'make-sym')[0].textContent === 'Li').click();
  check(/these 2/.test(send.textContent), `which counts them: ${send.textContent}`);
  els.find((c) => nodes(c, 'make-sym')[0].textContent === 'Li').click();
  check(/Make it/.test(send.textContent), `and un-ticks: ${send.textContent}`);
  els.find((c) => nodes(c, 'make-sym')[0].textContent === 'Li').click();
  send.click();
  const wanted = app.getPlan().targets.map((t) => t.name).sort();
  check(wanted.join(', ') === 'Lithium, Potassium',
        `sending asks for all of them at once: ${wanted.join(', ')}`);
  check(nodes($('#plan-steps'), 'plan-step').length > 0, 'and the plan comes back as steps');

  // A compound is a whole answer on its own, so it stays one press.
  app.setPlan(addHave(emptyPlan(), 'Lepidolite'));
  nodes($('#plan-steps'), 'make-chip')
    .find((c) => c.textContent === 'Glass').click();
  check(app.getPlan().targets.some((t) => t.name === 'Glass'),
        'while picking a compound enters it as a want on its own');
}

/* -------------------------------------------------------- sharing a feed */

console.log('\n--- reactions that share a chamber ---');
{
  /**
   * A tile runs the first reaction in its list that is valid this tick and
   * stops. Lepidolite's three decompositions are gated at 51, 52 and 50, so
   * each takes about a third of the ore -- and two thirds of what you feed in
   * leaves as the other two reactions' products, mentioned or not.
   *
   * The old planner hid the two you did not ask for behind the one you did and
   * named it. This one lists all three, because all three run, so the share is
   * on each row and the rest is accounted for on rows you can see.
   */
  app.setPlan(addHave(addTarget(emptyPlan(), 'Potassium'), 'Lepidolite'));
  const decomps = nodes($('#plan-steps'), 'plan-step')
    .filter((r) => /Lepidolite Decomposition/.test(r.textContent));
  check(decomps.length === 3, `all three decompositions are steps (${decomps.length})`);
  const shares = nodes($('#plan-steps'), 'step-share');
  check(shares.length >= 3 && shares.every((n) => /1 in 3 of the Lepidolite/.test(n.textContent)),
        `each saying what share of the feed it takes: ${shares[0]?.textContent.slice(0, 40)}`);
  check(shares.every((n) => /the rest runs the other reactions below/.test(n.textContent)),
        'and where the other two thirds went');
  // They run the same number of times, which is the whole claim.
  const runs = decomps.map((r) => nodes(r, 'runs')[0].textContent);
  check(new Set(runs).size === 1, `and they run in step: ${runs.join(' ')}`);
}

console.log('\n--- claiming what is left over ---');
{
  // Wanting the spare water should account for the water that is already
  // spare, not set a fresh batch going for it. As a target it would do the
  // latter -- and count it wrong on the way, since a target's amount is stated
  // before the batch scaling and a leftover is shown after it.
  app.setPlan(addHave(addTarget(addTarget(emptyPlan(), 'Potassium'), 'Lithium'), 'Lepidolite'));
  app.setMode('plan');
  const before = { steps: nodes($('#plan-steps'), 'plan-step').length,
                   fetch: nodes($('#plan-side'), 'plan-item')
                     .filter((n) => n.textContent.includes('mine') || false).length };
  const spare = nodes($('#plan-side'), 'plan-item')
    .find((n) => n.dataset.material === 'Molten Silica');
  check(!!spare, 'the spare silica is listed as left over');
  const keep = nodes(spare, 'small').find((b) => b.textContent === 'Keep it');
  check(!!keep, 'and offers to be kept rather than wanted');

  keep.click();
  check(nodes($('#plan-steps'), 'plan-step').length === before.steps,
        `which changes nothing about the plan (${before.steps} steps either way)`);
  check(!text('#plan-side').includes('Vanadinite'), 'and sends it after nothing');
  check(text('#plan-side').includes('You also get'), 'the silica moves to what you also get');
  const still = nodes($('#plan-side'), 'plan-item')
    .filter((n) => n.dataset.material === 'Molten Silica');
  check(still.length === 1 && still[0].textContent.includes('Kept'),
        'listed once, as kept');
  check(!app.getPlan().targets.some((t) => t.name === 'Molten Silica'),
        'without becoming something the plan has to make');
}

/* ------------------------------------------------------- a step or a charge */

console.log('\n--- the shopping list says what it is for ---');
{
  /**
   * Sparr: the note belongs on the balanced view, to explain what drove the
   * multiplier.
   *
   * Balanced is where it is least obvious and most wanted. The multiple has
   * been folded into the goal bar, which now says four where the reader typed
   * one, and `scale` reads one because there is nothing left for it to carry
   * -- so the batch is on the screen without a word about where it came from.
   * Both views are covered: the amounts hold the multiple here, `scale` holds
   * it when balancing is off, and the render multiplies the two.
   */
  app.setPlan(addHave(addTarget(addTarget(emptyPlan(), 'Tantalum'), 'Niobium'), 'Columbite'));
  app.setMode('plan');
  // Whatever it buys, not a named material: what the plan reaches for moves
  // with the solver, and the claim is about the row rather than the ore.
  const rows = nodes($('#plan-side'), 'plan-item').filter((n) => n.dataset.material);
  check(rows.length > 0, `something is on the shopping list: ${rows.length} rows`);
  const row = rows[0];
  check(/for /.test(row.textContent),
        `and the row says what it is for: ${row.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
  // Links, so the next press is the one the reader wanted.
  const links = nodes(row, 'matlink').map((a) => a.textContent);
  check(links.length > 1 && links[0] === row.dataset.material,
        `itself and what it feeds, each a link to press: ${links.join(', ')}`);
}

console.log('\n--- a leftover with nothing left in it ---');
{
  /**
   * The carbon closes, so there is no half-spent leftover to talk about.
   *
   * This block used to be about the spare Carbon Dioxide: the old planner made
   * one Carbon out of two Carbon Monoxide and left the dioxide sitting there
   * with a carbon still in it, and the page said so. The solver that survives
   * electrolyses it back and hands you both carbons, so the only thing left is
   * the oxygen that came in with them.
   *
   * b=0: the reader has said how much Carbon they want, so the amounts are
   * theirs rather than the balancer's.
   */
  app.setPlan({ ...addHave(addTarget(emptyPlan(), 'Carbon'), 'Carbon Monoxide'), balance: false });
  app.setMode('plan');
  const spare = nodes($('#plan-side'), 'plan-item').map((n) => n.dataset.material);
  check(!spare.includes('Carbon Dioxide'),
        `nothing is left holding a carbon: ${spare.filter(Boolean).join(', ') || 'nothing'}`);
  check(/Oxygen Gas/.test(text('#plan-side')), 'only the oxygen it came in with');
  check(/Electrolysis of Carbon Dioxide/.test(text('#plan-steps')),
        'the dioxide having been taken apart rather than left');
}

console.log('\n--- changing it and reloading it agree ---');
{
  /**
   * The amounts are worked out once and kept until the question changes, and
   * what counts as a change was a list somebody had to remember to add to.
   * "Get rid of it" was not on it, so pressing that button kept the amounts
   * from before: one Carbon with a Carbon left over, where the identical
   * address loaded afresh said two Carbon and nothing left over. Whatever else
   * a cache does, it must not disagree with a fresh load of its own URL.
   *
   * The button is gone and the guard is about the cache, so it changes the
   * question directly. Sources are the vehicle now, being a field that plainly
   * moves the amounts: what the plan is allowed to fetch decides how much of
   * the ore it takes, and so what a whole run of it comes to.
   */
  const ask = { ...emptyPlan(), targets: [{ name: 'Tantalum', amount: 1 },
                                          { name: 'Niobium', amount: 1 }],
                have: ['Columbite'] };
  app.setPlan(ask);
  app.setMode('plan');
  const amount = () => nodes($('#goal-targets'), 'goal-amount').map((n) => n.value).join('/');
  const wide = amount();
  check(wide === '4/4', `four of each with the workshop on, as it is by default: ${wide}`);

  /**
   * Narrowed to the sky alone, it comes to something else.
   *
   * This used to turn the workshop off, which no longer moves this question:
   * Sparr's point that Limestone Gravel is dug out of a limestone tile rather
   * than manufactured means a good deal of what needed the workshop before is
   * now had straight from the ground, and the two answers agree. The guard is
   * about the cache and not about sources, so it only wants a field that
   * plainly moves the numbers -- refusing the ground itself does.
   */
  app.setPlan({ ...ask, sources: ['weather', 'air'] });
  const narrow = amount();
  check(narrow !== wide, `and something else once it may not dig: ${narrow}`);

  // The same address, arrived at cold.
  globalThis.location.hash = '#mode=plan&t=Tantalum~Niobium&h=Columbite&sr=weather~air';
  app.reload();
  check(amount() === narrow,
        `changing it gives what loading it gives: ${narrow} against ${amount()}`);
}

/**
 * Why the batch is the size it is, said on the steps that set it.
 *
 * Sparr: mark every step whose count does not divide by the multiplier. The
 * batch is the lowest common multiple of what the counts would otherwise be
 * fractions of, so a step that divides cleanly was never the cause; the ones
 * that do not are the whole of the reason.
 *
 * Each says what it forces rather than what the batch happens to be. On the
 * Tantalum plan nine steps do not divide and eight of them only ever needed
 * two -- the water electrolysis is the one that takes it from two to four, and
 * it is the one that should say four.
 */
console.log('\n--- why the batch is the size it is ---');
{
  app.setPlan(addHave(addTarget(addTarget(emptyPlan(), 'Tantalum'), 'Niobium'), 'Columbite'));
  app.setMode('plan');
  const marks = nodes($('#plan-steps'), 'step-note-info')
    .flatMap((n) => nodes(n, 'step-note-line').map((l) => l.textContent))
    .filter((t) => t.startsWith('one order would take'));
  check(marks.length > 0, `the steps that set the batch say so: ${marks.length} of them`);
  check(marks.every((t) => /has to be a multiple of \d/.test(t)),
        'each naming the multiple it forces');
  const sets = marks.filter((t) => /which is what sets it at/.test(t));
  check(sets.length > 0, 'and the one that fixes the batch says which it is');
  // A step whose count divides the batch cleanly was not the reason for it.
  const rows = nodes($('#plan-steps'), 'plan-step');
  check(rows.length > marks.length,
        'while the steps that divide cleanly stay quiet');
}

console.log('\n--- what has to be in there before it starts ---');
{
  /**
   * A charge is laid in once and handed back every run, so it is not a
   * shopping list and must not read as one.
   *
   * This block used to be about trading the charge for a step that made the
   * material instead, and back again. Both directions wrote `credit`, which
   * only the old planner read -- the one that survives feeds every spare
   * output back and lays a charge in wherever a loop needs starting, whatever
   * it is told -- so the trade went with it. What is left is the statement.
   */
  app.setPlan(addTarget(emptyPlan(), 'Boron Oxide'));
  app.setMode('plan');
  const charges = nodes($('#plan-side'), 'plan-item')
    .filter((n) => n.textContent.includes('never spent')).map((n) => n.dataset.material);
  check(charges.length > 0,
        `the plan says what has to be in the chamber first: ${charges.join(', ')}`);
  check(/put in once, never spent/.test(text('#plan-side')),
        'and that it is not spent, so it is not a shopping list');
  /**
   * The one thing you can say back: not that one, start it some other way.
   *
   * Which charge this plan lays in depends on the route, and the route has
   * moved once already -- it used to buy its hydrochloric acid and charge the
   * chamber with Steam, and now makes the acid and charges it with Water,
   * which is a better answer by the two questions the solver asks. So the
   * charge is read off the list. What is being tested is that a charge can be
   * refused and that the refusal reaches the solver.
   */
  const refusable = nodes($('#plan-side'), 'plan-item')
    // A charge, not a thing to fetch. Both offer "Not this one" and they mean
    // different things: taken from the shopping list instead, this found the
    // Borax and then asked why refusing it had not touched `noPrime`.
    .filter((n) => n.textContent.includes('never spent'))
    .map((n) => ({ name: n.dataset.material,
                   button: nodes(n, 'small').find((b) => b.textContent === 'Not this one') }))
    .find((c) => c.button && c.name);
  check(!!refusable,
        `with a way to refuse a charge you would rather not lay in: ${refusable?.name ?? 'none offered'}`);
  if (refusable) {
    refusable.button.click();
    check(app.getPlan().noPrime.includes(refusable.name), 'which the solver is told about');
  } else {
    check(false, 'which the solver is told about');
  }
}

console.log('\n--- the URL carries both ---');
app.setQuery('water');
app.select(app.db.byName.get('Water'));
app.setPlan(addHave(addTarget(emptyPlan(), 'Sulfuric Acid'), 'Water'));
app.setMode('plan');

const hash = globalThis.location.hash.replace(/^#/, '');
const params = new URLSearchParams(hash);
check(params.get('mode') === 'plan', 'the mode is in the fragment');
check(params.get('q') === 'water' && params.get('m') === 'Water',
      'and so is the search it was left in, though the search is not on screen');
check(params.get('t') === 'Sulfuric Acid' && params.get('h') === 'Water',
      'alongside the plan itself');

app.setMode('explore');
const fromExplore = new URLSearchParams(globalThis.location.hash.replace(/^#/, ''));
check(fromExplore.get('t') === 'Sulfuric Acid',
      'a link copied while searching still carries the plan');
check(!fromExplore.get('mode'), 'and explore, being the default, is written as nothing');

// A reload is the real test of it: throw the state away and rebuild from text.
app.reload();
check(app.getPlan().targets[0]?.name === 'Sulfuric Acid' &&
      app.getPlan().have[0] === 'Water', 'reloading rebuilds the plan from the fragment');
check($('#q').value === 'water', 'and the search with it');

/* -------------------------------------------------------------- handoffs */

console.log('\n--- from one mode to the other ---');
app.setMode('explore');
app.setPlan(emptyPlan());
app.select(app.db.byName.get('Molten Aluminum'));
const handoff = nodes($('#detail'), 'detail-plan')[0];
check(!!handoff, 'a material offers to be planned');
const makeThis = handoff.children.find((b) => b.textContent === 'Make this');
makeThis.click();
check(app.getPlan().targets.some((t) => t.name === 'Molten Aluminum'),
      '"Make this" adds it as a target');
check(!$('#plan-main').hidden, 'and takes you to the plan, since you are no longer searching');

app.setMode('explore');
app.select(app.db.byName.get('Alumina'));
const planThis = nodes($('#detail'), 'rx-plan')[0];
check(!!planThis, 'a reaction card offers to be planned');
planThis.click();
// It names what the reaction makes. Holding the plan to that *route* went with
// the solver that read pins, so this is the honest half of the same press.
const wanted = app.getPlan().targets.map((t) => t.name);
check(wanted.length > 0,
      `"Plan this" asks for what the reaction makes: ${wanted.join(', ')}`);

// Back the other way: a material in the plan opens in the inspector, and the
// explorer is one press further on.
app.setMode('plan');
const link = nodes($('#plan-steps'), 'matlink')[0];
check(!!link, 'the plan links its materials');
link.click();
const inspector = nodes($('#plan-side'), 'inspector')[0];
check(!!inspector, 'clicking one opens it in the inspector rather than leaving the mode');
check(!$('#plan-main').hidden, 'so you are still looking at the plan');
const lookUp = nodes(inspector, 'small').find((b) => b.textContent === 'Look up');
lookUp.click();
check(!$('#explore-main').hidden, 'and "Look up" is what goes to the explorer');
check(!$('#back-to-plan').hidden, 'with a way back, now that there is a plan to go back to');

app.setPlan(emptyPlan());
check($('#back-to-plan').hidden, 'which is not offered when there is no plan');

/* ---------------------------------------------- a route run on the leavings */

/*
 * The block that was here drove the whole thing from a pin: hold Carbon to the
 * Boudouard equilibrium, watch it run on the spare Carbon Monoxide, and undo
 * it with "Stop recycling it". Pins went with the solver that read them, and
 * the button with the pins. What survives is the statement itself, checked
 * below, where the route offers to be run on the leavings and the reader says
 * so rather than having it inferred from a pin.
 */

/* ------------------------------------ the ways to get it, and which was taken */

/**
 * There was a second thing a route could be here: a use for what the plan was
 * already throwing away, run on the spare and no further.
 *
 * It wrote `alsoUse`, and the surviving solver never read it -- it stored the
 * field and hashed it into a cache key and did nothing else with it, so the
 * button relabelled a plan it could not alter. Measured across three questions
 * and four routes, none of the twelve changed the plan. The instruction it
 * carried is this solver's default, every spare output being fed back already,
 * which is also why the offer had stopped appearing: it wanted a route the
 * plan could feed from its own leavings without having chosen it, and here
 * that is the chosen route.
 *
 * So the list is all there is, and the list is worth having: which ways exist,
 * which was taken, what each would need.
 */
{
  app.setMode('plan');
  app.setPlan({
    ...emptyPlan(),
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Water', amount: 1 }],
    have: ['Lepidolite'], balance: false, selected: 'Water',
  });
  const opts = nodes($('#plan-side'), 'route-opt');
  check(opts.length > 2, `every way of getting the water is listed: ${opts.length}`);
  const chosen = opts.filter((li) => li.classList.contains('on'));
  check(chosen.length > 0 && /Steam condenses into Water/.test(chosen[0].textContent),
        `with the one the plan took marked: ${chosen[0]?.textContent.slice(0, 40)}`);
  check(opts.some((li) => /Falling Snow melts into Water/.test(li.textContent)),
        'and the ones it did not, to read');
  // Nothing on any of them offers to be run on the spare any more.
  check(!/spare/i.test(text('#plan-side')),
        'with nothing offering to run on the leavings, that having been a no-op');
}

/* ------------------------------------------------ taking a rejection back */

// "Not this" and "Never use it" are one press each, and the step they remove
// takes the button with it. A plan narrowed into a dead end has to say what
// narrowed it, and offer the way out.
{
  app.setMode('plan');
  app.setPlan({
    ...emptyPlan(),
    targets: [{ name: 'Tantalum', amount: 6 }, { name: 'Niobium', amount: 6 }],
    have: ['Columbite', 'Carbon'],
    excludeProcesses: ['rx:Lepidolite Decomposition - Potassium', 'ignite:Pneumatocyst'],
    excludeMaterials: ['Wood'],
  });
  const side = () => text('#plan-side');
  check(/3 ruled out/.test(side()), 'everything ruled out by hand is listed and counted');
  check(/Lepidolite Decomposition - Potassium/.test(side()) && /Wood/.test(side()),
        'processes and materials alike');
  // Whatever the plan gave up on is named, since a rejection is the likeliest
  // reason and this panel is where you take one back.
  check(/gave up on |Nothing left to fetch|to fetch/.test(side()),
        'and it says where the plan stands, since that is why you are reading it');

  const panel = nodes($('#plan-side'), 'ruled-out')[0];
  nodes(panel, 'small')[0].click();
  check(app.getPlan().excludeProcesses.length === 1,
        '"Allow it" takes one rejection back and leaves the others');
  check(/^\d+ steps/.test(text('#plan-steps')) && !/gave up/.test(text('#plan-steps')),
        `and the plan is a plan again: ${text('#plan-steps').slice(0, 9)}`);

  app.setPlan(farming({ ...emptyPlan(), targets: ['Vinegar'] }));
  check(!/ruled out/.test(text('#plan-side')), 'with nothing ruled out the panel is not there');
}

/* ------------------------------------------ claiming a spare as a product */

// Sparr: would moving the material from the leftovers to the wants accomplish
// what "Keep it" used to? It is the whole of it. The older solver did two
// things with a claim -- moved the row, and stopped counting that byproduct
// when it compared plans -- and the newer one now does both, the second as the
// last tie-break rather than the third of six sort keys.
{
  const ask = {
    ...emptyPlan(), fresh: true, balance: false,
    targets: [{ name: 'Tantalum', amount: 2 }, { name: 'Niobium', amount: 2 }],
    have: ['Columbite'],
  };
  app.setPlan(ask);
  check(/left over/.test(text('#plan-side')) && !/You also get/.test(text('#plan-side')),
        'everything spare starts out as waste');

  app.setPlan({ ...ask, kept: ['Potassium Fluoride'] });
  const side = text('#plan-side');
  check(/You also get/.test(side), 'claiming one gives the plan a second output panel');
  const also = side.split('You also get')[1].split('left over')[0];
  check(/Potassium Fluoride/.test(also), `and the claimed row is the one in it: ${also.slice(0, 40)}`);
  // The waste panel, not the whole side: the shopping list names Molten Silica
  // too, as one of the things the Lepidolite is being fetched for.
  check(!/Potassium Fluoride/.test(side.split('left over')[1] || ''),
        'and gone from the leavings it was in');
  // It asks for nothing to be made: the shopping list and the steps are the
  // plan it was already going to give you.
  const before = (p) => p.split('to fetch')[1].split('To get it going')[0];
  check(before(text('#plan-side')) === before(side), 'and nothing is fetched to make more of it');
}

/* ----------------------------- one solver, and every control writes to it */

/**
 * Sparr: hide the moot ones, mark the losses in red so they can be found.
 *
 * Both are finished, and this is what they came to. Four controls were hidden
 * as things the solver does unconditionally and are now simply gone, there
 * being no second solver to hide them from. Five were marked in red: one was
 * taught to the solver, and the other four turned out to be a single question
 * wearing a control's clothes -- "show me a different plan" -- which belongs
 * where whole plans are compared. So the claim left to check is the plain one:
 * every button on the page writes something the solver reads.
 */
{
  app.setPlan({
    ...emptyPlan(), balance: false,
    targets: [{ name: 'Tantalum', amount: 1 }, { name: 'Niobium', amount: 1 }],
    have: ['Columbite'], selected: 'Hydrofluoric Acid',
  });
  const labels = [...$('#plan-side').walk()]
    .filter((n) => n.tagName === 'BUTTON')
    .map((b) => b.textContent.trim());
  const dead = labels.filter((l) => /Let the planner choose|Get rid of it|Feed it back|Make it instead|Prime instead|Stop recycling it/.test(l));
  check(!dead.length, `nothing on the page does nothing: ${dead.join(', ') || 'none'}`);
  // The ways of making a material are still listed, to read rather than press.
  check(nodes($('#plan-side'), 'route-read').length > 0,
        'the ways of making a material still being listed');
  check(!nodes($('#plan-side'), 'solver-gap').length, 'and nothing is marked as unheard');
}

/* ------------------------------ refusing a material at the door, not outright */

// Sparr: "if we allow excluding fetch and prime materials, that should be more
// effective than excluding individual reactions". Two narrower refusals than
// "Never use it": the plan may still make the thing and spend it, it just may
// not buy it, or may not be handed some to start with.
{
  const ask = {
    ...emptyPlan(), fresh: true, balance: false,
    targets: [{ name: 'Tantalum', amount: 1 }, { name: 'Niobium', amount: 1 }],
    have: ['Columbite'],
  };
  app.setPlan(ask);
  const shopping = () => text('#plan-side');
  check(/Hydrofluoric Acid/.test(shopping()),
        `the plan buys Hydrofluoric Acid to start with: ${shopping().slice(0, 60)}`);
  check(/Not this one/.test(shopping()), 'and offers to be told not to');

  app.setPlan({ ...ask, noFetch: ['Hydrofluoric Acid'] });
  /**
   * The shopping panel only, by the row's material rather than by text.
   *
   * `plan-item` is the row class in every panel down that side, so a naive
   * sweep picks up the charge and the leavings too -- and the plan goes
   * shopping for Hydrofluoric Acid *Gas* instead, which reads as the refused
   * name inside it either way.
   */
  const shoppingPanel = () => nodes($('#plan-side'), 'plan-panel')
    .find((n) => /to fetch/.test(n.textContent));
  const buying = () => nodes(shoppingPanel(), 'plan-item')
    .map((n) => n.dataset.material).filter(Boolean);
  check(buying().length > 0 && !buying().includes('Hydrofluoric Acid'),
        `refused, it goes shopping somewhere else instead of giving up: ${buying().join(', ')}`);
  check(/1 ruled out/.test(text('#plan-side')) && /may still make some/.test(text('#plan-side')),
        'and the refusal is listed with its way back');

  // The blunt version really is blunter: nothing may touch it at all.
  app.setPlan({ ...ask, excludeMaterials: ['Hydrofluoric Acid'] });
  const blunt = app.getPlan();
  check(blunt.excludeMaterials.length === 1 && !blunt.noFetch.length,
        'and the two are separate choices, not one another');
}

// Both ride in the URL like everything else the reader chose.
{
  const spec = { ...emptyPlan(), targets: [{ name: 'Carbon', amount: 1 }],
                 noFetch: ['Lepidolite'], noPrime: ['Chlorine Gas'] };
  const params = new URLSearchParams();
  writePlan(spec, params);
  check(params.get('xf') === 'Lepidolite' && params.get('xp') === 'Chlorine Gas',
        'a refusal to buy and a refusal to start with are written separately');
  const back = readPlan(params);
  check(back.noFetch.join() === 'Lepidolite' && back.noPrime.join() === 'Chlorine Gas',
        'and both survive a reload');
  const old = readPlan(new URLSearchParams());
  check(!old.noFetch.length && !old.noPrime.length, 'while an older link without them still reads');
}

// The same undo where you would first look for it: on the route itself. It
// sorts last of 153, so it also has to survive the cut.
{
  const ACID = 'rx:Acetic Acid + Water = Vinegar';
  app.setPlan({ ...emptyPlan(), targets: ['Vinegar'],
                excludeProcesses: [ACID], selected: 'Vinegar' });
  const banned = nodes($('#plan-side'), 'route-opt').find((li) => li.classList.contains('banned'));
  check(!!banned, 'a rejected route is still shown in the list it was rejected from');
  const undo = banned && nodes(banned, 'small').find((b) => b.textContent === 'Ruled out');
  check(!!undo, 'marked as such, and offering to be let back in');
  undo.click();
  check(!app.getPlan().excludeProcesses.length, 'which is the same undo, in the other place');
}

/* ------------------------------------------------- balancing, on by default */

{
  const amounts = () => nodes($('#goal-targets'), 'goal-amount').map((n) => n.value).join('/');
  const balBtn = () => nodes($('#goal-balance'), 'small')[0];

  app.setMode('plan');
  let p = { ...emptyPlan(), have: ['Lepidolite'],
            targets: ['Potassium', 'Lithium', 'Aluminum', 'Silicon']
              .map((name) => ({ name, amount: 1 })) };
  app.setPlan(p);
  check(app.getPlan().balance, 'balancing is on to begin with');
  check(amounts() === '2/2/2/3',
        `one of each is shown as what three Lepidolite comes to: ${amounts()}`);
  check(/3\s*Lepidolite/.test(text('#goal-haves')), 'out of the same 3 Lepidolite');
  check(!/Molten Silica/.test(text('#plan-side')), 'with no Molten Silica left on the floor');

  // Off, and the numbers are yours again.
  balBtn().click();
  check(!app.getPlan().balance && amounts() === '1/1/1/1',
        `pressing it hands the amounts back: ${amounts()}`);
  check(/left over/.test(text('#plan-side')), 'waste and all');
  balBtn().click();
  check(amounts() === '2/2/2/3', 'and pressing again works them out afresh');

  // It stays on through a change, which is the point of it being a toggle.
  app.setPlan(removeTarget(app.getPlan(), 'Silicon'));
  check(app.getPlan().balance && amounts() === '2/2/2',
        `dropping a product re-works the rest: ${amounts()}`);

  // Typing a number is taking the wheel, and a box that will not hold what you
  // put in it is worse than no box.
  app.setPlan({ ...emptyPlan(), have: ['Lepidolite'],
                targets: [{ name: 'Potassium', amount: 1 }, { name: 'Lithium', amount: 1 }] });
  const box = nodes($('#goal-targets'), 'goal-amount')[0];
  box.value = '7';
  box.dispatch('change');
  check(!app.getPlan().balance, 'typing an amount turns balancing off');
  check(amounts().startsWith('7'), `and the number typed is the number kept: ${amounts()}`);
}

// Off is the only half of it worth writing down, since on is the default.
{
  const params = new URLSearchParams();
  writePlan({ ...emptyPlan(), targets: [{ name: 'Vinegar', amount: 1 }], balance: false }, params);
  check(params.get('b') === '0' && readPlan(params).balance === false,
        'balancing off survives a reload');
  check(readPlan(new URLSearchParams()).balance === true, 'and an old link comes back balanced');
}

/*
 * The block here weighed the `ch` flag, which said whether the planner was
 * allowed to lay a charge in rather than add a step that runs for ever. The
 * solver that survives lays one in wherever a loop needs starting and does not
 * take an opinion on it, so the flag went with the solver that did.
 */

/*
 * Two blocks here turned on `plenty`, the mark that said you could get as much
 * of a material as the plan turned out to need. It mattered only to the
 * balancer, and only because the old solver had a notion of a stock running
 * out. Everything you hold is finite now, so the mark, the flag and the `pl`
 * parameter are gone together, and the have box means one thing.
 */

/* ------------------------------ when there is no plan, say where the switch is */

/**
 * Sparr: when there is no available plan, point the reader at the options.
 *
 * "Nothing allowed can make Charcoal" is true and unhelpful. *Allowed* is a
 * setting, and which setting is not guessable from the material -- Charcoal,
 * Flour and an Egg Shell all want the same one. So the page puts the question
 * again with each category that is switched off, and names whichever ones come
 * back with an answer.
 */
console.log('\n--- no plan, and what to do about it ---');
{
  app.setMode('plan');
  app.setPlan(addTarget(emptyPlan(), 'Charcoal'));
  const steps = () => text('#plan-steps');
  check(/Nothing allowed can make/.test(steps()), 'it says nothing allowed can make it');
  check(/there is a plan if you allow/i.test(steps()),
        `and that there is one if you allow something: ${steps().slice(0, 90)}`);

  const offered = nodes($('#plan-steps'), 'small').map((b) => b.textContent);
  check(offered.includes('Grown'), `naming the category that would do it: ${offered.join(', ')}`);
  check(offered.includes('Options'), 'with the panel itself one press away');

  // The named one is a button, not a sentence: pressing it plans.
  nodes($('#plan-steps'), 'small').find((b) => b.textContent === 'Grown').click();
  check(app.getPlan().sources.includes('farm'), 'pressing it switches the category on');
  check(!/Nothing allowed can make/.test(steps()) &&
        nodes($('#plan-steps'), 'plan-step').length > 0,
        `and the plan comes back: ${steps().slice(0, 40)}`);

  // The pointer to Options is there even when the failure has its own reason,
  // which is the case that used to lose it.
  app.setPlan({ ...addTarget(emptyPlan(), 'Charcoal'), kinds: [] });
  check(/Nothing allowed can make/.test(steps()) &&
        nodes($('#plan-steps'), 'small').some((b) => b.textContent === 'Options'),
        'and the way to Options survives a failure that explains itself');
  const opts = nodes($('#plan-steps'), 'small').find((b) => b.textContent === 'Options');
  opts.click();
  check(!$('#plan-options').hidden, 'which opens the panel');
  // Left as it was found: the block below toggles this panel and would be
  // toggling it shut.
  $('#plan-options').hidden = true;
}

/* ------------------------------ raising the cap on how many ores are tried */

/**
 * Sparr: expose the cap in Options to be set outright, and beside the message
 * as a button that doubles it.
 *
 * Lithium Oxide is the case. Fourteen materials carry lithium and oxygen, the
 * six cheapest lead nowhere, and one further down is two Lithium Carbonate.
 * Each candidate is a whole solve -- 42ms at six, 355ms at twelve -- so the
 * search stops, says where it stopped, and lets the reader decide whether to
 * pay for more.
 */
console.log('\n--- the ore cap, and saying when it was in the way ---');
{
  app.setMode('plan');
  app.setPlan(addTarget(emptyPlan(), 'Lithium Oxide'));
  const steps = () => text('#plan-steps');
  /**
   * This asked that six ores found nothing and that the page said so, on
   * Lithium Oxide. Nothing in the corpus fails at six any more: a material no
   * reaction can use is no longer a candidate, and two states of one substance
   * no longer take a slot each, which freed enough of the six that every
   * capped question answering at thirty-two now answers at six as well.
   *
   * So what is left to check is the harder case, and the one Sparr asked for:
   * an answer that came back with the cap still in the way. It looks like any
   * other answer, and until there was an indicator there was nothing to
   * suggest that spending more might do better.
   */
  check(!/Nothing allowed can make/.test(steps()), 'six ores in, there is a plan');
  check(/cheapest ores of \d+/.test(steps()),
        `and it says the cap was in the way: ${steps().slice(0, 90)}`);

  const more = nodes($('#plan-steps'), 'small').find((b) => /^Try \d+$/.test(b.textContent));
  const offered = more ? Number(more.textContent.replace('Try ', '')) : 0;
  check(offered > 6, `with a button offering more than the six tried: ${more?.textContent}`);
  more.click();
  check(app.getPlan().oreTries === offered, 'pressing it spends what it offered');
  check(!/cheapest ores of \d+/.test(steps()),
        'and then there is no cap left to complain about');

  // The same setting, said outright.
  app.setPlan(addTarget(emptyPlan(), 'Lithium Oxide'));
  check($('#plan-ores').value === '6', `Options shows the cap in force: ${$('#plan-ores').value}`);
  $('#plan-ores').value = '14';
  $('#plan-ores').dispatch('change');
  check(app.getPlan().oreTries === 14, 'and typing a number sets it');
  check(!/Nothing allowed can make/.test(steps()), 'which still finds a plan');

  // A number nobody means is not taken as read.
  app.setPlan({ ...addTarget(emptyPlan(), 'Lithium Oxide'), oreTries: 6 });
  $('#plan-ores').value = '9999';
  $('#plan-ores').dispatch('change');
  check(app.getPlan().oreTries === 32,
        `held to a budget rather than a thousand solves: ${app.getPlan().oreTries}`);

  // And it rides in the URL, since the default is the interesting exception.
  const params = new URLSearchParams();
  writePlan({ ...emptyPlan(), targets: [{ name: 'Lithium Oxide', amount: 1 }], oreTries: 12 },
            params);
  check(params.get('ot') === '12' && readPlan(params).oreTries === 12,
        'a raised cap survives a reload');
  const plain = new URLSearchParams();
  writePlan({ ...emptyPlan(), targets: [{ name: 'Lithium Oxide', amount: 1 }] }, plain);
  check(!plain.get('ot') && readPlan(plain).oreTries === 6,
        'and the usual six is not written down');
}

/* ------------------------------------------ the plan drawn as a diagram */

/**
 * A plan is a graph, and the question a reader has -- where does this come
 * from, what is waiting on it -- is a question about edges. So it can be drawn
 * as one, on a button, beside the tables rather than instead of them.
 *
 * What the shim can see is that the picture is built and that it is built out
 * of the plan: a box for every step, an arrow for every material going in or
 * out. How it looks is not testable here and the layout has its own suite.
 */
console.log('\n--- the plan, drawn');
{
  app.setMode('plan');
  app.setPlan(addHave(addTarget(addTarget(emptyPlan(), 'Tantalum'), 'Niobium'), 'Columbite'));
  check($('#plan-picture').hidden, 'the diagram is not drawn until it is asked for');
  check(!$('#toggle-plan-picture').hidden, 'but the way to ask is on the bar');

  $('#toggle-plan-picture').click();
  check(!$('#plan-picture').hidden, 'pressing it opens the diagram');
  // The drawing lives in its own box inside the panel, so that the button to
  // turn it can sit still while the picture scrolls under it.
  const canvas = () => $('#plan-picture-canvas');
  const svg = [...canvas().walk()].find((n) => n.tagName === 'SVG');
  check(!!svg, 'which is an svg');
  const boxes = nodes(canvas(), 'plan-node');
  const wires = nodes(canvas(), 'plan-wire');
  check(boxes.length > 10 && wires.length > boxes.length,
        `with ${boxes.length} things and ${wires.length} arrows between them`);
  // Reactions on the boxes, materials written on the arrows, and the three
  // ends of the plan drawn as reactions of a sort so those arrows attach.
  const real = nodes(canvas(), 'plan-step').filter((n) => !n.classList.contains('plan-pseudo'));
  // Every step but the phase changes, which the picture folds into whatever
  // reaction comes next rather than drawing a box for.
  const listed = nodes($('#plan-steps'), 'plan-step').length;
  check(real.length > 0 && real.length <= listed,
        `a box for every step in the table bar the phase changes: `
        + `${real.length} drawn of ${listed} listed`);
  check(nodes(canvas(), 'plan-pseudo').length > 0, 'with the ends of the plan beside them');
  check(nodes(canvas(), 'plan-wire-label').length > 0, 'and the arrows saying what they carry');
  check(!nodes(canvas(), 'plan-material').length, 'no material having a box of its own');

  // Unless asked, in which case every material gets one.
  $('#plan-picture-materials').click();
  check(nodes(canvas(), 'plan-material').length > 0,
        `asked for them, materials get boxes: ${nodes(canvas(), 'plan-material').length}`);
  $('#plan-picture-materials').click();
  check(!nodes(canvas(), 'plan-material').length, 'and pressing again puts them away');
  // The loop-closing arrows are drawn differently, being the only ones that
  // read right to left.
  check(nodes(canvas(), 'plan-wire-loop').length > 0,
        'and the arrows that close a wheel are marked as such');
  /**
   * A bend is where a long arrow stands while crossing a column it has no
   * business in. It is drawn as nothing, so it must not become a box.
   */
  check(!nodes(canvas(), 'plan-bend').length,
        'with no boxes drawn for the places the long arrows stand');

  // Rows or columns, since a plan is a long thin thing and a page scrolls down.
  const wide = svg.attrs.get('width');
  $('#plan-picture-turn').click();
  const turned = [...canvas().walk()].find((n) => n.tagName === 'SVG');
  check(turned.attrs.get('width') !== wide,
        `turning it swaps the way it runs: ${wide} wide becomes ${turned.attrs.get('width')}`);
  $('#plan-picture-turn').click();

  $('#toggle-plan-picture').click();
  check($('#plan-picture').hidden, 'pressing it again puts it away');
}

/* ------------------------------ what each interface actually puts on screen */

/**
 * Sparr: there should be tests that confirm the page shows what it is expected
 * to show in a given interface, and after a given interaction.
 *
 * Everything else in this file asks what some panel *says*. This asks the
 * blunter question first: is it there, is it showing, and does it have
 * anything in it. That is the question the source categories failed for a
 * release -- the boxes were built, filled and hidden, and every test that read
 * their contents was happy.
 *
 * `showing` wants all three, because each has been wrong on its own: an
 * element that does not exist (a renamed id), one that exists and is hidden
 * (this bug), and one that is showing and empty (a panel whose loop never ran).
 */
/**
 * Three states, and the difference between them has bitten separately.
 *
 * `up` is "there and not hidden", which is all you can ask of a container: the
 * shim keeps a flat map of id to node, so a wrapper the page nests things
 * inside has no children here and no text of its own.
 *
 * `filled` adds "and something is in it", which is the question for a panel
 * the page draws into -- a loop that never ran leaves one showing and empty.
 */
const up = (sel) => { const n = $(sel); return !!n && !n.hidden; };
const filled = (sel) => up(sel) && ($(sel).textContent || '').trim().length > 0;
const away = (sel) => { const n = $(sel); return !n || n.hidden; };

console.log('\n--- what each interface shows ---');
{
  const seen = (what, { shown = [], drawn = [], gone = [] }) => {
    const bad = [...shown.filter((sel) => !up(sel)).map((sel) => `${sel} not showing`),
                 ...drawn.filter((sel) => !filled(sel)).map((sel) => `${sel} showing but empty`),
                 ...gone.filter((sel) => !away(sel)).map((sel) => `${sel} should be away`)];
    check(!bad.length, `${what}: ${bad.join(', ') ||
      `${shown.length + drawn.length} shown, ${gone.length} away`}`);
  };

  app.setMode('explore');
  app.select(app.db.byName.get('Water'));
  seen('exploring', { drawn: ['#results', '#detail'], gone: ['#plan-main'] });

  app.setMode('plan');
  app.setPlan(emptyPlan());
  seen('a plan with nothing in it',
       { shown: ['#plan-empty'], gone: ['#plan-work', '#explore-main'] });

  app.setPlan(addHave(emptyPlan(), 'Lepidolite'));
  seen('naming only what you have',
       { shown: ['#plan-work'], drawn: ['#plan-steps', '#goal-haves'], gone: ['#plan-empty'] });
  check(/is made of/.test(text('#plan-steps')) &&
        nodes($('#plan-steps'), 'make-chip').length > 6,
        'and it is the elements and what they build, not a table of steps');

  app.setPlan(addHave(addTarget(emptyPlan(), 'Potassium'), 'Lepidolite'));
  seen('a plan with a target',
       { shown: ['#plan-work'],
         drawn: ['#plan-steps', '#plan-side', '#goal-targets', '#goal-haves'],
         gone: ['#plan-empty'] });
  check(nodes($('#plan-steps'), 'plan-step').length > 0, 'with steps in the table');
  check(/to fetch|Nothing left to fetch/.test(text('#plan-side')),
        'and a shopping list, even when it is empty');

  // The options panel, which is where the categories went missing.
  $('#toggle-plan-options').click();
  seen('the options panel',
       { shown: ['#plan-options'], drawn: ['#plan-kinds', '#plan-sources'] });
  const srcBoxes = nodes($('#plan-sources'), 'plan-kind');
  check(srcBoxes.length === 5,
        `with all five source categories to tick: ${srcBoxes.map((b) => b.textContent.trim()).join(', ')}`);
  check(nodes($('#plan-kinds'), 'plan-kind').length > 3, 'and the kinds beside them');
  $('#toggle-plan-options').click();

  // The comparison, offered but not run until asked.
  seen('the comparison',
       { shown: ['#plan-menu'], drawn: ['#plan-menu-run'], gone: ['#plan-menu-close'] });

  // The inspector opens on a material and says how to get it.
  app.setPlan({ ...addHave(addTarget(emptyPlan(), 'Potassium'), 'Lepidolite'),
                selected: 'Molten Potassium Oxide' });
  check(nodes($('#plan-side'), 'inspector').length === 1, 'the inspector opens on a material');
  check(nodes($('#plan-side'), 'route-opt').length > 1,
        `listing the ways to get it: ${nodes($('#plan-side'), 'route-opt').length}`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
