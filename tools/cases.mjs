/**
 * The plans this planner is judged by.
 *
 * These are the questions Sparr actually asks it, kept in one place because
 * they were being re-derived from memory every time -- including once, wrongly,
 * by me. Each of the improvements in 0.2.x and 0.3.x was found by one of them
 * and then very nearly broken by the next, so they are worth stating as a set
 * rather than as whatever happened to be in the last conversation.
 *
 * `want` is the shape of a right answer, not a snapshot. Numbers that only
 * describe today's plan belong in a test beside the change that made them true;
 * what belongs here is the thing that must not stop being so. A case whose
 * `want` is a list of amounts will fail on any improvement, which teaches
 * everyone to update it without reading it.
 *
 * Used by `test-cases.mjs`, and by hand when weighing a change: run it, read
 * the table, and see what a rule costs somewhere it was not written for.
 */
export const CASES = [
  {
    id: 'lepidolite',
    url: '#mode=plan&t=Potassium~Lithium~Aluminum~Silicon&h=Lepidolite',
    plan: { targets: ['Potassium', 'Lithium', 'Aluminum', 'Silicon'], have: ['Lepidolite'] },
    about: 'One ore, four products, split three ways by chance.',
    want: [
      // The flagship. Three Lepidolite are what the four come out of, and the
      // proportion is the whole answer -- 2/2/2/3 and not 1/1/1/1 or 4/4/4/6.
      ['balances to 2/2/2/3', (p) =>
        p.spec.targets.map((t) => t.amount).join('/') === '2/2/2/3'],
      ['and fetches nothing but the carbon for the reductions', (p) =>
        p.frontier.every((f) => f.name === 'Bitter Oyster Spore')],
    ],
  },
  {
    id: 'columbite',
    url: '#mode=plan&t=Tantalum~Niobium&h=Columbite',
    plan: { targets: ['Tantalum', 'Niobium'], have: ['Columbite'] },
    about: 'Two metals out of one ore, and a long way round to both.',
    want: [
      // Fe(Ta,Nb)2O6 is one of each, and the game's chain doubles both.
      ['gives tantalum and niobium one for one', (p) => {
        const [a, b] = p.spec.targets.map((t) => t.amount);
        return a === b;
      }],
      ['and throws away nothing with either metal in it', (p) =>
        !p.byproducts.some((b) => b.holds.length)],
      ['dissolving no more ore than it needs', (p, { rnum }) =>
        rnum(p.amountOf('Columbite')) <= p.spec.targets[0].amount / 2],
    ],
  },
  {
    id: 'co2-to-carbon',
    url: '#mode=plan&t=Carbon&h=Carbon+Dioxide',
    plan: { targets: ['Carbon'], have: ['Carbon Dioxide'] },
    about: 'Use what I said I have, rather than a mushroom.',
    want: [
      ['gets its carbon out of the carbon dioxide', (p) =>
        p.steps.some((s) => s.process.consumes.some((i) => i.name === 'Carbon Dioxide'))],
      ['with nothing left to fetch', (p) => p.frontier.length === 0],
      ['and nothing left over but the oxygen it came with', (p) =>
        p.byproducts.every((b) => b.name === 'Oxygen Gas')],
    ],
  },
  {
    id: 'co-to-carbon',
    url: '#mode=plan&t=Carbon&h=Carbon+Monoxide',
    plan: { targets: ['Carbon'], have: ['Carbon Monoxide'] },
    about: 'Two carbon monoxide are a carbon and a carbon dioxide.',
    want: [
      ['takes the carbon it can reach', (p) =>
        p.steps.some((s) => /Boudouard/.test(s.process.label))],
    ],
  },
  {
    id: 'co-to-carbon-used-up',
    url: '#mode=plan&t=Carbon&h=Carbon+Monoxide&cu=Carbon+Dioxide',
    plan: { targets: ['Carbon'], have: ['Carbon Monoxide'], consume: ['Carbon Dioxide'] },
    about: 'And told to get the rest of it out of the dioxide as well.',
    want: [
      // Two carbons and two oxygens in, and that is what must come back.
      ['says what it makes rather than leaving carbon over', (p) =>
        !p.byproducts.some((b) => b.name === 'Carbon')],
      ['recovers every carbon in the feed', (p, { rnum }) =>
        rnum(p.madeOf('Carbon')) === rnum(p.amountOf('Carbon Monoxide'))],
      ['and leaves only the oxygen', (p) =>
        p.byproducts.every((b) => b.name === 'Oxygen Gas')],
    ],
  },
];

/**
 * Things no plan may ever do, checked against every case above.
 *
 * Each of these was a real answer at some point in 0.2.x or 0.3.x, and each
 * looked reasonable until somebody read it.
 */
export const NEVER = [
  ['makes at least as much of each target as was asked', (p, { rnum }) =>
    p.spec.targets.every((t) => rnum(p.madeOf(t.name)) >= t.amount)],
  ['never asks for a charge it has no way to come by', (p, { rnum }) =>
    p.priming.every((x) => rnum(p.madeOf(x.name)) > 0 ||
                           p.frontier.some((f) => f.name === x.name))],
  ['and never runs a step no number of times', (p, { rzero }) =>
    p.steps.every((s) => !rzero(s.runs))],
];
