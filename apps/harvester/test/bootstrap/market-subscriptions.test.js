import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { appConfig, createBroker, binanceEnv, startHarvesterForTest, waitForTestSignal, Asset, Balance, Quantity, createTwoMarketStartupConfig } = shared
const test = (...args) => nodeTest(`[market-subscriptions.test.js] ${args[0]}`, ...args.slice(1))

function configureDelayedTickerPricePort({ broker, calls, firstTicker, resolveFirstTickerRequested }) {
  broker.getPrices = async ({ symbol }) => {
    calls.push(`prices:${symbol}`)
    if (symbol === "BTCUSDT") {
      resolveFirstTickerRequested()
      return firstTicker
    }
    return { ok: true,
      data: { symbol,
        price: "65000" } }
  }
}

function configureDelayedTickerAccountSnapshot(broker) {
  let accountSnapshotTime = 0
  broker.getAccountSnapshot = async () => {
    accountSnapshotTime += 1
    const balances = ["BTC", "ETH", "USDT"].map((code) => {
      const asset = new Asset({ id: `asset:${code}`,
        code })
      return new Balance({
        free: new Quantity({ amount: "0",
          asset }),
        locked: new Quantity({ amount: "0",
          asset }),
      })
    })
    return { ok: true,
      data: { balances,
        sourceTime: accountSnapshotTime } }
  }
}

function configureDelayedTickerOrderPort(broker) {
  let placeOrderCalls = 0
  broker.placeOrder = async () => {
    placeOrderCalls += 1
    return { ok: true }
  }
  return () => placeOrderCalls
}

function configureDelayedTickerSubscriptionPort(broker) {
  let resolveSecondSubscription
  const secondSubscription = new Promise((resolve) => {
    resolveSecondSubscription = resolve
  })
  const { subscribeForPrices } = broker
  broker.subscribeForPrices = async (input) => {
    const result = await subscribeForPrices(input)
    if (input.symbol === "ETHUSDT") {
      resolveSecondSubscription()
    }
    return result
  }
  return secondSubscription
}

function createDelayedFirstTickerBroker({ broker, calls }) {
  let resolveFirstTicker
  let resolveFirstTickerRequested
  const firstTicker = new Promise((resolve) => {
    resolveFirstTicker = resolve
  })
  const firstTickerRequested = new Promise((resolve) => {
    resolveFirstTickerRequested = resolve
  })
  configureDelayedTickerPricePort({ broker,
    calls,
    firstTicker,
    resolveFirstTickerRequested })
  configureDelayedTickerAccountSnapshot(broker)
  const getPlaceOrderCalls = configureDelayedTickerOrderPort(broker)
  const secondSubscription = configureDelayedTickerSubscriptionPort(broker)
  return { secondSubscription,
    firstTickerRequested,
    resolveFirstTicker,
    getPlaceOrderCalls }
}

async function assertSecondMarketSubscribedBeforeTicker({
  calls,
  secondSubscription,
  firstTickerRequested,
}) {
  await waitForTestSignal(
    secondSubscription,
    "second enabled market subscription",
    () => ({ calls }),
    2000,
  )
  await waitForTestSignal(
    firstTickerRequested,
    "first market REST ticker request",
    () => ({ calls }),
    2000,
  )
  assert.ok(
    calls.indexOf("subscribe:ETHUSDT") < calls.indexOf("prices:BTCUSDT"),
    `Expected ETH subscription before BTC ticker seed; calls: ${calls.join(", ")}`,
  )
  assert.ok(calls.includes("subscribe:book:BTCUSDT"), "The first enabled market must have its book-ticker subscription before the initial ticker wait.")
  assert.ok(calls.includes("subscribe:book:ETHUSDT"), "The second enabled market must also be subscribed before the first market ticker wait.")
}

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
  assert.equal(result.connected, true, "Expected result.connected to equal true in \"subscribes only enabled pairs for Binance trading\".")
  assert.equal(result.tradingEnabled, true, "Expected result.tradingEnabled to equal true in \"subscribes only enabled pairs for Binance trading\".")
  assert.equal(result.strategyMode, "conservative", "Expected result.strategyMode to equal \"conservative\" in \"subscribes only enabled pairs for Binance trading\".")
  assert.deepEqual(result.subscriptions, ["BTCUSDT"], "Expected result.subscriptions to match the expected structure in \"subscribes only enabled pairs for Binance trading\".")
  assert.equal(result.getMarketMetadata({ symbol: "BTCUSDT" }).market.symbol, "BTCUSDT", "Expected result.getMarketMetadata({ symbol: \"BTCUSDT\" }).market.symbol to equal \"BTCUSDT\" in \"subscribes only enabled pairs for Binance trading\".")
  assert.ok(result.recoveredState, "Expected condition (result.recoveredState) to be true in \"subscribes only enabled pairs for Binance trading\".")
  assert.equal(result.recoveredState.requiresExchangeReconciliation, false, "Expected result.recoveredState.requiresExchangeReconciliation to equal false in \"subscribes only enabled pairs for Binance trading\".")
  assert.deepEqual(result.recoveredState.pausedMarkets, new Set(), "Expected result.recoveredState.pausedMarkets to match the expected structure in \"subscribes only enabled pairs for Binance trading\".")
  assert.equal(result.recoveredState.orderRegistry.orders.length, 0, "Expected result.recoveredState.orderRegistry.orders.length to equal 0 in \"subscribes only enabled pairs for Binance trading\".")
  assert.equal(result.userDataReady, true, "Expected result.userDataReady to equal true in \"subscribes only enabled pairs for Binance trading\".")
  assert.equal(result.placeOrder, undefined, "Expected result.placeOrder to equal undefined in \"subscribes only enabled pairs for Binance trading\".")
  assert.equal(result.broker, undefined, "Expected result.broker to equal undefined in \"subscribes only enabled pairs for Binance trading\".")
  await result.stop()
  await result.stop()
  assert.deepEqual(calls, [
    "connect", "filters:BTCUSDT", "filters:ETHUSDT", "subscribe:user-data", "account:snapshot",
    "subscribe:book:BTCUSDT", "subscribe:BTCUSDT", "account:snapshot",
    "unsubscribe:book:BTCUSDT", "unsubscribe:BTCUSDT", "unsubscribe:user-data", "disconnect",
  ], "Expected calls to match the expected structure in \"subscribes only enabled pairs for Binance trading\".")
})

test("subscribes every enabled market before waiting for the first market's REST ticker seed", async () => {
  const calls = []
  const broker = createBroker(calls)
  const race = createDelayedFirstTickerBroker({
    broker,
    calls,
  })
  const startup = startHarvesterForTest({
    loadConfig: async () => createTwoMarketStartupConfig(),
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    logger: {
      info() {},
      error() {},
      debug() {},
    },
  })

  await assertSecondMarketSubscribedBeforeTicker({
    calls,
    secondSubscription: race.secondSubscription,
    firstTickerRequested: race.firstTickerRequested,
  })
  race.resolveFirstTicker({
    ok: true,
    data: {
      symbol: "BTCUSDT",
      price: "65000",
    },
  })
  const runtime = await startup
  assert.deepEqual(runtime.subscriptions, ["BTCUSDT", "ETHUSDT"], "The runtime must subscribe to every enabled market exactly once.")
  assert.equal(race.getPlaceOrderCalls(), 0, "The Trading Engine must not submit an order before all enabled market subscriptions and ticker seeding complete.")
  await runtime.stop()
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
    "A failed BTCUSDT price subscription must abort startup and enter rollback.",
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
  ], "A failed BTCUSDT subscription must clean up the attempted market stream and user-data stream before disconnecting.")
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
    "A failed later-market subscription must abort startup instead of leaving an earlier market active.",
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
  ], "A failed ETHUSDT subscription must unsubscribe every attempted market stream before disconnecting.")
})
