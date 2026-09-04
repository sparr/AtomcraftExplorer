/**
 * The pieces of the game's own art the explorer can use.
 *
 * Three kinds, and the third is weaker than the other two:
 *
 *   swatches  the shapes the game draws a material as -- a filled square for a
 *             solid, a droplet for a liquid, a puff for a gas. White masks,
 *             tinted with the material's Color.
 *   elements  a 16x16 tile per element, carrying its symbol and its family
 *             colour.
 *
 * Not carried: Art/Materials/GrayscaleMaterialTextures.png. Decompiling
 * Atomcraft.dll shows the 19 named ColorDelegates are procedural -- named noise
 * patterns lerped over the material's base colour, with no image sampling
 * anywhere in MaterialColorDelegates or MaterialColorIndex -- so there is no
 * material-to-tile mapping, and the sheet has nothing to say about a material.
 */
import { readCtex, dataUri, indexImported } from './ctex.mjs';

const SWATCHES = { Solid: 'material_swatch_solid', Liquid: 'material_swatch_liquid',
                   Gas: 'material_swatch_gas' };
/** Texture names to pull out of the pck, as a regex for the extractor. */
export function artFilter(elements) {
  const names = [
    ...Object.values(SWATCHES),
    ...elements.map((e) => `${e.name.toLowerCase()}_on`),
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

  const tiles = {};
  let missing = 0;
  for (const e of elements) {
    const tile = load(`${e.name.toLowerCase()}_on`);
    if (tile) tiles[e.sym] = tile; else missing++;
  }

  return { art: { swatches, tiles }, missing };
}
