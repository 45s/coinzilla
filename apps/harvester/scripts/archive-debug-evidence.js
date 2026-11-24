import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
} from "node:crypto"
import {
  appendFile,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open as openFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { spawn } from "node:child_process"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { captureBuildMetadata } from "@coinzilla/utils"
import packageMetadata from "../package.json" with { type: "json" }
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-directory.js"

const PACKAGE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const ARCHIVE_REMOTE = "https://github.com/45s/coinzilla-archive.git"
const MAGIC = Buffer.from("CZDBG001")

function runCommand({ command, args, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`${command} ${args[0]} failed (exit ${code}): ${stderr.trim()}`))
      }
    })
  })
}

async function copyEvidenceTree({ source, destination, relative = "" } = {}) {
  const currentSource = relative ? path.join(source, relative) : source
  const entries = await readdir(currentSource, { withFileTypes: true })
  for (const entry of entries) {
    const childRelative = path.join(relative, entry.name)
    const sourcePath = path.join(source, childRelative)
    const destinationPath = path.join(destination, childRelative)
    const details = await lstat(sourcePath)
    if (details.isSymbolicLink()) {
      throw new Error(`Refusing symbolic link in evidence: ${sourcePath}`)
    }
    if (details.isDirectory()) {
      await mkdir(destinationPath, {
        recursive: true,
        mode: 0o700,
      })
      await copyEvidenceTree({
        source,
        destination,
        relative: childRelative,
      })
    } else if (details.isFile()) {
      await mkdir(path.dirname(destinationPath), {
        recursive: true,
        mode: 0o700,
      })
      await copyFile(sourcePath, destinationPath)
    } else {
      throw new Error(`Refusing non-regular evidence entry: ${sourcePath}`)
    }
  }
}

async function listFiles({ root, relative = "" } = {}) {
  const current = relative ? path.join(root, relative) : root
  const entries = await readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const filename = path.join(root, childRelative)
    const details = await lstat(filename)
    if (details.isSymbolicLink()) {
      throw new Error(`Archive contains symbolic link: ${filename}`)
    }
    if (details.isDirectory()) {
      files.push(...await listFiles({
        root,
        relative: childRelative,
      }))
    } else if (details.isFile()) {
      files.push(childRelative.split(path.sep).join("/"))
    } else {
      throw new Error(`Archive contains non-regular file: ${filename}`)
    }
  }
  return files.sort()
}

async function hashFile({ filename } = {}) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}

function validateArchiveRequest({ args, env } = {}) {
  if (env.TRADING_MODE !== "testnet") {
    throw new Error("Debug archiving requires TRADING_MODE=testnet; LIVE and unspecified modes are rejected.")
  }
  if (args.length !== 1 || args[0] !== "--confirm-stopped") {
    throw new TypeError("Usage: pnpm --filter @coinzilla/harvester archive:debug -- --confirm-stopped")
  }
  if (typeof env.HARVESTER_ARCHIVE_PASSPHRASE !== "string" ||
      env.HARVESTER_ARCHIVE_PASSPHRASE.length < 16) {
    throw new Error("Set HARVESTER_ARCHIVE_PASSPHRASE (at least 16 characters) before archiving.")
  }
}

function createArchiveName({ createdAt } = {}) {
  const timestamp = createdAt.replaceAll(":", "-").replaceAll(".", "-")
  return `harvester-debug-${timestamp}-${randomUUID().slice(0, 8)}.tar.gz.enc`
}

function resolveRecoveryFactsDirectory({ packageDirectory, env } = {}) {
  const directory = resolveOperationalStateDirectory({ env })
  if (path.basename(directory) !== "recovery-facts") {
    throw new Error("Operational State Store archive path must end in recovery-facts.")
  }
  const logsDirectory = path.join(packageDirectory, "logs")
  const relative = path.relative(logsDirectory, directory)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("The recovery-facts directory must not be inside logs/.")
  }
  return directory
}

async function copyArchiveSources({ packageDirectory, recoveryDirectory, staging } = {}) {
  const logsDirectory = path.join(packageDirectory, "logs")
  const logsStats = await lstat(logsDirectory)
  if (logsStats.isSymbolicLink() || !logsStats.isDirectory()) {
    throw new Error("logs/ must be a real directory.")
  }
  await mkdir(path.join(staging, "logs"), {
    recursive: true,
    mode: 0o700,
  })
  await copyEvidenceTree({
    source: logsDirectory,
    destination: path.join(staging, "logs"),
  })

  const includedSources = ["logs"]
  const missingSources = []
  try {
    const recoveryStats = await lstat(recoveryDirectory)
    if (recoveryStats.isSymbolicLink() || !recoveryStats.isDirectory()) {
      throw new Error("recovery-facts path must be a real directory.")
    }
    await mkdir(path.join(staging, "recovery-facts"), {
      recursive: true,
      mode: 0o700,
    })
    await copyEvidenceTree({
      source: recoveryDirectory,
      destination: path.join(staging, "recovery-facts"),
    })
    includedSources.push("recovery-facts")
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error
    }
    missingSources.push("recovery-facts")
  }
  return { includedSources, missingSources }
}

async function writeArchiveManifest({
  staging,
  createdAt,
  packageDirectory,
  env,
  includedSources,
  missingSources,
} = {}) {
  const metadata = captureBuildMetadata({
    application: "harvester-debug-archive",
    version: packageMetadata.version,
    cwd: packageDirectory,
    env,
  })
  const files = []
  const relativePaths = await listFiles({ root: staging })
  for (const relativePath of relativePaths) {
    const filename = path.join(staging, relativePath)
    files.push({
      path: relativePath,
      size: (await stat(filename)).size,
      sha256: await hashFile({ filename }),
    })
  }
  const manifest = {
    formatVersion: 1,
    purpose: "debugging-only forensic snapshot; not a recovery or restore artifact",
    createdAt,
    source: metadata.source,
    node: process.version,
    includedSources,
    missingSources,
    includesIncompleteSessions: true,
    files,
  }
  await writeFile(
    path.join(staging, "ARCHIVE-MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  )
}

export async function encryptDebugBundle({ inputFile, outputFile, passphrase } = {}) {
  if (typeof passphrase !== "string" || passphrase.length < 16) {
    throw new Error("HARVESTER_ARCHIVE_PASSPHRASE must contain at least 16 characters.")
  }
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(passphrase, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  await writeFile(outputFile, Buffer.concat([MAGIC, salt, iv]), {
    flag: "wx",
    mode: 0o600,
  })
  await pipeline(
    createReadStream(inputFile),
    cipher,
    createWriteStream(outputFile, {
      flags: "a",
      mode: 0o600,
    }),
  )
  await appendFile(outputFile, cipher.getAuthTag(), { mode: 0o600 })
  return {
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
  }
}

export async function decryptDebugBundle({ inputFile, outputFile, passphrase } = {}) {
  if (typeof passphrase !== "string" || passphrase.length < 16) {
    throw new Error("HARVESTER_ARCHIVE_PASSPHRASE must contain at least 16 characters.")
  }
  const details = await stat(inputFile)
  if (details.size < 52) {
    throw new Error("Encrypted debug archive is truncated.")
  }
  const handle = await openFile(inputFile, "r")
  const header = Buffer.alloc(36)
  const tag = Buffer.alloc(16)
  try {
    await handle.read(header, 0, header.length, 0)
    await handle.read(tag, 0, tag.length, details.size - tag.length)
  } finally {
    await handle.close()
  }
  if (!header.subarray(0, 8).equals(MAGIC)) {
    throw new Error("Unsupported debug archive format.")
  }
  const salt = header.subarray(8, 24)
  const iv = header.subarray(24, 36)
  const key = scryptSync(passphrase, salt, 32, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  try {
    await pipeline(
      createReadStream(inputFile, {
        start: 36,
        end: details.size - 17,
      }),
      decipher,
      createWriteStream(outputFile, {
        flags: "wx",
        mode: 0o600,
      }),
    )
  } catch (error) {
    await rm(outputFile, { force: true })
    throw error
  }
  return outputFile
}

async function publishEncryptedArchive({ encryptedFile, archiveName, temporaryRoot } = {}) {
  const checkout = path.join(temporaryRoot, "archive-repo")
  await runCommand({
    command: "git",
    args: ["clone", "--branch", "main", "--single-branch", ARCHIVE_REMOTE, checkout],
  })
  const destination = path.join(checkout, "archives", archiveName)
  await mkdir(path.dirname(destination), {
    recursive: true,
    mode: 0o700,
  })
  await copyFile(encryptedFile, destination, { flag: "wx" })
  await runCommand({
    command: "git",
    args: ["add", "--", `archives/${archiveName}`],
    cwd: checkout,
  })
  await runCommand({
    command: "git",
    args: [
      "-c", "user.name=Coinzilla Harvester",
      "-c", "user.email=harvester-archive@users.noreply.github.com",
      "commit", "-m", `chore(archive): add encrypted debug bundle ${archiveName}`,
    ],
    cwd: checkout,
  })
  const commit = await runCommand({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: checkout,
  })
  await runCommand({
    command: "git",
    args: ["push", "origin", "main"],
    cwd: checkout,
  })
  const remoteHead = await runCommand({
    command: "git",
    args: ["ls-remote", "--heads", ARCHIVE_REMOTE, "refs/heads/main"],
  })
  if (remoteHead.split(/\s+/)[0] !== commit) {
    throw new Error("Archive push could not be verified against private repository main.")
  }
  return commit
}

export async function runHarvesterDebugArchive({
  args = process.argv.slice(2),
  env = process.env,
  packageDirectory = PACKAGE_DIRECTORY,
} = {}) {
  validateArchiveRequest({ args, env })
  const logsDirectory = path.join(packageDirectory, "logs")
  const recoveryDirectory = resolveRecoveryFactsDirectory({
    packageDirectory,
    env,
  })
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "harvester-debug-"))
  const staging = path.join(temporaryRoot, "evidence")
  const tarFile = path.join(temporaryRoot, "evidence.tar.gz")
  const createdAt = new Date().toISOString()
  const archiveName = createArchiveName({ createdAt })
  const outputDirectory = path.join(packageDirectory, "archive-output", "debug")
  const encryptedFile = path.join(outputDirectory, archiveName)

  try {
    await mkdir(staging, {
      recursive: true,
      mode: 0o700,
    })
    const { includedSources, missingSources } = await copyArchiveSources({
      packageDirectory,
      recoveryDirectory,
      staging,
    })
    await writeArchiveManifest({
      staging,
      createdAt,
      packageDirectory,
      env,
      includedSources,
      missingSources,
    })
    await runCommand({
      command: "tar",
      args: ["-czf", tarFile, "-C", staging, "."],
    })
    await mkdir(outputDirectory, {
      recursive: true,
      mode: 0o700,
    })
    const encryption = await encryptDebugBundle({
      inputFile: tarFile,
      outputFile: encryptedFile,
      passphrase: env.HARVESTER_ARCHIVE_PASSPHRASE,
    })
    const commit = await publishEncryptedArchive({
      encryptedFile,
      archiveName,
      temporaryRoot,
    })
    process.stdout.write([
      "Encrypted Harvester debug archive published and verified.",
      `Archive: archives/${archiveName}`,
      `Included: ${includedSources.join(", ")}`,
      `Missing: ${missingSources.length ? missingSources.join(", ") : "none"}`,
      `Encryption: ${encryption.algorithm} / scrypt`,
      `Remote commit: ${commit}`,
      `Local encrypted copy: ${encryptedFile}`,
    ].join("\n") + "\n")
    return {
      archiveName,
      encryptedFile,
      commit,
      includedSources,
      missingSources,
    }
  } finally {
    await rm(temporaryRoot, {
      recursive: true,
      force: true,
    })
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === "--decrypt" && args.length === 3) {
    const outputFile = await decryptDebugBundle({
      inputFile: path.resolve(args[1]),
      outputFile: path.resolve(args[2]),
      passphrase: process.env.HARVESTER_ARCHIVE_PASSPHRASE,
    })
    process.stdout.write(
      `Decrypted archive: ${outputFile}\nExtract it with: tar -xzf "${outputFile}" -C <empty-output-directory>\n`,
    )
    return
  }
  await runHarvesterDebugArchive({ args })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`Harvester debug archive failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
