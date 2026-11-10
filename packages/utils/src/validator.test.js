import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Validator, VR } from './validator.js'
import { EM } from './error-messages.js'

describe('Validator', () => {
  it('throws when items are missing or not an array', () => {
    assert.throws(() => Validator.validate(), { message: EM.invalidParameter('items') })
    assert.throws(() => Validator.validate({ items: {} }), { message: EM.invalidParameter('items') })
  })

  it('rejects malformed validation tuples with a descriptive error', () => {
    assert.throws(() => Validator.validate({ items: [null] }), {
      name: 'TypeError',
      message: 'Validation item at index 0 must be [value, rules, fieldName?]',
    })
    assert.throws(() => Validator.validate({ items: [['value', null]] }), TypeError)
  })

  it('returns undefined when all rules pass', () => {
    const items = [
      [42, [VR.required, VR.num, VR.notUndefined], 'price'],
      ['BTC', [VR.required, VR.str, VR.notEmptyString], 'symbol'],
      [[1], [VR.arr, VR.notEmptyArr], 'values'],
      [() => {}, [VR.fn], 'callback'],
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
      ['not-a-function', [VR.fn], 'callback'],
    ]

    assert.deepEqual(Validator.validate({ items }), [
      { value: 0, msgs: [EM.required(), EM.notString()], fieldName: 'quantity' },
      { value: '   ', msgs: [EM.emptyString(), EM.notNumber()], fieldName: 'symbol' },
      { value: undefined, msgs: [EM.undefined()], fieldName: 'timestamp' },
      { value: 'not-an-array', msgs: [EM.arr()], fieldName: 'items' },
      { value: [], msgs: [EM.emptyArray()], fieldName: 'orders' },
      { value: 'not-a-function', msgs: [EM.notFunction()], fieldName: 'callback' },
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

  it('rejects non-boolean isSoft values when the option is explicitly supplied', () => {
    const invalidModes = ['false', 'true', 0, 1, null, undefined]

    for (const isSoft of invalidModes) {
      assert.throws(
        () => Validator.validate({ isSoft, items: [['not-a-number', [VR.num]]] }),
        { name: 'TypeError' },
        `Validator must reject the explicitly supplied ${String(isSoft)} isSoft value instead of interpreting it by truthiness`,
      )
    }
  })

  it('defaults to soft mode when isSoft is omitted', () => {
    assert.deepEqual(
      Validator.validate({ items: [['not-a-number', [VR.num]]] }),
      [{ value: 'not-a-number', msgs: [EM.notNumber()] }],
      'Omitting isSoft must preserve the documented default soft mode and return validation errors',
    )
  })

  it('preserves the documented valid edge semantics for every supported rule', () => {
    const items = [
      ['   ', [VR.required], 'truthyWhitespace'],
      [0, [VR.num], 'zeroNumber'],
      ['', [VR.str], 'emptyString'],
      [() => {}, [VR.fn], 'callback'],
      [null, [VR.notUndefined], 'nullableValue'],
      [[], [VR.arr], 'emptyArray'],
      [[1], [VR.notEmptyArr], 'nonEmptyArray'],
      ['value', [VR.notEmptyString], 'nonEmptyString'],
    ]

    assert.equal(
      Validator.validate({ items }),
      undefined,
      'Every supported VR rule must preserve its documented valid edge cases, including zero, empty strings, null, and empty arrays where allowed',
    )
  })

  it('uses JavaScript truthiness for the required rule', () => {
    const items = [
      [0, [VR.required], 'zero'],
      [false, [VR.required], 'false'],
      ['', [VR.required], 'emptyString'],
      [null, [VR.required], 'null'],
      [undefined, [VR.required], 'undefined'],
    ]

    assert.deepEqual(
      Validator.validate({ items }),
      [
        { value: 0, msgs: [EM.required()], fieldName: 'zero' },
        { value: false, msgs: [EM.required()], fieldName: 'false' },
        { value: '', msgs: [EM.required()], fieldName: 'emptyString' },
        { value: null, msgs: [EM.required()], fieldName: 'null' },
        { value: undefined, msgs: [EM.required()], fieldName: 'undefined' },
      ],
      'VR.required must reject every falsey value while allowing truthy values such as whitespace-only strings',
    )
  })

  it('rejects non-finite values with the number rule', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.deepEqual(Validator.validate({ items: [[value, [VR.num]]] }), [
        { value, msgs: [EM.notNumber()] },
      ])
    }
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

  it('ignores entries with an empty rules list', () => {
    assert.equal(Validator.validate({ items: [['anything', []], [undefined, []]] }), undefined)
  })

  it('reports non-string values for the non-empty-string rule without throwing', () => {
    for (const value of [undefined, null, 0, 123, false, {}]) {
      assert.deepEqual(Validator.validate({ items: [[value, [VR.notEmptyString], 'field']] }), [
        { value, msgs: [EM.emptyString()], fieldName: 'field' },
      ])
    }
  })
})
