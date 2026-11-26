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
  constructor({ capability = "multiDocument", cause } = {}) {
    const nested = capability === "nestedTransactions"
    super(
      nested
        ? "Nested transactions are not supported by this database provider"
        : "Multi-document transactions are not supported by this database provider",
      {
        code: "DB_TRANSACTION_UNSUPPORTED",
        context: {
          operation: "transaction",
          capability: nested ? "nestedTransactions" : "multiDocument",
        },
        cause,
      },
    )
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

export class DatabaseOperationOutcomeUnknownError extends SystemCustomError {
  constructor({ operation, collection, cause } = {}) {
    super("Database operation outcome is unknown", {
      code: "DB_OPERATION_OUTCOME_UNKNOWN",
      context: {
        operation,
        collection,
      },
      cause,
    })
  }
}
