/**
 * One fixed timezone for every time label on the site.
 *
 * Why fixed: Cloudflare's RUM buckets are UTC hour starts and UTC calendar
 * days, Postgres hands back timestamptz values, and Drive returns ISO strings.
 * Rendering any of those with `toLocaleString` used the *viewer's* zone, so the
 * same moment read "12 PM" for one admin and "5 PM" for another, and day-only
 * values ("2026-11-12", which parse as UTC midnight) slid back a date for any
 * viewer west of Greenwich.
 *
 * Why Asia/Kolkata: the audience and whoever reads this dashboard are in India,
 * so IST is the clock everything is discussed in. The cost is that Cloudflare's
 * hourly buckets start on the UTC hour, so in IST they land on :30 —
 * `formatHourLabel` prints the minutes ("5:30 PM") rather than rounding to
 * "5 PM" and quietly mislabelling the tick.
 *
 * Every timestamp rendered anywhere in the app goes through this module; no
 * component should call toLocaleDateString/toLocaleTimeString on one.
 */
export const SITE_TIMEZONE = "Asia/Kolkata";

/** Short suffix printed next to a time so a label is never ambiguous. */
export const SITE_TIMEZONE_LABEL = "IST";

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: SITE_TIMEZONE,
});

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: SITE_TIMEZONE,
});

const tooltipHourFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: SITE_TIMEZONE,
});

const tooltipDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: SITE_TIMEZONE,
});

const momentFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: SITE_TIMEZONE,
});

const clockFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: SITE_TIMEZONE,
});

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "5:30 PM" — axis tick for an hourly bucket (keeps the UTC-hour :30 offset). */
export function formatHourLabel(iso: string): string {
  const date = toDate(iso);
  return date ? hourFormatter.format(date) : "—";
}

/** "Nov 12" — axis tick for a calendar-day bucket. */
export function formatDayLabel(iso: string): string {
  const date = toDate(iso);
  return date ? dayFormatter.format(date) : "—";
}

/** Tooltip heading: full timestamp for hours, date only for days. */
export function formatBucketTooltip(iso: string, hourly: boolean): string {
  const date = toDate(iso);
  if (!date) return "—";
  return (hourly ? tooltipHourFormatter : tooltipDayFormatter).format(date);
}

/** "Nov 18, 2026, 2:14 PM IST" — one exact moment, e.g. a table cell. */
export function formatMomentLabel(iso: string): string {
  const date = toDate(iso);
  return date ? `${momentFormatter.format(date)} ${SITE_TIMEZONE_LABEL}` : "—";
}

/** "9:36 AM" — the "Live / Cached" stamp, on the same clock as the axis. */
export function formatClockLabel(iso: string): string {
  const date = toDate(iso);
  return date ? clockFormatter.format(date) : "—";
}
