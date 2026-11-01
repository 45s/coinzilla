import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { checkIfFeatureEnable } from './check-if-feature-enable.js'

const originalValue = process.env.UTILS_TEST_FEATURE_FLAG
const logger = {
  warnings: [],
  warn(message) {
    this.warnings.push(message)
  },
}

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env.UTILS_TEST_FEATURE_FLAG
  } else {
    process.env.UTILS_TEST_FEATURE_FLAG = originalValue
  }
  logger.warnings.length = 0
})

describe('checkIfFeatureEnable', () => {
  it('returns true when the environment variable is exactly "1"', () => {
    process.env.UTILS_TEST_FEATURE_FLAG = '1'

    assert.equal(
      checkIfFeatureEnable({
        envVarName: 'UTILS_TEST_FEATURE_FLAG',
        where: 'unit test',
        logger,
      }),
      true,
    )
    assert.equal(logger.warnings.length, 0)
  })

  it('returns false and warns when the environment variable is not "1"', () => {
    process.env.UTILS_TEST_FEATURE_FLAG = 'super-secret-value'

    assert.equal(
      checkIfFeatureEnable({
        envVarName: 'UTILS_TEST_FEATURE_FLAG',
        where: 'unit test',
        logger,
      }),
      false,
    )
    assert.deepEqual(logger.warnings, [{
      envVarName: 'UTILS_TEST_FEATURE_FLAG',
      enabled: false,
      where: 'unit test',
    }])
    assert.equal(JSON.stringify(logger.warnings).includes('super-secret-value'), false)
  })

  it('returns false and reports logger failures without leaking environment values', () => {
    const errors = []
    process.env.UTILS_TEST_FEATURE_FLAG = 'sensitive-value'
    const failingLogger = {
      warn() { throw new Error('warning sink failed') },
      error(payload) { errors.push(payload) },
    }

    assert.equal(checkIfFeatureEnable({ envVarName: 'UTILS_TEST_FEATURE_FLAG', logger: failingLogger }), false)
    assert.equal(errors.length, 1)
    assert.equal(errors[0].message, 'warning sink failed')
  })

  it('returns false when the environment variable is unset', () => {
    delete process.env.UTILS_TEST_FEATURE_FLAG

    assert.equal(
      checkIfFeatureEnable({
        envVarName: 'UTILS_TEST_FEATURE_FLAG',
        where: 'unit test',
        logger,
      }),
      false,
    )
    assert.equal(logger.warnings.length, 1)
  })
})
