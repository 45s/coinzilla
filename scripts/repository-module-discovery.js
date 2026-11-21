/**
 * Return the deterministic inventory of production JavaScript source modules.
 * @param {{repositoryRoot: string}} options
 * @returns {Array<{file: string, source: string}>}
 */
export function collectRepositoryJavaScriptModules() {
  return []
}

/**
 * Determine whether a repository-relative JavaScript path is production source.
 * @param {{file: string}} options
 * @returns {boolean}
 */
export function isProductionModulePath() {
  return false
}
