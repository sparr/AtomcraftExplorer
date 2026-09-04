# Atomcraft Explorer

A browser explorer for the material and reaction data inside **Atomcraft**. The
first mode is material search — by name, by formula, or by chemical symbol.

The build reads the game's `.pck` directly: it locates your installed copy, pulls
three files out of the archive, and bakes them into a bundle the page loads.

## Running it

```sh
npm install              # one dependency, plus it wires up the git hook
npm run build            # locate the game, extract, bake -> dist/atomcraft-explorer.html
```

**Then just open `dist/atomcraft-explorer.html`.** It is a standalone build —
the modules, the stylesheet and all the data are inlined. Double-click it, or
open it from any filesystem path; nothing is fetched.

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

**2. An installed copy of Atomcraft.** Locators run in order, first hit wins:

| | |
| --- | --- |
| explicit | `--pck <file>`, `--game-dir <dir>`, or `ATOMCRAFT_PCK` / `ATOMCRAFT_GAME_DIR` |
| Steam | [`@ciberus/find-steam-app`](https://www.npmjs.com/package/@ciberus/find-steam-app)'s own lookup — by name, or by `--steam-appid` |
| itch | **not implemented yet** — a stub in `tools/locate-game.mjs` awaiting the itch locator |

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

One runtime dependency (`@ciberus/find-steam-app`, used only at build time), no
bundler config.

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
  | Deposits | Plants | Projectiles & beams | Machines & structures | Other |

- **Group** — variants of one thing, found by stripping variant markers from
  names. A phase affix is only stripped when what remains names a material that
  exists, so `Bromine Gas` folds into `Bromine` but `Arsenic Trioxide Gas` stays
  put — there is no `Arsenic Trioxide`. Roman numerals survive: the `(V)` in
  `Potassium Heptafluoroniobate(V)` is an oxidation state, not a variant.

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
tools/locate-game.mjs         finds the installed game (Steam; itch is a stub)
tools/pck-tool.mjs            adapter over godotpcktool / GodotPCKExplorer.Console
tools/build-data.mjs          locates, extracts and bakes data/atomcraft.json
tools/bundle.mjs              inlines everything into the standalone build
tools/elements.mjs            canonical periodic table (symbols + grid layout)
tools/godot-translation.mjs   decoder for Godot .translation resources
tools/dom-shim.mjs            minimal DOM, so the UI can be tested headlessly
.githooks/pre-commit          blocks commits with a stale bundle
tools/test-*.mjs              headless tests
data/atomcraft.json           baked game data          (generated)
dist/atomcraft-explorer.html  standalone build         (generated)
```

Everything is JavaScript — source, build and tests all run on Node.

## Notes on the source data

- **Display names come from the Godot translation resources.** They are stored as
  a perfect-hash table (SMAZ-compressed values, keys kept only as 32-bit hashes),
  so `tools/godot-translation.mjs` looks up the `LocIdName` values rather than
  enumerating. 1198 of 1223 ids resolve; the rest fall back to the internal name.
  All 25 shipped locales decode — the build currently bakes `--locale en`.
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
  JSON down to 824 KB. Fields where zero is a real value (`State`, `Density`,
  `ThermalConductivity`, …) are kept.

## Tests

```sh
npm test                      # all four suites
node tools/test-formula.mjs   # parses + round-trips all 437 distinct formulas
node tools/test-search.mjs    # ranking assertions
node tools/test-render.mjs    # renders all 1795 detail panes against a DOM shim
node tools/test-bundle.mjs    # runs the standalone build with fetch() disabled
```

The DOM shim deliberately mimics browser quirks rather than smoothing them over
— `append(null)` stringifies to the text `"null"`, for instance, which is how a
real rendering bug got caught.

