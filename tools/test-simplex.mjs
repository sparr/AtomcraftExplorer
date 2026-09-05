/**
 * The linear program, on its own.
 *
 * Nothing here knows what a reaction is. The planner's own arithmetic is
 * checked where the planner is; this is about whether the solver is a solver:
 * that it finds the optimum and not merely a feasible point, that it says so
 * when there is no optimum, and that it does all of it in exact rationals.
 */
import { solveLP } from '../src/simplex.js';
import { rat, rstr, rcmp, R0 } from '../src/rational.js';

let fail = 0;
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => { console.log(`FAIL  ${msg}`); fail++; };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

const row = (coeffs, op, rhs) =>
  ({ coeffs: new Map(coeffs.map(([i, n, d]) => [i, rat(n, d ?? 1n)])), op, rhs: rat(rhs) });
const at = (r) => r.x.map(rstr).join(', ');

console.log('--- the smallest thing that works ---');
{
  // minimise x, x >= 3
  const r = solveLP({ vars: 1, rows: [row([[0, 1]], '>=', 3)], cost: new Map([[0, rat(1)]]) });
  check(r.ok && rstr(r.x[0]) === '3', `x >= 3 minimises at 3: ${at(r)}`);
}
{
  // A `<=` row needs no artificial, and zero is already optimal.
  const r = solveLP({ vars: 1, rows: [row([[0, 1]], '<=', 5)], cost: new Map([[0, rat(1)]]) });
  check(r.ok && rstr(r.x[0]) === '0', `x <= 5 minimises at 0: ${at(r)}`);
}

console.log('\n--- two makers of one thing, which is why this exists ---');
{
  /**
   * The Carbon plan, written out. b runs of the Boudouard equilibrium and k of
   * the potassium reduction:
   *
   *   carbon:  b + k >= 2        both of them make one
   *   dioxide: b - k >= 0        the Boudouard makes what the reduction eats
   *   feed:    2b                two Carbon Monoxide a run, and minimise it
   *
   * A single pass gives whichever it reaches first the whole demand and lands
   * on b = k = 2, at four Carbon Monoxide. The answer is one of each.
   */
  const r = solveLP({
    vars: 2,
    rows: [row([[0, 1], [1, 1]], '>=', 2), row([[0, 1], [1, -1]], '>=', 0)],
    cost: new Map([[0, rat(2)]]),
  });
  check(r.ok && rstr(r.x[0]) === '1' && rstr(r.x[1]) === '1',
        `one run of each, on two Carbon Monoxide: b=${rstr(r.x[0])} k=${rstr(r.x[1])}`);

  // Ask for four and it scales, which the iterative version never did.
  const four = solveLP({
    vars: 2,
    rows: [row([[0, 1], [1, 1]], '>=', 4), row([[0, 1], [1, -1]], '>=', 0)],
    cost: new Map([[0, rat(2)]]),
  });
  check(four.ok && rstr(four.x[0]) === '2' && rstr(four.x[1]) === '2',
        `and four Carbon is two of each: b=${rstr(four.x[0])} k=${rstr(four.x[1])}`);
}

console.log('\n--- it finds the optimum, not just a feasible point ---');
{
  // minimise x + y with x + y >= 10 and x >= 2: any split does, cost is 10.
  const r = solveLP({
    vars: 2,
    rows: [row([[0, 1], [1, 1]], '>=', 10), row([[0, 1]], '>=', 2)],
    cost: new Map([[0, rat(1)], [1, rat(1)]]),
  });
  const total = r.ok ? rstr(rat(r.x[0].n * r.x[1].d + r.x[1].n * r.x[0].d, r.x[0].d * r.x[1].d)) : '?';
  check(r.ok && total === '10', `a tie is still the optimum: ${at(r)} totalling ${total}`);

  // Preferring the dearer one must not change the total, only the split.
  const skew = solveLP({
    vars: 2,
    rows: [row([[0, 1], [1, 1]], '>=', 10), row([[0, 1]], '>=', 2)],
    cost: new Map([[0, rat(5)], [1, rat(1)]]),
  });
  check(skew.ok && rstr(skew.x[0]) === '2' && rstr(skew.x[1]) === '8',
        `and a dearer variable is used as little as it may: ${at(skew)}`);
}

console.log('\n--- fractions survive, because run counts divide ---');
{
  // 2x >= 1 minimising x: the answer is a half, not 0.5000000000000001.
  const r = solveLP({ vars: 1, rows: [row([[0, 2]], '>=', 1)], cost: new Map([[0, rat(1)]]) });
  check(r.ok && rstr(r.x[0]) === '1/2', `a half is a half: ${at(r)}`);

  // A third, thirty times over, is exactly ten.
  const third = solveLP({ vars: 1, rows: [row([[0, 3]], '>=', 1)], cost: new Map([[0, rat(1)]]) });
  let sum = R0;
  for (let i = 0; i < 30; i++) sum = rat(sum.n * third.x[0].d + third.x[0].n * sum.d, sum.d * third.x[0].d);
  check(rstr(sum) === '10', `and thirty thirds are ten, not 9.999...: ${rstr(sum)}`);
}

console.log('\n--- floors, which is how an insisted-on step keeps its size ---');
{
  const r = solveLP({
    vars: 2,
    rows: [row([[0, 1], [1, 1]], '>=', 4)],
    cost: new Map([[0, rat(1)], [1, rat(1)]]),
    lo: new Map([[1, rat(3)]]),
  });
  check(r.ok && rcmp(r.x[1], rat(3)) >= 0,
        `a floor is honoured: ${at(r)}`);
  const total = rat(r.x[0].n * r.x[1].d + r.x[1].n * r.x[0].d, r.x[0].d * r.x[1].d);
  check(rstr(total) === '4', `and nothing is made beyond what was asked: ${rstr(total)}`);
}

console.log('\n--- and it says when there is no answer ---');
{
  // x >= 5 and x <= 2 at once.
  const r = solveLP({
    vars: 1,
    rows: [row([[0, 1]], '>=', 5), row([[0, 1]], '<=', 2)],
    cost: new Map([[0, rat(1)]]),
  });
  check(!r.ok && r.reason === 'infeasible', `contradictory rows are infeasible: ${r.reason}`);

  // Minimising -x with nothing holding it down.
  const un = solveLP({ vars: 1, rows: [row([[0, 1]], '>=', 1)], cost: new Map([[0, rat(-1)]]) });
  check(!un.ok && un.reason === 'unbounded', `and an unbounded objective says so: ${un.reason}`);
}

console.log('\n--- equalities, and a redundant row ---');
{
  const r = solveLP({
    vars: 2,
    rows: [row([[0, 1], [1, 1]], '=', 6), row([[0, 1], [1, -1]], '=', 2)],
    cost: new Map([[0, rat(1)], [1, rat(1)]]),
  });
  check(r.ok && rstr(r.x[0]) === '4' && rstr(r.x[1]) === '2',
        `two equalities pin it exactly: ${at(r)}`);

  // The same row twice must not upset the basis.
  const dup = solveLP({
    vars: 1,
    rows: [row([[0, 1]], '>=', 3), row([[0, 1]], '>=', 3)],
    cost: new Map([[0, rat(1)]]),
  });
  check(dup.ok && rstr(dup.x[0]) === '3', `and a row repeated is harmless: ${at(dup)}`);
}

console.log('\n--- a negative right-hand side, which has to be turned round ---');
{
  // -x >= -4, i.e. x <= 4. Minimising -x should sit it on the bound.
  const r = solveLP({
    vars: 1,
    rows: [row([[0, -1]], '>=', -4)],
    cost: new Map([[0, rat(-1)]]),
  });
  check(r.ok && rstr(r.x[0]) === '4', `flipped rows still bound: ${at(r)}`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
