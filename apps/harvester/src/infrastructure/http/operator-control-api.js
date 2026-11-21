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
const LOCAL_ORIGINS = new Set([
  "http://127.0.0.1:4200",
  "http://localhost:4200",
])

function sendJson(response, status, body) {
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

function sendFailure(response, status, code, message) {
  sendJson(response, status, {
    ok: false,
    error: {
      code,
      message,
    },
  })
}

async function handleReadRequest({ response, pathname, operator }) {
  const key = pathname.slice("/api/v1/trading/operator/".length)
  const method = READ_OPERATIONS[key]
  if (!method || typeof operator[method] !== "function") {
    sendFailure(
      response,
      404,
      "HARVESTER_OPERATOR_QUERY_NOT_FOUND",
      "The requested operator query is not available.",
    )
    return
  }
  const result = await operator[method]({ actor: ACTOR })
  if (result?.ok !== true) {
    sendJson(response, 422, normalizeFailure(result))
    return
  }
  sendJson(response, 200, {
    ok: true,
    data: result.data,
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

async function handleCommandRequest({ request, response, operator }) {
  const origin = request.headers.origin
  if (origin && !LOCAL_ORIGINS.has(origin)) {
    sendFailure(
      response,
      403,
      "HARVESTER_OPERATOR_ORIGIN_FORBIDDEN",
      "Operator commands are only accepted from the local Dashboard.",
    )
    return
  }
  try {
    const body = await readJsonBody(request)
    const parsed = parseCommand({ body })
    if (parsed.error) {
      sendFailure(
        response,
        parsed.error.status,
        parsed.error.code,
        parsed.error.message,
      )
      return
    }
    const result = await operator[parsed.configuration.method]({
      actor: ACTOR,
      requestId: parsed.requestId,
      ...(parsed.symbol ? { symbol: parsed.symbol } : {}),
    })
    if (result?.ok !== true) {
      sendJson(response, 422, normalizeFailure(result))
      return
    }
    sendJson(response, 200, {
      ok: true,
      data: result.data ?? result,
    })
  } catch (error) {
    const status = error.status ?? 500
    const code = status === 413
      ? "HARVESTER_OPERATOR_BODY_TOO_LARGE"
      : "HARVESTER_OPERATOR_REQUEST_INVALID"
    const message = status === 400 || status === 413
      ? error.message
      : "Operator request failed."
    sendFailure(response, status, code, message)
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
    sendFailure(
      response,
      503,
      "HARVESTER_OPERATOR_UNAVAILABLE",
      "Operator controls are not available yet.",
    )
    return true
  }
  if (request.method === "GET") {
    await handleReadRequest({ response, pathname, operator })
    return true
  }
  if (request.method === "POST" && pathname === "/api/v1/trading/operator/commands") {
    await handleCommandRequest({ request, response, operator })
    return true
  }
  sendFailure(
    response,
    405,
    "HARVESTER_OPERATOR_METHOD_NOT_ALLOWED",
    "Operator commands require POST.",
  )
  return true
}
