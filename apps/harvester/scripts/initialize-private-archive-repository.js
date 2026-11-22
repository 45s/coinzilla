import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { captureBuildMetadata } from "@coinzilla/utils"
import packageMetadata from "../package.json" with { type: "json" }

const execFileAsync = promisify(execFile)
const REPOSITORY_ENVIRONMENT_VARIABLE = "HARVESTER_ARCHIVE_REMOTE"

const INITIAL_README = `# Harvester archives

Private repository for locally generated Harvester operational-state archives.

The repository is initialized with an empty \`archives/\` directory only.
Do not commit plaintext operational data to the public Coinzilla source repository.
TESTNET archive snapshots exclude the LIVE production database directory.
`

export function validateArchiveRemote(remote) {
  if (typeof remote !== "string" || remote.trim() !== remote || remote.length === 0) {
    throw new TypeError(`${REPOSITORY_ENVIRONMENT_VARIABLE} must contain a GitHub repository URL`)
  }

  const httpsMatch = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote)
  const sshMatch = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote)
  const sshUrlMatch = /^ssh:\/\/git@github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(remote)

  const match = httpsMatch ?? sshMatch ?? sshUrlMatch
  if (!match || match[1] === "." || match[2] === "." || match[2] === "..") {
    throw new TypeError(
      `${REPOSITORY_ENVIRONMENT_VARIABLE} must be an HTTPS or SSH URL for github.com/owner/repository`,
    )
  }
  return remote
}

async function runGit(args, { cwd } = {}) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

/**
 * Initialize an empty private archive repository, or safely recognize its existing main branch.
 * Existing repositories are never cloned, modified, or pushed to by this command.
 */
export async function initializePrivateArchiveRepository({
  env = process.env,
  runCommand = runGit,
  createTemporaryDirectory = (prefix) => mkdtemp(path.join(os.tmpdir(), prefix)),
  removeTemporaryDirectory = (directory) => rm(directory, { recursive: true, force: true }),
  createDirectory = mkdir,
  write = writeFile,
} = {}) {
  const remote = validateArchiveRemote(env?.[REPOSITORY_ENVIRONMENT_VARIABLE])
  const workingDirectory = await createTemporaryDirectory("coinzilla-harvester-archive-init-")

  try {
    const existingBranches = await runCommand(["ls-remote", "--heads", remote], { cwd: workingDirectory })
    if (existingBranches) {
      const branchReferences = existingBranches
        .split("\n")
        .map((line) => line.trim().split(/\s+/).at(-1))
        .filter(Boolean)
      if (branchReferences.length !== 1 || branchReferences[0] !== "refs/heads/main") {
        throw new Error(
          "Archive repository contains unexpected branches; refusing to initialize or modify existing refs.",
        )
      }

      return Object.freeze({
        remote,
        branch: "main",
        initialized: false,
        alreadyInitialized: true,
      })
    }

    await runCommand(["init", "--initial-branch=main"], { cwd: workingDirectory })
    await runCommand(["remote", "add", "origin", remote], { cwd: workingDirectory })
    await createDirectory(path.join(workingDirectory, "archives"), { recursive: true })
    await write(
      path.join(workingDirectory, "README.md"),
      INITIAL_README,
      { encoding: "utf8", flag: "wx" },
    )
    await write(
      path.join(workingDirectory, "archives", ".gitkeep"),
      "Archive artifacts will be written here by the Harvester archive workflow.\n",
      { encoding: "utf8", flag: "wx" },
    )
    await runCommand(["add", "README.md", "archives/.gitkeep"], { cwd: workingDirectory })
    await runCommand([
      "-c", "user.name=Coinzilla Harvester",
      "-c", "user.email=harvester-archive@users.noreply.github.com",
      "commit", "-m", "chore(archive): initialize private archive repository",
    ], { cwd: workingDirectory })
    await runCommand(["push", "--set-upstream", "origin", "main"], { cwd: workingDirectory })

    return Object.freeze({
      remote,
      branch: "main",
      initialized: true,
    })
  } finally {
    await removeTemporaryDirectory(workingDirectory)
  }
}

async function main() {
  const metadata = captureBuildMetadata({
    application: "harvester-archive-repository-init",
    version: packageMetadata.version,
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    env: process.env,
  })
  const identity = [
    `harvester-archive-repository-init ${packageMetadata.version}`,
    `commit ${metadata.source.commit ?? "unknown"}`,
    `worktree ${metadata.source.workingTree}`,
    `node ${process.version}`,
  ].join(" | ")
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(identity + "\n")
    return
  }
  if (args.length > 0) {
    throw new TypeError("Usage: archive:repo:init [--version]")
  }
  process.stdout.write(identity + "\n")
  const result = await initializePrivateArchiveRepository()
  const status = result.alreadyInitialized
    ? "already initialized; no changes made"
    : "initialized and push access verified"
  process.stdout.write(`Private archive repository ${status}: ${result.remote} (main)\n`)
}

const isDirectExecution = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`Archive repository initialization failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
