import { toResult } from "@coinzilla/utils"
import { assertTradingHistoryQueryRepository } from "../application/ports/trading-history-query-repository.js"
import { TradingHistoryQueryError } from "./trading-history-query-error.js"

const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 100

const FILTER_RULES = Object.freeze({
  listOrders: Object.freeze({
    symbol: 32,
    side: Object.freeze(["BUY", "SELL"]),
    status: 48,
    providerType: 64,
    providerInstanceId: 128,
    accountId: 128,
    strategyId: 128,
  }),
  listFills: Object.freeze({
    symbol: 32,
    side: Object.freeze(["BUY", "SELL"]),
    providerType: 64,
    providerInstanceId: 128,
    accountId: 128,
    strategyId: 128,
    commissionStatus: 48,
  }),
  listCommissions: Object.freeze({
    symbol: 32,
    side: Object.freeze(["BUY", "SELL"]),
    assetCode: 32,
    providerType: 64,
    providerInstanceId: 128,
    accountId: 128,
    strategyId: 128,
  }),
})

function createInvalidQueryError({ operation, field, cause } = {}) {
  return new TradingHistoryQueryError({
    message: "Trading-history " + operation + " query contains an invalid " + field,
    code: "HARVESTER_TRADING_HISTORY_QUERY_INVALID",
    operation,
    field,
    ...(cause === undefined ? {} : { cause }),
  })
}

function normalizeFilters({ filters, operation } = {}) {
  if (filters === undefined) {
    return Object.freeze({})
  }
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw createInvalidQueryError({
      operation,
      field: "filters object",
    })
  }
  const rules = FILTER_RULES[operation]
  const normalized = {}
  for (const [field, value] of Object.entries(filters)) {
    const rule = rules[field]
    if (rule === undefined) {
      throw createInvalidQueryError({
        operation,
        field,
      })
    }
    if (value === undefined || value === null || value === "") {
      continue
    }
    if (typeof value !== "string" || value.trim() !== value) {
      throw createInvalidQueryError({
        operation,
        field,
      })
    }
    if (Array.isArray(rule)) {
      if (!rule.includes(value)) {
        throw createInvalidQueryError({
          operation,
          field,
        })
      }
    } else if (value.length > rule) {
      throw createInvalidQueryError({
        operation,
        field,
      })
    }
    normalized[field] = value
  }
  return Object.freeze(normalized)
}

function normalizePagination({ pagination, operation } = {}) {
  if (pagination !== undefined &&
    (!pagination || typeof pagination !== "object" || Array.isArray(pagination))) {
    throw createInvalidQueryError({
      operation,
      field: "pagination",
    })
  }
  const input = pagination ?? {}
  for (const field of Object.keys(input)) {
    if (field !== "limit" && field !== "offset") {
      throw createInvalidQueryError({
        operation,
        field: "pagination." + field,
      })
    }
  }
  const limit = input.limit ?? DEFAULT_PAGE_LIMIT
  const offset = input.offset ?? 0
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw createInvalidQueryError({
      operation,
      field: "pagination.limit",
    })
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw createInvalidQueryError({
      operation,
      field: "pagination.offset",
    })
  }
  return Object.freeze({ limit, offset })
}

function normalizeRecordId({ id, operation } = {}) {
  if (typeof id !== "string" || id.trim() !== id || id.length === 0 || id.length > 512) {
    throw createInvalidQueryError({
      operation,
      field: "id",
    })
  }
  return id
}

function executeQuery({ operation, read } = {}) {
  try {
    return toResult({ data: read() })
  } catch (cause) {
    const error = cause instanceof TradingHistoryQueryError
      ? cause
      : new TradingHistoryQueryError({
          message: "Harvester trading-history " + operation + " query failed",
          code: "HARVESTER_TRADING_HISTORY_QUERY_FAILED",
          operation,
          cause,
        })
    return toResult({ error })
  }
}

function createListQuery({ repository, method, operation } = {}) {
  return ({ filters, pagination } = {}) => executeQuery({
    operation,
    read: () => repository[method]({
      filters: normalizeFilters({ filters, operation }),
      pagination: normalizePagination({ pagination, operation }),
    }),
  })
}

function createDetailQuery({ repository, method, operation } = {}) {
  return ({ id } = {}) => executeQuery({
    operation,
    read: () => repository[method]({
      id: normalizeRecordId({ id, operation }),
    }),
  })
}

/**
 * Compose transport-independent queries over Harvester's persisted trading records.
 *
 * No HTTP, UI, caller identity, broker, or exchange concepts enter this application boundary.
 *
 * @param {{repository: object}} input
 * @returns {Readonly<object>} Application query operations.
 */
export function createTradingHistoryQueries({ repository } = {}) {
  const queryRepository = assertTradingHistoryQueryRepository({ repository })
  return Object.freeze({
    getSummary: () => executeQuery({
      operation: "GET_SUMMARY",
      read: () => queryRepository.getSummary(),
    }),
    listOrders: createListQuery({
      repository: queryRepository,
      method: "listOrders",
      operation: "LIST_ORDERS",
    }),
    getOrder: createDetailQuery({
      repository: queryRepository,
      method: "findOrderById",
      operation: "GET_ORDER",
    }),
    listFills: createListQuery({
      repository: queryRepository,
      method: "listFills",
      operation: "LIST_FILLS",
    }),
    getFill: createDetailQuery({
      repository: queryRepository,
      method: "findFillById",
      operation: "GET_FILL",
    }),
    listCommissions: createListQuery({
      repository: queryRepository,
      method: "listCommissions",
      operation: "LIST_COMMISSIONS",
    }),
  })
}
