'use client';

/**
 * ============================================================================
 * LOREM IPSUM GENERATOR
 * ============================================================================
 * Placeholder text for a layout, in the amount and the shape you asked for.
 *
 * ── Why the first render is seeded and the button is not ──────────────────
 * Without a seed the engine draws from `crypto`, which means the server and the
 * browser would generate different text and React would report a hydration
 * mismatch on the one element the page exists to show. So the first render uses
 * a fixed seed — the page arrives with real text on it, identical on both sides
 * — and "Generate again" swaps in a random one. After that first paint the
 * component is client-side and free to be random.
 *
 * ── Why the classic opening is optional and off ───────────────────────────
 * "Lorem ipsum dolor sit amet" is instantly recognisable as filler, which is
 * exactly right when you are showing a client a layout and exactly wrong when
 * you are testing how a paragraph of ordinary prose wraps. Both are real uses,
 * so it is a switch.
 *
 * ── Why HTML output is a switch rather than a separate tool ───────────────
 * Wrapping paragraphs in `<p>` tags is the one transformation everyone does by
 * hand after copying, and it is one line in the engine.
 * ============================================================================
 */
import { useMemo, useState } from 'react';

import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { analyzeText } from '@/lib/tools/text/counter';
import { generateLorem, type LoremUnit } from '@/lib/tools/text/lorem';

const SLUG = 'lorem-ipsum-generator';

/** Fixed for the first paint, so the server and the browser agree. See the header. */
const FIRST_SEED = 20260910;

const UNIT_LABELS: Record<LoremUnit, string> = {
  paragraphs: 'Paragraphs',
  sentences: 'Sentences',
  words: 'Words',
};

export function LoremIpsumTool() {
  const [unit, setUnit] = useState<LoremUnit>('paragraphs');
  const [count, setCount] = useState('3');
  const [startWithLorem, setStartWithLorem] = useState(false);
  const [html, setHtml] = useState(false);
  const [seed, setSeed] = useState(FIRST_SEED);

  const markStarted = useToolStarted(SLUG);

  const parsed = Number.parseInt(count.trim(), 10);
  const result = useMemo(
    () =>
      generateLorem({
        unit,
        count: Number.isNaN(parsed) ? 0 : parsed,
        startWithLorem,
        html,
        seed,
      }),
    [html, parsed, seed, startWithLorem, unit],
  );

  const text = result.ok ? result.text : '';
  const words = result.ok ? analyzeText(text).words : 0;

  return (
    <ToolWorkspace
      label="Lorem ipsum generator"
      // An empty box while somebody is still typing a number is not an error.
      error={!result.ok && count.trim() !== '' ? result.error : null}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="How much" htmlFor="lorem-count" hint="Between 1 and 500.">
          <div className="flex gap-2">
            <Input
              id="lorem-count"
              inputMode="numeric"
              value={count}
              onChange={(event) => {
                markStarted();
                setCount(event.target.value);
              }}
              className="min-w-0 flex-1"
            />
            <Select
              value={unit}
              aria-label="Unit"
              onChange={(event) => setUnit(event.target.value as LoremUnit)}
              className="w-40 shrink-0"
            >
              {(Object.keys(UNIT_LABELS) as LoremUnit[]).map((id) => (
                <option key={id} value={id}>
                  {UNIT_LABELS[id]}
                </option>
              ))}
            </Select>
          </div>
        </Field>

        <div className="flex flex-col justify-end gap-3">
          <label className="flex items-start gap-3 text-sm">
            <Switch
              checked={startWithLorem}
              label="Start with “Lorem ipsum dolor sit amet”"
              onCheckedChange={setStartWithLorem}
            />
            <span className="text-fg-muted">
              <span className="block font-medium text-fg">Start with the classic opening</span>
              Recognisable as filler at a glance — right for a client mock-up, wrong for testing
              how ordinary prose wraps.
            </span>
          </label>

          {unit === 'paragraphs' ? (
            <label className="flex items-start gap-3 text-sm">
              <Switch checked={html} label="Wrap in HTML paragraph tags" onCheckedChange={setHtml} />
              <span className="text-fg-muted">
                <span className="block font-medium text-fg">Wrap in &lt;p&gt; tags</span>
                Ready to paste straight into a template.
              </span>
            </label>
          ) : null}
        </div>
      </div>

      <div>
        <Button
          variant="secondary"
          iconLeft="refresh"
          onClick={() => {
            markStarted();
            // Random from here on: the hydration-safe first paint is behind us.
            setSeed(Math.floor(Math.random() * 2 ** 31));
          }}
        >
          Generate again
        </Button>
      </div>

      {result.ok ? (
        <TextOutput
          slug={SLUG}
          id="lorem-output"
          label="Placeholder text"
          value={text}
          rows={14}
          monospace={html}
          copyTarget="lorem"
          downloadName="lorem-ipsum.txt"
          footer={`${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}, ${text.length.toLocaleString()} characters.`}
        />
      ) : null}
    </ToolWorkspace>
  );
}
