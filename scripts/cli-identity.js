import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Resolve source identity from the checkout that owns an executable.
 *
 * @param {{packageRoot: string, repositoryRoot: string, scriptName: string, exec?: typeof execFileSync, readFile?: typeof readFileSync}} options
 * @returns {{packageName: string, scriptName: string, packageVersion: string, commitSha: string|null, worktree: string, nodeVersion: string}}
 */
export function resolveCliIdentity({
  packageRoot,
  repositoryRoot,
  scriptName,
  exec = execFileSync,
  readFile = readFileSync,
} = {}) {
  const metadata = JSON.parse(readFile(resolve(packageRoot, "package.json"), "utf8"))
  const readGit = (args) => {
    try {
      return exec("git", args, {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
    } catch {
      return null
    }
  }
  const commitSha = readGit(["rev-parse", "HEAD"])
  const status = readGit(["status", "--porcelain"])
  let worktree = "unknown"
  if (status !== null) {
    worktree = status.length === 0 ? "clean" : "dirty"
  }
  return {
    packageName: metadata.name ?? "unknown",
    scriptName,
    packageVersion: metadata.version ?? "unknown",
    commitSha,
    worktree,
    nodeVersion: process.version,
  }
}

/**
 * @param {ReturnType<typeof resolveCliIdentity>} identity
 * @returns {string}
 */
export function formatCliIdentity(identity) {
  return [
    `${identity.packageName} ${identity.scriptName} v${identity.packageVersion}`,
    `commit ${identity.commitSha || "unknown"}`,
    `worktree ${identity.worktree || "unknown"}`,
    `Node ${identity.nodeVersion}`,
  ].join(" | ")
}

/**
 * Resolve and print the executable identity.
 *
 * @param {{packageRoot: string, repositoryRoot: string, scriptName: string, stdout?: NodeJS.WriteStream}} options
 * @returns {string}
 */
export function printCliIdentity({ stdout = process.stdout, ...options } = {}) {
  const identity = formatCliIdentity(resolveCliIdentity(options))
  stdout.write(`${identity}\n`)
  return identity
}
