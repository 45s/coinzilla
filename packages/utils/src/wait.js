import { validateWaitDuration } from './wait-duration.js'

/**
 * Resolve after a bounded, non-negative delay in milliseconds.
 * A missing duration retains the historical near-immediate timer behavior.
 *
 * @param {number} [milliseconds=0] Delay from 0 through 2,147,483,647 ms.
 * @returns {Promise<void>} Resolves when the timer fires.
 * @throws {TypeError|RangeError} Rejects when the duration is not finite or is out of range.
 */
export const wait = async (milliseconds = 0) => {
  const delay = validateWaitDuration(milliseconds)
  return new Promise((resolve) => setTimeout(resolve, delay))
}
