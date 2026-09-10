'use client';

import { useMemo, useState } from 'react';

import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { dedupeLines, sortLines, type SortOrder } from '@/lib/tools/text/lines';

/**
 * ============================================================================
 * REMOVE DUPLICATE LINES
 * ============================================================================
 * Deduplication is always on — it is the tool. Everything else is a decision
 * about what "the same line" means, which is where this job actually goes wrong.
 *
 * ── Why dedupe runs before sort, and never the other way round ──────────────
 * The FAQ promises that "deduplication on its own leaves every surviving line
 * exactly where it was". Sorting first would destroy the original order before
 * `keep: 'first' | 'last'` could mean anything: "keep the last copy" is a
 * statement about the list as pasted. So `dedupeLines` runs on the raw text and
 * `sortLines` only rearranges what survived.
 *
 * ── Why `removeEmpty` is passed to the dedupe step only ────────────────────
 * Both functions accept it, and setting it on both would be harmless but
 * dishonest about the count: `removedCount` comes from the dedupe step, so the
 * blanks have to be dropped there to appear in the total the copy promises.
 *
 * ── Why the removed count is not an `aria-live` region ─────────────────────
 * It changes on every keystroke, so announcing it would talk over the user as
 * they type. It is plain text under the output, where a screen-reader user can
 * read it once the paste is done — the same reasoning as the word counter.
 *
 * ── Why "keep" is a select rather than two switches ────────────────────────
 * First and last are mutually exclusive, and two switches would let a user set a
 * state the tool cannot honour. A select cannot express the impossible.
 * ============================================================================
 */

const SLUG = 'remove-duplicate-lines';
const INPUT_ID = 'dedupe-input';
const OUTPUT_ID = 'dedupe-output';
const KEEP_ID = 'dedupe-keep';
const SORT_ID = 'dedupe-sort';

/** `'none'` is the default: dedupe alone must not reorder anything. */
type SortChoice = SortOrder | 'none';

const SORT_LABELS: ReadonlyArray<{ value: SortChoice; label: string }> = [
  { value: 'none', label: 'Leave the order alone' },
  { value: 'asc', label: 'A → Z' },
  { value: 'desc', label: 'Z → A' },
  { value: 'natural', label: 'Natural (item2 before item10)' },
  { value: 'length-asc', label: 'Shortest line first' },
  { value: 'length-desc', label: 'Longest line first' },
  { value: 'reverse', label: 'Reverse the current order' },
  { value: 'shuffle', label: 'Shuffle' },
];

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/**
 * One switch with its own explanation. The `<Switch>` carries the same string as
 * the visible text, which is the primitive's contract — a switch whose accessible
 * name differs from the words beside it is a bug a screen reader cannot see past.
 * The hint is not wired to `aria-describedby` because these sentences describe
 * the effect rather than a constraint, and reading three of them out before the
 * user can reach the fourth control is worse than leaving them to be read.
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
    <div className="flex items-start justify-between gap-4 border-b border-border-subtle py-2.5 last:border-b-0">
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        <span className="mt-0.5 block text-xs text-fg-muted">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} label={label} className="mt-0.5" />
    </div>
  );
}

export function RemoveDuplicateLinesTool() {
  const [text, setText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [trimBeforeCompare, setTrimBeforeCompare] = useState(false);
  const [removeEmpty, setRemoveEmpty] = useState(false);
  const [keep, setKeep] = useState<'first' | 'last'>('first');
  const [sort, setSort] = useState<SortChoice>('none');
  const markStarted = useToolStarted(SLUG);

  const outcome = useMemo(() => {
    const deduped = dedupeLines(text, { caseSensitive, trimBeforeCompare, keep, removeEmpty });
    const result =
      sort === 'none'
        ? deduped.result
        : sortLines(deduped.result, { order: sort, caseSensitive });
    return { ...deduped, result };
  }, [text, caseSensitive, trimBeforeCompare, keep, removeEmpty, sort]);

  return (
    <ToolWorkspace label="Remove duplicate lines">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={INPUT_ID} className="text-sm font-medium text-fg">
            Your list
          </label>
          <Button
            variant="ghost"
            size="sm"
            iconLeft="trash"
            disabled={text === ''}
            onClick={() => setText('')}
          >
            Clear
          </Button>
        </div>

        <Textarea
          id={INPUT_ID}
          value={text}
          rows={10}
          monospace
          placeholder={'One entry per line.\nPaste as many as you like — nothing is uploaded.'}
          onChange={(event) => {
            setText(event.target.value);
            markStarted();
          }}
        />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-fg">What counts as the same line</legend>

        <div className="space-y-1 rounded-lg border border-border-subtle bg-surface-sunken px-3 py-1">
          <Option
            label="Case matters"
            hint="Off, and Apple matches apple."
            checked={caseSensitive}
            onChange={setCaseSensitive}
          />
          <Option
            label="Ignore spaces at the ends"
            hint="Compares trimmed; the kept line keeps its own spacing."
            checked={trimBeforeCompare}
            onChange={setTrimBeforeCompare}
          />
          <Option
            label="Drop blank lines"
            hint="Counted in the removed total along with the duplicates."
            checked={removeEmpty}
            onChange={setRemoveEmpty}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Copy to keep" htmlFor={KEEP_ID} hint="Which one of a repeated line survives.">
            <Select
              id={KEEP_ID}
              value={keep}
              onChange={(event) => setKeep(event.target.value === 'last' ? 'last' : 'first')}
            >
              <option value="first">The first copy</option>
              <option value="last">The last copy</option>
            </Select>
          </Field>

          <Field label="Order" htmlFor={SORT_ID} hint="Applied after the duplicates are gone.">
            <Select
              id={SORT_ID}
              value={sort}
              onChange={(event) => setSort(event.target.value as SortChoice)}
            >
              {SORT_LABELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      <TextOutput
        slug={SLUG}
        id={OUTPUT_ID}
        label="Result"
        value={outcome.result}
        rows={10}
        monospace
        placeholder="The de-duplicated list appears here."
        downloadName="unique-lines.txt"
        footer={
          text === ''
            ? 'Paste a list above to see how many lines repeat.'
            : `${plural(outcome.removedCount, 'line removed', 'lines removed')} · ${plural(
                outcome.uniqueCount,
                'line remains',
                'lines remain',
              )}`
        }
      />
    </ToolWorkspace>
  );
}
