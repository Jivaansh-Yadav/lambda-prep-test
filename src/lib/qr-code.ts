// qr-code.ts
//
// A small, self-contained QR Code encoder (byte mode, versions 1-40, all four
// error-correction levels). It exists so the share popup can draw a scannable
// code for a resource link without pulling in a QR library and its transitive
// weight for what is ultimately ~300 lines of bit twiddling.
//
// The pipeline is the one from ISO/IEC 18004, in order:
//
//   1. pick the smallest version whose data capacity fits the UTF-8 payload
//   2. build the bit stream (mode indicator, character count, bytes, padding)
//   3. split into blocks, add Reed-Solomon error-correction codewords, interleave
//   4. place the codewords in the zigzag pattern around the function patterns
//   5. try all eight masks, keep the one with the lowest penalty score
//
// `encodeQr()` returns the finished module grid; drawing it is `qr-art.ts`'s
// problem, not this file's.

import { ALIGNMENT_POSITIONS, EC_BLOCKS } from "./qr-tables";

export type QrEccLevel = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  /** QR version (1-40). The grid is `17 + 4 * version` modules across. */
  version: number;
  /** Side length in modules, including the quiet zone this encoder does NOT add. */
  size: number;
  /** Row-major flags: `modules[y][x]` is true where the module is dark. */
  modules: boolean[][];
  /** Mask pattern (0-7) that scored lowest. Exposed for tests and debugging. */
  mask: number;
  /** Error-correction level the code was built with. */
  ecc: QrEccLevel;
}

/** Mode indicator for 8-bit byte data, the only mode this encoder emits. */
const MODE_BYTE = 0b0100;

/** Format-information bits for each level (the 2-bit field, not the 15-bit code). */
const ECC_FORMAT_BITS: Record<QrEccLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

const MAX_VERSION = 40;

// ---------------------------------------------------------------------------
// Galois field GF(256) — the arithmetic Reed-Solomon runs on, with 0x11D as the
// primitive polynomial. Tables are built once on first use.
// ---------------------------------------------------------------------------

let gfExp: Uint8Array | null = null;
let gfLog: Uint8Array | null = null;

function galoisTables(): { exp: Uint8Array; log: Uint8Array } {
  if (!gfExp || !gfLog) {
    const exp = new Uint8Array(512);
    const log = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i++) {
      exp[i] = x;
      log[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    // Mirror the first 255 entries so multiplication can index past 254
    // without a modulo in the hot loop.
    for (let i = 255; i < 512; i++) exp[i] = exp[i - 255] as number;
    gfExp = exp;
    gfLog = log;
  }
  return { exp: gfExp, log: gfLog };
}

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  const { exp, log } = galoisTables();
  return exp[(log[a] as number) + (log[b] as number)] as number;
}

const divisorCache = new Map<number, Uint8Array>();

/** Generator polynomial for `degree` error-correction codewords, highest term first. */
function reedSolomonDivisor(degree: number): Uint8Array {
  const cached = divisorCache.get(degree);
  if (cached) return cached;
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j] as number, root);
      if (j + 1 < degree) result[j] = (result[j] as number) ^ (result[j + 1] as number);
    }
    root = gfMultiply(root, 0x02);
  }
  divisorCache.set(degree, result);
  return result;
}

/** The `degree`-long remainder of `data` divided by the generator polynomial. */
function reedSolomonRemainder(data: Uint8Array, degree: number): Uint8Array {
  const divisor = reedSolomonDivisor(degree);
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ (result[0] as number);
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i++) {
      result[i] = (result[i] as number) ^ gfMultiply(divisor[i] as number, factor);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Version / capacity arithmetic
// ---------------------------------------------------------------------------

/** Bits in the byte-mode character count field, which grows at version 10. */
function charCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

interface BlockLayout {
  /** Data codewords per block, in standard group order. */
  groups: ReadonlyArray<readonly [number, number, number]>;
  /** Total data codewords available to the bit stream. */
  dataCodewords: number;
}

function blockLayout(version: number, ecc: QrEccLevel): BlockLayout {
  const groups = EC_BLOCKS[ecc][version - 1];
  if (!groups) throw new RangeError(`No QR block layout for version ${version}`);
  let dataCodewords = 0;
  for (const [blocks, dataPerBlock] of groups) dataCodewords += blocks * dataPerBlock;
  return { groups, dataCodewords };
}

/** Smallest version that can hold `byteLength` bytes at this level, or 0. */
function chooseVersion(byteLength: number, ecc: QrEccLevel): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const capacityBits = blockLayout(version, ecc).dataCodewords * 8;
    const neededBits = 4 + charCountBits(version) + byteLength * 8;
    if (neededBits <= capacityBits) return version;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Bit stream
// ---------------------------------------------------------------------------

/** Append-only big-endian bit writer; `push` takes the low `count` bits of `value`. */
class BitBuffer {
  private readonly bits: number[] = [];

  push(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, index) => {
      if (bit) bytes[index >> 3] = (bytes[index >> 3] as number) | (0x80 >> (index & 7));
    });
    return bytes;
  }
}

function buildDataCodewords(bytes: Uint8Array, version: number, ecc: QrEccLevel): Uint8Array {
  const { dataCodewords } = blockLayout(version, ecc);
  const buffer = new BitBuffer();
  buffer.push(MODE_BYTE, 4);
  buffer.push(bytes.length, charCountBits(version));
  for (const byte of bytes) buffer.push(byte, 8);

  const capacityBits = dataCodewords * 8;
  // Terminator: up to four zero bits, whichever is shorter.
  buffer.push(0, Math.min(4, capacityBits - buffer.length));
  // Pad to a byte boundary, then alternate the two mandated pad codewords.
  buffer.push(0, (8 - (buffer.length % 8)) % 8);
  for (let pad = 0xec; buffer.length < capacityBits; pad ^= 0xec ^ 0x11) buffer.push(pad, 8);

  return buffer.toBytes();
}

/** Interleave the data blocks with their error-correction blocks, per the spec. */
function interleaveWithEcc(data: Uint8Array, version: number, ecc: QrEccLevel): Uint8Array {
  const { groups } = blockLayout(version, ecc);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const [blocks, dataPerBlock, ecPerBlock] of groups) {
    for (let i = 0; i < blocks; i++) {
      const block = data.subarray(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      dataBlocks.push(block);
      ecBlocks.push(reedSolomonRemainder(block, ecPerBlock));
    }
  }

  const result = new Uint8Array(offset + ecBlocks.length * (ecBlocks[0]?.length ?? 0));
  let cursor = 0;
  const longestData = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < longestData; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result[cursor++] = block[i] as number;
    }
  }
  const longestEc = Math.max(...ecBlocks.map((block) => block.length));
  for (let i = 0; i < longestEc; i++) {
    for (const block of ecBlocks) {
      if (i < block.length) result[cursor++] = block[i] as number;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

/** Row/column centres of the alignment patterns for a version (empty for v1). */
function alignmentPositions(version: number): ReadonlyArray<number> {
  return ALIGNMENT_POSITIONS[version - 1] ?? [];
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return false;
  }
}

/** BCH(15,5) format information for an error level and mask, XOR-masked per spec. */
function formatBits(ecc: QrEccLevel, mask: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

/** BCH(18,6) version information, only present from version 7 up. */
function versionBits(version: number): number {
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

class MatrixBuilder {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];

  constructor(version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.isFunction = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  setFunction(x: number, y: number, dark: boolean): void {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  /** Finder pattern plus its light separator, drawn as a Chebyshev-norm ring. */
  drawFinder(centreX: number, centreY: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = centreX + dx;
        const y = centreY + dy;
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  drawAlignment(centreX: number, centreY: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(centreX + dx, centreY + dy, distance !== 1);
      }
    }
  }

  drawFunctionPatterns(version: number): void {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const positions = alignmentPositions(version);
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        // The three corners are already occupied by finder patterns.
        const atFinder =
          (i === 0 && j === 0) ||
          (i === 0 && j === positions.length - 1) ||
          (i === positions.length - 1 && j === 0);
        if (!atFinder) this.drawAlignment(positions[i] as number, positions[j] as number);
      }
    }

    // Reserve the format areas now so data placement skips them; the real bits
    // are written once the mask is known.
    this.drawFormat("M", 0);
    if (version >= 7) this.drawVersion(version);
  }

  drawFormat(ecc: QrEccLevel, mask: number): void {
    const bits = formatBits(ecc, mask);
    const bit = (index: number) => ((bits >>> index) & 1) !== 0;

    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, bit(i));
    // The always-dark module, below the top-left finder's separator.
    this.setFunction(8, this.size - 8, true);
  }

  drawVersion(version: number): void {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  /** Two-module-wide columns walked right to left, alternating direction. */
  drawCodewords(codewords: Uint8Array): void {
    let index = 0;
    const totalBits = codewords.length * 8;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          const module = this.modules[y]!;
          if (!this.isFunction[y]![x] && index < totalBits) {
            module[x] = (((codewords[index >> 3] as number) >>> (7 - (index & 7))) & 1) !== 0;
            index++;
          }
          // Any modules left over are the version's remainder bits: left light.
        }
      }
    }
  }

  /** XOR the mask over every non-function module (both ways: apply = unapply). */
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y]![x]) continue;
        if (maskApplies(mask, x, y)) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  /**
   * The four penalty rules from the spec, lower is better. Rule 3 is scored by
   * scanning each row and column (padded with a light border) for the two
   * 1:1:3:1:1 finder-shaped runs, which is what the standard describes.
   */
  penalty(): number {
    const size = this.size;
    let score = 0;

    for (let y = 0; y < size; y++) {
      let runColour = this.modules[y]![0]!;
      let runLength = 1;
      for (let x = 1; x < size; x++) {
        const colour = this.modules[y]![x]!;
        if (colour === runColour) {
          runLength++;
        } else {
          if (runLength >= 5) score += 3 + (runLength - 5);
          runColour = colour;
          runLength = 1;
        }
      }
      if (runLength >= 5) score += 3 + (runLength - 5);
    }

    for (let x = 0; x < size; x++) {
      let runColour = this.modules[0]![x]!;
      let runLength = 1;
      for (let y = 1; y < size; y++) {
        const colour = this.modules[y]![x]!;
        if (colour === runColour) {
          runLength++;
        } else {
          if (runLength >= 5) score += 3 + (runLength - 5);
          runColour = colour;
          runLength = 1;
        }
      }
      if (runLength >= 5) score += 3 + (runLength - 5);
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const colour = this.modules[y]![x]!;
        if (
          colour === this.modules[y]![x + 1] &&
          colour === this.modules[y + 1]![x] &&
          colour === this.modules[y + 1]![x + 1]
        )
          score += 3;
      }
    }

    const finderA = [true, false, true, true, true, false, true, false, false, false, false];
    const finderB = [false, false, false, false, true, false, true, true, true, false, true];
    const matches = (line: boolean[], start: number, pattern: boolean[]) =>
      pattern.every((expected, offset) => line[start + offset] === expected);

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < size; i++) {
        const line: boolean[] = [false, false, false, false];
        for (let j = 0; j < size; j++)
          line.push(pass === 0 ? this.modules[i]![j]! : this.modules[j]![i]!);
        line.push(false, false, false, false);
        for (let start = 0; start + 11 <= line.length; start++) {
          if (matches(line, start, finderA) || matches(line, start, finderB)) score += 40;
        }
      }
    }

    let dark = 0;
    for (const row of this.modules) for (const module of row) if (module) dark++;
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;

    return score;
  }
}

export interface EncodeOptions {
  ecc?: QrEccLevel;
  /** Force a mask pattern (0-7) instead of letting the penalty score choose. */
  mask?: number;
}

/**
 * Encode `text` as a QR Code and return its module grid.
 *
 * Throws a `RangeError` when the payload does not fit in a version-40 code at
 * the requested level — for the share URLs this is used for, that is far out of
 * reach (a version-40 M code holds ~2.3 kB), but silently returning a truncated
 * or unscannable code would be worse than failing.
 */
export function encodeQr(text: string, options: EncodeOptions = {}): QrMatrix {
  const ecc = options.ecc ?? "M";
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length, ecc);
  if (version === 0) {
    throw new RangeError(
      `Payload of ${bytes.length} bytes is too large for a QR Code at level ${ecc}`,
    );
  }

  const data = buildDataCodewords(bytes, version, ecc);
  const codewords = interleaveWithEcc(data, version, ecc);

  const builder = new MatrixBuilder(version);
  builder.drawFunctionPatterns(version);
  builder.drawCodewords(codewords);

  const masks = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
  let bestMask = masks[0] as number;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const mask of masks) {
    builder.applyMask(mask);
    builder.drawFormat(ecc, mask);
    const score = builder.penalty();
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    builder.applyMask(mask); // undo, the winner is re-applied below
  }

  builder.applyMask(bestMask);
  builder.drawFormat(ecc, bestMask);

  return { version, size: builder.size, modules: builder.modules, mask: bestMask, ecc };
}
