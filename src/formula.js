/**
 * Parser for the chemical formula strings in AllMaterials.json.
 *
 * The strings are hand-written and messier than plain stoichiometry:
 *
 *   Al2O3            plain
 *   Al(OH)3          nested groups
 *   CaSO4·2H2O       hydrate dot with a coefficient
 *   AgNO3+H2O        aqueous, written with a plus
 *   H2O + CO2        ...sometimes with spaces
 *   (Cs,Na)AlSi2O6   a site that holds either element
 *   Al2SiO4(F,OH)2   ...where a branch is itself a group
 *   Al2O3:Cr         a dopant
 *   17% Co 83% Fe    an alloy given by weight
 *   X3Y2(SiO4)3      generic mineral placeholders
 *
 * Parsing yields an AST, which is then walked twice: once to total up element
 * counts for search, once to render subscripts for display.  Anything that is
 * not a known symbol is kept as an `unknown` node rather than dropped, so the
 * source string always round-trips.
 */

const SEGMENT_BREAKS = new Set(['+', '·', '.']);

const isUpper = (c) => c >= 'A' && c <= 'Z';
const isLower = (c) => c >= 'a' && c <= 'z';
const isDigit = (c) => c >= '0' && c <= '9';

class Parser {
  constructor(src, symbols) {
    this.s = src;
    this.i = 0;
    this.symbols = symbols;
  }

  number() {
    let start = this.i;
    while (this.i < this.s.length && isDigit(this.s[this.i])) this.i++;
    return this.i > start ? parseInt(this.s.slice(start, this.i), 10) : null;
  }

  /** Symbols are one or two letters; prefer the two-letter reading if real. */
  symbol() {
    const two = this.s.substr(this.i, 2);
    if (isLower(two[1] || '') && this.symbols.has(two)) {
      this.i += 2;
      return two;
    }
    const one = this.s[this.i];
    if (this.symbols.has(one) && !isLower(this.s[this.i + 1] || '')) {
      this.i += 1;
      return one;
    }
    // Not a symbol we know -- consume the whole capitalised word.
    let start = this.i++;
    while (this.i < this.s.length && isLower(this.s[this.i])) this.i++;
    return this.s.slice(start, this.i);
  }

  seq(stop) {
    const items = [];
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (stop && stop.includes(c)) break;

      if (c === '(' || c === '[') {
        this.i++;
        const close = c === '(' ? ')' : ']';
        const branches = [this.seq(',' + close)];
        while (this.s[this.i] === ',') {
          this.i++;
          branches.push(this.seq(',' + close));
        }
        if (this.s[this.i] === close) this.i++;
        items.push({ k: 'group', branches, n: this.number() ?? 1, open: c, close });
      } else if (isUpper(c)) {
        const sym = this.symbol();
        items.push({
          k: this.symbols.has(sym) ? 'el' : 'unknown',
          sym,
          n: this.number() ?? 1,
        });
      } else if (isDigit(c)) {
        const n = this.number();
        if (this.s[this.i] === '%') {
          this.i++;
          items.push({ k: 'pct', n });
        } else {
          items.push({ k: 'coeff', n });
        }
      } else {
        this.i++;
        items.push({ k: 'sep', text: c });
      }
    }
    return items;
  }
}

/** Sum element counts across the AST. `mult` carries group/coefficient scaling. */
function tally(items, mult, out, alternates) {
  let pending = mult;
  for (const node of items) {
    switch (node.k) {
      case 'coeff':
        pending = mult * node.n;      // applies to the rest of this segment
        break;
      case 'el':
        out.set(node.sym, (out.get(node.sym) || 0) + node.n * pending);
        break;
      case 'group': {
        const choice = node.branches.length > 1;
        for (const branch of node.branches) {
          // Alternatives are mutually exclusive in the real mineral, but for
          // search we want "could contain any of these", so count them all
          // and flag them.
          const sub = new Map();
          tally(branch, node.n * pending, sub, alternates);
          for (const [sym, n] of sub) {
            out.set(sym, (out.get(sym) || 0) + n);
            if (choice) alternates.add(sym);
          }
        }
        break;
      }
      case 'sep':
        if (SEGMENT_BREAKS.has(node.text)) pending = mult;
        break;
      default:
        break;
    }
  }
}

const cache = new Map();

/**
 * @param {string|null} src   raw Formula field
 * @param {Set<string>} symbols  known element symbols
 * @returns {{counts: Map<string,number>, symbols: string[], alternates: Set<string>,
 *            unknown: string[], ast: object[], raw: string}|null}
 */
export function parseFormula(src, symbols) {
  if (!src) return null;
  const hit = cache.get(src);
  if (hit) return hit;

  const ast = new Parser(src, symbols).seq(null);
  const counts = new Map();
  const alternates = new Set();
  tally(ast, 1, counts, alternates);

  const unknown = [];
  (function walk(items) {
    for (const n of items) {
      if (n.k === 'unknown') unknown.push(n.sym);
      else if (n.k === 'group') n.branches.forEach(walk);
    }
  })(ast);

  const result = {
    raw: src,
    ast,
    counts,
    symbols: [...counts.keys()],
    alternates,
    unknown: [...new Set(unknown)],
  };
  cache.set(src, result);
  return result;
}

/** Render an AST (or raw string) to HTML with proper subscripts. */
export function formulaHtml(parsed) {
  if (!parsed) return '';
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const sub = (n) => (n === 1 ? '' : `<sub>${n}</sub>`);

  const walk = (items) => items.map((node) => {
    switch (node.k) {
      case 'el':
        return `<span class="sym">${esc(node.sym)}</span>${sub(node.n)}`;
      case 'unknown':
        return `<span class="sym unknown-sym">${esc(node.sym)}</span>${sub(node.n)}`;
      case 'group':
        return esc(node.open) + node.branches.map(walk).join(',') +
               esc(node.close) + sub(node.n);
      case 'coeff':
        return String(node.n);
      case 'pct':
        return `${node.n}%`;
      default:
        return esc(node.text);
    }
  }).join('');

  return walk(parsed.ast);
}

/**
 * Read a user-typed query as chemistry.  Returns the element symbols it
 * mentions, or null when the text clearly is not a formula -- which is how the
 * search box decides whether to also match on composition.
 */
export function querySymbols(text, symbols) {
  const trimmed = text.trim();
  if (!trimmed || !/^[A-Za-z0-9()\[\]·.,+%: ]+$/.test(trimmed)) return null;
  if (!/[A-Z]/.test(trimmed)) return null;   // "water" is a name, not a formula
  const parsed = parseFormula(trimmed, symbols);
  if (!parsed || parsed.unknown.length || !parsed.counts.size) return null;
  return parsed;
}
