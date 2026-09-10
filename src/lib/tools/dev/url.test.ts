import test from 'node:test';
import assert from 'node:assert/strict';

import type { ParsedUrl } from './url.ts';
import {
  buildQueryString,
  decodeDataUri,
  decodeUrlComponent,
  encodeFullUrl,
  encodeUrlComponent,
  parseUrl,
} from './url.ts';

function decoded(text: string): { text: string; warnings: string[] } {
  const result = decodeUrlComponent(text);
  assert.ok(result.ok, `expected "${text}" to decode`);
  return { text: result.text, warnings: result.warnings };
}

function decodeFailure(text: string): string {
  const result = decodeUrlComponent(text);
  assert.equal(result.ok, false, `expected "${text}" to be rejected`);
  return result.ok ? '' : result.error;
}

function parsed(input: string): { url: ParsedUrl; warnings: string[] } {
  const result = parseUrl(input);
  assert.ok(result.ok, `expected "${input}" to parse`);
  return { url: result.url, warnings: result.warnings };
}

function hasWarning(warnings: string[], needle: string): boolean {
  return warnings.some((warning) => warning.includes(needle));
}

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

test('a broken escape sequence is a friendly error, not a thrown URIError', () => {
  // decodeURIComponent('%E0%A4%A') throws "URIError: URI malformed" with no position.
  const truncated = decodeFailure('%E0%A4%A');
  assert.match(truncated, /position 7/);
  assert.match(truncated, /two hex digits/);

  const lonePercent = decodeFailure('100% certain');
  assert.match(lonePercent, /position 4/);
  assert.match(lonePercent, /%25/, 'the message must say how to write a real percent sign');

  assert.match(decodeFailure('%'), /position 1/);
  assert.match(decodeFailure('%zz'), /position 1/);
  assert.match(decodeFailure('caf%C3'), /do not spell out a real character/);
});

test('encode and decode round-trip, with + as an explicit choice', () => {
  assert.equal(encodeUrlComponent('a b&c=d'), 'a%20b%26c%3Dd');
  assert.equal(encodeUrlComponent('a b&c=d', { plusForSpace: true }), 'a+b%26c%3Dd');

  const original = 'a b+c & 100% café 👋';
  const encoded = encodeUrlComponent(original, { plusForSpace: true });
  assert.equal(encoded.includes(' '), false);
  const back = decoded(encoded);
  assert.equal(back.text, original);
  assert.ok(hasWarning(back.warnings, '%2B'), 'a decoded + deserves a note about %2B');

  // Without plusForSpace the plus is left alone on the way out and kept on the
  // way back in.
  assert.equal(decodeUrlComponent('C++', { plusForSpace: false }).ok, true);
  const literal = decodeUrlComponent('C++', { plusForSpace: false });
  assert.ok(literal.ok);
  assert.equal(literal.text, 'C++');
  assert.deepEqual(literal.warnings, []);

  assert.equal(decoded('%F0%9F%91%8B').text, '👋');
  assert.deepEqual(decoded('%F0%9F%91%8B').warnings, []);
  assert.ok(hasWarning(decoded('%2520').warnings, 'encoded twice'));
});

test('duplicate query keys keep their order, raw and decoded', () => {
  const { url } = parsed('https://example.test/search?tag=a&q=hello+world&tag=b&tag=a&empty=');
  assert.deepEqual(
    url.params.map((param) => param.key),
    ['tag', 'q', 'tag', 'tag', 'empty'],
  );
  assert.deepEqual(
    url.params.map((param) => param.decoded),
    ['a', 'hello world', 'b', 'a', ''],
  );
  // The raw column shows what is written in the address, escapes and all.
  assert.equal(url.params[1]?.value, 'hello+world');
  assert.equal(url.params[1]?.decoded, 'hello world');
  assert.equal(url.search, '?tag=a&q=hello+world&tag=b&tag=a&empty=');
});

test('the pieces of an ordinary address are all reported', () => {
  const { url, warnings } = parsed('https://example.test/one/two%20three/?a=1#top');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'example.test');
  assert.equal(url.host, 'example.test');
  assert.equal(url.port, '');
  assert.equal(url.origin, 'https://example.test');
  assert.equal(url.pathname, '/one/two%20three/');
  assert.deepEqual(url.pathSegments, ['one', 'two%20three']);
  assert.equal(url.hash, '#top');
  assert.equal(url.username, '');
  assert.deepEqual(warnings, [], 'a normal address should not be nagged about');
});

test('a scheme-less address is assumed to be https, and says so', () => {
  const { url, warnings } = parsed('example.test/path?q=1');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.pathname, '/path');
  assert.ok(hasWarning(warnings, 'https:// was assumed'));

  // A dotted "scheme" is a host and a port, not a scheme.
  const withPort = parsed('example.test:8080/path');
  assert.equal(withPort.url.hostname, 'example.test');
  assert.equal(withPort.url.port, '8080');
  assert.ok(hasWarning(withPort.warnings, 'https:// was assumed'));
  assert.ok(hasWarning(withPort.warnings, 'port 8080'));
});

test('credentials in the address are called out as a security problem', () => {
  const { url, warnings } = parsed('https://admin:hunter2@example.test/admin');
  assert.equal(url.username, 'admin');
  assert.equal(url.password, 'hunter2');
  assert.ok(hasWarning(warnings, 'username and password'));
  assert.ok(hasWarning(warnings, 'compromised'));

  // A username on its own is still worth flagging, without claiming a password.
  const userOnly = parsed('ftp://anonymous@files.example.test/pub');
  assert.ok(hasWarning(userOnly.warnings, 'carries a username inside the link'));
  assert.equal(hasWarning(userOnly.warnings, 'and password'), false);
});

test('the other things worth telling a human about', () => {
  assert.ok(hasWarning(parsed('HtTpS://example.test/x').warnings, 'not case-sensitive'));
  assert.ok(hasWarning(parsed('https://example.test/my file.pdf').warnings, 'contains a space'));
  assert.ok(hasWarning(parsed('https://example.test:8443/').warnings, 'rather than the usual 443'));
  assert.ok(hasWarning(parsed('https://xn--bcher-kva.example/').warnings, 'punycode'));
  // An internationalised host is stored as punycode by every browser, so the
  // same note applies to input a user thinks of as ordinary letters.
  assert.ok(hasWarning(parsed('https://bücher.example/').warnings, 'punycode'));
  assert.ok(hasWarning(parsed('mailto:someone@example.test').warnings, 'rather than a web page'));
});

test('input that is not an address at all is rejected', () => {
  for (const bad of ['', '   ', 'http://', 'https://', 'not a url at all', ':::']) {
    const result = parseUrl(bad);
    assert.equal(result.ok, false, `expected "${bad}" to be rejected`);
    if (!result.ok) assert.match(result.error, /\.$/, 'errors are sentences');
  }
});

test('buildQueryString encodes, keeps duplicates and sorts stably', () => {
  assert.equal(
    buildQueryString([
      { key: 'q', value: 'a b' },
      { key: 'tag', value: 'x&y' },
    ]),
    'q=a%20b&tag=x%26y',
  );
  assert.equal(
    buildQueryString([{ key: 'q', value: 'a b' }], { plusForSpace: true }),
    'q=a+b',
  );
  assert.equal(
    buildQueryString(
      [
        { key: 'tag', value: 'first' },
        { key: 'a', value: '1' },
        { key: 'tag', value: 'second' },
      ],
      { sort: true },
    ),
    'a=1&tag=first&tag=second',
    'equal keys must keep their original order',
  );
  assert.equal(buildQueryString([]), '');
  assert.equal(buildQueryString([{ key: '', value: 'x' }]), '', 'a nameless parameter is dropped');
  assert.equal(buildQueryString([{ key: 'q', value: '' }]), 'q=', 'an empty value is a real request');

  // What is built can be read back.
  const built = buildQueryString([{ key: 'name', value: 'Ann & Bob' }]);
  assert.equal(parsed(`https://example.test/?${built}`).url.params[0]?.decoded, 'Ann & Bob');
});

test('encodeFullUrl keeps the structure of an address', () => {
  assert.equal(encodeFullUrl('https://example.test/a b?q=1&r=2#x'), 'https://example.test/a%20b?q=1&r=2#x');
  assert.equal(encodeFullUrl('https://example.test/café'), 'https://example.test/caf%C3%A9');
});

test('decodeDataUri handles both the base64 and the plain form', () => {
  const png = decodeDataUri('data:image/png;base64,iVBORw0KGgo=');
  assert.ok(png.ok, 'the PNG data URI should decode');
  assert.equal(png.mime, 'image/png');
  assert.equal(png.isBase64, true);
  assert.deepEqual(png.bytes, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const plain = decodeDataUri('data:text/plain,hello');
  assert.ok(plain.ok);
  assert.equal(plain.mime, 'text/plain');
  assert.equal(plain.isBase64, false);
  assert.equal(text(plain.bytes), 'hello');

  // Percent escapes in the plain form, and a + that means a plus.
  const escaped = decodeDataUri('data:text/plain,a%20b+c');
  assert.ok(escaped.ok);
  assert.equal(text(escaped.bytes), 'a b+c');

  // No type given: RFC 2397 says text/plain;charset=US-ASCII.
  const bare = decodeDataUri('data:,hi');
  assert.ok(bare.ok);
  assert.equal(bare.mime, 'text/plain;charset=US-ASCII');

  const withCharset = decodeDataUri('data:text/html;charset=utf-8;base64,PGI+aGk8L2I+');
  assert.ok(withCharset.ok);
  assert.equal(withCharset.mime, 'text/html;charset=utf-8');
  assert.equal(text(withCharset.bytes), '<b>hi</b>');
});

test('a broken data URI explains what is wrong', () => {
  const notData = decodeDataUri('https://example.test/x.png');
  assert.equal(notData.ok, false);
  if (!notData.ok) assert.match(notData.error, /starts with/);

  const noComma = decodeDataUri('data:image/png;base64');
  assert.equal(noComma.ok, false);
  if (!noComma.ok) assert.match(noComma.error, /needs a comma/);

  const badBase64 = decodeDataUri('data:image/png;base64,iVBOR*w0KGgo=');
  assert.equal(badBase64.ok, false);
  if (!badBase64.ok) assert.match(badBase64.error, /says it is Base64, but the data is not/);
});
