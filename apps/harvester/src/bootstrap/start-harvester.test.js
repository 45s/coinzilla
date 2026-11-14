import nodeTest from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { Asset, Balance, CanonicalOrder, Fill, Market, Money, Order, Quantity, TradingRules } from "@coinzilla/entities"
import { multiplyDecimal } from "@coinzilla/utils"
import { startHarvester } from "./start-harvester.js"
import { createFileOperationalStateStore } from "../infrastructure/operational-state/create-file-operational-state-store.js"
import { recordConfigurationBaseline } from "../use-cases/record-configuration-baseline.js"
import { recordProcessStarted } from "../use-cases/record-process-started.js"
import { recordProcessStopped } from "../use-cases/record-process-stopped.js"
const testEventPublisher = Object.freeze({
  publish: () => ({ ok: true }),
  flush: async () => ({
    ok: true,
    durable: true
  }),
})
const startHarvesterForTest = (input = {}) => {
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
    brokerAdapterFactory: input.brokerAdapterFactory ?? (() => createBroker()),
    eventPublisher,
  })
}

import { createBinanceBrokerAdapter } from "../infrastructure/brokers/binance-broker-adapter.js"

// Include the source file in every reporter test name so failures are identifiable
// even when the spec reporter output is copied without its surrounding file header.
const test = (name, ...args) => nodeTest(`[start-harvester.test.js] ${name}`, ...args)

async function waitForTestSignal(promise, label, getDiagnostics, timeoutMs = 15_000) {
  let timeout
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(
            label + " was not observed within " + timeoutMs + "ms; diagnostics: " +
            JSON.stringify(getDiagnostics()),
          ))
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
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
const withExternalOrdersPolicy = (symbol, externalOrdersPolicy) => ({
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
})
const createMarketMetadata = (symbol) => {
  const quoteCode = ["USDT", "FDUSD"].find((code) => symbol.endsWith(code))
  if (!quoteCode) {throw new Error("Unsupported test market quote asset for " + symbol)}
  const baseCode = symbol.slice(0, -quoteCode.length)
  const baseAsset = new Asset({
    id: "asset:" + baseCode,
    code: baseCode
  })
  const quoteAsset = new Asset({
    id: "asset:" + quoteCode,
    code: quoteCode
  })
  const market = new Market({
    venue: "binance",
    symbol,
    baseAsset,
    quoteAsset,
  })
  const tradingRules = new TradingRules({
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
        amount: "0.001",
        asset: baseAsset
      })
      },
      {
        type: "MIN_QUANTITY",
        status: "SUPPORTED",
        value: new Quantity({
        amount: "0.001",
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
  })
  return {
    market,
    tradingRules,
    supportedOrderTypes: ["LIMIT", "LIMIT_MAKER"],
    unvalidatedConstraints: [],
  }
}
const createOpenOrderSnapshot = ({ order }) => {
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
const createBroker = (calls = [], {
  subscribeResult,
  subscribeResultBySymbol = {},
  externalOpenOrders = [],
} = {}) => {
  const subscriptions = new Map()
  const bookSubscriptions = new Map()
  const fillHistoryByOrder = new Map()
  const canonicalOrdersByBrokerId = new Map()
  let userDataHandlers
  let accountSnapshotTime = 0
  return {
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    placeOrder: async () => ({ ok: true }),
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
      canonicalOrdersByBrokerId.set(order.brokerOrderId, canceledOrder)
      return {
        ok: true,
        data: canceledOrder
      }
    },
    getOpenOrders: async ({ symbol } = {}) => ({
      ok: true,
      data: [
        ...externalOpenOrders.filter((order) => !symbol || order.symbol === symbol),
        ...[...canonicalOrdersByBrokerId.values()]
          .filter((order) => ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
          .filter((order) => !symbol || order.market.symbol === symbol)
          .map((order) => createOpenOrderSnapshot({ order })),
      ],
    }),
    getFills: async ({ orderId }) => ({
      ok: true,
      data: fillHistoryByOrder.get(String(orderId)) ?? []
    }),
    getCanonicalOrderHistory: async ({
      orderId,
      symbol
    } = {}) => ({
      ok: true,
      data: [...canonicalOrdersByBrokerId.values()].filter((order) =>
        (!orderId || order.brokerOrderId === String(orderId)) &&
        (!symbol || order.market.symbol === symbol)),
    }),
    getCanonicalOrder: async () => ({
      ok: false,
      errors: [new Error("order not found")]
    }),
    getAccountSnapshot: async () => {
      calls.push("account:snapshot")
      accountSnapshotTime += 1
      const balances = ["BTC", "ETH", "USDT"].map((code) => {
        const asset = new Asset({
          id: "asset:" + code,
          code
        })
        return new Balance({
          free: new Quantity({
            amount: "1000",
            asset
          }),
          locked: new Quantity({
            amount: "0",
            asset
          }),
        })
      })
      return {
        ok: true,
        data: {
          balances,
          sourceTime: accountSnapshotTime
        },
      }
    },
    getExchangeMarkets: async () => ({
      ok: true,
      data: []
    }),
    getSymbolFilters: async ({ symbol }) => {
      calls.push("filters:" + symbol)
      return {
        ok: true,
        data: createMarketMetadata(symbol)
      }
    },
    getPrices: async ({ symbol }) => ({
      ok: true,
      data: {
      symbol,
      price: "65000"
    }
    }),
    getCandles: async () => ({
      ok: true,
      data: []
    }),
    subscribeForCandles: async () => ({
      ok: true,
      data: { unsubscribe: async () => {} }
    }),
    subscribeForPrices: async ({
      symbol,
      onPrice
    }) => {
      calls.push("subscribe:" + symbol)
      subscriptions.set(symbol, onPrice)
      return subscribeResultBySymbol[symbol] ?? subscribeResult ?? {
        ok: true,
        data: { unsubscribe: async () => calls.push("unsubscribe:" + symbol) },
      }
    },
    subscribeForBookTicker: async ({
      symbol,
      onBookTicker
    }) => {
      calls.push("subscribe:book:" + symbol)
      bookSubscriptions.set(symbol, onBookTicker)
      return {
        ok: true,
        data: { unsubscribe: async () => calls.push("unsubscribe:book:" + symbol) }
      }
    },
    subscribeForUserData: async (handlers) => {
      calls.push("subscribe:user-data")
      userDataHandlers = {
        ...handlers,
        onEvent: (message) => {
          const event = message?.event
          const executedOrder = event?.executedOrder
          if (executedOrder?.brokerOrderId) {
            canonicalOrdersByBrokerId.set(executedOrder.brokerOrderId, executedOrder)
          }
          const fill = event?.fill
          if (fill instanceof Fill) {
            const existing = fillHistoryByOrder.get(fill.brokerOrderId) ?? []
            if (!existing.some((item) => item.id === fill.id)) {
              fillHistoryByOrder.set(fill.brokerOrderId, [...existing, fill])
            }
          }
          return handlers.onEvent(message)
        },
      }
      return {
        ok: true,
        data: { disconnect: async () => calls.push("unsubscribe:user-data") },
      }
    },
    emitUserDataEvent: (event) => {
      const fill = event?.fill
      if (fill instanceof Fill) {
        const existing = fillHistoryByOrder.get(fill.brokerOrderId) ?? []
        if (!existing.some((item) => item.id === fill.id)) {
          fillHistoryByOrder.set(fill.brokerOrderId, [...existing, fill])
        }
      }
      return userDataHandlers?.onEvent({ event })
    },
    emitUserDataStatus: (status) => userDataHandlers?.onStatus(status),
    emitPrice: (symbol, priceEvent) => subscriptions.get(symbol)?.(priceEvent),
    emitBookTicker: (symbol, bookTicker) => bookSubscriptions.get(symbol)?.(bookTicker),
  }
}

const makeVolatilityReadyBroker = (broker, symbols = ["BTCUSDT"]) => {
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
      ? Array.from({ length: Math.min(limit ?? 100, 100) }, (_, index) =>
        createCandle({
          symbol,
          openTime: index * 60_000
        }))
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
        stream: symbol.toLowerCase() + "@kline_" + interval,
        unsubscribe: async () => {}
      },
    }
  }
  return broker
}
const binanceEnv = {
  NODE_ENV: "test",
  TRADING_MODE: "testnet",
  BINANCE_API_KEY: "key",
  BINANCE_API_SECRET_KEY: "secret",
}
const createFill = ({
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
    brokerOrderId: "order-" + tradeId,
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


test("rejects enabled Telegram operator control without a bot token before connecting to Binance", async () => {
  const config = {
    ...appConfig,
    operatorControl: { telegram: {
      enabled: true,
      allowedUserIds: ["12345"]
    } },
  }
  let brokerFactoryCalled = false

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => config,
      env: {
        ...binanceEnv,
        TELEGRAM_BOT_TOKEN: undefined,
        OPERATIONAL_STATE_DIRECTORY: process.cwd()
      },
      brokerAdapterFactory: () => {
        brokerFactoryCalled = true
        throw new Error("Broker connection must not start before operator-control configuration is validated.")
      },
    }),
    (error) => error.code === "OPERATOR_CONTROL_TELEGRAM_TOKEN_REQUIRED",
    "Enabled inbound control must reject missing Telegram credentials before any broker connection is attempted.",
  )

  assert.equal(brokerFactoryCalled, false, "Invalid operator-control configuration must fail before Binance adapter construction.")
})

test("uses the app-local Operational State Store default and fails closed when it is not initialized", async () => {
  const config = {
    ...appConfig,
    operatorControl: { telegram: {
      enabled: true,
      allowedUserIds: ["12345"]
    } },
  }
  let brokerFactoryCalled = false

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => config,
      env: {
        ...binanceEnv,
        TELEGRAM_BOT_TOKEN: "test-telegram-token"
      },
      runtimeSessionId: "telegram-default-directory-session",
      brokerAdapterFactory: () => {
        brokerFactoryCalled = true
        throw new Error("Broker connection must not start before the Operational State Store is verified.")
      },
    }),
    (error) => error.code === "OPERATOR_CONTROL_DURABLE_FACTS_STORE_INVALID",
    "Telegram operator control must use the app-local default Operational State Store and fail closed until it is initialized.",
  )

  assert.equal(brokerFactoryCalled, false, "An uninitialized default Operational State Store must fail before connecting to Binance.")
})

test("verifies the existing Operational State Store before connecting when Telegram operator control is enabled", async () => {
  const config = {
    ...appConfig,
    operatorControl: { telegram: {
      enabled: true,
      allowedUserIds: ["12345"]
    } },
  }
  const calls = []
  let brokerFactoryCalled = false

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => config,
      env: {
        ...binanceEnv,
        TELEGRAM_BOT_TOKEN: "test-telegram-token",
        OPERATIONAL_STATE_DIRECTORY: process.cwd()
      },
      runtimeSessionId: "test-runtime-session",
      createOperationalStateStore: ({
        directory,
        runtimeSessionId
      }) => {
        calls.push({
          type: "create-store",
          directory,
          runtimeSessionId
        })
        return {
          verify: async () => ({
            ok: false,
            errors: [new Error("ledger genesis is missing")]
          }),
          append: async () => ({
            ok: true,
            data: { durable: true }
          }),
        }
      },
      brokerAdapterFactory: () => {
        brokerFactoryCalled = true
        throw new Error("Broker connection must not start when Operational State Store records verification fails.")
      },
    }),
    (error) => error.code === "OPERATOR_CONTROL_DURABLE_FACTS_STORE_INVALID",
    "An absent or invalid initialized ADR-0001 store must prevent inbound operator control and broker startup.",
  )

  assert.equal(calls.length, 1, "Enabled operator control must construct exactly one Operational State Store records adapter for verification.")
  assert.equal(calls[0].runtimeSessionId, "test-runtime-session", "Operational State Store records must be attributed to this Harvester process session.")
  assert.equal(brokerFactoryCalled, false, "Operational State Store records verification must complete before connecting to Binance.")
})

test("retries Telegram adapter shutdown during startup rollback before giving up", async () => {
  const config = {
    ...appConfig,
    operatorControl: { telegram: {
    enabled: true,
    allowedUserIds: ["12345"]
  } }
  }
  const calls = []
  let stopAttempts = 0
  const broker = createBroker(calls)
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      OPERATIONAL_STATE_DIRECTORY: process.cwd()
    },
    runtimeSessionId: "test-runtime-session",
    createOperationalStateStore: () => ({
      runtimeSessionId: "test-runtime-session",
      verify: async () => ({
        ok: true,
        data: {
        valid: true,
        durableWriteSupported: true
      }
      }),
      readAll: async () => ({
        ok: true,
        data: {
          records: [{
            sequence: "0",
            factId: "durable-facts:genesis",
            factType: "LEDGER_INITIALIZED",
            runtimeSessionId: "test-runtime-session",
            data: { schemaVersion: 1 }
          }],
          durableWriteSupported: true,
          lastCommittedSequence: "0",
          lastCommittedDigest: "a".repeat(64),
        },
      }),
      append: async () => ({
        ok: true,
        data: { durable: true }
      }),
    }),
    createTelegramOperatorAdapter: () => ({
      start: async () => { throw new Error("Telegram getMe unauthorized") },
      stop: async () => {
        stopAttempts += 1
        if (stopAttempts === 1) {
          throw new Error("temporary adapter shutdown failure")
        }
        calls.push("telegram-stop-confirmed")
        return { stopped: true }
      },
    }),
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  }), (error) => error.code === "OPERATOR_CONTROL_TELEGRAM_START_FAILED", "Telegram startup must still fail after cleanup is retried.")
  assert.equal(stopAttempts, 2, "The outer startup rollback must retry adapter shutdown when the adapter start rollback could not confirm it.")
  assert.ok(calls.includes("telegram-stop-confirmed"), "The retry must confirm the poller has stopped before broker cleanup completes.")
  assert.ok(calls.includes("disconnect"), "The broker must still be disconnected after failed Telegram startup.")
})

test("requires an explicit TRADING_MODE before connecting to Binance", async () => {
  let brokerFactoryCalled = false
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: { TRADING_MODE: undefined },
    brokerAdapterFactory: () => { brokerFactoryCalled = true; return createBroker() },
  }), /TRADING_MODE must be set to "testnet" or "live"/)
  assert.equal(brokerFactoryCalled, false)
})

test("rejects enabling the deferred Aggressive strategy in app config", async () => {
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => ({
        ...appConfig,
        strategies: {
        ...appConfig.strategies,
        CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        settings: {
        ...appConfig.strategies.CG_coinGrabber.settings,
        aggressive: { enabled: true }
      }
      }
      }
      }),
      env: binanceEnv,
      brokerAdapterFactory: () => createBroker(),
      logger: {
        info() {},
        error() {}
      },
    }),
    /Aggressive strategy is disabled and deferred/,
  )
})

test("keeps inbound operator control disabled without constructing its store or Telegram adapter", async () => {
  let storeFactoryCalls = 0
  let adapterFactoryCalls = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    createOperationalStateStore: () => { storeFactoryCalls += 1; throw new Error("Disabled operator control must not open the Operational State Store.") },
    createTelegramOperatorAdapter: () => { adapterFactoryCalls += 1; throw new Error("Disabled operator control must not construct a Telegram adapter.") },
    logger: {
      info() {},
      error() {}
    },
  })
  try {
    assert.equal(storeFactoryCalls, 0, "Disabled operator control must not inspect or open the Operational State Store.")
    assert.equal(adapterFactoryCalls, 0, "Disabled operator control must not construct an inbound Telegram adapter.")
  } finally { await runtime.stop() }
})

test("verifies Operational State Store records before broker connect and starts/stops Telegram around the trading runtime", async () => {
  const config = {
    ...appConfig,
    operatorControl: { telegram: {
    enabled: true,
    allowedUserIds: ["12345"]
  } }
  }
  const calls = []
  const appendedFacts = []
  let operator
  const broker = createBroker(calls)
  let placeOrderCalls = 0
  let cancelOrderCalls = 0
  broker.placeOrder = async () => { placeOrderCalls += 1; return { ok: true } }
  broker.cancelOrder = async () => { cancelOrderCalls += 1; return { ok: true } }
  const operationalStateStore = {
    runtimeSessionId: "test-runtime-session",
    verify: async () => { calls.push("verify-Operational State Store records"); return {
      ok: true,
      data: {
      valid: true,
      durableWriteSupported: true
    }
    } },
    readAll: async () => ({
      ok: true,
      data: {
        records: [
          {
            sequence: "0",
            factId: "durable-facts:genesis",
            factType: "LEDGER_INITIALIZED",
            runtimeSessionId: "test-runtime-session",
            data: { schemaVersion: 1 }
          },
          ...appendedFacts,
        ],
        durableWriteSupported: true,
        lastCommittedSequence: String(appendedFacts.length),
        lastCommittedDigest: "a".repeat(64),
      },
    }),
    append: async (fact) => {
      calls.push(fact.factType === "OPERATOR_MARKET_PAUSED" || fact.factType === "OPERATOR_MARKET_RESUMED" ? "append-operator-fact" : "append-process-fact")
      appendedFacts.push({
        ...fact,
        sequence: String(appendedFacts.length + 1),
        runtimeSessionId: "test-runtime-session",
      })
      return {
        ok: true,
        data: {
        durable: true,
        duplicate: false
      }
      }
    },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      OPERATIONAL_STATE_DIRECTORY: process.cwd()
    },
    runtimeSessionId: "test-runtime-session",
    createOperationalStateStore: ({
      directory,
      runtimeSessionId
    }) => {
      calls.push("create-Operational State Store records-store")
      assert.equal(directory, process.cwd(), "The configured absolute store directory must be passed unchanged to the ADR-0001 adapter.")
      assert.equal(runtimeSessionId, "test-runtime-session", "The current process identity must scope appended Operational State Store records.")
      return operationalStateStore
    },
    createTelegramOperatorAdapter: ({
      botToken,
      allowedUserIds,
      operator: suppliedOperator
    }) => {
      calls.push("create-telegram-adapter")
      assert.equal(botToken, "test-telegram-token", "The Telegram bot token must come from the environment and never app config.")
      assert.deepEqual(allowedUserIds, ["12345"], "Only configured trusted Telegram user IDs may reach the adapter.")
      operator = suppliedOperator
      return {
        start: async () => calls.push("start-telegram-poller"),
        stop: async () => calls.push("stop-telegram-poller")
      }
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })
  try {
    assert.ok(calls.indexOf("verify-Operational State Store records") < calls.indexOf("connect"), "Operational State Store records integrity must be verified before Binance broker connection.")
    assert.ok(calls.indexOf("start-telegram-poller") < calls.indexOf("subscribe:user-data"), "The operator poller must be ready before the runtime begins accepting trading events.")
    const pauseResult = await operator.pauseMarket({
      actor: {
      id: "telegram-user:12345",
      roles: ["trading-operator"]
    },
      requestId: "telegram:9001",
      symbol: "BTCUSDT"
    })
    assert.equal(pauseResult.ok, true, "An authorized market pause must complete through the existing application use case.")
    const operatorPauseFacts = appendedFacts.filter(({ factType }) => factType === "OPERATOR_MARKET_PAUSED")
    assert.equal(operatorPauseFacts.length, 1, "A successful operator pause must append exactly one Operational State Store record.")
    assert.equal(operatorPauseFacts[0].data.symbol, "BTCUSDT", "The durable pause fact must identify the requested configured market.")
    assert.ok(calls.indexOf("append-operator-fact") > calls.indexOf("start-telegram-poller"), "A pause fact is appended only after the adapter is running and a request is received.")
    assert.equal(placeOrderCalls, 0, "An operator pause must not submit any exchange order.")
    assert.equal(cancelOrderCalls, 0, "An operator pause must not cancel any exchange order.")
  } finally { await runtime.stop() }
  assert.ok(calls.indexOf("stop-telegram-poller") < calls.indexOf("disconnect"), "Inbound commands must stop before broker shutdown begins.")
})

test("stops Telegram and broker when Telegram identity verification fails during startup", async () => {
  const config = {
    ...appConfig,
    operatorControl: { telegram: {
    enabled: true,
    allowedUserIds: ["12345"]
  } }
  }
  const calls = []
  const broker = createBroker(calls)
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      TELEGRAM_BOT_TOKEN: "test-telegram-token",
      OPERATIONAL_STATE_DIRECTORY: process.cwd()
    },
    runtimeSessionId: "test-runtime-session",
    createOperationalStateStore: () => ({
      runtimeSessionId: "test-runtime-session",
      verify: async () => ({
        ok: true,
        data: {
        valid: true,
        durableWriteSupported: true
      }
      }),
      readAll: async () => ({
        ok: true,
        data: {
          records: [{
            sequence: "0",
            factId: "durable-facts:genesis",
            factType: "LEDGER_INITIALIZED",
            runtimeSessionId: "test-runtime-session",
            data: { schemaVersion: 1 }
          }],
          durableWriteSupported: true,
          lastCommittedSequence: "0",
          lastCommittedDigest: "a".repeat(64),
        },
      }),
      append: async () => ({
        ok: true,
        data: { durable: true }
      }),
    }),
    createTelegramOperatorAdapter: () => ({
      start: async () => { calls.push("start-telegram-poller"); throw new Error("Telegram getMe unauthorized") },
      stop: async () => calls.push("stop-telegram-poller")
    }),
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  }), (error) => error.code === "OPERATOR_CONTROL_TELEGRAM_START_FAILED", "Telegram identity verification failure must abort startup.")
  assert.ok(calls.includes("stop-telegram-poller"), "A partially started Telegram adapter must be stopped during startup rollback.")
  assert.ok(calls.includes("disconnect"), "The broker must be disconnected during startup rollback.")
  assert.equal(calls.includes("subscribe:user-data"), false, "Trading subscriptions must not begin after Telegram identity verification fails.")
})

test("subscribes only enabled pairs for Binance trading", async () => {
  const calls = []
  const broker = createBroker(calls)
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })
  assert.equal(result.connected, true)
  assert.equal(result.tradingEnabled, true)
  assert.equal(result.strategyMode, "conservative")
  assert.deepEqual(result.subscriptions, ["BTCUSDT"])
  assert.equal(result.getMarketMetadata({ symbol: "BTCUSDT" }).market.symbol, "BTCUSDT")
  assert.ok(result.recoveredState)
  assert.equal(result.recoveredState.requiresExchangeReconciliation, false)
  assert.deepEqual(result.recoveredState.pausedMarkets, new Set())
  assert.equal(result.recoveredState.orderRegistry.orders.length, 0)
  assert.equal(result.userDataReady, true)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
  await result.stop()
  assert.deepEqual(calls, [
    "connect", "filters:BTCUSDT", "filters:ETHUSDT", "subscribe:user-data", "account:snapshot",
    "subscribe:book:BTCUSDT", "subscribe:BTCUSDT", "unsubscribe:book:BTCUSDT", "unsubscribe:BTCUSDT",
    "unsubscribe:user-data", "account:snapshot", "disconnect",
  ])
})

test("keeps external open orders audit-blocked but does not block startup or cancel them", async () => {
  const market = createMarketMetadata("BTCUSDT").market
  const externalCanonicalOrder = new CanonicalOrder({
    clientOrderId: "manual-client-order",
    brokerOrderId: "manual-broker-order",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "64000",
      asset: market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "0.01",
      asset: market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: market.baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const externalOpenOrder = createOpenOrderSnapshot({ order: externalCanonicalOrder })
  const broker = createBroker([], { externalOpenOrders: [externalOpenOrder] })
  const cancellationRequests = []
  const cancelOrder = broker.cancelOrder
  broker.cancelOrder = async (input) => {
    cancellationRequests.push(input)
    return cancelOrder(input)
  }
  const logs = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info: (entry) => logs.push(entry),
      error: (entry) => logs.push(entry),
    },
  })

  try {
    assert.equal(runtime.userDataReady, true, "An external order must not block the user-data readiness gate.")
    assert.equal(runtime.userDataStatus, "READY")
    assert.equal(runtime.recoveredState.orderRegistry.orders.length, 0, "The external order must not be adopted into Harvester ownership.")
    const audit = logs.find((entry) =>
      entry.message === "Account-wide open-orders snapshot recorded; unowned orders remain external and untouched")
    assert.ok(audit, "The audit log must explicitly identify external orders as unowned and untouched.")
    assert.equal(audit.readiness, "BLOCKED", "BLOCKED is the account-audit status, not trading-engine readiness.")
    assert.ok(logs.some((entry) =>
      entry.message === "Conservative TESTNET startup checks passed; current account audit is complete"))
    assert.ok(logs.some((entry) =>
      entry.message === "Conservative TESTNET trading engine activated"))
    assert.equal(externalOpenOrder.clientOrderId, "manual-client-order")
  } finally {
    await runtime.stop()
  }
  assert.deepEqual(cancellationRequests, [], "Startup and shutdown must never cancel a manually placed external order.")
})

test("subscribes every enabled market before waiting for the first market's REST ticker seed", async () => {
  const calls = []
  const broker = createBroker(calls)
  let resolveFirstTicker
  const firstTicker = new Promise((resolve) => { resolveFirstTicker = resolve })
  broker.getPrices = async ({ symbol }) => {
    calls.push("prices:" + symbol)
    if (symbol === "BTCUSDT") {return firstTicker}
    return {
      ok: true,
      data: {
      symbol,
      price: "65000"
    }
    }
  }
  let accountSnapshotTime = 0
  broker.getAccountSnapshot = async () => {
    accountSnapshotTime += 1
    const balances = ["BTC", "ETH", "USDT"].map((code) => {
      const asset = new Asset({
        id: "asset:" + code,
        code
      })
      return new Balance({
        free: new Quantity({
          amount: "0",
          asset
        }),
        locked: new Quantity({
          amount: "0",
          asset
        }),
      })
    })
    return {
      ok: true,
      data: {
      balances,
      sourceTime: accountSnapshotTime
    }
    }
  }
  let placeOrderCalls = 0
  broker.placeOrder = async () => {
    placeOrderCalls += 1
    return { ok: true }
  }
  const strategy = appConfig.strategies.CG_coinGrabber
  const config = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...strategy,
        pairs: {
          ...strategy.pairs,
          ETHUSDT: {
            ...strategy.pairs.ETHUSDT,
            enabled: true
          },
        },
      },
    },
  }
  const startup = startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  let resolveSecondSubscription
  const secondSubscription = new Promise((resolve) => { resolveSecondSubscription = resolve })
  const subscribeForPrices = broker.subscribeForPrices
  broker.subscribeForPrices = async (input) => {
    const result = await subscribeForPrices(input)
    if (input.symbol === "ETHUSDT") {resolveSecondSubscription()}
    return result
  }

  await waitForTestSignal(
    secondSubscription,
    "second enabled market subscription",
    () => ({ calls }),
    2000,
  )
  assert.ok(calls.indexOf("subscribe:ETHUSDT") < calls.indexOf("prices:BTCUSDT"))
  assert.ok(calls.includes("subscribe:book:BTCUSDT"))
  assert.ok(calls.includes("subscribe:book:ETHUSDT"))

  resolveFirstTicker({
    ok: true,
    data: {
    symbol: "BTCUSDT",
    price: "65000"
  }
  })
  const runtime = await startup
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT", "ETHUSDT"])
  assert.equal(placeOrderCalls, 0)
  await runtime.stop()
})

test("starts the Conservative trading engine and applies fills to Portfolio", async () => {
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => createBroker(),
    logger: {
      info() {},
      error() {}
    },
  })
  assert.equal(result.tradingEnabled, true)
  assert.equal(result.strategyMode, "conservative")
  const first = await result.updatePortfolio({ fill: createFill({ tradeId: "trade-portfolio-1" }) })
  const second = await result.updatePortfolio({ fill: createFill({ tradeId: "trade-portfolio-2" }) })
  assert.equal(first.ok, true)
  assert.equal(first.data.applied, true)
  assert.equal(second.ok, true)
  assert.equal(second.data.applied, true)
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.02")
  assert.equal(result.portfolio.appliedFillIds.length, 2)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
  assert.equal(result.userDataStatus, "SHUTDOWN_INCOMPLETE")
})

test("serializes concurrent Portfolio updates without losing fills", async () => {
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {}
  })
  const [first, second] = await Promise.all([
    result.updatePortfolio({ fill: createFill({ tradeId: "trade-1" }) }),
    result.updatePortfolio({ fill: createFill({ tradeId: "trade-2" }) }),
  ])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }).baseQuantity.amount, "0.02")
  assert.equal(result.portfolio.appliedFillIds.length, 2)
})

test("disconnects when a market price subscription fails", async () => {
  const calls = []
  const broker = createBroker(calls, {
    subscribeResult: {
      ok: false,
      errors: [new Error("stream unavailable")]
    },
  })
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /Unable to subscribe to market prices for BTCUSDT: stream unavailable/,
  )
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "filters:ETHUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "subscribe:book:BTCUSDT",
    "subscribe:BTCUSDT",
    "unsubscribe:book:BTCUSDT",
    "unsubscribe:user-data",
    "disconnect",
  ])
})

test("unsubscribes earlier markets when a later market subscription fails", async () => {
  const calls = []
  const broker = createBroker(calls, {
    subscribeResultBySymbol: {
      ETHUSDT: {
        ok: false,
        errors: [new Error("stream unavailable")]
      },
    },
  })
  const config = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          ETHUSDT: {
            enabled: true,
            tradingEnvironment: "both",
            investment: 100,
            orderQuantity: 0.1,
            makerPercent: 0,
            takerPercent: 0
          },
        },
      },
    },
  }
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => config,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /Unable to subscribe to market prices for ETHUSDT/,
  )
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "filters:ETHUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "subscribe:book:BTCUSDT",
    "subscribe:BTCUSDT",
    "subscribe:book:ETHUSDT",
    "subscribe:ETHUSDT",
    "unsubscribe:book:BTCUSDT",
    "unsubscribe:book:ETHUSDT",
    "unsubscribe:BTCUSDT",
    "unsubscribe:user-data",
    "disconnect",
  ])
})

test("passes live TRADING_MODE to the Binance broker factory during startup", async () => {
  let brokerConfig
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "test",
      TRADING_MODE: "live"
    },
    brokerAdapterFactory: ({ config }) => {
      brokerConfig = config
      return createBroker()
    },
    logger: {
      info() {},
      error() {}
    },
  })

  assert.equal(result.tradingMode, "live")
  assert.equal(brokerConfig.tradingMode, "live")
  await result.stop()
})

test("rejects an invalid TRADING_MODE before connecting to Binance", async () => {
  let brokerFactoryCalled = false
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: { TRADING_MODE: "production" },
    brokerAdapterFactory: () => { brokerFactoryCalled = true; return createBroker() },
  }), /TRADING_MODE must be set to "testnet" or "live"/)
  assert.equal(brokerFactoryCalled, false)
})

test("disconnects after a failed broker connection", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.connect = async () => {
    calls.push("connect")
    throw new Error("connection failed")
  }
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
    }),
    /connection failed/,
  )
  assert.deepEqual(calls, ["connect", "disconnect"])
})

test("does not adopt unowned execution events into strategy accounting", async () => {
  const broker = createBroker()
  const fill = createFill({ tradeId: "user-data-trade-1" })
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })
  await broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined)
  assert.equal(result.getAccountSnapshot().sourceTime, 1)
  assert.equal(result.getRecoveryLedger({ marketId: fill.market.id }), undefined)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
})

test("does not clear a genuine startup stream-recovery gate with only the initial balance snapshot", async () => {
  const broker = createBroker()
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "connectionClosed",
      recoveryRequired: true
    })
    return result
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: {
        ...binanceEnv,
        NODE_ENV: "development",
      },
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /user-data stream reconciliation is required/,
  )
})

test("does not adopt an external order report received before the ownership registry is ready", async () => {
  const calls = []
  const broker = createBroker(calls)
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onEvent({
      event: {
        eventType: "executionReport",
        executionType: "NEW"
      },
    })
    return result
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: {
        ...binanceEnv,
        NODE_ENV: "development",
      },
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /unowned or invalid user-data event before order ownership was initialized/,
  )
  assert.ok(calls.includes("disconnect"))
})

test("starts application reconciliation on transport recovery and acknowledges only after durable audits", async () => {
  const calls = []
  const broker = createBroker(calls)
  let openOrderReads = 0
  const getOpenOrders = broker.getOpenOrders
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    return getOpenOrders(input)
  }
  const journalEvents = []
  const eventPublisher = {
    publish: (event) => { journalEvents.push(event); return { ok: true } },
    flush: async () => ({
      ok: true,
      durable: true
    }),
  }
  let acknowledgementCount = 0
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => {
    resolveAcknowledgement = resolve
  })
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          acknowledgementCount += 1
          handlers.onStatus({
            type: "reconciled",
            subscriptionId: 17,
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }

  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error() {}
    },
  })

  assert.equal(result.userDataReady, true)
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })

  await waitForTestSignal(
    acknowledged,
    "application recovery acknowledgement",
    () => ({
      acknowledgementCount,
      userDataReady: result.userDataReady
    }),
    2_000,
  )

  assert.equal(acknowledgementCount, 1)
  assert.equal(result.userDataReady, true)
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 2)
  assert.equal(openOrderReads, 2)
  assert.ok(journalEvents.some((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "RECOVERY"))
  assert.ok(journalEvents.some((event) =>
    event.name === "account.open_orders_captured" && event.data.phase === "RECOVERY"))

  // A repeated reminder for the already-acknowledged generation is stale.
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(acknowledgementCount, 1)
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 2)
  assert.equal(result.userDataReady, true)
  await result.stop()
})

test("repeats recovery snapshots when a user-data event arrives during REST audit reads", async () => {
  const broker = createBroker()
  const getAccountSnapshot = broker.getAccountSnapshot
  let accountReads = 0
  let openOrderReads = 0
  const getOpenOrders = broker.getOpenOrders
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    return getOpenOrders(input)
  }
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    if (accountReads === 2) {
      broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
    }
    return getAccountSnapshot()
  }
  let acknowledgementCount = 0
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => { resolveAcknowledgement = resolve })
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          acknowledgementCount += 1
          handlers.onStatus({
            type: "reconciled",
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(acknowledged, "recovery after user-data audit event", () => ({
    accountReads,
    openOrderReads,
    acknowledgementCount,
  }), 2_000)

  assert.equal(accountReads, 3)
  assert.equal(openOrderReads, 3)
  assert.equal(acknowledgementCount, 1)
  assert.equal(result.userDataReady, true)
  await result.stop()
})

test("logs stack and cause details when a user-data RPC error has an empty message", async () => {
  const broker = createBroker()
  const diagnostics = []
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error: (entry) => diagnostics.push(entry),
    },
  })
  const error = new TypeError("")
  error.cause = new Error("socket callback failed")
  broker.emitUserDataStatus({
    type: "rpcError",
    error,
    recoveryRequired: false
  })

  const diagnostic = diagnostics.find((entry) =>
    entry?.message === "User-data stream error")
  assert.ok(diagnostic)
  assert.equal(diagnostic.statusType, "rpcError")
  assert.equal(diagnostic.errorName, "TypeError")
  assert.equal(diagnostic.errorMessage, "(empty error message)")
  assert.match(diagnostic.errorStack, /TypeError/)
  assert.equal(diagnostic.causeName, "Error")
  assert.equal(diagnostic.causeMessage, "socket callback failed")
  assert.match(diagnostic.causeStack, /socket callback failed/)
  await result.stop()
})

test("keeps recovery blocked and does not acknowledge when the fresh account snapshot fails", async () => {
  const broker = createBroker()
  const getAccountSnapshot = broker.getAccountSnapshot
  let accountReads = 0
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    if (accountReads === 2) {return {
      ok: false,
      errors: [new Error("account endpoint unavailable")]
    }}
    return getAccountSnapshot()
  }
  let acknowledgementCount = 0
  let resolveFailure
  const failed = new Promise((resolve) => { resolveFailure = resolve })
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => { acknowledgementCount += 1; return true },
      },
    }
  }

  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error: (entry) => {
        if (entry?.message === "application recovery failed; trading remains blocked") {
          resolveFailure(entry)
        }
      },
    },
  })

  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(failed, "failed recovery audit", () => ({
    accountReads,
    acknowledgementCount
  }), 2_000)

  assert.equal(acknowledgementCount, 0)
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "shutdown must reject when startup recovery leaves user-data reconciliation incomplete")
})

test("does not acknowledge a stale recovery after a newer disconnect", async () => {
  const broker = createBroker()
  const getAccountSnapshot = broker.getAccountSnapshot
  let accountReads = 0
  let releaseRecoverySnapshot
  let resolveRecoverySnapshotStarted
  const recoverySnapshotStarted = new Promise((resolve) => { resolveRecoverySnapshotStarted = resolve })
  const recoverySnapshotGate = new Promise((resolve) => { releaseRecoverySnapshot = resolve })
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    if (accountReads === 2) {
      resolveRecoverySnapshotStarted()
      await recoverySnapshotGate
    }
    return getAccountSnapshot()
  }
  let acknowledgementCount = 0
  let resolveStaleFailure
  const staleFailure = new Promise((resolve) => { resolveStaleFailure = resolve })
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => { acknowledgementCount += 1; return true },
      },
    }
  }

  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info() {},
      error: (entry) => {
        if (entry?.message === "application recovery failed; trading remains blocked") {
          resolveStaleFailure(entry)
        }
      },
    },
  })

  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  await waitForTestSignal(recoverySnapshotStarted, "recovery account snapshot", () => ({ accountReads }), 2_000)
  broker.emitUserDataStatus({
    type: "connectionClosed",
    code: 1006,
    recoveryRequired: true
  })
  releaseRecoverySnapshot()
  await waitForTestSignal(staleFailure, "stale recovery rejection", () => ({
    accountReads,
    acknowledgementCount
  }), 2_000)

  assert.equal(acknowledgementCount, 0)
  assert.equal(result.userDataReady, false)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/, "shutdown must reject when a newer disconnect prevents authoritative user-data recovery")
})

test("fails startup when user-data recovery is required during subscription setup", async () => {
  const broker = createBroker()
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    handlers.onStatus({
      type: "recovered",
      recoveryRequired: true,
      reconciliationRequired: true
    })
    return result
  }
  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /user-data stream reconciliation is required/,
  )
})

test("marks trading ready only after the mandatory account preflight audit", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })
  assert.equal(result.userDataReady, true)
  broker.emitUserDataStatus({
    type: "ready",
    recoveryRequired: false
  })
  assert.equal(result.userDataReady, true)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("blocks trading after execution accounting failure", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    onUserDataEvent: async () => {},
    logger: {
      info() {},
      error() {}
    },
  })
  await broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "trade-2" }),
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
})

test("fails startup closed when user-data subscription cannot be established", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.subscribeForUserData = async () => ({
    ok: false,
    errors: [new Error("user stream unavailable")],
  })

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /Unable to subscribe to user data: user stream unavailable/,
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "filters:ETHUSDT", "disconnect"])
})

test("does not expose a broker port that could bypass the trading engine", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await result.stop()
})

test("fails closed on malformed external TRADE reports", async () => {
  const broker = createBroker()
  let observed = false
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
    onUserDataEvent: async () => { observed = true },
  })
  await broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: { malformed: true },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(observed, false, "Malformed external fills must not be forwarded as owned execution events")
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.portfolio.positions.length, 0)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
})

test("fails startup before opening streams when required minimum notional is unavailable", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getSymbolFilters = async ({ symbol }) => {
    calls.push("filters:" + symbol)
    const metadata = createMarketMetadata(symbol)
    return {
      ok: true,
      data: {
        ...metadata,
        tradingRules: new TradingRules({
          market: metadata.market,
          constraints: metadata.tradingRules.constraints.filter(
            ({ type }) => type !== "MIN_NOTIONAL",
          ),
        }),
      },
    }
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /Required exchange trading rule is unavailable: MIN_NOTIONAL/,
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"])
})

test("fails startup when the configured post-only order type is unsupported", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getSymbolFilters = async ({ symbol }) => {
    calls.push("filters:" + symbol)
    return {
      ok: true,
      data: {
        ...createMarketMetadata(symbol),
        supportedOrderTypes: ["LIMIT", "MARKET"],
      },
    }
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /does not support required LIMIT_MAKER/,
  )
  assert.deepEqual(calls, ["connect", "filters:BTCUSDT", "disconnect"])
})

test("does not request another account snapshot after a TRADE when later snapshots would fail", async () => {
  const broker = createBroker()
  const getAccountSnapshot = broker.getAccountSnapshot
  let calls = 0
  broker.getAccountSnapshot = async () => {
    calls += 1
    if (calls === 1) {return getAccountSnapshot()}
    return {
      ok: false,
      errors: [new Error("account endpoint unavailable")]
    }
  }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    fill: createFill({ tradeId: "account-refresh-failure" }),
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "EXECUTION_ACCOUNTING_FAILED")
  assert.equal(result.portfolio.getPosition({ symbol: "BTCUSDT" }), undefined)
  assert.equal(result.getAccountSnapshot().sourceTime, 1)
  assert.equal(calls, 1)
  assert.equal(result.placeOrder, undefined)
  assert.equal(result.broker, undefined)
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
})

test("fails startup when the exchange snapshot omits a configured market asset", async () => {
  const calls = []
  const broker = createBroker(calls)
  broker.getAccountSnapshot = async () => {
    calls.push("account:snapshot")
    const asset = new Asset({
      id: "asset:BTC",
      code: "BTC"
    })
    return {
      ok: true,
      data: {
        balances: [new Balance({
          free: new Quantity({
            amount: "1",
            asset
          }),
          locked: new Quantity({
            amount: "0",
            asset
          }),
        })],
        sourceTime: 1,
      },
    }
  }

  await assert.rejects(
    startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {}
      },
    }),
    /missing required market asset balances: USDT/,
  )
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "filters:ETHUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "unsubscribe:user-data",
    "disconnect",
  ])
})


test("does not clear the ownership gate after stream recovery acknowledgement", async () => {
  const broker = createBroker()
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  broker.emitUserDataStatus({
    type: "connectionClosed",
    recoveryRequired: true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false)
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")

  broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false,
    reconciliationRequired: false,
    subscriptionId: "stale-subscription",
    recoveryGeneration: 0,
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(result.userDataReady, false, "A stream acknowledgement without a matching application recovery audit cannot clear the ownership gate")
  assert.equal(result.userDataStatus, "AUTHORITATIVE_RECONCILIATION_REQUIRED")
  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
})
// eslint-disable-next-line max-lines-per-function -- Keep the full ordered recovery lifecycle in one end-to-end scenario.
test("explicit TESTNET trading drains its first BUY fill once after 254 recovery reminders and completes the cycle", { timeout: 90_000 }, async () => {
  const calls = []
  const buyCancellationCount = { value: 0 }
  const subscriptions = new Map()
  const bookSubscriptions = new Map()
  let userDataHandlers
  let snapshotTime = 0
  let baseBalance = "0"
  let signalRecoveryCompleted
  const recoveryCompleted = new Promise((resolve) => { signalRecoveryCompleted = resolve })
  const submittedOrders = []
  const canonicalOrdersByBrokerId = new Map()
  const fillHistoryByOrder = new Map()
  const runtimeErrors = []
  const runtimeDebug = []
  const runtimeInfo = []
  const publishedEvents = []
  const durableFlushes = []
  const recoveryFillTradeId = "testnet-buy-fill"
  let recoveryPending = false
  let recoveryCanonicalHistoryReads = 0
  let recoveryFillHistoryReads = 0
  let recoveryAccountWideOpenOrderReads = 0
  let recoveryOwnedOpenOrderReads = 0
  let recoveryAccountSnapshotReads = 0
  let recoveryAcknowledgementCount = 0
  let recoveryQueuedFillProcessedCount = 0
  let recoveryQueuedFillMode
  let recoveryAcknowledgementObservation
  let resolveRecoveryHistoryStarted
  let releaseRecoveryHistory
  let resolveRecoveryQueuedFillProcessed
  let resolveRecoveryAcknowledged
  const recoveryHistoryStarted = new Promise((resolve) => {
    resolveRecoveryHistoryStarted = resolve
  })
  const recoveryHistoryGate = new Promise((resolve) => {
    releaseRecoveryHistory = resolve
  })
  const recoveryQueuedFillProcessed = new Promise((resolve) => {
    resolveRecoveryQueuedFillProcessed = resolve
  })
  const recoveryAcknowledged = new Promise((resolve) => {
    resolveRecoveryAcknowledged = resolve
  })
  let resolveThreeOrders
  let resolveFiveOrders
  const threeOrdersSubmitted = new Promise((resolve) => { resolveThreeOrders = resolve })
  const fiveOrdersSubmitted = new Promise((resolve) => { resolveFiveOrders = resolve })
  const marketMetadata = createMarketMetadata("BTCUSDT")
  const broker = {
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    getExchangeMarkets: async () => ({
      ok: true,
      data: []
    }),
    getSymbolFilters: async () => ({
      ok: true,
      data: marketMetadata
    }),
    getOpenOrders: async ({ symbol } = {}) => {
      if (recoveryPending) {
        if (symbol) {
          recoveryOwnedOpenOrderReads += 1
        } else {
          recoveryAccountWideOpenOrderReads += 1
        }
      }
      return {
        ok: true,
        data: [...canonicalOrdersByBrokerId.values()]
          .filter((order) => ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
          .filter((order) => !symbol || order.market.symbol === symbol)
          .map((order) => createOpenOrderSnapshot({ order })),
      }
    },
    getPrices: async () => ({
      ok: true,
      data: {
      symbol: "BTCUSDT",
      price: "65000"
    }
    }),
    getCandles: async () => ({
      ok: true,
      data: []
    }),
    subscribeForCandles: async () => ({
      ok: true,
      data: { unsubscribe: async () => {} }
    }),
    cancelOrder: async ({ order }) => {
      if (order.side === "BUY") {buyCancellationCount.value += 1}
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
        updatedAt: 3,
        completedAt: 3,
      })
      canonicalOrdersByBrokerId.set(order.brokerOrderId, canceledOrder)
      return {
        ok: true,
        data: canceledOrder
      }
    },
    getFills: async ({ orderId } = {}) => {
      if (recoveryPending) {recoveryFillHistoryReads += 1}
      return {
        ok: true,
        data: fillHistoryByOrder.get(String(orderId)) ?? []
      }
    },
    getCanonicalOrderHistory: async ({
      orderId,
      symbol
    } = {}) => {
      if (recoveryPending) {
        recoveryCanonicalHistoryReads += 1
        if (recoveryCanonicalHistoryReads === 1) {
          resolveRecoveryHistoryStarted()
          await recoveryHistoryGate
        }
      }
      return {
        ok: true,
        data: [...canonicalOrdersByBrokerId.values()].filter((order) =>
          (!orderId || order.brokerOrderId === String(orderId)) &&
          (!symbol || order.market.symbol === symbol)),
      }
    },
    getCanonicalOrder: async () => ({
      ok: false,
      errors: [new Error("order not found")]
    }),
    getAccountSnapshot: async () => {
      if (recoveryPending) {recoveryAccountSnapshotReads += 1}
      snapshotTime += 1
      const balances = [
        new Balance({
          free: new Quantity({
            amount: baseBalance,
            asset: marketMetadata.market.baseAsset
          }),
          locked: new Quantity({
            amount: "0",
            asset: marketMetadata.market.baseAsset
          }),
        }),
        new Balance({
          free: new Quantity({
            amount: "10000",
            asset: marketMetadata.market.quoteAsset
          }),
          locked: new Quantity({
            amount: "0",
            asset: marketMetadata.market.quoteAsset
          }),
        }),
      ]
      return {
        ok: true,
        data: {
        balances,
        sourceTime: snapshotTime
      }
      }
    },
    subscribeForUserData: async (handlers) => {
      userDataHandlers = {
        ...handlers,
        onEvent: (message) => {
          const event = message?.event
          const executedOrder = event?.executedOrder
          if (executedOrder?.brokerOrderId) {
            canonicalOrdersByBrokerId.set(executedOrder.brokerOrderId, executedOrder)
          }
          const fill = event?.fill
          if (fill instanceof Fill) {
            const existing = fillHistoryByOrder.get(fill.brokerOrderId) ?? []
            if (!existing.some((item) => item.id === fill.id)) {
              fillHistoryByOrder.set(fill.brokerOrderId, [...existing, fill])
            }
          }
          return handlers.onEvent(message)
        },
      }
      return {
        ok: true,
        data: {
          disconnect: async () => calls.push("unsubscribe:user-data"),
          acknowledgeRecoveryResult: (recoveryGeneration) => {
            assert.equal(
              recoveryGeneration,
              1,
              "The recovery integration fixture must acknowledge the broker generation it reconciled.",
            )
            recoveryAcknowledgementCount += 1
            recoveryAcknowledgementObservation = {
              queuedFillProcessedCount: recoveryQueuedFillProcessedCount,
              queuedFillMode: recoveryQueuedFillMode,
              fillAppliedCount: publishedEvents.filter((event) =>
                event.name === "execution.fill_applied" && event.data?.tradeId === recoveryFillTradeId).length,
              accountAuditDurable: durableFlushes.some((flush) =>
                flush.some((event) => event.name === "account.snapshot_captured" && event.phase === "RECOVERY")),
              openOrdersAuditDurable: durableFlushes.some((flush) =>
                flush.some((event) => event.name === "account.open_orders_captured" && event.phase === "RECOVERY")),
            }
            handlers.onStatus({
              type: "reconciled",
              subscriptionId: 17,
              recoveryGeneration: 1,
              recoveryRequired: false,
              reconciliationRequired: false,
            })
            resolveRecoveryAcknowledged()
            return {
              accepted: true,
              completed: true
            }
          },
        },
      }
    },
    subscribeForPrices: async ({
      symbol,
      onPrice
    }) => {
      subscriptions.set(symbol, onPrice)
      return {
        ok: true,
        data: { unsubscribe: async () => calls.push("unsubscribe:" + symbol) }
      }
    },
    subscribeForBookTicker: async ({
      symbol,
      onBookTicker
    }) => {
      bookSubscriptions.set(symbol, onBookTicker)
      return {
        ok: true,
        data: { unsubscribe: async () => calls.push("unsubscribe:book:" + symbol) }
      }
    },
    placeOrder: async ({ order }) => {
      calls.push({
        side: order.side,
        price: order.price,
        quantity: order.quantity
      })
      submittedOrders.push(order)
      if (submittedOrders.length === 3) {resolveThreeOrders()}
      if (submittedOrders.length === 5) {resolveFiveOrders()}
      const acknowledgedOrder = new CanonicalOrder({
          clientOrderId: order.clientOrderId,
          brokerOrderId: "broker-" + order.clientOrderId,
          market: marketMetadata.market,
          side: order.side,
          type: order.type,
          limitPrice: new Money({
            amount: order.price,
            asset: marketMetadata.market.quoteAsset
          }),
          originalQuantity: new Quantity({
            amount: order.quantity,
            asset: marketMetadata.market.baseAsset
          }),
          executedQuantity: new Quantity({
            amount: "0",
            asset: marketMetadata.market.baseAsset
          }),
          status: "OPEN",
          createdAt: 1,
          acknowledgedAt: 1,
          updatedAt: 1,
        })
      canonicalOrdersByBrokerId.set(acknowledgedOrder.brokerOrderId, acknowledgedOrder)
      return {
        ok: true,
        data: acknowledgedOrder
      }
    },
  }
  makeVolatilityReadyBroker(broker, ["BTCUSDT"])
  const config = {
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
        investment: 2000,
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
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      NODE_ENV: "development",
      BINANCE_API_KEY: "test-key",
      BINANCE_API_SECRET_KEY: "test-secret",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        publishedEvents.push(event)
        if (event.name === "recovery.cycle_completed") {signalRecoveryCompleted()}
        return { ok: true }
      },
      flush: async () => {
        durableFlushes.push(publishedEvents.map((event) => ({
          name: event.name,
          phase: event.data?.phase,
        })))
        return {
          ok: true,
          durable: true
        }
      },
    },
    onUserDataEvent: async ({
      event,
      recoveryMode
    }) => {
      if (event?.fill?.tradeId === recoveryFillTradeId) {
        recoveryQueuedFillProcessedCount += 1
        recoveryQueuedFillMode = recoveryMode
        resolveRecoveryQueuedFillProcessed()
      }
    },
    now: () => 1000,
    logger: {
      info: (entry) => runtimeInfo.push(entry),
      debug: (entry) => runtimeDebug.push(entry),
      error: (entry) => runtimeErrors.push({
        message: entry.message,
        symbol: entry.symbol,
        reason: entry.reason,
        errors: entry.errors?.map((error) => error.message ?? String(error))
      }),
    },
  })
  assert.equal(runtime.userDataReady, true)
  const readinessTransitions = [runtime.userDataReady]
  const recordReadinessTransition = () => {
    const ready = runtime.userDataReady
    if (readinessTransitions[readinessTransitions.length - 1] !== ready) {
      readinessTransitions.push(ready)
    }
  }
  assert.equal(submittedOrders.length, 0, "the initial ticker snapshot must wait for a book ticker")
  await bookSubscriptions.get("BTCUSDT")({
    symbol: "BTCUSDT",
    bestBidPrice: "60000",
    bestBidQuantity: "1",
    bestAskPrice: "70000",
    bestAskQuantity: "1",
    timestamp: 1000,
  })
  assert.equal(submittedOrders.length, 1, "a fresh non-crossing book should release the initial BUY")
  assert.equal(submittedOrders[0].side, "BUY")

  const acknowledgedBuy = new CanonicalOrder({
    clientOrderId: submittedOrders[0].clientOrderId,
    brokerOrderId: "broker-" + submittedOrders[0].clientOrderId,
    market: marketMetadata.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: submittedOrders[0].price,
      asset: marketMetadata.market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: submittedOrders[0].quantity,
      asset: marketMetadata.market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: marketMetadata.market.baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  userDataHandlers.onEvent({
    event: {
      eventType: "executionReport",
      executionType: "NEW",
      executedOrder: acknowledgedBuy,
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  const processedOrderLog = runtimeInfo.find(({ message }) =>
    message === "Order update processed" && message !== undefined)
  assert.ok(processedOrderLog)
  assert.equal(processedOrderLog.price, submittedOrders[0].price)
  assert.equal(processedOrderLog.quantity, submittedOrders[0].quantity)

  const submitted = calls.find((call) => typeof call === "object")
  const clientOrderId = submittedOrders[0].clientOrderId
  const canonicalBuy = new CanonicalOrder({
    clientOrderId,
    brokerOrderId: "broker-" + clientOrderId,
    market: marketMetadata.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: submitted.price,
      asset: marketMetadata.market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: submitted.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: submitted.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 2,
    completedAt: 2,
  })
  const fill = new Fill({
    tradeId: "testnet-buy-fill",
    brokerOrderId: canonicalBuy.brokerOrderId,
    clientOrderId: canonicalBuy.clientOrderId,
    market: marketMetadata.market,
    side: "BUY",
    price: new Money({
      amount: submitted.price,
      asset: marketMetadata.market.quoteAsset
    }),
    quantity: new Quantity({
      amount: submitted.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    quoteQuantity: new Money({
      amount: "649.6761",
      asset: marketMetadata.market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  recoveryPending = true
  userDataHandlers.onStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryGeneration: 1,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  recordReadinessTransition()
  await waitForTestSignal(
    recoveryHistoryStarted,
    "owned BUY canonical history read during application recovery",
    () => ({
      recoveryCanonicalHistoryReads,
      recoveryAcknowledgementCount,
      userDataReady: runtime.userDataReady,
    }),
    2_000,
  )

  const recoveryReminderCount = 254
  for (let reminderNumber = 0; reminderNumber < recoveryReminderCount; reminderNumber += 1) {
    userDataHandlers.onStatus({
      type: "recovered",
      subscriptionId: 17,
      recoveryGeneration: 1,
      recoveryRequired: true,
      reconciliationRequired: true,
    })
    recordReadinessTransition()
  }

  assert.equal(
    recoveryCanonicalHistoryReads,
    1,
    "All 254 reminders must share one in-flight owned-order reconciliation instead of starting duplicate canonical-history reads.",
  )
  assert.equal(
    recoveryAcknowledgementCount,
    0,
    "The broker must not be acknowledged while the owned BUY canonical-history read is unresolved.",
  )
  assert.equal(
    runtime.userDataReady,
    false,
    "Trading readiness must remain closed throughout the pending recovery generation.",
  )

  baseBalance = "0.01"
  const queuedFillDelivery = userDataHandlers.onEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: canonicalBuy,
      fill,
    },
  })

  assert.equal(
    recoveryQueuedFillProcessedCount,
    0,
    "The BUY execution report must remain queued while owned-order REST reconciliation is pending.",
  )
  assert.equal(
    recoveryAcknowledgementCount,
    0,
    "Repeated recovery reminders and a queued fill must not trigger premature broker acknowledgement.",
  )

  releaseRecoveryHistory()
  await waitForTestSignal(
    recoveryAcknowledged,
    "one successful global broker recovery acknowledgement",
    () => ({
      recoveryCanonicalHistoryReads,
      recoveryAcknowledgementCount,
      recoveryQueuedFillProcessedCount,
      userDataReady: runtime.userDataReady,
    }),
    5_000,
  )
  recordReadinessTransition()
  await waitForTestSignal(
    recoveryQueuedFillProcessed,
    "queued BUY fill drained during application recovery",
    () => ({
      recoveryQueuedFillProcessedCount,
      recoveryQueuedFillMode,
      userDataReady: runtime.userDataReady,
    }),
    2_000,
  )
  await queuedFillDelivery
  recoveryPending = false

  const recoveryFillAppliedEvents = publishedEvents.filter((event) =>
    event.name === "execution.fill_applied" && event.data?.tradeId === recoveryFillTradeId)
  const recoveryReconciledStatusEvents = publishedEvents.filter((event) =>
    event.name === "broker.status_changed" && event.data?.status === "reconciled")
  const recoveryCompletionLogs = runtimeInfo.filter((entry) =>
    entry.message === "application recovery completed and broker acknowledgement accepted")

  assert.equal(
    recoveryReminderCount,
    254,
    "The regression must reproduce the 254 recovered reminders recorded in the incident Journal.",
  )
  assert.equal(
    recoveryCanonicalHistoryReads,
    1,
    "One unresolved recovery generation must reconcile its owned BUY exactly once despite all repeated reminders.",
  )
  assert.ok(
    recoveryFillHistoryReads >= 1,
    "Recovery must consult canonical fill history for the owned BUY before certifying reconciliation.",
  )
  assert.equal(
    recoveryOwnedOpenOrderReads,
    1,
    "Owned-order reconciliation must perform one symbol-scoped open-order read for the single owned BUY.",
  )
  assert.equal(
    recoveryAccountWideOpenOrderReads,
    1,
    "The recovery generation must perform exactly one account-wide open-orders audit.",
  )
  assert.equal(
    recoveryAccountSnapshotReads,
    1,
    "The recovery generation must perform exactly one fresh account snapshot read.",
  )
  assert.equal(
    recoveryQueuedFillProcessedCount,
    1,
    "The queued BUY execution report must be drained once rather than replayed for each recovered reminder.",
  )
  assert.equal(
    recoveryQueuedFillMode,
    true,
    "The queued BUY execution report must be processed in recovery mode.",
  )
  assert.equal(
    recoveryFillAppliedEvents.length,
    1,
    "The stream fill and matching REST fill history must update accounting exactly once.",
  )
  assert.equal(
    runtime.portfolio.getPosition({ symbol: "BTCUSDT" })?.baseQuantity.amount,
    "0.01",
    "The Portfolio must contain exactly one executed BUY quantity after stream/REST overlap.",
  )
  assert.equal(
    recoveryAcknowledgementCount,
    1,
    "The broker recovery acknowledgement result must be accepted exactly once for the current generation.",
  )
  assert.equal(
    recoveryAcknowledgementObservation.queuedFillProcessedCount,
    1,
    "The queued fill must be drained before the broker recovery acknowledgement is attempted.",
  )
  assert.equal(
    recoveryAcknowledgementObservation.queuedFillMode,
    true,
    "The queued fill must be processed in recovery mode before broker acknowledgement.",
  )
  assert.equal(
    recoveryAcknowledgementObservation.fillAppliedCount,
    1,
    "The canonical BUY fill must already be applied exactly once when broker acknowledgement begins.",
  )
  assert.equal(
    recoveryAcknowledgementObservation.accountAuditDurable,
    true,
    "The RECOVERY account snapshot must be durably flushed before broker acknowledgement.",
  )
  assert.equal(
    recoveryAcknowledgementObservation.openOrdersAuditDurable,
    true,
    "The RECOVERY account-wide open-orders audit must be durably flushed before broker acknowledgement.",
  )
  assert.equal(
    recoveryReconciledStatusEvents.length,
    1,
    "The successful recovery generation must publish exactly one terminal reconciled status.",
  )
  assert.equal(
    recoveryCompletionLogs.length,
    1,
    "The successful recovery generation must emit exactly one application completion diagnostic.",
  )
  assert.equal(
    runtime.userDataReady,
    true,
    "Trading readiness may reopen only after queued events, canonical reconciliation, durable audits, and broker acknowledgement complete.",
  )
  assert.deepEqual(
    readinessTransitions,
    [true, false, true],
    "Readiness must close once for this recovery generation and reopen exactly once after successful global completion.",
  )

  await waitForTestSignal(threeOrdersSubmitted, "three order submissions after the first BUY fill", () => ({
    submittedOrders: submittedOrders.map(({
      side,
      price
    }) => ({
      side,
      price
    })),
    userDataReady: runtime.userDataReady,
    userDataStatus: runtime.userDataStatus,
    errors: runtimeErrors,
  }))
  const secondBuyIntent = submittedOrders.find((order) => order.side === "BUY" && order.clientOrderId !== clientOrderId)
  const canonicalSecondBuy = new CanonicalOrder({
    clientOrderId: secondBuyIntent.clientOrderId,
    brokerOrderId: "broker-" + secondBuyIntent.clientOrderId,
    market: marketMetadata.market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: secondBuyIntent.price,
      asset: marketMetadata.market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: secondBuyIntent.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: secondBuyIntent.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 3,
    completedAt: 3,
  })
  const secondBuyFill = new Fill({
    tradeId: "testnet-second-buy-fill",
    brokerOrderId: canonicalSecondBuy.brokerOrderId,
    clientOrderId: canonicalSecondBuy.clientOrderId,
    market: marketMetadata.market,
    side: "BUY",
    price: new Money({
      amount: secondBuyIntent.price,
      asset: marketMetadata.market.quoteAsset
    }),
    quantity: new Quantity({
      amount: secondBuyIntent.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    quoteQuantity: new Money({
      amount: multiplyDecimal({
        left: secondBuyIntent.price,
        right: secondBuyIntent.quantity
      }),
      asset: marketMetadata.market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  baseBalance = "0.02"
  userDataHandlers.onEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: canonicalSecondBuy,
      fill: secondBuyFill,
    },
  })
  await waitForTestSignal(fiveOrdersSubmitted, "five order submissions after the second BUY fill", () => ({
    submittedOrders: submittedOrders.map(({
      side,
      price
    }) => ({
      side,
      price
    })),
    userDataReady: runtime.userDataReady,
    userDataStatus: runtime.userDataStatus,
    errors: runtimeErrors,
  }))

  const replacementSell = submittedOrders.filter((order) => order.side === "SELL").at(-1)
  assert.equal(replacementSell.side, "SELL")
  const canonicalSell = new CanonicalOrder({
    clientOrderId: replacementSell.clientOrderId,
    brokerOrderId: "broker-" + replacementSell.clientOrderId,
    market: marketMetadata.market,
    side: "SELL",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: replacementSell.price,
      asset: marketMetadata.market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: replacementSell.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: replacementSell.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 4,
    completedAt: 4,
  })
  const sellFill = new Fill({
    tradeId: "testnet-sell-fill",
    brokerOrderId: canonicalSell.brokerOrderId,
    clientOrderId: canonicalSell.clientOrderId,
    market: marketMetadata.market,
    side: "SELL",
    price: new Money({
      amount: replacementSell.price,
      asset: marketMetadata.market.quoteAsset
    }),
    quantity: new Quantity({
      amount: replacementSell.quantity,
      asset: marketMetadata.market.baseAsset
    }),
    quoteQuantity: new Money({
      amount: multiplyDecimal({
        left: replacementSell.price,
        right: replacementSell.quantity
      }),
      asset: marketMetadata.market.quoteAsset,
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })
  baseBalance = "0.001"
  userDataHandlers.onEvent({
    event: {
      eventType: "executionReport",
      executionType: "TRADE",
      executedOrder: canonicalSell,
      fill: sellFill,
    },
  })
  await waitForTestSignal(recoveryCompleted, "recovery.cycle_completed after the SELL fill", () => ({
    submittedOrders: submittedOrders.map(({
      side,
      price
    }) => ({
      side,
      price
    })),
    userDataReady: runtime.userDataReady,
    userDataStatus: runtime.userDataStatus,
    errors: runtimeErrors,
  }))
  assert.ok(runtimeDebug.some(({
    message,
    tradeId
  }) =>
    message === "Execution accounted" && tradeId === "testnet-buy-fill"))
  assert.ok(runtimeDebug.some(({
    message,
    tradeId
  }) =>
    message === "Execution accounted" && tradeId === "testnet-sell-fill"))
  assert.ok(runtimeDebug.some(({ message }) =>
    message === "recovery completion evaluation input"))
  assert.ok(runtimeDebug.some(({ message }) =>
    message === "Recovery cycle completed"))
  await subscriptions.get("BTCUSDT")({
    eventType: "aggTrade",
    symbol: "BTCUSDT",
    price: "65000.12",
    timestamp: 1000,
  })
  // With no active position left, the subsequent market tick preserves the
  // existing trailing-BUY behavior: it replaces the standing BUY. Shutdown
  // then cancels the replacement BUY while leaving recovery SELLs untouched.
  assert.equal(submittedOrders.length, 6, "the completed recovery cycle must leave all six expected BUY and SELL submissions recorded")
  assert.equal(buyCancellationCount.value, 1, "the subsequent market tick must trail the standing BUY once")
  await runtime.stop()
  assert.equal(buyCancellationCount.value, 2, "shutdown must cancel the replacement standing BUY")
  const position = runtime.portfolio.getPosition({ symbol: "BTCUSDT" })
  assert.equal(position.baseQuantity.amount, "0")
  assert.equal(position.freeBaseQuantity.amount, "0.001")
  assert.equal(runtime.getRecoveryLedger({ marketId: marketMetadata.market.id }).buyCost, "0")
  assert.deepEqual(submittedOrders.map((order) => order.side), ["BUY", "SELL", "BUY", "SELL", "BUY", "BUY"])
})


test("logs lifecycle readiness at SYSTEM and routine market evaluation at DEBUG", async () => {
  const calls = []
  const broker = createBroker()
  broker.getOpenOrders = async () => ({
    ok: true,
    data: []
  })
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    now: () => 123,
    logger: {
      debug: (data) => calls.push({
        level: "debug",
        ...data
      }),
      info: (data) => calls.push({
        level: "info",
        ...data
      }),
      system: (data) => calls.push({
        level: "system",
        ...data
      }),
      error: (data) => calls.push({
        level: "error",
        ...data
      }),
    },
  })

  await broker.emitUserDataStatus({
    type: "reconciled",
    recoveryRequired: false
  })
  await broker.emitPrice("BTCUSDT", {
    eventType: "aggTrade",
    symbol: "BTCUSDT",
    price: "65000.12",
    timestamp: 123,
  })
  await broker.emitBookTicker("BTCUSDT", {
    symbol: "BTCUSDT",
    bestBidPrice: "65000.11",
    bestBidQuantity: "1",
    bestAskPrice: "65000.13",
    bestAskQuantity: "1",
    timestamp: 123,
  })
  const systemMessages = calls.filter(({ level }) => level === "system").map(({ message }) => message)
  const debugCalls = calls.filter(({ level }) => level === "debug")
  const marketEvaluations = debugCalls.filter(({ message }) => message === "Market price evaluated")
  const targetMarketEvaluation = marketEvaluations.find(({ price }) => price === "65000.12")
  assert.ok(marketEvaluations.length >= 1)
  assert.ok(targetMarketEvaluation)
  assert.equal(targetMarketEvaluation.level, "debug")
  assert.equal(targetMarketEvaluation.message, "Market price evaluated")
  assert.equal(targetMarketEvaluation.symbol, "BTCUSDT")
  assert.equal(targetMarketEvaluation.price, "65000.12")
  assert.ok(typeof targetMarketEvaluation.action === "string" && targetMarketEvaluation.action.length > 0)
  assert.notEqual(targetMarketEvaluation.action, "UNKNOWN")
  assert.ok(systemMessages.includes("App configuration validated"))
  assert.ok(systemMessages.includes("User-data stream connected"))
  assert.ok(systemMessages.includes("Exchange account snapshot loaded"))
  assert.ok(systemMessages.includes("Conservative TESTNET trading engine activated"))
  assert.ok(systemMessages.includes("Book ticker subscribed"))
  assert.ok(systemMessages.includes("Market data subscribed"))
  const marketEvent = debugCalls.find(({
    message,
    price
  }) =>
    message === "Harvester market price event received" && price === "65000.12")
  const evaluationStarted = debugCalls.find(({
    message,
    marketEventId
  }) =>
    message === "Harvester Conservative evaluation started" &&
    marketEventId === marketEvent?.marketEventId)
  const evaluationDecided = debugCalls.find(({
    message,
    evaluationId
  }) =>
    message === "Harvester Conservative evaluation decided" &&
    evaluationId === evaluationStarted?.evaluationId)
  assert.ok(marketEvent)
  assert.ok(evaluationStarted)
  assert.ok(evaluationDecided)
  assert.equal(marketEvent.symbol, "BTCUSDT")
  assert.equal(marketEvent.price, "65000.12")
  assert.equal(evaluationStarted.marketEventId, marketEvent.marketEventId)
  assert.equal(evaluationStarted.symbol, "BTCUSDT")
  assert.equal(evaluationStarted.marketPrice.price, "65000.12")
  assert.equal(evaluationStarted.lastBuyPrice, null)
  assert.deepEqual(evaluationStarted.activeOrders, [])
  assert.ok(Array.isArray(evaluationStarted.portfolio.positions))
  assert.equal(evaluationDecided.evaluationId, evaluationStarted.evaluationId)
  assert.ok(Array.isArray(evaluationDecided.actions))

  await result.stop()
})

test("retains an explicitly injected application event publisher in TESTNET runtime", async () => {
  const eventPublisher = { publish: () => ({ ok: true }) }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {},
    eventPublisher,
  })

  assert.equal(result.eventPublisher, eventPublisher)
  await result.stop()
})


test("stops broker intake before draining queued user-data and disconnects afterward", async () => {
  const calls = []
  const broker = createBroker(calls)
  const originalSubscribeForPrices = broker.subscribeForPrices.bind(broker)
  let resolveBookUnsubscribe
  const bookUnsubscribed = new Promise((resolve) => { resolveBookUnsubscribe = resolve })
  const originalSubscribeForBookTicker = broker.subscribeForBookTicker.bind(broker)
  broker.subscribeForBookTicker = async (input) => {
    const result = await originalSubscribeForBookTicker(input)
    return {
      ...result,
      data: {
        ...result.data,
        unsubscribe: async () => {
          calls.push("unsubscribe:book:" + input.symbol)
          resolveBookUnsubscribe()
          return result.data.unsubscribe()
        },
      },
    }
  }
  let resolveMarketUnsubscribe
  const marketUnsubscribed = new Promise((resolve) => { resolveMarketUnsubscribe = resolve })
  broker.subscribeForPrices = async (input) => {
    const result = await originalSubscribeForPrices(input)
    return {
      ...result,
      data: {
        ...result.data,
        unsubscribe: async () => {
          calls.push("unsubscribe:" + input.symbol)
          resolveMarketUnsubscribe()
          return result.data.unsubscribe()
        },
      },
    }
  }
  const originalSubscribeForUserData = broker.subscribeForUserData.bind(broker)
  broker.subscribeForUserData = async (handlers) => {
    const result = await originalSubscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        disconnect: async () => {
          calls.push("unsubscribe:user-data")
          return result.data.disconnect()
        },
      },
    }
  }

  let resolveQueue
  const queueGate = new Promise((resolve) => { resolveQueue = resolve })
  let signalQueueStarted
  const queueStarted = new Promise((resolve) => { signalQueueStarted = resolve })
  let queuedEvents = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    onUserDataEvent: async () => {
      queuedEvents += 1
      calls.push("queue:start")
      signalQueueStarted()
      await queueGate
      calls.push("queue:done")
    },
  })

  broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
  await queueStarted
  const stopPromise = runtime.stop()
  await Promise.all([bookUnsubscribed, marketUnsubscribed])

  assert.ok(calls.includes("unsubscribe:book:BTCUSDT"), "shutdown must stop book-ticker intake before draining accepted user-data work")
  assert.ok(calls.includes("unsubscribe:BTCUSDT"), "shutdown must stop market-price intake before draining accepted user-data work")
  assert.equal(calls.includes("unsubscribe:user-data"), false, "user-data intake must remain active until already accepted user-data work has drained")
  assert.equal(calls.includes("queue:done"), false, "shutdown must wait for the deliberately blocked user-data callback before continuing cleanup")
  assert.equal(calls.includes("disconnect"), false, "the broker must remain connected while accepted user-data work is still running")

  broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
  await Promise.resolve()
  assert.equal(queuedEvents, 1, "a second event must not enter the serialized queue while its first callback is still running")

  resolveQueue()
  await stopPromise
  assert.ok(calls.indexOf("unsubscribe:book:BTCUSDT") < calls.indexOf("queue:done"), "book-ticker intake must stop before the accepted user-data callback finishes")
  assert.ok(calls.indexOf("unsubscribe:BTCUSDT") < calls.indexOf("queue:done"), "market-price intake must stop before the accepted user-data callback finishes")
  assert.ok(calls.indexOf("queue:done") < calls.indexOf("unsubscribe:user-data"), "user-data intake may stop only after accepted callbacks have drained")
  assert.ok(calls.indexOf("unsubscribe:user-data") < calls.indexOf("disconnect"), "the user-data subscription must be disconnected before the broker itself")
})


test("logs safe correlation details when an execution report is not owned", async () => {
  const broker = createBroker()
  const errors = []
  const result = await startHarvesterForTest({
    loadConfig: async () => withExternalOrdersPolicy("BTCUSDT", "block"),
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      debug() {},
      error: (entry) => errors.push(entry),
    },
  })
  const metadata = createMarketMetadata("BTCUSDT")
  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-client-id",
    brokerOrderId: "987654",
    market: metadata.market,
    side: "BUY",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "65000",
      asset: metadata.market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "0.01",
      asset: metadata.market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: metadata.market.baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "NEW",
    executionId: 123456,
    executedOrder: externalOrder,
  })
  await new Promise((resolve) => setImmediate(resolve))

  const diagnostic = errors.find((entry) =>
    entry.message === "rejected an unowned or invalid order event")
  assert.ok(diagnostic)
  assert.equal(diagnostic.symbol, "BTCUSDT")
  assert.equal(diagnostic.brokerOrderId, "987654")
  assert.equal(diagnostic.clientOrderId, "external-client-id")
  assert.equal(diagnostic.side, "BUY")
  assert.equal(diagnostic.executionType, "NEW")
  assert.equal(diagnostic.orderStatus, "OPEN")
  assert.equal(diagnostic.executionId, 123456)
  assert.equal(diagnostic.registryMatchedByClientOrderId, false)
  assert.equal(diagnostic.registryMatchedByBrokerOrderId, false)
  assert.equal(diagnostic.clientIdMatchStatus, undefined)
  assert.ok(Array.isArray(diagnostic.errors))

  await assert.rejects(
    result.stop(),
    (error) => {
      assert.ok(error instanceof AggregateError, "shutdown must aggregate cleanup and audit failures instead of reporting success")
      assert.ok(
        error.errors.some((entry) => entry.message.includes("USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE")),
        "the shutdown AggregateError must retain the incomplete user-data/accounting reconciliation reason",
      )
      return true
    },
    "shutdown must report an incomplete CLOSING audit after rejecting an unowned execution report and retaining the accounting-safety gate",
  )
})


test("reconciles the in-memory order registry before reopening trading after stream recovery", async () => {
  const broker = createBroker()
  let acknowledgementCount = 0
  let resolveAcknowledgement
  const acknowledged = new Promise((resolve) => { resolveAcknowledgement = resolve })
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          acknowledgementCount += 1
          handlers.onStatus({
            type: "reconciled",
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveAcknowledgement()
          return true
        },
      },
    }
  }
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {}
    },
  })

  assert.equal(result.userDataReady, true)
  broker.emitUserDataStatus({
    type: "recovered",
    subscriptionId: 17,
    recoveryRequired: true,
    reconciliationRequired: true,
  })
  assert.equal(result.userDataReady, false)
  await waitForTestSignal(acknowledged, "broker recovery acknowledgement", () => ({
    acknowledgementCount,
    userDataStatus: result.userDataStatus,
  }), 2_000)

  assert.equal(acknowledgementCount, 1)
  assert.equal(result.userDataReady, true)
  assert.equal(result.userDataStatus, "READY")
  await result.stop()
})


test("fails closed when TRADING_MODE is missing, before broker construction", async () => {
  let brokerFactoryCalled = false
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: { TRADING_MODE: undefined },
    brokerAdapterFactory: () => { brokerFactoryCalled = true; return createBroker() },
    logger: {
      info() {},
      error() {}
    },
  }), /TRADING_MODE must be set to "testnet" or "live"/)
  assert.equal(brokerFactoryCalled, false)
})


test("normalizes only Binance Spot's definite POST-ONLY rejection", async () => {
  const client = {
    connect: async () => {},
    disconnect: async () => {},
    createOrder: async () => ({ ok: true }),
    cancelOrder: async () => ({ ok: true }),
    getOpenOrders: async () => ({
      ok: true,
      data: []
    }),
    getFills: async () => ({ ok: true }),
    getCanonicalOrderHistory: async () => ({ ok: true }),
    getCanonicalOrder: async () => ({
      ok: false,
      errors: [new Error("order not found")]
    }),
    getAccountSnapshot: async () => ({ ok: true }),
    getSymbolFilters: async () => ({ ok: true }),
    getExchangeMarkets: async () => ({
      ok: true,
      data: []
    }),
    getPrices: async () => ({ ok: true }),
    getCandles: async () => ({
      ok: true,
      data: []
    }),
    subscribeForPrices: async () => ({ ok: true }),
    subscribeForCandles: async () => ({
      ok: true,
      data: { unsubscribe: async () => {} }
    }),
    subscribeForBookTicker: async () => ({ ok: true }),
    subscribeForUserData: async () => ({ ok: true }),
  }
  const broker = createBinanceBrokerAdapter({
    config: {
      apiKey: "test-key",
      apiSecret: "test-secret",
      tradingMode: "testnet"
    },
    brokerFactory: () => client,
  })
  const rejection = Object.assign(new Error("Order would immediately match and take."), { code: -2010 })
  client.createCanonicalOrder = async () => ({
    ok: false,
    errors: [rejection]
  })
  const result = await broker.placeOrder({ order: {
    symbol: "BTCUSDT",
    type: "LIMIT_MAKER"
  } })
  assert.equal(result.errors[0].code, "POST_ONLY_WOULD_TAKE")
  const unrelated = Object.assign(new Error("insufficient balance"), { code: -2010 })
  client.createCanonicalOrder = async () => ({
    ok: false,
    errors: [unrelated]
  })
  const other = await broker.placeOrder({ order: {
    symbol: "BTCUSDT",
    type: "LIMIT_MAKER"
  } })
  assert.equal(other.errors[0], unrelated)

  const unknownOutcome = Object.assign(
    new Error("Order would immediately match and take."),
    {
      code: -2010,
      outcomeUnknown: true
    },
  )
  client.createCanonicalOrder = async () => ({
    ok: false,
    errors: [unknownOutcome]
  })
  const unknown = await broker.placeOrder({ order: {
    symbol: "BTCUSDT",
    type: "LIMIT_MAKER"
  } })
  assert.equal(unknown.errors[0], unknownOutcome)

  let forwardedSubscription
  const onBookTicker = () => {}
  client.subscribeForBookTicker = async (input) => {
    forwardedSubscription = input
    return {
      ok: true,
      data: { unsubscribe: async () => {} }
    }
  }
  await broker.subscribeForBookTicker({
    symbol: "BTCUSDT",
    onBookTicker
  })
  assert.equal(forwardedSubscription.symbol, "BTCUSDT")
  assert.equal(forwardedSubscription.onBookTicker, onBookTicker)
})



test("emits per-execution debug audit records with commission and before/after accounting", async () => {
  const debugRecords = []
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {},
    logger: {
      info() {},
      error() {},
      debug(record) { debugRecords.push(record) },
    },
  })

  const fill = createFill({
    tradeId: "audited-trade",
    quantity: "0.01"
  })
  const applied = await result.updateTradingAccounting({ fill })

  assert.equal(applied.ok, true)
  const received = debugRecords.find((record) =>
    record.message === "Execution received")
  const committed = debugRecords.find((record) =>
    record.message === "Execution accounted")

  assert.equal(received.executionId, fill.id)
  assert.equal(received.tradeId, "audited-trade")
  assert.equal(received.symbol, "BTCUSDT")
  assert.equal(received.side, "BUY")
  assert.equal(received.liquidityRole, "UNKNOWN")
  assert.equal(received.executedAt, undefined)
  assert.equal(received.quantity, "0.01")
  assert.equal(received.quoteQuantity, "650")
  assert.equal(received.commissionStatus, "COMPLETE")
  assert.deepEqual(received.commissions, [])
  assert.equal(received.previousRecoveryLedger.legacyBuyCostMirror, "0")
  assert.equal(committed.applied, true)
  assert.equal(committed.duplicate, false)
  assert.equal(committed.nextRecoveryLedger.legacyBuyCostMirror, "650")
  assert.equal(committed.nextRecoveryLedger.netSellProceeds, "0")
  assert.equal(committed.accountingDelta.portfolioActiveBase, "0.01")
  assert.equal(committed.accountingDelta.positionSpent, "650")
  assert.equal(committed.accountingDelta.netSellProceeds, "0")
  assert.equal(committed.accountingDelta.outstandingRecoveryAmount, "650")
  assert.equal(committed.accountingDelta.realizedNetProfit, "-650")

  await assert.rejects(result.stop(), /Harvester shutdown was incomplete/)
  assert.equal(result.userDataStatus, "SHUTDOWN_INCOMPLETE")
})


test("disconnects after a CLOSING snapshot durability failure and reports shutdown incomplete", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  let flushCount = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => {
        flushCount += 1
        calls.push("journal:flush:" + flushCount)
        return flushCount < 3
          ? {
            ok: true,
            durable: true
          }
          : {
            ok: false,
            errors: [new Error("closing snapshot fsync failed")]
          }
      },
    },
    now: () => 1000,
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  await assert.rejects(runtime.stop(), /Harvester shutdown was incomplete/)

  const snapshots = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(flushCount, 3)
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[0].data.phase, "PREFLIGHT")
  assert.equal(snapshots[1].data.phase, "CLOSING")
  assert.ok(calls.indexOf("disconnect") > calls.lastIndexOf("account:snapshot"))
  assert.equal(calls.includes("disconnect"), true)
})

test("marks CLOSING account audit INCOMPLETE when owned-order REST reconciliation fails", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  const btcMarket = createMarketMetadata("BTCUSDT").market
  let releaseOpenOrders
  let signalOpenOrdersStarted
  const openOrdersGate = new Promise((resolve) => { releaseOpenOrders = resolve })
  const openOrdersStarted = new Promise((resolve) => { signalOpenOrdersStarted = resolve })
  broker.getOpenOrders = async ({ symbol } = {}) => {
    if (symbol === undefined) {return {
      ok: true,
      data: []
    }}
    signalOpenOrdersStarted()
    await openOrdersGate
    return { ok: true }
  }
  broker.placeOrder = async ({ order }) => {
    calls.push("placeOrder:" + order.side)
    return {
      ok: true,
      data: new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: "broker-" + order.clientOrderId,
        market: btcMarket,
        side: order.side,
        type: order.type,
        limitPrice: new Money({
          amount: order.price,
          asset: btcMarket.quoteAsset
        }),
        originalQuantity: new Quantity({
          amount: order.quantity,
          asset: btcMarket.baseAsset
        }),
        executedQuantity: new Quantity({
          amount: "0",
          asset: btcMarket.baseAsset
        }),
        status: "OPEN",
        createdAt: 1,
        acknowledgedAt: 1,
        updatedAt: 1,
      }),
    }
  }
  makeVolatilityReadyBroker(broker, ["BTCUSDT"])
  const config = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          BTCUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
            investment: 2000,
          },
        },
      },
    },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => ({
        ok: true,
        durable: true
      }),
    },
    now: () => 1000,
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  await broker.emitBookTicker("BTCUSDT", {
    symbol: "BTCUSDT",
    bestBidPrice: "64999",
    bestBidQuantity: "1",
    bestAskPrice: "65001",
    bestAskQuantity: "1",
    timestamp: 1000,
  })
  await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000",
    timestamp: 1000,
  })
  assert.ok(calls.includes("placeOrder:BUY"), "the fixture must create an acknowledged strategy-owned BUY before graceful shutdown begins")

  const stopPromise = runtime.stop()
  await openOrdersStarted
  assert.equal(events.filter((event) => event.name === "account.snapshot_captured").length, 1)
  assert.equal(calls.includes("disconnect"), false)
  releaseOpenOrders()
  await assert.rejects(stopPromise, /Harvester shutdown was incomplete/, "shutdown must reject when owned-order REST reconciliation remains unresolved after the pending query completes")

  const snapshots = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[1].data.phase, "CLOSING")
  assert.equal(snapshots[1].data.auditStatus, "INCOMPLETE")
  assert.ok(snapshots[1].data.auditReasons.includes("OWNED_ORDER_RECONCILIATION_FAILED"))
  assert.equal(
    snapshots[1].data.auditReasons.includes("UNRESOLVED_OWNED_ORDERS:1"),
    false,
    "the cancellation pass must resolve the BUY order even though the earlier REST reconciliation failure keeps the CLOSING audit incomplete",
  )
  assert.ok(calls.indexOf("disconnect") > calls.lastIndexOf("account:snapshot"))
})

test("journals PREFLIGHT balances and open orders before trading and CLOSING balances before broker disconnect", async () => {
  const calls = []
  const broker = createBroker(calls)
  let openOrderReads = 0
  const getOpenOrders = broker.getOpenOrders
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    assert.deepEqual(input, {})
    return getOpenOrders(input)
  }
  const events = []
  const eventPublisher = {
    publish: (event) => {
      events.push(event)
      calls.push("publish:" + event.name)
      return { ok: true }
    },
    flush: async () => {
      calls.push("journal:flush")
      return {
        ok: true,
        durable: true
      }
    },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  const openingEvent = events.find((event) => event.name === "account.snapshot_captured")
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 1)
  assert.equal(openOrderReads, 1)
  assert.equal(events.filter((event) => event.name === "account.snapshot_captured" && event.data.phase === "PREFLIGHT").length, 1)
  assert.equal(events.filter((event) => event.name === "account.open_orders_captured" && event.data.phase === "PREFLIGHT").length, 1)
  assert.equal(openingEvent.data.phase, "PREFLIGHT")
  const openOrdersEvent = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(openOrdersEvent.data.readiness, "READY")
  assert.equal(openOrdersEvent.data.orderCount, 0)
  assert.deepEqual(openOrdersEvent.data.orders, [])
  assert.equal(openingEvent.data.auditStatus, "COMPLETE")
  assert.ok(openingEvent.data.balances.some((balance) => balance.asset === "BTC"))
  assert.ok(openingEvent.data.balances.some((balance) => balance.asset === "USDT"))
  const openingPublishIndex = calls.indexOf("publish:account.snapshot_captured")
  const openingFlushIndex = calls.indexOf("journal:flush")
  const firstMarketSubscriptionIndex = calls.findIndex((call) => call.startsWith("subscribe:book:"))
  assert.ok(openingPublishIndex >= 0)
  assert.ok(openingFlushIndex > openingPublishIndex)
  assert.ok(firstMarketSubscriptionIndex > calls.lastIndexOf("journal:flush"))

  await runtime.stop()

  const snapshotEvents = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(snapshotEvents.length, 2)
  assert.equal(snapshotEvents[1].data.phase, "CLOSING")
  assert.equal(snapshotEvents[1].data.auditStatus, "COMPLETE")
  const closingFlushIndex = calls.lastIndexOf("journal:flush")
  const disconnectIndex = calls.indexOf("disconnect")
  assert.ok(closingFlushIndex >= 0)
  assert.ok(disconnectIndex > closingFlushIndex)
})


test("fails startup before market subscriptions when PREFLIGHT account snapshot cannot be durably flushed", async () => {
  const calls = []
  const broker = createBroker(calls)
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: () => ({ ok: true }),
      flush: async () => ({
        ok: false,
        errors: [new Error("fsync failed")]
      }),
    },
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  }), /Unable to durably persist PREFLIGHT account snapshot/)
  assert.ok(calls.includes("disconnect"))
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
})


test("journals pre-existing account-wide orders and allows trading startup without adopting or changing them", async () => {
  const calls = []
  const broker = createBroker(calls)
  let cancelCalls = 0
  let placeCalls = 0
  broker.getOpenOrders = async (input = {}) => {
    calls.push("open-orders:account-wide:" + String(input.symbol))
    return {
      ok: true,
      data: [{
        clientOrderId: "manual-zro-sell",
        id: "699694",
        symbol: "ZROUSDT",
        side: "SELL",
        type: "LIMIT",
        originalPrice: "1.82800000",
        originalQuantity: "4.98000000",
        executedQuantity: "0.00000000",
        status: "NEW",
      }],
    }
  }
  broker.cancelOrder = async () => { cancelCalls += 1; return { ok: true } }
  broker.placeOrder = async () => { placeCalls += 1; return { ok: true } }
  const events = []
  const eventPublisher = {
    publish: (event) => { events.push(event); return { ok: true } },
    flush: async () => ({
      ok: true,
      durable: true
    }),
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => ({
      ...appConfig,
      strategies: {
        ...appConfig.strategies,
        CG_coinGrabber: {
          ...appConfig.strategies.CG_coinGrabber,
          pairs: {
            ...appConfig.strategies.CG_coinGrabber.pairs,
            BTCUSDT: {
              ...appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
              enabled: true
            },
          },
        },
      },
    }),
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  const openingBalances = events.find((event) => event.name === "account.snapshot_captured")
  const openOrders = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(openingBalances.data.phase, "PREFLIGHT", "trading startup must retain the durable account PREFLIGHT snapshot")
  assert.equal(openOrders.data.readiness, "BLOCKED", "the audit must explicitly classify the unmatched exchange order as unowned")
  assert.deepEqual(openOrders.data.blockReasons, ["UNOWNED_OPEN_ORDERS:1"], "the Journal must preserve why the existing order is not considered Harvester-owned")
  assert.equal(openOrders.data.orderCount, 1, "the account-wide audit must record the pre-existing order")
  assert.equal(openOrders.data.orders[0].brokerOrderId, "699694", "the audit must preserve the exact external broker order ID")
  assert.ok(calls.includes("open-orders:account-wide:undefined"), "startup must inspect open orders account-wide without a symbol filter")
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), true, "an unowned open order must not prevent market-book subscriptions")
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), true, "an unowned open order must not prevent market-price subscriptions")
  assert.equal(cancelCalls, 0, "startup must never cancel a pre-existing unowned exchange order")
  assert.equal(placeCalls, 0, "startup must not submit an order merely because an external order was observed")
  assert.equal(runtime.connected, true, "the trading runtime must start while leaving the external order unadopted")
  await runtime.stop()
  assert.ok(calls.includes("disconnect"), "the test must close the broker connection after verifying startup")
})

test("fails closed before market subscriptions when the account-wide open-order query fails", async () => {
  const calls = []
  const broker = createBroker(calls)
  const events = []
  broker.getOpenOrders = async () => ({
    ok: false,
    errors: [new Error("Binance openOrders.status unavailable")],
  })
  await assert.rejects(startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => ({
        ok: true,
        durable: true
      }),
    },
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  }), /Unable to load authoritative account-wide open orders/)
  assert.ok(events.some((event) => event.name === "account.snapshot_captured"))
  assert.equal(events.some((event) => event.name === "account.open_orders_captured"), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:book:")), false)
  assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  assert.ok(calls.includes("disconnect"))
})

 
test("captures and durably journals balances and account-wide open orders on trading startup", async () => {
  const calls = []
  const broker = createBroker(calls)
  let accountReads = 0
  let openOrderReads = 0
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    calls.push("account:snapshot")
    return {
      ok: true,
      data: {
        balances: ["BTC", "ETH", "USDT"].map((code) => {
          const asset = new Asset({
            id: "asset:" + code,
            code
          })
          return new Balance({
            free: new Quantity({
              amount: "12.5",
              asset
            }),
            locked: new Quantity({
              amount: "0.5",
              asset
            }),
          })
        }),
        sourceTime: 123,
      },
    }
  }
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    calls.push("account:open-orders")
    assert.deepEqual(input, {})
    return {
      ok: true,
      data: []
    }
  }
  const events = []
  let flushCount = 0
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        calls.push("publish:" + event.name)
        return { ok: true }
      },
      flush: async () => {
        flushCount += 1
        calls.push("journal:flush:" + flushCount)
        return {
          ok: true,
          durable: true
        }
      },
    },
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  assert.equal(accountReads, 1)
  assert.equal(openOrderReads, 1)
  assert.equal(flushCount, 2)
  const balances = events.filter((event) => event.name === "account.snapshot_captured")
  const openOrders = events.filter((event) => event.name === "account.open_orders_captured")
  assert.equal(balances.length, 1)
  assert.equal(openOrders.length, 1)
  assert.equal(balances[0].data.phase, "PREFLIGHT")
  assert.equal(openOrders[0].data.phase, "PREFLIGHT")
  assert.equal(openOrders[0].data.readiness, "READY")
  assert.equal(balances[0].data.balances.find((item) => item.asset === "BTC").total, "13")
  const lastAuditFlush = calls.lastIndexOf("journal:flush:2")
  const marketSubscription = calls.findIndex((call) => call === "subscribe:BTCUSDT")
  assert.ok(lastAuditFlush >= 0)
  assert.ok(marketSubscription > lastAuditFlush)

  await runtime.stop()
})

test("records pre-existing account-wide orders without adopting or changing them", async () => {
  const calls = []
  const broker = createBroker(calls)
  let cancelCalls = 0
  let placeCalls = 0
  broker.getOpenOrders = async () => ({
    ok: true,
    data: [{
      id: "external-order-77",
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      originalPrice: "65000.12",
      originalQuantity: "0.01",
      executedQuantity: "0",
      status: "NEW",
    }],
  })
  broker.cancelOrder = async () => { cancelCalls += 1; return { ok: true } }
  broker.placeOrder = async () => { placeCalls += 1; return { ok: true } }
  const events = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => { events.push(event); return { ok: true } },
      flush: async () => ({
        ok: true,
        durable: true
      }),
    },
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  const audit = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(audit.data.readiness, "BLOCKED")
  assert.deepEqual(audit.data.blockReasons, ["UNOWNED_OPEN_ORDERS:1"])
  assert.equal(audit.data.orders[0].brokerOrderId, "external-order-77")
  assert.equal(cancelCalls, 0)
  assert.equal(placeCalls, 0)
  assert.equal(runtime.connected, true)

  await runtime.stop()
})

test("blocks trading startup when either account audit query fails", async () => {
  for (const failure of ["balances", "open-orders"]) {
    const calls = []
    const broker = createBroker(calls)
    if (failure === "balances") {
      broker.getAccountSnapshot = async () => ({
        ok: false,
        errors: [new Error("account status failed")]
      })
    } else {
      broker.getOpenOrders = async () => ({
        ok: false,
        errors: [new Error("open orders status failed")]
      })
    }

    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      logger: {
        info() {},
        error() {},
        debug() {}
      },
    }), failure === "balances"
      ? /Unable to load canonical exchange account balances/
      : /Unable to load authoritative account-wide open orders/)
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
})

test("blocks trading startup when either PREFLIGHT audit event cannot be durably flushed", async () => {
  for (const scenario of [{
    failedFlush: 1,
    nonOperationalState: false
  }, {
    failedFlush: 1,
    nonOperationalState: true
  }, {
    failedFlush: 2,
    nonOperationalState: true
  }]) {
    const {
      failedFlush,
      nonOperationalState
    } = scenario
    const calls = []
    const broker = createBroker(calls)
    const events = []
    let flushCount = 0
    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      eventPublisher: {
        publish: (event) => { events.push(event); return { ok: true } },
        flush: async () => {
          flushCount += 1
          if (flushCount !== failedFlush) {return {
            ok: true,
            durable: true
          }}
          return nonOperationalState
            ? {
              ok: true,
              durable: false
            }
            : {
              ok: false,
              errors: [new Error("journal fsync failed")]
            }
        },
      },
      logger: {
        info() {},
        error() {},
        debug() {}
      },
    }), failedFlush === 1
      ? /Unable to durably persist PREFLIGHT account snapshot/
      : /Unable to durably persist account open-orders audit/)
    assert.equal(events.some((event) => event.name === "account.snapshot_captured"), true)
    if (failedFlush === 2) {
      assert.equal(events.some((event) => event.name === "account.open_orders_captured"), true)
    }
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
})


test("blocks trading startup when either PREFLIGHT audit event publication fails", async () => {
  for (const failedEvent of ["account.snapshot_captured", "account.open_orders_captured"]) {
    const calls = []
    const broker = createBroker(calls)
    const events = []
    await assert.rejects(startHarvesterForTest({
      loadConfig: async () => appConfig,
      env: binanceEnv,
      brokerAdapterFactory: () => broker,
      eventPublisher: {
        publish: (event) => {
          events.push(event)
          return event.name === failedEvent
            ? {
              ok: false,
              errors: [new Error("event publication rejected")]
            }
            : { ok: true }
        },
        flush: async () => ({
          ok: true,
          durable: true
        }),
      },
      logger: {
        info() {},
        error() {},
        debug() {}
      },
    }), failedEvent === "account.snapshot_captured"
      ? /Unable to publish PREFLIGHT account snapshot audit event/
      : /Unable to publish account open-orders audit event/)
    assert.equal(calls.includes("disconnect"), true)
    assert.equal(calls.some((call) => call.startsWith("subscribe:BTCUSDT")), false)
  }
})


test("starts from fresh in-memory state without replaying historical Journal records", async () => {
  const calls = []
  const broker = createBroker(calls)
  const historicalReads = []
  broker.getCanonicalOrder = async () => {
    historicalReads.push("getCanonicalOrder")
    return {
      ok: false,
      errors: [new Error("not found")]
    }
  }
  broker.getCanonicalOrderHistory = async () => {
    historicalReads.push("getCanonicalOrderHistory")
    return {
      ok: true,
      data: []
    }
  }
  broker.getFills = async () => {
    historicalReads.push("getFills")
    return {
      ok: true,
      data: []
    }
  }
  broker.getExchangeMarkets = async () => {
    historicalReads.push("getExchangeMarkets")
    return {
      ok: true,
      data: []
    }
  }

  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    // Historical records are deliberately ignored; restart recovery is disabled.
    journalRecoveryRecords: [{
      id: "malformed-historical-record",
      payload: {
        id: "malformed-historical-record",
        name: "execution.fill_applied",
        data: { fillId: "legacy-fill-without-tradeId" },
      },
      position: {
        fileName: "session.jsonl",
        lineNumber: 1
      },
    }],
    logger: {
      info() {},
      error() {}
    },
  })

  assert.equal(runtime.tradingEnabled, true)
  assert.equal(runtime.userDataReady, true)
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT"])
  assert.deepEqual(historicalReads, [])
  assert.equal(calls.includes("account:snapshot"), true)
  assert.equal(calls.includes("subscribe:user-data"), true)
  assert.equal(calls.includes("subscribe:book:BTCUSDT"), true)
  assert.equal(calls.includes("subscribe:BTCUSDT"), true)

  await runtime.stop()
})

test("keeps user-data intake active until shutdown BUY cancellation and fill reconciliation finish", async () => {
  const calls = []
  const broker = createBroker(calls)
  const market = createMarketMetadata("BTCUSDT").market
  let resolveCancelStarted
  let releaseCancel
  let resolveUserDataObserved
  const cancelStarted = new Promise((resolve) => { resolveCancelStarted = resolve })
  const cancelGate = new Promise((resolve) => { releaseCancel = resolve })
  const userDataObserved = new Promise((resolve) => { resolveUserDataObserved = resolve })
  const observedEvents = []
  let submittedOrder
  let canceledOrder
  broker.getOpenOrders = async () => ({
    ok: true,
    data: submittedOrder && !canceledOrder
      ? [createOpenOrderSnapshot({ order: submittedOrder })]
      : [],
  })
  broker.getCanonicalOrderHistory = async ({ orderId }) => ({
    ok: true,
    data: [canceledOrder ?? submittedOrder].filter((order) => order?.brokerOrderId === orderId),
  })
  broker.placeOrder = async ({ order }) => {
    calls.push("placeOrder:" + order.side)
    submittedOrder = new CanonicalOrder({
        clientOrderId: order.clientOrderId,
        brokerOrderId: "broker-" + order.clientOrderId,
        market,
        side: order.side,
        type: order.type,
        limitPrice: new Money({
          amount: order.price,
          asset: market.quoteAsset
        }),
        originalQuantity: new Quantity({
          amount: order.quantity,
          asset: market.baseAsset
        }),
        executedQuantity: new Quantity({
          amount: "0",
          asset: market.baseAsset
        }),
        status: "OPEN",
        createdAt: 1,
        acknowledgedAt: 1,
        updatedAt: 1,
      })
    return {
      ok: true,
      data: submittedOrder
    }
  }
  broker.cancelOrder = async ({ order }) => {
    calls.push("cancelOrder:" + order.side)
    resolveCancelStarted()
    await cancelGate
    canceledOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      market,
      side: order.side,
      type: order.type,
      limitPrice: order.limitPrice,
      originalQuantity: order.originalQuantity,
      executedQuantity: order.executedQuantity,
      status: "CANCELED",
      createdAt: order.createdAt,
      acknowledgedAt: order.acknowledgedAt,
      updatedAt: 2,
      completedAt: 2,
    })
    return {
      ok: true,
      data: canceledOrder
    }
  }

  makeVolatilityReadyBroker(broker, ["BTCUSDT"])
  const config = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          BTCUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
            orderQuantity: 0.001,
          },
        },
      },
    },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    now: () => 1000,
    onUserDataEvent: async ({ event }) => {
      observedEvents.push(event)
      resolveUserDataObserved()
    },
    logger: {
      info() {},
      debug() {},
      error() {}
    },
  })

  await broker.emitBookTicker("BTCUSDT", {
    symbol: "BTCUSDT",
    bestBidPrice: "64900",
    bestBidQuantity: "1",
    bestAskPrice: "65100",
    bestAskQuantity: "1",
    timestamp: 1000,
  })
  await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000",
    timestamp: 1000,
  })
  assert.ok(calls.includes("placeOrder:BUY"), "the fixture must create an acknowledged strategy-owned BUY before graceful shutdown begins")

  const stopPromise = runtime.stop()
  let testError
  try {
    await waitForTestSignal(cancelStarted, "shutdown BUY cancellation", () => ({ calls }))
    broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
    await waitForTestSignal(userDataObserved, "user-data event during shutdown", () => ({
      observedEvents: observedEvents.length,
      calls,
    }))

    assert.equal(observedEvents.length, 1, "the user-data event delivered during the broker cancellation window must reach the application handler")
    assert.equal(calls.includes("unsubscribe:user-data"), false, "user-data intake must remain subscribed until cancellation and fill reconciliation have completed")
    assert.ok(calls.indexOf("unsubscribe:BTCUSDT") < calls.indexOf("cancelOrder:BUY"), "market-price intake must stop before the shutdown BUY cancellation request is sent")
    assert.equal(calls.includes("cancelOrder:SELL"), false, "graceful shutdown must never cancel a strategy-owned SELL recovery order")
  } catch (error) {
    testError = error
  } finally {
    releaseCancel()
  }

  let stopError
  try {
    await stopPromise
  } catch (error) {
    stopError = error
  }
  if (testError) {throw testError}
  if (stopError) {throw stopError}

  assert.ok(calls.indexOf("cancelOrder:BUY") < calls.indexOf("unsubscribe:user-data"), "the BUY cancellation request must complete before user-data intake is disconnected")
  assert.ok(calls.indexOf("unsubscribe:user-data") < calls.indexOf("disconnect"), "user-data intake must be disconnected only after cancellation reconciliation and before broker disconnect")
})


test("cancels acknowledged Harvester BUY orders across markets after an unowned external execution closes the global accounting gate", async () => {
  const calls = []
  const broker = createBroker(calls)
  const cancelledBrokerOrderIds = []
  let resolveOwnedBuyAcknowledged
  const ownedBuyAcknowledged = new Promise((resolve) => {
    resolveOwnedBuyAcknowledged = resolve
  })
  let resolveOwnedBuyCancellation
  const ownedBuyCancellation = new Promise((resolve) => {
    resolveOwnedBuyCancellation = resolve
  })

  broker.getPrices = async ({ symbol } = {}) => ({
    ok: true,
    data: {
      symbol,
      price: "6500"
    },
  })
  broker.placeOrder = async ({ order } = {}) => {
    const metadata = createMarketMetadata(order.symbol)
    const acknowledgedOrder = new CanonicalOrder({
      clientOrderId: order.clientOrderId,
      brokerOrderId: "owned-buy-1",
      market: metadata.market,
      side: order.side,
      type: order.type,
      limitPrice: new Money({
        amount: order.price,
        asset: metadata.market.quoteAsset
      }),
      originalQuantity: new Quantity({
        amount: order.quantity,
        asset: metadata.market.baseAsset
      }),
      executedQuantity: new Quantity({
        amount: "0",
        asset: metadata.market.baseAsset
      }),
      status: "OPEN",
      createdAt: 1,
      acknowledgedAt: 1,
      updatedAt: 1,
    })
    broker.emitUserDataEvent({
      eventType: "executionReport",
      executionType: "NEW",
      executedOrder: acknowledgedOrder,
    })
    return {
      ok: true,
      data: acknowledgedOrder
    }
  }
  const cancelOrder = broker.cancelOrder
  broker.cancelOrder = async ({ order } = {}) => {
    cancelledBrokerOrderIds.push(order.brokerOrderId)
    const result = await cancelOrder({ order })
    if (order.brokerOrderId === "owned-buy-1") {resolveOwnedBuyCancellation(order.brokerOrderId)}
    return result
  }

  makeVolatilityReadyBroker(broker, ["BTCUSDT", "ETHUSDT"])
  const appConfigWithRegularLimitBuys = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          ETHUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.ETHUSDT,
            externalOrdersPolicy: "block",
          },
          BTCUSDT: {
            ...appConfig.strategies.CG_coinGrabber.pairs.BTCUSDT,
            makerPercent: 0.1,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
  const journalEvents = []
  const result = await startHarvesterForTest({
    loadConfig: async () => appConfigWithRegularLimitBuys,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        journalEvents.push(event)
        return { ok: true }
      },
      flush: async () => ({
        ok: true,
        durable: true
      }),
    },
    onUserDataEvent: ({ event } = {}) => {
      if (event?.executionType === "NEW" && event.executedOrder?.brokerOrderId === "owned-buy-1") {
        resolveOwnedBuyAcknowledged(event.executedOrder)
      }
    },
    logger: {
      info() {},
      debug() {},
      error() {}
    },
  })

  // The initial REST ticker seed arrives before candle warm-up. Submit a fresh
  // price after the market's volatility snapshot becomes ready to exercise the
  // ownership-failure cancellation path rather than bypassing the safety gate.
  await broker.emitPrice("BTCUSDT", {
    symbol: "BTCUSDT",
    price: "65000",
    timestamp: Date.now(),
  })

  await waitForTestSignal(
    ownedBuyAcknowledged,
    "acknowledged Harvester BUY before the ownership failure",
    () => ({
      calls,
      userDataStatus: result.userDataStatus
    }),
    2_000,
  )
  assert.deepEqual(
    (await broker.getOpenOrders({})).data.map((order) => order.id),
    ["owned-buy-1"],
    "the regression scenario must have one acknowledged Harvester-owned BUY resting before the external execution arrives",
  )

  const metadata = createMarketMetadata("ETHUSDT")
  const externalOrder = new CanonicalOrder({
    clientOrderId: "external-client-id",
    brokerOrderId: "987654",
    market: metadata.market,
    side: "SELL",
    type: "LIMIT",
    limitPrice: new Money({
      amount: "1.639",
      asset: metadata.market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "59.87",
      asset: metadata.market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "59.87",
      asset: metadata.market.baseAsset
    }),
    status: "FILLED",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
    completedAt: 1,
  })
  const externalFill = new Fill({
    tradeId: "external-trade-1",
    brokerOrderId: externalOrder.brokerOrderId,
    clientOrderId: externalOrder.clientOrderId,
    market: metadata.market,
    side: "SELL",
    price: new Money({
      amount: "1.639",
      asset: metadata.market.quoteAsset
    }),
    quantity: new Quantity({
      amount: "59.87",
      asset: metadata.market.baseAsset
    }),
    quoteQuantity: new Money({
      amount: "98.12693",
      asset: metadata.market.quoteAsset
    }),
    commissions: [],
    commissionStatus: "COMPLETE",
  })

  broker.emitUserDataEvent({
    eventType: "executionReport",
    executionType: "TRADE",
    executionId: "external-trade-1",
    executedOrder: externalOrder,
    fill: externalFill,
  })

  await waitForTestSignal(
    ownedBuyCancellation,
    "safety cancellation of the acknowledged Harvester BUY",
    () => ({
      cancelledBrokerOrderIds,
      userDataStatus: result.userDataStatus,
      userDataReady: result.userDataReady,
    }),
    2_000,
  )

  assert.deepEqual(
    cancelledBrokerOrderIds,
    ["owned-buy-1"],
    "an account-integrity failure must cancel the Harvester-owned BUY without ever canceling the unowned external order",
  )
  assert.equal(
    result.userDataReady,
    false,
    "canceling resting BUY exposure must not reopen trading while execution ownership/accounting remains unsafe",
  )
  assert.equal(
    result.userDataStatus,
    "EXECUTION_ACCOUNTING_FAILED",
    "the original execution-accounting failure must remain visible after safety cancellation",
  )
  assert.equal(
    (await broker.getOpenOrders({})).data.length,
    0,
    "the owned BUY must reach a broker-confirmed terminal state before the safety halt is considered complete",
  )
  assert.ok(
    journalEvents.some((event) => event.name === "order.cancel_requested"),
    "the emergency BUY cancellation must preserve the durable cancellation-intent journal barrier",
  )

  await assert.rejects(
    result.stop(),
    (error) => {
      assert.ok(error instanceof AggregateError, "shutdown must aggregate the unresolved account-integrity state instead of reporting success")
      assert.ok(
        error.errors.some((entry) => entry.message.includes("USER_DATA_OR_ACCOUNTING_RECONCILIATION_INCOMPLETE")),
        "the closing audit must retain the original user-data/accounting reconciliation failure after BUY cancellation",
      )
      return true
    },
    "the runtime must remain fail-closed at shutdown even after all owned BUY exposure has been canceled",
  )
})


test("account snapshots include every configured pair asset, including disabled pairs, and exclude unrelated wallet assets", async () => {
  const calls = []
  const broker = createBroker(calls)
  const configuredMarkets = ["BTCUSDT", "ETHUSDT", "DOGEUSDT", "ZROFDUSD", "SOLFDUSD"]
  const snapshotConfig = {
    ...appConfig,
    strategies: {
      ...appConfig.strategies,
      CG_coinGrabber: {
        ...appConfig.strategies.CG_coinGrabber,
        pairs: {
          ...appConfig.strategies.CG_coinGrabber.pairs,
          DOGEUSDT: {
            enabled: false,
            tradingEnvironment: "both",
            enableVolatilityProtection: true,
            investment: 100,
            orderQuantity: 400,
            keepQuantity: 1,
            minProfit: 0.01,
            priceStepPercent: 0.05,
            pricePrecision: 5,
            quantityPrecision: 0,
            makerPercent: 0,
            takerPercent: 0.1,
          },
          ZROFDUSD: {
            enabled: false,
            tradingEnvironment: "both",
            enableVolatilityProtection: true,
            investment: 100,
            orderQuantity: 5,
            keepQuantity: 0.01,
            minProfit: 0.01,
            priceStepPercent: 0.5,
            pricePrecision: 3,
            quantityPrecision: 1,
            makerPercent: 0,
            takerPercent: 0.1,
          },
          SOLFDUSD: {
            enabled: false,
            tradingEnvironment: "both",
            enableVolatilityProtection: true,
            investment: 100,
            orderQuantity: 1,
            keepQuantity: 0.01,
            minProfit: 0.01,
            priceStepPercent: 0.05,
            pricePrecision: 2,
            quantityPrecision: 3,
            makerPercent: 0,
            takerPercent: 0.1,
          },
        },
      },
    },
  }
  const assetsByCode = new Map()
  for (const symbol of configuredMarkets) {
    const { market } = createMarketMetadata(symbol)
    assetsByCode.set(market.baseAsset.code, market.baseAsset)
    assetsByCode.set(market.quoteAsset.code, market.quoteAsset)
  }
  const unrelatedAsset = new Asset({
    id: "asset:XRP",
    code: "XRP"
  })
  const sourceBalances = [...assetsByCode.values(), unrelatedAsset].map((asset) => new Balance({
    free: new Quantity({
      amount: "10",
      asset
    }),
    locked: new Quantity({
      amount: "0",
      asset
    }),
  }))
  broker.getAccountSnapshot = async () => ({
    ok: true,
    data: {
      balances: sourceBalances,
      sourceTime: 1
    },
  })

  const events = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => snapshotConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development"
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        return { ok: true }
      },
      flush: async () => ({
        ok: true,
        durable: true
      }),
    },
    logger: {
      info() {},
      error() {},
      debug() {}
    },
  })

  const expectedAssetCodes = ["BTC", "DOGE", "ETH", "FDUSD", "SOL", "USDT", "ZRO"]
  const preflight = events.find((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "PREFLIGHT")
  assert.ok(preflight, "trading-enabled startup must durably capture its configured-asset PREFLIGHT snapshot")
  assert.deepEqual(
    preflight.data.balances.map((balance) => balance.asset),
    expectedAssetCodes,
    "PREFLIGHT Journal snapshot must include every configured base/quote asset, including disabled pairs, and exclude unrelated XRP",
  )
  assert.deepEqual(
    runtime.getAccountSnapshot().balances.map((balance) => balance.asset.code).sort(),
    expectedAssetCodes,
    "the in-memory account snapshot must use the same configured-asset allowlist rather than retaining unrelated wallet assets",
  )
  for (const symbol of ["ETHUSDT", "DOGEUSDT", "ZROFDUSD", "SOLFDUSD"]) {
    assert.ok(
      calls.includes("filters:" + symbol),
      "startup must resolve base/quote metadata for disabled configured pair " + symbol + " so its assets are included in the audit snapshot",
    )
    assert.equal(
      calls.includes("subscribe:" + symbol) || calls.includes("subscribe:book:" + symbol),
      false,
      "resolving disabled configured pair " + symbol + " must not enable market subscriptions or trading",
    )
  }

  await runtime.stop()
  const closing = events.find((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "CLOSING")
  assert.ok(closing, "shutdown must retain a CLOSING account snapshot")
  assert.deepEqual(
    closing.data.balances.map((balance) => balance.asset),
    expectedAssetCodes,
    "CLOSING Journal snapshot must preserve the same configured-asset allowlist as PREFLIGHT",
  )
})


test("identifies user-data events received during application recovery as recovery-mode work", async () => {
  const broker = createBroker()
  const getAccountSnapshot = broker.getAccountSnapshot
  let accountReads = 0
  let resolveRecoverySnapshotStarted
  let releaseRecoverySnapshot
  const recoverySnapshotStarted = new Promise((resolve) => {
    resolveRecoverySnapshotStarted = resolve
  })
  const recoverySnapshotGate = new Promise((resolve) => {
    releaseRecoverySnapshot = resolve
  })
  broker.getAccountSnapshot = async () => {
    accountReads += 1
    if (accountReads === 2) {
      resolveRecoverySnapshotStarted()
      await recoverySnapshotGate
    }
    return getAccountSnapshot()
  }

  let observedRecoveryMode
  let resolveObservedEvent
  const observedEvent = new Promise((resolve) => {
    resolveObservedEvent = resolve
  })
  let resolveRecoveryAcknowledged
  const recoveryAcknowledged = new Promise((resolve) => {
    resolveRecoveryAcknowledged = resolve
  })
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          handlers.onStatus({
            type: "reconciled",
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveRecoveryAcknowledged()
          return true
        },
      },
    }
  }

  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    onUserDataEvent: async ({ recoveryMode }) => {
      observedRecoveryMode = recoveryMode
      resolveObservedEvent()
    },
    logger: {
      info() {},
      error() {}
    },
  })

  try {
    broker.emitUserDataStatus({
      type: "recovered",
      subscriptionId: 17,
      recoveryRequired: true,
      reconciliationRequired: true,
    })
    await waitForTestSignal(
      recoverySnapshotStarted,
      "application recovery account snapshot",
      () => ({
        accountReads,
        userDataReady: runtime.userDataReady
      }),
      2_000,
    )

    broker.emitUserDataEvent({ eventType: "outboundAccountPosition" })
    await waitForTestSignal(
      observedEvent,
      "user-data event observed during application recovery",
      () => ({
        observedRecoveryMode,
        userDataReady: runtime.userDataReady
      }),
      2_000,
    )

    assert.equal(
      observedRecoveryMode,
      true,
      "an event accepted while authoritative recovery is pending must be classified as recovery-mode work",
    )

    releaseRecoverySnapshot()
    await waitForTestSignal(
      recoveryAcknowledged,
      "application recovery acknowledgement after durable snapshots",
      () => ({
        accountReads,
        userDataReady: runtime.userDataReady
      }),
      2_000,
    )
    assert.equal(
      runtime.userDataReady,
      true,
      "trading readiness must return only after the application acknowledges the fully reconciled recovery generation",
    )
  } finally {
    releaseRecoverySnapshot()
    await runtime.stop()
  }
})


test("verifies an injected Operational State Store before connecting to the broker", async () => {
  const calls = []
  await assert.rejects(
    () => startHarvesterForTest({
      appConfig,
      operationalStateStore: {
        append: async () => ({
          ok: true,
          data: { durable: true }
        }),
        verify: async () => ({
          ok: false,
          errors: [new Error("durable ledger integrity failed")]
        }),
        readAll: async () => ({
          ok: true,
          data: { records: [] }
        }),
      },
      brokerAdapterFactory: () => {
        calls.push("broker-factory")
        return createBroker(calls)
      },
    }),
    /durable ledger integrity failed/,
  )
  assert.deepEqual(calls, [], "An unverified Operational State Store must block broker connection and subscriptions.")
})


test("records configuration and process boundaries before broker startup and after shutdown", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-process-boundaries-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true
  }))
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "start-harvester-process-boundary-test",
    now: () => new Date("2026-11-12T00:00:00.000Z"),
  })
  await operationalStateStore.initialize()

  const harvester = await startHarvesterForTest({
    appConfig,
    operationalStateStore
  })
  const started = await operationalStateStore.readAll()
  assert.equal(started.ok, true, started.errors?.[0]?.message)
  const configuration = started.data.records.find(({ factType }) => factType === "CONFIGURATION_BASELINE")
  const processStart = started.data.records.find(({ factType }) => factType === "PROCESS_STARTED")
  assert.ok(configuration, "The sanitized strategy configuration fingerprint must be durable before broker startup.")
  assert.ok(processStart, "The current process boundary must be durable before broker startup.")
  assert.equal(configuration.runtimeSessionId, "start-harvester-process-boundary-test")
  assert.equal(processStart.runtimeSessionId, "start-harvester-process-boundary-test")
  assert.equal(processStart.data.configurationFingerprint, configuration.data.fingerprint)
  assert.equal(processStart.data.tradingEnabled, true, "The durable process boundary must preserve whether this session could submit orders.")

  await harvester.stop()

  const stopped = await operationalStateStore.readAll()
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)
  const processStop = stopped.data.records.find(({ factType }) => factType === "PROCESS_STOPPED")
  assert.ok(processStop, "A clean shutdown must durably close the process boundary.")
  assert.equal(processStop.runtimeSessionId, "start-harvester-process-boundary-test")
  assert.equal(processStop.data.clean, true)
})


test("blocks even a clean second process start until the restart-recovery gate is accepted", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-restart-gate-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true
  }))
  const firstStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "first-process-session",
  })
  await firstStore.initialize()
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: firstStore,
    appConfig
  })
  assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
  const started = await recordProcessStarted({
    operationalStateStore: firstStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(started.ok, true, started.errors?.[0]?.message)
  const stopped = await recordProcessStopped({
    operationalStateStore: firstStore,
    reason: "CLEAN_TEST_SHUTDOWN",
    clean: true,
  })
  assert.equal(stopped.ok, true, stopped.errors?.[0]?.message)

  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "second-process-session",
  })
  const brokerCalls = []
  await assert.rejects(
    () => startHarvesterForTest({
      appConfig,
      operationalStateStore: restartStore,
      brokerAdapterFactory: () => {
        brokerCalls.push("broker-factory")
        return createBroker(brokerCalls)
      },
    }),
    /Automatic Harvester process restart is disabled/,
  )
  assert.deepEqual(brokerCalls, [], "Even a clean prior process must not reconnect before Step 9 proves restart safety.")
})


test("blocks a second process start after an unclean prior session before broker connection", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-crash-restart-gate-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true
  }))
  const firstStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "crashed-process-session",
  })
  await firstStore.initialize()
  const baseline = await recordConfigurationBaseline({
    operationalStateStore: firstStore,
    appConfig
  })
  assert.equal(baseline.ok, true, baseline.errors?.[0]?.message)
  const started = await recordProcessStarted({
    operationalStateStore: firstStore,
    configurationFingerprint: baseline.data.fingerprint,
    strategyName: baseline.data.strategyName,
    markets: baseline.data.markets,
    tradingEnabled: true,
  })
  assert.equal(started.ok, true, started.errors?.[0]?.message)

  const restartStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId: "post-crash-process-session",
  })
  const brokerCalls = []
  await assert.rejects(
    () => startHarvesterForTest({
      appConfig,
      operationalStateStore: restartStore,
      brokerAdapterFactory: () => {
        brokerCalls.push("broker-factory")
        return createBroker(brokerCalls)
      },
    }),
    /Automatic Harvester process restart is disabled/,
  )
  assert.deepEqual(brokerCalls, [], "An unclean prior session must not reconnect before restart-recovery proof.")
})


test("reuses the process-owned Operational State Store and preserves operator pause across user-data reconnect", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-shared-operator-facts-"))
  t.after(() => rm(directory, {
    recursive: true,
    force: true
  }))
  const runtimeSessionId = "shared-process-operator-session"
  const operationalStateStore = createFileOperationalStateStore({
    directory,
    runtimeSessionId
  })
  await operationalStateStore.initialize()
  const broker = createBroker()
  let resolveRecoveryAcknowledgement
  const recoveryAcknowledged = new Promise((resolve) => { resolveRecoveryAcknowledgement = resolve })
  const subscribeForUserData = broker.subscribeForUserData
  broker.subscribeForUserData = async (handlers) => {
    const result = await subscribeForUserData(handlers)
    return {
      ...result,
      data: {
        ...result.data,
        acknowledgeRecovery: () => {
          handlers.onStatus({
            type: "reconciled",
            subscriptionId: 17,
            recoveryRequired: false,
            reconciliationRequired: false,
          })
          resolveRecoveryAcknowledgement()
          return true
        },
      },
    }
  }
  let operator
  let secondaryStoreFactoryCalls = 0
  const config = {
    ...appConfig,
    operatorControl: { telegram: {
      enabled: true,
      allowedUserIds: ["12345"]
    } },
  }
  const runtime = await startHarvesterForTest({
    appConfig: config,
    operationalStateStore,
    runtimeSessionId,
    env: {
      ...binanceEnv,
      TELEGRAM_BOT_TOKEN: "test-telegram-token"
    },
    brokerAdapterFactory: () => broker,
    createOperationalStateStore: () => {
      secondaryStoreFactoryCalls += 1
      throw new Error("The process must not create a second writer for its Operational State Store.")
    },
    createTelegramOperatorAdapter: ({ operator: suppliedOperator }) => {
      operator = suppliedOperator
      return {
        start: async () => ({ started: true }),
        stop: async () => ({ stopped: true })
      }
    },
    logger: {
      info() {},
      error() {}
    },
  })

  try {
    const pause = await operator.pauseMarket({
      actor: {
        id: "telegram-user:12345",
        roles: ["trading-operator"]
      },
      requestId: "telegram:shared-store-test",
      symbol: "BTCUSDT",
    })
    assert.equal(pause.ok, true, "An authorized operator pause must append through the process-owned store.")

    broker.emitUserDataStatus({
      type: "connectionClosed",
      reason: "test-disconnect"
    })
    broker.emitUserDataStatus({
      type: "recovered",
      subscriptionId: 17,
      recoveryRequired: true,
      reconciliationRequired: true,
    })
    await waitForTestSignal(
      recoveryAcknowledged,
      "operator pause retention after user-data reconnect",
      () => ({ recoveryAcknowledged: true }),
      2_000,
    )
    const reconnectedStatus = await operator.getStatus({
      actor: {
        id: "telegram-user:12345",
        roles: ["trading-operator"]
      },
    })
    assert.equal(reconnectedStatus.ok, true, "The operator status must remain available after user-data recovery.")
    assert.equal(reconnectedStatus.data.userData.ready, true, "The user-data recovery must finish before checking the retained operator pause.")
    const reconnectedMarkets = await operator.getMarkets({
      actor: {
        id: "telegram-user:12345",
        roles: ["trading-operator"]
      },
    })
    assert.equal(reconnectedMarkets.ok, true, "The market query must remain available after user-data recovery.")
    assert.equal(
      reconnectedMarkets.data.markets.find(({ symbol }) => symbol === "BTCUSDT")?.operatorPaused,
      true,
      "A user-data disconnect/reconnect and successful reconciliation must not silently clear the process-lifetime operator pause.",
    )

    const status = await operator.getStatus({
      actor: {
        id: "telegram-user:12345",
        roles: ["trading-operator"]
      },
    })
    assert.equal(status.ok, true, "The process-composed operator facade must expose an authorized read-only runtime status.")
    assert.equal(status.data.runtimeState, "RUNNING", "The runtime status must reflect the active Harvester process lifecycle.")
    assert.equal(status.data.broker, "binance", "The runtime status must identify the configured broker without claiming a live socket state.")
    assert.equal(typeof status.data.userData.ready, "boolean", "The runtime status must expose the live user-data readiness gate.")
    const markets = await operator.getMarkets({
      actor: {
        id: "telegram-user:12345",
        roles: ["trading-operator"]
      },
    })
    assert.equal(markets.ok, true, "The process-composed operator facade must expose read-only configured market snapshots.")
    assert.ok(
      markets.data.markets.some(({ symbol }) => symbol === "BTCUSDT"),
      "The market query must include the configured BTCUSDT market loaded by bootstrap.",
    )
  } finally {
    await runtime.stop()
  }

  const read = await operationalStateStore.readAll()
  assert.equal(read.ok, true, read.errors?.[0]?.message)
  assert.equal(secondaryStoreFactoryCalls, 0, "Telegram operator control must reuse the exact store that owns process/order/fill facts.")
  const pauseFact = read.data.records.find(({ factType }) => factType === "OPERATOR_MARKET_PAUSED")
  assert.ok(pauseFact, "The operator pause must be present in the process-owned durable stream.")
  assert.equal(pauseFact.runtimeSessionId, runtimeSessionId, "Operator pause facts must share the exact process-session identity.")
  assert.equal(
    read.data.records.some(({ factType }) => factType === "OPERATOR_MARKET_RESUMED"),
    false,
    "A user-data reconnect must not append an operator-resume fact.",
  )
  assert.equal(read.data.records.filter(({ factType }) => factType === "PROCESS_STARTED").length, 1)
  assert.equal(read.data.records.filter(({ factType }) => factType === "PROCESS_STOPPED").length, 1)
})

test("does not subscribe to a market blocked by this strategy's external-order policy", async () => {
  const { market } = createMarketMetadata("BTCUSDT")
  const externalCanonicalOrder = new CanonicalOrder({
    clientOrderId: "manual-client-order",
    brokerOrderId: "manual-broker-order",
    market,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "64000",
      asset: market.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "0.01",
      asset: market.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: market.baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const { market: ignoredMarket } = createMarketMetadata("ETHUSDT")
  const ignoredExternalOrder = new CanonicalOrder({
    clientOrderId: "manual-eth-client-order",
    brokerOrderId: "manual-eth-broker-order",
    market: ignoredMarket,
    side: "BUY",
    type: "LIMIT_MAKER",
    limitPrice: new Money({
      amount: "2400",
      asset: ignoredMarket.quoteAsset
    }),
    originalQuantity: new Quantity({
      amount: "0.1",
      asset: ignoredMarket.baseAsset
    }),
    executedQuantity: new Quantity({
      amount: "0",
      asset: ignoredMarket.baseAsset
    }),
    status: "OPEN",
    createdAt: 1,
    acknowledgedAt: 1,
    updatedAt: 1,
  })
  const config = withExternalOrdersPolicy("BTCUSDT", "block")
  config.strategies.CG_coinGrabber.pairs.ETHUSDT = {
    ...appConfig.strategies.CG_coinGrabber.pairs.ETHUSDT,
    enabled: true,
    externalOrdersPolicy: "ignore",
  }
  const calls = []
  const broker = createBroker(calls, {
    externalOpenOrders: [
      createOpenOrderSnapshot({ order: externalCanonicalOrder }),
      createOpenOrderSnapshot({ order: ignoredExternalOrder }),
    ],
  })
  const candleSubscriptions = []
  const { subscribeForCandles } = broker
  broker.subscribeForCandles = async (input) => {
    candleSubscriptions.push(input.symbol)
    return subscribeForCandles(input)
  }
  const logs = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => config,
    env: binanceEnv,
    brokerAdapterFactory: () => broker,
    evaluateStrategy: () => ({ action: "NO_ACTION" }),
    logger: {
      info: (entry) => logs.push(entry),
      error: (entry) => logs.push(entry),
    },
  })

  try {
    assert.equal(runtime.userDataReady, true, "An external order must not block account/user-data readiness globally.")
    assert.deepEqual(runtime.subscriptions, ["ETHUSDT"], "Only this strategy's unblocked market should own a price subscription.")
    assert.ok(calls.includes("subscribe:ETHUSDT"), "An unaffected enabled market must remain subscribed.")
    assert.equal(calls.includes("subscribe:BTCUSDT"), false, "A market blocked by this strategy's external-order policy must not subscribe to prices.")
    assert.ok(calls.includes("subscribe:book:ETHUSDT"), "An unaffected enabled market must retain its book stream.")
    assert.equal(calls.includes("subscribe:book:BTCUSDT"), false, "A blocked market must not subscribe to a book stream.")
    assert.deepEqual(candleSubscriptions, ["ETHUSDT"], "Volatility candle history must use the same strategy-scoped market-data eligibility.")
    const audit = logs.find((entry) =>
      entry.message === "Account-wide open-orders snapshot recorded; unowned orders remain external and untouched")
    assert.equal(audit?.readiness, "BLOCKED", "The account-wide audit remains BLOCKED without suppressing unrelated markets.")
  } finally {
    await runtime.stop()
  }
})
