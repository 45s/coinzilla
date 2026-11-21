import assert from "node:assert/strict"
import test from "node:test"

import { extractModuleImports } from "./module-import-analysis.js"

test("extracts static imports, re-exports, literal dynamic imports, and CommonJS requires", () => {
  const source = [
    'import defaultValue from "./default-import.js"',
    'import "./side-effect-import.js"',
    'export { value } from "./named-re-export.js"',
    'export * from "./star-re-export.js"',
    'await import("./dynamic-import.js")',
    'const requiredModule = require("./commonjs-require.js")',
  ].join("\n")

  assert.deepEqual(
    extractModuleImports({ file: "src/example.js", source }),
    [
      { specifier: "./default-import.js", kind: "import" },
      { specifier: "./side-effect-import.js", kind: "import" },
      { specifier: "./named-re-export.js", kind: "re-export" },
      { specifier: "./star-re-export.js", kind: "re-export" },
      { specifier: "./dynamic-import.js", kind: "dynamic-import" },
      { specifier: "./commonjs-require.js", kind: "require" },
    ],
    "The import inventory must include each statically resolvable module edge in source order.",
  )
})

test("ignores import-like text in comments and strings and computed module specifiers", () => {
  const source = [
    '// import ignored from "./comment.js"',
    'const example = "require(\\\"./string.js\\\")"',
    'const computedPath = "./computed.js"',
    "import(computedPath)",
    "require(computedPath)",
  ].join("\n")

  assert.deepEqual(
    extractModuleImports({ file: "src/no-static-imports.js", source }),
    [],
    "Only actual syntax with a literal module specifier may become a graph edge.",
  )
})

test("reports malformed JavaScript with the source file and parser location", () => {
  assert.throws(
    () => extractModuleImports({
      file: "src/malformed-module.js",
      source: "const valid = true\nconst invalid = ;\n",
    }),
    {
      name: "SyntaxError",
      message: /src\/malformed-module\.js:2:/,
    },
    "Malformed source must fail with an actionable file and line diagnostic instead of disappearing from the graph.",
  )
})
