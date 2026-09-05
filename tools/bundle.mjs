#!/usr/bin/env node
/**
 * Build a standalone single-file explorer.
 *
 * Browsers treat every file:// document as an opaque origin, so `fetch()` and
 * ES-module `import` are both blocked there -- which is the only reason the
 * modular version needs an HTTP server.  Neither restriction applies to a
 * classic <script> with its data already inside it, so this concatenates the
 * modules, the stylesheet and the baked JSON into one .html that opens by
 * double-clicking.
 *
 * Usage: node tools/bundle.mjs [--out dist/atomcraft-explorer.html]
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

const modName = (path) => basename(path, '.js').replace(/[^\w]/g, '_');

/** Resolve module load order by walking imports depth-first. */
function order(entry, seen = new Set(), out = []) {
  if (seen.has(entry)) return out;
  seen.add(entry);
  const src = read('src', entry);
  for (const m of src.matchAll(IMPORT_RE)) order(basename(m[2]), seen, out);
  out.push(entry);
  return out;
}

/**
 * `a, b as c` -> `a, b: c`.
 *
 * An import list and a destructuring pattern rename with different syntax, and
 * the difference is invisible: `const { render as renderPlan } = mod;` is not
 * an error the eye catches, it is a parse failure that stops the entire page.
 */
const destructure = (names) => names.split(',').map((n) => {
  const alias = n.trim().match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
  return alias ? `${alias[1]}: ${alias[2]}` : n.trim();
}).filter(Boolean).join(', ');

/** Wrap one module as an IIFE returning its exports, so names cannot collide. */
function wrap(file) {
  const src = read('src', file);
  const exports = [...src.matchAll(EXPORT_RE)].map((m) => m[1]);
  const body = src
    .replace(IMPORT_RE, (_, names, from) =>
      `const {${destructure(names)}} = __mod_${modName(from)};`)
    .replace(/^export\s+/gm, '');
  return `const __mod_${modName(file)} = (() => {\n${body}\n` +
         `return { ${exports.join(', ')} };\n})();`;
}

const args = process.argv.slice(2);
const given = args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : join('dist', 'atomcraft-explorer.html');
// Relative to the project, unless the caller names somewhere else outright --
// the bundle test builds into a temp directory to compare against the
// committed copy.
const outPath = isAbsolute(given) ? given : join(ROOT, given);

const modules = order('main.js');
const data = read('data', 'atomcraft.json');
const css = read('src', 'style.css');

// A </script> or <!-- inside the payload would end the script element early.
// JSON never uses '<' structurally, so escaping every one of them is safe.
const safeJson = data.replace(/</g, '\\u003c');
const code = modules.map(wrap).join('\n\n');
if (/<\/script/i.test(code)) throw new Error('module source contains </script');

// The transform only understands `import { a, b } from '...'`. Any other form
// -- a namespace import, a default import, a multi-line list -- falls through
// untouched, and a bare `import` inside a classic <script> is a syntax error
// that stops the whole page before a line of it runs. Silently. So the output
// is checked for anything the rewrite left behind.
const leftover = code.match(/^\s*(?:import|export)\b.*/m);
if (leftover) {
  throw new Error(`bundler does not understand this import form, and would emit ` +
    `a page that never runs:\n  ${leftover[0].trim()}\n` +
    `Use \`import { name } from './module.js';\` on one line.`);
}

// And the belt to that pair of braces: compile the result. A page that cannot
// be parsed shows its loading message forever, with nothing in the console and
// nothing in the DOM to say why, so this must never be written to disk.
try {
  new Function(code);          // compiled, not run
} catch (err) {
  throw new Error(`the bundled script does not parse: ${err.message}\n` +
    'Some module used a form the rewrite in wrap() does not handle.');
}

// Replacer *functions*, not strings: a literal payload would have its $&, $`
// and $' sequences substituted by String.replace.
let html = read('index.html')
  .replace(/^\s*<link rel="stylesheet"[^>]*>\s*$/m, () => `<style>\n${css}\n</style>`)
  .replace(/^\s*<script type="module"[^>]*><\/script>\s*$/m, () =>
           `<script>\nglobalThis.__ATOMCRAFT_BUNDLE__ = ${safeJson};\n\n${code}\n</script>`);

// Check the tags are gone, not that their paths never appear: the inlined CSS
// and JS may well mention them in a comment.
if (/<link[^>]+rel="stylesheet"/.test(html) || /<script[^>]+type="module"/.test(html)) {
  throw new Error('index.html markup changed -- bundler could not inline its assets');
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${(statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  inlined ${modules.length} modules: ${modules.join(', ')}`);
console.log('  open it directly -- no server needed');
