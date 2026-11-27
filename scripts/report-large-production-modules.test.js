import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { findLargeProductionModules } from "./report-large-production-modules.js"

function writeModule({ root, relativePath, lineCount }) {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  const lines = []
  for (let index = 0; index < lineCount; index += 1) {
    lines.push(`// line ${index + 1}`)
  }
  writeFileSync(path, lines.join("\n"))
}

function writeFixtureModules({ root }) {
  const fixtures = [
    ["apps/example/src/large.js", 501],
    ["packages/example/src/large.js", 503],
    ["scripts/large.mjs", 502],
    ["apps/example/src/exact-threshold.js", 500],
    ["apps/example/src/large.test.js", 900],
    ["packages/example/test-support/provider-conformance.js", 999],
    ["packages/example/node_modules/vendor.js", 999],
    ["apps/example/src/Z-large.js", 501],
    ["apps/example/src/a-large.js", 501],
    ["apps/example/specs/spec-helper.js", 999],
    ["packages/example/testdata/test-data-helper.js", 999],
    ["scripts/example/e2e/e2e-helper.js", 999],
    ["packages/example/__snapshots__/snapshot-helper.js", 999],
    ["apps/example/src/large.e2e.js", 999],
  ]
  for (const [relativePath, lineCount] of fixtures) {
    writeModule({
      root,
      relativePath,
      lineCount,
    })
  }
}

test("inventories production modules over the threshold and excludes test support", () => {
  const root = mkdtempSync(join(tmpdir(), "large-module-report-"))
  try {
    writeFixtureModules({
      root,
    })
    assert.deepEqual(
      findLargeProductionModules({
        root,
        threshold: 500,
      }),
      [
        {
          path: "packages/example/src/large.js",
          lines: 503,
        },
        {
          path: "scripts/large.mjs",
          lines: 502,
        },
        {
          path: "apps/example/src/Z-large.js",
          lines: 501,
        },
        {
          path: "apps/example/src/a-large.js",
          lines: 501,
        },
        {
          path: "apps/example/src/large.js",
          lines: 501,
        },
      ],
      "The report must sort ties by stable code-unit path order and exclude test/spec/e2e/snapshot, test-support, and vendor trees.",
    )
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
    })
  }
})

test("requires a positive safe-integer line threshold", () => {
  const root = mkdtempSync(join(tmpdir(), "large-module-report-threshold-"))
  try {
    assert.throws(
      () => findLargeProductionModules({
        root,
        threshold: 0,
      }),
      /threshold/,
      "A zero threshold would turn the report into a misleading all-files listing.",
    )
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
    })
  }
})
