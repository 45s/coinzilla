function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value ?? ""))
  return match ? match.slice(1).map(Number) : null
}

function isAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true
    if (version[index] < minimum[index]) return false
  }

  return true
}

/**
 * Check whether a bundled Undici version meets the patched minimum for its major.
 *
 * @param {string|undefined} value
 * @returns {boolean}
 */
export function isSafeUndiciVersion(value) {
  const version = parseVersion(value)
  if (!version) return false

  const minimumByMajor = {
    6: [6, 29, 1],
    7: [7, 30, 1],
    8: [8, 12, 2],
  }
  const minimum = minimumByMajor[version[0]]

  return Boolean(minimum && isAtLeast(version, minimum))
}

/**
 * Enforce the broker's supported Node.js and patched Undici runtime floor.
 *
 * @param {{nodeVersion?: string, undiciVersion?: string}} [versions]
 * @returns {void}
 * @throws {Error} If Node.js or bundled Undici is missing or below the supported version.
 */
export function assertNativeWebSocketRuntime({
  nodeVersion = process.versions.node,
  undiciVersion = process.versions.undici,
} = {}) {
  const node = parseVersion(nodeVersion)
  if (!node || !isAtLeast(node, [22, 23, 4])) {
    throw new Error(
      `Native Binance WebSocket requires Node.js >=22.23.4 (received ${nodeVersion ?? "unknown"})`,
    )
  }

  if (!isSafeUndiciVersion(undiciVersion)) {
    throw new Error(
      `Native Binance WebSocket requires a patched Undici version (received ${undiciVersion ?? "unknown"})`,
    )
  }
}
