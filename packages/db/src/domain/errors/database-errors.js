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
