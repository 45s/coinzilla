import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { redactSensitiveLogField } from './redact-sensitive-log-field.js'

describe('redactSensitiveLogField', () => {
  it('redacts common credential fields case-insensitively', () => {
    for (const key of ['password', 'accessToken', 'API_KEY', 'private-key', 'Authorization', 'cookie', 'clientSecret']) {
      assert.equal(redactSensitiveLogField(key, 'sensitive'), '[REDACTED]')
    }
  })

  it('preserves ordinary fields and non-string keys', () => {
    assert.equal(redactSensitiveLogField('symbol', 'BTCUSDT'), 'BTCUSDT')
    assert.equal(redactSensitiveLogField('', 'value'), 'value')
    assert.equal(redactSensitiveLogField(0, 'value'), 'value')
  })
})
