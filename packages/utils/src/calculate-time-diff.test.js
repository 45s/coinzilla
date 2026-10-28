import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateTimeDiff } from './calculate-time-diff.js'

describe('calculateTimeDiff', () => {
  const start = new Date('2026-01-01T00:00:00.000Z')

  it('calculates differences in hours by default', () => {
    const end = new Date('2026-01-01T02:30:00.000Z')
    assert.equal(calculateTimeDiff({ start, end }), 2.5)
  })

  it('supports seconds, minutes, and hours', () => {
    const end = new Date('2026-01-01T01:02:03.000Z')
    assert.equal(calculateTimeDiff({ start, end, unit: 'second' }), 3723)
    assert.equal(calculateTimeDiff({ start, end, unit: 'minute' }), 62.05)
    assert.equal(calculateTimeDiff({ start, end, unit: 'hour' }), 1.0341666666666667)
  })

  it('rejects unsupported time units instead of returning NaN', () => {
    assert.throws(
      () => calculateTimeDiff({ start, unit: 'day' }),
      { name: 'RangeError', message: 'Unsupported time unit: day' },
    )
  })

  it('rejects inherited object property names as time units', () => {
    assert.throws(
      () => calculateTimeDiff({ start, unit: 'toString' }),
      { name: 'RangeError', message: 'Unsupported time unit: toString' },
    )
  })

  it('returns a negative difference when end is before start', () => {
    const end = new Date('2025-12-31T23:00:00.000Z')
    assert.equal(calculateTimeDiff({ start, end }), -1)
  })
})
