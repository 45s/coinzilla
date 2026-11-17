import { createDatabaseEntity } from "../../domain/entities/database.js"

const REQUIRED_PROVIDER_METHODS = Object.freeze([
  "connect",
  "close",
  "withTransaction",
])
const CRUD_METHODS = Object.freeze([
  "create",
  "readOne",
  "readMany",
  "update",
  "delete",
])

function createTransactionFacade(transaction) {
  const missingMethods = CRUD_METHODS.filter(
    (method) => typeof transaction?.[method] !== "function",
  )
  if (missingMethods.length > 0) {
    throw new TypeError(
      `Database transaction must implement: ${missingMethods.join(", ")}`,
    )
  }

  return Object.freeze({
    create: (input) => transaction.create(input),
    readOne: (input) => transaction.readOne(input),
    readMany: (input) => transaction.readMany(input),
    update: (input) => transaction.update(input),
    delete: (input) => transaction.delete(input),
  })
}

function validateCapabilities(capabilities) {
  const transactions = capabilities?.transactions
  const queries = capabilities?.queries
  const storage = capabilities?.storage

  if (
    !transactions
    || typeof transactions !== "object"
    || !["synchronous", "asynchronous"].includes(transactions.callbackMode)
    || typeof transactions.nestedTransactions !== "boolean"
  ) {
    throw new TypeError("Provider transaction capabilities must declare callbackMode and nestedTransactions")
  }

  const queryFeatures = ["equalityFilters", "sorting", "pagination"]
  if (
    !queries
    || typeof queries !== "object"
    || queryFeatures.some((feature) => typeof queries[feature] !== "boolean")
  ) {
    throw new TypeError("Provider query capabilities must declare equalityFilters, sorting and pagination")
  }

  const storageModes = ["file", "memory", "server"]
  if (
    !storage
    || typeof storage !== "object"
    || !Array.isArray(storage.modes)
    || storage.modes.length === 0
    || storage.modes.some((mode) => !storageModes.includes(mode))
    || new Set(storage.modes).size !== storage.modes.length
  ) {
    throw new TypeError("Provider storage capabilities must declare unique file, memory or server modes")
  }
}

function freezeRecursively(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      freezeRecursively(nestedValue)
    }
    Object.freeze(value)
  }
  return value
}

function createCapabilitiesSnapshot(capabilities) {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    throw new TypeError("A provider must declare its database capabilities")
  }

  let snapshot
  try {
    snapshot = JSON.parse(JSON.stringify(capabilities))
  } catch (error) {
    throw new TypeError("Provider capabilities must be JSON-safe", {
      cause: error,
    })
  }

  validateCapabilities(snapshot)
  return freezeRecursively(snapshot)
}

function createProviderNeutralFacade({ database, provider }) {
  const capabilities = createCapabilitiesSnapshot(provider.capabilities)

  function runOperation({ operation, input }) {
    return database.transaction((transaction) => {
      const context = createTransactionFacade(transaction)
      return context[operation](input)
    })
  }

  return Object.freeze({
    connect: database.connect,
    close: database.close,
    transaction(work) {
      if (typeof work !== "function") {
        throw new TypeError("A transaction callback is required")
      }
      return database.transaction((transaction) => work(
        createTransactionFacade(transaction),
      ))
    },
    create: (input) => runOperation({
      operation: "create",
      input,
    }),
    readOne: (input) => runOperation({
      operation: "readOne",
      input,
    }),
    readMany: (input) => runOperation({
      operation: "readMany",
      input,
    }),
    update: (input) => runOperation({
      operation: "update",
      input,
    }),
    delete: (input) => runOperation({
      operation: "delete",
      input,
    }),
    capabilities,
    get state() {
      return database.state
    },
  })
}

/**
 * Compose a database lifecycle facade.
 *
 * Pass `provider` to receive the provider-neutral CRUD API. The legacy
 * `adapter` option remains available for the original lifecycle/SQL API.
 *
 * @param {{adapter?: import("../ports/database-provider.js").DatabaseAdapter, provider?: import("../ports/database-provider.js").DatabaseProvider}} options
 * @returns {ReturnType<typeof createDatabaseEntity>|object}
 */
export function createDatabase(options = {}) {
  const hasProvider = Object.hasOwn(options, "provider")
  const provider = hasProvider ? options.provider : options.adapter

  if (!provider || typeof provider !== "object") {
    throw new TypeError("A database adapter object is required")
  }

  const missingMethods = REQUIRED_PROVIDER_METHODS.filter(
    (method) => typeof provider[method] !== "function",
  )
  if (missingMethods.length > 0) {
    throw new TypeError(
      `Database adapter must implement: ${missingMethods.join(", ")}`,
    )
  }

  const database = createDatabaseEntity({
    provider,
  })

  if (!hasProvider) {
    return database
  }

  return createProviderNeutralFacade({
    database,
    provider,
  })
}
