import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readFile } from "node:fs/promises"
import {
  basename,
  dirname,
  resolve,
} from "node:path"
import { HARVESTER_RELATIONAL_MIGRATIONS } from "../relational-migrations.js"
import { createBackupError } from "./errors.js"
import {
  assertBackupDirectory,
  assertRegularBackupFile,
} from "./backup-paths.js"

const MANIFEST_FORMAT_VERSION = 1
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function isValidTimestamp(value) {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
}

function isValidBackupFilename({ filename, environment } = {}) {
  const environmentDirectory = environment === "live" ? "production" : "testnet"
  const pattern = new RegExp(
    `^harvester-${environmentDirectory}-\\d{8}T\\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.sqlite$`,
  )
  return pattern.test(filename)
}

function isValidManifestMetadata({
  manifest,
  backupFilename,
  environment,
} = {}) {
  const latestSchemaVersion = HARVESTER_RELATIONAL_MIGRATIONS.at(-1)?.version ?? 0
  return manifest?.formatVersion === MANIFEST_FORMAT_VERSION &&
    manifest.filename === basename(backupFilename) &&
    isValidBackupFilename({
      filename: basename(backupFilename),
      environment,
    }) &&
    Number.isSafeInteger(manifest.schemaVersion) &&
    manifest.schemaVersion >= 0 &&
    manifest.schemaVersion <= latestSchemaVersion &&
    isValidTimestamp(manifest.createdAt) &&
    typeof manifest.sha256 === "string" &&
    SHA256_PATTERN.test(manifest.sha256)
}

function validateManifest({ manifest, backupFilename, environment } = {}) {
  if (manifest?.environment !== environment) {
    throw createBackupError({
      stage: "manifest-environment-validation",
      code: "HARVESTER_HISTORY_BACKUP_ENVIRONMENT_MISMATCH",
      environment,
      backupFilename,
    })
  }
  if (!isValidManifestMetadata({
    manifest,
    backupFilename,
    environment,
  })) {
    throw createBackupError({
      stage: "manifest-validation",
      code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      environment,
      backupFilename,
    })
  }
}

export function createBackupManifest({
  environment,
  createdAt,
  backupFilename,
  schemaVersion,
  sha256,
} = {}) {
  const createdAtValue = createdAt instanceof Date && Number.isFinite(createdAt.getTime())
    ? createdAt.toISOString()
    : null
  const manifest = {
    formatVersion: MANIFEST_FORMAT_VERSION,
    environment,
    createdAt: createdAtValue,
    filename: basename(backupFilename),
    schemaVersion,
    sha256,
  }
  validateManifest({
    manifest,
    backupFilename,
    environment,
  })
  return manifest
}

export async function calculateSha256(filename) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

async function resolveManifestPaths({
  backupFilename,
  backupDirectory,
  environment,
} = {}) {
  if (typeof backupFilename !== "string" || typeof backupDirectory !== "string") {
    throw createBackupError({
      stage: "manifest-input-validation",
      code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      environment,
    })
  }
  const resolvedFilename = resolve(backupFilename)
  const resolvedDirectory = resolve(backupDirectory)
  if (dirname(resolvedFilename) !== resolvedDirectory) {
    throw createBackupError({
      stage: "manifest-path-validation",
      code: "HARVESTER_HISTORY_BACKUP_ENVIRONMENT_MISMATCH",
      environment,
      backupFilename: resolvedFilename,
    })
  }
  await assertBackupDirectory({
    directory: resolvedDirectory,
    environment,
    backupFilename: resolvedFilename,
  })
  await assertRegularBackupFile({
    filename: resolvedFilename,
    stage: "backup-file-validation",
    code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
    environment,
  })
  const manifestFilename = `${resolvedFilename}.manifest.json`
  await assertRegularBackupFile({
    filename: manifestFilename,
    stage: "manifest-file-validation",
    code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
    environment,
  })
  return {
    resolvedFilename,
    manifestFilename,
  }
}

async function readManifest({
  manifestFilename,
  backupFilename,
  environment,
} = {}) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestFilename, "utf8"))
  } catch (cause) {
    throw createBackupError({
      stage: "manifest-read",
      code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      cause,
      environment,
      backupFilename,
    })
  }
  validateManifest({
    manifest,
    backupFilename,
    environment,
  })
  return manifest
}

export async function readAndValidateManifest({
  backupFilename,
  backupDirectory,
  environment,
} = {}) {
  const paths = await resolveManifestPaths({
    backupFilename,
    backupDirectory,
    environment,
  })
  const manifest = await readManifest({
    manifestFilename: paths.manifestFilename,
    backupFilename: paths.resolvedFilename,
    environment,
  })
  let actualDigest
  try {
    actualDigest = await calculateSha256(paths.resolvedFilename)
  } catch (cause) {
    throw createBackupError({
      stage: "digest-read",
      code: "HARVESTER_HISTORY_BACKUP_MANIFEST_INVALID",
      cause,
      environment,
      backupFilename: paths.resolvedFilename,
    })
  }
  if (actualDigest !== manifest.sha256) {
    throw createBackupError({
      stage: "digest-validation",
      code: "HARVESTER_HISTORY_BACKUP_DIGEST_MISMATCH",
      environment,
      backupFilename: paths.resolvedFilename,
    })
  }
  return {
    backupFilename: paths.resolvedFilename,
    manifestFilename: paths.manifestFilename,
    manifest,
  }
}
