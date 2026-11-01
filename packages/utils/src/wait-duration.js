const MAX_TIMER_DELAY = 2_147_483_647

/**
 * Validate the millisecond delay accepted by Node.js timers.
 * Returns the original value so fractional-delay behavior remains unchanged.
 */
export function validateWaitDuration(milliseconds) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) {
    throw new TypeError('wait duration must be a finite number of milliseconds')
  }

  if (milliseconds < 0 || milliseconds > MAX_TIMER_DELAY) {
    throw new RangeError(`wait duration must be between 0 and ${MAX_TIMER_DELAY} milliseconds`)
  }

  return milliseconds
}
