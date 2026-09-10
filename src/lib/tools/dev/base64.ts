/**
 * Base64 and Base64URL, implemented over `Uint8Array` so the exact same code
 * path serves the text tool and the file tools.
 *
 * Why not `btoa` / `atob`? `btoa` throws on any code point above U+00FF, and
 * the widespread `btoa(unescape(encodeURIComponent(s)))` workaround relies on
 * the deprecated `unescape` and silently mangles lone surrogates. Going through
 * `TextEncoder` / `TextDecoder` is both correct for the full Unicode range
 * (including emoji and combining marks) and byte-exact for binary input.
 */

const STANDARD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Symbol -> 6-bit value. Both alphabets are present so the decoder is tolerant
 * by default; `strictAlphabet` re-imposes the distinction when a caller cares.
 */
const REVERSE = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < 64; i += 1) table[STANDARD_ALPHABET.charCodeAt(i)] = i;
  table[0x2d] = 62; // '-'
  table[0x5f] = 63; // '_'
  return table;
})();

const PAD = 0x3d; // '='

/** Thrown for input that cannot be interpreted as Base64 at all. */
export class Base64Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Base64Error';
  }
}

export interface EncodeBase64Options {
  /** Use `-` and `_` instead of `+` and `/`. */
  urlSafe?: boolean;
  /**
   * Break the output into lines of this many characters. 76 is the MIME
   * convention (RFC 2045) and the only value worth offering in a UI. 0 or
   * undefined means one long line.
   */
  wrapAt?: number;
  /** Leave the `=` off the end. Wins over `padding` when both are given. */
  noPadding?: boolean;
  /** Older spelling of `wrapAt`: wrap at `lineLength`, default 76. */
  lineBreaks?: boolean;
  /** Characters per line when `lineBreaks` is on. RFC 2045 says 76. */
  lineLength?: number;
  lineEnding?: '\n' | '\r\n';
  /** Emit `=` padding. Defaults to `true`, or `false` when `urlSafe` is set. */
  padding?: boolean;
}

export interface DecodeBase64Options {
  /**
   * Which alphabet the caller believes the input uses. On its own this is only
   * a hint — decoding accepts either variant unless `strictAlphabet` is set.
   */
  urlSafe?: boolean;
  /**
   * Reject symbols belonging to the other alphabet instead of decoding them.
   * Off by default: pasted Base64 is very often the "wrong" variant and
   * decoding it anyway is what the user actually wants.
   */
  strictAlphabet?: boolean;
}

function wrapLines(text: string, lineLength: number, lineEnding: string): string {
  if (lineLength <= 0 || text.length <= lineLength) return text;
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += lineLength) {
    lines.push(text.slice(i, i + lineLength));
  }
  return lines.join(lineEnding);
}

/** Encode raw bytes. This is the primitive every other encoder here calls. */
export function encodeBytes(bytes: Uint8Array, options: EncodeBase64Options = {}): string {
  const urlSafe = options.urlSafe === true;
  const alphabet = urlSafe ? URL_SAFE_ALPHABET : STANDARD_ALPHABET;
  const padded = options.noPadding !== undefined ? !options.noPadding : (options.padding ?? !urlSafe);

  const parts: string[] = [];
  let chunk = '';
  const wholeGroups = bytes.length - (bytes.length % 3);

  for (let i = 0; i < wholeGroups; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk +=
      alphabet[(triple >> 18) & 63] +
      alphabet[(triple >> 12) & 63] +
      alphabet[(triple >> 6) & 63] +
      alphabet[triple & 63];
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }

  const remainder = bytes.length - wholeGroups;
  if (remainder === 1) {
    const value = bytes[wholeGroups] << 16;
    chunk += alphabet[(value >> 18) & 63] + alphabet[(value >> 12) & 63] + (padded ? '==' : '');
  } else if (remainder === 2) {
    const value = (bytes[wholeGroups] << 16) | (bytes[wholeGroups + 1] << 8);
    chunk +=
      alphabet[(value >> 18) & 63] +
      alphabet[(value >> 12) & 63] +
      alphabet[(value >> 6) & 63] +
      (padded ? '=' : '');
  }
  parts.push(chunk);

  const encoded = parts.join('');
  const lineLength = options.wrapAt ?? (options.lineBreaks ? (options.lineLength ?? 76) : 0);
  if (!(lineLength > 0)) return encoded;
  return wrapLines(encoded, lineLength, options.lineEnding ?? '\n');
}

/** Encode a JavaScript string as UTF-8 bytes, then Base64. */
export function encodeBase64(input: string, options: EncodeBase64Options = {}): string {
  return encodeBytes(new TextEncoder().encode(input), options);
}

/**
 * Encode raw bytes. Same function as `encodeBytes`, under the name the file
 * tools and the UI use, so that `bytesToBase64` / `base64ToBytes` read as a
 * matched pair.
 */
export function bytesToBase64(bytes: Uint8Array, options: EncodeBase64Options = {}): string {
  return encodeBytes(bytes, options);
}

export type DecodeBytesResult =
  | { ok: true; bytes: Uint8Array; warnings: string[] }
  | { ok: false; error: string };

export type DecodeTextResult =
  | { ok: true; text: string; warnings: string[] }
  | { ok: false; error: string };

/** Name a character in an error message without printing an invisible one. */
function describeChar(input: string, index: number): string {
  const point = input.codePointAt(index) ?? 0;
  if (point < 0x20 || point === 0x7f) {
    return `a control character (U+${point.toString(16).toUpperCase().padStart(4, '0')})`;
  }
  return `"${String.fromCodePoint(point)}"`;
}

/**
 * The one decoder. Deliberately forgiving, because the input is nearly always
 * something a person copied out of a log, a header or an email, and every
 * repair it makes is reported in `warnings` rather than performed silently:
 *
 *  - whitespace and line breaks anywhere are ignored (MIME wraps at 76);
 *  - both alphabets are accepted, and mixing them is a warning, not an error;
 *  - missing `=` padding is added back (Base64URL normally omits it);
 *  - only two things are fatal: a character that is in neither alphabet, and a
 *    length that no Base64 string can have.
 */
function decodeToBytes(input: string, options: DecodeBase64Options = {}): DecodeBytesResult {
  const warnings: string[] = [];
  const symbols = new Uint8Array(input.length);
  let count = 0;
  let padCount = 0;
  let firstPadAt = -1;
  let strippedWhitespace = false;
  let sawStandard = false;
  let sawUrlSafe = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) {
      strippedWhitespace = true;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code === PAD) {
      padCount += 1;
      if (firstPadAt < 0) firstPadAt = i;
      continue;
    }
    const value = code < 128 ? REVERSE[code] : -1;
    if (value === undefined || value < 0) {
      return {
        ok: false,
        error:
          `${describeChar(input, i)} at position ${i + 1} is not a Base64 character. ` +
          'Base64 only uses A-Z, a-z, 0-9, either + / or - _, and = at the end.',
      };
    }
    if (padCount > 0) {
      return {
        ok: false,
        error:
          `There is a "=" at position ${firstPadAt + 1} but the data carries on afterwards. ` +
          'The = padding can only ever come last, so two separate strings have probably been joined together.',
      };
    }
    if (code === 0x2b || code === 0x2f) sawStandard = true;
    if (code === 0x2d || code === 0x5f) sawUrlSafe = true;
    symbols[count] = value;
    count += 1;
  }

  if (options.strictAlphabet) {
    if (options.urlSafe && sawStandard) {
      return {
        ok: false,
        error: 'This uses the standard characters + and /, but URL-safe Base64 (- and _) was expected.',
      };
    }
    if (!options.urlSafe && sawUrlSafe) {
      return {
        ok: false,
        error: 'This uses the URL-safe characters - and _, but standard Base64 (+ and /) was expected.',
      };
    }
  }

  const leftover = count % 4;
  if (leftover === 1) {
    return {
      ok: false,
      error:
        `This cannot be Base64: it has ${count} characters, and a Base64 string never ends with a single ` +
        'character left over. Something was cut off when it was copied.',
    };
  }

  if (strippedWhitespace) {
    warnings.push('Spaces and line breaks were ignored, which is normal for Base64 that has been wrapped for email.');
  }
  if (sawStandard && sawUrlSafe) {
    warnings.push(
      'This mixes the standard alphabet (+ and /) with the URL-safe one (- and _). Both were accepted, ' +
        'but one of them is probably a copy-and-paste mistake.',
    );
  }
  const expectedPad = leftover === 0 ? 0 : 4 - leftover;
  if (padCount === 0 && expectedPad > 0) {
    warnings.push(
      `The "=" padding was missing from the end, so ${expectedPad === 1 ? 'one was' : 'two were'} added. ` +
        'Base64URL, used by web tokens, normally leaves it off.',
    );
  } else if (padCount !== expectedPad) {
    warnings.push(
      `The end had ${padCount} "=" where ${expectedPad} belongs. The padding was ignored and worked out from the data instead.`,
    );
  }

  // A correct encoder leaves the unused low bits of the last character at zero.
  // Anything else still decodes, but it means the string is not what its author
  // produced, so say so.
  const last = count > 0 ? (symbols[count - 1] ?? 0) : 0;
  if ((leftover === 2 && (last & 0x0f) !== 0) || (leftover === 3 && (last & 0x03) !== 0)) {
    warnings.push(
      'The last character carries bits that a correct encoder would have left at zero. They were ignored, ' +
        'but the string may have been edited by hand.',
    );
  }

  const bytes = new Uint8Array((count * 6) >> 3);
  let out = 0;
  for (let i = 0; i + 3 < count; i += 4) {
    const quad =
      ((symbols[i] ?? 0) << 18) |
      ((symbols[i + 1] ?? 0) << 12) |
      ((symbols[i + 2] ?? 0) << 6) |
      (symbols[i + 3] ?? 0);
    bytes[out] = (quad >> 16) & 0xff;
    bytes[out + 1] = (quad >> 8) & 0xff;
    bytes[out + 2] = quad & 0xff;
    out += 3;
  }
  if (leftover === 2) {
    const pair = ((symbols[count - 2] ?? 0) << 18) | ((symbols[count - 1] ?? 0) << 12);
    bytes[out] = (pair >> 16) & 0xff;
  } else if (leftover === 3) {
    const trio =
      ((symbols[count - 3] ?? 0) << 18) |
      ((symbols[count - 2] ?? 0) << 12) |
      ((symbols[count - 1] ?? 0) << 6);
    bytes[out] = (trio >> 16) & 0xff;
    bytes[out + 1] = (trio >> 8) & 0xff;
  }

  return { ok: true, bytes, warnings };
}

/** Decode to raw bytes. Use this for anything that is not text. */
export function base64ToBytes(
  input: string,
  options: DecodeBase64Options = {},
): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  const decoded = decodeToBytes(input, options);
  return decoded.ok ? { ok: true, bytes: decoded.bytes } : decoded;
}
/**
 * Is this byte sequence something a person can read?
 *
 * Valid UTF-8, no NUL, and almost no other control characters. Used to decide
 * between showing the decoded text and offering it as a file download, so a
 * false positive (mojibake on screen) is worse than a false negative.
 */
export function isProbablyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return false;
  }
  let controls = 0;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1;
  }
  return controls / bytes.length <= 0.05;
}

/**
 * Decode to text.
 *
 * `ignoreBOM` is on so a decode is byte-exact: the default `TextDecoder`
 * quietly eats a leading U+FEFF, which would make `decode(encode(x)) !== x` for
 * text that starts with one. It is reported as a warning instead.
 *
 * Binary input is refused rather than shown, because a lossy `TextDecoder` would
 * hand back a screenful of U+FFFD and let the user believe that is the content.
 */
export function decodeBase64(input: string, options: DecodeBase64Options = {}): DecodeTextResult {
  const decoded = decodeToBytes(input, options);
  if (!decoded.ok) return decoded;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decoded.bytes);
  } catch {
    return {
      ok: false,
      error:
        'This Base64 holds a file, not text: the bytes are not valid UTF-8, so there is nothing readable to ' +
        'show. Use "download as file" to save it and open it in the app it belongs to (an image viewer, a PDF ' +
        'reader, an archiver).',
    };
  }
  const warnings = decoded.warnings;
  if (text.charCodeAt(0) === 0xfeff) {
    warnings.push(
      'The text starts with a byte-order mark, an invisible character some Windows editors add. It has been ' +
        'kept so the result matches the original exactly, but it can break a config file or a CSV header.',
    );
  }
  return { ok: true, text, warnings };
}
/**
 * Could this text be Base64?
 *
 * A guess, used to pick the starting mode of the tool and to offer "this looks
 * encoded — decode it?" Two deliberate concessions to reality:
 *
 *  - Short input says no. "test" is valid Base64 for three bytes of nonsense,
 *    and four characters is the shortest string worth asking about.
 *  - Whitespace *inside* the text is only accepted when the remaining length is
 *    a multiple of four. Wrapped Base64 always is (an encoder that wraps also
 *    pads), whereas "hello world" — which is otherwise all Base64 characters —
 *    is not, and answering yes to prose would be worse than missing a case.
 */
export function looksLikeBase64(input: string): boolean {
  const compact = input.replace(/\s+/g, '');
  if (compact.length < 4) return false;
  if (compact.length !== input.trim().length && compact.length % 4 !== 0) return false;
  const body = compact.replace(/=+$/, '');
  if (compact.length - body.length > 2) return false;
  if (body.length % 4 === 1) return false;
  for (let i = 0; i < body.length; i += 1) {
    const code = body.charCodeAt(i);
    if (code > 127) return false;
    const value = REVERSE[code];
    if (value === undefined || value < 0) return false;
  }
  return true;
}
