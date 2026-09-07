/**
 * Turning a list of things into a phrase a person would say.
 *
 * Small enough to have been written three times over -- once in the plan pane,
 * once for the phase-change verbs, once for the notes a refusal carries -- and
 * they disagreed, which is how a page ends up saying "melts, boils and freezes"
 * in one place and "reactors, and steps" nowhere at all.
 */

/**
 * A, B, and C. With the serial comma, and only where there is a series.
 *
 * Sparr asked for it on enumerated lists shown to the reader. Two things take
 * no comma -- "reactors and steps", not "reactors, and steps" -- because two
 * things are not a series; the comma is there to keep the last two apart when
 * there are others behind them.
 *
 * The conjunction is a parameter because a refusal reads "nothing consumes tin
 * or lead", not "tin and lead", and the comma rule is the same either way.
 */
export function listed(parts, conjunction = 'and') {
  const items = [...parts];
  if (items.length < 2) return items[0] ?? '';
  const last = items[items.length - 1];
  const rest = items.slice(0, -1);
  return items.length === 2
    ? `${rest[0]} ${conjunction} ${last}`
    : `${rest.join(', ')}, ${conjunction} ${last}`;
}
