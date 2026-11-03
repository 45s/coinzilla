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

  it('preserves Error diagnostics directly and when nested in objects and arrays', () => {
    const error = new TypeError('broker failed')
    const direct = JSON.parse(formatLogContent(error))
    const nested = JSON.parse(formatLogContent({ error, errors: [error] }))

    assert.equal(direct.name, 'TypeError')
    assert.equal(direct.message, 'broker failed')
    assert.match(direct.stack, /TypeError: broker failed/)
    assert.equal(nested.error.message, 'broker failed')
    assert.equal(nested.errors[0].name, 'TypeError')
  })

  it('preserves recursive causes and AggregateError members', () => {
    const first = new Error('root cause')
    const second = new TypeError('operation failed', { cause: first })
    const aggregate = new AggregateError([second, new Error('another failure')], 'multiple failures')
    const formatted = JSON.parse(formatLogContent({ error: aggregate }))

    assert.equal(formatted.error.name, 'AggregateError')
    assert.equal(formatted.error.message, 'multiple failures')
    assert.equal(formatted.error.errors[0].message, 'operation failed')
    assert.equal(formatted.error.errors[0].cause.message, 'root cause')
    assert.equal(formatted.error.errors[1].message, 'another failure')
  })

  it('handles circular references in objects and error causes', () => {
    const circular = {}
    circular.self = circular
    const error = new Error('circular cause')
    error.cause = error

    assert.equal(JSON.parse(formatLogContent(circular)).self, '[Circular]')
    assert.equal(JSON.parse(formatLogContent(error)).cause, '[Circular]')
  })

  it('redacts common credential fields in nested structured log data and Error causes', () => {
    const error = new Error('request failed', {
      cause: Object.assign(new Error('nested'), { apiKey: 'sensitive-error-key' }),
    })
    const formatted = formatLogContent({
      symbol: 'BTCUSDT',
      accessToken: 'sensitive-token',
      nested: { apiKey: 'sensitive-key', password: 'sensitive-password' },
      error,
    })
    assert.match(formatted, /BTCUSDT/)
    for (const secret of ['sensitive-token', 'sensitive-key', 'sensitive-password', 'sensitive-error-key']) {
      assert.equal(formatted.includes(secret), false)
    }
    assert.equal(formatted.split('[REDACTED]').length - 1, 3)
  })

  it('does not invoke or propagate hostile getters and proxies', () => {
    const hostileGetter = {}
    Object.defineProperty(hostileGetter, 'message', {
      enumerable: true,
      get() { throw new Error('getter blocked') },
    })
    const hostileProxy = new Proxy({}, {
      ownKeys() { throw new Error('proxy blocked') },
    })

    assert.match(formatLogContent({ hostileGetter, hostileProxy }), /Unreadable property/)
  })

  it('falls back for BigInt-containing objects and preserves non-Error thrown values', () => {
    assert.equal(formatLogContent({ amount: 1n }), '[object Object]')
    assert.equal(formatLogContent({ rejection: 'plain rejection value' }), '{\n  "rejection": "plain rejection value"\n}')
    assert.equal(formatLogContent({ rejection: 42 }), '{\n  "rejection": 42\n}')
  })

  it('does not throw when both serialization and string coercion fail', () => {
    const hostile = new Proxy({}, {
      get() { throw new Error('blocked') },
      ownKeys() { throw new Error('blocked') },
    })
    assert.match(formatLogContent(hostile), /Unreadable property/)
  })

  it('formats values JSON.stringify cannot represent', () => {
    assert.equal(formatLogContent(Symbol('event')), undefined)
    assert.equal(formatLogContent(undefined), undefined)
  })
})
