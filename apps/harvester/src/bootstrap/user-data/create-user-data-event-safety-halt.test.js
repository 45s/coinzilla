import nodeTest from "node:test"
import assert from "node:assert/strict"
import { Asset, Commission, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { RecoveryLedger } from "../../domain/strategies/conservative/recovery-ledger.js"
import { updateTradingAccounting } from "../../use-cases/update-trading-accounting.js"
import { createUserDataEventHandler } from "./create-user-data-event-handler.js"
import { createAccountIntegritySafetyHalt } from "../../use-cases/create-account-integrity-safety-halt.js"

const test = (...args) => nodeTest(
  `[create-user-data-event-safety-halt.test.js] ${args[0]}`,
  ...args.slice(1),
)

function createState() {
  return {
    ready: false,
    initialAccountSnapshotReady: true,
    requiresReconciliation: false,
    accountingFailed: false,
    retryableRecoveryFailure: null,
    recoveryGeneration: 0,
    status: "INITIAL_ACCOUNT_SNAPSHOT_PENDING",
    eventQueue: Promise.resolve(),
    eventSequence: 0,
    intakeStopped: false,
  }
}

const adaBaseAsset = new Asset({
  id: "ada",
  code: "ADA",
})
const usdtQuoteAsset = new Asset({
  id: "usdt",
  code: "USDT",
})
const adaMarket = new Market({
  venue: "binance",
  symbol: "ADAUSDT",
  baseAsset: adaBaseAsset,
  quoteAsset: usdtQuoteAsset,
})

function createAdaFill({
  tradeId,
  side,
  price,
  quantity,
  quoteQuantity,
  commissionAmount,
  commissionAsset,
}) {
  return new Fill({
    tradeId,
    brokerOrderId: `ada-order-${tradeId}`,
    clientOrderId: `ada-client-${tradeId}`,
    market: adaMarket,
    side,
    price: new Money({
      amount: price,
      asset: usdtQuoteAsset,
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: adaBaseAsset,
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: usdtQuoteAsset,
    }),
    commissions: [
      new Commission({
        amount: new Money({
          amount: commissionAmount,
          asset: commissionAsset,
        }),
      }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function createInitialAdaAccounting() {
  const result = updateTradingAccounting({
    portfolio: new Portfolio(),
    recoveryLedger: RecoveryLedger.empty({ market: adaMarket }),
    fill: createAdaFill({
      tradeId: "145912",
      side: "BUY",
      price: "0.144",
      quantity: "50",
      quoteQuantity: "7.2",
      commissionAmount: "0.05",
      commissionAsset: adaBaseAsset,
    }),
  })
  assert.equal(result.ok, true, "The archived ADA BUY must seed real accounting projections.")
  return result.data
}

function createAccountingState({ portfolio, recoveryLedger }) {
  let currentPortfolio = portfolio
  let currentRecoveryLedger = recoveryLedger
  const appliedFillIds = new Set()
  const applyFill = (fill) => {
    const result = updateTradingAccounting({
      portfolio: currentPortfolio,
      recoveryLedger: currentRecoveryLedger,
      fill,
    })
    if (result.ok) {
      currentPortfolio = result.data.portfolio
      currentRecoveryLedger = result.data.recoveryLedger
      if (result.data.applied) {
        appliedFillIds.add(fill.id)
      }
    }
    return result
  }
  return {
    applyFill,
    appliedFillIds,
    getPortfolio: () => currentPortfolio,
    getRecoveryLedger: () => currentRecoveryLedger,
  }
}

function createRetryableHistoryFailure() {
  return {
    ok: false,
    errors: [],
    failure: {
      category: "REST_RECONCILIATION",
      stage: "REST_STREAM_RECONCILIATION_FAILED",
      retryable: true,
    },
  }
}

function createAccountingFailure(result) {
  return {
    ok: false,
    errors: result.errors,
    failure: {
      category: "ACCOUNTING_INTEGRITY",
      stage: "LATE_SELL_ACCOUNTING_FAILED",
      retryable: false,
    },
  }
}

function createEngineHarness({ accounting }) {
  const calls = []
  let firstEvent = true
  const processUserDataEvent = async ({ event, recoveryMode }) => {
    calls.push({ type: "process", fillId: event.fill?.id, recoveryMode })
    if (firstEvent) {
      firstEvent = false
      return createRetryableHistoryFailure()
    }
    const result = accounting.applyFill(event.fill)
    if (!result.ok) {
      return createAccountingFailure(result)
    }
    return {
      ok: true,
      data: {
        reevaluate: false,
        duplicate: result.data.duplicate,
      },
    }
  }
  const engine = {
    processUserDataEvent,
    getOrders: () => [],
    reconcileOwnedOrders: async (options) => {
      calls.push({ type: "reconcile", options })
      return { ok: true }
    },
    cancelOwnedBuyOrdersForSafetyHalt: async () => {
      calls.push({ type: "cancel-owned-buys" })
      return { ok: true }
    },
  }
  return {
    engine,
    calls,
  }
}

function createSafetyHaltHandler({ state, engine, calls, observedFillIds, accounting }) {
  const cancelOwnedBuysAfterAccountingFailure = createAccountIntegritySafetyHalt({
    getTradingEngine: () => engine,
    logger: {},
  })
  return createUserDataEventHandler({
    state,
    getTradingEngine: () => engine,
    isTradingEnabled: () => true,
    isStopped: () => false,
    logger: { error() {} },
    onUserDataEvent: async ({ event }) => {
      observedFillIds.push(event.fill?.id)
    },
    getPortfolio: accounting.getPortfolio,
    getRecoveryLedger: () => accounting.getRecoveryLedger(),
    updatePortfolio: () => ({ ok: true }),
    updateTradingAccounting: ({ fill }) => accounting.applyFill(fill),
    cancelOwnedBuysAfterAccountingFailure,
    resumeDeferredStrategyEvaluations: () => calls.push({ type: "resume" }),
  })
}

function createLateAdaSellEvent({ fill }) {
  return {
    eventType: "executionReport",
    executionType: "TRADE",
    executedOrder: {
      market: adaMarket,
      brokerOrderId: fill.brokerOrderId,
      clientOrderId: fill.clientOrderId,
      side: "SELL",
      status: "FILLED",
    },
    fill,
  }
}

function assertInitialSafetyHalt({ state, calls, observedFillIds, sellFill }) {
  assert.deepEqual(
    calls.slice(0, 3),
    [
      { type: "process", fillId: sellFill.id, recoveryMode: true },
      { type: "reconcile", options: { recoveryMode: true } },
      { type: "cancel-owned-buys" },
    ],
    "A reconciliation failure must enter recovery mode, reconcile authoritative state, then cancel current-process-owned BUYs.",
  )
  assert.equal(state.ready, false, "Readiness must remain closed while authoritative reconciliation is required.")
  assert.equal(state.requiresReconciliation, true, "The safety halt must retain the required reconciliation state.")
  assert.equal(state.accountingFailed, false, "A retryable REST reconciliation failure must not be mislabeled as an accounting-integrity failure.")
  assert.equal(state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "The safety halt must expose the authoritative-reconciliation-required state.")
  assert.deepEqual(observedFillIds, [], "The failed first delivery must not be published as an accepted user-data event.")
}

function assertLateSellAccounting({ accounting, sellFill, appliedFillIds, observedFillIds, portfolioAfterSell, ledgerAfterSell }) {
  assert.deepEqual([...appliedFillIds], [sellFill.id], "The same late SELL Fill must be committed to both projections exactly once.")
  assert.deepEqual(
    observedFillIds,
    [sellFill.id, sellFill.id],
    "The late SELL report must be observed on each accepted recovery-mode delivery.",
  )
  const position = accounting.getPortfolio().getPosition({ marketId: adaMarket.id })
  const recoveryLedger = accounting.getRecoveryLedger()
  assert.equal(position.baseQuantity.amount, "0.05", "Portfolio must retain the exact ADA quantity after base-fee BUY and quote-fee SELL.")
  assert.equal(position.spent.amount, "7.2", "Portfolio cost basis must retain the archived BUY quote quantity.")
  assert.equal(position.quoteNetCashFlow.amount, "0.05318955", "Portfolio must report exact realized net quote cash flow.")
  assert.equal(recoveryLedger.buyCost, "7.2", "RecoveryLedger BUY basis must match Portfolio Position.spent.")
  assert.equal(recoveryLedger.netSellProceeds, "7.25318955", "RecoveryLedger must deduct the actual quote-asset SELL commission.")
  assert.equal(recoveryLedger.realizedNetProfit, "0.05318955", "RecoveryLedger realized profit must match Portfolio cash flow.")
  assert.equal(recoveryLedger.outstandingRecoveryAmount, "0", "The late SELL must satisfy the recovery basis without resetting the safety pause.")
  assert.equal(accounting.getPortfolio(), portfolioAfterSell, "Duplicate delivery must not replace or mutate the committed Portfolio projection.")
  assert.equal(accounting.getRecoveryLedger(), ledgerAfterSell, "Duplicate delivery must not replace or mutate the committed RecoveryLedger projection.")
}

function assertSafetyHaltRemainsLatched({ state, calls }) {
  assert.equal(state.ready, false, "Readiness must remain closed while authoritative reconciliation is required.")
  assert.equal(state.requiresReconciliation, true, "The safety halt must retain the required reconciliation state.")
  assert.equal(state.status, "AUTHORITATIVE_RECONCILIATION_REQUIRED", "The safety halt must expose the authoritative-reconciliation-required state.")
  assert.equal(calls.filter((call) => call.type === "reconcile").length, 1, "The initial safety halt must perform one authoritative reconciliation attempt.")
  assert.equal(calls.filter((entry) => entry.type === "cancel-owned-buys").length, 1, "The safety halt must cancel owned BUYs once and must not recursively retry cancellation.")
  assert.equal(calls.some((call) => call.type === "resume"), false, "A late SELL fill must not reopen deferred BUY evaluation while readiness is closed.")
}

test("routes REST/stream reconciliation failures through the account safety halt and applies a late SELL once to real projections", async () => {
  const state = createState()
  const accounting = createAccountingState(createInitialAdaAccounting())
  const { engine, calls } = createEngineHarness({ accounting })
  const observedFillIds = []
  const handler = createSafetyHaltHandler({
    state,
    engine,
    calls,
    observedFillIds,
    accounting,
  })
  const sellFill = createAdaFill({
    tradeId: "145942",
    side: "SELL",
    price: "0.1455",
    quantity: "49.9",
    quoteQuantity: "7.26045",
    commissionAmount: "0.00726045",
    commissionAsset: usdtQuoteAsset,
  })
  const event = createLateAdaSellEvent({ fill: sellFill })

  handler({ event })
  await state.eventQueue
  assertInitialSafetyHalt({
    state,
    calls,
    observedFillIds,
    sellFill,
  })

  handler({ event })
  await state.eventQueue
  const portfolioAfterSell = accounting.getPortfolio()
  const ledgerAfterSell = accounting.getRecoveryLedger()
  handler({ event })
  await state.eventQueue

  const recoveryModeProcessCalls = calls
    .filter((call) => call.type === "process")
    .slice(1)
  assert.deepEqual(
    recoveryModeProcessCalls.map((call) => call.recoveryMode),
    [true, true],
    "Both later deliveries must continue through recovery-mode processing.",
  )
  assertLateSellAccounting({
    accounting,
    sellFill,
    appliedFillIds: accounting.appliedFillIds,
    observedFillIds,
    portfolioAfterSell,
    ledgerAfterSell,
  })
  assertSafetyHaltRemainsLatched({
    state,
    calls,
  })
})
