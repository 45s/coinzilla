import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Asset, Balance, CanonicalOrder, Fill, Market, Money, Order, Quantity, TradingRules } from "@coinzilla/entities"
import { multiplyDecimal } from "@coinzilla/utils"
import { prepareHarvesterStartupState, startHarvester } from "../../src/bootstrap/start-harvester.js"
import { resolveHarvesterOptions } from "../../src/bootstrap/config/resolve-harvester-options.js"
import { createRecoverySellerStopWorkflow } from "../../src/use-cases/create-recovery-seller-stop-workflow.js"
import { createFileOperationalStateStore } from "../../src/infrastructure/operational-state/create-file-operational-state-store.js"
import { recordConfigurationBaseline } from "../../src/use-cases/record-configuration-baseline.js"
import { recordProcessStarted } from "../../src/use-cases/record-process-started.js"
import { recordProcessStopped } from "../../src/use-cases/record-process-stopped.js"
import { createBinanceBrokerAdapter } from "../../src/infrastructure/brokers/binance-broker-adapter.js"
import {
  assertRecoverySellerEvaluatorConfigured,
  assertRecoverySellerRuntimeAcceptance,
} from "../../src/bootstrap/harvester-runtime-setup.js"

export { mkdtemp, rm, os, path, Asset, Balance, CanonicalOrder, Fill, Market, Money, Order, Quantity, TradingRules, multiplyDecimal, prepareHarvesterStartupState, startHarvester, resolveHarvesterOptions, createRecoverySellerStopWorkflow, createFileOperationalStateStore, recordConfigurationBaseline, recordProcessStarted, recordProcessStopped, createBinanceBrokerAdapter, assertRecoverySellerEvaluatorConfigured, assertRecoverySellerRuntimeAcceptance }

export const testEventPublisher = Object.freeze({
  publish: () => ({ ok: true }),
  flush: async () => ({
    ok: true,
    durable: true
  }),
})
                                                                                                
        
                                          
                                        
                                     

// Include the source file in every reporter test name so failures are identifiable
// even when the spec reporter output is copied without its surrounding file header.

export async function waitForTestSignal(...args) {
  const [promise, label, getDiagnostics, timeoutMs = 15_000] = args
  let timeout
  try {
    await Promise.race([
      promise,
      new Promise((...executorArgs) => {
        const [, reject] = executorArgs
        timeout = setTimeout(() => {
          reject(new Error(
            `${label  } was not observed within ${  timeoutMs  }ms; diagnostics: ${ 
            JSON.stringify(getDiagnostics())}`,
          ))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

export const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: { enabled: true },
        aggressive: { enabled: false }
      },
      pairs: {
        BTCUSDT: {
          enabled: true,
          tradingEnvironment: "both",
          enableVolatilityProtection: true,
          investment: 100,
          orderQuantity: 0.01,
          keepQuantity: 0.001,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 2,
          quantityPrecision: 3,
          makerPercent: 0,
          takerPercent: 0,
        },
        ETHUSDT: {
          enabled: false,
          tradingEnvironment: "both",
          enableVolatilityProtection: true,
          investment: 100,
          orderQuantity: 0.1,
          keepQuantity: 0.001,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 2,
          quantityPrecision: 3,
          makerPercent: 0,
          takerPercent: 0,
        },
      },
    },
  },
}

export const withExternalOrdersPolicy = (...args) => {
  const [symbol, externalOrdersPolicy] = args
  return {
  ...appConfig,
  strategies: {
    ...appConfig.strategies,
    CG_coinGrabber: {
      ...appConfig.strategies.CG_coinGrabber,
      pairs: {
        ...appConfig.strategies.CG_coinGrabber.pairs,
        [symbol]: {
          ...appConfig.strategies.CG_coinGrabber.pairs[symbol],
          externalOrdersPolicy,
        },
      },
    },
  },
  }
}

export function createMarketTradingRules({ market, baseAsset, quoteAsset }) {
  const constraints = [
    { type: "PRICE_INCREMENT",
      status: "SUPPORTED",
      value: new Money({ amount: "0.01",
        asset: quoteAsset }) },
    { type: "QUANTITY_INCREMENT",
      status: "SUPPORTED",
      value: new Quantity({ amount: "0.001",
        asset: baseAsset }) },
    { type: "MIN_QUANTITY",
      status: "SUPPORTED",
      value: new Quantity({ amount: "0.001",
        asset: baseAsset }) },
    { type: "MIN_NOTIONAL",
      status: "SUPPORTED",
      value: new Money({ amount: "5",
        asset: quoteAsset }) },
  ]
  return new TradingRules({ market,
    constraints })
}

export const createMarketMetadata = (symbol) => {
  const quoteCode = ["USDT", "FDUSD"].find((code) => symbol.endsWith(code))
  if (!quoteCode) {
    throw new Error(`Unsupported test market quote asset for ${symbol}`)
  }
  const baseCode = symbol.slice(0, -quoteCode.length)
  const baseAsset = new Asset({ id: `asset:${baseCode}`,
    code: baseCode })
  const quoteAsset = new Asset({ id: `asset:${quoteCode}`,
    code: quoteCode })
  const market = new Market({ venue: "binance",
    symbol,
    baseAsset,
    quoteAsset })
  return {
    market,
    tradingRules: createMarketTradingRules({ market,
      baseAsset,
      quoteAsset }),
    supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
    unvalidatedConstraints: [],
  }
}

export const createOpenOrderSnapshot = ({ order }) => {
  const openOrder = new Order({
    symbol: order.market.symbol,
    type: order.type,
    side: order.side,
    quantity: Number(order.originalQuantity.amount) - Number(order.executedQuantity.amount),
    price: Number(order.limitPrice.amount),
    id: order.brokerOrderId,
    clientOrderId: order.clientOrderId,
  })
  openOrder.originalPrice = order.limitPrice.amount
  openOrder.originalQuantity = order.originalQuantity.amount
  openOrder.executedQuantity = order.executedQuantity.amount
  openOrder.status = order.status === "OPEN" ? "NEW" : "PARTIALLY_FILLED"
  return openOrder
}

export const createBinanceCapabilities = ({ tradingMode = "testnet" } = {}) => Object.freeze({
  contractVersion: 1,
  provider: "binance",
  product: "spot",
  environment: Object.freeze({
    selector: "tradingMode",
    supportedModes: Object.freeze(["testnet", "live"]),
    selectedMode: tradingMode,
    nodeEnvSelectsEndpoint: false,
  }),
})

export function createBrokerTestState({ externalOpenOrders }) {
  return {
    subscriptions: new Map(),
    bookSubscriptions: new Map(),
    fillHistoryByOrder: new Map(),
    canonicalOrdersByBrokerId: new Map(),
    externalOpenOrders,
    userDataHandlers: undefined,
    accountSnapshotTime: 0,
  }
}

export function createBrokerOrderPorts({ state }) {
  return {
    placeOrder: async () => ({
      ok: true,
    }),
    cancelOrder: async ({ order } = {}) => {
      const canceledOrder = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: order.brokerOrderId,
        market: order.market,
        side: order.side,
        type: order.type,
        limitPrice: order.limitPrice,
        originalQuantity: order.originalQuantity,
        executedQuantity: order.executedQuantity,
        status: "CANCELED",
        createdAt: order.createdAt,
        acknowledgedAt: order.acknowledgedAt,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      })
      state.canonicalOrdersByBrokerId.set(order.brokerOrderId, canceledOrder)
      return {
        ok: true,
        data: canceledOrder,
      }
    },
    getOpenOrders: async ({ symbol } = {}) => ({
      ok: true,
      data: [
        ...state.externalOpenOrders.filter((order) => !symbol || order.symbol === symbol),
        ...[...state.canonicalOrdersByBrokerId.values()]
          .filter((order) => ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
          .filter((order) => !symbol || order.market.symbol === symbol)
          .map((order) => createOpenOrderSnapshot({
            order,
          })),
      ],
    }),
    getFills: async ({ orderId }) => ({
      ok: true,
      data: state.fillHistoryByOrder.get(String(orderId)) ?? [],
    }),
    getCanonicalOrderHistory: async ({ orderId, symbol } = {}) => ({
      ok: true,
      data: [...state.canonicalOrdersByBrokerId.values()].filter((order) =>
        (!orderId || order.brokerOrderId === String(orderId)) &&
        (!symbol || order.market.symbol === symbol)),
    }),
    getCanonicalOrder: async () => ({
      ok: false,
      errors: [new Error("order not found")],
    }),
  }
}

export function createBrokerAccountPorts({ calls, state }) {
  return {
    getAccountSnapshot: async () => {
      calls.push("account:snapshot")
      state.accountSnapshotTime += 1
      const balances = ["BTC", "ETH", "USDT"].map((code) => {
        const asset = new Asset({
          id: `asset:${  code}`,
          code,
        })
        return new Balance({
          free: new Quantity({
            amount: "1000",
            asset,
          }),
          locked: new Quantity({
            amount: "0",
            asset,
          }),
        })
      })
      return {
        ok: true,
        data: {
          balances,
          sourceTime: state.accountSnapshotTime,
        },
      }
    },
    getExchangeMarkets: async () => ({
      ok: true,
      data: [],
    }),
    getSymbolFilters: async ({ symbol }) => {
      calls.push(`filters:${  symbol}`)
      return {
        ok: true,
        data: createMarketMetadata(symbol),
      }
    },
    getPrices: async ({ symbol }) => ({
      ok: true,
      data: {
        symbol,
        price: "65000",
      },
    }),
  }
}

export function createBrokerCandlePorts() {
  return {
    getCandles: async () => ({
      ok: true,
      data: [],
    }),
    subscribeForCandles: async () => ({
      ok: true,
      data: {
        unsubscribe: async () => {},
      },
    }),
  }
}

export function createBrokerPriceStreamPorts({ calls, state, subscribeResult, subscribeResultBySymbol }) {
  return {
    subscribeForPrices: async ({ symbol, onPrice }) => {
      calls.push(`subscribe:${  symbol}`)
      state.subscriptions.set(symbol, onPrice)
      return subscribeResultBySymbol[symbol] ?? subscribeResult ?? {
        ok: true,
        data: {
          unsubscribe: async () => calls.push(`unsubscribe:${  symbol}`),
        },
      }
    },
    subscribeForBookTicker: async ({ symbol, onBookTicker }) => {
      calls.push(`subscribe:book:${  symbol}`)
      state.bookSubscriptions.set(symbol, onBookTicker)
      return {
        ok: true,
        data: {
          unsubscribe: async () => calls.push(`unsubscribe:book:${  symbol}`),
        },
      }
    },
    emitPrice: (...args) => {
      const [symbol, priceEvent] = args
      return state.subscriptions.get(symbol)?.(priceEvent)
    },
    emitBookTicker: (...args) => {
      const [symbol, bookTicker] = args
      return state.bookSubscriptions.get(symbol)?.(bookTicker)
    },
  }
}

export function createBrokerUserDataPorts({ calls, state }) {
  return {
    subscribeForUserData: async (handlers) => {
      calls.push("subscribe:user-data")
      state.userDataHandlers = {
        ...handlers,
        onEvent: (message) => {
          const event = message?.event
          const executedOrder = event?.executedOrder
          if (executedOrder?.brokerOrderId) {
            state.canonicalOrdersByBrokerId.set(executedOrder.brokerOrderId, executedOrder)
          }
          const fill = event?.fill
          if (fill instanceof Fill) {
            const existing = state.fillHistoryByOrder.get(fill.brokerOrderId) ?? []
            if (!existing.some((item) => item.id === fill.id)) {
              state.fillHistoryByOrder.set(fill.brokerOrderId, [...existing, fill])
            }
          }
          return handlers.onEvent(message)
        },
      }
      return {
        ok: true,
        data: {
          disconnect: async () => calls.push("unsubscribe:user-data"),
        },
      }
    },
    emitUserDataEvent: (event) => {
      const fill = event?.fill
      if (fill instanceof Fill) {
        const existing = state.fillHistoryByOrder.get(fill.brokerOrderId) ?? []
        if (!existing.some((item) => item.id === fill.id)) {
          state.fillHistoryByOrder.set(fill.brokerOrderId, [...existing, fill])
        }
      }
      return state.userDataHandlers?.onEvent({
        event,
      })
    },
    emitUserDataStatus: (status) => state.userDataHandlers?.onStatus(status),
  }
}

export const createBroker = (...args) => {
  const [calls = [], options = {}] = args
  const {
    subscribeResult,
    subscribeResultBySymbol = {},
    externalOpenOrders = [],
    tradingMode = "testnet",
  } = options
  const state = createBrokerTestState({
    externalOpenOrders,
  })
  return {
    capabilities: createBinanceCapabilities({ tradingMode }),
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    ...createBrokerOrderPorts({
      state,
    }),
    ...createBrokerAccountPorts({
      calls,
      state,
    }),
    ...createBrokerCandlePorts(),
    ...createBrokerPriceStreamPorts({
      calls,
      state,
      subscribeResult,
      subscribeResultBySymbol,
    }),
    ...createBrokerUserDataPorts({
      calls,
      state,
    }),
  }
}

export const makeVolatilityReadyBroker = (...args) => {
  const [broker, symbols = ["BTCUSDT"]] = args
  const createCandle = ({
    symbol,
    openTime
  } = {}) => ({
    symbol,
    interval: "1m",
    openTime,
    closeTime: openTime + 59_999,
    open: "1",
    high: "1.1",
    low: "0.9",
    close: "1",
    volume: "1",
    isClosed: true,
  })
  broker.getCandles = async ({
    symbol,
    limit
  } = {}) => ({
    ok: true,
    data: symbols.includes(symbol)
      ? Array.from({ length: Math.min(limit ?? 100, 100) }, (...callbackArgs) => {
        const [, index] = callbackArgs
        return createCandle({
          symbol,
          openTime: index * 60_000
        })
      })
      : [],
  })
  broker.subscribeForCandles = async ({
    symbol,
    interval,
    onCandle
  } = {}) => {
    if (symbols.includes(symbol)) {
      for (const index of [100, 101, 102]) {
        await onCandle(createCandle({
          symbol,
          openTime: index * 60_000
        }))
      }
    }
    return {
      ok: true,
      data: {
        stream: `${symbol.toLowerCase()  }@kline_${  interval}`,
        unsubscribe: async () => {}
      },
    }
  }
  return broker
}

export const binanceEnv = {
  NODE_ENV: "test",
  TRADING_MODE: "testnet",
  BINANCE_API_KEY: "key",
  BINANCE_API_SECRET_KEY: "secret",
}

export const startHarvesterForTest = (input = {}) => {
  const eventPublisher = input.eventPublisher ?? testEventPublisher
  if (eventPublisher !== testEventPublisher && typeof eventPublisher.flush !== "function") {
    eventPublisher.flush = testEventPublisher.flush
  }
  return startHarvester({
    ...input,
    env: {
      ...binanceEnv,
      ...input.env
    },
    brokerAdapterFactory: input.brokerAdapterFactory ?? (({ config: brokerConfig } = {}) =>
      createBroker([], { tradingMode: brokerConfig.tradingMode })),
    eventPublisher,
  })
}

export const createFill = ({
  tradeId = "trade-1",
  quantity = "0.01"
} = {}) => {
  const baseAsset = new Asset({
    id: "asset:BTC",
    code: "BTC"
  })
  const quoteAsset = new Asset({
    id: "asset:USDT",
    code: "USDT"
  })
  const market = new Market({
    venue: "binance",
    symbol: "BTCUSDT",
    baseAsset,
    quoteAsset
  })
  return new Fill({
    tradeId,
    brokerOrderId: `order-${  tradeId}`,
    market,
    side: "BUY",
    price: new Money({
      amount: "65000",
      asset: quoteAsset
    }),
    quantity: new Quantity({
      amount: quantity,
      asset: baseAsset
    }),
    quoteQuantity: new Money({
      amount: "650",
      asset: quoteAsset
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
}

export async function createPriorProcessHistory({ directory, runtimeSessionId, priorAppConfig, clean = false } = {}) {
  const store = createFileOperationalStateStore({
    directory,
    runtimeSessionId,
  })
  const initialization = await store.initialize()
  assert.equal(initialization.ok, true, "the prior process history fixture must start from a valid durable ledger")
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: store,
    appConfig: priorAppConfig,
  })
  assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
  const started = await recordProcessStarted({
    operationalStateStore: store,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(started.ok, true, started.errors?.[0]?.message)
  if (clean) {
    const stopped = await recordProcessStopped({
      operationalStateStore: store,
      reason: "CLEAN_TEST_SHUTDOWN",
      clean: true,
    })
    assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  }
}
