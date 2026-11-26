import { DatabaseConflictError, DatabaseProviderError } from "../../domain/errors/database-errors.js"
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
const SCALAR_SORT_RANK = [
  { case: { $in: ["$$fieldType", ["missing", "null"]] }, then: 0 },
  {
    case: { $eq: ["$$fieldType", "bool"] },
    then: { $cond: [{ $eq: ["$$fieldValue", false] }, 1, 2] },
  },
  { case: { $in: ["$$fieldType", ["int", "long", "double", "decimal"]] }, then: 3 },
  { case: { $eq: ["$$fieldType", "string"] }, then: 4 },
]

class MongoCommandError extends Error {
  constructor(response) {
    super(response.errmsg ?? "MongoDB command failed")
    this.name = "MongoCommandError"
    this.code = response.code
    this.codeName = response.codeName
    this.errorLabels = response.errorLabels ?? []
    this.response = response
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
    return key
  }
  const encoded = key.slice(USER_KEY_PREFIX.length)
  try {
    return Buffer.from(encoded, "base64url").toString("utf8")
  } catch {
    return key
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
    || error instanceof DatabaseProviderError) {
    return error
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
      throw new MongoCommandError({
        ...response.writeConcernError,
        errorLabels: response.errorLabels,
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

function encodeCollectionName(collection, databaseName) {
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
  if (!document || typeof document !== "object" || !document.data || typeof document.data !== "object") {
    throw new TypeError("MongoDB returned a malformed stored record")
  }
  return decodeUserValue(document.data)
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
    additions[typeKey] = {
      $let: {
        vars: {
          fieldType: { $type: fieldPath },
          fieldValue: fieldPath,
        },
        in: {
          $switch: {
            branches: SCALAR_SORT_RANK,
            default: 5,
          },
        },
      },
    }
    additions[valueKey] = fieldPath
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

function isCursorExhausted(cursorId) {
  return cursorId === undefined || cursorId === null || cursorId === 0 || cursorId === 0n
}

function createMongoRecordOperations({ command, databaseName }) {
  if (typeof command !== "function") {
    throw new TypeError("MongoDB record operations require a command function")
  }
  if (typeof databaseName !== "string" || databaseName.trim() === "") {
    throw new TypeError("MongoDB database name must be a non-empty string")
  }

  async function create({ collection, record }) {
    validateCollectionName(collection)
    const snapshot = JSON.parse(serializeRecord(record))
    const mongoCollection = encodeCollectionName(collection, databaseName)
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

  async function readOne({ collection, id }) {
    validateCollectionName(collection)
    validateRecordIdentifier(id)
    const mongoCollection = encodeCollectionName(collection, databaseName)
    const response = await runMongoCommand({
      command,
      operation: "readOne",
      collection,
      body: {
        find: mongoCollection,
        filter: { _id: id },
        collation: { locale: "simple" },
        projection: { _id: 0, data: 1 },
        limit: 1,
        singleBatch: true,
        $db: databaseName,
      },
    })
    if (!Array.isArray(response.cursor?.firstBatch)) {
      throw new DatabaseProviderError({
        operation: "readOne",
        collection,
        cause: new Error("MongoDB find response omitted cursor.firstBatch"),
      })
    }
    const document = response.cursor.firstBatch[0]
    return document ? decodeStoredRecord({ document, operation: "readOne", collection }) : null
  }

  async function readMany({ collection, query }) {
    validateCollectionName(collection)
    const normalizedQuery = normalizeReadQuery(query)
    const mongoCollection = encodeCollectionName(collection, databaseName)
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
    pipeline.push({ $project: { _id: 0, data: 1 } })

    const response = await runMongoCommand({
      command,
      operation: "readMany",
      collection,
      body: {
        aggregate: mongoCollection,
        pipeline,
        cursor: { batchSize: CURSOR_BATCH_SIZE },
        collation: { locale: "simple" },
        $db: databaseName,
      },
    })
    const cursor = response.cursor
    if (!cursor || !Array.isArray(cursor.firstBatch)) {
      throw new DatabaseProviderError({
        operation: "readMany",
        collection,
        cause: new Error("MongoDB aggregate response omitted cursor.firstBatch"),
      })
    }
    let cursorId = cursor.id
    const records = []
    try {
      records.push(...cursor.firstBatch.map((document) => decodeStoredRecord({
        document,
        operation: "readMany",
        collection,
      })))
      while (!isCursorExhausted(cursorId)) {
        const next = await runMongoCommand({
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
        if (!Array.isArray(next.cursor?.nextBatch)) {
          throw new DatabaseProviderError({
            operation: "readMany",
            collection,
            cause: new Error("MongoDB getMore response omitted cursor.nextBatch"),
          })
        }
        cursorId = next.cursor.id
        records.push(...next.cursor.nextBatch.map((document) => decodeStoredRecord({
          document,
          operation: "readMany",
          collection,
        })))
      }
      return records
    } catch (error) {
      if (!isCursorExhausted(cursorId)) {
        try {
          await runMongoCommand({
            command,
            operation: "readMany",
            collection,
            body: {
              killCursors: mongoCollection,
              cursors: [cursorId],
              $db: databaseName,
            },
          })
        } catch {
          // Preserve the original read failure; connection cleanup owns any remaining cursor.
        }
      }
      throw error
    }
  }

  async function update({ collection, id, changes }) {
    validateCollectionName(collection)
    validateRecordIdentifier(id)
    const snapshot = JSON.parse(serializeChanges(changes))
    if (Object.keys(snapshot).length === 0) {
      return readOne({ collection, id })
    }
    const mongoCollection = encodeCollectionName(collection, databaseName)
    const set = {}
    for (const [field, value] of Object.entries(snapshot)) {
      set[`data.${encodeUserKey(field)}`] = encodeUserValue(value)
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
        fields: { _id: 0, data: 1 },
        $db: databaseName,
      },
    })
    return response.value ? decodeStoredRecord({
      document: response.value,
      operation: "update",
      collection,
    }) : null
  }

  async function deleteRecord({ collection, id }) {
    validateCollectionName(collection)
    validateRecordIdentifier(id)
    const mongoCollection = encodeCollectionName(collection, databaseName)
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

  return Object.freeze({
    create,
    readOne,
    readMany,
    update,
    delete: deleteRecord,
  })
}

export { MongoCommandError, createMongoRecordOperations }
