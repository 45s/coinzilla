const unitsMap = {
  second: 1_000,
  minute: 1_000 * 60,
  hour: 1_000 * 60 * 60,
}

function assertValidDate(value, name) {
  if (!(value instanceof Date)) {
    throw new TypeError(`${name} must be a Date`)
  }
  if (Number.isNaN(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`)
  }
}

/**
 * Calculate end minus start using explicit Date inputs; does not read the clock
 * or mutate either Date. Negative results are returned when end is earlier.
 * @param {{ start: Date, end: Date, unit?: 'second'|'minute'|'hour' }} options
 * @returns {number} Difference expressed in the selected unit.
 * @throws {TypeError|RangeError} If a date or unit is invalid.
 */
export const calculateTimeDiffBetween = ({ start, end, unit = 'hour' } = {}) => {
  if (!Object.hasOwn(unitsMap, unit)) {
    throw new RangeError(`Unsupported time unit: ${unit}`)
  }

  assertValidDate(start, 'start')
  assertValidDate(end, 'end')

  return (end.getTime() - start.getTime()) / unitsMap[unit]
}
