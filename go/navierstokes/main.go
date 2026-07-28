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
			// The original is one expression, `lastX = x[currentRow] =
			// (x0[currentRow] + a*(lastX+x[++currentRow]+x[++lastRow]+
			// x[++nextRow])) * invC`, walked by three running offsets. At cell i
			// of row j those offsets are j*rowSize+i for the store and the x0
			// read, one past it for the first neighbour, and the same column in
			// the rows either side.
			//
			// Each of those is a window into the grid, so name them. All five are
			// cut to exactly the width cells the loop touches, which is what lets
			// the compiler drop the bounds checks: `range dst` bounds i by
			// len(dst), and the other four were sliced to that same length, so it
			// can see every index is in range without a test. Cutting them one
			// longer and indexing i+1, which is the more obvious transcription,
			// leaves the check in.
			//
			// dst and right share x's backing array, so the store through dst is
			// the value right reads on the next pass, exactly as the offsets did.
			base := j * rowSize
			first, above, below := base+1, base+1-rowSize, base+1+rowSize
			dst := x[first : first+width]
			right := x[first+1 : first+1+width]
			up := x[above : above+width]
			down := x[below : below+width]
			src := x0[first : first+width]
			lastX := x[base]
			for i := range dst {
				lastX = (src[i] + a*(lastX+right[i]+up[i]+down[i])) * invC
				dst[i] = lastX
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
			// Windowed the same way linSolve is, and cut to the same exact
			// width so the indexes need no bounds check. The two halves of the
			// original's body do not agree on where the offsets point: the x
			// line carries no increments, so it reads its own cell and the rows
			// either side one column behind; the y line increments first and so
			// reads one column ahead and the rows either side level. That
			// asymmetry is the original's and the windows keep it.
			base := j * rowSize
			first, above, below := base+1, base+1-rowSize, base+1+rowSize
			xdst := x[first : first+width]
			xup := x[above-1 : above-1+width]
			xdown := x[below-1 : below-1+width]
			xsrc := x0[first : first+width]
			ydst := y[first : first+width]
			yright := y[first+1 : first+1+width]
			yup := y[above : above+width]
			ydown := y[below : below+width]
			ysrc := y0[first : first+width]
			lastX := x[base]
			lastY := y[base]
			for i := range xdst {
				lastX = (xsrc[i] + a*(lastX+xdst[i]+xup[i]+xdown[i])) * invC
				xdst[i] = lastX
				lastY = (ysrc[i] + a*(lastY+yright[i]+yup[i]+ydown[i])) * invC
				ydst[i] = lastY
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
		// Every index in the original's line is pre-incremented, the store
		// target included, so all five advance before anything is read and all
		// five land on column i. Six windows, one per offset, each cut to the
		// width cells the loop touches so the indexes carry no bounds check.
		base := j * rowSize
		first, above, below := base+1, base+1-rowSize, base+1+rowSize
		divRow := div[first : first+width]
		pRow := p[first : first+width]
		uRight := u[first+1 : first+1+width]
		uLeft := u[first-1 : first-1+width]
		vDown := v[below : below+width]
		vUp := v[above : above+width]
		for i := range divRow {
			divRow[i] = h * (uRight[i] - uLeft[i] + vDown[i] - vUp[i])
			pRow[i] = 0
		}
	}
	f.setBnd(0, div)
	f.setBnd(0, p)

	f.linSolve(0, p, div, 1, 4)
	wScale := 0.5 * float64(width)
	hScale := 0.5 * float64(height)
	for j := 1; j <= height; j++ {
		// u's line advances currentPos, nextPos and prevPos; v's line reuses
		// the currentPos u just advanced and advances only its own two rows. All
		// six land on column i, so the same six windows serve both lines.
		base := j * rowSize
		first, above, below := base+1, base+1-rowSize, base+1+rowSize
		uRow := u[first : first+width]
		vRow := v[first : first+width]
		pRight := p[first+1 : first+1+width]
		pLeft := p[first-1 : first-1+width]
		pDown := p[below : below+width]
		pUp := p[above : above+width]
		for i := range uRow {
			uRow[i] -= wScale * (pRight[i] - pLeft[i])
			vRow[i] -= hScale * (pDown[i] - pUp[i])
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
