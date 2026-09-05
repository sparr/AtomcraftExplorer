# Atomcraft Explorer

A browser explorer for the material and reaction data inside **Atomcraft**, in
two modes. **Explore** searches materials by name, formula or chemical symbol.
**Plan** works out a production line: name what you want, name what you have,
and it finds the processes in between.

## Using it

**[`dist/atomcraft-explorer.html`](dist/atomcraft-explorer.html) is the whole
thing.** It is already built and committed, so there is nothing to run: download
that one file and open it.

No install, no build step, no server — and no copy of Atomcraft. The modules, the
stylesheet and all 951 KB of game data are inlined into the page, and it fetches
nothing at all. It works from a `file://` path, off a USB stick, or served from
anywhere you can put a static file. It is 1.04 MB on disk and about 137 KB over a
gzipped connection.

What is in it: **1871 materials, 687 reactions, 118 elements**, with English
display names, baked from the Steam build of Atomcraft (appid 2803490) as it
stood on **2026-09-05**. Rebuild it against a newer build of the game whenever
you like — see below — but you never have to.

Once it is open:

- Type a name, a formula, or an element symbol: `water`, `Al2O3`, `Cu`. Bare
  terms also match what a material is *made of*, so `H2O` finds Seawater and
  Vinegar, neither of which says so in its name or formula.
- Filters narrow things down: `state:gas`, `el:Au`, `z:80-92`, `is:radioactive`,
  `-is:hidden`. The full list is under [Searching](#searching).
- `/` focuses the search box, `↑`/`↓` move, `Esc` clears.
- **Make this** and **I have this** on any material, and **Plan this** on any
  reaction, hand it to the planner. See [Planning](#planning).
- The whole view lives in the URL — both modes at once, so a link made while
  planning still remembers the search it came from.

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
| `npm test` | formula, plan, search, render and bundle suites |
| `npm run locate` | show which game install was found |
| `npm run pck-tools` | show which extractors are on PATH |
| `npm run serve` | static server for the modular version |
| `npm run clean` | remove `dist/` |

Two runtime dependencies (`@ciberus/find-steam-app` and `find-itch-games`, both
used only at build time), no bundler config.

Both build outputs — `data/atomcraft.json` and `dist/atomcraft-explorer.html` —
are committed, so a fresh clone runs without the game, an extractor, or Steam.

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

## Planning

The second mode builds a **production plan**: a set of processes that reaches
the materials you want from the ones you have, with every choice along the way
shown and overridable.

Start from either end. Name an output and it works backwards; name what you have
and see what that can become. Both end up in the same plan, and you can add to
either side at any point.

What comes out is a list of steps with exact amounts, a **shopping list** of
everything the plan still needs somebody to go and fetch, whatever it leaves
**left over**, and a summary of the **apparatus** it all takes. Each of those is
a place to make a decision: mark something as already in hand, pick a different
route to it, ban a step you would rather not run, or claim a byproduct as
something you wanted after all.

**Feeding a byproduct back** makes it an input the plan may use. A furnace
throwing off steam is a reason to condense the steam rather than fetch snow, so
saying so drops the snow from the shopping list and puts *Steam condenses into
Water* in the plan — with the two thirds of the steam it does not need still
listed as spare, and any shortfall still asked for.

### Reactions are not enough

681 reactions are not a production graph on their own. 121 of their feedstocks
have no reaction that makes them at all — Bauxite is mined, Liquid Chlorine is
condensed, Nuts drop off a tree — so a *process* here is any transformation the
game supports, and you choose which kinds are allowed:

| on by default | reactions, phase changes, fire, growth, nuclear decay |
| off | mining and drops, particle beams, machine handling |

The rule behind the split is whether the game does it unattended. What is
switched off still shows up as *annotation*: a thing to fetch says how the world
hands it over — `⛏ Bauxite Deposit mines into Bauxite` — without putting a step
in the plan for something you have to go and do.

Placing a block is the exception. No machine builds an Aluminum Wall, so a
plan for a loose material never places anything; but ask for the wall itself and
the plan smelts the iron and ends with you putting it down.

### Saying what you mean

Click any material in a plan and the inspector says what it is doing there and
every way of getting it, best first — with **I have it** at the top, because
having one is an alternative to every way of making one. That is how you say "I
have water" about a material the plan had already decided to synthesise, and how
you take a different route to something without banning steps one at a time
until it gives up.

Deposits are not offered that way. A deposit is in the ground somewhere and you
are going to go and find it, so it is stated rather than asked about.

### Naming what actually happens

The game keeps one field for going up in temperature and one for coming down,
and calls them evaporation and condensation whatever the states involved. Most
are neither: of 431 transitions, 287 are a solid becoming a liquid. So the verb
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
it never run. 18 reactions are dead that way, and no plan routes through them.

### Choosing the route

178 materials have more than one producing reaction — Steam has 108 — so the
planner picks, and shows what it picked. The search is a shortest-hyperpath
fixpoint over the whole graph, weighted so that awkward routes lose: a furnace
costs more than a warm room, waiting out a half-life costs more than boiling a
kettle, and doing something by hand costs more than anything the game will do
for you.

What it costs to simply *have* a material decides how far back a plan reaches.
An ore is cheap — that is where a chain is meant to bottom out — and something
you could make is dear, so the plan works backwards through it. Two things
cannot be had at all: a wall exists only where it was placed, and a machine part
is manufactured rather than found, so neither is ever fed into a furnace for its
metal.

Working on something where it lies costs extra for the same reason. Heating a
Corundum Deposit in the ground really does produce the melt, and it is nobody's
production line — so the ore route wins wherever there is one, and what you are
asked for is the Bauxite you would actually be carrying.

### One reaction at a time

A chamber holds a reaction's inputs, its outputs and its catalyst together, and
those are the ingredients of *other* reactions. So each step is given the
temperature range at which it runs and nothing else does:

    Acetic Acid + Water = Vinegar
      stated  ≥ 0 °C
      usable  0–124 °C        avoids: Water evaporates into Steam

681 processes are narrowed this way. Where no temperature dodges the side
reaction — Alumina Reduction runs at 2027 °C, well past alumina's melting point
— it says so rather than pretending the step is impossible. The whole check can
be switched off.

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

## Layout

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

The licence covers the code. `data/atomcraft.json` and the copy of it inlined
into `dist/atomcraft-explorer.html` are extracted from Atomcraft and belong to
the game's authors; `npm run build` regenerates both from a copy of the game you
already own.
