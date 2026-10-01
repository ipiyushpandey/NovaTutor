package com.aitutor.dsa;

import java.util.List;

import static com.aitutor.dsa.DsaProblem.Difficulty.*;

/**
 * Trees & BST bank. Trees are encoded as level-order arrays where EMPTY
 * children are marked by a sentinel; the judge always passes the full flat
 * array, and every problem defines its own encoding in the statement.
 * 50 problems.
 */
final class DsaBankTrees {
    private DsaBankTrees() {}

    static List<DsaProblem> problems() {
        return List.of(
        DsaCatalog.a2i("max-depth-binary-tree-parents", "Maximum Depth of Binary Tree (parent encoding)", EASY, "Trees", "tree,dfs,bfs",
            "Encoding: the array is [values in level order], where node i's children are at 2i+1 and 2i+2 and MISSING children are encoded as -9999. Return the maximum depth.",
            "0 <= nodes <= 10^4; -100 <= val <= 100; -9999 = null.",
            "k",
            "3,9,20,-9999,-9999,15,7\n1,-9999,2\n-9999",
            "1,2,3,4,5,6,7\n1,2,-9999,3,-9999,-9999,4\n1,2,3,4,5,6,7,8",
            a -> depth(a, 0)),
        DsaCatalog.a2i("same-tree-check-flat", "Same Tree (two flat trees)", EASY, "Trees", "tree,dfs,recursion",
            "Two trees are flattened as [tree1..., -9998, tree2...] where -9998 separates the trees and -9999 marks null (children at 2i+1, 2i+2). Return 1 if structurally identical with equal values, else 0.",
            "0 <= nodes <= 100 per tree.",
            "k",
            "1,2,3,-9998,1,2,3\n1,2,-9998,1,-9999,2",
            "1,2,1,-9998,1,1,2\n1,-9998,1\n-9999,-9998,-9999",
            a -> { int sep = 0; while (a[sep] != -9998) sep++; int[] t1 = java.util.Arrays.copyOf(a, sep), t2 = java.util.Arrays.copyOfRange(a, sep + 1, a.length); return sameTree(t1, 0, t2, 0) ? 1 : 0; }),
        DsaCatalog.a2a("invert-binary-tree-flat", "Invert Binary Tree", EASY, "Trees", "tree,dfs,bfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the values of the inverted tree in the same encoding (truncated to the original array length).",
            "0 <= nodes <= 100; -100 <= val <= 100.",
            "k",
            "4,2,7,1,3,6,9\n1,2\n-9999",
            "2,1,3\n1,-9999,2\n5,3,8,1,4,7,9,6,2,10,11",
            a -> { int[] r = a.clone(); int n = r.length; for (int i = 0; i < n; i++) { int l = 2 * i + 1, rr = 2 * i + 2; if (rr < n) { int t = r[l]; r[l] = r[rr]; r[rr] = t; } } return r; }),
        DsaCatalog.a2i("symmetric-tree-flat", "Symmetric Tree", EASY, "Trees", "tree,dfs,bfs,two-pointers",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return 1 if the tree is a mirror of itself, else 0.",
            "1 <= nodes <= 1000.",
            "k",
            "1,2,2,3,4,4,3\n1,2,2,-9999,3,-9999,3",
            "1,2,2,3,4,4,3,5,6,7,8,8,7,6,5\n1\n1,2,1",
            a -> mirror(a, 1, 2) ? 1 : 0),
        DsaCatalog.a2a("binary-tree-level-order-sums", "Binary Tree Level Order (per-level sums)", MEDIUM, "Trees", "tree,bfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the sum of each level, concatenated as an array.",
            "0 <= nodes <= 2000; -100 <= val <= 100.",
            "k",
            "3,9,20,-9999,-9999,15,7\n1,2,3,4,5",
            "1\n1,2,3,4,5,6,7\n-9999",
            a -> { java.util.List<Integer> sums = new java.util.ArrayList<>(); java.util.List<Integer> level = new java.util.ArrayList<>(); if (a.length > 0 && a[0] != -9999) level.add(0); while (!level.isEmpty()) { int sum = 0; java.util.List<Integer> next = new java.util.ArrayList<>(); for (int idx : level) { sum += idx; int l = 2 * idx + 1, r = 2 * idx + 2; if (l < a.length && a[l] != -9999) next.add(l); if (r < a.length && a[r] != -9999) next.add(r); } sums.add(sum); level = next; } return sums.stream().mapToInt(Integer::intValue).toArray(); }),
        DsaCatalog.a2a("binary-tree-zigzag-sums", "Binary Tree Zigzag (per-level sums)", MEDIUM, "Trees", "tree,bfs,two-pointers",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return per-level sums (order of levels stays top-down; sums are direction-independent).",
            "0 <= nodes <= 2000.",
            "k",
            "3,9,20,-9999,-9999,15,7\n1,2,3,4,5,6,7",
            "1\n1,-9999,2\n1,2,3,4,5,6,7,8,9,10,11,12,13,14",
            a -> { java.util.List<Integer> sums = new java.util.ArrayList<>(); java.util.List<Integer> level = new java.util.ArrayList<>(); if (a.length > 0 && a[0] != -9999) level.add(0); while (!level.isEmpty()) { int sum = 0; java.util.List<Integer> next = new java.util.ArrayList<>(); for (int idx : level) { sum += a[idx]; int l = 2 * idx + 1, r = 2 * idx + 2; if (l < a.length && a[l] != -9999) next.add(l); if (r < a.length && a[r] != -9999) next.add(r); } sums.add(sum); level = next; } return sums.stream().mapToInt(Integer::intValue).toArray(); }),
        DsaCatalog.a2i("diameter-of-binary-tree-parents", "Diameter of Binary Tree", EASY, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the diameter (longest path edge count).",
            "1 <= nodes <= 10^4.",
            "k",
            "1,2,3,4,5\n1,2\n-9999",
            "1,2,3,4,5,6,7,8,9\n1,2,3,4,-9999,-9999,5\n1",
            a -> { int[] best = new int[1]; height(a, 0, best); return best[0]; }),
        DsaCatalog.a2i("balanced-binary-tree-flat", "Balanced Binary Tree", EASY, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return 1 if every node's two subtree depths differ by at most 1, else 0.",
            "0 <= nodes <= 5000.",
            "k",
            "3,9,20,-9999,-9999,15,7\n1,2,2,3,3,-9999,-9999,4,4",
            "1\n1,2,3\n1,2,2,3,3,-9999,-9999,4,4,-9999,-9999,-9999,-9999,5,5",
            a -> { return balanced(a, 0) >= 0 ? 1 : 0; }),
        DsaCatalog.a2a("merge-two-binary-trees-flat", "Merge Two Binary Trees", EASY, "Trees", "tree,dfs,bfs",
            "Two trees flattened as [t1..., -9998, t2...] with null = -9999. Return the merged tree values in the encoding of t1 (length = t1's array length).",
            "1 <= nodes <= 1000 per tree.",
            "k",
            "1,3,2,5,-9998,2,1,3,-9999,4,7\n1,-9998,1,2",
            "1,2,3,-9998,4,5,6\n1,2,-9999,-9998,1,-9999,2",
            a -> { int sep = 0; while (a[sep] != -9998) sep++; int[] t1 = java.util.Arrays.copyOf(a, sep), t2 = java.util.Arrays.copyOfRange(a, sep + 1, a.length); int[] r = t1.clone(); for (int i = 0; i < r.length; i++) { int v1 = t1[i], v2 = i < t2.length ? t2[i] : -9999; if (v1 == -9999 && v2 == -9999) r[i] = -9999; else if (v1 == -9999) r[i] = v2; else if (v2 == -9999) r[i] = v1; else r[i] = v1 + v2; } return r; }),
        DsaCatalog.a2i("subtree-of-another-tree-flat", "Subtree of Another Tree", EASY, "Trees", "tree,dfs,string-matching",
            "Two trees flattened as [t1..., -9998, t2...] with null = -9999. Return 1 if t2 is a subtree of t1, else 0.",
            "1 <= nodes <= 2000 total.",
            "k",
            "3,4,5,1,2,-9998,4,1,2\n3,4,5,1,2,-9999,-9999,-9999,-9999,-9999,2,-9998,1\n1,1,-9998,1",
            "1,2,3,-9998,2\n1,2,3,4,-9998,2,3\n1,2,3,4,5,-9999,-9999,6,-9998,2,3,-9999,-9999,4",
            a -> { int sep = 0; while (a[sep] != -9998) sep++; int[] t1 = java.util.Arrays.copyOf(a, sep), t2 = java.util.Arrays.copyOfRange(a, sep + 1, a.length); return isSubtree(t1, 0, t2) ? 1 : 0; }),
        DsaCatalog.a2i("path-sum-exists", "Path Sum (root-to-leaf)", EASY, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999; the LAST token is targetSum. Return 1 if a root-to-leaf path sums to target, else 0.",
            "0 <= nodes <= 5000; -1000 <= val <= 1000.",
            "k",
            "5,4,8,11,-9999,13,4,7,2,-9999,-9999,-9999,-9999,-9999,1,22\n-9999,0\n1,2,3,5",
            "1,2,3,1\n1,-9999,2,3\n5,4,8,11,-9999,-9999,13,4,7,2,-9999,-9999,-9999,1,18",
            a -> { int target = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 1); return pathSum(t, 0, target) ? 1 : 0; }),
        DsaCatalog.a2i("sum-root-to-leaf-numbers", "Sum Root to Leaf Numbers", MEDIUM, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Node values are single digits 0-9. Return the sum of all root-to-leaf numbers.",
            "1 <= nodes <= 1000; 0 <= val <= 9.",
            "k",
            "1,2,3\n4,9,0,5,1",
            "1\n1,2,3,4,5,6,7,8,9\n0,1,2,3,4,5,6,7,8,9",
            a -> { int[] total = new int[1]; rootToLeaf(a, 0, 0, total); return total[0]; }),
        DsaCatalog.a2i("binary-tree-max-path-sum-parents", "Binary Tree Maximum Path Sum", HARD, "Trees", "tree,dfs,dynamic-programming",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the maximum path sum (any node-to-node path).",
            "1 <= nodes <= 1000; -1000 <= val <= 1000.",
            "k",
            "1,2,3\n-10,9,20,-9999,-9999,15,7",
            "1,-2,-3\n5,4,8,11,-9999,-9999,13,4,7,2,-9999,-9999,-9999,1\n-3",
            a -> { int[] best = new int[1]; best[0] = Integer.MIN_VALUE; maxPath(a, 0, best); return best[0]; }),
        DsaCatalog.a2i("lowest-common-ancestor-parents", "Lowest Common Ancestor of a Binary Tree", MEDIUM, "Trees", "tree,dfs,recursion",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999; the LAST TWO tokens are node values p and q (guaranteed distinct and present). Return the value of the LCA.",
            "2 <= nodes <= 10^5 (tests <= 1000); all values unique.",
            "k",
            "3,5,1,6,2,0,8,-9999,-9999,7,4,5,1,6,2\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,4,8\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,3,5",
            "1,2\n3,5,1,6,2,0,8,-9999,-9999,7,4,5,1,6,2\n37,-34,-48,-9999,-100,-100,48,-9999,-9999,-9999,-9999,-9999,-54,-9999,48,-9999,-9999,-9999,-9999,-9999,-9999,-9999,-9999,-9999,-9999,-9999,-9999,-9999,-71,-22,48",
            a -> { int p = a[a.length - 2], q = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 2); return lca(t, 0, p, q); }),
        DsaCatalog.a2i("binary-tree-right-side-view", "Binary Tree Right Side View (sum)", MEDIUM, "Trees", "tree,bfs,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the SUM of the rightmost value in each level.",
            "0 <= nodes <= 100.",
            "k",
            "1,2,3,-9999,5,-9999,4\n1,-9999,3\n-9999",
            "1,2,3,4,5,6,7\n1,2,3,4,-9999,-9999,5\n1,2,3,4,5,6,7,8",
            a -> { java.util.List<Integer> level = new java.util.ArrayList<>(); if (a.length > 0 && a[0] != -9999) level.add(0); int sum = 0; while (!level.isEmpty()) { sum += a[level.get(level.size() - 1)]; java.util.List<Integer> next = new java.util.ArrayList<>(); for (int idx : level) { int l = 2 * idx + 1, r = 2 * idx + 2; if (l < a.length && a[l] != -9999) next.add(l); if (r < a.length && a[r] != -9999) next.add(r); } level = next; } return sum; }),
        DsaCatalog.a2i("count-good-nodes-parents", "Count Good Nodes in Binary Tree", MEDIUM, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. A node is good if no node on the root-to-node path has a greater value. Return the count.",
            "1 <= nodes <= 2000; -10^4 <= val <= 10^4.",
            "k",
            "3,1,4,3,-9999,1,5\n3,3,-9999,4,2\n1",
            "2,4,4,4\n1,2,3,4,5,6,7\n-1,5,-2,6,0,3,-8,-9,-7,-7,-1,-2,-3,-4,-5",
            a -> { return goodNodes(a, 0, Integer.MIN_VALUE); }),
        DsaCatalog.a2i("binary-tree-paths-sum", "Binary Tree Paths (sum of path strings digit-sum)", EASY, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the number of root-to-leaf paths.",
            "1 <= nodes <= 100.",
            "k",
            "1,2,3,-9999,5\n1\n-9999",
            "1,2,3,4,5,6,7\n1,2,3,4\n1,2,3,4,5,6,7,8",
            a -> countLeaves(a, 0)),
        DsaCatalog.a2i("sum-of-left-leaves-parents", "Sum of Left Leaves", EASY, "Trees", "tree,dfs,bfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the sum of all left-leaf values.",
            "1 <= nodes <= 1000.",
            "k",
            "3,9,20,-9999,-9999,15,7\n1\n1,2,3,4,5",
            "1,2,3,4,5,6,7,8,9\n1,-9999,2,3\n1,2,3,4,5,6,7,8,9,10",
            a -> leftLeafSum(a, 0, false)),
        DsaCatalog.a2i("find-mode-bst-parents", "Find Mode in Binary Search Tree (mode value)", EASY, "Trees", "tree,dfs,hashing",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999. Return the SMALLEST mode (most frequent value; all values in a BST are ≥ parent when right child).",
            "1 <= nodes <= 10^4; -10^5 <= val <= 10^5.",
            "k",
            "1,-9999,2,2\n0\n1,1,2,-9999,-9999,2",
            "2,1,3\n5,4,6,3,7\n1,1,1,1",
            a -> { java.util.Map<Integer,Integer> c = new java.util.HashMap<>(); collect(a, 0, c); int max = 0; for (int v : c.values()) max = Math.max(max, v); int best = Integer.MAX_VALUE; for (var e : c.entrySet()) if (e.getValue() == max) best = Math.min(best, e.getKey()); return best; }),
        DsaCatalog.a2i("average-of-levels-sum", "Average of Levels (sum of floors)", EASY, "Trees", "tree,bfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the sum of floor averages of each level.",
            "1 <= nodes <= 10^4; -2^31 < val < 2^31 (tests small).",
            "k",
            "3,9,20,-9999,-9999,15,7\n2147483647,2147483647,2147483647",
            "1,2,3,4,5,6,7\n5,1,2,3,-9999,-9999,4\n1\n",
            a -> { java.util.List<Integer> level = new java.util.ArrayList<>(); if (a.length > 0 && a[0] != -9999) level.add(0); int total = 0; while (!level.isEmpty()) { long sum = 0; int cnt = 0; java.util.List<Integer> next = new java.util.ArrayList<>(); for (int idx : level) { sum += a[idx]; cnt++; int l = 2 * idx + 1, r = 2 * idx + 2; if (l < a.length && a[l] != -9999) next.add(l); if (r < a.length && a[r] != -9999) next.add(r); } total += (int) (sum / cnt); level = next; } return total; }),
        DsaCatalog.a2i("trim-bst-parents", "Trim a Binary Search Tree", MEDIUM, "Trees", "tree,dfs,bst",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999; the LAST TWO tokens are low and high. Return the SUM of remaining node values after trimming to [low, high].",
            "1 <= nodes <= 10^4; -10^4 <= low <= high <= 10^4.",
            "k",
            "1,0,2,1,2\n1,2,3,-9999,-9999,-9999,3,0,4\n3,0,4,-9999,2,-9999,-9999,1,7,13\n3,0,4,-9999,2,-9999,-9999,1",
            "1,0,2,5,7,3,8,6,9\n5,3,8,1,4,7,9,0,2,6,10\n10,5,15,3,7,-9999,18",
            a -> { int low = a[a.length - 2], high = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 2); return trimSum(t, 0, low, high); }),
        DsaCatalog.a2i("kth-smallest-in-bst-parents", "Kth Smallest Element in a BST", MEDIUM, "Trees", "tree,dfs,bst",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999; the LAST token is k. Return the kth smallest value (1-indexed).",
            "1 <= k <= nodes <= 10^4.",
            "k",
            "3,1,4,-9999,2,5",
            "5,3,6,2,4,-9999,-9999,1,7\n1,2,3,4,5,6,7,8,9,10\n2,1,3,4,5,6,7,8,9,10",
            a -> { int k = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 1); int[] cnt = new int[1]; int[] res = new int[1]; kthInorder(t, 0, k, cnt, res); return res[0]; }),
        DsaCatalog.a2i("validate-bst-parents", "Validate Binary Search Tree", MEDIUM, "Trees", "tree,dfs,bst",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return 1 if it is a valid BST, else 0.",
            "1 <= nodes <= 10^4; -2^31 < val < 2^31 (tests small).",
            "k",
            "2,1,3\n5,1,4,-9999,-9999,3,6\n2147483647",
            "1,1\n2,2,2\n10,5,15,3,7,-9999,20",
            a -> validBst(a, 0, Long.MIN_VALUE, Long.MAX_VALUE) ? 1 : 0),
        DsaCatalog.a2i("bst-from-preorder-parents", "Construct BST from Preorder (sum check)", MEDIUM, "Trees", "tree,bst,dfs",
            "A preorder traversal of a BST is given. Return the sum of all leaf values in the resulting BST.",
            "1 <= n <= 100; distinct values.",
            "k",
            "8,5,1,7,10,12\n1,2,2",
            "10,5,15,3,7,12,18\n50,30,70,20,40,60,80\n1",
            a -> { int n = a.length; int[][] ch = new int[n][2]; for (int[] row : ch) java.util.Arrays.fill(row, -1); for (int i = 1; i < n; i++) { int cur = 0; while (true) { int nx = a[i] < a[cur] ? ch[cur][0] : ch[cur][1]; if (nx == -1) { if (a[i] < a[cur]) ch[cur][0] = i; else ch[cur][1] = i; break; } cur = nx; } } int sum = 0; for (int i = 0; i < n; i++) if (ch[i][0] == -1 && ch[i][1] == -1) sum += a[i]; return sum; }),
        DsaCatalog.a2i("construct-binary-tree-preorder-inorder", "Construct Binary Tree from Preorder and Inorder (leaf count)", MEDIUM, "Trees", "tree,dfs,divide-conquer",
            "Flattened [preorder..., -1, inorder...] (values positive, -1 separator). Return the number of leaf nodes in the reconstructed tree.",
            "1 <= n <= 1000; distinct values.",
            "k",
            "3,9,20,15,7,-1,9,3,15,20,7\n-1,-1",
            "1,2,4,5,3,6,7,-1,4,2,5,1,6,3,7\n2,1,-1,2\n1,2,3,4,-1,1,2,3,4",
            a -> { int sep = 0; while (a[sep] != -1) sep++; int[] pre = java.util.Arrays.copyOf(a, sep), in = java.util.Arrays.copyOfRange(a, sep + 1, a.length); int n = pre.length; if (n == 0) return 0; int[] pos = new int[100001]; for (int i = 0; i < in.length; i++) pos[in[i]] = i; return buildLeafCount(pre, 0, n - 1, 0, n - 1, pos); }),
        DsaCatalog.a2i("binary-tree-cameras-count", "Binary Tree Cameras (greedy count)", HARD, "Trees", "tree,dfs,greedy",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the minimum number of cameras to monitor all nodes (camera at node covers it, its parent and children).",
            "1 <= nodes <= 1000.",
            "k",
            "0,0,-9999,0,0\n0,0,-9999,0,-9999,0,-9999,0\n0\n0,0,0,0,0,0,0,0,0,0,0,0,0,0,0",
            "0,0,0,0,-9999,-9999,0,0,-9999,0\n0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0",
            a -> { int[] count = new int[1]; int state = camDfs(a, 0, count); if (state == 0) count[0]++; return count[0]; }),
        DsaCatalog.a2i("house-robber-iii-parents", "House Robber III", MEDIUM, "Trees", "tree,dfs,dynamic-programming",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the maximum money robbed (cannot rob two directly-linked nodes).",
            "1 <= nodes <= 5000; 0 <= val <= 10^4.",
            "k",
            "3,2,3,-9999,3,-9999,1\n3,4,5,1,3,-9999,1",
            "2,1,3,-9999,4\n1,2,3,4,5,6,7,8,9,10\n5,5,5,5,5,5,5,5,5,5,5,5,5,5,5",
            a -> { long[] r = rob(a, 0); return (int) Math.max(r[0], r[1]); }),
        DsaCatalog.a2i("binary-tree-tilt-parents", "Binary Tree Tilt", EASY, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the total tilt (sum of |leftSum - rightSum| over all nodes).",
            "0 <= nodes <= 2000; -100 <= val <= 100.",
            "k",
            "1,2,3\n4,2,9,3,5,-9999,7\n21,7,14,1,1,2,2,3,3",
            "1,2,3,4,5,6,7\n1\n1,2",
            a -> { long[] tilt = new long[1]; tiltDfs(a, 0, tilt); return (int) tilt[0]; }),
        DsaCatalog.a2i("distribute-coins-in-binary-tree", "Distribute Coins in Binary Tree", MEDIUM, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999; total coins = total nodes. Return the minimum number of moves.",
            "1 <= nodes <= 100; 0 <= val <= n; sum of vals = n.",
            "k",
            "3,0,0\n0,3,0\n1,0,2",
            "1,0,0,0,0,0,0,2\n0,0,0,4,0,0,0\n3,0,0,0,0,0,0",
            a -> { int[] moves = new int[1]; coinsDfs(a, 0, moves); return moves[0]; }),
        DsaCatalog.a2i("path-sum-iii-count", "Path Sum III (prefix-sum paths)", MEDIUM, "Trees", "tree,dfs,prefix-sum",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999; the LAST token is targetSum. Return the number of downward paths summing to target (paths need not start at root).",
            "1 <= nodes <= 1000; -1000 <= val <= 1000.",
            "k",
            "10,5,-3,3,2,-9999,11,3,-2,-9999,1,8\n5,4,8,11,-9999,13,4,7,2,-9999,-9999,5,1,22",
            "1,-9999,2,-9999,3,-9999,4,-9999,5,6\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7",
            a -> { int target = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 1); java.util.Map<Long,Integer> pre = new java.util.HashMap<>(); pre.put(0L, 1); return (int) pathSum3(t, 0, 0L, target, pre); }),
        DsaCatalog.a2i("serialize-deserialize-roundtrip", "Serialize and Deserialize Binary Tree (depth)", HARD, "Trees", "tree,dfs,design",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the tree DEPTH after a serialize/deserialize round trip (same as original depth).",
            "0 <= nodes <= 10^4.",
            "k",
            "1,2,3,-9999,-9999,4,5\n-9999\n1,-9999,2",
            "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15\n1,2\n1,2,3,4,5,6,7,8",
            a -> depth(a, 0)),
        DsaCatalog.a2a("binary-tree-vertical-order-sum", "Vertical Order Traversal (per-column sum)", MEDIUM, "Trees", "tree,dfs,hashing",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the sums of each vertical column, leftmost column first.",
            "1 <= nodes <= 1000.",
            "k",
            "3,9,20,-9999,-9999,15,7\n1,2,3,4,5,6,7",
            "1,2,3,4,5,6,7,8,9\n1,-9999,2,-9999,3\n1,2,3,4",
            a -> { java.util.TreeMap<Integer,Long> cols = new java.util.TreeMap<>(); vOrder(a, 0, 0, cols); return cols.values().stream().mapToLong(Long::longValue).mapToInt(v -> (int) v).toArray(); }),
        DsaCatalog.a2a("populating-next-right-pointers-sum", "Populating Next Right Pointers (level sums)", MEDIUM, "Trees", "tree,bfs,linked-list",
            "Encoding: PERFECT binary tree in level order (children at 2i+1/2i+2). Return the sum of the LAST node in each level (what next-right points to).",
            "1 <= nodes <= 2^12 - 1; perfect tree.",
            "k",
            "1,2,3,4,5,6,7\n1\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15",
            "1,2,3\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31",
            a -> { java.util.List<Integer> level = new java.util.ArrayList<>(); level.add(0); java.util.List<Integer> lasts = new java.util.ArrayList<>(); while (!level.isEmpty()) { lasts.add(a[level.get(level.size() - 1)]); java.util.List<Integer> next = new java.util.ArrayList<>(); for (int idx : level) { int l = 2 * idx + 1, r = 2 * idx + 2; if (l < a.length) next.add(l); if (r < a.length) next.add(r); } level = next; } return lasts.stream().mapToInt(Integer::intValue).toArray(); }),
        DsaCatalog.a2i("flatten-binary-tree-to-list", "Flatten Binary Tree to Linked List (preorder sum)", MEDIUM, "Trees", "tree,dfs,linked-list",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the SUM of the preorder traversal (reconstructs the flattened list's total).",
            "0 <= nodes <= 2000.",
            "k",
            "1,2,5,3,4,-9999,6\n-9999\n1",
            "1,2,3,4,5,6,7\n1,2,3,4,5,6,7,8,9\n3,9,20,-9999,-9999,15,7",
            a -> { int[] sum = new int[1]; preorderSum(a, 0, sum); return sum[0]; }),
        DsaCatalog.a2i("sum-of-nodes-with-even-valued-grandparent", "Sum of Nodes with Even-Valued Grandparent", MEDIUM, "Trees", "tree,dfs,bfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the sum of nodes whose grandparent has an even value.",
            "1 <= nodes <= 10^4; 1 <= val <= 100.",
            "k",
            "6,7,8,2,7,1,3,9,-9999,1,4,-9999,-9999,-9999,5\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15",
            "5,4,2,1,3,-9999,-9999,7,8\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31",
            a -> { int sum = 0; for (int i = 0; i < a.length; i++) { if (a[i] == -9999) continue; int gp = (i - 3) / 4; if (i >= 4 && a[gp] % 2 == 0) sum += a[i]; } return sum; }),
        DsaCatalog.a2i("deepest-leaves-sum-parents", "Deepest Leaves Sum", MEDIUM, "Trees", "tree,bfs,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the sum of values of the deepest leaves.",
            "1 <= nodes <= 10^4; 1 <= val <= 100.",
            "k",
            "1,2,3,4,5,-9999,6,7,-9999,-9999,-9999,-9999,8\n1,2,3,4,5,6,7,8,9,10",
            "6,7,8,2,7,1,3,9,-9999,1,4,-9999,-9999,-9999,5\n50,30,70,20,40,60,80",
            a -> { java.util.List<Integer> level = new java.util.ArrayList<>(); if (a.length > 0 && a[0] != -9999) level.add(0); java.util.List<Integer> last = level; while (!level.isEmpty()) { java.util.List<Integer> next = new java.util.ArrayList<>(); for (int idx : level) { int l = 2 * idx + 1, r = 2 * idx + 2; if (l < a.length && a[l] != -9999) next.add(l); if (r < a.length && a[r] != -9999) next.add(r); } if (next.isEmpty()) break; last = next; level = next; } int sum = 0; for (int idx : last) sum += a[idx]; return sum; }),
        DsaCatalog.a2i("all-elements-two-bst-sorted", "All Elements in Two BSTs (merged count)", MEDIUM, "Trees", "tree,bst,sorting,two-pointers",
            "Two BSTs flattened as [bst1..., -9998, bst2...] with null = -9999. Return the count of values that appear in BOTH trees.",
            "1 <= nodes <= 5000 total.",
            "k",
            "2,1,4,-9998,1,0,3\n5,3,8,2,4,7,9,-9998,1,2,3,4,5,6,7,8,9,10",
            "2,1,3,-9998,1,2,3\n1,-9998,1\n10,5,15,3,7,-9999,18,-9998,5,10,15,3,7,18",
            a -> { int sep = 0; while (a[sep] != -9998) sep++; java.util.Set<Integer> s1 = new java.util.HashSet<>(), s2 = new java.util.HashSet<>(); for (int i = 0; i < sep; i++) if (a[i] != -9999) s1.add(a[i]); for (int i = sep + 1; i < a.length; i++) if (a[i] != -9999) s2.add(a[i]); s1.retainAll(s2); return s1.size(); }),
        DsaCatalog.a2i("range-sum-of-bst-parents", "Range Sum of BST", EASY, "Trees", "tree,dfs,bst",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999; the LAST TWO tokens are low and high. Return the sum of values in [low, high].",
            "1 <= nodes <= 2*10^4; -10^4 <= val <= 10^4.",
            "k",
            "10,5,15,3,7,-9999,18,7,9",
            "10,5,15,3,7,13,18,1,-9999,6\n1,0,2,-9999,3\n10,5,15,3,7,13,18,1,-9999,6",
            a -> { int low = a[a.length - 2], high = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 2); return rangeSum(t, 0, low, high); }),
        DsaCatalog.a2i("univalued-binary-tree", "Univalued Binary Tree", EASY, "Trees", "tree,dfs",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return 1 if all values are equal, else 0.",
            "1 <= nodes <= 100.",
            "k",
            "1,1,1,1,1,-9999,1\n2,2,2,5,2",
            "1,1,1,1,1,1,1,1,1\n9,9,9,9,9,9,9\n0",
            a -> { int v = -9999; for (int x : a) { if (x == -9999) continue; if (v == -9999) v = x; else if (v != x) return 0; } return 1; }),
        DsaCatalog.a2i("leaf-similar-trees-flat", "Leaf-Similar Trees", EASY, "Trees", "tree,dfs,recursion",
            "Two trees flattened as [t1..., -9998, t2...]. Return 1 if their leaf value sequences are identical, else 0.",
            "1 <= nodes <= 200 per tree.",
            "k",
            "3,5,1,6,2,9,8,-9999,-9999,7,4,-9998,3,5,1,6,7,4,2,-9999,-9999,-9999,-9999,-9999,-9999,9,8\n1,2,3,-9998,1,3,2",
            "1,2,3,4,5,-9998,1,2,3,4,5\n1,2,3,-9998,3,2,1",
            a -> { int sep = 0; while (a[sep] != -9998) sep++; int[] t1 = java.util.Arrays.copyOf(a, sep), t2 = java.util.Arrays.copyOfRange(a, sep + 1, a.length); int[] l1 = new int[t1.length], l2 = new int[t2.length]; int[] c1 = new int[1], c2 = new int[1]; leaves(t1, 0, l1, c1); leaves(t2, 0, l2, c2); if (c1[0] != c2[0]) return 0; for (int i = 0; i < c1[0]; i++) if (l1[i] != l2[i]) return 0; return 1; }),
        DsaCatalog.a2i("maximum-binary-tree-parents", "Maximum Binary Tree (sum of rightmost)", MEDIUM, "Trees", "tree,monotonic-stack,divide-conquer",
            "An array is given. Return the SUM of the rightmost path values of the maximum binary tree built from it.",
            "1 <= n <= 1000; 0 <= nums[i] <= 1000; distinct.",
            "k",
            "3,2,1,6,0,5\n6,0,3,2,1,5",
            "1,2,3,4,5,6,7,8,9,10\n10\n5,4,3,2,1,0",
            a -> { int lo = 0, hi = a.length - 1; int sum = 0; while (lo <= hi) { int mi = lo; for (int i = lo; i <= hi; i++) if (a[i] > a[mi]) mi = i; sum += a[mi]; hi = mi - 1; } return sum; }),
        DsaCatalog.a2i("recover-binary-search-tree-check", "Recover Binary Search Tree (sum after fix)", HARD, "Trees", "tree,dfs,bst",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999; exactly two nodes are swapped. Return the sum of the whole tree after recovering the BST (same as the total sum — a consistency check the student must reason through).",
            "1 <= nodes <= 1000; -2^31 < val < 2^31 (tests small).",
            "k",
            "1,3,-9999,-9999,2\n3,1,4,-9999,-9999,2",
            "2,3,1\n1,2,3,4,5,6,7,9,8\n10,5,15,3,7,13,18,1,6",
            a -> { long sum = 0; for (int v : a) if (v != -9999) sum += v; return (int) sum; }),
        DsaCatalog.a2i("binary-search-tree-to-greater-sum", "Binary Search Tree to Greater Sum Tree (root value)", MEDIUM, "Trees", "tree,dfs,bst",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999. Return the ROOT's new value after converting to a Greater Sum Tree (each node = original + sum of all greater nodes).",
            "1 <= nodes <= 100; 0 <= val <= 100.",
            "k",
            "4,1,6,0,2,5,7,-9999,-9999,-9999,3,-9999,-9999,-9999,8\n0,1",
            "5,3,8,1,4,7,9,0,2,6,10\n1,2,3,4,5,6,7,8,9,10",
            a -> { int[] sum = new int[1]; greaterTree(a, 0, sum); return a[0]; }),
        DsaCatalog.a2i("two-sum-iv-bst-parents", "Two Sum IV — Input is a BST", EASY, "Trees", "tree,bst,hashing,two-pointers",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999; the LAST token is k. Return 1 if two nodes sum to k, else 0.",
            "2 <= nodes <= 10^4.",
            "k",
            "5,3,6,2,4,-9999,7,9\n5,3,6,2,4,-9999,7,28",
            "1,2,3,4,5,6,7,8,9,10,11\n2,1,3,4,5,6,7,8,9,10\n1,0,2,-9999,3,-4",
            a -> { int k = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 1); java.util.Set<Integer> seen = new java.util.HashSet<>(); return twoSumBst(t, 0, k, seen) ? 1 : 0; }),
        DsaCatalog.a2i("bst-iterator-next-sum", "Binary Search Tree Iterator (first 3 sum)", MEDIUM, "Trees", "tree,bst,design,stack",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999. Return the sum of the first 3 values returned by next() (in-order).",
            "1 <= nodes <= 10^4.",
            "k",
            "7,3,15,-9999,-9999,9,20\n1\n5,3,8,1,4,7,9",
            "10,5,15,3,7,13,18,1,6\n2,1,3\n50,30,70,20,40,60,80",
            a -> { int[] cnt = new int[1]; int[] sum = new int[1]; firstK(a, 0, 3, cnt, sum); return sum[0]; }),
        DsaCatalog.a2i("delete-node-bst-parents", "Delete Node in a BST (sum check)", MEDIUM, "Trees", "tree,bst,dfs",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999; the LAST token is the key to delete. Return the sum of the remaining tree (consistency check).",
            "1 <= nodes <= 1000.",
            "k",
            "5,3,6,2,4,-9999,7,3\n5,3,6,2,4,-9999,7,0\n-9999,0",
            "10,5,15,3,7,13,18,5\n50,30,70,20,40,60,80,70\n2,1,3,1",
            a -> { int key = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 1); long sum = 0; boolean removed = false; for (int i = 0; i < t.length; i++) { if (t[i] == -9999) continue; if (!removed && t[i] == key) { removed = true; continue; } sum += t[i]; } return (int) sum; }),
        DsaCatalog.a2i("insert-into-bst-parents", "Insert into a BST (sum check)", MEDIUM, "Trees", "tree,bst,dfs",
            "Encoding: level order BST with children at 2i+1/2i+2, null = -9999; the LAST token is the value to insert (guaranteed absent). Return the sum of the tree after insertion (original + inserted value).",
            "1 <= nodes <= 10^4.",
            "k",
            "4,2,7,1,3,5",
            "40,20,60,10,30,50,70,5,15,25,35,45,55,65,75,1\n1,2\n-9999,3",
            a -> { int val = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 1); int sum = val; for (int v : t) if (v != -9999) sum += v; return sum; }),
        DsaCatalog.a2i("count-complete-tree-nodes-parents", "Count Complete Tree Nodes", EASY, "Trees", "tree,bfs,binary-search",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the number of nodes.",
            "0 <= nodes <= 5*10^4.",
            "k",
            "1,2,3,4,5,6\n-9999",
            "1\n1,2,3,4,5,6,7,8,9,10\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16",
            a -> { int c = 0; for (int v : a) if (v != -9999) c++; return c; }),
        DsaCatalog.a2i("binary-tree-coloring-game-count", "Binary Tree Coloring Game (blocked count)", MEDIUM, "Trees", "tree,dfs,game-theory",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999; the LAST TWO tokens are node values x (first player) and n (total nodes). Return the size of the largest region the second player can secure by coloring the parent or a child of x.",
            "3 <= nodes <= 100; all values unique.",
            "k",
            "1,2,3,4,5,6,7,8,9,10,11,3,11\n1,2,3,4,5,6,7,8,9,10,11,2,11",
            "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,15\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,4,15",
            a -> { int x = a[a.length - 2]; int[] t = java.util.Arrays.copyOf(a, a.length - 2); int xi = -1; for (int i = 0; i < t.length; i++) if (t[i] == x) { xi = i; break; } int left = size(t, 2 * xi + 1), right = size(t, 2 * xi + 2); int parent = xi == 0 ? 0 : t.length - 1 - xi; return Math.max(parent, Math.max(left, right)); }),
        DsaCatalog.a2i("find-duplicate-subtrees-count", "Find Duplicate Subtrees (count pairs)", MEDIUM, "Trees", "tree,dfs,hashing",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the number of PAIRS of identical leaf structures (pairs of leaves at different positions with equal values).",
            "1 <= nodes <= 5000.",
            "k",
            "1,2,3,4,-9999,2,4,-9999,-9999,4\n2,1,1\n2,2,2,3,-9999,3,-9999",
            "1,2,3,4,5,6,7\n1,1,1,1,1,1,1\n5,4,3,2,1,2,1",
            a -> { java.util.Map<Integer,Integer> c = new java.util.HashMap<>(); for (int i = 0; i < a.length; i++) { if (a[i] == -9999) continue; boolean leaf = true; if (2 * i + 1 < a.length && a[2 * i + 1] != -9999) leaf = false; if (2 * i + 2 < a.length && a[2 * i + 2] != -9999) leaf = false; if (leaf) c.merge(a[i], 1, Integer::sum); } int pairs = 0; for (int v : c.values()) pairs += v * (v - 1) / 2; return pairs; }),
        DsaCatalog.a2i("longest-zigzag-path-parents", "Longest ZigZag Path in a Binary Tree", MEDIUM, "Trees", "tree,dfs,dynamic-programming",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999. Return the length (node count) of the longest zigzag path.",
            "1 <= nodes <= 5*10^4.",
            "k",
            "1,-9999,1,1,1,-9999,-9999,1,-9999,-9999,-9999,1,-9999,-9999,-9999,1\n1,1,1,-9999,1,-9999,-9999,1,1,-9999,1",
            "1\n1,2,3,4,5,6,7\n1,1,1,1,1,1,1,1,1,1,1,1,1,1,1",
            a -> { int[] best = new int[1]; zig(a, 0, 0, 0, best); zig(a, 0, 0, 1, best); return best[0]; }),
        DsaCatalog.a2i("amount-of-time-for-binary-tree-infect", "Amount of Time for Binary Tree to Be Infected", MEDIUM, "Trees", "tree,bfs,graph",
            "Encoding: level order with children at 2i+1/2i+2, null = -9999; the LAST token is the start node value. Return the minutes until the whole tree is infected.",
            "1 <= nodes <= 10^5 (tests <= 1000).",
            "k",
            "1,5,3,-9999,4,10,6,9,2\n3,5,1,6,2,0,8,-9999,-9999,7,4,4",
            "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,5\n1\n1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16",
            a -> { int start = a[a.length - 1]; int[] t = java.util.Arrays.copyOf(a, a.length - 1); java.util.Map<Integer,java.util.List<Integer>> g = new java.util.HashMap<>(); for (int i = 0; i < t.length; i++) { if (t[i] == -9999) continue; int l = 2 * i + 1, r = 2 * i + 2; if (l < t.length && t[l] != -9999) { g.computeIfAbsent(t[i], k -> new java.util.ArrayList<>()).add(t[l]); g.computeIfAbsent(t[l], k -> new java.util.ArrayList<>()).add(t[i]); } if (r < t.length && t[r] != -9999) { g.computeIfAbsent(t[i], k -> new java.util.ArrayList<>()).add(t[r]); g.computeIfAbsent(t[r], k -> new java.util.ArrayList<>()).add(t[i]); } } java.util.Deque<int[]> q = new java.util.ArrayDeque<>(); java.util.Set<Integer> vis = new java.util.HashSet<>(); q.offer(new int[]{start, 0}); vis.add(start); int last = 0; while (!q.isEmpty()) { int[] cur = q.poll(); last = cur[1]; for (int nb : g.getOrDefault(cur[0], java.util.List.of())) if (vis.add(nb)) q.offer(new int[]{nb, cur[1] + 1}); } return last; })
        );
    }

    // ---------- tree helpers (parent-index encoding, null = -9999) ----------
    static int depth(int[] t, int i) {
        if (i >= t.length || t[i] == -9999) return 0;
        return 1 + Math.max(depth(t, 2 * i + 1), depth(t, 2 * i + 2));
    }
    static int height(int[] t, int i, int[] best) {
        if (i >= t.length || t[i] == -9999) return 0;
        int l = height(t, 2 * i + 1, best), r = height(t, 2 * i + 2, best);
        best[0] = Math.max(best[0], l + r);
        return 1 + Math.max(l, r);
    }
    static int balanced(int[] t, int i) {
        if (i >= t.length || t[i] == -9999) return 0;
        int l = balanced(t, 2 * i + 1), r = balanced(t, 2 * i + 2);
        if (l < 0 || r < 0 || Math.abs(l - r) > 1) return -1;
        return 1 + Math.max(l, r);
    }
    static boolean sameTree(int[] a, int i, int[] b, int j) {
        boolean ea = i >= a.length || a[i] == -9999, eb = j >= b.length || b[j] == -9999;
        if (ea && eb) return true;
        if (ea != eb) return false;
        return a[i] == b[j] && sameTree(a, 2 * i + 1, b, 2 * j + 1) && sameTree(a, 2 * i + 2, b, 2 * j + 2);
    }
    static boolean mirror(int[] t, int i, int j) {
        boolean ea = i >= t.length || t[i] == -9999, eb = j >= t.length || t[j] == -9999;
        if (ea && eb) return true;
        if (ea != eb) return false;
        return t[i] == t[j] && mirror(t, 2 * i + 1, 2 * j + 2) && mirror(t, 2 * i + 2, 2 * j + 1);
    }
    static boolean pathSum(int[] t, int i, int target) {
        if (i >= t.length || t[i] == -9999) return false;
        int rem = target - t[i];
        int l = 2 * i + 1, r = 2 * i + 2;
        boolean leaf = (l >= t.length || t[l] == -9999) && (r >= t.length || t[r] == -9999);
        if (leaf) return rem == 0;
        return pathSum(t, l, rem) || pathSum(t, r, rem);
    }
    static void rootToLeaf(int[] t, int i, int cur, int[] total) {
        if (i >= t.length || t[i] == -9999) return;
        cur = cur * 10 + t[i];
        int l = 2 * i + 1, r = 2 * i + 2;
        boolean leaf = (l >= t.length || t[l] == -9999) && (r >= t.length || t[r] == -9999);
        if (leaf) { total[0] += cur; return; }
        rootToLeaf(t, l, cur, total);
        rootToLeaf(t, r, cur, total);
    }
    static int maxPath(int[] t, int i, int[] best) {
        if (i >= t.length || t[i] == -9999) return 0;
        int l = Math.max(0, maxPath(t, 2 * i + 1, best));
        int r = Math.max(0, maxPath(t, 2 * i + 2, best));
        best[0] = Math.max(best[0], t[i] + l + r);
        return t[i] + Math.max(l, r);
    }
    static int lca(int[] t, int i, int p, int q) {
        if (i >= t.length || t[i] == -9999) return -1;
        if (t[i] == p || t[i] == q) return t[i];
        int l = lca(t, 2 * i + 1, p, q), r = lca(t, 2 * i + 2, p, q);
        if (l != -1 && r != -1) return t[i];
        return l != -1 ? l : r;
    }
    static int goodNodes(int[] t, int i, int max) {
        if (i >= t.length || t[i] == -9999) return 0;
        int c = t[i] >= max ? 1 : 0;
        return c + goodNodes(t, 2 * i + 1, Math.max(max, t[i])) + goodNodes(t, 2 * i + 2, Math.max(max, t[i]));
    }
    static int countLeaves(int[] t, int i) {
        if (i >= t.length || t[i] == -9999) return 0;
        int l = 2 * i + 1, r = 2 * i + 2;
        boolean leaf = (l >= t.length || t[l] == -9999) && (r >= t.length || t[r] == -9999);
        return leaf ? 1 : countLeaves(t, l) + countLeaves(t, r);
    }
    static int leftLeafSum(int[] t, int i, boolean isLeft) {
        if (i >= t.length || t[i] == -9999) return 0;
        int l = 2 * i + 1, r = 2 * i + 2;
        boolean leaf = (l >= t.length || t[l] == -9999) && (r >= t.length || t[r] == -9999);
        if (leaf) return isLeft ? t[i] : 0;
        return leftLeafSum(t, l, true) + leftLeafSum(t, r, false);
    }
    static void collect(int[] t, int i, java.util.Map<Integer,Integer> c) {
        if (i >= t.length || t[i] == -9999) return;
        c.merge(t[i], 1, Integer::sum);
        collect(t, 2 * i + 1, c);
        collect(t, 2 * i + 2, c);
    }
    static int trimSum(int[] t, int i, int lo, int hi) {
        if (i >= t.length || t[i] == -9999) return 0;
        int s = (t[i] >= lo && t[i] <= hi) ? t[i] : 0;
        return s + trimSum(t, 2 * i + 1, lo, hi) + trimSum(t, 2 * i + 2, lo, hi);
    }
    static void kthInorder(int[] t, int i, int k, int[] cnt, int[] res) {
        if (i >= t.length || t[i] == -9999 || cnt[0] >= k) return;
        kthInorder(t, 2 * i + 1, k, cnt, res);
        cnt[0]++;
        if (cnt[0] == k) res[0] = t[i];
        kthInorder(t, 2 * i + 2, k, cnt, res);
    }
    static boolean validBst(int[] t, int i, long lo, long hi) {
        if (i >= t.length || t[i] == -9999) return true;
        if (t[i] <= lo || t[i] >= hi) return false;
        return validBst(t, 2 * i + 1, lo, t[i]) && validBst(t, 2 * i + 2, t[i], hi);
    }
    static void insertBst(int[][] tree, int node, int val) {
        if (tree[node][0] == -1) { tree[node][0] = val; return; }
        if (val < tree[node][0]) { if (tree[node][1] == -1) { tree[node][1] = val; return; } insertBst(new int[][]{tree[tree[node][1]]}, 0, val); }
        else { if (tree[node][1] == -1) { tree[node][1] = val; return; } insertBst(new int[][]{tree[tree[node][1]]}, 0, val); }
    }
    static int leafSumArr(int[][] tree, int node) { return 0; }
    static int buildLeafCount(int[] pre, int pl, int pr, int il, int ir, int[] pos) {
        if (pl > pr) return 0;
        if (pl == pr) return 1;
        int root = pre[pl], mid = pos[root];
        return buildLeafCount(pre, pl + 1, pl + mid - il, il, mid - 1, pos)
             + buildLeafCount(pre, pl + mid - il + 1, pr, mid + 1, ir, pos);
    }
    static int camDfs(int[] t, int i, int[] count) {
        if (i >= t.length || t[i] == -9999) return 2;
        int l = camDfs(t, 2 * i + 1, count), r = camDfs(t, 2 * i + 2, count);
        if (l == 0 || r == 0) { count[0]++; return 1; }
        if (l == 1 || r == 1) return 2;
        return 0;
    }
    static long[] rob(int[] t, int i) {
        if (i >= t.length || t[i] == -9999) return new long[]{0, 0};
        long[] l = rob(t, 2 * i + 1), r = rob(t, 2 * i + 2);
        long take = t[i] + l[1] + r[1];
        long skip = Math.max(l[0], l[1]) + Math.max(r[0], r[1]);
        return new long[]{take, skip};
    }
    static long tiltDfs(int[] t, int i, long[] tilt) {
        if (i >= t.length || t[i] == -9999) return 0;
        long l = tiltDfs(t, 2 * i + 1, tilt), r = tiltDfs(t, 2 * i + 2, tilt);
        tilt[0] += Math.abs(l - r);
        return l + r + t[i];
    }
    static int coinsDfs(int[] t, int i, int[] moves) {
        if (i >= t.length || t[i] == -9999) return 0;
        int l = coinsDfs(t, 2 * i + 1, moves), r = coinsDfs(t, 2 * i + 2, moves);
        moves[0] += Math.abs(l) + Math.abs(r);
        return t[i] + l + r - 1;
    }
    static long pathSum3(int[] t, int i, long cur, int target, java.util.Map<Long,Integer> pre) {
        if (i >= t.length || t[i] == -9999) return 0;
        cur += t[i];
        long paths = pre.getOrDefault(cur - target, 0);
        pre.merge(cur, 1, Integer::sum);
        paths += pathSum3(t, 2 * i + 1, cur, target, pre) + pathSum3(t, 2 * i + 2, cur, target, pre);
        pre.merge(cur, -1, Integer::sum);
        return paths;
    }
    static void vOrder(int[] t, int i, int col, java.util.TreeMap<Integer,Long> cols) {
        if (i >= t.length || t[i] == -9999) return;
        cols.merge(col, (long) t[i], Long::sum);
        vOrder(t, 2 * i + 1, col - 1, cols);
        vOrder(t, 2 * i + 2, col + 1, cols);
    }
    static void preorderSum(int[] t, int i, int[] sum) {
        if (i >= t.length || t[i] == -9999) return;
        sum[0] += t[i];
        preorderSum(t, 2 * i + 1, sum);
        preorderSum(t, 2 * i + 2, sum);
    }
    static int rangeSum(int[] t, int i, int lo, int hi) {
        if (i >= t.length || t[i] == -9999) return 0;
        int s = (t[i] >= lo && t[i] <= hi) ? t[i] : 0;
        return s + rangeSum(t, 2 * i + 1, lo, hi) + rangeSum(t, 2 * i + 2, lo, hi);
    }
    static void leaves(int[] t, int i, int[] out, int[] cnt) {
        if (i >= t.length || t[i] == -9999) return;
        int l = 2 * i + 1, r = 2 * i + 2;
        boolean leaf = (l >= t.length || t[l] == -9999) && (r >= t.length || t[r] == -9999);
        if (leaf) { out[cnt[0]++] = t[i]; return; }
        leaves(t, l, out, cnt);
        leaves(t, r, out, cnt);
    }
    static int size(int[] t, int i) {
        if (i >= t.length || t[i] == -9999) return 0;
        return 1 + size(t, 2 * i + 1) + size(t, 2 * i + 2);
    }
    static void greaterTree(int[] t, int i, int[] sum) {
        if (i >= t.length || t[i] == -9999) return;
        greaterTree(t, 2 * i + 2, sum);
        sum[0] += t[i];
        t[i] = sum[0];
        greaterTree(t, 2 * i + 1, sum);
    }
    static boolean twoSumBst(int[] t, int i, int k, java.util.Set<Integer> seen) {
        if (i >= t.length || t[i] == -9999) return false;
        if (seen.contains(k - t[i])) return true;
        seen.add(t[i]);
        return twoSumBst(t, 2 * i + 1, k, seen) || twoSumBst(t, 2 * i + 2, k, seen);
    }
    static void firstK(int[] t, int i, int k, int[] cnt, int[] sum) {
        if (i >= t.length || t[i] == -9999 || cnt[0] >= k) return;
        firstK(t, 2 * i + 1, k, cnt, sum);
        if (cnt[0] < k) { sum[0] += t[i]; cnt[0]++; }
        firstK(t, 2 * i + 2, k, cnt, sum);
    }
    static void zig(int[] t, int i, int len, int dir, int[] best) {
        if (i >= t.length || t[i] == -9999) return;
        best[0] = Math.max(best[0], len);
        if (dir == 0) { zig(t, 2 * i + 2, len + 1, 1, best); zig(t, 2 * i + 1, 1, 0, best); }
        else { zig(t, 2 * i + 1, len + 1, 0, best); zig(t, 2 * i + 2, 1, 1, best); }
    }
    static boolean isSubtree(int[] big, int i, int[] small) {
        if (i >= big.length || big[i] == -9999) return small.length == 0 || small[0] == -9999;
        return sameTree(big, i, small, 0) || isSubtree(big, 2 * i + 1, small) || isSubtree(big, 2 * i + 2, small);
    }
}
