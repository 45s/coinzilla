import assert from 'assert'
import { describe, it } from 'node:test'
import { formatTimeRelatively } from './format-time-relatively.js'

describe(`${formatTimeRelatively.name}`, () => {
  it('should return proper data', () => {
    const unit = 'minute'
    const r = formatTimeRelatively({ value: -123, unit })
    assert.deepStrictEqual(r, '123 minutes ago')
  })
})
