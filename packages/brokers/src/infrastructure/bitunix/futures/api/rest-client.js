import { randomBytes } from "node:crypto"
import { SystemCustomError } from "@coinzilla/utils"
import { createRestSignature } from "../../spot/auth/create-rest-signature.js"

const ERROR_CODES = Object.freeze({
  authentication: "BITUNIX_FUTURES_AUTHENTICATION_REQUIRED",
  transport: "BITUNIX_FUTURES_REST_TRANSPORT_FAILED",
  http: "BITUNIX_FUTURES_REST_HTTP_FAILED",
  exchange: "BITUNIX_FUTURES_REST_EXCHANGE_REJECTED",
  response: "BITUNIX_FUTURES_REST_RESPONSE_INVALID",
})

function validateRequest({ method, path, queryParams, body, stateChanging, authenticated }) {
  if (method !== "GET" && method !== "POST") {
    throw new TypeError("Bitunix Futures REST method must be GET or POST")
  }
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("Bitunix Futures REST path must be an absolute API path")
  }
  if (!queryParams || typeof queryParams !== "object" || Array.isArray(queryParams)) {
    throw new TypeError("Bitunix Futures REST queryParams must be an object")
  }
  if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body))) {
    throw new TypeError("Bitunix Futures REST body must be an object")
  }
  if (method === "GET" && body !== undefined) {
    throw new TypeError("Bitunix Futures REST GET requests cannot include a body")
  }
  if (method === "POST" && typeof stateChanging !== "boolean") {
    throw new TypeError("Bitunix Futures REST POST requests must explicitly set stateChanging")
  }
  if (stateChanging === true && method !== "POST") {
    throw new TypeError("Bitunix Futures state-changing requests must use POST")
  }
  if (typeof authenticated !== "boolean") {
    throw new TypeError("Bitunix Futures REST authenticated flag must be a boolean")
  }
  if (!authenticated && (method !== "GET" || stateChanging === true)) {
    throw new TypeError("Unauthenticated Bitunix Futures requests must be read-only GET requests")
  }
}

function createQueryString({ queryParams }) {
  const params = new URLSearchParams()
  for (const key of Object.keys(queryParams).sort()) {
    const value = queryParams[key]
    if (value !== undefined && value !== null) {
      params.set(key, String(value))
    }
  }
  return params.toString()
}

function createHeaders({ client, method, queryParams, body, authenticated }) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    language: "en-US",
  }
  if (!authenticated) {
    return headers
  }
  if (typeof client.apiKey !== "string" || !client.apiKey.trim() ||
      typeof client.apiSecret !== "string" || !client.apiSecret.trim()) {
    throw new BitunixFuturesRestError({
      message: "Bitunix Futures API credentials are required for private requests",
      kind: "authentication",
      outcomeUnknown: false,
    })
  }

  const nonce = client.nonceFactory()
  const timestamp = String(client.now())
  if (typeof nonce !== "string" || !nonce.trim()) {
    throw new TypeError("Bitunix Futures REST nonce must be a non-empty string")
  }
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
    throw new RangeError("Bitunix Futures REST timestamp must be a non-negative safe integer")
  }
  const bodyText = method === "POST" && body !== undefined ? JSON.stringify(body) : undefined
  headers["api-key"] = client.apiKey
  headers.nonce = nonce
  headers.timestamp = timestamp
  headers.sign = createRestSignature({
    nonce,
    timestamp,
    apiKey: client.apiKey,
    secretKey: client.apiSecret,
    queryParams,
    ...(bodyText === undefined ? {} : { body: bodyText, bodyIsSerialized: true }),
  })
  return {
    headers,
    bodyText,
  }
}

/** Structured error for Bitunix USDT Futures REST failures. */
export class BitunixFuturesRestError extends SystemCustomError {
  /**
   * @param {{message: string, kind?: "authentication"|"transport"|"http"|"exchange"|"response", cause?: unknown, path?: string, status?: number|null, exchangeCode?: string|null, outcomeUnknown?: boolean}} input
   */
  constructor({ message, kind = "response", cause, path = null, status = null, exchangeCode = null, outcomeUnknown = false } = {}) {
    if (!Object.hasOwn(ERROR_CODES, kind)) {
      throw new TypeError("Bitunix Futures REST error kind is unsupported")
    }
    const options = {
      code: ERROR_CODES[kind],
      context: { path, status, exchangeCode },
      ...(cause === undefined ? {} : { cause }),
    }
    super(message, options)
    this.kind = kind
    this.path = path
    this.status = status
    this.exchangeCode = exchangeCode
    this.outcomeUnknown = outcomeUnknown
  }
}

/**
 * Signed and unsigned REST transport for the official Bitunix USDT Futures API.
 * It sends one request only; callers own mutation authorization and reconciliation.
 */
export class BitunixFuturesRestClient {
  /**
   * @param {{config: object, fetchFn?: typeof fetch, now?: () => number, nonceFactory?: () => string}} input
   */
  constructor({ config, fetchFn = fetch, now = Date.now, nonceFactory = () => randomBytes(16).toString("hex") } = {}) {
    if (!config || config.baseUrl !== "https://fapi.bitunix.com") {
      throw new TypeError("Bitunix Futures REST client requires validated Futures configuration")
    }
    if (typeof fetchFn !== "function" || typeof now !== "function" || typeof nonceFactory !== "function") {
      throw new TypeError("Bitunix Futures REST dependencies must be functions")
    }
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
   * @param {{method: "GET"|"POST", path: string, queryParams?: object, body?: object, authenticated?: boolean, stateChanging?: boolean}} input
   */
  async request(input = {}) {
    const {
      method,
      path,
      queryParams = {},
      body,
      authenticated = true,
      stateChanging = false,
    } = input
    validateRequest({ method, path, queryParams, body, stateChanging, authenticated })
    const queryString = createQueryString({ queryParams })
    const url = new URL(path, this.baseUrl)
    if (queryString) {
      url.search = queryString
    }

    let signed
    try {
      signed = createHeaders({
        client: this,
        method,
        queryParams,
        body,
        authenticated,
      })
    } catch (error) {
      if (error instanceof BitunixFuturesRestError) {
        throw error
      }
      throw new BitunixFuturesRestError({
        message: "Bitunix Futures request authentication could not be prepared",
        kind: "authentication",
        cause: error,
        path,
        outcomeUnknown: false,
      })
    }

    const options = {
      method,
      headers: signed.headers ?? signed,
      signal: AbortSignal.timeout(this.requestTimeout),
      ...(signed.bodyText === undefined ? {} : { body: signed.bodyText }),
    }
    let response
    try {
      response = await this.fetch(url.toString(), options)
    } catch (error) {
      throw new BitunixFuturesRestError({
        message: error instanceof Error ? error.message : String(error),
        kind: "transport",
        cause: error,
        path,
        outcomeUnknown: stateChanging,
      })
    }

    let payload
    try {
      if (typeof response?.text === "function") {
        const text = await response.text()
        payload = JSON.parse(text)
      } else if (typeof response?.json === "function") {
        payload = await response.json()
      } else {
        throw new TypeError("response has no JSON reader")
      }
    } catch (error) {
      throw new BitunixFuturesRestError({
        message: "Bitunix Futures REST response is not valid JSON",
        kind: "response",
        cause: error,
        path,
        status: response?.status ?? null,
        outcomeUnknown: stateChanging,
      })
    }

    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new BitunixFuturesRestError({
        message: "Bitunix Futures REST response has invalid HTTP status metadata",
        kind: "response",
        path,
        outcomeUnknown: stateChanging,
      })
    }
    if (!response.ok) {
      throw new BitunixFuturesRestError({
        message: `Bitunix Futures REST request failed with HTTP ${response.status}`,
        kind: "http",
        path,
        status: response.status,
        outcomeUnknown: stateChanging && (response.status === 408 || response.status === 409 || response.status >= 500),
      })
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.code !== 0) {
      throw new BitunixFuturesRestError({
        message: typeof payload?.msg === "string" ? payload.msg : "Bitunix Futures exchange returned an invalid response envelope",
        kind: payload && typeof payload === "object" && Number.isInteger(payload.code) ? "exchange" : "response",
        path,
        exchangeCode: Number.isInteger(payload?.code) ? String(payload.code) : null,
        outcomeUnknown: stateChanging && !Number.isInteger(payload?.code),
      })
    }
    return { data: payload.data }
  }
}
