import { createHmac, randomBytes } from "node:crypto"
import { ensure, SystemCustomError } from "@coinzilla/utils"
import { createRestSignature } from "../../common/auth/create-rest-signature.js"
import { quoteDepthLevelNumbers } from "./quote-depth-level-numbers.js"

const MIN_REQUEST_INTERVAL_MS = 100
const MIN_REQUEST_INTERVAL_MS_BY_PATH = Object.freeze({
  "/api/v1/futures/trade/close_all_position": 1_000,
  "/api/v1/futures/trade/flash_close_position": 200,
})
const RATE_LIMITERS = new Map()
const RATE_LIMITER_KEY_SECRET = randomBytes(32)

const ERROR_CODES = Object.freeze({
  authentication: "BITUNIX_FUTURES_AUTHENTICATION_REQUIRED",
  transport: "BITUNIX_FUTURES_REST_TRANSPORT_FAILED",
  http: "BITUNIX_FUTURES_REST_HTTP_FAILED",
  exchange: "BITUNIX_FUTURES_REST_EXCHANGE_REJECTED",
  response: "BITUNIX_FUTURES_REST_RESPONSE_INVALID",
})

/** Structured error for Bitunix USDT Futures REST failures. */
export class BitunixFuturesRestError extends SystemCustomError {
  /**
   * @param {{message: string, kind?: "authentication"|"transport"|"http"|"exchange"|"response", cause?: unknown, path?: string, status?: number|null, exchangeCode?: string|null, outcomeUnknown?: boolean}} input
   */
  constructor({
    message,
    kind = "response",
    cause,
    path = null,
    status = null,
    exchangeCode = null,
    outcomeUnknown = false,
  } = {}) {
    ensure.oneOf({
      value: kind,
      values: Object.keys(ERROR_CODES),
      name: "kind",
    })
    super(message, {
      code: ERROR_CODES[kind],
      context: {
        path,
        status,
        exchangeCode,
      },
      ...(cause === undefined ? {} : { cause }),
    })
    this.kind = kind
    this.path = path
    this.status = status
    this.exchangeCode = exchangeCode
    this.outcomeUnknown = outcomeUnknown
  }
}

function validateMethod({ method }) {
  ensure.oneOf({
    value: method,
    values: ["GET", "POST"],
    name: "method",
  })
}

function validatePath({ path }) {
  ensure.nonEmptyString({
    value: path,
    name: "path",
  })
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("Bitunix Futures REST path must be an absolute API path")
  }
}

function validateQueryParams({ queryParams }) {
  ensure.plainObject({
    value: queryParams,
    name: "queryParams",
  })
}

function validateBody({ method, body }) {
  if (body === undefined) {
    return
  }
  ensure.plainObject({
    value: body,
    name: "body",
  })
  if (method === "GET") {
    throw new TypeError("Bitunix Futures REST GET requests cannot include a body")
  }
}

function validateMutationState({ method, stateChanging }) {
  if (method === "POST" || stateChanging !== undefined) {
    ensure.boolean({
      value: stateChanging,
      name: "stateChanging",
    })
  }
  if (stateChanging === true && method !== "POST") {
    throw new TypeError("Bitunix Futures state-changing requests must use POST")
  }
}

function validateAuthenticationMode({ method, stateChanging, authenticated }) {
  ensure.boolean({
    value: authenticated,
    name: "authenticated",
  })
  if (!authenticated && (method !== "GET" || stateChanging)) {
    throw new TypeError("Unauthenticated Bitunix Futures requests must be read-only GET requests")
  }
}

function validateRequest({ request }) {
  validateMethod({ method: request.method })
  validatePath({ path: request.path })
  validateQueryParams({ queryParams: request.queryParams })
  validateBody({
    method: request.method,
    body: request.body,
  })
  validateMutationState({
    method: request.method,
    stateChanging: request.stateChanging,
  })
  validateAuthenticationMode({
    method: request.method,
    stateChanging: request.stateChanging,
    authenticated: request.authenticated,
  })
}

function normalizeRequest({ input }) {
  const {
    method,
    path,
    queryParams = {},
    body,
    authenticated = true,
    stateChanging,
  } = input
  return {
    method,
    path,
    queryParams,
    body,
    authenticated,
    stateChanging,
  }
}

function createQueryString({ queryParams }) {
  const params = new URLSearchParams()
  for (const key of Object.keys(queryParams).sort()) {
    const value = queryParams[key]
    if (value === undefined || value === null) {
      continue
    }
    params.set(key, String(value))
  }
  return params.toString()
}

function createRequestUrl({ client, request }) {
  const url = new URL(request.path, client.baseUrl)
  const queryString = createQueryString({
    queryParams: request.queryParams,
  })
  if (queryString) {
    url.search = queryString
  }
  return url.toString()
}

function createRequestHeaders({ client, request }) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    language: "en-US",
  }
  if (!request.authenticated) {
    return {
      headers,
      bodyText: undefined,
    }
  }
  ensure.nonEmptyString({
    value: client.apiKey,
    name: "apiKey",
  })
  ensure.nonEmptyString({
    value: client.apiSecret,
    name: "apiSecret",
  })
  const nonce = ensure.nonEmptyString({
    value: client.nonceFactory(),
    name: "nonce",
  })
  const timestamp = String(ensure.nonNegativeInteger({
    value: client.now(),
    name: "timestamp",
  }))
  const bodyText = request.method === "POST" && request.body !== undefined
    ? JSON.stringify(request.body)
    : undefined
  headers["api-key"] = client.apiKey
  headers.nonce = nonce
  headers.timestamp = timestamp
  headers.sign = createRestSignature({
    nonce,
    timestamp,
    apiKey: client.apiKey,
    secretKey: client.apiSecret,
    queryParams: request.queryParams,
    ...(bodyText === undefined ? {} : {
      body: bodyText,
      bodyIsSerialized: true,
    }),
  })
  return {
    headers,
    bodyText,
  }
}

function createRequestOptions({ client, request }) {
  const { headers, bodyText } = createRequestHeaders({
    client,
    request,
  })
  return {
    method: request.method,
    headers,
    signal: AbortSignal.timeout(client.requestTimeout),
    ...(bodyText === undefined ? {} : { body: bodyText }),
  }
}

async function sendRestRequest({ client, request, url, options }) {
  try {
    return await client.fetch(url, options)
  } catch (error) {
    throw new BitunixFuturesRestError({
      message: error instanceof Error ? error.message : String(error),
      kind: "transport",
      cause: error,
      path: request.path,
      outcomeUnknown: request.stateChanging,
    })
  }
}

async function readResponsePayload({ response, request }) {
  try {
    if (typeof response?.text === "function") {
      const responseText = await response.text()
      const parsedText = request.path === "/api/v1/futures/market/depth"
        ? quoteDepthLevelNumbers({
          text: responseText,
        })
        : responseText
      return JSON.parse(parsedText)
    }
    if (request.path === "/api/v1/futures/market/depth") {
      throw new TypeError("Bitunix Futures depth responses must be read as raw text to preserve numeric precision")
    }
    if (typeof response?.json === "function") {
      return await response.json()
    }
    throw new TypeError("Bitunix Futures response has no JSON reader")
  } catch (error) {
    throw new BitunixFuturesRestError({
      message: "Bitunix Futures REST response is not valid JSON",
      kind: "response",
      cause: error,
      path: request.path,
      status: response?.status ?? null,
      outcomeUnknown: request.stateChanging,
    })
  }
}

function validateHttpResponse({ response, request }) {
  if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) {
    throw new BitunixFuturesRestError({
      message: "Bitunix Futures REST response has invalid HTTP status metadata",
      kind: "response",
      path: request.path,
      outcomeUnknown: request.stateChanging,
    })
  }
  if (response.ok) {
    return
  }
  const outcomeUnknown = request.stateChanging &&
    (response.status === 408 || response.status === 409 || response.status >= 500)
  throw new BitunixFuturesRestError({
    message: `Bitunix Futures REST request failed with HTTP ${response.status}`,
    kind: "http",
    path: request.path,
    status: response.status,
    outcomeUnknown,
  })
}

function validateExchangeEnvelope({ payload, request }) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.code === 0) {
    return
  }
  const hasExchangeCode = payload && typeof payload === "object" &&
    Number.isInteger(payload.code)
  throw new BitunixFuturesRestError({
    message: typeof payload?.msg === "string"
      ? payload.msg
      : "Bitunix Futures exchange returned an invalid response envelope",
    kind: hasExchangeCode ? "exchange" : "response",
    path: request.path,
    exchangeCode: hasExchangeCode ? String(payload.code) : null,
    outcomeUnknown: request.stateChanging && !hasExchangeCode,
  })
}

/** Signed and unsigned REST transport for the official Bitunix USDT Futures API. */
function createRateLimiterKey({ apiKey }) {
  return createHmac("sha256", RATE_LIMITER_KEY_SECRET)
    .update(apiKey, "utf8")
    .digest("hex")
}

function getSharedRateLimiter({ apiKey, rateLimitNow, sleepFn }) {
  const now = rateLimitNow()
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("Bitunix Futures rate-limit clock must return a non-negative safe integer")
  }
  const key = createRateLimiterKey({
    apiKey,
  })
  const existing = RATE_LIMITERS.get(key)
  if (existing) {
    return existing
  }
  const limiter = {
    nextRequestAt: 0,
    nextRequestAtByPath: new Map(),
    rateLimitNow,
    requestQueue: Promise.resolve(),
    sleepFn,
  }
  RATE_LIMITERS.set(key, limiter)
  return limiter
}

export class BitunixFuturesRestClient {
  /**
   * @param {{config: object, fetchFn?: typeof fetch, now?: () => number, nonceFactory?: () => string}} input
   */
  #rateLimiter

  constructor({
    config,
    fetchFn = fetch,
    now = Date.now,
    nonceFactory = () => randomBytes(16).toString("hex"),
    rateLimitNow = Date.now,
    sleepFn = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  } = {}) {
    if (!config || config.baseUrl !== "https://fapi.bitunix.com") {
      throw new TypeError("Bitunix Futures REST client requires validated Futures configuration")
    }
    ensure.function({
      value: fetchFn,
      name: "fetchFn",
    })
    ensure.function({
      value: now,
      name: "now",
    })
    ensure.function({
      value: nonceFactory,
      name: "nonceFactory",
    })
    ensure.function({
      value: rateLimitNow,
      name: "rateLimitNow",
    })
    ensure.function({
      value: sleepFn,
      name: "sleepFn",
    })
    this.config = config
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.baseUrl = config.baseUrl
    this.requestTimeout = config.requestTimeout
    this.fetch = fetchFn
    this.now = now
    this.nonceFactory = nonceFactory
    this.#rateLimiter = getSharedRateLimiter({
      apiKey: config.apiKey,
      rateLimitNow,
      sleepFn,
    })
  }

  async #dispatchAtRateLimit({ dispatch, path }) {
    ensure.function({
      value: dispatch,
      name: "dispatch",
    })
    const limiter = this.#rateLimiter
    const scheduled = limiter.requestQueue.then(async () => {
      const now = limiter.rateLimitNow()
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new TypeError("Bitunix Futures rate-limit clock must return a non-negative safe integer")
      }
      const nextPathRequestAt = limiter.nextRequestAtByPath.get(path) ?? 0
      const nextRequestAt = Math.max(limiter.nextRequestAt, nextPathRequestAt)
      const delay = Math.max(0, nextRequestAt - now)
      if (delay > 0) {
        await limiter.sleepFn(delay)
      }
      const dispatchedAt = limiter.rateLimitNow()
      if (!Number.isSafeInteger(dispatchedAt) || dispatchedAt < 0) {
        throw new TypeError("Bitunix Futures rate-limit clock must return a non-negative safe integer")
      }
      limiter.nextRequestAt = Math.max(dispatchedAt, limiter.nextRequestAt) + MIN_REQUEST_INTERVAL_MS
      const pathInterval = MIN_REQUEST_INTERVAL_MS_BY_PATH[path] ?? MIN_REQUEST_INTERVAL_MS
      limiter.nextRequestAtByPath.set(
        path,
        Math.max(dispatchedAt, nextPathRequestAt) + pathInterval,
      )
      return {
        result: dispatch(),
      }
    })
    limiter.requestQueue = scheduled.then(() => undefined, () => undefined)
    const { result } = await scheduled
    return result
  }

  /**
   * Send one request. No automatic retries are performed; callers own mutation
   * authorization and reconciliation of unknown outcomes.
   *
   * @param {{method: "GET"|"POST", path: string, queryParams?: object, body?: object, authenticated?: boolean, stateChanging?: boolean}} input
   */
  async request(input = {}) {
    const request = normalizeRequest({
      input,
    })
    validateRequest({
      request,
    })
    const url = createRequestUrl({
      client: this,
      request,
    })
    const response = await this.#dispatchAtRateLimit({
      path: request.path,
      dispatch: () => sendRestRequest({
        client: this,
        request,
        url,
        options: createRequestOptions({
          client: this,
          request,
        }),
      }),
    })
    validateHttpResponse({
      response,
      request,
    })
    const payload = await readResponsePayload({
      response,
      request,
    })
    validateExchangeEnvelope({
      payload,
      request,
    })
    return {
      data: payload.data,
    }
  }
}
