import nodeTest from "node:test"
import assert from "node:assert/strict"
import { Asset, Balance, Market, Quantity } from "@coinzilla/entities"
import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { createAccountSnapshotManager } from "./create-account-snapshot-manager.js"

const test = (name, ...args) => nodeTest("[create-account-snapshot-manager.test.js] " + name, ...args)

const createFixture = ({ accountSnapshots = [], openOrders = [], openOrdersResult, flushResults = [] } = {}) => {
  const baseAsset = new Asset({ id: "asset:BTC", code: "BTC" })
  const quoteAsset = new Asset({ id: "asset:USDT", code: "USDT" })
  const market = new Market({ venue: "binance", symbol: "BTCUSDT", baseAsset, quoteAsset })
  let snapshotIndex = 0
  const publishedEvents = []
  let flushCount = 0
  const manager = createAccountSnapshotManager({
    broker: {
      getAccountSnapshot: async () => accountSnapshots[Math.min(snapshotIndex++, accountSnapshots.length - 1)],
      getOpenOrders: async () => openOrdersResult ?? ({ ok: true, data: openOrders }),
    },
    eventPublisher: {
      publish: (event) => {
        publishedEvents.push(event)
        return { ok: true }
      },
      flush: async () => {
        flushCount += 1
        return flushResults[flushCount - 1] ?? { ok: true, durable: true }
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
  const market = createFixture().market
  const fixture = createFixture({
    accountSnapshots: [createAccountSnapshot({ market, sourceTime: 100 })],
  })

  const snapshot = await fixture.manager.publishAccountSnapshot({ phase: "PREFLIGHT" })

  assert.equal(snapshot.sourceTime, 100, "The account snapshot must preserve the broker's source timestamp.")
  assert.equal(fixture.manager.getAccountSnapshot().sourceTime, 100, "The accepted snapshot must become the manager's current account view.")
  assert.equal(fixture.publishedEvents.length, 1, "The PREFLIGHT balance audit must publish exactly one lifecycle event.")
  assert.equal(fixture.publishedEvents[0].data.phase, "PREFLIGHT", "The account audit event must retain its requested lifecycle phase.")
  assert.equal(fixture.publishedEvents[0].data.balances.length, 2, "The audit must include both configured market assets.")
  assert.equal(fixture.getFlushCount(), 1, "The account audit must be durably flushed before the call resolves.")
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
    (error) => {
      assert.match(error.message, /missing required market asset balances: USDT/)
      assert.deepEqual(error.recoveryFailure, {
        category: "ACCOUNTING_INTEGRITY",
        stage: "ACCOUNT_SNAPSHOT_VALIDATION",
        retryable: false,
      })
      return true
    },
    "A startup snapshot missing the configured quote asset must fail closed as terminal integrity failure.",
  )
  assert.equal(fixture.manager.getAccountSnapshot(), undefined, "An incomplete account snapshot must not become the accepted account view.")
})

test("treats account snapshot responses without an explicit success flag as terminal integrity failures", async () => {
  const fixture = createFixture({ accountSnapshots: [{ data: { balances: [] } }] })
  await assert.rejects(fixture.manager.refreshAccountSnapshot(), (error) => {
    assert.deepEqual(error.recoveryFailure, {
      category: "ACCOUNTING_INTEGRITY",
      stage: "ACCOUNT_SNAPSHOT_RESPONSE",
      retryable: false,
    })
    return true
  })
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


test("retries an account snapshot after a REST timeout without publishing a premature audit", async () => {
  const market = createFixture().market
  const timeout = Object.assign(
    new Error("account.status request timed out"),
    { name: "RpcTimeoutError", code: "RPC_TIMEOUT" },
  )
  const fixture = createFixture({
    accountSnapshots: [
      { ok: false, errors: [timeout] },
      createAccountSnapshot({ market, sourceTime: 100 }),
    ],
  })

  await assert.rejects(
    fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" }),
    (error) => {
      assert.deepEqual(error.recoveryFailure, {
        category: "REST_RECONCILIATION",
        stage: "ACCOUNT_SNAPSHOT_READ",
        retryable: true,
      }, "A broker-declared account snapshot timeout must be explicitly retryable.")
      assert.equal(
        error.message,
        "Unable to load canonical exchange account balances: account.status request timed out",
        "The account snapshot wrapper must retain its existing contextual timeout message.",
      )
      assert.equal(
        error.cause,
        timeout,
        "The account snapshot wrapper must preserve the exact original broker timeout as native Error.cause.",
      )
      assert.equal(
        error.cause?.name,
        "RpcTimeoutError",
        "The native account snapshot error cause must retain the broker's typed timeout name.",
      )
      return true
    },
    "A failed broker account snapshot result must fail the recovery audit with its actionable timeout message and original cause.",
  )

  assert.equal(
    fixture.manager.getAccountSnapshot(),
    undefined,
    "A timed-out account snapshot must not become the accepted account view.",
  )
  assert.equal(
    fixture.publishedEvents.length,
    0,
    "A failed account REST read must not publish a durable recovery audit.",
  )
  assert.equal(
    fixture.getFlushCount(),
    0,
    "A failed account REST read must not flush an audit that contains no authoritative snapshot.",
  )

  const recoveredSnapshot = await fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" })

  assert.equal(
    recoveredSnapshot.sourceTime,
    100,
    "A later successful REST read must be accepted after the transient timeout.",
  )
  assert.equal(
    fixture.manager.getAccountSnapshot().sourceTime,
    100,
    "The successful retry must become the current account snapshot.",
  )
  assert.equal(
    fixture.publishedEvents.length,
    1,
    "Only the successful retry may publish the recovery account audit.",
  )
  assert.equal(
    fixture.publishedEvents[0].data.phase,
    "RECOVERY",
    "The successful retry must retain the recovery audit phase.",
  )
  assert.equal(
    fixture.getFlushCount(),
    1,
    "The successful retry must durably flush exactly one recovery account audit.",
  )
})


test("preserves the original broker error as cause when the account-wide open-orders snapshot fails", async () => {
  const timeout = Object.assign(
    new Error("account-wide open-orders RPC timed out"),
    { name: "RpcTimeoutError", code: "RPC_TIMEOUT" },
  )
  const fixture = createFixture({
    openOrdersResult: { ok: false, errors: [timeout] },
  })

  await assert.rejects(
    fixture.manager.publishOpenOrdersSnapshot(),
    (error) => {
      assert.deepEqual(error.recoveryFailure, {
        category: "REST_RECONCILIATION",
        stage: "ACCOUNT_WIDE_OPEN_ORDERS_READ",
        retryable: true,
      }, "A broker-declared account-wide open-orders timeout must be explicitly retryable.")
      assert.equal(
        error.message,
        "Unable to load authoritative account-wide open orders: account-wide open-orders RPC timed out",
        "The open-orders snapshot wrapper must retain its existing contextual timeout message.",
      )
      assert.equal(
        error.cause,
        timeout,
        "The open-orders snapshot wrapper must preserve the exact original broker timeout as native Error.cause.",
      )
      assert.equal(
        error.cause?.name,
        "RpcTimeoutError",
        "The native open-orders snapshot cause must retain the broker's typed timeout name.",
      )
      return true
    },
    "A failed account-wide open-orders REST read must fail the audit with its original broker Error as cause.",
  )

  assert.equal(
    fixture.publishedEvents.length,
    0,
    "A failed account-wide open-orders REST read must not publish an audit event without authoritative data.",
  )
  assert.equal(
    fixture.getFlushCount(),
    0,
    "A failed account-wide open-orders REST read must not flush an audit event that was never published.",
  )
})


test("retains the first recovery account audit publication after a transient flush failure and retry", async () => {
  const market = createFixture().market
  const syncFailure = new Error("simulated Journal file sync failure")
  const fixture = createFixture({
    accountSnapshots: [
      createAccountSnapshot({ market, sourceTime: 100 }),
      createAccountSnapshot({ market, sourceTime: 101 }),
    ],
    flushResults: [
      { ok: false, durable: false, errors: [syncFailure] },
      { ok: true, durable: true },
    ],
  })

  await assert.rejects(
    fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" }),
    (error) => {
      assert.match(error.message, /Unable to durably persist RECOVERY account snapshot: simulated Journal file sync failure/)
      assert.deepEqual(error.recoveryFailure, {
        category: "DURABILITY",
        stage: "ACCOUNT_SNAPSHOT_AUDIT_FLUSH",
        retryable: true,
      }, "A transient Journal flush failure must be explicitly retryable only after a fresh recovery attempt.")
      return true
    },
    "A failed first Journal sync must reject the account audit even though its event publication already completed.",
  )

  assert.equal(
    fixture.publishedEvents.length,
    1,
    "The first recovery account audit event must remain published after its durability confirmation fails.",
  )
  assert.equal(
    fixture.publishedEvents[0].data.phase,
    "RECOVERY",
    "The first uncertain account audit event must retain its RECOVERY phase.",
  )
  assert.equal(
    fixture.getFlushCount(),
    1,
    "The first recovery account audit publication must attempt exactly one durability flush before failing.",
  )

  const retrySnapshot = await fixture.manager.publishAccountSnapshot({ phase: "RECOVERY" })

  assert.equal(
    retrySnapshot.sourceTime,
    101,
    "The later recovery attempt must use the next authoritative account snapshot after the transient flush failure.",
  )
  assert.equal(
    fixture.publishedEvents.length,
    2,
    "The retry must publish a second account audit rather than deleting or deduplicating the first uncertain publication.",
  )
  assert.notEqual(
    fixture.publishedEvents[0],
    fixture.publishedEvents[1],
    "The retry must create a distinct lifecycle event while preserving the original uncertain event object.",
  )
  assert.deepEqual(
    fixture.publishedEvents.map((event) => event.data.phase),
    ["RECOVERY", "RECOVERY"],
    "Both the uncertain first publication and successful retry publication must remain labeled as recovery audits.",
  )
  assert.equal(
    fixture.getFlushCount(),
    2,
    "The successful retry must perform a second flush that confirms durability for the retry sequence.",
  )
})
