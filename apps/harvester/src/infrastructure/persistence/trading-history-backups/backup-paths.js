import {
  chmod,
  lstat,
  mkdir,
} from "node:fs/promises"
import {
  dirname,
  join,
} from "node:path"
import { createBackupError } from "./errors.js"
import { resolveHarvesterDatabaseFilename } from "../resolve-harvester-database-filename.js"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function resolveBackupDirectory({ tradingMode, env = process.env } = {}) {
  if (tradingMode !== "testnet" && tradingMode !== "live") {
    throw createBackupError({
      stage: "environment-validation",
      code: "HARVESTER_HISTORY_BACKUP_INVALID_ENVIRONMENT",
      environment: tradingMode,
    })
  }
  const databaseFilename = resolveHarvesterDatabaseFilename({
    tradingMode,
    env,
  })
  const databaseRoot = dirname(dirname(databaseFilename))
  const environmentDirectory = tradingMode === "live" ? "production" : "testnet"
  return join(databaseRoot, "backups", environmentDirectory)
}

export function createBackupFilename({
  backupDirectory,
  environment,
  createdAt,
  backupId,
} = {}) {
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
    throw createBackupError({
      stage: "backup-name-validation",
      code: "HARVESTER_HISTORY_BACKUP_INVALID_INPUT",
      environment,
    })
  }
  if (typeof backupId !== "string" || !UUID_PATTERN.test(backupId)) {
    throw createBackupError({
      stage: "backup-name-validation",
      code: "HARVESTER_HISTORY_BACKUP_INVALID_INPUT",
      environment,
    })
  }
  const environmentDirectory = environment === "live" ? "production" : "testnet"
  const timestamp = createdAt.toISOString().replace(/[-:.]/g, "")
  return join(
    backupDirectory,
    `harvester-${environmentDirectory}-${timestamp}-${backupId}.sqlite`,
  )
}

export async function assertSourceFile({ filename, environment } = {}) {
  let stats
  try {
    stats = await lstat(filename)
  } catch (cause) {
    throw createBackupError({
      stage: "source-file-validation",
      code: "HARVESTER_HISTORY_BACKUP_SOURCE_UNAVAILABLE",
      cause,
      environment,
    })
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw createBackupError({
      stage: "source-file-validation",
      code: "HARVESTER_HISTORY_BACKUP_SOURCE_INVALID",
      environment,
    })
  }
}

export async function ensurePrivateDirectory({ directory, environment } = {}) {
  try {
    await mkdir(directory, {
      mode: 0o700,
    })
  } catch (cause) {
    if (cause.code !== "EEXIST") {
      throw createBackupError({
        stage: "backup-directory-creation",
        cause,
        environment,
      })
    }
  }
  await assertBackupDirectory({
    directory,
    environment,
  })
  if (process.platform !== "win32") {
    await chmod(directory, 0o700)
  }
}

export async function restrictFilePermissions({ filename } = {}) {
  if (process.platform !== "win32") {
    await chmod(filename, 0o600)
  }
}

export async function assertBackupDirectory({
  directory,
  environment,
  backupFilename,
} = {}) {
  let stats
  try {
    stats = await lstat(directory)
  } catch (cause) {
    throw createBackupError({
      stage: "backup-directory-validation",
      code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      cause,
      environment,
      backupFilename,
    })
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw createBackupError({
      stage: "backup-directory-validation",
      code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      environment,
      backupFilename,
    })
  }
}

export async function assertRegularBackupFile({
  filename,
  stage,
  code,
  environment,
} = {}) {
  let stats
  try {
    stats = await lstat(filename)
  } catch (cause) {
    throw createBackupError({
      stage,
      code,
      cause,
      environment,
      backupFilename: filename,
    })
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw createBackupError({
      stage,
      code,
      environment,
      backupFilename: filename,
    })
  }
}
