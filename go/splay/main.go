// Splay in Go, from the same load as v8-v7/splay.js and ts/splay.ts: a splay
// tree of 8000 nodes, each hung with a small junk payload tree, churned by
// inserting and removing nodes.
//
// The benchmark exists to make a garbage collector work, so the port keeps the
// allocation and drops nothing: the same node count, the same payload depth, the
// same ten-element slice and formatted key string at every payload leaf. What it
// measures in Go is Go's collector rather than a JavaScript engine's, which is
// the interesting half of the comparison.
//
// The payload's two object literals stay two shapes here, for the reason spelled
// out on Payload below: in a benchmark about tracing, how wide a node is is part
// of the workload.
package main

import (
	"strconv"

	"github.com/tamnd/js-engine-benchmark/go/harness"
)

const (
	splayTreeSize          = 8000
	splayTreeModifications = 80
	splayTreePayloadDepth  = 5
)

// Payload is the junk tree hung off every splay-tree node. Nothing ever reads it
// back, which is the point: it exists to make each insert allocate.
//
// The original is two different object literals, {left, right} at a branch and
// {array, string} at a leaf. Keeping them as two shapes is what this type and
// PayloadLeaf are for. An earlier version of this port merged them into one
// struct with all four fields, which is a fair description of the tree but not
// of its cost: it gave every branch a slice header and a string header it never
// uses, so each of the 31 branches in a payload was four pointers wide instead
// of two, and this benchmark is a measurement of how much the collector has to
// trace. A branch is now the two pointers the original's branch is.
type Payload struct {
	left, right *Payload
}

// PayloadLeaf is the bottom of the payload tree, the shape that carries the ten
// element slice and the text. Payload is embedded first so a leaf's address is
// also the address of a Payload and generatePayloadTree can return either, which
// is the closest Go gets to the original's two-literal union. The embedded
// branch pointers stay nil, exactly as a leaf's do.
type PayloadLeaf struct {
	Payload
	array []int
	text  string
}

func generatePayloadTree(depth int, tag string) *Payload {
	if depth == 0 {
		leaf := &PayloadLeaf{
			array: []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
			text:  "String for key " + tag + " in leaf node",
		}
		return &leaf.Payload
	}
	return &Payload{
		left:  generatePayloadTree(depth-1, tag),
		right: generatePayloadTree(depth-1, tag),
	}
}

// SplayNode is a node of the tree: key orders it, value is the payload, and the
// two children are nil at a leaf.
type SplayNode struct {
	key         float64
	value       *Payload
	left, right *SplayNode
}

// traverse appends every key in order. The original passes a visitor closure;
// the keys slice is threaded through instead, since collecting keys is the only
// visitor the benchmark has.
func (n *SplayNode) traverse(keys []float64) []float64 {
	for current := n; current != nil; current = current.right {
		if current.left != nil {
			keys = current.left.traverse(keys)
		}
		keys = append(keys, current.key)
	}
	return keys
}

// SplayTree is a binary search tree that rotates a node to the root each time it
// is touched, so a recently used key is cheap to reach again. Insert, find and
// remove are all O(log n) amortized.
type SplayTree struct {
	root *SplayNode
}

func (t *SplayTree) isEmpty() bool { return t.root == nil }

func (t *SplayTree) insert(key float64, value *Payload) {
	if t.root == nil {
		t.root = &SplayNode{key: key, value: value}
		return
	}
	// Splay on the key first, which moves the last node on its search path to
	// the root, so the comparisons below only have to look at the root.
	t.splay(key)
	root := t.root
	if root.key == key {
		return
	}
	node := &SplayNode{key: key, value: value}
	if key > root.key {
		node.left = root
		node.right = root.right
		root.right = nil
	} else {
		node.right = root
		node.left = root.left
		root.left = nil
	}
	t.root = node
}

func (t *SplayTree) remove(key float64) *SplayNode {
	if t.root == nil {
		panic("key not found")
	}
	t.splay(key)
	root := t.root
	if root.key != key {
		panic("key not found")
	}
	removed := root
	if root.left == nil {
		t.root = root.right
	} else {
		right := root.right
		t.root = root.left
		// Splay again so the new root has no right child, then hang the
		// original right subtree there.
		t.splay(key)
		t.root.right = right
	}
	return removed
}

func (t *SplayTree) find(key float64) *SplayNode {
	if t.root == nil {
		return nil
	}
	t.splay(key)
	if t.root.key == key {
		return t.root
	}
	return nil
}

func (t *SplayTree) findMax(startNode *SplayNode) *SplayNode {
	if t.root == nil {
		return nil
	}
	current := startNode
	if current == nil {
		current = t.root
	}
	for current.right != nil {
		current = current.right
	}
	return current
}

func (t *SplayTree) findGreatestLessThan(key float64) *SplayNode {
	if t.root == nil {
		return nil
	}
	// Splay to bring either the key itself or the last node on its search path
	// to the top, so the answer is the root or the largest node to its left.
	t.splay(key)
	if t.root.key < key {
		return t.root
	}
	if t.root.left != nil {
		return t.findMax(t.root.left)
	}
	return nil
}

func (t *SplayTree) exportKeys() []float64 {
	var keys []float64
	if t.root != nil {
		keys = t.root.traverse(keys)
	}
	return keys
}

// splay is the simplified top-down splay of Sleator and Tarjan. The dummy node's
// two children stand in for the algorithm's L and R trees, which is what lets
// the loop below assume left and right are always real nodes.
func (t *SplayTree) splay(key float64) {
	if t.root == nil {
		return
	}
	var dummy SplayNode
	left, right := &dummy, &dummy
	current := t.root
	for {
		if key < current.key {
			curLeft := current.left
			if curLeft == nil {
				break
			}
			if key < curLeft.key {
				// Rotate right.
				current.left = curLeft.right
				curLeft.right = current
				current = curLeft
				if current.left == nil {
					break
				}
			}
			// Link right.
			right.left = current
			right = current
			current = current.left
		} else if key > current.key {
			curRight := current.right
			if curRight == nil {
				break
			}
			if key > curRight.key {
				// Rotate left.
				current.right = curRight.left
				curRight.left = current
				current = curRight
				if current.right == nil {
					break
				}
			}
			// Link left.
			left.right = current
			left = current
			current = current.right
		} else {
			break
		}
	}
	// Assemble the three pieces back into one tree rooted at current.
	left.right = current.left
	right.left = current.right
	current.left = dummy.right
	current.right = dummy.left
	t.root = current
}

var splayTree *SplayTree

func insertNewNode(tree *SplayTree) float64 {
	// Draw keys until one is not already in the tree, so every insert adds a
	// node.
	var key float64
	for {
		key = harness.Random()
		if tree.find(key) == nil {
			break
		}
	}
	tree.insert(key, generatePayloadTree(splayTreePayloadDepth, numberToTag(key)))
	return key
}

// numberToTag renders the key the way the original's String(key) does: the
// shortest text that reads back as the same double. Only the length of the leaf
// string depends on it.
func numberToTag(key float64) string {
	return strconv.FormatFloat(key, 'g', -1, 64)
}

func splaySetup() {
	tree := &SplayTree{}
	for i := 0; i < splayTreeSize; i++ {
		insertNewNode(tree)
	}
	splayTree = tree
}

func splayTearDown() {
	keys := splayTree.exportKeys()
	// Drop the tree so the collector can take it, the way the original does.
	splayTree = nil

	if len(keys) != splayTreeSize {
		panic("splay tree has wrong size")
	}
	// The keys come back in order and with no duplicates when the tree is sound.
	for i := 0; i < len(keys)-1; i++ {
		if keys[i] >= keys[i+1] {
			panic("splay tree not sorted")
		}
	}
}

// runSplay replaces a few nodes, which is the churn the benchmark times.
func runSplay() {
	tree := splayTree
	for i := 0; i < splayTreeModifications; i++ {
		key := insertNewNode(tree)
		if greatest := tree.findGreatestLessThan(key); greatest == nil {
			tree.remove(key)
		} else {
			tree.remove(greatest.key)
		}
	}
}

func main() {
	harness.Run("Splay", 81491, splaySetup, runSplay, splayTearDown)
}
