'use client';

import { useMemo, useState } from 'react';

import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Textarea } from '@/components/ui/Textarea';
import { toolTracker } from '@/lib/analytics';
import { analyzeText, type TextStats } from '@/lib/tools/text/counter';

/**
 * ============================================================================
 * WORD COUNTER
 * ============================================================================
 * Counts as you type. `analyzeText` is a handful of linear passes, so recomputing
 * on every keystroke is cheaper than the re-render it triggers — there is no
 * debounce, and a "Count" button would be a step that exists only to make the
 * work visible.
 *
 * ── Why no processing_started / processing_completed here ──────────────────
 * Those two events answer "did the work finish, and how long did it take" for a
 * job the user waited on. A tool that recomputes per keystroke would fire them
 * hundreds of times per visit and drown every real measurement in the dashboard.
 * So this tool reports `tool_started` on the first character and `copy_clicked`
 * when the summary is taken away, and nothing in between.
 *
 * ── Why the statistics are not a live region ───────────────────────────────
 * An `aria-live` region here would announce a new set of numbers on every
 * keystroke, which makes the tool unusable with a screen reader rather than
 * accessible to one. The counts are ordinary content in a labelled region
 * instead: a `<dl>` a user can navigate to after typing, when the answer is
 * wanted. The one place an announcement is right is the copy confirmation, and
 * `CopyButton` already owns that.
 *
 * ── Why every number is formatted with an explicit locale ──────────────────
 * `toLocaleString()` with no argument uses the server's locale during SSR and the
 * browser's on hydration. Those disagree, and React reports the difference as a
 * hydration error on a page that looked fine. Pinning `en-US` makes the two
 * renders identical.
 * ============================================================================
 */

const SLUG = 'word-counter';
const INPUT_ID = 'word-counter-text';

/** See the header note on locales. */
function count(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Whole seconds up to a minute, then minutes and seconds. Rounding a 40-second
 * read up to "1 min" overstates it by half, and "0.67 min" is not how anyone
 * thinks about a reading time.
 */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sec`;
}

/** The block the Copy button puts on the clipboard. Built on click, not on type. */
function summaryText(stats: TextStats): string {
  const lines = [
    `Words: ${count(stats.words)}`,
    `Characters: ${count(stats.characters)}`,
    `Characters without spaces: ${count(stats.charactersNoSpaces)}`,
    `Sentences: ${count(stats.sentences)}`,
    `Paragraphs: ${count(stats.paragraphs)}`,
    `Lines: ${count(stats.lines)}`,
    `Unique words: ${count(stats.uniqueWords)}`,
    `Reading time: ${duration(stats.readingTimeSeconds)}`,
    `Speaking time: ${duration(stats.speakingTimeSeconds)}`,
  ];
  if (stats.keywordDensity.length > 0) {
    lines.push('', 'Most used words:');
    for (const row of stats.keywordDensity) {
      lines.push(`  ${row.word} — ${count(row.count)} (${row.percent.toFixed(2)}%)`);
    }
  }
  return lines.join('\n');
}

/** One of the four numbers a person came for. */
function Headline({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2.5">
      <p className="tabular text-xl font-semibold text-fg">{count(value)}</p>
      <p className="mt-0.5 text-xs text-fg-muted">{label}</p>
    </div>
  );
}

/** A row of the detail list. `hint` explains a term rather than decorating it. */
function Detail({ term, value, hint }: { term: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border-subtle py-1.5">
      <dt className="text-sm text-fg-muted">
        {term}
        {hint ? <span className="ml-1 text-2xs text-fg-subtle">{hint}</span> : null}
      </dt>
      <dd className="tabular shrink-0 text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

/** The ten most repeated words, or the sentence explaining why there are none. */
function Keywords({ stats }: { stats: TextStats }) {
  if (stats.keywordDensity.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        Once there are a few words to count, the ten you repeat most will appear here. Grammar words
        such as <em>the</em> and <em>which</em> are left out, and words shorter than three letters
        are not counted.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">
        The ten most frequent words of three letters or more, with counts and share of the total
      </caption>
      <thead>
        <tr className="border-b border-border text-left text-xs text-fg-muted">
          <th scope="col" className="py-1.5 font-medium">
            Word
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Uses
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {stats.keywordDensity.map((row) => (
          <tr key={row.word} className="border-b border-border-subtle">
            <td className="max-w-0 truncate py-1.5 pr-3 text-fg">{row.word}</td>
            <td className="tabular py-1.5 text-right text-fg">{count(row.count)}</td>
            <td className="tabular py-1.5 text-right text-fg-muted">{row.percent.toFixed(2)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WordCounterTool() {
  const [text, setText] = useState('');
  const markStarted = useToolStarted(SLUG);
  const stats = useMemo(() => analyzeText(text), [text]);
  const empty = text === '';

  return (
    <ToolWorkspace label="Word counter">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={INPUT_ID} className="text-sm font-medium text-fg">
            Your text
          </label>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              iconLeft="trash"
              disabled={empty}
              onClick={() => setText('')}
            >
              Clear
            </Button>
            <CopyButton
              value={() => summaryText(stats)}
              label="Copy counts"
              copiedLabel="Counts copied"
              size="sm"
              onCopied={() => toolTracker(SLUG).copied('stats')}
            />
          </div>
        </div>

        <Textarea
          id={INPUT_ID}
          value={text}
          rows={10}
          placeholder="Paste or type your text. Counting happens as you go — nothing is uploaded."
          onChange={(event) => {
            setText(event.target.value);
            markStarted();
          }}
        />
      </div>
      {/* Four cards, then the rest. A person who wanted a word count has their
          answer without reading further; the list is there for the ones who
          came for reading time or a repeated word. */}
      <section aria-labelledby="word-counter-totals" className="space-y-3">
        <h2 id="word-counter-totals" className="text-sm font-medium text-fg">
          Totals
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Headline label="Words" value={stats.words} />
          <Headline label="Characters" value={stats.characters} />
          <Headline label="Sentences" value={stats.sentences} />
          <Headline label="Paragraphs" value={stats.paragraphs} />
        </div>
      </section>

      <section aria-labelledby="word-counter-detail" className="space-y-1">
        <h2 id="word-counter-detail" className="text-sm font-medium text-fg">
          Detail
        </h2>
        <dl>
          <Detail term="Characters without spaces" value={count(stats.charactersNoSpaces)} />
          <Detail
            term="Characters typed"
            hint="counts an emoji as one"
            value={count(stats.graphemes)}
          />
          <Detail term="Lines" value={count(stats.lines)} />
          <Detail term="Unique words" value={count(stats.uniqueWords)} />
          <Detail
            term="Longest word"
            value={stats.longestWord === '' ? '—' : stats.longestWord}
          />
          <Detail term="Average word length" value={`${stats.avgWordLength.toFixed(1)} letters`} />
          <Detail
            term="Average sentence length"
            value={`${stats.avgSentenceLength.toFixed(1)} words`}
          />
          <Detail
            term="Reading time"
            hint="at 238 wpm"
            value={duration(stats.readingTimeSeconds)}
          />
          <Detail
            term="Speaking time"
            hint="at 140 wpm"
            value={duration(stats.speakingTimeSeconds)}
          />
        </dl>
      </section>

      <section aria-labelledby="word-counter-keywords" className="space-y-2">
        <h2 id="word-counter-keywords" className="text-sm font-medium text-fg">
          Most used words
        </h2>
        <Keywords stats={stats} />
      </section>
    </ToolWorkspace>
  );
}
