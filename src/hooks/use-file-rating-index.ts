import { useEffect, useSyncExternalStore } from 'react';
import { getResourceRatingsIndex, type FileRatingEntry, type FileRatingIndex } from '@/lib/ratings-server';

/**
 * Shared, module-level store for "which files have a rating, and what is it?"
 *
 * The file grid can hold thousands of cards (virtualized or not) but only a
 * handful of files have ever been rated, so the whole rated set is fetched
 * once per page load and kept in memory instead of per-card requests. Cards
 * subscribe to the store with useSyncExternalStore, which means:
 *
 *   - landing on a resources page costs ONE request, no matter how many
 *     cards render;
 *   - a rating submitted from the file viewer (see refreshFileRatingIndex)
 *     repaints every badge showing that file, including in the sidebar;
 *   - navigating between classes/subjects reuses the cache instead of
 *     re-fetching on every route change.
 *
 * A stable `EMPTY` snapshot is returned during SSR and before the first
 * fetch resolves, so no card renders a placeholder badge in the meantime.
 */
const EMPTY: FileRatingIndex = {};

let snapshot: FileRatingIndex = EMPTY;
let loadPromise: Promise<void> | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): FileRatingIndex {
  return snapshot;
}

/** Starts the one-time index fetch (idempotent — concurrent callers share
 * the same in-flight promise). Failures are logged and swallowed: a missing
 * badge is a cosmetic loss, never worth surfacing an error to the viewer or
 * retrying in a loop. */
export function ensureFileRatingIndex() {
  if (loaded || loadPromise) return;
  loadPromise = getResourceRatingsIndex()
    .then((index) => {
      snapshot = index;
      loaded = true;
      emit();
    })
    .catch((error) => {
      console.error('[resource-ratings] failed to load rating index', error);
    })
    .finally(() => {
      loadPromise = null;
    });
}

/** Re-fetches the index after this browser submits/updates a rating, so the
 * card badges reflect the vote immediately rather than on the next reload. */
export function refreshFileRatingIndex() {
  loaded = false;
  loadPromise = null;
  ensureFileRatingIndex();
}

/** Subscribes a component to the rating index and kicks off the fetch on
 * first mount. Returns the whole map; use `getFileRating` for one id. */
export function useFileRatingIndex(): FileRatingIndex {
  const index = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(ensureFileRatingIndex, []);
  return index;
}

/** One file's rating, or undefined when the file has never been rated. */
export function getFileRating(index: FileRatingIndex, fileId: string): FileRatingEntry | undefined {
  return index[fileId];
}
