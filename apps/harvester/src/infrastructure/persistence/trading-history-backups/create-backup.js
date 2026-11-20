import { randomUUID } from "node:crypto"
import {
  link,
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
import { OrderHistoryPersistenceError } from "../order-history-persistence-error.js"
import { assertHarvesterDatabaseIsolation } from "../resolve-harvester-database-filename.js"
import { createBackupError } from "./errors.js"
import {
  assertSourceFile,
  createBackupFilename,
  ensurePrivateDirectory,
  resolveBackupDirectory,
  restrictFilePermissions,
} from "./backup-paths.js"
import {
  calculateSha256,
  createBackupManifest,
} from "./backup-manifest.js"
import { createOnlineBackup } from "./backup-sqlite.js"
import { verifyBackup } from "./verify-backup.js"
import { rotateBackups } from "./rotate-backups.js"

const DEFAULT_RETENTION_COUNT = 30
const DEFAULT_BACKUP_RATE = 100

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
          code: "HARVESTER_HISTORY_BACKUP_FAILED",
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
      code: "HARVESTER_HISTORY_BACKUP_FAILED",
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

async function createAndVerifyTemporaryBackup({
  context,
  backupRate,
  env,
  temporaryBackupFilename,
  temporaryManifestFilename,
} = {}) {
  const onlineBackup = await createOnlineBackup({
    sourceFilename: context.sourceFilename,
    destinationFilename: temporaryBackupFilename,
    backupRate,
    environment: context.environment,
  })
  await restrictFilePermissions({
    filename: temporaryBackupFilename,
  })
  const sha256 = await calculateSha256(temporaryBackupFilename)
  const manifest = createBackupManifest({
    environment: context.environment,
    createdAt: context.createdAt,
    backupFilename: context.backupFilename,
    schemaVersion: onlineBackup.schemaVersion,
    sha256,
  })
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
  return {
    onlineBackup,
    sha256,
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
  try {
    const artifact = await createAndVerifyTemporaryBackup({
      context,
      backupRate,
      env,
      temporaryBackupFilename,
      temporaryManifestFilename,
    })
    await publishBackupPair({
      temporaryBackupFilename,
      temporaryManifestFilename,
      backupFilename: context.backupFilename,
      manifestFilename: context.manifestFilename,
      environment: context.environment,
    })
    await rm(context.temporaryDirectory, {
      recursive: true,
      force: true,
    })
    return artifact
  } catch (cause) {
    const failure = await removeTemporaryDirectory({
      directory: context.temporaryDirectory,
      error: cause,
    })
    throw failure instanceof OrderHistoryPersistenceError
      ? failure
      : createBackupError({
        stage: "backup-artifact-creation",
        code: "HARVESTER_HISTORY_BACKUP_FAILED",
        cause: failure,
        environment: context.environment,
        backupFilename: context.backupFilename,
      })
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
