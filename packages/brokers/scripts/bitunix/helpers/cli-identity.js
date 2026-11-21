import { execFileSync } from "node:child_process"

function readGitOutput({ args, repositoryRoot, runGit }) {
  try {
    return runGit("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Format a stable, human-readable executable identity.
 *
 * @param {{packageName: string, scriptName: string, packageVersion: string, commitSha: string|null, worktree: string, nodeVersion: string}} input
 * @returns {string}
 */
export function formatCliIdentity({
  packageName,
  scriptName,
  packageVersion,
  commitSha,
  worktree,
  nodeVersion,
} = {}) {
  return [
    `${packageName} ${scriptName} v${packageVersion}`,
    `commit ${commitSha || "unknown"}`,
    `worktree ${worktree || "unknown"}`,
    `Node ${nodeVersion}`,
  ].join(" | ")
}

/**
 * Resolve executable identity from the source checkout without network access.
 *
 * @param {{packageName: string, scriptName: string, packageVersion: string, repositoryRoot: string, nodeVersion?: string, runGit?: typeof execFileSync}} input
 * @returns {string}
 */
export function resolveCliIdentity({
  packageName,
  scriptName,
  packageVersion,
  repositoryRoot,
  nodeVersion = process.version,
  runGit = execFileSync,
} = {}) {
  const commitSha = readGitOutput({
    args: ["rev-parse", "HEAD"],
    repositoryRoot,
    runGit,
  })
  const worktreeStatus = readGitOutput({
    args: ["status", "--porcelain"],
    repositoryRoot,
    runGit,
  })
  let worktree = "unknown"
  if (worktreeStatus !== null) {
    worktree = worktreeStatus.length === 0 ? "clean" : "dirty"
  }
  return formatCliIdentity({
    packageName,
    scriptName,
    packageVersion,
    commitSha,
    worktree,
    nodeVersion,
  })
}
