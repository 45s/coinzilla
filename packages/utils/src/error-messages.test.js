import assert from 'node:assert'
import { describe, it } from 'node:test'
import { EM } from './error-messages.js'

describe('utils/errorMessages', () => {
  it('should be an object', () => {
    assert(typeof EM === 'object')
  })
})
