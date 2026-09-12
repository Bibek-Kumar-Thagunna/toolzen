'use client';

/**
 * ============================================================================
 * TOOL MOUNT
 * ============================================================================
 * Turns a slug into the right interactive component.
 *
 * ── Why every entry is a `next/dynamic` call and not a plain import ────────
 * `/tools/[slug]` is one route. Next builds one client bundle for a route and
 * serves it to every parameter of that route, so a static
 * `{ 'json-formatter': JsonFormatterTool, … }` map would ship all twenty-four
 * tools — the QR encoder, the PDF writer, the colour engine, every wordlist —
 * to somebody who opened the word counter. Measured on this codebase that is
 * the difference between roughly 40 KB and roughly 600 KB of JavaScript on a
 * page whose entire job is counting words.
 *
 * `dynamic(() => import('…'))` with a **string literal** lets the bundler see
 * the dependency, split it into its own chunk, and load only the chunk the page
 * asks for. The literal matters: a computed specifier such as
 * `import(\`./\${name}Tool\`)` defeats static analysis and quietly bundles the
 * whole directory again.
 *
 * ── Why SSR stays on ───────────────────────────────────────────────────────
 * `ssr: false` is the reflex for anything touching the DOM, and it is the wrong
 * default here: it leaves a hole where the tool should be until hydration
 * finishes, which is a visible layout shift on exactly the element the page
 * exists for, and Core Web Vitals scores it as one. These components read
 * `window` only inside effects and event handlers — never during render — so
 * they render on the server perfectly well, and the user sees the controls in
 * the first paint.
 *
 * ── Why the fallback is a fixed-height skeleton ────────────────────────────
 * The `loading` state only appears on a client-side navigation, but when it
 * does it must occupy the same vertical space the tool will, or arriving from
 * `/tools` shoves the article below it down the page. `minHeight` is a
 * deliberate over-estimate: reserving slightly too much moves content up by a
 * few pixels when the tool lands, which nobody notices; reserving too little
 * moves it down, which everybody does.
 *
 * ── The registry is not imported here ──────────────────────────────────────
 * This file is a client component. `@/lib/registry` carries every tool's FAQ
 * and long-form prose and must never cross the boundary (see its header). The
 * page passes the slug as a string; that is the entire contract.
 * ============================================================================
 */
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

import { Skeleton } from '@/components/ui/Skeleton';

/** Reserved while a chunk is in flight. Tuned to the tallest common surface. */
function ToolSkeleton() {
  return (
    <div className="space-y-4" style={{ minHeight: 380 }} aria-hidden="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-10 w-40" />
    </div>
  );
}

const loading = () => <ToolSkeleton />;

/**
 * Slug → component. Every value is its own chunk.
 *
 * `scripts/check-integrity.mjs` asserts that this map's keys are exactly the
 * registry's slugs, so a tool added to the registry without a component here
 * fails the build rather than rendering an empty page in production.
 */
const registry: Record<string, ComponentType> = {
  // -- image ----------------------------------------------------------------
  'image-compressor': dynamic(
    () => import('./ImageCompressorTool').then((m) => m.ImageCompressorTool),
    { loading },
  ),
  'image-resizer': dynamic(() => import('./ImageResizerTool').then((m) => m.ImageResizerTool), {
    loading,
  }),
  'image-cropper': dynamic(() => import('./ImageCropperTool').then((m) => m.ImageCropperTool), {
    loading,
  }),
  'jpg-to-png': dynamic(() => import('./JpgToPngTool').then((m) => m.JpgToPngTool), { loading }),
  'png-to-jpg': dynamic(() => import('./PngToJpgTool').then((m) => m.PngToJpgTool), { loading }),
  'png-to-webp': dynamic(() => import('./PngToWebpTool').then((m) => m.PngToWebpTool), { loading }),
  'webp-to-jpg': dynamic(() => import('./WebpToJpgTool').then((m) => m.WebpToJpgTool), { loading }),
  'webp-to-png': dynamic(() => import('./WebpToPngTool').then((m) => m.WebpToPngTool), { loading }),
  'images-to-pptx': dynamic(
    () => import('./ImagesToPptxTool').then((m) => m.ImagesToPptxTool),
    { loading },
  ),

  'compress-jpeg': dynamic(() => import('./FormatVariants').then((m) => m.CompressJpegTool), {
    loading,
  }),
  'compress-png': dynamic(() => import('./FormatVariants').then((m) => m.CompressPngTool), {
    loading,
  }),

  // -- pdf ------------------------------------------------------------------
  'image-to-pdf': dynamic(() => import('./ImageToPdfTool').then((m) => m.ImageToPdfTool), {
    loading,
  }),
  'merge-pdf': dynamic(() => import('./MergePdfTool').then((m) => m.MergePdfTool), { loading }),
  'split-pdf': dynamic(() => import('./SplitPdfTool').then((m) => m.SplitPdfTool), { loading }),
  'pdf-to-jpg': dynamic(() => import('./PdfToJpgTool').then((m) => m.PdfToJpgTool), { loading }),
  'rotate-pdf': dynamic(() => import('./RotatePdfTool').then((m) => m.RotatePdfTool), { loading }),
  'remove-pdf-pages': dynamic(
    () => import('./RemovePdfPagesTool').then((m) => m.RemovePdfPagesTool),
    { loading },
  ),
  'compress-pdf': dynamic(() => import('./CompressPdfTool').then((m) => m.CompressPdfTool), {
    loading,
  }),
  'extract-pdf-text': dynamic(
    () => import('./ExtractPdfTextTool').then((m) => m.ExtractPdfTextTool),
    { loading },
  ),
  'pdf-to-pptx': dynamic(() => import('./PdfToPptxTool').then((m) => m.PdfToPptxTool), { loading }),
  'jpg-to-pdf': dynamic(() => import('./FormatVariants').then((m) => m.JpgToPdfTool), { loading }),
  'png-to-pdf': dynamic(() => import('./FormatVariants').then((m) => m.PngToPdfTool), { loading }),
  'pdf-to-png': dynamic(() => import('./FormatVariants').then((m) => m.PdfToPngTool), { loading }),

  // -- files ----------------------------------------------------------------
  'password-protect-files': dynamic(
    () => import('./LockFilesTool').then((m) => m.LockFilesTool),
    { loading },
  ),
  'unlock-file': dynamic(() => import('./UnlockFileTool').then((m) => m.UnlockFileTool), {
    loading,
  }),

  // -- text -----------------------------------------------------------------
  'word-counter': dynamic(() => import('./WordCounterTool').then((m) => m.WordCounterTool), {
    loading,
  }),
  'case-converter': dynamic(() => import('./CaseConverterTool').then((m) => m.CaseConverterTool), {
    loading,
  }),
  'remove-duplicate-lines': dynamic(
    () => import('./RemoveDuplicateLinesTool').then((m) => m.RemoveDuplicateLinesTool),
    { loading },
  ),
  'slug-generator': dynamic(() => import('./SlugGeneratorTool').then((m) => m.SlugGeneratorTool), {
    loading,
  }),

  // -- developer ------------------------------------------------------------
  'json-formatter': dynamic(() => import('./JsonFormatterTool').then((m) => m.JsonFormatterTool), {
    loading,
  }),
  'base64-encoder': dynamic(() => import('./Base64EncoderTool').then((m) => m.Base64EncoderTool), {
    loading,
  }),
  'jwt-decoder': dynamic(() => import('./JwtDecoderTool').then((m) => m.JwtDecoderTool), {
    loading,
  }),
  'url-encoder': dynamic(() => import('./UrlEncoderTool').then((m) => m.UrlEncoderTool), {
    loading,
  }),
  'uuid-generator': dynamic(() => import('./UuidGeneratorTool').then((m) => m.UuidGeneratorTool), {
    loading,
  }),

  // -- calculators ----------------------------------------------------------
  'percentage-calculator': dynamic(
    () => import('./PercentageCalculatorTool').then((m) => m.PercentageCalculatorTool),
    { loading },
  ),
  'age-calculator': dynamic(() => import('./AgeCalculatorTool').then((m) => m.AgeCalculatorTool), {
    loading,
  }),
  'date-difference-calculator': dynamic(
    () => import('./DateDifferenceCalculatorTool').then((m) => m.DateDifferenceCalculatorTool),
    { loading },
  ),
  'emi-calculator': dynamic(() => import('./EmiCalculatorTool').then((m) => m.EmiCalculatorTool), {
    loading,
  }),
  'bmi-calculator': dynamic(() => import('./BmiCalculatorTool').then((m) => m.BmiCalculatorTool), {
    loading,
  }),
  'unit-converter': dynamic(() => import('./UnitConverterTool').then((m) => m.UnitConverterTool), {
    loading,
  }),
  'discount-calculator': dynamic(
    () => import('./DiscountCalculatorTool').then((m) => m.DiscountCalculatorTool),
    { loading },
  ),

  // -- generators -----------------------------------------------------------
  'qr-code-generator': dynamic(
    () => import('./QrCodeGeneratorTool').then((m) => m.QrCodeGeneratorTool),
    { loading },
  ),
  'password-generator': dynamic(
    () => import('./PasswordGeneratorTool').then((m) => m.PasswordGeneratorTool),
    { loading },
  ),
  'lorem-ipsum-generator': dynamic(
    () => import('./LoremIpsumTool').then((m) => m.LoremIpsumTool),
    { loading },
  ),
  'favicon-generator': dynamic(
    () => import('./FaviconGeneratorTool').then((m) => m.FaviconGeneratorTool),
    { loading },
  ),
  'color-palette-generator': dynamic(
    () => import('./ColorPaletteGeneratorTool').then((m) => m.ColorPaletteGeneratorTool),
    { loading },
  ),
};

export function ToolMount({ slug }: { slug: string }) {
  const Component = registry[slug];

  // Unreachable in a correct build — `generateStaticParams` only ever produces
  // registry slugs, and the integrity check keeps this map in step with it. It
  // returns null rather than throwing because a missing tool should cost the
  // reader the widget, not the article, the FAQ and the rest of the page.
  if (!Component) return null;

  return <Component />;
}
