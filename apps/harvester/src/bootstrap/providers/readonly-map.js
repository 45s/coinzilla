/**
 * A Map-compatible collection whose normal mutation methods fail closed.
 * Values should be frozen before construction when they contain collections.
 */
export class ReadonlyMap extends Map {
  constructor(entries = []) {
    super()
    for (const [key, value] of entries) {
      Map.prototype.set.call(this, key, value)
    }
    Object.freeze(this)
  }

  set() {
    throw new TypeError("ReadonlyMap cannot be modified")
  }

  delete() {
    throw new TypeError("ReadonlyMap cannot be modified")
  }

  clear() {
    throw new TypeError("ReadonlyMap cannot be modified")
  }
}
