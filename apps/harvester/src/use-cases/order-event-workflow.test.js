import test from "node:test"
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
} from "@coinzilla/entities"
import { toResult } from "@coinzilla/utils"
import { makeOrderEventWorkflow } from "./order-event-workflow.js"

const baseAsset = new Asset({
  id: "doge",
  code: "DOGE"
})
const quoteAsset = new Asset({
  id: "usdt",
  code: "USDT"
})
const market = new Market({
  venue: "binance",
  symbol: "DOGEUSDT",
  baseAsset,
  quoteAsset
})

function makeOrder({
  side = "BUY",
  status = "PARTIALLY_FILLED",
  quantity = "1",
  executedQuantity = "0.5",
  brokerOrderId = "broker-order-1",
  clientOrderId = "h-dogeusdt-order-1",
} = {}) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side,
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: quantity,
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    ...(status === "FILLED" || status === "CANCELED" || status === "EXPIRED" || status === "REJECTED"
      ? { completedAt: 2 }
      : {}),
  })
}

function makeFill({
  side = "BUY",
  tradeId = "1",
  quantity = "0.5",
  quoteQuantity = "50",
  brokerOrderId = "broker-order-1",
  clientOrderId = "h-dogeusdt-order-1",
} = {}) {
  return new Fill({
    tradeId,
    brokerOrderId,
    clientOrderId,
    market,
    side,
    price: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: quoteAsset
    }),
    executedAt: 10,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

// eslint-disable-next-line max-lines-per-function -- workflow fixture owns independent fake outcomes and assertions.
function makeWorkflow({
  updateResult = {
    applied: true,
    duplicate: false,
    stale: false
  },
  accountingResult = toResult({ data: {
    applied: true,
    duplicate: false
  } }),
  terminalFills = [],
  completeResult = toResult({
    data: {
      eligible: true,
      freeQuantity: "0",
      realizedNetProfit: "1"
    },
  }),
  externalOrdersPolicy = "ignore",
  isStopping = () => false,
  activeOrders = [],
} = {}) {
  const calls = {
    published: [],
    pauses: [],
    accounting: [],
    appliedAccounting: [],
    duplicateAccounting: [],
    buyFills: [],
    sellFills: [],
    completedCycles: [],
    cancellations: [],
    evaluations: [],
    buyExecutionPriceReads: [],
  }
  const state = {
    registry: {
      orders: [],
      applyUpdate: () => ({
        ...updateResult,
        registry: state.registry
      }),
      getActiveOrders: () => activeOrders,
    },
    reconciledTerminalOrderClientIds: new Set(),
    unrequestedTerminalOrderClientIds: new Set(),
    completedOrderTransitions: new Set(),
    shutdownRecoveryReplanSymbols: new Set(),
    completedRecoverySellSymbols: new Set(),
    completedRecoverySellOrdersBySymbol: new Map(),
    replacementIntents: new Set(),
    deferredEvaluations: new Set(),
    trailingBuy: new Map(),
    buyReferenceOverrides: new Map(),
    lastBuyPrices: new Map(),
    buyExecutionTotals: new Map(),
    sellExecutionTotals: new Map(),
    processedFillsByOrder: new Map(),
  }
  const accountedFillIds = new Set()
  const eventPublisher = {
    publish: (event) => {
      calls.published.push(event)
      return toResult({ data: { accepted: true } })
    },
  }
  const workflow = makeOrderEventWorkflow({
    state,
    broker: {
      getFills: async () => toResult({ data: terminalFills }),
    },
    pairs: {
      [market.symbol]: {
        keepQuantity: "0",
        minProfit: "0.01",
        externalOrdersPolicy,
      },
    },
    eventPublisher,
    updateTradingAccounting: async ({ fill }) => {
      calls.accounting.push(fill)
      if (accountedFillIds.has(fill.id)) {
        calls.duplicateAccounting.push(fill)
        return toResult({ data: {
          applied: false,
          duplicate: true
        } })
      }
      const result = accountingResult
      if (result?.ok === true && result.data?.applied === true) {
        accountedFillIds.add(fill.id)
        calls.appliedAccounting.push(fill)
      } else if (result?.ok === true && result.data?.duplicate === true) {
        accountedFillIds.add(fill.id)
        calls.duplicateAccounting.push(fill)
      }
      return result
    },
    recordBuyExecutionFill: ({ fill }) => calls.buyFills.push(fill),
    recordSellExecutionFill: ({ fill }) => calls.sellFills.push(fill),
    pause: async (input) => calls.pauses.push(input),
    resolveRecoveryManagedCancellation: () => false,
    cancelAndReconcileRecoverySells: async (input) => {
      calls.cancellations.push(input)
      return toResult({ data: {} })
    },
    evaluateLatestTransition: async (input) => {
      calls.evaluations.push(input)
      return toResult({ data: {} })
    },
    getReconciledBuyExecutionPrice: ({ order }) => {
      calls.buyExecutionPriceReads.push(order)
      return "100"
    },
    isStopping,
    assertReconciledSellExecution: () => {},
    completeRecoveryCycle: async (input) => {
      calls.completedCycles.push(input)
      return completeResult
    },
    publishRecoveryCycleNotCompleted: () => {},
  })
  return {
    workflow,
    state,
    calls
  }
}

test("ignores unmatched manual orders under the default external-order policy", async () => {
  const order = makeOrder({
    brokerOrderId: "manual-order",
    clientOrderId: "manual-client-order",
    status: "OPEN",
    executedQuantity: "0",
  })
  const {
    workflow,
    calls
  } = makeWorkflow({
    updateResult: { unknown: true },
  })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: order,
      clientOrderId: order.clientOrderId
    },
  })

  assert.equal(result.ok, true, "A manual order must remain a diagnostic-only external observation under ignore policy.")
  assert.equal(result.data.externalOrder, true, "The result must distinguish an ignored external order.")
  assert.deepEqual(calls.pauses, [], "Manual external orders must not pause the market under ignore policy.")
  assert.deepEqual(calls.accounting, [], "Manual executions must never update strategy accounting.")
})

test("applies partial BUY fills without advancing strategy evaluation", async () => {
  const order = makeOrder()
  const fill = makeFill()
  const {
    workflow,
    calls
  } = makeWorkflow()

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: order,
      fill
    },
  })

  assert.equal(result.ok, true, "A canonical partial fill must be applied successfully.")
  assert.equal(result.data.waitingForFullFill, true, "A partial BUY must wait for its terminal order state.")
  assert.deepEqual(calls.accounting, [fill], "Only the canonical streamed fill is applied.")
  assert.deepEqual(calls.buyFills, [fill], "BUY execution totals must be updated from the actual fill.")
  assert.deepEqual(calls.evaluations, [], "A partial fill must not advance the strategy.")
  assert.deepEqual(calls.cancellations, [], "A partial fill without an active recovery SELL must not cancel orders.")
})

test("rejects a streamed fill whose broker identity conflicts with the registered order", async () => {
  const order = makeOrder()
  const fill = makeFill({ brokerOrderId: "different-broker-order" })
  const {
    workflow,
    calls
  } = makeWorkflow()

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: order,
      fill
    },
  })

  assert.equal(result.ok, false, "A fill with a different broker order ID must be rejected.")
  assert.equal(result.failure.category, "OWNERSHIP_INTEGRITY", "The mismatch must retain its ownership classification.")
  assert.equal(result.failure.stage, "FILL_ORDER_IDENTITY", "The mismatch must retain its stable failure stage.")
  assert.equal(calls.pauses[0].reason, "EXECUTION_FILL_ORDER_IDENTITY_MISMATCH", "The affected market must fail closed.")
  assert.deepEqual(calls.accounting, [], "Conflicting fill facts must never reach accounting.")
})

test("reconciles a terminal SELL before durably completing its recovery cycle", async () => {
  const order = makeOrder({
    side: "SELL",
    status: "FILLED",
    quantity: "1",
    executedQuantity: "1",
  })
  const fill = makeFill({
    side: "SELL",
    quantity: "1",
    quoteQuantity: "100",
  })
  const {
    workflow,
    state,
    calls
  } = makeWorkflow({ terminalFills: [fill] })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: order
    },
  })

  assert.equal(result.ok, true, "A terminal SELL with complete canonical fills must reconcile.")
  assert.deepEqual(calls.completedCycles, [{
    marketId: market.id,
    keepQuantity: "0",
    minProfit: "0.01",
    sellOrder: order,
  }], "Recovery-cycle completion must receive the exact canonical terminal SELL after fill reconciliation.")
  assert.equal(calls.sellFills.length, 1, "The terminal REST fill must be applied exactly once.")
  assert.equal(state.trailingBuy.get(market.symbol), true, "A completed recovery cycle must re-enable trailing BUY.")
  assert.equal(state.sellExecutionTotals.has(order.brokerOrderId), false, "Completed SELL execution totals must be reset.")
  assert.deepEqual(calls.pauses, [], "A fully reconciled and durably completed SELL must not pause the market.")
})

test("uses the reconciled weighted BUY execution price after terminal fill history", async () => {
  const order = makeOrder({
    status: "FILLED",
    quantity: "1",
    executedQuantity: "1",
  })
  const fill = makeFill({
    quantity: "1",
    quoteQuantity: "100"
  })
  const {
    workflow,
    state,
    calls
  } = makeWorkflow({ terminalFills: [fill] })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: order
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(calls.buyExecutionPriceReads, [order])
  assert.equal(state.lastBuyPrices.get(market.symbol), "100")
})

test("rejects a TRADE event without a canonical Fill before accounting", async () => {
  const order = makeOrder()
  const {
    workflow,
    calls
  } = makeWorkflow()

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: order
    },
  })

  assert.equal(result.ok, false, "A TRADE report without a canonical Fill must fail.")
  assert.equal(result.failure.stage, "STREAM_FILL_MISSING", "The missing-fill failure stage must remain stable.")
  assert.deepEqual(calls.accounting, [], "Missing fill facts must not reach accounting.")
})


test("reconciles recovery SELL coverage after a BUY fill received during shutdown", async () => {
  const order = makeOrder({
    status: "FILLED",
    quantity: "1",
    executedQuantity: "1",
  })
  const fill = makeFill({
    quantity: "1",
    quoteQuantity: "100"
  })
  const activeRecoverySell = makeOrder({
    side: "SELL",
    status: "OPEN",
    quantity: "2",
    executedQuantity: "0",
    brokerOrderId: "broker-recovery-sell",
    clientOrderId: "h-dogeusdt-recovery-sell",
  })
  const {
    workflow,
    state,
    calls
  } = makeWorkflow({
    terminalFills: [fill],
    isStopping: () => true,
    activeOrders: [activeRecoverySell],
  })
  const event = {
    eventType: "executionReport",
    executionType: "TRADE",
    executedOrder: order,
    fill,
  }

  const result = await workflow.processUserDataEventTransition({ event })

  assert.equal(result.ok, true, "A fully reconciled BUY fill during shutdown must remain accounted.")
  assert.deepEqual(calls.cancellations, [], "Recovery SELL cancellation waits until the shutdown event queue has drained.")
  assert.deepEqual(calls.evaluations, [], "A BUY fill during shutdown must not trigger an ordinary strategy evaluation.")
  assert.equal(state.shutdownRecoveryReplanSymbols.has(market.symbol), true, "The shutdown coordinator must receive a durable in-memory replan request.")
  assert.equal(state.lastBuyPrices.get(market.symbol), "100", "The final BUY VWAP must be retained for the final recovery plan.")
  assert.equal(state.trailingBuy.get(market.symbol), false, "A shutdown fill must not re-enable trailing BUY.")
  assert.equal(calls.appliedAccounting.length, 1, "The canonical BUY fill must be applied once.")

  const duplicate = await workflow.processUserDataEventTransition({ event })

  assert.equal(duplicate.ok, true, "A duplicate shutdown fill notification must be harmless.")
  assert.equal(calls.appliedAccounting.length, 1, "A duplicate fill must not be applied twice.")
  assert.equal(state.shutdownRecoveryReplanSymbols.size, 1, "A duplicate fill must not schedule another recovery replan.")
})
