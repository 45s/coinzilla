import fsPromises from 'node:fs/promises'
import { EM } from './error-messages.js'
import { defaultLogger as logger } from './logger.js'

/**
 * Append text or bytes to a file, creating it when needed.
 *
 * @param {{ text: string | Uint8Array, fileName: string | URL }} options
 * @returns {Promise<void>} Resolves after the append completes.
 * @throws {Error} Rejects with a contextual error whose cause is the original failure.
 */
export async function addTextToFile(options = {}) {
  try {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError(EM.invalidParameter('options'))
    }

    const { text, fileName } = options
    if (!fileName) {
      throw new Error(EM.invalidParameter('fileName'))
    }

    await fsPromises.appendFile(fileName, text, 'utf-8')
  } catch (error) {
    logger.error(error)
    throw new Error('Error appending data to file', { cause: error })
  }
}
