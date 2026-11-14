import { describe, expect, it } from "vitest";
import {
  formatBucketTooltip,
  formatClockLabel,
  formatDayLabel,
  formatHourLabel,
  ADMIN_CHART_TIMEZONE,
} from "./chart-time";

// These labels used to come from toLocaleString, so the same bucket read
// "12 PM" for a UTC viewer and "5 PM" for an IST one. They are now pinned to
// one zone, which is what these assertions protect.

describe("chart time labels", () => {
  it("pins the axis to one timezone", () => {
    expect(ADMIN_CHART_TIMEZONE).toBe("UTC");
  });

  it("formats an hourly bucket from its UTC hour", () => {
    expect(formatHourLabel("2026-11-13T12:00:00Z")).toBe("12 PM");
    expect(formatHourLabel("2026-11-13T04:00:00Z")).toBe("4 AM");
    expect(formatHourLabel("2026-11-13T00:00:00Z")).toBe("12 AM");
  });

  it("formats a calendar-day bucket without sliding a date", () => {
    // Parsed as UTC midnight — a local-zone formatter would print Nov 11 here
    // for any viewer west of Greenwich.
    expect(formatDayLabel("2026-11-12")).toBe("Nov 12");
    expect(formatDayLabel("2026-11-01")).toBe("Nov 1");
  });

  it("shows the full timestamp in the hourly tooltip", () => {
    expect(formatBucketTooltip("2026-11-13T12:00:00Z", true)).toBe("Nov 13, 12:00 PM");
  });

  it("shows just the date in the daily tooltip", () => {
    expect(formatBucketTooltip("2026-11-13", false)).toBe("Nov 13, 2026");
  });

  it("stamps the Live/Cached clock on the same zone", () => {
    expect(formatClockLabel("2026-11-14T04:06:39.009Z")).toBe("04:06");
    expect(formatClockLabel("2026-11-14T19:45:00.000Z")).toBe("19:45");
  });
});
