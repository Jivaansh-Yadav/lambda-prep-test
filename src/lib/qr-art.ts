// qr-art.ts
//
// Turns a QR module grid into SVG path data. Everything here works in *module*
// units — the caller supplies the viewBox — so the geometry is resolution
// independent and a single path can be filled with any paint (a gradient, in
// the share popup's case).
//
// The look is deliberately two-tone:
//
//   - data modules are squares with only their *exposed* corners rounded, so
//     neighbouring modules still merge into one continuous shape (rounding
//     every corner would leave a visible notch at each join);
//   - the three finder patterns are drawn as strongly rounded square rings with
//     a rounded centre dot, which is what makes the code read as "designed"
//     rather than squashed.
//
// The finder patterns are excluded from the data path and drawn separately,
// because they need a different radius than a single module can carry.

import type { QrMatrix } from "./qr-code";

export interface QrArt {
  /** Side length of the code in module units, quiet zone excluded. */
  size: number;
  /** `viewBox` covering the code plus a quiet zone of `quietZone` modules. */
  viewBox: string;
  /** Quiet zone width, in module units, baked into `viewBox`. */
  quietZone: number;
  /** All data modules as one path (adjacent modules share their edges). */
  body: string;
  /** Finder rings and centre dots, as two paths needing `fill-rule: evenodd`. */
  eyes: { rings: string; dots: string };
}

export interface QrArtOptions {
  /** Corner radius of a data module, in module units. 0 is square, 0.5 is a dot. */
  moduleRadius?: number;
  /** Quiet zone in module units. The QR spec asks for 4; 3 keeps the plate tight. */
  quietZone?: number;
  /** Corner radius of the finder patterns' outer square, in module units. */
  eyeRadius?: number;
}

/** Round to three decimals and drop the trailing zeros so paths stay short. */
function n(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** One rounded rectangle, with a radius per corner (0 emits a straight edge). */
function roundedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  radii: readonly [number, number, number, number],
): string {
  const [tl, tr, br, bl] = radii;
  let d = `M${n(x + tl)} ${n(y)}`;
  d += `H${n(x + width - tr)}`;
  if (tr > 0) d += `A${n(tr)} ${n(tr)} 0 0 1 ${n(x + width)} ${n(y + tr)}`;
  d += `V${n(y + height - br)}`;
  if (br > 0) d += `A${n(br)} ${n(br)} 0 0 1 ${n(x + width - br)} ${n(y + height)}`;
  d += `H${n(x + bl)}`;
  if (bl > 0) d += `A${n(bl)} ${n(bl)} 0 0 1 ${n(x)} ${n(y + height - bl)}`;
  d += `V${n(y + tl)}`;
  if (tl > 0) d += `A${n(tl)} ${n(tl)} 0 0 1 ${n(x + tl)} ${n(y)}`;
  return `${d}Z`;
}

/** True when a module is dark, treating everything off-grid as light. */
function isDark(matrix: QrMatrix, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= matrix.size || y >= matrix.size) return false;
  return matrix.modules[y]?.[x] === true;
}

/** The three 7x7 finder patterns, which are drawn on their own. */
function isFinderModule(size: number, x: number, y: number): boolean {
  const top = y < 7;
  const bottom = y >= size - 7;
  const left = x < 7;
  const right = x >= size - 7;
  return (top && left) || (top && right) || (bottom && left);
}

/** A 7x7 finder pattern: outer ring (with a hole) plus the 3x3 centre dot. */
function eyePaths(originX: number, originY: number, radius: number): { ring: string; dot: string } {
  const outer = roundedRect(originX, originY, 7, 7, [radius, radius, radius, radius]);
  const inner = roundedRect(originX + 1, originY + 1, 5, 5, [
    Math.max(radius - 1, 0.6),
    Math.max(radius - 1, 0.6),
    Math.max(radius - 1, 0.6),
    Math.max(radius - 1, 0.6),
  ]);
  const dot = roundedRect(originX + 2, originY + 2, 3, 3, [
    Math.max(radius - 1.2, 0.4),
    Math.max(radius - 1.2, 0.4),
    Math.max(radius - 1.2, 0.4),
    Math.max(radius - 1.2, 0.4),
  ]);
  return { ring: outer + inner, dot };
}

/**
 * Build the SVG geometry for a QR matrix.
 *
 * Reads the matrix in module space: a dark module at (x, y) occupies the square
 * from (x, y) to (x+1, y+1), and a corner is rounded only when both modules
 * sharing it are light — i.e. only where the shape actually has an outside
 * corner to round.
 */
export function qrArt(matrix: QrMatrix, options: QrArtOptions = {}): QrArt {
  const moduleRadius = options.moduleRadius ?? 0.42;
  const quietZone = options.quietZone ?? 3;
  const eyeRadius = options.eyeRadius ?? 2.1;
  const { size } = matrix;

  let body = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isDark(matrix, x, y)) continue;
      if (isFinderModule(size, x, y)) continue;

      const up = isDark(matrix, x, y - 1);
      const down = isDark(matrix, x, y + 1);
      const left = isDark(matrix, x - 1, y);
      const right = isDark(matrix, x + 1, y);

      // Clockwise from the top-left corner: a corner stays square wherever a
      // neighbour already covers it.
      body += roundedRect(x, y, 1, 1, [
        !up && !left ? moduleRadius : 0,
        !up && !right ? moduleRadius : 0,
        !down && !right ? moduleRadius : 0,
        !down && !left ? moduleRadius : 0,
      ]);
    }
  }

  const corners: Array<[number, number]> = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ];
  let rings = "";
  let dots = "";
  for (const [cornerX, cornerY] of corners) {
    const eye = eyePaths(cornerX, cornerY, eyeRadius);
    rings += eye.ring;
    dots += eye.dot;
  }

  return {
    size,
    quietZone,
    viewBox: `${-quietZone} ${-quietZone} ${size + quietZone * 2} ${size + quietZone * 2}`,
    body,
    eyes: { rings, dots },
  };
}
