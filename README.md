# Atomcraft Explorer

A browser explorer for the material and reaction data inside **Atomcraft**, in
two modes. **Explore** searches materials by name, formula or chemical symbol.
**Plan** works out a production line: name what you want, name what you have,
and it finds the processes in between.

## Using it

**It is live at <https://sparr.github.io/AtomcraftExplorer/>.** Nothing to
download, nothing to install.

That page is one file — [`dist/atomcraft-explorer.html`](dist/atomcraft-explorer.html),
committed to the repository and served as the site root. The modules, the
stylesheet and all 951 KB of game data are inlined into it and it fetches
nothing at all, so downloading it gets you the same thing offline: from a
`file://` path, off a USB stick, or served from anywhere you can put a static
file. No build step, no server, and no copy of Atomcraft. It is 1.04 MB on disk
and about 137 KB over a gzipped connection.

What is in it: **1871 materials, 687 reactions, 118 elements**, with English
display names, baked from the Steam build of Atomcraft (appid 2803490) as it
stood on **2026-09-05**. Rebuild it against a newer build of the game whenever
you like — see [Rebuilding it](#rebuilding-it) — but you never have to.

Everything down to [the particle accelerator](#the-particle-accelerator) is
about using that page. [Rebuilding it](#rebuilding-it) onwards is for baking
your own copy against your own install. [Layout](#layout) onwards is for
changing the code.

Once it is open, **Explore**:

- Type a name, a formula, or an element symbol: `water`, `Al2O3`, `Cu`. Bare
  terms also match what a material is *made of*, so `H2O` finds Seawater and
  Vinegar, neither of which says so in its name or formula.
- Filters narrow things down: `state:gas`, `el:Au`, `z:80-92`, `is:radioactive`,
  `-is:hidden`. The full list is under [Searching](#searching).
- `/` focuses the search box, `↑`/`↓` move, `Esc` clears.

and **Plan**:

- Name something to make, or something you have, and it works out the rest:
  the steps and how many times each runs, what is left to fetch, what comes out
  besides what you asked for, and what it all has to be built out of.
- Every choice it made is one press from being changed — a different route to a
  material, a step you would rather not run, something you turn out to have
  already. See [Planning](#planning).

Either mode reaches the other. **Make this** and **I have this** on any
material, and **Plan this** on any reaction, hand it to the planner; every
material in a plan opens back in the explorer. Switching loses nothing, and the
whole view lives in the URL — both modes at once, so a link made while planning
still remembers the search it came from.

## Searching

Terms are ANDed. Prefix `-` to exclude, quote to group: `name:"Molten Iron"`.

| Term | Matches |
| --- | --- |
| `water` | names, formulas, constituent materials and descriptions |
| `Cu` | the above **and** composition — finds Chalcopyrite as well as Copper |
| `H2O` | anything whose formula contains both H and O |
| `el:Au` / `element:Au` | formula contains gold |
| `formula:SO4` | formula text |
| `name:Molten` | internal name only |
| `desc:cancer` | description text |
| `state:gas` | Solid, Liquid, Gas, Static, Plasma |
| `z:26`, `z:80-92` | proton number (also matches the element's own material) |
| `is:radioactive` | also: element, isotope, burning, mechanical, hidden, buildable, mineable, interactable, unstable, food, growing |

Constituents are indexed because a formula can omit what a material is made of:
`Aqueous Zinc Sulfate` has the formula `ZnSO4`, with its water recorded only in
`Composition` — 58 aqueous materials are like this. Searching `H2O` finds them
anyway, ranked below anything matching by name.

The **Periodic table** panel is the same filter with a click target — shading
shows how many materials contain each element.

## Sorting and grouping

The result list sorts by **Name** (the default), **Atomic number** or
**Relevance**. All three group: 1871 materials collapse to about 950 rows, because
variants of one thing fold under it. `Iron` carries `Molten Iron`; `Uranium`
carries its isotopes; `And Gate` carries all eight direction/state permutations;
`Bits of Blender` files under `Blender`. The twisty at the left of a row expands
its group in place; selecting a row opens its group, and clicking the selected
row again closes it without losing the selection. That second click acts on the
group a row *heads*, not the one it sits in, so a variant cannot collapse its
parent out from under itself — and would close its own children if groups are
ever nested.

`src/grouping.js` holds the mechanism, and keeps two ideas apart:

- **Category** — what kind of thing a material is. Tested in a fixed order
  because the tests overlap: Kelp Stalk has drop rates but is a plant, and an
  oscillator's formula is `Cu` but it is a machine, not copper.

  | Elements | Single-element compounds | Polyatomic ions | Compounds | Mixtures & solutions |
  | Deposits | Terrain & minerals | Plants | Biological | Projectiles & beams |
  | Placed blocks | Machines | Other | |  |

  The four placed-in-the-world categories are told apart by flags, tested in
  that order: `IsMechanical` is machinery, `IsBuilt` (or a name ending in
  `Wall`) is a placed block, and anything else still `Static` is terrain. A Door
  is both built and mechanical, and machinery wins. Biological has no flag at
  all — `IsFoodIngredient` also marks Salt and Snow, `MAT_BIO_` covers only the
  fireflies and mites, and an organic composition equally describes a wooden
  wall — so it is a list keyed on `LocIdName` stems, which is also how the
  indexed parts group: `Trunk1` through `Trunk25` share the stem `TRUNK`.

- **Group** — variants of one thing, found two ways, because neither alone is
  right.

  *Names* carry variant markers, which get stripped. A phase affix is only
  stripped when what remains names a material that exists **and states the same
  formula**: `Oxygen Gas` is O₂ while `Oxygen` is O — different substances that
  merely read like phases of each other, and the game agrees, giving them no
  transition between them. Roman numerals survive too: the `(V)` in
  `Potassium Heptafluoroniobate(V)` is an oxidation state, not a variant.

  *Phase transitions* are the other half, and catch what names cannot.
  Evaporation and condensation targets say outright that two materials are one
  substance in different states, so `Liquid Oxygen` files with `Oxygen Gas`
  rather than with `Oxygen`, and `Steam`, `Ice` and `Snow` file with `Water`
  despite sharing no part of its name. Three guards keep that honest: a link
  across a mechanical boundary is ignored (a heating element melts into molten
  nichrome and freezes back out of it, but a device is not a phase of its
  metal); a link between differing formulas is ignored (the game records Liquid
  Nitrogen as N and Nitrogen Gas as N₂); and a *one-way* link additionally needs
  both sides to name the same formula and neither to be a machine, since a
  Silver Wall melts into Molten Silver and states `Ag` just as the metal does.

Back-reference headings spell out their subject — "129 materials are made of
this" rather than "made of (129)". Read in isolation, the bare relationship name
means the *opposite* of the identically-worded line in the forward sections:
"decays into" under Nuclear says what this material becomes, while under
Referenced by it says what becomes this material. The wording lives in
`REFERENCE_RELATIONSHIPS` in `src/data.js`, conjugated for one subject and for
several; the collapse slot stays the bare relationship name, carried on the
element as `data-slot`.

A group takes its category from its head, except when the head lands in `Other`
— that is a fallback, not a kind. Harvested `Sugarcane` has no formula and no
growth rules, but it heads seven Sugarcane stalks, so the group is a plant.

Category headings collapse. A collapsed category spends none of the 400-row
budget, so closing Elements and Compounds brings the smaller categories below
them into view — and a capped list ends with a button that lifts the cap
outright. Typing a new query puts it back.

Atomic-number order applies to elements only; everything else is always by name.

Keys: `/` focus search, `↑`/`↓` or `j`/`k` move, `Esc` clear.

The whole view lives in the URL hash, so any state is linkable and survives a
reload: the query (`q`), the selected material (`m`), and which detail sections
are collapsed (`c`). That last one is a bitmask over the fixed slot list in
`src/collapse.js`, written in base 36 — it covers both the detail pane's
sections and the result list's category headings, which is why slots carry a
`sec:` / `subsec:` / `cat:` prefix. Slots may be appended but never reordered,
or old links decode to the wrong sections.

## Planning

The second mode builds a **production plan**: a set of processes that reaches
the materials you want from the ones you have, with every choice along the way
shown and overridable.

Start from either end. Name an output and it works backwards; name what you have
and see what that can become. Both end up in the same plan, and you can add to
either side at any point. The **make** row is what you ask for; the **have** row
says how much of each you would actually have to supply, worked out from the
plan rather than typed in — a zero there means the material was named but never
used.

What comes out is a list of steps with exact amounts, a **shopping list** of
everything the plan still needs somebody to go and fetch, whatever it leaves
**left over**, and a summary of the **apparatus** it all takes. Each of those is
a place to make a decision: mark something as already in hand, pick a different
route to it, ban a step you would rather not run, or **keep** a byproduct —
counting spare output as a product rather than waste, which asks for nothing to
be made. That is not the same as adding it to what you want: a target sets a
fresh batch going, and its amount is stated *before* the batch scaling while a
leftover is shown after it, so wanting the 1 spare Water would have demanded 2.

**Spare output is fed back into the plan** — every bit of it, by default,
rather than fetching more of something the plan is already throwing away. What
it does not need is still listed as spare, individual outputs can be excluded,
and the whole thing can be switched off under Options. Over all 1871 possible
targets it shortens 57 shopping lists and lengthens none, and cuts the number of
times a plan gives up and tells you to fetch something it could have made from
408 to 393.

Some of it comes back round. Chlorine goes into the hydrochloric acid on the way
to Lithium and comes straight out of the electrolysis further down, in the same
amount, so over a cycle the plan needs none — it is a **priming charge**, listed
apart from the shopping list because none of it is spent. Left to itself the
planner used to go and fetch Vanadinite to make chlorine it already had. 37 of
the 1871 possible targets have a loop like that in them.

Whether something needs priming is a question about whether *any* order works,
not about the order the steps are printed in, so it is answered by trying: run
whatever can run, and only when nothing can does something have to be laid in.
Hydrogen looks like it loops — it is consumed by the acid and produced by the
potassium hydroxide electrolysis — but that electrolysis can be done long before
the acid is wanted, so nothing has to be laid in for it.

A charge is a one-off and an extra step is forever, so the planner takes the
step wherever it can. A loop it cannot break without making things worse is left
alone: asking for Potassium and Lithium out of Lepidolite comes to 14 steps with
nothing to fetch and one Chlorine Gas to lay in, because refusing that one sends
the planner back to fetching Vanadinite for it.

Which of the two you would rather have is still not the solver's call, and both
are one press away where the trade shows up. A step that is only there to save a
charge says so and offers **Prime instead**; a charge offers **Make it instead**.
Either choice is held against the solver, which will not overrule it.

Which materials are spare cannot be known before the plan exists, and knowing
changes the plan, so this is worked out by going round until it settles.

### Reactions are not enough

687 reactions are not a production graph on their own. 171 of their feedstocks
have no reaction that makes them at all — Bauxite is mined, Liquid Chlorine is
condensed, Nuts drop off a tree — so a *process* here is any transformation the
game supports, and you choose which kinds are allowed:

| on by default | reactions, water filters, phase changes, fire, growth, nuclear decay |
| off | mining and drops, particle beams, machine handling |

The rule behind the split is whether the game does it unattended. What is
switched off still shows up as *annotation*: a thing to fetch says how the world
hands it over — `⛏ Bauxite Deposit mines into Bauxite` — without putting a step
in the plan for something you have to go and do.

Placing a block is the exception. No machine builds an Aluminum Wall, so a
plan for a loose material never places anything; but ask for the wall itself and
the plan smelts the iron and ends with you putting it down.

### Taking the water out

A Water Filter or a Block Water splits a material into its dry half and water,
and nothing in the reaction list says so. The rule is in the two blocks'
`OnImpact`, and it reads the `Composition`: exactly two parts, one of them the
`+H2O` marker, and the tile comes apart into the other part and water. One tile
in, one tile of each out — the code sets two tiles and never looks at the counts
the composition states.

69 materials qualify, and for some it is the only way. **Cream** has no reaction
that makes any; it comes out of Milk through a filter and no other way, which is
what puts Butter within reach at all.

The seven aqueous materials whose composition runs to three or four parts —
`Aqueous Zinc Sulfate` is Zinc + Sulfate Ion + `+H2O` — fail that `Count != 2`
test and pass straight through. That is the game's rule, not a shortcut here.

Explore mode's detail pane carries the same pair of facts under **Filtering**:
what a material splits into, and every material it can be filtered out of.

### Saying what you mean

Click any material in a plan and the inspector says what it is doing there and
every way of getting it, best first — with **I have it** at the top, because
having one is an alternative to every way of making one. That is how you say "I
have water" about a material the plan had already decided to synthesise, and how
you take a different route to something without banning steps one at a time
until it gives up.

Routes through something you have come next, ahead of the price order. The
three ways to Carbon that eat carbon dioxide sat at 115, 116 and 117 of 153,
behind six shown and a **Show all** button — a list you could only search if you
already knew the answer.

**The shopping list says what each thing is for.** "6 Lepidolite" is not an
answer to anything: the reader wants to push back on it — rule a route out, say
they already have what it was going to become — and cannot, because the row
never says where it is going. Every step row already carries the material it was
picked to make; the shopping list was the one place the question is actually
being asked and the one place nothing said it.

The chain is followed forward while it is that material's own, and stopped where
it meets the rest of the plan. Six Lepidolite decompose to potassium oxide and
hydrogen fluoride with nothing joining in on the way, so the row reads **for
Hydrofluoric Acid and Potassium Oxide** — and each is a link, because those are
where **Other ways** and **I have it** would actually bite. The potassium oxide
then meets water that came from somewhere else, and that is the end of the
chain. Where something is eaten straight away beside something else there is no
chain to follow, and then what the steps taking it were picked to make is the
answer instead.

Deposits are not offered that way. A deposit is in the ground somewhere and you
are going to go and find it, so it is stated rather than asked about.

### Naming what actually happens

The game keeps one field for going up in temperature and one for coming down,
and calls them evaporation and condensation whatever the states involved. Most
are neither: of 655 transitions, 360 are a solid becoming a liquid. So the verb
comes from the pair of states — **melts**, **evaporates**, **sublimates**,
**solidifies**, **condenses**, **freezes** — and both the planner and the
material detail pane use it.

A run of transitions in the same direction is one step, too. Steam does not stop
at Water on the way to Ice, so cooling it far enough is *Steam condenses and
solidifies into Ice*, held below the tighter of the two thresholds. Stopping at
the middle is still there in the alternatives, since asking for Water is what
that means.

### What else is in the chamber

A tile runs the first reaction in its own list that is valid this tick and then
stops. The list belongs to the material, so the rivals are the reactions sharing
a `PrimaryInput` — and most carry a 1-in-P gate, which is what lets the later
ones get a turn at all.

Lepidolite's three decompositions are gated at 51, 52 and 50, so each takes
about a third of the ore. A plan for Potassium therefore asks for **three**
Lepidolite per reaction's worth of output, and lists the lithium and the alumina
among what it leaves over — they are coming out of your furnace whether the plan
mentions them or not. The other two reactions appear as steps of their own,
marked as sharing the chamber, with no controls: they are not a choice.

Where an earlier rival has no gate at all it fires every time and the ones after
it never run. 16 reactions are dead that way, and no plan routes through them.

### Choosing the route

178 materials have more than one producing reaction — Steam has 112 — so the
planner picks, and shows what it picked. The search is a shortest-hyperpath
fixpoint over the whole graph, weighted so that awkward routes lose: a furnace
costs more than a warm room, waiting out a half-life costs more than boiling a
kettle, and doing something by hand costs more than anything the game will do
for you.

**Some of it falls out of the sky.** Nothing in the material list says so — it
is in the simulation's weather branch, where a Rainstorm sets tiles to Water and
a Snowstorm to Falling Snow. Without that the planner could only infer "raw"
from the absence of a recipe, which is why it understood that snow could simply
be gathered, nothing making any, and thought water — with 76 ways to make it —
had to be manufactured. It is the same storm. Firestorms and acid rain drop coal
and sulfuric acid in the same code, but only the developer console ever starts
one, so they are not counted.

What it costs to simply *have* a material decides how far back a plan reaches.
An ore is cheap — that is where a chain is meant to bottom out — and something
you could make is dear, so the plan works backwards through it. Two things
cannot be had at all: a wall exists only where it was placed, and a machine part
is manufactured rather than found, so neither is ever fed into a furnace for its
metal.

**A price of zero is not a reason.** Costing what you have at nothing says a
route is not *charged* for eating your carbon dioxide. It never said a route was
worth anything for doing so — and asked for Carbon with carbon dioxide in hand,
the planner reached for a mushroom spore that turns straight into it for 1.56
and left the stock alone. The reduction the question was about, 4 K + CO₂ → 2
K₂O + C, costs 13.22, and nearly all of that is the four Potassium.

No weight fixes that. Small enough to leave the rest of the scale meaning
anything and it never overturns the spore; large enough to overturn the spore
and every price below it collapses together. So it is asked as a separate
question, after the costing rather than inside it: is there a route through what
you said you had, and what happens to the plan if it takes one. Each is solved
as though it had been pinned, and they are judged the way two plans are always
judged here — by the shopping list they leave.

Which is what makes it worth the solves. The potassium route is the dearest of
the three ways through carbon dioxide and it is the one you want: its own 2 K₂O
comes back round through the hydroxide and the electrolysis to make the
potassium again, so the plan asks for Water and a charge of Potassium Oxide laid
in once. The cost model cannot see that — it prices the potassium as though you
had to fetch Lepidolite for it every run — and the finished plan can, because by
then the loop has been found. The magnesium route is cheaper by the model, and
sends you out for Vanadinite besides.

Only a declared stock does this. Pressing "I have it" on a line of the shopping
list is waving something off, not naming feedstock, and a plan must not
restructure itself around a material you were trying to stop thinking about.

Working on something where it lies costs extra for the same reason. Heating a
Corundum Deposit in the ground really does produce the melt, and it is nobody's
production line — so the ore route wins wherever there is one, and what you are
asked for is the Bauxite you would actually be carrying.

**Ruling something out is not one-way.** "Not this" on a step and "Never use
it" on a material are each one press, and each removes the thing the button was
attached to — so a plan narrowed until it collapses used to leave nothing on
the page saying what narrowed it. Everything you have kept out is listed under
**N ruled out**, with what the plan gave up on as a result, and one press each
to let it back in. The same undo sits on the route itself, which is kept in the
list past the cut for exactly that reason.

**A reaction is never run for what falls out of it anyway.** Hydrofluoric Acid
Dissolves Columbite yields three Water beside the acid, and a plan for Tantalum
and Niobium wanted forty-eight Water — so it ran sixteen times instead of three.
Sixteen Columbite dissolved and ninety Hydrofluoric Acid bought, to make water
that was already on the shopping list, with ten Heptafluorotantalic Acid and ten
Heptafluoroniobic Acid thrown out for it: the ore's whole tantalum half, in the
bin, to fetch something that falls from the sky.

Two things earn an output the right to size the process, and it took three
wrong rules to find the second. The **chamber** was picked to make it — the
chamber, not the reaction, because rivals sharing a feed are booked in
proportion to the one that was sized. Or it is **made of what was asked for**.
Reading only the chosen producer breaks Lepidolite, whose Molten Silica comes
back off the plan's own loop and so has no chosen producer at all; reading the
plan's intent off the dag instead moves under you, because the feedback rounds
turn Water from acquired into credited and the exclusion quietly stops applying.
What a thing is *made of* does not move. Molten Silica has silicon in it and
silicon was asked for; the dissolution's water has nothing to do with tantalum.

That takes the plan from sixteen Columbite to three, and three is the whole of
it: one ore is one tantalum and one niobium, the game's chain doubles both on
the way to the metal, and six of each is what three ore come to. Nothing with
either metal in it is left over, and the ninety Hydrofluoric Acid and half the
Lepidolite go with the waste.

**And what is left over that still has some of it in it gets fed back.** The
last of it is one leftover at a time: everything at once is the cheaper question
and usually right, but it is a single vote, and the dozen spare materials here
are rejected together — taking the Heptafluorotantalic Acid, the entire tantalum
half, with them. Tried on its own it takes Molten Tantalum off the shopping list.
Which one to try is the one *made of what was asked for*, which nothing could
answer until the composition work above, the game having given that acid no
formula. Only where the plan is shopping for the very stuff it is binning, and
only as a whole re-solve, because on a single pass it scores worse and only pays
once the feedback rounds run again on top of it.

### Amounts that use the feed up

Ask for one each of Potassium, Lithium, Aluminum and Silicon out of Lepidolite
and you get two of each — a run is a whole thing, so the plan doubles — with
one Molten Silica left on the floor. The ore's three decompositions share a
chamber and hand back three Molten Silica whether you wanted them or not, so
what three Lepidolite actually come to is two, two, two and **three**.

**Balanced**, on the make row and on by default, does that arithmetic. Two
things, in order: the batch scale is folded in, so the numbers say what you get
rather than what you asked for before the plan rounded it up; then each amount
is raised as far as it will go without the plan wanting more of anything you
said you have, and the result reduced to its smallest whole numbers.

    make    1 Potassium   1 Lithium   1 Aluminum   1 Silicon      [Balanced]
      →     2 Potassium   2 Lithium   2 Aluminum   3 Silicon
    have    3 Lepidolite — the same three either way

Because the ratio is a property of the question rather than of the numbers
already in the box, the search starts from one of each. Otherwise a lopsided
request keeps the oversized feed it committed to: 2/2/2/4 buys twelve
Lepidolite, and filling *those* gives 8/2/2/12 rather than the 2/2/2/3 that
three would have got. So 2/2/2/4, 4/4/4/6 and 9/1/1/1 all come back to the same
answer, whichever way they were wrong.

Two cases keep the amounts they were given and take only the scaling: one
product has no ratio to be in, and a feed nothing draws on is no constraint —
Molten Aluminum out of Water would climb until it ran out of patience. Typing
an amount turns balancing off, because a box that will not hold what you put in
it is worse than no box.

**"I have it" means two different things.** Lepidolite you have three of, and
how much Potassium that comes to is the question. Carbon you can go on making, so holding the plan to whatever the
first guess happened to need costs you the third Silicon for no reason. Each
chip on the have row says which it is and flips on one press:

    have    3 Lepidolite  all I have      9 Carbon  as needed

Both stop the plan working out how to make the material. A stock is what the
amounts are balanced against, and it is also feedstock you are asking the
planner to get through, which is the subject of *Choosing the route* above. The
number is the same either way — all you have, or all it will take. **As needed** is the default
wherever something is being waved off rather than declared: pressing "I have
it" on a line of the shopping list is not a statement about how much of it you
have, and before this it quietly became one.

**A charge has to be something you could turn up with.** Tantalum and Niobium
out of Columbite came back "prime with six Heptafluorotantalic Acid and six
Heptafluoroniobic Acid" — which you can only get by dissolving Columbite, which
is the plan. On a first reactor for either metal there is nowhere to find any.
The steps there really are mutually blocked, so something has to seed the loop;
what settles which is the shopping list. You are already going out for ninety
Hydrofluoric Acid, so laying some of that in is not a second errand, and the
charge is Hydrofluoric Acid instead.

It costs about a dozen solves, so the answer is kept until the question changes
— which products, out of what, with which steps ruled out.

### Running a route on the leavings

Picking a route can mean two things, and a click cannot say which. Ask for
2 Potassium, 2 Lithium, 2 Aluminum and 3 Silicon out of Lepidolite and the plan
puts nine Carbon into the two reductions and gets eight Carbon Monoxide back —
three Carbon in, two out, twice over — which it has no use for. The Boudouard
equilibrium turns two of those into a Carbon, so picking it for Carbon looks
like free money.

Taken as the whole answer it is not. Nine Carbon by that route wants eighteen
Carbon Monoxide, and to find the other ten the plan gasifies ninety Wood and
decomposes four Vanadinite — a factory built to feed a reaction whose entire
appeal was the surplus. Taken the other way it runs four times on the eight
that are there, and the mushroom spores that were making all nine now make
five:

    4×  2 Carbon Monoxide → Carbon Dioxide + Carbon
        on the spare Carbon Monoxide — the other 5 Carbon come from
        Bitter Oyster Spore turns into Carbon

So both readings are worked out and the better one is kept, judged on the same
scale as everything else: what it leaves you to fetch. Where nothing is spare
to run on, the second reading makes nothing at all and a pin is just a pin.

Two routes are then live at once, and each says how much of the total it
covers. This one is a recycle loop — the Carbon Monoxide only comes back after
the Carbon has gone in — so it also wants four Carbon laid in to set it
turning, which the panel offers to undo by dropping the route rather than by
adding a step.

**Use the spare** says it outright, on any route the plan could already feed
from its leavings. It is not a claim about how the material is made, so it
composes with the ones that are: press it on the Boudouard equilibrium, then
say you have Carbon, and the plan eats all eight Carbon Monoxide for four
Carbon while asking you for the other five —

    have    3 Lepidolite    5 Carbon

— rather than the nine it would have wanted without it, and with no mushrooms
in the plan at all. The have row is net of whatever the plan makes for itself,
which is the only reading of it that is a number you can go and act on.

**The last thing on the list is worth more than its price.** The Carbon plan
asked for two Water while venting two Hydrogen Gas and two Oxygen Gas — which
is the water it was buying, in pieces. Nothing in the search was going to spot
that: water falls from the sky, so having one costs 0.5 and making one out of
your own exhaust came to 3.0, and the rule that making has to beat having did
the rest. The price is not even wrong. Water *is* free, and a plan that
manufactures it from scratch while it is raining outside would be a worse plan.

What the price cannot see is the shopping list. An item that is the *only* one
left is the difference between a factory that runs and an errand you have to
keep running, and that is not a quantity any per-material cost knows about —
but it is exactly what plans are already ranked by. So for anything still to be
fetched, the ways of making it that the leavings would cover are tried, pinned
so the price cannot overrule them, with whatever turns the leavings into their
feed run on the leavings alone. Then the usual comparison picks:

    1×  2 Hydrogen Gas + Oxygen Gas → 2 Steam
        on the spare Hydrogen Gas and Oxygen Gas, then condensed

— and the shopping list is empty. What the plan comes to is one carbon dioxide
in, one Carbon out and the oxygen it arrived with; the potassium and the water
are a charge laid in once and turn on their own after that.

**Where two of these close the list, the one that throws less away wins.** The
carbon dioxide can take the spare hydrogen back directly — `CO₂ + H₂ → CO + H₂O`
— which closes the list in six steps rather than seven. It also leaves two
Carbon Monoxide, and a byproduct is a standing obligation where a step is a
one-off: something has to carry them away for as long as the factory runs, so a
seventh step to not make any is a bargain. Waste is counted in kinds rather
than amounts, because how much comes off scales with the batch and a plan is
not worse for being asked about in larger numbers.

Only here, though. Counting waste in the ordinary comparison was tried, and over
260 targets it moved three plans, took 364 units of waste out of them and cost
one step in total — but one of the three was the last plan in the data that
still traded a step for a charge, and **Prime instead** is offered on the step
that trade buys. Boron Oxide stopped fetching seven Water in order to vent six
Steam, which is a better plan, and it left a real feature with nothing to sit
on. So waste settles the choice where the choice is about waste, and the general
ranking is left alone.

Two steps out from the leavings and no further, which is what keeps this from
becoming a search for something to do with an awkward byproduct.

**A leftover can be told to have the thing you asked for still in it.** Ask for
Tantalum and Niobium out of Columbite and ten Heptafluorotantalic Acid go in the
bin, which is the tantalum half of the ore. Saying so was impossible until
recently: 1038 of the 1871 materials carry a formula and the gaps fall exactly
on the compounds a plan passes through — every step from Columbite to the metal
is one of them.

It can be worked out, because the reactions are a set of statements about where
the atoms went. Three sources, strongest first, because they are not equally
trustworthy. The **formula**, where there is one. A **phase change**, which is
the same substance in another state — Silica melts into Molten Silica, so both
are SiO₂, and that alone settles 215 more. Then the **reactions**, which are
only mostly conservation, so they are counted rather than trusted and a majority
carries it; that reaches another 94, the fluoro-acids among them. 524 materials
are left with nothing to go on, mostly biological, and the honest answer there
is silence.

Presence only, never counts. Counts would need the reactions to balance and they
do not — one Aqueous Potassium Heptafluorotantalate(V) really does come back as
one Tantalum Pentoxide, which is two tantalum atoms out for one in.

Reactions sharing a chamber are read together rather than one at a time, which
matters more than it sounds. Lepidolite's three decompositions divide one feed
one way in three, and the branch that makes the lithium never mentions the
potassium — so read alone it says the potassium turned into silica, and Molten
Silica came out as "K Si Al". Merged at one run each, the way the rest of the
planner reads them, the potassium is accounted for by the branch that carries
it. Nine chambers out of 687 reactions, and they were the ones doing the damage.

None of this is chemistry the game shipped, so it is kept well away from the
formula it is standing in for, said quietly on the row, and never rendered as
though somebody had written it down.

### One reaction at a time

A chamber holds a reaction's inputs, its outputs and its catalyst together, and
those are the ingredients of *other* reactions. So each step is given the
temperature range at which it runs and nothing else does:

    Acetic Acid + Water = Vinegar
      stated  ≥ 0 °C
      usable  0–124 °C        avoids: Water evaporates into Steam

802 processes are narrowed this way. Where no temperature dodges the side
reaction — Alumina Reduction runs at 2027 °C, well past alumina's melting point
— it says so rather than pretending the step is impossible. The whole check can
be switched off.

## The particle accelerator

The accelerator fires one of three beams, and each material's detail pane gets a
**Particle accelerator** section showing, per beam, what it turns into and what
turns into it.

`BaseMaterial.TryParticleCollision` decides this by looking the result up in the
struck material's own `TurnsIntoFrom<beam>Impact` field — a table, not
arithmetic — and does nothing where that field is unset. It fires on a cadence
rather than every tick, gated on `(tick + tile) % 32`.

The table is nonetheless exactly consistent with the physics, in all 654
mappings that resolve to a defined material:

| beam | change | mappings |
| --- | --- | --- |
| Proton | Z+1 | 214 |
| Neutron | N+1 | 226 |
| Alpha | Z+2, N+2 | 214 |

Not one exception. Note the alpha beam *absorbs* a helium nucleus, the reverse
of the alpha decay shown under Nuclear. A test asserts every mapping still
matches the label the section prints, so those labels cannot quietly become
wrong.

277 materials name a beam result and another 12 are only ever a target; the
section is omitted for everything else, and `Referenced by` no longer repeats
the impacts it covers.

## Rebuilding it

Only needed to pick up a newer version of the game, or to change the code.

```sh
npm install              # two dependencies, plus it wires up the git hook
npm run build            # locate the game, extract, bake -> dist/atomcraft-explorer.html
```

This reads the game's `.pck` directly: it locates your installed copy, pulls three
files out of the archive, and inlines them into the page.

**Or run the modular source**, which is what you want while editing:

```sh
npm run serve            # python3 -m http.server 8099, or any static server
```

and open <http://127.0.0.1:8099>.

That second path needs a server for a reason worth knowing: browsers give every
`file://` document an opaque origin, and both `fetch()` and ES-module `import`
are same-origin operations. So `index.html` — which uses `<script type="module">`
and fetches `data/atomcraft.json` — is blocked on `file://` by CORS, no matter
where the files sit. The standalone build sidesteps both by being one classic
`<script>` with its data already inside it.

## Getting the game data

`npm run build-data` needs two things.

**1. A Godot `.pck` extractor on your PATH.** Either one works:

| | |
| --- | --- |
| [`godotpcktool`](https://github.com/hhyyrylainen/GodotPckTool) | preferred — supports regex filtering, so it pulls 3 files out of a 234 MB archive in ~0.2 s |
| [`GodotPCKExplorer.Console`](https://github.com/DmitriySalnikov/GodotPCKExplorer) | no filtering, so it extracts the whole archive to a temp dir (~1.6 s) and the build picks through it |

Both produce byte-identical bakes. `npm run pck-tools` shows which are visible;
`--pck-tool <name>` forces one.

**2. An installed copy of Atomcraft.** Locators run in order, first hit wins.
Steam sits ahead of itch deliberately: the game can be installed through both
and the builds differ — on the machine this was written on, the Steam copy had
1871 materials and 687 reactions against itch's 1728 and 610, with the itch set
a strict subset. Pass `--game-dir` to build from the itch copy instead.

| | |
| --- | --- |
| explicit | `--pck <file>`, `--game-dir <dir>`, or `ATOMCRAFT_PCK` / `ATOMCRAFT_GAME_DIR` |
| Steam | [`@ciberus/find-steam-app`](https://www.npmjs.com/package/@ciberus/find-steam-app)'s own lookup — by name, or by `--steam-appid` |
| itch | [`find-itch-games`](https://www.npmjs.com/package/find-itch-games)'s own lookup — by name, or by `--itch-game-id` |

`npm run locate` prints what it found and how. If a store locator comes up empty
— or gets it wrong — pass the path explicitly; nothing tries to outsmart the
library. Extraction goes to a temp directory that is removed afterwards;
`--keep-extracted` leaves it and says where.

If you already have the `.pck` unpacked, `--data-dir <dir>` skips locating and
extracting entirely.

## Scripts

| | |
| --- | --- |
| `npm run build` | both steps below |
| `npm run build-data` | locate + extract + bake → `data/atomcraft.json` |
| `npm run bundle` | inline everything → `dist/atomcraft-explorer.html` |
| `npm test` | all eleven suites: formula, planner, both modes, search, grouping, art, styles, fields, render, bundle |
| `npm run locate` | show which game install was found |
| `npm run pck-tools` | show which extractors are on PATH |
| `npm run serve` | static server for the modular version |
| `npm run audit` | print every grouping decision and why |
| `npm run extract-patterns` | re-read the shading tables out of the game binary |
| `npm run clean` | remove `dist/` |

Two runtime dependencies (`@ciberus/find-steam-app` and `find-itch-games`, both
used only at build time), no bundler config.

Both build outputs — `data/atomcraft.json` and `dist/atomcraft-explorer.html` —
are committed, so a fresh clone runs without the game, an extractor, or Steam.

## Layout

Everything from here is about the source rather than the page.

```
index.html                    markup and panels
src/formula.js                formula parser (Al2(SO4)3, CaSO4·2H2O, (Fe,Mn)WO4, 17% Co 83% Fe)
src/data.js                   bundle loader; name/symbol/reaction/back-reference indexes
src/search.js                 query grammar and ranking
src/units.js                  temperatures, in the units the game shows
src/plan-graph.js             every way one material becomes another
src/plan-solve.js             route search, amounts, apparatus
src/plan-state.js             the plan itself, and how it lives in the URL
src/plan-view.js              the plan pane
src/main.js                   UI, and the shell both modes hang off
tools/locate-game.mjs         finds the installed game (explicit, Steam, itch)
tools/pck-tool.mjs            adapter over godotpcktool / GodotPCKExplorer.Console
tools/build-data.mjs          locates, extracts and bakes data/atomcraft.json
tools/bundle.mjs              inlines everything into the standalone build
tools/elements.mjs            canonical periodic table (symbols + grid layout)
tools/godot-translation.mjs   decoder for Godot .translation resources
tools/dom-shim.mjs            minimal DOM, so the UI can be tested headlessly
.githooks/pre-commit          blocks commits with a stale bundle
tools/audit-grouping.mjs      prints every grouping decision and why
tools/test-*.mjs              headless tests
data/atomcraft.json           baked game data          (generated)
dist/atomcraft-explorer.html  standalone build         (generated)
LICENSE                       MIT
```

Everything is JavaScript — source, build and tests all run on Node.

## The pre-commit hook

Because the bundle is committed, it can go stale. `.githooks/pre-commit` blocks
any commit where `dist/atomcraft-explorer.html` no longer matches the sources
that feed it (`src/`, `index.html`, `data/atomcraft.json`, `tools/bundle.mjs`).

It rebuilds from the **index** rather than the working tree — via
`git checkout-index` into a temp dir — so it validates exactly what is being
committed, including partial staging with `git add -p`. When nothing
contributing is staged it exits in a few milliseconds.

Enable it after cloning:

```sh
npm install              # runs the `prepare` script, or set it by hand:
git config core.hooksPath .githooks
```

It also warns — without blocking — when `tools/build-data.mjs`,
`tools/elements.mjs` or `tools/godot-translation.mjs` change but
`data/atomcraft.json` does not, since that staleness can only be checked with
`../Atomcraft.pck` present.

## The game's art

Two kinds of art are pulled out of the `.pck` and inlined into the page.
`tools/ctex.mjs` reads Godot's `GST2` container, whose payload is a WebP that
goes straight into a `data:` URI without being decoded.

| | what | cost |
| --- | --- | --- |
| Swatch shapes | filled square, droplet, puff — white masks tinted with each material's colour, the way the game draws them. Static and Plasma fall back to the square. | 0.3 KB |
| Element tiles | the game's 16×16 periodic-table tile per element, carrying its symbol and family colour. The material count is in the cell's tooltip. | 21.6 KB |

**There are no per-material images**, and no texture to map a material to. All
1899 packed textures were checked against the 1871 material names, and
`Tileset.res` is keyed by tile coordinates with no material names in it.

`Art/Materials/GrayscaleMaterialTextures.png` — a 256×256 sheet of tileable
greyscale patterns — looks like it ought to be that mapping, and is not.
Decompiling `Atomcraft.dll` with `ilspycmd` settles it: the 19 `ColorDelegate`
names a material can carry (`Sand` on 532 materials, `Granite` on 81, down to
the animated `LeftConveyor`, `RightConveyor` and `CheckerPulse`) are all
implemented in `MaterialColorDelegates` as **procedural** functions — named
noise patterns lerped over the material's base colour, with no image sampling
anywhere in that class or in `MaterialColorIndex`. A material's appearance is
computed per pixel, never sampled from a sheet. The world tilemap is likewise
generated at run time: `Tilesets` builds a 512×512 atlas of 8×8 tiles, 64 to a
row, indexed by material.

### Reproducing the shading

The rules are in the binary rather than the pck, so `npm run extract-patterns`
decompiles `Atomcraft.MaterialColorDelegates` and writes the numbers to
`src/patterns.js`. That file is checked in, so neither the game nor `ilspycmd`
is needed to build the page — only to refresh it against a new game build.

A material's colour is its base `Color` blended toward a tint by
`table[y % rows][x % cols] × amount`:

| delegate | table | tint | amount |
| --- | --- | --- | --- |
| `Granite` | `GranitePattern` 6×6, 2 values | DarkGray | 0.5 |
| `Crystal` | `CrystalPattern` 9×9, 5 values | White | 0.5 |
| `MetalBits`, `SparklyMetal` | `MetallicShavings` 9×9, 3 values | White | 0.9 |
| `Bark` | `BarkNoisePattern` 9×9, 10 values | DarkerOrange | 0.25 |
| `Sand`, `Gravel`, `Dirt`, `Lava` | 64×64, filled with `GD.Randf()` at startup | White / Black / Yellow | 0.5–0.15 |

Twelve delegates animate. The gems route to `Twinkle`, which sparkles white over
a colour they each pass in — read the other way round, Ruby renders as a flat red
square, since its base is red too. `SparklyMetal` twinkles over the metallic
pattern; `Lava` walks its table; the conveyors scroll theirs one column a tick.
`Limestone` has its own sampler and is approximated here from what it looks like
in game: vertical stripes, light-mid-dark-mid.

`src/pattern-render.js` draws this to a canvas, cached per delegate and colour,
and falls back to the flat colour where there is no canvas. The random tables are
regenerated from a fixed seed, so a material looks the same on every visit —
the game re-rolls them each run.

## Notes on the source data

- **Display names come from the Godot translation resources.** They are stored as
  a perfect-hash table (SMAZ-compressed values, keys kept only as 32-bit hashes),
  so `tools/godot-translation.mjs` looks up the `LocIdName` values rather than
  enumerating. 1262 of 1283 ids resolve; the rest fall back to the internal name.
  All 28 shipped locales decode — the build currently bakes `--locale en`.
- **Isotopes share their element's localized name**, so the mass number is
  re-appended: `Lead-212` rather than three entries all reading "Lead".
- **Enum labels were recovered from the data**, not from code — every `.cs` file in
  the pck is an empty stub. `State` is Solid/Liquid/Gas/Static/Plasma; `Direction`
  is an 8-way compass counter-clockwise from Right; decay modes 0/1/2/6 are
  alpha, beta-minus, beta-plus and spontaneous fission.
- **`Mass` replaced `Density` and `Weight`.** The 2026-09-05 build drops both
  and carries a single `Mass` instead, along with `SpecificHeat`,
  `LaserAbsorption` and `IsReflective` — the last of which only two materials
  have, the Mirror and its bits. That build also brings lasers, mirrors, prisms
  and 20 elemental vapors, five crystal-growth reactions and one for blending a
  chicken egg: 76 materials and 6 reactions more than the build before it, with
  nothing removed.
- **Elements are not all tagged as such.** Carbon ships as `MAT_SOLID_CARBON`, so
  only ~105 symbols are recoverable from the game data; `tools/elements.mjs` carries
  the real periodic table instead.
- **76 materials carry a `LightColor` with no `LightRange`.** `Materials.cs`
  defaults an unset range to 0, and lighting is driven by that range, so those
  colours light nothing and are not shown. Every powered logic gate is one of
  them, all recorded red.
- **43 references dangle** — mostly superheavy isotopes named as decay or impact
  products but never defined. The UI renders those as dead links rather than
  pretending they resolve.
- The baking step drops nulls, falses and default zeroes, taking 4.1 MB of raw
  JSON down to 951 KB. Fields where zero is a real value are kept — that means
  the ones that are nullable (`Mass`, `ThermalConductivity`, …) and the ones
  that are enums, where 0 names a case: `State` 0 is Solid and
  `DecaySettings.Mode` 0 is alpha decay, which 192 materials use.

## Tests

```sh
npm test                      # all eleven suites
node tools/test-formula.mjs   # parses + round-trips all 436 distinct formulas
node tools/test-plan.mjs      # the process graph and the route solver
node tools/test-plan-ui.mjs   # both modes, and that switching loses nothing
node tools/test-search.mjs    # ranking assertions
node tools/test-render.mjs    # renders all 1871 detail panes against a DOM shim
node tools/test-styles.mjs    # every class used in markup or code has a rule
node tools/test-coverage.mjs  # the UI's fields and the game's agree, both ways
node tools/test-bundle.mjs    # runs the standalone build with fetch() disabled
```

The DOM shim deliberately mimics browser quirks rather than smoothing them over
— `append(null)` stringifies to the text `"null"`, for instance, which is how a
real rendering bug got caught.

## Limitations

- **A field the UI reads by property access can still go unnoticed.**
  `tools/test-coverage.mjs` checks both directions — every field carrying a
  value is read, and every field the code *names* still exists — but the second
  half only sees the two places that name fields as data: the detail pane's
  `['Field', 'Label']` lists and the back-reference map in `data.js`. Something
  reached as `m.raw.Whatever` and then dropped by the game leaves a dead branch
  that nothing here will flag.
- **The tests do not cover appearance.** They run against the DOM shim in
  [`tools/dom-shim.mjs`](tools/dom-shim.mjs), which confirms all 1871 detail
  panes build without throwing and contain what they should, but knows nothing
  of CSS. Layout and styling are checked by looking at the page.
- **Enum labels are inferred.** Every `.cs` file in the `.pck` is a one-byte
  stub, so `State`, `Direction` and the decay modes were recovered from the data.
  Three more — `WireSignal`, `GrowthMedium` and `AudioType` — were read out of
  the assembly instead, so those are quoted rather than guessed.
  The compass directions are the weakest of these: `1/3/5/7` are pinned by
  materials named `(Right)`, `(Down)`, `(Left)` and `(Up)`, but the diagonals
  `2/4/6/8` are a pattern completed from those, not something the data confirms.
- **The route search does not carry quantities.** It knows what a material
  costs, not how much of it there is, so a byproduct offered back is free *and
  unlimited* to it. Plans are compared afterwards on what they leave you to
  fetch, which catches most of the damage, but a plan that over-commits a
  surplus and then asks you to make up the difference can still be the best one
  found. Closing that properly means putting amounts into the search itself.
  A route picked by hand is the one case where amounts do decide: it can be run
  on the surplus alone, with the old route making up the difference. The
  planner will not reach for that by itself — nothing tries a spare byproduct
  through a conversion unless you name the conversion.
- **What the weather delivers is a hand-written list**, read out of the
  assembly rather than the data — the same weakness as the biological category
  further down. Nothing here would notice the game adding a storm, or renaming what one
  drops. `tools/test-plan.mjs` only checks that the two names still resolve.
- **Competing reactions are only found where they share a `PrimaryInput`.**
  That is the list the game actually iterates, so it is right about which
  reactions divide a feed between them. But two reactions with *different*
  primary inputs that both consume your material will both run in a real
  chamber, and no plan here says so.
- **Amounts are for one batch, in sequence.** The priming charge is what has to
  be in the chamber before a single batch turns over; a loop that only runs
  short at higher throughput, or several chambers drawing on one supply at once,
  is not something the plan can express.
- **The route weights are preferences, not game numbers.** What a furnace
  "costs" against a slow reaction, or fetching an ore against making one, is a
  judgment written into one table in [`src/plan-solve.js`](src/plan-solve.js).
  They were tuned against plans that came out obviously wrong, which is a good
  way to catch nonsense and no guarantee of the best answer.
- **The grouping rules describe this data set, not documented game semantics.**
  Each guard in [`src/grouping.js`](src/grouping.js) exists because an audit
  caught a specific wrong merge — machines melting into their metal, deposits
  into theirs, `Liquid Nitrogen` bridging N to N₂. They fit what the game
  currently ships and may fit what it ships next much less well.
- **The biological category is a hand-written list.** No flag identifies it, so
  it is a set of `LocIdName` stems. Unlike the relationship list, which has a
  test asserting it still covers the data, nothing can detect a tissue type
  added by a future update — it will quietly land in Terrain.
- **The committed data is one build from one store.** The Steam and itch copies
  differ; on the machine this was built, itch had 1728 materials and 610
  reactions against Steam's 1871 and 687, a strict subset. The bake is English
  only, though the decoder handles all 28 shipped locales.

## AI disclosure

This project was written by Claude Opus 5, Anthropic's model, in a
[Claude Code](https://claude.com/claude-code) session directed by the author.

Claims about the game's data were checked against the game rather than assumed.
The `.pck` is read with [`godotpcktool`](https://github.com/hhyyrylainen/GodotPckTool)
or [`GodotPCKExplorer.Console`](https://github.com/DmitriySalnikov/GodotPCKExplorer),
and both were verified to produce byte-identical bakes. The `.translation`
decoder was written against Godot's `OptimizedTranslation` and SMAZ, and is
confirmed by the strings it recovers. Where this README describes what the game
data contains — counts, enum meanings, the phase links, the formula quirks — it
is describing values read out of `AllMaterials.json` and `AllReactions.json`,
usually printed in the course of finding a bug.

What the automated checks do and do not cover is set out under
[Limitations](#limitations).

## License

[MIT](LICENSE)

The license covers the code. `data/atomcraft.json` and the copy of it inlined
into `dist/atomcraft-explorer.html` are extracted from Atomcraft and belong to
the game's authors; `npm run build` regenerates both from a copy of the game you
already own.
