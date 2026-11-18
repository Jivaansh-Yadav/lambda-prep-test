import { describe, expect, it } from "vitest";
import {
  formatBucketTooltip,
  formatClockLabel,
  formatDayLabel,
  formatHourLabel,
  formatMomentLabel,
  SITE_TIMEZONE,
  SITE_TIMEZONE_LABEL,
} from "./time-labels";

// These labels used to come from toLocaleString, so the same bucket read
// "12 PM" for a UTC viewer and "5 PM" for an IST one. They are now pinned to
// IST for everyone, which is what these assertions protect.

describe("site time labels", () => {
  it("pins every label to IST", () => {
    expect(SITE_TIMEZONE).toBe("Asia/Kolkata");
    expect(SITE_TIMEZONE_LABEL).toBe("IST");
  });

  it("formats an hourly bucket on the IST clock, minutes included", () => {
    // Cloudflare buckets start on the UTC hour, i.e. :30 in IST — the tick
    // has to say so instead of rounding to "5 PM".
    expect(formatHourLabel("2026-11-13T12:00:00Z")).toBe("5:30 PM");
    expect(formatHourLabel("2026-11-13T04:00:00Z")).toBe("9:30 AM");
    // 18:30Z is exactly midnight IST the next day.
    expect(formatHourLabel("2026-11-13T18:30:00Z")).toBe("12:00 AM");
  });

  it("formats a calendar-day bucket without sliding a date", () => {
    // Parsed as UTC midnight, i.e. 05:30 IST the same day.
    expect(formatDayLabel("2026-11-12")).toBe("Nov 12");
    expect(formatDayLabel("2026-11-01")).toBe("Nov 1");
  });

  it("shows the full timestamp in the hourly tooltip", () => {
    expect(formatBucketTooltip("2026-11-13T12:00:00Z", true)).toBe("Nov 13, 5:30 PM");
  });

  it("shows just the date in the daily tooltip", () => {
    expect(formatBucketTooltip("2026-11-13", false)).toBe("Nov 13, 2026");
  });

  it("stamps an exact moment with the zone suffix", () => {
    expect(formatMomentLabel("2026-11-18T08:44:47.716Z")).toBe("Nov 18, 2026, 2:14 PM IST");
  });

  it("stamps the Live/Cached clock on the same zone", () => {
    expect(formatClockLabel("2026-11-14T04:06:39.009Z")).toBe("9:36 AM");
    expect(formatClockLabel("2026-11-14T19:45:00.000Z")).toBe("1:15 AM");
  });

  it("degrades to an em dash on garbage input", () => {
    expect(formatMomentLabel("not a date")).toBe("—");
    expect(formatDayLabel("")).toBe("—");
  });
});
