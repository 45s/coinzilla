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

function validateManifestFileEntry(entry, seenPaths) {
  const pathSegments = typeof entry.path === "string" ? entry.path.split("/") : []
  const safePath = pathSegments.length > 0
    && !entry.path.includes("\\")
    && !path.posix.isAbsolute(entry.path)
    && pathSegments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
  const allowedPath = entry.path?.startsWith("logs/")
    || entry.path?.startsWith("recovery-facts/")
    || entry.path === "data_commit_hash"
  const validDigest = typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/.test(entry.sha256)
  const validSize = Number.isSafeInteger(entry.size) && entry.size >= 0
  if (!safePath || !allowedPath || !validDigest || !validSize || seenPaths.has(entry.path)) {
    throw new Error("Debug archive manifest contains an invalid or duplicate file entry.")
  }
  seenPaths.add(entry.path)
}

function validateManifestFileEntries(manifest) {
  const seenPaths = new Set()
  for (const entry of manifest.files) {
    validateManifestFileEntry(entry, seenPaths)
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

export async function runHarvesterDebugArchivePublication({
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
    selectedDirectory = args[1]
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
