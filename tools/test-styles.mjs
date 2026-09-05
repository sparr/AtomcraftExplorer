/**
 * Every class the markup and the UI code create must have a rule in the
 * stylesheet.
 *
 * A span defaults to `display: inline`, and inline boxes ignore width and
 * height -- so an element whose rule never landed renders as nothing at all,
 * with no error anywhere. That is what happened to `.pattern-preview`: the icon
 * was in the DOM, with a valid background image, occupying no space.
 */
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('src/style.css');
// Every module, not a hand-kept list: a new file that renders anything is
// exactly where an unstyled class is most likely to appear.
const modules = readdirSync(new URL('../src', import.meta.url))
  .filter((f) => f.endsWith('.js')).map((f) => `src/${f}`);
const sources = ['index.html', ...modules].map(read).join('\n');

const used = new Set();
for (const m of sources.matchAll(/\bel\((?:'[^']*'|`[^`]*`),\s*'([^']+)'/g)) {
  m[1].split(/\s+/).forEach((c) => used.add(c));
}
for (const m of sources.matchAll(/classList\.add\('([^']+)'\)/g)) used.add(m[1]);
for (const m of sources.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => used.add(c));

const styled = (c) => new RegExp(`\\.${c.replace(/-/g, '\\-')}(?![\\w-])`).test(css);
const missing = [...used].filter((c) => c && !styled(c)).sort();

// Animations are declared in JS but must exist as keyframes.
const animations = [...sources.matchAll(/animation\s*=\s*`([\w-]+)/g)].map((m) => m[1]);
const missingFrames = animations.filter((n) => !new RegExp(`@keyframes\\s+${n}\\b`).test(css));

let fail = 0;
if (missing.length) {
  console.log(`FAIL  ${missing.length} classes are used but never styled: ${missing.join(', ')}`);
  fail++;
} else {
  console.log(`ok    all ${used.size} classes used in markup and code have a rule`);
}
if (missingFrames.length) {
  console.log(`FAIL  animations with no @keyframes: ${missingFrames.join(', ')}`);
  fail++;
} else if (animations.length) {
  console.log(`ok    ${animations.length} animation(s) have keyframes: ${animations.join(', ')}`);
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
