import assert from "node:assert/strict"
import nodeTest from "node:test"
import { Asset, Market } from "@coinzilla/entities"
import { Portfolio } from "../../domain/portfolio/portfolio.js"
import { createAccountSnapshotManager } from "./create-account-snapshot-manager.js"

const test = (...args) => nodeTest(`[create-account-snapshot-manager.closing.test.js] ${args[0]}`, ...args.slice(1))

function createExternalSell() {
  return {
    id: "closing-external-sell-1",
    symbol: "BTCUSDT",
    side: "SELL",
    type: "LIMIT",
    originalPrice: "65000",
    originalQuantity: "0.01",
    executedQuantity: "0",
    status: "NEW",
    clientOrderId: "manual-closing-sell-1",
  }
}

function createTestEventPublisher({ publishedEvents, onFlush, flush }) {
  return {
    publish: (event) => {
      publishedEvents.push(event)
      return { ok: true }
    },
    flush: async () => {
      onFlush?.()
      if (flush) {
        return flush()
      }
      return {
        ok: true,
        durable: true,
      }
    },
  }
}

function createTestOperationalStateStore({ append, appendedFacts }) {
  return {
    append: async (fact) => {
      if (append) {
        return append(fact)
      }
      appendedFacts.push(fact)
      return {
        ok: true,
        data: {
          durable: true,
          record: fact,
        },
      }
    },
  }
}

function createManagerOptions({
  market,
  openOrders,
  openOrdersResult,
  append,
  appendedFacts,
  publishedEvents,
  onFlush,
  flush,
}) {
  return {
    broker: {
      getOpenOrders: async () => openOrdersResult ?? {
        ok: true,
        data: openOrders,
      },
    },
    eventPublisher: createTestEventPublisher({
      publishedEvents,
      onFlush,
      flush,
    }),
    marketMetadata: new Map([[market.symbol, { market }]]),
    getPortfolio: () => new Portfolio(),
    getTradingEngine: () => ({
      getOrders: () => [],
      getActiveOrders: () => [],
    }),
    getRecoveredState: () => ({
      orderRegistry: {
        orders: [],
      },
    }),
    getHasCanonicalOwnershipReconciliation: () => false,
    logger: {
      info() {},
    },
    now: () => 123,
    operationalStateStore: createTestOperationalStateStore({
      append,
      appendedFacts,
    }),
  }
}

function createFixture({ openOrders = [], openOrdersResult, append, flush } = {}) {
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
    symbol: "BTCUSDT",
    baseAsset,
    quoteAsset,
  })
  const publishedEvents = []
  const appendedFacts = []
  let flushCount = 0
  const manager = createAccountSnapshotManager(createManagerOptions({
    market,
    openOrders,
    openOrdersResult,
    append,
    appendedFacts,
    publishedEvents,
    onFlush: () => {
      flushCount += 1
    },
    flush,
  }))
  return {
    manager,
    publishedEvents,
    appendedFacts,
    getFlushCount: () => flushCount,
  }
}

test("publishes a durable CLOSING account-wide snapshot without adopting an external recovery SELL", async () => {
  const fixture = createFixture({
    openOrders: [createExternalSell()],
  })

  const orders = await fixture.manager.publishClosingOpenOrdersSnapshot({
    ownershipReconciled: true,
  })

  assert.equal(orders.length, 1)
  assert.equal(fixture.publishedEvents.length, 1)
  assert.deepEqual(fixture.publishedEvents[0].data, {
    phase: "CLOSING",
    observedAt: 123,
    readiness: "BLOCKED",
    orderCount: 1,
    orders: [{
      clientOrderId: "manual-closing-sell-1",
      brokerOrderId: "closing-external-sell-1",
      symbol: "BTCUSDT",
      side: "SELL",
      type: "LIMIT",
      price: "65000",
      quantity: "0.01",
      executedQuantity: "0",
      status: "NEW",
    }],
    blockReasons: ["UNOWNED_OPEN_ORDERS:1"],
  })
  assert.equal(fixture.appendedFacts.length, 1)
  assert.equal(fixture.appendedFacts[0].factType, "ACCOUNT_OPEN_ORDERS_CAPTURED")
  assert.deepEqual(fixture.appendedFacts[0].data, fixture.publishedEvents[0].data)
  assert.equal(fixture.getFlushCount(), 1)
  assert.equal(fixture.manager.getAccountSnapshot(), undefined)
})

test("uses a unique monotonic observation identity for repeated CLOSING snapshots in one clock tick", async () => {
  const fixture = createFixture({
    openOrders: [createExternalSell()],
  })

  await fixture.manager.publishClosingOpenOrdersSnapshot({
    ownershipReconciled: true,
  })
  await fixture.manager.publishClosingOpenOrdersSnapshot({
    ownershipReconciled: true,
  })

  assert.deepEqual(fixture.publishedEvents.map(({ data }) => data.observedAt), [123, 124])
  assert.notEqual(fixture.appendedFacts[0].factId, fixture.appendedFacts[1].factId)
  assert.equal(fixture.getFlushCount(), 2)
})

test("records a BLOCKED CLOSING open-order snapshot when the broker read fails with partial data", async () => {
  const timeout = Object.assign(new Error("account-wide open-orders RPC timed out"), {
    name: "RpcTimeoutError",
    code: "RPC_TIMEOUT",
  })
  const fixture = createFixture({
    openOrdersResult: {
      ok: false,
      errors: [timeout],
      data: [createExternalSell()],
    },
  })

  await assert.rejects(
    fixture.manager.publishClosingOpenOrdersSnapshot({
      ownershipReconciled: true,
    }),
    (error) => {
      assert.equal(error.recoveryFailure.stage, "ACCOUNT_WIDE_OPEN_ORDERS_READ")
      assert.equal(error.cause, timeout)
      return true
    },
  )

  assert.deepEqual(fixture.publishedEvents[0].data, {
    phase: "CLOSING",
    observedAt: 123,
    readiness: "BLOCKED",
    orderCount: 0,
    orders: [],
    blockReasons: ["CLOSING_OPEN_ORDERS_CAPTURE_FAILED"],
  })
  assert.equal(fixture.appendedFacts[0].data.readiness, "BLOCKED")
  assert.equal(fixture.getFlushCount(), 1)
})

test("records a BLOCKED CLOSING open-order snapshot when the broker payload is malformed", async () => {
  const fixture = createFixture({
    openOrders: [{}],
  })

  await assert.rejects(
    fixture.manager.publishClosingOpenOrdersSnapshot({
      ownershipReconciled: true,
    }),
    (error) => error.recoveryFailure.stage === "ACCOUNT_OPEN_ORDERS_AUDIT_PAYLOAD",
  )

  assert.equal(fixture.publishedEvents[0].data.readiness, "BLOCKED")
  assert.deepEqual(fixture.publishedEvents[0].data.orders, [])
  assert.deepEqual(fixture.publishedEvents[0].data.blockReasons, ["CLOSING_OPEN_ORDERS_CAPTURE_FAILED"])
  assert.equal(fixture.appendedFacts.length, 1)
  assert.equal(fixture.getFlushCount(), 1)
})

test("fails the CLOSING open-order audit when its Journal flush is not durable", async () => {
  const journalFailure = new Error("closing Journal flush failed")
  const fixture = createFixture({
    flush: async () => ({
      ok: false,
      errors: [journalFailure],
    }),
  })

  await assert.rejects(
    fixture.manager.publishClosingOpenOrdersSnapshot({
      ownershipReconciled: true,
    }),
    (error) => {
      assert.equal(error.recoveryFailure.stage, "ACCOUNT_OPEN_ORDERS_AUDIT_FLUSH_UNCLASSIFIED")
      assert.match(error.message, /Unable to durably persist CLOSING account open-orders snapshot/)
      return true
    },
  )

  assert.equal(fixture.appendedFacts.length, 1)
  assert.equal(fixture.publishedEvents.length, 1)
  assert.equal(fixture.getFlushCount(), 1)
})

test("preserves both capture and durability failures when a BLOCKED CLOSING snapshot cannot be persisted", async () => {
  const timeout = new Error("account-wide open-orders read failed")
  const writeFailure = new Error("Operational State Store append failed")
  const fixture = createFixture({
    openOrdersResult: {
      ok: false,
      errors: [timeout],
    },
    append: async () => ({
      ok: false,
      errors: [writeFailure],
    }),
  })

  await assert.rejects(
    fixture.manager.publishClosingOpenOrdersSnapshot({
      ownershipReconciled: true,
    }),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors.length, 2)
      assert.equal(error.errors[0].cause, timeout)
      assert.equal(error.errors[1].cause, writeFailure)
      return true
    },
  )

  assert.equal(fixture.publishedEvents.length, 0)
  assert.equal(fixture.getFlushCount(), 0)
})
