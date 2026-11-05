const REQUIRED_PROVIDER_METHODS = Object.freeze([
  "connect",
  "close",
  "withTransaction",
])

/**
 * Database is the lifecycle aggregate for a provider-backed database resource.
 * It owns the lifecycle state and guarantees that shutdown drains transactions.
 *
 * @param {{connect: () => Promise<void>|void, close: () => Promise<void>|void, withTransaction: (work: (transaction: unknown) => unknown) => Promise<unknown>|unknown}} provider
 * @returns {{connect: () => Promise<void>, transaction: (work: (transaction: unknown) => unknown) => Promise<unknown>, close: () => Promise<void>, readonly state: string}}
 */
export function createDatabaseEntity({ provider } = {}) {
  if (!provider || typeof provider !== "object") {
    throw new TypeError("A database provider object is required")
  }

  const missingMethods = REQUIRED_PROVIDER_METHODS.filter(
    (method) => typeof provider[method] !== "function",
  )

  if (missingMethods.length > 0) {
    throw new TypeError(
      `Database provider must implement: ${missingMethods.join(", ")}`,
    )
  }

  let state = "disconnected"
  let connectPromise = null
  let closePromise = null
  const activeTransactions = new Set()

  async function connect() {
    if (state === "connected") return
    if (state === "connecting") return connectPromise
    if (state === "closing" || state === "closed") {
      throw new Error(`Cannot connect database while it is ${state}`)
    }

    state = "connecting"
    let connection
    try {
      connection = Promise.resolve(provider.connect())
    } catch (error) {
      connection = Promise.reject(error)
    }

    connectPromise = connection
      .then(() => {
        state = "connected"
      })
      .catch((error) => {
        state = "disconnected"
        throw error
      })
      .finally(() => {
        connectPromise = null
      })

    return connectPromise
  }

  function transaction(work) {
    if (typeof work !== "function") {
      throw new TypeError("A transaction callback is required")
    }
    if (state !== "connected") {
      throw new Error(
        `Database must be connected to start a transaction (state: ${state})`,
      )
    }

    let operation
    try {
      operation = Promise.resolve(provider.withTransaction(work))
    } catch (error) {
      operation = Promise.reject(error)
    }
    activeTransactions.add(operation)
    operation.then(
      () => activeTransactions.delete(operation),
      () => activeTransactions.delete(operation),
    )

    return operation
  }

  async function close() {
    if (state === "closed") return
    if (closePromise) return closePromise

    closePromise = (async () => {
      if (connectPromise) {
        try {
          await connectPromise
        } catch {
          state = "closed"
          return
        }
      }

      if (state === "closed") return
      if (state === "disconnected") {
        state = "closed"
        return
      }

      state = "closing"
      while (activeTransactions.size > 0) {
        await Promise.allSettled([...activeTransactions])
      }

      await provider.close()
      state = "closed"
    })()

    try {
      await closePromise
    } finally {
      closePromise = null
    }
  }

  return Object.freeze({
    connect,
    transaction,
    close,
    get state() {
      return state
    },
  })
}
