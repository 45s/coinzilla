import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatTimeRelatively } from './format-time-relatively.js'

describe('formatTimeRelatively', () => {
  it('formats past values', () => {
    assert.equal(formatTimeRelatively({ value: -123, unit: 'minute' }), '123 minutes ago')
  })

  it('formats future values', () => {
    assert.equal(formatTimeRelatively({ value: 2, unit: 'day' }), 'in 2 days')
  })

  it('defaults to hours', () => {
    assert.equal(formatTimeRelatively({ value: -1 }), '1 hour ago')
  })
})
