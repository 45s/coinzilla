import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatLogContent } from './format-log-content.js'

describe('formatLogContent', () => {
  it('preserves primitive values and serializes structured values', () => {
    assert.equal(formatLogContent('message'), 'message')
    assert.equal(formatLogContent(42), 42)
    assert.equal(formatLogContent(true), true)
    assert.equal(formatLogContent({ message: 'hello' }), '{\n  "message": "hello"\n}')
  })

  it('falls back for circular and BigInt-containing objects', () => {
    const circular = {}
    circular.self = circular
    assert.equal(formatLogContent(circular), '[object Object]')
    assert.equal(formatLogContent({ amount: 1n }), '[object Object]')
  })

  it('does not throw when both serialization and string coercion fail', () => {
    const hostile = new Proxy({}, {
      get() {
        throw new Error('blocked')
      },
    })
    assert.equal(formatLogContent(hostile), '[Unserializable log data]')
  })

  it('formats values JSON.stringify cannot represent', () => {
    assert.equal(formatLogContent(Symbol('event')), undefined)
    assert.equal(formatLogContent(undefined), undefined)
  })
})
