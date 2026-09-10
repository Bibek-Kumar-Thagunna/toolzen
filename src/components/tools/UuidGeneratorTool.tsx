'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import { Icon } from '@/components/icons';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { toolTracker } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import {
  MAX_UUID,
  MAX_UUID_BATCH,
  NIL_UUID,
  formatUuidText,
  generateNanoId,
  generateObjectId,
  generateUuids,
  inspectUuid,
  validateBatchCount,
  type UuidInfo,
} from '@/lib/tools/dev/uuid';

/**
 * ============================================================================
 * UUID GENERATOR
 * ============================================================================
 * ── Why the first batch is made in an effect and not during render ──────────
 * A `'use client'` component still renders once on the server, and random bytes
 * drawn there would not be the bytes drawn in the browser: React compares the
 * two and reports a hydration error. Generation therefore happens in an effect,
 * which never runs on the server. The cost is that the output area is empty for
 * exactly one paint; the benefit is that ids exist before anyone has clicked
 * anything, which is what a person arriving at a UUID generator wants.
 *
 * ── Why the written form re-writes the batch instead of replacing it ────────
 * The ids are held in canonical lowercase hyphenated form and rewritten on the
 * way to the screen by the engine's own `formatUuidText`. Toggling uppercase
 * therefore changes how the same ids are written rather than handing back
 * different ones — someone who has already pasted an id somewhere does not lose
 * it because they then noticed their database wants uppercase. Regenerating on a
 * format change would have been one line shorter and quietly destructive.
 *
 * ── Why those switches disappear for NanoID and ObjectId ────────────────────
 * "No hyphens" strips `-` characters, and `-` is a symbol in NanoID's own
 * alphabet: applying it there would not reformat an id, it would corrupt one.
 * The controls are hidden rather than ignored, so nothing on screen claims to do
 * something it must not do (§35).
 *
 * ── Why there are three ways of showing the result ──────────────────────────
 * One id is the common case and gets the room: large, monospace, one Copy
 * button. Up to twenty-five is a list, so each row can be copied on its own.
 * Beyond that it is text in a box, because ten thousand rows each carrying a
 * button is not a list, it is a stalled tab.
 *
 * ── Why the count refuses and the NanoID length clamps ──────────────────────
 * Ten thousand and one ids is a refusal with a sentence, because generating far
 * more than that is a real cost the page should not pay silently. A NanoID
 * length outside 8–64 is only outside what this page offers, so it is clamped
 * and the field says which length is actually being used. Neither one rewrites
 * what the person typed while they are still typing it.
 * ============================================================================
 */

const SLUG = 'uuid-generator';
const COUNT_ID = 'uuid-count';
const LENGTH_ID = 'uuid-nano-length';
const LOOKUP_ID = 'uuid-lookup';
const OUTPUT_ID = 'uuid-batch';
const HEADING_ID = 'uuid-batch-heading';
const INSPECT_ID = 'uuid-inspect';
const GROUP_NAME = 'uuid-flavour';

/** Above this many, the batch stops being a list of rows and becomes text. */
const ROWS_MAX = 25;

// The engine clamps a NanoID length to 1–512. This narrower range is a UI
// judgement: below 8 characters the collision risk stops being theoretical, and
// above 64 the id is longer than the UUID it was meant to be shorter than.
const NANO_MIN = 8;
const NANO_MAX = 64;
const NANO_DEFAULT = 21;

type Flavour = 'v4' | 'v7' | 'nil' | 'max' | 'nanoid' | 'objectid';

const FLAVOURS: ReadonlyArray<{ value: Flavour; label: string; hint: string }> = [
  { value: 'v4', label: 'UUID v4', hint: 'Random. Gives away neither when nor where it was made.' },
  { value: 'v7', label: 'UUID v7', hint: 'Begins with the time, so a list of them sorts by age.' },
  { value: 'nanoid', label: 'NanoID', hint: 'Short and URL-safe. 21 characters by default.' },
  { value: 'objectid', label: 'ObjectId', hint: 'The 24 hex characters MongoDB uses.' },
  { value: 'nil', label: 'Nil UUID', hint: 'All zeros — the agreed way to write “no UUID”.' },
  { value: 'max', label: 'Max UUID', hint: 'All f — the largest value RFC 9562 allows.' },
];

/** The two constants are values you quote, not values you generate. */
function isConstant(flavour: Flavour): boolean {
  return flavour === 'nil' || flavour === 'max';
}

/** Only these four are hex in five groups, so only these four can be rewritten. */
function isUuid(flavour: Flavour): boolean {
  return flavour === 'v4' || flavour === 'v7' || isConstant(flavour);
}

/** What to call the thing being counted, in refusals and in announcements. */
function nounFor(flavour: Flavour): string {
  if (flavour === 'nanoid') return 'NanoID';
  if (flavour === 'objectid') return 'ObjectId';
  return 'UUID';
}

type Batch = { ok: true; ids: readonly string[] } | { ok: false; error: string };

/**
 * One batch of whatever was asked for.
 *
 * The count is validated by the engine in every branch — `generateUuids` for the
 * UUID versions, `validateBatchCount` for the two that are not UUIDs — so the cap
 * and its four sentences have one source and cannot drift between them.
 */
function makeBatch(flavour: Flavour, count: number, nanoLength: number): Batch {
  if (flavour === 'nil') return { ok: true, ids: [NIL_UUID] };
  if (flavour === 'max') return { ok: true, ids: [MAX_UUID] };

  if (flavour === 'nanoid' || flavour === 'objectid') {
    const allowed = validateBatchCount(count, nounFor(flavour));
    if (!allowed.ok) return allowed;
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(flavour === 'nanoid' ? generateNanoId(nanoLength) : generateObjectId());
    }
    return { ok: true, ids };
  }

  const batch = generateUuids(count, { version: flavour });
  return batch.ok ? { ok: true, ids: batch.uuids } : batch;
}

/** Silently held inside what this page offers; the field says when it differs. */
function clampLength(text: string): number {
  const typed = Number.parseInt(text, 10);
  if (!Number.isFinite(typed)) return NANO_DEFAULT;
  return Math.min(NANO_MAX, Math.max(NANO_MIN, typed));
}

/** One choice of what to generate. Native radio, so arrow keys work for free. */
function FlavourCard({
  option,
  checked,
  onSelect,
}: {
  option: { value: Flavour; label: string; hint: string };
  checked: boolean;
  onSelect: (value: Flavour) => void;
}) {
  return (
    <label className="cursor-pointer">
      {/* Written before the card because Tailwind's `peer-*` variants compile to
          `~`, which only reaches a later sibling. */}
      <input
        type="radio"
        name={GROUP_NAME}
        value={option.value}
        checked={checked}
        onChange={() => onSelect(option.value)}
        className="peer sr-only"
      />
      <span
        className={cn(
          'flex h-full items-start justify-between gap-2 rounded-lg border px-3 py-2',
          'transition-colors duration-fast ease-out',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
          'peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas',
          checked
            ? 'border-accent-border bg-accent-subtle'
            : 'border-border-subtle bg-surface hover:border-border-strong',
        )}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-fg">{option.label}</span>
          <span className="mt-0.5 block text-xs text-fg-muted">{option.hint}</span>
        </span>
        {checked ? <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent-fg" /> : null}
      </span>
    </label>
  );
}

/**
 * A switch with its own visible label. The `label` prop names the control for a
 * screen reader; the text beside it is what a sighted user reads, and the two are
 * the same string so they can never describe different things.
 */
function Option({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Switch checked={checked} onCheckedChange={onChange} label={label} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="block text-xs text-fg-muted">{hint}</span>
      </span>
    </div>
  );
}

/** The single-id case: the whole point of the page, so it gets the room. */
function Single({ id }: { id: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
      <code className="block break-all font-mono text-base text-fg sm:text-lg">{id}</code>
    </div>
  );
}

/** A short batch, one copyable row each. */
function Rows({ ids, onCopied }: { ids: readonly string[]; onCopied: () => void }) {
  return (
    <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
      {ids.map((id, index) => (
        <li key={`${index}-${id}`} className="flex items-center gap-2 px-3 py-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-sm text-fg">{id}</code>
          {/* Numbered rather than read out in full: an icon-only button needs a
              name that distinguishes it from the other rows, and thirty-six hex
              digits spoken aloud is not that. */}
          <CopyButton
            value={id}
            size="icon"
            label={`Copy id ${index + 1}`}
            copiedLabel={`Copied id ${index + 1}`}
            onCopied={onCopied}
          />
        </li>
      ))}
    </ul>
  );
}

/** One fact about an inspected id. */
function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
      <dt className="text-2xs uppercase tracking-wide text-fg-subtle">{term}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

/**
 * What the inspector found.
 *
 * `valid` means well formed, not sensible: an id with an undefined version is
 * still a real 128-bit value, and the engine's note says what is odd about it
 * rather than refusing to read it. Only genuinely unreadable input takes the
 * error branch, and even then the sentence shown is the engine's own.
 */
function Findings({ info }: { info: UuidInfo }) {
  if (!info.valid) {
    return (
      <p className="flex gap-2 rounded-md border border-danger-border bg-danger-subtle p-3 text-sm text-danger-fg">
        <Icon name="alert-circle" size={18} label="Problem" className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">{info.note}</span>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Detail
          term="Version"
          value={info.version === null ? 'A defined constant' : `Version ${info.version}`}
        />
        <Detail term="Variant" value={info.variant} />
        <Detail term="Created (UTC)" value={info.timestamp ?? 'Not recorded in this version'} />
      </dl>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2">
        <code className="min-w-0 flex-1 break-all font-mono text-sm text-fg">{info.normalised}</code>
        <CopyButton
          value={info.normalised}
          label="Copy canonical form"
          copiedLabel="Copied"
          onCopied={() => toolTracker(SLUG).copied('canonical')}
        />
      </div>

      <p className="flex gap-1.5 text-sm text-fg-muted">
        <Icon name="info" size={16} label="Note" className="mt-0.5 shrink-0" />
        <span>{info.note}</span>
      </p>
    </div>
  );
}

/** Shared empty result, so the "nothing generated" identity is stable. */
const EMPTY_IDS: readonly string[] = Object.freeze([]);

export function UuidGeneratorTool() {
  const [flavour, setFlavour] = useState<Flavour>('v4');
  const [countText, setCountText] = useState('1');
  const [lengthText, setLengthText] = useState(String(NANO_DEFAULT));
  const [uppercase, setUppercase] = useState(false);
  const [braces, setBraces] = useState(false);
  const [noHyphens, setNoHyphens] = useState(false);
  const [lookup, setLookup] = useState('');
  // Bumped by the button. Its only job is to be a dependency that changed, so
  // that pressing Generate with every setting the same still draws new bytes.
  const [nonce, setNonce] = useState(0);
  // `null` until the browser has generated something, which is the state every
  // server render is in. See the note at the top of this file.
  const [batch, setBatch] = useState<Batch | null>(null);
  const markStarted = useToolStarted(SLUG);

  const typedCount = countText.trim() === '' ? Number.NaN : Number(countText);
  const nanoLength = clampLength(lengthText);

  // Generation runs against the deferred values, so holding a key down in the
  // count field paints each keystroke immediately and React drops the
  // intermediate batches it never had time to show.
  const count = useDeferredValue(typedCount);
  const deferredLength = useDeferredValue(nanoLength);

  useEffect(() => {
    setBatch(makeBatch(flavour, count, deferredLength));
  }, [flavour, count, deferredLength, nonce]);

  // See PasswordGeneratorTool: the `[]` fallback would be a new array every
  // render, making `shown` and `joined` below recompute for no reason.
  const ids = useMemo(() => (batch !== null && batch.ok ? batch.ids : EMPTY_IDS), [batch]);
  const countError = batch !== null && !batch.ok ? batch.error : null;
  const noun = nounFor(flavour);

  // Canonical in, written form out. The guard is not cosmetic: `noHyphens` would
  // strip `-` from a NanoID, which is a symbol in its alphabet, not punctuation.
  const shown = useMemo(
    () =>
      isUuid(flavour) ? ids.map((id) => formatUuidText(id, { uppercase, braces, noHyphens })) : ids,
    [ids, flavour, uppercase, braces, noHyphens],
  );
  const joined = useMemo(() => shown.join('\n'), [shown]);

  const info = useMemo<UuidInfo | null>(
    () => (lookup.trim() === '' ? null : inspectUuid(lookup)),
    [lookup],
  );

  const heading = isConstant(flavour)
    ? `The ${flavour} UUID`
    : shown.length === 1
      ? `Your ${noun}`
      : `${shown.length.toLocaleString('en-US')} ${noun}s`;

  // Announced politely, because the batch appears without anything visibly
  // happening: pressing Generate again would otherwise be silence.
  const status =
    batch !== null && batch.ok
      ? shown.length === 1
        ? `A new ${noun} is ready`
        : `${shown.length.toLocaleString('en-US')} new ${noun}s are ready`
      : null;

  const lengthTyped = Number.parseInt(lengthText, 10);
  const lengthHint =
    Number.isFinite(lengthTyped) && lengthTyped !== nanoLength
      ? `Generating ${nanoLength}-character ids. This page offers ${NANO_MIN} to ${NANO_MAX}.`
      : `${NANO_MIN} to ${NANO_MAX} characters. At 21 a NanoID carries about 126 bits, a shade more than a v4 UUID.`;

  return (
    <ToolWorkspace label="UUID generator" status={status}>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">What to generate</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FLAVOURS.map((option) => (
            <FlavourCard
              key={option.value}
              option={option}
              checked={option.value === flavour}
              onSelect={(value) => {
                setFlavour(value);
                markStarted();
              }}
            />
          ))}
        </div>
      </fieldset>

      {isConstant(flavour) ? (
        <p className="text-sm text-fg-muted">
          There is only one {flavour} UUID: it is a constant written into the standard rather than
          something generated, so there is nothing here to set and nothing to re-roll.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="How many"
            htmlFor={COUNT_ID}
            error={countError}
            hint={`Up to ${MAX_UUID_BATCH.toLocaleString('en-US')} at a time.`}
          >
            <Input
              id={COUNT_ID}
              type="number"
              min={1}
              max={MAX_UUID_BATCH}
              inputMode="numeric"
              value={countText}
              invalid={countError !== null}
              onChange={(event) => {
                setCountText(event.target.value);
                markStarted();
              }}
            />
          </Field>

          {flavour === 'nanoid' ? (
            <Field label="Length" htmlFor={LENGTH_ID} hint={lengthHint}>
              <Input
                id={LENGTH_ID}
                type="number"
                min={NANO_MIN}
                max={NANO_MAX}
                inputMode="numeric"
                value={lengthText}
                onChange={(event) => {
                  setLengthText(event.target.value);
                  markStarted();
                }}
              />
            </Field>
          ) : null}
        </div>
      )}

      {isUuid(flavour) ? (
        <fieldset className="rounded-lg border border-border-subtle px-3 pb-2">
          <legend className="px-1 text-sm font-medium text-fg">How it is written</legend>
          <Option
            label="Uppercase"
            hint="ABCDEF rather than abcdef. The value is identical either way; some tooling prints it this way."
            checked={uppercase}
            onChange={setUppercase}
          />
          <Option
            label="Curly braces"
            hint={'Wrapped in { and }, the form Windows and C# tooling prints for a GUID.'}
            checked={braces}
            onChange={setBraces}
          />
          <Option
            label="No hyphens"
            hint="32 bare hex digits, as used in URLs and in some database columns."
            checked={noHyphens}
            onChange={setNoHyphens}
          />
        </fieldset>
      ) : null}

      {/* Nothing at all until the browser has generated something, rather than a
          placeholder that would be replaced a paint later. */}
      {shown.length === 0 ? null : shown.length > ROWS_MAX ? (
        <TextOutput
          slug={SLUG}
          id={OUTPUT_ID}
          label={heading}
          value={joined}
          copyTarget="batch"
          downloadName={`${noun.toLowerCase()}s.txt`}
          rows={14}
          monospace
          footer={
            <Button
              variant="secondary"
              iconLeft="refresh"
              onClick={() => {
                setNonce((value) => value + 1);
                markStarted();
              }}
            >
              Generate again
            </Button>
          }
        />
      ) : (
        <section aria-labelledby={HEADING_ID} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={HEADING_ID} className="text-sm font-medium text-fg">
              {heading}
            </h2>
            <div className="flex items-center gap-2">
              {shown.length === 1 ? (
                <CopyButton
                  value={shown[0]}
                  label="Copy"
                  copiedLabel="Copied"
                  onCopied={() => toolTracker(SLUG).copied('single')}
                />
              ) : (
                <CopyButton
                  value={joined}
                  label="Copy all"
                  copiedLabel="All copied"
                  onCopied={() => toolTracker(SLUG).copied('batch')}
                />
              )}
              {isConstant(flavour) ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft="refresh"
                  onClick={() => {
                    setNonce((value) => value + 1);
                    markStarted();
                  }}
                >
                  Generate again
                </Button>
              )}
            </div>
          </div>

          {shown.length === 1 ? (
            <Single id={shown[0]} />
          ) : (
            <Rows ids={shown} onCopied={() => toolTracker(SLUG).copied('single')} />
          )}
        </section>
      )}

      <section
        aria-labelledby={INSPECT_ID}
        className="space-y-3 rounded-lg border border-border bg-surface-sunken p-4"
      >
        <div className="space-y-1">
          <h2 id={INSPECT_ID} className="text-sm font-medium text-fg">
            Examine an id you already have
          </h2>
          <p className="text-sm text-fg-muted">
            Paste any UUID — uppercase, wrapped in braces, with the hyphens left out, or as a
            <code className="mx-1 font-mono text-xs">urn:uuid:</code> URI — to see which version and
            variant it is, the canonical form to store, and, for versions 1, 6 and 7, when it was
            created.
          </p>
        </div>

        <Field label="UUID to examine" htmlFor={LOOKUP_ID} optional>
          <Input
            id={LOOKUP_ID}
            value={lookup}
            iconLeft="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="123e4567-e89b-12d3-a456-426614174000"
            onChange={(event) => {
              setLookup(event.target.value);
              markStarted();
            }}
          />
        </Field>

        {info === null ? null : <Findings info={info} />}
      </section>
    </ToolWorkspace>
  );
}
