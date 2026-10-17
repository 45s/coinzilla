import assert from 'node:assert'
import { describe, it } from 'node:test'
import { defaultLogger as logger } from './logger.js'

describe('utils/logger', () => {
  for (const methodName of ['info', 'system', 'debug', 'error', 'success']) {
    it(`should has "${methodName}" method`, () => {
      assert(typeof logger[methodName] === 'function')
    })
  }
})
