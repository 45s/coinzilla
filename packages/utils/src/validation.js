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

const supportedRules = new Set(Object.values(VR))

function assertItemsArray({ items }) {
  if (!Array.isArray(items)) {
    throw new Error(EM.invalidParameter('items'))
  }
}

function resolveSoftMode({ options }) {
  const hasIsSoft = Object.hasOwn(options, 'isSoft')
  if (hasIsSoft && typeof options.isSoft !== 'boolean') {
    throw new TypeError('Validation option "isSoft" must be a boolean when provided')
  }
  return hasIsSoft ? options.isSoft : true
}

function assertSupportedItemRules({ items }) {
  for (const [itemIndex, item] of items.entries()) {
    if (!Array.isArray(item) || item.length < 2 || !Array.isArray(item[1])) {
      throw new TypeError(`Validation item at index ${itemIndex} must be [value, rules, fieldName?]`)
    }

    for (const [ruleIndex, rule] of item[1].entries()) {
      if (!supportedRules.has(rule)) {
        const ruleDescription = typeof rule === 'string' ? JSON.stringify(rule) : typeof rule
        throw new TypeError(
          `Unsupported validation rule ${ruleDescription} at item index ${itemIndex}, rule index ${ruleIndex}; use an exported VR value`,
        )
      }
    }
  }
}

function getValidationMessage({ value, rule }) {
  switch (rule) {
    case VR.required:
      return value ? undefined : EM.required()
    case VR.notEmptyString:
      return typeof value !== 'string' || !value.trim() ? EM.emptyString() : undefined
    case VR.num:
      return typeof value !== 'number' || !Number.isFinite(value) ? EM.notNumber() : undefined
    case VR.str:
      return typeof value !== 'string' ? EM.notString() : undefined
    case VR.fn:
      return typeof value !== 'function' ? EM.notFunction() : undefined
    case VR.notUndefined:
      return typeof value === 'undefined' ? EM.undefined() : undefined
    case VR.arr:
      return !Array.isArray(value) ? EM.arr() : undefined
    case VR.notEmptyArr:
      return !Array.isArray(value) || value.length === 0 ? EM.emptyArray() : undefined
    default:
      return undefined
  }
}

function collectValidationErrors({ items }) {
  const errors = []
  for (const item of items) {
    const [value, rules, fieldName] = item
    const messages = []

    for (const rule of rules) {
      const message = getValidationMessage({ value, rule })
      if (message !== undefined) {
        messages.push(message)
      }
    }

    if (messages.length > 0) {
      errors.push({
        value,
        msgs: messages,
        ...(fieldName ? { fieldName } : {}),
      })
    }
  }
  return errors
}

/**
 * Validate declarative [value, rules, fieldName?] tuples without mutating them.
 * Soft mode returns all validation errors; hard mode throws that error array.
 *
 * Every rule must be an exported VR value. If supplied, isSoft must be boolean;
 * omitting it preserves the default soft mode.
 *
 * @param {{ isSoft?: boolean, items: ValidationItem[] }} [options]
 * @returns {ValidationError[]|undefined} Errors in soft mode, otherwise undefined when valid.
 * @throws {Error|TypeError|ValidationError[]} For missing/malformed items, unsupported rules,
 *   invalid isSoft configuration, or failed hard-mode validation.
 */
export function validateItems(options = {}) {
  const { items } = options
  assertItemsArray({ items })
  const isSoft = resolveSoftMode({ options })
  assertSupportedItemRules({ items })

  const errors = collectValidationErrors({ items })
  if (errors.length > 0 && !isSoft) {
    throw errors
  }
  return errors.length > 0 ? errors : undefined
}

/** Whether a finite, non-zero number satisfies a required numeric field. @param {unknown} number @returns {boolean} */
export const isRequiredNumberValid = (number) =>
  typeof number === 'number' && Number.isFinite(number) && Boolean(number)

/** Whether a string contains at least one non-whitespace character. @param {unknown} value @returns {boolean} */
export const isRequiredNotEmptyString = (value) =>
  typeof value === 'string' && Boolean(value.trim())
