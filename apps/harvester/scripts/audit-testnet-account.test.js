import test from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, Quantity } from "@coinzilla/entities"
import { runTestnetAccountAudit } from "./audit-testnet-account.js"

const env = {
  HARVESTER_BROKER: "binance",
  HARVESTER_TRADING_MODE: "testnet",
  NODE_ENV: "development",
  BINANCE_API_KEY: "test-key",
  BINANCE_API_SECRET_KEY: "test-secret",
}

const createBalance = ({ code, free, locked = "0" }) => {
  const asset = new Asset({ id: "asset:" + code, code })
  return new Balance({
    free: new Quantity({ amount: free, asset }),
    locked: new Quantity({ amount: locked, asset }),
  })
}

const createDependencies = ({ orders = [], accountResult, ordersResult } = {}) => {
  const calls = []
  const events = []
  const broker = {
    connect: async () => { calls.push("broker:connect") },
    disconnect: async () => { calls.push("broker:disconnect") },
    getAccountSnapshot: async () => {
      calls.push("broker:account")
      return accountResult ?? {
        ok: true,
        data: {
          balances: [
            createBalance({ code: "ZRO", free: "50", locked: "0" }),
            createBalance({ code: "USDT", free: "100", locked: "5" }),
          ],
          sourceTime: 123456,
        },
      }
    },
    getOpenOrders: async (input = {}) => {
      calls.push("broker:open-orders:" + String(input.symbol))
      return ordersResult ?? { ok: true, data: orders }
    },
    placeOrder: async () => { calls.push("broker:place-order"); throw new Error("must not place orders") },
    cancelOrder: async () => { calls.push("broker:cancel-order"); throw new Error("must not cancel orders") },
  }
  const eventBus = {
    publish: (event) => { events.push(event); return { ok: true } },
    close: async () => { calls.push("event-bus:close"); return { ok: true } },
  }
  const journalService = {
    ready: Promise.resolve({ ok: true }),
    flush: async () => { calls.push("journal:flush"); return { ok: true, durable: true } },
    close: async () => { calls.push("journal:close"); return { ok: true, durable: true } },
  }
  return {
    calls,
    events,
    broker,
    eventBus,
    journalService,
    createEventBus: () => eventBus,
    createJournalService: () => journalService,
    brokerAdapterFactory: () => broker,
  }
}

test("journals full balances and account-wide open orders without starting or mutating trading", async () => {
  const dependencies = createDependencies({
    orders: [{
      id: "699694",
      clientOrderId: "manual-zro-sell",
      symbol: "ZROUSDT",
      side: "SELL",
      type: "LIMIT",
      originalPrice: "1.82800000",
      originalQuantity: "4.98000000",
      executedQuantity: "0.00000000",
      status: "NEW",
    }],
  })
  const result = await runTestnetAccountAudit({
    env,
    now: () => 200,
    createEventBus: dependencies.createEventBus,
    createJournalService: dependencies.createJournalService,
    brokerAdapterFactory: dependencies.brokerAdapterFactory,
    logger: { info() {}, error() {} },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.readiness, "BLOCKED")
  assert.equal(result.data.assetCount, 2)
  assert.equal(result.data.orderCount, 1)
  assert.deepEqual(dependencies.events.map(({ name }) => name), [
    "account.snapshot_captured",
    "account.open_orders_captured",
  ])
  assert.equal(dependencies.events[0].data.phase, "PREFLIGHT")
  assert.deepEqual(dependencies.events[0].data.balances, [
    { asset: "USDT", free: "100", locked: "5", total: "105" },
    { asset: "ZRO", free: "50", locked: "0", total: "50" },
  ])
  assert.equal(dependencies.events[1].data.phase, "PREFLIGHT")
  assert.equal(dependencies.events[1].data.readiness, "BLOCKED")
  assert.equal(dependencies.events[1].data.orders[0].brokerOrderId, "699694")
  assert.equal(dependencies.events[1].data.orders[0].price, "1.82800000")
  assert.equal(dependencies.calls.filter((call) => call === "journal:flush").length, 2)
  assert.equal(dependencies.calls.includes("broker:place-order"), false)
  assert.equal(dependencies.calls.includes("broker:cancel-order"), false)
  assert.ok(dependencies.calls.includes("broker:open-orders:undefined"))
  assert.ok(dependencies.calls.includes("broker:disconnect"))
  assert.ok(dependencies.calls.includes("journal:close"))
  assert.ok(dependencies.calls.includes("event-bus:close"))
})

test("reports READY when the read-only account audit finds no open orders", async () => {
  const dependencies = createDependencies()
  const result = await runTestnetAccountAudit({
    env,
    createEventBus: dependencies.createEventBus,
    createJournalService: dependencies.createJournalService,
    brokerAdapterFactory: dependencies.brokerAdapterFactory,
    logger: { info() {}, error() {} },
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.readiness, "READY")
  assert.equal(result.data.orderCount, 0)
  assert.equal(dependencies.events[1].data.readiness, "READY")
  assert.deepEqual(dependencies.events[1].data.orders, [])
})

test("refuses non-TESTNET environment before connecting to a broker", async () => {
  let brokerFactoryCalled = false
  const result = await runTestnetAccountAudit({
    env: { ...env, HARVESTER_TRADING_MODE: "live" },
    brokerAdapterFactory: () => {
      brokerFactoryCalled = true
      throw new Error("broker must not be created")
    },
    logger: { info() {}, error() {} },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /HARVESTER_TRADING_MODE=testnet/)
  assert.equal(brokerFactoryCalled, false)
})

test("fails when account-wide open-order retrieval fails and still closes read-only resources", async () => {
  const dependencies = createDependencies({
    ordersResult: { ok: false, errors: [new Error("openOrders.status failed")] },
  })
  const result = await runTestnetAccountAudit({
    env,
    createEventBus: dependencies.createEventBus,
    createJournalService: dependencies.createJournalService,
    brokerAdapterFactory: dependencies.brokerAdapterFactory,
    logger: { info() {}, error() {} },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors[0].message, /Unable to load Binance TESTNET account-wide open orders/)
  assert.equal(dependencies.events.length, 1)
  assert.equal(dependencies.events[0].name, "account.snapshot_captured")
  assert.ok(dependencies.calls.includes("broker:disconnect"))
  assert.ok(dependencies.calls.includes("journal:close"))
  assert.ok(dependencies.calls.includes("event-bus:close"))
})
