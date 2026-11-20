import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  createDatabase,
  createSqliteDatabase,
  createSqliteProvider,
} from "@coinzilla/db"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { createOrderHistoryRecord } from "../../domain/order-history/order-history-record.js"
import { closeHarvesterPersistence } from "./close-harvester-persistence.js"
import { prepareOrderHistoryPersistence } from "./prepare-order-history-persistence.js"
import { resolveHarvesterDatabaseFilename } from "./resolve-harvester-database-filename.js"
import { createOrderHistoryEventData } from "../../../test-support/order-history-fixtures.js"

async function createTestContext({ t } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-relational-history-"))
  const eventBus = new EventBus()
  const filename = resolveHarvesterDatabaseFilename({
    tradingMode: "testnet",
    env: { HARVESTER_DATABASE_DIRECTORY: directory },
  })
  let persistence
  t.after(async () => {
    await closeHarvesterPersistence(persistence ?? {})
    await eventBus.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  return {
    directory,
    eventBus,
    filename,
    setPersistence: (value) => { persistence = value },
  }
}

async function preparePersistence({ context } = {}) {
  const persistence = await prepareOrderHistoryPersistence({
    tradingMode: "testnet",
    env: { HARVESTER_DATABASE_DIRECTORY: context.directory },
    eventBus: context.eventBus,
    logger: { error() {} },
  })
  context.setPersistence(persistence)
  return persistence
}

async function inspectSqlite({ filename, work } = {}) {
  const database = createSqliteDatabase({ filename })
  await database.connect()
  try {
    return work(database)
  } finally {
    await database.close()
  }
}

function assertColumnsPresent({ database, table, columns } = {}) {
  const actual = database.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name)
  for (const column of columns) {
    assert.ok(actual.includes(column), `The ${table} table must expose the readable ${column} column.`)
  }
}

function assertMigrationHistory(database) {
  const migrations = database.prepare(
    "SELECT version, name, checksum FROM schema_migrations ORDER BY version",
  ).all()
  assert.equal(migrations.length, 1, "A fresh database must record exactly one initial Harvester relational migration.")
  assert.equal(migrations[0].version, 1, "The initial Harvester relational schema must use migration version 1.")
  assert.ok(migrations[0].checksum, "The migration history must record the implementation checksum.")
}

function assertFreshRelationalSchema(database) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all().map(({ name }) => name)
  for (const table of ["orders", "fills", "fill_commissions", "schema_migrations"]) {
    assert.ok(tables.includes(table), `A fresh Harvester database must contain the physical ${table} table.`)
  }
  assertColumnsPresent({
    database,
    table: "orders",
    columns: [
      "provider_type", "provider_instance_id", "account_id", "environment",
      "market_id", "symbol", "exchange_order_id", "client_order_id",
      "strategy_id", "side", "order_type", "limit_price", "average_execution_price",
      "original_quantity", "executed_quantity", "cumulative_quote_quantity",
      "remaining_quantity", "status", "exchange_created_at", "exchange_updated_at",
      "local_first_observed_at", "local_last_observed_at", "source_kind", "source_record_id",
    ],
  })
  assertColumnsPresent({
    database,
    table: "fills",
    columns: [
      "provider_type", "provider_instance_id", "account_id", "environment",
      "market_id", "symbol", "exchange_trade_id", "exchange_order_id", "order_id",
      "client_order_id", "strategy_id", "cycle_id", "side", "execution_price",
      "executed_base_quantity", "executed_quote_quantity", "commission_status",
      "exchange_executed_at", "local_observed_at", "source_kind",
    ],
  })
  assertMigrationHistory(database)
}

function createLegacyRecord() {
  return createOrderHistoryRecord({
    order: createOrderHistoryEventData(),
    sourceEvent: {
      id: "legacy-source-event-1",
      name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
      source: "harvester",
      timestamp: "2026-11-19T12:00:00.000Z",
    },
    environment: "testnet",
  })
}

async function seedLegacyRecord({ filename, record } = {}) {
  const database = createDatabase({
    provider: createSqliteProvider({
      filename,
      timeout: 5_000,
    }),
  })
  await database.connect()
  try {
    await database.create({
      collection: "harvester_orders",
      record,
    })
  } finally {
    await database.close()
  }
}

function assertMigratedLegacyHistory({ database, legacyRecord } = {}) {
  const migrated = database.prepare(
    "SELECT id, executed_quantity, source_kind, source_record_id FROM orders",
  ).get()
  assert.ok(migrated, "Every valid legacy harvester_orders record must have a relational orders row.")
  assert.equal(migrated.id, legacyRecord.id, "Migration must preserve the original composite order identity.")
  assert.equal(migrated.executed_quantity, legacyRecord.executedQuantity, "Migration must preserve the exact cumulative execution decimal string.")
  assert.equal(migrated.source_kind, "legacy_harvester_orders", "Migrated rows must retain explicit legacy migration provenance.")
  assert.equal(migrated.source_record_id, legacyRecord.id, "Migrated rows must point to their exact source record.")
  const source = database.prepare(
    "SELECT record FROM db_records WHERE collection = ? AND id = ?",
  ).get("harvester_orders", legacyRecord.id)
  assert.ok(source, "The original harvester_orders source record must remain available after migration.")
  assert.deepEqual(JSON.parse(source.record), legacyRecord, "Migration must not rewrite the original JSON history record.")
  const fills = database.prepare("SELECT COUNT(*) AS count FROM fills").get()
  assert.equal(fills.count, 0, "Cumulative order execution quantity must never be converted into synthetic fill records.")
}

function createAppliedFillEvent() {
  return {
    fillId: "binance:BTCUSDT:trade-0001",
    tradeId: "trade-0001",
    brokerOrderId: "order-0001",
    clientOrderId: "client-order-0001",
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
    symbol: "BTCUSDT",
    side: "BUY",
    price: "100000.00000001",
    quantity: "0.123456789123",
    quoteQuantity: "12345.67890123",
    liquidityRole: "TAKER",
    executedAt: 1_763_500_000_123,
    commissions: [{
      amount: "0.000012340000000001",
      assetId: "bnb",
      asset: "BNB",
    }],
    commissionStatus: "COMPLETE",
  }
}

function assertPersistedFill({ database } = {}) {
  const fill = database.prepare("SELECT * FROM fills").get()
  assert.ok(fill, "One canonical applied execution must create one physical fills row.")
  assert.equal(fill.exchange_trade_id, "trade-0001", "The exchange execution identifier must be preserved exactly.")
  assert.equal(fill.execution_price, "100000.00000001", "Execution price must remain an exact decimal string.")
  assert.equal(fill.executed_base_quantity, "0.123456789123", "Base quantity must remain an exact decimal string.")
  assert.equal(fill.executed_quote_quantity, "12345.67890123", "Quote quantity must remain an exact decimal string.")
  assert.equal(fill.exchange_executed_at, "2025-11-18T21:06:40.123Z", "Exchange execution time must be preserved separately in canonical UTC ISO-8601.")
  assert.ok(fill.local_observed_at, "Local observation time must be recorded independently from exchange execution time.")
  const commission = database.prepare("SELECT * FROM fill_commissions").get()
  assert.ok(commission, "The actual commission must be stored in a readable commission row.")
  assert.equal(commission.amount, "0.000012340000000001", "Commission amount must retain all supplied decimal precision.")
  assert.equal(commission.asset_id, "bnb", "Commission asset identity must be preserved.")
  assert.equal(commission.asset_code, "BNB", "Commission asset code must be preserved.")
  assert.equal(fill.strategy_id, null, "Missing order ownership must remain nullable rather than inventing strategy attribution.")
  assert.equal(fill.order_id, null, "A fill without a verified relational parent order must retain a nullable order reference.")
}

test("creates versioned physical orders, fills, and commission tables on a fresh database", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  assert.ok(persistence, "A valid fresh TESTNET database must prepare the existing order-history observer.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => assertFreshRelationalSchema(database),
  })
})

test("migrates legacy harvester_orders without deleting source records or fabricating fills", async (t) => {
  const context = await createTestContext({ t })
  const legacyRecord = createLegacyRecord()
  await seedLegacyRecord({
    filename: context.filename,
    record: legacyRecord,
  })
  const persistence = await preparePersistence({ context })
  assert.ok(persistence, "An existing database with valid legacy order history must remain available after migration.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => assertMigratedLegacyHistory({
      database,
      legacyRecord,
    }),
  })
})

test("persists actual applied fills asynchronously with exact execution and commission facts", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  assert.ok(persistence, "The existing order-history persistence must remain available when relational fill history is enabled.")
  assert.ok(persistence.fillObserver, "Phase 2 must expose a separate bounded observer for canonical execution.fill_applied events.")
  context.eventBus.publish({
    name: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    source: "harvester",
    data: createAppliedFillEvent(),
  })
  await context.eventBus.flush()
  const observerResult = await persistence.fillObserver.flush()
  assert.equal(observerResult.ok, true, "A valid applied execution must drain successfully into relational history.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => assertPersistedFill({ database }),
  })
})
