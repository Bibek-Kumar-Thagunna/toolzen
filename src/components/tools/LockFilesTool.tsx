'use client';

/**
 * ============================================================================
 * PASSWORD-PROTECT FILES
 * ============================================================================
 * Files in, one locked file out, encrypted in the tab.
 *
 * ── Why the format choice is the first control on the page ────────────────
 * The two outputs differ in the one way the user cannot discover afterwards:
 * who can open them. A .zip opens in 7-Zip on the recipient's own computer; a
 * .tzlock opens here and nowhere else. Burying that under an "advanced"
 * heading would mean people picking by accident and finding out when a
 * colleague cannot open the file.
 *
 * ── Why the strength meter reports a time and not a colour ────────────────
 * The two formats use work factors that differ by a factor of six hundred, so
 * the same password is meaningfully weaker in one than the other. A coloured
 * bar cannot say that. "About 3 hours" versus "about 200 years", recomputed as
 * the format changes, says it in a way nobody misreads — and it makes the
 * argument for a longer password without lecturing.
 *
 * ── Why there is no "remember this password" ──────────────────────────────
 * Nothing here touches storage. A password kept in localStorage next to the
 * file it opens is the security equivalent of taping the key to the door, and
 * the convenience is not worth the sentence it would take to warn about.
 *
 * ── Why the password is not confirmed twice ───────────────────────────────
 * It is — but with a reveal button rather than a second box. A confirm field
 * catches a typo made twice identically about as often as it causes one, and
 * for a file that cannot be recovered, seeing the password is the check that
 * actually works. The warning that a forgotten password means the file is gone
 * sits next to the button, because it is true and there is no recovery path.
 * ============================================================================
 */
import { useCallback, useMemo, useState } from 'react';

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
import { humanBytes } from '@/lib/files/bytes';
import { downloadBytes } from '@/lib/files/download';
import { safeBaseName } from '@/lib/files/name';
import { ANY_FILES_MANY } from '@/lib/tools/accepts';
import { writeAesZip } from '@/lib/tools/secure/aeszip';
import { estimateStrength, timeToGuess, STRENGTH_LABELS } from '@/lib/tools/secure/strength';
import {
  writeTzlock,
  TZLOCK_EXTENSION,
  TZLOCK_ITERATIONS,
  TZLOCK_MAX_TOTAL_BYTES,
} from '@/lib/tools/secure/tzlock';

const SLUG = 'password-protect-files';

const ZIP_MIME = 'application/zip';
const TZLOCK_MIME = 'application/octet-stream';

/** The 1000 rounds the AES zip specification freezes every reader at. */
const ZIP_ITERATIONS = 1000;

type Format = 'zip' | 'tzlock';

interface Output {
  bytes: Uint8Array;
  name: string;
  format: Format;
  fileCount: number;
}

export function LockFilesTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<Format>('zip');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [hint, setHint] = useState('');

  const run = useToolRun<Output>(SLUG);
  const markStarted = useToolStarted(SLUG);

  const strength = useMemo(() => estimateStrength(password), [password]);
  const iterations = format === 'tzlock' ? TZLOCK_ITERATIONS : ZIP_ITERATIONS;
  const guessTime = useMemo(
    () => timeToGuess(strength.bits, iterations),
    [strength.bits, iterations],
  );

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const tooBigForTzlock = format === 'tzlock' && totalBytes > TZLOCK_MAX_TOTAL_BYTES;

  const onFiles = useCallback(
    (incoming: File[]) => {
      markStarted();
      run.reset();
      setFiles((current) => [...current, ...incoming]);
    },
    [markStarted, run],
  );

  const removeAt = useCallback((index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
  }, []);

  const onRun = useCallback(() => {
    if (files.length === 0 || password === '') return;
    markStarted();

    void run.start(
      async (ctx) => {
        const payloads = [];
        for (const file of files) {
          await ctx.checkpoint();
          payloads.push({
            name: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
            modified: new Date(file.lastModified),
          });
        }

        const options = {
          onProgress: (done: number, total: number) => ctx.report(done, total),
          checkpoint: () => ctx.checkpoint(),
        };

        const first = files[0];
        const base =
          files.length === 1 && first
            ? safeBaseName(first.name.replace(/\.[^.]+$/, ''), { fallback: 'locked' })
            : 'locked-files';

        if (format === 'tzlock') {
          const locked = await writeTzlock(payloads, password, {
            ...options,
            ...(hint.trim() === '' ? {} : { hint: hint.trim() }),
          });
          if (!locked.ok) return { ok: false as const, error: locked.error, reason: locked.reason };
          return {
            ok: true as const,
            value: {
              bytes: locked.bytes,
              name: `${base}${TZLOCK_EXTENSION}`,
              format,
              fileCount: payloads.length,
            },
          };
        }

        const locked = await writeAesZip(payloads, password, options);
        if (!locked.ok) return { ok: false as const, error: locked.error, reason: locked.reason };
        return {
          ok: true as const,
          value: { bytes: locked.bytes, name: `${base}.zip`, format, fileCount: payloads.length },
        };
      },
      { count: files.length },
    );
  }, [files, format, hint, markStarted, password, run]);

  const reset = useCallback(() => {
    setFiles([]);
    setPassword('');
    setHint('');
    run.reset();
  }, [run]);

  const result = run.result;

  return (
    <ToolWorkspace
      label="Password-protect files"
      error={run.error}
      status={run.busy ? 'Encrypting' : result ? 'Done — your file is locked' : null}
    >
      <FileDropzone
        slug={SLUG}
        accept={ANY_FILES_MANY}
        existing={files.length}
        disabled={run.busy}
        onFiles={onFiles}
      />

      {files.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg-muted">
              {files.length} {files.length === 1 ? 'file' : 'files'} · {humanBytes(totalBytes)}
            </p>
            <Button variant="ghost" size="sm" iconLeft="x" onClick={reset} disabled={run.busy}>
              Start over
            </Button>
          </div>

          <ul className="scrollbar-thin max-h-48 space-y-1 overflow-y-auto">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 rounded border border-border bg-surface-sunken px-3 py-2 text-sm"
              >
                <Icon name="file" size={16} className="shrink-0 text-fg-subtle" />
                <span className="truncate text-fg" title={file.name}>
                  {file.name}
                </span>
                <span className="ml-auto shrink-0 text-fg-muted">{humanBytes(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  disabled={run.busy}
                  className="shrink-0 rounded p-1 text-fg-subtle hover:bg-surface hover:text-fg disabled:opacity-50"
                  aria-label={`Remove ${file.name}`}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>

          {/* The decision that cannot be undone later, made first. */}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-fg">Who should be able to open it?</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormatChoice
                id="fmt-zip"
                checked={format === 'zip'}
                disabled={run.busy}
                onSelect={() => setFormat('zip')}
                title="Anyone with 7-Zip"
                detail="A standard AES-256 .zip. Opens in 7-Zip, WinRAR, Keka and macOS. Windows' built-in unzipper cannot open it."
              />
              <FormatChoice
                id="fmt-tzlock"
                checked={format === 'tzlock'}
                disabled={run.busy}
                onSelect={() => setFormat('tzlock')}
                title="Only on The Toolzen"
                detail="Our own .tzlock file. The recipient opens it on this site — and the password is 600× harder to guess."
              />
            </div>
          </fieldset>

          <Field
            label="Password"
            htmlFor="lock-password"
            hint="Nobody can recover this for you — not us, not anyone. If it is lost, the file is gone."
          >
            <div className="flex items-center gap-2">
              <Input
                id="lock-password"
                type={revealed ? 'text' : 'password'}
                value={password}
                disabled={run.busy}
                autoComplete="new-password"
                placeholder="Four random words beats one clever word"
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                variant="secondary"
                size="sm"
                iconLeft={revealed ? 'eye-off' : 'eye'}
                onClick={() => setRevealed((current) => !current)}
                disabled={run.busy}
              >
                {revealed ? 'Hide' : 'Show'}
              </Button>
            </div>
          </Field>

          {password !== '' ? (
            <StrengthMeter
              score={strength.score}
              warning={strength.warning}
              guessTime={guessTime}
              format={format}
            />
          ) : null}

          {format === 'tzlock' ? (
            <Field
              label="Password reminder (optional)"
              htmlFor="lock-hint"
              hint="Shown to whoever opens the file, before they type anything. Anyone holding the file can read it, so make it a nudge, not the answer."
            >
              <Input
                id="lock-hint"
                value={hint}
                maxLength={100}
                disabled={run.busy}
                placeholder="e.g. the usual one"
                onChange={(event) => setHint(event.target.value)}
              />
            </Field>
          ) : null}

          {format === 'zip' ? (
            <Alert variant="info" title="Your recipient will need 7-Zip or similar">
              Windows can make and open the old kind of password-protected zip, but that kind has
              been breakable since the nineties, so this writes the AES-256 kind instead — which
              Windows Explorer will not open. 7-Zip is free; macOS users can use Keka or The
              Unarchiver.
            </Alert>
          ) : (
            <Alert variant="info" title="They will need this site — and that is convenience, not security">
              No other program knows this format, so the file opens here. The protection comes from
              the password and AES-256, never from the format being ours. A download link for a
              standalone offline unlocker comes with the file, so it is never trapped.
            </Alert>
          )}

          {tooBigForTzlock ? (
            <Alert variant="warning" title="Too much for one .tzlock">
              That is over {Math.round(TZLOCK_MAX_TOTAL_BYTES / (1024 * 1024))} MB, which is more
              than a browser tab can encrypt in one piece. Choose the zip option, which works file
              by file, or lock these in two batches.
            </Alert>
          ) : null}

          <ToolRunBar
            label="Lock files"
            busy={run.busy}
            disabled={password === '' || tooBigForTzlock}
            progress={run.progress}
            progressLabel={(p) => `${humanBytes(p.done)} of ${humanBytes(p.total)}`}
            onRun={onRun}
            onCancel={run.cancel}
            hint={
              password === ''
                ? 'Choose a password first.'
                : 'Your files are encrypted on your device and never uploaded.'
            }
          />
        </>
      ) : null}

      {result ? (
        <ToolResult
          slug={SLUG}
          title="Your file is locked"
          summary={`${result.fileCount} ${result.fileCount === 1 ? 'file' : 'files'} · ${humanBytes(result.bytes.length)} · ${result.format === 'zip' ? 'AES-256 zip' : 'Toolzen-locked file'}`}
          download={{
            label: result.format === 'zip' ? 'Download .zip' : 'Download .tzlock',
            format: result.format,
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
              return downloadBytes(
                output.bytes,
                output.name,
                output.format === 'zip' ? ZIP_MIME : TZLOCK_MIME,
              );
            },
          }}
          onUseAgain={reset}
          useAgainLabel="Lock something else"
        >
          <Alert variant="warning" title="Check you can open it before you send it">
            Open the locked file in the unlocker and type the password in. It takes ten seconds and
            it is the only way to find out that the password is what you think it is — there is no
            recovery if it is not.
          </Alert>
          {result.format === 'tzlock' ? (
            <p className="text-sm text-fg-muted">
              Keep a copy of the{' '}
              <a className="underline hover:text-fg" href="/unlock.html" download="toolzen-unlock.html">
                offline unlocker
              </a>{' '}
              with the file. It is one page, needs no internet, and opens a .tzlock without this
              site existing.
            </p>
          ) : null}
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}

/**
 * A radio rendered as a card, because the two options differ in a sentence
 * rather than a word and a native radio label wraps badly around one.
 */
function FormatChoice({
  id,
  checked,
  disabled,
  onSelect,
  title,
  detail,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
        checked ? 'border-accent bg-accent-subtle' : 'border-border bg-surface hover:border-border-strong'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <input
        id={id}
        type="radio"
        name="lock-format"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1 h-4 w-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{detail}</span>
      </span>
    </label>
  );
}

const BAR_COLOURS = [
  'bg-danger',
  'bg-danger',
  'bg-warning',
  'bg-accent',
  'bg-success',
] as const;

function StrengthMeter({
  score,
  warning,
  guessTime,
  format,
}: {
  score: 0 | 1 | 2 | 3 | 4;
  warning: string | null;
  guessTime: string;
  format: Format;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-sunken p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-fg">{STRENGTH_LABELS[score]}</span>
        <span className="text-sm text-fg-muted">
          Guessed in <strong className="font-medium text-fg">{guessTime}</strong>
        </span>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1.5 flex-1 rounded-full ${step <= score ? BAR_COLOURS[score] : 'bg-track'}`}
          />
        ))}
      </div>
      <p className="text-xs leading-relaxed text-fg-muted">
        {warning ?? (
          <>
            Estimated against someone with serious hardware attacking{' '}
            {format === 'zip' ? 'the 1,000 rounds a zip allows' : 'the 600,000 rounds this format uses'}
            . It is a floor, not a promise.
          </>
        )}
      </p>
    </div>
  );
}
