import { handleErr } from './handle-err.js'
import { defaultLogger } from './logger.js'

/**
 * Enable a feature only when its environment variable is exactly "1".
 * Never include the environment variable's value in diagnostic output.
 * @param {{ envVarName: string, where?: string, logger?: object }} options
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
