import {
  isRequiredNotEmptyString,
  isRequiredNumberValid,
  validateItems,
  VR,
} from './validation.js'

export { VR }

export class Validator {
  static validate(options = {}) {
    return validateItems(options)
  }

  static isRequiredNumberValid = (number) => isRequiredNumberValid(number)

  static isRequiredNotEmptyString = (value) => isRequiredNotEmptyString(value)
}
