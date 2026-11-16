/**
 * Validate the immutable payload contract without invoking user getters.
 * Supports primitives, plain objects, arrays, cycles, and shared references.
 * @param {unknown} value
 */
export function assertSupportedPayload(value) {
  validatePayload({
    value,
    seen: new WeakSet(),
  })
}

function validatePayload({ value, seen }) {
  if (isSupportedPrimitive(value)) {
    return
  }

  if (typeof value !== "object") {
    throw new TypeError("Event data contains an unsupported value")
  }

  if (seen.has(value)) {
    return
  }
  seen.add(value)

  const prototype = Object.getPrototypeOf(value)
  const isArray = Array.isArray(value)

  if (
    isArray
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    throw new TypeError(
      "Event data supports only plain objects, arrays, and primitive values",
    )
  }

  for (const key of Reflect.ownKeys(value)) {
    validatePayloadProperty({
      value,
      key,
      isArray,
      seen,
    })
  }
}

function isSupportedPrimitive(value) {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  )
}

function validatePayloadProperty({ value, key, isArray, seen }) {
  if (typeof key !== "string") {
    throw new TypeError("Event data cannot contain symbol properties")
  }

  if (isArray && key === "length") {
    return
  }

  if (
    isArray &&
    (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
  ) {
    throw new TypeError("Event arrays cannot contain custom properties")
  }

  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError("Event data cannot contain accessor properties")
  }
  if (!descriptor.enumerable) {
    throw new TypeError("Event data cannot contain non-enumerable properties")
  }

  validatePayload({
    value: descriptor.value,
    seen,
  })
}

/** Clone and recursively freeze a previously validated payload graph. */
export function cloneAndFreezePayload(data) {
  return deepFreeze(structuredClone(data))
}

function deepFreeze(value) {
  const seen = new WeakSet()

  function freeze(current) {
    if (current === null || typeof current !== "object" || seen.has(current)) {
      return current
    }

    seen.add(current)
    for (const child of Object.values(current)) {
      freeze(child)
    }
    return Object.freeze(current)
  }

  return freeze(value)
}
