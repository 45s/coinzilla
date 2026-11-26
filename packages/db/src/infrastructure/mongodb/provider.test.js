import assert from "node:assert/strict"
import test from "node:test"

import {
  createDatabase,
  DatabaseTransactionOutcomeUnknownError,
  DatabaseTransactionUnsupportedError,
} from "../../index.js"
import { createMongoProvider } from "./provider.js"

function createProviderHarness({ topology = "standalone", transactionSupported = false, commandHandler } = {}) {
  const calls = []
  const transports = []
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
    randomBytes: (length) => Buffer.alloc(length, 7),
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
