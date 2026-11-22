import { randomBytes } from "node:crypto"
import { SystemCustomError } from "@coinzilla/utils"
import { createRestSignature } from "../auth/create-rest-signature.js"
import { serializeBitunixJson } from "./json-serializer.js"

const DEFAULT_BASE_URL = "https://openapi.bitunix.com"
const DEFAULT_REQUEST_TIMEOUT = 10_000

const ERROR_CODES = Object.freeze({
  transport: "BITUNIX_REST_TRANSPORT_FAILED",
  http: "BITUNIX_REST_HTTP_FAILED",
  exchange: "BITUNIX_REST_EXCHANGE_REJECTED",
  response: "BITUNIX_REST_RESPONSE_INVALID",
  authentication: "BITUNIX_REST_AUTHENTICATION_REQUIRED",
})

/** Error returned by the Bitunix Spot REST API or transport boundary. */
export class BitunixRestError extends SystemCustomError {
  /**
   * @param {{
   *   message: string,
   *   kind?: "transport"|"http"|"exchange"|"response"|"authentication",
   *   cause?: unknown,
   *   exchangeCode?: string|null,
   *   status?: number|null,
   *   path?: string|null,
   *   outcomeUnknown?: boolean,
   *   retryAfterMs?: number|null,
   * }} input
   */
  constructor({
    message,
    kind = "response",
    cause,
    exchangeCode = null,
    status = null,
    path = null,
    outcomeUnknown = false,
    retryAfterMs = null,
  } = {}) {
    if (!Object.hasOwn(ERROR_CODES, kind)) {
      throw new TypeError("Bitunix REST error kind is unsupported")
    }
    const errorOptions = {
      code: ERROR_CODES[kind],
      context: {
        path,
        status,
        exchangeCode,
        retryAfterMs,
      },
    }
    if (cause !== undefined) {
      errorOptions.cause = cause
    }
    super(message, errorOptions)
    this.kind = kind
    this.exchangeCode = exchangeCode
    this.status = status
    this.path = path
    this.outcomeUnknown = outcomeUnknown
    this.retryAfterMs = retryAfterMs
  }
}

const LOSSLESS_NUMERIC_FIELDS = Object.freeze({
  "/api/spot/v1/deposit/page": Object.freeze(["id", "amount"]),
  "/api/spot/v1/withdraw_transfer/page": Object.freeze(["id", "toUid", "amount", "fee"]),
  "/api/spot/v1/order/deal/list": Object.freeze(["id", "volume", "price", "fee", "role"]),
  "/api/spot/v1/order/pending/list": Object.freeze(["orderId"]),
  "/api/spot/v1/order/history/page": Object.freeze(["orderId"]),
  "/api/spot/v1/order/detail": Object.freeze(["orderId"]),
  "/api/spot/v1/order/place_order": Object.freeze(["orderId"]),
  "/api/spot/v1/user/info": Object.freeze(["uid"]),
})

function stringifyNumericJsonFields({ text, fields }) {
  const fieldPattern = fields.join("|")
  const numericFieldPattern = new RegExp(
    `("(?:${fieldPattern})"\\s*:\\s*)(-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?=\\s*[,}])`,
    "g",
  )
  return text.replace(
    numericFieldPattern,
    (...matches) => {
      const [, prefix, value] = matches
      return prefix + JSON.stringify(value)
    },
  )
}

function parseResponseText({ text, path }) {
  if (Object.hasOwn(LOSSLESS_NUMERIC_FIELDS, path)) {
    return JSON.parse(stringifyNumericJsonFields({
      text,
      fields: LOSSLESS_NUMERIC_FIELDS[path],
    }))
  }
  if (!path.endsWith("/user/account")) {
    return JSON.parse(text)
  }
  const losslessText = text.replace(
    /("(?:balance|balanceLocked)"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
    (...matches) => {
      const [, prefix, amount] = matches
      return prefix + JSON.stringify(amount)
    },
  )
  return JSON.parse(losslessText)
}

function normalizeMethod({ method }) {
  const normalizedMethod = typeof method === "string" ? method.toUpperCase() : ""
  if (normalizedMethod !== "GET" && normalizedMethod !== "POST") {
    throw new TypeError("Bitunix REST method must be GET or POST")
  }
  return normalizedMethod
}

function validatePath({ path }) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("Bitunix REST path must be an absolute API path")
  }
}

function validateQueryParams({ queryParams }) {
  if (!queryParams || typeof queryParams !== "object" || Array.isArray(queryParams)) {
    throw new TypeError("Bitunix REST queryParams must be an object")
  }
}

function validateRequestBody({ method, body }) {
  if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body))) {
    throw new TypeError("Bitunix REST body must be an object")
  }
  if (method === "GET" && body !== undefined) {
    throw new TypeError("Bitunix REST GET requests cannot include a body")
  }
}

function validateAuthentication({ authenticated, method, body, stateChanging }) {
  if (typeof authenticated !== "boolean") {
    throw new TypeError("Bitunix REST authenticated flag must be a boolean")
  }
  if (!authenticated && (method !== "GET" || body !== undefined || stateChanging)) {
    throw new TypeError("Unauthenticated Bitunix requests must be read-only GET requests")
  }
}

function validateRequest(input = {}) {
  const {
    method,
    path,
    queryParams = {},
    body,
    stateChanging,
    authenticated = true,
  } = input
  const normalizedMethod = normalizeMethod({ method })
  if (stateChanging !== undefined && typeof stateChanging !== "boolean") {
    throw new TypeError("Bitunix REST stateChanging flag must be a boolean")
  }
  if (normalizedMethod === "POST" && typeof stateChanging !== "boolean") {
    throw new TypeError("Bitunix REST POST requests must explicitly set stateChanging to true or false")
  }
  if (stateChanging === true && normalizedMethod !== "POST") {
    throw new TypeError("Bitunix REST state-changing requests must use POST")
  }
  const normalizedStateChanging = stateChanging ?? false
  validatePath({ path })
  validateQueryParams({ queryParams })
  validateRequestBody({
    method: normalizedMethod,
    body,
  })
  validateAuthentication({
    authenticated,
    method: normalizedMethod,
    body,
    stateChanging,
  })
  return {
    method: normalizedMethod,
    path,
    queryParams,
    body,
    stateChanging: normalizedStateChanging,
    authenticated,
  }
}

function createSignedRequest({ client, method, path, queryParams, body }) {
  const nonce = client.nonceFactory()
  const timestamp = String(client.now())
  if (typeof nonce !== "string" || !nonce.trim()) {
    throw new TypeError("Bitunix REST nonce must be a non-empty string")
  }
  if (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) < 0) {
    throw new RangeError("Bitunix REST timestamp must be a non-negative safe integer")
  }

  const sortedQuery = Object.fromEntries(
    Object.keys(queryParams).sort().map((key) => [key, queryParams[key]]),
  )
  const bodyText = serializeBitunixJson({ value: body })
  const signature = createRestSignature({
    nonce,
    timestamp,
    apiKey: client.apiKey,
    secretKey: client.apiSecret,
    queryParams: sortedQuery,
    ...(bodyText === undefined
      ? {}
      : {
        body: bodyText,
        bodyIsSerialized: true,
      }),
  })
  const url = new URL(path, client.baseUrl)
  for (const [key, value] of Object.entries(sortedQuery)) {
    url.searchParams.set(key, String(value))
  }

  return {
    url: url.toString(),
    options: {
      method,
      headers: {
        "api-key": client.apiKey,
        nonce,
        timestamp,
        sign: signature,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(client.requestTimeout),
      ...(bodyText === undefined ? {} : { body: bodyText }),
    },
  }
}

function createPublicRequest({ client, method, path, queryParams }) {
  const sortedQuery = Object.fromEntries(
    Object.keys(queryParams).sort().map((key) => [key, queryParams[key]]),
  )
  const url = new URL(path, client.baseUrl)
  for (const [key, value] of Object.entries(sortedQuery)) {
    url.searchParams.set(key, String(value))
  }

  return {
    url: url.toString(),
    options: {
      method,
      signal: AbortSignal.timeout(client.requestTimeout),
    },
  }
}

async function sendRequest({ client, request, path, stateChanging }) {
  try {
    return await client.fetch(request.url, request.options)
  } catch (error) {
    throw new BitunixRestError({
      message: error instanceof Error ? error.message : String(error),
      kind: "transport",
      cause: error,
      path,
      outcomeUnknown: stateChanging,
    })
  }
}

function hasValidHttpMetadata({ response }) {
  return typeof response?.ok === "boolean" &&
    Number.isInteger(response.status) &&
    response.status >= 100 &&
    response.status <= 599
}

function validateResponseReader({ response, path, stateChanging }) {
  if (!response ||
      (typeof response.json !== "function" && typeof response.text !== "function")) {
    throw new BitunixRestError({
      message: "Bitunix REST response is malformed",
      kind: "response",
      path,
      status: response?.status ?? null,
      outcomeUnknown: stateChanging,
    })
  }
}

function parseRetryAfterMs({ response }) {
  const value = response?.headers?.get?.("retry-after")
  if (typeof value !== "string" || !value.trim()) {
    return null
  }

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000)
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return null
  }
  return Math.max(0, timestamp - Date.now())
}

function createResponseReadError({ error, response, path, stateChanging }) {
  const hasValidMetadata = hasValidHttpMetadata({ response })
  const isHttpFailure = hasValidMetadata && response.ok === false
  let message = `Bitunix REST response JSON is invalid: ${error.message}`
  let kind = "response"
  if (!hasValidMetadata) {
    message = "Bitunix REST HTTP response metadata is malformed"
  } else if (isHttpFailure) {
    message = "Bitunix REST HTTP request failed with a non-JSON response"
    kind = "http"
  }
  return new BitunixRestError({
    message,
    kind,
    cause: error,
    path,
    status: hasValidMetadata ? response.status : null,
    outcomeUnknown: isHttpFailure
      ? stateChanging && isAmbiguousMutationHttpStatus({ status: response.status })
      : stateChanging,
    retryAfterMs: isHttpFailure ? parseRetryAfterMs({ response }) : null,
  })
}

async function readResponsePayload({ response, path, stateChanging }) {
  validateResponseReader({
    response,
    path,
    stateChanging,
  })
  try {
    if (typeof response.text !== "function") {
      return await response.json()
    }
    const responseText = await response.text()
    if (typeof responseText !== "string") {
      throw new TypeError("Bitunix REST response text must be a string")
    }
    return parseResponseText({
      text: responseText,
      path,
    })
  } catch (error) {
    throw createResponseReadError({
      error,
      response,
      path,
      stateChanging,
    })
  }
}

function normalizeErrorCode({ code }) {
  if (typeof code === "number" && Number.isSafeInteger(code)) {
    return String(code)
  }
  if (typeof code === "string" && /^-?[0-9]+$/.test(code)) {
    return code
  }
  return null
}

/** Keep this in sync with the common Broker mutation HTTP status contract. */
function isAmbiguousMutationHttpStatus({ status }) {
  return status === 408 || status === 409 || status >= 500
}

function validateHttpResponse({ response, payload, path, stateChanging }) {
  if (!hasValidHttpMetadata({ response })) {
    throw new BitunixRestError({
      message: "Bitunix REST HTTP response metadata is malformed",
      kind: "response",
      path,
      status: Number.isInteger(response.status) ? response.status : null,
      outcomeUnknown: stateChanging,
    })
  }
  if (!response.ok) {
    throw new BitunixRestError({
      message: typeof payload?.msg === "string"
        ? payload.msg
        : "Bitunix REST HTTP request failed",
      kind: "http",
      status: response.status,
      path,
      outcomeUnknown: stateChanging && isAmbiguousMutationHttpStatus({ status: response.status }),
      retryAfterMs: response.status === 429 ? parseRetryAfterMs({ response }) : null,
    })
  }
}

function validateResponseEnvelope({ payload, path, response, stateChanging }) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BitunixRestError({
      message: "Bitunix REST response envelope is malformed",
      kind: "response",
      path,
      outcomeUnknown: stateChanging,
    })
  }
  const code = normalizeErrorCode({ code: payload.code })
  if (code === null) {
    throw new BitunixRestError({
      message: "Bitunix REST response has an invalid error code",
      kind: "response",
      path,
      outcomeUnknown: stateChanging,
    })
  }
  if (typeof payload.msg !== "string") {
    throw new BitunixRestError({
      message: "Bitunix REST response is missing its message",
      kind: "response",
      path,
      exchangeCode: code,
      status: response.status,
      outcomeUnknown: stateChanging,
    })
  }
  if (code !== "0") {
    throw new BitunixRestError({
      message: payload.msg,
      kind: "exchange",
      path,
      exchangeCode: code,
      status: response.status,
    })
  }
  return { data: payload.data }
}

function validateResponse({ response, payload, path, stateChanging }) {
  validateHttpResponse({
    response,
    payload,
    path,
    stateChanging,
  })
  return validateResponseEnvelope({
    payload,
    path,
    response,
    stateChanging,
  })
}

function validateCredentials({ apiKey, apiSecret }) {
  const hasApiKey = apiKey !== undefined && apiKey !== null && apiKey !== ""
  const hasApiSecret = apiSecret !== undefined && apiSecret !== null && apiSecret !== ""
  if (hasApiKey || hasApiSecret) {
    if (typeof apiKey !== "string" || !apiKey.trim() ||
        typeof apiSecret !== "string" || !apiSecret.trim()) {
      throw new TypeError("Bitunix REST API key and secret must be provided together")
    }
  }
}

function validateClientOptions({ apiKey, apiSecret, baseUrl, requestTimeout, fetchFn, now, nonceFactory }) {
  validateCredentials({
    apiKey,
    apiSecret,
  })
  if (typeof baseUrl !== "string" || !baseUrl.startsWith("https://")) {
    throw new TypeError("Bitunix REST base URL must use https://")
  }
  if (!Number.isInteger(requestTimeout) || requestTimeout < 1) {
    throw new RangeError("Bitunix REST requestTimeout must be a positive integer")
  }
  if (typeof fetchFn !== "function" || typeof now !== "function" ||
      typeof nonceFactory !== "function") {
    throw new TypeError("Bitunix REST fetch, clock, and nonce dependencies must be functions")
  }
}

/**
 * Bitunix Spot REST client.
 * Requests are signed by default; public requests must explicitly opt into read-only GET mode.
 * The client never retries a request, especially a state-changing order operation.
 */
function createPreparedRequest({ client, method, path, queryParams, body, authenticated, stateChanging }) {
  try {
    return authenticated
      ? createSignedRequest({
        client,
        method,
        path,
        queryParams,
        body,
      })
      : createPublicRequest({
        client,
        method,
        path,
        queryParams,
      })
  } catch (error) {
    if (!stateChanging) {
      throw error
    }
    throw new BitunixRestError({
      message: error instanceof Error ? error.message : String(error),
      kind: "response",
      cause: error,
      path,
      outcomeUnknown: false,
    })
  }
}

export class BitunixRestClient {
  /**
   * @param {{apiKey?: string, apiSecret?: string, baseUrl?: string, requestTimeout?: number, fetchFn?: typeof fetch, now?: () => number, nonceFactory?: () => string}} options
   */
  constructor(options = {}) {
    const {
      apiKey,
      apiSecret,
      baseUrl = DEFAULT_BASE_URL,
      requestTimeout = DEFAULT_REQUEST_TIMEOUT,
      fetchFn = fetch,
      now = Date.now,
      nonceFactory = () => randomBytes(16).toString("hex"),
    } = options
    validateClientOptions({
      apiKey,
      apiSecret,
      baseUrl,
      requestTimeout,
      fetchFn,
      now,
      nonceFactory,
    })

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.requestTimeout = requestTimeout
    this.fetch = fetchFn
    this.now = now
    this.nonceFactory = nonceFactory
  }

  /**
   * Send one Bitunix Spot REST request.
   *
   * @param {{method: "GET"|"POST", path: string, queryParams?: Record<string, string|number|boolean>, body?: object, stateChanging?: boolean, authenticated?: boolean}} input
   * @returns {Promise<{data: unknown}>}
   */
  async request(input = {}) {
    const {
      method,
      path,
      queryParams = {},
      body,
      stateChanging = false,
      authenticated = true,
    } = validateRequest(input)
    if (authenticated && (!this.apiKey || !this.apiSecret)) {
      throw new BitunixRestError({
        message: "Bitunix REST credentials are required for authenticated requests",
        kind: "authentication",
        path,
        outcomeUnknown: false,
      })
    }
    const request = createPreparedRequest({
      client: this,
      method,
      path,
      queryParams,
      body,
      authenticated,
      stateChanging,
    })
    const response = await sendRequest({
      client: this,
      request,
      path,
      stateChanging,
    })
    const payload = await readResponsePayload({
      response,
      path,
      stateChanging,
    })
    return validateResponse({
      response,
      payload,
      path,
      stateChanging,
    })
  }
}

export { DEFAULT_BASE_URL, DEFAULT_REQUEST_TIMEOUT }
