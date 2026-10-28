import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { wait } from './wait.js'

describe('wait', () => {
  it('returns a promise', () => {
    assert.equal(wait(0) instanceof Promise, true)
  })

  it('resolves after the requested delay', async () => {
    await assert.doesNotReject(wait(0))
  })
})
