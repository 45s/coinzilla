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

  assert.equal(result.scenarioId, "RS-RUNTIME-SELL-SUBMISSION-001")
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

test("production RS runtime resolves caller-supplied symbol, configuration and market rules", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-custom-config",
    input: {
      marketPrice: "12.3",
      symbol: "ADAUSDT",
      baseAssetCode: "ADA",
      quoteAssetCode: "USDT",
      orderQuantity: 6,
      sellQuantity: 40,
      legacyInvested: 80,
      legacyQuantity: 40,
      investment: 80,
      priceIncrement: "0.01",
      quantityIncrement: "0.1",
      minQuantity: "0.1",
      minNotional: "5",
      pricePrecision: 2,
      quantityPrecision: 1,
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.action.quantity, "46")
  const runtimeStep = result.trace.find((step) =>
    step.source === "createRecoverySellerRuntimeDispatch")
  assert.equal(runtimeStep.inputs.symbol, "ADAUSDT")
  assert.deepEqual(runtimeStep.inputs.marketMetadata.tradingRules, [
    {
      type: "PRICE_INCREMENT",
      status: "SUPPORTED",
      amount: "0.01",
    },
    {
      type: "QUANTITY_INCREMENT",
      status: "SUPPORTED",
      amount: "0.1",
    },
    {
      type: "MIN_QUANTITY",
      status: "SUPPORTED",
      amount: "0.1",
    },
    {
      type: "MIN_NOTIONAL",
      status: "SUPPORTED",
      amount: "5",
    },
  ])
})

test("production RS runtime rejects inconsistent symbol/asset configuration before dispatch", async () => {
  await assert.rejects(
    executeRecoverySellerRuntimeScenario({
      runId: "run-rs-runtime-invalid-market",
      input: {
        symbol: "ADAUSDT",
        baseAssetCode: "BTC",
      },
    }),
    /symbol must match its base and quote asset codes/,
  )
})

test("production RS submitter records a rejected SELL and invokes the STOP workflow", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-rejected",
    scenarioId: "RS-RUNTIME-SELL-REJECTION-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.submissionRejected, true)
  assert.equal(result.output.submittedOrders.length, 0)
  assert.equal(result.output.stopFactAppended, true)
  assert.ok(result.output.reservedSellCycle,
    "The unresolved rejected SELL must retain its sole-cycle reservation.")
})

test("production RS accounting reconciles a profitable partial CANCELED SELL without closing its cycle", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-partial-cancel",
    scenarioId: "RS-RUNTIME-SELL-PARTIAL-CANCEL-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.terminalSell.orderStatus, "CANCELED")
  assert.equal(result.output.terminalSell.executedQuantity, "2.5")
  assert.equal(result.output.terminalSell.profitabilityEligible, true)
  assert.equal(result.output.terminalSell.cycleState.status, "UNRESOLVED")
  assert.equal(result.output.terminalSell.cycleState.terminalReconciled, true)
  assert.equal(result.output.terminalSell.eventFillStaged, true)
  assert.equal(result.output.terminalSell.eventWorkflowReconciled, true)
  assert.equal(result.output.reservedSellCycle, null)
  assert.ok(result.output.simulationFacts.some((fact) =>
    fact.factType === "RECOVERY_SELLER_MIXED_SELL_RECONCILED"))
})

test("production RS registry exposes the runtime scenario and keeps the helper-only mapping preliminary", () => {
  const catalog = getRecoverySellerRunnerCatalog()
  assert.deepEqual(catalog.map((scenario) => scenario.id), [
    "RS-004-011",
    "RS-RUNTIME-SELL-SUBMISSION-001",
    "RS-RUNTIME-SELL-REJECTION-001",
    "RS-RUNTIME-SELL-PARTIAL-CANCEL-001",
  ])
  const runtimeScenario = catalog.find((scenario) => scenario.id === "RS-RUNTIME-SELL-SUBMISSION-001")
  assert.equal(runtimeScenario.executable, false)
  assert.equal(runtimeScenario.executionStatus, "PRELIMINARY")
  assert.equal(runtimeScenario.status, "PARTIAL")
  assert.equal(runtimeScenario.layer, "APPLICATION")
  assert.ok(runtimeScenario.readinessReasons.some((reason) => reason.includes("under-target FILLED SELL STOP")))
  assert.ok(runtimeScenario.readinessReasons.some((reason) => reason.includes("OS-level sandbox")))
  assert.equal(catalog[0].executable, false)
  assert.equal(catalog[0].executionStatus, "PRELIMINARY")
})
