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
    assert.equal(calls[0].some((value) => typeof value === 'string' && value.includes('[Circular]')), true)
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


describe('Logger transports and severity levels', () => {
  const createTransport = (name, level, entries = []) => ({
    name,
    level,
    write(entry) {
      entries.push(entry)
    },
  })

  it('filters every standard severity at its configured threshold', () => {
    const entries = []
    const logger = new Logger({
      transports: [createTransport('capture', 'trace', entries)],
    })

    for (const level of ['trace', 'debug', 'info', 'warn', 'error']) {
      logger[level]({ level })
    }

    assert.deepEqual(entries.map(({ level }) => level), [
      'trace', 'debug', 'info', 'warn', 'error',
    ])
  })

  it('applies every configured minimum severity inclusively', () => {
    const levels = ['trace', 'debug', 'info', 'warn', 'error']

    levels.forEach((threshold, index) => {
      const entries = []
      const logger = new Logger({
        transports: [createTransport('capture', threshold, entries)],
      })

      levels.forEach((level) => logger[level]({ level }))

      assert.deepEqual(
        entries.map(({ level }) => level),
        levels.slice(index),
        `minimum level ${threshold} should include itself and more severe entries`,
      )
    })
  })

  it('assigns INFO severity to success and system semantic methods', () => {
    const entries = []
    const logger = new Logger({
      transports: [createTransport('capture', 'info', entries)],
    })

    logger.success({ message: 'completed' })
    logger.system({ message: 'lifecycle' })

    assert.deepEqual(entries.map(({ level }) => level), ['info', 'info'])
  })

  it('filters each transport independently', () => {
    const consoleEntries = []
    const fileEntries = []
    const diagnosticEntries = []
    const logger = new Logger({
      transports: [
        createTransport('console', 'info', consoleEntries),
        createTransport('development-file', 'debug', fileEntries),
        createTransport('diagnostic-file', 'trace', diagnosticEntries),
      ],
    })

    logger.trace({ message: 'trace' })
    logger.debug({ message: 'debug' })
    logger.info({ message: 'info' })

    assert.deepEqual(consoleEntries.map(({ level }) => level), ['info'])
    assert.deepEqual(fileEntries.map(({ level }) => level), ['debug', 'info'])
    assert.deepEqual(diagnosticEntries.map(({ level }) => level), ['trace', 'debug', 'info'])
  })

  it('changes one transport threshold at runtime without affecting other transports', () => {
    const consoleEntries = []
    const fileEntries = []
    const logger = new Logger({
      transports: [
        createTransport('console', 'info', consoleEntries),
        createTransport('file', 'debug', fileEntries),
      ],
    })

    logger.debug({ message: 'before' })
    logger.setLevel({ transport: 'console', level: 'debug' })
    logger.debug({ message: 'console enabled' })
    logger.setLevel({ transport: 'console', level: 'info' })
    logger.debug({ message: 'console disabled' })

    assert.deepEqual(consoleEntries.map(({ data }) => data.message), ['console enabled'])
    assert.deepEqual(fileEntries.map(({ data }) => data.message), [
      'before', 'console enabled', 'console disabled',
    ])
    assert.deepEqual(logger.getConfig().transports.map(({ name, level }) => ({ name, level })), [
      { name: 'console', level: 'info' },
      { name: 'file', level: 'debug' },
    ])
  })

  it('rejects invalid levels and unknown transport identifiers', () => {
    const logger = new Logger({
      transports: [createTransport('console', 'info')],
    })

    assert.throws(() => logger.setLevel({ transport: 'console', level: 'verbose' }), /Invalid log level/)
    assert.throws(() => logger.setLevel({ transport: 'missing', level: 'debug' }), /Unknown transport/)
    assert.throws(() => new Logger({
      transports: [createTransport('bad', 'verbose')],
    }), /Invalid log level/)
  })

  it('adds and removes transports by name', async () => {
    const entries = []
    const closed = []
    const logger = new Logger({ transports: [] })
    const transport = {
      ...createTransport('temporary', 'trace', entries),
      close() {
        closed.push('temporary')
      },
    }

    logger.addTransport(transport)
    logger.info({ message: 'present' })
    await logger.removeTransport('temporary')
    logger.info({ message: 'removed' })

    assert.equal(entries.length, 1)
    assert.deepEqual(closed, ['temporary'])
    assert.deepEqual(logger.getConfig().transports, [])
  })

  it('provides consistent timestamp, severity, and redacted structured data to transports', () => {
    const entries = []
    const logger = new Logger({
      transports: [createTransport('capture', 'trace', entries)],
    })
    const error = new TypeError('request failed', {
      cause: { message: 'nested failure', apiKey: 'secret-key' },
    })

    logger.error({
      message: 'operation failed',
      accessToken: 'secret-token',
      error,
    })

    assert.equal(entries.length, 1)
    assert.equal(typeof entries[0].timestamp, 'string')
    assert.equal(entries[0].level, 'error')
    assert.equal(Object.isFrozen(entries[0]), true)
    assert.equal(Object.isFrozen(entries[0].data), true)
    assert.equal(Object.isFrozen(entries[0].data.error), true)
    assert.equal(entries[0].data.error.name, 'TypeError')
    assert.match(entries[0].data.error.stack, /TypeError: request failed/)
    assert.equal(entries[0].data.error.cause.apiKey, '[REDACTED]')
    assert.equal(entries[0].data.accessToken, '[REDACTED]')
    assert.equal(JSON.stringify(entries[0]).includes('secret-token'), false)
    assert.equal(JSON.stringify(entries[0]).includes('secret-key'), false)
  })

  it('isolates synchronous and asynchronous transport failures', async () => {
    const errors = []
    const successfulEntries = []
    const logger = new Logger({
      transports: [
        {
          name: 'sync-failure',
          level: 'trace',
          write() {
            throw new Error('sync failure')
          },
        },
        {
          name: 'async-failure',
          level: 'trace',
          write() {
            return Promise.reject(new Error('async failure'))
          },
        },
        createTransport('healthy', 'trace', successfulEntries),
      ],
      onTransportError: ({ transport, error }) => errors.push({ transport, error }),
    })

    logger.info({ message: 'still delivered' })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(successfulEntries.length, 1)
    assert.deepEqual(errors.map(({ transport, error }) => [transport, error.message]), [
      ['sync-failure', 'sync failure'],
      ['async-failure', 'async failure'],
    ])
  })

  it('preserves default console compatibility across production and testing modes', () => {
    const originalLog = console.log
    const calls = []
    console.log = (...args) => calls.push(args)

    try {
      const logger = new Logger()
      logger.info({ message: 'info' })
      logger.debug({ message: 'debug' })
      logger.warn({ message: 'warn' })
      logger.error({ message: 'error' })

      assert.equal(calls.some((args) => args.some((value) =>
        typeof value === 'string' && value.includes('"message": "info"'))), true)
      assert.equal(calls.some((args) => args.some((value) =>
        typeof value === 'string' && value.includes('"message": "error"'))), true)
      if (process.env.NODE_ENV === 'production') {
        assert.equal(calls.some((args) => args.some((value) =>
          typeof value === 'string' && value.includes('"message": "debug"'))), false)
      }
      if (process.env.NODE_ENV === 'testing') {
        assert.equal(calls.some((args) => args.some((value) =>
          typeof value === 'string' && value.includes('"message": "warn"'))), false)
      }
    } finally {
      console.log = originalLog
    }
  })

  it('closes every remaining transport and isolates cleanup failures', async () => {
    const closed = []
    const errors = []
    const logger = new Logger({
      transports: [
        {
          name: 'broken',
          level: 'info',
          write() {},
          close() {
            throw new Error('close failed')
          },
        },
        {
          name: 'healthy',
          level: 'info',
          write() {},
          close() {
            closed.push('healthy')
          },
        },
      ],
      onTransportError: ({ transport, error }) => errors.push({ transport, error }),
    })

    await logger.close()

    assert.deepEqual(closed, ['healthy'])
    assert.equal(errors.length, 1)
    assert.equal(errors[0].transport, 'broken')
    assert.match(errors[0].error.message, /close failed/)
  })
})


describe('Logger transport validation and error boundaries', () => {
  it('validates constructor options and transport contracts', () => {
    const logger = new Logger({ transports: [] })

    assert.throws(() => new Logger({ transports: null }), /transports must be an array/)
    assert.throws(() => new Logger({ onTransportError: true }), /onTransportError must be a function/)
    assert.throws(() => new Logger({ transports: [null] }), /Transport must be an object/)
    assert.throws(() => logger.addTransport({ name: '', level: 'info', write() {} }), /name must be a non-empty string/)
    assert.throws(() => logger.addTransport({ name: 'missing-write', level: 'info' }), /must provide write/)
    assert.throws(() => logger.addTransport({ name: 'bad-close', level: 'info', write() {}, close: true }), /close must be a function/)
    assert.throws(() => logger.addTransport({ name: 'bad-filter', level: 'info', write() {}, shouldWrite: true }), /shouldWrite must be a function/)
    assert.throws(() => logger.addTransport({ name: 'bad-level', level: 3, write() {} }), /Invalid log level/)
    assert.throws(() => logger.addTransport({ name: 'temporary', level: 'info', write() {} }).addTransport({
      name: 'temporary', level: 'info', write() {},
    }), /already exists/)
  })

  it('validates transport identifiers and returns false when removing an unknown transport', async () => {
    const logger = new Logger({ transports: [] })

    assert.throws(() => logger.setLevel({ transport: '', level: 'info' }), /identifier must be a non-empty string/)
    assert.throws(() => logger.setLevel({ transport: 42, level: 'info' }), /identifier must be a non-empty string/)
    assert.throws(() => logger.setLevel({ transport: 'missing', level: 1 }), /Invalid log level/)
    await assert.rejects(logger.removeTransport(' '), /identifier must be a non-empty string/)
    assert.equal(await logger.removeTransport('missing'), false)
  })

  it('honors optional filters and reports filter failures without blocking other transports', () => {
    const errors = []
    const delivered = []
    const logger = new Logger({
      transports: [
        {
          name: 'filtered',
          level: 'trace',
          shouldWrite: () => false,
          write() {
            assert.fail('filtered transport must not write')
          },
        },
        {
          name: 'filter-failure',
          level: 'trace',
          shouldWrite() {
            throw new Error('filter failure')
          },
          write() {
            assert.fail('failed filter must not write')
          },
        },
        {
          name: 'healthy',
          level: 'trace',
          write(entry) {
            delivered.push(entry)
          },
        },
      ],
      onTransportError: ({ transport, error }) => errors.push({ transport, error }),
    })

    logger.info({ message: 'delivered' })

    assert.equal(delivered.length, 1)
    assert.deepEqual(errors.map(({ transport, error }) => [transport, error.message]), [
      ['filter-failure', 'filter failure'],
    ])
  })

  it('contains synchronous and asynchronous failures in the error reporter', async () => {
    const originalError = console.error
    const reported = []
    console.error = (...args) => reported.push(args)

    try {
      const syncLogger = new Logger({
        transports: [{
          name: 'broken',
          level: 'info',
          write() {
            throw new Error('write failed')
          },
        }],
        onTransportError() {
          throw new Error('reporter failed')
        },
      })
      syncLogger.info({ message: 'safe' })

      const asyncLogger = new Logger({
        transports: [{
          name: 'broken',
          level: 'info',
          write() {
            throw new Error('write failed')
          },
        }],
        onTransportError() {
          return Promise.reject(new Error('async reporter failed'))
        },
      })
      asyncLogger.info({ message: 'safe' })
      await new Promise((resolve) => setImmediate(resolve))

      assert.equal(reported.length, 2)
      assert.match(reported[0][0], /error handler failed/)
      assert.match(reported[1][0], /error handler failed/)
    } finally {
      console.error = originalError
    }
  })

  it('closes transports without cleanup hooks and remains reusable after close', async () => {
    const entries = []
    const logger = new Logger({
      transports: [{
        name: 'capture',
        level: 'info',
        write(entry) {
          entries.push(entry)
        },
      }],
    })

    await logger.close()
    assert.deepEqual(logger.getConfig().transports, [])
    logger.addTransport({
      name: 'replacement',
      level: 'info',
      write(entry) {
        entries.push(entry)
      },
    })
    logger.info({ message: 'reused' })

    assert.equal(entries.length, 1)
    assert.equal(entries[0].data.message, 'reused')
  })
})
