import { lstat, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { gunzipSync } from "node:zlib"
import os from "node:os"
import path from "node:path"
import {
  copyRegularTree,
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
  const hasExpectedFormat = manifest.formatVersion === 2
    && manifest.application === "harvester"
    && ["testnet", "live"].includes(manifest.runtimeTradingMode)
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

function assertManifestRuntimeCorrelation({ manifest, integrity, expectedRuntimeId } = {}) {
  const invalid = [
    integrity?.status !== "matched",
    integrity.validForPublication !== true,
    integrity.expectedRuntimeId !== expectedRuntimeId,
    manifest.matchingTradingLogsAvailable !== true,
    manifest.logRuntimeSessionId !== expectedRuntimeId,
    manifest.runtimeIdentity?.status !== "matched",
    manifest.runtimeIdentity?.correlation !== "same-runtime-session",
    manifest.tradingRuntime?.runtimeSessionId !== expectedRuntimeId,
    manifest.tradingRuntime?.processIdentity?.runtimeSessionId !== expectedRuntimeId,
  ].some(Boolean)
  if (invalid) {
    throw new Error(`Debug archive evidence integrity is not publishable: expected runtime=${expectedRuntimeId ?? "unknown"}; status=${integrity?.status ?? "unverifiable"}; matchingTradingLogsAvailable=${manifest.matchingTradingLogsAvailable}.`)
  }
}

function assertUniqueCompletedRuntimeSession({ manifest, expectedRuntimeId } = {}) {
  const matchingSessions = (manifest.sessionInventory ?? []).filter((session) =>
    session.runtimeSessionId === expectedRuntimeId
      && ["complete", "active"].includes(session.completionStatus)
      && ["complete", "active"].includes(session.loggerCompletionStatus)
  )
  if (matchingSessions.length !== 1) {
    throw new Error(`Debug archive runtime ownership is ambiguous or incomplete: expected exactly one completed or verified active process identity for runtime ${expectedRuntimeId}; found ${matchingSessions.length}.`)
  }
  return matchingSessions[0]
}

async function readArchivedSessionJson({ directory, manifest, sourcePath } = {}) {
  const entry = manifest.files.find((file) => file.sourcePath === sourcePath)
  if (!entry) {
    throw new Error(`Archive is missing required process lifecycle evidence: ${sourcePath}.`)
  }
  const compressed = await readFile(path.join(directory, entry.path))
  return JSON.parse(gunzipSync(compressed).toString("utf8"))
}

function isMatchingArchivedProcessIdentity({ identity, session, expectedRuntimeId, manifest } = {}) {
  const expectedProcessId = manifest.tradingRuntime.processIdentity.processId
  return identity.application === "harvester"
    && ["testnet", "live"].includes(identity.environment)
    && identity.environment === manifest.runtimeTradingMode
    && identity.runtimeSessionId === expectedRuntimeId
    && identity.startedAt === session.startedAt
    && identity.startedAt === manifest.tradingRuntime.processIdentity.startedAt
    && Number.isSafeInteger(identity.processId)
    && identity.processId > 0
    && identity.processId === session.processId
    && identity.processId === expectedProcessId
}

function isMatchingArchivedProcessCompletion({ completion, expectedRuntimeId } = {}) {
  return completion.runtimeSessionId === expectedRuntimeId
    && completion.logStreamsComplete === true
    && completion.loggerStreamsComplete !== false
}

function isMatchingArchivedLoggerCompletion({ loggerCompletion, expectedRuntimeId } = {}) {
  return loggerCompletion.runtimeSessionId === expectedRuntimeId
    && loggerCompletion.logStreamsComplete === true
    && loggerCompletion.streams?.harvesterLog === true
    && loggerCompletion.streams?.traceLog === true
}

function assertArchivedProcessId({ identity, completion, manifest, expectedRuntimeId } = {}) {
  const expectedProcessId = manifest.tradingRuntime.processIdentity.processId
  if (
    !Number.isSafeInteger(expectedProcessId)
    || expectedProcessId <= 0
    || identity.processId !== expectedProcessId
    || completion.processId !== expectedProcessId
  ) {
    throw new Error(`Process ID mismatch in lifecycle evidence for runtime ${expectedRuntimeId}: expected=${expectedProcessId}; identity=${identity.processId}; completion=${completion.processId}.`)
  }
}

function matchesActiveSnapshotProcess({ marker, identity, manifest, expectedRuntimeId } = {}) {
  return marker.runtimeSessionId === expectedRuntimeId
    && marker.processId === identity.processId
    && marker.processId === manifest.tradingRuntime.processIdentity.processId
    && typeof marker.hostname === "string"
    && marker.processStartedAt === identity.startedAt
}

function matchesActiveSnapshotTimes({ marker, identity } = {}) {
  const identityStartedAt = Date.parse(identity.startedAt)
  const lockStartedAt = Date.parse(marker.lockStartedAt)
  const capturedAt = Date.parse(marker.capturedAt)
  return Number.isFinite(lockStartedAt)
    && Number.isFinite(identityStartedAt)
    && Math.abs(lockStartedAt - identityStartedAt) <= 30_000
    && Number.isFinite(capturedAt)
    && capturedAt >= lockStartedAt
}

function hasCompleteActiveSnapshotStreams(marker) {
  return marker.streams?.harvesterLog === true
    && marker.streams?.traceLog === true
}

function getExpectedActiveSnapshotLockName(lockFile) {
  if (lockFile.namespace === "application") {
    return `.harvester-trading-${lockFile.fingerprint}.lock`
  }
  if (lockFile.namespace === "host" && typeof lockFile.broker === "string" && /^[a-z0-9-]+$/i.test(lockFile.broker)) {
    return `.${lockFile.broker.toLowerCase()}-harvester-trading-${lockFile.fingerprint}.lock`
  }
  return null
}


function isValidActiveSnapshotLockFile({ lockFile, processStartedAt } = {}) {
  if (!lockFile || typeof lockFile !== "object") {
    return false
  }
  const lockStartedAt = Date.parse(lockFile.startedAt)
  return /^[a-f0-9]{64}$/i.test(lockFile.fingerprint ?? "")
    && typeof lockFile.name === "string"
    && Number.isFinite(lockStartedAt)
    && Math.abs(lockStartedAt - processStartedAt) <= 30_000
    && ["application", "host"].includes(lockFile.namespace)
    && lockFile.name === getExpectedActiveSnapshotLockName(lockFile)
}


function hasCompleteActiveSnapshotLockPairs(lockFiles) {
  const namespacesByFingerprint = new Map()
  for (const lockFile of lockFiles) {
    const namespaces = namespacesByFingerprint.get(lockFile.fingerprint) ?? new Set()
    if (namespaces.has(lockFile.namespace)) {
      return false
    }
    namespaces.add(lockFile.namespace)
    namespacesByFingerprint.set(lockFile.fingerprint, namespaces)
  }
  return [...namespacesByFingerprint.values()].every((namespaces) =>
    namespaces.has("application") && namespaces.has("host")
  )
}


function hasValidActiveSnapshotLockFiles(marker) {
  if (!Array.isArray(marker.lockFiles) || marker.lockFiles.length < 2) {
    return false
  }
  const processStartedAt = Date.parse(marker.processStartedAt)
  return Number.isFinite(processStartedAt)
    && marker.lockFiles.every((lockFile) => isValidActiveSnapshotLockFile({
      lockFile,
      processStartedAt,
    }))
    && hasCompleteActiveSnapshotLockPairs(marker.lockFiles)
}

function isValidActiveSnapshotMarker({ marker, identity, manifest, expectedRuntimeId } = {}) {
  return marker.formatVersion === 1
    && marker.snapshotType === "active-harvester-process"
    && matchesActiveSnapshotProcess({
      marker,
      identity,
      manifest,
      expectedRuntimeId,
    })
    && matchesActiveSnapshotTimes({
      marker,
      identity,
    })
    && hasValidActiveSnapshotLockFiles(marker)
    && marker.recoveryDataCommitHash === manifest.dataCommitHash
    && hasCompleteActiveSnapshotStreams(marker)
}

function assertNoRuntimeMismatches({ integrity, expectedRuntimeId } = {}) {
  const mismatches = Array.isArray(integrity?.mismatches) ? integrity.mismatches : []
  if (mismatches.length > 0) {
    const details = mismatches.map((entry) =>
      `${entry.stream ?? "stream"}:${entry.actualRuntimeId ?? "unknown"}@${entry.sourcePath ?? "unknown"}`
    ).join("; ")
    throw new Error(`Debug archive contains runtime-mismatched log evidence for expected runtime ${expectedRuntimeId}: ${details}.`)
  }
}
async function validateActiveSessionSnapshot({ directory, manifest, session, identity, expectedRuntimeId } = {}) {
  const markerPath = session.activeSnapshotPath
  const markerEntry = manifest.files.find((entry) => entry.path === markerPath)
  if (!markerEntry || typeof markerPath !== "string") {
    throw new Error(`Active runtime ${expectedRuntimeId} is missing its snapshot provenance marker.`)
  }
  const marker = JSON.parse(await readFile(path.join(directory, markerPath), "utf8"))
  if (!isValidActiveSnapshotMarker({
    marker,
    identity,
    manifest,
    expectedRuntimeId,
  })) {
    throw new Error(`Active process snapshot provenance is invalid for runtime ${expectedRuntimeId}.`)
  }
}

async function validateCompletedSessionLifecycle({ directory, manifest, session, identity, expectedRuntimeId } = {}) {
  const [completion, loggerCompletion] = await Promise.all([
    readArchivedSessionJson({
      directory,
      manifest,
      sourcePath: session.processCompletionPath,
    }),
    readArchivedSessionJson({
      directory,
      manifest,
      sourcePath: session.loggerCompletionPath,
    }),
  ])
  const lifecycleMatches = isMatchingArchivedProcessCompletion({
    completion,
    expectedRuntimeId,
  }) && isMatchingArchivedLoggerCompletion({
    loggerCompletion,
    expectedRuntimeId,
  })
  if (!lifecycleMatches) {
    throw new Error(`Archived process completion metadata does not prove complete runtime ${expectedRuntimeId}: process completion=${completion.runtimeSessionId ?? "missing"}; logger completion=${loggerCompletion.runtimeSessionId ?? "missing"}.`)
  }
  assertArchivedProcessId({
    identity,
    completion,
    manifest,
    expectedRuntimeId,
  })
}

async function validateSessionLifecycleEvidence({ directory, manifest } = {}) {
  const expectedRuntimeId = manifest.recoveryRuntimeSessionId
  const session = assertUniqueCompletedRuntimeSession({
    manifest,
    expectedRuntimeId,
  })
  const identity = await readArchivedSessionJson({
    directory,
    manifest,
    sourcePath: session.processIdentityPath,
  })
  if (!isMatchingArchivedProcessIdentity({
    identity,
    session,
    expectedRuntimeId,
    manifest,
  })) {
    throw new Error(`Archived process identity does not prove runtime ${expectedRuntimeId}.`)
  }
  if (session.completionStatus === "active") {
    await validateActiveSessionSnapshot({
      directory,
      manifest,
      session,
      identity,
      expectedRuntimeId,
    })
    return
  }
  await validateCompletedSessionLifecycle({
    directory,
    manifest,
    session,
    identity,
    expectedRuntimeId,
  })
}

function isInvalidStreamFile({ file, manifestFile, expectedRuntimeId } = {}) {
  return file.actualRuntimeId !== expectedRuntimeId
    || typeof file.sourcePath !== "string"
    || file.sourceSize < 1
    || file.archiveSize < 1
    || !/^[a-f0-9]{64}$/.test(file.sourceSha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(file.archiveSha256 ?? "")
    || !manifestFile
    || manifestFile.size !== file.archiveSize
    || manifestFile.sha256 !== file.archiveSha256
}

function isCompleteStream({ stream, expectedRuntimeId } = {}) {
  return stream?.status === "matched"
    && stream.expectedRuntimeId === expectedRuntimeId
    && stream.fileCount >= 1
    && stream.totalBytes >= 1
    && Array.isArray(stream.files)
    && stream.files.length >= 1
}

function assertCompleteStreamEvidence({ stream, streamLabel, expectedRuntimeId, manifestFiles } = {}) {
  if (!isCompleteStream({
    stream,
    expectedRuntimeId,
  })) {
    throw new Error(`${streamLabel} evidence is not complete for runtime ${expectedRuntimeId}: status=${stream?.status ?? "missing"}; files=${stream?.fileCount ?? 0}; bytes=${stream?.totalBytes ?? 0}.`)
  }
  for (const file of stream.files) {
    const manifestFile = manifestFiles.get(file.archivePath)
    if (isInvalidStreamFile({
      file,
      manifestFile,
      expectedRuntimeId,
    })) {
      throw new Error(`${streamLabel} evidence ownership or checksum metadata is invalid for runtime ${expectedRuntimeId}: ${file.sourcePath ?? "unknown source"}.`)
    }
  }
}

function validateEvidenceIntegrity(manifest) {
  const integrity = manifest.evidenceIntegrity
  const expectedRuntimeId = manifest.recoveryRuntimeSessionId
  assertManifestRuntimeCorrelation({
    manifest,
    integrity,
    expectedRuntimeId,
  })
  assertUniqueCompletedRuntimeSession({
    manifest,
    expectedRuntimeId,
  })
  const manifestFiles = new Map(manifest.files.map((entry) => [entry.path, entry]))
  assertCompleteStreamEvidence({
    stream: integrity.streams?.harvesterLog,
    streamLabel: "HARVESTER LOG",
    expectedRuntimeId,
    manifestFiles,
  })
  assertCompleteStreamEvidence({
    stream: integrity.streams?.traceLog,
    streamLabel: "TRACE LOG",
    expectedRuntimeId,
    manifestFiles,
  })
  assertNoRuntimeMismatches({
    integrity,
    expectedRuntimeId,
  })
}

async function readArchiveRecoveryFacts({ directory } = {}) {
  const factsContent = await readFile(path.join(directory, "recovery-facts", "facts.jsonl"), "utf8")
  const checkpointContent = await readFile(path.join(directory, "recovery-facts", "manifest.jsonl"), "utf8")
  const factLines = factsContent.split("\n").filter((line) => line.length > 0)
  const checkpointLines = checkpointContent.split("\n").filter((line) => line.length > 0)
  if (factLines.length === 0 || checkpointLines.length === 0 || factLines.length !== checkpointLines.length) {
    throw new Error("Recovery-facts evidence is missing or has an incomplete committed checkpoint.")
  }
  const facts = factLines.map((line) => JSON.parse(line))
  const checkpoints = checkpointLines.map((line) => JSON.parse(line))
  const dataCommitHash = (await readFile(path.join(directory, "data_commit_hash"), "utf8")).trim()
  return {
    facts,
    checkpoints,
    factCount: factLines.length,
    dataCommitHash,
  }
}

function assertRecoveryCheckpointIntegrity({ facts, checkpoints, factCount, dataCommitHash, manifest } = {}) {
  const latestFact = facts.at(-1)
  const latestCheckpoint = checkpoints.at(-1)
  const checkpointMatches = latestFact.digest === latestCheckpoint.lastCommittedDigest
    && String(latestFact.sequence) === String(latestCheckpoint.sequence)
    && Number(latestCheckpoint.recordCount) === factCount
    && latestCheckpoint.lastCommittedDigest === dataCommitHash
    && manifest.dataCommitHash === dataCommitHash
  if (!checkpointMatches) {
    throw new Error("Recovery-facts manifest, data_commit_hash and final fact record do not identify the same committed checkpoint.")
  }
}

function assertManifestRecoveryRuntimeIdentity({ facts, manifest } = {}) {
  const latestFact = facts.at(-1)
  const expectedRuntimeId = latestFact.runtimeSessionId
  if (manifest.recoveryRuntimeSessionId !== expectedRuntimeId) {
    throw new Error(`Debug archive runtime identity does not match the latest committed recovery-facts runtime: expected=${expectedRuntimeId}; manifest=${manifest.recoveryRuntimeSessionId}.`)
  }
  const processStartFacts = facts.filter((fact) => fact.factType === "PROCESS_STARTED" && fact.runtimeSessionId === expectedRuntimeId)
  if (processStartFacts.length !== 1) {
    throw new Error(`Recovery-facts process identity is missing or ambiguous for runtime ${expectedRuntimeId}: PROCESS_STARTED facts=${processStartFacts.length}.`)
  }
  const processIdentity = processStartFacts[0].data?.processIdentity
  if (processIdentity?.runtimeSessionId !== expectedRuntimeId) {
    throw new Error(`Durable PROCESS_STARTED identity does not prove ownership of recovery runtime ${expectedRuntimeId}.`)
  }
  if (JSON.stringify(manifest.tradingRuntime?.processIdentity) !== JSON.stringify(processIdentity)) {
    throw new Error(`Archive tradingRuntime process identity does not match the authoritative PROCESS_STARTED recovery fact for runtime ${expectedRuntimeId}.`)
  }
}

async function validateRecoveryFactsRuntime({ directory, manifest } = {}) {
  const recoveryFacts = await readArchiveRecoveryFacts({ directory })
  assertRecoveryCheckpointIntegrity({
    ...recoveryFacts,
    manifest,
  })
  assertManifestRecoveryRuntimeIdentity({
    facts: recoveryFacts.facts,
    manifest,
  })
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
  await validateRecoveryFactsRuntime({
    directory,
    manifest,
  })
  await validateSessionLifecycleEvidence({
    directory,
    manifest,
  })
  validateEvidenceIntegrity(manifest)
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

// This entry point intentionally accepts only a completed archive and publication settings.
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
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), ".harvester-debug-publish-"))
  const immutableSnapshot = path.join(temporaryRoot, archiveName)
  try {
    await mkdir(immutableSnapshot, {
      recursive: false,
      mode: 0o700,
    })
    await copyRegularTree({
      sourceDirectory: directory,
      destinationDirectory: immutableSnapshot,
    })
    await validateCompletedArchive(immutableSnapshot)
    const published = await publishArchiveFn({
      directory: immutableSnapshot,
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
  } finally {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    })
  }
}
