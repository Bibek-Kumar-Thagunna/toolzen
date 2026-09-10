'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/components/icons';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { cn } from '@/lib/cn';
import { CASE_LABELS, CASE_MODES, convertCase, type CaseMode } from '@/lib/tools/text/case';

/**
 * ============================================================================
 * CASE CONVERTER
 * ============================================================================
 * Twelve modes, one text box, and a result that updates as the mode changes.
 *
 * ── Why the mode picker is a radio group and not a row of buttons ───────────
 * Twelve buttons is twelve tab stops, and nothing about a pressed button tells a
 * screen reader that the other eleven are alternatives to it. A `<fieldset>` of
 * native radios is one tab stop with arrow-key movement inside it, announces
 * "3 of 12", and needs no `aria-` attributes to say what it is. The cards are
 * `peer-checked:` styling over the real control, so the keyboard model is the
 * browser's rather than one written here.
 *
 * ── Why each card carries an example ───────────────────────────────────────
 * "Sentence case" and "Title Case" are indistinguishable as labels to anyone who
 * has not met the distinction, and the difference between camelCase and
 * PascalCase is one character. `CASE_LABELS` builds every example by running the
 * real converter over one fixed phrase, so a card cannot describe an output the
 * tool does not produce — the label and the behaviour cannot drift apart.
 *
 * ── Why selection does not rely on the accent colour alone ──────────────────
 * §16: the chosen card also carries a check glyph and a heavier border, so the
 * state survives greyscale, low contrast and colour blindness.
 *
 * ── Why there is no Convert button ─────────────────────────────────────────
 * `convertCase` is a single linear pass. Making the user press a button after
 * choosing a mode adds a step that exists only to make work visible, and picking
 * a mode is already the gesture that says "do it". Comparing two cases becomes
 * two clicks with no round trip, which is what the how-to promises.
 * ============================================================================
 */

const SLUG = 'case-converter';
const INPUT_ID = 'case-converter-input';
const OUTPUT_ID = 'case-converter-output';
const GROUP_NAME = 'case-converter-mode';

/** Which modes rewrite prose, for the caveat under the output. */
const PROSE_MODES: ReadonlySet<CaseMode> = new Set<CaseMode>([
  'lower',
  'upper',
  'title',
  'sentence',
  'alternating',
  'inverse',
]);

/** One selectable case, with output the converter actually produces. */
function ModeCard({
  mode,
  checked,
  onSelect,
}: {
  mode: CaseMode;
  checked: boolean;
  onSelect: (mode: CaseMode) => void;
}) {
  const { label, example } = CASE_LABELS[mode];

  return (
    <label className="cursor-pointer">
      {/* The real radio: `sr-only` keeps it in the accessibility tree and in the
          tab order, unlike `hidden` or `display:none`, which would remove it
          from both and take the arrow keys with it. */}
      <input
        type="radio"
        name={GROUP_NAME}
        value={mode}
        checked={checked}
        onChange={() => onSelect(mode)}
        className="peer sr-only"
      />
      <span
        className={cn(
          'flex h-full items-start justify-between gap-2 rounded-lg border px-3 py-2',
          'transition-colors duration-fast ease-out',
          // The visible focus ring belongs to the card, because the control that
          // owns focus is `sr-only` and invisible by design.
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
          'peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas',
          checked
            ? 'border-accent-border bg-accent-subtle'
            : 'border-border-subtle bg-surface hover:border-border-strong',
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{label}</span>
          <span className="mt-0.5 block truncate font-mono text-2xs text-fg-muted">{example}</span>
        </span>
        {checked ? (
          <Icon name="check" size={16} className="mt-0.5 shrink-0 text-accent-fg" />
        ) : null}
      </span>
    </label>
  );
}

export function CaseConverterTool() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<CaseMode>('title');
  const markStarted = useToolStarted(SLUG);

  const output = useMemo(() => convertCase(text, mode), [text, mode]);

  return (
    <ToolWorkspace label="Case converter">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={INPUT_ID} className="text-sm font-medium text-fg">
            Your text
          </label>
          <div className="flex items-center gap-2">
            {output === '' ? null : (
              <Button
                variant="ghost"
                size="sm"
                iconLeft="corner-down-left"
                onClick={() => setText(output)}
              >
                Use result as input
              </Button>
            )}
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
        </div>

        <Textarea
          id={INPUT_ID}
          value={text}
          rows={6}
          placeholder="Paste a heading, a list or a variable name."
          onChange={(event) => {
            setText(event.target.value);
            markStarted();
          }}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-fg">Case</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CASE_MODES.map((option) => (
            <ModeCard
              key={option}
              mode={option}
              checked={option === mode}
              onSelect={(next) => {
                setMode(next);
                markStarted();
              }}
            />
          ))}
        </div>
      </fieldset>

      <TextOutput
        slug={SLUG}
        id={OUTPUT_ID}
        label={`Result — ${CASE_LABELS[mode].label}`}
        value={output}
        rows={6}
        monospace={!PROSE_MODES.has(mode)}
        placeholder="Your converted text appears here."
        downloadName="converted-text.txt"
        footer={
          PROSE_MODES.has(mode)
            ? 'Punctuation, spacing and line endings are returned exactly as you typed them.'
            : 'Identifier cases drop anything that is not a letter or a digit, and join every line into one name.'
        }
      />
    </ToolWorkspace>
  );
}
