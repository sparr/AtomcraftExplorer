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
  app.setPlan(addHave(addTarget(addTarget(emptyPlan(), 'Tantalum'), 'Niobium'), 'Columbite'));
  app.setMode('plan');
  const row = nodes($('#plan-side'), 'plan-item')
    .find((n) => n.dataset.material === 'Lepidolite');
  check(!!row, 'the Lepidolite is on the shopping list');
  check(/for .*Potassium Oxide/.test(row.textContent),
        `and the row says what it is for: ${row.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
  // Links, so the next press is the one the reader wanted.
  const links = nodes(row, 'matlink').map((a) => a.textContent);
  check(links.includes('Molten Potassium Oxide') && links.includes('Hydrofluoric Acid Gas'),
        `each one being a link to press: ${links.join(', ')}`);
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
  const narrow = amount();
  check(narrow === '2/2', `two of each on what the world hands over: ${narrow}`);

  app.setPlan({ ...ask, sources: ['world', 'weather', 'air', 'made'] });
  const wide = amount();
  check(wide !== narrow, `and something else once it may buy what is made: ${wide}`);

  // The same address, arrived at cold.
  globalThis.location.hash = '#mode=plan&t=Tantalum~Niobium&h=Columbite&sr=world~weather~air~made';
  app.reload();
  check(amount() === wide,
        `changing it gives what loading it gives: ${wide} against ${amount()}`);
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
  check(charges.includes('Steam') && charges.includes('Salt'),
        `the plan says what has to be in the chamber first: ${charges.join(', ')}`);
  check(/put in once, never spent/.test(text('#plan-side')),
        'and that it is not spent, so it is not a shopping list');
  // The one thing you can say back: not that one, start it some other way.
  const refuse = nodes($('#plan-side'), 'plan-item')
    .filter((n) => n.dataset.material === 'Steam')
    .flatMap((n) => nodes(n, 'small')).find((b) => b.textContent === 'Not this one');
  check(!!refuse, 'with a way to refuse a charge you would rather not lay in');
  refuse.click();
  check(app.getPlan().noPrime.includes('Steam'), 'which the solver is told about');
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

/* --------------------------------------- running a route on the leavings */

/**
 * Two separate statements that have to compose: run this route on the spare,
 * and the rest of that material is mine to bring.
 *
 * It used to be Carbon out of the spare Carbon Monoxide. The surviving solver
 * closes its carbon rather than leaving any, so the example is now the Steam
 * the Lepidolite decompositions hand back: ten of it, and condensing it is a
 * route to Water the plan could run for nothing.
 */
{
  const COND = 'cond:Steam';
  app.setMode('plan');
  app.setPlan({
    ...emptyPlan(),
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite'], balance: false, selected: 'Water',
  });
  const row = (label) => nodes($('#plan-side'), 'route-opt')
    .find((li) => li.textContent.includes(label));
  const spareBtn = () => {
    const li = row('Steam condenses into Water');
    return li && nodes(li, 'small').find((b) => /spare/.test(b.textContent));
  };
  check(!!spareBtn(), 'a route the plan could feed from its leavings offers to be run on them');

  spareBtn().click();
  check(app.getPlan().alsoUse.includes(COND),
        `"Use the spare" is remembered as itself: ${app.getPlan().alsoUse.join(', ')}`);
  check(/Steam condenses into Water/.test(text('#plan-steps')), 'and the step appears');

  // Saying you have some is a separate answer, and must not turn the route off.
  nodes(row('I have it'), 'route-pick')[0].click();
  check(app.getPlan().have.includes('Water'), 'saying you have the Water is a separate answer');
  check(app.getPlan().alsoUse.includes(COND), 'which does not turn the route off');
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
  check(/^21 steps/.test(text('#plan-steps')),
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

  app.setPlan({ ...ask, kept: ['Molten Silica'] });
  const side = text('#plan-side');
  check(/You also get/.test(side), 'claiming one gives the plan a second output panel');
  const also = side.split('You also get')[1].split('left over')[0];
  check(/Molten Silica/.test(also), `and the claimed row is the one in it: ${also.slice(0, 40)}`);
  // The waste panel, not the whole side: the shopping list names Molten Silica
  // too, as one of the things the Lepidolite is being fetched for.
  check(!/Molten Silica/.test(side.split('left over')[1] || ''),
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
  check(/Lepidolite/.test(shopping()), `the plan buys Lepidolite to start with: ${shopping().slice(0, 60)}`);
  check(/Not this one/.test(shopping()), 'and offers to be told not to');

  app.setPlan({ ...ask, noFetch: ['Lepidolite'] });
  check(!/\bLepidolite\b/.test(text('#plan-side').split('ruled out')[0]),
        'refused, it goes shopping somewhere else instead of giving up');
  check(/1 ruled out/.test(text('#plan-side')) && /may still make some/.test(text('#plan-side')),
        'and the refusal is listed with its way back');

  // The blunt version really is blunter: nothing may touch it at all.
  app.setPlan({ ...ask, excludeMaterials: ['Lepidolite'] });
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
  /**
   * Four times the ratio, because that is the batch it comes out at.
   *
   * Two, two, two and three is what the ore comes to, and 8/8/8/12 is that at
   * the size a whole run of it actually makes: one step lands on a quarter --
   * the water electrolysis, 21 runs to the order's 4 -- and the batch is the
   * lowest common multiple of every step's denominator. Asking for 2/2/2/3 is
   * quoted back at exactly this, so the balancer says what you get rather than
   * what you asked for before the rounding.
   */
  check(amounts() === '8/8/8/12',
        `one of each is shown as what the ore comes to, at the size it runs: ${amounts()}`);
  check(/12\s*Lepidolite/.test(text('#goal-haves')),
        `out of the ore that makes it: ${text('#goal-haves')}`);
  check(!/Molten Silica/.test(text('#plan-side')), 'with no Molten Silica left on the floor');

  // Off, and the numbers are yours again.
  balBtn().click();
  check(!app.getPlan().balance && amounts() === '1/1/1/1',
        `pressing it hands the amounts back: ${amounts()}`);
  check(/left over/.test(text('#plan-side')), 'waste and all');
  balBtn().click();
  check(amounts() === '8/8/8/12', 'and pressing again works them out afresh');

  // It stays on through a change, which is the point of it being a toggle.
  app.setPlan(removeTarget(app.getPlan(), 'Silicon'));
  check(app.getPlan().balance && /^\d+\/\d+\/\d+$/.test(amounts()) && amounts() !== '8/8/8/12',
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

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
