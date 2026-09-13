/**
 * ============================================================================
 * BRAND — single source of truth
 * ============================================================================
 * To rebrand the entire product, change the values in this file only. No
 * component imports a brand colour directly (they use the semantic tokens in
 * globals.css), and no file writes the name out by hand.
 *
 * That last sentence used to be a claim and is now a check. It was false when
 * it was written — eleven files hardcoded "Toolzen", and they all kept saying
 * it after the brand moved to "The Toolzen", with no error and nothing
 * visibly broken. `checkBrandLiterals` in scripts/check-integrity.mjs now
 * fails the build on a hand-written brand name outside a documented
 * allowlist, so the next rename cannot half-happen the way this one did.
 *
 * Checklist when the name or domain changes:
 *   1. `name`, `shortName`, `alternateNames`, `legalName`, `domain`,
 *      `tagline`, `social` below
 *   2. `--c-accent*` in src/app/globals.css if you want a different accent
 *   3. Re-run `node scripts/generate-brand-assets.mjs` to rebuild the
 *      favicon / app icons / OG images from the new name + accent
 *   4. Set NEXT_PUBLIC_SITE_URL in the deploy environment to the real origin
 * ============================================================================
 */
/**
 * ── Why the brand is "The Toolzen" and not "Toolzen" ───────────────────────
 * An earlier version of this file said the product was "Toolzen" living at
 * thetoolzen.com, and reasoned that prefixing the brand itself with "The"
 * would be worse than prefixing only the address. That reasoning assumed the
 * only other holder of the name was TOOLZEN Co., a Korean industrial tool
 * manufacturer who will never compete for "compress image" or "merge pdf".
 *
 * That assumption was wrong, and the SERP is the evidence. Searching "toolzen"
 * returns, above the fold:
 *
 *   - toolszen.com     — established, carries Google sitelinks
 *   - tool-zen.com     — "PDF Merge – ToolZen", a direct competitor
 *   - toolzenweb.com   — "Merge PDF | Free Online Tool – Toolzen", another one
 *   - Toolzen          — an Android app on Google Play
 *
 * Four entities already answer for the bare word, two of them doing precisely
 * what this site does. A brand query is resolved by consensus — links,
 * mentions, clicks — and consensus is not something on-page work can
 * manufacture. Competing for "toolzen" is a fight against four incumbents for
 * a string none of them will give up.
 *
 * "thetoolzen", searched as an exact string, returns nobody. It is unclaimed,
 * it is already the domain, and an unclaimed brand string can rank first for
 * itself within weeks of being indexed because there is nothing to outrank.
 *
 * So the entity is **The Toolzen**. `shortName` stays "Toolzen" for the places
 * where the definite article reads badly in a sentence ("a Toolzen-locked
 * file"), and `alternateNames` tells structured-data consumers that the two
 * refer to one entity — which is exactly what alternateName is for, and is the
 * mechanism by which traffic searching the short name still resolves here.
 *
 * `alternateNames` holds genuine alternate spellings only. Adding competitors'
 * domains or plausible misspellings ("toolszen", "tooolzen") would be a
 * transparent attempt to claim an entity we are not, which search engines
 * discount at best and treat as a spam signal at worst.
 *
 * Everything user-facing reads `name`. `domain` appears only in the footer and
 * the structured data.
 */
export const brand = {
  name: 'The Toolzen',
  legalName: 'The Toolzen',

  /**
   * The name without the article, for running prose and compound adjectives.
   * Never used as the entity name in metadata or structured data — only where
   * "The Toolzen" would be ungrammatical mid-sentence.
   */
  shortName: 'Toolzen',

  /**
   * Emitted as `alternateName` on the Organization and WebSite nodes. Real
   * variants of this name, nothing else.
   */
  alternateNames: ['Toolzen', 'TheToolzen'],

  domain: 'thetoolzen.com',

  /** Used as the homepage H1 support line and the OG description fallback. */
  tagline: 'Fast, private tools that just work.',
  description:
    'A growing collection of image, PDF, text, developer and calculator tools. Most run entirely in your browser, so your files never leave your device.',

  /** Shown in the footer and the About page. */
  foundedYear: 2026,

  social: {
    /** Without the leading @; leave empty to omit Twitter card attribution. */
    twitter: '',
    github: '',
  },

  contact: {
    /** Used on the privacy page and in the Organization JSON-LD. */
    email: 'hello@thetoolzen.com',
  },
} as const;

/**
 * The three claims we make in the UI. Each one is enforced by architecture,
 * not by copywriting:
 *   - browserOnly: the tool's `processing` field is 'browser' and there is no
 *     network call in its engine. Verified by scripts/check-integrity.mjs.
 *   - noAccount: there is no auth system in the codebase at all.
 *   - noUpload: follows from browserOnly.
 */
export const promises = {
  browserOnly: 'Processed in your browser — your file is never uploaded.',
  /**
   * The same claim for a tool that takes no file. A calculator promising that
   * "your file" is never uploaded is a copy bug on every page that has no file
   * picker on it, and it reads as boilerplate — which is the opposite of what
   * these three lines are for.
   */
  browserOnlyNoFile: 'Worked out in your browser — nothing you type is sent anywhere.',
  noAccount: 'No account, no email, no sign-up.',
  free: 'Free, with no watermarks and no artificial limits.',
} as const;

export type Brand = typeof brand;
