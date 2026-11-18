import { BitunixRestClient } from "../src/infrastructure/bitunix/api/rest-client.js"
import { BitunixSpotWebSocketClient } from "../src/infrastructure/bitunix/api/websocket-client.js"
import { BitunixWebSocketTransport } from "../src/infrastructure/bitunix/api/websocket-transport.js"
import {
  createDiagnosticReport,
  createDiagnosticResult,
  sanitizeDiagnosticError,
  sanitizeDiagnosticValue,
  summarizePrivatePayload,
} from "./bitunix-diagnostics.js"

const DIAGNOSTIC_CONFIG = Object.freeze({
  confirmLiveReads: true,
  symbol: "BTCUSDT",
  klineInterval: "1min",
  timeoutMs: 10_000,
  includePublicPayloads: false,
})

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
    getArguments: ({ symbol, klineInterval }) => ({
      symbol,
      interval: klineInterval,
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
])

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
  const isPrivate = method === "user.account" || method === "user.info"
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
}) {
  const startedAt = now()
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
    return
  }
  const request = createRestDiagnosticRequest({
    endpoint,
    symbol,
    depthPrecision,
    klineInterval,
  })
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
  }
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
    })
  }
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
}) {
  const context = {
    symbol,
    depthPrecision,
    klineInterval: DIAGNOSTIC_CONFIG.klineInterval,
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

async function connectWebSocket({ client, now, results, secrets }) {
  const startedAt = now()
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
    return true
  } catch (error) {
    recordWebSocketConnectionFailure({
      error,
      now,
      results,
      secrets,
    })
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
}) {
  const isConnected = await connectWebSocket({
    client,
    now,
    results,
    secrets,
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
  env,
  requestTimeout,
  events,
  secrets,
  includePublicPayloads,
  now,
  results,
  websocketClientFactory,
}) {
  const startedAt = now()
  let client
  let isConnected = false
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
    if (client) {
      await cleanupWebSocket({
        client,
        isConnected,
        now,
        results,
        events,
        secrets,
      })
    }
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
  env,
  requestTimeout,
  symbol,
  depthPrecision,
  now,
  results,
  events,
  secrets,
  includePublicPayloads,
  websocketClientFactory,
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
    env,
    requestTimeout,
    events,
    secrets,
    includePublicPayloads,
    now,
    results,
    websocketClientFactory,
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
    env,
    requestTimeout,
    symbol,
    depthPrecision,
    now,
    results,
    events,
    secrets,
    includePublicPayloads,
    websocketClientFactory,
  })
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
  websocketClientFactory,
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
  })
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
  websocketClientFactory,
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
    websocketClientFactory,
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
  websocketClientFactory = (options) => new BitunixSpotWebSocketClient(options),
} = {}) {
  const startedAt = now()
  const startedAtIso = new Date(startedAt).toISOString()
  const secrets = getSecrets({ env })
  const results = []
  const events = []
  const { includePublicPayloads } = DIAGNOSTIC_CONFIG
  const configuration = createConfigurationResult({
    env,
    startedAt,
    now,
    secrets,
  })
  results.push(configuration)
  if (configuration.status !== "passed") {
    return createReport({
      startedAtIso,
      now,
      results,
      events,
    })
  }
  return runConfiguredDiagnostics({
    env,
    now,
    startedAtIso,
    results,
    events,
    secrets,
    includePublicPayloads,
    restClientFactory,
    websocketClientFactory,
  })
}

export { WEBSOCKET_OPERATIONS }
