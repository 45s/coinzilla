import crypto from 'node:crypto'
import { EM } from '../../../_utils/index.js'
import { getBinanceConfig } from '../config.js'

const { apiSecretKey } = getBinanceConfig()

export function generateSignature(query) {
  if (!apiSecretKey) {
    throw new Error(EM.invalidConfig())
  }
  return crypto.createHmac('sha256', apiSecretKey).update(query).digest('hex')
}
