import assert from "node:assert/strict"
import test from "node:test"

import { createModuleDependencyGraph } from "./module-dependency-graph.js"

const modules = [
  {
    file: "packages/example/src/index.js",
    source: [
      'import { value } from "./feature.js"',
      'import "@coinzilla/utils"',
      'import "node:fs"',
    ].join("\n"),
  },
  {
    file: "packages/example/src/feature.js",
    source: 'export { value } from "./nested/value.js"\n',
  },
  {
    file: "packages/example/src/nested/value.js",
    source: 'import "../index.js"\n',
  },
  {
    file: "packages/example/src/isolated.js",
    source: "export const isolated = true\n",
  },
]

test("builds a complete graph from statically resolved relative imports", () => {
  assert.deepEqual(
    createModuleDependencyGraph({ modules }),
    {
      nodes: [
        "packages/example/src/feature.js",
        "packages/example/src/index.js",
        "packages/example/src/isolated.js",
        "packages/example/src/nested/value.js",
      ],
      edges: [
        {
          from: "packages/example/src/feature.js",
          to: "packages/example/src/nested/value.js",
          specifier: "./nested/value.js",
          kind: "re-export",
        },
        {
          from: "packages/example/src/index.js",
          to: "packages/example/src/feature.js",
          specifier: "./feature.js",
          kind: "import",
        },
        {
          from: "packages/example/src/nested/value.js",
          to: "packages/example/src/index.js",
          specifier: "../index.js",
          kind: "import",
        },
      ],
    },
    "The graph must include isolated source nodes and only resolved relative JavaScript edges, excluding package and built-in imports.",
  )
})

test("produces the same graph regardless of source discovery order", () => {
  assert.deepEqual(
    createModuleDependencyGraph({ modules }),
    createModuleDependencyGraph({ modules: [...modules].reverse() }),
    "Filesystem discovery order must not change the graph or its edge ordering.",
  )
})

test("rejects duplicate normalized source paths", () => {
  assert.throws(
    () => createModuleDependencyGraph({
      modules: [
        { file: "packages/example/src/index.js", source: "export const first = true\n" },
        { file: "packages/example/src/index.js", source: "export const second = true\n" },
      ],
    }),
    /Duplicate module source path: packages\/example\/src\/index\.js/,
    "Duplicate source identities must fail instead of silently overwriting graph nodes.",
  )
})

test("preserves the source path when a module cannot be parsed", () => {
  assert.throws(
    () => createModuleDependencyGraph({
      modules: [
        { file: "packages/example/src/broken.js", source: "const invalid = ;\n" },
      ],
    }),
    {
      name: "SyntaxError",
      message: /packages\/example\/src\/broken\.js:1:/,
    },
    "A malformed source file must fail graph construction with its own path and parser location.",
  )
})
