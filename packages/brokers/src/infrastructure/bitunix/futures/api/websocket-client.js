import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import { createBitunixWebSocketSignature } from "../../spot/auth/create-websocket-signature.js"
import { BitunixWebSocketTransport } from "../../spot/api/websocket-transport.js"
import {
  DEFAULT_PRIVATE_WS_URL,
  DEFAULT_PUBLIC_WS_URL,
} from "./config/bitunix-futures-config.js"

const MAX_CHANNELS_PER_CONNECTION = 300
const MAX_MESSAGES_PER_SECOND = 5
const HEARTBEAT_INTERVAL_MS = 3_000
const PRIVATE_CHANNELS = new Set(["balance", "position", "order", "tpsl"])
const PUBLIC_CHANNELS = new Set([
  "depth_books",
  "depth_book1",
  "depth_book5",
  "depth_book15",
  "trade",
  "ticker",
  "tickers",
  "price",
])
const FUTURES_KLINE_INTERVALS = new Set([
  "1min",
  "3min",
  "5min",
  "15min",
  "30min",
  "60min",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1day",
  "3day",
  "1week",
  "1month",
])

function validateUrl({ channelType, url }) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new TypeError("Bitunix Futures WebSocket URL must be the official endpoint")
  }
  const expectedUrl = channelType === "private"
    ? DEFAULT_PRIVATE_WS_URL
    : DEFAULT_PUBLIC_WS_URL
  if (parsed.href !== expectedUrl) {
    throw new TypeError("Bitunix Futures WebSocket URL must be the official channel endpoint")
  }
}

function validateOptions({
  apiKey,
  apiSecret,
  channelType,
  url,
  transportFactory,
  now,
  nonceFactory,
  setIntervalFn,
  clearIntervalFn,
}) {
  if (!["public", "private"].includes(channelType)) {
    throw new TypeError("Bitunix Futures WebSocket channelType must be public or private")
  }
  validateUrl({
    channelType,
    url,
  })
  if (channelType === "private" &&
      (typeof apiKey !== "string" || !apiKey.trim() ||
       typeof apiSecret !== "string" || !apiSecret.trim())) {
    throw new TypeError("Bitunix Futures private WebSocket credentials are required")
  }
  if (typeof transportFactory !== "function" || typeof now !== "function" ||
      typeof nonceFactory !== "function" || typeof setIntervalFn !== "function" ||
      typeof clearIntervalFn !== "function") {
    throw new TypeError("Bitunix Futures WebSocket dependencies must be functions")
  }
}

function normalizeMessage({ message }) {
  if (typeof message === "string") {
    return message
  }
  if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
    return new TextDecoder().decode(message)
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(message)) {
    return message.toString("utf8")
  }
  throw new TypeError("Bitunix Futures WebSocket supports text JSON messages only")
}

function createChannelKey({ channel }) {
  return `${channel.ch}:${channel.symbol ?? ""}`
}

/**
 * Bitunix Futures channel WebSocket client.
 *
 * Login acknowledgement is required before private subscriptions are sent.
 * The protocol exposes no event sequence or replay cursor; reconnecting never
 * restores a claim of complete user-data coverage.
 */
export class BitunixFuturesWebSocketClient extends EventEmitter {
  #transport
  #transportFactory
  #removeListeners = []
  #apiKey
  #apiSecret
  #now
  #nonceFactory
  #setInterval
  #clearInterval
  #heartbeatTimer = null
  #sentAt = []
  #subscriptions = new Map()
  #state = "idle"
  #authenticated = false

  constructor(options = {}) {
    super()
    const {
      apiKey,
      apiSecret,
      channelType = "public",
      url = channelType === "private" ? DEFAULT_PRIVATE_WS_URL : DEFAULT_PUBLIC_WS_URL,
      transportFactory = (transportOptions) => new BitunixWebSocketTransport(transportOptions),
      now = Date.now,
      nonceFactory = () => randomBytes(16).toString("hex"),
      setIntervalFn = setInterval,
      clearIntervalFn = clearInterval,
    } = options
    validateOptions({
      apiKey,
      apiSecret,
      channelType,
      url,
      transportFactory,
      now,
      nonceFactory,
      setIntervalFn,
      clearIntervalFn,
    })
    this.channelType = channelType
    this.url = url
    this.#apiKey = apiKey
    this.#apiSecret = apiSecret
    this.#transportFactory = transportFactory
    this.#now = now
    this.#nonceFactory = nonceFactory
    this.#setInterval = setIntervalFn
    this.#clearInterval = clearIntervalFn
    this.#createTransport()
  }

  get state() {
    return this.#state
  }

  get authenticated() {
    return this.#authenticated
  }

  get subscriptions() {
    return Object.freeze([...this.#subscriptions.values()])
  }

  async connect() {
    if (this.#state === "open") {
      return this
    }
    if (this.#state !== "idle" && this.#state !== "closed") {
      throw new Error(`Cannot connect Bitunix Futures WebSocket in state ${this.#state}`)
    }
    if (this.#state === "closed") {
      this.#createTransport()
    }
    this.#state = "connecting"
    try {
      await this.#transport.connect()
      this.#state = "open"
      if (this.channelType === "private") {
        this.#sendLogin()
      }
      this.#startHeartbeat()
      this.emit("status", Object.freeze({
        state: this.#state,
        authenticated: this.#authenticated,
        recoveryRequired: false,
      }))
      return this
    } catch (error) {
      this.#state = "closed"
      this.#removeTransportListeners()
      throw error
    }
  }

  subscribe({ channels } = {}) {
    const normalized = this.#normalizeChannels({
      channels,
    })
    if (this.#state !== "open") {
      throw new Error("Bitunix Futures WebSocket must be connected before subscribing")
    }
    if (this.channelType === "private" && !this.#authenticated) {
      throw new Error("Bitunix Futures private WebSocket login has not been acknowledged")
    }
    const newChannels = normalized.filter((channel) => !this.#subscriptions.has(createChannelKey({
      channel,
    })))
    if (this.#subscriptions.size + newChannels.length > MAX_CHANNELS_PER_CONNECTION) {
      throw new RangeError("Bitunix Futures WebSocket cannot exceed 300 channel subscriptions per connection")
    }
    if (newChannels.length === 0) {
      return Object.freeze({
        sent: false,
        channels: this.subscriptions,
      })
    }
    this.#send({
      op: "subscribe",
      args: newChannels,
    })
    for (const channel of newChannels) {
      this.#subscriptions.set(createChannelKey({ channel }), channel)
    }
    const result = Object.freeze({
      sent: true,
      channels: Object.freeze(newChannels),
    })
    this.emit("subscriptionSent", result)
    return result
  }

  unsubscribe({ channels } = {}) {
    const normalized = this.#normalizeChannels({
      channels,
    })
    if (this.#state !== "open") {
      throw new Error("Bitunix Futures WebSocket must be connected before unsubscribing")
    }
    if (this.channelType === "private" && !this.#authenticated) {
      throw new Error("Bitunix Futures private WebSocket login has not been acknowledged")
    }
    const existing = normalized.filter((channel) => this.#subscriptions.has(createChannelKey({
      channel,
    })))
    if (existing.length === 0) {
      return Object.freeze({
        sent: false,
        channels: Object.freeze([]),
      })
    }
    this.#send({
      op: "unsubscribe",
      args: existing,
    })
    for (const channel of existing) {
      this.#subscriptions.delete(createChannelKey({ channel }))
    }
    const result = Object.freeze({
      sent: true,
      channels: Object.freeze(existing),
    })
    this.emit("subscriptionSent", result)
    return result
  }

  ping() {
    if (this.#state !== "open") {
      throw new Error("Bitunix Futures WebSocket must be connected before pinging")
    }
    const timestamp = Math.floor(this.#now() / 1000)
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new RangeError("Bitunix Futures WebSocket ping timestamp must be a non-negative safe integer")
    }
    this.#send({
      op: "ping",
      ping: timestamp,
    })
  }

  async disconnect() {
    if (this.#state === "closed") {
      return
    }
    this.#state = "closing"
    this.#stopHeartbeat()
    this.#authenticated = false
    this.#subscriptions.clear()
    try {
      await this.#transport.close()
    } finally {
      this.#state = "closed"
      this.#removeTransportListeners()
      this.emit("status", Object.freeze({
        state: this.#state,
        authenticated: false,
        recoveryRequired: false,
      }))
    }
  }

  #createTransport() {
    this.#transport = this.#transportFactory({
      url: this.url,
    })
    for (const method of ["connect", "send", "close", "onMessage", "onClose", "onError"]) {
      if (typeof this.#transport?.[method] !== "function") {
        throw new TypeError(`Bitunix Futures WebSocket transport must implement ${method}()`)
      }
    }
    this.#removeListeners = [
      this.#transport.onMessage((message) => this.#handleMessage(message)),
      this.#transport.onClose((event) => this.#handleClose(event)),
      this.#transport.onError((error) => this.#handleError(error)),
    ].filter((remove) => typeof remove === "function")
  }

  #sendLogin() {
    const nonce = this.#nonceFactory()
    const timestamp = String(Math.floor(this.#now() / 1000))
    if (typeof nonce !== "string" || !nonce.trim()) {
      throw new TypeError("Bitunix Futures WebSocket nonce must be a non-empty string")
    }
    if (!Number.isSafeInteger(Number(timestamp)) || Number(timestamp) < 0) {
      throw new RangeError("Bitunix Futures WebSocket login timestamp must be a non-negative safe integer")
    }
    const params = {
      apiKey: this.#apiKey,
      timestamp,
      nonce,
    }
    const sign = createBitunixWebSocketSignature({
      nonce,
      timestamp,
      apiKey: this.#apiKey,
      secretKey: this.#apiSecret,
      params,
    })
    this.#send({
      op: "login",
      args: [{
        ...params,
        timestamp: Number(timestamp),
        sign,
      }],
    })
    this.emit("status", Object.freeze({
      state: this.#state,
      authenticated: false,
      loginSent: true,
      recoveryRequired: false,
    }))
  }

  #normalizeChannels({ channels }) {
    if (!Array.isArray(channels) || channels.length === 0) {
      throw new TypeError("Bitunix Futures WebSocket channels must be a non-empty array")
    }
    const allowed = this.channelType === "private" ? PRIVATE_CHANNELS : PUBLIC_CHANNELS
    const normalized = channels.map((channel) => {
      if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
        throw new TypeError("Bitunix Futures WebSocket channel must be an object")
      }
      const ch = typeof channel.ch === "string" ? channel.ch : ""
      const isKlineChannel = this.channelType === "public" &&
        /^(market|mark)_kline_/.test(ch) &&
        FUTURES_KLINE_INTERVALS.has(ch.replace(/^(market|mark)_kline_/, ""))
      if (!allowed.has(ch) && !isKlineChannel) {
        throw new TypeError(`Bitunix Futures WebSocket channel is unsupported: ${ch || "unknown"}`)
      }
      if (this.channelType === "private") {
        if (channel.symbol !== undefined) {
          throw new TypeError("Bitunix Futures private channels must not include a symbol")
        }
        return Object.freeze({ ch })
      }
      if (typeof channel.symbol !== "string" || !channel.symbol.trim()) {
        throw new TypeError("Bitunix Futures public channels require a symbol")
      }
      return Object.freeze({
        ch,
        symbol: channel.symbol.trim().toUpperCase(),
      })
    })
    const keys = new Set()
    for (const channel of normalized) {
      const key = createChannelKey({ channel })
      if (keys.has(key)) {
        throw new TypeError("Bitunix Futures WebSocket channel list contains duplicates")
      }
      keys.add(key)
    }
    return normalized
  }

  #send(payload) {
    const now = this.#now()
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new RangeError("Bitunix Futures WebSocket clock must return a non-negative safe integer")
    }
    this.#sentAt = this.#sentAt.filter((timestamp) => now - timestamp < 1_000)
    if (this.#sentAt.length >= MAX_MESSAGES_PER_SECOND) {
      throw new Error("Bitunix Futures WebSocket outbound rate limit is 5 messages per second")
    }
    this.#transport.send(JSON.stringify(payload))
    this.#sentAt.push(now)
  }

  #startHeartbeat() {
    this.#stopHeartbeat()
    this.#heartbeatTimer = this.#setInterval(() => {
      if (this.#state !== "open") {
        return
      }
      try {
        this.ping()
      } catch (error) {
        this.emit("clientError", error)
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  #stopHeartbeat() {
    if (this.#heartbeatTimer !== null) {
      this.#clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = null
    }
  }

  #handleMessage(message) {
    let data
    try {
      data = JSON.parse(normalizeMessage({
        message,
      }))
    } catch (error) {
      this.emit("clientError", new Error("Bitunix Futures WebSocket received invalid JSON", {
        cause: error,
      }))
      return
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      this.emit("clientError", new TypeError("Bitunix Futures WebSocket message must be an object"))
      return
    }
    if (this.#handleControlMessage(data)) {
      return
    }
    this.emit("controlMessage", data)
  }

  #handleControlMessage(data) {
    if (data.op === "pong") {
      this.emit("pong", data)
      return true
    }
    if (data.op === "login") {
      this.#handleLoginMessage(data)
      return true
    }
    if (typeof data.ch === "string") {
      this.#handleChannelMessage(data)
      return true
    }
    return false
  }

  #handleLoginMessage(data) {
    if (data.code === 0 || data.code === "0") {
      this.#authenticated = true
      this.emit("authenticated")
      this.emit("status", Object.freeze({
        state: this.#state,
        authenticated: true,
        recoveryRequired: true,
      }))
      return
    }
    this.#authenticated = false
    this.emit("clientError", new Error(`Bitunix Futures WebSocket login failed: ${String(data.msg ?? data.code ?? "unknown error")}`))
  }

  #handleChannelMessage(data) {
    const allowed = this.channelType === "private" ? PRIVATE_CHANNELS : PUBLIC_CHANNELS
    const interval = data.ch.replace(/^(market|mark)_kline_/, "")
    const isKlineChannel = this.channelType === "public" &&
      /^(market|mark)_kline_/.test(data.ch) &&
      FUTURES_KLINE_INTERVALS.has(interval)
    const unsupportedChannel = !allowed.has(data.ch) && !isKlineChannel
    const unauthenticatedPrivateEvent = this.channelType === "private" && !this.#authenticated
    if (unsupportedChannel || unauthenticatedPrivateEvent) {
      this.emit("clientError", new TypeError(`Bitunix Futures WebSocket received unsupported or unauthenticated channel ${data.ch}`))
      return
    }
    this.emit("channel", data)
    this.emit(data.ch, data)
  }

  #handleClose(event) {
    if (this.#state === "closed" || this.#state === "closing") {
      return
    }
    this.#stopHeartbeat()
    this.#state = "closed"
    this.#authenticated = false
    this.#subscriptions.clear()
    this.#removeTransportListeners()
    this.emit("status", Object.freeze({
      state: this.#state,
      authenticated: false,
      recoveryRequired: true,
      closeEvent: event,
    }))
  }

  #handleError(error) {
    this.emit("clientError", error)
    this.#stopHeartbeat()
    this.#state = "closed"
    this.#authenticated = false
    this.#subscriptions.clear()
    this.#removeTransportListeners()
    this.emit("status", Object.freeze({
      state: this.#state,
      authenticated: false,
      recoveryRequired: true,
    }))
  }

  #removeTransportListeners() {
    for (const remove of this.#removeListeners) {
      remove()
    }
    this.#removeListeners = []
  }
}
