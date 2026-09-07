/**
 * The menu rules, on made-up numbers.
 *
 * Deliberately without a solver: what is being tested is which answers survive,
 * and feeding it real plans would make it slow and would mean a change in the
 * planner could fail this file for reasons that have nothing to do with it.
 * The numbers below are the shapes that actually turned up in the sweeps.
 */
import { SCORES, optionSets, measure, digest } from '../src/plan-menu.js';

let fail = 0;
const check = (ok, what) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
};

const tools = { matter: (n) => ({ Lepidolite: 22, 'Hydrofluoric Acid': 5, Water: 3 }[n] ?? 1),
                toNumber: (x) => x };
const plan = (frontier, byproducts, steps, batch) => ({
  spec: { targets: [{ name: 'X', amount: batch }] },
  frontier, byproducts,
  steps: steps.map((kind) => ({ process: { kind } })),
});

console.log('--- the option lattice ---');
const sets = optionSets(['a', 'b', 'c']);
check(sets.length === 7, 'three categories make seven non-empty combinations');
check(sets[0].length === 1, 'and the smallest come first, so the menu offers the least to switch on');
check(!sets.some((s) => !s.length), 'never the empty set, which can buy nothing');

console.log('\n--- scoring is per unit of target ---');
const two = measure(plan([{ name: 'Lepidolite', amount: 12 }], [], ['rx', 'rx', 'phase'], 6), tools);
check(two.atoms === 44, 'twelve Lepidolite at 22 atoms over a batch of six is 44 an item');
check(two.units === 2, 'and two items an item');
check(two.reactors === 2 && two.steps === 3, 'phase changes count as steps but not as reactors');
const same = measure(plan([{ name: 'Lepidolite', amount: 4 }], [], ['rx', 'rx', 'phase'], 2), tools);
check(same.atoms === two.atoms && same.units === two.units,
      'the same plan at a different batch size scores the same');
check(measure(plan([], [], [], 1), tools) === null, 'and a plan with no steps is not an answer');

console.log('\n--- duplicates collapse by outcome, not by options ---');
const twelve = [];
for (let i = 0; i < 12; i++) {
  twelve.push({ options: ['made', `x${i}`], plan: plan([{ name: 'Water', amount: 1 }], [], ['rx'], 1) });
}
const dup = digest(twelve, tools);
check(dup.distinct === 1, 'twelve option sets giving one answer are one row');
check(dup.menu.length === 1 && dup.menu[0].via.length === 12, 'and the row remembers all twelve ways in');

console.log('\n--- Pareto, because "minimal on something" is too loose ---');
// The Lepidolite shape: five plans tie on atoms, so all five are minimal on
// atoms, but one of them is better on reactors and steps with the rest equal.
const tied = [
  { options: ['farm'], plan: plan([{ name: 'Water', amount: 1 }], [], ['rx', 'rx', 'rx'], 1) },
  { options: ['made'], plan: plan([{ name: 'Water', amount: 1 }], [], ['rx'], 1) },
];
const cut = digest(tied, tools);
check(cut.distinct === 2, 'two distinct outcomes');
check(cut.menu.length === 1, 'but only one survives -- the other is beaten on reactors with all else equal');
check(cut.menu[0].via[0][0] === 'made', 'and it is the one with fewer reactors');

console.log('\n--- and a real trade-off is kept ---');
const trade = digest([
  { options: ['made'], plan: plan([{ name: 'Hydrofluoric Acid', amount: 3 }], [], ['rx'], 1) },
  { options: ['world'], plan: plan([{ name: 'Lepidolite', amount: 1 }], [], ['rx'], 1) },
], tools);
check(trade.menu.length === 2, 'fewer atoms against a shorter shopping list is not a beating');
const byAtoms = trade.menu.find((r) => r.best.includes('atoms'));
const byList = trade.menu.find((r) => r.best.includes('units'));
check(byAtoms && byList && byAtoms !== byList, 'and each row is labelled with what it wins');

console.log('\n--- what could not answer at all ---');
const barren = digest([{ options: ['farm'], plan: null },
                       { options: ['made'], plan: plan([{ name: 'Water', amount: 1 }], [], ['rx'], 1) }], tools);
check(barren.barren.length === 1 && barren.barren[0][0] === 'farm',
      'a combination with no route is reported, not silently dropped');
check(barren.menu.length === 1, 'and does not appear on the menu');

console.log('\n--- every score is used ---');
check(SCORES.every((s) => s.short && s.label && s.hint && (s.dir === 1 || s.dir === -1)),
      'each score has a name, a hint and a direction');
check(SCORES.filter((s) => s.dir === -1).map((s) => s.id).join() === 'left',
      'and leftovers is the only one where more is better');

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
