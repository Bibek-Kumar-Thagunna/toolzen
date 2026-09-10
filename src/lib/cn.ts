/**
 * Class-name joiner.
 *
 * Deliberately dependency-free. The usual pairing is `clsx` + `tailwind-merge`,
 * and `tailwind-merge` in particular is a real convenience: it resolves
 * conflicting utilities so a caller's `className` can override a component's
 * own. We skip both because:
 *
 *   - `clsx` is ~15 lines of logic, reproduced below.
 *   - `tailwind-merge` ships a full parsed model of Tailwind's utility space
 *     (tens of kB) into the client bundle to solve a problem we can avoid by
 *     design instead.
 *
 * The design that avoids it: primitives pick exactly one class per axis
 * (one `variant`, one `size`) rather than layering, and the caller's
 * `className` is appended last and expected to *add* — margin, width, grid
 * placement — not to fight a variant. Where overriding genuinely matters, the
 * primitive exposes a prop for it. If a component ever needs true conflict
 * resolution, that is a signal its variant set is wrong.
 *
 * Note on CSS specificity: appending later in the `class` attribute does not
 * win a conflict. Tailwind resolves conflicts by position in the generated
 * stylesheet, not by order in the attribute. This is exactly why the rule
 * above is "add, don't override".
 */
export type ClassValue = string | number | null | undefined | false | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  let out = '';
  for (const input of inputs) {
    if (!input) continue;
    const part = Array.isArray(input) ? cn(...input) : String(input);
    if (!part) continue;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}
