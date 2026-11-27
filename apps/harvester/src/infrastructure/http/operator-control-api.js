import { isLocalDashboardOrigin } from "./is-local-dashboard-origin.js"

const ACTOR = Object.freeze({
  id: "local-dashboard",
  roles: Object.freeze(["trading-operator"]),
})

const READ_OPERATIONS = Object.freeze({
  status: "getStatus",
  markets: "getMarkets",
  positions: "getPositions",
  portfolio: "getPositions",
  orders: "getOrders",
  balances: "getBalances",
})

const COMMANDS = Object.freeze({
  pause: Object.freeze({
    method: "pauseMarket",
    requiresSymbol: true,
  }),
  unpause: Object.freeze({
    method: "resumeMarket",
    requiresSymbol: true,
  }),
  pauseallbuys: Object.freeze({
    method: "pauseAllBuys",
    requiresSymbol: false,
  }),
  resumeallbuys: Object.freeze({
    method: "resumeAllBuys",
    requiresSymbol: false,
  }),
})

const MAX_BODY_BYTES = 8_192

function sendJson({ response, status, body } = {}) {
  if (response.destroyed || response.writableEnded) {
    return
  }
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  }
  if (response.tradingHistoryOrigin) {
    headers["Access-Control-Allow-Origin"] = response.tradingHistoryOrigin
    headers.Vary = "Origin"
  }
  response.writeHead(status, headers)
  response.end(JSON.stringify(body))
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Operator command body is too large")
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (size === 0) {
    return {}
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Expected a JSON object")
    }
    return value
  } catch (cause) {
    const error = new Error("Operator command body must be a valid JSON object", { cause })
    error.status = 400
    throw error
  }
}

function normalizeFailure(result) {
  const error = result?.errors?.[0]
  return {
    ok: false,
    error: {
      code: error?.code ?? "HARVESTER_OPERATOR_COMMAND_FAILED",
      message: error?.message ?? "Harvester could not complete the operator request.",
    },
  }
}

function sendFailure({ response, status, code, message } = {}) {
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

async function handleReadRequest({ response, pathname, operator }) {
  const key = pathname.slice("/api/v1/trading/operator/".length)
  const method = READ_OPERATIONS[key]
  if (!method || typeof operator[method] !== "function") {
    sendFailure({
      response,
      status: 404,
      code: "HARVESTER_OPERATOR_QUERY_NOT_FOUND",
      message: "The requested operator query is not available.",
    })
    return
  }
  const result = await operator[method]({ actor: ACTOR })
  if (result?.ok !== true) {
    sendJson({
      response,
      status: 422,
      body: normalizeFailure(result),
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

function parseCommand({ body } = {}) {
  const command = typeof body.command === "string"
    ? body.command.trim().toLowerCase()
    : ""
  const configuration = COMMANDS[command]
  if (!configuration) {
    return {
      error: {
        status: 400,
        code: "HARVESTER_OPERATOR_COMMAND_INVALID",
        message: "Unknown operator command.",
      },
    }
  }
  const symbol = typeof body.symbol === "string"
    ? body.symbol.trim().toUpperCase()
    : ""
  if (configuration.requiresSymbol && !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)) {
    return {
      error: {
        status: 400,
        code: "HARVESTER_OPERATOR_SYMBOL_INVALID",
        message: "A valid market symbol is required.",
      },
    }
  }
  if (!configuration.requiresSymbol && body.symbol !== undefined) {
    return {
      error: {
        status: 400,
        code: "HARVESTER_OPERATOR_SCOPE_INVALID",
        message: "Global commands do not accept a market symbol.",
      },
    }
  }
  const requestId = typeof body.requestId === "string" && body.requestId.trim()
    ? body.requestId.trim()
    : `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return {
    configuration,
    requestId,
    ...(configuration.requiresSymbol ? { symbol } : {}),
  }
}

function validateCommandOrigin({ request, response } = {}) {
  const { origin } = request.headers
  if (!origin || isLocalDashboardOrigin(origin)) {
    return true
  }
  sendFailure({
    response,
    status: 403,
    code: "HARVESTER_OPERATOR_ORIGIN_FORBIDDEN",
    message: "Operator commands are only accepted from the local Dashboard.",
  })
  return false
}

function validateCommandContentType({ request, response } = {}) {
  const contentType = request.headers["content-type"]?.split(";")[0].trim()
  if (contentType === "application/json") {
    return true
  }
  sendFailure({
    response,
    status: 415,
    code: "HARVESTER_OPERATOR_CONTENT_TYPE_INVALID",
    message: "Operator commands require an application/json request body.",
  })
  return false
}

function handleCommandRequestError({ response, error } = {}) {
  const { status: errorStatus } = error
  const status = errorStatus ?? 500
  const code = status === 413
    ? "HARVESTER_OPERATOR_BODY_TOO_LARGE"
    : "HARVESTER_OPERATOR_REQUEST_INVALID"
  const message = status === 400 || status === 413
    ? error.message
    : "Operator request failed."
  sendFailure({
    response,
    status,
    code,
    message,
  })
}

async function handleCommandRequest({ request, response, operator }) {
  if (!validateCommandOrigin({
    request,
    response,
  }) || !validateCommandContentType({
    request,
    response,
  })) {
    return
  }
  try {
    const body = await readJsonBody(request)
    const parsed = parseCommand({ body })
    if (parsed.error) {
      sendFailure({
        response,
        status: parsed.error.status,
        code: parsed.error.code,
        message: parsed.error.message,
      })
      return
    }
    const result = await operator[parsed.configuration.method]({
      actor: ACTOR,
      requestId: parsed.requestId,
      ...(parsed.symbol ? { symbol: parsed.symbol } : {}),
    })
    if (result?.ok !== true) {
      sendJson({
        response,
        status: 422,
        body: normalizeFailure(result),
      })
      return
    }
    sendJson({
      response,
      status: 200,
      body: {
        ok: true,
        data: result.data ?? result,
      },
    })
  } catch (error) {
    handleCommandRequestError({
      response,
      error,
    })
  }
}

/**
 * Handle the local Dashboard operator API. This adapter only delegates to the
 * existing application facade; it never calls the broker or engine directly.
 */
export async function handleOperatorControlRequest({ request, response, pathname, operator } = {}) {
  if (!pathname?.startsWith("/api/v1/trading/operator/") || request.method === "OPTIONS") {
    return false
  }
  if (!operator) {
    sendFailure({
      response,
      status: 503,
      code: "HARVESTER_OPERATOR_UNAVAILABLE",
      message: "Operator controls are not available yet.",
    })
    return true
  }
  if (request.method === "GET") {
    await handleReadRequest({
      response,
      pathname,
      operator,
    })
    return true
  }
  if (request.method === "POST" && pathname === "/api/v1/trading/operator/commands") {
    await handleCommandRequest({
      request,
      response,
      operator,
    })
    return true
  }
  sendFailure({
    response,
    status: 405,
    code: "HARVESTER_OPERATOR_METHOD_NOT_ALLOWED",
    message: "Operator commands require POST.",
  })
  return true
}
