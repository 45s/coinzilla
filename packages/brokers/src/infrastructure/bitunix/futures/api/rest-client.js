import { randomBytes } from "node:crypto"
import { ensure, SystemCustomError } from "@coinzilla/utils"
import { createRestSignature } from "../../spot/auth/create-rest-signature.js"

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
  ensure.boolean({
    value: stateChanging,
    name: "stateChanging",
  })
  if (stateChanging && method !== "POST") {
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
    stateChanging = false,
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
      return JSON.parse(await response.text())
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
export class BitunixFuturesRestClient {
  /**
   * @param {{config: object, fetchFn?: typeof fetch, now?: () => number, nonceFactory?: () => string}} input
   */
  constructor({
    config,
    fetchFn = fetch,
    now = Date.now,
    nonceFactory = () => randomBytes(16).toString("hex"),
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
    this.config = config
    this.apiKey = config.apiKey
    this.apiSecret = config.apiSecret
    this.baseUrl = config.baseUrl
    this.requestTimeout = config.requestTimeout
    this.fetch = fetchFn
    this.now = now
    this.nonceFactory = nonceFactory
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
    const options = createRequestOptions({
      client: this,
      request,
    })
    const response = await sendRestRequest({
      client: this,
      request,
      url,
      options,
    })
    const payload = await readResponsePayload({
      response,
      request,
    })
    validateHttpResponse({
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
