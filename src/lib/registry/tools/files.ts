import type { Tool } from '../types';
import { ANY_FILES_MANY, LOCKED_FILE_ONE } from '../../tools/accepts.ts';

/**
 * Registry entries for the file category.
 *
 * These two pages make claims about cryptography, which is the one subject
 * where marketing copy does real harm: somebody reads "AES-256" as "safe" and
 * picks a six-character password. So every claim below is checkable against
 * the engines — src/lib/crypto/aes.ts, src/lib/tools/secure/aeszip.ts and
 * tzlock.ts — and the limitations that matter are in the copy rather than
 * only in the code:
 *
 *   - an AES zip is stuck at 1000 PBKDF2 rounds and that is weak against
 *     offline guessing,
 *   - Windows cannot open an AES zip without extra software,
 *   - "only our site can open it" is lock-in, not protection,
 *   - a forgotten password means the file is gone.
 *
 * If any of those stops being true in the code, the copy here is a lie and has
 * to change with it.
 */
export const fileTools: Tool[] = [
  {
    slug: 'password-protect-files',
    name: 'Password Protect Files',
    h1: 'Password protect your files',
    tagline: 'Lock any file or folder of files with AES-256, so only someone with the password can open it.',
    category: 'files',
    icon: 'lock',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Password Protect Files — AES-256',
    metaDescription:
      'Password protect files with AES-256, in your browser. Produce a standard encrypted zip, or a file only openable on Toolzen. Nothing is uploaded, ever.',
    primaryKeyword: 'password protect files',
    secondaryKeywords: [
      'encrypt a file',
      'password protect a zip',
      'lock a folder with a password',
      'aes-256 zip',
      'secure file sharing',
    ],
    synonyms: [
      'put a password on a zip',
      'encrypt files online',
      'password protect a folder',
      'lock files',
      'protect a pdf with a password',
      'make a secure zip',
      'send files securely',
      'encrypted archive',
    ],
    accepts: ANY_FILES_MANY,
    howTo: {
      title: 'How to password-protect a file',
      steps: [
        'Add the files you want to lock — they can be any type, and there can be several.',
        'Choose who should be able to open it: anyone with 7-Zip, or only someone on this site.',
        'Type a password. Four random words beats one clever word, and the meter shows how long guessing it would take.',
        'Lock the files, download the result, and send the password by a different route from the file.',
      ],
    },
    features: [
      {
        title: 'AES-256, not the broken kind',
        body: 'ZIP has two encryption schemes. The one Windows can open without extra software has been breakable since the nineties — a known-plaintext attack recovers the contents of any file whose first bytes are predictable, which means every JPEG, PDF and Word document. This writes the other one.',
      },
      {
        title: 'A strength meter that answers in time',
        body: 'Not a coloured bar. It looks for the patterns a real attacker tries first — known passwords, keyboard runs, a word with digits stuck on, letters swapped for numbers — and tells you roughly how long someone with serious hardware would need. “P@ssw0rd” scores zero, as it should.',
      },
      {
        title: 'Two formats, and the difference is stated',
        body: 'A standard .zip your recipient opens in 7-Zip, WinRAR or Keka; or a .tzlock that opens on this site, where the password is six hundred times harder to guess because the work factor is ours to choose rather than frozen by a 2003 specification.',
      },
      {
        title: 'Nothing is uploaded, including the password',
        body: 'The encryption happens in the tab, using your browser’s own cryptography. There is no server to trust and no request to intercept. For a tool whose entire job is keeping something private, that is the difference between a promise and a fact.',
      },
      {
        title: 'Authenticated, so tampering is detected',
        body: 'Both formats carry an authentication code over the encrypted data. A file that was altered or damaged in transit refuses to open instead of quietly producing a corrupted document.',
      },
      {
        title: 'A password reminder that cannot be edited',
        body: 'A .tzlock can carry a hint, shown before anyone types anything. It is stored in the clear so anyone with the file can read it — make it a nudge, not the answer — but it is covered by the authentication, so nobody can change it.',
      },
    ],
    faq: [
      {
        q: 'Can you recover my file if I forget the password?',
        a: 'No, and neither can anyone else. There is no key escrow, no recovery code and no back door — the password is the only thing that derives the key, and it is never stored anywhere. This is the property that makes the tool worth using, and it is also the one that makes losing the password final. Write it down somewhere before you send the file.',
      },
      {
        q: 'Why will Windows not open my encrypted zip?',
        a: 'Windows Explorer only understands the old, broken ZipCrypto encryption. It has never supported the AES kind, which is what this writes. Your recipient needs 7-Zip on Windows, or Keka or The Unarchiver on a Mac — all free. If that is a problem, the .tzlock option needs no software at all, only this website.',
      },
      {
        q: 'Is “only openable on Toolzen” actually more secure?',
        a: 'No, and it would be dishonest to imply otherwise. The code that reads the format is public JavaScript, so someone determined could write their own reader. What they still could not do is open the file without the password. The real advantage of that format is a much higher work factor, which makes guessing the password genuinely harder.',
      },
      {
        q: 'What happens to my files if this website disappears?',
        a: 'A standard zip is unaffected — any unzip program opens it. For a .tzlock there is a standalone unlocker: one HTML file you can download and keep alongside it, which decrypts the file with no internet connection and no website. The format also carries a version byte, so version 1 files will always be readable by later versions of the tool.',
      },
      {
        q: 'How strong does the password need to be?',
        a: 'Longer beats complicated. Four or five unrelated words are easy to remember and put the guessing time past any attacker’s patience, while eight characters of mixed symbols are shorter than they look and fall to a graphics card. The meter estimates against a well-funded attacker rather than a casual one, so treat its answer as a floor.',
      },
      {
        q: 'Does it hide the names of my files?',
        a: 'A .tzlock does — the whole listing is inside the encryption, because a set of filenames often gives away what a file is. An encrypted zip does not: the format keeps its index readable so programs can list an archive without the password, so anyone holding it can see what is in it, just not read it.',
      },
      {
        q: 'How big a file can it handle?',
        a: 'Up to 100 MB per file and twenty files at once, with a total of 200 MB for a .tzlock. These are limits of what a browser tab can hold in memory rather than of the format, and they are checked before anything starts rather than failing halfway through.',
      },
      {
        q: 'Is it free to password-protect a file, and is there a watermark or a limit?',
        a: 'Free, with nothing added to your files and no count of how many you lock. A watermark is not even possible here: the tool encrypts the bytes you gave it and never decodes or redraws them, so what comes out decrypts to exactly what went in.',
      },
      {
        q: 'Do I need an account to lock a file?',
        a: 'No, and an account would be worse than useless for this. A service holding an account holding your files is a service that can be compelled to open them. Nothing here knows who you are, which is why we cannot help you if the password is lost.',
      },
      {
        q: 'Is anything uploaded when I lock a file?',
        a: 'Nothing at all — not the files and not the password. The encryption runs in the tab using your browser’s own cryptography, and you can prove it: switch off your internet connection and lock a file anyway. It works, because there was never a server involved.',
      },
    ],
    content: [
      {
        heading: 'Send the password separately from the file',
        body: [
          'This is the part that undoes most of the work. A locked file and its password in the same email thread, the same chat, or the same message is one compromised account away from being neither locked nor private — whoever reads the conversation has both halves.',
          'Send the file one way and the password another: the file by email, the password by phone or a message app. It costs thirty seconds and it is the single biggest improvement most people can make to how they share sensitive documents.',
          'It also matters who can see the password later. A chat history is searchable forever, so a spoken password, or one sent in a message that disappears, is better than one sitting in a thread somebody else inherits with the mailbox.',
        ],
      },
      {
        heading: 'Why the word "encrypted" is doing less work than you think',
        body: [
          'AES-256 has never been broken and is not the weak point in any of this. The weak point is always the password, because an attacker who has your file does not attack the cipher — they guess passwords offline, as fast as their hardware allows, with no rate limit and nobody watching.',
          'What decides whether that works is how many guesses per second they get, and that is set by the key derivation function rather than by the cipher. An encrypted zip is frozen at 1000 rounds of PBKDF2, a number chosen in 2003 and hardcoded in every program that reads the format. On modern hardware that is barely a speed bump.',
          'Which is why the password matters more than the format. A long passphrase is secure in both. A short password is weak in both, and quickly weak in the zip. If you take one thing from this page, make it the length of the password rather than the choice of format.',
        ],
      },
      {
        heading: 'What this protects against, and what it does not',
        body: [
          'It protects a file in transit and at rest: an email intercepted, a USB stick lost, a shared drive with the wrong permissions, a laptop left on a train. In all of those the file is bytes without the password, and that is a real and common threat.',
          'It does not protect against someone watching you type, malware already on your computer, or anyone you give the password to deciding to share it. It also does not hide the fact that you sent a file, or how big it was.',
          'And it is not a substitute for end-to-end encrypted messaging for a conversation, or for full-disk encryption on a laptop. It is the right tool for one job: making a specific file unreadable to everyone except the person you intend to read it.',
        ],
      },
    ],
    related: ['unlock-file', 'image-to-pdf', 'compress-pdf', 'password-generator'],
    isNew: true,
    updated: '2026-09-12',
  },
  {
    slug: 'unlock-file',
    name: 'Unlock a File',
    h1: 'Open a password-protected zip or locked file',
    tagline: 'Open an encrypted zip or a Toolzen locked file with its password, straight in your browser.',
    category: 'files',
    icon: 'key',
    surface: 'files',
    processing: 'browser',
    metaTitle: 'Open a Password-Protected Zip',
    metaDescription:
      'Open a password-protected zip or a .tzlock file in your browser and get the files out. Nothing is uploaded — not the file, not the password.',
    primaryKeyword: 'open password protected zip',
    secondaryKeywords: [
      'unzip encrypted file',
      'decrypt a zip',
      'extract password protected zip',
      'open a locked file',
      'aes zip reader',
    ],
    synonyms: [
      'unlock a zip file',
      'open encrypted archive',
      'password protected zip opener',
      'extract a locked zip',
      'unzip with password',
      'open a tzlock file',
      'decrypt files online',
    ],
    accepts: LOCKED_FILE_ONE,
    howTo: {
      title: 'How to open a password-protected file',
      steps: [
        'Drop in the locked file — a .zip or a .tzlock.',
        'Check what it says it holds, and any reminder the sender left.',
        'Type the password and unlock.',
        'Save the files, one at a time or all at once.',
      ],
    },
    features: [
      {
        title: 'It opens other programs’ files, not just ours',
        body: 'An AES-256 zip made by 7-Zip, WinRAR, Keka or PeaZip opens here with its password, as does a .tzlock from this site. You do not need to have locked the file here to open it here.',
      },
      {
        title: 'Nothing is uploaded — including the password',
        body: 'The file is read and decrypted inside the tab. Most "open a protected zip online" services upload both the archive and the password to a server, which is a strange thing to do with a file somebody deliberately encrypted.',
      },
      {
        title: 'You see what is inside before you type anything',
        body: 'Dropping the file lists what it contains and shows any reminder the sender left. A file that turns out not to be encrypted at all, or to use a scheme this cannot read, says so immediately rather than after three failed password attempts.',
      },
      {
        title: 'A wrong password is named as one',
        body: 'The formats carry a check value and an authentication code, so a wrong password is distinguished from a damaged file wherever the format allows it. Where it genuinely cannot be — as with the site’s own container — the message says so rather than guessing.',
      },
      {
        title: 'Weak protection is pointed out',
        body: 'If the archive turns out to use the old ZipCrypto scheme, the result says so. Anyone opening one is exactly the person who should know that the file they were sent could be read by anyone who had it, password or not.',
      },
      {
        title: 'Files come out one at a time or together',
        body: 'Save a single file directly, or take everything as one ordinary unencrypted zip. Names are reduced to a single safe segment, so an archive cannot suggest a path outside your downloads folder.',
      },
    ],
    faq: [
      {
        q: 'Can this open a zip if I do not know the password?',
        a: 'No. There is no way to recover the contents of an AES-encrypted archive without the password, and any site claiming to either runs a guessing attack on your behalf or is lying. If the password is lost, so is the file.',
      },
      {
        q: 'Is it safe to open a confidential archive on a website?',
        a: 'On this one, yes, and you can verify it: the page makes no network request while it works. The file is read with the browser’s own file API and decrypted with the browser’s own cryptography. Nothing is sent anywhere, and the password never leaves the tab. Disconnecting from the internet before unlocking is a fair test.',
      },
      {
        q: 'Why does my Toolzen file take a second to open?',
        a: 'Because it is meant to. Turning a password into a key deliberately takes 600,000 rounds of computation, which is about a second on a phone and imperceptible once. That same second is what makes guessing millions of passwords expensive for an attacker.',
      },
      {
        q: 'It says the archive uses ZipCrypto and will not open it.',
        a: 'That is the original zip encryption, and it is both broken and not implemented here — supporting it would mean putting effort into a scheme nobody should still be using. 7-Zip opens those archives with the password. If the contents matter, lock them again with AES-256 afterwards.',
      },
      {
        q: 'Can it handle a RAR or a 7z file?',
        a: 'No. Those are different formats with their own encryption, not variants of zip. 7-Zip opens both. This tool reads zip archives and .tzlock files.',
      },
      {
        q: 'The password is definitely right and it still fails.',
        a: 'Then the file is probably damaged. Both formats authenticate their contents, so a byte changed by a truncated download or a mail server that mangled the attachment makes the file refuse to open. Ask for it again, ideally as a link rather than an attachment.',
      },
      {
        q: 'Is it free to open a password-protected zip, and is there a limit?',
        a: 'Free, with no cap on file size beyond the 300 MB a browser tab can hold, and no watermark or alteration to the files that come out — they are the originals, decrypted, byte for byte.',
      },
      {
        q: 'Do I need an account, and is my file uploaded to be opened?',
        a: 'No account, and nothing is uploaded — not the archive and not the password. Most “open a protected zip online” services send both to a server, which is an odd thing to do with a file somebody deliberately encrypted.',
      },
    ],
    content: [
      {
        heading: 'Why an online unlocker is usually the wrong tool',
        body: [
          'Search for one and you will find dozens of services that accept your encrypted archive and your password through a form. Think about what that means: the file somebody encrypted precisely so that strangers could not read it is now on a stranger’s server, together with the password that opens it.',
          'Some of them are careless rather than malicious, which is not much comfort — an upload sits in a log, a temporary directory, a backup. The only version of this tool that makes sense is one where the file never leaves the device, which is why this one works the way it does.',
          'The test is simple and worth doing with anything of this kind: open the page, disconnect from the internet, then unlock the file. If it works offline, nothing was uploaded. If it does not, something was.',
        ],
      },
      {
        heading: 'What to do after you open it',
        body: [
          'The files that come out are ordinary, unencrypted files in your downloads folder, which is usually the least protected place on the machine. If the contents were sensitive enough to be sent locked, move them somewhere appropriate and clear the downloads folder afterwards.',
          'It is also worth telling the sender how the file arrived. If it came as an old-style ZipCrypto archive, or with the password in the same message, they probably think they did the secure thing — and the next file will come the same way unless somebody mentions it.',
        ],
      },
      {
        heading: 'What to check before you assume the password is wrong',
        body: [
          'Passwords for archives are case sensitive and space sensitive, and the two most common failures are a trailing space picked up when the password was copied out of a message, and a capital letter lost when it was typed on a phone keyboard. Both look exactly like a wrong password. Pasting rather than typing, and then using the reveal button to look at what actually landed in the box, resolves most of them in a few seconds.',
          'The second thing to check is whether the file arrived intact. Both formats this tool reads carry an authentication code over their contents, which means a single byte changed in transit makes the file refuse to open — correctly, because a file that has been altered should not be trusted. Mail servers that rewrite attachments and downloads that stopped early are the usual causes, and the fix is to get the file again, ideally as a link rather than an attachment.',
          'If neither is the problem, the password is genuinely wrong, and there is no way round that. Encryption that could be bypassed by the people who wrote the tool would not be encryption. Ask whoever sent it.',
        ],
      },
    ],
    related: ['password-protect-files', 'compress-pdf', 'image-to-pdf', 'password-generator'],
    isNew: true,
    updated: '2026-09-12',
  },
];
