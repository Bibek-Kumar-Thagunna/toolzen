/**
 * ============================================================================
 * AD CONFIGURATION
 * ============================================================================
 * The product rule this file exists to enforce, in priority order:
 *
 *     USER INTENT  >  TOOL  >  RESULT  >  OPTIONAL CONTENT  >  ADS
 *
 * Never the reverse. An ad may not sit between a user and the thing they came
 * for, may not be mistakable for a control, and may not move anything on the
 * page once it loads. Everything below follows from that.
 *
 * ── Why placements are a closed union and not a free-form prop ──
 * `<AdSlot placement="rail" />` can only ever be one of four known positions,
 * each with a reviewed rationale and a fixed reservation. A `<AdSlot width={}
 * height={} />` API would let anyone drop a unit anywhere, and the fourth person
 * to do so would put one above a download button. The compiler now refuses.
 *
 * ── Why reservations are Tailwind class literals ──
 * Zero CLS needs the height known before the ad arrives, and it differs per
 * breakpoint. An inline `style={{height}}` can only hold one number, and a
 * `matchMedia` measurement happens after paint, which is the shift we are
 * avoiding. Literal class strings compile to real media queries. Tailwind scans
 * this file (`content` includes `src/**`), so these classes survive the purge.
 *
 * ── Nothing renders unless configured ──
 * `adsEnabled` is false by default. A local dev run, a CI build and a
 * self-hosted deployment show no ad markup at all — not an empty reservation, no
 * markup. The gap only exists when a real unit is going to fill it.
 * ============================================================================
 */

/**
 * The four reviewed positions. Adding a fifth means adding a rationale here and
 * arguing for it, which is the point.
 */
export type AdPlacement = 'rail' | 'afterResult' | 'afterContent' | 'listing';

export interface AdPlacementSpec {
  id: AdPlacement;
  /** Shown in the debug reservation box. Never shown to real users. */
  label: string;
  /** Reserved box height per breakpoint. The whole CLS story. */
  reservedClass: string;
  /** When the slot is allowed to exist at all. */
  visibilityClass: string;
  /** Human-readable reserved size, for the debug box. */
  reservedSizes: string;
  /** AdSense responsive format hint. */
  format: 'auto' | 'rectangle' | 'horizontal' | 'vertical';
  /** Whether to wait for the slot to approach the viewport before loading. */
  lazy: boolean;
  /** Why this position cannot interfere with the tool. Reviewed, not decorative. */
  rationale: string;
}

export const adPlacements: Readonly<Record<AdPlacement, AdPlacementSpec>> = {
  /**
   * A vertical unit in its own grid column, beside the tool. It exists only from
   * 1280px, where the workspace already has all the width it needs and the
   * column is otherwise empty margin. Below that it does not render, so it can
   * never squeeze the tool on a laptop or a tablet.
   */
  rail: {
    id: 'rail',
    label: 'Sidebar rail',
    reservedClass: 'h-[600px] w-[300px]',
    visibilityClass: 'hidden xl:block',
    reservedSizes: '300 × 600',
    format: 'vertical',
    lazy: false,
    rationale:
      'Separate grid column from 1280px up; cannot overlap or narrow the workspace, and is below the fold on first paint for most tools.',
  },

  /**
   * Below the finished result and its download control — never above, never
   * between. Rendered by the tool page only once a result exists, so a user who
   * is still choosing a file never sees it.
   */
  afterResult: {
    id: 'afterResult',
    label: 'Below result',
    reservedClass: 'h-[250px] sm:h-[280px]',
    visibilityClass: 'block',
    reservedSizes: '300 × 250 / 336 × 280',
    format: 'rectangle',
    lazy: true,
    rationale:
      'Mounted after the download control, once the user already has what they came for. The workflow is complete before this exists.',
  },

  /**
   * Bottom of the explanatory prose, above the related-tools links. The last
   * thing before the reader leaves, and separated from every control on the page
   * by several screens of content.
   */
  afterContent: {
    id: 'afterContent',
    label: 'End of article',
    reservedClass: 'h-[250px] md:h-[90px]',
    visibilityClass: 'block',
    reservedSizes: '300 × 250 / 728 × 90',
    format: 'auto',
    lazy: true,
    rationale:
      'Below the FAQ, far from any tool control. Reading is finished; there is no workflow left to interrupt.',
  },

  /**
   * One unit inside a listing grid, after the first row. Listing pages have no
   * controls to misclick and no workflow to interrupt.
   */
  listing: {
    id: 'listing',
    label: 'In listing',
    reservedClass: 'h-[100px] md:h-[90px]',
    visibilityClass: 'block',
    reservedSizes: '320 × 100 / 728 × 90',
    format: 'horizontal',
    lazy: true,
    rationale:
      'Between rows of tool cards on browse pages. No file input, no processing, nothing to misclick.',
  },
};

export const adPlacementIds: AdPlacement[] = Object.keys(adPlacements) as AdPlacement[];

/**
 * ── Pages that carry no ads at all ──
 * The homepage is the shop window: it is where trust is won, it has the lowest
 * commercial intent on the site, and one banner there costs more in impression
 * than it earns in revenue. Privacy and terms carry none either, because an ad
 * beside a privacy commitment reads as a contradiction.
 *
 * This is a product decision, not a technical limit — the page templates simply
 * do not render a slot. `scripts/check-integrity.mjs` asserts it, and asserts the
 * per-page cap below, because a rule kept only in someone's head drifts.
 */
export const AD_FREE_ROUTES: readonly string[] = ['/', '/privacy', '/terms'];

/** Hard ceiling of ad units on any single page. Two. Not negotiable upward. */
export const MAX_ADS_PER_PAGE = 2;

const flag = (value: string | undefined): boolean => value === 'true';

/** AdSense is the only provider wired up. `'none'` is the default and is silent. */
export type AdProvider = 'none' | 'adsense';

function readProvider(): AdProvider {
  return process.env.NEXT_PUBLIC_ADS_PROVIDER === 'adsense' ? 'adsense' : 'none';
}

export const adProvider: AdProvider = readProvider();

/** `ca-pub-…`. Without it nothing can render, which is the intended failure mode. */
export const adsenseClient: string | undefined =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || undefined;

/**
 * Per-placement slot ids. A placement with no id configured renders nothing,
 * so a partially-configured account degrades to fewer ads rather than to broken
 * empty boxes.
 *
 * Read as separate literals rather than a computed key, because Next.js inlines
 * `process.env.NEXT_PUBLIC_*` at build time by exact textual match — a dynamic
 * `process.env[name]` lookup silently returns undefined in the browser.
 */
const slotIds: Readonly<Record<AdPlacement, string | undefined>> = {
  rail: process.env.NEXT_PUBLIC_ADSENSE_SLOT_RAIL?.trim() || undefined,
  afterResult: process.env.NEXT_PUBLIC_ADSENSE_SLOT_AFTER_RESULT?.trim() || undefined,
  afterContent: process.env.NEXT_PUBLIC_ADSENSE_SLOT_AFTER_CONTENT?.trim() || undefined,
  listing: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LISTING?.trim() || undefined,
};

export function adSlotId(placement: AdPlacement): string | undefined {
  return slotIds[placement];
}

/**
 * Whether ads can render at all.
 *
 * Three independent conditions, all required. Forgetting the publisher id in
 * production means no ads, which is a revenue bug; the alternative — rendering a
 * reserved 250px void on every page — is a UX bug, and a UX bug is the one this
 * codebase is not willing to ship.
 */
export const adsEnabled: boolean =
  flag(process.env.NEXT_PUBLIC_ADS_ENABLED) && adProvider === 'adsense' && adsenseClient !== undefined;

/**
 * Draws a labelled outline where each reservation sits, with its exact
 * dimensions, so the layout can be reviewed at every breakpoint without a live
 * account.
 *
 * It is emphatically **not** a mock advertisement. It carries the word
 * "reserved", the placement name and the pixel size, on a dashed border, and it
 * is unclickable. A placeholder that imitated an ad — or worse, a button —
 * would be the exact deceptive pattern the brief rules out, and would train us
 * to accept a layout we would never accept once real.
 */
export const adsDebug: boolean = flag(process.env.NEXT_PUBLIC_ADS_DEBUG);

/** The AdSense loader URL. Only ever requested when {@link adsEnabled}. */
export function adsenseScriptSrc(): string | undefined {
  if (!adsEnabled || adsenseClient === undefined) return undefined;
  return `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsenseClient)}`;
}

/**
 * Origins the ad provider needs, for the CSP in `nginx.conf`.
 *
 * Exported from here so the header and the loader can never disagree: if a
 * future provider is added above, its origins go here in the same commit, and
 * the deployment config reads this list rather than repeating it.
 */
export const adOrigins: readonly string[] =
  adProvider === 'adsense'
    ? [
        'https://pagead2.googlesyndication.com',
        'https://googleads.g.doubleclick.net',
        'https://tpc.googlesyndication.com',
        'https://www.google.com',
        'https://adservice.google.com',
      ]
    : [];


