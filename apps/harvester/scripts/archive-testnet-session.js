import { createHash } from "node:crypto"
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { createHarvesterTradingHistoryBackupService } from "../src/infrastructure/persistence/trading-history-backups/index.js"
import { createHarvesterLogSessionPaths } from "../src/infrastructure/logging/create-harvester-log-session-paths.js"
import { validateArchiveRemote } from "./initialize-private-archive-repository.js"
import { createHarvesterArchiveProcessIdentity } from "./capture-harvester-archive-process-identity.js"

const execFileAsync = promisify(execFile)
const PACKAGE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const LOG_DIRECTORY = path.join(PACKAGE_DIRECTORY, "logs")
const SESSION_DIRECTORY = path.join(LOG_DIRECTORY, "sessions")
const LOCAL_ARCHIVE_DIRECTORY = path.join(PACKAGE_DIRECTORY, "data", "archives")
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const runGitDefault = async (args, { cwd } = {}) => {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout.trim()
}

function assertProcessIdentity(identity) {
  let normalized
  try {
    normalized = createHarvesterArchiveProcessIdentity({
      startedAt: identity?.startedAt,
      runtimeSessionId: identity?.runtimeSessionId,
      tradingMode: identity?.environment,
      source: identity?.source,
    })
  } catch (cause) {
    throw new Error(
      "The selected session has no valid TESTNET process-start identity and full source commit; refusing to guess from the current checkout.",
      { cause },
    )
  }
  if (normalized.environment !== "testnet" || !normalized.source.commit) {
    throw new Error(
      "The selected session has no valid TESTNET process-start identity and full source commit; refusing to guess from the current checkout.",
    )
  }
  return normalized
}

export function createHarvesterArchiveDirectoryName(identity) {
  assertProcessIdentity(identity)
  const timestamp = identity.startedAt
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-")
  return `${timestamp}_${identity.source.commit.slice(0, 8).toLowerCase()}`
}

async function assertSessionCompleted(directory, runtimeSessionId) {
  const filename = path.join(directory, "process-completed.json")
  const fileStats = await lstat(filename)
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new Error(`Session completion marker is not a regular file: ${filename}`)
  }
  const completion = JSON.parse(await readFile(filename, "utf8"))
  if (
    completion.runtimeSessionId !== runtimeSessionId
    || typeof completion.endedAt !== "string"
    || Number.isNaN(Date.parse(completion.endedAt))
    || new Date(completion.endedAt).toISOString() !== completion.endedAt
    || (completion.exitCode !== null && !Number.isInteger(completion.exitCode))
    || (completion.signal !== null && typeof completion.signal !== "string")
    || completion.logStreamsComplete !== true
  ) {
    throw new Error(`Session completion marker is invalid or belongs to another process: ${filename}`)
  }
}

async function readSessionIdentity(directory) {
  const identityFilename = path.join(directory, "process-identity.json")
  const identityStats = await lstat(identityFilename)
  if (identityStats.isSymbolicLink() || !identityStats.isFile()) {
    throw new Error(`Process identity is not a regular file: ${identityFilename}`)
  }
  return JSON.parse(await readFile(identityFilename, "utf8"))
}

async function resolveSessionIdentity({ sessionId } = {}) {
  const entries = await readdir(SESSION_DIRECTORY, { withFileTypes: true })
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const directory = path.join(SESSION_DIRECTORY, entry.name)
    const identityFilename = path.join(directory, "process-identity.json")
    try {
      await lstat(identityFilename)
    } catch (error) {
      if (error.code === "ENOENT") {
        continue
      }
      throw error
    }
    const identity = await readSessionIdentity(directory)
    if (identity.environment !== "testnet") {
      continue
    }
    assertProcessIdentity(identity)
    if (sessionId && identity.runtimeSessionId !== sessionId) {
      continue
    }
    const expected = createHarvesterLogSessionPaths({
      directory: LOG_DIRECTORY,
      startedAt: identity.startedAt,
      runtimeSessionId: identity.runtimeSessionId,
    }).sessionDirectory
    if (path.resolve(expected) !== path.resolve(directory)) {
      throw new Error(`Session identity does not match its directory: ${directory}`)
    }
    for (const candidateDirectory of [LOG_DIRECTORY, SESSION_DIRECTORY, directory]) {
      const directoryStats = await lstat(candidateDirectory)
      if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
        throw new Error(`Session path must be a real directory, not a symlink: ${candidateDirectory}`)
      }
    }
    await assertSessionCompleted(directory, identity.runtimeSessionId)
    candidates.push({ directory, identity })
  }

  if (sessionId && candidates.length !== 1) {
    throw new Error(`Expected exactly one TESTNET session for runtime session ID ${sessionId}; found ${candidates.length}.`)
  }
  if (candidates.length === 0) {
    throw new Error("No eligible TESTNET process session was found under logs/sessions.")
  }
  candidates.sort((left, right) => right.identity.startedAt.localeCompare(left.identity.startedAt))
  if (!sessionId && candidates.length > 1
    && candidates[0].identity.startedAt === candidates[1].identity.startedAt) {
    throw new Error("The latest TESTNET sessions have the same start timestamp; pass --session <runtime-session-id>.")
  }
  return candidates[0]
}

async function assertRealDirectory(directory) {
  const directoryStats = await lstat(directory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error(`Expected a real directory, not a symbolic link: ${directory}`)
  }
}

async function copyRegularTree({ sourceDirectory, destinationDirectory, relative = "" } = {}) {
  await mkdir(destinationDirectory, { recursive: true, mode: 0o700 })
  const source = relative ? path.join(sourceDirectory, relative) : sourceDirectory
  const destination = relative ? path.join(destinationDirectory, relative) : destinationDirectory
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    const sourceStats = await lstat(sourcePath)
    if (sourceStats.isSymbolicLink()) {
      throw new Error(`Refusing to archive a symbolic link: ${sourcePath}`)
    }
    if (sourceStats.isDirectory()) {
      await mkdir(destinationPath, { recursive: false, mode: 0o700 })
      await copyRegularTree({
        sourceDirectory,
        destinationDirectory,
        relative: path.join(relative, entry.name),
      })
    } else if (sourceStats.isFile()) {
      await copyFile(sourcePath, destinationPath)
    } else {
      throw new Error(`Refusing to archive a non-regular session entry: ${sourcePath}`)
    }
  }
}

async function listRegularFiles(directory, relative = "") {
  const current = relative ? path.join(directory, relative) : directory
  const entries = await readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const filename = path.join(directory, childRelative)
    const fileStats = await lstat(filename)
    if (fileStats.isSymbolicLink()) {
      throw new Error(`Archive contains a symbolic link: ${filename}`)
    }
    if (fileStats.isDirectory()) {
      files.push(...await listRegularFiles(directory, childRelative))
    } else if (fileStats.isFile()) {
      files.push(childRelative.split(path.sep).join("/"))
    } else {
      throw new Error(`Archive contains a non-regular file: ${filename}`)
    }
  }
  return files.sort()
}

async function sha256File(filename) {
  const content = await readFile(filename)
  return createHash("sha256").update(content).digest("hex")
}

async function createArchiveManifest({ directory, identity, backupResult } = {}) {
  const files = await listRegularFiles(directory)
  const entries = []
  for (const relativePath of files) {
    const filename = path.join(directory, relativePath)
    const fileStats = await stat(filename)
    entries.push({
      path: relativePath,
      size: fileStats.size,
      sha256: await sha256File(filename),
    })
  }
  return {
    formatVersion: 1,
    application: "harvester",
    environment: "testnet",
    process: {
      startedAt: identity.startedAt,
      runtimeSessionId: identity.runtimeSessionId,
      source: identity.source,
    },
    database: {
      backupCreatedAt: backupResult.createdAt,
      schemaVersion: backupResult.schemaVersion,
      sha256: backupResult.sha256,
    },
    files: entries,
  }
}

async function verifyArchive({ directory, manifest } = {}) {
  const databaseEntry = manifest.files.find((entry) => entry.path === "database/harvester.sqlite")
  if (!databaseEntry || databaseEntry.sha256 !== manifest.database?.sha256) {
    throw new Error("Archive database checksum does not match the verified SQLite backup metadata.")
  }
  const expectedPaths = manifest.files.map((entry) => entry.path).sort()
  const actualPaths = (await listRegularFiles(directory))
    .filter((filename) => filename !== "manifest.json")
  if (JSON.stringify(expectedPaths) !== JSON.stringify(actualPaths)) {
    throw new Error("Archive file inventory does not match its manifest.")
  }
  for (const entry of manifest.files) {
    const filename = path.join(directory, entry.path)
    const fileStats = await stat(filename)
    if (fileStats.size !== entry.size || await sha256File(filename) !== entry.sha256) {
      throw new Error(`Archive checksum or size verification failed: ${entry.path}`)
    }
  }
}

async function publishArchive({
  directory,
  archiveName,
  remote,
  runGit = runGitDefault,
  createTemporaryDirectory = (prefix) => mkdtemp(path.join(os.tmpdir(), prefix)),
  removeTemporaryDirectory = (filename) => rm(filename, { recursive: true, force: true }),
} = {}) {
  const temporaryRoot = await createTemporaryDirectory(".archive-push-")
  const checkout = path.join(temporaryRoot, "checkout")
  try {
    await runGit(["clone", "--branch", "main", "--single-branch", remote, checkout])
    const remoteArchiveDirectory = path.join(checkout, "archives", archiveName)
    let archiveAlreadyExists = false
    try {
      await mkdir(remoteArchiveDirectory, { recursive: false, mode: 0o700 })
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error
      }
      const existingStats = await lstat(remoteArchiveDirectory)
      if (existingStats.isSymbolicLink() || !existingStats.isDirectory()) {
        throw new Error(`Remote archive destination is not a regular directory: archives/${archiveName}`)
      }
      archiveAlreadyExists = true
    }

    if (archiveAlreadyExists) {
      const localFiles = await listRegularFiles(directory)
      const remoteFilesOutput = await runGit(
        ["ls-tree", "-r", "--name-only", "HEAD", "--", `archives/${archiveName}`],
        { cwd: checkout },
      )
      const remoteFiles = remoteFilesOutput ? remoteFilesOutput.split("\n").map((filename) => filename.slice(`archives/${archiveName}/`.length)).sort() : []
      if (JSON.stringify(localFiles) !== JSON.stringify(remoteFiles)) {
        throw new Error(`Remote archive already exists with a different file inventory; refusing to overwrite: archives/${archiveName}`)
      }
      for (const relativePath of localFiles) {
        const localBlob = await runGit(["hash-object", path.join(directory, relativePath)])
        const remoteBlob = await runGit(["rev-parse", `HEAD:archives/${archiveName}/${relativePath.split(path.sep).join("/")}`], { cwd: checkout })
        if (localBlob !== remoteBlob) {
          throw new Error(`Remote archive already exists with different content; refusing to overwrite: ${relativePath}`)
        }
      }
      const existingCommit = await runGit(["rev-parse", "HEAD"], { cwd: checkout })
      const remoteHead = await runGit(["ls-remote", "--heads", remote, "refs/heads/main"])
      if (remoteHead.split(/\s+/)[0] !== existingCommit) {
        throw new Error("The archive exists in the cloned remote history, but remote main advanced during verification.")
      }
      return { commit: existingCommit, fileCount: localFiles.length, alreadyPublished: true }
    }

    await copyRegularTree({
      sourceDirectory: directory,
      destinationDirectory: remoteArchiveDirectory,
    })
    await runGit(["add", "--", `archives/${archiveName}`], { cwd: checkout })
    await runGit([
      "-c", "user.name=Coinzilla Harvester",
      "-c", "user.email=harvester-archive@users.noreply.github.com",
      "commit", "-m", `chore(archive): add Harvester session ${archiveName}`,
    ], { cwd: checkout })
    const localCommit = await runGit(["rev-parse", "HEAD"], { cwd: checkout })
    await runGit(["push", "origin", "main"], { cwd: checkout })
    const remoteHead = await runGit(["ls-remote", "--heads", remote, "refs/heads/main"])
    if (remoteHead.split(/\s+/)[0] !== localCommit) {
      throw new Error("The archive push completed but remote main does not point to the published commit.")
    }
    const files = await listRegularFiles(directory)
    for (const relativePath of files) {
      const localBlob = await runGit(["hash-object", path.join(directory, relativePath)])
      const remoteBlob = await runGit(["rev-parse", `HEAD:archives/${archiveName}/${relativePath.split(path.sep).join("/")}`], { cwd: checkout })
      if (localBlob !== remoteBlob) {
        throw new Error(`Remote archive content verification failed: ${relativePath}`)
      }
    }
    return { commit: localCommit, fileCount: files.length }
  } finally {
    await removeTemporaryDirectory(temporaryRoot)
  }
}

export async function runHarvesterArchivePush({
  args = process.argv.slice(2),
  env = process.env,
  backupServiceFactory = createHarvesterTradingHistoryBackupService,
  runGit = runGitDefault,
} = {}) {
  if (env.TRADING_MODE !== "testnet") {
    throw new Error("Archive publication requires TRADING_MODE=testnet. LIVE and unspecified modes are rejected.")
  }
  const remote = validateArchiveRemote(env.HARVESTER_ARCHIVE_REMOTE)
  if (args.length > 2 || (args.length > 0 && args[0] !== "--session") || (args.length === 2 && !UUID_PATTERN.test(args[1]))) {
    throw new TypeError("Usage: archive:push [--session <runtime-session-id>]")
  }
  const selected = await resolveSessionIdentity({
    sessionId: args.length === 2 ? args[1] : undefined,
  })
  const identity = assertProcessIdentity(selected.identity)
  const archiveName = createHarvesterArchiveDirectoryName(identity)
  await assertRealDirectory(path.join(PACKAGE_DIRECTORY, "data"))
  await mkdir(LOCAL_ARCHIVE_DIRECTORY, { recursive: true, mode: 0o700 })
  await assertRealDirectory(LOCAL_ARCHIVE_DIRECTORY)
  const localArchive = path.join(LOCAL_ARCHIVE_DIRECTORY, archiveName)
  let existingManifest = null
  try {
    await mkdir(localArchive, { recursive: false, mode: 0o700 })
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error
    }
    await assertRealDirectory(localArchive)
    const manifestFilename = path.join(localArchive, "manifest.json")
    try {
      const manifestStats = await lstat(manifestFilename)
      if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
        throw new Error("Archive manifest must be a regular file.")
      }
      existingManifest = JSON.parse(await readFile(manifestFilename, "utf8"))
    } catch {
      throw new Error(`A partial or unreadable local archive already exists at ${localArchive}; refusing to overwrite it.`)
    }
    if (
      existingManifest.process?.startedAt !== identity.startedAt
      || existingManifest.process?.runtimeSessionId !== identity.runtimeSessionId
      || existingManifest.process?.source?.commit !== identity.source.commit
      || existingManifest.environment !== "testnet"
    ) {
      throw new Error(`The existing local archive does not match the selected process identity: ${localArchive}`)
    }
    await verifyArchive({ directory: localArchive, manifest: existingManifest })
  }

  try {
    if (!existingManifest) {
      const backupService = backupServiceFactory({ env })
      const backupResult = await backupService.createBackup({ keep: 3650 })
      if (!backupResult.verified || backupResult.environment !== "testnet") {
        throw new Error("The existing SQLite backup service did not return a verified TESTNET backup.")
      }
      const databaseDirectory = path.join(localArchive, "database")
      const logsDestination = path.join(localArchive, "logs")
      await mkdir(databaseDirectory, { mode: 0o700 })
      await mkdir(logsDestination, { mode: 0o700 })
      const copiedDatabaseFilename = path.join(databaseDirectory, "harvester.sqlite")
      await copyFile(backupResult.backupFilename, copiedDatabaseFilename)
      if (await sha256File(copiedDatabaseFilename) !== backupResult.sha256) {
        throw new Error("Copied SQLite backup checksum does not match the backup service result.")
      }
      await copyFile(backupResult.manifestFilename, path.join(databaseDirectory, "backup-manifest.json"))
      await copyRegularTree({
        sourceDirectory: selected.directory,
        destinationDirectory: path.join(logsDestination, path.basename(selected.directory)),
      })
      const manifest = await createArchiveManifest({
        directory: localArchive,
        identity,
        backupResult,
      })
      await writeFile(path.join(localArchive, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      await verifyArchive({ directory: localArchive, manifest })
    }
    const published = await publishArchive({
      directory: localArchive,
      archiveName,
      remote,
      runGit,
    })
    return {
      archiveName,
      localArchive,
      remote,
      remoteCommit: published.commit,
      fileCount: published.fileCount,
      sourceCommit: identity.source.commit,
      startedAt: identity.startedAt,
    }
  } catch (error) {
    // Keep the partial/local artifact for diagnosis and safe retry; never clean source data.
    throw new Error(`Archive ${archiveName} was not published. Local files were retained at ${localArchive}. ${error.message}`, { cause: error })
  }
}

async function main() {
  const result = await runHarvesterArchivePush()
  process.stdout.write([
    "Harvester TESTNET archive published and remotely verified.",
    `Archive: archives/${result.archiveName}`,
    `Process started: ${result.startedAt}`,
    `Source commit: ${result.sourceCommit}`,
    `Remote commit: ${result.remoteCommit}`,
    `Local copy: ${result.localArchive}`,
    `Files verified: ${result.fileCount}`,
  ].join("\n") + "\n")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`Harvester archive publication failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
