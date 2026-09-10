import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lastSegment,
  safeBaseName,
  sanitiseNamePart,
  splitName,
  uniqueNames,
  withExtension,
} from './name.ts';

test('lastSegment: a name is never a path', () => {
  assert.equal(lastSegment('../../etc/passwd.png'), 'passwd.png');
  assert.equal(lastSegment('C:\\Users\\me\\photo.png'), 'photo.png');
  assert.equal(lastSegment('/tmp/a/b/c.pdf'), 'c.pdf');
  assert.equal(lastSegment('plain.txt'), 'plain.txt');
  assert.equal(lastSegment(''), '');
});

test('withExtension: traversal cannot survive', () => {
  assert.equal(withExtension('../../etc/passwd.png', 'jpg'), 'passwd.jpg');
  assert.equal(withExtension('..\\..\\windows\\system32\\cmd.exe', 'txt'), 'cmd.txt');
  // A name that is nothing but separators and dots has no base left.
  assert.equal(withExtension('../../', 'pdf', { fallback: 'document' }), 'document.pdf');
});

test('sanitiseNamePart: forbidden characters go, letters stay', () => {
  assert.equal(sanitiseNamePart('a<b>c:d"e|f?g*h'), 'abcdefgh');
  assert.equal(sanitiseNamePart('写真 vacaciones'), '写真 vacaciones');
  assert.equal(sanitiseNamePart('  ...hidden'), 'hidden');
});

test('sanitiseNamePart: a tab between words becomes a space, not nothing', () => {
  assert.equal(sanitiseNamePart('my\tphoto'), 'my photo');
  assert.equal(sanitiseNamePart('two\n\nlines'), 'two lines');
  assert.equal(sanitiseNamePart('collapse    runs'), 'collapse runs');
});

test('sanitiseNamePart: control characters are removed', () => {
  const withControls = `head${String.fromCharCode(0)}mid${String.fromCharCode(31)}tail`;
  assert.equal(sanitiseNamePart(withControls), 'headmidtail');
  assert.equal(sanitiseNamePart(`del${String.fromCharCode(127)}`), 'del');
});

test('splitName: only one plausible extension is split off', () => {
  assert.deepEqual(splitName('photo.tar.gz'), { base: 'photo.tar', extension: 'gz' });
  assert.deepEqual(splitName('photo.PNG'), { base: 'photo', extension: 'png' });
  assert.deepEqual(splitName('noextension'), { base: 'noextension', extension: '' });
  // A digit group is never an extension.
  assert.deepEqual(splitName('IMG_2024.123456'), { base: 'IMG_2024.123456', extension: '' });
  assert.deepEqual(splitName('version.1.2.3'), { base: 'version.1.2.3', extension: '' });
  // A leading dot is a hidden file, not an extension.
  assert.deepEqual(splitName('.gitignore'), { base: '.gitignore', extension: '' });
  // Nine characters is too long to be one.
  assert.deepEqual(splitName('archive.extension'), { base: 'archive.extension', extension: '' });
});

test('withExtension: unicode names survive intact', () => {
  assert.equal(withExtension('写真.png', 'webp'), '写真.webp');
  assert.equal(withExtension('vacaciones 🏖.png', 'jpg'), 'vacaciones 🏖.jpg');
});

test('safeBaseName: the cap cuts by code point, never mid-character', () => {
  const long = '🏖'.repeat(300);
  const capped = safeBaseName(long);
  assert.equal(Array.from(capped).length, 200);
  // A lone surrogate would make this length 400 or leave an unpaired unit.
  assert.equal(capped, '🏖'.repeat(200));
});

test('safeBaseName: Windows device names are changed', () => {
  assert.equal(withExtension('CON.png', 'jpg', { fallback: 'image' }), 'CON-image.jpg');
  assert.equal(withExtension('nul', 'txt'), 'nul-file.txt');
  assert.equal(withExtension('com9.dat', 'txt', { fallback: 'image' }), 'com9-image.txt');
  // Not reserved: only the exact names are.
  assert.equal(withExtension('console.png', 'jpg'), 'console.jpg');
});

test('safeBaseName: trailing dots and spaces go, because Windows drops them', () => {
  assert.equal(withExtension('trailing...  ', 'pdf'), 'trailing.pdf');
  assert.equal(withExtension('space .png', 'jpg'), 'space.jpg');
});

test('safeBaseName: suffix is appended before the extension and sanitised too', () => {
  assert.equal(withExtension('photo.png', 'jpg', { suffix: '-compressed' }), 'photo-compressed.jpg');
  // The suffix goes through the same sanitiser: separators are dropped, and the
  // leading-dot rule removes the `..` as well, so no traversal fragment reaches
  // the name even in the middle of it.
  assert.equal(withExtension('photo.png', 'jpg', { suffix: '/../evil' }), 'photoevil.jpg');
});

test('withExtension: the extension itself is sanitised strictly', () => {
  assert.equal(withExtension('photo.png', '.JPG'), 'photo.jpg');
  assert.equal(withExtension('photo.png', '../png'), 'photo.png');
  assert.equal(withExtension('photo.png', ''), 'photo');
});

test('withExtension: an empty or absent name still produces something openable', () => {
  assert.equal(withExtension('', 'pdf'), 'file.pdf');
  assert.equal(withExtension('   ', 'pdf', { fallback: 'document' }), 'document.pdf');
  assert.equal(withExtension('<<<>>>', 'png', { fallback: 'image' }), 'image.png');
});

test('uniqueNames: duplicates are numbered the way a file manager numbers them', () => {
  assert.deepEqual(uniqueNames(['scan.pdf', 'scan.pdf', 'scan.pdf']), [
    'scan.pdf',
    'scan (2).pdf',
    'scan (3).pdf',
  ]);
  assert.deepEqual(uniqueNames(['note', 'note']), ['note', 'note (2)']);
});

test('uniqueNames: comparison is case-insensitive, because two filesystems are', () => {
  assert.deepEqual(uniqueNames(['Scan.pdf', 'scan.pdf']), ['Scan.pdf', 'scan (2).pdf']);
});

test('uniqueNames: an existing numbered name is not duplicated', () => {
  assert.deepEqual(uniqueNames(['scan.pdf', 'scan (2).pdf', 'scan.pdf']), [
    'scan.pdf',
    'scan (2).pdf',
    'scan (3).pdf',
  ]);
});

test('uniqueNames: order is preserved and unique names are untouched', () => {
  assert.deepEqual(uniqueNames(['a.png', 'b.png', 'c.png']), ['a.png', 'b.png', 'c.png']);
  assert.deepEqual(uniqueNames([]), []);
});
