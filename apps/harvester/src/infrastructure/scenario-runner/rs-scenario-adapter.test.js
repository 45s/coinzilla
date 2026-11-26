import test from "node:test"
import assert from "node:assert/strict"
import {
  executeRecoverySellerRunnerScenario,
  getRecoverySellerRunnerCatalog,
} from "./rs-scenario-adapter.js"
import { executeRecoverySellerRuntimeScenario } from "./rs-runtime-scenario.js"

test("RS profitability helper scaffold invokes the production calculation function and emits helper-level assertions", async () => {
  const result = await executeRecoverySellerRunnerScenario({
    runId: "run-rs-1",
    scenarioId: "RS-004-011",
  })
  assert.equal(result.source, "production-domain-function")
  assert.equal(
    result.passed,
    true,
    JSON.stringify({
      output: result.output,
      assertions: result.assertions,
    }, null, 2)
  )
  assert.equal(result.output.recovery.netProfit, "0.01")
  assert.equal(result.output.legacy.netProfit, "0")
  assert.equal(result.trace.length, 3)
})

test("RS scenario adapter blocks unsupported scenario IDs", async () => {
  await assert.rejects(
    executeRecoverySellerRunnerScenario({
      runId: "run-rs-2",
      scenarioId: "RS-999-999",
    }),
    /not supported/,
  )
})

test("RS helper catalog labels the merged test-only registry candidate as preliminary and non-executable", () => {
  const scenario = getRecoverySellerRunnerCatalog().find((item) => item.id === "RS-004-011")
  assert.ok(scenario, "the helper scenario must remain present in the catalog")
  assert.equal(scenario.id, "RS-004-011", "the helper remains mapped to its source scenario")
  assert.equal(scenario.status, "PRELIMINARY", "the merged test-only registry is not a production runtime catalogue")
  assert.equal(scenario.executionStatus, "PRELIMINARY", "helper-only execution must be labelled preliminary")
  assert.equal(scenario.executable, false, "helper-only execution must not be advertised as a full scenario")
  assert.ok(scenario.readinessReasons.some((reason) => reason.includes("PR #1852 are merged, but remain test-only")))
  assert.ok(scenario.readinessReasons.some((reason) => reason.includes("full Recovery Seller strategy lifecycle")))
})

test("RS scenario adapter validates schema fields and decimal-string inputs", async () => {
  await assert.rejects(
    executeRecoverySellerRunnerScenario({
      runId: "run-rs-invalid",
      scenarioId: "RS-004-011",
      input: {
        minProfit: "1%",
      },
    }),
    /decimal-string schema/,
  )
  await assert.rejects(
    executeRecoverySellerRunnerScenario({
      runId: "run-rs-unknown-field",
      scenarioId: "RS-004-011",
      input: {
        unknown: "1",
      },
    }),
    /Unknown scenario input field/,
  )
})


test("internal RS runtime fixture exercises the production SELL dispatch with a deterministic simulation broker", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-1",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.fixtureId, "rs-runtime-sell-submission")
  assert.equal(result.source, "production-runtime-evaluator")
  assert.equal(result.passed, true)
  assert.equal(result.output.decision.outcome, "SUBMIT")
  assert.equal(result.output.action.side, "SELL")
  assert.equal(result.output.action.quantity, "55")
  assert.equal(result.output.submitted, true)
  assert.equal(result.output.submittedOrders.length, 1)
  assert.equal(result.output.reservedSellCycle.clientOrderId, result.output.submittedOrders[0].clientOrderId)
  assert.ok(result.trace.some((step) => step.source === "createRecoverySellerRuntimeDispatch"))
  assert.ok(result.trace.some((step) => step.kind === "simulated-broker"))
  assert.ok(result.trace.some((step) => step.kind === "assertion"))
})

test("production RS registry exposes the runtime scenario and keeps the helper-only mapping preliminary", () => {
  const catalog = getRecoverySellerRunnerCatalog()
  assert.deepEqual(catalog.map((scenario) => scenario.id), ["RS-004-011", "RS-RUNTIME-SELL-SUBMISSION-001"])
  const runtimeScenario = catalog.find((scenario) => scenario.id === "RS-RUNTIME-SELL-SUBMISSION-001")
  assert.equal(runtimeScenario.executable, false)
  assert.equal(runtimeScenario.executionStatus, "PRELIMINARY")
  assert.equal(runtimeScenario.status, "PARTIAL")
  assert.equal(runtimeScenario.layer, "APPLICATION")
  assert.ok(runtimeScenario.readinessReasons.some((reason) => reason.includes("partial-fill staging")))
  assert.ok(runtimeScenario.readinessReasons.some((reason) => reason.includes("OS-level sandbox")))
  assert.equal(catalog[0].executable, false)
  assert.equal(catalog[0].executionStatus, "PRELIMINARY")
})
