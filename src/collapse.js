/**
 * Which detail sections the reader has collapsed, packed small enough to live
 * in the URL so the choice survives a reload (and can be linked).
 *
 * Every collapsible section has a fixed slot in COLLAPSIBLE; the collapsed set
 * is that list read as a bitmask, written in base 36.  Collapsing "Referenced
 * by" alone is `c=74`.
 */
import { REFERENCE_ORDER } from './data.js';

// Order is the wire format.  Append freely; never reorder or remove, or old
// URLs will decode to the wrong sections.
const SECTIONS = [
  'Composition', 'Nuclear', 'Thermal & fire', 'Consumed by', 'Produced by',
  'Catalyses', 'Transitions', 'Physical', 'Referenced by',
];
const SUBSECTIONS = ['Constituent materials', 'Drops', ...REFERENCE_ORDER];

export const COLLAPSIBLE = [
  ...SECTIONS.map((t) => `sec:${t}`),
  ...SUBSECTIONS.map((t) => `subsec:${t}`),
];

const SLOT = new Map(COLLAPSIBLE.map((key, i) => [key, i]));

/** Section title -> storage key. Counts vary per material, so drop them. */
export const collapseKey = (cls, title) => `${cls}:${title.replace(/\s*\(\d+\)\s*$/, '')}`;

/**
 * @param {Iterable<string>} keys collapsed section keys
 * @returns {string} base-36 bitmask, or '' when nothing is collapsed
 */
export function packCollapsed(keys) {
  let bits = 0n;
  for (const key of keys) {
    const slot = SLOT.get(key);
    if (slot !== undefined) bits |= 1n << BigInt(slot);   // unknown keys: session-only
  }
  return bits ? bits.toString(36) : '';
}

/** @returns {Set<string>} */
export function unpackCollapsed(text) {
  const out = new Set();
  if (!text) return out;
  let bits = 0n;
  for (const ch of text.toLowerCase()) {
    const digit = parseInt(ch, 36);
    if (Number.isNaN(digit)) return out;                 // junk in the URL: ignore
    bits = bits * 36n + BigInt(digit);
  }
  for (let i = 0; i < COLLAPSIBLE.length; i++) {
    if ((bits >> BigInt(i)) & 1n) out.add(COLLAPSIBLE[i]);
  }
  return out;
}
