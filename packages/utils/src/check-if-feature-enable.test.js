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
    process.env.UTILS_TEST_FEATURE_FLAG = 'true'

    assert.equal(
      checkIfFeatureEnable({
        envVarName: 'UTILS_TEST_FEATURE_FLAG',
        where: 'unit test',
        logger,
      }),
      false,
    )
    assert.deepEqual(logger.warnings, [{
      why: 'process.env.UTILS_TEST_FEATURE_FLAG : true',
      where: 'unit test',
    }])
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
