#!/usr/bin/env node
/**
 * Recover the material shading tables from the game binary.
 *
 * A material's appearance is its base Color blended toward a tint by
 * `pattern[x % w][y % h] * amount`. The tables live in the compiled assembly,
 * not in the pck, so this decompiles `Atomcraft.MaterialColorDelegates` with
 * ilspycmd and writes the numbers out as src/patterns.js.
 *
 * Run it only to refresh that file against a new game build; the checked-in
 * copy is what the app uses, so neither the game nor ilspycmd is needed to
 * build the page.
 *
 * Usage: node tools/extract-patterns.mjs [--dll <path>] [--out src/patterns.js]
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locateGamePck } from './locate-game.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TYPE = 'Atomcraft.MaterialColorDelegates';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

async function findDll() {
  const given = arg('--dll');
  if (given) return given;
  const { pck } = await locateGamePck({});
  for (const dir of ['data_Atomcraft_windows_x86_64', 'data_Atomcraft_linuxbsd_x86_64', '.']) {
    const candidate = join(dirname(pck), dir, 'Atomcraft.dll');
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`no Atomcraft.dll next to ${pck}; pass --dll`);
}

/** Every `name = new float[h, w] { ... }` table, as numbers. */
function literalTables(src) {
  const out = {};
  const re = /(\w+)\s*=\s*new float\[(\d+),\s*(\d+)\]\s*\{([\s\S]*?)\};/g;
  for (const [, name, rows, cols, body] of src.matchAll(re)) {
    const values = [...body.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
    if (values.length !== Number(rows) * Number(cols)) continue;
    const grid = [];
    for (let r = 0; r < Number(rows); r++) grid.push(values.slice(r * cols, (r + 1) * cols));
    out[name] = grid;
  }
  return out;
}

/** Tables filled at run time, and how big they are. */
function generatedTables(src) {
  const out = {};
  for (const [, name, rows, cols] of src.matchAll(/(\w+)\s*=\s*new float\[(\d+),\s*(\d+)\];/g)) {
    out[name] = { rows: Number(rows), cols: Number(cols), random: true };
  }
  return out;
}

/**
 * Which pattern, tint and strength each named delegate is registered with.
 *
 * The registrations are dictionary entries shaped `{ "Name", (m) => Build…(m, …) }`.
 * Matching must stay inside one entry: a pattern that can cross a quote will
 * happily pair a name with the next entry's builder, which is how an earlier
 * version had Amethyst sampling MetallicShavings instead of twinkling.
 */
function delegates(src) {
  const out = {};
  // Two entry shapes: an expression lambda, and a statement body for the one
  // delegate that composes a pattern with a twinkle overlay.
  const ENTRY = /\{\s*"([A-Za-z]+)",\s*(?:\(BaseMaterial m\) =>|delegate\(BaseMaterial m\))([^"]*?)\n\s*\},?\n/g;
  for (const [, name, body] of src.matchAll(ENTRY)) {
    // A sparkle colour marks Twinkle, which may sit on top of a pattern.
    const twinkle = /Twinkle\([^)]*?Colors\.(\w+)\)/.exec(body);
    const call = /Build(\w+?)Sampler\(m,?\s*([^)]*)\)/.exec(body);
    if (call) {
      const parts = call[2].split(',').map((s) => s.trim()).filter(Boolean);
      const hasTable = parts[0] && /Pattern|Shavings/.test(parts[0]);
      out[name] = {
        builder: call[1],
        pattern: hasTable ? parts[0] : null,
        tint: hasTable ? (parts[1] || '').replace(/^Colors\./, '') || null : null,
        amount: hasTable && parts[2] ? Number(parts[2].replace(/f$/, '')) : null,
        arg: !hasTable && parts[0] ? Number(parts[0].replace(/f$/, '')) : null,
        twinkle: twinkle ? twinkle[1] : null,
        // SparklyMetal twinkles over its pattern, passing the sampler rather
        // than a colour, so the colour probe above does not see it.
        animated: /Twinkle\(/.test(body) || /Oscillating|CheckerPulse|Conveyor/.test(call[1]),
      };
      continue;
    }
    if (twinkle) {
      out[name] = { builder: 'Twinkle', pattern: null, tint: null, amount: null,
                    twinkle: twinkle[1], animated: true };
      continue;
    }
    const bare = /=>?\s*(\w+)\(/.exec(body) || /^\s*(\w+)\b/.exec(body);
    const builder = bare ? bare[1] : 'unknown';
    out[name] = { builder, pattern: null, tint: null, amount: null, twinkle: null,
                  animated: /CheckerPulse|Conveyor/.test(builder) };
  }
  return out;
}

const dll = await findDll();
const src = execFileSync('ilspycmd', ['-t', TYPE, dll], { encoding: 'utf8', maxBuffer: 64 << 20 });

const literal = literalTables(src);
const generated = generatedTables(src);
const specs = delegates(src);

const out = arg('--out', join(ROOT, 'src', 'patterns.js'));
writeFileSync(out, `/**
 * Material shading tables, recovered from the game binary.
 *
 * GENERATED by tools/extract-patterns.mjs -- edit that, not this.
 *
 * A material's colour is its base Color blended toward a tint by
 * \`table[y % rows][x % cols] * amount\`. Three tables are filled with random
 * values when the game starts rather than shipped, so they are described by
 * size here and generated to match.
 */
export const PATTERNS = ${JSON.stringify(literal, null, 2)};

export const RANDOM_PATTERNS = ${JSON.stringify(generated, null, 2)};

export const DELEGATES = ${JSON.stringify(specs, null, 2)};
`);

console.log(`wrote ${out}`);
console.log(`  literal tables:   ${Object.entries(literal).map(([n, g]) => `${n} ${g.length}x${g[0].length}`).join(', ')}`);
console.log(`  random tables:    ${Object.entries(generated).map(([n, g]) => `${n} ${g.rows}x${g.cols}`).join(', ')}`);
console.log(`  delegates:        ${Object.keys(specs).length}`);
