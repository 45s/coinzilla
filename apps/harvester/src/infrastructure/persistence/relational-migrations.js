import { createHash } from "node:crypto"
import {
  OrderHistoryIntegrityError,
  OrderHistoryValidationError,
} from "../../domain/order-history/order-history-errors.js"
import {
  ORDER_COLUMNS,
  mapOrderHistoryRecordToRow,
} from "./order-row-mapping.js"

const INITIAL_ORDER_COLUMNS = Object.freeze(
  ORDER_COLUMNS.filter((column) => !["ingestion_source", "last_ingestion_source"].includes(column)),
)

const CREATE_RELATIONAL_TABLES_SQL = `
  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    provider_type TEXT NOT NULL,
    provider_instance_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('testnet', 'live')),
    market_id TEXT NOT NULL,
    market_venue TEXT NOT NULL,
    symbol TEXT NOT NULL,
    base_asset_id TEXT NOT NULL,
    base_asset_code TEXT NOT NULL,
    quote_asset_id TEXT NOT NULL,
    quote_asset_code TEXT NOT NULL,
    exchange_order_id TEXT,
    client_order_id TEXT NOT NULL,
    strategy_id TEXT,
    position_id TEXT,
    ownership_purpose TEXT,
    cycle_id TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    order_type TEXT NOT NULL,
    limit_price TEXT,
    average_execution_price TEXT,
    original_quantity TEXT NOT NULL,
    executed_quantity TEXT NOT NULL,
    cumulative_quote_quantity TEXT,
    remaining_quantity TEXT NOT NULL,
    status TEXT NOT NULL,
    exchange_created_at TEXT,
    exchange_acknowledged_at TEXT,
    exchange_updated_at TEXT,
    exchange_completed_at TEXT,
    exchange_transaction_at TEXT,
    local_first_observed_at TEXT NOT NULL,
    local_last_observed_at TEXT NOT NULL,
    first_source_event_id TEXT NOT NULL,
    last_source_event_id TEXT NOT NULL,
    last_source_event_name TEXT NOT NULL,
    last_source_event_source TEXT NOT NULL,
    last_source_event_timestamp TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('legacy_harvester_orders', 'live_order_event')),
    last_observed_source_kind TEXT NOT NULL CHECK (last_observed_source_kind IN ('legacy_harvester_orders', 'live_order_event')),
    source_record_id TEXT,
    migrated_at TEXT,
    last_execution_type TEXT,
    UNIQUE (environment, provider_instance_id, provider_type, account_id, client_order_id)
  );
  CREATE INDEX orders_exchange_lookup_idx
    ON orders(environment, provider_instance_id, provider_type, account_id, market_id, exchange_order_id)
    WHERE exchange_order_id IS NOT NULL;
  CREATE INDEX orders_market_time_idx
    ON orders(environment, provider_type, provider_instance_id, account_id, market_id, exchange_created_at);
  CREATE INDEX orders_strategy_time_idx ON orders(strategy_id, exchange_created_at);
  CREATE TABLE fills (
    id TEXT PRIMARY KEY,
    canonical_fill_id TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    provider_instance_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    environment TEXT NOT NULL CHECK (environment IN ('testnet', 'live')),
    market_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    exchange_trade_id TEXT NOT NULL,
    exchange_order_id TEXT NOT NULL,
    client_order_id TEXT,
    order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
    strategy_id TEXT,
    position_id TEXT,
    cycle_id TEXT,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    execution_price TEXT NOT NULL,
    executed_base_quantity TEXT NOT NULL,
    executed_quote_quantity TEXT NOT NULL,
    liquidity_role TEXT NOT NULL,
    commission_status TEXT NOT NULL,
    exchange_executed_at TEXT,
    local_observed_at TEXT NOT NULL,
    last_observed_at TEXT NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind = 'live_fill_applied'),
    source_event_id TEXT NOT NULL,
    last_source_event_id TEXT NOT NULL,
    source_event_name TEXT NOT NULL,
    source_event_source TEXT NOT NULL,
    source_event_timestamp TEXT NOT NULL,
    UNIQUE (provider_type, provider_instance_id, account_id, environment, market_id, exchange_trade_id)
  );
  CREATE INDEX fills_market_time_idx
    ON fills(environment, provider_type, provider_instance_id, account_id, market_id, exchange_executed_at);
  CREATE INDEX fills_strategy_time_idx ON fills(strategy_id, exchange_executed_at);
  CREATE TABLE fill_commissions (
    id INTEGER PRIMARY KEY,
    fill_id TEXT NOT NULL REFERENCES fills(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    amount TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    asset_code TEXT NOT NULL,
    quote_value_amount TEXT,
    quote_value_asset_id TEXT,
    quote_value_asset_code TEXT,
    UNIQUE (fill_id, ordinal),
    CHECK (
      (quote_value_amount IS NULL AND quote_value_asset_id IS NULL AND quote_value_asset_code IS NULL)
      OR
      (quote_value_amount IS NOT NULL AND quote_value_asset_id IS NOT NULL AND quote_value_asset_code IS NOT NULL)
    )
  );
  CREATE INDEX fill_commissions_asset_idx ON fill_commissions(asset_id, fill_id);
`

function createRelationalTables(transaction) {
  transaction.exec(CREATE_RELATIONAL_TABLES_SQL)
}

function hasTable({ transaction, name } = {}) {
  return transaction.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name) !== undefined
}

function insertLegacyOrder({ transaction, sourceRow } = {}) {
  let record
  try {
    record = JSON.parse(sourceRow.record)
  } catch (cause) {
    throw new OrderHistoryValidationError({
      field: "legacyRecordJson",
      cause,
    })
  }
  if (record.id !== sourceRow.id) {
    throw new OrderHistoryIntegrityError({
      field: "legacyRecordId",
      providerInstanceId: record.providerInstanceId,
      accountId: record.accountId,
      clientOrderId: record.clientOrderId,
    })
  }
  const row = mapOrderHistoryRecordToRow({
    record,
    sourceKind: "legacy_harvester_orders",
    sourceRecordId: sourceRow.id,
    migratedAt: new Date().toISOString(),
    includeUnfilled: false,
  })
  const statement = transaction.prepare(
    `INSERT INTO orders (${INITIAL_ORDER_COLUMNS.join(", ")})
     VALUES (${INITIAL_ORDER_COLUMNS.map(() => "?").join(", ")})`,
  )
  try {
    statement.run(...INITIAL_ORDER_COLUMNS.map((column) => row[column]))
  } catch (cause) {
    throw new OrderHistoryIntegrityError({
      field: "legacyOrderIdentity",
      cause,
      providerInstanceId: record.providerInstanceId,
      accountId: record.accountId,
      clientOrderId: record.clientOrderId,
    })
  }
}

function migrateLegacyOrders(transaction) {
  if (!hasTable({
    transaction,
    name: "db_records",
  })) {
    return
  }
  const records = transaction.prepare(
    "SELECT id, record FROM db_records WHERE collection = ? ORDER BY id",
  ).all("harvester_orders")
  for (const sourceRow of records) {
    insertLegacyOrder({
      transaction,
      sourceRow,
    })
  }
}

function hashLegacyRecords(transaction) {
  const hash = createHash("sha256")
  if (!hasTable({
    transaction,
    name: "db_records",
  })) {
    return {
      count: 0,
      checksum: hash.digest("hex"),
    }
  }
  const records = transaction.prepare(
    "SELECT id, record FROM db_records WHERE collection = ? ORDER BY id",
  ).all("harvester_orders")
  for (const record of records) {
    hash.update(record.id)
    hash.update("\0")
    hash.update(record.record)
    hash.update("\0")
  }
  return {
    count: records.length,
    checksum: hash.digest("hex"),
  }
}

function verifyLegacyMigration({ transaction, sourceSnapshot } = {}) {
  const actualSource = hashLegacyRecords(transaction)
  if (actualSource.count !== sourceSnapshot.count ||
    actualSource.checksum !== sourceSnapshot.checksum) {
    throw new OrderHistoryIntegrityError({
      field: "legacySourcePreservation",
    })
  }
  const migrated = transaction.prepare(
    "SELECT COUNT(*) AS count FROM orders WHERE source_kind = ?",
  ).get("legacy_harvester_orders")
  if (migrated.count !== sourceSnapshot.count) {
    throw new OrderHistoryIntegrityError({
      field: "legacyMigrationCount",
    })
  }
}

function migrateRelationalTradingHistory(transaction) {
  const sourceSnapshot = hashLegacyRecords(transaction)
  createRelationalTables(transaction)
  migrateLegacyOrders(transaction)
  verifyLegacyMigration({
    transaction,
    sourceSnapshot,
  })
}

function migrateExchangeHistoryProvenance(transaction) {
  transaction.exec(`
    ALTER TABLE orders
      ADD COLUMN ingestion_source TEXT NOT NULL DEFAULT 'live_event'
      CHECK (ingestion_source IN ('live_event', 'exchange_history', 'legacy_migration'));
    ALTER TABLE orders
      ADD COLUMN last_ingestion_source TEXT NOT NULL DEFAULT 'live_event'
      CHECK (last_ingestion_source IN ('live_event', 'exchange_history', 'legacy_migration'));
    UPDATE orders
      SET ingestion_source = 'legacy_migration',
        last_ingestion_source = 'legacy_migration'
      WHERE source_kind = 'legacy_harvester_orders';
    ALTER TABLE fills
      ADD COLUMN ingestion_source TEXT NOT NULL DEFAULT 'live_event'
      CHECK (ingestion_source IN ('live_event', 'exchange_history'));
    ALTER TABLE fills
      ADD COLUMN last_ingestion_source TEXT NOT NULL DEFAULT 'live_event'
      CHECK (last_ingestion_source IN ('live_event', 'exchange_history'));
  `)
}

function migrateHistorySyncCursors(transaction) {
  transaction.exec(`
    CREATE TABLE history_sync_cursors (
      id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK (environment IN ('testnet', 'live')),
      symbol TEXT NOT NULL,
      last_order_id TEXT,
      last_trade_id TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (environment, provider_instance_id, provider_type, account_id, symbol)
    );
    CREATE INDEX history_sync_cursors_scope_idx
      ON history_sync_cursors(environment, provider_instance_id, provider_type, account_id);
  `)
}

function migrateOrderHistoryTimeCursor(transaction) {
  transaction.exec(
    "ALTER TABLE history_sync_cursors ADD COLUMN last_order_sync_at TEXT",
  )
}

export const HARVESTER_RELATIONAL_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "harvester-relational-trading-history",
    up: migrateRelationalTradingHistory,
  }),
  Object.freeze({
    version: 2,
    name: "harvester-exchange-history-provenance",
    up: migrateExchangeHistoryProvenance,
  }),
  Object.freeze({
    version: 3,
    name: "harvester-history-sync-cursors",
    up: migrateHistorySyncCursors,
  }),
  Object.freeze({
    version: 4,
    name: "harvester-order-history-time-cursor",
    up: migrateOrderHistoryTimeCursor,
  }),
])
