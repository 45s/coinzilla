import {
  isRequiredNotEmptyString,
  isRequiredNumberValid,
  validateItems,
  VR,
} from './validation.js'

export { VR }

/**
 * Public validation facade retained for API compatibility.
 * @see validateItems
 */
export class Validator {
  /**
   * Validate declarative [value, rules, fieldName?] tuples.
   * @param {{ items: Array<[unknown, string[], string?]>, isSoft?: boolean }} options
   * @returns {Array<{ value: unknown, msgs: string[], fieldName?: string }> | undefined}
   * @throws {Error|TypeError|Array} Invalid input, unsupported rules, or non-boolean isSoft throws; hard mode throws the collected errors array.
   */
  static validate(options = {}) {
    return validateItems(options)
  }

  /** @param {number} number @returns {boolean} True only for finite, non-zero numbers. */
  static isRequiredNumberValid = (number) => isRequiredNumberValid(number)

  /** @param {unknown} value @returns {boolean} True for non-empty strings after trimming. */
  static isRequiredNotEmptyString = (value) => isRequiredNotEmptyString(value)
}
