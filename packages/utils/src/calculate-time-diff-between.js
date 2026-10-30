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
 * Calculate a time difference using only explicit inputs.
 * This function does not read the clock or mutate the supplied Date objects.
 */
export const calculateTimeDiffBetween = ({ start, end, unit = 'hour' } = {}) => {
  if (!Object.hasOwn(unitsMap, unit)) {
    throw new RangeError(`Unsupported time unit: ${unit}`)
  }

  assertValidDate(start, 'start')
  assertValidDate(end, 'end')

  return (end.getTime() - start.getTime()) / unitsMap[unit]
}
