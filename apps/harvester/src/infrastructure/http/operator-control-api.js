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
  pause: Object.freeze({ method: "pauseMarket", requiresSymbol: true }),
  unpause: Object.freeze({ method: "resumeMarket", requiresSymbol: true }),
  pauseallbuys: Object.freeze({ method: "pauseAllBuys", requiresSymbol: false }),
  resumeallbuys: Object.freeze({ method: "resumeAllBuys", requiresSymbol: false }),
})

const MAX_BODY_BYTES = 8_192

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  })
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
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a JSON object")
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

/**
 * Handle the local Dashboard operator API. This adapter only delegates to the
 * existing application facade; it never calls the broker or engine directly.
 */
export async function handleOperatorControlRequest({ request, response, pathname, operator } = {}) {
  if (!pathname?.startsWith("/api/v1/trading/operator/") || request.method === "OPTIONS") return false

  if (!operator) {
    sendJson(response, 503, {
      ok: false,
      error: { code: "HARVESTER_OPERATOR_UNAVAILABLE", message: "Operator controls are not available yet." },
    })
    return true
  }

  if (request.method === "GET") {
    const key = pathname.slice("/api/v1/trading/operator/".length)
    const method = READ_OPERATIONS[key]
    if (!method || typeof operator[method] !== "function") {
      sendJson(response, 404, {
        ok: false,
        error: { code: "HARVESTER_OPERATOR_QUERY_NOT_FOUND", message: "The requested operator query is not available." },
      })
      return true
    }
    const result = await operator[method]({ actor: ACTOR })
    if (result?.ok !== true) {
      sendJson(response, 422, normalizeFailure(result))
      return true
    }
    sendJson(response, 200, { ok: true, data: result.data })
    return true
  }

  if (request.method !== "POST" || pathname !== "/api/v1/trading/operator/commands") {
    sendJson(response, 405, {
      ok: false,
      error: { code: "HARVESTER_OPERATOR_METHOD_NOT_ALLOWED", message: "Operator commands require POST." },
    })
    return true
  }

  const origin = request.headers.origin
  if (origin && origin !== "http://127.0.0.1:4200" && origin !== "http://localhost:4200") {
    sendJson(response, 403, {
      ok: false,
      error: { code: "HARVESTER_OPERATOR_ORIGIN_FORBIDDEN", message: "Operator commands are only accepted from the local Dashboard." },
    })
    return true
  }

  try {
    const body = await readJsonBody(request)
    const command = typeof body.command === "string" ? body.command.trim().toLowerCase() : ""
    const configuration = COMMANDS[command]
    if (!configuration) {
      sendJson(response, 400, {
        ok: false,
        error: { code: "HARVESTER_OPERATOR_COMMAND_INVALID", message: "Unknown operator command." },
      })
      return true
    }
    if (configuration.requiresSymbol && (typeof body.symbol !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(body.symbol.trim().toUpperCase()))) {
      sendJson(response, 400, {
        ok: false,
        error: { code: "HARVESTER_OPERATOR_SYMBOL_INVALID", message: "A valid market symbol is required." },
      })
      return true
    }
    if (!configuration.requiresSymbol && body.symbol !== undefined) {
      sendJson(response, 400, {
        ok: false,
        error: { code: "HARVESTER_OPERATOR_SCOPE_INVALID", message: "Global commands do not accept a market symbol." },
      })
      return true
    }
    const requestId = typeof body.requestId === "string" && body.requestId.trim()
      ? body.requestId.trim()
      : `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const result = await operator[configuration.method]({
      actor: ACTOR,
      requestId,
      ...(configuration.requiresSymbol ? { symbol: body.symbol.trim().toUpperCase() } : {}),
    })
    if (result?.ok !== true) {
      sendJson(response, 422, normalizeFailure(result))
      return true
    }
    sendJson(response, 200, { ok: true, data: result.data ?? result })
  } catch (error) {
    sendJson(response, error.status ?? 500, {
      ok: false,
      error: {
        code: error.status === 413 ? "HARVESTER_OPERATOR_BODY_TOO_LARGE" : "HARVESTER_OPERATOR_REQUEST_INVALID",
        message: error.status === 413 ? error.message : error.status === 400 ? error.message : "Operator request failed.",
      },
    })
  }
  return true
}
