import assert from "node:assert/strict"
import test from "node:test"

import {
  DatabaseConflictError,
  DatabaseOperationOutcomeUnknownError,
  DatabaseProviderError,
  DatabaseTransactionOutcomeUnknownError,
  DatabaseTransactionUnsupportedError,
} from "./database-errors.js"

test("database errors preserve stable codes, contexts, and causes", () => {
  const cause = new Error("underlying failure")
  const conflict = new DatabaseConflictError({ collection: "people",
cause })
  assert.equal(conflict.code, "DB_RECORD_CONFLICT")
  assert.deepEqual(conflict.context, { collection: "people",
operation: "create" })
  assert.equal(conflict.cause, cause)

  const providerWithoutCollection = new DatabaseProviderError({
    operation: "connect",
    cause,
  })
  assert.equal(providerWithoutCollection.code, "DB_PROVIDER_OPERATION_FAILED")
  assert.deepEqual(providerWithoutCollection.context, { operation: "connect" })
  assert.equal(providerWithoutCollection.cause, cause)

  const providerWithCollection = new DatabaseProviderError({
    operation: "readOne",
    collection: "people",
  })
  assert.deepEqual(providerWithCollection.context, {
    operation: "readOne",
    collection: "people",
  })

  const multiDocument = new DatabaseTransactionUnsupportedError({ cause })
  assert.equal(multiDocument.code, "DB_TRANSACTION_UNSUPPORTED")
  assert.deepEqual(multiDocument.context, {
    operation: "transaction",
    capability: "multiDocument",
  })
  assert.equal(multiDocument.cause, cause)

  const nested = new DatabaseTransactionUnsupportedError({
    capability: "nestedTransactions",
  })
  assert.match(nested.message, /Nested transactions/)
  assert.equal(nested.context.capability, "nestedTransactions")

  const transactionOutcome = new DatabaseTransactionOutcomeUnknownError({ cause })
  assert.equal(transactionOutcome.code, "DB_TRANSACTION_OUTCOME_UNKNOWN")
  assert.deepEqual(transactionOutcome.context, {
    operation: "commit",
    outcome: "unknown",
  })
  assert.equal(transactionOutcome.cause, cause)

  const operationOutcome = new DatabaseOperationOutcomeUnknownError({
    operation: "create",
    collection: "people",
    cause,
  })
  assert.equal(operationOutcome.code, "DB_OPERATION_OUTCOME_UNKNOWN")
  assert.deepEqual(operationOutcome.context, {
    operation: "create",
    collection: "people",
  })
  assert.equal(operationOutcome.cause, cause)
})
