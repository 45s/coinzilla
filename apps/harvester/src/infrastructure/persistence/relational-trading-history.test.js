import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  createDatabase,
  createSqliteDatabase,
  createSqliteProvider,
  restoreSqliteDatabase,
} from "@coinzilla/db"
import { EventBus } from "@coinzilla/event-bus"
import { HARVESTER_EVENT_NAMES } from "../../application/events/event-names.js"
import { createOrderHistoryRecord } from "../../domain/order-history/order-history-record.js"
import { closeHarvesterPersistence } from "./close-harvester-persistence.js"
import { createFillHistoryObserver } from "./create-fill-history-observer.js"
import { prepareOrderHistoryPersistence } from "./prepare-order-history-persistence.js"
import { resolveHarvesterDatabaseFilename } from "./resolve-harvester-database-filename.js"
import { HARVESTER_RELATIONAL_MIGRATIONS } from "./relational-migrations.js"
import { createOrderHistoryEventData } from "../../../test-support/order-history-fixtures.js"

async function createTestContext({ t } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-relational-history-"))
  const eventBus = new EventBus()
  const filename = resolveHarvesterDatabaseFilename({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: directory,
    },
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
    setPersistence: (value) => {
      persistence = value
    },
  }
}

async function preparePersistence({ context, logger = { error() {} } } = {}) {
  const persistence = await prepareOrderHistoryPersistence({
    tradingMode: "testnet",
    env: {
      HARVESTER_DATABASE_DIRECTORY: context.directory,
    },
    eventBus: context.eventBus,
    logger,
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

function assertUniqueIdentity({ database, table, row } = {}) {
  const columns = Object.keys(row)
  const duplicate = {
    ...row,
    id: `duplicate:${row.id}`,
  }
  const statement = database.prepare(
    `INSERT INTO ${table} (${columns.join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
  )
  assert.throws(
    () => statement.run(...columns.map((column) => duplicate[column])),
    /UNIQUE constraint failed/,
    `The ${table} scoped identity must reject a second physical row.`,
  )
}

function assertMigratedLegacyHistory({ database, legacyRecord } = {}) {
  const migrated = database.prepare("SELECT * FROM orders").get()
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
  assertUniqueIdentity({
    database,
    table: "orders",
    row: migrated,
  })
}

function createAppliedFillEvent({ overrides = {} } = {}) {
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
    ...overrides,
  }
}

async function publishAppliedFill({ eventBus, fill } = {}) {
  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    source: "harvester",
    data: fill,
  })
  await eventBus.flush()
}

function assertFillForeignKey({ database, fill } = {}) {
  const foreignKeys = database.prepare("PRAGMA foreign_key_list(fills)").all()
  assert.ok(
    foreignKeys.some(({ table, from, to }) => table === "orders" && from === "order_id" && to === "id"),
    "fills.order_id must reference orders.id as a real SQLite foreign key.",
  )
  assert.throws(
    () => database.prepare("UPDATE fills SET order_id = ? WHERE id = ?").run("missing-order-id", fill.id),
    /FOREIGN KEY constraint failed/,
    "SQLite must reject a fill reference to a non-existent order.",
  )
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
  return fill
}

async function assertBackupAndRollback({ filename, backupFilename, legacyRecord } = {}) {
  assert.ok(backupFilename, "Existing legacy history must have a verified pre-migration backup.")
  const stagingFilename = `${filename}.rollback-staging`
  await restoreSqliteDatabase({
    backupFilename,
    filename: stagingFilename,
    timeout: 5_000,
  })
  await inspectSqlite({
    filename: stagingFilename,
    work: (database) => {
      const integrity = database.prepare("PRAGMA integrity_check").get()
      assert.equal(integrity.integrity_check, "ok", "A restored pre-migration backup must pass SQLite integrity checking.")
      const source = database.prepare(
        "SELECT record FROM db_records WHERE collection = ? AND id = ?",
      ).get("harvester_orders", legacyRecord.id)
      assert.ok(source, "Rollback must preserve the original legacy order-history record.")
      assert.deepEqual(JSON.parse(source.record), legacyRecord, "Rollback must restore the exact original source payload.")
      const ordersTable = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'",
      ).get()
      assert.equal(ordersTable, undefined, "The verified backup must represent the pre-relational schema.")
    },
  })
}

function createInterruptedMigration() {
  return {
    version: 2,
    name: "harvester-relational-interrupted-test",
    up(transaction) {
      transaction.exec("CREATE TABLE interrupted_probe (id TEXT PRIMARY KEY)")
      throw new Error("intentional migration interruption")
    },
  }
}

function createRetryMigration() {
  return {
    version: 2,
    name: "harvester-relational-interrupted-test",
    up(transaction) {
      transaction.exec("CREATE TABLE retry_probe (id TEXT PRIMARY KEY)")
    },
  }
}

async function assertMigrationRetry({ database } = {}) {
  await assert.rejects(
    database.migrate([createInterruptedMigration()]),
    /intentional migration interruption/,
    "An interrupted migration must reject instead of recording a successful version.",
  )
  const partialTable = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'interrupted_probe'",
  ).get()
  assert.equal(partialTable, undefined, "A failed migration must roll back its partial DDL.")
  const retry = createRetryMigration()
  await database.migrate([retry])
  await database.migrate([retry])
  const applied = database.prepare(
    "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?",
  ).get(2)
  assert.equal(applied.count, 1, "A repaired migration must apply once and remain idempotent on repetition.")
}

function createDeferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return {
    promise,
    resolve,
  }
}

test("creates versioned physical orders, fills, and commission tables on a fresh database", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  assert.ok(persistence, "A valid fresh TESTNET database must prepare the existing order-history observer.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => assertFreshRelationalSchema(database),
  })
  await persistence.relationalDatabase.migrate(HARVESTER_RELATIONAL_MIGRATIONS)
  await assertMigrationRetry({
    database: persistence.relationalDatabase,
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
  await assertBackupAndRollback({
    filename: context.filename,
    backupFilename: persistence.migrationBackupFilename,
    legacyRecord,
  })
  await persistence.relationalDatabase.migrate(HARVESTER_RELATIONAL_MIGRATIONS)
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const count = database.prepare("SELECT COUNT(*) AS count FROM orders").get()
      assert.equal(count.count, 1, "Repeated startup migration must not duplicate migrated order history.")
    },
  })
})

test("persists actual applied fills asynchronously with exact execution and commission facts", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  assert.ok(persistence, "The existing order-history persistence must remain available when relational fill history is enabled.")
  assert.ok(persistence.fillObserver, "Phase 2 must expose a separate bounded observer for canonical execution.fill_applied events.")
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill: createAppliedFillEvent(),
  })
  const observerResult = await persistence.fillObserver.flush()
  assert.equal(observerResult.ok, true, "A valid applied execution must drain successfully into relational history.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const fill = assertPersistedFill({ database })
      assertUniqueIdentity({
        database,
        table: "fills",
        row: fill,
      })
      assertFillForeignKey({
        database,
        fill,
      })
    },
  })
})

test("preserves very large financial decimals without floating-point conversion", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  const price = "999999999999999999999999999999.123456789012345678901234567890"
  const quantity = "123456789012345678901234567890.12345678901234567890"
  const quoteQuantity = "123456789012345678901234567890123456789.12345678901234567890"
  const fill = createAppliedFillEvent({
    overrides: {
      fillId: "binance:BTCUSDT:trade-large",
      tradeId: "trade-large",
      price,
      quantity,
      quoteQuantity,
    },
  })
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill,
  })
  const result = await persistence.fillObserver.flush()
  assert.equal(result.ok, true, "Large exact decimal facts must be accepted by relational fill persistence.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const stored = database.prepare("SELECT * FROM fills").get()
      assert.equal(stored.execution_price, price, "Large execution price must round-trip byte-for-byte.")
      assert.equal(stored.executed_base_quantity, quantity, "Large base quantity must round-trip byte-for-byte.")
      assert.equal(stored.executed_quote_quantity, quoteQuantity, "Large quote quantity must round-trip byte-for-byte.")
    },
  })
})

test("deduplicates identical applied executions without creating duplicate commission rows", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  const fill = createAppliedFillEvent()
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill,
  })
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill,
  })
  const result = await persistence.fillObserver.flush()
  assert.equal(result.ok, true, "An identical execution replay must be idempotent.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const fills = database.prepare("SELECT COUNT(*) AS count FROM fills").get()
      const commissions = database.prepare("SELECT COUNT(*) AS count FROM fill_commissions").get()
      assert.equal(fills.count, 1, "An identical exchange execution must create exactly one fill row.")
      assert.equal(commissions.count, 1, "An identical replay must not duplicate actual commission facts.")
    },
  })
})

test("rejects conflicting facts for an already-seen provider-scoped execution identity", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill: createAppliedFillEvent(),
  })
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill: createAppliedFillEvent({
      overrides: {
        price: "100001.00000001",
      },
    }),
  })
  const result = await persistence.fillObserver.flush()
  assert.equal(result.ok, false, "Conflicting facts for one scoped execution identity must be reported as an integrity failure.")
  assert.equal(result.errors[0].code, "HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT", "A conflicting duplicate must retain its stable integrity error code.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const fill = database.prepare("SELECT * FROM fills").get()
      assert.equal(fill.execution_price, "100000.00000001", "Conflicting replay must not overwrite the original execution fact.")
    },
  })
})

test("rolls back incompatible legacy migration and retries without losing the source record", async (t) => {
  const context = await createTestContext({ t })
  const legacyRecord = createLegacyRecord()
  await seedLegacyRecord({
    filename: context.filename,
    record: legacyRecord,
  })
  const incompatibleRecord = {
    ...legacyRecord,
    id: "incompatible-order-identity",
  }
  await inspectSqlite({
    filename: context.filename,
    work: (database) => database.prepare(
      "UPDATE db_records SET record = ? WHERE collection = ? AND id = ?",
    ).run(
      JSON.stringify(incompatibleRecord),
      "harvester_orders",
      legacyRecord.id,
    ),
  })
  const failed = await preparePersistence({ context })
  assert.ok(failed.relationalError, "An incompatible legacy identity must fail relational migration visibly.")
  assert.equal(failed.relationalDatabase, null, "A failed relational migration must not activate relational observers.")
  assert.equal(failed.relationalError.code, "HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT", "The migration failure must expose a stable identity-conflict code.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const source = database.prepare(
        "SELECT record FROM db_records WHERE collection = ? AND id = ?",
      ).get("harvester_orders", legacyRecord.id)
      assert.deepEqual(JSON.parse(source.record), incompatibleRecord, "A failed migration must leave the original source collection untouched.")
      const orders = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'",
      ).get()
      assert.equal(orders, undefined, "Failed migration DDL must roll back atomically.")
    },
  })
  await closeHarvesterPersistence(failed)
  await inspectSqlite({
    filename: context.filename,
    work: (database) => database.prepare(
      "UPDATE db_records SET record = ? WHERE collection = ? AND id = ?",
    ).run(
      JSON.stringify(legacyRecord),
      "harvester_orders",
      legacyRecord.id,
    ),
  })
  const recovered = await preparePersistence({ context })
  assert.ok(recovered.relationalDatabase, "A repaired legacy record must allow the unapplied migration to retry successfully.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => assertMigratedLegacyHistory({
      database,
      legacyRecord,
    }),
  })
})

async function createEnvironmentPersistence({
  directory,
  tradingMode,
  eventBus,
} = {}) {
  const env = {
    HARVESTER_DATABASE_DIRECTORY: directory,
  }
  const filename = resolveHarvesterDatabaseFilename({
    tradingMode,
    env,
  })
  const persistence = await prepareOrderHistoryPersistence({
    tradingMode,
    env,
    eventBus,
    logger: { error() {} },
  })
  return {
    filename,
    persistence,
  }
}

async function assertEnvironmentFill({ filename, expectedEnvironment } = {}) {
  await inspectSqlite({
    filename,
    work: (database) => {
      const row = database.prepare("SELECT environment FROM fills").get()
      assert.equal(
        row.environment,
        expectedEnvironment,
        `${expectedEnvironment.toUpperCase()} database rows must retain their own environment.`,
      )
    },
  })
}

test("keeps TESTNET and LIVE relational histories in separate database files", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "harvester-environment-isolation-"))
  const testnetEventBus = new EventBus()
  const liveEventBus = new EventBus()
  const resources = {
    testnetPersistence: null,
    livePersistence: null,
  }
  t.after(async () => {
    await closeHarvesterPersistence(resources.testnetPersistence ?? {})
    await closeHarvesterPersistence(resources.livePersistence ?? {})
    await testnetEventBus.close()
    await liveEventBus.close()
    await rm(directory, {
      recursive: true,
      force: true,
    })
  })
  const testnet = await createEnvironmentPersistence({
    directory,
    tradingMode: "testnet",
    eventBus: testnetEventBus,
  })
  const live = await createEnvironmentPersistence({
    directory,
    tradingMode: "live",
    eventBus: liveEventBus,
  })
  resources.testnetPersistence = testnet.persistence
  resources.livePersistence = live.persistence
  assert.notEqual(testnet.filename, live.filename, "TESTNET and LIVE must resolve to different SQLite files.")
  await publishAppliedFill({
    eventBus: testnetEventBus,
    fill: createAppliedFillEvent(),
  })
  await publishAppliedFill({
    eventBus: liveEventBus,
    fill: createAppliedFillEvent(),
  })
  assert.equal((await testnet.persistence.fillObserver.flush()).ok, true, "TESTNET fill history must persist independently.")
  assert.equal((await live.persistence.fillObserver.flush()).ok, true, "LIVE fill history must persist independently.")
  await assertEnvironmentFill({
    filename: testnet.filename,
    expectedEnvironment: "testnet",
  })
  await assertEnvironmentFill({
    filename: live.filename,
    expectedEnvironment: "live",
  })
})

test("keeps EventBus delivery non-blocking when the bounded fill queue is full", async (t) => {
  const eventBus = new EventBus()
  const deferred = createDeferred()
  const observer = createFillHistoryObserver({
    eventBus,
    repository: {
      upsert: () => deferred.promise,
    },
    environment: "testnet",
    logger: { error() {} },
    maxPending: 1,
  })
  t.after(async () => {
    deferred.resolve("cleanup")
    await observer.close()
    await eventBus.close()
  })
  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    source: "harvester",
    data: createAppliedFillEvent(),
  })
  eventBus.publish({
    name: HARVESTER_EVENT_NAMES.FILL_APPLIED,
    source: "harvester",
    data: createAppliedFillEvent({
      overrides: {
        fillId: "binance:BTCUSDT:trade-0002",
        tradeId: "trade-0002",
      },
    }),
  })
  await eventBus.flush()
  await Promise.resolve()
  const diagnostics = observer.getDiagnostics()
  assert.equal(diagnostics.pendingCount, 1, "The fill observer must enforce its configured pending-write bound.")
  assert.equal(diagnostics.droppedCount, 1, "Overflow must be recorded as an observable history gap.")
  deferred.resolve("persisted")
  const result = await observer.flush()
  assert.equal(result.ok, false, "A queue overflow must be reported without blocking EventBus delivery.")
  assert.equal(result.diagnostics.failureCount, 1, "The observer must retain the queue-overflow failure count.")
})
