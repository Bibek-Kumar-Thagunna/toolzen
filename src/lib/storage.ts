/**
 * ============================================================================
 * DEVICE PREFERENCES
 * ============================================================================
 * Favorites and recently-used tools, kept in `localStorage`.
 *
 * ── Why not React state ─────────────────────────────────────────────────────
 * React state dies on navigation. "Favorite" that forgets itself when you open
 * a tool is worse than no favorites at all, and the whole point of the recents
 * list is that it is there tomorrow.
 *
 * ── Why not a cookie ────────────────────────────────────────────────────────
 * A cookie is sent on every single request — every page, every asset that
 * shares the origin — and nothing on the server would ever read it. There is no
 * account system in this product, so there is no server-side "you" to attach the
 * data to and nothing to sync it with. Paying request bytes forever for data
 * that only the client reads is a straight loss, and a cookie would also drag
 * the site into consent-banner territory for a bookmark list.
 *
 * So this is per-device by design. Two browsers mean two sets of favorites; that
 * is the honest consequence of having no accounts, and it is the trade we want.
 *
 * ── Why every read validates ────────────────────────────────────────────────
 * `localStorage` is user-writable. Anything here may have been hand-edited in
 * devtools, corrupted by a half-finished write, or left behind by an older
 * version of this file with a different shape. So a reader never trusts what it
 * parses: it must return the documented default rather than throw, and must
 * never hand back a value that is not an array of plausible slugs. Slugs are
 * shape-checked against {@link SLUG_SHAPE} because they end up interpolated into
 * a URL by the caller, and `"../../admin"` is not a tool.
 *
 * Not a client component and not a hook: it is a plain module with no React
 * import, so a server component can import it harmlessly and every function is
 * a no-op when there is no `window`.
 * ============================================================================
 */

/** One namespace for everything this product stores. */
const PREFIX = 'flint:';

const KEYS = {
  favorites: `${PREFIX}favorites`,
  recents: `${PREFIX}recents`,
} as const;

/**
 * The only slug shape we will read back out. Matches the registry's own slug
 * convention (lowercase, digits, hyphens) and bounds the length so a megabyte
 * of junk in one entry cannot reach the DOM.
 */
const SLUG_SHAPE = /^[a-z0-9-]{1,64}$/;

/** Most recent first, capped. Eight is what the command palette can show. */
export const RECENT_LIMIT = 8;

/**
 * Favorites are user-driven, so there is no product reason to cap them — but an
 * unbounded list read from user-writable storage is an unbounded loop, so it is
 * bounded anyway.
 */
export const FAVORITE_LIMIT = 64;

/**
 * `localStorage` can throw on *access*, not just on write: Safari in private
 * mode historically threw on `setItem`, and a blocked-cookies setting throws on
 * the property lookup itself. Both paths end here, and both end as `null`.
 */
function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Parse a stored JSON array of slugs, discarding anything unexpected. */
function readSlugs(key: string, limit: number): string[] {
  const target = store();
  if (!target) return [];

  let raw: string | null = null;
  try {
    raw = target.getItem(key);
  } catch {
    return [];
  }
  if (raw === null || raw === '') return [];

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  // A hand-edited `"image-compressor"` (a bare string) or an object must not
  // become a one-item list by accident — it is not the shape we wrote.
  if (!Array.isArray(parsed)) return [];

  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    if (!SLUG_SHAPE.test(item)) continue;
    if (out.includes(item)) continue;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Persist a list. Returns false when storage refused it (quota, private mode). */
function writeSlugs(key: string, values: readonly string[]): boolean {
  const target = store();
  if (!target) return false;
  try {
    target.setItem(key, JSON.stringify(values));
  } catch {
    return false;
  }
  notify();
  return true;
}

/* ---------------------------------------------------------------------------
 * Change notification
 * ------------------------------------------------------------------------- */

type Listener = () => void;

const listeners = new Set<Listener>();
let windowListenerAttached = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function handleStorageEvent(event: StorageEvent): void {
  // `event.key` is null when the whole store was cleared, which is a change we
  // care about. Otherwise only our own namespace is interesting.
  if (event.key !== null && !event.key.startsWith(PREFIX)) return;
  notify();
}

/**
 * Subscribe to preference changes. Returns the unsubscribe function.
 *
 * The `storage` event fires in *other* tabs only — by specification, never in
 * the tab that wrote. That is exactly what keeps two open tabs in sync, and it
 * is also why {@link writeSlugs} notifies local listeners directly: without
 * that, a favorite toggled in the header would not update a star rendered
 * elsewhere on the same page.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);

  if (typeof window !== 'undefined' && !windowListenerAttached) {
    windowListenerAttached = true;
    window.addEventListener('storage', handleStorageEvent);
  }

  return () => {
    listeners.delete(listener);
  };
}

/* ---------------------------------------------------------------------------
 * Favorites
 * ------------------------------------------------------------------------- */

export function readFavorites(): string[] {
  return readSlugs(KEYS.favorites, FAVORITE_LIMIT);
}

export function isFavorite(slug: string): boolean {
  return readFavorites().includes(slug);
}

/**
 * Add or remove a favorite. Returns the list as it now stands — which is the
 * *unchanged* list when the slug is malformed or the write was refused, so a
 * caller that renders the return value can never show a star that was not
 * actually saved.
 */
export function toggleFavorite(slug: string): string[] {
  const current = readFavorites();
  if (!SLUG_SHAPE.test(slug)) return current;

  const next = current.includes(slug)
    ? current.filter((entry) => entry !== slug)
    : [slug, ...current].slice(0, FAVORITE_LIMIT);

  return writeSlugs(KEYS.favorites, next) ? next : current;
}

/* ---------------------------------------------------------------------------
 * Recently used
 * ------------------------------------------------------------------------- */

export function readRecentTools(): string[] {
  return readSlugs(KEYS.recents, RECENT_LIMIT);
}

/** Move a tool to the front of the recents list. Deduped, capped, newest first. */
export function pushRecentTool(slug: string): string[] {
  const current = readRecentTools();
  if (!SLUG_SHAPE.test(slug)) return current;

  const next = [slug, ...current.filter((entry) => entry !== slug)].slice(0, RECENT_LIMIT);
  if (next.length === current.length && next[0] === current[0]) return current;

  return writeSlugs(KEYS.recents, next) ? next : current;
}
