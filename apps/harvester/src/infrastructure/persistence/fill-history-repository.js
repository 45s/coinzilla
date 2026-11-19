import { assertDecimalString, compareDecimal } from "@coinzilla/utils"
import {
  OrderHistoryIntegrityError,
  OrderHistoryValidationError,
} from "../../domain/order-history/order-history-errors.js"
import { createOrderHistoryId } from "../../domain/order-history/order-history-record.js"
import { OrderHistoryPersistenceError } from "./order-history-persistence-error.js"

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    throw new OrderHistoryValidationError({ field })
  }
  return value
}

function requireDecimal(value, field, positive = false) {
  let amount
  try {
    amount = assertDecimalString({ value, field })
  } catch (cause) {
    throw new OrderHistoryValidationError({ field, cause })
  }
  const comparison = compareDecimal({ left: amount, right: "0" })
  if (comparison < 0 || (positive && comparison === 0)) {
    throw new OrderHistoryValidationError({ field })
  }
  return amount
}

function requireIsoTimestamp(value, field) {
  const timestamp = requireString(value, field)
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== timestamp) {
    throw new OrderHistoryValidationError({ field })
  }
  return timestamp
}

function mapExecutionTimestamp(value) {
  if (value === undefined || value === null) {
    return null
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OrderHistoryValidationError({ field: "executedAt" })
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new OrderHistoryValidationError({ field: "executedAt" })
  }
  return date.toISOString()
}

function mapCommission(commission, ordinal) {
  const quoteValue = commission.quoteValue
  return {
    ordinal,
    amount: requireDecimal(commission.amount, `commissions[${ordinal}].amount`),
    asset_id: requireString(commission.assetId, `commissions[${ordinal}].assetId`),
    asset_code: requireString(commission.asset, `commissions[${ordinal}].asset`),
    quote_value_amount: quoteValue === undefined
      ? null
      : requireDecimal(quoteValue.amount, `commissions[${ordinal}].quoteValue.amount`),
    quote_value_asset_id: quoteValue === undefined
      ? null
      : requireString(quoteValue.assetId, `commissions[${ordinal}].quoteValue.assetId`),
    quote_value_asset_code: quoteValue === undefined
      ? null
      : requireString(quoteValue.asset, `commissions[${ordinal}].quoteValue.asset`),
  }
}

function mapCommissions(commissions) {
  if (!Array.isArray(commissions)) {
    throw new OrderHistoryValidationError({ field: "commissions" })
  }
  return commissions.map((commission, ordinal) => mapCommission(commission, ordinal))
}

function createFillIdentity({ fill, environment } = {}) {
  return JSON.stringify([
    environment,
    fill.providerInstanceId,
    fill.providerType,
    fill.accountId,
    fill.marketId,
    fill.tradeId,
  ])
}

function mapFillEvent({ fill, sourceEvent, environment } = {}) {
  requireString(environment, "environment")
  if (!["testnet", "live"].includes(environment)) {
    throw new OrderHistoryValidationError({ field: "environment" })
  }
  const marketId = requireString(fill.marketId, "marketId")
  const tradeId = requireString(fill.tradeId, "tradeId")
  const fillId = requireString(fill.fillId, "fillId")
  if (fillId !== `${marketId}:${tradeId}`) {
    throw new OrderHistoryIntegrityError({ field: "canonicalFillId" })
  }
  if (fill.side !== "BUY" && fill.side !== "SELL") {
    throw new OrderHistoryValidationError({ field: "side" })
  }
  const commissions = mapCommissions(fill.commissions)
  return {
    id: createFillIdentity({ fill: { ...fill, marketId, tradeId }, environment }),
    canonical_fill_id: fillId,
    provider_type: requireString(fill.providerType, "providerType"),
    provider_instance_id: requireString(fill.providerInstanceId, "providerInstanceId"),
    account_id: requireString(fill.accountId, "accountId"),
    environment,
    market_id: marketId,
    market_venue: requireString(fill.marketVenue, "marketVenue"),
    symbol: requireString(fill.symbol, "symbol"),
    base_asset_id: requireString(fill.baseAssetId, "baseAssetId"),
    base_asset_code: requireString(fill.baseAssetCode, "baseAssetCode"),
    quote_asset_id: requireString(fill.quoteAssetId, "quoteAssetId"),
    quote_asset_code: requireString(fill.quoteAssetCode, "quoteAssetCode"),
    exchange_trade_id: tradeId,
    exchange_order_id: requireString(fill.brokerOrderId, "brokerOrderId"),
    client_order_id: fill.clientOrderId === undefined
      ? null
      : requireString(fill.clientOrderId, "clientOrderId"),
    side: fill.side,
    execution_price: requireDecimal(fill.price, "price", true),
    executed_base_quantity: requireDecimal(fill.quantity, "quantity", true),
    executed_quote_quantity: requireDecimal(fill.quoteQuantity, "quoteQuantity", true),
    liquidity_role: requireString(fill.liquidityRole, "liquidityRole"),
    commission_status: requireString(fill.commissionStatus, "commissionStatus"),
    exchange_executed_at: mapExecutionTimestamp(fill.executedAt),
    local_observed_at: requireIsoTimestamp(sourceEvent.timestamp, "sourceEvent.timestamp"),
    source_event_id: requireString(sourceEvent.id, "sourceEvent.id"),
    last_source_event_id: requireString(sourceEvent.id, "sourceEvent.id"),
    source_event_name: requireString(sourceEvent.name, "sourceEvent.name"),
    source_event_source: requireString(sourceEvent.source, "sourceEvent.source"),
    source_event_timestamp: requireIsoTimestamp(sourceEvent.timestamp, "sourceEvent.timestamp"),
    commissions,
  }
}

function findOrderReference(transaction, fill) {
  const scope = [
    fill.environment,
    fill.provider_instance_id,
    fill.provider_type,
    fill.account_id,
  ]
  if (fill.client_order_id !== null) {
    const id = createOrderHistoryId({
      environment: fill.environment,
      providerInstanceId: fill.provider_instance_id,
      providerType: fill.provider_type,
      accountId: fill.account_id,
      clientOrderId: fill.client_order_id,
    })
    return transaction.prepare(
      "SELECT id, exchange_order_id, strategy_id, position_id, cycle_id FROM orders WHERE id = ?",
    ).get(id)
  }
  return transaction.prepare(`
    SELECT id, exchange_order_id, strategy_id, position_id, cycle_id FROM orders
    WHERE environment = ? AND provider_instance_id = ? AND provider_type = ?
      AND account_id = ? AND exchange_order_id = ?
  `).get(...scope, fill.exchange_order_id)
}

function assertOrderReferenceMatches(order, fill) {
  if (order && order.exchange_order_id !== null &&
    order.exchange_order_id !== fill.exchange_order_id) {
    throw new OrderHistoryIntegrityError({
      field: "fill.orderIdentity",
      providerInstanceId: fill.provider_instance_id,
      accountId: fill.account_id,
      clientOrderId: fill.client_order_id ?? undefined,
    })
  }
}

function mapFillRow({ fill, order } = {}) {
  const {
    commissions,
    ...row
  } = fill
  return {
    ...row,
    order_id: order?.id ?? null,
    strategy_id: order?.strategy_id ?? null,
    position_id: order?.position_id ?? null,
    cycle_id: order?.cycle_id ?? null,
    source_kind: "live_fill_applied",
    last_observed_at: fill.local_observed_at,
  }
}

function readExistingFill(transaction, fill) {
  return transaction.prepare(`
    SELECT * FROM fills
    WHERE provider_type = ? AND provider_instance_id = ? AND account_id = ?
      AND environment = ? AND market_id = ? AND exchange_trade_id = ?
  `).get(
    fill.provider_type,
    fill.provider_instance_id,
    fill.account_id,
    fill.environment,
    fill.market_id,
    fill.exchange_trade_id,
  )
}

function readExistingCommissions(transaction, fillId) {
  return transaction.prepare(`
    SELECT ordinal, amount, asset_id, asset_code, quote_value_amount,
      quote_value_asset_id, quote_value_asset_code
    FROM fill_commissions WHERE fill_id = ? ORDER BY ordinal
  `).all(fillId)
}

function commissionFactsMatch(existing, candidate) {
  return JSON.stringify(existing) === JSON.stringify(candidate)
}

function assertDuplicateMatches({ transaction, existing, candidate } = {}) {
  const columns = [
    "canonical_fill_id", "provider_type", "provider_instance_id", "account_id",
    "environment", "market_id", "market_venue", "symbol", "base_asset_id",
    "base_asset_code", "quote_asset_id", "quote_asset_code", "exchange_trade_id",
    "exchange_order_id", "client_order_id", "side", "execution_price", "executed_base_quantity",
    "executed_quote_quantity", "liquidity_role", "commission_status", "exchange_executed_at",
  ]
  const factsMatch = columns.every((column) => existing[column] === candidate[column])
  const commissionsMatch = commissionFactsMatch(
    readExistingCommissions(transaction, existing.id),
    candidate.commissions,
  )
  if (!factsMatch || !commissionsMatch) {
    throw new OrderHistoryIntegrityError({
      field: "fillExecutionIdentity",
      providerInstanceId: candidate.provider_instance_id,
      accountId: candidate.account_id,
      clientOrderId: candidate.client_order_id ?? undefined,
    })
  }
}

function insertCommissions(transaction, fillId, commissions) {
  const statement = transaction.prepare(`
    INSERT INTO fill_commissions (
      fill_id, ordinal, amount, asset_id, asset_code,
      quote_value_amount, quote_value_asset_id, quote_value_asset_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const commission of commissions) {
    statement.run(
      fillId,
      commission.ordinal,
      commission.amount,
      commission.asset_id,
      commission.asset_code,
      commission.quote_value_amount,
      commission.quote_value_asset_id,
      commission.quote_value_asset_code,
    )
  }
}

function insertFill(transaction, row, commissions) {
  const columns = Object.keys(row)
  transaction.prepare(
    `INSERT INTO fills (${columns.join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...columns.map((column) => row[column]))
  insertCommissions(transaction, row.id, commissions)
}

function upsertFill(transaction, fill) {
  const existing = readExistingFill(transaction, fill)
  if (existing !== undefined) {
    assertDuplicateMatches({ transaction, existing, candidate: fill })
    transaction.prepare(
      "UPDATE fills SET last_observed_at = ?, last_source_event_id = ? WHERE id = ?",
    ).run(fill.local_observed_at, fill.last_source_event_id, existing.id)
    return existing.id
  }
  const order = findOrderReference(transaction, fill)
  assertOrderReferenceMatches(order, fill)
  const row = mapFillRow({ fill, order })
  insertFill(transaction, row, fill.commissions)
  return row.id
}

function normalizeFillWriteError(error, fill) {
  if (error instanceof OrderHistoryIntegrityError ||
    error?.code === "HARVESTER_ORDER_HISTORY_RECORD_INVALID") {
    return error
  }
  return new OrderHistoryPersistenceError({
    stage: "relational-fill-upsert",
    cause: error,
    context: {
      providerInstanceId: fill.providerInstanceId,
      accountId: fill.accountId,
      clientOrderId: fill.clientOrderId,
    },
  })
}

/**
 * Create the Harvester-owned relational execution repository.
 *
 * @param {{database: object}} input
 * @returns {{upsert: (input: object) => Promise<string>}}
 */
export function createFillHistoryRepository({ database } = {}) {
  if (!database || typeof database.transaction !== "function") {
    throw new TypeError("Relational fill history requires a connected SQLite database.")
  }
  return Object.freeze({
    upsert: async ({ fill, sourceEvent, environment } = {}) => {
      const candidate = mapFillEvent({ fill, sourceEvent, environment })
      try {
        return await database.transaction((transaction) => upsertFill(transaction, candidate))
      } catch (error) {
        throw normalizeFillWriteError(error, fill)
      }
    },
  })
}
