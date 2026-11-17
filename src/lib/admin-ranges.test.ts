import { describe, expect, it } from "vitest";
import {
  ADMIN_DEFAULT_RANGE,
  ADMIN_RANGES,
  ADMIN_RANGE_LABEL,
  RANGE_DAY_COUNT,
  RANGE_WINDOW_MS,
  isAdminRange,
  rangeStart,
} from "./admin-ranges";

describe("admin analytics ranges", () => {
  it("defaults to 24h, not the old 30d", () => {
    expect(ADMIN_DEFAULT_RANGE).toBe("24h");
    expect(ADMIN_RANGES[0]).toBe(ADMIN_DEFAULT_RANGE);
  });

  it("labels every range and keeps the list ordered narrow to wide", () => {
    for (const range of ADMIN_RANGES) {
      expect(ADMIN_RANGE_LABEL[range]).toMatch(/^last /);
    }
    const windows = ADMIN_RANGES.map((r) => RANGE_WINDOW_MS[r]);
    expect(windows).toEqual([...windows].sort((a, b) => a - b));
  });

  it("counts whole days only for the day-bucketed tables", () => {
    expect(RANGE_DAY_COUNT["24h"]).toBe(1);
    expect(RANGE_DAY_COUNT["30d"]).toBe(RANGE_WINDOW_MS["30d"] / (24 * 60 * 60 * 1000));
  });

  it("rangeStart moves back exactly one window from now", () => {
    const now = Date.UTC(2026, 10, 17, 12, 0, 0);
    expect(rangeStart("24h", now).toISOString()).toBe("2026-11-16T12:00:00.000Z");
    expect(rangeStart("7d", now).toISOString()).toBe("2026-11-10T12:00:00.000Z");
  });

  it("rejects anything that is not a known range", () => {
    expect(isAdminRange("24h")).toBe(true);
    expect(isAdminRange("90d")).toBe(false);
    expect(isAdminRange(undefined)).toBe(false);
    expect(isAdminRange(7)).toBe(false);
  });
});
