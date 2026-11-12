import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { makeReconcileTerminalOrderFills } from "./reconcile-terminal-order-fills.js"

const baseAsset = new Asset({ id: "doge", code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt", code: "USDT" })
const market = new Market({ venue: "binance", symbol: "DOGEUSDT", baseAsset, quoteAsset })

function makeOrder({
  status = "FILLED",
  quantity = "1",
  executedQuantity = quantity,
  brokerOrderId = "broker-order-1",
} = {}) {
  return new CanonicalOrder({
    clientOrderId: "h-dogeusdt-order-1",
    brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({ amount: "100", asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: quantity, asset: baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity, asset: baseAsset }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    ...(status !== "OPEN" && status !== "PARTIALLY_FILLED" ? { completedAt: 2 } : {}),
  })
}

function makeFill({ tradeId, quantity = "1", executedAt = 10, clientOrderId = "h-dogeusdt-order-1" } = {}) {
  return new Fill({
    tradeId: String(tradeId),
    brokerOrderId: "broker-order-1",
    clientOrderId,
    market,
    side: "BUY",
    price: new Money({ amount: "100", asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity, asset: baseAsset }),
    quoteQuantity: new Money({ amount: String(Number(quantity) * 100), asset: quoteAsset }),
    executedAt,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makeWorkflow({ fills = [], processedFills = [], brokerResult, applyResult = toResult({ data: { applied: true } }) } = {}) {
  const calls = { broker: [], pauses: [], applied: [] }
  const broker = {
    getFills: async (args) => {
      calls.broker.push(args)
      return brokerResult ?? toResult({ data: fills })
    },
  }
  const workflow = makeReconcileTerminalOrderFills({
    broker,
    processedFillsByOrder: new Map([["broker-order-1", new Map(processedFills.map((fill) => [fill.id, fill]))]]),
    pause: async (args) => { calls.pauses.push(args) },
    processExecutionFillTransition: async (args) => {
      calls.applied.push(args)
      return applyResult
    },
  })
  return { workflow, calls }
}

test("reconciles REST and stream fill facts once and applies them in execution order", async () => {
  const earlier = makeFill({ tradeId: "1", executedAt: 10, quantity: "0.5" })
  const later = makeFill({ tradeId: "2", executedAt: 20, quantity: "0.5" })
  const { workflow, calls } = makeWorkflow({ fills: [later], processedFills: [earlier] })

  const result = await workflow({ order: makeOrder({ quantity: "1" }), eventFill: later })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.applied.map(({ fill }) => fill.id), [earlier.id, later.id])
  assert.equal(calls.applied.length, 2, "A stream fill also present in REST history must be applied only once.")
  assert.deepEqual(calls.broker, [{ symbol: "DOGEUSDT", orderId: "broker-order-1" }])
  assert.deepEqual(calls.pauses, [])
})

test("allows a canonical stream fill to supersede a contradictory REST row when quantity still reconciles", async () => {
  const streamFill = makeFill({ tradeId: "2" })
  const contradictoryRestFill = makeFill({ tradeId: "1", clientOrderId: "unrelated-client-order" })
  const { workflow, calls } = makeWorkflow({ fills: [contradictoryRestFill] })

  const result = await workflow({ order: makeOrder(), eventFill: streamFill })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.applied.map(({ fill }) => fill.id), [streamFill.id])
  assert.deepEqual(calls.pauses, [])
})

test("fails closed when distinct fill quantity does not reconcile with the terminal order", async () => {
  const { workflow, calls } = makeWorkflow({ fills: [makeFill({ quantity: "0.5" })] })

  const result = await workflow({ order: makeOrder() })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_FILL_PARITY")
  assert.equal(calls.pauses[0].reason, "BUY_FILL_RECONCILIATION_FAILED")
  assert.deepEqual(calls.applied, [])
})

test("preserves fill-accounting failure classification and pauses the affected market", async () => {
  const failure = toResult({
    errors: [new Error("accounting failed")],
    failure: { category: "ACCOUNTING_INTEGRITY", stage: "FILL_ACCOUNTING", retryable: false },
  })
  const { workflow, calls } = makeWorkflow({ fills: [makeFill()], applyResult: failure })

  const result = await workflow({ order: makeOrder() })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "FILL_ACCOUNTING")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_FILL_ACCOUNTING_FAILED")
  assert.equal(calls.applied.length, 1)
})

test("rejects non-terminal order state before reading broker history", async () => {
  const { workflow, calls } = makeWorkflow()

  const result = await workflow({ order: makeOrder({ status: "OPEN", executedQuantity: "0" }) })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_ORDER_STATE")
  assert.deepEqual(calls.broker, [])
  assert.deepEqual(calls.pauses, [])
})
