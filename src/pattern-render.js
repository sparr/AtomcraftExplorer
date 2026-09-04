/**
 * Draw a material the way the game does.
 *
 * The game blends a material's base colour toward a tint by
 * `table[y % rows][x % cols] * amount`, where the table is either a small one
 * compiled into the binary or a 64x64 grid of random values. Some delegates
 * animate: gems sparkle, lava oscillates, conveyors scroll.
 *
 * Everything here renders to a canvas and is cached by (delegate, colour), so
 * the 1795 materials cost far fewer draws than that. Without a canvas -- the
 * headless tests -- callers fall back to the flat colour.
 */
import { PATTERNS, RANDOM_PATTERNS, DELEGATES } from './patterns.js';

/** Godot's named colours, as used by the delegates. */
const NAMED = {
  White: [255, 255, 255], Black: [0, 0, 0], DarkGray: [169, 169, 169],
  Yellow: [255, 255, 0], Red: [255, 0, 0], Orange: [255, 165, 0],
  Green: [0, 255, 0], Blue: [0, 0, 255], Purple: [128, 0, 128],
  // DarkOrange scaled to a fifth, which is how the game darkens it for bark.
  DarkerOrange: [51, 28, 0],
};

/** Deterministic stand-in for the tables the game fills with GD.Randf(). */
function randomTable(rows, cols, seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: rows }, () => Array.from({ length: cols }, next));
}

const generated = new Map();
function tableFor(name) {
  if (PATTERNS[name]) return PATTERNS[name];
  if (!RANDOM_PATTERNS[name]) return null;
  if (!generated.has(name)) {
    const { rows, cols } = RANDOM_PATTERNS[name];
    // Sand is the one the game biases upward; the others span the full range.
    const table = randomTable(rows, cols, [...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    if (name === 'SandNoisePattern') {
      for (const row of table) for (let i = 0; i < row.length; i++) row[i] = (row[i] + 1) / 2;
    }
    generated.set(name, table);
  }
  return generated.get(name);
}

const lerp = (a, b, t) => a + (b - a) * t;

/** What to draw for a material: its base colour plus its delegate's recipe. */
export function recipeFor(material) {
  const base = material.raw.Color
    ? [material.raw.Color.R ?? 0, material.raw.Color.G ?? 0, material.raw.Color.B ?? 0].map((v) => Math.round(v * 255))
    : null;
  const spec = DELEGATES[material.raw.ColorDelegate] ?? null;
  return { base, spec, animated: !!spec?.animated };
}

/** A 32-bit PRNG per (pixel, frame), so sparkles differ per frame but are stable. */
function sparkleRoll(x, y, frame, salt) {
  let t = (x * 374761393 + y * 668265263 + frame * 2246822519 + salt) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function paint(ctx, size, material, frame) {
  const { base, spec } = recipeFor(material);
  const rgb = [...(base ?? [90, 96, 106])];
  const img = ctx.createImageData(size, size);
  const table = spec?.pattern ? tableFor(spec.pattern) : null;
  const tint = spec?.tint ? NAMED[spec.tint] : null;
  // Twinkle takes the colour to twinkle *over*, and sparkles white: the gems
  // pass their own colour as that base. Reading it as the sparkle colour makes
  // Ruby a flat red square, since its base is red too.
  const twinkleBase = spec?.twinkle ? NAMED[spec.twinkle] : null;
  const sparkle = spec?.animated ? NAMED.White : null;
  if (twinkleBase) [rgb[0], rgb[1], rgb[2]] = twinkleBase;
  const salt = [...(material.raw.ColorDelegate ?? '')].reduce((a, c) => a * 31 + c.charCodeAt(0), 3);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let [r, g, b] = rgb;

      if (table && tint) {
        // Oscillating and scrolling delegates walk the table over time.
        const ox = spec.builder === 'Conveyor' ? x + frame * (spec.arg ?? 1) : x;
        const oy = spec.builder === 'OscillatingPattern' ? y + frame : y;
        const v = table[((oy % table.length) + table.length) % table.length]
                       [((ox % table[0].length) + table[0].length) % table[0].length];
        const t = v * spec.amount;
        r = lerp(r, tint[0], t); g = lerp(g, tint[1], t); b = lerp(b, tint[2], t);
      } else if (spec?.builder === 'CheckerPulse') {
        if ((x + y + frame) % 2 === 0) { r = lerp(r, 255, 0.35); g = lerp(g, 255, 0.35); b = lerp(b, 255, 0.35); }
      } else if (spec?.builder === 'Limestone') {
        // Vertical stripes, light-mid-dark-mid across four columns.
        const t = [0.25, 0, -0.25, 0][x % 4];
        const to = t > 0 ? 255 : 0;
        r = lerp(r, to, Math.abs(t)); g = lerp(g, to, Math.abs(t)); b = lerp(b, to, Math.abs(t));
      }

      // Sparkles sit on top, on alternating cells, one roll in twenty.
      if (sparkle && (x + y + frame) % 2 === 0 && sparkleRoll(x, y, frame, salt) < 1 / 20) {
        [r, g, b] = sparkle;
      }

      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const cache = new Map();

/**
 * @param {object} material
 * @param {{size?: number, frames?: number}} opts
 * @returns {{uri: string, frames: number}|null} a horizontal strip of frames,
 *   or null where no canvas is available.
 */
export function patternStrip(material, { size = 16, frames = 1 } = {}) {
  const { base, spec, animated } = recipeFor(material);
  if (!base && !spec) return null;
  const n = animated ? frames : 1;
  const key = `${material.raw.ColorDelegate ?? '-'}|${base?.join(',') ?? '-'}|${size}|${n}`;
  if (cache.has(key)) return cache.get(key);

  let canvas;
  try {
    canvas = document.createElement('canvas');
    if (!canvas.getContext) return null;
  } catch {
    return null;
  }
  canvas.width = size * n;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const tile = document.createElement('canvas');
  tile.width = tile.height = size;
  const tctx = tile.getContext('2d');
  for (let f = 0; f < n; f++) {
    paint(tctx, size, material, f);
    ctx.drawImage(tile, f * size, 0);
  }

  const result = { uri: canvas.toDataURL('image/png'), frames: n };
  cache.set(key, result);
  return result;
}
