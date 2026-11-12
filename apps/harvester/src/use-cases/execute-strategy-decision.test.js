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


test("durably records the exact order submission intent before calling the broker", async () => {
  const calls = []
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        calls.push({ stage: "broker", clientOrderId: order.clientOrderId })
        return { ok: true, data: makeAcknowledgement(order) }
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
      return { ok: true, data: { durable: true } }
    },
    onDurableSubmissionOutcome: async ({ order, outcome }) => {
      calls.push({ stage: "durable-outcome", clientOrderId: order.clientOrderId, outcome })
      return { ok: true, data: { durable: true } }
    },
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => calls.push({ stage: "acknowledged" }),
    onSubmissionFailure: async () => assert.fail("unexpected submission failure while recording a durable order intent"),
  })

  const result = await execute({ decision, marketMetadata })

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

test("does not call the broker when durable order-intent acknowledgement fails", async () => {
  let brokerCalls = 0
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => {
        brokerCalls += 1
        return { ok: true, data: makeAcknowledgement(order) }
      },
    },
    onDurableSubmissionIntent: async () => ({
      ok: false,
      errors: [new Error("durable fact store unavailable")],
    }),
    onDurableSubmissionOutcome: async () => assert.fail("outcome must not be written when intent persistence fails"),
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => {},
    onSubmissionFailure: async () => {},
  })

  const result = await execute({ decision, marketMetadata })

  assert.equal(result.ok, false, "A failed durable intent append must fail the strategy submission workflow.")
  assert.equal(brokerCalls, 0, "No broker placement may occur unless the immutable order intent was durably acknowledged first.")
  assert.match(result.errors[0].message, /durable fact store unavailable/, "The durable-fact failure must remain actionable at the application boundary.")
})


test("does not apply a broker acknowledgement when its durable outcome append fails", async () => {
  let acknowledged = false
  const failureOutcomes = []
  const execute = makeExecuteStrategyDecision({
    broker: {
      placeOrder: async ({ order }) => ({ ok: true, data: makeAcknowledgement(order) }),
    },
    onDurableSubmissionIntent: async () => ({ ok: true, data: { durable: true } }),
    onDurableSubmissionOutcome: async () => ({
      ok: false,
      errors: [new Error("outcome checkpoint unavailable")],
    }),
    onPendingOrder: async () => {},
    onAcknowledgedOrder: async () => { acknowledged = true },
    onSubmissionFailure: async ({ outcome }) => failureOutcomes.push(outcome),
  })

  const result = await execute({ decision, marketMetadata })

  assert.equal(result.ok, false, "A broker acknowledgement without a durable outcome must fail the submission workflow.")
  assert.equal(acknowledged, false, "In-memory order acknowledgement must not advance before its durable outcome.")
  assert.deepEqual(failureOutcomes, ["UNKNOWN"], "The uncommitted acknowledgement must trigger the existing fail-closed unknown-outcome path.")
  assert.match(result.errors[0].message, /outcome checkpoint unavailable/)
})
