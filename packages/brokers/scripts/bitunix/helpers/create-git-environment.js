/**
 * Remove Bitunix API credentials before invoking Git while preserving configured GitHub auth.
 *
 * @param {{env: NodeJS.ProcessEnv}} input
 * @returns {NodeJS.ProcessEnv}
 */
export function createGitEnvironment({ env }) {
  if (!env || typeof env !== "object") {
    throw new TypeError("Git environment creation requires an explicit environment object")
  }
  return Object.fromEntries(
    Object.entries(env).filter(([name]) =>
      name !== "BITUNIX_API_KEY" && name !== "BITUNIX_API_SECRET"),
  )
}
