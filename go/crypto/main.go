// Crypto in Go, from the same code as v8-v7/crypto.js and ts/crypto.ts: Tom Wu's
// jsbn arbitrary-precision library and its RSA layer, encrypting and decrypting
// one PKCS#1 message with a 1024 bit key.
//
// The obvious Go program here would be twenty lines over math/big, and it would
// measure something else entirely: a different digit size, a different
// multiplication, and assembly inner loops. So this keeps jsbn's algorithm
// exactly, 28 bit digits and all, and changes only what a Go programmer would
// have to change to write it in Go at all.
//
// That comes down to two things. The digits are a []int rather than a JavaScript
// array of doubles, which is the whole point of the comparison: am3, the digit
// engine, splits each 28 bit digit into 14 bit halves precisely so that every
// intermediate fits in a double, and on a 64 bit machine those intermediates are
// just integers. And because a Go slice does not grow when you assign past its
// end, each routine reserves the digits it is about to write, which is what grow
// does below.
//
// Only what encrypt and decrypt reach is here. jsbn also carries key generation,
// primality testing, gcd, modular inverse, radix conversion and the bitwise
// operators; the benchmark calls none of it, so porting it would add code that
// never runs. What is here runs on every iteration, including the Barrett
// reducer, which modPow selects when the modulus is even and these keys never
// are.
package main

import (
	"math"
	"strconv"

	"github.com/tamnd/js-engine-benchmark/go/harness"
)

// Bits per digit, from the original's setupEngine(am3, 28).
const (
	dbits = 28
	dm    = (1 << dbits) - 1 // digit mask
	dv    = 1 << dbits       // digit value, one past the largest digit

	fp = 52
	f1 = fp - dbits
	f2 = 2*dbits - fp
)

var fv = math.Pow(2, fp)

// Digit conversions. rc maps a character code to its digit value and holds -1
// for a code that is not a digit, which is what the original's sparse array
// reads back as. It is filled by cryptoSetup, since a package initializer would
// run before the benchmark asks for any work.
const rm = "0123456789abcdefghijklmnopqrstuvwxyz"

var rc [128]int

func initRC() {
	for i := range rc {
		rc[i] = -1
	}
	r := '0'
	for v := 0; v <= 9; v++ {
		rc[r] = v
		r++
	}
	r = 'a'
	for v := 10; v < 36; v++ {
		rc[r] = v
		r++
	}
	r = 'A'
	for v := 10; v < 36; v++ {
		rc[r] = v
		r++
	}
}

func int2char(n int) byte { return rm[n] }

func intAt(s string, i int) int {
	c := s[i]
	if int(c) >= len(rc) {
		return -1
	}
	return rc[c]
}

// nbits is the bit length of x.
func nbits(x int) int {
	r := 1
	if t := x >> 16; t != 0 {
		x = t
		r += 16
	}
	if t := x >> 8; t != 0 {
		x = t
		r += 8
	}
	if t := x >> 4; t != 0 {
		x = t
		r += 4
	}
	if t := x >> 2; t != 0 {
		x = t
		r += 2
	}
	if t := x >> 1; t != 0 {
		r += 1
	}
	return r
}

// BigInteger is a sign-magnitude arbitrary-precision integer: d holds t digits
// of dbits bits each, least significant first, and s is 0 for a non-negative
// value and -1 for a negative one.
type BigInteger struct {
	d []int
	t int
	s int
}

// nbi is a new, unset BigInteger.
func nbi() *BigInteger { return &BigInteger{} }

// nbv is a BigInteger holding the value i.
func nbv(i int) *BigInteger {
	r := nbi()
	r.fromInt(i)
	return r
}

var (
	zero = nbv(0)
	one  = nbv(1)
)

// grow makes room for n digits. The JavaScript writes digits by index and lets
// the array extend itself; here each routine reserves what it is about to write
// before it writes it.
func (x *BigInteger) grow(n int) {
	if n > len(x.d) {
		d := make([]int, n)
		copy(d, x.d)
		x.d = d
	}
}

// am is am3, the engine setupEngine installs: 28 bit digits split into 14 bit
// halves so every intermediate stays inside a double's integer range. It
// computes w[j..j+n-1] += x * this[i..i+n-1] + c and returns the carry out.
func (x *BigInteger) am(i, mult int, w *BigInteger, j, c, n int) int {
	xl := mult & 0x3fff
	xh := mult >> 14
	for ; n > 0; n-- {
		l := x.d[i] & 0x3fff
		h := x.d[i] >> 14
		i++
		m := xh*l + h*xl
		l = xl*l + ((m & 0x3fff) << 14) + w.d[j] + c
		c = (l >> 28) + (m >> 14) + xh*h
		w.d[j] = l & 0xfffffff
		j++
	}
	return c
}

// copyTo copies x to r.
func (x *BigInteger) copyTo(r *BigInteger) {
	r.grow(x.t)
	for i := x.t - 1; i >= 0; i-- {
		r.d[i] = x.d[i]
	}
	r.t = x.t
	r.s = x.s
}

// fromInt sets x from an integer value, -dv <= v < dv.
func (x *BigInteger) fromInt(v int) {
	x.grow(1)
	x.t = 1
	x.s = 0
	if v < 0 {
		x.s = -1
	}
	switch {
	case v > 0:
		x.d[0] = v
	case v < -1:
		x.d[0] = v + dv
	default:
		x.t = 0
	}
}

// fromString sets x from a string in a radix that is a power of two. The
// original's one fromString also takes a byte array when b is 256; that shape is
// fromBytes below.
func (x *BigInteger) fromString(s string, b int) {
	var k int
	switch b {
	case 16:
		k = 4
	case 8:
		k = 3
	case 2:
		k = 1
	case 32:
		k = 5
	case 4:
		k = 2
	default:
		panic("unsupported radix")
	}
	x.grow(len(s)*k/dbits + 2)
	x.t = 0
	x.s = 0
	mi := false
	sh := 0
	for i := len(s) - 1; i >= 0; i-- {
		v := intAt(s, i)
		if v < 0 {
			if s[i] == '-' {
				mi = true
			}
			continue
		}
		mi = false
		switch {
		case sh == 0:
			x.d[x.t] = v
			x.t++
		case sh+k > dbits:
			x.d[x.t-1] |= (v & ((1 << (dbits - sh)) - 1)) << sh
			x.d[x.t] = v >> (dbits - sh)
			x.t++
		default:
			x.d[x.t-1] |= v << sh
		}
		sh += k
		if sh >= dbits {
			sh -= dbits
		}
	}
	x.clamp()
	if mi {
		zero.subTo(x, x)
	}
}

// fromBytes is the b == 256 arm of the original's fromString, where the input is
// a big-endian byte array rather than a string of digits and k is 8.
func (x *BigInteger) fromBytes(s []int) {
	const k = 8
	x.grow(len(s)*k/dbits + 2)
	x.t = 0
	x.s = 0
	sh := 0
	for i := len(s) - 1; i >= 0; i-- {
		v := s[i] & 0xff
		switch {
		case sh == 0:
			x.d[x.t] = v
			x.t++
		case sh+k > dbits:
			x.d[x.t-1] |= (v & ((1 << (dbits - sh)) - 1)) << sh
			x.d[x.t] = v >> (dbits - sh)
			x.t++
		default:
			x.d[x.t-1] |= v << sh
		}
		sh += k
		if sh >= dbits {
			sh -= dbits
		}
	}
	if s[0]&0x80 != 0 {
		x.s = -1
		if sh > 0 {
			x.d[x.t-1] |= ((1 << (dbits - sh)) - 1) << sh
		}
	}
	x.clamp()
}

// clamp drops the high digits that only repeat the sign.
func (x *BigInteger) clamp() {
	c := x.s & dm
	for x.t > 0 && x.d[x.t-1] == c {
		x.t--
	}
}

// toStringRadix renders x in a radix that is a power of two. It is the
// original's toString, renamed because Go's fmt would reach for that name.
func (x *BigInteger) toStringRadix(b int) string {
	if x.s < 0 {
		return "-" + x.negate().toStringRadix(b)
	}
	var k int
	switch b {
	case 16:
		k = 4
	case 8:
		k = 3
	case 2:
		k = 1
	case 32:
		k = 5
	case 4:
		k = 2
	default:
		panic("unsupported radix")
	}
	km := (1 << k) - 1
	d := 0
	m := false
	var r []byte
	i := x.t
	p := dbits - (i*dbits)%k
	i--
	if i >= 0 {
		if p < dbits {
			d = x.d[i] >> p
			if d > 0 {
				m = true
				r = append(r, int2char(d))
			}
		}
		for i >= 0 {
			if p < k {
				d = (x.d[i] & ((1 << p) - 1)) << (k - p)
				i--
				p += dbits - k
				d |= x.d[i] >> p
			} else {
				p -= k
				d = (x.d[i] >> p) & km
				if p <= 0 {
					p += dbits
					i--
				}
			}
			if d > 0 {
				m = true
			}
			if m {
				r = append(r, int2char(d))
			}
		}
	}
	if !m {
		return "0"
	}
	return string(r)
}

// negate is -x.
func (x *BigInteger) negate() *BigInteger {
	r := nbi()
	zero.subTo(x, r)
	return r
}

// abs is |x|.
func (x *BigInteger) abs() *BigInteger {
	if x.s < 0 {
		return x.negate()
	}
	return x
}

// compareTo is positive if x > a, negative if x < a, zero if they are equal.
func (x *BigInteger) compareTo(a *BigInteger) int {
	if r := x.s - a.s; r != 0 {
		return r
	}
	i := x.t
	if r := i - a.t; r != 0 {
		return r
	}
	for i--; i >= 0; i-- {
		if r := x.d[i] - a.d[i]; r != 0 {
			return r
		}
	}
	return 0
}

// bitLength is the number of bits in x.
func (x *BigInteger) bitLength() int {
	if x.t <= 0 {
		return 0
	}
	return dbits*(x.t-1) + nbits(x.d[x.t-1]^(x.s&dm))
}

// dlShiftTo sets r = x << n*dbits, a shift by whole digits.
func (x *BigInteger) dlShiftTo(n int, r *BigInteger) {
	r.grow(x.t + n)
	for i := x.t - 1; i >= 0; i-- {
		r.d[i+n] = x.d[i]
	}
	for i := n - 1; i >= 0; i-- {
		r.d[i] = 0
	}
	r.t = x.t + n
	r.s = x.s
}

// drShiftTo sets r = x >> n*dbits.
func (x *BigInteger) drShiftTo(n int, r *BigInteger) {
	if x.t-n > 0 {
		r.grow(x.t - n)
	}
	for i := n; i < x.t; i++ {
		r.d[i-n] = x.d[i]
	}
	r.t = x.t - n
	if r.t < 0 {
		r.t = 0
	}
	r.s = x.s
}

// lShiftTo sets r = x << n.
func (x *BigInteger) lShiftTo(n int, r *BigInteger) {
	bs := n % dbits
	cbs := dbits - bs
	bm := (1 << cbs) - 1
	ds := n / dbits
	r.grow(x.t + ds + 1)
	c := (x.s << bs) & dm
	for i := x.t - 1; i >= 0; i-- {
		r.d[i+ds+1] = (x.d[i] >> cbs) | c
		c = (x.d[i] & bm) << bs
	}
	for i := ds - 1; i >= 0; i-- {
		r.d[i] = 0
	}
	r.d[ds] = c
	r.t = x.t + ds + 1
	r.s = x.s
	r.clamp()
}

// rShiftTo sets r = x >> n.
func (x *BigInteger) rShiftTo(n int, r *BigInteger) {
	r.s = x.s
	ds := n / dbits
	if ds >= x.t {
		r.t = 0
		return
	}
	bs := n % dbits
	cbs := dbits - bs
	bm := (1 << bs) - 1
	r.grow(x.t - ds)
	r.d[0] = x.d[ds] >> bs
	for i := ds + 1; i < x.t; i++ {
		r.d[i-ds-1] |= (x.d[i] & bm) << cbs
		r.d[i-ds] = x.d[i] >> bs
	}
	if bs > 0 {
		r.d[x.t-ds-1] |= (x.s & bm) << cbs
	}
	r.t = x.t - ds
	r.clamp()
}

// subTo sets r = x - a.
func (x *BigInteger) subTo(a, r *BigInteger) {
	n := x.t
	if a.t > n {
		n = a.t
	}
	r.grow(n + 1)
	i := 0
	c := 0
	m := a.t
	if x.t < m {
		m = x.t
	}
	for i < m {
		c += x.d[i] - a.d[i]
		r.d[i] = c & dm
		i++
		c >>= dbits
	}
	if a.t < x.t {
		c -= a.s
		for i < x.t {
			c += x.d[i]
			r.d[i] = c & dm
			i++
			c >>= dbits
		}
		c += x.s
	} else {
		c += x.s
		for i < a.t {
			c -= a.d[i]
			r.d[i] = c & dm
			i++
			c >>= dbits
		}
		c -= a.s
	}
	r.s = 0
	if c < 0 {
		r.s = -1
	}
	if c < -1 {
		r.d[i] = dv + c
		i++
	} else if c > 0 {
		r.d[i] = c
		i++
	}
	r.t = i
	r.clamp()
}

// addTo sets r = x + a.
func (x *BigInteger) addTo(a, r *BigInteger) {
	n := x.t
	if a.t > n {
		n = a.t
	}
	r.grow(n + 1)
	i := 0
	c := 0
	m := a.t
	if x.t < m {
		m = x.t
	}
	for i < m {
		c += x.d[i] + a.d[i]
		r.d[i] = c & dm
		i++
		c >>= dbits
	}
	if a.t < x.t {
		c += a.s
		for i < x.t {
			c += x.d[i]
			r.d[i] = c & dm
			i++
			c >>= dbits
		}
		c += x.s
	} else {
		c += x.s
		for i < a.t {
			c += a.d[i]
			r.d[i] = c & dm
			i++
			c >>= dbits
		}
		c += a.s
	}
	r.s = 0
	if c < 0 {
		r.s = -1
	}
	if c > 0 {
		r.d[i] = c
		i++
	} else if c < -1 {
		r.d[i] = dv + c
		i++
	}
	r.t = i
	r.clamp()
}

// multiplyTo sets r = x * a, with r distinct from both (HAC 14.12). x should be
// the larger of the two.
func (x *BigInteger) multiplyTo(a, r *BigInteger) {
	xa := x.abs()
	y := a.abs()
	r.grow(xa.t + y.t)
	i := xa.t
	r.t = i + y.t
	for i--; i >= 0; i-- {
		r.d[i] = 0
	}
	for i = 0; i < y.t; i++ {
		r.d[i+xa.t] = xa.am(0, y.d[i], r, i, 0, xa.t)
	}
	r.s = 0
	r.clamp()
	if x.s != a.s {
		zero.subTo(r, r)
	}
}

// squareTo sets r = x^2, with r distinct from x (HAC 14.16).
func (x *BigInteger) squareTo(r *BigInteger) {
	xa := x.abs()
	r.grow(2*xa.t + 1)
	r.t = 2 * xa.t
	for i := r.t - 1; i >= 0; i-- {
		r.d[i] = 0
	}
	i := 0
	for ; i < xa.t-1; i++ {
		c := xa.am(i, xa.d[i], r, 2*i, 0, 1)
		r.d[i+xa.t] += xa.am(i+1, 2*xa.d[i], r, 2*i+1, c, xa.t-i-1)
		if r.d[i+xa.t] >= dv {
			r.d[i+xa.t] -= dv
			r.d[i+xa.t+1] = 1
		}
	}
	if r.t > 0 {
		r.d[r.t-1] += xa.am(i, xa.d[i], r, 2*i, 0, 1)
	}
	r.s = 0
	r.clamp()
}

// divRemTo divides x by m, putting the quotient in q and the remainder in r
// (HAC 14.20). q and r must be distinct, x and m must be distinct, and either of
// q and r may be nil.
func (x *BigInteger) divRemTo(m *BigInteger, q, r *BigInteger) {
	pm := m.abs()
	if pm.t <= 0 {
		return
	}
	pt := x.abs()
	if pt.t < pm.t {
		if q != nil {
			q.fromInt(0)
		}
		if r != nil {
			x.copyTo(r)
		}
		return
	}
	if r == nil {
		r = nbi()
	}
	y := nbi()
	ts := x.s
	ms := m.s
	nsh := dbits - nbits(pm.d[pm.t-1]) // normalize modulus
	if nsh > 0 {
		pm.lShiftTo(nsh, y)
		pt.lShiftTo(nsh, r)
	} else {
		pm.copyTo(y)
		pt.copyTo(r)
	}
	ys := y.t

	y0 := y.d[ys-1]
	if y0 == 0 {
		return
	}
	yt := float64(y0) * float64(int(1)<<f1)
	if ys > 1 {
		yt += float64(y.d[ys-2] >> f2)
	}
	d1 := fv / yt
	d2 := float64(int(1)<<f1) / yt
	e := 1 << f2
	i := r.t
	j := i - ys
	t := q
	if t == nil {
		t = nbi()
	}
	y.dlShiftTo(j, t)

	r.grow(r.t + 1)
	if r.compareTo(t) >= 0 {
		r.d[r.t] = 1
		r.t++
		r.subTo(t, r)
	}
	one.dlShiftTo(ys, t)
	t.subTo(y, y) // "negative" y so we can replace sub with am later
	y.grow(ys)
	for y.t < ys {
		y.d[y.t] = 0
		y.t++
	}
	for j--; j >= 0; j-- {
		// Estimate the quotient digit.
		i--
		qd := dm
		if r.d[i] != y0 {
			qd = int(math.Floor(float64(r.d[i])*d1 + float64(r.d[i-1]+e)*d2))
		}
		r.d[i] += y.am(0, qd, r, j, 0, ys)
		if r.d[i] < qd {
			// Try it out.
			y.dlShiftTo(j, t)
			r.subTo(t, r)
			qd--
			for r.d[i] < qd {
				r.subTo(t, r)
				qd--
			}
		}
	}
	if q != nil {
		r.drShiftTo(ys, q)
		if ts != ms {
			zero.subTo(q, q)
		}
	}
	r.t = ys
	r.clamp()
	if nsh > 0 {
		r.rShiftTo(nsh, r) // denormalize the remainder
	}
	if ts < 0 {
		zero.subTo(r, r)
	}
}

// mod is x mod a.
func (x *BigInteger) mod(a *BigInteger) *BigInteger {
	r := nbi()
	x.abs().divRemTo(a, nil, r)
	if x.s < 0 && r.compareTo(zero) > 0 {
		a.subTo(r, r)
	}
	return r
}

// invDigit is -1/x[0] mod 2^dbits, which is what Montgomery reduction needs.
func (x *BigInteger) invDigit() int {
	if x.t < 1 {
		return 0
	}
	v := x.d[0]
	if v&1 == 0 {
		return 0
	}
	y := v & 3                                             // y == 1/v mod 2^2
	y = (y * (2 - (v&0xf)*y)) & 0xf                        // y == 1/v mod 2^4
	y = (y * (2 - (v&0xff)*y)) & 0xff                      // y == 1/v mod 2^8
	y = (y * (2 - (((v & 0xffff) * y) & 0xffff))) & 0xffff // y == 1/v mod 2^16
	// Last step: the inverse mod dv directly. This assumes 16 < dbits <= 32 and
	// the ability to handle 48 bit integers, which a double can and an int can.
	y = (y * (2 - (v*y)%dv)) % dv
	// What is wanted is the negative inverse, and -dv < y < dv.
	if y > 0 {
		return dv - y
	}
	return -y
}

// isEven answers whether x is even.
func (x *BigInteger) isEven() bool {
	if x.t > 0 {
		return x.d[0]&1 == 0
	}
	return x.s == 0
}

// exp is x^e for e < 2^32, squaring and multiplying inside the reducer z
// (HAC 14.79).
func (x *BigInteger) exp(e int, z reducer) *BigInteger {
	if e > 0xffffffff || e < 1 {
		return one
	}
	r := nbi()
	r2 := nbi()
	g := z.convert(x)
	i := nbits(e) - 1
	g.copyTo(r)
	for i--; i >= 0; i-- {
		z.sqrTo(r, r2)
		if e&(1<<i) > 0 {
			z.mulTo(r2, g, r)
		} else {
			r, r2 = r2, r
		}
	}
	return z.revert(r)
}

// modPowInt is x^e mod m for 0 <= e < 2^32.
func (x *BigInteger) modPowInt(e int, m *BigInteger) *BigInteger {
	var z reducer
	if e < 256 || m.isEven() {
		z = newClassic(m)
	} else {
		z = newMontgomery(m)
	}
	return x.exp(e, z)
}

func (x *BigInteger) add(a *BigInteger) *BigInteger {
	r := nbi()
	x.addTo(a, r)
	return r
}

func (x *BigInteger) subtract(a *BigInteger) *BigInteger {
	r := nbi()
	x.subTo(a, r)
	return r
}

func (x *BigInteger) multiply(a *BigInteger) *BigInteger {
	r := nbi()
	x.multiplyTo(a, r)
	return r
}

func (x *BigInteger) divide(a *BigInteger) *BigInteger {
	r := nbi()
	x.divRemTo(a, r, nil)
	return r
}

// dAddOffset adds n << w digits to x, for x >= 0.
func (x *BigInteger) dAddOffset(n, w int) {
	x.grow(w + 2)
	for x.t <= w {
		x.d[x.t] = 0
		x.t++
	}
	x.d[w] += n
	for x.d[w] >= dv {
		x.d[w] -= dv
		w++
		x.grow(w + 2)
		if w >= x.t {
			x.d[x.t] = 0
			x.t++
		}
		x.d[w]++
	}
}

// multiplyLowerTo sets r to the low n digits of x * a, for a.t <= n. x should be
// the larger of the two.
func (x *BigInteger) multiplyLowerTo(a *BigInteger, n int, r *BigInteger) {
	r.grow(n + 1)
	i := x.t + a.t
	if n < i {
		i = n
	}
	r.s = 0 // assumes a and x are non-negative
	r.t = i
	for i > 0 {
		i--
		r.d[i] = 0
	}
	for j := r.t - x.t; i < j; i++ {
		r.d[i+x.t] = x.am(0, a.d[i], r, i, 0, x.t)
	}
	j := a.t
	if n < j {
		j = n
	}
	for ; i < j; i++ {
		x.am(0, a.d[i], r, i, 0, n-i)
	}
	r.clamp()
}

// multiplyUpperTo sets r to x * a without its low n digits, for n > 0. x should
// be the larger of the two.
func (x *BigInteger) multiplyUpperTo(a *BigInteger, n int, r *BigInteger) {
	n--
	r.grow(x.t + a.t - n + 1)
	r.t = x.t + a.t - n
	r.s = 0 // assumes a and x are non-negative
	for i := r.t - 1; i >= 0; i-- {
		r.d[i] = 0
	}
	i := n - x.t
	if i < 0 {
		i = 0
	}
	for ; i < a.t; i++ {
		r.d[x.t+i-n] = x.am(n-i, a.d[i], r, 0, 0, x.t+i-n)
	}
	r.clamp()
	r.drShiftTo(1, r)
}

// modPow is x^e mod m (HAC 14.85), the sliding-window exponentiation the
// decrypt half of the benchmark spends its time in.
func (x *BigInteger) modPow(e, m *BigInteger) *BigInteger {
	i := e.bitLength()
	r := nbv(1)
	if i <= 0 {
		return r
	}
	var k int
	switch {
	case i < 18:
		k = 1
	case i < 48:
		k = 3
	case i < 144:
		k = 4
	case i < 768:
		k = 5
	default:
		k = 6
	}
	var z reducer
	switch {
	case i < 8:
		z = newClassic(m)
	case m.isEven():
		z = newBarrett(m)
	default:
		z = newMontgomery(m)
	}

	// Precompute the odd powers of x up to 2^k - 1.
	km := (1 << k) - 1
	g := make([]*BigInteger, km+1)
	k1 := k - 1
	g[1] = z.convert(x)
	if k > 1 {
		g2 := nbi()
		z.sqrTo(g[1], g2)
		for n := 3; n <= km; n += 2 {
			g[n] = nbi()
			z.mulTo(g2, g[n-2], g[n])
		}
	}

	j := e.t - 1
	is1 := true
	r2 := nbi()
	i = nbits(e.d[j]) - 1
	for j >= 0 {
		var w int
		if i >= k1 {
			w = (e.d[j] >> (i - k1)) & km
		} else {
			w = (e.d[j] & ((1 << (i + 1)) - 1)) << (k1 - i)
			if j > 0 {
				w |= e.d[j-1] >> (dbits + i - k1)
			}
		}

		n := k
		for w&1 == 0 {
			w >>= 1
			n--
		}
		i -= n
		if i < 0 {
			i += dbits
			j--
		}
		if is1 {
			// The result is still 1, so there is nothing to square or multiply.
			g[w].copyTo(r)
			is1 = false
		} else {
			for n > 1 {
				z.sqrTo(r, r2)
				z.sqrTo(r2, r)
				n -= 2
			}
			if n > 0 {
				z.sqrTo(r, r2)
			} else {
				r, r2 = r2, r
			}
			z.mulTo(r2, g[w], r)
		}

		for j >= 0 && e.d[j]&(1<<i) == 0 {
			z.sqrTo(r, r2)
			r, r2 = r2, r
			i--
			if i < 0 {
				i = dbits - 1
				j--
			}
		}
	}
	return z.revert(r)
}

// toByteArray renders x as a big-endian byte array. The bytes are ints because
// the original sign-extends them, and the caller only reads the ones it wrote.
func (x *BigInteger) toByteArray() []int {
	i := x.t
	r := []int{x.s}
	p := dbits - (i*dbits)%8
	d := 0
	k := 0
	i--
	if i >= 0 {
		if p < dbits {
			d = x.d[i] >> p
			if d != (x.s&dm)>>p {
				r[k] = d | (x.s << (dbits - p))
				k++
			}
		}
		for i >= 0 {
			if p < 8 {
				d = (x.d[i] & ((1 << p) - 1)) << (8 - p)
				i--
				p += dbits - 8
				d |= x.d[i] >> p
			} else {
				p -= 8
				d = (x.d[i] >> p) & 0xff
				if p <= 0 {
					p += dbits
					i--
				}
			}
			if d&0x80 != 0 {
				d |= -256
			}
			if k == 0 && (x.s&0x80) != (d&0x80) {
				k++
			}
			if k > 0 || d != x.s {
				if k < len(r) {
					r[k] = d
				} else {
					r = append(r, d)
				}
				k++
			}
		}
	}
	return r
}

// reducer is what exp and modPow work through: convert into the reduction's
// representation, multiply and square inside it, revert out. The original writes
// the same five names onto four unrelated prototypes.
type reducer interface {
	convert(x *BigInteger) *BigInteger
	revert(x *BigInteger) *BigInteger
	reduce(x *BigInteger)
	mulTo(x, y, r *BigInteger)
	sqrTo(x, r *BigInteger)
}

// classic reduces by dividing and keeping the remainder.
type classic struct {
	m *BigInteger
}

func newClassic(m *BigInteger) *classic { return &classic{m: m} }

func (c *classic) convert(x *BigInteger) *BigInteger {
	if x.s < 0 || x.compareTo(c.m) >= 0 {
		return x.mod(c.m)
	}
	return x
}

func (c *classic) revert(x *BigInteger) *BigInteger { return x }

func (c *classic) reduce(x *BigInteger) { x.divRemTo(c.m, nil, x) }

func (c *classic) mulTo(x, y, r *BigInteger) {
	x.multiplyTo(y, r)
	c.reduce(r)
}

func (c *classic) sqrTo(x, r *BigInteger) {
	x.squareTo(r)
	c.reduce(r)
}

// montgomery reduces in Montgomery form, which turns the division into a
// multiply and a shift. It needs an odd modulus.
type montgomery struct {
	m        *BigInteger
	mp       int
	mpl, mph int
	um       int
	mt2      int
}

func newMontgomery(m *BigInteger) *montgomery {
	mp := m.invDigit()
	return &montgomery{
		m:   m,
		mp:  mp,
		mpl: mp & 0x7fff,
		mph: mp >> 15,
		um:  (1 << (dbits - 15)) - 1,
		mt2: 2 * m.t,
	}
}

// convert is xR mod m.
func (mo *montgomery) convert(x *BigInteger) *BigInteger {
	r := nbi()
	x.abs().dlShiftTo(mo.m.t, r)
	r.divRemTo(mo.m, nil, r)
	if x.s < 0 && r.compareTo(zero) > 0 {
		mo.m.subTo(r, r)
	}
	return r
}

// revert is x/R mod m.
func (mo *montgomery) revert(x *BigInteger) *BigInteger {
	r := nbi()
	x.copyTo(r)
	mo.reduce(r)
	return r
}

// reduce sets x = x/R mod m (HAC 14.32).
func (mo *montgomery) reduce(x *BigInteger) {
	x.grow(mo.mt2 + 2)
	for x.t <= mo.mt2 {
		// Pad x so am has enough room later.
		x.d[x.t] = 0
		x.t++
	}
	for i := 0; i < mo.m.t; i++ {
		// A faster way of calculating u0 = x[i]*mp mod dv.
		j := x.d[i] & 0x7fff
		u0 := (j*mo.mpl + (((j*mo.mph + (x.d[i]>>15)*mo.mpl) & mo.um) << 15)) & dm
		// Use am to combine the multiply, shift and add into one call.
		j = i + mo.m.t
		x.d[j] += mo.m.am(0, u0, x, i, 0, mo.m.t)
		// Propagate the carry.
		for x.d[j] >= dv {
			x.d[j] -= dv
			j++
			x.d[j]++
		}
	}
	x.clamp()
	x.drShiftTo(mo.m.t, x)
	if x.compareTo(mo.m) >= 0 {
		x.subTo(mo.m, x)
	}
}

func (mo *montgomery) mulTo(x, y, r *BigInteger) {
	x.multiplyTo(y, r)
	mo.reduce(r)
}

func (mo *montgomery) sqrTo(x, r *BigInteger) {
	x.squareTo(r)
	mo.reduce(r)
}

// barrett reduces with a precomputed reciprocal, which is what modPow picks for
// an even modulus. These keys are odd, so nothing here runs; it is kept because
// modPow chooses between all three.
type barrett struct {
	r2, q3, mu, m *BigInteger
}

func newBarrett(m *BigInteger) *barrett {
	b := &barrett{r2: nbi(), q3: nbi(), m: m}
	one.dlShiftTo(2*m.t, b.r2)
	b.mu = b.r2.divide(m)
	return b
}

func (b *barrett) convert(x *BigInteger) *BigInteger {
	if x.s < 0 || x.t > 2*b.m.t {
		return x.mod(b.m)
	}
	if x.compareTo(b.m) < 0 {
		return x
	}
	r := nbi()
	x.copyTo(r)
	b.reduce(r)
	return r
}

func (b *barrett) revert(x *BigInteger) *BigInteger { return x }

// reduce sets x = x mod m (HAC 14.42).
func (b *barrett) reduce(x *BigInteger) {
	x.drShiftTo(b.m.t-1, b.r2)
	if x.t > b.m.t+1 {
		x.t = b.m.t + 1
		x.clamp()
	}
	b.mu.multiplyUpperTo(b.r2, b.m.t+1, b.q3)
	b.m.multiplyLowerTo(b.q3, b.m.t+1, b.r2)
	for x.compareTo(b.r2) < 0 {
		x.dAddOffset(1, b.m.t+1)
	}
	x.subTo(b.r2, x)
	for x.compareTo(b.m) >= 0 {
		x.subTo(b.m, x)
	}
}

func (b *barrett) mulTo(x, y, r *BigInteger) {
	x.multiplyTo(y, r)
	b.reduce(r)
}

func (b *barrett) sqrTo(x, r *BigInteger) {
	x.squareTo(r)
	b.reduce(r)
}

// arcfour is the RC4 stream cipher, used here as the PRNG that pads the message.
type arcfour struct {
	i, j int
	s    [256]int
}

// init keys the cipher from an array of bytes.
func (a *arcfour) init(key []int) {
	for i := 0; i < 256; i++ {
		a.s[i] = i
	}
	j := 0
	for i := 0; i < 256; i++ {
		j = (j + a.s[i] + key[i%len(key)]) & 255
		a.s[i], a.s[j] = a.s[j], a.s[i]
	}
	a.i = 0
	a.j = 0
}

func (a *arcfour) next() int {
	a.i = (a.i + 1) & 255
	a.j = (a.j + a.s[a.i]) & 255
	t := a.s[a.i]
	a.s[a.i], a.s[a.j] = a.s[a.j], a.s[a.i]
	return a.s[(t+a.s[a.i])&255]
}

// The pool size must be a multiple of 4 and greater than 32. An array of bytes
// the size of the pool is passed to init.
const rngPoolSize = 256

var (
	rngState *arcfour
	rngPool  [rngPoolSize]int
	rngPtr   int
)

// rngSeedInt mixes a 32 bit integer into the pool.
func rngSeedInt(x int) {
	rngPool[rngPtr] ^= x & 255
	rngPtr++
	rngPool[rngPtr] ^= (x >> 8) & 255
	rngPtr++
	rngPool[rngPtr] ^= (x >> 16) & 255
	rngPtr++
	rngPool[rngPtr] ^= (x >> 24) & 255
	rngPtr++
	if rngPtr >= rngPoolSize {
		rngPtr -= rngPoolSize
	}
}

// rngSeedTime mixes in a fixed date rather than the current time, so the
// benchmark's results do not depend on when it is run.
func rngSeedTime() { rngSeedInt(1122926989487) }

// rngInitPool fills the pool. The original does this in a top-level block, which
// runs once before any benchmark work, which is what setup is for.
func rngInitPool() {
	rngState = nil
	rngPtr = 0
	for rngPtr < rngPoolSize {
		t := int(math.Floor(65536 * harness.Random()))
		rngPool[rngPtr] = t >> 8
		rngPtr++
		rngPool[rngPtr] = t & 255
		rngPtr++
	}
	rngPtr = 0
	rngSeedTime()
}

func rngGetByte() int {
	if rngState == nil {
		rngSeedTime()
		rngState = &arcfour{}
		rngState.init(rngPool[:])
		for rngPtr = 0; rngPtr < len(rngPool); rngPtr++ {
			rngPool[rngPtr] = 0
		}
		rngPtr = 0
	}
	// The original leaves reseeding after the first request as a TODO.
	return rngState.next()
}

func nextBytes(ba []int) {
	for i := range ba {
		ba[i] = rngGetByte()
	}
}

// parseBigInt converts a hex string to a BigInteger.
func parseBigInt(s string, r int) *BigInteger {
	b := nbi()
	b.fromString(s, r)
	return b
}

// pkcs1pad2 pads the message to n bytes, PKCS#1 type 2 with random padding, and
// returns it as a BigInteger. The original returns null when the message does
// not fit; every caller here passes one that does.
func pkcs1pad2(s string, n int) *BigInteger {
	if n < len(s)+11 {
		panic("message too long for RSA")
	}
	ba := make([]int, n)
	i := len(s) - 1
	for i >= 0 && n > 0 {
		n--
		ba[n] = int(s[i])
		i--
	}
	n--
	ba[n] = 0
	x := make([]int, 1)
	for n > 2 {
		// Random non-zero pad.
		x[0] = 0
		for x[0] == 0 {
			nextBytes(x)
		}
		n--
		ba[n] = x[0]
	}
	n--
	ba[n] = 2
	n--
	ba[n] = 0
	r := nbi()
	r.fromBytes(ba)
	return r
}

// pkcs1unpad2 strips the padding and returns the plaintext, or the empty string
// if the padding is not well formed.
func pkcs1unpad2(d *BigInteger, n int) string {
	b := d.toByteArray()
	i := 0
	for i < len(b) && b[i] == 0 {
		i++
	}
	if len(b)-i != n-1 || b[i] != 2 {
		return ""
	}
	i++
	for b[i] != 0 {
		i++
		if i >= len(b) {
			return ""
		}
	}
	i++
	ret := make([]byte, 0, len(b)-i)
	for ; i < len(b); i++ {
		ret = append(ret, byte(b[i]))
	}
	return string(ret)
}

// RSAKey holds the public modulus and exponent and, for decryption, the private
// exponent and the CRT parameters.
type RSAKey struct {
	n          *BigInteger
	e          int
	d          *BigInteger
	p, q       *BigInteger
	dmp1, dmq1 *BigInteger
	coeff      *BigInteger
}

// setPublic sets the public key fields N and e from hex strings.
func (k *RSAKey) setPublic(n, e string) {
	if n == "" || e == "" {
		panic("invalid RSA public key")
	}
	k.n = parseBigInt(n, 16)
	k.e = parseHex(e)
}

// setPrivateEx sets the private key fields N, e, d and the CRT parameters from
// hex strings.
func (k *RSAKey) setPrivateEx(n, e, d, p, q, dp, dq, c string) {
	if n == "" || e == "" {
		panic("invalid RSA private key")
	}
	k.n = parseBigInt(n, 16)
	k.e = parseHex(e)
	k.d = parseBigInt(d, 16)
	k.p = parseBigInt(p, 16)
	k.q = parseBigInt(q, 16)
	k.dmp1 = parseBigInt(dp, 16)
	k.dmq1 = parseBigInt(dq, 16)
	k.coeff = parseBigInt(c, 16)
}

func parseHex(s string) int {
	v, err := strconv.ParseInt(s, 16, 64)
	if err != nil {
		panic(err)
	}
	return int(v)
}

// doPublic is the raw public operation on x: x^e mod n.
func (k *RSAKey) doPublic(x *BigInteger) *BigInteger {
	return x.modPowInt(k.e, k.n)
}

// encrypt returns the PKCS#1 RSA encryption of text as an even-length hex
// string.
func (k *RSAKey) encrypt(text string) string {
	m := pkcs1pad2(text, (k.n.bitLength()+7)>>3)
	h := k.doPublic(m).toStringRadix(16)
	if len(h)&1 == 0 {
		return h
	}
	return "0" + h
}

// doPrivate is the raw private operation on x: x^d mod n, by the Chinese
// remainder theorem when the CRT parameters are known.
func (k *RSAKey) doPrivate(x *BigInteger) *BigInteger {
	if k.p == nil || k.q == nil {
		return x.modPow(k.d, k.n)
	}
	xp := x.mod(k.p).modPow(k.dmp1, k.p)
	xq := x.mod(k.q).modPow(k.dmq1, k.q)

	for xp.compareTo(xq) < 0 {
		xp = xp.add(k.p)
	}
	return xp.subtract(xq).multiply(k.coeff).mod(k.p).multiply(k.q).add(xq)
}

// decrypt returns the PKCS#1 RSA decryption of an even-length hex string.
func (k *RSAKey) decrypt(ctext string) string {
	c := parseBigInt(ctext, 16)
	m := k.doPrivate(c)
	return pkcs1unpad2(m, (k.n.bitLength()+7)>>3)
}

const (
	nValue     = "a5261939975948bb7a58dffe5ff54e65f0498f9175f5a09288810b8975871e99af3b5dd94057b0fc07535f5f97444504fa35169d461d0d30cf0192e307727c065168c788771c561a9400fb49175e9e6aa4e23fe11af69e9412dd23b0cb6684c4c2429bce139e848ab26d0829073351f4acd36074eafd036a5eb83359d2a698d3"
	eValue     = "10001"
	dValue     = "8e9912f6d3645894e8d38cb58c0db81ff516cf4c7e5a14c7f1eddb1459d2cded4d8d293fc97aee6aefb861859c8b6a3d1dfe710463e1f9ddc72048c09751971c4a580aa51eb523357a3cc48d31cfad1d4a165066ed92d4748fb6571211da5cb14bc11b6e2df7c1a559e6d5ac1cd5c94703a22891464fba23d0d965086277a161"
	pValue     = "d090ce58a92c75233a6486cb0a9209bf3583b64f540c76f5294bb97d285eed33aec220bde14b2417951178ac152ceab6da7090905b478195498b352048f15e7d"
	qValue     = "cab575dc652bb66df15a0359609d51d1db184750c00c6698b90ef3465c99655103edbf0d54c56aec0ce3c4d22592338092a126a0cc49f65a4a30d222b411e58f"
	dmp1Value  = "1a24bca8e273df2f0e47c199bbf678604e7df7215480c77c8db39f49b000ce2cf7500038acfff5433b7d582a01f1826e6f4d42e1c57f5e1fef7b12aabc59fd25"
	dmq1Value  = "3d06982efbbe47339e1f6d36b1216b8a741d410b0c662f54f7118b27b9a4ec9d914337eb39841d8666f3034408cf94f5b62f11c402fc994fe15a05493150d9fd"
	coeffValue = "3a3e731acd8960b7ff9eb81a7ff93bd1cfa74cbd56987db58b4594fb09c09084db1734c8143f98b602b981aaa9243ca28deb69b5b280ee8dcee0fd2625e53250"

	text = "The quick brown fox jumped over the extremely lazy frog! " +
		"Now is the time for all good men to come to the party."
)

var encrypted string

func cryptoSetup() {
	initRC()
	rngInitPool()
}

func runEncrypt() {
	rsa := &RSAKey{}
	rsa.setPublic(nValue, eValue)
	rsa.setPrivateEx(nValue, eValue, dValue, pValue, qValue, dmp1Value, dmq1Value, coeffValue)
	encrypted = rsa.encrypt(text)
}

func runDecrypt() {
	rsa := &RSAKey{}
	rsa.setPublic(nValue, eValue)
	rsa.setPrivateEx(nValue, eValue, dValue, pValue, qValue, dmp1Value, dmq1Value, coeffValue)
	if rsa.decrypt(encrypted) != text {
		panic("crypto operation failed")
	}
}

func main() {
	harness.RunPair("Crypto", 266181, cryptoSetup, runEncrypt, runDecrypt, nil)
}
