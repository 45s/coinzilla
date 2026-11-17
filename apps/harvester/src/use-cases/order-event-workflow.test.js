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
import { StrategyId } from "../domain/strategies/strategy-ids.js"
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

function createWorkflowCalls() {
  return {
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
}

function createWorkflowState({ updateResult, activeOrders } = {}) {
  const state = {
    registry: {
      orders: [],
      applyUpdate: () => ({
        ...updateResult,
        registry: state.registry,
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
  return state
}

function createWorkflowEventPublisher({ calls } = {}) {
  return {
    publish: (event) => {
      calls.published.push(event)
      return toResult({ data: { accepted: true } })
    },
  }
}

function createWorkflowAccountingRecorder({ calls, accountedFillIds, accountingResult } = {}) {
  return async ({ fill }) => {
    calls.accounting.push(fill)
    if (accountedFillIds.has(fill.id)) {
      calls.duplicateAccounting.push(fill)
      return toResult({ data: { applied: false,
duplicate: true } })
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
  }
}

function createWorkflowDependencies({
  state,
  calls,
  terminalFills,
  completeResult,
  externalOrdersPolicy,
  isStopping,
  accountingResult,
} = {}) {
  const accountedFillIds = new Set()
  return {
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
    eventPublisher: createWorkflowEventPublisher({ calls }),
    updateTradingAccounting: createWorkflowAccountingRecorder({
      calls,
      accountedFillIds,
      accountingResult,
    }),
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
  }
}

function makeWorkflow({
  updateResult = { applied: true,
duplicate: false,
stale: false },
  accountingResult = toResult({ data: { applied: true,
duplicate: false } }),
  terminalFills = [],
  completeResult = toResult({
    data: {
      eligible: true,
      freeQuantity: "0",
      realizedNetProfit: "1",
    },
  }),
  externalOrdersPolicy = "ignore",
  isStopping = () => false,
  activeOrders = [],
  logger,
  registry,
} = {}) {
  const calls = createWorkflowCalls()
  const state = createWorkflowState({ updateResult,
activeOrders })
  if (registry) {
    state.registry = registry
  }
  const dependencies = createWorkflowDependencies({
    state,
    calls,
    terminalFills,
    completeResult,
    externalOrdersPolicy,
    isStopping,
    accountingResult,
  })
  const workflow = makeOrderEventWorkflow({
    ...dependencies,
    logger,
  })
  return { workflow,
state,
calls }
}

function createLifecycleRegistry({ currentOrder, ownership } = {}) {
  let registeredOrder = currentOrder
  const registry = {
    getOrder({ clientOrderId } = {}) {
      return clientOrderId === registeredOrder.clientOrderId ? registeredOrder : undefined
    },
    getOwnership() {
      return ownership
    },
    applyUpdate({ order } = {}) {
      if (order.status === "CANCELED" && registeredOrder.status === "FILLED") {
        return {
          stale: true,
          duplicate: false,
          registry,
        }
      }
      const previousOrder = registeredOrder
      registeredOrder = order
      return {
        applied: true,
        duplicate: false,
        stale: false,
        registry,
        previousOrder,
      }
    },
    getActiveOrders: () => [],
  }
  return registry
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

test("logs partial fills from reconciled order state with immutable strategy ownership", async () => {
  const previousOrder = makeOrder({
    status: "OPEN",
    quantity: "1",
    executedQuantity: "0",
  })
  const partialOrder = makeOrder({
    status: "PARTIALLY_FILLED",
    quantity: "1",
    executedQuantity: "0.5",
  })
  const ownership = {
    clientOrderId: partialOrder.clientOrderId,
    strategyId: StrategyId.COIN_GRABBER,
    positionId: "doge-coin-grabber",
    purpose: "CONSERVATIVE_BUY",
  }
  const registry = createLifecycleRegistry({
    currentOrder: previousOrder,
    ownership,
  })
  const logs = []
  const { workflow, calls } = makeWorkflow({
    registry,
    logger: {
      info: (entry) => logs.push(entry),
    },
  })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: partialOrder,
      fill: makeFill(),
    },
  })

  assert.equal(result.ok, true, "A reconciled partial fill must complete its order transition.")
  assert.equal(calls.accounting.length, 1, "The lifecycle log must follow canonical fill accounting.")
  assert.equal(logs.length, 1, "One meaningful partial-fill transition must produce one operator record.")
  assert.equal(logs[0].lifecycleStatus, "PARTIAL_FILL")
  assert.equal(logs[0].strategyId, StrategyId.COIN_GRABBER, "Strategy identity must come from registered immutable ownership.")
  assert.equal(logs[0].executedQuantity, "0.5")
  assert.equal(logs[0].remainingQuantity, "0.5")
  assert.equal(logs[0].detail, "Executed: 0.5 | Remaining: 0.5")
})

test("reports a stale cancellation after FILLED as an informational ignored event", async () => {
  const filledOrder = makeOrder({
    status: "FILLED",
    quantity: "1",
    executedQuantity: "1",
  })
  const staleCancellation = makeOrder({
    status: "CANCELED",
    quantity: "1",
    executedQuantity: "1",
  })
  const ownership = {
    clientOrderId: filledOrder.clientOrderId,
    strategyId: StrategyId.COIN_GRABBER,
    positionId: "doge-coin-grabber",
    purpose: "CONSERVATIVE_BUY",
  }
  const registry = createLifecycleRegistry({
    currentOrder: filledOrder,
    ownership,
  })
  const infoLogs = []
  const systemLogs = []
  const { workflow } = makeWorkflow({
    registry,
    logger: {
      info: (entry) => infoLogs.push(entry),
      system: (entry) => systemLogs.push(entry),
    },
  })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "CANCELED",
      executedOrder: staleCancellation,
    },
  })

  assert.equal(result.ok, true, "A stale cancellation must not overturn the already reconciled terminal order state.")
  assert.deepEqual(infoLogs, [], "A stale cancellation must never be presented as a strategy cancellation.")
  assert.equal(systemLogs.length, 1, "The contradictory exchange observation must remain visible as one system diagnostic.")
  assert.equal(systemLogs[0].lifecycleStatus, "STALE_CANCEL_IGNORED")
  assert.equal(systemLogs[0].orderStatus, "FILLED", "The diagnostic must name the current reconciled state.")
  assert.equal(systemLogs[0].strategyId, undefined, "A system diagnostic must not impersonate a strategy event.")
})
