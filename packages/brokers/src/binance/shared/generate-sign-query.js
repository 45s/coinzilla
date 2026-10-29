import { generateTimestamp } from './generate-timestamp.js'
import { buildSignQuery } from './build-sign-query.js'

export { buildSignQuery }

export function generateSignQuery() {
  return buildSignQuery(generateTimestamp())
}
