/**
 * Executes the standalone build the way a browser would: one classic script,
 * no fetch, no module loader.  Catches anything the IIFE wrapping broke.
 */
import { readFileSync } from 'node:fs';
import { installDom } from './dom-shim.mjs';

const html = readFileSync(new URL('../dist/atomcraft-explorer.html', import.meta.url), 'utf8');
installDom([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// The bundle must not reach the network -- that is the whole point of it.
globalThis.fetch = () => { throw new Error('the standalone build must not fetch()'); };

const script = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
if (!script) { console.log('FAIL no inline script found'); process.exit(1); }
console.log(`inline script: ${(script[1].length / 1024 / 1024).toFixed(2)} MB`);

let fail = 0;
try {
  new Function(script[1])();
} catch (err) {
  console.log(`FAIL bundle threw: ${err.message}`);
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 0));

const app = globalThis.window.explorer;
if (!app) { console.log('FAIL bundle did not boot'); process.exit(1); }
console.log(`ok    booted from embedded data: ${app.db.materials.length} materials`);

const results = document.querySelector('#results');
for (const [q, want] of [['water', 'Water'], ['H2O', 'Water'], ['Cu', 'Copper'],
                         ['el:Au', 'Gold'], ['state:plasma', 'Plasma Bullet']]) {
  app.setQuery(q);
  const first = results.children[0]?.textContent ?? '';
  if (!first.startsWith(want)) { console.log(`FAIL "${q}" -> ${first.slice(0, 40)}`); fail++; }
  else console.log(`ok    "${q}" -> ${first.slice(0, 40)}`);
}

app.select(app.db.byName.get('Chalcopyrite') || app.db.materials[0]);
const detail = document.querySelector('#detail').textContent;
if (detail.length < 100) { console.log('FAIL detail pane did not render'); fail++; }
else console.log(`ok    detail pane renders (${detail.length} chars)`);
if (/\bnull\b/.test(detail)) { console.log('FAIL stray null in bundled detail pane'); fail++; }

// The stylesheet must have come along too.
if (!/\.pcell\s*\{/.test(html)) { console.log('FAIL stylesheet not inlined'); fail++; }
else console.log('ok    stylesheet inlined');

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
