import assert from 'node:assert'
import { describe, it } from 'node:test'
import { Validator, VR } from './validator.js'
import { EM } from './error-messages.js'

/**
 * @link https://dev.to/hi_iam_chris/node-test-runner-assertion-cheat-sheet-98o
 */
describe(`utils/${Validator.name}`, () => {
  it('should has static "validation" method', () => {
    assert(typeof Validator.validate === 'function')
  })

  it('should throw an error when "items" not provided', () => {
    assert.throws(Validator.validate, { message: EM.invalidParameter('items') })
  })

  it('should return "undefined" if validation pass', () => {
    const items = [
      [1, [VR.required, VR.num]],
      ['not-empty-string', [VR.required, VR.str]],
    ]
    const errors = Validator.validate({ items })
    assert.strictEqual(errors, undefined)
  })

  it('should return an object with errors, if validation failed', () => {
    const strWithSpaces = '       '
    const items = [
      [0, [VR.required, VR.str]],
      [strWithSpaces, [VR.notEmptyString, VR.num]],
      ['1', [VR.num]],
      [undefined, [VR.notUndefined]],
    ]
    assert.deepEqual(Validator.validate({ items }), [
      { value: 0, msgs: [EM.required(), EM.notString()] },
      { value: strWithSpaces, msgs: [EM.emptyString(), EM.notNumber()] },
      { value: '1', msgs: [EM.notNumber()] },
      { value: undefined, msgs: [EM.undefined()] },
    ])
  })
})
