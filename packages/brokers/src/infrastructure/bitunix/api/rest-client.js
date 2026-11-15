import { randomBytes } from "node:crypto"
import { createRestSignature } from "../auth/create-rest-signature.js"

const DEFAULT_BASE_URL = "https://openapi.bitunix.com"
const DEFAULT_REQUEST_TIMEOUT = 10_000

/** Error returned by the Bitunix Spot REST API or transport boundary. */
export class BitunixRestError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string|null, status?: number|null, path?: string|null, outcomeUnknown?: boolean}} [options]
   */
  constructor(message, { code = null, status = null, path = null, outcomeUnknown = false } = {}) {
    super(message)
    this.name = "BitunixRestError"
    this.code = code
    this.status = status
    this.path = path
    this.outcomeUnknown = outcomeUnknown
  }
}

function parseResponseText({ text, path }) {
  if (!path.endsWith("/user/account")) return JSON.parse(text)
  const losslessText = text.replace(
    /("(?:balance|balanceLocked)"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
    (_match, prefix, amount) => prefix + JSON.stringify(amount),
  )
  return JSON.parse(losslessText)
}

/**
 * Signed Bitunix Spot REST client. It never retries a request, especially a
 * state-changing order operation whose response may have been lost.
 */
export class BitunixRestClient {
  /**
   * @param {{apiKey: string, apiSecret: string, baseUrl?: string, requestTimeout?: number, fetchFn?: typeof fetch, now?: () => number, nonceFactory?: () => string}} options
   */
  constructor({
    apiKey,
    apiSecret,
    baseUrl = DEFAULT_BASE_URL,
    requestTimeout = DEFAULT_REQUEST_TIMEOUT,
    fetchFn = fetch,
    now = Date.now,
    nonceFactory = () => randomBytes(16).toString("hex"),
  } = {}) {
    if (typeof apiKey !== "string" || !apiKey.trim() ||
        typeof apiSecret !== "string" || !apiSecret.trim()) {
      throw new TypeError("Bitunix REST API key and secret are required")
    }
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

    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.requestTimeout = requestTimeout
    this.fetch = fetchFn
    this.now = now
    this.nonceFactory = nonceFactory
  }

  /**
   * Send one signed Bitunix Spot REST request.
   *
   * @param {"GET"|"POST"} method
   * @param {string} path
   * @param {{queryParams?: Record<string, string|number|boolean>, body?: object, stateChanging?: boolean}} [options]
   * @returns {Promise<{data: unknown}>}
   */
  async request(method, path, {
    queryParams = {},
    body,
    stateChanging = false,
  } = {}) {
    const normalizedMethod = typeof method === "string" ? method.toUpperCase() : ""
    if (normalizedMethod !== "GET" && normalizedMethod !== "POST") {
      throw new TypeError("Bitunix REST method must be GET or POST")
    }
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      throw new TypeError("Bitunix REST path must be an absolute API path")
    }
    if (!queryParams || typeof queryParams !== "object" || Array.isArray(queryParams)) {
      throw new TypeError("Bitunix REST queryParams must be an object")
    }
    if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body))) {
      throw new TypeError("Bitunix REST body must be an object")
    }
    if (normalizedMethod === "GET" && body !== undefined) {
      throw new TypeError("Bitunix REST GET requests cannot include a body")
    }

    const nonce = this.nonceFactory()
    const timestamp = String(this.now())
    if (typeof nonce !== "string" || !nonce.trim()) {
      throw new TypeError("Bitunix REST nonce must be a non-empty string")
    }
    if (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) < 0) {
      throw new RangeError("Bitunix REST timestamp must be a non-negative safe integer")
    }

    const sortedQuery = Object.fromEntries(
      Object.keys(queryParams).sort().map((key) => [key, queryParams[key]]),
    )
    const bodyText = body === undefined ? undefined : JSON.stringify(body)
    const signature = createRestSignature({
      nonce,
      timestamp,
      apiKey: this.apiKey,
      secretKey: this.apiSecret,
      queryParams: sortedQuery,
      ...(bodyText === undefined ? {} : { body: bodyText }),
    })
    const url = new URL(path, this.baseUrl)
    for (const [key, value] of Object.entries(sortedQuery)) {
      url.searchParams.set(key, String(value))
    }

    let response
    try {
      response = await this.fetch(url.toString(), {
        method: normalizedMethod,
        headers: {
          "api-key": this.apiKey,
          nonce,
          timestamp,
          sign: signature,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(this.requestTimeout),
        ...(bodyText === undefined ? {} : { body: bodyText }),
      })
    } catch (error) {
      throw new BitunixRestError(error.message, {
        path,
        outcomeUnknown: stateChanging,
      })
    }

    if (!response || (typeof response.json !== "function" && typeof response.text !== "function")) {
      throw new BitunixRestError("Bitunix REST response is malformed", {
        path,
        status: response?.status ?? null,
        outcomeUnknown: stateChanging,
      })
    }

    let payload
    try {
      if (typeof response.text === "function") {
        const responseText = await response.text()
        if (typeof responseText !== "string") {
          throw new TypeError("Bitunix REST response text must be a string")
        }
        payload = parseResponseText({ text: responseText,
          path })
      } else {
        payload = await response.json()
      }
    } catch (error) {
      throw new BitunixRestError(`Bitunix REST response JSON is invalid: ${error.message}`, {
        path,
        status: response.status,
        outcomeUnknown: stateChanging,
      })
    }

    if (!response.ok) {
      throw new BitunixRestError(
        typeof payload?.msg === "string" ? payload.msg : "Bitunix REST HTTP request failed",
        {
          status: response.status,
          path,
          code: payload?.code === undefined ? null : String(payload.code),
          outcomeUnknown: stateChanging && response.status >= 500,
        },
      )
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        String(payload.code) !== "0") {
      throw new BitunixRestError(
        typeof payload?.msg === "string" ? payload.msg : "Bitunix REST response has an invalid success code",
        {
          path,
          code: payload?.code === undefined ? null : String(payload.code),
        },
      )
    }

    return { data: payload.data }
  }
}

export { DEFAULT_BASE_URL, DEFAULT_REQUEST_TIMEOUT }
