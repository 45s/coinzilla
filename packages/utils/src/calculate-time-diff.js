import { calculateTimeDiffBetween } from './calculate-time-diff-between.js'

/**
 * Calculate end minus start in the requested unit. The result may be negative
 * when end precedes start. If end is omitted, the current time is captured.
 *
 * @param {{ start: Date, end?: Date, unit?: 'second'|'minute'|'hour' }} options
 * @returns {number} Difference expressed in the selected unit.
 * @throws {TypeError|RangeError} If either date or the unit is invalid.
 */
export const calculateTimeDiff = ({ start, end = new Date(), unit = 'hour' } = {}) =>
  calculateTimeDiffBetween({ start, end, unit })
