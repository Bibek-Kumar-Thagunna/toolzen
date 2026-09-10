'use client';

/**
 * ============================================================================
 * IMAGE CROPPER
 * ============================================================================
 * Drag a box over a picture and get that box back as a file.
 *
 * ── The selection lives in source pixels, not screen pixels ───────────────
 * The rectangle in state is always in the image's own coordinate space, and it
 * is converted to display space only to draw. The obvious alternative — track
 * the box in CSS pixels and scale it at the end — accumulates rounding error on
 * every drag, and produces a different crop on a phone than on a desktop
 * because the preview is a different size. Storing the truth in source pixels
 * means the readout ("1080 × 1080 px") is the real output size at every moment,
 * and resizing the window cannot change what you get.
 *
 * ── Pointer Events, with capture ──────────────────────────────────────────
 * One set of handlers covers mouse, touch and pen. `setPointerCapture` is the
 * part that matters: without it, dragging a handle and moving faster than React
 * re-renders drops the pointer outside the element and the drag dies mid-way.
 * With it, the element keeps receiving events until release even if the pointer
 * has left the window entirely.
 *
 * `touch-action: none` on the overlay stops the browser from claiming the
 * gesture as a scroll or a pinch-zoom, which on a phone is the difference
 * between dragging the box and scrolling the page.
 *
 * ── Keyboard is a first-class path, not an afterthought ───────────────────
 * Cropping by dragging is a drag-and-drop-only interaction, and WCAG 2.2's
 * 2.5.7 requires a single-pointer alternative. The selection is focusable and
 * takes arrow keys to move, Shift+arrows to resize, and the ratio buttons and
 * numeric readout give a way to get an exact crop without any dragging at all.
 *
 * ── Rotation is quarter turns only ────────────────────────────────────────
 * 90° multiples map a rectangle onto a rectangle: no empty corners to fill, no
 * resampling, the same pixels in a different order. An arbitrary angle is a
 * different feature with visibly different output, and hiding it behind the
 * same control would be a quiet downgrade in quality.
 *
 * ── One image at a time ───────────────────────────────────────────────────
 * A crop is a rectangle chosen against one particular picture. Applying it to a
 * batch of differently-sized images would either mean cropping most of them
 * wrong or silently reinterpreting the rectangle per file, and neither is what
 * anybody means by "crop these".
 * ============================================================================
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { Icon } from '@/components/icons';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { FileDropzone } from '@/components/tool/FileDropzone';
import { ToolResult } from '@/components/tool/ToolResult';
import { ToolRunBar } from '@/components/tool/ToolRunBar';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { cn } from '@/lib/cn';
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes } from '@/lib/files/download';
import { RASTER_IMAGES } from '@/lib/tools/accepts';
import {
  CROP_RATIOS,
  centreCrop,
  clampRect,
  describeCrop,
  expandToRatio,
  type Rect,
} from '@/lib/tools/image/crop';
import { decodeImage, encodeImage, type EncodableFormat } from '@/lib/tools/image/codec';
import { mimeForFormat, outputFileName } from '@/lib/tools/image/format';
import type { Size } from '@/lib/tools/image/dimensions';

const SLUG = 'image-cropper';

/** One image at a time — see the header. */
const ACCEPT = { ...RASTER_IMAGES, maxFiles: 1 };

/** Smallest selection, in source pixels. Below this the handles overlap. */
const MIN_CROP = 16;

type Handle = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w' | 'move';

interface Drag {
  handle: Handle;
  /** Pointer position when the drag began, in source pixels. */
  originX: number;
  originY: number;
  /** The rectangle when the drag began. */
  startRect: Rect;
}

interface Loaded {
  file: File;
  url: string;
  size: Size;
}

interface CropOutput {
  name: string;
  bytes: Uint8Array;
  mime: string;
  size: number;
  width: number;
  height: number;
}

const HANDLES: { id: Handle; label: string; className: string }[] = [
  { id: 'nw', label: 'top left', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
  { id: 'n', label: 'top', className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
  { id: 'ne', label: 'top right', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
  { id: 'e', label: 'right', className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  { id: 'se', label: 'bottom right', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
  { id: 's', label: 'bottom', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
  { id: 'sw', label: 'bottom left', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
  { id: 'w', label: 'left', className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
];

/**
 * Apply a drag to the starting rectangle.
 *
 * Written as a pure function of (handle, delta, start) rather than as mutation
 * during the move, so a drag is reproducible and the rectangle cannot drift:
 * every move event recomputes from the same origin instead of accumulating.
 */
function applyDrag(drag: Drag, dx: number, dy: number, bounds: Size, ratio: number | null): Rect {
  const start = drag.startRect;
  let next: Rect;

  if (drag.handle === 'move') {
    next = { ...start, x: start.x + dx, y: start.y + dy };
    // Slide back inside rather than shrink: moving a box off the edge should
    // stop it, not resize it.
    next.x = Math.max(0, Math.min(next.x, bounds.width - next.width));
    next.y = Math.max(0, Math.min(next.y, bounds.height - next.height));
    return next;
  }

  const right = start.x + start.width;
  const bottom = start.y + start.height;
  let { x, y } = start;
  let width = start.width;
  let height = start.height;

  if (drag.handle.includes('w')) {
    x = Math.min(start.x + dx, right - MIN_CROP);
    width = right - x;
  }
  if (drag.handle.includes('e')) {
    width = Math.max(MIN_CROP, start.width + dx);
  }
  if (drag.handle.includes('n')) {
    y = Math.min(start.y + dy, bottom - MIN_CROP);
    height = bottom - y;
  }
  if (drag.handle.includes('s')) {
    height = Math.max(MIN_CROP, start.height + dy);
  }

  next = clampRect({ x, y, width, height }, bounds);

  if (ratio !== null) {
    // `expandToRatio` keeps the rectangle inside the picture while forcing the
    // shape, which is what makes a locked ratio feel like a constraint rather
    // than a fight.
    next = expandToRatio(next, ratio, bounds);
  }

  return next;
}

export function ImageCropperTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [format, setFormat] = useState<EncodableFormat>('png');

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const run = useToolRun<CropOutput>(SLUG);
  const markStarted = useToolStarted(SLUG);
  const readoutId = useId();

  // The object URL is the only thing here that leaks if forgotten: it pins the
  // whole file in memory until revoked, and a user cropping ten screenshots in
  // a row would hold all ten.
  useEffect(() => {
    if (!loaded) return;
    return () => URL.revokeObjectURL(loaded.url);
  }, [loaded]);

  const onFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      markStarted();
      run.reset();

      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const size = { width: probe.naturalWidth, height: probe.naturalHeight };
        setLoaded({ file, url, size });
        // Open on a centred selection covering most of the picture: an empty
        // overlay gives a first-time user nothing to grab.
        setRect(
          clampRect(
            {
              x: Math.round(size.width * 0.1),
              y: Math.round(size.height * 0.1),
              width: Math.round(size.width * 0.8),
              height: Math.round(size.height * 0.8),
            },
            size,
          ),
        );
        setRatio(null);
        setRotate(0);
        setFlipH(false);
        setFlipV(false);
        setFormat(file.type === 'image/jpeg' ? 'jpeg' : 'png');
      };
      probe.onerror = () => URL.revokeObjectURL(url);
      probe.src = url;
    },
    [markStarted, run],
  );

  /** Display pixels → source pixels. One number; the preview is never distorted. */
  const scale = useCallback((): number => {
    const node = surfaceRef.current;
    if (!node || !loaded) return 1;
    const width = node.getBoundingClientRect().width;
    return width > 0 ? loaded.size.width / width : 1;
  }, [loaded]);

  const onPointerDown = useCallback(
    (handle: Handle) => (event: React.PointerEvent<HTMLElement>) => {
      if (!rect || !loaded) return;
      event.preventDefault();
      event.stopPropagation();
      // Without capture, a fast drag that outruns React's re-render leaves the
      // element and the gesture dies half-finished.
      event.currentTarget.setPointerCapture(event.pointerId);
      const factor = scale();
      dragRef.current = {
        handle,
        originX: event.clientX * factor,
        originY: event.clientY * factor,
        startRect: rect,
      };
    },
    [loaded, rect, scale],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || !loaded) return;
      const factor = scale();
      const dx = event.clientX * factor - drag.originX;
      const dy = event.clientY * factor - drag.originY;
      setRect(applyDrag(drag, dx, dy, loaded.size, ratio));
    },
    [loaded, ratio, scale],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  /** Arrow keys move; Shift+arrows resize. The pointer-free path. */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!rect || !loaded) return;
      const step = event.altKey ? 1 : 10;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();

      const [dx, dy] = delta;
      const next = event.shiftKey
        ? applyDrag({ handle: 'se', originX: 0, originY: 0, startRect: rect }, dx, dy, loaded.size, ratio)
        : applyDrag({ handle: 'move', originX: 0, originY: 0, startRect: rect }, dx, dy, loaded.size, ratio);
      setRect(next);
    },
    [loaded, ratio, rect],
  );

  const chooseRatio = useCallback(
    (value: number | null) => {
      setRatio(value);
      if (value !== null && loaded) setRect(centreCrop(loaded.size, value));
    },
    [loaded],
  );

  const setDimension = useCallback(
    (axis: 'width' | 'height', text: string) => {
      if (!rect || !loaded) return;
      const value = Math.round(Number(text));
      if (!Number.isFinite(value) || value < MIN_CROP) return;
      const next = clampRect({ ...rect, [axis]: value }, loaded.size);
      setRect(ratio === null ? next : expandToRatio(next, ratio, loaded.size));
    },
    [loaded, ratio, rect],
  );

  const onRun = useCallback(() => {
    if (!loaded || !rect) return;
    markStarted();
    void run.start(async (ctx) => {
      const decoded = await decodeImage(loaded.file, { signal: ctx.signal });
      if (!decoded.ok) return { ok: false, error: decoded.error, reason: decoded.reason };
      try {
        const encoded = await encodeImage(decoded.image, {
          format,
          quality: 0.9,
          region: rect,
          rotate,
          flipHorizontal: flipH,
          flipVertical: flipV,
          signal: ctx.signal,
        });
        if (!encoded.ok) return { ok: false, error: encoded.error, reason: encoded.reason };
        return {
          ok: true as const,
          value: {
            name: outputFileName(loaded.file.name, format, { suffix: '-cropped' }),
            bytes: new Uint8Array(await encoded.blob.arrayBuffer()),
            mime: encoded.blob.type || mimeForFormat(format),
            size: encoded.blob.size,
            width: encoded.size.width,
            height: encoded.size.height,
          },
        };
      } finally {
        decoded.image.close();
      }
    });
  }, [flipH, flipV, format, loaded, markStarted, rect, rotate, run]);

  const reset = useCallback(() => {
    setLoaded(null);
    setRect(null);
    run.reset();
  }, [run]);

  const readout = useMemo(
    () => (rect && loaded ? describeCrop(rect, loaded.size) : ''),
    [loaded, rect],
  );

  /** Percentages, so the overlay tracks the picture at every viewport width. */
  const overlayStyle = useMemo(() => {
    if (!rect || !loaded) return undefined;
    return {
      left: `${(rect.x / loaded.size.width) * 100}%`,
      top: `${(rect.y / loaded.size.height) * 100}%`,
      width: `${(rect.width / loaded.size.width) * 100}%`,
      height: `${(rect.height / loaded.size.height) * 100}%`,
    };
  }, [loaded, rect]);

  return (
    <ToolWorkspace
      label="Crop an image"
      error={run.error}
      status={run.busy ? 'Cropping' : run.result ? 'Done — your crop is ready' : null}
    >
      {!loaded ? (
        <FileDropzone slug={SLUG} accept={ACCEPT} onFiles={onFiles} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 truncate text-sm text-fg-muted" title={loaded.file.name}>
              {loaded.file.name} · {loaded.size.width} × {loaded.size.height} px
            </p>
            <Button variant="ghost" size="sm" iconLeft="x" onClick={reset} disabled={run.busy}>
              Choose a different image
            </Button>
          </div>

          {/* The picture and the selection. `select-none` keeps a drag from
              turning into a text selection halfway across the image. */}
          <div
            ref={surfaceRef}
            className="relative mx-auto max-w-full select-none overflow-hidden rounded-lg border border-border bg-surface-sunken"
            style={{ aspectRatio: `${loaded.size.width} / ${loaded.size.height}`, maxWidth: '100%' }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL
                is local to this tab; there is nothing for the optimiser to fetch. */}
            <img
              src={loaded.url}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 size-full object-contain"
            />

            {/* Dim everything outside the selection. A single element with a
                huge spread shadow is one paint; four positioned overlays are
                four, and they leave hairline gaps at fractional pixel sizes. */}
            {overlayStyle ? (
              <div
                role="group"
                aria-label="Crop selection"
                aria-describedby={readoutId}
                tabIndex={0}
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown('move')}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ ...overlayStyle, touchAction: 'none' }}
                className={cn(
                  'absolute cursor-move border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                )}
              >
                {/* Rule-of-thirds guides. Decorative, and pointer-transparent so
                    they never swallow a drag. */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                  <div className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
                  <div className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
                  <div className="absolute left-0 top-1/3 h-px w-full bg-white/30" />
                  <div className="absolute left-0 top-2/3 h-px w-full bg-white/30" />
                </div>

                {HANDLES.map((handle) => (
                  <span
                    key={handle.id}
                    role="presentation"
                    onPointerDown={onPointerDown(handle.id)}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    style={{ touchAction: 'none' }}
                    className={cn(
                      'absolute size-4 rounded-sm border border-fg/40 bg-white shadow-sm',
                      handle.className,
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <p id={readoutId} role="status" className="text-center text-sm text-fg-muted">
            {readout}
          </p>

          {/* ── Controls ─────────────────────────────────────────────────── */}
          <div className="space-y-4">
            <fieldset disabled={run.busy}>
              <legend className="mb-2 text-sm font-medium text-fg">Ratio</legend>
              <div className="flex flex-wrap gap-1.5">
                {CROP_RATIOS.map((option) => {
                  const active = ratio === option.value;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => chooseRatio(option.value)}
                      className={cn(
                        'rounded-md border px-2.5 py-1.5 text-sm transition-colors duration-fast',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                        active
                          ? 'border-accent-border bg-accent-subtle font-medium text-accent-fg'
                          : 'border-border bg-surface text-fg-muted hover:bg-surface-hover',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Width" htmlFor="crop-width">
                <Input
                  id="crop-width"
                  numeric
                  inputMode="numeric"
                  value={rect ? String(Math.round(rect.width)) : ''}
                  disabled={run.busy}
                  suffix="px"
                  onChange={(event) => setDimension('width', event.target.value)}
                />
              </Field>
              <Field label="Height" htmlFor="crop-height">
                <Input
                  id="crop-height"
                  numeric
                  inputMode="numeric"
                  value={rect ? String(Math.round(rect.height)) : ''}
                  disabled={run.busy}
                  suffix="px"
                  onChange={(event) => setDimension('height', event.target.value)}
                />
              </Field>

              <div className="col-span-2">
                <p className="mb-1.5 text-sm font-medium text-fg">Orientation</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft="rotate"
                    disabled={run.busy}
                    onClick={() => setRotate((current) => (((current + 90) % 360) as 0 | 90 | 180 | 270))}
                  >
                    Rotate {rotate === 0 ? '' : `(${rotate}°)`}
                  </Button>
                  <Button
                    variant={flipH ? 'primary' : 'secondary'}
                    size="sm"
                    iconLeft="swap"
                    disabled={run.busy}
                    aria-pressed={flipH}
                    onClick={() => setFlipH((v) => !v)}
                  >
                    Flip across
                  </Button>
                  <Button
                    variant={flipV ? 'primary' : 'secondary'}
                    size="sm"
                    iconLeft="sort-asc"
                    disabled={run.busy}
                    aria-pressed={flipV}
                    onClick={() => setFlipV((v) => !v)}
                  >
                    Flip down
                  </Button>
                </div>
              </div>
            </div>

            <Alert variant="info">
              Drag inside the box to move it, pull a corner to resize. With the box focused, the
              arrow keys move it and Shift plus an arrow resizes it — hold Alt for single pixels.
            </Alert>
          </div>

          <ToolRunBar
            label="Crop image"
            busy={run.busy}
            disabled={!rect}
            progress={run.progress}
            onRun={onRun}
            onCancel={run.cancel}
            hint={`Saved as ${format === 'jpeg' ? 'JPG' : format.toUpperCase()}. Nothing is uploaded — the crop happens on your device.`}
          />

          {run.result ? (
            <ToolResult
              slug={SLUG}
              title="Crop ready"
              summary={`${run.result.width} × ${run.result.height} px · ${humanBytes(run.result.size)}`}
              download={{
                label: 'Download crop',
                format,
                count: 1,
                deliver: () => {
                  const output = run.result;
                  if (!output) {
                    return {
                      ok: false as const,
                      reason: 'unknown' as const,
                      error: 'There is nothing to download yet.',
                    };
                  }
                  return downloadBytes(output.bytes, output.name, output.mime);
                },
              }}
              actions={
                <Button
                  variant="secondary"
                  size="md"
                  iconLeft={format === 'png' ? 'file-image' : 'image'}
                  onClick={() => setFormat(format === 'png' ? 'jpeg' : 'png')}
                >
                  Save as {format === 'png' ? 'JPG' : 'PNG'} instead
                </Button>
              }
            >
              <div className="flex justify-center rounded-lg border border-border bg-surface-sunken p-3">
                <CropPreview output={run.result} />
              </div>
            </ToolResult>
          ) : null}
        </>
      )}
    </ToolWorkspace>
  );
}

/**
 * The finished crop.
 *
 * A Blob is rebuilt from the stored bytes rather than an object URL being kept
 * alive from the run: the bytes are what the download needs (synchronously,
 * inside the click), and holding a second reference to the same pixels for the
 * preview would double the memory for no benefit.
 */
function CropPreview({ output }: { output: CropOutput }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(new Blob([output.bytes.slice()], { type: output.mime }));
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [output]);

  if (url === null) {
    return <Icon name="image" size={32} className="text-fg-subtle" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- blob: URL, local to this tab.
    <img
      src={url}
      alt="The cropped result"
      className="max-h-80 max-w-full rounded object-contain"
      decoding="async"
    />
  );
}
