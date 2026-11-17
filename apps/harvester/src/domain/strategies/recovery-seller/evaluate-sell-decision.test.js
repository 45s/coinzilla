import test from "node:test"
import assert from "node:assert/strict"
import { evaluateRecoverySellerSellDecision } from "./evaluate-sell-decision.js"
import {
  createRecoverySellerCycleState,
  reconcileRecoverySellerCycleSell,
  recordRecoverySellerCycleSellSubmission,
} from "./cycle-state.js"
import { createRecoverySellerStopState } from "./stop-decision.js"

const marketPrice = {
  symbol: "ZROUSDT",
  price: "2",
}

const pairConfig = {
  sellQuantity: "0.01",
  minProfit: "0.01",
}

const marketMetadata = {
  market: {
    id: "binance:ZROUSDT",
    symbol: "ZROUSDT",
  },
  orderType: "LIMIT_MAKER",
  tradingRules: {
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: { amount: "0.01" } },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: { amount: "0.01" } },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: { amount: "0.01" } },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: { amount: "5" } },
      { type: "MAX_QUANTITY", status: "SUPPORTED", value: { amount: "100" } },
      { type: "MAX_NOTIONAL", status: "SUPPORTED", value: { amount: "1000" } },
      { type: "MIN_PRICE", status: "SUPPORTED", value: { amount: "0.01" } },
      { type: "MAX_PRICE", status: "SUPPORTED", value: { amount: "100" } },
    ],
  },
}

function evaluate(overrides = {}) {
  return evaluateRecoverySellerSellDecision({
    stopState: createRecoverySellerStopState(),
    marketPrice,
    pairConfig,
    marketMetadata,
    cycleState: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    activeOrders: [],
    recoveryQuantity: "1",
    recoveryCostBasis: "10",
    legacyRemainingQuantity: "0.01",
    verifiedUnreservedLegacyQuantity: "0.01",
    legacyAverageCost: "20",
    quoteFeeRate: "0.01",
    baseFeeRate: "0",
    thirdAssetFeeQuoteValue: "0",
    strategyStopped: false,
    marketPaused: false,
    reconciliationComplete: true,
    sellClientOrderId: "rs-sell-1",
    ...overrides,
  })
}

test("plans the one mixed SELL using actual recovery quantity plus the authorized legacy slice", () => {
  const result = evaluate()

  assert.equal(result.decision.outcome, "SUBMIT",
    "An eligible mixed cycle SELL must produce one pure SUBMIT decision.")
  assert.deepEqual(result.action, {
    side: "SELL",
    type: "LIMIT_MAKER",
    price: "10.22",
    quantity: "1.01",
    notional: "10.3222",
    clientOrderId: "rs-sell-1",
    reason: "MIXED_RECOVERY_AND_LEGACY_CYCLE_SELL",
    requiredNetQuoteProceeds: "10.21",
  }, "The SELL intent must use the fee-aware combined cost-recovery plus minProfit plan.")
  assert.equal(result.cycleState.status, "SELL_SUBMITTED",
    "The sole SELL identity must be latched in cycle state before broker I/O.")
  assert.deepEqual(result.cycleState.sellOrderIdentity, {
    clientOrderId: "rs-sell-1",
  }, "The cycle must retain the original client order identity.")
  assert.equal(result.stopState.status, "CLEAR",
    "A valid SELL plan must not create global STOP.")
})

test("plans recovery-only SELL after authorized legacy inventory is exhausted", () => {
  const result = evaluate({
    legacyRemainingQuantity: "0",
    verifiedUnreservedLegacyQuantity: "0",
  })

  assert.equal(result.decision.outcome, "SUBMIT",
    "A recovery-only cycle remains eligible after legacy exhaustion.")
  assert.equal(result.action.quantity, "1",
    "The recovery-only SELL must use actual net recovery inventory without adding legacy quantity.")
  assert.equal(result.action.requiredNetQuoteProceeds, "10.11",
    "The recovery-only SELL must still recover the tranche cost and minProfit after quote-fee allowance.")
  assert.equal(result.cycleState.status, "SELL_SUBMITTED",
    "Recovery-only cycles retain the same one-SELL-per-cycle state contract.")
})

test("uses the smaller verified unreserved legacy remainder without exceeding authorization", () => {
  const result = evaluate({
    pairConfig: {
      ...pairConfig,
      sellQuantity: "0.05",
    },
    legacyRemainingQuantity: "0.01",
    verifiedUnreservedLegacyQuantity: "0.01",
  })

  assert.equal(result.decision.outcome, "SUBMIT",
    "A smaller positive remainder may be included when all planning gates pass.")
  assert.equal(result.action.quantity, "1.01",
    "The smaller authorized legacy remainder must be included without rounding its base debit upward.")
})

test("waits for an existing acknowledged BUY before planning the cycle SELL", () => {
  const result = evaluate({
    activeOrders: [{
      market: { symbol: "ZROUSDT" },
      side: "BUY",
      status: "PARTIALLY_FILLED",
      clientOrderId: "rs-buy-1",
      brokerOrderId: "exchange-buy-1",
    }],
  })

  assert.equal(result.decision.outcome, "WAIT",
    "A cycle SELL must not be planned while a recovery BUY remains active.")
  assert.equal(result.decision.orderIdentity.clientOrderId, "rs-buy-1",
    "The WAIT decision must preserve the active BUY identity.")
  assert.equal(result.action, undefined,
    "An active BUY must suppress SELL submission.")
  assert.equal(result.cycleState.status, "ACCUMULATING",
    "The cycle must not reserve its sole SELL before the BUY lifecycle is reconciled.")
})

test("latches STOP and reconciles an unknown existing BUY instead of planning a SELL", () => {
  const result = evaluate({
    activeOrders: [{
      market: { symbol: "ZROUSDT" },
      side: "BUY",
      status: "UNKNOWN",
      clientOrderId: "rs-buy-unknown",
    }],
  })

  assert.equal(result.stopState.status, "STOPPED",
    "An unknown BUY submission must latch global STOP.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "The unknown BUY must remain eligible for non-trading reconciliation.")
  assert.equal(result.decision.orderIdentity.clientOrderId, "rs-buy-unknown",
    "The original BUY identity must be retained.")
  assert.equal(result.action, undefined,
    "No SELL may be planned while the BUY outcome is unknown.")
})

test("waits on the cycle's already-submitted SELL and never creates a replacement", () => {
  const cycleState = recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    orderIdentity: { clientOrderId: "rs-sell-1" },
  })
  const result = evaluate({
    cycleState,
    activeOrders: [{
      market: { symbol: "ZROUSDT" },
      side: "SELL",
      status: "PARTIALLY_FILLED",
      clientOrderId: "rs-sell-1",
      brokerOrderId: "exchange-sell-1",
    }],
  })

  assert.equal(result.decision.outcome, "WAIT",
    "The sole active cycle SELL must remain untouched until terminal reconciliation.")
  assert.equal(result.decision.orderIdentity.clientOrderId, "rs-sell-1",
    "The WAIT decision must preserve the original SELL identity.")
  assert.equal(result.action, undefined,
    "A second SELL or replacement SELL must never be emitted.")
  assert.equal(result.cycleState, cycleState,
    "Waiting must preserve the original cycle state and reservation.")
})

test("latches STOP and reconciles when the cycle records a SELL absent from active orders", () => {
  const cycleState = recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    orderIdentity: { clientOrderId: "rs-sell-1" },
  })
  const result = evaluate({
    cycleState,
    activeOrders: [],
  })

  assert.equal(result.stopState.status, "STOPPED",
    "A submitted cycle SELL without an authoritative active/terminal result is an unmodeled condition.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "The missing SELL order must be resolved by its original identity.")
  assert.equal(result.decision.orderIdentity.clientOrderId, "rs-sell-1",
    "The cycle's original SELL identity must survive.")
  assert.equal(result.action, undefined,
    "No replacement SELL may be planned.")
})

test("blocks a SELL when the operator has stopped RS or the market/reconciliation is not ready", () => {
  const operatorStopped = evaluate({
    strategyStopped: true,
  })
  const marketPaused = evaluate({
    marketPaused: true,
  })
  const reconciliationIncomplete = evaluate({
    reconciliationComplete: false,
  })

  assert.equal(operatorStopped.decision.reasonCode, "STRATEGY_STOPPED",
    "An operator stop must block a new SELL without canceling an existing order.")
  assert.equal(marketPaused.decision.reasonCode, "MARKET_PAUSED",
    "A paused market must block a new SELL.")
  assert.equal(reconciliationIncomplete.decision.reasonCode, "RECONCILIATION_INCOMPLETE",
    "Incomplete canonical order/fill/inventory/reservation reconciliation must block a new SELL.")
  assert.equal(operatorStopped.cycleState.status, "ACCUMULATING",
    "A blocked SELL must not consume the cycle's sole SELL allowance.")
})

test("blocks exchange-filter violations instead of capping, splitting or misclassifying dust", () => {
  const result = evaluate({
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "MAX_QUANTITY"
            ? { ...rule, value: { amount: "1" } }
            : rule),
      },
    },
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "The one-SELL-per-cycle contract must not silently cap or split a filter-violating order.")
  assert.equal(result.decision.reasonCode, "SELL_EXCHANGE_FILTER_REJECTED",
    "The exchange-filter refusal must have a stable reason.")
  assert.equal(result.sellDisposition.reason, "MAX_QUANTITY",
    "The exact limiting exchange rule must remain visible.")
  assert.equal(result.cycleState.status, "ACCUMULATING",
    "A blocked SELL must not be recorded as submitted.")
})

test("fails closed when required fee valuation or verified legacy Spot availability is missing", () => {
  const missingThirdAssetValue = evaluate({
    thirdAssetFeeQuoteValue: undefined,
  })
  const missingLegacySpot = evaluate({
    verifiedUnreservedLegacyQuantity: "0",
  })

  assert.equal(missingThirdAssetValue.stopState.status, "STOPPED",
    "A missing third-asset quote valuation must never be treated as zero.")
  assert.equal(missingLegacySpot.stopState.status, "STOPPED",
    "Authorized legacy inventory with no verified unreserved Spot quantity must fail closed.")
  assert.equal(missingThirdAssetValue.action, undefined,
    "No SELL may be submitted with incomplete fee valuation.")
  assert.equal(missingLegacySpot.action, undefined,
    "No SELL may be submitted against unverified or reserved legacy custody.")
})

test("does not submit a second SELL from an unresolved or closed cycle", () => {
  const submitted = recordRecoverySellerCycleSellSubmission({
    state: createRecoverySellerCycleState({ cycleId: "rs-cycle-1" }),
    orderIdentity: { clientOrderId: "rs-sell-1" },
  })
  const unresolved = reconcileRecoverySellerCycleSell({
    state: submitted,
    orderIdentity: { clientOrderId: "rs-sell-1" },
    terminalOrderStatus: "CANCELED",
    reconciliationComplete: true,
    profitabilityEligible: false,
  })
  const result = evaluate({
    cycleState: unresolved,
  })

  assert.equal(result.decision.reasonCode, "CYCLE_UNRESOLVED",
    "An unresolved terminal SELL must block every new SELL attempt.")
  assert.equal(result.action, undefined,
    "No second SELL may be submitted after the cycle's sole SELL became unresolved.")
})
