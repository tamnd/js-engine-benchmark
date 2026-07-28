// A typed-TypeScript port of v8-v7/navier-stokes.js, itself Oliver Hunt's
// fluid simulation.
//
// The benchmark steps a 128x128 grid of a Navier-Stokes fluid solver twenty
// iterations at a time. It is a flat-array numeric kernel: six grids of
// (width+2)*(height+2) doubles, walked with hand-computed row offsets. That
// makes it the one benchmark here that measures almost nothing but indexed
// float arithmetic, so the port keeps every loop bound, every index expression,
// and every constant exactly as the original has them.
//
// Two shapes changed. The original builds FluidField as a constructor function
// closing over its state, with the grids and the resolution as captured
// variables; here it is a class and they are fields. And the original's
// `x[++i]` subscripts, which mutate an index inside the expression that reads
// it, are hoisted into statements above the expression. That is not a
// simplification: JavaScript's evaluation order makes the assignment target's
// index and the first read use the pre-increment value, so getting the hoist
// wrong changes what the solver computes, and each one below is written out in
// the order the original evaluates it.

// The frame counter lives above the solver because FluidField.queryUI reaches
// prepareFrame, which reads it, and bento's AOT will not let a function called
// from above a module binding's declaration read that binding.
let framesTillAddingPoints = 0;
let framesBetweenAddingPoints = 5;

// Field is the accessor object handed to the UI callback and the display
// function once per update. The original creates two of them per frame and
// this does too, since that allocation is part of what is being measured.
class Field {
  dens: number[];
  u: number[];
  v: number[];
  rowSize: number;

  constructor(dens: number[], u: number[], v: number[], rowSize: number) {
    this.dens = dens;
    this.u = u;
    this.v = v;
    this.rowSize = rowSize;
  }

  setDensity(x: number, y: number, d: number): void {
    this.dens[x + 1 + (y + 1) * this.rowSize] = d;
  }

  getDensity(x: number, y: number): number {
    return this.dens[x + 1 + (y + 1) * this.rowSize];
  }

  setVelocity(x: number, y: number, xv: number, yv: number): void {
    this.u[x + 1 + (y + 1) * this.rowSize] = xv;
    this.v[x + 1 + (y + 1) * this.rowSize] = yv;
  }

  getXVelocity(x: number, y: number): number {
    return this.u[x + 1 + (y + 1) * this.rowSize];
  }

  getYVelocity(x: number, y: number): number {
    return this.v[x + 1 + (y + 1) * this.rowSize];
  }
}

class FluidField {
  iterations: number;
  dt: number;
  width: number;
  height: number;
  rowSize: number;
  size: number;
  dens: number[];
  dens_prev: number[];
  u: number[];
  u_prev: number[];
  v: number[];
  v_prev: number[];

  constructor() {
    this.iterations = 10;
    this.dt = 0.1;
    this.width = 0;
    this.height = 0;
    this.rowSize = 0;
    this.size = 0;
    this.dens = [];
    this.dens_prev = [];
    this.u = [];
    this.u_prev = [];
    this.v = [];
    this.v_prev = [];
    this.setResolution(64, 64);
  }

  addFields(x: number[], s: number[], dt: number): void {
    for (let i = 0; i < this.size; i++) x[i] += dt * s[i];
  }

  // set_bnd reflects the grid's interior into the one-cell border, with the
  // sign flipped along whichever axis b names so a velocity component bounces
  // off the wall instead of leaking through it.
  set_bnd(b: number, x: number[]): void {
    const width = this.width;
    const height = this.height;
    const rowSize = this.rowSize;
    if (b === 1) {
      let i = 1;
      for (; i <= width; i++) {
        x[i] = x[i + rowSize];
        x[i + (height + 1) * rowSize] = x[i + height * rowSize];
      }
      // The original's second loop here tests and increments `i`, not `j`. It
      // is a typo in the benchmark source, and at the 128x128 resolution the
      // suite runs, `i` is width+1 on entry so the test is already false and
      // the body never runs. It is kept because removing it would leave the
      // b===1 border half-written where the original leaves it untouched, and
      // the solver's output would differ.
      for (let j = 1; i <= height; i++) {
        x[j * rowSize] = -x[1 + j * rowSize];
        x[width + 1 + j * rowSize] = -x[width + j * rowSize];
      }
    } else if (b === 2) {
      for (let i = 1; i <= width; i++) {
        x[i] = -x[i + rowSize];
        x[i + (height + 1) * rowSize] = -x[i + height * rowSize];
      }
      for (let j = 1; j <= height; j++) {
        x[j * rowSize] = x[1 + j * rowSize];
        x[width + 1 + j * rowSize] = x[width + j * rowSize];
      }
    } else {
      for (let i = 1; i <= width; i++) {
        x[i] = x[i + rowSize];
        x[i + (height + 1) * rowSize] = x[i + height * rowSize];
      }
      for (let j = 1; j <= height; j++) {
        x[j * rowSize] = x[1 + j * rowSize];
        x[width + 1 + j * rowSize] = x[width + j * rowSize];
      }
    }
    // The four corners are the average of their two neighbours.
    const maxEdge = (height + 1) * rowSize;
    x[0] = 0.5 * (x[1] + x[rowSize]);
    x[maxEdge] = 0.5 * (x[1 + maxEdge] + x[height * rowSize]);
    x[width + 1] = 0.5 * (x[width] + x[width + 1 + rowSize]);
    x[width + 1 + maxEdge] = 0.5 * (x[width + maxEdge] + x[width + 1 + height * rowSize]);
  }

  // lin_solve is the Gauss-Seidel relaxation the diffusion and the pressure
  // projection both run: each cell is pulled toward the average of its four
  // neighbours, `iterations` times over.
  lin_solve(b: number, x: number[], x0: number[], a: number, c: number): void {
    const width = this.width;
    const height = this.height;
    const rowSize = this.rowSize;
    if (a === 0 && c === 1) {
      for (let j = 1; j <= height; j++) {
        let currentRow = j * rowSize;
        ++currentRow;
        for (let i = 0; i < width; i++) {
          x[currentRow] = x0[currentRow];
          ++currentRow;
        }
      }
      this.set_bnd(b, x);
    } else {
      const invC = 1 / c;
      for (let k = 0; k < this.iterations; k++) {
        for (let j = 1; j <= height; j++) {
          let lastRow = (j - 1) * rowSize;
          let currentRow = j * rowSize;
          let nextRow = (j + 1) * rowSize;
          let lastX = x[currentRow];
          ++currentRow;
          for (let i = 1; i <= width; i++) {
            // The original is one expression, `lastX = x[currentRow] =
            // (x0[currentRow] + a*(lastX+x[++currentRow]+x[++lastRow]+
            // x[++nextRow])) * invC`. The store target and the x0 read take
            // currentRow before any increment, which is `target` here, and the
            // three reads inside the sum take the incremented indices.
            const target = currentRow;
            currentRow = target + 1;
            lastRow = lastRow + 1;
            nextRow = nextRow + 1;
            lastX = (x0[target] + a * (lastX + x[currentRow] + x[lastRow] + x[nextRow])) * invC;
            x[target] = lastX;
          }
        }
        this.set_bnd(b, x);
      }
    }
  }

  diffuse(b: number, x: number[], x0: number[], dt: number): void {
    const a = 0;
    this.lin_solve(b, x, x0, a, 1 + 4 * a);
  }

  // lin_solve2 relaxes the two velocity components together, which is the same
  // sweep as lin_solve run over a pair of grids so the row offsets are computed
  // once instead of twice.
  lin_solve2(x: number[], x0: number[], y: number[], y0: number[], a: number, c: number): void {
    const width = this.width;
    const height = this.height;
    const rowSize = this.rowSize;
    if (a === 0 && c === 1) {
      for (let j = 1; j <= height; j++) {
        let currentRow = j * rowSize;
        ++currentRow;
        for (let i = 0; i < width; i++) {
          x[currentRow] = x0[currentRow];
          y[currentRow] = y0[currentRow];
          ++currentRow;
        }
      }
      this.set_bnd(1, x);
      this.set_bnd(2, y);
    } else {
      const invC = 1 / c;
      for (let k = 0; k < this.iterations; k++) {
        for (let j = 1; j <= height; j++) {
          let lastRow = (j - 1) * rowSize;
          let currentRow = j * rowSize;
          let nextRow = (j + 1) * rowSize;
          let lastX = x[currentRow];
          let lastY = y[currentRow];
          ++currentRow;
          for (let i = 1; i <= width; i++) {
            // The x line of the original carries no increments at all, so every
            // index in it is the current one.
            lastX = (x0[currentRow] + a * (lastX + x[currentRow] + x[lastRow] + x[nextRow])) * invC;
            x[currentRow] = lastX;
            // The y line does carry them, and as in lin_solve the store target
            // and the y0 read come before the three increments.
            const target = currentRow;
            currentRow = target + 1;
            lastRow = lastRow + 1;
            nextRow = nextRow + 1;
            lastY = (y0[target] + a * (lastY + y[currentRow] + y[lastRow] + y[nextRow])) * invC;
            y[target] = lastY;
          }
        }
        this.set_bnd(1, x);
        this.set_bnd(2, y);
      }
    }
  }

  diffuse2(x: number[], x0: number[], y: number[], y0: number[], dt: number): void {
    const a = 0;
    this.lin_solve2(x, x0, y, y0, a, 1 + 4 * a);
  }

  // advect moves a quantity along the velocity field by tracing each cell
  // backward one step and reading a bilinear sample where it lands.
  advect(b: number, d: number[], d0: number[], u: number[], v: number[], dt: number): void {
    const width = this.width;
    const height = this.height;
    const rowSize = this.rowSize;
    const Wdt0 = dt * width;
    const Hdt0 = dt * height;
    const Wp5 = width + 0.5;
    const Hp5 = height + 0.5;
    for (let j = 1; j <= height; j++) {
      let pos = j * rowSize;
      for (let i = 1; i <= width; i++) {
        // The original reads u[++pos] and then v[pos], so pos advances once per
        // cell and both reads take the advanced value.
        pos = pos + 1;
        let x = i - Wdt0 * u[pos];
        let y = j - Hdt0 * v[pos];
        if (x < 0.5) x = 0.5;
        else if (x > Wp5) x = Wp5;
        const i0 = x | 0;
        const i1 = i0 + 1;
        if (y < 0.5) y = 0.5;
        else if (y > Hp5) y = Hp5;
        const j0 = y | 0;
        const j1 = j0 + 1;
        const s1 = x - i0;
        const s0 = 1 - s1;
        const t1 = y - j0;
        const t0 = 1 - t1;
        const row1 = j0 * rowSize;
        const row2 = j1 * rowSize;
        d[pos] = s0 * (t0 * d0[i0 + row1] + t1 * d0[i0 + row2]) + s1 * (t0 * d0[i1 + row1] + t1 * d0[i1 + row2]);
      }
    }
    this.set_bnd(b, d);
  }

  // project makes the velocity field divergence-free, which is what keeps the
  // fluid incompressible: take the divergence, solve for a pressure whose
  // gradient matches it, then subtract that gradient back out.
  project(u: number[], v: number[], p: number[], div: number[]): void {
    const width = this.width;
    const height = this.height;
    const rowSize = this.rowSize;
    const h = -0.5 / Math.sqrt(width * height);
    for (let j = 1; j <= height; j++) {
      const row = j * rowSize;
      let previousRow = (j - 1) * rowSize;
      let prevValue = row - 1;
      let currentRow = row;
      let nextValue = row + 1;
      let nextRow = (j + 1) * rowSize;
      for (let i = 1; i <= width; i++) {
        // Every index in the original's line is pre-incremented, the store
        // target included, so all five advance before anything is read.
        currentRow = currentRow + 1;
        nextValue = nextValue + 1;
        prevValue = prevValue + 1;
        nextRow = nextRow + 1;
        previousRow = previousRow + 1;
        div[currentRow] = h * (u[nextValue] - u[prevValue] + v[nextRow] - v[previousRow]);
        p[currentRow] = 0;
      }
    }
    this.set_bnd(0, div);
    this.set_bnd(0, p);

    this.lin_solve(0, p, div, 1, 4);
    const wScale = 0.5 * width;
    const hScale = 0.5 * height;
    for (let j = 1; j <= height; j++) {
      let prevPos = j * rowSize - 1;
      let currentPos = j * rowSize;
      let nextPos = j * rowSize + 1;
      let prevRow = (j - 1) * rowSize;
      let nextRow = (j + 1) * rowSize;

      for (let i = 1; i <= width; i++) {
        // u's line advances currentPos, nextPos, and prevPos; v's line reuses
        // the currentPos u just advanced and advances only its own two rows.
        currentPos = currentPos + 1;
        nextPos = nextPos + 1;
        prevPos = prevPos + 1;
        u[currentPos] -= wScale * (p[nextPos] - p[prevPos]);
        nextRow = nextRow + 1;
        prevRow = prevRow + 1;
        v[currentPos] -= hScale * (p[nextRow] - p[prevRow]);
      }
    }
    this.set_bnd(1, u);
    this.set_bnd(2, v);
  }

  dens_step(x: number[], x0: number[], u: number[], v: number[], dt: number): void {
    this.addFields(x, x0, dt);
    this.diffuse(0, x0, x, dt);
    this.advect(0, x, x0, u, v, dt);
  }

  // vel_step advances the velocity field: add the sources, diffuse, project,
  // advect along itself, project again. The swaps are the original's, and they
  // are local to this function, so they rename which grid each name refers to
  // for the rest of the step without touching the fields they came from.
  vel_step(u: number[], v: number[], u0: number[], v0: number[], dt: number): void {
    this.addFields(u, u0, dt);
    this.addFields(v, v0, dt);
    let temp = u0;
    u0 = u;
    u = temp;
    temp = v0;
    v0 = v;
    v = temp;
    this.diffuse2(u, u0, v, v0, dt);
    this.project(u, v, u0, v0);
    temp = u0;
    u0 = u;
    u = temp;
    temp = v0;
    v0 = v;
    v = temp;
    this.advect(1, u, u0, u0, v0, dt);
    this.advect(2, v, v0, u0, v0, dt);
    this.project(u, v, u0, v0);
  }

  // queryUI clears the source grids and hands them to the UI callback, which is
  // where the benchmark stirs new density and velocity in.
  queryUI(d: number[], u: number[], v: number[]): void {
    for (let i = 0; i < this.size; i++) {
      u[i] = 0.0;
      v[i] = 0.0;
      d[i] = 0.0;
    }
    prepareFrame(new Field(d, u, v, this.rowSize));
  }

  update(): void {
    this.queryUI(this.dens_prev, this.u_prev, this.v_prev);
    this.vel_step(this.u, this.v, this.u_prev, this.v_prev, this.dt);
    this.dens_step(this.dens, this.dens_prev, this.u, this.v, this.dt);
    // The original hands a fresh Field to a display function that does nothing.
    // The allocation stays, since it is one of the two per frame the collector
    // sees; the empty call does not.
    displayFrame(new Field(this.dens, this.u, this.v, this.rowSize));
  }

  setIterations(iters: number): void {
    if (iters > 0 && iters <= 100) this.iterations = iters;
  }

  reset(): void {
    this.rowSize = this.width + 2;
    this.size = (this.width + 2) * (this.height + 2);
    const size = this.size;
    this.dens = new Array<number>(size);
    this.dens_prev = new Array<number>(size);
    this.u = new Array<number>(size);
    this.u_prev = new Array<number>(size);
    this.v = new Array<number>(size);
    this.v_prev = new Array<number>(size);
    for (let i = 0; i < size; i++) {
      this.dens_prev[i] = 0;
      this.u_prev[i] = 0;
      this.v_prev[i] = 0;
      this.dens[i] = 0;
      this.u[i] = 0;
      this.v[i] = 0;
    }
  }

  setResolution(hRes: number, wRes: number): boolean {
    const res = wRes * hRes;
    if (res > 0 && res < 1000000 && (wRes != this.width || hRes != this.height)) {
      this.width = wRes;
      this.height = hRes;
      this.reset();
      return true;
    }
    return false;
  }
}

let solver: FluidField | null = null;

// addPoints stirs the fluid: a diagonal jet in each direction plus three bands
// of density, which is what keeps the field from settling into nothing.
function addPoints(field: Field): void {
  const n = 64;
  for (let i = 1; i <= n; i++) {
    field.setVelocity(i, i, n, n);
    field.setDensity(i, i, 5);
    field.setVelocity(i, n - i, -n, -n);
    field.setDensity(i, n - i, 20);
    field.setVelocity(128 - i, n + i, -n, -n);
    field.setDensity(128 - i, n + i, 30);
  }
}

// prepareFrame adds points on an interval that keeps growing, so the work per
// frame drifts down over a run exactly as it does in the original.
function prepareFrame(field: Field): void {
  if (framesTillAddingPoints == 0) {
    addPoints(field);
    framesTillAddingPoints = framesBetweenAddingPoints;
    framesBetweenAddingPoints++;
  } else {
    framesTillAddingPoints--;
  }
}

function displayFrame(field: Field): void {}

export function navierStokesSetup(): void {
  const s = new FluidField();
  s.setResolution(128, 128);
  s.setIterations(20);
  s.reset();
  solver = s;
}

export function navierStokesTearDown(): void {
  solver = null;
}

export function runNavierStokes(): void {
  const s = solver as FluidField;
  s.update();
}
