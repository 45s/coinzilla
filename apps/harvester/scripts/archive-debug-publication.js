import { lstat, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import {
  listRegularFiles,
  publishArchive,
  validateArchiveRemote,
  verifyArchive,
} from "./archive-debug-session.js"

const ARCHIVE_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z_[0-9a-f]{8}_debug$/
const REQUIRED_INCLUDED_DIRECTORIES = ["logs", "recovery-facts"]
const REQUIRED_EXCLUSIONS = ["data/** (all databases and backups)", "logs/cumulative/**"]

function validateArchiveName(archiveName) {
  if (!ARCHIVE_NAME_PATTERN.test(archiveName)) {
    throw new Error(`Invalid debug archive directory name: ${archiveName}`)
  }
}

function validateManifestHeader(manifest) {
  const hasExpectedFormat = manifest.formatVersion === 1
    && manifest.application === "harvester"
    && manifest.commandTradingMode === "testnet"
  const hasExpectedScope = JSON.stringify(manifest.includedDirectories) === JSON.stringify(REQUIRED_INCLUDED_DIRECTORIES)
    && JSON.stringify(manifest.excludedPaths) === JSON.stringify(REQUIRED_EXCLUSIONS)
  const hasCreationTime = typeof manifest.createdAt === "string"
    && !Number.isNaN(Date.parse(manifest.createdAt))
  if (!hasExpectedFormat || !hasExpectedScope || !hasCreationTime) {
    throw new Error("Debug archive manifest is invalid or incomplete.")
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("Debug archive manifest must contain a non-empty file inventory.")
  }
}

function isSafeManifestPath(filePath) {
  if (typeof filePath !== "string") {
    return false
  }
  const pathSegments = filePath.split("/")
  return pathSegments.length > 0
    && !filePath.includes("\\")
    && !path.posix.isAbsolute(filePath)
    && pathSegments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

function isAllowedManifestPath(filePath) {
  return filePath.startsWith("logs/")
    || filePath.startsWith("recovery-facts/")
    || filePath === "data_commit_hash"
}

function validateManifestFileEntry({ entry, seenPaths } = {}) {
  if (entry === null || typeof entry !== "object") {
    throw new Error("Debug archive manifest contains a non-object file entry.")
  }
  const validEntry = isSafeManifestPath(entry.path)
    && isAllowedManifestPath(entry.path)
    && typeof entry.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(entry.sha256)
    && Number.isSafeInteger(entry.size)
    && entry.size >= 0
    && !seenPaths.has(entry.path)
  if (!validEntry) {
    throw new Error("Debug archive manifest contains an invalid or duplicate file entry.")
  }
  seenPaths.add(entry.path)
}
function validateManifestFileEntries(manifest) {
  const seenPaths = new Set()
  for (const entry of manifest.files) {
    validateManifestFileEntry({
      entry,
      seenPaths,
    })
  }
  return seenPaths
}

async function validateCompletedArchive(directory) {
  const directoryStats = await lstat(directory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error(`Debug archive must be a real directory: ${directory}`)
  }
  const archiveName = path.basename(directory)
  validateArchiveName(archiveName)
  const manifestPath = path.join(directory, "manifest.json")
  const manifestStats = await lstat(manifestPath)
  if (manifestStats.isSymbolicLink() || !manifestStats.isFile()) {
    throw new Error("Debug archive manifest must be a regular file.")
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  validateManifestHeader(manifest)
  const seenPaths = validateManifestFileEntries(manifest)
  await verifyArchive({
    directory,
    manifest,
  })
  const actualFiles = await listRegularFiles({ directory })
  const expectedFiles = [...seenPaths, "manifest.json"].sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Debug archive manifest inventory does not include exactly the archive's regular files.")
  }
  return {
    archiveName,
    manifest,
  }
}

async function selectLatestCompletedArchive({ packageDirectory } = {}) {
  const archiveOutput = path.join(packageDirectory, "archive-output")
  const outputStats = await lstat(archiveOutput)
  if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
    throw new Error("Debug archive output must be a real directory.")
  }
  const entries = await readdir(archiveOutput, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isDirectory() && ARCHIVE_NAME_PATTERN.test(entry.name))
    .map(({ name }) => name)
    .sort()
    .reverse()
  for (const archiveName of candidates) {
    const directory = path.join(archiveOutput, archiveName)
    try {
      await validateCompletedArchive(directory)
      return directory
    } catch {
      // An incomplete or invalid newer directory is not a completed archive.
    }
  }
  throw new Error("No valid completed debug archive was found in archive-output.")
}

function resolvePublicationRemote(env) {
  const remote = validateArchiveRemote(env.HARVESTER_ARCHIVE_REMOTE)
  const canonicalRemote = remote.replace(/\.git$/, "").replace(/\/$/, "")
  if (canonicalRemote !== "https://github.com/45s/coinzilla-archive") {
    throw new Error("HARVESTER_ARCHIVE_REMOTE must target https://github.com/45s/coinzilla-archive.")
  }
  return remote
}

// This entry point intentionally accepts only a completed archive and publication settings.\nexport async function runHarvesterDebugArchivePublication({
  args = [],
  env = process.env,
  packageDirectory,
  archiveDirectory,
  publishArchiveFn = publishArchive,
  runGit,
  onProgress = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  let selectedDirectory = archiveDirectory
  if (args.length > 0) {
    if (args.length !== 2 || args[0] !== "--archive") {
      throw new TypeError("Usage: archive:debug:publish [--archive <directory>]")
    }
    const [, archiveDirectoryArgument] = args
    selectedDirectory = archiveDirectoryArgument
  }
  if (!selectedDirectory && env.HARVESTER_ARCHIVE_DIRECTORY) {
    selectedDirectory = env.HARVESTER_ARCHIVE_DIRECTORY
  }
  if (!selectedDirectory) {
    selectedDirectory = await selectLatestCompletedArchive({ packageDirectory })
  }
  const directory = path.resolve(selectedDirectory)
  const { archiveName } = await validateCompletedArchive(directory)
  const remote = resolvePublicationRemote(env)
  const published = await publishArchiveFn({
    directory,
    archiveName,
    remote,
    runGit,
    onProgress,
  })
  return {
    archiveName,
    directory,
    remote,
    remoteCommit: published.commit,
    fileCount: published.fileCount,
    alreadyPublished: published.alreadyPublished === true,
  }
}
