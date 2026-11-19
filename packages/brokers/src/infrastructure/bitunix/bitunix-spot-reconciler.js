/**
 * Polling-backed Bitunix Spot observations.
 *
 * This is deliberately not a native user-data subscription and does not emit
 * canonical order/fill events. Each successful cycle is an observed snapshot;
 * consumers must account for its bounded freshness and incomplete history.
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

function freezeSnapshot({ snapshot }) {
  return Object.freeze({
    ...snapshot,
    balances: Object.freeze([...snapshot.balances]),
    symbols: Object.freeze(snapshot.symbols.map((entry) => Object.freeze({
      ...entry,
      openOrders: Object.freeze([...entry.openOrders]),
      firstHistoryPage: Object.freeze([...entry.firstHistoryPage]),
    }))),
    matchingOrderObservations: Object.freeze(snapshot.matchingOrderObservations.map((entry) =>
      Object.freeze({ ...entry, data: entry.data && Object.freeze({ ...entry.data }) }))),
  })
}

/**
 * Runs single-flight polling cycles against read-only Bitunix Spot broker
 * methods. A cycle is published only when every requested read succeeds.
 */
export class BitunixSpotReconciler {
  constructor({
    broker,
    now = Date.now,
    schedule = setTimeout,
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
    this.lastFingerprint = null
    this.lastSuccessAt = null
    this.generation = 0
  }

  getStatus() {
    const observedAt = this.lastSuccessAt
    const ageMs = observedAt === null ? null : Math.max(0, this.now() - observedAt)
    return Object.freeze({
      mode: "POLLING",
      nativePush: false,
      running: this.running,
      lastSuccessAt: observedAt,
      freshness: observedAt === null ? "NEVER_SYNCED" : ageMs > this.staleAfterMs ? "STALE" : "FRESH",
      ageMs,
    })
  }

  async pollOnce({ symbols, trackedOrders = [] } = {}) {
    const normalizedSymbols = validateSymbols({ symbols })
    const normalizedTrackedOrders = validateTrackedOrders({ trackedOrders })
    for (const order of normalizedTrackedOrders) {
      if (!normalizedSymbols.includes(order.symbol)) {
        throw new TypeError(`Tracked order symbol ${order.symbol} is not in polling symbols`)
      }
    }
    const requestKey = stableSerialize({
      value: { symbols: normalizedSymbols, trackedOrders: normalizedTrackedOrders },
    })
    if (this.inFlight) {
      if (requestKey !== this.inFlightKey) {
        throw new Error("Bitunix Spot polling cycle already in flight with different scope")
      }
      return this.inFlight
    }
    const generation = this.generation
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

  async #collect({ symbols, trackedOrders, generation }) {
    const observedAt = this.now()
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
      throw new TypeError("Bitunix Spot reconciler clock must return a non-negative safe integer")
    }
    const balances = assertSuccessfulRead({
      result: await this.broker.getBalances(),
      operation: "balances",
    })
    const symbolSnapshots = []
    for (const symbol of symbols) {
      const [openOrdersResult, historyResult] = await Promise.all([
        this.broker.getOpenOrders({ symbol }),
        this.broker.getOrderHistory({ symbol, page: 1, limit: 100 }),
      ])
      symbolSnapshots.push({
        symbol,
        openOrders: assertSuccessfulRead({ result: openOrdersResult, operation: `open orders for ${symbol}` }),
        firstHistoryPage: assertSuccessfulRead({ result: historyResult, operation: `order history for ${symbol}` }),
        historyCoverage: "FIRST_PAGE_ONLY",
      })
    }
    const matchingOrderObservations = []
    for (const order of trackedOrders) {
      const result = await this.broker.getMatchingOrderDetails(order)
      matchingOrderObservations.push({
        ...order,
        data: assertSuccessfulRead({
          result,
          operation: `matching-order lookup for ${order.symbol}/${order.orderId}`,
        }),
        interpretation: "EXCHANGE_NATIVE_UNVERIFIED",
      })
    }
    if (generation !== this.generation) {
      throw new Error("Bitunix Spot polling cycle was invalidated by stop()")
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
    const fingerprint = stableSerialize({ value: snapshot })
    const changed = fingerprint !== this.lastFingerprint
    this.lastFingerprint = fingerprint
    this.lastSuccessAt = observedAt
    return Object.freeze({
      snapshot,
      changed,
      status: this.getStatus(),
    })
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
    validateSymbols({ symbols })
    validateTrackedOrders({ trackedOrders })
    if (typeof onSnapshot !== "function" || typeof onStatus !== "function" || typeof onError !== "function") {
      throw new TypeError("Bitunix Spot reconciler callbacks must be functions")
    }
    this.running = true
    this.staleAfterMs = intervalMs * 2
    const generation = ++this.generation
    const reportStatus = (status) => {
      if (this.running && generation === this.generation) {
        try { onStatus(status) } catch (error) { onError(error) }
      }
    }
    const cycle = async () => {
      if (!this.running || generation !== this.generation) return
      try {
        const result = await this.pollOnce({ symbols, trackedOrders })
        if (!this.running || generation !== this.generation) return
        if (result.changed) await onSnapshot(result.snapshot)
        reportStatus({
          ...result.status,
          staleAfterMs: intervalMs * 2,
          lastCycle: "SUCCESS",
        })
      } catch (error) {
        if (!this.running || generation !== this.generation) return
        reportStatus({
          ...this.getStatus(),
          staleAfterMs: intervalMs * 2,
          lastCycle: "FAILED",
        })
        try { onError(error) } catch {}
      } finally {
        if (this.running && generation === this.generation) {
          this.timer = this.schedule(() => { void cycle() }, intervalMs)
        }
      }
    }
    void cycle()
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
