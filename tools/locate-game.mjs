/**
 * Find an installed copy of Atomcraft and, inside it, the .pck file.
 *
 * Locators are tried in order and the first hit wins.  Each returns an install
 * directory (or a .pck path directly), or null when it has nothing to offer --
 * "not installed via this store" is a normal result, not an error.
 */
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const GAME_NAME = 'Atomcraft';
export const PCK_NAME = 'Atomcraft.pck';

const exists = (p) => access(p).then(() => true, () => false);

/** An explicit path always wins: --pck, --game-dir, or the env equivalents. */
async function locateExplicit({ pck, gameDir } = {}) {
  const pckPath = pck || process.env.ATOMCRAFT_PCK;
  if (pckPath) {
    if (!(await exists(pckPath))) throw new Error(`no such file: ${pckPath}`);
    return { pck: pckPath, source: 'explicit path' };
  }
  const dir = gameDir || process.env.ATOMCRAFT_GAME_DIR;
  if (dir) {
    if (!(await exists(dir))) throw new Error(`no such directory: ${dir}`);
    return { dir, source: 'explicit game directory' };
  }
  return null;
}

async function locateSteam({ steamAppId } = {}) {
  let steam;
  try {
    ({ findSteam: steam } = await import('@ciberus/find-steam-app'));
  } catch {
    return null;                       // dependency not installed -- skip quietly
  }
  let libraries;
  try {
    ({ libraries } = await steam());
  } catch {
    return null;                       // Steam itself is not installed
  }
  for (const lib of libraries) {
    for (const app of lib.apps) {
      const name = app.manifest?.name ?? '';
      const installdir = app.manifest?.installdir ?? '';
      const hit = steamAppId
        ? app.appId === Number(steamAppId)
        : name.toLowerCase() === GAME_NAME.toLowerCase() ||
          installdir.toLowerCase() === GAME_NAME.toLowerCase();
      if (!hit) continue;
      return {
        dir: app.path,
        source: `Steam (appid ${app.appId}, ${lib.path})`,
      };
    }
  }
  return null;
}

/**
 * Itch.io installs.
 *
 * PLACEHOLDER -- the itch locator is being written separately.  Drop it in here
 * and keep the contract: resolve to { dir, source } for an install directory,
 * or null when Atomcraft is not installed through itch.  Nothing else in the
 * build needs to change.
 *
 * Until then, itch users can point the build at their install with
 * --game-dir / ATOMCRAFT_GAME_DIR.
 */
async function locateItch() {
  return null;
}

export const LOCATORS = [
  ['explicit', locateExplicit],
  ['steam', locateSteam],
  ['itch', locateItch],
];

/** Depth-limited search for the .pck inside an install directory. */
async function findPckIn(dir, depth = 3) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const packs = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.pck'));
  // The Steam build ships "AtomCraft.pck", so match the name case-insensitively;
  // failing that, a single .pck of any name is unambiguous.
  const named = packs.find((e) => e.name.toLowerCase() === PCK_NAME.toLowerCase())
             ?? (packs.length === 1 ? packs[0] : null);
  if (named) return join(dir, named.name);

  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = await findPckIn(join(dir, e.name), depth - 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * @returns {Promise<{pck: string, source: string}>}
 * @throws when the game cannot be found anywhere
 */
export async function locateGamePck(opts = {}) {
  const tried = [];
  for (const [name, locator] of LOCATORS) {
    const found = await locator(opts);
    if (!found) { tried.push(name); continue; }

    if (found.pck) {
      const st = await stat(found.pck);
      if (st.isDirectory()) {
        throw new Error(
          `${found.pck} is a directory, not a .pck file.\n` +
          `If it holds already-extracted contents, pass --data-dir instead.`);
      }
      return found;
    }
    const pck = await findPckIn(found.dir);
    if (!pck) {
      throw new Error(`found ${GAME_NAME} at ${found.dir} (${found.source}) ` +
                      `but no .pck file inside it`);
    }
    return { pck, source: found.source };
  }

  throw new Error(
    `could not find an installed copy of ${GAME_NAME}.\n` +
    `  checked: ${tried.join(', ')}\n` +
    `  itch support is not implemented yet -- see tools/locate-game.mjs\n` +
    `\n` +
    `  Point the build at it directly with one of:\n` +
    `    node tools/build-data.mjs --pck /path/to/${PCK_NAME}\n` +
    `    node tools/build-data.mjs --game-dir /path/to/game\n` +
    `    ATOMCRAFT_PCK=/path/to/${PCK_NAME} npm run build-data`);
}

// Small CLI so the locator can be exercised on its own.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  try {
    const r = await locateGamePck({ pck: flag('--pck'), gameDir: flag('--game-dir'),
                                    steamAppId: flag('--steam-appid') });
    console.log(`${r.pck}\n  via ${r.source}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
