'use client';

/**
 * ============================================================================
 * SearchTrigger — the header's way into the palette
 * ============================================================================
 * Two controls, one behaviour. From `md` up, a wide control that reads as a
 * search field with the ⌘K hint printed inside it; below `md`, where that field
 * would eat the whole header, a single glyph. Exactly one of the two is in the
 * accessibility tree at any width, because `hidden` is `display: none` and a
 * `display: none` subtree is not exposed — so nobody is offered two ways to do
 * the same thing.
 *
 * ── Why a button and not a real `<input readOnly>` ───────────────────────────
 * The wide control looks like a text field, so the tempting implementation is
 * an actual input that opens the palette on focus. It lies in two places that
 * matter:
 *
 *   - A `readOnly` input still announces as "edit text", so a screen reader
 *     user is invited to type into something that cannot accept a character.
 *     (`disabled` announces as unavailable, which is worse.)
 *   - It takes the caret. On a phone, focusing a text field raises the on-screen
 *     keyboard for a box that discards every keystroke; on a desktop the first
 *     characters of the query go into a control that will not keep them.
 *
 * So this is a `<button>`. It announces as a button, activates on Enter and
 * Space, and the field the user actually types into is the real one inside the
 * dialog, which is focused and selected on open. The appearance is borrowed;
 * the semantics are not.
 *
 * ── Why the wide control writes its own classes ──────────────────────────────
 * A field-shaped control needs `justify-between` spacing, and `Button`'s base
 * string already sets `justify-center`. Two classes on one property is exactly
 * what `src/lib/cn.ts` warns will not reliably resolve, so the wide control
 * styles a plain `<button>`. The compact one has no such conflict and uses the
 * primitive.
 *
 * ── Where the keyboard shortcut lives ───────────────────────────────────────
 * Not here. `CommandPalette` owns the ⌘K / `/` listener and accepts `onOpen`,
 * so a page that renders the palette without a header button still has the
 * shortcut. This component owns two things only: whether the palette is open,
 * and the preference lists it opens with.
 * ============================================================================
 */
import { useCallback, useEffect, useState } from 'react';

import { Icon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { SearchDoc } from '@/lib/registry/search';
import { readFavorites, readRecentTools, subscribe } from '@/lib/storage';

import { CommandPalette, Kbd, useApplePlatform } from './CommandPalette';

/** One shared empty list, so a closed palette's memos never see a new array. */
const NO_SLUGS: readonly string[] = [];

interface Preferences {
  favorites: readonly string[];
  recents: readonly string[];
}

const NO_PREFERENCES: Preferences = { favorites: NO_SLUGS, recents: NO_SLUGS };

export interface SearchTriggerProps {
  /** The shipped projection, handed down by a server component. */
  docs: SearchDoc[];
}

export function SearchTrigger({ docs }: SearchTriggerProps) {
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(NO_PREFERENCES);
  const isApple = useApplePlatform();

  /**
   * Read on open, not on mount.
   *
   * There is no `localStorage` while the server renders, so a value read during
   * the first client render would disagree with the HTML that was sent. Reading
   * inside the open handler avoids the question entirely: by then we are
   * unambiguously on the client, responding to a gesture, and the read is
   * synchronous — so the first painted frame of the list is already right
   * instead of filling itself in a moment later.
   */
  const refresh = useCallback(() => {
    setPreferences({ favorites: readFavorites(), recents: readRecentTools() });
  }, []);

  const handleOpen = useCallback(() => {
    refresh();
    setOpen(true);
  }, [refresh]);

  const handleClose = useCallback(() => setOpen(false), []);

  // While it is open, keep up: a star toggled on the page behind the palette,
  // or in a second tab, changes what "Favorites" ought to list.
  useEffect(() => {
    if (!open) return;
    return subscribe(refresh);
  }, [open, refresh]);

  return (
    <>
      {/* Compact. `relative` plus a 2px inset pseudo-element lifts the hit area
          to 44px without putting a second height class on the primitive's own
          `h-10 w-10` — a same-property collision cn.ts refuses to arbitrate. */}
      <Button
        size="icon"
        variant="ghost"
        iconLeft="search"
        aria-label="Search tools"
        aria-haspopup="dialog"
        onClick={handleOpen}
        className="relative before:absolute before:-inset-0.5 md:hidden"
      />

      {/* Wide: field-shaped, button-behaved. */}
      <button
        type="button"
        onClick={handleOpen}
        // The visible text is inside the accessible name, so 2.5.3 Label in Name
        // holds. The shortcut is stated as `aria-keyshortcuts` rather than left
        // in the name, where it would read as "Search tools ⌘K".
        aria-label="Search tools"
        aria-haspopup="dialog"
        aria-keyshortcuts={isApple ? 'Meta+K' : 'Control+K'}
        className={cn(
          'hidden h-10 w-full max-w-xs items-center gap-2 rounded border border-border',
          'bg-surface-sunken pl-3 pr-2 text-left text-sm text-fg-muted',
          'transition-colors duration-fast ease-out hover:bg-surface-hover md:flex',
        )}
      >
        <Icon name="search" size={16} className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate">Search tools</span>
        <span aria-hidden="true">
          <Kbd>{isApple ? '⌘K' : 'Ctrl K'}</Kbd>
        </span>
      </button>

      {/* Always mounted: it carries the ⌘K listener, and a closed `<dialog>` is
          `display: none`, so this costs no layout and exposes nothing. */}
      <CommandPalette
        docs={docs}
        open={open}
        onClose={handleClose}
        onOpen={handleOpen}
        favorites={preferences.favorites}
        recents={preferences.recents}
      />
    </>
  );
}
