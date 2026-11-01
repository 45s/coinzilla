import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { wait } from './wait.js'

describe('wait', () => {
  it('returns a promise', () => {
    assert.equal(wait(0) instanceof Promise, true)
  })

  it('rejects invalid durations rather than relying on Node timer coercion', async () => {
    for (const duration of [-1, Infinity, NaN, '5', 2_147_483_648]) {
      await assert.rejects(wait(duration))
    }
  })

  it('resolves after the requested delay', async () => {
    await assert.doesNotReject(wait(0))
  })
})
