/**
 * The pieces of the game's own art the explorer can use.
 *
 * Three kinds, and the third is weaker than the other two:
 *
 *   swatches  the shapes the game draws a material as -- a filled square for a
 *             solid, a droplet for a liquid, a puff for a gas. White masks,
 *             tinted with the material's Color.
 *   elements  a 16x16 tile per element, carrying its symbol and its family
 *             colour, plus the bare symbol glyph.
 *   patterns  one 256x256 sheet of 64 tileable greyscale textures. Materials
 *             name a ColorDelegate ("Sand", "SparklyMetal", "CheckerPulse")
 *             which selects one, but nothing in the shipped data says which:
 *             the sheet is referenced only from compiled C#, and every .cs in
 *             the pck is a one-byte stub. So it is carried as a reference sheet
 *             rather than resolved per material.
 */
import { readCtex, dataUri, indexImported } from './ctex.mjs';

const SWATCHES = { Solid: 'material_swatch_solid', Liquid: 'material_swatch_liquid',
                   Gas: 'material_swatch_gas' };
const ATLAS = 'GrayscaleMaterialTextures';
const ATLAS_TILE = 32;

/** Texture names to pull out of the pck, as a regex for the extractor. */
export function artFilter(elements) {
  const names = [
    ...Object.values(SWATCHES),
    ATLAS,
    ...elements.flatMap((e) => [`${e.name.toLowerCase()}_on`, `element_symbol_${e.name.toLowerCase()}`]),
  ];
  return `\\.godot/imported/(${names.join('|')})\\.png-[0-9a-f]+\\.ctex`;
}

export function collectArt(importedDir, elements) {
  const index = indexImported(importedDir);
  const load = (name) => {
    const path = index.get(name);
    if (!path) return null;
    try {
      return dataUri(readCtex(path));
    } catch {
      return null;
    }
  };

  const swatches = {};
  for (const [state, name] of Object.entries(SWATCHES)) {
    const uri = load(name);
    if (uri) swatches[state] = uri;
  }

  const tiles = {}, symbols = {};
  let missing = 0;
  for (const e of elements) {
    const slug = e.name.toLowerCase();
    const tile = load(`${slug}_on`);
    const symbol = load(`element_symbol_${slug}`);
    if (tile) tiles[e.sym] = tile; else missing++;
    if (symbol) symbols[e.sym] = symbol;
  }

  const sheet = index.get(ATLAS) ? readCtex(index.get(ATLAS)) : null;
  const patterns = sheet ? {
    uri: dataUri(sheet),
    width: sheet.width,
    height: sheet.height,
    tile: ATLAS_TILE,
    cols: sheet.width / ATLAS_TILE,
    rows: sheet.height / ATLAS_TILE,
  } : null;

  return { art: { swatches, tiles, symbols, patterns }, missing };
}
