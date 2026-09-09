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

Every quantity below is exact. The float pass only decides *which* steps are
on the table.

| case | time | result |
|---|---|---|
| `columbite` | 0.7s | **all seven checks met** — six Tantalum and six Niobium one for one out of three Columbite, nothing holding either metal thrown away |
| `co2-to-carbon` | 0.7s | **nothing fetched**, four Carbon out of four Carbon Dioxide. The one miss is that the oxygen comes back as Liquid Oxygen where the check names Oxygen Gas |
| `lepidolite` | 2.1s | solves, four of six checks. Fetches Chicken (Raw) and Aqueous Sodium Aluminate, and spends seventeen ore |
| `co-to-carbon` | — | float pass fails both walks, falls back to the exact solver, does not finish |
| `lepidolite-exhaust` | — | not attempted: this solver has no notion of "get rid of it" |

Two of those misses are worth reading before believing:

- **`balances to 2/2/2/3`** is not really tested. The harness asks for one of
  each, because balancing lives in `plan-state` and is not wired to this
  solver, so the plan makes 4/4/4/4 and the check fails on a question it was
  never asked.
- **Liquid Oxygen against Oxygen Gas** is the same oxygen at a different
  temperature. Met in spirit, missed as written.

The rest are real. The Lepidolite plan spends seventeen ore where the old
planner spends three, and buys chickens, and leaves a heap. That is the trade
working exactly as specified: any amount of free stock beats a single unit
bought.

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

**One case still cannot be planned.** `co-to-carbon` has a 465-process
candidate set and the float pass fails both phase-one walks on it, so it falls
back to the exact solver and does not finish. Every other case now shortlists
in tens of milliseconds. This is a bug in the float pass, not a limit of the
approach — the same problem is answered by the exact solver, slowly.

**Leftovers.** Free unlimited stock means the plan will pour ore through a
wasteful route rather than buy one cheap thing. Lepidolite spends seventeen ore
and leaves seventeen Hydrofluoric Acid Gas, thirteen Glass and fourteen Aqueous
Potassium Hydroxide behind. Sparr flagged this as the thing to revisit if it
got silly. It has got fairly silly.

**No `consume`, no balancing, no charges.** Three of the reader's controls have
no counterpart here yet, and the fifth canonical case needs the first of them.
