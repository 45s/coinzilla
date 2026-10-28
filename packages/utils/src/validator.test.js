import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Validator, VR } from './validator.js'
import { EM } from './error-messages.js'

describe('Validator', () => {
  it('throws when items are missing or not an array', () => {
    assert.throws(() => Validator.validate(), { message: EM.invalidParameter('items') })
    assert.throws(() => Validator.validate({ items: {} }), { message: EM.invalidParameter('items') })
  })

  it('returns undefined when all rules pass', () => {
    const items = [
      [42, [VR.required, VR.num, VR.notUndefined], 'price'],
      ['BTC', [VR.required, VR.str, VR.notEmptyString], 'symbol'],
      [[1], [VR.arr, VR.notEmptyArr], 'values'],
    ]

    assert.equal(Validator.validate({ items }), undefined)
  })

  it('collects all applicable validation errors and field names', () => {
    const items = [
      [0, [VR.required, VR.str], 'quantity'],
      ['   ', [VR.notEmptyString, VR.num], 'symbol'],
      [undefined, [VR.notUndefined], 'timestamp'],
      ['not-an-array', [VR.arr], 'items'],
      [[], [VR.notEmptyArr], 'orders'],
    ]

    assert.deepEqual(Validator.validate({ items }), [
      { value: 0, msgs: [EM.required(), EM.notString()], fieldName: 'quantity' },
      { value: '   ', msgs: [EM.emptyString(), EM.notNumber()], fieldName: 'symbol' },
      { value: undefined, msgs: [EM.undefined()], fieldName: 'timestamp' },
      { value: 'not-an-array', msgs: [EM.arr()], fieldName: 'items' },
      { value: [], msgs: [EM.emptyArray()], fieldName: 'orders' },
    ])
  })

  it('omits fieldName when none is supplied', () => {
    assert.deepEqual(Validator.validate({ items: [['x', [VR.num]]] }), [
      { value: 'x', msgs: [EM.notNumber()] },
    ])
  })

  it('throws the collected errors when soft mode is disabled', () => {
    assert.throws(
      () => Validator.validate({ isSoft: false, items: [['x', [VR.num]]] }),
      (error) => Array.isArray(error) && error[0].msgs[0] === EM.notNumber(),
    )
  })

  it('handles invalid values safely with the non-empty-array rule', () => {
    for (const value of [undefined, null, 'not-an-array', 42]) {
      assert.deepEqual(Validator.validate({ items: [[value, [VR.notEmptyArr]]] }), [
        { value, msgs: [EM.emptyArray()] },
      ])
    }
  })

  it('rejects non-finite values in required-number validation', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.equal(Validator.isRequiredNumberValid(value), false)
    }
  })

  it('returns booleans from required-value helpers', () => {
    assert.equal(Validator.isRequiredNumberValid(5), true)
    assert.equal(Validator.isRequiredNumberValid(0), false)
    assert.equal(Validator.isRequiredNumberValid('5'), false)
    assert.equal(Validator.isRequiredNotEmptyString('  BTC  '), true)
    assert.equal(Validator.isRequiredNotEmptyString('   '), false)
    assert.equal(Validator.isRequiredNotEmptyString(123), false)
  })
})
