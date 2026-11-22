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
import { promisify } from "node:util"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { validateArchiveRemote } from "./initialize-private-archive-repository.js"

const PACKAGE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SOURCE_DIRECTORIES = Object.freeze(["logs", "data", "recovery-facts"])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const runGitDefault = (args, { cwd } = {}) => new Promise((resolve, reject) => {
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

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const reportProgress = (onProgress, message) => onProgress?.(message)

const getTreeSize = async (directory) => {
  const files = await listRegularFiles(directory)
  let totalBytes = 0
  for (const relativePath of files) {
    totalBytes += (await stat(path.join(directory, relativePath))).size
  }
  return { files, totalBytes }
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
  return timestamp + "_" + archiveId.slice(0, 8)
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

async function createArchiveManifest({ directory, createdAt, onFileHashed } = {}) {
  const files = await listRegularFiles(directory)
  const entries = []
  let completedBytes = 0
  const totalBytes = (await getTreeSize(directory)).totalBytes
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
    snapshotType: "raw-directory-copy",
    createdAt,
    includedDirectories: [...SOURCE_DIRECTORIES],
    dataCommitHash,
    recoveryRuntimeSessionId: recoveryCheckpoint.runtimeSessionId,
    recoveryFactSequence: recoveryCheckpoint.sequence,
    files: entries,
  }
}

async function verifyArchive({ directory, manifest } = {}) {
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
      throw new Error("Archive checksum or size verification failed: " + entry.path)
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
  onProgress,
} = {}) {
  const temporaryRoot = await createTemporaryDirectory(".archive-push-")
  const checkout = path.join(temporaryRoot, "checkout")
  try {
    reportProgress(onProgress, "Publishing: cloning the private archive repository...")
    await runGit(["clone", "--progress", "--branch", "main", "--single-branch", remote, checkout])
    reportProgress(onProgress, "Publishing: repository cloned; preparing archive files...")
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
      reportProgress(onProgress, "Publishing: existing archive verified; no upload needed.")
      return { commit: existingCommit, fileCount: localFiles.length, alreadyPublished: true }
    }

    await copyRegularTree({
      sourceDirectory: directory,
      destinationDirectory: remoteArchiveDirectory,
    })
    reportProgress(onProgress, "Publishing: copied archive into checkout; staging files...")
    await runGit(["add", "--", `archives/${archiveName}`], { cwd: checkout })
    await runGit([
      "-c", "user.name=Coinzilla Harvester",
      "-c", "user.email=harvester-archive@users.noreply.github.com",
      "commit", "-m", `chore(archive): add Harvester session ${archiveName}`,
    ], { cwd: checkout })
    const localCommit = await runGit(["rev-parse", "HEAD"], { cwd: checkout })
    reportProgress(onProgress, "Publishing: pushing to GitHub (Git transfer progress follows)...")
    await runGit(["push", "--progress", "origin", "main"], { cwd: checkout })
    reportProgress(onProgress, "Publishing: push finished; verifying remote commit and file contents...")
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
  runGit = runGitDefault,
  packageDirectory = PACKAGE_DIRECTORY,
  now = () => new Date(),
  createArchiveId = randomUUID,
  publishArchiveFn = publishArchive,
  onProgress = (message) => process.stdout.write(message + "\n"),
} = {}) {
  if (env.TRADING_MODE !== "testnet") {
    throw new Error("Archive publication requires TRADING_MODE=testnet. LIVE and unspecified modes are rejected.")
  }
  const remote = validateArchiveRemote(env.HARVESTER_ARCHIVE_REMOTE)
  const canonicalRemote = remote
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
  if (canonicalRemote !== "https://github.com/45s/coinzilla-archive") {
    throw new Error("HARVESTER_ARCHIVE_REMOTE must target the private https://github.com/45s/coinzilla-archive repository.")
  }
  if (args.length !== 0) {
    throw new TypeError("Usage: archive:push")
  }

  const sourcePaths = SOURCE_DIRECTORIES.map((directoryName) => ({
    directoryName,
    sourceDirectory: path.join(packageDirectory, directoryName),
  }))
  for (const source of sourcePaths) {
    await assertRealDirectory(source.sourceDirectory)
  }

  const createdAt = now().toISOString()
  const archiveName = createHarvesterArchiveDirectoryName({
    createdAt,
    archiveId: createArchiveId(),
  })
  const outputDirectory = path.join(packageDirectory, "archive-output")
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  await assertRealDirectory(outputDirectory)
  const localArchive = path.join(outputDirectory, archiveName)

  try {
    const sourceSizes = await Promise.all(sourcePaths.map(async (source) => ({
      ...source,
      ...(await getTreeSize(source.sourceDirectory)),
    })))
    const totalFiles = sourceSizes.reduce((total, source) => total + source.files.length, 0)
    const totalBytes = sourceSizes.reduce((total, source) => total + source.totalBytes, 0)
    let copiedFiles = 0
    let copiedBytes = 0
    reportProgress(onProgress, `Archive: copying ${totalFiles} files (${formatBytes(totalBytes)})...`)
    await mkdir(localArchive, { recursive: false, mode: 0o700 })
    for (const source of sourceSizes) {
      reportProgress(onProgress, `Copying ${source.directoryName}/ (${source.files.length} files, ${formatBytes(source.totalBytes)})...`)
      await copyRegularTree({
        sourceDirectory: source.sourceDirectory,
        destinationDirectory: path.join(localArchive, source.directoryName),
        onFileCopied: ({ size }) => {
          copiedFiles += 1
          copiedBytes += size
          reportProgress(onProgress, `  copied ${copiedFiles}/${totalFiles} files — ${formatBytes(copiedBytes)} / ${formatBytes(totalBytes)}`)
        },
      })
    }
    reportProgress(onProgress, `Copy complete: ${copiedFiles} files, ${formatBytes(copiedBytes)}.`)
    const recoveryCheckpoint = await readLatestRecoveryCheckpoint(path.join(localArchive, "recovery-facts"))
    await writeFile(path.join(localArchive, "data_commit_hash"), recoveryCheckpoint.dataCommitHash + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    const copiedFiles = await listRegularFiles(localArchive)
    if (copiedFiles.length === 0) {
      throw new Error("The logs and data directories contain no regular files to archive.")
    }

    reportProgress(onProgress, `Hashing ${copiedFiles + 1} archive files for manifest...`)
    const manifest = await createArchiveManifest({
      directory: localArchive,
      createdAt,
      onFileHashed: ({ completedFiles, totalFiles: hashTotal, completedBytes: hashBytes, totalBytes: hashTotalBytes }) => {
        reportProgress(onProgress, `  hashed ${completedFiles}/${hashTotal} files — ${formatBytes(hashBytes)} / ${formatBytes(hashTotalBytes)}`)
      },
    })
    await writeFile(path.join(localArchive, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    reportProgress(onProgress, "Verifying local archive checksums...")
    await verifyArchive({ directory: localArchive, manifest })
    reportProgress(onProgress, "Local archive verified.")

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
      "Archive " + archiveName + " was not published. The source folders were left unchanged; any local archive files were retained at "
        + localArchive + ". " + error.message,
      { cause: error },
    )
  }
}

async function main() {
  const result = await runHarvesterArchivePush()
  process.stdout.write([
    "Harvester local logs/data archive published and remotely verified.",
    `Archive: archives/${result.archiveName}`,
    "Created: " + result.createdAt,
    "Included: logs/, data/, recovery-facts/ and data_commit_hash",
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
