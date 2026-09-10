/**
 * Turning an exception into a sentence.
 *
 * Engines return `{ ok: false, reason, error }` with prose written for a person,
 * so the ordinary failure path never comes through here. This module handles the
 * other kind: something threw. A codec rejecting a malformed frame, an
 * allocation failing on a phone, a browser API missing in a webview.
 *
 * Those exceptions must not reach the interface. `TypeError: Cannot read
 * properties of null (reading 'width')` tells the user nothing, tells them it is
 * their fault, and tells anyone reading over their shoulder something about how
 * the page is built. It is replaced with a line that says what happened and what
 * to try.
 *
 * The classification is deliberately coarse — three outcomes — because a
 * category the interface acts on differently is worth having and everything else
 * is noise. Both halves of the result matter and go to different places: `error`
 * is shown to the user, `reason` is the only part sent to analytics.
 *
 * This lives in `src/lib` rather than in the hook that calls it because it is
 * pure, it is the kind of rule that gets quietly weakened during a debugging
 * session, and a test is the only thing that notices.
 */

import type { FailureReason } from './analytics.ts';

export interface ClassifiedFailure {
  reason: FailureReason;
  /** A sentence for the user. Never contains anything from the exception. */
  error: string;
}

export const GENERIC_FAILURE =
  'Something went wrong while processing that. Trying again usually works — if it does not, the file may not be one this tool can read.';

export const OUT_OF_MEMORY_FAILURE =
  'This browser tab ran out of memory. Try again with fewer files, or with smaller ones.';

/**
 * Reading `name` rather than using `instanceof`: an abort arrives as a
 * `DOMException`, whose relationship to `Error` has varied by engine and by how
 * the abort was raised. The name is the part every engine agrees on.
 */
function named(cause: unknown, name: string): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { name?: unknown }).name === name
  );
}

/**
 * Did the user stop this? A cancelled job is not a failure to report to the
 * person who asked for it: the interface goes back to where it was and says
 * nothing.
 */
export function isCancellation(cause: unknown): boolean {
  return named(cause, 'AbortError');
}

/**
 * Allocation failures are the one class worth naming, because the advice that
 * follows is specific and it works: fewer files, or smaller ones. `RangeError`
 * is what a failed `ArrayBuffer` allocation throws in V8 and JavaScriptCore;
 * `QuotaExceededError` is what a canvas of impossible dimensions throws in
 * WebKit.
 */
export function isOutOfMemory(cause: unknown): boolean {
  return cause instanceof RangeError || named(cause, 'QuotaExceededError');
}

/**
 * Classify a thrown value. Cancellations are the caller's business — they get
 * `cancelled` here, but the interface should check {@link isCancellation} first
 * and show nothing at all.
 */
export function classifyFailure(cause: unknown): ClassifiedFailure {
  if (isCancellation(cause)) return { reason: 'cancelled', error: '' };
  if (isOutOfMemory(cause)) return { reason: 'out_of_memory', error: OUT_OF_MEMORY_FAILURE };
  return { reason: 'unknown', error: GENERIC_FAILURE };
}
