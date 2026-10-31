import { NativeWebSocketTransport } from "./transport.js"
import { parseStreamMessage, validateStreamName } from "./streams-protocol.js"

const DEFAULT_URL = "wss://stream.binance.com:9443/ws"
const DEFAULT_ACK_TIMEOUT = 5_000
const DEFAULT_RECONNECT_DELAY = 1_000
const MAX_RECONNECT_DELAY = 30_000
const CONNECTION_ROTATION_DELAY = 23 * 60 * 60 * 1_000 + 50 * 60 * 1_000
const CONTROL_MESSAGE_INTERVAL = 300
const MAX_STREAMS_PER_CONNECTION = 1_024
const MAX_STREAMS_PER_SUBSCRIBE = 200

function matchesRawStream(stream, message) {
  if (Array.isArray(message)) return message.some((item) => matchesRawStream(stream, item))

  const symbol = typeof message.s === "string" ? message.s.toLowerCase() : null
  if (stream.startsWith("!")) {
    if (stream === "!miniTicker@arr") return message.e === "24hrMiniTicker"
    if (stream === "!ticker@arr") return message.e === "24hrTicker"
    const window = stream.match(/^!ticker_(1h|4h)@arr$/)?.[1]
    return Boolean(window && message.e === `${window}Ticker`)
  }

  const [streamSymbol, streamType] = stream.split("@")
  if (symbol !== streamSymbol) return false

  if (streamType === "aggTrade") return message.e === "aggTrade"
  if (streamType === "trade") return message.e === "trade"
  if (streamType === "miniTicker") return message.e === "24hrMiniTicker"
  if (streamType === "ticker") return message.e === "24hrTicker"
  if (streamType === "bookTicker") return message.e === "bookTicker"
  if (streamType.startsWith("kline_")) return message.e === "kline" && message.k?.i === streamType.slice(6)
  if (streamType.startsWith("ticker_")) return message.e === `${streamType.slice(7)}Ticker`
  if (streamType.startsWith("depth")) return message.e === "depthUpdate"
  return false
}

export class BinanceStreamsClient {
  #transport = null
  #state = "idle"
  #connectPromise = null
  #manualDisconnect = false
  #ready = false
  #listeners = new Map()
  #activeStreams = new Set()
  #pending = new Map()
  #nextRequestId = 1
  #operationChain = Promise.resolve()
  #controlQueue = []
  #lastControlSent = -Infinity
  #pumpTimer = null
  #ackTimeouts = new Set()
  #reconnectTimer = null
  #rotationTimer = null
  #reconnectAttempts = 0

  constructor({
    url = DEFAULT_URL,
    transportFactory = (options) => new NativeWebSocketTransport(options),
    ackTimeout = DEFAULT_ACK_TIMEOUT,
    reconnectDelay = DEFAULT_RECONNECT_DELAY,
    maxReconnectDelay = MAX_RECONNECT_DELAY,
    rotationDelay = CONNECTION_ROTATION_DELAY,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    nowFn = Date.now,
    onError = () => {},
  } = {}) {
    if (typeof url !== "string" || !url.startsWith("wss://") && !url.startsWith("ws://")) {
      throw new TypeError("A valid WebSocket Streams URL is required")
    }
    if (typeof transportFactory !== "function") throw new TypeError("transportFactory must be a function")
    if (!Number.isInteger(ackTimeout) || ackTimeout < 1) throw new RangeError("ackTimeout must be a positive integer")
    if (!Number.isInteger(reconnectDelay) || reconnectDelay < 1) throw new RangeError("reconnectDelay must be a positive integer")
    if (!Number.isInteger(maxReconnectDelay) || maxReconnectDelay < reconnectDelay) {
      throw new RangeError("maxReconnectDelay must be greater than or equal to reconnectDelay")
    }
    if (!Number.isInteger(rotationDelay) || rotationDelay < 1) throw new RangeError("rotationDelay must be a positive integer")
    if (typeof onError !== "function") throw new TypeError("onError must be a function")

    this.url = url
    this.transportFactory = transportFactory
    this.ackTimeout = ackTimeout
    this.reconnectDelay = reconnectDelay
    this.maxReconnectDelay = maxReconnectDelay
    this.rotationDelay = rotationDelay
    this.setTimeout = setTimeoutFn
    this.clearTimeout = clearTimeoutFn
    this.now = nowFn
    this.onError = onError
  }

  get state() {
    return this.#state
  }

  get subscriptions() {
    return [...this.#listeners.keys()]
  }

  connect() {
    if (this.#listeners.size === 0) {
      return Promise.reject(new Error("Subscribe to at least one stream before connecting"))
    }
    return this.#connect(false, [...this.#listeners.keys()])
  }

  async subscribe(streamNames, listener) {
    if (typeof listener !== "function") throw new TypeError("A stream listener function is required")
    const streams = [...new Set((Array.isArray(streamNames) ? streamNames : [streamNames]).map(validateStreamName))]
    if (streams.length === 0) throw new TypeError("At least one stream is required")

    return this.#enqueueOperation(async () => {
      const addedListeners = []
      for (const stream of new Set(streams)) {
        let listeners = this.#listeners.get(stream)
        if (!listeners) {
          listeners = new Set()
          this.#listeners.set(stream, listeners)
        }
        if (!listeners.has(listener)) {
          listeners.add(listener)
          addedListeners.push(stream)
        }
      }

      const desiredStreams = [...this.#listeners.keys()]
      if (desiredStreams.length > MAX_STREAMS_PER_CONNECTION) {
        this.#removeListenerFromStreams(addedListeners, listener)
        throw new RangeError(`Binance allows at most ${MAX_STREAMS_PER_CONNECTION} streams per connection`)
      }

      try {
        if (this.#state !== "open") {
          await this.#connect(this.#reconnectAttempts > 0, desiredStreams)
        }

        const missingStreams = streams.filter((stream) => !this.#activeStreams.has(stream))
        const activatedStreams = []
        try {
          for (const batch of this.#chunk([...new Set(missingStreams)], MAX_STREAMS_PER_SUBSCRIBE)) {
            await this.#request("SUBSCRIBE", batch)
            for (const stream of batch) {
              this.#activeStreams.add(stream)
              activatedStreams.push(stream)
            }
          }
        } catch (error) {
          if (activatedStreams.length > 0) {
            for (const stream of activatedStreams) this.#activeStreams.delete(stream)
            this.#request("UNSUBSCRIBE", activatedStreams)
              .catch((cleanupError) => this.#reportError(cleanupError))
          }
          throw error
        }
      } catch (error) {
        this.#removeListenerFromStreams(addedListeners, listener)
        throw error
      }

      return streams
    })
  }

  async unsubscribe(streamNames, listener) {
    const streams = [...new Set((Array.isArray(streamNames) ? streamNames : [streamNames]).map(validateStreamName))]
    if (streams.length === 0) throw new TypeError("At least one stream is required")
    if (listener !== undefined && typeof listener !== "function") {
      throw new TypeError("listener must be a function when provided")
    }

    return this.#enqueueOperation(async () => {
      const removals = streams.filter((stream) => {
        const listeners = this.#listeners.get(stream)
        return listeners && (listener === undefined || listeners.has(listener)) &&
          (listener === undefined || listeners.size === 1)
      })

      if (removals.length > 0 && this.#state === "open") {
        for (const batch of this.#chunk(removals, MAX_STREAMS_PER_SUBSCRIBE)) {
          await this.#request("UNSUBSCRIBE", batch)
        }
      }

      for (const stream of streams) {
        const listeners = this.#listeners.get(stream)
        if (!listeners) continue
        if (listener === undefined) listeners.clear()
        else listeners.delete(listener)
        if (listeners.size === 0) {
          this.#listeners.delete(stream)
          this.#activeStreams.delete(stream)
        }
      }
      if (this.#listeners.size === 0) this.#clearReconnectTimer()

      return streams
    })
  }

  async disconnect() {
    this.#manualDisconnect = true
    this.#clearReconnectTimer()
    this.#clearRotationTimer()
    this.#clearPumpTimer()
    this.#controlQueue.length = 0
    this.#rejectPending(new Error("Binance Streams client disconnected"))
    this.#listeners.clear()
    this.#activeStreams.clear()

    const transport = this.#transport
    this.#transport = null
    this.#state = "closed"
    this.#ready = false
    if (transport) await transport.close()
  }

  #enqueueOperation(operation) {
    const result = this.#operationChain.then(operation)
    this.#operationChain = result.catch(() => {})
    return result
  }

  async #connect(isReconnect, initialStreams = []) {
    if (isReconnect && this.#listeners.size === 0) return this
    if (this.#state === "open") return this
    if (this.#state === "connecting") return this.#connectPromise
    if (this.#manualDisconnect) throw new Error("Binance Streams client has been disconnected")

    const connectionStreams = isReconnect ? [...this.#listeners.keys()] : [...initialStreams]
    if (connectionStreams.length === 0) throw new Error("At least one desired stream is required to connect")

    this.#clearReconnectTimer()
    this.#state = "connecting"
    this.#ready = false

    let transport
    try {
      const url = this.#buildCombinedUrl(connectionStreams.slice(0, MAX_STREAMS_PER_SUBSCRIBE))
      transport = this.transportFactory({ url })
      for (const method of ["connect", "send", "close", "onMessage", "onError", "onClose"]) {
        if (typeof transport?.[method] !== "function") {
          throw new TypeError(`Streams transport must implement ${method}()`)
        }
      }
    } catch (error) {
      this.#state = "closed"
      if (!this.#manualDisconnect && isReconnect) this.#scheduleReconnect()
      throw error
    }

    this.#transport = transport
    transport.onMessage((message) => this.#handleMessage(message))
    transport.onError((error) => this.#reportError(error))
    transport.onClose((event) => this.#handleClose(event))

    this.#connectPromise = transport.connect().then(async () => {
      if (this.#transport !== transport || this.#manualDisconnect) {
        await transport.close()
        throw new Error("Binance Streams connection was superseded")
      }

      this.#state = "open"
      this.#scheduleRotation()

      const initialBatch = connectionStreams.slice(0, MAX_STREAMS_PER_SUBSCRIBE)
      const listedStreams = await this.#request("LIST_SUBSCRIPTIONS")
      if (!Array.isArray(listedStreams) || !initialBatch.every((stream) => listedStreams.includes(stream))) {
        throw new Error("Binance combined-stream connection did not confirm its initial subscriptions")
      }

      const desiredStreams = new Set(this.#listeners.keys())
      const obsoleteInitialStreams = initialBatch.filter((stream) => !desiredStreams.has(stream))
      if (obsoleteInitialStreams.length > 0) {
        await this.#request("UNSUBSCRIBE", obsoleteInitialStreams)
      }
      for (const stream of initialBatch) {
        if (desiredStreams.has(stream)) this.#activeStreams.add(stream)
      }

      const remainingStreams = connectionStreams
        .slice(MAX_STREAMS_PER_SUBSCRIBE)
        .filter((stream) => desiredStreams.has(stream))
      for (const batch of this.#chunk(remainingStreams, MAX_STREAMS_PER_SUBSCRIBE)) {
        await this.#request("SUBSCRIBE", batch)
        for (const stream of batch) this.#activeStreams.add(stream)
      }

      this.#ready = true
      this.#reconnectAttempts = 0
      return this
    }).catch(async (error) => {
      this.#ready = false
      this.#activeStreams.clear()
      if (this.#transport === transport) {
        this.#transport = null
        this.#state = "closed"
        try {
          await transport.close()
        } catch (closeError) {
          this.#reportError(closeError)
        }
      }
      if (!this.#manualDisconnect && isReconnect) this.#scheduleReconnect()
      throw error
    }).finally(() => {
      if (this.#transport === transport) this.#connectPromise = null
    })

    return this.#connectPromise
  }

  #buildCombinedUrl(streams) {
    const url = new URL(this.url)
    if (/\/ws\/?$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/ws\/?$/, "/stream")
    } else if (!url.pathname.endsWith("/stream")) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/stream`
    }
    url.searchParams.set("streams", streams.join("/"))
    return url.toString()
  }

  #removeListenerFromStreams(streams, listener) {
    for (const stream of streams) {
      const listeners = this.#listeners.get(stream)
      listeners?.delete(listener)
      if (listeners?.size === 0) this.#listeners.delete(stream)
    }
    if (this.#listeners.size === 0) this.#clearReconnectTimer()
  }

  #request(method, streams) {
    if (this.#state !== "open" || !this.#transport) {
      return Promise.reject(new Error(`Cannot ${method} streams while disconnected`))
    }

    const id = this.#nextRequestId++
    return new Promise((resolve, reject) => {
      const timeout = this.setTimeout(() => {
        this.#pending.delete(id)
        this.#ackTimeouts.delete(timeout)
        this.#controlQueue = this.#controlQueue.filter((item) => item.id !== id)
        reject(new Error(`Binance Streams ${method} acknowledgement timed out`))
      }, this.ackTimeout)
      this.#ackTimeouts.add(timeout)
      this.#pending.set(id, { resolve, reject, timeout, method })

      const request = { method, id }
      if (streams !== undefined) request.params = streams
      this.#controlQueue.push({ id, payload: JSON.stringify(request) })
      this.#pumpControlQueue()
    })
  }

  #pumpControlQueue() {
    if (this.#pumpTimer !== null || this.#controlQueue.length === 0 || this.#state !== "open") return
    const wait = Math.max(0, CONTROL_MESSAGE_INTERVAL - (this.now() - this.#lastControlSent))
    if (wait > 0) {
      this.#pumpTimer = this.setTimeout(() => {
        this.#pumpTimer = null
        this.#pumpControlQueue()
      }, wait)
      return
    }

    const item = this.#controlQueue.shift()
    try {
      this.#transport.send(item.payload)
      this.#lastControlSent = this.now()
    } catch (error) {
      const pending = this.#pending.get(item.id)
      if (pending) {
        this.#pending.delete(item.id)
        this.#clearAckTimeout(pending.timeout)
        pending.reject(error)
      }
    }

    if (this.#controlQueue.length > 0) {
      this.#pumpTimer = this.setTimeout(() => {
        this.#pumpTimer = null
        this.#pumpControlQueue()
      }, CONTROL_MESSAGE_INTERVAL)
    }
  }

  #handleMessage(rawMessage) {
    let parsed
    try {
      parsed = parseStreamMessage(rawMessage)
    } catch (error) {
      this.#reportError(error)
      return
    }

    if (parsed.acknowledgement) {
      const { id, result, code, msg } = parsed.acknowledgement
      const pending = this.#pending.get(id)
      if (!pending) return
      this.#pending.delete(id)
      this.#clearAckTimeout(pending.timeout)
      if (code !== undefined) {
        pending.reject(new Error(`Binance Streams ${pending.method} failed (${code}): ${msg || "unknown error"}`))
      } else if (pending.method === "LIST_SUBSCRIPTIONS" && !Array.isArray(result)) {
        pending.reject(new Error("Malformed Binance Streams LIST_SUBSCRIPTIONS acknowledgement"))
      } else if (pending.method !== "LIST_SUBSCRIPTIONS" && result !== null) {
        pending.reject(new Error(`Malformed Binance Streams ${pending.method} acknowledgement`))
      } else {
        pending.resolve(result)
      }
      return
    }

    if (parsed.serverShutdown) {
      this.#reportError(new Error("Binance Streams server is shutting down"))
      this.#transport?.close(1000, "Binance server shutdown").catch((error) => this.#reportError(error))
      return
    }

    const messages = Array.isArray(parsed.data) ? parsed.data : [parsed.data]
    for (const message of messages) {
      if (message.e === "serverShutdown") {
        this.#reportError(new Error("Binance Streams server is shutting down"))
        this.#transport?.close(1012, "Binance server shutdown").catch((error) => this.#reportError(error))
        return
      }
      for (const [stream, listeners] of this.#listeners) {
        const matches = parsed.stream ? parsed.stream === stream : matchesRawStream(stream, message)
        if (!matches) continue
        for (const listener of listeners) {
          try {
            listener(message)
          } catch (error) {
            this.#reportError(error)
          }
        }
      }
    }
  }

  #handleClose(event) {
    const wasReady = this.#ready
    this.#ready = false
    this.#state = "closed"
    this.#transport = null
    this.#activeStreams.clear()
    this.#clearRotationTimer()
    this.#clearPumpTimer()
    this.#controlQueue.length = 0
    this.#rejectPending(new Error(`Binance Streams connection closed (${event.code}): ${event.reason}`))
    if (!this.#manualDisconnect && wasReady && this.#listeners.size > 0) this.#scheduleReconnect()
  }

  #scheduleReconnect() {
    if (this.#manualDisconnect || this.#reconnectTimer !== null || this.#listeners.size === 0) return
    const delay = Math.min(
      this.reconnectDelay * (2 ** this.#reconnectAttempts),
      this.maxReconnectDelay,
    )
    this.#reconnectAttempts += 1
    this.#reconnectTimer = this.setTimeout(() => {
      this.#reconnectTimer = null
      this.#connect(true).catch((error) => this.#reportError(error))
    }, delay)
  }

  #scheduleRotation() {
    this.#clearRotationTimer()
    this.#rotationTimer = this.setTimeout(() => {
      this.#rotationTimer = null
      this.#transport?.close(1000, "Scheduled Binance Streams rotation")
        .catch((error) => this.#reportError(error))
    }, this.rotationDelay)
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      this.#clearAckTimeout(pending.timeout)
      pending.reject(error)
    }
    this.#pending.clear()
  }

  #clearAckTimeout(timeout) {
    this.clearTimeout(timeout)
    this.#ackTimeouts.delete(timeout)
  }

  #clearReconnectTimer() {
    if (this.#reconnectTimer !== null) {
      this.clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
  }

  #clearRotationTimer() {
    if (this.#rotationTimer !== null) {
      this.clearTimeout(this.#rotationTimer)
      this.#rotationTimer = null
    }
  }

  #clearPumpTimer() {
    if (this.#pumpTimer !== null) {
      this.clearTimeout(this.#pumpTimer)
      this.#pumpTimer = null
    }
  }

  #reportError(error) {
    try {
      this.onError(error)
    } catch {
      // Observers cannot interfere with the stream lifecycle.
    }
  }

  #chunk(values, size) {
    const chunks = []
    for (let index = 0; index < values.length; index += size) {
      chunks.push(values.slice(index, index + size))
    }
    return chunks
  }
}
