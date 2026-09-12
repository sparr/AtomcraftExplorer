# Which materials are actually aqueous

Sparr: it should be possible to identify all of the true aqueous compounds by
some combination of their names, their reactions, and their interactions with
the water filter. There should be a bunch of materials of implied composition
"___+H2O" that have reactions and/or filter interactions to separate into ___
and H2O. Tell me if you can find them.

Found: **76 materials**, and the three signals do not agree, so it
matters which one is treated as the key.

## The key is the composition marker, not the name and not the formula

`+H2O` is a pseudo-material that appears as an entry in a `Composition`
(`plan-graph.js` already calls it `PSEUDO_WATER` and keeps it out of the
graph, since it carries an `Evaporation` and would otherwise offer itself as
a source of Steam nobody can hold). 76 materials carry it.

The name never disagrees with it: all 53 materials called `Aqueous ...` carry
the marker, with no exceptions in either direction. So the name is a sound
signal and just not a complete one -- 23 marked materials are called something
else, 14 of them the frozen states (`Frozen Aqueous Lithium Chloride` and
friends) and 9 of them vernacular: `Hydrobromic Acid`, `Limewater`, `Milk`,
`Mud`, `Orthophosphoric Acid`, `Seawater`, `Sulfurous Acid (Diluted)`,
`Vinegar`, and `Water (Carbonated)`.

There is one gap in the frozen set worth noticing: there is a
`Frozen Aqueous Sodium Bromide` and a `Frozen Aqueous Sodium Iodide` but no
chloride, because `NaCl+H2O` is called `Seawater`, and nothing freezes it.

The formula does not agree and cannot be used. Only 20 materials spell `+H2O`
in their own `Formula`; 11 marked ones write the dry formula bare, so
`Aqueous Lithium Sulfate` says `LiSO4`; and 47 marked ones have no `Formula`
at all. This is the same laxity that `assignMatter` has to tolerate, and the
reason element conservation is not enforced: evaporating an aqueous salt reads
as conjuring the steam, because the formula never carried the water.

## What the water filter will and will not take

The rule lives in `OnImpact` on `Water Filter` and `Block Water`, not in the
reaction list, and it is quoted in `plan-graph.js`: the composition must carry
the marker **and** have exactly two entries. One tile in, one tile of each half
out, whatever counts the composition states.

That splits the 76 in two:

- **69 the filter takes**, giving the dry half and Water.
- **7 it refuses**, because their compositions run to three or four
  entries.

Of the 69 it takes, 37 also have an evaporation
reaction, and 32 come apart *only* through the filter --
`Cream` out of `Milk` is the known example, and all 14 frozen
aqueous salts are in that group as well.

## The 7 with no way out at all

None of these has a separating reaction either, so the water in them cannot be
recovered by any means the data describes:

| Material | Composition | Route |
| --- | --- | --- |
| `Aqueous Nickel(II) Sulfate` | `Nickel, Sulfate Ion` | **no way out** |
| `Aqueous Silver Nitrate` | `Silver, Nitrogen, Oxygen` | **no way out** |
| `Aqueous Sodium Metavanadate` | `Sodium, Vanadium, Oxygen` | **no way out** |
| `Aqueous Sodium Sulfate` | `Sodium, Sulfur, Oxygen` | **no way out** |
| `Aqueous Sodium Tellurite` | `Sodium, Tellurium, Oxygen` | **no way out** |
| `Aqueous Zinc Sulfate` | `Zinc, Sulfate Ion` | **no way out** |
| `Orthophosphoric Acid` | `Hydrogen, Phosphorus, Oxygen` | **no way out** |

`Orthophosphoric Acid` is the extreme case: no reaction makes it, no reaction
uses it, and the filter will not take it. It is inert in every direction.

## Four more that are water-bearing without the marker

Three spellings hide outside the marker, all found by looking for the real
`Water` material as a composition entry rather than the pseudo-material:

- **A literal `+` entry.** Four compositions contain an entry named `+`, which
  is an author writing a mixture by hand. `Hydrofluoric Acid` and
  `Hydrofluoric Acid Crystals` are `Hydrogen, Fluorine, +, Water` with the
  formula `HF+H2O`; `Compacted Dirt` is `Sand, +, Water`. (The fourth,
  `Aqua Regia`, is `Hydrochloric Acid, +, Nitric Acid` -- a mixture with no
  water in it.) These two are also the only materials whose `Formula` says
  `+H2O` while the composition has no marker.
- **Middot hydrate notation.** `Pollucite` and `Pollucite Deposit` are
  `(Cs,Na)AlSi2O6·H2O` and name `Water` as an entry.
- **Neither.** `Gypsum` writes `CaSO4·2H2O` but its composition is purely
  elemental, so as far as the data goes its water is in the name only.

All of these fail the filter -- no marker, and too many entries besides. The
`Hydrofluoric Acid` composition summing to `H3FO` is the same oddity
`assignMatter` already has a comment about.

## A fourth signal, implemented and empty

`Serializable_MaterialType` carries a `DissolvesInto` field -- a list of
materials a tile splits into -- and `BaseMaterial.TryDissolve` implements it:
given enough empty tiles around it, the tile becomes the first entry and the
neighbours take the rest. It would be a general version of the water filter,
needing no filter block and no reaction.

It is null for all 1759 materials in the extracted pck and for all 1871 in the
current bake (`build-data.mjs` drops nulls and whitelists nothing, so absent
means null). And the only caller is `SulfuricAcidMaterial`, which reaches for
it on the tiles *next to* the acid -- so it is the acid-eats-a-neighbour hook
rather than anything a plan could ask for.

So: a real mechanism with no content behind it. Worth re-checking after a game
update, since it is the one way an aqueous separation could appear without
either a reaction or the filter, but nothing here should read it today.

## Aqueous is not a phase change

Worth saying plainly, because the phase-collapse work makes it tempting.
`Frozen Aqueous Lithium Chloride` to `Aqueous Lithium Chloride` *is* a phase
change and is already collapsed. `Aqueous Lithium Chloride` to
`Lithium Chloride` is not: a Water leaves, so the two are not the same
substance and a family that merged them would mint matter. Whatever handles
these has to account for the water, not hide it.

One consequence already visible: the eleven-ore Lithium Oxide question tries
`Lithium Sulfate` and `Aqueous Lithium Sulfate` as separate ores, and five
aqueous lithium salts as five more candidates that yield no plan at all.

## The 69 the filter takes

| Material | Dry half | Route |
| --- | --- | --- |
| `Aqueous Aluminum Bromide` | `Aluminum Bromide` | filter, evaporate |
| `Aqueous Aluminum Sulfate` | `Aluminum Sulfate` | filter, evaporate |
| `Aqueous Ammonia` | `Ammonia` | filter |
| `Aqueous Ammonium Bromide` | `Ammonium Bromide` | filter, evaporate |
| `Aqueous Ammonium Chloride` | `Ammonium Chloride` | filter, evaporate |
| `Aqueous Ammonium Iodide` | `Ammonium Iodide` | filter, evaporate |
| `Aqueous Bromine` | `Bromine Gas` | filter, evaporate |
| `Aqueous Calcium Chloride` | `Calcium Chloride` | filter, evaporate |
| `Aqueous Calcium Nitrate` | `Calcium Nitrate` | filter, evaporate |
| `Aqueous Chlorine` | `Chlorine Gas` | filter, evaporate |
| `Aqueous Copper(II) Chloride` | `Copper(II) Chloride` | filter, evaporate |
| `Aqueous Copper(II) Sulfate` | `Copper Sulfate` | filter |
| `Aqueous Iodine` | `Iodine Gas` | filter, evaporate |
| `Aqueous Iron Bromide` | `Iron Bromide` | filter, evaporate |
| `Aqueous Iron(II) Sulfate` | `Iron(II) Sulfate` | filter, evaporate |
| `Aqueous Lead Bromide` | `Lead Bromide` | filter, evaporate |
| `Aqueous Lead Sulfate` | `Lead Sulfate` | filter, evaporate |
| `Aqueous Lithium Bromide` | `Lithium Bromide` | filter, evaporate |
| `Aqueous Lithium Chloride` | `Lithium Chloride` | filter, evaporate |
| `Aqueous Lithium Hydroxide` | `Lithium Hydroxide` | filter |
| `Aqueous Lithium Iodide` | `Lithium Iodide` | filter, evaporate |
| `Aqueous Lithium Sulfate` | `Lithium Sulfate` | filter, evaporate |
| `Aqueous Lye` | `Lye` | filter, evaporate |
| `Aqueous Magnesium Bromide` | `Magnesium Bromide` | filter, evaporate |
| `Aqueous Magnesium Sulfate` | `Magnesium Sulfate` | filter, evaporate |
| `Aqueous Manganese(II) Sulfate` | `Manganese(II) Sulfate` | filter |
| `Aqueous Nickel Sulfate` | `Nickel Sulfate` | filter |
| `Aqueous Potash` | `Potash` | filter, evaporate |
| `Aqueous Potassium Bromide` | `Potassium Bromide` | filter, evaporate |
| `Aqueous Potassium Chloride` | `Potassium Chloride` | filter, evaporate |
| `Aqueous Potassium Fluoride` | `Potassium Fluoride` | filter |
| `Aqueous Potassium Heptafluoroniobate(V)` | `Potassium Heptafluoroniobate(V)` | filter |
| `Aqueous Potassium Heptafluorotantalate(V)` | `Potassium Heptafluorotantalate(V)` | filter |
| `Aqueous Potassium Hydroxide` | `Potassium Hydroxide` | filter, evaporate |
| `Aqueous Potassium Iodide` | `Potassium Iodide` | filter, evaporate |
| `Aqueous Potassium Nitrate` | `Potassium Nitrate Powder` | filter, evaporate |
| `Aqueous Potassium Sulfate` | `Potassium Sulfate` | filter, evaporate |
| `Aqueous Sodium Aluminate` | `Sodium Aluminate` | filter |
| `Aqueous Sodium Bromide` | `Sodium Bromide` | filter, evaporate |
| `Aqueous Sodium Carbonate` | `Sodium Carbonate` | filter, evaporate |
| `Aqueous Sodium Iodide` | `Sodium Iodide` | filter, evaporate |
| `Aqueous Sodium Nitrate` | `Sodium Nitrate` | filter |
| `Aqueous Sulfur Dioxide` | `Sulfur Dioxide Gas` | filter |
| `Aqueous Tin Bromide` | `Tin Bromide` | filter, evaporate |
| `Aqueous Tin Sulfate` | `Tin Sulfate` | filter, evaporate |
| `Aqueous Zinc Bromide` | `Zinc Bromide` | filter, evaporate |
| `Aqueous Zinc Chloride` | `Zinc Chloride` | filter, evaporate |
| `Frozen Aqueous Ammonium Bromide` | `Ammonium Bromide` | filter |
| `Frozen Aqueous Ammonium Chloride` | `Ammonium Chloride` | filter |
| `Frozen Aqueous Ammonium Iodide` | `Ammonium Iodide` | filter |
| `Frozen Aqueous Bromine` | `Bromine Gas` | filter |
| `Frozen Aqueous Chlorine` | `Chlorine Gas` | filter |
| `Frozen Aqueous Iodine` | `Iodine Gas` | filter |
| `Frozen Aqueous Lithium Bromide` | `Lithium Bromide` | filter |
| `Frozen Aqueous Lithium Chloride` | `Lithium Chloride` | filter |
| `Frozen Aqueous Lithium Iodide` | `Lithium Iodide` | filter |
| `Frozen Aqueous Potassium Bromide` | `Potassium Bromide` | filter |
| `Frozen Aqueous Potassium Chloride` | `Potassium Chloride` | filter |
| `Frozen Aqueous Potassium Iodide` | `Potassium Iodide` | filter |
| `Frozen Aqueous Sodium Bromide` | `Sodium Bromide` | filter |
| `Frozen Aqueous Sodium Iodide` | `Sodium Iodide` | filter |
| `Hydrobromic Acid` | `Hydrogen Bromide` | filter |
| `Limewater` | `Slaked Lime` | filter |
| `Milk` | `Cream` | filter |
| `Mud` | `Dirt` | filter |
| `Seawater` | `Salt` | filter, evaporate |
| `Sulfurous Acid (Diluted)` | `Sulfuric Acid` | filter |
| `Vinegar` | `Acetic Acid` | filter |
| `Water (Carbonated)` | `Carbon Dioxide` | filter |
