/**
 * @typedef {object} ErrorMessages
 * @property {() => string} oneBrokerMustBeProvided
 * @property {(brokerName: string) => string} brokerNotSupported
 * @property {(details: string) => string} notImplemented
 * @property {() => string} invalidConfig
 * @property {(operationName: string) => string} invalidOperationName
 * @property {(methodName: string) => string} methodShouldBeImplemented
 * @property {(parameterName: string) => string} invalidParameter
 * @property {(fieldName?: string) => string} required
 * @property {() => string} emptyString
 * @property {() => string} emptyArray
 * @property {() => string} notNumber
 * @property {() => string} notString
 * @property {() => string} notFunction
 * @property {() => string} undefined
 * @property {() => string} arr
 */

/**
 * Shared error-message factories. Each function returns a message string;
 * callers decide which Error type or result shape to use.
 * @type {ErrorMessages}
 */
export const EM = {
  oneBrokerMustBeProvided: () => 'At least one broker must be provided',
  brokerNotSupported: (brokerName) => `Broker "${brokerName}" not supported yet`,
  notImplemented: (details) => `${details} not implemented`,
  invalidConfig: () => 'Invalid configuration',
  invalidOperationName: (operationName) => `Invalid operation name '${operationName}'`,
  methodShouldBeImplemented: (methodName) => `"${methodName}" method must be implemented`,
  invalidParameter: (parameterName) => `Invalid "${parameterName}" parameter`,
  required: (fieldName) => (fieldName ? `Field "${fieldName}" is required` : 'Field is required'),
  emptyString: () => 'Empty string not allowed',
  emptyArray: () => 'Empty array not allowed',
  notNumber: () => 'Must be a number',
  notString: () => 'Must be a string',
  notFunction: () => 'Must be a function',
  undefined: () => 'Value is undefined',
  arr: () => 'It should be an array',
}
