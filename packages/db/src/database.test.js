import assert from "node:assert/strict"
import test from "node:test"

import { createDatabase } from "../src/index.js"

function createAdapter(overrides = {}) {
  const calls = {
    connect: 0,
    close: 0,
    transactions: 0,
  }

  return {
    calls,
    adapter: {
      async connect() {
        calls.connect += 1
      },
      async close() {
        calls.close += 1
      },
      async withTransaction(work) {
        calls.transactions += 1
        return work({ transactionId: "transaction-1" })
      },
      ...overrides,
    },
  }
}

test("createDatabase rejects a missing or incomplete adapter", () => {
  assert.throws(() => createDatabase(), /adapter object/)
  assert.throws(
    () => createDatabase({ adapter: { connect() {} } }),
    /close.*withTransaction/,
  )
})

test("connect coalesces concurrent calls and exposes connected state", async () => {
  let resolveConnect
  const { adapter, calls } = createAdapter({
    connect: () => {
      calls.connect += 1
      return new Promise((resolve) => {
        resolveConnect = resolve
      })
    },
  })
  const database = createDatabase({ adapter })

  const first = database.connect()
  const second = database.connect()

  assert.equal(database.state, "connecting")
  assert.equal(calls.connect, 1)

  resolveConnect()
  await Promise.all([first, second])

  assert.equal(database.state, "connected")
})

test("synchronous connection failures restore the disconnected state", async () => {
  const { adapter } = createAdapter({
    connect: () => {
      throw new Error("synchronous connection failure")
    },
  })
  const database = createDatabase({ adapter })

  await assert.rejects(database.connect(), /synchronous connection failure/)
  assert.equal(database.state, "disconnected")
})

test("a failed connection can be retried", async () => {
  let attempts = 0
  const { adapter } = createAdapter({
    connect: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("connection refused")
    },
  })
  const database = createDatabase({ adapter })

  await assert.rejects(database.connect(), /connection refused/)
  assert.equal(database.state, "disconnected")

  await database.connect()
  assert.equal(database.state, "connected")
  assert.equal(attempts, 2)
})

test("transactions require a connected database and a callback", async () => {
  const { adapter } = createAdapter()
  const database = createDatabase({ adapter })

  assert.throws(() => database.transaction(() => {}), /connected/)
  await database.connect()
  assert.throws(() => database.transaction(null), /callback/)
})

test("transaction delegates its opaque context and returns the callback result", async () => {
  const { adapter, calls } = createAdapter()
  const database = createDatabase({ adapter })
  await database.connect()

  const result = await database.transaction(async (transaction) => ({
    id: transaction.transactionId,
  }))

  assert.deepEqual(result, { id: "transaction-1" })
  assert.equal(calls.transactions, 1)
})

test("synchronous transaction failures propagate without changing connection state", async () => {
  const { adapter } = createAdapter({
    withTransaction: () => {
      throw new Error("synchronous transaction failure")
    },
  })
  const database = createDatabase({ adapter })
  await database.connect()

  await assert.rejects(database.transaction(() => "unused"), /synchronous transaction failure/)
  assert.equal(database.state, "connected")
})

test("transaction errors propagate without changing connection state", async () => {
  const { adapter } = createAdapter({
    withTransaction: async () => {
      throw new Error("commit failed")
    },
  })
  const database = createDatabase({ adapter })
  await database.connect()

  await assert.rejects(database.transaction(() => "unused"), /commit failed/)
  assert.equal(database.state, "connected")
})

test("close waits for active transactions and rejects new transactions", async () => {
  let finishTransaction
  const { adapter, calls } = createAdapter({
    withTransaction: () => new Promise((resolve) => {
      finishTransaction = resolve
    }),
  })
  const database = createDatabase({ adapter })
  await database.connect()

  const transaction = database.transaction(() => "committed")
  const closing = database.close()
  const closingAgain = database.close()

  assert.equal(database.state, "closing")
  assert.throws(() => database.transaction(() => {}), /connected/)
  assert.equal(calls.close, 0)

  finishTransaction("committed")
  assert.equal(await transaction, "committed")
  await Promise.all([closing, closingAgain])

  assert.equal(database.state, "closed")
  assert.equal(calls.close, 1)
})

test("a closed database cannot reconnect", async () => {
  const { adapter } = createAdapter()
  const database = createDatabase({ adapter })
  await database.close()

  await assert.rejects(database.connect(), /closed/)
})

test("close marks a failed connection as closed without calling adapter close", async () => {
  const { adapter, calls } = createAdapter({
    connect: () => {
      throw new Error("connection failed")
    },
  })
  const database = createDatabase({ adapter })
  const connecting = database.connect()
  const closing = database.close()

  await assert.rejects(connecting, /connection failed/)
  await closing

  assert.equal(database.state, "closed")
  assert.equal(calls.close, 0)
})

test("close is idempotent and closes a disconnected database without connecting", async () => {
  const { adapter, calls } = createAdapter()
  const database = createDatabase({ adapter })

  await Promise.all([database.close(), database.close()])

  assert.equal(database.state, "closed")
  assert.equal(calls.connect, 0)
  assert.equal(calls.close, 0)
})

test("close waits for an in-progress connection before closing it", async () => {
  let finishConnect
  const { adapter, calls } = createAdapter({
    connect: () => new Promise((resolve) => {
      finishConnect = resolve
    }),
  })
  const database = createDatabase({ adapter })

  const connecting = database.connect()
  const closing = database.close()

  assert.equal(database.state, "connecting")
  finishConnect()
  await Promise.all([connecting, closing])

  assert.equal(database.state, "closed")
  assert.equal(calls.close, 1)
})

test("a failed close remains retryable without reopening transactions", async () => {
  let attempts = 0
  const { adapter } = createAdapter({
    close: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("close failed")
    },
  })
  const database = createDatabase({ adapter })
  await database.connect()

  await assert.rejects(database.close(), /close failed/)
  assert.equal(database.state, "closing")
  assert.throws(() => database.transaction(() => {}), /connected/)

  await database.close()
  assert.equal(database.state, "closed")
  assert.equal(attempts, 2)
})
