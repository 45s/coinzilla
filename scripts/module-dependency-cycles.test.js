import assert from "node:assert/strict"
import test from "node:test"

import { findDependencyCycles } from "./module-dependency-cycles.js"

test("returns no cycles for an acyclic dependency graph", () => {
  assert.deepEqual(
    findDependencyCycles({
      nodes: ["a.js", "b.js", "c.js"],
      edges: [
        {
          from: "a.js",
          to: "b.js",
        },
        {
          from: "b.js",
          to: "c.js",
        },
      ],
    }),
    [],
    "A directed acyclic graph must not produce cycle diagnostics.",
  )
})

test("detects multi-module cycles and self-dependencies", () => {
  assert.deepEqual(
    findDependencyCycles({
      nodes: ["a.js", "b.js", "c.js", "d.js"],
      edges: [
        {
          from: "a.js",
          to: "b.js",
        },
        {
          from: "b.js",
          to: "a.js",
        },
        {
          from: "b.js",
          to: "c.js",
        },
        {
          from: "c.js",
          to: "c.js",
        },
        {
          from: "c.js",
          to: "d.js",
        },
      ],
    }),
    [
      ["a.js", "b.js"],
      ["c.js"],
    ],
    "Each strongly connected component with more than one node or a self-edge must be reported once.",
  )
})

test("detects longer cycles and returns stable sorted results", () => {
  const graph = {
    nodes: ["c.js", "a.js", "b.js"],
    edges: [
      {
        from: "c.js",
        to: "a.js",
      },
      {
        from: "b.js",
        to: "c.js",
      },
      {
        from: "a.js",
        to: "b.js",
      },
    ],
  }

  assert.deepEqual(
    findDependencyCycles(graph),
    [["a.js", "b.js", "c.js"]],
    "A cycle spanning three modules must be returned as one sorted component.",
  )
  assert.deepEqual(
    findDependencyCycles(graph),
    findDependencyCycles({
      nodes: [...graph.nodes].reverse(),
      edges: [...graph.edges].reverse(),
    }),
    "Cycle output must not depend on node or edge discovery order.",
  )
})

test("rejects duplicate graph nodes and edges to unknown modules", () => {
  assert.throws(
    () => findDependencyCycles({
      nodes: ["a.js", "a.js"],
      edges: [],
    }),
    /Duplicate dependency graph node: a\.js/,
    "Duplicate node identities must not be silently collapsed.",
  )

  assert.throws(
    () => findDependencyCycles({
      nodes: ["a.js"],
      edges: [
        {
          from: "a.js",
          to: "missing.js",
        },
      ],
    }),
    /Dependency edge references unknown module: a\.js -> missing\.js/,
    "Edges outside the supplied graph must fail with an actionable diagnostic.",
  )
})
