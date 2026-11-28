import test from "node:test"
import assert from "node:assert/strict"
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createScenarioDefinition } from "./factories.js"
import { loadConservativeScenarios } from "./loader.js"
import {
  buildScenarioReports,
  writeScenarioReports,
} from "./reporter.js"
import {
  filterScenarios,
  parseTapResults,
  runScenarioSuite,
} from "./runner.js"
import { validateScenarioDefinitions } from "./schema.js"

const mappedTest = {
  path: "src/domain/strategies/conservative/recovery-sell-plan.test.js",
  name: "plans a recovery SELL that retains keepQuantity and covers cost plus minProfit",
  kind: "normal",
}

function createScenarioFixture(overrides = {}) {
  return createScenarioDefinition({
    id: "CON-TEST-001",
    title: "A mapped Conservative scenario",
    category: "buy-lifecycle",
    priority: "P0",
    description: "A deterministic scenario fixture for the scenario infrastructure.",
    tags: ["recovery", "financial"],
    preconditions: ["A valid Conservative market and configuration exist."],
    initialState: {
      position: "empty",
      activeOrders: [],
    },
    inputEvents: [
      {
        type: "BUY_FILL",
        tradeId: "buy-1",
      },
    ],
    expectedState: {
      position: "reconciled",
    },
    expectedOrders: [
      {
        side: "SELL",
        purpose: "RECOVERY_SELL",
      },
    ],
    expectedAccounting: {
      quoteBasis: "10.01",
    },
    expectedSideEffects: {
      duplicateSubmission: false,
    },
    invariants: ["A canonical fill is accounted for at most once."],
    relatedRequirements: ["CON-SPEC-3.1"],
    relatedCriticalBehaviors: ["RECOVERY_SELL_ECONOMICS"],
    relatedSourceFiles: ["src/domain/strategies/conservative/recovery-sell-plan.js"],
    relatedExistingTests: [mappedTest],
    coverageStatus: "TEST-MAPPED",
    coverageReason: "The named test is mapped; the full scenario assertion review is pending.",
    ...overrides,
  })
}

test("loads a stable scenario inventory covering all Conservative behavior categories", () => {
  const {
    scenarios,
    requirements,
    criticalBehaviorContract,
  } = loadConservativeScenarios()
  const categories = new Set(scenarios.map((scenario) => scenario.category))
  const scenarioIds = scenarios.map((scenario) => scenario.id)

  assert.equal(categories.size, 16, "Every requested Conservative behavior category must be represented.")
  assert.equal(new Set(scenarioIds).size, scenarioIds.length, "Scenario IDs must be unique.")
  assert.ok(requirements.length > 0, "The canonical Conservative requirements must be inventoried.")
  assert.ok(criticalBehaviorContract.behaviors.length > 0, "Existing critical behavior evidence must be reused.")
  assert.ok(
    scenarios.every((scenario) => Array.isArray(scenario.relatedSourceFiles)),
    "Every loaded scenario must expose its implementation source paths.",
  )
  assert.ok(
    scenarios.every((scenario) => Array.isArray(scenario.relatedExistingTests)),
    "Every loaded scenario must expose its resolved named test mappings.",
  )

  const restartScenario = scenarios.find((scenario) => scenario.id === "CON-PERSIST-002")
  assert.equal(restartScenario.coverageStatus, "TEST-MAPPED", "The unsupported runtime-restoration boundary must have executable evidence.")
  assert.match(restartScenario.expectedState.runtimeRestoration, /^UNSUPPORTED:/, "Runtime restoration must remain explicitly unsupported.")
  assert.equal(restartScenario.relatedExistingTests.length, 3, "Offline restart tests must prove the disabled-restoration boundary and cancellation/fill race.")
  const startupHistoryScenario = scenarios.find((scenario) => scenario.id === "CON-PERSIST-003")
  assert.equal(startupHistoryScenario.coverageStatus, "TEST-MAPPED", "Prior-session startup gates must have executable evidence.")
  assert.equal(startupHistoryScenario.relatedExistingTests.length, 8, "Prior-session restart policy, RS STOP scope, and account safety boundaries must have executable mappings.")
  assert.match(startupHistoryScenario.coverageReason, /RS STOP stays strategy-scoped/i, "The durable RS STOP boundary must remain strategy-scoped.")

  const configScenario = scenarios.find((scenario) => scenario.id === "CON-CONFIG-001")
  const sellScenario = scenarios.find((scenario) => scenario.id === "CON-SELL-001")
  assert.equal(configScenario.coverageStatus, "PARTIAL", "Configuration evidence must not be promoted to VERIFIED.")
  assert.ok(configScenario.relatedExistingTests.some((testCase) => testCase.path === "src/bootstrap/config/resolve-harvester-options.test.js"), "Configuration scenarios must link the configuration resolver tests.")
  assert.ok(sellScenario.relatedExistingTests.some((testCase) => testCase.path === "src/domain/strategies/conservative/strategy.test.js"), "SELL scenarios must link the Conservative strategy tests.")
})

test("validates required scenario fields, stable IDs, categories, statuses, and evidence references", () => {
  const scenario = createScenarioFixture()
  const criticalBehaviorContract = {
    behaviors: [
      {
        id: "RECOVERY_SELL_ECONOMICS",
        sourceModules: ["src/domain/strategies/conservative/recovery-sell-plan.js"],
        tests: [mappedTest],
      },
    ],
  }
  const requirements = [
    {
      id: "CON-SPEC-3.1",
      title: "Initial BUY behavior",
    },
  ]
  const result = validateScenarioDefinitions({
    scenarios: [scenario],
    requirements,
    criticalBehaviorContract,
  })

  assert.deepEqual(result.errors, [], "A complete scenario with valid source and test evidence must pass schema validation.")

  const invalid = validateScenarioDefinitions({
    scenarios: [scenario, createScenarioFixture()],
    requirements,
    criticalBehaviorContract,
  })
  assert.ok(invalid.errors.some((error) => /duplicate.*CON-TEST-001/i.test(error)), "Duplicate scenario IDs must be rejected.")
})

test("filters scenarios by ID, category, priority, tag, and coverage status", () => {
  const scenarios = [
    createScenarioFixture(),
    createScenarioFixture({
      id: "CON-TEST-002",
      category: "accounting-pnl",
      priority: "P1",
      tags: ["commission"],
      coverageStatus: "MISSING",
      relatedExistingTests: [],
    }),
  ]
  const idFilters = { id: "CON-TEST-001" }
  const categoryFilters = { category: "accounting-pnl" }
  const priorityFilters = { priority: "P0" }
  const tagFilters = { tag: "commission" }
  const statusFilters = { coverageStatus: "MISSING" }

  assert.deepEqual(
    filterScenarios({
      scenarios,
      filters: idFilters,
    }).map(({ id }) => id),
    ["CON-TEST-001"],
    "The ID filter must select only the requested stable scenario ID.",
  )
  assert.deepEqual(
    filterScenarios({
      scenarios,
      filters: categoryFilters,
    }).map(({ id }) => id),
    ["CON-TEST-002"],
    "The category filter must select only scenarios in the requested category.",
  )
  assert.deepEqual(
    filterScenarios({
      scenarios,
      filters: priorityFilters,
    }).map(({ id }) => id),
    ["CON-TEST-001"],
    "The priority filter must select only scenarios at the requested priority.",
  )
  assert.deepEqual(
    filterScenarios({
      scenarios,
      filters: tagFilters,
    }).map(({ id }) => id),
    ["CON-TEST-002"],
    "The tag filter must select scenarios carrying the requested tag.",
  )
  assert.deepEqual(
    filterScenarios({
      scenarios,
      filters: statusFilters,
    }).map(({ id }) => id),
    ["CON-TEST-002"],
    "The coverage filter must select only scenarios with the requested evidence status.",
  )
})

test("parses named TAP outcomes and reports missing mapped tests instead of false passes", () => {
  const expectedTests = [
    mappedTest,
    {
      path: "src/domain/orders/order-registry.test.js",
      name: "ignores FILLED-to-OPEN regressions regardless of event timestamp",
      kind: "failure",
    },
    {
      path: "src/domain/portfolio/portfolio.test.js",
      name: "a named test that was removed",
      kind: "normal",
    },
  ]
  const output = [
    "TAP version 13",
    "ok 1 - plans a recovery SELL that retains keepQuantity and covers cost plus minProfit",
    "not ok 2 - ignores FILLED-to-OPEN regressions regardless of event timestamp",
  ].join("\n")
  const tapInput = {
    output,
    expectedTests,
  }
  const results = parseTapResults(tapInput)

  assert.equal(results[0].status, "PASSED", "The exact mapped TAP success must be recognized.")
  assert.equal(results[1].status, "FAILED", "A not ok TAP result must remain a failure.")
  assert.equal(results[2].status, "NOT_FOUND", "A missing mapped test must never be treated as a pass.")
})

test("runs mapped Node tests once per file and shares evidence across scenarios", async () => {
  const first = createScenarioFixture()
  const second = createScenarioFixture({
    id: "CON-TEST-002",
    title: "A second scenario sharing the same named test",
  })
  const calls = []
  const spawnSync = (...args) => {
    const [command, commandArgs, options] = args
    calls.push({
      command,
      args: commandArgs,
      options,
    })
    return {
      status: 0,
      stdout: "TAP version 13\nok 1 - plans a recovery SELL that retains keepQuantity and covers cost plus minProfit\n",
      stderr: "",
    }
  }

  const result = await runScenarioSuite({
    scenarios: [first, second],
    cwd: "/workspace/apps/harvester",
    spawnSync,
  })

  assert.equal(calls.length, 1, "A shared named test must execute once, not once per scenario.")
  assert.ok(calls[0].args.includes("--test"), "Mapped execution must use Node test mode.")
  assert.ok(calls[0].args.some((argument) => argument.includes("test-name-pattern")), "Mapped execution must restrict the run to registered test names.")
  assert.deepEqual(
    result.results.map(({ status }) => status),
    ["PASSED", "PASSED"],
    "Every scenario sharing the same successful named test must receive the mapped passing result.",
  )
})

function createScenarioReportFixture() {
  const scenario = createScenarioFixture()
  const requirements = [
    {
      id: "CON-SPEC-3.1",
      title: "Initial BUY behavior",
    },
    {
      id: "CON-SPEC-7.1",
      title: "Runtime restart boundary",
    },
  ]
  const criticalBehaviorContract = {
    behaviors: [
      {
        id: "RECOVERY_SELL_ECONOMICS",
        sourceModules: ["src/domain/strategies/conservative/recovery-sell-plan.js"],
        tests: [mappedTest],
      },
    ],
  }
  const results = [
    {
      id: scenario.id,
      status: "PASSED",
      testResults: [
        {
          ...mappedTest,
          status: "PASSED",
        },
      ],
    },
  ]

  return buildScenarioReports({
    scenarios: [scenario],
    results,
    requirements,
    criticalBehaviorContract,
  })
}

test("generates inventory, execution, and coverage JSON without manually maintained reports", async () => {
  const reports = createScenarioReportFixture()
  const outputDirectory = await mkdtemp(join(tmpdir(), "conservative-scenario-reports-"))

  try {
    const paths = await writeScenarioReports({
      reports,
      outputDirectory,
    })
    const inventory = JSON.parse(await readFile(paths.inventory, "utf8"))
    const execution = JSON.parse(await readFile(paths.results, "utf8"))
    const coverage = JSON.parse(await readFile(paths.coverage, "utf8"))

    assert.equal(inventory.totalScenarios, 1, "The inventory report must contain the full supplied scenario set.")
    assert.equal(execution.results[0].status, "PASSED", "The execution report must preserve the exact scenario result.")
    assert.deepEqual(
      coverage.requirementsWithoutScenarioCoverage.map(({ id }) => id),
      ["CON-SPEC-7.1"],
      "Coverage must identify the requirement without a linked scenario.",
    )
    assert.ok(Array.isArray(coverage.testsNotMappedToAnyScenario), "Coverage must report named critical tests not mapped to scenarios.")
  } finally {
    await rm(outputDirectory, {
      recursive: true,
      force: true,
    })
  }
})
