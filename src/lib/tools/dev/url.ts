/**
 * URL encoding, decoding, parsing and building.
 *
 * The platform does the standards work — `encodeURIComponent`, `encodeURI` and
 * the WHATWG `URL` class. Everything here exists because those three fail in
 * ways a tool page cannot afford:
 *
 *  - `decodeURIComponent` throws a bare `URIError` on a truncated escape such as
 *    `%E0%A4%A`, with no indication of where the problem is. The decoder below
 *    walks the text itself and names the position.
 *  - `new URL` throws on a scheme-less address, which is exactly what people
 *    paste. `parseUrl` retries with `https://` and reports the assumption.
 *  - neither says anything about the parts worth flagging to a human: a password
 *    sitting in the link, a raw space that means the URL was cut in half, a
 *    punycode host, a port a firewall will block.
 *
 * Isomorphic: `TextEncoder`, `TextDecoder` and `URL` only, no DOM, no network.
 */

import { base64ToBytes } from './base64.ts';

export interface EncodeUrlOptions {
  /**
   * Write a space as `+` instead of `%20`. Correct inside a query string (it is
   * what an HTML form sends) and wrong everywhere else: in a path segment a `+`
   * is a literal plus sign.
   */
  plusForSpace?: boolean;
}

/**
 * Percent-encode one value — a query parameter, a path segment, a fragment.
 *
 * Keeps `encodeURIComponent` semantics, so `-_.!~*'()` are left alone. They are
 * legal in every position a component can appear in, and encoding them makes the
 * result harder to read for no gain.
 */
export function encodeUrlComponent(text: string, opts: EncodeUrlOptions = {}): string {
  const encoded = encodeURIComponent(text);
  return opts.plusForSpace ? encoded.replace(/%20/g, '+') : encoded;
}

/**
 * Percent-encode a whole URL, leaving the punctuation that gives it structure
 * (`: / ? # [ ] @ ! $ & ' ( ) * + , ; =`) intact. This is what you want for
 * "make this address safe to put in a link"; use `encodeUrlComponent` for a
 * value that goes *inside* an address.
 */
export function encodeFullUrl(text: string): string {
  return encodeURI(text);
}

export type DecodeUrlResult =
  | { ok: true; text: string; warnings: string[] }
  | { ok: false; error: string };

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

interface PercentBytes {
  bytes: Uint8Array;
  /** For each byte, the 1-based character position it came from. */
  positions: number[];
  /** How many `+` were read as spaces. */
  pluses: number;
}

/**
 * Percent-decode to bytes, remembering where each byte came from so that an
 * invalid UTF-8 sequence can be reported at a position in the *text* the user
 * pasted rather than at a byte offset they cannot see.
 */
function percentDecodeToBytes(
  text: string,
  plusForSpace: boolean,
): { ok: true; value: PercentBytes } | { ok: false; error: string } {
  const encoder = new TextEncoder();
  const out: number[] = [];
  const positions: number[] = [];
  let pluses = 0;

  for (let i = 0; i < text.length; ) {
    const ch = text[i] ?? '';
    if (ch === '%') {
      const pair = text.slice(i + 1, i + 3);
      if (!HEX_PAIR.test(pair)) {
        return {
          ok: false,
          error:
            `There is a "%" at position ${i + 1} that is not followed by two hex digits ` +
            `(it reads "${text.slice(i, i + 3)}"). In a URL a % always starts a code such as %20, ` +
            'and a percent sign that is meant literally has to be written %25.',
        };
      }
      out.push(Number.parseInt(pair, 16));
      positions.push(i + 1);
      i += 3;
      continue;
    }
    if (ch === '+' && plusForSpace) {
      pluses += 1;
      out.push(0x20);
      positions.push(i + 1);
      i += 1;
      continue;
    }
    // A literal character contributes its own UTF-8 bytes. Read by code point so
    // an emoji is not split into surrogates.
    const point = text.codePointAt(i) ?? 0;
    const unit = String.fromCodePoint(point);
    for (const byte of encoder.encode(unit)) {
      out.push(byte);
      positions.push(i + 1);
    }
    i += unit.length;
  }

  return { ok: true, value: { bytes: new Uint8Array(out), positions, pluses } };
}
/**
 * Byte index of the first byte a strict UTF-8 decoder chokes on, or null when the
 * whole sequence is valid. Found by feeding the platform decoder one byte at a
 * time in streaming mode, so the answer is the platform's own definition of
 * invalid rather than a hand-written table that might disagree with it.
 */
function firstInvalidUtf8Byte(bytes: Uint8Array): number | null {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  for (let i = 0; i < bytes.length; i += 1) {
    try {
      decoder.decode(bytes.subarray(i, i + 1), { stream: true });
    } catch {
      return i;
    }
  }
  try {
    decoder.decode();
  } catch {
    // The bytes ran out in the middle of a character.
    return Math.max(0, bytes.length - 1);
  }
  return null;
}

/**
 * Decode one percent-encoded value. Never throws.
 *
 * `+` is read as a space by default, because that is what a form sends and what
 * the text being pasted almost always came from — and a warning says so, since
 * the alternative reading (a literal plus) is the one that bites.
 */
export function decodeUrlComponent(text: string, opts: EncodeUrlOptions = {}): DecodeUrlResult {
  if (text === '') return { ok: true, text: '', warnings: [] };
  const plusForSpace = opts.plusForSpace ?? true;

  const decoded = percentDecodeToBytes(text, plusForSpace);
  if (!decoded.ok) return decoded;
  const { bytes, positions, pluses } = decoded.value;

  let output: string;
  try {
    output = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    const bad = firstInvalidUtf8Byte(bytes);
    const at = bad === null ? 1 : (positions[bad] ?? 1);
    return {
      ok: false,
      error:
        `The escape codes starting around position ${at} do not spell out a real character. ` +
        'A non-English character is written as two or three escapes together (é is %C3%A9), so one of ' +
        'them is probably missing or was truncated when the link was copied.',
    };
  }

  const warnings: string[] = [];
  if (pluses > 0) {
    warnings.push(
      `${pluses === 1 ? 'A "+" was' : `${pluses} "+" signs were`} read as ${pluses === 1 ? 'a space' : 'spaces'}, ` +
        'which is what they mean in a query string. A plus that is meant literally has to be written %2B.',
    );
  }
  if (/%[0-9A-Fa-f]{2}/.test(output)) {
    warnings.push(
      'The result still contains escape codes such as %20, so this text was encoded twice. Decode it ' +
        'again to get back to the original.',
    );
  }
  return { ok: true, text: output, warnings };
}

export interface QueryParam {
  /** The name, decoded. */
  key: string;
  /** The value exactly as it appears in the URL, still encoded. */
  value: string;
  /** The value after percent-decoding, which is what the server sees. */
  decoded: string;
}

export interface ParsedUrl {
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  /** Non-empty path segments, still encoded, in order. */
  pathSegments: string[];
  search: string;
  hash: string;
  origin: string;
  params: QueryParam[];
}

export type ParseUrlResult =
  | { ok: true; url: ParsedUrl; warnings: string[] }
  | { ok: false; error: string };
/** Ports the browser leaves out of a URL because they are implied. */
const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

function tryUrl(candidate: string): URL | null {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

/**
 * Split `?a=1&a=2` the way a server does, keeping the raw text of each value.
 *
 * `URLSearchParams` iteration would give the right pairs in the right order, but
 * it only hands back decoded values, and a URL tool has to show what is actually
 * written in the address as well as what it means. The rules below are the ones
 * `URLSearchParams` follows: split on `&`, ignore empty pairs, split each pair at
 * its first `=`, and read `+` as a space.
 */
function parseQuery(search: string): QueryParam[] {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (query === '') return [];
  const params: QueryParam[] = [];
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const equals = pair.indexOf('=');
    const rawKey = equals === -1 ? pair : pair.slice(0, equals);
    const rawValue = equals === -1 ? '' : pair.slice(equals + 1);
    const key = decodeUrlComponent(rawKey);
    const value = decodeUrlComponent(rawValue);
    params.push({
      key: key.ok ? key.text : rawKey,
      value: rawValue,
      decoded: value.ok ? value.text : rawValue,
    });
  }
  return params;
}
/** Keep a quoted echo of the user's input short enough to read. */
function clip(text: string, limit = 60): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * Take an address apart, and say what is worth saying about it.
 *
 * A scheme-less address is not an error: `example.com/page` is what people copy
 * out of an email, so it is retried as `https://` and the assumption is reported.
 */
export function parseUrl(input: string): ParseUrlResult {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') return { ok: false, error: 'Enter a web address to take it apart.' };

  const rawScheme = SCHEME.exec(raw)?.[1] ?? '';
  // "example.com:8080/page" parses as a URL whose *scheme* is "example.com:",
  // which is never what was meant, so a dotted scheme counts as no scheme.
  const hasScheme = rawScheme !== '' && !rawScheme.includes('.');

  let url = hasScheme ? tryUrl(raw) : null;
  let assumedHttps = false;
  if (!url && !hasScheme) {
    url = tryUrl(`https://${raw}`);
    assumedHttps = url !== null;
    if (!url) url = tryUrl(raw);
  }
  if (!url) {
    return {
      ok: false,
      error:
        `"${clip(raw)}" cannot be read as a web address. One looks like ` +
        'https://example.com/page?q=1 — check for a missing dot, a stray space or a typo in the scheme.',
    };
  }

  const warnings: string[] = [];
  if (assumedHttps) {
    warnings.push('There was no http:// or https:// at the front, so https:// was assumed.');
  }
  if (/\s/.test(raw)) {
    warnings.push(
      'The address contains a space. Spaces are not allowed in a URL, so it has been shown as %20 — but a ' +
        'space usually means the link was broken across two lines and part of it is missing.',
    );
  }
  if (rawScheme !== '' && hasScheme && rawScheme !== rawScheme.toLowerCase()) {
    warnings.push(
      `The scheme was typed as "${rawScheme}". Schemes are not case-sensitive, so it was read as ` +
        `"${rawScheme.toLowerCase()}", which is how it should be written.`,
    );
  }
  if (url.port !== '') {
    const usual = DEFAULT_PORTS[url.protocol];
    warnings.push(
      usual === undefined
        ? `The address names port ${url.port} explicitly.`
        : `The address names port ${url.port} rather than the usual ${usual} for ${url.protocol.replace(':', '')}. ` +
          'That is allowed, but office and mobile networks often block unusual ports.',
    );
  }
  if (url.username !== '' || url.password !== '') {
    warnings.push(
      `This address carries a username${url.password === '' ? '' : ' and password'} inside the link, before ` +
        'the @. Credentials written this way leak everywhere — browser history, server logs, chat messages, ' +
        'analytics. Treat them as compromised and change them.',
    );
  }
  if (url.hostname.split('.').some((label) => label.startsWith('xn--'))) {
    warnings.push(
      'The host contains a punycode label (one starting "xn--"), which is how a name written in non-Latin ' +
        'letters is stored. Turning it back into those letters needs the full IDNA table, which this tool does ' +
        'not carry, so it is shown as-is. Punycode is also used to imitate familiar names, so check it before ' +
        'trusting the link.',
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    warnings.push(
      `This is a "${url.protocol.replace(':', '')}" address rather than a web page address, so parts such as ` +
        'the host and the path may be empty or mean something different.',
    );
  }

  return {
    ok: true,
    url: {
      protocol: url.protocol,
      username: url.username,
      password: url.password,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      pathSegments: url.pathname.split('/').filter((segment) => segment !== ''),
      search: url.search,
      hash: url.hash,
      origin: url.origin,
      params: parseQuery(url.search),
    },
    warnings,
  };
}
export interface BuildQueryOptions extends EncodeUrlOptions {
  /**
   * Sort by name. Stable: parameters that share a name keep their order, which
   * matters because `?tag=a&tag=b` is not the same request as `?tag=b&tag=a`.
   */
  sort?: boolean;
}

/**
 * Build a query string from name/value pairs. Returns it without the leading `?`
 * so it can be appended to whatever the caller already has.
 *
 * Empty values are kept (`?q=` is a real, meaningful request), and a pair with an
 * empty name is dropped, because there is nothing for a server to read it as.
 */
export function buildQueryString(
  params: Array<{ key: string; value: string }>,
  opts: BuildQueryOptions = {},
): string {
  const usable = params.filter((param) => param.key !== '');
  const ordered = opts.sort
    ? usable
        .map((param, index) => ({ param, index }))
        .sort((a, b) => (a.param.key < b.param.key ? -1 : a.param.key > b.param.key ? 1 : a.index - b.index))
        .map((entry) => entry.param)
    : usable;

  return ordered
    .map(
      (param) =>
        `${encodeUrlComponent(param.key, opts)}=${encodeUrlComponent(param.value, opts)}`,
    )
    .join('&');
}

export type DecodeDataUriResult =
  | { ok: true; mime: string; isBase64: boolean; bytes: Uint8Array }
  | { ok: false; error: string };

/** RFC 2397's default when a data URI does not name a type. */
const DEFAULT_DATA_MIME = 'text/plain;charset=US-ASCII';
/**
 * Unpack a `data:` URI into its media type and its bytes.
 *
 * Both forms are handled: `;base64` and plain percent-encoding. Note that a `+`
 * in a data URI is a literal plus, never a space — the form-encoding rule does
 * not apply here, and reading it the other way corrupts base64 payloads.
 */
export function decodeDataUri(input: string): DecodeDataUriResult {
  const text = input.trim();
  if (!/^data:/i.test(text)) {
    return {
      ok: false,
      error:
        'That is not a data URI. A data URI holds a small file inside the address itself and starts with ' +
        '"data:", for example data:text/plain,hello.',
    };
  }

  const comma = text.indexOf(',');
  if (comma === -1) {
    return {
      ok: false,
      error:
        'A data URI needs a comma between the type and the data, as in data:text/plain,hello. There is no ' +
        'comma here, so there is no data to read.',
    };
  }

  const meta = text.slice('data:'.length, comma);
  const payload = text.slice(comma + 1);
  const isBase64 = /;\s*base64\s*$/i.test(meta);
  const mediaType = (isBase64 ? meta.replace(/;\s*base64\s*$/i, '') : meta).trim();
  const mime = mediaType === '' ? DEFAULT_DATA_MIME : mediaType;

  if (isBase64) {
    const decoded = base64ToBytes(payload);
    if (!decoded.ok) {
      return { ok: false, error: `This data URI says it is Base64, but the data is not. ${decoded.error}` };
    }
    return { ok: true, mime, isBase64: true, bytes: decoded.bytes };
  }

  const decoded = percentDecodeToBytes(payload, false);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  return { ok: true, mime, isBase64: false, bytes: decoded.value.bytes };
}
