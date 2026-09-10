'use client';

import { useMemo, useState } from 'react';

import { Icon } from '@/components/icons';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { slugifyPreview } from '@/lib/tools/text/slug';

/**
 * ============================================================================
 * SLUG GENERATOR
 * ============================================================================
 * A title in, a URL-safe slug out, and an honest account of what changed on the
 * way.
 *
 * ── Why the input is a single line and not a textarea ──────────────────────
 * The input is a headline. A textarea invites a paragraph, and a paragraph makes
 * a slug nobody would put in a URL. The one-line field says what the tool is for
 * before any help text has to.
 *
 * ── Why the warnings are plain text and not an Alert ───────────────────────
 * `Alert` is a live region — `role="status"` at its politest. This tool
 * recomputes on every keystroke, so an Alert here would queue an announcement
 * per character and bury the one message that mattered. The warnings are listed
 * under the result with the same warning glyph and colour, where they are seen
 * without being shouted. Nothing is hidden: `slugifyPreview` returns every
 * warning it has and all of them are rendered.
 *
 * ── Why "no limit" is the empty field rather than 0 ────────────────────────
 * `slugifyPreview` treats 0, negative and non-finite as "no limit", so an empty
 * box is already safe. The state is kept as the raw string so the field can be
 * genuinely empty — a numeric state would force a 0 into the box the moment the
 * user cleared it, which reads as a limit of zero characters.
 * ============================================================================
 */

const SLUG = 'slug-generator';
const INPUT_ID = 'slug-title';
const OUTPUT_ID = 'slug-result';
const SEPARATOR_ID = 'slug-separator';
const LENGTH_ID = 'slug-max-length';

/** The three choices the how-to promises, mapped to what the engine takes. */
const SEPARATORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '-', label: 'Hyphen  ( - )' },
  { value: '_', label: 'Underscore  ( _ )' },
  { value: '', label: 'Nothing at all' },
];

function Toggle({
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

export function SlugGeneratorTool() {
  const [title, setTitle] = useState('');
  const [separator, setSeparator] = useState('-');
  const [maxLength, setMaxLength] = useState('');
  const [lowercase, setLowercase] = useState(true);
  const [stripStopWords, setStripStopWords] = useState(false);
  const [transliterate, setTransliterate] = useState(true);
  const markStarted = useToolStarted(SLUG);

  const preview = useMemo(
    () =>
      slugifyPreview(title, {
        separator,
        lowercase,
        stripStopWords,
        transliterate,
        maxLength: Number.parseInt(maxLength, 10),
      }),
    [title, separator, lowercase, stripStopWords, transliterate, maxLength],
  );

  return (
    <ToolWorkspace label="Slug generator">
      <Field
        label="Title"
        htmlFor={INPUT_ID}
        hint="Any language. Accents, Cyrillic and Greek are handled."
      >
        <Input
          id={INPUT_ID}
          value={title}
          inputSize="lg"
          placeholder="How to Cool a Café in Zürich"
          onChange={(event) => {
            setTitle(event.target.value);
            markStarted();
          }}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Separator" htmlFor={SEPARATOR_ID}>
          <Select
            id={SEPARATOR_ID}
            value={separator}
            onChange={(event) => setSeparator(event.target.value)}
          >
            {SEPARATORS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Maximum length"
          htmlFor={LENGTH_ID}
          optional
          hint="Characters. Cut at a word boundary. Leave blank for no limit."
        >
          <Input
            id={LENGTH_ID}
            value={maxLength}
            numeric
            min={0}
            step={1}
            type="number"
            suffix="chars"
            placeholder="No limit"
            onChange={(event) => setMaxLength(event.target.value)}
          />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-fg">Handling</legend>
        <div className="space-y-1 rounded-lg border border-border-subtle bg-surface-sunken px-3 py-1">
          <Toggle
            label="Lowercase everything"
            hint="Off keeps the capitals you typed. Most sites want them gone."
            checked={lowercase}
            onChange={setLowercase}
          />
          <Toggle
            label="Transliterate other alphabets"
            hint="ж becomes zh, β becomes v, ß becomes ss. Off drops what it cannot fold."
            checked={transliterate}
            onChange={setTransliterate}
          />
          <Toggle
            label="Remove filler words"
            hint="Drops the, of, and similar — unless that would leave nothing."
            checked={stripStopWords}
            onChange={setStripStopWords}
          />
        </div>
      </fieldset>

      <TextOutput
        slug={SLUG}
        id={OUTPUT_ID}
        label="Slug"
        value={preview.slug}
        copyTarget="slug"
        rows={2}
        monospace
        placeholder="your-slug-appears-here"
        footer={
          preview.warnings.length > 0 ? (
            <ul className="space-y-1">
              {preview.warnings.map((warning) => (
                <li key={warning} className="flex gap-1.5 text-warning-fg">
                  <Icon name="alert-triangle" size={14} className="mt-0.5 shrink-0" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          ) : (
            `${preview.slug.length} character${preview.slug.length === 1 ? '' : 's'}`
          )
        }
      />
    </ToolWorkspace>
  );
}
