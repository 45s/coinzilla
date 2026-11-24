import { createHash, randomUUID } from "node:crypto"
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
import { spawn } from "node:child_process"
import { createReadStream, createWriteStream } from "node:fs"
import { finished, pipeline } from "node:stream/promises"
import { createInterface } from "node:readline"
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

function validateArchiveRemote(remote) {
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
      await copyFile(sourcePath, destinationPath)
      await onFileCopied?.({
        relativePath: path.join(relative, entry.name).split(path.sep).join("/"),
        size: sourceStats.size,
      })
    } else {
      throw new Error(`Refusing to archive a non-regular session entry: ${sourcePath}`)
    }
  }
}

async function copyCompressedTree({ sourceDirectory, destinationDirectory, relative = "", onFileCopied } = {}) {
  const source = relative ? path.join(sourceDirectory, relative) : sourceDirectory
  const destination = relative ? path.join(destinationDirectory, relative) : destinationDirectory
  await mkdir(destination, {
    recursive: true,
    mode: 0o700,
  })
  for (const entry of await readdir(source, { withFileTypes: true })) {
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
      const compressedRelative = `${childRelative}.gz`
      const destinationPath = path.join(destinationDirectory, compressedRelative)
      await pipeline(
        createReadStream(sourcePath),
        createGzip({ level: 6 }),
        createWriteStream(destinationPath, {
          flags: "w",
          mode: 0o600,
        }),
      )
      await onFileCopied?.({
        relativePath: compressedRelative.split(path.sep).join("/"),
        size: (await stat(destinationPath)).size,
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

function isCompletedTestnetSession({ identity, completion } = {}) {
  return (
    identity?.application === "harvester"
    && identity?.formatVersion === 1
    && identity?.environment === "testnet"
    && UUID_PATTERN.test(identity?.runtimeSessionId ?? "")
    && completion?.runtimeSessionId === identity.runtimeSessionId
    && completion?.logStreamsComplete === true
  )
}

async function readCompletedTestnetSession(sessionDirectory) {
  try {
    const identityFilename = path.join(sessionDirectory, "process-identity.json")
    const completionFilename = path.join(sessionDirectory, "process-completed.json")
    const [identity, completion] = await Promise.all([
      readRegularJsonFile(identityFilename),
      readRegularJsonFile(completionFilename),
    ])
    return isCompletedTestnetSession({
      identity,
      completion,
    }) ? identity : null
  } catch {
    return null
  }
}

async function findNewestCompletedTestnetSession(sessionsDirectory) {
  const sessionNames = (await readdir(sessionsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .toReversed()
  for (const sessionName of sessionNames) {
    const identity = await readCompletedTestnetSession(path.join(sessionsDirectory, sessionName))
    if (identity) {
      return {
        sessionName,
        identity,
      }
    }
  }
  throw new Error("No completed TESTNET DEV session with valid process identity was found under logs/sessions; run pnpm dev and stop it gracefully before archiving.")
}

async function copyLogRootEntry({
  entry,
  sourceDirectory,
  destinationDirectory,
  selectedSessionName,
  runtimeSessionId,
  onFileCopied,
} = {}) {
  const sourcePath = path.join(sourceDirectory, entry.name)
  const sourceStats = await lstat(sourcePath)
  if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
    throw new Error(`Log root entry must be a real directory: ${sourcePath}`)
  }
  if (entry.name === "sessions") {
    await copyCompressedTree({
      sourceDirectory,
      destinationDirectory,
      relative: path.join("sessions", selectedSessionName),
      onFileCopied,
    })
    return
  }
  if (entry.name === "cumulative") {
    await copyCumulativeTailTree({
      sourceDirectory,
      destinationDirectory,
      relative: "cumulative",
      runtimeSessionId,
      onFileCopied,
    })
    return
  }
  throw new Error("The logs root contains unsupported entries; refusing to archive unclassified log data.")
}

async function copySelectedLogs({ sourceDirectory, destinationDirectory, onFileCopied } = {}) {
  await mkdir(destinationDirectory, {
    recursive: true,
    mode: 0o700,
  })
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  const unsupportedEntries = entries.filter((entry) => !["sessions", "cumulative"].includes(entry.name))
  if (unsupportedEntries.length > 0) {
    throw new Error("The logs root contains unsupported entries; refusing to archive unclassified log data.")
  }
  const sessionsEntry = entries.find((entry) => entry.name === "sessions" && entry.isDirectory())
  if (!sessionsEntry) {
    throw new Error("The logs/sessions directory is missing; refusing to publish an archive without session evidence.")
  }
  const selection = await findNewestCompletedTestnetSession(path.join(sourceDirectory, "sessions"))
  const sessionsStats = await lstat(path.join(sourceDirectory, "sessions"))
  if (sessionsStats.isSymbolicLink() || !sessionsStats.isDirectory()) {
    throw new Error("The logs/sessions directory must be a real directory.")
  }
  await copyCompressedTree({
    sourceDirectory,
    destinationDirectory,
    relative: path.join("sessions", selection.sessionName),
    onFileCopied,
  })
  return selection.identity
}

async function visitSessionLogRecords({ filename, runtimeSessionId, visit } = {}) {
  const lines = createInterface({
    input: createReadStream(filename),
    crlfDelay: Infinity,
  })
  for await (const line of lines) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record?.context?.runtimeSessionId === runtimeSessionId) {
      await visit(line)
    }
  }
}

async function copySessionFilteredTailFile({ source, destination, runtimeSessionId } = {}) {
  let totalBytes = 0
  await visitSessionLogRecords({
    filename: source,
    runtimeSessionId,
    visit: (line) => {
      totalBytes += Buffer.byteLength(line) + 1
    },
  })
  if (totalBytes === 0) {
    await writeFile(destination, "", {
      encoding: "utf8",
      mode: 0o600,
    })
    return 0
  }
  const bytesToKeep = Math.max(1, Math.ceil(totalBytes * 0.05))
  const startOffset = totalBytes - bytesToKeep
  let currentOffset = 0
  const output = createWriteStream(destination, {
    flags: "w",
    mode: 0o600,
  })
  try {
    await visitSessionLogRecords({
      filename: source,
      runtimeSessionId,
      visit: async (line) => {
        const recordBytes = Buffer.from(`${line}\n`)
        const recordStart = currentOffset
        currentOffset += recordBytes.length
        if (currentOffset <= startOffset) {
          return
        }
        const selectedBytes = recordBytes.subarray(Math.max(0, startOffset - recordStart))
        await new Promise((...callbacks) => {
          const [resolve, reject] = callbacks
          output.write(selectedBytes, (error) => {
            if (error) {
              reject(error)
              return
            }
            resolve()
          })
        })
      },
    })
    output.end()
    await finished(output)
  } catch (error) {
    output.destroy()
    throw error
  }
  return bytesToKeep
}

async function copyCumulativeTailTree({
  sourceDirectory,
  destinationDirectory,
  relative,
  runtimeSessionId,
  onFileCopied,
} = {}) {
  const source = path.join(sourceDirectory, relative)
  const destination = path.join(destinationDirectory, relative)
  await mkdir(destination, {
    recursive: true,
    mode: 0o700,
  })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const childRelative = path.join(relative, entry.name)
    const sourcePath = path.join(sourceDirectory, childRelative)
    const destinationPath = path.join(destinationDirectory, childRelative)
    const sourceStats = await lstat(sourcePath)
    if (sourceStats.isSymbolicLink()) {
      throw new Error(`Refusing to archive a symbolic link: ${sourcePath}`)
    }
    if (sourceStats.isDirectory()) {
      await copyCumulativeTailTree({
        sourceDirectory,
        destinationDirectory,
        relative: childRelative,
        runtimeSessionId,
        onFileCopied,
      })
    } else if (sourceStats.isFile()) {
      if (path.basename(sourcePath) === "terminal.log") {
        continue
      }
      const size = await copySessionFilteredTailFile({
        source: sourcePath,
        destination: destinationPath,
        runtimeSessionId,
      })
      await onFileCopied?.({
        relativePath: childRelative.split(path.sep).join("/"),
        size,
      })
    } else {
      throw new Error(`Refusing to archive a non-regular session entry: ${sourcePath}`)
    }
  }
}

async function listRegularFiles({ directory, relative = "" } = {}) {
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

async function readLatestRecoveryCheckpoint(recoveryFactsDirectory) {
  const manifestContent = await readFile(path.join(recoveryFactsDirectory, "manifest.jsonl"), "utf8")
  const factsContent = await readFile(path.join(recoveryFactsDirectory, "facts.jsonl"), "utf8")
  const manifestLines = manifestContent.split("\n").filter((line) => line.length > 0)
  const factLines = factsContent.split("\n").filter((line) => line.length > 0)
  if (manifestLines.length === 0 || factLines.length === 0) {
    throw new Error("Recovery-facts manifest and facts ledger must both contain committed records.")
  }

  let latestManifest
  let latestFact
  try {
    latestManifest = JSON.parse(manifestLines.at(-1))
    latestFact = JSON.parse(factLines.at(-1))
  } catch (error) {
    throw new Error("The final recovery-facts manifest/fact record is not valid JSON.", { cause: error })
  }

  const dataCommitHash = latestManifest.lastCommittedDigest
  if (
    typeof dataCommitHash !== "string"
    || !/^[a-f0-9]{64}$/i.test(dataCommitHash)
    || latestFact.digest !== dataCommitHash
    || String(latestManifest.sequence) !== String(latestFact.sequence)
    || manifestLines.length !== factLines.length
    || Number(latestManifest.recordCount) !== factLines.length
    || !UUID_PATTERN.test(latestFact.runtimeSessionId ?? "")
  ) {
    throw new Error("The latest recovery-facts manifest does not match the final committed fact record.")
  }

  return {
    dataCommitHash,
    runtimeSessionId: latestFact.runtimeSessionId,
    sequence: String(latestFact.sequence),
  }
}

async function createArchiveManifest({ directory, createdAt, logRuntimeSessionId, onFileHashed } = {}) {
  const files = await listRegularFiles({ directory })
  const entries = []
  let completedBytes = 0
  const { totalBytes } = await getTreeSize(directory)
  for (const relativePath of files) {
    const filename = path.join(directory, relativePath)
    const fileStats = await stat(filename)
    entries.push({
      path: relativePath,
      size: fileStats.size,
      sha256: await sha256File(filename),
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
  const recoveryCheckpoint = await readLatestRecoveryCheckpoint(path.join(directory, "recovery-facts"))
  const dataCommitHash = (await readFile(path.join(directory, "data_commit_hash"), "utf8")).trim()
  return {
    formatVersion: 1,
    application: "harvester",
    commandTradingMode: "testnet",
    snapshotType: "selected-log-evidence",
    createdAt,
    includedDirectories: [...SOURCE_DIRECTORIES],
    excludedPaths: [...EXCLUDED_ARCHIVE_PATHS],
    logSelection: {
      cumulative: "excluded",
      sessions: "newest-completed-TESTNET-session-only; gzip-compressed",
    },
    dataCommitHash,
    logRuntimeSessionId,
    recoveryRuntimeSessionId: recoveryCheckpoint.runtimeSessionId,
    recoveryFactSequence: recoveryCheckpoint.sequence,
    files: entries,
  }
}

async function verifyArchive({ directory, manifest } = {}) {
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

async function publishArchive({
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
    { directoryName: "logs", sourceDirectory: logsDirectory },
    { directoryName: "recovery-facts", sourceDirectory: recoveryFactsDirectory },
  ]
}

async function copyArchiveEvidence({ sourcePaths, packageDirectory, localArchive, onProgress } = {}) {
  const recoverySource = sourcePaths.find((source) => source.directoryName === "recovery-facts")
  const recoverySize = await getTreeSize(recoverySource.sourceDirectory)
  let retainedFiles = 0
  let copiedBytes = 0
  const onFileCopied = ({ size }) => {
    retainedFiles += 1
    copiedBytes += size
    reportProgress(onProgress, `  retained/copied ${retainedFiles} files — ${formatBytes(copiedBytes)}`)
  }
  reportProgress(onProgress, "Archive: selecting the newest completed TESTNET session; cumulative logs and databases are excluded...")
  const logSessionIdentity = await copySelectedLogs({
    sourceDirectory: path.join(packageDirectory, "logs"),
    destinationDirectory: path.join(localArchive, "logs"),
    onFileCopied,
  })
  reportProgress(onProgress, `Copying complete recovery-facts/ (${recoverySize.files.length} files, ${formatBytes(recoverySize.totalBytes)})...`)
  await copyRegularTree({
    sourceDirectory: recoverySource.sourceDirectory,
    destinationDirectory: path.join(localArchive, "recovery-facts"),
    onFileCopied,
  })
  reportProgress(onProgress, `Evidence copy complete: ${retainedFiles} files, ${formatBytes(copiedBytes)} retained/copied.`)
  return logSessionIdentity
}

function assertArchiveSessionIdentityMatches({ logSessionIdentity, recoveryCheckpoint } = {}) {
  if (logSessionIdentity.runtimeSessionId !== recoveryCheckpoint.runtimeSessionId) {
    throw new Error("Selected TESTNET log session and recovery-facts runtime identities do not match; refusing to publish mixed-session evidence.")
  }
}

async function writeAndVerifyLocalArchive({ localArchive, createdAt, logSessionIdentity, onProgress } = {}) {
  const recoveryCheckpoint = await readLatestRecoveryCheckpoint(path.join(localArchive, "recovery-facts"))
  assertArchiveSessionIdentityMatches({
    logSessionIdentity,
    recoveryCheckpoint,
  })
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
    throw new Error("The logs and data directories contain no regular files to archive.")
  }
  reportProgress(onProgress, `Hashing ${copiedFiles.length + 1} archive files for manifest...`)
  const manifest = await createArchiveManifest({
    directory: localArchive,
    createdAt,
    logRuntimeSessionId: logSessionIdentity.runtimeSessionId,
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
  reportProgress(onProgress, "Verifying local archive checksums...")
  await verifyArchive({
    directory: localArchive,
    manifest,
  })
  reportProgress(onProgress, "Local archive verified.")
}

function resolveArchiveRemote({ env, args } = {}) {
  if (env.TRADING_MODE !== "testnet") {
    throw new Error("Archive publication requires TRADING_MODE=testnet. LIVE and unspecified modes are rejected.")
  }
  if (args.length !== 0) {
    throw new TypeError("Usage: archive:debug")
  }
  const remote = validateArchiveRemote(env.HARVESTER_ARCHIVE_REMOTE)
  const canonicalRemote = remote
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
  if (canonicalRemote !== "https://github.com/45s/coinzilla-archive") {
    throw new Error("HARVESTER_ARCHIVE_REMOTE must target the private https://github.com/45s/coinzilla-archive repository.")
  }
  return remote
}

async function publishPreparedArchive({
  sourcePaths,
  packageDirectory,
  localArchive,
  archiveName,
  createdAt,
  remote,
  runGit,
  publishArchiveFn,
  onProgress,
}) {
  try {
    await mkdir(localArchive, {
      recursive: false,
      mode: 0o700,
    })
    const logSessionIdentity = await copyArchiveEvidence({
      sourcePaths,
      packageDirectory,
      localArchive,
      onProgress,
    })
    await writeAndVerifyLocalArchive({
      localArchive,
      createdAt,
      logSessionIdentity,
      onProgress,
    })
    const published = await publishArchiveFn({
      directory: localArchive,
      archiveName,
      remote,
      runGit,
      onProgress,
    })
    reportProgress(onProgress, "Remote archive verified successfully.")
    return {
      archiveName,
      localArchive,
      remote,
      remoteCommit: published.commit,
      fileCount: published.fileCount,
      createdAt,
    }
  } catch (error) {
    throw new Error(
      `Archive ${archiveName} was not published. The source folders were left unchanged; any local archive files were retained at ${localArchive}. ${error.message}`,
      { cause: error },
    )
  }
}

export async function runHarvesterDebugArchive({
  args = process.argv.slice(2),
  env = process.env,
  runGit = runGitDefault,
  packageDirectory = PACKAGE_DIRECTORY,
  now = () => new Date(),
  createArchiveId = randomUUID,
  publishArchiveFn = publishArchive,
  onProgress = (message) => process.stdout.write(`${message}\n`),
  lockDirectory = path.join(os.homedir(), ".coinzilla", "harvester", "process-locks"),
} = {}) {
  const remote = resolveArchiveRemote({
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
  return publishPreparedArchive({
    sourcePaths,
    packageDirectory,
    localArchive,
    archiveName,
    createdAt,
    remote,
    runGit,
    publishArchiveFn,
    onProgress,
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
    "Harvester lightweight debug archive published and remotely verified.",
    `Archive: archives/${result.archiveName}`,
    `Created: ${result.createdAt}`,
    "Included: newest completed TESTNET session logs, recovery-facts/ and data_commit_hash",
    "Excluded: all data/ (databases/backups), all logs/cumulative/ and unclassified log-root entries",
    `Remote commit: ${result.remoteCommit}`,
    `Local copy: ${result.localArchive}`,
    `Files verified: ${result.fileCount}`,
  ].join("\n")
  process.stdout.write(`${summary}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`Harvester debug archive publication failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
