/**
 * One fixed timezone for every admin chart axis.
 *
 * Why fixed: Cloudflare's RUM buckets are UTC hour starts (`datetimeHour`) and
 * UTC calendar days (`date`). Rendering them with `toLocaleTimeString` used the
 * *viewer's* zone, so the same bucket read "12 PM" for one admin and "5 PM" for
 * another in IST, and day labels could slide a date backwards in
 * negative-offset zones (`new Date("2026-11-12")` is UTC midnight).
 *
 * Why UTC rather than a local zone: buckets fall exactly on UTC hour
 * boundaries, so every tick is a real bucket edge. A +05:30 zone would label
 * the 12:00Z bucket "5:30 PM" and round it to "5 PM" on the axis — a half-hour
 * lie per tick. Change this one value to switch (e.g. "Asia/Kolkata") and the
 * caption text follows it.
 */
export const ADMIN_CHART_TIMEZONE = "UTC";

/** Short suffix printed under the chart so a label is never ambiguous. */
export const ADMIN_CHART_TIMEZONE_LABEL = ADMIN_CHART_TIMEZONE === "UTC" ? "UTC" : ADMIN_CHART_TIMEZONE;

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  timeZone: ADMIN_CHART_TIMEZONE,
});

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: ADMIN_CHART_TIMEZONE,
});

const tooltipHourFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: ADMIN_CHART_TIMEZONE,
});

const tooltipDayFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: ADMIN_CHART_TIMEZONE,
});

/** "12 PM" — axis tick for an hourly bucket. */
export function formatHourLabel(iso: string): string {
  return hourFormatter.format(new Date(iso));
}

/** "Nov 12" — axis tick for a calendar-day bucket. */
export function formatDayLabel(iso: string): string {
  return dayFormatter.format(new Date(iso));
}

/** Tooltip heading: full timestamp for hours, date only for days. */
export function formatBucketTooltip(iso: string, hourly: boolean): string {
  const date = new Date(iso);
  return (hourly ? tooltipHourFormatter : tooltipDayFormatter).format(date);
}

const clockFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: ADMIN_CHART_TIMEZONE,
});

/** "04:06" — the "Live / Cached" stamp, on the same clock as the axis. */
export function formatClockLabel(iso: string): string {
  return clockFormatter.format(new Date(iso));
}
