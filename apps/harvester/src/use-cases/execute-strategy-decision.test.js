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
  assert.equal(calls[0], "pending:h-DOGEUSDT-1")
  assert.equal(calls[1].clientOrderId, "h-DOGEUSDT-1")
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
  assert.deepEqual(calls, ["h-DOGEUSDT-1", "UNKNOWN"])
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
