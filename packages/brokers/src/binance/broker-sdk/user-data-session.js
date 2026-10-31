import { createUserDataEventDeduplicator } from "./user-data-event-deduplicator.js"
import { adaptMsg } from "../websocket-stream/index.js"

function logSafely(logger, level, ...args) {
  try {
    logger?.[level]?.(...args)
  } catch {
    // Logging failures must not interrupt subscription recovery or event delivery.
  }
}

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
  #removeEventListener = null
  #removeErrorListener = null
  #removeCloseListener = null
  #stopped = false
  #recoveryRequired = false
  #deduplicator = createUserDataEventDeduplicator()
  #generation = 0

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

  start() {
    this.#clearReconnectTimer()
    this.#generation += 1
    this.#stopped = false
  }

  get isRecovering() {
    return this.#reconnectPromise !== null
  }

  async waitForRecovery() {
    if (this.#reconnectPromise) await this.#reconnectPromise
  }

  onConnected() {
    const client = this.getClient()
    if (!this.#stopped && client?.state === "open") {
      this.#bindClient(client, { includeUserData: false })
    }
  }

  async resume() {
    if (this.#stopped || this.#subscribers.size === 0) return
    this.#clearReconnectTimer()
    if (this.#reconnectPromise) return this.#reconnectPromise
    try {
      await this.#ensureRemoteSubscription()
    } catch (error) {
      this.setUnavailable(true)
      this.#reconnectAttempts = 0
      this.#notify({ type: "recovering", attempt: 0, error, recoveryRequired: true })
      this.#scheduleRecovery()
    }
  }

  async subscribe({ onEvent, onStatus }) {
    validateCallback(onEvent, "onEvent")
    if (onStatus !== undefined) validateCallback(onStatus, "onStatus")
    if (this.#stopped) throw new Error("User-data session is stopped")

    const id = ++this.#nextSubscriberId
    const subscriber = {
      onEvent,
      onStatus,
      recoveryAcknowledged: false,
      recoveryNotified: false,
      active: true,
    }
    this.#subscribers.set(id, subscriber)

    try {
      await this.#ensureRemoteSubscription()
      if (this.#stopped || !this.#subscribers.has(id)) {
        throw new Error("User-data subscription was canceled during setup")
      }
    } catch (error) {
      this.#subscribers.delete(id)
      if (this.#subscribers.size === 0) {
        this.#clearReconnectTimer()
        this.#detachUserDataListeners()
        this.setUnavailable(true)
      }
      throw error
    }

    if (this.#recoveryRequired && this.#subscriptionId !== null &&
        !subscriber.recoveryNotified) {
      this.#notifySubscriber(subscriber, {
        type: "recovered",
        subscriptionId: this.#subscriptionId,
        reconciliationRequired: true,
        recoveryRequired: true,
      })
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
    this.#generation += 1
    this.#stopped = true
    this.#clearReconnectTimer()
    this.#subscribers.clear()
    this.#subscriptionId = null
    this.#recoveryRequired = false
    this.setUnavailable(true)
    this.#detachClientListeners()
    this.#deduplicator.clear()
  }

  async #ensureRemoteSubscription() {
    if (this.#subscriptionId !== null) return this.#subscriptionId
    if (this.#subscribePromise) {
      await this.#subscribePromise
      if (this.#stopped) throw new Error("User-data session is stopped")
      if (this.#subscriptionId !== null) return this.#subscriptionId
      return this.#ensureRemoteSubscription()
    }

    const generation = this.#generation
    const client = this.getClient()
    if (!client || client.state !== "open") {
      throw new Error("Binance WebSocket API must be open before subscribing to user data")
    }

    this.setUnavailable(true)
    this.#bindClient(client)
    this.#subscribePromise = (async () => {
      let subscriptionId
      try {
        const response = await client.request(
          "userDataStream.subscribe.signature",
          {},
          { signed: true },
        )
        subscriptionId = response.data?.subscriptionId
      } catch (error) {
        subscriptionId = await this.#findExistingSubscription(client, error)
      }

      if (!Number.isSafeInteger(subscriptionId) || subscriptionId < 0) {
        subscriptionId = await this.#findExistingSubscription(
          client,
          new Error("Binance user-data subscription response did not include a valid subscriptionId"),
        )
      }
      if (this.#stopped || generation !== this.#generation || this.#subscribers.size === 0 ||
          this.getClient() !== client || client.state !== "open") {
        try {
          await client.request("userDataStream.unsubscribe", { subscriptionId })
        } catch (error) {
          logSafely(this.logger, "warn", "Unable to clean up an unused Binance user-data subscription", error)
        }
        return subscriptionId
      }

      this.#subscriptionId = subscriptionId
      this.#clearReconnectTimer()
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
    })().finally(() => {
      this.#subscribePromise = null
    })

    return this.#subscribePromise
  }

  async #findExistingSubscription(client, originalError) {
    let response
    try {
      response = await client.request("session.subscriptions")
    } catch (lookupError) {
      logSafely(this.logger, "warn", "Unable to verify Binance user-data subscription after an uncertain response", lookupError)
      throw originalError
    }

    const subscriptions = Array.isArray(response.data) ? response.data : []
    const ids = subscriptions
      .map((item) => item?.subscriptionId)
      .filter((id) => Number.isSafeInteger(id) && id >= 0)

    if (ids.length > 1) {
      throw new Error("Cannot safely identify the user-data subscription: multiple active subscriptions exist", {
        cause: originalError,
      })
    }
    if (ids.length === 1) return ids[0]
    throw originalError
  }

  #bindClient(client, { includeUserData = true } = {}) {
    this.#detachClientListeners()
    if (includeUserData) {
      this.#removeEventListener = client.onEvent((message) => {
        if (this.getClient() === client) this.#handleEvent(message)
      })
      this.#removeErrorListener = client.onError?.((error) => {
        if (this.getClient() === client) this.#handleError(error)
      }) ?? null
    }
    this.#removeCloseListener = client.onClose?.((event) => {
      if (this.getClient() === client) this.#handleClose(event)
    }) ?? null
  }

  #handleEvent(message) {
    if (this.#stopped || this.#subscribers.size === 0 ||
        message?.subscriptionId !== this.#subscriptionId) return

    const event = message?.event && typeof message.event === "object"
      ? message.event
      : message

    if (event.e === "eventStreamTerminated") {
      logSafely(this.logger, "warn", "Binance user-data subscription terminated", {
        subscriptionId: message.subscriptionId,
      })
      this.#subscriptionId = null
      this.#markRecoveryRequired()
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
        logSafely(this.logger, "error", "Binance user-data event callback failed", error)
      }
    }
  }

  #handleError(error) {
    logSafely(this.logger, "error", "Binance user data stream error", error)
    this.#notify({ type: "rpcError", error, recoveryRequired: false })
  }

  #handleClose(event) {
    if (this.#stopped) return
    this.setConnected(false)
    if (this.#subscribers.size === 0) {
      this.setUnavailable(true)
      return
    }
    this.#subscriptionId = null
    this.#markRecoveryRequired()
    logSafely(this.logger, "error", "Binance user-data API connection closed", {
      code: event?.code ?? null,
      reason: event?.reason ?? "",
    })
    this.#notify({
      type: "connectionClosed",
      code: event?.code ?? null,
      reason: event?.reason ?? "",
      recoveryRequired: true,
    })
    this.#notify({ type: "recovering", attempt: 0, recoveryRequired: true })
    this.#scheduleRecovery()
  }

  #markRecoveryRequired() {
    this.#recoveryRequired = true
    this.setUnavailable(true)
    for (const subscriber of this.#subscribers.values()) {
      subscriber.recoveryAcknowledged = false
      subscriber.recoveryNotified = false
    }
  }

  #notifySubscriber(subscriber, status) {
    if (status.type === "recovered") subscriber.recoveryNotified = true
    if (!subscriber.active || typeof subscriber.onStatus !== "function") return
    try {
      subscriber.onStatus(status)
    } catch (error) {
      logSafely(this.logger, "error", "Binance user-data status callback failed", error)
    }
  }

  #notify(status) {
    for (const subscriber of this.#subscribers.values()) {
      this.#notifySubscriber(subscriber, status)
    }
  }

  #scheduleRecovery(delay) {
    if (this.#stopped || this.#subscribers.size === 0 || this.#subscriptionId !== null ||
        this.#reconnectTimer !== null || this.#reconnectPromise) return
    const wait = delay ?? Math.min(this.reconnectDelay * (2 ** this.#reconnectAttempts), 30_000)
    this.#reconnectTimer = this.setTimeout(() => {
      this.#reconnectTimer = null
      void this.#recover()
    }, wait)
  }

  async #recover() {
    if (this.#stopped || this.#subscribers.size === 0 || this.#subscriptionId !== null ||
        this.#reconnectPromise) return

    const generation = this.#generation
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
          if (this.#stopped || generation !== this.#generation || this.#subscribers.size === 0 ||
              this.getClient() !== client) {
            await client.disconnect()
            return
          }
          this.setConnected(true)
        }
        if (this.#stopped || generation !== this.#generation) return
        await this.#ensureRemoteSubscription()
      } catch (error) {
        if (this.#stopped || generation !== this.#generation) return
        this.setUnavailable(true)
        logSafely(this.logger, "error", "Binance user-data recovery attempt failed", { attempt, error })
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

    if (generation !== this.#generation) return
    if (retryDelay !== null) {
      this.#scheduleRecovery(retryDelay)
    } else if (this.#subscriptionId === null && this.#recoveryRequired &&
               !this.#stopped && this.#subscribers.size > 0 &&
               this.#reconnectAttempts < this.maxReconnectAttempts) {
      this.#scheduleRecovery()
    }
  }

  #acknowledgeRecovery(id) {
    const subscriber = this.#subscribers.get(id)
    if (!subscriber || !this.#recoveryRequired || this.#subscriptionId === null) return false
    subscriber.recoveryAcknowledged = true
    return this.#completeRecoveryIfAcknowledged()
  }

  #completeRecoveryIfAcknowledged() {
    if (!this.#recoveryRequired || this.#subscriptionId === null ||
        this.#subscribers.size === 0) return false
    const allAcknowledged = [...this.#subscribers.values()]
      .every((subscriber) => subscriber.recoveryAcknowledged)
    if (!allAcknowledged) return false

    this.#recoveryRequired = false
    this.setUnavailable(false)
    this.#notify({
      type: "reconciled",
      subscriptionId: this.#subscriptionId,
      recoveryRequired: false,
    })
    return true
  }

  async #removeSubscriber(id) {
    const subscriber = this.#subscribers.get(id)
    if (!subscriber) return
    subscriber.active = false
    this.#subscribers.delete(id)

    if (this.#subscribers.size > 0) {
      this.#completeRecoveryIfAcknowledged()
      return
    }
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
      this.#detachUserDataListeners()
      this.#deduplicator.clear()
    }
  }

  #detachUserDataListeners() {
    this.#removeEventListener?.()
    this.#removeErrorListener?.()
    this.#removeEventListener = null
    this.#removeErrorListener = null
  }

  #detachClientListeners() {
    this.#detachUserDataListeners()
    this.#removeCloseListener?.()
    this.#removeCloseListener = null
  }

  #clearReconnectTimer() {
    if (this.#reconnectTimer !== null) {
      this.clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
  }
}
