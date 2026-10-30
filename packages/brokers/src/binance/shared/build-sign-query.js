const RECEIVE_WINDOW = 5000

/**
 * Builds the Binance signing query for a supplied millisecond timestamp.
 * Pure by design: no clock reads, mutation, or external dependencies.
 */
export function buildSignQuery(timestamp) {
  return `recvWindow=${RECEIVE_WINDOW}&timestamp=${timestamp}`
}
