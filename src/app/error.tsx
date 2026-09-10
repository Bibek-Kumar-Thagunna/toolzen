'use client';

import { useEffect } from 'react';
import Link from 'next/link';

import { routes } from '@/lib/site';
import { Container } from '@/components/layout/Container';
import { Button, buttonClasses } from '@/components/ui/Button';

/**
 * Route-level error boundary.
 *
 * The rule this file enforces: **a normal user never sees a technical error.**
 * `error.message` can contain a stack frame, a bundler path, a chunk hash or the
 * internals of a PDF parser, none of which help anyone and all of which look
 * broken. So the message shown is written by us, and the only machine detail
 * offered is Next's own `digest` — a short hash, not a stack — which lets a bug
 * report be matched to a server log line.
 *
 * The developer-facing detail goes to the console instead, where it belongs.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Not `console.error` in production only — this is the one place the real
    // error should be visible to whoever is debugging, on any environment.
    console.error('[flint] unhandled route error', error);
  }, [error]);

  return (
    <Container size="tool" as="section" className="py-16 sm:py-24">
      <p className="text-2xs font-semibold uppercase tracking-widest text-fg-muted">
        Something went wrong
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        This page ran into a problem
      </h1>
      <p className="mt-4 max-w-prose text-md text-fg-muted">
        Nothing you were working on has been sent anywhere — the tools run in your browser, so a
        failure here means the page stopped, not that your file went missing. Trying again usually
        works; reloading always gives a clean start.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={reset} variant="primary" iconLeft="refresh">
          Try again
        </Button>
        {/*
          `buttonClasses()` rather than a `<Button>` wrapping a link. Button
          always renders a `<button>`, on purpose — a button that is really a
          link breaks middle-click, ⌘-click and the status bar. Borrowing the
          classes keeps one visual language with correct semantics.
        */}
        <Link href={routes.tools} className={buttonClasses({ variant: 'secondary' })}>
          Browse all tools
        </Link>
      </div>

      {error.digest ? (
        <p className="mt-10 text-xs text-fg-muted">
          If you report this, quoting <code className="font-mono">{error.digest}</code> lets us find
          the exact failure.
        </p>
      ) : null}
    </Container>
  );
}
