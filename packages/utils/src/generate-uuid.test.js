import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateUUID } from './generate-uuid.js'

describe('generateUUID', () => {
  it('returns a valid UUID v4 string', () => {
    assert.match(generateUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('generates distinct values across calls', () => {
    assert.notEqual(generateUUID(), generateUUID())
  })
})
