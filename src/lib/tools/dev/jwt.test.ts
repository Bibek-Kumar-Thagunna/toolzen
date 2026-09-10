import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesToBase64 } from './base64.ts';
import type { DecodedJwt, JwtClaimNote } from './jwt.ts';
import { decodeJwt, verifyHmacSignature } from './jwt.ts';

/** 2026-09-03T12:00:00Z, so every relative phrase in here is deterministic. */
const NOW_MS = Date.UTC(2026, 8, 3, 12, 0, 0);
const NOW_SECONDS = NOW_MS / 1000;
const SECRET = 'a-string-secret-at-least-256-bits-long';

const encoder = new TextEncoder();

function segment(value: unknown): string {
  return bytesToBase64(encoder.encode(JSON.stringify(value)), { urlSafe: true });
}

/** Build a token with a real HMAC signature, so verification is not circular. */
async function signToken(
  header: Record<string, unknown>,
  payload: unknown,
  secret = SECRET,
  hash = 'SHA-256',
): Promise<string> {
  const signingInput = `${segment(header)}.${segment(payload)}`;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${bytesToBase64(new Uint8Array(signature), { urlSafe: true })}`;
}

/** An unsigned-but-well-formed token, for the decoding tests. */
function fakeToken(header: Record<string, unknown>, payload: unknown, signature = 'not-a-real-signature'): string {
  return `${segment(header)}.${segment(payload)}.${signature}`;
}

function decode(token: string, now = NOW_MS): DecodedJwt {
  const result = decodeJwt(token, { now });
  assert.ok(result.ok, `expected the token to decode`);
  return result.jwt;
}

function decodeFailure(token: string): string {
  const result = decodeJwt(token, { now: NOW_MS });
  assert.equal(result.ok, false, 'expected the token to be rejected');
  return result.ok ? '' : result.error;
}

function claim(jwt: DecodedJwt, name: string): JwtClaimNote {
  const note = jwt.claims.find((entry) => entry.claim === name);
  assert.ok(note, `expected a note for "${name}", got ${jwt.claims.map((c) => c.claim).join(', ')}`);
  return note;
}

function warns(jwt: DecodedJwt, needle: string): boolean {
  return jwt.warnings.some((warning) => warning.includes(needle));
}

test('a real HS256 signature verifies, and one flipped character breaks it', async () => {
  const token = await signToken(
    { alg: 'HS256', typ: 'JWT' },
    { sub: 'user-42', iat: NOW_SECONDS - 60, exp: NOW_SECONDS + 3600 },
  );

  const verified = await verifyHmacSignature(token, SECRET);
  assert.ok(verified.ok, 'the check itself should succeed');
  assert.equal(verified.valid, true);

  // Flip one character of the payload. The signature no longer covers it.
  const parts = token.split('.');
  const payload = parts[1] ?? '';
  const index = 4;
  const original = payload[index] ?? 'A';
  const tampered = `${payload.slice(0, index)}${original === 'A' ? 'B' : 'A'}${payload.slice(index + 1)}`;
  assert.notEqual(tampered, payload);

  const forged = await verifyHmacSignature(`${parts[0]}.${tampered}.${parts[2]}`, SECRET);
  assert.ok(forged.ok, 'a forged token is still a checkable token');
  assert.equal(forged.valid, false, 'the tampered payload must fail the check');

  // The wrong secret fails too, and a "Bearer " prefix does not.
  const wrongSecret = await verifyHmacSignature(token, `${SECRET}x`);
  assert.ok(wrongSecret.ok);
  assert.equal(wrongSecret.valid, false);
  const withBearer = await verifyHmacSignature(`Bearer ${token}`, SECRET);
  assert.ok(withBearer.ok);
  assert.equal(withBearer.valid, true);
});

test('HS384 and HS512 work, and the other families are refused with a reason', async () => {
  for (const [alg, hash] of [
    ['HS384', 'SHA-384'],
    ['HS512', 'SHA-512'],
  ]) {
    const token = await signToken({ alg, typ: 'JWT' }, { sub: 'x' }, SECRET, hash);
    const result = await verifyHmacSignature(token, SECRET);
    assert.ok(result.ok, `${alg} should be checkable`);
    assert.equal(result.valid, true, `${alg} should verify`);
  }

  for (const alg of ['RS256', 'PS512', 'ES384']) {
    const result = await verifyHmacSignature(fakeToken({ alg }, { sub: 'x' }), SECRET);
    assert.equal(result.ok, false, `${alg} cannot be checked with a secret`);
    if (!result.ok) {
      assert.match(result.error, /public key/);
      assert.match(result.error, /HS256/);
    }
  }

  const none = await verifyHmacSignature(fakeToken({ alg: 'none' }, { sub: 'x' }, ''), SECRET);
  assert.equal(none.ok, false);
  if (!none.ok) assert.match(none.error, /not signed/);

  const unknown = await verifyHmacSignature(fakeToken({ alg: 'HS1' }, { sub: 'x' }), SECRET);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.error, /does not know/);

  const noSecret = await verifyHmacSignature(fakeToken({ alg: 'HS256' }, { sub: 'x' }), '');
  assert.equal(noSecret.ok, false);
  if (!noSecret.ok) assert.match(noSecret.error, /Enter the shared secret/);

  const notAToken = await verifyHmacSignature('two.parts', SECRET);
  assert.equal(notAToken.ok, false);
  if (!notAToken.ok) assert.match(notAToken.error, /three-part token/);
});

test('decoding never implies the token is trustworthy', () => {
  const plain = decode(fakeToken({ alg: 'HS256', typ: 'JWT' }, { sub: 'x', exp: NOW_SECONDS + 60 }));
  assert.ok(
    plain.warnings.some((warning) => warning.includes('has not been verified')),
    `expected the never-verified warning, got ${JSON.stringify(plain.warnings)}`,
  );
  assert.equal(plain.warnings[0]?.includes('has not been verified'), true, 'it should lead the list');

  // Present even for a perfectly ordinary, unexpired, well-formed token.
  const tidy = decode(
    fakeToken({ alg: 'RS256', typ: 'JWT', kid: 'key-1' }, { iss: 'https://issuer.test', exp: NOW_SECONDS + 900 }),
  );
  assert.ok(tidy.warnings.some((warning) => warning.includes('has not been verified')));
});

test('alg "none" is reported as an error, not a curiosity', () => {
  const jwt = decode(fakeToken({ alg: 'none', typ: 'JWT' }, { sub: 'admin', exp: NOW_SECONDS + 60 }, ''));
  const note = claim(jwt, 'alg');
  assert.equal(note.state, 'error');
  assert.equal(note.label, 'Algorithm');
  assert.match(note.human, /not signed at all/);
  assert.equal(jwt.algorithm, 'none');
  assert.ok(warns(jwt, 'this token is unsigned'));
  assert.ok(warns(jwt, 'nothing at all to check'), 'an empty signature segment is worth saying');
  assert.equal(jwt.signatureBytes, 0);
});

test('a signed token reports its algorithm and signature size', () => {
  const jwt = decode(fakeToken({ alg: 'HS256', typ: 'JWT' }, { sub: 'x' }, bytesToBase64(new Uint8Array(32), { urlSafe: true })));
  assert.equal(jwt.algorithm, 'HS256');
  assert.equal(jwt.signatureBytes, 32);
  assert.equal(claim(jwt, 'alg').state, 'ok');
  assert.match(claim(jwt, 'alg').human, /shared secret/);
  assert.equal(claim(jwt, 'typ').state, 'info');
  assert.equal(jwt.headerJson.includes('\n'), true, 'the JSON is pretty-printed for display');
  assert.deepEqual(JSON.parse(jwt.payloadJson), { sub: 'x' });
});

test('expired and not-yet-valid are told apart, in words and in flags', () => {
  const expired = decode(
    fakeToken({ alg: 'HS256' }, { sub: 'x', iat: NOW_SECONDS - 7200, exp: NOW_SECONDS - 10800 }),
  );
  assert.equal(expired.isExpired, true);
  assert.equal(expired.isNotYetValid, false);
  assert.equal(expired.expiresInSeconds, -10800);
  const expNote = claim(expired, 'exp');
  assert.equal(expNote.state, 'error');
  assert.match(expNote.human, /^Expired 3 hours ago, at 2026-09-03T09:00:00\.000Z\./);

  const future = decode(
    fakeToken({ alg: 'HS256' }, { sub: 'x', nbf: NOW_SECONDS + 720, exp: NOW_SECONDS + 3600 }),
  );
  assert.equal(future.isNotYetValid, true);
  assert.equal(future.isExpired, false);
  assert.equal(future.expiresInSeconds, 3600);
  assert.equal(claim(future, 'nbf').state, 'error');
  assert.match(claim(future, 'nbf').human, /Not usable for another 12 minutes/);
  assert.match(claim(future, 'exp').human, /Valid for another 1 hour/);
  assert.equal(claim(future, 'exp').state, 'ok');

  // A token with no exp at all: null rather than a guess, plus a warning.
  const forever = decode(fakeToken({ alg: 'HS256' }, { sub: 'x' }));
  assert.equal(forever.expiresInSeconds, null);
  assert.equal(forever.isExpired, false);
  assert.ok(warns(forever, 'no expiry'));
});

test('clock nonsense in the timestamps is called out', () => {
  const backwards = decode(fakeToken({ alg: 'HS256' }, { iat: NOW_SECONDS, exp: NOW_SECONDS - 60 }));
  assert.ok(warns(backwards, 'expires before it was issued'));

  const fromTheFuture = decode(fakeToken({ alg: 'HS256' }, { iat: NOW_SECONDS + 86400, exp: NOW_SECONDS + 90000 }));
  assert.ok(warns(fromTheFuture, 'issued in the future'));
  assert.equal(claim(fromTheFuture, 'iat').state, 'warn');

  const asText = decode(fakeToken({ alg: 'HS256' }, { exp: '1800000000' }));
  assert.equal(claim(asText, 'exp').state, 'warn');
  assert.match(claim(asText, 'exp').human, /whole number of seconds/);
  assert.equal(asText.expiresInSeconds, null, 'a string exp is not a date');
});

test('the wrong number of segments gets its own explanation each time', () => {
  const oneSegment = decodeFailure('aGVsbG8gd29ybGQ');
  assert.match(oneSegment, /single Base64 string, not a JWT/);
  assert.match(oneSegment, /Base64 decoder/);

  const twoSegments = decodeFailure(`${segment({ alg: 'HS256' })}.${segment({ sub: 'x' })}`);
  assert.match(twoSegments, /unsigned token/);
  assert.match(twoSegments, /signature segment is missing/);

  const jwe = decodeFailure('one.two.three.four.five');
  assert.match(jwe, /JWE/);
  assert.match(jwe, /encrypted rather than merely encoded/);

  assert.match(decodeFailure('one.two.three.four'), /this has 4/);
  assert.match(decodeFailure('a.b.c.d.e.f'), /this has 6/);
  assert.match(decodeFailure('   '), /Paste a token/);
});

test('a payload that is not an object is a warning, not a crash', () => {
  const jwt = decode(fakeToken({ alg: 'HS256' }, 'just a string'));
  assert.ok(warns(jwt, 'not a JSON object but a plain string'));
  assert.deepEqual(jwt.payload, {}, 'nothing can be read from it');
  assert.equal(jwt.payloadJson, '"just a string"');
  assert.equal(jwt.expiresInSeconds, null);
  // A list is not an object either, and the wording should say which it was.
  assert.ok(warns(decode(fakeToken({ alg: 'HS256' }, [1, 2, 3])), 'not a JSON object but a plain list'));
  // No "no expiry" warning here: there is no payload to be missing it from.
  assert.equal(warns(jwt, 'no expiry'), false);
});

test('a timestamp in milliseconds is caught before it confuses anyone', () => {
  const jwt = decode(fakeToken({ alg: 'HS256' }, { iat: 1_800_000_000_000, exp: 1_800_003_600_000 }));
  assert.ok(warns(jwt, '"exp" is 1800003600000'));
  assert.ok(warns(jwt, 'looks like'));
  assert.ok(warns(jwt, 'Divide it by 1000'));
  assert.ok(warns(jwt, '"iat" is 1800000000000'));
  // Seconds-sized values are left alone.
  assert.equal(warns(decode(fakeToken({ alg: 'HS256' }, { exp: NOW_SECONDS + 60 })), 'Divide it by 1000'), false);
});

test('the registered claims each get a sentence, in a fixed order', () => {
  const jwt = decode(
    fakeToken(
      { alg: 'HS256', typ: 'JWT', kid: 'key-1' },
      {
        iss: 'https://issuer.test',
        sub: 'user-42',
        aud: ['api://orders', 'api://billing'],
        azp: 'web-app',
        scope: 'read write admin',
        iat: NOW_SECONDS - 300,
        nbf: NOW_SECONDS - 300,
        exp: NOW_SECONDS + 300,
        jti: 'abc-123',
        department: 'engineering',
      },
    ),
  );

  assert.deepEqual(
    jwt.claims.map((note) => note.claim),
    ['alg', 'typ', 'kid', 'iss', 'sub', 'aud', 'azp', 'scope', 'iat', 'nbf', 'exp', 'jti'],
  );
  assert.match(claim(jwt, 'iss').human, /issued by "https:\/\/issuer\.test"/);
  assert.match(claim(jwt, 'iss').human, /only a claim until the signature is checked/);
  assert.match(claim(jwt, 'sub').human, /"user-42"/);
  assert.match(claim(jwt, 'aud').human, /"api:\/\/orders", "api:\/\/billing"/);
  assert.match(claim(jwt, 'aud').human, /addressed to somebody else/);
  assert.match(claim(jwt, 'azp').human, /"web-app"/);
  assert.match(claim(jwt, 'scope').human, /Grants 3 permissions: read, write, admin\./);
  assert.match(claim(jwt, 'jti').human, /not used twice/);
  assert.match(claim(jwt, 'kid').human, /not a secret/);
  assert.match(claim(jwt, 'nbf').human, /Usable since 2026-09-03T11:55:00\.000Z/);
  assert.equal(claim(jwt, 'nbf').state, 'ok');
  assert.equal(claim(jwt, 'iat').state, 'info');
  assert.equal(jwt.isExpired, false);
  assert.equal(jwt.isNotYetValid, false);
  assert.equal(jwt.expiresInSeconds, 300);
  // An unregistered claim is left for the caller to show, not narrated.
  assert.equal(jwt.claims.some((note) => note.claim === 'department'), false);
  assert.equal(jwt.payload['department'], 'engineering');
  // A claim that is absent gets no row at all.
  const spare = decode(fakeToken({ alg: 'HS256' }, { sub: 'x' }));
  assert.deepEqual(spare.claims.map((note) => note.claim), ['alg', 'sub']);
});

test('the wrappers people paste around a token are removed and reported', async () => {
  const token = await signToken({ alg: 'HS256', typ: 'JWT' }, { sub: 'x', exp: NOW_SECONDS + 60 });

  const bearer = decode(`Bearer ${token}`);
  assert.ok(warns(bearer, '"Bearer " prefix'));
  const quoted = decode(`"${token}"`);
  assert.ok(warns(quoted, 'quotation marks'));
  const wrapped = decode(token.replace(/\./g, '.\n  '));
  assert.ok(warns(wrapped, 'Spaces and line breaks inside the token were removed'));

  for (const jwt of [bearer, quoted, wrapped]) {
    assert.equal(jwt.algorithm, 'HS256');
    assert.equal(jwt.payload['sub'], 'x');
    assert.match(jwt.warnings[0] ?? '', /has not been verified/, 'the never-verified line stays first');
  }

  // A quoted Bearer header is one paste, not two: both layers have to come off.
  const both = decode(`  "Bearer ${token}"  `);
  assert.equal(both.payload['sub'], 'x');
  assert.ok(warns(both, 'quotation marks'));
  assert.ok(warns(both, '"Bearer " prefix'));
  const verified = await verifyHmacSignature(`  "Bearer ${token}"  `, SECRET);
  assert.ok(verified.ok, 'a wrapped token is still checkable');
  assert.equal(verified.valid, true);
});

test('a token too big to travel in a header says so', () => {
  const big = decode(fakeToken({ alg: 'HS256' }, { sub: 'x', exp: NOW_SECONDS + 60, blob: 'a'.repeat(9000) }));
  assert.ok(warns(big, 'Move the large claims out of it'));
  assert.ok(warns(big, 'about 4 KB'));
  const small = decode(fakeToken({ alg: 'HS256' }, { sub: 'x' }));
  assert.equal(warns(small, 'Move the large claims out of it'), false);
});

test('with no "now" given, the real clock is used', () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fresh = decodeJwt(fakeToken({ alg: 'HS256' }, { exp: nowSeconds + 600 }));
  assert.ok(fresh.ok);
  if (fresh.ok) {
    assert.equal(fresh.jwt.isExpired, false);
    assert.ok((fresh.jwt.expiresInSeconds ?? 0) > 500);
  }
  const stale = decodeJwt(fakeToken({ alg: 'HS256' }, { exp: nowSeconds - 600 }));
  assert.ok(stale.ok);
  if (stale.ok) assert.equal(stale.jwt.isExpired, true);
});
