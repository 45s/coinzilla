import { DatabaseConflictError, DatabaseProviderError, createDatabase } from "../src/index.js"
import { runDatabaseProviderConformanceTests } from "./provider-conformance.js"

function cloneStore(store) {
  return new Map(
    [...store].map(([collection, records]) => [
      collection,
      new Map([...records].map(([id, record]) => [id, structuredClone(record)])),
    ]),
  )
}

function createTransactionContext(store) {
  function getCollection(collection) {
    let records = store.get(collection)
    if (!records) {
      records = new Map()
      store.set(collection, records)
    }
    return records
  }

  return Object.freeze({
    create({ collection, record }) {
      const records = getCollection(collection)
      if (records.has(record.id)) {
        throw new DatabaseConflictError({ collection })
      }
      records.set(record.id, structuredClone(record))
      return structuredClone(record)
    },
    readOne({ collection, id }) {
      const record = store.get(collection)?.get(id)
      return record ? structuredClone(record) : null
    },
    readMany({ collection, query = {} }) {
      let records = [...(store.get(collection)?.values() ?? [])]
      records = records.filter((record) => Object.entries(query.filter ?? {}).every(
        ([field, value]) => record[field] === value,
      ))
      const offset = query.offset ?? 0
      const end = query.limit === undefined ? undefined : offset + query.limit
      return records.slice(offset, end).map((record) => structuredClone(record))
    },
    update({ collection, id, changes }) {
      const records = store.get(collection)
      const existing = records?.get(id)
      if (!existing) {
        return null
      }
      const updated = {
        ...existing,
        ...structuredClone(changes),
      }
      records.set(id, updated)
      return structuredClone(updated)
    },
    delete({ collection, id }) {
      return store.get(collection)?.delete(id) ?? false
    },
  })
}

function createAsyncTransactionRunner({ state, nestedTransactions, stores }) {
  return async function runTransaction(work) {
    if (!state.connected) {
      throw new DatabaseProviderError({
        operation: "transaction",
        cause: new Error("Provider is not connected"),
      })
    }

    if (state.activeTransaction) {
      if (!nestedTransactions) {
        throw new DatabaseProviderError({
          operation: "transaction",
          cause: new Error("Nested transactions are not supported"),
        })
      }
      return work(state.activeTransaction.context)
    }

    const workingStore = cloneStore(state.store)
    const context = createTransactionContext(workingStore)
    state.activeTransaction = { context }

    try {
      const result = await work(context)
      state.store = workingStore
      stores.set(state.storageKey, state.store)
      return result
    } finally {
      state.activeTransaction = undefined
    }
  }
}

function createAsyncProviderFactory({ nestedTransactions, stores }) {
  const capabilities = {
    transactions: {
      callbackMode: "asynchronous",
      nestedTransactions,
    },
    queries: {
      equalityFilters: false,
      sorting: false,
      pagination: false,
    },
    storage: {
      modes: ["memory"],
    },
  }

  return ({ storageKey }) => {
    const state = {
      storageKey,
      store: stores.get(storageKey) ?? new Map(),
      connected: false,
      activeTransaction: undefined,
    }
    stores.set(storageKey, state.store)
    const runTransaction = createAsyncTransactionRunner({
      state,
      nestedTransactions,
      stores,
    })

    return createDatabase({
      provider: {
        capabilities,
        async connect() {
          state.connected = true
        },
        async close() {
          state.connected = false
        },
        withTransaction: runTransaction,
        withReadTransaction: runTransaction,
      },
    })
  }
}

const nestedStores = new Map()
runDatabaseProviderConformanceTests({
  name: "Async nested test provider",
  createDatabase: createAsyncProviderFactory({
    nestedTransactions: true,
    stores: nestedStores,
  }),
  cleanupStorage: ({ storageKey }) => nestedStores.delete(storageKey),
})

runDatabaseProviderConformanceTests({
  name: "Async flat test provider",
  createDatabase: createAsyncProviderFactory({
    nestedTransactions: false,
    stores: new Map(),
  }),
})
