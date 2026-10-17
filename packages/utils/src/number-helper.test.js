import assert from 'node:assert'
import { describe, it } from 'node:test'
import { NH } from './number-helper.js'

describe(`_utils/${NH.name}`, () => {
  for (const methodName of ['round', 'fix', 'precise']) {
    it(`should has "${methodName}"`, () => {
      assert(typeof NH[methodName] === 'function')
    })
  }

  describe(`"${NH.round.name}" method`, () => {
    it('should round number', () => {
      const result = [1.045, 10, 1.777777, 9.1, 1234.5678, 1.35499998, 10.075].map((x) => NH.round(x))
      assert.deepStrictEqual(result, [1.05, 10, 1.78, 9.1, 1234.57, 1.35, 10.08])
    })
  })

  describe(`"${NH.fix.name}" method`, () => {
    const badNumber = 1.000000009
    it(`should fix bad number like "${badNumber}"`, () => {
      assert.strictEqual(NH.fix(badNumber), 1)
    })
  })

  describe(`"${NH.precise.name}" method`, () => {
    it('should precise number', () => {
      assert.strictEqual(NH.precise(0.1286, 4), 0.1286)
      assert.strictEqual(NH.precise(2.0456, 4), 2.046)
    })
  })
})
