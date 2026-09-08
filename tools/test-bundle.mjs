/**
 * Executes the standalone build the way a browser would: one classic script,
 * no fetch, no module loader.  Catches anything the IIFE wrapping broke.
 *
 * The committed bundle is checked against the sources first. `npm test` is
 * otherwise happy to pass against a build from an hour ago -- which it did,
 * once, while the page it described had already stopped loading at all.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDom } from './dom-shim.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'atomcraft-bundle-'));
const built = join(scratch, 'check.html');
try {
  execFileSync(process.execPath,
    [new URL('bundle.mjs', import.meta.url).pathname, '--out', built], { stdio: 'pipe' });
} catch (err) {
  rmSync(scratch, { recursive: true, force: true });
  console.log(`FAIL the bundler itself failed:\n${err.stderr?.toString() || err.message}`);
  process.exit(1);
}
const fresh = readFileSync(built, 'utf8');
rmSync(scratch, { recursive: true, force: true });

const committed = readFileSync(new URL('../dist/atomcraft-explorer.html', import.meta.url), 'utf8');
if (fresh !== committed) {
  console.log('FAIL dist/atomcraft-explorer.html is stale -- run: npm run bundle');
  process.exit(1);
}
console.log('ok    the committed bundle matches its sources');

const html = committed;
installDom([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// The bundle must not reach the network -- that is the whole point of it.
globalThis.fetch = () => { throw new Error('the standalone build must not fetch()'); };

const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
if (!script) { console.log('FAIL no inline script found'); process.exit(1); }
console.log(`inline script: ${(script[1].length / 1024 / 1024).toFixed(2)} MB`);

let fail = 0;
try {
  new Function(script[1])();
} catch (err) {
  console.log(`FAIL bundle threw: ${err.message}`);
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 0));

const app = globalThis.window.explorer;
if (!app) { console.log('FAIL bundle did not boot'); process.exit(1); }
console.log(`ok    booted from embedded data: ${app.db.materials.length} materials`);

const results = document.querySelector('#results');
for (const [q, want] of [['water', 'Water'], ['H2O', 'Water'], ['Cu', 'Copper'],
                         ['el:Au', 'Gold'], ['state:plasma', 'Plasma Bullet']]) {
  // These check that search ranking survives bundling, so ask for relevance
  // order explicitly -- the default sort is alphabetical, which would only
  // ever confirm that "Water" sorts before "Wood".
  globalThis.location.hash = `#s=relevance&q=${encodeURIComponent(q)}`;
  app.reload();
  const first = results.children.find((r) => r.className.startsWith('row'))?.textContent ?? '';
  if (!first.startsWith(want)) { console.log(`FAIL "${q}" -> ${first.slice(0, 40)}`); fail++; }
  else console.log(`ok    "${q}" -> ${first.slice(0, 40)}`);
}

app.select(app.db.byName.get('Chalcopyrite') || app.db.materials[0]);
const detail = document.querySelector('#detail').textContent;
if (detail.length < 100) { console.log('FAIL detail pane did not render'); fail++; }
else console.log(`ok    detail pane renders (${detail.length} chars)`);
if (/\bnull\b/.test(detail)) { console.log('FAIL stray null in bundled detail pane'); fail++; }

/**
 * Plan mode, which is where the bundle broke and nothing here looked.
 *
 * Every check above this line stays in the explorer, and the explorer never
 * touches the rationals. So when `plan-solve` re-exported them in a form the
 * bundler did not understand and twelve names came through as `undefined`,
 * this file booted the page, searched it, opened a detail pane and reported
 * all clear -- while the plan tab said "rcmp is not a function".
 */
globalThis.location.hash = '#mode=plan&t=Carbon&h=Carbon+Dioxide';
let planSteps = '';
try {
  // Caught rather than left to throw: a missing import surfaces here as a bare
  // TypeError out of the render, and a stack trace on stderr is a worse
  // account of what went wrong than a line saying which name was undefined.
  app.reload();
  await new Promise((r) => setTimeout(r, 0));
  planSteps = document.querySelector('#plan-steps')?.textContent ?? '';
} catch (err) {
  console.log(`FAIL plan mode threw, which is what a name that never got ` +
              `exported looks like: ${err.message}`);
  fail++;
}
if (/is not a function|Failed to load/.test(document.body.textContent)) {
  console.log(`FAIL the page reports an error: ` +
    `${document.body.textContent.match(/[^.]*is not a function|Failed to load[^.]*/)?.[0]}`);
  fail++;
} else if (!/Potassium|Carbon/.test(planSteps) || planSteps.length < 40) {
  console.log(`FAIL plan mode rendered nothing: ${planSteps.slice(0, 60)}`);
  fail++;
} else {
  console.log(`ok    plan mode solves and renders (${planSteps.length} chars)`);
}

/**
 * The other solver, which is only reachable through the page by a checkbox.
 *
 * It is a separate module and a separate render path, so it can break in the
 * bundle exactly the way plan mode once did while everything above still
 * reports all clear. It fills in a plan shape the view was not written for --
 * a dag, a scale, an apparatus, a window on every step -- and a missing field
 * there surfaces as a bare TypeError out of the render.
 */
/**
 * Asked for something it has to go shopping for, which the first version of
 * this check was not.
 *
 * Carbon out of Carbon Dioxide buys nothing, so its shopping list is empty and
 * the loop that draws one never runs. The fresh solver was shipped with no
 * `feeds` on a frontier line and the side panel threw on every plan that
 * bought anything, while this file reported all clear. Columbite buys.
 */
globalThis.location.hash = '#mode=plan&t=Tantalum~Niobium&h=Columbite&fr=1';
let freshSteps = '';
let freshSide = '';
try {
  app.reload();
  await new Promise((r) => setTimeout(r, 0));
  freshSteps = document.querySelector('#plan-steps')?.textContent ?? '';
  freshSide = document.querySelector('#plan-side')?.textContent ?? '';
} catch (err) {
  console.log(`FAIL the fresh solver threw in the bundle: ${err.message}`);
  fail++;
}
if (!/to fetch/.test(freshSide)) {
  console.log(`FAIL the fresh solver drew no shopping list: ${freshSide.slice(0, 80)}`);
  fail++;
} else {
  console.log(`ok    and its shopping list and leavings draw (${freshSide.length} chars)`);
}
if (/is not a function|Cannot read propert/.test(document.body.textContent)) {
  console.log('FAIL the page reports an error with the fresh solver: ' +
    `${document.body.textContent.match(/[^.]*(?:is not a function|Cannot read propert)[^.]*/)?.[0]}`);
  fail++;
} else if (!/Tantalum|Niobium/.test(freshSteps) || freshSteps.length < 40) {
  console.log(`FAIL the fresh solver rendered nothing: ${freshSteps.slice(0, 60)}`);
  fail++;
} else {
  console.log(`ok    the fresh solver solves and renders (${freshSteps.length} chars)`);
}
if (freshSteps === planSteps) {
  console.log('FAIL the checkbox changed nothing -- both solvers rendered the same');
  fail++;
} else {
  console.log('ok    and answers differently from the older one, so the switch is live');
}
/**
 * The source categories, which only the fresh solver reads.
 *
 * Hidden while the older one answers, shown when the newer does, and actually
 * changing the answer -- a row of checkboxes that quietly does nothing is the
 * failure worth catching here.
 */
const srcBox = document.querySelector('#plan-sources');
if (!srcBox) {
  console.log('FAIL no #plan-sources in the built page');
  fail++;
} else {
  if (srcBox.hidden) { console.log('FAIL the source boxes are hidden for a fresh plan'); fail++; }
  else console.log(`ok    the source categories are offered (${srcBox.children.length} of them)`);

  globalThis.location.hash =
    '#mode=plan&t=Tantalum~Niobium&h=Columbite&fr=1&sr=weather~air~made';
  app.reload();
  await new Promise((r) => setTimeout(r, 0));
  const otherSide = document.querySelector('#plan-side')?.textContent ?? '';
  if (otherSide === freshSide) {
    console.log('FAIL changing the source categories changed nothing');
    fail++;
  } else {
    console.log('ok    and changing them changes what the plan goes shopping for');
  }
}

/**
 * Comparing the options, which is thirty-one solves behind one button.
 *
 * The cheap question here on purpose: what is being tested is that the button
 * is wired, that the sweep yields between solves rather than locking the page,
 * and that rows come out with numbers in them. A slow question would test the
 * solver, which has its own suite.
 */
/**
 * The options the newer solver does not read, greyed rather than live.
 *
 * Three switches that silently did nothing: feeding spare output back in,
 * narrowing a step's temperature, and laying a charge in. All three belong to
 * the older solver.
 */
for (const [hash, fresh] of [['#mode=plan&t=Carbon&h=Carbon+Dioxide&fr=1', true],
                             ['#mode=plan&t=Carbon&h=Carbon+Dioxide', false]]) {
  globalThis.location.hash = hash;
  app.reload();
  await new Promise((r) => setTimeout(r, 0));
  const bad = [];
  for (const id of ['feedback', 'avoid', 'charges']) {
    const box = document.querySelector(`#plan-${id}`);
    const label = document.querySelector(`#plan-${id}-opt`);
    if (!box || !label) { bad.push(`${id} missing`); continue; }
    if (!!box.disabled !== fresh) bad.push(`${id} disabled=${!!box.disabled}`);
    if (label.classList.contains('is-off') !== fresh) bad.push(`${id} greying wrong`);
  }
  if (bad.length) {
    console.log(`FAIL with the ${fresh ? 'newer' : 'older'} solver: ${bad.join(', ')}`);
    fail++;
  } else {
    console.log(`ok    the options it cannot read are ${fresh ? 'greyed' : 'live'} ` +
                `for the ${fresh ? 'newer' : 'older'} solver`);
  }
}

/**
 * Which way the leavings are wanted, which only the newer solver reads.
 *
 * Shown for it, put away for the older one, and reaching the address bar --
 * an option that does not survive a reload is an option nobody can share.
 */
globalThis.location.hash = '#mode=plan&t=Carbon&h=Carbon+Dioxide&fr=1';
app.reload();
await new Promise((r) => setTimeout(r, 0));
const primeBox = document.querySelector('#plan-prime');
const primeOpt = document.querySelector('#plan-prime-opt');
if (!primeBox || !primeOpt) {
  console.log('FAIL no borrow-a-want option in the built page');
  fail++;
} else if (primeOpt.hidden || primeBox.checked) {
  console.log('FAIL the borrow option is hidden or on by default for a fresh plan');
  fail++;
} else {
  primeBox.checked = true;
  primeBox.dispatch('change');
  await new Promise((r) => setTimeout(r, 0));
  if (!/pw=1/.test(globalThis.location.hash)) {
    console.log(`FAIL borrowing did not reach the address bar: ${globalThis.location.hash}`);
    fail++;
  } else {
    console.log('ok    borrowing a want to start with is offered and lands in the URL');
  }
  globalThis.location.hash = '#mode=plan&t=Carbon&h=Carbon+Dioxide&fr=1';
  app.reload();
  await new Promise((r) => setTimeout(r, 0));
}

const leftBox = document.querySelector('#plan-leftovers');
const leftOpt = document.querySelector('#plan-leftovers-opt');
if (!leftBox || !leftOpt) {
  console.log('FAIL no leftovers option in the built page');
  fail++;
} else if (leftOpt.hidden) {
  console.log('FAIL the leftovers option is hidden for a fresh plan');
  fail++;
} else if (leftBox.checked) {
  console.log('FAIL the leftovers option is on by default');
  fail++;
} else {
  leftBox.checked = true;
  leftBox.dispatch('change');
  await new Promise((r) => setTimeout(r, 0));
  if (!/lv=1/.test(globalThis.location.hash)) {
    console.log(`FAIL turning it on did not reach the address bar: ${globalThis.location.hash}`);
    fail++;
  } else {
    console.log('ok    the leftovers preference is offered and lands in the URL');
  }
}

globalThis.location.hash = '#mode=plan&t=Carbon&h=Carbon+Dioxide&fr=1';
app.reload();
await new Promise((r) => setTimeout(r, 0));
const menuBox = document.querySelector('#plan-menu');
const menuRun = document.querySelector('#plan-menu-run');
if (!menuBox || !menuRun) {
  console.log('FAIL no options-comparison panel in the built page');
  fail++;
} else if (menuBox.hidden) {
  console.log('FAIL the comparison panel is hidden for a fresh plan with a target');
  fail++;
} else {
  // The shim's querySelector is an id lookup, so everything below walks from
  // one. A class selector here would quietly match nothing and pass.
  const panel = document.querySelector('#plan-menu-body');
  const all = (cls) => [...panel.walk()].filter((n) => n.classList?.contains(cls));

  if (panel.children.length) {
    console.log('FAIL the sweep ran without being asked for');
    fail++;
  } else {
    console.log('ok    the comparison is offered but not run unasked');
  }

  menuRun.click();
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 0));
    if (/different answer/.test(
        document.querySelector('#plan-menu-status')?.textContent ?? '')) break;
  }
  const rows = all('menu-row');
  if (!rows.length) {
    console.log('FAIL the sweep produced no rows');
    fail++;
  } else if (!rows.some((r) => /\d/.test(r.textContent))) {
    console.log('FAIL the rows carry no numbers');
    fail++;
  } else if (!all('is-best').length) {
    console.log('FAIL no row is marked as best at anything');
    fail++;
  } else {
    console.log(`ok    comparing the options gives ${rows.length} row(s), each best at something`);
  }

  // And it can be put away again, or it is a table that never leaves.
  const shut = document.querySelector('#plan-menu-close');
  if (!shut) { console.log('FAIL no way to close the comparison'); fail++; }
  else if (shut.hidden) { console.log('FAIL the close control is hidden while rows are showing'); fail++; }

  // And picking one drives the plan, which is the whole point of the panel.
  const pick = rows.length
    ? [...rows[rows.length - 1].walk()].find((n) => n.tagName === 'BUTTON') : null;
  if (!pick) { console.log('FAIL no way to choose a row'); fail++; }
  else {
    pick.click();
    await new Promise((r) => setTimeout(r, 0));
    const now = [...document.querySelector('#plan-menu-body').walk()]
      .filter((n) => n.classList?.contains('is-current'));
    if (!now.length) {
      console.log('FAIL choosing a row did not become the current plan');
      fail++;
    } else {
      console.log('ok    and choosing one switches the plan to it');
    }
  }

  if (shut && !shut.hidden) {
    shut.click();
    await new Promise((r) => setTimeout(r, 0));
    const left = [...panel.walk()].filter((n) => n.classList?.contains('menu-row'));
    const runStill = document.querySelector('#plan-menu-run');
    if (left.length) { console.log('FAIL closing it left the rows behind'); fail++; }
    else if (!runStill || document.querySelector('#plan-menu').hidden) {
      console.log('FAIL closing it took the offer away too');
      fail++;
    } else if (!document.querySelector('#plan-menu-close').hidden) {
      console.log('FAIL the close control is still showing with nothing to close');
      fail++;
    } else {
      console.log('ok    and it can be put away, leaving the offer to ask again');
    }
  }
}

globalThis.location.hash = '#mode=plan&t=Carbon&h=Carbon+Dioxide';
app.reload();
await new Promise((r) => setTimeout(r, 0));
if (!document.querySelector('#plan-sources').hidden) {
  console.log('FAIL the source boxes are shown for a plan the older solver answered');
  fail++;
} else {
  console.log('ok    and are put away again when the older solver answers');
}

// And the arithmetic really did come across, rather than being quietly absent:
// amounts are rendered through the rationals, so a plan with none is a plan
// whose numbers never arrived.
if (!/\d/.test(planSteps)) { console.log('FAIL no amounts in the rendered plan'); fail++; }
else console.log('ok    with amounts, so the rationals came across');

// The stylesheet must have come along too.
if (!/\.pcell\s*\{/.test(html)) { console.log('FAIL stylesheet not inlined'); fail++; }
else console.log('ok    stylesheet inlined');

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
