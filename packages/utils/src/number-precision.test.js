import assert from 'node:assert/strict'
import test from 'node:test'
import { NH } from './number-precision.js'

for (const methodName of ['round', 'fix', 'precise']) {
  test(`has "${methodName}" method`, () => {
    assert.equal(typeof NH[methodName], 'function')
  })
}

test('rounds numbers to two fractional places by default', () => {
  const values = [1.045, 10, 1.777777, 9.1, 1234.5678, 1.35499998, 10.075]
  const roundedValues = []
  for (const value of values) {
    roundedValues.push(NH.round(value))
  }
  assert.deepStrictEqual(roundedValues, [1.05, 10, 1.78, 9.1, 1234.57, 1.35, 10.08])
})

test('rounds to requested fractional decimal places', () => {
  assert.strictEqual(NH.round(1.23456, 3), 1.235)
  assert.strictEqual(NH.round(1.23456, 0), 1)
})

for (const decimals of [-1, 1.5, 101, NaN, Infinity, '2']) {
  test(`rejects invalid round decimals: ${String(decimals)}`, () => {
    assert.throws(() => NH.round(1.23456, decimals), {
      name: 'RangeError',
      message: 'decimals must be an integer between 0 and 100',
    })
  })
}

test('preserves positive and negative infinity when rounding', () => {
  assert.strictEqual(NH.round(Infinity), Infinity)
  assert.strictEqual(NH.round(-Infinity), -Infinity)
})

test('preserves NaN when rounding', () => {
  assert(Number.isNaN(NH.round(NaN)))
})

test('fixes floating-point noise to four fractional digits by default', () => {
  assert.strictEqual(NH.fix(1.000000009), 1)
})

for (const digits of [-1, 1.5, 101, NaN, Infinity, '2']) {
  test(`rejects invalid fix digits: ${String(digits)}`, () => {
    assert.throws(() => NH.fix(1.2345, digits), {
      name: 'RangeError',
      message: 'digits must be an integer between 0 and 100',
    })
  })
}

for (const precision of [0, -1, 1.5, 101, NaN, Infinity, '2']) {
  test(`rejects invalid significant precision: ${String(precision)}`, () => {
    assert.throws(() => NH.precise(1.2345, precision), {
      name: 'RangeError',
      message: 'precision must be an integer between 1 and 100',
    })
  })
}

test('rounds to requested significant precision', () => {
  assert.strictEqual(NH.precise(0.1286, 4), 0.1286)
  assert.strictEqual(NH.precise(2.0456, 4), 2.046)
})
