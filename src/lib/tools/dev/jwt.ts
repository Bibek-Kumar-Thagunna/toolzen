/**
 * JWT reader.
 *
 * The one rule this file exists to enforce: **decoding is not verifying.** A JWT
 * is signed, not encrypted — anyone can read one, and anyone can write one that
 * says they are an administrator. So everything below reports what the token
 * *claims*, never what is true, and the first warning on every single decode says
 * exactly that.
 *
 * `verifyHmacSignature` is the only function here that can tell you a token is
 * genuine, and only for the shared-secret family (HS256/384/512). An RS, PS or ES
 * signature is checked with the issuer's public key, which is a different job and
 * needs the issuer's JWKS rather than something a user can type.
 *
 * Isomorphic: base64url comes from ./base64.ts, the HMAC from `crypto.subtle`,
 * which both Node 22 and every current browser provide.
 */

import { base64ToBytes, decodeBase64 } from './base64.ts';

export interface JwtClaimNote {
  /** The claim name as it appears in the token, e.g. `exp`. */
  claim: string;
  /** Short human name for a table heading, e.g. "Expires". */
  label: string;
  /** The value exactly as it was in the JSON. */
  raw: unknown;
  /** A sentence a non-technical reader can act on. */
  human: string;
  state: 'ok' | 'warn' | 'error' | 'info';
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  headerJson: string;
  payloadJson: string;
  /** The raw third segment, untouched. */
  signature: string;
  signatureBytes: number;
  algorithm: string;
  isExpired: boolean;
  isNotYetValid: boolean;
  /** Negative once expired, null when the token has no `exp` at all. */
  expiresInSeconds: number | null;
  claims: JwtClaimNote[];
  warnings: string[];
}

export type DecodeJwtResult = { ok: true; jwt: DecodedJwt } | { ok: false; error: string };

export type VerifyHmacResult = { ok: true; valid: boolean } | { ok: false; error: string };

export interface DecodeJwtOptions {
  /** What "now" means, in milliseconds since 1970, exactly like `Date.now()`. */
  now?: number;
}

/** The sentence that must appear on every decode, however the token looks. */
const NEVER_VERIFIED =
  'This token has not been verified. Decoding only reads what the token says about itself: anyone can ' +
  'write a token claiming to be anyone, and only checking the signature against the issuer\'s key can show ' +
  'it has not been tampered with.';

/** Above this the token stops fitting where tokens have to fit. */
const COOKIE_LIMIT_BYTES = 8192;

/** A number this large is not a count of seconds — it is milliseconds. */
const MILLISECONDS_THRESHOLD = 1e11;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clip(text: string, limit = 60): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

const DURATION_UNITS: Array<[number, string]> = [
  [31_557_600, 'year'],
  [2_629_800, 'month'],
  [86_400, 'day'],
  [3_600, 'hour'],
  [60, 'minute'],
  [1, 'second'],
];

/**
 * "3 hours", "12 minutes" — the largest unit that still gives a number of one or
 * more, and nothing after it. Nobody reads "expired 3 hours 14 minutes 2 seconds
 * ago"; they read the first two words and stop.
 *
 * Kept separate from the `relativeTime` helper in timestamp.ts, which is private
 * to that file and writes whole phrases through Intl ("3 days ago"). What is
 * needed here is a bare duration, so it can sit inside "valid for another …".
 */
function humanDuration(seconds: number): string {
  const total = Math.round(Math.abs(seconds));
  if (total < 1) return 'less than a second';
  for (const [size, name] of DURATION_UNITS) {
    if (total >= size) {
      const count = Math.floor(total / size);
      return `${count} ${name}${count === 1 ? '' : 's'}`;
    }
  }
  return `${total} seconds`;
}
/** ISO 8601 in UTC, or a plain phrase when the number is not a usable date. */
function isoFromSeconds(seconds: number): string {
  const ms = seconds * 1000;
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) {
    return 'a date outside the range a calendar can show';
  }
  return new Date(ms).toISOString();
}

/** A timestamp claim, or null when it is missing or not a finite number. */
function secondsClaim(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const CLAIM_LABELS: Record<string, string> = {
  alg: 'Algorithm',
  typ: 'Type',
  kid: 'Key ID',
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  azp: 'Authorised party',
  scope: 'Permissions',
  iat: 'Issued at',
  nbf: 'Not before',
  exp: 'Expires',
  jti: 'Token ID',
};

/** Header claims are read from the header; everything else from the payload. */
const HEADER_CLAIMS = ['alg', 'typ', 'kid'];

const CLAIM_ORDER = ['alg', 'typ', 'kid', 'iss', 'sub', 'aud', 'azp', 'scope', 'iat', 'nbf', 'exp', 'jti'];

function describeAlgorithm(raw: unknown): { human: string; state: JwtClaimNote['state'] } {
  if (typeof raw !== 'string' || raw === '') {
    return {
      state: 'warn',
      human:
        'The header does not say which algorithm was used. Every JWT has to, so most servers will refuse ' +
        'this token outright.',
    };
  }
  if (raw.toLowerCase() === 'none') {
    return {
      state: 'error',
      human:
        'The algorithm is "none", which means the token is not signed at all. Anyone can change any part of ' +
        'it — the user id, the roles, the expiry — and it will still look valid. This is the best known JWT ' +
        'attack, and a token like this must never be accepted.',
    };
  }
  if (/^HS(256|384|512)$/.test(raw)) {
    return {
      state: 'ok',
      human:
        `Signed with a shared secret (HMAC using SHA-${raw.slice(2)}). Anyone who can check this signature ` +
        'can also create one, so the secret belongs on the server and never in an app or a web page.',
    };
  }
  if (/^(RS|PS|ES)(256|384|512)$/.test(raw)) {
    return {
      state: 'ok',
      human:
        `Signed with the issuer's private key (${raw}) and checked with its public key, so only the issuer ` +
        'can create a token like this. Checking it needs that public key, usually from the issuer\'s JWKS.',
    };
  }
  return {
    state: 'warn',
    human: `"${raw}" is not an algorithm this tool recognises, which is unusual enough to be worth checking.`,
  };
}

function describeTimestamp(
  claim: string,
  raw: unknown,
  nowSeconds: number,
): { human: string; state: JwtClaimNote['state'] } {
  const seconds = secondsClaim(raw);
  if (seconds === null) {
    return {
      state: 'warn',
      human:
        `"${claim}" should be a whole number of seconds since 1 January 1970, but it is ` +
        `${typeof raw === 'string' ? `the text "${clip(String(raw), 30)}"` : `a ${typeof raw}`}. ` +
        'A server reading it strictly will reject the token.',
    };
  }
  const iso = isoFromSeconds(seconds);
  const delta = seconds - nowSeconds;
  if (claim === 'exp') {
    return delta <= 0
      ? { state: 'error', human: `Expired ${humanDuration(delta)} ago, at ${iso}. A server should refuse it.` }
      : { state: 'ok', human: `Valid for another ${humanDuration(delta)}, until ${iso}.` };
  }
  if (claim === 'nbf') {
    return delta > 0
      ? { state: 'error', human: `Not usable for another ${humanDuration(delta)}, until ${iso}.` }
      : { state: 'ok', human: `Usable since ${iso}, which was ${humanDuration(delta)} ago.` };
  }
  return delta > 0
    ? { state: 'warn', human: `Issued ${humanDuration(delta)} in the future, at ${iso}. Some clock is wrong.` }
    : { state: 'info', human: `Issued ${humanDuration(delta)} ago, at ${iso}.` };
}
/** One line of plain English per registered claim, or null to leave it out. */
function describeClaim(claim: string, raw: unknown, nowSeconds: number): JwtClaimNote | null {
  const label = CLAIM_LABELS[claim] ?? claim;
  const note = (human: string, state: JwtClaimNote['state']): JwtClaimNote => ({
    claim,
    label,
    raw,
    human,
    state,
  });

  if (claim === 'alg') {
    const described = describeAlgorithm(raw);
    return note(described.human, described.state);
  }
  if (raw === undefined) return null;
  if (claim === 'exp' || claim === 'nbf' || claim === 'iat') {
    const described = describeTimestamp(claim, raw, nowSeconds);
    return note(described.human, described.state);
  }
  if (claim === 'typ') {
    const value = String(raw);
    const usual = ['jwt', 'at+jwt', 'jose', 'jwt+at'].includes(value.toLowerCase());
    return note(
      usual
        ? `The header labels this a "${value}", which is the normal label for a token like this.`
        : `The header labels this a "${value}" rather than the usual "JWT", which is worth checking.`,
      usual ? 'info' : 'warn',
    );
  }
  if (claim === 'kid') {
    return note(
      `The signer names key "${clip(String(raw), 40)}", which tells the server which of its keys to check ` +
        'the signature with. It is a label, not a secret.',
      'info',
    );
  }
  if (claim === 'iss') {
    return note(
      `The token says it was issued by "${clip(String(raw), 60)}". That is only a claim until the signature ` +
        'is checked against that issuer\'s key.',
      'info',
    );
  }
  if (claim === 'sub') {
    return note(
      `The subject — usually the user or account the token is about — is "${clip(String(raw), 60)}".`,
      'info',
    );
  }
  if (claim === 'aud') {
    const list = Array.isArray(raw) ? raw.map((entry) => String(entry)) : [String(raw)];
    return note(
      `Meant for ${list.map((entry) => `"${clip(entry, 40)}"`).join(', ')}. A service that finds its own name ` +
        'missing from this list should refuse the token, because it was addressed to somebody else.',
      'info',
    );
  }
  if (claim === 'azp') {
    return note(
      `The authorised party — the application the token was issued to — is "${clip(String(raw), 40)}".`,
      'info',
    );
  }
  if (claim === 'scope') {
    if (typeof raw !== 'string') {
      return note('"scope" is normally a single string of space-separated permissions.', 'warn');
    }
    const scopes = raw.split(/\s+/).filter((entry) => entry !== '');
    return note(
      scopes.length === 0
        ? 'The scope is empty, so the token grants no particular permission.'
        : `Grants ${scopes.length} permission${scopes.length === 1 ? '' : 's'}: ${scopes.join(', ')}.`,
      'info',
    );
  }
  if (claim === 'jti') {
    return note(
      `The token's own id is "${clip(String(raw), 40)}". A server can record it to make sure the same token ` +
        'is not used twice.',
      'info',
    );
  }
  return null;
}

const BEARER_NOTE = 'The "Bearer " prefix that HTTP headers use was removed before decoding.';
const QUOTE_NOTE = 'The quotation marks around the token were removed before decoding.';

/**
 * Strip the things people paste around a token: "Bearer ", quotes, line breaks.
 *
 * The loop matters. A token copied out of a JSON body arrives as
 * `"Bearer eyJ…"` — quotes outside the prefix — and one pass in either order
 * would leave the other layer on, at which point removing the internal spaces
 * would glue "Bearer" onto the header segment and the token would look corrupt
 * rather than merely wrapped. Each pass removes at least one character, so this
 * always ends.
 */
function normaliseToken(token: string): { token: string; notes: string[] } {
  const notes: string[] = [];
  let body = typeof token === 'string' ? token.trim() : '';

  for (let stripped = true; stripped; ) {
    stripped = false;
    if (body.length > 1 && /^["'].*["']$/s.test(body)) {
      body = body.slice(1, -1).trim();
      if (!notes.includes(QUOTE_NOTE)) notes.push(QUOTE_NOTE);
      stripped = true;
    }
    const bearer = /^bearer\s+/i.exec(body);
    if (bearer) {
      body = body.slice(bearer[0].length).trim();
      if (!notes.includes(BEARER_NOTE)) notes.push(BEARER_NOTE);
      stripped = true;
    }
  }

  if (/\s/.test(body)) {
    body = body.replace(/\s+/g, '');
    notes.push('Spaces and line breaks inside the token were removed. A real JWT never contains any.');
  }
  return { token: body, notes };
}
/**
 * Why this is not a three-part token. Each count gets its own sentence, because
 * "invalid token" tells a user nothing and each of these has a different cause
 * and a different fix.
 */
function segmentCountError(count: number): string {
  if (count === 1) {
    return (
      'This looks like a single Base64 string, not a JWT. A JWT is three Base64 parts joined by dots ' +
      '(header.payload.signature) — try the Base64 decoder on this instead.'
    );
  }
  if (count === 2) {
    return (
      'This is an unsigned token: the signature segment is missing. A JWT has three parts joined by dots ' +
      '(header.payload.signature) and only two are here, so there is nothing to show where it came from.'
    );
  }
  if (count === 5) {
    return (
      'Five segments means this is a JWE, which is encrypted rather than merely encoded. Its contents cannot ' +
      'be shown: only the holder of the decryption key can read them.'
    );
  }
  return (
    `A JWT has three segments joined by dots, but this has ${count}. (An encrypted JWE has five.) ` +
    'Something else was probably copied along with the token.'
  );
}

function decodeSegment(segment: string, label: string): { ok: true; text: string } | { ok: false; error: string } {
  if (segment === '') {
    return { ok: false, error: `The ${label} part of this token is empty, so there is nothing to read.` };
  }
  const decoded = decodeBase64(segment);
  if (!decoded.ok) {
    return { ok: false, error: `The ${label} part of this token could not be read. ${decoded.error}` };
  }
  return { ok: true, text: decoded.text };
}

function parseJsonSegment(text: string, label: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      error:
        `The ${label} part decoded, but it is not the JSON a JWT must contain. It reads: ` +
        `${clip(text, 60)}`,
    };
  }
}
/**
 * Read a token and explain it. Never claims a token is genuine — see
 * `NEVER_VERIFIED`, which is always the first warning.
 */
export function decodeJwt(token: string, opts: DecodeJwtOptions = {}): DecodeJwtResult {
  const nowMs = opts.now ?? Date.now();
  const nowSeconds = nowMs / 1000;

  const normalised = normaliseToken(token);
  const body = normalised.token;
  if (body === '') return { ok: false, error: 'Paste a token to look inside it.' };

  const segments = body.split('.');
  if (segments.length !== 3) return { ok: false, error: segmentCountError(segments.length) };

  const headerText = decodeSegment(segments[0] ?? '', 'header');
  if (!headerText.ok) return headerText;
  const headerJsonValue = parseJsonSegment(headerText.text, 'header');
  if (!headerJsonValue.ok) return headerJsonValue;
  if (!isPlainObject(headerJsonValue.value)) {
    return {
      ok: false,
      error:
        'The header of this token is not a JSON object, so it is not a JWT. A JWT header is always a set of ' +
        'named values such as {"alg":"HS256","typ":"JWT"}.',
    };
  }
  // Bound to a local and annotated rather than relying on the narrowing from the
  // guard above. Control-flow narrowing does not survive a property-access path
  // on a value that was itself narrowed through a discriminant, so
  // `headerJsonValue.value` reads back as `unknown` a few lines later — which is
  // the sort of error that only appears once something downstream indexes it.
  const header: Record<string, unknown> = headerJsonValue.value;

  const payloadText = decodeSegment(segments[1] ?? '', 'payload');
  if (!payloadText.ok) return payloadText;
  const payloadJsonValue = parseJsonSegment(payloadText.text, 'payload');
  if (!payloadJsonValue.ok) return payloadJsonValue;
  const payloadValue: unknown = payloadJsonValue.value;
  const payloadIsObject = isPlainObject(payloadValue);
  const payload: Record<string, unknown> = payloadIsObject ? payloadValue : {};

  const warnings: string[] = [NEVER_VERIFIED, ...normalised.notes];
  if (!payloadIsObject) {
    warnings.push(
      'The payload is not a JSON object but a plain ' +
        `${Array.isArray(payloadJsonValue.value) ? 'list' : typeof payloadJsonValue.value}. ` +
        'A JWT payload is meant to be a set of named claims, so there is nothing here for a server to read ' +
        'and it will be rejected.',
    );
  }
  const signature = segments[2] ?? '';
  let signatureBytes = 0;
  if (signature === '') {
    warnings.push('The signature segment is empty, so there is nothing at all to check this token against.');
  } else {
    const decodedSignature = base64ToBytes(signature);
    if (decodedSignature.ok) {
      signatureBytes = decodedSignature.bytes.length;
    } else {
      warnings.push(
        `The signature is not valid Base64URL, so it could never be checked. ${decodedSignature.error}`,
      );
    }
  }

  const algorithmRaw = header['alg'];
  const algorithm = typeof algorithmRaw === 'string' && algorithmRaw !== '' ? algorithmRaw : 'unknown';
  if (algorithm.toLowerCase() === 'none') {
    warnings.push(
      'The header says the algorithm is "none": this token is unsigned, so its contents prove nothing and ' +
        'anyone could have written them.',
    );
  }

  const exp = secondsClaim(payload['exp']);
  const nbf = secondsClaim(payload['nbf']);
  const iat = secondsClaim(payload['iat']);

  if (payloadIsObject && payload['exp'] === undefined) {
    warnings.push(
      'This token has no expiry ("exp"), so it stays usable for as long as the signing key does. If it is ' +
        'ever copied out of a log or a browser, it can be replayed indefinitely.',
    );
  }
  if (exp !== null && iat !== null && exp < iat) {
    warnings.push(
      'The token expires before it was issued ("exp" is earlier than "iat"), which means the clock on the ' +
        'machine that made it was wrong, or the two values were swapped.',
    );
  }
  if (iat !== null && iat > nowSeconds) {
    warnings.push(
      `The token says it was issued in the future (${isoFromSeconds(iat)}). Either the two computers ` +
        'disagree about the time, or the value is wrong.',
    );
  }
  for (const [claim, value] of [
    ['exp', exp],
    ['nbf', nbf],
    ['iat', iat],
  ] as Array<[string, number | null]>) {
    if (value !== null && value > MILLISECONDS_THRESHOLD) {
      warnings.push(
        `"${claim}" is ${value}, which is far too big to be a number of seconds — it looks like ` +
          'milliseconds. JWT timestamps are counted in whole seconds, so every server will read this as a ' +
          'date thousands of years from now. Divide it by 1000.',
      );
    }
  }

  const tokenBytes = new TextEncoder().encode(body).length;
  if (tokenBytes > COOKIE_LIMIT_BYTES) {
    warnings.push(
      `This token is ${tokenBytes} bytes. A cookie is limited to about 4 KB and most servers cap a whole ` +
        'request header at 8 KB, so a token this size will be dropped somewhere between the browser and the ' +
        'application. Move the large claims out of it.',
    );
  }

  const claims: JwtClaimNote[] = [];
  for (const claim of CLAIM_ORDER) {
    const source = HEADER_CLAIMS.includes(claim) ? header : payload;
    const fallback = HEADER_CLAIMS.includes(claim) ? payload : header;
    const raw = source[claim] !== undefined ? source[claim] : fallback[claim];
    const note = describeClaim(claim, raw, nowSeconds);
    if (note) claims.push(note);
  }

  return {
    ok: true,
    jwt: {
      header,
      payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payloadJsonValue.value, null, 2),
      signature,
      signatureBytes,
      algorithm,
      isExpired: exp !== null && exp - nowSeconds <= 0,
      isNotYetValid: nbf !== null && nbf - nowSeconds > 0,
      expiresInSeconds: exp === null ? null : Math.round(exp - nowSeconds),
      claims,
      warnings,
    },
  };
}
const HMAC_HASHES: Record<string, string> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
};

/**
 * Compare two byte strings without leaking where they first differ.
 *
 * The length check is unavoidable and safe to do early: the length of a signature
 * is public (it follows from the algorithm). What must not leak is *which byte*
 * goes wrong, which an early return inside the loop — or `===` on a string — would
 * give away to anyone able to time this.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

/** Read the `alg` out of a token's header, or say why it cannot be read. */
function headerAlgorithm(segment: string): { ok: true; alg: string } | { ok: false; error: string } {
  const decoded = decodeSegment(segment, 'header');
  if (!decoded.ok) return decoded;
  const parsed = parseJsonSegment(decoded.text, 'header');
  if (!parsed.ok) return parsed;
  if (!isPlainObject(parsed.value)) {
    return { ok: false, error: 'The header of this token is not a JSON object, so it is not a JWT.' };
  }
  const alg = parsed.value['alg'];
  return { ok: true, alg: typeof alg === 'string' ? alg : '' };
}
/**
 * Check a shared-secret signature. `{ ok: true, valid: false }` is a successful
 * check with a negative answer — the `ok: false` half means the check could not
 * be run at all, which is a different thing and must be shown differently.
 */
export async function verifyHmacSignature(token: string, secret: string): Promise<VerifyHmacResult> {
  const body = normaliseToken(token).token;
  const segments = body.split('.');
  if (body === '' || segments.length !== 3) {
    return {
      ok: false,
      error:
        'A signature can only be checked on a complete three-part token (header.payload.signature). ' +
        'This is not one.',
    };
  }

  const header = headerAlgorithm(segments[0] ?? '');
  if (!header.ok) return header;
  const alg = header.alg.toUpperCase();

  if (alg === '' || alg === 'NONE') {
    return {
      ok: false,
      error:
        'This token is not signed — its algorithm is "none" — so there is no signature to check. A token ' +
        'like this proves nothing about who created it.',
    };
  }
  if (/^(RS|PS|ES)(256|384|512)$/.test(alg)) {
    return {
      ok: false,
      error:
        `${header.alg} signatures are made with the issuer's private key and checked with its public key, ` +
        'which is not something you can type in here. Fetch the issuer\'s public keys — usually at ' +
        '/.well-known/jwks.json — and check the token against those. Only HS256, HS384 and HS512 use a ' +
        'shared secret.',
    };
  }
  const hash = HMAC_HASHES[alg];
  if (hash === undefined) {
    return {
      ok: false,
      error:
        `This token says it uses "${header.alg}", which this checker does not know. Only HS256, HS384 and ` +
        'HS512 — the shared-secret algorithms — can be checked here.',
    };
  }
  if (secret === '') {
    return { ok: false, error: 'Enter the shared secret that was used to sign this token.' };
  }

  const expected = base64ToBytes(segments[2] ?? '');
  if (!expected.ok) {
    return {
      ok: false,
      error: `The signature on the end of this token is not valid Base64URL, so it cannot be compared. ${expected.error}`,
    };
  }

  const encoder = new TextEncoder();
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: { name: hash } },
      false,
      ['sign'],
    );
    const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(`${segments[0]}.${segments[1]}`));
    return { ok: true, valid: constantTimeEqual(new Uint8Array(signed), expected.bytes) };
  } catch {
    return {
      ok: false,
      error:
        'The signature could not be checked: this browser or runtime refused the HMAC operation. On the web ' +
        'this usually means the page is not being served over https.',
    };
  }
}
