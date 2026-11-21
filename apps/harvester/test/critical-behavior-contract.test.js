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
      runtimeStatus: "active",
      invariants: ["Order identity is canonical and terminal state is monotonic."],
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
  coverageBaseline: {
    baseDevelopSha: "develop-sha",
    measuredPrHeadSha: "measured-head-sha",
    sourceTreeMatchesDevelop: true,
    workflowRunId: 1,
    harvesterJobId: 2,
    aggregate: {
      lines: 90,
      branches: 83,
      functions: 96,
    },
  },
  moduleCoverage: [
    {
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

function validate({ contract = validContract, changedFiles = [], files = fileContents } = {}) {
  return validateCriticalBehaviorContract({
    contract,
    changedFiles,
    readFile: (path) => files[path],
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

test("requires integration evidence when a critical behavior declares it mandatory", () => {
  const contract = structuredClone(validContract)
  contract.behaviors[0].integrationRequired = true

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("ORDER-IDENTITY") && error.includes("integration")),
    "A behavior that requires integration evidence must not pass with unit tests alone.",
  )
})

test("requires an explicit limitation when runtime restoration is intentionally disabled", () => {
  const contract = structuredClone(validContract)
  contract.behaviors[0].runtimeStatus = "disabled-by-design"

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("ORDER-IDENTITY") && error.includes("limitation")),
    "An intentionally disabled critical capability must state its safety limitation rather than imply runtime support.",
  )
})

test("does not treat a changed colocated test file as an unowned production module", () => {
  const result = validate({ changedFiles: ["src/domain/orders/order-registry.test.js"] })

  assert.deepEqual(result.errors, [], "Changing a mapped regression test must not be mistaken for an unowned production module.")
  assert.deepEqual(result.affectedBehaviorIds, [], "A test-only file change must not be reported as a production behavior change.")
})

test("rejects an empty critical behavior inventory", () => {
  const contract = {
    ...validContract,
    behaviors: [],
  }

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("at least one critical behavior")),
    "An empty inventory must never disable critical behavior ownership checks.",
  )
})

test("rejects a non-boolean integration evidence requirement", () => {
  const contract = structuredClone(validContract)
  contract.behaviors[0].integrationRequired = "true"

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("ORDER-IDENTITY") && error.includes("integrationRequired")),
    "Integration evidence requirements must be explicit booleans.",
  )
})

test("does not accept a regression title that appears only in a source comment", () => {
  const files = {
    ...fileContents,
    "src/domain/orders/order-registry.test.js": [
      '// test("matches an execution report by broker order ID when Binance client ID differs", () => {})',
      'test("ignores FILLED-to-OPEN regressions regardless of event timestamp", () => {})',
    ].join("\\n"),
  }

  const result = validate({ files })

  assert.ok(
    result.errors.some((error) => error.includes("matches an execution report")),
    "A comment containing a deleted test title must not count as executable regression evidence.",
  )
})

test("requires authoritative invariants for each critical behavior", () => {
  const contract = structuredClone(validContract)
  delete contract.behaviors[0].invariants

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("ORDER-IDENTITY") && error.includes("invariant")),
    "A critical behavior without explicit domain invariants must fail the inventory gate.",
  )
})

test("requires a measured coverage floor for every critical production module", () => {
  const contract = structuredClone(validContract)
  contract.moduleCoverage = []

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("measured per-module coverage floors")),
    "An empty module coverage matrix must fail validation before the inventory can be accepted.",
  )
})

test("rejects a critical-module coverage floor above its measured baseline", () => {
  const contract = structuredClone(validContract)
  contract.moduleCoverage[0].minimum.branches = 95

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("order-registry.js") && error.includes("baseline")),
    "A coverage floor must not exceed its measured baseline.",
  )
})


test("rejects a critical-module floor lowered below the measured-baseline policy", () => {
  const contract = structuredClone(validContract)
  contract.moduleCoverage[0].minimum.branches = 80

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("order-registry.js") && error.includes("measured-baseline policy")),
    "A critical coverage floor must not be lowered below the floor derived from its recorded baseline.",
  )
})

test("rejects critical source modules omitted from declared path boundaries", () => {
  const contract = structuredClone(validContract)
  contract.criticalPathPrefixes = ["src/use-cases/"]

  const result = validate({ contract })

  assert.ok(
    result.errors.some((error) => error.includes("order-registry.js") && error.includes("outside declared critical path prefixes")),
    "A critical source module must remain inside the declared changed-source enforcement boundaries.",
  )
})
