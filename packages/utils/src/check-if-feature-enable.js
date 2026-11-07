import { handleErr } from './handle-err.js'
import { defaultLogger } from './logger.js'

/**
 * @typedef {object} FeatureFlagLogger
 * @property {(data: unknown) => unknown} warn
 * @property {(data: unknown) => unknown} error
 */

/**
 * Enable a feature only when its environment variable is exactly "1".
 * The flag's value is never included in diagnostic output. Missing or any
 * other value logs a warning and returns false.
 *
 * @param {{ envVarName: string, where?: string, logger?: FeatureFlagLogger }} options
 * @returns {boolean}
 */
export function checkIfFeatureEnable({ envVarName, where, logger = defaultLogger } = {}) {
  try {
    const value = process.env[envVarName]
    if (value === '1') {
      return true
    }

    logger.warn({
      envVarName,
      enabled: false,
      where,
    })
    return false
  } catch (error) {
    handleErr({
      error,
      logger,
      where: checkIfFeatureEnable.name,
    })
    return false
  }
}
