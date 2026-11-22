import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const execFileAsync = promisify(execFile)
const REPOSITORY_ENVIRONMENT_VARIABLE = "HARVESTER_ARCHIVE_REMOTE"

const INITIAL_README = `# Harvester archives

Private repository for locally generated Harvester operational-state archives.

The repository is initialized with an empty \`archives/\` directory only.
Do not commit plaintext operational data to the public Coinzilla source repository.
Archive encryption and the reset workflow are being implemented separately.
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
 * Initialize an empty private archive repository with a tracked archives/ placeholder.
 * This deliberately refuses non-empty repositories and never force-pushes.
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
    const existingRefs = await runCommand(["ls-remote", "--refs", remote], { cwd: workingDirectory })
    if (existingRefs) {
      throw new Error(
        "Archive repository is not empty; refusing to initialize or modify existing refs. Verify the configured repository before retrying.",
      )
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
  const result = await initializePrivateArchiveRepository()
  process.stdout.write(
    `Private archive repository initialized and push access verified: ${result.remote} (main)\n`,
  )
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
