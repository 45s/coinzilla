import { compareDecimal } from "@coinzilla/utils"

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function isValidScenarioInputSchema({ schema } = {}) {
  if (!isRecord(schema)
    || schema.type !== "object"
    || !isRecord(schema.properties)
    || !Array.isArray(schema.required)
    || typeof schema.additionalProperties !== "boolean") {
    return false
  }
  if (!schema.required.every((key) =>
    typeof key === "string" &&
    key.trim().length > 0 &&
    Object.hasOwn(schema.properties, key))) {
    return false
  }
  return Object.values(schema.properties).every((field) => {
    if (!isRecord(field) || !["string", "number", "boolean"].includes(field.type)) {
      return false
    }
    if (field.exclusiveMinimum !== undefined &&
      (field.type !== "string" ||
        typeof field.exclusiveMinimum !== "string" ||
        !/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]+)?$/.test(field.exclusiveMinimum))) {
      return false
    }
    if (field.pattern === undefined) {
      return true
    }
    if (field.type !== "string" || typeof field.pattern !== "string") {
      return false
    }
    try {
      new RegExp(field.pattern)
      return true
    } catch {
      return false
    }
  })
}

export function validateScenarioInput({ schema, input } = {}) {
  if (!isValidScenarioInputSchema({ schema })) {
    return {
      valid: false,
      errors: ["Scenario input schema is invalid."],
    }
  }
  if (!isRecord(input)) {
    return {
      valid: false,
      errors: ["Scenario input must be a JSON object."],
    }
  }

  const errors = []
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!Object.hasOwn(schema.properties, key)) {
        errors.push(`Unknown input field: ${key}`)
      }
    }
  }
  for (const key of schema.required) {
    if (!Object.hasOwn(input, key)) {
      errors.push(`Missing required input field: ${key}`)
    }
  }
  for (const [key, field] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(input, key)) {
      continue
    }
    const value = input[key]
    if (typeof value !== field.type) {
      errors.push(`Input field ${key} must be a ${field.type}`)
    } else if (field.pattern && !new RegExp(field.pattern).test(value)) {
      errors.push(`Input field ${key} does not match its schema pattern`)
    } else if (field.exclusiveMinimum !== undefined &&
      compareDecimal({
        left: value,
        right: field.exclusiveMinimum,
      }) <= 0) {
      errors.push(`Input field ${key} must be greater than ${field.exclusiveMinimum}`)
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  }
}
