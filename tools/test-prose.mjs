/**
 * The phrase-making, which is small and was wrong in three places at once.
 */
import { listed } from '../src/prose.js';

let fail = 0;
const check = (got, want, what) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${ok ? '' : ` -- got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};

console.log('--- the serial comma, where there is a series ---');
check(listed([]), '', 'nothing says nothing');
check(listed(['reactors']), 'reactors', 'one thing is itself');
check(listed(['reactors', 'steps']), 'reactors and steps',
      'two things take no comma, because two things are not a series');
check(listed(['shopping list', 'reactors', 'steps']), 'shopping list, reactors, and steps',
      'three things take the serial comma');
check(listed(['a', 'b', 'c', 'd']), 'a, b, c, and d', 'and so do four');

console.log('\n--- the conjunction is the caller\'s ---');
check(listed(['tin', 'lead'], 'or'), 'tin or lead', 'a refusal reads "or"');
check(listed(['tin', 'lead', 'zinc'], 'or'), 'tin, lead, or zinc',
      'and keeps its own word before the comma');

console.log('\n--- it does not disturb what it was given ---');
const given = ['a', 'b', 'c'];
listed(given);
check(given.join(','), 'a,b,c', 'the caller keeps its array in order');
check(listed(new Set(['a', 'b', 'c'])), 'a, b, and c', 'and any iterable will do');

console.log(fail ? `\n${fail} FAILURES` : '\nall checks passed');
process.exit(fail ? 1 : 0);
