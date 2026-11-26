import { AsyncLocalStorage } from "node:async_hooks"
import { randomBytes as nativeRandomBytes } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

import {
  DatabaseConflictError,
  DatabaseProviderError,
  DatabaseTransactionOutcomeUnknownError,
  DatabaseTransactionUnsupportedError,
} from "../../domain/errors/database-errors.js"
import { BsonBinary } from "./bson.js"
import { createMongoRecordOperations } from "./commands.js"
import {
  parseMongoConnectionString,
  performMongoHandshake,
} from "./handshake.js"
import { createMongoTransport } from "./transport.js"

const CRUD_OPERATIONS = Object.freeze(["create", "readOne", "readMany", "update", "delete"])
const MONGO_CAPABILITIES = Object.freeze({
  transactions: Object.freeze({
    callbackMode: "asynchronous",
    nestedTransactions: false,
    multiDocument: "topology-dependent",
  }),
  queries: Object.freeze({
    equalityFilters: true,
    sorting: true,
    pagination: true,
  }),
  storage: Object.freeze({
    modes: Object.freeze(["server"]),
  }),
})
const MAX_PRIMARY_REDIRECTS = 3
const MAX_COMMIT_ATTEMPTS = 3
const MAX_ABORT_ATTEMPTS = 2

function parsePrimaryAddress(address) {
  if (typeof address !== "string" || address.trim() === "") {
    throw new TypeError("MongoDB primary address must be a non-empty string")
  }
  if (address.startsWith("[")) {
    const end = address.indexOf("]")
    if (end < 0) {
      throw new TypeError("MongoDB primary IPv6 address is invalid")
    }
    const host = address.slice(1, end)
    const portText = address.slice(end + 1).replace(/^:/, "")
    const port = portText === "" ? 27017 : Number(portText)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new TypeError("MongoDB primary port is invalid")
    }
    return { host,
port }
  }
  const separator = address.lastIndexOf(":")
  if (separator < 1) {
    return { host: address,
port: 27017 }
  }
  const host = address.slice(0, separator)
  const port = Number(address.slice(separator + 1))
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("MongoDB primary port is invalid")
  }
  return { host,
port }
}

function firstDefined({ primary, secondary, fallback }) {
  if (primary !== undefined) {
    return primary
  }
  if (secondary !== undefined) {
    return secondary
  }
  return fallback
}

function resolveConnectionOptions({ options }) {
  const connectionString = options.uri ?? options.connectionString
  return connectionString ? parseMongoConnectionString(connectionString) : {}
}

function resolveTlsOptions({ options, parsed }) {
  const value = firstDefined({ primary: options.tls,
secondary: parsed.tls })
  if (value === true) {
    return {}
  }
  return value || null
}

function resolveOptions(options) {
  const parsed = resolveConnectionOptions({ options })
  return {
    host: firstDefined({ primary: options.host,
secondary: parsed.host }),
    port: firstDefined({ primary: options.port,
secondary: parsed.port,
fallback: 27017 }),
    username: firstDefined({ primary: options.username,
secondary: parsed.username }),
    password: firstDefined({ primary: options.password,
secondary: parsed.password }),
    databaseName: firstDefined({ primary: options.databaseName,
secondary: parsed.databaseName,
fallback: "admin" }),
    authSource: firstDefined({
      primary: options.authSource,
      secondary: parsed.authSource,
      fallback: options.databaseName ?? "admin",
    }),
    authMechanism: firstDefined({ primary: options.authMechanism,
secondary: parsed.authMechanism }),
    replicaSet: firstDefined({ primary: options.replicaSet,
secondary: parsed.replicaSet }),
    directConnection: firstDefined({ primary: options.directConnection,
secondary: parsed.directConnection,
fallback: false }),
    tlsOptions: resolveTlsOptions({ options,
parsed }),
    connectTimeoutMS: firstDefined({ primary: options.connectTimeoutMS,
secondary: parsed.connectTimeoutMS,
fallback: 10_000 }),
    socketTimeoutMS: firstDefined({ primary: options.socketTimeoutMS,
secondary: parsed.socketTimeoutMS,
fallback: 30_000 }),
  }
}

function assertDatabaseName({ value, label, maximumBytes = 63 }) {
  if (typeof value !== "string" || value.trim() === "" || !value.isWellFormed()) {
    throw new TypeError(`MongoDB provider ${label} must be a non-empty string`)
  }
  if (/[\\/\\\\."$*<>:|?]/u.test(value) || value.includes("\0")) {
    throw new TypeError(`MongoDB provider ${label} contains an unsupported character`)
  }
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new TypeError(`MongoDB provider ${label} must not exceed the portable ${maximumBytes}-byte limit`)
  }
}

function assertHostAndPort({ options }) {
  if (typeof options.host !== "string" || options.host.trim() === "") {
    throw new TypeError("MongoDB provider requires a host or mongodb:// URI")
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new TypeError("MongoDB provider port must be between 1 and 65535")
  }
}

function assertCredentials({ options }) {
  if (options.username !== undefined && (typeof options.username !== "string"
    || options.username.length === 0
    || !/^[\\x20-\\x7e]+$/.test(options.username))) {
    throw new TypeError("MongoDB provider username must be a non-empty string")
  }
  if (options.username !== undefined && typeof options.password !== "string") {
    throw new TypeError("MongoDB provider password must be a string when username is configured")
  }
  if (options.username === undefined && options.password !== undefined) {
    throw new TypeError("MongoDB provider password requires a username")
  }
  if (options.username === undefined && options.authMechanism !== undefined) {
    throw new TypeError("MongoDB provider authMechanism requires a username")
  }
}

function assertConnectionPolicy({ options }) {
  if (typeof options.directConnection !== "boolean") {
    throw new TypeError("MongoDB provider directConnection must be a boolean")
  }
  if (options.replicaSet !== undefined && (typeof options.replicaSet !== "string" || options.replicaSet.trim() === "")) {
    throw new TypeError("MongoDB provider replicaSet must be a non-empty string")
  }
  if (options.authMechanism !== undefined && !["SCRAM-SHA-256", "SCRAM-SHA-1"].includes(options.authMechanism)) {
    throw new TypeError("MongoDB provider authMechanism must be SCRAM-SHA-256 or SCRAM-SHA-1")
  }
  if (options.authSource !== undefined) {
    assertDatabaseName({ value: options.authSource,
label: "authSource" })
  }
}

function assertTimeouts({ options }) {
  for (const [name, value] of Object.entries({
    connectTimeoutMS: options.connectTimeoutMS,
    socketTimeoutMS: options.socketTimeoutMS,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`MongoDB provider ${name} must be a positive safe integer`)
    }
  }
}

function assertTlsOptions({ options }) {
  if (options.tlsOptions !== null && (typeof options.tlsOptions !== "object" || Array.isArray(options.tlsOptions))) {
    throw new TypeError("MongoDB provider TLS options must be an object or disabled")
  }
}

function assertProviderFunctions({ options }) {
  for (const [name, value] of Object.entries({
    transportFactory: options.transportFactory,
    handshake: options.handshake,
    randomBytes: options.randomBytes,
  })) {
    if (value !== undefined && typeof value !== "function") {
      throw new TypeError(`MongoDB provider ${name} must be a function`)
    }
  }
}

function assertProviderOptions(options) {
  assertHostAndPort({ options })
  assertDatabaseName({ value: options.databaseName,
label: "databaseName" })
  assertCredentials({ options })
  assertConnectionPolicy({ options })
  assertTimeouts({ options })
  assertTlsOptions({ options })
  assertProviderFunctions({ options })
}

function createTransactionCommand({ transport, session }) {
  let queue = Promise.resolve()
  let firstError = null

  async function sendSessionCommand({ body, sequences, timeoutMS, operation }) {
    const database = body.$db
    const commandBody = { ...body }
    delete commandBody.$db
    const sessionBody = {
      ...commandBody,
      lsid: session.lsid,
      txnNumber: session.txnNumber,
      autocommit: false,
    }
    if (!session.started) {
      sessionBody.startTransaction = true
      sessionBody.readConcern = { level: "snapshot" }
      session.started = true
    }
    sessionBody.$db = database
    const response = await transport.command({
      body: sessionBody,
      sequences,
      timeoutMS,
      operation,
      transaction: true,
    })
    if (session.topology === "sharded" && Number(response?.ok) === 1) {
      if (!isPlainDocument(response.recoveryToken)) {
        throw new DatabaseProviderError({
          operation: "transaction",
          cause: new TypeError("Sharded MongoDB transaction response omitted a valid recoveryToken"),
        })
      }
      session.recoveryToken = response.recoveryToken
    }
    if (!response || Number(response.ok) !== 1
      || (Array.isArray(response.writeErrors) && response.writeErrors.length > 0)
      || response.writeConcernError) {
      const failure = response?.writeErrors?.[0] ?? response?.writeConcernError ?? response
      throw createServerCommandError(failure ?? {})
    }
    return response
  }

  const runSessionCommand = ({ body, sequences, timeoutMS, operation: operationName }) => {
    const queuedOperation = queue.then(() => {
      if (firstError) {throw firstError}
      return sendSessionCommand({
        body,
        sequences,
        timeoutMS,
        operation: operationName,
      })
    })
    queuedOperation.catch(() => {})
    queue = queuedOperation.catch((error) => {
      firstError ??= error
    })
    return queuedOperation
  }

  runSessionCommand.drain = async () => {
    await queue
    if (firstError) {throw firstError}
  }
  runSessionCommand.failure = () => firstError
  return runSessionCommand
}

function isPlainDocument(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function createSession({ state, randomBytes }) {
  state.nextTransactionNumber += 1n
  return {
    lsid: {
      id: new BsonBinary(randomBytes(16), 4),
    },
    txnNumber: state.nextTransactionNumber,
    topology: state.handshake?.topology,
    recoveryToken: undefined,
    started: false,
  }
}

function hasErrorLabel({ response, label }) {
  return Array.isArray(response?.errorLabels) && response.errorLabels.includes(label)
}

function hasAmbiguousWriteConcern(response) {
  const error = response?.writeConcernError ?? response
  return error?.code === 64
    || error?.codeName === "WriteConcernTimeout"
    || error?.errInfo?.wtimeout === true
}

function isRetryableTransactionError(error) {
  return error?.outcomeUnknown === true
    || hasErrorLabel({ response: error,
label: "RetryableWriteError" })
    || hasAmbiguousWriteConcern(error)
    || error?.code === 50
    || error?.codeName === "MaxTimeMSExpired"
}

function createServerCommandError(response) {
  const error = new Error(response?.errmsg ?? "MongoDB transaction command failed")
  error.code = response?.code
  error.errorLabels = response?.errorLabels ?? []
  return error
}

async function commitMongoTransaction({ transport, session }) {
  const body = {
    commitTransaction: 1,
    lsid: session.lsid,
    txnNumber: session.txnNumber,
    autocommit: false,
    writeConcern: { w: "majority",
wtimeout: 10000 },
    $db: "admin",
  }
  if (session.recoveryToken !== undefined) {
    body.recoveryToken = session.recoveryToken
  }
  let ambiguous = false
  let lastError
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt += 1) {
    try {
      if (session.recoveryToken !== undefined) {
        body.recoveryToken = session.recoveryToken
      } else {
        delete body.recoveryToken
      }
      const response = await transport.command({
        body,
        operation: "commit",
      })
      if (session.topology === "sharded"
        && Number(response?.ok) === 1
        && isPlainDocument(response.recoveryToken)) {
        session.recoveryToken = response.recoveryToken
      }
      if (Number(response?.ok) === 1 && !response.writeConcernError) {
        return
      }
      const serverFailure = response?.writeConcernError
        ? { ...response.writeConcernError,
errorLabels: response.errorLabels }
        : response
      const error = createServerCommandError(serverFailure)
      if (hasAmbiguousWriteConcern(response)
        || hasErrorLabel({ response,
label: "UnknownTransactionCommitResult" })
        || hasErrorLabel({ response,
label: "RetryableWriteError" })
        || response?.code === 50
        || response?.codeName === "MaxTimeMSExpired"
        || ambiguous) {
        ambiguous = true
        lastError = error
      } else {
        throw new DatabaseProviderError({
          operation: "transaction",
          cause: error,
        })
      }
    } catch (error) {
      if (error instanceof DatabaseProviderError) {
        throw error
      }
      if (!ambiguous && error?.outcomeUnknown === false) {
        throw new DatabaseProviderError({
          operation: "transaction",
          cause: error,
        })
      }
      // Once a commit request may have reached the server, a later error such
      // as NoSuchTransaction cannot prove whether the earlier commit succeeded.
      ambiguous = true
      lastError = error
    }
    if (attempt + 1 < MAX_COMMIT_ATTEMPTS) {
      await delay(20 * (attempt + 1))
    }
  }
  throw new DatabaseTransactionOutcomeUnknownError({
    cause: lastError,
  })
}

async function abortMongoTransaction({ transport, session }) {
  const body = {
    abortTransaction: 1,
    lsid: session.lsid,
    txnNumber: session.txnNumber,
    autocommit: false,
    $db: "admin",
  }
  if (session.recoveryToken !== undefined) {
    body.recoveryToken = session.recoveryToken
  }
  for (let attempt = 0; attempt < MAX_ABORT_ATTEMPTS; attempt += 1) {
    try {
      if (session.recoveryToken !== undefined) {
        body.recoveryToken = session.recoveryToken
      } else {
        delete body.recoveryToken
      }
      const response = await transport.command({
        body,
        operation: "abort",
      })
      if (session.topology === "sharded"
        && Number(response?.ok) === 1
        && isPlainDocument(response.recoveryToken)) {
        session.recoveryToken = response.recoveryToken
      }
      if (Number(response?.ok) === 1 && !response.writeConcernError) {
        return
      }
      if (attempt + 1 >= MAX_ABORT_ATTEMPTS || !isRetryableTransactionError(response)) {
        return
      }
    } catch (error) {
      if (attempt + 1 >= MAX_ABORT_ATTEMPTS || !isRetryableTransactionError(error)) {
        return
      }
    }
  }
}

function createTransactionRunner({ state, randomBytes }) {
  const transactionScope = new AsyncLocalStorage()

  return async function withTransaction(work) {
    if (typeof work !== "function") {
      throw new TypeError("A MongoDB transaction callback is required")
    }
    if (transactionScope.getStore()) {
      throw new DatabaseTransactionUnsupportedError({ capability: "nestedTransactions" })
    }
    if (state.lifecycle !== "connected") {
      throw new Error("MongoDB provider must be connected before starting a transaction")
    }
    if (!state.handshake?.transactionSupported) {
      throw new DatabaseTransactionUnsupportedError()
    }

    const session = createSession({ state,
randomBytes })
    const command = createTransactionCommand({
      transport: state.transport,
      session,
    })
    const operations = createMongoRecordOperations({
      command,
      databaseName: state.options.databaseName,
    })
    const pendingOperations = new Set()
    let firstOperationError = null
    const transactionOperations = Object.fromEntries(CRUD_OPERATIONS.map((operation) => [
      operation,
      (input) => {
        const pending = operations[operation](input)
        pendingOperations.add(pending)
        pending.then(
          () => pendingOperations.delete(pending),
          (error) => {
            pendingOperations.delete(pending)
            firstOperationError ??= error
          },
        )
        return pending
      },
    ]))
    transactionOperations.drain = async () => {
      while (pendingOperations.size > 0) {
        await Promise.allSettled([...pendingOperations])
      }
      if (firstOperationError) {throw firstOperationError}
      await command.drain()
    }
    let callbackResult
    const transaction = transactionScope.run(session, async () => {
      callbackResult = work(transactionOperations)
      return callbackResult
    })

    let result
    try {
      result = await transaction
      await transactionOperations.drain()
      if (session.started
        && !(callbackResult !== null
          && (typeof callbackResult === "object" || typeof callbackResult === "function")
          && typeof callbackResult.then === "function")) {
        throw new TypeError("MongoDB transaction callbacks must await asynchronous CRUD operations")
      }
    } catch (error) {
      let transactionError = error
      try {
        await transactionOperations.drain()
      } catch (drainError) {
        if (transactionError !== drainError && transactionError?.cause !== drainError) {
          transactionError = new AggregateError(
            [transactionError, drainError],
            "MongoDB transaction callback and pending command both failed",
            { cause: transactionError },
          )
        }
      }
      if (transactionError === command.failure()) {
        transactionError = transactionError?.code === 11000 || transactionError?.code === 11001
          ? new DatabaseConflictError({ cause: transactionError })
          : new DatabaseProviderError({ operation: "transaction", cause: transactionError })
      }
      if (session.started) {
        await abortMongoTransaction({
          transport: state.transport,
          session,
        })
      }
      throw transactionError
    }

    if (session.started) {
      try {
        await commitMongoTransaction({
          transport: state.transport,
          session,
        })
      } catch (error) {
        if (error instanceof DatabaseTransactionOutcomeUnknownError) {
          throw error
        }
        await abortMongoTransaction({
          transport: state.transport,
          session,
        })
        throw error
      }
    }
    return result
  }
}

function createProviderState(options) {
  return {
    options,
    lifecycle: "idle",
    transport: null,
    handshake: null,
    connectPromise: null,
    nextTransactionNumber: 0n,
    activeOperations: new Set(),
    closePromise: null,
  }
}

async function runTrackedOperation({ state, work }) {
  if (state.lifecycle !== "connected") {
    throw new Error("MongoDB provider must be connected before starting work")
  }
  let operation
  try {
    operation = Promise.resolve(work())
  } catch (error) {
    operation = Promise.reject(error)
  }
  state.activeOperations.add(operation)
  try {
    return await operation
  } finally {
    state.activeOperations.delete(operation)
  }
}

function createTransport({ options, transportFactory }) {
  return transportFactory({
    host: options.host,
    port: options.port,
    tls: options.tlsOptions,
    connectTimeoutMS: options.connectTimeoutMS,
    socketTimeoutMS: options.socketTimeoutMS,
  })
}

async function connectToPrimary({ state, transportFactory, handshake }) {
  let transport
  let current = {
    host: state.options.host,
    port: state.options.port,
  }
  for (let redirect = 0; redirect <= MAX_PRIMARY_REDIRECTS; redirect += 1) {
    transport = createTransport({
      options: {
        ...state.options,
        ...current,
      },
      transportFactory,
    })
    state.transport = transport
    await transport.connect()
    const result = await handshake({
      transport,
      databaseName: state.options.databaseName,
      username: state.options.username,
      password: state.options.password,
      authSource: state.options.authSource,
      authMechanism: state.options.authMechanism,
      replicaSet: state.options.replicaSet,
    })
    if (result.primary && result.topology === "replicaSet" && state.options.directConnection) {
      throw new Error("MongoDB directConnection target is not the writable replica-set primary")
    }
    if (!result.primary || result.topology !== "replicaSet") {
      state.handshake = result
      return
    }
    await transport.close()
    state.transport = null
    const next = parsePrimaryAddress(result.primary)
    if (next.host === current.host && next.port === current.port) {
      throw new Error("MongoDB replica-set primary discovery returned the current non-primary seed")
    }
    current = next
  }
  throw new Error("MongoDB replica-set primary discovery exceeded the redirect limit")
}

/**
 * Create a dependency-free MongoDB implementation of the provider-neutral API.
 *
 * Supports mongodb:// single-seed URIs, TCP/TLS, SCRAM-SHA-256/SCRAM-SHA-1,
 * standalone/replica-set/sharded topology detection, and provider-neutral CRUD.
 * Multi-document transactions are available only when the connected topology
 * supports logical sessions and transaction semantics.
 *
 * @param {{uri?: string, connectionString?: string, host?: string, port?: number, databaseName?: string, username?: string, password?: string, authSource?: string, authMechanism?: string, replicaSet?: string, directConnection?: boolean, tls?: boolean|object, connectTimeoutMS?: number, socketTimeoutMS?: number, transportFactory?: Function, handshake?: Function, randomBytes?: Function}} options
 * @returns {import("../../application/ports/database-provider.js").DatabaseProvider}
 */
export function createMongoProvider(options = {}) {
  const resolvedOptions = resolveOptions(options)
  assertProviderOptions(resolvedOptions)
  const transportFactory = options.transportFactory ?? createMongoTransport
  const handshake = options.handshake ?? performMongoHandshake
  const randomBytes = options.randomBytes ?? nativeRandomBytes
  if (typeof transportFactory !== "function" || typeof handshake !== "function" || typeof randomBytes !== "function") {
    throw new TypeError("MongoDB provider transport, handshake and random source must be functions")
  }

  const state = createProviderState(resolvedOptions)
  const runTransaction = createTransactionRunner({
    state,
    randomBytes,
  })

  async function connect() {
    if (state.lifecycle === "connected") {
      return
    }
    if (state.lifecycle === "connecting") {
      await state.connectPromise
      return
    }
    if (state.lifecycle === "closing" || state.lifecycle === "closed") {
      throw new Error(`Cannot connect MongoDB provider while ${state.lifecycle}`)
    }
    state.lifecycle = "connecting"
    state.connectPromise = (async () => {
      try {
        await connectToPrimary({
          state,
          transportFactory,
          handshake,
        })
        state.lifecycle = "connected"
      } catch (error) {
        let connectionError = error
        try {
          await state.transport?.close()
        } catch (closeError) {
          connectionError = new AggregateError(
            [connectionError, closeError],
            "MongoDB provider connection and cleanup failed",
            { cause: connectionError },
          )
        }
        state.transport = null
        state.handshake = null
        state.lifecycle = "idle"
        throw new DatabaseProviderError({
          operation: "connect",
          cause: connectionError,
        })
      }
    })()
    try {
      await state.connectPromise
    } finally {
      state.connectPromise = null
    }
  }

  async function close() {
    if (state.lifecycle === "closed") {
      return
    }
    if (state.lifecycle === "connecting") {
      try {
        await state.connectPromise
      } catch {
        state.lifecycle = "closed"
        return
      }
    }
    if (state.lifecycle === "idle") {
      state.lifecycle = "closed"
      return
    }
    if (state.lifecycle === "closing" && state.closePromise) {
      await state.closePromise
      return
    }
    state.lifecycle = "closing"
    state.closePromise = (async () => {
      await Promise.allSettled([...state.activeOperations])
      try {
        await state.transport?.close()
        state.transport = null
        state.handshake = null
        state.lifecycle = "closed"
      } catch (error) {
        state.closePromise = null
        throw new DatabaseProviderError({
          operation: "close",
          cause: error,
        })
      }
    })()
    await state.closePromise
  }

  async function withReadTransaction(work) {
    if (typeof work !== "function") {
      throw new TypeError("A MongoDB read transaction callback is required")
    }
    return runTrackedOperation({ state,
work: async () => {
      const operations = createMongoRecordOperations({
        command: (commandInput) => state.transport.command(commandInput),
        databaseName: state.options.databaseName,
      })
      let readOperationPromise = null
      function invokeRead({ method, input }) {
        if (readOperationPromise) {
          return Promise.resolve(readOperationPromise).then(() => {
            throw new Error("MongoDB read transaction supports one provider-neutral read operation")
          })
        }
        readOperationPromise = operations[method](input)
        return readOperationPromise
      }
      const readContext = Object.freeze({
        create() {
          throw new Error("MongoDB read transaction cannot execute mutations")
        },
        readOne(input) {
          return invokeRead({ method: "readOne",
input })
        },
        readMany(input) {
          return invokeRead({ method: "readMany",
input })
        },
        update() {
          throw new Error("MongoDB read transaction cannot execute mutations")
        },
        delete() {
          throw new Error("MongoDB read transaction cannot execute mutations")
        },
      })
      try {
        const result = await work(readContext)
        if (readOperationPromise) {
          await readOperationPromise
        }
        return result
      } catch (error) {
        await readOperationPromise?.catch(() => {})
        throw error
      }
    } })
  }

  async function execute({ operation, input }) {
    return runTrackedOperation({ state,
work: async () => {
      if (!CRUD_OPERATIONS.includes(operation)) {
        throw new TypeError(`Unsupported MongoDB CRUD operation: ${operation}`)
      }
      const operations = createMongoRecordOperations({
        command: (commandInput) => state.transport.command(commandInput),
        databaseName: state.options.databaseName,
      })
      return operations[operation](input)
    } })
  }

  return Object.freeze({
    connect,
    close,
    withTransaction: (work) => runTrackedOperation({ state,
work: () => runTransaction(work) }),
    withReadTransaction,
    execute,
    capabilities: MONGO_CAPABILITIES,
  })
}
