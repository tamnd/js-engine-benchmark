// A typed-TypeScript port of v8-v7/splay.js.
//
// The benchmark is a splay tree the run loop keeps churning: it builds a tree
// of 8000 nodes, each holding a small payload tree, then repeatedly inserts and
// removes nodes. What it measures is allocation and the reclaiming of old
// nodes, plus the pointer churn a self-balancing tree does to a large object
// graph, so the node counts and the payload depth are the load and are kept
// exactly as the original has them.
//
// The original payload is two different object literals, { array, string } at a
// leaf and { left, right } above it. An earlier version of this port merged them
// into one class with all four fields and the unused ones null, which describes
// the tree correctly but not its cost: it gave every branch an array slot and a
// string slot it never uses, and this benchmark is a measurement of how much the
// collector has to trace. The two shapes are a class and a subclass here, so a
// branch is the two fields the original's branch is.

import { random } from "./harness";

const kSplayTreeSize = 8000;
const kSplayTreeModifications = 80;
const kSplayTreePayloadDepth = 5;

// Payload is the junk tree hung off every splay-tree node. A leaf carries the
// array and the string; an internal node carries the two children. Nothing ever
// reads it back, which is the point: it exists to make each insert allocate.
class Payload {
  left: Payload | null;
  right: Payload | null;

  constructor(left: Payload | null, right: Payload | null) {
    this.left = left;
    this.right = right;
  }
}

// PayloadLeaf is the bottom of the payload tree, the shape that carries the ten
// element array and the text. It is a subclass rather than a second unrelated
// class so generatePayloadTree still has one return type, which is the closest
// typed TypeScript gets to the original's two object literals.
class PayloadLeaf extends Payload {
  array: number[];
  text: string;

  constructor(array: number[], text: string) {
    super(null, null);
    this.array = array;
    this.text = text;
  }
}

function generatePayloadTree(depth: number, tag: string): Payload {
  if (depth == 0) {
    return new PayloadLeaf([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "String for key " + tag + " in leaf node");
  }
  return new Payload(generatePayloadTree(depth - 1, tag), generatePayloadTree(depth - 1, tag));
}

// A splay-tree node. key orders the tree, value is the payload, and the two
// children are null at a leaf.
class SplayNode {
  key: number;
  value: Payload | null;
  left: SplayNode | null;
  right: SplayNode | null;

  constructor(key: number, value: Payload | null) {
    this.key = key;
    this.value = value;
    this.left = null;
    this.right = null;
  }

  // An ordered traversal that appends every key it reaches. The original passes
  // a visitor closure; the keys array is passed down instead, since the only
  // visitor the benchmark uses is the one that collects keys.
  traverse(keys: number[]): void {
    let current: SplayNode | null = this;
    while (current != null) {
      const left = current.left;
      if (left != null) left.traverse(keys);
      keys.push(current.key);
      current = current.right;
    }
  }
}

// A splay tree: a binary search tree that rotates a node to the root each time
// it is touched, so a recently used key is cheap to reach again. Insert, find,
// and remove are all O(log n) amortized.
class SplayTree {
  root: SplayNode | null;

  constructor() {
    this.root = null;
  }

  isEmpty(): boolean {
    return this.root == null;
  }

  insert(key: number, value: Payload): void {
    if (this.root == null) {
      this.root = new SplayNode(key, value);
      return;
    }
    // Splay on the key first, which moves the last node on its search path to
    // the root, so the comparisons below only have to look at the root.
    this.splay(key);
    const root = this.root;
    if (root.key == key) {
      return;
    }
    const node = new SplayNode(key, value);
    if (key > root.key) {
      node.left = root;
      node.right = root.right;
      root.right = null;
    } else {
      node.right = root;
      node.left = root.left;
      root.left = null;
    }
    this.root = node;
  }

  remove(key: number): SplayNode {
    if (this.root == null) {
      throw new Error("Key not found");
    }
    this.splay(key);
    let root = this.root;
    if (root.key != key) {
      throw new Error("Key not found");
    }
    const removed = root;
    if (root.left == null) {
      this.root = root.right;
    } else {
      const right = root.right;
      this.root = root.left;
      // Splay again so the new root has no right child, then hang the original
      // right subtree there.
      this.splay(key);
      root = this.root as SplayNode;
      root.right = right;
    }
    return removed;
  }

  find(key: number): SplayNode | null {
    if (this.root == null) {
      return null;
    }
    this.splay(key);
    const root = this.root as SplayNode;
    return root.key == key ? root : null;
  }

  findMax(startNode: SplayNode | null): SplayNode | null {
    if (this.root == null) {
      return null;
    }
    let current = startNode != null ? startNode : (this.root as SplayNode);
    while (current.right != null) {
      current = current.right;
    }
    return current;
  }

  findGreatestLessThan(key: number): SplayNode | null {
    if (this.root == null) {
      return null;
    }
    // Splay to bring either the key itself or the last node on its search path
    // to the top, so the answer is the root or the largest node to its left.
    this.splay(key);
    const root = this.root as SplayNode;
    if (root.key < key) {
      return root;
    } else if (root.left != null) {
      return this.findMax(root.left);
    }
    return null;
  }

  exportKeys(): number[] {
    const result: number[] = [];
    const root = this.root;
    if (root != null) {
      root.traverse(result);
    }
    return result;
  }

  // The simplified top-down splay of Sleator and Tarjan. The dummy node's two
  // children stand in for the algorithm's L and R trees, which is what lets the
  // loop below assume left and right are always real nodes.
  splay(key: number): void {
    if (this.root == null) {
      return;
    }
    const dummy = new SplayNode(0, null);
    let left = dummy;
    let right = dummy;
    let current = this.root as SplayNode;
    while (true) {
      if (key < current.key) {
        const curLeft = current.left;
        if (curLeft == null) {
          break;
        }
        if (key < curLeft.key) {
          // Rotate right.
          current.left = curLeft.right;
          curLeft.right = current;
          current = curLeft;
          if (current.left == null) {
            break;
          }
        }
        // Link right.
        right.left = current;
        right = current;
        current = current.left as SplayNode;
      } else if (key > current.key) {
        const curRight = current.right;
        if (curRight == null) {
          break;
        }
        if (key > curRight.key) {
          // Rotate left.
          current.right = curRight.left;
          curRight.left = current;
          current = curRight;
          if (current.right == null) {
            break;
          }
        }
        // Link left.
        left.right = current;
        left = current;
        current = current.right as SplayNode;
      } else {
        break;
      }
    }
    // Assemble the three pieces back into one tree rooted at current.
    left.right = current.left;
    right.left = current.right;
    current.left = dummy.right;
    current.right = dummy.left;
    this.root = current;
  }
}

let splayTree: SplayTree | null = null;

function insertNewNode(tree: SplayTree): number {
  // Draw keys until one is not already in the tree, so every insert adds a node.
  let key = 0;
  do {
    key = random();
  } while (tree.find(key) != null);
  const payload = generatePayloadTree(kSplayTreePayloadDepth, numberToTag(key));
  tree.insert(key, payload);
  return key;
}

// The original tags a payload with String(key). Only the leaf string's length
// depends on it, so any stable rendering of the key does the same work.
function numberToTag(key: number): string {
  return "" + key;
}

export function splaySetup(): void {
  const tree = new SplayTree();
  for (let i = 0; i < kSplayTreeSize; i++) insertNewNode(tree);
  splayTree = tree;
}

export function splayTearDown(): void {
  const tree = splayTree as SplayTree;
  const keys = tree.exportKeys();
  // Drop the tree so the collector can take it, the way the original does.
  splayTree = null;

  const length = keys.length;
  if (length != kSplayTreeSize) {
    throw new Error("Splay tree has wrong size");
  }
  // The keys come back in order and with no duplicates when the tree is sound.
  for (let i = 0; i < length - 1; i++) {
    if (keys[i] >= keys[i + 1]) {
      throw new Error("Splay tree not sorted");
    }
  }
}

export function runSplay(): void {
  // Replace a few nodes, which is the churn the benchmark times.
  const tree = splayTree as SplayTree;
  for (let i = 0; i < kSplayTreeModifications; i++) {
    const key = insertNewNode(tree);
    const greatest = tree.findGreatestLessThan(key);
    if (greatest == null) tree.remove(key);
    else tree.remove(greatest.key);
  }
}
