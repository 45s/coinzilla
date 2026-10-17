import assert from 'node:assert'
import { describe, it } from 'node:test'
import { generateUUID } from './generate-uuid.js'

describe(`_utils/${generateUUID.name}`, () => {
  it('should return a string with UUID format', () => {
    const uuid = generateUUID()
    assert(typeof uuid === 'string')
    assert(uuid.length === 36)
    assert(uuid.includes('-'))
  })
})
