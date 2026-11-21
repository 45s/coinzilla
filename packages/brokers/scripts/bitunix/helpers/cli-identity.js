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
 * @param {{scriptName: string, packageVersion: string, commitSha: string|null, worktree: string, nodeVersion: string}} input
 * @returns {string}
 */
export function formatCliIdentity({
  scriptName,
  packageVersion,
  commitSha,
  worktree,
  nodeVersion,
} = {}) {
  return [
    `${scriptName} v${packageVersion}`,
    `commit ${commitSha || "unknown"}`,
    `worktree ${worktree || "unknown"}`,
    `Node ${nodeVersion}`,
  ].join(" | ")
}

/**
 * Resolve executable identity from the source checkout without network access.
 *
 * @param {{scriptName: string, packageVersion: string, repositoryRoot: string, nodeVersion?: string, runGit?: typeof execFileSync}} input
 * @returns {string}
 */
export function resolveCliIdentity({
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
  const worktree = worktreeStatus === null
    ? "unknown"
    : worktreeStatus.length === 0
      ? "clean"
      : "dirty"
  return formatCliIdentity({
    scriptName,
    packageVersion,
    commitSha,
    worktree,
    nodeVersion,
  })
}
