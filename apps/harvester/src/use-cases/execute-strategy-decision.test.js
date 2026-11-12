import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { makeExecuteStrategyDecision } from "./execute-strategy-decision.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })
const tradingRules = new TradingRules({
  market,
  constraints: [
    { type: "PRICE_INCREMENT", status: "SUPPORTED", value: new Money({ amount: "0.001", asset: quoteAsset }) },
    { type: "QUANTITY_INCREMENT", status: "SUPPORTED", value: new Quantity({ amount: "1", asset: baseAsset }) },
    { type: "MIN_QUANTITY", status: "SUPPORTED", value: new Quantity({ amount: "1", asset: baseAsset }) },
    { type: "MIN_NOTIONAL", status: "SUPPORTED", value: new Money({ amount: "5", asset: quoteAsset }) },
  ],
})
const marketMetadata = { market, tradingRules, supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"] }
const decision = {
  strategy: "CONSERVATIVE",
  actions: [{ side: "BUY", type: "LIMIT_MAKER", price: "0.099", quantity: "100" }],
}
const makeAcknowledgement = ({ clientOrderId, side = "BUY", price = "0.099", quantity = "100" }) =>
  new CanonicalOrder({
    clientOrderId, brokerOrderId: "broker-1", market, side, type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: price, asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: quantity, asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0", asset: baseAsset }),
    status: "OPEN", createdAt: 1, acknowledgedAt: 1, updatedAt: 1,
  })

test("validates, registers, and submits each strategy intent through the broker port", async () => {
  const calls = []
  const submitted = []
  const execute = makeExecuteStrategyDecision({
    broker: { placeOrder: async ({ order }) => { calls.push(order); return { ok: true, data: makeAcknowledgement(order) } } },
    onPendingOrder: async ({ order }) => calls.push("pending:" + order.clientOrderId),
    onAcknowledgedOrder: async ({ order }) => submitted.push(order),
    onSubmissionFailure: async () => assert.fail("unexpected submission failure"),
  })
  const result = await execute({ decision, marketMetadata })
  assert.equal(result.ok, true)
  assert.equal(submitted.length, 1)
  assert.equal(submitted[0].status, "OPEN")
  assert.match(calls[0], /^pending:h-[0-9a-f]{22}-1$/)
  assert.match(calls[1].clientOrderId, /^h-[0-9a-f]{22}-1$/)
})

test("validates the complete exchange order before calling the broker", async () => {
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: { placeOrder: async () => { brokerCalls += 1; return { ok: true } } },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
  })
  const result = await execute({
    decision: { actions: [{ ...decision.actions[0], price: "0.0991" }] },
    marketMetadata,
  })
  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /PRICE_INCREMENT/)
  assert.equal(brokerCalls, 0)
})

test("registers a pending order before reporting a thrown submission as unknown", async () => {
  const calls = []
  const execute = makeExecuteStrategyDecision({
    broker: { placeOrder: async () => { throw new Error("socket closed") } },
    onPendingOrder: async ({ order }) => calls.push(order.clientOrderId),
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async ({ outcome }) => calls.push(outcome),
  })
  const result = await execute({ decision, marketMetadata })
  assert.equal(result.ok, false)
  assert.match(calls[0], /^h-[0-9a-f]{22}-1$/)
  assert.equal(calls[1], "UNKNOWN")
})

test("does not silently accept a non-canonical broker acknowledgement", async () => {
  const failures = []
  const execute = makeExecuteStrategyDecision({
    broker: { placeOrder: async () => ({ ok: true, data: {} }) },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async ({ outcome }) => failures.push(outcome),
  })
  const result = await execute({ decision, marketMetadata })
  assert.equal(result.ok, false)
  assert.deepEqual(failures, ["UNKNOWN"])
})

test("validates every action before submitting the first order", async () => {
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: { placeOrder: async () => { brokerCalls += 1; return { ok: false } } },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
  })
  const result = await execute({
    decision: {
      actions: [
        decision.actions[0],
        { side: "SELL", type: "LIMIT_MAKER", price: "0.0991", quantity: "1" },
      ],
    },
    marketMetadata,
  })
  assert.equal(result.ok, false)
  assert.equal(brokerCalls, 0)
})

test("pauses an unknown order outcome when local acknowledgement registration fails", async () => {
  const outcomes = []
  const execute = makeExecuteStrategyDecision({
    broker: { placeOrder: async ({ order }) => ({ ok: true, data: makeAcknowledgement(order) }) },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => { throw new Error("registry conflict") },
    onSubmissionFailure: async ({ outcome }) => outcomes.push(outcome),
  })
  const result = await execute({ decision, marketMetadata })
  assert.equal(result.ok, false)
  assert.deepEqual(outcomes, ["UNKNOWN"])
})


test("uses different client order ID namespaces for separate executor instances", async () => {
  const createExecutor = () => {
    let submittedOrder
    const execute = makeExecuteStrategyDecision({
      broker: { placeOrder: async ({ order }) => {
        submittedOrder = order
        return { ok: true, data: makeAcknowledgement(order) }
      } },
      onPendingOrder: async () => {},
      onAcknowledgedOrder: async () => {},
      onSubmissionFailure: async () => assert.fail("unexpected submission failure"),
    })
    return {
      run: async () => {
        const result = await execute({ decision, marketMetadata })
        assert.equal(result.ok, true)
        return submittedOrder.clientOrderId
      },
    }
  }

  const firstId = await createExecutor().run()
  const secondId = await createExecutor().run()

  assert.match(firstId, /^h-[0-9a-f]{22}-1$/)
  assert.match(secondId, /^h-[0-9a-f]{22}-1$/)
  assert.notEqual(firstId, secondId)
  assert.ok(firstId.length <= 36)
  assert.ok(secondId.length <= 36)
})

test("preserves explicit strategy purpose through both submission-gate checks without sending it to the broker", async () => {
  const gatePurposes = []
  const pendingPurposes = []
  let brokerOrder
  const sellDecision = {
    actions: [{
      side: "SELL",
      purpose: "RECOVERY_SELL",
      type: "LIMIT_MAKER",
      price: "0.101",
      quantity: "100",
    }],
  }
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        brokerOrder = order
        return { ok: true, data: makeAcknowledgement({ ...order, side: "SELL", price: "0.101" }) }
      },
    },
    canSubmit: ({ purpose }) => {
      gatePurposes.push(purpose)
      return true
    },
    onPendingOrder: async ({ purpose }) => pendingPurposes.push(purpose),
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => assert.fail("unexpected submission failure"),
  })

  const validation = await execute.validate({ decision: sellDecision, marketMetadata })
  assert.equal(validation.ok, true)
  assert.deepEqual(gatePurposes, ["RECOVERY_SELL"])
  gatePurposes.length = 0

  const result = await execute({ decision: sellDecision, marketMetadata })
  assert.equal(result.ok, true)
  assert.deepEqual(gatePurposes, ["RECOVERY_SELL", "RECOVERY_SELL"])
  assert.deepEqual(pendingPurposes, ["RECOVERY_SELL"])
  assert.equal(Object.hasOwn(brokerOrder, "purpose"), false, "Application-only recovery purpose must not leak into the broker order request.")
})


test("returns a structured submission deferral reason and details without registering or submitting an order", async () => {
  const deferralDetails = {
    symbol: "DOGEUSDT",
    bestAskPrice: "0.101",
    bookTimestamp: 123,
  }
  const deferredCallbacks = []
  let pendingRegistrations = 0
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => {
        brokerCalls += 1
        return { ok: false }
      },
    },
    canSubmit: () => ({
      allowed: false,
      reason: "POST_ONLY_WOULD_CROSS",
      details: deferralDetails,
    }),
    onPendingOrder: async () => {
      pendingRegistrations += 1
    },
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
    onSubmissionDeferred: async (context) => deferredCallbacks.push(context),
  })

  const result = await execute({ decision, marketMetadata })

  assert.equal(result.ok, true, "A valid safety deferral is a successful execution result, not a broker failure.")
  assert.equal(result.data.deferred, true, "The result must explicitly identify that broker submission was deferred.")
  assert.equal(result.data.reason, "POST_ONLY_WOULD_CROSS", "The result must preserve the exact post-only deferral reason.")
  assert.deepEqual(result.data.details, deferralDetails, "The result must preserve the safe market context used to explain the deferral.")
  assert.equal(deferredCallbacks.length, 1, "The deferred lifecycle callback must run exactly once for the withheld intent.")
  assert.equal(deferredCallbacks[0].registered, false, "An initial deferral must not claim that a PENDING order was registered.")
  assert.equal(pendingRegistrations, 0, "A deferred intent must not create a local PENDING order.")
  assert.equal(brokerCalls, 0, "A deferred intent must never reach broker.placeOrder.")
})

test("removes a registered PENDING order when the final readiness check returns a structured deferral", async () => {
  const pendingClientOrderIds = new Set()
  const deferredCallbacks = []
  const deferralDetails = { symbol: "DOGEUSDT", bookTimestamp: 456 }
  let readinessChecks = 0
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => {
        brokerCalls += 1
        return { ok: false }
      },
    },
    canSubmit: () => {
      readinessChecks += 1
      if (readinessChecks === 1) {return { allowed: true }}
      return {
        allowed: false,
        reason: "MARKET_BOOK_STALE",
        details: deferralDetails,
      }
    },
    onPendingOrder: async ({ order }) => {
      pendingClientOrderIds.add(order.clientOrderId)
    },
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
    onSubmissionDeferred: async ({ order, registered, reason, details }) => {
      deferredCallbacks.push({ registered, reason, details })
      if (registered) pendingClientOrderIds.delete(order.clientOrderId)
    },
  })

  const result = await execute({ decision, marketMetadata })

  assert.equal(result.ok, true, "A final readiness deferral must remain a successful, explicitly classified result.")
  assert.equal(result.data.deferred, true, "The final readiness check must report a deferred submission.")
  assert.equal(result.data.reason, "MARKET_BOOK_STALE", "The final readiness check must retain its stable reason.")
  assert.deepEqual(result.data.details, deferralDetails, "The final readiness result must retain the diagnostic context.")
  assert.equal(deferredCallbacks[0].registered, true, "The deferral callback must identify that PENDING registration already occurred.")
  assert.equal(pendingClientOrderIds.size, 0, "The PENDING order must be removed when the broker call is withheld.")
  assert.equal(brokerCalls, 0, "A final readiness deferral must not call broker.placeOrder.")
})

test("preserves structured deferral context during recovery-order preflight validation", async () => {
  const gatePurposes = []
  const deferralDetails = { symbol: "DOGEUSDT", protectionMode: "PROTECTED", volatilityRatio: "2" }
  const recoverySellDecision = {
    actions: [{
      side: "SELL",
      purpose: "RECOVERY_SELL",
      type: "LIMIT_MAKER",
      price: "0.101",
      quantity: "100",
    }],
  }
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => ({
        ok: true,
        data: makeAcknowledgement({ ...order, side: "SELL", price: "0.101" }),
      }),
    },
    canSubmit: ({ purpose }) => {
      gatePurposes.push(purpose)
      return {
        allowed: false,
        reason: "VOLATILITY_PROTECTION_ACTIVE",
        details: deferralDetails,
      }
    },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
  })

  const validation = await execute.validate({ decision: recoverySellDecision, marketMetadata })

  assert.equal(validation.ok, true, "A structured preflight deferral must not be reported as an execution error.")
  assert.equal(validation.data.deferred, true, "The validation result must identify the withheld preflight intent.")
  assert.equal(validation.data.reason, "VOLATILITY_PROTECTION_ACTIVE", "The preflight result must retain its stable gate reason.")
  assert.deepEqual(validation.data.details, deferralDetails, "The preflight result must retain safe volatility context.")
  assert.deepEqual(gatePurposes, ["RECOVERY_SELL"], "The preflight gate must receive the explicit recovery purpose.")
})


test("cleans up PENDING when the final submission gate returns an invalid structured decision", async () => {
  const pendingClientOrderIds = new Set()
  let readinessChecks = 0
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => {
        brokerCalls += 1
        return { ok: false }
      },
    },
    canSubmit: () => {
      readinessChecks += 1
      if (readinessChecks === 1) {return { allowed: true }}
      return { allowed: false }
    },
    onPendingOrder: async ({ order }) => pendingClientOrderIds.add(order.clientOrderId),
    onSubmissionDeferred: async ({ order, registered }) => {
      if (registered) pendingClientOrderIds.delete(order.clientOrderId)
    },
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
  })

  const result = await execute({ decision, marketMetadata })

  assert.equal(result.ok, false, "A malformed structured gate response must remain an explicit execution error.")
  assert.match(result.errors[0].message, /non-empty reason/, "The error must identify the invalid structured gate contract.")
  assert.equal(pendingClientOrderIds.size, 0, "The executor must remove PENDING when the final gate response is invalid.")
  assert.equal(brokerCalls, 0, "An invalid final gate response must never call broker.placeOrder.")
})

test("preserves earlier acknowledged orders when a later action is deferred", async () => {
  const submittedClientOrderIds = []
  const deferredDetails = { symbol: "DOGEUSDT", bookTimestamp: 789 }
  let readinessChecks = 0
  let brokerCalls = 0
  const twoActionDecision = {
    actions: [
      decision.actions[0],
      { side: "BUY", type: "LIMIT_MAKER", price: "0.098", quantity: "100" },
    ],
  }
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        brokerCalls += 1
        return { ok: true, data: makeAcknowledgement(order) }
      },
    },
    canSubmit: () => {
      readinessChecks += 1
      if (readinessChecks <= 2) {return { allowed: true }}
      return {
        allowed: false,
        reason: "MARKET_BOOK_STALE",
        details: deferredDetails,
      }
    },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async ({ order }) => submittedClientOrderIds.push(order.clientOrderId),
    onSubmissionFailure: async () => {},
  })

  const result = await execute({ decision: twoActionDecision, marketMetadata })

  assert.equal(result.ok, true, "A later action deferral must not turn an earlier valid acknowledgement into an execution error.")
  assert.equal(result.data.deferred, true, "The result must report that the later action was deferred.")
  assert.equal(result.data.reason, "MARKET_BOOK_STALE", "The later action's exact deferral reason must be returned.")
  assert.deepEqual(result.data.details, deferredDetails, "The later action's safe diagnostic context must be returned.")
  assert.equal(result.data.submittedOrders.length, 1, "The result must retain the earlier acknowledged order.")
  assert.equal(submittedClientOrderIds.length, 1, "Only the first action may have been acknowledged.")
  assert.equal(brokerCalls, 1, "The broker must receive the first action only; the deferred second action must not be submitted.")
})


test("preserves every stable submission-gate reason and its details without broker I/O", async () => {
  const deferrals = [
    { reason: "MARKET_PAUSED", details: { symbol: "DOGEUSDT" } },
    { reason: "OPERATOR_MARKET_PAUSED", details: { symbol: "DOGEUSDT" } },
    { reason: "UNOWNED_OPEN_ORDERS_PRESENT", details: { symbol: "DOGEUSDT" } },
    { reason: "TRADING_DISABLED", details: { symbol: "DOGEUSDT" } },
    { reason: "MARKET_PRICE_UNAVAILABLE", details: { symbol: "DOGEUSDT" } },
    { reason: "MARKET_PRICE_STALE", details: { symbol: "DOGEUSDT", priceTimestamp: 10 } },
    { reason: "VOLATILITY_DATA_UNAVAILABLE", details: { symbol: "DOGEUSDT", protectionMode: "PROTECTED" } },
    { reason: "VOLATILITY_PROTECTION_ACTIVE", details: { symbol: "DOGEUSDT", volatilityRatio: "2" } },
    { reason: "MARKET_BOOK_UNAVAILABLE", details: { symbol: "DOGEUSDT" } },
    { reason: "MARKET_BOOK_STALE", details: { symbol: "DOGEUSDT", bookTimestamp: 20 } },
    { reason: "POST_ONLY_WOULD_CROSS", details: { symbol: "DOGEUSDT", bestAskPrice: "0.101" } },
  ]

  for (const deferral of deferrals) {
    let pendingRegistrations = 0
    let brokerCalls = 0
    let deferredContext
    const execute = makeExecuteStrategyDecision({
      broker: {
        placeOrder: async () => {
          brokerCalls += 1
          return { ok: false }
        },
      },
      canSubmit: () => ({ allowed: false, reason: deferral.reason, details: deferral.details }),
      onPendingOrder: async () => {
        pendingRegistrations += 1
      },
      onAcknowledgedOrder: async () => {},
      onSubmissionFailure: async () => {},
      onSubmissionDeferred: async (context) => {
        deferredContext = context
      },
    })

    const result = await execute({ decision, marketMetadata })

    assert.equal(result.ok, true, deferral.reason + " must be a successful, explicitly classified deferral.")
    assert.equal(result.data.deferred, true, deferral.reason + " must mark the strategy intent as deferred.")
    assert.equal(result.data.reason, deferral.reason, deferral.reason + " must survive unchanged in the result.")
    assert.deepEqual(result.data.details, deferral.details, deferral.reason + " must preserve its safe diagnostic details.")
    assert.equal(deferredContext.reason, deferral.reason, deferral.reason + " must reach the lifecycle callback.")
    assert.deepEqual(deferredContext.details, deferral.details, deferral.reason + " must reach the lifecycle callback with its details.")
    assert.equal(deferredContext.registered, false, deferral.reason + " must not claim PENDING registration before the first gate passes.")
    assert.equal(pendingRegistrations, 0, deferral.reason + " must not register a local PENDING order.")
    assert.equal(brokerCalls, 0, deferral.reason + " must never call broker.placeOrder.")
  }
})
