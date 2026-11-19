/**
 * Polling-backed Bitunix Spot observations.
 *
 * This is not a native user-data subscription and emits no canonical order or
 * fill events. Every successful cycle is an observed snapshot with explicit
 * scope and incomplete-history guarantees.
 */
function validateInterval({ intervalMs }) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 250 || intervalMs > 60_000) {
    throw new RangeError("Bitunix Spot polling intervalMs must be an integer from 250 to 60000")
  }
}

function validateSymbols({ symbols }) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new TypeError("Bitunix Spot polling requires at least one explicit symbol")
  }
  const normalized = symbols.map((symbol) => {
    if (typeof symbol !== "string" || !symbol.trim()) {
      throw new TypeError("Bitunix Spot polling symbols must be non-empty strings")
    }
    return symbol.trim().toUpperCase()
  })
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError("Bitunix Spot polling symbols must be unique")
  }
  return normalized
}

function validateTrackedOrders({ trackedOrders = [] }) {
  if (!Array.isArray(trackedOrders)) {
    throw new TypeError("Bitunix Spot trackedOrders must be an array")
  }
  return trackedOrders.map((order) => {
    if (!order || typeof order !== "object" || Array.isArray(order) ||
        typeof order.symbol !== "string" || !order.symbol.trim() ||
        (typeof order.orderId !== "string" && typeof order.orderId !== "number") ||
        String(order.orderId).trim() === "") {
      throw new TypeError("Each tracked Bitunix Spot order requires symbol and orderId")
    }
    return Object.freeze({
      symbol: order.symbol.trim().toUpperCase(),
      orderId: String(order.orderId),
    })
  })
}


function validateTrackedOrderScope({ symbols, trackedOrders }) {
  for (const order of trackedOrders) {
    if (!symbols.includes(order.symbol)) {
      throw new TypeError(`Tracked order symbol ${order.symbol} is not in polling symbols`)
    }
  }
}

function assertSuccessfulRead({ result, operation }) {
  if (!result || result.ok !== true) {
    const errors = Array.isArray(result?.errors) ? result.errors : []
    const detail = errors.map((error) => error?.message).filter(Boolean).join("; ")
    throw new Error(`Bitunix Spot polling ${operation} failed${detail ? `: ${detail}` : ""}`)
  }
  return result.data
}

function stableSerialize({ value }) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize({ value: item })).join(",")}]`
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableSerialize({ value: value[key] })}`).join(",")}}`
}

function cloneAndFreeze({ value }) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreeze({ value: entry })))
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Bitunix Spot observation snapshots must contain only JSON-shaped objects")
    }
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneAndFreeze({ value: entry })]),
    ))
  }
  return value
}

function freezeSnapshot({ snapshot }) {
  // API payloads are JSON-shaped. Clone before freezing so the observation is
  // immutable without freezing objects owned by the broker or its caller.
  return cloneAndFreeze({ value: snapshot })
}

export class BitunixSpotReconciler {
  constructor({
    broker,
    now = Date.now,
    schedule = ({ callback, delay }) => setTimeout(callback, delay),
    cancel = clearTimeout,
  } = {}) {
    for (const method of ["getBalances", "getOpenOrders", "getOrderHistory", "getMatchingOrderDetails"]) {
      if (typeof broker?.[method] !== "function") {
        throw new TypeError(`Bitunix Spot reconciler requires broker.${method}()`)
      }
    }
    if (typeof now !== "function" || typeof schedule !== "function" || typeof cancel !== "function") {
      throw new TypeError("Bitunix Spot reconciler clock and scheduler dependencies must be functions")
    }
    this.broker = broker
    this.now = now
    this.schedule = schedule
    this.cancel = cancel
    this.running = false
    this.timer = null
    this.inFlight = null
    this.inFlightKey = null
    this.staleAfterMs = 4_000
    this.failureCount = 0
    this.lastFingerprint = null
    this.lastSuccessAt = null
    this.generation = 0
  }

  getStatus() {
    const observedAt = this.lastSuccessAt
    const ageMs = observedAt === null ? null : Math.max(0, this.now() - observedAt)
    let freshness = "NEVER_SYNCED"
    if (observedAt !== null) {
      freshness = ageMs > this.staleAfterMs ? "STALE" : "FRESH"
    }
    return Object.freeze({
      mode: "POLLING",
      nativePush: false,
      running: this.running,
      lastSuccessAt: observedAt,
      freshness,
      ageMs,
    })
  }

  async pollOnce({ symbols, trackedOrders = [] } = {}) {
    const normalizedSymbols = validateSymbols({ symbols })
    const normalizedTrackedOrders = validateTrackedOrders({ trackedOrders })
    validateTrackedOrderScope({
      symbols: normalizedSymbols,
      trackedOrders: normalizedTrackedOrders,
    })
    const requestKey = stableSerialize({
      value: {
        symbols: normalizedSymbols,
        trackedOrders: normalizedTrackedOrders,
      },
    })
    if (this.inFlight) {
      if (requestKey !== this.inFlightKey) {
        throw new Error("Bitunix Spot polling cycle already in flight with different scope")
      }
      return this.inFlight
    }
    const { generation } = this
    this.inFlightKey = requestKey
    this.inFlight = this.#collect({
      symbols: normalizedSymbols,
      trackedOrders: normalizedTrackedOrders,
      generation,
    }).finally(() => {
      this.inFlight = null
      this.inFlightKey = null
    })
    return this.inFlight
  }

  #assertActive({ generation }) {
    if (generation !== this.generation) {
      throw new Error("Bitunix Spot polling cycle was invalidated by stop()")
    }
  }

  async #readSymbolSnapshots({ symbols, generation }) {
    const snapshots = []
    for (const symbol of symbols) {
      const [openOrdersResult, historyResult] = await Promise.all([
        this.broker.getOpenOrders({ symbol }),
        this.broker.getOrderHistory({
          symbol,
          page: 1,
          limit: 100,
        }),
      ])
      this.#assertActive({ generation })
      snapshots.push({
        symbol,
        openOrders: assertSuccessfulRead({
          result: openOrdersResult,
          operation: `open orders for ${symbol}`,
        }),
        firstHistoryPage: assertSuccessfulRead({
          result: historyResult,
          operation: `order history for ${symbol}`,
        }),
        historyCoverage: "FIRST_PAGE_ONLY",
      })
    }
    return snapshots
  }

  async #readMatchingOrderObservations({ trackedOrders, generation }) {
    const observations = []
    for (const order of trackedOrders) {
      const result = await this.broker.getMatchingOrderDetails(order)
      this.#assertActive({ generation })
      observations.push({
        ...order,
        data: assertSuccessfulRead({
          result,
          operation: `matching-order lookup for ${order.symbol}/${order.orderId}`,
        }),
        interpretation: "EXCHANGE_NATIVE_UNVERIFIED",
      })
    }
    return observations
  }

  async #collect({ symbols, trackedOrders, generation }) {
    const balances = assertSuccessfulRead({
      result: await this.broker.getBalances(),
      operation: "balances",
    })
    this.#assertActive({ generation })
    const symbolSnapshots = await this.#readSymbolSnapshots({
      symbols,
      generation,
    })
    const matchingOrderObservations = await this.#readMatchingOrderObservations({
      trackedOrders,
      generation,
    })
    this.#assertActive({ generation })
    const observedAt = this.now()
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
      throw new TypeError("Bitunix Spot reconciler clock must return a non-negative safe integer")
    }
    const snapshot = freezeSnapshot({
      snapshot: {
        provider: "bitunix",
        product: "spot",
        mode: "POLLING",
        observedAt,
        sourceTime: null,
        balances,
        symbols: symbolSnapshots,
        matchingOrderObservations,
        guarantees: Object.freeze({
          accountSnapshotAuthoritative: false,
          historyCoverage: "FIRST_PAGE_ONLY",
          fillsCanonical: false,
          nativePush: false,
        }),
      },
    })
    const fingerprint = stableSerialize({
      value: {
        provider: snapshot.provider,
        product: snapshot.product,
        mode: snapshot.mode,
        balances: snapshot.balances,
        symbols: snapshot.symbols,
        matchingOrderObservations: snapshot.matchingOrderObservations,
        guarantees: snapshot.guarantees,
      },
    })
    const changed = fingerprint !== this.lastFingerprint
    this.lastFingerprint = fingerprint
    this.lastSuccessAt = observedAt
    return Object.freeze({
      snapshot,
      changed,
      status: this.getStatus(),
    })
  }

  #reportStatus({ status, onStatus, onError }) {
    try {
      onStatus(status)
    } catch (error) {
      this.#reportError({
        error,
        onError,
      })
    }
  }

  #reportError({ error, onError }) {
    try {
      onError(error)
    } catch {
      return
    }
  }

  async #runCycle({ generation, symbols, trackedOrders, intervalMs, onSnapshot, onStatus, onError }) {
    try {
      const result = await this.pollOnce({
        symbols,
        trackedOrders,
      })
      if (!this.running || generation !== this.generation) {
        return
      }
      if (result.changed) {
        try {
          await onSnapshot(result.snapshot)
        } catch (error) {
          this.lastFingerprint = null
          throw error
        }
      }
      this.failureCount = 0
      this.#reportStatus({
        status: {
          ...result.status,
          staleAfterMs: intervalMs * 2,
          lastCycle: "SUCCESS",
        },
        onStatus,
        onError,
      })
    } catch (error) {
      if (!this.running || generation !== this.generation) {
        return
      }
      // A successful read after any failed cycle must be re-delivered even if
      // its data matches the last pre-failure snapshot.
      this.lastFingerprint = null
      this.failureCount += 1
      this.#reportStatus({
        status: {
          ...this.getStatus(),
          staleAfterMs: intervalMs * 2,
          lastCycle: "FAILED",
        },
        onStatus,
        onError,
      })
      this.#reportError({
        error,
        onError,
      })
    } finally {
      this.#scheduleNextCycle({
        generation,
        symbols,
        trackedOrders,
        intervalMs,
        onSnapshot,
        onStatus,
        onError,
      })
    }
  }

  #scheduleNextCycle({ generation, symbols, trackedOrders, intervalMs, onSnapshot, onStatus, onError }) {
    if (!this.running || generation !== this.generation) {
      return
    }
    const backoffMs = Math.min(intervalMs * (2 ** Math.min(this.failureCount, 5)), 60_000)
    try {
      this.timer = this.schedule({
        callback: () => {
          void this.#runCycle({
            generation,
            symbols,
            trackedOrders,
            intervalMs,
            onSnapshot,
            onStatus,
            onError,
          })
        },
        delay: backoffMs,
      })
    } catch (error) {
      this.running = false
      this.#reportError({
        error,
        onError,
      })
    }
  }

  start({
    symbols,
    trackedOrders = [],
    intervalMs = 2_000,
    onSnapshot,
    onStatus = () => {},
    onError = () => {},
  } = {}) {
    if (this.running) {
      throw new Error("Bitunix Spot reconciler is already running")
    }
    validateInterval({ intervalMs })
    const normalizedSymbols = validateSymbols({ symbols })
    const normalizedTrackedOrders = validateTrackedOrders({ trackedOrders })
    validateTrackedOrderScope({
      symbols: normalizedSymbols,
      trackedOrders: normalizedTrackedOrders,
    })
    if (typeof onSnapshot !== "function" || typeof onStatus !== "function" || typeof onError !== "function") {
      throw new TypeError("Bitunix Spot reconciler callbacks must be functions")
    }
    this.running = true
    this.staleAfterMs = intervalMs * 2
    this.generation += 1
    const { generation: sessionGeneration } = this
    void this.#runCycle({
      generation: sessionGeneration,
      symbols: normalizedSymbols,
      trackedOrders: normalizedTrackedOrders,
      intervalMs,
      onSnapshot,
      onStatus,
      onError,
    })
    return Object.freeze({
      stop: () => this.stop(),
      getStatus: () => this.getStatus(),
    })
  }

  stop() {
    this.running = false
    this.generation += 1
    if (this.timer !== null) {
      this.cancel(this.timer)
      this.timer = null
    }
    this.lastFingerprint = null
  }
}
