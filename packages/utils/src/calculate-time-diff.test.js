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

  it('returns a negative difference when end is before start', () => {
    const end = new Date('2025-12-31T23:00:00.000Z')
    assert.equal(calculateTimeDiff({ start, end }), -1)
  })
})
