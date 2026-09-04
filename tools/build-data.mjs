#!/usr/bin/env node
/**
 * Bake the extracted Atomcraft game data into a single compact bundle.
 *
 * Locates an installed copy of the game, extracts the three files it needs from
 * the .pck with whichever Godot extractor is on PATH, merges the localized
 * display names into the material list, drops fields that are at their default,
 * and writes data/atomcraft.json for the browser app.
 *
 * Usage: node tools/build-data.mjs [options]
 *   --pck <file>        use this .pck instead of searching for the game
 *   --game-dir <dir>    search this install directory for the .pck
 *   --data-dir <dir>    skip extraction; read already-extracted files from here
 *   --steam-appid <id>  match this Steam appid instead of the game name
 *   --pck-tool <name>   force godotpcktool or GodotPCKExplorer.Console
 *   --locale <code>     translation locale to bake (default: en)
 *   --keep-extracted    leave the temp extraction in place, and print where
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, rmSync, readdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PERIODIC_TABLE } from './elements.mjs';
import { loadTranslation, makeLookup } from './godot-translation.mjs';
import { locateGamePck } from './locate-game.mjs';
import { findPckTool, KNOWN_TOOLS } from './pck-tool.mjs';
import { artFilter, collectArt } from './art.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

// Enum labels recovered from the data (the shipped .cs files are empty stubs).
const STATES = ['Solid', 'Liquid', 'Gas', 'Static', 'Plasma'];
const DIRECTIONS = ['None', 'Right', 'DownRight', 'Down', 'DownLeft',
                    'Left', 'UpLeft', 'Up', 'UpRight'];
const DECAY_MODES = { 0: 'Alpha', 1: 'Beta-minus', 2: 'Beta-plus', 6: 'Spontaneous fission' };

// A 0 here is a real value, not "unset" -- these fields are either nullable
// (so absent already means unset) or have a meaningful zero.
const KEEP_ZERO = new Set(['State', 'Density', 'ThermalConductivity',
                           'ConductanceDivisor', 'WireIndex', 'ActorFriction', 'LightRange',
                           // Enum members, where 0 names a case: DecaySettings.Mode 0
                           // is alpha decay, which 192 materials use.
                           'Mode']);

/** Drop nulls, falses and default zeroes; recurse into nested objects. */
function stripDefaults(obj) {
  const out = {};
  for (const [k, v0] of Object.entries(obj)) {
    let v = v0;
    if (v === null || v === undefined || v === false) continue;
    if (v === 0 && !KEEP_ZERO.has(k)) continue;
    if (Array.isArray(v)) {
      v = v.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? stripDefaults(x) : x));
      if (!v.length) continue;
    } else if (typeof v === 'object') {
      v = stripDefaults(v);
      if (!Object.keys(v).length) continue;
    }
    out[k] = v;
  }
  return out;
}

const ISOTOPE_RE = /^(.*?)-(\d+)$/;

/** Canonical periodic table, annotated with what the game actually models. */
function buildElementTable(materials) {
  const isotopes = new Map();
  for (const m of materials) {
    const z = m.ProtonNumber || 0;
    if (z > 0) {
      if (!isotopes.has(z)) isotopes.set(z, []);
      isotopes.get(z).push(m.Name);
    }
  }
  const byName = new Set(materials.map((m) => m.Name));

  return PERIODIC_TABLE.map(({ z, sym, name, row, col, alt }) => {
    const e = { z, sym, name, row, col };
    if (alt) e.alt = alt;
    if (byName.has(name)) e.mat = name;      // the plain-element material, when it exists
    if (isotopes.has(z)) e.isotopes = isotopes.get(z).sort();
    return e;
  });
}

function parseArgs(argv) {
  const opts = { locale: 'en', out: join(ROOT, 'data', 'atomcraft.json'),
                 indent: false, keepExtracted: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--indent') opts.indent = true;
    else if (a === '--keep-extracted') opts.keepExtracted = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase());
      opts[key] = argv[++i];
    }
  }
  return opts;
}

/** Recursive search, so we do not depend on how a given extractor lays out its output. */
function findFile(dir, name, depth = 4) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name === name) return join(dir, e.name);
  }
  if (depth <= 0) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const hit = findFile(join(dir, e.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Produce a directory holding the three files we need, plus a cleanup fn.
 * Either the caller already has them extracted, or we pull them out of the pck.
 */
async function obtainData(opts, wanted) {
  if (opts.dataDir) {
    console.log(`using already-extracted data: ${opts.dataDir}`);
    return { dir: opts.dataDir, cleanup: () => {} };
  }

  // Resolve the extractor first: a bad --pck-tool should fail before we spend
  // time hunting through Steam libraries.
  const tool = findPckTool(opts.pckTool);

  const { pck, source } = await locateGamePck(opts);
  console.log(`found ${pck}`);
  console.log(`  via ${source}`);

  const dir = mkdtempSync(join(tmpdir(), 'atomcraft-pck-'));
  // Anchored alternation over just the files we read; without filter support
  // this is ignored and the whole 234 MB pck comes out.
  const include = `(^Data/(${wanted.map((f) => f.replace(/[.]/g, '[.]')).join('|')})$|${opts.artFilter})`;
  console.log(`  extracting with ${tool.name}` +
              (tool.supportsFilter ? ' (filtered)' : ' (no filter support: full extract)'));
  tool.extract(pck, dir, { include });

  return {
    dir,
    cleanup: () => {
      if (opts.keepExtracted) console.log(`  extraction kept at ${dir}`);
      else rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const translation = `LocalizedStrings.${args.locale}.translation`;
  const wanted = ['AllMaterials.json', 'AllReactions.json', translation];

  args.artFilter = artFilter(PERIODIC_TABLE.map((e) => ({ name: e.name })));
  const { dir, cleanup } = await obtainData(args, wanted);
  let materials, reactions, lookup, artDir = null, collected = null;
  try {
    const locate = (f) => {
      const p = findFile(dir, f);
      if (!p) throw new Error(`${f} not found under ${dir}`);
      return p;
    };
    materials = JSON.parse(readFileSync(locate('AllMaterials.json'), 'utf8'));
    reactions = JSON.parse(readFileSync(locate('AllReactions.json'), 'utf8'));
    lookup = makeLookup(loadTranslation(locate(translation)));
    artDir = join(dir, '.godot', 'imported');
  } finally {
    if (artDir) collected = collectArt(artDir, buildElementTable(materials));
    cleanup();
  }

  const known = new Set(materials.map((m) => m.Name));
  const elements = buildElementTable(materials);

  let untranslated = 0;
  const outMaterials = materials.map((m) => {
    const rec = stripDefaults(m);
    const disp = lookup(m.LocIdName);
    if (disp === null) untranslated++;
    else if (disp !== m.Name) rec.Display = disp;
    if (ISOTOPE_RE.test(m.Name) && m.ProtonNumber) {
      rec.MassNumber = m.ProtonNumber + m.NeutronNumber;
    }
    return rec;
  });

  // Names referenced somewhere but never defined -- the app renders these as
  // dead links rather than pretending they resolve.
  const dangling = new Set();
  const note = (n) => { if (n && !known.has(n)) dangling.add(n); };

  for (const m of materials) {
    for (const f of ['TurnsIntoFromAlphaParticleImpact', 'TurnsIntoFromProtonImpact',
                     'TurnsIntoFromNeutronImpact', 'PickUpInto', 'MinesInto',
                     'BuildsInto', 'TurnsOnInto', 'TurnsOffInto', 'RotatesRightInto',
                     'RotatesLeftInto', 'GrowsInto', 'DissolvesInto',
                     'ProgrammableDelegate']) note(m[f]);
    for (const f of ['Condensation', 'Evaporation', 'Ignition']) {
      if (m[f]) note(m[f].TargetMaterialName);
    }
    if (m.DecaySettings) { note(m.DecaySettings.MaterialName); note(m.DecaySettings.MaterialName2); }
    if (m.Fire) {
      note(m.Fire.ExtinguishTargetMaterialName);
      for (const t of m.Fire.CombustionTargetMaterialNames || []) note(t);
    }
    for (const g of m.GrowthRules || []) note(g.GrowthMaterialName);
    for (const k of Object.keys(m.DropRates || {})) note(k);
    for (const e of m.Composition?.Elements || []) note(e.Item1);
  }
  for (const r of reactions) {
    note(r.PrimaryInput);
    for (const k of [...Object.keys(r.Inputs || {}), ...Object.keys(r.Outputs || {}),
                     ...Object.keys(r.Catalysts || {})]) note(k);
  }

  const bundle = {
    meta: { source: 'Atomcraft.pck', locale: args.locale,
            materials: outMaterials.length, reactions: reactions.length },
    enums: { State: STATES, Direction: DIRECTIONS, DecayMode: DECAY_MODES },
    elements,
    art: collected?.art ?? null,
    dangling: [...dangling].sort(),
    materials: outMaterials,
    reactions: reactions.map(stripDefaults),
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(bundle, null, args.indent ? 2 : undefined));

  const modelled = elements.filter((e) => e.mat || e.isotopes).length;
  console.log(`wrote ${args.out} (${(statSync(args.out).size / 1024).toFixed(1)} KB)`);
  console.log(`  materials ${outMaterials.length}  reactions ${reactions.length}  elements ${elements.length}`);
  console.log(`  untranslated LocIdName: ${untranslated}   dangling refs: ${dangling.size}`);
  console.log(`  elements with game materials: ${modelled} / ${elements.length}`);
  if (collected) {
    const a = collected.art;
    console.log(`  art: ${Object.keys(a.swatches).length} swatches, ` +
                `${Object.keys(a.tiles).length} element tiles, ` +
                `${Object.keys(a.symbols).length} symbol glyphs` +
                (a.patterns ? `, ${a.patterns.cols}x${a.patterns.rows} pattern sheet` : '') +
                (collected.missing ? ` (${collected.missing} elements had no tile)` : ''));
  }
}

main().catch((err) => {
  console.error(`build-data: ${err.message}`);
  process.exit(1);
});
