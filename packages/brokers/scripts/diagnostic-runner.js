import { Broker } from "../src/index.js"
import { BitunixRestClient } from "../src/infrastructure/bitunix/api/rest-client.js"
import { BitunixSpotWebSocketClient } from "../src/infrastructure/bitunix/api/websocket-client.js"
import { BitunixWebSocketTransport } from "../src/infrastructure/bitunix/api/websocket-transport.js"
import {
  createDiagnosticReport,
  inspectDiagnosticSchema,
  createDiagnosticResult,
  sanitizeDiagnosticError,
  sanitizeDiagnosticValue,
  summarizePrivatePayload,
} from "./diagnostics.js"

const DIAGNOSTIC_CONFIG = Object.freeze({
  confirmLiveReads: true,
  symbol: "BTCUSDT",
  // REST Spot uses numeric minute intervals; WebSocket RPC documents the "1min" form and base-coin symbol.
  klineInterval: "1",
  websocketKlineSymbol: "BTC",
  websocketKlineInterval: "1",
  timeoutMs: 10_000,
  includePublicPayloads: false,
})


const BITUNIX_RESPONSE_SCHEMAS = Object.freeze({
  "/api/spot/v1/common/coin_pair/list": Object.freeze({
    expectedFields: ["base", "quote", "isOpen", "symbol", "minPrice", "minVolume", "basePrecision", "quotePrecision", "precisions"],
    requiredFields: ["base", "quote", "isOpen"],
    expectedFieldTypes: {
      base: "string",
      quote: "string",
      isOpen: ["string", "number"],
      symbol: "string",
      minPrice: "string",
      minVolume: "string",
      basePrecision: ["string", "number"],
      quotePrecision: ["string", "number"],
      precisions: "array",
    },
  }),
  "/api/spot/v1/market/last_price": Object.freeze({
    expectedValueTypes: ["string"],
  }),
  "/api/spot/v1/user/account": Object.freeze({
    expectedFields: ["coin", "balance", "balanceLocked"],
    requiredFields: ["coin", "balance", "balanceLocked"],
    expectedFieldTypes: {
      coin: "string",
      balance: "string",
      balanceLocked: "string",
    },
  }),
  "/api/spot/v1/order/pending/list": Object.freeze({
    expectedFields: ["orderId", "symbol", "side", "type", "status", "volume", "dealVolume", "price", "avgPrice", "ctime", "utime"],
    requiredFields: ["orderId", "symbol", "side", "type", "status", "volume", "dealVolume", "ctime", "utime"],
    expectedFieldTypes: {
      orderId: ["string", "number"],
      symbol: "string",
      side: ["string", "number"],
      type: ["string", "number"],
      status: ["string", "number"],
      volume: "string",
      dealVolume: "string",
      price: "string",
      avgPrice: "string",
      ctime: "string",
      utime: "string",
    },
  }),
})

const PUBLIC_ONLY_DIAGNOSTIC_CREDENTIAL = "READ_ONLY_PUBLIC_DIAGNOSTIC"

const REST_ENDPOINTS = Object.freeze([
  {
    operation: "REST public market catalog",
    path: "/api/spot/v1/common/coin_pair/list",
    privateResponse: false,
    queryParams: {},
  },
  {
    operation: "REST public last price",
    path: "/api/spot/v1/market/last_price",
    privateResponse: false,
    queryParams: null,
  },
  {
    operation: "REST public order book depth",
    path: "/api/spot/v1/market/depth",
    privateResponse: false,
    requiresDepthPrecision: true,
    getQueryParams: ({ symbol, depthPrecision }) => ({
      symbol,
      precision: depthPrecision,
    }),
  },
  {
    operation: "REST public K-line",
    path: "/api/spot/v1/market/kline",
    privateResponse: false,
    getQueryParams: ({ symbol, klineInterval }) => ({
      symbol,
      interval: klineInterval,
    }),
  },
  {
    operation: "REST public K-line history",
    path: "/api/spot/v1/market/kline/history",
    privateResponse: false,
    getQueryParams: ({ symbol, klineInterval }) => ({
      symbol,
      interval: klineInterval,
      limit: "1",
    }),
  },
  {
    operation: "REST public exchange rates",
    path: "/api/spot/v1/common/rate/list",
    privateResponse: false,
    queryParams: {},
  },
  {
    operation: "REST public token networks",
    path: "/api/spot/v1/common/coin/coin_network/list",
    privateResponse: false,
    queryParams: {},
  },
  {
    operation: "REST private account balances",
    path: "/api/spot/v1/user/account",
    privateResponse: true,
    queryParams: {},
  },
  {
    operation: "REST private open orders",
    path: "/api/spot/v1/order/pending/list",
    method: "POST",
    privateResponse: true,
    getBody: ({ symbol }) => ({
      symbol,
    }),
  },
])

const WEBSOCKET_OPERATIONS = Object.freeze([
  {
    operation: "ping",
    method: "ping",
    privateResponse: false,
    getArguments: () => ({}),
  },
  {
    operation: "market.last_price",
    method: "getLastPrice",
    privateResponse: false,
    getArguments: ({ symbol }) => ({ symbol }),
  },
  {
    operation: "market.depth",
    method: "getDepth",
    privateResponse: false,
    getArguments: ({ symbol, depthPrecision }) => ({
      symbol,
      precision: depthPrecision,
    }),
    requiresDepthPrecision: true,
  },
  {
    operation: "market.kline",
    method: "getKline",
    privateResponse: false,
    getArguments: ({ websocketKlineSymbol, websocketKlineInterval }) => ({
      symbol: websocketKlineSymbol,
      interval: websocketKlineInterval,
    }),
  },
  {
    operation: "common.coin_pair.list",
    method: "getTradingPairs",
    privateResponse: false,
    getArguments: () => ({}),
  },
  {
    operation: "common.rate.list",
    method: "getExchangeRates",
    privateResponse: false,
    getArguments: () => ({}),
  },
  {
    operation: "common.coin.coin_network.list",
    method: "getTokenNetworks",
    privateResponse: false,
    getArguments: () => ({}),
  },
  {
    operation: "user.account",
    method: "getAccount",
    privateResponse: true,
    getArguments: () => ({}),
  },
  {
    operation: "user.info",
    method: "getUserInfo",
    privateResponse: true,
    getArguments: () => ({}),
  },
  {
    operation: "order.pending.list",
    method: "getOpenOrders",
    privateResponse: true,
    getArguments: ({ symbol }) => ({ symbol }),
  },
  {
    operation: "order.history.page",
    method: "getOrderHistory",
    privateResponse: true,
    getArguments: ({ symbol }) => ({
      symbol,
      page: 1,
      pageSize: 1,
    }),
  },
])

function emitProgress({ onProgress, area, operation, status }) {
  onProgress?.({ message: `      ${area}: ${operation} ... ${status}` })
}

function getSecrets({ env }) {
  return [env.BITUNIX_API_KEY, env.BITUNIX_API_SECRET].filter(Boolean)
}

function getMissingCredentialNames({ env }) {
  return ["BITUNIX_API_KEY", "BITUNIX_API_SECRET"].filter((key) =>
    typeof env[key] !== "string" || !env[key].trim())
}

function hasCredentials({ env }) {
  return getMissingCredentialNames({ env }).length === 0
}

function normalizeMessageText({ message }) {
  if (typeof message === "string") {
    return message
  }
  if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
    return new TextDecoder().decode(message)
  }
  throw new TypeError("Bitunix diagnostic received a non-text WebSocket message")
}

function createObservedConnect({ transport, events, secrets, now }) {
  return async () => {
    events.push({
      timestamp: new Date(now()).toISOString(),
      type: "connect_started",
    })
    try {
      await transport.connect()
      events.push({
        timestamp: new Date(now()).toISOString(),
        type: "connected",
      })
    } catch (error) {
      events.push({
        timestamp: new Date(now()).toISOString(),
        type: "connect_error",
        error: sanitizeDiagnosticError({
          error,
          secrets,
        }),
      })
      throw error
    }
  }
}

function createObservedSend({ transport, events, secrets, now, methodsByRequestId }) {
  return (message) => {
    let request
    try {
      request = JSON.parse(message)
    } catch (error) {
      events.push({
        timestamp: new Date(now()).toISOString(),
        type: "outbound_parse_error",
        error: sanitizeDiagnosticError({
          error,
          secrets,
        }),
      })
      throw error
    }
    methodsByRequestId.set(String(request.id), request.method)
    events.push({
      timestamp: new Date(now()).toISOString(),
      direction: "outbound",
      method: request.method,
      requestId: request.id,
      payload: sanitizeDiagnosticValue({
        value: request,
        secrets,
      }),
    })
    transport.send(message)
  }
}

function createInboundPayload({ response, method, secrets, includePublicPayloads }) {
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

function createObservedMessageHandler({ transport, events, secrets, now, methodsByRequestId, includePublicPayloads }) {
  return (listener) => transport.onMessage((message) => {
    let response
    try {
      response = JSON.parse(normalizeMessageText({ message }))
    } catch (error) {
      events.push({
        timestamp: new Date(now()).toISOString(),
        direction: "inbound",
        type: "invalid_json",
        error: sanitizeDiagnosticError({
          error,
          secrets,
        }),
      })
      listener(message)
      return
    }
    const method = methodsByRequestId.get(String(response.id)) ?? "unknown"
    events.push({
      timestamp: new Date(now()).toISOString(),
      direction: "inbound",
      method,
      requestId: response.id,
      payload: createInboundPayload({
        response,
        method,
        secrets,
        includePublicPayloads,
      }),
    })
    listener(message)
  })
}

function createObservedErrorHandler({ transport, events, secrets, now }) {
  return (listener) => transport.onError((error) => {
    events.push({
      timestamp: new Date(now()).toISOString(),
      type: "transport_error",
      error: sanitizeDiagnosticError({
          error,
          secrets,
        }),
    })
    listener(error)
  })
}

function createObservedCloseHandler({ transport, events, secrets, now }) {
  return (listener) => transport.onClose((event) => {
    events.push({
      timestamp: new Date(now()).toISOString(),
      type: "closed",
      close: sanitizeDiagnosticValue({
        value: {
          code: event?.code,
          reason: event?.reason,
          wasClean: event?.wasClean,
        },
        secrets,
      }),
    })
    listener(event)
  })
}

export function createObservedTransportFactory({
  events,
  secrets,
  includePublicPayloads,
  now,
  transportFactory = (options) => new BitunixWebSocketTransport(options),
}) {
  return (options) => {
    const transport = transportFactory(options)
    const methodsByRequestId = new Map()
    return {
      connect: createObservedConnect({
        transport,
        events,
        secrets,
        now,
      }),
      send: createObservedSend({
        transport,
        events,
        secrets,
        now,
        methodsByRequestId,
      }),
      onMessage: createObservedMessageHandler({
        transport,
        events,
        secrets,
        now,
        methodsByRequestId,
        includePublicPayloads,
      }),
      onError: createObservedErrorHandler({
        transport,
        events,
        secrets,
        now,
      }),
      onClose: createObservedCloseHandler({
        transport,
        events,
        secrets,
        now,
      }),
      close: () => transport.close(),
    }
  }
}

function parseDepthPrecision({ value }) {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }
  const precision = Number(value)
  if (!Number.isFinite(precision) || precision < 0) {
    throw new RangeError("BITUNIX_DIAGNOSTICS_DEPTH_PRECISION must be a non-negative number")
  }
  return precision
}

function createResult({
  operation,
  startedAt,
  now,
  status,
  request,
  response,
  error,
  privateResponse,
  includePublicPayloads,
  secrets,
}) {
  return createDiagnosticResult({
    operation,
    status,
    durationMs: now() - startedAt,
    request,
    response,
    error,
    privateResponse,
    includePublicPayload: includePublicPayloads,
    secrets,
  })
}

function createRestDiagnosticRequest({ endpoint, symbol, depthPrecision, klineInterval }) {
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

function recordRestSkipped({ endpoint, startedAt, now, results, secrets, authenticated, reason }) {
  results.push(createResult({
    operation: endpoint.operation,
    startedAt,
    now,
    status: "skipped",
    request: {
      method: endpoint.method ?? "GET",
      path: endpoint.path,
      authenticated,
      stateChanging: false,
      reason,
    },
    secrets,
  }))
}

function recordRestSuccess({ endpoint, startedAt, now, results, request, response, includePublicPayloads, secrets }) {
  results.push(createResult({
    operation: endpoint.operation,
    startedAt,
    now,
    status: "passed",
    request,
    response: response.data,
    privateResponse: endpoint.privateResponse,
    includePublicPayloads,
    secrets,
  }))
}

function recordRestFailure({ endpoint, startedAt, now, results, request, error, includePublicPayloads, secrets }) {
  results.push(createResult({
    operation: endpoint.operation,
    startedAt,
    now,
    status: "failed",
    request,
    error,
    includePublicPayloads,
    secrets,
  }))
}

function getRestSkipReason({ endpoint, depthPrecision, credentialsConfigured }) {
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

async function executeRestRequest({
  client,
  endpoint,
  startedAt,
  now,
  results,
  request,
  includePublicPayloads,
  secrets,
  onProgress,
}) {
  try {
    const response = await client.request(request)
    recordRestSuccess({
      endpoint,
      startedAt,
      now,
      results,
      request,
      response,
      includePublicPayloads,
      secrets,
    })
    emitProgress({
      onProgress,
      area: "REST",
      operation: endpoint.operation,
      status: "PASS",
    })
  } catch (error) {
    recordRestFailure({
      endpoint,
      startedAt,
      now,
      results,
      request,
      error,
      includePublicPayloads,
      secrets,
    })
    emitProgress({
      onProgress,
      area: "REST",
      operation: endpoint.operation,
      status: "FAIL",
    })
  }
}

async function runRestOperation({
  client,
  endpoint,
  symbol,
  depthPrecision,
  klineInterval,
  now,
  results,
  secrets,
  includePublicPayloads,
  credentialsConfigured,
  onProgress,
}) {
  const startedAt = now()
  emitProgress({
    onProgress,
    area: "REST",
    operation: endpoint.operation,
    status: "RUNNING",
  })
  const skipReason = getRestSkipReason({
    endpoint,
    depthPrecision,
    credentialsConfigured,
  })
  if (skipReason) {
    recordRestSkipped({
      endpoint,
      startedAt,
      now,
      results,
      secrets,
      ...skipReason,
    })
    emitProgress({
      onProgress,
      area: "REST",
      operation: endpoint.operation,
      status: "SKIPPED",
    })
    return
  }
  const request = createRestDiagnosticRequest({
    endpoint,
    symbol,
    depthPrecision,
    klineInterval,
  })
  await executeRestRequest({
    client,
    endpoint,
    startedAt,
    now,
    results,
    request,
    includePublicPayloads,
    secrets,
    onProgress,
  })
}

async function runRestChecks({
  env,
  requestTimeout,
  symbol,
  depthPrecision,
  klineInterval,
  now,
  results,
  secrets,
  includePublicPayloads,
  credentialsConfigured,
  restClientFactory,
  onProgress,
}) {
  const client = restClientFactory({
    apiKey: credentialsConfigured ? env.BITUNIX_API_KEY : undefined,
    apiSecret: credentialsConfigured ? env.BITUNIX_API_SECRET : undefined,
    requestTimeout,
  })
  for (const endpoint of REST_ENDPOINTS) {
    await runRestOperation({
      client,
      endpoint,
      symbol,
      depthPrecision,
      klineInterval,
      now,
      results,
      secrets,
      includePublicPayloads,
      credentialsConfigured,
      onProgress,
    })
  }
}

function recordWebSocketSkippedOperation({ definition, startedAt, now, results, includePublicPayloads, secrets }) {
  results.push(createResult({
    operation: definition.operation,
    startedAt,
    now,
    status: "skipped",
    request: {
      method: definition.operation,
      reason: "BITUNIX_DIAGNOSTICS_DEPTH_PRECISION is not configured",
    },
    includePublicPayloads,
    secrets,
  }))
}

async function executeWebSocketRequest({
  client,
  definition,
  args,
  startedAt,
  now,
  results,
  secrets,
  includePublicPayloads,
  onProgress,
}) {
  try {
    const response = await client[definition.method](args)
    results.push(createResult({
      operation: definition.operation,
      startedAt,
      now,
      status: "passed",
      request: {
        method: definition.operation,
        params: args,
      },
      response,
      privateResponse: definition.privateResponse,
      includePublicPayloads,
      secrets,
    }))
    emitProgress({
      onProgress,
      area: "WebSocket",
      operation: definition.operation,
      status: "PASS",
    })
  } catch (error) {
    results.push(createResult({
      operation: definition.operation,
      startedAt,
      now,
      status: "failed",
      request: {
        method: definition.operation,
        params: args,
      },
      error,
      includePublicPayloads,
      secrets,
    }))
    emitProgress({
      onProgress,
      area: "WebSocket",
      operation: definition.operation,
      status: "FAIL",
    })
  }
}

async function runWebSocketOperation({
  client,
  definition,
  context,
  now,
  results,
  secrets,
  includePublicPayloads,
  onProgress,
}) {
  const startedAt = now()
  emitProgress({
    onProgress,
    area: "WebSocket",
    operation: definition.operation,
    status: "RUNNING",
  })
  if (definition.requiresDepthPrecision && context.depthPrecision === null) {
    recordWebSocketSkippedOperation({
      definition,
      startedAt,
      now,
      results,
      includePublicPayloads,
      secrets,
    })
    emitProgress({
      onProgress,
      area: "WebSocket",
      operation: definition.operation,
      status: "SKIPPED",
    })
    return
  }
  await executeWebSocketRequest({
    client,
    definition,
    args: definition.getArguments(context),
    startedAt,
    now,
    results,
    secrets,
    includePublicPayloads,
    onProgress,
  })
}

function createRuntimeMetadata() {
  return {
    node: process.version,
    platform: process.platform,
    symbol: DIAGNOSTIC_CONFIG.symbol,
    restEndpoint: "https://openapi.bitunix.com",
    websocketEndpoint: "wss://openapi.bitunix.com:443/ws-api/v1",
    websocketMode: "authenticated request/response RPC; no documented continuous Spot subscription",
  }
}

function createSafetyConfirmationResult({ startedAt, now, secrets }) {
  return createResult({
    operation: "diagnostic safety confirmation",
    startedAt,
    now,
    status: DIAGNOSTIC_CONFIG.confirmLiveReads === true ? "passed" : "failed",
    ...(DIAGNOSTIC_CONFIG.confirmLiveReads === true ? {} : {
      error: new Error("Set DIAGNOSTIC_CONFIG.confirmLiveReads to true to confirm read-only requests against the configured LIVE Spot API account"),
    }),
    secrets,
  })
}

function createConfigurationResult({ env, startedAt, now, secrets }) {
  const missingCredentialVariables = getMissingCredentialNames({ env })
  const credentialsConfigured = missingCredentialVariables.length === 0
  return createResult({
    operation: "diagnostic configuration",
    startedAt,
    now,
    status: "passed",
    response: {
      credentialsConfigured,
      privateChecks: credentialsConfigured ? "enabled" : "skipped",
      missingCredentialVariables,
      liveReadConfirmation: DIAGNOSTIC_CONFIG.confirmLiveReads,
    },
    includePublicPayloads: true,
    secrets,
  })
}

function createReport({ startedAtIso, now, results, events, schemaObservations = [] }) {
  return createDiagnosticReport({
    startedAt: startedAtIso,
    finishedAt: new Date(now()).toISOString(),
    runtime: createRuntimeMetadata(),
    results,
    events,
    schemaObservations,
  })
}

function createOptionFailure({ error, startedAtIso, now, results, events, secrets }) {
  results.push(createResult({
    operation: "diagnostic options",
    startedAt: now(),
    now,
    status: "failed",
    error,
    secrets,
  }))
  return createReport({
    startedAtIso,
    now,
    results,
    events,
  })
}

function createWebSocketClient({ env, requestTimeout, transportFactory, websocketClientFactory }) {
  return websocketClientFactory({
    apiKey: env.BITUNIX_API_KEY,
    apiSecret: env.BITUNIX_API_SECRET,
    requestTimeout,
    connectTimeout: requestTimeout,
    closeTimeout: requestTimeout,
    transportFactory,
  })
}

function recordWebSocketConnectionFailure({ error, now, results, secrets }) {
  results.push(createResult({
    operation: "WebSocket connection",
    startedAt: now(),
    now,
    status: "failed",
    error,
    secrets,
  }))
  for (const definition of WEBSOCKET_OPERATIONS) {
    results.push(createResult({
      operation: definition.operation,
      startedAt: now(),
      now,
      status: "skipped",
      error: new Error("WebSocket RPC skipped because connection setup failed"),
      secrets,
    }))
  }
}

async function executeWebSocketOperations({
  client,
  symbol,
  depthPrecision,
  now,
  results,
  secrets,
  includePublicPayloads,
  onProgress,
}) {
  const context = {
    symbol,
    depthPrecision,
    websocketKlineSymbol: DIAGNOSTIC_CONFIG.websocketKlineSymbol,
    websocketKlineInterval: DIAGNOSTIC_CONFIG.websocketKlineInterval,
  }
  for (const definition of WEBSOCKET_OPERATIONS) {
    await runWebSocketOperation({
      client,
      definition,
      context,
      now,
      results,
      secrets,
      includePublicPayloads,
      onProgress,
    })
  }
}

async function cleanupWebSocket({ client, isConnected, now, results, events, secrets }) {
  try {
    await client.disconnect()
    events.push({
      timestamp: new Date(now()).toISOString(),
      type: "client_disconnected",
      wasConnected: isConnected,
    })
  } catch (error) {
    results.push(createResult({
      operation: "WebSocket cleanup",
      startedAt: now(),
      now,
      status: "failed",
      error,
      secrets,
    }))
  }
}

async function connectWebSocket({ client, now, results, secrets, onProgress }) {
  const startedAt = now()
  onProgress?.({ message: "      WebSocket: connecting authenticated Spot RPC ... RUNNING" })
  try {
    await client.connect()
    results.push(createResult({
      operation: "WebSocket connection",
      startedAt,
      now,
      status: "passed",
      response: { state: client.state },
      secrets,
    }))
    onProgress?.({ message: "      WebSocket: connection ... PASS" })
    return true
  } catch (error) {
    recordWebSocketConnectionFailure({
      error,
      now,
      results,
      secrets,
    })
    onProgress?.({ message: "      WebSocket: connection ... FAIL" })
    return false
  }
}

function createConfiguredWebSocketClient({
  env,
  requestTimeout,
  events,
  secrets,
  includePublicPayloads,
  now,
  websocketClientFactory,
}) {
  const transportFactory = createObservedTransportFactory({
    events,
    secrets,
    includePublicPayloads,
    now,
  })
  return createWebSocketClient({
    env,
    requestTimeout,
    transportFactory,
    websocketClientFactory,
  })
}

async function runWebSocketSession({
  client,
  symbol,
  depthPrecision,
  now,
  results,
  events,
  secrets,
  includePublicPayloads,
  onProgress,
}) {
  const isConnected = await connectWebSocket({
    client,
    now,
    results,
    secrets,
    onProgress,
  })
  try {
    if (isConnected) {
      await executeWebSocketOperations({
        client,
        symbol,
        depthPrecision,
        now,
        results,
        secrets,
        includePublicPayloads,
        onProgress,
      })
    }
  } finally {
    await cleanupWebSocket({
      client,
      isConnected,
      now,
      results,
      events,
      secrets,
    })
  }
  return isConnected
}

async function recordWebSocketReconnectPing({
  client,
  startedAt,
  now,
  results,
  secrets,
  includePublicPayloads,
}) {
  const pingResponse = await client.ping()
  results.push(createResult({
    operation: "WebSocket reconnect",
    startedAt,
    now,
    status: "passed",
    request: {
      method: "ping",
      attempt: 1,
    },
    response: {
      state: client.state,
      pingResponse,
    },
    includePublicPayloads,
    secrets,
  }))
}

function recordWebSocketReconnectFailure({ error, startedAt, now, results, secrets }) {
  results.push(createResult({
    operation: "WebSocket reconnect",
    startedAt,
    now,
    status: "failed",
    request: {
      method: "ping",
      attempt: 1,
    },
    error,
    secrets,
  }))
}

async function runWebSocketReconnectCheck({
  client,
  events,
  secrets,
  includePublicPayloads,
  now,
  results,
}) {
  const startedAt = now()
  let isConnected = false
  try {
    await client.connect()
    isConnected = true
    await recordWebSocketReconnectPing({
      client,
      startedAt,
      now,
      results,
      secrets,
      includePublicPayloads,
    })
  } catch (error) {
    recordWebSocketReconnectFailure({
      error,
      startedAt,
      now,
      results,
      secrets,
    })
  } finally {
    await cleanupWebSocket({
      client,
      isConnected,
      now,
      results,
      events,
      secrets,
    })
  }
  recordWebSocketSubscriptionSkipped({
    now,
    results,
    secrets,
  })
}

function recordWebSocketReconnectSkipped({ now, results, secrets, reason }) {
  results.push(createResult({
    operation: "WebSocket reconnect",
    startedAt: now(),
    now,
    status: "skipped",
    request: { reason },
    secrets,
  }))
}

function recordWebSocketSubscriptionSkipped({ now, results, secrets }) {
  results.push(createResult({
    operation: "WebSocket subscription restoration",
    startedAt: now(),
    now,
    status: "skipped",
    request: {
      reason: "Bitunix Spot documents authenticated request/response RPC methods, not subscriptions; there is no subscription state to restore",
    },
    secrets,
  }))
}

function recordWebSocketSkipped({ now, results, secrets }) {
  const reason = "BITUNIX_API_KEY and BITUNIX_API_SECRET are required for authenticated WebSocket RPC diagnostics"
  results.push(createResult({
    operation: "WebSocket connection",
    startedAt: now(),
    now,
    status: "skipped",
    request: { reason },
    secrets,
  }))
  for (const definition of WEBSOCKET_OPERATIONS) {
    results.push(createResult({
      operation: definition.operation,
      startedAt: now(),
      now,
      status: "skipped",
      request: {
        method: definition.operation,
        reason,
      },
      secrets,
    }))
  }
  recordWebSocketReconnectSkipped({
    now,
    results,
    secrets,
    reason: "Authenticated credentials are unavailable; no initial connection was attempted",
  })
  recordWebSocketSubscriptionSkipped({
    now,
    results,
    secrets,
  })
}

function recordWebSocketClientCreationFailure({ error, now, results, secrets }) {
  recordWebSocketConnectionFailure({
    error,
    now,
    results,
    secrets,
  })
  recordWebSocketReconnectSkipped({
    now,
    results,
    secrets,
    reason: "The initial WebSocket client could not be created; no reconnect attempt was made",
  })
  recordWebSocketSubscriptionSkipped({
    now,
    results,
    secrets,
  })
}

async function runWebSocketLifecycle({
  client,
  symbol,
  depthPrecision,
  now,
  results,
  events,
  secrets,
  includePublicPayloads,
  onProgress,
}) {
  const initialConnectionEstablished = await runWebSocketSession({
    client,
    symbol,
    depthPrecision,
    now,
    results,
    events,
    secrets,
    includePublicPayloads,
    onProgress,
  })
  if (!initialConnectionEstablished) {
    recordWebSocketReconnectSkipped({
      now,
      results,
      secrets,
      reason: "The initial WebSocket connection was not established; no reconnect attempt was made",
    })
    recordWebSocketSubscriptionSkipped({
      now,
      results,
      secrets,
    })
    return
  }
  await runWebSocketReconnectCheck({
    client,
    events,
    secrets,
    includePublicPayloads,
    now,
    results,
  })
}

async function runWebSocketChecks({
  env,
  requestTimeout,
  symbol,
  depthPrecision,
  now,
  results,
  events,
  secrets,
  includePublicPayloads,
  credentialsConfigured,
  websocketClientFactory,
  onProgress,
}) {
  if (!credentialsConfigured) {
    recordWebSocketSkipped({
      now,
      results,
      secrets,
    })
    return
  }
  let client
  try {
    client = createConfiguredWebSocketClient({
      env,
      requestTimeout,
      events,
      secrets,
      includePublicPayloads,
      now,
      websocketClientFactory,
    })
  } catch (error) {
    recordWebSocketClientCreationFailure({
      error,
      now,
      results,
      secrets,
    })
    return
  }
  await runWebSocketLifecycle({
    client,
    symbol,
    depthPrecision,
    now,
    results,
    events,
    secrets,
    includePublicPayloads,
    onProgress,
  })
}


function createObservedBrokerRestClientFactory({
  restClientFactory,
  schemaObservations,
  secrets,
  now,
}) {
  return (configuration) => {
    const client = restClientFactory(configuration)
    return {
      async request(request) {
        try {
          const response = await client.request(request)
          const schema = BITUNIX_RESPONSE_SCHEMAS[request.path]
          if (schema) {
            schemaObservations.push({
              timestamp: new Date(now()).toISOString(),
              provider: "bitunix",
              path: request.path,
              method: request.method,
              authenticated: request.authenticated ?? true,
              stateChanging: request.stateChanging ?? false,
              ...inspectDiagnosticSchema({
                value: response.data,
                ...schema,
              }),
            })
          }
          return response
        } catch (error) {
          schemaObservations.push({
            timestamp: new Date(now()).toISOString(),
            provider: "bitunix",
            path: request.path,
            method: request.method,
            authenticated: request.authenticated ?? true,
            error: sanitizeDiagnosticError({
              error,
              secrets,
            }),
          })
          throw error
        }
      },
    }
  }
}

function createBrokerApiRequest({ method, args }) {
  return {
    api: "Broker",
    method,
    params: args[0] ?? {},
    stateChanging: false,
  }
}

function recordBrokerApiSuccess({
  method,
  args,
  result,
  privateResponse,
  startedAt,
  now,
  results,
  secrets,
}) {
  results.push(createResult({
    operation: `Broker API ${method}`,
    startedAt,
    now,
    status: "passed",
    request: createBrokerApiRequest({ method, args }),
    response: result.data,
    privateResponse,
    secrets,
  }))
}

function recordBrokerApiFailure({
  method,
  args,
  error,
  startedAt,
  now,
  results,
  secrets,
}) {
  results.push(createResult({
    operation: `Broker API ${method}`,
    startedAt,
    now,
    status: "failed",
    request: createBrokerApiRequest({ method, args }),
    error,
    secrets,
  }))
}

async function runBrokerApiOperation({
  broker,
  definition,
  now,
  results,
  secrets,
  onProgress,
}) {
  const startedAt = now()
  emitProgress({
    onProgress,
    area: "Broker API",
    operation: definition.method,
    status: "RUNNING",
  })
  try {
    const result = await broker[definition.method](...definition.args)
    if (!result || result.ok !== true) {
      const error = result?.errors?.[0] ?? new Error("Broker read returned no successful result envelope")
      recordBrokerApiFailure({
        method: definition.method,
        args: definition.args,
        error,
        startedAt,
        now,
        results,
        secrets,
      })
      emitProgress({
        onProgress,
        area: "Broker API",
        operation: definition.method,
        status: "FAIL",
      })
      return
    }
    recordBrokerApiSuccess({
      method: definition.method,
      args: definition.args,
      result,
      privateResponse: definition.privateResponse,
      startedAt,
      now,
      results,
      secrets,
    })
    emitProgress({
      onProgress,
      area: "Broker API",
      operation: definition.method,
      status: "PASS",
    })
  } catch (error) {
    recordBrokerApiFailure({
      method: definition.method,
      args: definition.args,
      error,
      startedAt,
      now,
      results,
      secrets,
    })
    emitProgress({
      onProgress,
      area: "Broker API",
      operation: definition.method,
      status: "FAIL",
    })
  }
}

async function runBrokerApiChecks({
  env,
  requestTimeout,
  symbol,
  now,
  results,
  secrets,
  credentialsConfigured,
  brokerApiRestClientFactory,
  schemaObservations,
  onProgress,
}) {
  const apiKey = credentialsConfigured
    ? env.BITUNIX_API_KEY
    : PUBLIC_ONLY_DIAGNOSTIC_CREDENTIAL
  const apiSecret = credentialsConfigured
    ? env.BITUNIX_API_SECRET
    : PUBLIC_ONLY_DIAGNOSTIC_CREDENTIAL
  const restClientFactory = createObservedBrokerRestClientFactory({
    restClientFactory: brokerApiRestClientFactory,
    schemaObservations,
    secrets,
    now,
  })
  const broker = new Broker({
    provider: "bitunix",
    apiKey,
    apiSecret,
    tradingMode: "live",
    providerOptions: {
      requestTimeout,
      dependencies: {
        restClientFactory,
      },
    },
  })
  try {
    await broker.connect()
    results.push(createResult({
      operation: "Broker API connect",
      startedAt: now(),
      now,
      status: "passed",
      request: {
        api: "Broker",
        method: "connect",
        networkConnection: false,
      },
      response: { connected: true },
      secrets,
    }))
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
      )
    }
    for (const definition of operations) {
      await runBrokerApiOperation({
        broker,
        definition,
        now,
        results,
        secrets,
        onProgress,
      })
    }
  } catch (error) {
    recordBrokerApiFailure({
      method: "connect",
      args: [],
      error,
      startedAt: now(),
      now,
      results,
      secrets,
    })
  } finally {
    try {
      await broker.disconnect()
      results.push(createResult({
        operation: "Broker API disconnect",
        startedAt: now(),
        now,
        status: "passed",
        request: {
          api: "Broker",
          method: "disconnect",
          networkConnection: false,
        },
        response: { disconnected: true },
        secrets,
      }))
    } catch (error) {
      recordBrokerApiFailure({
        method: "disconnect",
        args: [],
        error,
        startedAt: now(),
        now,
        results,
        secrets,
      })
    }
  }
}

async function runConfiguredProbes({
  env,
  requestTimeout,
  symbol,
  depthPrecision,
  klineInterval,
  now,
  results,
  events,
  secrets,
  includePublicPayloads,
  credentialsConfigured,
  restClientFactory,
  brokerApiRestClientFactory,
  schemaObservations,
  websocketClientFactory,
  onProgress,
}) {
  await runRestChecks({
    env,
    requestTimeout,
    symbol,
    depthPrecision,
    klineInterval,
    now,
    results,
    secrets,
    includePublicPayloads,
    credentialsConfigured,
    restClientFactory,
    onProgress,
  })
  if (brokerApiRestClientFactory) {
    await runBrokerApiChecks({
      env,
      requestTimeout,
      symbol,
      now,
      results,
      secrets,
      credentialsConfigured,
      brokerApiRestClientFactory,
      schemaObservations,
      onProgress,
    })
  }
  await runWebSocketChecks({
    env,
    requestTimeout,
    symbol,
    depthPrecision,
    now,
    results,
    events,
    secrets,
    includePublicPayloads,
    credentialsConfigured,
    websocketClientFactory,
    onProgress,
  })
}

async function runConfiguredDiagnostics({
  env,
  now,
  startedAtIso,
  results,
  events,
  secrets,
  includePublicPayloads,
  restClientFactory,
  brokerApiRestClientFactory,
  websocketClientFactory,
  schemaObservations,
  onProgress,
}) {
  const { symbol, klineInterval, timeoutMs: requestTimeout } = DIAGNOSTIC_CONFIG
  let depthPrecision
  try {
    if (!Number.isInteger(requestTimeout) || requestTimeout < 1 || requestTimeout > 60_000) {
      throw new RangeError("DIAGNOSTIC_CONFIG.timeoutMs must be an integer between 1 and 60000")
    }
    depthPrecision = parseDepthPrecision({
      value: env.BITUNIX_DIAGNOSTICS_DEPTH_PRECISION,
    })
  } catch (error) {
    return createOptionFailure({
      error,
      startedAtIso,
      now,
      results,
      events,
      secrets,
    })
  }

  const credentialsConfigured = hasCredentials({ env })
  await runConfiguredProbes({
    env,
    requestTimeout,
    symbol,
    depthPrecision,
    klineInterval,
    now,
    results,
    events,
    secrets,
    includePublicPayloads,
    credentialsConfigured,
    restClientFactory,
    brokerApiRestClientFactory,
    schemaObservations,
    websocketClientFactory,
    onProgress,
  })
  return createReport({
    startedAtIso,
    now,
    results,
    events,
  })
}

export async function runBitunixDiagnostics({
  env = process.env,
  now = Date.now,
  restClientFactory = (options) => new BitunixRestClient(options),
  brokerApiRestClientFactory,
  websocketClientFactory = (options) => new BitunixSpotWebSocketClient(options),
  onProgress,
} = {}) {
  const startedAt = now()
  const startedAtIso = new Date(startedAt).toISOString()
  const secrets = getSecrets({ env })
  const results = []
  const events = []
  const schemaObservations = []
  const { includePublicPayloads } = DIAGNOSTIC_CONFIG
  const safetyConfirmation = createSafetyConfirmationResult({
    startedAt,
    now,
    secrets,
  })
  results.push(safetyConfirmation)
  if (safetyConfirmation.status !== "passed") {
    return createReport({
      startedAtIso,
      now,
      results,
      events,
      schemaObservations,
    })
  }
  const configuration = createConfigurationResult({
    env,
    startedAt,
    now,
    secrets,
  })
  results.push(configuration)
  onProgress?.({ message: "      Configuration: credentials and live-read safety ... PASS" })
  return runConfiguredDiagnostics({
    env,
    now,
    startedAtIso,
    results,
    events,
    secrets,
    includePublicPayloads,
    restClientFactory,
    brokerApiRestClientFactory,
    schemaObservations,
    websocketClientFactory,
    onProgress,
  })
}

export { WEBSOCKET_OPERATIONS }