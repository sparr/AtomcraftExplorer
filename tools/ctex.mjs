/**
 * Read a Godot 4 `.ctex` (CompressedTexture2D).
 *
 * The container is `GST2`: a small header carrying the image size, then the
 * source image embedded whole. Godot keeps lossless imports as WebP or PNG, so
 * the payload can be handed to a browser as-is rather than decoded here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAGIC = 'GST2';

/** @returns {{width, height, mime, data: Buffer}} */
export function readCtex(path) {
  const b = readFileSync(path);
  if (b.subarray(0, 4).toString('ascii') !== MAGIC) {
    throw new Error(`${path}: not a ${MAGIC} texture`);
  }
  const width = b.readUInt32LE(8);
  const height = b.readUInt32LE(12);

  const webp = b.indexOf('RIFF');
  if (webp >= 0 && b.subarray(webp + 8, webp + 12).toString('ascii') === 'WEBP') {
    const size = b.readUInt32LE(webp + 4) + 8;
    return { width, height, mime: 'image/webp', data: b.subarray(webp, webp + size) };
  }
  const png = b.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (png >= 0) return { width, height, mime: 'image/png', data: b.subarray(png) };

  throw new Error(`${path}: no embedded image (${width}x${height})`);
}

export const dataUri = ({ mime, data }) => `data:${mime};base64,${data.toString('base64')}`;

/**
 * Imported textures are named `<source>.png-<md5>.ctex`, so they are found by
 * their source name rather than by an exact filename.
 */
export function indexImported(dir) {
  const index = new Map();
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return index;
  }
  for (const name of names) {
    const m = /^(.+?)\.(png|svg)-[0-9a-f]+\.ctex$/.exec(name);
    if (m) index.set(m[1], join(dir, name));
  }
  return index;
}
