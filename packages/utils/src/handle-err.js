import { defaultLogger } from './logger.js'

/**
 * @typedef {{ error: *, where?: string, logger?: { error: (data: unknown) => unknown } }} HandleErrorOptions
 */

/**
 * Report an error with its original value and optional operation context.
 * Defaults to the shared logger; logging errors are governed by the logger.
 * @param {HandleErrorOptions} options
 * @returns {void}
 */
export const handleErr = ({ logger = defaultLogger, where, error }) => {
  logger.error({
    where,
    error,
    message: error?.message,
  })
}
