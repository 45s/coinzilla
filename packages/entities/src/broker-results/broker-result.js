export const BROKER_RESULT_STATUSES = Object.freeze([
  "SUCCESS",
  "FAILURE",
  "INCOMPLETE",
  "UNKNOWN",
])

export const brokerResultErrMsgs = {
  input: "BrokerResult input should be an object",
  status: "BrokerResult.status is unsupported",
  errors: "BrokerResult.errors should be an array of Error values",
  successErrors: "SUCCESS BrokerResult must not contain errors",
  failureErrors: "FAILURE BrokerResult requires at least one error",
  failureData: "FAILURE BrokerResult must not contain data",
  incompleteData: "INCOMPLETE BrokerResult requires partial data",
  incompleteErrors: "INCOMPLETE BrokerResult requires at least one error describing missing data",
  unknownErrors: "UNKNOWN BrokerResult requires at least one error describing the unresolved outcome",
  unknownData: "UNKNOWN BrokerResult must not contain data",
}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export class BrokerResult {
  #status
  #data
  #hasData
  #errors

  constructor(input = {}) {
    if (!isRecord(input)) {
      throw new Error(brokerResultErrMsgs.input)
    }

    const { status, data, errors = [] } = input
    if (!BROKER_RESULT_STATUSES.includes(status)) {
      throw new Error(brokerResultErrMsgs.status)
    }
    if (
      !Array.isArray(errors) ||
      Array.from(errors).some((error) => !(error instanceof Error))
    ) {
      throw new Error(brokerResultErrMsgs.errors)
    }

    const hasData = Object.hasOwn(input, "data") && data !== undefined
    if (status === "SUCCESS" && errors.length > 0) {
      throw new Error(brokerResultErrMsgs.successErrors)
    }
    if (status === "FAILURE") {
      if (errors.length === 0) {
        throw new Error(brokerResultErrMsgs.failureErrors)
      }
      if (hasData) {
        throw new Error(brokerResultErrMsgs.failureData)
      }
    }
    if (status === "INCOMPLETE") {
      if (!hasData) {
        throw new Error(brokerResultErrMsgs.incompleteData)
      }
      if (errors.length === 0) {
        throw new Error(brokerResultErrMsgs.incompleteErrors)
      }
    }
    if (status === "UNKNOWN") {
      if (errors.length === 0) {
        throw new Error(brokerResultErrMsgs.unknownErrors)
      }
      if (hasData) {
        throw new Error(brokerResultErrMsgs.unknownData)
      }
    }

    this.#status = status
    this.#data = data
    this.#hasData = hasData
    this.#errors = Object.freeze([...errors])

    Object.freeze(this)
  }

  get status() {
    return this.#status
  }

  get ok() {
    return this.#status === "SUCCESS"
  }

  get data() {
    return this.#hasData ? this.#data : undefined
  }

  get hasData() {
    return this.#hasData
  }

  get errors() {
    return this.#errors
  }
}
