import assert from "node:assert/strict"
import test from "node:test"
import {
  validateOrderCancellationIntentFact,
  validateOrderCancellationOutcomeFact,
  validateOrderSubmissionIntentFact,
  validateOrderSubmissionOutcomeFact,
} from "./validate-operational-state-order-facts.js"

const MARKET_ID = "binance:BTCUSDT"
const COMMON_ORDER_FIELDS = {
  marketId: MARKET_ID,
  venue: "binance",
  symbol: "BTCUSDT",
  baseAssetId: "binance:BTC",
  quoteAssetId: "binance:USDT",
  side: "BUY",
  type: "LIMIT",
}

function makeSubmissionIntent(overrides = {}) {
  const clientOrderId = "client-order-1"
  return {
    factType: "ORDER_SUBMISSION_INTENT",
    factId: `order-submission-intent:${clientOrderId}`,
    canonicalData: {
      clientOrderId,
      ...COMMON_ORDER_FIELDS,
      price: "100",
      quantity: "2",
      purpose: null,
      ...overrides,
    },
  }
}

function makeSubmissionOutcome(overrides = {}) {
  const clientOrderId = "client-order-1"
  return {
    factType: "ORDER_SUBMISSION_OUTCOME",
    factId: `order-submission-outcome:${clientOrderId}:${overrides.outcome ?? "REJECTED"}`,
    canonicalData: {
      clientOrderId,
      ...COMMON_ORDER_FIELDS,
      price: "100",
      quantity: "2",
      executedQuantity: "0",
      purpose: null,
      outcome: "REJECTED",
      brokerOrderId: null,
      status: "PENDING",
      ...overrides,
    },
  }
}

function makeCancellationIntent(overrides = {}) {
  const clientOrderId = "client-order-1"
  const reason = overrides.reason ?? "OPERATOR_REQUESTED"
  const status = overrides.status ?? "PARTIALLY_FILLED"
  const executedQuantity = overrides.executedQuantity ?? "0.5"
  return {
    factType: "ORDER_CANCELLATION_INTENT",
    factId: `order-cancellation-intent:${clientOrderId}:${reason}:${status}:${executedQuantity}`,
    canonicalData: {
      clientOrderId,
      brokerOrderId: "broker-order-1",
      ...COMMON_ORDER_FIELDS,
      price: "100",
      quantity: "2",
      executedQuantity,
      reason,
      status,
      ...overrides,
    },
  }
}

function makeCancellationOutcome(overrides = {}) {
  const clientOrderId = "client-order-1"
  const reason = overrides.reason ?? "OPERATOR_REQUESTED"
  const outcome = overrides.outcome ?? "CANCELED"
  return {
    factType: "ORDER_CANCELLATION_OUTCOME",
    factId: `order-cancellation-outcome:${clientOrderId}:${reason}:${outcome}`,
    canonicalData: {
      clientOrderId,
      brokerOrderId: "broker-order-1",
      ...COMMON_ORDER_FIELDS,
      reason,
      outcome,
      status: outcome,
      executedQuantity: "1",
      ...overrides,
    },
  }
}

test("accepts canonical order-submission intents and recovery-sell purpose", () => {
  assert.doesNotThrow(
    () => validateOrderSubmissionIntentFact(makeSubmissionIntent()),
    "A canonical BUY submission intent must preserve its stable client order identity and exact amounts.",
  )
  assert.doesNotThrow(
    () => validateOrderSubmissionIntentFact(makeSubmissionIntent({
      side: "SELL",
      type: "LIMIT_MAKER",
      purpose: "RECOVERY_SELL",
    })),
    "A recovery SELL intent may use the supported maker order type and purpose.",
  )
})

test("rejects malformed order-submission intent identity, fields, classification, and amounts", () => {
  const valid = makeSubmissionIntent()
  const invalidCases = [
    ["unsupported payload field", { unsupported: true }, /unsupported fields/],
    ["non-canonical symbol", { symbol: "btcusdt" }, /symbol must be canonical/],
    ["unsupported side", { side: "HOLD" }, /side must be BUY or SELL/],
    ["unsupported order type", { type: "MARKET" }, /type must be LIMIT/],
    ["zero price", { price: "0" }, /price and quantity must be positive/],
    ["non-canonical quantity", { quantity: "01" }, /price and quantity must be positive/],
    ["unsupported purpose", { purpose: "MANUAL" }, /purpose must be null or RECOVERY_SELL/],
  ]

  for (const [description, changes, expectedError] of invalidCases) {
    assert.throws(
      () => validateOrderSubmissionIntentFact({
        ...valid,
        canonicalData: {
          ...valid.canonicalData,
          ...changes,
        },
      }),
      expectedError,
      `An order-submission intent must reject ${description}.`,
    )
  }
  assert.throws(
    () => validateOrderSubmissionIntentFact({
      ...valid,
      factId: "wrong-id",
    }),
    /factId must match/,
    "The stable order-submission fact ID must be derived from clientOrderId.",
  )
})

test("accepts acknowledged and unacknowledged order-submission outcomes", () => {
  assert.doesNotThrow(
    () => validateOrderSubmissionOutcomeFact(makeSubmissionOutcome()),
    "A rejected submission must remain pending without inventing broker identity or execution.",
  )
  assert.doesNotThrow(
    () => validateOrderSubmissionOutcomeFact(makeSubmissionOutcome({
      outcome: "ACKNOWLEDGED",
      brokerOrderId: "broker-order-1",
      status: "NEW",
      executedQuantity: "0",
    })),
    "An acknowledged submission must retain its broker identity and non-pending exchange status.",
  )
  assert.doesNotThrow(
    () => validateOrderSubmissionOutcomeFact(makeSubmissionOutcome({
      outcome: "UNKNOWN",
    })),
    "An uncertain submission must remain explicitly unacknowledged and pending.",
  )
})

test("rejects order-submission outcomes with inconsistent identity, amounts, or acknowledgement state", () => {
  const valid = makeSubmissionOutcome()
  const invalidCases = [
    ["unsupported field", { unsupported: true }, /unsupported fields/],
    ["invalid symbol", { symbol: "btc-usdt" }, /symbol must be canonical/],
    ["invalid side", { side: "HOLD" }, /side must be BUY or SELL/],
    ["invalid type", { type: "MARKET" }, /type must be LIMIT/],
    ["invalid amount", { price: "0" }, /amounts must be canonical/],
    ["invalid outcome", { outcome: "SENT" }, /classification is unsupported/],
    ["invalid purpose", { purpose: "MANUAL" }, /purpose must be null or RECOVERY_SELL/],
    ["unacknowledged order with broker identity", { brokerOrderId: "broker-order-1" }, /PENDING order without broker identity/],
    ["unacknowledged order with non-pending status", { status: "NEW" }, /PENDING order without broker identity/],
    ["unacknowledged order with execution", { executedQuantity: "0.1" }, /PENDING order without broker identity/],
    ["acknowledged order without broker identity", {
      outcome: "ACKNOWLEDGED",
      status: "NEW",
    }, /must be a non-empty string/],
    ["acknowledged order still pending", {
      outcome: "ACKNOWLEDGED",
      brokerOrderId: "broker-order-1",
      status: "PENDING",
    }, /cannot have PENDING status/],
  ]

  for (const [description, changes, expectedError] of invalidCases) {
    assert.throws(
      () => validateOrderSubmissionOutcomeFact({
        ...valid,
        factId: `order-submission-outcome:client-order-1:${changes.outcome ?? "REJECTED"}`,
        canonicalData: {
          ...valid.canonicalData,
          ...changes,
        },
      }),
      expectedError,
      `An order-submission outcome must reject ${description}.`,
    )
  }
  assert.throws(
    () => validateOrderSubmissionOutcomeFact({
      ...valid,
      factId: "wrong-id",
    }),
    /factId must match/,
    "The outcome fact ID must bind the exact client order and outcome classification.",
  )
})

test("accepts canonical cancellation intents for active acknowledged orders", () => {
  assert.doesNotThrow(
    () => validateOrderCancellationIntentFact(makeCancellationIntent()),
    "A partially filled acknowledged order may be cancelled with its exact original and executed quantities.",
  )
  assert.doesNotThrow(
    () => validateOrderCancellationIntentFact(makeCancellationIntent({
      status: "OPEN",
      executedQuantity: "0",
    })),
    "An open acknowledged order may be cancelled before any execution.",
  )
})

test("rejects cancellation intents with invalid identity, order state, or exact amounts", () => {
  const valid = makeCancellationIntent()
  const invalidCases = [
    ["unsupported field", { unsupported: true }, /unsupported fields/],
    ["non-canonical reason", { reason: "operator requested" }, /identity or reason is not canonical/],
    ["non-lowercase venue", { venue: "Binance" }, /identity or reason is not canonical/],
    ["market/venue mismatch", { marketId: "kraken:BTCUSDT" }, /identity or reason is not canonical/],
    ["invalid symbol", { symbol: "btc-usdt" }, /symbol must be canonical/],
    ["invalid side", { side: "HOLD" }, /side must be BUY or SELL/],
    ["invalid type", { type: "MARKET" }, /type must be LIMIT/],
    ["inactive order status", { status: "FILLED" }, /active acknowledged order/],
    ["zero price", { price: "0" }, /amounts must be exact canonical/],
    ["negative execution", { executedQuantity: "-1" }, /amounts must be exact canonical/],
  ]

  for (const [description, changes, expectedError] of invalidCases) {
    const fact = makeCancellationIntent(changes)
    assert.throws(
      () => validateOrderCancellationIntentFact(fact),
      expectedError,
      `An order-cancellation intent must reject ${description}.`,
    )
  }
  assert.throws(
    () => validateOrderCancellationIntentFact({
      ...valid,
      factId: "wrong-id",
    }),
    /identity or reason is not canonical/,
    "The cancellation-intent identity must bind the order, reason, state, and executed quantity.",
  )
})

test("accepts confirmed, still-active, and unconfirmed cancellation outcomes", () => {
  for (const outcome of ["CANCELED", "FILLED", "REJECTED", "EXPIRED"]) {
    assert.doesNotThrow(
      () => validateOrderCancellationOutcomeFact(makeCancellationOutcome({
        outcome,
        status: outcome,
        executedQuantity: "1",
      })),
      `A confirmed ${outcome} cancellation outcome must preserve its matching terminal state.`,
    )
  }
  for (const status of ["OPEN", "PARTIALLY_FILLED"]) {
    assert.doesNotThrow(
      () => validateOrderCancellationOutcomeFact(makeCancellationOutcome({
        outcome: "NOT_CANCELED",
        status,
        executedQuantity: "0.5",
      })),
      `A NOT_CANCELED outcome must preserve the active ${status} order state.`,
    )
  }
  for (const outcome of ["NOT_SENT", "OUTCOME_UNKNOWN", "UNCONFIRMED", "UNKNOWN"]) {
    assert.doesNotThrow(
      () => validateOrderCancellationOutcomeFact(makeCancellationOutcome({
        outcome,
        status: null,
        executedQuantity: null,
      })),
      `An unconfirmed ${outcome} result must not invent exchange order state.`,
    )
  }
})

test("rejects cancellation outcomes with mismatched identity or fabricated terminal state", () => {
  const valid = makeCancellationOutcome()
  const invalidCases = [
    ["unsupported field", { unsupported: true }, /unsupported fields/],
    ["invalid reason", { reason: "operator requested" }, /identity or classification is not canonical/],
    ["unsupported outcome", { outcome: "SENT" }, /identity or classification is not canonical/],
    ["wrong confirmed status", { status: "OPEN" }, /canonical terminal state/],
    ["malformed executed quantity", { executedQuantity: "01" }, /canonical terminal state/],
    ["NOT_CANCELED with terminal status", {
      outcome: "NOT_CANCELED",
      status: "CANCELED",
    }, /still-active canonical order state/],
    ["unconfirmed outcome with fabricated status", {
      outcome: "UNKNOWN",
      status: "OPEN",
      executedQuantity: null,
    }, /cannot invent a canonical order state/],
    ["unconfirmed outcome with fabricated execution", {
      outcome: "UNKNOWN",
      status: null,
      executedQuantity: "0",
    }, /cannot invent a canonical order state/],
  ]

  for (const [description, changes, expectedError] of invalidCases) {
    const fact = makeCancellationOutcome(changes)
    assert.throws(
      () => validateOrderCancellationOutcomeFact(fact),
      expectedError,
      `An order-cancellation outcome must reject ${description}.`,
    )
  }
  assert.throws(
    () => validateOrderCancellationOutcomeFact({
      ...valid,
      factId: "wrong-id",
    }),
    /identity or classification is not canonical/,
    "The cancellation-outcome fact ID must bind its exact order, reason, and classification.",
  )
})

test("leaves unrelated fact types to their owning validators", () => {
  const unrelated = {
    factType: "PROCESS_STOPPED",
    factId: "process-stopped:session-1",
    canonicalData: {},
  }
  assert.doesNotThrow(() => validateOrderSubmissionIntentFact(unrelated))
  assert.doesNotThrow(() => validateOrderSubmissionOutcomeFact(unrelated))
  assert.doesNotThrow(() => validateOrderCancellationIntentFact(unrelated))
  assert.doesNotThrow(() => validateOrderCancellationOutcomeFact(unrelated))
})
