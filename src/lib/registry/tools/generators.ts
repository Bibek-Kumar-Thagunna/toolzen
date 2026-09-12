import type { Tool } from '../types';
import { RASTER_IMAGE_ONE } from '../../tools/accepts.ts';

/**
 * Generators.
 *
 * The three tools here produce something from a seed, a rule or a random
 * source. All three run entirely in the page, which is load-bearing rather than
 * decorative: a Wi-Fi password, a generated password and a brand colour are all
 * things people would rather not post to a server.
 */
export const generatorTools: Tool[] = [
  {
    slug: 'qr-code-generator',
    name: 'QR Code Generator',
    h1: 'QR Code Generator',
    tagline: 'Build a QR code that scans reliably and stays sharp from a business card to a shop window.',
    category: 'generators',
    icon: 'qr',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'QR Code Generator — SVG and PNG',
    metaDescription:
      'A QR code generator for a link, Wi-Fi network, contact card or event. Download a true vector SVG, or a PNG at the exact pixel size you need. No expiry.',
    primaryKeyword: 'qr code generator',
    secondaryKeywords: [
      'wi-fi qr code',
      'vcard qr code',
      'error correction',
      'svg qr code',
      'qr code version',
    ],
    synonyms: [
      'qr generator',
      'create a qr code',
      'make a qr code',
      'qr code maker',
      'wifi qr code generator',
      'png qr code',
      'barcode generator',
    ],
    howTo: {
      title: 'How to make a QR code',
      steps: [
        'Choose what the code carries: a link, plain text, a Wi-Fi network, a contact card, an email, an SMS, a location or an event.',
        'Fill in the fields for that type. The payload string is assembled for you in the format scanners expect.',
        'Adjust the error correction level if the default of M does not suit where the code will live.',
        'Download the SVG for print or a PNG at a chosen pixel size, then scan the finished code with two different phones before printing it.',
      ],
    },
    features: [
      {
        title: 'The encoder runs in this page',
        body: 'The whole pipeline is here: mode selection, Reed-Solomon error correction over GF(256), all eight data masks scored by the four penalty rules from the specification, and the format bits. No image service is called, so a Wi-Fi password or a phone number never travels anywhere.',
      },
      {
        title: 'A true vector SVG',
        body: 'The output is a single merged path inside a viewBox, not a bitmap traced into shapes, so it holds its edges from a favicon to a shop window. It carries shape-rendering="crispEdges" so viewers do not antialias the module boundaries, and the four-module quiet zone the specification requires is built into the coordinates.',
      },
      {
        title: 'Payloads in the formats scanners accept',
        body: 'Wi-Fi credentials, a vCard 3.0 contact, a mailto message, an SMSTO message, a geo location to six decimal places, and a bare iCalendar event. Reserved characters are escaped and CRLF line endings are used where vCard and iCalendar require them, which is what hand-written payloads usually get wrong: a vCard QR code that a phone only half-imports is nearly always a line-ending problem.',
      },
      {
        title: 'Version and mode chosen for your data',
        body: 'Numeric, alphanumeric and byte modes are selected by inspecting the text, and the smallest symbol that fits is used. The QR code version runs from 1 to 40, which is 21 to 177 modules square, and you can set a floor or a ceiling when a batch has to match in size or the modules must stay large enough to print.',
      },
      {
        title: 'Error correction with the trade-off visible',
        body: 'L recovers roughly 7% of a damaged symbol, M about 15%, Q about 25% and H about 30%. More recovery means more codewords, which can push the version up and shrink every module in the same printed area, so M is the default: it survives ordinary handling without inflating the code.',
      },
      {
        title: 'UTF-8 declared rather than assumed',
        body: 'When the text needs more than Latin-1, an ECI header with assignment number 26 is emitted before the mode indicator, which tells a conforming scanner to read the bytes as UTF-8 instead of guessing. Kanji mode and structured append are deliberately left out.',
      },
    ],
    faq: [
      {
        q: 'Is a QR code private?',
        a: 'No. Anyone who can see the code can scan it, and the symbol itself has no password. A Wi-Fi QR code hands your network password to everyone who photographs it, so a code on a wall, a menu or a flyer should be treated as public.',
      },
      {
        q: 'Do these codes expire or count scans?',
        a: 'Neither. The data sits inside the symbol rather than behind a redirect owned by this site, so there is nothing to expire and no tracking. The trade-off is that the destination is fixed: a different destination needs a different code.',
      },
      {
        q: 'Why is my code so dense, and will it still scan?',
        a: 'A longer payload needs a higher version, and a higher version packs more and smaller modules into the same area. Density is the usual reason a code fails at a distance or on a small label, and shortening the text or the link helps far more than raising the error correction level.',
      },
      {
        q: 'How much error correction is worth using?',
        a: 'M suits most uses and is the default. H earns its extra size when the code will be printed small, sit on a curved surface, or get scuffed. L is only worth it when the symbol has to stay as compact as possible on a clean screen.',
      },
      {
        q: 'Should I download the SVG or the PNG?',
        a: 'Use the SVG for anything printed or resized later, because it stays exact at any size. Use the PNG when something needs a bitmap at a fixed pixel size, such as a chat message or a slide; the PNG is drawn from the same module grid, so the modules land on whole pixels and stay crisp.',
      },
      {
        q: 'Does anything I type reach a server?',
        a: 'No. The encoder is JavaScript running in this page, and the tool makes no network request while generating a code, which you can confirm in the network tab of your browser devtools. That is also why it keeps working offline.',
      },
      {
        q: 'Is the QR generator free, and does the code have a watermark or expire?',
        a: 'Free, unmarked and permanent. The code encodes your data directly, so it never expires and never redirects through us — unlike a “free” dynamic QR service, where the code points at their server and stops working when the trial does.',
      },
      {
        q: 'Do I need an account, and how many codes can I make?',
        a: 'No account and no limit. Nothing counts your codes, because nothing tracks you — and nothing about the URL or text you encoded is sent anywhere, which matters when the code is for an unreleased page or a private wifi password.',
      },
    ],
    content: [
      {
        heading: 'What is actually inside a QR code',
        body: [
          'A QR symbol is a small, strictly specified data structure rather than a picture. The three squares in the corners are finder patterns that let a scanner locate and orient the code, the dotted lines between them are timing patterns that establish the module grid, and the smaller squares scattered across larger symbols are alignment patterns that correct for perspective when the code is photographed at an angle.',
          'Your text is first assigned a mode. Digits pack at about three and a third bits each, uppercase alphanumeric text at five and a half, and anything else falls back to byte mode at eight bits per byte. That is why a code holding a phone number is far sparser than one holding the same number of mixed-case characters, and why shortening a URL to uppercase can genuinely reduce the version needed.',
          'The encoded data is then extended with Reed-Solomon codewords computed over the finite field GF(256), split into blocks and interleaved so that damage in one place is spread across several blocks. This is what allows a torn or dirty code to decode: the scanner is not guessing at missing modules, it is solving for them. Finally, one of eight mask patterns is XORed over the data area, chosen by scoring each candidate against four penalty rules that punish long runs, solid blocks, patterns resembling a finder, and an unbalanced ratio of dark to light.',
        ],
      },
      {
        heading: 'Printing a code that scans the first time',
        body: [
          'Two things break printed codes more often than anything else: size and quiet zone. A module needs to survive both the printer and the camera, so the practical rule is to keep the symbol large enough that each module is comfortably printable and to leave the four-module light border untouched. Cropping the quiet zone or letting a background pattern run into it is a reliable way to make a technically perfect code unreadable.',
          'Contrast and orientation matter next. Dark modules on a light background is the arrangement scanners expect; inverting it works on some readers and fails on others. Colour is fine as long as the contrast stays high, but a light foreground on a dark field is a gamble not worth taking for the sake of a palette.',
          'Then test it properly. Scan the final artwork, at the final size, with at least two different phones, including one with an older camera, and from the distance a real person will stand at. A code that scans on your desk at 400 pixels may fail on a poster at three metres, and the failure is silent: the person simply gives up.',
        ],
      },
    ],
    related: ['password-generator', 'color-palette-generator', 'image-to-pdf', 'favicon-generator', 'lorem-ipsum-generator'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'password-generator',
    name: 'Password Generator',
    h1: 'Password Generator',
    tagline: 'Get a password or passphrase that is genuinely random, and see how much strength you are getting.',
    category: 'generators',
    icon: 'shield',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'Password Generator and Strength Check',
    metaDescription:
      'A password generator for random passwords and passphrases, run in your browser, with an entropy figure you can check and no character-frequency bias.',
    primaryKeyword: 'password generator',
    secondaryKeywords: [
      'random password',
      'passphrase generator',
      'strong password',
      'password strength',
      'entropy',
    ],
    synonyms: [
      'secure password generator',
      'create a password',
      'password maker',
      'random passphrase',
      'diceware',
      'pin generator',
      'memorable password',
    ],
    howTo: {
      title: 'How to generate a strong password',
      steps: [
        'Set the length, then choose which kinds of character to draw from: lowercase, uppercase, digits and symbols.',
        'Exclude ambiguous or shell-hostile characters if the password will be read aloud, retyped or pasted into a config file.',
        'Switch to passphrase mode when a person has to remember it, and pick how many words.',
        'Check the entropy figure to see how much randomness the settings actually give you, then copy the result.',
      ],
    },
    features: [
      {
        title: 'A cryptographic random source, not Math.random',
        body: 'Every character comes from crypto.getRandomValues, the platform CSPRNG. Math.random is never called: it is not designed to resist anyone trying to reproduce its output, and it is seeded from something predictable enough to matter here.',
      },
      {
        title: 'Rejection sampling, so the alphabet stays flat',
        body: 'Taking a random byte modulo 62 makes the first few characters of an alphabet about 25% more likely than the rest, because 256 is not a multiple of 62. Draws that land in the uneven tail are thrown away and redrawn instead, which is why there is no character-frequency bias to compensate for.',
      },
      {
        title: 'A 512-word list at exactly nine bits a word',
        body: 'The passphrase generator draws from 512 words, which is two to the ninth power, so each word contributes exactly nine bits and the entropy needs no rounding. The list is filtered so no two words are anagrams, none is a prefix of another, no pair differs by a single edit, and no homophones sit in it together, which is what makes a spoken or retyped passphrase recoverable.',
      },
      {
        title: 'Entropy that is calculated, not estimated',
        body: 'For a generated password the figure is the length times the base-2 logarithm of the pool size, which is exact because the draw is uniform. Requiring at least one character from every selected set makes the true value fractionally lower, so the number shown is an upper bound and is described as one.',
      },
      {
        title: 'Exclusions for the places passwords actually go',
        body: 'Characters that get misread off a screen or over the phone - zero against capital O, one against lowercase l - can be dropped in one click. Symbols that need escaping in a shell or a CSV file can be dropped separately, you can supply your own symbol set, and repeated characters can be forbidden outright.',
      },
      {
        title: 'A password strength check for the ones you already have',
        body: 'Typed passwords are scored against dictionary words, keyboard runs, tripled characters, a trailing year and the capital-plus-symbol shape of Password1, then turned into crack-time estimates at 100 billion guesses a second offline and 1,000 online. The result is an upper bound on strength rather than a guarantee.',
      },
    ],
    faq: [
      {
        q: 'Does a generated password leave my device?',
        a: 'No. Generation, the word list and the strength check all run in this page, and the tool makes no network request, which you can confirm in your browser devtools. Nothing is stored either, so reloading loses the password for good.',
      },
      {
        q: 'What does the entropy figure actually tell me?',
        a: 'It describes the generator, not your overall security. Seventy-two bits means the settings could have produced any one of about 4.7 x 10^21 equally likely passwords. It says nothing about where the password ends up, whether it is reused, or how the site holding it stores the thing.',
      },
      {
        q: 'Is a password only as safe as where I keep it?',
        a: 'In practice, that is the deciding factor. A 20-character random string in a note on a shared drive is weaker than a shorter one in a password manager. Generating it is the easy part; storage, reuse and the site\'s own handling are what usually determine the outcome.',
      },
      {
        q: 'Are passphrases weaker than random passwords?',
        a: 'Not inherently, but they need more characters for the same strength. Six words from the 512-word list is 54 bits, while a 16-character password drawn from all four kinds of character is about 104. A passphrase wins when a human has to type or recall it, and loses when a length limit is tight.',
      },
      {
        q: 'Why did it refuse my settings?',
        a: 'Length is limited to 4 to 256 characters, a batch to 1,000 at a time, a passphrase to 2 to 24 words and a PIN to 3 to 12 digits. Asking for at least one character from more kinds of character than the password has room for is also refused, because that request cannot be met.',
      },
      {
        q: 'Do the crack-time figures mean my password will last that long?',
        a: 'No. They are arithmetic on an assumed guess rate. A real attacker may have a leaked hash, a fast or a deliberately slow hash function, a reuse list, or your password already sitting in a breach corpus. Use the numbers to compare two passwords, not to predict a date.',
      },
      {
        q: 'Is the password generator free, and is there a limit?',
        a: 'Free, with no account and no cap on how many you generate. Every option — length, character sets, passphrases — is available, because a password generator with a paid tier is selling you weaker passwords for free.',
      },
      {
        q: 'Are the passwords generated on a server, or could they be uploaded?',
        a: 'Neither. They come from your browser’s cryptographic random source, in the page, and are never transmitted or stored. A password that travelled over a network before you used it is not a secret, which is the whole problem with generating one on somebody else’s machine.',
      },
    ],
    content: [
      {
        heading: 'What makes a password strong, and what only looks like it',
        body: [
          'Strength is randomness, measured in bits, and nothing else. A password of a given length drawn uniformly from a pool of 89 characters has length times 6.48 bits of entropy, and that number is the whole story about how hard it is to guess. Everything people are taught to add on top - a capital at the front, a digit at the end, a symbol swapped in for a vowel - adds a fraction of a bit, because attackers know those rules as well as you do.',
          'This is why the strength meter here penalises shapes rather than rewarding character variety. Password1 has an uppercase letter, a lowercase run and a digit, and it is one of the first candidates any real cracking rule set tries. A dictionary word with a year after it, a keyboard run like qwerty, a tripled character: each of these collapses a large-looking search space into a small one, and the score reflects that.',
          'The corollary is that the generator matters more than the composition rules. Sixteen characters drawn uniformly are stronger than twenty-four characters built around a memorable phrase with substitutions, and both are irrelevant if the password is reused on a site that stores it unhashed. The figure this tool prints is about the draw, and it is the one part of the problem the tool can actually control.',
        ],
      },
      {
        heading: 'Modulo bias, and why the random source is worth caring about',
        body: [
          'There are two ways to get a random character wrong, and both are common. The first is the source: Math.random is a fast, non-cryptographic generator whose internal state can be recovered from a modest number of outputs, so a password built from it is not unpredictable in any meaningful sense. crypto.getRandomValues is the platform CSPRNG and is the only sensible choice, which is why nothing else is used here.',
          'The second is the reduction from a random number to a random character. Drawing a byte and taking it modulo 62 is the textbook mistake: 256 divided by 62 is 4 remainder 8, so the first eight characters of the alphabet come up five times per 256 draws and the rest only four. That is a 25% skew on a quarter of the alphabet, and it is invisible in any single password. Discarding draws that fall in the uneven tail and trying again removes it exactly, at the cost of a few extra draws.',
          'A passphrase has the same problem in a different dress, which is the practical argument for a list whose size is a power of two. With 512 words, nine random bits select a word with no remainder and no rejection needed, and the entropy is exactly nine bits a word rather than a figure that has to be rounded down and explained. The filtering that removes anagrams, prefixes, single-edit neighbours and homophones costs a little of the theoretical space but makes the result something a person can read out over a phone and have arrive intact.',
        ],
      },
    ],
    related: ['uuid-generator', 'qr-code-generator', 'jwt-decoder', 'color-palette-generator', 'favicon-generator'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'color-palette-generator',
    name: 'Color Palette Generator',
    h1: 'Color Palette Generator',
    tagline: 'Turn one color into a palette you can ship, with the contrast and color blindness checks already done.',
    category: 'generators',
    icon: 'palette',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'Color Palette Generator with Contrast',
    metaDescription:
      'A color palette generator that builds from one starting color, with harmony rules, a Tailwind-style 50-950 scale, WCAG contrast and color blindness previews.',
    primaryKeyword: 'color palette generator',
    secondaryKeywords: [
      'color harmony',
      'wcag contrast',
      'complementary colors',
      'hex to rgb',
      'color blindness',
    ],
    synonyms: [
      'color scheme generator',
      'palette maker',
      'colour palette generator',
      'hex color picker',
      'tailwind color scale',
      'accessible color contrast',
      'color wheel',
    ],
    howTo: {
      title: 'How to build a color palette',
      steps: [
        'Paste a starting color in any usual notation: hex, rgb(), hsl() or a CSS color name.',
        'Choose a harmony rule, and how many swatches you want between 2 and 12.',
        'Read the contrast panel to see which swatches are safe for body text and which only pass for large text or borders.',
        'Turn on a color blindness preview to check the palette still separates, then copy the values in the format your code wants.',
      ],
    },
    features: [
      {
        title: 'Eight harmony rules',
        body: 'Complementary, analogous, triadic, tetradic, split-complementary, monochromatic, shades and tints. Each rule derives its colors by rotating hue or moving lightness on the HSL wheel, which is the wheel the rules were defined on, and analogous is the default because it is the hardest to make clash.',
      },
      {
        title: 'Contrast measured against the thresholds that matter',
        body: 'Every swatch is checked against both white and black with the WCAG relative luminance formula and reported against four thresholds: 4.5:1 for body text, 3:1 for large text, 7:1 for AAA body text, and 3:1 for interface components under success criterion 1.4.11. The linear-light step uses the 0.04045 cut-off from the published recommendation rather than the older draft value, so the figures match other conforming checkers.',
      },
      {
        title: 'Color blindness previews, with the science stated',
        body: 'Protanopia, deuteranopia and tritanopia are simulated with the Vienot, Brettel and Mollon LMS matrices applied in linear light, not by desaturating a picture. The paper\'s own caveat is carried through: the protanopia and deuteranopia coefficients are fitted to observations, while the tritanopia ones are an extrapolation.',
      },
      {
        title: 'A Tailwind-style 50 to 950 scale',
        body: 'One color expands into the eleven steps a component library expects by walking lightness in Oklab while holding hue, which keeps the steps perceptually even instead of bunching in the mid-tones. When a step falls outside the sRGB gamut, chroma is reduced by binary search rather than clipping the channels, which is what stops a vivid step turning grey or drifting in hue.',
      },
      {
        title: 'Every format you might paste',
        body: 'Each swatch is shown as hex with or without alpha, rgb, hsl, hsv, CMYK and OKLCH, so converting hex to rgb is not a separate errand. The nearest of the 148 CSS color names is found with the redmean distance approximation, which tracks human judgement better than plain Euclidean distance in RGB.',
      },
      {
        title: 'A forgiving parser and reproducible output',
        body: 'Input can be hex in three, four, six or eight digits, functional rgb or hsl notation, or a CSS color name. Supplying a seed makes the palette reproducible, so the same seed and settings give a colleague, or a test, exactly the same swatches.',
      },
    ],
    faq: [
      {
        q: 'What contrast ratio do I actually need?',
        a: '4.5:1 is the AA threshold for body text, 3:1 covers large text and interface components such as input borders and focus rings, and 7:1 is AAA for body text. Each swatch is reported against all four thresholds, against white and against black, so a color can pass as a background and fail as text.',
      },
      {
        q: 'Why do the CMYK values look wrong for print?',
        a: 'Because the conversion is the naive arithmetic one, with no ink limit, no paper profile and no color management. It is useful for a rough idea and unsuitable for a print job, where the profile your printer specifies is the only figure that counts.',
      },
      {
        q: 'How accurate are the color blindness previews?',
        a: 'The protanopia and deuteranopia simulations rest on coefficients fitted to observation and are close enough to make design decisions against. Tritanopia is an extrapolation in the original paper, so treat it as indicative. None of the three is a substitute for testing with people.',
      },
      {
        q: 'Why is the 50-950 scale built in Oklab rather than HSL?',
        a: 'Because HSL lightness is not perceptual: two colors with the same HSL lightness and different hues look nothing alike in brightness, so an HSL ramp crowds the middle and washes out at the ends. Oklab lightness is close to what the eye reports, so equal steps look like equal steps.',
      },
      {
        q: 'Why are the harmony rules on the HSL wheel then?',
        a: 'Because that is the wheel the rules were defined on and the one most people picture when they think about complementary colors. Perceptual evenness matters for a lightness ramp, not for the tradition that says a triad sits at 120 degree intervals, so each part of the tool uses the model that suits it.',
      },
      {
        q: 'Do my colors get uploaded anywhere?',
        a: 'No. The color math, the contrast figures and the simulations all run in this page, so an unreleased brand palette stays on your machine and nothing is kept between visits.',
      },
      {
        q: 'Is the palette generator free, and are exports watermarked?',
        a: 'Free, and what you copy out is plain colour values — hex, RGB, HSL — with nothing appended. There is no export limit and no branded swatch sheet.',
      },
      {
        q: 'Do I need an account, and is anything uploaded?',
        a: 'No account, and no. Palettes are generated by colour maths running in the page, so an unreleased brand scheme you are experimenting with never reaches a server and is not saved to any gallery.',
      },
    ],
    content: [
      {
        heading: 'Color harmony is a starting point, not an answer',
        body: [
          'The harmony rules are geometry on a wheel. Complementary colors sit opposite each other, a triad sits at 120 degree intervals, analogous colors are neighbours, and split-complementary takes the two colors either side of the opposite. They are useful because they generate combinations that are related rather than arbitrary, and they are limited because the wheel knows nothing about what any of the colors will be used for.',
          'A palette that is harmonious and unusable is easy to produce. Three analogous mid-tones look pleasant next to each other and give you nothing to put text on. A complementary pair at full saturation vibrates uncomfortably at small sizes. A monochromatic set is safe and can leave you without a color that reads as a warning. This is why the output includes lightness ramps and contrast figures rather than five swatches and a compliment.',
          'The practical way to use the rules is as a first draft: pick the rule that matches the mood you want, then judge each swatch on what it has to do. A brand color, a background, a body text color, a border and a state color have different requirements, and the last three are decided by contrast rather than by hue.',
        ],
      },
      {
        heading: 'The parts that fail after the palette is chosen',
        body: [
          'Contrast is the first. A color that looks fine as a large heading on a designer\'s calibrated screen can be unreadable as body text on a cheap laptop in daylight, and the WCAG ratio is a reasonable proxy for that. Checking each swatch against both white and black is the quickest way to find out what a color can actually be used for, because plenty of pleasant mid-tones fail against both and are therefore background colors, not text colors.',
          'Color blindness is the second, and it is more common than most palettes assume: roughly one man in twelve has some form of red-green deficiency. The failure it causes is specific. It is rarely that a color looks wrong; it is that two colors that carried different meanings become the same color. A red error state and a green success state, or two adjacent lines on a chart, stop being distinguishable, and a screenshot in a bug report looks identical to the one in the design.',
          'The fix is not to avoid color but to stop color from being the only signal, and to check the palette in a simulation while it is still cheap to change. If two swatches merge under deuteranopia, moving one in lightness rather than in hue usually separates them for everyone, because a lightness difference survives every form of color vision deficiency. That is the practical reason the lightness scale sits next to the harmony rules here rather than in a separate tool.',
        ],
      },
    ],
    related: ['image-compressor', 'png-to-webp', 'qr-code-generator', 'lorem-ipsum-generator'],
    updated: '2026-09-03',
  },
  {
    slug: 'favicon-generator',
    name: 'Favicon Generator',
    h1: 'Favicon generator for every size a site needs',
    tagline: 'Turn one image into the icon files a site needs, and the four lines that load them.',
    category: 'generators',
    icon: 'star',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Favicon Generator — ICO and PNG',
    metaDescription:
      'A favicon generator that makes favicon.ico plus the Apple and Android icons from one image, with the HTML to paste. No upload, no sign-up, no watermark.',
    primaryKeyword: 'favicon generator',
    secondaryKeywords: [
      'make a favicon',
      'png to ico',
      'favicon.ico generator',
      'apple touch icon',
      'website icon generator',
    ],
    synonyms: [
      'create favicon',
      'convert image to favicon',
      'site icon generator',
      'tab icon',
      'ico converter',
      'favicon from png',
      'browser icon maker',
    ],
    accepts: RASTER_IMAGE_ONE,
    howTo: {
      title: 'How to generate a favicon',
      steps: [
        'Add a square image — 512 pixels or larger gives the best result.',
        'Pick the background colour used for the iPhone icon, since iOS cannot show transparency.',
        'Generate, and check the 16-pixel preview: that is the size a browser tab draws.',
        'Download the ZIP, put the files in your site root, and paste the markup into your <head>.',
      ],
    },
    features: [
      {
        title: 'Four files, not twenty',
        body: 'An ICO for desktop browsers, two PNGs for Android, and one Apple touch icon. That is everything a browser released this decade looks for — the rest of what generators produce is metadata for platforms that no longer exist.',
      },
      {
        title: 'Three real sizes inside the ICO',
        body: 'A tab draws 16 pixels, a bookmarks bar 32, some Windows views 48. Each one is encoded separately rather than left to the operating system to scale, which is the difference between a legible mark and a smudge.',
      },
      {
        title: 'The iPhone icon is flattened on purpose',
        body: 'iOS composites a transparent home-screen icon onto black, which is why generated icon sets so often arrive as a dark tile. Here the Apple icon is always filled with a colour you choose.',
      },
      {
        title: 'You can see the 16-pixel version before you ship it',
        body: 'Every size is previewed at its real dimensions. A logo that reads perfectly at 128 pixels is often unrecognisable at 16, and that is worth finding out here rather than in a browser tab.',
      },
      {
        title: 'The markup comes with it',
        body: 'The four link tags are shown on the page and included in the download, so there is no hunting for which rel attribute goes with which file.',
      },
      {
        title: 'Nothing is uploaded',
        body: 'Every size is drawn by your own browser and the ICO is assembled in the tab. A logo that is not public yet does not have to be sent to a stranger to become a favicon.',
      },
    ],
    faq: [
      {
        q: 'What size image should I start with?',
        a: 'Square, and at least 512 pixels on each side. Everything is scaled down from your source, and scaling up cannot invent detail — a 64-pixel logo will produce a soft 512-pixel icon and the tool says so when it happens.',
      },
      {
        q: 'My image is not square. What happens?',
        a: 'It is cropped to a centred square, because every icon slot a browser has is square. If the important part of your logo is off-centre, crop it yourself first so you control what survives.',
      },
      {
        q: 'Why does the ICO contain three images?',
        a: 'Because different places draw the icon at different sizes, and an image encoded at its final size always looks better than one scaled at draw time. The ICO format exists precisely to carry several — 16, 32 and 48 covers everything that asks.',
      },
      {
        q: 'Do I still need favicon.ico in 2026?',
        a: 'Yes, and mostly for one reason: browsers request /favicon.ico from your site root whether you reference it or not. Having it there stops a 404 on every page load, and it is still what several desktop contexts use.',
      },
      {
        q: 'Why is my transparent logo on a coloured square?',
        a: 'Only the Apple touch icon is, and it has to be — iOS ignores transparency in a home-screen icon and fills it with black. The ICO and the Android PNGs keep the transparency your image had.',
      },
      {
        q: 'Will this work on an old Windows machine?',
        a: 'The icons inside the ICO are PNGs, which every browser and Windows version since Vista reads. Windows XP shows nothing for a PNG-payload icon; if that genuinely matters, you need a BMP-payload ICO from desktop software.',
      },
      {
        q: 'Is the favicon generator free, and is the icon watermarked?',
        a: 'Free, and the icons are your image at each size with nothing added. A watermarked favicon would be absurd — it is sixteen pixels across — but the same sites that mark everything else do mark these.',
      },
      {
        q: 'Do I need an account, and is my logo uploaded?',
        a: 'No account, and your logo stays on your device. It is resized by your own browser, which means an unreleased brand mark is not sitting in somebody’s upload folder while you decide whether you like it.',
      },
    ],
    content: [
      {
        heading: 'What a site actually needs today',
        body: [
          'Favicon advice has accumulated for twenty-five years and almost none of it has been retired, which is why the typical generator hands back a folder of twenty files and a block of markup nobody can explain.',
          'The current requirement is short. A favicon.ico in your site root covers desktop browsers and the automatic request every browser makes for that path. A 192-pixel and a 512-pixel PNG, referenced from a web app manifest, cover Android home screens and install prompts. One apple-touch-icon covers iOS. Everything else — Windows tile XML, six Apple sizes, the Safari mask icon — is answering questions no shipping browser asks any more.',
          'Fewer files also means fewer things to forget when the logo changes, which is the actual maintenance cost of an icon set.',
        ],
      },
      {
        heading: 'Designing for sixteen pixels',
        body: [
          'A favicon is drawn at about the size of a full stop, and that constraint is unforgiving in a way that is hard to picture from a full-size logo. Fine lines disappear. Text becomes texture. Two shapes of similar weight merge into one blob.',
          'Marks that survive have a strong silhouette and very few elements — often a single letter, or one shape at high contrast. If your logo is a wordmark, using its first letter alone is usually better than shrinking the whole thing.',
          'This is why the preview shows the real 16-pixel render rather than a scaled-down picture of it. Looking at that one image for a few seconds before you ship is the entire quality-control step, and it catches the problem while it is still cheap to fix.',
        ],
      },
      {
        heading: 'Where the files go',
        body: [
          'Put every generated file in the root of your site, so they are reachable at /favicon.ico, /icon-192.png and so on, then paste the link tags into the <head> of your pages — in a shared layout or template rather than each page individually.',
          'Browsers cache favicons aggressively and sometimes ignore a fresh copy for days. If a change does not appear, load the icon URL directly and force-refresh it, or check in a private window before concluding something is wrong with the file.',
          'If your framework has its own convention — a file in a specific directory, or generated metadata — prefer that over the manifest here; two manifests referenced from one page is a conflict rather than a belt-and-braces.',
        ],
      },
    ],
    related: ['image-compressor', 'png-to-webp', 'image-cropper', 'qr-code-generator'],
    popular: true,
    isNew: true,
    updated: '2026-09-10',
  },

  {
    slug: 'lorem-ipsum-generator',
    name: 'Lorem Ipsum Generator',
    h1: 'Lorem ipsum generator',
    tagline: 'Placeholder text in the amount and shape your layout needs.',
    category: 'generators',
    icon: 'text',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'Lorem Ipsum Generator',
    metaDescription:
      'A lorem ipsum generator for words, sentences or paragraphs, with or without the classic opening, and optionally wrapped in HTML paragraph tags.',
    primaryKeyword: 'lorem ipsum generator',
    secondaryKeywords: [
      'lorem ipsum',
      'placeholder text',
      'dummy text generator',
      'filler text',
      'lorem ipsum paragraphs',
    ],
    synonyms: [
      'dummy text',
      'sample text generator',
      'greeking text',
      'placeholder copy',
      'lipsum',
      'mock text',
      'filler copy for design',
    ],
    howTo: {
      title: 'How to generate lorem ipsum',
      steps: [
        'Choose paragraphs, sentences or words, and how many you need.',
        'Turn on the classic opening if the text should be recognisable as filler.',
        'Turn on HTML tags if it is going straight into a template.',
        'Copy the text, or download it as a .txt file.',
      ],
    },
    features: [
      {
        title: 'Words, sentences or paragraphs',
        body: 'Ask for what your layout is measured in. Sentence and paragraph lengths vary the way real prose does, so a column of it looks like text rather than like a block.',
      },
      {
        title: 'The classic opening is optional',
        body: '"Lorem ipsum dolor sit amet" is instantly recognisable as filler — right when showing a client a layout, wrong when testing how ordinary prose wraps. It is a switch, and it is off by default.',
      },
      {
        title: 'HTML paragraphs on request',
        body: 'Wrapping each paragraph in a p tag is the one thing everyone does by hand after copying, so it is a toggle here.',
      },
      {
        title: 'No repeated words in a row',
        body: 'The generator will not place a word next to itself, which is the giveaway that makes cheaper filler look mechanical when you actually read it.',
      },
      {
        title: 'Generate again for a different draft',
        body: 'The same settings with a fresh draw, as many times as you like — useful when a particular paragraph happens to break awkwardly in your layout.',
      },
      {
        title: 'Runs in the page',
        body: 'No request, no delay, no limit on how many times you press the button, and it works with no connection.',
      },
    ],
    faq: [
      {
        q: 'What is lorem ipsum?',
        a: 'Scrambled Latin, derived from a first-century BC text by Cicero, used as placeholder copy since at least the 1500s. Its usefulness is that it has roughly the letter distribution and word lengths of European prose while carrying no meaning — so people look at the layout rather than reading the words.',
      },
      {
        q: 'Why not just type "text text text"?',
        a: 'Because repeated words produce an unnaturally even texture, and a designer judging line length, rag and colour is judging exactly that texture. Filler that reads like prose from three feet away is doing its job; filler that reads like a pattern is not.',
      },
      {
        q: 'Should I ever ship a page with lorem ipsum on it?',
        a: 'It happens constantly and it is always embarrassing. Search your codebase for "lorem" before a launch — and be aware that filler in a live page can be indexed, which occasionally puts nonsense Latin into a search result for a real business.',
      },
      {
        q: 'Is the text always the same?',
        a: 'No. Each press of "Generate again" produces a different draft from the same settings. The first draft on the page is fixed so it is identical for everyone who loads it, which keeps the page fast to render.',
      },
      {
        q: 'Can I get more than 500 paragraphs?',
        a: 'Not in one go. Five hundred is far past the point where placeholder text is telling you anything about a layout, and generating more mostly wastes your browser’s memory. Run it twice if you genuinely need a longer sample.',
      },
      {
        q: 'Is it free, and how much text can I generate?',
        a: 'Free, with no limit on paragraphs or regenerations. Nothing is counted and no trailing credit line is appended to the placeholder text — which would be a particularly annoying thing to find in a layout later.',
      },
      {
        q: 'Do I need an account, and is the text generated on a server?',
        a: 'No account, and no. The word list and the sentence assembly are both in the page, so it works with the internet disconnected and there is no request anywhere in the process.',
      },
      {
        q: 'Is a credit line or watermark added to the generated text?',
        a: 'No. What you copy is placeholder text and nothing else. A trailing credit line is a genuinely irritating thing to discover in a layout three weeks later, so nothing is appended.',
      },
    ],
    content: [
      {
        heading: 'What placeholder text is for',
        body: [
          'Filler exists to stop people reading. When a draft carries real copy, everyone in the room discusses the copy — and the question on the table was whether the column is too wide, whether the line height is right, whether the heading has enough room to breathe.',
          'That is why nonsense Latin works better than English nonsense: it has the right shape and no meaning at all. Word lengths and letter frequencies are close enough to English, French, German and Spanish that the block of text sits on the page the way real text will.',
          'It is also why filler should be honest about being filler in a client presentation. Text that could be mistaken for a draft of the real thing invites feedback on words nobody wrote.',
        ],
      },
      {
        heading: 'Choosing the right amount',
        body: [
          'Match the filler to the slot. A card that will hold two lines should be tested with two lines, and with three, because the interesting question is what happens when it overflows.',
          'For body copy, three or four paragraphs is usually enough to judge measure and rhythm; more of it tells you nothing new. For headings and buttons, the useful test is the longest plausible real string rather than an average one — a navigation item that fits at "Home" and breaks at "Frequently asked questions" is a bug waiting for launch day.',
          'And test with the shortest case too. Layouts that only look right when full are a common and avoidable failure.',
        ],
      },
      {
        heading: 'Why placeholder text is nonsense on purpose',
        body: [
          'Lorem ipsum is scrambled Latin, and the scrambling is the point. Real text is read, and a designer showing a layout with real sentences in it gets feedback on the sentences — the wording, the claims, the tone — rather than on the thing being reviewed, which is the shape of the page. Text you cannot read forces attention onto line length, spacing, hierarchy and rhythm.',
          'It also has the right texture. A block of English has a characteristic distribution of word lengths and a familiar rate of spaces, and Latin is close enough to it that a paragraph of lorem ipsum wraps and greys out on the page much as the real copy will. Repeating one word, or using random letters, does not — a column of “asdf asdf asdf” looks nothing like prose and will mislead you about how the layout breathes.',
          'The two habits worth keeping: use the amount of text the real content will actually be, because a design tested with three paragraphs and shipped with nine is a design that has not been tested; and never let placeholder text reach production. Searching a finished project for “lorem” before launch takes a second and has saved a great many people from a live page that opens with “dolor sit amet”.',
        ],
      },
    ],
    related: ['word-counter', 'case-converter', 'password-generator', 'slug-generator'],
    isNew: true,
    updated: '2026-09-10',
  },
];
