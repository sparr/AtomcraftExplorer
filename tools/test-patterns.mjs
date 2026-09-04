/** The shading tables recovered from the game binary, and the recipes built on them. */
import { readFileSync } from 'node:fs';
import { PATTERNS, RANDOM_PATTERNS, DELEGATES } from '../src/patterns.js';
import { recipeFor, patternStrip } from '../src/pattern-render.js';

const bundle = JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url)));
let fail = 0;
const ok = (m) => console.log(`ok    ${m}`);
const bad = (m) => { console.log(`FAIL  ${m}`); fail++; };

// --- the tables -------------------------------------------------------------
const shape = (t) => `${t.length}x${t[0].length}`;
const distinct = (t) => new Set(t.flat()).size;

// Measured in game: Granite is two shades in a 6x6 repeat. That is the anchor
// that says the extraction found the right table.
const granite = PATTERNS.GranitePattern;
if (!granite || shape(granite) !== '6x6' || distinct(granite) !== 2) {
  bad(`GranitePattern is ${granite ? `${shape(granite)} with ${distinct(granite)} values` : 'missing'}, want 6x6 with 2`);
} else ok('GranitePattern is 6x6 with 2 distinct values, as observed in game');

for (const [name, want] of [['MetallicShavings', '9x9'], ['CrystalPattern', '9x9'], ['BarkNoisePattern', '9x9']]) {
  if (!PATTERNS[name] || shape(PATTERNS[name]) !== want) bad(`${name} is not ${want}`);
}
ok(`${Object.keys(PATTERNS).length} literal tables: ` +
   Object.entries(PATTERNS).map(([n, t]) => `${n} ${shape(t)}/${distinct(t)}`).join(', '));

for (const [name, spec] of Object.entries(RANDOM_PATTERNS)) {
  if (!spec.random || spec.rows !== 64 || spec.cols !== 64) bad(`${name} is not a 64x64 random table`);
}
ok(`${Object.keys(RANDOM_PATTERNS).length} tables generated at run time, 64x64`);

// --- every delegate a material names must be known --------------------------
{
  const used = new Set(bundle.materials.map((m) => m.ColorDelegate).filter(Boolean));
  const missing = [...used].filter((n) => !DELEGATES[n]);
  if (missing.length) bad(`delegates used by materials but not extracted: ${missing.join(', ')}`);
  else ok(`all ${used.size} delegates in use are extracted (of ${Object.keys(DELEGATES).length} in the binary)`);

  const animated = Object.entries(DELEGATES).filter(([, d]) => d.animated).map(([n]) => n);
  if (animated.length < 9) bad(`only ${animated.length} delegates marked animated`);
  else ok(`animated: ${animated.join(', ')}`);

  // Each gem twinkles over its own colour. Reading that colour as the sparkle
  // instead of the base renders Ruby as a flat red square.
  for (const [gem, colour] of [['Ruby', 'Red'], ['Emerald', 'Green'], ['Sapphire', 'Blue'], ['Amethyst', 'Purple']]) {
    if (DELEGATES[gem]?.twinkle !== colour) bad(`${gem} twinkles over ${DELEGATES[gem]?.twinkle}, want ${colour}`);
  }
  ok('gems carry the colour they twinkle over');
}

// --- recipes ----------------------------------------------------------------
{
  const byName = new Map(bundle.materials.map((m) => [m.Name, { raw: m }]));
  const granitePentlandite = ['Granite', 'Pentlandite', 'Dolomite Deposit']
    .map((n) => recipeFor(byName.get(n)));
  if (!granitePentlandite.every((r) => r.spec?.pattern === 'GranitePattern')) {
    bad('Granite, Pentlandite and Dolomite Deposit do not share the Granite table');
  } else if (new Set(granitePentlandite.map((r) => r.base.join())).size !== 3) {
    bad('those three should differ only by base colour');
  } else ok('Granite, Pentlandite and Dolomite Deposit share one table, three base colours');

  const flat = recipeFor(byName.get('Water'));
  if (flat.spec) bad('Water should have no delegate');
  else ok('a material with no delegate resolves to a flat colour');

  // No canvas here, so rendering must decline rather than throw.
  if (patternStrip(byName.get('Granite'), { size: 8 }) !== null) {
    bad('patternStrip should return null without a canvas');
  } else ok('rendering degrades to null where there is no canvas');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
