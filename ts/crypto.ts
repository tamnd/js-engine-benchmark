// Crypto, ported from v8-v7/crypto.js to typed TypeScript.
//
// The original is Tom Wu's jsbn arbitrary-precision library plus an RSA layer,
// written as free functions stapled onto prototypes: `function bnpSubTo(a,r)`
// and then `BigInteger.prototype.subTo = bnpSubTo`. Each of those pairs is one
// method here, with the same name and the same body.
//
// Three things the JavaScript does dynamically are pinned down:
//
//   - the digit engine. The original picks am1..am4 at load time and does
//     `setupEngine(am3, 28)`, so BI_DB and friends are module constants and am is
//     am3's body, the one the benchmark always ran.
//   - the reducers. Classic, Montgomery, Barrett and NullExp each define the same
//     five names on their own prototype and exp() calls them through whatever it
//     was handed, so they extend one Reducer base and override.
//   - the BigInteger constructor. `new BigInteger(a,b,c)` switches on the runtime
//     type of its arguments; the three shapes the benchmark reaches become nbi(),
//     parseBigInt(s, radix) and fromBytes(bytes).
//
// The digits still live in an `array` field rather than on the object itself,
// which is how this copy of crypto.js already had it.

// Bits per digit, from the original's setupEngine(am3, 28).
const BI_DB = 28;
const BI_DM = (1 << BI_DB) - 1;
const BI_DV = 1 << BI_DB;

const BI_FP = 52;
const BI_FV = Math.pow(2, BI_FP);
const BI_F1 = BI_FP - BI_DB;
const BI_F2 = 2 * BI_DB - BI_FP;

// Digit conversions. BI_RC maps a character code to its digit value and is
// filled by cryptoSetup, since a top-level loop would run before the benchmark
// asks for any work.
const BI_RM = "0123456789abcdefghijklmnopqrstuvwxyz";
const BI_RC: number[] = new Array<number>(128);

function initRC(): void {
  for (let i = 0; i < BI_RC.length; i++) BI_RC[i] = -1;
  let rr = "0".charCodeAt(0);
  for (let vv = 0; vv <= 9; ++vv) {
    BI_RC[rr] = vv;
    rr++;
  }
  rr = "a".charCodeAt(0);
  for (let vv = 10; vv < 36; ++vv) {
    BI_RC[rr] = vv;
    rr++;
  }
  rr = "A".charCodeAt(0);
  for (let vv = 10; vv < 36; ++vv) {
    BI_RC[rr] = vv;
    rr++;
  }
}

function int2char(n: number): string {
  return BI_RM.charAt(n);
}

// The original stores nothing for an unmapped code and reads back undefined,
// which it turns into -1. The dense table holds -1 for the same codes.
function intAt(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c < 0 || c >= BI_RC.length) return -1;
  return BI_RC[c];
}

// returns bit length of the integer x
function nbits(x: number): number {
  let r = 1;
  let t = x >>> 16;
  if (t != 0) {
    x = t;
    r += 16;
  }
  t = x >> 8;
  if (t != 0) {
    x = t;
    r += 8;
  }
  t = x >> 4;
  if (t != 0) {
    x = t;
    r += 4;
  }
  t = x >> 2;
  if (t != 0) {
    x = t;
    r += 2;
  }
  t = x >> 1;
  if (t != 0) {
    x = t;
    r += 1;
  }
  return r;
}

// return index of lowest 1-bit in x, x < 2^31
function lbit(x: number): number {
  if (x == 0) return -1;
  let r = 0;
  if ((x & 0xffff) == 0) {
    x >>= 16;
    r += 16;
  }
  if ((x & 0xff) == 0) {
    x >>= 8;
    r += 8;
  }
  if ((x & 0xf) == 0) {
    x >>= 4;
    r += 4;
  }
  if ((x & 3) == 0) {
    x >>= 2;
    r += 2;
  }
  if ((x & 1) == 0) ++r;
  return r;
}

// return number of 1 bits in x
function cbit(x: number): number {
  let r = 0;
  while (x != 0) {
    x &= x - 1;
    ++r;
  }
  return r;
}

function op_and(x: number, y: number): number {
  return x & y;
}
function op_or(x: number, y: number): number {
  return x | y;
}
function op_xor(x: number, y: number): number {
  return x ^ y;
}
function op_andnot(x: number, y: number): number {
  return x & ~y;
}

const lowprimes = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109,
  113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239,
  241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313, 317, 331, 337, 347, 349, 353, 359, 367, 373, 379,
  383, 389, 397, 401, 409, 419, 421, 431, 433, 439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503, 509,
];
const lplim = (1 << 26) / lowprimes[lowprimes.length - 1];

// Reducer is the shape exp() and modPow() work through: convert into the
// reduction's representation, multiply and square inside it, revert out. The
// original writes the same five names onto four unrelated prototypes.
class Reducer {
  convert(x: BigInteger): BigInteger {
    return x;
  }
  revert(x: BigInteger): BigInteger {
    return x;
  }
  reduce(x: BigInteger): void {}
  mulTo(x: BigInteger, y: BigInteger, r: BigInteger): void {}
  sqrTo(x: BigInteger, r: BigInteger): void {}
}

class BigInteger {
  array: number[];
  t: number;
  s: number;

  constructor() {
    this.array = [];
    this.t = 0;
    this.s = 0;
  }

  // am3, the engine setupEngine installs: 28-bit digits split into 14-bit
  // halves so every intermediate stays inside a double's integer range.
  am(i: number, x: number, w: BigInteger, j: number, c: number, n: number): number {
    const this_array = this.array;
    const w_array = w.array;

    const xl = x & 0x3fff;
    const xh = x >> 14;
    while (--n >= 0) {
      let l = this_array[i] & 0x3fff;
      const h = this_array[i] >> 14;
      i++;
      const m = xh * l + h * xl;
      l = xl * l + ((m & 0x3fff) << 14) + w_array[j] + c;
      c = (l >> 28) + (m >> 14) + xh * h;
      w_array[j] = l & 0xfffffff;
      j++;
    }
    return c;
  }

  // (protected) copy this to r
  copyTo(r: BigInteger): void {
    const this_array = this.array;
    const r_array = r.array;

    for (let i = this.t - 1; i >= 0; --i) r_array[i] = this_array[i];
    r.t = this.t;
    r.s = this.s;
  }

  // (protected) set from integer value x, -DV <= x < DV
  fromInt(x: number): void {
    const this_array = this.array;
    this.t = 1;
    this.s = x < 0 ? -1 : 0;
    if (x > 0) this_array[0] = x;
    // The original writes `x+DV` here, reading a name that was never declared,
    // so this branch would throw in the JavaScript too. BI_DV is what it meant.
    else if (x < -1) this_array[0] = x + BI_DV;
    else this.t = 0;
  }

  // (protected) set from string and radix. The original's one fromString also
  // takes a byte array when b is 256; that shape is fromBytes below.
  fromString(s: string, b: number): void {
    const this_array = this.array;
    let k: number;
    if (b == 16) k = 4;
    else if (b == 8) k = 3;
    else if (b == 2) k = 1;
    else if (b == 32) k = 5;
    else if (b == 4) k = 2;
    else {
      this.fromRadix(s, b);
      return;
    }
    this.t = 0;
    this.s = 0;
    let i = s.length;
    let mi = false;
    let sh = 0;
    while (--i >= 0) {
      const x = intAt(s, i);
      if (x < 0) {
        if (s.charAt(i) == "-") mi = true;
        continue;
      }
      mi = false;
      if (sh == 0) {
        this_array[this.t] = x;
        this.t++;
      } else if (sh + k > BI_DB) {
        this_array[this.t - 1] |= (x & ((1 << (BI_DB - sh)) - 1)) << sh;
        this_array[this.t] = x >> (BI_DB - sh);
        this.t++;
      } else this_array[this.t - 1] |= x << sh;
      sh += k;
      if (sh >= BI_DB) sh -= BI_DB;
    }
    this.clamp();
    if (mi) ZERO.subTo(this, this);
  }

  // The b == 256 arm of the original's fromString, where the input is a byte
  // array rather than a string of digits and k is 8.
  fromBytes(s: number[]): void {
    const this_array = this.array;
    const k = 8;
    this.t = 0;
    this.s = 0;
    let i = s.length;
    let sh = 0;
    while (--i >= 0) {
      const x = s[i] & 0xff;
      if (sh == 0) {
        this_array[this.t] = x;
        this.t++;
      } else if (sh + k > BI_DB) {
        this_array[this.t - 1] |= (x & ((1 << (BI_DB - sh)) - 1)) << sh;
        this_array[this.t] = x >> (BI_DB - sh);
        this.t++;
      } else this_array[this.t - 1] |= x << sh;
      sh += k;
      if (sh >= BI_DB) sh -= BI_DB;
    }
    if ((s[0] & 0x80) != 0) {
      this.s = -1;
      if (sh > 0) this_array[this.t - 1] |= ((1 << (BI_DB - sh)) - 1) << sh;
    }
    this.clamp();
  }

  // (protected) clamp off excess high words
  clamp(): void {
    const this_array = this.array;
    const c = this.s & BI_DM;
    while (this.t > 0 && this_array[this.t - 1] == c) --this.t;
  }

  // (public) return string representation in given radix. Named for the radix
  // it takes, since the original overrides Object's toString with it.
  toStringRadix(b: number): string {
    const this_array = this.array;
    if (this.s < 0) return "-" + this.negate().toStringRadix(b);
    let k: number;
    if (b == 16) k = 4;
    else if (b == 8) k = 3;
    else if (b == 2) k = 1;
    else if (b == 32) k = 5;
    else if (b == 4) k = 2;
    else return this.toRadix(b);
    const km = (1 << k) - 1;
    let d = 0;
    let m = false;
    let r = "";
    let i = this.t;
    let p = BI_DB - ((i * BI_DB) % k);
    i--;
    if (i >= 0) {
      if (p < BI_DB) {
        d = this_array[i] >> p;
        if (d > 0) {
          m = true;
          r = int2char(d);
        }
      }
      while (i >= 0) {
        if (p < k) {
          d = (this_array[i] & ((1 << p) - 1)) << (k - p);
          i--;
          p += BI_DB - k;
          d |= this_array[i] >> p;
        } else {
          p -= k;
          d = (this_array[i] >> p) & km;
          if (p <= 0) {
            p += BI_DB;
            --i;
          }
        }
        if (d > 0) m = true;
        if (m) r += int2char(d);
      }
    }
    return m ? r : "0";
  }

  // (public) -this
  negate(): BigInteger {
    const r = nbi();
    ZERO.subTo(this, r);
    return r;
  }

  // (public) |this|
  abs(): BigInteger {
    return this.s < 0 ? this.negate() : this;
  }

  // (public) return + if this > a, - if this < a, 0 if equal
  compareTo(a: BigInteger): number {
    const this_array = this.array;
    const a_array = a.array;

    let r = this.s - a.s;
    if (r != 0) return r;
    let i = this.t;
    r = i - a.t;
    if (r != 0) return r;
    while (--i >= 0) {
      r = this_array[i] - a_array[i];
      if (r != 0) return r;
    }
    return 0;
  }

  // (public) return the number of bits in "this"
  bitLength(): number {
    const this_array = this.array;
    if (this.t <= 0) return 0;
    return BI_DB * (this.t - 1) + nbits(this_array[this.t - 1] ^ (this.s & BI_DM));
  }

  // (protected) r = this << n*DB
  dlShiftTo(n: number, r: BigInteger): void {
    const this_array = this.array;
    const r_array = r.array;
    let i: number;
    for (i = this.t - 1; i >= 0; --i) r_array[i + n] = this_array[i];
    for (i = n - 1; i >= 0; --i) r_array[i] = 0;
    r.t = this.t + n;
    r.s = this.s;
  }

  // (protected) r = this >> n*DB
  drShiftTo(n: number, r: BigInteger): void {
    const this_array = this.array;
    const r_array = r.array;
    for (let i = n; i < this.t; ++i) r_array[i - n] = this_array[i];
    r.t = Math.max(this.t - n, 0);
    r.s = this.s;
  }

  // (protected) r = this << n
  lShiftTo(n: number, r: BigInteger): void {
    const this_array = this.array;
    const r_array = r.array;
    const bs = n % BI_DB;
    const cbs = BI_DB - bs;
    const bm = (1 << cbs) - 1;
    const ds = Math.floor(n / BI_DB);
    let c = (this.s << bs) & BI_DM;
    let i: number;
    for (i = this.t - 1; i >= 0; --i) {
      r_array[i + ds + 1] = (this_array[i] >> cbs) | c;
      c = (this_array[i] & bm) << bs;
    }
    for (i = ds - 1; i >= 0; --i) r_array[i] = 0;
    r_array[ds] = c;
    r.t = this.t + ds + 1;
    r.s = this.s;
    r.clamp();
  }

  // (protected) r = this >> n
  rShiftTo(n: number, r: BigInteger): void {
    const this_array = this.array;
    const r_array = r.array;
    r.s = this.s;
    const ds = Math.floor(n / BI_DB);
    if (ds >= this.t) {
      r.t = 0;
      return;
    }
    const bs = n % BI_DB;
    const cbs = BI_DB - bs;
    const bm = (1 << bs) - 1;
    r_array[0] = this_array[ds] >> bs;
    for (let i = ds + 1; i < this.t; ++i) {
      r_array[i - ds - 1] |= (this_array[i] & bm) << cbs;
      r_array[i - ds] = this_array[i] >> bs;
    }
    if (bs > 0) r_array[this.t - ds - 1] |= (this.s & bm) << cbs;
    r.t = this.t - ds;
    r.clamp();
  }

  // (protected) r = this - a
  subTo(a: BigInteger, r: BigInteger): void {
    const this_array = this.array;
    const r_array = r.array;
    const a_array = a.array;
    let i = 0;
    let c = 0;
    const m = Math.min(a.t, this.t);
    while (i < m) {
      c += this_array[i] - a_array[i];
      r_array[i] = c & BI_DM;
      i++;
      c >>= BI_DB;
    }
    if (a.t < this.t) {
      c -= a.s;
      while (i < this.t) {
        c += this_array[i];
        r_array[i] = c & BI_DM;
        i++;
        c >>= BI_DB;
      }
      c += this.s;
    } else {
      c += this.s;
      while (i < a.t) {
        c -= a_array[i];
        r_array[i] = c & BI_DM;
        i++;
        c >>= BI_DB;
      }
      c -= a.s;
    }
    r.s = c < 0 ? -1 : 0;
    if (c < -1) {
      r_array[i] = BI_DV + c;
      i++;
    } else if (c > 0) {
      r_array[i] = c;
      i++;
    }
    r.t = i;
    r.clamp();
  }

  // (protected) r = this * a, r != this,a (HAC 14.12)
  // "this" should be the larger one if appropriate.
  multiplyTo(a: BigInteger, r: BigInteger): void {
    const r_array = r.array;
    const x = this.abs();
    const y = a.abs();
    const y_array = y.array;

    let i = x.t;
    r.t = i + y.t;
    while (--i >= 0) r_array[i] = 0;
    for (i = 0; i < y.t; ++i) r_array[i + x.t] = x.am(0, y_array[i], r, i, 0, x.t);
    r.s = 0;
    r.clamp();
    if (this.s != a.s) ZERO.subTo(r, r);
  }

  // (protected) r = this^2, r != this (HAC 14.16)
  squareTo(r: BigInteger): void {
    const x = this.abs();
    const x_array = x.array;
    const r_array = r.array;

    r.t = 2 * x.t;
    let i = r.t;
    while (--i >= 0) r_array[i] = 0;
    for (i = 0; i < x.t - 1; ++i) {
      const c = x.am(i, x_array[i], r, 2 * i, 0, 1);
      r_array[i + x.t] += x.am(i + 1, 2 * x_array[i], r, 2 * i + 1, c, x.t - i - 1);
      if (r_array[i + x.t] >= BI_DV) {
        r_array[i + x.t] -= BI_DV;
        r_array[i + x.t + 1] = 1;
      }
    }
    if (r.t > 0) r_array[r.t - 1] += x.am(i, x_array[i], r, 2 * i, 0, 1);
    r.s = 0;
    r.clamp();
  }

  // (protected) divide this by m, quotient and remainder to q, r (HAC 14.20)
  // r != q, this != m.  q or r may be null.
  divRemTo(m: BigInteger, q: BigInteger | null, r: BigInteger | null): void {
    const pm = m.abs();
    if (pm.t <= 0) return;
    const pt = this.abs();
    if (pt.t < pm.t) {
      if (q != null) q.fromInt(0);
      if (r != null) this.copyTo(r);
      return;
    }
    if (r == null) r = nbi();
    const y = nbi();
    const ts = this.s;
    const ms = m.s;
    const pm_array = pm.array;
    const nsh = BI_DB - nbits(pm_array[pm.t - 1]); // normalize modulus
    if (nsh > 0) {
      pm.lShiftTo(nsh, y);
      pt.lShiftTo(nsh, r);
    } else {
      pm.copyTo(y);
      pt.copyTo(r);
    }
    const ys = y.t;

    const y_array = y.array;
    const y0 = y_array[ys - 1];
    if (y0 == 0) return;
    const yt = y0 * (1 << BI_F1) + (ys > 1 ? y_array[ys - 2] >> BI_F2 : 0);
    const d1 = BI_FV / yt;
    const d2 = (1 << BI_F1) / yt;
    const e = 1 << BI_F2;
    let i = r.t;
    let j = i - ys;
    const t = q == null ? nbi() : q;
    y.dlShiftTo(j, t);

    const r_array = r.array;
    if (r.compareTo(t) >= 0) {
      r_array[r.t] = 1;
      r.t++;
      r.subTo(t, r);
    }
    ONE.dlShiftTo(ys, t);
    t.subTo(y, y); // "negative" y so we can replace sub with am later
    while (y.t < ys) {
      y_array[y.t] = 0;
      y.t++;
    }
    while (--j >= 0) {
      // Estimate quotient digit
      --i;
      let qd = r_array[i] == y0 ? BI_DM : Math.floor(r_array[i] * d1 + (r_array[i - 1] + e) * d2);
      r_array[i] += y.am(0, qd, r, j, 0, ys);
      if (r_array[i] < qd) {
        // Try it out
        y.dlShiftTo(j, t);
        r.subTo(t, r);
        --qd;
        while (r_array[i] < qd) {
          r.subTo(t, r);
          --qd;
        }
      }
    }
    if (q != null) {
      r.drShiftTo(ys, q);
      if (ts != ms) ZERO.subTo(q, q);
    }
    r.t = ys;
    r.clamp();
    if (nsh > 0) r.rShiftTo(nsh, r); // Denormalize remainder
    if (ts < 0) ZERO.subTo(r, r);
  }

  // (public) this mod a
  mod(a: BigInteger): BigInteger {
    const r = nbi();
    this.abs().divRemTo(a, null, r);
    if (this.s < 0 && r.compareTo(ZERO) > 0) a.subTo(r, r);
    return r;
  }

  // (protected) return "-1/this % 2^DB"; useful for Mont. reduction
  invDigit(): number {
    const this_array = this.array;
    if (this.t < 1) return 0;
    const x = this_array[0];
    if ((x & 1) == 0) return 0;
    let y = x & 3; // y == 1/x mod 2^2
    y = (y * (2 - (x & 0xf) * y)) & 0xf; // y == 1/x mod 2^4
    y = (y * (2 - (x & 0xff) * y)) & 0xff; // y == 1/x mod 2^8
    y = (y * (2 - (((x & 0xffff) * y) & 0xffff))) & 0xffff; // y == 1/x mod 2^16
    // last step - calculate inverse mod DV directly;
    // assumes 16 < DB <= 32 and assumes ability to handle 48-bit ints
    y = (y * (2 - ((x * y) % BI_DV))) % BI_DV; // y == 1/x mod 2^dbits
    // we really want the negative inverse, and -DV < y < DV
    return y > 0 ? BI_DV - y : -y;
  }

  // (protected) true iff this is even
  isEven(): boolean {
    const this_array = this.array;
    return (this.t > 0 ? this_array[0] & 1 : this.s) == 0;
  }

  // (protected) this^e, e < 2^32, doing sqr and mul with "r" (HAC 14.79)
  exp(e: number, z: Reducer): BigInteger {
    if (e > 0xffffffff || e < 1) return ONE;
    let r = nbi();
    let r2 = nbi();
    const g = z.convert(this);
    let i = nbits(e) - 1;
    g.copyTo(r);
    while (--i >= 0) {
      z.sqrTo(r, r2);
      if ((e & (1 << i)) > 0) z.mulTo(r2, g, r);
      else {
        const t = r;
        r = r2;
        r2 = t;
      }
    }
    return z.revert(r);
  }

  // (public) this^e % m, 0 <= e < 2^32
  modPowInt(e: number, m: BigInteger): BigInteger {
    let z: Reducer;
    if (e < 256 || m.isEven()) z = new Classic(m);
    else z = new Montgomery(m);
    return this.exp(e, z);
  }

  // (public)
  clone(): BigInteger {
    const r = nbi();
    this.copyTo(r);
    return r;
  }

  // (public) return value as integer
  intValue(): number {
    const this_array = this.array;
    if (this.s < 0) {
      if (this.t == 1) return this_array[0] - BI_DV;
      else if (this.t == 0) return -1;
    } else if (this.t == 1) return this_array[0];
    else if (this.t == 0) return 0;
    // assumes 16 < DB < 32
    return ((this_array[1] & ((1 << (32 - BI_DB)) - 1)) << BI_DB) | this_array[0];
  }

  // (public) return value as byte
  byteValue(): number {
    const this_array = this.array;
    return this.t == 0 ? this.s : (this_array[0] << 24) >> 24;
  }

  // (public) return value as short (assumes DB>=16)
  shortValue(): number {
    const this_array = this.array;
    return this.t == 0 ? this.s : (this_array[0] << 16) >> 16;
  }

  // (protected) return x s.t. r^x < DV
  chunkSize(r: number): number {
    return Math.floor((Math.LN2 * BI_DB) / Math.log(r));
  }

  // (public) 0 if this == 0, 1 if this > 0
  signum(): number {
    const this_array = this.array;
    if (this.s < 0) return -1;
    else if (this.t <= 0 || (this.t == 1 && this_array[0] <= 0)) return 0;
    else return 1;
  }

  // (protected) convert to radix string
  toRadix(b: number): string {
    if (this.signum() == 0 || b < 2 || b > 36) return "0";
    const cs = this.chunkSize(b);
    const a = Math.pow(b, cs);
    const d = nbv(a);
    const y = nbi();
    const z = nbi();
    let r = "";
    this.divRemTo(d, y, z);
    while (y.signum() > 0) {
      r = numToRadix(a + z.intValue(), b).substr(1) + r;
      y.divRemTo(d, y, z);
    }
    return numToRadix(z.intValue(), b) + r;
  }

  // (protected) convert from radix string
  fromRadix(s: string, b: number): void {
    this.fromInt(0);
    const cs = this.chunkSize(b);
    const d = Math.pow(b, cs);
    let mi = false;
    let j = 0;
    let w = 0;
    for (let i = 0; i < s.length; ++i) {
      const x = intAt(s, i);
      if (x < 0) {
        if (s.charAt(i) == "-" && this.signum() == 0) mi = true;
        continue;
      }
      w = b * w + x;
      if (++j >= cs) {
        this.dMultiply(d);
        this.dAddOffset(w, 0);
        j = 0;
        w = 0;
      }
    }
    if (j > 0) {
      this.dMultiply(Math.pow(b, j));
      this.dAddOffset(w, 0);
    }
    if (mi) ZERO.subTo(this, this);
  }

  // (protected) alternate constructor, the new BigInteger(bits, certainty, rng)
  // shape. The new BigInteger(bits, rng) shape is fromRandom below.
  fromNumber(a: number, b: number, c: SecureRandom): void {
    if (a < 2) this.fromInt(1);
    else {
      this.fromRandom(a, c);
      if (!this.testBit(a - 1)) {
        // force MSB set
        this.bitwiseTo(ONE.shiftLeft(a - 1), op_or, this);
      }
      if (this.isEven()) this.dAddOffset(1, 0); // force odd
      while (!this.isProbablePrime(b)) {
        this.dAddOffset(2, 0);
        if (this.bitLength() > a) this.subTo(ONE.shiftLeft(a - 1), this);
      }
    }
  }

  fromRandom(a: number, b: SecureRandom): void {
    const t = a & 7;
    const x: number[] = new Array<number>((a >> 3) + 1);
    b.nextBytes(x);
    if (t > 0) x[0] &= (1 << t) - 1;
    else x[0] = 0;
    this.fromBytes(x);
  }

  // (public) convert to bigendian byte array
  toByteArray(): number[] {
    const this_array = this.array;
    let i = this.t;
    const r: number[] = [];
    r[0] = this.s;
    let p = BI_DB - ((i * BI_DB) % 8);
    let d = 0;
    let k = 0;
    i--;
    if (i >= 0) {
      if (p < BI_DB) {
        d = this_array[i] >> p;
        if (d != (this.s & BI_DM) >> p) {
          r[k] = d | (this.s << (BI_DB - p));
          k++;
        }
      }
      while (i >= 0) {
        if (p < 8) {
          d = (this_array[i] & ((1 << p) - 1)) << (8 - p);
          i--;
          p += BI_DB - 8;
          d |= this_array[i] >> p;
        } else {
          p -= 8;
          d = (this_array[i] >> p) & 0xff;
          if (p <= 0) {
            p += BI_DB;
            --i;
          }
        }
        if ((d & 0x80) != 0) d |= -256;
        if (k == 0 && (this.s & 0x80) != (d & 0x80)) ++k;
        if (k > 0 || d != this.s) {
          r[k] = d;
          k++;
        }
      }
    }
    return r;
  }

  equals(a: BigInteger): boolean {
    return this.compareTo(a) == 0;
  }
  min(a: BigInteger): BigInteger {
    return this.compareTo(a) < 0 ? this : a;
  }
  max(a: BigInteger): BigInteger {
    return this.compareTo(a) > 0 ? this : a;
  }

  // (protected) r = this op a (bitwise)
  bitwiseTo(a: BigInteger, op: (x: number, y: number) => number, r: BigInteger): void {
    const this_array = this.array;
    const a_array = a.array;
    const r_array = r.array;
    let i: number;
    let f: number;
    const m = Math.min(a.t, this.t);
    for (i = 0; i < m; ++i) r_array[i] = op(this_array[i], a_array[i]);
    if (a.t < this.t) {
      f = a.s & BI_DM;
      for (i = m; i < this.t; ++i) r_array[i] = op(this_array[i], f);
      r.t = this.t;
    } else {
      f = this.s & BI_DM;
      for (i = m; i < a.t; ++i) r_array[i] = op(f, a_array[i]);
      r.t = a.t;
    }
    r.s = op(this.s, a.s);
    r.clamp();
  }

  and(a: BigInteger): BigInteger {
    const r = nbi();
    this.bitwiseTo(a, op_and, r);
    return r;
  }
  or(a: BigInteger): BigInteger {
    const r = nbi();
    this.bitwiseTo(a, op_or, r);
    return r;
  }
  xor(a: BigInteger): BigInteger {
    const r = nbi();
    this.bitwiseTo(a, op_xor, r);
    return r;
  }
  andNot(a: BigInteger): BigInteger {
    const r = nbi();
    this.bitwiseTo(a, op_andnot, r);
    return r;
  }

  // (public) ~this
  not(): BigInteger {
    const this_array = this.array;
    const r = nbi();
    const r_array = r.array;

    for (let i = 0; i < this.t; ++i) r_array[i] = BI_DM & ~this_array[i];
    r.t = this.t;
    r.s = ~this.s;
    return r;
  }

  // (public) this << n
  shiftLeft(n: number): BigInteger {
    const r = nbi();
    if (n < 0) this.rShiftTo(-n, r);
    else this.lShiftTo(n, r);
    return r;
  }

  // (public) this >> n
  shiftRight(n: number): BigInteger {
    const r = nbi();
    if (n < 0) this.lShiftTo(-n, r);
    else this.rShiftTo(n, r);
    return r;
  }

  // (public) returns index of lowest 1-bit (or -1 if none)
  getLowestSetBit(): number {
    const this_array = this.array;
    for (let i = 0; i < this.t; ++i) if (this_array[i] != 0) return i * BI_DB + lbit(this_array[i]);
    if (this.s < 0) return this.t * BI_DB;
    return -1;
  }

  // (public) return number of set bits. The original reads a this_array it
  // never declared in this one function, so calling it would throw; the digits
  // it meant are read here.
  bitCount(): number {
    const this_array = this.array;
    let r = 0;
    const x = this.s & BI_DM;
    for (let i = 0; i < this.t; ++i) r += cbit(this_array[i] ^ x);
    return r;
  }

  // (public) true iff nth bit is set
  testBit(n: number): boolean {
    const this_array = this.array;
    const j = Math.floor(n / BI_DB);
    if (j >= this.t) return this.s != 0;
    return (this_array[j] & (1 << n % BI_DB)) != 0;
  }

  // (protected) this op (1<<n)
  changeBit(n: number, op: (x: number, y: number) => number): BigInteger {
    const r = ONE.shiftLeft(n);
    this.bitwiseTo(r, op, r);
    return r;
  }

  setBit(n: number): BigInteger {
    return this.changeBit(n, op_or);
  }
  clearBit(n: number): BigInteger {
    return this.changeBit(n, op_andnot);
  }
  flipBit(n: number): BigInteger {
    return this.changeBit(n, op_xor);
  }

  // (protected) r = this + a
  addTo(a: BigInteger, r: BigInteger): void {
    const this_array = this.array;
    const a_array = a.array;
    const r_array = r.array;
    let i = 0;
    let c = 0;
    const m = Math.min(a.t, this.t);
    while (i < m) {
      c += this_array[i] + a_array[i];
      r_array[i] = c & BI_DM;
      i++;
      c >>= BI_DB;
    }
    if (a.t < this.t) {
      c += a.s;
      while (i < this.t) {
        c += this_array[i];
        r_array[i] = c & BI_DM;
        i++;
        c >>= BI_DB;
      }
      c += this.s;
    } else {
      c += this.s;
      while (i < a.t) {
        c += a_array[i];
        r_array[i] = c & BI_DM;
        i++;
        c >>= BI_DB;
      }
      c += a.s;
    }
    r.s = c < 0 ? -1 : 0;
    if (c > 0) {
      r_array[i] = c;
      i++;
    } else if (c < -1) {
      r_array[i] = BI_DV + c;
      i++;
    }
    r.t = i;
    r.clamp();
  }

  add(a: BigInteger): BigInteger {
    const r = nbi();
    this.addTo(a, r);
    return r;
  }
  subtract(a: BigInteger): BigInteger {
    const r = nbi();
    this.subTo(a, r);
    return r;
  }
  multiply(a: BigInteger): BigInteger {
    const r = nbi();
    this.multiplyTo(a, r);
    return r;
  }
  divide(a: BigInteger): BigInteger {
    const r = nbi();
    this.divRemTo(a, r, null);
    return r;
  }
  remainder(a: BigInteger): BigInteger {
    const r = nbi();
    this.divRemTo(a, null, r);
    return r;
  }
  divideAndRemainder(a: BigInteger): BigInteger[] {
    const q = nbi();
    const r = nbi();
    this.divRemTo(a, q, r);
    return [q, r];
  }

  // (protected) this *= n, this >= 0, 1 < n < DV
  dMultiply(n: number): void {
    const this_array = this.array;
    this_array[this.t] = this.am(0, n - 1, this, 0, 0, this.t);
    ++this.t;
    this.clamp();
  }

  // (protected) this += n << w words, this >= 0
  dAddOffset(n: number, w: number): void {
    const this_array = this.array;
    while (this.t <= w) {
      this_array[this.t] = 0;
      this.t++;
    }
    this_array[w] += n;
    while (this_array[w] >= BI_DV) {
      this_array[w] -= BI_DV;
      ++w;
      if (w >= this.t) {
        this_array[this.t] = 0;
        this.t++;
      }
      ++this_array[w];
    }
  }

  // (public) this^e
  pow(e: number): BigInteger {
    return this.exp(e, new NullExp());
  }

  // (protected) r = lower n words of "this * a", a.t <= n
  // "this" should be the larger one if appropriate.
  multiplyLowerTo(a: BigInteger, n: number, r: BigInteger): void {
    const r_array = r.array;
    const a_array = a.array;
    let i = Math.min(this.t + a.t, n);
    r.s = 0; // assumes a,this >= 0
    r.t = i;
    while (i > 0) {
      --i;
      r_array[i] = 0;
    }
    let j: number;
    for (j = r.t - this.t; i < j; ++i) r_array[i + this.t] = this.am(0, a_array[i], r, i, 0, this.t);
    for (j = Math.min(a.t, n); i < j; ++i) this.am(0, a_array[i], r, i, 0, n - i);
    r.clamp();
  }

  // (protected) r = "this * a" without lower n words, n > 0
  // "this" should be the larger one if appropriate.
  multiplyUpperTo(a: BigInteger, n: number, r: BigInteger): void {
    const r_array = r.array;
    const a_array = a.array;
    --n;
    r.t = this.t + a.t - n;
    let i = r.t;
    r.s = 0; // assumes a,this >= 0
    while (--i >= 0) r_array[i] = 0;
    for (i = Math.max(n - this.t, 0); i < a.t; ++i)
      r_array[this.t + i - n] = this.am(n - i, a_array[i], r, 0, 0, this.t + i - n);
    r.clamp();
    r.drShiftTo(1, r);
  }

  // (public) this^e % m (HAC 14.85)
  modPow(e: BigInteger, m: BigInteger): BigInteger {
    const e_array = e.array;
    let i = e.bitLength();
    let k: number;
    let r = nbv(1);
    let z: Reducer;
    if (i <= 0) return r;
    else if (i < 18) k = 1;
    else if (i < 48) k = 3;
    else if (i < 144) k = 4;
    else if (i < 768) k = 5;
    else k = 6;
    if (i < 8) z = new Classic(m);
    else if (m.isEven()) z = new Barrett(m);
    else z = new Montgomery(m);

    // precomputation
    const km = (1 << k) - 1;
    const g: BigInteger[] = new Array<BigInteger>(km + 1);
    let n = 3;
    const k1 = k - 1;
    g[1] = z.convert(this);
    if (k > 1) {
      const g2 = nbi();
      z.sqrTo(g[1], g2);
      while (n <= km) {
        g[n] = nbi();
        z.mulTo(g2, g[n - 2], g[n]);
        n += 2;
      }
    }

    let j = e.t - 1;
    let w: number;
    let is1 = true;
    let r2 = nbi();
    let t: BigInteger;
    i = nbits(e_array[j]) - 1;
    while (j >= 0) {
      if (i >= k1) w = (e_array[j] >> (i - k1)) & km;
      else {
        w = (e_array[j] & ((1 << (i + 1)) - 1)) << (k1 - i);
        if (j > 0) w |= e_array[j - 1] >> (BI_DB + i - k1);
      }

      n = k;
      while ((w & 1) == 0) {
        w >>= 1;
        --n;
      }
      i -= n;
      if (i < 0) {
        i += BI_DB;
        --j;
      }
      if (is1) {
        // ret == 1, don't bother squaring or multiplying it
        g[w].copyTo(r);
        is1 = false;
      } else {
        while (n > 1) {
          z.sqrTo(r, r2);
          z.sqrTo(r2, r);
          n -= 2;
        }
        if (n > 0) z.sqrTo(r, r2);
        else {
          t = r;
          r = r2;
          r2 = t;
        }
        z.mulTo(r2, g[w], r);
      }

      while (j >= 0 && (e_array[j] & (1 << i)) == 0) {
        z.sqrTo(r, r2);
        t = r;
        r = r2;
        r2 = t;
        if (--i < 0) {
          i = BI_DB - 1;
          --j;
        }
      }
    }
    return z.revert(r);
  }

  // (public) gcd(this,a) (HAC 14.54)
  gcd(a: BigInteger): BigInteger {
    let x = this.s < 0 ? this.negate() : this.clone();
    let y = a.s < 0 ? a.negate() : a.clone();
    if (x.compareTo(y) < 0) {
      const t = x;
      x = y;
      y = t;
    }
    let i = x.getLowestSetBit();
    let g = y.getLowestSetBit();
    if (g < 0) return x;
    if (i < g) g = i;
    if (g > 0) {
      x.rShiftTo(g, x);
      y.rShiftTo(g, y);
    }
    while (x.signum() > 0) {
      i = x.getLowestSetBit();
      if (i > 0) x.rShiftTo(i, x);
      i = y.getLowestSetBit();
      if (i > 0) y.rShiftTo(i, y);
      if (x.compareTo(y) >= 0) {
        x.subTo(y, x);
        x.rShiftTo(1, x);
      } else {
        y.subTo(x, y);
        y.rShiftTo(1, y);
      }
    }
    if (g > 0) y.lShiftTo(g, y);
    return y;
  }

  // (protected) this % n, n < 2^26
  modInt(n: number): number {
    const this_array = this.array;
    if (n <= 0) return 0;
    const d = BI_DV % n;
    let r = this.s < 0 ? n - 1 : 0;
    if (this.t > 0) {
      if (d == 0) r = this_array[0] % n;
      else for (let i = this.t - 1; i >= 0; --i) r = (d * r + this_array[i]) % n;
    }
    return r;
  }

  // (public) 1/this % m (HAC 14.61)
  modInverse(m: BigInteger): BigInteger {
    const ac = m.isEven();
    if ((this.isEven() && ac) || m.signum() == 0) return ZERO;
    const u = m.clone();
    const v = this.clone();
    const a = nbv(1);
    const b = nbv(0);
    const c = nbv(0);
    const d = nbv(1);
    while (u.signum() != 0) {
      while (u.isEven()) {
        u.rShiftTo(1, u);
        if (ac) {
          if (!a.isEven() || !b.isEven()) {
            a.addTo(this, a);
            b.subTo(m, b);
          }
          a.rShiftTo(1, a);
        } else if (!b.isEven()) b.subTo(m, b);
        b.rShiftTo(1, b);
      }
      while (v.isEven()) {
        v.rShiftTo(1, v);
        if (ac) {
          if (!c.isEven() || !d.isEven()) {
            c.addTo(this, c);
            d.subTo(m, d);
          }
          c.rShiftTo(1, c);
        } else if (!d.isEven()) d.subTo(m, d);
        d.rShiftTo(1, d);
      }
      if (u.compareTo(v) >= 0) {
        u.subTo(v, u);
        if (ac) a.subTo(c, a);
        b.subTo(d, b);
      } else {
        v.subTo(u, v);
        if (ac) c.subTo(a, c);
        d.subTo(b, d);
      }
    }
    if (v.compareTo(ONE) != 0) return ZERO;
    if (d.compareTo(m) >= 0) return d.subtract(m);
    if (d.signum() < 0) d.addTo(m, d);
    else return d;
    // The original repeats the sign test here; d is non-negative by now, so the
    // second arm is the one that runs.
    if (d.signum() < 0) return d.add(m);
    return d;
  }

  // (public) test primality with certainty >= 1-.5^t
  isProbablePrime(t: number): boolean {
    let i: number;
    const x = this.abs();
    const x_array = x.array;
    if (x.t == 1 && x_array[0] <= lowprimes[lowprimes.length - 1]) {
      for (i = 0; i < lowprimes.length; ++i) if (x_array[0] == lowprimes[i]) return true;
      return false;
    }
    if (x.isEven()) return false;
    i = 1;
    while (i < lowprimes.length) {
      let m = lowprimes[i];
      let j = i + 1;
      while (j < lowprimes.length && m < lplim) {
        m *= lowprimes[j];
        j++;
      }
      m = x.modInt(m);
      while (i < j) {
        if (m % lowprimes[i] == 0) return false;
        i++;
      }
    }
    return x.millerRabin(t);
  }

  // (protected) true if probably prime (HAC 4.24, Miller-Rabin)
  millerRabin(t: number): boolean {
    const n1 = this.subtract(ONE);
    const k = n1.getLowestSetBit();
    if (k <= 0) return false;
    const r = n1.shiftRight(k);
    t = (t + 1) >> 1;
    if (t > lowprimes.length) t = lowprimes.length;
    const a = nbi();
    for (let i = 0; i < t; ++i) {
      a.fromInt(lowprimes[i]);
      let y = a.modPow(r, this);
      if (y.compareTo(ONE) != 0 && y.compareTo(n1) != 0) {
        let j = 1;
        while (j < k && y.compareTo(n1) != 0) {
          j++;
          y = y.modPowInt(2, this);
          if (y.compareTo(ONE) == 0) return false;
        }
        if (y.compareTo(n1) != 0) return false;
      }
    }
    return true;
  }
}

// return new, unset BigInteger
function nbi(): BigInteger {
  return new BigInteger();
}

// return bigint initialized to value
function nbv(i: number): BigInteger {
  const r = nbi();
  r.fromInt(i);
  return r;
}

// "constants"
const ZERO = nbv(0);
const ONE = nbv(1);

// numToRadix is the Number.prototype.toString(radix) the original calls on the
// intermediate chunks in toRadix. Only radixes 2..36 reach it, and the value is
// a non-negative integer below DV.
function numToRadix(n: number, b: number): string {
  if (n == 0) return "0";
  let r = "";
  while (n > 0) {
    r = BI_RM.charAt(n % b) + r;
    n = Math.floor(n / b);
  }
  return r;
}

// Modular reduction using "classic" algorithm
class Classic extends Reducer {
  m: BigInteger;

  constructor(m: BigInteger) {
    super();
    this.m = m;
  }

  convert(x: BigInteger): BigInteger {
    if (x.s < 0 || x.compareTo(this.m) >= 0) return x.mod(this.m);
    else return x;
  }
  revert(x: BigInteger): BigInteger {
    return x;
  }
  reduce(x: BigInteger): void {
    x.divRemTo(this.m, null, x);
  }
  mulTo(x: BigInteger, y: BigInteger, r: BigInteger): void {
    x.multiplyTo(y, r);
    this.reduce(r);
  }
  sqrTo(x: BigInteger, r: BigInteger): void {
    x.squareTo(r);
    this.reduce(r);
  }
}

// Montgomery reduction
class Montgomery extends Reducer {
  m: BigInteger;
  mp: number;
  mpl: number;
  mph: number;
  um: number;
  mt2: number;

  constructor(m: BigInteger) {
    super();
    this.m = m;
    this.mp = m.invDigit();
    this.mpl = this.mp & 0x7fff;
    this.mph = this.mp >> 15;
    this.um = (1 << (BI_DB - 15)) - 1;
    this.mt2 = 2 * m.t;
  }

  // xR mod m
  convert(x: BigInteger): BigInteger {
    const r = nbi();
    x.abs().dlShiftTo(this.m.t, r);
    r.divRemTo(this.m, null, r);
    if (x.s < 0 && r.compareTo(ZERO) > 0) this.m.subTo(r, r);
    return r;
  }

  // x/R mod m
  revert(x: BigInteger): BigInteger {
    const r = nbi();
    x.copyTo(r);
    this.reduce(r);
    return r;
  }

  // x = x/R mod m (HAC 14.32)
  reduce(x: BigInteger): void {
    const x_array = x.array;
    while (x.t <= this.mt2) {
      // pad x so am has enough room later
      x_array[x.t] = 0;
      x.t++;
    }
    for (let i = 0; i < this.m.t; ++i) {
      // faster way of calculating u0 = x[i]*mp mod DV
      let j = x_array[i] & 0x7fff;
      const u0 = (j * this.mpl + (((j * this.mph + (x_array[i] >> 15) * this.mpl) & this.um) << 15)) & BI_DM;
      // use am to combine the multiply-shift-add into one call
      j = i + this.m.t;
      x_array[j] += this.m.am(0, u0, x, i, 0, this.m.t);
      // propagate carry
      while (x_array[j] >= BI_DV) {
        x_array[j] -= BI_DV;
        ++j;
        x_array[j]++;
      }
    }
    x.clamp();
    x.drShiftTo(this.m.t, x);
    if (x.compareTo(this.m) >= 0) x.subTo(this.m, x);
  }

  mulTo(x: BigInteger, y: BigInteger, r: BigInteger): void {
    x.multiplyTo(y, r);
    this.reduce(r);
  }
  sqrTo(x: BigInteger, r: BigInteger): void {
    x.squareTo(r);
    this.reduce(r);
  }
}

// A "null" reducer
class NullExp extends Reducer {
  convert(x: BigInteger): BigInteger {
    return x;
  }
  revert(x: BigInteger): BigInteger {
    return x;
  }
  mulTo(x: BigInteger, y: BigInteger, r: BigInteger): void {
    x.multiplyTo(y, r);
  }
  sqrTo(x: BigInteger, r: BigInteger): void {
    x.squareTo(r);
  }
}

// Barrett modular reduction
class Barrett extends Reducer {
  r2: BigInteger;
  q3: BigInteger;
  mu: BigInteger;
  m: BigInteger;

  constructor(m: BigInteger) {
    super();
    // setup Barrett
    this.r2 = nbi();
    this.q3 = nbi();
    ONE.dlShiftTo(2 * m.t, this.r2);
    this.mu = this.r2.divide(m);
    this.m = m;
  }

  convert(x: BigInteger): BigInteger {
    if (x.s < 0 || x.t > 2 * this.m.t) return x.mod(this.m);
    else if (x.compareTo(this.m) < 0) return x;
    else {
      const r = nbi();
      x.copyTo(r);
      this.reduce(r);
      return r;
    }
  }

  revert(x: BigInteger): BigInteger {
    return x;
  }

  // x = x mod m (HAC 14.42)
  reduce(x: BigInteger): void {
    x.drShiftTo(this.m.t - 1, this.r2);
    if (x.t > this.m.t + 1) {
      x.t = this.m.t + 1;
      x.clamp();
    }
    this.mu.multiplyUpperTo(this.r2, this.m.t + 1, this.q3);
    this.m.multiplyLowerTo(this.q3, this.m.t + 1, this.r2);
    while (x.compareTo(this.r2) < 0) x.dAddOffset(1, this.m.t + 1);
    x.subTo(this.r2, x);
    while (x.compareTo(this.m) >= 0) x.subTo(this.m, x);
  }

  mulTo(x: BigInteger, y: BigInteger, r: BigInteger): void {
    x.multiplyTo(y, r);
    this.reduce(r);
  }
  sqrTo(x: BigInteger, r: BigInteger): void {
    x.squareTo(r);
    this.reduce(r);
  }
}

// prng4.js - uses Arcfour as a PRNG
class Arcfour {
  i: number;
  j: number;
  S: number[];

  constructor() {
    this.i = 0;
    this.j = 0;
    this.S = new Array<number>(256);
  }

  // Initialize arcfour context from key, an array of ints, each from [0..255]
  init(key: number[]): void {
    let i: number;
    let j: number;
    let t: number;
    for (i = 0; i < 256; ++i) this.S[i] = i;
    j = 0;
    for (i = 0; i < 256; ++i) {
      j = (j + this.S[i] + key[i % key.length]) & 255;
      t = this.S[i];
      this.S[i] = this.S[j];
      this.S[j] = t;
    }
    this.i = 0;
    this.j = 0;
  }

  next(): number {
    this.i = (this.i + 1) & 255;
    this.j = (this.j + this.S[this.i]) & 255;
    const t = this.S[this.i];
    this.S[this.i] = this.S[this.j];
    this.S[this.j] = t;
    return this.S[(t + this.S[this.i]) & 255];
  }
}

// Plug in your RNG constructor here
function prng_newstate(): Arcfour {
  return new Arcfour();
}

// Pool size must be a multiple of 4 and greater than 32.
// An array of bytes the size of the pool will be passed to init()
const rng_psize = 256;

let rng_state: Arcfour | null = null;
const rng_pool: number[] = new Array<number>(rng_psize);
let rng_pptr = 0;

// Mix in a 32-bit integer into the pool
function rng_seed_int(x: number): void {
  rng_pool[rng_pptr] ^= x & 255;
  rng_pptr++;
  rng_pool[rng_pptr] ^= (x >> 8) & 255;
  rng_pptr++;
  rng_pool[rng_pptr] ^= (x >> 16) & 255;
  rng_pptr++;
  rng_pool[rng_pptr] ^= (x >> 24) & 255;
  rng_pptr++;
  if (rng_pptr >= rng_psize) rng_pptr -= rng_psize;
}

// Mix in the current time (w/milliseconds) into the pool
function rng_seed_time(): void {
  // Use pre-computed date to avoid making the benchmark
  // results dependent on the current date.
  rng_seed_int(1122926989487);
}

// The original fills the pool in a top-level block guarded on rng_pool being
// null. It runs once, before any benchmark work, which is what setup is for.
function rng_init_pool(): void {
  rng_pptr = 0;
  while (rng_pptr < rng_psize) {
    // extract some randomness from Math.random()
    const t = Math.floor(65536 * random());
    rng_pool[rng_pptr] = t >>> 8;
    rng_pptr++;
    rng_pool[rng_pptr] = t & 255;
    rng_pptr++;
  }
  rng_pptr = 0;
  rng_seed_time();
}

function rng_get_byte(): number {
  if (rng_state == null) {
    rng_seed_time();
    rng_state = prng_newstate();
    rng_state.init(rng_pool);
    for (rng_pptr = 0; rng_pptr < rng_pool.length; ++rng_pptr) rng_pool[rng_pptr] = 0;
    rng_pptr = 0;
  }
  // TODO: allow reseeding after first request
  return rng_state.next();
}

class SecureRandom {
  nextBytes(ba: number[]): void {
    for (let i = 0; i < ba.length; ++i) ba[i] = rng_get_byte();
  }
}

// convert a (hex) string to a bignum object
function parseBigInt(str: string, r: number): BigInteger {
  const b = new BigInteger();
  b.fromString(str, r);
  return b;
}

// PKCS#1 (type 2, random) pad input string s to n bytes, and return a bigint.
// The original returns null when the message does not fit; every caller here
// passes a message that does, and RSAEncrypt's null check goes with it.
function pkcs1pad2(s: string, n: number): BigInteger {
  if (n < s.length + 11) {
    throw new Error("Message too long for RSA");
  }
  const ba: number[] = new Array<number>(n);
  let i = s.length - 1;
  while (i >= 0 && n > 0) {
    n--;
    ba[n] = s.charCodeAt(i);
    i--;
  }
  n--;
  ba[n] = 0;
  const rng = new SecureRandom();
  const x: number[] = new Array<number>(1);
  while (n > 2) {
    // random non-zero pad
    x[0] = 0;
    while (x[0] == 0) rng.nextBytes(x);
    n--;
    ba[n] = x[0];
  }
  n--;
  ba[n] = 2;
  n--;
  ba[n] = 0;
  const r = new BigInteger();
  r.fromBytes(ba);
  return r;
}

// Undo PKCS#1 (type 2, random) padding and, if valid, return the plaintext
function pkcs1unpad2(d: BigInteger, n: number): string {
  const b = d.toByteArray();
  let i = 0;
  while (i < b.length && b[i] == 0) ++i;
  if (b.length - i != n - 1 || b[i] != 2) return "";
  ++i;
  while (b[i] != 0) {
    ++i;
    if (i >= b.length) return "";
  }
  let ret = "";
  ++i;
  while (i < b.length) {
    ret += String.fromCharCode(b[i]);
    ++i;
  }
  return ret;
}

// "empty" RSA key constructor
class RSAKey {
  n: BigInteger | null;
  e: number;
  d: BigInteger | null;
  p: BigInteger | null;
  q: BigInteger | null;
  dmp1: BigInteger | null;
  dmq1: BigInteger | null;
  coeff: BigInteger | null;

  constructor() {
    this.n = null;
    this.e = 0;
    this.d = null;
    this.p = null;
    this.q = null;
    this.dmp1 = null;
    this.dmq1 = null;
    this.coeff = null;
  }

  // Set the public key fields N and e from hex strings
  setPublic(N: string, E: string): void {
    if (N.length > 0 && E.length > 0) {
      this.n = parseBigInt(N, 16);
      this.e = parseInt(E, 16);
    } else throw new Error("Invalid RSA public key");
  }

  // Perform raw public operation on "x": return x^e (mod n)
  doPublic(x: BigInteger): BigInteger {
    return x.modPowInt(this.e, this.n!);
  }

  // Return the PKCS#1 RSA encryption of "text" as an even-length hex string
  encrypt(text: string): string {
    const m = pkcs1pad2(text, (this.n!.bitLength() + 7) >> 3);
    const c = this.doPublic(m);
    const h = c.toStringRadix(16);
    if ((h.length & 1) == 0) return h;
    return "0" + h;
  }

  // Set the private key fields N, e, and d from hex strings
  setPrivate(N: string, E: string, D: string): void {
    if (N.length > 0 && E.length > 0) {
      this.n = parseBigInt(N, 16);
      this.e = parseInt(E, 16);
      this.d = parseBigInt(D, 16);
    } else throw new Error("Invalid RSA private key");
  }

  // Set the private key fields N, e, d and CRT params from hex strings
  setPrivateEx(N: string, E: string, D: string, P: string, Q: string, DP: string, DQ: string, C: string): void {
    if (N.length > 0 && E.length > 0) {
      this.n = parseBigInt(N, 16);
      this.e = parseInt(E, 16);
      this.d = parseBigInt(D, 16);
      this.p = parseBigInt(P, 16);
      this.q = parseBigInt(Q, 16);
      this.dmp1 = parseBigInt(DP, 16);
      this.dmq1 = parseBigInt(DQ, 16);
      this.coeff = parseBigInt(C, 16);
    } else throw new Error("Invalid RSA private key");
  }

  // Generate a new random private key B bits long, using public expt E
  generate(B: number, E: string): void {
    const rng = new SecureRandom();
    const qs = B >> 1;
    this.e = parseInt(E, 16);
    const ee = new BigInteger();
    ee.fromString(E, 16);
    for (;;) {
      for (;;) {
        const p = nbi();
        p.fromNumber(B - qs, 1, rng);
        this.p = p;
        if (p.subtract(ONE).gcd(ee).compareTo(ONE) == 0 && p.isProbablePrime(10)) break;
      }
      for (;;) {
        const q = nbi();
        q.fromNumber(qs, 1, rng);
        this.q = q;
        if (q.subtract(ONE).gcd(ee).compareTo(ONE) == 0 && q.isProbablePrime(10)) break;
      }
      if (this.p!.compareTo(this.q!) <= 0) {
        const t = this.p;
        this.p = this.q;
        this.q = t;
      }
      const p1 = this.p!.subtract(ONE);
      const q1 = this.q!.subtract(ONE);
      const phi = p1.multiply(q1);
      if (phi.gcd(ee).compareTo(ONE) == 0) {
        this.n = this.p!.multiply(this.q!);
        this.d = ee.modInverse(phi);
        this.dmp1 = this.d.mod(p1);
        this.dmq1 = this.d.mod(q1);
        this.coeff = this.q!.modInverse(this.p!);
        break;
      }
    }
  }

  // Perform raw private operation on "x": return x^d (mod n)
  doPrivate(x: BigInteger): BigInteger {
    if (this.p == null || this.q == null) return x.modPow(this.d!, this.n!);

    // TODO: re-calculate any missing CRT params
    let xp = x.mod(this.p).modPow(this.dmp1!, this.p);
    const xq = x.mod(this.q).modPow(this.dmq1!, this.q);

    while (xp.compareTo(xq) < 0) xp = xp.add(this.p);
    return xp.subtract(xq).multiply(this.coeff!).mod(this.p).multiply(this.q).add(xq);
  }

  // Return the PKCS#1 RSA decryption of "ctext".
  // "ctext" is an even-length hex string and the output is a plain string.
  decrypt(ctext: string): string {
    const c = parseBigInt(ctext, 16);
    const m = this.doPrivate(c);
    return pkcs1unpad2(m, (this.n!.bitLength() + 7) >> 3);
  }
}

const nValue =
  "a5261939975948bb7a58dffe5ff54e65f0498f9175f5a09288810b8975871e99af3b5dd94057b0fc07535f5f97444504fa35169d461d0d30cf0192e307727c065168c788771c561a9400fb49175e9e6aa4e23fe11af69e9412dd23b0cb6684c4c2429bce139e848ab26d0829073351f4acd36074eafd036a5eb83359d2a698d3";
const eValue = "10001";
const dValue =
  "8e9912f6d3645894e8d38cb58c0db81ff516cf4c7e5a14c7f1eddb1459d2cded4d8d293fc97aee6aefb861859c8b6a3d1dfe710463e1f9ddc72048c09751971c4a580aa51eb523357a3cc48d31cfad1d4a165066ed92d4748fb6571211da5cb14bc11b6e2df7c1a559e6d5ac1cd5c94703a22891464fba23d0d965086277a161";
const pValue = "d090ce58a92c75233a6486cb0a9209bf3583b64f540c76f5294bb97d285eed33aec220bde14b2417951178ac152ceab6da7090905b478195498b352048f15e7d";
const qValue = "cab575dc652bb66df15a0359609d51d1db184750c00c6698b90ef3465c99655103edbf0d54c56aec0ce3c4d22592338092a126a0cc49f65a4a30d222b411e58f";
const dmp1Value = "1a24bca8e273df2f0e47c199bbf678604e7df7215480c77c8db39f49b000ce2cf7500038acfff5433b7d582a01f1826e6f4d42e1c57f5e1fef7b12aabc59fd25";
const dmq1Value = "3d06982efbbe47339e1f6d36b1216b8a741d410b0c662f54f7118b27b9a4ec9d914337eb39841d8666f3034408cf94f5b62f11c402fc994fe15a05493150d9fd";
const coeffValue = "3a3e731acd8960b7ff9eb81a7ff93bd1cfa74cbd56987db58b4594fb09c09084db1734c8143f98b602b981aaa9243ca28deb69b5b280ee8dcee0fd2625e53250";

const TEXT =
  "The quick brown fox jumped over the extremely lazy frog! " + "Now is the time for all good men to come to the party.";
let encrypted = "";

export function cryptoSetup(): void {
  initRC();
  rng_init_pool();
}

export function runEncrypt(): void {
  const RSA = new RSAKey();
  RSA.setPublic(nValue, eValue);
  RSA.setPrivateEx(nValue, eValue, dValue, pValue, qValue, dmp1Value, dmq1Value, coeffValue);
  encrypted = RSA.encrypt(TEXT);
}

export function runDecrypt(): void {
  const RSA = new RSAKey();
  RSA.setPublic(nValue, eValue);
  RSA.setPrivateEx(nValue, eValue, dValue, pValue, qValue, dmp1Value, dmq1Value, coeffValue);
  const decrypted = RSA.decrypt(encrypted);
  if (decrypted != TEXT) {
    throw new Error("Crypto operation failed");
  }
}
