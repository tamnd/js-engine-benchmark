// RayTrace in Go, from the same scene as v8-v7/raytrace.js and ts/raytrace.ts:
// Adam Burmister's ray tracer rendering a 20x20 image of two spheres over a
// chessboard plane.
//
// Two things are shaped for Go rather than transliterated.
//
// Vector, Color and the intersection record are values, not pointers. The
// JavaScript allocates a fresh object for every vector operation because it has
// no other choice; in Go they are small structs that live in registers and on
// the stack, which is what a Go programmer would write and is a large part of
// what the language buys here.
//
// A material has a texture instead of being subclassed by one. The engine reads
// gloss, reflection and transparency off the material and asks it for a color at
// a surface point; only that last part varies, so it is the interface, and the
// solid and chessboard cases implement it. Shape stays an interface, since the
// sphere and the plane intersect a ray by genuinely different arithmetic and the
// render loop dispatches over a mixed list of them.
//
// The rendered image is unchanged: renderScene still sums the brightness of the
// diagonal pixels and checks it against 2321, so a port that drifted numerically
// fails loudly.
package main

import (
	"math"

	"github.com/tamnd/js-engine-benchmark/go/harness"
)

// checkNumber accumulates the brightness of the pixels on the diagonal, which is
// how the benchmark verifies the render without a canvas.
var checkNumber int

type Color struct {
	red, green, blue float64
}

// limit clamps each channel into [0, 1].
func (c Color) limit() Color {
	return Color{clamp01(c.red), clamp01(c.green), clamp01(c.blue)}
}

func clamp01(v float64) float64 {
	if v <= 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// brightness is the luminance of the color as an 8 bit value, by the original's
// integer weights.
func (c Color) brightness() int {
	r := int(math.Floor(c.red * 255))
	g := int(math.Floor(c.green * 255))
	b := int(math.Floor(c.blue * 255))
	return (r*77 + g*150 + b*29) >> 8
}

func (c Color) add(o Color) Color {
	return Color{c.red + o.red, c.green + o.green, c.blue + o.blue}
}

func (c Color) addScalar(s float64) Color {
	return Color{c.red + s, c.green + s, c.blue + s}.limit()
}

func (c Color) multiply(o Color) Color {
	return Color{c.red * o.red, c.green * o.green, c.blue * o.blue}
}

func (c Color) scale(f float64) Color {
	return Color{c.red * f, c.green * f, c.blue * f}
}

func (c Color) blend(o Color, w float64) Color {
	return c.scale(1 - w).add(o.scale(w))
}

type Vector struct {
	x, y, z float64
}

func (v Vector) magnitude() float64 {
	return math.Sqrt(v.x*v.x + v.y*v.y + v.z*v.z)
}

func (v Vector) normalize() Vector {
	m := v.magnitude()
	return Vector{v.x / m, v.y / m, v.z / m}
}

func (v Vector) cross(w Vector) Vector {
	return Vector{
		-v.z*w.y + v.y*w.z,
		v.z*w.x - v.x*w.z,
		-v.y*w.x + v.x*w.y,
	}
}

func (v Vector) dot(w Vector) float64 {
	return v.x*w.x + v.y*w.y + v.z*w.z
}

func (v Vector) add(w Vector) Vector {
	return Vector{v.x + w.x, v.y + w.y, v.z + w.z}
}

func (v Vector) subtract(w Vector) Vector {
	return Vector{v.x - w.x, v.y - w.y, v.z - w.z}
}

func (v Vector) scale(s float64) Vector {
	return Vector{v.x * s, v.y * s, v.z * s}
}

type Ray struct {
	position  Vector
	direction Vector
}

type Light struct {
	position  Vector
	color     Color
	intensity float64
}

// Texture answers the color of a material at a point on a surface. The u and v
// are the surface coordinates, which only a patterned texture looks at.
type Texture interface {
	colorAt(u, v float64) Color
}

// solidTexture is one color everywhere.
type solidTexture struct {
	color Color
}

func (t solidTexture) colorAt(u, v float64) Color { return t.color }

// chessboardTexture alternates two colors in squares of the given density.
type chessboardTexture struct {
	even, odd Color
	density   float64
}

func (t chessboardTexture) colorAt(u, v float64) Color {
	if wrapUp(u*t.density)*wrapUp(v*t.density) < 0 {
		return t.even
	}
	return t.odd
}

// wrapUp folds a coordinate into [-1, 1), which is what makes the chessboard
// repeat.
func wrapUp(t float64) float64 {
	t = math.Mod(t, 2)
	if t < -1 {
		t += 2
	}
	if t >= 1 {
		t -= 2
	}
	return t
}

// Material carries the surface properties the engine reads directly and the
// texture it asks for a color.
type Material struct {
	texture      Texture
	gloss        float64
	transparency float64
	reflection   float64
	refraction   float64
	hasTexture   bool
}

func newSolidMaterial(color Color, reflection, refraction, transparency, gloss float64) *Material {
	return &Material{
		texture:      solidTexture{color},
		gloss:        gloss,
		transparency: transparency,
		reflection:   reflection,
		refraction:   0.5,
	}
}

func newChessboardMaterial(even, odd Color, reflection, transparency, gloss, density float64) *Material {
	return &Material{
		texture:      chessboardTexture{even, odd, density},
		gloss:        gloss,
		transparency: transparency,
		reflection:   reflection,
		refraction:   0.5,
		hasTexture:   true,
	}
}

// Intersection is what a shape answers about a ray. position, normal and
// distance are only read once isHit says they were written, so the zero value is
// a clean miss.
type Intersection struct {
	isHit    bool
	hitCount int
	shape    Shape
	position Vector
	normal   Vector
	color    Color
	distance float64
}

// Shape is the render loop's view of the scene: something a ray can hit, sitting
// somewhere, made of something.
type Shape interface {
	intersect(ray Ray) Intersection
	origin() Vector
	material() *Material
}

type Sphere struct {
	position Vector
	radius   float64
	mat      *Material
}

func (s *Sphere) origin() Vector      { return s.position }
func (s *Sphere) material() *Material { return s.mat }

func (s *Sphere) intersect(ray Ray) Intersection {
	info := Intersection{shape: s}

	dst := ray.position.subtract(s.position)
	b := dst.dot(ray.direction)
	c := dst.dot(dst) - s.radius*s.radius
	d := b*b - c

	if d > 0 {
		info.isHit = true
		info.distance = -b - math.Sqrt(d)
		info.position = ray.position.add(ray.direction.scale(info.distance))
		info.normal = info.position.subtract(s.position).normalize()
		info.color = s.mat.texture.colorAt(0, 0)
	}
	return info
}

// Plane is the plane with the given unit normal at distance d from the origin.
// Its position field is that normal, which is how the original stores it.
type Plane struct {
	position Vector
	d        float64
	mat      *Material
}

func (p *Plane) origin() Vector      { return p.position }
func (p *Plane) material() *Material { return p.mat }

func (p *Plane) intersect(ray Ray) Intersection {
	var info Intersection

	vd := p.position.dot(ray.direction)
	if vd == 0 {
		return info // ray is parallel to the plane
	}

	t := -(p.position.dot(ray.position) + p.d) / vd
	if t <= 0 {
		return info // the plane is behind the ray
	}

	info.shape = p
	info.isHit = true
	info.position = ray.position.add(ray.direction.scale(t))
	info.normal = p.position
	info.distance = t

	if p.mat.hasTexture {
		vU := Vector{p.position.y, p.position.z, -p.position.x}
		vV := vU.cross(p.position)
		info.color = p.mat.texture.colorAt(info.position.dot(vU), info.position.dot(vV))
	} else {
		info.color = p.mat.texture.colorAt(0, 0)
	}
	return info
}

type Camera struct {
	position Vector
	lookAt   Vector
	equator  Vector
	up       Vector
	screen   Vector
}

func newCamera(pos, lookAt, up Vector) Camera {
	return Camera{
		position: pos,
		lookAt:   lookAt,
		up:       up,
		equator:  lookAt.normalize().cross(up),
		screen:   pos.add(lookAt),
	}
}

// getRay is the ray through the point (vx, vy) of the view plane, both in
// [-1, 1].
func (c Camera) getRay(vx, vy float64) Ray {
	pos := c.screen.subtract(c.equator.scale(vx).subtract(c.up.scale(vy)))
	pos.y = -pos.y
	return Ray{pos, pos.subtract(c.position).normalize()}
}

type Background struct {
	color    Color
	ambience float64
}

type Scene struct {
	camera     Camera
	shapes     []Shape
	lights     []Light
	background Background
}

// Options is the original's options literal. The canvas size is already divided
// by the pixel size, which is what the original's Engine constructor does to it.
type Options struct {
	canvasHeight      int
	canvasWidth       int
	renderDiffuse     bool
	renderShadows     bool
	renderHighlights  bool
	renderReflections bool
	rayDepth          int
}

type Engine struct {
	options Options
}

// setPixel would draw to the canvas in the original. There is no canvas in the
// benchmark, so only the accumulate-the-diagonal branch is left.
func (e *Engine) setPixel(x, y int, color Color) {
	if x == y {
		checkNumber += color.brightness()
	}
}

func (e *Engine) renderScene(scene *Scene) {
	checkNumber = 0

	h, w := e.options.canvasHeight, e.options.canvasWidth
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			yp := float64(y)/float64(h)*2 - 1
			xp := float64(x)/float64(w)*2 - 1

			ray := scene.camera.getRay(xp, yp)
			e.setPixel(x, y, e.getPixelColor(ray, scene))
		}
	}
	if checkNumber != 2321 {
		panic("scene rendered incorrectly")
	}
}

func (e *Engine) getPixelColor(ray Ray, scene *Scene) Color {
	info := e.testIntersection(ray, scene, nil)
	if info.isHit {
		return e.rayTrace(info, ray, scene, 0)
	}
	return scene.background.color
}

// testIntersection answers the nearest shape the ray hits, skipping exclude,
// which is how a reflected or shadow ray avoids hitting the surface it left.
func (e *Engine) testIntersection(ray Ray, scene *Scene, exclude Shape) Intersection {
	hits := 0
	best := Intersection{distance: 2000}

	for _, shape := range scene.shapes {
		if shape == exclude {
			continue
		}
		info := shape.intersect(ray)
		if info.isHit && info.distance >= 0 && info.distance < best.distance {
			best = info
			hits++
		}
	}
	best.hitCount = hits
	return best
}

// getReflectionRay reflects the view direction V about the surface normal N at
// the point P.
func (e *Engine) getReflectionRay(p, n, v Vector) Ray {
	c1 := -n.dot(v)
	return Ray{p, n.scale(2 * c1).add(v)}
}

func (e *Engine) rayTrace(info Intersection, ray Ray, scene *Scene, depth int) Color {
	// Ambient
	color := info.color.scale(scene.background.ambience)
	shape := info.shape
	material := shape.material()
	shininess := math.Pow(10, material.gloss+1)

	for _, light := range scene.lights {
		// Diffuse lighting
		v := light.position.subtract(info.position).normalize()

		if e.options.renderDiffuse {
			if l := v.dot(info.normal); l > 0 {
				color = color.add(info.color.multiply(light.color.scale(l)))
			}
		}

		// The greater the depth the more accurate the colors, but this is
		// exponentially (!) expensive.
		if depth <= e.options.rayDepth {
			if e.options.renderReflections && material.reflection > 0 {
				reflectionRay := e.getReflectionRay(info.position, info.normal, ray.direction)
				refl := e.testIntersection(reflectionRay, scene, shape)

				if refl.isHit && refl.distance > 0 {
					refl.color = e.rayTrace(refl, reflectionRay, scene, depth+1)
				} else {
					refl.color = scene.background.color
				}

				color = color.blend(refl.color, material.reflection)
			}
			// Refraction is a TODO in the original too.
		}

		// Shadows and highlights
		var shadowInfo Intersection

		if e.options.renderShadows {
			shadowInfo = e.testIntersection(Ray{info.position, v}, scene, shape)
			if shadowInfo.isHit && shadowInfo.shape != info.shape {
				color = color.scale(0.5).addScalar(0.5 * math.Pow(shadowInfo.shape.material().transparency, 0.5))
			}
		}

		// Phong specular highlights
		if e.options.renderHighlights && !shadowInfo.isHit && material.gloss > 0 {
			lv := shape.origin().subtract(light.position).normalize()
			eye := scene.camera.position.subtract(shape.origin()).normalize()
			h := eye.subtract(lv).normalize()

			glossWeight := math.Pow(math.Max(info.normal.dot(h), 0), shininess)
			color = light.color.scale(glossWeight).add(color)
		}
	}
	return color.limit()
}

func renderScene() {
	scene := &Scene{
		camera:     newCamera(Vector{0, 0, -15}, Vector{-0.2, 0, 5}, Vector{0, 1, 0}),
		background: Background{Color{0.5, 0.5, 0.5}, 0.4},
	}

	sphere := &Sphere{
		position: Vector{-1.5, 1.5, 2},
		radius:   1.5,
		mat:      newSolidMaterial(Color{0, 0.5, 0.5}, 0.3, 0.0, 0.0, 2.0),
	}
	sphere1 := &Sphere{
		position: Vector{1, 0.25, 1},
		radius:   0.5,
		mat:      newSolidMaterial(Color{0.9, 0.9, 0.9}, 0.1, 0.0, 0.0, 1.5),
	}
	plane := &Plane{
		position: Vector{0.1, 0.9, -0.5}.normalize(),
		d:        1.2,
		mat:      newChessboardMaterial(Color{1, 1, 1}, Color{0, 0, 0}, 0.2, 0.0, 1.0, 0.7),
	}
	scene.shapes = []Shape{plane, sphere, sphere1}

	scene.lights = []Light{
		// The original's Light takes an optional intensity that defaults to 10,
		// and the first light leaves it out.
		{Vector{5, 10, -1}, Color{0.8, 0.8, 0.8}, 10},
		{Vector{-3, 5, -15}, Color{0.8, 0.8, 0.8}, 100},
	}

	const imageWidth, imageHeight = 100, 100
	const pixelWidth, pixelHeight = 5, 5

	raytracer := &Engine{Options{
		canvasHeight:      imageHeight / pixelHeight,
		canvasWidth:       imageWidth / pixelWidth,
		renderDiffuse:     true,
		renderShadows:     true,
		renderHighlights:  true,
		renderReflections: true,
		rayDepth:          2,
	}}

	raytracer.renderScene(scene)
}

func main() {
	harness.Run("RayTrace", 739989, nil, renderScene, nil)
}
