import { basename } from "node:path"
import { OrderHistoryPersistenceError } from "../order-history-persistence-error.js"

export function createBackupError({
  stage,
  code,
  cause,
  environment,
  backupFilename,
} = {}) {
  return new OrderHistoryPersistenceError({
    stage,
    code,
    cause,
    context: {
      environment,
      ...(backupFilename ? { backupFilename: basename(backupFilename) } : {}),
    },
  })
}

export function isBackupError(error) {
  return typeof error?.code === "string" &&
    error.code.startsWith("HARVESTER_HISTORY_BACKUP_")
}
