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
const READ_ONLY_OPERATIONS = new Set(["readOne", "readMany"])

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

function validateTransactionCapabilities({ transactions }) {
  const hasValidCallbackMode = ["synchronous", "asynchronous"].includes(
    transactions?.callbackMode,
  )
  const hasNestedTransactionDeclaration = typeof transactions?.nestedTransactions === "boolean"

  if (!transactions || typeof transactions !== "object" || !hasValidCallbackMode || !hasNestedTransactionDeclaration) {
    throw new TypeError("Provider transaction capabilities must declare callbackMode and nestedTransactions")
  }
}

function validateQueryCapabilities({ queries }) {
  const queryFeatures = ["equalityFilters", "sorting", "pagination"]
  const hasEveryFeature = queries
    && typeof queries === "object"
    && queryFeatures.every((feature) => typeof queries[feature] === "boolean")

  if (!hasEveryFeature) {
    throw new TypeError("Provider query capabilities must declare equalityFilters, sorting and pagination")
  }
}

function validateStorageCapabilities({ storage }) {
  const storageModes = ["file", "memory", "server"]
  const hasValidModes = Array.isArray(storage?.modes)
    && storage.modes.length > 0
    && storage.modes.every((mode) => storageModes.includes(mode))
    && new Set(storage.modes).size === storage.modes.length

  if (!storage || typeof storage !== "object" || !hasValidModes) {
    throw new TypeError("Provider storage capabilities must declare unique file, memory or server modes")
  }
}

function validateCapabilities(capabilities) {
  validateTransactionCapabilities({
    transactions: capabilities?.transactions,
  })
  validateQueryCapabilities({
    queries: capabilities?.queries,
  })
  validateStorageCapabilities({
    storage: capabilities?.storage,
  })
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
    }, {
      intent: READ_ONLY_OPERATIONS.has(operation) ? "read" : "write",
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
