/**
 * ============================================================================
 * BRAND — single source of truth
 * ============================================================================
 * To rebrand the entire product, change the values in this file only. Nothing
 * else in the codebase hardcodes the name, and no component imports a brand
 * colour directly (they use the semantic tokens in globals.css).
 *
 * Checklist when the name or domain changes:
 *   1. `name`, `legalName`, `domain`, `tagline`, `social` below
 *   2. `--c-accent*` in src/app/globals.css if you want a different accent
 *   3. Re-run `node scripts/generate-brand-assets.mjs` to rebuild the
 *      favicon / app icons / OG images from the new name + accent
 *   4. Set NEXT_PUBLIC_SITE_URL in the deploy environment to the real origin
 * ============================================================================
 */
/**
 * The displayed name and the domain differ on purpose, and neither is a typo.
 *
 * `toolzen.com` belongs to TOOLZEN Co., a Korean industrial tool manufacturer.
 * They are a B2B hardware business and will never compete for "compress image"
 * or "merge pdf", so there is no search collision — but the domain is not
 * available, and prefixing the brand itself with "The" would be worse than
 * prefixing only the address. So the product is Toolzen and it lives at
 * thetoolzen.com, the way The Browser Company lives at thebrowser.company.
 *
 * Everything user-facing reads `name`. `domain` appears only in the footer and
 * the structured data, so the difference is invisible in normal use.
 */
export const brand = {
  name: 'Toolzen',
  legalName: 'Toolzen',
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
