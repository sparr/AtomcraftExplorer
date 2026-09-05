# Problems in Atomcraft's materials and reactions

An audit of the shipped game data — 1871 materials and 687 reactions, read from
`Data/AllMaterials.json` and `Data/AllReactions.json` inside the Steam `AtomCraft.pck` build
of 2026-09-05.

Everything below is a defect in the **game's** data, not in this explorer. Each claim was
derived mechanically from the data; the scripts that produced the numbers are described at
the end.

The findings were first developed against `data/atomcraft.json`, this repo's condensed bake
of those two files, and then re-checked against the game's originals — because the bake
drops nulls, falses and default zeroes, and several findings below turn on a field being
zero or absent. The bake proved to be a faithful subset: 22,464 material scalars, 3,655
nested scalars, 1,977 reaction scalars and 2,061 input/output/catalyst maps compare equal,
and the four fields it never emits (`DissolvesInto`, `OverrideActorCollision`,
`IsCarryingSignal`, `GrowthMedium`) are null in all 1871 materials. So every value cited
here is the game's own. Two things did change on re-check, and both are corrected below:
the `MassNumber` used in §7 is computed by the bake rather than shipped, and
`ProgrammableDelegate` — a material link the bake drops — turns out to carry two dangling
references of its own (§10).

---

## How composition is read

Two fields describe what a material is made of, and they are not equivalent.

- `Formula` is a hand-written string (`Al2(SO4)3`, `CaSO4·2H2O`, `17% Co 83% Fe`). 1281
  materials have one, 243 of those as an empty string.
- `Composition.Elements` is a structured list, and it is **recursive** — an entry's `Item1`
  can name an element *or another material*. 76 distinct non-element names appear there,
  including group stand-ins (`Hydroxide`, `Sulfate Ion`, `Carbon Trioxide`), whole molecules
  (`Ammonia`, `Bromine Gas`, `Slaked Lime`), and the water-of-solution marker `+H2O`.

Resolving `Composition` recursively and falling back to `Formula` gives a definite element
tally for 1309 of 1871 materials. 543 have neither. This is the basis for every
conservation check below.

---

## 1. Conservation of matter in reactions

Of the 687 reactions, **543 have every participant chemically defined**; the other 144
involve at least one material with no composition at all, so they cannot be checked.

Of those 543: **363 balance, 180 do not** — a third of the checkable chemistry.

The 180 split into three groups.

### 1a. Oxygen taken from nowhere — 56 reactions

Roasting and oxidation reactions consume atmospheric oxygen without listing it:

```
Antimony Roasting          2 Antimony            -> Antimony(III) Oxide            Δ +3 O
Sphalerite Decomposition   Sphalerite            -> Zinc Oxide + Sulfur Dioxide    Δ +3 O
Stibnite Roasting          2 Stibnite            -> 2 Antimony(III) Oxide + 6 SO₂  Δ +18 O
Osmium Arsenosulfide …     2 Osmium Arsenosulfide-> 2 OsO₄ + As₂O₃ + 2 SO₂         Δ +15 O
```

This is consistent enough across the set to look like a deliberate convention (the furnace
is open to air). It is still 56 reactions that create oxygen, and the convention is not
applied uniformly — `Hydrogen Combustion` and `Carbon Monoxide + Oxygen` *do* list
`Oxygen Gas` as an input.

The convention also breaks in one place outright: **`Hydrogen Sulfide Gas + Oxygen Gas`**
is named for an oxygen input it does not have.

```
2 Hydrogen Sulfide Gas -> 2 Sulfur + 2 Steam        Δ +2 O
```

The name says the O₂ belongs in `Inputs`. It is missing.

### 1b. Water bookkeeping — 38 reactions

Aqueous species carry a `+H2O` unit in their composition, and reactions that shuffle them
lose or gain whole water molecules:

```
Aqueous Silver Nitrate + Aqueous Potassium Iodide -> Silver Iodide + Aqueous Potassium Nitrate   Δ -2 H, -1 O
Slaked Lime + 2 Water -> Limewater                                                              Δ -2 H, -1 O
3 Aqueous Copper(II) Sulfate + 2 Aluminum -> Aqueous Aluminum Sulfate + 3 Copper                Δ -4 H, -2 O
```

Because "aqueous X" is modelled as one cell carrying exactly one water, a double
displacement between two aqueous species has two waters going in and one coming out. The
model, not the individual reactions, is what makes these unbalanced — but the water really
does vanish.

**How much of this is only bookkeeping?** 23 of the 38 move no real `Water`/`Steam`/`Ice`
cell at all; the discrepancy lives entirely in the composition ledger at that step. That
would be harmless if the ledger never cashed out — but it does, in both directions:

- **36 hydration reactions** turn a real water cell into bound water (`Zinc Chloride +
  2 Water -> Aqueous Zinc Chloride`).
- **39 evaporation reactions** turn bound water back into a real cell (`Aqueous Zinc
  Chloride -> Zinc Chloride + Steam`).

So a phantom water lost mid-chain becomes a real cell that never comes back. The set is
also lopsided — **32 of the 38 destroy water and only 6 create it** — and none of them
cancel: there is not one inverse pair among the 38, so no loss is structurally restored by
another reaction in the group.

**Three of them are catalytic**, which makes the loss unbounded. Seeding a forward closure
with only a reaction's own non-water outputs (water treated as free, which it is — there is
a `Seawater Source`), these three can regenerate every reagent they consume:

```
Zinc Chloride + Water                            ΔH₂O -1
Aqueous Potassium Hydroxide + Hydrochloric Acid  ΔH₂O -1
Aqueous Ammonium Chloride + Aqueous Lye          ΔH₂O -1
```

The first two close into short loops that verify exactly. Every non-water material returns
to its starting amount; only water is consumed:

```
CYCLE A  — zinc chloride is a catalyst that eats water
  Zinc Chloride + 2 Water -> Aqueous Zinc Chloride
  Aqueous Zinc Chloride   -> Zinc Chloride + Steam
  net: ZnCl₂ unchanged, 2 Water in, 1 Steam out          → −1 water cell per pass

CYCLE B — potassium hydroxide / chloride
  2x  Aqueous Potassium Hydroxide + Hydrochloric Acid -> Potassium Chloride + Water
  2x  Potassium Chloride + Water                      -> Aqueous Potassium Chloride
      2 Aqueous Potassium Chloride + 2 Water -> 2 Aqueous Potassium Hydroxide + Hydrogen Gas + Chlorine Gas
      Chlorine Gas + Hydrogen Gas            -> 2 Hydrochloric Acid
  net: every reagent returns, 2 Water consumed          → −2 water cells per pass
```

Cycle A is two reactions long and needs one cell of zinc chloride to run forever. The third
(`Aqueous Ammonium Chloride + Aqueous Lye`) passes the same test through seawater
electrolysis, but the chain is long and leaves side products, so it is not verified here as
an exact cycle.

**The leak is one-way.** All three catalytic reactions destroy water; not one of the six
water-*creating* reactions can regenerate its reagents. The closure test is permissive — it
ignores quantities, so it over-reports catalysis rather than under-reporting it — which
makes that negative robust: water can be annihilated without limit, but never manufactured
without limit.

The remaining 35 still lose or gain water on every run, but each pass consumes feedstock —
ore, acid, or metal that cannot be remade from the products — so the damage is bounded by
supply rather than infinite.

### 1c. Everything else — 86 reactions

These are not explained by either convention. The worst of them:

**Alloying multiplies matter.**

```
Steel Alloy    3 Molten Iron + Carbon    -> 3 Molten Steel     Δ +6 Fe, +2 C
Bronze Alloy   3 Molten Copper + Molten Tin -> 4 Molten Bronze Δ +9 Cu, +3 Sn
```

`Molten Steel` resolves to Fe₃C and `Molten Bronze` to Cu₃Sn, so three cells of iron plus
one of carbon become nine iron and three carbon. Both alloys are free matter printers: run
the loop and iron triples, bronze quadruples.

The reverse reaction then destroys iron:

```
Molten Steel + Oxygen Gas -> Molten Iron + Carbon Dioxide      Δ -2 Fe
```

**Minerals that lose most of themselves.**

```
2 Vanadinite        -> Lead Oxide + Vanadium Pentoxide + Chlorine Gas   Δ -18 O, -9 Pb, -4 V
Lepidolite          -> Molten Alumina + Molten Silica + Steam + HF Gas  Δ -2 Al, -1 F, +3 H, -1 K, -2 Li, -4 O, -2 Si
Pentlandite         -> Nickel Oxide + Sulfur Dioxide Gas                Δ -8 Ni, +3 O, -7 S
Stannite            -> Antimony + 2 SO₂ + Copper(I) Sulfide + Iron Sulfide  Δ +1 Fe, +4 O, +1 Sb, -1 Sn
```

`Vanadinite` is Pb₅(VO₄)₃Cl; two cells hold ten lead and six vanadium, and the reaction
returns one of each. `Pentlandite` is Ni₉S₈ and yields one NiO and one SO₂ — one ninth of
the nickel. `Stannite` (Cu₂FeSnS₄) outputs an **antimony** atom that was never in it and
loses the tin the mineral is named for.

**Four reactions consume exactly twice what they produce.** These balance perfectly if the
input coefficient is changed from 2 to 1, which is almost certainly the intended edit:

```
Dolomite Decomposition            2 Dolomite  -> Limestone Gravel + Magnesium Oxide + Carbon Dioxide
Dolomite Deposit Decomposition    (same)
Celestine Decomposition           2 Celestine -> Strontium Oxide + Sulfur Trioxide Gas
Celestine Deposit Decomposition   (same)
```

**Acid dissolutions with the wrong acid coefficient.** Six reactions produce a dichloride
from a single HCl:

```
Hydrochloric Acid + Iron      -> Iron(II) Chloride + Hydrogen Gas         Δ +1 Cl, +1 H
Hydrochloric Acid + Zinc      -> Zinc Chloride + Hydrogen Gas             Δ +1 Cl, +1 H
Hydrochloric Acid + Manganese -> Manganese(II) Chloride + Hydrogen Gas    Δ +1 Cl, +1 H
Quick Lime + Hydrochloric Acid-> Calcium Chloride + Water                 Δ +1 Cl, +1 H
Copper Oxide + Hydrochloric Acid -> Copper(II) Chloride + Water           Δ +1 Cl, +1 H
Hydrochloric Acid + Aluminum  -> Aluminum Chloride + Hydrogen Gas         Δ +2 Cl, +1 H
```

Each needs 2 HCl (3 for aluminium). The bromide equivalents *do* use 2 — the chloride set
was simply never updated.

**Carbothermic reductions short one carbon monoxide.**

```
Alumina Reduction        Alumina + 3 Carbon -> 2 Molten Aluminum + 2 Carbon Monoxide   Δ -1 C, -1 O
Molten Alumina Reduction (same)
Rust Reduction           Rust + 3 Carbon    -> 2 Iron + 2 Carbon Monoxide               Δ -1 C, -1 O
```

Three carbon in, two CO out. The third carbon disappears.

**Biomass burns to less than it was.** Everything with the `C₆H₁₀O₅` composition —
`Wood`, `Charcoal`, `Grass`, `Leaves`, `Plant` — is destroyed rather than converted:

```
Blending Charcoal        Charcoal -> Carbon                            Δ -5 C, -10 H, -5 O
Sulfuric Acid + Wood     2 Wood + Sulfuric Acid -> Sulfuric Acid + Carbon + Water   Δ -11 C, -18 H, -9 O
Wood Gasification        9 Wood -> 4 Wood + CO + CO₂ + H₂ + Methane    Δ -27 C, -44 H, -22 O
Cassiterite Reduction    Cassiterite + 2 Charcoal -> Tin + 2 Carbon Dioxide  Δ -10 C, -20 H, -8 O
Leaf Composting          Fallen Leaf -> Carbon Dioxide + Steam         Δ -5 C, -8 H, -2 O
Plant Combustion         Plant -> Carbon + 2 Carbon Dioxide            Δ -3 C, -10 H, -1 O
```

`Charcoal` sharing cellulose's formula is the root cause of several of these — charcoal
should be close to pure carbon.

The full list of 86 is in the appendix.

---

## 2. Reactions that cannot run

### Five reactions reference materials that do not exist

`Amethyst Crystal`, `Beryl Crystal`, `Emerald Crystal`, `Sapphire Crystal` and
`Topaz Crystal` are named as the output, the `PrimaryInput` **and** the `Catalysts` entry of
their own growth reactions — but no such materials are defined. Only `Ruby Crystal` exists.

```
Amethyst Crystal Growth   3 Molten Silica + Molten Iron -> Amethyst Crystal   [catalyst: Amethyst Crystal]
Beryl Crystal Growth      2 Molten Silica + Molten Alumina + Beryllium Oxide -> Beryl Crystal
Emerald Crystal Growth    2 Beryllium Oxide + Molten Alumina + 3 Molten Silica -> Emerald Crystal
Sapphire Crystal Growth   4 Molten Aluminum + 3 Oxygen Gas -> 2 Sapphire Crystal
Topaz Crystal Growth      Molten Alumina + Molten Silica + 2 Hydrofluoric Acid Gas -> Topaz Crystal
```

Five gem crystals are dead. There are, however, 40 `Laser Amethyst …` / `Laser Beryl …` /
`Laser Emerald …` / `Laser Sapphire …` / `Laser Topaz …` machine materials that exist and
presumably want them.

### One reaction is keyed to the wrong material

```
Lithium Titanate Decomposition
  PrimaryInput: Lithium Carbonate
  Inputs:       Lithium Titanate 1
  Outputs:      2 Lithium Oxide + 5 Titanium Dioxide
```

The game iterates reactions by `PrimaryInput`, so this one is filed under a material it
never consumes. `Lithium Carbonate` is the input of the *other* lithium-titanate reaction;
the field was copied and not changed.

### Two Boudouard reactions are filed under a product

```
Boudouard Equilibrium 971-1421K   PrimaryInput: Carbon Monoxide   CO₂ + C -> 2 CO
Boudouard Equilibrium 1422K+      PrimaryInput: Carbon Monoxide   CO₂ + C -> 2 CO
```

Carbon monoxide is the output, not an input. Only the two reverse reactions
(`2 CO -> CO₂ + C`) legitimately have CO as primary.

### The Boudouard probabilities move the wrong way

| reaction | direction | T range | `Probability` |
|---|---|---|---|
| Boudouard 500-725K | 2 CO → CO₂ + C | 500–725 | 100 |
| Boudouard 726-970K | 2 CO → CO₂ + C | 726–970 | 50 |
| Boudouard 971-1421K | CO₂ + C → 2 CO | 971–1421 | 100 |
| Boudouard 1422K+ | CO₂ + C → 2 CO | 1422+ | 50 |

Both pairs go 100 → 50 as temperature rises. Whichever way `Probability` reads — a percent
or a one-in-N rarity — the forward and reverse reactions respond to heat *identically*,
which cannot be right for an equilibrium. One of the two pairs is inverted.

(`Probability` is also on two scales: 61 reactions use values in 4–100, and 16 use 200,
500, 1000, 9000 or 10000.)

---

## 3. Composition contradicts Formula

21 materials resolve to different elements depending on which field you read. Nine are
outright wrong chemistry; ten are a formula-writing convention that was applied
inconsistently.

### Wrong chemistry

| material | `Formula` says | `Composition` says | reality |
|---|---|---|---|
| **Hematite**, **Hematite Deposit** | Fe₂O₃ | **Fe₃O₄** | hematite is Fe₂O₃; Fe₃O₄ is magnetite |
| **Pentlandite**, **Pentlandite Powder** | **Fe₉S₈** | Ni₉S₈ | pentlandite is (Fe,Ni)₉S₈; the game treats it as nickel ore |
| **Greenockite** | **HgS** | CdS | greenockite is CdS; HgS is cinnabar |
| **Iron(II) Hydroxide** | Fe(OH)₂ | **FeH₂O₄** | two extra oxygens |
| **Liquid Oxygen** | O₂ | **O₈** | four O₂ per cell — see §6 |
| **Selenium Trioxide Gas** | SeO₃ | **O₃Se₂** | extra selenium |
| **Sodium Vanadate** | NaVO₃ | **CNaO₃V** | a stray carbon |
| **Gypsum** | CaSO₄·2H₂O | **CaH₄O₄S** | two oxygens short of the dihydrate |
| **Aqueous Lithium Sulfate** | **LiSO₄** | Li₂SO₄·H₂O | the formula is missing a lithium |
| **Magnesium Fluoride** | **MgFl₂** | MgF₂ | `Fl` is not an element symbol; fluorine is `F` |

Two of these break reactions, and fixing the composition fixes them exactly:

- With Fe₂O₃, **`Hematite Decomposition`** and **`Hematite Deposit Decomposition`** balance
  perfectly. The Fe₃O₄ composition is their only defect.
- With Fe(OH)₂, **`Iron(II) Hydroxide Decomposition`** and **`Iron(II) Hydroxide
  Production`** balance perfectly.

### Inconsistent aqueous formulas

Ten "Aqueous X" materials omit the `+H2O` from their `Formula` that their `Composition`
carries, while their siblings include it:

| omits it | includes it |
|---|---|
| `Aqueous Calcium Chloride` — `CaCl2` | `Aqueous Calcium Nitrate` — `Ca(NO3)2+H2O` |
| `Aqueous Copper(II) Chloride` — `CuCl2` | `Aqueous Iron Bromide` — `FeBr2+H2O` |
| `Aqueous Copper(II) Sulfate` — `CuSO4` | `Aqueous Lead Sulfate` — `PbSO4+H2O` |
| `Aqueous Iron(II) Sulfate` — `FeSO4` | `Aqueous Magnesium Sulfate` — `MgSO4+H2O` |
| `Aqueous Lithium Sulfate` — `LiSO4` | `Aqueous Sodium Carbonate` — `Na2CO3+H2O` |
| `Aqueous Nickel Sulfate` — `NiSO4` | `Aqueous Sodium Nitrate` — `NaNO3+H2O` |
| `Aqueous Nickel(II) Sulfate` — `NiSO4` | `Aqueous Sulfur Dioxide` — `SO2+H2O` |
| `Aqueous Zinc Bromide` — `ZnBr2` | `Aqueous Tin Bromide` — `SnBr2+H2O` |
| `Aqueous Zinc Chloride` — `ZnCl2` | `Aqueous Zinc Sulfate` — `ZnSO4` … also omits it |

Sixteen aqueous materials write the water, ten do not.

### Other formula problems

- **`Garnet`** — `X3Y2(SiO4)3`. The generic mineral placeholders `X` and `Y` are left in;
  it is the only formula in the game with unresolvable symbols.
- **243 materials carry an empty-string `Formula`** rather than none. Among them are
  well-defined chemicals used in reactions: `Potassium Sulfate`, `Potassium Sulfide`,
  `Sodium Sulfide`, `Sodium Silicate`, `Potassium Bisulfate`, `Calcium Phosphate`,
  `Ammonium Nitrate`, `Ammonium Oxalate`, `Ammonium Paratungstate`, `Bastnäsite`,
  `Bertrandite`, `Nepheline`, `Uric Acid`, `Coal`, `Vanadium Carbide Steel`.
- **99 reaction participants have no composition at all**, so 144 reactions cannot be
  checked. The chemically real ones: `Ethanol`, `Black Powder`, `Sugar`, `Steel`,
  `Molten Brass`, `Ceramic`, `Clay`, `Nepheline`, `Bertrandite`,
  `Ammonium Paratungstate`, `Molten Vanadium Carbide Steel`.

---

## 4. Duplicate materials

Twelve groups where two or more materials have identical composition, identical state, and
are *both used in reactions* — so the same substance exists twice in the chemistry graph
with different names and different physics.

| composition | duplicates | `Mass` values |
|---|---|---|
| NiSO₄·H₂O (liquid) | `Aqueous Nickel Sulfate`, `Aqueous Nickel(II) Sulfate` | 38, 38 |
| Nb₂O₅ | `Niobium Oxide`, `Niobium Pentoxide` | 303, 303 |
| Mn₂O₃ | `Manganese (III) Oxide`, `Manganese Oxide` | 75, 75 |
| Fe₂O₃ | `Ferric Oxide`, `Rust` (+ unused `Iron(III) Oxide`, `Rust Wall`) | 9, 9, 79, 0 |
| Al(OH)₃ | `Aluminum Hydroxide`, `Bauxite` | 27, 47 |
| SiO₂ | `Glass`, `Sand`, `Silica` (+ `Flint`, `Amethyst`, `Molten Silica`) | 47, 47, 47 |
| Bi₂S₃ | `Bismuth Sulfide`, `Bismuthinite` | 98, 816 |
| Cu₂O | `Copper(I) Oxide`, `Cuprite Powder` | 90, 204 |
| PbS | `Galena Gravel`, `Lead Sulfide` | 379, 113 |
| H₂CO₃ | `Carbonic Acid`, `Water (Carbonated)` | 6, 10 |
| Ca(OH)₂ | `Calcium Hydroxide`, `Slaked Lime` | 16, 66 |
| C₆H₁₀O₅ | `Wood`, `Charcoal`, `Grass1–4`, `Berry`, `Nuts`, `Plant`, `Fallen Leaf`, … (13 in reactions) | 7 or 123 |

`Aqueous Nickel Sulfate` / `Aqueous Nickel(II) Sulfate`, `Niobium Oxide` /
`Niobium Pentoxide` and `Manganese (III) Oxide` / `Manganese Oxide` are exact duplicates —
same composition, same state, same mass. There is no way for a player to tell them apart or
to know which one a recipe wants.

`Charcoal` sharing cellulose's composition with `Wood` is a chemistry bug in its own right
(see §1c).

---

## 5. `Mass` carries three different quantities

`Mass` behaves as density × 10 — water is 10, mercury 136, lead 113, tungsten 193, aluminium
27. That reading holds for 43 of the 103 element materials. It does not hold for the rest.

### 5a. 60 elements carry atomic mass ÷ 10 instead of density × 10

| element | game `Mass` | should be (density × 10) |
|---|---|---|
| Carbon | 1 | 23 |
| Boron | 1 | 23 |
| Sulfur | 3 | 21 |
| Phosphorus | 3 | 18 |
| Gallium | 6 | 59 |
| Technetium | 9 | 110 |
| Rhodium | 10 | 124 |
| Antimony | 12 | 67 |
| Barium | 13 | 35 |
| Lanthanum | 13 | 62 |
| Lutetium | 17 | 98 |
| Polonium | 20 | 92 |
| Radium | 22 | 55 |
| Americium | 24 | 137 |
| Californium | 24 | 151 |

The full 60: B, C, P, S, Ga, Ge, As, Se, Rb, Sr, Tc, Rh, Sb, Te, I, Cs, Ba, La, Ce, Pr, Nd,
Pm, Sm, Eu, Gd, Tb, Dy, Ho, Er, Tm, Yb, Lu, Po, At, Fr, Ra, Am, Cm, Bk, Cf, Es, Fm, Md, No,
Lr, Rf, Db, Sg, Bh, Hs, Mt, Ds, Rg, Cn, Nh, Fl, Mc, Lv, Ts, Og — every lanthanide, every
actinide from americium up, and the whole `Mass = A/10` band.

In play this means solid carbon (1) floats on water (10), americium (24) barely sinks, and
the entire lanthanide series is lighter than aluminium.

### 5b. Every isotope of an element shares one `Mass`

All 324 isotope materials take their element's value regardless of mass number. Uranium-233,
-234 and -235 all weigh 191. Americium-223 through Americium-249 all weigh 24. Enrichment
changes nothing you can weigh.

The per-element values are also unordered: Uranium 191, Protactinium 154, Thorium 117,
Actinium 101, Radium 22, Francium 22, Radon 1, Polonium 20, Bismuth 98, Lead 113,
Thallium 119.

### 5c. Gold is 129

Gold's density is 19.3 g/cm³, so `Mass` should be 193 — the same as tungsten, which the game
gets right. At 129 gold is lighter than mercury (136) and would float out of a mercury bath.
The digits look transposed.

### 5d. Molten and vapour phases are on the molar-mass scale

Roughly two dozen `Molten X` and `X Vapor` materials carry molar mass ÷ 10 while their solid
carries density × 10, so melting a metal makes it ten times lighter:

| solid | molten | vapour |
|---|---|---|
| Platinum 215 | Molten Platinum **19** | — |
| Tungsten 193 | Molten Tungsten **18** | — |
| Tantalum 167 | Molten Tantalum **17** | — |
| Gold 129 | Molten Gold **19** | — |
| Lead 113 | Molten Lead **20** | — |
| Molybdenum 103 | Molten Molybdenum **9** | Molybdenum Vapor **9** |
| Nickel 89 | Molten Nickel **5** | Nickel Vapor **5** |
| Cobalt 89 | Molten Cobalt **5** | Cobalt Vapor **5** |
| Cadmium 87 | Molten Cadmium **11** | — |
| Manganese 75 | Molten Manganese **5** | Manganese Vapor **5** |
| Chromium 72 | Molten Chromium **5** | Chromium Vapor **5** |
| Zirconium 65 | Molten Zirconium **9** | Zirconium Vapor **9** |
| Vanadium 61 | Molten Vanadium **5** | Vanadium Vapor **5** |
| Titanium 45 | Molten Titanium **4** | Titanium Vapor **4** |
| Silver 105 | Molten Silver **10** | — |
| Tin 73 | Molten Tin **11** | — |
| Bismuth 98 | Molten Bismuth **20** | — |

### 5e. 28 gases are denser than water

Gases inherit their solid's `Mass` in about 30 cases, so they sink through everything:

```
Osmium Tetroxide          226      Zinc Vapor        103
Zirconium Tetrachloride   158      Copper Vapor      101
Hafnium Tetrachloride     133      Iron Vapor         88
Selenium Dioxide Gas      128      Yttrium Vapor      45
Ruthenium Vapor           124      Aluminum Vapor     42
```

`Ruthenium Vapor`, `Zinc Vapor`, `Selenium Dioxide Gas`, `Rhodium Vapor`, `Strontium Vapor`,
`Technetium Vapor`, `Yttrium Vapor`, `Rubidium Vapor`, `Gallium Vapor`, `Sulfur Vapor`,
`Lithium Oxide Vapor` and `Cesium Gas` are *exactly* as heavy as their solid — the field was
copied.

Meanwhile 38 gases have `Mass` 0.

### 5f. 87 compounds inherit their metal's density verbatim

```
Alumina 27          = Aluminum 27         (Al₂O₃ is 3.95 g/cm³ → 40)
Calcium Chloride 16 = Calcium 16          (CaCl₂ is 2.15 → 21)
Calcium Sulfate 16  = Calcium 16
Aluminum Bromide 27 = Aluminum 27
Hafnium Tetrachloride Gas 133 = Hafnium 133
```

Eight aluminium compounds, nine calcium compounds, and so on — the field was left at the
cation's value. Their mineral synonyms often carry a properly computed number instead, which
is why `Calcium Tungstate` is 16 and `Scheelite Deposit` is 362 for the same substance.

### 5g. Deposits disagree with what they mine into

17 of 69 `… Deposit` materials have `Mass` 0 while the other 52 do not, and mining changes
the weight:

```
Barite Deposit        0 -> Barite                    45
Bertrandite Deposit   0 -> Bertrandite               11
Coal Deposit          0 -> Coal                       9
Columbite Deposit     0 -> Columbite                  9
Erlichmanite Deposit  0 -> Osmium Disulfide         226
Xenotime Deposit      0 -> Xenotime                 197
Scheelite Deposit   362 -> Calcium Tungstate         16
Ferberite Deposit   387 -> Iron(II) Tungstate        79
Corundum Deposit     90 -> Alumina                   27
Fluorite Deposit     67 -> Calcium Fluoride          16
Thortveitite Deposit 243 -> Scandium Disilicate      30
```

### 5h. One machine changes weight when you toggle it

```
Heat Resistant Wire       Mass 101
Heat Resistant Wire On    Mass 0
Heat Resistant Wire Off   Mass 0
```

Same for `Silver Wire` (105) vs `Silver Wire On` (171), and `Zinc` (71) vs `Zinc Wall` (103).

---

## 6. Phase transitions

### 6a. Three elements melt at the wrong temperature

Every element with a `Molten` form was checked against its real melting and boiling point.
Three are wrong, and all three are wrong *only* in the melting point — their boiling points
are correct:

| element | game melting point | real | game boiling point | real |
|---|---|---|---|---|
| **Iron** | **858 K** | 1811 | 3134 | 3134 |
| **Nickel** | **601 K** | 1728 | 3186 | 3186 |
| **Copper** | **758 K** | 1358 | 2835 | 2835 |

The game already knows the right numbers elsewhere: `Copper Wall`, `Copper Wire` and every
copper logic gate melt at 1358, and `Bits of Blender` (iron) melts at 1811. Only the plain
element is wrong.

`858` and `657` look like placeholders — `Iron`, `Apatite Gravel`, `Columbite` and
`Olivine Deposit` all melt at 858, and `Molten Iron`, `Molten Copper`, `Molten Steel`,
`Molten Cobalt Steel`, `Molten Apatite`, `Molten Columbite` and `Molten Calcium Fluoride`
all freeze at 657.

### 6b. Bismuth freezes above its own melting point

```
Bismuth        evaporates at 540 -> Molten Bismuth
Molten Bismuth condenses  at 543 -> Bismuth
```

Every other pair in the game uses a 1 K hysteresis in the safe direction (melt at *T*,
freeze at *T*−1). Bismuth's is inverted by 3 K, so between 540 and 543 K it satisfies both
transitions at once. Bismuth's real melting point is 545, so 540 is the wrong end.

### 6c. Melting an ore destroys its non-metal

32 phase transitions do not conserve composition. The serious ones turn heat into a free
smelter:

```
Hematite           1358 K -> Molten Iron      Δ -2 Fe, -4 O
Hematite Deposit    858 K -> Molten Iron      Δ -2 Fe, -4 O
Galena              858 K -> Molten Lead      Δ -1 S
Galena Gravel       858 K -> Molten Lead      Δ -1 S
Sphalerite          858 K -> Molten Zinc      Δ -1 S
Sphalerite Deposit  858 K -> Molten Zinc      Δ -1 S
Cassiterite         505 K -> Molten Tin       Δ -2 O
Cassiterite Deposit 505 K -> Molten Tin       Δ -2 O
Cuprite            1358 K -> Molten Copper    Δ -1 Cu, -1 O
Cuprite Powder      758 K -> Molten Copper    Δ -1 Cu, -1 O
Apatite             858 K -> Molten Apatite   Δ -4 Ca, +1 F, -12 O, -3 P
Limestone          1612 K -> Quick Lime       Δ -1 C, -2 O
```

Sulfide and oxide ores skip smelting entirely — heat them and the sulfur or oxygen is
annihilated. `Molten Apatite` is the worst: it is defined as CaF₂ (it shares its composition
with `Molten Calcium Fluoride`), so melting apatite throws away all the phosphate.

Two more melt into a different mineral altogether:

```
Bridgmanite  1550 K -> Molten Anorthite    Δ +2 Al, +1 Ca, -1 Mg, +5 O, +1 Si
Rhyolite      701 K -> Rhyolitic Lava      Δ +1 Al, +1 K, +4 O, +1 Si
```

And five copper machines evaporate into boron:

```
Heat Resistant Wire (Cu)  32000 K -> Boron    Δ +1 B, -1 Cu
```

### 6d. Liquid hydrogen and liquid oxygen multiply

Every cryogenic liquid in the game is one molecule per cell with `Amount: 1` in both
directions — `Liquid Nitrogen`, `Liquid Chlorine`, `Liquid Argon`, `Liquid Neon`,
`Liquid Krypton`, `Liquid Xenon`, `Liquid Methane`, `Liquid Helium`. Hydrogen and oxygen
alone break the pattern:

```
Hydrogen Gas    condenses at 20 K  -> Liquid Hydrogen   Amount 4
Liquid Hydrogen evaporates at 21 K -> Hydrogen Gas      Amount 4
Oxygen Gas      condenses at 90 K  -> Liquid Oxygen     Amount 4
Liquid Oxygen   evaporates at 91 K -> Oxygen Gas        Amount 4
```

`Liquid Oxygen`'s composition is O₈ (four O₂) while its formula says O₂; `Liquid Hydrogen`'s
is H₈. With `Amount: 4` in *both* directions the cycle cannot conserve matter under any
reading of the field — cross 90 K twice and you have more oxygen than you started with.

The seven petroleum liquids have the same symmetric `Amount: 2` in both directions
(`Diesel`, `Kerosene`, `Naphtha`, `Gasoline`, `Heavy Oil`, `Ethanol`, and their vapours).

### 6e. Four deposits melt into nothing

```
Ferberite Deposit    Evaporation { Temperature: 1400, Amount: 1 }   — no target
Hubnerite Deposit    Evaporation { Temperature: 1400, Amount: 1 }   — no target
Wolframite Deposit   Evaporation { Temperature: 1400, Amount: 1 }   — no target
Olivine Deposit      Evaporation { Temperature:  858, Amount: 1 }   — no target
```

Their non-deposit forms (`Iron(II) Tungstate` → `Molten Iron(II) Tungstate`,
`Manganese(II) Tungstate` → `Molten Manganese(II) Tungstate`) melt correctly.

### 6f. Melt and freeze temperatures disagree by more than the 1 K convention

162 pairs differ. 104 differ by exactly 1 K, which is the intended hysteresis; the other 58
range from −3 K to 1100 K, and 26 of those exceed 10 K:

```
Bits of Heating Element  melts 2500  freezes 1400   Δ 1100
Steel / Cobalt Steel     melts 1610  freezes  657   Δ  953
Bronze                   melts 1223  freezes  650   Δ  573
Molten Quick Lime        boils 2850  cond.   2600   Δ  250
Apatite Gravel/Columbite melts  858  freezes  657   Δ  201
Iron                     melts  858  freezes  657   Δ  201
Glass                    melts 1983  freezes 1800   Δ  183
Cheese                   melts  423  freezes  300   Δ  123
Copper                   melts  758  freezes  657   Δ  101
Water                    boils  398  cond.    298   Δ  100
```

`Water` is worth singling out: liquid water boils at 398 K but `Steam` condenses at 298 K,
so between 298 and 398 both transitions are inactive and steam never returns to water at any
temperature a chamber normally sits at. (`Ice` melts at 273 and `Water` freezes at 272, the
correct convention.)

### 6g. The water family does not agree with itself

Seven materials share the H₂O composition and disagree on both weight and temperature:

| material | `Mass` | melts / boils at |
|---|---|---|
| `Water` | 10 | boils **398** |
| `+H2O` (the solvent marker) | 10 | boils **373** |
| `Ice` | 10 | melts 273 |
| `Slush` | **1** | melts 273 |
| `Snow` | **1** | melts **283** |
| `Falling Snow` | **1** | melts **283** |
| `Steam` | 0 | condenses 298 |

`Water` and `+H2O` are the same substance with the same mass and different boiling points.
Snow melts 10 K above ice, and snow, slush and ice — all solid water — weigh 1, 1 and 10.

### 6h. Melting points that disagree within one substance

```
Copper         758   vs   Copper Wall / Copper Wire / logic gates   1358
Iron           858   vs   Bits of Blender                           1811
Silica        1687   vs   Flint / Glass / Sand                      1983
Corundum Deposit 1600 vs  Corundum Wall / Ancient Corundum Wall     2327
```

`Silica` at 1687 is *silicon's* melting point, not silica's.

### 6i. Three materials named "Vapor" are not gases

```
Beryllium Vapor            State: Liquid
Diesel Vapor (Burning)     State: Liquid
Heavy Oil Vapor (Burning)  State: Liquid
```

`Molten Beryllium` boils at 2744 K into a liquid.

---

## 7. Nuclear data

324 isotopes. The game ships `ProtonNumber` and `NeutronNumber`; the mass number used below
is their sum, which the explorer's bake computes — so there is no Z+N-against-A check to be
made, and none is claimed here. What the game *does* ship independently is each isotope's
**name**, and every one of the 324 agrees with its own Z and N: no material called
`Lead-212` carries neutrons for a different nuclide, and no `ProtonNumber` disagrees with
the element its name gives. All 654 neutron/proton/alpha impact products are arithmetically
correct too. The decay chains are not.

Of 305 decay entries:

| | count |
|---|---|
| correct | 197 |
| no decay product named at all | 47 |
| decays to a bare element, losing the mass number | 30 |
| decays to a nuclide that does not exist | 20 |
| decay mode mislabelled | 7 |
| labelled spontaneous fission but given an alpha product | 4 |

### 7a. Seven decay modes are mislabelled

In each case the product is correct for a *different* mode:

```
Bismuth-210     declared Alpha       -> Polonium-210    (ΔZ +1, ΔA 0)   = beta-minus
Lead-211        declared Alpha       -> Bismuth-211     (ΔZ +1, ΔA 0)   = beta-minus
Bismuth-213     declared Beta-minus  -> Thallium-209    (ΔZ -2, ΔA -4)  = alpha
Einsteinium-248 declared Alpha       -> Californium-248 (ΔZ -1, ΔA 0)   = beta-plus
Einsteinium-249 declared Alpha       -> Californium-249 (ΔZ -1, ΔA 0)   = beta-plus
Einsteinium-250 declared Alpha       -> Californium-250 (ΔZ -1, ΔA 0)   = beta-plus
Flerovium-289   declared Beta-minus  -> Copernicium-285 (ΔZ -2, ΔA -4)  = alpha
```

Anything the game shows the player about decay mode, or any mechanic keyed to it, is wrong
for these seven.

### 7b. Four fission entries carry an alpha product

```
Copernicium-282  Mode 6 (spontaneous fission) -> Darmstadtium-278   ΔZ -2, ΔA -4
Copernicium-284  Mode 6                       -> Darmstadtium-280   ΔZ -2, ΔA -4
Darmstadtium-279 Mode 6                       -> Hassium-275        ΔZ -2, ΔA -4
Roentgenium-281  Mode 6                       -> Meitnerium-277     ΔZ -2, ΔA -4
```

The other 47 fission entries name no product at all, so these four are the odd ones out in
both directions.

### 7c. 30 decays drop the mass number

```
Americium-230 … Americium-240   beta-plus -> "Plutonium"       (20 nuclides)
Americium-223, -229, -241       alpha     -> "Neptunium"
Curium-235 … Curium-248         alpha     -> "Plutonium"
Polonium-210, Polonium-214      alpha     -> "Lead"
Thallium-207, Thallium-208      beta-minus-> "Lead"
Thallium-209                    beta-minus-> "Bismuth"
Thorium-231                     beta-minus-> "Protactinium"
```

The bare elements `Plutonium`, `Neptunium`, `Lead`, `Bismuth` and `Protactinium` exist as
materials but carry no `ProtonNumber`/`MassNumber`, so the chain ends there — Americium-230
and Americium-240 both become the same indistinguishable lump.

### 7d. Neptunium and plutonium have no isotopes

Isotopes exist for Z = 81–92 and 95–118. **93 (neptunium) and 94 (plutonium) are the only
gaps** — the two elements a reactor actually produces, and the two that 24 americium and
curium decays point at.

### 7e. 20 decays and 26 impact products lead to undefined nuclides

Including several that are not physically possible:

```
Rutherfordium-261 alpha -> "Nobelium-277"     (Z 102 with 175 neutrons)
Bohrium-278       alpha -> "Dubnium-274"
Berkelium         alpha -> "Americium-243"
Seaborgium        alpha -> "Rutherfordium-267"
```

`Meitnerium-267` has `DecaySettings { Mode: 0, TickModValue: 1300 }` with no product at all
— it decays into nothing.

### 7f. 19 isotopes never decay

`Uranium-233`, `Uranium-234`, `Uranium-235`, `Thorium-228`, `Americium-248`,
`Berkelium-248`, `Bohrium-268`, `Bohrium-269`, `Bohrium`, `Californium-236`, `Curium-236`,
`Curium-238`, `Curium-239`, `Curium-241`, `Darmstadtium-278`, `Einsteinium-247`,
`Flerovium-284`, `Mendelevium`, `Nobelium-248` have no `DecaySettings`. Bohrium-268 has a
real half-life under a minute.

---

## 8. Names

### 8a. A misspelling that dangles

```
Kerosene (Burning).Fire.CombustionTargetMaterialNames  -> "Naptha Vapor"
Kerosene Vapor (Burning).Fire.CombustionTargetMaterialNames -> "Naptha Vapor"
```

The material is `Naphtha Vapor`. Burning kerosene points at a material that does not exist.

### 8b. One material breaks the oxidation-state convention

49 materials use roman numerals. 48 write them tight — `Iron(III) Oxide`,
`Copper(I) Sulfide`, `Palladium(II) Oxide`. One does not:

```
Manganese (III) Oxide
```

…which is also an exact duplicate of `Manganese Oxide`.

### 8c. Reaction names use names no material has

```
Quicklime + Water                     -> material is "Quick Lime"
Quicklime + Hydrochloric Acid         -> material is "Quick Lime"
HCl Gas + Ammonia Gas                 -> material is "Hydrochloric Acid Gas"
Aqueous Copper Sulfate + Aqueous Sodium Carbonate -> material is "Aqueous Copper(II) Sulfate"
Sulfuric Acid + Fluorite              -> input is "Calcium Fluoride"; "Fluorite Deposit" is a different material
Wolframite (Manganese) + Sodium Carbonate -> input is "Manganese(II) Tungstate"
Hafnium Tetrachloride Gas + Magnesium -> input is "Magnesium Liquid"
Zirconium Tetrachloride Gas + Magnesium -> input is "Magnesium Liquid"
Carbon Monoxide + Oxygen              -> input is "Oxygen Gas"
Sulfur Dioxide + Oxygen               -> input is "Oxygen Gas"
Titanium Tetrachloride Gas + Oxygen   -> input is "Oxygen Gas"
```

### 8d. Two reaction pairs are byte-identical apart from temperature

```
Carbon Dioxide + Hydrogen Gas w Nickel      (T 570)  } identical inputs and outputs;
Carbon Dioxide + Hydrogen Gas w Nickel Wall (T 500)  } differ only in catalyst material
```

`Boudouard Equilibrium 971-1421K` / `1422K+` and `500-725K` / `726-970K` are likewise
identical pairs distinguished only by temperature band and probability.

---

## 9. Fire and combustion

### 9a. Five materials cannot be un-burnt

Putting out a fire normally restores the unburnt material. Five do not:

```
Compost (Burning)  --extinguish--> Carbon Dioxide
Leaves (Burning)   --extinguish--> Carbon Dioxide
Grass (Burning)    --extinguish--> Carbon
Tree (Burning)     --extinguish--> Carbon
Wood (Burning)     --extinguish--> Charcoal
```

Extinguishing burning leaves turns a solid into a gas. (Wood → charcoal is plausibly
deliberate; the others are not.)

### 9b. Two already-burning materials have an ignition rule pointing at themselves

```
Charcoal (Burning)  Ignition -> Charcoal (Burning)
Coal (Burning)      Ignition -> Coal (Burning)
```

### 9c. Ignition destroys matter outside the reaction system

```
Black Powder  -- ignites --> Carbon Dioxide      (loses K, N, S)
Nitroglycerin -- ignites --> Carbon              (loses H, N, O)
```

These are not reactions, so nothing checks them, but they annihilate everything but one
element.

---

## 10. Dangling references

43 named materials do not exist. 30 are nuclides (§7e). The other 13:

| missing | referenced by |
|---|---|
| `Amethyst Crystal` | `Amethyst Crystal Growth` (output, primary input, catalyst) |
| `Beryl Crystal` | `Beryl Crystal Growth` |
| `Emerald Crystal` | `Emerald Crystal Growth` |
| `Sapphire Crystal` | `Sapphire Crystal Growth` |
| `Topaz Crystal` | `Topaz Crystal Growth` |
| `Corundum Gravel` | `Ancient Corundum Wall.MinesInto` |
| `Laurite` | `Laurite Deposit.MinesInto` |
| `Molten Carbide Steel` | `Vanadium Carbide Steel.Evaporation` |
| `Naptha Vapor` | `Kerosene (Burning)` and `Kerosene Vapor (Burning)` combustion products |
| `Pulsar-On` | `Bits of Pulsar.BuildsInto` |
| `Temperature Sensor` | `Temperature Sensor (1000).RotatesLeftInto`, and the `ProgrammableDelegate` of all 4 `Temperature Sensor (…)` variants |
| `Heating Element` | the `ProgrammableDelegate` of all 12 `Heating Element (…)` variants |
| `+` | four `Composition.Elements` entries (`Aqua Regia`, `Compacted Dirt`, `Hydrofluoric Acid Crystals`, `Hydrofluoric Acid`) |

`Ancient Corundum Wall` and `Laurite Deposit` cannot be mined. `Bits of Pulsar` cannot be
built. `Temperature Sensor (1000)` cannot be rotated left. `Vanadium Carbide Steel` cannot
be melted.

`ProgrammableDelegate` names the material a programmable machine defers its behaviour to.
It takes six values, and the pattern breaks in exactly half of them:

| delegate | exists | used by |
|---|---|---|
| `Cooling Element` | yes | 6 `Cooling Element (…)` variants |
| `Sensor` | yes | `Sensor` |
| `Match Filter` | yes | `Match Filter` |
| `Nonmatch Filter` | yes | `Nonmatch Filter` |
| **`Heating Element`** | **no** | 12 `Heating Element (…)` variants |
| **`Temperature Sensor`** | **no** | 4 `Temperature Sensor (…)` variants |

The cooling elements have a base material to defer to and the heating elements do not,
though the two families are otherwise built the same way. Sixteen machines defer to
something that isn't there.

One near-miss worth recording so nobody re-finds it: `ColorDelegate` looks like the same
kind of link and is not. Its 19 values are renderer names — `Bark`, `CheckerPulse`,
`Crystal`, `Gravel`, `Lava`, `MetalBits`, `SparklyMetal`, `LeftConveyor`, `RightConveyor` —
which merely collide with material names in the other ten cases (`Sand`, `Granite`,
`Limestone`, `Ruby`, …). Nothing dangles there.

The `"+"` entries are a parsing artefact in the source data: a composition written as
`X + H2O` was split on the `+` and the separator was kept as a component.

---

## 11. Two structural oddities worth knowing about

### `Igniter` changes composition when built

```
Igniter        (Cu)      BuildsInto -> Igniter (Off)  (Cr, Ni — nichrome)
Igniter (Off)  (nichrome) MinesInto -> Igniter        (Cu)
```

Building an igniter transmutes copper into nichrome; mining it back transmutes it again.

### `Electrolysis` is set on three reactions that are not electrolysis

```
Hydrogen Combustion    2 Hydrogen Gas + Oxygen Gas -> 2 Steam
Molten Silica + Carbon Molten Silica + 3 Carbon -> Silicon Carbide + 2 Carbon Monoxide
Molten Silicon + Carbon Molten Silicon + Carbon -> Silicon Carbide
```

Combustion and carbothermal carbide formation do not need a current.

---

## Summary of counts

| | |
|---|---|
| materials | 1871 |
| reactions | 687 |
| reactions fully checkable for conservation | 543 |
| — of which unbalanced | **180** (33%) |
| — unlisted atmospheric oxygen | 56 |
| — whole-water discrepancy | 38 |
| — genuine errors | **86** |
| reactions not checkable (undefined participants) | 144 |
| reaction participants with no composition | 99 |
| reactions referencing non-existent materials | 5 |
| reactions with a `PrimaryInput` they do not consume | 3 |
| materials whose `Composition` contradicts `Formula` | 21 |
| duplicate-substance groups used in reactions | 12 |
| elements with `Mass` on the wrong scale | 60 (+ gold) |
| phase transitions that do not conserve composition | 32 |
| phase transitions with no target | 4 |
| decay entries with a defect | 108 of 305 |
| isotopes that never decay | 19 |
| dangling material references | 43 (30 nuclides, 13 other) |
| machines whose `ProgrammableDelegate` target does not exist | 16 |

---

## Appendix: the 86 genuinely unbalanced reactions

Δ is output minus input, in atoms.

```
Alumina Reduction                       Alumina + 3 Carbon -> 2 Molten Aluminum + 2 Carbon Monoxide            Δ -1 C, -1 O
Aluminum Oxyhydroxide Decomposition     Aluminum Oxyhydroxide -> Alumina + Steam                                Δ +1 Al, +1 H, +2 O
Antimony Pentachloride + Water          2 Antimony Pentachloride + 5 Water -> Antimony Pentoxide + 6 HCl        Δ -4 Cl, -4 H, -1 Sb
Aqueous Potassium Hydroxide + Sulfuric Acid  … -> Potassium Sulfate + Water                                     Δ -3 H, +1 K, -1 O
Bismuth Sulfide Roasting                Bismuth Sulfide + 3 Iron -> 2 Bismuth + 2 Iron Sulfide                  Δ -1 Fe, -1 S
Blending Charcoal (Burning)             Charcoal (Burning) -> Carbon                                            Δ -5 C, -10 H, -5 O
Blending Charcoal                       Charcoal -> Carbon                                                      Δ -5 C, -10 H, -5 O
Bronze Alloy                            3 Molten Copper + Molten Tin -> 4 Molten Bronze                         Δ +9 Cu, +3 Sn
Cassiterite Reduction with Wood         Cassiterite + 2 Wood (Burning) -> Tin + 2 Carbon Dioxide                Δ -10 C, -20 H, -8 O
Cassiterite Reduction                   Cassiterite + 2 Charcoal -> Tin + 2 Carbon Dioxide                      Δ -10 C, -20 H, -8 O
Celestine Decomposition                 2 Celestine -> Strontium Oxide + Sulfur Trioxide Gas                    Δ -4 O, -1 S, -1 Sr
Celestine Deposit Decomposition         (same)                                                                  Δ -4 O, -1 S, -1 Sr
Cerium Fluorocarbonate Decomposition    2 Cerium Fluorocarbonate -> Cerium Oxide + CO₂ + HF Gas                 Δ -1 C, -1 F, +1 H, -1 O
Copper Oxide + Hydrochloric Acid        Copper Oxide + HCl -> Copper(II) Chloride + Water                       Δ +1 Cl, +1 H
Cuprite Reduction with Wood             2 Cuprite Powder + Wood (Burning) -> 2 Copper + CO₂                     Δ -5 C, -2 Cu, -10 H, -5 O
Cuprite Reduction                       2 Cuprite Powder + Charcoal -> 4 Copper + CO₂                           Δ -5 C, -10 H, -5 O
Curdled Milk to Cheese                  Curdled Milk -> Cheese                                                  Δ -3 C, -7 H, +1 N, -4 O
Dolomite Decomposition                  2 Dolomite -> Limestone Gravel + Magnesium Oxide + CO₂                  Δ -2 C, -1 Ca, -1 Mg, -6 O
Dolomite Deposit Decomposition          (same)                                                                  Δ -2 C, -1 Ca, -1 Mg, -6 O
Ferrochrome + Aluminum                  Ferrochrome + 2 Aluminum -> 2 Molten Chromium + Molten Alumina          Δ -1 Fe, +3 O
Fluoroniobic Acid + Lye                 Fluoroniobic Acid + 5 Lye -> Niobium Oxide + 5 Sodium Fluoride          Δ -7 H, +1 Nb, -1 O
Granite Decomposition                   Granite + 3 Sulfuric Acid + 3 Water -> Al₂(SO₄)₃ + CaSO₄ + 2 H₄SiO₄     Δ -4 H, +1 O, +1 S
Hematite Decomposition                  2 Hematite -> 4 Iron Oxide + Oxygen Gas                                 Δ -2 Fe, -2 O   [fixed by Fe₂O₃]
Hematite Deposit Decomposition          (same)                                                                  Δ -2 Fe, -2 O   [fixed by Fe₂O₃]
Hematite Reduction with Wood            Hematite + 3 Wood (Burning) -> 3 Iron + Carbon Dioxide                  Δ -17 C, -30 H, -17 O
Hydrobromic Acid Dissolves Aluminum     2 Hydrobromic Acid + Aluminum -> Aqueous Aluminum Bromide + H₂          Δ +1 Br, -2 H, -1 O
Hydrochloric Acid Dissolves Aluminum    HCl + Aluminum -> Aluminum Chloride + Hydrogen Gas                      Δ +2 Cl, +1 H
Hydrochloric Acid Dissolves Iron Wall   HCl + Iron Wall -> Iron(II) Chloride + Hydrogen Gas                     Δ +1 Cl, +1 H
Hydrochloric Acid Dissolves Iron        HCl + Iron -> Iron(II) Chloride + Hydrogen Gas                          Δ +1 Cl, +1 H
Hydrochloric Acid Dissolves Manganese   HCl + Manganese -> Manganese(II) Chloride + Hydrogen Gas                Δ +1 Cl, +1 H
Hydrochloric Acid Dissolves Potash      HCl + Potash -> Potassium Chloride + Water                              Δ -1 C, +1 H, -1 K, -2 O
Hydrochloric Acid Dissolves Rust Wall   3 HCl + Rust Wall -> Iron(II) Chloride + 3 Water                        Δ -1 Cl, -1 Fe, +3 H
Hydrochloric Acid Dissolves Zinc        HCl + Zinc -> Zinc Chloride + Hydrogen Gas                              Δ +1 Cl, +1 H
Hypochlorous Acid + Copper              2 Hypochlorous Acid + Copper -> Chlorine Gas + Copper(II) Chloride      Δ +2 Cl, -2 H, -2 O
Iron(II) Hydroxide Decomposition        Iron(II) Hydroxide -> Iron Oxide + Steam                                Δ -2 O          [fixed by Fe(OH)₂]
Iron(III) Sulfate Decomposition         Iron(III) Sulfate -> Rust + Sulfur Trioxide Gas                         Δ -6 O, -2 S
Lanthanum Fluorocarbonate Decomposition 2 Lanthanum Fluorocarbonate -> La₂O₃ + CO₂ + HF Gas                     Δ -1 C, -1 F, +1 H, -1 O
Leaf Composting                         Fallen Leaf -> Carbon Dioxide + Steam                                   Δ -5 C, -8 H, -2 O
Lepidolite Decomposition - Lithium      Lepidolite -> Molten Li₂O + Molten Silica + Steam + HF Gas              Δ -4 Al, -1 F, +3 H, -1 K, -6 O, -2 Si
Lepidolite Decomposition - Potassium    Lepidolite -> Molten K₂O + Molten Silica + Steam + HF Gas               Δ -4 Al, -1 F, +3 H, +1 K, -2 Li, -6 O, -2 Si
Lepidolite Decomposition                Lepidolite -> Molten Alumina + Molten Silica + Steam + HF Gas           Δ -2 Al, -1 F, +3 H, -1 K, -2 Li, -4 O, -2 Si
Lye + Andesite                          Andesite + 4 Lye -> 4 Sodium Silicate + Sodium Aluminate + 2 Water      Δ +4 Na, +4 O, +1 Si
Molten Alumina Reduction                Molten Alumina + 3 Carbon -> 2 Molten Aluminum + 2 CO                   Δ -1 C, -1 O
Molten Cerium Chloride Decomposition    2 Molten Cerium Chloride -> 2 Cerium + Chlorine Gas                     Δ -4 Cl
Molten Ferrochrome + Aluminum           Molten Ferrochrome + 2 Aluminum -> 2 Molten Chromium + Molten Alumina   Δ -1 Fe, +3 O
Molten Ferrochrome + Molten Aluminum    (same)                                                                  Δ -1 Fe, +3 O
Molten Lanthanum Chloride Decomposition 2 Molten Lanthanum Chloride -> 2 Lanthanum + Chlorine Gas               Δ -4 Cl
Molten Neodymium Chloride Decomposition 2 Molten Neodymium Chloride -> 2 Neodymium + Chlorine Gas               Δ -4 Cl
Molten Salt + Magnesium Liquid          Molten Salt + Magnesium Liquid -> Sodium + Magnesium Chloride           Δ +1 Cl
Molten Steel + Oxygen Gas               Molten Steel + Oxygen Gas -> Molten Iron + Carbon Dioxide               Δ -2 Fe
Nitric Acid Dissolves Silver            2 Nitric Acid + Silver -> Aqueous Silver Nitrate + NO Gas + Water       Δ +2 H
Pentlandite Powder Roasting             Pentlandite Powder -> Nickel Oxide + Sulfur Dioxide Gas                 Δ -8 Ni, +3 O, -7 S
Pentlandite Roasting                    (same)                                                                 Δ -8 Ni, +3 O, -7 S
Plant Combustion                        Plant -> Carbon + 2 Carbon Dioxide                                     Δ -3 C, -10 H, -1 O
Platinum(III) Oxide Decomposition       Platinum(III) Oxide -> 2 Platinum + Oxygen Gas                          Δ -1 O
Potassium Bisulfate Reduction           2 Potassium Bisulfate + 3 Carbon -> K₂S + 3 CO₂ + Steam                 Δ -1 O, -1 S
Praseodymium Fluorocarbonate Decomp.    2 Pr Fluorocarbonate -> Pr₂O₃ + CO₂ + HF Gas                           Δ -1 C, -1 F, +1 H, -1 O
Pyrite Decomposition                    2 Pyrite -> Rust + Sulfur Dioxide Gas                                   Δ +5 O, -3 S
Quicklime + Hydrochloric Acid           Quick Lime + HCl -> Calcium Chloride + Water                            Δ +1 Cl, +1 H
Ruby Crystal Growth                     3 Molten Alumina + Molten Chromium -> Ruby Crystal                      Δ -4 Al, -6 O
Rust Reduction                          Rust + 3 Carbon -> 2 Iron + 2 Carbon Monoxide                           Δ -1 C, -1 O
Samarium Fluorocarbonate Decomposition  2 Sm Fluorocarbonate -> Sm₂O₃ + CO₂ + HF Gas                           Δ -1 C, -1 F, +1 H, -1 O
Sodium Tellurium Reduction              Aq. Sodium Tellurite + 2 Aq. SO₂ + Water -> Te + Aq. Na₂SO₄ + 2 H₂SO₃  Δ +2 H, +4 O, +1 S
Stannite Decomposition                  Stannite -> Antimony + 2 SO₂ + Cu₂S + FeS                               Δ +1 Fe, +4 O, +1 Sb, -1 Sn
Steel Alloy                             3 Molten Iron + Carbon -> 3 Molten Steel                                Δ +2 C, +6 Fe
Sulfuric Acid + Andesite                2 Andesite + 3 H₂SO₄ + 3 Water -> Na₂SO₄ + Al₂(SO₄)₃ + 6 H₄SiO₄        Δ +12 H, +9 O, +1 S
Sulfuric Acid + Fallen Leaf             Sulfuric Acid + Fallen Leaf -> Carbon Dioxide + Sulfuric Acid           Δ -5 C, -10 H, -3 O
Sulfuric Acid + Granite Gravel          Granite Gravel + 3 H₂SO₄ + 3 Water -> Al₂(SO₄)₃ + CaSO₄ + 2 H₄SiO₄     Δ -4 H, +1 O, +1 S
Sulfuric Acid + Grass (Cut)             Sulfuric Acid + Grass (Cut) -> Carbon + Sulfuric Acid                   Δ -5 C, -10 H, -5 O
Sulfuric Acid + Grass1 … Grass4         (same, four reactions)                                                  Δ -5 C, -10 H, -5 O
Sulfuric Acid + Leaves                  Sulfuric Acid + Leaves -> Carbon Dioxide + Sulfuric Acid                Δ -5 C, -10 H, -3 O
Sulfuric Acid + Tree                    2 Tree + Sulfuric Acid -> Sulfuric Acid + Carbon + Water                Δ -11 C, -18 H, -9 O
Sulfuric Acid + Wood Wall               2 Wood Wall + Sulfuric Acid -> Sulfuric Acid + Carbon + Water           Δ -11 C, -18 H, -9 O
Sulfuric Acid + Wood                    2 Wood + Sulfuric Acid -> Sulfuric Acid + Carbon + Water                Δ -11 C, -18 H, -9 O
Sulfuric Acid Dissolves Li-Mn Oxide     2 LiMnO₂ + 4 H₂SO₄ -> Li₂SO₄ + 2 MnSO₄ + 3 Water                       Δ -2 H, -2 Mn, -9 O, -1 S
Sylvanite Decomposition                 Sylvanite -> Gold + Silver + 2 Tellurium Dioxide                        Δ +4 O, -2 Te
Sylvanite Powder Decomposition          (same)                                                                 Δ +4 O, -2 Te
Triuranium Octoxide + Hydrogen Gas      U₃O₈ + Hydrogen Gas -> 3 Uranium Dioxide + Steam                        Δ -1 O
Tungsten Trioxide + Hydrogen Sulfide    WO₃ + 2 H₂S -> WS₂ + 3 Water                                           Δ +2 H
Vanadinite Decomposition                2 Vanadinite -> Lead Oxide + Vanadium Pentoxide + Chlorine Gas          Δ -18 O, -9 Pb, -4 V
Vanadinite Deposit Decomposition        (same)                                                                 Δ -18 O, -9 Pb, -4 V
Wolframite (Manganese) + Sodium Carb.   MnWO₄ + Na₂CO₃ -> Na₂WO₄ + Manganese Oxide + CO₂                       Δ +1 Mn, +2 O
Wood Gasification                       9 Wood -> 4 Wood + CO + CO₂ + H₂ + Methane                              Δ -27 C, -44 H, -22 O
```

---

## Method

Every figure above came from reading the game's `Data/AllMaterials.json` and
`Data/AllReactions.json`, extracted from the `.pck` with `godotpcktool`.

- **Provenance.** The work was done twice: once against `data/atomcraft.json` (this repo's
  bake) and once against the game's originals, comparing the two field by field first. See
  the note at the top for what that comparison found. Anything resting on a zero or an
  absent field — `Mass` of 0, a null `Evaporation.TargetMaterialName`, an empty-string
  `Formula` — was confirmed literal in the game's own JSON rather than inferred from the
  bake's omissions.
- **Composition resolution.** `Composition.Elements` was walked recursively, resolving
  non-element `Item1` values as material names (with cycle detection), falling back to
  `Formula` parsed by `src/formula.js` when no composition exists. A material counts as
  resolved only if every branch bottoms out in real element symbols with no alternation
  groups (`(F,OH)`), percentages (`17% Co`) or unknown symbols.
- **Balance.** For each reaction, element totals were summed over `Inputs` and `Outputs`
  weighted by amount; catalysts were excluded as unconsumed. A reaction is checkable only if
  every participant resolves.
- **Real-world reference values** — densities, atomic masses, melting and boiling points —
  were entered from standard tables to test the `Mass` and phase-transition hypotheses. The
  claims that do not depend on them (contradictions between two fields of the same material,
  round-trip mismatches, dangling references, decay arithmetic) are self-contained in the
  data.
- **Decay and impact arithmetic** used ΔZ/ΔA of −2/−4 for alpha, +1/0 for beta-minus, −1/0
  for beta-plus, 0/+1 for neutron capture, +1/+1 for proton capture, +2/+4 for alpha capture.

Scripts live in this job's scratch directory and are not committed; they are short enough to
reproduce from the descriptions above.
