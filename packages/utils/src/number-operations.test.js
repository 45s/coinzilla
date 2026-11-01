import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fixNumber, preciseNumber, roundNumber } from './number-operations.js'

describe('number operations', () => {
  it('rounds decimal places and preserves non-finite values', () => {
    assert.equal(roundNumber(1.045), 1.05)
    assert.equal(roundNumber(1.2345, 3), 1.235)
    assert.equal(roundNumber(Infinity), Infinity)
    assert.equal(roundNumber(-Infinity), -Infinity)
    assert.equal(Number.isNaN(roundNumber(NaN)), true)
  })

  it('fixes floating-point noise and rounds significant precision', () => {
    assert.equal(fixNumber(1.000000009), 1)
    assert.equal(fixNumber(1.23456, 3), 1.235)
    assert.equal(preciseNumber(2.0456, 4), 2.046)
  })

  it('rejects out-of-range precision values', () => {
    for (const value of [-1, 1.5, 101, NaN, Infinity, '2']) {
      assert.throws(() => roundNumber(1, value), RangeError)
      assert.throws(() => fixNumber(1, value), RangeError)
    }
    for (const value of [0, -1, 1.5, 101, NaN, Infinity, '2']) {
      assert.throws(() => preciseNumber(1, value), RangeError)
    }
  })
})
