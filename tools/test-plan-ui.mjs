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
import { emptyPlan, addTarget, addHave, removeTarget,
         readPlan, writePlan } from '../src/plan-state.js';

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
  // The steam is made rather than taken back off its own loop: a step you run
  // forever in place of a charge you lay in once. Which way round is better is
  // the reader's call, so both are one press away.
  app.setPlan(addTarget(emptyPlan(), 'Boron Oxide'));
  app.setMode('plan');
  const steps = () => nodes($('#plan-steps'), 'plan-step');
  const before = steps().length;
  const marked = steps().filter((r) => r.textContent.includes('does not have to be laid in'));
  check(marked.length === 1,
        `exactly the step that was added says so, not every step that makes any (${marked.length})`);
  check(marked[0].textContent.includes('Steam'), 'and it is the one making the steam');
  const primeIt = nodes($('#plan-steps'), 'step-acts')
    .flatMap((a) => a.children).find((b) => b.textContent === 'Prime instead');
  check(!!primeIt, 'and offers to make that trade the other way');

  primeIt.click();
  check(steps().length < before, `which drops the step (${before} -> ${steps().length})`);
  const charges = nodes($('#plan-side'), 'plan-item')
    .filter((n) => n.textContent.includes('never spent')).map((n) => n.dataset.material);
  check(charges.includes('Steam'), `and lays the steam in instead: ${charges.join(', ')}`);
  check(app.getPlan().credit.includes('Steam'),
        'held there by an explicit choice, which the solver will not overrule');

  // And back again, from the charge it created.
  const makeIt = nodes($('#plan-side'), 'plan-item')
    .filter((n) => n.dataset.material === 'Steam')
    .flatMap((n) => nodes(n, 'small')).find((b) => b.textContent === 'Make it instead');
  check(!!makeIt, 'the charge offers the reverse');
  makeIt.click();
  check(steps().length === before, 'which puts the step back');
  check(!app.getPlan().credit.includes('Steam'), 'and the choice with it');
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
  check(fetching.length && !fetching.some((n) => app.graph.categoryOf(n) === 'deposit'),
        `Molten Alumina asks for ore, not a deposit to melt in the ground: ${fetching.join(', ')}`);
  check(/Deposit (mines into|drops)/.test(text('#plan-side')),
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

/* ---------------------------------------------- a route run on the leavings */

// Both halves have to be legible: the step that says it is running on what the
// plan throws off, and the route list where two routes are live at once.
{
  app.setMode('plan');
  app.setPlan({
    ...emptyPlan(),
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite'], balance: false,
    pins: { Carbon: 'rx:Boudouard Equilibrium 500-725K' },
    selected: 'Carbon',
  });
  const steps = text('#plan-steps');
  check(/on the spare Carbon Monoxide/.test(steps),
        'the step says it is running on what the plan throws off');
  check(/the other 5 Carbon come from Bitter Oyster Spore/.test(steps),
        'and names what makes the rest');
  const side = text('#plan-side');
  check(/5 of the 9/.test(side) && /4 of the 9/.test(side),
        'the route list gives both live routes their share');
  check(/Stop recycling it/.test(side),
        'and the charge the loop needs is undone by dropping the route, not by adding a step');
  // Dropping it puts the plan back where it started.
  const stop = nodes($('#plan-side'), 'small').find((b) => b.textContent === 'Stop recycling it');
  stop.click();
  check(!app.getPlan().pins.Carbon, '"Stop recycling it" clears the pin that put it there');
  check(!/on the spare Carbon Monoxide/.test(text('#plan-steps')), 'and the step goes with it');
}

/* --------------------------------------- supplying part of it yourself */

// Two separate statements that have to compose: run this route on the spare,
// and the rest of that material is mine to bring.
{
  const BOUD = 'rx:Boudouard Equilibrium 500-725K';
  app.setMode('plan');
  app.setPlan({
    ...emptyPlan(),
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite'], balance: false,
    selected: 'Carbon',
  });
  const row = (label) => nodes($('#plan-side'), 'route-opt')
    .find((li) => li.textContent.includes(label));
  const spareBtn = () => {
    const li = row('Boudouard Equilibrium 500-725K');
    return li && nodes(li, 'small').find((b) => /spare/.test(b.textContent));
  };
  check(!!spareBtn(), 'a route the plan could feed from its leavings offers to be run on them');

  spareBtn().click();
  check(app.getPlan().alsoUse.includes(BOUD), '"Use the spare" is remembered as itself, not as a pin');
  check(/on the spare Carbon Monoxide/.test(text('#plan-steps')), 'and the step appears');

  // Now hand over the rest yourself.
  nodes(row('I have it'), 'route-pick')[0].click();
  check(app.getPlan().have.includes('Carbon'), 'saying you have the Carbon is a separate answer');
  check(app.getPlan().alsoUse.includes(BOUD), 'which does not turn the route off');
  check(/5\s*Carbon/.test(text('#goal-haves')),
        `the have row asks for the 5 you must supply, not the 9 the plan uses: ${text('#goal-haves')}`);
  check(/Nothing left to fetch/.test(text('#plan-side')), 'and there is nothing left to fetch');

  // A pin that was read as a surplus route is not a claim about how the
  // material is made, so "I have it" must not take it away with the pin.
  app.setPlan({
    ...emptyPlan(),
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite'], balance: false, pins: { Carbon: BOUD }, selected: 'Carbon',
  });
  nodes(row('I have it'), 'route-pick')[0].click();
  const after = app.getPlan();
  check(!after.pins.Carbon && after.alsoUse.includes(BOUD),
        'so it survives "I have it" as a route run on the spare');
  check(/5\s*Carbon/.test(text('#goal-haves')), 'reaching the same plan from the other side');
}

// The list of them rides in the URL like everything else the reader chose.
{
  const spec = { ...emptyPlan(), targets: [{ name: 'Carbon', amount: 1 }],
                 alsoUse: ['rx:Boudouard Equilibrium 500-725K'] };
  const params = new URLSearchParams();
  writePlan(spec, params);
  check(readPlan(params).alsoUse.join() === spec.alsoUse.join(),
        'a route run on the spare survives a reload');
  check(!readPlan(new URLSearchParams()).alsoUse.length, 'and an old link without one still reads');
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
  check(/gave up on Molten Niobium and Molten Tantalum/.test(side()),
        'and it says what the plan gave up on, since that is why you are reading it');

  const panel = nodes($('#plan-side'), 'ruled-out')[0];
  nodes(panel, 'small')[0].click();
  check(app.getPlan().excludeProcesses.length === 1,
        '"Allow it" takes one rejection back and leaves the others');
  check(/^17 steps/.test(text('#plan-steps')),
        `and the plan that was 2 steps of giving up is a plan again: ${text('#plan-steps').slice(0, 9)}`);

  app.setPlan({ ...emptyPlan(), targets: ['Vinegar'] });
  check(!/ruled out/.test(text('#plan-side')), 'with nothing ruled out the panel is not there');
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
  check(/Molten Silica/.test(text('#plan-side')), 'waste and all');
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

/* ------------------------- a stock, and something you can go on making */

{
  const amounts = () => nodes($('#goal-targets'), 'goal-amount').map((n) => n.value).join('/');
  const marks = () => nodes($('#goal-haves'), 'goal-kind');
  const four = ['Potassium', 'Lithium', 'Aluminum', 'Silicon']
    .map((name) => ({ name, amount: 1 }));

  app.setMode('plan');
  app.setPlan({ ...emptyPlan(), have: ['Lepidolite', 'Carbon'], targets: four });
  check(marks().length === 2 && marks().every((m) => m.textContent === 'all I have'),
        'a material named in the have box is taken as a stock');
  check(amounts() === '2/2/2/2', `so the Carbon holds the Silicon back: ${amounts()}`);

  marks()[1].click();
  check(app.getPlan().plenty.join() === 'Carbon' && marks()[1].textContent === 'as needed',
        'one press says you can get more of it');
  check(amounts() === '2/2/2/3', `and the third Silicon comes back: ${amounts()}`);
  check(/9\s*Carbon/.test(text('#goal-haves')),
        `with the chip saying how much the plan will want: ${text('#goal-haves')}`);

  // Waving something off the shopping list is not a statement about how much of
  // it you have, so it must not quietly become a limit.
  app.setPlan({ ...emptyPlan(), have: ['Lepidolite'], targets: four });
  check(amounts() === '2/2/2/3', 'starting from the balanced plan');
  nodes($('#plan-side'), 'small').find((b) => b.textContent === 'I have it').click();
  check(app.getPlan().plenty.includes('Bitter Oyster Spore'),
        '"I have it" on the shopping list means as much as it needs');
  check(amounts() === '2/2/2/3', `so the amounts do not move: ${amounts()}`);
}

// Only the plentiful ones need writing down; a stock is the plain reading.
{
  const params = new URLSearchParams();
  writePlan({ ...emptyPlan(), targets: [{ name: 'Tantalum', amount: 1 }],
              have: ['Columbite', 'Carbon'], plenty: ['Carbon'] }, params);
  check(params.get('pl') === 'Carbon' && readPlan(params).plenty.join() === 'Carbon',
        'which of them you can get more of survives a reload');
  check(!readPlan(new URLSearchParams('h=Lepidolite')).plenty.length,
        'and an old link reads as all stock, which is what it meant');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
