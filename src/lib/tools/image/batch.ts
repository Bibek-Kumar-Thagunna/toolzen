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
  /**
   * True when every candidate encode came out bigger than the file that was
   * dropped in, so the original was handed back untouched.
   *
   * This is the single most important field here. A tool called "compressor"
   * that returns a larger file has not compressed anything — it has damaged the
   * input and charged the user a download for the privilege. Reporting the
   * growth honestly, which is what this did before, is necessary and nowhere
   * near sufficient: the user still ends up with the worse file.
   */
  keptOriginal: boolean;
  /** Which format actually won, for the summary line. e.g. 'webp'. */
  format: string;
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

/**
 * An encoder that is not `canvas.toBlob`.
 *
 * The one that exists today writes indexed PNGs, which a canvas cannot do at
 * all — and which is the only way to make a PNG meaningfully smaller. It gets
 * the decoded image and returns finished bytes, so the batch runner still owns
 * the comparison, the never-inflate rule and the naming.
 */
export type CustomEncoder = (
  image: DecodedImage,
  signal: AbortSignal,
) => Promise<{ ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; error: string; reason: FailureReason }>;

/** One thing to try encoding. Several may be offered; the smallest wins. */
export interface ImageCandidate {
  options: Omit<EncodeOptions, 'signal'>;
  /** Output file name. The caller owns naming; see `outputFileName`. */
  name: string;
  mime: string;
  /** Short label for the summary line, e.g. 'webp'. */
  format: string;
  /**
   * Used instead of the canvas encoder when present. `options` is then ignored
   * for the encode itself and kept only so a candidate is still describable.
   */
  encode?: CustomEncoder;
}

/**
 * What a tool decides, per file.
 *
 * `candidates` is a list rather than a single encode because "make this
 * smaller" has no single right answer. A screenshot re-encoded as PNG through a
 * canvas is reliably *larger* than the optimised PNG it came from — browsers
 * ship a basic PNG writer, not `pngcrush` — while the same screenshot as WebP is
 * a fraction of the size. A photograph is the other way round. Encoding the
 * plausible options and keeping whichever is smallest is the only approach that
 * is right for both, and it costs a few hundred milliseconds.
 */
export type ImagePlan =
  | { skip: string }
  | {
      skip?: undefined;
      candidates: ImageCandidate[];
      /**
       * Discard every candidate that is not smaller than the input and hand the
       * original back untouched. On for compression and conversion-to-smaller;
       * off for a resize or a crop, where the output is a different picture and
       * a larger file can be exactly what was asked for.
       */
      neverInflate?: boolean;
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

      // Encode every candidate and keep the smallest. A candidate this browser
      // cannot write reports `encode_unsupported`, which is a statement about
      // the engine rather than the file — but only fatal if it leaves us with
      // nothing, so it is collected and judged after the loop.
      let best: { bytes: Uint8Array; candidate: ImageCandidate; width: number; height: number } | null = null;
      let lastError: { error: string; reason: FailureReason } | null = null;

      for (const candidate of decision.candidates) {
        await ctx.checkpoint();

        // A custom encoder returns bytes directly; the canvas path returns a
        // Blob. Both are normalised here so the comparison below sees one shape.
        let produced:
          | { ok: true; bytes: Uint8Array; width: number; height: number }
          | { ok: false; error: string; reason: FailureReason };
        if (candidate.encode) {
          produced = await candidate.encode(decoded, ctx.signal);
        } else {
          const encoded = await encodeImage(decoded, { ...candidate.options, signal: ctx.signal });
          produced = encoded.ok
            ? {
                ok: true,
                bytes: new Uint8Array(await encoded.blob.arrayBuffer()),
                width: encoded.size.width,
                height: encoded.size.height,
              }
            : { ok: false, error: encoded.error, reason: encoded.reason };
        }

        if (!produced.ok) {
          if (produced.reason === 'cancelled') {
            return { ok: false, error: produced.error, reason: produced.reason };
          }
          lastError = { error: produced.error, reason: produced.reason };
          continue;
        }
        if (best !== null && produced.bytes.length >= best.bytes.length) continue;
        best = {
          bytes: produced.bytes,
          candidate,
          width: produced.width,
          height: produced.height,
        };
      }

      if (best === null) {
        if (lastError && FATAL.has(lastError.reason)) {
          return { ok: false, error: lastError.error, reason: lastError.reason };
        }
        skipped.push({
          name: file.name,
          reason: lastError?.error ?? 'This image could not be re-encoded in any available format.',
        });
        continue;
      }

      /*
       * The guarantee: never hand back something bigger than what was dropped in.
       *
       * When the best encode still loses to the original, the original wins and
       * is returned byte-for-byte — which also means no quality is lost to a
       * pointless round trip through the decoder.
       */
      const inflated = decision.neverInflate === true && best.bytes.length >= file.size;
      if (inflated) {
        outputs.push({
          name: uniqueName(file.name, used),
          bytes: new Uint8Array(await file.arrayBuffer()),
          mime: file.type || sniffed.mime,
          originalName: file.name,
          originalSize: file.size,
          size: file.size,
          width: sniffed.width ?? best.width,
          height: sniffed.height ?? best.height,
          keptOriginal: true,
          format: sniffed.extension,
        });
      } else {
        outputs.push({
          name: uniqueName(best.candidate.name, used),
          bytes: best.bytes,
          mime: best.candidate.mime,
          originalName: file.name,
          originalSize: file.size,
          size: best.bytes.length,
          width: best.width,
          height: best.height,
          keptOriginal: false,
          format: best.candidate.format,
        });
      }
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
