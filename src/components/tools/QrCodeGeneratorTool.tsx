'use client';

import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type HTMLInputTypeAttribute,
} from 'react';

import { Icon, type IconName } from '@/components/icons';
import { TextOutput } from '@/components/tool/TextOutput';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolRun, useToolStarted } from '@/components/tool/useToolRun';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { describedBy, Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { toolTracker } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { downloadBlob, downloadText } from '@/lib/files/download';
import {
  MAX_VERSION,
  MIN_VERSION,
  buildEmailPayload,
  buildEventPayload,
  buildGeoPayload,
  buildSmsPayload,
  buildVCardPayload,
  buildWifiPayload,
  encodeQr,
  qrToPathData,
  qrToSvg,
  type EccLevel,
  type QrMatrix,
} from '@/lib/tools/gen/qr';

/**
 * ============================================================================
 * QR CODE GENERATOR
 * ============================================================================
 * ── Why this one encodes during render ──────────────────────────────────────
 * The password and UUID tools have to wait for an effect, because their output
 * comes from `crypto` or the clock and a server render would produce different
 * bytes. Encoding a QR code is a pure function of the text and three settings,
 * so the server and the browser agree exactly and the page can arrive with the
 * finished symbol already in the HTML. `useDeferredValue` keeps typing smooth:
 * a version 40 symbol means Reed-Solomon over 2,956 codewords and eight mask
 * patterns scored against four penalty rules, which is real work to do between
 * two keystrokes.
 *
 * ── Why the download goes through `useToolRun` and the encode does not ──────
 * The encode is instant, cannot be cancelled, and has nowhere to report to.
 * Producing the file is the step that can genuinely take time — a 4096px PNG is
 * seventeen million pixels — and the one that can fail for reasons outside the
 * page's control. So that is what the run lifecycle describes, which also means
 * a `SecurityError` from `toBlob` reaches the interface as a sentence rather
 * than as an exception message.
 *
 * ── Why an exact pixel size does not blur the modules ───────────────────────
 * A scanner samples module centres, so a module that lands on a fractional pixel
 * is a module with grey edges, and grey edges are the usual reason a small code
 * fails. Naively scaling a 33-module symbol to 512px gives 15.5px modules. The
 * fix is that the quiet zone is a minimum, not a fixed width: the module size is
 * floored to a whole number of pixels and the leftover is spent on a slightly
 * wider light border. The canvas is exactly the size asked for, every module is
 * on whole pixels, and the border stays at or above the four modules the
 * specification requires. No compromise, and nothing to explain away.
 *
 * ── Why nothing is pre-filled ───────────────────────────────────────────────
 * Showing a working code on arrival would demonstrate the tool nicely, and the
 * obvious thing to fill in is this site's own address. The failure mode is
 * somebody printing five hundred flyers carrying a link to us instead of to
 * them. An empty field with a real placeholder costs one moment of explanation
 * and cannot do that.
 *
 * ── Why the symbol is always white behind black ─────────────────────────────
 * Dark modules on a light field is what readers expect, and inverting it works
 * on some and fails on others. So the preview carries its own white background
 * rather than inheriting the page's, which means a code photographed off a dark
 * mode screen still scans. The same two colours are handed to the SVG and drawn
 * into the PNG, so all three are the same picture.
 *
 * ── Why the version bounds are validated here ───────────────────────────────
 * The encoder's own refusals for these two name their arguments — "minVersion
 * must be a whole number from 1 to 40" — which is a sentence about an API, not
 * about a form. A value outside 1 to 40 is therefore never sent: the field is
 * painted invalid, its hint already says the range, and the encoder keeps
 * choosing automatically. The refusals it writes for a person, such as needing a
 * larger version than the ceiling allows, are shown verbatim.
 * ============================================================================
 */

const SLUG = 'qr-code-generator';
const TYPE_ID = 'qr-type';
const ECC_ID = 'qr-ecc';
const SECURITY_ID = 'qr-security';
const MIN_VERSION_ID = 'qr-min-version';
const MAX_VERSION_ID = 'qr-max-version';
const PNG_SIZE_ID = 'qr-png-size';
const RESULT_HEADING_ID = 'qr-result-heading';

/** Dark modules on a light field, the arrangement every reader expects. */
const DARK = '#000000';
const LIGHT = '#ffffff';

/** The quiet zone in modules. Four is the specification's minimum, not a taste. */
const QUIET_MODULES = 4;

const PNG_DEFAULT = 512;
/** 4096² is 67MB of canvas, which is the point where a phone starts refusing. */
const PNG_MAX = 4096;

type PayloadType = 'link' | 'text' | 'wifi' | 'vcard' | 'email' | 'sms' | 'geo' | 'event';
type WifiSecurity = 'WPA' | 'WEP' | 'nopass';
type FieldKind = 'text' | 'multiline' | 'url' | 'email' | 'tel' | 'decimal' | 'datetime' | 'secret';

interface FieldSpec {
  /** Unique across every type, so one record of values holds them all. */
  key: string;
  label: string;
  kind?: FieldKind;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  /** Spans both columns on wider screens. Long values and text areas want this. */
  wide?: boolean;
  maxLength?: number;
  rows?: number;
}

interface PayloadSpec {
  label: string;
  /** One line under the picker saying what a phone will do with it. */
  blurb: string;
  fields: FieldSpec[];
}

/**
 * What each kind of code carries.
 *
 * A table rather than eight hand-written forms: the fields differ, but the
 * label, the hint, the touch target, the error association and the grid
 * behaviour do not, and eight copies of that is eight chances for one of them to
 * be subtly less accessible than its neighbours.
 *
 * Keys are unique across the whole table, so switching type and back does not
 * lose what was typed — someone comparing a vCard against a plain link should
 * not be punished for looking.
 */
const PAYLOADS: Record<PayloadType, PayloadSpec> = {
  link: {
    label: 'Link',
    blurb: 'A camera offers to open the address.',
    fields: [
      {
        key: 'url',
        label: 'Web address',
        kind: 'url',
        placeholder: 'https://example.com/menu',
        wide: true,
      },
    ],
  },
  text: {
    label: 'Plain text',
    blurb: 'A camera shows the text. Nothing opens, which is sometimes the point.',
    fields: [
      {
        key: 'text',
        label: 'Text',
        kind: 'multiline',
        rows: 4,
        wide: true,
        placeholder: 'Table 6 — ask for the set menu',
      },
    ],
  },
  wifi: {
    label: 'Wi-Fi network',
    blurb: 'Scanning offers to join the network without anyone typing the password.',
    fields: [
      {
        key: 'ssid',
        label: 'Network name',
        placeholder: 'Cafe Guest',
        hint: 'Exactly as it appears in the Wi-Fi list, capitals included.',
      },
      { key: 'wifiPassword', label: 'Password', kind: 'secret', optional: true },
    ],
  },
  vcard: {
    label: 'Contact card',
    blurb: 'Scanning offers to save a contact. A vCard 3.0, which is what phones import.',
    fields: [
      { key: 'firstName', label: 'First name', optional: true },
      { key: 'lastName', label: 'Last name', optional: true },
      { key: 'org', label: 'Organisation', optional: true },
      { key: 'jobTitle', label: 'Job title', optional: true },
      { key: 'phone', label: 'Phone', kind: 'tel', optional: true },
      { key: 'email', label: 'Email', kind: 'email', optional: true },
      { key: 'contactUrl', label: 'Website', kind: 'url', optional: true, wide: true },
      { key: 'address', label: 'Address', kind: 'multiline', rows: 2, optional: true, wide: true },
      { key: 'note', label: 'Note', kind: 'multiline', rows: 2, optional: true, wide: true },
    ],
  },
  email: {
    label: 'Email',
    blurb: 'Scanning opens a new message with the address, subject and body filled in.',
    fields: [
      { key: 'mailTo', label: 'To', kind: 'email', placeholder: 'hello@example.com', wide: true },
      { key: 'mailSubject', label: 'Subject', optional: true, wide: true },
      { key: 'mailBody', label: 'Message', kind: 'multiline', rows: 3, optional: true, wide: true },
    ],
  },
  sms: {
    label: 'Text message',
    blurb: 'Scanning opens the messaging app with the number and text ready to send.',
    fields: [
      { key: 'smsPhone', label: 'Phone number', kind: 'tel', placeholder: '+44 20 7946 0958' },
      { key: 'smsMessage', label: 'Message', optional: true },
    ],
  },
  geo: {
    label: 'Location',
    blurb: 'Scanning drops a pin in whichever map app the phone already uses.',
    fields: [
      { key: 'lat', label: 'Latitude', kind: 'decimal', placeholder: '51.5007' },
      { key: 'lon', label: 'Longitude', kind: 'decimal', placeholder: '-0.1246' },
    ],
  },
  event: {
    label: 'Calendar event',
    blurb: 'Scanning offers to add the event to the calendar.',
    fields: [
      { key: 'eventTitle', label: 'Title', placeholder: 'Spring open day', wide: true },
      { key: 'eventStart', label: 'Starts', kind: 'datetime' },
      {
        key: 'eventEnd',
        label: 'Ends',
        kind: 'datetime',
        optional: true,
        hint: 'Left empty, the event runs for an hour.',
      },
      { key: 'eventLocation', label: 'Place', optional: true, wide: true },
      {
        key: 'eventDescription',
        label: 'Description',
        kind: 'multiline',
        rows: 2,
        optional: true,
        wide: true,
      },
    ],
  },
};

const TYPE_ORDER: PayloadType[] = ['link', 'text', 'wifi', 'vcard', 'email', 'sms', 'geo', 'event'];

/**
 * The trade-off in each level, in the words the page uses everywhere else.
 *
 * More recovery means more codewords, which can push the version up and shrink
 * every module in the same printed area — so the honest framing is a cost rather
 * than a quality dial, and M is the default because it survives ordinary
 * handling without inflating the symbol.
 */
const ECC_LABELS: Record<EccLevel, string> = {
  L: 'L — about 7% recoverable, smallest code',
  M: 'M — about 15% recoverable, recommended',
  Q: 'Q — about 25% recoverable',
  H: 'H — about 30% recoverable, largest code',
};

const ECC_ORDER: EccLevel[] = ['L', 'M', 'Q', 'H'];

const MODE_LABELS: Record<QrMatrix['mode'], string> = {
  numeric: 'Numeric — digits only, the densest packing',
  alphanumeric: 'Alphanumeric — capitals, digits and a few symbols',
  byte: 'Byte — anything else, eight bits per byte',
};

type Values = Record<string, string>;

/**
 * Three states, not two.
 *
 * "Nothing entered yet" is not an error, and the encoder cannot tell the
 * difference — hand it an empty string and it quite rightly answers "Enter some
 * text, a link or a phone number to turn into a QR code." Shown on arrival that
 * sentence reads as the page being broken before anyone has touched it, so
 * emptiness is caught here and answered with an empty state instead.
 */
type Payload =
  | { state: 'empty' }
  | { state: 'ready'; text: string }
  | { state: 'error'; error: string };

const EMPTY: Payload = { state: 'empty' };

/** Empty text reads as "nothing typed yet", which is not the same as zero. */
function typedNumber(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}

/**
 * Assemble the string the symbol will carry.
 *
 * Every value is trimmed at the edges. A trailing space or newline is invisible
 * in a form and changes what a scanner reads, and nobody has ever meant one.
 *
 * The two checks the engine deliberately does not make are made here, because
 * both produce a code that encodes perfectly and then does nothing: `SMSTO:`
 * with no digits after it, and a `mailto:` with no address in it. Refusing is
 * kinder than printing them.
 */
function buildPayload(
  type: PayloadType,
  values: Values,
  security: WifiSecurity,
  hidden: boolean,
): Payload {
  const value = (key: string): string => (values[key] ?? '').trim();
  const anyOf = (...keys: string[]): boolean => keys.some((key) => value(key) !== '');

  if (type === 'link') {
    const url = value('url');
    return url === '' ? EMPTY : { state: 'ready', text: url };
  }

  if (type === 'text') {
    const text = value('text');
    return text === '' ? EMPTY : { state: 'ready', text };
  }

  if (type === 'wifi') {
    const ssid = value('ssid');
    if (ssid === '') return EMPTY;
    return {
      state: 'ready',
      text: buildWifiPayload({ ssid, password: value('wifiPassword'), security, hidden }),
    };
  }

  if (type === 'vcard') {
    const keys = [
      'firstName',
      'lastName',
      'org',
      'jobTitle',
      'phone',
      'email',
      'contactUrl',
      'address',
      'note',
    ];
    if (!anyOf(...keys)) return EMPTY;
    return {
      state: 'ready',
      text: buildVCardPayload({
        firstName: value('firstName'),
        lastName: value('lastName'),
        org: value('org'),
        title: value('jobTitle'),
        phone: value('phone'),
        email: value('email'),
        url: value('contactUrl'),
        address: value('address'),
        note: value('note'),
      }),
    };
  }

  if (type === 'email') {
    const to = value('mailTo');
    if (to === '') return EMPTY;
    if (!to.includes('@')) {
      return {
        state: 'error',
        error: 'An email address needs an @ in it, for example hello@example.com.',
      };
    }
    return {
      state: 'ready',
      text: buildEmailPayload({ to, subject: value('mailSubject'), body: value('mailBody') }),
    };
  }

  if (type === 'sms') {
    const phone = value('smsPhone');
    if (phone === '') return EMPTY;
    if (!/[0-9]/.test(phone)) {
      return {
        state: 'error',
        error: 'A text message needs a phone number with digits in it, for example +44 20 7946 0958.',
      };
    }
    return {
      state: 'ready',
      text: buildSmsPayload({ phone, message: value('smsMessage') }),
    };
  }

  if (type === 'geo') {
    if (!anyOf('lat', 'lon')) return EMPTY;
    // `Number('')` is 0, and a blank longitude silently becoming the Greenwich
    // meridian is exactly the kind of wrong answer nobody checks. NaN reaches the
    // builder instead, and it asks for the missing number by name.
    const built = buildGeoPayload({ lat: typedNumber(value('lat')), lon: typedNumber(value('lon')) });
    return built.ok ? { state: 'ready', text: built.payload } : { state: 'error', error: built.error };
  }

  if (!anyOf('eventTitle', 'eventStart')) return EMPTY;
  const built = buildEventPayload({
    title: value('eventTitle'),
    start: value('eventStart'),
    end: value('eventEnd'),
    location: value('eventLocation'),
    description: value('eventDescription'),
  });
  return built.ok ? { state: 'ready', text: built.payload } : { state: 'error', error: built.error };
}

type Bound = { ok: true; version: number | undefined } | { ok: false };

/**
 * A version floor or ceiling, or nothing.
 *
 * Empty means "let the encoder choose", which is the default and the right
 * answer almost always. Anything outside 1 to 40 is rejected here rather than
 * forwarded, so the encoder never has to write a sentence naming its own
 * arguments at a person.
 */
function versionBound(text: string): Bound {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, version: undefined };
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < MIN_VERSION || parsed > MAX_VERSION) return { ok: false };
  return { ok: true, version: parsed };
}

type PngResult = { ok: true; blob: Blob } | { ok: false; error: string };

/**
 * The symbol as PNG pixels, exactly `side` pixels square, with every module
 * landing on whole pixels.
 *
 * The run-merging loop is the one `qrToPathData` uses, for the same reason: a
 * version 40 symbol has around fifteen thousand dark modules, and one `fillRect`
 * per module is measurably slower than one per horizontal run.
 */
async function renderPng(qr: QrMatrix, side: number): Promise<PngResult> {
  const minimum = qr.size + QUIET_MODULES * 2;
  const modulePx = Math.floor(side / minimum);
  if (modulePx < 1) {
    return {
      ok: false,
      error:
        `A version ${qr.version} code has ${qr.size} modules per side, so it needs at least ` +
        `${minimum} pixels to stay sharp. Ask for ${minimum} or more.`,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    return {
      ok: false,
      error:
        'This browser would not give the page a drawing surface, so the PNG could not be made. ' +
        'The SVG download does not need one.',
    };
  }

  ctx.fillStyle = LIGHT;
  ctx.fillRect(0, 0, side, side);
  // Flooring the module size leaves a remainder, and it is spent widening the light
  // border rather than blurring the module edges. The border never drops below the
  // four modules the specification asks for, because `modulePx` was floored against
  // `size + 8` in the first place.
  const offset = Math.round((side - qr.size * modulePx) / 2);
  ctx.fillStyle = DARK;
  for (let y = 0; y < qr.size; y += 1) {
    const row = qr.modules[y];
    let x = 0;
    while (x < qr.size) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < qr.size && row[x + run]) run += 1;
      ctx.fillRect(offset + x * modulePx, offset + y * modulePx, run * modulePx, modulePx);
      x += run;
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/png');
  });
  if (blob === null) {
    return {
      ok: false,
      error:
        'The browser could not turn the code into a PNG, which usually means the pixel size ' +
        'asked for more memory than it had. Try a smaller size, or download the SVG.',
    };
  }
  return { ok: true, blob };
}

type Tone = 'warning' | 'info';

/**
 * A note says its severity three ways — glyph, wording and colour — because WCAG
 * 1.4.1 does not accept colour alone, and because a warning set in the same grey
 * as everything else is a warning nobody reads.
 */
const TONES: Record<Tone, { icon: IconName; label: string; className: string }> = {
  warning: { icon: 'alert-triangle', label: 'Warning', className: 'text-warning-fg' },
  info: { icon: 'info', label: 'Note', className: 'text-fg-muted' },
};

interface NoteSpec {
  tone: Tone;
  text: string;
}

function Note({ tone, text }: NoteSpec) {
  const { icon, label, className } = TONES[tone];
  return (
    <li className={cn('flex gap-1.5 text-xs', className)}>
      <Icon name={icon} size={14} label={label} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </li>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-2">
      <dt className="text-2xs uppercase tracking-wide text-fg-subtle">{term}</dt>
      <dd className="mt-0.5 text-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

/**
 * The symbol on screen.
 *
 * Written as JSX rather than dropped in through `dangerouslySetInnerHTML`, so no
 * markup is assembled from user input at any point — and the geometry comes from
 * `qrToPathData`, the same function `qrToSvg` calls, so the preview, the SVG file
 * and the PNG cannot drift apart into three slightly different pictures.
 *
 * The white field is painted inside the `viewBox`, which is why the code still
 * scans when it is photographed off a dark-mode screen. `crispEdges` stops the
 * browser antialiasing module edges into grey, which is the usual reason a code on
 * a screen reads more slowly than the same code on paper.
 */
function Preview({ qr }: { qr: QrMatrix }) {
  const span = qr.size + QUIET_MODULES * 2;
  return (
    <div className="mx-auto w-full max-w-xs overflow-hidden rounded-lg border border-border-subtle">
      <svg
        viewBox={`0 0 ${span} ${span}`}
        role="img"
        shapeRendering="crispEdges"
        className="block h-auto w-full"
      >
        <title>{`QR code, version ${qr.version}, error correction level ${qr.ecc}`}</title>
        <rect width={span} height={span} fill={LIGHT} />
        <path d={qrToPathData(qr, { moduleSize: 1, margin: QUIET_MODULES })} fill={DARK} />
      </svg>
    </div>
  );
}

/** `type` and `inputMode` per field kind. Anything absent is a plain text field. */
const INPUT_TYPE: Partial<Record<FieldKind, HTMLInputTypeAttribute>> = {
  url: 'url',
  email: 'email',
  tel: 'tel',
  datetime: 'datetime-local',
};

const INPUT_MODE: Partial<Record<FieldKind, 'url' | 'email' | 'tel'>> = {
  url: 'url',
  email: 'email',
  tel: 'tel',
};

/** Kinds whose value is never a sentence, so a phone should not capitalise it. */
const NEVER_CAPITALISE: FieldKind[] = ['url', 'email', 'tel', 'secret', 'decimal'];

/**
 * One field from the table.
 *
 * The Wi-Fi password is a plain text field on purpose. Masking it would imply a
 * secret is being kept, and this one is about to be printed in a shape any camera
 * can read — all masking would achieve is stopping the person typing it from
 * checking it. `autoComplete="off"` everywhere is the same thought in reverse: a
 * browser offering to fill in a saved password is offering to put it on a poster.
 */
function PayloadField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = `qr-${spec.key}`;
  const kind = spec.kind ?? 'text';
  const description = describedBy(id, { hint: spec.hint });

  return (
    <Field
      label={spec.label}
      htmlFor={id}
      hint={spec.hint}
      optional={spec.optional}
      className={cn(spec.wide && 'sm:col-span-2')}
    >
      {kind === 'multiline' ? (
        <Textarea
          id={id}
          value={value}
          rows={spec.rows ?? 3}
          maxLength={spec.maxLength}
          placeholder={spec.placeholder}
          aria-describedby={description}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={value}
          type={INPUT_TYPE[kind]}
          inputMode={INPUT_MODE[kind]}
          numeric={kind === 'decimal'}
          maxLength={spec.maxLength}
          placeholder={spec.placeholder}
          aria-describedby={description}
          autoComplete="off"
          spellCheck={kind === 'text' ? undefined : false}
          autoCapitalize={NEVER_CAPITALISE.includes(kind) ? 'none' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * What is worth saying about a finished code, in the order it would matter to
 * somebody about to print five hundred of them.
 *
 * Warnings come first because three of them describe a code that encodes perfectly
 * and then does something other than what was intended: a network password handed
 * to everyone who photographs it, a security type the phone will read as a failed
 * join, and a bare `example.com` that most cameras show as text rather than
 * offering to open.
 */
function notesFor(
  type: PayloadType,
  values: Values,
  security: WifiSecurity,
  qr: QrMatrix,
): NoteSpec[] {
  const notes: NoteSpec[] = [];
  const value = (key: string): string => (values[key] ?? '').trim();

  if (type === 'wifi' && value('wifiPassword') !== '') {
    notes.push({
      tone: 'warning',
      text:
        'Anyone who photographs this code has the network password, and it stays valid until the ' +
        'password is changed. Print it for a guest network rather than the one your own devices are on.',
    });
  }
  if (type === 'wifi' && security !== 'nopass' && value('wifiPassword') === '') {
    notes.push({
      tone: 'warning',
      text:
        `${security} is selected with no password, which most phones read as a join that failed. ` +
        'Choose “Open” if the network genuinely has no password.',
    });
  }
  if (type === 'link' && value('url') !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(value('url'))) {
    notes.push({
      tone: 'warning',
      text:
        'Without https:// at the front, many cameras show this as plain text instead of offering ' +
        'to open it.',
    });
  }
  if (qr.eci) {
    notes.push({
      tone: 'warning',
      text:
        'This text needs characters outside Latin-1, so the code carries a marker saying it is ' +
        'UTF-8. Almost every reader honours that marker; a few old ones ignore it and show the ' +
        'wrong characters.',
    });
  }
  if (qr.version >= 10) {
    notes.push({
      tone: 'warning',
      text:
        `A version ${qr.version} code has ${qr.size} modules per side, so each module is small at ` +
        'any given printed size. Shortening the text or choosing a lower error correction level ' +
        'makes the modules larger.',
    });
  }
  if (type === 'event') {
    notes.push({
      tone: 'info',
      text:
        'The times are converted from this computer’s clock to UTC, so the event lands at the ' +
        'right moment wherever it is scanned.',
    });
  }
  if (type === 'geo') {
    notes.push({
      tone: 'info',
      text:
        'The pin opens in whichever map app the phone already uses. The code names a place, not ' +
        'an app.',
    });
  }
  notes.push({
    tone: 'info',
    text:
      'The data sits inside the symbol rather than on a server, so nothing here expires, nothing ' +
      'counts scans, and changing where it points means printing a new code.',
  });
  return notes;
}

export function QrCodeGeneratorTool() {
  const [type, setType] = useState<PayloadType>('link');
  const [values, setValues] = useState<Values>({});
  const [security, setSecurity] = useState<WifiSecurity>('WPA');
  const [hiddenNetwork, setHiddenNetwork] = useState(false);
  const [ecc, setEcc] = useState<EccLevel>('M');
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [pngText, setPngText] = useState(String(PNG_DEFAULT));
  /** Which of the two buttons is working, so only that one shows a spinner. */
  const [saving, setSaving] = useState<'svg' | 'png' | null>(null);

  const markStarted = useToolStarted(SLUG);
  const { phase, busy, result, error: runError, start, reset } = useToolRun<string>(SLUG);

  const spec = PAYLOADS[type];

  const payload = useMemo(
    () => buildPayload(type, values, security, hiddenNetwork),
    [type, values, security, hiddenNetwork],
  );
  const text = payload.state === 'ready' ? payload.text : '';
  // Typing stays immediate and the encode is allowed to be one frame behind, which
  // matters at the top of the range: a version 40 symbol means Reed-Solomon over
  // 2,956 codewords and eight mask patterns scored against four penalty rules.
  const deferredText = useDeferredValue(text);

  const minBound = versionBound(minText);
  const maxBound = versionBound(maxText);
  const minVersion = minBound.ok ? minBound.version : undefined;
  const maxVersion = maxBound.ok ? maxBound.version : undefined;
  const inverted = minVersion !== undefined && maxVersion !== undefined && minVersion > maxVersion;
  // An out-of-range or inverted pair is never forwarded, so the encoder never has to
  // write a sentence naming its own arguments at somebody filling in a form. It goes
  // back to choosing the smallest version that fits, which is what it does by default.
  const floor = inverted ? undefined : minVersion;
  const ceiling = inverted ? undefined : maxVersion;

  const encoded = useMemo(
    () =>
      deferredText === ''
        ? null
        : encodeQr(deferredText, { ecc, minVersion: floor, maxVersion: ceiling }),
    [deferredText, ecc, floor, ceiling],
  );
  const qr = encoded !== null && encoded.ok ? encoded.qr : null;
  const inputError =
    payload.state === 'error'
      ? payload.error
      : encoded !== null && !encoded.ok
        ? encoded.error
        : null;

  // The smallest PNG that keeps every module on whole pixels. Checked on the field
  // rather than after the click, because "that size will not work" is something the
  // page knows before anybody asks for it, and a hint beats a failure.
  const pngFloor = qr === null ? 1 : qr.size + QUIET_MODULES * 2;
  const pngSide = typedNumber(pngText);
  const pngBlank = pngText.trim() === '';
  const pngInvalid =
    Number.isFinite(pngSide) &&
    (!Number.isInteger(pngSide) || pngSide < pngFloor || pngSide > PNG_MAX);

  // A "Saved …" line, and a failure sentence under a button, both have to stop being
  // shown the moment they stop describing what is on screen. The token is every input
  // the symbol depends on, so any change to the code clears the last outcome.
  const token = `${ecc}|${floor ?? ''}|${ceiling ?? ''}|${deferredText}`;
  useEffect(() => {
    reset();
  }, [token, reset]);

  function change(key: string, next: string) {
    markStarted();
    setValues((current) => ({ ...current, [key]: next }));
  }

  function saveSvg() {
    if (qr === null) return;
    setSaving('svg');
    void start(() => {
      const svg = qrToSvg(qr, { moduleSize: 8, margin: QUIET_MODULES, dark: DARK, light: LIGHT });
      const delivered = downloadText(svg, `qr-${type}.svg`, { mime: 'image/svg+xml' });
      if (!delivered.ok) return { ok: false, error: delivered.error, reason: delivered.reason };
      toolTracker(SLUG).downloaded('svg');
      return { ok: true, value: delivered.name };
    });
  }

  function savePng() {
    if (qr === null || pngBlank || pngInvalid) return;
    setSaving('png');
    void start(async () => {
      const rendered = await renderPng(qr, pngSide);
      if (!rendered.ok) return { ok: false, error: rendered.error };
      const delivered = downloadBlob(rendered.blob, `qr-${type}.png`);
      if (!delivered.ok) return { ok: false, error: delivered.error, reason: delivered.reason };
      toolTracker(SLUG).downloaded('png');
      return { ok: true, value: delivered.name };
    });
  }

  const notes = qr === null ? [] : notesFor(type, values, security, qr);
  const versionRange = `${MIN_VERSION} to ${MAX_VERSION}`;
  const rangeError = `Enter a whole number from ${versionRange}, or leave it empty.`;

  return (
    <ToolWorkspace
      label="QR code generator"
      intro="The symbol is drawn in this browser as you type. Nothing is uploaded, which you can confirm in your browser’s network tab."
      error={inputError ?? runError}
      status={phase === 'done' && result !== null ? `Saved ${result}` : null}
    >
      <Field label="What the code does" htmlFor={TYPE_ID} hint={spec.blurb}>
        <Select
          id={TYPE_ID}
          value={type}
          aria-describedby={describedBy(TYPE_ID, { hint: true })}
          onChange={(event) => {
            markStarted();
            setType(event.target.value as PayloadType);
          }}
        >
          {TYPE_ORDER.map((key) => (
            <option key={key} value={key}>
              {PAYLOADS[key].label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        {spec.fields.map((field) => (
          <PayloadField
            key={field.key}
            spec={field}
            value={values[field.key] ?? ''}
            onChange={(next) => change(field.key, next)}
          />
        ))}
        {type === 'wifi' ? (
          <Field label="Security" htmlFor={SECURITY_ID} hint="WPA covers WPA2 and WPA3 as well.">
            <Select
              id={SECURITY_ID}
              value={security}
              aria-describedby={describedBy(SECURITY_ID, { hint: true })}
              onChange={(event) => {
                markStarted();
                setSecurity(event.target.value as WifiSecurity);
              }}
            >
              <option value="WPA">WPA, WPA2 or WPA3</option>
              <option value="WEP">WEP</option>
              <option value="nopass">Open — no password</option>
            </Select>
          </Field>
        ) : null}
      </div>

      {type === 'wifi' ? (
        <div className="flex items-start gap-2.5">
          <Switch
            checked={hiddenNetwork}
            onCheckedChange={(next) => {
              markStarted();
              setHiddenNetwork(next);
            }}
            label="The network name is hidden"
            size="sm"
            className="mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-sm text-fg">The network name is hidden</p>
            <p className="text-xs text-fg-muted">
              Only for a network that does not broadcast its name. Ticking it otherwise can stop
              the join from working.
            </p>
          </div>
        </div>
      ) : null}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">Error correction and size</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Error correction"
            htmlFor={ECC_ID}
            hint="A higher level survives more damage, but it needs more codewords — which can push the version up and make every module smaller in the same printed area."
            className="sm:col-span-2"
          >
            <Select
              id={ECC_ID}
              value={ecc}
              aria-describedby={describedBy(ECC_ID, { hint: true })}
              onChange={(event) => {
                markStarted();
                setEcc(event.target.value as EccLevel);
              }}
            >
              {ECC_ORDER.map((level) => (
                <option key={level} value={level}>
                  {ECC_LABELS[level]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Smallest version"
            htmlFor={MIN_VERSION_ID}
            optional
            hint={`${versionRange}. Empty means the smallest that fits.`}
            error={minBound.ok ? undefined : rangeError}
          >
            <Input
              id={MIN_VERSION_ID}
              value={minText}
              numeric
              inputMode="numeric"
              maxLength={2}
              placeholder="auto"
              invalid={!minBound.ok}
              aria-describedby={describedBy(MIN_VERSION_ID, { hint: true, error: !minBound.ok })}
              onChange={(event) => {
                markStarted();
                setMinText(event.target.value);
              }}
            />
          </Field>

          <Field
            label="Largest version"
            htmlFor={MAX_VERSION_ID}
            optional
            hint={`${versionRange}. Useful when a code has to stay readable at a fixed printed size.`}
            error={
              maxBound.ok
                ? inverted
                  ? 'The largest version cannot be below the smallest. Both are ignored until they agree.'
                  : undefined
                : rangeError
            }
          >
            <Input
              id={MAX_VERSION_ID}
              value={maxText}
              numeric
              inputMode="numeric"
              maxLength={2}
              placeholder="auto"
              invalid={!maxBound.ok || inverted}
              aria-describedby={describedBy(MAX_VERSION_ID, {
                hint: true,
                error: !maxBound.ok || inverted,
              })}
              onChange={(event) => {
                markStarted();
                setMaxText(event.target.value);
              }}
            />
          </Field>
        </div>
      </fieldset>

      {qr === null ? (
        payload.state === 'empty' ? (
          <EmptyState
            icon="qr"
            title="Your code will appear here"
            description="Fill in the fields above and the symbol is drawn as you type."
          />
        ) : null
      ) : (
        <section aria-labelledby={RESULT_HEADING_ID} className="space-y-4">
          <h2 id={RESULT_HEADING_ID} className="text-sm font-medium text-fg">
            Your QR code
          </h2>

          <Preview qr={qr} />

          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Fact term="Version" value={`${qr.version} — ${qr.size} × ${qr.size} modules`} />
            <Fact term="Error correction" value={ECC_LABELS[qr.ecc]} />
            <Fact term="Encoding" value={MODE_LABELS[qr.mode]} />
            <Fact
              term="Data used"
              value={`${qr.capacityUsed} of ${qr.capacityTotal} codewords`}
            />
          </dl>

          {notes.length === 0 ? null : (
            <ul className="space-y-1.5">
              {notes.map((note) => (
                <Note key={note.text} tone={note.tone} text={note.text} />
              ))}
            </ul>
          )}

          <div className="space-y-2 rounded-lg border border-border-subtle bg-surface-sunken p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Field
                label="PNG size"
                htmlFor={PNG_SIZE_ID}
                hint={`${pngFloor} to ${PNG_MAX} pixels square.`}
                error={
                  pngInvalid
                    ? `A version ${qr.version} code needs ${pngFloor} to ${PNG_MAX} pixels for every module to land on whole pixels.`
                    : undefined
                }
                className="sm:w-52 sm:shrink-0"
              >
                <Input
                  id={PNG_SIZE_ID}
                  value={pngText}
                  numeric
                  inputMode="numeric"
                  maxLength={4}
                  invalid={pngInvalid}
                  suffix="px"
                  aria-describedby={describedBy(PNG_SIZE_ID, { hint: true, error: pngInvalid })}
                  onChange={(event) => setPngText(event.target.value)}
                />
              </Field>

              <div className="flex flex-wrap gap-2 sm:pt-7">
                <Button iconLeft="download" loading={busy && saving === 'svg'} onClick={saveSvg}>
                  Download SVG
                </Button>
                <Button
                  variant="secondary"
                  iconLeft="download"
                  loading={busy && saving === 'png'}
                  disabled={pngBlank || pngInvalid}
                  onClick={savePng}
                >
                  Download PNG
                </Button>
              </div>
            </div>

            {phase === 'done' && result !== null ? (
              // The workspace's live region already announces this, so the visible
              // copy is hidden from assistive technology rather than read twice.
              <p
                aria-hidden="true"
                className="flex items-center gap-1.5 text-xs font-medium text-success-fg"
              >
                <Icon name="check-circle" size={14} />
                Saved {result}
              </p>
            ) : (
              <p className="text-xs text-fg-muted">
                The SVG is a true vector for print. The PNG is exactly the pixel size asked for,
                with the modules on whole pixels so they stay sharp.
              </p>
            )}
          </div>

          <p className="flex gap-1.5 text-xs text-fg-muted">
            <Icon name="info" size={14} label="Note" className="mt-0.5 shrink-0" />
            <span>
              Place the code at its final size and scan it with two different phones before
              committing to a print run. Reader quality varies more than the symbol does.
            </span>
          </p>

          <TextOutput
            slug={SLUG}
            id="qr-payload"
            label="The exact text inside the symbol"
            value={deferredText}
            copyTarget="payload"
            downloadName={`qr-${type}.txt`}
            rows={type === 'vcard' || type === 'event' ? 8 : 3}
            monospace
            footer="This is what a scanner reads. Worth a look before a print run, particularly for a contact card or an event, where the format matters more than the wording."
          />
        </section>
      )}
    </ToolWorkspace>
  );
}


