const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 100

const ORDER_FILTER_COLUMNS = Object.freeze({
  symbol: "symbol",
  side: "side",
  status: "status",
  providerType: "provider_type",
  providerInstanceId: "provider_instance_id",
  accountId: "account_id",
  strategyId: "strategy_id",
})

const FILL_FILTER_COLUMNS = Object.freeze({
  symbol: "symbol",
  side: "side",
  providerType: "provider_type",
  providerInstanceId: "provider_instance_id",
  accountId: "account_id",
  strategyId: "strategy_id",
  commissionStatus: "commission_status",
})

const COMMISSION_FILTER_COLUMNS = Object.freeze({
  symbol: "f.symbol",
  side: "f.side",
  assetCode: "c.asset_code",
  providerType: "f.provider_type",
  providerInstanceId: "f.provider_instance_id",
  accountId: "f.account_id",
  strategyId: "f.strategy_id",
})

function mapOrderRow(row) {
  return Object.freeze({
    id: row.id,
    environment: row.environment,
    providerType: row.provider_type,
    providerInstanceId: row.provider_instance_id,
    accountId: row.account_id,
    marketId: row.market_id,
    marketVenue: row.market_venue,
    symbol: row.symbol,
    baseAssetId: row.base_asset_id,
    baseAssetCode: row.base_asset_code,
    quoteAssetId: row.quote_asset_id,
    quoteAssetCode: row.quote_asset_code,
    exchangeOrderId: row.exchange_order_id,
    clientOrderId: row.client_order_id,
    strategyId: row.strategy_id,
    positionId: row.position_id,
    ownershipPurpose: row.ownership_purpose,
    cycleId: row.cycle_id,
    side: row.side,
    orderType: row.order_type,
    limitPrice: row.limit_price,
    averageExecutionPrice: row.average_execution_price,
    originalQuantity: row.original_quantity,
    executedQuantity: row.executed_quantity,
    cumulativeQuoteQuantity: row.cumulative_quote_quantity,
    remainingQuantity: row.remaining_quantity,
    status: row.status,
    exchangeCreatedAt: row.exchange_created_at,
    exchangeAcknowledgedAt: row.exchange_acknowledged_at,
    exchangeUpdatedAt: row.exchange_updated_at,
    exchangeCompletedAt: row.exchange_completed_at,
    exchangeTransactionAt: row.exchange_transaction_at,
    localFirstObservedAt: row.local_first_observed_at,
    localLastObservedAt: row.local_last_observed_at,
    firstSourceEventId: row.first_source_event_id,
    lastSourceEventId: row.last_source_event_id,
    lastSourceEventName: row.last_source_event_name,
    lastSourceEventSource: row.last_source_event_source,
    lastSourceEventTimestamp: row.last_source_event_timestamp,
    sourceKind: row.source_kind,
    lastObservedSourceKind: row.last_observed_source_kind,
    sourceRecordId: row.source_record_id,
    migratedAt: row.migrated_at,
    lastExecutionType: row.last_execution_type,
    ingestionSource: row.ingestion_source,
    lastIngestionSource: row.last_ingestion_source,
  })
}

function mapFillRow(row) {
  return Object.freeze({
    id: row.id,
    canonicalFillId: row.canonical_fill_id,
    providerType: row.provider_type,
    providerInstanceId: row.provider_instance_id,
    accountId: row.account_id,
    environment: row.environment,
    marketId: row.market_id,
    symbol: row.symbol,
    exchangeTradeId: row.exchange_trade_id,
    exchangeOrderId: row.exchange_order_id,
    clientOrderId: row.client_order_id,
    orderId: row.order_id,
    strategyId: row.strategy_id,
    positionId: row.position_id,
    cycleId: row.cycle_id,
    side: row.side,
    executionPrice: row.execution_price,
    executedBaseQuantity: row.executed_base_quantity,
    executedQuoteQuantity: row.executed_quote_quantity,
    liquidityRole: row.liquidity_role,
    commissionStatus: row.commission_status,
    exchangeExecutedAt: row.exchange_executed_at,
    localObservedAt: row.local_observed_at,
    lastObservedAt: row.last_observed_at,
    sourceKind: row.source_kind,
    sourceEventId: row.source_event_id,
    lastSourceEventId: row.last_source_event_id,
    sourceEventName: row.source_event_name,
    sourceEventSource: row.source_event_source,
    sourceEventTimestamp: row.source_event_timestamp,
    ingestionSource: row.ingestion_source,
    lastIngestionSource: row.last_ingestion_source,
  })
}

function mapCommissionRow(row) {
  return Object.freeze({
    id: row.id,
    fillId: row.fill_id,
    ordinal: row.ordinal,
    amount: row.amount,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    quoteValueAmount: row.quote_value_amount,
    quoteValueAssetId: row.quote_value_asset_id,
    quoteValueAssetCode: row.quote_value_asset_code,
    environment: row.environment,
    providerType: row.provider_type,
    providerInstanceId: row.provider_instance_id,
    accountId: row.account_id,
    symbol: row.symbol,
    side: row.side,
    exchangeTradeId: row.exchange_trade_id,
    exchangeOrderId: row.exchange_order_id,
    strategyId: row.strategy_id,
    exchangeExecutedAt: row.exchange_executed_at,
    localObservedAt: row.local_observed_at,
  })
}

function normalizeFilters({ filters = {}, columns } = {}) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new TypeError("Trading-history filters must be an object")
  }
  const clauses = []
  const parameters = []
  for (const [key, value] of Object.entries(filters)) {
    const column = columns[key]
    if (!column) {
      throw new TypeError(`Trading-history filter ${key} is not supported`)
    }
    if (value === undefined || value === null || value === "") {
      continue
    }
    if (typeof value !== "string" || value.trim() !== value) {
      throw new TypeError(`Trading-history filter ${key} must be a trimmed string`)
    }
    clauses.push(`${column} = ?`)
    parameters.push(value)
  }
  return {
    where: clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`,
    parameters,
  }
}

function normalizePagination({ pagination = {} } = {}) {
  const limit = pagination.limit ?? DEFAULT_PAGE_LIMIT
  const offset = pagination.offset ?? 0
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new TypeError(`Trading-history page limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`)
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError("Trading-history page offset must be a non-negative safe integer")
  }
  return Object.freeze({
    limit,
    offset,
  })
}

function listRecords({
  database,
  table,
  mapper,
  filters,
  columns,
  orderBy,
  pagination,
} = {}) {
  const normalizedFilters = normalizeFilters({
    filters,
    columns,
  })
  const normalizedPagination = normalizePagination({ pagination })
  const { total } = database.prepare(
    `SELECT COUNT(*) AS total FROM ${table} ${normalizedFilters.where}`,
  ).get(...normalizedFilters.parameters)
  const rows = database.prepare(
    `SELECT * FROM ${table} ${normalizedFilters.where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
  ).all(
    ...normalizedFilters.parameters,
    normalizedPagination.limit,
    normalizedPagination.offset,
  )
  return Object.freeze({
    items: Object.freeze(rows.map(mapper)),
    pagination: Object.freeze({
      ...normalizedPagination,
      total,
      hasMore: normalizedPagination.offset + rows.length < total,
    }),
  })
}

function listOrders({ database, filters, pagination } = {}) {
  return listRecords({
    database,
    table: "orders",
    mapper: mapOrderRow,
    filters,
    columns: ORDER_FILTER_COLUMNS,
    orderBy: "COALESCE(exchange_created_at, local_first_observed_at) DESC, id ASC",
    pagination,
  })
}

function findOrderById({ database, id } = {}) {
  const row = database.prepare("SELECT * FROM orders WHERE id = ?").get(id)
  return row === undefined ? null : mapOrderRow(row)
}

function listFills({ database, filters, pagination } = {}) {
  return listRecords({
    database,
    table: "fills",
    mapper: mapFillRow,
    filters,
    columns: FILL_FILTER_COLUMNS,
    orderBy: "COALESCE(exchange_executed_at, local_observed_at) DESC, id ASC",
    pagination,
  })
}

function listFillCommissions({ database, fillId } = {}) {
  const rows = database.prepare(
    `SELECT id, fill_id, ordinal, amount, asset_id, asset_code, quote_value_amount,
      quote_value_asset_id, quote_value_asset_code
    FROM fill_commissions
    WHERE fill_id = ?
    ORDER BY ordinal ASC`,
  ).all(fillId)
  return rows.map((row) => Object.freeze({
    id: row.id,
    fillId: row.fill_id,
    ordinal: row.ordinal,
    amount: row.amount,
    assetId: row.asset_id,
    assetCode: row.asset_code,
    quoteValueAmount: row.quote_value_amount,
    quoteValueAssetId: row.quote_value_asset_id,
    quoteValueAssetCode: row.quote_value_asset_code,
  }))
}

function findFillById({ database, id } = {}) {
  const row = database.prepare("SELECT * FROM fills WHERE id = ?").get(id)
  if (row === undefined) {
    return null
  }
  return Object.freeze({
    ...mapFillRow(row),
    commissions: Object.freeze(listFillCommissions({
      database,
      fillId: row.id,
    })),
  })
}

function listCommissions({ database, filters, pagination } = {}) {
  const normalizedFilters = normalizeFilters({
    filters,
    columns: COMMISSION_FILTER_COLUMNS,
  })
  const normalizedPagination = normalizePagination({ pagination })
  const from = "FROM fill_commissions c INNER JOIN fills f ON f.id = c.fill_id"
  const { total } = database.prepare(
    `SELECT COUNT(*) AS total ${from} ${normalizedFilters.where}`,
  ).get(...normalizedFilters.parameters)
  const rows = database.prepare(
    `SELECT c.id, c.fill_id, c.ordinal, c.amount, c.asset_id, c.asset_code,
      c.quote_value_amount, c.quote_value_asset_id, c.quote_value_asset_code,
      f.environment, f.provider_type, f.provider_instance_id, f.account_id,
      f.symbol, f.side, f.exchange_trade_id, f.exchange_order_id, f.strategy_id,
      f.exchange_executed_at, f.local_observed_at
    ${from} ${normalizedFilters.where}
    ORDER BY COALESCE(f.exchange_executed_at, f.local_observed_at) DESC,
      c.fill_id ASC, c.ordinal ASC
    LIMIT ? OFFSET ?`,
  ).all(
    ...normalizedFilters.parameters,
    normalizedPagination.limit,
    normalizedPagination.offset,
  )
  return Object.freeze({
    items: Object.freeze(rows.map(mapCommissionRow)),
    pagination: Object.freeze({
      ...normalizedPagination,
      total,
      hasMore: normalizedPagination.offset + rows.length < total,
    }),
  })
}

function getSummary({ database } = {}) {
  const orders = database.prepare("SELECT COUNT(*) AS total FROM orders").get().total
  const fills = database.prepare("SELECT COUNT(*) AS total FROM fills").get().total
  const commissions = database.prepare("SELECT COUNT(*) AS total FROM fill_commissions").get().total
  return Object.freeze({
    orders,
    fills,
    commissions,
  })
}

/**
 * Create the Harvester persistence adapter for querying canonical trading-history records.
 *
 * @param {{database: object}} input
 * @returns {Readonly<object>} Query methods returning persisted records and page metadata.
 */
export function createTradingHistoryQueryRepository({ database } = {}) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("Trading-history query repository requires a connected SQLite database")
  }
  return Object.freeze({
    getSummary: () => getSummary({ database }),
    listOrders: (input) => listOrders({
      database,
      ...input,
    }),
    findOrderById: ({ id } = {}) => findOrderById({
      database,
      id,
    }),
    listFills: (input) => listFills({
      database,
      ...input,
    }),
    findFillById: ({ id } = {}) => findFillById({
      database,
      id,
    }),
    listCommissions: (input) => listCommissions({
      database,
      ...input,
    }),
  })
}
