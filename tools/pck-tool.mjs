/**
 * Adapter over the two Godot .pck extractors, whichever is on PATH.
 *
 *   godotpcktool               https://github.com/hhyyrylainen/GodotPckTool
 *   GodotPCKExplorer.Console   https://github.com/DmitriySalnikov/GodotPCKExplorer
 *
 * godotpcktool is preferred because it can filter by regex: Atomcraft's pck is
 * 234 MB and we want three files out of it.  GodotPCKExplorer has no filter, so
 * that backend extracts everything and we pick through the result.
 */
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** GodotPCKExplorer.Console writes UTF-16LE to stdout; godotpcktool writes UTF-8. */
function decode(buf, utf16) {
  if (!buf?.length) return '';
  return utf16 ? buf.toString('utf16le') : buf.toString('utf8');
}

/** Walk PATH ourselves rather than shelling out -- no quoting hazards. */
function onPath(bin) {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

const BACKENDS = [
  {
    name: 'godotpcktool',
    supportsFilter: true,
    utf16: false,
    args: (pck, out, include) => [
      '-p', pck, '-a', 'extract', '-o', out, '--quieter',
      ...(include ? ['-i', include] : []),
    ],
  },
  {
    name: 'GodotPCKExplorer.Console',
    supportsFilter: false,
    utf16: true,
    args: (pck, out) => ['-e', pck, out],
  },
];

/** @returns {{name, supportsFilter, extract(pck, outDir, opts)}} */
export function findPckTool(preferred) {
  const wanted = preferred
    ? BACKENDS.filter((b) => b.name.toLowerCase() === preferred.toLowerCase())
    : BACKENDS;
  if (preferred && !wanted.length) {
    throw new Error(`unknown pck tool "${preferred}" -- ` +
                    `known: ${BACKENDS.map((b) => b.name).join(', ')}`);
  }

  for (const backend of wanted) {
    const bin = onPath(backend.name);
    if (!bin) continue;
    return {
      name: backend.name,
      bin,
      supportsFilter: backend.supportsFilter,
      extract(pck, outDir, { include } = {}) {
        const args = backend.args(pck, outDir, backend.supportsFilter ? include : null);
        const r = spawnSync(bin, args, { maxBuffer: 64 * 1024 * 1024 });
        if (r.error) throw new Error(`${backend.name}: ${r.error.message}`);
        if (r.status !== 0) {
          const out = (decode(r.stderr, backend.utf16) || decode(r.stdout, backend.utf16))
            .split('\n').slice(-12).join('\n').trim();
          throw new Error(`${backend.name} exited ${r.status}\n${out}`);
        }
      },
    };
  }

  throw new Error(
    'no Godot .pck extractor found on PATH.\n' +
    `  install one of: ${BACKENDS.map((b) => b.name).join(', ')}\n` +
    '    godotpcktool             https://github.com/hhyyrylainen/GodotPckTool\n' +
    '    GodotPCKExplorer.Console https://github.com/DmitriySalnikov/GodotPCKExplorer\n' +
    '  or skip extraction entirely with --data-dir <already-extracted dir>');
}

export const KNOWN_TOOLS = BACKENDS.map((b) => b.name);

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const b of BACKENDS) {
    const bin = onPath(b.name);
    console.log(`${b.name.padEnd(26)} ${bin ?? 'not on PATH'}` +
                (bin && b.supportsFilter ? '  (supports regex filtering)' : ''));
  }
  if (existsSync('/dev/null')) process.exit(0);
}
