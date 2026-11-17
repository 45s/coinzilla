import test from "node:test"
import assert from "node:assert/strict"
import { evaluateRecoverySellerBuyDecision } from "./evaluate-buy-decision.js"
import {
  createRecoverySellerStopDecision,
  createRecoverySellerStopState,
  latchRecoverySellerStop,
} from "./stop-decision.js"

const marketPrice = {
  symbol: "ZROUSDT",
  price: "2",
}

const pairConfig = {
  orderQuantity: "5",
  priceStepPercent: "0.05",
  investment: "100",
}

const marketMetadata = {
  market: {
    id: "binance:ZROUSDT",
    symbol: "ZROUSDT",
  },
  orderType: "LIMIT_MAKER",
  tradingRules: {
    constraints: [
      { type: "PRICE_INCREMENT", status: "SUPPORTED", value: { amount: "0.001" } },
      { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: { amount: "0.01" } },
      { type: "MIN_QUANTITY", status: "SUPPORTED", value: { amount: "0.01" } },
      { type: "MIN_NOTIONAL", status: "SUPPORTED", value: { amount: "5" } },
      { type: "MAX_QUANTITY", status: "SUPPORTED", value: { amount: "100" } },
      { type: "MAX_NOTIONAL", status: "SUPPORTED", value: { amount: "1000" } },
      { type: "MIN_PRICE", status: "SUPPORTED", value: { amount: "0.001" } },
      { type: "MAX_PRICE", status: "SUPPORTED", value: { amount: "100" } },
    ],
  },
}

function evaluate(overrides = {}) {
  return evaluateRecoverySellerBuyDecision({
    stopState: createRecoverySellerStopState(),
    marketPrice,
    pairConfig,
    marketMetadata,
    activeOrders: [],
    cumulativeNetSellProceeds: "0",
    pendingBuyCommitment: "0",
    ...overrides,
  })
}

test("plans the initial BUY using Conservative cadence, tranche size and downward tick rounding", () => {
  const result = evaluate()

  assert.equal(result.decision.outcome, "SUBMIT",
    "An eligible initial RS tranche must produce a pure SUBMIT decision.")
  assert.deepEqual(result.action, {
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "1.999",
    quantity: "5",
    notional: "9.995",
    reason: "INITIAL_BUY",
  }, "The initial tranche must reuse the established percentage-below-market BUY price and configured orderQuantity.")
  assert.equal(result.stopState.status, "CLEAR",
    "A valid BUY plan must not create a global STOP.")
})

test("prices the next tranche from the reconciled completed-BUY VWAP, not the current market price", () => {
  const result = evaluate({
    marketPrice: {
      ...marketPrice,
      price: "2.5",
    },
    recoveryPosition: {
      spent: "20",
    },
    lastBuyPrice: "2.1",
  })

  assert.equal(result.action.price, "2.098",
    "The next standing BUY must use the last completed BUY VWAP and Conservative downward tick rounding.")
  assert.equal(result.action.reason, "NEXT_STANDING_BUY",
    "An existing recovery Position must be distinguished from the initial tranche.")
})

test("blocks the next BUY when the RS per-pair investment limit would be exceeded", () => {
  const result = evaluate({
    pairConfig: {
      ...pairConfig,
      investment: "15",
    },
    recoveryPosition: {
      spent: "10",
    },
    lastBuyPrice: "2",
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "The RS investment limit must block only a new BUY intent.")
  assert.equal(result.decision.reasonCode, "INVESTMENT_LIMIT_REACHED",
    "Investment-limit blocks must have a stable policy reason.")
  assert.equal(result.action, undefined,
    "No BUY action may be returned after the strategy's own investment budget is exhausted.")
  assert.equal(result.stopState.status, "CLEAR",
    "A normal configured investment limit is not an unexpected global STOP.")
})

test("latches STOP when a BUY commitment exists without an identifiable active order", () => {
  const result = evaluate({
    pendingBuyCommitment: "5",
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "An orphaned BUY commitment must not be ignored or treated as free investment capacity.")
  assert.equal(result.stopState.status, "STOPPED",
    "A committed quote amount without its canonical order identity is an unmodeled lifecycle condition.")
  assert.equal(result.action, undefined,
    "No additional BUY may be planned while an unowned commitment remains unresolved.")
})

test("waits for an existing acknowledged RS order instead of creating a duplicate BUY", () => {
  const result = evaluate({
    activeOrders: [{
      market: { symbol: "ZROUSDT" },
      side: "BUY",
      status: "PARTIALLY_FILLED",
      clientOrderId: "rs-buy-1",
      brokerOrderId: "exchange-1",
    }],
  })

  assert.equal(result.decision.outcome, "WAIT",
    "An acknowledged active RS order must suppress another BUY until its authoritative update.")
  assert.deepEqual(result.decision.orderIdentity, {
    clientOrderId: "rs-buy-1",
    brokerOrderId: "exchange-1",
  }, "The wait decision must retain both canonical order identities.")
  assert.equal(result.action, undefined,
    "An active order must never produce a duplicate action.")
})

test("latches STOP and reconciles the original identity for an unknown or unacknowledged RS order", () => {
  const result = evaluate({
    activeOrders: [{
      market: { symbol: "ZROUSDT" },
      side: "BUY",
      status: "UNKNOWN",
      clientOrderId: "rs-buy-unknown",
    }],
  })

  assert.equal(result.stopState.status, "STOPPED",
    "An unknown submission outcome must latch global STOP before any later BUY.")
  assert.equal(result.stopDecision.outcome, "BLOCK",
    "The global STOP must block every new trading action.")
  assert.equal(result.decision.outcome, "RECONCILE",
    "The original unresolved order must remain eligible for non-trading reconciliation.")
  assert.deepEqual(result.decision.orderIdentity, {
    clientOrderId: "rs-buy-unknown",
  }, "Reconciliation must retain the original client identity without inventing a broker identity.")
  assert.equal(result.action, undefined,
    "Unknown submission must never produce a replacement BUY.")
})

test("keeps a previously latched STOP sticky and returns no new BUY action", () => {
  const originalStop = createRecoverySellerStopDecision({
    explanation: "The prior SELL execution has an unmodeled terminal result",
  })
  const stopState = latchRecoverySellerStop({
    state: createRecoverySellerStopState(),
    decision: originalStop,
  })
  const result = evaluate({
    stopState,
  })

  assert.equal(result.stopState.decision, originalStop,
    "A later normal BUY evaluation must not replace the first STOP evidence.")
  assert.equal(result.decision, originalStop,
    "A latched STOP must remain the lifecycle decision while no existing order requires reconciliation.")
  assert.equal(result.action, undefined,
    "A later market event must not resume trading after STOP.")
})

test("returns an ordinary BLOCK for an exchange-filter-constrained BUY", () => {
  const result = evaluate({
    marketMetadata: {
      ...marketMetadata,
      tradingRules: {
        constraints: marketMetadata.tradingRules.constraints.map((rule) =>
          rule.type === "MIN_NOTIONAL"
            ? { ...rule, value: { amount: "20" } }
            : rule),
      },
    },
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "A known exchange minimum-notional constraint must block the candidate without inventing a global STOP.")
  assert.equal(result.decision.reasonCode, "BUY_EXCHANGE_FILTER_REJECTED",
    "Exchange-filter blocks must expose a stable reason.")
  assert.equal(result.buyDisposition.reason, "MIN_NOTIONAL",
    "The exact exchange filter that blocked the order must remain visible.")
  assert.equal(result.stopState.status, "CLEAR",
    "A normal filter deferral must not latch global STOP.")
})

test("fails closed with global STOP when an active recovery Position lacks its reconciled BUY VWAP", () => {
  const result = evaluate({
    recoveryPosition: {
      spent: "20",
    },
  })

  assert.equal(result.decision.outcome, "BLOCK",
    "Missing completed-BUY VWAP must not fall back to a potentially misleading market price.")
  assert.equal(result.stopState.status, "STOPPED",
    "An active Position with missing required pricing evidence must latch global STOP.")
  assert.equal(result.action, undefined,
    "No BUY may be submitted without the authoritative completed-BUY VWAP.")
})
