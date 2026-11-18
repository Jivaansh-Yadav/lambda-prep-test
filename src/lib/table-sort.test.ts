import { describe, expect, it } from "vitest";
import { compareValues, sortRows, timeValue } from "./table-sort";

type Row = { name: string; count: number | null; at: string | null };

const rows: Row[] = [
  { name: "Beta", count: 3, at: "2026-11-18T08:00:00Z" },
  { name: "alpha", count: 10, at: "2026-11-18T10:00:00Z" },
  { name: "Gamma", count: null, at: null },
  { name: "Delta", count: 3, at: "2026-11-18T09:00:00Z" },
];

const columns = {
  file: (r: Row) => r.name,
  count: (r: Row) => r.count,
  at: (r: Row) => timeValue(r.at),
};

describe("sortRows", () => {
  it("defaults the caller to newest first when they ask for it", () => {
    const sorted = sortRows(rows, { key: "at", dir: "desc" }, columns);
    expect(sorted.map((r) => r.name)).toEqual(["alpha", "Delta", "Beta", "Gamma"]);
  });

  it("flips direction without losing rows", () => {
    const sorted = sortRows(rows, { key: "at", dir: "asc" }, columns);
    expect(sorted.map((r) => r.name)).toEqual(["Beta", "Delta", "alpha", "Gamma"]);
  });

  it("keeps nulls at the bottom in both directions", () => {
    const desc = sortRows(rows, { key: "count", dir: "desc" }, columns);
    const asc = sortRows(rows, { key: "count", dir: "asc" }, columns);
    expect(desc.at(-1)?.name).toBe("Gamma");
    expect(asc.at(-1)?.name).toBe("Gamma");
    expect(desc[0]?.name).toBe("alpha");
    expect(asc[0]?.name).toBe("Beta");
  });

  it("compares names case-insensitively and numerically", () => {
    const named = [
      { name: "Chapter 10" },
      { name: "chapter 2" },
      { name: "Alpha" },
    ];
    const sorted = sortRows(named, { key: "file", dir: "asc" }, { file: (r) => r.name });
    expect(sorted.map((r) => r.name)).toEqual(["Alpha", "chapter 2", "Chapter 10"]);
  });

  it("leaves the order alone for an unknown column, and never mutates the input", () => {
    const before = rows.map((r) => r.name);
    const sorted = sortRows(rows, { key: "nope", dir: "desc" }, columns);
    expect(sorted).toBe(rows);
    sortRows(rows, { key: "at", dir: "desc" }, columns);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("timeValue", () => {
  it("parses timestamps and falls back through day-only values", () => {
    expect(timeValue("2026-11-18T08:00:00Z")).toBe(Date.parse("2026-11-18T08:00:00Z"));
    expect(timeValue(null, "2026-11-18")).toBe(Date.parse("2026-11-18"));
  });

  it("returns null when there is nothing to parse", () => {
    expect(timeValue(null, undefined, "")).toBeNull();
    expect(timeValue("not a date")).toBeNull();
  });
});

describe("compareValues", () => {
  it("sorts numbers numerically and strings by locale", () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues("a", "b")).toBeLessThan(0);
  });
});
