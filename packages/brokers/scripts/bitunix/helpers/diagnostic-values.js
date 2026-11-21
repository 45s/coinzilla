import { sanitizeDiagnosticValue, summarizePrivatePayload } from "./diagnostics.js"

export function getSecrets({ env }) {
  return [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean)
}

export function getMissingCredentialNames({ env }) {
  return ["BITUNIX_API_KEY", "BITUNIX_API_SECRET"].filter((key) =>
    typeof env[key] !== "string" || !env[key].trim())
}

export function hasCredentials({ env }) {
  return getMissingCredentialNames({ env }).length === 0
}

export function normalizeMessageText({ message }) {
  if (typeof message === "string") {
    return message
  }
  if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
    return new TextDecoder().decode(message)
  }
  throw new TypeError("Bitunix diagnostic received a non-text WebSocket message")
}

export function createInboundPayload({ response, method, secrets, includePublicPayloads }) {
  const isPrivate = ["user.account", "user.info", "order.pending.list", "order.history.page", "order.deal.list"].includes(method)
  let data
  if (isPrivate || !includePublicPayloads) {
    data = summarizePrivatePayload(response.data)
  } else {
    data = sanitizeDiagnosticValue({
      value: response.data,
      secrets,
    })
  }
  return {
    id: response.id,
    code: response.code,
    msg: sanitizeDiagnosticValue({
      value: response.msg,
      secrets,
    }),
    data,
  }
}

export function parseDepthPrecision({ value }) {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }
  const precision = Number(value)
  if (!Number.isFinite(precision) || precision < 0) {
    throw new RangeError("BITUNIX_DIAGNOSTICS_DEPTH_PRECISION must be a non-negative number")
  }
  return precision
}

export function createRestDiagnosticRequest({ endpoint, symbol, depthPrecision, klineInterval }) {
  const context = {
    symbol,
    depthPrecision,
    klineInterval,
  }
  let queryParams = endpoint.queryParams ?? {}
  if (endpoint.queryParams === null) {
    queryParams = { symbol }
  }
  if (endpoint.getQueryParams) {
    queryParams = endpoint.getQueryParams(context)
  }
  const body = endpoint.getBody?.(context)
  return {
    method: endpoint.method ?? "GET",
    path: endpoint.path,
    ...(body === undefined ? { queryParams } : { body }),
    authenticated: endpoint.privateResponse,
    stateChanging: false,
  }
}

export function getRestSkipReason({ endpoint, depthPrecision, credentialsConfigured }) {
  if (endpoint.requiresDepthPrecision && depthPrecision === null) {
    return {
      authenticated: false,
      reason: "BITUNIX_DIAGNOSTICS_DEPTH_PRECISION is required for the documented depth endpoint",
    }
  }
  if (endpoint.privateResponse && !credentialsConfigured) {
    return {
      authenticated: true,
      reason: "BITUNIX_API_KEY and BITUNIX_API_SECRET are required for private REST diagnostics",
    }
  }
  return null
}

export function getDiagnosticSchemaIssues({ inspection }) {
  const issues = []
  if (inspection.unexpectedValueType) {
    issues.push("unexpected_value_type")
  }
  if (inspection.missingRequiredFields.length > 0) {
    issues.push("missing_required_fields")
  }
  if (inspection.unexpectedFieldTypes.length > 0) {
    issues.push("unexpected_field_types")
  }
  if (inspection.invalidRowIndexes.length > 0) {
    issues.push("invalid_rows")
  }
  return issues
}

export function createBrokerApiRequest({
      method,
      args,
    }) {
  return {
    api: "Broker",
    method,
    params: args[0] ?? {},
    stateChanging: false,
  }
}

export function getBrokerApiOperations({ symbol, credentialsConfigured }) {
  const operations = [
    {
      method: "getExchangeMarkets",
      args: [],
      privateResponse: false,
    },
    {
      method: "getPrices",
      args: [{ symbol }],
      privateResponse: false,
    },
    {
      method: "getSymbolFilters",
      args: [{ symbol }],
      privateResponse: false,
    },
  ]
  if (credentialsConfigured) {
    operations.push(
      {
        method: "getBalances",
        args: [],
        privateResponse: true,
      },
      {
        method: "getOpenOrders",
        args: [{ symbol }],
        privateResponse: true,
      },
      {
        method: "getOrderHistory",
        args: [{
          symbol,
          page: 1,
          limit: 10,
        }],
        privateResponse: true,
      },
      {
        method: "getDeposits",
        args: [{
          limit: 1,
        }],
        privateResponse: true,
      },
      {
        method: "getWithdrawalHistory",
        args: [{
          limit: 1,
        }],
        privateResponse: true,
      },
    )
  }
  return operations
}
