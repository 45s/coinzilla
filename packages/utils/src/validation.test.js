import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRequiredNotEmptyString, isRequiredNumberValid, validateItems, VR } from './validation.js'

describe('pure validation helpers', () => {
  it('validates valid values without mutating input tuples', () => {
    const items = [[42, [VR.required, VR.num], 'amount']]
    const before = structuredClone(items)
    assert.equal(validateItems({ items }), undefined)
    assert.deepEqual(items, before)
  })

  it('returns structured validation failures', () => {
    assert.deepEqual(validateItems({ items: [[0, [VR.required, VR.num], 'amount']] }), [
      { value: 0, msgs: ['Field is required'], fieldName: 'amount' },
    ])
  })

  it('rejects malformed item tuples and non-array rules', () => {
    assert.throws(() => validateItems({ items: [null] }), {
      name: 'TypeError',
      message: 'Validation item at index 0 must be [value, rules, fieldName?]',
    })
    assert.throws(() => validateItems({ items: [['value', null]] }), TypeError)
    assert.throws(() => validateItems({ items: [['value']] }), TypeError)
  })

  it('exposes deterministic required-field predicates', () => {
    assert.equal(isRequiredNumberValid(1), true)
    assert.equal(isRequiredNumberValid(0), false)
    assert.equal(isRequiredNumberValid(Infinity), false)
    assert.equal(isRequiredNotEmptyString(' value '), true)
    assert.equal(isRequiredNotEmptyString('  '), false)
    assert.equal(isRequiredNotEmptyString(1), false)
  })
})
