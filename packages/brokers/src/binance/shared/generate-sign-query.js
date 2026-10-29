import { generateTimestamp } from './generate-timestamp.js'
import { buildSignQuery } from './build-sign-query.js'

export function generateSignQuery() {
  return buildSignQuery(generateTimestamp())
}
