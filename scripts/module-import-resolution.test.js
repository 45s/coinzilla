import assert from "node:assert/strict"
import test from "node:test"

import { resolveRelativeModuleImport } from "./module-import-resolution.js"

test("resolves an explicit relative JavaScript module path", () => {
  assert.equal(
    resolveRelativeModuleImport({
      importerPath: "packages/example/src/index.js",
      specifier: "./feature.js",
      sourceFiles: ["packages/example/src/feature.js"],
    }),
    "packages/example/src/feature.js",
    "An explicit relative import must resolve to its matching repository source file.",
  )
})

test("resolves extensionless imports with deterministic extension and index precedence", () => {
  assert.equal(
    resolveRelativeModuleImport({
      importerPath: "apps/example/src/index.js",
      specifier: "./features/order",
      sourceFiles: [
        "apps/example/src/features/order.mjs",
        "apps/example/src/features/order.js",
      ],
    }),
    "apps/example/src/features/order.js",
    "Extensionless resolution must prefer .js before other supported source extensions.",
  )
  assert.equal(
    resolveRelativeModuleImport({
      importerPath: "apps/example/src/index.js",
      specifier: "./features/portfolio",
      sourceFiles: ["apps/example/src/features/portfolio/index.js"],
    }),
    "apps/example/src/features/portfolio/index.js",
    "Extensionless directory imports must resolve to a supported index module.",
  )
})

test("ignores package and built-in module specifiers", () => {
  for (const specifier of ["@coinzilla/utils", "node:fs", "lodash"]) {
    assert.equal(
      resolveRelativeModuleImport({
        importerPath: "packages/example/src/index.js",
        specifier,
        sourceFiles: ["packages/example/src/index.js"],
      }),
      null,
      `Non-relative module specifier "${specifier}" must not be resolved as a local source file.`,
    )
  }
})

test("refuses relative paths that escape the repository root", () => {
  assert.equal(
    resolveRelativeModuleImport({
      importerPath: "apps/example/src/index.js",
      specifier: "../../../../outside.js",
      sourceFiles: ["outside.js"],
    }),
    null,
    "A relative import that escapes the repository root must not create an external graph node.",
  )
})

test("ignores unresolved paths and explicit non-JavaScript assets", () => {
  for (const specifier of ["./missing.js", "./settings.json"]) {
    assert.equal(
      resolveRelativeModuleImport({
        importerPath: "packages/example/src/index.js",
        specifier,
        sourceFiles: ["packages/example/src/index.js"],
      }),
      null,
      `Unresolved or non-JavaScript import "${specifier}" must not become a source graph edge.`,
    )
  }
})
