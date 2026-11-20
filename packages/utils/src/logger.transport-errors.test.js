import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Logger } from './logger.js'

function captureStderr() {
  const originalWrite = process.stderr.write
  const chunks = []
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk))
    return true
  }
  return {
    chunks,
    restore() {
      process.stderr.write = originalWrite
    },
  }
}

test('omits raw transport error messages from the default stderr fallback', () => {
  const output = captureStderr()
  const secret = 'apiKey=transport-secret-value'

  try {
    const logger = new Logger({
      transports: [{
        name: 'sensitive-file-transport',
        level: 'info',
        write() {
          throw new Error(secret)
        },
      }],
    })

    logger.info({ message: 'event' })

    const diagnostic = output.chunks.join('')
    assert.doesNotMatch(
      diagnostic,
      /transport-secret-value/,
      'the default transport-failure fallback must not expose credentials embedded in an adapter error message',
    )
    assert.match(
      diagnostic,
      /sensitive-file-transport/,
      'the safe fallback must retain the failing transport identity for diagnosis',
    )
    assert.match(
      diagnostic,
      /Error/,
      'the safe fallback must retain the error type without printing its message or stack',
    )
  } finally {
    output.restore()
  }
})

test('omits raw reporter errors when the custom transport-error handler fails', () => {
  const output = captureStderr()
  const secret = 'token=reporter-secret-value'

  try {
    const logger = new Logger({
      transports: [{
        name: 'broken-file-transport',
        level: 'info',
        write() {
          throw new Error('write failed')
        },
      }],
      onTransportError() {
        throw new Error(secret)
      },
    })

    logger.info({ message: 'event' })

    const diagnostic = output.chunks.join('')
    assert.doesNotMatch(
      diagnostic,
      /reporter-secret-value/,
      'the emergency reporter-failure fallback must not expose credentials embedded in the reporter error message',
    )
    assert.match(
      diagnostic,
      /broken-file-transport/,
      'the emergency fallback must preserve the original failing transport identity',
    )
  } finally {
    output.restore()
  }
})
