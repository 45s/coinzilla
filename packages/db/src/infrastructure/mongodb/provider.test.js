import assert from "node:assert/strict"
import test from "node:test"

import {
  createDatabase,
  DatabaseTransactionOutcomeUnknownError,
  DatabaseTransactionUnsupportedError,
} from "../../index.js"
import { createMongoProvider } from "./provider.js"
import { runDatabaseProviderConformanceTests } from "../../../test-support/provider-conformance.js"

function createProviderHarness({ topology = "standalone", transactionSupported = false, commandHandler } = {}) {
  const calls = []
  const transports = []
  let randomValue = 0
  const provider = createMongoProvider({
    uri: "mongodb://localhost:27017/app",
    transportFactory: (options) => {
      const transport = {
        options,
        connected: false,
        closed: false,
        async connect() {
          this.connected = true
        },
        async command(input) {
          calls.push(input.body)
          return commandHandler
            ? commandHandler(input.body, calls.length)
            : { ok: 1, n: 1 }
        },
        async close() {
          this.closed = true
        },
      }
      transports.push(transport)
      return transport
    },
    handshake: async () => ({
      topology,
      transactionSupported,
      sessionsSupported: transactionSupported,
      primary: null,
    }),
    randomBytes: (length) => Buffer.alloc(length, ++randomValue),
  })
  return { provider, calls, transports }
}

test("MongoDB provider is usable through createDatabase on standalone servers", async () => {
  const { provider, calls, transports } = createProviderHarness()
  const database = createDatabase({ provider })
  await database.connect()

  try {
    const record = { id: "person-1", name: "Ada" }
    assert.deepEqual(
      await database.create({ collection: "people", record }),
      record,
    )
    assert.match(calls[0].insert, /^coinzilla_/)
    await assert.rejects(
      database.transaction(() => "must not run"),
      (error) => error instanceof DatabaseTransactionUnsupportedError
        && error.code === "DB_TRANSACTION_UNSUPPORTED",
    )
  } finally {
    await database.close()
  }

  assert.equal(transports[0].closed, true)
})

test("MongoDB provider uses one logical session across replica-set transaction commands", async () => {
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    const result = await database.transaction(async (transaction) => {
      await transaction.create({
        collection: "people",
        record: { id: "transaction-1", name: "Ada" },
      })
      return "committed"
    })

    assert.equal(result, "committed")
    const insert = calls.find((body) => body.insert === "people")
    const commit = calls.find((body) => body.commitTransaction === 1)
    assert.ok(insert.lsid)
    assert.equal(insert.autocommit, false)
    assert.equal(insert.startTransaction, true)
    assert.equal(insert.txnNumber, 1)
    assert.equal(insert.lsid.id.subtype, 4)
    assert.deepEqual(commit.lsid, insert.lsid)
    assert.equal(commit.txnNumber, insert.txnNumber)
    assert.equal(commit.autocommit, false)
    assert.deepEqual(commit.writeConcern, { w: "majority" })
  } finally {
    await database.close()
  }
})

test("MongoDB provider reports an ambiguous commit outcome instead of claiming rollback", async () => {
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.commitTransaction === 1) {
        throw new Error("connection lost after commit was sent")
      }
      return { ok: 1, n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => transaction.create({
        collection: "people",
        record: { id: "ambiguous-1" },
      })),
      (error) => error instanceof DatabaseTransactionOutcomeUnknownError
        && error.code === "DB_TRANSACTION_OUTCOME_UNKNOWN",
    )
    assert.equal(calls.filter((body) => body.commitTransaction === 1).length, 3)
  } finally {
    await database.close()
  }
})

test("MongoDB provider aborts failed transactions and preserves callback failures", async () => {
  const callbackError = new Error("business operation failed")
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.find === "people") {
        return { ok: 1, cursor: { id: 0, firstBatch: [] } }
      }
      return { ok: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.readOne({ collection: "people", id: "missing" })
        throw callbackError
      }),
      (error) => error === callbackError,
    )
    assert.equal(calls.some((body) => body.abortTransaction === 1), true)
    assert.equal(calls.some((body) => body.commitTransaction === 1), false)
  } finally {
    await database.close()
  }
})


test("MongoDB provider isolates concurrent transactions and drains them before close", async () => {
  let releaseWrite
  let markWriteStarted
  const writeStarted = new Promise((resolve) => {
    markWriteStarted = resolve
  })
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve
  })
  const { provider, calls, transports } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.insert === "coinzilla_cGVvcGxl") {
        markWriteStarted()
        await writeGate
      }
      return { ok: 1, n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  const first = database.transaction((transaction) => transaction.create({
    collection: "people",
    record: { id: "concurrent-1" },
  }))
  await writeStarted
  const second = database.transaction((transaction) => transaction.create({
    collection: "people",
    record: { id: "concurrent-2" },
  }))
  const closing = database.close()

  assert.equal(database.state, "closing")
  assert.equal(transports[0].closed, false)
  releaseWrite()
  await Promise.all([first, second, closing])

  const inserts = calls.filter((body) => body.insert === "coinzilla_cGVvcGxl")
  assert.equal(inserts.length, 2)
  assert.notDeepEqual(inserts[0].lsid, inserts[1].lsid)
  assert.equal(transports[0].closed, true)
  assert.equal(database.state, "closed")
})

test("MongoDB provider follows replica-set primary discovery and closes the seed socket", async () => {
  const hosts = []
  const transports = []
  let handshakes = 0
  const provider = createMongoProvider({
    uri: "mongodb://seed:27017/app",
    transportFactory: (options) => {
      hosts.push([options.host, options.port])
      const transport = {
        closed: false,
        async connect() {},
        async command() {
          return { ok: 1 }
        },
        async close() {
          this.closed = true
        },
      }
      transports.push(transport)
      return transport
    },
    handshake: async () => {
      handshakes += 1
      return handshakes === 1
        ? { topology: "replicaSet", primary: "primary.example:27018", transactionSupported: true }
        : { topology: "replicaSet", primary: null, transactionSupported: true }
    },
  })

  await provider.connect()
  await provider.close()

  assert.deepEqual(hosts, [["seed", 27017], ["primary.example", 27018]])
  assert.equal(transports[0].closed, true)
  assert.equal(transports[1].closed, true)
})


function createConformanceMongoServer(store) {
  function matches(document, filter) {
    const conditions = filter.$and ?? []
    return conditions.every((condition) => {
      const [path, expected] = Object.entries(condition)[0]
      const key = path.slice("data.".length)
      const exists = Object.hasOwn(document.data, key)
      if (expected && expected.$type === 10) {
        return exists && document.data[key] === null
      }
      return exists && document.data[key] === expected
    })
  }

  function scalarRank(value) {
    if (value === undefined || value === null) return 0
    if (value === false) return 1
    if (value === true) return 2
    if (typeof value === "number") return 3
    if (typeof value === "string") return 4
    return 5
  }

  function compareScalar(left, right) {
    const rank = scalarRank(left) - scalarRank(right)
    if (rank !== 0) return rank
    if (left === undefined || left === null) return 0
    if (typeof left === "number" || typeof left === "string") {
      return left < right ? -1 : left > right ? 1 : 0
    }
    return 0
  }

  return async function command(body) {
    const collection = body.insert ?? body.find ?? body.aggregate ?? body.findAndModify ?? body.delete
    const records = store.get(collection) ?? new Map()
    store.set(collection, records)

    if (body.insert) {
      for (const document of body.documents) {
        if (records.has(document._id)) {
          return { ok: 1, n: 0, writeErrors: [{ code: 11000, errmsg: "duplicate key" }] }
        }
        records.set(document._id, structuredClone(document))
      }
      return { ok: 1, n: body.documents.length }
    }

    if (body.find) {
      const document = records.get(body.filter._id)
      return {
        ok: 1,
        cursor: {
          id: 0,
          firstBatch: document ? [{ data: structuredClone(document.data) }] : [],
        },
      }
    }

    if (body.aggregate) {
      let documents = [...records.values()].filter((document) => matches(document, body.pipeline[0].$match))
      const additions = body.pipeline.find((stage) => stage.$addFields)?.$addFields ?? {}
      const sort = body.pipeline.find((stage) => stage.$sort)?.$sort ?? { _id: 1 }
      const sortFields = Object.entries(sort).filter(([key]) => key !== "_id")
      documents.sort((left, right) => {
        for (const [sortKey, direction] of sortFields) {
          const fieldPath = additions[sortKey.replace("SortType", "SortValue")]
          const field = typeof fieldPath === "string" ? fieldPath.slice("$data.".length) : null
          const comparison = compareScalar(field ? left.data[field] : undefined, field ? right.data[field] : undefined)
          if (comparison !== 0) return comparison * direction
        }
        return left._id < right._id ? -1 : left._id > right._id ? 1 : 0
      })
      const skip = body.pipeline.find((stage) => stage.$skip)?.$skip ?? 0
      const limit = body.pipeline.find((stage) => stage.$limit)?.$limit
      documents = documents.slice(skip, limit === undefined ? undefined : skip + limit)
      return {
        ok: 1,
        cursor: {
          id: 0,
          firstBatch: documents.map((document) => ({ data: structuredClone(document.data) })),
        },
      }
    }

    if (body.findAndModify) {
      const document = records.get(body.query._id)
      if (!document) return { ok: 1, value: null }
      for (const [path, value] of Object.entries(body.update.$set)) {
        document.data[path.slice("data.".length)] = structuredClone(value)
      }
      return { ok: 1, value: { data: structuredClone(document.data) } }
    }

    if (body.delete) {
      const removed = records.delete(body.deletes[0].q._id)
      return { ok: 1, n: Number(removed) }
    }

    throw new Error(`Unsupported conformance command: ${Object.keys(body)[0]}`)
  }
}

const conformanceStores = new Map()
runDatabaseProviderConformanceTests({
  name: "MongoDB provider (deterministic protocol fixture)",
  createDatabase: ({ storageKey }) => {
    let store = conformanceStores.get(storageKey)
    if (!store) {
      store = new Map()
      conformanceStores.set(storageKey, store)
    }
    const command = createConformanceMongoServer(store)
    return createDatabase({
      provider: createMongoProvider({
        host: "mongodb-fixture",
        databaseName: "conformance",
        transportFactory: () => ({
          async connect() {},
          command: ({ body }) => command(body),
          async close() {},
        }),
        handshake: async () => ({
          topology: "standalone",
          transactionSupported: false,
          sessionsSupported: false,
          primary: null,
        }),
      }),
    })
  },
  cleanupStorage: ({ storageKey }) => {
    conformanceStores.delete(storageKey)
  },
})
