/**
 * ============================================================================
 * WRITING A .ICO FILE
 * ============================================================================
 * A favicon.ico is not an image format so much as a container: a small index
 * followed by several complete images, so one file can carry 16, 32 and 48
 * pixel versions and let the operating system pick.
 *
 * ── Why the payloads are PNG and not BMP ──────────────────────────────────
 * The original format stored a headless BMP with an upside-down pixel array and
 * a separate 1-bit AND mask — a fiddly thing to write correctly, and larger.
 * Since Windows Vista an entry may instead be a complete PNG file, byte for
 * byte, and every browser released this decade reads that: Chrome, Firefox,
 * Safari, Edge, and Windows Explorer itself.
 *
 * So each entry here is a PNG produced by the browser's own encoder. That keeps
 * the alpha channel exact, keeps the file small, and means this module's whole
 * job is the twenty-two bytes of bookkeeping around each image.
 *
 * The one thing it costs is Windows XP, which shows nothing for a PNG-payload
 * icon. That is a trade the copy states rather than one made silently.
 *
 * ── Why the sizes are written by hand and not measured ────────────────────
 * The directory records each image's own width and height, and a reader that
 * finds a 32-pixel PNG under an entry claiming 16 will scale it. The caller
 * passes both, and `buildIco` refuses a mismatch rather than producing a file
 * that renders blurred on one platform and fine on another.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 *   6 bytes   header: reserved(2) type(2) count(2)
 *  16 bytes   per entry, in a directory immediately after the header
 *   …         the image payloads, in directory order
 * Every multi-byte number is little-endian, which is what `DataView` does when
 * told to; the flag is passed explicitly on every write so nobody has to
 * remember the default.
 * ============================================================================
 */

/** One image inside the icon. `png` must be a complete PNG file. */
export interface IcoImage {
  width: number;
  height: number;
  png: Uint8Array;
}

export type IcoResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

/** The largest an ICO entry can describe. 256 is stored as 0 in one byte. */
export const ICO_MAX_EDGE = 256;

/** What a favicon.ico is normally built from. Anything larger belongs in a PNG. */
export const ICO_SIZES: readonly number[] = [16, 32, 48];

/** The PNG signature, checked so a JPEG never ends up inside an icon. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Read a PNG's declared dimensions from its IHDR chunk.
 *
 * The header is fixed: 8 bytes of signature, a 4-byte length, the tag `IHDR`,
 * then width and height as big-endian 32-bit integers. No chunk may precede
 * IHDR, so the offsets are constant.
 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(12, false) !== 0x49484452) return null; // 'IHDR'
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

/**
 * Assemble an .ico from one or more PNGs.
 *
 * Entries are written in the order given. Readers are supposed to choose by
 * size rather than position, but ascending order is what every real icon file
 * uses and there is no reason to be the exception.
 */
export function buildIco(images: readonly IcoImage[]): IcoResult {
  if (images.length === 0) return { ok: false, error: 'An icon needs at least one image.' };
  if (images.length > 0xffff) return { ok: false, error: 'Too many images for one icon file.' };

  for (const image of images) {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height)) {
      return { ok: false, error: 'Icon sizes must be whole numbers of pixels.' };
    }
    if (
      image.width < 1 ||
      image.height < 1 ||
      image.width > ICO_MAX_EDGE ||
      image.height > ICO_MAX_EDGE
    ) {
      return { ok: false, error: `An icon image must be between 1 and ${ICO_MAX_EDGE} pixels.` };
    }
    if (!isPng(image.png)) {
      return { ok: false, error: 'Each icon image must be a PNG.' };
    }
    const declared = readPngSize(image.png);
    if (declared === null) {
      return { ok: false, error: 'One of the icon images has an unreadable PNG header.' };
    }
    // See the header: a lie here renders blurred on some platforms only.
    if (declared.width !== image.width || declared.height !== image.height) {
      return {
        ok: false,
        error: 'An icon entry does not match the size of its image.',
      };
    }
  }

  const directoryEnd = HEADER_BYTES + images.length * ENTRY_BYTES;
  const total = images.reduce((sum, image) => sum + image.png.length, directoryEnd);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // 1 = icon (2 would be a cursor)
  view.setUint16(4, images.length, true);

  let offset = directoryEnd;
  images.forEach((image, index) => {
    const at = HEADER_BYTES + index * ENTRY_BYTES;
    // 256 does not fit in a byte and is written as 0 — the format's one quirk.
    bytes[at] = image.width === ICO_MAX_EDGE ? 0 : image.width;
    bytes[at + 1] = image.height === ICO_MAX_EDGE ? 0 : image.height;
    bytes[at + 2] = 0; // palette size; 0 for a truecolour image
    bytes[at + 3] = 0; // reserved
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, image.png.length, true);
    view.setUint32(at + 12, offset, true);

    bytes.set(image.png, offset);
    offset += image.png.length;
  });

  return { ok: true, bytes };
}

/**
 * The markup that makes a browser use the files.
 *
 * Written as the modern short set rather than the twenty-line block that gets
 * copied around: one ICO for legacy and desktop browsers, one SVG-or-PNG for
 * everything current, one apple-touch-icon, and a manifest for Android. Every
 * extra `<link>` beyond these is answering a question no shipping browser asks.
 */
export function faviconMarkup(opts: { manifest: boolean }): string {
  const lines = [
    '<link rel="icon" href="/favicon.ico" sizes="32x32">',
    '<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  ];
  if (opts.manifest) lines.push('<link rel="manifest" href="/site.webmanifest">');
  return lines.join('\n');
}

/** A minimal, valid web app manifest naming the two icons Android looks for. */
export function faviconManifest(opts: { name: string; themeColor: string }): string {
  return `${JSON.stringify(
    {
      name: opts.name,
      short_name: opts.name,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
      theme_color: opts.themeColor,
      background_color: opts.themeColor,
      display: 'standalone',
    },
    null,
    2,
  )}\n`;
}
