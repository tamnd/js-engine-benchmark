// Package harness is the measurement half of v8-v7/base.js in Go, so a score a
// Go port prints is on the same scale as the score the JavaScript suite prints
// for the same benchmark.
//
// base.js measures by running a benchmark in a loop until at least a second has
// elapsed, dividing to get microseconds per iteration, and scoring that against
// a fixed reference time: score = 100 * reference / usec. The warm-up pass and
// the "keep going if fewer than 32 iterations" rule are the original's too,
// because both change how much of the run is measured cold.
package harness

import (
	"fmt"
	"math"
	"time"
)

// randomSeed backs Random, the deterministic Math.random base.js installs so a
// benchmark that draws random numbers does the same work every run.
var randomSeed uint32 = 49734321

// Random is Robert Jenkins' 32 bit integer hash, the generator base.js puts in
// Math.random's place. It is written on uint32 rather than the JavaScript's
// masked doubles, which is the same arithmetic with the mask implied.
func Random() float64 {
	seed := randomSeed
	seed = seed + 0x7ed55d16 + (seed << 12)
	seed = (seed ^ 0xc761c23c) ^ (seed >> 19)
	seed = seed + 0x165667b1 + (seed << 5)
	seed = (seed + 0xd3a2646c) ^ (seed << 9)
	seed = seed + 0xfd7046c5 + (seed << 3)
	seed = (seed ^ 0xb55a4f09) ^ (seed >> 16)
	randomSeed = seed
	return float64(seed&0xfffffff) / float64(0x10000000)
}

// ResetRandom puts the generator back to its starting seed.
func ResetRandom() {
	randomSeed = 49734321
}

// formatScore renders a score with at least three significant digits, the way
// base.js reports one.
func formatScore(value float64) string {
	if value > 100 {
		return fmt.Sprintf("%.0f", value)
	}
	return fmt.Sprintf("%.3g", value)
}

// measure runs fn in a loop for at least a second and returns microseconds per
// iteration.
func measure(fn func()) float64 {
	start := time.Now()
	elapsed := time.Duration(0)
	n := 0
	for elapsed < time.Second {
		fn()
		elapsed = time.Since(start)
		n++
	}
	return float64(elapsed.Microseconds()) / float64(n)
}

// timeOne is one benchmark's measured time: a warm-up pass thrown away, then the
// timed pass, plus base.js's second pass when the first got fewer than 32
// iterations, which keeps a slow benchmark from scoring off a handful of runs.
func timeOne(fn func()) float64 {
	measure(fn)
	usec := measure(fn)
	if usec > 1000000.0/32 {
		usec = (usec + measure(fn)) / 2
	}
	return usec
}

// Run measures one benchmark and prints the "Name: score" line the suite's
// output parser reads. setup and tearDown run once each, outside the timing, the
// way base.js runs them in their own steps; pass nil for a benchmark with
// neither.
func Run(name string, reference float64, setup, fn, tearDown func()) {
	if setup != nil {
		setup()
	}
	usec := timeOne(fn)
	if tearDown != nil {
		tearDown()
	}
	fmt.Printf("%s: %s\n", name, formatScore(100*reference/usec))
}

// RunPair measures a suite of two benchmarks the way base.js scores one: each
// part is timed on its own and the suite score divides the reference by the
// geometric mean of the two. Crypto is the suite that needs it, Encrypt and
// Decrypt under one reference time. The parts run in the order given, since
// base.js runs them in order too and Decrypt reads what Encrypt produced.
func RunPair(name string, reference float64, setup, first, second, tearDown func()) {
	if setup != nil {
		setup()
	}
	a := timeOne(first)
	b := timeOne(second)
	if tearDown != nil {
		tearDown()
	}
	fmt.Printf("%s: %s\n", name, formatScore(100*reference/math.Sqrt(a*b)))
}
