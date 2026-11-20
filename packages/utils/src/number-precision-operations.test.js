import assert from 'node:assert/strict'
import test from 'node:test'
import { fixNumber, preciseNumber, roundNumber } from './number-precision-operations.js'

test('rounds decimal places and preserves non-finite values', () => {
  assert.equal(roundNumber({ number: 1.045 }), 1.05)
  assert.equal(roundNumber({ number: 1.2345, decimals: 3 }), 1.235)
  assert.equal(roundNumber({ number: Infinity }), Infinity)
  assert.equal(roundNumber({ number: -Infinity }), -Infinity)
  assert.equal(Number.isNaN(roundNumber({ number: NaN })), true)
})

test('fixes floating-point noise and rounds significant precision', () => {
  assert.equal(fixNumber({ number: 1.000000009 }), 1)
  assert.equal(fixNumber({ number: 1.23456, digits: 3 }), 1.235)
  assert.equal(preciseNumber({ number: 2.0456, precision: 4 }), 2.046)
})

for (const value of [-1, 1.5, 101, NaN, Infinity, '2']) {
  test(`rejects invalid decimal-place count: ${String(value)}`, () => {
    assert.throws(() => roundNumber({ number: 1, decimals: value }), RangeError)
    assert.throws(() => fixNumber({ number: 1, digits: value }), RangeError)
  })
}

for (const value of [0, -1, 1.5, 101, NaN, Infinity, '2']) {
  test(`rejects invalid significant precision: ${String(value)}`, () => {
    assert.throws(() => preciseNumber({ number: 1, precision: value }), RangeError)
  })
}
