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
