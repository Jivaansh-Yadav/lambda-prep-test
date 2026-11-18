import { describe, expect, it } from "vitest";
import { encodeQr, type QrMatrix } from "./qr-code";

/**
 * Reference matrix for `hi` at version 1 / level M / mask 0, produced by an
 * independent encoder (python-qrcode) and pasted here as a fixture. If this
 * stops matching, the encoder is wrong — not the fixture.
 */
const REFERENCE_HI_MASK0 = [
  "111111100001101111111",
  "100000101111001000001",
  "101110100011101011101",
  "101110100101001011101",
  "101110101111101011101",
  "100000100101001000001",
  "111111101010101111111",
  "000000000010000000000",
  "101010100110100010010",
  "101100000011010101111",
  "000010111011011101111",
  "001011010101110111010",
  "110100101111011100100",
  "000000001000001000111",
  "111111100100100010011",
  "100000100110001000111",
  "101110101110101010101",
  "101110100111010101010",
  "101110101111011101101",
  "100000100111110111010",
  "111111101101011101111",
];

const render = (matrix: QrMatrix) =>
  matrix.modules.map((row) => row.map((module) => (module ? "1" : "0")).join(""));

const DOXXMARKS_URL =
  "https://lambda-prep.pages.dev/doxxmarks?class=class-10&subject=Computer%20Applications&chapter=3&note=4";

describe("encodeQr", () => {
  it("produces the reference matrix for a known payload", () => {
    const qr = encodeQr("hi", { ecc: "M", mask: 0 });
    expect(qr.version).toBe(1);
    expect(qr.size).toBe(21);
    expect(render(qr)).toEqual(REFERENCE_HI_MASK0);
  });

  it("is deterministic across calls, mask included", () => {
    const first = encodeQr(DOXXMARKS_URL);
    const second = encodeQr(DOXXMARKS_URL);
    expect(second.mask).toBe(first.mask);
    expect(render(second)).toEqual(render(first));
  });

  it("draws the three finder patterns", () => {
    const { modules, size } = encodeQr(DOXXMARKS_URL);
    const corners: Array<[number, number]> = [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ];
    for (const [x, y] of corners) {
      // Outer 7-module ring dark, one-module gap, 3-module core dark.
      expect(modules[y]?.slice(x, x + 7)).toEqual([true, true, true, true, true, true, true]);
      expect(modules[y + 1]?.slice(x, x + 7)).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
        true,
      ]);
      expect(modules[y + 2]?.slice(x + 2, x + 5)).toEqual([true, true, true]);
    }

    // The module below the top-left separator is always dark.
    expect(modules[size - 8]?.[8]).toBe(true);
  });

  it("alternates the timing patterns", () => {
    const { modules, size } = encodeQr(DOXXMARKS_URL);
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6]?.[i]).toBe(i % 2 === 0);
      expect(modules[i]?.[6]).toBe(i % 2 === 0);
    }
  });

  it("grows the version to fit the payload", () => {
    const short = encodeQr("https://lambda-prep.pages.dev/drive", { ecc: "M" });
    const long = encodeQr(`${DOXXMARKS_URL}&pad=${"z".repeat(120)}`, { ecc: "M" });
    expect(short.version).toBeLessThan(long.version);
    expect(long.size).toBe(long.version * 4 + 17);
  });

  it("needs a bigger version for stronger error correction", () => {
    const atM = encodeQr(DOXXMARKS_URL, { ecc: "M" });
    const atH = encodeQr(DOXXMARKS_URL, { ecc: "H" });
    expect(atH.ecc).toBe("H");
    expect(atH.version).toBeGreaterThan(atM.version);
  });

  it("refuses a payload no version can hold", () => {
    expect(() => encodeQr("x".repeat(3000), { ecc: "M" })).toThrow(RangeError);
  });
});
