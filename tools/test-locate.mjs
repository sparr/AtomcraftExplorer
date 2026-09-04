/**
 * Game locators. Store lookups depend on what is installed on this machine, so
 * anything store-specific reports as skipped rather than failing elsewhere.
 */
import { LOCATORS, locateGamePck, GAME_NAME } from './locate-game.mjs';

let fail = 0;
const ok = (m) => console.log(`ok    ${m}`);
const bad = (m) => { console.log(`FAIL  ${m}`); fail++; };
const skip = (m) => console.log(`skip  ${m}`);

// --- order is the policy ----------------------------------------------------
const order = LOCATORS.map(([name]) => name);
if (order.join() !== 'explicit,steam,itch') {
  bad(`locator order is ${order.join(', ')}, want explicit, steam, itch`);
} else {
  ok(`locators run ${order.join(' -> ')}, so Steam wins when both stores have it`);
}

// --- every locator honours the same contract --------------------------------
for (const [name, locate] of LOCATORS) {
  let result;
  try {
    result = await locate({});
  } catch (err) {
    bad(`${name} threw instead of returning null: ${err.message}`);
    continue;
  }
  if (result === null) { skip(`${name}: ${GAME_NAME} not installed through it`); continue; }
  if (typeof result.source !== 'string' || !(result.dir || result.pck)) {
    bad(`${name} returned ${JSON.stringify(result)}, want { dir | pck, source }`);
  } else {
    ok(`${name} -> ${result.dir ?? result.pck}  (${result.source})`);
  }
}

// --- an explicit path always wins -------------------------------------------
{
  const found = await locateGamePck({}).catch(() => null);
  if (!found) {
    skip('no install found, cannot check that explicit overrides a store');
  } else {
    const viaExplicit = await locateGamePck({ pck: found.pck });
    if (viaExplicit.source !== 'explicit path') {
      bad(`--pck resolved via "${viaExplicit.source}", want the explicit locator`);
    } else if (viaExplicit.pck !== found.pck) {
      bad('--pck did not resolve to the path it was given');
    } else ok('an explicit --pck overrides both stores');
  }
}

// --- a missing game reports usefully ----------------------------------------
try {
  await locateGamePck({ pck: '/nonexistent/Nope.pck' });
  bad('a missing --pck did not throw');
} catch (err) {
  if (!/no such file/.test(err.message)) bad(`unhelpful error: ${err.message}`);
  else ok('a missing --pck says so');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
