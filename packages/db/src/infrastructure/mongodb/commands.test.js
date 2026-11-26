import assert from "node:assert/strict"
import test from "node:test"

import { DatabaseConflictError, DatabaseProviderError } from "../../domain/errors/database-errors.js"
import { createMongoRecordOperations } from "./commands.js"

function createCommandStub(responses = []) {
  const calls = []
  return {
    calls,
    async command({ body }) {
      calls.push(body)
      const response = responses.shift()
      if (response instanceof Error) {
        throw response
      }
      return response ?? { ok: 1, n: 1 }
    },
  }
}

test("MongoDB create isolates collection records and returns the provider-neutral JSON snapshot", async () => {
  const stub = createCommandStub()
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })
  const record = {
    id: "person-1",
    profile: {
      displayName: "Ada",
      flags: ["active"],
    },
  }

  assert.deepEqual(
    await operations.create({ collection: "people", record }),
    record,
  )
  assert.match(stub.calls[0].insert, /^coinzilla_/)
  assert.equal(stub.calls[0].documents[0]._id, "person-1")
  assert.notDeepEqual(stub.calls[0].documents[0].data, record)
  assert.equal(stub.calls[0].$db, "app")
})

test("MongoDB create maps duplicate key responses to the shared conflict error", async () => {
  const stub = createCommandStub([{
    ok: 1,
    n: 0,
    writeErrors: [{ code: 11000, errmsg: "duplicate key" }],
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.create({
      collection: "people",
      record: { id: "duplicate" },
    }),
    (error) => error instanceof DatabaseConflictError
      && error.code === "DB_RECORD_CONFLICT",
  )
})

test("MongoDB readOne returns null or the decoded stored record", async () => {
  const stub = createCommandStub([
    { ok: 1, cursor: { firstBatch: [] } },
    { ok: 1, cursor: { firstBatch: [{ data: { id: "person-1", name: "Ada" } }] } },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  assert.equal(await operations.readOne({ collection: "people", id: "missing" }), null)
  assert.deepEqual(
    await operations.readOne({ collection: "people", id: "person-1" }),
    { id: "person-1", name: "Ada" },
  )
})

test("MongoDB readMany builds exact-null filters and portable sort pagination stages", async () => {
  const stub = createCommandStub([{
    ok: 1,
    cursor: {
      id: 0,
      firstBatch: [{ data: { id: "person-1", nickname: null } }],
    },
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  const records = await operations.readMany({
    collection: "people",
    query: {
      filter: { nickname: null },
      sort: [{ field: "name", direction: "desc" }],
      limit: 5,
      offset: 10,
    },
  })

  assert.deepEqual(records, [{ id: "person-1", nickname: null }])
  const pipeline = stub.calls[0].pipeline
  assert.deepEqual(pipeline[0].$match.$and[0]["data.__coinzilla_key_bmlja25hbWU"], { $type: 10 })
  assert.ok(pipeline.some((stage) => stage.$addFields))
  assert.deepEqual(pipeline.find((stage) => stage.$sort).$sort, {
    __coinzillaSortType0: -1,
    __coinzillaSortValue0: -1,
    _id: 1,
  })
  assert.deepEqual(pipeline.find((stage) => stage.$skip).$skip, 10)
  assert.deepEqual(pipeline.find((stage) => stage.$limit).$limit, 5)
})

test("MongoDB readMany drains every cursor batch", async () => {
  const stub = createCommandStub([
    { ok: 1, cursor: { id: 12, firstBatch: [{ data: { id: "one" } }] } },
    { ok: 1, cursor: { id: 0, nextBatch: [{ data: { id: "two" } }] } },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  assert.deepEqual(
    await operations.readMany({ collection: "people" }),
    [{ id: "one" }, { id: "two" }],
  )
  assert.equal(stub.calls[1].getMore, 12)
})


test("MongoDB readMany kills an open cursor after a failed getMore response", async () => {
  const stub = createCommandStub([
    { ok: 1, cursor: { id: 12, firstBatch: [] } },
    { ok: 1, cursor: { id: 12 } },
    { ok: 1, cursorsUnknown: [] },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readMany({ collection: "people" }),
    /getMore response omitted cursor.nextBatch/,
  )
  assert.equal(stub.calls[2].killCursors.startsWith("coinzilla_"), true)
  assert.deepEqual(stub.calls[2].cursors, [12])
})

test("MongoDB update and delete preserve missing-record result semantics", async () => {
  const stub = createCommandStub([
    { ok: 1, value: null },
    { ok: 1, n: 0 },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  assert.equal(await operations.update({
    collection: "people",
    id: "missing",
    changes: { name: "Ada" },
  }), null)
  assert.equal(await operations.delete({
    collection: "people",
    id: "missing",
  }), false)
})

test("MongoDB provider failures are normalized without hiding their causes", async () => {
  const nativeError = new Error("socket reset")
  const stub = createCommandStub([nativeError])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readOne({ collection: "people", id: "one" }),
    (error) => error instanceof DatabaseProviderError
      && error.code === "DB_PROVIDER_OPERATION_FAILED"
      && error.cause === nativeError,
  )
})
