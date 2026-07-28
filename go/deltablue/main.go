// DeltaBlue in Go, from the same algorithm as v8-v7/deltablue.js and
// ts/deltablue.ts: the incremental constraint solver of Freeman-Benson and
// Maloney.
//
// The benchmark is a graph walk over a small hierarchy of constraint kinds, so
// the hierarchy is the one thing that has to survive the port. It does, as an
// interface plus two embedded base structs: the code every constraint shares
// sits in unaryConstraint and binaryConstraint, and a kind that needs its own
// version of a method writes one. The generic parts of the algorithm that the
// JavaScript hangs off the base class, satisfy and destroy, are functions over
// the interface here, because they don't vary at all.
//
// Two smaller changes. Strength is an int rather than an object, so comparing
// strengths compares numbers instead of pointers. The collection wrapper is
// gone: it is a slice used as a stack, and removeFirst is a pop from the end,
// which is what the original does too despite its name. Neither changes what is
// computed, and the chain and projection tests still check the same values.
package main

import (
	"strconv"

	"github.com/tamnd/js-engine-benchmark/go/harness"
)

// A constraint's direction of flow. none also means "not satisfied", which is
// what isSatisfied tests for.
const (
	none     = 0
	forward  = 1
	backward = -1
)

// Strength measures how important a constraint is: the lower the value the
// stronger the constraint, so stronger is <.
type Strength int

const (
	required        Strength = 0
	strongPreferred Strength = 1
	preferred       Strength = 2
	strongDefault   Strength = 3
	normal          Strength = 4
	weakDefault     Strength = 5
	weakest         Strength = 6
)

func stronger(a, b Strength) bool { return a < b }
func weaker(a, b Strength) bool   { return a > b }

func weakestOf(a, b Strength) Strength {
	if weaker(a, b) {
		return a
	}
	return b
}

// nextWeaker walks one step down the hierarchy. The table is the original's,
// including the two entries that don't step down at all: required answers
// weakest, which ends incrementalRemove's loop after a single pass, and
// strongDefault answers itself. Fixing either would change which plans the
// solver finds and so what the benchmark measures.
func nextWeaker(s Strength) Strength {
	switch s {
	case required:
		return weakest
	case strongPreferred:
		return weakDefault
	case preferred:
		return normal
	case strongDefault:
		return strongDefault
	case normal:
		return preferred
	case weakDefault:
		return required
	}
	return weakest
}

// planner is package state because every constraint reaches it, exactly as the
// original's global does. Each test installs a fresh one.
var planner *Planner

// Variable is a constrained variable. Besides its value it carries the solver's
// bookkeeping: which constraint currently determines it, the mark of the last
// walk that reached it, how strongly it is held, and whether it is known not to
// change.
type Variable struct {
	value        float64
	constraints  []Constraint
	determinedBy Constraint
	mark         int
	walkStrength Strength
	stay         bool
	name         string
}

func newVariable(name string, initialValue float64) *Variable {
	return &Variable{value: initialValue, walkStrength: weakest, stay: true, name: name}
}

func (v *Variable) addConstraint(c Constraint) {
	v.constraints = append(v.constraints, c)
}

func (v *Variable) removeConstraint(c Constraint) {
	kept := v.constraints[:0]
	for _, e := range v.constraints {
		if e != c {
			kept = append(kept, e)
		}
	}
	v.constraints = kept
	if v.determinedBy == c {
		v.determinedBy = nil
	}
}

// Constraint is what the solver dispatches on. Every method here is one the
// JavaScript declares abstract on the base class and every constructed kind
// overrides.
type Constraint interface {
	Strength() Strength
	AddToGraph()
	RemoveFromGraph()
	ChooseMethod(mark int)
	IsSatisfied() bool
	MarkInputs(mark int)
	Output() *Variable
	Recalculate()
	MarkUnsatisfied()
	InputsKnown(mark int) bool
	Execute()
	// IsInput answers whether the constraint depends on state outside the
	// solver, which is what an edit is; everything else answers false.
	IsInput() bool
}

// addConstraint activates a constraint. The JavaScript runs this at the end of
// each constructor, which TypeScript and Go both make awkward, so it is a step
// at the construction site instead. Same point, same state.
func addConstraint(c Constraint) {
	c.AddToGraph()
	planner.incrementalAdd(c)
}

// satisfy enforces a constraint if it can, and answers the constraint it
// displaced from its output variable, if any, so the caller can try to
// re-satisfy that one some other way.
func satisfy(c Constraint, mark int) Constraint {
	c.ChooseMethod(mark)
	if !c.IsSatisfied() {
		if c.Strength() == required {
			panic("could not satisfy a required constraint")
		}
		return nil
	}
	c.MarkInputs(mark)
	out := c.Output()
	overridden := out.determinedBy
	if overridden != nil {
		overridden.MarkUnsatisfied()
	}
	out.determinedBy = c
	if !planner.addPropagate(c, mark) {
		panic("cycle encountered")
	}
	out.mark = mark
	return overridden
}

func destroyConstraint(c Constraint) {
	if c.IsSatisfied() {
		planner.incrementalRemove(c)
	} else {
		c.RemoveFromGraph()
	}
}

// unaryConstraint has one variable, which is therefore always its output. The
// two kinds built on it, stay and edit, differ only in whether they are inputs
// and neither does anything when executed, so they are this one type with the
// flag rather than two empty subclasses.
type unaryConstraint struct {
	strength  Strength
	myOutput  *Variable
	satisfied bool
	isInput   bool
}

// newStayConstraint holds a variable at its current value unless something
// stronger says otherwise.
func newStayConstraint(v *Variable, s Strength) *unaryConstraint {
	return &unaryConstraint{strength: s, myOutput: v}
}

// newEditConstraint marks a variable the client is about to change by hand.
func newEditConstraint(v *Variable, s Strength) *unaryConstraint {
	return &unaryConstraint{strength: s, myOutput: v, isInput: true}
}

func (u *unaryConstraint) Strength() Strength   { return u.strength }
func (u *unaryConstraint) IsInput() bool        { return u.isInput }
func (u *unaryConstraint) IsSatisfied() bool    { return u.satisfied }
func (u *unaryConstraint) Output() *Variable    { return u.myOutput }
func (u *unaryConstraint) MarkUnsatisfied()     { u.satisfied = false }
func (u *unaryConstraint) MarkInputs(int)       {} // has no inputs
func (u *unaryConstraint) InputsKnown(int) bool { return true }
func (u *unaryConstraint) Execute()             {} // stay and edit both do nothing

func (u *unaryConstraint) AddToGraph() {
	u.myOutput.addConstraint(u)
	u.satisfied = false
}

func (u *unaryConstraint) RemoveFromGraph() {
	u.myOutput.removeConstraint(u)
	u.satisfied = false
}

// ChooseMethod satisfies the constraint when its output has not already been
// reached on this walk and it holds the output more strongly than whatever
// holds it now.
func (u *unaryConstraint) ChooseMethod(mark int) {
	u.satisfied = u.myOutput.mark != mark && stronger(u.strength, u.myOutput.walkStrength)
}

func (u *unaryConstraint) Recalculate() {
	u.myOutput.walkStrength = u.strength
	u.myOutput.stay = !u.isInput
	if u.myOutput.stay {
		u.Execute() // stay optimization
	}
}

// binaryConstraint relates two variables, either of which can be the output;
// direction records which way the solver chose to run it.
//
// self is the equality or scale constraint this is embedded in. Embedding gives
// the outer type these methods but not the other way round, and both matter
// here: a variable's constraint list has to hold the outer value, since the
// solver compares constraints by identity, and the shared Recalculate has to
// reach the outer Execute. So each constructor hands the base a reference back.
type binaryConstraint struct {
	self      Constraint
	strength  Strength
	v1, v2    *Variable
	direction int
}

func (b *binaryConstraint) Strength() Strength { return b.strength }
func (b *binaryConstraint) IsInput() bool      { return false }
func (b *binaryConstraint) IsSatisfied() bool  { return b.direction != none }
func (b *binaryConstraint) MarkUnsatisfied()   { b.direction = none }

func (b *binaryConstraint) input() *Variable {
	if b.direction == forward {
		return b.v1
	}
	return b.v2
}

func (b *binaryConstraint) Output() *Variable {
	if b.direction == forward {
		return b.v2
	}
	return b.v1
}

func (b *binaryConstraint) AddToGraph() {
	b.v1.addConstraint(b.self)
	b.v2.addConstraint(b.self)
	b.direction = none
}

func (b *binaryConstraint) RemoveFromGraph() {
	b.v1.removeConstraint(b.self)
	b.v2.removeConstraint(b.self)
	b.direction = none
}

func (b *binaryConstraint) Recalculate() {
	in, out := b.input(), b.Output()
	out.walkStrength = weakestOf(b.strength, in.walkStrength)
	out.stay = in.stay
	if out.stay {
		b.self.Execute()
	}
}

// ChooseMethod picks the flow direction. The first two tests handle a variable
// already reached on this walk and the last pair pick whichever side is held
// less strongly, since that is the one worth overwriting. The tests are not
// exclusive in the original either: the last one runs unconditionally and
// overwrites whatever the first two decided, and the benchmark's expected
// results are the results of that.
func (b *binaryConstraint) ChooseMethod(mark int) {
	if b.v1.mark == mark {
		if b.v2.mark != mark && stronger(b.strength, b.v2.walkStrength) {
			b.direction = forward
		} else {
			b.direction = none
		}
	}
	if b.v2.mark == mark {
		if b.v1.mark != mark && stronger(b.strength, b.v1.walkStrength) {
			b.direction = backward
		} else {
			b.direction = none
		}
	}
	if weaker(b.v1.walkStrength, b.v2.walkStrength) {
		if stronger(b.strength, b.v1.walkStrength) {
			b.direction = backward
		} else {
			b.direction = none
		}
	} else {
		if stronger(b.strength, b.v2.walkStrength) {
			b.direction = forward
		} else {
			b.direction = backward
		}
	}
}

func (b *binaryConstraint) MarkInputs(mark int) {
	b.input().mark = mark
}

func (b *binaryConstraint) InputsKnown(mark int) bool {
	i := b.input()
	return i.mark == mark || i.stay || i.determinedBy == nil
}

// equalityConstraint constrains two variables to hold the same value.
type equalityConstraint struct {
	binaryConstraint
}

func newEqualityConstraint(v1, v2 *Variable, s Strength) *equalityConstraint {
	e := &equalityConstraint{binaryConstraint{strength: s, v1: v1, v2: v2, direction: none}}
	e.self = e
	return e
}

func (e *equalityConstraint) Execute() {
	e.Output().value = e.input().value
}

// scaleConstraint relates two variables by v2 = v1 * scale + offset. The scale
// and the offset are themselves variables, but read-only ones.
type scaleConstraint struct {
	binaryConstraint
	scale, offset *Variable
}

func newScaleConstraint(src, scale, offset, dest *Variable, s Strength) *scaleConstraint {
	c := &scaleConstraint{
		binaryConstraint: binaryConstraint{strength: s, v1: src, v2: dest, direction: none},
		scale:            scale,
		offset:           offset,
	}
	c.self = c
	return c
}

func (s *scaleConstraint) AddToGraph() {
	s.binaryConstraint.AddToGraph()
	s.scale.addConstraint(s)
	s.offset.addConstraint(s)
}

func (s *scaleConstraint) RemoveFromGraph() {
	s.binaryConstraint.RemoveFromGraph()
	s.scale.removeConstraint(s)
	s.offset.removeConstraint(s)
}

func (s *scaleConstraint) MarkInputs(mark int) {
	s.binaryConstraint.MarkInputs(mark)
	s.scale.mark = mark
	s.offset.mark = mark
}

func (s *scaleConstraint) Execute() {
	if s.direction == forward {
		s.v2.value = s.v1.value*s.scale.value + s.offset.value
	} else {
		s.v1.value = (s.v2.value - s.offset.value) / s.scale.value
	}
}

// Recalculate is the binary version except that the output only stays when the
// scale and the offset stay too.
func (s *scaleConstraint) Recalculate() {
	in, out := s.input(), s.Output()
	out.walkStrength = weakestOf(s.strength, in.walkStrength)
	out.stay = in.stay && s.scale.stay && s.offset.stay
	if out.stay {
		s.Execute()
	}
}

// Planner keeps the walk counter. A plan is the ordered list of constraints to
// run to bring the graph back to a consistent state after an edit, which is a
// plain slice here.
type Planner struct {
	currentMark int
}

func (p *Planner) newMark() int {
	p.currentMark++
	return p.currentMark
}

// incrementalAdd satisfies a new constraint, then keeps re-satisfying whatever
// it displaced until nothing is left over.
func (p *Planner) incrementalAdd(c Constraint) {
	mark := p.newMark()
	for overridden := satisfy(c, mark); overridden != nil; {
		overridden = satisfy(overridden, mark)
	}
}

// incrementalRemove retracts a constraint and then tries to satisfy the
// constraints that retraction freed up, strongest first, so a weak one is not
// added just to be overridden a moment later.
func (p *Planner) incrementalRemove(c Constraint) {
	out := c.Output()
	c.MarkUnsatisfied()
	c.RemoveFromGraph()
	unsatisfied := p.removePropagateFrom(out)
	strength := required
	for {
		for _, u := range unsatisfied {
			if u.Strength() == strength {
				p.incrementalAdd(u)
			}
		}
		strength = nextWeaker(strength)
		if strength == weakest {
			return
		}
	}
}

// makePlan walks downstream from the source constraints, appending each one
// whose inputs are all known by the time it is reached.
func (p *Planner) makePlan(sources []Constraint) []Constraint {
	mark := p.newMark()
	var plan []Constraint
	todo := sources
	for len(todo) > 0 {
		c := todo[len(todo)-1]
		todo = todo[:len(todo)-1]
		if c.Output().mark != mark && c.InputsKnown(mark) {
			plan = append(plan, c)
			c.Output().mark = mark
			todo = addConstraintsConsumingTo(c.Output(), todo)
		}
	}
	return plan
}

func (p *Planner) extractPlanFromConstraints(constraints []Constraint) []Constraint {
	var sources []Constraint
	for _, c := range constraints {
		// not in plan already and eligible for inclusion
		if c.IsInput() && c.IsSatisfied() {
			sources = append(sources, c)
		}
	}
	return p.makePlan(sources)
}

// addPropagate recomputes strengths and stay flags downstream of c. Reaching an
// already-marked variable means the graph has a cycle through c, so c is
// retracted and the caller told the plan failed.
func (p *Planner) addPropagate(c Constraint, mark int) bool {
	todo := []Constraint{c}
	for len(todo) > 0 {
		d := todo[len(todo)-1]
		todo = todo[:len(todo)-1]
		if d.Output().mark == mark {
			p.incrementalRemove(c)
			return false
		}
		d.Recalculate()
		todo = addConstraintsConsumingTo(d.Output(), todo)
	}
	return true
}

// removePropagateFrom clears out and walks everything downstream of it,
// collecting the constraints that are now unsatisfied.
func (p *Planner) removePropagateFrom(out *Variable) []Constraint {
	out.determinedBy = nil
	out.walkStrength = weakest
	out.stay = true
	var unsatisfied []Constraint
	todo := []*Variable{out}
	for len(todo) > 0 {
		v := todo[len(todo)-1]
		todo = todo[:len(todo)-1]
		for _, c := range v.constraints {
			if !c.IsSatisfied() {
				unsatisfied = append(unsatisfied, c)
			}
		}
		determining := v.determinedBy
		for _, next := range v.constraints {
			if next != determining && next.IsSatisfied() {
				next.Recalculate()
				todo = append(todo, next.Output())
			}
		}
	}
	return unsatisfied
}

func addConstraintsConsumingTo(v *Variable, coll []Constraint) []Constraint {
	determining := v.determinedBy
	for _, c := range v.constraints {
		if c != determining && c.IsSatisfied() {
			coll = append(coll, c)
		}
	}
	return coll
}

func executePlan(plan []Constraint) {
	for _, c := range plan {
		c.Execute()
	}
}

// chainTest builds a chain of n equality constraints with a stay constraint on
// one end and an edit on the other, so a value written at the edit end has to
// propagate the whole length of the chain.
func chainTest(n int) {
	planner = &Planner{}
	var prev, first, last *Variable

	// The names are only ever stored, but building them is work the JavaScript
	// does on every iteration, so this does it too.
	for i := 0; i <= n; i++ {
		v := newVariable("v"+strconv.Itoa(i), 0)
		if prev != nil {
			addConstraint(newEqualityConstraint(prev, v, required))
		}
		if i == 0 {
			first = v
		}
		if i == n {
			last = v
		}
		prev = v
	}

	addConstraint(newStayConstraint(last, strongDefault))
	edit := newEditConstraint(first, preferred)
	addConstraint(edit)
	plan := planner.extractPlanFromConstraints([]Constraint{edit})
	for i := 0; i < 100; i++ {
		first.value = float64(i)
		executePlan(plan)
		if last.value != float64(i) {
			panic("chain test failed")
		}
	}
}

// projectionTest relates two sets of variables by one shared scale and offset,
// then edits each side and the two factors in turn.
func projectionTest(n int) {
	planner = &Planner{}
	scale := newVariable("scale", 10)
	offset := newVariable("offset", 1000)
	var src, dst *Variable

	dests := make([]*Variable, 0, n)
	for i := 0; i < n; i++ {
		src = newVariable("src"+strconv.Itoa(i), float64(i))
		dst = newVariable("dst"+strconv.Itoa(i), float64(i))
		dests = append(dests, dst)
		addConstraint(newStayConstraint(src, normal))
		addConstraint(newScaleConstraint(src, scale, offset, dst, required))
	}

	change(src, 17)
	if dst.value != 1170 {
		panic("projection 1 failed")
	}
	change(dst, 1050)
	if src.value != 5 {
		panic("projection 2 failed")
	}
	change(scale, 5)
	for i := 0; i < n-1; i++ {
		if dests[i].value != float64(i*5+1000) {
			panic("projection 3 failed")
		}
	}
	change(offset, 2000)
	for i := 0; i < n-1; i++ {
		if dests[i].value != float64(i*5+2000) {
			panic("projection 4 failed")
		}
	}
}

// change writes newValue to v ten times through a fresh edit constraint, then
// retracts the edit, which is the unit of work the benchmark repeats.
func change(v *Variable, newValue float64) {
	edit := newEditConstraint(v, preferred)
	addConstraint(edit)
	plan := planner.extractPlanFromConstraints([]Constraint{edit})
	for i := 0; i < 10; i++ {
		v.value = newValue
		executePlan(plan)
	}
	destroyConstraint(edit)
}

func deltaBlue() {
	chainTest(100)
	projectionTest(100)
}

func main() {
	harness.Run("DeltaBlue", 66118, nil, deltaBlue, nil)
}
