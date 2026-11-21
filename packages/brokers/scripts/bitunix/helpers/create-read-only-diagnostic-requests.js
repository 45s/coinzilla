export function parseDiagnosticDepthPrecision({ value }) {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }
  const precision = Number(value)
  if (!Number.isFinite(precision) || precision < 0) {
    throw new RangeError("BITUNIX_DIAGNOSTICS_DEPTH_PRECISION must be a non-negative number")
  }
  return precision
}

export function createReadOnlyRestRequest({ endpoint, symbol, depthPrecision, klineInterval }) {
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

export function getRestDiagnosticSkipReason({ endpoint, depthPrecision, credentialsConfigured }) {
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

export function createReadOnlyBrokerRequest({ method, args }) {
  return {
    api: "Broker",
    method,
    params: args[0] ?? {},
    stateChanging: false,
  }
}

export function getReadOnlyBrokerOperations({ symbol, credentialsConfigured }) {
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
