/**
 * ============================================================================
 * IMAGE BATCH PIPELINE
 * ============================================================================
 * The loop that six image tools would otherwise each write for themselves:
 * read the bytes, look at the header, decode, encode, keep the result, free the
 * pixels, move on.
 *
 * Compressing, resizing, cropping and the three converters differ in exactly
 * one respect — what `EncodeOptions` they want for a given file, and what to
 * call the output. Everything around that is identical, and the identical part
 * is where the subtle mistakes live: forgetting `image.close()` and running a
 * phone out of memory on the twelfth photo, letting one corrupt file abort the
 * other nineteen, dropping the `checkpoint()` that keeps the tab responsive.
 * Written once, those are fixed once.
 *
 * ── The plan callback is the whole extension point ─────────────────────────
 * A tool receives the decoded image and the sniffed header and returns either
 * the encode options and a file name, or a reason to skip this file. It never
 * touches the canvas, the loop, or the error handling.
 *
 * ── Skipping versus failing ───────────────────────────────────────────────
 * A file that cannot be read is *skipped*: its reason is recorded and the batch
 * carries on, because losing nineteen good results to one truncated download is
 * a bad trade. Two outcomes stop everything instead:
 *
 *   - `cancelled`, because continuing would burn through nineteen more encodes
 *     that nobody is waiting for;
 *   - `encode_unsupported`, because that is a statement about the *browser*
 *     rather than about the file, and every remaining image would fail
 *     identically. Reporting it nineteen times is noise.
 *
 * ── Bytes, not Blobs ──────────────────────────────────────────────────────
 * Each encode is drained to a `Uint8Array` before the next one starts. A ZIP has
 * to be built synchronously inside the click that asked for it — Safari and
 * Firefox only honour a programmatic download inside the user-activation window
 * — and `blob.arrayBuffer()` is a promise. Draining here is what makes the
 * download button work later.
 *
 * No React, no DOM beyond the canvas the codec already owns, and no network:
 * this module is covered by the browser-processing check like every other engine
 * under `src/lib/tools`.
 * ============================================================================
 */
import type { FailureReason } from '../../analytics.ts';
import { decodeImage, encodeImage, type DecodedImage, type EncodeOptions } from './codec.ts';
import { sniffImage, type Sniffed } from './format.ts';

/** One finished image, with everything the result panel needs to describe it. */
export interface ImageOutput {
  /** Output file name, already sanitised and unique within the batch. */
  name: string;
  bytes: Uint8Array;
  mime: string;
  /** What the user dropped in, for the before-and-after line. */
  originalName: string;
  originalSize: number;
  size: number;
  width: number;
  height: number;
}

/** A file that was left out, and the sentence explaining why. */
export interface SkippedFile {
  name: string;
  reason: string;
}

export interface ImageBatchResult {
  outputs: ImageOutput[];
  skipped: SkippedFile[];
  /** Sum of the input sizes of the files that produced an output. */
  totalBefore: number;
  totalAfter: number;
}

/** What a tool decides, per file. */
export type ImagePlan =
  | { skip: string }
  | {
      skip?: undefined;
      options: Omit<EncodeOptions, 'signal'>;
      /** Output file name. The caller owns naming; see `outputFileName`. */
      name: string;
      mime: string;
    };

export interface PlanInput {
  file: File;
  image: DecodedImage;
  sniffed: Sniffed;
  index: number;
}

/**
 * Structural subset of `RunContext` from `useToolRun`. Declared here rather than
 * imported so this module keeps no dependency on a React component — the
 * integrity check requires `src/lib` to stand alone, and a lib importing a
 * component is the first step to a lib importing the registry.
 */
export interface BatchContext {
  signal: AbortSignal;
  report: (done: number, total: number) => void;
  checkpoint: () => Promise<void>;
}

export type BatchOutcome =
  | { ok: true; value: ImageBatchResult }
  | { ok: false; error: string; reason: FailureReason };

/** Reasons that end the whole run rather than skipping one file. */
const FATAL: ReadonlySet<FailureReason> = new Set<FailureReason>([
  'cancelled',
  'encode_unsupported',
  'out_of_memory',
]);

export async function runImageBatch(
  files: readonly File[],
  ctx: BatchContext,
  plan: (input: PlanInput) => ImagePlan,
): Promise<BatchOutcome> {
  if (files.length === 0) {
    return { ok: false, error: 'Add at least one image first.', reason: 'invalid_input' };
  }

  const outputs: ImageOutput[] = [];
  const skipped: SkippedFile[] = [];
  const used = new Set<string>();

  for (let index = 0; index < files.length; index += 1) {
    // Yields a turn to the browser *and* throws if the user pressed Cancel.
    await ctx.checkpoint();

    const file = files[index];
    if (!file) continue;

    let decoded: DecodedImage | null = null;
    try {
      // The header is read from the first 64 KB rather than inferred from the
      // extension, so a PNG somebody renamed to .jpg is treated as a PNG.
      const head = new Uint8Array(await file.slice(0, 65_536).arrayBuffer());
      const sniffed = sniffImage(head);

      const result = await decodeImage(file, { signal: ctx.signal });
      if (!result.ok) {
        if (FATAL.has(result.reason)) return { ok: false, error: result.error, reason: result.reason };
        skipped.push({ name: file.name, reason: result.error });
        continue;
      }
      decoded = result.image;

      const decision = plan({ file, image: decoded, sniffed, index });
      if (decision.skip !== undefined) {
        skipped.push({ name: file.name, reason: decision.skip });
        continue;
      }

      const encoded = await encodeImage(decoded, { ...decision.options, signal: ctx.signal });
      if (!encoded.ok) {
        if (FATAL.has(encoded.reason)) return { ok: false, error: encoded.error, reason: encoded.reason };
        skipped.push({ name: file.name, reason: encoded.error });
        continue;
      }

      outputs.push({
        name: uniqueName(decision.name, used),
        bytes: new Uint8Array(await encoded.blob.arrayBuffer()),
        mime: encoded.blob.type || decision.mime,
        originalName: file.name,
        originalSize: file.size,
        size: encoded.blob.size,
        width: encoded.size.width,
        height: encoded.size.height,
      });
    } finally {
      // Idempotent, and the reason a batch of twenty photographs does not
      // exhaust memory: an ImageBitmap holds its pixels outside the JS heap,
      // where the collector will not reclaim them promptly.
      decoded?.close();
    }

    ctx.report(index + 1, files.length);
  }

  if (outputs.length === 0) {
    return {
      ok: false,
      // The skip reasons are already specific; repeating the first one is more
      // useful than a generic "nothing worked".
      error:
        skipped[0]?.reason ??
        'None of those images could be read. Check that they are real image files and try again.',
      reason: 'corrupt_input',
    };
  }

  return {
    ok: true,
    value: {
      outputs,
      skipped,
      totalBefore: outputs.reduce((sum, out) => sum + out.originalSize, 0),
      totalAfter: outputs.reduce((sum, out) => sum + out.size, 0),
    },
  };
}

/**
 * Two files called `photo.jpg` in one batch would collide inside the ZIP, and
 * `zip.ts` de-duplicates as a safety net — but it does so without knowing which
 * result is which, so doing it here keeps the name on screen and the name in the
 * archive the same string.
 */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})${extension}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}
