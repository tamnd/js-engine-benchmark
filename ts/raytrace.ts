// RayTrace, ported from v8-v7/raytrace.js to typed TypeScript.
//
// The original is Adam Burmister's ray tracer wired up through Prototype's
// Class.create/Object.extend, which builds every class by copying a literal onto
// a prototype. Two shapes of that idiom become real declarations here:
//
//   - the "static" helpers. Color.prototype.add(c1, c2) ignores its receiver and
//     reads only its two arguments, so it is a free function, colorAdd. Every
//     Vector and Color helper the original calls through .prototype is one.
//   - the material and shape hierarchies. Object.extend(new BaseMaterial(), {...})
//     is inheritance spelled by copying, so Solid and Chessboard extend Material
//     and override getColor, and Sphere and Plane extend Shape and override
//     intersect. The scene holds Shape[] and the loop dispatches on the override,
//     which is what the original's prototype lookup did.
//
// The rendered image is unchanged: renderScene still checks the diagonal
// brightness sum against 2321, so a port that drifted numerically fails loudly.

// checkNumber accumulates the brightness of the pixels on the diagonal, which is
// how the benchmark verifies the render without a canvas.
let checkNumber = 0;

class Color {
  red: number;
  green: number;
  blue: number;

  constructor(r: number, g: number, b: number) {
    this.red = r;
    this.green = g;
    this.blue = b;
  }

  limit(): void {
    this.red = this.red > 0.0 ? (this.red > 1.0 ? 1.0 : this.red) : 0.0;
    this.green = this.green > 0.0 ? (this.green > 1.0 ? 1.0 : this.green) : 0.0;
    this.blue = this.blue > 0.0 ? (this.blue > 1.0 ? 1.0 : this.blue) : 0.0;
  }

  brightness(): number {
    const r = Math.floor(this.red * 255);
    const g = Math.floor(this.green * 255);
    const b = Math.floor(this.blue * 255);
    return (r * 77 + g * 150 + b * 29) >> 8;
  }
}

function colorAdd(c1: Color, c2: Color): Color {
  return new Color(c1.red + c2.red, c1.green + c2.green, c1.blue + c2.blue);
}

function colorAddScalar(c1: Color, s: number): Color {
  const result = new Color(c1.red + s, c1.green + s, c1.blue + s);
  result.limit();
  return result;
}

function colorMultiply(c1: Color, c2: Color): Color {
  return new Color(c1.red * c2.red, c1.green * c2.green, c1.blue * c2.blue);
}

function colorMultiplyScalar(c1: Color, f: number): Color {
  return new Color(c1.red * f, c1.green * f, c1.blue * f);
}

function colorBlend(c1: Color, c2: Color, w: number): Color {
  return colorAdd(colorMultiplyScalar(c1, 1 - w), colorMultiplyScalar(c2, w));
}

class Light {
  position: Vector;
  color: Color;
  intensity: number;

  constructor(pos: Vector, color: Color, intensity: number) {
    this.position = pos;
    this.color = color;
    this.intensity = intensity;
  }
}

class Vector {
  x: number;
  y: number;
  z: number;

  constructor(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  normalize(): Vector {
    const m = this.magnitude();
    return new Vector(this.x / m, this.y / m, this.z / m);
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  cross(w: Vector): Vector {
    return new Vector(
      -this.z * w.y + this.y * w.z,
      this.z * w.x - this.x * w.z,
      -this.y * w.x + this.x * w.y,
    );
  }

  dot(w: Vector): number {
    return this.x * w.x + this.y * w.y + this.z * w.z;
  }
}

// vectorAdd takes its arguments in the original's order, (v, w) summed as w + v,
// which matters not at all for the result but keeps the call sites readable
// against the JavaScript.
function vectorAdd(v: Vector, w: Vector): Vector {
  return new Vector(w.x + v.x, w.y + v.y, w.z + v.z);
}

// The original guards subtract with `if (!w || !v) throw`, a check against an
// argument that is undefined. A typed Vector parameter cannot be, so the guard
// has no case left to catch and is dropped.
function vectorSubtract(v: Vector, w: Vector): Vector {
  return new Vector(v.x - w.x, v.y - w.y, v.z - w.z);
}

function vectorMultiplyScalar(v: Vector, w: number): Vector {
  return new Vector(v.x * w, v.y * w, v.z * w);
}

class Ray {
  position: Vector;
  direction: Vector;

  constructor(pos: Vector, dir: Vector) {
    this.position = pos;
    this.direction = dir;
  }
}

// Material is the BaseMaterial of the original. getColor returns nothing there,
// which every subclass overrides; here the base returns black so the return type
// is a Color rather than a Color-or-undefined nobody reads.
class Material {
  gloss: number;
  transparency: number;
  reflection: number;
  refraction: number;
  hasTexture: boolean;

  constructor() {
    this.gloss = 2.0;
    this.transparency = 0.0;
    this.reflection = 0.0;
    this.refraction = 0.5;
    this.hasTexture = false;
  }

  getColor(u: number, v: number): Color {
    return new Color(0, 0, 0);
  }

  wrapUp(t: number): number {
    t = t % 2.0;
    if (t < -1) t += 2.0;
    if (t >= 1) t -= 2.0;
    return t;
  }
}

class SolidMaterial extends Material {
  color: Color;

  constructor(color: Color, reflection: number, refraction: number, transparency: number, gloss: number) {
    super();
    this.color = color;
    this.reflection = reflection;
    this.transparency = transparency;
    this.gloss = gloss;
    this.hasTexture = false;
  }

  getColor(u: number, v: number): Color {
    return this.color;
  }
}

class ChessboardMaterial extends Material {
  colorEven: Color;
  colorOdd: Color;
  density: number;

  constructor(
    colorEven: Color,
    colorOdd: Color,
    reflection: number,
    transparency: number,
    gloss: number,
    density: number,
  ) {
    super();
    this.colorEven = colorEven;
    this.colorOdd = colorOdd;
    this.reflection = reflection;
    this.transparency = transparency;
    this.gloss = gloss;
    this.density = density;
    this.hasTexture = true;
  }

  getColor(u: number, v: number): Color {
    const t = this.wrapUp(u * this.density) * this.wrapUp(v * this.density);
    if (t < 0.0) return this.colorEven;
    return this.colorOdd;
  }
}

// Shape is the common face of Sphere and Plane. The original has no such class:
// both prototypes simply carry position, material and intersect, and the render
// loop calls intersect on whatever is in the array. Naming the base makes the
// array's element type sayable and the intersect call a virtual one.
class Shape {
  position: Vector;
  material: Material;

  constructor(pos: Vector, material: Material) {
    this.position = pos;
    this.material = material;
  }

  intersect(ray: Ray): IntersectionInfo {
    return new IntersectionInfo();
  }
}

class Sphere extends Shape {
  radius: number;

  constructor(pos: Vector, radius: number, material: Material) {
    super(pos, material);
    this.radius = radius;
  }

  intersect(ray: Ray): IntersectionInfo {
    const info = new IntersectionInfo();
    info.shape = this;

    const dst = vectorSubtract(ray.position, this.position);

    const B = dst.dot(ray.direction);
    const C = dst.dot(dst) - this.radius * this.radius;
    const D = B * B - C;

    if (D > 0) {
      // intersection!
      info.isHit = true;
      info.distance = -B - Math.sqrt(D);
      info.position = vectorAdd(ray.position, vectorMultiplyScalar(ray.direction, info.distance));
      info.normal = vectorSubtract(info.position, this.position).normalize();
      info.color = this.material.getColor(0, 0);
    } else {
      info.isHit = false;
    }
    return info;
  }
}

class Plane extends Shape {
  d: number;

  constructor(pos: Vector, d: number, material: Material) {
    super(pos, material);
    this.d = d;
  }

  intersect(ray: Ray): IntersectionInfo {
    const info = new IntersectionInfo();

    const Vd = this.position.dot(ray.direction);
    if (Vd == 0) return info; // no intersection

    const t = -(this.position.dot(ray.position) + this.d) / Vd;
    if (t <= 0) return info;

    info.shape = this;
    info.isHit = true;
    info.position = vectorAdd(ray.position, vectorMultiplyScalar(ray.direction, t));
    info.normal = this.position;
    info.distance = t;

    if (this.material.hasTexture) {
      const vU = new Vector(this.position.y, this.position.z, -this.position.x);
      const vV = vU.cross(this.position);
      const u = info.position.dot(vU);
      const v = info.position.dot(vV);
      info.color = this.material.getColor(u, v);
    } else {
      info.color = this.material.getColor(0, 0);
    }

    return info;
  }
}

// IntersectionInfo starts at the original's defaults. position, normal and
// distance are null there and are read only after isHit says they were written,
// so they start at a zero vector and a zero distance rather than carrying a null
// every reader would have to strip.
class IntersectionInfo {
  isHit: boolean;
  hitCount: number;
  shape: Shape | null;
  position: Vector;
  normal: Vector;
  color: Color;
  distance: number;

  constructor() {
    this.isHit = false;
    this.hitCount = 0;
    this.shape = null;
    this.position = new Vector(0, 0, 0);
    this.normal = new Vector(0, 0, 0);
    this.color = new Color(0, 0, 0);
    this.distance = 0;
  }
}

class Camera {
  position: Vector;
  lookAt: Vector;
  equator: Vector;
  up: Vector;
  screen: Vector;

  constructor(pos: Vector, lookAt: Vector, up: Vector) {
    this.position = pos;
    this.lookAt = lookAt;
    this.up = up;
    this.equator = lookAt.normalize().cross(this.up);
    this.screen = vectorAdd(this.position, this.lookAt);
  }

  getRay(vx: number, vy: number): Ray {
    const pos = vectorSubtract(
      this.screen,
      vectorSubtract(vectorMultiplyScalar(this.equator, vx), vectorMultiplyScalar(this.up, vy)),
    );
    pos.y = pos.y * -1;
    const dir = vectorSubtract(pos, this.position);
    return new Ray(pos, dir.normalize());
  }
}

class Background {
  color: Color;
  ambience: number;

  constructor(color: Color, ambience: number) {
    this.color = color;
    this.ambience = ambience;
  }
}

class Scene {
  camera: Camera;
  shapes: Shape[];
  lights: Light[];
  background: Background;

  constructor() {
    this.camera = new Camera(new Vector(0, 0, -5), new Vector(0, 0, 1), new Vector(0, 1, 0));
    this.shapes = [];
    this.lights = [];
    this.background = new Background(new Color(0, 0, 0.5), 0.2);
  }
}

// Options is the object literal the original merges into its defaults with
// Object.extend. renderScene passes every field, so the merge has nothing left
// to fill in and the defaults live in the field initializers.
class Options {
  canvasHeight: number;
  canvasWidth: number;
  pixelWidth: number;
  pixelHeight: number;
  renderDiffuse: boolean;
  renderShadows: boolean;
  renderHighlights: boolean;
  renderReflections: boolean;
  rayDepth: number;

  constructor(
    canvasHeight: number,
    canvasWidth: number,
    pixelWidth: number,
    pixelHeight: number,
    renderDiffuse: boolean,
    renderShadows: boolean,
    renderHighlights: boolean,
    renderReflections: boolean,
    rayDepth: number,
  ) {
    this.canvasHeight = canvasHeight;
    this.canvasWidth = canvasWidth;
    this.pixelWidth = pixelWidth;
    this.pixelHeight = pixelHeight;
    this.renderDiffuse = renderDiffuse;
    this.renderShadows = renderShadows;
    this.renderHighlights = renderHighlights;
    this.renderReflections = renderReflections;
    this.rayDepth = rayDepth;
  }
}

class Engine {
  options: Options;

  constructor(options: Options) {
    this.options = options;
    this.options.canvasHeight /= this.options.pixelHeight;
    this.options.canvasWidth /= this.options.pixelWidth;
  }

  // The canvas branch of the original's setPixel draws a rectangle. There is no
  // canvas in the benchmark, so only the accumulate-the-diagonal branch is left.
  setPixel(x: number, y: number, color: Color): void {
    if (x === y) {
      checkNumber += color.brightness();
    }
  }

  renderScene(scene: Scene): void {
    checkNumber = 0;

    const canvasHeight = this.options.canvasHeight;
    const canvasWidth = this.options.canvasWidth;

    for (let y = 0; y < canvasHeight; y++) {
      for (let x = 0; x < canvasWidth; x++) {
        const yp = ((y * 1.0) / canvasHeight) * 2 - 1;
        const xp = ((x * 1.0) / canvasWidth) * 2 - 1;

        const ray = scene.camera.getRay(xp, yp);
        const color = this.getPixelColor(ray, scene);

        this.setPixel(x, y, color);
      }
    }
    if (checkNumber !== 2321) {
      throw new Error("Scene rendered incorrectly");
    }
  }

  getPixelColor(ray: Ray, scene: Scene): Color {
    const info = this.testIntersection(ray, scene, null);
    if (info.isHit) {
      return this.rayTrace(info, ray, scene, 0);
    }
    return scene.background.color;
  }

  testIntersection(ray: Ray, scene: Scene, exclude: Shape | null): IntersectionInfo {
    let hits = 0;
    let best = new IntersectionInfo();
    best.distance = 2000;

    for (let i = 0; i < scene.shapes.length; i++) {
      const shape = scene.shapes[i];

      if (shape !== exclude) {
        const info = shape.intersect(ray);
        if (info.isHit && info.distance >= 0 && info.distance < best.distance) {
          best = info;
          hits++;
        }
      }
    }
    best.hitCount = hits;
    return best;
  }

  getReflectionRay(P: Vector, N: Vector, V: Vector): Ray {
    const c1 = -N.dot(V);
    const R1 = vectorAdd(vectorMultiplyScalar(N, 2 * c1), V);
    return new Ray(P, R1);
  }

  rayTrace(info: IntersectionInfo, ray: Ray, scene: Scene, depth: number): Color {
    // Calc ambient
    let color = colorMultiplyScalar(info.color, scene.background.ambience);
    // info.shape is set on every hit, and rayTrace runs only on a hit, so the
    // assertion is the isHit test the caller already made.
    const shape = info.shape!;
    const shininess = Math.pow(10, shape.material.gloss + 1);

    for (let i = 0; i < scene.lights.length; i++) {
      const light = scene.lights[i];

      // Calc diffuse lighting
      const v = vectorSubtract(light.position, info.position).normalize();

      if (this.options.renderDiffuse) {
        const L = v.dot(info.normal);
        if (L > 0.0) {
          color = colorAdd(color, colorMultiply(info.color, colorMultiplyScalar(light.color, L)));
        }
      }

      // The greater the depth the more accurate the colours, but this is
      // exponentially (!) expensive
      if (depth <= this.options.rayDepth) {
        // calculate reflection ray
        if (this.options.renderReflections && shape.material.reflection > 0) {
          const reflectionRay = this.getReflectionRay(info.position, info.normal, ray.direction);
          const refl = this.testIntersection(reflectionRay, scene, shape);

          if (refl.isHit && refl.distance > 0) {
            refl.color = this.rayTrace(refl, reflectionRay, scene, depth + 1);
          } else {
            refl.color = scene.background.color;
          }

          color = colorBlend(color, refl.color, shape.material.reflection);
        }

        // Refraction
        /* TODO */
      }

      /* Render shadows and highlights */

      let shadowInfo = new IntersectionInfo();

      if (this.options.renderShadows) {
        const shadowRay = new Ray(info.position, v);

        shadowInfo = this.testIntersection(shadowRay, scene, shape);
        if (shadowInfo.isHit && shadowInfo.shape !== info.shape) {
          const vA = colorMultiplyScalar(color, 0.5);
          const dB = 0.5 * Math.pow(shadowInfo.shape!.material.transparency, 0.5);
          color = colorAddScalar(vA, dB);
        }
      }

      // Phong specular highlights
      if (this.options.renderHighlights && !shadowInfo.isHit && shape.material.gloss > 0) {
        const Lv = vectorSubtract(shape.position, light.position).normalize();
        const E = vectorSubtract(scene.camera.position, shape.position).normalize();
        const H = vectorSubtract(E, Lv).normalize();

        const glossWeight = Math.pow(Math.max(info.normal.dot(H), 0), shininess);
        color = colorAdd(colorMultiplyScalar(light.color, glossWeight), color);
      }
    }
    color.limit();
    return color;
  }
}

export function renderScene(): void {
  const scene = new Scene();

  scene.camera = new Camera(new Vector(0, 0, -15), new Vector(-0.2, 0, 5), new Vector(0, 1, 0));

  scene.background = new Background(new Color(0.5, 0.5, 0.5), 0.4);

  const sphere = new Sphere(
    new Vector(-1.5, 1.5, 2),
    1.5,
    new SolidMaterial(new Color(0, 0.5, 0.5), 0.3, 0.0, 0.0, 2.0),
  );

  const sphere1 = new Sphere(
    new Vector(1, 0.25, 1),
    0.5,
    new SolidMaterial(new Color(0.9, 0.9, 0.9), 0.1, 0.0, 0.0, 1.5),
  );

  const plane = new Plane(
    new Vector(0.1, 0.9, -0.5).normalize(),
    1.2,
    new ChessboardMaterial(new Color(1, 1, 1), new Color(0, 0, 0), 0.2, 0.0, 1.0, 0.7),
  );

  scene.shapes.push(plane);
  scene.shapes.push(sphere);
  scene.shapes.push(sphere1);

  // The original's Light takes an optional intensity that defaults to 10, and
  // the first light leaves it out.
  const light = new Light(new Vector(5, 10, -1), new Color(0.8, 0.8, 0.8), 10);
  const light1 = new Light(new Vector(-3, 5, -15), new Color(0.8, 0.8, 0.8), 100);

  scene.lights.push(light);
  scene.lights.push(light1);

  const imageWidth = 100;
  const imageHeight = 100;
  // The original splits the string "5,5" to get these, then divides the canvas
  // size by them, which coerces the halves back to numbers.
  const pixelWidth = 5;
  const pixelHeight = 5;

  const raytracer = new Engine(
    new Options(imageHeight, imageWidth, pixelWidth, pixelHeight, true, true, true, true, 2),
  );

  raytracer.renderScene(scene);
}
