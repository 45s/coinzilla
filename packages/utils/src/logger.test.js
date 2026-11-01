import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { Logger } from './logger.js'

describe('Logger', () => {
  const originalLog = console.log
  let calls

  afterEach(() => {
    console.log = originalLog
  })

  it('logs primitive values without throwing', () => {
    calls = []
    console.log = (...args) => calls.push(args)
    const logger = new Logger()

    assert.doesNotThrow(() => logger.info('hello'))
    assert.doesNotThrow(() => logger.info(42))
    assert.doesNotThrow(() => logger.info(true))

    assert.equal(calls.length, 3)
    assert.equal(calls[0].includes('hello'), true)
    assert.equal(calls[1].includes(42), true)
    assert.equal(calls[2].includes(true), true)
  })

  it('serializes objects as readable JSON', () => {
    calls = []
    console.log = (...args) => calls.push(args)
    const logger = new Logger()

    logger.info({ message: 'hello', count: 2 })

    assert.equal(calls.length, 1)
    assert.equal(
      calls[0].includes(JSON.stringify({ message: 'hello', count: 2 }, null, 2)),
      true,
    )
  })

  it('does not throw when log data cannot be serialized as JSON', () => {
    calls = []
    console.log = (...args) => calls.push(args)
    const logger = new Logger()
    const circular = {}
    circular.self = circular

    assert.doesNotThrow(() => logger.info(circular))
    assert.doesNotThrow(() => logger.info({ amount: 1n }))
    assert.equal(calls.length, 2)
    assert.equal(calls[0].includes('[object Object]'), true)
    assert.equal(calls[1].includes('[object Object]'), true)
  })

  it('executes every supported logging method without throwing', () => {
    calls = []
    console.log = (...args) => calls.push(args)
    const logger = new Logger()

    for (const methodName of ['info', 'system', 'debug', 'error', 'warn', 'success']) {
      assert.doesNotThrow(() => logger[methodName]({ methodName }))
    }
    assert.ok(calls.length >= 4)
  })

  it('exposes all supported logging methods', () => {
    const logger = new Logger()

    for (const methodName of ['info', 'system', 'debug', 'error', 'warn', 'success']) {
      assert.equal(typeof logger[methodName], 'function')
    }
  })

  it('serializes null and arrays as JSON', () => {
    calls = []
    console.log = (...args) => calls.push(args)
    const logger = new Logger()

    logger.info(null)
    logger.info([1, 'two'])

    assert.equal(calls.length, 2)
    assert.equal(calls[0].includes('null'), true)
    assert.equal(calls[1].includes(JSON.stringify([1, 'two'], null, 2)), true)
  })
})
