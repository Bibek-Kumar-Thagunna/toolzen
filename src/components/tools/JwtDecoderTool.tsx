'use client';

import { useEffect, useMemo, useState } from 'react';

import { Icon, type IconName } from '@/components/icons';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import {
  decodeJwt,
  verifyHmacSignature,
  type DecodedJwt,
  type JwtClaimNote,
} from '@/lib/tools/dev/jwt';

/**
 * ============================================================================
 * JWT DECODER
 * ============================================================================
 * ── Why nothing is decoded until the browser reports the time ───────────────
 * Half of what this tool says is relative to now: "expired 3 days ago", "valid
 * for another 12 minutes". A client component still renders once on the server,
 * where `Date.now()` is a different number, and React reports that difference as
 * a hydration error on a page that looked fine. So `now` starts at 0, an effect
 * fills it in, and the decode is skipped while it is 0. On the server that means
 * no output at all rather than output that cannot survive hydration. The same
 * effect re-reads the clock every thirty seconds, which is what keeps a countdown
 * from going stale in an open tab — and lets a token expire in front of you.
 *
 * ── Why verification goes through `useToolRun` ──────────────────────────────
 * Decoding is instant and local, so it needs no lifecycle. Checking a signature
 * is genuinely asynchronous work through Web Crypto, and it is the one operation
 * on this page that `processing_started` and `processing_completed` describe
 * honestly. Routing it through the hook also means a thrown `DOMException` from
 * `crypto.subtle` cannot reach the interface as an exception message.
 *
 * ── Why a passing check is the only thing that removes the warning ──────────
 * `decodeJwt` puts the same sentence first in `warnings` on every single token:
 * decoding proves nothing, because anyone can write a token that decodes. That
 * sentence is shown as the first thing on the page and is replaced only when a
 * real signature check has passed against a secret the user supplied. Editing
 * either the token or the secret discards the result, because otherwise the page
 * would keep claiming a verified signature for a token that has since changed
 * (§35).
 *
 * ── Why the secret is masked and warned about ──────────────────────────────
 * A signing secret is the whole of a token's security. It is masked by default
 * with a reveal toggle for the inevitable typo, and the panel says plainly that a
 * production secret should not be pasted into a page you do not control,
 * including this one. Saying so costs a little trust and earns more.
 * ============================================================================
 */

const SLUG = 'jwt-decoder';
const INPUT_ID = 'jwt-input';
const SECRET_ID = 'jwt-secret';
const CLOCK_INTERVAL_MS = 30_000;

/** Severity as a glyph with a word behind it, so it is never colour alone (§16). */
const STATES: Record<JwtClaimNote['state'], { icon: IconName; label: string; tone: string }> = {
  ok: { icon: 'check-circle', label: 'Fine', tone: 'text-success-fg' },
  warn: { icon: 'alert-triangle', label: 'Worth knowing', tone: 'text-warning-fg' },
  error: { icon: 'alert-circle', label: 'Problem', tone: 'text-danger-fg' },
  info: { icon: 'info', label: 'Note', tone: 'text-fg-muted' },
};

/**
 * A rounded, readable gap. Exact seconds are pointless at this scale — a token
 * that expires in 11 hours 43 minutes expires in twelve hours — and the precise
 * timestamp is in the claim list for anyone who needs it.
 */
function humanDuration(seconds: number): string {
  const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? '' : 's'}`;
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return unit(whole, 'second');
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return unit(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 48) return unit(hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 730) return unit(days, 'day');
  return unit(Math.round(days / 365), 'year');
}

/** The headline the how-to promises: how long ago, or how much longer. */
function expiry(jwt: DecodedJwt): { text: string; state: JwtClaimNote['state'] } {
  if (jwt.expiresInSeconds === null) {
    return { text: 'No expiry — this token never stops working', state: 'warn' };
  }
  if (jwt.expiresInSeconds < 0) {
    return { text: `Expired ${humanDuration(-jwt.expiresInSeconds)} ago`, state: 'error' };
  }
  if (jwt.isNotYetValid) {
    return { text: 'Not valid yet — its start time is in the future', state: 'error' };
  }
  return { text: `Valid for another ${humanDuration(jwt.expiresInSeconds)}`, state: 'ok' };
}

/** A claim value on one line, whatever shape the JSON gave it. */
function rawValue(raw: unknown): string {
  if (raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean' || raw === null) return String(raw);
  try {
    return JSON.stringify(raw) ?? '';
  } catch {
    return '';
  }
}

/** One fact about the token, in the row above the claims. */
function Summary({ term, value, state }: { term: string; value: string; state?: JwtClaimNote['state'] }) {
  const glyph = state ? STATES[state] : null;
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
      <dt className="text-2xs uppercase tracking-wide text-fg-subtle">{term}</dt>
      <dd className="mt-0.5 flex items-start gap-1.5 text-sm font-medium text-fg">
        {glyph ? (
          <Icon name={glyph.icon} size={16} label={glyph.label} className={cn('mt-0.5 shrink-0', glyph.tone)} />
        ) : null}
        <span className="min-w-0">{value}</span>
      </dd>
    </div>
  );
}

/** Every claim the engine could name, with what it means rather than what it holds. */
function Claims({ claims }: { claims: readonly JwtClaimNote[] }) {
  if (claims.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        This token carries no registered claims — no issuer, no subject, no expiry. That is legal
        and unusual, and it means nothing in the token limits when or where it can be used.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {claims.map((claim) => {
        const glyph = STATES[claim.state];
        const raw = rawValue(claim.raw);
        return (
          <li key={claim.claim} className="flex gap-2.5 py-2.5">
            <Icon
              name={glyph.icon}
              size={16}
              label={glyph.label}
              className={cn('mt-1 shrink-0', glyph.tone)}
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium text-fg">{claim.label}</span>
                <code className="font-mono text-2xs text-fg-subtle">{claim.claim}</code>
              </p>
              {raw === '' ? null : (
                <p className="truncate font-mono text-xs text-fg-muted" title={raw}>
                  {raw}
                </p>
              )}
              <p className="mt-0.5 text-sm text-fg-muted">{claim.human}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The things worth knowing that are not tied to one claim. */
function Notes({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5 text-warning-fg">
          <Icon name="alert-triangle" size={14} label="Note" className="mt-1 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A refusal, in the engine's own words — they are already written for a person. */
function Problem({ message }: { message: string }) {
  return (
    <div className="flex gap-2 rounded-md border border-danger-border bg-danger-subtle p-3 text-sm text-danger-fg">
      <Icon name="alert-circle" size={18} label="Error" className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
    </div>
  );
}

/**
 * The first thing the page says about any token. Until a signature check has
 * actually passed, this is the engine's own sentence about what decoding does and
 * does not prove.
 */
function Verdict({
  verified,
  algorithm,
  warning,
}: {
  verified: boolean;
  algorithm: string;
  warning: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-lg border p-3 text-sm',
        verified
          ? 'border-success-border bg-success-subtle text-success-fg'
          : 'border-warning-border bg-warning-subtle text-warning-fg',
      )}
    >
      <Icon
        name={verified ? 'shield' : 'alert-triangle'}
        size={18}
        label={verified ? 'Verified' : 'Not verified'}
        className="mt-0.5 shrink-0"
      />
      <p className="min-w-0 flex-1">
        {verified
          ? `The signature matches the secret you entered, so this token has not been altered since it was signed with ${algorithm}.`
          : warning}
      </p>
    </div>
  );
}

export function JwtDecoderTool() {
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [reveal, setReveal] = useState(false);
  // 0 means "the browser has not told us the time yet", which is the state every
  // server render is in. See the note at the top of this file.
  const [now, setNow] = useState(0);
  const markStarted = useToolStarted(SLUG);
  const check = useToolRun<boolean>(SLUG);
  const { reset: forgetCheck } = check;

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), CLOCK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // A verdict belongs to one token and one secret. Change either and it is
  // discarded, because a stale "verified" badge is a false claim about whatever
  // is now on screen.
  useEffect(() => {
    forgetCheck();
  }, [token, secret, forgetCheck]);

  const decoded = useMemo(() => {
    if (now === 0 || token.trim() === '') return null;
    return decodeJwt(token, { now });
  }, [token, now]);

  const jwt = decoded !== null && decoded.ok ? decoded.jwt : null;
  const when = jwt ? expiry(jwt) : null;
  const verified = check.phase === 'done' && check.result === true;

  async function verify() {
    await check.start(async () => {
      const checked = await verifyHmacSignature(token, secret);
      // `ok: false` here means the check could not be run at all — a public-key
      // algorithm, a missing secret, a malformed token. That is a different thing
      // from a signature that does not match, and it is shown differently.
      if (!checked.ok) return { ok: false, error: checked.error, reason: 'invalid_input' };
      return { ok: true, value: checked.valid };
    });
  }

  return (
    <ToolWorkspace label="JWT decoder">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={INPUT_ID} className="text-sm font-medium text-fg">
            Token
          </label>
          <Button
            variant="ghost"
            size="sm"
            iconLeft="trash"
            disabled={token === ''}
            onClick={() => setToken('')}
          >
            Clear
          </Button>
        </div>

        <Textarea
          id={INPUT_ID}
          value={token}
          rows={6}
          monospace
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
          onChange={(event) => {
            setToken(event.target.value);
            markStarted();
          }}
        />

        <p className="text-xs text-fg-subtle">
          A leading “Bearer ”, surrounding quotes and line breaks are removed for you. The token is
          read in this tab, and you can confirm in your developer tools that nothing is sent
          anywhere.
        </p>

        {decoded !== null && !decoded.ok ? <Problem message={decoded.error} /> : null}
      </div>

      {jwt && when ? (
        <>
          <Verdict
            verified={verified}
            algorithm={jwt.algorithm}
            warning={jwt.warnings[0] ?? ''}
          />

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Summary
              term="Algorithm"
              value={jwt.algorithm === '' ? 'Not stated' : jwt.algorithm}
              state={/^(none|)$/i.test(jwt.algorithm) ? 'error' : 'info'}
            />
            <Summary term="Expiry" value={when.text} state={when.state} />
            <Summary
              term="Signature"
              value={jwt.signatureBytes === 0 ? 'None at all' : `${jwt.signatureBytes} bytes`}
              state={jwt.signatureBytes === 0 ? 'error' : 'info'}
            />
          </dl>

          {/* The first warning is the one in the verdict above; repeating it here
              would be the same sentence twice on one screen. */}
          <Notes items={jwt.warnings.slice(1)} />

          <section aria-labelledby="jwt-claims" className="space-y-2">
            <h2 id="jwt-claims" className="text-sm font-medium text-fg">
              What this token claims
            </h2>
            <Claims claims={jwt.claims} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <TextOutput
              slug={SLUG}
              id="jwt-header"
              label="Header"
              value={jwt.headerJson}
              copyTarget="header"
              downloadName="jwt-header.json"
              rows={6}
              monospace
            />
            <TextOutput
              slug={SLUG}
              id="jwt-payload"
              label="Payload"
              value={jwt.payloadJson}
              copyTarget="payload"
              downloadName="jwt-payload.json"
              rows={6}
              monospace
            />
          </div>
        </>
      ) : null}

      <section
        aria-labelledby="jwt-verify"
        className="space-y-3 rounded-lg border border-border bg-surface-sunken p-4"
      >
        <div className="space-y-1">
          <h2 id="jwt-verify" className="text-sm font-medium text-fg">
            Check the signature
          </h2>
          <p className="text-sm text-fg-muted">
            HS256, HS384 and HS512 are signed with a shared secret, and that is the case this page
            can settle: Web Crypto recomputes the signature and compares the two in constant time.
            RS256, ES256 and the other public-key algorithms need the issuer’s public key from its
            JWKS endpoint, which is not something a token carries.
          </p>
        </div>

        <Field
          label="Shared secret"
          htmlFor={SECRET_ID}
          optional
          hint="Do not paste a production secret into a web page you do not control, including this one. Use a development copy."
        >
          <Input
            id={SECRET_ID}
            value={secret}
            type={reveal ? 'text' : 'password'}
            iconLeft="key"
            autoComplete="off"
            spellCheck={false}
            placeholder="your-256-bit-secret"
            onChange={(event) => setSecret(event.target.value)}
            suffix={
              <button
                type="button"
                onClick={() => setReveal((value) => !value)}
                aria-label={reveal ? 'Hide the secret' : 'Show the secret'}
                className="rounded p-1 text-fg-subtle transition-colors duration-fast hover:text-fg"
              >
                <Icon name={reveal ? 'eye-off' : 'eye'} size={18} />
              </button>
            }
          />
        </Field>

        <Button
          iconLeft="shield"
          disabled={check.busy || secret === '' || jwt === null}
          onClick={() => void verify()}
        >
          {check.busy ? 'Checking…' : 'Check the signature'}
        </Button>

        {/* A refusal — a public-key algorithm, a token that cannot be split, an
            empty secret. Different from a signature that simply does not match. */}
        {check.error ? <Problem message={check.error} /> : null}

        {check.phase === 'done' && check.result === false ? (
          <Problem message="The signature does not match this secret. Either the secret is wrong, or the token was not signed by whoever you believe signed it — and in that case nothing it claims can be trusted." />
        ) : null}

        {verified ? (
          <p className="flex gap-1.5 text-sm text-success-fg">
            <Icon name="check-circle" size={16} label="Verified" className="mt-0.5 shrink-0" />
            <span>
              Checked against the secret you entered. This result is discarded the moment either the
              token or the secret changes, so it can never describe something else.
            </span>
          </p>
        ) : null}
      </section>
    </ToolWorkspace>
  );
}
