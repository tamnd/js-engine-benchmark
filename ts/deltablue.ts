// A typed-TypeScript port of v8-v7/deltablue.js, the DeltaBlue incremental
// constraint solver of Freeman-Benson and Maloney.
//
// The benchmark builds a chain of a hundred equality constraints and a hundred
// scale constraints, then repeatedly edits an endpoint and re-plans. What it
// measures is polymorphic method dispatch over a small class hierarchy and the
// pointer chasing of a graph walk, so the class shapes, the collection
// semantics, and the two test sizes are kept exactly as the original has them.
//
// Three shapes changed, all forced by the original being ES5 prototype code.
//
// The prototype chain built by `inheritsFrom` becomes `extends`. The original
// lets a constructor call a method the subclass overrides, and lets a subclass
// set its own fields before running the superclass constructor; TypeScript
// requires super() first. Only one constraint depends on that ordering
// (ScaleConstraint, whose addToGraph reads scale and offset), and the call it
// depends on, addConstraint(), is the last statement of every constructor
// anyway. So addConstraint() is hoisted out of the constructors to each
// construction site, which runs it at the same point in the same state.
//
// The static members on Strength become module-level bindings, since the
// values, not the namespace, are what the algorithm uses. Direction's three
// constants become plain numbers the same way.
//
// OrderedCollection becomes two classes. The original holds constraints in most
// of its collections and variables in one of them, which one untyped class
// covers; a generic one would too, but bento's AOT does not lower a generic
// class yet, so the two element types are two classes with the same body.

// A constraint's direction of flow. NONE also means "not satisfied", which is
// what isSatisfied tests for.
const NONE = 0;
const FORWARD = 1;
const BACKWARD = -1;

// The planner is a module binding rather than a field because Constraint
// methods reach it, and it has to be declared above them for bento's AOT, which
// will not let a function called from above a binding's declaration read it.
let planner: Planner | null = null;

// ConstraintCollection is the original's array wrapper. removeFirst is `pop`,
// so it takes from the end despite the name; the algorithm only needs some
// order, not that one, and changing it would change which plan is found.
class ConstraintCollection {
  elms: Constraint[];

  constructor() {
    this.elms = [];
  }

  add(elm: Constraint): void {
    this.elms.push(elm);
  }

  at(index: number): Constraint {
    return this.elms[index];
  }

  size(): number {
    return this.elms.length;
  }

  removeFirst(): Constraint {
    return this.elms.pop() as Constraint;
  }

  // remove compacts every element that is not elm toward the front and then
  // drops the tail, which is the original's in-place filter.
  remove(elm: Constraint): void {
    let index = 0;
    let skipped = 0;
    for (let i = 0; i < this.elms.length; i++) {
      const value = this.elms[i];
      if (value != elm) {
        this.elms[index] = value;
        index++;
      } else {
        skipped++;
      }
    }
    for (let i = 0; i < skipped; i++) this.elms.pop();
  }
}

// VariableCollection is the same wrapper over variables. Only the walk in
// removePropagateFrom uses one, and it never removes, so it carries just the
// four methods that walk needs.
class VariableCollection {
  elms: Variable[];

  constructor() {
    this.elms = [];
  }

  add(elm: Variable): void {
    this.elms.push(elm);
  }

  at(index: number): Variable {
    return this.elms[index];
  }

  size(): number {
    return this.elms.length;
  }

  removeFirst(): Variable {
    return this.elms.pop() as Variable;
  }
}

// Strength measures how important a constraint is. A lower strengthValue is
// stronger, and the instances below are the only ones, so two strengths are
// equal exactly when they are the same object.
class Strength {
  strengthValue: number;
  name: string;

  constructor(strengthValue: number, name: string) {
    this.strengthValue = strengthValue;
    this.name = name;
  }
}

const REQUIRED = new Strength(0, "required");
const STONG_PREFERRED = new Strength(1, "strongPreferred");
const PREFERRED = new Strength(2, "preferred");
const STRONG_DEFAULT = new Strength(3, "strongDefault");
const NORMAL = new Strength(4, "normal");
const WEAK_DEFAULT = new Strength(5, "weakDefault");
const WEAKEST = new Strength(6, "weakest");

function stronger(s1: Strength, s2: Strength): boolean {
  return s1.strengthValue < s2.strengthValue;
}

function weaker(s1: Strength, s2: Strength): boolean {
  return s1.strengthValue > s2.strengthValue;
}

function weakestOf(s1: Strength, s2: Strength): Strength {
  return weaker(s1, s2) ? s1 : s2;
}

// nextWeaker walks one step down the hierarchy. The original returns undefined
// for WEAKEST, which the one caller never asks for because its loop stops
// there; here that case returns WEAKEST so the function has a type.
function nextWeaker(s: Strength): Strength {
  switch (s.strengthValue) {
    case 0:
      return WEAKEST;
    case 1:
      return WEAK_DEFAULT;
    case 2:
      return NORMAL;
    case 3:
      return STRONG_DEFAULT;
    case 4:
      return PREFERRED;
    case 5:
      return REQUIRED;
  }
  return WEAKEST;
}

// A constrained variable. Besides its value it carries the solver's bookkeeping:
// which constraint currently determines it, the mark of the last walk that
// reached it, how strongly it is held, and whether it is known not to change.
class Variable {
  value: number;
  constraints: ConstraintCollection;
  determinedBy: Constraint | null;
  mark: number;
  walkStrength: Strength;
  stay: boolean;
  name: string;

  constructor(name: string, initialValue: number) {
    this.value = initialValue;
    this.constraints = new ConstraintCollection();
    this.determinedBy = null;
    this.mark = 0;
    this.walkStrength = WEAKEST;
    this.stay = true;
    this.name = name;
  }

  addConstraint(c: Constraint): void {
    this.constraints.add(c);
  }

  removeConstraint(c: Constraint): void {
    this.constraints.remove(c);
    if (this.determinedBy == c) this.determinedBy = null;
  }
}

// The base of the constraint hierarchy. The methods with no body here are the
// original's abstract ones: every constraint that is actually constructed
// overrides them, and the base versions exist only so the calls type.
class Constraint {
  strength: Strength;

  constructor(strength: Strength) {
    this.strength = strength;
  }

  // addConstraint activates the constraint. The original calls it from each
  // constructor; here each construction site calls it, which is the same point
  // in the same state (see the file comment).
  addConstraint(): void {
    this.addToGraph();
    (planner as Planner).incrementalAdd(this);
  }

  // satisfy enforces the constraint if it can, and answers the constraint it
  // displaced from its output variable, if any, so the caller can try to
  // re-satisfy that one some other way.
  satisfy(mark: number): Constraint | null {
    this.chooseMethod(mark);
    if (!this.isSatisfied()) {
      if (this.strength == REQUIRED) throw new Error("Could not satisfy a required constraint!");
      return null;
    }
    this.markInputs(mark);
    const out = this.output();
    const overridden = out.determinedBy;
    if (overridden != null) overridden.markUnsatisfied();
    out.determinedBy = this;
    if (!(planner as Planner).addPropagate(this, mark)) throw new Error("Cycle encountered");
    out.mark = mark;
    return overridden;
  }

  destroyConstraint(): void {
    if (this.isSatisfied()) (planner as Planner).incrementalRemove(this);
    else this.removeFromGraph();
  }

  // An input constraint depends on state outside the solver, which is what an
  // edit is; everything else answers false.
  isInput(): boolean {
    return false;
  }

  addToGraph(): void {}
  removeFromGraph(): void {}
  chooseMethod(mark: number): void {}
  isSatisfied(): boolean {
    return false;
  }
  markInputs(mark: number): void {}
  output(): Variable {
    throw new Error("abstract");
  }
  recalculate(): void {}
  markUnsatisfied(): void {}
  inputsKnown(mark: number): boolean {
    return false;
  }
  execute(): void {}
}

// A constraint with one variable, which is therefore always its output.
class UnaryConstraint extends Constraint {
  myOutput: Variable;
  satisfied: boolean;

  constructor(v: Variable, strength: Strength) {
    super(strength);
    this.myOutput = v;
    this.satisfied = false;
  }

  addToGraph(): void {
    this.myOutput.addConstraint(this);
    this.satisfied = false;
  }

  // A unary constraint is satisfiable when its output has not already been
  // reached on this walk and it holds the output more strongly than whatever
  // holds it now.
  chooseMethod(mark: number): void {
    this.satisfied = this.myOutput.mark != mark && stronger(this.strength, this.myOutput.walkStrength);
  }

  isSatisfied(): boolean {
    return this.satisfied;
  }

  markInputs(mark: number): void {
    // has no inputs
  }

  output(): Variable {
    return this.myOutput;
  }

  recalculate(): void {
    this.myOutput.walkStrength = this.strength;
    this.myOutput.stay = !this.isInput();
    if (this.myOutput.stay) this.execute(); // Stay optimization
  }

  markUnsatisfied(): void {
    this.satisfied = false;
  }

  inputsKnown(mark: number): boolean {
    return true;
  }

  removeFromGraph(): void {
    this.myOutput.removeConstraint(this);
    this.satisfied = false;
  }
}

// A variable that should keep its value if nothing stronger says otherwise.
class StayConstraint extends UnaryConstraint {
  constructor(v: Variable, str: Strength) {
    super(v, str);
  }

  execute(): void {
    // Stay constraints do nothing
  }
}

// A variable the client is about to change by hand.
class EditConstraint extends UnaryConstraint {
  constructor(v: Variable, str: Strength) {
    super(v, str);
  }

  isInput(): boolean {
    return true;
  }

  execute(): void {
    // Edit constraints do nothing
  }
}

// A constraint over two variables, either of which can be the output; direction
// records which way the solver chose to run it.
class BinaryConstraint extends Constraint {
  v1: Variable;
  v2: Variable;
  direction: number;

  constructor(var1: Variable, var2: Variable, strength: Strength) {
    super(strength);
    this.v1 = var1;
    this.v2 = var2;
    this.direction = NONE;
  }

  // chooseMethod picks the flow direction. The first two tests handle a
  // variable already reached on this walk, and the last pair pick whichever
  // side is held less strongly, since that is the one worth overwriting.
  chooseMethod(mark: number): void {
    if (this.v1.mark == mark) {
      this.direction = this.v2.mark != mark && stronger(this.strength, this.v2.walkStrength) ? FORWARD : NONE;
    }
    if (this.v2.mark == mark) {
      this.direction = this.v1.mark != mark && stronger(this.strength, this.v1.walkStrength) ? BACKWARD : NONE;
    }
    if (weaker(this.v1.walkStrength, this.v2.walkStrength)) {
      this.direction = stronger(this.strength, this.v1.walkStrength) ? BACKWARD : NONE;
    } else {
      this.direction = stronger(this.strength, this.v2.walkStrength) ? FORWARD : BACKWARD;
    }
  }

  addToGraph(): void {
    this.v1.addConstraint(this);
    this.v2.addConstraint(this);
    this.direction = NONE;
  }

  isSatisfied(): boolean {
    return this.direction != NONE;
  }

  markInputs(mark: number): void {
    this.input().mark = mark;
  }

  input(): Variable {
    return this.direction == FORWARD ? this.v1 : this.v2;
  }

  output(): Variable {
    return this.direction == FORWARD ? this.v2 : this.v1;
  }

  recalculate(): void {
    const ihn = this.input();
    const out = this.output();
    out.walkStrength = weakestOf(this.strength, ihn.walkStrength);
    out.stay = ihn.stay;
    if (out.stay) this.execute();
  }

  markUnsatisfied(): void {
    this.direction = NONE;
  }

  inputsKnown(mark: number): boolean {
    const i = this.input();
    return i.mark == mark || i.stay || i.determinedBy == null;
  }

  removeFromGraph(): void {
    this.v1.removeConstraint(this);
    this.v2.removeConstraint(this);
    this.direction = NONE;
  }
}

// Relates two variables by v2 = v1 * scale + offset. The scale and the offset
// are themselves variables, but read-only ones.
class ScaleConstraint extends BinaryConstraint {
  scale: Variable;
  offset: Variable;

  constructor(src: Variable, scale: Variable, offset: Variable, dest: Variable, strength: Strength) {
    super(src, dest, strength);
    this.scale = scale;
    this.offset = offset;
  }

  addToGraph(): void {
    super.addToGraph();
    this.scale.addConstraint(this);
    this.offset.addConstraint(this);
  }

  removeFromGraph(): void {
    super.removeFromGraph();
    this.scale.removeConstraint(this);
    this.offset.removeConstraint(this);
  }

  markInputs(mark: number): void {
    super.markInputs(mark);
    this.scale.mark = mark;
    this.offset.mark = mark;
  }

  execute(): void {
    if (this.direction == FORWARD) {
      this.v2.value = this.v1.value * this.scale.value + this.offset.value;
    } else {
      this.v1.value = (this.v2.value - this.offset.value) / this.scale.value;
    }
  }

  // Same as the binary version except the output only stays when the scale and
  // the offset stay too.
  recalculate(): void {
    const ihn = this.input();
    const out = this.output();
    out.walkStrength = weakestOf(this.strength, ihn.walkStrength);
    out.stay = ihn.stay && this.scale.stay && this.offset.stay;
    if (out.stay) this.execute();
  }
}

// Constrains two variables to hold the same value.
class EqualityConstraint extends BinaryConstraint {
  constructor(var1: Variable, var2: Variable, strength: Strength) {
    super(var1, var2, strength);
  }

  execute(): void {
    this.output().value = this.input().value;
  }
}

// A plan is the ordered list of constraints to run to bring the graph back to
// a consistent state after an edit.
class Plan {
  v: ConstraintCollection;

  constructor() {
    this.v = new ConstraintCollection();
  }

  addConstraint(c: Constraint): void {
    this.v.add(c);
  }

  size(): number {
    return this.v.size();
  }

  constraintAt(index: number): Constraint {
    return this.v.at(index);
  }

  execute(): void {
    for (let i = 0; i < this.size(); i++) {
      const c = this.constraintAt(i);
      c.execute();
    }
  }
}

class Planner {
  currentMark: number;

  constructor() {
    this.currentMark = 0;
  }

  // incrementalAdd satisfies a new constraint, then keeps re-satisfying
  // whatever it displaced until nothing is left over.
  incrementalAdd(c: Constraint): void {
    const mark = this.newMark();
    let overridden = c.satisfy(mark);
    while (overridden != null) overridden = overridden.satisfy(mark);
  }

  // incrementalRemove retracts a constraint and then tries to satisfy the
  // constraints that retraction freed up, strongest first, so a weak one is
  // not added just to be overridden a moment later.
  incrementalRemove(c: Constraint): void {
    const out = c.output();
    c.markUnsatisfied();
    c.removeFromGraph();
    const unsatisfied = this.removePropagateFrom(out);
    let strength = REQUIRED;
    do {
      for (let i = 0; i < unsatisfied.size(); i++) {
        const u = unsatisfied.at(i);
        if (u.strength == strength) this.incrementalAdd(u);
      }
      strength = nextWeaker(strength);
    } while (strength != WEAKEST);
  }

  newMark(): number {
    this.currentMark = this.currentMark + 1;
    return this.currentMark;
  }

  // makePlan walks downstream from the source constraints, appending each one
  // whose inputs are all known by the time it is reached.
  makePlan(sources: ConstraintCollection): Plan {
    const mark = this.newMark();
    const plan = new Plan();
    const todo = sources;
    while (todo.size() > 0) {
      const c = todo.removeFirst();
      if (c.output().mark != mark && c.inputsKnown(mark)) {
        plan.addConstraint(c);
        c.output().mark = mark;
        this.addConstraintsConsumingTo(c.output(), todo);
      }
    }
    return plan;
  }

  extractPlanFromConstraints(constraints: ConstraintCollection): Plan {
    const sources = new ConstraintCollection();
    for (let i = 0; i < constraints.size(); i++) {
      const c = constraints.at(i);
      // not in plan already and eligible for inclusion
      if (c.isInput() && c.isSatisfied()) sources.add(c);
    }
    return this.makePlan(sources);
  }

  // addPropagate recomputes strengths and stay flags downstream of c. Reaching
  // an already-marked variable means the graph has a cycle through c, so c is
  // retracted and the caller told the plan failed.
  addPropagate(c: Constraint, mark: number): boolean {
    const todo = new ConstraintCollection();
    todo.add(c);
    while (todo.size() > 0) {
      const d = todo.removeFirst();
      if (d.output().mark == mark) {
        this.incrementalRemove(c);
        return false;
      }
      d.recalculate();
      this.addConstraintsConsumingTo(d.output(), todo);
    }
    return true;
  }

  // removePropagateFrom clears out and walks everything downstream of it,
  // collecting the constraints that are now unsatisfied.
  removePropagateFrom(out: Variable): ConstraintCollection {
    out.determinedBy = null;
    out.walkStrength = WEAKEST;
    out.stay = true;
    const unsatisfied = new ConstraintCollection();
    const todo = new VariableCollection();
    todo.add(out);
    while (todo.size() > 0) {
      const v = todo.removeFirst();
      for (let i = 0; i < v.constraints.size(); i++) {
        const c = v.constraints.at(i);
        if (!c.isSatisfied()) unsatisfied.add(c);
      }
      const determining = v.determinedBy;
      for (let i = 0; i < v.constraints.size(); i++) {
        const next = v.constraints.at(i);
        if (next != determining && next.isSatisfied()) {
          next.recalculate();
          todo.add(next.output());
        }
      }
    }
    return unsatisfied;
  }

  addConstraintsConsumingTo(v: Variable, coll: ConstraintCollection): void {
    const determining = v.determinedBy;
    const cc = v.constraints;
    for (let i = 0; i < cc.size(); i++) {
      const c = cc.at(i);
      if (c != determining && c.isSatisfied()) coll.add(c);
    }
  }
}

// chainTest builds a chain of n equality constraints with a stay constraint on
// one end and an edit on the other, so a value written at the edit end has to
// propagate the whole length of the chain.
function chainTest(n: number): void {
  planner = new Planner();
  let prev: Variable | null = null;
  let first: Variable | null = null;
  let last: Variable | null = null;

  // Build chain of n equality constraints
  for (let i = 0; i <= n; i++) {
    const name = "v" + i;
    const v = new Variable(name, 0);
    if (prev != null) new EqualityConstraint(prev, v, REQUIRED).addConstraint();
    if (i == 0) first = v;
    if (i == n) last = v;
    prev = v;
  }

  new StayConstraint(last as Variable, STRONG_DEFAULT).addConstraint();
  const edit = new EditConstraint(first as Variable, PREFERRED);
  edit.addConstraint();
  const edits = new ConstraintCollection();
  edits.add(edit);
  const plan = (planner as Planner).extractPlanFromConstraints(edits);
  const firstVar = first as Variable;
  const lastVar = last as Variable;
  for (let i = 0; i < 100; i++) {
    firstVar.value = i;
    plan.execute();
    if (lastVar.value != i) throw new Error("Chain test failed.");
  }
}

// projectionTest relates two sets of variables by one shared scale and offset,
// then edits each side and the two factors in turn.
function projectionTest(n: number): void {
  planner = new Planner();
  const scale = new Variable("scale", 10);
  const offset = new Variable("offset", 1000);
  let src: Variable | null = null;
  let dst: Variable | null = null;

  const dests = new VariableCollection();
  for (let i = 0; i < n; i++) {
    src = new Variable("src" + i, i);
    dst = new Variable("dst" + i, i);
    dests.add(dst);
    new StayConstraint(src, NORMAL).addConstraint();
    new ScaleConstraint(src, scale, offset, dst, REQUIRED).addConstraint();
  }

  const srcVar = src as Variable;
  const dstVar = dst as Variable;
  change(srcVar, 17);
  if (dstVar.value != 1170) throw new Error("Projection 1 failed");
  change(dstVar, 1050);
  if (srcVar.value != 5) throw new Error("Projection 2 failed");
  change(scale, 5);
  for (let i = 0; i < n - 1; i++) {
    if (dests.at(i).value != i * 5 + 1000) throw new Error("Projection 3 failed");
  }
  change(offset, 2000);
  for (let i = 0; i < n - 1; i++) {
    if (dests.at(i).value != i * 5 + 2000) throw new Error("Projection 4 failed");
  }
}

// change writes newValue to v ten times through a fresh edit constraint, then
// retracts the edit, which is the unit of work the benchmark repeats.
function change(v: Variable, newValue: number): void {
  const edit = new EditConstraint(v, PREFERRED);
  edit.addConstraint();
  const edits = new ConstraintCollection();
  edits.add(edit);
  const plan = (planner as Planner).extractPlanFromConstraints(edits);
  for (let i = 0; i < 10; i++) {
    v.value = newValue;
    plan.execute();
  }
  edit.destroyConstraint();
}

export function deltaBlue(): void {
  chainTest(100);
  projectionTest(100);
}
