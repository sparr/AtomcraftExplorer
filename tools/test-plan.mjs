/**
 * The planner's model: the process graph and the solver over it.
 *
 * Everything here runs against the real bake rather than a fixture, because the
 * things that go wrong are properties of the game's data -- a material on both
 * sides of a reaction, a combustion list that is a weighted bag, a phase change
 * out of a wall -- and a fixture would be written from the same misreading as
 * the code.
 */
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data.js';
import { buildProcessGraph, PROCESS_KINDS, DEFAULT_KINDS,
         operatingWindow } from '../src/plan-graph.js';
import { solvePlan, balanceTargets, reachableFrom, routesFor, competitionOf, shareRatio, processCost,
         rat, radd, rsub, rmul, rdiv, rcmp, rstr, rzero, R0 } from '../src/plan-solve.js';
import { AMBIENT, convertTemperature, convertTemperatureDelta, formatTemperature,
         formatTemperatureRange, heatingNeed, coolingNeed } from '../src/units.js';

globalThis.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(readFileSync(new URL('../data/atomcraft.json', import.meta.url))),
});

const db = await loadData();
const graph = buildProcessGraph(db);

let fail = 0;
const ok = (msg) => console.log(`ok    ${msg}`);
const bad = (msg) => { console.log(`FAIL  ${msg}`); fail++; };
const check = (cond, msg) => (cond ? ok(msg) : bad(msg));

const byKind = new Map(PROCESS_KINDS.map((k) => [k.id, 0]));
for (const p of graph.processes) byKind.set(p.kind, byKind.get(p.kind) + 1);
console.log(`${graph.processes.length} processes over ${db.materials.length} materials: ` +
  [...byKind].map(([k, n]) => `${k} ${n}`).join(', ') + '\n');

/* ------------------------------------------------------------- fractions */

console.log('--- exact arithmetic ---');
check(rstr(radd(rat(1, 3n), rat(1, 6n))) === '1/2', '1/3 + 1/6 = 1/2');
check(rstr(rsub(rat(1), rat(3, 2n))) === '-1/2', '1 - 3/2 = -1/2');
check(rstr(rmul(rat(2, 3n), rat(3, 4n))) === '1/2', '2/3 × 3/4 = 1/2');
check(rstr(rdiv(rat(1), rat(3))) === '1/3', '1 ÷ 3 = 1/3');
check(rcmp(rat(1, 3n), rat(1, 4n)) === 1 && rcmp(rat(1, 4n), rat(1, 3n)) === -1, 'ordering');
// A tenth added ten times is exactly one, which is the whole reason for this.
let tenths = R0;
for (let i = 0; i < 10; i++) tenths = radd(tenths, rat(1, 10n));
check(rstr(tenths) === '1', 'ten tenths make exactly 1');

/* ---------------------------------------------------------- temperatures */

console.log('\n--- temperatures, as the game shows them ---');
// The game's own struct: Celsius => Kelvin - 273, Fahrenheit => C * 9 / 5 + 32,
// integer division throughout. Not 273.15, and not rounded the physics way.
check(convertTemperature(273) === 0 && convertTemperature(2300) === 2027, '273 K is 0 °C, 2300 K is 2027 °C');
check(convertTemperature(195) === -78, 'and it goes below zero: 195 K is -78 °C');
check(convertTemperature(273, 'K') === 273, 'kelvin passes through');
check(convertTemperature(373, 'F') === 212, 'water boils at 212 °F');
check(formatTemperature(2300) === '2027 °C', 'formatted with the game\'s own suffix');
// A change of 50 K is a change of 50 °C: the offset cancels. Sending a delta
// through the absolute conversion would read +50 K as if it had cooled by 223.
check(convertTemperatureDelta(50) === 50, 'a +50 K change is a +50 °C change');
check(convertTemperatureDelta(50, 'F') === 90, 'and a +90 °F one');
check(formatTemperatureRange(273, null) === '≥ 0 °C', 'a floor reads as a floor');
check(formatTemperatureRange(null, 973) === '≤ 700 °C', 'and a ceiling as a ceiling');
{
  // The ambient band is not a threshold below which a requirement stops
  // counting -- a chamber next to a cooled one has to be held at 0 °C.
  check(heatingNeed(2300) === 'always', 'a 2027 °C floor is a furnace, always');
  check(heatingNeed(AMBIENT.min) === 'sometimes',
        'a floor of exactly 0 °C still needs holding: heating, or insulation');
  check(heatingNeed(200) === 'none', 'a floor below anything the air reaches needs nothing');
  check(coolingNeed(195) === 'always', 'a -78 °C ceiling is a cooler, always');
  check(coolingNeed(1400) === 'none', 'a ceiling above the air needs nothing');
}

/* ------------------------------------------- a run of changes as one step */

console.log('\n--- phase chains ---');
{
  // Steam does not stop at Water on the way to Ice. Cool it far enough and it
  // goes all the way, so listing two steps describes one chamber at one
  // temperature as though it were two.
  const chain = graph.byId.get('chain:cool:Steam#2');
  check(!!chain, 'a run of changes in one direction is offered as one step');
  check(chain.label === 'Steam condenses and solidifies into Ice', `named "${chain.label}"`);
  check(chain.consumes[0].name === 'Steam' && chain.produces[0].name === 'Ice',
        'with the middle of it inside');
  check(chain.conditions.via.includes('Water'), 'though it says what it goes through');

  // The limit is the tightest of the parts: past every threshold on the way.
  const steam = graph.byId.get('cond:Steam').conditions.maxTemperature;
  const water = graph.byId.get('cond:Water').conditions.maxTemperature;
  check(chain.conditions.maxTemperature === Math.min(steam, water),
        `and it must be under the lower of the two (${chain.conditions.maxTemperature} K, ` +
        `from ${steam} K and ${water} K)`);

  // Its own hops are not side effects of itself.
  check(!chain.window.unavoidable.length,
        'a chain is not accused of setting off the very changes it is made of');

  const plan = solvePlan(graph, { targets: ['Ice'], have: ['Steam'] });
  check(plan.steps.length === 1 && plan.steps[0].process.id === chain.id,
        'so cooling steam to ice is one step by default');
  const routes = routesFor(plan, 'Ice');
  check(routes.some((r) => r.process.id === 'cond:Water'),
        'and stopping at water is still there to be chosen');
  const split = solvePlan(graph, { targets: ['Ice'], have: ['Steam'],
                                   pins: { Ice: 'cond:Water' } });
  check(split.steps.some((s) => s.process.id === 'cond:Water'),
        'choosing it freezes water instead');
  check(!split.steps.some((s) => s.process.id === chain.id), 'and the chain is not used');
  // Water is collectable, so stopping at it costs a fetch rather than a step.
  check(split.frontier.some((f) => f.name === 'Water'),
        'though the water then has to come from somewhere: it is collected');
}

/* ------------------------------------------------- taking the water out */

console.log('\n--- water filters ---');
{
  // Neither filter block appears in the reaction list. The rule is in their
  // OnImpact: a Composition of exactly two parts, one of them the `+H2O`
  // marker, comes apart into the other part and water.
  const filters = graph.processes.filter((p) => p.kind === 'filter');
  check(filters.length === 69, `${filters.length} materials can be split this way`);
  check(filters.every((p) => p.consumes.length === 1 &&
        p.produces.some((o) => o.name === 'Water')), 'each gives back water');
  // One tile in, one of each out. The code sets two tiles and never reads the
  // counts the composition states.
  check(filters.every((p) => p.consumes[0].count === 1 &&
        p.produces.every((o) => o.count === 1)),
        'one tile in, one tile of each out, whatever the composition says');

  const milk = graph.byId.get('filter:Milk');
  check(milk?.produces.some((o) => o.name === 'Cream'), 'milk comes apart into cream and water');
  check(graph.producers('Cream').length === 1,
        'which is the only way to get cream: no reaction makes any');

  // Exactly two parts. Seven aqueous materials have three or four and pass
  // through untouched -- the game's rule, not a simplification here.
  check(!graph.byId.get('filter:Aqueous Zinc Sulfate'),
        'a composition of three parts is not something the filter takes apart');
  const zinc = graph.db.byName.get('Aqueous Zinc Sulfate').raw.Composition.Elements;
  check(zinc.length === 3 && zinc.some((e) => e.Item1 === '+H2O'),
        `even though it is aqueous (${zinc.map((e) => e.Item1).join(' + ')})`);

  // The block is apparatus, like any other catalyst, and either one will do.
  check(milk.conditions.catalysts[0].name === 'Water Filter' &&
        milk.conditions.eitherFilter === 'Block Water',
        'it needs a filter block standing there, either kind');
  check(!milk.consumes.some((i) => /Filter|Block Water/.test(i.name)),
        'which is not consumed');

  const butter = solvePlan(graph, { targets: ['Butter'] });
  check(butter.steps.length === 2 &&
        butter.steps.some((s) => s.process.kind === 'filter'),
        `and butter becomes plannable through it: ${butter.steps.map((s) =>
          s.process.label).join(' ; ')}`);
}

/* --------------------------------------------------- how slow is too slow */

console.log('\n--- a per-tick gate is a rate, not an obstacle ---');
{
  // The Probability divisor has two populations far apart: reactions carry 4
  // to 10000, phase changes 2e6 to 6.4e7. Charging half a point per decade
  // from zero put a full point on a one-in-a-hundred reaction, which is what
  // had the planner send you out for a mushroom to evaporate rather than use
  // the carbon monoxide already in your hand.
  const plan = solvePlan(graph, { targets: ['Carbon'], have: ['Carbon Monoxide'] });
  check(plan.steps.length === 1 &&
        plan.steps[0].process.id === 'rx:Boudouard Equilibrium 500-725K',
        `carbon monoxide is turned straight into carbon (${plan.steps.map((s) =>
          s.process.label).join('; ')})`);
  check(!plan.frontier.length, 'with nothing to go and find');

  // The gate on a phase change is still worth something: those are millions.
  const brisk = processCost(graph.byId.get('rx:Boudouard Equilibrium 500-725K'));
  const rare = graph.processes.find((p) => p.conditions.probability > 1e6);
  check(processCost(rare) > brisk,
        `while a one-in-${rare.conditions.probability} phase change still counts as a wait`);
}

/* ----------------------------------------------------- what the sky gives */

console.log('\n--- materials the weather delivers ---');
{
  // Nothing in the material list says water is collectable. It is in the
  // simulation's weather branch: a Rainstorm sets tiles to Materials.WATER and
  // a Snowstorm to Materials.SNOW_FALLING. Without that the planner inferred
  // "raw" from the absence of a recipe -- so it understood Falling Snow, which
  // nothing makes, and thought water, with 77 ways to make it, had to be
  // manufactured.
  check(graph.fallsFromSky('Water') && graph.fallsFromSky('Falling Snow'),
        'rain and snow are known to fall');
  check(!graph.fallsFromSky('Sulfuric Acid') && !graph.fallsFromSky('Coal (Burning)'),
        'while acid rain and firestorms, which only the developer console starts, are not');
  // "Snow" is a different material that merely displays as "Falling Snow".
  check(!graph.fallsFromSky('Snow'), 'and it is the material named Falling Snow, not the one shown as it');

  const water = solvePlan(graph, { targets: ['Water'] });
  check(!water.steps.length && water.frontier.some((f) => f.name === 'Water'),
        `asking for water is answered by going outside (${water.steps.length} steps)`);

  let snow = 0;
  for (const m of graph.db.materials) {
    if (solvePlan(graph, { targets: [m.name] }).frontier.some((f) => f.name === 'Falling Snow')) snow++;
  }
  check(snow <= 1, `and hardly any plan fetches snow to melt any more (${snow} of ${graph.db.materials.length})`);
}

/* --------------------------------------------------- naming what happens */

console.log('\n--- phase changes are named for what they are ---');
{
  // The game keeps one field for going up in temperature and one for coming
  // down, and calls them evaporation and condensation whatever the states.
  // Most are not: 287 of them are a solid melting.
  const named = (id) => graph.byId.get(id)?.label;
  check(named('evap:Alumina') === 'Alumina melts into Molten Alumina',
        'a solid going to liquid melts');
  check(named('evap:Water') === 'Water evaporates into Steam',
        'a liquid going to gas still evaporates');
  check(named('cond:Water') === 'Water solidifies into Ice',
        'a liquid going to solid solidifies');
  check(named('cond:Steam') === 'Steam condenses into Water',
        'and a gas going to liquid still condenses');
  const verbs = new Map();
  for (const p of graph.processes) {
    if (p.kind !== 'phase') continue;
    const v = p.label.match(/ (\w+) into /);
    if (v) verbs.set(v[1], (verbs.get(v[1]) || 0) + 1);
  }
  check((verbs.get('melts') || 0) > (verbs.get('evaporates') || 0),
        `melting is the commonest of them (${verbs.get('melts')} against ` +
        `${verbs.get('evaporates')} that really evaporate)`);
}

/* ----------------------------------------------------------------- graph */

console.log('\n--- the process graph ---');
{
  // 9 Fallen Leaf in, 7 back out: only the difference is really consumed.
  const p = graph.byId.get('rx:Compost from Fallen Leaves');
  const consumed = p.consumes.find((c) => c.name === 'Fallen Leaf');
  check(consumed?.count === 2, 'a material on both sides nets to what is really used');
  check(!p.produces.some((o) => o.name === 'Fallen Leaf'),
        'and it is not also counted as a product');
}
{
  // Ethanol (Burning) lists Carbon Dioxide three times and Steam twice, and the
  // game indexes that array at random -- so a repeat is a weight.
  const p = graph.byId.get('burn:Ethanol (Burning)');
  const co2 = p.produces.find((o) => o.name === 'Carbon Dioxide');
  const steam = p.produces.find((o) => o.name === 'Steam');
  check(p.consumes[0].count === 5 && co2.count === 3 && steam.count === 2,
        'a repeated combustion product reads as a ratio, 5 burn to 3 and 2');
  check(p.conditions.stochastic, 'and the process says its yield is a random draw');
  const odds = new Map(p.conditions.outcomes.map((o) => [o.name, o.chance]));
  check(Math.abs(odds.get('Carbon Dioxide') - 0.6) < 1e-9 && Math.abs(odds.get('Steam') - 0.4) < 1e-9,
        'with each outcome carrying its own probability, 60% and 40%');
  check(p.conditions.outcomes.reduce((a, o) => a + o.chance, 0) - 1 < 1e-9,
        'and the chances sum to one');
}
{
  // DropTable repeats each material by its rate and rolls uniformly over the
  // array, so the rates are relative weights out of their own sum -- not
  // chances out of a thousand, which would make a Bowieite Deposit's three
  // sulfides 0.01% each.
  const p = graph.byId.get('drop:Granite');
  check(p.consumes[0].count === 6007, 'a drop table sums its own weights: 6007 Granite per roll');
  check(p.produces.find((o) => o.name === 'Ruby').count === 2, 'and 2 of those give a Ruby');
  const bow = graph.byId.get('drop:Bowieite Deposit');
  check(bow.produces.length === 3 && bow.consumes[0].count === 3,
        'a deposit whose rates are 1, 1, 1 drops one of its three, not one in a thousand');
  check(graph.processes.filter((x) => x.id.startsWith('drop:Granite')).length === 1,
        'one roll per swing, so one process per drop table rather than one per product');
}
{
  const p = graph.processes.find((x) => x.id.startsWith('grow:') && x.requires.length);
  check(p && !p.consumes.length && p.requires.length === 1 && p.produces.length === 1,
        'a growing plant is required, not consumed');
}
check(!graph.processes.some((p) => [...p.consumes, ...p.produces, ...p.requires]
        .some((x) => x.name === '+H2O')),
      'the +H2O hydration marker is not a material');
{
  // 131 display names belong to more than one material, so a process label
  // built from display names can come out as "Berry mines into Berry" -- true,
  // and no use to anyone. The label identifies its subject on its own.
  check(graph.db.byName.get('Berry Bush Berry 2_1').label === 'Berry Bush Berry 2_1',
        'a material sharing its display name is labelled by its internal one');
  check(graph.db.byName.get('Water').label === 'Water',
        'while an unambiguous one keeps the name people read');
  const berry = graph.producers('Berry').find((p) => p.id.startsWith('mine:'));
  check(berry && !/^Berry mines into/.test(berry.label),
        `and the route says which bush: "${berry?.label}"`);
  // Both ends of a label have to name their material the same way, or a real
  // transformation reads as a no-op: "Reversible Conveyor Left builds into
  // Reversible Conveyor Left" is two different machines.
  // Growth is exempt: a plant putting out another segment of itself is what
  // "Kelp Stalk grows Kelp Stalk" means, and it is true.
  const saysNothing = graph.processes.filter((p) => {
    if (p.kind === 'grow') return false;
    const m = p.label.match(/^(.+?) (?:melts|evaporates|sublimates|ionises|solidifies|condenses|freezes|recombines|turns|ignites|burns|extinguishes|decays|mines|builds|is picked up as|dissolves|turns on|turns off|rotates left|rotates right) (?:into |as )?(.+)$/);
    return m && m[1] === m[2];
  });
  check(!saysNothing.length,
        `no label reads as turning something into itself${saysNothing.length ? ': ' + saysNothing[0].label : ''}`);
}
check(graph.processes.every((p) => p.produces.length),
      'every process makes something (spontaneous fission makes nothing and is dropped)');
{
  const ids = new Set(graph.processes.map((p) => p.id));
  check(ids.size === graph.processes.length, 'process ids are unique');
}
{
  // Every name a process mentions has to resolve, or the graph has dead ends
  // the solver would silently treat as unobtainable.
  const missing = new Set();
  for (const p of graph.processes) {
    for (const { name } of [...p.consumes, ...p.produces, ...p.requires]) {
      if (!db.byName.has(name) && !db.isDangling(name)) missing.add(name);
    }
  }
  check(!missing.size, `every referenced material resolves${missing.size ? ': ' + [...missing].slice(0, 5) : ''}`);
}

/* ------------------------------------------------------- what a plan says */

/** Assert the arithmetic of a solved plan holds together. */
function audit(label, plan) {
  const bad_ = (why) => bad(`${label}: ${why}`);
  let good = true;

  // Whole-numbered batch: the scale exists precisely to clear denominators.
  for (const { process: p, runs } of plan.steps) {
    if (runs.d !== 1n) { bad_(`${p.id} runs ${rstr(runs)} times after scaling`); good = false; }
    if (runs.n <= 0n) { bad_(`${p.id} is in the plan but never runs`); good = false; }
  }

  // Nothing is consumed that is not either produced, held, or on the shopping
  // list -- the plan has to account for every unit it spends.
  const listed = new Map(plan.frontier.map((f) => [f.name, f.amount]));
  for (const node of plan.dag.materials.values()) {
    const need = plan.amountOf(node.name);
    if (rcmp(need, R0) <= 0) continue;
    const have = plan.spec.have.has(node.name);
    const from = radd(plan.madeOf(node.name), listed.get(node.name) || R0);
    if (!have && rcmp(from, need) < 0) {
      bad_(`${node.name} needs ${rstr(need)} but only ${rstr(from)} is accounted for`);
      good = false;
    }
  }

  // Targets are made, not fetched.
  for (const t of plan.spec.targets) {
    if (plan.unreachable.includes(t.name)) continue;
    if (rcmp(plan.madeOf(t.name), rmul(rat(t.amount), plan.scale)) < 0) {
      bad_(`target ${t.name} is short`); good = false;
    }
  }

  if (plan.stuck.length) { bad_(`${plan.stuck.length} nodes could not be ordered`); good = false; }
  if (good) ok(`${label}: ${plan.steps.length} steps, ${plan.frontier.length} to fetch, ` +
               `${plan.byproducts.length} spare, batch ×${rstr(plan.scale)}`);
  return good;
}

console.log('\n--- worked plans ---');
const vinegar = solvePlan(graph, { targets: ['Vinegar'] });
audit('Vinegar', vinegar);
check(vinegar.steps.some((s) => s.process.id === 'rx:Acetic Acid + Water = Vinegar'),
      'the Vinegar plan ends with the reaction that makes Vinegar');
check(!vinegar.unreachable.length, 'Vinegar is reachable, though nothing makes Acetic Acid but fermentation');

const alu = solvePlan(graph, { targets: [{ name: 'Molten Aluminum', amount: 2 }] });
audit('Molten Aluminum ×2', alu);
check(!alu.dag.materials.has('Aluminum Wall (Turning Off)'),
      'no plan melts a wall down for its metal');

const acid = solvePlan(graph, { targets: ['Sulfuric Acid'], have: ['Water'] });
audit('Sulfuric Acid with water on tap', acid);
check(!acid.frontier.some((f) => f.name === 'Water'), 'water the reader has is not on the shopping list');

/* ------------------------------------------------- the reader overrules it */

console.log('\n--- choices ---');
{
  const before = solvePlan(graph, { targets: ['Steam'] });
  const chosen = before.dag.materials.get('Steam').producer;
  check(!!chosen, `Steam is made by one of its ${graph.producers('Steam').length} producers (${chosen})`);

  const banned = solvePlan(graph, { targets: ['Steam'], excludeProcesses: [chosen] });
  check(banned.dag.materials.get('Steam').producer !== chosen,
        'excluding that producer picks a different one');
  audit('Steam with its first choice banned', banned);

  const pinned = solvePlan(graph, { targets: ['Steam'], pins: { Steam: 'evap:Water' } });
  check(pinned.dag.materials.get('Steam').producer === 'evap:Water',
        'pinning a producer overrides the search');
  check(pinned.dag.materials.has('Water'), 'and pulls its input into the plan');
  audit('Steam pinned to boiling water', pinned);

  const stopped = solvePlan(graph, { targets: ['Steam'], pins: { Steam: 'evap:Water', Water: 'have' } });
  check(stopped.dag.materials.get('Water').reason === 'have',
        'pinning a material to "have" stops the plan there');
}
{
  // A pin can point at a process that needs what it makes. That is a loop, and
  // it has to be reported rather than hung on.
  const loop = solvePlan(graph, {
    targets: ['Water'],
    pins: { Water: 'cond:Steam', Steam: 'evap:Water' },
  });
  check(loop.cycles.length > 0, `a circular pin is detected and broken (at ${loop.cycles.join(', ')})`);
  check(!loop.stuck.length, 'and the rest of the plan still orders');
}
{
  const ex = solvePlan(graph, { targets: ['Vinegar'], excludeMaterials: ['Berry'] });
  check(!ex.dag.materials.has('Berry') || ex.dag.materials.get('Berry').reason !== 'produced',
        'an excluded material is kept out of the plan');
}

/* ---------------------------------------------------- what you can hold */

console.log('\n--- portability ---');
{
  // A Static thing that is not simply lying about outside exists only where it
  // was placed. It can be made, and eaten in place by the 20 reactions that
  // dissolve walls, but it can never be supplied as stock.
  const isPlaced = (name) => graph.stateOf(name) === 'Static' &&
    !['deposit', 'terrain', 'plant'].includes(graph.categoryOf(name));
  check(isPlaced('Aluminum Wall (Turning Off)'), 'a wall counts as placed');
  check(!isPlaced('Bauxite Deposit'), 'a deposit does not: the world put it there');

  let leaked = null;
  for (const name of ['Molten Aluminum', 'Molten Iron', 'Molten Copper', 'Rust', 'Glass',
                      'Molten Nickel', 'Molten Zinc', 'Steel']) {
    const plan = solvePlan(graph, { targets: [name] });
    for (const node of plan.dag.materials.values()) {
      if (node.reason !== 'produced' && node.reason !== 'have' && isPlaced(node.name)) {
        leaked = `${name} would have you fetch ${node.name}`;
      }
    }
  }
  check(!leaked, `no metal is planned by dissolving something built${leaked ? ': ' + leaked : ''}`);

  // The portable half of the same problem. `Aluminum Wire` is the item you
  // carry to place a wire: Solid, so not caught by staticness, but got only by
  // picking a placed wire back up. Melting one down for aluminium is only
  // sensible if you already had the wire.
  check(graph.isManufactured('Aluminum Wire') && graph.stateOf('Aluminum Wire') === 'Solid',
        'a machine item is portable but still manufactured');
  let scrapped = null;
  for (const name of ['Molten Aluminum', 'Molten Copper', 'Molten Iron', 'Molten Zinc']) {
    for (const f of solvePlan(graph, { targets: [name] }).frontier) {
      if (graph.isManufactured(f.name)) scrapped = `${name} would have you fetch ${f.name}`;
    }
  }
  check(!scrapped, `and no plan asks you to fetch one as stock${scrapped ? ': ' + scrapped : ''}`);

  // It is still usable once the plan builds it, so the route is disqualified
  // for being unfetchable rather than being cut out of the graph.
  check(graph.producers('Molten Aluminum').some((p) => p.id === 'evap:Aluminum Wall (Turning Off)'),
        'and the route is still in the graph, merely unreachable');
}

/* ------------------------------------------------------- placing by hand */

console.log('\n--- placing things ---');
{
  // No machine builds a wall; somebody puts it there. So BuildsInto is never a
  // way through to something else, but it is shown when the wall is the point.
  const wall = solvePlan(graph, { targets: ['Iron Wall'] });
  check(!wall.unreachable.length, 'a wall can be planned, though only a player can place one');
  const last = wall.steps[wall.steps.length - 1];
  check(last?.process.conditions.places, 'and placing it is the last step');
  check(wall.steps.slice(0, -1).every((s) => !s.process.conditions.places),
        'with no placing anywhere else in it');
  check(wall.apparatus.byHand, 'the apparatus line says you do it yourself');
  check(!wall.spec.kinds.has('handling'),
        'and it happened with handling switched off, because it was asked for');

  // Iron is a step on the way to an Iron Wall, so it must not itself become a
  // wall en route.
  const iron = solvePlan(graph, { targets: ['Iron'] });
  check(!iron.steps.some((s) => s.process.conditions.places),
        'a plan for loose iron places nothing');
  check(!iron.dag.materials.has('Iron Wall'), 'and never walls itself in as an intermediate');
}
{
  // Wall to wall, and only when a wall is the point. `Clay Wall into Ceramic
  // Wall` reacts one placed thing into another, so getting there means placing
  // the Clay Wall first -- a mid-plan placement, allowed because the end
  // product is itself something you build.
  const direct = 'BuildsInto:Ceramic';
  const viaWall = solvePlan(graph, { targets: ['Ceramic Wall'], excludeProcesses: [direct] });
  check(!viaWall.unreachable.length, 'a Ceramic Wall can be reached through a Clay Wall');
  check(viaWall.steps.some((s) => s.process.id === 'BuildsInto:Clay'),
        'placing the Clay Wall mid-plan');
  check(viaWall.steps.some((s) => s.process.id === 'rx:Clay Wall into Ceramic Wall'),
        'and reacting one wall into the other');

  // The same placement must stay out of a plan that is not a building job.
  const loose = solvePlan(graph, { targets: ['Ceramic'] });
  check(!loose.steps.some((s) => s.process.conditions.places),
        'while a plan for loose Ceramic places nothing at all');
  check(!solvePlan(graph, { targets: ['Clay'] }).dag.materials.has('Clay Wall'),
        'and no wall appears on the way to loose Clay');
}
{
  // Placing works, so the solver could always reach for it. It should not:
  // ice is water that froze, not a block you carried in.
  const ice = solvePlan(graph, { targets: ['Ice'] });
  check(ice.steps.some((s) => s.process.id === 'cond:Water'),
        'ice is planned by freezing water');
  check(!ice.steps.some((s) => s.process.conditions.places),
        'not by placing a block of it, though the game would take either');
  // And freezing is a ceiling, not a floor: it happens on the way *down*.
  const freeze = graph.byId.get('cond:Water');
  check(!freeze.conditions.temperature && freeze.conditions.maxTemperature === 272,
        'condensation records a ceiling, so nothing fires a furnace to freeze something');
  check(ice.apparatus.cooling === 'always' && ice.apparatus.lowestCeiling === 272,
        'and the plan asks for cooling below -1 °C');
}

/* ------------------------------------------------- keeping to one reaction */

console.log('\n--- side reactions ---');
{
  // The chamber holds the inputs, the outputs and the catalyst at once, and
  // those are the ingredients of other reactions. Vinegar is the worked
  // example: stated at 0 °C and up, but the water boils at 125 °C.
  const p = graph.byId.get('rx:Acetic Acid + Water = Vinegar');
  check(p.conditions.temperature === 273 && p.conditions.maxTemperature === undefined,
        'the game states this one as 0 °C and up, with no ceiling');
  check(graph.db.byName.get('Water').raw.Evaporation.Temperature === 398,
        'water in this game boils at 125 °C, not 100');
  check(p.window.lo === 273 && p.window.hi === 397,
        `so the range you can really run it at is 0–124 °C (got ${p.window.lo}–${p.window.hi} K)`);
  check(p.window.avoided.some((a) => a.id === 'evap:Water'),
        'and what closes it off is the water boiling away');
  check(p.window.narrowed, 'and the window says it was narrowed');

  const off = operatingWindow(p, false);
  check(off.lo === 273 && off.hi === Infinity && !off.narrowed,
        'with the constraint off, the stated range comes back');
}
{
  // Evaporating and condensing happen at *different* temperatures: the game
  // separates them to stand in for latent heat and to stop a material
  // flickering between phases. 129 of the 130 reciprocal pairs differ, by up to
  // 1100 K, so neither direction may ever be read off the other.
  const water = graph.db.byName.get('Water').raw;
  const steam = graph.db.byName.get('Steam').raw;
  check(water.Evaporation.Temperature === 398 && steam.Condensation.Temperature === 298,
        'water boils at 125 °C but steam condenses back at 25 °C, 100 K apart');
  check(graph.byId.get('evap:Water').conditions.temperature === 398 &&
        graph.byId.get('cond:Steam').conditions.maxTemperature === 298,
        'and each process carries its own end of that, as a floor and a ceiling');

  let borrowed = null;
  for (const m of graph.db.materials) {
    const ev = m.raw.Evaporation;
    const up = ev?.TargetMaterialName && graph.db.byName.get(ev.TargetMaterialName);
    if (up?.raw.Condensation?.TargetMaterialName !== m.name) continue;
    const rise = graph.byId.get(`evap:${m.name}`)?.conditions.temperature;
    const fall = graph.byId.get(`cond:${up.name}`)?.conditions.maxTemperature;
    if (rise !== (ev.Temperature ?? 0) || fall !== (up.raw.Condensation.Temperature ?? 0)) {
      borrowed = m.name;
    }
  }
  check(!borrowed, `no pair takes its temperature from the other direction${borrowed ? ': ' + borrowed : ''}`);

  // Which is what makes this reaction's real floor 26 °C rather than the 10 °C
  // it states: below that the steam it needs has turned back into water. Read
  // off water's boiling point instead and it would come out at 125 °C.
  const acid = graph.byId.get('rx:Sulfur Trioxide Gas + Steam');
  check(acid.conditions.temperature === 283 && acid.window.lo === 299,
        `steam-bearing reactions get a floor from steam condensing (${acid.window.lo} K)`);
  check(acid.window.avoided.some((a) => a.id === 'cond:Steam'), 'and say so');

  // Bismuth is the one inverted pair -- it evaporates at 540 K and condenses at
  // 543 K, so between those it would flip back and forth. Each direction dodges
  // the overlap rather than sitting in it.
  check(graph.byId.get('evap:Bismuth').window.lo === 544 &&
        graph.byId.get('cond:Molten Bismuth').window.hi === 539,
        'the one overlapping pair steps around its own 3 K flicker zone');
}
{
  // Never wider than what the game states, whatever the analysis concludes.
  let bad_ = null;
  for (const p of graph.processes) {
    const w = p.window;
    if (w.lo < w.base[0] || w.hi > w.base[1]) bad_ = p.id;
    if (w.lo > w.hi) bad_ = `${p.id} (empty)`;
  }
  check(!bad_, `no window escapes its stated range or closes entirely${bad_ ? ': ' + bad_ : ''}`);

  const narrowed = graph.processes.filter((p) => p.window.narrowed);
  const stuck2 = graph.processes.filter((p) => p.window.unavoidable.length);
  console.log(`      ${narrowed.length} processes narrowed, ${stuck2.length} with a side ` +
              'reaction no temperature dodges');
}
{
  // A process gated on something the chamber has not got cannot go off in it.
  // Without this, every reaction touching water reads as if Electrolysis of
  // Water were running in it.
  const p = graph.byId.get('rx:Acetic Acid + Water = Vinegar');
  const named = (w) => [...w.avoided, ...w.unavoidable].map((e) => e.id);
  check(!named(p.window).includes('rx:Electrolysis of Water'),
        'electrolysis does not happen unless a current is applied');
  const electro = graph.byId.get('rx:Electrolysis of Water');
  check(electro.conditions.electrolysis, 'though the reaction is there in the graph');
  // Same for a catalyst: Blending needs a Blender standing in the chamber.
  const blend = graph.byId.get('rx:Blending Apatite Gravel');
  const water = graph.processes.find((q) => q.kind === 'reaction' &&
    q.consumes.some((c) => c.name === 'Water') && !(q.conditions.catalysts || []).length &&
    !q.conditions.electrolysis);
  check(!named(water.window).some((id) => (graph.byId.get(id)?.conditions.catalysts || []).length),
        'and a catalysed reaction needs its catalyst present');
  check(blend.conditions.catalysts.length === 1, 'which Blending Apatite Gravel has');
}
{
  // A cut that would leave nowhere to run is not applied: the side reaction is
  // unavoidable, which is worth saying rather than declaring the step
  // impossible. Alumina Reduction runs at 2027 °C, well past alumina's melting
  // point, so of course the alumina melts.
  const p = graph.byId.get('rx:Alumina Reduction');
  check(p.window.unavoidable.length > 0,
        `Alumina Reduction cannot dodge ${p.window.unavoidable.map((u) => u.label).join(', ')}`);
  check(p.window.lo === p.conditions.temperature,
        'and its stated range is left alone rather than emptied');
}
{
  const on = solvePlan(graph, { targets: ['Vinegar'] });
  check(on.spec.avoidSideEffects, 'a plan avoids side reactions by default');
  const step = on.steps.find((s) => s.process.id === 'rx:Acetic Acid + Water = Vinegar');
  check(step.window.hi === 397, 'so the step carries the narrowed ceiling');
  // The tightest ceiling in this plan is not that step's: blending the spores
  // has to stay under 101 °C or they turn to carbon instead of yeast.
  check(on.apparatus.lowestCeiling === 374 && on.apparatus.narrowedBySideEffects,
        'and the plan reports the tightest ceiling of any of its steps');
  check(on.apparatus.hottestFloor === 273,
        'alongside the hottest floor, which is a different step and a different chamber');

  const off = solvePlan(graph, { targets: ['Vinegar'], avoidSideEffects: false });
  const same = off.steps.find((s) => s.process.id === 'rx:Acetic Acid + Water = Vinegar');
  check(same.window.hi === Infinity, 'switching it off restores the stated range');
  check(!off.sideEffects.length, 'and stops reporting side reactions at all');

  // Wine turning into Vinegar is the point of the next step along, so it is
  // reported as something the plan wants rather than as a hazard.
  const wine = on.sideEffects.find((e) => e.id === 'rx:Wine into Vinegar');
  check(wine && wine.inPlan, 'a side reaction the plan wants elsewhere is marked as such');
  check(on.sideEffects.some((e) => !e.inPlan), 'while the genuinely unwanted ones are not');
}

/* --------------------------------------------------------- sharing a feed */

console.log('\n--- reactions competing for the same feed ---');
{
  // A tile runs the first reaction in its own list that is valid this tick and
  // then stops. The list belongs to the material, so the rivals are the ones
  // sharing a PrimaryInput -- and most carry a 1-in-P gate, which is what lets
  // the later ones get a look in at all.
  const potassium = graph.byId.get('rx:Lepidolite Decomposition - Potassium');
  const split = competitionOf(potassium);
  check(split?.length === 3, 'Lepidolite has three decompositions on one feed');
  check(split.every((m) => m.k === 1 && m.of === 3),
        `gated at 51, 52 and 50, so one in three each (${split.map((m) =>
          (m.chance * 100).toFixed(1) + '%').join(', ')})`);

  // A rival needing this one's *products* is a later event in the same
  // chamber, not a competitor for the same tick.
  const antimony = graph.byId.get('rx:Antimony Pentafluoride + Water');
  const rivalsOf = (p) => (competitionOf(p) || []).map((m) => m.id);
  check(!rivalsOf(antimony).includes('rx:Antimony Pentafluoride + Hydrofluoric Acid'),
        'a reaction that runs on what this one makes is not competing for the feed');

  // An ungated rival ahead of it takes everything, so it never runs at all.
  const dead = graph.byId.get('rx:Zinc Chloride Hydrolysis');
  check(competitionOf(dead) === null, 'a reaction nothing ever leaves a turn for is not a route');
  const cannot = solvePlan(graph, { targets: ['Hydrochloric Acid'] });
  check(!cannot.steps.some((s) => s.process.id === dead.id),
        'and no plan routes through it');
}
{
  // The whole point: the feed is divided, so you need more of it and you get
  // the other reactions' products whether you asked for them or not.
  const plan = solvePlan(graph, { targets: ['Potassium'], have: ['Lepidolite'] });
  const ids = plan.steps.map((s) => s.process.id);
  check(ids.includes('rx:Lepidolite Decomposition - Lithium') &&
        ids.includes('rx:Lepidolite Decomposition'),
        'the two reactions sharing the chamber are steps of the plan');
  check(plan.steps.filter((s) => s.sharesWith).length === 2,
        'marked as sharing rather than chosen');
  // One chamber doing three things is read as one chamber doing three things.
  const at = plan.steps.findIndex((s) => s.process.id === 'rx:Lepidolite Decomposition - Potassium');
  check(plan.steps[at + 1]?.sharesWith && plan.steps[at + 2]?.sharesWith,
        'listed right after the reaction they share with, not wherever the sort put them');
  check(rstr(plan.amountOf('Lepidolite')) === '3',
        `three ore in for one reaction's worth out (${rstr(plan.amountOf('Lepidolite'))})`);
  const spare = plan.byproducts.map((b) => b.name);
  check(spare.includes('Molten Lithium Oxide') && spare.includes('Molten Alumina'),
        'and the lithium and the alumina are left over, as they would be');
  audit('Potassium from Lepidolite', plan);
}

/* ------------------------------------------------- what it cannot supply */

console.log('\n--- a shortfall is a shortfall ---');
{
  // A material can be seen coming out of a step before anything is known to
  // want it, and it used to keep that "byproduct" label even once something
  // did -- so a plan four Steam short reported nothing to fetch at all, and
  // anything comparing plans by their shopping lists was comparing a lie.
  const plan = solvePlan(graph, { targets: ['Potassium', 'Lithium', 'Water'],
                                  have: ['Lepidolite'] });
  for (const node of plan.dag.materials.values()) {
    const gap = rsub(plan.amountOf(node.name), plan.madeOf(node.name));
    if (rcmp(gap, R0) <= 0) continue;
    if (plan.spec.have.has(node.name)) continue;
    const listed = plan.frontier.find((f) => f.name === node.name);
    if (!listed) { bad(`${node.name} is ${rstr(gap)} short and not on the shopping list`); break; }
  }
  ok('everything the plan is short of reaches the shopping list');

  // And with that true, wanting the water no longer sends the planner after
  // snow to melt -- water falls from the sky, so it is simply collected.
  check(!plan.frontier.some((f) => f.name === 'Falling Snow'),
        'and no snow is fetched to be melted into water');
}

/* ------------------------------------------------------------ closed loops */

console.log('\n--- a material that comes back ---');
{
  // Chlorine goes into the hydrochloric acid and comes straight back out of
  // the lithium electrolysis, in the same amount. Over a cycle the plan needs
  // none of it -- but it cannot turn over without some to begin with.
  const plan = solvePlan(graph, { targets: ['Potassium', 'Lithium'], have: ['Lepidolite'] });
  check(!plan.steps.some((s) => s.process.id === 'rx:Vanadinite Decomposition'),
        'nothing is fetched to make a material the plan already hands back');
  check(!plan.frontier.length,
        `so there is nothing to fetch at all (${plan.frontier.map((f) => f.name).join(', ')})`);

  const primed = plan.priming.map((x) => x.name);
  check(primed.includes('Chlorine Gas'), `the chlorine is a priming charge instead: ${primed}`);
  const cl = plan.priming.find((x) => x.name === 'Chlorine Gas');
  check(rstr(cl.amount) === '1', 'of exactly what the loop is short of');
  check(primed.length === 1,
        'and it is the only charge, every other loop having been broken with a step');
  check(rcmp(plan.madeOf('Chlorine Gas'), plan.amountOf('Chlorine Gas')) >= 0,
        'and the plan makes back everything it takes');

  // Steam is used and made too, but made first, so nothing has to be laid in.
  check(!primed.includes('Steam'),
        'a byproduct made before it is wanted needs no priming');

  // Nor does hydrogen, though it is used before it is *listed* as being made.
  // Nothing forces that order: the potassium hydroxide can be electrolysed for
  // it long before the acid is wanted, which is why this is a question about
  // whether some order works rather than a walk down the printed one.
  check(!primed.includes('Hydrogen Gas'),
        'nor one that could simply be made earlier');

  // Insisting that a material stay on its loop brings its charge back.
  const stuckWith = solvePlan(graph, { targets: ['Potassium', 'Lithium'],
                                       have: ['Lepidolite'], credit: ['Water'] });
  check(stuckWith.priming.some((x) => x.name === 'Water'),
        'asking for a material to be fed back brings its charge with it');

  // Not every loop can be broken, and a trial that makes things worse is not
  // taken: refusing the chlorine sends the planner back to fetching Vanadinite.
  const noCl = solvePlan(graph, { targets: ['Potassium', 'Lithium'],
                                  have: ['Lepidolite'], noFeedBack: ['Chlorine Gas'] });
  check(noCl.frontier.length > plan.frontier.length,
        'refusing the chlorine costs a shopping list, which is why it was left alone');

  // A step traded for a charge, on a plan where that still comes up: the steam
  // for Boron Oxide is made rather than taken off its own loop.
  const traded = solvePlan(graph, { targets: ['Boron Oxide'] });
  check(traded.brokenLoops.includes('Steam'),
        `a loop broken with a step: ${traded.brokenLoops.join(', ')}`);
  const held = solvePlan(graph, { targets: ['Boron Oxide'], credit: ['Steam'] });
  check(held.priming.some((x) => x.name === 'Steam'),
        'and left on its loop it wants laying in instead');
  check(held.steps.length < traded.steps.length,
        `which is the step it saves (${held.steps.length} against ${traded.steps.length})`);

  const off = solvePlan(graph, { targets: ['Potassium', 'Lithium'], have: ['Lepidolite'],
                                 feedBackAll: false });
  check(off.frontier.some((f) => f.name === 'Vanadinite'),
        'while a plan told to feed nothing back goes and fetches Vanadinite for it');
  check(off.steps.length > plan.steps.length,
        `and is longer for it (${off.steps.length} steps against ${plan.steps.length})`);
  audit('Potassium and Lithium from Lepidolite', plan);
}

/* ------------------------------------------------------- what can be moved */

console.log('\n--- working where a thing lies ---');
{
  // A deposit is Static: you cannot pipe it into a furnace, you go and heat it
  // in the ground. The game allows that and it is nobody's production line, so
  // the ore route has to win wherever there is one.
  const melt = graph.byId.get('evap:Corundum Deposit');
  check(melt?.inPlace, 'melting a deposit counts as working on it where it lies');
  check(!graph.byId.get('rx:Alumina Reduction').inPlace,
        'while a reaction between loose materials does not');
  check(!graph.processes.some((p) => p.kind === 'mine' && p.inPlace),
        'and mining is exempt, being the thing you do to placed stuff');

  const plan = solvePlan(graph, { targets: [{ name: 'Molten Aluminum', amount: 4 }],
                                  have: ['Water'] });
  check(!plan.steps.some((s) => s.process.inPlace),
        `Molten Aluminum is planned without melting anything in the ground: ` +
        plan.steps.map((s) => s.process.label).join(' ; '));
  check(plan.frontier.some((f) => f.name === 'Bauxite'),
        'it asks for the ore instead, which is what a player would be providing');
}

/* ------------------------------------------------------------ alternatives */

console.log('\n--- other ways to make a thing ---');
{
  const plan = solvePlan(graph, { targets: ['Molten Aluminum'], have: ['Water'] });
  const routes = routesFor(plan, 'Carbon');
  check(routes.length > 20, `${routes.length} ways to make Carbon, so they have to be ranked`);
  check(routes[0].chosen, 'the one in use sorts first');
  // Then the ones the plan could feed out of its own leavings, and only then
  // by price. Carbon has 153 routes and eight are shown, so an offer that
  // costs nothing to take has to come off the bottom of the list.
  const tier = (r) => (r.banned ? 3 : r.chosen || r.spare ? 0 : r.runnable ? 1 : 2);
  check(routes.every((r, i) => i === 0 || tier(r) >= tier(routes[i - 1])),
        'then the ones it could run on what it is throwing away');
  check(routes.every((r, i) => i === 0 || tier(r) !== tier(routes[i - 1]) ||
                               r.cost >= routes[i - 1].cost),
        'and within each of those, by what they cost');
  check(routes.some((r) => r.runnable && /Boudouard/.test(r.process.label)),
        'the Boudouard equilibrium being one: the reduction leaves Carbon Monoxide');
  const known = routes.filter((r) => r.ready);
  check(known.length > 0, `${known.length} of them need something already in the plan or in hand`);

  // Choosing one has to actually take effect, which is the whole point.
  const other = routes.find((r) => !r.chosen);
  const redirected = solvePlan(graph, { targets: ['Molten Aluminum'], have: ['Water'],
                                        pins: { Carbon: other.process.id } });
  check(redirected.dag.materials.get('Carbon')?.producer === other.process.id,
        'and picking one is what the plan then does');

  // A banned route is still listed, at the bottom, rather than vanishing.
  const banned = solvePlan(graph, { targets: ['Molten Aluminum'], have: ['Water'],
                                    excludeProcesses: [routes[0].process.id] });
  const after = routesFor(banned, 'Carbon');
  const wasBanned = after.find((r) => r.process.id === routes[0].process.id);
  check(wasBanned?.banned && after[after.length - 1].banned,
        'a banned route stays visible, sorted to the bottom');
}

/* ------------------------------------------------------------------ kinds */

console.log('\n--- process kinds ---');
{
  const withMining = solvePlan(graph, { targets: ['Alumina'], kinds: [...DEFAULT_KINDS, 'mine'] });
  const without = solvePlan(graph, { targets: ['Alumina'] });
  check(without.steps.every((s) => s.process.kind !== 'mine'),
        'mining stays out of a plan by default');
  check(withMining.steps.length > 0, 'and can be turned on');

  // The frontier says how the world hands over what it is asking for, even
  // though the plan will not do it: that is the point of keeping every kind
  // indexed and filtering only at solve time.
  const annotated = [...without.frontier, ...alu.frontier, ...vinegar.frontier]
    .filter((f) => f.routes.length);
  check(annotated.length > 0,
        `${annotated.length} frontier items name a route the plan is not allowed to take` +
        (annotated[0] ? ` (${annotated[0].name}: ${annotated[0].routes[0].kind})` : ''));
}
{
  const beams = solvePlan(graph, { targets: ['Neptunium'], kinds: [...DEFAULT_KINDS, 'beam'] });
  check(beams.steps.some((s) => s.process.kind === 'beam') || !beams.unreachable.length,
        'the accelerator is usable when allowed');
}

/* ------------------------------------------------------------- quantities */

console.log('\n--- quantities ---');
{
  // Alumina Reduction: 1 Alumina + 3 Carbon -> 2 Molten Aluminum + 2 Carbon
  // Monoxide. Asking for one of a thing made two at a time is the case that
  // needs fractions, and the batch scale is what turns it back into whole runs.
  const one = solvePlan(graph, { targets: [{ name: 'Molten Aluminum', amount: 1 }],
                                 pins: { 'Molten Aluminum': 'rx:Alumina Reduction' } });
  const step = one.steps.find((s) => s.process.id === 'rx:Alumina Reduction');
  check(step && step.runs.d === 1n, 'a half-run is scaled up to a whole batch');
  check(rcmp(one.scale, rat(1)) > 0, `the batch is scaled ×${rstr(one.scale)} to make it whole`);
  check(rstr(one.amountOf('Carbon')) === String(3n * step.runs.n),
        'and the inputs scale with it: 3 Carbon per run');
  audit('one Molten Aluminum from a reaction that makes two', one);
}
{
  // A catalyst is not an ingredient. `DoReaction` reads only InputTypes and
  // never touches the catalyst, so one Blender makes yeast forever -- it is a
  // condition on the apparatus, like a temperature.
  const p = solvePlan(graph, { targets: [{ name: 'Clay', amount: 10 }],
                               pins: { Clay: 'rx:Blending Apatite Gravel' } });
  check(p.apparatus.catalysts.get('Blender') === 1, 'a catalysed plan says it needs a Blender');
  check(!p.dag.materials.has('Blender'), 'but the Blender is not a material in the plan');
  check(!p.frontier.some((f) => f.name === 'Blender'), 'and never lands on the shopping list');
  check(rstr(p.amountOf('Blender')) === '0', 'ten runs consume no Blenders at all');
  const one = solvePlan(graph, { targets: [{ name: 'Clay', amount: 1 }],
                                 pins: { Clay: 'rx:Blending Apatite Gravel' } });
  check(one.apparatus.catalysts.get('Blender') === p.apparatus.catalysts.get('Blender'),
        'and one run needs no fewer');
}
{
  const p = solvePlan(graph, { targets: [{ name: 'Vinegar', amount: 7 }] });
  const one = solvePlan(graph, { targets: [{ name: 'Vinegar', amount: 1 }] });
  const ratio = (plan) => plan.steps.map((s) => `${s.process.id}=${rstr(s.runs)}`).sort();
  check(p.steps.length === one.steps.length, 'asking for seven does not change the route');
  check(JSON.stringify(ratio(p)) !== JSON.stringify(ratio(one)), 'only the amounts');
  audit('Vinegar ×7', p);
}

/* ----------------------------------------------------------- byproducts */

console.log('\n--- byproducts ---');
{
  const plan = solvePlan(graph, { targets: ['Sulfuric Acid'], have: ['Water'],
                                  feedBackAll: false });
  check(plan.byproducts.length > 0,
        `spare output is reported (${plan.byproducts.map((b) => rstr(b.amount) + ' ' + b.name).join(', ')})`);
  check(plan.byproducts.every((b) => !b.credited),
        'and with the blanket option off, it is waste until the reader says otherwise');

  const fed = solvePlan(graph, { targets: ['Sulfuric Acid'], have: ['Water'],
                                 feedBackAll: false,
                                 credit: plan.byproducts.map((b) => b.name) });
  check(fed.converged, 'crediting it back still settles on a batch size');
  audit('Sulfuric Acid with byproducts fed back', fed);
}
{
  // Feeding a byproduct back has to make it *usable*, not merely cancel demand
  // for the same material. The furnace throwing off steam is a reason to
  // condense the steam, not to go and fetch snow.
  const before = solvePlan(graph, { targets: ['Ammonium Iodide'], feedBackAll: false });
  const fed = solvePlan(graph, { targets: ['Ammonium Iodide'] });
  check(fed.frontier.length < before.frontier.length,
        `feeding back shortens the shopping list (${before.frontier.length} -> ` +
        `${fed.frontier.length})`);
  check(fed.spec.credit.size > 0,
        `by using what it already makes: ${[...fed.spec.credit].join(', ')}`);
  audit('Ammonium Iodide with its own output fed back', fed);

  // On by default, and worked out rather than asked for: which materials are
  // spare cannot be known until the plan exists, and knowing changes the plan.
  const auto = solvePlan(graph, { targets: ['Potassium', 'Lithium'], have: ['Lepidolite'] });
  check(auto.spec.feedBackAll, 'every spare output is fed back by default');
  check(auto.spec.credit.size > 0,
        `with nobody having to say so: ${[...auto.spec.credit].slice(0, 4).join(', ')}…`);
  check(!auto.frontier.length, 'and there is nothing left to fetch');

  // But a free supply is an unlimited one as far as the cost model is
  // concerned, so anything that promises more than it delivers is refused.
  const tricky = 'Aqueous Aluminum Bromide';
  const plain = solvePlan(graph, { targets: [tricky], feedBackAll: false });
  const fedAll = solvePlan(graph, { targets: [tricky] });
  check(fedAll.steps.length <= plain.steps.length,
        `feeding back never makes a plan longer (${plain.steps.length} -> ${fedAll.steps.length})`);
  check(!fedAll.frontier.some((f) => f.credited),
        'and never leaves the plan short of something it talked itself into using');

  // A named exception is honoured.
  const kept = [...auto.spec.credit][0];
  const except = solvePlan(graph, { targets: ['Potassium', 'Lithium'], have: ['Lepidolite'],
                                    noFeedBack: [kept] });
  check(!except.spec.credit.has(kept), `naming ${kept} as an exception keeps it out`);
  check(except.frontier.length >= auto.frontier.length,
        'and the plan is no better off for it');

  // Feeding back what the plan cannot make enough of leaves the shortfall.
  const short = solvePlan(graph, { targets: [{ name: 'Potassium', amount: 40 }],
                                   have: ['Lepidolite'], feedBackAll: false,
                                   credit: ['Falling Snow'] });
  const gap = short.frontier.find((f) => f.name === 'Falling Snow');
  check(!gap || gap.credited, 'a shortfall on something fed back says that is what it is');
}

/* ---------------------------------------------------- the other way round */

console.log('\n--- starting from what you have ---');
{
  const reach = reachableFrom(graph, { have: ['Water', 'Carbon', 'Oxygen Gas'] });
  check(reach.length > 0, `${reach.length} materials are reachable from water, carbon and oxygen`);
  check(reach[0].cost <= reach[reach.length - 1].cost, 'nearest first');
  console.log('      nearest:', reach.slice(0, 8).map((r) => r.name).join(', '));
  check(!reach.some((r) => graph.producers(r.name).every((p) => !new Set(DEFAULT_KINDS).has(p.kind))),
        'nothing is listed that no allowed process can make');
  check(reachableFrom(graph, { have: [] }).length === 0,
        'and with nothing in hand, nothing is reachable');

  // Adding a material can only ever make things easier, never harder.
  const more = reachableFrom(graph, { have: ['Water', 'Carbon', 'Oxygen Gas', 'Iron'] });
  const before = new Map(reach.map((r) => [r.name, r.cost]));
  const worse = more.filter((r) => before.has(r.name) && r.cost > before.get(r.name) + 1e-9);
  check(!worse.length, 'having more never costs more');
}
{
  // Forward expansion: name a process rather than a target, and the plan grows
  // rightwards from it.
  const fwd = solvePlan(graph, { have: ['Water'], include: ['evap:Water'] });
  check(fwd.dag.processes.has('evap:Water'), 'an included process is in the plan with no target at all');
  check(rstr(fwd.runsOf('evap:Water')) === '1', 'and runs once by default');
  check(fwd.byproducts.some((b) => b.name === 'Steam'), 'its output is there to pick up');
  const twice = solvePlan(graph, { have: ['Water'], include: ['evap:Water'], runs: { 'evap:Water': 4 } });
  check(rstr(twice.amountOf('Water')) === '4', 'a hand-set batch size drives its inputs');
}

/* ------------------------------------------------------------ everything */

console.log('\n--- every material as a target ---');
{
  const t0 = Date.now();
  let made = 0, fetched = 0, threw = 0, worst = null, worstMs = 0, deepest = null;
  for (const m of db.materials) {
    let plan;
    const t = Date.now();
    try {
      plan = solvePlan(graph, { targets: [m.name] });
    } catch (err) {
      if (threw++ < 3) bad(`${m.name} threw: ${err.message}`);
      continue;
    }
    const ms = Date.now() - t;
    if (ms > worstMs) { worstMs = ms; worst = m.name; }
    if (plan.unreachable.length) fetched++; else made++;
    if (!deepest || plan.steps.length > deepest.steps) {
      deepest = { name: m.name, steps: plan.steps.length };
    }
    if (plan.stuck.length) bad(`${m.name}: ${plan.stuck.length} nodes would not order`);
    for (const { runs } of plan.steps) {
      if (runs.d !== 1n) { bad(`${m.name}: fractional run count survived scaling`); break; }
    }
  }
  const total = Date.now() - t0;
  check(!threw, `all ${db.materials.length} materials solve without throwing`);
  console.log(`      ${made} can be made, ${fetched} can only be fetched`);
  console.log(`      deepest: ${deepest.name} at ${deepest.steps} steps`);
  console.log(`      ${total} ms total, ${(total / db.materials.length).toFixed(1)} ms each, ` +
              `worst ${worst} at ${worstMs} ms`);
  check(total / db.materials.length < 50, 'a plan solves fast enough to run on every keystroke');
}

console.log('\n--- a route run on what the plan throws away ---');
{
  // Nine Carbon go into the two reductions and eight Carbon Monoxide come back
  // out of them, which the Boudouard equilibrium turns into four more Carbon,
  // two apiece. Pinning it used to mean "make all nine that way", which wants
  // eighteen Carbon Monoxide -- so the plan built a factory for the other ten.
  const spec = {
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite'],
  };
  const BOUD = 'rx:Boudouard Equilibrium 500-725K';
  const plain = solvePlan(graph, spec);
  check(rstr(plain.amountOf('Carbon')) === '9' && rstr(plain.madeOf('Carbon Monoxide')) === '8',
        'the plan wants 9 Carbon and leaves 8 Carbon Monoxide');

  const pinned = solvePlan(graph, { ...spec, pins: { Carbon: BOUD } });
  check(rstr(pinned.runsOf(BOUD)) === '4',
        'pinning the Boudouard equilibrium runs it 4 times, on the 8 spare');
  const rest = pinned.dag.materials.get('Carbon')?.producer;
  check(rest && rest !== BOUD && rstr(pinned.runsOf(rest)) === '5',
        `and the other 5 Carbon still come from ${rest}`);
  check(rstr(pinned.amountOf('Carbon Monoxide')) === '8' &&
        rstr(pinned.madeOf('Carbon Monoxide')) === '8',
        'every spare Carbon Monoxide is taken and none is fetched');
  check(!pinned.frontier.some((f) => f.name === 'Wood' || f.name === 'Vanadinite'),
        'no Carbon Monoxide factory: neither Wood nor Vanadinite on the list');
  check(pinned.frontier.length === 1 && rstr(pinned.frontier[0].amount) === '5',
        'the shopping list is 5 of one thing, where the plain plan asks for 9');
  check(pinned.sharedPins.get('Carbon') === BOUD, 'and the plan says which pin it read that way');

  // Both routes are live, and the list has to show both -- Carbon has 153 of
  // them and eight are shown, so a dearer one picked by hand would otherwise
  // drop off the end.
  const routes = routesFor(pinned, 'Carbon');
  const boud = routes.find((r) => r.process.id === BOUD);
  check(boud?.spare && rstr(boud.covers) === '4', 'the route list marks it as running on the spare');
  check(routes.indexOf(boud) < 2 && routes[0].chosen,
        'and puts both routes the plan is using at the top');

  // The other reading has to survive: where nothing is spare to run on, a pin
  // is still a pin.
  const charcoal = solvePlan(graph, { ...spec, pins: { Carbon: 'rx:Blending Charcoal' } });
  check(charcoal.dag.materials.get('Carbon')?.producer === 'rx:Blending Charcoal',
        'a pin whose inputs nothing leaves spare is still taken as the whole answer');
  check(charcoal.sharedPins.size === 0, 'and is not reported as one that was shared');

  // It is a recycle loop, so it needs charging before it will turn over: the
  // reductions cannot hand back Carbon Monoxide until they have had Carbon.
  check(pinned.priming.some((x) => x.name === 'Carbon' && rstr(x.amount) === '4'),
        'the loop is reported as needing 4 Carbon laid in to start');
  check(pinned.converged, 'and the run counts settle');
}

console.log('\n--- supplying part of it yourself ---');
{
  // The other half of the same idea. Turning the eight spare Carbon Monoxide
  // into four Carbon is worth doing whether or not you want the plan to make
  // the other five: saying you have Carbon and running the route on the spare
  // are two separate statements, and they compose.
  const BOUD = 'rx:Boudouard Equilibrium 500-725K';
  const spec = {
    targets: [{ name: 'Potassium', amount: 2 }, { name: 'Lithium', amount: 2 },
              { name: 'Aluminum', amount: 2 }, { name: 'Silicon', amount: 3 }],
    have: ['Lepidolite', 'Carbon'],
  };
  const plain = solvePlan(graph, spec);
  check(rstr(plain.madeOf('Carbon Monoxide')) === '8' && rzero(plain.runsOf(BOUD)),
        'saying you have the Carbon leaves all 8 Carbon Monoxide unused');

  const shared = solvePlan(graph, { ...spec, alsoUse: [BOUD] });
  check(rstr(shared.runsOf(BOUD)) === '4', 'asking for the route on the spare runs it 4 times');
  check(rstr(shared.amountOf('Carbon')) === '9' && rstr(shared.madeOf('Carbon')) === '4',
        'of the 9 Carbon the plan wants it makes 4, so 5 are yours to supply');
  check(rstr(shared.amountOf('Carbon Monoxide')) === '8' &&
        rstr(shared.madeOf('Carbon Monoxide')) === '8', 'and every spare one is taken');
  check(!shared.frontier.length, 'with nothing left to fetch');
  check(!shared.steps.some((s) => s.process.id.startsWith('evap:Bitter Oyster')),
        'and no mushrooms: the other 5 Carbon are not made at all');
  check(!shared.priming.some((x) => x.name === 'Carbon'),
        'nor is the loop charged, since the Carbon is yours to hand');

  // A route with nothing spare to run on is asked for and does nothing, rather
  // than dragging in a supply for itself.
  const idle = solvePlan(graph, { ...spec, alsoUse: ['rx:Blending Charcoal'] });
  check(rzero(idle.runsOf('rx:Blending Charcoal')) && !idle.frontier.length,
        'a route with nothing spare to run on stays out of the plan');
}

console.log('\n--- amounts that use the feed up ---');
{
  const amts = (spec) => balanceTargets(graph, spec)
    .map((t) => `${t.amount} ${t.name}`).join(', ');
  const four = ['Potassium', 'Lithium', 'Aluminum', 'Silicon'];
  const at = (ns) => four.map((n, i) => ({ name: n, amount: ns[i] }));

  // Three Lepidolite decompose into one each of potassium oxide, lithium oxide
  // and alumina, and three Molten Silica. That is 2/2/2/3, and one of each gets
  // you 2/2/2/2 with a Molten Silica thrown away.
  const want = '2 Potassium, 2 Lithium, 2 Aluminum, 3 Silicon';
  check(amts({ targets: at([1, 1, 1, 1]), have: ['Lepidolite'] }) === want,
        `one of each comes out as ${want}`);
  check(amts({ targets: at([2, 2, 2, 3]), have: ['Lepidolite'] }) === want,
        'and asking for that already is left alone');
  check(amts({ targets: at([4, 4, 4, 6]), have: ['Lepidolite'] }) === want,
        'a multiple of it comes back to the smallest whole numbers');
  // The ratio is a property of the question, so a lopsided request does not
  // get to keep the oversized feed it committed to.
  check(amts({ targets: at([2, 2, 2, 4]), have: ['Lepidolite'] }) === want,
        'and one that asks for too much of one thing is cut back to fit');
  check(amts({ targets: at([9, 1, 1, 1]), have: ['Lepidolite'] }) === want,
        'whichever thing it was');

  // One Columbite is one tantalum and one niobium -- `Fe(Ta,Nb)2O6`, two slots
  // that are each one or the other -- and the game's chain doubles both on the
  // way to the metal, so one ore is two of each. It used to say six and six,
  // which was the same ratio reached by dissolving sixteen ore for it.
  check(amts({ targets: [{ name: 'Tantalum', amount: 7 }, { name: 'Niobium', amount: 3 }],
               have: ['Columbite', 'Carbon'] }) === '2 Tantalum, 2 Niobium',
        'Columbite gives Tantalum and Niobium one for one, so 7 and 3 is 2 and 2');

  // One product has no ratio to be in, and a feed nothing draws on is not a
  // constraint -- Molten Aluminum out of Water would climb until it ran out of
  // patience. Both keep what they were given and take only the scaling.
  check(amts({ targets: [{ name: 'Molten Aluminum', amount: 4 }], have: ['Water'] })
        === '4 Molten Aluminum', 'a feed the plan does not draw on holds nothing back');
  check(amts({ targets: [{ name: 'Potassium', amount: 5 }], have: ['Lepidolite'] })
        === '10 Potassium', 'and one product only gets the batch scale folded in');
  check(amts({ targets: at([1, 1, 1, 1]) }) === '2 Potassium, 2 Lithium, 2 Aluminum, 2 Silicon',
        'with nothing held there is no feed to match, so it is the scale and no more');
  check(balanceTargets(graph, { targets: [] }).length === 0, 'nothing to make, nothing to balance');

  // A dozen solves, so the pane keeps the answer -- but it still has to come
  // back inside a time a person will sit through.
  const t0 = Date.now();
  balanceTargets(graph, { targets: at([1, 1, 1, 1]), have: ['Lepidolite'] });
  const ms = Date.now() - t0;
  check(ms < 4000, `and it comes back in ${ms} ms`);
}

console.log('\n--- a stock, and something you can go on making ---');
{
  const four = ['Potassium', 'Lithium', 'Aluminum', 'Silicon']
    .map((name) => ({ name, amount: 1 }));
  const at = (spec) => balanceTargets(graph, spec).map((t) => t.amount).join('/');

  // Both halves of `have` mean the same thing to the solver. They differ only
  // to the balancing, and the difference is the whole question: three
  // Lepidolite is what you have, Carbon is what you can go on making.
  check(at({ targets: four, have: ['Lepidolite'] }) === '2/2/2/3',
        'three Lepidolite come to 2/2/2/3');
  check(at({ targets: four, have: ['Lepidolite', 'Carbon'] }) === '2/2/2/2',
        'and holding the Carbon to a stock as well costs the third Silicon');
  check(at({ targets: four, have: ['Lepidolite', 'Carbon'], plenty: ['Carbon'] }) === '2/2/2/3',
        'which saying you can get more Carbon gets back');
  check(at({ targets: four, have: ['Lepidolite', 'Bitter Oyster Spore'],
             plenty: ['Bitter Oyster Spore'] }) === '2/2/2/3',
        'the same for anything waved off the shopping list');

  // The number on the chip is the same either way; it is what it means that
  // changes -- all you have, or all it will take.
  const spec = { targets: balanceTargets(graph, { targets: four, have: ['Lepidolite', 'Carbon'],
                                                  plenty: ['Carbon'] }),
                 have: ['Lepidolite', 'Carbon'], plenty: ['Carbon'] };
  const p = solvePlan(graph, spec);
  check(rstr(rsub(p.amountOf('Carbon'), p.madeOf('Carbon'))) === '9',
        'and it still says how much of it the plan will want');
  check(rstr(rsub(p.amountOf('Lepidolite'), p.madeOf('Lepidolite'))) === '3',
        'out of the three Lepidolite it was balanced against');
}

console.log('\n--- a plan that uses what you said you had ---');
{
  const spec = { targets: ['Carbon'], have: ['Carbon Dioxide'] };
  const eats = (p, name) => p.steps.some((s) => s.process.consumes.some((i) => i.name === name));

  // Pricing the stock at zero only ever said a route is not *charged* for
  // eating your carbon dioxide. It never said a route was worth anything for
  // doing so, and against a spore that turns straight into Carbon for 1.56 a
  // reduction that has to make four Potassium first cannot win on price.
  const plan = solvePlan(graph, spec);
  check(eats(plan, 'Carbon Dioxide'), 'a stock of Carbon Dioxide gets a plan that gets through it');

  // Not the cheapest of the three by the cost model -- that is the Magnesium
  // one, and it then sends you out for Vanadinite. They are judged the way two
  // plans are always judged here, by the shopping list they leave.
  check(plan.steps.some((s) => s.process.id === 'rx:Molten Potassium + Carbon Dioxide'),
        'and it is the Potassium reduction, whose own oxide comes back round');
  check(plan.priming.some((x) => x.name === 'Potassium Oxide'),
        'and the Potassium is a charge laid in once, not a step run for ever');

  // The other half of `have`. Ticking "I have it" on a line of the shopping
  // list is waving it off, not stating a stock, and it must not send the plan
  // hunting for somewhere to put the stuff.
  const off = solvePlan(graph, { ...spec, plenty: ['Carbon Dioxide'] });
  check(!eats(off, 'Carbon Dioxide') && off.steps.length === 1,
        'waving it off the shopping list asks for none of that');

  // It is a preference, and the reader still outranks it.
  const pinned = solvePlan(graph, { ...spec, pins: { Carbon: 'evap:Bitter Oyster Spore' } });
  check(!eats(pinned, 'Carbon Dioxide') && pinned.steps.length === 1,
        'and a pin says how it is made whatever the stock');

  // Nothing to route through leaves the plan exactly as it was.
  const none = solvePlan(graph, { ...spec, excludeProcesses: [
    'rx:Molten Potassium + Carbon Dioxide', 'rx:Potassium + Carbon Dioxide',
    'rx:Carbon Dioxide + Magnesium'] });
  check(none.steps.length === 1 && !eats(none, 'Carbon Dioxide'),
        'with every route through it ruled out, the old plan stands');

  // They sat at 115, 116 and 117 of 153, behind six shown and a "Show all"
  // button: a list you can only search if you already know the answer.
  check(routesFor(plan, 'Carbon').slice(0, 3).every((r) => r.draws),
        'and the ways through the stock head the route list');
}

console.log('\n--- the last of the list, out of the leavings ---');
{
  const spec = { targets: ['Carbon'], have: ['Carbon Dioxide'] };
  const plan = solvePlan(graph, spec);
  const runs = (p, id) => p.steps.find((s) => s.process.id === id);

  // The plan asked for two Water while venting two Hydrogen Gas and two Oxygen
  // Gas -- the water it was buying, in pieces. Water falls from the sky, so no
  // way of making it out of your own exhaust can beat 0.5 on price, and the
  // search was never going to find this on cost.
  check(plan.frontier.length === 0, 'nothing is left to fetch at all');
  check(!plan.byproducts.some((b) => b.name === 'Hydrogen Gas'),
        'and the Hydrogen Gas is no longer vented while Water is bought');

  // `score` already ranked the closed plan over the open one -- it counts the
  // shopping list before anything else. All this pass had to do was make the
  // candidate exist.
  check(runs(plan, 'rx:Hydrogen Combustion'),
        'the spare Hydrogen and Oxygen go back together as Steam for the Water');
  check(plan.priming.map((x) => x.name).sort().join(',') === 'Potassium Oxide,Steam',
        'and what is left is a charge laid in once, not an errand');

  // Which is the whole of it: carbon dioxide in, Carbon out, and the oxygen it
  // came with. Nothing else is fetched and nothing else is left lying about.
  check(plan.byproducts.map((b) => b.name).join(',') === 'Oxygen Gas',
        'so the only thing left over is the oxygen the carbon dioxide came with');

  // There is a shorter way to close the list and it is not taken: a step fewer,
  // but two Carbon Monoxide to be carried off for as long as the factory runs.
  // A byproduct is a standing obligation where a step is a one-off.
  const shorter = solvePlan(graph, { ...spec,
                                     pins: { Water: 'rx:Electrolysis of Carbon Dioxide' } });
  check(shorter.frontier.length === 0 && shorter.steps.length < plan.steps.length,
        `the carbon dioxide electrolysis closes it in fewer steps ` +
        `(${shorter.steps.length} against ${plan.steps.length})`);
  check(shorter.byproducts.some((b) => b.name === 'Carbon Monoxide'),
        'but leaves Carbon Monoxide behind, which is why the longer one wins');

  // Only where this pass is choosing, though. Counting waste everywhere was
  // tried and it emptied a real feature: Boron Oxide stopped fetching seven
  // Water to vent six Steam, which is a better plan and left "Prime instead"
  // with no step in the whole data set to sit on.
  check(solvePlan(graph, { targets: ['Boron Oxide'] }).brokenLoops.includes('Steam'),
        'and the ordinary comparison is left as it was');

  // Nothing spare is nothing to work with, and the plan stands as it was.
  const bare = solvePlan(graph, { targets: ['Carbon'] });
  check(bare.steps.length === 1 && bare.frontier.length === 1,
        'a plan that throws nothing away is left alone');
}

console.log('\n--- a charge you could actually turn up with ---');
{
  // Tantalum and Niobium out of Columbite came back "prime with six
  // Heptafluorotantalic Acid and six Heptafluoroniobic Acid", which you can
  // only have by dissolving Columbite -- which is this plan. If it is your
  // first reactor for either metal there is nowhere on the map to get them.
  const spec = { targets: [{ name: 'Tantalum', amount: 6 }, { name: 'Niobium', amount: 6 }],
                 have: ['Columbite'] };
  const plan = solvePlan(graph, spec);
  const primed = plan.priming.map((x) => x.name);

  check(!primed.some((n) => /Tantal|Niob/i.test(n)),
        `no charge is a tantalum or niobium compound: ${primed.join(', ') || 'none'}`);

  // Every step here waits on some other step's output -- the acid on the
  // dissolution, the dissolution on the Hydrofluoric Acid, the acid back on
  // the tantalate -- so a seed is genuinely needed. Being on the shopping list
  // is what settles which: you are going out for ninety of it regardless.
  const fetched = plan.frontier.map((f) => f.name);
  check(primed.every((n) => fetched.includes(n)),
        'and what is laid in is something the plan was already sending you for');
  // Which is now nothing at all: the plan stopped dissolving five times more
  // ore than it needed, and the loop it could not start went with it.
  check(primed.length === 0,
        `and on this plan there is nothing to lay in (${primed.join(', ') || 'none'})`);
}

console.log('\n--- a leftover with the thing you asked for still in it ---');
{
  // This plan used to bin ten Heptafluorotantalic Acid and ten
  // Heptafluoroniobic Acid, which between them are the whole ore. Now there is
  // nothing of either metal left lying about, which is what the note is for
  // saying and what the sizing rule is for preventing.
  const spec = { targets: [{ name: 'Tantalum', amount: 6 }, { name: 'Niobium', amount: 6 }],
                 have: ['Columbite'] };
  const plan = solvePlan(graph, spec);
  check(!plan.byproducts.some((b) => b.holds.length),
        'nothing the plan throws away has any tantalum or niobium in it');

  // Rule the reduction out and the acid has nowhere to go, which is exactly
  // when the reader wants telling what is in it.
  const stuck = solvePlan(graph, { ...spec,
                                   excludeProcesses: ['rx:Tantalum Pentoxide Reduction'] });
  const held = stuck.byproducts.filter((b) => b.holds.length);
  check(held.some((b) => b.name === 'Heptafluorotantalic Acid' && b.holds.includes('Ta')),
        'and where one is left over it is marked as still holding tantalum');
  check(!stuck.byproducts.some((b) => b.name === 'Steam' && b.holds.length),
        'while the steam is nobody\'s tantalum');

  // Nothing asked for, nothing to hold: the note is about the question.
  const idle = solvePlan(graph, { targets: ['Carbon'] });
  check(idle.byproducts.every((b) => Array.isArray(b.holds)),
        'every leftover carries the field, even when it is empty');
}

console.log('\n--- why a thing is on the shopping list ---');
{
  // "Six Lepidolite" is not an answer to anything. The reader wants to push
  // back on it and cannot, because the row never says where it is going --
  // while every step row already carries the material it was picked to make.
  const ask = { targets: [{ name: 'Tantalum', amount: 1 }, { name: 'Niobium', amount: 1 }],
                have: ['Columbite'] };
  const plan = solvePlan(graph, { ...ask, targets: balanceTargets(graph, ask) });
  const feeds = (name) => plan.frontier.find((f) => f.name === name)?.feeds.join(', ');

  // Followed forward while the chain is its own: the ore decomposes to these
  // two and nothing joins in on the way. Then the potassium oxide meets water
  // from somewhere else, and that is where the chain ends.
  check(feeds('Lepidolite') === 'Hydrofluoric Acid, Potassium Oxide',
        `the Lepidolite is there for the acid and the oxide: ${feeds('Lepidolite')}`);
  check(feeds('Bitter Oyster Spore') === 'Carbon',
        `and the mushrooms are there for the Carbon: ${feeds('Bitter Oyster Spore')}`);

  // Water is eaten straight away beside something else, so there is no chain
  // of its own to follow -- and then what took it was picked to make is the
  // useful answer instead.
  check((feeds('Water') || '').includes('Potassium Hydroxide'),
        `and water, which has no chain of its own, names what takes it: ${feeds('Water')}`);
}

console.log('\n--- getting rid of a leftover ---');
{
  // Two Carbon Monoxide come back as a Carbon and a Carbon Dioxide, and that
  // dioxide still has a carbon in it. Nothing in the plan wants carbon
  // dioxide, so feeding it back finds no taker, and the planner will not reach
  // for a potassium reduction on its own. Told to get rid of it, it will.
  const base = { targets: [{ name: 'Carbon', amount: 1 }], have: ['Carbon Monoxide'] };
  const left = solvePlan(graph, base);
  check(left.byproducts.some((b) => b.name === 'Carbon Dioxide' && b.holds.includes('C')),
        'the plan leaves a Carbon Dioxide with a carbon still in it');
  check(solvePlan(graph, { ...base, credit: ['Carbon Dioxide'] })
          .byproducts.some((b) => b.name === 'Carbon Dioxide'),
        'and feeding it back changes nothing, because nothing wants it');

  const rid = solvePlan(graph, { ...base, consume: ['Carbon Dioxide'] });
  check(!rid.byproducts.some((b) => b.name === 'Carbon Dioxide'),
        'told to get rid of it, the Carbon Dioxide is gone');
  // What is left holding carbon is Carbon, which is not waste -- it is the
  // thing that was asked for, more of it than was asked. Four Carbon Monoxide
  // come back as four Carbon and two Oxygen Gas, and every atom is accounted
  // for; before the excess was reported this read as one Carbon and looked
  // like three of them going astray.
  check(!rid.byproducts.some((b) => b.holds.length && b.name !== 'Carbon'),
        `and nothing left over but Carbon has carbon in it: ${rid.byproducts.map((b) => b.name).join(', ')}`);
  check(rid.byproducts.some((b) => b.name === 'Carbon'),
        'the carbon it recovers beyond what was asked for being said out loud');
  check(rid.steps.length > left.steps.length,
        `which took building something that eats it (${left.steps.length} steps to ${rid.steps.length})`);

  // Asking about something the plan does not leave over is not an error, it is
  // just nothing to do.
  const idle = solvePlan(graph, { ...base, consume: ['Vinegar'] });
  check(idle.steps.length === left.steps.length,
        'and naming something it does not leave over does nothing at all');
}

console.log('\n--- closing the list is not one thing ---');
{
  // Getting rid of the carbon dioxide needs two Water for the potassium, and
  // there are two ways to have them without going shopping: electrolyse carbon
  // dioxide, or burn the spare hydrogen back to steam and condense it. Both
  // leave nothing at all to fetch. The first does it in seven steps and the
  // second in eight, so on length alone the first wins -- while eating six
  // Carbon Monoxide where the other eats two.
  const spec = { targets: [{ name: 'Carbon', amount: 1 }],
                 have: ['Carbon Monoxide'], consume: ['Carbon Dioxide'] };
  const plan = solvePlan(graph, spec);

  check(plan.frontier.length === 0, 'the plan has nothing left to fetch');
  check(rstr(plan.amountOf('Carbon Monoxide')) === '2',
        `and gets there on two Carbon Monoxide, not six: ${rstr(plan.amountOf('Carbon Monoxide'))}`);
  check(plan.steps.some((s) => s.process.id === 'rx:Hydrogen Combustion'),
        'by burning its own spare hydrogen back for the water');
  check(!plan.steps.some((s) => s.process.id === 'rx:Electrolysis of Carbon Dioxide'),
        'rather than electrolysing carbon dioxide it would have to make first');

  // Two Carbon Monoxide are two carbons and two oxygens, and that is exactly
  // what comes out: the Carbon asked for, one more over, and an Oxygen Gas.
  check(rstr(plan.madeOf('Carbon')) === '2',
        `every carbon in the feed comes back out: ${rstr(plan.madeOf('Carbon'))}`);
  check(plan.byproducts.map((b) => `${b.name}×${rstr(b.amount)}`).join(', ') ===
          'Carbon×1, Oxygen Gas×1',
        `and the difference is all that is left: ${plan.byproducts.map((b) => b.name).join(', ')}`);
}

console.log('\n--- run counts settled all at once ---');
{
  // Two makers of one thing cannot be sized one at a time: whichever the
  // backward pass reaches first takes the whole demand and the other is sized
  // on top. Told to get rid of the carbon dioxide, this ran the Boudouard
  // equilibrium and the potassium reduction twice each where once each does,
  // at twice the feed, for any amount asked.
  const ask = (n) => solvePlan(graph, { targets: [{ name: 'Carbon', amount: n }],
                                        have: ['Carbon Monoxide'],
                                        consume: ['Carbon Dioxide'] });
  for (const n of [2, 4, 6]) {
    const p = ask(n);
    check(rstr(p.amountOf('Carbon Monoxide')) === String(n),
          `${n} Carbon takes ${rstr(p.amountOf('Carbon Monoxide'))} Carbon Monoxide, not ${n * 2}`);
    check(rstr(p.madeOf('Carbon')) === String(n),
          `and makes exactly the ${rstr(p.madeOf('Carbon'))} asked for`);
  }

  // Every carbon in the feed comes back out, and the difference is oxygen.
  const two = ask(2);
  check(two.byproducts.every((b) => b.name === 'Oxygen Gas'),
        `with nothing left over but oxygen: ${two.byproducts.map((b) => b.name).join(', ')}`);
}

console.log('\n--- and refused where it has nothing to offer ---');
{
  // Most plans have one maker per material, and there the backward pass is
  // exact -- the program agrees with it to the unit and is turned away for
  // offering nothing. These two are the ones that must not move.
  const lep = solvePlan(graph, { targets: ['Potassium', 'Lithium'], have: ['Lepidolite'] });
  check(lep.frontier.length === 0 && lep.steps.length === 14,
        `Lepidolite is untouched: ${lep.steps.length} steps, ${lep.frontier.length} to fetch`);

  const col = solvePlan(graph, { targets: [{ name: 'Tantalum', amount: 6 },
                                           { name: 'Niobium', amount: 6 }],
                                 have: ['Columbite'] });
  check(rstr(col.amountOf('Columbite')) === '3',
        `and Columbite still comes to three ore: ${rstr(col.amountOf('Columbite'))}`);
  check(!col.byproducts.some((b) => b.holds.length),
        'with nothing tantalum- or niobium-bearing thrown away');

  // A refinement is taken only where it is better on every count and worse on
  // none. Charges are weighed by the unit: counted in kinds, a plan that
  // stopped making four Carbon and asked for seven to be laid in instead read
  // as no change at all, and it is not a plan -- it is a shortfall in a coat.
  const pinned = solvePlan(graph, {
    targets: ['Potassium', 'Lithium', 'Aluminum', 'Silicon'].map((n) => ({ name: n, amount: 2 })),
    have: ['Lepidolite'], pins: { Carbon: 'rx:Boudouard Equilibrium 500-725K' } });
  check(rcmp(pinned.madeOf('Carbon'), pinned.amountOf('Carbon')) >= 0,
        `and never one that makes less than it uses: ` +
        `${rstr(pinned.madeOf('Carbon'))} made against ${rstr(pinned.amountOf('Carbon'))} used`);
}

console.log('\n--- determinism ---');
{
  const spec = { targets: ['Vinegar', 'Sulfuric Acid'], have: ['Water'] };
  const a = solvePlan(graph, spec), b = solvePlan(graph, spec);
  const sig = (p) => p.steps.map((s) => `${s.process.id}×${rstr(s.runs)}`).join('|');
  check(sig(a) === sig(b), 'the same question gets the same answer');
}

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
