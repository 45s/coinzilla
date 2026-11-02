import { validateWaitDuration } from './wait-duration.js'

/**
 * Resolve after a bounded, non-negative delay in milliseconds.
 * A missing duration retains the historical near-immediate timer behavior.
 */
export const wait = async (milliseconds = 0) => {
  const delay = validateWaitDuration(milliseconds)
  return new Promise((resolve) => setTimeout(resolve, delay))
}
