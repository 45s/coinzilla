import assert from 'node:assert'
import { describe, it } from 'node:test'
import { checkIfFeatureEnable as util } from './check-if-feature-enable.js'

describe(`utils/${util.name}`, () => {
  it('should be a function', () => {
    assert(typeof util === 'function')
  })
})
