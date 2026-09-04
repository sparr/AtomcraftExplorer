/**
 * Query parsing and ranking for material search.
 *
 * A query is whitespace-separated terms, ANDed together.  A term is either a
 * `field:value` filter or a bare word.  Bare words match names, formulas and
 * descriptions -- and, when the word reads as chemistry ("Cu", "H2O"), the
 * parsed composition as well, so `Cu` finds Chalcopyrite along with Copper.
 *
 * Quotes group a phrase: `name:"Molten Iron"`.
 */
import { querySymbols } from './formula.js';

export const FIELDS = {
  name: 'internal name only',
  el: 'contains element (symbol)',
  element: 'contains element (symbol)',
  formula: 'formula text',
  desc: 'description text',
  state: 'Solid | Liquid | Gas | Static | Plasma',
  z: 'proton number, e.g. z:26 or z:80-92',
  is: 'element, isotope, radioactive, burning, mechanical, hidden, buildable, mineable',
};

const SCORE = {
  exactDisplay: 1000,
  exactName: 950,
  exactFormula: 700,
  prefix: 600,
  wordStart: 420,
  substring: 260,
  formulaSubstring: 200,
  composition: 160,
  constituent: 140,
  description: 60,
};

/**
 * Split on whitespace, but a quoted run counts as one token even when the
 * quote opens mid-token -- `name:"Molten Iron"` is a single term.
 */
export const TERM_RE = /(?:"[^"]*"|[^\s"])+/g;

function tokenize(query) {
  return query.match(TERM_RE) || [];
}

const unquote = (s) => s.replace(/"/g, '');

export function parseQuery(query) {
  const terms = [];
  for (const tok of tokenize(query)) {
    const negate = tok.startsWith('-') && tok.length > 1;
    const body = negate ? tok.slice(1) : tok;
    const colon = body.indexOf(':');
    // A leading field name, but not "Al2O3:Cr" -- fields are all lowercase.
    if (colon > 0 && /^[a-z]+$/.test(body.slice(0, colon)) && body.slice(0, colon) in FIELDS) {
      terms.push({
        kind: 'field',
        field: body.slice(0, colon),
        value: unquote(body.slice(colon + 1)),
        negate,
      });
    } else if (unquote(body)) {
      terms.push({ kind: 'word', value: unquote(body), negate });
    }
  }
  return terms;
}

const IS_TESTS = {
  element: (m) => !!m.raw.ProtonNumber || /^MAT_ELEMENT_/.test(m.raw.LocIdName),
  isotope: (m) => !!m.raw.ProtonNumber,
  radioactive: (m) => !!m.raw.DecaySettings,
  burning: (m) => !!m.raw.IsBurning,
  mechanical: (m) => !!m.raw.IsMechanical,
  hidden: (m) => m.hidden,
  buildable: (m) => !!m.raw.BuildsInto,
  mineable: (m) => !!m.raw.MinesInto,
  interactable: (m) => !!m.raw.IsInteractable,
  unstable: (m) => !!m.raw.IsUnstable,
  food: (m) => !!m.raw.IsFoodIngredient,
  growing: (m) => !!m.raw.GrowthRules,
};

/** Field filters are pass/fail; they contribute no score. */
function matchField(db, m, term) {
  const v = term.value.toLowerCase();
  switch (term.field) {
    case 'name':
      return m.lcName.includes(v);
    case 'formula':
      return m.lcFormula.includes(v);
    case 'desc':
      return m.lcDescription.includes(v);
    case 'state':
      return m.state.toLowerCase().startsWith(v);
    case 'el':
    case 'element': {
      const sym = term.value[0]?.toUpperCase() + term.value.slice(1).toLowerCase();
      return !!m.formula?.counts.has(sym);
    }
    case 'z': {
      // Match isotopes by proton number, and also the element's own material,
      // which the data stores with ProtonNumber 0 (Iron is not an isotope).
      const range = /^(\d+)-(\d+)$/.exec(v);
      const lo = range ? +range[1] : Number(v);
      const hi = range ? +range[2] : Number(v);
      if (Number.isNaN(lo)) return false;
      const z = m.raw.ProtonNumber || 0;
      if (z >= lo && z <= hi && z > 0) return true;
      const el = m.raw.Formula && db.elementBySymbol.get(m.raw.Formula);
      return !!el && el.z >= lo && el.z <= hi && el.mat === m.name;
    }
    case 'is':
      return IS_TESTS[v] ? IS_TESTS[v](m) : false;
    default:
      return false;
  }
}

/** Best score a bare word achieves against one material, plus why. */
function matchWord(m, term, symbolSet) {
  const v = term.value.toLowerCase();
  let best = 0, why = '';
  const bump = (score, reason) => { if (score > best) { best = score; why = reason; } };

  if (m.lcDisplay === v) bump(SCORE.exactDisplay, 'name');
  if (m.lcName === v) bump(SCORE.exactName, 'name');
  if (m.lcFormula && m.lcFormula === v) bump(SCORE.exactFormula, 'formula');
  if (m.lcDisplay.startsWith(v) || m.lcName.startsWith(v)) bump(SCORE.prefix, 'name');
  if (new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(m.lcDisplay + ' ' + m.lcName)) {
    bump(SCORE.wordStart, 'name');
  }
  if (m.lcDisplay.includes(v) || m.lcName.includes(v)) bump(SCORE.substring, 'name');
  if (m.lcFormula.includes(v)) bump(SCORE.formulaSubstring, 'formula');

  // Chemistry reading: every element the term names must be present.
  const chem = term.chem !== undefined ? term.chem : (term.chem = querySymbols(term.value, symbolSet));
  if (chem && m.formula) {
    let all = true;
    for (const sym of chem.counts.keys()) if (!m.formula.counts.has(sym)) { all = false; break; }
    if (all) bump(SCORE.composition, 'composition');
  }

  // What the material is made of, which the formula often omits.
  if (m.lcConstituents.includes(v)) bump(SCORE.constituent, 'constituents');

  if (m.lcDescription.includes(v)) bump(SCORE.description, 'description');
  return { score: best, why };
}

/** Variants like "Aluminum Wire (Turning Off)" should sit below the real thing. */
function canonicalBonus(m) {
  let b = 0;
  if (!m.hidden) b += 40;
  if (!/\(/.test(m.name)) b += 25;
  if (m.name === m.display) b += 10;
  if (m.raw.Description) b += 15;
  // Log-scaled so a heavily-referenced material edges out an equal match
  // without ever outweighing a better one.
  b += Math.log2(1 + (m.refs || 0)) * 12;
  return b;
}

export function search(db, query, { limit = 250 } = {}) {
  const terms = parseQuery(query);
  const results = [];

  if (!terms.length) {
    for (const m of db.materials) results.push({ m, score: canonicalBonus(m), why: [] });
    results.sort((a, b) => b.score - a.score || a.m.display.localeCompare(b.m.display));
    return { terms, total: results.length, results: results.slice(0, limit) };
  }

  for (const m of db.materials) {
    let score = 0;
    const why = new Set();
    let ok = true;
    for (const term of terms) {
      let hit;
      if (term.kind === 'field') {
        hit = matchField(db, m, term);
        if (hit && !term.negate) why.add(term.field);
      } else {
        const r = matchWord(m, term, db.symbols);
        hit = r.score > 0;
        if (hit && !term.negate) { score += r.score; why.add(r.why); }
      }
      if (hit === term.negate) { ok = false; break; }
    }
    if (!ok) continue;
    results.push({ m, score: score + canonicalBonus(m), why: [...why] });
  }

  results.sort((a, b) =>
    b.score - a.score ||
    a.m.display.length - b.m.display.length ||
    a.m.display.localeCompare(b.m.display));

  return { terms, total: results.length, results: results.slice(0, limit) };
}
