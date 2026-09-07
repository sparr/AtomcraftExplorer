# What a right answer looks like

Four plans, written out as the chain they ought to be, so that a solver can be
asked *which edge did you not pick, and why* rather than only *is this score
better*. Amounts are per order of what is asked for.

Marked **(Sparr)** where it is his statement, **(derived)** where I worked it
out from the recipes, and **(?)** where I am guessing and want correcting.

The recipes quoted are verbatim from the game data.

---

## 1. Lepidolite → 2 Potassium, 2 Lithium, 2 Aluminum, 3 Silicon

`#mode=plan&t=Potassium*2~Lithium*2~Aluminum*2~Silicon*3&h=Lepidolite`

**Ideal: 3 Lepidolite and 1 carbon fetched.** (Sparr)

Three ore, one down each branch of the decomposition:

```
1 Lepidolite -> 1 Molten Potassium Oxide + 1 Molten Silica + 1 Steam + 1 Hydrofluoric Acid Gas
1 Lepidolite -> 1 Molten Lithium Oxide   + 1 Molten Silica + 1 Steam + 1 Hydrofluoric Acid Gas
1 Lepidolite -> 1 Molten Alumina         + 1 Molten Silica + 1 Steam + 1 Hydrofluoric Acid Gas
```

The two reductions, which are where the carbon goes:

```
3x  1 Molten Silica  + 2 Carbon -> 1 Molten Silicon  + 2 Carbon Monoxide     (6 C in, 6 CO out)
1x  1 Molten Alumina + 3 Carbon -> 2 Molten Aluminum + 2 Carbon Monoxide     (3 C in, 2 CO out)
```

**Nine carbon in, eight carbon monoxide out** — the one that does not come back
is the whole of the shortfall, and the reason a single fetch per three ore is
the floor. (Sparr; the arithmetic above is the derivation.)

Getting the eight back, which is the part no solver has yet chosen:

```
4x  2 Carbon Monoxide -> 1 Carbon Dioxide + 1 Carbon              (8 CO -> 4 CO2 + 4 C)
4x  4 Molten Potassium + 1 Carbon Dioxide -> 2 Potassium Oxide + 1 Carbon
                                                                  (4 CO2 -> 4 C, 8 K2O back)
```

Eight carbon recovered, one bought. The potassium in that second reaction is a
catalyst: sixteen Molten Potassium go in and eight Potassium Oxide come out,
which is sixteen Potassium Hydroxide and sixteen Potassium again. It wants
laying in once and never buying.

The two metals that are simply in the ore:

```
1 Potassium Oxide + 1 Water -> 2 Potassium Hydroxide
2 Molten Potassium Hydroxide -> 2 Potassium Gas + 1 Hydrogen Gas + 1 Oxygen Gas
1 Lithium Oxide + 2 Hydrochloric Acid -> 2 Lithium Chloride + 1 Water
(electrolysis of molten lithium chloride)   -> 2 Lithium
```

- **fetch:** 1 Carbon, or one thing that is carbon (a spore, a chicken)
- **charge:** the potassium loop, 16 Molten Potassium or 8 Potassium Oxide
- **leaves:** 3 Steam, 3 Hydrofluoric Acid Gas, the oxygen and hydrogen off the
  electrolysis, and the chlorine cycle's own leavings (or any other combination of
  these atoms, such as more H2O and less H2 and O2)

---

## 2. Carbon Dioxide → Carbon

`#mode=plan&t=Carbon&h=Carbon+Dioxide`

**Ideal: nothing fetched, and nothing leaves but the oxygen.** (Sparr)

Per Carbon Dioxide:

```
2x  1 Carbon Dioxide + 1 Hydrogen Gas -> 1 Carbon Monoxide + 1 Water
1x  2 Carbon Monoxide -> 1 Carbon Dioxide + 1 Carbon    (Boudouard, 500-725K)
1x  2 Water -> 1 Oxygen Gas + 1 Hydrogen Gas x2
1x  1 Hydrogen Gas x2 -> 2 Hydrogen Gas
```

**The hydrogen and the water are a closed loop.** Two dioxide are reduced to
monoxide, which the Boudouard turns into one carbon and one dioxide back, so
one dioxide is spent for one carbon. The two water that reduction made are
split for the two hydrogen it wanted, and the oxygen they were holding is the
oxygen the carbon dioxide came in with.

So the whole thing comes to what it ought to on the face of it:

```
1 Carbon Dioxide -> 1 Carbon + 1 Oxygen Gas
```

- **fetch:** nothing
- **charge:** one hydrogen, to start the wheel; it comes back every turn
- **leaves:** 1 Oxygen Gas per Carbon Dioxide, and nothing else

### The potassium route, which used to be the ideal here

This case originally named a different circuit, and it is kept because it may
matter again:

```
1x  4 Molten Potassium + 1 Carbon Dioxide -> 2 Potassium Oxide + 1 Carbon
2x  1 Potassium Oxide + 1 Water -> 2 Potassium Hydroxide
2x  2 Molten Potassium Hydroxide -> 2 Potassium Gas + 1 Hydrogen Gas + 1 Oxygen Gas
1x  2 Hydrogen Gas + 1 Oxygen Gas -> 2 Steam
2x  1 Steam -> 1 Water
```

It reaches the same `1 Carbon Dioxide -> 1 Carbon + 1 Oxygen Gas`, with four
Molten Potassium turning round inside it and the water and hydrogen turning
round inside that. Both want laying in once and never buying. (Sparr)

Five steps against four, and a charge of four potassium against one hydrogen,
so the hydrogen route is the better answer as things stand and the solver
finds it. What ought to bring the potassium back is a plan that wants the
potassium circuit anyway -- cases 1, 4 and 5 all turn it for their own reasons
-- because then its steps are already paid for and closing the carbon on it
should cost one reaction rather than four.

**That has been tested and it does not happen, for a reason worth writing
down.** In case 1 the potassium circuit *is* already turning, for the
potassium target, and the solver still closes its carbon on hydrogen. Barring
the hydrogen route sends it to magnesium; barring both makes it decompose
twice the ore rather than touch potassium; handing it free Molten Potassium
changes nothing. None of that is the simplex judging the route and finding it
wanting -- **`rx:Molten Potassium + Carbon Dioxide` is cut by the shortlist**,
which keeps only what one solve happened to use, so nothing downstream ever
sees it. Carbon dioxide has thirteen consumers and exactly one survives.

Offering all of them costs more than it is worth: the shortlist goes from
twenty-two processes to a hundred and fifty, and the cases go from 88ms to
17.8s and 174ms to 22.5s, two hundred times slower. And when the route finally
is on the table, the simplex looks at it and drops it anyway -- lepidolite
comes out at twenty-one steps rather than twenty-two, same shopping list. One
step, for two orders of magnitude.

So the shortlist's narrowness is real and known, and the potassium route is
not obviously the better answer even where its steps are free. What would make
it worth revisiting is a cheaper way to widen the shortlist than offering
every consumer of everything the plan recycles.

The solver answers this correctly, by the hydrogen route.

### Where to cut the wheel

A charge is whatever has to be in hand before the first step runs, so it
depends which step is first, and the two answers are **not** the same thing.
(Sparr was right to doubt it; the first draft of this file asserted they were.)

| charge | units | atoms |
|---|---|---|
| 2 Potassium Oxide + 2 Steam | 4 | K4 H4 O4 |
| 4 Molten Potassium + 2 Water | 6 | K4 H4 O2 |

The solver lays in the first. Its order begins `1 Steam -> 1 Water` and then
`1 Potassium Oxide + 1 Water -> 2 Potassium Hydroxide`, so steam and oxide are
what it is short of at the moment it starts; the molten potassium and the water
are both made inside the batch before anything asks for them.

The second is what you need if the reduction goes first instead. It is two
units more to carry and one Oxygen Gas less to find, that oxygen being the one
the Potassium Oxide is already holding.

Both start the same wheel and neither is wrong. Fewer things to lay hands on
says the first; less matter tied up says the second. **(?)** -- and I do not
know which the reader would rather be told to go and get.

---

## 3. Carbon Monoxide → Carbon

`#mode=plan&t=Carbon&h=Carbon+Monoxide`

**Ideal: two carbon out of two carbon monoxide, nothing fetched.** (derived)

```
2x  2 Carbon Monoxide -> 1 Carbon Dioxide + 1 Carbon    (Boudouard, 500-725K)
2x  1 Carbon Dioxide + 1 Hydrogen Gas -> 1 Carbon Monoxide + 1 Water
1x  2 Water -> 1 Oxygen Gas + 1 Hydrogen Gas x2
1x  1 Hydrogen Gas x2 -> 2 Hydrogen Gas
```

Four monoxide into the Boudouard give two carbon and two dioxide; reducing
those dioxide hands two monoxide back, so two monoxide are spent for two
carbon. **One carbon monoxide per carbon, which is the whole of it** -- both
carbons come out. Stopping after the Boudouard and leaving the dioxide on the
floor is half an answer.

- **fetch:** nothing
- **charge:** one hydrogen, as in case 2
- **leaves:** oxygen

The potassium route in case 2 works here too and costs a step more; the note
there applies.

---

## 4. Columbite → Tantalum and Niobium

`#mode=plan&t=Tantalum~Niobium&h=Columbite`

**Ideal: 2 Tantalum and 2 Niobium per Columbite** (Sparr)

```
1 Columbite + 6 Hydrofluoric Acid
      -> 1 Heptafluorotantalic Acid + 1 Heptafluoroniobic Acid
       + 2 Iron(II) Fluoride + 3 Water

1 Heptafluorotantalic Acid + 2 Aqueous Potassium Hydroxide
      -> 1 Aqueous Potassium Heptafluorotantalate(V) + 2 Water
1 Aqueous Potassium Heptafluorotantalate(V) + 2 Water
      -> 1 Tantalum Pentoxide + 1 Potassium Fluoride + 1 Hydrofluoric Acid

1 Tantalum Pentoxide + 5 Carbon -> 2 Molten Tantalum + 5 Carbon Monoxide
```

and the same four steps again for niobium.

### Buying the fluorine and the potassium

The simpler case, and the one to agree on first: the fluorine and the potassium
are bought, and where they might have come from instead is a later question.
(Sparr)

**Carbon is closed.** Ten in to the two reductions, ten Carbon Monoxide out,
and the chain from case 1 returns all ten: five runs of the Boudouard give five
Carbon Dioxide and five Carbon, and five runs of the potassium reduction turn
those five Carbon Dioxide into five more Carbon. Nothing bought, nothing left
over. (derived)

**Fluorine is not closed, and cannot be.** Six Hydrofluoric Acid go into the
dissolution and two come back off the pentoxide steps, so four are short every
batch. They cannot be recovered from the leavings either: `Potassium Fluoride`
and `Iron(II) Fluoride` have **no consumers at all** — not one process in the
game takes either of them back. Every batch sends two of each away for good.

**The potassium here is two different potassiums**, which this file previously
ran together and got wrong:

- the four Aqueous Potassium Hydroxide feeding the heptafluoro steps are
  **spent**. Their potassium leaves in the Potassium Fluoride. This is a
  standing supply, not a charge.
- the twenty Molten Potassium turning the carbon recycling are **catalytic**,
  come back as ten Potassium Oxide every pass, and want laying in once.

So, per Columbite, and this is the whole of it: (Sparr)

```
in:   1 Columbite + 4 fluorine + 4 potassium + 1 Water
out:  2 Tantalum + 2 Niobium + 2 Iron(II) Fluoride + 2 Potassium Fluoride
      + 5 Oxygen Gas
```

**Four fluorine and four potassium, not four of any particular compound.**
(Sparr) The first draft of this said four Hydrofluoric Acid and four Potassium
Hydroxide, which is one way to carry them and reads as though it were the only
way. It is not, and a plan that finds a denser carrier is not cheating:

- four Hydrofluoric Acid, one fluorine each, is the plain answer
- two Magnesium Fluoride carry the same four
- one Silicon Tetrafluoride carries four on its own -- but every route to one
  takes four Hydrofluoric Acid, so it is those four and a step, and no saving

and the same for the potassium: four Potassium Hydroxide, or two Potassium
Oxide, or Potash, so long as four potassium arrive. What is *not* allowed is a
carrier that costs more than what it is made of -- Aqueous Potash is Water and
Potash in one bottle, and buying the bottle should lose to buying the two.

Counting the shopping list in units rather than in fluorine and potassium is
what made a plan buying one Silicon Tetrafluoride look four times better than
one buying four Hydrofluoric Acid, when they are the same purchase.

**In atoms this order costs 35, not 23.** Worth writing down because it is easy
to get wrong by hand, and I did: `Hydrofluoric Acid` in this game is `HF+H2O`,
the aqueous acid, so a unit of it is five atoms and not the two the bare
molecule would be. Four of them are twenty, four Potassium Hydroxide are
twelve, the Water is three. A plan measured against 23 looks nine over when it
is under, which is what the scorecard was reporting until the yardstick was
fixed. Twenty-six of the fifty-three aqueous materials carry their water this
way.

- **charge:** 20 Molten Potassium and 10 Water, for the carbon loop and the
  water circuit inside it. Neither appears above because both come back.

Checked against the recipes rather than worked out by hand -- summing every
step of the closed plan leaves exactly those nine lines and nothing else, no
Carbon among them.

### Where the water goes, which took two tries to agree on

The four Potassium Hydroxide arrive dry and are dissolved here, and dissolving
them costs four Water, because `Aqueous Potassium Hydroxide` *is* one Potassium
Hydroxide and one Water. The columbite chain hands back three Water of its own
-- three from the dissolution, four more from the two heptafluoro steps, four
spent by the two hydrolyses -- so the four needed and the three returned come
to **one Water bought and none left over**.

Buying the potassium hydroxide ready-dissolved instead is the same reactor
written differently: that water arrives inside the reagent, nothing is bought,
and three Water leave at the far end. Dry is the better way to say it, because
a plan with nothing left over is easier to check than one with three of
something on the floor.

The five Oxygen Gas are what the carbon loop cannot use: the electrolysis frees
ten and the hydrogen burning takes five back.

**Later, and not yet:** Lepidolite decomposition throws off exactly what this
buys — one Hydrofluoric Acid Gas per ore, and a Molten Potassium Oxide on one
branch in three. Roughly four ore per Columbite would cover the fluorine and
six the potassium as well. Whether the ideal plan should assume that line is
running next door, and whether `t=Tantalum~Niobium&h=Columbite` could even say
so, is the question we come back to. (Sparr: later)

---

## 5. The combined factory: Lepidolite and Columbite together

No single URL says this yet. It is what the two ores come to when they are run
beside each other, and it is here because it is the answer the other four are
approximations of. (Sparr)

Six Lepidolite per Columbite, and the ratio is set by potassium alone: three
ore give one Molten Potassium Oxide, which is two Potassium Hydroxide, and the
columbite chain eats four. Fluorine is not what binds it -- six ore throw off
six Hydrofluoric Acid Gas where four are wanted.

Everything is reduced, and the carbon goes round:

```
in:   6 Lepidolite + 1 Columbite + 2 Carbon

out:  4 Lithium + 4 Aluminum + 6 Silicon + 2 Tantalum + 2 Niobium
      2 Iron(II) Fluoride + 2 Potassium Fluoride
      2 Hydrofluoric Acid Gas + 3 Water + 14 Oxygen Gas
```

Checked by summing every step against the recipes, not worked out by hand.

**Two carbon, and only two.** Twenty-eight go into the four reductions -- twelve
for six silica, six for two alumina, ten for the two pentoxides -- and twenty-
six come back as Carbon Monoxide. The Boudouard and the potassium reduction
between them return all twenty-six. The shortfall is the same one carbon per
three Lepidolite as case 1, twice over; the columbite side is closed.

**No hydrogen is bought**, though it looks as though it should be. The lithium
chain wants two Hydrogen Gas for its hydrochloric acid, and the potassium
electrolysis is already making twenty-six. Burning twelve pairs of them back
into steam instead of thirteen leaves exactly the two the chlorine needs, and
the water still comes out ahead.

**No potassium comes out.** All of it goes into the hydroxide the columbite
chain spends, and leaves in the Potassium Fluoride. Wanting potassium metal as
well means more ore than six.

The chlorine is catalytic -- two Chlorine Gas out of the lithium chloride
electrolysis are the two the hydrochloric acid wants back -- and so is the
potassium in the carbon loop.

---

## 6. Iron(II) Tungstate → Tungsten and Iron

`#mode=plan&t=Tungsten~Iron&h=Iron(II)+Tungstate`

**Ideal: 1 Tungsten and 1 Iron per Iron(II) Tungstate** (derived -- wants review)

Mined from Wolframite, which drops this and the manganese tungstate both, and
from Ferberite, which drops only this. FeWO4 holds one of each metal, so the
ore count is the order count and there is nothing to argue about there.

The tungsten comes off in four steps:

```
1 Iron(II) Tungstate + 1 Sodium Carbonate
      -> 1 Sodium Tungstate + 1 Iron Oxide + 1 Carbon Dioxide
1 Sodium Tungstate + 1 Aqueous Ammonium Chloride + 1 Hydrochloric Acid
      -> 1 Ammonium Paratungstate + 2 Seawater
1 Ammonium Paratungstate -> 1 Tungsten Trioxide + 1 Ammonia Gas + 1 Steam
1 Tungsten Trioxide + 3 Hydrogen Gas -> 1 Tungsten + 3 Water
```

and the iron off the oxide the first step leaves, in three:

```
1 Iron Oxide + 1 Sulfuric Acid -> 1 Iron(II) Sulfate + 1 Water
1 Iron(II) Sulfate + 1 Water   -> 1 Aqueous Iron(II) Sulfate
1 Aqueous Iron(II) Sulfate + 1 Zinc -> 1 Aqueous Zinc Sulfate + 1 Iron
```

**Nothing is bought.** Four reagents go round and come back:

- **sodium**: carbonate into the roast, out as tungstate, out again as the two
  seawater the APT step makes, electrolysed to lye, and carbonic acid puts the
  carbonate back together.
- **ammonium and chloride**: chlorine and hydrogen make the acid, the acid and
  the ammonia off the roasting make the chloride, the chloride goes into the
  APT step and the seawater brings the chlorine back.
- **zinc**: spent cementing the iron out, recovered as sulfate, decomposed to
  the oxide, reduced by carbon monoxide. The sulfur comes back with it --
  trioxide and steam remake the sulfuric acid.
- **hydrogen and carbon**: water electrolysed for the reduction, and the
  carbon dioxide from the roast electrolysed to monoxide for the zinc.

**Why iron takes the wet route and manganese does not.** There is no reduction
of Iron Oxide in the game. It is consumed by two reactions and both are acid
dissolutions, where `Manganese(II) Oxide Reduction` exists and does the job in
one step -- and the game has `Iron Reduction` for *ferric* oxide, and two more
for the manganese oxides, so FeO looks like the gap rather than the rule. If
one is ever added this plan should collapse onto case 7's shape.

- **fetch:** nothing
- **charge:** the reagents above, laid in once, since all of them return
- **leaves:** the ore's oxygen, 2 Oxygen Gas per ore

**The steam is not ours.** Each order also sheds a Steam, and that one is
minted: ammonium paratungstate has no formula and its two reactions imply
different ones, a water apart (see FORMULA-ODDITIES.md). Eight oxygen go in
per two ore and ten come out. Sparr: the game breaks conservation on purpose
in places and a plan is not wrong for using it, so this is recorded and
allowed rather than scored against.

---

## 7. Manganese(II) Tungstate → Tungsten and Manganese

`#mode=plan&t=Tungsten~Manganese&h=Manganese(II)+Tungstate`

**Ideal: 1 Tungsten and 1 Manganese per Manganese(II) Tungstate** (derived --
wants review)

Mined from Wolframite alongside the iron one, and from Hubnerite alone. The
same four tungsten steps as case 6, and three of its four reagent loops --
sodium, ammonium and chloride, hydrogen and carbon. The zinc and its sulfur
are case 6's alone, wanted only because the iron has to come out wet. Only the
deoxidation differs here, and it is two steps against seven:

```
1 Manganese(II) Oxide + 1 Carbon -> 1 Manganese + 1 Carbon Monoxide
2 Carbon Monoxide -> 1 Carbon Dioxide + 1 Carbon
```

The Boudouard hands the carbon back, so the carbon is closed too and there is
still nothing to buy.

- **fetch:** nothing
- **leaves:** the ore's oxygen, 2 Oxygen Gas per ore, and the same minted
  Steam as case 6

**These two are worth keeping as a pair.** They stand on the same thirteen
steps, and it should be the same thirteen in both -- not the same number of
firings, which is nobody's cost. Anything that appears in one and not the
other is either the deoxidation or a bug. It was running them together that
turned up the paratungstate disagreement, both plans leaving the same
impossible steam.

---

## A toggle we are going to want

Case 4 buys Hydrofluoric Acid and Potassium Hydroxide. Case 5 buys none of
that and buys six Lepidolite instead. Both are right, and which one is right
depends on a question the planner cannot answer for itself: **is a reader
willing to go and dig up another kind of ore, or do they want a shopping list
of things that could only have been made?** (Sparr)

So there wants to be a switch: whether additional *raw* inputs are welcome on
the frontier, or whether only *produced* elements and compounds are acceptable
fetches. With raw welcome, the Columbite plan reaches for Lepidolite and buys
almost nothing else. With raw refused, it buys the acid and the hydroxide and
never mentions an ore it was not given.

Neither is the better plan in general. They are answers to different questions,
and at the moment the planner only knows how to be asked one of them.

---

## What a step costs

A step is a reactor you have to build, and once it is built it runs as many
times as you like. So **how often a step fires does not matter** -- only how
many distinct ones there are. A plan that runs one reaction ninety times is
cheaper to stand up than one that runs three reactions twice each. (Sparr)

Phase changes are not reactors. Cooling happens in the open air -- molten
tantalum wants to be under 3289 K and the world obliges -- and the heating
happens inside whichever reactor wants the hot form, so melting something on
the way in needs no vessel of its own. Filters *are* reactors: no heat and no
current, but materials still have to be carried to a place and different ones
carried out. (Sparr)

So the counts to compare are reactors, not steps:

| case | reactors | steps |
|---|---|---|
| co2-to-carbon | 4 | 4 |
| co-to-carbon | 4 | 4 |
| lepidolite | 14 | 22 |
| columbite | 13 | 16 |
| combined | 21 | 31 |
| Iron(II) Tungstate | 20 | 21 |
| Manganese(II) Tungstate | 15 | 16 |

Where the step counts in the cases above differ from these, they are counting
reactions, which is the same thing wherever no phase change is involved.

Columbite was 17 reactors in 21 steps when this table was first written. It
came down to 13 in 16 by teaching the free-lunch pass which member of a wheel
to bar -- see *Wheels and who to blame* below.

---

## Wheels and who to blame

Some of the game's reactions make atoms out of nothing, on purpose, and a few
of them join up into a loop that can be turned for free. A planner has to spot
those and shut one member, or it will happily run the loop a thousand times and
report a factory that mines the air.

Which member is the question. Barring any of them stops the wheel, so the
obvious rule -- whichever ran most in the witness the simplex hands back --
always appears to work. It is still wrong: the size of a coefficient in a ray
says nothing about culpability, only about how the recipes happen to be
written. On Columbite it barred `Electrolysis of Carbon Dioxide`, a reaction
that balances exactly and the only route back from carbon dioxide to carbon.
With it gone the plan bought carbon at the door and vented the same carbon out
of the back, which is what Sparr saw: eight Carbon fetched, eight Carbon
Dioxide left over.

The rule that holds is **the busiest member that actually gains matter**. Both
halves matter. Drop the gain test and an innocent step takes the blame; drop
the runs and pick whichever gains most instead, and Columbite loses thirteen
reactors to a worse route. Where no member gains anything -- the packing chains,
where a unit is a container rather than an amount -- there is no culprit and
the old rule is as good as any.

The second half of the same bug: a repair pass that closes a loop rather than
buying into it has to close it **by element**. Told it could not buy Carbon,
the solver bought Carbon Monoxide and vented the carbon just the same. The
complaint was never about a material.

---

## What to check a solver against

1. Does it pick the **Boudouard equilibrium at 500-725K** rather than venting
   the carbon monoxide?
2. Does it pick **`rx:Molten Potassium + Carbon Dioxide`** to close the rest of
   the carbon, or does it buy carbon instead?
3. Does it treat the potassium as a **charge** rather than building it out of
   fresh ore every batch, and does it close the **water and hydrogen** circuit
   with `rx:Hydrogen Combustion` and `cond:Steam` rather than venting hydrogen?
4. Does it come out at **3 Lepidolite and 1 carbon** per order, rather than
   spending more ore to avoid the shopping list?
5. Do the two tungstates come out as **one Tungsten and one metal per ore,
   buying nothing**, and do they agree with each other -- the same thirteen
   steps, differing only in how the leftover oxide is reduced? They are a pair
   on purpose: what appears in one and not the other is either the deoxidation
   or a bug.
6. Does it leave the ore's oxygen alone rather than contriving to dispose of
   it? Leavings from a plan that buys nothing are free product, and the only
   reason two plans off the same ore differ in what they leave is that
   something between them is not conserving.
