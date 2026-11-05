const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "connect",
  "close",
  "withTransaction",
])

/**
 * @typedef {object} DatabaseAdapter
 * @property {() => Promise<void>} connect - Establish the provider connection.
 * @property {() => Promise<void>} close - Release the provider connection.
 * @property {(work: (transaction: unknown) => unknown) => Promise<unknown>} withTransaction - Run work in a provider-managed transaction.
 */

/**
 * Create a provider-neutral database lifecycle boundary.
 *
 * Domain repository contracts and provider-specific query APIs stay outside
 * this package. The transaction context is deliberately opaque here.
 *
 * @param {{ adapter: DatabaseAdapter }} options
 * @returns {{ connect: () => Promise<void>, transaction: (work: (transaction: unknown) => unknown) => Promise<unknown>, close: () => Promise<void>, readonly state: string }}
 * @throws {TypeError} If the adapter does not implement the required methods.
 */
export function createDatabase({ adapter } = {}) {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("A database adapter object is required")
  }

  const missingMethods = REQUIRED_ADAPTER_METHODS.filter(
    (method) => typeof adapter[method] !== "function",
  )

  if (missingMethods.length > 0) {
    throw new TypeError(
      `Database adapter must implement: ${missingMethods.join(", ")}`,
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
      connection = Promise.resolve(adapter.connect())
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
      operation = Promise.resolve(adapter.withTransaction(work))
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

      await adapter.close()
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
