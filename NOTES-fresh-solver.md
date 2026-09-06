# A planner with two priorities

The branch replaces the plan solver's scoring outright. Nothing in
`plan-fresh.js` reads `score`, `better`, `tally`, `dominates`, the acquisition
weights, or any of the tie-breaks that accumulated through 0.2.x and 0.3.x. It
asks two questions, in order and exactly:

1. buy nothing if the order can be filled without buying, and otherwise buy as
   few units as possible;
2. among the answers that buy exactly that much, use the fewest steps that are
   not phase changes.

The second is asked with the first one's answer nailed down as an equality
row, so no amount of step-saving can talk the shopping list back up. Step count
is a count of non-zero variables, which a linear objective cannot express, so
it is done by elimination: take a step out, ask whether the rest still buys no
more, and keep it out if so.

## What it does today

| case | result |
|---|---|
| `co-to-carbon` | **solved, 0.8s.** One step, two Carbon Monoxide in, one Carbon and one Carbon Dioxide out, nothing fetched. |
| `co2-to-carbon` | solved, 5s, **wrong**: fetches one Chicken (Raw) and cooks it. |
| `columbite` | one LP solve takes 5s; the full solve does not finish usefully. |
| `lepidolite` | one LP solve takes 14s; same. |

## What the two priorities do not say

**They do not say to use what you have.** Asked for Carbon by somebody holding
Carbon Dioxide, the solver buys a chicken and cooks it: one thing fetched
against the one ore the potassium route needs, and no real steps against two.
That answer is *correct by the stated priorities* and obviously not what was
wanted. Requiring each declared stock to be spent is implemented, but it only
applies where requiring it costs nothing at the till -- and here it costs one
unit, so it declines. Using your stock has to outrank buying less, or the two
have to be weighed against each other; it cannot be a free tie-break.

**They do not say matter is conserved.** The first thing the simplex found,
given a free hand, was `1 Heavy Oil Vapor -> 2 Heavy Oil -> 4 Heavy Oil
Vapor` -- burn the oil you minted and take the carbon out of the smoke, buying
nothing. Thirty-nine of the game's 946 phase changes hand back more than they
were given, which is what petroleum cracking is; combined with their inverses
they mint matter. A solver that works backwards from demand never goes looking
for this. One that minimises what it buys goes looking for exactly this. They
are excluded here, which also makes cracking routes unavailable.

**They do not mention charges.** This is a steady-state model: it balances
supply against demand and has no notion of what has to be in the pipes before
the first batch. A loop that closes on paper still needs seeding, so a "buys
nothing" answer may quietly require a charge it does not report.

**A plan may be bigger than the order.** Run counts come back as fractions and
a step cannot run four sevenths of a time, so the whole plan multiplies up.
Asking for one can make four.

## What is in the way

Speed, and it is structural rather than a matter of tuning. The subgraph handed
to the simplex is 250-430 variables over 190-250 materials, and one exact
rational solve of that is 5-14 seconds; the step-elimination pass needs one per
step it tries to remove. Switching the entering-variable rule from Bland's to
the steepest column (`steep: true`, opt-in, off for the existing solver) took
columbite from 6.9s to 5.1s -- the cost is per-pivot BigInt arithmetic over a
dense tableau, not the number of pivots.

Making this viable needs one of:

- a sparse or revised simplex rather than a dense tableau;
- floating point for the search with exact arithmetic only to verify and repair
  the answer;
- a much smaller subgraph, which trades away the alternatives that made an
  all-at-once solver worth building.

The third is the cheapest and the least interesting: narrowing the candidate
set until the LP is fast is a way of going back to choosing the route in
advance, which is what this was meant to stop doing.
