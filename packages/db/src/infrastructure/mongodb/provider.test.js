import assert from "node:assert/strict"
import test from "node:test"

import {
  createDatabase,
  DatabaseProviderError,
  DatabaseTransactionOutcomeUnknownError,
  DatabaseTransactionUnsupportedError,
} from "../../index.js"
import { createMongoProvider } from "./provider.js"
import { runDatabaseProviderConformanceTests } from "../../../test-support/provider-conformance.js"

function createProviderHarness({ topology = "standalone", transactionSupported = false, commandHandler } = {}) {
  const calls = []
  const sequenceCalls = []
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
          sequenceCalls.push(input.sequences ?? [])
          return commandHandler
            ? commandHandler(input.body, calls.length, input.sequences ?? [])
            : { ok: 1,
n: 1 }
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
  return { provider,
calls,
sequenceCalls,
transports }
}

function createPrimaryDiscoveryTransport({ options, attempts }) {
  const transport = {
    options,
    closed: false,
    async connect() {},
    async command() {
      return { ok: 1 }
    },
    async close() {
      this.closed = true
    },
  }
  attempts.push(transport)
  return transport
}

function createPrimaryDiscoveryHarness({
  primaryResponses,
  host = "seed",
  port = 27017,
  directConnection = false,
}) {
  const attempts = []
  let responseIndex = 0
  const provider = createMongoProvider({
    host,
    port,
    directConnection,
    transportFactory: (options) => createPrimaryDiscoveryTransport({
      options,
      attempts,
    }),
    handshake: async () => {
      const index = Math.min(responseIndex, primaryResponses.length - 1)
      responseIndex += 1
      return primaryResponses[index]
    },
  })
  return {
    provider,
    attempts,
  }
}

function noOperation() {}

function assertMongoProviderOptionRejected({ options, expected }) {
  assert.throws(
    () => createMongoProvider({ host: "localhost",
...options }),
    expected,
  )
}

test("MongoDB provider validates connection and injected dependency options", () => {
  const invalidOptions = [
    { options: { host: "" },
expected: /host/ },
    { options: { port: 0 },
expected: /port/ },
    { options: { databaseName: "" },
expected: /databaseName/ },
    { options: { databaseName: "bad$name" },
expected: /unsupported character/ },
    { options: { databaseName: "x".repeat(64) },
expected: /63-byte/ },
    { options: { username: "" },
expected: /username/ },
    { options: { username: "álîçé",
password: "secret" },
expected: /username/ },
    { options: { username: "alice" },
expected: /password/ },
    { options: { password: "secret" },
expected: /requires a username/ },
    { options: { authMechanism: "PLAIN" },
expected: /requires a username/ },
    { options: { directConnection: "true" },
expected: /directConnection/ },
    { options: { replicaSet: "" },
expected: /replicaSet/ },
    { options: { username: "alice",
password: "secret",
authMechanism: "PLAIN" },
expected: /authMechanism/ },
    { options: { authSource: "bad$name" },
expected: /authSource/ },
    { options: { connectTimeoutMS: 0 },
expected: /connectTimeoutMS/ },
    { options: { socketTimeoutMS: Number.POSITIVE_INFINITY },
expected: /socketTimeoutMS/ },
    { options: { tls: [] },
expected: /TLS options/ },
    { options: { transportFactory: "not-a-function" },
expected: /transportFactory/ },
    { options: { handshake: "not-a-function" },
expected: /handshake/ },
    { options: { randomBytes: "not-a-function" },
expected: /randomBytes/ },
  ]
  for (const invalidOption of invalidOptions) {
    assertMongoProviderOptionRejected(invalidOption)
  }
})

test("MongoDB provider normalizes TLS enablement and disabled TLS options", () => {
  assert.doesNotThrow(() => createMongoProvider({
    host: "localhost",
    tls: true,
  }))
  assert.doesNotThrow(() => createMongoProvider({
    host: "localhost",
    tls: false,
  }))
  assert.doesNotThrow(() => createMongoProvider({
    host: "localhost",
    tls: { rejectUnauthorized: false },
  }))
})

test("MongoDB provider parses IPv6 and hostname primary redirects", async () => {
  const ipv6 = createPrimaryDiscoveryHarness({
    primaryResponses: [
      {
        topology: "replicaSet",
        primary: "[::1]:27018",
      },
      {
        topology: "replicaSet",
        primary: null,
      },
    ],
  })
  await ipv6.provider.connect()
  assert.equal(ipv6.attempts.length, 2)
  assert.equal(ipv6.attempts[0].closed, true)
  assert.equal(ipv6.attempts[1].options.host, "::1")
  assert.equal(ipv6.attempts[1].options.port, 27018)
  await ipv6.provider.close()

  const hostname = createPrimaryDiscoveryHarness({
    primaryResponses: [
      {
        topology: "replicaSet",
        primary: "primary.example",
      },
      {
        topology: "replicaSet",
        primary: null,
      },
    ],
  })
  await hostname.provider.connect()
  assert.equal(hostname.attempts[1].options.host, "primary.example")
  assert.equal(hostname.attempts[1].options.port, 27017)
  await hostname.provider.close()
})

test("MongoDB provider rejects malformed replica-set primary addresses", async () => {
  const invalidPrimaries = [
    {
      primary: 42,
      expected: /non-empty string/,
    },
    {
      primary: "[::1",
      expected: /IPv6 address is invalid/,
    },
    {
      primary: "[::1]:0",
      expected: /port is invalid/,
    },
    {
      primary: "localhost:65536",
      expected: /port is invalid/,
    },
    {
      primary: "localhost:abc",
      expected: /port is invalid/,
    },
    {
      primary: "seed:27017",
      expected: /current non-primary seed/,
    },
  ]
  for (const invalid of invalidPrimaries) {
    const harness = createPrimaryDiscoveryHarness({
      primaryResponses: [{
        topology: "replicaSet",
        primary: invalid.primary,
      }],
    })
    await assert.rejects(
      harness.provider.connect(),
      (error) => error instanceof DatabaseProviderError
        && invalid.expected.test(error.cause?.message ?? ""),
    )
  }
})

test("MongoDB provider rejects looping replica-set primary addresses", async () => {
  const redirectLoop = createPrimaryDiscoveryHarness({
    primaryResponses: [
      {
        topology: "replicaSet",
        primary: "one.example:27017",
      },
      {
        topology: "replicaSet",
        primary: "two.example:27017",
      },
      {
        topology: "replicaSet",
        primary: "three.example:27017",
      },
      {
        topology: "replicaSet",
        primary: "four.example:27017",
      },
    ],
  })
  await assert.rejects(
    redirectLoop.provider.connect(),
    (error) => error instanceof DatabaseProviderError
      && /exceeded the redirect limit/.test(error.cause?.message ?? ""),
  )
})


test("MongoDB provider coalesces connects and makes close idempotent", async () => {
  const harness = createProviderHarness()
  await Promise.all([
    harness.provider.connect(),
    harness.provider.connect(),
  ])
  assert.equal(harness.transports.length, 1)
  await harness.provider.connect()
  await Promise.all([
    harness.provider.close(),
    harness.provider.close(),
  ])
  assert.equal(harness.transports[0].closed, true)
  await assert.rejects(harness.provider.connect(), /closed/)
  await harness.provider.close()
})

test("MongoDB provider rejects invalid operation callbacks and unsupported operations", async () => {
  const harness = createProviderHarness({ transactionSupported: true })
  await assert.rejects(
    harness.provider.execute({
      operation: "create",
      input: {
        collection: "people",
        record: { id: "before-connect" },
      },
    }),
    /must be connected/,
  )
  await harness.provider.connect()
  await assert.rejects(
    harness.provider.withTransaction(null),
    /transaction callback is required/,
  )
  await assert.rejects(
    harness.provider.withReadTransaction(null),
    /read transaction callback is required/,
  )
  await assert.rejects(
    harness.provider.execute({ operation: "unknown" }),
    /Unsupported MongoDB CRUD operation/,
  )
  await assert.rejects(
    harness.provider.withTransaction(() => harness.provider.withTransaction(noOperation)),
    DatabaseTransactionUnsupportedError,
  )
  await harness.provider.close()
})

test("MongoDB transaction facade tracks every CRUD operation", async () => {
  const commands = []
  const document = {
    _id: "transaction-record",
    data: { name: "Ada" },
  }
  const harness = createProviderHarness({
    transactionSupported: true,
    commandHandler: async (body) => {
      commands.push(body)
      if (body.find || body.aggregate) {
        return {
          ok: 1,
          cursor: {
            id: 0,
            firstBatch: [document],
          },
        }
      }
      return {
        ok: 1,
        n: 1,
        nModified: 1,
      }
    },
  })
  await harness.provider.connect()

  try {
    const result = await harness.provider.withTransaction(async (transaction) => {
      await transaction.create({
        collection: "people",
        record: { id: "transaction-record", name: "Ada" },
      })
      const one = await transaction.readOne({
        collection: "people",
        id: "transaction-record",
      })
      const many = await transaction.readMany({
        collection: "people",
      })
      await transaction.update({
        collection: "people",
        id: "transaction-record",
        changes: { name: "Ada Lovelace" },
      })
      await transaction.delete({
        collection: "people",
        id: "transaction-record",
      })
      return { one, many }
    })

    assert.equal(result.one.id, "transaction-record")
    assert.deepEqual(result.many, [{ id: "transaction-record", name: "Ada" }])
    assert.ok(commands.some((body) => body.insert))
    assert.ok(commands.some((body) => body.find))
    assert.ok(commands.some((body) => body.aggregate))
    assert.ok(commands.some((body) => body.update))
    assert.ok(commands.some((body) => body.delete))
  } finally {
    await harness.provider.close()
  }
})

test("MongoDB provider preserves callback failures when abort is rejected", async () => {
  let abortAttempts = 0
  const harness = createProviderHarness({
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.abortTransaction) {
        abortAttempts += 1
        return {
          ok: 0,
          code: 999,
          errmsg: "abort rejected",
        }
      }
      return { ok: 1 }
    },
  })
  await harness.provider.connect()
  const callbackError = new Error("transaction callback failed")

  await assert.rejects(
    harness.provider.withTransaction(async (transaction) => {
      await transaction.create({
        collection: "people",
        record: { id: "abort-rejected" },
      })
      throw callbackError
    }),
    (error) => error === callbackError,
  )
  assert.equal(abortAttempts, 1)
  await harness.provider.close()
})

test("MongoDB provider retries close after a transport cleanup failure", async () => {
  const harness = createProviderHarness()
  await harness.provider.connect()
  const [transport] = harness.transports
  const originalClose = transport.close.bind(transport)
  let closeAttempts = 0
  transport.close = async () => {
    closeAttempts += 1
    if (closeAttempts === 1) {
      throw new Error("first close failed")
    }
    return originalClose()
  }
  await assert.rejects(
    harness.provider.close(),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message === "first close failed",
  )
  await harness.provider.close()
  assert.equal(closeAttempts, 2)
})

test("MongoDB provider closes a transport after connection and handshake failure", async () => {
  const handshakeFailure = new Error("handshake failed")
  const closeFailure = new Error("cleanup failed")
  const provider = createMongoProvider({
    host: "localhost",
    transportFactory: () => ({
      async connect() {},
      async command() {
        return { ok: 1 }
      },
      async close() {
        throw closeFailure
      },
    }),
    handshake: async () => {
      throw handshakeFailure
    },
  })
  await assert.rejects(
    provider.connect(),
    (error) => error instanceof DatabaseProviderError
      && error.cause instanceof AggregateError
      && error.cause.errors.includes(handshakeFailure)
      && error.cause.errors.includes(closeFailure),
  )
  await provider.close()
})

test("MongoDB provider close waits for an in-progress connection", async () => {
  let releaseConnect
  const connectGate = new Promise((resolve) => {
    releaseConnect = resolve
  })
  let transport
  const provider = createMongoProvider({
    host: "localhost",
    transportFactory: () => {
      transport = {
        closed: false,
        async connect() {
          await connectGate
        },
        async command() {
          return { ok: 1 }
        },
        async close() {
          this.closed = true
        },
      }
      return transport
    },
    handshake: async () => ({
      topology: "standalone",
      transactionSupported: false,
    }),
  })
  const connecting = provider.connect()
  const closing = provider.close()
  releaseConnect()
  await Promise.all([connecting, closing])
  assert.equal(transport.closed, true)
  await assert.rejects(provider.connect(), /closed/)
})

test("MongoDB transaction command queue rejects commands after the first failure", async () => {
  const harness = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: (body) => body.insert
      ? {
          ok: 0,
          code: 123,
          errmsg: "first transaction command failed",
        }
      : { ok: 1 },
  })
  await harness.provider.connect()
  await assert.rejects(
    harness.provider.withTransaction(async (transaction) => {
      await Promise.all([
        transaction.create({
          collection: "people",
          record: { id: "one" },
        }),
        transaction.create({
          collection: "people",
          record: { id: "two" },
        }),
      ])
    }),
    (error) => error instanceof DatabaseProviderError
      && /first transaction command failed/.test(error.cause?.message ?? ""),
  )
  await harness.provider.close()
})

test("MongoDB provider is usable through createDatabase on standalone servers", async () => {
  const { provider, calls, transports } = createProviderHarness()
  const database = createDatabase({ provider })
  await database.connect()

  try {
    const record = { id: "person-1",
name: "Ada" }
    assert.deepEqual(
      await database.create({ collection: "people",
record }),
      record,
    )
    assert.match(calls[0].insert, /^coinzilla_/)
    await assert.rejects(
      database.transaction(() => "must not run"),
      (error) => error instanceof DatabaseTransactionUnsupportedError
        && error.code === "DB_TRANSACTION_UNSUPPORTED"
        && error.context?.topology === undefined,
    )
  } finally {
    await database.close()
  }

  assert.equal(transports[0].closed, true)
})


test("MongoDB standalone supports provider-neutral single-operation reads without sessions", async () => {
  const { provider, calls } = createProviderHarness({
    commandHandler: async (body) => {
      if (body.find === "coinzilla_cGVvcGxl") {
        return { ok: 1,
cursor: { id: 0,
firstBatch: [] } }
      }
      if (body.aggregate === "coinzilla_cGVvcGxl") {
        return { ok: 1,
cursor: { id: 0,
firstBatch: [] } }
      }
      return { ok: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    assert.equal(await database.readOne({
      collection: "people",
      id: "missing",
    }), null)
    assert.deepEqual(await database.readMany({
      collection: "people",
    }), [])
    assert.equal(calls.length, 2)
    assert.equal(calls.every((body) => body.lsid === undefined), true)
  } finally {
    await database.close()
  }
})

test("MongoDB read transaction boundary rejects mutations and multiple logical reads", async () => {
  const { provider } = createProviderHarness({
    commandHandler: async (body) => {
      if (body.find === "coinzilla_cGVvcGxl") {
        return { ok: 1,
cursor: { id: 0,
firstBatch: [] } }
      }
      return { ok: 1,
cursor: { id: 0,
firstBatch: [] } }
    },
  })
  await provider.connect()

  try {
    await assert.rejects(
      provider.withReadTransaction(async (transaction) => {
        await transaction.readOne({ collection: "people",
id: "one" })
        await transaction.readMany({ collection: "people" })
      }),
      /one provider-neutral read operation/,
    )
    await assert.rejects(
      provider.withReadTransaction((transaction) => transaction.create({
        collection: "people",
        record: { id: "one" },
      })),
      /cannot execute mutations/,
    )
    await assert.rejects(
      provider.withReadTransaction((transaction) => transaction.update({
        collection: "people",
        id: "one",
        changes: { name: "Ada" },
      })),
      /cannot execute mutations/,
    )
    await assert.rejects(
      provider.withReadTransaction((transaction) => transaction.delete({
        collection: "people",
        id: "one",
      })),
      /cannot execute mutations/,
    )
  } finally {
    await provider.close()
  }
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
        record: { id: "transaction-1",
name: "Ada" },
      })
      return "committed"
    })

    assert.equal(result, "committed")
    const insert = calls.find((body) => body.insert === "coinzilla_cGVvcGxl")
    const commit = calls.find((body) => body.commitTransaction === 1)
    assert.ok(insert.lsid)
    assert.equal(insert.autocommit, false)
    assert.equal(insert.startTransaction, true)
    assert.equal(insert.txnNumber, 1n)
    assert.equal(insert.lsid.id.subtype, 4)
    assert.deepEqual(commit.lsid, insert.lsid)
    assert.equal(commit.txnNumber, insert.txnNumber)
    assert.equal(commit.autocommit, false)
    assert.deepEqual(commit.writeConcern, { w: "majority",
wtimeout: 10000 })
  } finally {
    await database.close()
  }
})

test("MongoDB sharded transactions forward the latest recovery token on commit", async () => {
  const recoveryTokens = [
    { shard: "shard-1",
generation: 1 },
    { shard: "shard-2",
generation: 2 },
  ]
  let insertCount = 0
  const { provider, calls } = createProviderHarness({
    topology: "sharded",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.insert) {
        insertCount += 1
        return { ok: 1,
n: 1,
recoveryToken: recoveryTokens[insertCount - 1] }
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await database.transaction(async (transaction) => {
      await transaction.create({
        collection: "people",
        record: { id: "sharded-1" },
      })
      await transaction.create({
        collection: "people",
        record: { id: "sharded-2" },
      })
    })
    const commit = calls.find((body) => body.commitTransaction === 1)
    assert.deepEqual(commit.recoveryToken, recoveryTokens[1])
    assert.deepEqual(commit.writeConcern, { w: "majority",
wtimeout: 10000 })
  } finally {
    await database.close()
  }
})

test("MongoDB sharded commit retries with the latest recovery token", async () => {
  const recoveryTokens = [
    { shard: "shard-1",
generation: 1 },
    { shard: "shard-2",
generation: 2 },
    { shard: "shard-3",
generation: 3 },
  ]
  let commitAttempts = 0
  const commitTokens = []
  const { provider } = createProviderHarness({
    topology: "sharded",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.insert) {return { ok: 1,
n: 1,
recoveryToken: recoveryTokens[0] }}
      if (body.commitTransaction === 1) {
        commitAttempts += 1
        commitTokens.push(body.recoveryToken)
        if (commitAttempts === 1) {
          return {
            ok: 1,
            writeConcernError: { code: 64,
errmsg: "write concern timed out" },
            recoveryToken: recoveryTokens[1],
          }
        }
        return { ok: 1,
recoveryToken: recoveryTokens[2] }
      }
      return { ok: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await database.transaction((transaction) => transaction.create({
      collection: "people",
      record: { id: "sharded-commit-retry" },
    }))
    assert.equal(commitTokens.length, 2)
    assert.deepEqual(commitTokens[0], recoveryTokens[0])
    assert.deepEqual(commitTokens[1], recoveryTokens[1])
  } finally {
    await database.close()
  }
})

test("MongoDB sharded transaction abort forwards the latest recovery token", async () => {
  const recoveryToken = { shard: "shard-1",
generation: 3 }
  const callbackError = new Error("abort requested")
  const { provider, calls } = createProviderHarness({
    topology: "sharded",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.insert) {return { ok: 1,
n: 1,
recoveryToken }}
      return { ok: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.create({
          collection: "people",
          record: { id: "sharded-abort" },
        })
        throw callbackError
      }),
      (error) => error === callbackError,
    )
    const abort = calls.find((body) => body.abortTransaction === 1)
    assert.deepEqual(abort.recoveryToken, recoveryToken)
  } finally {
    await database.close()
  }
})

test("MongoDB sharded transactions fail closed when a successful response omits recoveryToken", async () => {
  const { provider, calls } = createProviderHarness({
    topology: "sharded",
    transactionSupported: true,
    commandHandler: async (body) => body.insert
      ? { ok: 1,
n: 1 }
      : { ok: 1 },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => transaction.create({
        collection: "people",
        record: { id: "missing-recovery-token" },
      })),
      (error) => {
        let current = error
        while (current) {
          if (current.message?.includes("recoveryToken")) {return true}
          current = current.cause
        }
        return false
      },
    )
    assert.equal(calls.some((body) => body.commitTransaction === 1), false)
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
        throw Object.assign(new Error("connection lost after commit was sent"), { outcomeUnknown: true })
      }
      return { ok: 1,
n: 1 }
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

test("MongoDB does not report a definitely-unsent commit as outcome-unknown", async () => {
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.commitTransaction === 1) {
        throw Object.assign(new Error("commit rejected before send"), {
          outcomeUnknown: false,
        })
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => transaction.create({
        collection: "people",
        record: { id: "unsent-commit" },
      })),
      (error) => error instanceof DatabaseProviderError
        && !(error instanceof DatabaseTransactionOutcomeUnknownError),
    )
    assert.equal(calls.filter((body) => body.commitTransaction === 1).length, 1)
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
      if (body.find === "coinzilla_cGVvcGxl") {
        return { ok: 1,
cursor: { id: 0,
firstBatch: [] } }
      }
      return { ok: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.readOne({ collection: "people",
id: "missing" })
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



test("MongoDB ignores abort errors and preserves the original callback failure", async () => {
  const callbackError = new Error("callback failed")
  const abortError = new Error("abort connection failed")
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.abortTransaction === 1) {throw abortError}
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.create({
          collection: "people",
          record: { id: "abort-error" },
        })
        throw callbackError
      }),
      (error) => error === callbackError,
    )
    assert.equal(calls.filter((body) => body.abortTransaction === 1).length, 1)
  } finally {
    await database.close()
  }
})

test("MongoDB sharded abort retries with the latest recovery token", async () => {
  const recoveryTokens = [
    { shard: "shard-1",
generation: 1 },
    { shard: "shard-2",
generation: 2 },
    { shard: "shard-3",
generation: 3 },
  ]
  const abortTokens = []
  const callbackError = new Error("callback failed")
  const { provider } = createProviderHarness({
    topology: "sharded",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.insert) {return { ok: 1,
n: 1,
recoveryToken: recoveryTokens[0] }}
      if (body.abortTransaction === 1) {
        abortTokens.push(body.recoveryToken)
        if (abortTokens.length === 1) {
          return {
            ok: 1,
            writeConcernError: { code: 64,
errmsg: "write concern timed out" },
            recoveryToken: recoveryTokens[1],
          }
        }
        return { ok: 1,
recoveryToken: recoveryTokens[2] }
      }
      return { ok: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.create({
          collection: "people",
          record: { id: "sharded-abort-retry" },
        })
        throw callbackError
      }),
      (error) => error === callbackError,
    )
    assert.equal(abortTokens.length, 2)
    assert.deepEqual(abortTokens[0], recoveryTokens[0])
    assert.deepEqual(abortTokens[1], recoveryTokens[1])
  } finally {
    await database.close()
  }
})

test("MongoDB retries a retryable abort once and preserves the callback failure", async () => {
  const callbackError = new Error("callback failed")
  let abortAttempts = 0
  const { provider } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.abortTransaction === 1) {
        abortAttempts += 1
        if (abortAttempts === 1) {
          throw Object.assign(new Error("abort reply lost"), { outcomeUnknown: true })
        }
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.create({
          collection: "people",
          record: { id: "abort-retry" },
        })
        throw callbackError
      }),
      (error) => error === callbackError,
    )
    assert.equal(abortAttempts, 2)
  } finally {
    await database.close()
  }
})

test("MongoDB provider waits for in-flight standalone CRUD before closing its socket", async () => {
  let releaseWrite
  let markWriteStarted
  const writeStarted = new Promise((resolve) => {
    markWriteStarted = resolve
  })
  const writeGate = new Promise((resolve) => {
    releaseWrite = resolve
  })
  const { provider, transports } = createProviderHarness({
    commandHandler: async (body) => {
      if (body.insert === "coinzilla_cGVvcGxl") {
        markWriteStarted()
        await writeGate
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  const creating = database.create({
    collection: "people",
    record: { id: "in-flight-crud" },
  })
  await writeStarted
  const closing = database.close()

  assert.equal(database.state, "closing")
  assert.equal(transports[0].closed, false)
  releaseWrite()
  await Promise.all([creating, closing])

  assert.equal(transports[0].closed, true)
  assert.equal(database.state, "closed")
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
      return { ok: 1,
n: 1 }
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


test("MongoDB directConnection rejects a replica-set secondary instead of silently redirecting", async () => {
  const transports = []
  const provider = createMongoProvider({
    uri: "mongodb://secondary:27017/app?directConnection=true",
    transportFactory: (options) => {
      const transport = {
        options,
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
    handshake: async () => ({
      topology: "replicaSet",
      primary: "primary.example:27017",
      transactionSupported: true,
    }),
  })

  await assert.rejects(
    provider.connect(),
    (error) => error.cause?.message.includes("directConnection target is not the writable"),
  )
  assert.equal(transports.length, 1)
  assert.equal(transports[0].closed, true)
  await provider.close()
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
        ? { topology: "replicaSet",
primary: "primary.example:27018",
transactionSupported: true }
        : { topology: "replicaSet",
primary: null,
transactionSupported: true }
    },
  })

  await provider.connect()
  await provider.close()

  assert.deepEqual(hosts, [["seed", 27017], ["primary.example", 27018]])
  assert.equal(transports[0].closed, true)
  assert.equal(transports[1].closed, true)
})


function matchesConformanceDocument({ document, filter }) {
  const conditions = filter.$and ?? []
  return conditions.every((condition) => {
    const [[path, expected]] = Object.entries(condition)
    const key = path.slice("data.".length)
    const exists = Object.hasOwn(document.data, key)
    if (expected && expected.$type === 10) {
      return exists && document.data[key] === null
    }
    return exists && document.data[key] === expected
  })
}

function scalarRank(value) {
  if (value === undefined || value === null) { return 0 }
  if (typeof value === "boolean") { return 1 }
  if (typeof value === "number") { return 2 }
  if (typeof value === "string") { return 3 }
  return 4
}

function compareScalar({ left, right }) {
  const rank = scalarRank(left) - scalarRank(right)
  if (rank !== 0) { return rank }
  if (left === undefined || left === null) { return 0 }
  if (typeof left === "number" || typeof left === "string") {
    if (left < right) { return -1 }
    if (left > right) { return 1 }
    return 0
  }
  if (typeof left === "boolean") { return Number(left) - Number(right) }
  return 0
}

function resolveSortField({ expression, isTypeKey }) {
  if (isTypeKey) {
    return expression?.$switch?.branches?.[0]?.case?.$in?.[0]?.$type
  }
  return expression?.$cond?.[2]?.$ifNull?.[0]
}

function compareConformanceDocuments({ left, right, sortFields, additions }) {
  for (const [sortKey, direction] of sortFields) {
    const expression = additions[sortKey]
    const isTypeKey = sortKey.includes("SortType")
    const fieldPath = resolveSortField({ expression,
isTypeKey })
    const field = typeof fieldPath === "string" ? fieldPath.slice("$data.".length) : null
    const leftValue = field ? left.data[field] : undefined
    const rightValue = field ? right.data[field] : undefined
    const comparison = isTypeKey
      ? scalarRank(leftValue) - scalarRank(rightValue)
      : compareScalar({ left: leftValue,
right: rightValue })
    if (comparison !== 0) {
      return comparison * direction
    }
  }
  if (left._id < right._id) { return -1 }
  if (left._id > right._id) { return 1 }
  return 0
}

function sortConformanceDocuments({ documents, pipeline }) {
  const additions = pipeline.find((stage) => stage.$addFields)?.$addFields ?? {}
  const sort = pipeline.find((stage) => stage.$sort)?.$sort ?? { _id: 1 }
  const sortFields = Object.entries(sort).filter(([key]) => key !== "_id")
  documents.sort((...items) => compareConformanceDocuments({
    left: items[0],
    right: items[1],
    sortFields,
    additions,
  }))
}

function createInsertResult({ records, body, sequences }) {
  const documents = sequences.find((sequence) => sequence.identifier === "documents")?.documents
    ?? body.documents
    ?? []
  for (const document of documents) {
    if (records.has(document._id)) {
      return {
        ok: 1,
        n: 0,
        writeErrors: [{ code: 11000,
errmsg: "duplicate key" }],
      }
    }
    records.set(document._id, structuredClone(document))
  }
  return { ok: 1,
n: documents.length }
}

function createFindResult({ records, body }) {
  const document = records.get(body.filter._id)
  return {
    ok: 1,
    cursor: {
      id: 0,
      firstBatch: document ? [{
        _id: document._id,
        data: structuredClone(document.data),
      }] : [],
    },
  }
}

function createAggregateResult({ records, body }) {
  let documents = [...records.values()].filter((document) => matchesConformanceDocument({
    document,
    filter: body.pipeline[0].$match,
  }))
  sortConformanceDocuments({ documents,
pipeline: body.pipeline })
  const skip = body.pipeline.find((stage) => stage.$skip)?.$skip ?? 0
  const limit = body.pipeline.find((stage) => stage.$limit)?.$limit
  documents = documents.slice(skip, limit === undefined ? undefined : skip + limit)
  return {
    ok: 1,
    cursor: {
      id: 0,
      firstBatch: documents.map((document) => ({
        _id: document._id,
        data: structuredClone(document.data),
      })),
    },
  }
}

function createUpdateResult({ records, body }) {
  const document = records.get(body.query._id)
  if (!document) {
    return { ok: 1,
value: null }
  }
  for (const [path, value] of Object.entries(body.update.$set)) {
    const [root, key] = path.split(".")
    if (root === "data") {
      document.data[key] = structuredClone(value)
    }
  }
  return {
    ok: 1,
    value: {
      _id: document._id,
      data: structuredClone(document.data),
    },
  }
}

function createDeleteResult({ records, body }) {
  const removed = records.delete(body.deletes[0].q._id)
  return { ok: 1,
n: Number(removed) }
}

function createConformanceMongoServer(store) {
  return async function command({ body, sequences = [] }) {
    const collection = body.insert ?? body.find ?? body.aggregate ?? body.findAndModify ?? body.delete
    const records = store.get(collection) ?? new Map()
    store.set(collection, records)
    if (body.insert) {
      return createInsertResult({ records,
body,
sequences })
    }
    if (body.find) {
      return createFindResult({ records,
body })
    }
    if (body.aggregate) {
      return createAggregateResult({ records,
body })
    }
    if (body.findAndModify) {
      return createUpdateResult({ records,
body })
    }
    if (body.delete) {
      return createDeleteResult({ records,
body })
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
          command: ({ body, sequences }) => command({ body,
sequences }),
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


test("MongoDB transactions serialize commands and wait for all transaction CRUD before commit", async () => {
  const events = []
  let activeCommands = 0
  let maximumConcurrentCommands = 0
  const { provider } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (...argumentsList) => {
      const [body, , sequences] = argumentsList
      if (body.insert) {
        activeCommands += 1
        maximumConcurrentCommands = Math.max(maximumConcurrentCommands, activeCommands)
        events.push(`insert-start:${sequences[0].documents[0]._id}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        events.push(`insert-end:${sequences[0].documents[0]._id}`)
        activeCommands -= 1
        return { ok: 1,
n: 1 }
      }
      if (body.commitTransaction) {
        events.push("commit")
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await database.transaction(async (transaction) => {
      await Promise.all([
        transaction.create({ collection: "people",
record: { id: "serial-1" } }),
        transaction.create({ collection: "people",
record: { id: "serial-2" } }),
      ])
    })
    assert.equal(maximumConcurrentCommands, 1)
    assert.equal(events.at(-1), "commit")
    assert.ok(events.indexOf("insert-end:serial-1") < events.indexOf("insert-start:serial-2"))
    assert.ok(events.indexOf("insert-end:serial-2") < events.indexOf("commit"))
  } finally {
    await database.close()
  }
})

test("MongoDB transactions reject synchronous callbacks that start unawaited CRUD", async () => {
  const events = []
  const { provider } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.insert) {events.push("insert")}
      if (body.abortTransaction) {events.push("abort")}
      if (body.commitTransaction) {events.push("commit")}
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => {
        transaction.create({ collection: "people",
record: { id: "unawaited" } })
        return "callback returned before CRUD settled"
      }),
      /asynchronous.*CRUD|await.*CRUD/i,
    )
    assert.deepEqual(events, ["insert", "abort"])
  } finally {
    await database.close()
  }
})


test("MongoDB commit treats an explicit write concern rejection as a confirmed provider failure", async () => {
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.commitTransaction) {
        return {
          ok: 1,
          writeConcernError: { code: 79,
errmsg: "invalid write concern" },
          errorLabels: [],
        }
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => transaction.create({
        collection: "people",
        record: { id: "known-commit-failure" },
      })),
      (error) => error.code === "DB_PROVIDER_OPERATION_FAILED",
    )
    assert.equal(calls.filter((body) => body.commitTransaction === 1).length, 1)
    assert.equal(calls.filter((body) => body.abortTransaction === 1).length, 1)
  } finally {
    await database.close()
  }
})


test("MongoDB retries only ambiguous write-concern timeouts and reports exhaustion", async () => {
  let attempts = 0
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.commitTransaction) {
        attempts += 1
        return {
          ok: 1,
          writeConcernError: {
            code: 64,
            codeName: "WriteConcernTimeout",
            errmsg: "replication acknowledgement timed out",
          },
        }
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => transaction.create({
        collection: "people",
        record: { id: "write-concern-timeout" },
      })),
      (error) => error instanceof DatabaseTransactionOutcomeUnknownError,
    )
    assert.equal(attempts, 3)
    assert.equal(calls.filter((body) => body.commitTransaction === 1).length, 3)
  } finally {
    await database.close()
  }
})

test("MongoDB retries commit after a RetryableWriteError label", async () => {
  let commitAttempts = 0
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.commitTransaction === 1) {
        commitAttempts += 1
        if (commitAttempts === 1) {
          return {
            ok: 0,
            code: 91,
            errmsg: "not primary",
            errorLabels: ["RetryableWriteError"],
          }
        }
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await database.transaction((transaction) => transaction.create({
      collection: "people",
      record: { id: "retryable-commit" },
    }))
    assert.equal(calls.filter((body) => body.commitTransaction === 1).length, 2)
  } finally {
    await database.close()
  }
})

test("MongoDB treats MaxTimeMSExpired during commit as an unknown result after bounded retries", async () => {
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.commitTransaction === 1) {
        return {
          ok: 0,
          code: 50,
          codeName: "MaxTimeMSExpired",
          errmsg: "commit time limit expired",
        }
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => transaction.create({
        collection: "people",
        record: { id: "commit-timeout" },
      })),
      (error) => error instanceof DatabaseTransactionOutcomeUnknownError,
    )
    assert.equal(calls.filter((body) => body.commitTransaction === 1).length, 3)
  } finally {
    await database.close()
  }
})

test("MongoDB preserves an ambiguous commit outcome after a lost reply and a later NoSuchTransaction", async () => {
  let commitAttempts = 0
  const { provider, calls } = createProviderHarness({
    topology: "replicaSet",
    transactionSupported: true,
    commandHandler: async (body) => {
      if (body.commitTransaction) {
        commitAttempts += 1
        if (commitAttempts === 1) {throw Object.assign(new Error("reply lost after commit request"), { outcomeUnknown: true })}
        return { ok: 0,
code: 251,
errmsg: "NoSuchTransaction" }
      }
      return { ok: 1,
n: 1 }
    },
  })
  const database = createDatabase({ provider })
  await database.connect()

  try {
    await assert.rejects(
      database.transaction((transaction) => transaction.create({
        collection: "people",
        record: { id: "uncertain-commit" },
      })),
      (error) => error instanceof DatabaseTransactionOutcomeUnknownError,
    )
    assert.equal(calls.filter((body) => body.commitTransaction === 1).length, 3)
  } finally {
    await database.close()
  }
})


test("MongoDB directConnection rejects a replica-set secondary instead of enabling unsupported writes", async () => {
  const transports = []
  const provider = createMongoProvider({
    uri: "mongodb://secondary:27017/app?directConnection=true",
    transportFactory: () => {
      const transport = {
        closed: false,
        async connect() {},
        async command() { return { ok: 1 } },
        async close() { this.closed = true },
      }
      transports.push(transport)
      return transport
    },
    handshake: async () => ({
      topology: "replicaSet",
      primary: "primary.example:27017",
      transactionSupported: true,
      sessionsSupported: true,
    }),
  })

  await assert.rejects(
    provider.connect(),
    (error) => error.cause?.message.includes("directConnection target is not the writable replica-set primary"),
  )
  assert.equal(transports[0].closed, true)
})


test("MongoDB provider rejects passwords configured without a username", () => {
  assert.throws(
    () => createMongoProvider({
      host: "localhost",
      password: "secret",
    }),
    /password requires a username/i,
  )
})


test("MongoDB provider rejects invalid explicit database names before connecting", () => {
  assert.throws(
    () => createMongoProvider({
      host: "localhost",
      databaseName: "bad/name",
    }),
    /databaseName.*unsupported character/i,
  )
})


test("MongoDB provider rejects database names beyond the portable 63-byte limit", () => {
  assert.throws(
    () => createMongoProvider({
      host: "localhost",
      databaseName: "d".repeat(64),
    }),
    /databaseName.*63-byte/i,
  )
})

test("MongoDB URI authSource defaults to the URI database when databaseName is explicitly overridden", async () => {
  let handshakeOptions
  const provider = createMongoProvider({
    uri: "mongodb://alice:secret@localhost/original",
    databaseName: "override",
    transportFactory: () => ({
      async connect() {},
      async command() {
        throw new Error("The injected handshake must own handshake commands")
      },
      async close() {},
    }),
    handshake: async (options) => {
      handshakeOptions = options
      return {
        topology: "standalone",
        transactionSupported: false,
        sessionsSupported: false,
        primary: null,
      }
    },
  })

  await provider.connect()
  try {
    assert.equal(
      handshakeOptions.databaseName,
      "override",
      "The explicit databaseName option must override the URI database",
    )
    assert.equal(
      handshakeOptions.authSource,
      "original",
      "The URI database remains the default authentication database when databaseName overrides only the target database",
    )
  } finally {
    await provider.close()
  }
})

test("MongoDB URI authSource remains explicit when databaseName is overridden", async () => {
  let handshakeOptions
  const provider = createMongoProvider({
    uri: "mongodb://alice:secret@localhost/original?authSource=security",
    databaseName: "override",
    transportFactory: () => ({
      async connect() {},
      async command() {
        throw new Error("The injected handshake must own handshake commands")
      },
      async close() {},
    }),
    handshake: async (options) => {
      handshakeOptions = options
      return {
        topology: "standalone",
        transactionSupported: false,
        sessionsSupported: false,
        primary: null,
      }
    },
  })

  await provider.connect()
  try {
    assert.equal(handshakeOptions.databaseName, "override")
    assert.equal(handshakeOptions.authSource, "security")
  } finally {
    await provider.close()
  }
})
