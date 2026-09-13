/**
 * ============================================================================
 * WRITING A POWERPOINT FILE
 * ============================================================================
 * A .pptx is a ZIP archive of XML documents following the Open Packaging
 * Conventions, and that is the whole reason this module can exist in a browser
 * at all: the site already has a ZIP writer, so building a deck is a matter of
 * emitting the right parts with the right relationships between them.
 *
 * ── What this writes, and what it deliberately does not ───────────────────
 * Every slide here is one picture on a blank background. That is exactly the
 * job for "images to PowerPoint" and for "PDF to PowerPoint", where each page
 * becomes a slide you can present, annotate around and reorder.
 *
 * It is *not* a layout engine. It writes no text boxes, no bullet lists, no
 * charts and no SmartArt, because producing those correctly means implementing
 * PowerPoint's text layout — line breaking, autofit, font substitution — and a
 * tool that gets that subtly wrong produces decks that look broken in the one
 * place you cannot check before presenting.
 *
 * ── The parts a minimal package needs ─────────────────────────────────────
 *   [Content_Types].xml              declares a type for every part
 *   _rels/.rels                      package → presentation
 *   ppt/presentation.xml             slide size, and the list of slide ids
 *   ppt/_rels/presentation.xml.rels  presentation → master, slides
 *   ppt/slideMasters/slideMaster1.xml + rels
 *   ppt/slideLayouts/slideLayout1.xml + rels
 *   ppt/theme/theme1.xml             required by the master; PowerPoint
 *                                    refuses to open a package without one
 *   ppt/slides/slideN.xml + rels     one per slide
 *   ppt/media/imageN.ext             the pictures, byte for byte
 *
 * Leave any one of those out and the file opens as "repair needed" — which is
 * the failure mode this module's tests exist to catch, by opening the output
 * with two unrelated readers.
 *
 * ── EMU, not points ───────────────────────────────────────────────────────
 * Office measures in English Metric Units: 914,400 to the inch, chosen because
 * it divides evenly by both 72 (points) and 25.4 (millimetres) with no
 * remainder. All geometry here is integer EMU, so nothing is ever off by a
 * rounding error that accumulates down a hundred-slide deck.
 *
 * ── Images go in untouched ────────────────────────────────────────────────
 * The bytes handed in are the bytes written. A JPEG is not decoded and
 * re-encoded on its way into the package, so a deck of photographs weighs what
 * the photographs weighed and loses no quality on the trip.
 * ============================================================================
 */
import { writeZip, type ZipEntry } from '../../files/zip.ts';

/** English Metric Units per inch. The unit every Office measurement uses. */
export const EMU_PER_INCH = 914_400;

/** Image formats PowerPoint will display from a package. */
export type PptxImageKind = 'jpeg' | 'png' | 'gif' | 'bmp';

const EXTENSION: Readonly<Record<PptxImageKind, string>> = {
  jpeg: 'jpeg',
  png: 'png',
  gif: 'gif',
  bmp: 'bmp',
};

const MIME: Readonly<Record<PptxImageKind, string>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

export interface PptxImage {
  kind: PptxImageKind;
  bytes: Uint8Array;
  /** Pixel dimensions, used to work out the shape on the slide. */
  width: number;
  height: number;
}

/**
 * Named slide shapes, in EMU.
 *
 * 16:9 is 13.333 by 7.5 inches, which is what PowerPoint has defaulted to
 * since 2013 and what every modern projector and screen share expects. 4:3 is
 * here for printing to paper and for older equipment.
 */
export const SLIDE_SIZES = {
  '16:9': { width: 12_192_000, height: 6_858_000, label: 'Widescreen 16:9' },
  '4:3': { width: 9_144_000, height: 6_858_000, label: 'Standard 4:3' },
} as const;

export type SlideSizeName = keyof typeof SLIDE_SIZES;

/** How a picture is placed on a slide whose shape does not match it. */
export type PptxFit =
  /** The whole picture, centred, with background showing at the sides. */
  | 'contain'
  /** Fills the slide; the overflowing edges are off the slide. */
  | 'cover'
  /** The slide takes the shape of the picture. No background is ever shown. */
  | 'fit';

export interface PptxOptions {
  /** Ignored when `fit` is 'fit', because then each slide follows its image. */
  size?: SlideSizeName;
  fit?: PptxFit;
  /** Written into the document properties. Optional. */
  title?: string;
  /** Slide background, as `RRGGBB`. Only visible under 'contain'. */
  background?: string;
}

export type PptxResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

/** Above this a deck stops being openable on ordinary hardware. */
const MAX_SLIDES = 300;
/** PowerPoint's own ceiling is 56 inches; this is the same in EMU. */
const MAX_EDGE_EMU = 56 * EMU_PER_INCH;

/* ────────────────────────────── xml helpers ─────────────────────────────── */

/**
 * Escape a string for XML text or an attribute value.
 *
 * Titles come from file names, and a file name may legally contain `&` and
 * `<`. Unescaped, either one produces a package that every reader rejects as
 * corrupt — the same class of bug as the JSON-LD escaping in `seo.ts`.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const NS_PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PACKAGE_RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS_CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/* ────────────────────────────── geometry ────────────────────────────────── */

export interface Placement {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

/**
 * Where a picture sits on the slide, in EMU.
 *
 * 'contain' is centred with letterboxing, 'cover' is centred with the overflow
 * running off the slide edges. Both centre, because a picture pinned to a
 * corner looks like a mistake.
 */
export function placeOnSlide(
  image: { width: number; height: number },
  slide: { width: number; height: number },
  fit: PptxFit,
): Placement {
  if (image.width <= 0 || image.height <= 0) {
    return { x: 0, y: 0, cx: slide.width, cy: slide.height };
  }
  if (fit === 'fit') return { x: 0, y: 0, cx: slide.width, cy: slide.height };

  const byWidth = slide.width / image.width;
  const byHeight = slide.height / image.height;
  const scale = fit === 'cover' ? Math.max(byWidth, byHeight) : Math.min(byWidth, byHeight);

  const cx = Math.round(image.width * scale);
  const cy = Math.round(image.height * scale);
  return {
    x: Math.round((slide.width - cx) / 2),
    y: Math.round((slide.height - cy) / 2),
    cx,
    cy,
  };
}

/**
 * A slide shaped like its picture, for 'fit'.
 *
 * The longest edge is held at ten inches and the other follows the aspect
 * ratio, which keeps a deck of mixed portrait and landscape scans at a sane
 * physical size while staying under PowerPoint's 56-inch limit.
 */
export function slideSizeForImage(image: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const safe = {
    width: image.width > 0 ? image.width : 4,
    height: image.height > 0 ? image.height : 3,
  };
  const longest = 10 * EMU_PER_INCH;
  const scale = longest / Math.max(safe.width, safe.height);
  return {
    width: Math.min(MAX_EDGE_EMU, Math.round(safe.width * scale)),
    height: Math.min(MAX_EDGE_EMU, Math.round(safe.height * scale)),
  };
}

/* ────────────────────────────── the parts ───────────────────────────────── */

function contentTypes(slideCount: number, kinds: Set<PptxImageKind>): string {
  const defaults = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...[...kinds].map(
      (kind) => `<Default Extension="${EXTENSION[kind]}" ContentType="${MIME[kind]}"/>`,
    ),
  ];
  const overrides = [
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    ...Array.from(
      { length: slideCount },
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    ),
  ];
  return `${XML_DECLARATION}<Types xmlns="${NS_CONTENT_TYPES}">${defaults.join('')}${overrides.join('')}</Types>`;
}

function packageRels(): string {
  return `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_RELS}"><Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
}

function presentation(slideCount: number, slide: { width: number; height: number }): string {
  // Slide ids must be at least 256; PowerPoint rejects anything lower.
  const ids = Array.from(
    { length: slideCount },
    (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`,
  ).join('');
  return `${XML_DECLARATION}<p:presentation xmlns:a="${NS_DRAWING}" xmlns:r="${NS_RELATIONSHIPS}" xmlns:p="${NS_PRESENTATION}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="${slide.width}" cy="${slide.height}"/><p:notesSz cx="${slide.height}" cy="${slide.width}"/></p:presentation>`;
}

function presentationRels(slideCount: number): string {
  const slides = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Relationship Id="rId${i + 2}" Type="${NS_RELATIONSHIPS}/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join('');
  // The theme relationship id follows the slides, so adding a slide never
  // renumbers an existing one.
  return `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_RELS}"><Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides}<Relationship Id="rId${slideCount + 2}" Type="${NS_RELATIONSHIPS}/theme" Target="theme/theme1.xml"/></Relationships>`;
}

/** An empty shape tree — the common opening of a master, a layout and a slide. */
function emptyTree(): string {
  return `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;
}

function slideMaster(background: string): string {
  return `${XML_DECLARATION}<p:sldMaster xmlns:a="${NS_DRAWING}" xmlns:r="${NS_RELATIONSHIPS}" xmlns:p="${NS_PRESENTATION}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${emptyTree()}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
}

function slideMasterRels(): string {
  return `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_RELS}"><Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${NS_RELATIONSHIPS}/theme" Target="../theme/theme1.xml"/></Relationships>`;
}

/** `type="blank"` is what makes PowerPoint offer no placeholders on the slide. */
function slideLayout(): string {
  return `${XML_DECLARATION}<p:sldLayout xmlns:a="${NS_DRAWING}" xmlns:r="${NS_RELATIONSHIPS}" xmlns:p="${NS_PRESENTATION}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${emptyTree()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function slideLayoutRels(): string {
  return `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_RELS}"><Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
}

/**
 * The theme.
 *
 * Nothing here is used by a picture-only deck, and the package is rejected
 * without it: the master declares a theme relationship, and a dangling
 * relationship is a malformed package. So this is the smallest theme that
 * satisfies the schema — the standard Office colour slots, one Latin font, and
 * the one fill, line and effect style list each of the three style lists must
 * contain.
 */
function theme(): string {
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/></a:ln>`;
  return `${XML_DECLARATION}<a:theme xmlns:a="${NS_DRAWING}" name="The Toolzen"><a:themeElements><a:clrScheme name="The Toolzen"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="0F766E"/></a:accent1><a:accent2><a:srgbClr val="14B8A6"/></a:accent2><a:accent3><a:srgbClr val="5EEAD4"/></a:accent3><a:accent4><a:srgbClr val="A7F3D0"/></a:accent4><a:accent5><a:srgbClr val="99F6E4"/></a:accent5><a:accent6><a:srgbClr val="2DD4BF"/></a:accent6><a:hlink><a:srgbClr val="0F766E"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="The Toolzen"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="The Toolzen"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${line}${line}${line}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function slideXml(placement: Placement, name: string): string {
  return `${XML_DECLARATION}<p:sld xmlns:a="${NS_DRAWING}" xmlns:r="${NS_RELATIONSHIPS}" xmlns:p="${NS_PRESENTATION}"><p:cSld><p:spTree>${emptyTree()}<p:pic><p:nvPicPr><p:cNvPr id="2" name="${escapeXml(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${placement.x}" y="${placement.y}"/><a:ext cx="${placement.cx}" cy="${placement.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function slideRels(index: number, kind: PptxImageKind): string {
  return `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_RELS}"><Relationship Id="rId1" Type="${NS_RELATIONSHIPS}/image" Target="../media/image${index}.${EXTENSION[kind]}"/></Relationships>`;
}

/* ────────────────────────────── the writer ──────────────────────────────── */

/** `RRGGBB`, upper-cased. Anything else falls back to white. */
function normaliseColour(value: string | undefined): string {
  const hex = (value ?? '').replace(/^#/, '').trim();
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : 'FFFFFF';
}

/**
 * Build a .pptx from a list of pictures, one per slide.
 *
 * Returns the house result shape rather than throwing: every caller is a
 * button, and both failures here are worth a sentence a person can act on.
 */
export function writePptx(images: readonly PptxImage[], opts: PptxOptions = {}): PptxResult {
  if (images.length === 0) {
    return { ok: false, error: 'Add at least one image to build a presentation.' };
  }
  if (images.length > MAX_SLIDES) {
    return {
      ok: false,
      error: `A presentation here holds up to ${MAX_SLIDES} slides. Split the job into parts.`,
    };
  }

  const fit = opts.fit ?? 'contain';
  const background = normaliseColour(opts.background);

  // With 'fit', every slide would want its own shape — but a PowerPoint file
  // has exactly one slide size for the whole deck. The first image decides it,
  // and the rest are placed inside that, which is the only honest reading of
  // "fit" for a format that cannot do per-slide sizes.
  const slide =
    fit === 'fit'
      ? slideSizeForImage(images[0] as PptxImage)
      : SLIDE_SIZES[opts.size ?? '16:9'];

  const kinds = new Set<PptxImageKind>();
  const entries: ZipEntry[] = [];

  for (const [index, image] of images.entries()) {
    if (!(image.bytes instanceof Uint8Array) || image.bytes.length === 0) {
      return { ok: false, error: `Image ${index + 1} has no data in it.` };
    }
    kinds.add(image.kind);

    // With 'fit', only the first image fills the slide exactly; the others are
    // contained inside it so nothing is ever cropped without being asked for.
    const placement = placeOnSlide(image, slide, fit === 'fit' && index > 0 ? 'contain' : fit);

    entries.push({
      name: `ppt/slides/slide${index + 1}.xml`,
      data: text(slideXml(placement, `Picture ${index + 1}`)),
    });
    entries.push({
      name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      data: text(slideRels(index + 1, image.kind)),
    });
    entries.push({
      name: `ppt/media/image${index + 1}.${EXTENSION[image.kind]}`,
      data: image.bytes,
    });
  }

  entries.unshift(
    { name: '[Content_Types].xml', data: text(contentTypes(images.length, kinds)) },
    { name: '_rels/.rels', data: text(packageRels()) },
    { name: 'ppt/presentation.xml', data: text(presentation(images.length, slide)) },
    { name: 'ppt/_rels/presentation.xml.rels', data: text(presentationRels(images.length)) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: text(slideMaster(background)) },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: text(slideMasterRels()) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: text(slideLayout()) },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: text(slideLayoutRels()) },
    { name: 'ppt/theme/theme1.xml', data: text(theme()) },
  );

  // `keepPaths` matters more here than anywhere else in the codebase. The ZIP
  // writer flattens names by default, which is right for an archive of a user's
  // files and fatal for this one: every part of an OPC package is addressed by
  // its path from a relationship, so `ppt/slides/slide1.xml` collapsing to
  // `slide1.xml` produces a file PowerPoint offers to repair and cannot open.
  const archive = writeZip(entries, { keepPaths: true });
  if (!archive.ok) return { ok: false, error: archive.error };
  return { ok: true, bytes: archive.bytes };
}
