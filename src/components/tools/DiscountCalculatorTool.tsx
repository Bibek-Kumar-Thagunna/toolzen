'use client';

/**
 * ============================================================================
 * DISCOUNT AND SALES TAX CALCULATOR
 * ============================================================================
 * Four questions people ask in a shop, on one page.
 *
 * ── Why tax can sit on either side of the discount ────────────────────────
 * Most calculators charge tax on the discounted price and never mention it. That
 * is right for a shop's own sale and wrong for a manufacturer's coupon in
 * several US states, where the shop is reimbursed and tax is charged on the
 * pre-coupon price. The two produce different totals on the same numbers, so
 * the question is asked rather than assumed. Leave the tax at zero and the
 * control does not appear at all.
 *
 * ── Why "you save" is bigger than the discount ────────────────────────────
 * When tax follows the discount, the tax on the money saved is saved too. The
 * engine compares this bill with the same basket at full price, which is the
 * honest answer to "how much did I save" — and it is why the effective
 * percentage can beat the headline one.
 *
 * ── Why stacking has its own mode ─────────────────────────────────────────
 * "20% off, then another 20% at the till" is 36% off, not 40%: the second
 * discount is charged on 80% of the price. This is the arithmetic people most
 * reliably get wrong in their heads, and the mode exists to show both numbers
 * side by side rather than to quietly return the right one.
 *
 * Everything is computed during render — no effects, no clock — so the page
 * server-renders with a worked example already on it.
 * ============================================================================
 */
import { useMemo, useState } from 'react';

import { AnswerCard, FactGrid, ShownWorking, type Fact } from '@/components/tool/CalcAnswer';
import { ToolWorkspace } from '@/components/tool/ToolWorkspace';
import { useToolStarted } from '@/components/tool/useToolRun';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Tabs, type TabDescriptor } from '@/components/ui/Tabs';
import {
  applyDiscount,
  discountFromPrices,
  originalFromSale,
  stackedDiscounts,
  type TaxBase,
} from '@/lib/tools/calc/discount';
import {
  display,
  displayMoney,
  displayPercent,
  parseLooseNumber,
  type Step,
} from '@/lib/tools/calc/round';

const SLUG = 'discount-calculator';

type Mode = 'apply' | 'percent' | 'original' | 'stack';

const TABS: TabDescriptor[] = [
  { id: 'apply', label: 'Take % off a price' },
  { id: 'percent', label: 'What % is this off?' },
  { id: 'original', label: 'Price before the sale' },
  { id: 'stack', label: 'Stacked discounts' },
];

/** A settled answer, or the reason there is not one yet. */
type Outcome =
  | { kind: 'incomplete' }
  | { kind: 'failed'; error: string }
  | {
      kind: 'ok';
      headline: string;
      sentence: string;
      copy: string;
      facts: Fact[];
      formula: string;
      steps: Step[];
    };

export function DiscountCalculatorTool() {
  const [mode, setMode] = useState<Mode>('apply');

  const [price, setPrice] = useState('80');
  const [percent, setPercent] = useState('25');
  const [tax, setTax] = useState('0');
  const [taxOn, setTaxOn] = useState<TaxBase>('after');
  const [quantity, setQuantity] = useState('1');

  const [original, setOriginal] = useState('80');
  const [sale, setSale] = useState('60');

  const [stackPrice, setStackPrice] = useState('100');
  const [stackPercents, setStackPercents] = useState('20, 20');

  const markStarted = useToolStarted(SLUG);

  const outcome = useMemo<Outcome>(() => {
    if (mode === 'apply') {
      const p = parseLooseNumber(price);
      const d = parseLooseNumber(percent);
      const t = tax.trim() === '' ? 0 : parseLooseNumber(tax);
      const q = quantity.trim() === '' ? 1 : parseLooseNumber(quantity);
      if (p === null || d === null || t === null || q === null) return { kind: 'incomplete' };

      const result = applyDiscount({
        price: p,
        discountPercent: d,
        taxPercent: t,
        taxOn,
        quantity: q,
      });
      if (!result.ok) return { kind: 'failed', error: result.error };
      const r = result.result;
      return {
        kind: 'ok',
        headline: displayMoney(r.total),
        sentence:
          r.taxAmount > 0
            ? `Total to pay, including ${displayMoney(r.taxAmount)} of tax.`
            : 'Total to pay.',
        copy: displayMoney(r.total),
        facts: [
          { term: 'Discount', value: `− ${displayMoney(r.discountAmount)}` },
          { term: 'Price after the discount', value: displayMoney(r.afterDiscount) },
          ...(r.taxAmount > 0
            ? [{ term: 'Tax', value: `+ ${displayMoney(r.taxAmount)}` }]
            : []),
          {
            term: 'You save',
            value: displayMoney(r.savedTotal),
            // Larger than the headline percentage when the tax follows the
            // discount, because the tax on the saving is saved too.
            note: `${displayPercent(r.effectiveDiscountPercent)} of the full-price bill`,
          },
        ],
        formula: r.formula,
        steps: r.steps,
      };
    }

    if (mode === 'percent') {
      const o = parseLooseNumber(original);
      const s = parseLooseNumber(sale);
      if (o === null || s === null) return { kind: 'incomplete' };
      const result = discountFromPrices({ original: o, sale: s });
      if (!result.ok) return { kind: 'failed', error: result.error };
      const r = result.result;
      return {
        kind: 'ok',
        headline: `${displayPercent(r.discountPercent)} off`,
        sentence: `That ticket saves ${displayMoney(r.savedAmount)}.`,
        copy: displayPercent(r.discountPercent),
        facts: [
          { term: 'You save', value: displayMoney(r.savedAmount) },
          { term: 'You pay', value: displayMoney(s) },
        ],
        formula: r.formula,
        steps: r.steps,
      };
    }

    if (mode === 'original') {
      const s = parseLooseNumber(sale);
      const d = parseLooseNumber(percent);
      if (s === null || d === null) return { kind: 'incomplete' };
      const result = originalFromSale({ sale: s, discountPercent: d });
      if (!result.ok) return { kind: 'failed', error: result.error };
      const r = result.result;
      return {
        kind: 'ok',
        headline: displayMoney(r.original),
        sentence: `The price before ${displayPercent(d)} was taken off.`,
        copy: displayMoney(r.original),
        facts: [
          { term: 'Sale price', value: displayMoney(s) },
          { term: 'Taken off', value: displayMoney(r.original - s) },
        ],
        formula: r.formula,
        steps: r.steps,
      };
    }

    const p = parseLooseNumber(stackPrice);
    // Commas and spaces both separate here — unlike the percentage tool's list
    // mode, these are percentages, and nobody writes a thousands separator in one.
    const percents = stackPercents
      .split(/[,\s/+]+/)
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map(parseLooseNumber);
    if (p === null || percents.length === 0 || percents.some((value) => value === null)) {
      return { kind: 'incomplete' };
    }

    const result = stackedDiscounts({ price: p, percents: percents as number[] });
    if (!result.ok) return { kind: 'failed', error: result.error };
    const r = result.result;
    return {
      kind: 'ok',
      headline: displayMoney(r.total),
      sentence:
        r.effectivePercent === r.naiveSumPercent
          ? `${displayPercent(r.effectivePercent)} off in total.`
          : `${displayPercent(r.effectivePercent)} off in total — not the ${displayPercent(r.naiveSumPercent)} the percentages add up to.`,
      copy: displayMoney(r.total),
      facts: [
        { term: 'Real discount', value: displayPercent(r.effectivePercent) },
        {
          term: 'The percentages added up',
          value: displayPercent(r.naiveSumPercent),
          note: 'What people expect, and why stacked discounts disappoint',
        },
        { term: 'You save', value: displayMoney(p - r.total) },
      ],
      formula: r.formula,
      steps: r.steps,
    };
  }, [mode, original, percent, price, quantity, sale, stackPercents, stackPrice, tax, taxOn]);

  const taxValue = parseLooseNumber(tax) ?? 0;

  function onChange(setter: (value: string) => void) {
    return (event: { target: { value: string } }) => {
      markStarted();
      setter(event.target.value);
    };
  }

  return (
    <ToolWorkspace
      label="Discount calculator"
      error={outcome.kind === 'failed' ? outcome.error : null}
    >
      <Tabs
        tabs={TABS}
        value={mode}
        onValueChange={(id) => setMode(id as Mode)}
        ariaLabel="What you want to work out"
      >
        {mode === 'apply' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Price" htmlFor="disc-price" hint="Before anything is taken off.">
                <Input id="disc-price" inputMode="decimal" value={price} onChange={onChange(setPrice)} />
              </Field>
              <Field label="Discount" htmlFor="disc-percent" hint="The percentage on the ticket.">
                <Input
                  id="disc-percent"
                  inputMode="decimal"
                  value={percent}
                  onChange={onChange(setPercent)}
                  suffix="%"
                />
              </Field>
              <Field label="Quantity" htmlFor="disc-qty" hint="How many of this item.">
                <Input id="disc-qty" inputMode="numeric" value={quantity} onChange={onChange(setQuantity)} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Sales tax, VAT or GST"
                htmlFor="disc-tax"
                hint="Leave at zero if the price already includes it."
              >
                <Input id="disc-tax" inputMode="decimal" value={tax} onChange={onChange(setTax)} suffix="%" />
              </Field>
              {/* Only worth asking once there is a tax to charge. */}
              {taxValue > 0 ? (
                <Field
                  label="Charge the tax on"
                  htmlFor="disc-taxon"
                  hint="A shop's own sale taxes the reduced price. Some coupons are taxed on the full price."
                >
                  <Select
                    id="disc-taxon"
                    value={taxOn}
                    onChange={(event) => setTaxOn(event.target.value as TaxBase)}
                  >
                    <option value="after">The discounted price</option>
                    <option value="before">The full price</option>
                  </Select>
                </Field>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === 'percent' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Was" htmlFor="disc-original" hint="The price before the sale.">
              <Input id="disc-original" inputMode="decimal" value={original} onChange={onChange(setOriginal)} />
            </Field>
            <Field label="Now" htmlFor="disc-sale" hint="What it is marked at today.">
              <Input id="disc-sale" inputMode="decimal" value={sale} onChange={onChange(setSale)} />
            </Field>
          </div>
        ) : null}

        {mode === 'original' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Sale price" htmlFor="disc-sale2" hint="What you are being asked to pay.">
              <Input id="disc-sale2" inputMode="decimal" value={sale} onChange={onChange(setSale)} />
            </Field>
            <Field label="Discount applied" htmlFor="disc-percent2" hint="The percentage the sign claims.">
              <Input
                id="disc-percent2"
                inputMode="decimal"
                value={percent}
                onChange={onChange(setPercent)}
                suffix="%"
              />
            </Field>
          </div>
        ) : null}

        {mode === 'stack' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Price" htmlFor="disc-stackprice" hint="Before any of the discounts.">
              <Input
                id="disc-stackprice"
                inputMode="decimal"
                value={stackPrice}
                onChange={onChange(setStackPrice)}
              />
            </Field>
            <Field
              label="Discounts, in order"
              htmlFor="disc-stacklist"
              hint="Separate them with commas: 20, 10 means 20% off, then 10% off what is left."
            >
              <Input
                id="disc-stacklist"
                value={stackPercents}
                onChange={onChange(setStackPercents)}
                placeholder="20, 10"
              />
            </Field>
          </div>
        ) : null}
      </Tabs>

      {outcome.kind === 'ok' ? (
        <>
          <AnswerCard
            slug={SLUG}
            headline={outcome.headline}
            sentence={outcome.sentence}
            copyValue={outcome.copy}
            copyTarget={mode}
          />
          <FactGrid facts={outcome.facts} />
          <ShownWorking slug={SLUG} formula={outcome.formula} steps={outcome.steps} />
          <p className="text-sm text-fg-muted">
            Amounts are rounded to two decimal places at each step, the way a till does — so the
            figures here add up exactly rather than approximately. Currency is deliberately not
            shown: the arithmetic is the same in {display(1)} rupee, dollar, pound or euro.
          </p>
        </>
      ) : null}
    </ToolWorkspace>
  );
}
