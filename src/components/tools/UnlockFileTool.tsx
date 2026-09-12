'use client';

/**
 * ============================================================================
 * OPEN A PASSWORD-PROTECTED FILE
 * ============================================================================
 * The other half. Takes a .tzlock or an encrypted .zip and gives the files
 * back.
 *
 * ── Why it opens other people's zips too ──────────────────────────────────
 * Someone arriving here is usually holding a file a colleague sent, not one
 * this site made. A tool that only opened its own output would turn most of
 * its visitors away at the door, and reading an AES zip is the same code as
 * writing one. So a locked zip from 7-Zip, WinRAR or Keka opens here as well.
 *
 * ── Why the file is inspected before the password is asked for ────────────
 * Dropping the file shows what it is — how many files, which format, and any
 * reminder the sender left — before anything is typed. Two reasons. A file
 * that is not encrypted at all, or is a format this cannot read, should say so
 * immediately rather than after someone has tried three passwords. And a
 * password prompt with no context is where people paste the wrong password
 * from the wrong message.
 *
 * ── Why a weakly-encrypted zip is called out ──────────────────────────────
 * The original ZipCrypto scheme is breakable in seconds and is still what
 * Windows produces. If someone opens one here, they are the person who most
 * needs to know that the file they were sent was not really protected — so it
 * is said once, plainly, on the result rather than as a scare before it.
 * ============================================================================
 */
import { useCallback, useState } from 'react';

import type { FailureReason } from '@/lib/analytics';

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
import { guessMime } from '@/lib/files/mime';
import { writeZip } from '@/lib/files/zip';
import { listZip, readZipEntry, METHOD_AES, type ZipDirectoryEntry } from '@/lib/files/unzip';
import { LOCKED_FILE_ONE } from '@/lib/tools/accepts';
import { decryptAesEntry } from '@/lib/tools/secure/aeszip';
import { readTzlock, readTzlockHeader } from '@/lib/tools/secure/tzlock';

const SLUG = 'unlock-file';

type Kind = 'tzlock' | 'zip';

interface Opened {
  file: File;
  bytes: Uint8Array;
  kind: Kind;
  /** Names inside, when they can be read without the password. */
  names: string[];
  /** True when at least one entry needs a password. */
  encrypted: boolean;
  /** True when the archive uses the broken ZipCrypto scheme. */
  legacy: boolean;
  hint: string;
}

interface Unlocked {
  name: string;
  bytes: Uint8Array;
}

interface Output {
  files: Unlocked[];
  legacy: boolean;
}

export function UnlockFileTool() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);

  const run = useToolRun<Output>(SLUG);
  const markStarted = useToolStarted(SLUG);

  const onFiles = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;
      markStarted();
      run.reset();
      setOpenError(null);
      setOpened(null);
      setPassword('');

      void (async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());

        // The magic decides, not the extension: a .tzlock renamed to .zip is
        // still a .tzlock, and someone will do exactly that.
        const asTzlock = readTzlockHeader(bytes);
        if (asTzlock.ok) {
          setOpened({
            file,
            bytes,
            kind: 'tzlock',
            // A .tzlock's contents are inside the encryption — by design, since
            // a list of filenames often gives away what the file is.
            names: [],
            encrypted: true,
            legacy: false,
            hint: asTzlock.header.hint,
          });
          return;
        }

        const listed = listZip(bytes);
        if (!listed.ok) {
          setOpenError(
            asTzlock.reason === 'unsupported_type'
              ? 'This is not a locked file this tool can read. It opens Toolzen .tzlock files and password-protected .zip files.'
              : asTzlock.error,
          );
          return;
        }

        const entries = listed.entries.filter((entry) => !entry.isDirectory);
        setOpened({
          file,
          bytes,
          kind: 'zip',
          names: entries.map((entry) => entry.name),
          encrypted: entries.some((entry) => entry.encrypted),
          legacy: entries.some((entry) => entry.legacyEncryption),
          hint: '',
        });
      })();
    },
    [markStarted, run],
  );

  const onRun = useCallback(() => {
    if (!opened) return;
    markStarted();

    void run.start(
      async (ctx) => {
        if (opened.kind === 'tzlock') {
          const unlocked = await readTzlock(opened.bytes, password, {
            onProgress: (done, total) => ctx.report(done, total),
            checkpoint: () => ctx.checkpoint(),
          });
          if (!unlocked.ok) {
            return { ok: false as const, error: unlocked.error, reason: unlocked.reason };
          }
          // The plaintext is an ordinary zip; unwrap it into the real files.
          const inner = listZip(unlocked.files[0].bytes);
          if (!inner.ok) return { ok: false as const, error: inner.error, reason: inner.reason };

          const out: Unlocked[] = [];
          for (const entry of inner.entries) {
            if (entry.isDirectory) continue;
            await ctx.checkpoint();
            const read = await readZipEntry(entry);
            if (!read.ok) return { ok: false as const, error: read.error, reason: read.reason };
            out.push({ name: entry.name, bytes: read.bytes });
          }
          return { ok: true as const, value: { files: out, legacy: false } };
        }

        const listed = listZip(opened.bytes);
        if (!listed.ok) return { ok: false as const, error: listed.error, reason: listed.reason };

        const entries = listed.entries.filter((entry) => !entry.isDirectory);
        const out: Unlocked[] = [];
        for (const [index, entry] of entries.entries()) {
          await ctx.checkpoint();
          const read = await openEntry(entry, password);
          if (!read.ok) return { ok: false as const, error: read.error, reason: read.reason };
          out.push({ name: entry.name, bytes: read.bytes });
          ctx.report(index + 1, entries.length);
        }
        return { ok: true as const, value: { files: out, legacy: opened.legacy } };
      },
      { count: 1 },
    );
  }, [markStarted, opened, password, run]);

  const reset = useCallback(() => {
    setOpened(null);
    setOpenError(null);
    setPassword('');
    run.reset();
  }, [run]);

  const result = run.result;
  const needsPassword = opened?.encrypted ?? false;

  return (
    <ToolWorkspace
      label="Open a password-protected file"
      error={run.error ?? openError}
      status={
        run.busy
          ? 'Checking the password and decrypting'
          : result
            ? `Opened — ${result.files.length} ${result.files.length === 1 ? 'file' : 'files'}`
            : null
      }
    >
      {!opened ? (
        <FileDropzone slug={SLUG} accept={LOCKED_FILE_ONE} onFiles={onFiles} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
              <Icon name="lock" size={18} className="shrink-0 text-fg-subtle" />
              <span className="truncate text-fg" title={opened.file.name}>
                {opened.file.name}
              </span>
              <span className="shrink-0">
                · {humanBytes(opened.file.size)} ·{' '}
                {opened.kind === 'tzlock' ? 'Toolzen locked file' : 'zip archive'}
              </span>
            </p>
            <Button variant="ghost" size="sm" iconLeft="x" onClick={reset} disabled={run.busy}>
              Choose a different file
            </Button>
          </div>

          {opened.names.length > 0 ? (
            <ul className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto">
              {opened.names.map((name, index) => (
                <li
                  key={`${name}-${index}`}
                  className="flex items-center gap-2 rounded border border-border bg-surface-sunken px-3 py-2 text-sm"
                >
                  <Icon name="file" size={16} className="shrink-0 text-fg-subtle" />
                  <span className="truncate text-fg">{name}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {opened.hint !== '' ? (
            <Alert variant="info" title="The sender left a reminder">
              {opened.hint}
            </Alert>
          ) : null}

          {!needsPassword ? (
            <Alert variant="warning" title="This archive is not encrypted">
              Nothing in it is password-protected, so anyone who has the file can already read it.
              You can still unpack it here.
            </Alert>
          ) : null}

          {needsPassword ? (
            <Field label="Password" htmlFor="unlock-password">
              <div className="flex items-center gap-2">
                <Input
                  id="unlock-password"
                  type={revealed ? 'text' : 'password'}
                  value={password}
                  disabled={run.busy}
                  autoComplete="off"
                  placeholder="The password the sender gave you"
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && password !== '' && !run.busy) onRun();
                  }}
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
          ) : null}

          <ToolRunBar
            label={needsPassword ? 'Unlock' : 'Unpack'}
            busy={run.busy}
            disabled={needsPassword && password === ''}
            progress={run.progress}
            onRun={onRun}
            onCancel={run.cancel}
            hint={
              opened.kind === 'tzlock'
                ? 'Checking the password takes about a second — that slowness is deliberate, and it is what makes guessing expensive.'
                : 'The file is decrypted on your device. Neither it nor the password is uploaded.'
            }
          />
        </>
      )}

      {result ? (
        <ToolResult
          slug={SLUG}
          title={result.files.length === 1 ? 'Your file is ready' : 'Your files are ready'}
          summary={`${result.files.length} ${result.files.length === 1 ? 'file' : 'files'} · ${humanBytes(result.files.reduce((sum, file) => sum + file.bytes.length, 0))}`}
          download={
            result.files.length === 1
              ? {
                  label: 'Download',
                  format: 'file',
                  count: 1,
                  deliver: () => {
                    const only = run.result?.files[0];
                    if (!only) {
                      return {
                        ok: false as const,
                        reason: 'unknown' as const,
                        error: 'There is nothing to download yet.',
                      };
                    }
                    return downloadBytes(only.bytes, only.name, guessMime(only.name));
                  },
                }
              : {
                  label: 'Download all as a zip',
                  format: 'zip',
                  count: result.files.length,
                  deliver: () => {
                    const files = run.result?.files ?? [];
                    const archive = writeZip(
                      files.map((file) => ({ name: file.name, data: file.bytes })),
                    );
                    if (!archive.ok) return archive;
                    return downloadBytes(archive.bytes, 'unlocked.zip', 'application/zip');
                  },
                }
          }
          onUseAgain={reset}
          useAgainLabel="Open another"
        >
          {result.files.length > 1 ? (
            <ul className="scrollbar-thin max-h-56 space-y-1 overflow-y-auto">
              {result.files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-2 rounded border border-border bg-surface-sunken px-3 py-2 text-sm"
                >
                  <Icon name="file" size={16} className="shrink-0 text-fg-subtle" />
                  <span className="truncate text-fg" title={file.name}>
                    {file.name}
                  </span>
                  <span className="ml-auto shrink-0 text-fg-muted">
                    {humanBytes(file.bytes.length)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconLeft="download"
                    onClick={() => downloadBytes(file.bytes, file.name, guessMime(file.name))}
                  >
                    Save
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {result.legacy ? (
            <Alert variant="warning" title="That file was only weakly protected">
              It used ZipCrypto, the original zip encryption, which has been breakable since the
              nineties — free tools recover the contents in seconds without the password. If
              whatever is inside it mattered, it is worth locking again with AES-256 and telling
              whoever sent it.
            </Alert>
          ) : null}
        </ToolResult>
      ) : null}
    </ToolWorkspace>
  );
}

type EntryResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: FailureReason; error: string };

/** One entry, encrypted or not. */
async function openEntry(entry: ZipDirectoryEntry, password: string): Promise<EntryResult> {
  if (!entry.encrypted) {
    return readZipEntry(entry);
  }
  if (entry.method !== METHOD_AES) {
    return {
      ok: false,
      reason: 'unsupported_type',
      error:
        'This archive uses the old ZipCrypto encryption, which this tool does not implement. 7-Zip opens it with the password.',
    };
  }
  if (entry.aesStrength !== 3) {
    return {
      ok: false,
      reason: 'unsupported_type',
      error: `“${entry.name}” uses AES-${entry.aesStrength === 1 ? 128 : 192}, which this tool does not read. 7-Zip does.`,
    };
  }
  return decryptAesEntry(entry.payload, password, entry.innerMethod, entry.crc);
}
