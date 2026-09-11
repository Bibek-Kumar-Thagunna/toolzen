'use client';

/**
 * ============================================================================
 * URL ENCODER AND DECODER
 * ============================================================================
 * Three jobs that look like one until you get the second one wrong.
 *
 * ── Encoding a component is not encoding a URL ────────────────────────────
 * `encodeURIComponent` escapes the punctuation that gives a URL its structure —
 * the slashes, the question mark, the ampersands — because a *value* going
 * inside an address must not be able to invent new structure. `encodeURI`
 * leaves that punctuation alone, because it is escaping the address itself.
 *
 * Using the first on a whole URL produces something that is not a link. Using
 * the second on a value is how a search term containing an `&` silently
 * becomes two query parameters. This tool asks which one you mean, in words,
 * and says what each is for.
 *
 * ── Why `+` for space is a switch and not a default ───────────────────────
 * A form posts a space as `+`; a path segment treats `+` as a literal plus.
 * Both are correct in their own place, so the choice is exposed rather than
 * decided, and it only appears when encoding.
 *
 * ── Why decoding reports warnings instead of failing ──────────────────────
 * Real URLs from real systems are full of half-encoded text: a stray `%` that
 * is not a hex pair, a double-encoded value, bytes that are not valid UTF-8.
 * The engine decodes what it can and describes what looked wrong, because a
 * page that refuses the input tells you nothing about the string you are
 * holding.
 *
 * ── The inspector is the reason to come back ──────────────────────────────
 * Pasting a long tracking URL and seeing every query parameter decoded in a
 * table answers the actual question — "what is in this link" — which "decode
 * this string" only approximates.
 * ============================================================================
 */
import { useMemo, useState } from 'react';

import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import { Tabs, type TabDescriptor } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import {
  decodeUrlComponent,
  encodeFullUrl,
  encodeUrlComponent,
  parseUrl,
} from '@/lib/tools/dev/url';

const SLUG = 'url-encoder';

type Mode = 'encode' | 'decode' | 'inspect';

const TABS: TabDescriptor[] = [
  { id: 'encode', label: 'Encode' },
  { id: 'decode', label: 'Decode' },
  { id: 'inspect', label: 'Inspect a URL' },
];

const SAMPLE = 'https://example.com/search?q=café & bar&page=2#top';

export function UrlEncoderTool() {
  const [mode, setMode] = useState<Mode>('encode');
  const [text, setText] = useState(SAMPLE);
  const [wholeUrl, setWholeUrl] = useState(false);
  const [plusForSpace, setPlusForSpace] = useState(false);

  const markStarted = useToolStarted(SLUG);

  const encoded = useMemo(
    () => (wholeUrl ? encodeFullUrl(text) : encodeUrlComponent(text, { plusForSpace })),
    [plusForSpace, text, wholeUrl],
  );

  const decoded = useMemo(() => decodeUrlComponent(text, { plusForSpace }), [plusForSpace, text]);

  const inspected = useMemo(() => parseUrl(text), [text]);

  return (
    <ToolWorkspace
      label="URL encoder and decoder"
      error={
        mode === 'decode' && !decoded.ok
          ? decoded.error
          : mode === 'inspect' && !inspected.ok
            ? inspected.error
            : null
      }
    >
      <Tabs
        tabs={TABS}
        value={mode}
        onValueChange={(id) => setMode(id as Mode)}
        ariaLabel="What to do with the text"
      >
        <div className="space-y-4">
          <Field
            label={mode === 'inspect' ? 'URL' : 'Text'}
            htmlFor="url-input"
            hint={
              mode === 'inspect'
                ? 'Paste a full address — a tracking link, a redirect, anything with a query string.'
                : undefined
            }
          >
            <Textarea
              id="url-input"
              value={text}
              rows={mode === 'inspect' ? 3 : 5}
              monospace
              onChange={(event) => {
                markStarted();
                setText(event.target.value);
              }}
            />
          </Field>

          {mode !== 'inspect' ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
              {mode === 'encode' ? (
                <label className="flex items-start gap-3 text-sm">
                  <Switch
                    checked={wholeUrl}
                    label="Encode a whole address"
                    onCheckedChange={setWholeUrl}
                  />
                  <span className="text-fg-muted">
                    <span className="block font-medium text-fg">Encode a whole address</span>
                    Leaves <code>:/?#&amp;=</code> alone so the link still works. Turn this off when
                    encoding a value that goes <em>inside</em> a URL.
                  </span>
                </label>
              ) : null}

              {/* Meaningless while encoding a whole address: the structural
                  punctuation is being preserved, and a space is not part of it. */}
              {!(mode === 'encode' && wholeUrl) ? (
                <label className="flex items-start gap-3 text-sm">
                  <Switch
                    checked={plusForSpace}
                    label="Treat + as a space"
                    onCheckedChange={setPlusForSpace}
                  />
                  <span className="text-fg-muted">
                    <span className="block font-medium text-fg">
                      {mode === 'encode' ? 'Write spaces as +' : 'Treat + as a space'}
                    </span>
                    What an HTML form does. Correct in a query string, wrong in a path — there a{' '}
                    <code>+</code> is a literal plus sign.
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      </Tabs>

      {mode === 'encode' ? (
        <TextOutput
          slug={SLUG}
          id="url-encoded"
          label="Encoded"
          value={encoded}
          monospace
          rows={5}
          copyTarget="encoded"
          footer={
            wholeUrl
              ? 'Structural punctuation was preserved, so this is still a usable address.'
              : 'Every reserved character was escaped, so this is safe to drop inside a query string or a path segment.'
          }
        />
      ) : null}

      {mode === 'decode' && decoded.ok ? (
        <>
          <TextOutput
            slug={SLUG}
            id="url-decoded"
            label="Decoded"
            value={decoded.text}
            monospace
            rows={5}
            copyTarget="decoded"
          />
          {decoded.warnings.length > 0 ? (
            // Decoded anyway, and said what looked wrong. A page that refuses
            // the input tells you nothing about the string you are holding.
            <Alert variant="warning" title="Worth a look">
              <ul className="list-inside list-disc space-y-1">
                {decoded.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </>
      ) : null}

      {mode === 'inspect' && inspected.ok ? (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-fg">The parts of this address</p>
            <div className="scrollbar-thin overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-80 border-collapse text-sm">
                <tbody>
                  {(
                    [
                      ['Scheme', inspected.url.protocol.replace(/:$/, '')],
                      ['Host', inspected.url.hostname],
                      ['Port', inspected.url.port === '' ? 'default for the scheme' : inspected.url.port],
                      ['Path', inspected.url.pathname],
                      ['Fragment', inspected.url.hash === '' ? '—' : inspected.url.hash.slice(1)],
                    ] as const
                  ).map(([term, value]) => (
                    <tr key={term} className="border-b border-border-subtle last:border-b-0">
                      <th
                        scope="row"
                        className="w-32 px-3 py-2 text-left font-medium text-fg-muted"
                      >
                        {term}
                      </th>
                      <td className="break-all px-3 py-2 font-mono text-fg">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {inspected.url.params.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-medium text-fg">
                Query parameters ({inspected.url.params.length})
              </p>
              <div className="scrollbar-thin overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-80 border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-sunken text-left">
                      <th scope="col" className="px-3 py-2 font-medium text-fg-muted">
                        Name
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium text-fg-muted">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspected.url.params.map((param, index) => (
                      <tr
                        key={`${param.key}-${index}`}
                        className="border-b border-border-subtle last:border-b-0"
                      >
                        <td className="break-all px-3 py-2 font-mono text-fg">{param.key}</td>
                        <td className="break-all px-3 py-2 text-fg-muted">
                          {param.decoded === '' ? <span className="italic">empty</span> : param.decoded}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">This address has no query parameters.</p>
          )}

          {inspected.warnings.length > 0 ? (
            <Alert variant="warning" title="Worth a look">
              <ul className="list-inside list-disc space-y-1">
                {inspected.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </ToolWorkspace>
  );
}
