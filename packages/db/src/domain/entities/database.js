const REQUIRED_PROVIDER_METHODS = Object.freeze([
  "connect",
  "close",
  "withTransaction",
])

function createConnectionOperation({ provider, lifecycle }) {
  return async function connect() {
    if (lifecycle.state === "connected") {
      return undefined
    }
    if (lifecycle.state === "connecting") {
      return lifecycle.connectPromise
    }
    if (lifecycle.state === "closing" || lifecycle.state === "closed") {
      throw new Error(`Cannot connect database while it is ${lifecycle.state}`)
    }

    lifecycle.state = "connecting"
    let connection
    try {
      connection = Promise.resolve(provider.connect())
    } catch (error) {
      connection = Promise.reject(error)
    }

    lifecycle.connectPromise = connection
      .then(() => {
        lifecycle.state = "connected"
      })
      .catch((error) => {
        lifecycle.state = "disconnected"
        throw error
      })
      .finally(() => {
        lifecycle.connectPromise = null
      })

    return lifecycle.connectPromise
  }
}

function createTransactionOperation({ provider, lifecycle, readOnly = false }) {
  return function transaction(work) {
    if (typeof work !== "function") {
      throw new TypeError("A transaction callback is required")
    }
    if (lifecycle.state !== "connected") {
      throw new Error(
        `Database must be connected to start a transaction (state: ${lifecycle.state})`,
      )
    }

    let operation
    try {
      const runProviderTransaction = readOnly
        && typeof provider.withReadTransaction === "function"
        ? provider.withReadTransaction
        : provider.withTransaction
      operation = Promise.resolve(runProviderTransaction.call(provider, work))
    } catch (error) {
      operation = Promise.reject(error)
    }
    lifecycle.activeTransactions.add(operation)
    operation.then(
      () => lifecycle.activeTransactions.delete(operation),
      () => lifecycle.activeTransactions.delete(operation),
    )

    return operation
  }
}

function createCloseOperation({ provider, lifecycle }) {
  return async function close() {
    if (lifecycle.state === "closed") {
      return undefined
    }
    if (lifecycle.closePromise) {
      return lifecycle.closePromise
    }

    lifecycle.closePromise = (async () => {
      if (lifecycle.connectPromise) {
        try {
          await lifecycle.connectPromise
        } catch {
          lifecycle.state = "closed"
          return
        }
      }

      if (lifecycle.state === "disconnected") {
        lifecycle.state = "closed"
        return
      }

      lifecycle.state = "closing"
      while (lifecycle.activeTransactions.size > 0) {
        await Promise.allSettled([...lifecycle.activeTransactions])
      }

      await provider.close()
      lifecycle.state = "closed"
    })()

    try {
      await lifecycle.closePromise
    } finally {
      lifecycle.closePromise = null
    }

    return undefined
  }
}

/**
 * Database is the lifecycle aggregate for a provider-backed database resource.
 * It owns the lifecycle state and guarantees that shutdown drains transactions.
 *
 * @param {{connect: () => Promise<void>|void, close: () => Promise<void>|void, withTransaction: (work: (transaction: unknown) => unknown) => Promise<unknown>|unknown, withReadTransaction?: (work: (transaction: unknown) => unknown) => Promise<unknown>|unknown}} provider
 * @returns {{connect: () => Promise<void>, transaction: (work: (transaction: unknown) => unknown) => Promise<unknown>, readTransaction: (work: (transaction: unknown) => unknown) => Promise<unknown>, close: () => Promise<void>, readonly state: string}}
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

  const lifecycle = {
    state: "disconnected",
    connectPromise: null,
    closePromise: null,
    activeTransactions: new Set(),
  }

  return Object.freeze({
    connect: createConnectionOperation({
      provider,
      lifecycle,
    }),
    transaction: createTransactionOperation({
      provider,
      lifecycle,
    }),
    readTransaction: createTransactionOperation({
      provider,
      lifecycle,
      readOnly: true,
    }),
    close: createCloseOperation({
      provider,
      lifecycle,
    }),
    get state() {
      return lifecycle.state
    },
  })
}
