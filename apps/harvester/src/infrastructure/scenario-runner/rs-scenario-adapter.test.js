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
  assert.equal(result.output.action.side, "SELL",
    "The runtime scenario output must expose the submitted recovery SELL action.")
  assert.equal(result.output.action.quantity, "55")
  assert.equal(result.output.submitted, true,
    "The production dispatch must confirm the simulated SELL submission.")
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

test("production RS accounting durably stops after a profitable partial CANCELED SELL", async () => {
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
  assert.equal(result.output.terminalSell.eventWorkflowFailedClosed, true)
  assert.equal(result.output.terminalSell.stopFactAppended, true,
    "The adverse terminal SELL must persist the simulated account-wide STOP fact.")
  assert.equal(result.output.reservedSellCycle, null,
    "Canonical terminal accounting releases the terminal order reservation; account STOP remains active.")
  assert.ok(result.output.simulationFacts.some((fact) =>
    fact.factType === "RECOVERY_SELLER_MIXED_SELL_RECONCILED"))
})

test("production RS accounting durably stops after a fully FILLED SELL misses the profitability target", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-filled-under-target",
    scenarioId: "RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.terminalSell.orderStatus, "FILLED",
    "The simulated broker lifecycle must report the complete SELL as FILLED.")
  assert.equal(result.output.terminalSell.executedQuantity, "55",
    "The FILLED SELL must reconcile its complete 55-unit original quantity.")
  assert.equal(result.output.terminalSell.profitabilityEligible, false,
    "The realized quote proceeds after the canonical commission must miss the approved target.")
  assert.equal(result.output.terminalSell.cycleState.status, "UNRESOLVED",
    "An under-target FILLED SELL must not close the Recovery Seller cycle.")
  assert.equal(result.output.terminalSell.cycleState.terminalReconciled, true,
    "The full canonical fill and terminal order facts must reconcile before STOP is accepted.")
  assert.equal(result.output.terminalSell.cycleState.profitabilityEligible, false,
    "The canonical cycle state must retain the failed profitability result.")
  assert.equal(result.output.terminalSell.eventFillStaged, true,
    "The production user-data transition must stage the canonical SELL fill exactly once.")
  assert.equal(result.output.terminalSell.stagedSellFillCount, 1,
    "The complete terminal SELL fill must be staged exactly once.")
  assert.equal(result.output.terminalSell.eventWorkflowFailedClosed, true,
    "The terminal event must fail closed after the adverse profitability outcome.")
  assert.equal(result.output.terminalSell.marketPaused, true,
    "The affected market must be paused after the terminal profitability STOP.")
  assert.ok(result.output.terminalSell.pauseReasons.includes("RS_TERMINAL_SELL_PROFITABILITY_STOP"),
    "The production event workflow must use the canonical under-target FILLED SELL STOP reason.")
  assert.equal(result.output.terminalSell.stopFactAppended, true,
    "The adverse FILLED SELL must durably append the account-wide STOP fact.")
  assert.equal(result.output.reservedSellCycle, null,
    "Canonical terminal accounting releases the completed order reservation while account STOP remains active.")
})

test("production RS STOP blocks new BUY spending while allowing an eligible first recovery SELL", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-stop-buy-block-sell-allowed",
    scenarioId: "RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.stopAdmissionChecks.buyAdmissionBlocked, true,
    "The BUY admission gate must remain active while STOP permits the eligible SELL.")
  assert.equal(result.output.stopAdmissionChecks.sellActionSide, "SELL",
    "The higher-price dispatch must still submit an eligible first recovery SELL.")
  assert.equal(result.output.stopAdmissionChecks.stopStateStatus, "STOPPED",
    "The STOP must remain latched after the recovery SELL is submitted.")
  assert.equal(result.output.stopAdmissionChecks.sellAdmissionBlocked, false,
    "A durably persisted RS STOP must leave the first recovery SELL gate available.")
  assert.equal(result.output.action.side, "SELL",
    "The result must contain the eligible recovery SELL action.")
  assert.equal(result.output.submitted, true,
    "The production runtime must report the simulated SELL as submitted.")
})

test("production RS runtime fails closed when terminal reconciliation persistence fails", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-terminal-reconciliation-persistence-failure",
    scenarioId: "RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.terminalSell.orderStatus, "FILLED",
    "The canonical broker terminal status must remain FILLED after persistence fails.")
  assert.equal(result.output.terminalSell.terminalReconciliationFailed, true,
    "The production accounting boundary must report its failed durable reconciliation.")
  assert.equal(result.output.terminalSell.terminalReconciled, false,
    "The runtime must not report terminal reconciliation as committed.")
  assert.equal(result.output.terminalSell.eventWorkflowFailedClosed, true,
    "The production order-event workflow must fail closed.")
  assert.equal(result.output.terminalSell.stopFactAppended, true,
    "The account STOP must be durably appended in the run-local operational store.")
  assert.equal(result.output.terminalSell.marketPaused, true,
    "The affected market must be paused after reconciliation persistence fails.")
  assert.equal(result.output.buyAdmissionBlocked, true,
    "RS BUY admission must remain blocked after the terminal reconciliation failure.")
  assert.equal(result.output.sellAdmissionBlocked, false,
    "A durable RS STOP must not block the first eligible recovery SELL.")
  assert.equal(result.output.reservedSellCycle.clientOrderId,
    result.output.terminalSell.clientOrderId,
    "The sole-SELL reservation must remain held until reconciliation commits.")
  assert.equal(result.output.terminalSell.stagedSellFillCount, 1,
    "The canonical fill must be staged once for the failed reconciliation attempt.")
})

test("production RS runtime fails closed when account STOP persistence fails after an under-target FILLED SELL", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-filled-stop-persistence-failure",
    scenarioId: "RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.terminalSell.orderStatus, "FILLED",
    "The broker terminal state must remain FILLED even when STOP persistence fails.")
  assert.equal(result.output.terminalSell.cycleState.status, "UNRESOLVED",
    "The under-target cycle must remain unresolved.")
  assert.equal(result.output.terminalSell.cycleState.terminalReconciled, true,
    "Canonical terminal accounting must complete before the STOP persistence failure is handled.")
  assert.equal(result.output.terminalSell.profitabilityEligible, false,
    "The realized profitability gates must remain failed.")
  assert.equal(result.output.terminalSell.stopFactAppended, false,
    "The simulated operational store must not claim a STOP fact was persisted.")
  assert.equal(result.output.terminalSell.stopPersistenceFailed, true,
    "The production workflow must surface that durable account STOP could not be confirmed.")
  assert.equal(result.output.terminalSell.marketPaused, true,
    "The affected market must still be paused after STOP persistence fails.")
  assert.ok(result.output.terminalSell.pauseReasons.includes("RS_TERMINAL_SELL_PROFITABILITY_STOP"),
    "The failure path must retain the canonical under-target FILLED SELL STOP reason.")
  assert.equal(result.output.terminalSell.eventWorkflowFailedClosed, true,
    "The terminal event must fail closed when account STOP persistence is unavailable.")
  assert.equal(result.output.terminalSell.sellAdmissionBlocked, true,
    "The STOP workflow must block SELL admission until the STOP fact is durably acknowledged.")
  assert.equal(result.output.terminalSell.buyAdmissionBlocked, true,
    "The STOP workflow must block new BUY spending even if durable STOP persistence fails.")
  assert.equal(result.output.terminalSell.postFailureSellAdmissionBlocked, true,
    "The production runtime must continue blocking SELL admission after persistence fails.")
  assert.equal(result.output.terminalSell.postFailureSubmittedOrderCount, 0,
    "The production runtime must submit no further orders while account STOP persistence is unresolved.")
  assert.equal(result.output.terminalSell.postFailureActionSubmitted, false,
    "The follow-up production dispatch must not create an order action.")
  assert.equal(result.output.reservedSellCycle, null,
    "The terminal reservation may be released only after canonical accounting has committed.")
})

test("production RS registry exposes the runtime scenario and keeps the helper-only mapping preliminary", () => {
  const catalog = getRecoverySellerRunnerCatalog()
  assert.deepEqual(catalog.map((scenario) => scenario.id), [
    "RS-004-011",
    "RS-RUNTIME-SELL-SUBMISSION-001",
    "RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001",
    "RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001",
    "RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001",
    "RS-RUNTIME-SELL-BROKER-EXCEPTION-001",
    "RS-RUNTIME-SELL-RESERVATION-FAILURE-001",
    "RS-RUNTIME-SELL-REJECTION-001",
    "RS-RUNTIME-SELL-PARTIAL-CANCEL-001",
    "RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001",
    "RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001",
    "RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001",
    "RS-RUNTIME-STOP-BLOCK-BUY-ALLOW-SELL-001",
  ], "The production catalog must preserve all expected RS scenario IDs and their stable order.")
  const runtimeScenario = catalog.find((scenario) => scenario.id === "RS-RUNTIME-SELL-SUBMISSION-001")
  assert.equal(runtimeScenario.executable, true,
    "Runtime-flow scenarios are eligible for isolated simulation; the host enforces launcher attestation.")
  assert.equal(runtimeScenario.executionStatus, "EXECUTABLE",
    "The scenario registration advertises simulation capability; host readiness remains authoritative.")
  assert.equal(runtimeScenario.status, "PARTIAL",
    "The runtime scenario must retain its incomplete acceptance status.")
  assert.equal(runtimeScenario.layer, "APPLICATION",
    "The production-flow scenario must be classified at the application layer.")
  assert.equal(runtimeScenario.readinessReasons.some((reason) => reason.includes("under-target FILLED SELL STOP")), false,
    "The under-target FILLED SELL STOP runtime scenario is now present in the production-flow catalogue.")
  assert.ok(runtimeScenario.readinessReasons.some((reason) => reason.includes("remaining infrastructure")),
    "Remaining infrastructure-failure coverage must stay an explicit acceptance gap.")
  assert.equal(runtimeScenario.readinessReasons.some((reason) => reason.includes("OS-level sandbox")), false,
    "Sandbox readiness is supplied by host adapter attestation, not duplicated in scenario metadata.")
  const underTargetScenario = catalog.find((scenario) =>
    scenario.id === "RS-RUNTIME-SELL-FILLED-UNDER-TARGET-001")
  assert.ok(underTargetScenario, "The under-target FILLED runtime scenario must be registered.")
  assert.equal(underTargetScenario.status, "PARTIAL",
    "The under-target FILLED SELL scenario must remain partial until all production gates are met.")
  assert.equal(underTargetScenario.executable, true,
    "Runtime scenario eligibility is for isolated simulation; host attestation controls effective readiness.")
  const terminalReconciliationFailureScenario = catalog.find((scenario) =>
    scenario.id === "RS-RUNTIME-SELL-TERMINAL-RECONCILIATION-PERSISTENCE-FAILURE-001")
  assert.ok(terminalReconciliationFailureScenario,
    "The terminal reconciliation persistence-failure scenario must be registered.")
  assert.equal(terminalReconciliationFailureScenario.status, "PARTIAL",
    "The terminal reconciliation persistence-failure scenario must remain partial until production acceptance.")
  assert.equal(terminalReconciliationFailureScenario.executable, true,
    "Terminal reconciliation failure is eligible for isolated simulation under a verified host adapter.")
  const stopFailureScenario = catalog.find((scenario) =>
    scenario.id === "RS-RUNTIME-SELL-STOP-PERSISTENCE-FAILURE-001")
  assert.ok(stopFailureScenario, "The STOP persistence-failure runtime scenario must be registered.")
  assert.equal(stopFailureScenario.status, "PARTIAL",
    "The STOP persistence-failure scenario must remain partial until all production gates are met.")
  assert.equal(stopFailureScenario.executable, true,
    "Infrastructure-failure scenarios are eligible for isolated simulation under a verified host adapter.")
  assert.equal(catalog[0].executable, false,
    "The helper-only domain mapping must not be executable in the production runtime catalogue.")
  assert.equal(catalog[0].executionStatus, "PRELIMINARY",
    "The helper-only domain mapping must retain preliminary execution status.")
})


test("production RS runtime fails closed before broker submission when SELL intent persistence fails", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-sell-intent-persistence-failure",
    scenarioId: "RS-RUNTIME-SELL-INTENT-PERSISTENCE-FAILURE-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.submissionRejected, true,
    "The production submitter must fail the SELL when its durable intent cannot be recorded.")
  assert.equal(result.output.submittedOrders.length, 0,
    "The simulated broker must not acknowledge an order whose intent was not durably recorded.")
  assert.equal(result.output.brokerSubmissionCallCount, 0,
    "The broker port must not be called before durable submission intent succeeds.")
  assert.equal(result.output.stopFactAppended, true,
    "An unresolved SELL submission must latch the run-local account STOP.")
  assert.equal(result.output.reservedSellCycle, null,
    "A SELL cycle must not be reserved before durable submission intent succeeds.")
  assert.equal(result.output.buyAdmissionBlocked, true,
    "Failed intent persistence must keep RS BUY admission blocked.")
  assert.equal(result.output.sellAdmissionBlocked, false,
    "After durable STOP acknowledgement, the first recovery SELL remains eligible.")
})


test("production RS runtime fails closed when broker acknowledgement outcome persistence fails", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-sell-outcome-persistence-failure",
    scenarioId: "RS-RUNTIME-SELL-OUTCOME-PERSISTENCE-FAILURE-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.submissionRejected, true,
    "The submitter must not report success when the broker acknowledgement outcome is not durably recorded.")
  assert.equal(result.output.brokerSubmissionCallCount, 1,
    "The simulated broker must be called once before the outcome persistence failure.")
  assert.ok(result.output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_INTENT"),
    "The immutable SELL intent must be persisted before broker placement.")
  assert.equal(result.output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_OUTCOME"), false,
    "The failed outcome append must not appear as a durable fact.")
  assert.equal(result.output.stopFactAppended, true,
    "An acknowledged-but-unconfirmed submission must latch the run-local account STOP.")
  assert.notEqual(result.output.reservedSellCycle, null,
    "The sole-SELL reservation must remain retained while the submission outcome is unresolved.")
  assert.equal(result.output.buyAdmissionBlocked, true,
    "RS BUY admission must remain blocked while broker outcome persistence is unresolved.")
  assert.equal(result.output.sellAdmissionBlocked, false,
    "A durably persisted STOP leaves the first recovery SELL gate available.")
})


test("production RS runtime keeps account admission blocked when both outcome and STOP persistence fail", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-sell-outcome-and-stop-persistence-failure",
    scenarioId: "RS-RUNTIME-SELL-OUTCOME-AND-STOP-PERSISTENCE-FAILURE-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.submissionRejected, true,
    "The submitter must fail closed when both outcome and STOP persistence are unavailable.")
  assert.equal(result.output.brokerSubmissionCallCount, 1,
    "The simulated broker must be called once before both persistence failures.")
  assert.ok(result.output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_INTENT"),
    "The durable SELL intent must exist before the broker side effect.")
  assert.equal(result.output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_OUTCOME"), false,
    "The failed outcome append must not be reported as durable.")
  assert.equal(result.output.stopFactAppended, false,
    "The failed STOP append must not be reported as durable.")
  assert.notEqual(result.output.reservedSellCycle, null,
    "The SELL reservation must remain retained while broker outcome and STOP persistence are unresolved.")
  assert.equal(result.output.buyAdmissionBlocked, true,
    "The in-memory RS BUY latch must stay active despite STOP persistence failure.")
  assert.equal(result.output.sellAdmissionBlocked, true,
    "The in-memory RS SELL latch must stay active while STOP persistence is unresolved.")
})


test("production RS runtime persists UNKNOWN and blocks BUY admission after broker placement throws", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-sell-broker-exception",
    scenarioId: "RS-RUNTIME-SELL-BROKER-EXCEPTION-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.submissionRejected, true,
    "A thrown broker transport error must remain an unresolved submission, not success.")
  assert.equal(result.output.brokerSubmissionCallCount, 1,
    "The simulated broker placement port must be invoked exactly once.")
  assert.ok(result.output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_INTENT"),
    "The durable SELL intent must precede the broker placement attempt.")
  assert.ok(result.output.simulationFacts.some((fact) =>
    fact.factType === "ORDER_SUBMISSION_OUTCOME" && fact.data?.outcome === "UNKNOWN"),
    "The ambiguous broker response must be durably classified UNKNOWN.")
  assert.equal(result.output.stopFactAppended, true,
    "An ambiguous broker outcome must latch the account STOP.")
  assert.notEqual(result.output.reservedSellCycle, null,
    "The sole-SELL reservation must remain held pending reconciliation.")
  assert.equal(result.output.buyAdmissionBlocked, true,
    "RS BUY admission must remain blocked after the broker transport exception.")
  assert.equal(result.output.sellAdmissionBlocked, false,
    "A durably persisted STOP must leave the first recovery SELL gate available.")
})


test("production RS runtime fails closed when sole-SELL reservation callback fails", async () => {
  const result = await executeRecoverySellerRuntimeScenario({
    runId: "run-rs-runtime-sell-reservation-failure",
    scenarioId: "RS-RUNTIME-SELL-RESERVATION-FAILURE-001",
    input: {
      marketPrice: "12.3",
    },
  })

  assert.equal(result.passed, true, JSON.stringify(result.assertions))
  assert.equal(result.output.submissionRejected, true,
    "The production submitter must reject when the sole-SELL reservation callback fails.")
  assert.ok(result.output.simulationFacts.some((fact) => fact.factType === "ORDER_SUBMISSION_INTENT"),
    "The immutable SELL intent must be recorded before reservation.")
  assert.equal(result.output.brokerSubmissionCallCount, 0,
    "The broker must not be called unless the sole-SELL reservation is accepted.")
  assert.equal(result.output.reservedSellCycle, null,
    "The failed reservation callback must not leave a cycle reservation.")
  assert.equal(result.output.stopFactAppended, true,
    "Reservation failure must latch account STOP.")
  assert.equal(result.output.buyAdmissionBlocked, true,
    "RS BUY admission must remain blocked after reservation failure.")
  assert.equal(result.output.sellAdmissionBlocked, false,
    "A durable STOP must leave the first recovery SELL gate available.")
})
