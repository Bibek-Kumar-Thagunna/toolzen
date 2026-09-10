'use client';

import { useDeferredValue, useMemo, useRef, useState, type DragEvent } from 'react';

import { Icon } from '@/components/icons';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { toolTracker } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { acceptAttribute, checkFile } from '@/lib/files/accept';
import { humanBytes, humanLimit } from '@/lib/files/bytes';
import { TEXT_DOCUMENT } from '@/lib/tools/accepts';
import { formatJson, type JsonError, type JsonStats } from '@/lib/tools/dev/json';

/**
 * ============================================================================
 * JSON FORMATTER AND VALIDATOR
 * ============================================================================
 * ── Why the result is deferred rather than debounced ───────────────────────
 * `formatJson` parses, re-serialises and scans every numeric literal, so on a
 * megabyte of JSON it is the one text engine on the site expensive enough to be
 * felt. A `setTimeout` debounce fixes that by making the tool feel slow on the
 * small documents that are the common case. `useDeferredValue` instead lets React
 * paint the keystroke immediately and compute the result at low priority,
 * abandoning the work when another character arrives. Typing stays smooth without
 * a delay being imposed on anybody.
 *
 * ── Why the parse error is not a live region ────────────────────────────────
 * Half-typed JSON is invalid JSON, so an assertive `role="alert"` here would
 * interrupt a screen-reader user on nearly every keystroke — which is why the
 * error is not passed to `ToolWorkspace`'s alert either. It is rendered as
 * ordinary content, carrying an `Error` label on its glyph so the severity does
 * not depend on the red border (§16), and it is placed directly under the input
 * where the caret already is.
 *
 * ── Why indent and minify are one control ─────────────────────────────────
 * They are one decision: what the output should look like. Two controls would let
 * a user set an indent that minifying then ignores, which is a state the tool
 * cannot honour and would have to explain.
 *
 * ── Why a file can be dropped, and what happens to it ──────────────────────
 * The how-to promises it. The file is read with `File.text()` and its contents
 * replace the input box — nothing is uploaded, and the file itself is never
 * touched again. `checkFile` refuses anything oversized before the read starts,
 * because a browser asked to put 200 MB of text in a textarea does not recover.
 * The accessible path is a real `<input type="file">` label, not a drop-only
 * target (§16).
 * ============================================================================
 */

const SLUG = 'json-formatter';
const INPUT_ID = 'json-input';
const OUTPUT_ID = 'json-output';
const SHAPE_ID = 'json-shape';
const FILE_ID = 'json-file';

type Shape = '2' | '4' | 'tab' | 'minify';

const SHAPES: ReadonlyArray<{ value: Shape; label: string }> = [
  { value: '2', label: 'Indent with 2 spaces' },
  { value: '4', label: 'Indent with 4 spaces' },
  { value: 'tab', label: 'Indent with a tab' },
  { value: 'minify', label: 'Minify — no spaces at all' },
];

/** A statistic from `JsonStats`, in the row under a successful format. */
function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded border border-border-subtle bg-surface-sunken px-2 py-1.5">
      <dt className="text-2xs uppercase tracking-wide text-fg-subtle">{term}</dt>
      <dd className="tabular text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

function Stats({ stats }: { stats: JsonStats }) {
  const n = (value: number) => value.toLocaleString('en-US');
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat term="In" value={humanBytes(stats.bytesIn)} />
      <Stat term="Out" value={humanBytes(stats.bytesOut)} />
      <Stat term="Depth" value={n(stats.maxDepth)} />
      <Stat term="Keys" value={n(stats.keys)} />
      <Stat term="Objects" value={n(stats.objects)} />
      <Stat term="Arrays" value={n(stats.arrays)} />
      <Stat term="Values" value={n(stats.values)} />
      <Stat term="Total nodes" value={n(stats.objects + stats.arrays + stats.values)} />
    </dl>
  );
}

/**
 * The parse failure, spelled out. `snippet` is two lines — the offending line and
 * a caret under the column — so it is rendered in a `<pre>` that scrolls
 * sideways rather than wrapping, because a wrapped caret points at the wrong
 * character.
 */
function ParseError({ error }: { error: JsonError }) {
  return (
    <div className="rounded-md border border-danger-border bg-danger-subtle p-3 text-sm text-danger-fg">
      <div className="flex gap-2">
        <Icon name="alert-circle" size={18} label="Error" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <p>
            <span className="font-medium">
              Line {error.line}, column {error.column}:
            </span>{' '}
            {error.message}
          </p>
          <pre className="scrollbar-thin overflow-x-auto rounded bg-surface p-2 font-mono text-xs leading-snug text-fg">
            {error.snippet}
          </pre>
          {error.hint ? <p className="text-fg-muted">{error.hint}</p> : null}
        </div>
      </div>
    </div>
  );
}

/** The warnings a *successful* format can still carry: duplicate keys, precision loss, a BOM. */
function Warnings({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5 text-warning-fg">
          <Icon name="alert-triangle" size={14} label="Warning" className="mt-0.5 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function JsonFormatterTool() {
  const [input, setInput] = useState('');
  const [shape, setShape] = useState<Shape>('2');
  const [sortKeys, setSortKeys] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Drag events fire for every nested element, so entering a child looks like
  // leaving the parent. Counting depth is the only way the highlight survives
  // dragging across the label inside the box.
  const depth = useRef(0);
  const markStarted = useToolStarted(SLUG);

  // The expensive part runs against the deferred copy, so a keystroke paints
  // before the parse of the previous one has finished.
  const deferred = useDeferredValue(input);
  const result = useMemo(() => {
    // Minifying ignores the indent, but it is still passed a real number: a
    // `Number.parseInt('minify')` NaN reaching the engine would be a bug waiting
    // for the day the two options stop being mutually exclusive.
    const indent = shape === 'tab' ? 'tab' : shape === 'minify' ? 2 : Number.parseInt(shape, 10);
    return formatJson(deferred, {
      mode: shape === 'minify' ? 'minify' : 'pretty',
      indent,
      sortKeys,
    });
  }, [deferred, shape, sortKeys]);

  const blank = deferred.trim() === '';
  // `formatJson` reports blank input as an error, which is right for the engine
  // and wrong for an untouched page: nobody needs to be told that nothing is
  // not JSON.
  const parseError = !result.ok && !blank ? result.error : null;

  async function receive(file: File) {
    const check = checkFile(file, TEXT_DOCUMENT);
    if (!check.ok) {
      setFileError(check.error);
      return;
    }
    setFileError(null);
    try {
      const text = await file.text();
      setInput(text);
      markStarted();
      toolTracker(SLUG).filesAdded([file]);
    } catch {
      // Reading a file the OS has since moved or locked. The person needs a way
      // forward, not the DOMException.
      setFileError('That file could not be read. Try opening it again, or paste the text instead.');
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    depth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void receive(file);
  }

  return (
    <ToolWorkspace label="JSON formatter">
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'space-y-2 rounded-lg border border-dashed p-2 transition-colors duration-fast',
          dragging ? 'border-accent-border bg-accent-subtle' : 'border-transparent',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={INPUT_ID} className="text-sm font-medium text-fg">
            Your JSON
          </label>
          <div className="flex items-center gap-2">
            {/* The keyboard path to the same thing dragging does. The input is
                `sr-only` rather than hidden so it keeps its tab stop, and it is
                written *before* the label because Tailwind's `peer-*` variants
                compile to `~`, which only reaches a later sibling. */}
            <input
              id={FILE_ID}
              type="file"
              accept={acceptAttribute(TEXT_DOCUMENT)}
              className="peer sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void receive(file);
                // Cleared so choosing the same file twice fires `change` again.
                event.target.value = '';
              }}
            />
            <label
              htmlFor={FILE_ID}
              className={cn(
                'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded px-2.5 text-sm font-medium',
                'text-fg-muted transition-colors duration-fast hover:bg-surface-sunken hover:text-fg',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                'peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas',
              )}
            >
              <Icon name="upload" size={16} />
              Open a file
            </label>
            <Button
              variant="ghost"
              size="sm"
              iconLeft="trash"
              disabled={input === ''}
              onClick={() => {
                setInput('');
                setFileError(null);
              }}
            >
              Clear
            </Button>
          </div>
        </div>

        <Textarea
          id={INPUT_ID}
          value={input}
          rows={12}
          monospace
          placeholder={'{"paste": "or type JSON here", "orDrop": "a .json file on this box"}'}
          onChange={(event) => {
            setInput(event.target.value);
            setFileError(null);
            markStarted();
          }}
        />

        <p className="text-xs text-fg-subtle">
          Drop a .json or .txt file of up to {humanLimit(TEXT_DOCUMENT.maxBytes)} anywhere on this
          box. It is read in this tab and never uploaded.
        </p>

        {fileError ? (
          <p className="flex gap-1.5 text-sm text-danger-fg">
            <Icon name="alert-circle" size={16} label="Error" className="mt-0.5 shrink-0" />
            <span>{fileError}</span>
          </p>
        ) : null}

        {parseError ? <ParseError error={parseError} /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Output" htmlFor={SHAPE_ID} hint="Indent for reading, minify for shipping.">
          <Select
            id={SHAPE_ID}
            value={shape}
            onChange={(event) => setShape(event.target.value as Shape)}
          >
            {SHAPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex items-start gap-3 self-end rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2.5">
          <Switch
            checked={sortKeys}
            onCheckedChange={setSortKeys}
            label="Sort keys alphabetically"
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-fg">Sort keys alphabetically</span>
            <span className="block text-xs text-fg-muted">
              Applied at every level. Arrays keep the order they are written in.
            </span>
          </span>
        </div>
      </div>

      <TextOutput
        slug={SLUG}
        id={OUTPUT_ID}
        label={shape === 'minify' ? 'Minified JSON' : 'Formatted JSON'}
        value={result.ok ? result.output : ''}
        copyTarget="json"
        downloadName={shape === 'minify' ? 'data.min.json' : 'data.json'}
        rows={14}
        monospace
        placeholder={
          blank
            ? 'Valid JSON appears here, with the shape you chose above.'
            : 'Fix the problem above and the formatted JSON appears here.'
        }
        footer={
          result.ok ? (
            <div className="space-y-2">
              <Warnings items={result.warnings} />
              <Stats stats={result.stats} />
            </div>
          ) : null
        }
      />
    </ToolWorkspace>
  );
}
