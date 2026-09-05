/**
 * Temperatures, in the units the game itself shows.
 *
 * The data stores kelvin, and the game converts on the way out. Its own
 * `Temperature` struct is the whole specification:
 *
 *     public int Celsius    => Kelvin - 273;
 *     public int Fahrenheit => Celsius * 9 / 5 + 32;
 *
 * Note 273, not 273.15, and integer division throughout -- so this rounds the
 * way the game rounds rather than the way physics would. Celsius is the default
 * here because that is what the game shows; a device setting offers all three,
 * which is why all three are here.
 */

/**
 * The band ambient air moves within, 0 to 22 °C.
 *
 * There is no single ambient temperature: `PlanetType` carries a table indexed
 * by depth with a separate one for night, so it shifts with time of day, season
 * and how far down you are. This is the range it shifts inside.
 *
 * What this is *not* is a threshold below which a requirement stops counting.
 * A reaction wanting 0 °C still wants it: a cooled chamber a few tiles away
 * will pull the one next to it under, so holding a reaction at 0 °C can mean
 * heating or insulating it. Every stated temperature is reported. This band
 * only answers a narrower question -- whether the air alone could ever get
 * there -- which is what decides if a *furnace* is on the shopping list.
 */
export const AMBIENT = { min: 273, max: 295 };

/**
 * How much equipment a floor of `kelvin` implies.
 *
 * 'always' -- hotter than the air ever gets; that is a furnace.
 * 'sometimes' -- inside the band, so it depends on the hour, the depth and
 *                what is next door. Heating or insulation may still be needed.
 * 'none' -- colder than the air ever gets.
 */
export function heatingNeed(kelvin) {
  if (kelvin == null) return 'none';
  if (kelvin > AMBIENT.max) return 'always';
  // Inclusive at the bottom: a floor of exactly 0 °C is still a floor. Sitting
  // it beside a chamber you are cooling will drag it under, so it may want
  // heating or insulation even though the air outside would have managed.
  return kelvin >= AMBIENT.min ? 'sometimes' : 'none';
}

/** The same for a ceiling: how much cooling holding under `kelvin` implies. */
export function coolingNeed(kelvin) {
  if (kelvin == null) return 'none';
  if (kelvin < AMBIENT.min) return 'always';
  return kelvin <= AMBIENT.max ? 'sometimes' : 'none';
}

export const TEMPERATURE_UNITS = [
  { id: 'C', label: 'Celsius', suffix: '°C' },
  { id: 'K', label: 'Kelvin', suffix: 'K' },
  { id: 'F', label: 'Fahrenheit', suffix: '°F' },
];

export const DEFAULT_TEMPERATURE_UNIT = 'C';

/** Integer division that truncates toward zero, as C# does. */
const idiv = (a, b) => Math.trunc(a / b);

/** A temperature on the scale, in the given unit. */
export function convertTemperature(kelvin, unit = DEFAULT_TEMPERATURE_UNIT) {
  const k = Math.round(kelvin);
  if (unit === 'K') return k;
  const c = k - 273;
  return unit === 'F' ? idiv(c * 9, 5) + 32 : c;
}

/**
 * A *change* in temperature, which is not a point on the scale.
 *
 * 50 K hotter is 50 °C hotter; the offset cancels. Only the Fahrenheit scaling
 * survives, so `ChangeInTemperature` must come through here and not through
 * `convertTemperature`, or a +50 K reaction reads as if it cooled by 223.
 */
export function convertTemperatureDelta(deltaK, unit = DEFAULT_TEMPERATURE_UNIT) {
  const d = Math.round(deltaK);
  return unit === 'F' ? idiv(d * 9, 5) : d;
}

const suffixOf = (unit) =>
  (TEMPERATURE_UNITS.find((u) => u.id === unit) || TEMPERATURE_UNITS[0]).suffix;

/** "1027 °C". */
export function formatTemperature(kelvin, unit = DEFAULT_TEMPERATURE_UNIT) {
  return `${convertTemperature(kelvin, unit)} ${suffixOf(unit)}`;
}

/** "+50 °C", signed, because a delta reads wrong without it. */
export function formatTemperatureDelta(deltaK, unit = DEFAULT_TEMPERATURE_UNIT) {
  const d = convertTemperatureDelta(deltaK, unit);
  return `${d > 0 ? '+' : ''}${d} ${suffixOf(unit)}`;
}

/** "≥ 1027 °C", "≤ 300 °C", "20–200 °C" -- the band a process needs. */
export function formatTemperatureRange(min, max, unit = DEFAULT_TEMPERATURE_UNIT) {
  const s = suffixOf(unit);
  if (min && max) return `${convertTemperature(min, unit)}–${convertTemperature(max, unit)} ${s}`;
  if (min) return `≥ ${convertTemperature(min, unit)} ${s}`;
  if (max) return `≤ ${convertTemperature(max, unit)} ${s}`;
  return null;
}
