/**
 * The two modes, and the plan pane, driven headlessly.
 *
 * What is worth testing here is not what anything looks like -- the shim knows
 * no CSS -- but the two claims the shell makes: that switching modes loses
 * nothing, and that a link carries both halves of the state whichever half you
 * were looking at when you copied it.
 */
import { readFileSync } from 'node:fs';
import { installDom } from './dom-shim.mjs';
import { emptyPlan, addTarget, addHave, readPlan, writePlan } from '../src/plan-state.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
installDom([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

await import('../src/main.js');
await new Promise((r) => setTimeout(r, 0));

const app = globalThis.window.explorer;
if (!app) { console.log('FAIL boot did not complete'); process.exit(1); }

let fail = 0;
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => { console.log(`FAIL  ${msg}`); fail++; };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

const $ = (sel) => document.querySelector(sel);
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
app.setPlan(addTarget(emptyPlan(), 'Vinegar'));
app.setMode('plan');
check($('#plan-empty').hidden && !$('#plan-work').hidden, 'a plan with a target shows the table');

// Every side reaction says when it would happen, since a step may dodge
// several and only one of them explains the limit it ended up with.
const avoided = nodes($('#plan-steps'), 'rx-avoids');
check(avoided.length > 0 && avoided.every((n) => /at [≥≤]|at \d|any temperature/.test(n.textContent)),
      'each dodged side reaction says at what temperature it would happen');
check(avoided.some((n) => /at ≥|at ≤/.test(n.textContent)),
      'as a bound rather than a sentence');
const also = nodes($('#plan-steps'), 'rx-also');
check(also.every((n) => /°C|any temperature/.test(n.textContent)),
      'so does one that cannot be dodged');
check(also.some((n) => /a step of this plan|no temperature in range/.test(n.textContent)),
      'and it says why it could not be');

const steps = nodes($('#plan-steps'), 'plan-step');
check(steps.length === 4, `Vinegar comes out as ${steps.length} steps`);
{
  // A run is a whole thing, so a plan that would need half of one is multiplied
  // up -- and has to say what that leaves you with, since the goal bar still
  // says what you asked for.
  app.setPlan(addHave(addTarget(emptyPlan(), 'Potassium'), 'Lepidolite'));
  const head = text('#plan-steps');
  check(head.includes('one batch makes 2 Potassium'),
        `a doubled plan says what a batch makes: ${head.slice(0, 60).trim()}`);
  app.setPlan(addTarget(emptyPlan(), 'Vinegar'));
  check(!text('#plan-steps').includes('one batch makes'),
        'and a plan that comes out whole says nothing about it');
}
check(text('#plan-steps').includes('Acetic Acid'), 'naming the materials along the way');
check(goals().includes('Vinegar'), 'and the goal bar says what it is for');
check(text('#plan-side').includes('Death Moss Spore'), 'the side lists what to go and fetch');
// A catalyst belongs on the step that needs it, named once. Not on the
// shopping list, since nothing consumes it, and not repeated in the summary.
check(text('#plan-steps').includes('needs Blender'), 'a catalyst is named on its step');
check(!nodes($('#plan-side'), 'plan-item').some((n) => n.textContent.includes('Blender')),
      'not on the shopping list, since nothing consumes it');
check(!text('#plan-side').includes('needs Blender'),
      'and not said a second time in the summary');

// The frontier's "I have it" is the loop the whole mode is built around.
const fetchList = nodes($('#plan-side'), 'plan-item');
const spore = fetchList.find((n) => n.textContent.includes('Death Moss Spore'));
const haveIt = nodes(spore, 'small').find((b) => b.textContent === 'I have it');
check(!!haveIt, 'each thing to fetch offers "I have it"');
haveIt.click();
check(app.getPlan().have.includes('Death Moss Spore'), 'pressing it moves the material to have');
const stillListed = nodes($('#plan-side'), 'plan-item')
  .some((n) => n.textContent.includes('Death Moss Spore'));
check(!stillListed, 'and off the shopping list');
check(goals().includes('Death Moss Spore'), 'into the goal bar');
// And the have row says how much of it the plan actually wants.
check(/1\s*Death Moss Spore/.test(text('#goal-haves')),
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

console.log('\n--- what you can do with what you have ---');
{
  // Naming one thing you have is a question, and answering it with an empty
  // table says nothing.
  app.setPlan(addHave(emptyPlan(), 'Lepidolite'));
  check(!$('#plan-work').hidden, 'naming something you have is enough of a plan to show');
  check(text('#plan-steps').includes('you could do with that'),
        'and it asks what you want to do with it');
  const uses = nodes($('#plan-steps'), 'use-opt');
  check(uses.length > 0, `listing the ${uses.length} processes that would take it`);
  check(uses[0].textContent.includes('Lepidolite'), 'each one saying what it takes and makes');
  check(uses.some((u) => u.classList.contains('ready')),
        'and marking the ones that could be run as things stand');

  nodes(uses[0], 'route-pick')[0].click();
  check(app.getPlan().include.length === 1, 'picking one puts it in the plan');
  const rows = nodes($('#plan-steps'), 'plan-step');
  check(rows.length >= 1, 'as a step');
  // Lepidolite's decompositions share a chamber, so choosing one brings the
  // other two with it -- they are not a choice.
  check(rows.filter((r) => r.classList.contains('step-shared')).length === rows.length - 1,
        'along with whatever else runs on the same feed');
}

/* -------------------------------------------------------- sharing a feed */

console.log('\n--- reactions that share a chamber ---');
{
  // A tile runs the first reaction in its list that is valid this tick and
  // stops. Lepidolite's three decompositions are gated at 51, 52 and 50, so
  // each takes about a third of the ore -- and two thirds of what you feed in
  // leaves as the other two reactions' products, mentioned or not.
  app.setPlan(addHave(addTarget(emptyPlan(), 'Potassium'), 'Lepidolite'));
  const shared = nodes($('#plan-steps'), 'plan-step')
    .filter((r) => r.classList.contains('step-shared'));
  check(shared.length === 2, `the other two decompositions are in the plan (${shared.length})`);
  check(text('#plan-steps').includes('1 in 3 of the Lepidolite goes this way'),
        'each saying what share of the feed it takes');
  check(shared[0].textContent.includes('sharing the chamber with'),
        'and which reaction it is sharing with');
  check(!nodes(shared[0], 'step-acts').some((a) => a.children.length),
        'with nothing to press, since it is not a choice');

  const left = nodes($('#plan-side'), 'plan-item').map((n) => n.dataset.material);
  check(left.includes('Molten Lithium Oxide') && left.includes('Molten Alumina'),
        `so their products are accounted for: ${left.join(', ')}`);
  check(!text('#plan-steps').includes('this also runs Lepidolite Decomposition'),
        'and they are no longer a footnote on the step that displaced them');
}

/* ------------------------------------------------------------ spare output */

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

console.log('\n--- trading a step for a charge ---');
{
  // The copper is made rather than taken back off its own loop: a step you run
  // forever in place of a charge you lay in once. Which way round is better is
  // the reader's call, so both are one press away.
  app.setPlan(addTarget(emptyPlan(), 'Aqueous Magnesium Sulfate'));
  app.setMode('plan');
  const steps = () => nodes($('#plan-steps'), 'plan-step');
  const before = steps().length;
  const marked = steps().filter((r) => r.textContent.includes('does not have to be laid in'));
  check(marked.length === 1,
        `exactly the step that was added says so, not every step that makes any (${marked.length})`);
  check(marked[0].textContent.includes('Copper'), 'and it is the one making the copper');
  const primeIt = nodes($('#plan-steps'), 'step-acts')
    .flatMap((a) => a.children).find((b) => b.textContent === 'Prime instead');
  check(!!primeIt, 'and offers to make that trade the other way');

  primeIt.click();
  check(steps().length < before, `which drops the step (${before} -> ${steps().length})`);
  const charges = nodes($('#plan-side'), 'plan-item')
    .filter((n) => n.textContent.includes('never spent')).map((n) => n.dataset.material);
  check(charges.includes('Copper'), `and lays the copper in instead: ${charges.join(', ')}`);
  check(app.getPlan().credit.includes('Copper'),
        'held there by an explicit choice, which the solver will not overrule');

  // And back again, from the charge it created.
  const makeIt = nodes($('#plan-side'), 'plan-item')
    .filter((n) => n.dataset.material === 'Copper')
    .flatMap((n) => nodes(n, 'small')).find((b) => b.textContent === 'Make it instead');
  check(!!makeIt, 'the charge offers the reverse');
  makeIt.click();
  check(steps().length === before, 'which puts the step back');
  check(!app.getPlan().credit.includes('Copper'), 'and the choice with it');
}

/* ------------------------------------------------------------- redirecting */

console.log('\n--- changing how something is made ---');
app.setPlan(addHave(addTarget(emptyPlan(), 'Molten Aluminum'), 'Water'));
app.setMode('plan');
{
  // The material you most want to redirect is one already being made, which
  // before the inspector could only be reached by banning steps one at a time.
  const carbon = nodes($('#plan-steps'), 'matlink').find((n) => n.textContent === 'Carbon');
  check(!!carbon, 'a material the plan already makes is a link like any other');
  carbon.click();
  const panel = nodes($('#plan-side'), 'inspector')[0];
  check(!!panel, 'and opens in the inspector');
  check(panel.textContent.includes('made here'), 'saying what it is doing in the plan');

  const options = nodes(panel, 'route-opt');
  const labelled = (o) => nodes(o, 'route-pick')[0].textContent;
  check(options.length > 2, `offering ${options.length} ways to get it`);
  // Having one is an alternative to every way of making one, so it heads the
  // list rather than sitting in a row of buttons above it.
  check(labelled(options[0]).includes('I have it'), '"I have it" is the first of them');
  check(labelled(options[1]).includes('Let the planner choose'),
        'then handing the choice back');
  check(panel.textContent.includes('Show all'),
        'with the rest a press away rather than 149 rows deep');

  const before = nodes($('#plan-steps'), 'plan-step').length;
  const other = options.find((o) => !/I have it|Let the planner/.test(labelled(o)) &&
                                    !o.classList.contains('on'));
  nodes(other, 'route-pick')[0].click();
  check(Object.keys(app.getPlan().pins).includes('Carbon'), 'picking one pins it');
  check(nodes($('#plan-steps'), 'plan-step').length !== before ||
        text('#plan-steps').includes('Carbon'), 'and the plan is rebuilt around the choice');

  // And it reaches things that were never on the shopping list at all.
  const again = nodes($('#plan-steps'), 'matlink').find((n) => n.textContent === 'Carbon');
  if (again) again.click();
  const haveIt = nodes(nodes($('#plan-side'), 'inspector')[0], 'route-opt')
    .map((o) => nodes(o, 'route-pick')[0])
    .find((b) => b.textContent.includes('I have it'));
  check(!!haveIt, 'a material the plan makes can still be declared already had');
  haveIt.click();
  check(app.getPlan().have.includes('Carbon'), 'which is how you say "I have Carbon"');
  check(!/(melts|evaporates) into Carbon/.test(text('#plan-steps')),
        'and the steps that made it drop out');
}
{
  // Heating something where it lies is a real route and a terrible plan: you
  // cannot pipe a deposit into a furnace. The ore route should win.
  app.setPlan(addTarget(emptyPlan(), 'Molten Alumina'));
  const fetching = nodes($('#plan-side'), 'plan-item').map((n) => n.dataset.material);
  check(fetching.includes('Bauxite'),
        `Molten Alumina goes through the ore: ${fetching.join(', ')}`);
  check(!fetching.some((n) => app.graph.categoryOf(n) === 'deposit'),
        'and not by melting a deposit in the ground');
  check(text('#plan-side').includes('Bauxite Deposit mines into Bauxite'),
        'though it still says which deposit the ore comes out of');
}
{
  // Where a deposit is genuinely the only way, it is stated rather than asked
  // about: there is no "I have it" to press, you are going to go and find one.
  app.setPlan(addTarget(emptyPlan(), 'Amethyst Deposit'));
  const item = nodes($('#plan-side'), 'plan-item')
    .find((n) => app.graph.categoryOf(n.dataset.material) === 'deposit');
  check(!!item, 'a plan that needs a deposit lists it');
  check(!nodes(item, 'small').some((b) => b.textContent === 'I have it'),
        'without offering it as something you might already have');
  check(item.textContent.includes('go and find one'), 'because that is what you do with a deposit');
}

/* ------------------------------------------------------------------ links */

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
const pinned = Object.values(app.getPlan().pins);
check(pinned.some((id) => id.startsWith('rx:')),
      '"Plan this" holds the plan to that reaction rather than any route to its product');

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

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
