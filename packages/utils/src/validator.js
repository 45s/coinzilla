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
    if (!items || !Array.isArray(items)) {
      throw new Error(EM.invalidParameter('items'))
    }

    const errors = []
    for (const [value, rules, fieldName] of items) {
      const msgs = []
      for (const r of rules) {
        if (r === VR.required && !value) {
          msgs.push(EM.required())
        }
        if (r === VR.notEmptyString && !value?.trim()) {
          msgs.push(EM.emptyString())
        }
        if (r === VR.num && (typeof value !== 'number' || !Number.isFinite(value))) {
          msgs.push(EM.notNumber())
        }
        if (r === VR.str && typeof value !== 'string') {
          msgs.push(EM.notString())
        }
        if (r === VR.notUndefined && typeof value === 'undefined') {
          msgs.push(EM.undefined())
        }
        if (r === VR.arr && !Array.isArray(value)) {
          msgs.push(EM.arr())
        }
        if (r === VR.notEmptyArr && (!Array.isArray(value) || value.length === 0)) {
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

  static isRequiredNumberValid = (n) =>
    typeof n === 'number' && Number.isFinite(n) && Boolean(n)

  static isRequiredNotEmptyString = (s) => typeof s === 'string' && Boolean(s.trim())
}
