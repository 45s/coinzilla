import { EM } from './error-messages.js'

// VR stands for "validation rule"
export const VR = Object.freeze({
  num: 'number',
  str: 'string',
  arr: 'array',
  fn: 'function',
  required: 'required',
  notEmptyString: 'notEmptyString',
  notUndefined: 'notUndefined',
  notEmptyArr: 'notEmptyArr',
})

/**
 * Validate the declarative [value, rules, fieldName] tuples used by Validator.
 * The function is pure: it returns validation errors or throws without
 * changing the supplied items.
 */
export function validateItems({ isSoft = true, items } = {}) {
  if (!Array.isArray(items)) {
    throw new Error(EM.invalidParameter('items'))
  }

  const errors = []
  for (const [index, item] of items.entries()) {
    if (!Array.isArray(item) || item.length < 2 || !Array.isArray(item[1])) {
      throw new TypeError(`Validation item at index ${index} must be [value, rules, fieldName?]`)
    }

    const [value, rules, fieldName] = item
    const messages = []

    for (const rule of rules) {
      if (rule === VR.required && !value) {
        messages.push(EM.required())
      }
      if (rule === VR.notEmptyString && (typeof value !== 'string' || !value.trim())) {
        messages.push(EM.emptyString())
      }
      if (rule === VR.num && (typeof value !== 'number' || !Number.isFinite(value))) {
        messages.push(EM.notNumber())
      }
      if (rule === VR.str && typeof value !== 'string') {
        messages.push(EM.notString())
      }
      if (rule === VR.fn && typeof value !== 'function') {
        messages.push(EM.notFunction())
      }
      if (rule === VR.notUndefined && typeof value === 'undefined') {
        messages.push(EM.undefined())
      }
      if (rule === VR.arr && !Array.isArray(value)) {
        messages.push(EM.arr())
      }
      if (rule === VR.notEmptyArr && (!Array.isArray(value) || value.length === 0)) {
        messages.push(EM.emptyArray())
      }
    }

    if (messages.length) {
      errors.push({
        value,
        msgs: messages,
        ...(fieldName ? { fieldName } : {}),
      })
    }
  }

  if (errors.length) {
    if (isSoft) {
      return errors
    }
    throw errors
  }
}

/** Whether a finite, non-zero number satisfies a required numeric field. */
export const isRequiredNumberValid = (number) =>
  typeof number === 'number' && Number.isFinite(number) && Boolean(number)

/** Whether a string contains at least one non-whitespace character. */
export const isRequiredNotEmptyString = (value) =>
  typeof value === 'string' && Boolean(value.trim())
