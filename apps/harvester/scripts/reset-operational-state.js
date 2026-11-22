import { lstat, mkdir, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { captureBuildMetadata } from "@coinzilla/utils"
import packageMetadata from "../package.json" with { type: "json" }
import { resolveOperationalStateDirectory } from "../src/infrastructure/operational-state/resolve-directory.js"

const PACKAGE_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_PROCESS_LOCK_DIRECTORY = path.join(os.homedir(), ".coinzilla", "harvester", "process-locks")

function createResetIdentity({ env = process.env } = {}) {
  const metadata = captureBuildMetadata({
    application: "harvester-operational-state-reset",
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

async function assertNoProcessLocks({ lockDirectory = DEFAULT_PROCESS_LOCK_DIRECTORY } = {}) {
  let directoryStats
  try {
    directoryStats = await lstat(lockDirectory)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return
    }
    throw error
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error("Harvester process-lock directory is not a regular directory; refusing operational-state reset.")
  }
  const entries = await readdir(lockDirectory, { withFileTypes: true })
  const lockFiles = entries.filter((entry) => entry.name.endsWith(".lock"))
  if (lockFiles.length > 0) {
    throw new Error(
      "A Harvester process lock exists; stop Harvester and verify stale lock ownership before resetting operational state.",
    )
  }
}

function resolveResetDirectory({ env } = {}) {
  const directory = resolveOperationalStateDirectory({ env })
  if (path.basename(directory) !== "recovery-facts" || path.parse(directory).root === directory) {
    throw new Error("Operational-state reset is restricted to a directory named recovery-facts.")
  }
  return directory
}

/**
 * Remove only the configured Harvester Operational State Store for a stopped DEV process.
 *
 * @param {{args?: string[], env?: object, lockDirectory?: string}} options
 * @returns {Promise<{directory: string, removed: boolean}>}
 */
export async function runHarvesterOperationalStateReset({
  args = process.argv.slice(2),
  env = process.env,
  lockDirectory = DEFAULT_PROCESS_LOCK_DIRECTORY,
} = {}) {
  if (env.TRADING_MODE !== "testnet") {
    throw new Error("Operational-state reset requires TRADING_MODE=testnet; LIVE and unspecified modes are rejected.")
  }
  if (args.length !== 1 || args[0] !== "--confirm") {
    throw new TypeError("Usage: operational-state:reset:dev -- --confirm")
  }

  await assertNoProcessLocks({ lockDirectory })
  const directory = resolveResetDirectory({ env })
  let directoryStats
  try {
    directoryStats = await lstat(directory)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { directory, removed: false }
    }
    throw error
  }
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error("The recovery-facts reset target must be a real directory, not a symbolic link or file.")
  }

  await rm(directory, { recursive: true, force: false })
  return { directory, removed: true }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(createResetIdentity() + "\n")
    return
  }
  process.stdout.write(createResetIdentity() + "\n")
  const result = await runHarvesterOperationalStateReset({ args })
  process.stdout.write(
    result.removed
      ? `Removed only recovery-facts: ${result.directory}\n`
      : `No recovery-facts directory existed; nothing was removed: ${result.directory}\n`,
  )
  process.stdout.write("The next Harvester startup will initialize an empty Operational State Store. Logs, databases, Journal sessions and archives were not changed.\n")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`Harvester operational-state reset refused: ${error.message}\n`)
    process.exitCode = 1
  }
}
