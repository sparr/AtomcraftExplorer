/**
 * The same tableau in doubles, for finding out *which* steps a plan uses.
 *
 * The exact solver is the one to trust and it does not scale: three hundred
 * materials against six hundred columns of BigInt rationals is a quarter of a
 * million cells rewritten per pivot, and one solve of that runs for minutes.
 * Doubles do the same walk in well under a second.
 *
 * What comes back is not an answer. It is a shortlist -- the twenty or thirty
 * processes that came out non-zero -- and the exact solver is then asked the
 * same question about only those, which it can do in a moment. So the
 * arithmetic that decides run counts is still exact, and the arithmetic that
 * merely narrows the field is allowed to be approximate, because a wrong
 * shortlist costs a worse plan and never a wrong number.
 *
 * Deliberately not exported through `plan-solve.js`: nothing that reports a
 * quantity to the reader should be able to reach this by accident.
 */

/** Below this a coefficient is treated as gone, rather than very small. */
const EPS = 1e-9;

/** A column entry this small is not worth pivoting on, but bigger ones are. */
const PIVOT_MIN = 1e-11;

/** Far above any tableau this is asked for; a stuck problem stops here. */
const MAX_PIVOTS = 20000;

/**
 * `rows` and `cost` come in the same shape the exact solver takes, except that
 * every rational is a number. Returns `{ ok, x }` with `x` a plain array.
 */
/**
 * Whether phase one may bring an artificial back in.
 *
 * It should never need to: an artificial is scaffolding, there to give the
 * basis somewhere to start. Barring them is textbook and it made the Columbite
 * plan solvable in thirty-one milliseconds where it had been failing outright.
 * It also stopped the Lepidolite plan solving at all, which had been taking
 * forty-six. Both are real, so both are tried -- the barred walk first because
 * it is the one with a reason behind it, and the permissive one when that
 * comes back with nothing. Each costs tens of milliseconds; between them they
 * answer every plan tried here.
 */
export function solveLPFloat(problem) {
  // The first walk gets a short leash. When it is going to fail it fails by
  // pivoting in circles until the cap, and on the Lepidolite plan that was
  // seven seconds spent before the walk that works even started.
  return attempt(problem, true, 2000) || attempt(problem, false, MAX_PIVOTS) ||
         { ok: false, reason: 'neither walk settled' };
}

function attempt({ vars, rows, cost, lo = new Map() }, barred, budget) {
  const shift = (i) => lo.get(i) || 0;
  const prepared = rows.map((row) => {
    let rhs = row.rhs;
    for (const [i, a] of row.coeffs) rhs -= a * shift(i);
    let coeffs = row.coeffs;
    let op = row.op;
    if (rhs < 0) {                       // phase one wants a non-negative side
      const flip = new Map();
      for (const [i, a] of coeffs) flip.set(i, -a);
      coeffs = flip;
      op = op === '>=' ? '<=' : op === '<=' ? '>=' : '=';
      rhs = -rhs;
    }
    return { coeffs, op, rhs };
  });

  const slackOf = new Map();
  const artOf = new Map();
  let width = vars;
  prepared.forEach((row, r) => { if (row.op !== '=') { slackOf.set(r, width); width++; } });
  const artificial = [];
  prepared.forEach((row, r) => {
    if (row.op === '<=') return;
    artOf.set(r, width);
    artificial.push(width);
    width++;
  });

  const stride = width + 1;
  const table = new Float64Array(prepared.length * stride);
  prepared.forEach((row, r) => {
    const at = r * stride;
    for (const [i, a] of row.coeffs) table[at + i] = a;
    if (row.op === '>=') table[at + slackOf.get(r)] = -1;
    if (row.op === '<=') table[at + slackOf.get(r)] = 1;
    if (artOf.has(r)) table[at + artOf.get(r)] = 1;
    table[at + width] = row.rhs;
  });
  const height = prepared.length;
  const basis = prepared.map((row, r) => (artOf.has(r) ? artOf.get(r) : slackOf.get(r)));

  const pivot = (r, c) => {
    const at = r * stride;
    const p = table[at + c];
    for (let j = 0; j <= width; j++) table[at + j] /= p;
    for (let i = 0; i < height; i++) {
      if (i === r) continue;
      const row = i * stride;
      const f = table[row + c];
      if (f === 0 || Math.abs(f) < EPS) { table[row + c] = 0; continue; }
      for (let j = 0; j <= width; j++) table[row + j] -= f * table[at + j];
    }
    basis[r] = c;
  };

  /**
   * The reduced costs are carried, not recomputed.
   *
   * Working them out from the basis each time is a pass over the whole tableau
   * for every pivot, which is the same quarter of a million cells the exact
   * solver was being blamed for -- the doubles were not the slow part, the
   * bookkeeping was. Built once a phase and then dragged along by the same
   * elimination as every other row, choosing the entering column is a walk
   * down one array.
   */
  const run = (costOf, allowed) => {
    const dual = new Float64Array(width);
    for (let j = 0; j < width; j++) {
      let z = 0;
      for (let i = 0; i < height; i++) {
        const cb = costOf(basis[i]);
        if (cb !== 0) z += cb * table[i * stride + j];
      }
      dual[j] = costOf(j) - z;
    }
    const carry = (r, c) => {
      const f = dual[c];
      if (f === 0) return;
      const at = r * stride;
      for (let j = 0; j < width; j++) dual[j] -= f * table[at + j];
    };
    /**
     * A column with nowhere to pivot is not a verdict on the problem.
     *
     * The ratio test finds no row to leave when the entering column has no
     * positive entry, and calling that unboundedness is wrong in phase one,
     * where the objective is a sum of artificials and cannot run away
     * downwards. It only means this column cannot come in just now. Reported
     * as failure it sank the combined factory's model -- eight hundred and
     * sixty-one columns, both walks giving up inside a fifth of a second, and
     * the caller falling back to an exact solve that never finished.
     *
     * Set aside and try the next one. The set clears after any successful
     * pivot, because whether a column can be pivoted on is a fact about the
     * tableau and the tableau has just moved.
     */
    const dead = new Set();
    for (let step = 0; step < budget; step++) {
      let enter = -1;
      let best = -EPS;
      for (let j = 0; j < width; j++) {
        if (!allowed(j) || dead.has(j)) continue;
        if (dual[j] < best) { best = dual[j]; enter = j; }
      }
      if (enter < 0) return true;

      /**
       * A pivot may be small without being absent.
       *
       * Skipping every column entry under the comparison epsilon threw away
       * rows that were perfectly good to pivot on, and with none left the
       * ratio test said "unbounded" about a problem that was nothing of the
       * kind -- the Carbon plan, which the exact solver had already answered.
       * So the bar for "this row can leave" is far lower than the bar for
       * "this number is interesting".
       */
      /**
       * Among rows that tie, pivot on the biggest number.
       *
       * Ties are the normal case here -- most of these rows have a zero on the
       * right and every one of them gives a ratio of nothing -- and choosing
       * between them by row order is choosing by nothing at all. The largest
       * coefficient is the one that divides cleanest, which is the usual
       * defence against a walk that grinds round the same degenerate corner.
       */
      let leave = -1;
      let ratio = Infinity;
      let pivotAt = 0;
      for (let i = 0; i < height; i++) {
        const a = table[i * stride + enter];
        if (a <= PIVOT_MIN) continue;
        const r = table[i * stride + width] / a;
        if (r < ratio - EPS || (Math.abs(r - ratio) <= EPS && a > pivotAt)) {
          ratio = r; leave = i; pivotAt = a;
        }
      }
      /**
       * Steepest column only, and no anti-cycling rule.
       *
       * Bland's was tried and made things worse rather than better: the plans
       * that worked stopped working, because a rule that cannot cycle is not
       * the same as a rule that finds the answer. This is a shortlist and not
       * a verdict, so when it gives up the caller falls back to asking the
       * exact solver about everything -- slow, and right.
       */
      if (leave < 0) { dead.add(enter); continue; }
      pivot(leave, enter);
      carry(leave, enter);
      if (dead.size) dead.clear();
    }
    return false;
  };

  if (artificial.length) {
    const art = new Set(artificial);
    // An artificial is scaffolding: it is there to give the basis somewhere to
    // start, and once it has left there is never a reason to let it back.
    if (!run((j) => (art.has(j) ? 1 : 0), barred ? (j) => !art.has(j) : () => true)) return null;
    let total = 0;
    for (let i = 0; i < height; i++) if (art.has(basis[i])) total += table[i * stride + width];
    if (total > 1e-6) return null;
    for (let i = 0; i < height; i++) {
      if (!art.has(basis[i])) continue;
      let swap = -1;
      for (let j = 0; j < width; j++) {
        if (art.has(j) || Math.abs(table[i * stride + j]) < EPS) continue;
        swap = j; break;
      }
      if (swap >= 0) pivot(i, swap);
    }
    const live = (j) => !art.has(j);
    if (!run((j) => cost.get(j) || 0, live)) return null;
  } else if (!run((j) => cost.get(j) || 0, () => true)) {
    return null;
  }

  const x = new Array(vars).fill(0);
  for (let i = 0; i < height; i++) {
    if (basis[i] < vars) x[basis[i]] = table[i * stride + width];
  }
  for (let i = 0; i < vars; i++) {
    x[i] += shift(i);
    if (Math.abs(x[i]) < EPS) x[i] = 0;
  }
  return { ok: true, x };
}
