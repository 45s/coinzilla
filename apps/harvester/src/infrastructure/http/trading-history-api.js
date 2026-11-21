import { timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { SystemCustomError } from "@coinzilla/utils"
import { attachTradingHistoryWebSocket } from "./trading-history-websocket.js"

const API_PREFIX = "/api/v1/trading"
const METADATA_ROUTE = `${API_PREFIX}/metadata`
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

const LIST_ROUTES = Object.freeze({
  [`${API_PREFIX}/orders`]: Object.freeze({
    method: "listOrders",
    allowedFilters: ORDER_FILTERS,
  }),
  [`${API_PREFIX}/fills`]: Object.freeze({
    method: "listFills",
    allowedFilters: FILL_FILTERS,
  }),
  [`${API_PREFIX}/commissions`]: Object.freeze({
    method: "listCommissions",
    allowedFilters: COMMISSION_FILTERS,
  }),
})

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

function handleOptionsRequest({ request, response } = {}) {
  if (request.method !== "OPTIONS") {
    return false
  }
  response.writeHead(204, createResponseHeaders())
  response.end()
  return true
}

function handleMetadataRequest({ response, queries, environment } = {}) {
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
}

function handleListRequest({ response, queries, url, route } = {}) {
  const input = parseListQuery({
    searchParams: url.searchParams,
    allowedFilters: route.allowedFilters,
  })
  sendQueryResult({
    response,
    result: queries[route.method](input),
  })
}

function resolveDetailRoute(route) {
  const orderMatch = route.match(/^\/api\/v1\/trading\/orders\/([^/]+)$/)
  if (orderMatch) {
    return {
      method: "getOrder",
      encodedId: orderMatch[1],
    }
  }
  const fillMatch = route.match(/^\/api\/v1\/trading\/fills\/([^/]+)$/)
  if (fillMatch) {
    return {
      method: "getFill",
      encodedId: fillMatch[1],
    }
  }
  return null
}

function handleDetailRequest({ response, queries, route } = {}) {
  sendQueryResult({
    response,
    result: queries[route.method]({
      id: decodeRecordId({
        encodedId: route.encodedId,
      }),
    }),
    notFound: true,
  })
}

function handleRequestPreconditions({ request, response, token } = {}) {
  if (handleOptionsRequest({
    request,
    response,
  })) {
    return true
  }
  if (request.method !== "GET") {
    sendApiError({
      response,
      status: 405,
      code: "HARVESTER_TRADING_HISTORY_METHOD_NOT_ALLOWED",
      message: "This API resource supports GET requests only.",
    })
    return true
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
    return true
  }
  return false
}

function handleTradingHistoryRequest({
  request,
  response,
  queries,
  token,
  environment,
} = {}) {
  if (handleRequestPreconditions({
    request,
    response,
    token,
  })) {
    return
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  if (url.pathname === METADATA_ROUTE) {
    handleMetadataRequest({
      response,
      queries,
      environment,
    })
    return
  }
  const listRoute = LIST_ROUTES[url.pathname]
  if (listRoute) {
    handleListRequest({
      response,
      queries,
      url,
      route: listRoute,
    })
    return
  }
  const detailRoute = resolveDetailRoute(url.pathname)
  if (detailRoute) {
    handleDetailRequest({
      response,
      queries,
      route: detailRoute,
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

function createRequestHandler({ queries, token, environment, logger } = {}) {
  return (...requestArguments) => {
    const [request, response] = requestArguments
    try {
      handleTradingHistoryRequest({
        request,
        response,
        queries,
        token,
        environment,
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
  }
}

async function closeServer(server) {
  if (!server.listening) {
    return
  }
  await new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function validateApiToken(token) {
  if (typeof token !== "string" || token.trim() !== token || Buffer.byteLength(token, "utf8") < 32) {
    throw new TypeError("HARVESTER_API_TOKEN must contain at least 32 non-whitespace characters.")
  }
}

function validateApiEnvironment(environment) {
  if (environment !== "testnet" && environment !== "live") {
    throw new TypeError("Trading-history API environment must be exactly testnet or live.")
  }
}

function validateApiHost(host) {
  if (typeof host !== "string" || host.trim() !== host || host.length === 0) {
    throw new TypeError("HARVESTER_API_HOST must be a non-empty host name or IP address.")
  }
}

function validateApiPort(port) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("HARVESTER_API_PORT must be an integer between 0 and 65535.")
  }
}

function validateQueryOperations(queries) {
  for (const method of REQUIRED_QUERY_METHODS) {
    if (typeof queries?.[method] !== "function") {
      throw new TypeError(`Trading-history API requires the application query ${method}()`)
    }
  }
}

function validateApiServerConfiguration({
  queries,
  token,
  environment,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
} = {}) {
  validateApiToken(token)
  validateApiEnvironment(environment)
  validateApiHost(host)
  validateApiPort(port)
  validateQueryOperations(queries)
  return Object.freeze({
    queries,
    token,
    environment,
    host,
    port,
  })
}

function createConfiguredServer({ queries, token, environment, logger } = {}) {
  const server = createServer({
    maxHeaderSize: MAX_HEADER_SIZE,
  }, createRequestHandler({
    queries,
    token,
    environment,
    logger,
  }))
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.headersTimeout = HEADERS_TIMEOUT_MS
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS
  server.maxRequestsPerSocket = 100
  return server
}

async function listenServer({ server, host, port } = {}) {
  await new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    server.once("error", reject)
    server.once("listening", () => {
      server.off("error", reject)
      resolve()
    })
    server.listen(port, host)
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
  eventBus,
} = {}) {
  const configuration = validateApiServerConfiguration({
    queries,
    token,
    environment,
    host,
    port,
  })
  const server = createConfiguredServer({
    queries: configuration.queries,
    token: configuration.token,
    environment: configuration.environment,
    logger,
  })
  const websocket = eventBus
    ? attachTradingHistoryWebSocket({
        server,
        eventBus,
        token: configuration.token,
      })
    : null
  try {
    await listenServer({
      server,
      host: configuration.host,
      port: configuration.port,
    })
  } catch (error) {
    await websocket?.close()
    throw error
  }
  return Object.freeze({
    address: server.address(),
    close: async () => {
      await websocket?.close()
      await closeServer(server)
    },
  })
}
