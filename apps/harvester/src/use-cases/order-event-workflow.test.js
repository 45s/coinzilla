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
import { OrderRegistry } from "../domain/orders/order-registry.js"
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

function createOrderProviderProvenance({ includeProviderProvenance, providerInstanceId, accountId }) {
  return includeProviderProvenance
    ? {
      providerInstanceId,
      providerType: "binance",
      accountId,
    }
    : {}
}

function isTerminalOrderStatus({ status }) {
  return ["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(status)
}

function makeOrder({
  side = "BUY",
  status = "PARTIALLY_FILLED",
  quantity = "1",
  executedQuantity = "0.5",
  brokerOrderId = "broker-order-1",
  clientOrderId = "h-dogeusdt-order-1",
  includeProviderProvenance = true,
  market: orderMarket = market,
  providerInstanceId = "binanceTestnet",
  accountId = "binance-primary",
} = {}) {
  return new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    ...createOrderProviderProvenance({
      includeProviderProvenance,
      providerInstanceId,
      accountId,
    }),
    market: orderMarket,
    side,
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: orderMarket.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: quantity,
      asset: orderMarket.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: orderMarket.baseAsset,
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    ...(isTerminalOrderStatus({ status }) ? { completedAt: 2 } : {}),
  })
}

function makeFill({
  side = "BUY",
  tradeId = "1",
  quantity = "0.5",
  quoteQuantity = "50",
  brokerOrderId = "broker-order-1",
  clientOrderId = "h-dogeusdt-order-1",
  includeProviderProvenance = true,
  market: fillMarket = market,
} = {}) {
  return new Fill({
    tradeId,
    brokerOrderId,
    clientOrderId,
    ...(includeProviderProvenance ? {
      providerInstanceId: "binanceTestnet",
      providerType: "binance",
      accountId: "binance-primary",
    } : {}),
    market: fillMarket,
    side,
    price: new Money({
      amount: "100",
      asset: fillMarket.quoteAsset
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: fillMarket.baseAsset
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: fillMarket.quoteAsset
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
    recoverySellerStops: [],
  }
}

function createWorkflowState({ updateResult, activeOrders, registry } = {}) {
  const state = {
    registry: registry ?? {
      orders: [],
      applyUpdate: () => ({
        ...updateResult,
        registry: state.registry,
      }),
      getOwnership: () => undefined,
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

function createWorkflowPairs({ terminalFills, externalOrdersPolicy }) {
  const symbols = new Set([
    market.symbol,
    ...terminalFills.map((fill) => fill.market.symbol),
  ])
  return Object.fromEntries([...symbols].map((symbol) => [symbol, {
    keepQuantity: "0",
    minProfit: "0.01",
    externalOrdersPolicy,
  }]))
}

function createWorkflowDependencies({
  state,
  calls,
  terminalFills,
  completeResult,
  externalOrdersPolicy,
  isStopping,
  accountingResult,
  updateRecoverySellerAccounting,
  reconcileRecoverySellerMixedSell,
  latchRecoverySellerStop,
} = {}) {
  const accountedFillIds = new Set()
  return {
    state,
    broker: {
      getFills: async ({ symbol }) => toResult({
        data: terminalFills.filter((fill) => fill.market.symbol === symbol),
      }),
    },
    pairs: createWorkflowPairs({
      terminalFills,
      externalOrdersPolicy,
    }),
    eventPublisher: createWorkflowEventPublisher({ calls }),
    updateTradingAccounting: createWorkflowAccountingRecorder({
      calls,
      accountedFillIds,
      accountingResult,
    }),
    updateRecoverySellerAccounting,
    reconcileRecoverySellerMixedSell,
    latchRecoverySellerStop,
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
  requireProviderProvenance = false,
  updateRecoverySellerAccounting,
  reconcileRecoverySellerMixedSell,
  latchRecoverySellerStop,
  currentProcessOrderIdNamespace,
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
    updateRecoverySellerAccounting,
    reconcileRecoverySellerMixedSell,
    latchRecoverySellerStop,
  })
  const workflow = makeOrderEventWorkflow({
    ...dependencies,
    logger,
    requireProviderProvenance,
    currentProcessOrderIdNamespace,
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

test("ignores unmatched orders from a prior Harvester process under the default external-order policy", async () => {
  const order = makeOrder({
    brokerOrderId: "previous-session-order",
    clientOrderId: "h-previousprocessnamespace-7",
    status: "OPEN",
    executedQuantity: "0",
  })
  const {
    workflow,
    calls,
  } = makeWorkflow({
    updateResult: { unknown: true },
    currentProcessOrderIdNamespace: "currentprocessnamespace",
  })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: order,
      clientOrderId: order.clientOrderId,
    },
  })

  assert.equal(result.ok, true, "An unmatched prior-session Harvester order must be treated as external to this process.")
  assert.equal(result.data.externalOrder, true, "The prior-session order must remain explicitly external.")
  assert.deepEqual(calls.pauses, [], "A prior-session order must not pause the current process market.")
  assert.deepEqual(calls.accounting, [], "A prior-session execution must never enter current-session accounting.")
})

test("keeps an unmatched order from the current Harvester process fail-closed", async () => {
  const registeredOrder = makeOrder({
    clientOrderId: "h-currentprocessnamespace-1",
    brokerOrderId: "current-session-order-1",
    status: "OPEN",
    executedQuantity: "0",
  })
  const unmatchedCurrentSessionOrder = makeOrder({
    clientOrderId: "h-currentprocessnamespace-2",
    brokerOrderId: "current-session-order-2",
    status: "OPEN",
    executedQuantity: "0",
  })
  const registry = new OrderRegistry({
    orders: [registeredOrder],
  })
  const {
    workflow,
    calls,
  } = makeWorkflow({
    registry,
    currentProcessOrderIdNamespace: "currentprocessnamespace",
  })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: unmatchedCurrentSessionOrder,
      clientOrderId: unmatchedCurrentSessionOrder.clientOrderId,
    },
  })

  assert.equal(result.ok, false, "An unregistered order from this process must remain an ownership-integrity failure.")
  assert.equal(result.failure.stage, "ORDER_REGISTRY_MATCH", "The current-session ownership failure must retain its stable stage.")
  assert.equal(calls.pauses[0]?.reason, "UNKNOWN_OR_EXTERNAL_ORDER_EVENT", "An unresolved current-session order must pause its market.")
  assert.deepEqual(calls.accounting, [], "An unresolved current-session order must not be accounted.")
})

test("keeps an unmatched current-process order fail-closed even when the registry is empty", async () => {
  const order = makeOrder({
    clientOrderId: "h-currentprocessnamespace-2",
    brokerOrderId: "current-session-order-2",
    status: "OPEN",
    executedQuantity: "0",
  })
  const {
    workflow,
    calls,
  } = makeWorkflow({
    registry: new OrderRegistry({ orders: [] }),
    currentProcessOrderIdNamespace: "currentprocessnamespace",
  })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: order,
      clientOrderId: order.clientOrderId,
    },
  })

  assert.equal(result.ok, false, "An unmatched ID from the active process namespace must remain fail-closed without a registered-order hint.")
  assert.equal(result.failure.stage, "ORDER_REGISTRY_MATCH", "The active-process ownership failure must retain its stable stage.")
  assert.equal(calls.pauses[0]?.reason, "UNKNOWN_OR_EXTERNAL_ORDER_EVENT", "An unresolved active-process order must pause its market.")
  assert.deepEqual(calls.accounting, [], "An unresolved active-process order must not mutate strategy accounting.")
})

test("keeps Harvester-looking unknown IDs fail-closed when the process namespace is unavailable", async () => {
  const order = makeOrder({
    clientOrderId: "h-unknownprocessnamespace-2",
    brokerOrderId: "unknown-process-order-2",
    status: "OPEN",
    executedQuantity: "0",
  })
  const {
    workflow,
    calls,
  } = makeWorkflow({
    registry: new OrderRegistry({ orders: [] }),
  })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: order,
      clientOrderId: order.clientOrderId,
    },
  })

  assert.equal(result.ok, false, "A Harvester-looking identity must not be silently classified as external when the active process namespace is unavailable.")
  assert.equal(result.failure.stage, "ORDER_REGISTRY_MATCH", "Missing process identity must retain the ownership-integrity failure.")
  assert.equal(calls.pauses[0]?.reason, "UNKNOWN_OR_EXTERNAL_ORDER_EVENT", "An unresolved Harvester-looking identity must pause its market.")
  assert.deepEqual(calls.accounting, [], "An unresolved Harvester-looking identity must not mutate strategy accounting.")
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

test("publishes registered provider provenance when an incoming order update omits it", async () => {
  const registeredOrder = makeOrder({
    status: "OPEN",
    executedQuantity: "0",
  })
  const incomingOrder = makeOrder({
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.5",
    includeProviderProvenance: false,
  })
  const registry = new OrderRegistry({
    orders: [registeredOrder],
  })
  const {
    workflow,
    state,
    calls,
  } = makeWorkflow({ registry })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: incomingOrder,
      fill: makeFill(),
    },
  })

  assert.equal(result.ok, true, "A valid registered order update must be applied.")
  assert.equal(
    state.registry.getOrder({ clientOrderId: registeredOrder.clientOrderId }).providerInstanceId,
    "binanceTestnet",
    "The order registry must preserve the provider identity from the accepted order.",
  )
  const updatedEvent = calls.published.find((event) => event.name === "order.updated")
  assert.ok(updatedEvent, "An applied order update must publish its lifecycle event.")
  assert.equal(
    updatedEvent.data.providerInstanceId,
    "binanceTestnet",
    "The published order.updated event must retain the accepted provider instance identity.",
  )
  assert.equal(
    updatedEvent.data.providerType,
    "binance",
    "The published order.updated event must retain the provider type.",
  )
  assert.equal(
    updatedEvent.data.accountId,
    "binance-primary",
    "The published order.updated event must retain the account identity.",
  )
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

function createCollidingMarketTerminalFixture() {
  const otherBaseAsset = new Asset({
    id: "eth",
    code: "ETH",
  })
  const otherMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: otherBaseAsset,
    quoteAsset,
  })
  const firstOrder = makeOrder({
    side: "SELL",
    status: "FILLED",
    quantity: "1",
    executedQuantity: "1",
    brokerOrderId: "shared-broker-order",
    clientOrderId: "h-doge-terminal",
    providerInstanceId: "binance-primary",
    accountId: "account-primary",
  })
  const secondOrder = makeOrder({
    side: "SELL",
    status: "FILLED",
    quantity: "1",
    executedQuantity: "1",
    brokerOrderId: "shared-broker-order",
    clientOrderId: "h-eth-terminal",
    market: otherMarket,
    providerInstanceId: "binance-secondary",
    accountId: "account-secondary",
  })
  const fills = [
    makeFill({
      side: "SELL",
      quantity: "1",
      quoteQuantity: "100",
      brokerOrderId: "shared-broker-order",
      clientOrderId: firstOrder.clientOrderId,
      includeProviderProvenance: false,
    }),
    makeFill({
      side: "SELL",
      quantity: "1",
      quoteQuantity: "100",
      brokerOrderId: "shared-broker-order",
      clientOrderId: secondOrder.clientOrderId,
      market: otherMarket,
      includeProviderProvenance: false,
    }),
  ]
  return {
    firstOrder,
    secondOrder,
    fills,
    registry: new OrderRegistry({
      orders: [firstOrder, secondOrder],
    }),
  }
}

async function processTerminalOrder({ workflow, order }) {
  return workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: order,
    },
  })
}

test("attributes terminal fill history by market when broker order IDs collide", async () => {
  const fixture = createCollidingMarketTerminalFixture()
  const { workflow, calls } = makeWorkflow({
    registry: fixture.registry,
    terminalFills: fixture.fills,
  })
  await processTerminalOrder({
    workflow,
    order: fixture.firstOrder,
  })
  await processTerminalOrder({
    workflow,
    order: fixture.secondOrder,
  })

  assert.deepEqual(
    calls.sellFills.map((fill) => [fill.market.symbol, fill.providerInstanceId, fill.accountId]),
    [
      ["DOGEUSDT", "binance-primary", "account-primary"],
      ["ETHUSDT", "binance-secondary", "account-secondary"],
    ],
    "Terminal history must use the order identity from the same market, never a colliding broker ID from another market.",
  )
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
    cycleId: "doge-coin-grabber-cycle-1",
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
  assert.equal(logs[0].lifecycleStatus, "PARTIAL_FILL", "A partial execution must retain its canonical lifecycle status.")
  assert.equal(logs[0].strategyId, StrategyId.COIN_GRABBER, "Strategy identity must come from registered immutable ownership.")
  assert.equal(logs[0].executedQuantity, "0.5", "The lifecycle log must retain the exact executed quantity.")
  assert.equal(logs[0].remainingQuantity, "0.5", "The lifecycle log must retain the exact remaining quantity.")
  assert.equal(logs[0].detail, "Executed: 0.5 | Remaining: 0.5", "The lifecycle log must show exact executed and remaining quantities.")
  const orderUpdatedEvent = calls.published.find(({ name }) => name === "order.updated")
  assert.ok(orderUpdatedEvent, "A canonical partial-fill transition must publish the updated order event.")
  assert.deepEqual(
    orderUpdatedEvent.data.ownership,
    {
      strategyId: StrategyId.COIN_GRABBER,
      positionId: "doge-coin-grabber",
      purpose: "CONSERVATIVE_BUY",
      cycleId: "doge-coin-grabber-cycle-1",
    },
    "The order-updated event must carry the exact immutable ownership returned by OrderRegistry.",
  )
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


test("enriches a provider-less exchange fill from its already registered canonical order", async () => {
  const order = makeOrder()
  const rawFill = makeFill({ includeProviderProvenance: false })
  const { workflow, calls } = makeWorkflow()
  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: order,
      fill: rawFill,
    },
  })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.equal(calls.accounting.length, 1)
  assert.deepEqual([
    calls.accounting[0].providerInstanceId,
    calls.accounting[0].providerType,
    calls.accounting[0].accountId,
    calls.accounting[0].clientOrderId,
  ], ["binanceTestnet", "binance", "binance-primary", order.clientOrderId])
})

test("fails closed and pauses when a legacy order has no recorded provider provenance", async () => {
  const order = makeOrder({ includeProviderProvenance: false })
  const fill = makeFill({ includeProviderProvenance: false })
  const { workflow, calls } = makeWorkflow({ requireProviderProvenance: true })
  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: order,
      fill,
    },
  })
  assert.equal(result.ok, false)
  assert.deepEqual(calls.accounting, [], "Unattributed legacy fills must not reach accounting.")
  assert.equal(calls.pauses[0]?.reason, "EXECUTION_FILL_ORDER_IDENTITY_MISMATCH")
})


test("uses the registry-enriched provider identity when an exchange update omits adapter metadata", async () => {
  const pendingOrder = makeOrder({
    status: "PENDING",
    executedQuantity: "0",
    brokerOrderId: null,
  })
  const { registry } = OrderRegistry.empty().registerPending({ order: pendingOrder })
  const eventOrder = makeOrder({ includeProviderProvenance: false })
  const fill = makeFill({ includeProviderProvenance: false })
  const { workflow, calls } = makeWorkflow({ registry })
  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: eventOrder,
      fill,
    },
  })
  assert.equal(result.ok, true, result.errors?.map(({ message }) => message).join("; "))
  assert.deepEqual([
    calls.accounting[0].providerInstanceId,
    calls.accounting[0].providerType,
    calls.accounting[0].accountId,
  ], ["binanceTestnet", "binance", "binance-primary"])
})


test("routes Recovery Seller-owned fills to RS accounting without mutating Conservative accounting", async () => {
  const recoverySellerOrder = makeOrder({
    clientOrderId: "h-dogeusdt-rs-buy-1",
  })
  const recoverySellerFill = makeFill({
    clientOrderId: recoverySellerOrder.clientOrderId,
  })
  const ownership = {
    clientOrderId: recoverySellerOrder.clientOrderId,
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "doge-recovery-seller-position",
    purpose: "RECOVERY_BUY",
    cycleId: "doge-recovery-seller-cycle-1",
  }
  const registry = createLifecycleRegistry({
    currentOrder: recoverySellerOrder,
    ownership,
  })
  const recoverySellerAccountingCalls = []
  const { workflow, calls } = makeWorkflow({
    registry,
    updateRecoverySellerAccounting: async ({ fill }) => {
      recoverySellerAccountingCalls.push(fill)
      return toResult({ data: {
        applied: true,
        duplicate: false,
      } })
    },
  })

  const result = await workflow.processExecutionFillTransition({
    order: recoverySellerOrder,
    fill: recoverySellerFill,
  })

  assert.equal(result.ok, true, "A valid RS-owned canonical fill must be applied through the RS accounting workflow.")
  assert.deepEqual(recoverySellerAccountingCalls, [recoverySellerFill], "The RS workflow must receive the canonical fill exactly once.")
  assert.deepEqual(calls.accounting, [], "An RS fill must never mutate Conservative Portfolio/RecoveryLedger accounting.")
  assert.deepEqual(calls.buyFills, [], "RS BUY fills must not enter Conservative BUY execution totals.")
})


test("stages streamed RS SELL fills for complete terminal mixed-SELL reconciliation", async () => {
  const recoverySellerOrder = makeOrder({
    side: "SELL",
    clientOrderId: "h-dogeusdt-rs-sell-1",
  })
  const recoverySellerFill = makeFill({
    side: "SELL",
    clientOrderId: recoverySellerOrder.clientOrderId,
  })
  const ownership = {
    clientOrderId: recoverySellerOrder.clientOrderId,
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "doge-recovery-seller-position",
    purpose: "RECOVERY_SELL",
    cycleId: "doge-recovery-seller-cycle-1",
  }
  const registry = createLifecycleRegistry({
    currentOrder: recoverySellerOrder,
    ownership,
  })
  const recoverySellerAccountingCalls = []
  const { workflow, calls } = makeWorkflow({
    registry,
    updateRecoverySellerAccounting: async ({ fill }) => {
      recoverySellerAccountingCalls.push(fill)
      return toResult({ data: {
        applied: true,
        duplicate: false,
      } })
    },
  })

  const result = await workflow.processExecutionFillTransition({
    order: recoverySellerOrder,
    fill: recoverySellerFill,
  })

  assert.equal(result.ok, true, "A canonical streamed RS SELL fill must be staged without committing either accounting projection.")
  assert.equal(result.data.stagedForTerminalReconciliation, true, "The staged result must make the terminal mixed-SELL barrier explicit.")
  assert.deepEqual(calls.sellFills, [recoverySellerFill], "The canonical SELL fill must remain available to complete terminal history reconciliation.")
  assert.deepEqual(calls.accounting, [], "An RS SELL fill must never be applied to Conservative accounting.")
  assert.deepEqual(recoverySellerAccountingCalls, [], "The RS mixed-SELL accounting workflow must wait for the complete terminal fill history.")
  assert.deepEqual(calls.pauses, [], "A valid partial RS SELL fill is expected evidence, not an accounting failure.")
})


function createProfitableMixedSellRecorder({ mixedSellReconciliations } = {}) {
  return async (input) => {
    mixedSellReconciliations.push(input)
    return toResult({
      data: {
        reconciled: true,
        profitability: { eligible: true },
      },
    })
  }
}

function createTerminalRecoverySellerOrderEventFixture({
  terminalStatus = "FILLED",
  executedQuantity = "1",
  fillQuantity = "1",
} = {}) {
  const previousOrder = makeOrder({
    side: "SELL",
    status: "OPEN",
    quantity: "1",
    executedQuantity: "0",
    clientOrderId: "h-dogeusdt-rs-sell-terminal",
    brokerOrderId: "broker-rs-sell-terminal",
  })
  const terminalOrder = makeOrder({
    side: "SELL",
    status: terminalStatus,
    quantity: "1",
    executedQuantity,
    clientOrderId: previousOrder.clientOrderId,
    brokerOrderId: previousOrder.brokerOrderId,
  })
  const fill = makeFill({
    side: "SELL",
    quantity: fillQuantity,
    quoteQuantity: "100",
    clientOrderId: terminalOrder.clientOrderId,
    brokerOrderId: terminalOrder.brokerOrderId,
  })
  const ownership = {
    clientOrderId: terminalOrder.clientOrderId,
    strategyId: StrategyId.RECOVERY_SELLER,
    positionId: "doge-recovery-seller-position",
    purpose: "RECOVERY_SELL",
    cycleId: "doge-recovery-seller-cycle-1",
  }
  const registry = createLifecycleRegistry({
    currentOrder: previousOrder,
    ownership,
  })
  const mixedSellReconciliations = []
  const { workflow, calls } = makeWorkflow({
    registry,
    terminalFills: [fill],
    reconcileRecoverySellerMixedSell: createProfitableMixedSellRecorder({ mixedSellReconciliations }),
    latchRecoverySellerStop: async (input) => {
      calls.recoverySellerStops.push(input)
      return toResult({ data: { durable: true } })
    },
  })
  return {
    terminalOrder,
    fill,
    workflow,
    calls,
    mixedSellReconciliations,
  }
}

async function assertPartialTerminalSellStops({ terminalStatus } = {}) {
  const { terminalOrder, workflow, calls, mixedSellReconciliations } =
    createTerminalRecoverySellerOrderEventFixture({
      terminalStatus,
      executedQuantity: "0.5",
      fillQuantity: "0.5",
    })
  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: terminalOrder,
    },
  })
  assert.equal(mixedSellReconciliations.length, 1)
  assert.equal(result.ok, false)
  assert.equal(calls.recoverySellerStops.length, 1)
  assert.equal(calls.recoverySellerStops[0].reason, "RS_TERMINAL_SELL_NOT_FILLED_STOP")
  assert.equal(calls.recoverySellerStops[0].order, terminalOrder)
  assert.equal(calls.pauses[0].reason, "RS_TERMINAL_SELL_NOT_FILLED_STOP")
  assert.deepEqual(calls.completedCycles, [])
}

test("durably stops after profitable partial CANCELED and EXPIRED Recovery Seller SELLs", async () => {
  await assertPartialTerminalSellStops({ terminalStatus: "CANCELED" })
  await assertPartialTerminalSellStops({ terminalStatus: "EXPIRED" })
})

test("routes terminal RS SELL fill history through mixed accounting without Conservative completion", async () => {
  const {
    terminalOrder,
    fill,
    workflow,
    calls,
    mixedSellReconciliations,
  } = createTerminalRecoverySellerOrderEventFixture()
  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: terminalOrder,
    },
  })

  assert.equal(result.ok, true, "A fully reconciled RS SELL must complete its strategy-owned terminal transition.")
  assert.equal(mixedSellReconciliations.length, 1, "The complete terminal history must be handed to RS mixed accounting exactly once.")
  assert.equal(mixedSellReconciliations[0].order, terminalOrder)
  assert.deepEqual(mixedSellReconciliations[0].canonicalFills, [fill])
  assert.deepEqual(calls.completedCycles, [], "RS SELL must never enter Conservative recovery-cycle completion.")
  assert.deepEqual(calls.sellFills, [fill], "The terminal canonical fill must be staged exactly once.")
})
function createUnderTargetRecoverySellerOrderEventFixture() {
  const terminalOrder = makeOrder({
    side: "SELL",
    status: "FILLED",
    quantity: "1",
    executedQuantity: "1",
    clientOrderId: "h-dogeusdt-rs-sell-under-target-1",
  })
  const fill = makeFill({
    side: "SELL",
    quantity: "1",
    quoteQuantity: "1",
    clientOrderId: terminalOrder.clientOrderId,
    brokerOrderId: terminalOrder.brokerOrderId,
  })
  const registry = createLifecycleRegistry({
    currentOrder: terminalOrder,
    ownership: {
      clientOrderId: terminalOrder.clientOrderId,
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "doge-recovery-seller-position",
      purpose: "RECOVERY_SELL",
      cycleId: "doge-recovery-seller-cycle-under-target-1",
    },
  })
  const { workflow, calls } = makeWorkflow({
    registry,
    terminalFills: [fill],
    reconcileRecoverySellerMixedSell: async () => toResult({
      data: {
        profitability: {
          eligible: false,
        },
      },
    }),
    latchRecoverySellerStop: async (input) => {
      calls.recoverySellerStops.push(input)
      return toResult({
        data: {
          durable: true,
        },
      })
    },
  })
  return {
    terminalOrder,
    workflow,
    calls,
  }
}

test("durably latches global RS STOP after a reconciled FILLED SELL misses profitability", async () => {
  const { terminalOrder, workflow, calls } = createUnderTargetRecoverySellerOrderEventFixture()
  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: terminalOrder,
    },
  })

  assert.equal(result.ok, false,
    "A FILLED under-target SELL must not be reported as a successful terminal strategy transition.")
  assert.equal(calls.recoverySellerStops.length, 1,
    "The adverse realized-profit result must durably latch account-wide STOP.")
  assert.equal(calls.recoverySellerStops[0].order, terminalOrder,
    "The STOP evidence must identify the exact canonical terminal SELL.")
  assert.equal(calls.recoverySellerStops[0].reason, "RS_TERMINAL_SELL_PROFITABILITY_STOP",
    "The durable STOP must use the stable under-target terminal reason.")
  assert.equal(calls.pauses[0].reason, "RS_TERMINAL_SELL_PROFITABILITY_STOP",
    "The affected market must also pause when the global STOP is latched.")
})
test("latches the durable global RS STOP when terminal mixed-SELL reconciliation is unavailable", async () => {
  const terminalOrder = makeOrder({
    side: "SELL",
    status: "FILLED",
    quantity: "1",
    executedQuantity: "1",
    clientOrderId: "h-dogeusdt-rs-sell-stop-1",
  })
  const fill = makeFill({
    side: "SELL",
    quantity: "1",
    quoteQuantity: "100",
    clientOrderId: terminalOrder.clientOrderId,
    brokerOrderId: terminalOrder.brokerOrderId,
  })
  const registry = createLifecycleRegistry({
    currentOrder: terminalOrder,
    ownership: {
      clientOrderId: terminalOrder.clientOrderId,
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "doge-recovery-seller-position",
      purpose: "RECOVERY_SELL",
      cycleId: "doge-recovery-seller-cycle-stop-1",
    },
  })
  const { workflow, calls } = makeWorkflow({
    registry,
    terminalFills: [fill],
    latchRecoverySellerStop: async (input) => {
      calls.recoverySellerStops.push(input)
      return toResult({
        data: {
          durable: true,
        },
      })
    },
  })

  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: terminalOrder,
    },
  })

  assert.equal(result.ok, false)
  assert.equal(calls.recoverySellerStops.length, 1)
  assert.equal(calls.recoverySellerStops[0].order, terminalOrder)
  assert.equal(calls.recoverySellerStops[0].reason, "RS_TERMINAL_MIXED_SELL_RECONCILIATION_UNAVAILABLE")
  assert.equal(calls.pauses[0].reason, "RS_TERMINAL_MIXED_SELL_RECONCILIATION_UNAVAILABLE")
})

test("fails closed for a registered order owned by an unsupported strategy", async () => {
  const unsupportedOrder = makeOrder({
    clientOrderId: "h-dogeusdt-future-strategy-buy-1",
  })
  const unsupportedFill = makeFill({
    clientOrderId: unsupportedOrder.clientOrderId,
  })
  const ownership = {
    clientOrderId: unsupportedOrder.clientOrderId,
    strategyId: "FUTURE_strategy",
    positionId: "future-strategy-position",
    purpose: "FUTURE_BUY",
  }
  const registry = createLifecycleRegistry({
    currentOrder: unsupportedOrder,
    ownership,
  })
  const { workflow, calls } = makeWorkflow({ registry })

  const result = await workflow.processExecutionFillTransition({
    order: unsupportedOrder,
    fill: unsupportedFill,
  })

  assert.equal(result.ok, false, "Unsupported strategy ownership must not fall through to Conservative accounting.")
  assert.deepEqual(calls.accounting, [], "An unsupported strategy fill must not mutate Conservative accounting.")
  assert.equal(calls.pauses[0]?.reason, "EXECUTION_ACCOUNTING_FAILED", "Unsupported attribution must fail closed.")
})

function createRejectedRecoverySellerOrderEventFixture() {
  const previousOrder = makeOrder({
    side: "SELL",
    status: "OPEN",
    quantity: "1",
    executedQuantity: "0",
    clientOrderId: "h-dogeusdt-rs-sell-rejected-1",
    brokerOrderId: "broker-rs-sell-rejected-1",
  })
  const terminalOrder = makeOrder({
    side: "SELL",
    status: "REJECTED",
    quantity: "1",
    executedQuantity: "0",
    clientOrderId: previousOrder.clientOrderId,
    brokerOrderId: previousOrder.brokerOrderId,
  })
  const registry = createLifecycleRegistry({
    currentOrder: previousOrder,
    ownership: {
      clientOrderId: previousOrder.clientOrderId,
      strategyId: StrategyId.RECOVERY_SELLER,
      positionId: "doge-recovery-seller-position",
      purpose: "RECOVERY_SELL",
      cycleId: "doge-recovery-seller-cycle-rejected-1",
    },
  })
  const mixedSellReconciliations = []
  const { workflow, calls } = makeWorkflow({
    registry,
    terminalFills: [],
    reconcileRecoverySellerMixedSell: async (input) => {
      mixedSellReconciliations.push(input)
      return toResult({
        data: {
          reconciled: true,
          profitability: { eligible: false },
        },
      })
    },
    latchRecoverySellerStop: async (input) => {
      calls.recoverySellerStops.push(input)
      return toResult({ data: { durable: true } })
    },
  })
  return {
    terminalOrder,
    workflow,
    calls,
    mixedSellReconciliations,
  }
}

test("routes a zero-fill REJECTED RS SELL through terminal mixed accounting without cycle completion", async () => {
  const { terminalOrder, workflow, calls, mixedSellReconciliations } =
    createRejectedRecoverySellerOrderEventFixture()
  const result = await workflow.processUserDataEventTransition({
    event: {
      eventType: "executionReport",
      executedOrder: terminalOrder,
    },
  })

  assert.equal(result.ok, false, "A zero-fill REJECTED RS SELL must fail closed and latch STOP.")
  assert.equal(calls.recoverySellerStops.length, 1)
  assert.equal(calls.recoverySellerStops[0].reason, "RS_TERMINAL_SELL_NOT_FILLED_STOP")
  assert.equal(calls.pauses[0].reason, "RS_TERMINAL_SELL_NOT_FILLED_STOP")
  assert.equal(mixedSellReconciliations.length, 1)
  assert.deepEqual(mixedSellReconciliations[0].canonicalFills, [])
  assert.deepEqual(calls.completedCycles, [])
  assert.deepEqual(calls.sellFills, [])
})
