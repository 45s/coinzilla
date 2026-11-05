/**
 * @typedef {Object} UserDataClientPortEvent
 * @property {"event"|"terminated"} type
 * @property {number} subscriptionId
 * @property {object} event
 * @property {string|null} [deduplicationKey]
 * @property {number|null} [eventTime]
 */

/**
 * Application-facing boundary for an exchange user-data client.
 *
 * Implementations normalize exchange-specific response envelopes and event
 * payloads before exposing them through this contract.
 *
 * @typedef {Object} UserDataClientPort
 * @property {string} state
 * @property {() => Promise<unknown>} connect
 * @property {() => Promise<unknown>} disconnect
 * @property {(listener: (message: UserDataClientPortEvent) => void) => (() => void)|void} onEvent
 * @property {(listener: (error: Error) => void) => (() => void)|void} onError
 * @property {(listener: (event: unknown) => void) => (() => void)|void} onClose
 * @property {() => Promise<number|null>} subscribe
 * @property {() => Promise<unknown[]|null>} listSubscriptions
 * @property {(subscriptionId: number) => Promise<void>} unsubscribe
 */

const REQUIRED_METHODS = Object.freeze([
  "connect",
  "disconnect",
  "onEvent",
  "onError",
  "onClose",
  "subscribe",
  "listSubscriptions",
  "unsubscribe",
])

/**
 * Validate an injected user-data client port at the application boundary.
 *
 * @param {unknown} port
 * @returns {UserDataClientPort}
 */
export function assertUserDataClientPort(port) {
  if (port === null || typeof port !== "object") {
    throw new TypeError("User-data client port must be an object")
  }
  if (typeof port.state !== "string" || port.state.length === 0) {
    throw new TypeError("User-data client port must expose a string state")
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`User-data client port requires ${method}()`)
    }
  }

  return port
}
