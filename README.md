# Atomcraft Explorer

A browser explorer for the material and reaction data inside **Atomcraft**. The
first mode is material search — by name, by formula, or by chemical symbol.

## Using it

**[`dist/atomcraft-explorer.html`](dist/atomcraft-explorer.html) is the whole
thing.** It is already built and committed, so there is nothing to run: download
that one file and open it.

No install, no build step, no server — and no copy of Atomcraft. The modules, the
stylesheet and all 826 KB of game data are inlined into the page, and it fetches
nothing at all. It works from a `file://` path, off a USB stick, or served from
anywhere you can put a static file. It is 915 KB on disk and about 114 KB over a
gzipped connection.

What is in it: **1795 materials, 681 reactions, 118 elements**, with English
display names, baked from the Steam build of Atomcraft (appid 2803490) as it
stood on **2026-09-02**. Rebuild it against a newer build of the game whenever
you like — see below — but you never have to.

Once it is open:

- Type a name, a formula, or an element symbol: `water`, `Al2O3`, `Cu`. Bare
  terms also match what a material is *made of*, so `H2O` finds Seawater and
  Vinegar, neither of which says so in its name or formula.
- Filters narrow things down: `state:gas`, `el:Au`, `z:80-92`, `is:radioactive`,
  `-is:hidden`. The full list is under [Searching](#searching).
- `/` focuses the search box, `↑`/`↓` move, `Esc` clears.
- The whole view lives in the URL, so any search, selection or collapsed section
  can be bookmarked or linked.

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
1795 materials and 681 reactions against itch's 1728 and 610, with the itch set
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
| `npm test` | formula, search, render and bundle suites |
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

Three kinds of art are pulled out of the `.pck` and inlined into the page.
`tools/ctex.mjs` reads Godot's `GST2` container, whose payload is a WebP that
goes straight into a `data:` URI without being decoded.

| | what | cost |
| --- | --- | --- |
| Swatch shapes | filled square, droplet, puff — white masks tinted with each material's colour, the way the game draws them. Static and Plasma fall back to the square. | 0.3 KB |
| Element tiles | the game's 16×16 periodic-table tile per element, carrying its symbol and family colour. Used in the periodic table; the material count is in the cell's tooltip. | 21.6 KB |
| Symbol glyphs | the bare 14×14 symbol, transparent. **Baked but not yet used anywhere.** | 12.5 KB |
| Pattern sheet | 64 tileable 32×32 greyscale textures on one 256×256 sheet, shown in the **Textures** panel. | 68.1 KB |

The pattern sheet is a reference, not a per-material lookup. A material names a
`ColorDelegate` — `Sand` (532 materials), `Granite` (81), `MetalBits` (40),
down to the animated `LeftConveyor`, `RightConveyor` and `CheckerPulse` — which
selects one of the 64 and, for a few, animates it. Nothing shipped says *which*:
the sheet is referenced only from compiled C#, and every `.cs` in the pck is a
one-byte stub. Searching every `.res`, `.scn`, `.tres` and `project.binary` for
those delegate names finds them in `AllMaterials.json` and nowhere else.

There are no per-material images. All 1898 textures were checked against the
1795 material names, and `Tileset.res` is keyed by tile coordinates with no
material names in it at all.

## Sorting and grouping

The result list sorts by **Relevance**, **Name** or **Atomic number**. The two
ordered modes also group: 1795 materials collapse to about 1000 rows, because
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
them into view.

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
src/main.js                   UI
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
  enumerating. 1198 of 1223 ids resolve; the rest fall back to the internal name.
  All 28 shipped locales decode — the build currently bakes `--locale en`.
- **Isotopes share their element's localized name**, so the mass number is
  re-appended: `Lead-212` rather than three entries all reading "Lead".
- **Enum labels were recovered from the data**, not from code — every `.cs` file in
  the pck is an empty stub. `State` is Solid/Liquid/Gas/Static/Plasma; `Direction`
  is an 8-way compass counter-clockwise from Right; decay modes 0/1/2/6 are
  alpha, beta-minus, beta-plus and spontaneous fission.
- **Elements are not all tagged as such.** Carbon ships as `MAT_SOLID_CARBON`, so
  only ~105 symbols are recoverable from the game data; `tools/elements.mjs` carries
  the real periodic table instead.
- **39 references dangle** — mostly superheavy isotopes named as decay or impact
  products but never defined. The UI renders those as dead links rather than
  pretending they resolve.
- The baking step drops nulls, falses and default zeroes, taking 2.9 MB of raw
  JSON down to 826 KB. Fields where zero is a real value are kept — that means
  the ones that are nullable (`Density`, `ThermalConductivity`, …) and the ones
  that are enums, where 0 names a case: `State` 0 is Solid and
  `DecaySettings.Mode` 0 is alpha decay, which 192 materials use.

## Limitations

- **The tests do not cover appearance.** They run against the DOM shim in
  [`tools/dom-shim.mjs`](tools/dom-shim.mjs), which confirms all 1795 detail
  panes build without throwing and contain what they should, but knows nothing
  of CSS. Layout and styling are checked by looking at the page.
- **Enum labels are inferred.** Every `.cs` file in the `.pck` is a one-byte
  stub, so `State`, `Direction` and the decay modes were recovered from the data.
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
  reactions against Steam's 1795 and 681, a strict subset. The bake is English
  only, though the decoder handles all 28 shipped locales.

## Tests

```sh
npm test                      # all six suites
node tools/test-formula.mjs   # parses + round-trips all 437 distinct formulas
node tools/test-search.mjs    # ranking assertions
node tools/test-render.mjs    # renders all 1795 detail panes against a DOM shim
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
