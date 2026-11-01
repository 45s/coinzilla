import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateWaitDuration } from './wait-duration.js'

describe('validateWaitDuration', () => {
  it('accepts finite delays within the Node timer range', () => {
    assert.equal(validateWaitDuration(0), 0)
    assert.equal(validateWaitDuration(1.5), 1.5)
    assert.equal(validateWaitDuration(2_147_483_647), 2_147_483_647)
  })

  it('rejects non-numeric and non-finite delays', () => {
    for (const value of [undefined, null, '10', NaN, Infinity, -Infinity]) {
      assert.throws(() => validateWaitDuration(value), TypeError)
    }
  })

  it('rejects negative and out-of-range delays', () => {
    for (const value of [-1, 2_147_483_648]) {
      assert.throws(() => validateWaitDuration(value), RangeError)
    }
  })
})
