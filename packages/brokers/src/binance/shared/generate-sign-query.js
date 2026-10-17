import { generateTimestamp } from './generate-timestamp.js'

export function generateSignQuery() {
  return `recvWindow=5000&timestamp=${generateTimestamp()}`
}
