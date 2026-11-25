const API_PREFIX = "/api/v1/scenario-runner"
const MAX_REQUEST_BYTES = 64 * 1024
const ALLOWED_BROWSER_ORIGINS = new Set([
  "http://127.0.0.1:4200",
  "http://localhost:4200",
])

function sendJson({ response, status, body }) {
  if (response.destroyed || response.writableEnded) {
    return
  }
  response.writeHead(status, {
    ...(response.scenarioRunnerOrigin
      ? {
        "Access-Control-Allow-Origin": response.scenarioRunnerOrigin,
        Vary: "Origin",
      }
      : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  })
  response.end(JSON.stringify(body))
}


function rejectUntrustedOrigin({ request, response }) {
  const origin = request.headers?.origin
  if (origin === undefined || (typeof origin === "string" && ALLOWED_BROWSER_ORIGINS.has(origin))) {
    return false
  }
  sendError({
    response,
    status: 403,
    code: "SCENARIO_RUNNER_ORIGIN_FORBIDDEN",
    message: "Scenario Runner requests from this browser origin are not allowed.",
  })
  return true
}

function resolveErrorCode({ error }) {
  if (typeof error?.code === "string" && error.code.trim()) {
    return error.code
  }
  return "SCENARIO_RUNNER_REQUEST_INVALID"
}

function sendError({ response, status, code, message }) {
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

async function readBody({ request }) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_REQUEST_BYTES) {
      throw Object.assign(new Error("Request body exceeds the 64 KiB limit."), { status: 413 })
    }
    chunks.push(chunk)
  }
  if (!chunks.length) {
    return {}
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TypeError()
    }
    return body
  } catch {
    throw Object.assign(new Error("Request body must be a JSON object."), { status: 400 })
  }
}

function resolveRunId({ pathname }) {
  const match = pathname.match(/^\/api\/v1\/scenario-runner\/runs\/([^/]+)(?:\/cancel)?$/)
  if (!match) {
    return null
  }
  try {
    const runId = decodeURIComponent(match[1])
    if (!runId || runId.trim() !== runId || runId.length > 256) {
      return null
    }
    return runId
  } catch {
    return null
  }
}

function handleOptions({ response }) {
  response.writeHead(204, {
    ...(response.scenarioRunnerOrigin
      ? {
        "Access-Control-Allow-Origin": response.scenarioRunnerOrigin,
        Vary: "Origin",
      }
      : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  })
  response.end()
}

function handleCatalog({ response, catalog }) {
  sendJson({
    response,
    status: 200,
    body: {
      ok: true,
      data: catalog,
    },
  })
}

function handleHistory({ response, runner }) {
  sendJson({
    response,
    status: 200,
    body: {
      ok: true,
      data: runner.listRuns?.() ?? [],
    },
  })
}

async function handleSubmit({ request, response, runner }) {
  const body = await readBody({ request })
  const run = runner.submit(body)
  sendJson({
    response,
    status: run.status === "Blocked" ? 409 : 202,
    body: {
      ok: true,
      data: run,
    },
  })
}

function handleRunDetail({ response, runner, runId }) {
  const run = runner.getRun(runId)
  if (!run) {
    sendError({
      response,
      status: 404,
      code: "SCENARIO_RUN_NOT_FOUND",
      message: "Scenario run does not exist.",
    })
    return
  }
  sendJson({
    response,
    status: 200,
    body: {
      ok: true,
      data: run,
    },
  })
}

function handleCancel({ response, runner, runId }) {
  const accepted = runner.cancel(runId)
  sendJson({
    response,
    status: accepted ? 202 : 409,
    body: {
      ok: true,
      data: {
        runId,
        accepted,
      },
    },
  })
}

function handleUnknownRoute({ response }) {
  sendError({
    response,
    status: 404,
    code: "SCENARIO_RUNNER_ROUTE_NOT_FOUND",
    message: "Scenario Runner resource not found.",
  })
}

function handleMethod({ request, pathname, response, runner, catalog }) {
  if (request.method === "GET" && pathname === `${API_PREFIX}/catalog`) {
    handleCatalog({
      response,
      catalog,
    })
    return true
  }
  if (request.method === "GET" && pathname === `${API_PREFIX}/runs`) {
    handleHistory({
      response,
      runner,
    })
    return true
  }
  return false
}

async function handleRunRoute({ request, response, pathname, runner }) {
  if (request.method === "POST" && pathname === `${API_PREFIX}/runs`) {
    await handleSubmit({
      request,
      response,
      runner,
    })
    return true
  }
  const runId = resolveRunId({ pathname })
  if (runId && request.method === "GET" && pathname.endsWith(runId)) {
    handleRunDetail({
      response,
      runner,
      runId,
    })
    return true
  }
  if (runId && request.method === "POST" && pathname.endsWith("/cancel")) {
    handleCancel({
      response,
      runner,
      runId,
    })
    return true
  }
  return false
}

export async function handleScenarioRunnerRequest({
  request,
  response,
  pathname,
  runner,
  catalog = [],
} = {}) {
  if (!pathname.startsWith(API_PREFIX)) {
    return false
  }
  if (rejectUntrustedOrigin({ request, response })) {
    return true
  }
  if (request.method === "OPTIONS") {
    handleOptions({ response })
    return true
  }
  if (!runner || typeof runner.submit !== "function" || typeof runner.getRun !== "function") {
    sendError({
      response,
      status: 503,
      code: "SCENARIO_RUNNER_UNAVAILABLE",
      message: "Scenario Runner is not configured.",
    })
    return true
  }
  try {
    if (handleMethod({
      request,
      pathname,
      response,
      runner,
      catalog,
    })) {
      return true
    }
    if (await handleRunRoute({
      request,
      response,
      pathname,
      runner,
    })) {
      return true
    }
    handleUnknownRoute({ response })
    return true
  } catch (error) {
    sendError({
      response,
      status: Number.isSafeInteger(error?.status) ? error.status : 400,
      code: resolveErrorCode({ error }),
      message: error instanceof Error ? error.message : "Scenario Runner request failed.",
    })
    return true
  }
}
