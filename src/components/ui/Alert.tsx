/**
 * Alert — an inline message about the state of the thing the user is working on.
 *
 * ── Three channels, never colour alone ──────────────────────────────────────
 * Every alert carries a glyph, a tint, and (optionally) a title. The glyph gets
 * a real `label` naming the severity — "Error", "Warning", "Success",
 * "Information" — so the severity survives into the accessibility tree instead
 * of living only in the tint. That does mean a screen reader announces
 * "Error" before a title that may also start with "Error"; a small duplication
 * is a better trade than a severity that only exists as a colour.
 *
 * ── Why there is no `onDismiss` ─────────────────────────────────────────────
 * A dismissible alert needs an event handler, and a handler cannot cross the
 * server/client boundary: a Server Component may not attach `onClick` to a DOM
 * node, and passing a plain function as a prop into a Client Component is a
 * hard error. An `onDismiss` prop here would therefore *work* when the alert is
 * used from a Client Component and *throw* when used from a page — the same API
 * behaving differently by call site, which is the worst kind of API.
 *
 * So `Alert` stays a Server Component and owns no dismissal. Where dismissal is
 * genuinely needed, the consumer owns it:
 *
 *   'use client';
 *   const [shown, setShown] = useState(true);
 *   return shown ? (
 *     <div className="relative">
 *       <Alert variant="warning" title="Large file">…</Alert>
 *       <button type="button" onClick={() => setShown(false)} aria-label="Dismiss">…</button>
 *     </div>
 *   ) : null;
 *
 * That keeps the common case (a server-rendered validation or privacy notice)
 * at zero client JavaScript.
 *
 * ── role="alert" vs role="status" ───────────────────────────────────────────
 * `danger` uses `role="alert"`: assertive, interrupts whatever the screen reader
 * is saying, because a failed operation invalidates what the user was about to
 * do. Everything else uses `role="status"`: polite, queued until the current
 * utterance finishes, because "saved" and "here is a tip" are not worth talking
 * over the user.
 *
 * Honest caveat: a live region only announces content *inserted after* it
 * exists. An alert present on first paint is not announced by either role — the
 * roles pay off when a client component reveals the alert later, which is the
 * case that matters. The roles are still correct markup for both.
 */
import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cn } from '@/lib/cn';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const variantClass: Record<AlertVariant, string> = {
  info: 'border-info-border bg-info-subtle text-info-fg',
  success: 'border-success-border bg-success-subtle text-success-fg',
  warning: 'border-warning-border bg-warning-subtle text-warning-fg',
  danger: 'border-danger-border bg-danger-subtle text-danger-fg',
};

const defaultIcon: Record<AlertVariant, IconName> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'alert-circle',
};

/** The accessible name of the glyph. Stays tied to the variant even when `icon` is overridden. */
const severityLabel: Record<AlertVariant, string> = {
  info: 'Information',
  success: 'Success',
  warning: 'Warning',
  danger: 'Error',
};

export interface AlertProps {
  variant: AlertVariant;
  /** One short line. Rendered as a `<p>`, not a heading — see note below. */
  title?: string;
  /** A custom glyph. The severity label is unaffected. */
  icon?: IconName;
  children?: ReactNode;
  className?: string;
}

export function Alert({ variant, title, icon, children, className }: AlertProps) {
  return (
    <div
      // `alert` is assertive, `status` is polite. See the header comment.
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border p-3 text-sm', variantClass[variant], className)}
    >
      <Icon
        name={icon ?? defaultIcon[variant]}
        size={18}
        label={severityLabel[variant]}
        className="mt-0.5 shrink-0"
      />
      {/* `min-w-0` so a long unbroken token in the body wraps instead of
          stretching the alert past its container. */}
      <div className="min-w-0 flex-1">
        {/* Deliberately a `<p>`, not an `<h*>`: an alert can appear anywhere on
            a page, so choosing a heading level here would corrupt the document
            outline. The role plus the glyph already classify the region. */}
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn('min-w-0', title && 'mt-1')}>{children}</div> : null}
      </div>
    </div>
  );
}
