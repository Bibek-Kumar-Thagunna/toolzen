/**
 * ============================================================================
 * GUIDES — the pages that answer a problem rather than offer a tool
 * ============================================================================
 * Every tool page on this site targets a head term: "merge pdf", "compress
 * image". Those queries are owned by companies with a decade of links, and a
 * new site does not take them by writing better copy.
 *
 * These pages target the other half of the same demand: the queries people
 * type *before* they know which tool they need. "Why can't Windows open my
 * password-protected zip." "Is ZipCrypto secure." The search results for those
 * are forum threads — Microsoft Q&A, SourceForge, Directory Opus, elevenforum —
 * where somebody describes the symptom and nobody authoritatively explains the
 * cause. That is a gap that can be filled with knowledge rather than authority,
 * which is the only kind of gap available to a site with no authority yet.
 *
 * ── The bar for adding one ────────────────────────────────────────────────
 * A guide earns its place when the page can say something true and specific
 * that the pages currently ranking do not say. Not "10 ways to open a zip" —
 * the format's own specification, the name of the attack, the year, the
 * iteration count. If a guide could be written by someone who had only read
 * the other search results, it should not be written at all: it would be one
 * more thin page in a SERP made of thin pages.
 *
 * Every technical claim in this file was checked against a primary source
 * before it was written, and the sources are named in the prose so a reader
 * can check them too. That is not decoration. The entire competitive argument
 * for these pages is that they are correct where the alternatives are vague,
 * and a wrong number in here would forfeit it.
 *
 * ── Answer first, deliberately ────────────────────────────────────────────
 * `answer` is rendered immediately under the H1, before any section. These are
 * question queries; a reader who has to scroll past three paragraphs of
 * preamble to find out why their file will not open leaves, and a search
 * engine watching that happen draws the obvious conclusion. Saying the answer
 * in two sentences and then explaining it properly costs nothing and is also
 * simply the polite way to answer a question.
 * ============================================================================
 */
import type { ContentSection, FaqItem } from './types.ts';

export interface Guide {
  /** URL segment under /guides/. */
  slug: string;
  /** Page H1. Phrased as the thing the reader is trying to find out. */
  title: string;
  /** Short label for listings and cross-links. */
  name: string;
  /** ≤ 46 chars, before the brand suffix buildMetadata adds. */
  metaTitle: string;
  /** 120–158 chars. */
  metaDescription: string;
  /** The search phrase this page is built to answer. */
  primaryKeyword: string;
  secondaryKeywords: string[];
  /**
   * The direct answer, in two or three sentences, rendered above everything
   * else. If this cannot be written plainly, the page does not understand its
   * own subject well enough to be published.
   */
  answer: string;
  body: ContentSection[];
  faq: FaqItem[];
  /** Named sources, so the claims are checkable. Rendered as a list. */
  sources: { title: string; url: string }[];
  /** Tool slugs this page hands off to, in priority order. */
  tools: string[];
  /** Other guide slugs. */
  related: string[];
  updated: string;
}

export const guides: Guide[] = [
  {
    slug: 'windows-cannot-open-password-protected-zip',
    name: 'Why Windows cannot open your encrypted zip',
    title: 'Why Windows cannot open your password-protected zip',
    metaTitle: 'Windows Cannot Open Password-Protected Zip',
    metaDescription:
      'Windows File Explorer understands only one kind of zip encryption, and not the kind 7-Zip and WinRAR produce. What is really happening, and how to fix it.',
    primaryKeyword: 'windows cannot open password protected zip',
    secondaryKeywords: [
      'zip file password not working windows',
      'windows 11 encrypted zip not supported',
      'windows explorer aes zip',
      'password protected zip wont open',
      'compressed folder password windows',
    ],
    answer:
      'Windows File Explorer supports exactly one zip encryption method — the original 1990 one, usually called ZipCrypto — and it cannot read the AES encryption that 7-Zip, WinRAR and every modern tool produce by default. The file is not corrupt and your password is not wrong. Explorer either never asks for a password, asks and rejects the correct one, or extracts files of zero bytes, because it does not recognise the encryption at all.',
    body: [
      {
        heading: 'What is actually in the file',
        body: [
          'A zip archive records, for every file it contains, which compression and encryption method was used. Explorer reads that field, finds a method it has no implementation for, and handles it badly — which is why the symptom varies so much between Windows versions and even between files. Some builds show a password box and reject every password including the right one. Some extract a file of zero bytes and report success. Some report that the archive is invalid. All three are the same underlying fact wearing different clothes.',
          'The encryption in question is almost always WinZip AES, which 7-Zip offers as "AES-256" and WinRAR uses by default for zip archives. It is a well-designed scheme — it is the one this site produces too — and it is documented publicly. Windows simply has never implemented it. That has not changed in Windows 11: the 24H2 update added native support for more archive *formats*, including 7z, RAR and TAR, but the built-in tooling still cannot create or open an encrypted archive of any kind.',
          'So the compatibility problem is not a bug anyone is going to fix for you. It is a permanent gap between what the ecosystem writes by default and what Windows reads.',
        ],
      },
      {
        heading: 'Why the sender did not do anything wrong',
        body: [
          'It is worth being clear about this, because the usual outcome of this problem is the recipient telling the sender that the file is broken and the sender re-sending exactly the same file.',
          'The sender ticked "encrypt" in a normal program and got a normal, correct, standards-compliant archive. Their tool defaulted to AES because the alternative is genuinely unsafe — see the guide on ZipCrypto below, which is not a matter of opinion but of a published attack from 1994. Nothing the sender did was wrong, and asking them to re-send it "without a password" gives up the protection the password was there to provide.',
        ],
      },
      {
        heading: 'The three ways out, and what each costs',
        body: [
          'Install an archiver. 7-Zip, PeaZip and WinRAR all read AES zips correctly and are free or free to try. This is the right answer if you handle encrypted archives regularly. It costs an install, which on a managed or work machine you may not be able to do.',
          'Open it in a browser. The zip format is fully documented, AES is implemented in every modern browser, and the decryption can therefore happen in the page itself — which is what this site’s unlock tool does. Nothing is uploaded, so there is no server to trust with the contents, and there is nothing to install. This is the right answer for a one-off file on a machine you do not control.',
          'Ask for the archive again in ZipCrypto. Explorer will open it, and you should understand what you are accepting: ZipCrypto is broken, and an archive encrypted with it can be opened by an attacker without the password. For a file whose contents do not actually need protecting, that may be fine. For anything that does, it is not a solution — it is removing the lock so the door closes.',
        ],
      },
      {
        heading: 'How to tell which kind you have',
        body: [
          'Before anything else, it is worth knowing which encryption the file uses, because that determines which of the above applies.',
          'The simplest test is the behaviour itself: if Explorer shows you the file names but fails on extraction, the archive is encrypted with a method it does not understand, which in practice means AES. If Explorer asks for a password and accepts it, the archive is ZipCrypto and is already readable. A zip that shows nothing at all and reports corruption may be genuinely damaged, in which case no tool will open it — encryption and corruption produce similar-looking failures and are worth distinguishing before you spend an afternoon on passwords.',
          'The unlock tool on this site names the method it finds before it asks for anything, so you can use it to identify the file even if you then go and open it elsewhere.',
        ],
      },
    ],
    faq: [
      {
        q: 'Is my password wrong?',
        a: 'Almost certainly not. Explorer’s password prompt appears for any encrypted entry, but it can only verify a ZipCrypto password. Against an AES archive it has nothing to check the password with, so it rejects whatever you type — including the correct password. A password that fails in Explorer and works in 7-Zip is the normal signature of this problem, not evidence of a typo.',
      },
      {
        q: 'Did Windows 11 fix this?',
        a: 'No. Windows 11 24H2 added native reading of more archive formats — 7z, RAR, TAR and others — through the libarchive library. That is about which container formats Explorer understands, not which encryption. Creating or opening a password-protected archive of any kind still requires separate software.',
      },
      {
        q: 'Why does Explorer extract an empty file instead of failing?',
        a: 'Because the encrypted payload is, to a reader that does not know the method, just bytes of the wrong length and shape. Some code paths in Explorer treat that as a zero-length entry and write it out rather than raising an error. It is an unhelpful failure mode, and it is the one most likely to make somebody believe the sender attached the wrong thing.',
      },
      {
        q: 'Can I open it without installing anything?',
        a: 'Yes. AES-256 and the zip format are both fully specified and implemented in modern browsers, so the whole decryption fits in a web page. This site’s unlock tool does exactly that, on your own device, with no upload — which also means the archive’s contents never reach anyone else, including us.',
      },
      {
        q: 'Should I just ask the sender to remove the password?',
        a: 'Only if the contents genuinely do not need protecting. If they do, removing the password to work around a compatibility problem trades away the thing the password was for. Sending the file encrypted and the password by a different channel is the standard practice, and it only works if the encryption survives.',
      },
    ],
    sources: [
      { title: 'WinZip — AES Encryption Information (the AE-1/AE-2 specification)', url: 'https://www.winzip.com/en/support/aes-encryption/' },
      { title: 'Microsoft Q&A — adding AES-256 zip decryption support to Windows', url: 'https://learn.microsoft.com/en-us/answers/questions/4017730/how-do-i-add-aes-256-decryption-support-for-zip-fi' },
      { title: 'Directory Opus forum — AES256 encrypted zip fails in Windows Explorer', url: 'https://resource.dopus.com/t/aes256-encrypted-zip-fails-in-windows-explorer/37345' },
    ],
    tools: ['unlock-file', 'password-protect-files'],
    related: ['open-encrypted-zip-without-7-zip', 'is-zipcrypto-secure'],
    updated: '2026-09-13',
  },
  {
    slug: 'open-encrypted-zip-without-7-zip',
    name: 'Open an encrypted zip without installing anything',
    title: 'How to open an encrypted zip without 7-Zip',
    metaTitle: 'Open Encrypted Zip Without 7-Zip',
    metaDescription:
      'You have the password but no archiver, and no permission to install one. A browser can decrypt an AES zip by itself — here is why that works.',
    primaryKeyword: 'open encrypted zip without 7-zip',
    secondaryKeywords: [
      'open password protected zip online',
      'extract encrypted zip no software',
      'unzip aes zip in browser',
      'open encrypted zip without installing',
    ],
    answer:
      'You do not need an archiver. Both halves of the problem — the zip container and AES-256 decryption — are fully specified and available in every modern browser, so an encrypted zip can be opened by a web page running on your own machine. The important distinction is between a page that decrypts locally and a service that uploads your archive to a server to do it: the first never sees your files, the second sees all of them.',
    body: [
      {
        heading: 'Why this query returns the wrong results',
        body: [
          'Search for this and most of what comes back answers a different question: how to open an encrypted zip *without the password*. Those pages sell password-recovery software, and they rank because the phrasing is similar and the commercial intent is high.',
          'If you have the password and only lack the software, none of that applies to you. What you need is something that can read the format, and the machine in front of you already has one — the browser.',
        ],
      },
      {
        heading: 'What the browser is actually doing',
        body: [
          'A zip file is a sequence of entries with a directory at the end describing where each one starts, what it is called, and how it was compressed and encrypted. Reading that directory is ordinary parsing.',
          'The encryption is where the interesting part is. WinZip’s AES scheme derives a key from your password with PBKDF2-HMAC-SHA1 at 1000 iterations, checks two bytes to see whether the password is plausible, decrypts the payload in AES counter mode, and verifies the result with a truncated HMAC-SHA1. Every one of those primitives is in the browser’s WebCrypto API, so the whole operation runs natively at full speed.',
          'One piece has to be written by hand, and it is a genuinely awkward one: WinZip’s counter mode increments its counter block as a little-endian integer, while WebCrypto’s AES-CTR is specified big-endian. They are the same cipher producing different keystreams, so the browser’s own CTR implementation cannot be used to read a WinZip archive at all. That single detail is why browser-based AES zip support is rarer than it ought to be.',
        ],
      },
      {
        heading: 'Local page or remote service — how to tell the difference',
        body: [
          'This matters more than which tool you pick. A page that decrypts in your browser never receives your archive; a service that decrypts on a server receives the archive *and* the password, which together are everything the encryption was protecting.',
          'The test is simple and takes ten seconds. Load the page, then disconnect from the internet — turn off Wi-Fi, or use your browser’s offline mode — and try the file. A local tool carries on working because everything it needs is already in the tab. A service fails, because it cannot reach its server. There is no way to fake passing that test.',
          'On this site the claim is also enforced in the build rather than promised in the copy: a check refuses to compile any tool marked as browser-processed whose code references fetch, XMLHttpRequest, WebSocket or sendBeacon, and the locking tools additionally may not touch local storage, session storage or cookies. Copy can drift from behaviour; a failing build cannot.',
        ],
      },
      {
        heading: 'When you do still need an archiver',
        body: [
          'A browser is not the answer to everything, and it is worth knowing the edges.',
          'Very large archives are limited by memory, because the page holds what it is working on. A multi-gigabyte archive is a job for a desktop program. Formats other than zip — RAR in particular, which is proprietary — are not something a small web page implements. And if you handle encrypted archives daily, installing 7-Zip once is simply less friction than opening a page each time.',
          'The browser route is the right one for the specific and common case this page is about: a file you have been sent, a password you have, and a machine you are not allowed to install software on.',
        ],
      },
    ],
    faq: [
      {
        q: 'Is it safe to open an encrypted zip in a website?',
        a: 'It depends entirely on whether the decryption happens in your browser or on their server, and those are very different things wearing the same label. A local tool cannot see your files because they never leave the tab. A remote service receives both the archive and the password. Test it by going offline after the page loads — a local tool keeps working.',
      },
      {
        q: 'Will this work if I do not know the password?',
        a: 'No, and nothing legitimate will. AES-256 with a proper key derivation has no shortcut; recovering an unknown password means guessing, which is what password-recovery software does and why it is slow and often fruitless. If the archive is yours and the password is lost, the realistic options are to find the password or to ask whoever created it for another copy.',
      },
      {
        q: 'Does it work on a phone?',
        a: 'Yes. The same browser APIs exist on mobile, so an encrypted zip can be opened on a phone or tablet without an app. Large archives are more constrained by memory on a phone than on a laptop, so a very big file may be better handled elsewhere.',
      },
      {
        q: 'Do I need an account, and is it free?',
        a: 'Neither. There is no account system on this site and nothing to pay for. There is also no daily quota — the work happens on your own processor, so there is no per-use cost to us to ration.',
      },
      {
        q: 'Which encryption methods can a browser tool read?',
        a: 'WinZip AES (AE-1 and AE-2, the method 7-Zip labels AES-256 and WinRAR uses by default) and the old ZipCrypto. Between them those cover essentially every encrypted zip in circulation. What a browser tool will not read is a non-zip format such as RAR.',
      },
    ],
    sources: [
      { title: 'WinZip — AES Encryption Information (AE-1/AE-2 specification)', url: 'https://www.winzip.com/en/support/aes-encryption/' },
      { title: 'PeaZip — opening encrypted archives', url: 'https://peazip.github.io/extract-encrypted-files.html' },
    ],
    tools: ['unlock-file', 'password-protect-files'],
    related: ['windows-cannot-open-password-protected-zip', 'is-zipcrypto-secure'],
    updated: '2026-09-13',
  },
  {
    slug: 'is-zipcrypto-secure',
    name: 'Is ZipCrypto secure?',
    title: 'Is ZipCrypto secure? No — and it has not been since 1994',
    metaTitle: 'Is ZipCrypto Secure? AES vs ZipCrypto',
    metaDescription:
      'ZipCrypto has had a published known-plaintext attack since 1994, and free tools implement it. What that means in practice, and how AES-256 differs.',
    primaryKeyword: 'is zipcrypto secure',
    secondaryKeywords: [
      'aes-256 vs zipcrypto',
      'zipcrypto vs aes zip encryption',
      'zip encryption broken',
      'which zip encryption should i use',
    ],
    answer:
      'No. ZipCrypto — the original zip encryption, offered by 7-Zip and WinRAR for compatibility — was broken by a published known-plaintext attack in 1994, and free tools implement that attack today. An attacker who can guess or obtain a small amount of the archive’s contents can recover the internal keys and decrypt everything in it, without ever learning your password. Choose AES-256 unless the recipient genuinely cannot read it.',
    body: [
      {
        heading: 'What "broken" means here',
        body: [
          'It is a specific claim, not a general unease. In 1994 Eli Biham and Paul Kocher published a known-plaintext attack against the PKZIP stream cipher at the Fast Software Encryption workshop. The attack recovers the cipher’s internal state — which is what actually decrypts the data — from a modest amount of known plaintext, and once recovered it opens every file in the archive. The password is never needed and never learned.',
          'Michael Stay reduced the requirement further in 2001, showing the attack could work from a much smaller and more predictable sample. Today it exists as ordinary open-source software: bkcrack implements the Biham–Kocher attack and needs roughly twelve known bytes of one file in the archive.',
          'Twelve bytes is a low bar, and this is the part people underestimate. You do not need the attacker to know your document. File formats are predictable at the start: a PDF begins with "%PDF-1.", a PNG with a fixed eight-byte signature, a Word or Excel file is a zip whose first entry has a known name. If your archive contains any file of a common type, the known plaintext is effectively already public.',
        ],
      },
      {
        heading: 'Why it is still offered at all',
        body: [
          'Compatibility, and one specific piece of it: Windows File Explorer can open ZipCrypto archives and cannot open AES ones. That single fact keeps a cipher that was broken thirty years ago in daily use, because the alternative is a recipient who cannot open the file.',
          'It is a real trade-off rather than a silly one — an unreadable archive protects nothing either. But it should be made deliberately and with the cost understood, not accepted because it was the default in a dropdown.',
        ],
      },
      {
        heading: 'What AES-256 zip encryption does differently',
        body: [
          'The AES scheme used by zip archives is WinZip’s, and it is public: a random salt per file, a key derived from your password with PBKDF2-HMAC-SHA1, AES in counter mode over the compressed bytes, and an HMAC-SHA1 authentication tag so tampering is detected rather than silently decrypted into garbage. There is no known attack on it that does not amount to guessing the password.',
          'Its weakest published number is the key derivation: PBKDF2 at 1000 iterations. That figure was set when the format was written and it cannot be raised, because it is fixed in the specification and every reader assumes it. By modern standards 1000 is low — password-hashing guidance is now in the hundreds of thousands — which means the scheme’s real strength rests on your password rather than on the derivation slowing an attacker down. A long passphrase matters more here than it would with a modern format.',
          'The academic record on AES-in-zip is worth knowing too. Tadayoshi Kohno analysed it in 2004 and found real flaws, which is why there are two versions: AE-1 stored the plaintext CRC and leaked information about the contents, so AE-2 stores zero there instead. Kohno also showed an attack exploiting fields the authentication tag does not cover. None of these break the encryption the way the 1994 attack breaks ZipCrypto — they are the ordinary refinement of a scheme under scrutiny, and the gap between "has known weaknesses under analysis" and "is opened by free software in minutes" is the entire decision.',
        ],
      },
      {
        heading: 'The practical rule',
        body: [
          'Use AES-256, and send the password by a different channel from the file. If the recipient reports that it will not open, that is the Windows compatibility problem rather than a fault in the archive, and it has answers that do not involve weakening the encryption — an archiver, or a browser-based tool that needs no install.',
          'Use ZipCrypto only when the contents would not matter if they were read by someone else, and you need the recipient to open it with nothing but Windows. If you find yourself choosing it for something that does matter, the honest summary is that the archive is password-*labelled* rather than password-protected.',
        ],
      },
    ],
    faq: [
      {
        q: 'Can someone open my ZipCrypto archive without the password?',
        a: 'If they can guess or obtain around twelve bytes of any single file inside it, yes — with free, publicly available software. Because common file formats have fixed and well-known openings, an archive containing an ordinary PDF, image or Office document usually supplies that known plaintext by itself.',
      },
      {
        q: 'Does a longer password fix ZipCrypto?',
        a: 'No, and this is the key point people miss. The 1994 attack does not guess passwords — it recovers the cipher’s internal state directly from known plaintext. A sixty-character passphrase is defeated exactly as quickly as a four-character one, because the password is not what is being attacked.',
      },
      {
        q: 'Is AES-256 zip encryption good enough for sensitive documents?',
        a: 'For most purposes, with a strong passphrase, yes — there is no published break. Be aware that its key derivation is fixed at 1000 PBKDF2 iterations, which is low by current standards, so the strength rests unusually heavily on the password itself. For genuinely high-stakes material a modern format with a much stronger derivation is a better choice than any zip.',
      },
      {
        q: 'How do I know which one my archive uses?',
        a: 'Most archivers show the method in the file’s properties or listing. The behavioural shortcut is Windows: if File Explorer can open it with the password, it is ZipCrypto; if Explorer fails while a proper archiver succeeds, it is AES. This site’s unlock tool also names the method before asking for a password.',
      },
      {
        q: 'Which does this site use?',
        a: 'AES-256, always — ZipCrypto is not offered, because offering it would mean offering something that does not work. The archives produced here follow the AE-2 specification, so any standard archiver reads them, and they are built in your browser without the files being uploaded.',
      },
    ],
    sources: [
      { title: 'Biham & Kocher, "A Known Plaintext Attack on the PKZIP Stream Cipher" (FSE 1994)', url: 'https://link.springer.com/chapter/10.1007/3-540-60590-8_12' },
      { title: 'Michael Stay, "ZIP Attacks with Reduced Known Plaintext" (2001)', url: 'https://math.ucr.edu/~mike/zipattacks.pdf' },
      { title: 'bkcrack — an open-source implementation of the Biham–Kocher attack', url: 'https://github.com/kimci86/bkcrack' },
      { title: 'Kohno, "Attacking and Repairing the WinZip Encryption Scheme" (2004)', url: 'https://homes.cs.washington.edu/~yoshi/papers/WinZip/winzip.pdf' },
      { title: 'WinZip — AES Encryption Information (AE-1/AE-2 specification)', url: 'https://www.winzip.com/en/support/aes-encryption/' },
    ],
    tools: ['password-protect-files', 'unlock-file'],
    related: ['windows-cannot-open-password-protected-zip', 'open-encrypted-zip-without-7-zip'],
    updated: '2026-09-13',
  },
];

export const guideSlugs: string[] = guides.map((guide) => guide.slug);

export function getGuide(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}

/** Hand-picked cross-links, resolved and filtered to guides that exist. */
export function relatedGuides(guide: Guide): Guide[] {
  return guide.related
    .map((slug) => getGuide(slug))
    .filter((entry): entry is Guide => entry !== undefined);
}
