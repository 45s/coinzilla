/**
 * Parse package globs from the repository's pnpm-workspace.yaml.
 * @param {{workspaceManifest: string}} options
 * @returns {string[]}
 */
export function parsePnpmWorkspacePatterns() {
  return []
}

/**
 * Read direct workspace package manifests matching declared pnpm patterns.
 * @param {{repositoryRoot: string, patterns: string[]}} options
 * @returns {Array<{file: string, name: string, manifest: object}>}
 */
export function discoverWorkspacePackages() {
  return []
}
