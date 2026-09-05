/**
 * Exact rationals over BigInt, and nothing else.
 *
 * Pulled out of the planner so the simplex can have them without importing the
 * thing it is solving for. No behaviour moved with them.
 */

/**
 * Exact rationals over BigInt.
 *
 * Run counts divide: one reaction makes 2 Molten Aluminum, so half a run makes
 * one. Floating point would turn a chain of those into 0.30000000000000004 of a
 * run and a bill of materials nobody trusts. Denominators are cleared at the
 * end by scaling the whole plan to a whole-numbered batch.
 */
const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b;
                        while (b) { const t = a % b; a = b; b = t; } return a; };

export function rat(n, d = 1n) {
  n = BigInt(n); d = BigInt(d);
  if (!d) throw new Error('rational with zero denominator');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

export const R0 = rat(0);
export const radd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const rsub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const rmul = (a, b) => rat(a.n * b.n, a.d * b.d);
export const rdiv = (a, b) => rat(a.n * b.d, a.d * b.n);
export const rcmp = (a, b) => { const l = a.n * b.d, r = b.n * a.d;
                                return l < r ? -1 : l > r ? 1 : 0; };
export const rmax = (a, b) => (rcmp(a, b) >= 0 ? a : b);
export const rmin = (a, b) => (rcmp(a, b) <= 0 ? a : b);
export const rnum = (a) => Number(a.n) / Number(a.d);
export const rzero = (a) => a.n === 0n;

/** "3", or "5/2" when it will not divide. */
export function rstr(a) {
  return a.d === 1n ? String(a.n) : `${a.n}/${a.d}`;
}

/** Least common multiple, for clearing a batch of its denominators. */
export const lcm = (a, b) => (a / gcd(a, b)) * b;
