import crypto from 'node:crypto'

export function generateUUID() {
  return crypto.randomUUID()
}
