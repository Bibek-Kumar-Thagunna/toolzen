import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { archiveName, downloadBlob, downloadZip, safeDownloadName } from './download.ts';

test('safeDownloadName: a path is reduced to a name, and a name always exists', () => {
  assert.equal(safeDownloadName('../../etc/passwd'), 'passwd');
  assert.equal(safeDownloadName('C:\\Users\\me\\photo.png'), 'photo.png');
  assert.equal(safeDownloadName('report:2026.pdf'), 'report2026.pdf');
  assert.equal(safeDownloadName(''), 'download');
  assert.equal(safeDownloadName('<<<>>>', 'result'), 'result');
});

test('archiveName: the archive is named after what is in it', () => {
  assert.equal(archiveName('compressed-images'), 'compressed-images.zip');
  assert.equal(archiveName('compressed-images.zip'), 'compressed-images.zip');
  assert.equal(archiveName(''), 'files.zip');
});

test('outside a browser every entry point fails honestly instead of throwing', () => {
  // This runs on the server during the first render of any tool page, so the
  // failure path is real rather than theoretical. It must not throw, and the
  // sentence must be one a user could act on.
  const blob = downloadBlob(new Blob(['x']), 'a.txt');
  assert.equal(blob.ok, false);
  if (blob.ok) return;
  assert.equal(blob.reason, 'unknown');
  assert.match(blob.error, /browser tab/);
  assert.match(blob.error, /nothing was sent anywhere/);

  const zip = downloadZip([{ name: 'a.txt', data: new Uint8Array([1]) }], 'results');
  assert.equal(zip.ok, false);
});

test('a failing archive is reported as its own failure, not as a download failure', () => {
  // An empty results list is a caller bug, but the user still gets the sentence
  // that fits the situation rather than a generic download error.
  const result = downloadZip([], 'results');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'invalid_input');
  assert.match(result.error, /no files/);
});

test('the module touches the browser in exactly the ways it documents', () => {
  const source = readFileSync(new URL('./download.ts', import.meta.url), 'utf8');
  // Anything that reaches the network would make the privacy claim on every
  // browser-processing tool page false, and this is the module best placed to
  // smuggle one in.
  for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', "from 'node:"]) {
    assert.ok(!source.includes(banned), `${banned} must not appear in a download helper`);
  }
  // The three portability rules from the header, asserted rather than trusted.
  assert.match(source, /document\.body\.append\(anchor\)/);
  assert.match(source, /setTimeout\(/);
  assert.ok(!/\brevokeObjectURL\(url\);\s*\n\s*return \{ ok: true/.test(source));
});
