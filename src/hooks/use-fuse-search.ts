import Fuse, { type IFuseOptions } from 'fuse.js';
import { useMemo } from 'react';

const DEFAULT_OPTIONS: IFuseOptions<unknown> = {
  threshold: 0.35,
  ignoreLocation: true,
};

/**
 * Fuzzy-filters `items` by `query` using Fuse.js, returning the full list
 * unchanged when the query is empty/whitespace.
 *
 * `keys` must be a referentially stable array (define it as a module-level
 * constant at the call site) — it's a dependency of the memoized Fuse
 * index, so a fresh array literal on every render would rebuild the index
 * on every render too.
 */
export function useFuseSearch<T>(items: readonly T[], keys: readonly string[], query: string): T[] {
  const fuse = useMemo(
    () => new Fuse(items as T[], { ...DEFAULT_OPTIONS, keys: keys as string[] }),
    [items, keys]
  );
  return useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return items as T[];
    return fuse.search(trimmed).map(result => result.item);
  }, [fuse, query, items]);
}
