// admin-ranges.ts
//
// The four lookback windows the admin analytics panels share. Pure
// constants + helpers so both the client (labels, selector order) and the
// server (queries) read from one list, and so the window maths can be
// unit tested without a database or a Cloudflare credential.
//
// "24h" is the default everywhere: the dashboard is a "what is happening
// now" surface, and a month-wide default made every number read as
// background noise.

export const ADMIN_RANGES = ["24h", "7d", "14d", "30d"] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];

/** Default window for every analytics panel, chart and stats table. */
export const ADMIN_DEFAULT_RANGE: AdminRange = "24h";

export function isAdminRange(value: unknown): value is AdminRange {
  return typeof value === "string" && (ADMIN_RANGES as readonly string[]).includes(value);
}

/** Milliseconds of lookback, for tables keyed by a real timestamp
 * (traffic hours, RUM days, ratings, feedback, shares). */
export const RANGE_WINDOW_MS: Record<AdminRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Whole calendar days of lookback, for tables that only store a day
 * bucket (`resource_daily_views`). Counted inclusively of today, so 24h
 * means "the current IST day" — the finest granularity that table has. */
export const RANGE_DAY_COUNT: Record<AdminRange, number> = {
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

export const ADMIN_RANGE_LABEL: Record<AdminRange, string> = {
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
};

/** Start of the window, as a Date — the `$1::timestamptz` every
 * timestamp-keyed query filters on. */
export function rangeStart(range: AdminRange, now: number = Date.now()): Date {
  return new Date(now - RANGE_WINDOW_MS[range]);
}
