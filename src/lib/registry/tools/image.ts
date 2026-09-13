import type { Tool } from '../types';
import {
  JPG_ONLY,
  JPG_ONLY_MANY,
  PNG_ONLY,
  PNG_ONLY_MANY,
  RASTER_IMAGES,
  RASTER_IMAGES_MANY,
  WEBP_ONLY,
} from '../../tools/accepts.ts';

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
    tagline:
      'Compress an image small enough to upload or email, without it looking obviously degraded.',
    category: 'image',
    icon: 'compress',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Compress Images — JPG, PNG and WebP',
    metaDescription:
      'Compress images — JPG, PNG and WebP — with a quality slider and a before-and-after size readout. Runs in your browser, so nothing is uploaded.',
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
      {
        q: 'Is the compressor free, and does it watermark the image?',
        a: 'It is free with no watermark, no stamp in the corner and no reduced-quality “preview” version. Sites that watermark a compressed photo are selling you the removal of their own damage. The file you download is your picture, smaller, and nothing else has been done to it.',
      },
      {
        q: 'Do I need an account, and how many photos can I do at once?',
        a: 'No account, no email address and no daily quota. Twenty images per batch is the only ceiling, and it exists because twenty large photos is roughly what a phone can decode at once without the tab being killed — not because a paid tier does thirty.',
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
    related: ['image-resizer', 'png-to-webp', 'image-to-pdf', 'png-to-jpg', 'webp-to-jpg', 'images-to-pptx', 'compress-jpeg', 'compress-image-to-size'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'image-resizer',
    name: 'Image Resizer',
    h1: 'Resize images online',
    tagline:
      'Resize an image to an exact pixel size — or a whole set of them — without softening the picture.',
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
      {
        q: 'Is resizing free, and will it add a watermark?',
        a: 'Free, and nothing is drawn onto the picture. The output is your image at the pixel dimensions you asked for. A resizer that brands the result has resized it and then damaged it, which is a strange thing to charge for removing.',
      },
      {
        q: 'Do I have to sign up, and is my photo uploaded?',
        a: 'Neither. There is no sign-up form on this site, and the resize happens in the tab using the same drawing code your browser uses for every image on every page. Switch off your internet connection and the tool still works, which is the simplest way to confirm it.',
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
    related: ['image-compressor', 'image-cropper', 'png-to-webp', 'image-to-pdf', 'images-to-pptx', 'compress-jpeg', 'compress-image-to-size'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'image-cropper',
    name: 'Image Cropper',
    h1: 'Crop images online',
    tagline:
      'Crop an image down to the part that matters, at a ratio the destination will accept.',
    category: 'image',
    icon: 'crop',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Crop Images Online',
    metaDescription:
      'Crop images by dragging a selection box, with locked ratios for 1:1, 4:3, 16:9 and more. Live pixel readout, and the file never leaves your device.',
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
      {
        q: 'Is the cropper free, and is there a watermark on the result?',
        a: 'Free, and no. What comes back is the rectangle you selected, at full resolution, with nothing overlaid. The crop is a straight pixel copy out of the original, so the cropped region is bit-for-bit what it was inside the larger picture.',
      },
      {
        q: 'Do I need an account, and does my picture get uploaded?',
        a: 'No account and no upload. The selection rectangle is drawn over a preview in the page and the cut is made on your device, so a photo you are cropping a face or a document out of never reaches a server at any point.',
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
      {
        heading: 'Cropping is not the same as hiding',
        body: [
          'A crop removes pixels. That sounds obvious, and it is worth saying because the two operations people confuse it with do not: drawing a black box over a face leaves the face in the file underneath the box, and scaling a picture down leaves every part of it in frame. If the point is that nobody should ever see part of a photograph, the crop is the operation that achieves it, and the cropped file is the one to send.',
          'The opposite mistake is cropping when you meant to resize. A crop of a 4000-pixel photo down to a 1000-pixel square is a thousand pixels of the original, at original quality, with the rest gone. A resize to 1000 pixels keeps the whole scene and throws away detail everywhere. Neither is better; they answer different questions, and the give-away is whether you care about the composition or the file size.',
          'One thing a crop does not remove is the metadata. Location, camera and timestamp live in their own section of the file and survive being cut down, so a cropped holiday photo can still say where it was taken.',
        ],
      },
    ],
    related: ['image-resizer', 'image-compressor', 'jpg-to-png', 'image-to-pdf', 'resize-signature'],
    updated: '2026-09-03',
  },
  {
    slug: 'jpg-to-png',
    name: 'JPG to PNG',
    h1: 'Convert JPG to PNG',
    tagline:
      'Convert JPG to PNG for a lossless copy you can edit, layer, or feed to a tool that insists on it.',
    category: 'image',
    icon: 'swap',
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
      {
        q: 'Is JPG to PNG conversion free, and does it watermark the PNG?',
        a: 'Free, unwatermarked, and unlimited. Adding a mark to a converted file would be particularly pointless here — the whole reason to convert to PNG is to get a lossless copy to keep editing, and a watermark is a permanent edit somebody else made.',
      },
      {
        q: 'Do I need to register, and is there a size limit?',
        a: 'No registration and no email. Thirty megabytes per file and twenty files at a time, which is a memory limit rather than a business one: the conversion decodes the whole picture into the tab, and a hundred-megapixel scan is where a phone runs out of room.',
      },
      {
        q: 'Is my JPG uploaded to convert it?',
        a: 'No. Your browser already contains a JPEG decoder and a PNG encoder — they are what render and save images on every site you visit — so the conversion is a local operation and no request is made. Disconnect from the internet and it still runs.',
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
      {
        heading: 'What converting to PNG does and does not recover',
        body: [
          'It is easy to read “losslessy” as “better”, and for this direction it does not mean that. A JPEG has already thrown detail away: its encoder decided which parts of the picture a person was least likely to miss and discarded them, and that decision is baked into the file. Converting to PNG preserves the result of that decision perfectly, but it does not undo it — no format can reconstruct detail that is no longer there, and any tool claiming to is inventing pixels.',
          'What you gain is a file that stops degrading. Every time a JPEG is opened, edited and saved it goes through the encoder again, and the damage accumulates — which is why a meme that has been through a dozen phones looks the way it does. A PNG saved from that JPEG will look identical to the JPEG forever, however many times you edit and re-save it.',
          'So the conversion is worth doing when the file is about to be worked on: annotated, composited, cut out, or passed between people who will each re-save it. It is not worth doing to a photograph you are simply going to store or send, where the PNG will be several times larger for no visible gain.',
        ],
      },
    ],
    related: ['png-to-jpg', 'image-compressor', 'png-to-webp', 'image-to-pdf', 'webp-to-jpg', 'webp-to-png'],
    updated: '2026-09-03',
  },
  {
    slug: 'png-to-jpg',
    name: 'PNG to JPG',
    h1: 'Convert PNG to JPG',
    tagline:
      'Convert PNG to JPG to turn a heavy file photo-sized, and decide what fills the transparent parts.',
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
      {
        q: 'Is it free, and is the JPG watermarked?',
        a: 'Free and clean. The JPEG your browser writes is the only thing you get back, with no corner logo and no banner across the middle. Quality is yours to set rather than being throttled to push you towards a paid plan.',
      },
      {
        q: 'Any sign-up, and is there a cap on how many I can convert?',
        a: 'No sign-up. Twenty files per batch, repeated as often as you like — nothing counts how many batches you have run, because nothing on this site knows who you are. The per-file ceiling is thirty megabytes.',
      },
      {
        q: 'Does my PNG get sent anywhere?',
        a: 'No. Your browser decodes the PNG and re-encodes it as a JPEG in the page. There is no upload step in the code, which is why the conversion starts the instant you drop the file rather than after a progress bar and a queue.',
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
      {
        heading: 'The two things that go wrong converting PNG to JPG',
        body: [
          'The first is transparency. PNG can store a transparent background; JPEG cannot, at all, in any variant. So every transparent pixel has to become some actual colour, and the only question is which one. Left to a default that colour is usually white, which is invisible on a white page and glaringly obvious on a dark one — the classic logo-with-a-white-box problem. Picking the background deliberately, to match wherever the image will sit, is the whole fix.',
          'The second is what the picture contains. JPEG compresses by discarding fine detail, and in a photograph the fine detail is texture nobody was looking at. In a screenshot, a diagram or a logo, the fine detail is the edges of letters and shapes — so those come out with a faint grey halo around every character, at any quality setting below the point where the file stops being smaller than the PNG.',
          'The practical rule: convert photographs and leave flat graphics alone. If a PNG of a screenshot is too large, the answer is usually colour reduction rather than JPEG, because a screenshot has few enough distinct colours to compress enormously as an indexed PNG.',
        ],
      },
    ],
    related: ['jpg-to-png', 'png-to-webp', 'image-compressor', 'image-to-pdf', 'compress-jpeg'],
    updated: '2026-09-03',
  },
  {
    slug: 'png-to-webp',
    name: 'PNG to WebP',
    h1: 'Convert PNG to WebP',
    tagline:
      'Convert PNG to WebP: keep the transparency, lose most of the weight, and load pages faster.',
    category: 'image',
    icon: 'swap',
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
      {
        q: 'Is PNG to WebP free, and does it leave a watermark?',
        a: 'Free, and the WebP is unmarked. This matters more than usual for this conversion: people convert to WebP to put images on a website, and a watermarked asset is unusable for that, which is exactly why some converters add one.',
      },
      {
        q: 'Do I need an account, and how many can I convert at once?',
        a: 'No account of any kind. Twenty files a batch, as many batches as you want. If you are converting a whole site’s worth of images, run them in twenties — nothing is counting, and nothing expires.',
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
      {
        heading: 'When WebP is worth the switch, and when it is not',
        body: [
          'WebP exists for one reason: to make images on web pages smaller than PNG and JPEG at the same visible quality, and it succeeds — typically by a quarter to a third against PNG for photographs, and rather more for flat graphics. On a page with twenty images that is the difference between a site that feels instant and one that does not, which is why it has become the default output of most build pipelines.',
          'It is the wrong choice everywhere else. WebP is a web format, and support outside the browser is still patchy: plenty of desktop software, print workflows, older phones and document templates will refuse a .webp or show nothing. An image that has to be emailed, printed, put in a Word document or handed to a designer should stay a PNG or a JPEG.',
          'There is also a decision inside the conversion itself. Lossless WebP is a smaller PNG and nothing is lost; lossy WebP is much smaller still and works like JPEG, with the same caution about text and sharp edges. For a photograph on a website, lossy at a high quality setting is almost always the right answer; for a logo with transparency, lossless is.',
        ],
      },
    ],
    related: ['image-compressor', 'png-to-jpg', 'image-resizer', 'jpg-to-png', 'webp-to-png'],
    updated: '2026-09-03',
  },
  {
    slug: 'webp-to-jpg',
    name: 'WebP to JPG',
    h1: 'Convert WebP to JPG',
    tagline:
      'Convert WebP to JPG — a file nothing will open becomes one everything will.',
    category: 'image',
    icon: 'swap',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'WebP to JPG Converter',
    metaDescription:
      'Convert WebP to JPG in your browser, with a background colour for transparent areas. No upload, no watermark, up to 20 files at a time.',
    primaryKeyword: 'webp to jpg',
    secondaryKeywords: [
      'convert webp to jpeg',
      'webp to jpg converter',
      'save webp as jpg',
      'change webp to jpg',
      'webp file won’t open',
    ],
    synonyms: [
      'webp to jpeg',
      'turn webp into jpg',
      'webp converter',
      'open a webp file',
      'downloaded image is webp',
      'convert webp photo',
      'webp2jpg',
    ],
    accepts: WEBP_ONLY,
    howTo: {
      title: 'How to convert WebP to JPG',
      steps: [
        'Add your WebP files — up to twenty at a time.',
        'If any of them have transparent areas, choose the colour that should fill them.',
        'Set the quality, or leave it at 88.',
        'Convert, then download the JPGs individually or all together as a ZIP.',
      ],
    },
    features: [
      {
        title: 'Transparency is filled, not blackened',
        body: 'JPEG has no alpha channel, and a transparent WebP encoded without a fill comes out with black where the transparency was. The background colour is a control rather than an accident, and it defaults to white.',
      },
      {
        title: 'Quality set for a second-generation encode',
        body: 'A lossy WebP has already discarded detail, and JPEG discards a different set on top. The default of 88 is a little higher than a first encode would need, which is where the visible artefacts on smooth gradients come from.',
      },
      {
        title: 'Twenty files at once',
        body: 'Drop a folder of images in and take the results away as one ZIP. Every file is converted with the same settings, so a set stays consistent.',
      },
      {
        title: 'Nothing is uploaded',
        body: 'Decoding and encoding both happen in your browser tab. The pictures are never sent anywhere, and there is no queue to wait in.',
      },
      {
        title: 'No watermark, no sign-up',
        body: 'The output is the image and nothing else. No stamp in the corner, no cap on how many you convert, no account.',
      },
    ],
    faq: [
      {
        q: 'Why did I end up with a WebP in the first place?',
        a: 'Most websites now serve WebP because it is smaller, so saving an image from a page gives you one. It is a perfectly good format — the problem is only that some older software, print workflows and upload forms do not accept it.',
      },
      {
        q: 'Will converting to JPG lose quality?',
        a: 'A little, and it is unavoidable. Both formats are lossy, so the JPEG encoder is compressing an image that has already been compressed once. At quality 88 the difference is hard to see on a photograph; on flat graphics and text, PNG is the better target.',
      },
      {
        q: 'My transparent logo came out with a white box. Why?',
        a: 'Because JPEG cannot store transparency at all — every pixel must have a colour. The white is the fill. If you need the transparency, convert to PNG instead, which keeps it.',
      },
      {
        q: 'Is the JPG smaller than the WebP?',
        a: 'Usually not. WebP is a newer format and generally beats JPEG at the same visual quality, so expect the file to grow slightly. You are converting for compatibility, not for size.',
      },
      {
        q: 'How many can I convert at once?',
        a: 'Twenty files of up to 30 MB each per batch. The practical limit before that is your device: everything is decoded in one browser tab, and a phone has far less room than a laptop.',
      },
      {
        q: 'Is it free, and will the JPG have a watermark?',
        a: 'Free, no watermark, no account. You are usually here because something saved a WebP that another program refuses to open, and handing back a marked-up JPEG would solve one problem by creating a worse one.',
      },
      {
        q: 'Is there a limit, and is the file uploaded?',
        a: 'Twenty files per batch at thirty megabytes each, and nothing is uploaded — your browser already knows how to decode WebP, which is the only reason this conversion can happen locally at all.',
      },
    ],
    content: [
      {
        heading: 'Why your downloads folder is full of WebP',
        body: [
          'WebP is Google’s image format, and it does its job well: at the same visual quality it is typically 25 to 35 per cent smaller than JPEG, which is why most large sites now serve it. Save a picture from a web page today and a .webp file is what you get.',
          'That is fine until something refuses it. Older versions of Photoshop, plenty of desktop photo software, print shops, some content management systems and a surprising number of upload forms still expect JPG or PNG and nothing else.',
          'Converting is the pragmatic answer, and the only real decision is which target. JPG for photographs; PNG for screenshots, logos and anything with transparency or hard edges.',
        ],
      },
      {
        heading: 'The transparency trap',
        body: [
          'This is the single thing that goes wrong most often. A WebP can have transparent areas exactly as a PNG can, and JPEG cannot represent them at all — every pixel in a JPEG has a colour.',
          'A converter that ignores this writes zero into the colour channels wherever the image was transparent, which is black. People see a logo on a black rectangle and reasonably conclude the file is broken.',
          'So the fill is a visible choice here. White suits almost everything; pick the page colour if the image is going onto a coloured background, and if the answer is "it must stay transparent", the conversion you want is WebP to PNG.',
        ],
      },
      {
        heading: 'You are probably here because something refused to open the file',
        body: [
          'That is the usual reason for this conversion, and it is worth knowing why it happens. WebP is a web format: browsers all support it, and a great deal of other software does not. Save an image from a website today and there is a good chance it lands as a .webp, at which point the photo printing service, the older version of Photoshop, the council’s upload form or the document template all decline it.',
          'Converting to JPEG solves that, because JPEG is the most widely supported image format there has ever been — there is essentially no software that reads images and cannot read a JPEG. The cost is a second round of lossy compression on a picture that has already had one, so some detail goes. At a high quality setting the loss is not visible; at a low one it compounds with the first round and shows.',
          'Two things to watch. If the WebP has a transparent background, that transparency has to become a solid colour, so choose one that matches where the picture will sit. And if the image is a screenshot or a graphic rather than a photograph, converting to PNG instead avoids the halos that JPEG puts around text.',
        ],
      },
    ],
    related: ['webp-to-png', 'png-to-webp', 'image-compressor', 'png-to-jpg'],
    isNew: true,
    updated: '2026-09-10',
  },
  {
    slug: 'webp-to-png',
    name: 'WebP to PNG',
    h1: 'Convert WebP to PNG',
    tagline:
      'Convert WebP to PNG: keep the transparency, and get a file every program understands.',
    category: 'image',
    icon: 'swap',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'WebP to PNG Converter',
    metaDescription:
      'Convert WebP to PNG with transparency intact. Runs in your browser — no upload, no watermark, no sign-up, up to 20 files at a time.',
    primaryKeyword: 'webp to png',
    secondaryKeywords: [
      'convert webp to png',
      'webp to png converter',
      'webp transparent to png',
      'save webp as png',
      'webp to png with transparency',
    ],
    synonyms: [
      'turn webp into png',
      'webp png converter',
      'change webp to png',
      'webp logo to png',
      'webp2png',
      'export webp as png',
    ],
    accepts: WEBP_ONLY,
    howTo: {
      title: 'How to convert WebP to PNG',
      steps: [
        'Add your WebP files — up to twenty at a time.',
        'Check the estimated output size shown under the queue.',
        'Convert.',
        'Download the PNGs one by one, or all together as a ZIP.',
      ],
    },
    features: [
      {
        title: 'Transparency survives',
        body: 'PNG has a full alpha channel, so a cut-out stays a cut-out. Nothing is flattened onto a background colour and there is no fill to choose.',
      },
      {
        title: 'Lossless from here on',
        body: 'PNG stores exactly the pixels it is given. The conversion adds no compression loss of its own — whatever the WebP encoder already discarded stays discarded, and nothing further is lost.',
      },
      {
        title: 'Honest about the size',
        body: 'A PNG of the same image is routinely two or three times the WebP. That is expected and it is the price of the format, not a fault — the tool says so rather than presenting the growth as a surprise.',
      },
      {
        title: 'Batches of twenty',
        body: 'Convert a whole folder of images in one pass and take them away as a single ZIP, with the same settings applied to every file.',
      },
      {
        title: 'Nothing leaves the tab',
        body: 'The images are decoded and re-encoded on your own device. No upload, no queue, no account, and no watermark on what comes out.',
      },
    ],
    faq: [
      {
        q: 'Does converting to PNG improve the image?',
        a: 'No. PNG is lossless, but it can only be lossless about what it receives — the detail a lossy WebP encoder threw away is not recoverable by any format. What you get is an exact, larger copy of the picture you already had.',
      },
      {
        q: 'Is transparency really kept?',
        a: 'Yes. Both formats support an alpha channel, so transparent areas come across as transparent. This is the main reason to choose PNG over JPG as the target.',
      },
      {
        q: 'Why is the PNG so much bigger?',
        a: 'Because it is lossless and WebP is usually not. A photograph can easily go from 300 KB to over a megabyte. If size matters more than compatibility, keep the WebP; if it is a screenshot or flat graphic, the growth is much smaller.',
      },
      {
        q: 'Should I pick PNG or JPG?',
        a: 'PNG if the image has transparency, text, sharp edges or flat colour — screenshots, logos, diagrams. JPG if it is a photograph and the file size matters, accepting a second round of compression.',
      },
      {
        q: 'Are my images uploaded anywhere?',
        a: 'No. Your browser already decodes WebP — that is how it displays them on the sites that serve them — and it already writes PNG, so both halves of this conversion are things it does natively. There is no request in the code and no endpoint to receive one.',
      },
      {
        q: 'Is WebP to PNG free, and is the PNG watermarked?',
        a: 'Free and unwatermarked. The PNG is a lossless copy of what the WebP decoded to, which is the point of choosing PNG as the target, and a watermark would be a permanent change to an image you converted specifically to preserve.',
      },
      {
        q: 'Do I need to sign up, and how many files at a time?',
        a: 'No sign-up, no email, no limit on how often. Twenty files per batch, thirty megabytes each — both are about what a browser tab can hold rather than a tier you can pay to raise.',
      },
    ],
    content: [
      {
        heading: 'When PNG is the right target',
        body: [
          'The choice between PNG and JPG for a converted WebP is decided by what is in the picture, not by preference. PNG stores pixels exactly, which makes it the correct answer for anything with hard edges: screenshots, user-interface captures, logos, diagrams, line art, and any image with a transparent background.',
          'JPEG works by discarding fine detail, and on that kind of image the fine detail is the edges of letters and shapes — which is why text converted to JPEG at a modest quality picks up a faint grey halo around every character.',
          'For a photograph the reasoning inverts. Photographs are full of subtle gradient and grain, JPEG compresses that efficiently, and a PNG of the same photograph can be five times larger with no visible gain.',
        ],
      },
      {
        heading: 'Lossless does not mean restored',
        body: [
          'It is easy to read "lossless" as "better", and for this conversion it does not mean that. Almost every WebP found on a website is lossy: its encoder analysed the picture and threw away the parts a person is least likely to notice. That decision is baked into the file.',
          'Converting to PNG preserves the result of that decision perfectly. It does not undo it — no format can reconstruct detail that is no longer present, and any tool claiming to is guessing at pixels.',
          'What you gain is portability and an alpha channel that survives further editing. If you plan to edit the image repeatedly, working in PNG from here is genuinely worth it, because each save no longer adds another generation of loss.',
        ],
      },
    ],
    related: ['webp-to-jpg', 'png-to-webp', 'image-compressor', 'jpg-to-png'],
    isNew: true,
    updated: '2026-09-10',
  },
  {
    slug: 'images-to-pptx',
    name: 'Images to PowerPoint',
    h1: 'Convert images to PPT or PPTX',
    tagline: 'Turn a set of pictures into a .pptx deck you can open in PowerPoint, Keynote or Slides.',
    category: 'image',
    icon: 'presentation',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Images to PPT — PowerPoint Deck',
    metaDescription:
      'Turn images to PPT in one step: JPG and PNG become a PowerPoint deck, one picture per slide, in 16:9 or 4:3. Nothing is uploaded and nothing re-encoded.',
    primaryKeyword: 'images to ppt',
    secondaryKeywords: [
      'jpg to ppt',
      'png to pptx',
      'photos to powerpoint',
      'picture slideshow pptx',
      'image to slide',
    ],
    synonyms: [
      'image to powerpoint',
      'convert pictures to slides',
      'make a slideshow from photos',
      'jpeg to pptx',
      'screenshots to powerpoint',
      'photo album to presentation',
      'images into a deck',
    ],
    accepts: RASTER_IMAGES_MANY,
    howTo: {
      title: 'How to turn images into a PowerPoint',
      steps: [
        'Add your pictures in the order you want the slides.',
        'Pick the slide size — 16:9 for a projector or screen share, 4:3 for older equipment.',
        'Choose whether each picture is fitted inside the slide, fills it, or sets the slide shape itself.',
        'Build the presentation and download the .pptx.',
      ],
    },
    features: [
      {
        title: 'The pictures go in byte for byte',
        body: 'A .pptx carries its images as ordinary files inside the package, so a JPEG is copied straight in. Nothing is decoded and re-encoded on the way, which means no second generation of compression loss and a deck that weighs roughly what the photographs weighed.',
      },
      {
        title: 'A real .pptx, not a renamed archive',
        body: 'The file is a proper Open XML package — content types, relationships, a slide master, a layout and a theme — which is what lets PowerPoint, Keynote, LibreOffice and Google Slides all open it without an offer to repair it.',
      },
      {
        title: 'Three ways to place a picture',
        body: 'Fit puts the whole image on the slide with background showing at the sides. Fill crops the overflow off the edges. Or let the first picture decide the slide shape, which is the right choice for a set of scans that are all the same proportions.',
      },
      {
        title: 'Unusable files are named, not skipped silently',
        body: 'The format is read from each file’s own header rather than its extension, because a WebP renamed to .png is still a WebP and PowerPoint would show an empty frame for it. Anything that cannot be displayed is listed by name with the reason.',
      },
      {
        title: 'Nothing is uploaded',
        body: 'The package is assembled in the tab using the same ZIP writer the rest of the site uses for its downloads. A deck of internal screenshots or customer photographs never leaves the device.',
      },
    ],
    faq: [
      {
        q: 'Can I edit the slides afterwards?',
        a: 'Yes. Each picture is a normal picture object on a normal slide, so you can move it, resize it, crop it, or add text boxes, titles and notes around it in PowerPoint exactly as if you had inserted it yourself.',
      },
      {
        q: 'Why is there only one slide size for the whole deck?',
        a: 'Because that is how the format works — a PowerPoint file stores one slide dimension for the presentation, not one per slide. A mixed set of portrait and landscape pictures therefore cannot each get their own shape; fit mode is there for sets that are all the same proportions.',
      },
      {
        q: 'Will my WebP images work?',
        a: 'No, and they are reported rather than quietly dropped. PowerPoint does not display WebP. Convert them to PNG or JPG first — there is a converter for that on this site — and then build the deck.',
      },
      {
        q: 'Does it make the deck smaller?',
        a: 'No, and deliberately so. The images are stored as they arrived, so the presentation is about the size of the pictures plus a few kilobytes of XML. If the result is too large to email, compress the images before adding them.',
      },
      {
        q: 'Which order do the slides come out in?',
        a: 'The order you added the files. If you drop a whole folder, that is whatever order your operating system hands over — usually alphabetical, which is why naming scans 01, 02, 03 rather than 1, 2, 3 saves trouble.',
      },
      {
        q: 'Are my pictures uploaded to a server?',
        a: 'No. The package is assembled in the tab, entry by entry, and handed straight to your downloads folder. A deck of internal screenshots or customer photographs is exactly the sort of thing that should not pass through anyone else’s machine on the way to being a presentation.',
      },
      {
        q: 'Is it free, and does the deck come with a watermark slide?',
        a: 'Free, and there is no watermark on the slides and no extra slide advertising this site at the end. That last one is worth checking elsewhere: a deck that opens with somebody else’s logo is not something you can put in front of a room.',
      },
      {
        q: 'Do I need an account, and how many pictures can go in?',
        a: 'No account and no email address. Fifty images per deck, thirty megabytes each. The ceiling is memory rather than policy — every picture is held in the tab while the package is assembled.',
      },
    ],
    content: [
      {
        heading: 'Why 16:9 is the default',
        body: [
          'Every projector, meeting-room display, laptop screen and video-call screen share made in the last fifteen years is 16:9, and a 4:3 deck shown on one gets thick black bars down both sides. PowerPoint itself switched its default in 2013 for the same reason.',
          '4:3 is still worth having for a specific case: older fixed installations in lecture theatres and some conference rooms, where the projector itself is 4:3 and a widescreen deck ends up letterboxed instead.',
          'If your pictures are all the same shape and you are making something to be read rather than projected — a set of scanned pages, a contact sheet, a portfolio — the third option is better than either. Shaping the slides to the first picture means no bars anywhere, because the slide and the image agree.',
        ],
      },
      {
        heading: 'Fit, fill, and which one loses something',
        body: [
          'Fit places the whole picture inside the slide and shows the background colour wherever the shapes disagree. Nothing is lost and nothing is hidden, which makes it the safe default for anything where the edges of the image matter.',
          'Fill scales the picture up until it covers the slide and lets the overflow run off the edges. It looks better for a full-bleed photograph, and the part that runs off is still inside the file — it is a layout decision, not a crop, so anyone can drag the picture back into view. If the aim is to genuinely remove part of an image, crop it before it goes into the deck.',
          'The background colour only appears under fit, which is why the control disappears in the other two modes. White is conventional, but a dark grey behind photographs looks markedly better in a dimly lit room and costs nothing to try.',
        ],
      },
    ],
    related: ['image-to-pdf', 'image-compressor', 'image-resizer', 'pdf-to-pptx'],
    isNew: true,
    updated: '2026-09-12',
  },
  {
    slug: 'compress-jpeg',
    name: 'Compress JPEG',
    h1: 'Compress JPEG files',
    tagline: 'Compress a JPEG down to a size you can send, with the quality slider that actually governs it.',
    category: 'image',
    icon: 'compress',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Compress JPEG — Free, No Watermark',
    metaDescription:
      'Compress JPEG photos in your browser with a real quality slider and a before-and-after size readout. No upload, no watermark, no sign-up, up to 20 at once.',
    primaryKeyword: 'compress jpeg',
    secondaryKeywords: [
      'compress jpg',
      'reduce jpeg file size',
      'jpeg optimizer',
      'make a photo smaller',
      'jpg quality slider',
    ],
    synonyms: [
      'shrink a jpeg',
      'jpg compressor',
      'reduce photo size',
      'compress jpg online',
      'lower jpeg quality',
      'make jpeg smaller for email',
      'optimise jpeg for web',
    ],
    accepts: JPG_ONLY,
    howTo: {
      title: 'How to compress a JPEG',
      steps: [
        'Drop in your JPEGs — up to twenty at a time.',
        'Set the quality. 75 to 85 is the range where the saving is large and the loss is invisible.',
        'Check the before-and-after figures for each file before you commit.',
        'Download them one at a time, or all together as a zip.',
      ],
    },
    features: [
      {
        title: 'One slider, because that is the whole mechanism',
        body: 'JPEG compression works by discarding detail, and the quality number decides how much. There is nothing else to tune that makes a real difference, so the page does not pretend otherwise with a row of switches that change nothing.',
      },
      {
        title: 'The size is shown before you commit',
        body: 'Each file reports what it was and what it became, per image rather than as a total. A batch average hides the one photo that barely moved, which is the one you actually needed to know about.',
      },
      {
        title: 'A file that got bigger is never handed back',
        body: 'Re-encoding an already-heavily-compressed JPEG can produce a larger file. When that happens your original is kept and the page says so, rather than handing you a "compressed" photo that grew.',
      },
      {
        title: 'Only JPEGs, on purpose',
        body: 'The dropzone refuses anything else. A PNG needs a completely different treatment — see the PNG compressor — and quietly accepting one here would mean running the wrong operation on it.',
      },
      {
        title: 'Nothing is uploaded',
        body: 'Your browser already contains a JPEG encoder, because it needs one to save images. The compression uses it, in the tab, which is why the work starts instantly and why the photographs never travel.',
      },
    ],
    faq: [
      {
        q: 'What quality should I choose?',
        a: '75 to 85 for almost everything. Below about 70 the artefacts start to show around edges and in flat areas of sky; above about 90 the file grows quickly for a difference nobody can see. At 100 you will often get a file larger than the one you started with, because the encoder is being asked to preserve noise.',
      },
      {
        q: 'Does compressing a JPEG twice make it worse?',
        a: 'Yes, and this is worth understanding. Every JPEG encode throws detail away, and the losses accumulate — a photo compressed five times looks visibly degraded even if each step used a high quality setting. Always compress from the original rather than from a previously compressed copy.',
      },
      {
        q: 'Why did my photo barely get smaller?',
        a: 'Because it was already compressed. A photo straight off a phone has usually been through a JPEG encoder at a high quality setting, and one that came out of a messaging app has been through one at a low setting. The second has almost nothing left to remove, and the page will tell you so instead of pretending.',
      },
      {
        q: 'Is compressing JPEG free, and is there a watermark?',
        a: 'Free, with no watermark, no corner logo and no reduced-size preview you have to pay to unlock. A compressor that brands the photo has damaged it and is charging you to undo the damage.',
      },
      {
        q: 'Do I need an account, and how many can I do at once?',
        a: 'Nothing is asked for. Twenty photos go through at a time at 30 MB apiece, and the batch count is not tracked because nothing here remembers you between one visit and the next.',
      },
      {
        q: 'Does it strip the location data from my photos?',
        a: 'Re-encoding drops the metadata block, so the compressed copy does not carry the camera model, the timestamp or the GPS coordinates the original did. That is usually what you want before posting a photo, but it means the compressed file is not a full replacement for the original if you keep an archive.',
      },
      {
        q: 'Is my photo uploaded to compress it?',
        a: 'No. The JPEG encoder doing the work is the one built into your browser — the same code that saves an image when you right-click one. It runs in the tab, which is why compression starts the instant you drop a file instead of after an upload bar and a queue position.',
      },
    ],
    content: [
      {
        heading: 'Where the quality number actually bites',
        body: [
          'JPEG divides the picture into blocks, converts each into a set of frequency coefficients, and then rounds those coefficients — coarsely at low quality, finely at high. The rounding is where the file size goes, and it is also where the damage goes. High frequencies are rounded hardest, and high frequencies are edges.',
          'That is why the same quality setting looks different on different pictures. A photograph of a face at quality 70 is fine, because skin and hair are mostly smooth gradients with little high-frequency content. A screenshot of text at quality 70 is visibly wrong, because every letter is an edge and the rounding puts a faint grey halo around all of them.',
          'The practical rule follows directly: photographs tolerate aggressive compression, and anything with text, line art or hard-edged graphics does not. If your image is the second kind, the right answer is not a higher JPEG quality — it is PNG.',
        ],
      },
      {
        heading: 'Getting under a specific limit',
        body: [
          'Most people arrive here with a number: an upload form that refuses anything over 2 MB, an email that bounces at 25, a job portal that wants a photo under 500 KB. The per-file readout is there for exactly this — set a quality, look at the result, and adjust rather than guessing.',
          'If the file is still too large at quality 70, the problem is dimensions rather than compression. A 12-megapixel photo has 12 million pixels to encode however hard you squeeze it, and a form that wants 500 KB almost certainly displays the image at a fraction of that size. Resizing to 1600 pixels on the long edge first, then compressing, routinely gets a file a tenth of the size with no visible difference on screen.',
          'The order matters: resize first, compress second. Compressing and then resizing throws away the detail and then throws away the pixels, which costs quality for no extra saving.',
        ],
      },
    ],
    related: ['compress-png', 'image-compressor', 'image-resizer', 'jpg-to-png', 'compress-image-to-size'],
    isNew: true,
    updated: '2026-09-12',
  },
  {
    slug: 'compress-png',
    name: 'Compress PNG',
    h1: 'Compress PNG files',
    tagline: 'Compress a PNG by reducing its colours — the only thing that actually shrinks a lossless image.',
    category: 'image',
    icon: 'compress',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Compress PNG — Free, No Watermark',
    metaDescription:
      'Compress PNG images in your browser by reducing colours to an indexed palette — often 70-90% smaller. Transparency kept. No upload, no watermark, no sign-up.',
    primaryKeyword: 'compress png',
    secondaryKeywords: [
      'reduce png file size',
      'png optimizer',
      'shrink a png',
      'indexed png',
      'png colour reduction',
    ],
    synonyms: [
      'png compressor',
      'make a png smaller',
      'optimise png for web',
      'compress screenshot',
      'reduce png size online',
      'lossless png compression',
      'tinypng alternative',
    ],
    accepts: PNG_ONLY,
    howTo: {
      title: 'How to compress a PNG',
      steps: [
        'Drop in your PNGs — up to twenty at a time.',
        'Turn on colour reduction. This is the control that does the work; the quality slider does nothing to a PNG.',
        'Pick the number of colours. 256 is invisible on most screenshots; 64 is often invisible on flat graphics.',
        'Check the per-file saving, then download individually or as a zip.',
      ],
    },
    features: [
      {
        title: 'Real compression, not a re-save',
        body: 'Most browser-based "PNG compressors" draw the image to a canvas and save it again, which typically produces a *larger* file than the one you started with. This one quantises the colours and writes a genuine indexed PNG with its own palette, which is the mechanism that makes a PNG small.',
      },
      {
        title: 'Transparency survives',
        body: 'Transparent pixels are carried into the palette and written as a tRNS chunk, ordered so it stays short. A logo with a cut-out background comes out with the cut-out intact rather than on a white square.',
      },
      {
        title: 'Dithering, so gradients do not band',
        body: 'Reducing colours in a gradient normally produces visible stripes. Floyd–Steinberg dithering spreads the error into neighbouring pixels so the eye reads a smooth ramp, which is what makes 64 colours look like thousands.',
      },
      {
        title: 'The quality slider is hidden, because it would lie',
        body: 'PNG is lossless — there is no quality parameter in the format, and a PNG tool that shows you one is showing you a control that changes nothing. This page shows the control that does.',
      },
      {
        title: 'Only PNGs, on purpose',
        body: 'The dropzone refuses other formats, because the operation is specific to PNG. A JPEG needs the quality slider and nothing else, which is the other page.',
      },
    ],
    faq: [
      {
        q: 'How can a lossless format be compressed at all?',
        a: 'By reducing how much there is to store rather than by storing it less accurately. A full-colour PNG records three bytes per pixel; an indexed PNG records a palette once and then one small number per pixel. Dropping from 16 million possible colours to 256 typically cuts the file by 70 to 90 per cent, and on a screenshot the result is pixel-for-pixel identical because a screenshot rarely contains 256 distinct colours in the first place.',
      },
      {
        q: 'Will it look worse?',
        a: 'On screenshots, diagrams, logos and flat illustrations, usually not at all — those images genuinely contain few colours. On photographs saved as PNG it will, because a photograph contains thousands of subtly different shades. If your PNG is a photograph, converting it to JPEG saves far more and looks better than reducing its colours.',
      },
      {
        q: 'Why do other online PNG compressors make my file bigger?',
        a: 'Because they re-encode through the browser canvas, which always writes a full-colour PNG and often uses a weaker compression setting than whatever produced the original. Handing back a larger file and calling it compressed is common enough to be worth checking for — here, if the result is not smaller, your original is kept and the page says so.',
      },
      {
        q: 'Is compressing PNG free, and does it add a watermark?',
        a: 'Free, unwatermarked and unlimited. Watermarking a compressed PNG would be especially destructive, since PNGs are usually logos and interface assets going into a design where somebody else\x27s mark is unusable.',
      },
      {
        q: 'Do I need an account, and is there a size limit?',
        a: 'Nothing to join. Twenty images at a time, 30 MB apiece — a ceiling set by how much decoded bitmap fits in a tab, which for a large PNG is several times the file on disk.',
      },
      {
        q: 'Is my image uploaded?',
        a: 'No. The quantisation, the dithering and the PNG encoding all run in the page — this tool writes the PNG bytes itself rather than asking the browser to, which is precisely why it can produce an indexed file when the canvas cannot.',
      },
    ],
    content: [
      {
        heading: 'Why a canvas cannot compress a PNG',
        body: [
          'This is worth knowing because it explains most of the disappointing results elsewhere. The browser gives every page a way to draw an image and save it — and for PNG that path writes one specific kind of file: full colour, eight bits per channel, with a fixed compression setting. There is no parameter for palettes, no parameter for bit depth, and no parameter for compression effort.',
          'So a tool built on that path cannot make a PNG smaller by any mechanism at all. What it can do is make it larger, which is what happens when the original was written by a program that optimised it and the browser rewrites it without those optimisations.',
          'Producing a genuinely smaller PNG means writing the file format by hand: choosing a palette, mapping every pixel to it, packing the indices at the smallest bit depth that fits, assembling the chunks and deflating the pixel data. That is what happens here, which is why the savings are real.',
        ],
      },
      {
        heading: 'Choosing a colour count',
        body: [
          'Start at 256 and look. A screenshot of an application, a chart, a diagram or a flat illustration will usually be indistinguishable from the original at 256 colours, because it never had more than that — the palette is not throwing anything away, it is just recording it more efficiently.',
          'Below 256 the file keeps shrinking and the risk rises. 64 colours is often invisible on a logo or a two-tone graphic. 32 will show on anything with a gradient, even with dithering. The per-file size readout is there so you can try one, look at the number, and decide.',
          'One case to watch: a screenshot containing a photograph, such as a webpage with a hero image in it. The interface part quantises beautifully and the photograph part does not, and the result is a picture where the chrome looks perfect and the photo looks blotchy. Cropping the photo out, or accepting a higher colour count, are both better than splitting the difference.',
        ],
      },
    ],
    related: ['compress-jpeg', 'image-compressor', 'png-to-jpg', 'png-to-webp'],
    isNew: true,
    updated: '2026-09-12',
  },
  {
    slug: 'compress-image-to-size',
    name: 'Compress Image to a Size',
    h1: 'Compress image to 20KB, 50KB or 100KB',
    tagline:
      'Give it a ceiling in KB and it gets under it — by trading quality first, and resolution only if it has to.',
    category: 'image',
    icon: 'compress',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Compress Image to 20KB, 50KB or 100KB',
    metaDescription:
      'Compress image to 20KB, 50KB, 100KB or any limit you type. It trades quality first and resolution only if it must. Free, no watermark, nothing uploaded.',
    primaryKeyword: 'compress image to 20kb',
    secondaryKeywords: [
      'compress image to 50kb',
      'compress image to size',
      'compress image to 100kb',
      'resize image to 200kb',
      'reduce photo size in kb',
      'image size reducer in kb',
    ],
    synonyms: [
      'photo compressor kb',
      'reduce image to exact size',
      'compress jpg to kb',
      'image size reducer',
      'make photo fit upload limit',
      'shrink image to target size',
      'compress photo for form',
    ],
    accepts: RASTER_IMAGES,
    howTo: {
      title: 'How to compress an image to an exact size',
      steps: [
        'Drop in the picture, or pick it with the file chooser.',
        'Type the limit the form asks for, or choose one of the common ceilings.',
        'Leave the format on JPG unless you know the destination accepts WebP.',
        'Press compress. The result panel names the size it landed on, and says if the picture had to shrink as well.',
      ],
    },
    features: [
      {
        title: 'It searches, rather than guessing',
        body: 'There is no formula that turns "100 KB" into a quality number. A flat screenshot and a leafy photograph at the same quality can differ tenfold in size, so the only honest method is to encode, measure and adjust. This runs a binary search over quality — about six encodes — and keeps the highest quality that still fits.',
      },
      {
        title: 'It finishes the job when quality is not enough',
        body: 'A large photograph cannot reach 20 KB on quality alone; below about 40% the picture turns to mush and it is still too big. Most tools stop here and tell you to go and resize the image first. This one keeps going, reducing the dimensions in steps until the target is met, and tells you which step it used.',
      },
      {
        title: 'It tells you when the picture got small',
        body: 'Upload forms usually enforce a minimum width as well as a maximum weight, and a file that meets the byte limit by becoming 90 pixels wide will be rejected at the other end. If any output drops below 120 pixels on a side, the result panel says so before you upload it.',
      },
      {
        title: 'A file already under the limit is left alone',
        body: 'If the picture already meets the ceiling, you get the original back untouched rather than a re-encoded copy. Re-compressing a file that already satisfies the requirement only throws away quality for nothing.',
      },
    ],
    faq: [
      {
        q: 'Why does the result say 96 KB when I asked for 100 KB?',
        a: 'Because the search stops at the highest quality that fits under your ceiling, and quality moves in steps. Landing a little under is correct — a form that says "maximum 100 KB" rejects 100.4 KB, so aiming to hit the number exactly would be the wrong target.',
      },
      {
        q: 'Can any image be compressed to 20 KB?',
        a: 'Almost any, but not by quality alone. A detailed photograph at full resolution has a floor well above 20 KB, so reaching it means fewer pixels as well as lower quality. If even the smallest step will not fit, the tool says what the smallest size it reached was instead of handing back something that misses the target.',
      },
      {
        q: 'Is this free, and does it add a watermark?',
        a: 'It is free, and it adds nothing to the picture. There is no watermark, no corner logo and no metadata stamp — the output is your image, re-encoded, and nothing else.',
      },
      {
        q: 'Do I need to sign up or give an email address?',
        a: 'No. Nothing on this page is held back behind a registration step — the size box, the format choice and the batch are simply there when you arrive. There is no account system anywhere in this site to sign up to.',
      },
      {
        q: 'Are my photos uploaded to a server?',
        a: 'No. All six encode attempts of the search run on your own processor inside this tab. The picture goes from disk into the page and the finished bytes come back as a download, and there is no request anywhere in the code carrying an image off the device. Disconnect from the network once the page has loaded and you will find the tool still works.',
      },
      {
        q: 'Is there a limit on how many images I can do?',
        a: 'Twenty at a time, at up to 30 MB each, and there is no daily cap or hourly quota. The batch limit is about your device rather than our policy: each file needs its own canvas, and queueing a hundred large photographs is how a phone browser runs out of memory.',
      },
      {
        q: 'Which format should I choose?',
        a: 'JPG unless you have a reason not to. It is accepted by every upload form that exists. WebP reaches the same target at visibly higher quality, but a number of older government and university portals still reject it, and a rejected upload costs more than the quality gained.',
      },
    ],
    content: [
      {
        heading: 'Why "compress to 100 KB" is harder than it sounds',
        body: [
          'File size is not a setting you can dial. When a JPEG encoder is given a quality of 70, it is being told how aggressively to discard detail, not how many bytes to produce — and how many bytes that discarding saves depends entirely on what is in the picture. A screenshot of a spreadsheet is mostly flat colour and compresses to almost nothing. A photograph of a tree is fine detail in every direction and resists compression at the same setting by a factor of ten or more.',
          'So a tool that promises an exact ceiling has to work backwards: encode at some quality, look at the result, and adjust. This one narrows the range by half each time, which resolves the right quality to about one percent in six attempts. On a phone that is roughly a second for a large photograph, which is why it shows progress rather than pretending the answer is instant.',
          'The second half of the problem is the one most tools leave to you. Quality has a floor — below roughly 40% a photograph stops being a photograph and starts being coloured blocks — and for a large picture with a small target, that floor is still too heavy. The only remaining lever is pixel count, because the bytes follow the number of pixels rather than the dimensions: halving the width quarters the area, and roughly quarters the size. Reducing resolution is therefore the correct next step, and doing it automatically is the difference between a tool that answers the question and one that hands it back.',
        ],
      },
      {
        heading: 'What the form is really asking for',
        body: [
          'Upload requirements almost always come in pairs: a maximum file size and a minimum dimension. "Photograph: 20 KB to 50 KB, minimum 200 by 230 pixels" is a typical line. The two pull against each other, which is the entire reason these uploads are frustrating — satisfying the byte limit by shrinking the picture can breach the pixel limit, and nothing on the form warns you.',
          'That is why this tool reports the output dimensions and flags anything that has become very small. If your file met the size ceiling only by dropping under the minimum width, you want to know before the portal tells you, not after. When that happens the fix is usually to crop the picture tighter rather than scale it down, so the pixels you keep are the ones that matter.',
        ],
      },
    ],
    related: ['resize-signature', 'image-compressor', 'image-resizer', 'compress-jpeg', 'image-cropper'],
    isNew: true,
    updated: '2026-09-13',
  },
  {
    slug: 'resize-signature',
    name: 'Signature Resizer',
    h1: 'Resize signature to 20KB for an upload form',
    tagline:
      'Crops away the blank paper around a signature first, so a 20 KB limit is spent on the writing instead of the sheet.',
    category: 'image',
    icon: 'crop',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Resize Signature to 20KB for Forms',
    metaDescription:
      'Resize signature to 20KB, or whatever limit your application form sets. Trims the blank paper first so the writing stays sharp. Free, no upload, no sign-up.',
    primaryKeyword: 'resize signature to 20kb',
    secondaryKeywords: [
      'signature resizer',
      'signature size 20kb',
      'signature photo resize for form',
      'scanned signature too large',
      'signature upload size limit',
    ],
    synonyms: [
      'compress signature image',
      'signature converter for exam form',
      'reduce signature file size',
      'signature 10kb to 20kb',
      'crop signature white background',
      'signature image resizer online',
    ],
    accepts: RASTER_IMAGES,
    howTo: {
      title: 'How to resize a signature for a form',
      steps: [
        'Sign on plain white paper and photograph it straight on, in even light.',
        'Drop the photo here. The blank-border trim is already on.',
        'Set the ceiling the form asks for — 20 KB is the usual one.',
        'Compress, then check the reported dimensions against the form’s minimum before you upload.',
      ],
    },
    features: [
      {
        title: 'It crops to the ink before it compresses',
        body: 'A signature photographed on A4 is perhaps eight percent writing and ninety-two percent paper, and paper costs exactly as many bytes as ink does. Trimming to the edge of the writing first means the whole 20 KB budget is spent on the part that has to stay legible. This is the single biggest reason signature uploads come out unreadable elsewhere.',
      },
      {
        title: 'It measures the paper rather than assuming white',
        body: 'Paper photographed under a room light is not white — it is a grey-beige that drifts across the sheet. A tool that crops by looking for pure white either keeps the whole page or eats the thin end of a pen stroke. This one reads the four corners, takes the median as the paper colour, and trims relative to that, so a phone photo on a desk works as well as a flatbed scan.',
      },
      {
        title: 'Light pen on dark paper works too',
        body: 'Because the background is measured from the corners rather than assumed, the logic does not care which way round the contrast runs. A white signature on dark card is trimmed exactly the same way as black ink on a white sheet.',
      },
      {
        title: 'It warns when the signature has become too small',
        body: 'Forms that cap a signature at 20 KB usually also set a minimum width. If meeting the byte limit pushed the image under 120 pixels on a side, the result says so, because at that point the portal will reject it and a human reading it would struggle too.',
      },
    ],
    faq: [
      {
        q: 'Why is my scanned signature 4 MB when it is just a few lines?',
        a: 'Because the file is not storing a few lines — it is storing a photograph of a whole sheet of paper, and the paper is where nearly all the bytes are. A 12-megapixel camera records twelve million pixels whether they show ink or an empty page, and the faint grain and shadow across a blank sheet compress surprisingly badly. Cropping to the writing is what fixes it.',
      },
      {
        q: 'My signature looks smudged after compressing. What went wrong?',
        a: 'The budget was almost certainly spent on blank paper. With the border trim off, a 20 KB ceiling has to cover the whole sheet, so the writing gets a small fraction of it. Turn the trim on, or crop close to the signature before you start, and the same 20 KB will hold a far sharper result.',
      },
      {
        q: 'Should I photograph my signature or scan it?',
        a: 'Either works. A scan at 200 to 300 DPI is cleaner and needs no trimming logic at all. A phone photo is fine if you shoot straight down in even light, avoid casting your own shadow across the page, and use plain unlined paper — ruled lines are content as far as any cropping tool is concerned, so they get kept and they cost bytes.',
      },
      {
        q: 'Is it free, and will it put a watermark on my signature?',
        a: 'Free, and no. Nothing is drawn onto the image. A watermark on a signature would make it useless for the purpose people need it for, and this site does not add one to any output.',
      },
      {
        q: 'Do I have to create an account?',
        a: 'Never — and it would be strange if it did. Registration exists so a service can tie work to a person, and this tool retains nothing to tie: your file leaves memory the moment you close the tab. No login, no email field, no free tier to exhaust.',
      },
      {
        q: 'Is it safe to put my signature into an online tool?',
        a: 'This is a fair thing to worry about, and the honest answer matters: your signature is never uploaded. The cropping and compression both run inside this browser tab on your own device, and there is no server involved to receive the file. You can disconnect from the internet after the page loads and the tool still works, which is the simplest way to verify the claim yourself.',
      },
      {
        q: 'Is there a size or usage limit?',
        a: 'Files up to 30 MB, twenty at a time, and no daily quota — you can come back as often as you need. Most people do one signature, but a batch is there if you are preparing several applications at once.',
      },
    ],
    content: [
      {
        heading: 'Why examination portals set a 20 KB signature limit',
        body: [
          'The number looks arbitrary and is not. Application systems store a signature alongside a photograph for every candidate, and at national scale that is millions of image pairs that must be served back quickly during verification, often over a poor connection at a test centre. A 20 KB ceiling keeps the whole archive small enough to serve and cheap enough to keep, and it has stayed at roughly that figure for two decades because the constraint has not changed much.',
          'What has changed is the cameras. A limit set when people scanned at 100 DPI is now being met by phones that produce a 4 MB photograph of the same sheet of paper. The gap between what the form wants and what the device produces is two hundredfold, and closing it by quality alone is not possible — which is why so many candidates end up uploading something illegible and hoping.',
        ],
      },
      {
        heading: 'The order of operations that keeps a signature readable',
        body: [
          'There are three ways to make an image smaller and they are not interchangeable. Cropping removes pixels that were never wanted. Scaling removes pixels that were. Lowering quality keeps every pixel but describes each one less precisely. For a signature, that ranking is also the right order to apply them in.',
          'Crop first, because blank paper carries no information at all and every byte it takes is wasted outright. Then lower the quality, because a signature is high-contrast line work on a plain ground, which is the easiest possible subject for a lossy encoder — ink stays black and paper stays pale long after a photograph of a face would have fallen apart. Only when quality reaches its floor does it make sense to start scaling, because that is the step where stroke detail genuinely goes.',
          'A tool that skips straight to scaling, which is what "resize to 20KB" usually means elsewhere, throws away stroke detail while keeping a large area of paper that did not need to be there. The result meets the byte limit and fails the purpose.',
        ],
      },
    ],
    related: ['compress-image-to-size', 'image-cropper', 'image-compressor', 'image-resizer'],
    isNew: true,
    updated: '2026-09-13',
  },
];
