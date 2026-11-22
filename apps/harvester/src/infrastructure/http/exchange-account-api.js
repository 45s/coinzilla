const ROUTE = "/api/v1/exchanges/accounts"

function sendJson({ response, status, body } = {}) {
  if (response.destroyed || response.writableEnded) return
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

function sendFailure({ response, status, code, message } = {}) {
  sendJson({
    response,
    status,
    body: { ok: false, error: { code, message } },
  })
}

function resolveAccount({ exchangeAccounts, providerInstanceId } = {}) {
  return exchangeAccounts.find((account) => account.providerInstanceId === providerInstanceId)
}

function serializeAccountSnapshot(snapshot) {
  return {
    sourceTime: snapshot.sourceTime,
    balances: snapshot.balances.map((balance) => balance?.value ?? balance),
  }
}

function serializeOpenOrders(orders) {
  if (!Array.isArray(orders)) return []
  return orders.map((order) => order?.value ?? order)
}

function mapAccountMetadata(account) {
  return {
    providerInstanceId: account.providerInstanceId,
    providerType: account.providerType,
    accountId: account.accountId,
    environment: account.environment,
    connected: account.connected === true,
  }
}

/**
 * Read-only API over already-started Harvester provider runtimes.
 * It never constructs a broker, opens an exchange connection, or accepts mutations.
 */
export async function handleExchangeAccountRequest({
  request,
  response,
  pathname,
  exchangeAccounts = [],
} = {}) {
  if (pathname !== ROUTE && !pathname.startsWith(`${ROUTE}/`)) {
    return false
  }
  if (request.method !== "GET") {
    sendFailure({
      response,
      status: 405,
      code: "HARVESTER_EXCHANGE_METHOD_NOT_ALLOWED",
      message: "Exchange account monitoring supports GET requests only.",
    })
    return true
  }
  if (pathname === ROUTE) {
    sendJson({
      response,
      status: 200,
      body: {
        ok: true,
        data: exchangeAccounts.map(mapAccountMetadata),
      },
    })
    return true
  }
  const encodedId = pathname.slice(ROUTE.length + 1)
  let providerInstanceId
  try {
    providerInstanceId = decodeURIComponent(encodedId)
  } catch {
    sendFailure({
      response,
      status: 400,
      code: "HARVESTER_EXCHANGE_PROVIDER_ID_INVALID",
      message: "The provider account identifier is invalid.",
    })
    return true
  }
  if (!providerInstanceId || providerInstanceId.includes("/")) {
    sendFailure({
      response,
      status: 400,
      code: "HARVESTER_EXCHANGE_PROVIDER_ID_INVALID",
      message: "The provider account identifier is invalid.",
    })
    return true
  }
  const account = resolveAccount({ exchangeAccounts, providerInstanceId })
  if (!account) {
    sendFailure({
      response,
      status: 404,
      code: "HARVESTER_EXCHANGE_PROVIDER_NOT_FOUND",
      message: "This provider account is not active in Harvester.",
    })
    return true
  }
  try {
    const [snapshot, openOrders] = await Promise.all([
      account.readAccountSnapshot(),
      account.readOpenOrders(),
    ])
    if (snapshot?.ok !== true || openOrders?.ok !== true) {
      sendFailure({
        response,
        status: 502,
        code: "HARVESTER_EXCHANGE_ACCOUNT_READ_FAILED",
        message: "Harvester could not retrieve the current account snapshot.",
      })
      return true
    }
    sendJson({
      response,
      status: 200,
      body: {
        ok: true,
        data: {
          ...mapAccountMetadata(account),
          accountSnapshot: serializeAccountSnapshot(snapshot.data),
          openOrders: serializeOpenOrders(openOrders.data),
          observedAt: new Date().toISOString(),
        },
      },
    })
  } catch {
    sendFailure({
      response,
      status: 502,
      code: "HARVESTER_EXCHANGE_ACCOUNT_READ_FAILED",
      message: "Harvester could not retrieve the current account snapshot.",
    })
  }
  return true
}
