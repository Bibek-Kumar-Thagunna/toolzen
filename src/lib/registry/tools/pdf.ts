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
        'Add the PDFs you want to combine — up to twenty, each up to 50 MB.',
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
        body: 'The result is the result: nothing is stamped on it, no pages are held back, and there is no queue. Twenty files of up to 50 MB each per merge, with your device’s memory as the practical ceiling beyond that.',
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
        a: 'Fifty megabytes per PDF, twenty files at a time. The constraint you meet first on very large documents is memory rather than that number: everything is held in one browser tab, and a phone gives a tab far less room than a laptop does.',
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
        'Open one PDF of up to 50 MB.',
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
        body: 'Splitting acts on a single file, so the picker takes one PDF of up to 50 MB. On long scanned documents, device memory becomes the real limit before that number does.',
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
        a: 'Fifty megabytes. On a long scanned document the limit you meet first is memory: thumbnails for several hundred pages take real space in a tab, and a phone will give up before a laptop will.',
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
];
