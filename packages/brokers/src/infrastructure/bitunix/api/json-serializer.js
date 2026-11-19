const RAW_JSON_NUMBER = Symbol("BitunixRawJsonNumber")
const MAX_INT64 = 9223372036854775807n

/**
 * Create an exact JSON integer token for Bitunix int64 request fields.
 * A string input is preserved without conversion through JavaScript Number.
 *
 * @param {{value: string|number}} input
 * @returns {Readonly<object>}
 */
export function createBitunixInt64JsonNumber({ value }) {
  let integer = value
  if (typeof integer === "number") {
    if (!Number.isSafeInteger(integer) || integer <= 0) {
      throw new RangeError("Bitunix int64 JSON number must be a positive safe integer when supplied as a number")
    }
    integer = String(integer)
  }
  if (typeof integer !== "string" || !/^\d+$/.test(integer)) {
    throw new TypeError("Bitunix int64 JSON number must contain only decimal digits")
  }

  const normalized = integer.replace(/^0+(?=\d)/, "")
  const parsed = BigInt(normalized)
  if (parsed <= 0n || parsed > MAX_INT64) {
    throw new RangeError("Bitunix int64 JSON number is outside the positive signed int64 range")
  }
  return Object.freeze({
    [RAW_JSON_NUMBER]: normalized,
  })
}

function serializeJsonValue({ value, ancestors }) {
  if (value && typeof value === "object" && Object.hasOwn(value, RAW_JSON_NUMBER)) {
    return value[RAW_JSON_NUMBER]
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (ancestors.has(value)) {
    throw new TypeError("Converting circular structure to JSON")
  }

  ancestors.add(value)
  let serialized
  if (typeof value.toJSON === "function" && !Array.isArray(value)) {
    serialized = serializeJsonValue({
      value: value.toJSON(),
      ancestors,
    })
  } else if (Array.isArray(value)) {
    const entries = Array.from({ length: value.length }, (_, index) => (
      serializeJsonValue({
        value: value[index],
        ancestors,
      }) ?? "null"
    ))
    serialized = \`[\${entries.join(",")}]\`
  } else {
    const entries = []
    for (const [key, member] of Object.entries(value)) {
      const serializedMember = serializeJsonValue({
        value: member,
        ancestors,
      })
      if (serializedMember !== undefined) {
        entries.push(\`\${JSON.stringify(key)}:\${serializedMember}\`)
      }
    }
    serialized = \`{\${entries.join(",")}}\`
  }
  ancestors.delete(value)
  return serialized
}

/**
 * JSON.stringify-compatible serialization with exact Bitunix int64 JSON tokens.
 *
 * @param {{value: unknown}} input
 * @returns {string|undefined}
 */
export function serializeBitunixJson({ value }) {
  return serializeJsonValue({
    value,
    ancestors: new Set(),
  })
}
