/**
 * Sorting for the resource-stats tables (ratings / feedback / views / shares).
 *
 * Comparison is deliberately narrow: numbers compare numerically, everything
 * else compares as a locale string with numeric awareness ("Chapter 2" before
 * "Chapter 10"), and a missing value always sinks to the bottom instead of
 * pretending to be zero or the epoch — a file with no timestamp should not
 * out-rank one that was genuinely touched a minute ago.
 */

export type SortDir = "asc" | "desc";

export type SortState<K extends string = string> = { key: K; dir: SortDir };

export function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Copies and sorts `rows` by whichever column `sort.key` names. Unknown keys
 * leave the incoming order (the server's own ordering) untouched. */
export function sortRows<T>(
  rows: T[],
  sort: SortState,
  columns: Record<string, (row: T) => string | number | null>
): T[] {
  const value = columns[sort.key];
  if (!value) return rows;
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = compareValues(av, bv);
    return sort.dir === "desc" ? -cmp : cmp;
  });
}

/** Timestamp → sortable number, with a day-only fallback ("2026-11-18") and a
 * floor for unparseable/absent values. */
export function timeValue(...candidates: Array<string | null | undefined>): number | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}
