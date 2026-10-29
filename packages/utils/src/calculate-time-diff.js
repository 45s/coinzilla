import { calculateTimeDiffBetween } from './calculate-time-diff-between.js'

/**
 * Calculate the difference between two dates. When end is omitted, use the current time.
 */
export const calculateTimeDiff = ({ start, end = new Date(), unit = 'hour' } = {}) =>
  calculateTimeDiffBetween({ start, end, unit })
