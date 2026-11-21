import test from "node:test"
import assert from "node:assert/strict"
import { validateCriticalBehaviorContract } from "../scripts/check-critical-behavior-contract.js"

const validContract = {
  schemaVersion: 1,
  criticalPathPrefixes: ["src/domain/orders/"],
  behaviors: [
    {
      id: "ORDER-IDENTITY",
      title: "Canonical order identity and monotonic state",
      sourceModules: ["src/domain/orders/order-registry.js"],
      tests: [
        {
          path: "src/domain/orders/order-registry.test.js",
          name: "matches an execution report by broker order ID when Binance client ID differs",
          kind: "normal",
        },
        {
          path: "src/domain/orders/order-registry.test.js",
          name: "ignores FILLED-to-OPEN regressions regardless of event timestamp",
          kind: "failure",
        },
      ],
    },
  ],
}

const fileContents = {
  "src/domain/orders/order-registry.js": "export class OrderRegistry {}",
  "src/domain/orders/order-registry.test.js": [
    'test("matches an execution report by broker order ID when Binance client ID differs", () => {})',
    'test("ignores FILLED-to-OPEN regressions regardless of event timestamp", () => {})',
  ].join("\n"),
}

function validate({ contract = validContract, changedFiles = [] } = {}) {
  return validateCriticalBehaviorContract({
    contract,
    changedFiles,
    readFile: (path) => fileContents[path],
  })
}

test("accepts a behavior contract with existing source and named normal/failure regressions", () => {
  const result = validate()

  assert.deepEqual(result.errors, [], "A complete behavior-to-source-and-test mapping must pass validation.")
  assert.deepEqual(result.affectedBehaviorIds, [], "A validation run without changed files must not report changed behaviors.")
})

test("rejects a critical behavior without both normal and failure regression evidence", () => {
  const contract = structuredClone(validContract)
  contract.behaviors[0].tests = contract.behaviors[0].tests.filter(({ kind }) => kind === "normal")

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("ORDER-IDENTITY") && error.includes("failure")),
    "A critical behavior without a failure-path regression must be rejected.",
  )
})

test("rejects a mapped regression whose named test was removed from its source file", () => {
  const result = validate({
    changedFiles: [],
    contract: {
      ...validContract,
      behaviors: [{
        ...validContract.behaviors[0],
        tests: [
          ...validContract.behaviors[0].tests,
          {
            path: "src/domain/orders/order-registry.test.js",
            name: "removed regression that no longer exists",
            kind: "failure",
          },
        ],
      }],
    },
  })

  assert.ok(
    result.errors.some((error) => error.includes("removed regression")),
    "Removing a named critical regression must fail the behavior-contract check.",
  )
})

test("rejects critical source changes that have no behavior owner", () => {
  const result = validate({ changedFiles: ["src/domain/orders/new-order-transition.js"] })

  assert.ok(
    result.errors.some((error) => error.includes("new-order-transition.js") && error.includes("owner")),
    "A changed module under a critical source boundary must be assigned to a documented behavior.",
  )
})

test("reports the behavior owner when a mapped critical source module changes", () => {
  const result = validate({ changedFiles: ["src/domain/orders/order-registry.js"] })

  assert.deepEqual(
    result.affectedBehaviorIds,
    ["ORDER-IDENTITY"],
    "A changed critical source module must identify its behavior owner and mapped regression evidence.",
  )
})
