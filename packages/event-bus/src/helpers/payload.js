/**
 * Validate the immutable payload contract without invoking user getters.
 * Supports primitives, plain objects, arrays, cycles, and shared references.
 * @param {unknown} value
 * @param {WeakSet<object>} seen
 */
export function assertSupportedPayload(value, seen = new WeakSet()) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return
  }

  if (typeof value !== "object") {
    throw new TypeError("Event data contains an unsupported value")
  }

  if (seen.has(value)) return
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
    if (typeof key !== "string") {
      throw new TypeError("Event data cannot contain symbol properties")
    }

    if (isArray && key === "length") continue

    if (
      isArray &&
      (!/^(0|[1-9]\\d*)$/.test(key) || Number(key) >= value.length)
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

    assertSupportedPayload(descriptor.value, seen)
  }
}

/** Clone and recursively freeze a previously validated payload graph. */
export function cloneAndFreezePayload(data) {
  return deepFreeze(structuredClone(data))
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value
  }

  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}
