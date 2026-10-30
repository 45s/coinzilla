import { EM } from './error-messages.js'

// VR stands for "validation rule"
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

export class Validator {
  static validate({ isSoft = true, items } = {}) {
    if (!Array.isArray(items)) {
      throw new Error(EM.invalidParameter('items'))
    }

    const errors = []
    for (const [value, rules, fieldName] of items) {
      const msgs = []
      for (const rule of rules) {
        if (rule === VR.required && !value) {
          msgs.push(EM.required())
        }
        if (rule === VR.notEmptyString && (typeof value !== 'string' || !value.trim())) {
          msgs.push(EM.emptyString())
        }
        if (rule === VR.num && (typeof value !== 'number' || !Number.isFinite(value))) {
          msgs.push(EM.notNumber())
        }
        if (rule === VR.str && typeof value !== 'string') {
          msgs.push(EM.notString())
        }
        if (rule === VR.fn && typeof value !== 'function') {
          msgs.push(EM.notFunction())
        }
        if (rule === VR.notUndefined && typeof value === 'undefined') {
          msgs.push(EM.undefined())
        }
        if (rule === VR.arr && !Array.isArray(value)) {
          msgs.push(EM.arr())
        }
        if (rule === VR.notEmptyArr && (!Array.isArray(value) || value.length === 0)) {
          msgs.push(EM.emptyArray())
        }
      }
      if (msgs.length) {
        errors.push({
          value,
          msgs,
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

  static isRequiredNumberValid = (number) =>
    typeof number === 'number' && Number.isFinite(number) && Boolean(number)

  static isRequiredNotEmptyString = (value) =>
    typeof value === 'string' && Boolean(value.trim())
}
