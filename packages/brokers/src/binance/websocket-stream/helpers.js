import { isEmptyValue } from "./is-empty-value.js"
import { removeEmptyValue } from "./remove-empty-value.js"

export { isEmptyValue, removeEmptyValue }

class MissingParameterError extends Error {
  constructor(paramNames) {
    super(`One or more of required parameters is missing: ${paramNames ? paramNames.slice().join(', ') : ''} `)
    this.name = 'MissingParameterError'
  }
}

export function validateRequiredParameters(paramObject) {
  if (!paramObject || isEmptyValue(paramObject)) {
    throw new MissingParameterError()
  }
  const emptyParams = []
  Object.keys(paramObject).forEach((param) => {
    if (isEmptyValue(paramObject[param])) {
      emptyParams.push(param)
    }
  })
  if (emptyParams.length) {
    throw new MissingParameterError(emptyParams)
  }
}

export function getFirstTicket(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    throw new MissingParameterError(['tickets'])
  }

  if (typeof tickets[0] !== 'string' || tickets[0].trim() === '') {
    throw new MissingParameterError(['tickets[0]'])
  }

  return tickets[0]
}

/**
 * NOTE: Arrays use JSON encoding, e.g. symbols=["BTCUSDT","BNBBTC"].
 */
const stringifyKeyValuePair = ([key, value]) => {
  const valueString = Array.isArray(value) ? JSON.stringify(value) : value
  return `${key}=${encodeURIComponent(valueString)}`
}

export function buildQueryString(params) {
  if (!params) return ''
  return Object.entries(params).map(stringifyKeyValuePair).join('&')
}
