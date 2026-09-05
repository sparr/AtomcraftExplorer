/**
 * Executes the standalone build the way a browser would: one classic script,
 * no fetch, no module loader.  Catches anything the IIFE wrapping broke.
 *
 * The committed bundle is checked against the sources first. `npm test` is
 * otherwise happy to pass against a build from an hour ago -- which it did,
 * once, while the page it described had already stopped loading at all.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDom } from './dom-shim.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'atomcraft-bundle-'));
const built = join(scratch, 'check.html');
try {
  execFileSync(process.execPath,
    [new URL('bundle.mjs', import.meta.url).pathname, '--out', built], { stdio: 'pipe' });
} catch (err) {
  rmSync(scratch, { recursive: true, force: true });
  console.log(`FAIL the bundler itself failed:\n${err.stderr?.toString() || err.message}`);
  process.exit(1);
}
const fresh = readFileSync(built, 'utf8');
rmSync(scratch, { recursive: true, force: true });

const committed = readFileSync(new URL('../dist/atomcraft-explorer.html', import.meta.url), 'utf8');
if (fresh !== committed) {
  console.log('FAIL dist/atomcraft-explorer.html is stale -- run: npm run bundle');
  process.exit(1);
}
console.log('ok    the committed bundle matches its sources');

const html = committed;
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
  // These check that search ranking survives bundling, so ask for relevance
  // order explicitly -- the default sort is alphabetical, which would only
  // ever confirm that "Water" sorts before "Wood".
  globalThis.location.hash = `#s=relevance&q=${encodeURIComponent(q)}`;
  app.reload();
  const first = results.children.find((r) => r.className.startsWith('row'))?.textContent ?? '';
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
