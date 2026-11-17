import { DatabaseConflictError } from "@coinzilla/db"
import {
  TradingSessionIntegrityError,
  TradingSessionNotFoundError,
  createTradingSessionTransition,
  hasSameTradingSessionIdentity,
} from "../../domain/trading-session/trading-session.js"

const COLLECTION = "harvester_trading_sessions"

function requireDatabase({ database } = {}) {
  const methods = ["create", "readOne", "transaction"]
  const missing = methods.filter((method) => typeof database?.[method] !== "function")
  if (missing.length > 0) {
    throw new TypeError(`Provider-neutral database is missing methods: ${missing.join(", ")}`)
  }
  const callbackMode = database.capabilities?.transactions?.callbackMode
  if (!["synchronous", "asynchronous"].includes(callbackMode)) {
    throw new TypeError("Provider-neutral database must declare its transaction callback mode")
  }
  return callbackMode
}

function createIdentityConflict({ cause } = {}) {
  return new TradingSessionIntegrityError({
    message: "Trading-session identity was reused with conflicting immutable business facts",
    cause,
  })
}

async function createSession({ database, record } = {}) {
  try {
    return await database.create({
      collection: COLLECTION,
      record,
    })
  } catch (error) {
    if (!(error instanceof DatabaseConflictError)) {
      throw error
    }
    const existing = await database.readOne({
      collection: COLLECTION,
      id: record.id,
    })
    if (existing === null) {
      throw error
    }
    if (!hasSameTradingSessionIdentity({ existing, candidate: record })) {
      throw createIdentityConflict({ cause: error })
    }
    return existing
  }
}

function requireCurrentSession({ current, id }) {
  if (current === null) {
    throw new TradingSessionNotFoundError({ id })
  }
  return current
}

function updateSession({ transaction, current, id, status, endedAt }) {
  const transition = createTradingSessionTransition({
    current,
    status,
    endedAt,
  })
  if (transition.duplicate) {
    return current
  }
  const updated = transaction.update({
    collection: COLLECTION,
    id,
    changes: {
      status: transition.status,
      endedAt: transition.endedAt,
    },
  })
  if (updated === null) {
    throw new TradingSessionNotFoundError({ id })
  }
  return updated
}

function transitionSynchronously({ database, input } = {}) {
  return database.transaction((transaction) => {
    const current = requireCurrentSession({
      current: transaction.readOne({
        collection: COLLECTION,
        id: input.id,
      }),
      id: input.id,
    })
    return updateSession({
      transaction,
      current,
      id: input.id,
      status: input.status,
      endedAt: input.endedAt,
    })
  })
}

function transitionAsynchronously({ database, input } = {}) {
  return database.transaction(async (transaction) => {
    const current = requireCurrentSession({
      current: await transaction.readOne({
        collection: COLLECTION,
        id: input.id,
      }),
      id: input.id,
    })
    const transition = createTradingSessionTransition({
      current,
      status: input.status,
      endedAt: input.endedAt,
    })
    if (transition.duplicate) {
      return current
    }
    const updated = await transaction.update({
      collection: COLLECTION,
      id: input.id,
      changes: {
        status: transition.status,
        endedAt: transition.endedAt,
      },
    })
    if (updated === null) {
      throw new TradingSessionNotFoundError({ id: input.id })
    }
    return updated
  })
}

function createTransition({ database, callbackMode }) {
  if (callbackMode === "synchronous") {
    return (input) => transitionSynchronously({ database, input })
  }
  return (input) => transitionAsynchronously({ database, input })
}

export function createTradingSessionRepository({ database } = {}) {
  const callbackMode = requireDatabase({ database })
  const transition = createTransition({ database, callbackMode })
  return Object.freeze({
    create: (record) => createSession({ database, record }),
    findById: (id) => database.readOne({
      collection: COLLECTION,
      id,
    }),
    transition,
  })
}
