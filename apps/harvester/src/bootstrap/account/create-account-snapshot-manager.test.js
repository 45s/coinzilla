import nodeTest from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, Market, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { createAccountSnapshotManager } from "./create-account-snapshot-manager.js"

const test = (name, ...args) => nodeTest("[create-account-snapshot-manager.test.js] " + name, ...args)

const createFixture = ({ accountSnapshots = [], openOrders = [] } = {}) => {
  const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
  let snapshotIndex = 0
  const publishedEvents = []
  let flushCount = 0
  const manager = createAccountSnapshotManager({
    broker: {
      getAccountSnapshot: async () => accountSnapshots[Math.min(snapshotIndex++, accountSnapshots.length - 1)],
      getOpenOrders: async () => ({ ok: true, data: openOrders }),
    },
    eventPublisher: {
      publish: (event) => {
        publishedEvents.push(event)
        return { ok: true }
      },
      flush: async () => {
        flushCount += 1
        return { ok: true, durable: true }
      },
    },
    marketMetadata: new Map([[market.symbol, { market }]]),
    getPortfolio: () => new Portfolio(),
    getTradingEngine: () => undefined,
    getRecoveredState: () => ({ orderRegistry: { orders: [] } }),
    getHasCanonicalOwnershipReconciliation: () => false,
    logger: {},
    now: () => 123,
  })
  return {
    manager,
    market,
    baseAsset,
    quoteAsset,
    publishedEvents,
    getFlushCount: () => flushCount,
  }
}

const createAccountSnapshot = ({ market, sourceTime }) => ({
  ok: true,
  data: {
    sourceTime,
    balances: [
      new Balance({
        free: new Quantity({ amount: "1.25", asset: market.baseAsset }),
        locked: new Quantity({ amount: "0.25", asset: market.baseAsset }),
      }),
      new Balance({
        free: new Quantity({ amount: "500", asset: market.quoteAsset }),
        locked: new Quantity({ amount: "0", asset: market.quoteAsset }),
      }),
    ],
  },
})

test("captures configured-asset balances and durably publishes the account audit", async () => {
  const fixture = createFixture()
  fixture.manager // keep the fixture shape explicit for the scenario
  const snapshotFixture = createFixture({
    accountSnapshots: [createAccountSnapshot({ market: fixture.market, sourceTime: 100 })],
  })

  const snapshot = await snapshotFixture.manager.publishAccountSnapshot({ phase: "PREFLIGHT" })

  assert.equal(snapshot.sourceTime, 100, "The account snapshot must preserve the broker's source timestamp.")
  assert.equal(snapshotFixture.manager.getAccountSnapshot().sourceTime, 100, "The accepted snapshot must become the manager's current account view.")
  assert.equal(snapshotFixture.publishedEvents.length, 1, "The PREFLIGHT balance audit must publish exactly one lifecycle event.")
  assert.equal(snapshotFixture.publishedEvents[0].data.phase, "PREFLIGHT", "The account audit event must retain its requested lifecycle phase.")
  assert.equal(snapshotFixture.publishedEvents[0].data.balances.length, 2, "The audit must include both configured market assets.")
  assert.equal(snapshotFixture.getFlushCount(), 1, "The account audit must be durably flushed before the call resolves.")
})

test("rejects an account snapshot that omits a configured market asset", async () => {
  const fixture = createFixture({
    accountSnapshots: [{
      ok: true,
      data: {
        sourceTime: 100,
        balances: [
          new Balance({
            free: new Quantity({ amount: "1", asset: new Asset({ id: "asset:BTC", code: "BTC" }) }),
            locked: new Quantity({ amount: "0", asset: new Asset({ id: "asset:BTC", code: "BTC" }) }),
          }),
        ],
      },
    }],
  })

  await assert.rejects(
    fixture.manager.refreshAccountSnapshot(),
    /missing required market asset balances: USDT/,
    "A startup snapshot missing the configured quote asset must fail closed.",
  )
  assert.equal(fixture.manager.getAccountSnapshot(), undefined, "An incomplete account snapshot must not become the accepted account view.")
})

test("does not replace a newer accepted account snapshot with stale broker data", async () => {
  const fixture = createFixture({
    accountSnapshots: [
      createAccountSnapshot({ market: createFixture().market, sourceTime: 100 }),
      createAccountSnapshot({ market: createFixture().market, sourceTime: 99 }),
    ],
  })

  await fixture.manager.refreshAccountSnapshot()
  await assert.rejects(
    fixture.manager.refreshAccountSnapshot(),
    /older than the previously accepted snapshot/,
    "A stale broker snapshot must be rejected rather than replacing newer account state.",
  )
  assert.equal(fixture.manager.getAccountSnapshot().sourceTime, 100, "A stale response must leave the latest accepted account snapshot unchanged.")
})

test("records unowned open orders as blocked without adopting them", async () => {
  const externalOrder = {
    id: "external-order-1",
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    originalPrice: "65000",
    originalQuantity: "0.01",
    executedQuantity: "0",
    status: "NEW",
    clientOrderId: "manual-order-1",
  }
  const fixture = createFixture({ openOrders: [externalOrder] })

  const orders = await fixture.manager.publishOpenOrdersSnapshot()

  assert.equal(orders.length, 1, "The account-wide audit must retain the observed external open order.")
  assert.equal(fixture.publishedEvents[0].data.readiness, "BLOCKED", "An unowned open order must be recorded as blocked in the audit event.")
  assert.deepEqual(fixture.manager.getAccountSnapshot(), undefined, "An open-order audit must not manufacture an account balance snapshot.")
  assert.equal(fixture.getFlushCount(), 1, "The open-order audit must be durably flushed before startup continues.")
})
