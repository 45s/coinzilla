/**
 * Create an immutable migration entity.
 *
 * The positive integer version is the migration's stable identity. Applied
 * migrations must never be edited or reused for a different schema change.
 *
 * @param {{version: number, name: string, up: (transaction: {exec: Function, prepare: Function}) => void}} options
 * @returns {{readonly version: number, readonly name: string, readonly up: Function}}
 */
export function createMigration({ version, name, up } = {}) {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new TypeError("Migration version must be a positive safe integer")
  }

  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("Migration must have a non-empty name")
  }

  if (typeof up !== "function") {
    throw new TypeError("Migration must provide an up function")
  }

  if (up.constructor?.name === "AsyncFunction") {
    throw new TypeError("Migration up functions must be synchronous")
  }

  return Object.freeze({ version, name, up })
}
