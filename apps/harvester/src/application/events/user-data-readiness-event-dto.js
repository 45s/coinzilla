import { assertObjectInput, toResult } from "@coinzilla/utils"

const mapData = (input, operation, mapper) => {
  try {
    assertObjectInput({ input, operation })
    return toResult({ data: mapper(input) })
  } catch (error) {
    return toResult({ error })
  }
}

const requireString = ({ value, field }) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(field + " must be a non-empty string")
  }
  return value.trim()
}

const requireBoolean = ({ value, field }) => {
  if (typeof value !== "boolean") {
    throw new TypeError(field + " must be a boolean")
  }
  return value
}

/** Map an application readiness transition after the user-data status handler applies it. */
export const mapUserDataReadinessChangedData = (input = {}) =>
  mapData(input, "User-data-readiness-changed event mapping", ({ broker, ready, status, trigger }) => {
    const data = {
      broker: requireString({ value: broker, field: "broker" }),
      ready: requireBoolean({ value: ready, field: "ready" }),
      status: requireString({ value: status, field: "status" }),
    }
    if (trigger !== undefined) {
      data.trigger = requireString({ value: trigger, field: "trigger" })
    }
    return data
  })
