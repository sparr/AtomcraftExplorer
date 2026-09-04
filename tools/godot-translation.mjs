/**
 * Decode Godot 4 OptimizedTranslation (.translation) resources.
 *
 * Godot stores translations as a perfect-hash table whose keys are only kept as
 * 32-bit hashes, so messages can be enumerated but not reversed to their key.
 * We therefore look up a caller-supplied list of candidate keys.
 */
import { readFileSync } from 'node:fs';

// --- smaz reverse codebook (254 entries) ------------------------------------
const SMAZ_RCB = [
  ' ', 'the', 'e', 't', 'a', 'of', 'o', 'and', 'i', 'n', 's', 'e ', 'r', ' th',
  ' t', 'in', 'he', 'th', 'h', 'he ', 'to', '\r\n', 'l', 's ', 'd', ' a', 'an',
  'er', 'c', ' o', 'd ', 'on', ' of', 're', 'of ', 't ', ', ', 'is', 'u', 'at',
  '   ', 'n ', 'or', 'which', 'f', 'm', 'as', 'it', 'that', '\n', 'was', 'en',
  '  ', ' w', 'es', ' an', ' i', '\r', 'f ', 'g', 'p', 'nd', ' s', 'nd ', 'ed ',
  'w', 'ed', 'http://', 'for', 'te', 'ing', 'y ', 'The', ' c', 'ti', 'r ', 'his',
  'st', ' in', 'ar', 'nt', ',', ' to', 'y', 'ng', ' h', 'with', 'le', 'al', 'to ',
  'b', 'ou', 'be', 'were', ' b', 'se', 'o ', 'ent', 'ha', 'ng ', 'their', '"',
  'hi', 'from', ' f', 'in ', 'de', 'ion', 'me', 'v', '.', 've', 'all', 're ',
  'ri', 'ro', 'is ', 'co', 'f t', 'are', 'ea', '. ', 'her', ' m', 'er ', ' p',
  'es ', 'by', 'they', 'di', 'ra', 'ic', 'not', 's, ', 'd t', 'at ', 'ce', 'la',
  'h ', 'ne', 'as ', 'tio', 'on ', 'n t', 'io', 'we', ' a ', 'om', ', a', 's o',
  'ur', 'li', 'll', 'ch', 'had', 'this', 'e t', 'g ', 'e\r\n', ' wh', 'ere',
  ' co', 'e o', 'a ', 'us', ' d', 'ss', '\n\r\n', '\r\n\r', '="', ' be', ' e',
  's a', 'ma', 'one', 't t', 'or ', 'but', 'el', 'so', 'l ', 'e s', 's,', 'no',
  'ter', ' wa', 'iv', 'ho', 'e a', ' r', 'hat', 's t', 'ns', 'ch ', 'wh', 'tr',
  'ut', '/', 'have', 'ly ', 'ta', ' ha', ' on', 'tha', '-', ' l', 'ati', 'en ',
  'pe', ' re', 'there', 'ass', 'si', ' fo', 'wa', 'ec', 'our', 'who', 'its', 'z',
  'fo', 'rs', '>', 'ot', 'un', '<', 'im', 'th ', 'nc', 'ate', '><', 'ver', 'ad',
  ' we', 'ly', 'ee', ' n', 'id', ' cl', 'ac', 'il', '</', 'rt', ' wi', 'div',
  'e, ', ' it', 'whi', ' ma', 'ge', 'x', 'e c', 'men', '.com',
];
if (SMAZ_RCB.length !== 254) throw new Error(`smaz codebook is ${SMAZ_RCB.length}, expected 254`);
const SMAZ_BYTES = SMAZ_RCB.map((s) => Buffer.from(s, 'utf8'));

function smazDecompress(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const c = data[i];
    if (c === 254) {                    // verbatim byte
      out.push(data.subarray(i + 1, i + 2));
      i += 2;
    } else if (c === 255) {             // verbatim string
      const len = data[i + 1] + 1;
      out.push(data.subarray(i + 2, i + 2 + len));
      i += 2 + len;
    } else {                            // codebook entry
      out.push(SMAZ_BYTES[c]);
      i += 1;
    }
  }
  return Buffer.concat(out);
}

/** OptimizedTranslation::hash -- an FNV-1a variant over UTF-8 bytes. */
function godotHash(d, bytes) {
  let h = d === 0 ? 0x1000193 : d;
  for (const b of bytes) h = (Math.imul(h, 0x1000193) ^ b) >>> 0;
  return h >>> 0;
}

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  u64() { const v = this.b.readBigUInt64LE(this.p); this.p += 8; return v; }
  string() {
    const n = this.u32();
    const raw = this.b.subarray(this.p, this.p + n);
    this.p += n;
    const nul = raw.indexOf(0);
    return raw.subarray(0, nul < 0 ? raw.length : nul).toString('utf8');
  }
}

// Binary-resource variant type ids we care about.
const V_NIL = 1, V_BOOL = 2, V_INT = 3, V_STRING = 5;
const V_PACKED_BYTE_ARRAY = 31, V_PACKED_INT32_ARRAY = 32;

function readVariant(r) {
  const t = r.u32();
  switch (t) {
    case V_NIL: return null;
    case V_BOOL: case V_INT: return r.u32();
    case V_STRING: return r.string();
    case V_PACKED_BYTE_ARRAY: {
      const n = r.u32();
      const v = r.b.subarray(r.p, r.p + n);
      r.p += n + ((4 - (n % 4)) % 4);          // padded to 4 bytes
      return v;
    }
    case V_PACKED_INT32_ARRAY: {
      const n = r.u32();
      const v = new Uint32Array(n);
      for (let i = 0; i < n; i++) v[i] = r.b.readUInt32LE(r.p + i * 4);
      r.p += n * 4;
      return v;
    }
    default:
      throw new Error(`unhandled variant type ${t} at ${r.p}`);
  }
}

/** Parse a binary Godot resource, returning its property map. */
export function loadTranslation(path) {
  const r = new Reader(readFileSync(path));
  if (r.b.subarray(0, 4).toString('ascii') !== 'RSRC') {
    throw new Error(`${path}: not a binary Godot resource`);
  }
  r.p = 4;
  r.u32();                    // big_endian
  r.u32();                    // use_real64
  r.u32(); r.u32();           // engine major/minor
  r.u32();                    // ver_format
  r.string();                 // top-level type
  r.u64();                    // importmd_ofs
  const flags = r.u32();
  r.u64();                    // uid (written either way)
  if (flags & 8) r.string();  // FORMAT_FLAG_HAS_SCRIPT_CLASS
  for (let i = 0; i < 11; i++) r.u32();       // RESERVED_FIELDS

  const names = [];
  for (let n = r.u32(), i = 0; i < n; i++) names.push(r.string());

  for (let n = r.u32(), i = 0; i < n; i++) {   // external resources
    r.string(); r.string();
    if (flags & 2) r.u64();                    // FORMAT_FLAG_UIDS
  }

  const internal = [];
  for (let n = r.u32(), i = 0; i < n; i++) internal.push([r.string(), r.u64()]);

  const out = {};
  for (const [, off] of internal) {
    r.p = Number(off);
    r.string();                                // resource type
    for (let n = r.u32(), i = 0; i < n; i++) out[names[r.u32()]] = readVariant(r);
  }
  return out;
}

/** Build a fn(key) -> string|null using Godot's perfect-hash scheme. */
export function makeLookup(res) {
  const ht = res.hash_table, bt = res.bucket_table, sr = res.strings;
  const htsize = ht.length;

  return function lookup(key) {
    if (!htsize) return null;
    const kb = Buffer.from(key, 'utf8');
    const p = ht[godotHash(0, kb) % htsize];
    if (p === 0xFFFFFFFF) return null;
    const size = bt[p], func = bt[p + 1];
    const h = godotHash(func, kb);
    for (let i = 0; i < size; i++) {
      const base = p + 2 + i * 4;
      if (bt[base] !== h) continue;
      const off = bt[base + 1], comp = bt[base + 2], uncomp = bt[base + 3];
      const raw = sr.subarray(off, off + comp);
      const blob = comp === uncomp ? raw : smazDecompress(raw);
      const cut = blob.subarray(0, uncomp);
      const nul = cut.indexOf(0);
      return cut.subarray(0, nul < 0 ? cut.length : nul).toString('utf8');
    }
    return null;
  };
}
