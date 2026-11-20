import assert from "node:assert/strict"
import test from "node:test"
import { createBackupError, isBackupError } from "./errors.js"

test("preserves the stable code, cause, and bounded diagnostic context", () => {
  const cause = new Error("source operation failed")
  const error = createBackupError({
    stage: "backup",
    code: "HARVESTER_HISTORY_BACKUP_FAILED",
    cause,
    environment: "testnet",
    backupFilename: "/private/data/backups/testnet/history.sqlite",
  })
  assert.equal(error.code, "HARVESTER_HISTORY_BACKUP_FAILED")
  assert.equal(error.cause, cause)
  assert.equal(isBackupError(error), true)
  assert.equal(isBackupError(new Error("unrelated error")), false)
  assert.deepEqual(error.context, {
    stage: "backup",
    environment: "testnet",
    backupFilename: "history.sqlite",
  })
})
