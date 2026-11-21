import test from "node:test"
import assert from "node:assert/strict"
import {
  parseNodeCoverageReport,
  validateCriticalModuleCoverage,
} from "../scripts/check-critical-module-coverage.js"

const coverageReport = [
  "2026-11-21T08:10:25Z ℹ src                                                        |        |          |         |",
  "2026-11-21T08:10:25Z ℹ  index.js                                                  |  84.57 |    81.14 |   93.75 |",
  "2026-11-21T08:10:25Z ℹ  domain                                                   |        |          |         |",
  "2026-11-21T08:10:25Z ℹ   orders                                                   |        |          |         |",
  "2026-11-21T08:10:25Z ℹ    order-registry.js                                       |  94.05 |    89.84 |  100.00 |",
  "2026-11-21T08:10:25Z ℹ    index.js                                                | 100.00 |   100.00 |  100.00 |",
  "2026-11-21T08:10:25Z ℹ  bootstrap                                                 |        |          |         |",
  "2026-11-21T08:10:25Z ℹ   account                                                  |        |          |         |",
  "2026-11-21T08:10:25Z ℹ    index.js                                                |  95.00 |    95.00 |   95.00 |",
  "2026-11-21T08:10:25Z ℹ all files                                                  |  90.35 |    83.22 |   96.00 |",
].join("\n")

const orderRegistryCoverage = {
  path: "src/domain/orders/order-registry.js",
  baseline: {
    lines: 94.05,
    branches: 89.84,
    functions: 100,
  },
  minimum: {
    lines: 90,
    branches: 85,
    functions: 95,
  },
}

test("parses Node coverage rows into unambiguous source-relative module paths", () => {
  const coverage = parseNodeCoverageReport(coverageReport)

  assert.deepEqual(
    coverage.get("src/index.js"),
    {
      lines: 84.57,
      branches: 81.14,
      functions: 93.75,
    },
    "The root index module must not be confused with nested files named index.js.",
  )
  assert.deepEqual(
    coverage.get("src/domain/orders/order-registry.js"),
    {
      lines: 94.05,
      branches: 89.84,
      functions: 100,
    },
    "Nested source directories must be reconstructed from the coverage table.",
  )
  assert.deepEqual(
    coverage.get("src/domain/orders/index.js"),
    {
      lines: 100,
      branches: 100,
      functions: 100,
    },
    "A nested index module must retain its own full path.",
  )
})

test("accepts critical modules that meet every measured minimum", () => {
  const coverage = new Map([
    [
      "src/domain/orders/order-registry.js",
      {
        lines: 90,
        branches: 85,
        functions: 95,
      },
    ],
  ])

  const result = validateCriticalModuleCoverage({
    moduleCoverage: [orderRegistryCoverage],
    coverage,
  })

  assert.deepEqual(result.errors, [], "A module meeting every coverage floor must pass.")
  assert.deepEqual(
    result.checkedModules,
    ["src/domain/orders/order-registry.js"],
    "The checker must report the exact module checked.",
  )
})

test("rejects a critical module when any one coverage dimension falls below its floor", () => {
  const coverage = new Map([
    [
      "src/domain/orders/order-registry.js",
      {
        lines: 90,
        branches: 84.99,
        functions: 95,
      },
    ],
  ])

  const result = validateCriticalModuleCoverage({
    moduleCoverage: [orderRegistryCoverage],
    coverage,
  })

  assert.ok(
    result.errors.some((error) => error.includes("order-registry.js") && error.includes("branches")),
    "A branch-coverage regression below the floor must fail even when line and function coverage pass.",
  )
})

test("rejects a critical module missing from the coverage report", () => {
  const result = validateCriticalModuleCoverage({
    moduleCoverage: [orderRegistryCoverage],
    coverage: new Map(),
  })

  assert.ok(
    result.errors.some((error) => error.includes("order-registry.js") && error.includes("missing")),
    "A missing critical module row must not be treated as zero or silently skipped.",
  )
})
