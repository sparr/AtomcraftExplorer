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
1x  4 Molten Potassium + 1 Carbon Dioxide -> 2 Potassium Oxide + 1 Carbon
2x  1 Potassium Oxide + 1 Water -> 2 Potassium Hydroxide
2x  2 Molten Potassium Hydroxide -> 2 Potassium Gas + 1 Hydrogen Gas + 1 Oxygen Gas
1x  2 Hydrogen Gas + 1 Oxygen Gas -> 2 Steam
2x  1 Steam -> 1 Water
```

**The water is a closed loop and the hydrogen does not leave.** (Sparr) Two
Potassium Oxide take two Water to become four Potassium Hydroxide; electrolysing
those gives back two Hydrogen Gas and two Oxygen Gas; the hydrogen burns with
one of those two oxygen into two Steam, which condense to the two Water the
loop began with. Nothing is consumed by that circuit and nothing is left by it.

So the whole thing comes to what it ought to on the face of it:

```
1 Carbon Dioxide -> 1 Carbon + 1 Oxygen Gas
```

with four Molten Potassium turning round inside it, and the water and hydrogen
turning round inside that. Both want laying in once and never buying.

- **fetch:** nothing
- **charge:** see below -- it depends where you cut the wheel
- **leaves:** 1 Oxygen Gas per Carbon Dioxide, and nothing else

The solver currently answers this correctly. (Sparr)

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
2 Carbon Monoxide -> 1 Carbon Dioxide + 1 Carbon      (Boudouard, 500-725K)
then the carbon dioxide by the chain in case 2        -> 1 more Carbon
```

Both carbons come out. Stopping after the first step and leaving the carbon
dioxide on the floor — which is what the solver does now — is half an answer.

- **fetch:** nothing
- **charge:** the potassium loop
- **leaves:** oxygen

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
in:   1 Columbite + 4 Hydrofluoric Acid + 4 Potassium Hydroxide + 1 Water
out:  2 Tantalum + 2 Niobium + 2 Iron(II) Fluoride + 2 Potassium Fluoride
      + 5 Oxygen Gas
```

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
