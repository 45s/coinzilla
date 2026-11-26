import test from "node:test"
import assert from "node:assert/strict"
import { Asset, CanonicalOrder, Fill, Market, Money, Quantity } from "@coinzilla/entities"
import { multiplyDecimal, toResult } from "@coinzilla/utils"
import { makeReconcileTerminalOrderFills } from "./reconcile-terminal-order-fills.js"

const baseAsset = new Asset({ id: "doge",
code: "DOGE" })
const quoteAsset = new Asset({ id: "usdt",
code: "USDT" })
const market = new Market({ venue: "binance",
symbol: "DOGEUSDT",
baseAsset,
quoteAsset })

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
    limitPrice: new Money({ amount: "100",
asset: quoteAsset }),
    originalQuantity: new Quantity({ amount: quantity,
asset: baseAsset }),
    executedQuantity: new Quantity({ amount: executedQuantity,
asset: baseAsset }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    ...(status !== "OPEN" && status !== "PARTIALLY_FILLED" ? { completedAt: 2 } : {}),
  })
}

function makeFill({
  tradeId,
  quantity = "1",
  executedAt = 10,
  clientOrderId = "h-dogeusdt-order-1",
  brokerOrderId = "broker-order-1",
} = {}) {
  return new Fill({
    tradeId: String(tradeId),
    brokerOrderId,
    clientOrderId,
    market,
    side: "BUY",
    price: new Money({ amount: "100",
asset: quoteAsset }),
    quantity: new Quantity({ amount: quantity,
asset: baseAsset }),
    quoteQuantity: new Money({ amount: multiplyDecimal({
        left: "100",
        right: quantity,
      }),
asset: quoteAsset }),
    executedAt,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makeWorkflow({
  fills = [],
  processedFills = [],
  brokerResult,
  brokerError,
  applyResult = toResult({ data: { applied: true } }),
  onTerminalOrderReconciled,
} = {}) {
  const calls = { broker: [],
pauses: [],
applied: [] }
  const broker = {
    getFills: async (args) => {
      calls.broker.push(args)
      if (brokerError) {
        throw brokerError
      }
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
    onTerminalOrderReconciled,
  })
  return { workflow,
calls }
}

test("reconciles REST and stream fill facts once and applies them in execution order", async () => {
  const earlier = makeFill({ tradeId: "1",
executedAt: 10,
quantity: "0.5" })
  const later = makeFill({ tradeId: "2",
executedAt: 20,
quantity: "0.5" })
  const { workflow, calls } = makeWorkflow({ fills: [later],
processedFills: [earlier] })

  const result = await workflow({ order: makeOrder({ quantity: "1" }),
eventFill: later })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.applied.map(({ fill }) => fill.id), [earlier.id, later.id])
  assert.equal(calls.applied.length, 2, "A stream fill also present in REST history must be applied only once.")
  assert.deepEqual(calls.broker, [{ symbol: "DOGEUSDT",
orderId: "broker-order-1" }])
  assert.deepEqual(calls.pauses, [])
})

test("allows a canonical stream fill to supersede a contradictory REST row when quantity still reconciles", async () => {
  const streamFill = makeFill({ tradeId: "2" })
  const contradictoryRestFill = makeFill({ tradeId: "1",
clientOrderId: "unrelated-client-order" })
  const { workflow, calls } = makeWorkflow({ fills: [contradictoryRestFill] })

  const result = await workflow({ order: makeOrder(),
eventFill: streamFill })

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
    failure: { category: "ACCOUNTING_INTEGRITY",
stage: "FILL_ACCOUNTING",
retryable: false },
  })
  const { workflow, calls } = makeWorkflow({ fills: [makeFill()],
applyResult: failure })

  const result = await workflow({ order: makeOrder() })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "FILL_ACCOUNTING")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_FILL_ACCOUNTING_FAILED")
  assert.equal(calls.applied.length, 1)
})

test("rejects non-terminal order state before reading broker history", async () => {
  const { workflow, calls } = makeWorkflow()

  const result = await workflow({ order: makeOrder({ status: "OPEN",
executedQuantity: "0" }) })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_ORDER_STATE")
  assert.deepEqual(calls.broker, [])
  assert.deepEqual(calls.pauses, [])
})


test("rejects a terminal order without a broker order ID before reading fill history", async () => {
  const { workflow, calls } = makeWorkflow()
  const order = {
    status: "FILLED",
    brokerOrderId: undefined,
    market: { symbol: "DOGEUSDT" },
  }

  const result = await workflow({ order })

  assert.equal(result.ok, false, "A terminal order without exchange identity must fail closed.")
  assert.equal(result.failure.category, "OWNERSHIP_INTEGRITY")
  assert.equal(result.failure.stage, "TERMINAL_ORDER_ID")
  assert.equal(calls.broker.length, 0, "REST fill history must not be queried without a broker order ID.")
  assert.equal(calls.pauses.length, 1, "The affected market must be paused for a missing broker order ID.")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_MISSING_BROKER_ID")
  assert.deepEqual(calls.applied, [], "No fill may be applied without a canonical broker order identity.")
})

test("rejects a terminal order with a whitespace broker order ID before reading fill history", async () => {
  const { workflow, calls } = makeWorkflow()
  const order = {
    status: "FILLED",
    brokerOrderId: "   ",
    market: { symbol: "DOGEUSDT" },
  }

  const result = await workflow({ order })

  assert.equal(result.ok, false, "Whitespace-only exchange identity must fail closed.")
  assert.equal(result.failure.category, "OWNERSHIP_INTEGRITY")
  assert.equal(result.failure.stage, "TERMINAL_ORDER_ID")
  assert.equal(calls.broker.length, 0, "REST fill history must not be queried with a blank broker order ID.")
  assert.equal(calls.pauses.length, 1, "The affected market must be paused for a blank broker order ID.")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_MISSING_BROKER_ID")
  assert.deepEqual(calls.applied, [], "No fill may be applied without a canonical broker order identity.")
})

test("pauses when broker fill history omits an explicit success flag", async () => {
  const { workflow, calls } = makeWorkflow({ brokerResult: { data: [] } })

  const result = await workflow({ order: makeOrder() })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_FILL_HISTORY_RESPONSE")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_FILL_HISTORY_INVALID")
})

test("pauses when broker fill history contains malformed execution records", async () => {
  const { workflow, calls } = makeWorkflow({
    brokerResult: {
      ok: true,
      data: [{}],
    },
  })

  const result = await workflow({ order: makeOrder() })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_FILL_HISTORY_SHAPE")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_FILL_HISTORY_INVALID")
})

test("rejects a stream fill that does not belong to the terminal canonical order", async () => {
  const { workflow, calls } = makeWorkflow()

  const result = await workflow({
    order: makeOrder(),
    eventFill: makeFill({
      tradeId: "9",
      brokerOrderId: "different-order",
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_FILL_IDENTITY")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_FILL_IDENTITY_MISMATCH")
})

test("rejects conflicting duplicate stream facts for the same fill ID", async () => {
  const { workflow, calls } = makeWorkflow({
    processedFills: [makeFill({
      tradeId: "7",
      quantity: "0.5",
    })],
  })

  const result = await workflow({
    order: makeOrder(),
    eventFill: makeFill({
      tradeId: "7",
      quantity: "1",
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_FILL_DUPLICATE")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_FILL_CONFLICTING_DUPLICATE")
})

test("rejects mismatched REST fill identity when no canonical stream fill exists", async () => {
  const { workflow, calls } = makeWorkflow({
    fills: [makeFill({
      tradeId: "8",
      clientOrderId: "unrelated-order",
    })],
  })

  const result = await workflow({ order: makeOrder() })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_REST_FILL_IDENTITY")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_FILL_IDENTITY_MISMATCH")
})

test("rejects conflicting duplicate REST fill facts for the same fill ID", async () => {
  const { workflow, calls } = makeWorkflow({
    fills: [
      makeFill({
        tradeId: "11",
        quantity: "0.5",
      }),
      makeFill({
        tradeId: "11",
        quantity: "1",
      }),
    ],
  })

  const result = await workflow({ order: makeOrder() })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_REST_FILL_DUPLICATE")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_FILL_CONFLICTING_DUPLICATE")
})

test("rejects FILLED status when executed quantity is less than original quantity", async () => {
  const { workflow, calls } = makeWorkflow({
    fills: [makeFill({
      tradeId: "12",
      quantity: "1",
    })],
  })

  const result = await workflow({
    order: makeOrder({
      quantity: "2",
      executedQuantity: "1",
    }),
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.stage, "TERMINAL_ORDER_STATUS")
  assert.equal(calls.pauses[0].reason, "TERMINAL_ORDER_STATUS_QUANTITY_CONFLICT")
})

test("propagates a failed terminal-order reconciliation acknowledgement", async () => {
  const { workflow, calls } = makeWorkflow({
    fills: [makeFill({ tradeId: "13" })],
    onTerminalOrderReconciled: async () => toResult({
      errors: [new Error("terminal order reconciliation was not persisted")],
    }),
  })

  const result = await workflow({ order: makeOrder() })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /not persisted/)
  assert.equal(calls.applied.length, 1)
})
