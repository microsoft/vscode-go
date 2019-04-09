/**
 * @license
 * Copyright Daniel Imms <http://www.growingwiththeweb.com>
 * Released under MIT license:
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 Daniel Imms, http://www.growingwiththeweb.com
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Modified by Jackson Kearl <Microsoft/t-jakea@microsoft.com>
 */

/**
 * Represents a node in the binary tree, which has a key and a value, as well as left and right subtrees
 */
export class Node<K, V> {
	public left: Node<K, V> = null;
	public right: Node<K, V> = null;
	public height: number = null;

	/**
	 * Creates a new AVL Tree node.
	 * @param key The key of the new node.
	 * @param value The value of the new node.
	 */
	constructor(
		public key: K,
		public value: V
	) {
	}

	/**
	 * Performs a right rotate on this node.
	 * @return The root of the sub-tree; the node where this node used to be.
	 */
	public rotateRight(): Node<K, V> {
		//     b                           a
		//    / \                         / \
		//   a   e -> b.rotateRight() -> c   b
		//  / \                             / \
		// c   d                           d   e
		const other = this.left;
		this.left = other.right;
		other.right = this;
		this.height = Math.max(this.leftHeight, this.rightHeight) + 1;
		other.height = Math.max(other.leftHeight, this.height) + 1;
		return other;
	}

	/**
	 * Performs a left rotate on this node.
	 * @return The root of the sub-tree; the node where this node used to be.
	 */
	public rotateLeft(): Node<K, V> {
		//   a                              b
		//  / \                            / \
		// c   b   -> a.rotateLeft() ->   a   e
		//    / \                        / \
		//   d   e                      c   d
		const other = this.right;
		this.right = other.left;
		other.left = this;
		this.height = Math.max(this.leftHeight, this.rightHeight) + 1;
		other.height = Math.max(other.rightHeight, this.height) + 1;
		return other;
	}

	/**
	 * Convenience function to get the height of the left child of the node,
	 * returning -1 if the node is null.
	 * @return The height of the left child, or -1 if it doesn't exist.
	 */
	public get leftHeight(): number {
		if (!this.left) {
			return -1;
		}
		return this.left.height;
	}

	/**
	 * Convenience function to get the height of the right child of the node,
	 * returning -1 if the node is null.
	 * @return The height of the right child, or -1 if it doesn't exist.
	 */
	public get rightHeight(): number {
		if (!this.right) {
			return -1;
		}
		return this.right.height;
	}
}

export type DistanceFunction<K> = (a: K, b: K) => number;
export type CompareFunction<K> = (a: K, b: K) => number;

/**
 * Represents how balanced a node's left and right children are.
 */
const enum BalanceState {
	/** Right child's height is 2+ greater than left child's height */
	UNBALANCED_RIGHT,
	/** Right child's height is 1 greater than left child's height */
	SLIGHTLY_UNBALANCED_RIGHT,
	/** Left and right children have the same height */
	BALANCED,
	/** Left child's height is 1 greater than right child's height */
	SLIGHTLY_UNBALANCED_LEFT,
	/** Left child's height is 2+ greater than right child's height */
	UNBALANCED_LEFT
}

export class NearestNeighborDict<K, V> {

	public static NUMERIC_DISTANCE_FUNCTION = (a: number, b: number) => a > b ? a - b : b - a;
	public static DEFAULT_COMPARE_FUNCTION = (a: any, b: any) => a > b ? 1 : a < b ? -1 : 0;

	protected root: Node<K, V> = null;

	/**
	 * Creates a new AVL Tree.
	 */
	constructor(
		start: Node<K, V>,
		private distance: DistanceFunction<K>,
		private compare: CompareFunction<K> = NearestNeighborDict.DEFAULT_COMPARE_FUNCTION
	) {
		this.insert(start.key, start.value);
	}

	public height() {
		return this.root.height;
	}

	/**
	 * Inserts a new node with a specific key into the tree.
	 * @param key The key being inserted.
	 * @param value The value being inserted.
	 */
	public insert(key: K, value?: V): void {
		this.root = this._insert(key, value, this.root);
	}

	/**
	 * Inserts a new node with a specific key into the tree.
	 * @param key The key being inserted.
	 * @param root The root of the tree to insert in.
	 * @return The new tree root.
	 */
	private _insert(key: K, value: V, root: Node<K, V>): Node<K, V> {
		// Perform regular BST insertion
		if (root === null) {
			return new Node(key, value);
		}

		if (this.compare(key, root.key) < 0) {
			root.left = this._insert(key, value, root.left);
		} else if (this.compare(key, root.key) > 0) {
			root.right = this._insert(key, value, root.right);
		} else {
			return root;
		}

		// Update height and rebalance tree
		root.height = Math.max(root.leftHeight, root.rightHeight) + 1;
		const balanceState = this._getBalanceState(root);

		if (balanceState === BalanceState.UNBALANCED_LEFT) {
			if (this.compare(key, root.left.key) < 0) {
				// Left left case
				root = root.rotateRight();
			} else {
				// Left right case
				root.left = root.left.rotateLeft();
				return root.rotateRight();
			}
		}

		if (balanceState === BalanceState.UNBALANCED_RIGHT) {
			if (this.compare(key, root.right.key) > 0) {
				// Right right case
				root = root.rotateLeft();
			} else {
				// Right left case
				root.right = root.right.rotateRight();
				return root.rotateLeft();
			}
		}

		return root;
	}

	/**
	 * Gets a node within the tree with a specific key, or the nearest neighbor to that node if it does not exist.
	 * @param key The key being searched for.
	 * @return The (key, value) pair of the node with key nearest the given key in value.
	 */
	public getNearest(key: K): Node<K, V> {
		return this._getNearest(key, this.root, this.root);
	}

	/**
	 * Gets a node within the tree with a specific key, or the node closest (as measured by this._distance) to that node if the key is not present
	 * @param key The key being searched for.
	 * @param root The root of the tree to search in.
	 * @param closest The current best estimate of the node closest to the node being searched for, as measured by this._distance
	 * @return The (key, value) pair of the node with key nearest the given key in value.
	 */
	private _getNearest(key: K, root: Node<K, V>, closest: Node<K, V>): Node<K, V> {
		const result = this.compare(key, root.key);
		if (result === 0) {
			return root;
		}

		closest = this.distance(key, root.key) < this.distance(key, closest.key) ? root : closest;

		if (result < 0) {
			return root.left ? this._getNearest(key, root.left, closest) : closest;
		}
		else {
			return root.right ? this._getNearest(key, root.right, closest) : closest;
		}
	}

	/**
	 * Gets the balance state of a node, indicating whether the left or right
	 * sub-trees are unbalanced.
	 * @param node The node to get the difference from.
	 * @return The BalanceState of the node.
	 */
	private _getBalanceState(node: Node<K, V>): BalanceState {
		const heightDifference = node.leftHeight - node.rightHeight;
		switch (heightDifference) {
			case -2: return BalanceState.UNBALANCED_RIGHT;
			case -1: return BalanceState.SLIGHTLY_UNBALANCED_RIGHT;
			case 1: return BalanceState.SLIGHTLY_UNBALANCED_LEFT;
			case 2: return BalanceState.UNBALANCED_LEFT;
			case 0: return BalanceState.BALANCED;
			default: {
				console.error('Internal error: Avl tree should never be more than two levels unbalanced');
				if (heightDifference > 0) return BalanceState.UNBALANCED_LEFT;
				if (heightDifference < 0) return BalanceState.UNBALANCED_RIGHT;
			}
		}
	}
}
