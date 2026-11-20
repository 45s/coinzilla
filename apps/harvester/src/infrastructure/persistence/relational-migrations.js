import { OrderHistoryIntegrityError, OrderHistoryValidationError } from "../../domain/order-history/order-history-errors.js"
import { ORDER_COLUMNS, mapOrderHistoryRecordToRow } from "./order-row-mapping.js"

const CREATE_RELATIONAL_TABLES_SQL = `
    CREATE TABLE orders (
      id TEXT PRIMARY KEY, provider_type TEXT NOT NULL, provider_instance_id TEXT NOT NULL,
      account_id TEXT NOT NULL, environment TEXT NOT NULL CHECK (environment IN ('testnet', 'live')),
      market_id TEXT NOT NULL, market_venue TEXT NOT NULL, symbol TEXT NOT NULL,
      base_asset_id TEXT NOT NULL, base_asset_code TEXT NOT NULL, quote_asset_id TEXT NOT NULL,
      quote_asset_code TEXT NOT NULL, exchange_order_id TEXT, client_order_id TEXT NOT NULL,
      strategy_id TEXT, position_id TEXT, ownership_purpose TEXT, cycle_id TEXT,
      side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')), order_type TEXT NOT NULL,
      limit_price TEXT, average_execution_price TEXT, original_quantity TEXT NOT NULL,
      executed_quantity TEXT NOT NULL, cumulative_quote_quantity TEXT, remaining_quantity TEXT NOT NULL,
      status TEXT NOT NULL, exchange_created_at TEXT, exchange_acknowledged_at TEXT,
      exchange_updated_at TEXT, exchange_completed_at TEXT, exchange_transaction_at TEXT,
      local_first_observed_at TEXT NOT NULL, local_last_observed_at TEXT NOT NULL,
      first_source_event_id TEXT NOT NULL, last_source_event_id TEXT NOT NULL,
      last_source_event_name TEXT NOT NULL, last_source_event_source TEXT NOT NULL,
      last_source_event_timestamp TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('legacy_harvester_orders', 'live_order_event')),
      last_observed_source_kind TEXT NOT NULL CHECK (last_observed_source_kind IN ('legacy_harvester_orders', 'live_order_event')),
      source_record_id TEXT, migrated_at TEXT, last_execution_type TEXT,
      UNIQUE (environment, provider_instance_id, provider_type, account_id, client_order_id)
    );
    CREATE UNIQUE INDEX orders_exchange_identity_idx
      ON orders(environment, provider_instance_id, provider_type, account_id, exchange_order_id)
      WHERE exchange_order_id IS NOT NULL;
    CREATE INDEX orders_market_time_idx
      ON orders(environment, provider_type, provider_instance_id, account_id, market_id, exchange_created_at);
    CREATE INDEX orders_strategy_time_idx ON orders(strategy_id, exchange_created_at);
    CREATE TABLE fills (
      id TEXT PRIMARY KEY, canonical_fill_id TEXT NOT NULL, provider_type TEXT NOT NULL,
      provider_instance_id TEXT NOT NULL, account_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK (environment IN ('testnet', 'live')),
      market_id TEXT NOT NULL, symbol TEXT NOT NULL,
      exchange_trade_id TEXT NOT NULL, exchange_order_id TEXT NOT NULL, client_order_id TEXT,
      order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
      strategy_id TEXT, position_id TEXT, cycle_id TEXT,
      side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
      execution_price TEXT NOT NULL, executed_base_quantity TEXT NOT NULL,
      executed_quote_quantity TEXT NOT NULL, liquidity_role TEXT NOT NULL,
      commission_status TEXT NOT NULL, exchange_executed_at TEXT,
      local_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind = 'live_fill_applied'),
      source_event_id TEXT NOT NULL, last_source_event_id TEXT NOT NULL,
      source_event_name TEXT NOT NULL, source_event_source TEXT NOT NULL,
      source_event_timestamp TEXT NOT NULL,
      UNIQUE (provider_type, provider_instance_id, account_id, environment, market_id, exchange_trade_id)
    );
    CREATE INDEX fills_market_time_idx
      ON fills(environment, provider_type, provider_instance_id, account_id, market_id, exchange_executed_at);
    CREATE INDEX fills_strategy_time_idx ON fills(strategy_id, exchange_executed_at);
    CREATE TABLE fill_commissions (
      id INTEGER PRIMARY KEY, fill_id TEXT NOT NULL REFERENCES fills(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0), amount TEXT NOT NULL,
      asset_id TEXT NOT NULL, asset_code TEXT NOT NULL, quote_value_amount TEXT,
      quote_value_asset_id TEXT, quote_value_asset_code TEXT,
      UNIQUE (fill_id, ordinal)
    );
    CREATE INDEX fill_commissions_asset_idx ON fill_commissions(asset_id, fill_id);
  `

function createRelationalTables(transaction) {
  transaction.exec(CREATE_RELATIONAL_TABLES_SQL)
}
function hasTable(transaction, name) {
  return transaction.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name) !== undefined
}

function insertLegacyOrder(transaction, sourceRow) {
  let record
  try {
    record = JSON.parse(sourceRow.record)
  } catch (cause) {
    throw new OrderHistoryValidationError({ field: "legacyRecordJson", cause })
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
  })
  const statement = transaction.prepare(
    `INSERT INTO orders (${ORDER_COLUMNS.join(", ")})
     VALUES (${ORDER_COLUMNS.map(() => "?").join(", ")})`,
  )
  try {
    statement.run(...ORDER_COLUMNS.map((column) => row[column]))
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
  if (!hasTable(transaction, "db_records")) {
    return
  }
  const records = transaction.prepare(
    "SELECT id, record FROM db_records WHERE collection = ? ORDER BY id",
  ).all("harvester_orders")
  for (const record of records) {
    insertLegacyOrder(transaction, record)
  }
}

function migrateRelationalTradingHistory(transaction) {
  createRelationalTables(transaction)
  migrateLegacyOrders(transaction)
}

export const HARVESTER_RELATIONAL_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "harvester-relational-trading-history",
    up: migrateRelationalTradingHistory,
  }),
])
