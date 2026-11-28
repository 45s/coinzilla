import { createHash, randomUUID } from "node:crypto"
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { spawn } from "node:child_process"
import { createReadStream, createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { createGzip } from "node:zlib"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { captureBuildMetadata } from "@coinzilla/utils"
import packageMetadata from "../package.json" with { type: "json" }
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-directory.js"
import { assertHarvesterProcessStopped } from "./assert-harvester-process-stopped.js"

const PACKAGE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_DIRECTORIES = Object.freeze(["logs", "recovery-facts"])
const EXCLUDED_ARCHIVE_PATHS = Object.freeze(["data/** (all databases and backups)", "logs/cumulative/**"])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateArchiveRemote(remote) {
  if (typeof remote !== "string" || remote.trim() !== remote || remote.length === 0) {
    throw new TypeError("HARVESTER_ARCHIVE_REMOTE must be a non-empty GitHub repository URL.")
  }
  const supportedRemote = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/
  if (!supportedRemote.test(remote)) {
    throw new TypeError("HARVESTER_ARCHIVE_REMOTE must be an HTTPS GitHub repository URL.")
  }
  return remote
}

const runGitDefault = (...parameters) => {
  const [args, { cwd } = {}] = parameters
  return new Promise((...callbacks) => {
    const [resolve, reject] = callbacks
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    const streamProgress = args[0] === "clone" || args[0] === "push"

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => {
      if (streamProgress) {
        process.stderr.write(chunk)
      } else {
        stderr += chunk
      }
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(
        `git ${args[0]} failed with exit code ${code}: ${stderr.trim()}`,
      ))
    })
  })
}

const formatBytes = (bytes) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const reportProgress = (...parameters) => {
  const [onProgress, message] = parameters
  onProgress?.(message)
}

const getTreeSize = async (directory) => {
  const files = await listRegularFiles({ directory })
  let totalBytes = 0
  for (const relativePath of files) {
    totalBytes += (await stat(path.join(directory, relativePath))).size
  }
  return {
    files,
    totalBytes,
  }
}

export function createHarvesterArchiveDirectoryName({ createdAt, archiveId } = {}) {
  if (
    typeof createdAt !== "string"
    || Number.isNaN(Date.parse(createdAt))
    || new Date(createdAt).toISOString() !== createdAt
  ) {
    throw new TypeError("Archive creation time must be a valid UTC ISO timestamp.")
  }
  if (!UUID_PATTERN.test(archiveId ?? "")) {
    throw new TypeError("Archive ID must be a valid UUID.")
  }
  const timestamp = createdAt.replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-")
  return `${timestamp}_${archiveId.slice(0, 8)}_debug`
}

async function assertRealDirectory(directory) {
  const directoryStats = await lstat(directory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error(`Expected a real directory, not a symbolic link: ${directory}`)
  }
}

async function copyStableFile({ sourcePath, destinationPath } = {}) {
  const before = await lstat(sourcePath)
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Refusing to snapshot a non-regular file: ${sourcePath}`)
  }
  const sourceSha256Before = await sha256File(sourcePath)
  const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`
  try {
    await copyFile(sourcePath, temporaryPath)
    const after = await lstat(sourcePath)
    const sourceSha256After = await sha256File(sourcePath)
    const copiedSha256 = await sha256File(temporaryPath)
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
      || sourceSha256Before !== sourceSha256After
      || sourceSha256Before !== copiedSha256
    ) {
      throw new Error(`Source file changed while the debug snapshot was being collected: ${sourcePath}`)
    }
    const copied = await lstat(temporaryPath)
    if (copied.size !== after.size) {
      throw new Error(`Snapshot copy size changed while collecting: ${sourcePath}`)
    }
    await rename(temporaryPath, destinationPath)
    return after.size
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

async function copyRegularTree({
  sourceDirectory,
  destinationDirectory,
  relative = "",
  onFileCopied,
} = {}) {
  const source = relative ? path.join(sourceDirectory, relative) : sourceDirectory
  const destination = relative ? path.join(destinationDirectory, relative) : destinationDirectory
  await mkdir(destination, {
    recursive: true,
    mode: 0o700,
  })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    const sourceStats = await lstat(sourcePath)
    if (sourceStats.isSymbolicLink()) {
      throw new Error(`Refusing to archive a symbolic link: ${sourcePath}`)
    }
    if (sourceStats.isDirectory()) {
      await mkdir(destinationPath, {
        recursive: false,
        mode: 0o700,
      })
      await copyRegularTree({
        sourceDirectory,
        destinationDirectory,
        relative: path.join(relative, entry.name),
        onFileCopied,
      })
    } else if (sourceStats.isFile()) {
      const copiedSize = await copyStableFile({
        sourcePath,
        destinationPath,
      })
      await onFileCopied?.({
        relativePath: path.join(relative, entry.name).split(path.sep).join("/"),
        size: copiedSize,
      })
    } else {
      throw new Error(`Refusing to archive a non-regular session entry: ${sourcePath}`)
    }
  }
}

async function copyCompressedFile({
  sourcePath,
  destinationPath,
  childRelative,
  onFileCopied,
} = {}) {
  const sourceBefore = await lstat(sourcePath)
  if (sourceBefore.isSymbolicLink() || !sourceBefore.isFile()) {
    throw new Error(`Refusing to compress a non-regular source file: ${sourcePath}`)
  }
  const sourceSha256Before = await sha256File(sourcePath)
  const compressedRelative = `${childRelative}.gz`
  const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`
  let sourceSha256After
  try {
    await pipeline(
      createReadStream(sourcePath),
      createGzip({ level: 6 }),
      createWriteStream(temporaryPath, {
        flags: "wx",
        mode: 0o600,
      }),
    )
    const sourceAfter = await lstat(sourcePath)
    sourceSha256After = await sha256File(sourcePath)
    const sourceChanged = sourceSha256Before !== sourceSha256After
      || sourceAfter.isSymbolicLink()
      || !sourceAfter.isFile()
      || sourceBefore.dev !== sourceAfter.dev
      || sourceBefore.ino !== sourceAfter.ino
      || sourceBefore.size !== sourceAfter.size
      || sourceBefore.mtimeMs !== sourceAfter.mtimeMs
      || sourceBefore.ctimeMs !== sourceAfter.ctimeMs
    if (sourceChanged) {
      throw new Error(`Source file changed while the debug snapshot was being collected: ${sourcePath}`)
    }
    await rename(temporaryPath, destinationPath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
  const archiveStats = await stat(destinationPath)
  await onFileCopied?.({
    relativePath: compressedRelative.split(path.sep).join("/"),
    sourceRelativePath: childRelative.split(path.sep).join("/"),
    sourceSize: sourceBefore.size,
    sourceSha256: sourceSha256After,
    size: archiveStats.size,
    archiveSha256: await sha256File(destinationPath),
  })
}

async function copyCompressedTree({
  sourceDirectory,
  destinationDirectory,
  relative = "",
  onFileCopied,
} = {}) {
  const source = relative ? path.join(sourceDirectory, relative) : sourceDirectory
  const destination = relative ? path.join(destinationDirectory, relative) : destinationDirectory
  await mkdir(destination, {
    recursive: true,
    mode: 0o700,
  })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const sourcePath = path.join(sourceDirectory, childRelative)
    const sourceStats = await lstat(sourcePath)
    if (sourceStats.isSymbolicLink()) {
      throw new Error(`Refusing to archive a symbolic link: ${sourcePath}`)
    }
    if (sourceStats.isDirectory()) {
      await copyCompressedTree({
        sourceDirectory,
        destinationDirectory,
        relative: childRelative,
        onFileCopied,
      })
    } else if (sourceStats.isFile()) {
      await copyCompressedFile({
        sourcePath,
        destinationPath: path.join(destinationDirectory, `${childRelative}.gz`),
        childRelative,
        onFileCopied,
      })
    } else {
      throw new Error(`Refusing to archive a non-regular session entry: ${sourcePath}`)
    }
  }
}

async function readRegularJsonFile(filename) {
  const fileStats = await lstat(filename)
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    return null
  }
  return JSON.parse(await readFile(filename, "utf8"))
}

async function readOptionalSessionJson(filename) {
  try {
    return {
      value: await readRegularJsonFile(filename),
      error: null,
    }
  } catch (error) {
    return {
      value: null,
      error,
    }
  }
}

function resolveProcessOutcome(completion) {
  if (completion?.signal) {
    return {
      status: "signaled",
      exitCode: Number.isSafeInteger(completion.exitCode) ? completion.exitCode : null,
      signal: completion.signal,
    }
  }
  if (Number.isSafeInteger(completion?.exitCode)) {
    return {
      status: completion.exitCode === 0 ? "success" : "failed",
      exitCode: completion.exitCode,
      signal: null,
    }
  }
  return {
    status: "unknown",
    exitCode: null,
    signal: null,
  }
}

function createProcessIdentityMissingFieldWarnings({ identity, identityError } = {}) {
  const warnings = []
  if (!identity) {
    warnings.push(identityError?.code && identityError.code !== "ENOENT" ? "PROCESS_IDENTITY_INVALID" : "PROCESS_IDENTITY_MISSING")
    return warnings
  }
  if (!UUID_PATTERN.test(identity.runtimeSessionId ?? "")) {
    warnings.push("RUNTIME_SESSION_ID_MISSING")
  }
  if (!identity.startedAt) {
    warnings.push("START_TIMESTAMP_MISSING")
  }
  const sourceCommit = identity.source?.commit
  if (!sourceCommit || !/^[a-f0-9]{40,64}$/i.test(sourceCommit)) {
    warnings.push("SOURCE_REVISION_MISSING")
  }
  const workingTree = identity.source?.workingTree
  if (!["clean", "dirty"].includes(workingTree)) {
    warnings.push("WORKTREE_STATE_MISSING")
  }
  return warnings
}

function createCompletionMissingFieldWarnings({ identity, completion, completionError } = {}) {
  const warnings = []
  if (!completion) {
    warnings.push(completionError?.code && completionError.code !== "ENOENT" ? "COMPLETION_RECORD_INVALID" : "COMPLETION_RECORD_MISSING")
    return warnings
  }
  if (identity?.runtimeSessionId && completion.runtimeSessionId !== identity.runtimeSessionId) {
    warnings.push("COMPLETION_RUNTIME_ID_MISMATCH")
  }
  if (completion.logStreamsComplete !== true) {
    warnings.push("LOG_STREAMS_INCOMPLETE")
  }
  return warnings
}

function createArchiveSessionMissingFieldWarnings({
  identity,
  completion,
  identityError,
  completionError,
} = {}) {
  return [
    ...createProcessIdentityMissingFieldWarnings({
      identity,
      identityError,
    }),
    ...createCompletionMissingFieldWarnings({
      identity,
      completion,
      completionError,
    }),
  ]
}


function isHarvesterTestnetSession({ identity } = {}) {
  return identity?.application === "harvester" &&
    identity?.formatVersion === 1 &&
    identity?.environment === "testnet"
}

function resolveArchiveSessionCompletionStatus({ identity, completion, isHarvesterTestnet } = {}) {
  if (!identity) {
    return "identity-missing"
  }
  if (!isHarvesterTestnet) {
    return "non-testnet-or-invalid"
  }
  if (completion?.runtimeSessionId === identity.runtimeSessionId && completion?.logStreamsComplete === true) {
    return "complete"
  }
  return "incomplete"
}

function resolveArchiveSessionProcessId({ identity, recoveryCheckpoint } = {}) {
  if (Number.isSafeInteger(identity?.processId) && identity.processId > 0) {
    return identity.processId
  }
  if (identity?.runtimeSessionId === recoveryCheckpoint.runtimeSessionId) {
    return recoveryCheckpoint.processIdentity?.processId ?? null
  }
  return null
}

function resolveArchiveSessionRuntimeSessionId(identity) {
  const runtimeSessionId = identity?.runtimeSessionId
  return UUID_PATTERN.test(runtimeSessionId ?? "") ? runtimeSessionId : null
}

function resolveArchiveSessionStartTimestamp(identity) {
  return typeof identity?.startedAt === "string" ? identity.startedAt : null
}

function resolveArchiveSessionEndTimestamp(completion) {
  return typeof completion?.endedAt === "string" ? completion.endedAt : null
}

function createArchiveSessionEvidenceRecord({
  sessionName,
  identity,
  completion,
  processId,
  missingFieldWarnings,
  isHarvesterTestnet,
} = {}) {
  return {
    sessionName,
    relativePath: `logs/sessions/${sessionName}`,
    environment: identity?.environment ?? "unknown",
    runtimeSessionId: resolveArchiveSessionRuntimeSessionId(identity),
    processId,
    startedAt: resolveArchiveSessionStartTimestamp(identity),
    endedAt: resolveArchiveSessionEndTimestamp(completion),
    sourceRevision: identity?.source?.commit ?? null,
    workingTreeState: identity?.source?.workingTree ?? "unknown",
    completionStatus: resolveArchiveSessionCompletionStatus({
      identity,
      completion,
      isHarvesterTestnet,
    }),
    processOutcome: resolveProcessOutcome(completion),
    missingFieldWarnings,
    include: isHarvesterTestnet,
  }
}

async function readArchiveSessionEvidence({ sessionsDirectory, sessionName, recoveryCheckpoint }) {
  const sessionDirectory = path.join(sessionsDirectory, sessionName)
  const [identityResult, completionResult] = await Promise.all([
    readOptionalSessionJson(path.join(sessionDirectory, "process-identity.json")),
    readOptionalSessionJson(path.join(sessionDirectory, "process-completed.json")),
  ])
  const { value: identity, error: identityError } = identityResult
  const { value: completion, error: completionError } = completionResult
  const isHarvesterTestnet = isHarvesterTestnetSession({ identity })
  const processId = resolveArchiveSessionProcessId({
    identity,
    recoveryCheckpoint,
  })
  const missingFieldWarnings = createArchiveSessionMissingFieldWarnings({
    identity,
    completion,
    identityError,
    completionError,
  })
  if (isHarvesterTestnet && processId === null) {
    missingFieldWarnings.push("PROCESS_ID_MISSING")
  }
  return createArchiveSessionEvidenceRecord({
    sessionName,
    identity,
    completion,
    processId,
    missingFieldWarnings,
    isHarvesterTestnet,
  })
}


async function readArchiveSessionInventory({ sessionsDirectory, recoveryCheckpoint } = {}) {
  const sessionNames = (await readdir(sessionsDirectory)).sort()
  const sessions = []
  for (const sessionName of sessionNames) {
    const entryPath = path.join(sessionsDirectory, sessionName)
    const entryStats = await lstat(entryPath)
    if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
      throw new Error(`Expected logs/sessions/${sessionName} to be a real directory.`)
    }
    sessions.push(await readArchiveSessionEvidence({
      sessionsDirectory,
      sessionName,
      recoveryCheckpoint,
    }))
  }
  return sessions
}


function findMatchingArchiveSessions({ sessions, recoveryCheckpoint } = {}) {
  return sessions.filter((session) =>
    session.include && session.runtimeSessionId === recoveryCheckpoint.runtimeSessionId
  )
}

function resolveArchiveLogSelectionStatus({ sessions, matchingRuntimeSessions } = {}) {
  if (matchingRuntimeSessions.length > 1) {
    return "ambiguous"
  }
  if (matchingRuntimeSessions.length === 1) {
    if (matchingRuntimeSessions[0].completionStatus === "complete") {
      return "matched"
    }
    return "incomplete"
  }
  return sessions.some((session) => session.include) ? "mismatched" : "missing"
}

function resolveArchiveLogSelectionReason({ status } = {}) {
  if (status === "matched") {
    return "exact-runtime-id-match"
  }
  if (status === "ambiguous") {
    return "multiple-exact-runtime-candidates"
  }
  if (status === "incomplete") {
    return "matching-runtime-session-incomplete"
  }
  return "no-exact-runtime-session"
}

function assignArchiveSessionSelectionReasons({ sessions, recoveryCheckpoint, status, matchingTradingLogsAvailable } = {}) {
  for (const session of sessions) {
    if (!session.include) {
      session.selectionReason = session.completionStatus === "identity-missing"
        ? "identity-unavailable"
        : "excluded-non-testnet"
      continue
    }
    if (session.runtimeSessionId === recoveryCheckpoint.runtimeSessionId) {
      if (status === "matched") {
        session.selectionReason = "exact-runtime-id-match"
      } else if (status === "ambiguous") {
        session.selectionReason = "ambiguous-runtime-id-candidate"
      } else {
        session.selectionReason = "matching-runtime-session-incomplete"
      }
      continue
    }
    session.selectionReason = matchingTradingLogsAvailable
      ? "independent-evidence-not-selected"
      : "independent-evidence-no-runtime-match"
  }
}

function createArchiveLogSelectionWarnings({ sessions, recoveryCheckpoint, status } = {}) {
  const warnings = [...recoveryCheckpoint.processIdentityWarnings]
  if (status === "ambiguous") {
    warnings.push({
      code: "MULTIPLE_MATCHING_LOG_SESSIONS",
      message: "Multiple TESTNET log sessions carry the recovery-facts runtime ID; none is selected as the unique matching session.",
    })
  } else if (status === "incomplete") {
    warnings.push({
      code: "MATCHING_LOG_SESSION_INCOMPLETE",
      message: "A log session has the recovery-facts runtime ID, but its completion record does not prove complete log streams.",
    })
  } else if (status !== "matched") {
    warnings.push({
      code: "NO_MATCHING_TRADING_LOG_SESSION",
      message: `No unique complete TESTNET log session matches recovery runtime ${recoveryCheckpoint.runtimeSessionId}.`,
    })
  }
  for (const session of sessions) {
    for (const warningCode of session.missingFieldWarnings) {
      warnings.push({
        code: `SESSION_${warningCode}`,
        sessionName: session.sessionName,
        runtimeSessionId: session.runtimeSessionId,
        message: `Session ${session.sessionName} has missing or incomplete evidence: ${warningCode}.`,
      })
    }
  }
  return warnings
}

async function findArchiveLogSessionSelection({ sessionsDirectory, recoveryCheckpoint } = {}) {
  const sessions = await readArchiveSessionInventory({
    sessionsDirectory,
    recoveryCheckpoint,
  })
  const matchingRuntimeSessions = findMatchingArchiveSessions({
    sessions,
    recoveryCheckpoint,
  })
  const status = resolveArchiveLogSelectionStatus({
    sessions,
    matchingRuntimeSessions,
  })
  const matchingTradingLogsAvailable = status === "matched"
  assignArchiveSessionSelectionReasons({
    sessions,
    recoveryCheckpoint,
    status,
    matchingTradingLogsAvailable,
  })
  return {
    sessions,
    matchingSessionCandidates: matchingRuntimeSessions.map(({ sessionName }) => sessionName),
    matchingTradingLogsAvailable,
    logRuntimeSessionId: matchingTradingLogsAvailable ? recoveryCheckpoint.runtimeSessionId : null,
    status,
    selectionReason: resolveArchiveLogSelectionReason({ status }),
    warnings: createArchiveLogSelectionWarnings({
      sessions,
      recoveryCheckpoint,
      status,
    }),
    unmatchedRuntimeSessionId: matchingTradingLogsAvailable ? null : recoveryCheckpoint.runtimeSessionId,
  }
}


async function copySelectedLogs({
  sourceDirectory,
  destinationDirectory,
  recoveryCheckpoint,
  onFileCopied,
} = {}) {
  await mkdir(destinationDirectory, {
    recursive: true,
    mode: 0o700,
  })
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  const unsupportedEntries = entries.filter((entry) => !["sessions", "cumulative"].includes(entry.name))
  if (unsupportedEntries.length > 0) {
    throw new Error("The logs root contains unsupported entries; refusing to archive unclassified log data.")
  }
  for (const entry of entries) {
    const entryPath = path.join(sourceDirectory, entry.name)
    const entryStats = await lstat(entryPath)
    if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
      throw new Error(`Expected logs/${entry.name} to be a real directory.`)
    }
  }
  const sessionsEntry = entries.find((entry) => entry.name === "sessions")
  if (!sessionsEntry) {
    throw new Error("The logs/sessions directory is missing; refusing to publish an archive without session evidence.")
  }
  const selection = await findArchiveLogSessionSelection({
    sessionsDirectory: path.join(sourceDirectory, "sessions"),
    recoveryCheckpoint,
  })
  const artifactProvenance = []
  for (const session of selection.sessions.filter(({ include }) => include)) {
    await copyCompressedTree({
      sourceDirectory,
      destinationDirectory,
      relative: path.join("sessions", session.sessionName),
      onFileCopied: async (artifact) => {
        const sourcePath = `logs/${artifact.sourceRelativePath}`
        const archivePath = `logs/${artifact.relativePath}`
        artifactProvenance.push({
          sourcePath,
          archivePath,
          sourceSize: artifact.sourceSize,
          sourceSha256: artifact.sourceSha256,
          archiveSha256: artifact.archiveSha256,
        })
        await onFileCopied?.(artifact)
      },
    })
  }
  return {
    ...selection,
    artifactProvenance,
  }
}


export async function listRegularFiles({ directory, relative = "" } = {}) {
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
      files.push(...await listRegularFiles({
        directory,
        relative: childRelative,
      }))
    } else if (fileStats.isFile()) {
      files.push(childRelative.split(path.sep).join("/"))
    } else {
      throw new Error(`Archive contains a non-regular file: ${filename}`)
    }
  }
  return files.sort()
}

async function sha256File(filename) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

async function readRecoveryFactLines({ recoveryFactsDirectory } = {}) {
  const manifestContent = await readFile(path.join(recoveryFactsDirectory, "manifest.jsonl"), "utf8")
  const factsContent = await readFile(path.join(recoveryFactsDirectory, "facts.jsonl"), "utf8")
  const manifestLines = manifestContent.split("\n").filter((line) => line.length > 0)
  const factLines = factsContent.split("\n").filter((line) => line.length > 0)
  if (manifestLines.length === 0 || factLines.length === 0) {
    throw new Error("Recovery-facts manifest and facts ledger must both contain committed records.")
  }
  return {
    manifestLines,
    factLines,
  }
}

function parseRecoveryFactLines({ manifestLines, factLines } = {}) {
  try {
    return {
      latestManifest: JSON.parse(manifestLines.at(-1)),
      facts: factLines.map((line) => JSON.parse(line)),
    }
  } catch (error) {
    throw new Error("A recovery-facts manifest/fact record is not valid JSON.", { cause: error })
  }
}

function validateRecoveryFactsCheckpoint({ manifestLines, factLines, latestManifest, latestFact } = {}) {
  const dataCommitHash = latestManifest.lastCommittedDigest
  const isValidDigest = typeof dataCommitHash === "string" && /^[a-f0-9]{64}$/i.test(dataCommitHash)
  const manifestMatches = latestFact.digest === dataCommitHash &&
    String(latestManifest.sequence) === String(latestFact.sequence) &&
    manifestLines.length === factLines.length &&
    Number(latestManifest.recordCount) === factLines.length
  if (!isValidDigest || !manifestMatches || !UUID_PATTERN.test(latestFact.runtimeSessionId ?? "")) {
    throw new Error("The latest recovery-facts manifest does not match the final committed fact record.")
  }
  return dataCommitHash
}

function resolveRecoveryProcessIdentity({ facts, runtimeSessionId } = {}) {
  const processStartFacts = facts.filter((fact) =>
    fact.factType === "PROCESS_STARTED" && fact.runtimeSessionId === runtimeSessionId
  )
  let processIdentity = null
  const warnings = []
  if (processStartFacts.length > 1) {
    warnings.push({
      code: "TRADING_RUNTIME_PROCESS_IDENTITY_AMBIGUOUS",
      message: "More than one PROCESS_STARTED fact is bound to the latest recovery-facts runtime.",
    })
  } else if (processStartFacts.length === 0) {
    warnings.push({
      code: "TRADING_RUNTIME_PROCESS_IDENTITY_MISSING",
      message: "No durable process identity is available for the latest recovery-facts runtime.",
    })
  } else {
    processIdentity = processStartFacts[0].data?.processIdentity ?? null
    if (processIdentity === null) {
      warnings.push({
        code: "TRADING_RUNTIME_PROCESS_IDENTITY_MISSING",
        message: "No durable process identity is available for the latest recovery-facts runtime.",
      })
    }
  }
  if (!processIdentity?.source?.commit) {
    warnings.push({
      code: "TRADING_RUNTIME_SOURCE_REVISION_MISSING",
      message: "The durable process-start evidence does not establish the source revision.",
    })
  }
  if (!processIdentity?.source?.workingTree || processIdentity.source.workingTree === "unknown") {
    warnings.push({
      code: "TRADING_RUNTIME_WORKTREE_STATE_MISSING",
      message: "The durable process-start evidence does not establish whether the source worktree was clean or dirty.",
    })
  }
  return {
    processIdentity,
    processIdentityWarnings: warnings,
  }
}

async function readLatestRecoveryCheckpoint(recoveryFactsDirectory) {
  const { manifestLines, factLines } = await readRecoveryFactLines({ recoveryFactsDirectory })
  const { latestManifest, facts } = parseRecoveryFactLines({
    manifestLines,
    factLines,
  })
  const latestFact = facts.at(-1)
  const dataCommitHash = validateRecoveryFactsCheckpoint({
    manifestLines,
    factLines,
    latestManifest,
    latestFact,
  })
  const { processIdentity, processIdentityWarnings } = resolveRecoveryProcessIdentity({
    facts,
    runtimeSessionId: latestFact.runtimeSessionId,
  })
  return {
    dataCommitHash,
    runtimeSessionId: latestFact.runtimeSessionId,
    sequence: String(latestFact.sequence),
    processIdentity,
    processIdentityWarnings,
  }
}


async function createArchiveFileEntries({
  directory,
  files,
  artifactProvenance,
  totalBytes,
  onFileHashed,
} = {}) {
  const provenanceByArchivePath = new Map(artifactProvenance.map((artifact) => [artifact.archivePath, artifact]))
  const entries = []
  let completedBytes = 0
  for (const relativePath of files) {
    const filename = path.join(directory, relativePath)
    const fileStats = await stat(filename)
    const provenance = provenanceByArchivePath.get(relativePath)
    entries.push({
      path: relativePath,
      size: fileStats.size,
      sha256: await sha256File(filename),
      ...(provenance ? { sourcePath: provenance.sourcePath } : {}),
    })
    completedBytes += fileStats.size
    await onFileHashed?.({
      relativePath,
      completedFiles: entries.length,
      totalFiles: files.length,
      completedBytes,
      totalBytes,
    })
  }
  return entries
}

function createDuplicateArchiveArtifactGroups({ artifactProvenance } = {}) {
  const groups = new Map()
  for (const artifact of artifactProvenance) {
    const group = groups.get(artifact.sourceSha256) ?? {
      sourceSha256: artifact.sourceSha256,
      sourceSize: artifact.sourceSize,
      sourcePaths: [],
      archivePaths: [],
      archiveSha256s: [],
    }
    group.sourcePaths.push(artifact.sourcePath)
    group.archivePaths.push(artifact.archivePath)
    group.archiveSha256s.push(artifact.archiveSha256)
    groups.set(artifact.sourceSha256, group)
  }
  return [...groups.values()]
    .filter((group) => group.sourcePaths.length > 1)
    .map((group) => ({
      ...group,
      sourcePaths: group.sourcePaths.sort(),
      archivePaths: group.archivePaths.sort(),
      archiveSha256s: group.archiveSha256s.sort(),
    }))
}

function createArchiveSessionManifestEntry({ session } = {}) {
  return {
    sessionName: session.sessionName,
    relativePath: session.relativePath,
    environment: session.environment,
    runtimeSessionId: session.runtimeSessionId,
    processId: session.processId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    sourceRevision: session.sourceRevision,
    workingTreeState: session.workingTreeState,
    completionStatus: session.completionStatus,
    processOutcome: session.processOutcome,
    selectionReason: session.selectionReason,
    missingFieldWarnings: session.missingFieldWarnings,
  }
}

function createTradingRuntimeManifestEntry({ recoveryCheckpoint } = {}) {
  const { processIdentity } = recoveryCheckpoint
  return {
    runtimeSessionId: recoveryCheckpoint.runtimeSessionId,
    processIdentity,
    processId: processIdentity?.processId ?? null,
    startedAt: processIdentity?.startedAt ?? null,
    sourceRevision: processIdentity?.source?.commit ?? null,
    workingTreeState: processIdentity?.source?.workingTree ?? "unknown",
    missingFieldWarnings: recoveryCheckpoint.processIdentityWarnings.map(({ code }) => code),
  }
}

async function createArchiveManifest({
  directory,
  createdAt,
  logSelection,
  artifactProvenance = [],
  onFileHashed,
} = {}) {
  const files = await listRegularFiles({ directory })
  const { totalBytes } = await getTreeSize(directory)
  const entries = await createArchiveFileEntries({
    directory,
    files,
    artifactProvenance,
    totalBytes,
    onFileHashed,
  })
  const recoveryCheckpoint = await readLatestRecoveryCheckpoint(path.join(directory, "recovery-facts"))
  const dataCommitHash = (await readFile(path.join(directory, "data_commit_hash"), "utf8")).trim()
  return {
    formatVersion: 1,
    application: "harvester",
    commandTradingMode: "testnet",
    snapshotType: "runtime-correlated-log-evidence",
    createdAt,
    includedDirectories: [...SOURCE_DIRECTORIES],
    excludedPaths: [...EXCLUDED_ARCHIVE_PATHS],
    logSelection: {
      cumulative: "excluded",
      sessions: "all-identified-TESTNET-sessions-preserved-independently; exact-runtime-id-match-required; gzip-compressed",
      selectionReason: logSelection.selectionReason,
    },
    dataCommitHash,
    logRuntimeSessionId: logSelection.logRuntimeSessionId,
    recoveryRuntimeSessionId: recoveryCheckpoint.runtimeSessionId,
    matchingTradingLogsAvailable: logSelection.matchingTradingLogsAvailable,
    matchingSessionCandidates: logSelection.matchingSessionCandidates,
    runtimeIdentity: {
      status: logSelection.status,
      correlation: logSelection.status === "matched"
        ? "same-runtime-session"
        : "independent-evidence-do-not-correlate",
    },
    tradingRuntime: createTradingRuntimeManifestEntry({ recoveryCheckpoint }),
    sessionInventory: logSelection.sessions.map((session) => createArchiveSessionManifestEntry({ session })),
    warnings: logSelection.warnings,
    duplicateArtifacts: createDuplicateArchiveArtifactGroups({ artifactProvenance }),
    recoveryFactSequence: recoveryCheckpoint.sequence,
    files: entries,
  }
}


export async function verifyArchive({ directory, manifest } = {}) {
  const expectedPaths = manifest.files.map((entry) => entry.path).sort()
  const actualPaths = (await listRegularFiles({ directory }))
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

async function createRemoteArchiveDirectory({ checkout, archiveName } = {}) {
  const remoteDirectory = path.join(checkout, "archives", archiveName)
  try {
    await mkdir(remoteDirectory, {
      recursive: false,
      mode: 0o700,
    })
    return {
      directory: remoteDirectory,
      alreadyExists: false,
    }
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error
    }
    const existingStats = await lstat(remoteDirectory)
    if (existingStats.isSymbolicLink() || !existingStats.isDirectory()) {
      throw new Error(`Remote archive destination is not a regular directory: archives/${archiveName}`, {
        cause: error,
      })
    }
    return {
      directory: remoteDirectory,
      alreadyExists: true,
    }
  }
}

async function verifyRemoteArchiveFiles({ directory, archiveName, localFiles, checkout, runGit } = {}) {
  for (const relativePath of localFiles) {
    const localBlob = await runGit(["hash-object", path.join(directory, relativePath)])
    const remotePath = `HEAD:archives/${archiveName}/${relativePath.split(path.sep).join("/")}`
    const remoteBlob = await runGit(["rev-parse", remotePath], { cwd: checkout })
    if (localBlob !== remoteBlob) {
      throw new Error(`Remote archive content verification failed: ${relativePath}`)
    }
  }
}

async function verifyExistingArchive({
  directory,
  archiveName,
  remote,
  runGit,
  checkout,
  onProgress,
} = {}) {
  const localFiles = await listRegularFiles({ directory })
  const remoteFilesOutput = await runGit(
    ["ls-tree", "-r", "--name-only", "HEAD", "--", `archives/${archiveName}`],
    { cwd: checkout },
  )
  const remotePrefix = `archives/${archiveName}/`
  const remoteFiles = remoteFilesOutput
    ? remoteFilesOutput.split("\n").map((filename) => filename.slice(remotePrefix.length)).sort()
    : []
  if (JSON.stringify(localFiles) !== JSON.stringify(remoteFiles)) {
    throw new Error("Remote archive already exists with a different file inventory; refusing to overwrite.")
  }
  await verifyRemoteArchiveFiles({
    directory,
    archiveName,
    localFiles,
    checkout,
    runGit,
  })
  const existingCommit = await runGit(["rev-parse", "HEAD"], { cwd: checkout })
  const remoteHead = await runGit(["ls-remote", "--heads", remote, "refs/heads/main"])
  if (remoteHead.split(/\s+/)[0] !== existingCommit) {
    throw new Error("The archive exists in the cloned remote history, but remote main advanced during verification.")
  }
  reportProgress(onProgress, "Publishing: existing archive verified; no upload needed.")
  return {
    commit: existingCommit,
    fileCount: localFiles.length,
    alreadyPublished: true,
  }
}

async function publishNewArchive({
  directory,
  archiveName,
  remote,
  runGit,
  checkout,
  remoteArchiveDirectory,
  onProgress,
} = {}) {
  await copyRegularTree({
    sourceDirectory: directory,
    destinationDirectory: remoteArchiveDirectory,
  })
  reportProgress(onProgress, "Publishing: copied archive into checkout; staging files...")
  await runGit(["add", "--", `archives/${archiveName}`], { cwd: checkout })
  await runGit([
    "-c", "user.name=Coinzilla Harvester",
    "-c", "user.email=harvester-archive@users.noreply.github.com",
    "commit", "-m", `chore(archive): add Harvester debug session ${archiveName}`,
  ], { cwd: checkout })
  const localCommit = await runGit(["rev-parse", "HEAD"], { cwd: checkout })
  reportProgress(onProgress, "Publishing: pushing to GitHub (Git transfer progress follows)...")
  await runGit(["push", "--progress", "origin", "main"], { cwd: checkout })
  reportProgress(onProgress, "Publishing: push finished; verifying remote commit and file contents...")
  const remoteHead = await runGit(["ls-remote", "--heads", remote, "refs/heads/main"])
  if (remoteHead.split(/\s+/)[0] !== localCommit) {
    throw new Error("The archive push completed but remote main does not point to the published commit.")
  }
  const localFiles = await listRegularFiles({ directory })
  await verifyRemoteArchiveFiles({
    directory,
    archiveName,
    localFiles,
    checkout,
    runGit,
  })
  return {
    commit: localCommit,
    fileCount: localFiles.length,
    alreadyPublished: false,
  }
}

export async function publishArchive({
  directory,
  archiveName,
  remote,
  runGit = runGitDefault,
  createTemporaryDirectory = (prefix) => mkdtemp(path.join(os.tmpdir(), prefix)),
  removeTemporaryDirectory = (filename) => rm(filename, {
    recursive: true,
    force: true,
  }),
  onProgress,
} = {}) {
  const temporaryRoot = await createTemporaryDirectory(".archive-push-")
  const checkout = path.join(temporaryRoot, "checkout")
  try {
    reportProgress(onProgress, "Publishing: cloning the private archive repository...")
    await runGit(["clone", "--progress", "--branch", "main", "--single-branch", remote, checkout])
    reportProgress(onProgress, "Publishing: repository cloned; preparing archive files...")
    await mkdir(path.join(checkout, "archives"), {
      recursive: true,
      mode: 0o700,
    })
    const remoteDirectory = await createRemoteArchiveDirectory({
      checkout,
      archiveName,
    })
    if (remoteDirectory.alreadyExists) {
      return await verifyExistingArchive({
        directory,
        archiveName,
        remote,
        runGit,
        checkout,
        onProgress,
      })
    }
    return await publishNewArchive({
      directory,
      archiveName,
      remote,
      runGit,
      checkout,
      remoteArchiveDirectory: remoteDirectory.directory,
      onProgress,
    })
  } finally {
    await removeTemporaryDirectory(temporaryRoot)
  }
}

function isPathWithin({ parent, candidate }) {
  const relative = path.relative(parent, candidate)
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function assertPathsDoNotOverlap({ firstPath, secondPath }) {
  const first = path.resolve(firstPath)
  const second = path.resolve(secondPath)
  if (
    isPathWithin({
      parent: first,
      candidate: second,
    })
    || isPathWithin({
      parent: second,
      candidate: first,
    })
  ) {
    throw new Error(`Archive source directories must not overlap: ${first} and ${second}`)
  }
}

function resolveArchiveSourcePaths({ packageDirectory, env } = {}) {
  const recoveryFactsDirectory = resolveOperationalStateDirectory({ env })
  if (path.basename(recoveryFactsDirectory) !== "recovery-facts") {
    throw new Error("Operational State Store archive path must end in recovery-facts.")
  }
  const logsDirectory = path.join(packageDirectory, "logs")
  const archiveOutputDirectory = path.join(packageDirectory, "archive-output")
  for (const protectedDirectory of [logsDirectory, archiveOutputDirectory]) {
    assertPathsDoNotOverlap({
      firstPath: recoveryFactsDirectory,
      secondPath: protectedDirectory,
    })
  }
  return [
    {
      directoryName: "logs",
      sourceDirectory: logsDirectory,
    },
    {
      directoryName: "recovery-facts",
      sourceDirectory: recoveryFactsDirectory,
    },
  ]
}

async function copyArchiveEvidence({ sourcePaths, packageDirectory, localArchive, onProgress } = {}) {
  const recoverySource = sourcePaths.find((source) => source.directoryName === "recovery-facts")
  const recoverySize = await getTreeSize(recoverySource.sourceDirectory)
  const recoveryCheckpoint = await readLatestRecoveryCheckpoint(recoverySource.sourceDirectory)
  let retainedFiles = 0
  let copiedBytes = 0
  const onFileCopied = ({ size }) => {
    retainedFiles += 1
    copiedBytes += size
    reportProgress(onProgress, `  retained/copied ${retainedFiles} files — ${formatBytes(copiedBytes)}`)
  }
  reportProgress(onProgress, "Archive: matching TESTNET process sessions to the latest durable recovery runtime; cumulative logs are excluded...")
  const logSelection = await copySelectedLogs({
    sourceDirectory: path.join(packageDirectory, "logs"),
    destinationDirectory: path.join(localArchive, "logs"),
    recoveryCheckpoint,
    onFileCopied,
  })
  if (!logSelection.matchingTradingLogsAvailable) {
    reportProgress(
      onProgress,
      `WARNING: matchingTradingLogsAvailable=false for recovery runtime ${logSelection.unmatchedRuntimeSessionId}; unrelated sessions are retained only as independent evidence.`,
    )
  }
  reportProgress(onProgress, `Copying complete recovery-facts/ (${recoverySize.files.length} files, ${formatBytes(recoverySize.totalBytes)})...`)
  await copyRegularTree({
    sourceDirectory: recoverySource.sourceDirectory,
    destinationDirectory: path.join(localArchive, "recovery-facts"),
    onFileCopied,
  })
  const recoveryCheckpointAfterCopy = await readLatestRecoveryCheckpoint(recoverySource.sourceDirectory)
  if (
    recoveryCheckpointAfterCopy.sequence !== recoveryCheckpoint.sequence
    || recoveryCheckpointAfterCopy.dataCommitHash !== recoveryCheckpoint.dataCommitHash
    || recoveryCheckpointAfterCopy.runtimeSessionId !== recoveryCheckpoint.runtimeSessionId
  ) {
    throw new Error("Operational State Store changed while the debug snapshot was being collected; refusing to create a mixed-time archive.")
  }
  reportProgress(onProgress, `Evidence copy complete: ${retainedFiles} files, ${formatBytes(copiedBytes)} retained/copied.`)
  return logSelection
}


async function writeAndVerifyLocalArchive({
  localArchive,
  createdAt,
  logSelection,
  onProgress,
} = {}) {
  const recoveryCheckpoint = await readLatestRecoveryCheckpoint(path.join(localArchive, "recovery-facts"))
  await writeFile(
    path.join(localArchive, "data_commit_hash"),
    `${recoveryCheckpoint.dataCommitHash}\n`,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  )
  const copiedFiles = await listRegularFiles({ directory: localArchive })
  if (copiedFiles.length === 0) {
    throw new Error("The recovery-facts directory contains no regular files to archive.")
  }
  reportProgress(onProgress, `Hashing ${copiedFiles.length + 1} archive files for manifest...`)
  const manifest = await createArchiveManifest({
    directory: localArchive,
    createdAt,
    logSelection,
    artifactProvenance: logSelection.artifactProvenance,
    onFileHashed: ({
      completedFiles,
      totalFiles: hashTotal,
      completedBytes: hashBytes,
      totalBytes: hashTotalBytes,
    }) => {
      reportProgress(onProgress, `  hashed ${completedFiles}/${hashTotal} files — ${formatBytes(hashBytes)} / ${formatBytes(hashTotalBytes)}`)
    },
  })
  await writeFile(
    path.join(localArchive, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    },
  )
  await verifyArchive({
    directory: localArchive,
    manifest,
  })
  reportProgress(onProgress, "Local archive verified.")
}


function assertCollectionArguments({ env, args } = {}) {
  if (env.TRADING_MODE !== "testnet") {
    throw new Error("Debug archive collection requires TRADING_MODE=testnet. LIVE and unspecified modes are rejected.")
  }
  if (args.length !== 0) {
    throw new TypeError("Usage: archive:debug")
  }
}

async function collectPreparedArchive({
  sourcePaths,
  packageDirectory,
  localArchive,
  archiveName,
  createdAt,
  onProgress,
  onArchiveCreatedFn,
}) {
  try {
    await mkdir(localArchive, {
      recursive: false,
      mode: 0o700,
    })
    const logSelection = await copyArchiveEvidence({
      sourcePaths,
      packageDirectory,
      localArchive,
      onProgress,
    })
    await writeAndVerifyLocalArchive({
      localArchive,
      createdAt,
      logSelection,
      onProgress,
    })
    await onArchiveCreatedFn?.({
      directory: localArchive,
      archiveName,
    })
    reportProgress(onProgress, "Local debug archive collected and verified.")
    return {
      archiveName,
      localArchive,
      createdAt,
      matchingTradingLogsAvailable: logSelection.matchingTradingLogsAvailable,
      unmatchedRuntimeSessionId: logSelection.unmatchedRuntimeSessionId,
      logRuntimeSessionId: logSelection.logRuntimeSessionId,
      runtimeIdentityStatus: logSelection.status,
    }
  } catch (error) {
    throw new Error(
      `Debug archive ${archiveName} was not completed. The source folders were left unchanged; any partial local archive remains at ${localArchive}. ${error.message}`,
      { cause: error },
    )
  }
}

export async function runHarvesterDebugArchive({
  args = process.argv.slice(2),
  env = process.env,
  packageDirectory = PACKAGE_DIRECTORY,
  now = () => new Date(),
  createArchiveId = randomUUID,
  onArchiveCreatedFn,
  onProgress = (message) => process.stdout.write(`${message}\\n`),
  lockDirectory = path.join(os.homedir(), ".coinzilla", "harvester", "process-locks"),
} = {}) {
  assertCollectionArguments({
    env,
    args,
  })
  await assertHarvesterProcessStopped({ lockDirectory })
  const sourcePaths = resolveArchiveSourcePaths({
    packageDirectory,
    env,
  })
  for (const source of sourcePaths) {
    await assertRealDirectory(source.sourceDirectory)
  }
  const createdAt = now().toISOString()
  const archiveName = createHarvesterArchiveDirectoryName({
    createdAt,
    archiveId: createArchiveId(),
  })
  const outputDirectory = path.join(packageDirectory, "archive-output")
  await mkdir(outputDirectory, {
    recursive: true,
    mode: 0o700,
  })
  await assertRealDirectory(outputDirectory)
  const localArchive = path.join(outputDirectory, archiveName)
  return collectPreparedArchive({
    sourcePaths,
    packageDirectory,
    localArchive,
    archiveName,
    createdAt,
    onProgress,
    onArchiveCreatedFn,
  })
}

function createArchiveCliIdentity({ env = process.env } = {}) {
  const metadata = captureBuildMetadata({
    application: "harvester-debug-archive",
    version: packageMetadata.version,
    cwd: PACKAGE_DIRECTORY,
    env,
  })
  const { source } = metadata
  return [
    `${metadata.application} ${metadata.version}`,
    `commit ${source.commit ?? "unknown"}`,
    `worktree ${source.workingTree}`,
    `node ${process.version}`,
  ].join(" | ")
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`${createArchiveCliIdentity()}\n`)
    return
  }
  if (args.length > 0) {
    throw new TypeError("Usage: archive:debug [--version]")
  }
  process.stdout.write(`${createArchiveCliIdentity()}\n`)
  const result = await runHarvesterDebugArchive({ args })
  const summary = [
    "Harvester lightweight debug archive collected and locally verified.",
    `Archive: ${result.archiveName}`,
    `Created: ${result.createdAt}`,
    `Matching trading logs available: ${result.matchingTradingLogsAvailable}`,
    result.matchingTradingLogsAvailable
      ? `Matched runtime: ${result.logRuntimeSessionId}`
      : `Unmatched recovery runtime: ${result.unmatchedRuntimeSessionId}`,
    "Included: all identified TESTNET session evidence as separate sessions, recovery-facts/ and data_commit_hash",
    "Excluded: all data/ (databases/backups), all logs/cumulative/ and unclassified log-root entries",
    `Local archive: ${result.localArchive}`,
  ].join("\n")
  process.stdout.write(`${summary}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`Harvester debug archive collection failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
