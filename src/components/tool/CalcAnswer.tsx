'use client';

/**
 * The three pieces every calculator result is made of: the answer, the
 * supporting figures, and the working.
 *
 * These started as private components inside the percentage calculator and were
 * lifted out when the second calculator needed the same three shapes. Sharing
 * them is not only shorter: it means the answer to "what is 15% of 240" and the
 * answer to "how old is someone born in 1996" are the same size, in the same
 * place, with the copy button in the same corner. A calculator family that
 * looked hand-built per page would read as five different products.
 *
 * `'use client'` is required rather than incidental: every one of these attaches
 * an `onCopied` handler, and a function prop cannot cross the server boundary.
 *
 * Deliberately not included here: anything mode-specific. A tool that needs a
 * bespoke table (the share breakdown, an amortisation schedule) keeps that in
 * its own file, because the moment this file grows a `variant` prop per tool it
 * has stopped being a shared shape.
 */
import type { ReactNode } from 'react';

import { CopyButton } from '@/components/ui/CopyButton';
import { toolTracker } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import type { Step } from '@/lib/tools/calc/round';

/** One supporting figure: a short term and an already-formatted value. */
export interface Fact {
  term: string;
  value: string;
  /** A qualifier such as "(nearest whole day)". Rendered smaller, under the value. */
  note?: string;
}

export interface AnswerCardProps {
  /** The answer, set large. Already formatted — this component never rounds. */
  headline: string;
  /** One sentence saying what the headline is a measurement of. */
  sentence?: string;
  /** Clipboard contents. Defaults to `headline`. */
  copyValue?: string;
  slug: string;
  /** Analytics label for the copy event. */
  copyTarget?: string;
  /** Chips, a countdown, a caveat — anything belonging inside the card. */
  children?: ReactNode;
  className?: string;
}

/**
 * The headline answer.
 *
 * The copy button sits in the card rather than above it because the thing being
 * copied is the thing next to it, and it is `items-end` so that a two-line
 * headline pushes the button down with it instead of leaving it stranded at the
 * top of a tall row.
 */
export function AnswerCard({
  headline,
  sentence,
  copyValue,
  slug,
  copyTarget = 'answer',
  children,
  className,
}: AnswerCardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface p-4 shadow-xs', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <p className="tabular min-w-0 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          {headline}
        </p>
        <CopyButton
          value={copyValue ?? headline}
          label="Copy answer"
          copiedLabel="Copied"
          onCopied={() => toolTracker(slug).copied(copyTarget)}
        />
      </div>
      {sentence ? <p className="mt-2 text-sm text-fg-muted">{sentence}</p> : null}
      {children}
    </div>
  );
}

/**
 * Supporting figures as a definition list.
 *
 * A `dl` rather than a table: these are unrelated labelled values, not rows of a
 * dataset, and a screen reader announces "term, definition" pairs without the
 * user having to enter table navigation mode.
 */
export function FactGrid({
  facts,
  columns = 2,
  className,
}: {
  facts: Fact[];
  columns?: 2 | 3;
  className?: string;
}) {
  if (facts.length === 0) return null;

  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-2',
        columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2',
        className,
      )}
    >
      {facts.map((fact) => (
        <div key={fact.term} className="rounded border border-border-subtle bg-surface px-3 py-2">
          <dt className="text-2xs text-fg-muted">{fact.term}</dt>
          <dd className="tabular mt-0.5 text-sm font-medium text-fg">
            {fact.value}
            {fact.note ? (
              <span className="ml-1.5 text-2xs font-normal text-fg-subtle">{fact.note}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The shown working: the formula with the user's own numbers in it, then every
 * intermediate value in order.
 *
 * A real `<table>`, because that is what it is — but the header row is visually
 * hidden. On screen the two columns are self-evident; without a header row a
 * screen reader has nothing to announce against each cell.
 */
export function ShownWorking({
  formula,
  steps,
  slug,
  className,
}: {
  formula: string;
  steps: Step[];
  slug: string;
  className?: string;
}) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface-sunken p-3 sm:p-4', className)}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words font-mono text-xs text-fg">{formula}</p>
        <CopyButton
          value={formula}
          size="icon"
          variant="ghost"
          label="Copy the formula"
          onCopied={() => toolTracker(slug).copied('formula')}
        />
      </div>

      <table className="mt-3 w-full border-collapse text-xs">
        <caption className="sr-only">Every value used to reach the answer, in order</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, position) => (
            <tr key={`${position}-${step.label}`} className="border-t border-border-subtle">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg-muted">
                {step.label}
              </th>
              <td className="tabular py-1.5 text-right font-medium text-fg">{step.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
