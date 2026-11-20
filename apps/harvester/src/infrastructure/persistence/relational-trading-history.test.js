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
  assert.equal(migrations.length, 3, "A fresh database must record schema, provenance, and cursor migrations.")
  assert.deepEqual(migrations.map(({ version }) => version), [1, 2, 3], "A fresh database must apply all ordered relational migrations.")
  assert.ok(migrations[0].checksum, "The migration history must record the implementation checksum.")
}

function assertFreshRelationalSchema(database) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all().map(({ name }) => name)
  for (const table of ["orders", "fills", "fill_commissions", "history_sync_cursors", "schema_migrations"]) {
    assert.ok(tables.includes(table), `A fresh Harvester database must contain the physical ${table} table.`)
  }
  assert.ok(!tables.includes("sessions"), "Phase 1 must not add a sessions table.")
  assert.ok(!tables.includes("errors"), "Phase 1 must not add an errors table.")
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
      "ingestion_source", "last_ingestion_source",
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
      "ingestion_source", "last_ingestion_source",
    ],
  })
  const exchangeLookupIndex = database.prepare("PRAGMA index_list(orders)").all().find(
    ({ name }) => name === "orders_exchange_lookup_idx",
  )
  assert.ok(exchangeLookupIndex, "Orders must have a provider-scoped exchange-order lookup index.")
  assert.equal(exchangeLookupIndex.unique, 0, "Exchange order IDs must not be assumed unique across every provider market.")
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

function assertMigratedLegacyIdentity({ migrated, legacyRecord }) {
  assert.equal(migrated.id, legacyRecord.id)
  assert.equal(migrated.provider_type, legacyRecord.providerType)
  assert.equal(migrated.provider_instance_id, legacyRecord.providerInstanceId)
  assert.equal(migrated.account_id, legacyRecord.accountId)
  assert.equal(migrated.environment, legacyRecord.environment)
  assert.equal(migrated.market_id, legacyRecord.market.id)
  assert.equal(migrated.symbol, legacyRecord.symbol)
  assert.equal(migrated.exchange_order_id, legacyRecord.brokerOrderId)
  assert.equal(migrated.client_order_id, legacyRecord.clientOrderId)
}

function assertMigratedLegacyFacts({ migrated, legacyRecord }) {
  assert.equal(migrated.side, legacyRecord.side)
  assert.equal(migrated.order_type, legacyRecord.type)
  assert.equal(migrated.status, legacyRecord.status)
  assert.equal(migrated.original_quantity, legacyRecord.originalQuantity)
  assert.equal(migrated.executed_quantity, legacyRecord.executedQuantity)
  assert.equal(migrated.remaining_quantity, legacyRecord.remainingQuantity)
  assert.equal(migrated.average_execution_price, null)
  assert.equal(migrated.local_first_observed_at, legacyRecord.firstSeenAt)
  assert.equal(migrated.local_last_observed_at, legacyRecord.lastSeenAt)
}

function assertMigratedLegacyProvenance({ migrated, legacyRecord }) {
  assert.ok(migrated.migrated_at)
  assert.equal(migrated.last_observed_source_kind, "legacy_harvester_orders")
  assert.equal(migrated.source_kind, "legacy_harvester_orders")
  assert.equal(migrated.ingestion_source, "legacy_migration")
  assert.equal(migrated.last_ingestion_source, "legacy_migration")
  assert.equal(migrated.source_record_id, legacyRecord.id)
}

function assertLegacySourcePreserved({ database, legacyRecord }) {
  const source = database.prepare(
    "SELECT record FROM db_records WHERE collection = ? AND id = ?",
  ).get("harvester_orders", legacyRecord.id)
  assert.ok(source)
  assert.deepEqual(JSON.parse(source.record), legacyRecord)
}

function assertNoSyntheticFills({ database }) {
  const fills = database.prepare("SELECT COUNT(*) AS count FROM fills").get()
  assert.equal(fills.count, 0)
}

function assertMigratedLegacyHistory({ database, legacyRecord } = {}) {
  const migrated = database.prepare("SELECT * FROM orders").get()
  assert.ok(migrated, "Every valid legacy harvester_orders record must have a relational orders row.")
  assertMigratedLegacyIdentity({
    migrated,
    legacyRecord,
  })
  assertMigratedLegacyFacts({
    migrated,
    legacyRecord,
  })
  assertMigratedLegacyProvenance({
    migrated,
    legacyRecord,
  })
  assertLegacySourcePreserved({
    database,
    legacyRecord,
  })
  assertNoSyntheticFills({
    database,
  })
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
      quoteValue: {
        amount: "0.001234567890123456",
        assetId: "usdt",
        asset: "USDT",
      },
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

function assertLinkedFill({ database } = {}) {
  const order = database.prepare(
    "SELECT id, strategy_id, position_id, cycle_id FROM orders",
  ).get()
  const fill = database.prepare("SELECT * FROM fills").get()
  assert.ok(order, "A later canonical order event must create the relational parent order.")
  assert.equal(fill.order_id, order.id, "A previously unlinked fill must link to the matching scoped order.")
  assert.equal(fill.strategy_id, order.strategy_id, "Strategy attribution must come only from the verified order relationship.")
  assert.equal(fill.position_id, order.position_id, "Position attribution must come only from the verified order relationship.")
  assert.equal(fill.cycle_id, order.cycle_id, "Cycle attribution must come only from the verified order relationship.")
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

function assertCommissionQuoteValueConstraint({ database, fill } = {}) {
  const statement = database.prepare(`
    INSERT INTO fill_commissions (
      fill_id, ordinal, amount, asset_id, asset_code,
      quote_value_amount, quote_value_asset_id, quote_value_asset_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  assert.throws(
    () => statement.run(fill.id, 1, "0.1", "bnb", "BNB", "0.1", null, null),
    /CHECK constraint failed/,
    "A commission quote valuation must be wholly present or wholly absent.",
  )
}

function assertFillIdentityAndProvenance({ fill } = {}) {
  assert.equal(fill.canonical_fill_id, "binance:BTCUSDT:trade-0001", "The canonical fill identity must be retained separately from the scoped row key.")
  assert.equal(fill.provider_type, "binance", "Fill provider type must be preserved.")
  assert.equal(fill.provider_instance_id, "binanceTestnet", "Fill provider instance must be preserved.")
  assert.equal(fill.account_id, "binance-primary", "Fill account identity must be preserved.")
  assert.equal(fill.environment, "testnet", "Fill trading environment must be preserved.")
  assert.equal(fill.market_id, "binance:BTCUSDT", "Fill market identity must be preserved.")
  assert.equal(fill.symbol, "BTCUSDT", "Fill symbol must be preserved.")
  assert.equal(fill.side, "BUY", "Fill side must be preserved.")
  assert.equal(fill.exchange_order_id, "order-0001", "Exchange order ID must be preserved.")
  assert.equal(fill.client_order_id, "client-order-0001", "Client order ID must be preserved.")
  assert.equal(fill.liquidity_role, "TAKER", "Execution liquidity role must be preserved.")
  assert.equal(fill.commission_status, "COMPLETE", "Canonical commission status must be preserved.")
  assert.equal(fill.source_kind, "live_fill_applied", "Fill provenance must identify the applied-fill observer.")
  assert.equal(fill.ingestion_source, "live_event", "Live fill rows must identify their event ingestion path.")
  assert.equal(fill.source_event_name, HARVESTER_EVENT_NAMES.FILL_APPLIED, "Fill source event name must be retained.")
  assert.equal(fill.source_event_source, "harvester", "Fill source event producer must be retained.")
  assert.equal(fill.last_source_event_id, fill.source_event_id, "The first fill observation must also be its latest source event.")
  assert.equal(fill.source_event_timestamp, fill.local_observed_at, "Source event and local observation timestamps must remain aligned.")
  assert.equal(new Date(fill.local_observed_at).toISOString(), fill.local_observed_at, "Local ingestion timestamps must use canonical UTC ISO-8601.")
  assert.ok(fill.last_observed_at, "The latest local fill observation timestamp must be stored.")
}

function assertFillFinancialFacts({ fill } = {}) {
  assert.equal(fill.exchange_trade_id, "trade-0001", "The exchange execution identifier must be preserved exactly.")
  assert.equal(fill.execution_price, "100000.00000001", "Execution price must remain an exact decimal string.")
  assert.equal(fill.executed_base_quantity, "0.123456789123", "Base quantity must remain an exact decimal string.")
  assert.equal(fill.executed_quote_quantity, "12345.67890123", "Quote quantity must remain an exact decimal string.")
  assert.equal(fill.exchange_executed_at, "2025-11-18T21:06:40.123Z", "Exchange execution time must be preserved separately in canonical UTC ISO-8601.")
}

function assertFillCommissionFacts({ database, fill } = {}) {
  const commission = database.prepare("SELECT * FROM fill_commissions").get()
  assert.ok(commission, "The actual commission must be stored in a readable commission row.")
  assert.equal(commission.amount, "0.000012340000000001", "Commission amount must retain all supplied decimal precision.")
  assert.equal(commission.asset_id, "bnb", "Commission asset identity must be preserved.")
  assert.equal(commission.asset_code, "BNB", "Commission asset code must be preserved.")
  assert.equal(commission.quote_value_amount, "0.001234567890123456", "Actual third-asset commission valuation must preserve its exact quote amount.")
  assert.equal(commission.quote_value_asset_id, "usdt", "Commission quote valuation asset identity must be preserved.")
  assert.equal(commission.quote_value_asset_code, "USDT", "Commission quote valuation asset code must be preserved.")
  assertCommissionQuoteValueConstraint({
    database,
    fill,
  })
}

function assertPersistedFill({ database } = {}) {
  const fill = database.prepare("SELECT * FROM fills").get()
  assert.ok(fill, "One canonical applied execution must create one physical fills row.")
  assertFillIdentityAndProvenance({ fill })
  assertFillFinancialFacts({ fill })
  assertFillCommissionFacts({
    database,
    fill,
  })
  assert.equal(fill.strategy_id, null, "Missing order ownership must remain nullable rather than inventing strategy attribution.")
  assert.equal(fill.order_id, null, "A fill without a verified relational parent must retain a nullable order reference.")
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
    version: 4,
    name: "harvester-relational-interrupted-test",
    up(transaction) {
      transaction.exec("CREATE TABLE interrupted_probe (id TEXT PRIMARY KEY)")
      throw new Error("intentional migration interruption")
    },
  }
}

function createRetryMigration() {
  return {
    version: 4,
    name: "harvester-relational-interrupted-test",
    up(transaction) {
      transaction.exec("CREATE TABLE retry_probe (id TEXT PRIMARY KEY)")
    },
  }
}

async function assertMigrationRetry({ database } = {}) {
  await assert.rejects(
    database.migrate([
      ...HARVESTER_RELATIONAL_MIGRATIONS,
      createInterruptedMigration(),
    ]),
    /intentional migration interruption/,
    "An interrupted migration must reject instead of recording a successful version.",
  )
  const partialTable = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'interrupted_probe'",
  ).get()
  assert.equal(partialTable, undefined, "A failed migration must roll back its partial DDL.")
  const retry = createRetryMigration()
  await database.migrate([
    ...HARVESTER_RELATIONAL_MIGRATIONS,
    retry,
  ])
  await database.migrate([
    ...HARVESTER_RELATIONAL_MIGRATIONS,
    retry,
  ])
  const applied = database.prepare(
    "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?",
  ).get(4)
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

test("links an earlier fill to its later matching order projection without inventing attribution", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  const fill = createAppliedFillEvent({
    overrides: {
      clientOrderId: "harvester-BTCUSDT-001",
      brokerOrderId: "broker-order-001",
    },
  })
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill,
  })
  assert.equal((await persistence.fillObserver.flush()).ok, true, "A fill may be persisted before its order projection exists.")
  context.eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  await context.eventBus.flush()
  assert.equal((await persistence.observer.flush()).ok, true, "The legacy order-history observer must remain active.")
  assert.equal((await persistence.relationalOrderObserver.flush()).ok, true, "The relational order observer must persist the later order event.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => assertLinkedFill({ database }),
  })
})

test("does not infer a relational order link from an exchange order ID without a client identity", async (t) => {
  const context = await createTestContext({ t })
  const legacyRecord = createLegacyRecord()
  await seedLegacyRecord({
    filename: context.filename,
    record: legacyRecord,
  })
  const persistence = await preparePersistence({ context })
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill: createAppliedFillEvent({
      overrides: {
        clientOrderId: undefined,
        brokerOrderId: legacyRecord.brokerOrderId,
      },
    }),
  })
  assert.equal((await persistence.fillObserver.flush()).ok, true, "An execution without a client order ID must still be stored.")
  context.eventBus.publish({
    name: HARVESTER_EVENT_NAMES.ORDER_UPDATED,
    source: "harvester",
    data: createOrderHistoryEventData(),
  })
  await context.eventBus.flush()
  await persistence.relationalOrderObserver.flush()
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const fill = database.prepare("SELECT * FROM fills").get()
      assert.equal(fill.order_id, null, "An exchange order ID alone must not create an unverified local order relationship.")
      assert.equal(fill.strategy_id, null, "Unverified exchange-order matching must not fabricate strategy attribution.")
    },
  })
})

test("rejects fill-to-order attribution when client and exchange order identities conflict", async (t) => {
  const context = await createTestContext({ t })
  const legacyRecord = createLegacyRecord()
  await seedLegacyRecord({
    filename: context.filename,
    record: legacyRecord,
  })
  const persistence = await preparePersistence({ context })
  await publishAppliedFill({
    eventBus: context.eventBus,
    fill: createAppliedFillEvent({
      overrides: {
        brokerOrderId: "different-broker-order",
        clientOrderId: legacyRecord.clientOrderId,
      },
    }),
  })
  const result = await persistence.fillObserver.flush()
  assert.equal(result.ok, false, "A fill must not be attributed to an order with a different client-order identity.")
  assert.equal(result.errors[0].code, "HARVESTER_ORDER_HISTORY_IDENTITY_CONFLICT", "Mismatched order linkage must be reported as an integrity conflict.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const fills = database.prepare("SELECT COUNT(*) AS count FROM fills").get()
      assert.equal(fills.count, 0, "A conflicting fill must not be persisted with incorrect order attribution.")
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

test("scopes identical trade IDs by provider, provider instance, account, and market", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  const fills = [
    createAppliedFillEvent(),
    createAppliedFillEvent({
      overrides: {
        accountId: "binance-secondary",
        brokerOrderId: "order-secondary",
        clientOrderId: "client-order-secondary",
      },
    }),
    createAppliedFillEvent({
      overrides: {
        providerInstanceId: "binanceSecondary",
        brokerOrderId: "order-instance-secondary",
        clientOrderId: "client-order-instance-secondary",
      },
    }),
    createAppliedFillEvent({
      overrides: {
        fillId: "other-provider:BTCUSDT:trade-0001",
        providerType: "other-provider",
        providerInstanceId: "other-provider-main",
        brokerOrderId: "other-provider-order",
        clientOrderId: "other-provider-client",
      },
    }),
  ]
  for (const fill of fills) {
    await publishAppliedFill({
      eventBus: context.eventBus,
      fill,
    })
  }
  const result = await persistence.fillObserver.flush()
  assert.equal(result.ok, true, "The same provider trade ID in different scopes must not be treated as a conflicting duplicate.")
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const rows = database.prepare("SELECT COUNT(*) AS count FROM fills").get()
      assert.equal(rows.count, 4, "Distinct provider/account/instance/market scopes must retain separate execution rows.")
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


test("stores exchange-history provenance and links only the verified scoped order", async (t) => {
  const context = await createTestContext({
    t,
  })
  const persistence = await preparePersistence({
    context,
  })
  const historicalOrder = {
    ...createLegacyRecord(),
  }
  delete historicalOrder.ownership
  await persistence.orderRepository.upsertHistorical(historicalOrder)
  const historicalFill = createAppliedFillEvent()
  historicalFill.clientOrderId = historicalOrder.clientOrderId
  historicalFill.brokerOrderId = historicalOrder.brokerOrderId
  await persistence.fillRepository.upsert({
    fill: historicalFill,
    sourceEvent: {
      id: "exchange-history-fill:binance-primary:binance:BTCUSDT:trade-0001",
      name: "execution.fill_history_reconciled",
      source: "binance.exchange-history",
      timestamp: "2026-11-20T04:00:00.000Z",
    },
    environment: "testnet",
    ingestionSource: "exchange_history",
  })
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const order = database.prepare("SELECT * FROM orders").get()
      const fill = database.prepare("SELECT * FROM fills").get()
      assert.equal(order.ingestion_source, "exchange_history")
      assert.equal(order.strategy_id, null)
      assert.equal(fill.ingestion_source, "exchange_history")
      assert.equal(fill.last_ingestion_source, "exchange_history")
      assert.equal(fill.order_id, order.id)
      assert.equal(fill.strategy_id, null)
    },
  })
})


test("upgrades an existing relational v1 database with exchange-history provenance", async (t) => {
  const context = await createTestContext({
    t,
  })
  const database = createSqliteDatabase({
    filename: context.filename,
  })
  await database.connect()
  await database.migrate([
    HARVESTER_RELATIONAL_MIGRATIONS[0],
  ])
  await database.close()
  const persistence = await preparePersistence({
    context,
  })
  assert.ok(persistence.relationalDatabase)
  await inspectSqlite({
    filename: context.filename,
    work: (connection) => {
      assertMigrationHistory(connection)
      assertColumnsPresent({
        database: connection,
        table: "orders",
        columns: ["ingestion_source", "last_ingestion_source"],
      })
      assertColumnsPresent({
        database: connection,
        table: "fills",
        columns: ["ingestion_source", "last_ingestion_source"],
      })
      assertColumnsPresent({
        database: connection,
        table: "history_sync_cursors",
        columns: ["last_order_sync_at"],
      })
    },
  })
})


async function assertEmptyHistoryCursor({ repository, providerIdentity, environment, symbol }) {
  const cursor = await repository.get({
    providerIdentity,
    environment,
    symbol,
  })
  assert.deepEqual(cursor, {
    lastOrderId: null,
    lastOrderSyncAt: null,
    lastTradeId: null,
  }, "A new scoped cursor must start with no order, order-time, or trade checkpoint.")
}

test("keeps durable history cursors isolated by provider, account, environment, and market", async (t) => {
  const context = await createTestContext({
    t,
  })
  const persistence = await preparePersistence({
    context,
  })
  const providerIdentity = {
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
  }
  const repository = persistence.historySyncCursorRepository
  await assertEmptyHistoryCursor({
    repository,
    providerIdentity,
    environment: "testnet",
    symbol: "BTCUSDT",
  })
  await repository.saveOrderCursor({
    providerIdentity,
    environment: "testnet",
    symbol: "BTCUSDT",
    lastOrderId: "100",
    lastOrderSyncAt: "2026-11-20T04:00:00.000Z",
    updatedAt: "2026-11-20T04:00:00.000Z",
  })
  await repository.saveTradeCursor({
    providerIdentity,
    environment: "testnet",
    symbol: "BTCUSDT",
    lastTradeId: "200",
    updatedAt: "2026-11-20T04:00:01.000Z",
  })
  assert.deepEqual(await repository.get({
    providerIdentity,
    environment: "testnet",
    symbol: "BTCUSDT",
  }), {
    lastOrderId: "100",
    lastOrderSyncAt: "2026-11-20T04:00:00.000Z",
    lastTradeId: "200",
  }, "Order and trade cursors must retain their independent durable checkpoints.")
  await repository.saveOrderCursor({
    providerIdentity,
    environment: "testnet",
    symbol: "BTCUSDT",
    lastOrderId: "90",
    lastOrderSyncAt: "2026-11-19T04:00:00.000Z",
    updatedAt: "2026-11-20T04:00:02.000Z",
  })
  assert.deepEqual(await repository.get({
    providerIdentity,
    environment: "testnet",
    symbol: "BTCUSDT",
  }), {
    lastOrderId: "100",
    lastOrderSyncAt: "2026-11-20T04:00:00.000Z",
    lastTradeId: "200",
  }, "A retried older order checkpoint must never move either order cursor backwards.")

  await Promise.all([
    assertEmptyHistoryCursor({
      repository,
      providerIdentity: { ...providerIdentity, accountId: "binance-secondary" },
      environment: "testnet",
      symbol: "BTCUSDT",
    }),
    assertEmptyHistoryCursor({
      repository,
      providerIdentity,
      environment: "live",
      symbol: "BTCUSDT",
    }),
    assertEmptyHistoryCursor({
      repository,
      providerIdentity,
      environment: "testnet",
      symbol: "ETHUSDT",
    }),
  ])
})

function createExchangeHistoryOrder({ status, executedQuantity, remainingQuantity, eventId, timestamp, clientOrderId = "harvester-BTCUSDT-unfilled", brokerOrderId = "broker-order-unfilled" }) {
  const order = createOrderHistoryEventData({
    clientOrderId,
    brokerOrderId,
    originalQuantity: "1.0000",
    executedQuantity,
    remainingQuantity,
    status,
    ownership: undefined,
  })
  return createOrderHistoryRecord({
    order,
    sourceEvent: {
      id: eventId,
      name: "exchange.history_order_observed",
      source: "binance.exchange-history",
      timestamp,
    },
    environment: "testnet",
    includeUnfilled: true,
  })
}

function createOrderProviderIdentity({ order }) {
  return {
    providerInstanceId: order.providerInstanceId,
    providerType: order.providerType,
    accountId: order.accountId,
  }
}

async function assertPendingOrderId({ repository, order, expected }) {
  assert.equal(
    await repository.getOldestPendingOrderId({
      providerIdentity: createOrderProviderIdentity({
        order,
      }),
      environment: "testnet",
      symbol: order.symbol,
    }),
    expected,
  )
}

async function assertPersistedUnfilledOrder({ context, order }) {
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const saved = database.prepare(
        "SELECT * FROM orders WHERE client_order_id = ?",
      ).get(order.clientOrderId)
      assert.ok(saved)
      assert.equal(saved.executed_quantity, "0")
      assert.equal(saved.remaining_quantity, "1.0000")
      assert.equal(saved.strategy_id, null)
      assert.equal(saved.ingestion_source, "exchange_history")
    },
  })
}

test("persists exchange-observed unfilled orders for later fill reconciliation", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  const record = createExchangeHistoryOrder({
    status: "OPEN",
    executedQuantity: "0",
    remainingQuantity: "1.0000",
    eventId: "exchange-history-order:unfilled",
    timestamp: "2026-11-20T04:00:00.000Z",
  })
  await persistence.orderRepository.upsertHistorical(record)
  await assertPendingOrderId({
    repository: persistence.orderRepository,
    order: record,
    expected: record.brokerOrderId,
  })
  await assertPersistedUnfilledOrder({
    context,
    order: record,
  })
})

test("removes a refreshed filled order from pending-order lookup", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  const unfilledRecord = createExchangeHistoryOrder({
    status: "OPEN",
    executedQuantity: "0",
    remainingQuantity: "1.0000",
    eventId: "exchange-history-order:pending",
    timestamp: "2026-11-20T04:00:00.000Z",
  })
  await persistence.orderRepository.upsertHistorical(unfilledRecord)
  const filledRecord = createExchangeHistoryOrder({
    status: "FILLED",
    executedQuantity: "1.0000",
    remainingQuantity: "0",
    eventId: "exchange-history-order:now-filled",
    timestamp: "2026-11-20T04:00:01.000Z",
  })
  await persistence.orderRepository.upsertHistorical(filledRecord)
  await assertPendingOrderId({
    repository: persistence.orderRepository,
    order: filledRecord,
    expected: null,
  })
})

function createExchangeOrderLookup({ order }) {
  return {
    providerIdentity: createOrderProviderIdentity({
      order,
    }),
    environment: order.environment,
    marketId: order.market.id,
    brokerOrderId: order.brokerOrderId,
  }
}

function createAmbiguousHistoryOrder({ clientOrderId, brokerOrderId, environment }) {
  return createOrderHistoryRecord({
    order: createOrderHistoryEventData({
      clientOrderId,
      brokerOrderId,
      ownership: undefined,
    }),
    sourceEvent: {
      id: `exchange-history-order:${clientOrderId}`,
      name: "exchange.history_order_observed",
      source: "binance.exchange-history",
      timestamp: "2026-11-20T04:00:01.000Z",
    },
    environment,
    includeUnfilled: true,
  })
}

async function assertNoExchangeOrderLookup({ repository, lookup }) {
  assert.equal(await repository.findByExchangeOrderIdentity(lookup), null)
}

test("resolves exchange order identity only within its full provider scope and rejects ambiguity", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  const firstOrder = { ...createLegacyRecord() }
  delete firstOrder.ownership
  await persistence.orderRepository.upsertHistorical(firstOrder)
  const lookup = createExchangeOrderLookup({
    order: firstOrder,
  })
  assert.equal(
    await persistence.orderRepository.findByExchangeOrderIdentity(lookup),
    firstOrder.clientOrderId,
  )
  await assertNoExchangeOrderLookup({
    repository: persistence.orderRepository,
    lookup: {
      ...lookup,
      environment: "live",
    },
  })
  await assertNoExchangeOrderLookup({
    repository: persistence.orderRepository,
    lookup: {
      ...lookup,
      marketId: "binance:ETHUSDT",
    },
  })
  const secondOrder = createAmbiguousHistoryOrder({
    clientOrderId: "harvester-BTCUSDT-other",
    brokerOrderId: firstOrder.brokerOrderId,
    environment: firstOrder.environment,
  })
  await persistence.orderRepository.upsertHistorical(secondOrder)
  assert.throws(
    () => persistence.orderRepository.findByExchangeOrderIdentity(lookup),
    /exchangeOrderIdAmbiguous/,
  )
})

test("preserves an existing verified client-order identity when a history replay omits it", async (t) => {
  const context = await createTestContext({
    t,
  })
  const persistence = await preparePersistence({
    context,
  })
  const liveFill = createAppliedFillEvent()
  await persistence.fillRepository.upsert({
    fill: liveFill,
    sourceEvent: {
      id: "live-fill-applied:duplicate",
      name: "execution.fill_applied",
      source: "binance.user-data",
      timestamp: "2026-11-20T04:00:00.000Z",
    },
    environment: "testnet",
  })
  const historicalFill = createAppliedFillEvent()
  delete historicalFill.clientOrderId
  await persistence.fillRepository.upsert({
    fill: historicalFill,
    sourceEvent: {
      id: "exchange-history-fill:duplicate",
      name: "execution.fill_history_reconciled",
      source: "binance.exchange-history",
      timestamp: "2026-11-20T04:00:01.000Z",
    },
    environment: "testnet",
    ingestionSource: "exchange_history",
  })
  await inspectSqlite({
    filename: context.filename,
    work: (database) => {
      const saved = database.prepare("SELECT * FROM fills").get()
      assert.equal(saved.client_order_id, liveFill.clientOrderId)
      assert.equal(saved.ingestion_source, "live_event")
      assert.equal(saved.last_ingestion_source, "exchange_history")
    },
  })
})


async function assertPendingOrderIds({ repository, providerIdentity, symbol, expected }) {
  assert.deepEqual(
    await repository.listPendingOrderIds({
      providerIdentity,
      environment: "testnet",
      symbol,
    }),
    expected,
    "The pending-order query must return every non-terminal exchange order in its full provider/account/environment/market scope.",
  )
}

test("lists all pending exchange orders for the exact provider and market scope", async (t) => {
  const context = await createTestContext({ t })
  const persistence = await preparePersistence({ context })
  const providerIdentity = {
    providerInstanceId: "binanceTestnet",
    providerType: "binance",
    accountId: "binance-primary",
  }
  const first = createExchangeHistoryOrder({
    status: "OPEN",
    executedQuantity: "0",
    remainingQuantity: "1.0000",
    eventId: "exchange-history-order:pending-one",
    timestamp: "2026-11-20T04:00:00.000Z",
    clientOrderId: "harvester-pending-one",
    brokerOrderId: "100",
  })
  const second = createExchangeHistoryOrder({
    status: "PARTIALLY_FILLED",
    executedQuantity: "0.2500",
    remainingQuantity: "0.7500",
    eventId: "exchange-history-order:pending-two",
    timestamp: "2026-11-20T04:00:01.000Z",
    clientOrderId: "harvester-pending-two",
    brokerOrderId: "200",
  })
  const terminal = createExchangeHistoryOrder({
    status: "FILLED",
    executedQuantity: "1.0000",
    remainingQuantity: "0",
    eventId: "exchange-history-order:terminal",
    timestamp: "2026-11-20T04:00:02.000Z",
    clientOrderId: "harvester-terminal",
    brokerOrderId: "300",
  })
  await persistence.orderRepository.upsertHistorical(first)
  await persistence.orderRepository.upsertHistorical(second)
  await persistence.orderRepository.upsertHistorical(terminal)
  await assertPendingOrderIds({
    repository: persistence.orderRepository,
    providerIdentity,
    symbol: "BTCUSDT",
    expected: ["100", "200"],
  })
  await assertPendingOrderIds({
    repository: persistence.orderRepository,
    providerIdentity: {
      ...providerIdentity,
      accountId: "binance-secondary",
    },
    symbol: "BTCUSDT",
    expected: [],
  })
})
