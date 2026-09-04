#!/usr/bin/env node
/**
 * Bake the extracted Atomcraft game data into a single compact bundle.
 *
 * Reads AllMaterials.json / AllReactions.json plus the Godot .translation
 * resources, merges in the localized display names, drops fields that are at
 * their default, and writes data/atomcraft.json for the browser app.
 *
 * Usage: node tools/build-data.mjs [--pck ../Atomcraft.pck] [--locale en]
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERIODIC_TABLE } from './elements.mjs';
import { loadTranslation, makeLookup } from './godot-translation.mjs';

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
                           'ConductanceDivisor', 'WireIndex', 'ActorFriction', 'LightRange']);

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
  const opts = { pck: join(ROOT, '..', 'Atomcraft.pck'), locale: 'en',
                 out: join(ROOT, 'data', 'atomcraft.json'), indent: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--indent') opts.indent = true;
    else if (a.startsWith('--')) opts[a.slice(2)] = argv[++i];
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = join(args.pck, 'Data');
  const readJson = (f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));

  const materials = readJson('AllMaterials.json');
  const reactions = readJson('AllReactions.json');
  const lookup = makeLookup(
    loadTranslation(join(dataDir, `LocalizedStrings.${args.locale}.translation`)));

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
}

main();
