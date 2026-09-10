/**
 * UUIDs, and the two shorter identifiers people reach for alongside them.
 *
 * Every random bit here comes from `crypto.getRandomValues`. `Math.random` is a
 * fast non-cryptographic PRNG: its output is predictable from a handful of
 * samples and two tabs can end up on the same stream, so an identifier built
 * from it is not unique in any sense you can rely on. Nothing here calls it.
 *
 * `crypto.randomUUID()` exists and is a perfectly good v4, but it is missing on
 * an insecure origin (plain http, which includes a lot of LAN dev setups) and it
 * cannot make a v7, so the bytes are assembled here instead and every version
 * shares one code path.
 *
 * Isomorphic: Web Crypto is a global in Node 18+ and in every browser.
 */

/** Which flavour to make. `nil` and `max` are the two fixed constants. */
export type UuidVersion = 'v4' | 'v7' | 'nil' | 'max';

/** All zeros: the agreed way to write "no UUID here". */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** All ones, reserved by RFC 9562 as the largest UUID there can be. */
export const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/**
 * Most this tool will mint in one go; see `generateUuids`.
 *
 * Exported because the page that offers a count has to agree with the engine
 * that refuses one. Two copies of this number would eventually disagree, and the
 * user would meet the disagreement as a field that accepts a value the tool then
 * rejects.
 */
export const MAX_UUID_BATCH = 10_000;

const MAX_BATCH = MAX_UUID_BATCH;

const HEX_DIGITS = '0123456789abcdef';

function randomBytes(count: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(count));
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += HEX_DIGITS[bytes[i] >> 4] + HEX_DIGITS[bytes[i] & 15];
  }
  return out;
}

/** Group 32 hex digits as 8-4-4-4-12. */
function hyphenate(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 16 bytes as canonical lowercase 8-4-4-4-12 hex. */
function formatUuid(bytes: Uint8Array): string {
  return hyphenate(toHex(bytes));
}

/**
 * Write the two fields RFC 9562 pins down: the version goes in the high nibble
 * of byte 6, and the top two bits of byte 8 become `10` to mark the variant. Six
 * of the 128 bits are therefore not random, which is why the third group of a v4
 * always starts with `4` and the fourth always starts with 8, 9, a or b.
 */
function stampVersion(bytes: Uint8Array, version: number): void {
  bytes[6] = (bytes[6] & 0x0f) | (version << 4);
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
}

/** 122 random bits and nothing else. */
function uuidV4(): string {
  const bytes = randomBytes(16);
  stampVersion(bytes, 4);
  return formatUuid(bytes);
}

// v7 state. The 12 bits after the version nibble hold a counter that is seeded
// low at the top of each millisecond and bumped for every UUID minted inside it.
// Without it, two v7s made in the same millisecond would differ only in their
// random tail and so land in random order — which defeats the one thing v7 is
// for. RFC 9562 §6.2 calls this the "monotonic random" method.
let lastMillisecond = -1;
let sequence = 0;

/**
 * Time-ordered: 48 bits of big-endian Unix milliseconds, then the version, then
 * the counter, then 62 bits of randomness. Two of these compare in creation
 * order as plain strings, which is why databases index them so much better than
 * a v4.
 */
function uuidV7(): string {
  const bytes = randomBytes(16);
  let ms = Date.now();
  if (ms > lastMillisecond) {
    // Seed from randomness but keep it small, so there is room to count up.
    sequence = bytes[7];
  } else {
    // Same millisecond, or a clock that went backwards (NTP, sleep/wake). Reuse
    // the last timestamp so the sequence can never go down.
    ms = lastMillisecond;
    sequence += 1;
    if (sequence > 0xfff) {
      ms = lastMillisecond + 1;
      sequence = 0;
    }
  }
  lastMillisecond = ms;
  // Split at 2^32 rather than shifting: bitwise operators would truncate a
  // millisecond count that has been larger than 32 bits since 1970 plus 49 days.
  const high = Math.floor(ms / 0x1_0000_0000);
  const low = ms % 0x1_0000_0000;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
  stampVersion(bytes, 7);
  bytes[6] = (bytes[6] & 0xf0) | ((sequence >>> 8) & 0x0f);
  bytes[7] = sequence & 0xff;
  return formatUuid(bytes);
}

/** One UUID of the requested flavour. Defaults to v4, which is what most people mean. */
export function generateUuid(version: UuidVersion = 'v4'): string {
  if (version === 'nil') return NIL_UUID;
  if (version === 'max') return MAX_UUID;
  if (version === 'v7') return uuidV7();
  return uuidV4();
}

export interface UuidFormatOptions {
  version?: UuidVersion;
  /** `ABCDEF…` instead of `abcdef…`. The value is identical either way. */
  uppercase?: boolean;
  /** Wrap in `{}`, the form Windows and C# tooling prints. */
  braces?: boolean;
  /** Drop the dashes: 32 bare hex digits, as used in URLs and some databases. */
  noHyphens?: boolean;
}

export type GenerateUuidsResult =
  | { ok: true; uuids: string[] }
  | { ok: false; error: string };

/**
 * Rewrite a canonical UUID in the form the user asked for.
 *
 * Exported because the page holds its batch in canonical form and re-writes it
 * on the way to the screen, so that toggling uppercase changes how the ids are
 * written rather than replacing them with different ids — a user who has already
 * pasted one somewhere would otherwise lose it. Both consumers therefore have to
 * agree on what "uppercase, braces, no hyphens" means, and this is the one
 * implementation of that.
 */
export function formatUuidText(uuid: string, options: UuidFormatOptions = {}): string {
  let out = options.noHyphens ? uuid.replace(/-/g, '') : uuid;
  if (options.uppercase) out = out.toUpperCase();
  return options.braces ? `{${out}}` : out;
}

export type BatchCountResult = { ok: true } | { ok: false; error: string };

/**
 * Is this a count a batch generator can honour?
 *
 * Separate from {@link generateUuids} because the same four refusals apply to
 * the NanoID and ObjectId batches next to it, which are not UUIDs and are not
 * produced by that function. One implementation means the four sentences and the
 * cap cannot drift apart between them; `noun` only changes what the sentences
 * call the thing being counted.
 */
export function validateBatchCount(count: number, noun = 'UUID'): BatchCountResult {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return { ok: false, error: `Enter how many ${noun}s you want, as a number.` };
  }
  if (!Number.isInteger(count)) {
    return { ok: false, error: `Ask for a whole number of ${noun}s — ${count} is not one.` };
  }
  if (count < 1) {
    return { ok: false, error: `Ask for at least one ${noun}.` };
  }
  if (count > MAX_BATCH) {
    return {
      ok: false,
      error: `That is more than this page can show at once. Ask for up to ${MAX_BATCH.toLocaleString('en-US')} ${noun}s.`,
    };
  }
  return { ok: true };
}

/**
 * A batch, in whichever written form the user picked.
 *
 * The cap is a UI limit rather than a technical one: ten thousand is already
 * more than anyone pastes anywhere, and a million would freeze the tab while it
 * rendered them.
 */
export function generateUuids(count: number, opts: UuidFormatOptions = {}): GenerateUuidsResult {
  const allowed = validateBatchCount(count);
  if (!allowed.ok) return allowed;
  const uuids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    uuids.push(formatUuidText(generateUuid(opts.version ?? 'v4'), opts));
  }
  return { ok: true, uuids };
}

export interface UuidInfo {
  /** True for any well-formed 128-bit UUID, whatever version it claims. */
  valid: boolean;
  /** The version nibble, or null for the nil/max constants and for bad input. */
  version: number | null;
  /** Which family of UUID layouts this is. Anything modern is `RFC 4122`. */
  variant: string;
  isNil: boolean;
  isMax: boolean;
  /** ISO 8601, for the versions that actually carry a time (1, 6 and 7). */
  timestamp: string | null;
  /** Canonical lowercase hyphenated form, or '' when the input was not a UUID. */
  normalised: string;
  /** One sentence for the page to show. */
  note: string;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const THIRTY_TWO_HEX = /^[0-9a-f]{32}$/;

/** 1582-10-15, the start of the Gregorian calendar, to 1970-01-01 in ms. */
const GREGORIAN_EPOCH_OFFSET_MS = 12_219_292_800_000;

/** The furthest a JavaScript `Date` reaches either side of 1970. */
const MAX_DATE_MS = 8.64e15;

function invalidUuid(note: string): UuidInfo {
  return {
    valid: false,
    version: null,
    variant: 'unknown',
    isNil: false,
    isMax: false,
    timestamp: null,
    normalised: '',
    note,
  };
}

/** The top three bits of byte 8 choose the layout. Only `10x` is the modern one. */
function variantOf(byte8: number): string {
  const top = byte8 >> 5;
  if (top <= 3) return 'NCS (Apollo, pre-1997)';
  if (top <= 5) return 'RFC 4122';
  if (top === 6) return 'Microsoft GUID';
  return 'reserved';
}

function isoOrNull(ms: number): string | null {
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return null;
  return new Date(ms).toISOString();
}

/**
 * Recover the creation time from the versions that store one.
 *
 * v1 and v6 count 100-nanosecond ticks since 1582; the product exceeds the 2^53
 * a double holds exactly, so the last few ticks are lost — an error of well under
 * a microsecond, which cannot move the millisecond this reports. v7 stores plain
 * 48-bit Unix milliseconds and is exact.
 */
function timestampFor(version: number, hex: string): string | null {
  if (version === 1) {
    const ticks =
      parseInt(hex.slice(13, 16), 16) * 2 ** 48 +
      parseInt(hex.slice(8, 12), 16) * 2 ** 32 +
      parseInt(hex.slice(0, 8), 16);
    return isoOrNull(Math.floor(ticks / 10_000) - GREGORIAN_EPOCH_OFFSET_MS);
  }
  if (version === 6) {
    const ticks =
      parseInt(hex.slice(0, 8), 16) * 2 ** 28 +
      parseInt(hex.slice(8, 12), 16) * 2 ** 12 +
      parseInt(hex.slice(13, 16), 16);
    return isoOrNull(Math.floor(ticks / 10_000) - GREGORIAN_EPOCH_OFFSET_MS);
  }
  if (version === 7) return isoOrNull(parseInt(hex.slice(0, 12), 16));
  return null;
}

const VERSION_NOTES: Record<number, string> = {
  1: 'Version 1 encodes when it was made and the network card of the machine that made it, so it gives away more than most people expect.',
  2: 'Version 2 is the DCE Security layout, which embeds a user or group id. You will almost never meet one.',
  3: 'Version 3 is an MD5 hash of a name inside a namespace, so the same name always gives the same UUID. It carries no time.',
  4: 'Version 4 is 122 random bits and nothing else, so there is no time to recover from it — if you need the time, use version 7.',
  5: 'Version 5 is a SHA-1 hash of a name inside a namespace, so the same name always gives the same UUID. It carries no time.',
  6: 'Version 6 is version 1 with the time bytes reordered so that sorting the text sorts by age.',
  7: 'Version 7 begins with the Unix time in milliseconds, so these sort by age and index well in a database.',
  8: 'Version 8 is reserved for custom layouts, so only whoever designed it knows what the bits mean.',
};

/**
 * Read a UUID however it was written: uppercase, wrapped in braces, with the
 * dashes left out, or as a `urn:uuid:` URI. `normalised` is always the canonical
 * lowercase hyphenated form, which is the one to store and to compare.
 *
 * `valid` means "well formed", not "made by something sensible": a UUID with an
 * undefined version or a non-RFC variant is still a real 128-bit value, and the
 * note says what is odd about it rather than rejecting it.
 */
export function inspectUuid(input: string): UuidInfo {
  if (typeof input !== 'string' || input.trim() === '') {
    return invalidUuid('Paste a UUID to look at.');
  }
  let text = input.trim().toLowerCase();
  if (text.startsWith('{') && text.endsWith('}')) text = text.slice(1, -1).trim();
  if (text.startsWith('urn:uuid:')) text = text.slice('urn:uuid:'.length).trim();

  const hex = CANONICAL_UUID.test(text) ? text.replace(/-/g, '') : text;
  if (!THIRTY_TWO_HEX.test(hex)) {
    if (THIRTY_TWO_HEX.test(text.replace(/-/g, ''))) {
      return invalidUuid('Those are the right 32 digits, but the dashes are in the wrong places — the groups run 8-4-4-4-12.');
    }
    return invalidUuid(
      'That is not a UUID. A UUID is 32 hex digits, usually written in five groups like 123e4567-e89b-12d3-a456-426614174000.',
    );
  }

  const normalised = hyphenate(hex);
  const isNil = hex === '0'.repeat(32);
  const isMax = hex === 'f'.repeat(32);
  if (isNil || isMax) {
    return {
      valid: true,
      version: null,
      variant: 'special',
      isNil,
      isMax,
      timestamp: null,
      normalised,
      note: isNil
        ? 'This is the nil UUID — all zeros. It is the standard way of saying "no UUID", the way an empty string says "no text".'
        : 'This is the max UUID — all ones. RFC 9562 reserves it as the largest possible value, useful as an upper bound in a range query.',
    };
  }

  const version = parseInt(hex[12], 16);
  const variant = variantOf(parseInt(hex.slice(16, 18), 16));
  const note =
    VERSION_NOTES[version] ??
    `The digits are fine, but ${version} is not a version anyone has defined, so this came from something non-standard.`;
  return {
    valid: true,
    version,
    variant,
    isNil: false,
    isMax: false,
    timestamp: timestampFor(version, hex),
    normalised,
    note:
      variant === 'RFC 4122'
        ? note
        : `${note} The variant bits say ${variant} rather than RFC 4122, which is unusual today.`,
  };
}

/** 64 URL-safe symbols: A-Z, a-z, 0-9, `_` and `-`. */
const NANO_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const NANO_DEFAULT_LENGTH = 21;
const NANO_MAX_LENGTH = 512;

/**
 * A short URL-safe random id. The 21-character default over the 64-symbol
 * alphabet is 126 bits, a shade more than the 122 in a v4 UUID, in 21 characters
 * instead of 36.
 *
 * Sampling is by rejection, never `byte % size`: 256 is not a multiple of most
 * alphabet lengths, so the modulo would make the first `256 % size` symbols
 * measurably more likely than the rest. Any draw landing in the incomplete final
 * block is thrown away and redrawn instead.
 *
 * Bad arguments are corrected rather than thrown, because this returns a plain
 * string and has nowhere to put an error message. A length outside 1-512 is
 * clamped; an alphabet is split by code point (so emoji count as one symbol) and
 * de-duplicated, since a repeated symbol would quietly skew the distribution;
 * and an alphabet left with fewer than two distinct symbols — which could carry
 * no information at all — falls back to the default.
 */
export function generateNanoId(length = NANO_DEFAULT_LENGTH, alphabet = NANO_ALPHABET): string {
  const wanted = Number.isFinite(length) ? Math.trunc(length) : NANO_DEFAULT_LENGTH;
  const count = Math.min(NANO_MAX_LENGTH, Math.max(1, wanted));
  const distinct = [...new Set(typeof alphabet === 'string' ? [...alphabet] : [])];
  // Above 65,536 symbols a 16-bit draw can no longer address the alphabet, which
  // is far past any real use, so the default takes over.
  const symbols = distinct.length >= 2 && distinct.length <= 65_536 ? distinct : [...NANO_ALPHABET];
  const size = symbols.length;
  const width = size <= 256 ? 1 : 2;
  const range = width === 1 ? 256 : 65_536;
  const limit = range - (range % size);

  let out = '';
  // A little over the ideal, so the common case needs one call to the CSPRNG.
  const poolSize = Math.ceil(count * width * 1.3) + 8;
  let pool = randomBytes(poolSize);
  let at = 0;
  while (out.length < count) {
    if (at + width > pool.length) {
      pool = randomBytes(poolSize);
      at = 0;
    }
    const draw = width === 1 ? pool[at] : (pool[at] << 8) | pool[at + 1];
    at += width;
    if (draw < limit) out += symbols[draw % size];
  }
  return out;
}

// ObjectId state. Mongo's own drivers pick five random bytes once per process
// and only move the counter after that, so two ids made in the same second still
// differ and still sort by creation order. That is copied here rather than making
// all eight bytes random, so the output matches what a Mongo driver would produce.
let objectIdRandom: Uint8Array | null = null;
let objectIdCounter = 0;

/**
 * A MongoDB-style ObjectId: 4 bytes of Unix seconds, 5 random bytes fixed for
 * the life of the page, then a 3-byte counter, as 24 hex characters.
 *
 * Note the resolution of the time part is one second, not one millisecond, so
 * sorting by ObjectId sorts by the counter inside any given second — accurate for
 * ids made by one process, approximate across several.
 */
export function generateObjectId(): string {
  if (objectIdRandom === null) {
    objectIdRandom = randomBytes(5);
    // Seeded randomly so two processes starting in the same second do not mint
    // the same ids.
    const seed = randomBytes(3);
    objectIdCounter = ((seed[0] << 16) | (seed[1] << 8) | seed[2]) & 0xff_ffff;
  }
  objectIdCounter = (objectIdCounter + 1) & 0xff_ffff;

  const bytes = new Uint8Array(12);
  const seconds = Math.floor(Date.now() / 1000);
  bytes[0] = (seconds >>> 24) & 0xff;
  bytes[1] = (seconds >>> 16) & 0xff;
  bytes[2] = (seconds >>> 8) & 0xff;
  bytes[3] = seconds & 0xff;
  bytes.set(objectIdRandom, 4);
  bytes[9] = (objectIdCounter >>> 16) & 0xff;
  bytes[10] = (objectIdCounter >>> 8) & 0xff;
  bytes[11] = objectIdCounter & 0xff;
  return toHex(bytes);
}
