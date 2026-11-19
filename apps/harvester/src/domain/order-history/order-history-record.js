import {
  addDecimal,
  assertDecimalString,
  compareDecimal,
} from "@coinzilla/utils"
import { OrderHistoryValidationError } from "./order-history-errors.js"

const VALID_ENVIRONMENTS = new Set(["testnet", "live"])
const ORDER_TIMESTAMP_FIELDS = Object.freeze([
  "createdAt",
  "acknowledgedAt",
  "updatedAt",
  "completedAt",
])

function isRecord(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
}

function invalidField({ field, order, cause } = {}) {
  throw new OrderHistoryValidationError({
    field,
    ...(cause === undefined ? {} : { cause }),
    providerInstanceId: order?.providerInstanceId,
    accountId: order?.accountId,
    clientOrderId: order?.clientOrderId,
  })
}

function requireString({ value, field, order } = {}) {
  if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
    invalidField({
      field,
      order,
    })
  }
  return value
}

function requireDecimal({ value, field, order } = {}) {
  try {
    return assertDecimalString({
      value,
      field,
    })
  } catch (cause) {
    invalidField({
      field,
      order,
      cause,
    })
  }
}

function requireNonNegativeDecimal({ value, field, order } = {}) {
  const decimal = requireDecimal({
    value,
    field,
    order,
  })
  if (compareDecimal({
    left: decimal,
    right: "0",
  }) < 0) {
    invalidField({
      field,
      order,
    })
  }
  return decimal
}

function requireTimestamp({ value, field, order } = {}) {
  if (!Number.isSafeInteger(value) || value < 0) {
    invalidField({
      field,
      order,
    })
  }
  return value
}

function mapMarket({ market, order } = {}) {
  if (!isRecord(market) || !isRecord(market.baseAsset) || !isRecord(market.quoteAsset)) {
    invalidField({
      field: "market",
      order,
    })
  }
  return Object.freeze({
    id: requireString({
      value: market.id,
      field: "market.id",
      order,
    }),
    venue: requireString({
      value: market.venue,
      field: "market.venue",
      order,
    }),
    symbol: requireString({
      value: market.symbol,
      field: "market.symbol",
      order,
    }),
    baseAsset: Object.freeze({
      id: requireString({
        value: market.baseAsset.id,
        field: "market.baseAsset.id",
        order,
      }),
      code: requireString({
        value: market.baseAsset.code,
        field: "market.baseAsset.code",
        order,
      }),
    }),
    quoteAsset: Object.freeze({
      id: requireString({
        value: market.quoteAsset.id,
        field: "market.quoteAsset.id",
        order,
      }),
      code: requireString({
        value: market.quoteAsset.code,
        field: "market.quoteAsset.code",
        order,
      }),
    }),
  })
}

function mapOwnership({ ownership, order } = {}) {
  if (ownership === undefined) {
    return undefined
  }
  if (!isRecord(ownership)) {
    invalidField({
      field: "ownership",
      order,
    })
  }
  const mapped = {
    strategyId: requireString({
      value: ownership.strategyId,
      field: "ownership.strategyId",
      order,
    }),
    positionId: requireString({
      value: ownership.positionId,
      field: "ownership.positionId",
      order,
    }),
    purpose: requireString({
      value: ownership.purpose,
      field: "ownership.purpose",
      order,
    }),
  }
  if (ownership.cycleId !== undefined) {
    mapped.cycleId = requireString({
      value: ownership.cycleId,
      field: "ownership.cycleId",
      order,
    })
  }
  return Object.freeze(mapped)
}

function mapOptionalTimestamps({ order } = {}) {
  const timestamps = {}
  for (const field of ORDER_TIMESTAMP_FIELDS) {
    if (order[field] === undefined) {
      continue
    }
    timestamps[field] = requireTimestamp({
      value: order[field],
      field,
      order,
    })
  }
  return timestamps
}

function mapSourceEvent({ sourceEvent, order } = {}) {
  if (!isRecord(sourceEvent)) {
    invalidField({
      field: "sourceEvent",
      order,
    })
  }
  const id = requireString({
    value: sourceEvent.id,
    field: "sourceEvent.id",
    order,
  })
  const name = requireString({
    value: sourceEvent.name,
    field: "sourceEvent.name",
    order,
  })
  const source = requireString({
    value: sourceEvent.source,
    field: "sourceEvent.source",
    order,
  })
  const timestamp = requireString({
    value: sourceEvent.timestamp,
    field: "sourceEvent.timestamp",
    order,
  })
  if (!Number.isFinite(Date.parse(timestamp))) {
    invalidField({
      field: "sourceEvent.timestamp",
      order,
    })
  }
  return {
    id,
    name,
    source,
    timestamp,
  }
}

/**
 * Create a collision-safe identity from the complete order ownership tuple.
 *
 * @param {{environment: string, providerInstanceId: string, providerType: string, accountId: string, clientOrderId: string}} input
 * @returns {string}
 * @throws {OrderHistoryValidationError} When any identity component is missing.
 */
export function createOrderHistoryId(input = {}) {
  const environment = requireString({
    value: input.environment,
    field: "environment",
  })
  if (!VALID_ENVIRONMENTS.has(environment)) {
    invalidField({
      field: "environment",
    })
  }
  const providerInstanceId = requireString({
    value: input.providerInstanceId,
    field: "providerInstanceId",
  })
  const providerType = requireString({
    value: input.providerType,
    field: "providerType",
  })
  const accountId = requireString({
    value: input.accountId,
    field: "accountId",
  })
  const clientOrderId = requireString({
    value: input.clientOrderId,
    field: "clientOrderId",
  })
  return JSON.stringify([
    environment,
    providerInstanceId,
    providerType,
    accountId,
    clientOrderId,
  ])
}

/**
 * Map a canonical order lifecycle event into one durable order-history snapshot.
 * Returns null for orders whose cumulative executed quantity is still zero.
 *
 * @param {{order: object, sourceEvent: object, environment: string}} input
 * @returns {object|null}
 * @throws {OrderHistoryValidationError} When filled-order evidence is incomplete or inconsistent.
 */
export function createOrderHistoryRecord({
  order,
  sourceEvent,
  environment,
} = {}) {
  if (!isRecord(order)) {
    invalidField({
      field: "order",
    })
  }
  const status = requireString({
    value: order.status,
    field: "status",
    order,
  })
  const executedQuantity = requireNonNegativeDecimal({
    value: order.executedQuantity,
    field: "executedQuantity",
    order,
  })
  const hasExecution = compareDecimal({
    left: executedQuantity,
    right: "0",
  }) > 0

  if (!hasExecution) {
    if (["PARTIALLY_FILLED", "FILLED"].includes(status)) {
      invalidField({
        field: "executedQuantity",
        order,
      })
    }
    return null
  }

  const originalQuantity = requireNonNegativeDecimal({
    value: order.originalQuantity ?? order.quantity,
    field: "originalQuantity",
    order,
  })
  const remainingQuantity = requireNonNegativeDecimal({
    value: order.remainingQuantity,
    field: "remainingQuantity",
    order,
  })
  if (
    compareDecimal({
      left: originalQuantity,
      right: "0",
    }) <= 0 ||
    compareDecimal({
      left: executedQuantity,
      right: originalQuantity,
    }) > 0 ||
    compareDecimal({
      left: addDecimal({
        left: executedQuantity,
        right: remainingQuantity,
      }),
      right: originalQuantity,
    }) !== 0
  ) {
    invalidField({
      field: "executionQuantities",
      order,
    })
  }
  if (
    status === "PARTIALLY_FILLED" &&
    compareDecimal({
      left: remainingQuantity,
      right: "0",
    }) <= 0
  ) {
    invalidField({
      field: "remainingQuantity",
      order,
    })
  }
  if (
    status === "FILLED" &&
    compareDecimal({
      left: remainingQuantity,
      right: "0",
    }) !== 0
  ) {
    invalidField({
      field: "remainingQuantity",
      order,
    })
  }

  const mappedEnvironment = requireString({
    value: environment,
    field: "environment",
    order,
  })
  if (!VALID_ENVIRONMENTS.has(mappedEnvironment)) {
    invalidField({
      field: "environment",
      order,
    })
  }
  const providerInstanceId = requireString({
    value: order.providerInstanceId,
    field: "providerInstanceId",
    order,
  })
  const providerType = requireString({
    value: order.providerType,
    field: "providerType",
    order,
  })
  const accountId = requireString({
    value: order.accountId,
    field: "accountId",
    order,
  })
  const clientOrderId = requireString({
    value: order.clientOrderId,
    field: "clientOrderId",
    order,
  })
  const market = mapMarket({
    market: order.market,
    order,
  })
  const symbol = requireString({
    value: order.symbol ?? market.symbol,
    field: "symbol",
    order,
  })
  if (symbol !== market.symbol) {
    invalidField({
      field: "market.symbol",
      order,
    })
  }

  const source = mapSourceEvent({
    sourceEvent,
    order,
  })
  const record = {
    id: createOrderHistoryId({
      environment: mappedEnvironment,
      providerInstanceId,
      providerType,
      accountId,
      clientOrderId,
    }),
    schemaVersion: 1,
    recordKind: "harvester.order-history",
    environment: mappedEnvironment,
    providerInstanceId,
    providerType,
    accountId,
    clientOrderId,
    market,
    symbol,
    side: requireString({
      value: order.side,
      field: "side",
      order,
    }),
    type: requireString({
      value: order.type,
      field: "type",
      order,
    }),
    originalQuantity,
    executedQuantity,
    remainingQuantity,
    status,
    firstSeenAt: source.timestamp,
    lastSeenAt: source.timestamp,
    firstSourceEventId: source.id,
    lastSourceEventId: source.id,
    lastSourceEventName: source.name,
    lastSourceEventSource: source.source,
    lastSourceEventTimestamp: source.timestamp,
  }
  if (order.brokerOrderId !== undefined) {
    record.brokerOrderId = requireString({
      value: order.brokerOrderId,
      field: "brokerOrderId",
      order,
    })
  }
  if (order.price !== undefined) {
    record.price = requireNonNegativeDecimal({
      value: order.price,
      field: "price",
      order,
    })
  }
  if (order.ownership !== undefined) {
    record.ownership = mapOwnership({
      ownership: order.ownership,
      order,
    })
  }
  for (const [field, value] of Object.entries(mapOptionalTimestamps({ order }))) {
    record[field] = value
  }
  if (order.cumulativeQuoteQuantity !== undefined) {
    record.cumulativeQuoteQuantity = requireNonNegativeDecimal({
      value: order.cumulativeQuoteQuantity,
      field: "cumulativeQuoteQuantity",
      order,
    })
  }
  if (order.brokerTransactionTime !== undefined) {
    record.brokerTransactionTime = requireTimestamp({
      value: order.brokerTransactionTime,
      field: "brokerTransactionTime",
      order,
    })
  }
  if (order.executionType !== undefined) {
    record.lastExecutionType = requireString({
      value: order.executionType,
      field: "executionType",
      order,
    })
  }
  return Object.freeze(record)
}
