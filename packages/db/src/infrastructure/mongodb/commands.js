import { TextDecoder } from "node:util"

import {
  DatabaseConflictError,
  DatabaseOperationOutcomeUnknownError,
  DatabaseProviderError,
} from "../../domain/errors/database-errors.js"
import {
  normalizeReadQuery,
  serializeChanges,
  serializeRecord,
  validateCollectionName,
  validateRecordIdentifier,
} from "../../domain/contracts/record.js"

const USER_KEY_PREFIX = "__coinzilla_key_"
const CURSOR_BATCH_SIZE = 1_000
const MONGO_COLLECTION_PREFIX = "coinzilla_"


class MongoCommandError extends Error {
  constructor(response) {
    super(response.errmsg ?? "MongoDB command failed")
    this.name = "MongoCommandError"
    this.code = response.code
    this.codeName = response.codeName
    this.errorLabels = response.errorLabels ?? []
    this.response = response
    this.outcomeUnknown = response.outcomeUnknown === true
  }

  hasErrorLabel(label) {
    return this.errorLabels.includes(label)
  }
}

function encodeUserKey(key) {
  return USER_KEY_PREFIX + Buffer.from(key, "utf8").toString("base64url")
}

function decodeUserKey(key) {
  if (!key.startsWith(USER_KEY_PREFIX)) {
    throw new TypeError("MongoDB stored user key is missing its provider encoding")
  }
  const encoded = key.slice(USER_KEY_PREFIX.length)
  try {
    if (!/^[A-Za-z0-9_-]*$/u.test(encoded)) {
      throw new TypeError("MongoDB user key is not valid base64url")
    }
    const bytes = Buffer.from(encoded, "base64url")
    if (bytes.toString("base64url") !== encoded) {
      throw new TypeError("MongoDB user key is not canonical base64url")
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new TypeError("MongoDB returned an invalid encoded MongoDB user key", {
      cause: error,
    })
  }
}

function encodeUserValue(value) {
  if (Array.isArray(value)) {
    return value.map(encodeUserValue)
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        encodeUserKey(key),
        encodeUserValue(nestedValue),
      ]),
    )
  }
  return value
}

function decodeUserValue(value) {
  if (Array.isArray(value)) {
    return value.map(decodeUserValue)
  }
  if (value !== null && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        decodeUserKey(key),
        decodeUserValue(nestedValue),
      ]),
    )
  }
  return value
}

function mapMongoError({ error, operation, collection }) {
  if (error instanceof TypeError
    || error instanceof DatabaseConflictError
    || error instanceof DatabaseOperationOutcomeUnknownError
    || error instanceof DatabaseProviderError) {
    return error
  }
  if (error?.outcomeUnknown && ["create", "update", "delete"].includes(operation)) {
    return new DatabaseOperationOutcomeUnknownError({
      operation,
      collection,
      cause: error,
    })
  }
  if (error?.code === 11000 || error?.code === 11001) {
    return new DatabaseConflictError({
      collection,
      cause: error,
    })
  }
  return new DatabaseProviderError({
    operation,
    collection,
    cause: error,
  })
}

async function runMongoCommand({ command, body, sequences, operation, collection }) {
  try {
    const response = await command({
      body: {
        ...body,
        $db: body.$db,
      },
      sequences,
      operation,
    })
    if (!response || Number(response.ok) !== 1) {
      throw new MongoCommandError(response ?? {})
    }
    if (Array.isArray(response.writeErrors) && response.writeErrors.length > 0) {
      throw new MongoCommandError({
        ...response.writeErrors[0],
        errorLabels: response.errorLabels,
      })
    }
    if (response.writeConcernError) {
      const {writeConcernError} = response
      throw new MongoCommandError({
        ...writeConcernError,
        errorLabels: response.errorLabels,
        outcomeUnknown: writeConcernError.code === 64
          || writeConcernError.codeName === "WriteConcernTimeout"
          || writeConcernError.errInfo?.wtimeout === true,
      })
    }
    return response
  } catch (error) {
    throw mapMongoError({
      error,
      operation,
      collection,
    })
  }
}

function encodeCollectionName({ collection, databaseName }) {
  const encoded = MONGO_COLLECTION_PREFIX + Buffer.from(collection, "utf8").toString("base64url")
  if (Buffer.byteLength(`${databaseName}.${encoded}`, "utf8") > 255) {
    throw new TypeError("MongoDB collection namespace exceeds the supported namespace length")
  }
  return encoded
}



function createStoredDocument(record) {
  return {
    _id: record.id,
    data: encodeUserValue(record),
  }
}

function readStoredDocument(document) {
  if (!document || typeof document !== "object"
    || !document.data || typeof document.data !== "object"
    || Array.isArray(document.data) || Buffer.isBuffer(document.data)
    || document.data instanceof Date) {
    throw new TypeError("MongoDB returned a malformed stored record")
  }
  const record = decodeUserValue(document.data)
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("MongoDB returned a malformed stored record")
  }
  validateRecordIdentifier(record.id)
  if (record.id !== document._id) {
    throw new TypeError("MongoDB stored record identifier does not match its document envelope")
  }
  return JSON.parse(serializeRecord(record))
}

function decodeStoredRecord({ document, operation, collection }) {
  try {
    return readStoredDocument(document)
  } catch (error) {
    throw new DatabaseProviderError({
      operation,
      collection,
      cause: error,
    })
  }
}

function createFilter(filter) {
  const conditions = Object.entries(filter).map(([field, value]) => {
    const path = `data.${encodeUserKey(field)}`
    return value === null
      ? { [path]: { $type: 10 } }
      : { [path]: value }
  })
  return conditions.length === 0 ? {} : { $and: conditions }
}

function createSortStages(sort) {
  if (sort.length === 0) {
    return [{ $sort: { _id: 1 } }]
  }
  const additions = {}
  const ordering = {}
  for (let index = 0; index < sort.length; index += 1) {
    const { field, direction } = sort[index]
    const typeKey = `__coinzillaSortType${index}`
    const valueKey = `__coinzillaSortValue${index}`
    const fieldPath = `$data.${encodeUserKey(field)}`
    const typeExpression = { $type: fieldPath }
    additions[typeKey] = {
      $switch: {
        branches: [
          { case: { $in: [typeExpression, ["missing", "null"]] },
then: 0 },
          { case: { $eq: [typeExpression, "bool"] },
then: 1 },
          { case: { $in: [typeExpression, ["int", "long", "double", "decimal"]] },
then: 3 },
          { case: { $eq: [typeExpression, "string"] },
then: 4 },
        ],
        default: 5,
      },
    }
    additions[valueKey] = {
      $cond: [
        { $in: [typeExpression, ["array", "object"]] },
        null,
        { $ifNull: [fieldPath, null] },
      ],
    }
    const sortDirection = direction === "asc" ? 1 : -1
    ordering[typeKey] = sortDirection
    ordering[valueKey] = sortDirection
  }
  ordering._id = 1
  return [
    { $addFields: additions },
    { $sort: ordering },
  ]
}

function isValidCursorId(cursorId) {
  return (typeof cursorId === "number" && Number.isSafeInteger(cursorId) && cursorId >= 0)
    || (typeof cursorId === "bigint" && cursorId >= 0n)
}

function isCursorExhausted(cursorId) {
  return cursorId === 0 || cursorId === 0n
}

async function killMongoCursor({
  command,
  databaseName,
  collection,
  mongoCollection,
  cursorId,
  operation,
}) {
  if (isCursorExhausted(cursorId)) {
    return
  }
  try {
    await runMongoCommand({
      command,
      operation,
      collection,
      body: {
        killCursors: mongoCollection,
        cursors: [cursorId],
        $db: databaseName,
      },
    })
  } catch {
    // Preserve the original result or failure; connection cleanup owns any remaining cursor.
  }
}

function requireMongoCursor({ response, operation, collection, serverOperation }) {
  if (!response.cursor) {
    throw new DatabaseProviderError({
      operation,
      collection,
      cause: new Error(`MongoDB ${serverOperation} response omitted its cursor`),
    })
  }
  if (!isValidCursorId(response.cursor.id)) {
    throw new DatabaseProviderError({
      operation,
      collection,
      cause: new Error(`MongoDB ${serverOperation} response contained an invalid cursor id`),
    })
  }
  return response.cursor
}

function requireFirstBatch({ cursor, operation, collection, serverOperation }) {
  if (!Array.isArray(cursor.firstBatch)) {
    throw new DatabaseProviderError({
      operation,
      collection,
      cause: new Error(`MongoDB ${serverOperation} response omitted cursor.firstBatch`),
    })
  }
  return cursor.firstBatch
}

function decodeMongoBatch({ documents, operation, collection }) {
  return documents.map((document) => decodeStoredRecord({
    document,
    operation,
    collection,
  }))
}

async function readNextMongoBatch({
  command,
  databaseName,
  collection,
  mongoCollection,
  cursorId,
}) {
  const response = await runMongoCommand({
    command,
    operation: "readMany",
    collection,
    body: {
      getMore: cursorId,
      collection: mongoCollection,
      batchSize: CURSOR_BATCH_SIZE,
      $db: databaseName,
    },
  })
  if (!Array.isArray(response.cursor?.nextBatch)) {
    throw new DatabaseProviderError({
      operation: "readMany",
      collection,
      cause: new Error("MongoDB getMore response omitted cursor.nextBatch"),
    })
  }
  if (!isValidCursorId(response.cursor.id)) {
    throw new DatabaseProviderError({
      operation: "readMany",
      collection,
      cause: new Error("MongoDB getMore response contained an invalid cursor id"),
    })
  }
  return {
    cursorId: response.cursor.id,
    records: decodeMongoBatch({
      documents: response.cursor.nextBatch,
      operation: "readMany",
      collection,
    }),
  }
}

async function createRecord({ command, databaseName, collection, record }) {
  validateCollectionName(collection)
  const snapshot = JSON.parse(serializeRecord(record))
  const mongoCollection = encodeCollectionName({ collection, databaseName })
  await runMongoCommand({
    command,
    operation: "create",
    collection,
    body: {
      insert: mongoCollection,
      ordered: true,
      $db: databaseName,
    },
    sequences: [{
      identifier: "documents",
      documents: [createStoredDocument(snapshot)],
    }],
  })
  return snapshot
}

async function readOneRecord({ command, databaseName, collection, id }) {
  validateCollectionName(collection)
  validateRecordIdentifier(id)
  const mongoCollection = encodeCollectionName({ collection, databaseName })
  const response = await runMongoCommand({
    command,
    operation: "readOne",
    collection,
    body: {
      find: mongoCollection,
      filter: { _id: id },
      collation: { locale: "simple" },
      projection: { _id: 1, data: 1 },
      limit: 1,
      singleBatch: true,
      $db: databaseName,
    },
  })
  const cursor = requireMongoCursor({
    response,
    operation: "readOne",
    collection,
    serverOperation: "find",
  })
  let firstBatch
  try {
    firstBatch = requireFirstBatch({
      cursor,
      operation: "readOne",
      collection,
      serverOperation: "find",
    })
  } catch (error) {
    await killMongoCursor({
      command,
      databaseName,
      collection,
      mongoCollection,
      cursorId: cursor.id,
      operation: "readOne",
    })
    throw error
  }
  await killMongoCursor({
    command,
    databaseName,
    collection,
    mongoCollection,
    cursorId: cursor.id,
    operation: "readOne",
  })
  const document = firstBatch[0]
  return document ? decodeStoredRecord({ document, operation: "readOne", collection }) : null
}

function createReadPipeline({ query }) {
  const normalizedQuery = normalizeReadQuery(query)
  const pipeline = [
    { $match: createFilter(normalizedQuery.filter) },
    ...createSortStages(normalizedQuery.sort),
  ]
  if (normalizedQuery.offset > 0) {
    pipeline.push({ $skip: normalizedQuery.offset })
  }
  if (normalizedQuery.limit !== undefined) {
    pipeline.push({ $limit: normalizedQuery.limit })
  }
  pipeline.push({ $project: { _id: 1, data: 1 } })
  return pipeline
}

async function readMongoCursorRecords({
  command,
  databaseName,
  collection,
  mongoCollection,
  cursor,
}) {
  let firstBatch
  try {
    firstBatch = requireFirstBatch({
      cursor,
      operation: "readMany",
      collection,
      serverOperation: "aggregate",
    })
  } catch (error) {
    await killMongoCursor({
      command,
      databaseName,
      collection,
      mongoCollection,
      cursorId: cursor.id,
      operation: "readMany",
    })
    throw error
  }
  let cursorId = cursor.id
  const records = decodeMongoBatch({
    documents: firstBatch,
    operation: "readMany",
    collection,
  })
  try {
    while (!isCursorExhausted(cursorId)) {
      const next = await readNextMongoBatch({
        command,
        databaseName,
        collection,
        mongoCollection,
        cursorId,
      })
      cursorId = next.cursorId
      records.push(...next.records)
    }
    return records
  } catch (error) {
    await killMongoCursor({
      command,
      databaseName,
      collection,
      mongoCollection,
      cursorId,
      operation: "readMany",
    })
    throw error
  }
}

async function readManyRecords({ command, databaseName, collection, query }) {
  validateCollectionName(collection)
  const mongoCollection = encodeCollectionName({ collection, databaseName })
  const response = await runMongoCommand({
    command,
    operation: "readMany",
    collection,
    body: {
      aggregate: mongoCollection,
      pipeline: createReadPipeline({ query }),
      cursor: { batchSize: CURSOR_BATCH_SIZE },
      collation: { locale: "simple" },
      $db: databaseName,
    },
  })
  const cursor = requireMongoCursor({
    response,
    operation: "readMany",
    collection,
    serverOperation: "aggregate",
  })
  return readMongoCursorRecords({
    command,
    databaseName,
    collection,
    mongoCollection,
    cursor,
  })
}

async function updateRecord({ command, databaseName, collection, id, changes }) {
  validateCollectionName(collection)
  validateRecordIdentifier(id)
  const snapshot = JSON.parse(serializeChanges(changes))
  if (Object.keys(snapshot).length === 0) {
    return readOneRecord({ command, databaseName, collection, id })
  }
  const mongoCollection = encodeCollectionName({ collection, databaseName })
  const set = {}
  for (const [field, value] of Object.entries(snapshot)) {
    const encodedKey = encodeUserKey(field)
    set[`data.${encodedKey}`] = encodeUserValue(value)
  }
  const response = await runMongoCommand({
    command,
    operation: "update",
    collection,
    body: {
      findAndModify: mongoCollection,
      query: { _id: id },
      update: { $set: set },
      collation: { locale: "simple" },
      new: true,
      upsert: false,
      fields: { _id: 1, data: 1 },
      $db: databaseName,
    },
  })
  return response.value ? decodeStoredRecord({
    document: response.value,
    operation: "update",
    collection,
  }) : null
}

async function deleteRecord({ command, databaseName, collection, id }) {
  validateCollectionName(collection)
  validateRecordIdentifier(id)
  const mongoCollection = encodeCollectionName({ collection, databaseName })
  const response = await runMongoCommand({
    command,
    operation: "delete",
    collection,
    body: {
      delete: mongoCollection,
      deletes: [{ q: { _id: id }, limit: 1 }],
      collation: { locale: "simple" },
      ordered: true,
      $db: databaseName,
    },
  })
  return response.n > 0
}

function createMongoRecordOperations({ command, databaseName }) {
  if (typeof command !== "function") {
    throw new TypeError("MongoDB record operations require a command function")
  }
  if (typeof databaseName !== "string" || databaseName.trim() === "") {
    throw new TypeError("MongoDB database name must be a non-empty string")
  }
  return Object.freeze({
    create: (input) => createRecord({ command, databaseName, ...input }),
    readOne: (input) => readOneRecord({ command, databaseName, ...input }),
    readMany: (input) => readManyRecords({ command, databaseName, ...input }),
    update: (input) => updateRecord({ command, databaseName, ...input }),
    delete: (input) => deleteRecord({ command, databaseName, ...input }),
  })
}

export { MongoCommandError, createMongoRecordOperations }
