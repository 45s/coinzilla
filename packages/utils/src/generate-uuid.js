import crypto from 'node:crypto'

/**
 * Generate a random RFC 4122 version 4 UUID using Node.js crypto.
 * @returns {string} Lowercase UUID string.
 */
export function generateUUID() {
  return crypto.randomUUID()
}
