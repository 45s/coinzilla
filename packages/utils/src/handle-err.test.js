import assert from 'node:assert'
import { describe, it } from 'node:test'
import { handleErr as utility } from './handle-err.js'

describe(`utils/${utility.name}`, () => {
  it('should be a function', () => {
    assert(typeof utility === 'function')
  })
})
