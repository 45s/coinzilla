const unitsMap = {
  second: 1_000,
  minute: 1_000 * 60,
  hour: 1_000 * 60 * 60,
}

export const calculateTimeDiff = ({ start, end = new Date(), unit = 'hour' } = {}) => {
  if (!Object.hasOwn(unitsMap, unit)) {
    throw new RangeError(`Unsupported time unit: ${unit}`)
  }

  return (end.getTime() - start.getTime()) / unitsMap[unit]
}
