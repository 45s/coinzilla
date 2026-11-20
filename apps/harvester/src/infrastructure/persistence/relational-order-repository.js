import { OrderHistoryIntegrityError } from "../../domain/order-history/order-history-errors.js"
import { mergeOrderHistoryRecords } from "../../domain/order-history/order-history-transition.js"
import { OrderHistoryPersistenceError } from "./order-history-persistence-error.js"
import {
  mapOrderHistoryRecordToRow,
  mapOrderRowToRecord,
  ORDER_COLUMNS,
} from "./order-row-mapping.js"

const UPDATE_COLUMNS = Object.freeze(ORDER_COLUMNS.filter((column) => column !== "id"))
const INSERT_SQL = `INSERT INTO orders (${ORDER_COLUMNS.join(", ")})
  VALUES (${ORDER_COLUMNS.map(() => "?").join(", ")} )`
const UPDATE_SQL = `UPDATE orders SET ${UPDATE_COLUMNS.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`

function readOrder({ transaction, id } = {}) {
  return transaction.prepare("SELECT * FROM orders WHERE id = ?").get(id)
}

function writeOrder({ transaction, row, existing } = {}) {
  if (existing === undefined) {
    transaction.prepare(INSERT_SQL).run(...ORDER_COLUMNS.map((column) => row[column]))
    return
  }
  transaction.prepare(UPDATE_SQL).run(
    ...UPDATE_COLUMNS.map((column) => row[column]),
    row.id,
  )
}

function assertFillOrderIdentity({ transaction, row } = {}) {
  if (row.exchange_order_id === null) {
    return
  }
  const conflict = transaction.prepare(`
    SELECT id FROM fills
    WHERE environment = ? AND provider_instance_id = ? AND provider_type = ?
      AND account_id = ? AND client_order_id = ?
      AND (
        market_id <> ? OR
        (exchange_order_id IS NOT NULL AND exchange_order_id <> ?)
      )
    LIMIT 1
  `).get(
    row.environment,
    row.provider_instance_id,
    row.provider_type,
    row.account_id,
    row.client_order_id,
    row.market_id,
    row.exchange_order_id,
  )
  if (conflict) {
    throw new OrderHistoryIntegrityError({
      field: "fill.exchangeOrderId",
      providerInstanceId: row.provider_instance_id,
      accountId: row.account_id,
      clientOrderId: row.client_order_id,
    })
  }
}

function linkOrderFills({ transaction, row } = {}) {
  if (row.exchange_order_id === null) {
    return
  }
  assertFillOrderIdentity({
    transaction,
    row,
  })
  transaction.prepare(`
    UPDATE fills
    SET order_id = ?, strategy_id = COALESCE(strategy_id, ?),
      position_id = COALESCE(position_id, ?), cycle_id = COALESCE(cycle_id, ?)
    WHERE environment = ? AND provider_instance_id = ? AND provider_type = ?
      AND account_id = ? AND market_id = ? AND client_order_id = ?
      AND (exchange_order_id = ? OR exchange_order_id IS NULL)
      AND (order_id IS NULL OR order_id = ?)
  `).run(
    row.id,
    row.strategy_id,
    row.position_id,
    row.cycle_id,
    row.environment,
    row.provider_instance_id,
    row.provider_type,
    row.account_id,
    row.market_id,
    row.client_order_id,
    row.exchange_order_id,
    row.id,
  )
}

function upsertOrder({ transaction, record, ingestionSource = "live_event" } = {}) {
  const existingRow = readOrder({
    transaction,
    id: record.id,
  })
  const current = existingRow === undefined
    ? null
    : mapOrderRowToRecord(existingRow)
  const merged = current === null
    ? record
    : mergeOrderHistoryRecords({
        current,
        candidate: record,
      })
  const row = mapOrderHistoryRecordToRow({
    record: merged,
    existing: existingRow,
    sourceKind: "live_order_event",
    ingestionSource,
  })
  writeOrder({
    transaction,
    row,
    existing: existingRow,
  })
  linkOrderFills({
    transaction,
    row,
  })
  return merged
}

function findByExchangeOrderIdentity({
  database,
  providerIdentity,
  environment,
  marketId,
  brokerOrderId,
} = {}) {
  const identity = {
    providerType: providerIdentity?.providerType,
    providerInstanceId: providerIdentity?.providerInstanceId,
    accountId: providerIdentity?.accountId,
    environment,
    marketId,
    brokerOrderId,
  }
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Exchange-order lookup ${field} must be a non-empty string`)
    }
  }
  const matches = database.prepare(`
    SELECT client_order_id FROM orders
    WHERE provider_type = ? AND provider_instance_id = ? AND account_id = ?
      AND environment = ? AND market_id = ? AND exchange_order_id = ?
    LIMIT 2
  `).all(
    identity.providerType,
    identity.providerInstanceId,
    identity.accountId,
    identity.environment,
    identity.marketId,
    identity.brokerOrderId,
  )
  if (matches.length > 1) {
    throw new OrderHistoryIntegrityError({
      field: "exchangeOrderIdAmbiguous",
      providerInstanceId: identity.providerInstanceId,
      accountId: identity.accountId,
    })
  }
  return matches[0]?.client_order_id ?? null
}

function getOldestPendingOrderId({ database, providerIdentity, environment, symbol } = {}) {
  const identity = {
    providerType: providerIdentity?.providerType,
    providerInstanceId: providerIdentity?.providerInstanceId,
    accountId: providerIdentity?.accountId,
    environment,
    symbol,
  }
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Pending-order lookup ${field} must be a non-empty string`)
    }
  }
  const row = database.prepare(`
    SELECT exchange_order_id FROM orders
    WHERE provider_type = ? AND provider_instance_id = ? AND account_id = ?
      AND environment = ? AND symbol = ? AND exchange_order_id IS NOT NULL
      AND status IN ('NEW', 'OPEN', 'PENDING', 'PARTIALLY_FILLED', 'UNKNOWN')
    ORDER BY CAST(exchange_order_id AS INTEGER) ASC
    LIMIT 1
  `).get(
    identity.providerType,
    identity.providerInstanceId,
    identity.accountId,
    identity.environment,
    identity.symbol,
  )
  return row?.exchange_order_id ?? null
}

function listPendingOrderIds({ database, providerIdentity, environment, symbol } = {}) {
  const identity = {
    providerType: providerIdentity?.providerType,
    providerInstanceId: providerIdentity?.providerInstanceId,
    accountId: providerIdentity?.accountId,
    environment,
    symbol,
  }
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Pending-order lookup ${field} must be a non-empty string`)
    }
  }
  return database.prepare(`
    SELECT exchange_order_id FROM orders
    WHERE provider_type = ? AND provider_instance_id = ? AND account_id = ?
      AND environment = ? AND symbol = ? AND exchange_order_id IS NOT NULL
      AND status IN ('NEW', 'OPEN', 'PENDING', 'PARTIALLY_FILLED', 'UNKNOWN')
    ORDER BY CAST(exchange_order_id AS INTEGER) ASC
  `).all(
    identity.providerType,
    identity.providerInstanceId,
    identity.accountId,
    identity.environment,
    identity.symbol,
  ).map(({ exchange_order_id: exchangeOrderId }) => exchangeOrderId)
}

function normalizeOrderWriteError({ error, record } = {}) {
  if (error instanceof OrderHistoryIntegrityError ||
    error?.code === "HARVESTER_ORDER_HISTORY_RECORD_INVALID") {
    return error
  }
  return new OrderHistoryPersistenceError({
    stage: "relational-upsert",
    cause: error,
    context: {
      providerInstanceId: record.providerInstanceId,
      accountId: record.accountId,
      clientOrderId: record.clientOrderId,
    },
  })
}

/**
 * Create the Harvester-owned relational order repository.
 *
 * @param {{database: object}} input
 * @returns {{upsert: (record: object) => Promise<object>}}
 */
async function persistOrder({ database, record, ingestionSource }) {
  try {
    return await database.transaction((transaction) => upsertOrder({
      transaction,
      record,
      ingestionSource,
    }))
  } catch (error) {
    throw normalizeOrderWriteError({
      error,
      record,
    })
  }
}

export function createRelationalOrderHistoryRepository({ database } = {}) {
  if (!database || typeof database.transaction !== "function") {
    throw new TypeError("Relational order history requires a connected SQLite database.")
  }
  return Object.freeze({
    upsert: (record) => persistOrder({
      database,
      record,
      ingestionSource: "live_event",
    }),
    upsertHistorical: (record) => persistOrder({
      database,
      record,
      ingestionSource: "exchange_history",
    }),
    findByExchangeOrderIdentity: (input) => findByExchangeOrderIdentity({
      database,
      ...input,
    }),
    getOldestPendingOrderId: (input) => getOldestPendingOrderId({
      database,
      ...input,
    }),
    listPendingOrderIds: (input) => listPendingOrderIds({
      database,
      ...input,
    }),
  })
}
