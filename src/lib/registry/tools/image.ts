import type { Tool } from '../types';
import { JPG_ONLY, PNG_ONLY, RASTER_IMAGES } from '../../tools/accepts.ts';

/**
 * Registry entries for the image category.
 *
 * Every claim in this file is meant to be checkable against the engine that
 * backs it: src/lib/tools/image/format.ts (sniffing, encodable formats,
 * savings summaries), dimensions.ts (canvas ceilings, presets, stepped
 * downscale, size estimates) and crop.ts (the selection rectangle and the
 * ratio list). If an engine changes what it does, the copy here is wrong and
 * has to change with it.
 */
export const imageTools: Tool[] = [
  {
    slug: 'image-compressor',
    name: 'Image Compressor',
    h1: 'Compress images online',
    tagline: 'Get a photo small enough to upload or email without it looking obviously degraded.',
    category: 'image',
    icon: 'compress',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Compress Images — JPG, PNG and WebP',
    metaDescription:
      'Compress JPG, PNG and WebP images with a quality slider and a before-and-after size readout. Everything happens in your browser, nothing is uploaded.',
    primaryKeyword: 'compress image',
    secondaryKeywords: [
      'compress jpg',
      'compress png',
      'compress webp',
      'reduce image file size',
      'quality slider',
      'compress multiple images',
    ],
    synonyms: [
      'shrink image',
      'make image smaller',
      'reduce photo size',
      'image optimiser',
      'optimize images',
      'photo compressor',
      'make jpg smaller',
      'compress picture',
    ],
    accepts: RASTER_IMAGES,
    howTo: {
      title: 'How to compress an image',
      steps: [
        'Drop your images onto the page, or pick them with the file chooser.',
        'Choose an output format — JPG, PNG or WebP — or keep the one you started with.',
        'Move the quality slider; the estimated output size updates beside it.',
        'Compare the preview against the original, then download the result.',
      ],
    },
    features: [
      {
        title: 'Your own browser does the encoding',
        body: 'The image is decoded and re-encoded by the same code that draws pictures in your other tabs. Nothing is uploaded, so there is no queue and no waiting on someone else’s server.',
      },
      {
        title: 'A quality value you choose',
        body: 'JPEG and WebP take a quality from 1 to 100 rather than a vague “medium” preset. An estimated file size sits next to the slider before you commit, and the real byte count replaces it once the image is encoded.',
      },
      {
        title: 'Three formats out, many formats in',
        body: 'A browser can write JPEG, PNG and WebP, and this tool writes exactly those. It will read GIF and BMP as well, so an old screenshot can go straight to a modern format.',
      },
      {
        title: 'An honest before-and-after',
        body: 'Each result shows the original size, the new size and the percentage saved. When a file comes out larger — which happens with images that were already well compressed — it says so instead of hiding it.',
      },
      {
        title: 'Up to 20 images in one pass',
        body: 'Compress multiple images with the same settings and download them as you go. Each file can be up to 30 MB.',
      },
      {
        title: 'The header decides the format',
        body: 'A PNG that somebody renamed to .jpg is read as a PNG, because the first bytes of the file are checked rather than the extension. You are told what it really is, and the conversion carries on.',
      },
    ],
    faq: [
      {
        q: 'Does compressing an image strip its EXIF data?',
        a: 'It does. Re-encoding through a canvas rebuilds the file from pixels alone, so EXIF, GPS coordinates, the camera model and the orientation flag are all absent from the output. That is a privacy win before posting a photo publicly, and a loss if you were relying on that metadata — keep the original if you need it.',
      },
      {
        q: 'Why did my PNG barely get smaller?',
        a: 'PNG compression is lossless, so re-encoding one only looks for a tidier way to describe identical pixels, and a file written by a competent encoder has very little left to give. Reducing the dimensions or converting to WebP will save far more.',
      },
      {
        q: 'What happens to an animated GIF?',
        a: 'Only the first frame survives. A canvas holds one still image, so the animation is discarded and you get a single-frame JPG, PNG or WebP.',
      },
      {
        q: 'Are there any limits?',
        a: 'Thirty megabytes per file and twenty files at a time. Very large images are also capped at roughly 67 megapixels before drawing, because beyond that some phone browsers hand back a blank canvas rather than a picture.',
      },
      {
        q: 'Will one quality setting suit every image?',
        a: 'Not reliably. A photograph of gravel and a photograph of a clear sky end up wildly different sizes at the same quality, because JPEG spends its bytes on detail. Check the preview on anything that matters.',
      },
      {
        q: 'Is any part of the image uploaded?',
        a: 'No. There is no upload endpoint behind this page. The file is read into memory, drawn to a canvas and encoded on your own device, and closing the tab is the deletion step.',
      },
    ],
    content: [
      {
        heading: 'How much can you actually save?',
        body: [
          'Most pictures coming off a phone or a camera are saved at a quality setting well above anything a screen can show. Taking a JPEG from quality 95 down into the seventies often halves the file with no difference you can see at normal viewing size, which is why adjusting quality is usually the right first move.',
          'The free gains stop somewhere below 60. Skies and skin tones start to band, hard edges pick up a faint halo, and fine texture turns to mush. The practical way to use a quality slider is to pull it down until you can see the damage in the preview, then go back one step.',
          'When a hard number is what matters — an upload form that refuses anything over 2 MB, say — remember that dimensions move the total far more than quality does. Halving the width and height quarters the pixel count, and file size follows the pixel count closely. To reduce image file size in earnest, resize first and then compress at a sensible quality.',
        ],
      },
      {
        heading: 'What compression cannot do',
        body: [
          'Lossy compression is one-way. Every re-encode of a JPEG discards a little more, and the losses stack up: save the same picture through a compressor five times and you will see it. Keep the original and compress from that, rather than compressing the compressed copy.',
          'PNG is a different animal. It is lossless, so to compress PNG files at all means finding a more efficient description of exactly the same pixels. Screenshots and flat graphics still have room to move; a photograph saved as PNG is better off as JPEG or WebP than re-encoded as PNG.',
          'Nothing here sharpens, denoises or upscales. A blurry photograph compresses down to a smaller blurry photograph, and no setting on this page will invent the detail that was never captured.',
        ],
      },
      {
        heading: 'Choosing between JPG, PNG and WebP',
        body: [
          'Photographs belong in JPEG unless everywhere you are publishing accepts WebP, in which case compress WebP output instead and expect roughly a third off for the same visual quality. Line art, screenshots, logos and anything with text or flat colour belong in PNG or WebP, where hard edges stay crisp.',
          'Transparency settles the argument on its own: JPEG has none, so a transparent image compressed to JPG gets flattened onto a solid background. If the see-through parts matter, PNG and WebP are the only two options on this page that keep them.',
        ],
      },
    ],
    related: ['image-resizer', 'png-to-webp', 'image-to-pdf', 'png-to-jpg'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'image-resizer',
    name: 'Image Resizer',
    h1: 'Resize images online',
    tagline: 'Hit an exact pixel size — or a whole set of them — without softening the picture.',
    category: 'image',
    icon: 'maximize',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Resize Images to Any Size',
    metaDescription:
      'Resize images by pixels, percentage or megapixels, with presets for social, screens, favicons and print. Stepped downscaling keeps edges sharp.',
    primaryKeyword: 'resize image',
    secondaryKeywords: [
      'image resizer',
      'resize by percentage',
      'image dimensions',
      'longest edge',
      'favicon sizes',
      'without losing quality',
    ],
    synonyms: [
      'scale image',
      'change photo size',
      'resize picture online',
      'image dimensions changer',
      'shrink image dimensions',
      'resize jpg',
      'resize png',
      'photo resizer',
    ],
    accepts: RASTER_IMAGES,
    howTo: {
      title: 'How to resize an image',
      steps: [
        'Add your images — one, or up to twenty at once.',
        'Choose how to set the size: exact width, exact height, longest edge, percentage, megapixels, or a preset.',
        'Leave the aspect ratio locked unless you specifically want to stretch the picture.',
        'Check the new dimensions shown for each file, then download.',
      ],
    },
    features: [
      {
        title: 'Six ways to say how big',
        body: 'Set a width, a height, the longest edge, a percentage, a megapixel budget, or fit inside a box. The mode you need depends on whether the constraint is a layout, an upload limit or a print size, so all six are here rather than only the first.',
      },
      {
        title: 'Stepped downscaling',
        body: 'Shrinking a 4000 px photo to 400 px in one draw aliases badly: the browser samples too few source pixels and detail turns into fizz. This resizer halves the image repeatedly instead, never more than 2× per step, which is what makes a big reduction still look like the original.',
      },
      {
        title: 'Presets that match real targets',
        body: 'Social sizes such as an Instagram square, a story, a YouTube thumbnail and an Open Graph image; screen sizes from 720p to 4K; favicon sizes at 16, 32, 48, 180, 192 and 512 px; and paper sizes calculated at 300 dpi for print.',
      },
      {
        title: 'The ratio stays locked by default',
        body: 'Type a width and the height follows. Unlock it and you can distort the image deliberately, which is occasionally what you want and never what you want by accident.',
      },
      {
        title: 'No invented detail',
        body: 'Enlarging is allowed, but the tool says plainly that enlarging cannot add detail that was never captured — it interpolates, and the result is soft. There is no upscaling model here making things up.',
      },
    ],
    faq: [
      {
        q: 'Can I resize an image without losing quality?',
        a: 'Making an image smaller always discards pixels — that is what smaller means. What you can avoid is the extra blur and aliasing of a careless single-step reduction, which is why this image resizer halves the picture in stages. Going the other way, enlargement genuinely cannot recover detail.',
      },
      {
        q: 'How large an image can it handle?',
        a: 'Files up to 30 MB, twenty at a time, and around 67 megapixels of pixel data per image. The megapixel ceiling and the 16,384 px limit per side come from the browser itself: past those, some devices silently produce a blank canvas.',
      },
      {
        q: 'Does resizing remove EXIF and GPS data?',
        a: 'It does, because the output is re-encoded from pixels rather than edited in place. Camera settings, timestamps, location and the orientation flag do not survive. Useful before publishing, awkward if you were counting on them.',
      },
      {
        q: 'What does the megapixel option do?',
        a: 'It scales the image so the total pixel count matches your budget while keeping the shape. It is the right control when a service limits you by megapixels, or when you want a consistent weight across photos of different shapes.',
      },
      {
        q: 'Will an animated GIF still animate?',
        a: 'No. Only the first frame is drawn, so the output is a still image in JPG, PNG or WebP.',
      },
    ],
    content: [
      {
        heading: 'Pick the mode that matches the constraint',
        body: [
          'Most resizing goes wrong because the wrong control was used. A layout that needs a 1200 px-wide hero wants exact width. A gallery of mixed portrait and landscape shots wants longest edge, so nothing overflows in either direction. An upload form with a pixel or megapixel cap wants the megapixel mode, because that is the number being measured.',
          'Resize by percentage when the brief is “a bit smaller than this”, and it is the safest mode to use in bulk: every file keeps its own shape and its own relative size, so a batch of screenshots stays consistent with each other.',
          'The favicon preset exists because browsers, iOS and Android all ask for different sizes of the same square. Generating them from one source in a single pass is less error-prone than doing it six times by hand.',
        ],
      },
      {
        heading: 'Why stepped downscaling matters',
        body: [
          'A browser scaling an image in one operation samples a limited number of source pixels for each destination pixel. Reduce by 10× that way and most of the original is never even read, so thin lines break up and dense texture becomes noise. Reducing by no more than half at a time means every source pixel contributes to the result.',
          'The effect is easiest to see on text in a screenshot or on the fine rigging of a boat. If you have ever wondered why the same photo looks crisper coming out of an image editor than out of a quick browser scale, this is usually the reason.',
        ],
      },
      {
        heading: 'Resize before you compress',
        body: [
          'File size tracks pixel count closely, so image dimensions are the blunt instrument and quality is the fine adjustment. A 4000 × 3000 photo at quality 40 will usually look worse and weigh more than the same photo resized to 2000 × 1500 at quality 80.',
          'For print, the arithmetic is fixed: 300 dpi means 300 pixels for every inch of paper, so a full-width A4 image needs roughly 2480 × 3508 pixels. The print presets do that sum for you; anything below it will look soft no matter which settings you choose afterwards.',
        ],
      },
    ],
    related: ['image-compressor', 'image-cropper', 'png-to-webp', 'image-to-pdf'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'image-cropper',
    name: 'Image Cropper',
    h1: 'Crop images online',
    tagline: 'Trim a picture to the part that matters, at a ratio the destination will accept.',
    category: 'image',
    icon: 'crop',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Crop Images Online',
    metaDescription:
      'Crop a photo by dragging a selection box, with locked ratios for 1:1, 4:3, 16:9 and more. Live pixel readout, and the file never leaves your device.',
    primaryKeyword: 'crop image',
    secondaryKeywords: [
      'crop a photo',
      'square crop',
      'aspect ratios',
      'crop to 16:9',
      'rotate and crop',
    ],
    synonyms: [
      'cut out part of a photo',
      'trim image edges',
      'crop image to square',
      'photo cropper',
      'crop png',
      'crop screenshot',
      'image trimmer',
    ],
    accepts: RASTER_IMAGES,
    howTo: {
      title: 'How to crop an image',
      steps: [
        'Open your image, or drop it onto the page.',
        'Pick a ratio — freeform, or one of the fixed ones such as 1:1 or 16:9.',
        'Drag inside the selection to move it and pull the handles to resize it; the pixel size is shown as you go.',
        'Rotate or flip if the shot needs it, then download the crop.',
      ],
    },
    features: [
      {
        title: 'A selection box that behaves',
        body: 'Eight handles plus drag-to-move. The rectangle cannot be inverted, cannot leave the picture, and cannot shrink below 16 px in either direction, so there is no way to end up with an impossible crop.',
      },
      {
        title: 'Ten aspect ratios, including the vertical ones',
        body: 'Freeform, 1:1, 4:3, 3:2, 16:9, 5:4 and the portrait counterparts 3:4, 2:3 and 9:16, plus 21:9 for ultrawide. With a ratio locked, dragging a corner keeps it exact to within half a pixel.',
      },
      {
        title: 'Live pixel and percentage readout',
        body: 'The selection reports its size in pixels, the ratio it currently matches and how much of the original it covers — “1080 × 1080 px (1:1), 28% of the original”. No guessing whether the crop is still big enough for its destination.',
      },
      {
        title: 'Quarter turns and flips',
        body: 'Rotation in 90° steps swaps width and height exactly, with no resampling and no softening, so you can rotate and crop in one pass. Flipping mirrors the selection along with the image, so the framing you set stays over the same part of the picture.',
      },
      {
        title: 'Cropped in full resolution',
        body: 'You drag the selection over a preview that fits your screen, but the crop is applied to the full-size image. Positions are held as percentages, so a box drawn on a thumbnail lands in exactly the right place on the original.',
      },
    ],
    faq: [
      {
        q: 'Is the cropped-off part really gone?',
        a: 'In the downloaded file, yes — the output contains only the pixels inside the selection, so it cannot be recovered from the crop. Your original file on disk is untouched, which is worth remembering if the point of the crop was to hide something.',
      },
      {
        q: 'Can I crop to a size rather than a ratio?',
        a: 'Crop to the ratio you need here, then set the exact pixel dimensions with the image resizer. Splitting it that way avoids the trap of a crop box that has to be both a fixed shape and a fixed size and therefore cannot move.',
      },
      {
        q: 'Does cropping re-compress the image?',
        a: 'The crop is drawn to a canvas and encoded again, so a JPEG in means a freshly encoded JPEG out and a small amount of generation loss. Metadata does not survive that step either: EXIF, GPS and the orientation flag are dropped.',
      },
      {
        q: 'Why is my photo sideways?',
        a: 'Some cameras store the picture in one orientation and a rotation flag telling viewers to turn it. Because the output is rebuilt from what was drawn, that flag is not carried over — use the rotate control so the pixels themselves are the right way up.',
      },
      {
        q: 'Can I crop several images to the same ratio?',
        a: 'Load up to twenty and crop them one after another. Each needs its own selection, because the interesting part of a photograph is not in the same place twice.',
      },
    ],
    content: [
      {
        heading: 'Ratios worth knowing',
        body: [
          'A crop that fits its destination survives contact with the platform. A square crop at 1:1 suits a profile picture or a marketplace listing; 4:5 territory suits a portrait post; 9:16 fills a phone screen for a story; crop to 16:9 for video thumbnails and slides; and 1.91:1 matches the link preview cards most social networks generate. Crop to the shape the destination wants and it will not crop for you.',
          'Print is the other common case, and it is unforgiving in a different way. A 6 × 4 print is 3:2, so a 4:3 photo has to lose something along one edge. Choosing which edge yourself, before the lab does it, is the entire argument for cropping first.',
        ],
      },
      {
        heading: 'Cropping, resizing and file size',
        body: [
          'Cropping removes pixels, so it reduces file size as a side effect — but only in proportion to the area you cut. Trimming 10% off the edges of a photo takes roughly 10% off the pixel count, which is a much smaller change than most people expect.',
          'If the goal is a specific file size, crop for composition and then resize or compress for weight. Trying to reach a byte target by cropping alone means throwing away parts of the picture you wanted to keep.',
        ],
      },
    ],
    related: ['image-resizer', 'image-compressor', 'jpg-to-png', 'image-to-pdf'],
    updated: '2026-09-03',
  },
  {
    slug: 'jpg-to-png',
    name: 'JPG to PNG',
    h1: 'Convert JPG to PNG',
    tagline: 'Get a lossless copy of a photo for editing, layering or a tool that insists on PNG.',
    category: 'image',
    icon: 'file-image',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'JPG to PNG Converter',
    metaDescription:
      'Convert JPG to PNG in your browser, one file or twenty at a time. Honest about the trade: the PNG will be larger, and lost JPEG detail stays lost.',
    primaryKeyword: 'jpg to png',
    secondaryKeywords: [
      'convert jpg to png',
      'jpeg to png',
      'jpg to png converter',
      'lossless png',
      'batch jpg to png',
    ],
    synonyms: [
      'jpeg to png converter',
      'change jpg to png',
      'photo to png',
      'save jpg as png',
      'jpg2png',
      'convert jpeg file to png',
      'turn jpg into png',
    ],
    accepts: JPG_ONLY,
    howTo: {
      title: 'How to convert JPG to PNG',
      steps: [
        'Drop in your JPG files, or choose them with the file picker.',
        'Check the dimensions and the estimated PNG size shown for each one.',
        'Convert, then download the PNGs individually.',
      ],
    },
    features: [
      {
        title: 'Lossless from here on',
        body: 'PNG stores pixels exactly, so once the JPEG has been decoded nothing further is thrown away. Every later save of that PNG is identical to the last, which is the reason to convert before a round of editing.',
      },
      {
        title: 'Twenty files at a time',
        body: 'Batch JPG to PNG conversion with no per-file settings to repeat. Each input can be up to 30 MB.',
      },
      {
        title: 'Renamed files are handled',
        body: 'The first bytes of each file are inspected rather than its extension, so a PNG or a WebP wearing a .jpg name is recognised for what it is and reported instead of silently mangled.',
      },
      {
        title: 'Metadata does not come along',
        body: 'The PNG is written from decoded pixels, so EXIF, GPS coordinates and the camera model are left behind. That makes the conversion a reasonable way to publish a photo without its history attached.',
      },
      {
        title: 'Nothing leaves the device',
        body: 'Decoding and encoding both happen in your browser. There is no upload, so a photograph you would rather not hand to a stranger’s server does not have to be.',
      },
    ],
    faq: [
      {
        q: 'Will converting to PNG improve the image?',
        a: 'No. JPEG compression has already discarded detail, and PNG cannot bring it back — it preserves whatever it is given, including the compression artefacts. Converting stops further loss; it does not undo the loss already there.',
      },
      {
        q: 'Why is the PNG so much bigger than the JPG?',
        a: 'Almost always several times bigger, and that is expected. JPEG achieves its size by approximating a photograph, while PNG describes every pixel exactly. On photographic content, exactness is expensive.',
      },
      {
        q: 'Does the PNG have a transparent background?',
        a: 'It does not. JPEG cannot store transparency, so there is none to recover — the background is whatever colour the photograph shows there. PNG supports an alpha channel, but converting cannot invent one.',
      },
      {
        q: 'When is this actually the right conversion?',
        a: 'When something downstream demands PNG, when you are about to edit and re-save repeatedly and want no further generation loss, or when you need a format that will later carry transparency you add yourself.',
      },
      {
        q: 'Is there a file size limit?',
        a: 'Thirty megabytes per file, twenty files per batch, and about 67 megapixels per image — the last one is a browser canvas ceiling rather than a policy, and exceeding it can produce a blank result on mobile.',
      },
    ],
    content: [
      {
        heading: 'What the conversion does and does not change',
        body: [
          'A JPEG is a description of a photograph accurate to within a tolerance you chose when you saved it. Decoding it produces a grid of pixels; writing that grid as a lossless PNG records it precisely. The picture looks the same because it is the same pixels — including any blocking, banding or halo the JPEG already contained.',
          'That is the useful property. If you are about to crop, annotate and re-save an image several times, doing that work on a PNG means the tenth save looks like the first. Doing it on a JPEG means ten rounds of quiet degradation.',
        ],
      },
      {
        heading: 'The size trade, in plain numbers',
        body: [
          'Expect a PNG somewhere between three and ten times the size of the JPEG it came from, depending on how much detail the photograph holds. A flat studio shot converts cheaply; a picture of foliage does not. PNG has no quality dial to trade away, because it never approximates.',
          'So JPEG to PNG is a conversion for a purpose, not a default. If the file is headed for a website or an email, going the other way — or to WebP — will serve you better. If it is headed into an editing pipeline or a tool that only reads PNG, the extra bytes are the price of admission.',
        ],
      },
    ],
    related: ['png-to-jpg', 'image-compressor', 'png-to-webp', 'image-to-pdf'],
    updated: '2026-09-03',
  },
  {
    slug: 'png-to-jpg',
    name: 'PNG to JPG',
    h1: 'Convert PNG to JPG',
    tagline: 'Turn a heavy PNG into a photo-sized JPG, and decide what fills the transparent parts.',
    category: 'image',
    icon: 'swap',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'PNG to JPG Converter',
    metaDescription:
      'Convert PNG to JPG with a quality slider and a background colour for the transparent parts. Runs on your device, so nothing is uploaded.',
    primaryKeyword: 'png to jpg',
    secondaryKeywords: [
      'convert png to jpg',
      'png to jpeg',
      'background colour',
      'quality slider',
      'batch png to jpg',
    ],
    synonyms: [
      'png to jpeg converter',
      'change png to jpg',
      'save png as jpg',
      'png2jpg',
      'flatten png',
      'turn png into jpg',
      'convert screenshot to jpg',
    ],
    accepts: PNG_ONLY,
    howTo: {
      title: 'How to convert PNG to JPG',
      steps: [
        'Add your PNG files.',
        'If any of them have transparency, choose the background colour that should replace it — white is the usual answer.',
        'Set the JPEG quality; the estimated size updates as you move it.',
        'Convert and download.',
      ],
    },
    features: [
      {
        title: 'You choose the background colour',
        body: 'JPEG has no transparency, so the see-through parts of a PNG have to become something. Rather than defaulting to black — which is what an unpainted canvas gives you — this tool paints your chosen colour underneath first.',
      },
      {
        title: 'Real control over quality',
        body: 'A quality value from 1 to 100 with an estimated output size beside it, then the actual byte count once the file is encoded. Screenshots of text usually need a higher setting than photographs do.',
      },
      {
        title: 'Big savings on photographic PNGs',
        body: 'A photograph saved as PNG is the worst case for that format and the best case for this conversion; drops of 80% or more are common. The result shows the original size, the new size and the percentage saved.',
      },
      {
        title: 'Twenty files at once',
        body: 'Batch PNG to JPG conversion with one set of settings, up to 30 MB per file. Each result is listed with its own size comparison.',
      },
      {
        title: 'Alpha is detected, not assumed',
        body: 'The PNG header and its chunks are read to establish whether the image actually has an alpha channel, so you are only asked about a background colour when there is transparency to fill.',
      },
    ],
    faq: [
      {
        q: 'What happens to the transparent areas?',
        a: 'They are flattened onto the background colour you pick, and the transparency is gone for good in the output. Converting back to PNG afterwards gives you an opaque PNG, not the original — keep the PNG if the transparency matters.',
      },
      {
        q: 'Why does my logo look worse than the photo did?',
        a: 'JPEG was designed for continuous tone, and it struggles with the hard edges in text and flat-colour graphics, leaving faint rings around them. For logos, screenshots and diagrams, PNG or WebP is the better destination.',
      },
      {
        q: 'How much smaller will the JPG be?',
        a: 'For a photograph stored as PNG, usually dramatically smaller. For a simple graphic with large flat areas, sometimes barely smaller, and occasionally larger — PNG is very good at flat colour. The comparison is shown per file either way.',
      },
      {
        q: 'Does the conversion keep the image metadata?',
        a: 'No. The output is encoded from decoded pixels, so any embedded text chunks, colour profile or creation data in the PNG are not carried into the JPEG.',
      },
      {
        q: 'What are the limits?',
        a: 'Thirty megabytes per file, twenty files at a time, and roughly 67 megapixels per image before the browser’s own canvas ceiling becomes a problem.',
      },
    ],
    content: [
      {
        heading: 'The transparency question comes first',
        body: [
          'Before anything else, decide what should sit behind the image. White suits a document, an email or a product listing. A brand colour suits a slide. Black is right occasionally and is a poor default, which is why it is not the one here.',
          'The reason this matters more than it sounds is that the choice is permanent. Once the alpha channel has been flattened, no later conversion can separate the subject from the colour behind it. If there is any chance you will need the transparency again, keep the PNG alongside the JPG.',
        ],
      },
      {
        heading: 'When PNG to JPG is the right move',
        body: [
          'PNG is a poor container for photographs, and plenty of software produces exactly that — screenshot tools, some cameras, and any export dialogue where PNG was the first option in the list. That is where PNG to JPEG earns its keep: a 12 MB PNG of a photograph is routinely a 900 KB JPEG at a quality nobody can distinguish from the original.',
          'The opposite holds for anything with text, sharp edges or flat colour. There, JPEG spends bytes fighting the edges and leaves visible fringing, and you are better off compressing the PNG or moving to WebP, which handles both photographs and graphics without the trade.',
        ],
      },
    ],
    related: ['jpg-to-png', 'png-to-webp', 'image-compressor', 'image-to-pdf'],
    updated: '2026-09-03',
  },
  {
    slug: 'png-to-webp',
    name: 'PNG to WebP',
    h1: 'Convert PNG to WebP',
    tagline: 'Keep the transparency and lose most of the weight, for pages that load quickly.',
    category: 'image',
    icon: 'image',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'PNG to WebP Converter',
    metaDescription:
      'Convert PNG to WebP and keep the transparency, with a quality slider and a size comparison. Usually far smaller than the PNG it came from.',
    primaryKeyword: 'png to webp',
    secondaryKeywords: [
      'convert png to webp',
      'webp with transparency',
      'quality slider',
      'alpha channel',
      'batch png to webp',
    ],
    synonyms: [
      'png to webp converter',
      'save png as webp',
      'webp converter',
      'png2webp',
      'compress png to webp',
      'turn png into webp',
      'modern image format',
    ],
    accepts: PNG_ONLY,
    howTo: {
      title: 'How to convert PNG to WebP',
      steps: [
        'Add up to twenty PNG files.',
        'Set the quality — the estimated output size updates as you move the slider.',
        'Convert, then compare each new size against the original before downloading.',
      ],
    },
    features: [
      {
        title: 'Transparency survives',
        body: 'WebP carries a full alpha channel, so a logo, an icon or a cut-out product shot keeps its soft edges. This is the conversion to reach for when JPEG is ruled out by transparency alone.',
      },
      {
        title: 'Usually much smaller',
        body: 'WebP with transparency typically lands well under the equivalent PNG, and around a third under an equivalent JPEG on photographic content. Each file reports the original size, the new size and the percentage saved.',
      },
      {
        title: 'Quality you can set',
        body: 'A quality value from 1 to 100, with an estimate beside the slider before you commit. Flat graphics tolerate a lower setting than photographs, and the preview is the arbiter.',
      },
      {
        title: 'Twenty files, one pass',
        body: 'Batch PNG to WebP conversion with a single set of settings, up to 30 MB per file, and a size comparison for each result.',
      },
      {
        title: 'Written by your browser',
        body: 'WebP is one of the three formats a browser can encode, so no library is downloaded and no file is uploaded. The conversion happens in the tab you already have open.',
      },
    ],
    faq: [
      {
        q: 'Do all browsers support WebP?',
        a: 'Every current desktop and mobile browser does, and has for several years. The remaining reasons to avoid it are older software and services that reject the format on upload — some email clients and print workflows still do.',
      },
      {
        q: 'Is WebP lossy or lossless?',
        a: 'It can be either. The quality slider here selects the lossy mode, which is where the large savings come from. A lossy WebP of a graphic can still look pixel-perfect at a high quality setting, but it is an approximation rather than an exact copy.',
      },
      {
        q: 'Will the transparent edges look the same?',
        a: 'Very close, though lossy compression treats the alpha channel as data like any other, so a very low quality setting can add faint noise around a soft edge. Keep the quality high on anything with a feathered cut-out.',
      },
      {
        q: 'Can I convert an animated PNG?',
        a: 'No. Only the first frame is drawn, so an APNG becomes a still WebP. Animation is not preserved by any tool on this site.',
      },
      {
        q: 'What happens to the PNG metadata?',
        a: 'It is not carried over. The WebP is encoded from decoded pixels, so embedded text chunks and colour profile information do not make the trip.',
      },
    ],
    content: [
      {
        heading: 'Why WebP rather than a smaller PNG',
        body: [
          'PNG compression is lossless, which means the only way to make one much smaller is to reduce its dimensions or its colour count. Running a PNG through a compressor typically shaves a few per cent. Converting the same file to WebP at a high quality setting often removes most of its weight while looking identical on screen.',
          'That gap exists because the two formats are solving different problems. PNG guarantees the exact pixels; WebP is allowed to be approximately right, and a modern lossy codec is very good at being approximately right in ways eyes do not notice.',
        ],
      },
      {
        heading: 'Where the savings actually land',
        body: [
          'Photographs and screenshots with gradients or shadows lose the most. Simple flat-colour graphics — a two-tone icon, a plain chart — sometimes lose very little, because PNG already encodes large flat regions efficiently. The per-file comparison tells you which case you are in rather than leaving you to assume.',
          'For a website, the practical order is resize to the largest size you will actually display, then convert, then check the number. Serving a 3000 px image scaled down in the page wastes far more bytes than any format choice can recover.',
        ],
      },
    ],
    related: ['image-compressor', 'png-to-jpg', 'image-resizer', 'jpg-to-png'],
    updated: '2026-09-03',
  },
];
