import { AsyncLocalStorage } from "node:async_hooks"

import { createDatabaseEntity } from "../../domain/entities/database.js"
import {
  DatabaseTransactionUnsupportedError,
} from "../../domain/errors/database-errors.js"

const REQUIRED_PROVIDER_METHODS = Object.freeze([
  "connect",
  "close",
  "withTransaction",
])
const REQUIRED_DATABASE_PROVIDER_METHODS = Object.freeze([
  ...REQUIRED_PROVIDER_METHODS,
  "withReadTransaction",
  "execute",
])
const READ_ONLY_OPERATIONS = new Set(["readOne", "readMany"])
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

function hasValidTransactionCallbackMode({ transactions }) {
  return ["synchronous", "asynchronous"].includes(transactions?.callbackMode)
}

function hasValidTransactionDeclarations({ transactions }) {
  const hasNested = typeof transactions?.nestedTransactions === "boolean"
  const hasMultiDocument = typeof transactions?.multiDocument === "boolean"
    || transactions?.multiDocument === "topology-dependent"
  return hasNested && hasMultiDocument
}

function hasCompatibleTransactionDeclarations({ transactions }) {
  const synchronousNesting = transactions?.callbackMode === "synchronous"
    && transactions?.nestedTransactions === true
  const nestedWithoutMultiDocument = transactions?.nestedTransactions === true
    && transactions?.multiDocument === false
  return !synchronousNesting && !nestedWithoutMultiDocument
}

function validateTransactionCapabilities({ transactions }) {
  const isObject = transactions !== null && typeof transactions === "object"
  const isValid = isObject
    && hasValidTransactionCallbackMode({ transactions })
    && hasValidTransactionDeclarations({ transactions })
    && hasCompatibleTransactionDeclarations({ transactions })
  if (!isValid) {
    throw new TypeError("Provider transaction capabilities must declare callbackMode, nestedTransactions and multiDocument")
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

function isAsyncFunction(callback) {
  return callback.constructor?.name === "AsyncFunction"
}

function runDatabaseOperation({ database, transactionScope, operation, input }) {
  const activeScope = transactionScope.getStore()
  if (activeScope) {
    if (!activeScope.active) {
      throw new Error("Database transaction callback has already completed")
    }
    return activeScope.context[operation](input)
  }
  if (READ_ONLY_OPERATIONS.has(operation)) {
    return database.readTransaction((transaction) => {
      const context = createTransactionFacade(transaction)
      return context[operation](input)
    })
  }
  return database.execute({ operation, input })
}

function invokeTransactionCallback({ work, transaction, transactionScope }) {
  const context = createTransactionFacade(transaction)
  const scope = { context, active: true }
  try {
    const result = transactionScope.run(scope, () => work(context))
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(() => {
        scope.active = false
      })
    }
    scope.active = false
    return result
  } catch (error) {
    scope.active = false
    throw error
  }
}

function createCloseMethod({ database, transactionScope }) {
  return function close() {
    if (transactionScope.getStore()?.active) {
      throw new Error("Cannot close a database from inside its transaction callback")
    }
    return database.close()
  }
}

function createTransactionMethod({ database, capabilities, transactionScope }) {
  return function transaction(work) {
    if (typeof work !== "function") {
      throw new TypeError("A transaction callback is required")
    }
    const activeScope = transactionScope.getStore()
    if (activeScope && !activeScope.active) {
      return Promise.reject(new Error("Database transaction callback has already completed"))
    }
    if (activeScope && !capabilities.transactions.nestedTransactions) {
      return Promise.reject(new DatabaseTransactionUnsupportedError({
        capability: "nestedTransactions",
      }))
    }
    if (!activeScope && !capabilities.transactions.multiDocument) {
      return Promise.reject(new DatabaseTransactionUnsupportedError())
    }
    return database.transaction((transactionContext) => {
      if (capabilities.transactions.callbackMode === "synchronous" && isAsyncFunction(work)) {
        throw new TypeError("Synchronous database provider transaction callbacks must be synchronous")
      }
      return invokeTransactionCallback({
        work,
        transaction: transactionContext,
        transactionScope,
      })
    })
  }
}

function createProviderNeutralFacade({ database, provider }) {
  const capabilities = createCapabilitiesSnapshot(provider.capabilities)
  const transactionScope = new AsyncLocalStorage()
  const runOperation = ({ operation, input }) => runDatabaseOperation({
    database,
    transactionScope,
    operation,
    input,
  })
  return Object.freeze({
    connect: database.connect,
    close: createCloseMethod({ database, transactionScope }),
    transaction: createTransactionMethod({ database, capabilities, transactionScope }),
    create: (input) => runOperation({ operation: "create", input }),
    readOne: (input) => runOperation({ operation: "readOne", input }),
    readMany: (input) => runOperation({ operation: "readMany", input }),
    update: (input) => runOperation({ operation: "update", input }),
    delete: (input) => runOperation({ operation: "delete", input }),
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

  const requiredMethods = hasProvider
    ? REQUIRED_DATABASE_PROVIDER_METHODS
    : REQUIRED_PROVIDER_METHODS
  const missingMethods = requiredMethods.filter(
    (method) => typeof provider[method] !== "function",
  )
  if (missingMethods.length > 0) {
    const resourceLabel = hasProvider ? "Database provider" : "Database adapter"
    throw new TypeError(
      `${resourceLabel} must implement: ${missingMethods.join(", ")}`,
    )
  }

  const database = createDatabaseEntity({
    provider,
  })

  if (!hasProvider) {
    return Object.freeze({
      connect: database.connect,
      transaction: database.transaction,
      readTransaction: database.readTransaction,
      close: database.close,
      get state() {
        return database.state
      },
    })
  }

  return createProviderNeutralFacade({
    database,
    provider,
  })
}
