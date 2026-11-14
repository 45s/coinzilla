import nodeTest from "node:test"
const test = (name, ...args) => nodeTest(`[conservative-trading-engine.test.js] ${name}`, ...args)
import assert from "node:assert/strict"
import {
  Asset,
  CanonicalOrder,
  Commission,
  Fill,
  Market,
  Money,
  Order,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { Portfolio } from "../domain/portfolio/portfolio.js"
import { Position } from "../domain/portfolio/position.js"
import { OrderRegistry } from "../domain/orders/order-registry.js"
import { RecoveryLedger } from "../domain/strategies/conservative/recovery-ledger.js"
import { evaluateRecoveryCompletion } from "../domain/strategies/conservative/recovery-completion.js"
import { createMarketBook, isPostOnlyOrderCrossing, makeConservativeTradingEngine } from "./conservative-trading-engine.js"
import { HARVESTER_EVENT_NAMES } from "../application/events/event-names.js"
import { createAccountIntegritySafetyHalt } from "./create-account-integrity-safety-halt.js"
import { conservativeStrategyPolicy } from "../domain/strategies/conservative/strategy-policy.js"
import { addDecimal, compareDecimal, multiplyDecimal, subtractDecimal } from "@coinzilla/utils"
import { evaluateConservativeStrategy } from "../domain/strategies/conservative/strategy.js"

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
const marketMetadata = {
  market,
  orderType: "LIMIT_MAKER",
  supportedOrderTypes: ["LIMIT_MAKER", "LIMIT"],
  unvalidatedConstraints: [],
  tradingRules: new TradingRules({
    market,
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({
        amount: "0.01",
        asset: quoteAsset
      })
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({
        amount: "0.1",
        asset: baseAsset
      })
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
        amount: "0.1",
        asset: baseAsset
      })
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: new Money({
        amount: "5",
        asset: quoteAsset
      })
      },
    ],
  }),
}
const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false }
      },
      pairs: {
    DOGEUSDT: {
      enabled: true,
      investment: 1000,
      orderQuantity: 1,
      keepQuantity: 0.1,
      minProfit: 0.01,
      priceStepPercent: 0.05,
      makerPercent: 0,
      takerPercent: 0.075,
      },
    },
  },
  },
}

const withExternalOrdersPolicy = (externalOrdersPolicy) => ({
  ...appConfig,
  strategies: {
    ...appConfig.strategies,
    CG_coinGrabber: {
      ...appConfig.strategies.CG_coinGrabber,
      pairs: {
        ...appConfig.strategies.CG_coinGrabber.pairs,
        DOGEUSDT: {
          ...appConfig.strategies.CG_coinGrabber.pairs.DOGEUSDT,
          externalOrdersPolicy,
        },
      },
    },
  },
})

// eslint-disable-next-line complexity, max-lines-per-function -- test harness centralizes independent fake-broker outcomes for deterministic coverage.
async function createHarness({
  strategyPolicy,
  hasUnownedOpenOrdersForSymbol = () => false,
  hasUnresolvedHarvesterOpenOrdersForSymbol = () => false,
  appConfig: suppliedAppConfig,
  isMarketPriceFresh = () => true,
  isMarketBookFresh = () => true,
  initialBook = true,
  marketMetadata: suppliedMarketMetadata,
  getMarketMetadata: getMarketMetadataOverride,
  getSymbolFilters: getSymbolFiltersOverride,
  placeOrderFailureAfterFirst = false,
  placeOrderFailureAfterCount,
  placeOrderFailureError,
  placeOrderFailureCount = 0,
  cancelWithFill = false,
  cancelExecutedQuantity = cancelWithFill ? "0.1" : "0",
  cancelOrderStatus = "CANCELED",
  cancelOrderGate,
  onCancelOrderStarted,
  eventPublisher,
  placeOrderFailure = false,
  placeOrderThrow = false,
  cancelFailure = false,
  cancelThrow = false,
  cancelNotSent = false,
  cancelNotSentOnSuccess = false,
  onPlaceOrder,
  placeOrderGate,
  deferOrderSide = "SELL",
  onPlaceOrderStarted,
  initialPortfolio,
  initialRecoveryLedger,
  getPortfolio: getPortfolioOverride,
  getRecoveryLedger: getRecoveryLedgerOverride,
  updateTradingAccounting: updateTradingAccountingOverride,
  completeRecoveryCycle: completeRecoveryCycleOverride,
  baseFreeBalance = "0",
  quoteFreeBalance = "1000",
  quoteCashFlowBaseline = "0",
  portfolioBaseQuantityBaseline = "0",
  committedQuoteBalanceBaseline = "0",
  committedBaseBalanceBaseline = "0",
  accountingApplied = false,
  accountingFailure = false,
  immediateFilledAcknowledgement = false,
  getAcknowledgedFills = () => [],
  acknowledgedFillsGate,
  getTerminalFills = () => [],
  recoveryCompletion = {
  eligible: true,
  freeQuantity: "0.1",
  realizedNetProfit: "1.5"
},
  getVolatilityData: getVolatilityDataOverride,
  onOperationalStateCancellationIntent,
  onOperationalStateCancellationOutcome,
  onOperationalStateStrategyMarketPaused,
  canTrade: canTradeOverride = () => true,
  isStopping: isStoppingOverride = () => false,
  initialState
} = {}) {
  const orders = []
  const pauses = []
  const accountedFills = []
  const accountedFillIds = new Set()
  const completedCycles = []
  const cancellationIds = []
  const canceledOrders = new Map()
  const acknowledgedFillsByOrder = new Map()
  const acknowledgedOrdersById = new Map()
  const canonicalOrdersByClientId = new Map()
  let remainingPlaceOrderFailures = placeOrderFailure ? Number.POSITIVE_INFINITY : placeOrderFailureCount
  let placeOrderCallCount = 0
  const broker = {
    getSymbolFilters: async ({ symbol }) => getSymbolFiltersOverride
      ? getSymbolFiltersOverride({ symbol })
      : {
          ok: true,
          data: getMarketMetadataOverride ? getMarketMetadataOverride() : (suppliedMarketMetadata ?? marketMetadata),
        },
    placeOrder: async ({ order }) => {
      placeOrderCallCount += 1
      orders.push(order)
      onPlaceOrder?.({ order })
      onPlaceOrderStarted?.({ order })
      if (placeOrderGate && order.side === deferOrderSide) {await placeOrderGate.promise}
      if (placeOrderThrow) {throw new Error("socket closed")}
      if (placeOrderFailureAfterCount !== undefined && placeOrderCallCount > placeOrderFailureAfterCount) {
        return {
          ok: false,
          errors: [placeOrderFailureError ?? new Error("replacement rejected")]
        }
      }
      if (placeOrderFailureAfterFirst && placeOrderCallCount > 1) {
        return {
          ok: false,
          errors: [placeOrderFailureError ?? new Error("replacement rejected")]
        }
      }
      if (remainingPlaceOrderFailures > 0) {
        if (Number.isFinite(remainingPlaceOrderFailures)) {remainingPlaceOrderFailures -= 1}
        return {
          ok: false,
          errors: [placeOrderFailureError ?? new Error("broker rejected order")]
        }
      }
      const acknowledgedOrder = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: `broker-${order.clientOrderId}`,
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({
          amount: order.price,
          asset: quoteAsset
        }),
        originalQuantity: new Quantity({
          amount: order.quantity,
          asset: baseAsset
        }),
        executedQuantity: new Quantity({
          amount: immediateFilledAcknowledgement ? order.quantity : "0",
          asset: baseAsset,
        }),
        status: immediateFilledAcknowledgement ? "FILLED" : "OPEN",
        createdAt: 1,
        acknowledgedAt: 1,
        updatedAt: 1,
        ...(immediateFilledAcknowledgement ? { completedAt: 2 } : {}),
      })
      if (immediateFilledAcknowledgement) {
        acknowledgedOrdersById.set(acknowledgedOrder.brokerOrderId, acknowledgedOrder)
        acknowledgedFillsByOrder.set(
          acknowledgedOrder.brokerOrderId,
          getAcknowledgedFills({ order: acknowledgedOrder }),
        )
      }
      return {
        ok: true,
        data: acknowledgedOrder
      }
    },
    cancelOrder: async ({ order }) => {
      cancellationIds.push(order.brokerOrderId)
      onCancelOrderStarted?.({ order })
      if (cancelOrderGate) {await cancelOrderGate.promise}
      if (cancelThrow) {throw new Error("cancel socket closed")}
      if (cancelNotSent) {return {
        ok: false,
        cancellationOutcome: "NOT_SENT",
        errors: [new Error("user-data stream unavailable")]
      }}
      if (cancelNotSentOnSuccess) {return {
        ok: true,
        cancellationOutcome: "NOT_SENT",
        errors: [new Error("contradictory cancellation result")]
      }}
      if (cancelFailure) {return {
        ok: false,
        errors: [new Error("cancel denied")]
      }}
      canceledOrders.set(order.brokerOrderId, order)
      const executedQuantity = typeof cancelExecutedQuantity === "function"
        ? cancelExecutedQuantity({ order })
        : cancelExecutedQuantity
      const resolvedCancelOrderStatus = typeof cancelOrderStatus === "function"
        ? cancelOrderStatus({ order })
        : cancelOrderStatus
      return {
      ok: true,
      data: new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        market,
        side: order.side,
        type: order.type,
        limitPrice: order.limitPrice,
        originalQuantity: order.originalQuantity,
        executedQuantity: new Quantity({
          amount: executedQuantity,
          asset: baseAsset,
        }),
        status: resolvedCancelOrderStatus,
        createdAt: order.createdAt,
        acknowledgedAt: order.acknowledgedAt,
        updatedAt: 2,
        completedAt: 2,
      }),
    }
    },
    getFills: async ({ orderId }) => {
      if (acknowledgedFillsByOrder.has(orderId)) {
        if (acknowledgedFillsGate) {await acknowledgedFillsGate.promise}
        const fills = acknowledgedFillsByOrder.get(orderId)
        return {
          ok: true,
          data: typeof fills === "function" ? fills() : fills
        }
      }
      const canceledOrder = canceledOrders.get(orderId)
      const executedQuantity = canceledOrder && (typeof cancelExecutedQuantity === "function"
        ? cancelExecutedQuantity({ order: canceledOrder })
        : cancelExecutedQuantity)
      const cancelFill = cancelWithFill && canceledOrder
        ? [new Fill({
            tradeId: `recovery-cancel-fill-${canceledOrder.side.toLowerCase()}-${orderId}`,
            brokerOrderId: orderId,
            clientOrderId: canceledOrder.clientOrderId,
            market,
            side: canceledOrder.side,
            price: canceledOrder.limitPrice,
            quantity: new Quantity({
              amount: executedQuantity,
              asset: baseAsset
            }),
            quoteQuantity: new Money({
              amount: multiplyDecimal({
                left: canceledOrder.limitPrice.amount,
                right: executedQuantity
              }),
              asset: quoteAsset,
            }),
            commissions: [],
            commissionStatus: "COMPLETE",
          })]
        : []
      return {
        ok: true,
        data: [
          ...accountedFills.filter((fill) => fill.brokerOrderId === orderId),
          ...cancelFill,
          ...getTerminalFills({ orderId }),
        ],
      }
    },
    getCanonicalOrder: async ({ clientOrderId }) => {
      const order = canonicalOrdersByClientId.get(clientOrderId)
      return order
        ? {
          ok: true,
          data: order
        }
        : {
          ok: false,
          errors: [new Error("order not found by client order ID")]
        }
    },
    getOpenOrders: async () => ({
      ok: true,
      data: []
    }),
    getCanonicalOrderHistory: async ({ orderId }) => ({
      ok: true,
      data: acknowledgedOrdersById.has(orderId) ? [acknowledgedOrdersById.get(orderId)] : [],
    }),
  }
  const accountSnapshot = {
    getFreeBalance: ({ assetId }) => assetId === quoteAsset.id
      ? new Quantity({
        amount: quoteFreeBalance,
        asset: quoteAsset
      })
      : new Quantity({
        amount: baseFreeBalance,
        asset: baseAsset
      }),
    getQuoteCashFlowBaseline: ({ assetId }) => assetId === quoteAsset.id
      ? quoteCashFlowBaseline
      : "0",
    getPortfolioBaseQuantityBaseline: ({ assetId }) => assetId === baseAsset.id ? portfolioBaseQuantityBaseline : "0",
    getCommittedQuoteBalanceBaseline: ({ assetId }) => assetId === quoteAsset.id ? committedQuoteBalanceBaseline : "0",
    getCommittedBaseBalanceBaseline: ({ assetId }) => assetId === baseAsset.id ? committedBaseBalanceBaseline : "0",
  }
  let currentPortfolio = initialPortfolio ?? new Portfolio()
  let currentRecoveryLedger = initialRecoveryLedger ?? RecoveryLedger.empty({ market })
  const effectiveEventPublisher = eventPublisher
    ? {
        ...eventPublisher,
        flush: typeof eventPublisher.flush === "function"
          ? eventPublisher.flush
          : async () => ({
            ok: true,
            durable: true
          }),
      }
    : undefined
  // The synthetic seeded portfolio below is built from a completed BUY fill at 100.
  // The engine intentionally does not infer a reconciled VWAP from portfolio totals,
  // so expose that known fixture evidence to the policy in seeded-position tests.
  const defaultStrategyPolicy = initialPortfolio
    ? {
        ...conservativeStrategyPolicy,
        evaluate: (input) => conservativeStrategyPolicy.evaluate({
          ...input,
          lastBuyPrice: "100"
        }),
      }
    : conservativeStrategyPolicy
  const engine = makeConservativeTradingEngine({
    broker,
    strategyPolicy: strategyPolicy ?? defaultStrategyPolicy,
    hasUnownedOpenOrdersForSymbol,
    hasUnresolvedHarvesterOpenOrdersForSymbol,
    isMarketPriceFresh,
    isMarketBookFresh,
    getVolatilityData: getVolatilityDataOverride,
    onOperationalStateCancellationIntent,
    onOperationalStateCancellationOutcome,
    onOperationalStateStrategyMarketPaused,
    eventPublisher: effectiveEventPublisher,
    appConfig: suppliedAppConfig ?? appConfig,
    getPortfolio: getPortfolioOverride ?? (() => currentPortfolio),
    getRecoveryLedger: getRecoveryLedgerOverride ?? (() => currentRecoveryLedger),
    getMarketMetadata: () => getMarketMetadataOverride ? getMarketMetadataOverride() : (suppliedMarketMetadata ?? marketMetadata),
    getAccountSnapshot: () => accountSnapshot,
    updateTradingAccounting: updateTradingAccountingOverride ?? (async ({ fill }) => {
      if (accountingFailure) {
        accountedFills.push(fill)
        return {
          ok: false,
          errors: [new Error("unsupported commission asset")]
        }
      }
      if (accountedFillIds.has(fill.id)) {
        return {
          ok: true,
          data: {
          applied: false,
          duplicate: true
        }
        }
      }
      accountedFillIds.add(fill.id)
      accountedFills.push(fill)
      return {
        ok: true,
        data: {
        applied: accountingApplied,
        duplicate: !accountingApplied
      }
      }
    }),
    completeRecoveryCycle: completeRecoveryCycleOverride ?? (async ({ marketId }) => {
      completedCycles.push(marketId)
      return {
        ok: true,
        data: recoveryCompletion
      }
    }),
    canTrade: canTradeOverride,
    isStopping: isStoppingOverride,
    onPause: async ({ reason }) => pauses.push(reason),
    initialState,
  })
  if (initialBook) {await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: initialBook === true ? {
    symbol: "DOGEUSDT",
    bestBidPrice: "0.01",
    bestBidQuantity: "1",
    bestAskPrice: "1000",
    bestAskQuantity: "1",
    timestamp: 1,
  } : initialBook
  })}
  return {
    engine,
    broker,
    orders,
    pauses,
    accountedFills,
    completedCycles,
    cancellationIds,
    getCurrentPortfolio: () => currentPortfolio,
    getCurrentRecoveryLedger: () => currentRecoveryLedger,
    setCurrentPortfolio: (next) => { currentPortfolio = next },
    setCurrentRecoveryLedger: (next) => { currentRecoveryLedger = next },
    setCanonicalOrderLookup: ({
      order,
      clientOrderId = order.clientOrderId
    }) => canonicalOrdersByClientId.set(clientOrderId, order),
    setAcknowledgedOrder: ({
      order,
      fills = []
    }) => {
      acknowledgedOrdersById.set(order.brokerOrderId, order)
      acknowledgedFillsByOrder.set(order.brokerOrderId, fills)
    },
  }
}



test("ignores manual external open orders under the default per-pair policy", async () => {
  const harness = await createHarness({
    hasUnownedOpenOrdersForSymbol: () => true,
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now()
    },
  })
  assert.equal(harness.orders.length, 1, "The default ignore policy must not defer the pair because of a manual order.")
})

test("keeps unresolved Harvester-owned orders blocked regardless of the external-order policy", async () => {
  const harness = await createHarness({
    hasUnresolvedHarvesterOpenOrdersForSymbol: () => true,
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now()
    },
  })
  assert.equal(result.ok, true, "A safety deferral is not an execution failure.")
  assert.equal(harness.orders.length, 0, "An unresolved prior-process Harvester order must block new submissions.")
  assert.deepEqual(harness.engine.getRecoveryIntents().deferredEvaluations, ["DOGEUSDT"])
})

test("defers strategy activity only for the symbol with an unowned open order", async () => {
  const sameSymbolHarness = await createHarness({
    appConfig: withExternalOrdersPolicy("block"),
    hasUnownedOpenOrdersForSymbol: ({ symbol }) => symbol === "DOGEUSDT",
  })
  await sameSymbolHarness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now()
    },
  })
  assert.equal(sameSymbolHarness.orders.length, 0)

  const unrelatedSymbolHarness = await createHarness({
    appConfig: withExternalOrdersPolicy("block"),
    hasUnownedOpenOrdersForSymbol: ({ symbol }) => symbol === "BTCUSDT",
  })
  await unrelatedSymbolHarness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now()
    },
  })
  assert.equal(unrelatedSymbolHarness.orders.length, 1)
})

test("rechecks external-order ownership after the durable order intent and before broker submission", async () => {
  let hasExternalOrder = false
  const harness = await createHarness({
    appConfig: withExternalOrdersPolicy("block"),
    hasUnownedOpenOrdersForSymbol: () => hasExternalOrder,
    eventPublisher: {
      publish: () => ({ ok: true }),
      flush: async () => {
        hasExternalOrder = true
        return {
          ok: true,
          durable: true
        }
      },
    },
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(harness.orders, [])
  assert.equal(harness.engine.getOrders().length, 0)
  assert.deepEqual(harness.engine.getRecoveryIntents().deferredEvaluations, ["DOGEUSDT"])
})

test("subtracts only shared BUY commitments created after the account snapshot", async () => {
  const ethAsset = new Asset({
    id: "eth",
    code: "ETH"
  })
  const ethMarket = new Market({
    venue: "binance",
    symbol: "ETHUSDT",
    baseAsset: ethAsset,
    quoteAsset
  })
  const otherMarketBuy = new CanonicalOrder({
    clientOrderId: "eth-shared-quote-buy",
    brokerOrderId: "broker-eth-shared-quote-buy",
    market: ethMarket,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "50",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "3",
      asset: ethAsset
    }),
    executedQuantity: new Quantity({
      amount: "1",
      asset: ethAsset
    }),
    status: "PARTIALLY_FILLED",
  })
  assert.equal(otherMarketBuy.remainingQuantity.amount, "2", "The partially filled ETHUSDT BUY must expose the exact two-unit remaining commitment (three original units minus one executed unit), which is the quantity used by account-wide quote reservation.")
  const harness = await createHarness({
    quoteFreeBalance: "100",
    committedQuoteBalanceBaseline: "100",
    initialState: { orderRegistry: new OrderRegistry({ orders: [otherMarketBuy] }) },
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, true, "A BUY on DOGEUSDT must remain fundable when the shared USDT snapshot already excludes a partially filled ETHUSDT BUY lock.")
  assert.equal(harness.orders.length, 1, "The current DOGEUSDT decision must submit exactly one BUY after accounting for only post-snapshot shared-quote commitment changes.")
  assert.equal(harness.orders[0].side, "BUY", "The submitted action must remain the strategy's BUY, not an unrelated order from the other market.")
})

test("does not double-count historical quote cash flow already reflected in a refreshed account snapshot", async () => {
  const position = new Position({
    market,
    baseQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    freeBaseQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    quoteNetCashFlow: new Money({
      amount: "100",
      asset: quoteAsset
    }),
  })
  const harness = await createHarness({
    initialPortfolio: new Portfolio({ positions: [position] }),
    initialRecoveryLedger: RecoveryLedger.empty({ market }),
    quoteFreeBalance: "0",
    quoteCashFlowBaseline: "100",
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(result.data.submittedOrders.length, 0)
  assert.equal(result.data.deferredActions[0].reason, "INSUFFICIENT_QUOTE_BALANCE")
  assert.deepEqual(harness.orders, [])
})

test("adds only quote cash flow accrued after the latest account snapshot baseline", async () => {
  const position = new Position({
    market,
    baseQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    freeBaseQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    quoteNetCashFlow: new Money({
      amount: "120",
      asset: quoteAsset
    }),
  })
  const harness = await createHarness({
    initialPortfolio: new Portfolio({ positions: [position] }),
    initialRecoveryLedger: RecoveryLedger.empty({ market }),
    quoteFreeBalance: "80",
    quoteCashFlowBaseline: "100",
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(result.data.submittedOrders.length, 1)
  assert.equal(result.data.submittedOrders[0].side, "BUY")
})

test("durably journals the submission intent before calling the broker", async () => {
  const sequence = []
  const harness = await createHarness({
    eventPublisher: {
      publish: (event) => {
        sequence.push(`publish:${event.name}`)
        return { ok: true }
      },
      flush: async () => {
        sequence.push("flush")
        return {
          ok: true,
          durable: true
        }
      },
    },
    onPlaceOrderStarted: () => sequence.push("broker:place"),
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, true)
  assert.ok(sequence.indexOf("publish:order.submission_requested") >= 0)
  assert.ok(sequence.indexOf("flush") > sequence.indexOf("publish:order.submission_requested"))
  assert.ok(sequence.indexOf("broker:place") > sequence.indexOf("flush"))
})

test("does not submit an order when its durable intent flush fails", async () => {
  const harness = await createHarness({
    eventPublisher: {
      publish: () => ({ ok: true }),
      flush: async () => ({
        ok: false,
        errors: [new Error("journal sync failed")]
      }),
    },
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, false)
  assert.equal(harness.orders.length, 0)
  assert.equal(harness.engine.getOrders().length, 0)
  assert.ok(harness.pauses.includes("ORDER_INTENT_NOT_DURABLE"))
})

test("waits for executions behind an immediate FILLED acknowledgement before evaluating the next market event", async () => {
  let releaseFills
  let signalFillsStarted
  const acknowledgedFillsGate = {
    promise: new Promise((resolve) => { releaseFills = resolve }),
  }
  const fillsStarted = new Promise((resolve) => { signalFillsStarted = resolve })
  const strategyPolicy = {
    evaluate: ({ lastBuyPrice }) => ({
      strategy: "TEST_POLICY",
      symbol: "DOGEUSDT",
      action: lastBuyPrice ? "NO_ACTION" : "PLACE_ORDERS",
      actions: lastBuyPrice ? [] : [{
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "99.95",
        quantity: "1",
      }],
    }),
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const harness = await createHarness({
    strategyPolicy,
    immediateFilledAcknowledgement: true,
    acknowledgedFillsGate,
    getAcknowledgedFills: ({ order }) => {
      signalFillsStarted()
      return [
        makeBuyFill({
          order,
          tradeId: "immediate-ack-fill-1",
          price: "99.95",
          quantity: "0.4",
          quoteQuantity: "39.98",
          executedAt: 10,
        }),
        makeBuyFill({
          order,
          tradeId: "immediate-ack-fill-2",
          price: "99.95",
          quantity: "0.6",
          quoteQuantity: "59.97",
          executedAt: 11,
        }),
      ]
    },
  })

  const firstPrice = harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  await fillsStarted
  const secondPrice = harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "101",
      timestamp: 2
    },
  })

  assert.equal(harness.orders.length, 1)
  assert.equal(harness.accountedFills.length, 0)

  releaseFills()
  const [firstResult, secondResult] = await Promise.all([firstPrice, secondPrice])

  assert.equal(firstResult.ok, true, firstResult.errors?.[0]?.message)
  assert.equal(secondResult.ok, true, secondResult.errors?.[0]?.message)
  assert.equal(harness.orders.length, 1)
  assert.deepEqual(harness.accountedFills.map((fill) => fill.tradeId), ["immediate-ack-fill-1", "immediate-ack-fill-2"])
  assert.equal(harness.engine.getPausedMarkets().length, 0)
})

test("pauses an immediately FILLED acknowledged order when execution history is incomplete", async () => {
  const harness = await createHarness({
    immediateFilledAcknowledgement: true,
    getAcknowledgedFills: () => [],
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
  assert.ok(harness.pauses.includes("ACKNOWLEDGED_FILL_HISTORY_INCOMPLETE"))
})

test("pauses when FILLED acknowledgement history repeats a fill ID with conflicting data", async () => {
  const harness = await createHarness({
    immediateFilledAcknowledgement: true,
    getAcknowledgedFills: ({ order }) => [
      makeBuyFill({
        order,
        tradeId: "conflicting-ack-fill",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95",
        executedAt: 10,
      }),
      makeBuyFill({
        order,
        tradeId: "conflicting-ack-fill",
        price: "99.95",
        quantity: "0.5",
        quoteQuantity: "49.975",
        executedAt: 10,
      }),
    ],
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
  assert.ok(harness.pauses.includes("ACKNOWLEDGED_FILL_HISTORY_CONFLICTING_DUPLICATE"))
  assert.equal(harness.accountedFills.length, 0)
})

test("pauses after an invalid strategy order and does not reevaluate it on later market events", async () => {
  let evaluations = 0
  const strategyPolicy = {
    evaluate: () => {
      evaluations += 1
      return {
        strategy: "TEST_POLICY",
        symbol: "DOGEUSDT",
        action: "PLACE_ORDERS",
        actions: [{
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "0.01",
          quantity: "1",
        }],
      }
    },
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const harness = await createHarness({ strategyPolicy })

  const first = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const second = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "101",
      timestamp: 2
    },
  })

  assert.equal(first.ok, false)
  assert.equal(second.ok, true)
  assert.equal(evaluations, 1)
  assert.equal(harness.orders.length, 0)
  assert.ok(harness.pauses.includes("STRATEGY_ORDER_VALIDATION_FAILED"))
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
})

test("trails an initial BUY upward only after one full step and replaces it below the latest trade", async () => {
  const {
    engine,
    orders,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(orders.length, 1)
  assert.equal(orders[0].price, "99.95")

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })
  assert.equal(orders.length, 2)
  assert.equal(orders[1].price, "100")
  assert.deepEqual(pauses, [])

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.11",
      timestamp: 3
    },
  })
  assert.equal(orders.length, 2)

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.11003",
      timestamp: 4
    },
  })
  assert.equal(orders.length, 3)
  assert.equal(orders[2].price, "100.05")
})

test("reconciles and pauses when a BUY fills during trailing cancellation", async () => {
  const {
    engine,
    orders,
    pauses,
    accountedFills
  } = await createHarness({ cancelWithFill: true })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })
  assert.equal(result.ok, false)
  assert.equal(orders.length, 1)
  assert.equal(accountedFills.length, 1)
  assert.ok(pauses.includes("TRAILING_BUY_FILLED_DURING_CANCEL"))
})


test("publishes actionable decisions and order submission facts around broker I/O", async () => {
  const events = []
  const timeline = []
  const harness = await createHarness({
    onPlaceOrder: () => timeline.push("broker.placeOrder"),
    eventPublisher: { publish: (event) => {
      events.push(event)
      timeline.push(`event:${event.name}`)
      if (event.name === "order.submission_requested") {
        assert.equal(harness.engine.getOrders()[0].status, "PENDING")
      }
      if (event.name === "order.submitted") {
        assert.equal(harness.engine.getOrders()[0].status, "OPEN")
      }
      return { ok: true }
    } },
  })
  const orders = harness.orders
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(orders.length, 1)
  assert.deepEqual(timeline, [
    "event:strategy.decision",
    "event:order.submission_requested",
    "broker.placeOrder",
    "event:order.submitted",
  ])
  assert.deepEqual(events.map(({ name }) => name), [
    "strategy.decision",
    "order.submission_requested",
    "order.submitted",
  ])
  assert.equal(events[0].data.strategy, "CONSERVATIVE")
  assert.equal(events[0].data.symbol, "DOGEUSDT")
  assert.equal(events[0].data.referencePrice, "100")
  assert.equal(events[0].data.reason, "INITIAL_BUY")
  assert.equal(events[0].data.inputs.freeQuoteBalance, "1000")
  assert.equal(events[0].data.inputs.investmentLimit, "1000")
  assert.equal(events[0].data.inputs.priceStepPercent, "0.05")
  assert.deepEqual(events[0].data.actions, [{
    side: "BUY",
    type: "LIMIT_MAKER",
    price: "99.95",
    quantity: "1",
    reason: "INITIAL_BUY",
  }])
  assert.equal(events[1].data.status, "PENDING")
  const clientOrderId = events[1].data.clientOrderId
  assert.match(clientOrderId, /^h-[0-9a-f]{22}-1$/)
  assert.equal(events[2].data.status, "OPEN")
  assert.equal(events[2].data.brokerOrderId, `broker-${clientOrderId}`)
})

test("order intent publication failure prevents a broker order", async () => {
  const {
    engine,
    orders,
    pauses
  } = await createHarness({
    eventPublisher: { publish: () => { throw new Error("observer unavailable") } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, false)
  assert.equal(orders.length, 0)
  assert.ok(pauses.includes("ORDER_INTENT_NOT_DURABLE"))
})


test("does not publish repeated NO_ACTION evaluations", async () => {
  const events = []
  const { engine } = await createHarness({
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const countAfterSubmission = events.length
  const result = await engine.evaluateLatest({ symbol: "DOGEUSDT" })

  assert.equal(result.ok, true)
  assert.equal(result.data.decision.action, "NO_ACTION")
  assert.equal(events.length, countAfterSubmission)
})

test("publishes rejected submission outcome without blocking pair pause", async () => {
  const events = []
  const {
    engine,
    pauses
  } = await createHarness({
    placeOrderFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(events.map(({ name }) => name), [
    "strategy.decision",
    "order.submission_requested",
    "order.submission_failed",
    "strategy.paused",
  ])
  assert.equal(events[2].data.outcome, "REJECTED_OR_UNKNOWN")
  assert.match(events[2].data.clientOrderId, /^h-[0-9a-f]{22}-1$/)
  assert.ok(pauses.includes("ORDER_SUBMISSION_REJECTED_OR_UNKNOWN"))
})


test("does not await a pending EventBus publisher promise", async () => {
  let resolvePublisher
  const publisherPromise = new Promise((resolve) => { resolvePublisher = resolve })
  const {
    engine,
    orders
  } = await createHarness({
    eventPublisher: { publish: () => publisherPromise },
  })
  const processing = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  let timeout
  const result = await Promise.race([
    processing.then((value) => ({ value })),
    new Promise((resolve) => { timeout = setTimeout(() => resolve(null), 100) }),
  ])
  clearTimeout(timeout)
  resolvePublisher({ ok: true })
  if (result === null) {await processing}
  assert.ok(result, "strategy processing must not wait for the EventBus publisher promise")
  assert.equal(result.value.ok, true)
  assert.equal(orders.length, 1)
})

test("publishes unknown submission outcome after a transport exception", async () => {
  const events = []
  const { engine } = await createHarness({
    placeOrderThrow: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(result.ok, false)
  const failed = events.find(({ name }) => name === "order.submission_failed")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNKNOWN")
  assert.equal(events.at(-1).name, "strategy.paused")
})


test("publishes one pause transition even when the pair encounters repeated pause causes", async () => {
  const events = []
  const { engine } = await createHarness({
    placeOrderFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-order",
    brokerOrderId: "external-broker-order",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "99",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  await engine.processUserDataEvent({ event: { executedOrder: externalOrder } })

  const pausedEvents = events.filter(({ name }) => name === "strategy.paused")
  assert.equal(pausedEvents.length, 1)
  assert.equal(pausedEvents[0].data.symbol, "DOGEUSDT")
  assert.equal(pausedEvents[0].data.reason, "ORDER_SUBMISSION_REJECTED_OR_UNKNOWN")
})

test("publishes broker-confirmed trailing BUY cancellation after registry update", async () => {
  const events = []
  const harness = await createHarness({
    eventPublisher: { publish: (event) => {
      events.push(event)
      if (event.name === "order.cancelled") {
        assert.equal(harness.engine.getOrders()[0].status, "CANCELED")
      }
      return { ok: true }
    } },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  const cancelled = events.find(({ name }) => name === "order.cancelled")
  assert.ok(cancelled)
  assert.match(cancelled.data.clientOrderId, /^h-[0-9a-f]{22}-1$/)
  assert.equal(cancelled.data.status, "CANCELED")
  assert.equal(cancelled.data.executedQuantity, "0")
})

test("durably brackets a trailing BUY cancellation before broker and registry transitions", async () => {
  const sequence = []
  const harness = await createHarness({
    onOperationalStateCancellationIntent: async ({
      order,
      reason
    }) => {
      sequence.push("intent")
      assert.equal(reason, "TRAILING_BUY_REPRICE")
      assert.equal(order.status, "OPEN")
      assert.equal(harness.engine.getOrders()[0].status, "OPEN", "The order registry must remain unchanged before broker cancellation.")
      return {
        ok: true,
        data: { durable: true }
      }
    },
    onOperationalStateCancellationOutcome: async ({
      order,
      canceledOrder,
      reason,
      outcome
    }) => {
      sequence.push("outcome")
      assert.equal(reason, "TRAILING_BUY_REPRICE")
      assert.equal(order.status, "OPEN")
      assert.equal(canceledOrder.status, "CANCELED")
      assert.equal(outcome, "CANCELED")
      assert.equal(harness.engine.getOrders()[0].status, "OPEN", "The order registry must not advance before the cancellation outcome is durable.")
      return {
        ok: true,
        data: { durable: true }
      }
    },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(sequence, ["intent", "outcome"])
  assert.equal(harness.engine.getOrders()[0].status, "CANCELED")
})

test("treats decimal-formatted zero as no execution in trailing BUY cancellation reconciliation", async () => {
  const harness = await createHarness({ cancelExecutedQuantity: "0.0" })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(harness.cancellationIds.length, 1)
  assert.equal(harness.orders.length, 2)
  assert.deepEqual(harness.pauses, [])
})

test("treats decimal-formatted zero as no execution in recovery SELL cancellation reconciliation", async () => {
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    accountingApplied: true,
    cancelExecutedQuantity: "0.0",
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = harness.engine.getOrders().find((order) => order.side === "SELL")
  const buyOrder = harness.engine.getOrders().find((order) => order.side === "BUY")
  const fill = new Fill({
    tradeId: "decimal-zero-cancel-buy-fill",
    brokerOrderId: buyOrder.brokerOrderId,
    market,
    side: "BUY",
    price: buyOrder.limitPrice,
    quantity: buyOrder.originalQuantity,
    quoteQuantity: new Money({
      amount: multiplyDecimal({
        left: buyOrder.limitPrice.amount,
        right: buyOrder.originalQuantity.amount,
      }),
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
    executedAt: 3,
  })
  const filledOrder = new CanonicalOrder({
    clientOrderId: buyOrder.clientOrderId,
    brokerOrderId: buyOrder.brokerOrderId,
    market,
    side: "BUY",
    type: buyOrder.type,
    limitPrice: buyOrder.limitPrice,
    originalQuantity: buyOrder.originalQuantity,
    executedQuantity: buyOrder.originalQuantity,
    status: "FILLED",
    createdAt: buyOrder.createdAt,
    acknowledgedAt: buyOrder.acknowledgedAt,
    updatedAt: 3,
    completedAt: 3,
  })
  const result = await harness.engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: filledOrder,
      fill
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(harness.cancellationIds, [sellOrder.brokerOrderId])
  assert.equal(harness.engine.getOrders().find((order) => order.brokerOrderId === sellOrder.brokerOrderId).status, "CANCELED")
  assert.deepEqual(harness.pauses, [])
})

test("rejects a stream fill whose optional clientOrderId conflicts with its registered order", async () => {
  const harness = await createHarness()
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const order = harness.engine.getOrders()[0]
  const fillQuantity = "0.1"
  const fill = new Fill({
    tradeId: "wrong-client-fill",
    clientOrderId: "h-foreign-client-order",
    brokerOrderId: order.brokerOrderId,
    market,
    side: "BUY",
    price: order.limitPrice,
    quantity: new Quantity({
      amount: fillQuantity,
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: multiplyDecimal({
        left: order.limitPrice.amount,
        right: fillQuantity
      }),
      asset: quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
    executedAt: 2,
  })
  const partialOrder = new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: "BUY",
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({
      amount: fillQuantity,
      asset: baseAsset
    }),
    status: "PARTIALLY_FILLED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: 2,
  })
  const result = await harness.engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: partialOrder,
      fill
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.failure, {
    category: "OWNERSHIP_INTEGRITY",
    stage: "FILL_ORDER_IDENTITY",
    retryable: false
  })
  assert.equal(harness.accountedFills.length, 0)
  assert.ok(harness.pauses.includes("EXECUTION_FILL_ORDER_IDENTITY_MISMATCH"))
})

test("treats decimal-formatted zero as no execution in terminal CANCELED order events", async () => {
  const harness = await createHarness()
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const order = harness.engine.getOrders()[0]
  const canceledOrder = new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({
      amount: "0.0",
      asset: baseAsset
    }),
    status: "CANCELED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt: 2,
    completedAt: 2,
  })
  const result = await harness.engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "CANCELED",
      executedOrder: canceledOrder
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(harness.pauses, [])
})

test("publishes an unconfirmed cancellation and pause without changing the order flow", async () => {
  const events = []
  const {
    engine,
    orders
  } = await createHarness({
    cancelFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false)
  assert.equal(orders.length, 1)
  const failed = events.find(({ name }) => name === "order.cancel_failed")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNCONFIRMED")
  assert.equal(failed.data.status, "UNKNOWN")
  assert.equal(engine.getOrders()[0].status, "UNKNOWN")
  assert.equal(events.filter(({ name }) => name === "strategy.paused").length, 1)
})

test("publishes thrown cancellation outcomes as UNKNOWN and pauses the pair", async () => {
  const events = []
  const { engine } = await createHarness({
    cancelThrow: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })
  assert.equal(result.ok, false)
  assert.equal(events.at(-1).name, "strategy.paused")
  const failed = events.find((event) => event.name === "order.cancel_failed")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNCONFIRMED")
  assert.equal(failed.data.status, "UNKNOWN")
  assert.equal(engine.getOrders()[0].status, "UNKNOWN")
})


test("cancellation intent publication failure prevents broker cancellation and pauses the pair", async () => {
  let cancelCalls = 0
  const {
    engine,
    pauses
  } = await createHarness({
    onCancelOrderStarted: () => { cancelCalls += 1 },
    eventPublisher: {
      publish: (event) => {
        if (event.name === "order.cancel_requested") {throw new Error("journal observer unavailable")}
        return { ok: true }
      },
    },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })
  assert.equal(result.ok, false)
  assert.equal(cancelCalls, 0)
  assert.equal(engine.getOrders()[0].status, "OPEN")
  assert.ok(pauses.includes("TRAILING_BUY_CANCEL_INTENT_NOT_DURABLE"))
})


test("order intent publication failure pauses the pair without calling the broker", async () => {
  const {
    engine,
    pauses,
    orders
  } = await createHarness({
    placeOrderFailure: true,
    eventPublisher: { publish: () => { throw new Error("observer unavailable") } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(result.ok, false)
  assert.equal(orders.length, 0)
  assert.ok(pauses.includes("ORDER_INTENT_NOT_DURABLE"))
})


function makeSeededRecoveryState({ quantity = "1" } = {}) {
  const fill = new Fill({
    tradeId: "seed-recovery-buy",
    brokerOrderId: "seed-recovery-order",
    market,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: multiplyDecimal({
      left: "100",
      right: quantity
    }),
      asset: quoteAsset
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    portfolio: new Portfolio().applyFill({ fill }).portfolio,
    recoveryLedger: RecoveryLedger.empty({ market }).applyFill({ fill }).ledger,
  }
}

const makeFilledOrder = ({ order }) => new CanonicalOrder({
  clientOrderId: order.clientOrderId,
  brokerOrderId: order.brokerOrderId,
  market,
  side: order.side,
  type: order.type,
  limitPrice: order.limitPrice,
  originalQuantity: order.originalQuantity,
  executedQuantity: order.originalQuantity,
  status: "FILLED",
  createdAt: order.createdAt,
  acknowledgedAt: order.acknowledgedAt,
  updatedAt: 3,
  completedAt: 3,
})

function makeSellFill({
  order,
  tradeId,
  quantity = order.originalQuantity.amount,
  quoteQuantity = "100",
  commissionAmount = "0"
}) {
  return new Fill({
    tradeId,
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market,
    side: "SELL",
    price: order.limitPrice,
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: quoteAsset
    }),
    commissions: commissionAmount === "0" ? [] : [
      new Commission({ amount: new Money({
        amount: commissionAmount,
        asset: quoteAsset
      }) }),
    ],
    commissionStatus: "COMPLETE",
  })
}

function makeBuyFill({
  order,
  tradeId,
  price,
  quantity,
  quoteQuantity,
  executedAt,
  clientOrderId = order.clientOrderId,
  brokerOrderId = order.brokerOrderId,
  market: fillMarket = market,
  side = "BUY"
}) {
  return new Fill({
    tradeId,
    brokerOrderId,
    ...(clientOrderId === undefined ? {} : { clientOrderId }),
    market: fillMarket,
    side,
    price: new Money({
      amount: price,
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
    ...(executedAt === undefined ? {} : { executedAt }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

test("durably journals recovery SELL cancellation intent before broker cancellation", async () => {
  const events = []
  const sequence = []
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    onCancelOrderStarted: () => sequence.push("broker:cancel"),
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        if (event.name === "order.cancel_requested") {sequence.push("publish:cancel_requested")}
        if (event.name === "order.cancelled") {
          const registered = harness.engine.getOrders().find((order) => order.clientOrderId === event.data.clientOrderId)
          assert.equal(registered.status, "CANCELED")
        }
        return { ok: true }
      },
      flush: async () => {
        sequence.push("flush")
        return {
          ok: true,
          durable: true
        }
      },
    },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = harness.engine.getOrders().find((order) => order.side === "BUY")
  const sellOrder = harness.engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(buyOrder)
  assert.ok(sellOrder)

  const result = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "completed-buy-fill",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95"
      }),
    },
  })
  assert.equal(result.ok, true)
  const cancelled = events.find((event) =>
    event.name === "order.cancelled" && event.data.clientOrderId === sellOrder.clientOrderId)
  assert.ok(cancelled)
  assert.equal(cancelled.data.side, "SELL")
  assert.equal(cancelled.data.status, "CANCELED")
  const cancelIntentIndex = sequence.lastIndexOf("publish:cancel_requested")
  const cancelFlushIndex = sequence.lastIndexOf("flush")
  const brokerCancelIndex = sequence.indexOf("broker:cancel")
  assert.ok(cancelIntentIndex >= 0)
  assert.ok(cancelFlushIndex > cancelIntentIndex)
  assert.ok(brokerCancelIndex > cancelFlushIndex)
})

test("does not cancel a recovery SELL when its durable cancellation intent flush fails", async () => {
  let flushCount = 0
  let cancelCalls = 0
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    onCancelOrderStarted: () => { cancelCalls += 1 },
    eventPublisher: {
      publish: () => ({ ok: true }),
      flush: async () => {
        flushCount += 1
        return flushCount === 3
          ? {
            ok: false,
            errors: [new Error("journal sync failed")]
          }
          : {
            ok: true,
            durable: true
          }
      },
    },
  })

  const started = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(started.ok, true)
  assert.equal(flushCount, 2)

  const buyOrder = harness.engine.getOrders().find((order) => order.side === "BUY")
  const result = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "cancel-intent-flush-failure",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95",
      }),
    },
  })

  assert.equal(result.ok, false)
  assert.equal(flushCount, 3)
  assert.equal(cancelCalls, 0)
  assert.ok(harness.pauses.includes("RECOVERY_SELL_CANCEL_INTENT_NOT_DURABLE"))
  assert.equal(harness.engine.getOrders().find((order) => order.side === "SELL").status, "OPEN")
})

test("uses the volume-weighted actual execution price for the next standing BUY reference", async () => {
  const { engine } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const firstFill = makeBuyFill({
    order: buyOrder,
    tradeId: "buy-fill-1",
    price: "99.90",
    quantity: "0.4",
    quoteQuantity: "39.96",
  })
  const first = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: buyOrder,
        executedQuantity: "0.4"
      }),
      fill: firstFill,
    },
  })
  assert.equal(first.ok, true)
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), undefined)

  const secondFill = makeBuyFill({
    order: buyOrder,
    tradeId: "buy-fill-2",
    price: "99.80",
    quantity: "0.6",
    quoteQuantity: "59.88",
  })
  const completed = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: secondFill,
    },
  })
  assert.equal(completed.ok, true)
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), "99.84")
})

test("pauses instead of advancing when a filled BUY has incomplete execution-price history", async () => {
  const {
    engine,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const result = await engine.processUserDataEvent({
    event: { executedOrder: makeFilledOrder({ order: buyOrder }) },
  })
  assert.equal(result.ok, false)
  assert.ok(pauses.includes("BUY_FILL_RECONCILIATION_FAILED"))
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), undefined)
})

test("publishes recovery SELL cancellation failures and pauses the pair", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const { engine } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    cancelFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "completed-buy-fill",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95"
      }),
    },
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.failure, {
    category: "ORDER_TRANSITION",
    stage: "RECOVERY_SELL_CANCELLATION",
    retryable: true
  })
  const failed = events.find((event) =>
    event.name === "order.cancel_failed" && event.data.side === "SELL")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNCONFIRMED")
  assert.ok(events.some((event) => event.name === "strategy.paused"))
})


test("publishes thrown recovery SELL cancellation outcomes as unconfirmed", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const { engine } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    cancelThrow: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "completed-buy-fill",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95"
      }),
    },
  })
  assert.equal(result.ok, false)
  const failed = events.find((event) =>
    event.name === "order.cancel_failed" && event.data.side === "SELL")
  assert.ok(failed)
  assert.equal(failed.data.outcome, "UNCONFIRMED")
  assert.equal(failed.data.status, "UNKNOWN")
  assert.equal(engine.getOrders().find((order) => order.side === "SELL").status, "UNKNOWN")
  assert.ok(events.some((event) =>
    event.name === "strategy.paused" && event.data.reason === "RECOVERY_SELL_CANCELLATION_UNCONFIRMED"))
})


function makePartialFill({ order }) {
  return new Fill({
    tradeId: "partial-trade-1",
    brokerOrderId: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
    market,
    side: order.side,
    price: order.limitPrice,
    quantity: new Quantity({
      amount: "0.5",
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "49.975",
      asset: quoteAsset
    }),
    liquidityRole: "MAKER",
    executedAt: 2,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

function makePartiallyFilledOrder({
  order,
  updatedAt = 2,
  executedQuantity = "0.5"
}) {
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: baseAsset
    }),
    status: "PARTIALLY_FILLED",
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt,
  })
}

test("publishes a Fill only after the accounting workflow commits it", async () => {
  const events = []
  const fillRef = { current: undefined }
  const harness = await createHarness({
    accountingApplied: true,
    eventPublisher: { publish: (event) => {
      events.push(event)
      if (event.name === "execution.fill_applied") {
        assert.ok(harness.accountedFills.includes(fillRef.current))
      }
      return { ok: true }
    } },
  })
  const {
    engine,
    accountedFills
  } = harness
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const order = engine.getOrders()[0]
  fillRef.current = makePartialFill({ order })
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill: fillRef.current,
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.waitingForFullFill, true)
  assert.ok(accountedFills.includes(fillRef.current))
  const applied = events.find(({ name }) => name === "execution.fill_applied")
  assert.ok(applied)
  assert.deepEqual(applied.data, {
    fillId: fillRef.current.id,
    tradeId: fillRef.current.tradeId,
    brokerOrderId: fillRef.current.brokerOrderId,
    clientOrderId: fillRef.current.clientOrderId,
    symbol: "DOGEUSDT",
    side: "BUY",
    price: "99.95",
    quantity: "0.5",
    quoteQuantity: "49.975",
    liquidityRole: "MAKER",
    executedAt: 2,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
})

test("does not publish a Fill when accounting reports an idempotent duplicate", async () => {
  const events = []
  const { engine } = await createHarness({
    accountingApplied: false,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const order = engine.getOrders()[0]
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill: makePartialFill({ order }),
    },
  })
  assert.equal(result.ok, true)
  assert.equal(events.some(({ name }) => name === "execution.fill_applied"), false)
  const duplicate = events.find(({ name }) => name === "execution.duplicate_fill")
  assert.ok(duplicate)
  assert.equal(duplicate.data.duplicate, true)
})

test("Fill event publication failure cannot interrupt successful accounting", async () => {
  const {
    engine,
    accountedFills
  } = await createHarness({
    accountingApplied: true,
    eventPublisher: { publish: (event) => {
      if (event.name === "execution.fill_applied") {throw new Error("journal unavailable")}
      return { ok: true }
    } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const order = engine.getOrders()[0]
  const fill = makePartialFill({ order })
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill,
    },
  })
  assert.equal(result.ok, true)
  assert.ok(accountedFills.includes(fill))
})


test("publishes missing and mismatched Fill diagnostics without raw execution data", async () => {
  const events = []
  const { engine } = await createHarness({
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
    symbol: "DOGEUSDT",
    price: "100",
    timestamp: 1
  }
  })
  const order = engine.getOrders()[0]
  const executedOrder = makePartiallyFilledOrder({ order })
  const missing = await engine.processUserDataEvent({
    event: {
      executedOrder,
      executionType: "TRADE",
      rawExchangeMessage: { apiKey: "private" }
    },
  })
  assert.equal(missing.ok, false)
  const missingEvent = events.find(({ name }) => name === "execution.invalid_fill")
  assert.ok(missingEvent)
  assert.equal(missingEvent.data.reason, "MISSING_FILL")
  assert.equal("rawExchangeMessage" in missingEvent.data, false)

  const wrongFill = new Fill({
    tradeId: "mismatched-trade-1",
    brokerOrderId: "different-broker-order",
    clientOrderId: order.clientOrderId,
    market,
    side: order.side,
    price: order.limitPrice,
    quantity: new Quantity({
      amount: "0.5",
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "49.975",
      asset: quoteAsset
    }),
    liquidityRole: "MAKER",
    executedAt: 3,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const mismatch = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({
      order,
      updatedAt: 3
    }),
      executionType: "TRADE",
      fill: wrongFill
    },
  })
  assert.equal(mismatch.ok, false)
  const mismatchEvent = events.find((event) =>
    event.name === "execution.invalid_fill" && event.data.reason === "IDENTITY_MISMATCH")
  assert.ok(mismatchEvent)
  assert.equal(mismatchEvent.data.fillBrokerOrderId, "different-broker-order")
})

test("ignores unmatched manual order updates by default and publishes safe diagnostics", async () => {
  const events = []
  const {
    engine,
    pauses,
    accountedFills
  } = await createHarness({
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-client-order",
    brokerOrderId: "external-broker-order",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "99",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const result = await engine.processUserDataEvent({ event: { executedOrder: externalOrder } })
  assert.equal(result.ok, true, "An unmatched manual order report must not fail Harvester user-data processing.")
  assert.equal(result.data.ignored, true, "The engine must explicitly classify the report as ignored.")
  assert.deepEqual(pauses, [], "A manual order report must not pause the Harvester strategy.")
  assert.deepEqual(accountedFills, [], "A manual order report must never enter Harvester accounting.")
  const unowned = events.find(({ name }) => name === "execution.unowned_order")
  assert.ok(unowned, "The manual order must remain visible as a diagnostic event.")
  assert.equal(unowned.data.clientOrderId, "external-client-order")
  assert.equal(unowned.data.brokerOrderId, "external-broker-order")
  assert.equal(unowned.data.reason, "UNKNOWN_OR_EXTERNAL_ORDER_EVENT")
})

test("publishes accounting failures and preserves pair pause behavior", async () => {
  const events = []
  const {
    engine,
    pauses
  } = await createHarness({
    accountingFailure: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
    symbol: "DOGEUSDT",
    price: "100",
    timestamp: 1
  }
  })
  const order = engine.getOrders()[0]
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill: makePartialFill({ order }),
    },
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "FILL_ACCOUNTING",
    retryable: false
  })
  const failed = events.find(({ name }) => name === "execution.accounting_failed")
  assert.ok(failed)
  assert.equal(failed.data.error.message, "unsupported commission asset")
  assert.ok(pauses.includes("EXECUTION_ACCOUNTING_FAILED"))
})

test("EventBus failure cannot interrupt accounting failure pause handling", async () => {
  const {
    engine,
    pauses
  } = await createHarness({
    accountingFailure: true,
    eventPublisher: {
      publish: (event) => {
        if (event.name === "execution.accounting_failed" || event.name === "strategy.paused") {
          throw new Error("observer unavailable")
        }
        return { ok: true }
      },
    },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
    symbol: "DOGEUSDT",
    price: "100",
    timestamp: 1
  }
  })
  const order = engine.getOrders()[0]
  const result = await engine.processUserDataEvent({
    event: {
      executedOrder: makePartiallyFilledOrder({ order }),
      executionType: "TRADE",
      fill: makePartialFill({ order }),
    },
  })
  assert.equal(result.ok, false)
  assert.ok(pauses.includes("EXECUTION_ACCOUNTING_FAILED"))
})


test("publishes the market-specific profit threshold after recovery completion succeeds", async () => {
  const events = []
  const completionInputs = []
  const configuredAppConfig = structuredClone(appConfig)
  configuredAppConfig.strategies.CG_coinGrabber.pairs.DOGEUSDT.minProfit = 0.1
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    appConfig: configuredAppConfig,
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    completeRecoveryCycle: async (input) => {
      completionInputs.push(input)
      return {
        ok: true,
        data: {
        eligible: true,
        freeQuantity: "0.1",
        realizedNetProfit: "1.5"
      }
      }
    },
    eventPublisher: { publish: (event) => {
      events.push(event)
      if (event.name === "recovery.cycle_completed") {
        assert.equal(completionInputs.length, 1, "The pair-specific completion input must be delivered before the completion event.")
      }
      return { ok: true }
    } },
  })
  const {
    engine,
    completedCycles
  } = harness
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(sellOrder)
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({
        order: sellOrder,
        tradeId: "completed-recovery-sell"
      }),
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(completedCycles, [], "The injected completion boundary owns completion in this test.")
  assert.equal(completionInputs.length, 1)
  assert.equal(completionInputs[0].minProfit, "0.1", "The engine must pass this market's threshold to recovery completion.")
  const completed = events.find(({ name }) => name === "recovery.cycle_completed")
  assert.ok(completed)
  assert.deepEqual(completed.data, {
    symbol: "DOGEUSDT",
    marketId: market.id,
    freeQuantity: "0.1",
    keepQuantity: "0.1",
    minProfit: "0.1",
    realizedNetProfit: "1.5",
  })
})


test("does not complete recovery when a FILLED SELL has no reconciled execution fills", async () => {
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    completedCycles,
    pauses
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: { executedOrder: makeFilledOrder({ order: sellOrder }) },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(completedCycles, [])
  assert.ok(pauses.includes("SELL_FILL_RECONCILIATION_FAILED"))
})

test("does not complete recovery when SELL fills do not equal the original order quantity", async () => {
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    completedCycles,
    pauses
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    accountingApplied: true,
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({
        order: sellOrder,
        tradeId: "short-recovery-sell",
        quantity: "0.7"
      }),
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(completedCycles, [])
  assert.ok(pauses.includes("SELL_FILL_RECONCILIATION_FAILED"))
})

test("rejects a late PARTIALLY_FILLED trade update after terminal cancellation", async () => {
  const {
    engine,
    accountedFills
  } = await createHarness({ accountingApplied: true })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const canceled = await engine.processUserDataEvent({
    event: {
      executedOrder: makeOrderStatusUpdate({
        order: buyOrder,
        status: "CANCELED",
        executedQuantity: "0",
        updatedAt: 2,
      }),
    },
  })
  assert.equal(canceled.ok, true)

  const latePartial = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: makeOrderStatusUpdate({
        order: buyOrder,
        status: "PARTIALLY_FILLED",
        executedQuantity: "0.5",
        updatedAt: 3,
      }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "late-partial-after-cancel",
        price: "99.95",
        quantity: "0.5",
        quoteQuantity: "49.975",
        executedAt: 10,
      }),
    },
  })

  assert.equal(latePartial.ok, false)
  assert.equal(accountedFills.length, 0)
  const registeredOrder = engine.getOrders().find((order) => order.clientOrderId === buyOrder.clientOrderId)
  assert.equal(registeredOrder.status, "CANCELED")
  assert.equal(registeredOrder.executedQuantity.amount, "0")
})

test("ignores an out-of-order OPEN update after the BUY has already filled", async () => {
  const {
    engine,
    accountedFills,
    pauses
  } = await createHarness({ accountingApplied: true })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const fill = makeBuyFill({
    order: buyOrder,
    tradeId: "filled-before-stale-open",
    price: "99.95",
    quantity: "1",
    quoteQuantity: "99.95",
    executedAt: 10,
  })
  const completed = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill,
    },
  })
  assert.equal(completed.ok, true)
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), "99.95")

  const stale = await engine.processUserDataEvent({
    event: {
      executedOrder: makeOrderStatusUpdate({
        order: buyOrder,
        status: "OPEN",
        executedQuantity: "0",
        updatedAt: 1,
      }),
    },
  })

  assert.equal(stale.ok, true)
  assert.equal(stale.data.ignored, true)
  assert.equal(accountedFills.length, 1)
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), "99.95")
  assert.deepEqual(pauses, [])
})

test("reconciles the recovery SELL after any partial BUY fill without completing the BUY lifecycle", async () => {
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    updateTradingAccounting: async ({ fill }) => {
      const portfolioUpdate = harness.getCurrentPortfolio().applyFill({ fill })
      const ledgerUpdate = harness.getCurrentRecoveryLedger().applyFill({ fill })
      harness.setCurrentPortfolio(portfolioUpdate.portfolio)
      harness.setCurrentRecoveryLedger(ledgerUpdate.ledger)
      return {
        ok: true,
        data: {
        applied: true,
        duplicate: false
      }
      }
    },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = harness.engine.getOrders().find((order) => order.side === "BUY")
  const originalSell = harness.engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(buyOrder)
  assert.ok(originalSell)

  const result = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: buyOrder,
        executedQuantity: "0.2",
        updatedAt: 2
      }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "partial-buy-recalculates-recovery-sell",
        price: "99.95",
        quantity: "0.2",
        quoteQuantity: "19.99",
      }),
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(result.data.waitingForFullFill, true)
  assert.equal(result.data.recoverySellReplaced, true)
  assert.deepEqual(harness.cancellationIds, [originalSell.brokerOrderId])
  const sells = harness.engine.getOrders().filter((order) => order.side === "SELL")
  assert.equal(sells.length, 2)
  assert.equal(sells[0].status, "CANCELED")
  assert.equal(sells[1].status, "OPEN")
  assert.equal(harness.engine.getOrders().find((order) => order.side === "BUY").status, "PARTIALLY_FILLED")
  assert.deepEqual(harness.pauses, [])
})

test("reconciles streamed BUY partial fills cumulatively before advancing the strategy", async () => {
  const {
    engine,
    accountedFills,
    pauses
  } = await createHarness({ accountingApplied: true })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(buyOrder)

  const first = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: buyOrder,
        executedQuantity: "0.4",
        updatedAt: 2
      }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "streamed-buy-part-1",
        price: "99.95",
        quantity: "0.4",
        quoteQuantity: "39.98",
        executedAt: 10,
      }),
    },
  })
  const second = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: buyOrder,
        executedQuantity: "0.7",
        updatedAt: 3
      }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "streamed-buy-part-2",
        price: "99.95",
        quantity: "0.3",
        quoteQuantity: "29.985",
        executedAt: 11,
      }),
    },
  })
  const completed = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "streamed-buy-part-3",
        price: "99.95",
        quantity: "0.3",
        quoteQuantity: "29.985",
        executedAt: 12,
      }),
    },
  })

  assert.equal(first.ok, true)
  assert.equal(first.data.waitingForFullFill, true)
  assert.equal(second.ok, true)
  assert.equal(second.data.waitingForFullFill, true)
  assert.equal(completed.ok, true, completed.errors?.[0]?.message)
  assert.equal(completed.data.reevaluate, true)
  assert.deepEqual(accountedFills.map((fill) => fill.tradeId), [
    "streamed-buy-part-1",
    "streamed-buy-part-2",
    "streamed-buy-part-3",
  ])
  assert.equal(engine.getLastBuyPrice({ symbol: "DOGEUSDT" }), "99.95")
  assert.deepEqual(pauses, [])
})

test("reconciles multiple actual SELL fills before completing recovery", async () => {
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    completedCycles,
    pauses
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    accountingApplied: true,
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const partial = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: sellOrder,
        executedQuantity: "0.4"
      }),
      fill: makeSellFill({
        order: sellOrder,
        tradeId: "recovery-sell-part-1",
        quantity: "0.4"
      }),
    },
  })
  assert.equal(partial.ok, true)
  assert.equal(partial.data.waitingForFullFill, true)

  const completed = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({
        order: sellOrder,
        tradeId: "recovery-sell-part-2",
        quantity: "0.5"
      }),
    },
  })

  assert.equal(completed.ok, true)
  assert.deepEqual(completedCycles, [market.id])
  assert.deepEqual(pauses, [])
})



const runCompleteConservativeCycle = async ({ keepQuantity }) => {
  let currentPortfolio = new Portfolio()
  let currentRecoveryLedger = RecoveryLedger.empty({ market })
  const events = []
  const completionCalls = []
  const buyAfterSellAcknowledgements = []
  let allocationCount = 0
  let resetCount = 0
  let completionSnapshot

  const makeCommissionedFill = ({
    order,
    tradeId,
    quantity,
    commissionAsset,
    executedAt,
  }) => {
    const quoteQuantity = multiplyDecimal({
      left: order.limitPrice.amount,
      right: quantity,
    })
    const asset = commissionAsset === "BASE" ? baseAsset : quoteAsset
    const commissionBasis = commissionAsset === "BASE" ? quantity : quoteQuantity
    const commissionAmount = multiplyDecimal({
      left: commissionBasis,
      right: "0",
    })
    return new Fill({
      tradeId,
      brokerOrderId: order.brokerOrderId,
      clientOrderId: order.clientOrderId,
      market,
      side: order.side,
      price: new Money({
        amount: order.limitPrice.amount,
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
      commissions: commissionAmount === "0" ? [] : [
        new Commission({ amount: new Money({
          amount: commissionAmount,
          asset
        }) }),
      ],
      commissionStatus: "COMPLETE",
      ...(executedAt === undefined ? {} : { executedAt }),
    })
  }

  const zeroFeeAppConfig = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          DOGEUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.DOGEUSDT,
            keepQuantity,
            makerPercent: 0,
            takerPercent: 0,
          },
        },
      },
    },
  }
  const harness = await createHarness({
    appConfig: zeroFeeAppConfig,
    baseFreeBalance: "2",
    quoteFreeBalance: "1000",
    cancelWithFill: true,
    getPortfolio: () => currentPortfolio,
    getRecoveryLedger: () => currentRecoveryLedger,
    updateTradingAccounting: async ({ fill }) => {
      try {
        const portfolioResult = currentPortfolio.applyFill({ fill })
        const ledgerResult = currentRecoveryLedger.applyFill({ fill })
        if (portfolioResult.applied !== ledgerResult.applied ||
            portfolioResult.duplicate !== ledgerResult.duplicate) {
          throw new Error("Portfolio and RecoveryLedger execution identities are inconsistent")
        }
        currentPortfolio = portfolioResult.portfolio
        currentRecoveryLedger = ledgerResult.ledger
        return {
          ok: true,
          data: {
            applied: portfolioResult.applied,
            duplicate: portfolioResult.duplicate,
          },
        }
      } catch (error) {
        return {
          ok: false,
          errors: [error]
        }
      }
    },
    completeRecoveryCycle: async ({
      marketId,
      keepQuantity: requestedKeepQuantity,
      minProfit
    }) => {
      completionCalls.push(marketId)
      const position = currentPortfolio.getPosition({ marketId })
      const result = evaluateRecoveryCompletion({
        sellOrderFullyFilled: true,
        spent: currentPortfolio.getPosition({ marketId }).spent.amount,
        netSellProceeds: currentRecoveryLedger.netSellProceeds,
        activeQuantity: position.baseQuantity.amount,
        keepQuantity: requestedKeepQuantity,
        minProfit,
      })
      completionSnapshot = {
        spent: currentPortfolio.getPosition({ marketId }).spent.amount,
        netSellProceeds: currentRecoveryLedger.netSellProceeds,
        activeQuantity: position.baseQuantity.amount,
        realizedNetProfit: result.realizedNetProfit,
      }
      if (result.eligible) {
        if (compareDecimal({
          left: result.freeQuantity,
          right: "0"
        }) > 0) {
          currentPortfolio = currentPortfolio.allocateFreeQuantity({
            marketId,
            quantity: result.freeQuantity,
          })
          allocationCount += 1
        }
        currentPortfolio = currentPortfolio.resetRecoveryBasis({ marketId })
        currentRecoveryLedger = currentRecoveryLedger.resetCycle({
          minProfit,
          spent: position.spent
        })
        resetCount += 1
      }
      return {
        ok: true,
        data: result
      }
    },
    onPlaceOrder: ({ order }) => {
      if (order.side !== "BUY" || !harness.engine) {return}
      const previousSell = harness.engine.getOrders().filter((item) => item.side === "SELL").at(-1)
      if (previousSell) {
        assert.equal(previousSell.status, "OPEN")
        buyAfterSellAcknowledgements.push(previousSell.clientOrderId)
      }
    },
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        if (event.name === "recovery.cycle_completed") {
          assert.equal(completionCalls.length, 1)
          assert.equal(allocationCount, keepQuantity === "0" ? 0 : 1)
          assert.equal(resetCount, 1)
        }
        return { ok: true }
      },
      flush: async () => ({
        ok: true,
        durable: true
      }),
    },
  })

  // The cancellation response reports a 0.1 partial SELL fill. Supply its
  // actual base-asset commission through canonical REST fill reconciliation.
  const originalGetFills = harness.broker.getFills.bind(harness.broker)
  harness.broker.getFills = async ({ orderId }) => {
    const result = await originalGetFills({ orderId })
    if (!result.ok || !Array.isArray(result.data) || result.data.length === 0) {return result}
    const canceledSell = harness.engine.getOrders().find((order) => order.brokerOrderId === orderId)
    assert.ok(canceledSell)
    return {
      ok: true,
      data: result.data.map((fill) => makeCommissionedFill({
        order: canceledSell,
        tradeId: fill.tradeId,
        quantity: fill.quantity.amount,
        commissionAsset: "BASE",
        executedAt: 12,
      })),
    }
  }

  const started = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(started.ok, true, started.errors?.[0]?.message)
  const firstBuy = harness.engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(firstBuy)

  const firstBuyPartialFill = makeCommissionedFill({
    order: firstBuy,
    tradeId: "cycle-buy-1-partial",
    quantity: "0.4",
    commissionAsset: "BASE",
    executedAt: 10,
  })
  const firstBuyPartial = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: firstBuy,
        executedQuantity: "0.4",
        updatedAt: 2,
      }),
      fill: firstBuyPartialFill,
    },
  })
  assert.equal(firstBuyPartial.ok, true, firstBuyPartial.errors?.[0]?.message)
  assert.equal(firstBuyPartial.data.waitingForFullFill, true)

  const firstBuyFinalFill = makeCommissionedFill({
    order: firstBuy,
    tradeId: "cycle-buy-1-final",
    quantity: "0.6",
    commissionAsset: "QUOTE",
    executedAt: 11,
  })
  const firstBuyCompleted = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: firstBuy }),
      fill: firstBuyFinalFill,
    },
  })
  assert.equal(firstBuyCompleted.ok, true, firstBuyCompleted.errors?.[0]?.message)
  assert.equal(firstBuyCompleted.data.reevaluate, true)
  await harness.engine.evaluateLatest({ symbol: "DOGEUSDT" })

  const firstRecoverySell = harness.engine.getOrders().filter((order) => order.side === "SELL").at(-1)
  const secondBuy = harness.engine.getOrders().filter((order) => order.side === "BUY").at(-1)
  assert.ok(firstRecoverySell)
  assert.ok(secondBuy)

  const secondBuyPartialFill = makeCommissionedFill({
    order: secondBuy,
    tradeId: "cycle-buy-2-partial",
    quantity: "0.25",
    commissionAsset: "QUOTE",
    executedAt: 13,
  })
  const secondBuyPartial = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: secondBuy,
        executedQuantity: "0.25",
        updatedAt: 2,
      }),
      fill: secondBuyPartialFill,
    },
  })
  assert.equal(secondBuyPartial.ok, true, secondBuyPartial.errors?.[0]?.message)
  assert.equal(secondBuyPartial.data.waitingForFullFill, true)
  assert.equal(secondBuyPartial.data.recoverySellReplaced, true)
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === secondBuy.clientOrderId).status, "PARTIALLY_FILLED")
  assert.deepEqual(harness.cancellationIds, [firstRecoverySell.brokerOrderId])
  const partialBuyReplacementSell = harness.engine.getOrders().filter((order) => order.side === "SELL").at(-1)
  assert.ok(partialBuyReplacementSell)
  assert.notEqual(partialBuyReplacementSell.clientOrderId, firstRecoverySell.clientOrderId)
  assert.equal(
    harness.engine.getOrders().find((order) => order.clientOrderId === firstRecoverySell.clientOrderId).status,
    "CANCELED",
  )

  const secondBuyFinalFill = makeCommissionedFill({
    order: secondBuy,
    tradeId: "cycle-buy-2-final",
    quantity: "0.75",
    commissionAsset: "BASE",
    executedAt: 14,
  })
  const secondBuyCompleted = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: secondBuy }),
      fill: secondBuyFinalFill,
    },
  })
  assert.equal(secondBuyCompleted.ok, true, secondBuyCompleted.errors?.[0]?.message)
  assert.equal(secondBuyCompleted.data.reevaluate, true)
  assert.deepEqual(harness.cancellationIds, [
    firstRecoverySell.brokerOrderId,
    partialBuyReplacementSell.brokerOrderId,
  ])
  assert.equal(
    harness.engine.getOrders().find((order) => order.clientOrderId === partialBuyReplacementSell.clientOrderId).status,
    "CANCELED",
  )

  await harness.engine.evaluateLatest({ symbol: "DOGEUSDT" })
  const recoverySell = harness.engine.getOrders().filter((order) => order.side === "SELL").at(-1)
  const nextStandingBuy = harness.engine.getOrders().filter((order) => order.side === "BUY").at(-1)
  assert.ok(recoverySell)
  assert.ok(nextStandingBuy)
  assert.notEqual(recoverySell.clientOrderId, firstRecoverySell.clientOrderId)
  assert.deepEqual(harness.orders.map((order) => order.side), ["BUY", "SELL", "BUY", "SELL", "SELL", "BUY"])
  assert.deepEqual(buyAfterSellAcknowledgements, [
    firstRecoverySell.clientOrderId,
    recoverySell.clientOrderId,
  ])

  const recoverySellPartialFill = makeCommissionedFill({
    order: recoverySell,
    tradeId: "cycle-recovery-sell-partial",
    quantity: "0.5",
    commissionAsset: "QUOTE",
    executedAt: 15,
  })
  const recoverySellPartial = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: recoverySell,
        executedQuantity: "0.5",
        updatedAt: 2,
      }),
      fill: recoverySellPartialFill,
    },
  })
  assert.equal(recoverySellPartial.ok, true, recoverySellPartial.errors?.[0]?.message)
  assert.equal(recoverySellPartial.data.waitingForFullFill, true)
  assert.equal(completionCalls.length, 0)
  assert.equal(allocationCount, 0)
  assert.equal(resetCount, 0)

  const finalSellQuantity = subtractDecimal({
    left: recoverySell.originalQuantity.amount,
    right: "0.5",
  })
  const recoverySellFinalFill = makeCommissionedFill({
    order: recoverySell,
    tradeId: "cycle-recovery-sell-final",
    quantity: finalSellQuantity,
    commissionAsset: "QUOTE",
    executedAt: 16,
  })
  const recoverySellCompleted = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: recoverySell }),
      fill: recoverySellFinalFill,
    },
  })
  assert.equal(recoverySellCompleted.ok, true, recoverySellCompleted.errors?.[0]?.message)
  assert.equal(completionCalls.length, 1)
  assert.equal(allocationCount, keepQuantity === "0" ? 0 : 1)
  assert.equal(resetCount, 1)
  assert.ok(completionSnapshot)
  assert.ok(compareDecimal({
    left: completionSnapshot.spent,
    right: "0"
  }) > 0)
  assert.ok(compareDecimal({
    left: completionSnapshot.netSellProceeds,
    right: "0"
  }) > 0)
  assert.ok(compareDecimal({
    left: completionSnapshot.realizedNetProfit,
    right: "0.01"
  }) >= 0)

  const completedPosition = currentPortfolio.getPosition({ marketId: market.id })
  assert.equal(completedPosition.freeBaseQuantity.amount, keepQuantity)
  assert.equal(completedPosition.baseQuantity.amount, "0")
  assert.equal(currentRecoveryLedger.buyCost, "0")
  assert.equal(currentRecoveryLedger.netSellProceeds, "0")
  assert.equal(currentRecoveryLedger.outstandingRecoveryAmount, "0")
  assert.equal(currentPortfolio.appliedFillIds.length, 8)
  assert.equal(currentRecoveryLedger.appliedFillIds.length, 8)
  assert.equal(events.filter((event) => event.name === "recovery.cycle_completed").length, 1)

  // Only the exact configured reserve remains, in the separate free bucket.
  const afterCompletionEvaluation = await harness.engine.evaluateLatest({ symbol: "DOGEUSDT" })
  assert.equal(afterCompletionEvaluation.ok, true, afterCompletionEvaluation.errors?.[0]?.message)
  assert.equal(harness.orders.length, 6)
  assert.equal(harness.engine.getOrders().filter((order) => order.side === "SELL").length, 3)

  const beforeReplay = {
    activeQuantity: completedPosition.baseQuantity.amount,
    freeQuantity: completedPosition.freeBaseQuantity.amount,
    buyCost: currentRecoveryLedger.buyCost,
    netSellProceeds: currentRecoveryLedger.netSellProceeds,
    orderCount: harness.orders.length,
  }
  const replayedTerminalFill = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: recoverySell }),
      fill: recoverySellFinalFill,
    },
  })
  assert.equal(replayedTerminalFill.ok, true)
  assert.equal(replayedTerminalFill.data.ignored, true)
  assert.equal(completionCalls.length, 1)
  assert.equal(allocationCount, keepQuantity === "0" ? 0 : 1)
  assert.equal(resetCount, 1)
  assert.equal(events.filter((event) => event.name === "recovery.cycle_completed").length, 1)
  assert.equal(harness.orders.length, beforeReplay.orderCount)
  const afterReplayPosition = currentPortfolio.getPosition({ marketId: market.id })
  assert.equal(afterReplayPosition.baseQuantity.amount, beforeReplay.activeQuantity)
  assert.equal(afterReplayPosition.freeBaseQuantity.amount, beforeReplay.freeQuantity)
  assert.equal(currentRecoveryLedger.buyCost, beforeReplay.buyCost)
  assert.equal(currentRecoveryLedger.netSellProceeds, beforeReplay.netSellProceeds)
  assert.deepEqual(harness.cancellationIds, [
    firstRecoverySell.brokerOrderId,
    partialBuyReplacementSell.brokerOrderId,
  ])
  assert.deepEqual(harness.pauses, [])
}

test("completes the full Conservative lifecycle with the supported zero keepQuantity", async () => {
  await runCompleteConservativeCycle({ keepQuantity: "0" })
})

test("completes the full Conservative lifecycle with the configured retained quantity", async () => {
  await runCompleteConservativeCycle({ keepQuantity: "0.1" })
})

test("does not publish recovery completion when the cycle is ineligible", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const { engine } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    recoveryCompletion: {
      eligible: false,
      reason: "RECOVERY_SELL_NOT_FULLY_FILLED"
    },
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({
        order: sellOrder,
        tradeId: "completed-recovery-sell"
      }),
    },
  })
  assert.equal(result.ok, false)
  assert.equal(events.some(({ name }) => name === "recovery.cycle_completed"), false)
  const outcome = events.find(({ name }) => name === "recovery.cycle_not_completed")
  assert.ok(outcome)
  assert.equal(outcome.data.outcome, "BLOCKED")
  assert.equal(outcome.data.sellOrderClientId, sellOrder.clientOrderId)
})


test("recovery completion publisher failure cannot interrupt the committed cycle", async () => {
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    eventPublisher: {
      publish: (event) => {
        if (event.name === "recovery.cycle_completed") {throw new Error("journal unavailable")}
        return { ok: true }
      },
    },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = harness.engine.getOrders().find((order) => order.side === "SELL")
  const result = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({
        order: sellOrder,
        tradeId: "completed-recovery-sell"
      }),
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(harness.completedCycles, [market.id])
})


test("serializes market and user-data transitions until a pending SELL is acknowledged", async () => {
  let resolveAcknowledgement
  const placeOrderGate = { promise: new Promise((resolve) => { resolveAcknowledgement = resolve }) }
  let signalSellSubmission
  const sellSubmissionStarted = new Promise((resolve) => { signalSellSubmission = resolve })
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    orders,
    cancellationIds,
    accountedFills
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    placeOrderGate,
    onPlaceOrderStarted: ({ order }) => { if (order.side === "SELL") {signalSellSubmission()} },
  })
  const initialDecision = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  await sellSubmissionStarted
  const pendingSell = engine.getOrders().find((order) => order.side === "SELL")
  assert.equal(pendingSell?.status, "PENDING")
  assert.equal(pendingSell?.brokerOrderId, undefined)
  assert.equal(engine.getOrders().some((order) => order.side === "BUY"), false)

  const acknowledgedSell = new CanonicalOrder({
    clientOrderId: pendingSell.clientOrderId,
    brokerOrderId: `broker-${pendingSell.clientOrderId}`,
    market,
    side: "SELL",
    type: pendingSell.type,
    limitPrice: pendingSell.limitPrice,
    originalQuantity: pendingSell.originalQuantity,
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "OPEN",
    createdAt: pendingSell.createdAt,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const concurrentMarketTransition = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.02",
      timestamp: 2
    },
  })
  const userDataTransition = engine.processUserDataEvent({
    event: { executedOrder: acknowledgedSell },
  })
  const duplicateOrderTransition = engine.processUserDataEvent({
    event: { executedOrder: acknowledgedSell },
  })

  assert.deepEqual(cancellationIds, [])
  assert.equal(orders.length, 1)
  resolveAcknowledgement()
  const [initialResult, marketResult, userDataResult, duplicateResult] = await Promise.all([
    initialDecision, concurrentMarketTransition, userDataTransition, duplicateOrderTransition,
  ])
  assert.equal(initialResult.ok, true)
  assert.equal(marketResult.ok, true)
  assert.equal(userDataResult.ok, true)
  assert.equal(duplicateResult.ok, true)
  const activeOrders = engine.getOrders().filter((order) => ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.deepEqual(activeOrders.map(({ side }) => side).sort(), ["BUY", "SELL"])
  assert.deepEqual(cancellationIds, [])
  assert.deepEqual(accountedFills, [])
  assert.deepEqual(orders.map(({ side }) => side), ["SELL", "BUY"])
})


test("serializes concurrent market updates while a trailing BUY cancellation is pending", async () => {
  let resolveCancellation
  const cancelOrderGate = { promise: new Promise((resolve) => { resolveCancellation = resolve }) }
  let signalCancellationStarted
  const cancellationStarted = new Promise((resolve) => { signalCancellationStarted = resolve })
  const {
    engine,
    orders,
    cancellationIds
  } = await createHarness({
    cancelOrderGate,
    onCancelOrderStarted: () => signalCancellationStarted(),
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const initialBuy = engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(initialBuy)

  const trailingTransition = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })
  await cancellationStarted
  assert.deepEqual(cancellationIds, [initialBuy.brokerOrderId])
  assert.equal(orders.length, 1)

  const concurrentTransition = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 3
    },
  })
  assert.equal(orders.length, 1)

  resolveCancellation()
  const [trailingResult, concurrentResult] = await Promise.all([
    trailingTransition,
    concurrentTransition,
  ])

  assert.equal(trailingResult.ok, true)
  assert.equal(concurrentResult.ok, true)
  assert.equal(orders.length, 2)
  assert.deepEqual(cancellationIds, [initialBuy.brokerOrderId])
  const activeBuys = engine.getOrders().filter((order) =>
    order.side === "BUY" && ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.equal(activeBuys.length, 1)
  assert.equal(activeBuys[0].status, "OPEN")
})

test("serializes concurrent market updates while an initial BUY acknowledgement is pending", async () => {
  let resolveAcknowledgement
  const placeOrderGate = { promise: new Promise((resolve) => { resolveAcknowledgement = resolve }) }
  let signalBuySubmission
  const buySubmissionStarted = new Promise((resolve) => { signalBuySubmission = resolve })
  const {
    engine,
    orders
  } = await createHarness({
    placeOrderGate,
    deferOrderSide: "BUY",
    onPlaceOrderStarted: ({ order }) => {
      if (order.side === "BUY") {signalBuySubmission()}
    },
  })

  const initial = engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  await buySubmissionStarted
  const pendingBuy = engine.getOrders().find((order) => order.side === "BUY")
  assert.equal(pendingBuy.status, "PENDING")
  assert.equal(pendingBuy.brokerOrderId, undefined)

  const concurrentUpdates = [
    engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: {
        symbol: "DOGEUSDT",
        price: "100.01",
        timestamp: 2
      },
    }),
    engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: {
        symbol: "DOGEUSDT",
        price: "100.02",
        timestamp: 3
      },
    }),
  ]
  assert.equal(orders.length, 1)
  assert.equal(engine.getOrders().filter((order) => order.side === "BUY").length, 1)

  resolveAcknowledgement()
  const results = await Promise.all([initial, ...concurrentUpdates])

  assert.ok(results.every((result) => result.ok))
  assert.equal(orders.length, 1)
  const activeOrders = engine.getOrders().filter((order) =>
    ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.deepEqual(activeOrders.map((order) => order.side), ["BUY"])
  assert.equal(activeOrders[0].status, "OPEN")
})

test("replaces the recovery SELL before submitting the next standing BUY after a completed BUY", async () => {
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    orders,
    cancellationIds,
    pauses
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
  })

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const previousSell = engine.getOrders().find((order) => order.side === "SELL")
  const completedBuy = engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(previousSell)
  assert.ok(completedBuy)

  const transition = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: completedBuy }),
      fill: makeBuyFill({
        order: completedBuy,
        tradeId: "next-buy-completion-ordering",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95",
      }),
    },
  })

  assert.equal(transition.ok, true)
  assert.equal(transition.data.reevaluate, true)
  assert.deepEqual(cancellationIds, [previousSell.brokerOrderId])

  // Bootstrap handles this reevaluation directly from the same serialized
  // user-data callback; no new market-price event is needed.
  const reevaluation = await engine.evaluateLatest({ symbol: "DOGEUSDT" })
  assert.equal(reevaluation.ok, true)
  assert.deepEqual(orders.slice(-2).map(({ side }) => side), ["SELL", "BUY"])

  const activeOrders = engine.getOrders().filter((order) => ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.deepEqual(activeOrders.map(({ side }) => side).sort(), ["BUY", "SELL"])
  assert.deepEqual(pauses, [])
})


// eslint-disable-next-line max-lines-per-function, max-statements -- deterministic race test controls each fake-broker gate.
test("reconciles multiple BUY fills racing shutdown cancellation and replaces only the owned recovery SELL", async () => {
  const seeded = makeSeededRecoveryState()
  const stopping = { value: false }
  const portfolioRef = { current: seeded.portfolio }
  const ledgerRef = { current: seeded.recoveryLedger }
  const appliedFillIds = new Set()
  const appliedFills = []
  const sequence = []
  const buyOrderRef = { current: undefined }
  let buyFills = []
  let releaseCancel
  let signalCancelStarted
  const cancelOrderGate = { promise: new Promise((resolve) => { releaseCancel = resolve }) }
  const cancelStarted = new Promise((resolve) => { signalCancelStarted = resolve })
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    appConfig: withExternalOrdersPolicy("IGNORE"),
    hasUnownedOpenOrdersForSymbol: () => true,
    canTrade: () => !stopping.value,
    isStopping: () => stopping.value,
    getPortfolio: () => portfolioRef.current,
    getRecoveryLedger: () => ledgerRef.current,
    updateTradingAccounting: async ({ fill }) => {
      if (appliedFillIds.has(fill.id)) {return {
        ok: true,
        data: {
        applied: false,
        duplicate: true
      }
      }}
      appliedFillIds.add(fill.id)
      appliedFills.push(fill)
      portfolioRef.current = portfolioRef.current.applyFill({ fill }).portfolio
      ledgerRef.current = ledgerRef.current.applyFill({ fill }).ledger
      return {
        ok: true,
        data: {
        applied: true,
        duplicate: false
      }
      }
    },
    getTerminalFills: ({ orderId }) => orderId === buyOrderRef.current?.brokerOrderId ? buyFills : [],
    cancelOrderGate,
    cancelOrderStatus: ({ order }) => order.side === "BUY" ? "FILLED" : "CANCELED",
    cancelExecutedQuantity: ({ order }) => order.side === "BUY" ? order.originalQuantity.amount : "0",
    onCancelOrderStarted: ({ order }) => {
      sequence.push(`cancel:${order.side}`)
      if (order.side === "BUY") {signalCancelStarted()}
    },
    onPlaceOrder: ({ order }) => sequence.push(`submit:${order.side}`),
  })

  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const originalRecoverySell = harness.engine.getOrders().find((order) => order.side === "SELL")
  const buyOrder = harness.engine.getOrders().find((order) => order.side === "BUY")
  buyOrderRef.current = buyOrder
  assert.ok(originalRecoverySell)
  assert.ok(buyOrder)

  const firstQuantity = "0.5"
  const secondQuantity = subtractDecimal({
    left: buyOrder.originalQuantity.amount,
    right: firstQuantity
  })
  const firstQuote = multiplyDecimal({
    left: buyOrder.limitPrice.amount,
    right: firstQuantity
  })
  const secondQuote = multiplyDecimal({
    left: buyOrder.limitPrice.amount,
    right: secondQuantity
  })
  const makeCommissionedBuyFill = ({
    tradeId,
    quantity,
    quoteQuantity
  }) => new Fill({
    tradeId,
    brokerOrderId: buyOrder.brokerOrderId,
    clientOrderId: buyOrder.clientOrderId,
    market,
    side: "BUY",
    price: buyOrder.limitPrice,
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: quoteQuantity,
      asset: quoteAsset
    }),
    commissions: [new Commission({ amount: new Money({
      amount: "0.01",
      asset: quoteAsset
    }) })],
    commissionStatus: "COMPLETE",
  })
  const firstFill = makeCommissionedBuyFill({
    tradeId: "shutdown-buy-partial-fill",
    quantity: firstQuantity,
    quoteQuantity: firstQuote,
  })
  const secondFill = makeCommissionedBuyFill({
    tradeId: "shutdown-buy-final-fill",
    quantity: secondQuantity,
    quoteQuantity: secondQuote,
  })
  buyFills = [firstFill, secondFill]

  stopping.value = true
  const partialResult = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: buyOrder,
        executedQuantity: firstQuantity,
        updatedAt: 2,
      }),
      fill: firstFill,
    },
  })
  assert.equal(partialResult.ok, true, partialResult.errors?.[0]?.message)
  assert.equal(partialResult.data.recoverySellReplanPending, true)

  const cancellation = harness.engine.cancelOwnedBuyOrdersForShutdown()
  await cancelStarted
  const lateFinalFill = harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: secondFill,
    },
  })
  releaseCancel()
  const [cancellationResult, lateFillResult] = await Promise.all([cancellation, lateFinalFill])

  assert.equal(cancellationResult.ok, true, cancellationResult.errors?.[0]?.message)
  assert.equal(lateFillResult.ok, true, lateFillResult.errors?.[0]?.message)
  assert.deepEqual(
    appliedFills.map((fill) => fill.tradeId),
    ["shutdown-buy-partial-fill", "shutdown-buy-final-fill"],
    "Both real BUY fills must be applied exactly once even when the final fill races cancellation.",
  )
  assert.equal(portfolioRef.current.appliedFillIds.length, 3)
  assert.equal(ledgerRef.current.appliedFillIds.length, 3)
  assert.equal(
    portfolioRef.current.getPosition({ marketId: market.id }).baseQuantity.amount,
    addDecimal({
      left: seeded.portfolio.getPosition({ marketId: market.id }).baseQuantity.amount,
      right: buyOrder.originalQuantity.amount
    }),
  )

  const staleCoverage = await harness.engine.auditShutdownRecoverySellCoverage()
  assert.equal(staleCoverage.ok, true)
  assert.equal(staleCoverage.data.covered, false, "The pre-shutdown recovery SELL must not cover final BUY accounting.")
  assert.equal(staleCoverage.data.findings[0].reason, "RECOVERY_SELL_UNDERSIZED")

  const reconciliation = await harness.engine.reconcileRecoverySellsForShutdown()
  assert.equal(reconciliation.ok, true, reconciliation.errors?.[0]?.message)
  const coverage = await harness.engine.auditShutdownRecoverySellCoverage()
  assert.equal(coverage.ok, true)
  assert.equal(coverage.data.covered, true, "The replacement recovery SELL must cover final accounting.")

  const sells = harness.engine.getOrders().filter((order) => order.side === "SELL")
  const replacementSell = sells.at(-1)
  assert.equal(sells.length, 2)
  assert.equal(sells[0].status, "CANCELED")
  assert.equal(replacementSell.status, "OPEN")
  assert.equal(harness.engine.getOrders().filter((order) => order.side === "BUY").length, 1)
  assert.deepEqual(sequence.slice(-2), ["cancel:SELL", "submit:SELL"])

  const expectedDecision = conservativeStrategyPolicy.evaluate({
    marketPrice: {
      symbol: market.symbol,
      price: "100",
      timestamp: 1
    },
    pairConfig: appConfig.strategies.CG_coinGrabber.pairs.DOGEUSDT,
    settings: appConfig.strategies.CG_coinGrabber.settings,
    portfolio: portfolioRef.current,
    recoveryLedger: ledgerRef.current,
    marketMetadata,
    activeOrders: [],
    lastBuyPrice: harness.engine.getLastBuyPrice({ symbol: market.symbol }),
  })
  const expectedSell = expectedDecision.actions.find((action) => action.side === "SELL")
  assert.equal(replacementSell.originalQuantity.amount, expectedSell.quantity)
  assert.ok(compareDecimal({
    left: replacementSell.limitPrice.amount,
    right: expectedSell.price
  }) >= 0)
})

test("fails shutdown recovery closed when the legacy ledger cost mirror diverges from Position.spent", async () => {
  const seeded = makeSeededRecoveryState()
  const divergentLedger = new RecoveryLedger({
    market: seeded.recoveryLedger.market,
    buyCost: "999",
    netSellProceeds: seeded.recoveryLedger.netSellProceeds,
    appliedFillIds: seeded.recoveryLedger.appliedFillIds,
    appliedFillFingerprints: seeded.recoveryLedger.appliedFillFingerprints,
  })
  const stopping = { value: false }
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: divergentLedger,
    baseFreeBalance: "1",
    canTrade: () => !stopping.value,
    isStopping: () => stopping.value,
    getPortfolio: () => seeded.portfolio,
    getRecoveryLedger: () => divergentLedger,
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  stopping.value = true

  const reconciliation = await harness.engine.reconcileRecoverySellsForShutdown()
  assert.equal(reconciliation.ok, false)
  const audit = await harness.engine.auditShutdownRecoverySellCoverage()
  assert.equal(audit.ok, true)
  assert.equal(audit.data.covered, false)
  assert.equal(audit.data.findings[0].reason, "RECOVERY_SELL_PLAN_UNAVAILABLE")
  assert.equal(harness.orders.length, 0, "A divergent compatibility mirror must not lead to a speculative replacement order.")
})

test("fails closed when shutdown recovery SELL cancellation or replacement submission is unresolved", async () => {
  for (const scenario of [
    {
      name: "cancel",
      cancelFailure: true
    },
    {
      name: "replacement-submit",
      placeOrderFailureAfterCount: 2
    },
  ]) {
    const seeded = makeSeededRecoveryState()
    const stopping = { value: false }
    const portfolioRef = { current: seeded.portfolio }
    const ledgerRef = { current: seeded.recoveryLedger }
    const harness = await createHarness({
      initialPortfolio: seeded.portfolio,
      initialRecoveryLedger: seeded.recoveryLedger,
      baseFreeBalance: "1",
      canTrade: () => !stopping.value,
      isStopping: () => stopping.value,
      getPortfolio: () => portfolioRef.current,
      getRecoveryLedger: () => ledgerRef.current,
      updateTradingAccounting: async ({ fill }) => {
        if (portfolioRef.current.appliedFillIds.includes(fill.id)) {
          return {
            ok: true,
            data: {
            applied: false,
            duplicate: true
          }
          }
        }
        portfolioRef.current = portfolioRef.current.applyFill({ fill }).portfolio
        ledgerRef.current = ledgerRef.current.applyFill({ fill }).ledger
        return {
          ok: true,
          data: {
          applied: true,
          duplicate: false
        }
        }
      },
      cancelFailure: scenario.cancelFailure ?? false,
      placeOrderFailureAfterCount: scenario.placeOrderFailureAfterCount,
    })
    await harness.engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: {
        symbol: "DOGEUSDT",
        price: "100",
        timestamp: 1
      },
    })
    const buyOrder = harness.engine.getOrders().find((order) => order.side === "BUY")
    assert.ok(buyOrder)

    const fill = makeBuyFill({
      order: buyOrder,
      tradeId: `shutdown-unresolved-${scenario.name}`,
      price: buyOrder.limitPrice.amount,
      quantity: buyOrder.originalQuantity.amount,
      quoteQuantity: multiplyDecimal({
        left: buyOrder.limitPrice.amount,
        right: buyOrder.originalQuantity.amount,
      }),
    })
    stopping.value = true
    const fillResult = await harness.engine.processUserDataEvent({
      event: {
        executionType: "TRADE",
        executedOrder: makeFilledOrder({ order: buyOrder }),
        fill,
      },
    })
    assert.equal(fillResult.ok, true, fillResult.errors?.[0]?.message)

    const reconciliation = await harness.engine.reconcileRecoverySellsForShutdown()
    assert.equal(reconciliation.ok, false, `An unresolved ${scenario.name} outcome must fail shutdown recovery.`)
    const audit = await harness.engine.auditShutdownRecoverySellCoverage()
    assert.equal(audit.ok, true)
    assert.equal(audit.data.covered, false, "Unresolved recovery SELL lifecycle state must never pass final coverage.")
    assert.equal(
      harness.engine.getOrders().filter((order) => order.side === "BUY").length,
      1,
      "Shutdown recovery must not submit another standing BUY after either failure.",
    )
  }
})

test("does not submit the next standing BUY when recovery SELL submission fails", async () => {
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    orders,
    pauses
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    placeOrderFailure: true,
  })

  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(orders.map(({ side }) => side), ["SELL"])
  assert.ok(pauses.includes("ORDER_SUBMISSION_REJECTED_OR_UNKNOWN"))
})


function makeOrderStatusUpdate({
  order,
  brokerOrderId = order.brokerOrderId,
  status,
  executedQuantity = "0",
  updatedAt = 2
}) {
  const terminal = ["FILLED", "CANCELED", "REJECTED", "EXPIRED"].includes(status)
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId,
    market: order.market,
    side: order.side,
    type: order.type,
    limitPrice: order.limitPrice,
    originalQuantity: order.originalQuantity,
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: baseAsset
    }),
    status,
    createdAt: order.createdAt,
    acknowledgedAt: order.acknowledgedAt,
    updatedAt,
    ...(terminal ? { completedAt: updatedAt } : {}),
  })
}

test("keeps UNKNOWN exchange order states active and waits for authoritative resolution", async () => {
  const {
    engine,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const unknown = makeOrderStatusUpdate({
    order: buyOrder,
    status: "UNKNOWN"
  })
  const result = await engine.processUserDataEvent({ event: { executedOrder: unknown } })

  assert.equal(result.ok, true)
  assert.equal(result.data.waitingForTerminalState, true)
  assert.equal(engine.getOrders().find((order) => order.clientOrderId === buyOrder.clientOrderId).status, "UNKNOWN")
  assert.deepEqual(pauses, [])
})

test("accepts a matching Binance NEW report after a lost order acknowledgement", async () => {
  const {
    engine,
    cancellationIds
  } = await createHarness({
    placeOrderThrow: true,
    eventPublisher: {
      publish: () => ({ ok: true }),
      flush: async () => ({
        ok: true,
        durable: true
      }),
    },
  })
  const submission = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(submission.ok, false)
  const unknownOrder = engine.getOrders().find((order) => order.side === "BUY")
  assert.equal(unknownOrder.status, "UNKNOWN")
  assert.equal(unknownOrder.brokerOrderId, undefined)

  const exchangeNew = makeOrderStatusUpdate({
    order: unknownOrder,
    brokerOrderId: "binance-accepted-after-timeout",
    status: "OPEN",
    updatedAt: 1,
  })
  const result = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "NEW",
      executedOrder: exchangeNew
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.notEqual(result.data.ignored, true, "The authoritative NEW report must not be classified as stale or ignored.")
  const tracked = engine.getOrders().find((order) => order.clientOrderId === unknownOrder.clientOrderId)
  assert.equal(tracked.status, "OPEN")
  assert.equal(tracked.brokerOrderId, "binance-accepted-after-timeout", "The exchange-assigned ID must become available to shutdown cancellation.")

  const shutdown = await engine.cancelOwnedBuyOrdersForShutdown()
  assert.equal(shutdown.ok, true, shutdown.errors?.[0]?.message)
  assert.deepEqual(cancellationIds, ["binance-accepted-after-timeout"], "Shutdown must cancel the recovered owned BUY by its exchange-assigned ID, never by a guessed or missing ID.")
  assert.equal(engine.getOrders().find((order) => order.clientOrderId === unknownOrder.clientOrderId).status, "CANCELED")
})

test("reevaluates after unfilled CANCELED and EXPIRED order states", async () => {
  for (const status of ["CANCELED", "EXPIRED"]) {
    const {
      engine,
      pauses
    } = await createHarness()
    await engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: {
        symbol: "DOGEUSDT",
        price: "100",
        timestamp: 1
      },
    })
    const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
    const terminal = makeOrderStatusUpdate({
      order: buyOrder,
      status
    })
    const result = await engine.processUserDataEvent({ event: { executedOrder: terminal } })

    assert.equal(result.ok, true, status)
    assert.equal(result.data.reevaluate, true, status)
    assert.deepEqual(pauses, [], status)
  }
})

test("pauses when an EXPIRED order reports execution without reconciled fills", async () => {
  const {
    engine,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const expired = makeOrderStatusUpdate({
    order: buyOrder,
    status: "EXPIRED",
    executedQuantity: "0.1",
  })
  const result = await engine.processUserDataEvent({ event: { executedOrder: expired } })

  assert.equal(result.ok, false)
  assert.deepEqual(pauses, ["PARTIALLY_FILLED_ORDER_CANCELED_REQUIRES_REVIEW"])
})

test("pauses on an exchange REJECTED order update", async () => {
  const {
    engine,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const rejected = makeOrderStatusUpdate({
    order: buyOrder,
    status: "REJECTED"
  })
  const result = await engine.processUserDataEvent({ event: { executedOrder: rejected } })

  assert.equal(result.ok, true)
  assert.equal(result.data.paused, true)
  assert.deepEqual(pauses, ["ORDER_REJECTED"])
})


test("terminal recovery SELL reconciles partial fills and commissions before reevaluation", async () => {
  for (const status of ["CANCELED", "EXPIRED"]) {
    const seeded = makeSeededRecoveryState()
    let currentPortfolio = seeded.portfolio
    let currentRecoveryLedger = seeded.recoveryLedger
    const accountedFills = []
    const harness = await createHarness({
      initialPortfolio: seeded.portfolio,
      initialRecoveryLedger: seeded.recoveryLedger,
      baseFreeBalance: "1",
      getPortfolio: () => currentPortfolio,
      getRecoveryLedger: () => currentRecoveryLedger,
      getTerminalFills: ({ orderId }) => sellFill?.brokerOrderId === orderId ? [sellFill] : [],
      updateTradingAccounting: async ({ fill }) => {
        currentPortfolio = currentPortfolio.applyFill({ fill }).portfolio
        currentRecoveryLedger = currentRecoveryLedger.applyFill({ fill }).ledger
        accountedFills.push(fill)
        return {
          ok: true,
          data: {
          applied: true,
          duplicate: false
        }
        }
      },
    })
    await harness.engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: {
        symbol: "DOGEUSDT",
        price: "100",
        timestamp: 1
      },
    })
    const sellOrder = harness.engine.getOrders().find((order) => order.side === "SELL")
    const quoteQuantity = multiplyDecimal({
      left: sellOrder.limitPrice.amount,
      right: "0.2"
    })
    const sellFill = makeSellFill({
      order: sellOrder,
      tradeId: `terminal-recovery-sell-${status.toLowerCase()}`,
      quantity: "0.2",
      quoteQuantity,
      commissionAmount: "0.01",
    })
    const terminalOrder = makeOrderStatusUpdate({
      order: sellOrder,
      status,
      executedQuantity: "0.2",
    })

    const result = await harness.engine.processUserDataEvent({
      event: { executedOrder: terminalOrder },
    })

    assert.equal(result.ok, true, result.errors?.[0]?.message)
    assert.equal(result.data.reevaluate, true)
    assert.deepEqual(harness.pauses, [])
    assert.equal(currentPortfolio.positions[0].baseQuantity.amount, "0.8")
    assert.equal(currentPortfolio.positions[0].spent.amount, "100")
    assert.equal(
      currentPortfolio.positions[0].quoteNetCashFlow.amount,
      subtractDecimal({
        left: subtractDecimal({
          left: quoteQuantity,
          right: "0.01"
        }),
        right: "100",
      }),
    )
    assert.equal(
      currentRecoveryLedger.netSellProceeds,
      subtractDecimal({
        left: quoteQuantity,
        right: "0.01"
      }),
    )
    assert.equal(accountedFills.length, 1)
    assert.equal(accountedFills[0].commissions[0].amount.amount, "0.01")
  }
})


test("classifies terminal fill-history REST timeouts as retryable reconciliation failures", async () => {
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    getTerminalFills: () => {
      throw Object.assign(new Error("terminal fill history timed out"), {
        recoveryFailure: {
          category: "REST_RECONCILIATION",
          stage: "TERMINAL_FILL_HISTORY",
          retryable: true
        },
      })
    },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = harness.engine.getOrders().find((order) => order.side === "SELL")
  const result = await harness.engine.processUserDataEvent({
    event: {
      executedOrder: makeOrderStatusUpdate({
        order: sellOrder,
        status: "CANCELED",
        executedQuantity: "0",
      }),
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.failure, {
    category: "REST_RECONCILIATION",
    stage: "TERMINAL_FILL_HISTORY",
    retryable: true,
  })
  assert.ok(harness.pauses.includes("TERMINAL_ORDER_FILL_HISTORY_UNAVAILABLE"))
})

test("treats unclassified thrown terminal fill-history adapter errors as terminal", async () => {
  const seeded = makeSeededRecoveryState()
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    getTerminalFills: () => { throw new Error("unclassified terminal fill-history adapter exception") },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = harness.engine.getOrders().find((order) => order.side === "SELL")
  const result = await harness.engine.processUserDataEvent({
    event: {
      executedOrder: makeOrderStatusUpdate({
        order: sellOrder,
        status: "CANCELED",
        executedQuantity: "0",
      }),
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "TERMINAL_FILL_HISTORY_READ_EXCEPTION",
    retryable: false,
  })
})

test("terminal recovery SELL with incomplete or conflicting fill history cannot advance", async () => {
  for (const fillHistory of [[], "conflicting"]) {
    const seeded = makeSeededRecoveryState()
    let currentPortfolio = seeded.portfolio
    let currentRecoveryLedger = seeded.recoveryLedger
    const sellFillRef = { current: undefined }
    const harness = await createHarness({
      initialPortfolio: seeded.portfolio,
      initialRecoveryLedger: seeded.recoveryLedger,
      baseFreeBalance: "1",
      getPortfolio: () => currentPortfolio,
      getRecoveryLedger: () => currentRecoveryLedger,
      getTerminalFills: ({ orderId }) => {
        if (sellFillRef.current?.brokerOrderId !== orderId) {return []}
        return fillHistory === "conflicting" ? [sellFillRef.current, makeSellFill({
          order: sellOrderRef,
          tradeId: sellFillRef.current.tradeId,
          quantity: "0.1",
          quoteQuantity: "1",
        })] : []
      },
      updateTradingAccounting: async ({ fill }) => {
        currentPortfolio = currentPortfolio.applyFill({ fill }).portfolio
        currentRecoveryLedger = currentRecoveryLedger.applyFill({ fill }).ledger
        return {
          ok: true,
          data: {
          applied: true,
          duplicate: false
        }
        }
      },
    })
    await harness.engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: {
        symbol: "DOGEUSDT",
        price: "100",
        timestamp: 1
      },
    })
    const sellOrderRef = harness.engine.getOrders().find((order) => order.side === "SELL")
    const sellOrder = sellOrderRef
    sellFillRef.current = makeSellFill({
      order: sellOrder,
      tradeId: `invalid-terminal-sell-${fillHistory === "conflicting" ? "conflict" : "missing"}`,
      quantity: "0.2",
      quoteQuantity: "20",
    })
    const result = await harness.engine.processUserDataEvent({
      event: {
        executedOrder: makeOrderStatusUpdate({
          order: sellOrder,
          status: "CANCELED",
          executedQuantity: "0.2",
        }),
      },
    })

    assert.equal(result.ok, false)
    assert.equal(harness.accountedFills.length, 0)
    assert.equal(currentPortfolio.positions[0].baseQuantity.amount, "1")
    assert.equal(currentRecoveryLedger.netSellProceeds, "0")
    assert.equal(harness.engine.getOrders().filter((order) => order.side === "SELL").length, 1)
    assert.ok(harness.pauses.includes(
      fillHistory === "conflicting"
        ? "TERMINAL_ORDER_FILL_CONFLICTING_DUPLICATE"
        : "TERMINAL_ORDER_EXECUTED_QUANTITY_MISMATCH",
    ))
  }
})

test("accounts a recovery SELL fill during cancellation once when its late stream event is replayed", async () => {
  let releaseCancel
  let signalCancelStarted
  const cancelOrderGate = { promise: new Promise((resolve) => { releaseCancel = resolve }) }
  const cancelStarted = new Promise((resolve) => { signalCancelStarted = resolve })
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    accountedFills,
    pauses,
    cancellationIds
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    cancelWithFill: true,
    cancelOrderGate,
    onCancelOrderStarted: () => signalCancelStarted(),
    accountingApplied: true,
  })

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(buyOrder)
  assert.ok(sellOrder)

  const buyTransition = engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "buy-triggering-recovery-sell-cancel",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95",
      }),
    },
  })
  await cancelStarted

  const sellFill = makeSellFill({
    order: sellOrder,
    tradeId: "recovery-cancel-fill-sell",
    quantity: "0.1",
    quoteQuantity: multiplyDecimal({
      left: sellOrder.limitPrice.amount,
      right: "0.1"
    }),
  })
  const lateSellEvent = engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makePartiallyFilledOrder({
        order: sellOrder,
        executedQuantity: "0.1",
        updatedAt: 2,
      }),
      fill: sellFill,
    },
  })

  releaseCancel()
  const [buyResult, lateResult] = await Promise.all([buyTransition, lateSellEvent])

  assert.equal(buyResult.ok, true)
  assert.equal(buyResult.data.reevaluate, true)
  assert.equal(lateResult.ok, true)
  assert.equal(lateResult.data.ignored, true)
  assert.deepEqual(cancellationIds, [sellOrder.brokerOrderId])
  const canceledSellTradeId = `recovery-cancel-fill-sell-${sellOrder.brokerOrderId}`
  assert.equal(accountedFills.filter((fill) => fill.tradeId === canceledSellTradeId).length, 1)
  assert.deepEqual(accountedFills.map((fill) => fill.tradeId), [
    "buy-triggering-recovery-sell-cancel",
    canceledSellTradeId,
  ])
  assert.deepEqual(pauses, [])
})


function makeOpenOrder({
  order,
  brokerOrderId = order.brokerOrderId,
  clientOrderId = order.clientOrderId,
  executedQuantity = "0"
} = {}) {
  const openOrder = new Order({
    symbol: order.market.symbol,
    type: order.type,
    side: order.side,
    quantity: Number(order.originalQuantity.amount) - Number(executedQuantity),
    price: Number(order.limitPrice.amount),
    id: brokerOrderId,
    clientOrderId,
  })
  openOrder.originalQuantity = order.originalQuantity.amount
  openOrder.executedQuantity = executedQuantity
  openOrder.status = Number(executedQuantity) === 0 ? "NEW" : "PARTIALLY_FILLED"
  return openOrder
}

test("reconciles missing REST fills for an owned order and deduplicates overlapping stream delivery", async () => {
  const {
    engine,
    broker,
    accountedFills,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const firstFill = makeBuyFill({
    order: buyOrder,
    tradeId: "rest-fill-1",
    price: "99.95",
    quantity: "0.5",
    quoteQuantity: "49.975",
    executedAt: 10,
  })
  const secondFill = makeBuyFill({
    order: buyOrder,
    tradeId: "rest-fill-2",
    price: "99.95",
    quantity: "0.5",
    quoteQuantity: "49.975",
    executedAt: 20,
  })
  const historyOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "FILLED",
    executedQuantity: "1",
    updatedAt: 3,
  })
  const externalOrder = makeOpenOrder({
    order: buyOrder,
    brokerOrderId: "manual-broker",
    clientOrderId: "manual-client",
  })
  const calls = []
  broker.getOpenOrders = async ({ symbol }) => {
    calls.push(["getOpenOrders", symbol])
    return {
      ok: true,
      data: [externalOrder, makeOpenOrder({
      order: buyOrder,
      executedQuantity: "0.00000000"
    })]
    }
  }
  broker.getCanonicalOrderHistory = async ({
    symbol,
    orderId
  }) => {
    calls.push(["getCanonicalOrderHistory", symbol, orderId])
    return {
      ok: true,
      data: [historyOrder]
    }
  }
  broker.getFills = async ({
    symbol,
    orderId
  }) => {
    calls.push(["getFills", symbol, orderId])
    return {
      ok: true,
      data: [secondFill, firstFill]
    }
  }

  const reconciled = await engine.reconcileOwnedOrders()

  assert.equal(reconciled.ok, true, reconciled.errors?.[0]?.message)
  assert.deepEqual(accountedFills.map((fill) => fill.tradeId), ["rest-fill-1", "rest-fill-2"])
  assert.equal(
    engine.getOrders().find((order) => order.brokerOrderId === buyOrder.brokerOrderId).status,
    "FILLED",
  )
  assert.equal(engine.getOrders().length, 1)
  assert.deepEqual(calls, [
    ["getOpenOrders", "DOGEUSDT"],
    ["getCanonicalOrderHistory", "DOGEUSDT", buyOrder.brokerOrderId],
    ["getFills", "DOGEUSDT", buyOrder.brokerOrderId],
  ])

  const overlappingStreamEvent = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeOrderStatusUpdate({
      order: buyOrder,
      status: "PARTIALLY_FILLED",
      executedQuantity: "0.2",
      updatedAt: 2,
    }),
      fill: firstFill
    },
  })
  assert.equal(overlappingStreamEvent.ok, true)
  assert.equal(accountedFills.length, 2)
  assert.deepEqual(pauses, [])
})


test("accounts missing earlier REST fills without replaying cumulative order quantity backwards", async () => {
  const {
    engine,
    broker,
    accountedFills,
    pauses
  } = await createHarness({ accountingApplied: true })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const earlierFill = makeBuyFill({
    order: buyOrder,
    tradeId: "rest-earlier-fill",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const laterStreamFill = makeBuyFill({
    order: buyOrder,
    tradeId: "stream-later-fill",
    price: "99.95",
    quantity: "0.3",
    quoteQuantity: "29.985",
    executedAt: 20,
  })
  const streamedOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.5",
    updatedAt: 3,
  })
  const streamResult = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: streamedOrder,
      fill: laterStreamFill,
    },
  })
  assert.equal(streamResult.ok, true)
  assert.deepEqual(accountedFills.map((fill) => fill.tradeId), ["stream-later-fill"])

  const historyOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.5",
    updatedAt: 4,
  })
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [makeOpenOrder({
      order: buyOrder,
      executedQuantity: "0.5"
    })],
  })
  broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [historyOrder]
  })
  broker.getFills = async () => ({
    ok: true,
    data: [laterStreamFill, earlierFill]
  })

  const reconciled = await engine.reconcileOwnedOrders()

  assert.equal(reconciled.ok, true, reconciled.errors?.[0]?.message)
  assert.deepEqual(
    accountedFills.map((fill) => fill.tradeId).sort(),
    ["rest-earlier-fill", "stream-later-fill"],
  )
  const reconciledOrder = engine.getOrders().find((order) => order.brokerOrderId === buyOrder.brokerOrderId)
  assert.equal(reconciledOrder.status, "PARTIALLY_FILLED")
  assert.equal(reconciledOrder.executedQuantity.amount, "0.5")
  assert.deepEqual(pauses, [])
})

test("fails closed without applying partial REST fills when cumulative history is incomplete", async () => {
  const {
    engine,
    broker,
    accountedFills,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const partialFill = makeBuyFill({
    order: buyOrder,
    tradeId: "incomplete-rest-fill",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const historyOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.4",
    updatedAt: 3,
  })
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [makeOpenOrder({
    order: buyOrder,
    executedQuantity: "0.4"
  })]
  })
  broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [historyOrder]
  })
  broker.getFills = async () => ({
    ok: true,
    data: [partialFill]
  })

  const result = await engine.reconcileOwnedOrders()

  assert.equal(result.ok, false)
  assert.equal(accountedFills.length, 0)
  assert.ok(pauses.includes("REST_STREAM_RECONCILIATION_FAILED"))
  assert.deepEqual(engine.getPausedMarkets(), ["DOGEUSDT"])
})


test("fails closed when REST fill IDs conflict with executions already processed from the stream", async () => {
  const {
    engine,
    broker,
    accountedFills,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const streamFill = makeBuyFill({
    order: buyOrder,
    tradeId: "stream-execution-id",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const restFillWithDifferentId = makeBuyFill({
    order: buyOrder,
    tradeId: "rest-conflicting-execution-id",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const partialOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.2",
    updatedAt: 2,
  })
  const streamResult = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: partialOrder,
      fill: streamFill
    },
  })
  assert.equal(streamResult.ok, true)
  assert.equal(accountedFills.length, 1)

  broker.getOpenOrders = async () => ({
    ok: true,
    data: [makeOpenOrder({
    order: buyOrder,
    executedQuantity: "0.2"
  })]
  })
  broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [partialOrder]
  })
  broker.getFills = async () => ({
    ok: true,
    data: [restFillWithDifferentId]
  })

  const result = await engine.reconcileOwnedOrders()

  assert.equal(result.ok, false)
  assert.equal(accountedFills.length, 1)
  assert.ok(pauses.includes("REST_STREAM_RECONCILIATION_FAILED"))
  assert.deepEqual(engine.getPausedMarkets(), ["DOGEUSDT"])
})


test("rejects REST order history that is behind an already processed stream fill", async () => {
  const {
    engine,
    broker,
    accountedFills,
    pauses
  } = await createHarness({ accountingApplied: true })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const streamFill = makeBuyFill({
    order: buyOrder,
    tradeId: "stream-ahead-of-rest",
    price: "99.95",
    quantity: "0.5",
    quoteQuantity: "49.975",
    executedAt: 10,
  })
  const streamOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.5",
    updatedAt: 3,
  })
  const streamResult = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: streamOrder,
      fill: streamFill
    },
  })
  assert.equal(streamResult.ok, true)
  assert.equal(accountedFills.length, 1)

  const staleRestFill = makeBuyFill({
    order: buyOrder,
    tradeId: "stale-rest-history-fill",
    price: "99.95",
    quantity: "0.4",
    quoteQuantity: "39.98",
    executedAt: 9,
  })
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [makeOpenOrder({
      order: buyOrder,
      executedQuantity: "0.4"
    })],
  })
  broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [makeOrderStatusUpdate({
      order: buyOrder,
      status: "PARTIALLY_FILLED",
      executedQuantity: "0.4",
      updatedAt: 4,
    })],
  })
  broker.getFills = async () => ({
    ok: true,
    data: [staleRestFill]
  })

  const result = await engine.reconcileOwnedOrders()

  assert.equal(result.ok, false)
  assert.equal(accountedFills.length, 1)
  assert.equal(accountedFills[0].tradeId, "stream-ahead-of-rest")
  assert.equal(
    engine.getOrders().find((order) => order.brokerOrderId === buyOrder.brokerOrderId).executedQuantity.amount,
    "0.5",
  )
  assert.ok(pauses.includes("REST_STREAM_RECONCILIATION_FAILED"))
  assert.deepEqual(engine.getPausedMarkets(), ["DOGEUSDT"])
})

test("processes stream fills received during REST reads before applying the REST snapshot", async () => {
  let releaseFills
  let signalFillsStarted
  const fillsGate = { promise: new Promise((resolve) => { releaseFills = resolve }) }
  const fillsStarted = new Promise((resolve) => { signalFillsStarted = resolve })
  const {
    engine,
    broker,
    accountedFills,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const recoveredFill = makeBuyFill({
    order: buyOrder,
    tradeId: "stream-during-rest-read",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const partialOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.2",
    updatedAt: 3,
  })
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [makeOpenOrder({
      order: buyOrder,
      executedQuantity: "0"
    })],
  })
  broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [partialOrder]
  })
  broker.getFills = async () => {
    signalFillsStarted()
    await fillsGate.promise
    return {
      ok: true,
      data: [recoveredFill]
    }
  }

  const reconciliation = engine.reconcileOwnedOrders()
  await fillsStarted
  const streamResult = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: makeOrderStatusUpdate({
        order: buyOrder,
        status: "PARTIALLY_FILLED",
        executedQuantity: "0.2",
        updatedAt: 2,
      }),
      fill: recoveredFill,
    },
  })
  releaseFills()
  const reconciled = await reconciliation

  assert.equal(streamResult.ok, true)
  assert.equal(reconciled.ok, true, reconciled.errors?.[0]?.message)
  assert.equal(accountedFills.length, 1)
  assert.deepEqual(pauses, [])
})


test("uses the injected strategy policy instead of a hard-coded Conservative evaluator", async () => {
  let evaluations = 0
  const strategyPolicy = {
    evaluate: ({ marketPrice }) => {
      evaluations += 1
      return Object.freeze({
        strategy: "TEST_POLICY",
        symbol: marketPrice.symbol,
        action: "NO_ACTION",
        actions: Object.freeze([]),
        reason: "TEST_POLICY_NO_ACTION",
      })
    },
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const {
    engine,
    orders
  } = await createHarness({ strategyPolicy })

  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, true)
  assert.equal(evaluations, 1)
  assert.equal(orders.length, 0)
})


test("a partial BUY fill creates active Portfolio inventory before trailing can reprice", async () => {
  let repricingEvaluations = 0
  const strategyPolicy = {
    ...conservativeStrategyPolicy,
    evaluateTrailingBuyRepricing: (input) => {
      repricingEvaluations += 1
      return conservativeStrategyPolicy.evaluateTrailingBuyRepricing(input)
    },
  }
  const harness = await createHarness({
    strategyPolicy,
    updateTradingAccounting: async ({ fill }) => {
      const portfolioUpdate = harness.getCurrentPortfolio().applyFill({ fill })
      const ledgerUpdate = harness.getCurrentRecoveryLedger().applyFill({ fill })
      harness.setCurrentPortfolio(portfolioUpdate.portfolio)
      harness.setCurrentRecoveryLedger(ledgerUpdate.ledger)
      return {
        ok: true,
        data: {
        applied: true,
        duplicate: false
      }
      }
    },
  })

  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buy = harness.engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(buy)
  const partialOrder = new CanonicalOrder({
    clientOrderId: buy.clientOrderId,
    brokerOrderId: buy.brokerOrderId,
    market,
    side: "BUY",
    type: buy.type,
    limitPrice: buy.limitPrice,
    originalQuantity: buy.originalQuantity,
    executedQuantity: new Quantity({
      amount: "0.1",
      asset: baseAsset
    }),
    status: "PARTIALLY_FILLED",
    createdAt: buy.createdAt,
    acknowledgedAt: buy.acknowledgedAt,
    updatedAt: 2,
  })
  const fill = makeBuyFill({
    order: buy,
    tradeId: "trailing-partial-buy-fill",
    price: buy.limitPrice.amount,
    quantity: "0.1",
    quoteQuantity: multiplyDecimal({
      left: buy.limitPrice.amount,
      right: "0.1"
    }),
  })
  const applied = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: partialOrder,
      fill
    },
  })
  assert.equal(applied.ok, true, applied.errors?.[0]?.message)
  assert.equal(harness.getCurrentPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount, "0.1")

  const update = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 3
    },
  })
  assert.equal(update.ok, true, update.errors?.[0]?.message)
  assert.equal(repricingEvaluations, 0)
  assert.deepEqual(harness.cancellationIds, [])
})

test("a partial recovery SELL fill leaves active Position inventory protected from trailing repricing", async () => {
  const seeded = makeSeededRecoveryState()
  let repricingEvaluations = 0
  const strategyPolicy = {
    ...conservativeStrategyPolicy,
    evaluate: (input) => conservativeStrategyPolicy.evaluate({
      ...input,
      lastBuyPrice: "100"
    }),
    evaluateTrailingBuyRepricing: (input) => {
      repricingEvaluations += 1
      return conservativeStrategyPolicy.evaluateTrailingBuyRepricing(input)
    },
  }
  const harness = await createHarness({
    strategyPolicy,
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    updateTradingAccounting: async ({ fill }) => {
      const portfolioUpdate = harness.getCurrentPortfolio().applyFill({ fill })
      const ledgerUpdate = harness.getCurrentRecoveryLedger().applyFill({ fill })
      harness.setCurrentPortfolio(portfolioUpdate.portfolio)
      harness.setCurrentRecoveryLedger(ledgerUpdate.ledger)
      return {
        ok: true,
        data: {
        applied: true,
        duplicate: false
      }
      }
    },
  })

  const initial = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(initial.ok, true, initial.errors?.[0]?.message)
  const buy = harness.engine.getOrders().find((order) => order.side === "BUY")
  const sell = harness.engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(buy)
  assert.ok(sell)

  const partialSell = new CanonicalOrder({
    clientOrderId: sell.clientOrderId,
    brokerOrderId: sell.brokerOrderId,
    market,
    side: "SELL",
    type: sell.type,
    limitPrice: sell.limitPrice,
    originalQuantity: sell.originalQuantity,
    executedQuantity: new Quantity({
      amount: "0.1",
      asset: baseAsset
    }),
    status: "PARTIALLY_FILLED",
    createdAt: sell.createdAt,
    acknowledgedAt: sell.acknowledgedAt,
    updatedAt: 2,
  })
  const fill = makeSellFill({
    order: sell,
    tradeId: "trailing-partial-recovery-sell-fill",
    quantity: "0.1",
    quoteQuantity: multiplyDecimal({
      left: sell.limitPrice.amount,
      right: "0.1"
    }),
  })
  const applied = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: partialSell,
      fill
    },
  })
  assert.equal(applied.ok, true, applied.errors?.[0]?.message)
  assert.equal(harness.getCurrentPortfolio().getPosition({ marketId: market.id }).baseQuantity.amount, "0.9")

  const update = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 3
    },
  })
  assert.equal(update.ok, true, update.errors?.[0]?.message)
  assert.equal(repricingEvaluations, 0)
  assert.deepEqual(harness.cancellationIds, [])
  const unchangedSell = harness.engine.getOrders().find((order) => order.clientOrderId === sell.clientOrderId)
  assert.equal(unchangedSell.status, "PARTIALLY_FILLED")
  assert.equal(unchangedSell.limitPrice.amount, sell.limitPrice.amount)
  assert.equal(unchangedSell.originalQuantity.amount, sell.originalQuantity.amount)
  assert.equal(harness.engine.getOrders().filter((order) => order.side === "SELL").length, 1)
})

test("suppresses trailing BUY repricing while an actual active Position exists", async () => {
  const seeded = makeSeededRecoveryState()
  let repricingEvaluations = 0
  const strategyPolicy = {
    ...conservativeStrategyPolicy,
    evaluate: (input) => conservativeStrategyPolicy.evaluate({
      ...input,
      lastBuyPrice: "100"
    }),
    evaluateTrailingBuyRepricing: (input) => {
      repricingEvaluations += 1
      return conservativeStrategyPolicy.evaluateTrailingBuyRepricing(input)
    },
  }
  const harness = await createHarness({
    strategyPolicy,
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
  })

  const first = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(first.ok, true, first.errors?.[0]?.message)
  const initialBuy = harness.engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(initialBuy)

  const upward = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })
  assert.equal(upward.ok, true, upward.errors?.[0]?.message)
  const downward = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "99.90",
      timestamp: 3
    },
  })
  assert.equal(downward.ok, true, downward.errors?.[0]?.message)

  assert.equal(repricingEvaluations, 0, "the trailing repricing policy must not run with active inventory")
  assert.deepEqual(harness.cancellationIds, [], "an active Position must prevent trailing cancellation")
  assert.equal(harness.orders.filter((order) => order.side === "BUY").length, 1)
  assert.equal(harness.engine.getOrders().find((order) => order.side === "BUY").clientOrderId, initialBuy.clientOrderId)
})

test("reprices an active BUY normally when no Position exists", async () => {
  const harness = await createHarness()

  const first = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(first.ok, true, first.errors?.[0]?.message)
  const initialBuy = harness.engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(initialBuy)

  const repriced = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(repriced.ok, true, repriced.errors?.[0]?.message)
  assert.equal(harness.cancellationIds.length, 1)
  assert.equal(harness.cancellationIds[0], initialBuy.brokerOrderId)
  const activeBuys = harness.engine.getOrders().filter((order) =>
    order.side === "BUY" && ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.equal(activeBuys.length, 1)
  assert.notEqual(activeBuys[0].clientOrderId, initialBuy.clientOrderId)
})

test("allows trailing BUY repricing when only retained free inventory exists", async () => {
  const portfolio = new Portfolio({
    positions: [new Position({
      market,
      baseQuantity: new Quantity({
        amount: "0",
        asset: baseAsset
      }),
      freeBaseQuantity: new Quantity({
        amount: "1",
        asset: baseAsset
      }),
      quoteNetCashFlow: new Money({
        amount: "0",
        asset: quoteAsset
      }),
    })],
  })
  const harness = await createHarness({ initialPortfolio: portfolio })

  const first = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(first.ok, true, first.errors?.[0]?.message)

  const initialBuy = harness.engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(initialBuy)
  const repriced = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(repriced.ok, true, repriced.errors?.[0]?.message)
  assert.equal(harness.cancellationIds.length, 1)
  assert.equal(harness.cancellationIds[0], initialBuy.brokerOrderId)
  const activeBuys = harness.engine.getOrders().filter((order) =>
    order.side === "BUY" && ["PENDING", "OPEN", "PARTIALLY_FILLED", "UNKNOWN"].includes(order.status))
  assert.equal(activeBuys.length, 1)
  assert.notEqual(activeBuys[0].clientOrderId, initialBuy.clientOrderId)
})

test("uses the injected trailing repricing policy", async () => {
  let repricingEvaluations = 0
  const strategyPolicy = {
    ...conservativeStrategyPolicy,
    evaluateTrailingBuyRepricing: () => {
      repricingEvaluations += 1
      return {
        shouldReplace: false,
        adjustmentThreshold: "100.05"
      }
    },
  }
  const {
    engine,
    orders
  } = await createHarness({ strategyPolicy })

  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(repricingEvaluations, 1)
  assert.equal(orders.length, 1)
})


test("does not evaluate or submit from a stale market price", async () => {
  const {
    engine,
    orders
  } = await createHarness({ isMarketPriceFresh: () => false })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.skipped, true)
  assert.equal(result.data.reason, "STALE_MARKET_PRICE")
  assert.equal(orders.length, 0)
})


test("does not reuse a cached market price after it becomes stale", async () => {
  let isFresh = true
  const {
    engine,
    orders
  } = await createHarness({ isMarketPriceFresh: () => isFresh })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(orders.length, 1)
  isFresh = false
  const result = await engine.evaluateLatest({ symbol: "DOGEUSDT" })
  assert.equal(result.ok, true)
  assert.equal(result.data.skipped, true)
  assert.equal(result.data.reason, "STALE_MARKET_PRICE")
  assert.equal(orders.length, 1)
})


test("defers submission when the market price becomes stale during pending-order registration", async () => {
  let isFresh = true
  let staleAfterFirstPending = true
  const eventPublisher = {
    publish: ({ name }) => {
      if (name === "order.submission_requested" && staleAfterFirstPending) {
        isFresh = false
        staleAfterFirstPending = false
      }
    },
  }
  const {
    engine,
    orders
  } = await createHarness({
    isMarketPriceFresh: () => isFresh,
    eventPublisher,
  })

  const first = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(first.ok, true)
  assert.equal(first.data.deferred, true)
  assert.equal(orders.length, 0, "a stale price must not reach broker submission")

  isFresh = true
  const next = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.01",
      timestamp: 2
    },
  })

  assert.equal(next.ok, true)
  assert.equal(orders.length, 1, "a subsequent fresh price should allow the order")
})


test("validates exact-decimal books and detects BUY/SELL POST-ONLY crossing at equality", () => {
  const book = createMarketBook({ bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "99.90",
    bestBidQuantity: "1",
    bestAskPrice: "100.00",
    bestAskQuantity: "1",
    timestamp: 10,
  } })
  const order = (side, amount) => ({
    type: "LIMIT_MAKER",
    side,
    market: { symbol: "DOGEUSDT" },
    limitPrice: { amount },
  })
  assert.equal(isPostOnlyOrderCrossing({
    order: order("BUY", "99.99"),
    marketBook: book
  }), false)
  assert.equal(isPostOnlyOrderCrossing({
    order: order("BUY", "100.00"),
    marketBook: book
  }), true)
  assert.equal(isPostOnlyOrderCrossing({
    order: order("SELL", "99.91"),
    marketBook: book
  }), false)
  assert.equal(isPostOnlyOrderCrossing({
    order: order("SELL", "99.90"),
    marketBook: book
  }), true)
  assert.throws(() => createMarketBook({ bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "100",
    bestBidQuantity: "1",
    bestAskPrice: "100",
    bestAskQuantity: "1",
    timestamp: 10
  } }), /best bid must be below best ask/)
})

test("defers a crossing POST-ONLY BUY and resumes on a fresh non-crossing book", async () => {
  const {
    engine,
    orders
  } = await createHarness({ initialBook: {
    symbol: "DOGEUSDT",
    bestBidPrice: "99.90",
    bestBidQuantity: "1",
    bestAskPrice: "99.95",
    bestAskQuantity: "1",
    timestamp: 1,
  } })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
    symbol: "DOGEUSDT",
    price: "100",
    timestamp: 1
  }
  })
  assert.equal(result.data.deferred, true)
  assert.equal(orders.length, 0)
  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "99.90",
    bestBidQuantity: "1",
    bestAskPrice: "100.00",
    bestAskQuantity: "1",
    timestamp: 2,
  }
  })
  assert.equal(orders.length, 1)
})

test("fails closed without a fresh book and resumes after a fresh book update", async () => {
  let fresh = false
  const {
    engine,
    orders
  } = await createHarness({
    initialBook: false,
    isMarketBookFresh: () => fresh
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
    symbol: "DOGEUSDT",
    price: "100",
    timestamp: 1
  }
  })
  assert.equal(result.data.deferred, true)
  assert.equal(orders.length, 0)
  fresh = true
  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "99.90",
    bestBidQuantity: "1",
    bestAskPrice: "100.00",
    bestAskQuantity: "1",
    timestamp: 2,
  }
  })
  assert.equal(orders.length, 1)
})

test("rechecks book freshness after PENDING registration before broker I/O", async () => {
  let fresh = true
  let staleOnce = true
  const {
    engine,
    orders
  } = await createHarness({
    isMarketBookFresh: () => fresh,
    eventPublisher: { publish: ({ name }) => {
      if (name === "order.submission_requested" && staleOnce) {
        fresh = false
        staleOnce = false
      }
    } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
    symbol: "DOGEUSDT",
    price: "100",
    timestamp: 1
  }
  })
  assert.equal(result.data.deferred, true)
  assert.equal(orders.length, 0)
  assert.equal(engine.getOrders().length, 0)
  fresh = true
  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "99.90",
    bestBidQuantity: "1",
    bestAskPrice: "100.00",
    bestAskQuantity: "1",
    timestamp: 2,
  }
  })
  assert.equal(orders.length, 1)
})

test("definite POST-ONLY rejection removes PENDING and waits for a fresh book without pausing", async () => {
  const events = []
  const rejection = Object.assign(new Error("known post-only rejection"), { code: "POST_ONLY_WOULD_TAKE" })
  const {
    engine,
    orders,
    pauses
  } = await createHarness({
    placeOrderFailureCount: 1,
    placeOrderFailureError: rejection,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
    symbol: "DOGEUSDT",
    price: "100",
    timestamp: 1
  }
  })
  assert.equal(result.ok, false)
  assert.equal(orders.length, 1)
  assert.deepEqual(pauses, [])
  assert.equal(engine.getOrders().length, 0)
  assert.equal(events.find((event) => event.name === "order.submission_failed").data.outcome, "REJECTED")
  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "99.90",
    bestBidQuantity: "1",
    bestAskPrice: "99.94",
    bestAskQuantity: "1",
    timestamp: 2,
  }
  })
  assert.equal(orders.length, 1)
  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "99.90",
    bestBidQuantity: "1",
    bestAskPrice: "100.00",
    bestAskQuantity: "1",
    timestamp: 3,
  }
  })
  assert.equal(orders.length, 2)
  assert.deepEqual(pauses, [])
})


test("invalid book updates invalidate the cached book and fail closed", async () => {
  const {
    engine,
    orders
  } = await createHarness({ initialBook: false })
  await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "99.90",
    bestBidQuantity: "1",
    bestAskPrice: "100.00",
    bestAskQuantity: "1",
    timestamp: 1,
  }
  })
  const invalid = await engine.processBookTicker({
    symbol: "DOGEUSDT",
    bookTicker: {
    symbol: "DOGEUSDT",
    bestBidPrice: "100.00",
    bestBidQuantity: "1",
    bestAskPrice: "100.00",
    bestAskQuantity: "1",
    timestamp: 2,
  }
  })
  assert.equal(invalid.ok, false)
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 2
    },
  })
  assert.equal(result.data.deferred, true)
  assert.equal(orders.length, 0)
})


test("twelve sequential immediately-filled BUYs advance from each reconciled lastBuyPrice", async () => {
  const observedReferences = []
  const strategyPolicy = {
    evaluate: (input) => {
      observedReferences.push(input.lastBuyPrice ?? null)
      return evaluateConservativeStrategy({
        ...input,
        pairConfig: {
          ...input.pairConfig,
          orderQuantity: 0.1,
          keepQuantity: 1
        },
      })
    },
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const harness = await createHarness({
    strategyPolicy,
    immediateFilledAcknowledgement: true,
    accountingApplied: true,
    getAcknowledgedFills: ({ order }) => [makeBuyFill({
      order,
      tradeId: `sequential-buy-${order.clientOrderId}`,
      price: order.limitPrice.amount,
      quantity: order.originalQuantity.amount,
      quoteQuantity: multiplyDecimal({
        left: order.limitPrice.amount,
        right: order.originalQuantity.amount,
      }),
    })],
  })

  for (let index = 0; index < 12; index += 1) {
    const result = await harness.engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: {
        symbol: "DOGEUSDT",
        price: "100",
        timestamp: index + 1
      },
    })
    assert.equal(result.ok, true, result.errors?.[0]?.message)
  }

  assert.equal(harness.orders.length, 12)
  assert.equal(observedReferences.length, 12)
  assert.equal(observedReferences[0], null)
  assert.ok(observedReferences.slice(1).every((price) => price !== null))
  assert.equal(new Set(harness.orders.map((order) => order.price)).size, 12)
  for (let index = 1; index < harness.orders.length; index += 1) {
    assert.ok(Number(harness.orders[index].price) < Number(harness.orders[index - 1].price))
  }
  assert.equal(harness.engine.getPausedMarkets().length, 0)
})


test("keeps the recovery basis open and classifies exchange-constrained residual after a profitable SELL", async () => {
  const seeded = makeSeededRecoveryState({ quantity: "1.05" })
  let currentPortfolio = seeded.portfolio
  let currentRecoveryLedger = seeded.recoveryLedger
  const events = []
  const completionInputs = []
  const harness = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    accountingApplied: true,
    getPortfolio: () => currentPortfolio,
    getRecoveryLedger: () => currentRecoveryLedger,
    updateTradingAccounting: async ({ fill }) => {
      const portfolioUpdate = currentPortfolio.applyFill({ fill })
      const ledgerUpdate = currentRecoveryLedger.applyFill({ fill })
      currentPortfolio = portfolioUpdate.portfolio
      currentRecoveryLedger = ledgerUpdate.ledger
      return {
        ok: true,
        data: {
          applied: portfolioUpdate.applied && ledgerUpdate.applied,
          duplicate: portfolioUpdate.duplicate || ledgerUpdate.duplicate,
        },
      }
    },
    completeRecoveryCycle: async (input) => {
      completionInputs.push(input)
      const {
        marketId,
        inventoryDisposition
      } = input
      const position = currentPortfolio.getPosition({ marketId })
      const completion = evaluateRecoveryCompletion({
        sellOrderFullyFilled: true,
        spent: position.spent.amount,
        netSellProceeds: currentRecoveryLedger.netSellProceeds,
        activeQuantity: position.baseQuantity.amount,
        keepQuantity: "0.1",
        minProfit: "0.01",
        ...(inventoryDisposition === undefined ? {} : { inventoryDisposition }),
      })
      if (completion.eligible) {
        currentPortfolio = currentPortfolio.allocateFreeQuantity({
          marketId,
          quantity: completion.freeQuantity,
        })
        currentRecoveryLedger = currentRecoveryLedger.resetCycle({
          minProfit: "0.01",
          spent: position.spent
        })
      }
      return {
        ok: true,
        data: completion
      }
    },
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })

  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 2
    },
  })
  const recoverySell = harness.engine.getOrders().find((order) => order.side === "SELL")
  assert.ok(recoverySell)
  const quantity = recoverySell.originalQuantity.amount
  const price = recoverySell.limitPrice.amount
  const fill = makeSellFill({
    order: recoverySell,
    tradeId: "post-recovery-residual-sell",
    quantity,
    quoteQuantity: multiplyDecimal({
      left: price,
      right: quantity
    }),
  })
  const result = await harness.engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: recoverySell }),
      fill,
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(result.data.residualSellThrough, true)
  assert.equal(result.data.reevaluate, true)
  assert.equal(currentRecoveryLedger.outstandingRecoveryAmount, "0")
  assert.equal(currentRecoveryLedger.buyCost, "105")
  assert.ok(Number(currentRecoveryLedger.netSellProceeds) > 105.01)
  const position = currentPortfolio.getPosition({ marketId: market.id })
  assert.equal(position.freeBaseQuantity.amount, "0")
  assert.ok(Number(position.baseQuantity.amount) > 0.1)
  const sellOrders = harness.engine.getOrders().filter((order) => order.side === "SELL")
  assert.equal(sellOrders.length, 1)
  assert.equal(sellOrders[0].status, "FILLED")
  const nextEvaluation = await harness.engine.evaluateLatest({ symbol: "DOGEUSDT" })
  assert.equal(nextEvaluation.ok, true, nextEvaluation.errors?.[0]?.message)
  assert.equal(nextEvaluation.data.decision.inventoryDisposition.status, "EXCHANGE_CONSTRAINED_DUST")
  assert.equal(nextEvaluation.data.decision.inventoryDisposition.reason, "QUANTITY_INCREMENT")
  const dust = nextEvaluation.data.decision.inventoryDisposition
  const completedPosition = currentPortfolio.getPosition({ marketId: market.id })
  assert.equal(completedPosition.baseQuantity.amount, "0")
  assert.equal(dust.quantity, "0.05", "The quantity-step-constrained residual must be exactly 0.05 above the 0.1 keepQuantity.")
  assert.equal(completedPosition.freeBaseQuantity.amount, "0.15", "The completed cycle must retain exactly 0.1 keepQuantity plus 0.05 exchange-constrained dust.")
  assert.equal(currentRecoveryLedger.buyCost, "0")
  assert.equal(currentRecoveryLedger.netSellProceeds, "0")
  const continuedEvent = events.find((event) => event.name === "recovery.cycle_not_completed")
  assert.ok(continuedEvent)
  assert.equal(continuedEvent.data.outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(continuedEvent.data.sellOrderClientId, recoverySell.clientOrderId)
  const completedEvent = events.find((event) => event.name === "recovery.cycle_completed")
  assert.ok(completedEvent)
  assert.ok(events.indexOf(continuedEvent) < events.indexOf(completedEvent))
  assert.deepEqual(completedEvent.data.dust, {
    status: "EXCHANGE_CONSTRAINED_DUST",
    quantity: dust.quantity,
    reason: "QUANTITY_INCREMENT",
    quantityStepSize: dust.quantityStepSize,
    evaluatedQuantity: "0",
  })
  const dustCompletionInput = completionInputs.find(({ inventoryDisposition }) => inventoryDisposition !== undefined)
  assert.ok(dustCompletionInput, "The exchange-constrained residual must reach the recovery completion workflow.")
  assert.equal(
    dustCompletionInput.sellOrder.clientOrderId,
    recoverySell.clientOrderId,
    "Dust completion must retain the reconciled terminal SELL client identity.",
  )
  assert.equal(
    dustCompletionInput.sellOrder.brokerOrderId,
    recoverySell.brokerOrderId,
    "Dust completion must retain the reconciled terminal SELL broker identity.",
  )
  assert.equal(dustCompletionInput.sellOrder.status, "FILLED", "Dust completion must be supported by the canonical terminal FILLED SELL order.")
  assert.deepEqual(harness.pauses, [])
})


test("pauses once on an invalid MIN_NOTIONAL decision and does not reevaluate it repeatedly", async () => {
  let evaluationCount = 0
  const strategyPolicy = {
    evaluate: () => {
      evaluationCount += 1
      return {
        strategy: "TEST_POLICY",
        symbol: "DOGEUSDT",
        actions: [{
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "0.01",
          quantity: "0.1"
        }],
      }
    },
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const harness = await createHarness({ strategyPolicy })
  const first = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 2
    },
  })
  assert.equal(first.ok, false)
  assert.match(first.errors?.[0]?.message ?? "", /MIN_NOTIONAL/)
  assert.equal(evaluationCount, 1)
  assert.ok(harness.pauses.includes("STRATEGY_ORDER_VALIDATION_FAILED"))
  assert.equal(harness.orders.length, 0)

  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 3
    },
  })
  assert.equal(evaluationCount, 1)
  assert.equal(harness.orders.length, 0)
  assert.equal(harness.engine.getPausedMarkets().length, 1)
})


test("reconciles a FILLED acknowledgement from Binance myTrades without a clientOrderId", async () => {
  const {
    engine,
    accountedFills,
    pauses
  } = await createHarness({
    immediateFilledAcknowledgement: true,
    accountingApplied: true,
    getAcknowledgedFills: ({ order }) => [makeBuyFill({
      order,
      tradeId: "zro-rest-trade-without-client-id",
      price: order.limitPrice.amount,
      quantity: order.originalQuantity.amount,
      quoteQuantity: multiplyDecimal({
        left: order.limitPrice.amount,
        right: order.originalQuantity.amount,
      }),
      clientOrderId: undefined,
    })],
  })

  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(accountedFills.length, 1)
  assert.equal(accountedFills[0].clientOrderId, engine.getOrders()[0].clientOrderId)
  assert.deepEqual(pauses, [])
})

test("retains acknowledged broker identity after conflicting REST fill metadata and reconciles a later stream fill without resuming", async () => {
  const {
    engine,
    orders,
    accountedFills,
    pauses
  } = await createHarness({
    immediateFilledAcknowledgement: true,
    accountingApplied: true,
    getAcknowledgedFills: ({ order }) => [makeBuyFill({
      order,
      tradeId: "conflicting-rest-client-id",
      price: order.limitPrice.amount,
      quantity: order.originalQuantity.amount,
      quoteQuantity: multiplyDecimal({
        left: order.limitPrice.amount,
        right: order.originalQuantity.amount,
      }),
      clientOrderId: "conflicting-client-id",
    })],
  })

  const failed = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(failed.ok, false)
  const tracked = engine.getOrders()[0]
  assert.equal(tracked.status, "UNKNOWN")
  assert.ok(tracked.brokerOrderId)
  assert.ok(pauses.includes("ACKNOWLEDGED_FILL_IDENTITY_MISMATCH"))

  const fill = makeBuyFill({
    order: tracked,
    tradeId: "late-stream-fill",
    price: tracked.limitPrice.amount,
    quantity: tracked.originalQuantity.amount,
    quoteQuantity: multiplyDecimal({
      left: tracked.limitPrice.amount,
      right: tracked.originalQuantity.amount,
    }),
    clientOrderId: undefined,
  })
  const filledOrder = makeFilledOrder({ order: tracked })
  const streamed = await engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: filledOrder,
      fill
    },
  })
  assert.equal(streamed.ok, true, streamed.errors?.[0]?.message)
  assert.equal(accountedFills.length, 1)
  assert.equal(engine.getPausedMarkets().includes("DOGEUSDT"), true)

  const nextPrice = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.1",
      timestamp: 3
    },
  })
  assert.equal(nextPrice.ok, true)
  assert.equal(orders.length, 1)
})


test("publishes one durable fill-applied event per reconciled execution and no duplicate event", async () => {
  const events = []
  const harness = await createHarness({
    immediateFilledAcknowledgement: true,
    accountingApplied: true,
    eventPublisher: {
      publish(event) {
        events.push(event)
        return { ok: true }
      },
    },
    getAcknowledgedFills: ({ order }) => [
      makeBuyFill({
        order,
        tradeId: "9939",
        price: "99.95",
        quantity: "0.5",
        quoteQuantity: "49.975",
        clientOrderId: undefined,
      }),
      makeBuyFill({
        order,
        tradeId: "9940",
        price: "99.94",
        quantity: "0.5",
        quoteQuantity: "49.97",
        clientOrderId: undefined,
      }),
    ],
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(result.ok, true, result.errors?.[0]?.message)

  const applied = events.filter((event) => event.name === HARVESTER_EVENT_NAMES.FILL_APPLIED)
  assert.equal(applied.length, 2)
  assert.deepEqual(applied.map((event) => event.data.fillId), [
    "binance:DOGEUSDT:9939",
    "binance:DOGEUSDT:9940",
  ])

  await harness.engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: harness.engine.getOrders()[0] }),
      fill: makeBuyFill({
        order: harness.engine.getOrders()[0],
        tradeId: "9939",
        price: "99.95",
        quantity: "0.5",
        quoteQuantity: "49.975",
      }),
    },
  })
  assert.equal(events.filter((event) => event.name === HARVESTER_EVENT_NAMES.FILL_APPLIED).length, 2)
})


test("rejects acknowledged REST fills with conflicting broker, market, or side ownership", async () => {
  const otherMarket = new Market({
    venue: "binance",
    symbol: "OTHERUSDT",
    baseAsset,
    quoteAsset,
  })
  const conflictingIdentity = [
    { brokerOrderId: "another-broker-order-id" },
    { market: otherMarket },
    { side: "SELL" },
  ]

  for (const identity of conflictingIdentity) {
    const harness = await createHarness({
      immediateFilledAcknowledgement: true,
      accountingApplied: true,
      getAcknowledgedFills: ({ order }) => [makeBuyFill({
        order,
        tradeId: "conflicting-ownership-" + Object.keys(identity)[0],
        price: order.limitPrice.amount,
        quantity: order.originalQuantity.amount,
        quoteQuantity: multiplyDecimal({
          left: order.limitPrice.amount,
          right: order.originalQuantity.amount,
        }),
        ...identity,
      })],
    })

    const result = await harness.engine.processMarketPrice({
      symbol: "DOGEUSDT",
      priceEvent: {
        symbol: "DOGEUSDT",
        price: "100",
        timestamp: 1
      },
    })

    assert.equal(result.ok, false)
    assert.equal(harness.accountedFills.length, 0)
    assert.equal(harness.engine.getOrders()[0].status, "UNKNOWN")
    assert.ok(harness.pauses.includes("ACKNOWLEDGED_FILL_IDENTITY_MISMATCH"))
  }
})

test("recovers an acknowledged fill when Binance trade history becomes visible later", async () => {
  let tradeHistoryVisible = false
  const harness = await createHarness({
    immediateFilledAcknowledgement: true,
    accountingApplied: true,
    getAcknowledgedFills: ({ order }) => () => tradeHistoryVisible
      ? [makeBuyFill({
          order,
          tradeId: "delayed-visible-trade",
          price: order.limitPrice.amount,
          quantity: order.originalQuantity.amount,
          quoteQuantity: multiplyDecimal({
            left: order.limitPrice.amount,
            right: order.originalQuantity.amount,
          }),
          clientOrderId: undefined,
        })]
      : [],
  })

  const first = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(first.ok, false)
  assert.equal(harness.engine.getOrders()[0].status, "UNKNOWN")
  assert.ok(harness.engine.getOrders()[0].brokerOrderId)
  assert.equal(harness.accountedFills.length, 0)
  assert.ok(harness.pauses.includes("ACKNOWLEDGED_FILL_HISTORY_INCOMPLETE"))

  tradeHistoryVisible = true
  const recovered = await harness.engine.reconcileOwnedOrders()

  assert.equal(recovered.ok, true, recovered.errors?.[0]?.message)
  assert.equal(harness.accountedFills.length, 1)
  assert.equal(harness.accountedFills[0].id, "binance:DOGEUSDT:delayed-visible-trade")
  assert.equal(harness.engine.getOrders()[0].status, "FILLED")
  assert.equal(harness.engine.getPausedMarkets().includes("DOGEUSDT"), true)

  const replayed = await harness.engine.reconcileOwnedOrders()
  assert.equal(replayed.ok, true, replayed.errors?.[0]?.message)
  assert.equal(harness.accountedFills.length, 1)
})

test("limits a batch of BUY intents to the remaining quote balance and pair investment", async () => {
  const strategyPolicy = {
    evaluate: () => ({
      strategy: "TEST_POLICY",
      symbol: "DOGEUSDT",
      action: "PLACE_ORDERS",
      actions: [
        {
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "60",
          quantity: "10"
        },
        {
          side: "BUY",
          type: "LIMIT_MAKER",
          price: "60",
          quantity: "10"
        },
      ],
    }),
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const harness = await createHarness({
    strategyPolicy,
    quoteFreeBalance: "1000"
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.equal(harness.orders.length, 1)
  assert.equal(harness.orders[0].side, "BUY")
  assert.equal(harness.orders[0].price, "60")
  assert.equal(harness.orders[0].quantity, "10")
  assert.equal(result.data.deferredActions.length, 1)
  assert.equal(result.data.deferredActions[0].reason, "INSUFFICIENT_QUOTE_BALANCE")
})

test("rejects an overcommitted batch of SELL intents before submitting any order", async () => {
  const seeded = makeSeededRecoveryState()
  const strategyPolicy = {
    evaluate: () => ({
      strategy: "TEST_POLICY",
      symbol: "DOGEUSDT",
      action: "PLACE_ORDERS",
      actions: [
        {
          side: "SELL",
          type: "LIMIT_MAKER",
          price: "100",
          quantity: "0.6"
        },
        {
          side: "SELL",
          type: "LIMIT_MAKER",
          price: "100",
          quantity: "0.6"
        },
      ],
    }),
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const harness = await createHarness({
    strategyPolicy,
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "0",
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, false)
  assert.equal(harness.orders.length, 0)
})

test("reconciles an accepted order after its submission acknowledgement is lost", async () => {
  const strategyPolicy = {
    evaluate: ({ lastBuyPrice }) => ({
      strategy: "TEST_POLICY",
      symbol: "DOGEUSDT",
      action: lastBuyPrice ? "NO_ACTION" : "PLACE_ORDERS",
      actions: lastBuyPrice ? [] : [{
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "99.95",
        quantity: "1"
      }],
    }),
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const harness = await createHarness({
    strategyPolicy,
    placeOrderThrow: true,
    accountingApplied: true
  })

  const submission = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(submission.ok, false)
  const pendingOrder = harness.engine.getOrders()[0]
  assert.equal(pendingOrder.status, "UNKNOWN")
  assert.equal(pendingOrder.brokerOrderId, undefined)

  const acknowledgedOrder = new CanonicalOrder({
    clientOrderId: pendingOrder.clientOrderId,
    brokerOrderId: "broker-lost-ack",
    market,
    side: pendingOrder.side,
    type: pendingOrder.type,
    limitPrice: pendingOrder.limitPrice,
    originalQuantity: pendingOrder.originalQuantity,
    executedQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  })
  const fill = makeBuyFill({
    order: acknowledgedOrder,
    tradeId: "lost-ack-fill-1",
    price: "99.95",
    quantity: "1",
    quoteQuantity: "99.95",
    executedAt: 2,
  })
  harness.setCanonicalOrderLookup({ order: acknowledgedOrder })
  harness.setAcknowledgedOrder({
    order: acknowledgedOrder,
    fills: [fill]
  })

  const reconciliation = await harness.engine.reconcileOwnedOrders()

  assert.equal(reconciliation.ok, true, reconciliation.errors?.[0]?.message)
  assert.equal(reconciliation.data.reconciled, 1)
  assert.equal(harness.engine.getOrders()[0].brokerOrderId, "broker-lost-ack")
  assert.equal(harness.engine.getOrders()[0].status, "FILLED")
  assert.equal(harness.accountedFills.length, 1)
  assert.equal(harness.accountedFills[0].id, fill.id)
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
})

test("keeps a pending submission UNKNOWN when client-order-ID lookup cannot resolve it", async () => {
  const harness = await createHarness({ placeOrderThrow: true })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  const result = await harness.engine.reconcileOwnedOrders()

  assert.equal(result.ok, false)
  assert.equal(harness.engine.getOrders()[0].status, "UNKNOWN")
  assert.equal(harness.engine.getOrders()[0].brokerOrderId, undefined)
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
  assert.equal(harness.orders.length, 1)
})

test("does not adopt a client-order lookup response with a mismatched client ID", async () => {
  const harness = await createHarness({ placeOrderThrow: true })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const pendingOrder = harness.engine.getOrders()[0]
  const foreignOrder = new CanonicalOrder({
    clientOrderId: "foreign-client-id",
    brokerOrderId: "foreign-broker-order",
    market,
    side: pendingOrder.side,
    type: pendingOrder.type,
    limitPrice: pendingOrder.limitPrice,
    originalQuantity: pendingOrder.originalQuantity,
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  harness.setCanonicalOrderLookup({
    clientOrderId: pendingOrder.clientOrderId,
    order: foreignOrder
  })

  const result = await harness.engine.reconcileOwnedOrders()

  assert.equal(result.ok, false)
  assert.equal(harness.engine.getOrders()[0].brokerOrderId, undefined)
  assert.equal(harness.engine.getOrders()[0].status, "UNKNOWN")
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
})

test("does not attach a client-ID lookup that changes immutable order intent", async () => {
  const harness = await createHarness({ placeOrderThrow: true })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const pendingOrder = harness.engine.getOrders()[0]
  const conflictingOrder = new CanonicalOrder({
    clientOrderId: pendingOrder.clientOrderId,
    brokerOrderId: "conflicting-broker-order",
    market,
    side: "SELL",
    type: pendingOrder.type,
    limitPrice: pendingOrder.limitPrice,
    originalQuantity: pendingOrder.originalQuantity,
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  harness.setCanonicalOrderLookup({ order: conflictingOrder })

  const result = await harness.engine.reconcileOwnedOrders()

  assert.equal(result.ok, false)
  assert.equal(harness.engine.getOrders()[0].brokerOrderId, undefined)
  assert.equal(harness.engine.getOrders()[0].status, "UNKNOWN")
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
})


test("reconciles recovered orders without canceling or replacing any exchange order", async () => {
  const makeRecoveredOrder = ({
    clientOrderId,
    brokerOrderId,
    side,
    status,
    executedQuantity = "0"
  }) =>
    new CanonicalOrder({
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
        amount: "1",
        asset: baseAsset
      }),
      executedQuantity: new Quantity({
        amount: executedQuantity,
        asset: baseAsset
      }),
      status,
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 1,
    })
  const buyOwnedOrder = makeRecoveredOrder({
    clientOrderId: "recovered-buy",
    brokerOrderId: "broker-recovered-buy",
    side: "BUY",
    status: "UNKNOWN",
  })
  const sellOwnedOrder = makeRecoveredOrder({
    clientOrderId: "recovered-sell",
    brokerOrderId: "broker-recovered-sell",
    side: "SELL",
    status: "OPEN",
  })
  const buyHistory = makeRecoveredOrder({
    clientOrderId: "recovered-buy",
    brokerOrderId: "broker-recovered-buy",
    side: "BUY",
    status: "FILLED",
    executedQuantity: "1",
  })
  const sellHistory = makeRecoveredOrder({
    clientOrderId: "recovered-sell",
    brokerOrderId: "broker-recovered-sell",
    side: "SELL",
    status: "OPEN",
  })
  const buyFill = new Fill({
    tradeId: "recovered-buy-trade",
    brokerOrderId: buyOwnedOrder.brokerOrderId,
    clientOrderId: buyOwnedOrder.clientOrderId,
    market,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    quantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [buyOwnedOrder, sellOwnedOrder] }),
      replacementIntents: new Set(["DOGEUSDT"]),
      trailingBuyRepriceIntents: new Set(["DOGEUSDT"]),
      recoveryManagedCancellationClientOrderIds: new Set(["recovered-buy"]),
    },
  })
  harness.broker.getOpenOrders = async () => ({
    ok: true,
    data: [makeOpenOrder({
      order: sellHistory,
      executedQuantity: "0"
    })],
  })
  harness.broker.getCanonicalOrderHistory = async ({ orderId }) => ({
    ok: true,
    data: [orderId === buyOwnedOrder.brokerOrderId ? buyHistory : sellHistory],
  })
  harness.broker.getFills = async ({ orderId }) => ({
    ok: true,
    data: orderId === buyOwnedOrder.brokerOrderId ? [buyFill] : [],
  })

  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(harness.cancellationIds, [])
  assert.deepEqual(harness.orders, [])
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === "recovered-buy").status, "FILLED")
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === "recovered-sell").status, "OPEN")
  assert.deepEqual(harness.engine.getRecoveryIntents().replacementIntents, ["DOGEUSDT"])
  assert.deepEqual(harness.engine.getRecoveryIntents().trailingBuyRepriceIntents, [])
})

test("clears a recovered replacement intent only after canonical history confirms cancellation", async () => {
  const makeOrder = ({ status }) => new CanonicalOrder({
    clientOrderId: "recovered-sell-cancel",
    brokerOrderId: "broker-recovered-sell-cancel",
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const ownedOrder = makeOrder({ status: "UNKNOWN" })
  const canceledHistory = makeOrder({ status: "CANCELED" })
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [ownedOrder] }),
      pausedMarkets: new Set(["DOGEUSDT"]),
      recoveryManagedPausedMarkets: new Set(["DOGEUSDT"]),
      recoveryManagedCancellationClientOrderIds: new Set(["recovered-sell-cancel"]),
      replacementIntents: new Set(["DOGEUSDT"]),
    },
  })
  harness.broker.getOpenOrders = async () => ({
    ok: true,
    data: []
  })
  harness.broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [canceledHistory]
  })
  harness.broker.getFills = async () => ({
    ok: true,
    data: []
  })

  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(harness.cancellationIds, [])
  assert.deepEqual(harness.orders, [])
  assert.equal(harness.engine.getOrders()[0].status, "CANCELED")
  assert.deepEqual(harness.engine.getRecoveryIntents().replacementIntents, [])
  assert.deepEqual(harness.engine.getRecoveryIntents().deferredEvaluations, ["DOGEUSDT"])
  assert.deepEqual(harness.engine.getPausedMarkets(), [])
})


test("paginates complete REST fill history beyond Binance's 1000-trade page limit", async () => {
  const originalQuantity = "1001"
  const makeOrder = ({
    status,
    executedQuantity
  }) => new CanonicalOrder({
    clientOrderId: "recovered-many-fills",
    brokerOrderId: "broker-many-fills",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "1",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: originalQuantity,
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const ownedOrder = makeOrder({
    status: "UNKNOWN",
    executedQuantity: "0"
  })
  const historyOrder = makeOrder({
    status: "FILLED",
    executedQuantity: originalQuantity
  })
  const makeFill = ({ tradeId }) => new Fill({
    tradeId: String(tradeId),
    brokerOrderId: ownedOrder.brokerOrderId,
    clientOrderId: ownedOrder.clientOrderId,
    market,
    side: "BUY",
    price: new Money({
      amount: "1",
      asset: quoteAsset
    }),
    quantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "1",
      asset: quoteAsset
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const firstPage = Array.from({ length: 1000 }, (_, index) => makeFill({ tradeId: index + 1 }))
  const secondPage = [makeFill({ tradeId: 1001 })]
  const fillCursors = []
  const harness = await createHarness({
    initialBook: false,
    initialState: { orderRegistry: new OrderRegistry({ orders: [ownedOrder] }) },
  })
  harness.broker.getOpenOrders = async () => ({
    ok: true,
    data: []
  })
  harness.broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [historyOrder]
  })
  harness.broker.getFills = async ({
    fromId,
    limit
  }) => {
    fillCursors.push(fromId)
    assert.equal(limit, 1000)
    return {
      ok: true,
      data: fromId === undefined ? firstPage : secondPage
    }
  }

  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(fillCursors, [undefined, "1001"])
  assert.equal(harness.engine.getOrders()[0].status, "FILLED")
  assert.equal(harness.accountedFills.length, 1001)
})


test("does not clear an independently durable strategy pause when a recovery cancellation resolves", async () => {
  const makeOrder = ({ status }) => new CanonicalOrder({
    clientOrderId: "recovered-sell-durable-pause",
    brokerOrderId: "broker-recovered-sell-durable-pause",
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [makeOrder({ status: "UNKNOWN" })] }),
      pausedMarkets: new Set(["DOGEUSDT"]),
      durablePausedMarkets: new Set(["DOGEUSDT"]),
      recoveryManagedPausedMarkets: new Set(["DOGEUSDT"]),
      recoveryManagedCancellationClientOrderIds: new Set(["recovered-sell-durable-pause"]),
      replacementIntents: new Set(["DOGEUSDT"]),
    },
  })
  harness.broker.getOpenOrders = async () => ({
    ok: true,
    data: []
  })
  harness.broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [makeOrder({ status: "CANCELED" })]
  })
  harness.broker.getFills = async () => ({
    ok: true,
    data: []
  })

  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(harness.engine.getRecoveryIntents().replacementIntents, [])
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
})


test("processes recovery-time user-data cancellation facts without broker cancel or replacement calls", async () => {
  const makeOrder = ({ status }) => new CanonicalOrder({
    clientOrderId: "recovered-stream-cancel",
    brokerOrderId: "broker-recovered-stream-cancel",
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [makeOrder({ status: "UNKNOWN" })] }),
      pausedMarkets: new Set(["DOGEUSDT"]),
      recoveryManagedPausedMarkets: new Set(["DOGEUSDT"]),
      recoveryManagedCancellationClientOrderIds: new Set(["recovered-stream-cancel"]),
      replacementIntents: new Set(["DOGEUSDT"]),
    },
  })

  const result = await harness.engine.processUserDataEvent({
    recoveryMode: true,
    event: { executedOrder: makeOrder({ status: "CANCELED" }) },
  })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(harness.cancellationIds, [])
  assert.deepEqual(harness.orders, [])
  assert.deepEqual(harness.engine.getRecoveryIntents().replacementIntents, [])
  assert.deepEqual(harness.engine.getRecoveryIntents().deferredEvaluations, ["DOGEUSDT"])
  assert.deepEqual(harness.engine.getPausedMarkets(), [])
})


test("keeps a recovery pause until every same-market cancel/replace order is canonically resolved", async () => {
  const makeOrder = ({
    clientOrderId,
    brokerOrderId,
    status
  }) => new CanonicalOrder({
    clientOrderId,
    brokerOrderId,
    market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const ownedOrders = [
    makeOrder({
      clientOrderId: "recovered-sell-one",
      brokerOrderId: "broker-sell-one",
      status: "UNKNOWN"
    }),
    makeOrder({
      clientOrderId: "recovered-sell-two",
      brokerOrderId: "broker-sell-two",
      status: "UNKNOWN"
    }),
  ]
  const canceledOrders = ownedOrders.map((order) => makeOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: order.brokerOrderId,
    status: "CANCELED",
  }))
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: ownedOrders }),
      pausedMarkets: new Set(["DOGEUSDT"]),
      recoveryManagedPausedMarkets: new Set(["DOGEUSDT"]),
      recoveryManagedCancellationClientOrderIds: new Set(ownedOrders.map((order) => order.clientOrderId)),
      replacementIntents: new Set(["DOGEUSDT"]),
    },
  })
  harness.broker.getOpenOrders = async () => ({
    ok: true,
    data: []
  })
  harness.broker.getCanonicalOrderHistory = async ({ orderId }) => ({
    ok: true,
    data: [canceledOrders.find((order) => order.brokerOrderId === orderId)],
  })
  harness.broker.getFills = async () => ({
    ok: true,
    data: []
  })

  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(result.ok, true, result.errors?.[0]?.message)
  assert.deepEqual(harness.engine.getRecoveryIntents().replacementIntents, [])
  assert.deepEqual(harness.engine.getRecoveryIntents().deferredEvaluations, ["DOGEUSDT"])
  assert.deepEqual(harness.engine.getPausedMarkets(), [])
})


test("rejects canonical REST fill facts that contradict the durable Journal execution", async () => {
  const ownedOrder = new CanonicalOrder({
    clientOrderId: "recovered-journal-fill",
    brokerOrderId: "broker-journal-fill",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    status: "UNKNOWN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const historyOrder = new CanonicalOrder({
    clientOrderId: ownedOrder.clientOrderId,
    brokerOrderId: ownedOrder.brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: ownedOrder.limitPrice,
    originalQuantity: ownedOrder.originalQuantity,
    executedQuantity: ownedOrder.executedQuantity,
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const exchangeFill = new Fill({
    tradeId: "journal-parity-trade",
    brokerOrderId: ownedOrder.brokerOrderId,
    clientOrderId: ownedOrder.clientOrderId,
    market,
    side: "BUY",
    price: new Money({
      amount: "101",
      asset: quoteAsset
    }),
    quantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "101",
      asset: quoteAsset
    }),
    liquidityRole: "MAKER",
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [ownedOrder] }),
      journalFills: [{
        fillId: exchangeFill.id,
        tradeId: exchangeFill.tradeId,
        brokerOrderId: ownedOrder.brokerOrderId,
        clientOrderId: ownedOrder.clientOrderId,
        symbol: market.symbol,
        side: "BUY",
        price: "100",
        quantity: "1",
        quoteQuantity: "100",
        liquidityRole: "MAKER",
        commissions: [],
        commissionStatus: "COMPLETE",
      }],
    },
  })
  harness.broker.getOpenOrders = async () => ({
    ok: true,
    data: []
  })
  harness.broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [historyOrder]
  })
  harness.broker.getFills = async () => ({
    ok: true,
    data: [exchangeFill]
  })

  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /conflicts with durable Journal price/)
  assert.deepEqual(harness.cancellationIds, [])
  assert.deepEqual(harness.orders, [])
})


test("rejects REST history that omits a durable Journal fill despite matching cumulative quantity", async () => {
  const ownedOrder = new CanonicalOrder({
    clientOrderId: "recovered-missing-journal-fill",
    brokerOrderId: "broker-missing-journal-fill",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    status: "UNKNOWN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const historyOrder = new CanonicalOrder({
    clientOrderId: ownedOrder.clientOrderId,
    brokerOrderId: ownedOrder.brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: ownedOrder.limitPrice,
    originalQuantity: ownedOrder.originalQuantity,
    executedQuantity: ownedOrder.executedQuantity,
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const exchangeFill = new Fill({
    tradeId: "replacement-trade-id",
    brokerOrderId: ownedOrder.brokerOrderId,
    clientOrderId: ownedOrder.clientOrderId,
    market,
    side: "BUY",
    price: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    quantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    liquidityRole: "MAKER",
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [ownedOrder] }),
      journalFills: [{
        fillId: "binance:BTCUSDT:expected-trade-id",
        tradeId: "expected-trade-id",
        brokerOrderId: ownedOrder.brokerOrderId,
        clientOrderId: ownedOrder.clientOrderId,
        symbol: market.symbol,
        side: "BUY",
        price: "100",
        quantity: "1",
        quoteQuantity: "100",
        liquidityRole: "MAKER",
        commissions: [],
        commissionStatus: "COMPLETE",
      }],
    },
  })
  harness.broker.getOpenOrders = async () => ({
    ok: true,
    data: []
  })
  harness.broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [historyOrder]
  })
  harness.broker.getFills = async () => ({
    ok: true,
    data: [exchangeFill]
  })

  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /missing durable Journal execution ID/)
  assert.deepEqual(harness.cancellationIds, [])
  assert.deepEqual(harness.orders, [])
})


test("pauses a recovered order canceled without a durable Harvester cancellation intent", async () => {
  const makeOrder = ({ status }) => new CanonicalOrder({
    clientOrderId: "recovered-manual-cancel",
    brokerOrderId: "broker-recovered-manual-cancel",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [makeOrder({ status: "UNKNOWN" })] }),
      unrequestedTerminalOrderClientIds: new Set(["recovered-manual-cancel"]),
    },
  })

  const result = await harness.engine.processUserDataEvent({
    recoveryMode: true,
    event: { executedOrder: makeOrder({ status: "CANCELED" }) },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /without a durable cancellation intent/)
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"])
  assert.deepEqual(harness.cancellationIds, [])
  assert.deepEqual(harness.orders, [])
})

test("journals broker execution reports and applied canonical order transitions", async () => {
  const events = []
  const strategyPolicy = {
    evaluate: () => ({
      strategy: "CONSERVATIVE",
      symbol: "DOGEUSDT",
      action: "PLACE_ORDERS",
      reason: "INITIAL_BUY",
      actions: [{
        side: "BUY",
        type: "LIMIT_MAKER",
        price: "99.95",
        quantity: "1",
        reason: "INITIAL_BUY"
      }],
    }),
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: false,
      adjustmentThreshold: "0"
    }),
  }
  const harness = await createHarness({
    strategyPolicy,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  const submitted = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(submitted.ok, true)
  const current = harness.engine.getOrders().find((order) => order.side === "BUY")
  assert.ok(current)
  const canceled = new CanonicalOrder({
    clientOrderId: current.clientOrderId,
    brokerOrderId: current.brokerOrderId,
    market,
    side: current.side,
    type: current.type,
    limitPrice: current.limitPrice,
    originalQuantity: current.originalQuantity,
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "CANCELED",
    updatedAt: 2,
  })
  const brokerEvidence = {
    schemaVersion: 1,
    source: "binance.spot.userData.executionReport",
    eventTime: 2,
    transactionTime: 2,
    symbol: "DOGEUSDT",
    clientOrderId: current.clientOrderId,
    originalClientOrderId: current.clientOrderId,
    side: "BUY",
    orderType: "LIMIT_MAKER",
    orderQuantity: "1",
    orderPrice: "99.95",
    executionType: "CANCELED",
    orderStatus: "CANCELED",
    orderId: current.brokerOrderId,
    lastExecutedQuantity: "0",
    cumulativeExecutedQuantity: "0",
    cumulativeQuoteQuantity: "0",
    commissionAmount: "0",
    commissionAsset: null,
    tradeId: "-1",
    isMaker: false,
  }
  const result = await harness.engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "CANCELED",
      executedOrder: canceled,
      brokerEvidence
    },
  })
  assert.equal(result.ok, true)
  assert.ok(events.some((event) => event.name === "broker.execution_report" && event.data.cumulativeQuoteQuantity === "0"))
  assert.ok(events.some((event) => event.name === "order.updated" && event.data.status === "CANCELED"))
})


test("best-effort strategy evidence failure does not block order submission", async () => {
  const harness = await createHarness({
    eventPublisher: {
      publish: (event) => {
        if (event.name === HARVESTER_EVENT_NAMES.STRATEGY_DECISION) {
          throw new Error("optional Journal evidence unavailable")
        }
        return { ok: true }
      },
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  assert.equal(result.ok, true)
  assert.equal(harness.orders.length, 1)
})

function makeShutdownOrder({
  side,
  clientOrderId,
  brokerOrderId,
  status = "OPEN",
  executedQuantity = "0"
}) {
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
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: executedQuantity,
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
}

test("account-integrity safety halt reconciles a filled BUY without cancelling its recovery SELL", async () => {
  const recoveredFilledBuy = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "safety-halt-filled-buy",
    brokerOrderId: "broker-safety-halt-filled-buy",
  })
  const activeBuy = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "safety-halt-active-buy",
    brokerOrderId: "broker-safety-halt-active-buy",
  })
  const recoverySell = makeShutdownOrder({
    side: "SELL",
    clientOrderId: "safety-halt-recovery-sell",
    brokerOrderId: "broker-safety-halt-recovery-sell",
  })
  const filledBuyHistory = makeOrderStatusUpdate({
    order: recoveredFilledBuy,
    status: "FILLED",
    executedQuantity: "1",
  })
  const activeBuyHistory = makeOrderStatusUpdate({
    order: activeBuy,
    status: "OPEN"
  })
  const recoverySellHistory = makeOrderStatusUpdate({
    order: recoverySell,
    status: "OPEN"
  })
  const buyFill = makeBuyFill({
    order: recoveredFilledBuy,
    tradeId: "safety-halt-filled-buy-trade",
    price: "100",
    quantity: "1",
    quoteQuantity: "100",
    executedAt: 2,
  })
  const harness = await createHarness({
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [recoveredFilledBuy, activeBuy, recoverySell] }),
      replacementIntents: new Set(["DOGEUSDT"]),
    },
    eventPublisher: { publish: () => ({ ok: true }) },
  })
  harness.broker.getOpenOrders = async () => ({
    ok: true,
    data: [
      makeOpenOrder({ order: activeBuy }),
      makeOpenOrder({ order: recoverySell }),
    ],
  })
  harness.setAcknowledgedOrder({
    order: filledBuyHistory,
    fills: [buyFill]
  })
  harness.setAcknowledgedOrder({ order: activeBuyHistory })
  harness.setAcknowledgedOrder({ order: recoverySellHistory })
  const safetyHalt = createAccountIntegritySafetyHalt({
    getTradingEngine: () => harness.engine,
    logger: {},
  })

  await safetyHalt()

  assert.deepEqual(
    harness.cancellationIds,
    [activeBuy.brokerOrderId],
    "the safety halt may cancel its remaining owned BUY but must not cancel the recovery SELL while reconciling the filled BUY",
  )
  assert.equal(harness.accountedFills.length, 1, "the recovered BUY fill must be reconciled before the explicit BUY cancellation stage")
  assert.equal(
    harness.engine.getOrders().find((order) => order.clientOrderId === recoveredFilledBuy.clientOrderId).status,
    "FILLED",
  )
  assert.equal(
    harness.engine.getOrders().find((order) => order.clientOrderId === activeBuy.clientOrderId).status,
    "CANCELED",
  )
  assert.equal(
    harness.engine.getOrders().find((order) => order.clientOrderId === recoverySell.clientOrderId).status,
    "OPEN",
    "the active recovery SELL must remain untouched by safety-halt reconciliation",
  )
})

test("shutdown cancellation cancels only strategy-owned BUY orders and preserves SELL orders", async () => {
  const buyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "shutdown-buy",
    brokerOrderId: "broker-shutdown-buy",
  })
  const secondBuyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "shutdown-buy-second",
    brokerOrderId: "broker-shutdown-buy-second",
  })
  const sellOrder = makeShutdownOrder({
    side: "SELL",
    clientOrderId: "shutdown-sell",
    brokerOrderId: "broker-shutdown-sell",
  })
  const {
    engine,
    cancellationIds
  } = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [buyOrder, secondBuyOrder, sellOrder] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
  })

  const result = await engine.cancelOwnedBuyOrdersForShutdown()

  assert.equal(result.ok, true, "shutdown must confirm every acknowledged owned BUY cancellation and reconcile its fills")
  assert.deepEqual(cancellationIds, ["broker-shutdown-buy", "broker-shutdown-buy-second"], "shutdown must cancel both owned BUY orders using their exact broker order IDs")
  assert.equal(engine.getOrders().find((order) => order.clientOrderId === "shutdown-buy").status, "CANCELED", "the first strategy-owned BUY must reach its broker-confirmed terminal CANCELED state")
  assert.equal(engine.getOrders().find((order) => order.clientOrderId === "shutdown-buy-second").status, "CANCELED", "the second strategy-owned BUY must reach its broker-confirmed terminal CANCELED state")
  assert.equal(engine.getOrders().find((order) => order.clientOrderId === "shutdown-sell").status, "OPEN", "graceful shutdown must preserve the owned recovery SELL order without cancellation")
})

test("account-integrity safety halt cancels only owned BUY orders and preserves recovery SELL orders", async () => {
  const initialOwnedBuyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "safety-halt-buy",
    brokerOrderId: "broker-safety-halt-buy",
  })
  const existingRecoverySellOrder = makeShutdownOrder({
    side: "SELL",
    clientOrderId: "safety-halt-sell",
    brokerOrderId: "broker-safety-halt-sell",
  })
  const {
    engine,
    cancellationIds
  } = await createHarness({
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [initialOwnedBuyOrder, existingRecoverySellOrder] }),
    },
    eventPublisher: { publish: () => ({ ok: true }) },
  })

  const result = await engine.cancelOwnedBuyOrdersForSafetyHalt()

  assert.equal(
    result.ok,
    true,
    "an account-integrity safety halt must confirm cancellation of every acknowledged owned BUY order",
  )
  assert.deepEqual(
    cancellationIds,
    ["broker-safety-halt-buy"],
    "an account-integrity safety halt must cancel the owned BUY while preserving every existing recovery SELL",
  )
  assert.equal(
    engine.getOrders().find((order) => order.clientOrderId === "safety-halt-buy").status,
    "CANCELED",
    "the acknowledged owned BUY must reach its broker-confirmed terminal CANCELED state during the safety halt",
  )
  assert.equal(
    engine.getOrders().find((order) => order.clientOrderId === "safety-halt-sell").status,
    "OPEN",
    "the existing recovery SELL must remain open and must never be canceled by the account-integrity safety halt",
  )
})

test("shutdown cancellation applies partial BUY fills before confirming cancellation", async () => {
  const buyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "shutdown-partial-buy",
    brokerOrderId: "broker-shutdown-partial-buy",
  })
  const {
    engine,
    accountedFills,
    pauses
  } = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [buyOrder] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
    cancelWithFill: true,
  })

  const result = await engine.cancelOwnedBuyOrdersForShutdown()

  assert.equal(result.ok, true, "shutdown must successfully reconcile the partial BUY fill before reporting cancellation complete")
  assert.equal(accountedFills.length, 1, "the partial BUY execution racing with cancellation must be accounted exactly once")
  assert.equal(accountedFills[0].side, "BUY", "the execution reconciled during shutdown must retain its original BUY side")
  assert.equal(accountedFills[0].quantity.amount, "0.1", "shutdown reconciliation must account for the exact 0.1 DOGE partial BUY fill")
  const canceledOrder = engine.getOrders().find((order) => order.clientOrderId === "shutdown-partial-buy")
  assert.equal(canceledOrder.status, "CANCELED", "the partially filled BUY must be marked CANCELED only after terminal broker confirmation")
  assert.equal(canceledOrder.executedQuantity.amount, "0.1", "the canceled order must retain the 0.1 DOGE executed quantity reported by canonical fill history")
  assert.deepEqual(pauses, [], "a fully reconciled partial BUY cancellation must not pause the market for an accounting inconsistency")
})

test("shutdown cancellation retains UNKNOWN state when the broker does not confirm cancellation", async () => {
  const buyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "shutdown-unknown-buy",
    brokerOrderId: "broker-shutdown-unknown-buy",
  })
  const {
    engine,
    cancellationIds
  } = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [buyOrder] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
    cancelFailure: true,
  })

  const result = await engine.cancelOwnedBuyOrdersForShutdown()

  assert.equal(result.ok, false, "shutdown cancellation must fail closed when the broker does not confirm a terminal cancellation result")
  assert.deepEqual(cancellationIds, ["broker-shutdown-unknown-buy"], "shutdown must attempt cancellation for the exact broker ID of the acknowledged owned BUY order")
  assert.equal(engine.getOrders().find((order) => order.clientOrderId === "shutdown-unknown-buy").status, "UNKNOWN", "an unconfirmed broker cancellation must retain UNKNOWN order state rather than falsely reporting a clean stop")
})


test("defers a recovered BUY fill evaluation until application recovery is acknowledged", async () => {
  const initialPosition = new Position({
    market,
    baseQuantity: new Quantity({
      amount: "2",
      asset: baseAsset
    }),
    freeBaseQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    quoteNetCashFlow: new Money({
      amount: "-100",
      asset: quoteAsset
    }),
  })
  const initialPortfolio = new Portfolio({ positions: [initialPosition] })
  const initialRecoveryLedger = new RecoveryLedger({
    market,
    buyCost: "100"
  })
  const recoverySellOrder = new CanonicalOrder({
    clientOrderId: "recovery-sell-during-reconnect",
    brokerOrderId: "broker-recovery-sell-during-reconnect",
    market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "110",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1.9",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const standingBuyOrder = new CanonicalOrder({
    clientOrderId: "standing-buy-during-reconnect",
    brokerOrderId: "broker-standing-buy-during-reconnect",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "90",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const harness = await createHarness({
    initialPortfolio,
    initialRecoveryLedger,
    accountingApplied: true,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [recoverySellOrder, standingBuyOrder] }),
    },
  })
  const filledStandingBuyOrder = new CanonicalOrder({
    clientOrderId: standingBuyOrder.clientOrderId,
    brokerOrderId: standingBuyOrder.brokerOrderId,
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: standingBuyOrder.limitPrice,
    originalQuantity: standingBuyOrder.originalQuantity,
    executedQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  })
  const recoveredBuyFill = new Fill({
    tradeId: "recovery-mode-buy-fill",
    brokerOrderId: standingBuyOrder.brokerOrderId,
    clientOrderId: standingBuyOrder.clientOrderId,
    market,
    side: "BUY",
    price: standingBuyOrder.limitPrice,
    quantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "90",
      asset: quoteAsset
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })

  const result = await harness.engine.processUserDataEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: filledStandingBuyOrder,
      fill: recoveredBuyFill,
    },
    recoveryMode: true,
  })

  assert.equal(
    result.ok,
    true,
    "a canonical BUY fill received during authoritative recovery must be accounted without attempting an exchange cancellation",
  )
  assert.deepEqual(
    harness.cancellationIds,
    [],
    "recovery-mode BUY fill processing must leave the existing recovery SELL untouched until broker recovery is acknowledged",
  )
  assert.deepEqual(
    harness.engine.getRecoveryIntents().deferredEvaluations,
    ["DOGEUSDT"],
    "the affected market must retain a deferred strategy evaluation so the BUY fill is not lost when the recovery gate closes",
  )
})


test("does not apply partial REST reconciliation after a fill-history timeout and permits a later retry", async () => {
  const {
    engine,
    broker,
    accountedFills,
    pauses
  } = await createHarness()
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const fill = makeBuyFill({
    order: buyOrder,
    tradeId: "rest-timeout-retry-fill",
    price: "99.95",
    quantity: "0.2",
    quoteQuantity: "19.99",
    executedAt: 10,
  })
  const historyOrder = makeOrderStatusUpdate({
    order: buyOrder,
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.2",
    updatedAt: 3,
  })
  const timeout = Object.assign(
    new Error("REST fill history request timed out"),
    {
      name: "RpcTimeoutError",
      code: "RPC_TIMEOUT"
    },
  )
  let fillHistoryReads = 0
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [makeOpenOrder({
      order: buyOrder,
      executedQuantity: "0.2"
    })],
  })
  broker.getCanonicalOrderHistory = async () => ({
    ok: true,
    data: [historyOrder]
  })
  broker.getFills = async () => {
    fillHistoryReads += 1
    return fillHistoryReads === 1
      ? {
        ok: false,
        errors: [timeout]
      }
      : {
        ok: true,
        data: [fill]
      }
  }

  const failedAttempt = await engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(failedAttempt.ok, false, "A failed REST fill-history request must fail owned-order reconciliation.")
  assert.equal(accountedFills.length, 0, "No fill may be applied until every REST snapshot for the owned order has been collected.")
  assert.ok(pauses.includes("REST_STREAM_RECONCILIATION_FAILED"), "The failed recovery reconciliation must pause the affected market.")
  assert.equal(
    engine.getOrders().find((order) => order.brokerOrderId === buyOrder.brokerOrderId).executedQuantity.amount,
    "0",
    "A timeout must leave the registered order unchanged rather than applying an incomplete REST snapshot.",
  )

  const retriedAttempt = await engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(retriedAttempt.ok, true, retriedAttempt.errors?.[0]?.message)
  assert.equal(fillHistoryReads, 2, "A later recovery attempt must be able to repeat the failed REST read.")
  assert.equal(accountedFills.length, 1, "The successful retry must apply the recovered fill exactly once.")
  assert.equal(accountedFills[0].id, fill.id, "The successful retry must apply the exact canonical REST fill.")
  const reconciledOrder = engine.getOrders().find((order) => order.brokerOrderId === buyOrder.brokerOrderId)
  assert.equal(reconciledOrder.status, "PARTIALLY_FILLED")
  assert.equal(reconciledOrder.executedQuantity.amount, "0.2")
})


async function createMalformedRestEnvelopeFixture({
  openOrdersResult = {
    ok: true,
    data: []
  },
  canonicalOrderHistoryResult,
  fillsResult = {
    ok: true,
    data: []
  },
} = {}) {
  const makeCanonicalOrder = ({ status }) => new CanonicalOrder({
    clientOrderId: "malformed-rest-envelope-owned-order",
    brokerOrderId: "broker-malformed-rest-envelope-owned-order",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status,
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const ownedOrder = makeCanonicalOrder({ status: "UNKNOWN" })
  const canonicalHistoryOrder = makeCanonicalOrder({ status: "CANCELED" })
  const brokerReadCounts = {
    openOrders: 0,
    canonicalOrderHistory: 0,
    fills: 0,
  }
  const harness = await createHarness({
    initialBook: false,
    initialState: {
      orderRegistry: new OrderRegistry({ orders: [ownedOrder] }),
    },
  })

  harness.broker.getOpenOrders = async () => {
    brokerReadCounts.openOrders += 1
    return openOrdersResult
  }
  harness.broker.getCanonicalOrderHistory = async () => {
    brokerReadCounts.canonicalOrderHistory += 1
    return canonicalOrderHistoryResult === undefined
      ? {
        ok: true,
        data: [canonicalHistoryOrder]
      }
      : canonicalOrderHistoryResult
  }
  harness.broker.getFills = async () => {
    brokerReadCounts.fills += 1
    return fillsResult
  }

  return {
    harness,
    ownedOrder,
    brokerReadCounts
  }
}

function assertMalformedRestEnvelopeFailsClosed({
  fixture,
  result,
  scenario,
  expectedError,
  expectedCanonicalOrderHistoryReads,
  expectedFillHistoryReads,
}) {
  const {
    harness,
    ownedOrder,
    brokerReadCounts
  } = fixture
  assert.equal(
    result.ok,
    false,
    `${scenario}: malformed broker REST data must fail owned-order reconciliation rather than being accepted.`,
  )
  assert.match(
    result.errors?.[0]?.message ?? "",
    expectedError,
    `${scenario}: the failure must identify the malformed REST snapshot stage.`,
  )
  assert.deepEqual(
    harness.accountedFills,
    [],
    `${scenario}: no execution may be applied before every owned-order REST envelope is validated.`,
  )
  assert.deepEqual(
    harness.engine.getPausedMarkets(),
    ["DOGEUSDT"],
    `${scenario}: the affected market must remain paused after malformed authoritative REST data.`,
  )
  assert.equal(
    harness.engine.getOrders().find((order) => order.brokerOrderId === ownedOrder.brokerOrderId).status,
    "UNKNOWN",
    `${scenario}: malformed REST data must not advance the registered owned order from UNKNOWN.`,
  )
  assert.equal(
    harness.engine.getOrders().find((order) => order.brokerOrderId === ownedOrder.brokerOrderId).executedQuantity.amount,
    "0",
    `${scenario}: malformed REST data must not apply a partial or inferred executed quantity.`,
  )
  assert.deepEqual(
    harness.cancellationIds,
    [],
    `${scenario}: reconciliation failure must not issue an exchange cancellation.`,
  )
  assert.deepEqual(
    harness.orders,
    [],
    `${scenario}: reconciliation failure must not submit a replacement or any other exchange order.`,
  )
  assert.equal(
    brokerReadCounts.openOrders,
    1,
    `${scenario}: reconciliation must make exactly one account-symbol open-order read.`,
  )
  assert.equal(
    brokerReadCounts.canonicalOrderHistory,
    expectedCanonicalOrderHistoryReads,
    `${scenario}: canonical order history must be read only after open-order envelope validation.`,
  )
  assert.equal(
    brokerReadCounts.fills,
    expectedFillHistoryReads,
    `${scenario}: fill history must be read only after canonical order history validation.`,
  )
}

const createUnknownSubmissionHarness = async () => {
  const harness = await createHarness()
  harness.broker.placeOrder = async () => ({
    ok: false,
    errors: [new Error("broker submission outcome is unknown")],
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const pendingOrder = harness.engine.getOrders().find((order) => !order.brokerOrderId)
  assert.ok(pendingOrder, "The failed submission must remain registered for clientOrderId reconciliation.")
  return {
    harness,
    pendingOrder
  }
}

test("keeps explicit pending-order REST lookup failures retryable", async () => {
  const { harness } = await createUnknownSubmissionHarness()
  harness.broker.getCanonicalOrder = async () => ({
    ok: false,
    errors: [new Error("temporary clientOrderId lookup failure")],
  })
  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(result.failure, {
    category: "REST_RECONCILIATION",
    stage: "PENDING_ORDER_LOOKUP",
    retryable: true,
  })
})

test("treats a pending-order lookup response without an explicit success flag as terminal", async () => {
  const { harness } = await createUnknownSubmissionHarness()
  harness.broker.getCanonicalOrder = async () => ({ data: null })
  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(result.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "PENDING_ORDER_LOOKUP_RESPONSE",
    retryable: false,
  })
})

test("treats a pending-order lookup CanonicalOrder without brokerOrderId as terminal shape failure", async () => {
  const {
    harness,
    pendingOrder
  } = await createUnknownSubmissionHarness()
  harness.broker.getCanonicalOrder = async () => ({
    ok: true,
    data: new CanonicalOrder({
      clientOrderId: pendingOrder.clientOrderId,
      market,
      side: pendingOrder.side,
      type: pendingOrder.type,
      limitPrice: new Money({
        amount: "100",
        asset: quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: "1",
        asset: baseAsset
      }),
      executedQuantity: new Quantity({
        amount: "0",
        asset: baseAsset
      }),
      status: "UNKNOWN",
    }),
  })
  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(result.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "PENDING_ORDER_LOOKUP_SHAPE",
    retryable: false,
  })
})

test("treats pending-order lookup quantity and price conflicts as terminal accounting failures", async () => {
  const {
    harness,
    pendingOrder
  } = await createUnknownSubmissionHarness()
  const wrongQuantity = pendingOrder.originalQuantity.amount === "999999" ? "888888" : "999999"
  const wrongPrice = pendingOrder.limitPrice.amount === "999999" ? "888888" : "999999"
  harness.broker.getCanonicalOrder = async () => ({
    ok: true,
    data: new CanonicalOrder({
      clientOrderId: pendingOrder.clientOrderId,
      brokerOrderId: "broker-pending-order-parity-conflict",
      market,
      side: pendingOrder.side,
      type: pendingOrder.type,
      limitPrice: new Money({
        amount: wrongPrice,
        asset: quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: wrongQuantity,
        asset: baseAsset
      }),
      executedQuantity: new Quantity({
        amount: "0",
        asset: baseAsset
      }),
      status: "OPEN",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 1,
    }),
  })
  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(result.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "PENDING_ORDER_LOOKUP_PARITY",
    retryable: false,
  })
})

test("classifies a pending-order clientOrderId mismatch as terminal ownership failure", async () => {
  const {
    harness,
    pendingOrder
  } = await createUnknownSubmissionHarness()
  harness.broker.getCanonicalOrder = async () => ({
    ok: true,
    data: new CanonicalOrder({
      clientOrderId: "foreign-client-order",
      brokerOrderId: "foreign-broker-order",
      market,
      side: pendingOrder.side,
      type: pendingOrder.type,
      limitPrice: new Money({
        amount: "100",
        asset: quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: "1",
        asset: baseAsset
      }),
      executedQuantity: new Quantity({
        amount: "0",
        asset: baseAsset
      }),
      status: "OPEN",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 1,
    }),
  })
  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(result.failure, {
    category: "OWNERSHIP_INTEGRITY",
    stage: "PENDING_ORDER_LOOKUP_IDENTITY",
    retryable: false,
  })
})

test("treats an unclassified thrown pending-order lookup exception as terminal", async () => {
  const { harness } = await createUnknownSubmissionHarness()
  harness.broker.getCanonicalOrder = async () => { throw new Error("unexpected clientOrderId lookup adapter exception") }
  const result = await harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(result.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "PENDING_ORDER_LOOKUP_EXCEPTION",
    retryable: false,
  })
})

test("treats unclassified thrown owned-order REST adapter errors as terminal", async () => {
  const openOrdersFixture = await createMalformedRestEnvelopeFixture()
  openOrdersFixture.harness.broker.getOpenOrders = async () => { throw new Error("unexpected open-orders adapter exception") }
  const openOrdersResult = await openOrdersFixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(openOrdersResult.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "OWNED_OPEN_ORDERS_READ_EXCEPTION",
    retryable: false
  })

  const historyFixture = await createMalformedRestEnvelopeFixture()
  historyFixture.harness.broker.getCanonicalOrderHistory = async () => { throw new Error("unexpected history adapter exception") }
  const historyResult = await historyFixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(historyResult.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "OWNED_ORDER_HISTORY_READ_EXCEPTION",
    retryable: false
  })

  const fillsFixture = await createMalformedRestEnvelopeFixture()
  fillsFixture.harness.broker.getFills = async () => { throw new Error("unexpected fills adapter exception") }
  const fillsResult = await fillsFixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(fillsResult.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "OWNED_ORDER_FILL_HISTORY_READ_EXCEPTION",
    retryable: false
  })
})

test("treats REST response envelopes without explicit success flags as terminal integrity failures", async () => {
  const openOrdersFixture = await createMalformedRestEnvelopeFixture({ openOrdersResult: { data: [] } })
  const openOrdersResult = await openOrdersFixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(openOrdersResult.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "OWNED_OPEN_ORDERS_RESPONSE",
    retryable: false
  })

  const historyFixture = await createMalformedRestEnvelopeFixture({ canonicalOrderHistoryResult: { data: [] } })
  const historyResult = await historyFixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(historyResult.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "OWNED_ORDER_HISTORY_RESPONSE",
    retryable: false
  })

  const fillsFixture = await createMalformedRestEnvelopeFixture({ fillsResult: { data: [] } })
  const fillsResult = await fillsFixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(fillsResult.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "OWNED_ORDER_FILL_HISTORY_RESPONSE",
    retryable: false
  })
})

test("fails closed when owned-order open-orders REST data is not an array", async () => {
  const fixture = await createMalformedRestEnvelopeFixture({
    openOrdersResult: {
      ok: true,
      data: { orders: [] }
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(result.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "OWNED_OPEN_ORDER_SNAPSHOT",
    retryable: false
  }, "A successful but malformed open-order payload must be terminal integrity failure, not a retryable REST outage.")
  assertMalformedRestEnvelopeFailsClosed({
    fixture,
    result,
    scenario: "a non-array open-orders response",
    expectedError: /Open-order snapshot is incomplete or contains invalid Order records/,
    expectedCanonicalOrderHistoryReads: 0,
    expectedFillHistoryReads: 0,
  })
})

test("fails closed when owned-order open-orders REST data contains a non-Order record", async () => {
  const fixture = await createMalformedRestEnvelopeFixture({
    openOrdersResult: {
      ok: true,
      data: [{
      id: "forged-order",
      status: "NEW"
    }]
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assertMalformedRestEnvelopeFailsClosed({
    fixture,
    result,
    scenario: "an open-orders array containing a plain object instead of an Order entity",
    expectedError: /Open-order snapshot is incomplete or contains invalid Order records/,
    expectedCanonicalOrderHistoryReads: 0,
    expectedFillHistoryReads: 0,
  })
})

test("fails closed when owned-order canonical REST history contains no order", async () => {
  const fixture = await createMalformedRestEnvelopeFixture({
    canonicalOrderHistoryResult: {
      ok: true,
      data: []
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assertMalformedRestEnvelopeFailsClosed({
    fixture,
    result,
    scenario: "an empty canonical order-history response",
    expectedError: /Canonical order history is incomplete/,
    expectedCanonicalOrderHistoryReads: 1,
    expectedFillHistoryReads: 0,
  })
})

test("classifies canonical REST order identity conflicts as terminal ownership failures", async () => {
  const foreignHistoryOrder = new CanonicalOrder({
    clientOrderId: "different-client-order",
    brokerOrderId: "broker-malformed-rest-envelope-owned-order",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "CANCELED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const fixture = await createMalformedRestEnvelopeFixture({
    canonicalOrderHistoryResult: {
      ok: true,
      data: [foreignHistoryOrder]
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.equal(result.ok, false, "A canonical history row for another client order must be rejected.")
  assert.deepEqual(result.failure, {
    category: "OWNERSHIP_INTEGRITY",
    stage: "OWNED_ORDER_HISTORY_IDENTITY",
    retryable: false,
  }, "An order-identity mismatch must be terminal and must not be retried as a REST outage.")
})

test("fails closed when owned-order canonical REST history contains multiple orders", async () => {
  const makeHistoryOrder = () => new CanonicalOrder({
    clientOrderId: "malformed-rest-envelope-owned-order",
    brokerOrderId: "broker-malformed-rest-envelope-owned-order",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "100",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "CANCELED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const fixture = await createMalformedRestEnvelopeFixture({
    canonicalOrderHistoryResult: {
      ok: true,
      data: [makeHistoryOrder(), makeHistoryOrder()]
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assertMalformedRestEnvelopeFailsClosed({
    fixture,
    result,
    scenario: "a canonical order-history response containing multiple orders for one broker order ID",
    expectedError: /Canonical order history is incomplete/,
    expectedCanonicalOrderHistoryReads: 1,
    expectedFillHistoryReads: 0,
  })
})

test("fails closed when owned-order canonical REST history contains a non-CanonicalOrder record", async () => {
  const fixture = await createMalformedRestEnvelopeFixture({
    canonicalOrderHistoryResult: {
      ok: true,
      data: [{ brokerOrderId: "broker-malformed-rest-envelope-owned-order" }]
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assertMalformedRestEnvelopeFailsClosed({
    fixture,
    result,
    scenario: "a canonical order-history response containing a plain object instead of a CanonicalOrder entity",
    expectedError: /Canonical order history is incomplete/,
    expectedCanonicalOrderHistoryReads: 1,
    expectedFillHistoryReads: 0,
  })
})

test("fails closed when owned-order REST fill history is not an array", async () => {
  const fixture = await createMalformedRestEnvelopeFixture({
    fillsResult: {
      ok: true,
      data: { fills: [] }
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assert.deepEqual(result.failure, {
    category: "ACCOUNTING_INTEGRITY",
    stage: "OWNED_ORDER_FILL_HISTORY_SHAPE",
    retryable: false
  }, "A successful but malformed fill-history payload must fail closed as accounting integrity, not retry indefinitely.")
  assertMalformedRestEnvelopeFailsClosed({
    fixture,
    result,
    scenario: "a non-array REST fill-history response",
    expectedError: /REST fill history is incomplete or invalid/,
    expectedCanonicalOrderHistoryReads: 1,
    expectedFillHistoryReads: 1,
  })
})

test("fails closed when owned-order REST fill history contains a non-Fill record", async () => {
  const fixture = await createMalformedRestEnvelopeFixture({
    fillsResult: {
      ok: true,
      data: [{ tradeId: "forged-fill" }]
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assertMalformedRestEnvelopeFailsClosed({
    fixture,
    result,
    scenario: "a REST fill-history array containing a plain object instead of a Fill entity",
    expectedError: /REST fill history is incomplete or invalid/,
    expectedCanonicalOrderHistoryReads: 1,
    expectedFillHistoryReads: 1,
  })
})

test("fails closed when owned-order REST fill history exceeds the supported page size", async () => {
  const fixture = await createMalformedRestEnvelopeFixture({
    fillsResult: {
      ok: true,
      data: Array.from({ length: 1001 }, () => ({}))
    },
  })
  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })
  assertMalformedRestEnvelopeFailsClosed({
    fixture,
    result,
    scenario: "a REST fill-history page containing more than the supported 1000 records",
    expectedError: /REST fill history is incomplete or invalid/,
    expectedCanonicalOrderHistoryReads: 1,
    expectedFillHistoryReads: 1,
  })
})


function assertBrokerRestFailurePreservesOriginalCause({
  result,
  timeout,
  scenario,
  expectedMessage
}) {
  assert.equal(
    result.ok,
    false,
    `${scenario}: a failed broker REST result must fail owned-order reconciliation.`,
  )
  const failure = result.errors?.[0]
  assert.ok(
    failure instanceof Error,
    `${scenario}: reconciliation must return the contextual Error wrapper for the failed REST stage.`,
  )
  assert.equal(
    failure.message,
    expectedMessage,
    `${scenario}: preserving the cause must not change the existing contextual reconciliation message.`,
  )
  assert.equal(
    failure.cause,
    timeout,
    `${scenario}: the contextual reconciliation Error must retain the exact original broker Error as native cause.`,
  )
  assert.equal(
    failure.cause?.name,
    "RpcTimeoutError",
    `${scenario}: the native cause must preserve the broker's typed timeout name for diagnosis.`,
  )
}

test("preserves the original broker error as cause when owned-order open-orders REST retrieval fails", async () => {
  const timeout = Object.assign(
    new Error("owned-order open-orders RPC timed out"),
    {
      name: "RpcTimeoutError",
      code: "RPC_TIMEOUT"
    },
  )
  const fixture = await createMalformedRestEnvelopeFixture({
    openOrdersResult: {
      ok: false,
      errors: [timeout]
    },
  })

  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assert.deepEqual(result.failure, {
    category: "REST_RECONCILIATION",
    stage: "OWNED_OPEN_ORDERS_READ",
    retryable: true
  }, "A broker-declared open-orders read failure may retry only after a new authoritative recovery attempt.")
  assertBrokerRestFailurePreservesOriginalCause({
    result,
    timeout,
    scenario: "an account-symbol open-orders RPC timeout during owned-order recovery",
    expectedMessage: "Open-order snapshot is incomplete or contains invalid Order records for DOGEUSDT",
  })
})

test("preserves the original broker error as cause when canonical order-history REST retrieval fails", async () => {
  const timeout = Object.assign(
    new Error("canonical order-history RPC timed out"),
    {
      name: "RpcTimeoutError",
      code: "RPC_TIMEOUT"
    },
  )
  const fixture = await createMalformedRestEnvelopeFixture({
    canonicalOrderHistoryResult: {
      ok: false,
      errors: [timeout]
    },
  })

  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assertBrokerRestFailurePreservesOriginalCause({
    result,
    timeout,
    scenario: "a canonical order-history RPC timeout during owned-order recovery",
    expectedMessage: "Canonical order history is incomplete for owned order broker-malformed-rest-envelope-owned-order",
  })
})

test("preserves the original broker error as cause when REST fill-history retrieval fails", async () => {
  const timeout = Object.assign(
    new Error("owned-order fill-history RPC timed out"),
    {
      name: "RpcTimeoutError",
      code: "RPC_TIMEOUT"
    },
  )
  const fixture = await createMalformedRestEnvelopeFixture({
    fillsResult: {
      ok: false,
      errors: [timeout]
    },
  })

  const result = await fixture.harness.engine.reconcileOwnedOrders({ recoveryMode: true })

  assertBrokerRestFailurePreservesOriginalCause({
    result,
    timeout,
    scenario: "a REST fill-history RPC timeout during owned-order recovery",
    expectedMessage: "REST fill history is incomplete or invalid for owned order broker-malformed-rest-envelope-owned-order",
  })
})


const makeTrailingReplacementPolicy = ({
  replacementPrice = "100",
  replacementQuantity = "1"
} = {}) => {
  let trailingRepricingEvaluations = 0
  return {
    evaluate: ({
      marketPrice,
      activeOrders
    }) => ({
      strategy: "TEST_POLICY",
      symbol: "DOGEUSDT",
      action: activeOrders.length > 0 ? "NO_ACTION" : "PLACE_ORDERS",
      actions: activeOrders.length > 0 ? [] : [{
        side: "BUY",
        type: "LIMIT_MAKER",
        price: marketPrice.price === "100" ? "99.95" : replacementPrice,
        quantity: marketPrice.price === "100" ? "1" : replacementQuantity,
      }],
    }),
    evaluateTrailingBuyRepricing: () => ({
      shouldReplace: ++trailingRepricingEvaluations === 1,
      adjustmentThreshold: "0.05",
    }),
  }
}

test("keeps the standing BUY open when the proposed trailing replacement violates MIN_NOTIONAL", async () => {
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy({
      replacementPrice: "49.99",
      replacementQuantity: "0.1"
    }),
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "A below-minimum-notional replacement must be rejected during preflight")
  assert.match(result.errors[0].message, /MIN_NOTIONAL/, "The validation failure must identify the violated exchange rule")
  assert.deepEqual(harness.cancellationIds, [], "The existing BUY must not be canceled before MIN_NOTIONAL validation")
  assert.equal(harness.orders.length, 1, "An invalid replacement must never reach the broker")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN", "The previously valid BUY must remain registered as open")
  assert.ok(harness.pauses.includes("TRAILING_BUY_REPLACEMENT_VALIDATION_FAILED"), "Regression assertion: keeps the standing BUY open when the proposed trailing replacement violates MIN_NOTIONAL")
})

test("keeps the standing BUY open when the proposed replacement violates quantity increments", async () => {
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy({
      replacementPrice: "100",
      replacementQuantity: "1.05"
    }),
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "Regression assertion: keeps the standing BUY open when the proposed replacement violates quantity increments")
  assert.match(result.errors[0].message, /QUANTITY_INCREMENT/, "Regression assertion: keeps the standing BUY open when the proposed replacement violates quantity increments")
  assert.deepEqual(harness.cancellationIds, [], "Quantity-filter rejection must happen before cancellation")
  assert.equal(harness.orders.length, 1, "Quantity-filter rejection must not submit a replacement")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN")
})

test("keeps the standing BUY open when the proposed replacement violates price increments", async () => {
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy({
      replacementPrice: "99.951",
      replacementQuantity: "1"
    }),
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "Regression assertion: keeps the standing BUY open when the proposed replacement violates price increments")
  assert.match(result.errors[0].message, /PRICE_INCREMENT/, "Regression assertion: keeps the standing BUY open when the proposed replacement violates price increments")
  assert.deepEqual(harness.cancellationIds, [], "Price-filter rejection must happen before cancellation")
  assert.equal(harness.orders.length, 1, "Regression assertion: keeps the standing BUY open when the proposed replacement violates price increments")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN")
})

test("keeps the standing BUY open when the replacement market price is stale", async () => {
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy(),
    isMarketPriceFresh: ({ timestamp }) => timestamp === 1,
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, true, "Regression assertion: keeps the standing BUY open when the replacement market price is stale")
  assert.equal(result.data.reason, "STALE_MARKET_PRICE")
  assert.deepEqual(harness.cancellationIds, [], "Regression assertion: keeps the standing BUY open when the replacement market price is stale")
  assert.equal(harness.orders.length, 1, "Regression assertion: keeps the standing BUY open when the replacement market price is stale")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN")
})

test("keeps the standing BUY open when the replacement trading rules become unavailable", async () => {
  let currentMetadata = marketMetadata
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy(),
    getMarketMetadata: () => currentMetadata,
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  currentMetadata = {
    ...marketMetadata,
    tradingRules: undefined
  }
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "Regression assertion: keeps the standing BUY open when the replacement trading rules become unavailable")
  assert.match(result.errors[0].message, /TradingRules|trading rules/i, "A refreshed metadata response without canonical trading rules must fail closed")
  assert.deepEqual(harness.cancellationIds, [], "Regression assertion: keeps the standing BUY open when the replacement trading rules become unavailable")
  assert.equal(harness.orders.length, 1, "Regression assertion: keeps the standing BUY open when the replacement trading rules become unavailable")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN", "The original standing BUY must remain open when refreshed trading rules are unavailable")
})

test("does not submit a replacement when cancellation fails", async () => {
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy(),
    cancelFailure: true,
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "Regression assertion: does not submit a replacement when cancellation fails")
  assert.equal(harness.cancellationIds.length, 1, "Regression assertion: does not submit a replacement when cancellation fails")
  assert.equal(harness.orders.length, 1, "A failed or unconfirmed cancellation must prevent replacement submission")
  assert.ok(["UNKNOWN", "OPEN"].includes(harness.engine.getOrders()[0].status))
  assert.equal(harness.engine.getPausedMarkets().includes("DOGEUSDT"), true, "Regression assertion: does not submit a replacement when cancellation fails")
})

test("retains an explicitly unknown replacement after cancellation succeeds but submission fails", async () => {
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy(),
    placeOrderFailureAfterFirst: true,
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "Regression assertion: retains an explicitly unknown replacement after cancellation succeeds but submission fails")
  assert.equal(harness.cancellationIds.length, 1, "Regression assertion: retains an explicitly unknown replacement after cancellation succeeds but submission fails")
  assert.equal(harness.orders.length, 2, "The broker must receive exactly one replacement attempt")
  assert.equal(harness.engine.getOrders()[0].status, "CANCELED", "The old order must not be represented as open after confirmed cancellation")
  assert.equal(harness.engine.getOrders()[1].status, "UNKNOWN", "The failed replacement outcome must remain explicitly reconcilable")
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"], "Regression assertion: retains an explicitly unknown replacement after cancellation succeeds but submission fails")
  const repeated = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.12",
      timestamp: 3
    },
  })
  assert.equal(repeated.ok, true, "Regression assertion: retains an explicitly unknown replacement after cancellation succeeds but submission fails")
  assert.equal(harness.orders.length, 2, "A paused market must not create duplicate replacement submissions")
})

test("repeated market-price events cannot submit duplicate replacements after a valid replacement", async () => {
  const harness = await createHarness({ strategyPolicy: makeTrailingReplacementPolicy() })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const firstReplacement = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })
  const repeated = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 3
    },
  })

  assert.equal(firstReplacement.ok, true, "Regression assertion: repeated market-price events cannot submit duplicate replacements after a valid replacement")
  assert.equal(firstReplacement.data.trailingBuyReplaced, true, "Regression assertion: repeated market-price events cannot submit duplicate replacements after a valid replacement")
  assert.equal(repeated.ok, true, "Regression assertion: repeated market-price events cannot submit duplicate replacements after a valid replacement")
  assert.equal(harness.orders.length, 2, "Repeated market events must not create a second replacement for the same trailing step")
  assert.equal(harness.cancellationIds.length, 1, "Regression assertion: repeated market-price events cannot submit duplicate replacements after a valid replacement")
})


test("keeps the standing BUY open when the post-only market book becomes stale", async () => {
  let marketBookFresh = true
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy(),
    isMarketBookFresh: () => marketBookFresh,
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  marketBookFresh = false
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, true, "Regression assertion: keeps the standing BUY open when the post-only market book becomes stale")
  assert.equal(result.data.reason, "REPLACEMENT_MARKET_DATA_UNAVAILABLE")
  assert.deepEqual(harness.cancellationIds, [], "A stale post-only book must prevent cancellation of the standing BUY")
  assert.equal(harness.orders.length, 1, "A stale post-only book must prevent replacement submission")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN")
})

test("keeps the standing BUY open when a required exchange trading rule is missing", async () => {
  let currentMetadata = marketMetadata
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy(),
    getMarketMetadata: () => currentMetadata,
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  currentMetadata = {
    ...marketMetadata,
    tradingRules: new TradingRules({
      market,
      constraints: marketMetadata.tradingRules.constraints.filter(
        ({ type }) => type !== "MIN_NOTIONAL",
      ),
    }),
  }
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "Regression assertion: keeps the standing BUY open when a required exchange trading rule is missing")
  assert.match(result.errors[0].message, /MIN_NOTIONAL/, "Regression assertion: keeps the standing BUY open when a required exchange trading rule is missing")
  assert.deepEqual(harness.cancellationIds, [], "Regression assertion: keeps the standing BUY open when a required exchange trading rule is missing")
  assert.equal(harness.orders.length, 1, "Regression assertion: keeps the standing BUY open when a required exchange trading rule is missing")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN")
})


test("uses freshly fetched exchange trading rules instead of the startup snapshot", async () => {
  const refreshedMetadata = {
    ...marketMetadata,
    tradingRules: new TradingRules({
      market,
      constraints: marketMetadata.tradingRules.constraints.map((constraint) =>
        constraint.type === "MIN_NOTIONAL"
          ? {
            ...constraint,
            value: new Money({
            amount: "10",
            asset: quoteAsset
          })
          }
          : constraint,
      ),
    }),
  }
  let refreshedRuleReads = 0
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy({
      replacementPrice: "60",
      replacementQuantity: "0.1"
    }),
    getMarketMetadata: () => marketMetadata,
    getSymbolFilters: async () => {
      refreshedRuleReads += 1
      return {
        ok: true,
        data: refreshedMetadata
      }
    },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "A candidate valid under startup rules must be rejected under the refreshed exchange rules")
  assert.match(result.errors[0].message, /MIN_NOTIONAL/, "The refreshed minimum-notional constraint must govern preflight")
  assert.equal(refreshedRuleReads, 1, "The engine must fetch current exchange rules before replacement preflight")
  assert.deepEqual(harness.cancellationIds, [], "A replacement rejected by refreshed rules must not cancel the standing BUY")
  assert.equal(harness.orders.length, 1, "A replacement rejected by refreshed rules must not be submitted")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN", "The standing BUY must remain open under refreshed-rule rejection")
})

test("keeps the standing BUY open when fetching current exchange trading rules fails", async () => {
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy(),
    getSymbolFilters: async () => ({
      ok: false,
      errors: [new Error("exchangeInfo request unavailable")],
    }),
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "A failed current-rule request must block replacement")
  assert.match(result.errors[0].message, /exchangeInfo request unavailable/, "The refresh failure must remain visible to the caller")
  assert.deepEqual(harness.cancellationIds, [], "Unavailable current rules must not cancel the standing BUY")
  assert.equal(harness.orders.length, 1, "Unavailable current rules must not submit a replacement")
  assert.equal(harness.engine.getOrders()[0].status, "OPEN", "The previously valid order must remain open when rules cannot be refreshed")
  assert.ok(harness.pauses.includes("TRAILING_BUY_REPLACEMENT_RULES_UNAVAILABLE"), "A failed exchange-rule refresh must pause the pair")
})


test("preserves an OPEN recovery SELL after a locally blocked NOT_SENT cancellation", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const { engine } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    cancelNotSent: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const recoverySellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "not-sent-recovery-buy-fill",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95"
      }),
    },
  })

  assert.equal(result.ok, false, "A recovery SELL blocked before exchange submission must still stop the current transition")
  const failed = events.find((event) =>
    event.name === "order.cancel_failed" && event.data.clientOrderId === recoverySellOrder.clientOrderId)
  assert.ok(failed, "A locally blocked recovery SELL cancellation must publish its lifecycle failure")
  assert.equal(failed.data.outcome, "NOT_SENT", "A broker-proven preflight refusal must be distinguishable from an unknown exchange outcome")
  assert.equal(failed.data.status, "OPEN", "A NOT_SENT lifecycle event must retain the last known canonical recovery SELL state")
  assert.equal(
    engine.getOrders().find((order) => order.clientOrderId === recoverySellOrder.clientOrderId).status,
    "OPEN",
    "A recovery SELL whose cancel RPC was never sent must remain canonically OPEN rather than becoming UNKNOWN",
  )
  assert.ok(events.some((event) =>
    event.name === "strategy.paused" && event.data.reason === "RECOVERY_SELL_CANCELLATION_NOT_SENT"),
  "A NOT_SENT recovery SELL cancellation must retain the pair safety pause")
})


test("preserves an OPEN trailing BUY after a locally blocked NOT_SENT replacement cancellation", async () => {
  const events = []
  const {
    engine,
    orders
  } = await createHarness({
    cancelNotSent: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "A trailing BUY replacement must stop when the broker proves cancellation was not sent")
  assert.equal(orders.length, 1, "A locally blocked trailing BUY cancellation must prevent replacement submission")
  const failed = events.find((event) => event.name === "order.cancel_failed")
  assert.ok(failed, "A locally blocked trailing BUY cancellation must publish lifecycle evidence")
  assert.equal(failed.data.outcome, "NOT_SENT", "A preflight-blocked trailing BUY cancellation must not be mislabeled as an unknown outcome")
  assert.equal(failed.data.status, "OPEN", "The trailing BUY failure event must retain the known OPEN order state")
  assert.equal(engine.getOrders()[0].status, "OPEN", "The standing BUY must remain OPEN when no exchange cancellation request was sent")
  assert.ok(events.some((event) =>
    event.name === "strategy.paused" && event.data.reason === "TRAILING_BUY_CANCELLATION_NOT_SENT"),
  "A preflight-blocked trailing BUY cancellation must preserve the pair safety pause")
})


test("preserves an OPEN owned BUY after a locally blocked NOT_SENT shutdown cancellation", async () => {
  const events = []
  const ownedBuyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "shutdown-not-sent-buy",
    brokerOrderId: "broker-shutdown-not-sent-buy",
  })
  const {
    engine,
    cancellationIds
  } = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [ownedBuyOrder] }) },
    cancelNotSent: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })

  const result = await engine.cancelOwnedBuyOrdersForShutdown()

  assert.equal(result.ok, false, "Shutdown must remain incomplete when an owned BUY cancellation is blocked before exchange submission")
  assert.deepEqual(cancellationIds, [ownedBuyOrder.brokerOrderId], "The engine must attempt the broker operation while the broker guard proves no exchange RPC was sent")
  const failed = events.find((event) =>
    event.name === "order.cancel_failed" && event.data.clientOrderId === ownedBuyOrder.clientOrderId)
  assert.ok(failed, "A locally blocked owned BUY cancellation must publish its lifecycle failure")
  assert.equal(failed.data.outcome, "NOT_SENT", "The owned BUY lifecycle event must distinguish a preflight refusal from an ambiguous cancellation")
  assert.equal(failed.data.status, "OPEN", "The NOT_SENT lifecycle event must preserve the known OPEN BUY state")
  assert.equal(
    engine.getOrders().find((order) => order.clientOrderId === ownedBuyOrder.clientOrderId).status,
    "OPEN",
    "A shutdown cancellation rejected before the exchange RPC must preserve the owned BUY's canonical OPEN state",
  )
  assert.ok(events.some((event) =>
    event.name === "strategy.paused" && event.data.reason === "SHUTDOWN_BUY_CANCELLATION_NOT_SENT"),
  "A locally blocked shutdown cancellation must retain the safety pause and incomplete-shutdown state")
})


test("does not trust NOT_SENT metadata on a successful noncanonical cancellation result", async () => {
  const events = []
  const {
    engine,
    orders
  } = await createHarness({
    cancelNotSentOnSuccess: true,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, false, "A malformed success-shaped cancellation result must not authorize replacement")
  assert.equal(orders.length, 1, "A malformed cancellation result must not submit a replacement BUY")
  const failed = events.find((event) => event.name === "order.cancel_failed")
  assert.ok(failed, "The engine must publish cancellation failure evidence for a malformed broker result")
  assert.equal(failed.data.outcome, "UNCONFIRMED", "NOT_SENT is trusted only on an unsuccessful broker result")
  assert.equal(failed.data.status, "UNKNOWN", "A contradictory success-shaped result must retain fail-closed UNKNOWN order state")
  assert.equal(engine.getOrders()[0].status, "UNKNOWN", "The known OPEN order must not be preserved from contradictory NOT_SENT metadata")
  assert.ok(events.some((event) =>
    event.name === "strategy.paused" && event.data.reason === "TRAILING_BUY_CANCELLATION_UNCONFIRMED",
  ), "A malformed cancellation result must keep the pair safety-paused")
})


test("allows trailing BUY replacement when refreshed metadata contains unsupported exchange filters", async () => {
  const refreshedMetadata = {
    ...marketMetadata,
    unvalidatedConstraints: [
      {
        type: "DYNAMIC_PRICE_BAND",
        scope: "SYMBOL",
        sourceFilterType: "PERCENT_PRICE_BY_SIDE"
      },
    ],
  }
  let refreshedRuleReads = 0
  const harness = await createHarness({
    strategyPolicy: makeTrailingReplacementPolicy(),
    getMarketMetadata: () => marketMetadata,
    getSymbolFilters: async () => {
      refreshedRuleReads += 1
      return {
        ok: true,
        data: refreshedMetadata
      }
    },
  })
  await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100.06",
      timestamp: 2
    },
  })

  assert.equal(result.ok, true, "A refreshed unsupported filter must not block a replacement that passes all supported static checks.")
  assert.equal(result.data.trailingBuyReplaced, true, "The engine must continue the normal trailing replacement after supported rules pass.")
  assert.equal(refreshedRuleReads, 1, "The engine must still refresh exchange metadata before replacing the standing BUY.")
  assert.equal(harness.cancellationIds.length, 1, "The engine must cancel the prior owned BUY before submitting its replacement.")
  assert.equal(harness.orders.length, 2, "The engine must submit exactly one replacement order after the old BUY is canceled.")
  assert.equal(harness.engine.getOrders().at(-1).status, "OPEN", "The replacement order must remain tracked as OPEN after acknowledgement.")
});


test("definite Binance filter rejection removes PENDING without marking the order UNKNOWN", async () => {
  const events = []
  const rejection = Object.assign(new Error("Filter failure: PERCENT_PRICE_BY_SIDE"), { code: "DEFINITE_EXCHANGE_FILTER_REJECTED" })
  const {
    engine,
    orders,
    pauses
  } = await createHarness({
    placeOrderFailureCount: 1,
    placeOrderFailureError: rejection,
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })

  const result = await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })

  assert.equal(result.ok, false, "A definite exchange filter rejection must be reported to the caller.")
  assert.equal(orders.length, 1, "The rejected order must have exactly one broker submission attempt.")
  assert.deepEqual(pauses, [], "A definite filter rejection must not be treated as an ambiguous transport outcome.")
  assert.equal(engine.getOrders().length, 0, "The definitely rejected PENDING order must be removed instead of becoming a phantom active order.")
  assert.equal(events.find((event) => event.name === "order.submission_failed").data.outcome, "REJECTED", "The Journal must record a definite rejection, not UNKNOWN.")
});

test("publishes a CONTINUE_SELL_THROUGH outcome for a fully filled SELL below the profit target", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    pauses
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    recoveryCompletion: {
      eligible: false,
      pause: false,
      reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
      realizedNetProfit: "-0.1"
    },
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: sellOrder }),
      fill: makeSellFill({
        order: sellOrder,
        tradeId: "continue-sell-through"
      }),
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(pauses, [])
  const outcome = events.find(({ name }) => name === "recovery.cycle_not_completed")
  assert.ok(outcome)
  assert.equal(outcome.data.outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(outcome.data.reason, "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY")
  assert.equal(outcome.data.sellOrderClientId, sellOrder.clientOrderId)
  assert.equal(outcome.data.sellOrderBrokerOrderId, sellOrder.brokerOrderId)
})

test("publishes an explicit cycle outcome when the recovery SELL fills during cancellation", async () => {
  const events = []
  const seeded = makeSeededRecoveryState()
  const {
    engine,
    pauses
  } = await createHarness({
    initialPortfolio: seeded.portfolio,
    initialRecoveryLedger: seeded.recoveryLedger,
    baseFreeBalance: "1",
    cancelWithFill: true,
    cancelExecutedQuantity: ({ order }) => order.originalQuantity.amount,
    cancelOrderStatus: "FILLED",
    recoveryCompletion: {
      eligible: false,
      pause: false,
      reason: "RECOVERY_PROFIT_TARGET_NOT_MET_CONTINUE_RECOVERY",
      realizedNetProfit: "-0.1"
    },
    eventPublisher: { publish: (event) => { events.push(event); return { ok: true } } },
  })
  await engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: 1
    },
  })
  const buyOrder = engine.getOrders().find((order) => order.side === "BUY")
  const sellOrder = engine.getOrders().find((order) => order.side === "SELL")
  const result = await engine.processUserDataEvent({
    event: {
      executionType: "TRADE",
      executedOrder: makeFilledOrder({ order: buyOrder }),
      fill: makeBuyFill({
        order: buyOrder,
        tradeId: "cancel-race-buy",
        price: "99.95",
        quantity: "1",
        quoteQuantity: "99.95"
      }),
    },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(pauses, [])
  const outcome = events.find(({ name }) => name === "recovery.cycle_not_completed")
  assert.ok(outcome)
  assert.equal(outcome.data.outcome, "CONTINUE_SELL_THROUGH")
  assert.equal(outcome.data.sellOrderClientId, sellOrder.clientOrderId)
  assert.equal(outcome.data.sellOrderBrokerOrderId, sellOrder.brokerOrderId)
})


test("volatility data unavailable blocks new strategy orders without using the global strategy pause", async () => {
  const unavailable = {
    ok: true,
    data: {
      status: {
      isReady: false,
      reason: "INSUFFICIENT_HISTORY"
    },
      metrics: null
    },
  }
  const harness = await createHarness({ getVolatilityData: () => unavailable })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now()
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(harness.orders, [], "Missing volatility history must fail closed before broker submission.")
  assert.deepEqual(harness.pauses, [], "Volatility protection must remain separate from the full accounting safety pause.")
})

test("per-pair opt-out skips volatility snapshots and never cancels owned BUYs", async () => {
  const buyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "volatility-disabled-owned-buy",
    brokerOrderId: "broker-volatility-disabled-owned-buy"
  })
  const highVolatility = {
    ok: true,
    data: {
    status: {
    isReady: true,
    isFresh: true,
    reason: null,
    lastClosedCandleOpenTime: 60_000
  },
    metrics: {
    openTime: 60_000,
    atr: "1",
    natr: "2",
    referenceNatr: "1",
    volatilityRatio: "2"
  }
  }
  }
  const config = structuredClone(appConfig)
  config.strategies.CG_coinGrabber.pairs.DOGEUSDT.enableVolatilityProtection = false
  const harness = await createHarness({
    appConfig: config,
    initialState: { orderRegistry: new OrderRegistry({ orders: [buyOrder] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
    getVolatilityData: () => highVolatility
  })
  const result = await harness.engine.processVolatilitySnapshot({
    symbol: "DOGEUSDT",
    snapshot: highVolatility
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.skipped, true, "A disabled pair must not enter the volatility state machine.")
  assert.equal(result.data.reason, "VOLATILITY_PROTECTION_DISABLED_FOR_PAIR")
  assert.equal(harness.engine.getVolatilityProtectionState({ symbol: "DOGEUSDT" }), undefined, "A disabled pair must not allocate a startup-PROTECTED state.")
  assert.deepEqual(harness.cancellationIds, [], "Volatility opt-out must not initiate volatility-specific BUY cancellation.")
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === "volatility-disabled-owned-buy").status, "OPEN")
  assert.deepEqual(harness.pauses, [], "The opt-out must not touch independent account-integrity pause behavior.")
})

test("per-pair opt-out bypasses the volatility submission gate while retaining normal strategy execution", async () => {
  const unavailable = {
    ok: true,
    data: {
    status: {
    isReady: false,
    reason: "INSUFFICIENT_HISTORY"
  },
    metrics: null
  }
  }
  const config = structuredClone(appConfig)
  config.strategies.CG_coinGrabber.pairs.DOGEUSDT.enableVolatilityProtection = false
  const harness = await createHarness({
    appConfig: config,
    getVolatilityData: () => unavailable
  })
  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now()
    },
  })
  assert.equal(result.ok, true)
  assert.ok(harness.orders.length > 0, "The disabled pair must not be held behind volatility-history readiness; ordinary strategy gates still decide whether an order can be sent.")
  assert.equal(harness.engine.getVolatilityProtectionState({ symbol: "DOGEUSDT" }), undefined)
})

test("high volatility cancels only acknowledged owned BUYs and keeps the market protected", async () => {
  const buyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "volatility-owned-buy",
    brokerOrderId: "broker-volatility-owned-buy",
  })
  const highVolatility = {
    ok: true,
    data: {
      status: {
        isReady: true,
        reason: null,
        lastClosedCandleOpenTime: 60_000
      },
      metrics: {
        openTime: 60_000,
        atr: "1",
        natr: "2",
        referenceNatr: "1",
        volatilityRatio: "2"
      },
    },
  }
  const harness = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [buyOrder] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
    getVolatilityData: () => highVolatility,
  })

  const result = await harness.engine.processVolatilitySnapshot({
    symbol: "DOGEUSDT",
    snapshot: highVolatility,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(harness.cancellationIds, ["broker-volatility-owned-buy"])
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === "volatility-owned-buy").status, "CANCELED")
  assert.equal(harness.engine.getVolatilityProtectionState({ symbol: "DOGEUSDT" }).mode, "PROTECTED")
  assert.deepEqual(harness.pauses, [], "A confirmed volatility cancellation must not activate the global strategy pause.")
})


test("high-volatility BUY cancellation preserves an existing recovery SELL order", async () => {
  const ownedBuyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "volatility-preserved-sell-owned-buy",
    brokerOrderId: "broker-volatility-preserved-sell-owned-buy",
  })
  const recoverySellOrder = makeShutdownOrder({
    side: "SELL",
    clientOrderId: "volatility-preserved-recovery-sell",
    brokerOrderId: "broker-volatility-preserved-recovery-sell",
  })
  const highVolatility = {
    ok: true,
    data: {
      status: {
        isReady: true,
        reason: null,
        lastClosedCandleOpenTime: 60_000
      },
      metrics: {
        openTime: 60_000,
        atr: "1",
        natr: "2",
        referenceNatr: "1",
        volatilityRatio: "2"
      },
    },
  }
  const harness = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [ownedBuyOrder, recoverySellOrder] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
    getVolatilityData: () => highVolatility,
  })

  const result = await harness.engine.processVolatilitySnapshot({
    symbol: "DOGEUSDT",
    snapshot: highVolatility,
  })

  assert.equal(result.ok, true, "A high-volatility snapshot must complete its owned-BUY cancellation workflow.")
  assert.deepEqual(
    harness.cancellationIds,
    [ownedBuyOrder.brokerOrderId],
    "Volatility protection must send cancellation only for the acknowledged owned BUY, never the resting recovery SELL.",
  )
  assert.equal(
    harness.engine.getOrders().find((order) => order.clientOrderId === ownedBuyOrder.clientOrderId).status,
    "CANCELED",
    "The owned BUY must reach its broker-confirmed terminal state after volatility protection activates.",
  )
  assert.equal(
    harness.engine.getOrders().find((order) => order.clientOrderId === recoverySellOrder.clientOrderId).status,
    "OPEN",
    "The existing recovery SELL must remain resting and unchanged when volatility protection activates.",
  )
  assert.equal(
    harness.engine.getVolatilityProtectionState({ symbol: "DOGEUSDT" }).mode,
    "PROTECTED",
    "The market must remain protected after its owned BUY is canceled.",
  )
})


test("an unconfirmed volatility BUY cancellation stays protected without blocking recovery management globally", async () => {
  const buyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "volatility-unknown-buy",
    brokerOrderId: "broker-volatility-unknown-buy",
  })
  const highVolatility = {
    ok: true,
    data: {
      status: {
        isReady: true,
        reason: null,
        lastClosedCandleOpenTime: 60_000
      },
      metrics: {
        openTime: 60_000,
        atr: "1",
        natr: "2",
        referenceNatr: "1",
        volatilityRatio: "2"
      },
    },
  }
  const harness = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [buyOrder] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
    cancelFailure: true,
    getVolatilityData: () => highVolatility,
  })

  const result = await harness.engine.processVolatilitySnapshot({
    symbol: "DOGEUSDT",
    snapshot: highVolatility,
  })

  assert.equal(result.ok, true)
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === "volatility-unknown-buy").status, "UNKNOWN")
  assert.equal(harness.engine.getVolatilityProtectionState({ symbol: "DOGEUSDT" }).mode, "PROTECTED")
  assert.deepEqual(harness.pauses, [], "An uncertain volatility cancellation must retain the dedicated protection state, not silently become a full strategy pause.")
})

test("explicit recovery SELL intent may submit while volatility protection blocks ordinary BUYs", async () => {
  const position = new Position({
    market,
    baseQuantity: new Quantity({
      amount: "100",
      asset: baseAsset
    }),
    freeBaseQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    quoteNetCashFlow: new Money({
      amount: "-10",
      asset: quoteAsset
    }),
    spent: new Money({
      amount: "10",
      asset: quoteAsset
    }),
  })
  const portfolio = new Portfolio({ positions: [position] })
  const ledger = new RecoveryLedger({
    market,
    buyCost: "10"
  })
  const unavailable = {
    ok: true,
    data: {
      status: {
      isReady: false,
      reason: "STALE_STREAM"
    },
      metrics: null
    },
  }
  const harness = await createHarness({
    initialPortfolio: portfolio,
    initialRecoveryLedger: ledger,
    baseFreeBalance: "100",
    getVolatilityData: () => unavailable,
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now()
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(harness.orders.map((order) => order.side), ["SELL"])
  assert.equal(harness.orders[0].side, "SELL", "Only the explicitly marked recovery SELL may pass the protected-market submission gate.")
})


test("volatility protection rejects a SELL that lacks explicit recovery purpose", async () => {
  const position = new Position({
    market,
    baseQuantity: new Quantity({
      amount: "100",
      asset: baseAsset
    }),
    freeBaseQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    quoteNetCashFlow: new Money({
      amount: "-10",
      asset: quoteAsset
    }),
    spent: new Money({
      amount: "10",
      asset: quoteAsset
    }),
  })
  const unavailable = {
    ok: true,
    data: {
      status: {
      isReady: false,
      reason: "STALE_STREAM"
    },
      metrics: null
    },
  }
  const harness = await createHarness({
    initialPortfolio: new Portfolio({ positions: [position] }),
    initialRecoveryLedger: new RecoveryLedger({
      market,
      buyCost: "10"
    }),
    baseFreeBalance: "100",
    getVolatilityData: () => unavailable,
    strategyPolicy: {
      name: "UNTRUSTED_SELL_TEST",
      evaluate: () => ({
        strategy: "UNTRUSTED_SELL_TEST",
        action: "PLACE_ORDERS",
        actions: [{
          side: "SELL",
          type: "LIMIT_MAKER",
          price: "100",
          quantity: "1"
        }],
        reason: "SELL_WITHOUT_RECOVERY_PURPOSE",
      }),
      evaluateTrailingBuyRepricing: () => ({ actions: [] }),
    },
  })

  const result = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "100",
      timestamp: Date.now()
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(harness.orders, [], "A SELL side alone must not bypass volatility protection.")
})


test("volatility cancellation is isolated to the affected trading pair", async () => {
  const zroBaseAsset = new Asset({
    id: "asset-zro",
    code: "ZRO"
  })
  const zroMarket = new Market({
    venue: "binance",
    symbol: "ZROUSDT",
    baseAsset: zroBaseAsset,
    quoteAsset
  })
  const dogeBuy = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "doge-volatility-buy",
    brokerOrderId: "broker-doge-volatility-buy",
  })
  const zroBuy = new CanonicalOrder({
    clientOrderId: "zro-unaffected-buy",
    brokerOrderId: "broker-zro-unaffected-buy",
    market: zroMarket,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "1",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: zroBaseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: zroBaseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const highVolatility = {
    ok: true,
    data: {
      status: {
        isReady: true,
        reason: null,
        lastClosedCandleOpenTime: 60_000
      },
      metrics: {
        openTime: 60_000,
        atr: "1",
        natr: "2",
        referenceNatr: "1",
        volatilityRatio: "2"
      },
    },
  }
  const harness = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [dogeBuy, zroBuy] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
    getVolatilityData: () => highVolatility,
  })

  const result = await harness.engine.processVolatilitySnapshot({
    symbol: "DOGEUSDT",
    snapshot: highVolatility,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(harness.cancellationIds, ["broker-doge-volatility-buy"])
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === "doge-volatility-buy").status, "CANCELED")
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === "zro-unaffected-buy").status, "OPEN")
})


test("retries a volatility BUY cancellation only after a known NOT_SENT outcome and retry interval", async () => {
  const buyOrder = makeShutdownOrder({
    side: "BUY",
    clientOrderId: "volatility-not-sent-buy",
    brokerOrderId: "broker-volatility-not-sent-buy",
  })
  const makeSnapshot = (observedAt) => ({
    ok: true,
    data: {
      status: {
        isReady: true,
        isFresh: true,
        reason: null,
        observedAt,
        lastClosedCandleOpenTime: 60_000
      },
      metrics: {
        openTime: 60_000,
        atr: "1",
        natr: "2",
        referenceNatr: "1",
        volatilityRatio: "2"
      },
    },
  })
  const harness = await createHarness({
    initialState: { orderRegistry: new OrderRegistry({ orders: [buyOrder] }) },
    eventPublisher: { publish: () => ({ ok: true }) },
    cancelNotSent: true,
    getVolatilityData: () => makeSnapshot(0),
  })

  await harness.engine.processVolatilitySnapshot({
    symbol: "DOGEUSDT",
    snapshot: makeSnapshot(0)
  })
  assert.deepEqual(harness.cancellationIds, ["broker-volatility-not-sent-buy"])
  assert.equal(harness.engine.getOrders().find((order) => order.clientOrderId === "volatility-not-sent-buy").status, "OPEN")

  await harness.engine.processVolatilitySnapshot({
    symbol: "DOGEUSDT",
    snapshot: makeSnapshot(5_000)
  })
  assert.deepEqual(
    harness.cancellationIds,
    ["broker-volatility-not-sent-buy", "broker-volatility-not-sent-buy"],
    "A known NOT_SENT cancellation may be retried after the bounded five-second retry interval.",
  )
  assert.deepEqual(harness.pauses, [])
})


test("commits a strategy pause fact before publishing the Journal pause event", async () => {
  const sequence = []
  const harness = await createHarness({
    appConfig: withExternalOrdersPolicy("block"),
    onOperationalStateStrategyMarketPaused: async ({
      symbol,
      reason
    }) => {
      sequence.push("operational-state-record")
      assert.equal(symbol, "DOGEUSDT", "The Operational State Store pause must retain the exact affected market.")
      assert.equal(reason, "UNKNOWN_OR_EXTERNAL_ORDER_EVENT", "The Operational State Store pause must retain its canonical cause.")
      return {
        ok: true,
        data: { durable: true }
      }
    },
    eventPublisher: {
      publish: (event) => {
        if (event.name === "strategy.paused") { sequence.push("journal-event") }
        return { ok: true }
      },
    },
  })
  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-client-order-durable-pause",
    brokerOrderId: "external-broker-order-durable-pause",
    market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "99",
      asset: quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "1",
      asset: baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })

  const result = await harness.engine.processUserDataEvent({ event: { executedOrder: externalOrder } })

  assert.equal(result.ok, false, "An unowned order update must continue to fail the ownership check.")
  assert.deepEqual(sequence, ["operational-state-record", "journal-event"], "The recovery-authoritative pause fact must commit before its Journal observer event.")
  assert.deepEqual(harness.engine.getPausedMarkets(), ["DOGEUSDT"], "The affected market must remain paused after the unowned order event.")
})

test("exposes a serialized immutable operator market snapshot with current price and pause blockers", async () => {
  const harness = await createHarness({
    initialState: { operatorPausedMarkets: ["DOGEUSDT"] },
  })

  const priceResult = await harness.engine.processMarketPrice({
    symbol: "DOGEUSDT",
    priceEvent: {
      symbol: "DOGEUSDT",
      price: "0.12",
      timestamp: 1
    },
  })
  assert.equal(priceResult.ok, true, "A valid market price must be accepted before the operator snapshot is inspected.")

  const snapshotResult = await harness.engine.getOperatorMarketSnapshots()
  assert.equal(snapshotResult.ok, true, "The engine must return a successful read-only snapshot for configured markets.")
  const dogeMarket = snapshotResult.data.markets.find(({ symbol }) => symbol === "DOGEUSDT")

  assert.ok(dogeMarket, "The configured DOGE market must be present in the operator market snapshot.")
  assert.equal(dogeMarket.enabled, true, "The operator snapshot must expose the configured market enabled state.")
  assert.equal(dogeMarket.marketMetadataReady, true, "The snapshot must distinguish validated market metadata from missing metadata.")
  assert.equal(dogeMarket.latestPrice, "0.12", "The snapshot must expose the latest normalized market price without numeric conversion.")
  assert.equal(dogeMarket.priceTimestamp, 1, "The snapshot must preserve the source market-price timestamp.")
  assert.equal(dogeMarket.priceFresh, true, "The snapshot must use the engine's current market-price freshness policy.")
  assert.equal(dogeMarket.operatorPaused, true, "The snapshot must expose only the operator-owned pause as its own control state.")
  assert.equal(dogeMarket.blockers.includes("OPERATOR_PAUSED"), true, "The operator-owned pause must be visible as a market blocker.")
  assert.equal(Object.isFrozen(snapshotResult.data.markets), true, "The market collection must be immutable to operator-query consumers.")
  assert.equal(Object.isFrozen(dogeMarket.blockers), true, "The market blocker collection must not expose mutable engine state.")
})


test("rejects a negative-zero market-book timestamp", () => {
  assert.throws(
    () => createMarketBook({
      bookTicker: {
        symbol: "DOGEUSDT",
        bestBidPrice: "99.90",
        bestBidQuantity: "1",
        bestAskPrice: "100.00",
        bestAskQuantity: "1",
        timestamp: -0,
      },
    }),
    /timestamp/,
    "A market book must reject negative zero as a non-canonical exchange timestamp.",
  )
})
