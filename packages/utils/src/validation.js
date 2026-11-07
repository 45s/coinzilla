import { EM } from './error-messages.js'

/** @typedef {'number'|'string'|'array'|'function'|'required'|'notEmptyString'|'notUndefined'|'notEmptyArr'} ValidationRule */
/** @typedef {[value: unknown, rules: ValidationRule[], fieldName?: string]} ValidationItem */
/** @typedef {{ value: unknown, msgs: string[], fieldName?: string }} ValidationError */

// VR stands for "validation rule"
/** @type {{ num: 'number', str: 'string', arr: 'array', fn: 'function', required: 'required', notEmptyString: 'notEmptyString', notUndefined: 'notUndefined', notEmptyArr: 'notEmptyArr' }} */
export const VR = {
  num: 'number',
  str: 'string',
  arr: 'array',
  fn: 'function',
  required: 'required',
  notEmptyString: 'notEmptyString',
  notUndefined: 'notUndefined',
  notEmptyArr: 'notEmptyArr',
}

/**
 * Validate declarative [value, rules, fieldName?] tuples without mutating them.
 * Soft mode returns all validation errors; hard mode throws that error array.
 *
 * @param {{ isSoft?: boolean, items: ValidationItem[] }} options
 * @returns {ValidationError[]|undefined} Errors in soft mode, otherwise undefined when valid.
 * @throws {Error|TypeError|ValidationError[]} For missing/malformed items or failed hard-mode validation.
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

/** Whether a finite, non-zero number satisfies a required numeric field. @param {unknown} number @returns {boolean} */
export const isRequiredNumberValid = (number) =>
  typeof number === 'number' && Number.isFinite(number) && Boolean(number)

/** Whether a string contains at least one non-whitespace character. @param {unknown} value @returns {boolean} */
export const isRequiredNotEmptyString = (value) =>
  typeof value === 'string' && Boolean(value.trim())
