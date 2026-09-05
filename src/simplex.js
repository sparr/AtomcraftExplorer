/**
 * An exact linear program, small and honest.
 *
 * The planner needs to know how many times each step runs, and that is not a
 * question one pass can answer whenever two steps make the same thing. Told to
 * get rid of the carbon dioxide, a plan for Carbon has the Boudouard
 * equilibrium making it and a potassium reduction making it as well; size
 * either one first and it takes the whole demand, and the other is then sized
 * on top. Two runs of each where one of each would do, at twice the feed.
 *
 * Iterating that does not fix it. "Each covers what the others did not" is
 * satisfied by any pair adding up to the demand, including pairs adding up to
 * less, so the run counts settle somewhere feasible-looking and short. What is
 * missing is the constraint itself -- supply at least meets demand -- and once
 * that is written down the thing being asked for is a linear program:
 *
 *     minimise    c · x
 *     subject to  A x >= b ,  x >= lo
 *
 * Solved in exact rationals over BigInt, because the whole planner is: a run
 * count of a third is a real answer and 0.333... is not. Denominators are
 * cleared afterwards by scaling the batch, which the planner already does.
 *
 * These systems are tiny -- a Columbite plan is seventeen steps and a dozen
 * materials -- so the textbook tableau method is the right one. No Bland's
 * rule cleverness beyond the anti-cycling pivot choice, no sparse storage.
 */
import { rat, R0, radd, rsub, rmul, rdiv, rcmp, rzero } from './rational.js';

const R1 = rat(1);

/** Guards a degenerate problem from spinning: far above any real tableau. */
const MAX_PIVOTS = 5000;

/**
 * Minimise `c · x` subject to `rows` and `x >= lo`, in exact rationals.
 *
 * Each row is `{ coeffs: Map(varIndex -> rational), op: '>=' | '<=' | '=',
 * rhs: rational }`. Variables are numbered 0..n-1 and default to a lower bound
 * of zero; `lo` may raise any of them, which is how a step the reader insisted
 * on keeps its floor.
 *
 * Returns `{ ok, x, reason }`. `ok: false` means infeasible or unbounded and
 * the caller is expected to fall back rather than guess -- a plan is better
 * wrong in a way somebody can see than quietly made up.
 */
export function solveLP({ vars, rows, cost, lo = new Map() }) {
  // Shift every variable to sit at zero: x = lo + y, y >= 0. Simpler than
  // carrying bounds through the pivoting, and it costs one pass either side.
  const shift = (i) => lo.get(i) || R0;
  const shifted = rows.map((row) => {
    let rhs = row.rhs;
    for (const [i, a] of row.coeffs) rhs = rsub(rhs, rmul(a, shift(i)));
    return { coeffs: row.coeffs, op: row.op, rhs };
  });

  /**
   * Phase one wants every right-hand side non-negative, so a row that came out
   * negative is multiplied through -- which flips its comparison.
   */
  const flipped = shifted.map((row) => {
    if (rcmp(row.rhs, R0) >= 0) return row;
    const coeffs = new Map();
    for (const [i, a] of row.coeffs) coeffs.set(i, rsub(R0, a));
    const op = row.op === '>=' ? '<=' : row.op === '<=' ? '>=' : '=';
    return { coeffs, op, rhs: rsub(R0, row.rhs) };
  });

  /**
   * Columns: the real variables, then a surplus for each `>=`, then an
   * artificial for every row that needs one to start from.
   */
  const slackOf = new Map();
  const artOf = new Map();
  let width = vars;
  flipped.forEach((row, r) => {
    if (row.op !== '=') { slackOf.set(r, width); width++; }
  });
  const artificial = [];
  flipped.forEach((row, r) => {
    // A `<=` row starts with its own slack in the basis and needs nothing else.
    if (row.op === '<=') return;
    artOf.set(r, width);
    artificial.push(width);
    width++;
  });

  const table = flipped.map((row, r) => {
    const cells = new Array(width + 1).fill(R0);
    for (const [i, a] of row.coeffs) cells[i] = a;
    if (row.op === '>=') cells[slackOf.get(r)] = rat(-1);
    if (row.op === '<=') cells[slackOf.get(r)] = R1;
    if (artOf.has(r)) cells[artOf.get(r)] = R1;
    cells[width] = row.rhs;
    return cells;
  });

  const basis = flipped.map((row, r) => (artOf.has(r) ? artOf.get(r) : slackOf.get(r)));

  /** One pivot: make column `c` a unit column on row `r`. */
  const pivot = (r, c) => {
    const p = table[r][c];
    for (let j = 0; j <= width; j++) table[r][j] = rdiv(table[r][j], p);
    for (let i = 0; i < table.length; i++) {
      if (i === r) continue;
      const f = table[i][c];
      if (rzero(f)) continue;
      for (let j = 0; j <= width; j++) {
        table[i][j] = rsub(table[i][j], rmul(f, table[r][j]));
      }
    }
    basis[r] = c;
  };

  /**
   * Run the simplex for one objective, given as a cost per column.
   *
   * Bland's rule -- lowest index among the candidates, both entering and
   * leaving -- because it cannot cycle, and on tableaux this size nobody will
   * ever notice that it is the slow choice.
   */
  const run = (costOf, allowed) => {
    for (let step = 0; step < MAX_PIVOTS; step++) {
      // Reduced costs, with the basis priced out.
      const dual = new Array(width).fill(R0);
      for (let j = 0; j < width; j++) {
        let z = R0;
        for (let i = 0; i < table.length; i++) {
          const cb = costOf(basis[i]);
          if (!rzero(cb)) z = radd(z, rmul(cb, table[i][j]));
        }
        dual[j] = rsub(costOf(j), z);
      }
      let enter = -1;
      for (let j = 0; j < width; j++) {
        if (!allowed(j)) continue;
        if (rcmp(dual[j], R0) < 0) { enter = j; break; }
      }
      if (enter < 0) return true;

      let leave = -1;
      let best = null;
      for (let i = 0; i < table.length; i++) {
        const a = table[i][enter];
        if (rcmp(a, R0) <= 0) continue;
        const ratio = rdiv(table[i][width], a);
        if (best === null || rcmp(ratio, best) < 0 ||
            (rcmp(ratio, best) === 0 && basis[i] < basis[leave])) {
          best = ratio; leave = i;
        }
      }
      if (leave < 0) return false;   // unbounded along this column
      pivot(leave, enter);
    }
    return false;
  };

  // Phase one: drive the artificials out, or find the problem infeasible.
  if (artificial.length) {
    const art = new Set(artificial);
    const ok = run((j) => (art.has(j) ? R1 : R0), () => true);
    if (!ok) return { ok: false, reason: 'phase one did not settle' };
    let total = R0;
    for (let i = 0; i < table.length; i++) {
      if (art.has(basis[i])) total = radd(total, table[i][width]);
    }
    if (!rzero(total)) return { ok: false, reason: 'infeasible' };

    // Any artificial still in the basis sits at zero; pivot it out if it can
    // be, and otherwise the row is redundant and can be left alone.
    for (let i = 0; i < table.length; i++) {
      if (!art.has(basis[i])) continue;
      let swap = -1;
      for (let j = 0; j < width; j++) {
        if (art.has(j) || rzero(table[i][j])) continue;
        swap = j; break;
      }
      if (swap >= 0) pivot(i, swap);
    }
    // Then they are out of play for good.
    for (const j of artificial) {
      for (const row of table) row[j] = R0;
    }
  }

  // Phase two: the objective the caller actually asked about.
  const costAt = (j) => (j < vars ? (cost.get(j) || R0) : R0);
  const art = new Set(artificial);
  if (!run(costAt, (j) => !art.has(j))) {
    return { ok: false, reason: 'unbounded' };
  }

  const x = new Array(vars).fill(R0);
  for (let i = 0; i < table.length; i++) {
    if (basis[i] < vars) x[basis[i]] = table[i][width];
  }
  // Undo the shift: what the caller asked about was the real variable.
  for (let i = 0; i < vars; i++) x[i] = radd(x[i], shift(i));
  return { ok: true, x };
}
