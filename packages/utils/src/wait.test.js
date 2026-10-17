import assert from 'node:assert'
import { describe, it } from 'node:test'
import { wait as helper } from './wait.js'

describe(`_utils/${helper.name}`, () => {
  it('should return a promise', () => {
    assert(helper(50) instanceof Promise)
  })
})
