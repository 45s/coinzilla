import { SystemCustomError } from "@coinzilla/utils"

export class DatabaseConflictError extends SystemCustomError {
  constructor({ collection, cause } = {}) {
    super("A record with this identifier already exists", {
      code: "DB_RECORD_CONFLICT",
      context: {
        collection,
        operation: "create",
      },
      cause,
    })
  }
}

export class DatabaseProviderError extends SystemCustomError {
  constructor({ operation, collection, cause } = {}) {
    const context = {
      operation,
    }
    if (collection !== undefined) {
      context.collection = collection
    }

    super(`Database provider failed during ${operation}`, {
      code: "DB_PROVIDER_OPERATION_FAILED",
      context,
      cause,
    })
  }
}

export class DatabaseTransactionUnsupportedError extends SystemCustomError {
  constructor({ topology, cause } = {}) {
    const context = {
      operation: "transaction",
    }
    if (topology !== undefined) {
      context.topology = topology
    }

    super("Database provider does not support multi-document transactions", {
      code: "DB_TRANSACTION_UNSUPPORTED",
      context,
      cause,
    })
  }
}

export class DatabaseTransactionOutcomeUnknownError extends SystemCustomError {
  constructor({ cause } = {}) {
    super("Database transaction outcome is unknown", {
      code: "DB_TRANSACTION_OUTCOME_UNKNOWN",
      context: {
        operation: "commit",
        outcome: "unknown",
      },
      cause,
    })
  }
}
