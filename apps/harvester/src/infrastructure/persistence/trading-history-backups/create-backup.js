import { randomUUID } from "node:crypto"
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises"
import {
  basename,
  dirname,
  join,
} from "node:path"
import { createSqliteDatabase } from "@coinzilla/db"
import { OrderHistoryPersistenceError } from "../order-history-persistence-error.js"
import {
  assertHarvesterDatabaseIsolation,
} from "../resolve-harvester-database-filename.js"
import {
  assertCurrentSchema,
  calculateSha256,
  resolveBackupDirectory,
  verifyBackup,
} from "./verify-backup.js"
import { rotateBackups } from "./rotate-backups.js"

const DEFAULT_RETENTION_COUNT = 30
const DEFAULT_BACKUP_RATE = 100
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function createBackupError({
  stage,
  code = "HARVESTER_HISTORY_BACKUP_FAILED",
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

function validateEnvironment({ env } = {}) {
  const environment = env.TRADING_MODE
  if (environment !== "testnet" && environment !== "live") {
    throw createBackupError({
      stage: "environment-validation",
      code: "HARVESTER_HISTORY_BACKUP_INVALID_ENVIRONMENT",
      environment,
    })
  }
  return environment
}

function validateRetentionCount({ keep, environment } = {}) {
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 3650) {
    throw createBackupError({
      stage: "retention-validation",
      code: "HARVESTER_HISTORY_BACKUP_INVALID_INPUT",
      cause: new TypeError("Backup retention count must be between 1 and 3650."),
      environment,
    })
  }
}

function createBackupFilename({
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

async function assertSourceFile({ filename, environment } = {}) {
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

async function ensurePrivateDirectory({ directory, environment } = {}) {
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
  const stats = await lstat(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw createBackupError({
      stage: "backup-directory-validation",
      code: "HARVESTER_HISTORY_BACKUP_SOURCE_INVALID",
      environment,
    })
  }
  if (process.platform !== "win32") {
    await chmod(directory, 0o700)
  }
}

async function restrictFilePermissions({ filename } = {}) {
  if (process.platform !== "win32") {
    await chmod(filename, 0o600)
  }
}

async function createOnlineBackup({
  sourceFilename,
  destinationFilename,
  backupRate,
  environment,
} = {}) {
  const database = createSqliteDatabase({
    filename: sourceFilename,
  })
  let connected = false
  let result
  let failure
  try {
    await database.connect()
    connected = true
    const schemaVersion = assertCurrentSchema(database)
    const pagesCopied = await database.backup({
      destination: destinationFilename,
      rate: backupRate,
    })
    result = {
      schemaVersion,
      pagesCopied,
    }
  } catch (cause) {
    failure = cause instanceof OrderHistoryPersistenceError
      ? cause
      : createBackupError({
        stage: "online-backup",
        cause,
        environment,
      })
  }
  if (connected) {
    try {
      await database.close()
    } catch (cause) {
      failure = failure
        ? new AggregateError([failure, cause], "Source database close failed.")
        : createBackupError({
          stage: "source-database-close",
          cause,
          environment,
        })
    }
  }
  if (failure) {
    throw failure
  }
  return result
}

async function publishBackupPair({
  temporaryBackupFilename,
  temporaryManifestFilename,
  backupFilename,
  manifestFilename,
  environment,
} = {}) {
  let backupPublished = false
  try {
    await link(temporaryBackupFilename, backupFilename)
    backupPublished = true
    await link(temporaryManifestFilename, manifestFilename)
  } catch (cause) {
    if (backupPublished) {
      try {
        await unlink(backupFilename)
      } catch (cleanupError) {
        throw createBackupError({
          stage: "backup-pair-publication",
          cause: new AggregateError([cause, cleanupError]),
          environment,
          backupFilename,
        })
      }
    }
    if (cause.code === "EEXIST") {
      throw createBackupError({
        stage: "backup-pair-publication",
        code: "HARVESTER_HISTORY_BACKUP_DESTINATION_CONFLICT",
        cause,
        environment,
        backupFilename,
      })
    }
    throw createBackupError({
      stage: "backup-pair-publication",
      cause,
      environment,
      backupFilename,
    })
  }
}

async function removeTemporaryDirectory({ directory, error } = {}) {
  try {
    await rm(directory, {
      recursive: true,
      force: true,
    })
    return error
  } catch (cause) {
    return error
      ? new AggregateError([error, cause], "Backup temporary directory cleanup failed.")
      : cause
  }
}

async function resolveBackupContext({
  env,
  now,
  createId,
  keep,
} = {}) {
  const environment = validateEnvironment({
    env,
  })
  validateRetentionCount({
    keep,
    environment,
  })
  const sourceFilename = await assertHarvesterDatabaseIsolation({
    tradingMode: environment,
    env,
  })
  await assertSourceFile({
    filename: sourceFilename,
    environment,
  })
  const backupDirectory = resolveBackupDirectory({
    tradingMode: environment,
    env,
  })
  await ensurePrivateDirectory({
    directory: dirname(backupDirectory),
    environment,
  })
  await ensurePrivateDirectory({
    directory: backupDirectory,
    environment,
  })
  const createdAt = now()
  const backupFilename = createBackupFilename({
    backupDirectory,
    environment,
    createdAt,
    backupId: createId(),
  })
  return {
    environment,
    sourceFilename,
    backupDirectory,
    createdAt,
    backupFilename,
    manifestFilename: `${backupFilename}.manifest.json`,
    temporaryDirectory: await mkdtemp(join(backupDirectory, ".backup-")),
  }
}

async function createTemporaryBackupArtifact({
  context,
  backupRate,
  env,
} = {}) {
  const temporaryBackupFilename = join(
    context.temporaryDirectory,
    basename(context.backupFilename),
  )
  const temporaryManifestFilename = `${temporaryBackupFilename}.manifest.json`
  let onlineBackup
  let sha256
  let failure
  try {
    onlineBackup = await createOnlineBackup({
      sourceFilename: context.sourceFilename,
      destinationFilename: temporaryBackupFilename,
      backupRate,
      environment: context.environment,
    })
    await restrictFilePermissions({
      filename: temporaryBackupFilename,
    })
    sha256 = await calculateSha256(temporaryBackupFilename)
    const manifest = {
      formatVersion: 1,
      environment: context.environment,
      createdAt: context.createdAt.toISOString(),
      filename: basename(context.backupFilename),
      schemaVersion: onlineBackup.schemaVersion,
      sha256,
    }
    await writeFile(
      temporaryManifestFilename,
      `${JSON.stringify(manifest, null, 2)}\n`,
      {
        flag: "wx",
        mode: 0o600,
      },
    )
    await restrictFilePermissions({
      filename: temporaryManifestFilename,
    })
    await verifyBackup({
      backupFilename: temporaryBackupFilename,
      env,
      expectedDirectory: context.temporaryDirectory,
    })
    await publishBackupPair({
      temporaryBackupFilename,
      temporaryManifestFilename,
      backupFilename: context.backupFilename,
      manifestFilename: context.manifestFilename,
      environment: context.environment,
    })
  } catch (cause) {
    failure = cause
  }
  failure = await removeTemporaryDirectory({
    directory: context.temporaryDirectory,
    error: failure,
  })
  if (failure) {
    throw failure instanceof OrderHistoryPersistenceError
      ? failure
      : createBackupError({
        stage: "backup-artifact-creation",
        cause: failure,
        environment: context.environment,
        backupFilename: context.backupFilename,
      })
  }
  return {
    onlineBackup,
    sha256,
  }
}

async function createBackup({
  env,
  now,
  createId,
  backupRate,
  keep,
} = {}) {
  const context = await resolveBackupContext({
    env,
    now,
    createId,
    keep,
  })
  const artifact = await createTemporaryBackupArtifact({
    context,
    backupRate,
    env,
  })
  const retention = await rotateBackups({
    backupDirectory: context.backupDirectory,
    environment: context.environment,
    keep,
  })
  return {
    environment: context.environment,
    backupFilename: context.backupFilename,
    manifestFilename: context.manifestFilename,
    createdAt: context.createdAt.toISOString(),
    schemaVersion: artifact.onlineBackup.schemaVersion,
    sha256: artifact.sha256,
    pagesCopied: artifact.onlineBackup.pagesCopied,
    verified: true,
    retainedBackupCount: retention.retainedBackupCount,
  }
}

export function createHarvesterTradingHistoryBackupService({
  env = process.env,
  now = () => new Date(),
  createId = randomUUID,
  backupRate = DEFAULT_BACKUP_RATE,
} = {}) {
  return Object.freeze({
    createBackup: ({ keep = DEFAULT_RETENTION_COUNT } = {}) => createBackup({
      env,
      now,
      createId,
      backupRate,
      keep,
    }),
    verifyBackup: ({ backupFilename } = {}) => verifyBackup({
      backupFilename,
      env,
    }),
  })
}
