import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EM } from './error-messages.js'

describe('utils/errorMessages', () => {
  it('should be an object', () => {
    assert.equal(typeof EM, 'object')
  })
})

it('formats parameterized and required-field messages', () => {
  assert.equal(EM.oneBrokerMustBeProvided(), 'At least one broker must be provided')
  assert.equal(EM.brokerNotSupported('Example'), 'Broker "Example" not supported yet')
  assert.equal(EM.notImplemented('cancel'), 'cancel not implemented')
  assert.equal(EM.invalidConfig(), 'Invalid configuration')
  assert.equal(EM.invalidOperationName('trade'), "Invalid operation name 'trade'")
  assert.equal(EM.methodShouldBeImplemented('getPrice'), '"getPrice" method must be implemented')
  assert.equal(EM.invalidParameter('symbol'), 'Invalid "symbol" parameter')
  assert.equal(EM.required('symbol'), 'Field "symbol" is required')
  assert.equal(EM.required(), 'Field is required')
})

it('uses distinct messages for empty strings and arrays', () => {
  assert.equal(EM.emptyString(), 'Empty string not allowed')
  assert.equal(EM.emptyArray(), 'Empty array not allowed')
  assert.equal(EM.notFunction(), 'Must be a function')
})
