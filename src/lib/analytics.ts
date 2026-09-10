/**
 * ============================================================================
 * ANALYTICS
 * ============================================================================
 * A typed event vocabulary with a pluggable sink, not an analytics vendor.
 *
 * Why a closed union instead of `track(name: string, props: object)`: the event
 * list is a product artefact. Renaming `download_clicked` in one tool and not
 * another silently splits a funnel, and nobody notices for a month. Here the
 * compiler notices.
 *
 * PRIVACY. This is deliberately narrow. No identifiers, no cookies, no
 * cross-site state, no free-text capture. In particular a payload may never
 * contain a file name, file contents, pasted text, a URL a user typed into a
 * tool, or anything derived from them — several tools exist precisely so that a
 * JWT or a password never leaves the device, and an analytics call that leaked
 * one would make the whole privacy claim a lie. The types below only admit
 * bounded, non-identifying values, and `sizeBucket` exists so file size is
 * reported as a range rather than a number that could help fingerprint a
 * specific file.
 *
 * The default sink is a no-op. Nothing is collected until a provider is
 * configured in `layout.tsx`, which keeps a local dev run and a self-hosted
 * deployment silent by default.
 * ============================================================================
 */

export type AnalyticsEvent =
  /** A tool page was viewed. Fired once per navigation, from the page itself. */
  | { name: 'tool_view'; slug: string; category: string }
  /** First real interaction: a file chosen, text typed, a form touched. */
  | { name: 'tool_started'; slug: string }
  | { name: 'file_uploaded'; slug: string; count: number; sizeBucket: SizeBucket; kind: string }
  | { name: 'processing_started'; slug: string; count?: number }
  | { name: 'processing_completed'; slug: string; durationBucket: DurationBucket; count?: number }
  /** `reason` is a stable machine code from the engine, never a raw message. */
  | { name: 'processing_failed'; slug: string; reason: FailureReason }
  | { name: 'download_clicked'; slug: string; format?: string; count?: number }
  | { name: 'copy_clicked'; slug: string; target?: string }
  | { name: 'share_clicked'; slug: string; method: 'link' | 'native' }
  /** Query length only — never the query text, which can contain anything. */
  | { name: 'tool_search'; queryLength: number; resultCount: number }
  | { name: 'tool_search_result_clicked'; slug: string; position: number }
  | { name: 'theme_changed'; theme: 'light' | 'dark' | 'system' }
  | { name: 'favorite_toggled'; slug: string; favorited: boolean };

export type EventName = AnalyticsEvent['name'];

/**
 * File sizes as ranges. A byte count is unnecessarily precise for answering
 * "are people hitting the limit?", and precision here is a fingerprinting
 * surface for no product benefit.
 */
export type SizeBucket = '<100KB' | '100KB-1MB' | '1-5MB' | '5-20MB' | '20MB+';

export function sizeBucket(bytes: number): SizeBucket {
  if (bytes < 100_000) return '<100KB';
  if (bytes < 1_000_000) return '100KB-1MB';
  if (bytes < 5_000_000) return '1-5MB';
  if (bytes < 20_000_000) return '5-20MB';
  return '20MB+';
}

/** Coarse timings. Enough to spot a regression, not enough to profile a user. */
export type DurationBucket = '<250ms' | '250ms-1s' | '1-5s' | '5-15s' | '15s+';

export function durationBucket(ms: number): DurationBucket {
  if (ms < 250) return '<250ms';
  if (ms < 1000) return '250ms-1s';
  if (ms < 5000) return '1-5s';
  if (ms < 15_000) return '5-15s';
  return '15s+';
}

/**
 * Why a job failed, as a fixed vocabulary.
 *
 * Engines return human sentences for the UI; those sentences are for people and
 * will be rewritten. A stable code is what a dashboard can group by, and it also
 * guarantees no engine message — which may quote the user's input — is ever
 * transmitted.
 */
export type FailureReason =
  | 'unsupported_type'
  | 'too_large'
  | 'too_many_files'
  | 'corrupt_input'
  | 'password_protected'
  | 'invalid_input'
  | 'out_of_memory'
  | 'encode_unsupported'
  | 'cancelled'
  | 'unknown';

export type AnalyticsSink = (event: AnalyticsEvent) => void;

const noop: AnalyticsSink = () => {};

let sink: AnalyticsSink = noop;

/**
 * Install the sink. Called once, client-side, from the analytics provider
 * component. Passing `null` restores the no-op, which is what makes "analytics
 * are off unless configured" the honest default rather than a claim.
 */
export function setAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next ?? noop;
}

/**
 * Record an event. Never throws: a broken analytics script must not take a tool
 * down with it, so the sink is wrapped and a failure is dropped. In development
 * the failure is logged, because a silently dead sink is its own bug.
 */
export function track(event: AnalyticsEvent): void {
  try {
    sink(event);
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[analytics] sink threw, event dropped', event.name, error);
    }
  }
}

/**
 * Bind the slug once so a tool component does not repeat it on every call, and
 * cannot report the wrong one. The returned helpers mirror the events a tool
 * actually fires; page-level events stay on {@link track}.
 */
export function toolTracker(slug: string) {
  return {
    started: () => track({ name: 'tool_started', slug }),
    filesAdded: (files: readonly { size: number; type: string }[]) =>
      track({
        name: 'file_uploaded',
        slug,
        count: files.length,
        sizeBucket: sizeBucket(files.reduce((sum, file) => sum + file.size, 0)),
        // Family only: "image", "application". The subtype can carry a codec
        // name, which is fine, but the family is what we group by.
        kind: files[0]?.type.split('/')[0] || 'unknown',
      }),
    processingStarted: (count?: number) => track({ name: 'processing_started', slug, count }),
    processingCompleted: (ms: number, count?: number) =>
      track({ name: 'processing_completed', slug, durationBucket: durationBucket(ms), count }),
    processingFailed: (reason: FailureReason) =>
      track({ name: 'processing_failed', slug, reason }),
    downloaded: (format?: string, count?: number) =>
      track({ name: 'download_clicked', slug, format, count }),
    copied: (target?: string) => track({ name: 'copy_clicked', slug, target }),
    shared: (method: 'link' | 'native') => track({ name: 'share_clicked', slug, method }),
  };
}

export type ToolTracker = ReturnType<typeof toolTracker>;
