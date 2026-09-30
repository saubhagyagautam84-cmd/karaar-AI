/**
 * QR Code encoder (ISO/IEC 18004, Model 2), from Dukaan Kit (Bajrang Associate) so no
 * third-party code is needed (used for shop labels). Byte mode (UTF-8),
 * error-correction levels L/M/Q/H, versions 1–40, automatic version and
 * mask selection by the standard penalty rules.
 *
 * Verified in tests against a reference encoder (segno, same version / level
 * / mask → identical modules) and a reference decoder (zxing-cpp) — see
 * the Dukaan Kit repo (lib/dukaan/__tests__). Used here for UPI payment QR codes.
 */

export type Ecl = "L" | "M" | "Q" | "H";

export interface QrCode {
  version: number;
  size: number;
  ecl: Ecl;
  mask: number;
  /** modules[y][x] — true = dark */
  modules: boolean[][];
}

const ECL_FORMAT_BITS: Record<Ecl, number> = { L: 1, M: 0, Q: 3, H: 2 };
const ECL_INDEX: Record<Ecl, number> = { L: 0, M: 1, Q: 2, H: 3 };

// Error-correction codewords per block, and number of blocks, by level and version (index 0 unused).
const ECC_PER_BLOCK: number[][] = [
  [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30,
    28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30, 30,
  ],
  [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26,
    26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    28, 28, 28,
  ],
  [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28,
    26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30, 30,
  ],
  [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28,
    26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    30, 30, 30,
  ],
];
const NUM_BLOCKS: number[][] = [
  [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10,
    12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17,
    17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23,
    23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77,
    81,
  ],
];

function numRawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

const numDataCodewords = (ver: number, ecl: Ecl) =>
  Math.floor(numRawDataModules(ver) / 8) -
  ECC_PER_BLOCK[ECL_INDEX[ecl]][ver] * NUM_BLOCKS[ECL_INDEX[ecl]][ver];

// ── Reed–Solomon over GF(256), polynomial 0x11D ──────────────────────

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (r.shift() as number);
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= gfMul(c, factor)));
  }
  return r;
}

// ── Data codewords ───────────────────────────────────────────────────

function utf8(s: string): number[] {
  return [...new TextEncoder().encode(s)];
}

function dataCodewords(bytes: number[], ver: number, ecl: Ecl): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capacity = numDataCodewords(ver, ecl) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < capacity / 8; pad ^= 0xec ^ 0x11)
    out.push(pad);
  return out;
}

function withEcc(data: number[], ver: number, ecl: Ecl): number[] {
  const nBlocks = NUM_BLOCKS[ECL_INDEX[ecl]][ver];
  const eccLen = ECC_PER_BLOCK[ECL_INDEX[ecl]][ver];
  const raw = Math.floor(numRawDataModules(ver) / 8);
  const nShort = nBlocks - (raw % nBlocks);
  const shortLen = Math.floor(raw / nBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < nShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= nShort) out.push(b[i]);
    });
  return out;
}

// ── Matrix ───────────────────────────────────────────────────────────

class Matrix {
  size: number;
  m: boolean[][];
  fn: boolean[][];
  ver: number;
  constructor(ver: number) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.m = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.fn = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }
  set(x: number, y: number, dark: boolean) {
    this.m[y][x] = dark;
    this.fn[y][x] = true;
  }
  alignmentPositions(): number[] {
    if (this.ver === 1) return [];
    const n = Math.floor(this.ver / 7) + 2;
    const step =
      this.ver === 32 ? 26 : Math.ceil((this.ver * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let pos = this.size - 7; r.length < n; pos -= step)
      r.splice(1, 0, pos);
    return r;
  }
  drawFunctionPatterns(ecl: Ecl) {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [this.size - 4, 3],
      [3, this.size - 4],
    ])
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < this.size && y >= 0 && y < this.size)
            this.set(x, y, d !== 2 && d !== 4);
        }
    const pos = this.alignmentPositions();
    const last = pos.length - 1;
    pos.forEach((px, i) =>
      pos.forEach((py, j) => {
        if (
          (i === 0 && j === 0) ||
          (i === 0 && j === last) ||
          (i === last && j === 0)
        )
          return;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            this.set(
              px + dx,
              py + dy,
              Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
            );
      }),
    );
    this.drawFormat(ecl, 0);
    this.drawVersion();
  }
  drawFormat(ecl: Ecl, mask: number) {
    const data = (ECL_FORMAT_BITS[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(i));
    this.set(8, this.size - 8, true);
  }
  drawVersion() {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) !== 0;
      const a = this.size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      this.set(a, c, b);
      this.set(c, a, b);
    }
  }
  drawCodewords(data: number[]) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.fn[y][x] && i < data.length * 8) {
            this.m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
    }
  }
  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        let inv: boolean;
        switch (mask) {
          case 0:
            inv = (x + y) % 2 === 0;
            break;
          case 1:
            inv = y % 2 === 0;
            break;
          case 2:
            inv = x % 3 === 0;
            break;
          case 3:
            inv = (x + y) % 3 === 0;
            break;
          case 4:
            inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            inv = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (inv && !this.fn[y][x]) this.m[y][x] = !this.m[y][x];
      }
  }
  penalty(): number {
    const n = this.size;
    let result = 0;
    const addHistory = (run: number, h: number[]) => {
      if (h[0] === 0) run += n;
      h.pop();
      h.unshift(run);
    };
    const countPatterns = (h: number[]) => {
      const c = h[1];
      const core =
        c > 0 && h[2] === c && h[3] === c * 3 && h[4] === c && h[5] === c;
      return (
        (core && h[0] >= c * 4 && h[6] >= c ? 1 : 0) +
        (core && h[6] >= c * 4 && h[0] >= c ? 1 : 0)
      );
    };
    const terminate = (color: boolean, run: number, h: number[]) => {
      if (color) {
        addHistory(run, h);
        run = 0;
      }
      run += n;
      addHistory(run, h);
      return countPatterns(h);
    };
    for (const byRow of [true, false])
      for (let a = 0; a < n; a++) {
        let color = false;
        let run = 0;
        const h = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < n; b++) {
          const v = byRow ? this.m[a][b] : this.m[b][a];
          if (v === color) {
            run++;
            if (run === 5) result += 3;
            else if (run > 5) result++;
          } else {
            addHistory(run, h);
            if (!color) result += countPatterns(h) * 40;
            color = v;
            run = 1;
          }
        }
        result += terminate(color, run, h) * 40;
      }
    for (let y = 0; y < n - 1; y++)
      for (let x = 0; x < n - 1; x++) {
        const c = this.m[y][x];
        if (
          c === this.m[y][x + 1] &&
          c === this.m[y + 1][x] &&
          c === this.m[y + 1][x + 1]
        )
          result += 3;
      }
    let dark = 0;
    for (const row of this.m) for (const v of row) if (v) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * 10;
  }
}

/** Encode text as a QR code. `version` / `mask` can be forced (tests); otherwise the smallest version and best mask are chosen. */
export function encodeQr(
  text: string,
  ecl: Ecl = "H",
  opts: { version?: number; mask?: number; maxVersion?: number } = {},
): QrCode {
  const bytes = utf8(text);
  let ver = opts.version ?? 0;
  if (!ver) {
    for (let v = 1; v <= (opts.maxVersion ?? 40); v++) {
      const need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
      if (need <= numDataCodewords(v, ecl) * 8) {
        ver = v;
        break;
      }
    }
    if (!ver) throw new RangeError("text too long for a QR code");
  }
  const data = withEcc(dataCodewords(bytes, ver, ecl), ver, ecl);
  const qr = new Matrix(ver);
  qr.drawFunctionPatterns(ecl);
  qr.drawCodewords(data);
  let mask = opts.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let i = 0; i < 8; i++) {
      qr.applyMask(i);
      qr.drawFormat(ecl, i);
      const p = qr.penalty();
      if (p < best) {
        best = p;
        mask = i;
      }
      qr.applyMask(i);
    }
  }
  qr.applyMask(mask);
  qr.drawFormat(ecl, mask);
  return { version: ver, size: qr.size, ecl, mask, modules: qr.m };
}

/** One SVG path for all dark modules, with a quiet zone of `border` modules (4 by the standard). */
export function qrSvgPath(
  q: QrCode,
  border = 4,
): { viewBox: string; d: string } {
  const parts: string[] = [];
  q.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    }),
  );
  const s = q.size + border * 2;
  return { viewBox: `0 0 ${s} ${s}`, d: parts.join("") };
}
