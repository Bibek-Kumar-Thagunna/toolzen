import type { Tool } from '../types';
import { ANY_FILE, TEXT_DOCUMENT } from '../../tools/accepts.ts';

/**
 * Developer tools: formatters and decoders.
 *
 * Every claim below was checked against the engine modules in
 * `src/lib/tools/dev`. If the code does not do it, the copy does not say it.
 */
export const developerTools: Tool[] = [
  {
    slug: 'json-formatter',
    name: 'JSON Formatter',
    h1: 'JSON Formatter and Validator',
    tagline: 'Make unreadable JSON readable, and find out exactly where a broken payload goes wrong.',
    category: 'developer',
    icon: 'braces',
    surface: 'text',
    processing: 'browser',
    metaTitle: 'JSON Formatter and Validator',
    metaDescription:
      'A JSON formatter that validates and minifies in your browser. Errors name the line and column, and large integer ids are checked for precision loss.',
    primaryKeyword: 'json formatter',
    secondaryKeywords: [
      'json validator',
      'json beautifier',
      'format json',
      'minify json',
      'pretty print json',
      'json syntax error',
    ],
    synonyms: [
      'json pretty printer',
      'json lint',
      'json viewer',
      'json parser',
      'json indenter',
      'json tidy',
      'json prettifier',
    ],
    // The how-to promises a file can be dropped on the input, so the limit that
    // promise implies is shared with the control that enforces it.
    accepts: TEXT_DOCUMENT,
    howTo: {
      title: 'How to format JSON',
      steps: [
        'Paste your JSON into the input panel, or drop a .json file onto it.',
        'Pick an indent of two spaces, four spaces or a tab, or choose minify for the smallest possible output.',
        'Turn on sort keys if you want a stable order for comparing two documents.',
        'Read any warnings under the output: duplicate keys and numbers that lost precision are listed there.',
        'Copy the result, or download it as a file.',
      ],
    },
    features: [
      {
        title: 'Errors that name the line, the column and the cause',
        body: 'A failed parse is explained by a scanner written for this tool rather than by the browser, so the wording is the same in Chrome, Safari and Firefox instead of three different sentences. You get the line and column, a snippet with a caret under the exact character, and a named cause: a trailing comma, a single-quoted string, an unquoted key, a comment, a stray NaN or None, or a bracket that was never closed.',
      },
      {
        title: 'A warning when a number will not survive the round trip',
        body: 'JavaScript holds every JSON number as a double, which carries about 15 to 17 significant digits, so a 19-digit order id changes value the moment it is parsed. Each numeric literal is compared with the value it actually parsed to, and any that differ are listed with their line and column, while cosmetic changes such as 1e2 becoming 100 are ignored.',
      },
      {
        title: 'Duplicate keys are pointed out rather than hidden',
        body: 'JSON permits the same key twice and JSON.parse keeps only the last value, discarding the earlier one without a word. Any object with a repeated key is reported after a successful parse, as is a byte order mark removed from the start of the input.',
      },
      {
        title: 'Indent, sort and minify',
        body: 'Pretty print JSON with two spaces, four spaces or a tab, or minify JSON to strip every optional byte. Sorting keys compares them by code unit rather than by locale, so the same input gives byte-identical output on every machine, and the serialiser uses an explicit stack instead of recursion, so a document thousands of levels deep is written out normally.',
      },
      {
        title: 'The size and shape of the document',
        body: 'A successful parse reports bytes in and bytes out, the nesting depth, and how many objects, arrays, keys and scalar values there are. It is the quickest way to tell whether a payload is large because it is long or because it is deep.',
      },
    ],
    faq: [
      {
        q: 'Why did my long id number change when I formatted the file?',
        a: 'Because JSON numbers become IEEE 754 doubles, which hold about 15 to 17 significant digits. An id such as 9007199254740993 comes back as 9007199254740992, and the change is silent everywhere except in the warning this tool shows. The fix is on the producing side: quote long ids so they travel as strings.',
      },
      {
        q: 'Is my JSON uploaded anywhere?',
        a: 'No. The parsing, formatting and validation all happen in this page, so the document never leaves your device and there is nothing on a server to log or delete. After the first visit the page also works with the network switched off.',
      },
      {
        q: 'Does it check my JSON against a schema?',
        a: 'No. As a JSON validator it checks syntax only: whether the text is JSON at all, and where it stops being JSON. It does not know which fields your API requires or what types they should have, so a document can be perfectly valid here and still be rejected by your service.',
      },
      {
        q: 'Can it read JSON with comments or trailing commas?',
        a: 'Not as valid input, because neither is legal JSON. A JSON syntax error caused by a comment or a trailing comma is named as exactly that, though, so the offending characters are easy to find and remove.',
      },
      {
        q: 'Does sorting keys change the meaning of my document?',
        a: 'For an object, no: key order carries no meaning in JSON, and consumers that depend on it are relying on an accident. Array order is different and is never touched. If the document is signed or hashed, sorting will change the bytes and therefore the signature.',
      },
      {
        q: 'Is the JSON formatter free, and is there a size limit?',
        a: 'Free, with a four-megabyte ceiling on a dropped file — which is about where a browser stops laying out one text box instantly rather than where a paid tier would start. Pasted text has no limit at all.',
      },
      {
        q: 'Do I need an account, and is my JSON sent to a server?',
        a: 'No account, and nothing is sent. This is the one worth checking on any formatter you use: JSON pasted into a debugging tool routinely contains API keys, tokens and customer records, and most online formatters post it to a backend.',
      },
      {
        q: 'Is there a watermark or a comment added to the formatted JSON?',
        a: 'No. What you copy out is valid JSON and nothing else — no credit comment at the top, no injected key. Some formatters add one, which then breaks strict parsers downstream.',
      },
    ],
    content: [
      {
        heading: 'What the error message is telling you',
        body: [
          'Browsers are unhelpful about broken JSON, and each one is unhelpful in its own way. The same missing comma produces three different messages in Chrome, Safari and Firefox, and none of them says which line to look at. This tool never shows you that message. When a parse fails, a second pass walks the text and works out what went wrong, then reports the line, the column, the byte offset and a short snippet with a caret under the exact character.',
          'Most real failures are one of a small set of mistakes, so the scanner names them: a comma before a closing brace, a string in single quotes, a key with no quotes at all, a JavaScript comment, a Python None or True, a hexadecimal number, a leading zero, an unterminated string, two values with no comma between them, or a container nobody closed. Where the cause implies an obvious repair, the message says what it is.',
          'That matters most with generated JSON. When a template or a string concatenation produces the document, the file can be tens of thousands of lines long and the mistake is a single character somewhere in the middle. A line number turns that from a hunt into a jump.',
        ],
      },
      {
        heading: 'Large integers and JavaScript numbers',
        body: [
          'JSON has one number type and JavaScript has one number type, and they are not the same. The specification puts no limit on the digits a JSON number may have, while JavaScript stores it as a 64-bit double with 53 bits of mantissa. Any integer above 9007199254740991 may therefore land on a nearby representable value instead of itself.',
          'This is not a hypothetical. Database bigints, Twitter-style snowflake ids and payment references are all routinely 18 or 19 digits, and all of them are quietly rounded by any service that parses JSON in JavaScript. The value looks plausible afterwards, which is what makes the bug expensive: nothing throws, and two systems simply disagree about which record you meant.',
          'Every literal is checked here, so the format step tells you which numbers changed and what they changed to. The durable fix belongs to whoever produces the JSON, and it is to send such ids as strings. Reading a rounded number back does not recover the original.',
        ],
      },
      {
        heading: 'Formatting, minifying and diffs',
        body: [
          'What a JSON beautifier is really doing is inserting whitespace, and whitespace between tokens carries no meaning in JSON. Pretty printing and minifying therefore produce the same document, and you can move between them as often as you like without changing what a consumer sees.',
          'Sorting keys is the useful trick for comparison. Two services that build the same object in different orders produce two files that differ on almost every line, and a diff of them tells you nothing. Sort both and the diff shrinks to the fields that genuinely differ. Because the sort compares code units rather than following locale rules, the same input produces the same bytes on every machine, which is what makes it safe to commit the output.',
        ],
      },
    ],
    related: ['base64-encoder', 'jwt-decoder', 'uuid-generator', 'case-converter'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'base64-encoder',
    name: 'Base64 Encoder',
    h1: 'Base64 Encoder and Decoder',
    tagline: 'Turn text or a file into Base64 and back, with the awkward cases explained rather than guessed at.',
    category: 'developer',
    icon: 'binary',
    surface: 'text',
    processing: 'browser',
    metaTitle: 'Base64 Encoder and Decoder',
    metaDescription:
      'A Base64 encoder and decoder that runs in your browser, including the URL-safe alphabet. Padding, line wrapping and binary files are all handled.',
    primaryKeyword: 'base64 encoder',
    secondaryKeywords: [
      'base64 decoder',
      'decode base64',
      'text to base64',
      'url-safe base64',
      'base64 padding',
      'base64url',
    ],
    synonyms: [
      'base64 converter',
      'base64 to text',
      'base 64 encode',
      'base64 translator',
      'b64 decoder',
      'base64 encode online',
    ],
    // The tagline offers to encode a file, so the tool needs a file policy. The
    // ceiling is low on purpose: the Base64 of a file is a third larger again,
    // and it has to fit in a textarea the browser can still lay out.
    accepts: ANY_FILE,
    howTo: {
      title: 'How to encode or decode Base64',
      steps: [
        'Paste your text into the input panel to convert text to Base64, or paste Base64 to turn it back; the tool guesses the direction and you can switch it.',
        'For a URL or a token, turn on the URL-safe alphabet, which uses - and _ in place of + and /.',
        'Choose whether to pad the output with = and whether to wrap it at 76 characters for email.',
        'Read the notes under the result: anything the decoder had to repair is listed there.',
        'Copy the output, or save it as a file if the decoded bytes are not text.',
      ],
    },
    features: [
      {
        title: 'Both alphabets, and a strict mode when it matters',
        body: 'Standard Base64 uses + and /, while URL-safe Base64 uses - and _ so the result survives a query string, a filename and a JWT. Decoding accepts either variant by default, because pasted Base64 is very often the wrong one, and strict mode is there for the times you need the distinction enforced.',
      },
      {
        title: 'Padding and line wrapping under your control',
        body: 'The = padding is on for standard output and off for URL-safe output, which matches what the specifications and real tokens do, and you can override either. Output can be wrapped at 76 characters, the line length RFC 2045 sets for email, with a choice of newline or carriage return and newline.',
      },
      {
        title: 'Every character, not just the Latin ones',
        body: 'Encoding goes through UTF-8 rather than the browser btoa function, which throws on any character above U+00FF. Emoji, Chinese, Arabic, combining accents and mathematical symbols all encode and decode back byte for byte.',
      },
      {
        title: 'A decoder that tells you what it repaired',
        body: 'Line breaks and spaces are ignored, missing = padding is added back, and a string that mixes both alphabets is still decoded. Every one of those repairs is reported instead of being made silently, and only two things are treated as fatal: a character that belongs to neither alphabet, and a length no Base64 string can have.',
      },
      {
        title: 'Binary is recognised rather than mangled',
        body: 'If the decoded bytes are not valid UTF-8 they are a file, not text, so the tool says so and offers a download instead of printing a screen of replacement characters. A leading byte order mark is kept so that decoding is exact, and mentioned in the notes because it breaks config files and CSV headers.',
      },
    ],
    faq: [
      {
        q: 'Is Base64 a form of encryption?',
        a: 'No. It is a way of writing bytes using 64 printable characters, and anyone who sees it can decode it in a second. It hides nothing, so a password or an API key in Base64 is a password or an API key in plain sight.',
      },
      {
        q: 'What is URL-safe Base64 for?',
        a: 'The + and / characters mean something in a URL, in a query string and in most filenames, so URL-safe Base64 substitutes - and _ and usually drops the = padding as well. JSON Web Tokens use this variant, which is why a token pasted into a strict Base64 decoder sometimes fails.',
      },
      {
        q: 'Why does it say my Base64 is a file and refuse to show it?',
        a: 'Because the bytes it decoded to are not valid UTF-8 text, which almost always means the original was an image, a PDF, an archive or an encrypted blob. Showing it as text would fill the panel with U+FFFD characters and imply that is the content, so it is offered as a download instead.',
      },
      {
        q: 'My Base64 had the wrong amount of padding and it decoded anyway. Is that right?',
        a: 'It is intentional. The padding carries no information that the length does not already give away, so it is recalculated from the data and the discrepancy is reported as a note. Only a length that is one character past a multiple of four is genuinely impossible, and that is refused.',
      },
      {
        q: 'Does the text I paste get sent to a server?',
        a: 'No. Encoding and decoding both run in this page, so nothing is transmitted and nothing is stored. That is also why there is no size limit beyond what your browser can hold in memory.',
      },
      {
        q: 'Is it free, and is there a limit on what I can encode?',
        a: 'Free, with an eight-megabyte ceiling per file because the encoded result is a third larger again and has to sit in a text box. Text you paste in has no limit, and nothing is metered.',
      },
      {
        q: 'Do I need an account, and is my data uploaded?',
        a: 'No account, and no. Base64 is what people reach for when moving credentials, certificates and small binaries around, so the encoding is done by your browser’s own routine and the data never becomes a request.',
      },
      {
        q: 'Is anything appended to the encoded output?',
        a: 'No — no watermark, no trailing marker, no line of attribution. The output is exactly the Base64 of your input, which matters because anything extra makes it decode to the wrong bytes.',
      },
    ],
    content: [
      {
        heading: 'What Base64 is actually for',
        body: [
          'Base64 exists because a great many channels only carry text. Email bodies, JSON strings, XML attributes, HTTP headers, CSS files and QR codes all have opinions about which bytes are allowed, and arbitrary binary data breaks them. Base64 maps every three bytes onto four printable characters, so any file can travel through a text-only pipe and come out unchanged.',
          'The cost is size. Four characters for every three bytes is a third larger before any line breaks are added, which is why a data URI for a large image bloats a stylesheet and why sending attachments this way is more expensive than it looks. It is a transport encoding, not a compression format.',
          'The most common places you will meet it are data URIs in CSS and HTML, credentials in an HTTP Basic Authorization header, keys and certificates in PEM files, and the three parts of a JSON Web Token. In each case the point is the same: get bytes through a place that only accepts characters.',
        ],
      },
      {
        heading: 'The two alphabets, padding, and why decoding is forgiving',
        body: [
          'The first 62 symbols are the same everywhere: A to Z, a to z and 0 to 9. Only the last two differ. Standard Base64 finishes with + and /, which is fine in an email body and awkward in a URL, where + means a space and / separates path segments. URL-safe Base64 uses - and _ instead, and the two are otherwise identical, so a string in the wrong variant is still decodable once you swap those characters.',
          'Base64 padding is the other difference you will notice. Because the encoder works in groups of three bytes, a final group of one or two bytes leaves spare room, and standard Base64 fills it with one or two = characters so the length is always a multiple of four. Base64URL usually omits them, since = has to be percent-encoded in a URL.',
          'The decoder here is deliberately tolerant, because the input is nearly always something a person copied out of a log file, a header or an email that had been wrapped at 76 characters. Whitespace is dropped, absent padding is reconstructed, mixed alphabets are accepted, and each of those repairs is listed under the result so you can see what the original was missing. What it will not do is silently invent data: an impossible length, or a character from no alphabet at all, is reported as an error.',
        ],
      },
    ],
    related: ['jwt-decoder', 'json-formatter', 'image-compressor', 'url-encoder'],
    updated: '2026-09-03',
  },
  {
    slug: 'jwt-decoder',
    name: 'JWT Decoder',
    h1: 'JWT Decoder and Claim Inspector',
    tagline: 'See what is actually inside a token, when it expires, and why a server might be rejecting it.',
    category: 'developer',
    icon: 'key',
    surface: 'text',
    processing: 'browser',
    metaTitle: 'JWT Decoder and Claims Inspector',
    metaDescription:
      'A JWT decoder that reads the header and payload in your browser, explains every claim in plain words, and checks an HS256 signature with your own secret.',
    primaryKeyword: 'jwt decoder',
    secondaryKeywords: [
      'decode a jwt',
      'json web token',
      'jwt claims',
      'jwt expiry',
      'jwt signature',
      'hs256',
    ],
    synonyms: [
      'jwt viewer',
      'jwt parser',
      'json web token decoder',
      'jwt inspector',
      'bearer token decoder',
      'jwt reader',
    ],
    howTo: {
      title: 'How to decode a JWT',
      steps: [
        'Paste the token into the input panel. A leading "Bearer ", surrounding quotes and line breaks are stripped for you.',
        'Read the header and payload panels for the raw JSON, and the claim table for what each claim means.',
        'Check the JWT expiry line, which reads either how long ago the token expired or how much longer it is good for.',
        'To verify an HS256, HS384 or HS512 signature, enter the shared secret in the verification box.',
      ],
    },
    features: [
      {
        title: 'Every claim, written out in words',
        body: 'The registered JWT claims are listed with what they mean rather than what they contain: iss, sub, aud, azp, scope, kid, jti and typ in plain language, and iat, nbf and exp as readable times. An expiry reads "expired 3 days ago" or "valid for another 12 minutes", with the exact timestamp beside it.',
      },
      {
        title: 'Decoding is separated from verifying, on purpose',
        body: 'The first thing the tool says about any token is that decoding proves nothing about it, because the header and payload are only Base64URL and anyone can rewrite them. That warning stays until you supply a secret and a signature check actually passes.',
      },
      {
        title: 'HMAC verification with your own secret',
        body: 'HS256, HS384 and HS512 are verified in the page using Web Crypto, and the result is compared in constant time so the comparison itself leaks nothing. RS256, PS256, ES256 and the rest are refused rather than faked: verifying those needs the issuer public key from its JWKS endpoint, which is work for your server, not a web page.',
      },
      {
        title: 'The dangerous header is flagged as an error',
        body: 'A token whose algorithm is "none" is unsigned, and libraries that accepted such tokens gave away the best known attack on JWT. The tool marks that header as an error rather than a curiosity, and does the same for a token carrying five segments, which is an encrypted JWE whose contents cannot be read without the key.',
      },
      {
        title: 'The quiet mistakes, called out',
        body: 'A token with no exp claim can be replayed indefinitely; an exp that falls before its own iat is contradictory; a timestamp in milliseconds instead of seconds puts the expiry in the year 56000. Each of those is reported, along with a token over 8192 bytes, which will not fit a 4 KB cookie and may exceed a server 8 KB header limit.',
      },
      {
        title: 'Tolerant about how tokens get copied',
        body: 'Tokens arrive with an Authorization prefix, wrapped in JSON quotes, or broken across lines by a terminal. All three are cleaned up before decoding and each change is noted, so you can tell the difference between a token that was mangled in transit and one that was always malformed.',
      },
    ],
    faq: [
      {
        q: 'Does a successful decode mean the token is valid?',
        a: 'No, and this is the single most common misunderstanding about JWT. The header and payload are Base64URL, not encryption, so anyone can read them and anyone can produce a token that decodes cleanly. Only a signature check against the right key says anything about authenticity, and this page can only do that for HMAC algorithms.',
      },
      {
        q: 'Can it verify an RS256 or ES256 token?',
        a: 'No. Those are signed with a private key and verified with the matching public key, which normally has to be fetched from the issuer /.well-known/jwks.json and matched by the kid in the header. The tool decodes and inspects such tokens fully, but says plainly that it has not verified them.',
      },
      {
        q: 'Is it safe to paste a real token here?',
        a: 'The token is decoded by code running in your tab and there is no network request involved, which you can confirm for yourself in the network panel of your developer tools. A signing secret is a different matter: do not paste a production secret into any web page you do not control, including this one, and treat one that has been pasted anywhere as a secret due for rotation.',
      },
      {
        q: 'Why does it say expired when my API still accepts the token?',
        a: 'The expiry is compared against your own device clock, and most servers allow a small amount of leeway for clock skew, commonly 30 to 60 seconds. If the difference is larger than that, one of the two clocks is wrong, which is also why an iat in the future is flagged.',
      },
      {
        q: 'What does the alg none header mean?',
        a: 'It means the token claims to need no signature at all. Several libraries once honoured that claim, so an attacker could take a valid token, change the payload, set alg to none and be believed. Any modern verifier rejects it, and so does this tool.',
      },
      {
        q: 'Is the JWT decoder free, and is there any limit?',
        a: 'Free and unlimited. Decode as many tokens as you like — there is no per-day count, because there is no account to count against and nothing that persists between page loads.',
      },
      {
        q: 'Do I need an account, and is my token sent anywhere?',
        a: 'No account, and the token never leaves the page. This is the single most important thing about a JWT tool: a token pasted into a website that posts it to a server has been handed to that server, and it is a live credential until it expires.',
      },
    ],
    content: [
      {
        heading: 'Decoding and verifying are different operations',
        body: [
          'A JSON Web Token is three pieces of Base64URL separated by dots: a header, a payload and a signature. The first two are not encrypted and were never meant to be. Reading them requires no key, no permission and no tooling beyond a Base64 decoder, which is why a token should never carry anything you would mind the holder seeing.',
          'The JWT signature is the part that carries the security, and checking it requires the key. With HS256 the key is a secret shared between the issuer and the verifier, so both sides can compute the same value. With RS256 and ES256 the issuer signs with a private key and everybody else verifies with the matching public key, which is what allows a token to be checked by services the issuer has never spoken to.',
          'This page decodes any token and verifies only the HMAC family, and it says which of the two it has done. That distinction is worth insisting on, because a decoder that renders a payload in neat colours can leave the impression that the token has been vouched for. It has not. If the wording here ever feels repetitive, the alternative was worse.',
        ],
      },
      {
        heading: 'Reading exp, nbf and iat',
        body: [
          'All three are numeric dates, and the specification is specific about the unit: seconds since 1970, not milliseconds. Getting that wrong is the most common bug in hand-rolled token code, because Date.now() in JavaScript returns milliseconds, and a token issued that way appears to expire tens of thousands of years from now. Any timestamp large enough to be milliseconds is called out here.',
          'exp is the expiry, and a verifier is expected to reject the token afterwards. nbf is the opposite end, marking a token issued now but not usable until later, which is unusual enough that its presence is worth noticing. iat is when the token was issued, and it is also how a server implements "log everybody out": reject any token issued before a cut-off.',
          'A token with no exp at all is the case to watch. Nothing in the format requires one, and a signature does not stop working, so such a token is valid for as long as the signing key is, which may be years. Anyone who obtains a copy can use it for that whole period.',
        ],
      },
    ],
    related: ['base64-encoder', 'json-formatter', 'uuid-generator', 'password-generator', 'url-encoder'],
    updated: '2026-09-03',
  },
  {
    slug: 'uuid-generator',
    name: 'UUID Generator',
    h1: 'UUID Generator',
    tagline: 'Mint identifiers you can rely on being unique, in the exact format your database or API expects.',
    category: 'developer',
    icon: 'hash',
    surface: 'form',
    processing: 'browser',
    metaTitle: 'UUID Generator: v4, v7, NanoID',
    metaDescription:
      'A UUID generator for version 4 and version 7 in bulk, plus NanoID and ObjectId, using your browser’s own cryptographic random source. Free and unlimited.',
    primaryKeyword: 'uuid generator',
    secondaryKeywords: [
      'v4 uuid',
      'v7 uuid',
      'random uuid',
      'guid',
      'nanoid',
      'generate a uuid',
    ],
    synonyms: [
      'guid generator',
      'unique id generator',
      'uuid maker',
      'random id generator',
      'uuid4 generator',
      'objectid generator',
      'uuid creator',
    ],
    howTo: {
      title: 'How to generate a UUID',
      steps: [
        'Choose the version you need: v4 for a purely random id, or v7 for one that sorts by the time it was created.',
        'Set how many you want, up to ten thousand at a time.',
        'Adjust the written form if your target needs it: uppercase, curly braces, or no hyphens at all.',
        'Copy a single id, or copy the whole batch as a list.',
        'To examine an id you already have, paste it into the inspector to see its version, variant and, where one exists, its creation time.',
      ],
    },
    features: [
      {
        title: 'Version 4 and version 7',
        body: 'A v4 UUID is 122 random bits and nothing else, which is what you want when the id must reveal nothing at all: a random UUID gives away neither when nor where it was made. A v7 begins with the Unix time in milliseconds, so a list of them sorts into creation order as plain text and a database index on the column stays compact instead of fragmenting.',
      },
      {
        title: 'Version 7 stays ordered inside the same millisecond',
        body: 'Two v7 UUIDs minted in the same millisecond would otherwise differ only in their random tail and land in arbitrary order, which defeats the point. The twelve bits after the version hold a counter that increments for each id in that millisecond, the monotonic method described in RFC 9562, and a clock that jumps backwards cannot make the sequence go down.',
      },
      {
        title: 'Random bits come from the platform CSPRNG',
        body: 'Every value is drawn from crypto.getRandomValues, the cryptographically secure generator your browser provides. Math.random is never called anywhere in the code: it is a fast, predictable PRNG whose stream can be reconstructed from a handful of samples, which is not a basis for an identifier.',
      },
      {
        title: 'Bulk generation and the written form you need',
        body: 'Generate up to ten thousand ids in one go, in lowercase hyphenated form or with uppercase hex, wrapped in the curly braces Windows and C# tooling prints for a GUID, or as 32 bare digits with no hyphens. The nil UUID of all zeros and the max UUID of all f characters are available too, since both are defined constants rather than values you can generate.',
      },
      {
        title: 'An inspector for ids you already have',
        body: 'Paste any UUID, in any of those written forms or as a urn:uuid: URI, and it reports the version, the variant, the canonical lowercase form to store, and a note about what that version implies. For versions 1, 6 and 7 it also recovers the creation time, because those three carry one.',
      },
      {
        title: 'NanoID and ObjectId as well',
        body: 'A NanoID at its default 21 characters carries about 126 bits over a 64-symbol URL-safe alphabet, slightly more than a v4 in far less space, and its draws use rejection sampling so no symbol is favoured. The ObjectId option produces the 24 hex characters MongoDB uses: four bytes of Unix seconds, five bytes fixed for the life of the page, and a three-byte counter.',
      },
    ],
    faq: [
      {
        q: 'Which version should I pick?',
        a: 'If the ids will be stored in a database and read back in order, v7 is the easier one to live with, because sorting the text sorts by age and inserts land at the end of the index. If the id will be exposed publicly and must not hint at when a record was created, v4 gives away nothing.',
      },
      {
        q: 'Can two UUIDs come out the same?',
        a: 'Nothing forbids it, but 122 random bits make it a non-issue in practice: you would need to generate billions of ids per second for a very long time before a collision became likely. The realistic risks are a broken random source or an id truncated on the way into a column, not the mathematics.',
      },
      {
        q: 'Can I find out when a v4 UUID was created?',
        a: 'No, and that is the point of it. A v4 contains no timestamp, no counter and no machine identifier, only randomness and the six bits that record its version and variant. If you need the time, generate a v7 instead.',
      },
      {
        q: 'Why can it not generate a version 1, 3 or 5 UUID?',
        a: 'Version 1 embeds the network card address of the machine that made it and gives away more than most people intend. Versions 3 and 5 are hashes of a name inside a namespace, so they need that namespace as input and are not random at all. The inspector reads all of them; the generator deliberately offers the two versions worth choosing today.',
      },
      {
        q: 'Are the ids generated on a server?',
        a: 'No. They are produced in your tab by your own browser, so no list of them exists anywhere and none of them has been transmitted. That also means a v7 timestamp reflects your device clock.',
      },
      {
        q: 'Is the UUID generator free, and how many can I generate?',
        a: 'Free, and as many as you want in a sitting. There is no daily allowance, because nothing identifies you between visits — the only limit is how many your browser will write into the box at once.',
      },
      {
        q: 'Do I need an account, and are the UUIDs generated on a server?',
        a: 'No account, and no. They come from your browser’s cryptographic random source in the page, which means nobody else has ever seen the identifiers you just produced — not a log file, not a queue, not us.',
      },
    ],
    content: [
      {
        heading: 'What a UUID actually is',
        body: [
          'A UUID is 128 bits, written as 32 hexadecimal digits in five hyphenated groups. Six of those bits are not free: four record the version and two record the variant, which is why the third group of a v4 always starts with 4 and the fourth always starts with 8, 9, a or b. The remaining 122 bits are where a v4 puts its randomness.',
          'The reason to use one at all is that it can be created without asking anybody. Two services with no connection between them, or a mobile app that is currently offline, can each mint an id and be confident it will not clash with anything, which is not true of a database sequence. That independence is the whole feature.',
          'The costs are worth knowing. Sixteen bytes is four times an integer key, the text form is 36 characters, and a random id scattered across an index makes writes more expensive than sequential ones. Version 7 exists precisely to remove that last problem while keeping the first advantage.',
        ],
      },
      {
        heading: 'Randomness, and why the source matters',
        body: [
          'An identifier built from Math.random is not unique in any sense you can rely on. It is a small, fast, non-cryptographic generator: its output is predictable from a few samples, and two tabs can end up drawing from the same stream. Every value here comes from crypto.getRandomValues instead, which is the interface browsers expose to the operating system entropy pool.',
          'The browser also offers crypto.randomUUID, which is a perfectly good v4. It is not used here for two practical reasons: it is unavailable on an insecure origin, which rules out a good deal of local network development over plain http, and it cannot produce a v7. Assembling the bytes directly means one code path serves every version.',
          'Where an id is also a secret, such as an invitation link or a password reset token, remember that a v4 is designed to be unguessable but is not designed to be secret. It appears in logs, in browser history and in analytics. A dedicated random token, generated and stored deliberately, is the better fit for that job.',
        ],
      },
    ],
    related: ['password-generator', 'json-formatter', 'slug-generator', 'qr-code-generator'],
    updated: '2026-09-03',
  },

  {
    slug: 'url-encoder',
    name: 'URL Encoder',
    h1: 'URL encoder and decoder',
    tagline: 'Percent-encode a value, decode a mangled link, or pull a long URL apart.',
    category: 'developer',
    icon: 'globe',
    surface: 'text',
    processing: 'browser',
    metaTitle: 'URL Encoder and Decoder',
    metaDescription:
      'A URL encoder and decoder that also inspects an address parameter by parameter. Explains the difference between encoding a value and encoding a whole link.',
    primaryKeyword: 'url encoder',
    secondaryKeywords: [
      'url decode',
      'percent encoding',
      'encodeuricomponent',
      'query string parser',
      'decode a link',
    ],
    synonyms: [
      'url decoder',
      'urlencode',
      'escape url',
      'unescape url',
      'decode percent signs',
      'query parameter viewer',
      'uri encoder',
    ],
    howTo: {
      title: 'How to encode or decode a URL',
      steps: [
        'Choose Encode, Decode, or Inspect a URL.',
        'Paste your text or address into the box.',
        'When encoding, say whether it is a whole address or a value going inside one.',
        'Copy the result, or read the parameter table if you are inspecting.',
      ],
    },
    features: [
      {
        title: 'Encoding a value and encoding an address are different',
        body: 'A value must not be able to invent new URL structure, so its slashes and ampersands are escaped. An address must keep them. The tool asks which you mean instead of picking one and hoping.',
      },
      {
        title: 'Decoding says what looked wrong',
        body: 'Real URLs are full of half-encoded text — a stray percent sign, a double-encoded value, bytes that are not valid UTF-8. It decodes what it can and describes the rest, because refusing the input tells you nothing about the string you are holding.',
      },
      {
        title: 'The inspector answers the real question',
        body: 'Paste a long tracking link and every query parameter is listed with its decoded value, alongside the scheme, host, port, path and fragment. "What is actually in this link" is usually what you wanted to know.',
      },
      {
        title: 'Plus-for-space is a switch, not a guess',
        body: 'An HTML form sends a space as a plus sign; in a path segment a plus is a literal plus. Both are correct in their own place, so the choice is yours and it only appears where it applies.',
      },
      {
        title: 'Nothing is uploaded',
        body: 'Encoding happens in this page. That matters here more than usual — the strings people decode are often signed links, session tokens and internal addresses.',
      },
    ],
    faq: [
      {
        q: 'What is the difference between encodeURI and encodeURIComponent?',
        a: 'encodeURIComponent escapes the punctuation that gives a URL its structure, because a value inside an address must not be able to create new structure. encodeURI leaves that punctuation alone, because it is escaping the address itself. Using the second on a value is how a search term containing an ampersand silently becomes two query parameters.',
      },
      {
        q: 'Why does my decoded text still contain % signs?',
        a: 'Almost always because it was encoded twice. A percent sign that is itself encoded becomes %25, so one pass leaves you with %20 as literal text. Decode again and it resolves — the warnings under the result point this out when they see it.',
      },
      {
        q: 'Is + a space or a plus sign?',
        a: 'It depends entirely on where it appears. In a query string produced by an HTML form it means a space. In a path segment, or in a data URI, it is a literal plus. Getting this backwards corrupts base64 values, which is why it is a switch here rather than a default.',
      },
      {
        q: 'Which characters actually need encoding?',
        a: 'Anything outside the unreserved set — letters, digits, and the characters hyphen, underscore, full stop and tilde — plus every reserved character when it appears in a position where it would otherwise be structural. Everything else, including every non-English character, is encoded as its UTF-8 bytes.',
      },
      {
        q: 'Does this work with non-English text?',
        a: 'Yes. Text is converted to UTF-8 bytes and each byte is percent-encoded, which is the standard behaviour — so a single accented letter usually becomes two escapes and an emoji becomes four.',
      },
      {
        q: 'Is it free, and is there a limit on the URL encoder?',
        a: 'Free with no limit and no watermark. Encode, decode and inspect as many addresses as you want; nothing is counted and there is no paid tier that unlocks longer input.',
      },
      {
        q: 'Do I need an account, and is the address uploaded?',
        a: 'No account, and nothing is submitted. URLs carry session tokens, signed links and tracking parameters in their query strings, so the encoding and the inspection both happen in the page and no address is logged.',
      },
    ],
    content: [
      {
        heading: 'Why URLs need encoding at all',
        body: [
          'A URL is a structured string, and a small set of characters carry that structure: the colon after the scheme, the slashes between path segments, the question mark that starts the query, the ampersands between parameters, the hash before the fragment.',
          'The moment a piece of data containing one of those characters is dropped into a URL, the structure changes meaning. A search for "cats & dogs" pasted raw into a query string becomes two parameters, one of them called " dogs". Percent-encoding exists to make data inert: each byte becomes a percent sign and two hex digits, which no parser mistakes for punctuation.',
          'This is also a security boundary rather than a formatting nicety. A great many injection bugs begin with a value that was allowed to add structure to a URL it was only supposed to sit inside.',
        ],
      },
      {
        heading: 'Reading a link somebody sent you',
        body: [
          'Marketing and redirect links are frequently a URL wrapped inside another URL, with the inner one encoded so it survives the trip. The inspector unwraps the first layer and shows you each parameter decoded, which is usually enough to see where a link really goes before you follow it.',
          'The things worth looking for are a parameter holding a full http address, which means a redirect; parameters that identify you rather than the content; and a fragment, which is never sent to the server and is often where a single-page application keeps its state.',
          'Everything here runs on your device, so inspecting a link does not involve visiting it or handing it to anyone.',
        ],
      },
    ],
    related: ['base64-encoder', 'json-formatter', 'slug-generator', 'jwt-decoder'],
    isNew: true,
    updated: '2026-09-10',
  },
];
