import { timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { SystemCustomError } from "@coinzilla/utils"

const API_PREFIX = "/api/v1/trading"
const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 4201
const MAX_HEADER_SIZE = 8_192
const REQUEST_TIMEOUT_MS = 5_000
const HEADERS_TIMEOUT_MS = 6_000
const KEEP_ALIVE_TIMEOUT_MS = 5_000

const ORDER_FILTERS = new Set([
  "symbol",
  "side",
  "status",
  "providerType",
  "providerInstanceId",
  "accountId",
  "strategyId",
])

const FILL_FILTERS = new Set([
  "symbol",
  "side",
  "providerType",
  "providerInstanceId",
  "accountId",
  "strategyId",
  "commissionStatus",
])

const COMMISSION_FILTERS = new Set([
  "symbol",
  "side",
  "assetCode",
  "providerType",
  "providerInstanceId",
  "accountId",
  "strategyId",
])

const REQUIRED_QUERY_METHODS = Object.freeze([
  "getSummary",
  "listOrders",
  "getOrder",
  "listFills",
  "getFill",
  "listCommissions",
])

class TradingHistoryApiRequestError extends SystemCustomError {
  constructor({ message, code, status, cause } = {}) {
    super(message, {
      code,
      ...(cause === undefined ? {} : { cause }),
    })
    this.status = status
  }
}

function createRequestError({ message, code, status = 400, cause } = {}) {
  return new TradingHistoryApiRequestError({
    message,
    code,
    status,
    ...(cause === undefined ? {} : { cause }),
  })
}

function createResponseHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  }
}

function sendJson({ response, status, body } = {}) {
  if (response.destroyed || response.writableEnded) {
    return
  }
  response.writeHead(status, createResponseHeaders())
  response.end(JSON.stringify(body))
}

function sendApiError({ response, status, code, message } = {}) {
  sendJson({
    response,
    status,
    body: {
      ok: false,
      error: {
        code,
        message,
      },
    },
  })
}

function isAuthorized({ authorization, token } = {}) {
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return false
  }
  const suppliedToken = authorization.slice("Bearer ".length)
  if (suppliedToken.length === 0 || suppliedToken.trim() !== suppliedToken) {
    return false
  }
  const expected = Buffer.from(token, "utf8")
  const actual = Buffer.from(suppliedToken, "utf8")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function parseIntegerParameter({ searchParams, name, fallback } = {}) {
  const values = searchParams.getAll(name)
  if (values.length === 0) {
    return fallback
  }
  if (values.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(values[0])) {
    throw createRequestError({
      message: "Trading-history pagination parameters are invalid.",
      code: "HARVESTER_TRADING_HISTORY_QUERY_INVALID",
    })
  }
  const value = Number(values[0])
  if (!Number.isSafeInteger(value)) {
    throw createRequestError({
      message: "Trading-history pagination parameters are invalid.",
      code: "HARVESTER_TRADING_HISTORY_QUERY_INVALID",
    })
  }
  return value
}

function parseListQuery({ searchParams, allowedFilters } = {}) {
  const filters = {}
  for (const key of searchParams.keys()) {
    if (key === "limit" || key === "offset") {
      continue
    }
    if (!allowedFilters.has(key) || searchParams.getAll(key).length !== 1) {
      throw createRequestError({
        message: "Trading-history filter parameters are invalid.",
        code: "HARVESTER_TRADING_HISTORY_QUERY_INVALID",
      })
    }
    filters[key] = searchParams.get(key)
  }
  return {
    filters,
    pagination: {
      limit: parseIntegerParameter({
        searchParams,
        name: "limit",
        fallback: 50,
      }),
      offset: parseIntegerParameter({
        searchParams,
        name: "offset",
        fallback: 0,
      }),
    },
  }
}

function decodeRecordId({ encodedId } = {}) {
  try {
    const id = decodeURIComponent(encodedId)
    if (id.length === 0 || id.length > 512 || id.trim() !== id) {
      throw new TypeError("Record identifier is invalid")
    }
    return id
  } catch (cause) {
    throw createRequestError({
      message: "Trading-history record identifier is invalid.",
      code: "HARVESTER_TRADING_HISTORY_RECORD_ID_INVALID",
      cause,
    })
  }
}

function sendQueryResult({ response, result, notFound = false } = {}) {
  if (result?.ok !== true) {
    const error = result?.errors?.[0]
    const invalidQuery = error?.code === "HARVESTER_TRADING_HISTORY_QUERY_INVALID"
    sendApiError({
      response,
      status: invalidQuery ? 400 : 500,
      code: error?.code ?? "HARVESTER_TRADING_HISTORY_QUERY_FAILED",
      message: invalidQuery
        ? "Trading-history query parameters are invalid."
        : "Trading-history query failed.",
    })
    return
  }
  if (notFound && result.data === null) {
    sendApiError({
      response,
      status: 404,
      code: "HARVESTER_TRADING_HISTORY_RECORD_NOT_FOUND",
      message: "The requested trading-history record does not exist.",
    })
    return
  }
  sendJson({
    response,
    status: 200,
    body: {
      ok: true,
      data: result.data,
    },
  })
}

function logRequestFailure({ logger, error } = {}) {
  try {
    logger?.error?.({
      message: "Trading-history API request failed",
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? "HARVESTER_TRADING_HISTORY_API_REQUEST_FAILED",
    })
  } catch {
    // API diagnostics must not interrupt the response or server lifecycle.
  }
}

function handleTradingHistoryRequest({
  request,
  response,
  queries,
  token,
  environment,
  logger,
} = {}) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, createResponseHeaders())
    response.end()
    return
  }
  if (request.method !== "GET") {
    sendApiError({
      response,
      status: 405,
      code: "HARVESTER_TRADING_HISTORY_METHOD_NOT_ALLOWED",
      message: "This API resource supports GET requests only.",
    })
    return
  }
  if (!isAuthorized({
    authorization: request.headers.authorization,
    token,
  })) {
    sendApiError({
      response,
      status: 401,
      code: "HARVESTER_TRADING_HISTORY_AUTHENTICATION_REQUIRED",
      message: "A valid bearer token is required.",
    })
    return
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  const route = url.pathname

  if (route === API_PREFIX + "/metadata") {
    const result = queries.getSummary()
    if (result?.ok !== true) {
      sendQueryResult({
        response,
        result,
      })
      return
    }
    sendJson({
      response,
      status: 200,
      body: {
        ok: true,
        data: {
          environment,
          records: result.data,
        },
      },
    })
    return
  }

  if (route === API_PREFIX + "/orders") {
    sendQueryResult({
      response,
      result: queries.listOrders(parseListQuery({
        searchParams: url.searchParams,
        allowedFilters: ORDER_FILTERS,
      })),
    })
    return
  }

  if (route === API_PREFIX + "/fills") {
    sendQueryResult({
      response,
      result: queries.listFills(parseListQuery({
        searchParams: url.searchParams,
        allowedFilters: FILL_FILTERS,
      })),
    })
    return
  }

  if (route === API_PREFIX + "/commissions") {
    sendQueryResult({
      response,
      result: queries.listCommissions(parseListQuery({
        searchParams: url.searchParams,
        allowedFilters: COMMISSION_FILTERS,
      })),
    })
    return
  }

  const orderMatch = route.match(/^\/api\/v1\/trading\/orders\/([^/]+)$/)
  if (orderMatch) {
    sendQueryResult({
      response,
      result: queries.getOrder({
        id: decodeRecordId({
          encodedId: orderMatch[1],
        }),
      }),
      notFound: true,
    })
    return
  }

  const fillMatch = route.match(/^\/api\/v1\/trading\/fills\/([^/]+)$/)
  if (fillMatch) {
    sendQueryResult({
      response,
      result: queries.getFill({
        id: decodeRecordId({
          encodedId: fillMatch[1],
        }),
      }),
      notFound: true,
    })
    return
  }

  sendApiError({
    response,
    status: 404,
    code: "HARVESTER_TRADING_HISTORY_ROUTE_NOT_FOUND",
    message: "The requested trading-history API resource does not exist.",
  })
}

async function closeServer(server) {
  if (!server.listening) {
    return
  }
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

/**
 * Start the versioned HTTP adapter for Harvester's trading-history query facade.
 *
 * @param {{queries: object, token: string, environment: "testnet"|"live", host?: string, port?: number, logger?: object}} input
 * @returns {Promise<Readonly<{address: object, close: Function}>>} Bound server and lifecycle handle.
 */
export async function startTradingHistoryApiServer({
  queries,
  token,
  environment,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  logger,
} = {}) {
  if (typeof token !== "string" || token.trim() !== token || Buffer.byteLength(token, "utf8") < 32) {
    throw new TypeError("HARVESTER_API_TOKEN must contain at least 32 non-whitespace characters.")
  }
  if (environment !== "testnet" && environment !== "live") {
    throw new TypeError("Trading-history API environment must be exactly testnet or live.")
  }
  if (typeof host !== "string" || host.trim() !== host || host.length === 0) {
    throw new TypeError("HARVESTER_API_HOST must be a non-empty host name or IP address.")
  }
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("HARVESTER_API_PORT must be an integer between 0 and 65535.")
  }
  for (const method of REQUIRED_QUERY_METHODS) {
    if (typeof queries?.[method] !== "function") {
      throw new TypeError("Trading-history API requires the application query " + method + "()")
    }
  }

  const server = createServer({
    maxHeaderSize: MAX_HEADER_SIZE,
  }, (request, response) => {
    try {
      handleTradingHistoryRequest({
        request,
        response,
        queries,
        token,
        environment,
        logger,
      })
    } catch (error) {
      if (error instanceof TradingHistoryApiRequestError) {
        sendApiError({
          response,
          status: error.status,
          code: error.code,
          message: error.status === 400
            ? error.message
            : "Trading-history API request failed.",
        })
        return
      }
      logRequestFailure({
        logger,
        error,
      })
      sendApiError({
        response,
        status: 500,
        code: "HARVESTER_TRADING_HISTORY_API_REQUEST_FAILED",
        message: "Trading-history API request failed.",
      })
    }
  })

  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.headersTimeout = HEADERS_TIMEOUT_MS
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS
  server.maxRequestsPerSocket = 100

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port, host)
  })

  return Object.freeze({
    address: server.address(),
    close: () => closeServer(server),
  })
}
