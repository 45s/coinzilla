import assert from "node:assert/strict"
import test from "node:test"
import {
  Asset,
  Balance,
  CanonicalOrder,
  Fill,
  Market,
  Money,
  Quantity,
  TradingRules,
} from "@coinzilla/entities"
import { resolveProviderInstances } from "./resolve-provider-instances.js"
import { startProviderAccounts } from "./start-provider-accounts.js"
import { startHarvester } from "../start-harvester.js"

const testEventPublisher = Object.freeze({
  publish: () => ({
    ok: true,
  }),
  flush: async () => ({
    ok: true,
    durable: true,
  }),
})

const appConfig = {
  strategies: {
    CG_coinGrabber: {
      enabled: true,
      settings: {
        conservative: {
          enabled: true,
        },
        aggressive: {
          enabled: false,
        },
      },
      pairs: {
        BTCUSDT: {
          enabled: true,
          tradingEnvironment: "both",
          enableVolatilityProtection: false,
          investment: 1000,
          orderQuantity: 1,
          keepQuantity: 0.001,
          minProfit: 0.01,
          priceStepPercent: 0.05,
          pricePrecision: 2,
          quantityPrecision: 3,
          makerPercent: 0,
          takerPercent: 0,
        },
        ETHUSDT: {
          enabled: true,
          tradingEnvironment: "both",
          enableVolatilityProtection: true,
          investment: 1000,
          orderQuantity: 1,
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

function createMarketTradingRules({
  market,
  baseAsset,
  quoteAsset,
}) {
  return new TradingRules({
    market,
    constraints: [
      {
        type: "PRICE_INCREMENT",
        status: "SUPPORTED",
        value: new Money({
          amount: "0.01",
          asset: quoteAsset,
        }),
      },
      {
        type: "QUANTITY_INCREMENT",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.001",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
          amount: "0.001",
          asset: baseAsset,
        }),
      },
      {
        type: "MIN_NOTIONAL",
        status: "SUPPORTED",
        value: new Money({
          amount: "5",
          asset: quoteAsset,
        }),
      },
    ],
  })
}

function createMarketMetadata(symbol) {
  const baseCode = symbol.startsWith("ETH") ? "ETH" : "BTC"
  const baseAsset = new Asset({
    id: `asset:${baseCode}`,
    code: baseCode,
  })
  const quoteAsset = new Asset({
    id: "asset:USDT",
    code: "USDT",
  })
  const market = new Market({
    venue: "binance",
    symbol,
    baseAsset,
    quoteAsset,
  })
  return {
    market,
    tradingRules: createMarketTradingRules({
      market,
      baseAsset,
      quoteAsset,
    }),
    supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
    unvalidatedConstraints: [],
  }
}

function createBinanceCapabilities({
  tradingMode,
}) {
  return Object.freeze({
    contractVersion: 1,
    provider: "binance",
    product: "spot",
    environment: Object.freeze({
      selector: "tradingMode",
      supportedModes: Object.freeze(["testnet", "live"]),
      selectedMode: tradingMode,
      nodeEnvSelectsEndpoint: false,
    }),
    getStatus: () => "SUPPORTED",
  })
}

function createAccountSnapshot() {
  const balances = ["BTC", "ETH", "USDT"].map((code) => {
    const asset = new Asset({
      id: `asset:${code}`,
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
    balances,
    sourceTime: Date.now(),
  }
}

function createBrokerAccountPorts({
  calls,
}) {
  return {
    getAccountSnapshot: async () => {
      calls.push("account:snapshot")
      return {
        ok: true,
        data: createAccountSnapshot(),
      }
    },
    getExchangeMarkets: async () => ({
      ok: true,
      data: [],
    }),
    getSymbolFilters: async ({ symbol }) => ({
      ok: true,
      data: createMarketMetadata(symbol),
    }),
    getPrices: async ({ symbol }) => ({
      ok: true,
      data: {
        symbol,
        price: "65000",
      },
    }),
  }
}

function createAcknowledgedCanonicalOrder({ order, calls }) {
  const { market } = createMarketMetadata(order.symbol)
  const now = Date.now()
  return new CanonicalOrder({
    clientOrderId: order.clientOrderId,
    brokerOrderId: `${order.symbol}-${calls.orders.size + 1}`,
    market,
    side: order.side,
    type: order.type,
    limitPrice: new Money({
      amount: order.price,
      asset: market.quoteAsset,
    }),
    originalQuantity: new Quantity({
      amount: order.quantity,
      asset: market.baseAsset,
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: market.baseAsset,
    }),
    status: "OPEN",
    createdAt: now,
    acknowledgedAt: now,
    updatedAt: now,
  })
}

function createCanceledCanonicalOrder(order) {
  const now = Date.now()
  return new CanonicalOrder({
    ...order,
    status: "CANCELED",
    updatedAt: now,
    completedAt: now,
  })
}

function findCanonicalOrder({ calls, clientOrderId, orderId }) {
  return [...calls.orders.values()].find((candidate) =>
    (clientOrderId && candidate.clientOrderId === clientOrderId) ||
    (orderId && candidate.brokerOrderId === orderId)
  )
}

function createBrokerOrderPorts({ calls }) {
  return {
    placeOrder: async ({ order }) => {
      calls.push(`place:${order.symbol}`)
      const acknowledgedOrder = createAcknowledgedCanonicalOrder({
        order,
        calls,
      })
      calls.orders.set(order.clientOrderId, acknowledgedOrder)
      return {
        ok: true,
        data: acknowledgedOrder,
      }
    },
    cancelOrder: async ({ order }) => {
      calls.push(`cancel:${order.market.symbol}`)
      const canceledOrder = createCanceledCanonicalOrder(order)
      calls.orders.set(order.clientOrderId, canceledOrder)
      return {
        ok: true,
        data: canceledOrder,
      }
    },
    getOpenOrders: async () => ({
      ok: true,
      data: [...calls.orders.values()].filter((order) =>
        ["OPEN", "PARTIALLY_FILLED"].includes(order.status)
      ),
    }),
    getFills: async ({ symbol } = {}) => ({
      ok: true,
      data: calls.fills.filter((fill) => !symbol || fill.market.symbol === symbol),
    }),
    getCanonicalOrderHistory: async ({ symbol } = {}) => ({
      ok: true,
      data: [...calls.orders.values()].filter((order) =>
        !symbol || order.market.symbol === symbol
      ),
    }),
    getCanonicalOrder: async ({ clientOrderId, orderId } = {}) => {
      const order = findCanonicalOrder({
        calls,
        clientOrderId,
        orderId,
      })
      return order
        ? {
          ok: true,
          data: order,
        }
        : {
          ok: false,
          errors: [new Error("order not found")],
        }
    },
  }
}

function createBrokerMarketDataPorts({
  calls,
}) {
  return {
    getCandles: async ({ symbol }) => {
      calls.push(`candles:${symbol}`)
      return { ok: true,
  data: [] }
    },
    subscribeForCandles: async ({ symbol }) => {
      calls.push(`subscribe:candles:${symbol}`)
      return {
        ok: true,
        data: {
          unsubscribe: async () => calls.push(`unsubscribe:candles:${symbol}`),
        },
      }
    },
    subscribeForPrices: async ({ symbol,
  onPrice }) => {
      calls.push(`subscribe:${symbol}`)
      calls.priceHandlers.set(symbol, onPrice)
      return {
        ok: true,
        data: {
          unsubscribe: async () => calls.push(`unsubscribe:${symbol}`),
        },
      }
    },
    subscribeForBookTicker: async ({ symbol,
  onBookTicker }) => {
      calls.push(`subscribe:book:${symbol}`)
      await onBookTicker({
        symbol,
        bestBidPrice: "99",
        bestBidQuantity: "10",
        bestAskPrice: "101",
        bestAskQuantity: "10",
        timestamp: Date.now(),
      })
      return {
        ok: true,
        data: {
          unsubscribe: async () => calls.push(`unsubscribe:book:${symbol}`),
        },
      }
    },
  }
}

function createBrokerUserDataPorts({
  calls,
}) {
  return {
    subscribeForUserData: async ({ onEvent }) => {
      calls.push("subscribe:user-data")
      calls.userDataHandler = onEvent
      return {
        ok: true,
        data: {
          disconnect: async () => calls.push("unsubscribe:user-data"),
        },
      }
    },
  }
}

function createBroker({
  calls,
  tradingMode,
}) {
  return {
    capabilities: createBinanceCapabilities({
      tradingMode,
    }),
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    ...createBrokerAccountPorts({
      calls,
    }),
    ...createBrokerOrderPorts({ calls }),
    ...createBrokerMarketDataPorts({
      calls,
    }),
    ...createBrokerUserDataPorts({
      calls,
    }),
  }
}

function createMultiAccountHarvesterConfig() {
  return {
    ...appConfig,
    marketDataRouting: {
      routes: [
        { symbol: "BTCUSDT",
  providerInstanceId: "binance-testnet-primary" },
        { symbol: "ETHUSDT",
  providerInstanceId: "binance-testnet-secondary" },
      ],
    },
    executionRouting: {
      routes: [
        { strategyId: "CG_coinGrabber",
  symbol: "BTCUSDT",
  providerInstanceId: "binance-testnet-secondary" },
        { strategyId: "CG_coinGrabber",
  symbol: "ETHUSDT",
  providerInstanceId: "binance-testnet-primary" },
      ],
    },
    brokers: {
      instances: [
        {
          providerInstanceId: "binance-testnet-primary",
          providerType: "binance",
          accountId: "account-primary",
          environment: "testnet",
          credentials: {
            apiKeyEnv: "PRIMARY_API_KEY",
            apiSecretEnv: "PRIMARY_API_SECRET",
          },
        },
        {
          providerInstanceId: "binance-testnet-secondary",
          providerType: "binance",
          accountId: "account-secondary",
          environment: "testnet",
          credentials: {
            apiKeyEnv: "SECONDARY_API_KEY",
            apiSecretEnv: "SECONDARY_API_SECRET",
          },
        },
      ],
    },
  }
}

function createMultiAccountHarvesterEnvironment() {
  return {
    NODE_ENV: "test",
    TRADING_MODE: "testnet",
    PRIMARY_API_KEY: "primary-key",
    PRIMARY_API_SECRET: "primary-secret",
    SECONDARY_API_KEY: "secondary-key",
    SECONDARY_API_SECRET: "secondary-secret",
  }
}

function createMultiAccountAdapterFactories({
  primaryCalls,
  secondaryCalls,
}) {
  return {
    binance: ({ config }) => createBroker({
      calls: config.apiKey === "primary-key" ? primaryCalls : secondaryCalls,
      tradingMode: config.tradingMode,
    }),
  }
}

async function startMultiAccountRuntime({
  configuredAppConfig,
  env,
  primaryCalls,
  secondaryCalls,
  eventPublisher = testEventPublisher,
  onUserDataEvent,
}) {
  const providers = resolveProviderInstances({
    appConfig: configuredAppConfig,
    env,
    adapterFactories: createMultiAccountAdapterFactories({
      primaryCalls,
      secondaryCalls,
    }),
  })
  return startProviderAccounts({
    providers,
    start: async (input) => {
      if (input.providerIdentity.accountId === "account-primary") {
        assert.equal(input.env.PRIMARY_API_KEY, "primary-key")
        assert.equal(input.env.SECONDARY_API_KEY, undefined)
      } else {
        assert.equal(input.env.PRIMARY_API_KEY, undefined)
        assert.equal(input.env.SECONDARY_API_KEY, "secondary-key")
      }
      return startHarvester({
        ...input,
        onUserDataEvent,
      })
    },
    appConfig: configuredAppConfig,
    env,
    eventPublisher,
  })
}

function assertIndependentAccountRuntimes({
  runtime,
  primaryCalls,
  secondaryCalls,
}) {
  assert.equal(runtime.providerAccounts.length, 2)
  assert.deepEqual(runtime.providerAccounts.map(({ accountId }) => accountId), [
    "account-primary",
    "account-secondary",
  ])
  assert.equal(runtime.accountRuntimes.length, 2)
  assert.notEqual(runtime.accountRuntimes[0].recoveredState, runtime.accountRuntimes[1].recoveredState)
  assert.notEqual(runtime.accountRuntimes[0].recoveredState.orderRegistry, runtime.accountRuntimes[1].recoveredState.orderRegistry)
  assert.deepEqual(runtime.providerAccounts.map(({ executionSymbols }) => executionSymbols), [
    ["ETHUSDT"],
    ["BTCUSDT"],
  ])
  assert.deepEqual(runtime.providerAccounts.map(({ marketDataSources }) => marketDataSources), [
    { ETHUSDT: "binance-testnet-secondary" },
    { BTCUSDT: "binance-testnet-primary" },
  ])
  assert.notEqual(runtime.accountRuntimes[0].getMarketMetadata({ symbol: "ETHUSDT" }), runtime.accountRuntimes[1].getMarketMetadata({ symbol: "ETHUSDT" }))
  assert.notEqual(runtime.accountRuntimes[0].getMarketMetadata({ symbol: "BTCUSDT" }), runtime.accountRuntimes[1].getMarketMetadata({ symbol: "BTCUSDT" }))
  assert.equal(runtime.accountRuntimes.every((accountRuntime) => accountRuntime.userDataReady), true)
  assert.equal(primaryCalls.filter((call) => call === "subscribe:BTCUSDT").length, 1)
  assert.equal(primaryCalls.filter((call) => call === "subscribe:book:BTCUSDT").length, 1)
  assert.equal(primaryCalls.includes("subscribe:ETHUSDT"), false)
  assert.equal(primaryCalls.includes("subscribe:book:ETHUSDT"), false)
  assert.equal(secondaryCalls.filter((call) => call === "subscribe:ETHUSDT").length, 1)
  assert.equal(secondaryCalls.filter((call) => call === "subscribe:book:ETHUSDT").length, 1)
  assert.equal(secondaryCalls.includes("subscribe:BTCUSDT"), false)
  assert.equal(secondaryCalls.includes("subscribe:book:BTCUSDT"), false)
  assert.equal(secondaryCalls.filter((call) => call === "subscribe:candles:ETHUSDT").length, 1)
  assert.equal(primaryCalls.includes("subscribe:user-data"), true)
  assert.equal(secondaryCalls.includes("subscribe:user-data"), true)
}

function createBrokerCalls() {
  const calls = []
  calls.orders = new Map()
  calls.fills = []
  calls.priceHandlers = new Map()
  calls.userDataHandler = undefined
  return calls
}

test("starts independent account runtimes through the real Harvester bootstrap", async () => {
  const primaryCalls = createBrokerCalls()
  const secondaryCalls = createBrokerCalls()
  const configuredAppConfig = createMultiAccountHarvesterConfig()
  const env = createMultiAccountHarvesterEnvironment()
  const runtime = await startMultiAccountRuntime({
    configuredAppConfig,
    env,
    primaryCalls,
    secondaryCalls,
  })
  try {
    assertIndependentAccountRuntimes({
      runtime,
      primaryCalls,
      secondaryCalls,
    })
    assert.equal(primaryCalls.filter((call) => call === "connect").length, 1)
    assert.equal(secondaryCalls.filter((call) => call === "connect").length, 1)
  } finally {
    await runtime.stop()
  }
  assert.equal(primaryCalls.filter((call) => call === "disconnect").length, 1)
  assert.equal(secondaryCalls.filter((call) => call === "disconnect").length, 1)
})

function createUserDataProcessedSignal() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return {
    promise,
    resolve,
  }
}

function assertMultiAccountMarketDataRouting({
      primaryCalls,
      secondaryCalls,
      primaryRuntime,
    }) {
  assert.equal(typeof primaryCalls.priceHandlers.get("BTCUSDT"), "function")
  assert.equal(typeof secondaryCalls.priceHandlers.get("ETHUSDT"), "function")
  assert.equal(secondaryCalls.includes("candles:ETHUSDT"), true)
  assert.equal(secondaryCalls.filter((call) => call === "subscribe:candles:ETHUSDT").length, 1)
  const source = primaryRuntime.getVolatilityData({ symbol: "ETHUSDT" }).data
  assert.deepEqual({
    providerInstanceId: source.providerInstanceId,
    providerType: source.providerType,
    accountId: source.accountId,
    environment: source.environment,
  }, {
    providerInstanceId: "binance-testnet-secondary",
    providerType: "binance",
    accountId: "account-secondary",
    environment: "testnet",
  })
}

async function submitAndResolveRoutedOrder({
  primaryCalls,
  secondaryCalls,
  secondaryRuntime,
}) {
  await primaryCalls.priceHandlers.get("BTCUSDT")({
    symbol: "BTCUSDT",
    price: "100",
    timestamp: Date.now(),
  })
  assert.equal(secondaryCalls.filter((call) => call === "place:BTCUSDT").length, 1)
  assert.equal(primaryCalls.filter((call) => call === "place:BTCUSDT").length, 0)
  const [acknowledgedOrder] = [...secondaryCalls.orders.values()]
  assert.ok(acknowledgedOrder)
  const registeredOrder = secondaryRuntime.recoveredState.orderRegistry.getOrder({
    clientOrderId: acknowledgedOrder.clientOrderId,
  })
  assert.equal(registeredOrder.providerInstanceId, "binance-testnet-secondary")
  assert.equal(registeredOrder.accountId, "account-secondary")
  return registeredOrder
}

function createPartialFill({ registeredOrder }) {
  const filledQuantity = new Quantity({
    amount: "0.1",
    asset: registeredOrder.market.baseAsset,
  })
  const partiallyFilledOrder = new CanonicalOrder({
    ...registeredOrder,
    executedQuantity: filledQuantity,
    status: "PARTIALLY_FILLED",
    updatedAt: Date.now() + 1,
  })
  const fill = new Fill({
    tradeId: "btc-fill-1",
    brokerOrderId: registeredOrder.brokerOrderId,
    clientOrderId: registeredOrder.clientOrderId,
    providerInstanceId: registeredOrder.providerInstanceId,
    providerType: registeredOrder.providerType,
    accountId: registeredOrder.accountId,
    market: registeredOrder.market,
    side: registeredOrder.side,
    price: new Money({
      amount: "100",
      asset: registeredOrder.market.quoteAsset,
    }),
    quantity: filledQuantity,
    quoteQuantity: new Money({
      amount: "10",
      asset: registeredOrder.market.quoteAsset,
    }),
    executedAt: Date.now() + 2,
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  return {
    partiallyFilledOrder,
    fill,
  }
}

async function processRoutedUserDataFill({
  secondaryCalls,
  secondaryRuntime,
  primaryRuntime,
  registeredOrder,
  userDataProcessed,
}) {
  const { partiallyFilledOrder, fill } = createPartialFill({ registeredOrder })
  secondaryCalls.fills.push(fill)
  secondaryCalls.userDataHandler({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: partiallyFilledOrder,
      fill,
    },
  })
  await userDataProcessed
  assert.equal(
    secondaryRuntime.portfolio.getPosition({ symbol: "BTCUSDT" })?.baseQuantity.amount,
    "0.1",
  )
  assert.equal(primaryRuntime.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined)
}

test("routes order submission, user-data fills, cancellation, and candle data to their configured account/source", async () => {
  const primaryCalls = createBrokerCalls()
  const secondaryCalls = createBrokerCalls()
  const userDataSignal = createUserDataProcessedSignal()
  const runtime = await startMultiAccountRuntime({
    configuredAppConfig: createMultiAccountHarvesterConfig(),
    env: createMultiAccountHarvesterEnvironment(),
    primaryCalls,
    secondaryCalls,
    onUserDataEvent: async ({ event }) => {
      if (event?.executionType === "TRADE") {
        userDataSignal.resolve(event)
      }
    },
  })
  const [primaryRuntime, secondaryRuntime] = runtime.accountRuntimes

  try {
    assertMultiAccountMarketDataRouting({ primaryCalls, secondaryCalls, primaryRuntime })
    const registeredOrder = await submitAndResolveRoutedOrder({
      primaryCalls,
      secondaryCalls,
      secondaryRuntime,
    })
    await processRoutedUserDataFill({
      secondaryCalls,
      secondaryRuntime,
      primaryRuntime,
      registeredOrder,
      userDataProcessed: userDataSignal.promise,
    })
  } finally {
    const stopped = await runtime.stop()
    assert.equal(stopped.ok, true)
  }

  assert.equal(secondaryCalls.filter((call) => call === "cancel:BTCUSDT").length, 1)
  assert.equal(primaryCalls.filter((call) => call === "cancel:BTCUSDT").length, 0)
})
