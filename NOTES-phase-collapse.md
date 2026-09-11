# Collapsing the phases into one material

A plan's model carries every state of a substance as its own material, with its
own row, and carries the melting and freezing between them as their own columns.
Aluminum, Aluminum Vapor and Molten Aluminum are three rows and the steps
between them are columns whose whole effect is to move quantity from one of
those rows to another.

Making them one material is worth about a quarter of the rows and a third of
the columns, and the columns it removes are the worst ones in the model.

## What it is worth

Measured on five models, families built as described below:

```
model            rows  ->  after     cols  ->  after   (phase cols dropped)
glass             365 ->   279        536 ->   364      (172)
columbite         359 ->   271        508 ->   356      (152)
lepidolite-4      382 ->   289        632 ->   423      (209)
aluminum          377 ->   285        578 ->   384      (194)
combined          385 ->   288        590 ->   390      (200)
```

Rows fall about 24% and columns about 33%. Simplex work per pivot goes as rows
times columns, so that is roughly half the arithmetic before counting the
pivots saved.

The columns it removes are worth more than their number. A phase step inside a
collapsed family contributes nothing to any row -- it is a literal no-op, a
null direction in the model. Those are the exactly-opposite column pairs found
earlier in the solver work: 724 of them in one model, and they are the standing
explanation for the degenerate walks, the batch-size lottery and the
vertex-dependent step counts. Collapsing deletes that class outright rather
than working around it.

## The families

Two materials are the same substance when a phase step goes from one to the
other **and another comes back**. The return trip is the whole of the test.

Without it, melting welds everything that shares a destination: 116 materials
in one family because every oscillator, wire and electrode has an
`evap:` to Molten Copper, and a second of 36 because Bread, Cake, Chicken and
the spores all char to Carbon. Melting a Gun gives Molten Iron and no amount of
cooling gives the Gun back. It is a destruction, not a state change.

With it: **116 families covering 272 materials, the largest of them three**.
Aluminum with its vapour and its melt. Chlorine with its liquid and its solid.
Ammonia, Ammonia Gas, Ammonia Crystals.

### Which member stands for the family

Sparr's rule: **the shortest name**. That lands on the unprefixed solid where
there is one, and on the gas where the solid form is the prefixed name, which
is what a reader would call the stuff. It is right for 106 of the 116.

Two amendments, each for a case the plain rule gets wrong:

- **Never a Static member.** Ice is shorter than Water and Steam and is a
  placed pixel; a plan cannot carry it. `Ice, Steam, Water` is the only family
  with a Static member.
- **Prefer a member that is not a Molten, Frozen, Dry, Liquid or Solid form.**
  Otherwise Dry Ice represents Carbon Dioxide, which appears in a third of all
  plans.

Ties on length are broken by how often the recipes name the material, which is
`materialMentions` in `plan-graph.js`. Water and Steam are both five letters
and alphabetical order picked Steam; the recipes say Water 213 times against
Steam's 115, and Water is plainly the name to keep. Phase steps are excluded
from that count because they mention both ends of every family alike and so
recreate the tie they are meant to break.

Seven families are represented by a name that is simply a different word for
the same substance -- Granite Gravel over Molten Anorthite, Andesite over
Andesitic Lava, Hydroiodic Acid over Hydrogen Iodide Gas. Cosmetically odd,
harmless: the name is only an identity as far as the model is concerned.

**Glass represents Molten Silica.** Sparr's call, with the note that we may
want to unbundle those later. It is the one collapse that touches a material
people ask for by name.

## What is already written

Both in place, both additive, neither used by the solver yet. The tree behaves
exactly as it did before them.

- `phaseFamilies(graph)` in `src/plan-fresh.js` -- cached per graph, returns
  `{ repOf, family, stands }`. `stands(name)` gives the representative, or the
  name itself when it is in no family.
- `materialMentions(graph)` in `src/plan-graph.js` -- cached per graph, a Map
  of material name to how many non-phase processes name it.

## The surgery

### 1. Key the model's rows on the representative

In `model()` in `src/plan-fresh.js`, every place a material name becomes a row
key goes through `stands()`. The supply columns, the `eaten` set and the net
map all key the same way, so a family has one row, one supply column and one
balance.

Leave the processes' recipes alone. A process still says it consumes Molten
Silica; only the row that coefficient lands in changes. That is what keeps the
phase information available to the assembly step, and it is why this is a
change to the model rather than to the chemistry.

### 2. Drop the columns that become no-ops

A process whose every input and output is in one family contributes nothing to
any row once the rows are collapsed. Those are the 152 to 209 columns per model
above. Drop them from `procs` before building the model, in `walkSubgraph` or
just inside `model()`.

Careful: this is the same shape as the welding condition, and the welding
condition was got wrong three times. It is a property of the family map, not of
the candidate set, so compute it from `stands()` and nothing else.

### 3. Put the phase back at assembly

This is the part that has not been designed and is the real work.

Once the rows are collapsed, a plan can satisfy a request for Glass with Molten
Silica, or feed Aluminum to a reaction that asks for Molten Aluminum. The
recipe still names the phase it wants, so `assemble()` can compare what a step
asks for against what the plan is handing it and insert the melt or the
condense where they differ -- which is what the reader should see, and what the
operating window needs in order to be right.

The planner already folds phase changes into the reactor that follows them and
does not count them as steps, so the machinery to *present* this exists. What
is new is deriving which phase change is needed rather than reading it off a
column the solver chose.

## Traps, each of which has already been walked into once

- **Count over the graph, never over the candidate set.** The candidate walk
  keeps a few ways of making each material and prunes the rest, so anything it
  pruned to one maker looks structural when it is not. This produced welds on
  Bread, Cake and Silica, and turned a two-step Glass plan into twenty-three.
- **Sand is not in a family.** `evap:Sand` gives Molten Silica and molten
  silica condenses to Glass, not to sand, so the melt is one-way and stays a
  real column and a real step. The sand-into-a-hot-reactor example that
  motivated this work is not itself a phase collapse.
- **A material the reader asked for is not an intermediate.** The welding work
  tied Tantalum to its one consumer and the combined factory could no longer
  let go of the metal it exists to make. Targets, held materials and anything
  kept need the same exemption here.
- **Static is not a phase you can carry.** Only `Ice, Steam, Water` is
  affected, and water is the family most likely to expose a mistake because
  `cond:Steam` is load-bearing in many plans. Worth proving the mechanism on
  the metals first and bringing water in deliberately.

## How to know it worked

- `npm test` -- 78 checks in the corpus plus the plan-UI suite. Green before
  this work starts.
- The 313-plan corpus from the solver investigation is the real net: it catches
  phase-name mismatches across hundreds of plans rather than the handful that
  get eyeballed. Generator and labels are described in the solver notes;
  regenerate rather than trusting a stale copy.
- Specific things to look at rather than assert: that `co2-carbon` still buys
  nothing, that `glass` is still two steps, that the combined factory still
  produces Tantalum, and that plans which melt something still say so.
