import assert from 'node:assert'
import { describe, it } from 'node:test'
import { calculateTimeDiff as helper } from './calculate-time-diff.js'

describe(`_utils/${helper.name}`, () => {
  it('should return a time difference', () => {
    const start = new Date()
    assert(typeof helper({ start }) === 'number')
  })
})
