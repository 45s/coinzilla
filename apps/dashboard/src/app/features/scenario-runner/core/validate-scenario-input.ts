import { compareDecimalStrings } from "./compare-decimal-strings"

interface ScenarioInputSchema {
  readonly type: 'object';
  readonly required: readonly string[];
  readonly additionalProperties: boolean;
  readonly properties: Readonly<Record<string, {
    readonly type: string;
    readonly pattern?: string;
    readonly exclusiveMinimum?: string;
  }>>;
}

export function validateScenarioInput({
  schema,
  input,
}: {
  schema: ScenarioInputSchema;
  input: unknown;
}) {
  const errors: string[] = []
  if (!schema || schema.type !== "object" || !schema.properties || !Array.isArray(schema.required)) {
    return {
      valid: false,
      errors: ["Scenario input schema is invalid."],
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Scenario input must be a JSON object."],
    }
  }
  const inputRecord = input as Record<string, unknown>
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(inputRecord)) {
      if (!Object.hasOwn(schema.properties, key)) {
        errors.push(`Unknown input field: ${key}`)
      }
    }
  }
  for (const key of schema.required) {
    if (!Object.hasOwn(inputRecord, key)) {
      errors.push(`Missing required input field: ${key}`)
    }
  }
  const fields = schema.properties as Record<string, { type: string; pattern?: string; exclusiveMinimum?: string }>
  for (const [key, fieldSchema] of Object.entries(fields)) {
    if (!Object.hasOwn(inputRecord, key)) {
      continue
    }
    const value = inputRecord[key]
    if (typeof value !== fieldSchema.type) {
      errors.push(`Input field ${key} must be a ${fieldSchema.type}`)
    } else if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value as string)) {
      errors.push(`Input field ${key} does not match its schema pattern`)
    } else if (fieldSchema.exclusiveMinimum !== undefined &&
      compareDecimalStrings({
        left: value as string,
        right: fieldSchema.exclusiveMinimum,
      }) <= 0) {
      errors.push(`Input field ${key} must be greater than ${fieldSchema.exclusiveMinimum}`)
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  }
}
