import test from "node:test"
import assert from "node:assert/strict"
import {
  executeRecoverySellerRunnerScenario,
  getRecoverySellerRunnerCatalog,
} from "./rs-scenario-adapter.js"

test("RS profitability helper scaffold invokes the production calculation function and emits helper-level assertions", async () => {
  const result = await executeRecoverySellerRunnerScenario({
    runId: "run-rs-1",
    scenarioId: "RS-004-011",
  })
  assert.equal(result.source, "production-domain-function")
  assert.equal(result.passed, true)
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

test("RS helper catalog labels the mapped case as preliminary and non-executable", () => {
  const [scenario] = getRecoverySellerRunnerCatalog()
  assert.equal(scenario.id, "RS-004-011", "the helper remains mapped to its source scenario")
  assert.equal(scenario.status, "TEST-MAPPED", "the registry mapping status remains unchanged")
  assert.equal(scenario.executionStatus, "PRELIMINARY", "helper-only execution must be labelled preliminary")
  assert.equal(scenario.executable, false, "helper-only execution must not be advertised as a full scenario")
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
