import { handleErr } from './handle-err.js'
import { defaultLogger } from './logger.js'

/**
 * check if environment variable set too "1" for enabling feature
 * @param {envVarName, where, logger} param0
 * @returns boolean
 */
export function checkIfFeatureEnable({ envVarName, where, logger = defaultLogger } = {}) {
  try {
    const value = process.env[envVarName]
    if (value === '1') {
      return true
    }
    logger.warn({
      why: `process.env.${envVarName} : ${value}`,
      where,
    })
    return false
  } catch (error) {
    handleErr({
      error,
      logger,
      where: `${checkIfFeatureEnable.name}`,
    })
  }
}
