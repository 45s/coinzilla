import assert from "node:assert/strict"
import test from "node:test"

import {
  evaluateCoverageThresholds,
  parseCoverageRow,
} from "./coverage-report.js"

test("parseCoverageRow reads a Node.js all-files summary", () => {
  const result = parseCoverageRow({
    output: "# all files | 80.88 | 94.07 | 87.46 |\n",
    fileName: "all files",
  })

  assert.deepEqual(result, {
    ok: true,
    coverage: {
      statements: 80.88,
      branches: 94.07,
      functions: 87.46,
    },
  })
})

test("parseCoverageRow accepts whitespace and case differences", () => {
  const result = parseCoverageRow({
    output: "  # BOT-FREE-ROLL.JS   | 97.45 | 87.78 | 97.96 | 12-14\n",
    fileName: "bot-free-roll.js",
  })

  assert.deepEqual(result, {
    ok: true,
    coverage: {
      statements: 97.45,
      branches: 87.78,
      functions: 97.96,
    },
  })
})

test("parseCoverageRow fails clearly when the requested row is missing", () => {
  const result = parseCoverageRow({
    output: "# all files | 80.00 | 90.00 | 85.00 |",
    fileName: "bot-free-roll.js",
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /Could not find coverage row/)
})

test("parseCoverageRow rejects invalid percentages", () => {
  const result = parseCoverageRow({
    output: "# all files | 101 | 90 | 85 |",
    fileName: "all files",
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /invalid percentages/)
})

test("evaluateCoverageThresholds passes values equal to every minimum", () => {
  const result = evaluateCoverageThresholds({
    coverage: { statements: 80, branches: 90, functions: 85 },
    thresholds: { statements: 80, branches: 90, functions: 85 },
  })

  assert.deepEqual(result, { passed: true, violations: [] })
})

test("evaluateCoverageThresholds reports every metric below its minimum", () => {
  const result = evaluateCoverageThresholds({
    coverage: { statements: 79.99, branches: 89, functions: 84 },
    thresholds: { statements: 80, branches: 90, functions: 85 },
  })

  assert.deepEqual(result, {
    passed: false,
    violations: [
      { metric: "statements", actual: 79.99, minimum: 80 },
      { metric: "branches", actual: 89, minimum: 90 },
      { metric: "functions", actual: 84, minimum: 85 },
    ],
  })
})

test("evaluateCoverageThresholds fails closed for missing or invalid metrics", () => {
  const result = evaluateCoverageThresholds({
    coverage: { statements: 95 },
    thresholds: { statements: 90, branches: 75 },
  })

  assert.deepEqual(result, {
    passed: false,
    violations: [{ metric: "branches", actual: null, minimum: 75 }],
  })
})
