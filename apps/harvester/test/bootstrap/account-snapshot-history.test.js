import nodeTest from "node:test"
import assert from "node:assert/strict"
import * as shared from "./start-harvester-test-support.js"

const { Asset, Balance, Quantity, appConfig, createMarketMetadata, createBroker, binanceEnv, startHarvesterForTest } = shared
const test = (...args) => nodeTest(`[account-snapshot-history.test.js] ${args[0]}`, ...args.slice(1))

async function createPreflightJournalRuntime() {
  const calls = []
  const broker = createBroker(calls)
  let openOrderReads = 0
  const { getOpenOrders } = broker
  broker.getOpenOrders = async (input) => {
    openOrderReads += 1
    assert.deepEqual(input, {}, "createPreflightJournalRuntime: expected input to deeply equal {}.")
    return getOpenOrders(input)
  }
  const events = []
  const eventPublisher = {
    publish: (event) => {
      events.push(event)
      calls.push(`publish:${event.name}`)
      return { ok: true }
    },
    flush: async () => {
      calls.push("journal:flush")
      return { ok: true,
        durable: true }
    },
  }
  const runtime = await startHarvesterForTest({
    loadConfig: async () => appConfig,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher,
    logger: {
      info() {},
      error() {},
      debug() {},
    },
  })
  return { calls,
    events,
    runtime,
    getOpenOrderReads: () => openOrderReads }
}

function assertPreflightJournalAudit({ calls, events, openOrderReads }) {
  const openingEvent = events.find((event) => event.name === "account.snapshot_captured")
  const openOrdersEvent = events.find((event) => event.name === "account.open_orders_captured")
  assert.equal(calls.filter((call) => call === "account:snapshot").length, 1, "assertPreflightJournalAudit: expected calls.filter((call) => call === \"account:snapshot\").length to equal 1.")
  assert.equal(openOrderReads, 1, "assertPreflightJournalAudit: expected openOrderReads to equal 1.")
  assert.equal(events.filter((event) => event.name === "account.snapshot_captured" && event.data.phase === "PREFLIGHT").length, 1, "assertPreflightJournalAudit: expected events.filter((event) => event.name === \"account.snapshot_captured\" && event.data.phase === \"PREFLIGHT\").length to equal 1.")
  assert.equal(events.filter((event) => event.name === "account.open_orders_captured" && event.data.phase === "PREFLIGHT").length, 1, "assertPreflightJournalAudit: expected events.filter((event) => event.name === \"account.open_orders_captured\" && event.data.phase === \"PREFLIGHT\").length to equal 1.")
  assert.equal(openingEvent.data.phase, "PREFLIGHT", "assertPreflightJournalAudit: expected openingEvent.data.phase to equal \"PREFLIGHT\".")
  assert.equal(openOrdersEvent.data.readiness, "READY", "assertPreflightJournalAudit: expected openOrdersEvent.data.readiness to equal \"READY\".")
  assert.equal(openOrdersEvent.data.orderCount, 0, "assertPreflightJournalAudit: expected openOrdersEvent.data.orderCount to equal 0.")
  assert.deepEqual(openOrdersEvent.data.orders, [], "assertPreflightJournalAudit: expected openOrdersEvent.data.orders to deeply equal [].")
  assert.equal(openingEvent.data.auditStatus, "COMPLETE", "assertPreflightJournalAudit: expected openingEvent.data.auditStatus to equal \"COMPLETE\".")
  assert.ok(openingEvent.data.balances.some((balance) => balance.asset === "BTC"), "assertPreflightJournalAudit: expected openingEvent.data.balances.some((balance) => balance.asset === \"BTC\") to be truthy.")
  assert.ok(openingEvent.data.balances.some((balance) => balance.asset === "USDT"), "assertPreflightJournalAudit: expected openingEvent.data.balances.some((balance) => balance.asset === \"USDT\") to be truthy.")
  assert.ok(calls.indexOf("journal:flush") > calls.indexOf("publish:account.snapshot_captured"), "assertPreflightJournalAudit: expected calls.indexOf(\"journal:flush\") > calls.indexOf(\"publish:account.snapshot_captured\") to be truthy.")
  assert.ok(calls.findIndex((call) => call.startsWith("subscribe:book:")) > calls.lastIndexOf("journal:flush"), "assertPreflightJournalAudit: expected calls.findIndex((call) => call.startsWith(\"subscribe:book:\")) > calls.lastIndexOf(\"journal:flush\") to be truthy.")
}

function assertClosingJournalAudit({ calls, events }) {
  const snapshots = events.filter((event) => event.name === "account.snapshot_captured")
  assert.equal(snapshots.length, 2, "assertClosingJournalAudit: expected snapshots.length to equal 2.")
  assert.equal(snapshots[1].data.phase, "CLOSING", "assertClosingJournalAudit: expected snapshots[1].data.phase to equal \"CLOSING\".")
  assert.equal(snapshots[1].data.auditStatus, "COMPLETE", "assertClosingJournalAudit: expected snapshots[1].data.auditStatus to equal \"COMPLETE\".")
  assert.ok(calls.indexOf("disconnect") > calls.lastIndexOf("journal:flush"), "assertClosingJournalAudit: expected calls.indexOf(\"disconnect\") > calls.lastIndexOf(\"journal:flush\") to be truthy.")
}

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
    "fails startup when the exchange snapshot omits a configured market asset: expected startHarvesterForTest({\n      loadConfig: async () => appConfig,\n      env: binanceEnv,\n      brokerAdapterFactory: () => broker,\n      logger: {\n        info() {},\n        error() {}\n      },\n    }) to reject or throw with /missing required market asset balances: USDT/ as required by the account snapshot audit.",
  )
  assert.deepEqual(calls, [
    "connect",
    "filters:BTCUSDT",
    "filters:ETHUSDT",
    "subscribe:user-data",
    "account:snapshot",
    "unsubscribe:user-data",
    "disconnect",
  ], "fails startup when the exchange snapshot omits a configured market asset: expected calls to deeply equal [\n    \"connect\",\n    \"filters:BTCUSDT\",\n    \"filters:ETHUSDT\",\n    \"subscribe:user-data\",\n    \"account:snapshot\",\n    \"unsubscribe:user-data\",\n    \"disconnect\",\n  ].")
})

test("journals PREFLIGHT balances and open orders before trading and CLOSING balances before broker disconnect", async () => {
  const fixture = await createPreflightJournalRuntime()
  assertPreflightJournalAudit({
    calls: fixture.calls,
    events: fixture.events,
    openOrderReads: fixture.getOpenOrderReads(),
  })
  await fixture.runtime.stop()
  assertClosingJournalAudit(fixture)
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
  assert.equal(audit.data.readiness, "BLOCKED", "records pre-existing account-wide orders without adopting or changing them: expected audit.data.readiness to equal \"BLOCKED\".")
  assert.deepEqual(audit.data.blockReasons, ["UNOWNED_OPEN_ORDERS:1"], "records pre-existing account-wide orders without adopting or changing them: expected audit.data.blockReasons to deeply equal [\"UNOWNED_OPEN_ORDERS:1\"].")
  assert.equal(audit.data.orders[0].brokerOrderId, "external-order-77", "records pre-existing account-wide orders without adopting or changing them: expected audit.data.orders[0].brokerOrderId to equal \"external-order-77\".")
  assert.equal(cancelCalls, 0, "records pre-existing account-wide orders without adopting or changing them: expected cancelCalls to equal 0.")
  assert.equal(placeCalls, 0, "records pre-existing account-wide orders without adopting or changing them: expected placeCalls to equal 0.")
  assert.equal(runtime.connected, true, "records pre-existing account-wide orders without adopting or changing them: expected runtime.connected to equal true.")

  await runtime.stop()
})


function createConfiguredMarketSnapshotConfig() {
  return {
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
}

function createConfiguredMarketSnapshotFixture({ broker }) {
  const configuredMarkets = ["BTCUSDT", "ETHUSDT", "DOGEUSDT", "ZROFDUSD", "SOLFDUSD"]
  const assetsByCode = new Map()
  for (const symbol of configuredMarkets) {
    const { market } = createMarketMetadata(symbol)
    assetsByCode.set(market.baseAsset.code, market.baseAsset)
    assetsByCode.set(market.quoteAsset.code, market.quoteAsset)
  }
  const unrelatedAsset = new Asset({
    id: "asset:XRP",
    code: "XRP",
  })
  const sourceBalances = [...assetsByCode.values(), unrelatedAsset].map((asset) => new Balance({
    free: new Quantity({
      amount: "10",
      asset,
    }),
    locked: new Quantity({
      amount: "0",
      asset,
    }),
  }))
  broker.getAccountSnapshot = async () => ({
    ok: true,
    data: {
      balances: sourceBalances,
      sourceTime: 1,
    },
  })
  return {
    config: createConfiguredMarketSnapshotConfig(),
    expectedAssetCodes: ["BTC", "DOGE", "ETH", "FDUSD", "SOL", "USDT", "ZRO"],
  }
}

function assertConfiguredMarketPreflight({ events, runtime, calls, expectedAssetCodes }) {
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
    assert.ok(calls.includes(`filters:${  symbol}`), "assertConfiguredMarketPreflight: expected calls.includes(`filters:${  symbol}`) to be truthy.")
    assert.equal(
      calls.includes(`subscribe:${  symbol}`) || calls.includes(`subscribe:book:${  symbol}`),
      false,
      `resolving disabled configured pair ${  symbol  } must not enable market subscriptions or trading`,
    )
  }
}

function assertConfiguredMarketClosing({ events, expectedAssetCodes }) {
  const closing = events.find((event) =>
    event.name === "account.snapshot_captured" && event.data.phase === "CLOSING")
  assert.ok(closing, "shutdown must retain a CLOSING account snapshot")
  assert.deepEqual(
    closing.data.balances.map((balance) => balance.asset),
    expectedAssetCodes,
    "CLOSING Journal snapshot must preserve the same configured-asset allowlist as PREFLIGHT",
  )
}

test("account snapshots include every configured pair asset, including disabled pairs, and exclude unrelated wallet assets", async () => {
  const calls = []
  const broker = createBroker(calls)
  const fixture = createConfiguredMarketSnapshotFixture({
    broker,
  })
  const events = []
  const runtime = await startHarvesterForTest({
    loadConfig: async () => fixture.config,
    env: {
      ...binanceEnv,
      NODE_ENV: "development",
    },
    brokerAdapterFactory: () => broker,
    eventPublisher: {
      publish: (event) => {
        events.push(event)
        return {
          ok: true,
        }
      },
      flush: async () => ({
        ok: true,
        durable: true,
      }),
    },
    logger: {
      info() {},
      error() {},
      debug() {},
    },
  })

  assertConfiguredMarketPreflight({
    events,
    runtime,
    calls,
    expectedAssetCodes: fixture.expectedAssetCodes,
  })
  await runtime.stop()
  assertConfiguredMarketClosing({
    events,
    expectedAssetCodes: fixture.expectedAssetCodes,
  })
})
