import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity, TradingRules } from "@coinzilla/entities"
import { makeExecuteStrategyDecision } from "./execute-strategy-decision.js"
import { StrategyId } from "../domain/strategies/strategy-ids.js"
import { createRecoverySellerAccountingWorkflow } from "./create-recovery-seller-accounting-workflow.js"

const baseAsset = new Asset({ id: "doge",
code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt",
code: "USDT" })
const market = new Market({ venue: "binance",
symbol: "DOGEUSDT",
baseAsset,
quoteAsset })
const tradingRules = new TradingRules({
  market,
  constraints: [
    { type: "PRICE_INCREMENT",
status: "SUPPORTED",
value: new Money({ amount: "0.001",
asset: quoteAsset }) },
    { type: "QUANTITY_INCREMENT",
status: "SUPPORTED",
value: new Quantity({ amount: "1",
asset: baseAsset }) },
    { type: "MIN_QUANTITY",
status: "SUPPORTED",
value: new Quantity({ amount: "1",
asset: baseAsset }) },
    { type: "MIN_NOTIONAL",
status: "SUPPORTED",
value: new Money({ amount: "5",
asset: quoteAsset }) },
  ],
})
const marketMetadata = { market,
tradingRules,
supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"] }
const decision = {
  strategy: "CONSERVATIVE",
  actions: [{ side: "BUY",
type: "LIMIT_MAKER",
price: "0.099",
quantity: "100" }],
}
const makeAcknowledgement = ({ clientOrderId, side = "BUY", price = "0.099", quantity = "100" }) =>
  new CanonicalOrder({
    clientOrderId,
brokerOrderId: "broker-1",
market,
side,
type: "LIMIT_MAKER",
    limitPrice: new Money({ amount: price,
asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: quantity,
asset: baseAsset }),
    executedQuantity: new Quantity({ amount: "0",
asset: baseAsset }),
    status: "OPEN",
createdAt: 1,
acknowledgedAt: 1,
updatedAt: 1,
  })

test("validates, registers, and submits each strategy intent through the broker port", async () => {
  const calls = []
  const submitted = []
  const execute = makeExecuteStrategyDecision({
    broker: { placeOrder: async ({ order }) => { calls.push(order); return { ok: true,
data: makeAcknowledgement(order) } } },
    onPendingOrder: async ({ order }) => calls.push(`pending:${  order.clientOrderId}`),
    onAcknowledgedOrder: async ({ order }) => submitted.push(order),
    onSubmissionFailure: async () => assert.fail("unexpected submission failure"),
  })
  const result = await execute({ decision,
marketMetadata })
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
    decision: { actions: [{ ...decision.actions[0],
price: "0.0991" }] },
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
  const result = await execute({ decision,
marketMetadata })
  assert.equal(result.ok, false)
  assert.match(calls[0], /^h-[0-9a-f]{22}-1$/)
  assert.equal(calls[1], "UNKNOWN")
})

test("does not silently accept a non-canonical broker acknowledgement", async () => {
  const failures = []
  const execute = makeExecuteStrategyDecision({
    broker: { placeOrder: async () => ({ ok: true,
data: {} }) },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async ({ outcome }) => failures.push(outcome),
  })
  const result = await execute({ decision,
marketMetadata })
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
        { side: "SELL",
type: "LIMIT_MAKER",
price: "0.0991",
quantity: "1" },
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
    broker: { placeOrder: async ({ order }) => ({ ok: true,
data: makeAcknowledgement(order) }) },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => { throw new Error("registry conflict") },
    onSubmissionFailure: async ({ outcome }) => outcomes.push(outcome),
  })
  const result = await execute({ decision,
marketMetadata })
  assert.equal(result.ok, false)
  assert.deepEqual(outcomes, ["UNKNOWN"])
})


test("uses different client order ID namespaces for separate executor instances", async () => {
  const createExecutor = () => {
    let submittedOrder
    const execute = makeExecuteStrategyDecision({
      broker: { placeOrder: async ({ order }) => {
        submittedOrder = order
        return { ok: true,
data: makeAcknowledgement(order) }
      } },
      onPendingOrder: async () => {},
      onAcknowledgedOrder: async () => {},
      onSubmissionFailure: async () => assert.fail("unexpected submission failure"),
    })
    return {
      run: async () => {
        const result = await execute({ decision,
marketMetadata })
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

test("preserves explicit strategy purpose through every submission-gate check without sending it to the broker", async () => {
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
        return { ok: true,
data: makeAcknowledgement({ ...order,
side: "SELL",
price: "0.101" }) }
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

  const validation = await execute.validate({ decision: sellDecision,
marketMetadata })
  assert.equal(validation.ok, true)
  assert.deepEqual(gatePurposes, ["RECOVERY_SELL"])
  gatePurposes.length = 0

  const result = await execute({ decision: sellDecision,
marketMetadata })
  assert.equal(result.ok, true)
  assert.deepEqual(gatePurposes, ["RECOVERY_SELL", "RECOVERY_SELL", "RECOVERY_SELL"])
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

  const result = await execute({ decision,
marketMetadata })

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
  const deferralDetails = { symbol: "DOGEUSDT",
bookTimestamp: 456 }
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
      deferredCallbacks.push({ registered,
reason,
details })
      if (registered) {pendingClientOrderIds.delete(order.clientOrderId)}
    },
  })

  const result = await execute({ decision,
marketMetadata })

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
  const deferralDetails = { symbol: "DOGEUSDT",
protectionMode: "PROTECTED",
volatilityRatio: "2" }
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
        data: makeAcknowledgement({ ...order,
side: "SELL",
price: "0.101" }),
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

  const validation = await execute.validate({ decision: recoverySellDecision,
marketMetadata })

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
      if (registered) {pendingClientOrderIds.delete(order.clientOrderId)}
    },
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
  })

  const result = await execute({ decision,
marketMetadata })

  assert.equal(result.ok, false, "A malformed structured gate response must remain an explicit execution error.")
  assert.match(result.errors[0].message, /non-empty reason/, "The error must identify the invalid structured gate contract.")
  assert.equal(pendingClientOrderIds.size, 0, "The executor must remove PENDING when the final gate response is invalid.")
  assert.equal(brokerCalls, 0, "An invalid final gate response must never call broker.placeOrder.")
})

test("preserves earlier acknowledged orders when a later action is deferred", async () => {
  const submittedClientOrderIds = []
  const deferredDetails = { symbol: "DOGEUSDT",
bookTimestamp: 789 }
  let readinessChecks = 0
  let brokerCalls = 0
  const twoActionDecision = {
    actions: [
      decision.actions[0],
      { side: "BUY",
type: "LIMIT_MAKER",
price: "0.098",
quantity: "100" },
    ],
  }
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        brokerCalls += 1
        return { ok: true,
data: makeAcknowledgement(order) }
      },
    },
    canSubmit: () => {
      readinessChecks += 1
      if (readinessChecks <= 3) {return { allowed: true }}
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

  const result = await execute({ decision: twoActionDecision,
marketMetadata })

  assert.equal(result.ok, true, "A later action deferral must not turn an earlier valid acknowledgement into an execution error.")
  assert.equal(result.data.deferred, true, "The result must report that the later action was deferred.")
  assert.equal(result.data.reason, "MARKET_BOOK_STALE", "The later action's exact deferral reason must be returned.")
  assert.deepEqual(result.data.details, deferredDetails, "The later action's safe diagnostic context must be returned.")
  assert.equal(result.data.submittedOrders.length, 1, "The result must retain the earlier acknowledged order.")
  assert.equal(submittedClientOrderIds.length, 1, "Only the first action may have been acknowledged.")
  assert.equal(brokerCalls, 1, "The broker must receive the first action only; the deferred second action must not be submitted.")
})


const SUBMISSION_GATE_DEFERRALS = [
    { reason: "MARKET_PAUSED",
details: { symbol: "DOGEUSDT" } },
    { reason: "OPERATOR_MARKET_PAUSED",
details: { symbol: "DOGEUSDT" } },
    { reason: "UNOWNED_OPEN_ORDERS_PRESENT",
details: { symbol: "DOGEUSDT" } },
    { reason: "TRADING_DISABLED",
details: { symbol: "DOGEUSDT" } },
    { reason: "MARKET_PRICE_UNAVAILABLE",
details: { symbol: "DOGEUSDT" } },
    { reason: "MARKET_PRICE_STALE",
details: { symbol: "DOGEUSDT",
priceTimestamp: 10 } },
    { reason: "VOLATILITY_DATA_UNAVAILABLE",
details: { symbol: "DOGEUSDT",
protectionMode: "PROTECTED" } },
    { reason: "VOLATILITY_PROTECTION_ACTIVE",
details: { symbol: "DOGEUSDT",
volatilityRatio: "2" } },
    { reason: "MARKET_BOOK_UNAVAILABLE",
details: { symbol: "DOGEUSDT" } },
    { reason: "MARKET_BOOK_STALE",
details: { symbol: "DOGEUSDT",
bookTimestamp: 20 } },
    { reason: "POST_ONLY_WOULD_CROSS",
details: { symbol: "DOGEUSDT",
bestAskPrice: "0.101" } },
]

test("preserves every stable submission-gate reason and its details without broker I/O", async () => {
  for (const deferral of SUBMISSION_GATE_DEFERRALS) {
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
      canSubmit: () => ({ allowed: false,
reason: deferral.reason,
details: deferral.details }),
      onPendingOrder: async () => {
        pendingRegistrations += 1
      },
      onAcknowledgedOrder: async () => {},
      onSubmissionFailure: async () => {},
      onSubmissionDeferred: async (context) => {
        deferredContext = context
      },
    })

    const result = await execute({ decision,
marketMetadata })

    assert.equal(result.ok, true, `${deferral.reason  } must be a successful, explicitly classified deferral.`)
    assert.equal(result.data.deferred, true, `${deferral.reason  } must mark the strategy intent as deferred.`)
    assert.equal(result.data.reason, deferral.reason, `${deferral.reason  } must survive unchanged in the result.`)
    assert.deepEqual(result.data.details, deferral.details, `${deferral.reason  } must preserve its safe diagnostic details.`)
    assert.equal(deferredContext.reason, deferral.reason, `${deferral.reason  } must reach the lifecycle callback.`)
    assert.deepEqual(deferredContext.details, deferral.details, `${deferral.reason  } must reach the lifecycle callback with its details.`)
    assert.equal(deferredContext.registered, false, `${deferral.reason  } must not claim PENDING registration before the first gate passes.`)
    assert.equal(pendingRegistrations, 0, `${deferral.reason  } must not register a local PENDING order.`)
    assert.equal(brokerCalls, 0, `${deferral.reason  } must never call broker.placeOrder.`)
  }
})

test("durably records the exact order submission intent before calling the broker", async () => {
  const calls = []
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        calls.push({ stage: "broker",
clientOrderId: order.clientOrderId })
        return { ok: true,
data: makeAcknowledgement(order) }
      },
    },
    onDurableSubmissionIntent: async ({ order, purpose }) => {
      calls.push({
        stage: "durable-intent",
        clientOrderId: order.clientOrderId,
        marketId: order.market.id,
        symbol: order.market.symbol,
        side: order.side,
        type: order.type,
        price: order.limitPrice.amount,
        quantity: order.originalQuantity.amount,
        purpose,
      })
      return { ok: true,
data: { durable: true } }
    },
    onDurableSubmissionOutcome: async ({ order, outcome }) => {
      calls.push({ stage: "durable-outcome",
clientOrderId: order.clientOrderId,
outcome })
      return { ok: true,
data: { durable: true } }
    },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => calls.push({ stage: "acknowledged" }),
    onSubmissionFailure: async () => assert.fail("unexpected submission failure while recording a durable order intent"),
  })

  const result = await execute({ decision,
marketMetadata })

  assert.equal(result.ok, true, "A strategy order with a durably recorded intent should proceed to broker submission.")
  assert.equal(calls[0].stage, "durable-intent", "The durable order intent must be acknowledged before the broker can receive a placement request.")
  assert.equal(calls[1].stage, "broker", "The broker placement must happen only after the durable intent append succeeds.")
  assert.equal(calls[2].stage, "durable-outcome", "The broker acknowledgement must be durably recorded before local order acknowledgement.")
  assert.equal(calls[2].outcome, "ACKNOWLEDGED")
  assert.equal(calls[3].stage, "acknowledged", "Local order state may advance only after the durable outcome is committed.")
  assert.equal(calls[0].clientOrderId, calls[1].clientOrderId, "The durable intent and broker request must share the exact stable client order identity.")
  assert.equal(calls[0].marketId, market.id, "The durable intent must preserve the canonical market identity.")
  assert.equal(calls[0].symbol, market.symbol, "The durable intent must preserve the canonical market symbol.")
  assert.equal(calls[0].side, "BUY", "The durable intent must preserve the exact strategy order side.")
  assert.equal(calls[0].type, "LIMIT_MAKER", "The durable intent must preserve the exact exchange order type.")
  assert.equal(calls[0].price, "0.099", "The durable intent must preserve the exact decimal limit price.")
  assert.equal(calls[0].quantity, "100", "The durable intent must preserve the exact decimal base quantity.")
  assert.equal(calls[0].purpose, null, "An order without an explicit strategy purpose must persist a canonical null purpose.")
})

test("rechecks the shutdown gate after durable intent and before broker placement", async () => {
  const calls = []
  let gateChecks = 0
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => {
        calls.push("broker")
        return {
          ok: true,
          data: makeAcknowledgement(decision.actions[0]),
        }
      },
    },
    canSubmit: () => {
      gateChecks += 1
      calls.push(`gate:${gateChecks}`)
      return gateChecks <= 2
        ? true
        : {
          allowed: false,
          reason: "CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE",
        }
    },
    onPendingOrder: async () => calls.push("pending"),
    onDurableSubmissionIntent: async () => {
      calls.push("durable-intent")
      return {
        ok: true,
        data: { durable: true },
      }
    },
    onDurableSubmissionOutcome: async ({ outcome }) => {
      calls.push(`durable-outcome:${outcome}`)
      return {
        ok: true,
        data: { durable: true },
      }
    },
    onSubmissionDeferred: async ({ reason }) => {
      calls.push(`deferred:${reason}`)
    },
    onAcknowledgedOrder: async () => assert.fail("A blocked order must not be acknowledged."),
    onSubmissionFailure: async () => assert.fail("A locally deferred order is not a broker failure."),
  })

  const result = await execute({
    decision,
    marketMetadata,
  })

  assert.equal(result.ok, true, "Expected result.ok to equal true in \"rechecks the shutdown gate after durable intent and before broker placement\".")
  assert.equal(result.data.deferred, true, "Expected result.data.deferred to equal true in \"rechecks the shutdown gate after durable intent and before broker placement\".")
  assert.equal(result.data.reason, "CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE", "Expected result.data.reason to equal \"CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE\" in \"rechecks the shutdown gate after durable intent and before broker placement\".")
  assert.equal(calls.includes("broker"), false, "The broker must never receive a BUY after the shutdown gate activates.")
  assert.ok(calls.indexOf("durable-intent") < calls.indexOf("durable-outcome:REJECTED"), "Expected condition (calls.indexOf(\"durable-intent\") < calls.indexOf(\"durable-outcome:) to be true in \"rechecks the shutdown gate after durable intent and before broker placement\".")
  assert.ok(calls.indexOf("durable-outcome:REJECTED") < calls.indexOf("deferred:CONSERVATIVE_SHUTDOWN_BUY_GATE_ACTIVE"), "Expected condition (calls.indexOf(\"durable-outcome:REJECTED\") < calls.indexOf(\"deferr) to be true in \"rechecks the shutdown gate after durable intent and before broker placement\".")
})

test("does not call the broker and removes PENDING registration when durable order-intent acknowledgement fails", async () => {
  let brokerCalls = 0
  const deferredRegistrations = []
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        brokerCalls += 1
        return { ok: true,
data: makeAcknowledgement(order) }
      },
    },
    onDurableSubmissionIntent: async () => ({
      ok: false,
      errors: [new Error("durable fact store unavailable")],
    }),
    onDurableSubmissionOutcome: async () => assert.fail("outcome must not be written when intent persistence fails"),
    onPendingOrder: async () => {},
    onSubmissionDeferred: async ({ registered }) => deferredRegistrations.push(registered),
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
  })

  const result = await execute({ decision,
marketMetadata })

  assert.equal(result.ok, false, "A failed durable intent append must fail the strategy submission workflow.")
  assert.equal(brokerCalls, 0, "No broker placement may occur unless the immutable order intent was durably acknowledged first.")
  assert.deepEqual(deferredRegistrations, [true], "A failed pre-broker durability barrier must remove the locally registered PENDING order.")
  assert.match(result.errors[0].message, /durable fact store unavailable/, "The durable-fact failure must remain actionable at the application boundary.")
})


test("does not apply a broker acknowledgement when its durable outcome append fails", async () => {
  let acknowledged = false
  const failureOutcomes = []
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => ({ ok: true,
data: makeAcknowledgement(order) }),
    },
    onDurableSubmissionIntent: async () => ({ ok: true,
data: { durable: true } }),
    onDurableSubmissionOutcome: async () => ({
      ok: false,
      errors: [new Error("outcome checkpoint unavailable")],
    }),
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => { acknowledged = true },
    onSubmissionFailure: async ({ outcome }) => failureOutcomes.push(outcome),
  })

  const result = await execute({ decision,
marketMetadata })

  assert.equal(result.ok, false, "A broker acknowledgement without a durable outcome must fail the submission workflow.")
  assert.equal(acknowledged, false, "In-memory order acknowledgement must not advance before its durable outcome.")
  assert.deepEqual(failureOutcomes, ["UNKNOWN"], "The uncommitted acknowledgement must trigger the existing fail-closed unknown-outcome path.")
  assert.match(result.errors[0].message, /outcome checkpoint unavailable/)
})


test("persists a definite post-only rejection as REJECTED rather than an ambiguous outcome", async () => {
  const durableOutcomes = []
  const failureOutcomes = []
  const postOnlyRejection = Object.assign(new Error("Post-only order would immediately take liquidity"), {
    code: "POST_ONLY_WOULD_TAKE",
  })
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => ({ ok: false,
errors: [postOnlyRejection] }),
    },
    onDurableSubmissionIntent: async () => ({ ok: true,
data: { durable: true } }),
    onDurableSubmissionOutcome: async ({ outcome }) => {
      durableOutcomes.push(outcome)
      return { ok: true,
data: { durable: true } }
    },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async ({ outcome }) => failureOutcomes.push(outcome),
  })

  const result = await execute({ decision,
marketMetadata })

  assert.equal(result.ok, false, "A definite post-only rejection must remain a failed submission.")
  assert.deepEqual(durableOutcomes, ["REJECTED"], "The durable outcome must preserve a broker-confirmed definite rejection.")
  assert.deepEqual(failureOutcomes, ["REJECTED"], "The existing safety handler must receive the same definite rejection classification.")
})


function createOwnedDecision({ ownership } = {}) {
  return {
    actions: [{
      ...decision.actions[0],
      ...ownership,
    }],
  }
}

function createOwnershipRecordingExecutor({ observed, setBrokerOrder } = {}) {
  const record = ({ callback, result } = {}) => ({ ownership } = {}) => {
    observed.push({
      callback,
      ownership,
    })
    return result
  }
  const durableResult = {
    ok: true,
    data: { durable: true },
  }
  return makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        setBrokerOrder(order)
        return {
          ok: true,
          data: makeAcknowledgement(order),
        }
      },
    },
    canSubmit: record({
      callback: "canSubmit",
      result: true,
    }),
    onPendingOrder: record({ callback: "onPendingOrder" }),
    onAcknowledgedOrder: record({ callback: "onAcknowledgedOrder" }),
    onSubmissionFailure: async () => assert.fail("unexpected submission failure"),
    onDurableSubmissionIntent: record({
      callback: "onDurableSubmissionIntent",
      result: durableResult,
    }),
    onDurableSubmissionOutcome: record({
      callback: "onDurableSubmissionOutcome",
      result: durableResult,
    }),
  })
}

test("propagates RS OrderOwnership metadata through shared execution callbacks without leaking it to the broker", async () => {
  const ownership = {
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "rs-position-1",
    purpose: "RECOVERY_BUY",
    cycleId: "rs-cycle-1",
  }
  const observed = []
  let brokerOrder
  const execute = createOwnershipRecordingExecutor({
    observed,
    setBrokerOrder: (order) => { brokerOrder = order },
  })
  const rsDecision = createOwnedDecision({ ownership })
  const validation = await execute.validate({
    decision: rsDecision,
    marketMetadata,
  })
  const result = await execute({
    decision: rsDecision,
    marketMetadata,
  })

  assert.equal(validation.ok, true)
  assert.equal(result.ok, true)
  assert.ok(observed.length >= 6)
  for (const callback of observed) {
    assert.deepEqual(callback.ownership, ownership,
      `${callback.callback} must receive the exact strategy, Position, purpose and cycle attribution.`)
  }
  assert.equal(Object.hasOwn(brokerOrder, "ownership"), false,
    "Application-only ownership metadata must not leak into the broker order request.")
})

test("propagates ownership when the post-registration submission gate throws", async () => {
  const ownership = {
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "rs-position-throwing-gate",
    purpose: "RECOVERY_BUY",
    cycleId: "rs-cycle-throwing-gate",
  }
  let gateChecks = 0
  let deferredContext
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => {
        brokerCalls += 1
        return {
          ok: true,
          data: makeAcknowledgement(decision.actions[0]),
        }
      },
    },
    canSubmit: () => {
      gateChecks += 1
      if (gateChecks === 1) {return true}
      throw new Error("submission gate unavailable")
    },
    onPendingOrder: async () => {},
    onSubmissionDeferred: async (context) => { deferredContext = context },
    onAcknowledgedOrder: async () => assert.fail("a throwing gate must not acknowledge an order"),
    onSubmissionFailure: async () => assert.fail("a local gate error is not a broker submission failure"),
  })
  const result = await execute({
    decision: {
      actions: [{
        ...decision.actions[0],
        ...ownership,
      }],
    },
    marketMetadata,
  })

  assert.equal(result.ok, false)
  assert.equal(result.errors[0].message, "submission gate unavailable")
  assert.deepEqual(deferredContext.ownership, ownership,
    "The registered-order deferral callback must retain complete RS ownership even when the gate throws.")
  assert.equal(deferredContext.registered, true)
  assert.equal(brokerCalls, 0, "A gate exception must prevent broker I/O.")
})


test("propagates OrderOwnership to the order-validation failure callback", async () => {
  const ownership = {
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "rs-position-invalid-order",
    purpose: "RECOVERY_BUY",
    cycleId: "rs-cycle-invalid-order",
  }
  const validationFailures = []
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => {
        brokerCalls += 1
        return {
          ok: true,
          data: makeAcknowledgement(decision.actions[0]),
        }
      },
    },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => assert.fail("an invalid order must not be acknowledged"),
    onSubmissionFailure: async () => assert.fail("local validation is not a broker submission failure"),
    onOrderValidationFailure: async ({ order, error, ownership: receivedOwnership }) => {
      validationFailures.push({
        order,
        error,
        ownership: receivedOwnership,
      })
    },
  })
  const result = await execute.validate({
    decision: {
      actions: [{
        ...decision.actions[0],
        price: "0.0991",
        ...ownership,
      }],
    },
    marketMetadata,
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /PRICE_INCREMENT/)
  assert.equal(validationFailures.length, 1)
  assert.deepEqual(validationFailures[0].ownership, ownership)
  assert.equal(validationFailures[0].order.status, "PENDING")
  assert.equal(brokerCalls, 0)
})


function createDurableRSIntegrationWorkflow({ durableFills } = {}) {
  return createRecoverySellerAccountingWorkflow({
    onOperationalStateExecutionFill: async ({ fill }) => {
      durableFills.push(fill)
      return {
        ok: true,
        data: { durable: true },
      }
    },
  })
}

function createRSIntegrationBuyFill({ registeredOrder } = {}) {
  return new Fill({
    tradeId: "rs-executor-integration-buy-1",
    brokerOrderId: registeredOrder.brokerOrderId,
    clientOrderId: registeredOrder.clientOrderId,
    market,
    side: "BUY",
    price: new Money({
      amount: "0.099",
      asset: quoteAsset,
    }),
    quantity: new Quantity({
      amount: "100",
      asset: baseAsset,
    }),
    quoteQuantity: new Money({
      amount: "9.9",
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function assertRSIntegrationOrderOwnership({ workflow, registeredOrder, ownership } = {}) {
  assert.deepEqual(
    workflow.getOrderRegistry().getOwnership({
      clientOrderId: registeredOrder.clientOrderId,
    }),
    {
      clientOrderId: registeredOrder.clientOrderId,
      brokerOrderId: registeredOrder.brokerOrderId,
      ...ownership,
    },
    "The shared executor acknowledgement must retain the exact RS Position and cycle attribution in OrderRegistry.",
  )
}

test("integrates the shared executor, RS OrderRegistry ownership and durable BUY accounting offline", async () => {
  const ownership = {
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "rs-position-executor-integration",
    purpose: "RECOVERY_BUY",
    cycleId: "rs-cycle-executor-integration",
  }
  const durableFills = []
  const workflow = createDurableRSIntegrationWorkflow({ durableFills })
  let brokerOrder
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        brokerOrder = order
        return {
          ok: true,
          data: makeAcknowledgement(order),
        }
      },
    },
    canSubmit: ({ ownership: receivedOwnership }) => {
      assert.deepEqual(receivedOwnership, ownership)
      return true
    },
    ...workflow.getExecutionCallbacks(),
  })

  const submitted = await execute({
    decision: createOwnedDecision({ ownership }),
    marketMetadata,
  })
  const registeredOrder = workflow.getOrderRegistry().getOrder({
    clientOrderId: brokerOrder.clientOrderId,
  })

  assert.equal(submitted.ok, true, submitted.errors?.[0]?.message)
  assert.equal(registeredOrder.status, "UNKNOWN",
    "A broker acknowledgement retains the order as UNKNOWN until execution quantity is reconciled.")
  assertRSIntegrationOrderOwnership({
    workflow,
    registeredOrder,
    ownership,
  })

  const fill = createRSIntegrationBuyFill({ registeredOrder })
  const applied = await workflow.applyBuyFill({ fill })
  const replayed = await workflow.applyBuyFill({ fill })

  assert.equal(applied.ok, true, applied.errors?.[0]?.message)
  assert.equal(applied.data.applied, true)
  assert.equal(replayed.ok, true, replayed.errors?.[0]?.message)
  assert.equal(replayed.data.duplicate, true)
  assert.deepEqual(durableFills, [fill],
    "The integrated BUY fill must be durably recorded once even when the canonical fill is replayed.")
  assert.equal(
    workflow.getPortfolio().getPosition({ positionId: ownership.positionId }).spent.amount,
    "9.9",
  )
})

test("integrates an unknown fake-broker acknowledgement as an owned UNKNOWN RS order", async () => {
  const ownership = {
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "rs-position-unknown-integration",
    purpose: "RECOVERY_BUY",
    cycleId: "rs-cycle-unknown-integration",
  }
  const workflow = createRecoverySellerAccountingWorkflow()
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async () => {
        throw new Error("offline fake broker socket closed")
      },
    },
    canSubmit: () => true,
    ...workflow.getExecutionCallbacks(),
  })

  const result = await execute({
    decision: createOwnedDecision({ ownership }),
    marketMetadata,
  })
  const [unknownOrder] = workflow.getOrderRegistry().getActiveOrders()

  assert.equal(result.ok, false)
  assert.equal(unknownOrder.status, "UNKNOWN")
  assert.deepEqual(
    workflow.getOrderRegistry().getOwnership({
      clientOrderId: unknownOrder.clientOrderId,
    }),
    {
      clientOrderId: unknownOrder.clientOrderId,
      ...ownership,
    },
    "An unknown broker outcome must retain the original RS ownership for reconciliation.",
  )
})


test("persists selected provider provenance before broker I/O and carries it onto the acknowledgement", async () => {
  const calls = []
  let acknowledged
  const execute = makeExecuteStrategyDecision({
    broker: {
      providerInstanceId: "binanceTestnet",
      providerType: "binance",
      accountId: "binance-primary",
      placeOrder: async ({ order }) => {
        calls.push("broker")
        return {
          ok: true,
          data: makeAcknowledgement(order),
        }
      },
    },
    onPendingOrder: async ({ order }) => {
      assert.equal(order.providerInstanceId, "binanceTestnet")
      calls.push("pending")
    },
    onDurableSubmissionIntent: async ({ order }) => {
      assert.deepEqual([order.providerInstanceId, order.providerType, order.accountId], [
        "binanceTestnet", "binance", "binance-primary",
      ])
      calls.push("durable-intent")
      return {
        ok: true,
        data: { durable: true },
      }
    },
    onDurableSubmissionOutcome: async ({ order, outcome }) => {
      assert.deepEqual([order.providerInstanceId, order.providerType, order.accountId], [
        "binanceTestnet", "binance", "binance-primary",
      ])
      assert.equal(outcome, "ACKNOWLEDGED")
      calls.push("durable-outcome")
      return { ok: true, data: { durable: true } }
    },
    onAcknowledgedOrder: async ({ order }) => { acknowledged = order },
    onSubmissionFailure: async () => assert.fail("unexpected submission failure"),
  })

  const result = await execute({
    decision,
    marketMetadata,
  })
  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(calls, ["pending", "durable-intent", "broker", "durable-outcome"])
  assert.equal(acknowledged.providerInstanceId, "binanceTestnet")
  assert.equal(acknowledged.providerType, "binance")
  assert.equal(acknowledged.accountId, "binance-primary")
})

test("fails closed before registration or broker I/O when durable provenance metadata is missing", () => {
  assert.throws(() => makeExecuteStrategyDecision({
    broker: { placeOrder: async () => ({ ok: false }) },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
    onDurableSubmissionIntent: async () => ({
      ok: true,
      data: { durable: true },
    }),
    onDurableSubmissionOutcome: async () => ({
      ok: true,
      data: { durable: true },
    }),
  }), /providerInstanceId, providerType and accountId/)
})
