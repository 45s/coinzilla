import assert from "node:assert/strict"
import test from "node:test"
import {
  Asset,
  Balance,
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
  const baseAsset = new Asset({
    id: "asset:BTC",
    code: "BTC",
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
  })
}

function createAccountSnapshot() {
  const balances = ["BTC", "USDT"].map((code) => {
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

function createBrokerOrderPorts() {
  return {
    placeOrder: async () => ({
      ok: true,
    }),
    cancelOrder: async () => ({
      ok: true,
    }),
    getOpenOrders: async () => ({
      ok: true,
      data: [],
    }),
    getFills: async () => ({
      ok: true,
      data: [],
    }),
    getCanonicalOrderHistory: async () => ({
      ok: true,
      data: [],
    }),
    getCanonicalOrder: async () => ({
      ok: false,
      errors: [new Error("order not found")],
    }),
  }
}

function createBrokerMarketDataPorts({
  calls,
}) {
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
    subscribeForPrices: async ({ symbol }) => {
      calls.push(`subscribe:${symbol}`)
      return {
        ok: true,
        data: {
          unsubscribe: async () => calls.push(`unsubscribe:${symbol}`),
        },
      }
    },
    subscribeForBookTicker: async ({ symbol }) => {
      calls.push(`subscribe:book:${symbol}`)
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
    subscribeForUserData: async () => {
      calls.push("subscribe:user-data")
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
    ...createBrokerOrderPorts(),
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
      return startHarvester(input)
    },
    appConfig: configuredAppConfig,
    env,
    eventPublisher: testEventPublisher,
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
  assert.notEqual(runtime.accountRuntimes[0].getMarketMetadata({ symbol: "BTCUSDT" }), runtime.accountRuntimes[1].getMarketMetadata({ symbol: "BTCUSDT" }))
  assert.equal(runtime.accountRuntimes.every((accountRuntime) => accountRuntime.userDataReady), true)
  assert.equal(primaryCalls.includes("subscribe:user-data"), true)
  assert.equal(secondaryCalls.includes("subscribe:user-data"), true)
}

test("starts independent account runtimes through the real Harvester bootstrap", async () => {
  const primaryCalls = []
  const secondaryCalls = []
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
