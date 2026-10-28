import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleErr } from './handle-err.js'

describe('handleErr', () => {
  it('logs error context and message through the supplied logger', () => {
    const calls = []
    const logger = {
      error(payload) {
        calls.push(payload)
      },
    }
    const error = new Error('Something failed')

    handleErr({ logger, where: 'unit test', error })

    assert.deepEqual(calls, [{
      where: 'unit test',
      error,
      message: 'Something failed',
    }])
  })

  it('supports errors without a message', () => {
    const calls = []
    const logger = { error: (payload) => calls.push(payload) }

    handleErr({ logger, where: 'unit test', error: null })

    assert.deepEqual(calls, [{
      where: 'unit test',
      error: null,
      message: undefined,
    }])
  })
})
