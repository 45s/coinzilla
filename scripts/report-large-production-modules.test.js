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
  writeModule({
    root,
    relativePath: "apps/example/src/large.js",
    lineCount: 501,
  })
  writeModule({
    root,
    relativePath: "packages/example/src/large.js",
    lineCount: 503,
  })
  writeModule({
    root,
    relativePath: "scripts/large.mjs",
    lineCount: 502,
  })
  writeModule({
    root,
    relativePath: "apps/example/src/exact-threshold.js",
    lineCount: 500,
  })
  writeModule({
    root,
    relativePath: "apps/example/src/large.test.js",
    lineCount: 900,
  })
  writeModule({
    root,
    relativePath: "packages/example/test-support/provider-conformance.js",
    lineCount: 999,
  })
  writeModule({
    root,
    relativePath: "packages/example/node_modules/vendor.js",
    lineCount: 999,
  })
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
          path: "apps/example/src/large.js",
          lines: 501,
        },
      ],
      "The report must sort by size and exclude exactly-threshold files, tests, test-support, and vendor trees.",
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
