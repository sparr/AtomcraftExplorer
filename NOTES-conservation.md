# Where the conservation checks stop

Sparr, after reading a plan that made three Oxygen Gas a batch out of nothing
but a charge: something has gone systemically wrong with the conservation
enforcement mechanisms. It has. There are three holes, one of them now closed,
and they are not the same kind of hole.

## What is actually enforced

Only one thing: that no set of steps can produce something from nothing.
`freeLunch` takes the steps a plan chose, cuts off every supply, and asks
whether they can still make anything. Element conservation is deliberately not
checked, and the reason is written beside it -- an aqueous salt's formula does
not carry its water, so evaporating one appears to conjure the steam, and 356
of the game's reactions read as minting something. The game is approximate on
purpose; air in particular is not modelled, which is why the buy-and-vent pass
excludes oxygen by name.

So "this plan makes Copper Oxide without buying oxygen" is not, on its own,
something any check here claims to catch. That is worth knowing before reading
the rest.

## Hole one: the gate that arms an exclusion looks one way (fixed)

`tools/find-wheels.mjs` finds pairs of recipes that between them hand back more
of an element than went in, and `MINTING_PAIRS` records the sixteen it found.
Each is re-proved at load time by `mintsElement`, so an exclusion lifts itself
if the recipe is ever fixed -- and the comment beside `KNOWN_BUGS` says the
pair is measured both ways round.

It was not. `mintsElement` looks for the handoff as *what `a` makes that `b`
eats*, and a pair named the other way finds nothing and returns false at the
first line. Three of the sixteen are named that way:

```
rx:Hydrochloric Acid Dissolves Manganese  with  cond:Molten Manganese      mints H
rx:Quicklime + Hydrochloric Acid          with  rx:Chlorine Gas + Hydrogen Gas  mints H
rx:Potassium Sulfide Decomposition        with  rx:Molten Potassium + Molten Sulfur  mints O
```

In each, the second recipe feeds the first. All three were reported by
`unprovenBugs` as "cannot count the H" or "cannot count the O", which was never
the trouble: every material in them counts. The message is the one the code
pushes for any false return.

The third is what the Oxygen Gas plan turns on. `rx:Potassium Sulfide
Decomposition` takes two Potassium Sulfide and gives back two Potassium Oxide
and two Sulfur Dioxide Gas -- six oxygen atoms out of a compound with none in
it. The plan circulates potassium, sulfur and carbon and lets the oxygen fall
out. Trying the pair both ways round arms all sixteen; `unprovenBugs` is now
empty.

It cleans up one of the twelve plans in question (Carbon Dioxide) and leaves
the rest, which is how the other two holes were found.

## Hole two: the wheel's payload is the one material not looked at

`freeLunch` asks its question once per material, and skips any material no step
in the plan consumes -- "a wheel has to be turning on something". But the thing
a wheel turns on and the thing it emits are not the same material. The Oxygen
Gas plan circulates potassium and sulfur, both of which net to zero, and emits
Oxygen Gas, which nothing consumes and which is therefore never asked about.

Measured, by asking `freeLunch`'s own question with and without that rule:

```
Oxygen Gas    as asked: nothing
              every made material: Oxygen Gas (never eaten)   <- caught
```

With supplies cut, producing *any* material is producing from nothing, so there
is no reason the question has to be restricted. The restriction is what lets
this through. Not changed here: it is one line, and it wants measuring across
the corpus before it goes in.

## Hole three: needing a little of something is not the same as needing all of it

The other four plans Sparr flagged are not wheels at all, and `freeLunch` finds
nothing in them either way:

```
Copper Oxide      buys Cu            out Cu O        mints O
Quick Lime        buys Ca            out Ca O        mints O
Aqueous Lye       buys C Na          out Cl H Na O   mints Cl H O
Hydrogen Bromide  buys C             out Br Cl H     mints Br Cl H
```

They consume their purchases, so cutting the supply stops them and the test
reports no wheel. What they do is buy a little of one element and emit another
they were never given. Over enough batches that is unbounded all the same, and
the charge is where it hides: Hydrogen Bromide's bromine, chlorine and hydrogen
are all in its charge, laid in once, and the plan emits bromine every batch.

`freeLunch` tests "something from nothing". It does not test "an element it was
never given". Whether it should is the open question, and it is the one that
was already answered once, in the negative, on the grounds that counting atoms
flags 356 reactions the game means to be approximate. Oxygen is the clearest
case for leaving it alone -- air is not modelled and half the reactions help
themselves. Bromine is the clearest case against.

## The question that started it

**Why do Oxygen Gas and Liquid Oxygen plan differently when the phases are
collapsed?** Because they are not collapsed, and correctly so. The crossing
between them is four to one -- `cond:Oxygen Gas` takes 4 Oxygen Gas and gives 1
Liquid Oxygen, `evap:Liquid Oxygen` gives 4 back -- and the family test takes
only crossings that are one for one in both directions. A unit of the liquid
holds four units of the gas, so the two cannot share a row without the
arithmetic being wrong. `stands()` puts each in a family of its own, and the two
questions are genuinely different.


## What can be banned, and what cannot

Asked to ban these without breaking other plans. One class can be banned
outright and is; the other cannot be banned by any element rule, and the
measurements are below.

### Banned: producing anything at all with nothing coming in

`freeLunch` now asks its question about every material the plan makes, not only
the ones it also spends. With every supply cut, making any material is making
it out of nothing, so there was never a reason to leave one out -- and the one
left out was the one the wheel hands over. The circulating materials are still
asked about first, so where a wheel shows on both, the blame falls where it did
before: on a material in the middle of the loop rather than on the answer.

Measured over the 194-plan corpus: **193 identical, one moved, none lost, none
gained**, and the number of plans that buy and feed nothing yet hand something
back went from one to **none**. The one that moved is Oxygen Gas, which now
buys two Osmium Arsenosulfide and runs in four reactors rather than nine. It
costs about a fifth more wall clock across the corpus, being one small linear
programme per material rather than per circulating material.

### Not bannable: an element appearing that nothing bought

Three ways of asking, all of them too noisy to refuse a plan on:

```
per process, by presence   796 of 4264 processes -- 430 beam, 238 decay,
                           where changing an element is the whole point
per plan, by presence      48 of the 96 answerable plans -- half of them
per process, by count      177 processes, 64 of them gaining something
                           other than H or O
```

The 48 split cleanly, which is what makes them readable rather than alarming:

```
25   the plan contains a beam or decay step -- transmutation, so element
     conservation means nothing
16   H and/or O only -- air is not modelled, and an aqueous salt's formula
     does not carry its water
 7   everything else
```

And counting does not rescue it. `rx:Aqueous Bromine + Aqueous Ammonium Iodide`
reads as gaining a bromine only because Aqueous Bromine parses as Br rather
than Br2; the halide swap it describes is balanced. Counting cannot tell a
formula that is wrong from a recipe that is wrong, so the older decision --
that atoms are the wrong tool -- holds.

### The seven, and the one recipe under them

Six of the seven mint chlorine, and tracing the chlorine through the Hydrogen
Bromide plan step by step lands on one recipe:

```
rx:Hydrochloric Acid Dissolves Steel
   1 Hydrochloric Acid + 1 Steel  ->  1 Iron(II) Chloride + 1 Hydrogen Gas
```

Hydrochloric Acid carries one chlorine, Iron(II) Chloride carries two. One in,
two out, and a hydrogen minted with it -- the chemistry is `Fe + 2 HCl`, and the
recipe says one. Twelve runs of it in that plan, twelve chlorine a batch out of
nothing. Every material in it parses and none of them is an aqueous form, so
none of the usual excuses apply.

That is a recipe error, and the place for it is the curated list, which already
knows how to gate an exclusion and how to lift it if the game is ever fixed.
What `find-wheels.mjs` looks for is a *pair* whose loop gains an element; this
needs no partner. A scan for single processes that gain atoms where every
formula parses **and no material in them is an aqueous or mixture form** would
be a short list somebody could read, and the filter in bold is the judgement
call -- which materials the formulas can be trusted about. Not built here.

## The 4:1 families, built

Sparr: the 4:1 ratio can share a row if the coefficients are scaled by four
going in and quartered coming back out. Quite right, and the reason given
earlier for leaving Oxygen Gas and Liquid Oxygen apart -- that the arithmetic
forbids it -- was wrong.

A family now needs the round trip to *close*, not to be one for one: the two
ratios must be reciprocal. Four gas into one liquid and one liquid into four
gas closes, and is a packing ratio.

**Nothing currently fails that test**, and it is worth saying so rather than
implying otherwise. Of 946 one-in one-out phase steps, 204 pairs have a return
trip and every one of them closes; the other 538 are one way only -- the
cracking steps, which have no partner and are excluded by the older rule that
the trip has to come back at all. What the check actually guards is the claim
in `plan-graph.js` that a pair's two `Amount` fields are the same ratio stated
twice: `evap:A` reads A's `Evaporation.Amount` and `cond:B` reads B's
`Condensation.Amount`, which are different fields on different materials and
are only equal because the game writes them that way. If a future data drop
ever disagreed, this is what would notice.

An earlier draft of this note cited "one vapour into two oil against one oil
into two vapour" as a live example of a pair the test rejects. It is not one:
that is the shape of the *old* reading bug, from before `Condensation.Amount`
was understood as an input count, and it has not existed in the graph since
that was fixed.

`phaseFamilies` walks a scale out from the representative over the crossings
that closed and then checks it against every crossing in the family, dropping
any family whose scales disagree with one of its own -- because a family like
that has a route round it that gains, and collapsing it would bake the gain in.

`worth(name)` is what one unit is worth on its family's row. Coefficients,
supply columns and demand all go in multiplied by it, `nulled` nets with it so
a 4:1 crossing still reads as the no-op it is, and `assemble` nets the family
in row units and runs each crossing as many times as it takes to move that
much. A crossing that does not divide evenly grows the batch, the same way a
reaction that does not divide evenly always has.

Eight families gained a packing ratio: Liquid Oxygen and Liquid Hydrogen at
four to one, and the five petroleum vapours plus ethanol at one to two.

Asked for Liquid Oxygen, the plan is now the Oxygen Gas plan and a condense --
the same four reactors, the same two Osmium Arsenosulfide, four gas to the
litre -- which is what it should always have been. Over the corpus the change
moves no plan at all: 194 identical, none lost, none gained.


## Barring a minting recipe only where it would be used

Sparr: ban it for plans trying to output that element, and not otherwise.

`MINTS_INTO_WANT` is a hand-curated list of recipes that gain an element, and
the candidate walk drops one only when some target is made of what it mints. A
recipe that hands back a chlorine it was not given is load-bearing only where
chlorine is wanted; elsewhere it is a step nobody takes, and barring it there
would cost routes for nothing.

One entry so far, the one traced above:

```
rx:Hydrochloric Acid Dissolves Steel   mints Cl, H
```

Over the corpus: **187 of 194 identical, seven moved, none lost, none gained**,
and slightly faster. The seven are the ones it was aimed at:

```
Ammonium Chloride        Cl H    ->  nothing
Hydrogen Bromide         Br Cl H ->  nothing        now buys bromine and hydrogen
Molten Ammonium Nitrate  C H     ->  nothing
Aqueous Lye              Cl H O  ->  O
Lye                      Cl H O  ->  O
Hypochlorous Acid        Cl H O  ->  H O
Methane                  nothing ->  nothing
```

The residue of plans that hand back something other than hydrogen, oxygen or a
transmutation product goes from seven to **two**.

### On "definitely does not contain enough"

Sparr's other suggestion, and it is sound. `mintsElement` gives up the moment a
formula will not parse -- "cannot say, so do not claim" -- because it is asking
for an exact count. The one-sided question does not need one: a material's
`matter` is its total atoms, so it is an upper bound on how much of any single
element it can hold. Where a recipe's outputs carry provably more of an element
than its inputs can possibly hold, it mints, formula or no formula.

It is weaker than counting and never wrong, which is the right trade for
arming an exclusion. Not built: it only pays where a recipe has an
unparseable material in it, and the one entry above has none.


## The last two, traced

### Silica: two recipes, both a coefficient short

Counted step by step over its batch of twelve:

```
Cl  +24   24x rx:Hydrochloric Acid Dissolves Steel
          1 Hydrochloric Acid + 1 Steel -> 1 Iron(II) Chloride + 1 Hydrogen Gas
S    +6    6x rx:Sulfuric Acid + Granite Gravel
          1 Granite Gravel + 3 Sulfuric Acid + 3 Water
             -> 1 Aluminum Sulfate + 1 Calcium Sulfate + 2 Orthosilicic Acid
```

The first is the recipe already curated. It is not barred here and that is the
rule working as written: Silica is made of silicon and oxygen, the recipe gains
chlorine and hydrogen, and the chlorine it gains leaves as twelve Chlorine Gas
on the floor rather than going into the answer. Barring a minting recipe where
the mint is not wanted would cost the route for nothing.

The second is new and the same fault. Three sulfate go in and four come out:
`Al2(SO4)3` carries three and `CaSO4` one. The anorthite in the gravel wants
four sulfuric acid and no water at all, and then it balances exactly -- every
other element already does, calcium one to one, aluminium two to two, silicon
two to two.

It is listed for its sulfur and **not** for its oxygen, though it gains one of
each. Tried both ways: with oxygen in the entry, Silica loses its only plan and
gets nothing back, because oxygen is in almost everything anybody asks for and
the gain here is one atom in twenty-four with the rest bought in the gravel.
That is the same reason the buy-and-vent pass leaves oxygen alone. With sulfur
alone the corpus is unchanged -- 194 identical, none lost -- which is the right
shape for a curated record of a bug nobody is currently standing on.

### Tellurium: not a conservation failure at all

The bench flagged it as handing back hydrogen, oxygen and sulfur. Counted, it
does not: hydrogen nets **-2** over the batch, oxygen **0**, sulfur **0**, with
two steps that cannot be counted because `Sulfurous Acid (Diluted)` and
`Sodium Tellurite` have no composition at all.

What it actually bought was `Aqueous Sodium Tellurite`, whose composition reads
`Te, Na` -- no oxygen, though sodium tellurite is `Na2TeO3`. So the oxygen that
comes out was bought, and the presence test could not see it go in.

Which is worth recording as a caveat on the bench: **`mints` over-reports.** It
compares which elements appear, and an incomplete formula on a purchased
material reads as minting everything that material really contained. The seven
that survived the nuclear and hydrogen-oxygen buckets were never seven real
failures; Tellurium is one false positive found by looking, and the others were
only confirmed by tracing the chlorine.


## The remaining failures, counted

`tools/audit-conservation.mjs` sums the element balance of every step of every
plan -- production minus consumption over the batch -- which needs no reference
to the shopping list, because anything bought enters as some step's input and
is counted there. A plan creates element E exactly when that sum is positive.
Losing matter is not creating it and is not reported.

That is a sharper instrument than the presence test in the bench, which said 45
of 96. Counted:

```
clean, counted              28
create an element           24
transmute (beam or decay)   25    element change is the point
cannot say (no formula)     19
```

By element, and the shape of the tail is the whole story:

```
O   19 plans        Al  2        Cl  1
H    6              Fe  1        S   1
                    Co  1
                    Cu  1
                    Sn  1
                    Nb  1
```

Nineteen of the twenty-four are oxygen. And the recipes fall into five kinds,
which is what matters, because only one of them is a recipe's fault.

**A recipe short of a coefficient.** Genuinely wrong, and the class
`MINTS_INTO_WANT` exists for:

```
rx:Aluminum Oxyhydroxide Decomposition   1 AlO(OH) -> 1 Alumina + 1 Steam
      Al+1 H+1 O+2. Alumina carries two aluminium and the input one; the
      chemistry is 2 AlO(OH) -> Al2O3 + H2O. Two plans -- Aluminum, and
      Aluminum Vapor.
rx:Fluoroniobic Acid + Lye               1 acid + 5 Lye -> 1 Niobium Oxide + 5 Sodium Fluoride
      Nb+1. Niobium Oxide is Nb2O5, so it wants two of the acid. One plan.
rx:Hydrochloric Acid Dissolves Steel     Cl+1 H+1   -- curated
rx:Sulfuric Acid + Granite Gravel        S+1 O+1    -- curated for the sulfur
```

**An alloy's formula read as a molecule.** Not a recipe fault:

```
rx:Bronze Alloy   3 Molten Copper + 1 Molten Tin -> 4 Molten Bronze   Cu+9 Sn+3
```

The recipe conserves units exactly -- four in, four out -- and Molten Bronze's
formula is `Cu3Sn`, which states the alloy's *ratio* and reads as a per-unit
molecule. So a unit of bronze counts as three copper and a tin, and four of
them as twelve. Nothing is minted; the formula is answering a different
question from the one being asked of it.

`rx:Cobalt Steel Alloy` was filed here too and did not belong. Molten Cobalt
Steel's formula is `17% Co 83% Fe`, and the counter had no case for a
percentage, so it dropped them and read a unit as one cobalt and one iron --
six of them out of one cobalt and five iron then reading as five cobalt
created. That was the counter's fault, not the recipe's, and it is fixed
below.

**A packing the counter was not reading.** `rx:Expansion of Hydrogen Gas x2`,
three plans, H+2 -- and that was the counter again, not the data. See below.

**Air, which is not modelled.** Oxygen, and one of them says so in its own
name:

```
rx:Hydrogen Sulfide Gas + Oxygen Gas   2 Hydrogen Sulfide Gas -> 2 Sulfur + 2 Steam   O+2
```

Four plans. The recipe is named for an oxygen it never takes in. That is the
documented approximation, not a bug to chase.

**An aqueous form that does not carry its water.** `filter:Aqueous Copper(II)
Sulfate` and its kin, three plans, hydrogen and oxygen.

So of the twenty-four, three recipes in two plans plus two singletons are
actually wrong, and everything else is the formulas being read for something
they are not. Which is the same conclusion the earlier measurement reached from
the other direction, now with the recipes named.


## The counter was dropping two kinds of node

Sparr, on the last of those: can we handle 2H2 reactions like a phase change
family, or even as part of the H2 family?

**No, and it turns out not to be needed.** There is exactly one packed
container in the game, `Hydrogen Gas x2`, and exactly one process touching it:
`rx:Expansion of Hydrogen Gas x2`, one packet into two gas. Nothing compresses
hydrogen back. A family needs the trip to come back -- that is the whole of the
test, and the reason `evap:Sand` is nobody's family -- so joining these two
would let the model turn two Hydrogen Gas into one packet, which nothing in the
game can do. It would be the Sand trap with a different name.

And the packing was never missing. `Hydrogen Gas x2` carries `atoms` of four
hydrogen and `matter` of four, both right. What was wrong was `atomsIn`, which
walked the formula tree itself and had no case for two of the node kinds in it:

```
coeff   the number in front of a segment -- HNO3 + 3HCl, CaSO4·2H2O, 2 H2
        Dropped. Aqua Regia read as one hydrogen where there are four, Gypsum
        as five oxygen where there are six, and a container of two hydrogen gas
        as holding two.
pct     a percentage -- 17% Co 83% Fe
        Dropped, so a unit of Molten Cobalt Steel read as one of each.
```

`src/formula.js` has had the right arithmetic all along in `tally`, which
handles both; `atomsIn` was a second, poorer copy of it. Now it handles a
coefficient the way `tally` does, resets it at a segment break, and *declines*
a percentage rather than dropping it -- a percentage is not a count of
anything, and "cannot say" is the honest answer.

Checkable, and checked: over 2148 element counts across every formula that
parses, `atomsIn` now agrees with the material's own `atoms` every single time,
and declines 71. That invariant is in `test-collapse.mjs`.

## Where that leaves it

Adding the two short-coefficient recipes to `MINTS_INTO_WANT`, and the counter
fixed:

```
                          before   after
clean, counted               28      30
create an element            24      20
transmute                    25      25
cannot say                   19      20
```

Gone from the list of elements created: **Al** and **Nb** (the two new curated
entries), **Fe** and **Co** (the percentage now declined), and hydrogen drops
from six plans to four (the coefficient now counted). What is left is oxygen in
seventeen plans, hydrogen in four, and one each of Cu, Sn, Cl and S.

Aluminum and Aluminum Vapor are outright better for it: they stop running
`rx:Aluminum Oxyhydroxide Decomposition`, buy Alumina directly instead of the
oxyhydroxide, leave no Steam behind, and take one step fewer.

**The cost is one plan.** `Niobium Oxide` has no plan at all now, because the
only route to it ran through `rx:Fluoroniobic Acid + Lye` -- which is barred
for exactly the targets made of what it creates, and Niobium Oxide is made of
niobium. Asking for it used to get an answer that created half its niobium; it
now gets nothing, which is the same call the round loop makes when every road
runs through a wheel. Dropping the `Nb` entry gives the plan back.

The niobium and tantalum cases Sparr flagged are undamaged: both Columbite
questions come back with the same seventeen-step plan, four Tantalum and four
Niobium one for one out of two ore, every check met.

## A unit's weight, and what it holds

`matter` is not read off a formula. `assignMatter` follows the phase
transitions, works out each member's weight relative to the others, and anchors
the group on the lightest member that has a countable formula. So Liquid Oxygen
weighs eight because one of it evaporates into four Oxygen Gas and a unit of
the gas is `O2`: four times two. That is right, and the formula `O2` written on
Liquid Oxygen is describing the substance rather than the unit -- Liquid
Hydrogen is the same four-to-one ratio and *is* written `H8`, which is the
inconsistency `data.js` warns about in as many words.

**The ratio was being used both ways where the game only states it one way.**
Ore smelting is written in the same two fields: `Galena evap -> Molten Lead`,
`Cassiterite evap -> Molten Tin`, with nothing coming back. Followed backwards
the ore joined the metal's group at a ratio of one, the group was anchored on
whichever member the walk reached first, and the metal inherited the ore's
formula. Lead weighed two atoms because galena is `PbS`; Tin three because
cassiterite is `SnO2`; Granite Gravel five against a formula that sums to
thirteen.

A link now needs a transition stated each way, which is the test
`phaseFamilies` already applies and for the same reason: a crossing that does
not come back is a destruction, not a state. Every affected material lands on
its own formula's count:

```
Lead            2 -> 1     Cuprite      1 -> 3      Liquid Oxygen  8 -> 8
Tin             3 -> 1     Hematite     1 -> 5      (stated both ways,
Quick Lime      5 -> 2     Sphalerite   1 -> 2       so it keeps its ratio)
Granite Gravel  5 -> 13    Ammonium Ion 4 -> 5
```

**And the tally follows the unit.** `atomsIn` now multiplies the formula's
counts by `matter / formula-sum` where that divides evenly, so a unit of Liquid
Oxygen tallies eight oxygen. One material is scaled by this and one declined:
`Hydrofluoric Acid Gas` sums to two and weighs five, a ratio of two and a half,
because its group anchors on the aqueous form whose formula counts water the
gas does not carry -- and scaling by that would invent half an atom of
fluorine. A ratio that is not a whole number of formula-units means the formula
is describing something else, and then its own count stands.

### What it cost

```
create an element   20 -> 16 of 94 answered
elements created    O 13, H 4, Cu 1, Sn 1   (Cl and S gone)
corpus              186 identical, 7 moved, 1 lost, 0 gained
```

Three plans stop creating oxygen -- Oxygen Gas, Liquid Oxygen and Sulfur Vapor
-- because the condensation they run now balances instead of appearing to
destroy six oxygen a time. Sulfur Vapor pays for it: twelve units bought where
it bought one, which is the Lithium Hydroxide trade again, a plan getting
dearer because it stopped minting. Iron comes out better, buying one where it
bought two. Calcium takes eight steps where it took two.

**`Silica` loses its plan, and the mechanism is worth knowing.** Ore pricing is
`matter ?? 1` -- what a unit actually weighs. Granite Gravel was sixth in
Silica's ore ranking and is the ore that worked; corrected to thirteen it is
dearer and falls outside the six ores tried. What displaced it is `Rhyolite`,
which has no formula of its own and no longer inherits a weight from the group
it was wrongly joined to -- so it prices as one, the cheapest thing there is,
and gets tried ahead of an ore whose weight is known.

That is the `oreTries` cap rather than the weighing: at twelve ores Silica
answers in six reactors buying two Sodium Silicate, which is better than the
twenty-six reactors and fourteen units it used to take, and the page already
offers "Try 12" on exactly this message.

## Weighing a rock by what it melts into

Sparr: use other reactions and products to estimate Rhyolite's weight, and do
the same for anything else in a similar situation -- we should already have
code for this.

**The reactions cannot do it.** `tools/derive-formulas.mjs` works exactly that
way for formulas, and a weight asks less of the same evidence -- a formula
needs every element to balance, a weight only the total -- so it was worth
trying. It settles nothing. Of the 511 materials with no weight, **400 appear
in no reaction at all**, Rhyolite among them. Of the 48 reactions that come
down to one unweighed participant, only three materials get a second reaction
to agree with, and the votes are not trustworthy: Manganese Hydroxide draws two
votes for eight against one for five, and `Mn(OH)2` is five. Plurality would
have taken the wrong answer. That pass was written, measured and removed.

**The phase relation can.** `Rhyolite evap -> Rhyolitic Lava`, and the lava is
`KAlSi3O8` -- thirteen atoms. A rock and its own melt, and the only thing
missing is a condensation written back, which the data often omits. So the
strict both-ways rule above is relaxed by exactly the test `composition.js`
already uses for carrying a formula across a phase change: the two have to be
the same substance. Galena is `PbS` and Molten Lead is `Pb`, the sulfur leaves,
so the weight must not carry; Granite is `CaAl2Si2O8` and Molten Anorthite is
the same, so it may; and where one side has no formula there is nothing to
contradict, which is the case that matters.

Both halves hold at once:

```
Rhyolite        null -> 13     from its own melt
Lead            2 -> 1         no longer anchored on galena
Tin             3 -> 1         no longer anchored on cassiterite
Quick Lime      5 -> 2         Granite Gravel 5 -> 13, Hematite 1 -> 5,
Cuprite  1 -> 3, Sphalerite 1 -> 2, Ammonium Ion 4 -> 5
Liquid Oxygen   8              unchanged
unweighed       511            unchanged -- nothing lost its weight
```

`npm test` green. Over the corpus, 188 identical, five moved, one lost. Of the
five: Iron buys one unit where it bought two, Sulfur Vapor stops creating
oxygen and pays twelve units for it, Calcium takes eight steps where it took
two, and two are cosmetic.

**Silica is the one lost, and the reason has changed.** It is no longer that an
unweighable rock prices as the cheapest thing going -- Rhyolite weighs thirteen
now and sorts accordingly. It is that Granite Gravel, the ore that works, was
in the six tried only because it weighed five, and thirteen is what
`CaAl2Si2O8` actually comes to. Correctly weighed it sorts below Dirt and falls
outside the cap.

So the weighing is right and the cap is where the question now lives: six ores
of twenty, with the ore that works honestly among the heaviest. Raising the
default from six is a product decision, not a measurement; the "Try 12" path
finds it and finds it better than before.
