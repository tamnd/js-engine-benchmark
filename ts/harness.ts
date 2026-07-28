// The measurement half of v8-v7/base.js, kept identical so a score printed here
// is the same number the JavaScript suite would print for the same work.
//
// base.js measures a benchmark by running it in a loop until at least a second
// has elapsed, dividing to get microseconds per iteration, and scoring that
// against a fixed reference time: score = 100 * reference / usec. The warm-up
// run and the "keep going if fewer than 32 iterations" rule are the original's
// too, because both change how much of the run is measured cold.

// Deterministic Math.random, so a benchmark that draws random numbers does the
// same work every run. This is Robert Jenkins' 32 bit integer hash, the same
// generator base.js installs over Math.random.
let randomSeed = 49734321;

export function random(): number {
  let seed = randomSeed;
  seed = (seed + 0x7ed55d16 + (seed << 12)) & 0xffffffff;
  seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff;
  seed = (seed + 0x165667b1 + (seed << 5)) & 0xffffffff;
  seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff;
  seed = (seed + 0xfd7046c5 + (seed << 3)) & 0xffffffff;
  seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff;
  randomSeed = seed;
  return (seed & 0xfffffff) / 0x10000000;
}

export function resetRandom(): void {
  randomSeed = 49734321;
}

// formatScore converts a score to a string with at least three significant
// digits, the way base.js reports one.
function formatScore(value: number): string {
  if (value > 100) return value.toFixed(0);
  return value.toPrecision(3);
}

// measure runs fn in a loop for at least a second and returns microseconds per
// iteration.
function measure(fn: () => void): number {
  let elapsed = 0;
  const start = Date.now();
  let n = 0;
  while (elapsed < 1000) {
    fn();
    elapsed = Date.now() - start;
    n++;
  }
  return (elapsed * 1000) / n;
}

// run measures one benchmark and prints the "Name: score" line the suite's
// output parser reads, matching base.js's own reporting. setup and tearDown run
// once each, outside the timing, the way base.js runs them in their own steps;
// a benchmark with neither passes two functions that do nothing.
export function run(name: string, reference: number, setup: () => void, fn: () => void, tearDown: () => void): void {
  setup();
  const usec = timeOne(fn);
  tearDown();
  console.log(name + ": " + formatScore((100 * reference) / usec));
}

// timeOne is the measured half of run: a warm-up pass thrown away, then the
// timed pass, plus base.js's second pass when the first got fewer than 32
// iterations, which keeps a slow benchmark from scoring off a handful of runs.
function timeOne(fn: () => void): number {
  measure(fn);
  let usec = measure(fn);
  if (usec > 1000000 / 32) usec = (usec + measure(fn)) / 2;
  return usec;
}

// runPair measures a suite of two benchmarks the way base.js scores one: each
// part is timed on its own and the suite score divides the reference by the
// geometric mean of the two. Crypto is the suite that needs it, Encrypt and
// Decrypt under one reference time. The parts run in the order given, since
// base.js runs them in order too and Decrypt reads what Encrypt produced.
export function runPair(
  name: string,
  reference: number,
  setup: () => void,
  first: () => void,
  second: () => void,
  tearDown: () => void,
): void {
  setup();
  const a = timeOne(first);
  const b = timeOne(second);
  tearDown();
  const mean = Math.sqrt(a * b);
  console.log(name + ": " + formatScore((100 * reference) / mean));
}
