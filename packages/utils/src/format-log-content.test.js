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

  it('redacts common credential fields in nested structured log data', () => {
    const formatted = formatLogContent({
      symbol: 'BTCUSDT',
      accessToken: 'sensitive-token',
      nested: { apiKey: 'sensitive-key', password: 'sensitive-password' },
    })
    assert.match(formatted, /BTCUSDT/)
    assert.equal(formatted.includes('sensitive-token'), false)
    assert.equal(formatted.includes('sensitive-key'), false)
    assert.equal(formatted.includes('sensitive-password'), false)
    assert.equal(formatted.split('[REDACTED]').length - 1, 3)
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
