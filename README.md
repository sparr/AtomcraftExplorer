# Atomcraft Explorer

A browser explorer for the material and reaction data extracted from **Atomcraft**
(`../Atomcraft.pck`). The first mode is material search — by name, by formula, or
by chemical symbol.

## Running it

```sh
npm run build            # -> dist/atomcraft-explorer.html
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

## Scripts

| | |
| --- | --- |
| `npm run build` | both steps below |
| `npm run build-data` | bake `../Atomcraft.pck` → `data/atomcraft.json` |
| `npm run bundle` | inline everything → `dist/atomcraft-explorer.html` |
| `npm test` | formula, search, render and bundle suites |
| `npm run serve` | static server for the modular version |
| `npm run clean` | remove `dist/` |

Node only — no dependencies, no bundler config, nothing to install.

Both build outputs — `data/atomcraft.json` and `dist/atomcraft-explorer.html` —
are committed, so the app runs from a fresh clone without `../Atomcraft.pck`
being present.

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
| `water` | names, formulas and descriptions |
| `Cu` | the above **and** composition — finds Chalcopyrite as well as Copper |
| `H2O` | anything whose formula contains both H and O |
| `el:Au` / `element:Au` | formula contains gold |
| `formula:SO4` | formula text |
| `name:Molten` | internal name only |
| `desc:cancer` | description text |
| `state:gas` | Solid, Liquid, Gas, Static, Plasma |
| `z:26`, `z:80-92` | proton number (also matches the element's own material) |
| `is:radioactive` | also: element, isotope, burning, mechanical, hidden, buildable, mineable, interactable, unstable, food, growing |

The **Periodic table** panel is the same filter with a click target — shading
shows how many materials contain each element.

Keys: `/` focus search, `↑`/`↓` or `j`/`k` move, `Esc` clear. The query and the
selected material live in the URL hash, so any view is linkable.

## Layout

```
index.html                    markup and panels
src/formula.js                formula parser (Al2(SO4)3, CaSO4·2H2O, (Fe,Mn)WO4, 17% Co 83% Fe)
src/data.js                   bundle loader; name/symbol/reaction/back-reference indexes
src/search.js                 query grammar and ranking
src/main.js                   UI
tools/build-data.mjs          bakes the game data into data/atomcraft.json
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
  enumerating. 1156 of 1181 ids resolve; the rest fall back to the internal name.
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
- **~40 references dangle** — mostly superheavy isotopes named as decay or impact
  products but never defined. The UI renders those as dead links rather than
  pretending they resolve.
- The baking step drops nulls, falses and default zeroes, taking 2.8 MB of raw
  JSON down to 816 KB. Fields where zero is a real value (`State`, `Density`,
  `ThermalConductivity`, …) are kept.

## Tests

```sh
npm test                      # all four suites
node tools/test-formula.mjs   # parses + round-trips all 437 distinct formulas
node tools/test-search.mjs    # ranking assertions
node tools/test-render.mjs    # renders all 1759 detail panes against a DOM shim
node tools/test-bundle.mjs    # runs the standalone build with fetch() disabled
```

The DOM shim deliberately mimics browser quirks rather than smoothing them over
— `append(null)` stringifies to the text `"null"`, for instance, which is how a
real rendering bug got caught.

