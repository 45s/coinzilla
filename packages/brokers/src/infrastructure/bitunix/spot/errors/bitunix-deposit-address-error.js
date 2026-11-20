import { SystemCustomError } from "@coinzilla/utils"

const ERROR_CODES = Object.freeze({
  input: "BITUNIX_DEPOSIT_ADDRESS_INPUT_INVALID",
  response: "BITUNIX_DEPOSIT_ADDRESS_RESPONSE_INVALID",
})

/**
 * @param {{message: string, kind?: "input"|"response", field?: string, cause?: unknown}} input
 */
export class BitunixDepositAddressError extends SystemCustomError {
  constructor({
    message,
    kind = "response",
    field = "data",
    cause,
  } = {}) {
    if (!Object.hasOwn(ERROR_CODES, kind)) {
      throw new TypeError("Bitunix deposit-address error kind is unsupported")
    }
    const options = {
      code: ERROR_CODES[kind],
      context: {
        operation: "getDepositAddress",
        field,
      },
    }
    if (cause !== undefined) {
      options.cause = cause
    }
    super(message, options)
    this.kind = kind
    this.field = field
  }
}
