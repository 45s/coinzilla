import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateTimeDiffBetween } from './calculate-time-diff-between.js'

describe('calculateTimeDiffBetween', () => {
  it('returns the same result for repeated calls with the same inputs', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const end = new Date('2026-01-01T02:30:00.000Z')

    assert.equal(calculateTimeDiffBetween({ start, end }), 2.5)
    assert.equal(calculateTimeDiffBetween({ start, end }), 2.5)
  })

  it('does not mutate the supplied Date objects', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const end = new Date('2026-01-01T01:00:00.000Z')
    const originalStart = start.getTime()
    const originalEnd = end.getTime()

    calculateTimeDiffBetween({ start, end })

    assert.equal(start.getTime(), originalStart)
    assert.equal(end.getTime(), originalEnd)
  })

  it('requires an explicit end date', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    assert.throws(
      () => calculateTimeDiffBetween({ start }),
      { name: 'TypeError', message: 'end must be a Date' },
    )
  })

  it('validates dates and supported units', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const end = new Date('2026-01-01T01:00:00.000Z')

    assert.throws(
      () => calculateTimeDiffBetween({ start, end, unit: 'day' }),
      { name: 'RangeError', message: 'Unsupported time unit: day' },
    )
    assert.throws(
      () => calculateTimeDiffBetween({ start: new Date('invalid'), end }),
      { name: 'RangeError', message: 'start must be a valid Date' },
    )
  })
})
