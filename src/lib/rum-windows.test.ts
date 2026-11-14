import { describe, expect, it } from "vitest";
import { chunkWindows, RUM_CHUNK_MS } from "./rum-windows";

// Cloudflare's adaptive RUM datasets downsample a single query once the
// window grows past about a week, so 14d/30d used to disagree with 7d on the
// days they share. These slices are what make the ranges agree.

const DAY = 24 * 60 * 60 * 1000;
const END = Date.UTC(2026, 10, 14, 6, 0, 0);

const spanDays = (w: { since: Date; until: Date }) => (w.until.getTime() - w.since.getTime()) / DAY;

describe("chunkWindows", () => {
  it("returns a single slice for a window shorter than one chunk", () => {
    const windows = chunkWindows(END - DAY, END);
    expect(windows).toHaveLength(1);
    expect(spanDays(windows[0]!)).toBeCloseTo(1);
  });

  it("splits 14 days into two slices", () => {
    const windows = chunkWindows(END - 14 * DAY, END);
    expect(windows).toHaveLength(2);
  });

  it("splits 30 days into five slices, none longer than the chunk", () => {
    const windows = chunkWindows(END - 30 * DAY, END);
    expect(windows).toHaveLength(5);
    for (const w of windows) expect(spanDays(w)).toBeLessThanOrEqual(7);
  });

  it("covers the whole window without gaps or overlaps, oldest first", () => {
    const start = END - 30 * DAY;
    const windows = chunkWindows(start, END);
    expect(windows[0]!.since.getTime()).toBe(start);
    expect(windows.at(-1)!.until.getTime()).toBe(END);
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i]!.since.getTime()).toBe(windows[i - 1]!.until.getTime());
    }
  });

  it("never exceeds the chunk length", () => {
    for (const days of [1, 7, 8, 14, 30]) {
      for (const w of chunkWindows(END - days * DAY, END)) {
        expect(w.until.getTime() - w.since.getTime()).toBeLessThanOrEqual(RUM_CHUNK_MS);
      }
    }
  });

  it("returns nothing for an empty or inverted window", () => {
    expect(chunkWindows(END, END)).toEqual([]);
    expect(chunkWindows(END, END - DAY)).toEqual([]);
    expect(chunkWindows(Number.NaN, END)).toEqual([]);
  });
});
