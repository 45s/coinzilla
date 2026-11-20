import { assertDecimalString, compareDecimal } from "@coinzilla/utils"
import {
  OrderHistoryIntegrityError,
  OrderHistoryValidationError,
} from "../../domain/order-history/order-history-errors.js"
import { createOrderHistoryId } from "../../domain/order-history/order-history-record.js"
import { OrderHistoryPersistenceError } from "./order-history-persistence-error.js"

function requireString({ value, field } = {}) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    throw new OrderHistoryValidationError({ field })
  }
  return value
}

function requireDecimal({ value, field, positive = false } = {}) {
  let amount
  try {
    amount = assertDecimalString({
      value,
      field,
    })
  } catch (cause) {
    throw new OrderHistoryValidationError({
      field,
      cause,
    })
  }
  const comparison = compareDecimal({
    left: amount,
    right: "0",
  })
  if (comparison < 0 || (positive && comparison === 0)) {
    throw new OrderHistoryValidationError({ field })
  }
  return amount
}

function requireIsoTimestamp({ value, field } = {}) {
  const timestamp = requireString({
    value,
    field,
  })
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== timestamp) {
    throw new OrderHistoryValidationError({ field })
  }
  return timestamp
}

function mapExecutionTimestamp({ value } = {}) {
  if (value === undefined || value === null) {
    return null
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OrderHistoryValidationError({
      field: "executedAt",
    })
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new OrderHistoryValidationError({
      field: "executedAt",
    })
  }
  return date.toISOString()
}

function mapCommission({ commission, ordinal } = {}) {
  const { quoteValue } = commission
  const quoteValueMissing = quoteValue === undefined || quoteValue === null
  return {
    ordinal,
    amount: requireDecimal({
      value: commission.amount,
      field: `commissions[${ordinal}].amount`,
    }),
    asset_id: requireString({
      value: commission.assetId,
      field: `commissions[${ordinal}].assetId`,
    }),
    asset_code: requireString({
      value: commission.asset,
      field: `commissions[${ordinal}].asset`,
    }),
    quote_value_amount: quoteValueMissing
      ? null
      : requireDecimal({
          value: quoteValue.amount,
          field: `commissions[${ordinal}].quoteValue.amount`,
        }),
    quote_value_asset_id: quoteValueMissing
      ? null
      : requireString({
          value: quoteValue.assetId,
          field: `commissions[${ordinal}].quoteValue.assetId`,
        }),
    quote_value_asset_code: quoteValueMissing
      ? null
      : requireString({
          value: quoteValue.asset,
          field: `commissions[${ordinal}].quoteValue.asset`,
        }),
  }
}

function mapCommissions({ commissions } = {}) {
  if (!Array.isArray(commissions)) {
    throw new OrderHistoryValidationError({
      field: "commissions",
    })
  }
  const result = []
  for (let ordinal = 0; ordinal < commissions.length; ordinal += 1) {
    result.push(mapCommission({
      commission: commissions[ordinal],
      ordinal,
    }))
  }
  return result
}

function resolveMarketId({ fillId, tradeId } = {}) {
  const suffix = `:${tradeId}`
  if (!fillId.endsWith(suffix) || fillId.length === suffix.length) {
    throw new OrderHistoryIntegrityError({
      field: "canonicalFillId",
    })
  }
  return fillId.slice(0, -suffix.length)
}

function mapFillIdentity({ fill, environment, marketId, tradeId, fillId } = {}) {
  const providerType = requireString({
    value: fill.providerType,
    field: "providerType",
  })
  const providerInstanceId = requireString({
    value: fill.providerInstanceId,
    field: "providerInstanceId",
  })
  const accountId = requireString({
    value: fill.accountId,
    field: "accountId",
  })
  return {
    id: JSON.stringify([
      environment,
      providerInstanceId,
      providerType,
      accountId,
      marketId,
      tradeId,
    ]),
    canonical_fill_id: fillId,
    provider_type: providerType,
    provider_instance_id: providerInstanceId,
    account_id: accountId,
    environment,
    market_id: marketId,
    symbol: requireString({
      value: fill.symbol,
      field: "symbol",
    }),
    exchange_trade_id: tradeId,
    exchange_order_id: requireString({
      value: fill.brokerOrderId,
      field: "brokerOrderId",
    }),
    client_order_id: fill.clientOrderId === undefined
      ? null
      : requireString({
          value: fill.clientOrderId,
          field: "clientOrderId",
        }),
  }
}

function mapFillExecution({ fill } = {}) {
  if (fill.side !== "BUY" && fill.side !== "SELL") {
    throw new OrderHistoryValidationError({
      field: "side",
    })
  }
  return {
    side: fill.side,
    execution_price: requireDecimal({
      value: fill.price,
      field: "price",
      positive: true,
    }),
    executed_base_quantity: requireDecimal({
      value: fill.quantity,
      field: "quantity",
      positive: true,
    }),
    executed_quote_quantity: requireDecimal({
      value: fill.quoteQuantity,
      field: "quoteQuantity",
      positive: true,
    }),
    liquidity_role: requireString({
      value: fill.liquidityRole,
      field: "liquidityRole",
    }),
    commission_status: requireString({
      value: fill.commissionStatus,
      field: "commissionStatus",
    }),
    exchange_executed_at: mapExecutionTimestamp({
      value: fill.executedAt,
    }),
  }
}

function mapFillSourceEvent({ sourceEvent } = {}) {
  const observedAt = requireIsoTimestamp({
    value: sourceEvent.timestamp,
    field: "sourceEvent.timestamp",
  })
  return {
    local_observed_at: observedAt,
    source_event_id: requireString({
      value: sourceEvent.id,
      field: "sourceEvent.id",
    }),
    last_source_event_id: requireString({
      value: sourceEvent.id,
      field: "sourceEvent.id",
    }),
    source_event_name: requireString({
      value: sourceEvent.name,
      field: "sourceEvent.name",
    }),
    source_event_source: requireString({
      value: sourceEvent.source,
      field: "sourceEvent.source",
    }),
    source_event_timestamp: observedAt,
  }
}

function mapFillEvent({ fill, sourceEvent, environment } = {}) {
  const tradingEnvironment = requireString({
    value: environment,
    field: "environment",
  })
  if (!["testnet", "live"].includes(tradingEnvironment)) {
    throw new OrderHistoryValidationError({
      field: "environment",
    })
  }
  const tradeId = requireString({
    value: fill.tradeId,
    field: "tradeId",
  })
  const fillId = requireString({
    value: fill.fillId,
    field: "fillId",
  })
  const marketId = resolveMarketId({
    fillId,
    tradeId,
  })
  return {
    ...mapFillIdentity({
      fill,
      environment: tradingEnvironment,
      marketId,
      tradeId,
      fillId,
    }),
    ...mapFillExecution({ fill }),
    ...mapFillSourceEvent({ sourceEvent }),
    commissions: mapCommissions({
      commissions: fill.commissions,
    }),
  }
}

function readOrderByClientOrderId({ transaction, fill } = {}) {
  const id = createOrderHistoryId({
    environment: fill.environment,
    providerInstanceId: fill.provider_instance_id,
    providerType: fill.provider_type,
    accountId: fill.account_id,
    clientOrderId: fill.client_order_id,
  })
  return transaction.prepare(
    "SELECT id, market_id, exchange_order_id, client_order_id, strategy_id, position_id, cycle_id FROM orders WHERE id = ?",
  ).get(id)
}

function readOrderByExchangeOrderId({ transaction, fill } = {}) {
  return transaction.prepare(`
    SELECT id, market_id, exchange_order_id, client_order_id, strategy_id, position_id, cycle_id FROM orders
    WHERE environment = ? AND provider_instance_id = ? AND provider_type = ?
      AND account_id = ? AND exchange_order_id = ?
  `).get(
    fill.environment,
    fill.provider_instance_id,
    fill.provider_type,
    fill.account_id,
    fill.exchange_order_id,
  )
}

function findOrderReference({ transaction, fill } = {}) {
  if (fill.client_order_id !== null) {
    const order = readOrderByClientOrderId({
      transaction,
      fill,
    })
    if (order) {
      return order
    }
  }
  return readOrderByExchangeOrderId({
    transaction,
    fill,
  })
}

function assertOrderReferenceMatches({ order, fill } = {}) {
  if (order && (
    order.market_id !== fill.market_id ||
    (order.exchange_order_id !== null &&
      order.exchange_order_id !== fill.exchange_order_id) ||
    (fill.client_order_id !== null &&
      order.client_order_id !== fill.client_order_id)
  )) {
    throw new OrderHistoryIntegrityError({
      field: "fill.orderIdentity",
      providerInstanceId: fill.provider_instance_id,
      accountId: fill.account_id,
      clientOrderId: fill.client_order_id ?? undefined,
    })
  }
}

function mapFillRow({ fill, order } = {}) {
  const row = { ...fill }
  delete row.commissions
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

function readExistingFill({ transaction, fill } = {}) {
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

function readExistingCommissions({ transaction, fillId } = {}) {
  return transaction.prepare(`
    SELECT ordinal, amount, asset_id, asset_code, quote_value_amount,
      quote_value_asset_id, quote_value_asset_code
    FROM fill_commissions WHERE fill_id = ? ORDER BY ordinal
  `).all(fillId)
}

function commissionFactsMatch({ existing, candidate } = {}) {
  return JSON.stringify(existing) === JSON.stringify(candidate)
}

function assertDuplicateMatches({ transaction, existing, candidate } = {}) {
  const columns = [
    "canonical_fill_id",
    "provider_type",
    "provider_instance_id",
    "account_id",
    "environment",
    "market_id",
    "symbol",
    "exchange_trade_id",
    "exchange_order_id",
    "client_order_id",
    "side",
    "execution_price",
    "executed_base_quantity",
    "executed_quote_quantity",
    "liquidity_role",
    "commission_status",
    "exchange_executed_at",
  ]
  const factsMatch = columns.every((column) => existing[column] === candidate[column])
  const commissionsMatch = commissionFactsMatch({
    existing: readExistingCommissions({
      transaction,
      fillId: existing.id,
    }),
    candidate: candidate.commissions,
  })
  if (!factsMatch || !commissionsMatch) {
    throw new OrderHistoryIntegrityError({
      field: "fillExecutionIdentity",
      providerInstanceId: candidate.provider_instance_id,
      accountId: candidate.account_id,
      clientOrderId: candidate.client_order_id ?? undefined,
    })
  }
}

function insertCommissions({ transaction, fillId, commissions } = {}) {
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

function insertFill({ transaction, row, commissions } = {}) {
  const columns = Object.keys(row)
  transaction.prepare(
    `INSERT INTO fills (${columns.join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
  ).run(...columns.map((column) => row[column]))
  insertCommissions({
    transaction,
    fillId: row.id,
    commissions,
  })
}

function upsertFill({ transaction, fill } = {}) {
  const existing = readExistingFill({
    transaction,
    fill,
  })
  if (existing !== undefined) {
    assertDuplicateMatches({
      transaction,
      existing,
      candidate: fill,
    })
    transaction.prepare(
      "UPDATE fills SET last_observed_at = ?, last_source_event_id = ? WHERE id = ?",
    ).run(
      fill.local_observed_at,
      fill.last_source_event_id,
      existing.id,
    )
    return existing.id
  }
  const order = findOrderReference({
    transaction,
    fill,
  })
  assertOrderReferenceMatches({
    order,
    fill,
  })
  const row = mapFillRow({
    fill,
    order,
  })
  insertFill({
    transaction,
    row,
    commissions: fill.commissions,
  })
  return row.id
}

function normalizeFillWriteError({ error, fill } = {}) {
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
      const candidate = mapFillEvent({
        fill,
        sourceEvent,
        environment,
      })
      try {
        return await database.transaction((transaction) => upsertFill({
          transaction,
          fill: candidate,
        }))
      } catch (error) {
        throw normalizeFillWriteError({
          error,
          fill,
        })
      }
    },
  })
}
