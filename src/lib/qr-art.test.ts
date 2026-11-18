import { describe, expect, it } from "vitest";
import type { QrMatrix } from "./qr-code";
import { qrArt } from "./qr-art";

const SIZE = 21;

/** A version-1-sized grid of light modules, with the given ones switched on. */
function matrix(dark: Array<[number, number]>): QrMatrix {
  const modules = Array.from({ length: SIZE }, () => new Array<boolean>(SIZE).fill(false));
  for (const [x, y] of dark) modules[y]![x] = true;
  return { version: 1, size: SIZE, modules, mask: 0, ecc: "M" };
}

const subpaths = (path: string) => (path.match(/M/g) ?? []).length;
const arcs = (path: string) => (path.match(/A/g) ?? []).length;

describe("qrArt", () => {
  it("rounds all four corners of an isolated module", () => {
    const art = qrArt(matrix([[10, 10]]));
    expect(subpaths(art.body)).toBe(1);
    expect(arcs(art.body)).toBe(4);
  });

  it("leaves the corners square where two modules meet", () => {
    // Side by side: each module keeps the two corners on its free side and
    // drops the two that face its neighbour, so the pair reads as one shape.
    const art = qrArt(
      matrix([
        [10, 10],
        [11, 10],
      ]),
    );
    expect(subpaths(art.body)).toBe(2);
    expect(arcs(art.body)).toBe(4);
  });

  it("squares every corner where four modules meet", () => {
    const art = qrArt(
      matrix([
        [10, 10],
        [11, 10],
        [10, 11],
        [11, 11],
      ]),
    );
    expect(arcs(art.body)).toBe(4);
  });

  it("keeps the finder patterns out of the body and draws them separately", () => {
    // A full ring of dark modules around the top-left finder would be the worst
    // case: none of it may leak into the data path.
    const dark: Array<[number, number]> = [];
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) dark.push([i, j]);
    }
    dark.push([8, 8]);
    const art = qrArt(matrix(dark));
    expect(subpaths(art.body)).toBe(1);
    expect(subpaths(art.eyes.rings)).toBe(6); // three rings, each outer + hole
    expect(subpaths(art.eyes.dots)).toBe(3);
  });

  it("reserves a quiet zone around the code", () => {
    const art = qrArt(matrix([]), { quietZone: 4 });
    expect(art.viewBox).toBe("-4 -4 29 29");
    expect(qrArt(matrix([])).viewBox).toBe("-3 -3 27 27");
  });

  it("turns to dots when the radius reaches half a module", () => {
    const square = qrArt(matrix([[10, 10]]), { moduleRadius: 0 });
    const round = qrArt(matrix([[10, 10]]), { moduleRadius: 0.5 });
    expect(arcs(square.body)).toBe(0); // straight edges only
    expect(round.body).toContain("A0.5 0.5");
  });
});
