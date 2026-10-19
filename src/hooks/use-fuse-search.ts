import Fuse, { type IFuseOptions } from 'fuse.js';
import { useEffect, useMemo, useState } from 'react';

const DEFAULT_OPTIONS: IFuseOptions<unknown> = {
  threshold: 0.35,
  ignoreLocation: true,
};

// Fast typing shouldn't run a full fuzzy search per keystroke: a subject's
// file list can hold 800+ items, and `fuse.search` + the resulting re-render
// are both synchronous main-thread work. 100ms is short enough that results
// still feel immediate once you pause, but collapses a burst of keystrokes
// into one search. Only the *search* is delayed — the input is bound to its
// own state, so typing stays at full speed.
const DEFAULT_DEBOUNCE_MS = 100;

/** Returns `value` only after it has stopped changing for `delay` ms. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delay <= 0) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * Fuzzy-filters `items` by `query` using Fuse.js, returning the full list
 * unchanged when the query is empty/whitespace.
 *
 * The query is debounced (see `debounceMs`) before it reaches `fuse.search`,
 * so a fast typist triggers one search when they pause rather than one per
 * character.
 *
 * `keys` must be referentially stable array (define it as a module-level
 * constant at the call site) — it's a dependency of the memoized Fuse
 * index, so a fresh array literal on every render would rebuild the index
 * on every render too.
 */
export function useFuseSearch<T>(
  items: readonly T[],
  keys: readonly string[],
  query: string,
  debounceMs: number = DEFAULT_DEBOUNCE_MS
): T[] {
  const fuse = useMemo(
    () => new Fuse(items as T[], { ...DEFAULT_OPTIONS, keys: keys as string[] }),
    [items, keys]
  );

  const trimmed = query.trim();
  const debouncedQuery = useDebouncedValue(trimmed, debounceMs);
  // Clearing the box should restore the full list immediately rather than
  // showing the last filtered results for another 100ms.
  const effectiveQuery = trimmed === '' ? '' : debouncedQuery;

  return useMemo(() => {
    if (!effectiveQuery) return items as T[];
    return fuse.search(effectiveQuery).map(result => result.item);
  }, [fuse, effectiveQuery, items]);
}
