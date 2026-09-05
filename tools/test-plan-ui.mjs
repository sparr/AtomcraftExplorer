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

const steps = nodes($('#plan-steps'), 'plan-step');
check(steps.length === 4, `Vinegar comes out as ${steps.length} steps`);
check(text('#plan-steps').includes('Acetic Acid'), 'naming the materials along the way');
check(text('#plan-goals').includes('Vinegar'), 'and the goal bar says what it is for');
check(text('#plan-side').includes('Death Moss Spore'), 'the side lists what to go and fetch');
check(text('#plan-side').includes('Blender'),
      'and the apparatus, which is where a catalyst belongs');
check(!nodes($('#plan-side'), 'plan-item').some((n) => n.textContent.startsWith('1 Blender')),
      'rather than on the shopping list');

// The frontier's "I have it" is the loop the whole mode is built around.
const fetchList = nodes($('#plan-side'), 'plan-item');
const spore = fetchList.find((n) => n.textContent.includes('Death Moss Spore'));
const haveIt = nodes(spore, 'small').find((b) => b.textContent === 'I have it');
check(!!haveIt, 'each thing to fetch offers "I have it"');
haveIt.click();
check(app.getPlan().have.includes('Death Moss Spore'), 'pressing it moves the material to have');
check(!text('#plan-side').includes('Death Moss Spore'), 'and off the shopping list');
check(text('#plan-goals').includes('Death Moss Spore'), 'into the goal bar');

// Excluding a step has to change the answer, not just grey something out.
const stepCount = nodes($('#plan-steps'), 'plan-step').length;
const notThis = nodes($('#plan-steps'), 'step-acts')[0].children[0];
notThis.click();
check(app.getPlan().excludeProcesses.length === 1, '"Not this" bans a process');
check(nodes($('#plan-steps'), 'plan-step').length !== stepCount ||
      text('#plan-steps') !== '', 'and the plan is worked out again around it');

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

// Back the other way: a material named in the plan opens in the explorer.
app.setMode('plan');
const link = nodes($('#plan-steps'), 'matlink')[0];
check(!!link, 'the plan links its materials');
link.click();
check(!$('#explore-main').hidden, 'and following one goes to the explorer');
check(!$('#back-to-plan').hidden, 'with a way back, now that there is a plan to go back to');

app.setPlan(emptyPlan());
check($('#back-to-plan').hidden, 'which is not offered when there is no plan');

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
