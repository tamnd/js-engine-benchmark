// NavierStokes in Go, from the same solver as v8-v7/navier-stokes.js and
// ts/navier-stokes.ts: Oliver Hunt's fluid simulation stepping a 128x128 grid
// with twenty relaxation iterations per solve.
//
// This is the flattest of the six: six grids of (width+2)*(height+2) doubles
// walked with hand-computed row offsets, and almost nothing else. So the port
// keeps every loop bound, every index expression and every constant as the
// original has them, down to the typo in set_bnd that leaves part of one border
// unwritten. The grids are []float64 and the offsets are ints, which is the
// whole of what Go brings to it.
//
// The original's `x[++i]` subscripts, which mutate an index inside the
// expression that reads it, are written out as statements. That is not a
// simplification: JavaScript's evaluation order makes the store target and the
// first read use the pre-increment value, so each hoist below is in the order
// the original evaluates it, and getting one wrong changes what the solver
// computes.
package main

import (
	"math"

	"github.com/tamnd/js-engine-benchmark/go/harness"
)

var (
	framesTillAddingPoints    = 0
	framesBetweenAddingPoints = 5
)

// Field is the accessor handed to the UI callback and the display function once
// per update. The original allocates two of them per frame and this does too,
// since that allocation is part of what is being measured.
type Field struct {
	dens    []float64
	u, v    []float64
	rowSize int
}

func (f *Field) setDensity(x, y int, d float64) {
	f.dens[x+1+(y+1)*f.rowSize] = d
}

func (f *Field) getDensity(x, y int) float64 {
	return f.dens[x+1+(y+1)*f.rowSize]
}

func (f *Field) setVelocity(x, y int, xv, yv float64) {
	f.u[x+1+(y+1)*f.rowSize] = xv
	f.v[x+1+(y+1)*f.rowSize] = yv
}

func (f *Field) getXVelocity(x, y int) float64 {
	return f.u[x+1+(y+1)*f.rowSize]
}

func (f *Field) getYVelocity(x, y int) float64 {
	return f.v[x+1+(y+1)*f.rowSize]
}

type FluidField struct {
	iterations     int
	dt             float64
	width, height  int
	rowSize        int
	size           int
	dens, densPrev []float64
	u, uPrev       []float64
	v, vPrev       []float64
}

func newFluidField() *FluidField {
	f := &FluidField{iterations: 10, dt: 0.1}
	f.setResolution(64, 64)
	return f
}

func (f *FluidField) addFields(x, s []float64, dt float64) {
	for i := 0; i < f.size; i++ {
		x[i] += dt * s[i]
	}
}

// setBnd reflects the grid's interior into the one-cell border, with the sign
// flipped along whichever axis b names so a velocity component bounces off the
// wall instead of leaking through it.
func (f *FluidField) setBnd(b int, x []float64) {
	width, height, rowSize := f.width, f.height, f.rowSize
	switch b {
	case 1:
		i := 1
		for ; i <= width; i++ {
			x[i] = x[i+rowSize]
			x[i+(height+1)*rowSize] = x[i+height*rowSize]
		}
		// The original's second loop here tests and increments i, not j. It is a
		// typo in the benchmark source, and at the 128x128 resolution the suite
		// runs, i is width+1 on entry so the test is already false and the body
		// never runs. It is kept because removing it would write the b==1 border
		// the original leaves untouched, and the solver's output would differ.
		for j := 1; i <= height; i++ {
			x[j*rowSize] = -x[1+j*rowSize]
			x[width+1+j*rowSize] = -x[width+j*rowSize]
		}
	case 2:
		for i := 1; i <= width; i++ {
			x[i] = -x[i+rowSize]
			x[i+(height+1)*rowSize] = -x[i+height*rowSize]
		}
		for j := 1; j <= height; j++ {
			x[j*rowSize] = x[1+j*rowSize]
			x[width+1+j*rowSize] = x[width+j*rowSize]
		}
	default:
		for i := 1; i <= width; i++ {
			x[i] = x[i+rowSize]
			x[i+(height+1)*rowSize] = x[i+height*rowSize]
		}
		for j := 1; j <= height; j++ {
			x[j*rowSize] = x[1+j*rowSize]
			x[width+1+j*rowSize] = x[width+j*rowSize]
		}
	}
	// The four corners are the average of their two neighbours.
	maxEdge := (height + 1) * rowSize
	x[0] = 0.5 * (x[1] + x[rowSize])
	x[maxEdge] = 0.5 * (x[1+maxEdge] + x[height*rowSize])
	x[width+1] = 0.5 * (x[width] + x[width+1+rowSize])
	x[width+1+maxEdge] = 0.5 * (x[width+maxEdge] + x[width+1+height*rowSize])
}

// linSolve is the Gauss-Seidel relaxation that the diffusion and the pressure
// projection both run: each cell is pulled toward the average of its four
// neighbours, iterations times over.
func (f *FluidField) linSolve(b int, x, x0 []float64, a, c float64) {
	width, height, rowSize := f.width, f.height, f.rowSize
	if a == 0 && c == 1 {
		for j := 1; j <= height; j++ {
			currentRow := j*rowSize + 1
			for i := 0; i < width; i++ {
				x[currentRow] = x0[currentRow]
				currentRow++
			}
		}
		f.setBnd(b, x)
		return
	}
	invC := 1 / c
	for k := 0; k < f.iterations; k++ {
		for j := 1; j <= height; j++ {
			lastRow := (j - 1) * rowSize
			currentRow := j * rowSize
			nextRow := (j + 1) * rowSize
			lastX := x[currentRow]
			currentRow++
			for i := 1; i <= width; i++ {
				// The original is one expression, `lastX = x[currentRow] =
				// (x0[currentRow] + a*(lastX+x[++currentRow]+x[++lastRow]+
				// x[++nextRow])) * invC`. The store target and the x0 read take
				// currentRow before any increment, which is target here, and the
				// three reads inside the sum take the incremented indices.
				target := currentRow
				currentRow = target + 1
				lastRow++
				nextRow++
				lastX = (x0[target] + a*(lastX+x[currentRow]+x[lastRow]+x[nextRow])) * invC
				x[target] = lastX
			}
		}
		f.setBnd(b, x)
	}
}

func (f *FluidField) diffuse(b int, x, x0 []float64, dt float64) {
	a := 0.0
	f.linSolve(b, x, x0, a, 1+4*a)
}

// linSolve2 relaxes the two velocity components together, which is the same
// sweep as linSolve run over a pair of grids so the row offsets are computed
// once instead of twice.
func (f *FluidField) linSolve2(x, x0, y, y0 []float64, a, c float64) {
	width, height, rowSize := f.width, f.height, f.rowSize
	if a == 0 && c == 1 {
		for j := 1; j <= height; j++ {
			currentRow := j*rowSize + 1
			for i := 0; i < width; i++ {
				x[currentRow] = x0[currentRow]
				y[currentRow] = y0[currentRow]
				currentRow++
			}
		}
		f.setBnd(1, x)
		f.setBnd(2, y)
		return
	}
	invC := 1 / c
	for k := 0; k < f.iterations; k++ {
		for j := 1; j <= height; j++ {
			lastRow := (j - 1) * rowSize
			currentRow := j * rowSize
			nextRow := (j + 1) * rowSize
			lastX := x[currentRow]
			lastY := y[currentRow]
			currentRow++
			for i := 1; i <= width; i++ {
				// The x line of the original carries no increments at all, so
				// every index in it is the current one.
				lastX = (x0[currentRow] + a*(lastX+x[currentRow]+x[lastRow]+x[nextRow])) * invC
				x[currentRow] = lastX
				// The y line does carry them, and as in linSolve the store
				// target and the y0 read come before the three increments.
				target := currentRow
				currentRow = target + 1
				lastRow++
				nextRow++
				lastY = (y0[target] + a*(lastY+y[currentRow]+y[lastRow]+y[nextRow])) * invC
				y[target] = lastY
			}
		}
		f.setBnd(1, x)
		f.setBnd(2, y)
	}
}

func (f *FluidField) diffuse2(x, x0, y, y0 []float64, dt float64) {
	a := 0.0
	f.linSolve2(x, x0, y, y0, a, 1+4*a)
}

// advect moves a quantity along the velocity field by tracing each cell backward
// one step and reading a bilinear sample where it lands.
func (f *FluidField) advect(b int, d, d0, u, v []float64, dt float64) {
	width, height, rowSize := f.width, f.height, f.rowSize
	wdt0 := dt * float64(width)
	hdt0 := dt * float64(height)
	wp5 := float64(width) + 0.5
	hp5 := float64(height) + 0.5
	for j := 1; j <= height; j++ {
		pos := j * rowSize
		for i := 1; i <= width; i++ {
			// The original reads u[++pos] and then v[pos], so pos advances once
			// per cell and both reads take the advanced value.
			pos++
			x := float64(i) - wdt0*u[pos]
			y := float64(j) - hdt0*v[pos]
			if x < 0.5 {
				x = 0.5
			} else if x > wp5 {
				x = wp5
			}
			i0 := int(x)
			i1 := i0 + 1
			if y < 0.5 {
				y = 0.5
			} else if y > hp5 {
				y = hp5
			}
			j0 := int(y)
			j1 := j0 + 1
			s1 := x - float64(i0)
			s0 := 1 - s1
			t1 := y - float64(j0)
			t0 := 1 - t1
			row1 := j0 * rowSize
			row2 := j1 * rowSize
			d[pos] = s0*(t0*d0[i0+row1]+t1*d0[i0+row2]) + s1*(t0*d0[i1+row1]+t1*d0[i1+row2])
		}
	}
	f.setBnd(b, d)
}

// project makes the velocity field divergence-free, which is what keeps the
// fluid incompressible: take the divergence, solve for a pressure whose gradient
// matches it, then subtract that gradient back out.
func (f *FluidField) project(u, v, p, div []float64) {
	width, height, rowSize := f.width, f.height, f.rowSize
	h := -0.5 / math.Sqrt(float64(width*height))
	for j := 1; j <= height; j++ {
		row := j * rowSize
		previousRow := (j - 1) * rowSize
		prevValue := row - 1
		currentRow := row
		nextValue := row + 1
		nextRow := (j + 1) * rowSize
		for i := 1; i <= width; i++ {
			// Every index in the original's line is pre-incremented, the store
			// target included, so all five advance before anything is read.
			currentRow++
			nextValue++
			prevValue++
			nextRow++
			previousRow++
			div[currentRow] = h * (u[nextValue] - u[prevValue] + v[nextRow] - v[previousRow])
			p[currentRow] = 0
		}
	}
	f.setBnd(0, div)
	f.setBnd(0, p)

	f.linSolve(0, p, div, 1, 4)
	wScale := 0.5 * float64(width)
	hScale := 0.5 * float64(height)
	for j := 1; j <= height; j++ {
		prevPos := j*rowSize - 1
		currentPos := j * rowSize
		nextPos := j*rowSize + 1
		prevRow := (j - 1) * rowSize
		nextRow := (j + 1) * rowSize

		for i := 1; i <= width; i++ {
			// u's line advances currentPos, nextPos and prevPos; v's line reuses
			// the currentPos u just advanced and advances only its own two rows.
			currentPos++
			nextPos++
			prevPos++
			u[currentPos] -= wScale * (p[nextPos] - p[prevPos])
			nextRow++
			prevRow++
			v[currentPos] -= hScale * (p[nextRow] - p[prevRow])
		}
	}
	f.setBnd(1, u)
	f.setBnd(2, v)
}

func (f *FluidField) densStep(x, x0, u, v []float64, dt float64) {
	f.addFields(x, x0, dt)
	f.diffuse(0, x0, x, dt)
	f.advect(0, x, x0, u, v, dt)
}

// velStep advances the velocity field: add the sources, diffuse, project, advect
// along itself, project again. The swaps are the original's, and they are local
// to this function, so they rename which grid each name refers to for the rest
// of the step without touching the fields they came from.
func (f *FluidField) velStep(u, v, u0, v0 []float64, dt float64) {
	f.addFields(u, u0, dt)
	f.addFields(v, v0, dt)
	u, u0 = u0, u
	v, v0 = v0, v
	f.diffuse2(u, u0, v, v0, dt)
	f.project(u, v, u0, v0)
	u, u0 = u0, u
	v, v0 = v0, v
	f.advect(1, u, u0, u0, v0, dt)
	f.advect(2, v, v0, u0, v0, dt)
	f.project(u, v, u0, v0)
}

// queryUI clears the source grids and hands them to the UI callback, which is
// where the benchmark stirs new density and velocity in.
func (f *FluidField) queryUI(d, u, v []float64) {
	for i := 0; i < f.size; i++ {
		u[i] = 0
		v[i] = 0
		d[i] = 0
	}
	prepareFrame(&Field{dens: d, u: u, v: v, rowSize: f.rowSize})
}

func (f *FluidField) update() {
	f.queryUI(f.densPrev, f.uPrev, f.vPrev)
	f.velStep(f.u, f.v, f.uPrev, f.vPrev, f.dt)
	f.densStep(f.dens, f.densPrev, f.u, f.v, f.dt)
	// The original hands a fresh Field to a display function that does nothing.
	// The allocation stays, since it is one of the two per frame the collector
	// sees; the empty call does not.
	displayFrame(&Field{dens: f.dens, u: f.u, v: f.v, rowSize: f.rowSize})
}

func (f *FluidField) setIterations(iters int) {
	if iters > 0 && iters <= 100 {
		f.iterations = iters
	}
}

func (f *FluidField) reset() {
	f.rowSize = f.width + 2
	f.size = (f.width + 2) * (f.height + 2)
	f.dens = make([]float64, f.size)
	f.densPrev = make([]float64, f.size)
	f.u = make([]float64, f.size)
	f.uPrev = make([]float64, f.size)
	f.v = make([]float64, f.size)
	f.vPrev = make([]float64, f.size)
}

func (f *FluidField) setResolution(hRes, wRes int) bool {
	res := wRes * hRes
	if res > 0 && res < 1000000 && (wRes != f.width || hRes != f.height) {
		f.width = wRes
		f.height = hRes
		f.reset()
		return true
	}
	return false
}

var solver *FluidField

// addPoints stirs the fluid: a diagonal jet in each direction plus three bands
// of density, which is what keeps the field from settling into nothing.
func addPoints(field *Field) {
	const n = 64
	for i := 1; i <= n; i++ {
		field.setVelocity(i, i, n, n)
		field.setDensity(i, i, 5)
		field.setVelocity(i, n-i, -n, -n)
		field.setDensity(i, n-i, 20)
		field.setVelocity(128-i, n+i, -n, -n)
		field.setDensity(128-i, n+i, 30)
	}
}

// prepareFrame adds points on an interval that keeps growing, so the work per
// frame drifts down over a run exactly as it does in the original.
func prepareFrame(field *Field) {
	if framesTillAddingPoints == 0 {
		addPoints(field)
		framesTillAddingPoints = framesBetweenAddingPoints
		framesBetweenAddingPoints++
	} else {
		framesTillAddingPoints--
	}
}

func displayFrame(field *Field) {}

func navierStokesSetup() {
	s := newFluidField()
	s.setResolution(128, 128)
	s.setIterations(20)
	s.reset()
	solver = s
}

func navierStokesTearDown() {
	solver = nil
}

func runNavierStokes() {
	solver.update()
}

func main() {
	harness.Run("NavierStokes", 1484000, navierStokesSetup, runNavierStokes, navierStokesTearDown)
}
