import { createOrderHistoryRecord } from "../../domain/order-history/order-history-record.js"

export const ORDER_COLUMNS = Object.freeze([
  "id",
  "provider_type",
  "provider_instance_id",
  "account_id",
  "environment",
  "market_id",
  "market_venue",
  "symbol",
  "base_asset_id",
  "base_asset_code",
  "quote_asset_id",
  "quote_asset_code",
  "exchange_order_id",
  "client_order_id",
  "strategy_id",
  "position_id",
  "ownership_purpose",
  "cycle_id",
  "side",
  "order_type",
  "limit_price",
  "average_execution_price",
  "original_quantity",
  "executed_quantity",
  "cumulative_quote_quantity",
  "remaining_quantity",
  "status",
  "exchange_created_at",
  "exchange_acknowledged_at",
  "exchange_updated_at",
  "exchange_completed_at",
  "exchange_transaction_at",
  "local_first_observed_at",
  "local_last_observed_at",
  "first_source_event_id",
  "last_source_event_id",
  "last_source_event_name",
  "last_source_event_source",
  "last_source_event_timestamp",
  "source_kind",
  "last_observed_source_kind",
  "source_record_id",
  "migrated_at",
  "last_execution_type",
])

function requireString({ value, field } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Legacy order-history ${field} must be a non-empty string.`)
  }
  return value
}

function requireIsoTimestamp({ value, field } = {}) {
  const timestamp = requireString({
    value,
    field,
  })
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new TypeError(`Legacy order-history ${field} must be canonical UTC ISO-8601.`)
  }
  return timestamp
}

function toIsoTimestamp({ value, field } = {}) {
  if (value === undefined || value === null) {
    return null
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Order-history ${field} must be a non-negative epoch-millisecond integer.`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Order-history ${field} is outside the supported timestamp range.`)
  }
  return date.toISOString()
}

function toEpochMilliseconds({ value, field } = {}) {
  if (value === null || value === undefined) {
    return undefined
  }
  const timestamp = Date.parse(value)
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new TypeError(`Relational order ${field} must be a canonical UTC timestamp.`)
  }
  return timestamp
}

function mapLegacySourceEvent({ record } = {}) {
  return {
    id: record.lastSourceEventId,
    name: record.lastSourceEventName,
    source: record.lastSourceEventSource,
    timestamp: record.lastSourceEventTimestamp,
  }
}

function mapLegacyOrderFacts({ record } = {}) {
  return {
    providerInstanceId: record.providerInstanceId,
    providerType: record.providerType,
    accountId: record.accountId,
    clientOrderId: record.clientOrderId,
    market: record.market,
    symbol: record.symbol,
    side: record.side,
    type: record.type,
    originalQuantity: record.originalQuantity,
    executedQuantity: record.executedQuantity,
    remainingQuantity: record.remainingQuantity,
    status: record.status,
    brokerOrderId: record.brokerOrderId,
    price: record.price,
    ownership: record.ownership,
    createdAt: record.createdAt,
    acknowledgedAt: record.acknowledgedAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    cumulativeQuoteQuantity: record.cumulativeQuoteQuantity,
    brokerTransactionTime: record.brokerTransactionTime,
    executionType: record.lastExecutionType,
  }
}

function normalizeOrderHistoryRecord({ record } = {}) {
  if (record?.schemaVersion !== 1 || record.recordKind !== "harvester.order-history") {
    throw new TypeError("Legacy order-history record has an unsupported schema version or record kind.")
  }
  requireIsoTimestamp({
    value: record.lastSourceEventTimestamp,
    field: "lastSourceEventTimestamp",
  })
  const normalized = createOrderHistoryRecord({
    order: mapLegacyOrderFacts({ record }),
    sourceEvent: mapLegacySourceEvent({ record }),
    environment: record.environment,
  })
  if (normalized === null || normalized.id !== record.id) {
    throw new TypeError("Legacy order-history record identity or executed quantity is incompatible.")
  }
  const firstSeenAt = requireIsoTimestamp({
    value: record.firstSeenAt,
    field: "firstSeenAt",
  })
  const lastSeenAt = requireIsoTimestamp({
    value: record.lastSeenAt,
    field: "lastSeenAt",
  })
  if (Date.parse(firstSeenAt) > Date.parse(lastSeenAt)) {
    throw new TypeError("Legacy order-history observation timestamps are inconsistent.")
  }
  return Object.freeze({
    ...normalized,
    firstSeenAt,
    lastSeenAt,
    firstSourceEventId: requireString({
      value: record.firstSourceEventId,
      field: "firstSourceEventId",
    }),
  })
}

function mapOrderMarketColumns({ order } = {}) {
  return {
    market_id: order.market.id,
    market_venue: order.market.venue,
    symbol: order.symbol,
    base_asset_id: order.market.baseAsset.id,
    base_asset_code: order.market.baseAsset.code,
    quote_asset_id: order.market.quoteAsset.id,
    quote_asset_code: order.market.quoteAsset.code,
  }
}

function mapOrderOwnershipColumns({ ownership } = {}) {
  return {
    strategy_id: ownership?.strategyId ?? null,
    position_id: ownership?.positionId ?? null,
    ownership_purpose: ownership?.purpose ?? null,
    cycle_id: ownership?.cycleId ?? null,
  }
}

function mapOrderQuantityColumns({ order, existing } = {}) {
  return {
    side: order.side,
    order_type: order.type,
    limit_price: order.price ?? existing?.limit_price ?? null,
    average_execution_price: existing?.average_execution_price ?? null,
    original_quantity: order.originalQuantity,
    executed_quantity: order.executedQuantity,
    cumulative_quote_quantity: order.cumulativeQuoteQuantity ?? existing?.cumulative_quote_quantity ?? null,
    remaining_quantity: order.remainingQuantity,
    status: order.status,
    last_execution_type: order.lastExecutionType ?? null,
  }
}

function mapOrderExchangeTimestampColumns({ order, existing } = {}) {
  return {
    exchange_created_at: toIsoTimestamp({
      value: order.createdAt,
      field: "createdAt",
    }) ?? existing?.exchange_created_at ?? null,
    exchange_acknowledged_at: toIsoTimestamp({
      value: order.acknowledgedAt,
      field: "acknowledgedAt",
    }) ?? existing?.exchange_acknowledged_at ?? null,
    exchange_updated_at: toIsoTimestamp({
      value: order.updatedAt,
      field: "updatedAt",
    }) ?? existing?.exchange_updated_at ?? null,
    exchange_completed_at: toIsoTimestamp({
      value: order.completedAt,
      field: "completedAt",
    }) ?? existing?.exchange_completed_at ?? null,
    exchange_transaction_at: toIsoTimestamp({
      value: order.brokerTransactionTime,
      field: "brokerTransactionTime",
    }) ?? existing?.exchange_transaction_at ?? null,
  }
}

function mapOrderObservationColumns({ order, existing } = {}) {
  return {
    local_first_observed_at: existing?.local_first_observed_at ?? order.firstSeenAt,
    local_last_observed_at: order.lastSeenAt,
    first_source_event_id: existing?.first_source_event_id ?? order.firstSourceEventId,
    last_source_event_id: order.lastSourceEventId,
    last_source_event_name: order.lastSourceEventName,
    last_source_event_source: order.lastSourceEventSource,
    last_source_event_timestamp: order.lastSourceEventTimestamp,
  }
}

function mapOrderProvenanceColumns({
  existing,
  sourceKind,
  sourceRecordId,
  migratedAt,
} = {}) {
  return {
    source_kind: existing?.source_kind ?? sourceKind,
    last_observed_source_kind: sourceKind,
    source_record_id: existing?.source_record_id ?? sourceRecordId ?? null,
    migrated_at: existing?.migrated_at ?? migratedAt ?? null,
  }
}

export function mapOrderHistoryRecordToRow({
  record,
  existing,
  sourceKind = "live_order_event",
  sourceRecordId,
  migratedAt,
} = {}) {
  const order = normalizeOrderHistoryRecord({ record })
  return {
    id: order.id,
    provider_type: order.providerType,
    provider_instance_id: order.providerInstanceId,
    account_id: order.accountId,
    environment: order.environment,
    client_order_id: order.clientOrderId,
    exchange_order_id: order.brokerOrderId ?? existing?.exchange_order_id ?? null,
    ...mapOrderMarketColumns({ order }),
    ...mapOrderOwnershipColumns({
      ownership: order.ownership,
    }),
    ...mapOrderQuantityColumns({
      order,
      existing,
    }),
    ...mapOrderExchangeTimestampColumns({
      order,
      existing,
    }),
    ...mapOrderObservationColumns({
      order,
      existing,
    }),
    ...mapOrderProvenanceColumns({
      existing,
      sourceKind,
      sourceRecordId,
      migratedAt,
    }),
  }
}

function mapOrderOwnership(row) {
  if (row.strategy_id === null) {
    return undefined
  }
  return {
    strategyId: row.strategy_id,
    positionId: row.position_id,
    purpose: row.ownership_purpose,
    ...(row.cycle_id === null ? {} : { cycleId: row.cycle_id }),
  }
}

function mapOrderMarket(row) {
  return Object.freeze({
    id: row.market_id,
    venue: row.market_venue,
    symbol: row.symbol,
    baseAsset: Object.freeze({
      id: row.base_asset_id,
      code: row.base_asset_code,
    }),
    quoteAsset: Object.freeze({
      id: row.quote_asset_id,
      code: row.quote_asset_code,
    }),
  })
}

function mapOrderTimestamps(row) {
  const fields = [
    ["createdAt", "exchange_created_at"],
    ["acknowledgedAt", "exchange_acknowledged_at"],
    ["updatedAt", "exchange_updated_at"],
    ["completedAt", "exchange_completed_at"],
    ["brokerTransactionTime", "exchange_transaction_at"],
  ]
  return Object.fromEntries(fields.flatMap(([name, column]) => {
    const value = toEpochMilliseconds({
      value: row[column],
      field: column,
    })
    return value === undefined ? [] : [[name, value]]
  }))
}

export function mapOrderRowToRecord(row) {
  const ownership = mapOrderOwnership(row)
  return Object.freeze({
    id: row.id,
    schemaVersion: 1,
    recordKind: "harvester.order-history",
    environment: row.environment,
    providerInstanceId: row.provider_instance_id,
    providerType: row.provider_type,
    accountId: row.account_id,
    clientOrderId: row.client_order_id,
    market: mapOrderMarket(row),
    symbol: row.symbol,
    side: row.side,
    type: row.order_type,
    originalQuantity: row.original_quantity,
    executedQuantity: row.executed_quantity,
    remainingQuantity: row.remaining_quantity,
    status: row.status,
    firstSeenAt: row.local_first_observed_at,
    lastSeenAt: row.local_last_observed_at,
    firstSourceEventId: row.first_source_event_id,
    lastSourceEventId: row.last_source_event_id,
    lastSourceEventName: row.last_source_event_name,
    lastSourceEventSource: row.last_source_event_source,
    lastSourceEventTimestamp: row.last_source_event_timestamp,
    ...(row.exchange_order_id === null ? {} : { brokerOrderId: row.exchange_order_id }),
    ...(row.limit_price === null ? {} : { price: row.limit_price }),
    ...(ownership === undefined ? {} : { ownership }),
    ...mapOrderTimestamps(row),
    ...(row.cumulative_quote_quantity === null
      ? {}
      : { cumulativeQuoteQuantity: row.cumulative_quote_quantity }),
    ...(row.last_execution_type === null ? {} : { lastExecutionType: row.last_execution_type }),
  })
}
