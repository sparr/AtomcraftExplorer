# Collapsing the phases into one material

A plan's model carried every state of a substance as its own material, with its
own row, and carried the melting and freezing between them as their own
columns. Aluminum, Aluminum Vapor and Molten Aluminum were three rows and the
steps between them were columns whose whole effect was to move quantity from
one of those rows to another.

Making them one material is worth about a fifth of the rows and a quarter of
the columns, and the columns it removes are the worst ones in the model. It is
built. What follows is what was built, what it measured, and the two families
it does not apply to yet.

## What it does

Two materials are the same substance when a phase step goes from one to the
other **and another comes back**, both one for one. The return trip is the
whole of the test: melting a Gun gives Molten Iron and no amount of cooling
gives the Gun back, so that is a destruction and stays a column. With the
return trip required there are 116 families covering 272 materials, the largest
of them three.

Each family keeps one name -- the shortest, never a Static member, never a
Molten/Frozen/Dry/Liquid/Solid form where there is an alternative, ties broken
by how often the recipes say it. `model()` keys every row on that name, so the
family has one row and one balance. It keeps a **supply column per member**,
because what is fetchable, what it costs and what the reader is holding are all
facts about the particular state -- nobody mines molten aluminium -- so the
shopping list still names something you could go and get.

The recipes are left alone. A step still says it consumes Molten Silica; only
the row that coefficient lands in changes. That is what keeps the phase
readable at the end, and it is why this is a change to the model rather than to
the chemistry.

A step whose coefficients then net to nothing is dropped outright. Asked of the
coefficients rather than of the family, because a crossing that hands back more
than it was given is not a no-op however same-substance its ends look --
petroleum cracking is exactly that.

Three things had to move with it:

- **Welds do not cross a family.** A weld says everything made of this is spent
  by that one step, which is false of a member whose row is the whole
  substance: the eater may be fed by a sibling state instead. Welding it would
  forbid exactly the freedom the collapse grants.
- **The shortlist walks the uncollapsed model.** That walk breaks its ties on
  how many times the columns run, and once the crossings are gone they run for
  nothing. Asked for Carbon from Carbon Dioxide, the potassium route counts
  four runs against the hydrogen route's five and wins -- and the hydrogen
  route, four reactions against five, is then not merely beaten but absent.
  The collapse cannot be allowed to decide which routes are on the table; what
  it is for is the arithmetic afterwards.
- **`assemble` puts the crossing back.** Net each member of a family against
  what the steps make, use and were asked for; where one is short while another
  is over, cross between them, and where the family cannot cover it, draw it at
  the door as whichever state the plan is allowed to go out for -- held first,
  then cheapest. `phaseFamilies` carries a `route(from, to)` for this, which
  stays inside the family on purpose: `evap:Sand` is a one-for-one crossing too
  and it does not come back, so following it would have a plan freezing molten
  silica into sand.

## What it measured

Model size, over the candidate set each question actually builds:

```
model            rows  ->  after     cols  ->  after   (columns dropped)
columbite         376 ->   299        866 ->   667     (189)
lepidolite-4      400 ->   321        948 ->   729     (207)
aluminum          370 ->   301        633 ->   443     (190)
combined          403 ->   321        961 ->   730     (215)
```

Rows fall about 20%, columns about 23%. The columns it removes are worth more
than their number: a crossing inside a collapsed family contributes nothing to
any row, so it is a null direction the simplex was free to walk any distance
along -- the exactly-opposite column pairs behind the degenerate walks and the
vertex-dependent step counts.

Plans, over `tools/phase-corpus.mjs` -- the canonical cases plus every eighth
material the game can make, 194 plans:

```
193 identical, 1 moved, 0 lost a plan, 0 gained one
194.1s -> 164.2s
```

Fifteen per cent off the wall clock and one plan changed: Frozen Aqueous
Ammonium Iodide now freezes the iodine and filters that, rather than filtering
first. Same real step count. `npm test` is green, 78 met and nothing broken,
including the batch ceilings and the charge invariants.

## What is not done

**Two families are held back by default**, and the reason is written beside
`HELD_BACK` in `plan-fresh.js`. Both pass every test for being one substance.
Merged, a family's row stops saying how many of each state there are, which
leaves the simplex a wider face to pick its corner from -- and a wider face has
more corners with halves on them. The run counts come back as fractions and the
plan multiplies up by their common denominator.

They are held back by the planner and offered by the scoreboard: `mergeableStates`
lists them, the sweep asks the question once more per family, and the menu puts
the two answers side by side. `spec.mergeStates` carries the choice and rides in
the URL as `ms`. Nobody has to decide this once and for all, which is the right
shape for a trade that has a winner on each side.

- **Water and Steam.** Merged: the Lepidolite order comes out in batches of
  four rather than two, the Aluminum one in eights rather than fours, and
  Lithium Hydroxide buys five units where it bought two. Against that, three
  plans lose a step -- Selenium and Hypochlorous Acid stop running a lithium
  sulfide wheel to make their steam and simply boil water, dropping eleven
  charges between them.
- **Hydrofluoric Acid and its gas.** Merged: Aluminum out of Lepidolite finds a
  route through the glass one reaction shorter than the sulfate route, and
  offers it in batches of eight rather than four.

Neither is obviously the wrong trade and both break a stated invariant -- the
batch ceilings in `test-fresh.mjs`, and "at least one charge is holding the
plan up", which stops being true of the aluminium plan because the shorter
route has no closed wheel to seed. So the planner keeps its invariants and the
reader gets the choice.

The Lepidolite pair is worth reading in full, because it is what the scoreboard
work below was built to show. Step for step the two plans are identical but for
two lines: merged, the plan runs `cond:Steam` 1.5 times per unit and 0.75 more
`rx:Electrolysis of Water`. What that buys is the charge. The unmerged plan
vents its steam and needs two Hydrogen Gas laid in before it will turn -- a
charge marked `holdsUp`, which the plant never pays back, because nothing
outside the wheel it seeds will ever fill it. The merged plan condenses that
steam, closes its own hydrogen loop, and needs nothing but the chlorine. Ore,
purchases, reactors and total waste per unit are identical, and have to be:
same inputs and same products means the same matter left over.

```
per unit of each product        unmerged   merged
reactors                              14       14
ore fed                            1.500    1.500
bought                       0.5 Carbon    0.5 Carbon
left over                6.000u/17.500a   6.000u/17.500a
to lay in            Chlorine + 2 Hydrogen   Chlorine
steps run                             18    18.75
batch                                  2        4
```

## What the scoreboard learned from it

Three things, all of which that pair exposed.

**`steps` counts running, not building.** It was `plan.steps.length`, hinted as
"reactors plus the phase changes, which are free", which counted neither: a
vessel turned forty times was one step, and a condenser that costs nothing to
own was one as well. That decided exactly this comparison -- the merged plan
scored a step worse for owning a condenser, so `digest` found it dominated and
dropped the plan that needs no charge. Sparr: one reactor run four times is
four steps. So it counts runs, per unit, with the phase changes left out, and
`reactors` goes on counting vessels. The two now answer different questions,
and on this pair they disagree: the merged plan does more running, 18.75 runs a
unit against 18, because closing the hydrogen loop means electrolysing three
quarters more water.

**A charge is a column.** Matter that has to be in the pipes before the first
batch is a different kind of cost from a thing bought each batch, and nothing
was measuring it. Absolute rather than per unit, which was measured and not
assumed: the Lepidolite plan asks for one Chlorine Gas and two Hydrogen Gas
whether it is making two of each product or six.

**So is the batch.** Everything else is divided by it so the rows mean the same
thing; the number itself is a real difference between two answers and no column
could say it. Without it the merged row simply beats the unmerged one and the
smaller batch is never offered -- which is to say the axis would surface
nothing.

With those three, the pair comes out as a fork rather than a winner: one row
best on the charge, the other best on the steps and the batch, neither beating
the other. A merge
that changes nothing -- Hydrofluoric Acid, on this question -- scores
identically to the plain row and is dropped rather than offered as a choice
between a thing and itself.

**The batch is the open question underneath both.** Nothing the reader is
promised turns on which corner of the optimal face the simplex lands on -- the
shopping list is pinned, so is what goes in at the door, and the steps are
settled -- but the size of the batch does. Two things were tried and neither
helped: a final pass minimising total runs with the fetch and draw totals
pinned (which let the mix change underneath at the same price, and had the
Glass plan buying Molten Silicon to save a run), and the same pass with every
supply column pinned individually (which is tight enough to be safe and found
nothing smaller). The remaining idea is to re-solve the settled answer on the
uncollapsed model, restricted to the steps it chose plus the crossings between
them -- a model of twenty or thirty columns, where the finer rows are back and
the arithmetic is trivial. Whether its vertices are any less fractional is not
known; it is more constrained, not less.
