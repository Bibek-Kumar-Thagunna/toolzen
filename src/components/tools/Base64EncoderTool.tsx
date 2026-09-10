'use client';

import { useDeferredValue, useMemo, useState } from 'react';

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
import { downloadBytes } from '@/lib/files/download';
import { ANY_FILE } from '@/lib/tools/accepts';
import {
  base64ToBytes,
  bytesToBase64,
  decodeBase64,
  encodeBase64,
  looksLikeBase64,
} from '@/lib/tools/dev/base64';

/**
 * ============================================================================
 * BASE64 ENCODER AND DECODER
 * ============================================================================
 * ── Why direction is a control and not a guess ─────────────────────────────
 * `looksLikeBase64` is good enough to offer an opinion and nowhere near good
 * enough to act on one unasked: half-typed Base64 stops looking like Base64, so a
 * tool that silently switched direction on every keystroke would flip back and
 * forth under the caret. Direction is therefore explicit state with two visible
 * radios, guessed in the one place a guess is safe — a paste into an empty box,
 * where there is no work to destroy — and otherwise offered as a chip the user
 * can accept with one click. That is the how-to's "the tool guesses the direction
 * and you can switch it", without the guess ever overwriting a decision.
 *
 * ── Why padding follows the alphabet until it is touched ────────────────────
 * Standard Base64 pads and Base64URL usually does not, so a fixed default is
 * wrong half the time and a switch that ignores the alphabet makes the user fix
 * it every time. The switch follows the alphabet until the user moves it, after
 * which their choice stands. `paddingTouched` exists for exactly that, and for
 * nothing else.
 *
 * ── Why binary output is a download and not text ────────────────────────────
 * `decodeBase64` refuses bytes that are not valid UTF-8 rather than handing back
 * a screen of U+FFFD, which is the right call for the engine and only half an
 * answer for the page. So a refusal is re-run through `base64ToBytes`: if the
 * bytes themselves decoded cleanly the input was a file, which is a result, and
 * it is offered as a download. Only a genuine fatal error reaches the error
 * block.
 *
 * ── Why the notes are ordinary content ─────────────────────────────────────
 * Every repair the decoder reports is recomputed on each keystroke, so routing
 * them through `Alert` — a live region by construction — would announce a
 * sentence per character. They are a plain list under the result, with an icon
 * carrying the severity so it is not colour-only (§16).
 * ============================================================================
 */

const SLUG = 'base64-encoder';
const INPUT_ID = 'base64-input';
const OUTPUT_ID = 'base64-output';
const FILE_ID = 'base64-file';
const ENDING_ID = 'base64-line-ending';
const GROUP_NAME = 'base64-direction';

type Direction = 'encode' | 'decode';

const DIRECTIONS: ReadonlyArray<{ value: Direction; label: string; hint: string }> = [
  { value: 'encode', label: 'Encode', hint: 'Text or a file → Base64' },
  { value: 'decode', label: 'Decode', hint: 'Base64 → text or a file' },
];

/** What the tool is holding, once the input has been turned into an answer. */
type Outcome =
  | { kind: 'idle' }
  | {
      kind: 'text';
      value: string;
      warnings: readonly string[];
      bytesIn: number;
      bytesOut: number;
    }
  | { kind: 'binary'; bytes: Uint8Array }
  | { kind: 'error'; message: string };

/**
 * The size line under a result. Base64 costs a third in size and people are
 * routinely surprised by it, so the change is spelled out rather than left to be
 * worked out from two numbers.
 */
function sizeLine(bytesIn: number, bytesOut: number): string {
  const base = `${humanBytes(bytesIn)} in · ${humanBytes(bytesOut)} out`;
  if (bytesIn === 0) return base;
  const change = Math.round((bytesOut / bytesIn - 1) * 100);
  if (change === 0) return base;
  return `${base} · ${Math.abs(change)}% ${change > 0 ? 'larger' : 'smaller'}`;
}


/**
 * One half of the direction control. The real radio is `sr-only` so it keeps its
 * place in the tab order and its arrow-key behaviour — the same pattern the case
 * converter and the file dropzone use — while the card it labels carries the
 * focus ring and does not signal selection with colour alone.
 */
function DirectionCard({
  option,
  checked,
  onSelect,
}: {
  option: { value: Direction; label: string; hint: string };
  checked: boolean;
  onSelect: (value: Direction) => void;
}) {
  return (
    <label className="cursor-pointer">
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
          <span className="mt-0.5 block truncate text-xs text-fg-muted">{option.hint}</span>
        </span>
        {checked ? <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent-fg" /> : null}
      </span>
    </label>
  );
}

/** Everything the decoder had to repair, listed rather than done silently. */
function Notes({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5 text-warning-fg">
          <Icon name="alert-triangle" size={14} label="Note" className="mt-0.5 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** One switch and the sentence that explains what it changes. */
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

/**
 * The result when the Base64 turned out to be a file. It is deliberately not a
 * `TextOutput` with unreadable characters in it: there is nothing to copy, and
 * the only useful action is saving the bytes.
 */
function BinaryResult({ bytes }: { bytes: Uint8Array }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="base64-binary" className="space-y-3">
      <h2 id="base64-binary" className="text-sm font-medium text-fg">
        Result
      </h2>
      <div className="rounded-lg border border-border bg-surface-sunken p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 gap-2.5">
            <Icon name="file" size={20} className="mt-0.5 shrink-0 text-fg-muted" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">
                {humanBytes(bytes.length)} of data, not text
              </p>
              <p className="mt-0.5 text-sm text-fg-muted">
                The bytes decoded cleanly but are not valid UTF-8, so this is a file — an image, a
                PDF, an archive or something encrypted. Save it and open it in the app it belongs
                to.
              </p>
            </div>
          </div>
          <Button
            iconLeft="download"
            onClick={() => {
              const delivered = downloadBytes(bytes, 'decoded.bin', 'application/octet-stream');
              setError(delivered.ok ? null : delivered.error);
              if (delivered.ok) toolTracker(SLUG).downloaded('bin');
            }}
          >
            Save the file
          </Button>
        </div>
        {error ? (
          <p className="mt-3 flex gap-1.5 text-sm text-danger-fg">
            <Icon name="alert-circle" size={16} label="Error" className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The one thing the decoder treats as fatal: a character from no alphabet, or a
 * length no Base64 string can have. The engine's message is already a sentence
 * written for a person, so it is shown as it is.
 */
function DecodeError({ message }: { message: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-danger-border bg-danger-subtle p-3 text-sm text-danger-fg">
      <Icon name="alert-circle" size={18} label="Error" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
    </div>
  );
}

export function Base64EncoderTool() {
  const [direction, setDirection] = useState<Direction>('encode');
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [urlSafe, setUrlSafe] = useState(false);
  const [padding, setPadding] = useState(true);
  const [paddingTouched, setPaddingTouched] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [crlf, setCrlf] = useState(false);
  const [strict, setStrict] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const markStarted = useToolStarted(SLUG);

  const encoding = direction === 'encode';
  const deferred = useDeferredValue(text);

  const outcome = useMemo<Outcome>(() => {
    if (direction === 'encode') {
      const options = {
        urlSafe,
        padding,
        wrapAt: wrap ? 76 : 0,
        lineEnding: crlf ? ('\r\n' as const) : ('\n' as const),
      };
      if (attachment) {
        const value = bytesToBase64(attachment.bytes, options);
        return {
          kind: 'text',
          value,
          warnings: [],
          bytesIn: attachment.bytes.length,
          bytesOut: value.length,
        };
      }
      if (deferred === '') return { kind: 'idle' };
      const value = encodeBase64(deferred, options);
      return {
        kind: 'text',
        value,
        warnings: [],
        bytesIn: new TextEncoder().encode(deferred).length,
        bytesOut: value.length,
      };
    }

    if (deferred.trim() === '') return { kind: 'idle' };
    const options = { urlSafe, strictAlphabet: strict };
    const decoded = decodeBase64(deferred, options);
    if (decoded.ok) {
      return {
        kind: 'text',
        value: decoded.text,
        warnings: decoded.warnings,
        bytesIn: deferred.length,
        bytesOut: new TextEncoder().encode(decoded.text).length,
      };
    }
    // Not text is not the same as not valid. If the bytes themselves came out
    // cleanly, the input was a file and that is the answer.
    const bytes = base64ToBytes(deferred, options);
    if (bytes.ok) return { kind: 'binary', bytes: bytes.bytes };
    return { kind: 'error', message: decoded.error };
  }, [direction, attachment, deferred, urlSafe, padding, wrap, crlf, strict]);

  async function receive(file: File) {
    const check = checkFile(file, ANY_FILE);
    if (!check.ok) {
      setFileError(check.error);
      return;
    }
    setFileError(null);
    try {
      const buffer = await file.arrayBuffer();
      setAttachment({ name: file.name, bytes: new Uint8Array(buffer) });
      setText('');
      markStarted();
      toolTracker(SLUG).filesAdded([file]);
    } catch {
      setFileError('That file could not be read. Try choosing it again, or paste its text instead.');
    }
  }

  return (
    <ToolWorkspace label="Base64 encoder and decoder">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">Direction</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DIRECTIONS.map((option) => (
            <DirectionCard
              key={option.value}
              option={option}
              checked={direction === option.value}
              onSelect={(value) => {
                setDirection(value);
                // A file cannot be decoded from, so holding on to one across the
                // switch would leave an input the tool would then ignore.
                if (value === 'decode') {
                  setAttachment(null);
                  setFileError(null);
                }
              }}
            />
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* A `<label for>` pointing at an element that is not rendered is a
              broken label, so while a file is held the heading is plain text. */}
          {attachment ? (
            <p className="text-sm font-medium text-fg">File to encode</p>
          ) : (
            <label htmlFor={INPUT_ID} className="text-sm font-medium text-fg">
              {encoding ? 'Text to encode' : 'Base64 to decode'}
            </label>
          )}
          <div className="flex items-center gap-2">
            {encoding ? (
              <>
                {/* Written before its label because Tailwind's `peer-*` variants
                    compile to `~`, which only reaches a later sibling. */}
                <input
                  id={FILE_ID}
                  type="file"
                  accept={acceptAttribute(ANY_FILE)}
                  className="peer sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void receive(file);
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
                  Encode a file
                </label>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              iconLeft="trash"
              disabled={text === '' && attachment === null}
              onClick={() => {
                setText('');
                setAttachment(null);
                setFileError(null);
              }}
            >
              Clear
            </Button>
          </div>
        </div>

        {attachment ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken p-3">
            <Icon name="file" size={20} className="shrink-0 text-fg-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{attachment.name}</p>
              <p className="tabular text-xs text-fg-muted">
                {humanBytes(attachment.bytes.length)} · read in this tab, not uploaded
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconLeft="x"
              onClick={() => setAttachment(null)}
            >
              Remove
            </Button>
          </div>
        ) : (
          <Textarea
            id={INPUT_ID}
            value={text}
            rows={8}
            monospace
            placeholder={
              encoding
                ? 'Anything you can type. Emoji, accents and other alphabets all encode correctly.'
                : 'SGVsbG8sIHdvcmxkIQ=='
            }
            onChange={(event) => {
              setText(event.target.value);
              setFileError(null);
              markStarted();
            }}
            onPaste={(event) => {
              // The one place a guess is safe: an empty box, where there is no
              // work to overwrite and the whole string arrives at once.
              if (text !== '' || direction === 'decode') return;
              const pasted = event.clipboardData.getData('text');
              if (pasted !== '' && looksLikeBase64(pasted)) setDirection('decode');
            }}
          />
        )}

        {encoding && !attachment ? (
          <p className="text-xs text-fg-subtle">
            Or encode a file of up to {humanLimit(ANY_FILE.maxBytes)}. The limit is low on purpose:
            Base64 is a third larger than the bytes it describes, and the result has to fit in a box
            your browser can still lay out.
          </p>
        ) : null}

        {fileError ? (
          <p className="flex gap-1.5 text-sm text-danger-fg">
            <Icon name="alert-circle" size={16} label="Error" className="mt-0.5 shrink-0" />
            <span>{fileError}</span>
          </p>
        ) : null}

        {encoding && !attachment && looksLikeBase64(text) ? (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
            <Icon name="info" size={16} className="shrink-0" />
            This already looks like Base64.
            <Button variant="ghost" size="sm" iconLeft="swap" onClick={() => setDirection('decode')}>
              Decode it instead
            </Button>
          </p>
        ) : null}

        {outcome.kind === 'error' ? <DecodeError message={outcome.message} /> : null}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">
          {encoding ? 'How the output is written' : 'How the input is read'}
        </legend>
        <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-1">
          <Option
            label="URL-safe alphabet"
            hint="Uses - and _ in place of + and /, so the result survives a URL, a filename and a JWT."
            checked={urlSafe}
            onChange={(next) => {
              setUrlSafe(next);
              // Standard Base64 pads, Base64URL usually does not. Follow that
              // unless the user has already said otherwise.
              if (!paddingTouched) setPadding(!next);
            }}
          />
          {encoding ? (
            <Option
              label="Add = padding"
              hint="Pads the length out to a multiple of four. Standard Base64 does this; Base64URL usually omits it."
              checked={padding}
              onChange={(next) => {
                setPadding(next);
                setPaddingTouched(true);
              }}
            />
          ) : (
            <Option
              label="Reject the other alphabet"
              hint="Off by default, because pasted Base64 is very often the wrong variant and decoding it anyway is usually what you want."
              checked={strict}
              onChange={setStrict}
            />
          )}
          {encoding ? (
            <Option
              label="Wrap at 76 characters"
              hint="The line length RFC 2045 sets for email. Any decoder worth using ignores the breaks."
              checked={wrap}
              onChange={setWrap}
            />
          ) : null}
        </div>
      </fieldset>

      {encoding && wrap ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Line ending"
            htmlFor={ENDING_ID}
            hint="Email and older Windows tools expect the carriage return."
          >
            <Select
              id={ENDING_ID}
              value={crlf ? 'crlf' : 'lf'}
              onChange={(event) => setCrlf(event.target.value === 'crlf')}
            >
              <option value="lf">Newline (LF)</option>
              <option value="crlf">Carriage return and newline (CRLF)</option>
            </Select>
          </Field>
        </div>
      ) : null}

      {outcome.kind === 'binary' ? (
        <BinaryResult bytes={outcome.bytes} />
      ) : (
        <TextOutput
          slug={SLUG}
          id={OUTPUT_ID}
          label={encoding ? 'Base64' : 'Decoded text'}
          value={outcome.kind === 'text' ? outcome.value : ''}
          copyTarget={encoding ? 'base64' : 'text'}
          downloadName={encoding ? 'encoded.txt' : 'decoded.txt'}
          rows={8}
          monospace={encoding}
          placeholder={
            outcome.kind === 'error'
              ? 'Fix the problem above and the text appears here.'
              : encoding
                ? 'The Base64 appears here as you type.'
                : 'The decoded text appears here as you type.'
          }
          footer={
            outcome.kind === 'text' ? (
              <div className="space-y-2">
                <Notes items={outcome.warnings} />
                <p className="tabular text-xs text-fg-subtle">
                  {sizeLine(outcome.bytesIn, outcome.bytesOut)}
                </p>
              </div>
            ) : null
          }
        />
      )}
    </ToolWorkspace>
  );
}




