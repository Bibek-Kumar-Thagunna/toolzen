import type { Tool } from '../types';
import { PDF_MANY, PDF_ONE, RASTER_IMAGES_MANY } from '../../tools/accepts.ts';

/**
 * Registry entries for the PDF category.
 *
 * image-to-pdf is backed by src/lib/tools/pdf/writer.ts, pages.ts and jpeg.ts,
 * and the copy below sticks to what those three actually do — verbatim
 * /DCTDecode embedding for JPEG, deflate plus a soft mask for everything else,
 * and the page geometry and limits declared in pages.ts and writer.ts.
 *
 * merge-pdf and split-pdf are built on pdf-lib (writing) and pdfjs-dist
 * (thumbnail rendering), both of which run in the browser. Claims here are
 * limited to copying pages, which is what those libraries do; nothing is said
 * about rebuilding outlines, signatures or form behaviour, because they do not.
 */
export const pdfTools: Tool[] = [
  {
    slug: 'image-to-pdf',
    name: 'Image to PDF',
    h1: 'Convert images to PDF',
    tagline: 'Put a set of photos, scans or screenshots into one PDF that opens the same everywhere.',
    category: 'pdf',
    icon: 'file-pdf',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Images to PDF — JPG and PNG',
    metaDescription:
      'Turn JPG and PNG images into one PDF, with A4, Letter or fit-to-image pages. JPEGs are embedded exactly as they are, so nothing is re-compressed.',
    primaryKeyword: 'image to pdf',
    secondaryKeywords: [
      'jpg to pdf',
      'png to pdf',
      'combine images into one pdf',
      'page size',
      'fit to image',
    ],
    synonyms: [
      'jpeg to pdf',
      'convert pictures to pdf',
      'scan to pdf',
      'make a pdf from photos',
      'image to pdf converter',
      'pictures into one document',
      'multiple images to pdf',
    ],
    accepts: RASTER_IMAGES_MANY,
    howTo: {
      title: 'How to convert images to PDF',
      steps: [
        'Add your images in the order you want them, then drag to rearrange.',
        'Choose a page size — A4, Letter, one of the others, or fit each page to its image.',
        'Decide how the image sits on the page: contain, cover or actual size, with a margin if you want one.',
        'Build the PDF and download it.',
      ],
    },
    features: [
      {
        title: 'JPEGs are embedded, not re-encoded',
        body: 'A PDF can carry a JPEG bitstream exactly as it arrived, and that is what happens here. No decode, no second generation of compression loss, and the document ends up barely larger than the photos that went into it.',
      },
      {
        title: 'Everything else is stored losslessly',
        body: 'PNG, WebP, GIF and BMP are drawn and then deflate-compressed, with any transparency written as a separate soft mask. A cut-out still looks like a cut-out on the page rather than a rectangle.',
      },
      {
        title: 'Page sizes that match real paper',
        body: 'A4, A3, A5, Letter, Legal and Tabloid at their exact point dimensions, plus a fit-to-image mode where each page takes the shape of its picture and no white space is left over.',
      },
      {
        title: 'Three ways to place an image',
        body: 'Contain fits the whole picture inside the margins, actual size honours the image’s own resolution, and cover fills the page. Margins are capped at 40% of the shorter side, so a page can never collapse to nothing.',
      },
      {
        title: 'A properly formed PDF 1.7 file',
        body: 'The cross-reference table is written from measured byte offsets rather than estimates, so readers that check it do not complain. The same images with the same settings produce a byte-identical file every time.',
      },
      {
        title: 'No metadata you did not supply',
        body: 'The document information carries only the title and author you type in, plus a producer line. Dates are written in UTC, so the file does not disclose which time zone you are in.',
      },
    ],
    faq: [
      {
        q: 'Does putting images in a PDF reduce their quality?',
        a: 'A JPEG keeps every byte it had: its data is copied into the document untouched, so the picture in the PDF is identical to the one on your disk. Other formats are compressed with deflate, which is lossless, so their pixels are preserved too.',
      },
      {
        q: 'Why is my phone photo sideways in the PDF?',
        a: 'Photo apps often store the picture one way round and add a rotation flag telling viewers to turn it. PDF readers ignore that flag, so a verbatim copy of the image appears as it is really stored. Rotate the image before adding it — a quarter turn in the cropper costs nothing in quality.',
      },
      {
        q: 'How many images can go into one document?',
        a: 'Fifty per batch, and the writer itself stops at 500 pages or about 500 MB of output, with a maximum page edge of 200 inches. Long before those, a phone will run out of memory on a set of very large scans.',
      },
      {
        q: 'Does the cover option crop my image?',
        a: 'It hides the overflow rather than removing it. The whole picture is still inside the file and can be extracted by anyone curious enough, so cover is a layout choice and not a way to keep part of an image private. Crop it first if that is the aim.',
      },
      {
        q: 'What if one of my JPEGs is refused?',
        a: 'A few old variants cannot be displayed by PDF readers at all — arithmetic-coded JPEG, lossless JPEG, and files storing more than 8 bits per colour. Those are rejected with an explanation instead of producing a document full of grey boxes. Re-saving as an ordinary JPEG resolves it.',
      },
      {
        q: 'Can I set a title and author?',
        a: 'You can, and they are the only descriptive fields written into the file. Leave them empty and the document carries nothing but a producer line.',
      },
    ],
    content: [
      {
        heading: 'Fit to paper, or fit to the image',
        body: [
          'To combine images into one PDF you first have to decide whether the document will ever be printed. If it will, pick the paper size and let the pictures sit inside a margin — A4 is 595 × 842 points, Letter is 612 × 792, and a point is a seventy-second of an inch, which is the unit PDF works in internally.',
          'If it is never going near a printer — screenshots for a bug report, receipts for an expense claim, a photo set to email — choosing fit to image is usually better. Each page takes the exact proportions of its picture, so there are no white bands and nothing is scaled to fit.',
          'For a mixed set, leave orientation on auto. A landscape photo dropped onto a portrait A4 page wastes most of the sheet; turning the page to match the picture uses the paper you are paying for.',
        ],
      },
      {
        heading: 'Why verbatim JPEG embedding matters',
        body: [
          'JPG to PDF and PNG to PDF take different routes through the writer, and the JPEG one is worth explaining. Most tools that build a PDF from photographs decode each image and encode it again, which adds a second round of JPEG loss on top of whatever the camera already did. It is the easier thing to implement and it is slightly worse every single time.',
          'None of that is necessary, because a PDF stream can hold a JPEG exactly as it stands. The bytes are copied across, the colour space is read from the file’s own header, and the finished document weighs roughly what the photographs weighed — no larger, no blurrier.',
          'The fiddly case is a CMYK JPEG from print software, which stores its channels inverted. Those files are detected and the inversion is recorded in the page, which is the difference between a white sky and a black one.',
        ],
      },
      {
        heading: 'A file you can hand to someone else',
        body: [
          'Only the title and author you choose to type are written into the document information. There is no user name, no editing history and no software fingerprint beyond a producer line, and every date is stamped in UTC so the file does not quietly announce your time zone.',
          'The output is also reproducible: identical images with identical settings produce identical bytes. That is useful when a document goes into version control or gets checked against a hash, and it is only possible because nothing random or clock-dependent is written into the file.',
        ],
      },
    ],
    related: ['merge-pdf', 'image-compressor', 'image-resizer', 'split-pdf'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'merge-pdf',
    name: 'Merge PDF',
    h1: 'Merge PDF files',
    tagline: 'Join several documents into one, in the order you choose, without handing them to anyone.',
    category: 'pdf',
    icon: 'merge',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Merge PDF Files',
    metaDescription:
      'Combine PDFs into one file, reorder the pages and drop the ones you do not want. Runs in your browser, so contracts and statements stay on your device.',
    primaryKeyword: 'merge pdf',
    secondaryKeywords: [
      'combine pdf',
      'merge pdf files',
      'reorder pages',
      'remove pages',
      'password-protected pdf',
    ],
    synonyms: [
      'combine pdf files',
      'join pdf',
      'pdf merger',
      'append pdf',
      'put pdfs together',
      'concatenate pdf',
      'merge documents',
      'add pdf to pdf',
    ],
    accepts: PDF_MANY,
    howTo: {
      title: 'How to merge PDF files',
      steps: [
        'Add the PDFs you want to combine — up to twenty, each up to 100 MB.',
        'Drag the files into the order you want them to appear.',
        'Remove pages that should not be in the result.',
        'Merge, then download the combined document.',
      ],
    },
    features: [
      {
        title: 'Pages are copied, not re-rendered',
        body: 'Each page is carried across as it stands, so text stays selectable and searchable, vector graphics stay sharp at any zoom, and embedded photographs are not compressed a second time.',
      },
      {
        title: 'Order and drop before you commit',
        body: 'Reorder pages by dragging whole files into place, and exclude the individual pages you do not want. The merged document is built from what is left, so there is no tidying-up pass afterwards.',
      },
      {
        title: 'The documents stay with you',
        body: 'Parsing and writing both happen in the browser tab. A contract, a payslip or a medical letter does not have to be handed to a third party just to be joined to another file.',
      },
      {
        title: 'No watermark and no page cap',
        body: 'The result is the result: nothing is stamped on it, no pages are held back, and there is no queue. Twenty files of up to 100 MB each per merge, with your device’s memory as the practical ceiling beyond that.',
      },
      {
        title: 'Clear about what it cannot keep',
        body: 'Bookmarks and the document outline belong to a file as a whole rather than to any individual page, so they are not rebuilt in the merged document. Page content itself comes through unchanged.',
      },
    ],
    faq: [
      {
        q: 'Can it merge a password-protected PDF?',
        a: 'Not while it is still protected. An encrypted document has to be decrypted before its pages can be read, so open it in a PDF reader with the password, save an unprotected copy, and merge that. Nothing here tries to get round a password.',
      },
      {
        q: 'Will the merged PDF still be searchable?',
        a: 'Yes, as long as the originals were. Pages are copied whole rather than turned into images, so embedded text and its fonts survive. A scanned document with no text layer stays exactly as unsearchable as it started.',
      },
      {
        q: 'How large a file can it handle?',
        a: 'A hundred megabytes per PDF, twenty files at a time. That is our number rather than a limit of the format or the browser — the real ceiling is your device\u2019s memory, since a merge has to hold every document open at once, and a phone gives a tab far less room than a laptop does.',
      },
      {
        q: 'Does the order of the files matter?',
        a: 'The output follows the order in the list exactly, and pages within each file keep their own sequence unless you remove some. Drag the list until it reads the way you want the document to read.',
      },
      {
        q: 'Are signatures and form fields preserved?',
        a: 'Treat both as unreliable. A digital signature covers one specific file and is invalidated by writing its pages into a new one, and interactive form fields may not survive the copy. Merge first, sign afterwards.',
      },
    ],
    content: [
      {
        heading: 'Merging without uploading',
        body: [
          'The documents people most often need to combine are the ones they should be most careful with: signed agreements, invoices, bank statements, a scan of a passport for a visa application. The usual online merge tool asks for all of it up front and offers a deletion policy in return.',
          'This one does the work in the tab. The files are read into memory, their pages are copied into a new document, and the result comes back as a download. There is no upload step to take on trust, which removes the question instead of answering it.',
        ],
      },
      {
        heading: 'What survives a merge, and what does not',
        body: [
          'Page content survives intact, because pages are copied rather than redrawn. Text is still text, a vector diagram still zooms cleanly, and an embedded image keeps the compression it already had rather than picking up another round of it.',
          'Anything attached to the document as a whole is a different story. The outline that produces a bookmark sidebar is not reconstructed, and links that pointed at a particular page of the old file have nothing reliable to point at in the new one.',
          'Encryption does not carry over either. A merged file is a new, unprotected document, so if the source needed a password to open, the result will not — add protection again yourself if the combined file needs it.',
        ],
      },
    ],
    related: ['split-pdf', 'image-to-pdf', 'image-compressor'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'split-pdf',
    name: 'Split PDF',
    h1: 'Split a PDF',
    tagline: 'Pull out the pages you need, or break a long document into parts you can send.',
    category: 'pdf',
    icon: 'split',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Split PDF — Extract or Split Pages',
    metaDescription:
      'Split a PDF by page range, every N pages, or by picking pages from thumbnails. The document is parsed on your device and never uploaded.',
    primaryKeyword: 'split pdf',
    secondaryKeywords: [
      'extract pdf pages',
      'page range',
      'split every n pages',
      'pdf page thumbnails',
      'save one page of a pdf',
    ],
    synonyms: [
      'separate pdf pages',
      'cut pdf',
      'pdf splitter',
      'extract page from pdf',
      'break up a pdf',
      'divide pdf',
      'pull pages out of a pdf',
    ],
    accepts: PDF_ONE,
    howTo: {
      title: 'How to split a PDF',
      steps: [
        'Open one PDF of up to 300 MB.',
        'Let the page thumbnails render, then choose a page range, a chunk size, or tick individual pages.',
        'Check the selection against the thumbnails.',
        'Split, and download the resulting file or files.',
      ],
    },
    features: [
      {
        title: 'You can see the pages',
        body: 'Every page is rendered as a thumbnail so you choose page 27 by looking at it instead of counting. The PDF page thumbnails are drawn locally by PDF.js, the same engine Firefox uses to display PDFs.',
      },
      {
        title: 'Three ways to split',
        body: 'Extract PDF pages as a single range such as 3 to 9, split every N pages into equal chunks, or tick exactly the pages you want and get one file containing them.',
      },
      {
        title: 'Pages are copied intact',
        body: 'Output pages are copied from the source rather than reprinted, so text stays selectable, vectors stay sharp and images are not compressed again.',
      },
      {
        title: 'Nothing is uploaded',
        body: 'Parsing, thumbnail rendering and writing all happen on your device. A confidential report can be cut down to the two pages you need without leaving the machine it is on.',
      },
      {
        title: 'One document at a time, deliberately',
        body: 'Splitting acts on a single file, so the picker takes one PDF of up to 300 MB. Only one document is ever in memory, which is why the single-file limit is three times the one for merging.',
      },
    ],
    faq: [
      {
        q: 'Can I split a password-protected PDF?',
        a: 'Not directly — the pages cannot be read until the file is decrypted. Open it in a reader with the password, save an unprotected copy, and split that instead.',
      },
      {
        q: 'Does splitting make the file much smaller?',
        a: 'Smaller, but rarely in proportion to the pages you dropped. Fonts and images are often shared across a document, and everything a kept page depends on has to come with it, so ten pages out of a hundred usually weigh more than a tenth of the original.',
      },
      {
        q: 'How large a PDF can it open?',
        a: 'Three hundred megabytes. On a long scanned document the limit you meet first is memory rather than that number: thumbnails for several hundred pages take real space in a tab, and a phone will give up well before a laptop will.',
      },
      {
        q: 'What happens to bookmarks?',
        a: 'They are not carried into the output. An outline describes the whole file, and what you get back is a new document containing only the pages you selected.',
      },
      {
        q: 'Can I delete pages rather than extract them?',
        a: 'Select the pages you want to keep — the output is your selection. Removing page 4 of a ten-page document means ticking the other nine, which the thumbnails make quick.',
      },
      {
        q: 'Is my original file modified?',
        a: 'No. The PDF you open is only read; the split output arrives as a separate download and the file on disk is exactly as it was.',
      },
    ],
    content: [
      {
        heading: 'Ranges, chunks and hand-picked pages',
        body: [
          'Three shapes of job, three controls. A range is for the report where you only need the appendix. Splitting every N pages suits a scanned batch where each invoice happens to run to two sheets. Ticking pages one by one is for the case where the useful ones are scattered through the document.',
          'The thumbnails matter more than they appear to, because a PDF’s page numbers frequently disagree with the numbers printed on the pages — a cover, a contents page and a blank leaf will offset everything by three. Selecting by eye is how you avoid extracting the wrong section and finding out later.',
        ],
      },
      {
        heading: 'What you get back',
        body: [
          'A range or a set of ticked pages produces one PDF, so to save one page of a PDF you tick it and nothing else. Splitting every N pages produces one file per chunk, each labelled with the pages it contains, so a folder of downloads is still identifiable an hour later.',
          'In every case the pages are copied rather than reprinted. Nothing is rasterised, so text that was searchable before is searchable still, and a vector chart zooms as cleanly as it did in the original. The result is a shorter document, not a picture of one.',
        ],
      },
    ],
    related: ['merge-pdf', 'image-to-pdf', 'image-compressor'],
    updated: '2026-09-03',
  },
  {
    slug: 'pdf-to-jpg',
    name: 'PDF to JPG',
    h1: 'Convert PDF to JPG',
    tagline: 'Turn every page of a document into a picture you can post, print or edit.',
    category: 'pdf',
    icon: 'file-image',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'PDF to JPG Converter',
    metaDescription:
      'Convert PDF pages to JPG, PNG or WebP at the quality you choose. Runs entirely in your browser, so contracts and statements are never uploaded.',
    primaryKeyword: 'pdf to jpg',
    secondaryKeywords: [
      'convert pdf to image',
      'pdf to png',
      'pdf pages to jpg',
      'extract images from pdf',
      'pdf to jpg 300 dpi',
    ],
    synonyms: [
      'pdf to picture',
      'save pdf page as image',
      'screenshot a pdf page',
      'pdf2jpg',
      'turn pdf into jpg',
      'convert scanned pdf to image',
      'pdf page to photo',
    ],
    accepts: PDF_ONE,
    howTo: {
      title: 'How to convert a PDF to JPG',
      steps: [
        'Drop your PDF onto the page, or choose it with the file picker.',
        'Pick a quality: Standard suits almost everything, Print/OCR if the pages will be printed or read by software.',
        'Choose JPG for scans and photographs, or PNG if the pages are mostly text and diagrams.',
        'Convert, then download the pages individually or all together as a ZIP.',
      ],
    },
    features: [
      {
        title: 'Your document never leaves the tab',
        body: 'The pages are drawn by your own browser using the same engine it uses to display a PDF. There is no upload, so a bank statement or a signed contract stays on your device.',
      },
      {
        title: 'A quality setting that says what it is for',
        body: 'Screen, Standard and Print/OCR rather than a row of numbers. The DPI is shown beside each one for anyone who wants it: 96, 150 and 300.',
      },
      {
        title: 'Three output formats, each with a reason',
        body: 'JPG for scanned pages, where it is several times smaller for no visible loss. PNG for text and line art, where JPEG leaves a halo around every letter. WebP when the images are going on a web page.',
      },
      {
        title: 'Convert a few pages instead of all of them',
        body: 'Leave the page box blank for the whole document, or type something like 1-3, 7 to render only what you need — much faster on a long file.',
      },
      {
        title: 'Every page previewed before you commit',
        body: 'The result is a thumbnail grid with the byte size under each page, and a Save control on each one for when you only wanted page three.',
      },
      {
        title: 'Large pages are handled, not dropped',
        body: 'A big page at 300 DPI can exceed what a phone browser will draw. The scale is reduced to fit rather than handing back a blank white image, which is what a naive converter does.',
      },
    ],
    faq: [
      {
        q: 'Will the text still be selectable in the images?',
        a: 'No. An image is pixels, so the text layer is gone — that is what converting to JPG means. If you need the words, use a PDF reader\u2019s own copy function on the original, or keep the PDF alongside the images.',
      },
      {
        q: 'What DPI should I choose?',
        a: 'Standard (150) for anything that will be looked at on a screen. Print/OCR (300) if the page will be printed or run through text recognition, at roughly four times the file size. Screen (96) is for thumbnails and previews.',
      },
      {
        q: 'Why is my JPG page mostly white with a thin line of content?',
        a: 'The page itself is that shape — a PDF page is often A4 even when only part of it is printed. The converter renders the page as it is defined rather than cropping to the ink, because cropping would change what the document says.',
      },
      {
        q: 'Can it convert a password-protected PDF?',
        a: 'Not while it is protected. Open it in your PDF reader with the password, save an unprotected copy, and convert that. The tool refuses rather than producing a file full of nonsense.',
      },
      {
        q: 'How many pages can it handle?',
        a: 'There is no page limit, but a very long document at 300 DPI is a lot of memory. If a large file struggles, convert it in ranges — 1-50, then 51-100 — using the pages box.',
      },
      {
        q: 'Is anything uploaded?',
        a: 'No. The PDF is parsed and drawn on your own device, and the page images are built in your browser\u2019s memory. Closing the tab is the deletion step.',
      },
    ],
    content: [
      {
        heading: 'When a PDF is better off as images',
        body: [
          'A PDF is a document format: it carries text, fonts, vector art and a layout that is meant to stay fixed. That is exactly what you want for a contract and exactly what gets in the way when you need to put a page into a slide deck, post it somewhere that only takes pictures, or drop it into an image editor.',
          'Converting to JPG trades everything a PDF is good at for one thing it cannot do: being an ordinary picture. The text stops being text, the file usually gets larger, and the page becomes something any application on any device can open without a reader.',
          'The reverse trip is a different tool. If what you actually want is a smaller PDF rather than pictures, compressing the PDF keeps the text layer intact and is almost always the better answer.',
        ],
      },
      {
        heading: 'Choosing between JPG and PNG for a page',
        body: [
          'The right format depends on what is printed on the page, not on the document. A scanned page is a photograph of paper: it is full of subtle noise and grain, JPEG compresses that efficiently, and PNG of the same page is routinely three to five times larger with no visible improvement.',
          'A page of typeset text, tables or line drawings is the opposite. JPEG works by discarding fine detail, and the fine detail on that kind of page is the edges of the letters — which is why text converted at a low quality picks up a faint grey halo. PNG stores the pixels exactly, so the edges stay clean.',
          'If a page has both, such as a report with photographs in it, JPEG at a high quality is usually the better compromise. Convert one page first and look at it at full size before doing the whole document.',
        ],
      },
      {
        heading: 'What DPI actually means here',
        body: [
          'A PDF page is measured in points, not pixels: an A4 page is 595 by 842 points regardless of how it is displayed. DPI is the number that decides how many pixels each of those points becomes, so 150 DPI turns an A4 page into roughly 1240 by 1754 pixels.',
          'That is why the file size grows so fast. Doubling the DPI quadruples the pixel count, and the bytes follow the pixel count closely — the same page at 300 DPI is around four times the size of the 150 DPI version.',
          'Text recognition software is the main reason to go above 150. Most OCR engines want at least 300 DPI to read small print reliably, and giving them less is the usual cause of a scan coming back with the wrong characters.',
        ],
      },
    ],
    related: ['image-to-pdf', 'split-pdf', 'merge-pdf', 'image-compressor'],
    popular: true,
    updated: '2026-09-10',
  },
  {
    slug: 'rotate-pdf',
    name: 'Rotate PDF',
    h1: 'Rotate a PDF',
    tagline: 'Turn sideways pages the right way up, and save it without touching anything else.',
    category: 'pdf',
    icon: 'rotate',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Rotate PDF Pages Online',
    metaDescription:
      'Rotate every page of a PDF or just the sideways ones, permanently and without losing quality. Runs in your browser — nothing is uploaded.',
    primaryKeyword: 'rotate pdf',
    secondaryKeywords: [
      'rotate pdf pages',
      'turn pdf sideways',
      'rotate pdf and save',
      'fix upside down pdf',
      'rotate single page pdf',
    ],
    synonyms: [
      'flip pdf page',
      'pdf landscape to portrait',
      'straighten a scanned pdf',
      'change pdf orientation',
      'rotate scanned document',
      'turn pdf page 90 degrees',
    ],
    accepts: PDF_ONE,
    howTo: {
      title: 'How to rotate a PDF',
      steps: [
        'Open your PDF, or drop it onto the page.',
        'Choose which way to turn it: right, left, or upside down.',
        'Leave the page box blank to rotate the whole document, or name the sideways pages.',
        'Rotate, then download the corrected file.',
      ],
    },
    features: [
      {
        title: 'Nothing is re-drawn',
        body: 'A PDF page carries a property saying which way up it should be displayed. This tool changes that property, so the rotation is instant, completely lossless, and the file barely changes size.',
      },
      {
        title: 'The text stays text',
        body: 'Because no page is converted to a picture, everything you could select, search and copy before is still there afterwards. Tools that rotate by rasterising destroy that silently.',
      },
      {
        title: 'Rotate some pages, not all',
        body: 'A scan where three pages went through the feeder sideways does not need the whole document turned. Name just those pages and the rest are left alone.',
      },
      {
        title: 'Existing rotation is respected',
        body: 'Scanners often mark pages as already rotated. A quarter turn is added to whatever each page declares, so a mixed document comes out consistent instead of half-corrected.',
      },
      {
        title: 'Your original is untouched',
        body: 'A new document is built and the file you dropped in is left exactly as it was, so you can change the setting and run it again as many times as you like.',
      },
      {
        title: 'Password-protected files are refused, not mangled',
        body: 'An encrypted PDF is reported as encrypted with the fix, rather than being force-opened into a document that appears valid and contains nothing usable.',
      },
    ],
    faq: [
      {
        q: 'Does rotating reduce the quality?',
        a: 'Not at all. Only a single number on each page changes — the one that tells a reader which way up to display it. No image is re-encoded and no text is touched, which is why the file size stays almost identical.',
      },
      {
        q: 'Why does my PDF look right here but sideways somewhere else?',
        a: 'Some viewers ignore the rotation property, particularly older ones and a few phone previews. The rotation this tool sets is the standard one that Acrobat, Chrome, Firefox, Preview and every current reader honour.',
      },
      {
        q: 'Can I rotate a single page?',
        a: 'Yes. Type its number in the pages box. You can mix single pages and ranges, like 2, 5-7, and everything else is left as it was.',
      },
      {
        q: 'Will this fix a page that is tilted by a few degrees?',
        a: 'No. This turns pages in quarter turns, which is the only rotation a PDF page can carry as a property. Correcting a slight skew from a scanner means re-drawing the page, which loses the text layer, so it is a different job.',
      },
      {
        q: 'Does it work on a scanned document?',
        a: 'Yes, and it is the common case. A scan is a picture inside a PDF page, and the page still carries the same rotation property, so it turns exactly as any other page does.',
      },
      {
        q: 'Is my document uploaded?',
        a: 'No. It is read and rewritten on your own device. There is no upload endpoint behind this page.',
      },
    ],
    content: [
      {
        heading: 'Why rotation is a property and not a picture',
        body: [
          'Every page in a PDF carries an entry that says how far it should be turned before it is shown. Readers apply it at display time, which means changing it is a one-number edit: nothing about the page content moves, and the file you get back is byte-for-byte almost the same document.',
          'The alternative approach — draw each page as an image, rotate the image, build a new PDF from the pictures — produces the same thing on screen and quietly destroys the document. Text stops being selectable, search stops working, the file usually grows several times over, and screen readers can no longer read it at all.',
          'This is worth knowing because plenty of online rotators do exactly that. If a rotated PDF comes back much larger than it went in, that is what happened to it.',
        ],
      },
      {
        heading: 'The mixed-orientation scan',
        body: [
          'The usual reason to reach for this tool is a stack of paper that went through a feeder in different orientations, so the resulting PDF has most pages upright and a few on their side.',
          'Turning the whole document is not the fix for that — it simply moves the problem to the other pages. Name the sideways pages in the page box and only those are corrected.',
          'If the sideways pages are not all turned the same way, run the tool twice: once for the pages that need a right turn and once for those that need a left. Each run works on the result of the last, so the corrections accumulate.',
        ],
      },
    ],
    related: ['remove-pdf-pages', 'merge-pdf', 'split-pdf', 'pdf-to-jpg'],
    updated: '2026-09-10',
  },
  {
    slug: 'remove-pdf-pages',
    name: 'Delete PDF Pages',
    h1: 'Delete pages from a PDF',
    tagline: 'Take out the blank scans, the cover sheet or the pages you were not meant to send.',
    category: 'pdf',
    icon: 'trash',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Delete Pages from a PDF',
    metaDescription:
      'Remove pages from a PDF and download the rest as a new file. Runs in your browser, so the document never leaves your device.',
    primaryKeyword: 'delete pages from pdf',
    secondaryKeywords: [
      'remove pdf pages',
      'delete a page from a pdf',
      'remove blank pages from pdf',
      'pdf page remover',
      'take pages out of a pdf',
    ],
    synonyms: [
      'erase pdf page',
      'cut pages from pdf',
      'drop pages from a pdf',
      'remove cover page pdf',
      'delete last page of pdf',
      'get rid of pdf pages',
    ],
    accepts: PDF_ONE,
    howTo: {
      title: 'How to delete pages from a PDF',
      steps: [
        'Open the PDF you want to edit.',
        'Type the pages to remove — single numbers, ranges, or both: 1, 4, 9-11.',
        'Check the line underneath, which says exactly which pages will be left.',
        'Delete, then download the new document.',
      ],
    },
    features: [
      {
        title: 'It shows you what survives',
        body: 'Under the box, a sentence spells out both halves: how many pages are going and exactly which ones remain. The arithmetic of "remove 4 and 9 from twelve pages" is shown rather than left to you.',
      },
      {
        title: 'Your original is never modified',
        body: 'A new document is built from the pages you keep. The file you dropped in is untouched, so a mistake costs you a re-run rather than the document.',
      },
      {
        title: 'Everything else is preserved',
        body: 'The pages that stay keep their fonts, images, links and text layer exactly as they were. Nothing is re-drawn or re-compressed.',
      },
      {
        title: 'Removing every page is refused',
        body: 'A PDF with no pages is not a valid document. If the selection would empty the file, the button says so instead of producing something no reader can open.',
      },
      {
        title: 'Ranges the way you would write them',
        body: 'Commas, spaces and dashes all work, and an en dash pasted from a word processor is understood. 9-3 is read as the range it obviously means.',
      },
      {
        title: 'Nothing is uploaded',
        body: 'The document is opened and rewritten on your own device, which matters when the page you are removing is the reason the file is sensitive.',
      },
    ],
    faq: [
      {
        q: 'Does deleting a page make the file smaller?',
        a: 'Usually, but not always in proportion. If the page you removed was mostly text it may barely change the size, because the fonts and other shared resources are still needed by the remaining pages.',
      },
      {
        q: 'Can I remove the last page without counting?',
        a: 'The page count is shown as soon as the file opens, so you can read it off and type that number. There is no "last" keyword — an explicit number is harder to get wrong.',
      },
      {
        q: 'Is the content of a removed page really gone?',
        a: 'The page is not included in the new document, so an ordinary reader cannot show it. For genuinely sensitive removal, treat this as a convenience rather than a redaction tool, and verify the result yourself.',
      },
      {
        q: 'What if I want to keep only a few pages instead?',
        a: 'Use the Split PDF tool. It takes the pages you want to keep rather than the ones you want gone, which is the easier way round when you are keeping a handful out of many.',
      },
      {
        q: 'Will bookmarks and form fields survive?',
        a: 'Page content, images and text survive. Document-level features such as bookmarks, the outline and form fields may not be carried across, so check the result if your document relies on them.',
      },
      {
        q: 'Can it open a password-protected PDF?',
        a: 'No. Remove the password in your PDF reader first and save an unprotected copy. The tool refuses rather than producing a broken file.',
      },
    ],
    content: [
      {
        heading: 'Removing pages versus keeping pages',
        body: [
          'These are the same operation described from opposite ends, and which one is easier depends entirely on the ratio. Taking two pages out of forty is naturally expressed as "remove 7 and 22". Keeping three pages out of forty is naturally expressed as "keep 4, 11, 30" — and expressing that as a removal means writing out every other page, which nobody should have to do.',
          'This tool takes the removal. The Split PDF tool takes the selection to keep. Between them, whichever way you are thinking about the job, one of the two matches it without arithmetic.',
          'The line under the box exists because the arithmetic is exactly where this goes wrong. Seeing "you will be left with 1-6, 8-12" before pressing the button is what catches an off-by-one before it costs you the document.',
        ],
      },
      {
        heading: 'A note on sensitive pages',
        body: [
          'Deleting a page removes it from the document that gets built, and a reader has no way to display something that is not there. For most purposes — trimming a cover sheet, dropping the blank scans, sending only the relevant part of a statement — that is exactly what is wanted.',
          'It is not the same thing as redaction, which is about removing information from a page that is still present. If the page contains something that must provably not be recoverable, verify the output with the tools your organisation requires rather than taking any browser utility\u2019s word for it.',
          'The advantage this tool does have is that the document is never transmitted. Whatever was on the page you removed was never sent anywhere, which is not true of a service that asks you to upload the file first.',
        ],
      },
    ],
    related: ['split-pdf', 'merge-pdf', 'rotate-pdf', 'pdf-to-jpg'],
    updated: '2026-09-10',
  },
  {
    slug: 'compress-pdf',
    name: 'Compress PDF',
    h1: 'Compress a PDF',
    tagline: 'Get a file under the limit, and be told honestly what it costs.',
    category: 'pdf',
    icon: 'compress',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Compress PDF — Reduce File Size',
    metaDescription:
      'Make a PDF smaller in your browser. Repack a text document without changing a pixel, or rebuild a scan at a lower resolution. Never returns a bigger file.',
    primaryKeyword: 'compress pdf',
    secondaryKeywords: [
      'reduce pdf file size',
      'make a pdf smaller',
      'compress pdf to 1mb',
      'shrink scanned pdf',
      'pdf too large to email',
    ],
    synonyms: [
      'pdf compressor',
      'reduce size of pdf',
      'lower pdf file size',
      'compress pdf online',
      'squeeze pdf',
      'pdf file too big',
      'optimise pdf',
      'compress pdf for upload',
    ],
    accepts: PDF_ONE,
    howTo: {
      title: 'How to compress a PDF',
      steps: [
        'Open the PDF you want to make smaller.',
        'Say what is in it: mostly text, or scanned pages and photographs.',
        'For a scan, choose how much detail to keep — the DPI and the image quality.',
        'Compress, then download the smaller file. If nothing beat the original, you get the original back.',
      ],
    },
    features: [
      {
        title: 'Two honest modes instead of one dishonest slider',
        body: 'A text document and a scan need opposite treatments, and a single quality slider cannot serve both. The tool asks which one you have, in words you can answer, and applies the method that actually works on it.',
      },
      {
        title: 'It never hands back a bigger file',
        body: 'If the compressed result comes out larger than what you started with — which happens on documents that are already optimised — your original is returned untouched and the result says so plainly.',
      },
      {
        title: 'Text mode changes nothing on any page',
        body: 'The file is repacked, not redrawn: small objects are gathered into compressed streams and the producer line is dropped. Text stays selectable, vectors stay sharp, and no pixel moves.',
      },
      {
        title: 'Scan mode is where the big savings live',
        body: 'A photographed page holds far more resolution than reading needs. Redrawing each page at 150 DPI routinely takes a 20 MB scan under 2 MB, and the tool says up front that the text layer goes with it.',
      },
      {
        title: 'Pages keep their real size',
        body: 'A rebuilt A4 page comes out A4. The render resolution is converted back to points when the new page is written, so a compressed document still prints on the paper it was designed for.',
      },
      {
        title: 'Nothing is uploaded',
        body: 'Both modes run in the browser tab. The documents people most often need to shrink — statements, contracts, passport scans for a form — never leave the device.',
      },
    ],
    faq: [
      {
        q: 'Why did my PDF barely get smaller?',
        a: 'Because it is mostly text, and text is already tiny. A page of typeset words is a few kilobytes of glyph positions; there is nothing left to squeeze. Large PDFs are almost always large because of images, and if yours is a scan, the "scanned pages or photos" mode is where the real reduction is.',
      },
      {
        q: 'Can I compress a PDF to exactly 1 MB?',
        a: 'Not by naming the number. What comes out depends on what is on the pages, so the honest approach is to pick a detail level, look at the result, and step down if it is still too big. Starting at 150 DPI and dropping to 96 covers nearly every upload limit.',
      },
      {
        q: 'Does compressing lose quality?',
        a: 'In text mode, no — nothing on any page is altered. In scan mode, yes, and deliberately: pages are redrawn as JPEG images at a lower resolution, which is exactly where the saving comes from. Keep your original either way.',
      },
      {
        q: 'Will the text still be selectable afterwards?',
        a: 'In text mode it will be. In scan mode it will not, because every page becomes a picture. A warning to that effect sits above the button rather than hidden in small print, since it is the one consequence people are surprised by.',
      },
      {
        q: 'Why was my original returned unchanged?',
        a: 'Because nothing beat it. A file that has already been through an optimiser can come out larger after a second pass, and handing you that would be damage dressed up as a feature. The tool keeps whichever file is smaller, and tells you which one you got.',
      },
      {
        q: 'Can it compress a password-protected PDF?',
        a: 'No. An encrypted document cannot be read until it is decrypted. Open it in your PDF reader with the password, save an unprotected copy, and compress that.',
      },
    ],
    content: [
      {
        heading: 'Two completely different jobs share one word',
        body: [
          'When someone says a PDF is too large, the fix depends entirely on what is inside it — and the two cases have almost nothing in common.',
          'A document that came out of a word processor stores text as glyph positions and font subsets, plus whatever vector drawing is on the page. All of that is compact already, and the only safe reduction is repacking the file’s internal structure: gathering many small objects into compressed streams and dropping metadata nobody reads. That is worth a few per cent, occasionally twenty on a badly written file, and it never changes what is on a page.',
          'A scan is the opposite. It is a photograph of paper wrapped in a PDF, and it is enormous because it holds full-resolution images of something that is mostly white. Re-encoding those at the resolution a person actually reads at is where twenty megabytes becomes two — but it means redrawing each page as a picture, which is not a free operation.',
          'A tool that offers one slider for both cases is guessing, and half the time it guesses wrong. This one asks.',
        ],
      },
      {
        heading: 'What a rebuild costs, stated plainly',
        body: [
          'Rebuilding turns every page into an image. If the document had a text layer — because it was born digital, or because someone ran OCR over the scan — that layer is gone afterwards. The text stops being selectable, stops being searchable, and stops being readable by screen readers, which is the part that rarely gets mentioned.',
          'For a scan of a signed form that only ever needs to be looked at and emailed, none of that matters and the size reduction is dramatic. For a report someone will search through, it matters a great deal.',
          'This is why the warning sits above the button. It is also why the mode is never selected for you: the tool cannot see what your document is for, and the wrong choice is not something you can undo from the file you get back.',
        ],
      },
      {
        heading: 'Getting under an upload limit',
        body: [
          'The usual reason for compressing anything is a form that refuses files over some number — 2 MB for a visa application, 5 MB for an email attachment, 10 MB for a portal that will not say why it failed.',
          'Work downwards rather than upwards. Try the balanced setting first, look at the size, and step down only if you need to. Each halving of DPI cuts the file to roughly a quarter, so there is usually far more headroom than people expect, and going straight to the smallest setting gives away detail you did not need to spend.',
          'If a text document is still too large after repacking, the size is coming from images embedded in it, and splitting out the pages you actually need to send is often a better answer than degrading all of them.',
        ],
      },
    ],
    related: ['split-pdf', 'merge-pdf', 'pdf-to-jpg', 'image-compressor'],
    popular: true,
    isNew: true,
    updated: '2026-09-10',
  },
  {
    slug: 'extract-pdf-text',
    name: 'PDF to Text',
    h1: 'Extract text from a PDF',
    tagline: 'Get the words out of a document, ready to paste anywhere.',
    category: 'pdf',
    icon: 'file-text',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'PDF to Text — Extract Text',
    metaDescription:
      'Pull the text out of a PDF and copy it or save it as a .txt file. Runs in your browser, so the document is never uploaded. Says plainly when a file is a scan.',
    primaryKeyword: 'extract text from pdf',
    secondaryKeywords: [
      'pdf to text',
      'copy text from pdf',
      'pdf to txt',
      'get text out of a pdf',
      'pdf text extractor',
    ],
    synonyms: [
      'convert pdf to text',
      'pdf to plain text',
      'read text from pdf',
      'pull words from pdf',
      'pdf text export',
      'save pdf as txt',
      'pdf copy paste text',
    ],
    accepts: PDF_ONE,
    howTo: {
      title: 'How to extract text from a PDF',
      steps: [
        'Open your PDF, or drop it onto the page.',
        'Leave the page box blank for the whole document, or name the pages you need.',
        'Extract, then edit the text in the box if you want to tidy it first.',
        'Copy it, or download it as a .txt file.',
      ],
    },
    features: [
      {
        title: 'It tells you when there is no text',
        body: 'A scanned document contains pictures of words, not words, so nothing can be extracted from it. Instead of an empty box that looks broken, you get a sentence explaining that the file is a scan and needs OCR.',
      },
      {
        title: 'The result is editable before you take it',
        body: 'Extraction always leaves something to tidy — a running header, a hyphen across a line break. The box is a real text field, and both Copy and Download take what you have edited rather than the raw output.',
      },
      {
        title: 'Page markers when you want them',
        body: 'Off by default, because most people are pasting a paragraph. Switch them on for a long report and each page starts with a line naming its number, so a quote can still be cited.',
      },
      {
        title: 'A few pages instead of all of them',
        body: 'Type 1-3, 7 and only those pages are read. On a three-hundred-page document that is the difference between instant and a wait.',
      },
      {
        title: 'Reading order, not coordinate order',
        body: 'Text is stored in a PDF as positioned glyph runs. Those runs are reassembled into lines using the layout breaks the document itself declares, so an ordinary single-column page comes out as readable prose.',
      },
      {
        title: 'The document stays on your device',
        body: 'Parsing happens in the tab, by the same engine your browser uses to display a PDF. Nothing about the file is transmitted, which matters when the text you are extracting is the confidential part.',
      },
    ],
    faq: [
      {
        q: 'Why did I get nothing back?',
        a: 'Because the document is a scan. A page that is a photograph of paper holds no text at all — every letter is part of the image — so an extractor has nothing to read, however crisp it looks. Recovering those words needs OCR, which is character recognition on an image, and it is a different kind of tool.',
      },
      {
        q: 'How do I know whether my PDF is a scan?',
        a: 'Open it in any reader and try to select a sentence with the mouse. If the text highlights, it is real text and this tool will get it. If you can only draw a box over the page, it is an image.',
      },
      {
        q: 'Why is the spacing strange in places?',
        a: 'A PDF stores where each glyph sits, not where sentences begin and end, so line breaks and column boundaries have to be inferred. A plain single-column page comes out clean; multi-column layouts, tables and text wrapped around figures are where the guessing shows. The box is editable for exactly that reason.',
      },
      {
        q: 'Can it extract text from a password-protected PDF?',
        a: 'No. The document has to be decrypted before anything can be read from it. Open it in a reader with the password, save an unprotected copy, and use that.',
      },
      {
        q: 'Does it keep bold, headings and tables?',
        a: 'No — the output is plain text, which is what makes it paste cleanly into anything. Formatting, images and table borders are dropped. If you need the layout too, converting the pages to images preserves the look instead of the words.',
      },
      {
        q: 'Is there a page limit?',
        a: 'No fixed one. Very long documents take longer and use more memory, and the page box is there so you can read the section you need rather than all three hundred pages.',
      },
    ],
    content: [
      {
        heading: 'Why a PDF makes this harder than it should be',
        body: [
          'A PDF is a description of a printed page, not a document in the sense a word processor means. It says which glyph goes at which coordinate in which font, and that is all. There is no paragraph, no sentence, and often no space character — the gap between two words can simply be two glyphs drawn a little further apart.',
          'Extracting text therefore means reassembling prose from positions, and every extractor makes judgement calls doing it. The one here follows the layout breaks the document declares, which is right for the overwhelmingly common case of a single-column page and does not pretend to untangle complex layouts.',
          'Two columns are the classic failure everywhere: an extractor that reads strictly by vertical position interleaves them a line at a time and produces nonsense. If your document is laid out like an academic paper, expect to do some tidying — which is why the result is handed to you in an editable box rather than as a finished file.',
        ],
      },
      {
        heading: 'The scan problem, and what actually solves it',
        body: [
          'A large share of the PDFs in the world came from a scanner or a phone camera, and they are images wrapped in a document container. To a person they look identical to a text document. To software they are a photograph.',
          'No amount of extraction gets words out of one, because there are no words in the file — only pixels arranged to look like them. What is needed is OCR: software that recognises characters in an image and writes them out as text. It is a heavyweight job and an imperfect one, and a browser tool that claimed to do it without saying so would be misleading you.',
          'If a scan is what you have, the honest paths are to run it through OCR software, or to keep it as images. Some PDFs are also hybrids — a scan with an OCR text layer already added by whoever produced it — and those extract perfectly well here.',
        ],
      },
    ],
    related: ['pdf-to-jpg', 'split-pdf', 'compress-pdf', 'word-counter'],
    isNew: true,
    updated: '2026-09-10',
  },
  {
    slug: 'pdf-to-pptx',
    name: 'PDF to PowerPoint',
    h1: 'Convert PDF to PowerPoint',
    tagline: 'Every page becomes a slide, looking exactly like the page — ready to present, reorder or draw on.',
    category: 'pdf',
    icon: 'presentation',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'PDF to PowerPoint (PPTX)',
    metaDescription:
      'Turn a PDF into a PowerPoint deck, one slide per page, with the layout exactly preserved. Choose the sharpness and the pages. Nothing is uploaded.',
    primaryKeyword: 'pdf to ppt',
    secondaryKeywords: [
      'pdf to pptx',
      'pdf to powerpoint',
      'pdf to slides',
      'convert pdf to presentation',
      'pdf pages as slides',
    ],
    synonyms: [
      'pdf into powerpoint',
      'make slides from a pdf',
      'pdf to keynote',
      'present a pdf',
      'pdf slideshow',
      'turn a pdf into a deck',
      'pdf to google slides',
    ],
    accepts: PDF_ONE,
    howTo: {
      title: 'How to convert a PDF to PowerPoint',
      steps: [
        'Drop in your PDF.',
        'Choose whether the slides match the shape of the pages or take a standard 16:9 or 4:3 size.',
        'Pick the sharpness — balanced is right for a projector — and narrow to a page range if you only need part of the document.',
        'Build the presentation and download the .pptx.',
      ],
    },
    features: [
      {
        title: 'The layout is exactly right',
        body: 'Each page is rendered and placed on its own slide as an image, so nothing reflows, no font substitutes itself, and no table falls apart. The slide looks precisely like the page, which is the one thing most converters cannot promise.',
      },
      {
        title: 'The text is not editable, and the page says so before you start',
        body: 'That warning sits above the build button rather than in the small print afterwards. Converting a PDF back into real text boxes means guessing at the original layout, and the guess goes wrong in ways you discover halfway through presenting.',
      },
      {
        title: 'Sharpness you choose',
        body: 'A rendered page is blown up to full screen on a projector, far past its size on a laptop, so the resolution matters more here than for an image. Balanced at 150 DPI is comfortable in a meeting room; the sharpest setting is there for detailed diagrams and small print.',
      },
      {
        title: 'Slides shaped to the pages',
        body: 'A4 and Letter are portrait, and forcing them onto a 16:9 slide leaves two thick bars. Matching the pages avoids that entirely; the standard sizes are still there for a deck that has to be widescreen.',
      },
      {
        title: 'Only the pages you want',
        body: 'Give a range — 1-5, 9 — and only those pages are rendered and only those become slides. A three-hundred-page report you need six pages out of does not have to be converted whole.',
      },
      {
        title: 'The document never leaves your device',
        body: 'The pages are drawn in your browser and the .pptx is assembled there too. A contract, a payslip or an internal report is not uploaded to anyone, which is the part most online converters cannot say.',
      },
    ],
    faq: [
      {
        q: 'Will I be able to edit the text in the slides?',
        a: 'No. Each slide holds a picture of the page, so the text is part of that picture. This is stated plainly because it is the honest trade: what you get in exchange is a deck that looks exactly like the document, with nothing shifted, resized or re-flowed.',
      },
      {
        q: 'Why not convert it into real text boxes and shapes?',
        a: 'Because a PDF does not contain paragraphs, headings or tables — it contains glyphs at coordinates. Reconstructing editable slides means inferring which glyph runs are a heading and which rectangles are a table, and that inference is wrong often enough that the result needs more fixing than rebuilding the slides by hand. A tool that claimed otherwise in a browser tab would be overselling.',
      },
      {
        q: 'Can I still add my own notes and titles?',
        a: 'Yes. The slides are ordinary slides, so you can put text boxes, arrows, highlights and speaker notes on top of them, reorder them, delete the ones you do not need, and animate them.',
      },
      {
        q: 'Why is my presentation so much bigger than the PDF?',
        a: 'Because a page of text stored as instructions is tiny, and the same page stored as a picture is not. Dropping to the smaller setting roughly halves it; if the deck only ever gets shown on a laptop, that setting is perfectly sharp.',
      },
      {
        q: 'Does it work on a scanned PDF?',
        a: 'Yes, and it is one of the better cases. A scan is already a picture of a page, so turning it into a slide loses nothing that was not already lost at the scanner.',
      },
      {
        q: 'What about a password-protected PDF?',
        a: 'It has to be decrypted first. Open it in a reader with the password, save an unprotected copy, and convert that.',
      },
    ],
    content: [
      {
        heading: 'What people actually need when they convert a PDF to slides',
        body: [
          'The common case is not redesigning the document. Someone has been handed a PDF — a report, a paper, a deck exported by somebody else — and has to stand up and talk through it. What they need is to advance through the pages one at a time, skip a few, reorder a couple, and maybe draw on one while talking.',
          'For that, a slide that is a faithful picture of the page is not a compromise; it is better than an approximate rebuild, because nothing has quietly moved since the version everyone else has read. You can still add a title slide, your own notes, and a summary at the end.',
          'The case this does not serve is wanting to restyle the content — change the fonts, swap the colours, re-cut the charts. There, the honest route is to go back to whatever produced the PDF, because that file still has the real text and the real data in it.',
        ],
      },
      {
        heading: 'Choosing the sharpness for the room',
        body: [
          'Resolution here is not about looking good on your screen — it is about how far the page gets enlarged when it is thrown onto a wall. A page shown at 150 DPI has roughly twice the detail of the same page at 110, and on a projector two metres wide that difference is the boundary between crisp text and slightly soft text.',
          'The trade is file size, and it is close to linear in the number of pixels: the sharpest setting produces a file around four times the size of the smallest. A twenty-page document is comfortable at any setting; a two-hundred-page one is worth thinking about.',
          'The practical rule is to pick balanced unless you know the document has small print or fine diagram lines, in which case go up one, and unless the deck will only ever be shown on a laptop or shared over a video call, in which case go down one and save the megabytes.',
        ],
      },
    ],
    related: ['pdf-to-jpg', 'images-to-pptx', 'split-pdf', 'compress-pdf'],
    isNew: true,
    updated: '2026-09-12',
  },
];
