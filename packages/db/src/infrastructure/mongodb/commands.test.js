import assert from "node:assert/strict"
import test from "node:test"

import {
  DatabaseConflictError,
  DatabaseOperationOutcomeUnknownError,
  DatabaseProviderError,
} from "../../domain/errors/database-errors.js"
import { createMongoRecordOperations } from "./commands.js"
import { encodeOpMsg } from "./wire-protocol.js"

function createCommandStub(responses = []) {
  const calls = []
  const sequences = []
  return {
    calls,
    sequences,
    async command({ body, sequences: documentSequences = [] }) {
      calls.push(body)
      sequences.push(documentSequences)
      const response = responses.shift()
      if (response instanceof Error) {
        throw response
      }
      return response ?? { ok: 1,
n: 1 }
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
    await operations.create({ collection: "people",
record }),
    record,
  )
  assert.match(stub.calls[0].insert, /^coinzilla_/)
  assert.equal(stub.calls[0].documents, undefined)
  assert.equal(stub.sequences[0][0].identifier, "documents")
  assert.equal(stub.sequences[0][0].documents[0]._id, "person-1")
  assert.notDeepEqual(stub.sequences[0][0].documents[0].data, record)
  assert.equal(stub.sequences[0][0].documents[0].sortData, undefined)
  assert.equal(stub.calls[0].$db, "app")
})

test("MongoDB create maps duplicate key responses to the shared conflict error", async () => {
  const stub = createCommandStub([{
    ok: 1,
    n: 0,
    writeErrors: [{ code: 11000,
errmsg: "duplicate key" }],
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
    { ok: 1,
cursor: { id: 0,
firstBatch: [] } },
    { ok: 1,
cursor: { id: 0,
firstBatch: [{ _id: "person-1",
data: { __coinzilla_key_aWQ: "person-1",
__coinzilla_key_bmFtZQ: "Ada" } }] } },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  assert.equal(await operations.readOne({ collection: "people",
id: "missing" }), null)
  assert.deepEqual(
    await operations.readOne({ collection: "people",
id: "person-1" }),
    { id: "person-1",
name: "Ada" },
  )
})


test("MongoDB rejects stored documents whose decoded record has no valid identifier", async () => {
  const operations = createMongoRecordOperations({
    command: async () => ({
      ok: 1,
      cursor: { id: 0,
firstBatch: [{ _id: "record-1",
data: { __coinzilla_key_bmFtZQ: "missing id" } }] },
    }),
    databaseName: "app",
  })

  await assert.rejects(
    operations.readOne({ collection: "people",
id: "record-1" }),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message.includes("Record identifier"),
  )
})

test("MongoDB readMany builds exact-null filters and portable sort pagination stages", async () => {
  const stub = createCommandStub([{
    ok: 1,
    cursor: {
      id: 0,
      firstBatch: [{ _id: "person-1",
data: { __coinzilla_key_aWQ: "person-1",
__coinzilla_key_bmlja25hbWU: null } }],
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
      sort: [{ field: "name",
direction: "desc" }],
      limit: 5,
      offset: 10,
    },
  })

  assert.deepEqual(records, [{ id: "person-1",
nickname: null }])
  const {pipeline} = stub.calls[0]
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


test("MongoDB updates shallow-merge JSON values without storing derived sort metadata", async () => {
  const stub = createCommandStub([{
    ok: 1,
    value: {
      _id: "person-1",
      data: {
        __coinzilla_key_aWQ: "person-1",
        __coinzilla_key_cmFuaw: [1, 2],
      },
    },
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  assert.deepEqual(
    await operations.update({
      collection: "people",
      id: "person-1",
      changes: { rank: [1, 2] },
    }),
    { id: "person-1",
rank: [1, 2] },
  )
  assert.deepEqual(stub.calls[0].update.$set, {
    "data.__coinzilla_key_cmFuaw": [1, 2],
  })
})

test("MongoDB empty updates delegate to readOne without issuing a mutation", async () => {
  const stub = createCommandStub([{
    ok: 1,
    cursor: { id: 0,
firstBatch: [{ _id: "person-1",
data: { __coinzilla_key_aWQ: "person-1" } }] },
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  assert.deepEqual(
    await operations.update({
      collection: "people",
      id: "person-1",
      changes: {},
    }),
    { id: "person-1" },
  )
  assert.equal(stub.calls[0].find.startsWith("coinzilla_"), true)
})

test("MongoDB delete reports successful single-record deletion", async () => {
  const stub = createCommandStub([{ ok: 1,
n: 1 }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  assert.equal(
    await operations.delete({ collection: "people",
id: "person-1" }),
    true,
  )
})

test("MongoDB rejects malformed cursor responses rather than returning empty results", async () => {
  const readOne = createMongoRecordOperations({
    command: async () => ({ ok: 1,
cursor: { id: 0 } }),
    databaseName: "app",
  })
  const readMany = createMongoRecordOperations({
    command: async () => ({ ok: 1,
cursor: { id: 0 } }),
    databaseName: "app",
  })

  await assert.rejects(
    readOne.readOne({ collection: "people",
id: "person-1" }),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message.includes("cursor.firstBatch"),
  )
  await assert.rejects(
    readMany.readMany({ collection: "people" }),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message.includes("cursor.firstBatch"),
  )
})


test("MongoDB readOne closes unexpected non-exhausted single-batch cursors", async () => {
  const stub = createCommandStub([
    { ok: 1,
cursor: { id: 99,
firstBatch: [{ _id: "person-1",
data: { __coinzilla_key_aWQ: "person-1" } }] } },
    { ok: 1,
cursorsKilled: [99] },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  assert.deepEqual(
    await operations.readOne({ collection: "people",
id: "person-1" }),
    { id: "person-1" },
  )
  assert.equal(stub.calls[1].killCursors, "coinzilla_cGVvcGxl")
  assert.deepEqual(stub.calls[1].cursors, [99])
})

test("MongoDB reads reject invalid cursor identifiers", async () => {
  const operations = createMongoRecordOperations({
    command: async ({ body }) => ({
      ok: 1,
      cursor: body.find
        ? { id: "0",
firstBatch: [] }
        : { id: -1,
firstBatch: [] },
    }),
    databaseName: "app",
  })

  await assert.rejects(
    operations.readOne({ collection: "people",
id: "one" }),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message.includes("invalid cursor id"),
  )
  await assert.rejects(
    operations.readMany({ collection: "people" }),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message.includes("invalid cursor id"),
  )
})

test("MongoDB readMany accepts BSON int64 cursor ids and validates getMore replacements", async () => {
  const stub = createCommandStub([
    { ok: 1,
cursor: { id: 12n,
firstBatch: [] } },
    { ok: 1,
cursor: { id: -1,
nextBatch: [] } },
    { ok: 1,
cursorsKilled: [12n] },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readMany({ collection: "people" }),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message.includes("invalid cursor id"),
  )
  assert.equal(stub.calls[1].getMore, 12n)
  assert.deepEqual(stub.calls[2].cursors, [12n])
})


test("MongoDB cleans up cursors when initial read batches are malformed", async () => {
  const readOneStub = createCommandStub([
    { ok: 1,
cursor: { id: 17,
firstBatch: null } },
    { ok: 1,
cursorsKilled: [17] },
  ])
  const readManyStub = createCommandStub([
    { ok: 1,
cursor: { id: 18,
firstBatch: null } },
    { ok: 1,
cursorsKilled: [18] },
  ])
  const readOne = createMongoRecordOperations({
    command: readOneStub.command,
    databaseName: "app",
  })
  const readMany = createMongoRecordOperations({
    command: readManyStub.command,
    databaseName: "app",
  })

  await assert.rejects(readOne.readOne({ collection: "people",
id: "one" }))
  await assert.rejects(readMany.readMany({ collection: "people" }))
  assert.deepEqual(readOneStub.calls[1].cursors, [17])
  assert.deepEqual(readManyStub.calls[1].cursors, [18])
})

test("MongoDB readMany drains every cursor batch", async () => {
  const stub = createCommandStub([
    { ok: 1,
cursor: { id: 12,
firstBatch: [{ _id: "one",
data: { __coinzilla_key_aWQ: "one" } }] } },
    { ok: 1,
cursor: { id: 0,
nextBatch: [{ _id: "two",
data: { __coinzilla_key_aWQ: "two" } }] } },
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
    { ok: 1,
cursor: { id: 12,
firstBatch: [] } },
    { ok: 1,
cursor: { id: 12 } },
    { ok: 1,
cursorsUnknown: [] },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readMany({ collection: "people" }),
    (error) => error.cause?.message === "MongoDB getMore response omitted cursor.nextBatch",
  )
  assert.equal(stub.calls[2].killCursors.startsWith("coinzilla_"), true)
  assert.deepEqual(stub.calls[2].cursors, [12])
})

test("MongoDB update and delete preserve missing-record result semantics", async () => {
  const stub = createCommandStub([
    { ok: 1,
value: null },
    { ok: 1,
n: 0 },
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
    operations.readOne({ collection: "people",
id: "one" }),
    (error) => error instanceof DatabaseProviderError
      && error.code === "DB_PROVIDER_OPERATION_FAILED"
      && error.cause === nativeError,
  )
})


test("MongoDB readMany kills an outstanding cursor when fetching a later batch fails", async () => {
  const transportError = new Error("getMore failed")
  const stub = createCommandStub([
    { ok: 1,
cursor: { id: 12,
firstBatch: [] } },
    transportError,
    { ok: 1,
cursorsKilled: [12] },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readMany({ collection: "people" }),
    (error) => error instanceof DatabaseProviderError && error.cause === transportError,
  )
  assert.equal(stub.calls[2].killCursors, "coinzilla_cGVvcGxl")
  assert.deepEqual(stub.calls[2].cursors, [12])
})


test("MongoDB readMany cleans up the replacement cursor when a later batch cannot be decoded", async () => {
  const stub = createCommandStub([
    { ok: 1,
cursor: { id: 12,
firstBatch: [] } },
    {
      ok: 1,
      cursor: {
        id: 99,
        nextBatch: [{ _id: 42,
data: {} }],
      },
    },
    { ok: 1,
cursorsKilled: [99] },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readMany({ collection: "people" }),
    (error) => error.cause?.message.includes("Record identifier"),
  )
  assert.equal(stub.calls[2].killCursors, "coinzilla_cGVvcGxl")
  assert.deepEqual(stub.calls[2].cursors, [99])
})

test("MongoDB record serialization limits surface as input TypeErrors rather than provider failures", async () => {
  const command = async ({ body, sequences }) => {
    encodeOpMsg({ requestId: 1,
body,
sequences })
    return { ok: 1,
n: 1 }
  }
  const operations = createMongoRecordOperations({
    command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.create({
      collection: "people",
      record: {
        id: "too-large",
        payload: "x".repeat(16 * 1024 * 1024),
      },
    }),
    (error) => error instanceof TypeError && /16 MiB/i.test(error.message),
  )
})


test("MongoDB rejects collection names whose encoded namespace exceeds the server limit", async () => {
  const operations = createMongoRecordOperations({
    command: async () => ({ ok: 1,
n: 1 }),
    databaseName: "app",
  })
  await assert.rejects(
    operations.create({
      collection: "c".repeat(200),
      record: { id: "namespace-limit" },
    }),
    /namespace length/i,
  )
})


test("MongoDB reads reject stored records whose envelope identifier disagrees with public id", async () => {
  const stub = createCommandStub([{
    ok: 1,
    cursor: {
      id: 0,
      firstBatch: [{
        _id: "envelope-id",
        data: {
          __coinzilla_key_aWQ: "record-id",
        },
      }],
    },
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readOne({ collection: "people",
id: "envelope-id" }),
    (error) => error instanceof DatabaseProviderError
      && /identifier.*does not match/i.test(error.cause.message),
  )
})


test("MongoDB reads reject malformed encoded user field names", async () => {
  const stub = createCommandStub([{
    ok: 1,
    cursor: {
      id: 0,
      firstBatch: [{
        _id: "person-1",
        data: {
          __coinzilla_key_aWQ: "person-1",
          __coinzilla_key__w: "invalid UTF-8 key",
        },
      }],
    },
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readOne({ collection: "people",
id: "person-1" }),
    (error) => error instanceof DatabaseProviderError
      && /invalid encoded MongoDB user key/i.test(error.cause.message),
  )
})


test("MongoDB updates store only changed encoded user data", async () => {
  const stub = createCommandStub([{
    ok: 1,
    value: {
      _id: "person-1",
      data: {
        __coinzilla_key_aWQ: "person-1",
        __coinzilla_key_bmFtZQ: "Ada",
      },
    },
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await operations.update({
    collection: "people",
    id: "person-1",
    changes: { name: "Ada" },
  })

  assert.deepEqual(stub.calls[0].update.$set, {
    "data.__coinzilla_key_bmFtZQ": "Ada",
  })
})


test("MongoDB readMany kills an outstanding cursor when the first batch is malformed", async () => {
  const stub = createCommandStub([
    {
      ok: 1,
      cursor: {
        id: 12,
        firstBatch: [{
          _id: "envelope-id",
          data: { __coinzilla_key_aWQ: "different-id" },
        }],
      },
    },
    { ok: 1,
cursorsKilled: [12] },
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })

  await assert.rejects(
    operations.readMany({ collection: "people" }),
    DatabaseProviderError,
  )
  assert.equal(stub.calls[1].killCursors, "coinzilla_cGVvcGxl")
  assert.deepEqual(stub.calls[1].cursors, [12])
})
test("MongoDB record operations reject invalid factory configuration", () => {
  assert.throws(
    () => createMongoRecordOperations({ command: null,
databaseName: "app" }),
    /command function/,
  )
  assert.throws(
    () => createMongoRecordOperations({ command: async () => ({ ok: 1 }),
databaseName: "" }),
    /database name/,
  )
})

test("MongoDB record decoding rejects missing, malformed, and non-canonical encoded user keys", async () => {
  const prefix = "__coinzilla_key_"
  for (const key of ["id", `${prefix}!`, `${prefix}Zh`]) {
    const stub = createCommandStub([{
      ok: 1,
      cursor: {
        id: 0,
        firstBatch: [{ _id: "one",
data: { [key]: "one" } }],
      },
    }])
    const operations = createMongoRecordOperations({
      command: stub.command,
      databaseName: "app",
    })
    await assert.rejects(
      operations.readOne({ collection: "people",
id: "one" }),
      (error) => error instanceof DatabaseProviderError
        && /provider encoding|base64url|encoded MongoDB user key/i.test(error.cause?.message ?? ""),
    )
  }
})

test("MongoDB record decoding rejects mismatched stored identifiers", async () => {
  const stub = createCommandStub([{
    ok: 1,
    cursor: {
      id: 0,
      firstBatch: [{
        _id: "envelope-id",
        data: { __coinzilla_key_aWQ: "different-id" },
      }],
    },
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })
  await assert.rejects(
    operations.readOne({ collection: "people",
id: "envelope-id" }),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message.includes("does not match its document envelope"),
  )
})

test("MongoDB write concern timeouts preserve ambiguous write outcomes", async () => {
  const stub = createCommandStub([{
    ok: 1,
    writeConcernError: {
      code: 64,
      codeName: "WriteConcernTimeout",
      errmsg: "write concern timed out",
    },
  }])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })
  await assert.rejects(
    operations.create({
      collection: "people",
      record: { id: "one" },
    }),
    (error) => error instanceof DatabaseOperationOutcomeUnknownError
      && error.context.operation === "create",
  )
})

test("MongoDB cursor cleanup preserves the original read failure when killCursors fails", async () => {
  const stub = createCommandStub([
    { ok: 1,
cursor: { id: 12,
firstBatch: "malformed" } },
    new Error("killCursors failed"),
  ])
  const operations = createMongoRecordOperations({
    command: stub.command,
    databaseName: "app",
  })
  await assert.rejects(
    operations.readMany({ collection: "people" }),
    (error) => error instanceof DatabaseProviderError
      && error.cause?.message.includes("cursor.firstBatch"),
  )
  assert.equal(stub.calls[1].killCursors, "coinzilla_cGVvcGxl")
})
