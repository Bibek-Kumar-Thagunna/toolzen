import type { Tool } from '../types';

/**
 * Registry entries for the text category.
 *
 * The engines behind these four are src/lib/tools/text/counter.ts and
 * sentences.ts (word counter), case.ts (case converter), lines.ts (duplicate
 * removal and sorting) and slug.ts (slug generation). Specific numbers below —
 * 238 and 140 words per minute, ten keyword rows, twelve case modes, the
 * transliteration tables — are read from those files rather than assumed, and
 * the copy has to change if they do.
 */
export const textTools: Tool[] = [
  {
    slug: 'word-counter',
    name: 'Word Counter',
    h1: 'Count words and characters',
    tagline: 'See the length of your text the way the thing measuring it will see it.',
    category: 'text',
    icon: 'list',
    surface: 'text',
    processing: 'browser',
    metaTitle: 'Word Counter — Characters and Words',
    metaDescription:
      'Count words, characters, sentences and paragraphs as you type, with reading time, keyword density and the longest word. Nothing is sent anywhere.',
    primaryKeyword: 'word counter',
    secondaryKeywords: [
      'character count',
      'word count',
      'reading time',
      'keyword density',
      'sentence count',
      'paragraph count',
    ],
    synonyms: [
      'count words',
      'character counter',
      'letter count',
      'how many words',
      'text statistics',
      'count characters online',
      'word count tool',
      'words and characters',
    ],
    howTo: {
      title: 'How to count words and characters',
      steps: [
        'Type into the box, or paste the text you want to measure.',
        'Read the counts as they update — words, characters, sentences, paragraphs and lines.',
        'Check the keyword list to see which words you repeat most.',
        'Edit the text and watch the numbers follow.',
      ],
    },
    features: [
      {
        title: 'Three answers to “how many characters”',
        body: 'The plain character count is in UTF-16 units, which is what a form limit or a database column measures. Code points and grapheme clusters are shown beside it, because for emoji and accented text those three numbers genuinely differ.',
      },
      {
        title: 'Words counted the way a proofreader would',
        body: 'Words are whitespace-separated tokens with punctuation trimmed from the edges, so “(hello)” matches hello, while well-known and don’t each stay one word. Unique words are compared case-insensitively.',
      },
      {
        title: 'Sentence counting that survives abbreviations',
        body: 'A full stop inside 3.5, after Dr. or e.g., or between initials does not end a sentence. Terminators are the full stop, exclamation mark, question mark and ellipsis, and a closing quote or bracket may sit between the terminator and the space.',
      },
      {
        title: 'Reading time from a measured figure',
        body: 'Reading time uses 238 words per minute, the mean for silent reading of English prose in a 2019 meta-analysis of 190 studies, rather than the round 200 most counters assume. Speaking time uses 140 words per minute.',
      },
      {
        title: 'Keyword density without the noise',
        body: 'The ten most frequent words of three letters or more, with counts and percentages to two decimals. Grammar words such as the and which are excluded; content words never are, so a document about time still reports time.',
      },
      {
        title: 'Fast, and entirely local',
        body: 'The text is analysed in the page as you type — a 200,000-word document takes tens of milliseconds. There is no request, so an unpublished draft or a client’s copy stays where it is.',
      },
    ],
    faq: [
      {
        q: 'Which character count do I actually want?',
        a: 'For a form limit, a database column or a 280-character post, the plain character count: it counts UTF-16 units, which is what those limits enforce. For “how long does this read”, graphemes are closer, because a flag emoji or a Devanagari cluster looks like one character and occupies several units.',
      },
      {
        q: 'How is reading time worked out?',
        a: 'Words divided by 238 per minute, reported in whole seconds. It describes an adult silently reading prose, so it will overstate a familiar text and understate dense technical writing, code or a table of figures quite badly.',
      },
      {
        q: 'Does it count words in Chinese or Japanese?',
        a: 'Not usefully. Words are found by splitting on whitespace, and those scripts do not put spaces between words, so a whole sentence can register as a single word. Use the character and code point counts instead.',
      },
      {
        q: 'Why is the paragraph count lower than I expected?',
        a: 'A paragraph here is a run of non-empty lines bounded by blank lines. Text with single line breaks and no blank line between them is one paragraph however many lines it occupies, and whitespace alone is never a paragraph.',
      },
      {
        q: 'Is a hyphenated word one word or two?',
        a: 'One. Only punctuation at the edges of a token is trimmed, so well-known stays whole. A lone hyphen surrounded by spaces counts as nothing, because after trimming there is no word left of it.',
      },
      {
        q: 'Is my text stored anywhere?',
        a: 'No. It lives in the page while the tab is open and goes when you close it. There is no upload, no draft saved on a server and nothing logged.',
      },
    ],
    content: [
      {
        heading: 'Character counts disagree for good reasons',
        body: [
          'A “character” is three different things as soon as text leaves plain English. The number a form validates against is usually UTF-16 units, which is what a string length reports and what a varchar column measures. A code point is one Unicode scalar. A grapheme cluster is what a reader would point at and call a character.',
          'The three coincide for ASCII and diverge quickly. An emoji with a skin-tone modifier is one grapheme, several code points and more UTF-16 units again; an accented letter typed as a base letter plus a combining mark is one grapheme and two code points. Showing all three lets you answer the question you have rather than the one a single number happens to answer.',
        ],
      },
      {
        heading: 'What word count is and is not good for',
        body: [
          'Word count is a fair proxy for effort and a poor proxy for space on a page. Font, type size and images decide how much room 500 words occupy, which is why publishers who care about layout brief in characters instead.',
          'Where it earns its keep is targets and limits: an 800-word article, a 150-word abstract, a 2,000-word chapter. For those, the definition of a word matters — whitespace-separated tokens with edge punctuation removed — because a numbered list or a run of citations inflates the total in a way prose does not.',
        ],
      },
      {
        heading: 'Keyword density, kept in proportion',
        body: [
          'The keyword table is for noticing repetition, not for hitting a number. Search engines stopped rewarding a particular density many years ago, and writing towards one produces text that reads exactly as though it were written towards one.',
          'It is genuinely useful for catching the word you have used eleven times in four paragraphs, and for checking that the subject of the page appears on it at all. Grammar words are excluded so the table says something; anything of three letters or more that is not one is eligible.',
        ],
      },
    ],
    related: ['case-converter', 'remove-duplicate-lines', 'slug-generator'],
    popular: true,
    updated: '2026-09-03',
  },
  {
    slug: 'case-converter',
    name: 'Case Converter',
    h1: 'Convert text case',
    tagline: 'Retype nothing: put a heading, a list or a variable name into the case you need.',
    category: 'text',
    icon: 'type',
    surface: 'text',
    processing: 'browser',
    metaTitle: 'Case Converter — 12 Case Styles',
    metaDescription:
      'Convert text between twelve case styles: lowercase, UPPERCASE, Title Case, Sentence case, camelCase, snake_case, kebab-case and more. Instant, local.',
    primaryKeyword: 'case converter',
    secondaryKeywords: [
      'convert to uppercase',
      'title case',
      'sentence case',
      'camelCase',
      'snake_case',
      'kebab-case',
    ],
    synonyms: [
      'change text case',
      'uppercase converter',
      'lowercase converter',
      'capitalise text',
      'text case changer',
      'convert case online',
      'pascal case',
      'constant case',
    ],
    howTo: {
      title: 'How to convert text case',
      steps: [
        'Paste your text into the box.',
        'Pick a case from the list — each option shows a worked example of what it produces.',
        'Copy the result, or choose another case to compare.',
      ],
    },
    features: [
      {
        title: 'Twelve cases, one click each',
        body: 'lowercase, UPPERCASE, Title Case, Sentence case, camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case, dot.case, aLtErNaTiNg cAsE and iNVERSE cASE. Every example shown next to a mode is produced by running the real converter, so a label cannot misdescribe its output.',
      },
      {
        title: 'Prose modes leave formatting alone',
        body: 'lowercase, UPPERCASE, Title Case, Sentence case, alternating and inverse change letters and nothing else. Punctuation, runs of spaces and the original line endings all come back untouched, so a document stays laid out as it was.',
      },
      {
        title: 'Identifier modes produce identifiers',
        body: 'camelCase, PascalCase, snake_case, CONSTANT_CASE, kebab-case and dot.case discard everything that is not a letter or a digit and flatten line breaks, because that is what makes the result usable as a name in code.',
      },
      {
        title: 'Word splitting that understands acronyms',
        body: 'parseHTMLDocument becomes parse, HTML, Document rather than five fragments, so snake_case gives parse_html_document. Applying an identifier mode a second time changes nothing.',
      },
      {
        title: 'Sentence case that knows its abbreviations',
        body: 'It shares a sentence splitter with the word counter, so a full stop in 3.5, after Dr. or between initials does not trigger a capital in the middle of a sentence.',
      },
      {
        title: 'Acronyms survive Title Case',
        body: 'NASA and API keep their shape when the text has lowercase letters elsewhere. Text that is entirely uppercase is read as shouting rather than as a run of acronyms, and is recased.',
      },
    ],
    faq: [
      {
        q: 'What is the difference between Title Case and Sentence case?',
        a: 'Title Case capitalises the significant words in a line — “The Rise of the Machines”. Sentence case capitalises the first word of each sentence and leaves the rest — “The rise of the machines”. Newspapers favour the first; most style guides prefer the second for headings.',
      },
      {
        q: 'Will camelCase keep my punctuation?',
        a: 'No, and it should not. The identifier modes exist to produce names a compiler will accept, so spaces, punctuation and line breaks are removed and the words joined. Use one of the six prose modes when punctuation has to survive.',
      },
      {
        q: 'Which short words stay lowercase in Title Case?',
        a: 'A short conventional list — a, an, the, and, but, or, for, nor, of, in, on, at, to, from, by, with, as, per, via — and only when they are neither the first nor the last word of the line. Style guides disagree about the longer prepositions, so check the result against yours.',
      },
      {
        q: 'Does it handle accented letters and other scripts?',
        a: 'The prose modes use the browser’s own case rules, so é becomes É. Identifier modes keep letters and digits from any script, which means an accented word survives in camelCase even though your compiler may object to it.',
      },
      {
        q: 'Is the conversion reversible?',
        a: 'Only sometimes. Convert to uppercase and back to lowercase and you lose which letters were capitals, and snake_case discards punctuation permanently. Keep your original text; nothing here writes over it.',
      },
      {
        q: 'Is there a length limit?',
        a: 'None fixed. Conversion happens in the page, so the limit is what your browser will hold; ordinary documents convert as fast as you can click.',
      },
    ],
    content: [
      {
        heading: 'Prose modes and identifier modes are different tools',
        body: [
          'The first six cases are for writing. They alter letters and touch nothing else, so your punctuation, double spaces and line breaks come back exactly as they went in and a recased paragraph is still a paragraph.',
          'The other six exist to produce a name that a compiler, a shell or a URL will accept, which means discarding anything that is not a letter or a digit and joining the words up. “Order #12: shipped” becomes order12Shipped. Running the same mode again changes nothing, so it is safe to apply across a list of inconsistent input.',
          'Word boundaries come from the shape of the text, not from spaces alone: a switch from lowercase to uppercase begins a new word, and a run of capitals followed by a capitalised word is read as an acronym plus a word. That is why parseHTMLDocument splits into three pieces rather than five.',
        ],
      },
      {
        heading: 'Which convention goes where',
        body: [
          'camelCase and PascalCase differ only in the first letter, and the language decides which you want: JavaScript and Java use camelCase for variables and PascalCase for types, Python and Rust use snake_case for variables, CSS and HTML attributes use kebab-case, and environment variables use CONSTANT_CASE.',
          'Title Case is the one with real disagreement behind it. Guides differ over which short words stay lowercase and how to treat longer prepositions, so the list used here is deliberately the short conventional one. Read the output rather than trusting any tool to speak for your house style.',
        ],
      },
    ],
    related: ['slug-generator', 'word-counter', 'remove-duplicate-lines', 'json-formatter'],
    updated: '2026-09-03',
  },
  {
    slug: 'remove-duplicate-lines',
    name: 'Remove Duplicate Lines',
    h1: 'Remove duplicate lines',
    tagline: 'Cut a pasted list down to one of each, and see exactly how many lines went.',
    category: 'text',
    icon: 'sort-asc',
    surface: 'text',
    processing: 'browser',
    metaTitle: 'Remove Duplicate Lines from Text',
    metaDescription:
      'Delete repeated lines from a list, keeping the first or the last copy. Options for case, trimming and blank lines, with a count of what was removed.',
    primaryKeyword: 'remove duplicate lines',
    secondaryKeywords: [
      'delete duplicate lines',
      'unique lines',
      'keep the last copy',
      'sort lines',
      'remove blank lines',
    ],
    synonyms: [
      'dedupe a list',
      'deduplicate text',
      'remove repeated lines',
      'unique list online',
      'filter duplicates',
      'clean up a list',
      'remove duplicate emails',
      'one of each line',
    ],
    howTo: {
      title: 'How to remove duplicate lines',
      steps: [
        'Paste your list into the box, one entry per line.',
        'Decide whether case matters and whether leading and trailing spaces should be ignored when comparing.',
        'Choose to keep the first or the last copy of each repeated line.',
        'Read how many lines were removed, then copy the result.',
      ],
    },
    features: [
      {
        title: 'Order is preserved by default',
        body: 'Delete duplicate lines and the survivors stay where they were, with the first copy of each kept. Nothing is sorted unless you ask, which matters when the list already had a meaningful sequence.',
      },
      {
        title: 'Keep the first or the last',
        body: 'Some lists are logs where the newest entry wins. Choosing to keep the last copy walks the list backwards, so the line that survives is the final occurrence rather than the earliest one.',
      },
      {
        title: 'Case and whitespace are your call',
        body: 'Comparison is case-sensitive unless you turn that off, and can optionally ignore leading and trailing spaces while still keeping each kept line’s original spacing in the output.',
      },
      {
        title: 'A count you can check',
        body: 'You are told how many lines went and how many unique lines remain, with duplicates and any dropped blank lines counted together, so the arithmetic can be compared against what you expected.',
      },
      {
        title: 'Line endings survive the trip',
        body: 'Whether the text arrived with Windows or Unix line endings is detected and the same ending is written back, so a list pasted from either platform returns unbroken.',
      },
      {
        title: 'Sorting when you want it',
        body: 'Sort lines alphabetically, in reverse, by length, in natural order so item2 precedes item10, or shuffled. Case-insensitive sorting is locale-aware and still treats resume and résumé as different words.',
      },
    ],
    faq: [
      {
        q: 'Is the comparison case-sensitive?',
        a: 'By default it is, so Apple and apple are two lines. Switch case sensitivity off and they match, with whichever copy you chose to keep surviving in its original spelling.',
      },
      {
        q: 'What does trimming before comparing do?',
        a: 'It ignores leading and trailing spaces and tabs when deciding whether two lines are the same, which is what you want after copying out of a spreadsheet. Only the comparison is trimmed; the kept line keeps its own spacing.',
      },
      {
        q: 'Does it sort the list as well?',
        a: 'Not unless you pick a sort order. Deduplication on its own leaves every surviving line exactly where it was.',
      },
      {
        q: 'How are blank lines treated?',
        a: 'As ordinary lines, so a run of them collapses to one. To lose them altogether, switch on remove blank lines; they are then counted in the removed total along with the duplicates.',
      },
      {
        q: 'How long a list can I paste?',
        a: 'There is no fixed cap. The work happens in the page, so your browser’s memory is the limit — a few hundred thousand lines is comfortable on a desktop and less so on a phone.',
      },
      {
        q: 'Is anything uploaded?',
        a: 'No. The text is processed in the tab, so a customer list or a set of internal hostnames does not leave your machine.',
      },
    ],
    content: [
      {
        heading: 'Deciding what “the same” means',
        body: [
          'Most disappointing deduplication is a definition problem rather than a bug. A list exported from two systems will hold Alice@example.com and alice@example.com, or “Acme Ltd” with a trailing space in half the rows. Both pairs are duplicates to a person and distinct strings to a computer.',
          'The three options here cover nearly all of it: ignore case, ignore surrounding whitespace, drop empty lines. Turn them on when the source is messy, and leave them off when the distinctions are real — passwords, hashes, base64 and case-sensitive identifiers all mean precisely what they say.',
        ],
      },
      {
        heading: 'Keep the first, or keep the last',
        body: [
          'For a list of names or URLs the choice rarely matters, because the duplicates are identical. It matters the moment position carries information: in an append-only log the last occurrence is the current state, while in a ranked list the first is the one that wins.',
          'The removed count is worth a glance either way. If you expected to lose a dozen lines and lost four hundred, the case or trim options are doing more than you intended, and that is far easier to notice from the number than from the result.',
        ],
      },
      {
        heading: 'Sorting, and when not to',
        body: [
          'Sorting after deduplication makes a list easier to scan and easier to compare with another one. Natural order is usually the option people actually want when entries contain numbers, because it puts item2 before item10 instead of after it.',
          'It also destroys whatever order the list already had. If the sequence was chronological, ranked or grouped, sort a copy rather than the thing you are about to paste back.',
        ],
      },
    ],
    related: ['word-counter', 'case-converter', 'json-formatter'],
    updated: '2026-09-03',
  },
  {
    slug: 'slug-generator',
    name: 'Slug Generator',
    h1: 'Generate a URL slug',
    tagline: 'Turn a headline into a tidy web address that survives being pasted anywhere.',
    category: 'text',
    icon: 'link',
    surface: 'text',
    processing: 'browser',
    metaTitle: 'Slug Generator for URLs',
    metaDescription:
      'Turn a title into a clean URL slug. Accents are folded, Cyrillic and Greek are transliterated, and anything dropped is listed rather than hidden.',
    primaryKeyword: 'slug generator',
    secondaryKeywords: [
      'url slug',
      'slugify text',
      'transliteration',
      'remove stop words',
      'permalink',
      'clean url',
    ],
    synonyms: [
      'slugify',
      'url friendly text',
      'permalink generator',
      'make a url from a title',
      'seo url generator',
      'text to slug',
      'web address from title',
      'url encoder for titles',
    ],
    howTo: {
      title: 'How to generate a URL slug',
      steps: [
        'Type or paste your title.',
        'Choose the separator: a hyphen, an underscore, or nothing at all.',
        'Set a maximum length if the URL has to stay short, and switch on stop word removal to lose the filler.',
        'Read any warnings, then copy the slug.',
      ],
    },
    features: [
      {
        title: 'Accents are folded, not deleted',
        body: 'Café becomes cafe and Zürich becomes zurich, because each letter is decomposed and its accent removed rather than the whole character being dropped.',
      },
      {
        title: 'Cyrillic and Greek are transliterated',
        body: 'Russian, Ukrainian and Serbian letters map to Latin by convention — ж to zh, щ to shch, ё to yo — and Greek follows ELOT 743, which is why β becomes v rather than b.',
      },
      {
        title: 'Spellings decomposition cannot fix',
        body: 'ß becomes ss, ø becomes o, æ becomes ae and þ becomes th. None of those is an accented letter, so a lookup table catches them where the usual decomposition passes them by.',
      },
      {
        title: 'Apostrophes close up rather than split',
        body: 'don’t becomes dont, not don-t. Apostrophes, backticks, the soft hyphen and the Cyrillic soft sign are removed without ending the word they sit inside.',
      },
      {
        title: 'No doubled or dangling separators',
        body: 'The slug is assembled by joining words instead of patching a string, so a leading, trailing or repeated separator is impossible rather than merely tidied up afterwards.',
      },
      {
        title: 'It tells you what it dropped',
        body: 'Anything with no Latin spelling — Chinese, Arabic, an emoji — is dropped and reported, with up to three examples and a count of the rest. You are also told when a length limit shortened the slug.',
      },
    ],
    faq: [
      {
        q: 'What happens to Chinese, Arabic or Japanese text?',
        a: 'It is dropped, and the warning lists what went. No mapping to Latin letters would be meaningful, and inventing one produces a URL that means nothing in either language. Write the slug by hand for those titles.',
      },
      {
        q: 'Is transliteration the same as translation?',
        a: 'No, and the difference matters. Транслитерация becomes transliteratsiya — the sounds spelled in Latin letters, not the meaning in English. It is readable to someone who knows the word and opaque to someone who does not.',
      },
      {
        q: 'How does the length limit work?',
        a: 'It counts characters and cuts at a word boundary, so a slug never ends mid-word. The exception is a first word already longer than the limit, which is cut and flagged. Leave the field empty, or at zero, for no limit.',
      },
      {
        q: 'Should I remove stop words?',
        a: 'Only when the slug is too long or reads badly. It shortens a URL and usually costs nothing, but “the-who” and “who” are not the same band. If every word in the title is a stop word, none are removed and you are told why.',
      },
      {
        q: 'Can I change a slug after publishing?',
        a: 'You can, but every existing link to that page breaks unless you add a redirect. Decide the slug before publishing and treat it as permanent afterwards; a permalink that keeps moving is worse than an ugly one.',
      },
      {
        q: 'Which separator should I use?',
        a: 'A hyphen is the convention for URLs and what most software expects. Underscores are common in file names. Choosing nothing runs the words together, which is compact and harder to read.',
      },
    ],
    content: [
      {
        heading: 'What makes a good slug',
        body: [
          'A url slug has two jobs: to be readable when someone sees it in a link, and to stay the same for ever. Short, lowercase, hyphen-separated, made of the words a person would use to describe the page. Three to six words is usually plenty, and the ones after that rarely earn their place.',
          'Dates, ID numbers and category names inside a slug are a bet that your site structure will never change. Keep them if they are useful to you, but the clean url you publish today is the one you are committing to.',
          'Case is the quieter trap. Some servers treat two addresses differing only in case as two pages and others as one, so lowercase throughout avoids an argument you cannot win. That is why it is the default here.',
        ],
      },
      {
        heading: 'Transliteration is a convention, not a translation',
        body: [
          'When you slugify text written in another script, what comes out is the sound of the words rather than their meaning: Москва becomes moskva, Αθήνα becomes athina. The mapping used here is the common one for Russian and its neighbours, and ELOT 743 for Greek — the same system Greek road signs use.',
          'Reasonable people disagree about several of these letters and no table satisfies everyone; the Greek β is v in modern usage and b in classical, and both answers are defensible. If a particular spelling matters in your language, edit the slug afterwards. The tool is a starting point, not an authority.',
          'Scripts with no convention to follow are dropped rather than mangled, and the preview lists them, so a title that mostly vanishes never does so silently.',
        ],
      },
    ],
    related: ['case-converter', 'word-counter', 'qr-code-generator', 'remove-duplicate-lines'],
    updated: '2026-09-03',
  },
];
