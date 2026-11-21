import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { closeHarvesterPersistence } from "./close-harvester-persistence.js"
import { prepareOrderHistoryPersistence } from "./prepare-order-history-persistence.js"
import { createTradingHistoryQueryRepository } from "./trading-history-query-repository.js"
import { resolveHarvesterDatabaseFilename } from "./resolve-harvester-database-filename.js"
import { createOrderHistoryEventData } from "../../../test-support/order-history-fixtures.js"

function createAppliedFillEvent() {
  return {
    fillId: "binance:BTCUSDT:trade-0001",
    tradeId: "trade-0001",
    brokerOrderId: "broker-order-001",
    clientOrderId: "harvester-BTCUSDT-001",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    symbol: "BTCUSDT",
    side: "BUY",
    price: "65000.0000",
    quantity: "0.2500",
    quoteQuantity: "16250.0000",
    liquidityRole: "TAKER",
    executedAt: 1_763_500_000_123,
    commissions: [{
      amount: "0.00025000",
      assetId: "asset:BNB",
      asset: "BNB",
      quoteValue: {
        amount: "0.05000000",
        assetId: "asset:USDT",
        asset: "USDT",
      },
    }],
    commissionStatus: "COMPLETE",
  }
}

async function createQueryContext({ t, includeOrder = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-trading-history-query-"))
  const eventBus = new EventBus()
  const filename = resolveHarvesterDatabaseFilename({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: directory,
    },
  })
  let persistence = null
  t.after(async () => {
    await closeHarvesterPersistence(persistence ?? {})
    await eventBus.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  persistence = await prepareOrderHistoryPersistence({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: directory,
    },
    eventBus,
    logger: { error() {} },
  })
  assert.ok(persistence, "A valid temporary TESTNET database must prepare the existing trading-history persistence.")
  assert.ok(persistence.relationalDatabase, "The query contract test requires the existing relational trading-history database.")
  if (includeOrder) {
    eventBus.publish({
      name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
      source: "harvester",
      data: createOrderHistoryEventData(),
    })
    await eventBus.flush()
    await persistence.relationalOrderObserver.flush()
  }
  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    source: "harvester",
    data: createAppliedFillEvent(),
  })
  await eventBus.flush()
  await persistence.fillObserver.flush()
  return {
    filename,
    persistence,
    repository: createTradingHistoryQueryRepository({
      database: persistence.relationalDatabase,
    }),
  }
}

test("prepares a query repository for persisted orders, fills and commission facts", async (t) => {
  const { repository } = await createQueryContext({ t })

  assert.ok(repository, "Harvester persistence must compose a query repository over the existing relational tables.")
  assert.equal(typeof repository.getSummary, "function", "The query repository must expose record counts for the API metadata resource.")
  assert.equal(typeof repository.listOrders, "function", "The query repository must expose paginated order records.")
  assert.equal(typeof repository.findOrderById, "function", "The query repository must expose exact order details.")
  assert.equal(typeof repository.listFills, "function", "The query repository must expose paginated execution records.")
  assert.equal(typeof repository.findFillById, "function", "The query repository must expose exact execution details with commissions.")
  assert.equal(typeof repository.listCommissions, "function", "The query repository must expose persisted commission facts.")
});

test("lists exact persisted order, fill and commission values without deriving financial facts", async (t) => {
  const { repository } = await createQueryContext({ t })
  assert.ok(repository, "The relational query repository must be available before record queries can run.")

  const orderPage = repository.listOrders({
    filters: {
      symbol: "BTCUSDT",
    },
    pagination: {
      limit: 10,
      offset: 0,
    },
  })
  assert.equal(orderPage.pagination.total, 1, "The BTCUSDT filter must count only the persisted order matching that market.")
  assert.equal(orderPage.items[0].originalQuantity, "1.0000", "The order query must preserve the exact persisted original quantity.")
  assert.equal(orderPage.items[0].executedQuantity, "0.2500", "The order query must preserve the exact persisted executed quantity.")
  assert.equal(orderPage.items[0].averageExecutionPrice, null, "An unknown average execution price must remain null instead of being estimated.")

  const fillPage = repository.listFills({
    filters: {
      symbol: "BTCUSDT",
      side: "BUY",
    },
    pagination: {
      limit: 10,
      offset: 0,
    },
  })
  assert.equal(fillPage.pagination.total, 1, "The fill query must return the actual individual execution matching the market and side.")
  assert.equal(fillPage.items[0].executionPrice, "65000.0000", "The fill query must preserve the exact execution price string.")
  assert.equal(fillPage.items[0].executedBaseQuantity, "0.2500", "The fill query must preserve the exact executed base quantity string.")
  assert.equal(fillPage.items[0].executedQuoteQuantity, "16250.0000", "The fill query must preserve the exact executed quote quantity string.")

  const fill = repository.findFillById({ id: fillPage.items[0].id })
  assert.equal(fill.commissions[0].fillId, fill.id, "Fill commission details must expose their persisted fill foreign key.")
  assert.equal(fill.commissions[0].ordinal, 0, "Fill commission details must expose their persisted ordinal.")
  assert.equal(fill.commissions[0].amount, "0.00025000", "Fill details must include the exact persisted commission amount.")
  assert.equal(fill.commissions[0].assetCode, "BNB", "Fill details must preserve the actual commission asset.")
  assert.equal(fill.commissions[0].quoteValueAmount, "0.05000000", "A supplied commission valuation must be preserved without recalculation.")

  const commissionPage = repository.listCommissions({
    filters: {
      assetCode: "BNB",
    },
    pagination: {
      limit: 10,
      offset: 0,
    },
  })
  assert.equal(commissionPage.pagination.total, 1, "The commission asset filter must return the persisted BNB commission fact.")
  assert.equal(commissionPage.items[0].ordinal, 0, "Commission list records must expose the persisted ordinal.")
  assert.equal(commissionPage.items[0].localObservedAt, "2026-11-19T20:26:40.123Z", "Commission records must expose their joined fill observation timestamp.")
  assert.equal(commissionPage.items[0].amount, "0.00025000", "The commission list must preserve the exact stored amount.")
  assert.equal(commissionPage.items[0].quoteValueAmount, "0.05000000", "The commission list must preserve a stored quote valuation.")
});

test("returns an applied fill while its matching order projection is not yet available", async (t) => {
  const { repository } = await createQueryContext({
    t,
    includeOrder: false,
  })

  const page = repository.listFills({
    filters: {
      symbol: "BTCUSDT",
    },
    pagination: {
      limit: 10,
      offset: 0,
    },
  })
  assert.equal(page.pagination.total, 1, "An applied fill must remain queryable before its order projection is observed.")
  assert.equal(page.items[0].orderId, null, "The API must preserve the missing order relationship instead of fabricating an ID.")
  assert.equal(page.items[0].clientOrderId, "harvester-BTCUSDT-001", "The fill must retain its available Harvester client-order identity.")
  assert.equal(page.items[0].exchangeOrderId, "broker-order-001", "The fill must retain its available exchange order identity.")

  const fill = repository.findFillById({
    id: page.items[0].id,
  })
  assert.equal(fill.orderId, null, "Fill details must preserve the nullable order relationship.")
  assert.equal(fill.clientOrderId, "harvester-BTCUSDT-001", "Fill details must expose the client-order identity for later reconciliation.")
})

test("returns deterministic pagination metadata and explicit missing-record results", async (t) => {
  const { repository } = await createQueryContext({ t })
  assert.ok(repository, "The relational query repository must be available to verify pagination and missing records.")

  const page = repository.listOrders({
    filters: {},
    pagination: {
      limit: 1,
      offset: 1,
    },
  })
  assert.deepEqual(page.pagination, {
    limit: 1,
    offset: 1,
    total: 1,
    hasMore: false,
  }, "Pagination metadata must report the exact result count and whether another page exists.")
  assert.equal(repository.findOrderById({ id: "missing-order" }), null, "A missing order detail must be returned as null rather than an infrastructure exception.")
  assert.equal(repository.findFillById({ id: "missing-fill" }), null, "A missing fill detail must be returned as null rather than an infrastructure exception.")
});
