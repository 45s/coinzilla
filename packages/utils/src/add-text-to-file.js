import fsPromises from 'fs/promises'
import { defaultLogger as logger, EM } from './index.js'

/**
 * usage:
 * addTextToFile({ text: price, fileName: 'btc-prices.txt' })
 * @param {*} param0
 */
export async function addTextToFile({ text, fileName }) {
  try {
    if (!fileName) {
      throw new Error(EM.invalidParameter('fileName'))
    }
    await fsPromises.appendFile(fileName, text, 'utf-8')
  } catch (err) {
    logger.error(err)
    throw new Error('Error appending data to file')
  }
}
