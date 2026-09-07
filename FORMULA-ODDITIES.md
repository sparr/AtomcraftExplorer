# What the formulas say, and where they disagree

833 of the 1871 materials in `AllMaterials.json` carry no chemical formula.
`src/formulas.js` now supplies 244 of them, worked out by hand where the
chemistry is not in doubt and by conservation of atoms everywhere else. That
took the materials with countable atoms from 1024 to 1268, and the chemical
reactions in which every participant can be counted from 324 to 547 of 687.

Working them out meant balancing equations, and balancing equations turned up
a lot of equations that do not balance. What follows is what fell out.

## The method, and how much to trust it

Where a reaction has exactly one participant of unknown composition, the rest
of the equation determines it. That is the whole trick, applied repeatedly
until nothing new appears.

It only works if you are choosy about which reactions you believe, because a
great many of them do not conserve atoms. So a formula resting on a single
reaction is thrown away, and only agreement between two or more independent
reactions is kept. Nuclear decay, beam impact, growth and mining are excluded
outright — those are meant to create and destroy matter.

That leaves out 23 materials where the evidence conflicts, 126 resting on one
reaction alone, and everything that came out with a fractional atom count.
Paints, batters and egg yolk have no formula worth writing.

One family is excluded by name, in `DOUBTED`, because agreement is not the
same as being right — see Apatite below.

## The glaring ones

### A third of chemical reactions do not conserve atoms

Of the 324 reactions where every participant had a formula supplied by the
game — no inference of ours involved — **122 (38%) do not balance**. Oxygen is
the most frequent offender by a wide margin (106 reactions), then hydrogen
(52) and carbon (12).

This is not a rounding problem. It is the reason the plan solver finds free
matter so attractive: minimising what you buy will always route through a
reaction that makes atoms out of nothing.

### Roasting an ore takes its oxygen from nowhere

    Galena Decomposition       2 PbS    -> 2 PbO + 2 SO2                     6 O from nowhere
    Argentite Decomposition    2 Ag2S   -> 4 Ag  + 2 SO2                     4 O
    Cobaltite Decomposition    2 CoAsS  -> 2 CoO + As2O3 + 2 SO2             9 O
    Bismuthinite Decomposition                                               9 O
    Copper(I) Sulfide Decomposition                                          6 O

Roasting a sulfide really does consume air, and the recipes simply do not list
it as an input. Whether that is worth fixing is a design question — it may be
deliberate, so that smelting does not require you to pipe in oxygen — but it
does mean these reactions mint oxygen, and the solver will happily build a
factory around them.

### Dissolving a *metal* in acid uses half the acid it needs

    Hydrochloric Acid Dissolves Iron       1 HCl + 1 Fe -> 1 FeCl2 + 1 H2     needs 2 HCl
    Hydrochloric Acid Dissolves Steel      1 HCl + 1 Steel -> 1 FeCl2 + 1 H2  needs 2
    Hydrochloric Acid Dissolves Aluminum   1 HCl + 1 Al -> 1 AlCl3 + 1 H2     needs 3
    ...also Iron Wall, Manganese, Zinc

The telling detail is that the neighbouring recipes get it right:
`Dissolves Iron Oxide` and `Dissolves Iron Sulfide` both use 2 HCl, correctly.
So this is not a convention, it is a slip, and it is confined to the
dissolutions that attack a bare metal. The same shape appears in the
hydrobromic and hydrofluoric families.

### The `Fl` typo transmutes fluorine into flerovium

Eight formulas contain `Fl`. Seven of them are genuine — the Flerovium
isotopes. **Exactly one is the bug: `Magnesium Fluoride: MgFl2`**, where `Fl`
is meant as fluorine but is read as element 114. (We had this recorded as
affecting eight formulas; it is one.)

It is not merely cosmetic, because a reaction bridges the two:

    Beryllium Fluoride + Magnesium Liquid    off by  F-2  Fl2

Two fluorine atoms go in and two flerovium atoms come out. Run in a loop, that
recipe is a superheavy-element generator.

### Potash is two different substances

    Aqueous Potash + Slaked Lime      -> 2 Aqueous Potassium Hydroxide + Limestone Gravel
    Hydrochloric Acid Dissolves Potash-> Potassium Chloride + Water

The first is textbook causticisation, K2CO3 + Ca(OH)2 -> 2 KOH + CaCO3, and
only works if potash is **K2CO3**. The second balances only if potash is
**KOH**. We have gone with K2CO3, which makes the second reaction wrong; it is
also short an HCl and missing its CO2.

This one matters for the columbite plans, which run on aqueous potash.

### Steel carries a third of a carbon, and gives back a whole one

    Steel Alloy               3 Molten Iron + 1 Carbon -> 3 Molten Steel
    Molten Steel + Oxygen Gas 1 Molten Steel + 1 O2    -> 1 Molten Iron + 1 CO2

One carbon in, three out. This is the known carbon-minting bug, now with a
number on it: the round trip multiplies carbon by exactly three, because
carburising divides one carbon across three steel and decarburising releases a
full carbon from each.

### Two reactions that double a metal

    Hydrofluoric Acid Dissolves Columbite   1 Fe(Ta,Nb)2O6 + 6 HF -> ... + 2 FeF2 + ...
    Fluoroniobic Acid + Lye                 1 H2NbOF5 + 5 NaOH    -> 1 Nb2O5 + 5 NaF

Columbite holds one iron and the reaction yields two. Fluoroniobic acid holds
one niobium and the product holds two. Neither depends on any formula of ours
— iron and niobium appear nowhere else in those equations.

The columbite recipe is also short on fluorine, but that part *does* depend on
our reading of the two heptafluoro acids as H2TaF7 and H2NbF7, so treat it as
less certain than the iron.

## Quieter oddities, but worth knowing

### The aqueous materials disagree with themselves

Of the 53 `Aqueous X` materials, **16 write the formula as `X+H2O`, 10 write a
bare `X`, and 27 say nothing at all**. That single inconsistency is behind the
largest family of imbalances in the data — dozens of reactions that come out
short or long by exactly one water.

The ten written without their water:

    Aqueous Calcium Chloride     Aqueous Nickel Sulfate
    Aqueous Copper(II) Chloride  Aqueous Nickel(II) Sulfate
    Aqueous Copper(II) Sulfate   Aqueous Zinc Bromide
    Aqueous Iron(II) Sulfate     Aqueous Zinc Chloride
    Aqueous Lithium Sulfate      Aqueous Zinc Sulfate

(Note also `Aqueous Nickel Sulfate` and `Aqueous Nickel(II) Sulfate`, which
look like the same substance entered twice.)

We treat every aqueous form as `X + H2O`. It is the reading the majority of
the data uses, and it is what the filter recipes do when they split one back
into its parts.

### Thirteen formulas the atom counter could not read

These use an alternate-site notation, which is right for a mineral and
unusable for counting:

    Columbite            Fe(Ta,Nb)2O6        Topaz        Al2SiO4(F,OH)2
    Lepidolite Deposit   KLi3Al4O10(OH,F)2   Pollucite    (Cs,Na)AlSi2O6·H2O
    Braggite (Pt,Pd,Ni)S, Laurite (Ru,Os,Ir)S2, Bowieite, Irarsite, Kotulskite

Counted the way search counts, columbite holds two tantalum *and* two niobium,
and a plan built on that reading mints metal. `expectedCounts` in
`src/formula.js` gives each branch an equal share of its site instead, exposed
on every material as `m.atoms`; shares may be fractional, so pollucite holds
half a caesium. `Garnet` (`X3Y2(SiO4)3`) stays unreliable — its placeholders
are not elements at all.

**Columbite and Lepidolite Deposit are both on that list**, which matters given
that they sit at the centre of every one of the five ideal plans.

### What the reactions say columbite and lepidolite are

An even split is only an assumption. For these two the reactions can be asked
directly, and they answer.

**Columbite** has one reaction, and it corroborates the split exactly:

    1 Columbite + 6 Hydrofluoric Acid
      -> 1 Heptafluorotantalic Acid + 1 Heptafluoroniobic Acid + 2 FeF2 + 3 H2O

One tantalum acid and one niobium acid, so the site is half and half:
**FeTaNbO6**. (The iron still doubles, as above.)

**Lepidolite** decomposes three ways, and the three differ in exactly one slot:

    Lepidolite Decomposition               1 in 50   -> Molten Alumina        + SiO2 + H2O + HF
    Lepidolite Decomposition - Lithium     1 in 51   -> Molten Lithium Oxide  + SiO2 + H2O + HF
    Lepidolite Decomposition - Potassium   1 in 52   -> Molten Potassium Oxide+ SiO2 + H2O + HF

`Probability` is a divisor, so those fire at 34.0%, 33.3% and 32.7% — a third
each, near enough. Written as a site, the reactions describe lepidolite as

    (Al2O3, Li2O, K2O) SiO2 · H2O · HF

which is the shape it looked like it should have. Three of them come to
**2 Al + 2 Li + 2 K + 3 Si** (2.04, 2.00, 1.96 weighted exactly), which is
where "three lepidolite makes two potassium" comes from.

That does **not** agree with the stated formula. Per one lepidolite:

    source                          K    Li   Al   Si   F
    stated  KLi2Si3Al4O10F2         1    2    4    3    2
    sulfuric acid dissolution       1    2    1    1    0.5
    the three decompositions      0.65 0.67 0.68   1    1

Three sources, three answers. The acid route agrees with the formula on
potassium and lithium and on nothing else; the decompositions agree with
neither, and throw away roughly two thirds of the silicon and five sixths of
the aluminium. Nothing here is a rounding error.

We have not overridden the stated formula with any of this. It is recorded
because a plan's yield is governed by the reactions and not by the formula, and
the two disagree by a factor of three to six.

### Lepidolite is entered twice, and the two disagree

    Lepidolite           KLi2Si3Al4O10F2
    Lepidolite Deposit   KLi3Al4O10(OH,F)2

Same mineral, different substance: the deposit has an extra lithium, no
silicon at all, and hydroxyl where the other has fluorine — yet mining it
yields the other, and both decompose by the same six reactions into silica.
The real mineral is K(Li,Al)3(Al,Si)4O10(F,OH)2, so it is the deposit that has
lost its silicon.

### Mining lepidolite yields rubidium that is in no formula

    Lepidolite Deposit  DropRates  { Lepidolite: 100, Rubidium: 10 }

A lepidolite deposit drops one lepidolite every time and a rubidium one time in
ten, so its expected composition carries about 0.1 Rb — which appears nowhere
in `KLi3Al4O10(OH,F)2`. This one is realistic rather than wrong: lepidolite is
the principal ore of rubidium. It does mean the drop table knows something the
formula does not.

### Hydrofluoric acid is five atoms, not two

`Hydrofluoric Acid` is written `HF+H2O`: it is the aqueous acid, and a unit of
it carries a water. Which is correct, and easy to forget when counting by
hand -- the columbite ideal was recorded as costing 23 atoms on the reading
that HF is two, where the recipe it names actually costs 35.

Twenty-six of the fifty-three aqueous materials carry their water this way.
Anything counting atoms off a name rather than a formula will be wrong about
all of them.

### A unit of liquid hydrogen is four units of gas

21 of the 657 phase transitions are not 1:1. Hydrogen gas condenses **4 to 1**
into liquid hydrogen, and the hydrocarbon vapours all run 2 to 1.

This is very likely the answer to why the solver kept reaching for liquid
hydrogen over hydrogen gas: measured in units rather than atoms, liquid
hydrogen is four times the matter for one fetch.

### Molten silica does not freeze back into silica

    Silica -> Molten Silica -> Glass

The phase cycle is one-way. Melting sand and letting it cool gives you glass,
which is a nice piece of game design and a trap for any code that assumes a
phase link is reversible.

### Reduction with wood ignores the wood

`Hematite Reduction with Wood` is off by `Fe1 O-16 C-17 H-30`; the carbon and
hydrogen in the wood go unaccounted. `Cassiterite Reduction` and `Cuprite
Reduction` have the same shape.

### Apatite is a phosphate everywhere except here

No reaction in the data fixes apatite's composition. It takes part in nothing
but phase changes, mining, and blending into clay, so an inference about it is
really an inference about clay wearing apatite's name — and it comes back
CaCO3, which is calcite. Real apatite is a phosphate, and this data has both
`Phosphorus` and `Calcium Phosphate` in it, so the answer is wrong however
many reactions agree with each other.

It is excluded by name for that reason. It also mattered in a way worth
recording: putting a formula on `Molten Apatite` moved the entire Apatite
phase-group out of "terrain" and in among the compounds, because a phase group
takes its category from whichever member states a formula. A wrong formula is
worse than none.

`Calcium Phosphate` likewise has no formula, and would be an easy one to add
upstream.

### A quarter of the gaps are not gaps

Of the 833 materials with no formula, 197 appear in no allowed reaction at
all — mostly machinery: logic gates, balance pipes, the `(On)`/`(Off)`
variants. They are no loss. Worth stating only so that "833 have no formula"
is not mistaken for "833 gaps that matter".

## Where the conflicts were

The 23 materials with genuinely contradictory evidence, which we decline to
guess at. The interesting ones:

    Limestone Gravel     CaCO3 x3   vs  CaO x3   vs  C3Ca2MgO9 x2
    Antimony(III) Oxide  Sb2 x1     vs  Sb2O3 x1        (we say Sb2O3, by hand)
    Grass, Grass (Cut)   C x1       vs  C6H10O5 x1
    Fallen Leaf          CH2O3      vs  CO2      vs  C6H10O5
    Limewater            CaH6O4     vs  CaH4O3
    Aqua Regia           Cl4HNO2    vs  Cl3H4NO3        (we say HNO3+3HCl, by hand)

`Limestone Gravel` is the one to look at: three reactions read it as calcium
carbonate and three as quicklime, which means three of them are losing a CO2.
