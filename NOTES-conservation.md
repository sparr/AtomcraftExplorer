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

## Still open: the 4:1 families

Sparr: the 4:1 ratio can share a row if the coefficients are scaled by four
going in and quartered coming back out. Quite right, and the reason given
earlier for leaving Oxygen Gas and Liquid Oxygen apart -- that the arithmetic
forbids it -- was wrong. A family needs the round trip to compose to identity,
not to be one for one; the row can be denominated in one member's units with a
scale per member, and `stands()` would return a factor alongside a name. The
crossings stay droppable, `assemble` divides back at hydration, and the
packing chains come in with it.

What it would want watching: `perAtom` weighs a row's leftovers by `matter`,
which already accounts for packing, so the two would have to agree; and the
supply columns are per member, so a scaled row means a scaled supply
coefficient too. Not attempted.
