/**
 * A media type guessed from a file name.
 *
 * Needed by exactly one situation: a tool that hands back a file whose type it
 * never learned. Unlocking an archive is the case — the entries inside could be
 * anything, and nothing in the archive records what they are beyond the name.
 *
 * Why a guess is acceptable here when the rest of the site sniffs real bytes:
 * this value goes on a `Blob` that is immediately downloaded, where it decides
 * nothing except which icon the browser shows in its download shelf. Getting it
 * wrong costs a generic icon. The site's *input* handling never trusts a name
 * for anything, which is the direction where being wrong is dangerous.
 *
 * The list is short on purpose. It covers what people actually put in a
 * protected archive — documents, images, archives — and everything else falls
 * through to the universal "some bytes", which every browser handles correctly.
 */

const TYPES: Readonly<Record<string, string>> = {
  // documents
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  md: 'text/markdown',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',

  // images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',

  // media
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',

  // archives and the rest
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
};

/** The type every browser treats as "save this, do not try to display it". */
export const OCTET_STREAM = 'application/octet-stream';

export function guessMime(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return OCTET_STREAM;
  return TYPES[name.slice(dot + 1).toLowerCase()] ?? OCTET_STREAM;
}
