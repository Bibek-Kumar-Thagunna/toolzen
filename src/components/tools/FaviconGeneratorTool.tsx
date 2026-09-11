'use client';

/**
 * ============================================================================
 * FAVICON GENERATOR
 * ============================================================================
 * One picture in, the whole set of files a site needs out — plus the four lines
 * of markup that make a browser use them.
 *
 * ── Why so few files ──────────────────────────────────────────────────────
 * The generators people usually find produce about twenty files and a
 * twenty-line block of `<link>` tags, most of it aimed at browsers that no
 * longer exist: Windows tile metadata, six Apple sizes for iOS versions from
 * a decade ago, a Safari pinned-tab mask. Shipping all of it is not free — it
 * is a directory of files to keep in step every time a logo changes.
 *
 * What is actually required today is four files: an ICO for desktop browsers
 * and anything old, two PNGs for Android and the manifest, and one
 * apple-touch-icon for iOS home screens. That is what this produces.
 *
 * ── Why the ICO carries three sizes ───────────────────────────────────────
 * A browser tab draws the icon at 16 pixels; a bookmarks bar and a Windows
 * shortcut want 32; some list views want 48. One image scaled down by the
 * operating system at draw time looks noticeably worse than one encoded at the
 * right size, so all three go in the container. See `ico.ts` for the format.
 *
 * ── Why each size is a separate downscale, not one canvas reused ──────────
 * `encodeImage` reduces through a chain of halvings, which is most of why a
 * 16-pixel icon made here still reads as the logo rather than as mush. Drawing
 * a 1024-pixel source straight into a 16-pixel box samples roughly one pixel in
 * four thousand and throws the rest away.
 *
 * ── Why the Apple icon gets a background and the others may not ───────────
 * iOS does not honour transparency in a home-screen icon: it composites it onto
 * black. A transparent logo therefore arrives on a phone as a dark tile, which
 * is the single most common complaint about generated icon sets. Here the
 * Apple icon is always flattened onto a colour, and the control says why.
 * ============================================================================
 */
import { useCallback, useEffect, useState } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { humanBytes } from '@/lib/files/bytes';
import { downloadZip } from '@/lib/files/download';
import type { ZipEntry } from '@/lib/files/zip';
import { RASTER_IMAGE_ONE } from '@/lib/tools/accepts';
import { decodeImage, encodeImage, type DecodedImage } from '@/lib/tools/image/codec';
import {
  buildIco,
  faviconManifest,
  faviconMarkup,
  ICO_SIZES,
  type IcoImage,
} from '@/lib/tools/image/ico';

const SLUG = 'favicon-generator';

/** The PNGs that go in the download, beside the ICO. */
const PNG_OUTPUTS = [
  { name: 'icon-192.png', size: 192, flatten: false, note: 'Android home screen and the manifest' },
  { name: 'icon-512.png', size: 512, flatten: false, note: 'Install prompts and splash screens' },
  { name: 'apple-touch-icon.png', size: 180, flatten: true, note: 'iPhone and iPad home screens' },
] as const;

/** Below this the source is being enlarged, and an upscaled icon looks soft. */
const COMFORTABLE_EDGE = 256;

interface Preview {
  size: number;
  url: string;
  bytes: number;
}

interface Output {
  entries: ZipEntry[];
  previews: Preview[];
  totalBytes: number;
  upscaled: boolean;
}

/** Encode one square icon at `size`, cropping the source to a centred square. */
async function renderSquare(
  image: DecodedImage,
  size: number,
  signal: AbortSignal,
): Promise<Blob | null> {
  const edge = Math.min(image.width, image.height);
  const result = await encodeImage(image, {
    format: 'png',
    region: {
      x: Math.round((image.width - edge) / 2),
      y: Math.round((image.height - edge) / 2),
      width: edge,
      height: edge,
    },
    target: { width: size, height: size },
    signal,
  });
  return result.ok ? result.blob : null;
}

/** Composite an already-sized transparent PNG onto a solid colour. */
async function flatten(png: Blob, size: number, colour: string): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) return null;

  context.fillStyle = colour;
  context.fillRect(0, 0, size, size);

  const bitmap = await createImageBitmap(png);
  context.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();

  const out = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
  canvas.width = 0;
  canvas.height = 0;
  return out;
}

export function FaviconGeneratorTool() {
  const [file, setFile] = useState<File | null>(null);
  const [siteName, setSiteName] = useState('My site');
  const [background, setBackground] = useState('#ffffff');
  const [withManifest, setWithManifest] = useState(true);

  const run = useToolRun<Output>(SLUG);
  const markStarted = useToolStarted(SLUG);

  // Previews are object URLs. Without this the tab leaks one set per run.
  const previews = run.result?.previews;
  useEffect(
    () => () => {
      previews?.forEach((preview) => {
        URL.revokeObjectURL(preview.url);
      });
    },
    [previews],
  );

  const onFiles = useCallback(
    (files: File[]) => {
      const picked = files[0];
      if (!picked) return;
      markStarted();
      run.reset();
      setFile(picked);
    },
    [markStarted, run],
  );

  const onRun = useCallback(() => {
    if (!file) return;
    markStarted();

    void run.start(
      async (ctx) => {
        const decoded = await decodeImage(file, { signal: ctx.signal });
        if (!decoded.ok) return { ok: false as const, error: decoded.error, reason: decoded.reason };

        const image = decoded.image;
        const upscaled = Math.min(image.width, image.height) < COMFORTABLE_EDGE;
        const total = ICO_SIZES.length + PNG_OUTPUTS.length;
        let done = 0;

        try {
          /* ── the ICO, one encode per size ────────────────────────────── */
          const icoImages: IcoImage[] = [];
          for (const size of ICO_SIZES) {
            await ctx.checkpoint();
            const blob = await renderSquare(image, size, ctx.signal);
            if (blob === null) {
              return {
                ok: false as const,
                error: 'The browser could not draw the icon. Try a different image.',
                reason: 'unknown' as const,
              };
            }
            icoImages.push({
              width: size,
              height: size,
              png: new Uint8Array(await blob.arrayBuffer()),
            });
            done += 1;
            ctx.report(done, total);
          }

          const ico = buildIco(icoImages);
          if (!ico.ok) {
            return { ok: false as const, error: ico.error, reason: 'unknown' as const };
          }

          const entries: ZipEntry[] = [{ name: 'favicon.ico', data: ico.bytes }];
          const previewList: Preview[] = icoImages.map((icon) => ({
            size: icon.width,
            url: URL.createObjectURL(new Blob([icon.png], { type: 'image/png' })),
            bytes: icon.png.length,
          }));

          /* ── the PNGs ────────────────────────────────────────────────── */
          for (const output of PNG_OUTPUTS) {
            await ctx.checkpoint();
            const drawn = await renderSquare(image, output.size, ctx.signal);
            if (drawn === null) {
              return {
                ok: false as const,
                error: 'The browser could not draw the icon. Try a different image.',
                reason: 'unknown' as const,
              };
            }
            // See the header: iOS composites a transparent icon onto black.
            const final = output.flatten
              ? ((await flatten(drawn, output.size, background)) ?? drawn)
              : drawn;
            const bytes = new Uint8Array(await final.arrayBuffer());
            entries.push({ name: output.name, data: bytes });
            previewList.push({
              size: output.size,
              url: URL.createObjectURL(final),
              bytes: bytes.length,
            });
            done += 1;
            ctx.report(done, total);
          }

          /* ── the text files ──────────────────────────────────────────── */
          const encoder = new TextEncoder();
          if (withManifest) {
            entries.push({
              name: 'site.webmanifest',
              data: encoder.encode(
                faviconManifest({
                  name: siteName.trim() === '' ? 'My site' : siteName.trim(),
                  themeColor: background,
                }),
              ),
            });
          }
          entries.push({
            name: 'add-to-your-head.html',
            data: encoder.encode(
              `<!-- Put these in the <head> of every page, and the files beside them in your site root. -->\n${faviconMarkup(
                { manifest: withManifest },
              )}\n`,
            ),
          });

          return {
            ok: true as const,
            value: {
              entries,
              previews: previewList,
              totalBytes: entries.reduce((sum, entry) => sum + entry.data.length, 0),
              upscaled,
            },
          };
        } finally {
          image.close();
        }
      },
      { count: ICO_SIZES.length + PNG_OUTPUTS.length },
    );
  }, [background, file, markStarted, run, siteName, withManifest]);

  const reset = useCallback(() => {
    setFile(null);
    run.reset();
  }, [run]);

  const result = run.result;

  return (
    <ToolWorkspace
      label="Generate a favicon"
      error={run.error}
      status={run.busy ? 'Drawing each size' : result ? 'Done — icons ready' : null}
    >
      {!file ? (
        <FileDropzone slug={SLUG} accept={RASTER_IMAGE_ONE} onFiles={onFiles} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
              <Icon name="file-image" size={18} className="shrink-0 text-fg-subtle" />
              <span className="truncate" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0">· {humanBytes(file.size)}</span>
            </p>
            <Button variant="ghost" size="sm" iconLeft="x" onClick={reset} disabled={run.busy}>
              Choose a different image
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Background for the iPhone icon"
              htmlFor="favicon-background"
              hint="iOS fills transparency with black, so this colour is used instead. It also becomes the manifest theme colour."
            >
              <div className="flex items-center gap-2">
                <input
                  id="favicon-background"
                  type="color"
                  value={background}
                  disabled={run.busy}
                  onChange={(event) => setBackground(event.target.value)}
                  className="h-10 w-12 shrink-0 cursor-pointer rounded border border-border bg-surface p-1"
                />
                <Input
                  value={background}
                  disabled={run.busy}
                  aria-label="Background colour as hex"
                  onChange={(event) => setBackground(event.target.value)}
                  className="font-mono"
                />
              </div>
            </Field>

            <Field
              label="Site name"
              htmlFor="favicon-name"
              hint="Written into the manifest, and shown under the icon on an Android home screen."
            >
              <Input
                id="favicon-name"
                value={siteName}
                disabled={run.busy || !withManifest}
                onChange={(event) => setSiteName(event.target.value)}
              />
            </Field>
          </div>

          <div className="flex items-start gap-3">
            <Switch
              id="favicon-manifest"
              label="Include a web app manifest"
              checked={withManifest}
              disabled={run.busy}
              onCheckedChange={setWithManifest}
            />
            <label htmlFor="favicon-manifest" className="text-sm text-fg-muted">
              <span className="font-medium text-fg">Include a web app manifest</span>
              <span className="block">
                Needed for Android to use the large icons, and for a site to be installable. Leave
                it off if your framework already generates one.
              </span>
            </label>
          </div>

          <ToolRunBar
            label="Generate icons"
            busy={run.busy}
            progress={run.progress}
            progressLabel={(p) => `${p.done} of ${p.total} sizes`}
            onRun={onRun}
            onCancel={run.cancel}
            hint="Your image is never uploaded — every size is drawn on your device."
          />
        </>
      )}

      {result ? (
        <ToolResult
          slug={SLUG}
          title="Your icon set is ready"
          summary={`${result.entries.length} files · ${humanBytes(result.totalBytes)}`}
          download={{
            label: 'Download all as ZIP',
            format: 'zip',
            count: result.entries.length,
            deliver: () => {
              const output = run.result;
              if (!output) {
                return {
                  ok: false as const,
                  reason: 'unknown' as const,
                  error: 'There is nothing to download yet.',
                };
              }
              return downloadZip(output.entries, 'favicon');
            },
          }}
          onUseAgain={reset}
          useAgainLabel="Start over"
        >
          {result.upscaled ? (
            <Alert variant="warning" title="Your image is smaller than the largest icon">
              The 512-pixel icon has been enlarged from a smaller picture, so it will look soft on an
              install prompt. A square source of at least 512 pixels gives a noticeably better set.
            </Alert>
          ) : null}

          {/* Shown at their true pixel sizes: an icon that looks fine at 128
              and unreadable at 16 is the whole reason to preview one. */}
          <div>
            <p className="mb-2 text-sm font-medium text-fg">
              At the sizes a browser will actually draw them
            </p>
            <ul className="flex flex-wrap items-end gap-5">
              {result.previews.map((preview) => (
                <li key={preview.size} className="flex flex-col items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview.url}
                    alt={`Icon at ${preview.size} pixels`}
                    width={Math.min(preview.size, 64)}
                    height={Math.min(preview.size, 64)}
                    className="rounded border border-border bg-surface-sunken"
                  />
                  <span className="text-xs text-fg-muted">
                    {preview.size}px · {humanBytes(preview.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-fg">
              Put the files in your site root and this in your <code>&lt;head&gt;</code>
            </p>
            <pre className="scrollbar-thin overflow-x-auto rounded-lg border border-border bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-fg-muted">
              {faviconMarkup({ manifest: withManifest })}
            </pre>
          </div>
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}
