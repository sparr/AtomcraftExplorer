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

const tools = { matter: (n) => ({ Lepidolite: 22, 'Hydrofluoric Acid': 5, Water: 3,
                                 Ten: 10, Twenty: 20, Thirty: 30 }[n] ?? 1),
                toNumber: (x) => x };
// A step is a kind, or a kind and how often it runs -- `['rx', 40]` is one
// vessel turned forty times, which is one reactor and forty steps.
const plan = (frontier, byproducts, steps, batch, priming = []) => ({
  spec: { targets: [{ name: 'X', amount: batch }] },
  frontier, byproducts, priming,
  steps: steps.map((s) => (Array.isArray(s)
    ? { process: { kind: s[0] }, runs: s[1] }
    : { process: { kind: s } })),
});

console.log('--- the option lattice ---');
const sets = optionSets(['a', 'b', 'c']);
check(sets.length === 7, 'three categories make seven non-empty combinations');
check(sets[0].length === 1, 'and the smallest come first, so the menu offers the least to switch on');
check(!sets.some((s) => !s.length), 'never the empty set, which can buy nothing');

/**
 * Which ore a plan buys is part of which row it is.
 *
 * Two plans can score alike and still be different answers -- the same metals
 * out of a different rock -- and collapsing them loses the fork the menu
 * exists to show. So the ore joins the score in deciding whether two entries
 * are the same row, while leaving rows with no ore behaving exactly as before.
 */
console.log('\n--- the ore is part of the row ---');
{
  const one = plan([{ name: 'Ten', amount: 1 }], [], ['rx'], 1);
  const both = digest([{ options: ['a'], ore: 'Borax', plan: one },
                       { options: ['a'], ore: 'Boric Acid', plan: one }], tools);
  check(both.distinct === 2, 'two ores scoring alike are two rows, not one');
  check(both.menu.length === 2, 'and neither is beaten by the other');
  check(both.menu.every((r) => r.ore), 'each remembering which ore it buys');
  const plain = digest([{ options: ['a'], plan: one }, { options: ['b'], plan: one }], tools);
  check(plain.distinct === 1 && plain.menu[0].via.length === 2,
        'while rows with no ore still merge on score alone');
  check(plain.menu[0].ore === undefined, 'and carry no ore');
}

/**
 * Which order the answers were weighed in is not part of which row this is.
 *
 * Unlike the ore: two plans that score alike and buy different rocks are two
 * answers, and four weighings that reach the same one-reactor Carbon plan are
 * one answer offered four ways. So they merge on score, and each way in is
 * counted once.
 */
console.log('\n--- a weighing is a question, not an answer ---');
{
  // Cheap in atoms against cheap in reactors, so neither beats the other and
  // both are on the menu to be told apart.
  const one = plan([{ name: 'Ten', amount: 1 }], [], ['rx', 'rx', 'rx'], 1);
  const lean = plan([{ name: 'Twenty', amount: 1 }], [], ['rx'], 1);
  const same = digest([{ options: ['a'], plan: one },
                       { options: ['a'], weigh: 'reactors', plan: one },
                       { options: ['a'], weigh: 'charge', plan: one }], tools);
  check(same.distinct === 1, 'weighings that find the same answer are one row');
  check(same.menu.length === 1 && same.menu[0].via.length === 1,
        'and one way in, not three');
  const forked = digest([{ options: ['a'], plan: one },
                         { options: ['a'], weigh: 'reactors', plan: lean }], tools);
  check(forked.distinct === 2, 'while one that finds a different answer is its own row');
  check(forked.menu.some((r) => r.weigh === 'reactors'),
        'and remembers which order found it');
}

console.log('\n--- scoring is per unit of target ---');
const two = measure(plan([{ name: 'Lepidolite', amount: 12 }], [], ['rx', 'rx', 'phase'], 6), tools);
check(two.atoms === 44, 'twelve Lepidolite at 22 atoms over a batch of six is 44 an item');
check(two.units === 2, 'and two items an item');
/**
 * A phase change is not a step anybody counts.
 *
 * There was a `steps` column beside `reactors`, hinted as "reactors plus the
 * phase changes, which are free", and counting something you call free is what
 * it sounds like. It decided the one comparison that mattered: two Lepidolite
 * plans alike in ore, purchases, reactors and leavings, and the one that
 * condenses its steam rather than venting it scored a step worse for owning a
 * condenser, so the menu dropped the plan that needed nothing laid in. With
 * the phase changes out, `steps` was `reactors` spelled differently.
 */
check(two.reactors === 2, 'a phase change is not a reactor');
check(two.steps === 2 / 6, 'nor a step; the two real ones over a batch of six are a third each');
/**
 * Sparr: one reactor run four times is four steps.
 *
 * Which is why this is not `reactors` under another name. The column used to
 * be `plan.steps.length`, which counted neither the running nor the building:
 * a vessel turned forty times was one, and so was a condenser that costs
 * nothing to own.
 */
const turned = measure(plan([{ name: 'Ten', amount: 1 }], [], [['rx', 4], 'phase'], 1), tools);
check(turned.reactors === 1, 'one vessel is one reactor however often it turns');
check(turned.steps === 4, 'and four turns of it are four steps');
const same = measure(plan([{ name: 'Lepidolite', amount: 4 }], [], ['rx', 'rx', 'phase'], 2), tools);
check(same.atoms === two.atoms && same.units === two.units,
      'the same plan at a different batch size scores the same per unit');
check(two.batch === 6 && same.batch === 2, 'but the batch itself is a score, not a divisor');

/**
 * What has to be found before the plant will turn, which is not the shopping
 * list and is not per unit.
 *
 * Measured on the solver rather than assumed: the Lepidolite plan asks for one
 * Chlorine Gas and two Hydrogen Gas whether it is making two of each product
 * or six. Dividing it through would have said a bigger order needs less of it.
 */
console.log('\n--- the charge is a cost of its own ---');
{
  const bare = plan([{ name: 'Water', amount: 1 }], [], ['rx'], 2);
  const primed = plan([{ name: 'Water', amount: 1 }], [], ['rx'], 2,
                      [{ name: 'Ten', amount: 2 }]);
  check(measure(bare, tools).charge === 0, 'a plan needing nothing laid in is charged nothing');
  check(measure(primed, tools).charge === 20, 'and one that does is charged what it weighs');
  const both = digest([{ options: ['a'], plan: bare }, { options: ['b'], plan: primed }], tools);
  check(both.menu.length === 1 && both.menu[0].via[0][0] === 'a',
        'so a plan alike in all else but needing a charge is beaten');
  check(both.menu[0].best.includes('charge'), 'and the one that needs none says so');
}

/**
 * The trade the charge column exists for.
 *
 * Sparr's Lepidolite case: merging Water and Steam has the plan condense its
 * steam and reuse it, so nothing needs laying in -- and offers the answer in
 * batches of four rather than two. Neither beats the other, and before these
 * two columns existed the menu could not tell them apart at all.
 */
console.log('\n--- a charge against a batch is a real fork ---');
{
  // The real numbers: 18 runs a unit against 18.75, because closing the loop
  // means electrolysing three quarters more water per unit made.
  const vents = plan([{ name: 'Water', amount: 2 }], [], [['rx', 36]], 2,
                     [{ name: 'Ten', amount: 2 }]);
  const closes = plan([{ name: 'Water', amount: 4 }], [], [['rx', 75], ['phase', 24]], 4);
  const forked = digest([{ options: ['a'], plan: vents },
                         { options: ['a'], merge: 'Water', plan: closes }], tools);
  check(forked.menu.length === 2, 'the smaller batch and the smaller charge both survive');
  check(forked.menu.some((r) => r.merge === 'Water'), 'and the merged one remembers what it merged');
  const idle = plan([{ name: 'Water', amount: 2 }], [], [['rx', 36]], 2,
                    [{ name: 'Ten', amount: 2 }]);
  const nothing = digest([{ options: ['a'], plan: vents },
                          { options: ['a'], merge: 'Hydrofluoric Acid', plan: idle }], tools);
  check(nothing.menu.length === 1 && !nothing.menu[0].merge,
        'while a merge that changes nothing is not offered as a second answer');
}
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

console.log('\n--- which way the leavings are wanted is the reader\'s ---');
// Two plans alike in everything that counts, differing only in what they leave.
const tidy = { options: ['tidy'], plan: plan([{ name: 'Water', amount: 1 }], [], ['rx'], 1) };
const messy = { options: ['messy'], plan: plan([{ name: 'Water', amount: 1 }],
                                               [{ name: 'Water', amount: 1 }], ['rx'], 1) };
const fewer = digest([tidy, messy], tools);
check(fewer.menu.length === 1 && fewer.menu[0].via[0][0] === 'tidy',
      'by default the one that leaves less wins the draw');
const more = digest([tidy, messy], tools, { keepLeftovers: true });
check(more.menu.length === 1 && more.menu[0].via[0][0] === 'messy',
      'and asked to keep the leavings, the one that leaves more does');
/**
 * And the column says who leads it, in the direction asked for.
 *
 * This asked the opposite -- that no row is ever labelled best at leftovers --
 * which left one column on the board with nothing marked in it and no row ever
 * crediting it. Sparr read that as an oversight, which is how it looks.
 *
 * The decision behind the old check stands and is a different thing: leftovers
 * must never decide which answers survive, and `beats` still treats this as a
 * tie-break and nothing else. A plan cannot win a place on the menu by binning
 * what it bought. Saying which row leaves least is a remark about the board
 * rather than a reason to prefer it.
 */
check(fewer.menu[0].best.includes('left'),
      'wanting fewer leavings, the row that leaves least leads the column');
check(more.menu[0].best.includes('left'),
      'and wanting more, the row that leaves most does');

console.log('\n--- a row can be on the menu and best at nothing ---');
// Sparr found one: fewer reactors than the cheaper plan, fewer atoms than the
// one with the shorter list, so neither beats it and it is the compromise
// between them. It must survive, and it must be sayable why.
const middle = digest([
  // fewest atoms, fewest items, shortest list, nothing to lay in, smallest
  // batch -- but the most reactors
  { options: ['cheap'], plan: plan([{ name: 'Ten', amount: 1 }], [], ['rx', 'rx', 'rx', 'rx', 'rx'], 1) },
  // beaten on every one of those, and on none of the others
  { options: ['mid'], plan: plan([{ name: 'Twenty', amount: 2 }, { name: 'a', amount: 2 }],
                                 [{ name: 'a', amount: 2 }], ['rx', 'rx', 'rx'], 2,
                                 [{ name: 'Ten', amount: 1 }]) },
  // fewest reactors, most left over -- but the most atoms and the most to lay in
  { options: ['few'], plan: plan([{ name: 'Thirty', amount: 2 }, { name: 'a', amount: 2 },
                                  { name: 'b', amount: 2 }], [{ name: 'a', amount: 4 }], ['rx'], 2,
                                 [{ name: 'Ten', amount: 2 }]) },
], tools);
check(middle.menu.length === 3, 'all three are kept, none beating another outright');
const nowhere = middle.menu.filter((r) => !r.best.length);
check(nowhere.length === 1, 'and exactly one of them is the best at nothing');
check(nowhere[0].via[0][0] === 'mid', 'namely the one in the middle');

console.log('\n--- what could not answer at all ---');
const barren = digest([{ options: ['farm'], plan: null },
                       { options: ['made'], plan: plan([{ name: 'Water', amount: 1 }], [], ['rx'], 1) }], tools);
check(barren.barren.length === 1 && barren.barren[0][0] === 'farm',
      'a combination with no route is reported, not silently dropped');
check(barren.menu.length === 1, 'and does not appear on the menu');

console.log('\n--- every score is used ---');
check(SCORES.every((s) => s.short && s.label && s.hint && (s.dir === 1 || s.dir === -1)),
      'each score has a name, a hint and a direction');
check(SCORES.filter((s) => s.tiebreak).map((s) => s.id).join() === 'left',
      'and leftovers is the only one that merely settles draws');
check(SCORES.some((s) => s.id === 'steps' && s.id !== 'reactors'),
      'running and building are scored apart');
check(SCORES.some((s) => s.id === 'charge') && SCORES.some((s) => s.id === 'batch'),
      'what must be laid in and how big the batch is are both scored');
check(SCORES.filter((s) => !s.tiebreak).every((s) => s.dir === 1),
      'everything actually scored is a cost, where less is better');

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
