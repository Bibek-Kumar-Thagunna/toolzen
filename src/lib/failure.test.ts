import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  GENERIC_FAILURE,
  OUT_OF_MEMORY_FAILURE,
  classifyFailure,
  isCancellation,
  isOutOfMemory,
} from './failure.ts';

test('a cancellation is recognised however it was raised', () => {
  assert.equal(isCancellation(new DOMException('stopped', 'AbortError')), true);
  // Some engines and polyfills raise a plain error with the name set.
  const plain = new Error('stopped');
  plain.name = 'AbortError';
  assert.equal(isCancellation(plain), true);
  assert.equal(isCancellation({ name: 'AbortError' }), true);
  assert.equal(isCancellation(new Error('something else')), false);
  assert.equal(isCancellation(null), false);
  assert.equal(isCancellation('AbortError'), false);
});

test('an allocation failure is recognised in both of its browser forms', () => {
  assert.equal(isOutOfMemory(new RangeError('Array buffer allocation failed')), true);
  assert.equal(isOutOfMemory(new DOMException('too big', 'QuotaExceededError')), true);
  assert.equal(isOutOfMemory(new TypeError('nope')), false);
});

test('an unrecognised exception becomes a sentence, and its message is discarded', () => {
  const leaky = new TypeError("Cannot read properties of null (reading 'width')");
  const classified = classifyFailure(leaky);
  assert.equal(classified.reason, 'unknown');
  assert.equal(classified.error, GENERIC_FAILURE);
  assert.ok(!classified.error.includes('null'));
  assert.ok(!classified.error.includes('width'));
  assert.ok(!classified.error.includes('TypeError'));
});

test('an allocation failure gets advice that actually helps', () => {
  const classified = classifyFailure(new RangeError('Array buffer allocation failed'));
  assert.equal(classified.reason, 'out_of_memory');
  assert.equal(classified.error, OUT_OF_MEMORY_FAILURE);
  assert.match(classified.error, /fewer files/);
});

test('a cancellation classifies with nothing to say', () => {
  const classified = classifyFailure(new DOMException('stopped', 'AbortError'));
  assert.equal(classified.reason, 'cancelled');
  assert.equal(classified.error, '');
});

test('anything at all can be thrown, and none of it reaches the user', () => {
  // Third-party code throws strings, numbers, and objects that are not errors.
  for (const thrown of ['boom', 42, null, undefined, {}, [], new Error()]) {
    const classified = classifyFailure(thrown);
    assert.equal(classified.error, GENERIC_FAILURE);
    assert.equal(classified.reason, 'unknown');
  }
});

test('the sentences are written for people, not for engineers', () => {
  for (const sentence of [GENERIC_FAILURE, OUT_OF_MEMORY_FAILURE]) {
    assert.ok(/[.!]$/.test(sentence), 'a full sentence, ending in a full stop');
    for (const word of ['undefined', 'null', 'Error', 'exception', 'stack', 'API']) {
      assert.ok(!sentence.includes(word), `"${word}" should not appear in "${sentence}"`);
    }
  }
});

test('the module stays pure and isomorphic', () => {
  const source = readFileSync(new URL('./failure.ts', import.meta.url), 'utf8');
  for (const banned of ['document.', 'window.', 'fetch(', "from 'node:", 'console.']) {
    assert.ok(!source.includes(banned), `${banned} must not appear here`);
  }
  for (const line of source.match(/^import .*$/gm) ?? []) {
    assert.match(line, /from '\.{1,2}\//, `${line} has to be a relative import`);
    assert.match(line, /\.ts'/, `${line} needs its .ts extension`);
  }
});
