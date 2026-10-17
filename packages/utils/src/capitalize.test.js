import assert from 'node:assert'
import { describe, it } from 'node:test'
import { capitalize } from './capitalize.js'

describe(`${capitalize.name}`, () => {
  it('should capitalize string', () => {
    assert(capitalize('abc'), 'ABC')
  })
})
