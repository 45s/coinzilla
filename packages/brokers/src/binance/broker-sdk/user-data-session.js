import { createUserDataEventDeduplicator } from "./user-data-event-deduplicator.js"
import { adaptMsg } from "../websocket-stream/index.js"

function validateCallback(callback, name) {
  if (typeof callback !== "function") {
    throw new TypeError(`${name} callback must be a function`)
  }
}

export class BinanceUserDataSession {
  #subscribers = new Map()
  #nextSubscriberId = 0
  #subscriptionId = null
  #subscribePromise = null
  #reconnectPromise = null
  #reconnectTimer = null
  #reconnectAttempts = 0
  #removeClientListeners = []
  #stopped = false
  #recoveryRequired = false
  #deduplicator = createUserDataEventDeduplicator()

  constructor({
    getClient,
    createClient,
    setClient,
    setConnected,
    setUnavailable,
    logger = {},
    reconnectDelay = 5000,
    maxReconnectAttempts = 5,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    if (typeof getClient !== "function" || typeof createClient !== "function" ||
        typeof setClient !== "function" || typeof setConnected !== "function" ||
        typeof setUnavailable !== "function") {
      throw new TypeError("User-data session requires client and state callbacks")
    }
    if (!Number.isInteger(reconnectDelay) || reconnectDelay < 0 ||
        !Number.isInteger(maxReconnectAttempts) || maxReconnectAttempts < 1) {
      throw new RangeError("Invalid user-data reconnect policy")
    }

    this.getClient = getClient
    this.createClient = createClient
    this.setClient = setClient
    this.setConnected = setConnected
    this.setUnavailable = setUnavailable
    this.logger = logger
    this.reconnectDelay = reconnectDelay
    this.maxReconnectAttempts = maxReconnectAttempts
    this.setTimeout = setTimeoutFn
    this.clearTimeout = clearTimeoutFn
  }

  get subscriberCount() {
    return this.#subscribers.size
  }

  get subscriptionId() {
    return this.#subscriptionId
  }

  start() {
    this.#stopped = false
  }

  async resume() {
    if (this.#stopped || this.#subscribers.size === 0) return
    await this.#ensureRemoteSubscription()
  }

  async subscribe({ onEvent, onStatus }) {
    validateCallback(onEvent, "onEvent")
    if (onStatus !== undefined) validateCallback(onStatus, "onStatus")
    if (this.#stopped) throw new Error("User-data session is stopped")

    const id = ++this.#nextSubscriberId
    const subscriber = { onEvent, onStatus, recoveryAcknowledged: false, active: true }
    this.#subscribers.set(id, subscriber)

    try {
      await this.#ensureRemoteSubscription()
    } catch (error) {
      this.#subscribers.delete(id)
      if (this.#subscribers.size === 0) this.#detachClientListeners()
      throw error
    }

    const data = {
      acknowledgeRecovery: () => this.#acknowledgeRecovery(id),
      disconnect: () => this.#removeSubscriber(id),
    }
    Object.defineProperty(data, "subscriptionId", {
      enumerable: true,
      get: () => this.#subscriptionId,
    })
    return { data }
  }

  async stop() {
    this.#stopped = true
    this.#clearReconnectTimer()
    this.#subscribers.clear()
    this.#subscriptionId = null
    this.#subscribePromise = null
    this.#recoveryRequired = false
    this.setUnavailable(true)
    this.#detachClientListeners()
    this.#deduplicator.clear()
  }

  async #ensureRemoteSubscription() {
    if (this.#subscriptionId !== null) return this.#subscriptionId
    if (this.#subscribePromise) return this.#subscribePromise

    const client = this.getClient()
    if (!client || client.state !== "open") {
      throw new Error("Binance WebSocket API must be open before subscribing to user data")
    }

    this.setUnavailable(true)
    this.#bindClient(client)
    this.#subscribePromise = client.request(
      "userDataStream.subscribe.signature",
      {},
      { signed: true },
    ).then(async (response) => {
      const subscriptionId = response.data?.subscriptionId
      if (!Number.isSafeInteger(subscriptionId) || subscriptionId < 0) {
        throw new Error("Binance user-data subscription response did not include a valid subscriptionId")
      }
      if (this.#stopped || this.#subscribers.size === 0) {
        try {
          await client.request("userDataStream.unsubscribe", { subscriptionId })
        } catch (error) {
          this.logger.warn?.("Unable to clean up an unused Binance user-data subscription", error)
        }
        return subscriptionId
      }
      this.#subscriptionId = subscriptionId
      this.#reconnectAttempts = 0
      this.setUnavailable(this.#recoveryRequired)
      if (this.#recoveryRequired) {
        this.#notify({
          type: "recovered",
          subscriptionId,
          reconciliationRequired: true,
          recoveryRequired: true,
        })
      }
      return subscriptionId
    }).finally(() => {
      this.#subscribePromise = null
    })

    return this.#subscribePromise
  }

  #bindClient(client) {
    this.#detachClientListeners()
    this.#removeClientListeners = [
      client.onEvent((message) => this.#handleEvent(message)),
      client.onError?.((error) => this.#handleError(error)),
      client.onClose?.((event) => this.#handleClose(event)),
    ].filter((remove) => typeof remove === "function")
  }

  #handleEvent(message) {
    if (this.#stopped || this.#subscribers.size === 0 ||
        message?.subscriptionId !== this.#subscriptionId) return

    const event = message?.event && typeof message.event === "object"
      ? message.event
      : message

    if (event.e === "eventStreamTerminated") {
      this.#subscriptionId = null
      this.#recoveryRequired = true
      this.setUnavailable(true)
      this.#notify({
        type: "terminated",
        subscriptionId: message.subscriptionId,
        eventTime: event.E ?? null,
        recoveryRequired: true,
      })
      this.#forwardEvent(event)
      this.#scheduleRecovery(0)
      return
    }

    if (this.#deduplicator.isDuplicate(message)) return
    this.#forwardEvent(adaptMsg(event))
  }

  #forwardEvent(event) {
    for (const subscriber of this.#subscribers.values()) {
      if (!subscriber.active) continue
      try {
        subscriber.onEvent({ event })
      } catch (error) {
        this.logger.error?.("Binance user-data event callback failed", error)
      }
    }
  }

  #handleError(error) {
    this.logger.error?.("Binance user data stream error", error)
    this.#notify({ type: "rpcError", error, recoveryRequired: false })
  }

  #handleClose(event) {
    if (this.#stopped || this.#subscribers.size === 0) return
    this.setConnected(false)
    this.setUnavailable(true)
    this.#subscriptionId = null
    this.#recoveryRequired = true
    this.#notify({
      type: "connectionClosed",
      code: event?.code ?? null,
      reason: event?.reason ?? "",
      recoveryRequired: true,
    })
    this.#notify({ type: "recovering", attempt: 0, recoveryRequired: true })
    this.#scheduleRecovery()
  }

  #notify(status) {
    for (const subscriber of this.#subscribers.values()) {
      if (!subscriber.active || typeof subscriber.onStatus !== "function") continue
      try {
        subscriber.onStatus(status)
      } catch (error) {
        this.logger.error?.("Binance user-data status callback failed", error)
      }
    }
  }

  #scheduleRecovery(delay) {
    if (this.#stopped || this.#subscribers.size === 0 ||
        this.#reconnectTimer !== null || this.#reconnectPromise) return
    const wait = delay ?? Math.min(this.reconnectDelay * (2 ** this.#reconnectAttempts), 30_000)
    this.#reconnectTimer = this.setTimeout(() => {
      this.#reconnectTimer = null
      void this.#recover()
    }, wait)
  }

  async #recover() {
    if (this.#stopped || this.#subscribers.size === 0 || this.#reconnectPromise) return

    let retryDelay = null
    this.#reconnectPromise = (async () => {
      if (this.#reconnectAttempts >= this.maxReconnectAttempts) {
        this.#notify({
          type: "recoveryFailed",
          attempt: this.#reconnectAttempts,
          recoveryRequired: true,
        })
        return
      }

      const attempt = ++this.#reconnectAttempts
      try {
        let client = this.getClient()
        if (!client || client.state !== "open") {
          client = this.createClient()
          this.setClient(client)
          this.#bindClient(client)
          await client.connect()
          if (this.#stopped || this.#subscribers.size === 0) {
            await client.disconnect()
            return
          }
          this.setConnected(true)
        }
        await this.#ensureRemoteSubscription()
      } catch (error) {
        this.setUnavailable(true)
        this.logger.error?.("Binance user-data recovery attempt failed", { attempt, error })
        this.#notify({ type: "recovering", attempt, error, recoveryRequired: true })
        if (attempt >= this.maxReconnectAttempts) {
          this.#notify({
            type: "recoveryFailed",
            attempt,
            error,
            recoveryRequired: true,
          })
        } else {
          retryDelay = Math.min(this.reconnectDelay * (2 ** (attempt - 1)), 30_000)
        }
      }
    })()

    try {
      await this.#reconnectPromise
    } finally {
      this.#reconnectPromise = null
    }

    if (retryDelay !== null) this.#scheduleRecovery(retryDelay)
  }

  #acknowledgeRecovery(id) {
    const subscriber = this.#subscribers.get(id)
    if (!subscriber || !this.#recoveryRequired || this.#subscriptionId === null) return false
    subscriber.recoveryAcknowledged = true
    const allAcknowledged = [...this.#subscribers.values()]
      .every((item) => item.recoveryAcknowledged)
    if (allAcknowledged) {
      this.#recoveryRequired = false
      this.setUnavailable(false)
      this.#notify({
        type: "reconciled",
        subscriptionId: this.#subscriptionId,
        recoveryRequired: false,
      })
    }
    return allAcknowledged
  }

  async #removeSubscriber(id) {
    const subscriber = this.#subscribers.get(id)
    if (!subscriber) return
    subscriber.active = false
    this.#subscribers.delete(id)

    if (this.#subscribers.size > 0) return
    this.#clearReconnectTimer()
    const subscriptionId = this.#subscriptionId
    this.#subscriptionId = null
    this.#recoveryRequired = false
    this.setUnavailable(true)

    const client = this.getClient()
    try {
      if (subscriptionId !== null && client?.state === "open") {
        await client.request("userDataStream.unsubscribe", { subscriptionId })
      }
    } finally {
      this.#detachClientListeners()
      this.#deduplicator.clear()
    }
  }

  #detachClientListeners() {
    for (const remove of this.#removeClientListeners) remove?.()
    this.#removeClientListeners = []
  }

  #clearReconnectTimer() {
    if (this.#reconnectTimer !== null) {
      this.clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
  }
}
